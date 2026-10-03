// Headless autopilot test: runs campaigns with the AI governor (sim/autopilot.js) in charge of the holdout and
// compares them with simtest.js's simple auto-player on the same seeds. Reports days survived, population,
// buildings, outposts, trips launched, cards resolved and hub stock, and checks for crashes, cards left
// unanswered and teams stuck with nothing to resolve.
// Usage: node tools/autotest.js [days] [cautious|balanced|aggressive|all] [seeds...]
import { createWorld, tickHour, day, alive, hub } from "../src/sim/world.js";
import { launchExpedition, estimateTrip, startReturn } from "../src/sim/parties.js";
import { searchHour, extract } from "../src/sim/scavenge.js";
import { executeTrade, endTrade } from "../src/sim/trade.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { setAutopilot, autopilotStats, autopilotResolve, PERSONALITIES } from "../src/sim/autopilot.js";

const days = Number(process.argv[2] || 120);
const which = process.argv[3] || "balanced";
const seeds = process.argv.length > 4 ? process.argv.slice(4).map(Number) : [1, 2, 3, 4, 5];
const styles = which === "all" ? Object.keys(PERSONALITIES) : [which];
if (styles.some((s) => !PERSONALITIES[s])) {
  console.log(`Unknown style "${which}". Use ${Object.keys(PERSONALITIES).join(", ")} or all.`);
  process.exit(1);
}
const FACTIONS = 8;

// simtest.js's auto-player (kept in step with tools/simtest.js): first enabled choice or "Return home",
// three search hours, teams home, a 2-person scavenging trip every 6 days.
function simtestAutoplay(state, m) {
  while (state.cards.length) {
    const c = state.cards.shift();
    const ch = c.choices.find((x) => x.label === "Return home") || c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled));
    if (ch) ch.resolve(state);
    m.cards++;
  }
  if (state.engagement) {
    if (!state.engagement.approach) state.engagement.approach = "normal";
    if (state.engagement.hours < 3 && state.engagement.heat < 50) {
      searchHour(state);
      tickHour(state);
    } else extract(state);
  }
  if (state.trade) {
    executeTrade(state);
    endTrade(state);
  }
  for (const p of state.parties) if (p.owner === "player" && p.phase === "waiting") startReturn(state, p);
  if (state.hour % (24 * 6) === 12 && !state.parties.some((p) => p.owner === "player")) {
    const h = hub(state);
    const people = alive(state).filter((s) => s.location.kind === "base" && s.location.baseId === h.id).slice(0, 2);
    const targets = state.tiles.filter((t) => t.loc && state.grid.distance(t.id, h.tile) <= 8 && t.id !== h.tile);
    const dest = state.rng.pick(targets).id;
    const est = estimateTrip(state, { memberIds: people.map((s) => s.id), dest, vehicle: false, stance: "normal" });
    if (est && people.length) {
      const res = launchExpedition(state, {
        memberIds: people.map((s) => s.id), dest, mission: "scavenge", stance: "normal",
        supplies: { food: Math.min(h.stock.food, est.food + 2), water: Math.min(h.stock.water, est.water + 2), ammo: Math.min(h.stock.ammo, 20) },
      });
      if (!res.error) m.launched++;
    }
  }
}

