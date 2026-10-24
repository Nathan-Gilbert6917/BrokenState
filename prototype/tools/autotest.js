// Headless autopilot test: runs campaigns with the AI governor (sim/autopilot.js) in charge of the holdout and
// compares them with simtest.js's simple auto-player on the same seeds. Reports days survived, population,
// buildings, outposts, trips launched, cards resolved and hub stock, and checks for crashes, cards left
// unanswered and teams stuck with nothing to resolve. Then a takeover check (browser paths) and a relay check (the
// governor raises a radio relay at an outpost that brings a known group into reach, none where it would not link).
// Usage: node tools/autotest.js [days] [cautious|balanced|aggressive|all] [seeds...] [size=small|normal|large|huge]
// (Normal by default; other sizes play with their default group count, sim/worldsize.js.)
// Quick form (BS_QUICK=1, npm run test:quick): 40 days on seeds 1 and 2 (the full form: 120 days on seeds 1-5), the
// arrows check's trips over 20 days instead of 30; the same checks otherwise.
import { stockTools } from "./toolset.js"; // every tool a build or recipe can need (toolreqs.js)
import { createWorld, tickHour, day, alive, hub, newId, RADIO_RANGE, atBase, usesArrows, archerCount, ARROWS } from "../src/sim/world.js";
import { launchExpedition, estimateTrip, startReturn, partyMembers } from "../src/sim/parties.js";
import { newItem } from "../src/sim/inventory.js";
import { craftQueue } from "../src/sim/crafting.js";
import { GEAR } from "../src/sim/data.js";
const GEAR_SLOT = (it) => (GEAR[it.key] ? GEAR[it.key].slot : null);
import { searchHour, extract } from "../src/sim/scavenge.js";
import { executeTrade, endTrade } from "../src/sim/trade.js";
import { BUILDINGS, addBuilding } from "../src/sim/buildings.js";
import { setAutopilot, autopilotStats, autopilotResolve, PERSONALITIES, governBase } from "../src/sim/autopilot.js";
import { canRadioGroup, relayReach, radioSummary, RELAY_RANGE, GROUP_REACH } from "../src/sim/radio.js";
import { unlockAll } from "../src/sim/blueprints.js";
import { worksAt } from "../src/sim/groupworks.js"; // a group's radio station (radio.js groupHasSet)
import { sizeDef } from "../src/sim/worldsize.js";
import { takeSize } from "./sizearg.js";

const SIZE = takeSize();

