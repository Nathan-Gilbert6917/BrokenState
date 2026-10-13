// Headless weather and seasons check (src/sim/weather.js):
//  1. Season cycle: 28-day seasons, day 1 = day 15 of spring, the order and the year count.
//  2. Determinism: the same seed gives the same weather; other seeds differ; weather never draws from state.rng,
//     so a world that looks at the weather a lot plays out exactly like one that does not.
//  3. Climate per season over many seeds (weather mix, temperatures, snow cover) and every factor in range.
//  4. Forecast: length by buildings, tomorrow nearly always right, further days less so (the regional outlook:
//     the day records; storms, blizzards and fog come as fronts that may miss the hub, see fronttest.js).
//  5. ETA exactness: teams on multi-day trips (on foot / by truck, each stance), a redirect and a queue
//     (move, camp, move) under (a) the real winter weather and (b) forced weather that flips between fair and
//     very slow every day; estimates must match the real hours when no road event delayed the team, also for
//     trips that start beyond the days rolled so far. Estimates count only the weather fronts already on the map
//     (weather.js `known`): a trip a front that formed after the estimate crossed is counted apart, like a delay.
//  6. Two years (224 days) of play without NaN in the weather, people or stock.
// Usage: node tools/weathertest.js [seeds for the climate table, default 20]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, survivorById, alive, day } from "../src/sim/world.js";
import { launchExpedition, estimateTrip, planPath, hoursLeft, orderMove, partyTile, startReturn, STANCES } from "../src/sim/parties.js";
import { queueOrder, queueEstimate } from "../src/sim/orders.js";
import { setNightPlan } from "../src/sim/nightmarch.js";
import { vehiclesAtBase } from "../src/sim/vehicles.js";
import { searchHour, extract } from "../src/sim/scavenge.js";
import { executeTrade, endTrade } from "../src/sim/trade.js";
import { addBuilding } from "../src/sim/buildings.js";
import * as W from "../src/sim/weather.js";

const nSeeds = Number(process.argv[2] || 20);
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const fin = (v) => typeof v === "number" && Number.isFinite(v);

// ---------- 1. season cycle ----------
console.log("Season cycle");
{
  const s0 = W.seasonOfDay(0);
  check(s0.key === "spring" && s0.dayOfSeason === 15 && s0.year === 1, `day 1 is ${s0.name} ${s0.dayOfSeason}, year ${s0.year}`);
  const order = [];
  let last = null;
  for (let i = 0; i < W.YEAR_DAYS * 2 + 10; i++) {
    const s = W.seasonOfDay(i);
    check(s.dayOfSeason >= 1 && s.dayOfSeason <= W.SEASON_DAYS && s.daysLeft === W.SEASON_DAYS - s.dayOfSeason, `day ${i + 1}: bad dayOfSeason ${s.dayOfSeason}`);
    if (s.key !== last) { order.push(`${s.key}@${i + 1}`); last = s.key; }
  }
  console.log(`  ${W.SEASON_DAYS} days per season, ${W.YEAR_DAYS}-day year. Changes: ${order.join(" ")}`);
  check(order.slice(0, 5).map((x) => x.split("@")[0]).join(",") === "spring,summer,autumn,winter,spring", "season order");
  check(order[1] === `summer@${W.SEASON_DAYS - 14 + 1}`, `summer starts on day ${W.SEASON_DAYS - 13}`);
  check(W.seasonOfDay(W.YEAR_DAYS - 14).year === 2, "year 2 starts with spring day 1");
  const st = createWorld({ seed: 3, factionCount: 3 });
  check(W.season(st).key === "spring", "a new world starts in spring");
}

