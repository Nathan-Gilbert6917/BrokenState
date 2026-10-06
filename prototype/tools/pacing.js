// Pacing and decision quality: plays autopilot campaigns and measures how often the game stops the player.
// Every card is caught as it is added to state.cards (whatever module adds it), with the hour, the module that
// added it (from the call stack), its choices and the one the autopilot picked. Search screens, trade windows and
// battles that open are counted as well (they pause the clock in the browser too).
//
// Reports: cards per in-game day (mean, p90, max, per 30-day bucket), cards per real minute at 1x and 3x (main.js:
// an hour takes 3 s at 1x, a day 72 s; every card pauses the clock), bursts (most cards in any 6 hours and any
// 24 hours), crises stacking (raid / horde / illness / team in trouble within 3 days), quiet stretches (longest run
// of days with no card), the mix by module and by title (top 25), repeats of the same title within a week, and for
// each frequent card the share of each choice the autopilot took.
//
// Usage:
//   node tools/pacing.js [days] [cautious|balanced|aggressive|all] [seeds...]      (default 365 all, seeds 1-14)
//   node tools/pacing.js log [days] [style] [seed]                                 (the full log of one run, day by day)
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { setAutopilot, PERSONALITIES } from "../src/sim/autopilot.js";

const args = process.argv.slice(2);
const logMode = args[0] === "log";
if (logMode) args.shift();
const days = Number(args[0] || (logMode ? 120 : 365));
const which = args[1] || (logMode ? "balanced" : "all");
const seeds = args.length > 2 ? args.slice(2).map(Number) : logMode ? [1] : Array.from({ length: 14 }, (_, i) => i + 1);
const styles = which === "all" ? Object.keys(PERSONALITIES) : [which];
if (styles.some((s) => !PERSONALITIES[s])) {
  console.log(`Unknown style "${which}". Use ${Object.keys(PERSONALITIES).join(", ")} or all.`);
  process.exit(1);
}

// ---------- catching cards and log lines ----------
const SIM = /[\\/]src[\\/]sim[\\/]([a-z]+)\.js:(\d+)/;
function sourceOf(stack) {
  // The first sim frame that is not world.js addCard (world.js itself adds the leader card).
  const lines = stack.split("\n").slice(2);
  let first = null;
  for (const l of lines) {
    const m = SIM.exec(l);
    if (!m) continue;
    if (!first) first = m[1];
    if (m[1] === "world" && /addCard/.test(l)) continue;
    return m[1];
  }
  return first || "?";
}