function run(seed, style) {
  const state = createWorld({ seed, factionCount: FACTIONS });
  state.started = true;
  const m = { seed, style: style || "simtest", cards: 0, launched: 0, peak: alive(state).length, problems: [], ms: 0 };
  if (style) setAutopilot(state, true, style);
  const engagedSince = new Map();
  const t0 = performance.now();
  try {
    while (day(state) <= days && !state.gameOver) {
      tickHour(state);
      if (!style) simtestAutoplay(state, m);
      m.peak = Math.max(m.peak, alive(state).length);
      if (!style) continue;
      if (state.cards.length) m.problems.push(`day ${day(state)}: ${state.cards.length} card(s) left open (${state.cards[0].title})`);
      // Stuck: halted with nothing that could move it on.
      for (const p of state.parties) {
        if (p.owner !== "player" || p.phase !== "engaged") { engagedSince.delete(p.id); continue; }
        const pending = state.cards.some((c) => c.partyId === p.id) || (state.engagement && state.engagement.partyId === p.id) || (state.trade && state.trade.partyId === p.id);
        if (pending) { engagedSince.delete(p.id); continue; }
        const since = engagedSince.get(p.id) ?? state.hour;
        engagedSince.set(p.id, since);
        if (state.hour - since > 48) { m.problems.push(`day ${day(state)}: team ${p.id} stuck (${p.mission})`); engagedSince.delete(p.id); }
      }
      if (m.problems.length > 20) break;
    }
  } catch (e) {
    m.problems.push(`CRASH day ${day(state)}: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
  }
  m.ms = performance.now() - t0;
  const h = hub(state);
  const people = state.survivors;
  m.day = state.gameOver ? day(state) : Math.min(day(state) - 1, days);
  m.gameOver = state.gameOver && !state.victory;
  m.victory = !!state.victory;
  m.alive = alive(state).length;
  m.dead = people.filter((s) => !s.alive && !s.left).length;
  m.left = people.filter((s) => s.left).length;
  m.captives = people.filter((s) => s.alive && s.location.kind === "captive").length;
  m.saved = state.stats.peopleSaved;
  m.raids = state.stats.raidsRepelled;
  m.outposts = state.bases.filter((b) => b.type === "outpost").length;
  m.buildings = h ? h.buildings.length : 0;
  m.notable = h ? [...new Set(h.buildings.map((b) => b.type))].filter((t) => !["farm_plot", "bunkhouse", "walls", "ammo_bench"].includes(t)).map((t) => BUILDINGS[t].name) : [];
  m.stock = h ? Object.fromEntries(Object.entries(h.stock).map(([k, v]) => [k, Math.floor(v)])) : {};
  if (style) {
    const s = autopilotStats(state);
    Object.assign(m, { cards: s.cards, launched: s.launched, gov: s });
  }
  return m;
}

const pad = (v, n) => String(v).padEnd(n);
const line = (m) => `${pad(m.style, 10)} seed ${pad(m.seed, 4)} day ${pad(m.day + (m.gameOver ? "✝" : m.victory ? "★" : ""), 5)} alive ${pad(m.alive, 3)} (peak ${pad(m.peak, 3)}) dead ${pad(m.dead, 3)} left ${pad(m.left, 2)} held ${pad(m.captives, 2)} ` +
  `bldg ${pad(m.buildings, 3)} outposts ${pad(m.outposts, 2)} trips ${pad(m.launched, 3)} cards ${pad(m.cards, 4)} raids held ${pad(m.raids, 2)} ` +
  `stock food ${pad(m.stock.food, 4)} meds ${pad(m.stock.meds, 3)} scrap ${pad(m.stock.scrap, 4)} parts ${pad(m.stock.parts, 3)} ammo ${pad(m.stock.ammo, 4)} ${Math.round(m.ms)}ms`;

const results = { simtest: [] };
for (const st of styles) results[st] = [];
let problems = 0;
for (const seed of seeds) {
  const base = run(seed, null);
  results.simtest.push(base);
  console.log(line(base));
  for (const st of styles) {
    const m = run(seed, st);
    results[st].push(m);
    console.log(line(m));
    const g = m.gov;
    console.log(`           governor: built ${g.builds}, crafted ${g.crafts}, equipped ${g.equipped}, treated ${g.treated}, search hours ${g.searches} (${g.extractions} searches), supply runs ${g.supplyRuns}, outposts founded ${g.outposts}, trades ${g.trades}, role changes ${g.roleChanges}`);
    if (m.notable.length) console.log(`           hub also has: ${m.notable.join(", ")}`);
    for (const p of m.problems.slice(0, 5)) console.log(`           PROBLEM ${p}`);
    problems += m.problems.length;
  }
}

console.log(`\nAverages over ${seeds.length} seeds, ${days} days:`);
const avg = (list, f) => (list.reduce((a, m) => a + f(m), 0) / list.length).toFixed(1);
for (const [k, list] of Object.entries(results)) {
  console.log(`${pad(k, 10)} survived ${avg(list, (m) => m.day)} days (${list.filter((m) => m.gameOver).length} fell), alive ${avg(list, (m) => m.alive)}, peak ${avg(list, (m) => m.peak)}, dead ${avg(list, (m) => m.dead)}, left ${avg(list, (m) => m.left)}, ` +
    `buildings ${avg(list, (m) => m.buildings)}, outposts ${avg(list, (m) => m.outposts)}, trips ${avg(list, (m) => m.launched)}, cards ${avg(list, (m) => m.cards)}, ` +
    `food ${avg(list, (m) => m.stock.food || 0)}, meds ${avg(list, (m) => m.stock.meds || 0)}, scrap ${avg(list, (m) => m.stock.scrap || 0)}, parts ${avg(list, (m) => m.stock.parts || 0)}, ammo ${avg(list, (m) => m.stock.ammo || 0)}`);
}
// Takeover check on the browser code paths (live battles, interactive raids): switch the autopilot on while a raid
// battle is open, play 10 days the way main.js does (resolve pending cards every frame, tick), switch it off.
function takeover(seed) {
  const out = [];
  globalThis.window = globalThis.window || {};
  try {
    const state = createWorld({ seed, factionCount: FACTIONS });
    state.started = true;
    const h = hub(state);
    const crew = alive(state).slice(1, 3).map((s) => s.id);
    const site = state.tiles.filter((t) => t.loc && t.id !== h.tile).sort((a, b) => state.grid.distance(a.id, h.tile) - state.grid.distance(b.id, h.tile))[0];
    launchExpedition(state, { memberIds: crew, dest: site.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 30 } });
    for (let i = 0; i < 72 && !state.combat; i++) {
      tickHour(state);
      while (state.cards.length) state.cards.shift().choices.find((c) => !c.uiAction).resolve(state); // the player clicks through
    }
    if (!state.combat) out.push("no live battle opened to take over");
    setAutopilot(state, true, "balanced");
    if (state.combat) out.push("the open battle was not finished on takeover");
    if (!state.autoCombat) out.push("autoCombat not set while on");
    const hour0 = state.hour;
    while (state.hour < hour0 + 240 && !state.gameOver) {
      autopilotResolve(state); // main.js frame
      tickHour(state);
      if (state.cards.length || state.trade || state.combat) out.push(`day ${day(state)}: left open after a tick (${state.cards[0] ? state.cards[0].title : state.trade ? "trade" : "battle"})`);
      if (!state.autopilot) { out.push("the autopilot switched itself off (error?)"); break; }
    }
    const teams = state.parties.filter((p) => p.owner === "player").length;
    setAutopilot(state, false);
    if (state.autoCombat) out.push("autoCombat not restored when switched off");
    if (state.parties.filter((p) => p.owner === "player").length !== teams) out.push("teams changed when switched off");
    console.log(`Takeover check (seed ${seed}, browser paths): ${out.length ? out.join("; ") : "ok"} · ${teams} team(s) out at hand-back, ${autopilotStats(state).launched} launched, ${autopilotStats(state).cards} cards`);
  } catch (e) {
    out.push(`CRASH: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
    console.log(`Takeover check (seed ${seed}): ${out.join("; ")}`);
  }
  delete globalThis.window;
  return out.length;
}
problems += takeover(seeds[0]);

console.log(`Problems: ${problems}`);
if (problems) process.exitCode = 1;
