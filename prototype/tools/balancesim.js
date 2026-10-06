// Balance census: runs many autopilot campaigns (sim/autopilot.js) and measures how the game plays out over time:
// outcomes and when they happen, population, deaths by cause, desertions, hives and hordes, horde attacks and raids
// on your bases, wars and collapses among the AI groups, the coalition, cards per day, days where crises pile up
// ("overlap"), quiet stretches, and the hub's stocks. Read-only: it watches the world between ticks (new log lines,
// cards as they are added, the memorial wall, survivor flags) and changes no rule, so every run plays out exactly
// as it would without it.
//
// Usage: node tools/balancesim.js [days] [--runs N] [--seeds 1-34|1,2,5] [--styles all|cautious,balanced] [--size huge]
//                                 [--workers N] [--json path] [--quiet] [--tune T]
// Long runs (over 730 days, up to 15 years = 5475): the phase tables go by year and a "Year by year" table per style
// adds hives (standing, built, destroyed), hordes, horde attacks and their size, raids, groups and aggressive groups
// left, the coalition and the falls and victories of each year.
// Defaults: 730 days, seeds 1-34 x the three styles trimmed to 100 runs, workers = CPU cores - 2 (max 12).
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { writeFileSync, realpathSync } from "node:fs";
import os from "node:os";
import { createWorld, tickHour, day, alive, hub, setNextId } from "../src/sim/world.js";
import { setAutopilot, autopilotStats, PERSONALITIES } from "../src/sim/autopilot.js";
import { hiveStats } from "../src/sim/hives.js";
import { allianceMembers, controlledLand } from "../src/sim/alliance.js";
import { WORLD_SIZES, sizeDef } from "../src/sim/worldsize.js";
import { isAggressiveType, attitude, RAIDS } from "../src/sim/factions.js";
import { HIVE } from "../src/sim/hiveconst.js";
import { HORDE_SIZES } from "../src/sim/hordes.js";
import { ALLIANCE } from "../src/sim/alliance.js";
import { ERAS, yearOfDay, yearStartDay } from "../src/sim/eras.js";

// --tune: what-if balance numbers for these runs only (nothing in the game files changes), as wintest.js, e.g.
// --tune HIVE.NEW_CAP=3:5,ERAS.HORDE_GROW=0.1. Tables: HIVE, HORDE_SIZES, ALLIANCE, RAIDS, ERAS. a:b is a pair.
const TABLES = { HIVE, HORDE_SIZES, ALLIANCE, RAIDS, ERAS };
export function applyTune(spec) {
  for (const part of (spec || "").split(",").filter(Boolean)) {
    const [path, raw] = part.split("=");
    const keys = path.split(".");
    let obj = TABLES[keys.shift()];
    while (obj && keys.length > 1) obj = obj[keys.shift()];
    if (!obj || !(keys[0] in obj)) throw new Error(`--tune: unknown ${path}`);
    obj[keys[0]] = raw.includes(":") ? raw.split(":").map(Number) : Number(raw);
  }
}

const FACTIONS = 8; // on a Normal map; other sizes (--size) play with their default group count (sim/worldsize.js)
const SAMPLE = 30; // days between samples
const DAILY_KEYS = ["cards", "decisions", "teamCards", "raidG", "raidO", "hordeHit", "hordeWarn", "death", "desert", "illness", "outbreak", "hungry", "thirsty", "shortRations"];

// ======================================================================================
// One campaign
// ======================================================================================
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function deathBucket(m, baseNames) {
  const c = m.cause || "";
  if (/hunger|starvation/.test(c)) return "starvation";
  if (/thirst/.test(c)) return "thirst";
  if (/^of (fever|flu|dysentery|pneumonia)/.test(c)) return "illness";
  if (/infected wound/.test(c)) return "infected wound";
  if (/the worm|turned/.test(c)) return "the worm"; // worm.js: turned, put down, the table, or hurt by one who turned
  if (/at the hands of|captors/.test(c)) return "captivity";
  const atBase = baseNames.has(m.place);
  if (atBase) {
    if (/horde|the dead|Wallbreaker/i.test(c)) return "horde at a base";
    if (/defending|overrun|fight with|came for their people/.test(c)) return "raid at a base";
    return "other at a base";
  }
  if (/horde|the dead/i.test(c)) return "horde in the field";
  if (/drowned|storm|blizzard|walking home|errand/.test(c)) return "accident / weather";
  return "fight / scavenging in the field";
}

