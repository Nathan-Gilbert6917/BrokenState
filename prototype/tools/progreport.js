// The progression report (2026-10-09): reads a campaign50 census (its --out JSON or its --jsonl file, or several to
// compare: an A/B prints the two side by side) and prints, from each game's `prog` (tools/progtrack.js):
// - outcomes by style and start, wins by game year;
// - when the mid game and the end game are reached (the progression markers, progtrack.js) and the milestones behind
//   them, as game years (a hardcore run's years count from the normal start, eras.js rampDay): median, quartiles,
//   share of games that got there;
// - the average state of the holdout at the start of each year (population, bases, land, hives, gear, raids);
// - the content checklist: how many games touched each system, and the building types never built.
// Usage: node tools/progreport.js <census.json|games.jsonl> [<other.json|jsonl> ...] [--by style|mode|size|groups] [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const files = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const BY = flag("--by", "style");
const JSON_OUT = flag("--json", null);
if (!files.length) { console.log("usage: node tools/progreport.js <census.json|games.jsonl> [more ...] [--by style|mode|size|groups] [--json out.json]"); process.exit(2); }

// Your hive kills from the dated events (campaign50's `events`): the first trackers (before 2026-10-09's fix)
// counted a growth burned by your team as a hive. The first one's day, and the mid-game marker from it.
const HIVE_KILL = /^The hive [^.]* was destroyed by your team/;
function normalize(r) {
  const p = r.prog;
  if (!p || p.error || !Array.isArray(r.events)) return r;
  const kills = r.events.filter((e) => HIVE_KILL.test(e.text)).map((e) => e.day);
  p.first.yourHive = kills.length ? kills[0] : null;
  p.yourHiveKills = kills.length;
  for (const s of p.years || []) s.yourKills = kills.filter((d) => d <= s.day).length;
  const f = p.first;
  const or = f.yourHive != null || f.member != null ? Math.min(f.yourHive ?? Infinity, f.member ?? Infinity) : null;
  f.MID = f.midEra != null && f.secondBase != null && or != null ? Math.max(f.midEra, f.secondBase, or) : null;
  p.markers = { ...(p.markers || {}), mid: f.MID };
  return r;
}
const load = (f) => {
  const txt = readFileSync(f, "utf8");
  const list = /\.jsonl$/.test(f) ? txt.split("\n").filter(Boolean).map((l) => JSON.parse(l)) : (() => { const j = JSON.parse(txt); return j.results || j; })();
  return list.map(normalize);
};