// ---------- 2. determinism ----------
console.log("Determinism");
{
  const a = createWorld({ seed: 42, factionCount: 4 }), b = createWorld({ seed: 42, factionCount: 4 }), c = createWorld({ seed: 43, factionCount: 4 });
  const rngBefore = a.rng.state;
  const seq = (st) => Array.from({ length: 224 }, (_, i) => { const w = W.weatherOnDay(st, i + 1); return `${w.key}:${w.hi}:${w.lo}`; }).join("|");
  const sa = seq(a);
  check(a.rng.state === rngBefore, "generating weather drew from state.rng");
  check(sa === seq(b), "same seed, different weather");
  check(sa !== seq(c), "seeds 42 and 43 have the same weather");
  // A world that asks for weather, forecasts and factors all the time ends the same as one that does not.
  const run = (peek) => {
    const st = createWorld({ seed: 77, factionCount: 5 });
    for (let h = 0; h < 24 * 40; h++) {
      if (peek) { W.forecast(st, 5); W.travelFactor(st, { vehicle: true, tileId: 5, hour: st.hour + 300 }); W.weatherReport(st); W.growthFactor(st, "corn", W.dayIndex(st) + 30); }
      tickHour(st);
      st.cards.length = 0;
    }
    return JSON.stringify([st.rng.state, st.hordes.map((x) => [x.tile, x.size]), st.factions.map((f) => [f.pop, f.bases.length]), alive(st).length]);
  };
  check(run(false) === run(true), "looking at the weather changed how the world played out");
  console.log("  same seed → same weather, other seed → other weather, no draws from the play RNG");
}

// ---------- 3. climate and factor ranges ----------
console.log(`Climate over ${nSeeds} seeds × 2 years`);
{
  const stats = {};
  for (const s of W.SEASONS) stats[s.key] = { n: 0, kinds: {}, hi: 0, lo: 0, cover: 0, minLo: 99, maxHi: -99, slow: 0, grow: 0 };
  const crops = ["potato", "corn", "wheat", "cabbage", "kale", "tomato", null];
  let bad = 0;
  for (let sd = 1; sd <= nSeeds; sd++) {
    const st = createWorld({ seed: sd * 7919, factionCount: 2 });
    for (let i = 0; i < W.YEAR_DAYS * 2; i++) {
      st.hour = i * 24 + 12;
      const se = W.season(st), w = W.weather(st), x = stats[se.key];
      x.n++; x.kinds[w.key] = (x.kinds[w.key] || 0) + 1; x.hi += w.hi; x.lo += w.lo; x.cover += w.snowCover;
      x.minLo = Math.min(x.minLo, w.lo); x.maxHi = Math.max(x.maxHi, w.hi);
      for (const k of ["temp", "hi", "lo", "rain", "snow", "wind", "mud", "snowCover", "soil"]) if (!fin(w[k])) bad++;
      if (w.rain < 0 || w.rain > 1 || w.snow < 0 || w.snow > 1 || w.wind < 0 || w.wind > 1 || w.lo > w.hi) bad++;
      for (const vehicle of [false, true]) for (const tileId of [0, 100, 500]) {
        const f = W.travelFactor(st, { vehicle, tileId });
        if (!fin(f) || f < 1 || f > 3) bad++;
      }
      x.slow += W.travelEffects(st).footOff;
      for (const cr of crops) {
        const g = W.growthFactor(st, cr), d = W.cropDamage(st, cr);
        if (!fin(g) || g < 0 || g > 1.3 || !(d.kill >= 0 && d.kill <= 1) || !(d.rot >= 0 && d.rot <= 1) || typeof d.reason !== "string") bad++;
        if (!W.isGrowingSeason(st, cr) && g > 0) bad++;
      }
      x.grow += W.growthFactor(st, "potato");
      const r = W.rainWater(st), wf = W.wellFactor(st), ex = W.exposureRisk(st), hs = W.hordeSpeedFactor(st), fn = W.foodNeedFactor(st);
      if (!(r >= 0 && r <= 8) || !(wf >= 0.5 && wf <= 1.2) || !(ex.chance >= 0 && ex.chance <= 0.2) || !(hs >= 0.4 && hs <= 1) || !(fn >= 1 && fn <= 1.25)) bad++;
    }
  }
  check(bad === 0, `${bad} values out of range or not numbers`);
  const pct = (a, n) => `${Math.round((a / n) * 100)}%`;
  console.log(`  ${"season".padEnd(8)}${"avg hi/lo °C".padEnd(14)}${"range".padEnd(13)}${"snow cover".padEnd(11)}${"foot off-road".padEnd(14)}${"potato growth".padEnd(14)}weather mix`);
  for (const [k, x] of Object.entries(stats)) {
    const mix = Object.entries(x.kinds).sort((a, b) => b[1] - a[1]).map(([kk, v]) => `${kk} ${pct(v, x.n)}`).join(", ");
    console.log(`  ${k.padEnd(8)}${`${(x.hi / x.n).toFixed(1)} / ${(x.lo / x.n).toFixed(1)}`.padEnd(14)}${`${x.minLo.toFixed(0)}..${x.maxHi.toFixed(0)}`.padEnd(13)}${(x.cover / x.n).toFixed(2).padEnd(11)}${`×${(x.slow / x.n).toFixed(2)}`.padEnd(14)}${(x.grow / x.n).toFixed(2).padEnd(14)}${mix}`);
  }
  check(!stats.summer.kinds.snow && !stats.summer.kinds.blizzard, "snow in summer");
  check((stats.winter.kinds.snow || 0) + (stats.winter.kinds.blizzard || 0) > stats.winter.n * 0.15, "too little snow in winter");
  check(stats.winter.cover / stats.winter.n > 0.15, "winter has no snow cover");
  check(stats.summer.hi / stats.summer.n > stats.spring.hi / stats.spring.n && stats.spring.hi / stats.spring.n > stats.winter.hi / stats.winter.n, "temperatures do not follow the seasons");
  check(stats.winter.slow / stats.winter.n > stats.summer.slow / stats.summer.n + 0.2, "winter travel is not slower than summer");
  check(stats.winter.grow / stats.winter.n < 0.05 && stats.summer.grow / stats.summer.n > 0.6, "potato growth: winter should be ~0, summer high");
  check(Object.values(stats).every((x) => (x.kinds.storm || 0) + (x.kinds.blizzard || 0) > 0), "a season with no severe weather at all");
}