export function runCampaign({ seed, style, days, size = "normal", tune = "" }) {
  applyTune(tune);
  setNextId(1); // every run starts from the ids a fresh process would hand out (same run in any order / worker)
  const state = createWorld({ seed, factionCount: size === "normal" ? FACTIONS : sizeDef(size).defGroups, size });
  state.started = true;
  setAutopilot(state, true, style);
  const D = days + 1;
  const daily = Object.fromEntries(DAILY_KEYS.map((k) => [k, new Array(D).fill(0)]));
  const r = {
    seed, style, days, outcome: "survived", endDay: days, problems: [],
    samples: [], peak: alive(state).length, peakDay: 1, deathCauses: {}, deathRaw: {}, deaths: [], desertions: 0,
    hordeAttacks: [], raids: [], hiveAssaults: [], hivesDestroyed: [], titles: {}, collapses: [], firstSeen: {}, ms: 0,
  };
  const baseNames = new Set(state.bases.map((b) => b.name));
  const baseTypes = new Map(state.bases.map((b) => [b.name, b.type]));
  const names = { people: new Set(), groups: new Set() };
  const today = () => day(state);
  const bump = (k, n = 1) => { const d = today(); if (d <= days) daily[k][d] += n; };
  const first = (k) => { if (r.firstSeen[k] == null) r.firstSeen[k] = today(); };

  // ---- cards: counted as they are added (the autopilot answers them inside the same tick) ----
  const normTitle = (t) => {
    let s = t;
    for (const n of baseNames) s = s.split(n).join("<base>");
    for (const f of state.factions) s = s.split(f.name).join("<group>");
    for (const p of state.survivors) { s = s.split(p.name).join("<person>"); }
    s = s.replace(/^[A-Z][a-z]+ (reached|took|and) /, "<person> $1 ").replace(/ and [A-Z][a-z]+ have grown close/, " and <person> have grown close");
    s = s.replace(/: (The |the )?[A-Z][\w' -]+$/, ": <name>");
    return s.replace(/\d+/g, "#");
  };
  const pendingRaids = [];
  const onCard = (c) => {
    if (!c || !c.title) return;
    bump("cards");
    const real = (c.choices || []).filter((x) => !x.uiAction);
    if (real.length >= 2) bump("decisions");
    if (c.partyId != null) bump("teamCards");
    const t = normTitle(c.title);
    r.titles[t] = (r.titles[t] || 0) + 1;
    let m;
    if ((m = /^Raiders heading for (.+)$/.exec(c.title))) {
      const fm = /Lookouts spot about \d+ (.+?) fighters? on the way/.exec(c.text || "");
      const f = fm ? state.factions.find((x) => x.name === fm[1]) : null;
      const base = state.bases.find((b) => b.name === m[1]);
      const raid = { day: today(), src: "group", type: f ? f.type : "?", who: f ? f.name : fm ? fm[1] : "?", base: m[1], baseType: base ? base.type : "?", result: null };
      r.raids.push(raid); pendingRaids.push(raid);
      bump("raidG"); first("raid");
    } else if ((m = /^Outsider raiders heading for (.+)$/.exec(c.title))) {
      const vm = /^(.+?), about \d+ raiders/.exec(c.text || "");
      const base = state.bases.find((b) => b.name === m[1]);
      const raid = { day: today(), src: "outsider", type: "outsiders", who: vm ? vm[1] : "?", base: m[1], baseType: base ? base.type : "?", result: null };
      r.raids.push(raid); pendingRaids.push(raid);
      bump("raidO"); first("raid");
    } else if (/^Horde heading for /.test(c.title)) { bump("hordeWarn"); first("hordeWarn"); }
    else if (/^Outbreak at /.test(c.title)) bump("outbreak");
  };
  const push = state.cards.push;
  state.cards.push = function (...cards) { for (const c of cards) onCard(c); return push.apply(this, cards); };

  // ---- log lines: raid and horde outcomes, hunger, thirst, illness ----
  const pendingBreakIns = [];
  const settleRaid = (who, baseName, result) => {
    const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
    let raid = pendingRaids.find((x) => x.base === baseName && same(x.who, who)) || pendingRaids.find((x) => x.base === baseName);
    if (!raid) { // a raid with no warning card (should not happen): counted all the same
      const f = state.factions.find((x) => same(x.name, who));
      raid = { day: today(), src: f ? "group" : "outsider", type: f ? f.type : "outsiders", who, base: baseName, baseType: baseTypes.get(baseName) || "?", result: null, unwarned: true };
      r.raids.push(raid);
      bump(f ? "raidG" : "raidO"); first("raid");
    } else pendingRaids.splice(pendingRaids.indexOf(raid), 1);
    raid.result = result;
    raid.resultDay = today();
  };
  const onLine = (l) => {
    const t = l.text;
    let m;
    if (t.startsWith("🤖 ")) {
      if ((m = /^🤖 (?:Outsider r|R)aiders heading for (.+?)(?: \(.+\))? → (Pay tribute|Pay them off|Talk them down)/.exec(t))) {
        if (m[2] !== "Talk them down" || /talked them down/.test(t)) {
          const raid = pendingRaids.find((x) => x.base === m[1]);
          if (raid) { pendingRaids.splice(pendingRaids.indexOf(raid), 1); raid.result = "paid"; raid.resultDay = today(); }
        }
      }
      return;
    }
    // Horde attacks on your bases (defences.js).
    if ((m = /^A horde ran onto the spike pits at (.+?) and was torn apart/.exec(t)) && baseNames.has(m[1])) {
      r.hordeAttacks.push({ day: today(), size: null, base: m[1], baseType: baseTypes.get(m[1]), result: "pits" }); bump("hordeHit"); first("hordeHit"); return;
    }
    if ((m = /^A horde of (\d+) hit (.+?)\. The defences held/.exec(t)) && baseNames.has(m[2])) {
      r.hordeAttacks.push({ day: today(), size: +m[1], base: m[2], baseType: baseTypes.get(m[2]), result: "held" }); bump("hordeHit"); first("hordeHit"); return;
    }
    if ((m = /^A horde of (\d+)( led by .+?)? broke through the defences of (.+?) \(they stop/.exec(t)) && baseNames.has(m[3])) {
      const a = { day: today(), size: +m[1], base: m[3], baseType: baseTypes.get(m[3]), result: "broke in", boss: !!m[2] };
      r.hordeAttacks.push(a); pendingBreakIns.push(a); bump("hordeHit"); first("hordeHit"); first("hordeBreakIn"); return;
    }
    if ((m = /^(.+?) held: the (\d+) dead that broke in were cut down/.exec(t)) && baseNames.has(m[1])) {
      const a = pendingBreakIns.find((x) => x.base === m[1]);
      if (a) { a.result = "repelled"; pendingBreakIns.splice(pendingBreakIns.indexOf(a), 1); }
      return;
    }
    if ((m = /^The dead overran (.+?)\./.exec(t)) && baseNames.has(m[1])) {
      const a = pendingBreakIns.find((x) => x.base === m[1]);
      if (a) { a.result = "overrun"; pendingBreakIns.splice(pendingBreakIns.indexOf(a), 1); }
      first("hordeOverrun");
      return;
    }
    // Raid outcomes (factions.js, conflicts.js, visitors.js).
    if ((m = /^(.+) drove off the (.+) raid\.$/.exec(t)) && baseNames.has(m[1])) return settleRaid(m[2], m[1], "held");
    if ((m = /^(.+) beat off the (.*) raid in a stand-up fight\.$/.exec(t)) && baseNames.has(m[1])) return settleRaid(m[2], m[1], "held (fought)");
    if ((m = /^(.+) drove off (.+), raiders from outside the state\.$/.exec(t)) && baseNames.has(m[1])) return settleRaid(m[2], m[1], "held");
    if ((m = /^(.+) broke into (.+) before being pushed out\./.exec(t)) && baseNames.has(m[2])) return settleRaid(m[1], m[2], "broke in");
    if ((m = /^(.+) broke (.+) in a stand-up fight\./.exec(t)) && baseNames.has(m[1])) return settleRaid(m[2], m[1], "held (fought)");
    if ((m = /^(.+) overran (.+)\.$/.exec(t)) && !/the dead$/i.test(m[1]) && baseNames.has(m[2])) return settleRaid(m[1], m[2], "overrun");
    // Food, water, sickness.
    if (/ is out of food/.test(t)) { if (!onceToday.has("hungry")) { onceToday.add("hungry"); bump("hungry"); } return; }
    if (/ is out of water/.test(t)) { if (!onceToday.has("thirsty")) { onceToday.add("thirsty"); bump("thirsty"); } return; }
    if (/ is on short rations/.test(t)) { if (!onceToday.has("short")) { onceToday.add("short"); bump("shortRations"); } return; }
    if (/^The hive .* was destroyed/.test(t)) { r.hivesDestroyed.push(today()); return; }
    if (/came down with (pneumonia|dysentery)/.test(t)) bump("illness");
  };
  let onceToday = new Set(), onceDay = 0;

  // ---- samples every 30 days ----
  const sample = () => {
    const h = hub(state);
    const hs = hiveStats(state);
    const land = controlledLand(state);
    const sum = (k) => state.bases.reduce((a, b) => a + (b.stock[k] || 0), 0);
    r.samples.push({
      day: today(), pop: alive(state).length, bases: state.bases.length,
      hives: (state.hives || []).length, building: (state.hiveSites || []).filter((s) => s.started != null).length,
      hordes: state.hordes.length, roaming: state.hordes.filter((x) => x.role === "roam" || x.role === "attack" || x.role === "border" || !x.role).length,
      dead: Math.round(state.hordes.reduce((a, x) => a + (x.size || 0), 0)),
      wars: state.diplo ? state.diplo.wars.length : 0, groups: state.factions.filter((f) => f.alive).length,
      coalition: allianceMembers(state).length, land: Math.round(land.pct * 1000) / 10,
      food: Math.round(sum("food") + sum("preserved")), water: Math.round(sum("water")), meds: Math.round(sum("meds")), ammo: Math.round(sum("ammo")),
      hubFood: h ? Math.round((h.stock.food || 0) + (h.stock.preserved || 0)) : 0,
      hivesDestroyed: hs.destroyed, hivesBuilt: hs.built, sites: (state.hiveSites || []).length,
      // Aggressive groups (raiders, zealots, expansionists) still standing, and those hostile to you; new gangs so far.
      agg: state.factions.filter((f) => f.alive && isAggressiveType(f)).length,
      aggHostile: state.factions.filter((f) => f.alive && isAggressiveType(f) && attitude(f) === "Hostile").length,
      newGangs: state.stats.newGangs || 0, bandsSettled: state.stats.bandsSettled || 0,
      outposts: state.bases.filter((b) => b.type === "outpost").length,
    });
  };

  let top = state.log[0];
  let memorialSeen = 0;
  const leftSeen = new Set();
  const factionAlive = new Map(state.factions.map((f) => [f.id, f.alive]));
  const engagedSince = new Map();
  const hiveTeams = new Set();
  const t0 = performance.now();
  sample();
  try {
    while (day(state) <= days && !state.gameOver) {
      tickHour(state);
      const d = today();
      if (d !== onceDay) { onceDay = d; onceToday = new Set(); }
      for (const b of state.bases) { baseNames.add(b.name); baseTypes.set(b.name, b.type); }
      // New log lines, oldest first.
      const fresh = [];
      for (const l of state.log) { if (l === top) break; fresh.push(l); }
      top = state.log[0];
      for (let i = fresh.length - 1; i >= 0; i--) onLine(fresh[i]);
      // Deaths (the memorial wall, relations.js) and desertions.
      const mem = state.memorial || [];
      for (let i = mem.length - memorialSeen - 1; i >= 0; i--) {
        const m = mem[i];
        const bucket = deathBucket(m, baseNames);
        r.deathCauses[bucket] = (r.deathCauses[bucket] || 0) + 1;
        const raw = m.cause.replace(/\d+/g, "#").replace(/ at .+$| near .+$/, "");
        r.deathRaw[raw] = (r.deathRaw[raw] || 0) + 1;
        r.deaths.push({ day: m.died, bucket });
        bump("death"); first("death");
      }
      memorialSeen = mem.length;
      for (const s of state.survivors) {
        if (s.left && !leftSeen.has(s.id)) { leftSeen.add(s.id); r.desertions++; bump("desert"); first("desertion"); }
      }
      for (const f of state.factions) {
        if (factionAlive.get(f.id) && !f.alive) r.collapses.push({ day: d, type: f.type });
        factionAlive.set(f.id, f.alive);
      }
      const n = alive(state).length;
      if (n > r.peak) { r.peak = n; r.peakDay = d; }
      if (state.hour % 24 === 0 && ((d - 1) % SAMPLE === 0 || (d > 1 && yearStartDay(yearOfDay(d)) === d))) sample();
      // Health checks (as autotest.js): cards left open, NaN, teams halted with nothing to resolve them.
      if (state.cards.length && !state.gameOver) r.problems.push(`day ${d}: ${state.cards.length} card(s) left open (${state.cards[0].title})`);
      if (state.hour % 24 === 0) {
        for (const b of state.bases) for (const [k, v] of Object.entries(b.stock)) if (!Number.isFinite(v)) r.problems.push(`day ${d}: ${b.name} stock ${k} = ${v}`);
        for (const s of state.survivors) if (s.alive && !Number.isFinite(s.health)) r.problems.push(`day ${d}: ${s.name} health ${s.health}`);
        for (const h of state.hordes) if (!Number.isFinite(h.size)) r.problems.push(`day ${d}: horde ${h.id} size ${h.size}`);
      }
      for (const p of state.parties) if (p.owner === "player" && p.mission === "hive" && !hiveTeams.has(p.id)) { hiveTeams.add(p.id); r.hiveAssaults.push(today()); }
      for (const p of state.parties) {
        if (p.owner !== "player" || p.phase !== "engaged") { engagedSince.delete(p.id); continue; }
        const pending = state.cards.some((c) => c.partyId === p.id) || (state.engagement && state.engagement.partyId === p.id) || (state.trade && state.trade.partyId === p.id);
        if (pending) { engagedSince.delete(p.id); continue; }
        const since = engagedSince.get(p.id) ?? state.hour;
        engagedSince.set(p.id, since);
        if (state.hour - since > 48) { r.problems.push(`day ${d}: team ${p.id} stuck (${p.mission})`); engagedSince.delete(p.id); }
      }
      if (r.problems.length > 30) break;
    }
  } catch (e) {
    r.problems.push(`CRASH day ${day(state)}: ${e.stack.split("\n").slice(0, 5).join(" | ")}`);
    r.outcome = "crash";
  }
  r.ms = Math.round(performance.now() - t0);
  if (r.outcome !== "crash") {
    if (state.gameOver && state.victory) r.outcome = state.victoryReason === "alliance" ? "alliance" : "hives";
    else if (state.gameOver) r.outcome = "fell";
  }
  r.endDay = state.gameOver ? day(state) : Math.min(day(state) - 1, days);
  if (!r.samples.length || r.samples[r.samples.length - 1].day !== today()) sample();
  r.finalPop = alive(state).length;
  for (const raid of pendingRaids) if (!raid.result) raid.result = "never arrived";
  const hs = hiveStats(state);
  r.hive = { ...hs, startHives: r.samples[0].hives };
  r.diplo = state.diplo ? { wars: state.diplo.stats.wars, peace: state.diplo.stats.peace, basesTaken: state.diplo.stats.basesTaken } : { wars: 0, peace: 0, basesTaken: 0 };
  r.coalitionMax = Math.max(...r.samples.map((s) => s.coalition));
  r.gov = autopilotStats(state);
  r.visitors = state.visitorInfo ? { ...state.visitorInfo.stats } : null;
  r.era = state.era ? { ...state.era } : null; // eras.js: when each victory's conditions first held, and the clocks' best
  // Only the days the run lasted.
  r.daily = Object.fromEntries(Object.entries(daily).map(([k, a]) => [k, a.slice(0, r.endDay + 1)]));
  return r;
}

// ======================================================================================
// Statistics
// ======================================================================================
const q = (arr, p) => {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
const med = (a) => q(a, 0.5);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : "–");
const f0 = (v) => (Number.isFinite(v) ? Math.round(v).toString() : "–");
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "–");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");

// Days on which each kind of crisis happened, for the overlap and quiet-stretch measures.
const CRISES = {
  raid: (r, d) => r.daily.raidG[d] + r.daily.raidO[d] > 0,
  horde: (r, d) => r.daily.hordeHit[d] > 0,
  sickness: (r, d) => r.daily.outbreak[d] + r.daily.illness[d] > 0,
  death: (r, d) => r.daily.death[d] > 0,
  hunger: (r, d) => r.daily.hungry[d] + r.daily.thirsty[d] > 0,
};
const threatDay = (r, d) => Object.values(CRISES).some((f) => f(r, d)) || r.daily.hordeWarn[d] > 0 || r.daily.desert[d] > 0;

function feel(r) {
  const n = r.endDay;
  const kinds = Object.keys(CRISES);
  const has = kinds.map((k) => Array.from({ length: n + 2 }, (_, d) => (d >= 1 && d <= n ? CRISES[k](r, d) : false)));
  const overlap = new Array(n + 1).fill(0);
  let overlapDays = 0, overlap3 = 0;
  for (let d = 1; d <= n; d++) {
    let c = 0;
    for (let k = 0; k < kinds.length; k++) if (has[k][d - 1] || has[k][d] || has[k][d + 1]) c++;
    overlap[d] = c;
    if (c >= 2) overlapDays++;
    if (c >= 3) overlap3++;
  }
  let quietCard = 0, quietThreat = 0, runC = 0, runT = 0, quietDecision = 0, runD = 0;
  for (let d = 1; d <= n; d++) {
    runC = r.daily.cards[d] ? 0 : runC + 1; quietCard = Math.max(quietCard, runC);
    runD = r.daily.decisions[d] ? 0 : runD + 1; quietDecision = Math.max(quietDecision, runD);
    runT = threatDay(r, d) ? 0 : runT + 1; quietThreat = Math.max(quietThreat, runT);
  }
  return { overlap, overlapDays, overlap3, quietCard, quietDecision, quietThreat };
}

// Long runs go by the game's calendar year (weather.js: four seasons of 28 days = 112 days; day 1 is mid-spring of
// year 1, so year 1 is days 1–98, year 2 starts on day 99, year 5 on day 435, year 10 on 995, year 15 on 1555).
// A sample is taken on the first day of every year as well as every 30 days.
const yearMarks = (days) => { const m = [1]; for (let y = 2; yearStartDay(y) <= days; y++) m.push(yearStartDay(y)); return m; };

// Long runs (over two years): one table per style with a row per year. Hives, hordes and groups are read from the
// sample nearest the end of that year (runs still going then); events are counted over the year.
function yearByYear(results, days, groups, say) {
  const years = yearOfDay(days);
  const at = (r, d) => { let best = null; for (const s of r.samples) if (s.day <= d) best = s; return best; };
  say("## Year by year");
  say();
  say("When the victory conditions were first met (eras.js: the coalition holding over half the land with every group a member; every hive gone and none building), median day and runs; the victory then needs the Accord (a year held) or the containment (a season clear), and year 8 (eras.js WIN_FROM_YEAR):");
  say();
  say(table(["Style", "Coalition conditions first met", "Year", "Hives first all gone", "Year", "Victory (median day)", "Year"], groups.map(([s, L]) => {
    const a = L.map((r) => r.era && r.era.accordFirst).filter((v) => v != null), c = L.map((r) => r.era && r.era.clearFirst).filter((v) => v != null);
    const w = L.filter((r) => r.outcome === "hives" || r.outcome === "alliance").map((r) => r.endDay);
    const yr = (v) => (Number.isFinite(v) ? yearOfDay(Math.round(v)) : "–");
    return [s, `${f0(med(a))} (${a.length}/${L.length})`, yr(med(a)), `${f0(med(c))} (${c.length}/${L.length})`, yr(med(c)), `${f0(med(w))} (${w.length}/${L.length})`, yr(med(w))];
  })));
  say();

  say("Runs = still going at the start of the year. Fell / Hive win / Coalition win = runs that ended that way during the year. Pop, hives, hordes, groups: medians at the end of the year (runs still going then); \"Runs with ...\" = share of those runs. Hives built / destroyed: mean per run that year. Events per 100 run-days; horde size = median at the walls.");
  say();
  for (const [s, L] of groups) {
    say(`### ${s}`);
    say();
    const rows = [];
    for (let y = 1; y <= years; y++) {
      const a = yearStartDay(y), b = Math.min(days, yearStartDay(y + 1) - 1);
      const live = L.filter((r) => r.endDay >= a);
      const ended = (o) => L.filter((r) => r.outcome === o && r.endDay >= a && r.endDay <= b).length;
      const still = L.filter((r) => r.endDay >= b);
      let rd = 0, rg = 0, ro = 0, hh = 0, de = 0;
      for (const r of live) for (let d = a; d <= Math.min(b, r.endDay); d++) { rd++; rg += r.daily.raidG[d]; ro += r.daily.raidO[d]; hh += r.daily.hordeHit[d]; de += r.daily.death[d]; }
      const per = (v) => f1((100 * v) / Math.max(1, rd));
      const end = still.map((r) => at(r, b + 1)).filter(Boolean);
      const m = (k) => f0(med(end.map((x) => x[k]).filter(Number.isFinite)));
      const share = (fn) => (end.length ? pct(end.filter(fn).length, end.length) : "–");
      const diff = (k) => live.map((r) => { const e = at(r, b + 1), st = at(r, a); return e && st ? (e[k] || 0) - (st[k] || 0) : NaN; }).filter(Number.isFinite);
      const sz = live.flatMap((r) => r.hordeAttacks.filter((x) => x.day >= a && x.day <= b && x.size != null).map((x) => x.size));
      rows.push([`${y} (d${a})`, live.length, ended("fell"), ended("hives"), ended("alliance"), m("pop"), m("hives"), share((x) => x.hives > 0), f1(mean(diff("hivesBuilt"))), f1(mean(diff("hivesDestroyed"))),
        m("hordes"), m("dead"), per(hh), f0(med(sz)), per(rg), per(ro), m("groups"), m("agg"), share((x) => x.agg > 0), share((x) => x.aggHostile > 0), m("coalition"), f1(med(end.map((x) => x.land))), per(de)]);
    }
    say(table(["Year", "Runs", "Fell", "Hive win", "Coalition win", "Pop", "Hives", "Runs with hives", "Hives built", "Hives destroyed", "Hordes", "Dead on map", "Horde attacks", "Horde size", "Group raids", "Outsider raids", "Groups", "Aggressive groups", "Runs with aggressive", "... hostile to you", "Coalition", "Land %", "Deaths"], rows));
    say();
  }
}

function report(results, days) {
  const out = [];
  const say = (s = "") => out.push(s);
  const styles = [...new Set(results.map((r) => r.style))];
  const groups = [...styles.map((s) => [s, results.filter((r) => r.style === s)]), ["all", results]];
  for (const r of results) r.feel = feel(r);

  say(`## Outcomes (${results.length} runs, up to ${days} days)`);
  say();
  say(table(["Style", "Runs", "Fell", "Hive victory", "Alliance victory", "Survived to the end", "Crash"], groups.map(([s, L]) => [s, L.length,
    ...["fell", "hives", "alliance", "survived", "crash"].map((o) => `${L.filter((r) => r.outcome === o).length} (${pct(L.filter((r) => r.outcome === o).length, L.length)})`)])));
  say();
  const dayRow = (L) => { const a = L.map((r) => r.endDay); return a.length ? [a.length, f0(q(a, 0)), f0(q(a, 0.25)), f0(med(a)), f0(q(a, 0.75)), f0(q(a, 1))] : [0, "–", "–", "–", "–", "–"]; };
  say("Day the holdout fell (fallen runs only), and day of victory:");
  say();
  say(table(["Style", "Outcome", "n", "min", "Q1", "median", "Q3", "max"], groups.flatMap(([s, L]) => [
    [s, "fell", ...dayRow(L.filter((r) => r.outcome === "fell"))],
    [s, "victory", ...dayRow(L.filter((r) => r.outcome === "hives" || r.outcome === "alliance"))],
  ])));
  say();
  // Survival curve.
  const marks = (days > 730 ? yearMarks(days).slice(1).map((d) => d - 1) : [60, 120, 180, 270, 365, 450, 545, 730]).filter((m) => m <= days);
  say("Share of runs still going (not fallen) at each day:");
  say();
  say(table(["Style", ...marks.map((m) => `d${m}`)], groups.map(([s, L]) => [s, ...marks.map((m) => pct(L.filter((r) => !(r.outcome === "fell" && r.endDay <= m)).length, L.length))])));
  say();

  if (days > 730) yearByYear(results, days, groups, say);

  // Causes.
  say("## Deaths and desertions");
  say();
  const buckets = [...new Set(results.flatMap((r) => Object.keys(r.deathCauses)))].sort((a, b) => results.reduce((x, r) => x + (r.deathCauses[b] || 0), 0) - results.reduce((x, r) => x + (r.deathCauses[a] || 0), 0));
  say("Deaths per run by cause (mean), and the share of all deaths:");
  say();
  say(table(["Cause", ...groups.map(([s]) => s), "share"], buckets.map((b) => {
    const tot = results.reduce((x, r) => x + (r.deathCauses[b] || 0), 0), all = results.reduce((x, r) => x + r.deaths.length, 0);
    return [b, ...groups.map(([, L]) => f1(mean(L.map((r) => r.deathCauses[b] || 0)))), pct(tot, all)];
  })));
  say();
  say(table(["Style", "Deaths/run", "Desertions/run", "Peak pop (median)", "Peak day (median)", "Final pop of survivors (median)"], groups.map(([s, L]) => [s,
    f1(mean(L.map((r) => r.deaths.length))), f1(mean(L.map((r) => r.desertions))), f0(med(L.map((r) => r.peak))), f0(med(L.map((r) => r.peakDay))),
    f0(med(L.filter((r) => r.outcome !== "fell").map((r) => r.finalPop)))])));
  say();
  const fell = results.filter((r) => r.outcome === "fell");
  if (fell.length) {
    say("What took the last people in fallen runs (deaths and desertions in the final 30 days before the fall):");
    say();
    const last = {};
    for (const r of fell) {
      for (const dd of r.deaths) if (dd.day > r.endDay - 30) last[dd.bucket] = (last[dd.bucket] || 0) + 1;
      const des = r.daily.desert.slice(Math.max(0, r.endDay - 29)).reduce((a, b) => a + b, 0);
      if (des) last.desertion = (last.desertion || 0) + des;
    }
    const tot = Object.values(last).reduce((a, b) => a + b, 0);
    say(table(["Cause", "Losses", "Share"], Object.entries(last).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, pct(v, tot)])));
    say();
    // The run's last blow: the kind of event in the final 3 days.
    const blow = {};
    for (const r of fell) {
      const lo = Math.max(1, r.endDay - 3);
      const k = [];
      for (let d = lo; d <= r.endDay; d++) {
        if (r.daily.hordeHit[d]) k.push("horde attack");
        if (r.daily.raidG[d] + r.daily.raidO[d]) k.push("raid");
        if (r.daily.hungry[d] || r.daily.thirsty[d]) k.push("hunger/thirst");
        if (r.daily.desert[d]) k.push("desertion");
      }
      const key = [...new Set(k)].sort().join(" + ") || "other (sickness, field losses, wounds)";
      blow[key] = (blow[key] || 0) + 1;
    }
    say("Events in the last 3 days of fallen runs:");
    say();
    say(table(["Events", "Runs"], Object.entries(blow).sort((a, b) => b[1] - a[1])));
    say();
    say("Snowball check: population and threats before the fall:");
    say();
    say(table(["Style", "Fallen", "Peak pop (median)", "Days from peak to fall (median)", "Days from first base loss* to fall (median)"], groups.map(([s, L]) => {
      const F = L.filter((r) => r.outcome === "fell");
      const firstLoss = F.map((r) => { const a = r.hordeAttacks.find((x) => x.result === "overrun"); const b = r.raids.find((x) => x.result === "overrun"); const d = Math.min(a ? a.day : 1e9, b ? b.resultDay : 1e9); return d < 1e9 ? r.endDay - d : NaN; }).filter(Number.isFinite);
      return [s, F.length, f0(med(F.map((r) => r.peak))), f0(med(F.map((r) => r.endDay - r.peakDay))), firstLoss.length ? `${f0(med(firstLoss))} (${firstLoss.length} runs)` : "–"];
    })));
    say();
    say("*first time a horde or raid overran one of your bases.");
    say();
  }
  // Population by day for fallen vs surviving.
  const pAt = (r, d) => { const s = r.samples.filter((x) => x.day <= d); return s.length && !(r.outcome === "fell" && r.endDay < d) ? s[s.length - 1].pop : NaN; };
  say("Median population at each sample (runs still going at that day):");
  say();
  const pmarks = (days > 730 ? yearMarks(days) : [1, 31, 61, 91, 121, 181, 271, 361, 451, 541, 631, 721]).filter((m) => m <= days);
  say(table(["Style", ...pmarks.map((m) => `d${m}`)], groups.map(([s, L]) => [s, ...pmarks.map((m) => f0(med(L.map((r) => pAt(r, m)).filter(Number.isFinite))))])));
  say();
  if (fell.length) {
    say(table(["Pop at day 61 / 121", "Fell later", "Did not fall"], [61, 121].filter((m) => m <= days).map((m) => [`d${m}`,
      f0(med(results.filter((r) => r.outcome === "fell" && r.endDay > m).map((r) => pAt(r, m)).filter(Number.isFinite))),
      f0(med(results.filter((r) => r.outcome !== "fell").map((r) => pAt(r, m)).filter(Number.isFinite)))])));
    say();
  }

  // Pressure by phase.
  const long = days > 730; // long runs: one row a game year
  say(`## Pressure by ${long ? "game year" : "30-day phase"}`);
  say();
  say("Per 100 run-days (only runs still going count), all styles together unless named. Raids = warning cards (AI groups + outsiders); horde attacks = a horde reaching one of your bases; cards = every card the player would see; decisions = cards with two or more choices; overlap = days with 2+ crisis kinds within a 3-day window.");
  say();
  const buckets30 = [];
  if (long) for (let y = 1; yearStartDay(y) <= days; y++) buckets30.push([yearStartDay(y), Math.min(days, yearStartDay(y + 1) - 1)]);
  else for (let s = 1; s <= days; s += 30) buckets30.push([s, Math.min(days, s + 29)]);
  const phaseRows = (L) => buckets30.map(([a, b]) => {
    let rd = 0, raids = 0, out = 0, hh = 0, hw = 0, de = 0, ds = 0, cards = 0, dec = 0, team = 0, ov = 0, hu = 0, ill = 0, live = 0;
    for (const r of L) {
      if (r.endDay < a) continue;
      live++;
      for (let d = a; d <= Math.min(b, r.endDay); d++) {
        rd++;
        raids += r.daily.raidG[d]; out += r.daily.raidO[d]; hh += r.daily.hordeHit[d]; hw += r.daily.hordeWarn[d]; de += r.daily.death[d]; ds += r.daily.desert[d];
        cards += r.daily.cards[d]; dec += r.daily.decisions[d]; team += r.daily.teamCards[d]; ov += r.feel.overlap[d] >= 2 ? 1 : 0;
        hu += r.daily.hungry[d] || r.daily.thirsty[d] ? 1 : 0; ill += r.daily.outbreak[d] + r.daily.illness[d];
      }
    }
    const per = (v) => f1((100 * v) / Math.max(1, rd));
    return [`${a}–${b}`, live, per(raids), per(out), per(hh), per(hw), per(de), per(ds), per(ill), f1(cards / Math.max(1, rd)), f1(dec / Math.max(1, rd)), f1((cards - team) / Math.max(1, rd)), pct(ov, rd), pct(hu, rd)];
  });
  const phaseHead = ["Days", "Runs", "Group raids", "Outsider raids", "Horde attacks", "Horde warnings", "Deaths", "Desertions", "Serious illness", "Cards/day", "Decisions/day", "Base cards/day", "Overlap days", "Hungry/thirsty days"];
  for (const [s, L] of groups) {
    say(`### ${s}`);
    say();
    say(table(phaseHead, phaseRows(L)));
    say();
  }

  // Feel.
  say("## Feel: first threats, quiet stretches, overlap");
  say();
  const fs = (L, k) => { const a = L.map((r) => r.firstSeen[k]).filter((v) => v != null); return `${f0(med(a))} (${a.length}/${L.length})`; };
  say("First time each thing happens (median day, and in how many runs it happened at all):");
  say();
  say(table(["Style", "First death", "First raid warning", "First horde warning", "First horde at a base", "First horde break-in", "First base overrun by the dead", "First desertion"], groups.map(([s, L]) => [s,
    fs(L, "death"), fs(L, "raid"), fs(L, "hordeWarn"), fs(L, "hordeHit"), fs(L, "hordeBreakIn"), fs(L, "hordeOverrun"), fs(L, "desertion")])));
  say();
  const gap = (L, a, b) => { // mean days between raids + horde attacks between day a and b
    let rd = 0, ev = 0;
    for (const r of L) for (let d = a; d <= Math.min(b, r.endDay); d++) { rd++; ev += r.daily.raidG[d] + r.daily.raidO[d] + r.daily.hordeHit[d]; }
    return ev ? f1(rd / ev) : "never";
  };
  say("Average days between big threats (a raid warning or a horde at the walls), per phase:");
  say();
  const gp = (days > 730 ? [[1, 2], [3, 4], [5, 7], [8, 10], [11, 15], [16, 99]].map(([a, b]) => [yearStartDay(a), yearStartDay(b + 1) - 1]) : [[1, 60], [61, 150], [151, 365], [366, 730]]).filter(([a]) => a <= days);
  say(table(["Style", ...gp.map(([a, b]) => `d${a}–${Math.min(b, days)}`)], groups.map(([s, L]) => [s, ...gp.map(([a, b]) => gap(L, a, b))])));
  say();
  say(table(["Style", "Cards/day (mean)", "Cards/day (p90 day)", "Busiest day (max)", "Decisions/day", "Overlap days (2+ crises in 3 days)", "3+ crises", "Longest stretch with no card (median / max)", "No decision card", "No threat at all (median / max)"], groups.map(([s, L]) => {
    const all = L.flatMap((r) => r.daily.cards.slice(1));
    const dec = L.flatMap((r) => r.daily.decisions.slice(1));
    const rd = L.reduce((a, r) => a + r.endDay, 0);
    return [s, f1(mean(all)), f0(q(all, 0.9)), Math.max(...all), f1(mean(dec)),
      pct(L.reduce((a, r) => a + r.feel.overlapDays, 0), rd), pct(L.reduce((a, r) => a + r.feel.overlap3, 0), rd),
      `${f0(med(L.map((r) => r.feel.quietCard)))} / ${Math.max(...L.map((r) => r.feel.quietCard))}`,
      `${f0(med(L.map((r) => r.feel.quietDecision)))} / ${Math.max(...L.map((r) => r.feel.quietDecision))}`,
      `${f0(med(L.map((r) => r.feel.quietThreat)))} / ${Math.max(...L.map((r) => r.feel.quietThreat))}`];
  })));
  say();
  const dist = {};
  for (const r of results) for (const c of r.daily.cards.slice(1)) { const k = c >= 10 ? "10+" : String(c); dist[k] = (dist[k] || 0) + 1; }
  const totDays = Object.values(dist).reduce((a, b) => a + b, 0);
  say("Cards per day, distribution over every run-day:");
  say();
  say(table(["Cards", ...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10+"]], [["Share of days", ...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10+"].map((k) => pct(dist[k] || 0, totDays))]]));
  say();
  const titles = {};
  for (const r of results) for (const [k, v] of Object.entries(r.titles)) titles[k] = (titles[k] || 0) + v;
  const rdAll = results.reduce((a, r) => a + r.endDay, 0);
  say("Most common cards (per 100 run-days):");
  say();
  say(table(["Card", "Count", "Per 100 days"], Object.entries(titles).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k.replace(/\|/g, "/"), v, f1((100 * v) / rdAll)])));
  say();

  // Hordes and attacks.
  say("## Hives, hordes and attacks on your bases");
  say();
  say(table(["Style", "Hives at start", "Hive sites picked", "Hives built", "Hives destroyed", "Hordes made", "Border hordes", "Horde warnings", "Horde attacks/run", "Held at the walls", "Spike pits", "Broke in → repelled", "Broke in → overrun", "At outposts"], groups.map(([s, L]) => {
    const A = L.flatMap((r) => r.hordeAttacks);
    const c = (k) => A.filter((a) => a.result === k).length;
    return [s, f1(mean(L.map((r) => r.hive.startHives))), f1(mean(L.map((r) => r.hive.sites))), f1(mean(L.map((r) => r.hive.built))), f1(mean(L.map((r) => r.hive.destroyed))),
      f1(mean(L.map((r) => r.hive.hordes))), f1(mean(L.map((r) => r.hive.border))), f1(mean(L.map((r) => r.hive.warnings))), f1(A.length / L.length),
      pct(c("held"), A.length), pct(c("pits"), A.length), pct(c("repelled"), A.length), pct(c("overrun") + c("broke in"), A.length), pct(A.filter((a) => a.baseType === "outpost").length, A.length)];
  })));
  say();
  const sz = results.flatMap((r) => r.hordeAttacks.filter((a) => a.size != null).map((a) => a.size));
  say(`Horde sizes at the walls: median ${f0(med(sz))}, Q1 ${f0(q(sz, 0.25))}, Q3 ${f0(q(sz, 0.75))}, max ${f0(q(sz, 1))}. Attacks led by a Wallbreaker: ${results.flatMap((r) => r.hordeAttacks).filter((a) => a.boss).length} break-ins.`);
  say();
  say("Hive assaults by your teams (Destroy hive missions; only the Aggressive autopilot launches them):");
  say();
  say(table(["Style", "Assaults/run", "Runs with one", "First assault (median day)", "Hives destroyed/run", "Destroyed per assault"], groups.map(([s, L]) => {
    const a = L.reduce((x, r) => x + r.hiveAssaults.length, 0), k = L.reduce((x, r) => x + r.hivesDestroyed.length, 0);
    return [s, f1(a / L.length), L.filter((r) => r.hiveAssaults.length).length, f0(med(L.map((r) => r.hiveAssaults[0]).filter((v) => v != null))), f1(k / L.length), a ? f1(k / a) : "–"];
  })));
  say();
  const smarks = (days > 730 ? yearMarks(days) : [1, 91, 181, 271, 361, 451, 541, 631, 721]).filter((m) => m <= days);
  const sAt = (r, d, k) => { const s = r.samples.find((x) => x.day === d); return s ? s[k] : NaN; };
  const sampleTable = (title, k, fmt = f0) => {
    say(title);
    say();
    say(table(["Style", ...smarks.map((m) => `d${m}`)], groups.map(([s, L]) => [s, ...smarks.map((m) => fmt(med(L.map((r) => sAt(r, m, k)).filter(Number.isFinite))))])));
    say();
  };
  sampleTable("Hives standing (median, runs still going):", "hives");
  sampleTable("Hordes on the map (median count):", "hordes");
  sampleTable("Dead in hordes on the map (median total):", "dead");

  // Raids.
  say("## Raids on your bases");
  say();
  say(table(["Style", "Group raids/run", "Outsider raids/run", "Held", "Held in a fight", "Broke in", "Overrun", "Paid off", "Never arrived", "At outposts", "No warning card"], groups.map(([s, L]) => {
    const R = L.flatMap((r) => r.raids);
    const c = (k) => R.filter((x) => x.result === k).length;
    return [s, f1(mean(L.map((r) => r.raids.filter((x) => x.src === "group").length))), f1(mean(L.map((r) => r.raids.filter((x) => x.src === "outsider").length))),
      pct(c("held"), R.length), pct(c("held (fought)"), R.length), pct(c("broke in"), R.length), pct(c("overrun"), R.length), pct(c("paid"), R.length), pct(c("never arrived"), R.length), pct(R.filter((x) => x.baseType === "outpost").length, R.length), R.filter((x) => x.unwarned).length];
  })));
  say();
  const byType = {};
  for (const r of results) for (const x of r.raids) { const t = byType[x.type] || (byType[x.type] = { n: 0, over: 0, broke: 0 }); t.n++; if (x.result === "overrun") t.over++; if (x.result === "broke in") t.broke++; }
  say("Raids by attacker type:");
  say();
  say(table(["Attacker", "Raids", "Per run", "Broke in", "Overran"], Object.entries(byType).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, v.n, f1(v.n / results.length), pct(v.broke, v.n), pct(v.over, v.n)])));
  say();
  const unwarned = results.reduce((a, r) => a + r.raids.filter((x) => x.unwarned).length, 0);
  if (unwarned) say(`Raids that reached a base with no warning card: ${unwarned}.\n`);

  // AI groups.
  say("## The other groups and the coalition");
  say();
  say(table(["Style", "Wars started/run", "Peace deals/run", "Groups collapsed/run", "Median day of first collapse", "Coalition members (max, median)", "Runs with a coalition"], groups.map(([s, L]) => {
    const fc = L.map((r) => (r.collapses[0] ? r.collapses[0].day : NaN)).filter(Number.isFinite);
    return [s, f1(mean(L.map((r) => r.diplo.wars))), f1(mean(L.map((r) => r.diplo.peace))), f1(mean(L.map((r) => r.collapses.length))), f0(med(fc)), f0(med(L.map((r) => r.coalitionMax))), pct(L.filter((r) => r.coalitionMax > 0).length, L.length)];
  })));
  say();
  sampleTable("Groups still standing (median):", "groups");
  sampleTable("Wars going on (median):", "wars");
  sampleTable("Coalition members (median):", "coalition");
  sampleTable("Land held by you and the coalition, % (median):", "land", f1);

  // Stocks.
  say("## Stocks (all your bases together, median of runs still going)");
  say();
  for (const k of ["food", "water", "meds", "ammo"]) sampleTable(`${k[0].toUpperCase() + k.slice(1)}:`, k);
  say(table(["Style", "Days with a base out of food (mean/run)", "Out of water", "On short rations", "Runs that ever went hungry", "Runs that ever went thirsty"], groups.map(([s, L]) => [s,
    f1(mean(L.map((r) => r.daily.hungry.reduce((a, b) => a + b, 0)))), f1(mean(L.map((r) => r.daily.thirsty.reduce((a, b) => a + b, 0)))), f1(mean(L.map((r) => r.daily.shortRations.reduce((a, b) => a + b, 0)))),
    pct(L.filter((r) => r.daily.hungry.some((x) => x)).length, L.length), pct(L.filter((r) => r.daily.thirsty.some((x) => x)).length, L.length)])));
  say();
  const raw = {};
  for (const r of results) for (const [k, v] of Object.entries(r.deathRaw)) raw[k] = (raw[k] || 0) + v;
  say("Raw death causes (top 15):");
  say();
  say(table(["Cause", "Deaths"], Object.entries(raw).sort((a, b) => b[1] - a[1]).slice(0, 15)));
  say();
  return out.join("\n");
}

