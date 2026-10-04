// Horde census: how often the dead come, and how hard, over autopilot campaigns. For every run: the hives at the
// start and alive over time, build sites picked / started / finished (and how long each took: the window you have
// to hit a site), hives destroyed, hordes bought by hives and from the border, the dead on the map, Wallbreakers,
// and every horde that reached one of your bases: its size against the base's hold limit, held at the walls /
// a break-in battle won / overrun, whether it was sent (an attack horde) or wandered in, and the people it killed.
// Prints means per 30-day bucket, the first attack (any base and the hub), and the build-site timings.
// Usage: node tools/hordecensus.js [days=365] [cautious|balanced|aggressive|all] [seeds=1-20]
//   seeds: a list (1 2 3) or a range (1-20). Example: node tools/hordecensus.js 365 all 1-20
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { createWorld, tickHour, day, alive } from "../src/sim/world.js";
import { setAutopilot, PERSONALITIES } from "../src/sim/autopilot.js";
import { ensureHives } from "../src/sim/hives.js";

const days = isMainThread ? Number(process.argv[2] || 365) : workerData.days;
const which = process.argv[3] || "all";
const seedArgs = process.argv.slice(4);
const seeds = !seedArgs.length ? Array.from({ length: 20 }, (_, i) => i + 1)
  : seedArgs.flatMap((a) => { const m = /^(\d+)-(\d+)$/.exec(a); return m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i) : [Number(a)]; });
const styles = which === "all" ? Object.keys(PERSONALITIES) : [which];
if (styles.some((s) => !PERSONALITIES[s])) { console.log(`Unknown style "${which}". Use ${Object.keys(PERSONALITIES).join(", ")} or all.`); process.exit(1); }
const BUCKET = 30;
const NB = Math.ceil(days / BUCKET);

const HIT = /^A horde of (\d+) hit (.+?)\. The defences held \(they stop about (\d+)\)/;
const BROKE = /^A horde of (\d+)( led by a \w+)? broke through the defences of (.+?) \(they stop about (\d+)\)/;
const PITS = /^A horde ran onto the spike pits at (.+?) and was torn apart/;

// What a death line's cause was, roughly.
function deathCause(c) {
  if (/hunger|thirst/.test(c)) return "hunger/thirst";
  if (/infect|fever|sick|flu|illness|disease|pneumonia|of [a-z ]+$/.test(c) && !/fight|horde|dead|hands/.test(c)) return "wounds/illness";
  if (/horde|the dead|overr[au]n|brood|hive|turning/.test(c)) return "hordes";
  if (/hands of|raid|raider|bandit|fight with (?!the horde|the dead)/.test(c)) return "people";
  if (/scaveng/.test(c)) return "scavenging";
  return "other";
}

function bucketRow() {
  return { hives: 0, hordes: 0, border: 0, deadOnMap: 0, samples: 0, attacks: 0, sent: 0, held: 0, breakIns: 0, repelled: 0, overrun: 0, deaths: 0, size: 0, limit: 0, bosses: 0, sites: 0, built: 0, destroyed: 0 };
}

