// Human-raid census: how often hostile people (the map's groups and raiders from outside the state) come for your
// bases on autopilot campaigns, how strong they are against your defence, what you are warned, what the autopilot
// chose, how it ended and what it cost; plus the gates behind it (who turns hostile and when, who is in reach) and
// the raids and wars between the groups themselves; what raids smash (buildings wrecked and the repair bill,
// breakdowns.js raidDamage) and how many groups are still alive, aggressive and hostile on days 365 and 730.
// Usage: node tools/raidcensus.js [days] [cautious|balanced|aggressive|all] [seeds...] [--runs]
//   defaults: 365 days, all three styles, seeds 1–20 (60 runs). --runs prints one line per run as well.
// Read-only: the sim is watched from outside (new raid parties each hour, the log lines of each hour, the
// autopilot's "🤖 card → choice" lines); nothing in it is changed.
import { createWorld, tickHour, day, hub, atBase, supplyValue, factionById, baseById } from "../src/sim/world.js";
import { setAutopilot, PERSONALITIES } from "../src/sim/autopilot.js";
import { attitude, baseDefense, strength, isAggressiveType } from "../src/sim/factions.js";
import { FACTION_TYPES, SUPPLIES } from "../src/sim/data.js";
import { vStrength, visitorInfo } from "../src/sim/visitors.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const days = Number(args[0] || 365);
const which = args[1] || "all";
const seeds = args.length > 2 ? args.slice(2).map(Number) : Array.from({ length: 20 }, (_, i) => i + 1);
const styles = which === "all" ? Object.keys(PERSONALITIES) : [which];
if (styles.some((s) => !PERSONALITIES[s])) { console.log(`Unknown style "${which}". Use ${Object.keys(PERSONALITIES).join(", ")} or all.`); process.exit(1); }
const BUCKET = 30;
const nBuckets = Math.ceil(days / BUCKET);