// ---------- 4. forecast ----------
console.log("Forecast");
{
  const st = createWorld({ seed: 5, factionCount: 3 });
  check(W.forecast(st).length === 3, `no buildings: ${W.forecast(st).length} days, want 3`);
  addBuilding(hub(st), "watchtower");
  check(W.forecast(st).length === 4, `watchtower: ${W.forecast(st).length} days, want 4`);
  addBuilding(hub(st), "radio");
  check(W.forecast(st).length === 5, `radio station: ${W.forecast(st).length} days, want 5`);
  const right = [0, 0, 0, 0, 0];
  let n = 0;
  for (let i = 0; i < 200; i++) {
    st.hour = i * 24 + 8;
    const fc = W.forecast(st, 5);
    check(JSON.stringify(fc) === JSON.stringify(W.forecast(st, 5)), "the forecast flickers within a day");
    n++;
    fc.forEach((f, j) => { if (f.key === W.regionOnDay(st, f.day).key) right[j]++; });
  }
  console.log(`  forecast right (with a radio station): ${right.map((r, j) => `+${j + 1}d ${Math.round((r / n) * 100)}%`).join(", ")}`);
  check(right[0] / n >= 0.85, "tomorrow's forecast is wrong too often");
  check(right[4] < right[0], "day 5 is as reliable as tomorrow");
}