function run(seed, style) {
  const state = createWorld({ seed, factionCount: 8 });
  state.started = true;
  setAutopilot(state, true, style);
  ensureHives(state);
  const hubTile = state.bases.find((x) => x.type === "hub").tile;
  const startHubDist = Math.min(...state.hives.map((h) => state.grid.distance(h.tile, hubTile)));
  const stats = state.hiveInfo.stats;
  const r = { causes: {}, seed, style, startHives: state.hives.length, buckets: Array.from({ length: NB }, bucketRow), attacks: [], sites: new Map(), fell: null, won: null, crash: null };
  let last = { ...stats };
  let logTop = state.log[0];
  try {
    while (day(state) <= days && !state.gameOver) {
      const b = r.buckets[Math.min(NB - 1, Math.floor((day(state) - 1) / BUCKET))];
      // Before the hour: who is alive where, and which hordes are about to step onto a base.
      const where = new Map(alive(state).map((s) => [s.id, s.location.kind === "base" ? s.location.baseId : null]));
      const bases = state.bases.map((x) => ({ id: x.id, name: x.name, tile: x.tile, type: x.type }));
      const coming = state.hordes.filter((h) => state.bases.some((x) => x.tile === h.target)).map((h) => ({ id: h.id, target: h.target, role: h.role, size: h.size, bosses: h.bosses || 0 }));
      tickHour(state);
      // New log lines this hour (the log is newest first).
      const fresh = [];
      for (const l of state.log) { if (l === logTop) break; fresh.push(l); }
      logTop = state.log[0];
      const hitBases = new Set();
      for (const l of fresh.reverse()) {
        let m, a = null;
        if (l.kind === "death" && (m = /^.+? died (.+)\.$/.exec(l.text))) { const c = deathCause(m[1]); r.causes[c] = (r.causes[c] || 0) + 1; }
        if ((m = HIT.exec(l.text))) a = { size: +m[1], base: m[2], limit: +m[3], result: "held" };
        else if ((m = BROKE.exec(l.text))) a = { size: +m[1], base: m[3], limit: +m[4], result: "breakIn", boss: !!m[2] };
        else if ((m = PITS.exec(l.text))) a = { size: 0, base: m[1], limit: 0, result: "pits" };
        if (!a) continue;
        const base = bases.find((x) => x.name === a.base) || null;
        const src = base ? coming.find((c) => c.target === base.tile) : null;
        a.day = day(state);
        a.hub = !!base && base.type === "hub";
        a.sent = !!src && src.role === "attack";
        a.bosses = src ? src.bosses : a.boss ? 1 : 0;
        a.horde = src ? src.id : null;
        if (base) hitBases.add(base.id);
        r.attacks.push(a);
        b.attacks++; b.size += a.size; b.limit += a.limit; if (a.sent) b.sent++; if (a.bosses) b.bosses++;
        if (a.result === "held" || a.result === "pits") b.held++; else b.breakIns++;
      }
      b.repelled += stats.repelled - last.repelled;
      b.overrun += stats.overrun - last.overrun;
      if (stats.overrun > last.overrun && r.attacks.length) r.attacks[r.attacks.length - 1].result = "overrun";
      else if (stats.repelled > last.repelled && r.attacks.length) r.attacks[r.attacks.length - 1].result = "repelled";
      // Deaths at a base the dead hit this hour.
      if (hitBases.size) for (const [id, baseId] of where) if (hitBases.has(baseId) && !state.survivors.find((s) => s.id === id).alive) { b.deaths++; if (r.attacks.length) r.attacks[r.attacks.length - 1].deaths = (r.attacks[r.attacks.length - 1].deaths || 0) + 1; }
      b.hordes += stats.hordes - last.hordes;
      b.border += stats.border - last.border;
      b.sites += stats.sites - last.sites;
      b.built += stats.built - last.built;
      b.destroyed += stats.destroyed - last.destroyed;
      last = { ...stats };
      if (state.hour % 24 === 0) {
        b.deadOnMap += state.hordes.reduce((a, h) => a + h.size, 0);
        b.samples++;
        b.hives = state.hives.length;
        const d = day(state);
        for (const s of state.hiveSites) {
          const rec = r.sites.get(s.id) || { picked: d, started: null, end: null, how: null };
          if (s.started != null && rec.started == null) rec.started = d;
          if (rec.seen == null && (state.live.has(s.tile) || state.knowledge[s.tile]?.site)) rec.seen = d - rec.picked; // in sight, or on your map from a report
          r.sites.set(s.id, rec);
        }
        for (const [id, rec] of r.sites) if (rec.end == null && !state.hiveSites.some((s) => s.id === id)) { rec.end = d; rec.how = stats.built > (rec.builtBefore ?? -1) ? "built" : "gone"; }
        for (const rec of r.sites.values()) if (rec.end == null) rec.builtBefore = stats.built;
      }
    }
  } catch (e) {
    r.crash = `day ${day(state)}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`;
  }
  // Buckets the run never reached keep the hive count it ended with only if it was still going.
  r.lastDay = Math.min(days, day(state));
  r.fell = state.gameOver && !state.victory ? day(state) : null;
  r.dead = state.survivors.filter((s) => !s.alive && !s.left).length;
  r.startHubDist = startHubDist;
  r.groups = state.factions.filter((f) => f.alive).length;
  r.won = state.victory ? day(state) : null;
  r.endHives = state.hives.length;
  r.stats = { ...stats };
  r.sites = [...r.sites.values()];
  return r;
}

const pad = (v, n) => String(v).padStart(n);
const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
const pct = (xs, p) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const f0 = (x) => (Number.isFinite(x) ? String(Math.round(x)) : "-");