// One card key per kind of card: names of people, groups, bases, places and numbers taken out.
function namesOf(state, c) {
  const names = [];
  for (const f of state.factions || []) names.push(f.name);
  for (const b of state.bases || []) names.push(b.name);
  for (const s of state.survivors || []) { names.push(s.name); names.push(s.name.split(" ")[0]); }
  for (const h of state.hives || []) if (h.name) names.push(h.name);
  for (const v of state.visitors || []) if (v.name) { names.push(v.name); names.push(v.name[0].toUpperCase() + v.name.slice(1)); }
  if (c.where) names.push(c.where);
  return names.sort((a, b) => b.length - a.length);
}
const unname = (t, names) => { for (const n of names) if (n && n.length > 2) t = t.split(n).join("#"); return t; };
function cardKey(state, c, names) {
  let t = c.title || "?";
  if (c.isOrders) return /^Done/.test(t) ? "Done: <job>" : /^Orders/.test(t) ? "Orders: team at <place>" : t;
  t = unname(t, names);
  t = t.replace(/\d+/g, "#").replace(/\([^)]*\)/g, "(#)");
  if (/^Trade caravan at|^Rescue at|^Held at/.test(t)) t = t.replace(/ at .*/, " at #");
  if (/^Rich site/.test(t)) t = "Rich site: #";
  if (/^Job offer|^On the radio|patrol$|ask(s)? for help|^Raiders heading|^Horde heading|^Outsider raiders|^The hive/.test(t)) t = t.replace(/: .*/, ": #");
  if (/^The fight with/.test(t)) t = "The fight with #";
  if (/ reached /.test(t)) t = "# reached <skill> #";
  if (/^(Fire in the|The .* at # broke down|The well pump)/.test(t)) t = t.replace(/^Fire in the .*/, "Fire in the #").replace(/^The .* at # broke down/, "The # at # broke down");
  return t;
}

const isOff = (st, ch) => (typeof ch.disabled === "function" ? ch.disabled(st) : !!ch.disabled);

function instrument(state, rec) {
  const seen = new WeakSet();
  const cards = state.cards;
  state.cards = new Proxy(cards, {
    set(target, prop, value, recv) {
      if (value && typeof value === "object" && value.choices && !seen.has(value)) {
        seen.add(value);
        const names = namesOf(state, value);
        const entry = {
          h: state.hour, key: cardKey(state, value, names), title: value.title, src: sourceOf(new Error().stack),
          orders: !!value.isOrders, conflict: value.kind === "conflict", partyId: value.partyId ?? null,
          labels: value.choices.map((c) => unname(c.label, names)), enabled: value.choices.filter((c) => !c.uiAction && !isOff(state, c)).length,
          pick: null, text: value.text || "",
        };
        entry.okOnly = value.choices.length === 1;
        // A duplicate: the same card about the same team (or the same base card) already waiting in the queue.
        entry.dup = target.some((o) => o && o !== value && o.title === value.title && (o.partyId ?? null) === entry.partyId && !o.isOrders && (o.text || "") === (value.text || ""));
        rec.cards.push(entry);
        for (const ch of value.choices) {
          if (typeof ch.resolve !== "function") continue;
          const orig = ch.resolve;
          ch.resolve = function (...a) {
            entry.pick = unname(ch.label, names);
            const out = orig.apply(this, a);
            entry.out = typeof out === "string" ? out : "";
            entry.pickH = state.hour;
            // Answered after its subject was gone: the choice did nothing.
            entry.stale = /^(Too late|The quarrel is over|They are gone|They have moved on|The horde is gone|.*no longer (with|there|here))/i.test(entry.out);
            return out;
          };
        }
      }
      return Reflect.set(target, prop, value, recv);
    },
  });
  // Screens that pause the clock: search (engagement), trade window, tactical battle.
  for (const k of ["engagement", "trade", "combat"]) {
    let v = state[k];
    Object.defineProperty(state, k, {
      configurable: true, enumerable: true,
      get: () => v,
      set: (x) => { if (x && !v) rec.screens.push({ h: state.hour, k }); v = x; },
    });
  }
  // The full log (state.log keeps only the last 200 lines): world.js log() adds each line with unshift.
  const logArr = state.log;
  const unshift = (...items) => { for (const l of items) if (l && typeof l.text === "string") rec.log.push(l); return logArr.unshift(...items); };
  state.log = new Proxy(logArr, { get: (t, prop, r) => (prop === "unshift" ? unshift : Reflect.get(t, prop, r)) });
}

// ---------- crises ----------
// What counts as a crisis of each kind, by card title or log line. Hordes met on the road (hide / outrun) are not
// crises; a horde coming for a base is. Illness: an outbreak card, pneumonia, or 2+ people falling ill that day.
const CRISIS = {
  raid: { card: /^Raiders heading|^Outsider raiders heading|^Raid defense|come for their people$/ },
  horde: { card: /^Horde heading for|^Overrun$|^The horde is beaten/ },
  illness: { card: /^Outbreak at/, log: /came down with pneumonia|pneumonia set in|has pneumonia/i },
  team: { card: /^The worm|^Held at|^Cannot go home|^Rescue at|^Your people at|^The dead surge/, log: /whole team was lost|taken captive|were captured/i },
};

// Big moments in the log, and the cards that warn of them (or let the player act on them).
const MOMENTS = {
  raidHit: /drove off the .* raid\.|broke into .* before being pushed out|overran .*\.$|Raid defense/,
  hordeHit: /^A horde of \d+.* hit |ran onto the spike pits|broke through the defences of|The dead overran/,
  hostile: /is now hostile toward you/,
  pactTorn: /has torn up your/,
  hiveGathering: /The dead are gathering|have started to build a hive/,
  hiveRisen: /A new hive has risen/,
  rations: /is on short rations/,
  outOfFood: /is out of food/,
  collapsed: /has collapsed\.$/,
};
const WARN_CARDS = { raidWarn: /^Raiders heading for|^Outsider raiders heading/, hordeWarn: /^Horde heading for/ };

function analyse(state, rec, style, seed) {
  const nDays = Math.min(days, day(state) - 1 + (state.gameOver ? 1 : 0)) || 1;
  const perDay = new Array(nDays).fill(0);
  const decPerDay = new Array(nDays).fill(0);
  for (const c of rec.cards) {
    const d = Math.floor(c.h / 24);
    if (d < nDays) { perDay[d]++; if (!c.okOnly && !c.orders) decPerDay[d]++; }
  }
  // Stops: distinct hours in which at least one new card arrives (the clock stops once; the cards of that hour queue up).
  const stopHours = new Set(rec.cards.map((c) => c.h));
  const stops = [...stopHours].filter((h) => Math.floor(h / 24) < nDays).length;
  // Follow-ups: the same card again in the same hour (a conversation that goes on: news, then who wants to stay).
  const follow = rec.cards.filter((c, i) => rec.cards.slice(Math.max(0, i - 6), i).some((o) => o.h === c.h && o.key === c.key)).length;
  // Bursts: the most cards in any window of 6 / 24 hours.
  const hs = rec.cards.map((c) => c.h).sort((a, b) => a - b);
  const burst = (w) => { let best = 0, j = 0; for (let i = 0; i < hs.length; i++) { while (hs[i] - hs[j] >= w) j++; best = Math.max(best, i - j + 1); } return best; };
  const longestQuiet = (arr) => { let best = 0, run = 0; for (const n of arr) { run = n ? 0 : run + 1; best = Math.max(best, run); } return best; };
  // Crises by day.
  const crisisDays = {};
  for (const k of Object.keys(CRISIS)) crisisDays[k] = new Set();
  for (const c of rec.cards) {
    for (const [k, r] of Object.entries(CRISIS)) if (r.card.test(c.title)) crisisDays[k].add(Math.floor(c.h / 24));
    // A conflict that forces a fight on a team (no way to talk or slip away) is a team in trouble.
    if (c.conflict && c.labels.every((l) => !/talk|leave|slip|back off|avoid|go around|walk away|sneak/i.test(l))) crisisDays.team.add(Math.floor(c.h / 24));
  }
  const ill = {};
  for (const l of rec.log) {
    for (const [k, r] of Object.entries(CRISIS)) if (r.log && r.log.test(l.text)) crisisDays[k].add(Math.floor(l.hour / 24));
    if (/came down with/.test(l.text)) { const d = Math.floor(l.hour / 24); ill[d] = (ill[d] || 0) + 1; if (ill[d] >= 2) crisisDays.illness.add(d); }
  }
  // Big moments, from the log, next to the warning cards for them: does the player get a say?
  const moments = {};
  for (const [k, rx] of Object.entries(MOMENTS)) moments[k] = rec.log.filter((l) => Math.floor(l.hour / 24) < nDays && rx.test(l.text)).length;
  for (const [k, rx] of Object.entries(WARN_CARDS)) moments[k] = rec.cards.filter((c) => Math.floor(c.h / 24) < nDays && rx.test(c.title)).length;
  let stack2 = 0, stack3 = 0;
  for (let d = 0; d < nDays; d++) {
    let kinds = 0;
    for (const k of Object.keys(CRISIS)) if ([d, d + 1, d + 2].some((x) => crisisDays[k].has(x))) kinds++;
    if (kinds >= 2) stack2++;
    if (kinds >= 3) stack3++;
  }
  return {
    style, seed, nDays, gameOver: !!state.gameOver && !state.victory, victory: !!state.victory,
    cards: rec.cards.filter((c) => Math.floor(c.h / 24) < nDays), perDay, decPerDay,
    stops, follow, burst6: burst(6), burst24: burst(24), quiet: longestQuiet(perDay), quietDec: longestQuiet(decPerDay),
    screens: rec.screens.filter((s) => Math.floor(s.h / 24) < nDays),
    moments, crisisDays: Object.fromEntries(Object.entries(crisisDays).map(([k, v]) => [k, v.size])), stack2, stack3,
  };
}

function play(seed, style) {
  const state = createWorld({ seed, factionCount: 8 });
  const rec = { cards: [], screens: [], log: [] };
  instrument(state, rec);
  state.started = true;
  setAutopilot(state, true, style);
  while (day(state) <= days && !state.gameOver) tickHour(state);
  return { state, rec };
}

// ---------- log mode: one run's full log, day by day ----------
if (logMode) {
  const { rec } = play(seeds[0], styles[0]);
  const cardsByH = new Map();
  for (const c of rec.cards) { const a = cardsByH.get(c.h) || []; a.push(c); cardsByH.set(c.h, a); }
  let lastDay = -1;
  const lines = [...rec.log].sort((a, b) => a.hour - b.hour);
  for (const l of lines) {
    const d = Math.floor(l.hour / 24) + 1;
    if (d > days) break;
    if (d !== lastDay) { console.log(`\n=== Day ${d} ===`); lastDay = d; }
    console.log(`${String(l.hour % 24).padStart(2, "0")}h ${l.kind === "info" ? " " : l.kind[0].toUpperCase()} ${l.text}`);
  }
  process.exit(0);
}

// ---------- the campaigns ----------
const runs = [];
const t0 = performance.now();
let problems = 0;
for (const style of styles) for (const seed of seeds) {
  try {
    const { state, rec } = play(seed, style);
    const r = analyse(state, rec, style, seed);
    runs.push(r);
    const unpicked = r.cards.filter((c) => c.pick == null && !c.orders);
    const dups = r.cards.filter((c) => c.dup), stale = r.cards.filter((c) => c.stale);
    if (dups.length) console.log(`  ? ${style} seed ${seed}: ${dups.length} duplicate card(s) (${[...new Set(dups.map((c) => c.key))].slice(0, 5).join(", ")})`);
    if (stale.length) console.log(`  ? ${style} seed ${seed}: ${stale.length} card(s) answered after their subject was gone (${[...new Set(stale.map((c) => c.key))].slice(0, 5).join(", ")})`);
    // Cards nobody could answer (the autopilot drops what needs a map click): flagged.
    const stuck = unpicked.filter((c) => c.enabled === 0);
    if (stuck.length) { problems++; console.log(`  ! ${style} seed ${seed}: ${stuck.length} card(s) with no choice that can be taken (${[...new Set(stuck.map((c) => c.key))].slice(0, 4).join(", ")})`); }
  } catch (e) {
    problems++;
    console.log(`  ! CRASH ${style} seed ${seed}: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
  }
}
const secs = (performance.now() - t0) / 1000;

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
const all = (fn) => runs.flatMap(fn);

console.log(`Pacing: ${runs.length} autopilot campaigns (${styles.join(", ")}; seeds ${seeds.join(" ")}), up to ${days} days, ${f1(secs)} s`);
for (const r of runs) {
  const n = r.cards.length;
  console.log(`  ${r.style.padEnd(10)} seed ${String(r.seed).padEnd(3)} days ${String(r.nDays).padEnd(4)}${r.gameOver ? "✝" : r.victory ? "★" : " "} cards ${String(n).padEnd(5)} (${f2(n / r.nDays)}/day, decisions ${f2(r.cards.filter((c) => !c.okOnly && !c.orders).length / r.nDays)}/day) ` +
    `burst 6h ${String(r.burst6).padEnd(3)} 24h ${String(r.burst24).padEnd(3)} quiet ${String(r.quiet).padEnd(3)}d (no decision ${r.quietDec}d) crises r${r.crisisDays.raid} h${r.crisisDays.horde} i${r.crisisDays.illness} t${r.crisisDays.team} stacked2 ${r.stack2} stacked3 ${r.stack3}`);
}

// Per style and overall.
const groups = [...styles.map((s) => [s, runs.filter((r) => r.style === s)]), ["all", runs]];
console.log("\nCards per in-game day (all cards / decisions only = 2+ choices, not team orders):");
console.log("  style       mean  p90  max | decisions mean p90 max | orders/day  OK-only/day | 6h burst max (median) | 24h burst max (median) | quiet days max (median)");
for (const [name, rs] of groups) {
  if (!rs.length) continue;
  const pd = rs.flatMap((r) => r.perDay), dd = rs.flatMap((r) => r.decPerDay);
  const totalDays = rs.reduce((a, r) => a + r.nDays, 0);
  const orders = rs.reduce((a, r) => a + r.cards.filter((c) => c.orders).length, 0) / totalDays;
  const ok = rs.reduce((a, r) => a + r.cards.filter((c) => c.okOnly).length, 0) / totalDays;
  console.log(`  ${name.padEnd(10)} ${f2(mean(pd)).padStart(5)} ${String(pct(pd, 0.9)).padStart(4)} ${String(Math.max(...pd)).padStart(4)} | ${f2(mean(dd)).padStart(14)} ${String(pct(dd, 0.9)).padStart(3)} ${String(Math.max(...dd)).padStart(3)} | ${f2(orders).padStart(10)} ${f2(ok).padStart(12)} | ` +
    `${String(Math.max(...rs.map((r) => r.burst6))).padStart(12)} (${pct(rs.map((r) => r.burst6), 0.5)}) | ${String(Math.max(...rs.map((r) => r.burst24))).padStart(13)} (${pct(rs.map((r) => r.burst24), 0.5)}) | ${String(Math.max(...rs.map((r) => r.quiet))).padStart(14)} (${pct(rs.map((r) => r.quiet), 0.5)})`);
}
// Per 30-day bucket.
console.log("\nCards per day by 30-day bucket (all / decisions):");
const buckets = Math.ceil(days / 30);
for (const [name, rs] of groups) {
  if (!rs.length) continue;
  const cells = [];
  for (let b = 0; b < buckets; b++) {
    const pd = rs.flatMap((r) => r.perDay.slice(b * 30, b * 30 + 30)), dd = rs.flatMap((r) => r.decPerDay.slice(b * 30, b * 30 + 30));
    cells.push(pd.length ? `${f1(mean(pd))}/${f1(mean(dd))}` : "-");
  }
  console.log(`  ${name.padEnd(10)} ${cells.map((c, i) => `d${i * 30 + 1}:${c}`).join("  ")}`);
}
const stopsPd = runs.reduce((a, r) => a + r.stops, 0) / runs.reduce((a, r) => a + r.nDays, 0);
const followPd = runs.reduce((a, r) => a + r.follow, 0) / runs.reduce((a, r) => a + r.nDays, 0);
// Real time: an hour is 3 s at 1x (72 s a day), 1 s at 3x. Every card pauses the clock until answered.
const allDays = runs.reduce((a, r) => a + r.nDays, 0);
const cpd = runs.reduce((a, r) => a + r.cards.length, 0) / allDays;
const dpd = runs.reduce((a, r) => a + r.cards.filter((c) => !c.okOnly && !c.orders).length, 0) / allDays;
const spd = runs.reduce((a, r) => a + r.screens.length, 0) / allDays;
console.log(`\nReal time (main.js: 72 s a day at 1x, 24 s at 3x; a card, search screen, trade window or battle pauses the clock):`);
console.log(`  cards ${f2(cpd)}/day = ${f2(cpd * 60 / 72)} per minute of running clock at 1x, ${f2(cpd * 60 / 24)} at 3x (one every ${f1(72 / cpd)} s at 1x, ${f1(24 / cpd)} s at 3x)`);
console.log(`  clock stops (hours with a new card) ${f2(stopsPd)}/day = one every ${f1(72 / stopsPd)} s at 1x, ${f1(24 / stopsPd)} s at 3x; follow-up cards in the same conversation ${f2(followPd)}/day`);
console.log(`  decisions ${f2(dpd)}/day = one every ${f1(72 / dpd)} s at 1x, ${f1(24 / dpd)} s at 3x`);
const scr = {};
for (const r of runs) for (const s of r.screens) scr[s.k] = (scr[s.k] || 0) + 1;
console.log(`  other pausing screens ${f2(spd)}/day (${Object.entries(scr).map(([k, v]) => `${k} ${f2(v / allDays)}`).join(", ")})`);

// Crises.
console.log("\nCrises (days with each kind, mean per run) and stacking (days where 2+ / 3+ kinds fall within the same 3 days):");
for (const [name, rs] of groups) {
  if (!rs.length) continue;
  const m = (k) => f1(mean(rs.map((r) => r.crisisDays[k])));
  console.log(`  ${name.padEnd(10)} raid ${m("raid")}  horde ${m("horde")}  illness ${m("illness")}  team ${m("team")}  | 2+ kinds ${f1(mean(rs.map((r) => r.stack2)))} days/run (${f1(100 * mean(rs.map((r) => r.stack2 / r.nDays)))}%)  3+ kinds ${f1(mean(rs.map((r) => r.stack3)))} days/run`);
}

// Team cards (on the road, about one team) against cards at a base, and the low-stakes cards: the ones where the
// autopilot takes the same answer 90%+ of the time or that have one button, small in effect (review/pacing.md).
const LOW_STAKES = /^(Storm|Abandoned supply truck|Tempers flare|Stranded traders|Prepper cache|Radio signal|# patrol|Stories by the fire|Horde spotted|Traders on the radio|Cold feet|# reached <skill> #|Horde of #)$/;
{
  const cardsAllT = all((r) => r.cards);
  const team = cardsAllT.filter((c) => c.partyId != null).length;
  const low = cardsAllT.filter((c) => LOW_STAKES.test(c.key)).length;
  console.log(`\nTeam cards (about a team on the road) ${team} (${f1((100 * team) / cardsAllT.length)}%), base and world cards ${cardsAllT.length - team}.`);
  console.log(`Low-stakes cards (storm, supply truck, tempers, stranded traders, prepper cache, radio signal, patrol, stories, horde spotted, radio traders, cold feet, perk points, road horde): ${low} (${f1((100 * low) / cardsAllT.length)}%). Without them: ${f2((cardsAllT.length - low) / allDays)} cards a day, one every ${f1((72 * allDays) / (cardsAllT.length - low))} s at 1x.`);
  for (const [name, rs] of groups) {
    if (!rs.length || name === "all") continue;
    const cs = rs.flatMap((r) => r.cards), dd = rs.reduce((a, r) => a + r.nDays, 0);
    const l = cs.filter((c) => LOW_STAKES.test(c.key)).length;
    console.log(`  ${name.padEnd(10)} ${f2(cs.length / dd)}/day → ${f2((cs.length - l) / dd)}/day without them (low-stakes ${f1((100 * l) / cs.length)}%)`);
  }
}

// Big moments and whether a card came with them.
console.log("\nBig moments per run (from the log) and the cards that come with them:");
for (const [name, rs] of groups) {
  if (!rs.length) continue;
  const m = (k) => f1(mean(rs.map((r) => r.moments[k])));
  console.log(`  ${name.padEnd(10)} raids at your bases ${m("raidHit")} (warning cards ${m("raidWarn")}) · hordes at your walls ${m("hordeHit")} (warning cards ${m("hordeWarn")}) · a group turns hostile ${m("hostile")} · pact torn up ${m("pactTorn")} · dead gathering / a hive being built ${m("hiveGathering")} · new hive ${m("hiveRisen")} · short rations ${m("rations")} · out of food (base-days) ${m("outOfFood")} · a group collapses ${m("collapsed")}`);
}

// Mix by module.
const cardsAll = all((r) => r.cards);
const bySrc = {};
for (const c of cardsAll) bySrc[c.src] = (bySrc[c.src] || 0) + 1;
console.log(`\nCards by module (${cardsAll.length} cards):`);
console.log("  " + Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${f1((100 * v) / cardsAll.length)}%)`).join(", "));

// Top titles, repeats and the autopilot's picks.
const byKey = {};
for (const r of runs) {
  const lastSeen = {};
  for (const c of r.cards) {
    const k = byKey[c.key] || (byKey[c.key] = { n: 0, rep7: 0, ok: 0, orders: 0, src: c.src, picks: {}, enabled: 0, labels: new Set(), runs: new Set() });
    k.n++;
    k.runs.add(`${r.style}${r.seed}`);
    if (c.okOnly) k.ok++;
    if (c.orders) k.orders++;
    k.enabled += c.enabled;
    if (lastSeen[c.key] != null && c.h - lastSeen[c.key] <= 7 * 24) k.rep7++;
    lastSeen[c.key] = c.h;
    const lab = c.pick == null ? (c.orders ? "(team orders)" : "(withdrawn)") : c.pick.replace(/\d+/g, "#").replace(/\([^)]*\)/g, "").trim().slice(0, 40);
    k.picks[lab] = (k.picks[lab] || 0) + 1;
    for (const l of c.labels) k.labels.add(l.replace(/\d+/g, "#").replace(/\([^)]*\)/g, "").trim().slice(0, 40));
  }
}
const top = Object.entries(byKey).sort((a, b) => b[1].n - a[1].n);
console.log(`\nTop 25 cards (per run = mean over ${runs.length} runs; repeat = same card again within 7 days; picks = the autopilot's answers):`);
for (const [key, k] of top.slice(0, 25)) {
  const picks = Object.entries(k.picks).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, n]) => `${l} ${Math.round((100 * n) / k.n)}%`).join(" · ");
  console.log(`  ${String(k.n).padStart(6)} ${f1(k.n / runs.length).padStart(6)}/run ${k.src.padEnd(10)} repeat ${String(Math.round((100 * k.rep7) / k.n)).padStart(3)}% ${k.ok ? "OK-only " : ""}${key.slice(0, 48).padEnd(48)} ${picks}`);
}
console.log(`\nAll card kinds (${top.length}):`);
console.log("  " + top.map(([key, k]) => `${key} ${k.n}`).join(" | "));

// Decision spread: cards with 2+ choices where the autopilot (nearly) always picks the same one.
console.log("\nOne-answer decisions (2+ choices, 20+ seen, the top answer 90%+ of the time):");
for (const [key, k] of top) {
  if (k.n < 20 || k.ok === k.n || k.orders) continue;
  const [l, n] = Object.entries(k.picks).sort((a, b) => b[1] - a[1])[0];
  if (n / k.n >= 0.9) console.log(`  ${key.slice(0, 50).padEnd(50)} ${k.n}× → ${l} ${Math.round((100 * n) / k.n)}% (choices: ${[...k.labels].slice(0, 5).join(" / ")})`);
}

if (problems) {
  console.log(`\n${problems} problem(s).`);
  process.exit(1);
}
console.log("\nNo crashes and no unanswerable cards.");