// ---------- 5. ETA exactness across weather changes ----------
console.log("ETA across weather changes");
function resolveCards(state, p, stats) {
  for (let i = 0; i < state.cards.length;) {
    const c = state.cards[i];
    if (c.isOrders) { i++; continue; }
    state.cards.splice(i, 1);
    const before = p.progress;
    // A meeting on the road (wanderers.js) halts the team until its card is answered (conflicts.js halt): a
    // road-event delay like a card that costs hours, even though progress is not taken back. Met on the tile the
    // leg ends on, the team is still "engaged" at the end of that hour and reaches it (or starts its next order)
    // an hour later than planned. Road conflicts are off here (lastConflict), so a halt is a meeting.
    const halted = p.phase === "engaged";
    const ch = c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled));
    if (ch) ch.resolve(state);
    stats.cards += 1;
    if (p.progress < before || halted) stats.delay += 1;
  }
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].isOrders) state.cards.splice(i, 1);
}
// A front that came onto the map after hour h0 and was over the way (path) at some hour before h1: the estimate made
// at h0 could not know it.
function unforeseen(state, path, h0, h1) {
  for (let h = h0 + 1; h <= h1; h++) for (const id of path) {
    const a = W.frontAt(state, id, h);
    if (a && a.f.t0 > h0) return true;
  }
  return false;
}
function runUntil(state, p, done, stats) {
  const start = state.hour;
  for (let n = 0; n < 24 * 60; n++) {
    state.hordes.length = 0;
    p.lastConflict = state.hour; // road conflicts off: only movement is compared
    tickHour(state);
    if (p.roadblock && p.roadblock.hour === state.hour) stats.delay += 1; // a road blockage (sim/roadblocks.js) is a delay like a card's
    resolveCards(state, p, stats);
    if (state.combat) state.combat = null;
    if (!state.parties.includes(p)) return { hours: state.hour - start, gone: true };
    if (done(p)) return { hours: state.hour - start };
  }
  return { hours: Infinity };
}
// Forced weather: every other day very slow (all four multipliers well above 2), the rest fair.
function forceFlip(state, days) {
  for (let i = 0; i < days; i++) W.weatherOnDay(state, i + 1);
  state.weather.days.forEach((d, i) => { d.tf = i % 2 ? [2.2, 2.7, 2.4, 3] : [1, 1, 1, 1]; });
}
const rows = [];
let exact = 0, clean = 0, slowed = 0, fronts = 0;
for (const mode of ["winter", "flip"]) {
  for (let c = 0; c < 12; c++) {
    const state = createWorld({ seed: 900 + c * 13, factionCount: 4 });
    state.started = true;
    state.noWanderers = true; // timing a queue: people met on the road (wanderers.js) would add their own delays
    if (mode === "winter") { state.hour = (75 + c) * 24 + 6; W.weatherDaily(state); } // real weather, deep in winter
    else forceFlip(state, 12); // only 12 days set; later days are rolled on demand during the trip
    const h = hub(state);
    Object.assign(h.stock, { water: 900, fuel: 300, meds: 30, ammo: 300, parts: 20 }); setFood(h, 900);
    const truck = vehiclesAtBase(state, h.id)[0];
    const byTruck = c % 2 === 1 && truck;
    if (byTruck) { truck.fuel = 60; truck.condition = 100; }
    const stance = Object.keys(STANCES)[c % 3];
    const pool = state.tiles.filter((t) => t.terrain !== "water" && state.grid.distance(t.id, h.tile) >= 8 && state.grid.distance(t.id, h.tile) <= 14 && planPath(state, h.tile, t.id, !!byTruck));
    if (!pool.length) continue;
    const dest = state.rng.pick(pool).id;
    const crew = atBase(state, h.id).slice(0, 2).map((s) => s.id);
    const est = estimateTrip(state, { memberIds: crew, dest, vehicle: !!byTruck, stance, fuel: byTruck ? truck.fuel + 40 : 0 });
    const res = launchExpedition(state, { memberIds: crew, dest, mission: "move", stance, vehicleId: byTruck ? truck.id : null, supplies: byTruck ? { food: 20, water: 20, fuel: 40 } : { food: 12, water: 12 } });
    if (!check(!res.error, `launch: ${res.error}`)) continue;
    const p = res.party;
    // The team panel's "At night: Push through" (sim/nightmarch.js): the estimates are for a team that keeps moving at
    // night; a "Night falls" card stops it for the hour it asks and making camp is the player's own stop.
    setNightPlan(state, p, "push");
    if (mode === "flip") state.weather.days.forEach((d, i) => { d.tf = i % 2 ? [2.2, 2.7, 2.4, 3] : [1, 1, 1, 1]; });
    const st1 = { cards: 0, delay: 0 };
    const h1 = state.hour, way1 = [...p.path];
    const leg = runUntil(state, p, (q) => q.phase === "waiting", st1);
    if (unforeseen(state, way1, h1, state.hour)) { st1.delay += 1; fronts++; }
    if (est.weatherOut) slowed++;
    rows.push({ mode, how: `${byTruck ? "truck" : "foot"} ${stance}`, est: est.hoursOut, wx: est.weatherOut, actual: leg.hours, delay: st1.delay });
    if (!st1.delay && !leg.gone) { clean++; if (check(leg.hours === est.hoursOut, `${mode} seed ${900 + c * 13} ${byTruck ? "truck" : "foot"}: estimate ${est.hoursOut}h, took ${leg.hours}h`)) exact++; }
    if (leg.gone || !state.parties.includes(p)) continue;
    // A queue given while waiting: move, camp 5h, move. Chained start hours must line up with the weather.
    const here = partyTile(p);
    const near = state.tiles.filter((t) => t.terrain !== "water" && state.grid.distance(t.id, here) >= 3 && state.grid.distance(t.id, here) <= 7 && planPath(state, here, t.id, p.vehicle));
    if (near.length < 2) continue;
    const [qa, qb] = [state.rng.pick(near).id, state.rng.pick(near).id];
    if (qa === qb) continue;
    p.orders = [];
    queueOrder(state, p, { type: "move", tile: qa });
    const curLeft = hoursLeft(state, p);
    queueOrder(state, p, { type: "camp", hours: 5 });
    queueOrder(state, p, { type: "move", tile: qb });
    const est2 = curLeft + queueEstimate(state, p).reduce((s, x) => s + (x.hours ?? 0), 0);
    const st2 = { cards: 0, delay: 0 };
    const h2 = state.hour, way2 = state.tiles.map((t) => t.id).filter((id) => state.grid.distance(id, here) <= 8);
    const leg2 = runUntil(state, p, (q) => q.phase === "waiting" && !q.orders.length && !state.cards.length, st2);
    if (unforeseen(state, way2, h2, state.hour)) { st2.delay += 1; fronts++; }
    rows.push({ mode, how: "queue: move, camp 5h, move", est: est2, wx: null, actual: leg2.hours, delay: st2.delay });
    if (!st2.delay && !leg2.gone) { clean++; if (check(leg2.hours === est2, `${mode} queue: estimate ${est2}h, took ${leg2.hours}h`)) exact++; }
    if (leg2.gone || !state.parties.includes(p)) continue;
    // Redirect while on the move, after a few hours.
    const far = state.tiles.filter((t) => t.terrain !== "water" && state.grid.distance(t.id, partyTile(p)) >= 6 && state.grid.distance(t.id, partyTile(p)) <= 10 && planPath(state, partyTile(p), t.id, p.vehicle));
    if (!far.length) continue;
    orderMove(state, p, state.rng.pick(far).id);
    for (let k = 0; k < 5 && p.phase === "out"; k++) { state.hordes.length = 0; p.lastConflict = state.hour; tickHour(state); resolveCards(state, p, { cards: 0, delay: 0 }); }
    if (p.phase !== "out") continue;
    const tgt = state.tiles.filter((t) => t.terrain !== "water" && state.grid.distance(t.id, partyTile(p)) >= 4 && state.grid.distance(t.id, partyTile(p)) <= 8 && planPath(state, partyTile(p), t.id, p.vehicle));
    if (!tgt.length) continue;
    orderMove(state, p, state.rng.pick(tgt).id);
    const est3 = hoursLeft(state, p);
    const st3 = { cards: 0, delay: 0 };
    const h3 = state.hour, way3 = [...p.path];
    const leg3 = runUntil(state, p, (q) => q.phase === "waiting", st3);
    if (unforeseen(state, way3, h3, state.hour)) { st3.delay += 1; fronts++; }
    rows.push({ mode, how: "redirect on the move", est: est3, wx: null, actual: leg3.hours, delay: st3.delay });
    if (!st3.delay && !leg3.gone) { clean++; if (check(leg3.hours === est3, `${mode} redirect: estimate ${est3}h, took ${leg3.hours}h`)) exact++; }
  }
}
for (const r of rows) console.log(`  ${r.mode.padEnd(7)}${r.how.padEnd(30)}est ${String(r.est).padStart(4)}h${r.wx != null ? ` (weather ${r.wx >= 0 ? "+" : ""}${r.wx}h)` : ""}`.padEnd(66) + `actual ${r.actual}h${r.delay ? ` (${r.delay} delay card(s))` : ""}`);
console.log(`  ${exact}/${clean} trips without event delays matched the estimate to the hour; ${slowed} launches were slowed by weather; ${fronts} crossed by a front that formed after the estimate (counted as delays).`);
check(clean >= 20, `only ${clean} clean trips`);
check(slowed >= 6, "weather slowed too few launches: the test is not testing weather");