// ======================================================================================
// Main thread: run list, workers, report
// ======================================================================================
function parseArgs(argv) {
  const o = { days: 730, runs: 100, size: "normal", seeds: null, tune: "", styles: Object.keys(PERSONALITIES), workers: Math.max(1, Math.min(12, os.cpus().length - 2)), json: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--runs") o.runs = Number(argv[++i]);
    else if (a === "--seeds") {
      const v = argv[++i];
      const m = /^(\d+)-(\d+)$/.exec(v);
      o.seeds = m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, k) => +m[1] + k) : v.split(",").map(Number);
    } else if (a === "--styles") { const v = argv[++i]; o.styles = v === "all" ? Object.keys(PERSONALITIES) : v.split(","); }
    else if (a === "--workers") o.workers = Number(argv[++i]);
    else if (a === "--json") o.json = argv[++i];
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--tune") o.tune = argv[++i];
    else if (a === "--size" || /^(--)?size=/.test(a)) o.size = sizeDef(a.includes("=") ? a.split("=")[1] : argv[++i]).key;
    else if (WORLD_SIZES[a]) o.size = a;
    else if (/^\d+$/.test(a)) o.days = Number(a);
  }
  if (!o.seeds) o.seeds = Array.from({ length: Math.ceil(o.runs / o.styles.length) }, (_, k) => k + 1);
  const bad = o.styles.filter((s) => !PERSONALITIES[s]);
  if (bad.length) { console.log(`Unknown style ${bad.join(", ")}. Use ${Object.keys(PERSONALITIES).join(", ")} or all.`); process.exit(1); }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let specs = o.seeds.flatMap((seed) => o.styles.map((style) => ({ seed, style, days: o.days, size: o.size, tune: o.tune })));
  if (!process.argv.includes("--seeds") || process.argv.includes("--runs")) specs = specs.slice(0, o.runs);
  console.log(`Balance census: ${specs.length} autopilot runs, up to ${o.days} days, seeds ${o.seeds[0]}–${o.seeds[o.seeds.length - 1]}, styles ${o.styles.join("/")}, ${o.workers} worker(s)${o.size !== "normal" ? `, ${sizeDef(o.size).label} map` : ""}.`);
  const t0 = performance.now();
  const results = new Array(specs.length);
  let next = 0, done = 0;
  const line = (r) => `${r.style.padEnd(10)} seed ${String(r.seed).padEnd(3)} ${r.outcome.padEnd(8)} day ${String(r.endDay).padEnd(4)} peak ${String(r.peak).padEnd(3)} deaths ${String(r.deaths.length).padEnd(3)} left ${String(r.desertions).padEnd(2)} raids ${String(r.raids.length).padEnd(3)} hordes@walls ${String(r.hordeAttacks.length).padEnd(3)} hives ${r.hive.startHives}→${r.samples[r.samples.length - 1].hives} ${(r.ms / 1000).toFixed(1)}s${r.problems.length ? `  PROBLEMS ${r.problems.length}: ${r.problems[0]}` : ""}`;
  await new Promise((resolve, reject) => {
    const n = Math.min(o.workers, specs.length);
    let live = n;
    for (let w = 0; w < n; w++) {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: "balancesim" });
      const feed = () => { if (next < specs.length) { const i = next++; worker.postMessage({ i, spec: specs[i] }); } else { worker.terminate(); if (--live === 0) resolve(); } };
      worker.on("message", ({ i, r }) => { results[i] = r; done++; if (!o.quiet) console.log(`[${String(done).padStart(3)}/${specs.length}] ${line(r)}`); feed(); });
      worker.on("error", reject);
      feed();
    }
  });
  console.log(`\nDone in ${((performance.now() - t0) / 1000).toFixed(0)}s.\n`);
  const text = report(results, o.days);
  console.log(text);
  const problems = results.flatMap((r) => r.problems.map((p) => `${r.style} seed ${r.seed}: ${p}`));
  console.log(`\nProblems: ${problems.length}`);
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  if (o.json) {
    writeFileSync(o.json, JSON.stringify({ days: o.days, runs: results }, null, 0));
    console.log(`Wrote ${o.json}`);
  }
  if (problems.length) process.exitCode = 1;
}

// Run as a tool; another tool may import runCampaign without starting it.
const asTool = () => { try { return realpathSync(process.argv[1] || "").toLowerCase() === realpathSync(fileURLToPath(import.meta.url)).toLowerCase(); } catch { return false; } };
if (isMainThread && asTool()) main();
else if (!isMainThread && workerData === "balancesim") parentPort.on("message", ({ i, spec }) => parentPort.postMessage({ i, r: runCampaign(spec) }));