const YEAR_DAYS = 112, START_OFFSET = 14; // eras.js
// A game day as a fractional game year (year 1 starts at 1.0; a hardcore run's day counts from its normal start).
const yearAt = (r, d) => (d == null ? null : Math.round(((Math.max(1, d - ((r.prog && r.prog.offset) || 0)) - 1 + START_OFFSET) / YEAR_DAYS + 1) * 10) / 10);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return Math.round((s[lo] + (s[hi] - s[lo]) * (i - lo)) * 10) / 10; };
const spread = (xs, n) => (xs.length ? `${q(xs, 0.5)} (${q(xs, 0.25)}–${q(xs, 0.75)}, ${pct(xs.length, n)})` : `never (0/${n})`);
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const groupBy = (list, key) => { const m = new Map(); for (const r of list) { const k = typeof key === "function" ? key(r) : r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };

const MILESTONES = [
  ["midEra", "mid era begins"], ["secondBase", "second base"], ["outpost", "first outpost founded"], ["coalition", "coalition founded"], ["member", "first member"],
  ["yourHive", "first hive destroyed by you"], ["anyHiveDestroyed", "first hive destroyed (anyone)"], ["conquest", "first base taken"], ["secondVehicle", "a second vehicle"],
  ["land25", "land 25%"], ["land40", "land 40%"], ["land50", "land over 50%"], ["tier2growth", "first tier-2 growth"], ["tier3growth", "first tier-3 growth"], ["tier4growth", "first tier-4 growth"],
  ["wallbreaker", "first Wallbreaker"], ["lateEra", "late era begins"], ["winOpen", "victories open"], ["accordClock", "Accord clock starts"], ["clearClock", "containment clock starts"], ["burnout", "outbreak burns out"],
  ["MID", "MID GAME (marker)"], ["END", "END GAME (marker)"],
];

function report(results, label) {
  const ok = results.filter((r) => r.prog && !r.prog.error);
  const n = results.length;
  console.log(`\n=================== ${label}: ${n} games (${ok.length} with progression data) ===================`);
  // Outcomes.
  const out = (list) => { const c = (o) => list.filter((r) => r.outcome === o).length; const hw = list.filter((r) => r.hiveWinDay != null).length; return `${rpad(list.length, 3)} | hive win ${rpad(hw, 3)} | coalition ${rpad(c("alliance"), 3)} | fell ${rpad(c("loss"), 3)} | going ${rpad(c("going"), 3)} | crash ${rpad(c("crash"), 2)}`; };
  console.log(`\nOutcomes (hive win: every hive destroyed, the game kept going after it):`);
  for (const [k, l] of groupBy(results, BY)) console.log(`  ${pad(k, 14)} ${out(l)}`);
  for (const [k, l] of groupBy(results, "mode")) console.log(`  ${pad(k, 14)} ${out(l)}`);
  console.log(`  ${pad("all", 14)} ${out(results)}`);
  // Wins by year.
  const winYears = {};
  for (const r of results) {
    if (r.hiveWinDay != null) { const y = Math.floor(yearAt(r, r.hiveWinDay)); (winYears[y] = winYears[y] || { hive: 0, coalition: 0, loss: 0 }).hive++; }
    if (r.outcome === "alliance") { const y = Math.floor(yearAt(r, r.day)); (winYears[y] = winYears[y] || { hive: 0, coalition: 0, loss: 0 }).coalition++; }
    if (r.outcome === "loss") { const y = Math.floor(yearAt(r, r.day)); (winYears[y] = winYears[y] || { hive: 0, coalition: 0, loss: 0 }).loss++; }
  }
  console.log(`\nWins and losses by game year: ${Object.keys(winYears).sort((a, b) => a - b).map((y) => `y${y} ${winYears[y].hive}h/${winYears[y].coalition}c/${winYears[y].loss}l`).join("  ") || "none"}`);
  const firstWin = (r) => Math.min(r.hiveWinDay ?? Infinity, r.outcome === "alliance" ? r.day : Infinity);
  const wy = ok.filter((r) => Number.isFinite(firstWin(r))).map((r) => yearAt(r, firstWin(r)));
  console.log(`First victory of either kind: year ${spread(wy, n)}`);
  // Markers and milestones.
  const cols = [...groupBy(ok, BY).keys()];
  console.log(`\nMilestones as game years: median (quartiles, share of games reaching it). By ${BY}: ${cols.join(", ")}`);
  for (const [k, name] of MILESTONES) {
    const ys = ok.map((r) => yearAt(r, r.prog.first[k])).filter((y) => y != null);
    const per = cols.map((c) => { const l = ok.filter((r) => r[BY] === c); const v = l.map((r) => yearAt(r, r.prog.first[k])).filter((y) => y != null); return `${c} ${v.length ? q(v, 0.5) : "-"}/${pct(v.length, l.length)}`; }).join("  ");
    console.log(`  ${pad(name, 32)} ${pad(spread(ys, ok.length), 26)} ${per}`);
  }
  const inBand = (k, lo, hi) => { const ys = ok.map((r) => yearAt(r, r.prog.first[k])).filter((y) => y != null); return `${ys.filter((y) => y >= lo && y < hi + 1).length}/${ok.length} in years ${lo}–${hi}, ${ys.filter((y) => y < lo).length} before, ${ys.filter((y) => y >= hi + 1).length} after, ${ok.length - ys.length} never`; };
  console.log(`  target: mid game ${inBand("MID", 5, 8)}`);
  console.log(`  target: end game ${inBand("END", 10, 15)}`);
  // The year-start snapshots.
  const ys = {};
  for (const r of ok) for (const s of r.prog.years) { if (s.end) continue; (ys[s.year] = ys[s.year] || []).push(s); }
  const keys = ["pop", "bases", "vehicles", "bestWeapon", "squad", "members", "land", "hives", "destroyed", "yourKills", "maxHiveTier", "bosses", "deaths", "raids", "hordes"];
  console.log(`\nAt the start of each game year (averages over the games still alive then; era: share mid/late):`);
  console.log("  " + pad("year", 6) + rpad("games", 6) + rpad("mid/late", 10) + keys.map((k) => rpad(k, Math.max(8, k.length + 1))).join(""));
  for (const y of Object.keys(ys).map(Number).sort((a, b) => a - b)) {
    const l = ys[y];
    const avg = (k) => Math.round((l.reduce((a, s) => a + (s[k] || 0), 0) / l.length) * 10) / 10;
    console.log("  " + pad(y, 6) + rpad(l.length, 6) + rpad(`${pct(l.filter((s) => s.era === "mid").length, l.length)}/${pct(l.filter((s) => s.era === "late").length, l.length)}`, 10) + keys.map((k) => rpad(avg(k), Math.max(8, k.length + 1))).join(""));
  }
  // Content checklist.
  const content = {};
  for (const r of ok) for (const [k, v] of Object.entries(r.prog.content || {})) { const c = (content[k] = content[k] || { games: 0, total: 0 }); if (v > 0) c.games++; c.total += v; }
  console.log(`\nContent checklist (games that touched it / total count): rarely (<15% of games) marked with !`);
  const rows = Object.entries(content).sort((a, b) => a[1].games - b[1].games);
  for (const [k, c] of rows) console.log(`  ${c.games / ok.length < 0.15 ? "!" : " "} ${pad(k, 40)} ${rpad(`${c.games}/${ok.length}`, 8)} ${rpad(c.total, 8)}`);
  const counters = {};
  for (const r of ok) for (const [k, v] of Object.entries(r.prog.counters || {})) { if (typeof v !== "number") continue; const c = (counters[k] = counters[k] || { games: 0, total: 0 }); if (v > 0) c.games++; c.total += v; }
  console.log(`\nWorld counters (games with any / total): ${Object.entries(counters).map(([k, c]) => `${k} ${c.games}/${c.total}`).join(", ")}`);
  const built = {};
  for (const r of ok) for (const b of r.prog.built || []) built[b] = (built[b] || 0) + 1;
  const never = new Set();
  for (const r of ok) for (const b of r.prog.neverBuilt || []) if (!built[b]) never.add(b);
  console.log(`\nBuildings: never built in any game: ${[...never].join(", ") || "none"}; built in under 15% of games: ${Object.entries(built).filter(([, v]) => v / ok.length < 0.15).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  // Crashes and the tracker's own errors.
  const crashes = results.filter((r) => r.outcome === "crash");
  if (crashes.length) { console.log(`\nCRASHES (${crashes.length}):`); for (const r of crashes) console.log(`  seed ${r.seed} ${r.mode}/${r.style} ${r.size} g${r.groups} day ${r.crashDay ?? r.day}: ${r.error}`); }
  const terr = ok.filter((r) => r.prog.first.trackError);
  if (terr.length) console.log(`\nTracker errors: ${terr.map((r) => `seed ${r.seed}: ${r.prog.first.trackError}`).join("; ")}`);
  const stuck = results.filter((r) => r.outcome !== "crash" && r.longestSilent >= 60);
  if (stuck.length) console.log(`\nPossibly stuck (no log line for 60+ days): ${stuck.map((r) => `seed ${r.seed} ${r.mode}/${r.style} (${r.longestSilent}d)`).join(", ")}`);
  return {
    label, n, outcomes: Object.fromEntries(["hives", "alliance", "loss", "going", "crash"].map((o) => [o, results.filter((r) => r.outcome === o).length])), hiveWins: results.filter((r) => r.hiveWinDay != null).length,
    winYears, firstWin: { median: q(wy, 0.5), q1: q(wy, 0.25), q3: q(wy, 0.75), reached: wy.length },
    milestones: Object.fromEntries(MILESTONES.map(([k]) => { const v = ok.map((r) => yearAt(r, r.prog.first[k])).filter((y) => y != null); return [k, { median: q(v, 0.5), q1: q(v, 0.25), q3: q(v, 0.75), reached: v.length }]; })),
    content, neverBuilt: [...never],
  };
}

const summaries = files.map((f) => report(load(f), f.replace(/^.*[\\/]/, "")));
if (summaries.length > 1) {
  console.log(`\n=================== A/B ===================`);
  console.log(pad("", 34) + summaries.map((s) => rpad(s.label.slice(0, 24), 26)).join(""));
  const line = (name, f) => console.log(pad(name, 34) + summaries.map((s) => rpad(f(s), 26)).join(""));
  line("games", (s) => s.n);
  line("hive wins / coalition / fell", (s) => `${s.hiveWins} / ${s.outcomes.alliance} / ${s.outcomes.loss}`);
  line("first victory year", (s) => `${s.firstWin.median ?? "-"} (${s.firstWin.reached})`);
  for (const [k, name] of MILESTONES) line(name, (s) => { const m = s.milestones[k]; return m.reached ? `${m.median} (${m.q1}–${m.q3}) ${m.reached}` : "never"; });
}
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(summaries, null, 1)); console.log(`\nsummary written to ${JSON_OUT}`); }