// Runs are spread over worker threads (each run is deterministic on its own, so the results do not depend on
// how many workers there are).
async function runAll() {
  const jobs = styles.flatMap((style) => seeds.map((seed) => ({ seed, style })));
  const out = new Array(jobs.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(jobs.length, availableParallelism() - 1, 16));
  await Promise.all(Array.from({ length: lanes }, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { days } });
    const feed = () => { if (next >= jobs.length) { w.terminate(); resolve(); return; } const i = next++; w.postMessage({ i, ...jobs[i] }); };
    w.on("message", ({ i, r }) => { out[i] = r; if (r.crash) console.log(`CRASH ${r.style} seed ${r.seed}: ${r.crash}`); feed(); });
    w.on("error", reject);
    feed();
  })));
  return out;
}

if (!isMainThread) {
  parentPort.on("message", ({ i, seed, style }) => parentPort.postMessage({ i, r: run(seed, style) }));
} else {
const t0 = Date.now();
const runs = await runAll();

function report(list, title) {
  console.log(`\n=== ${title}: ${list.length} runs, ${days} days ===`);
  console.log(`start hives ${f1(mean(list.map((r) => r.startHives)))} (${Math.min(...list.map((r) => r.startHives))}–${Math.max(...list.map((r) => r.startHives))}), end hives ${f1(mean(list.map((r) => r.endHives)))}; ` +
    `fell ${list.filter((r) => r.fell).length} (median day ${f0(pct(list.filter((r) => r.fell).map((r) => r.fell), 0.5))}), won ${list.filter((r) => r.won).length}`);
  console.log(`per run: sites ${f1(mean(list.map((r) => r.stats.sites)))}, hives built ${f1(mean(list.map((r) => r.stats.built)))}, destroyed ${f1(mean(list.map((r) => r.stats.destroyed)))}, ` +
    `hive hordes ${f1(mean(list.map((r) => r.stats.hordes)))} (${f0(mean(list.map((r) => r.stats.zombies)))} dead), border hordes ${f1(mean(list.map((r) => r.stats.border)))}, Wallbreakers ${f1(mean(list.map((r) => r.stats.bosses)))}, groups left ${f1(mean(list.map((r) => r.groups)))} of 8`);
  // Per bucket: runs still going in that bucket only.
  console.log(`${"days".padEnd(9)} ${pad("runs", 4)} ${pad("hives", 5)} ${pad("hordes", 6)} ${pad("border", 6)} ${pad("dead/map", 8)} ${pad("attacks", 7)} ${pad("sent", 5)} ${pad("held", 5)} ${pad("brk-in", 6)} ${pad("won", 5)} ${pad("overrun", 7)} ${pad("deaths", 6)} ${pad("avgsize", 7)} ${pad("avglim", 6)} ${pad("w/WB", 5)} ${pad("sites", 5)} ${pad("built", 5)}`);
  for (let i = 0; i < NB; i++) {
    const live = list.filter((r) => r.buckets[i].samples > 0);
    if (!live.length) continue;
    const bk = live.map((r) => r.buckets[i]);
    const s = (k) => mean(bk.map((x) => x[k]));
    const att = bk.reduce((a, x) => a + x.attacks, 0);
    const sz = att ? bk.reduce((a, x) => a + x.size, 0) / att : NaN, lim = att ? bk.reduce((a, x) => a + x.limit, 0) / att : NaN;
    console.log(`${`${i * BUCKET + 1}-${Math.min(days, (i + 1) * BUCKET)}`.padEnd(9)} ${pad(live.length, 4)} ${pad(f1(s("hives")), 5)} ${pad(f1(s("hordes")), 6)} ${pad(f1(s("border")), 6)} ${pad(f0(mean(bk.map((x) => x.deadOnMap / x.samples))), 8)} ` +
      `${pad(f1(s("attacks")), 7)} ${pad(f1(s("sent")), 5)} ${pad(f1(s("held")), 5)} ${pad(f1(s("breakIns")), 6)} ${pad(f1(s("repelled")), 5)} ${pad(f1(s("overrun")), 7)} ${pad(f1(s("deaths")), 6)} ${pad(f0(sz), 7)} ${pad(f0(lim), 6)} ${pad(f1(s("bosses")), 5)} ${pad(f1(s("sites")), 5)} ${pad(f1(s("built")), 5)}`);
  }
  const firstAny = list.map((r) => (r.attacks[0] ? r.attacks[0].day : null));
  const firstHub = list.map((r) => { const a = r.attacks.find((x) => x.hub); return a ? a.day : null; });
  const fa = firstAny.filter((x) => x != null), fh = firstHub.filter((x) => x != null);
  console.log(`first horde at a base: median day ${f0(pct(fa, 0.5))} (25–75%: ${f0(pct(fa, 0.25))}–${f0(pct(fa, 0.75))}; none in ${firstAny.length - fa.length} runs); at the hub: median ${f0(pct(fh, 0.5))} (${f0(pct(fh, 0.25))}–${f0(pct(fh, 0.75))}; none in ${firstHub.length - fh.length})`);
  const all = list.flatMap((r) => r.attacks);
  const repeats = list.reduce((n, r) => n + r.attacks.filter((a, i) => a.horde != null && r.attacks.slice(0, i).some((o) => o.horde === a.horde && a.day - o.day <= 10)).length, 0);
  const lastHit = list.filter((r) => r.fell).map((r) => { const a = r.attacks.filter((x) => x.result === "overrun" || x.result === "repelled"); return a.length ? r.fell - a[a.length - 1].day : Infinity; });
  console.log(`nearest hive to the hub at the start: median ${f0(pct(list.map((r) => r.startHubDist), 0.5))} tiles (${Math.min(...list.map((r) => r.startHubDist))}–${Math.max(...list.map((r) => r.startHubDist))}); ` +
    `people dead per run ${f1(mean(list.map((r) => r.dead)))}, of them in horde attacks ${f1(mean(list.map((r) => r.attacks.reduce((a, x) => a + (x.deaths || 0), 0))))}; ` +
    `falls within 10 days of a break-in ${lastHit.filter((x) => x <= 10).length} of ${lastHit.length}; repeat hits (same horde within 10 days) ${repeats}`);
  const causes = {};
  for (const r of list) for (const [k, v] of Object.entries(r.causes)) causes[k] = (causes[k] || 0) + v;
  console.log(`deaths per run by cause: ${Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f1(v / list.length)}`).join(", ")}`);
  const gaps = list.flatMap((r) => r.attacks.filter((a) => a.hub).map((a) => a.day).map((d, i, a) => (i ? d - a[i - 1] : null)).filter((x) => x != null));
  console.log(`attacks per run ${f1(all.length / list.length)} (hub ${f1(all.filter((a) => a.hub).length / list.length)}): held ${all.filter((a) => a.result === "held" || a.result === "pits").length}, break-in won ${all.filter((a) => a.result === "repelled").length}, overrun ${all.filter((a) => a.result === "overrun").length}; ` +
    `sent ${all.filter((a) => a.sent).length} / wandered in ${all.filter((a) => !a.sent).length}; with a Wallbreaker ${all.filter((a) => a.bosses).length}; days between hub attacks: median ${f0(pct(gaps, 0.5))}`);
  const sites = list.flatMap((r) => r.sites);
  const toStart = sites.filter((s) => s.started != null).map((s) => s.started - s.picked);
  const toBuilt = sites.filter((s) => s.how === "built").map((s) => s.end - s.picked);
  const startToBuilt = sites.filter((s) => s.how === "built" && s.started != null).map((s) => s.end - s.started);
  const firstBuilt = list.map((r) => r.sites.filter((s) => s.how === "built").map((s) => s.end)[0]).filter((x) => x != null);
  const seen = sites.filter((x) => x.seen != null);
  console.log(`build sites you saw (in sight or reported) before they were done: ${seen.length} of ${sites.length}, ${seen.filter((x) => x.seen === 0).length} on the day they were picked`);
  console.log(`build sites: ${sites.length} (${sites.filter((s) => s.how === "built").length} built, ${sites.filter((s) => s.how === "gone").length} given up/cleared, ${sites.filter((s) => s.end == null).length} open at the end); ` +
    `picked→started median ${f0(pct(toStart, 0.5))} d, picked→hive ${f0(pct(toBuilt, 0.5))} d (25–75%: ${f0(pct(toBuilt, 0.25))}–${f0(pct(toBuilt, 0.75))}), started→hive ${f0(pct(startToBuilt, 0.5))} d; first new hive median day ${f0(pct(firstBuilt, 0.5))} (${list.length - firstBuilt.length} runs none)`);
}

for (const style of styles) report(runs.filter((r) => r.style === style), style);
if (styles.length > 1) report(runs, "all styles");
const crashes = runs.filter((r) => r.crash).length;
console.log(`\n${runs.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s${crashes ? `, ${crashes} CRASHED` : ""}`);
process.exitCode = crashes ? 1 : 0;
}