const QUICK = !!process.env.BS_QUICK;
const days = Number(process.argv[2] || (QUICK ? 40 : 120));
const which = process.argv[3] || "balanced";
const seeds = process.argv.length > 4 ? process.argv.slice(4).map(Number) : QUICK ? [1, 2] : [1, 2, 3, 4, 5];
const styles = which === "all" ? Object.keys(PERSONALITIES) : [which];
if (styles.some((s) => !PERSONALITIES[s])) {
  console.log(`Unknown style "${which}". Use ${Object.keys(PERSONALITIES).join(", ")} or all.`);
  process.exit(1);
}
const FACTIONS = SIZE === "normal" ? 8 : sizeDef(SIZE).defGroups;

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
  const state = createWorld({ seed, factionCount: FACTIONS, size: SIZE });
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
      if (state.cards.length && !state.gameOver) m.problems.push(`day ${day(state)}: ${state.cards.length} card(s) left open (${state.cards[0].title})`); // a fallen holdout answers nothing more
      // Stuck: halted with nothing that could move it on.
      for (const p of state.parties) {
        if (p.owner !== "player" || p.phase !== "engaged") { engagedSince.delete(p.id); continue; }
        // A hive crawl in progress (hivecrawl.js p.hiveCrawl) is engaged for days by design: stuck only once its own log stops for a day.
        const crawl = p.hiveCrawl && p.hiveCrawl.log && p.hiveCrawl.log.length && state.hour - p.hiveCrawl.log[p.hiveCrawl.log.length - 1].hour <= 24;
        const pending = crawl || state.cards.some((c) => c.partyId === p.id) || (state.engagement && state.engagement.partyId === p.id) || (state.trade && state.trade.partyId === p.id);
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

if (SIZE !== "normal") console.log(`World size: ${sizeDef(SIZE).label} (${sizeDef(SIZE).w}×${sizeDef(SIZE).h}), ${FACTIONS} groups.`);
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
    const state = createWorld({ seed, factionCount: FACTIONS, size: SIZE });
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

// Radio relays (buildWishes, radio.js relayReach): with the hub's station on the air, an outpost 9-11 tiles out and a
// known group 9-12 tiles past it (out of the station's 12 + 6), the governor raises a relay at the outpost (it
// brings the group into reach for the coalition), never one at the station's base, nor one at an outpost the
// station does not reach (it would not link), and none once the group is in reach.
function relayCheck(seed) {
  const out = [];
  try {
    const state = createWorld({ seed, factionCount: FACTIONS, size: SIZE });
    state.started = true;
    setAutopilot(state, true, "balanced");
    unlockAll(state); // the Radio Engineering Handbook studied
    const h = hub(state);
    const g = state.grid;
    addBuilding(h, "radio");
    const free = (t, a, b, from, ok = () => true) => { const d = g.distance(from, t.id); return d >= a && d <= b && t.terrain !== "water" && t.terrain !== "mountain" && !t.hive && t.owner == null && !state.bases.some((x) => x.tile === t.id) && !state.factions.some((f) => f.bases.includes(t.id)) && ok(t); };
    const oT = state.tiles.find((t) => free(t, 9, 11, h.tile) && state.tiles.some((u) => free(u, 9, 12, t.id, () => g.distance(u.id, h.tile) > RADIO_RANGE + 2 + GROUP_REACH)));
    if (!oT) return console.log(`Relay check (seed ${seed}): no spot found (skipped)`), 0;
    const fT = state.tiles.find((u) => free(u, 9, 12, oT.id, () => g.distance(u.id, h.tile) > RADIO_RANGE + 2 + GROUP_REACH));
    const f = state.factions.find((x) => x.alive && x.bases.length);
    f.bases = [fT.id]; f.known = true; f.goodwill = 60; f.pact = "trade";
    worksAt(f, fT.id).radio = 1; // a station of their own: a link needs a set on both sides (radio.js groupHasSet, envoys 5feada9)
    for (const x of state.factions) if (x !== f) x.known = false;
    const o = { id: newId(), tile: oT.id, type: "outpost", name: "Relay Hill", stock: { food: 80, water: 80, fuel: 10, meds: 2, ammo: 20, parts: 6, scrap: 80 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
    state.bases.push(o);
    stockTools(o); // a drill, wrenches and pliers for the relay (toolreqs.js); the radio's reach is the subject here
    for (const t of ["farm_plot", "well", "rain_catcher", "boiler", "cookhouse"]) addBuilding(o, t); // the outpost's first wishes met
    const crew = alive(state).filter((s) => s.location.kind === "base").slice(0, 2);
    crew[0].skills.mechanics = 5;
    for (const s of crew) s.location = { kind: "base", baseId: o.id };
    // At the hub (its station covers more): no relay, ever.
    for (let i = 0; i < 6; i++) { governBase(state, h, { building: true }); h.construction.length = 0; }
    if (h.buildings.some((b) => b.type === "relay")) out.push("a relay was built beside the hub's station");
    // At the outpost: up to 8 build rounds, each queued job finished at once; a relay among them.
    let relay = false, farOk = "";
    for (let i = 0; i < 8 && !relay; i++) {
      governBase(state, o, { building: true });
      for (const c of o.construction) { addBuilding(o, c.type); if (c.type === "relay") relay = true; }
      o.construction.length = 0;
    }
    if (!relay) out.push(`no relay at the outpost (${radioSummary(state, o)}; ${relayReach(state, o).map((x) => x.name).join(", ") || "it would reach nobody"})`);
    else if (!canRadioGroup(state, f)) out.push("the relay went up but the group is still out of reach");
    // An outpost beyond the station's own range: a relay there would not link, so none goes up.
    const fT2 = state.tiles.find((t) => free(t, RADIO_RANGE + 3, RADIO_RANGE + 5, h.tile, (x) => g.distance(x.id, o.tile) > RELAY_RANGE + 2));
    if (fT2) {
      const o2 = { ...o, id: newId(), tile: fT2.id, name: "Far Ridge", stock: { ...o.stock }, buildings: [], construction: [], armory: [] };
      state.bases.push(o2);
      for (const t of ["farm_plot", "well", "rain_catcher", "boiler", "cookhouse"]) addBuilding(o2, t);
      crew[1].skills.mechanics = 5; crew[1].location = { kind: "base", baseId: o2.id };
      const f2 = state.factions.find((x) => x !== f && x.alive && x.bases.length);
      if (f2) {
        f2.bases = [state.tiles.find((t) => free(t, 7, 11, o2.tile, (x) => g.distance(x.id, h.tile) > RADIO_RANGE + 2 + GROUP_REACH && g.distance(x.id, o.tile) > RELAY_RANGE + GROUP_REACH))?.id ?? f2.bases[0]];
        f2.known = true; f2.goodwill = 60; worksAt(f2, f2.bases[0]).radio = 1; // a set of their own, as above
        for (let i = 0; i < 8; i++) { governBase(state, o2, { building: true }); for (const c of o2.construction) addBuilding(o2, c.type); o2.construction.length = 0; }
        if (o2.buildings.some((b) => b.type === "relay")) out.push("a relay went up at an outpost the station does not reach (it cannot link)");
        else farOk = `none at ${o2.name}, ${g.distance(o2.tile, h.tile)} tiles out (built: ${o2.buildings.slice(5).map((b) => b.type).join(", ") || "nothing"})`;
      }
    }
    console.log(`Relay check (seed ${seed}): ${out.length ? out.join("; ") : `ok (a relay at ${o.name}, ${g.distance(o.tile, h.tile)} tiles out, for ${f.name} ${g.distance(f.bases[0], h.tile)} out; ${farOk || "no far outpost tried"})`}`);
  } catch (e) {
    out.push(`CRASH: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
    console.log(`Relay check (seed ${seed}): ${out.join("; ")}`);
  }
  return out.length;
}
problems += relayCheck(seeds[0]);

// Bows and arrows (world.js ARROWS, usesArrows): with bows and no arrows the governor queues arrows first thing (a bow
// with none fights with its fists), and every trip it sends with a bow on it packs a dozen arrows a bow (launchTrip,
// the crews), not only hunting trips.
function arrowsCheck(seed) {
  const out = [];
  try {
    const st = createWorld({ seed, factionCount: FACTIONS, size: SIZE });
    st.started = true;
    setAutopilot(st, true, "balanced");
    const h = hub(st);
    const home = atBase(st, h.id);
    for (const s of home) { s.gear.weapon = newItem("compbow"); s.skills.shooting = Math.max(s.skills.shooting, 6); }
    check(home.every(usesArrows), "everyone at the hub shoots a bow");
    h.stock.arrows = 0; h.stock.wood = 400; h.stock.scrap = 120;
    craftQueue(h).length = 0;
    h.armory = h.armory.filter((it) => !it || GEAR_SLOT(it) !== "weapon"); // no guns to swap the bows for
    stockTools(h); // its tools back (the hub's shovel and hatchet went with the weapons): a base with none makes makeshift ones first (toolreqs.js basicToolWanted, e33cfa7)
    for (let k = 0; k < 3; k++) governBase(st, h, { production: true }); // one craft queued a call (water filters first)
    if (!craftQueue(h).some((j) => j.recipe === "arrows")) out.push(`no arrows queued for ${home.length} bows with none (queue: ${craftQueue(h).map((j) => j.recipe).join(", ") || "empty"})`);
    // Packing: plenty of arrows at the hub; the governor's trips over 30 days.
    h.stock.arrows = 400;
    const seen = new Set();
    let bowTrips = 0, packed = 0;
    const short = [];
    for (let i = 0; i < 24 * (QUICK ? 20 : 30) && !st.gameOver; i++) {
      tickHour(st);
      for (const p of st.parties) {
        if (p.owner !== "player" || seen.has(p.id)) continue;
        seen.add(p.id);
        const n = archerCount(partyMembers(st, p));
        if (!n) continue;
        bowTrips++;
        if ((p.supplies.arrows || 0) >= ARROWS.PACK * n) packed++;
        else short.push(`${p.mission || "trip"}: ${n} bow(s), ${p.supplies.arrows || 0} arrows`);
      }
    }
    if (!bowTrips) out.push(`no trip with a bow in ${QUICK ? 20 : 30} days`);
    else if (packed < bowTrips * 0.75) out.push(`only ${packed} of ${bowTrips} trips with bows packed a dozen arrows a bow (${short.slice(0, 4).join("; ")})`);
    console.log(`Arrows check (seed ${seed}): ${out.length ? out.slice(0, 5).join("; ") : `ok (arrows queued for bows with none; ${packed} of ${bowTrips} trips with bows packed a dozen a bow${short.length ? `; short: ${short.slice(0, 3).join("; ")}` : ""})`}`);
  } catch (e) {
    out.push(`CRASH: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
    console.log(`Arrows check (seed ${seed}): ${out.join("; ")}`);
  }
  return out.length;
}
const check = (ok, msg) => { if (!ok) throw new Error(msg); };
problems += arrowsCheck(seeds[0]);

console.log(`Problems: ${problems}`);
if (problems) process.exitCode = 1;