const CHOICE = [
  [/^Prepare/, "prepare"], [/^Pay tribute|^Pay them off/, "pay"], [/^Talk them down/, "talk"], [/^Defend in person/, "defend"], [/^Hold as you are/, "hold"],
];
const choiceOf = (label) => (CHOICE.find(([re]) => re.test(label)) || [null, "other"])[1];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function run(seed, style) {
  const state = createWorld({ seed, factionCount: 8 });
  state.started = true;
  setAutopilot(state, true, style);
  const R = { seed, style, raids: [], outsiders: [], rescues: 0, rescueChoices: {}, problems: [], groups: {}, hubDef: {}, alive: {} };
  const byId = new Map();
  const outById = new Map();
  let lines = [];
  const hookLog = () => {
    if (state.log.__hooked) return;
    const arr = state.log;
    arr.unshift = function (...a) { for (const l of a) lines.push(l.text); return Array.prototype.unshift.apply(this, a); };
    arr.__hooked = true;
  };
  hookLog();
  // Groups: when each first turns hostile, and the days it could raid you (the ordinary raid's gates).
  const newGroup = (f) => {
    R.groups[f.id] = { type: f.type, agg: isAggressiveType(f), hostile0: attitude(f) === "Hostile", gw0: f.goodwill, hostileDay: attitude(f) === "Hostile" ? 0 : null,
      hostileDays: 0, eligibleDays: 0, inReachDays: 0, unhostiled: 0, launches: 0, onYou: 0, alive: true, dist0: null, late: day(state) > 1 };
  };
  for (const f of state.factions) newGroup(f);
  const prevAtt = new Map(state.factions.map((f) => [f.id, attitude(f)]));
  const nearest = (f) => { let best = Infinity; for (const b of state.bases) best = Math.min(best, state.grid.distance(f.bases[0], b.tile)); return best; };
  const nearestAny = (f) => { let best = Infinity; for (const b of state.bases) for (const fb of f.bases) best = Math.min(best, state.grid.distance(fb, b.tile)); return best; };
  // The buildings a raid wrecked and the bill (base.lastRaid, breakdowns.js raidDamage) when it was set this hour.
  const damageOf = (r, b0, base) => {
    const lr = base && base.lastRaid;
    if (!lr || !b0 || lr === b0.lastRaid) return;
    r.broken = lr.broken.length;
    r.destroyed = lr.destroyed ? 1 : 0;
    r.damaged = lr.damaged.length;
    r.repair = Object.entries(lr.cost || {}).reduce((a, [k, q]) => a + q * (SUPPLIES[k] ? SUPPLIES[k].value : 1), 0);
    r.repairHours = lr.workHours || 0;
    r.siegeH = lr.hours;
  };
  for (const f of state.factions) R.groups[f.id].dist0 = f.bases.length ? nearest(f) : null;
  try {
    while (day(state) <= days && !state.gameOver) {
      // Before the hour: the stock and people at each base with a raid near it.
      const before = new Map();
      for (const b of state.bases) before.set(b.id, { value: supplyValue(b.stock), people: atBase(state, b.id).length, health: atBase(state, b.id).reduce((a, s) => a + s.health, 0), lastRaid: b.lastRaid });
      const liveBefore = new Set(state.parties.filter((p) => p.kind === "raid").map((p) => p.id));
      lines = [];
      hookLog();
      tickHour(state);
      const d = day(state);
      const deathLines = lines.filter((t) => / died (defending|when .* was overrun)/.test(t));
      // New raid parties of the map's groups.
      for (const p of state.parties) {
        if (p.kind !== "raid" || typeof p.owner !== "number" || byId.has(p.id)) continue;
        const f = factionById(state, p.owner);
        const base = p.target && p.target.kind === "player" ? baseById(state, p.target.baseId) : null;
        const r = {
          id: p.id, fid: p.owner, type: f ? f.type : "?", att: f ? attitude(f) : "?", gw: f ? Math.round(f.goodwill) : 0, day: d, hour: state.hour,
          src: p.warId != null ? "war" : p.grudge ? "grudge" : "ordinary", target: p.target ? p.target.kind : "?", baseId: base ? base.id : null,
          baseType: base ? base.type : null, str: p.strength, fstr: f ? strength(f) : 0, pop: f ? f.pop : 0, def0: base ? baseDefense(state, base) : null, name: f ? f.name : "?", baseName: base ? base.name : null,
          warned: null, atWalls: null, ratio: null, choice: null, end: null, outcome: null, lost: 0, deaths: 0, wounds: 0,
        };
        byId.set(p.id, r);
        R.raids.push(r);
        if (R.groups[p.owner]) { R.groups[p.owner].launches++; if (r.target === "player") R.groups[p.owner].onYou++; }
      }
      // Raids on you: warning, arrival, the choice, the end.
      for (const r of R.raids) {
        if (r.target !== "player" || r.end != null) continue;
        const p = state.parties.find((q) => q.id === r.id);
        const base = baseById(state, r.baseId);
        if (p && p.warned && r.warned == null) {
          r.warned = state.hour;
          r.atWalls = p.phase === "siege";
          const ch = lines.map((t) => new RegExp(`^🤖 Raiders heading for ${esc(r.baseName)} → (.+?)\\.`).exec(t)).find(Boolean);
          if (ch) r.choice = choiceOf(ch[1]);
          if (base) r.ratio = baseDefense(state, base) / Math.max(1, r.str);
        }
        if (p && p.phase === "siege" && r.arrived == null) r.arrived = state.hour;
        if (p && !p.returning) continue;
        // Gone (or turned back): how did it end?
        r.end = state.hour;
        const n = esc(r.name), bn = r.baseName ? esc(r.baseName) : "";
        if (lines.some((t) => new RegExp(`beat off the ${n} raid in a stand-up fight`).test(t))) r.outcome = "won in person";
        else if (lines.some((t) => new RegExp(`drove off the ${n} raid`).test(t))) r.outcome = "held";
        else if (lines.some((t) => new RegExp(`^${n} broke into ${bn}`).test(t))) r.outcome = "break-in";
        else if (lines.some((t) => new RegExp(`^${n} overran ${bn}`).test(t))) r.outcome = "overrun";
        else if (lines.some((t) => /took the tribute/.test(t)) || (p && p.returning)) r.outcome = "paid";
        else if (!base) r.outcome = "base gone";
        else if (!liveBefore.has(r.id)) r.outcome = "vanished";
        else r.outcome = "faded"; // broken on the road (a horde), their group collapsed, …
        const b0 = before.get(r.baseId);
        if (b0 && base) {
          r.lost = Math.max(0, b0.value - supplyValue(base.stock));
          r.wounds = Math.max(0, b0.health - atBase(state, base.id).reduce((a, s) => a + s.health, 0));
        } else if (b0) r.lost = b0.value;
        if (["held", "break-in", "overrun", "won in person"].includes(r.outcome)) r.deaths = deathLines.length;
        damageOf(r, b0, base);
      }
      // Raiders from outside heading for your bases.
      for (const v of state.visitors || []) {
        if (v.kind !== "raiders") continue;
        let o = outById.get(v.id);
        if (!o) { o = { id: v.id, name: v.name, day: d, onYou: 0, raids: [] }; outById.set(v.id, o); R.outsiders.push(o); }
        if (v.goal && v.goal.kind === "base") {
          let cur = o.raids[o.raids.length - 1];
          if (!cur || cur.end != null || cur.baseId !== v.goal.baseId) {
            const base = baseById(state, v.goal.baseId);
            cur = { baseId: v.goal.baseId, baseName: base ? base.name : "?", day: d, str: vStrength(v), def0: base ? baseDefense(state, base) : 0, warned: null, ratio: null, choice: null, end: null, outcome: null, lost: 0, deaths: 0 };
            o.raids.push(cur);
          }
          if (v.warned && cur.warned == null) {
            cur.warned = state.hour;
            const ch = lines.map((t) => new RegExp(`^🤖 Outsider raiders heading for ${esc(cur.baseName)} → (.+?)\\.`).exec(t)).find(Boolean);
            if (ch) cur.choice = choiceOf(ch[1]);
            const base = baseById(state, cur.baseId);
            if (base) cur.ratio = baseDefense(state, base) / Math.max(1, vStrength(v));
          }
        }
      }
      for (const o of R.outsiders) {
        const cur = o.raids[o.raids.length - 1];
        if (!cur || cur.end != null) continue;
        const v = (state.visitors || []).find((x) => x.id === o.id);
        const still = v && v.goal && v.goal.kind === "base" && v.goal.baseId === cur.baseId && !v.paid;
        const n = esc(o.name);
        const hit = lines.find((t) => new RegExp(`drove off ${n}, raiders from outside|^${n} broke into|^${n} overran`, "i").test(t));
        const won = lines.find((t) => new RegExp(`${n}`, "i").test(t) && /stand-up|beat off|broke the band|band is broken|wiped out/i.test(t));
        if (still && !hit && !won) continue;
        if (cur.warned == null) { // warned, answered and settled in one hour (a fight in person), the band gone with it
          const ch = lines.map((t) => new RegExp(`^🤖 Outsider raiders heading for ${esc(cur.baseName)} → (.+?)\\.`).exec(t)).find(Boolean);
          if (ch) { cur.warned = state.hour; cur.choice = choiceOf(ch[1]); }
        }
        cur.end = state.hour;
        cur.outcome = hit ? (/drove off/.test(hit) ? "held" : /broke into/.test(hit) ? "break-in" : "overrun") : won ? "won in person" : v && v.paid ? "paid" : "turned away";
        const b0 = before.get(cur.baseId), base = baseById(state, cur.baseId);
        if (b0) cur.lost = Math.max(0, b0.value - (base ? supplyValue(base.stock) : 0));
        if (hit) cur.deaths = deathLines.length;
        damageOf(cur, b0, base);
      }
      for (const t of lines) {
        if (/^Lookouts at .* see .* fighters coming for their people/.test(t)) R.rescues++;
        const m = /^🤖 .* come for their people → (.+?)\./.exec(t);
        if (m) R.rescueChoices[m[1]] = (R.rescueChoices[m[1]] || 0) + 1;
      }
      // Once a day: attitudes and the gates.
      if (state.hour % 24 === 0) {
        for (const f of state.factions) if (!R.groups[f.id]) newGroup(f);
        if ([365, 730].includes(d) && hub(state)) {
          const live = state.factions.filter((f) => f.alive);
          const hostile = live.filter((f) => attitude(f) === "Hostile");
          const aggr = live.filter((f) => isAggressiveType(f));
          R.alive[d] = { groups: live.length, aggressive: aggr.length, hostile: hostile.length, inReach: hostile.filter((f) => f.bases.length && nearestAny(f) <= 30).length,
            aggPop: aggr.reduce((a, f) => a + f.pop, 0) / Math.max(1, aggr.length), aggBases: aggr.reduce((a, f) => a + f.bases.length, 0) / Math.max(1, aggr.length), late: live.filter((f) => R.groups[f.id] && R.groups[f.id].late).length };
        }
        if ([30, 90, 180, 365].includes(d) && hub(state)) R.hubDef[d] = baseDefense(state, hub(state));
        for (const f of state.factions) {
          const G = R.groups[f.id];
          if (!f.alive) { if (G.alive) G.fellDay = d; G.alive = false; continue; }
          const a = attitude(f);
          if (a === "Hostile") { G.hostileDays++; if (G.hostileDay == null) G.hostileDay = d; }
          if (prevAtt.get(f.id) === "Hostile" && a !== "Hostile") G.unhostiled++;
          prevAtt.set(f.id, a);
          const reach = f.bases.length && nearestAny(f) <= 30; // factions.js RAIDS.REACH, from their nearest base
          if (reach) G.inReachDays++;
          if (a === "Hostile" && reach && f.pop >= 8 && FACTION_TYPES[f.type].raid > 0) G.eligibleDays++;
        }
      }
    }
  } catch (e) {
    R.problems.push(`CRASH day ${day(state)}: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
  }
  R.day = Math.min(day(state), days);
  R.fell = !!state.gameOver && !state.victory;
  R.won = !!state.victory;
  R.diplo = state.diplo ? { ...state.diplo.stats, playerWars: state.diplo.wars.filter((w) => w.playerSide != null).length + state.diplo.ended.filter((w) => w.playerSide != null).length } : {};
  R.vstats = state.visitorInfo ? { ...visitorInfo(state).stats } : {};
  R.hubPop = hub(state) ? atBase(state, hub(state).id).length : 0;
  R.hubValue = hub(state) ? supplyValue(hub(state).stock) : 0;
  R.takeovers = state.stats.takeovers || 0;
  R.newGangs = state.stats.newGangs || 0;
  return R;
}

// ---------- report ----------
const pad = (v, n) => String(v).padEnd(n);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "-");
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const tally = (xs) => { const o = {}; for (const x of xs) o[x] = (o[x] || 0) + 1; return o; };
const tallyText = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${n ? pct(v, n) : v}`).join(", ") || "-";

const all = [];
const t0 = performance.now();
for (const style of styles) for (const seed of seeds) {
  const R = run(seed, style);
  all.push(R);
  if (flags.has("--runs")) {
    const onYou = R.raids.filter((r) => r.target === "player");
    const out = R.outsiders.flatMap((o) => o.raids);
    console.log(`${pad(style, 10)} seed ${pad(seed, 3)} day ${pad(R.day + (R.fell ? "✝" : R.won ? "★" : ""), 5)} group raids ${pad(R.raids.length, 3)} on you ${pad(onYou.length, 3)} (${tallyText(tally(onYou.map((r) => r.outcome)))}) outsiders on you ${pad(out.length, 2)} rescues ${R.rescues} hostile groups ${Object.values(R.groups).filter((g) => g.hostileDay != null).length}/8`);
  }
  for (const p of R.problems) console.log(`PROBLEM ${style} seed ${seed}: ${p}`);
}
console.log(`\nHuman-raid census: ${seeds.length} seeds × ${styles.join("/")} · ${days} days · ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);

for (const style of styles) {
  const runs = all.filter((r) => r.style === style);
  const n = runs.length;
  const raids = runs.flatMap((r) => r.raids);
  const onYou = raids.filter((r) => r.target === "player");
  const outs = runs.flatMap((r) => r.outsiders.flatMap((o) => o.raids));
  const warned = onYou.filter((r) => r.warned != null);
  console.log(`== ${PERSONALITIES[style].name} (${n} runs, ${runs.filter((r) => r.fell).length} fell, avg ${f1(mean(runs.map((r) => r.day)))} days) ==`);
  console.log(`Group raids launched per run ${f1(raids.length / n)}: on you ${f1(onYou.length / n)}, on other groups ${f1((raids.length - onYou.length) / n)} · by source ${tallyText(tally(raids.map((r) => `${r.src}→${r.target}`)))}`);
  console.log(`  on you by group type: ${tallyText(tally(onYou.map((r) => r.type)))} · by attitude at launch: ${tallyText(tally(onYou.map((r) => r.att)))} · on an outpost ${onYou.filter((r) => r.baseType === "outpost").length}`);
  const perRun = runs.map((r) => r.raids.filter((x) => x.target === "player").length);
  console.log(`  raids on you per run: median ${median(perRun)}, min ${Math.min(...perRun)}, max ${Math.max(...perRun)}, runs with none ${perRun.filter((x) => !x).length}/${n} · first one on day ${f1(mean(runs.map((r) => (r.raids.find((x) => x.target === "player") || {}).day).filter(Number.isFinite)))} (avg of runs with one)`);
  // Per 30 days, over the runs still going at the start of each stretch (a fallen holdout is not raided).
  const going = (i) => Math.max(1, runs.filter((r) => r.day > i * BUCKET).length);
  const buckets = Array.from({ length: nBuckets }, (_, i) => onYou.filter((r) => Math.floor((r.day - 1) / BUCKET) === i).length / going(i));
  const obuckets = Array.from({ length: nBuckets }, (_, i) => outs.filter((r) => Math.floor((r.day - 1) / BUCKET) === i).length / going(i));
  console.log(`  per ${BUCKET} days, runs still going: ${Array.from({ length: nBuckets }, (_, i) => runs.filter((r) => r.day > i * BUCKET).length).join(" ")}`);
  console.log(`  per ${BUCKET} days (group raids on you): ${buckets.map((x) => x.toFixed(2)).join(" ")}`);
  console.log(`  per ${BUCKET} days (outsider raids on you): ${obuckets.map((x) => x.toFixed(2)).join(" ")}`);
  console.log(`  strength vs defence at launch: median ratio def/att ${f1(median(onYou.filter((r) => r.def0 != null).map((r) => r.def0 / r.str)))} (att median ${f1(median(onYou.map((r) => r.str)))}, def median ${f1(median(onYou.map((r) => r.def0)))}) · after the response ${f1(median(warned.map((r) => r.ratio)))}`);
  console.log(`  raiding group at launch: strength median ${f1(median(onYou.map((r) => r.fstr)))} (pop ${f1(median(onYou.map((r) => r.pop)))}), raid = ${f1(median(onYou.map((r) => r.str / Math.max(1, r.fstr))))}× of it · hub defence on days 30/90/180/365: ${[30, 90, 180, 365].map((dd) => f1(median(runs.map((r) => r.hubDef[dd]).filter(Number.isFinite)))).join(" / ")}`);
  console.log(`  warned ${pct(warned.length, onYou.length)} (at the walls ${pct(warned.filter((r) => r.atWalls).length, warned.length)}), lead time median ${f1(median(warned.filter((r) => r.end != null).map((r) => r.end - r.warned)))} h · autopilot chose ${tallyText(tally(warned.map((r) => r.choice || "?")), warned.length)}`);
  const ended = onYou.filter((r) => r.outcome);
  console.log(`  outcomes: ${tallyText(tally(ended.map((r) => r.outcome)), ended.length)}`);
  const fought = ended.filter((r) => ["held", "break-in", "overrun", "won in person"].includes(r.outcome));
  const dmgOf = (xs) => `wrecked ${f1(mean(xs.map((r) => r.broken || 0)))} (damaged ${f1(mean(xs.map((r) => r.damaged || 0)))}, destroyed ${f1(mean(xs.map((r) => r.destroyed || 0)))}), repair ${f1(mean(xs.map((r) => r.repair || 0)))} value / ${f1(mean(xs.map((r) => r.repairHours || 0)))} work-h, siege ${f1(mean(xs.filter((r) => r.siegeH != null).map((r) => r.siegeH)))} h`;
  console.log(`  damage per raid that reached you: ${dmgOf(fought)} · held: ${dmgOf(fought.filter((r) => r.outcome === "held"))} · break-in: ${dmgOf(fought.filter((r) => r.outcome === "break-in"))} · overrun: ${dmgOf(fought.filter((r) => r.outcome === "overrun"))}`);
  console.log(`  cost per raid that reached you: stock value lost ${f1(mean(fought.map((r) => r.lost)))} (break-in ${f1(mean(fought.filter((r) => r.outcome === "break-in").map((r) => r.lost)))}, overrun ${f1(mean(fought.filter((r) => r.outcome === "overrun").map((r) => r.lost)))}), deaths ${f1(mean(fought.map((r) => r.deaths)))}, health lost ${f1(mean(fought.map((r) => r.wounds)))} · paying cost ${f1(mean(ended.filter((r) => r.outcome === "paid").map((r) => r.lost)))} · hub stock value at end ${f1(mean(runs.map((r) => r.hubValue)))}`);
  // Outsiders.
  const oended = outs.filter((r) => r.outcome);
  const ofought = oended.filter((r) => ["held", "break-in", "overrun", "won in person"].includes(r.outcome));
  console.log(`Outsider raids on you per run ${f1(outs.length / n)} (bands on the map ${f1(mean(runs.map((r) => r.outsiders.length)))}, raids on groups ${f1(mean(runs.map((r) => r.vstats.raidsOnGroups || 0)))}): warned ${pct(outs.filter((r) => r.warned != null).length, outs.length)}, chose ${tallyText(tally(outs.filter((r) => r.warned != null).map((r) => r.choice || "?")))}, outcomes ${tallyText(tally(oended.map((r) => r.outcome)), oended.length)}, def/att ${f1(median(outs.map((r) => r.def0 / Math.max(1, r.str))))}, lost ${f1(mean(oended.filter((r) => r.outcome !== "paid").map((r) => r.lost)))}, paid ${f1(mean(oended.filter((r) => r.outcome === "paid").map((r) => r.lost)))}, wrecked ${f1(mean(ofought.map((r) => r.broken || 0)))}, repair ${f1(mean(ofought.map((r) => r.repair || 0)))}`);
  console.log(`Rescue raids (prisoners) per run ${f1(mean(runs.map((r) => r.rescues)))}: ${tallyText(runs.reduce((o, r) => { for (const [k, v] of Object.entries(r.rescueChoices)) o[k] = (o[k] || 0) + v; return o; }, {}))}`);
  // Groups and gates.
  const groups = runs.flatMap((r) => Object.values(r.groups));
  const agg = groups.filter((g) => g.agg && !g.late), peace = groups.filter((g) => !g.agg && !g.late); // the groups of day 1 (newcomers are counted on the alive lines)
  console.log(`Groups: aggressive ${f1(agg.length / n)} a run (hostile at start ${pct(agg.filter((g) => g.hostile0).length, agg.length)}, ever ${pct(agg.filter((g) => g.hostileDay != null).length, agg.length)}, base within 30 tiles at start ${pct(agg.filter((g) => g.dist0 <= 30).length, agg.length)}), peaceful ${f1(peace.length / n)} (ever hostile ${pct(peace.filter((g) => g.hostileDay != null).length, peace.length)}, on day ${f1(mean(peace.filter((g) => g.hostileDay).map((g) => g.hostileDay)))}, hostile-days ${f1(mean(peace.map((g) => g.hostileDays)))})`);
  console.log(`  aggressive groups: days hostile+in reach+pop 8 (can raid you) ${f1(mean(agg.map((g) => g.eligibleDays)))} of ${days}, stopped being hostile ${pct(agg.filter((g) => g.unhostiled).length, agg.length)}, launches ${f1(mean(agg.map((g) => g.launches)))} (on you ${f1(mean(agg.map((g) => g.onYou)))}) · by type: ${["raider", "expansionist", "zealot"].map((t) => { const gs = agg.filter((g) => g.type === t); return `${t} ${gs.length} groups, ${f1(mean(gs.map((g) => g.onYou)))} on you, eligible ${f1(mean(gs.map((g) => g.eligibleDays)))}d`; }).join("; ")}`);
  console.log(`  aggressive groups gone (collapsed) by day 90/180/365/730: ${[90, 180, 365, 730].filter((x) => x <= days).map((x) => pct(agg.filter((g) => g.fellDay != null && g.fellDay <= x).length, agg.length)).join(" / ")} · all peaceful groups gone by day ${days}: ${pct(peace.filter((g) => g.fellDay != null).length, peace.length)}`);
  console.log(`  peaceful groups that turned hostile: raids on you ${peace.filter((g) => g.hostileDay != null).reduce((a, g) => a + g.onYou, 0)} in ${peace.filter((g) => g.hostileDay != null).length} groups (ordinary raids need an aggressive type)`);
  for (const dd of [365, 730].filter((x) => x <= days)) {
    const rs = runs.filter((r) => r.alive[dd]);
    if (!rs.length) continue;
    const m = (k) => f1(mean(rs.map((r) => r.alive[dd][k])));
    console.log(`  alive on day ${dd} (${rs.length} runs still going): groups ${m("groups")}, aggressive ${m("aggressive")} (people ${m("aggPop")}, bases ${m("aggBases")}), hostile to you ${m("hostile")} (within 30 tiles ${m("inReach")}), groups that arrived later ${m("late")}`);
  }
  const dsum = (k) => mean(runs.map((r) => r.diplo[k] || 0));
  console.log(`  takeovers of a broken group's land per run ${f1(mean(runs.map((r) => r.takeovers)))}, new gangs from beyond the border ${f1(mean(runs.map((r) => r.newGangs)))}`);
  console.log(`Wars between groups per run ${f1(dsum("wars"))} (you joined ${f1(dsum("joined"))}), war raids ${f1(dsum("raids"))}, pacts ${f1(dsum("pacts"))}, peace ${f1(dsum("peace"))}\n`);
}
const crashes = all.filter((r) => r.problems.length).length;
console.log(`Runs with problems: ${crashes}`);
if (crashes) process.exitCode = 1;