// ---------- 6. two years of play ----------
console.log("Two-year run");
{
  const state = createWorld({ seed: 2024, factionCount: 6 });
  state.started = true;
  let nan = 0, severeLogs = 0;
  const seen = new Set();
  const t0 = performance.now();
  while (day(state) <= 224 && !state.gameOver) {
    tickHour(state);
    while (state.cards.length) {
      const c = state.cards.shift();
      const ch = c.choices.find((x) => x.label === "Return home") || c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled));
      if (ch) ch.resolve(state);
    }
    if (state.engagement) { if (!state.engagement.approach) state.engagement.approach = "normal"; extract(state); }
    if (state.trade) { executeTrade(state); endTrade(state); }
    if (state.combat) state.combat = null;
    for (const p of state.parties) if (p.owner === "player" && p.phase === "waiting") startReturn(state, p);
    const h = hub(state);
    if (h && state.hour % 24 === 1) { // a hub lost to raiders (conquest.js) ends the feeding and the trips, not the run
      // Keep the holdout fed so the run lasts; send a team out every 5 days to put travel through the seasons.
      setFood(h, Math.max(food(h), 60)); h.stock.water = Math.max(h.stock.water, 60);
      const w = W.weather(state), se = W.season(state);
      seen.add(`${se.key}`); seen.add(w.key);
      for (const k of ["temp", "hi", "lo", "rain", "snow", "wind", "soil"]) if (!fin(w[k])) nan++;
      if (day(state) % 5 === 0 && !state.parties.some((p) => p.owner === "player")) {
        const people = atBase(state, h.id).slice(0, 2);
        const targets = state.tiles.filter((t) => t.loc && state.grid.distance(t.id, h.tile) <= 7 && t.id !== h.tile);
        const dest = state.rng.pick(targets).id;
        const est = estimateTrip(state, { memberIds: people.map((s) => s.id), dest, vehicle: false, stance: "normal" });
        if (est && people.length) launchExpedition(state, { memberIds: people.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: { food: Math.min(food(h), est.food + 2), water: Math.min(h.stock.water, est.water + 2) } });
      }
    }
    for (const s of state.survivors) if (!fin(s.health)) nan++;
    for (const b of state.bases) for (const k of Object.keys(b.stock)) if (!fin(b.stock[k])) nan++;
  }
  severeLogs = state.log.filter((l) => /Storm today|Blizzard today|begins\./.test(l.text)).length;
  console.log(`  ${day(state) - 1} days in ${(performance.now() - t0).toFixed(0)} ms, ${alive(state).length} alive, game over: ${state.gameOver}; seen: ${[...seen].join(", ")}; ${state.weather.days.length} days rolled; ${severeLogs} season / severe log lines`);
  check(nan === 0, `${nan} NaN values`);
  check(state.gameOver || day(state) > 224, "the run stopped early");
  check(["spring", "summer", "autumn", "winter"].every((k) => seen.has(k)) || state.gameOver, "not every season was seen");
  // Old states: no state.weather at all still works.
  delete state.weather;
  check(fin(W.weather(state).temp) && W.forecast(state).length >= 3, "an old state without weather broke");
}

console.log(fails ? `${fails} FAILURE(S)` : "All checks passed.");
process.exit(fails ? 1 : 0);
