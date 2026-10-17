// The 7-day threat forecast (sim/forecast.js threatForecast, the top bar's meter ui/threatbar.js): a horde coming for a
// base shows on the day it gets there (checked against the hordes' own march, hour by hour), food set to run out on day
// N shows on day N (and water), a horde the player never saw is not on it (and one in sight, tracked by a watchtower or
// seen in the last day is), a raid shows once seen or heard on the radio, a team in the field that runs dry before home
// shows and one nearly home does not, the weather forecast's storms, the days and levels in order; the cache (per hour,
// cheap per call); the meter, its list and the click-through; the topbar slot; a hardcore start with no base.
// Usage: node tools/forecasttest.js [seed]
import { setFood } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, atBase, updateVision, day, tickHour } from "../src/sim/world.js";
import { makeHorde, hordesHour } from "../src/sim/hordes.js";
import { foodOutlook, waterOutlook } from "../src/sim/economy.js";
import { threatForecast, threatForecastFresh, dropForecastCache, THREAT, sureWord } from "../src/sim/forecast.js";
import { partyMembers, launchExpedition } from "../src/sim/parties.js";
import { RAW } from "../src/sim/water.js";
import { topbarParts, renderTopbar } from "../src/ui/ui.js";
import { threatBar, THREAT_ACTIONS, initThreatBar } from "../src/ui/threatbar.js";

const SEED = Number(process.argv[2] || 11);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(t);
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, toDataURL: () => "data:image/png;base64," }) };
const mk = (opts = {}) => { const st = createWorld({ seed: SEED, factionCount: 5, ...opts }); st.started = true; st.visitorsOff = true; st.noOutbreak = true; st.forecastStrict = true; updateVision(st); return st; };
const fresh = (st) => threatForecastFresh(st);
const byKey = (fc, k) => fc.items.find((x) => x.key === k);
const land = (st, id) => st.tiles[id].terrain !== "water";
// A land tile `d` tiles from the base, not on a base or a group's base.
const tileAt = (st, base, d, not = []) => st.grid.within(base.tile, d).find((id) => st.grid.distance(id, base.tile) === d && land(st, id) && !not.includes(id) &&
  !st.bases.some((b) => b.tile === id) && !st.factions.some((f) => f.bases.includes(id)) && st.grid.neighbors(id).some((n) => land(st, n)));
const clearHordes = (st) => { st.hordes.length = 0; };
const quietBase = (st, h) => { // nothing else on the forecast at the hub: food, water, firewood for weeks
  setFood(h, 400); h.stock.water = 600; h.stock.wood = 30000; h.stock.fuel = 100;
};

section("A horde coming for a base: on the day it gets there");
for (const dist of [2, 4, 6]) {
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  const t = tileAt(st, h, dist);
  const hd = makeHorde(st, { tile: t, size: 60, role: "attack", goal: { baseId: h.id, tile: h.tile }, target: h.tile });
  st.live.add(t); // in sight
  const fc = fresh(st);
  const it = byKey(fc, `horde:${hd.id}`);
  // The hordes' own march, hour by hour (hordesHour: the pace, the path, the weather where it is).
  const start = st.hour;
  let arrived = null;
  for (let i = 0; i < 24 * 8 && arrived == null; i++) {
    st.hour++;
    st.cards.length = 0;
    hordesHour(st);
    if (!st.hordes.includes(hd) || hd.tile === h.tile) arrived = st.hour;
  }
  const real = arrived == null ? null : Math.floor(arrived / 24) + 1;
  st.hour = start;
  check(!!it && arrived != null && it.day === real, `${dist} tiles out: forecast day ${it && it.day}, it got there on day ${real} (${arrived != null ? arrived - start : "?"} h)`);
  check(!!it && it.target.kind === "base" && it.target.id === h.id && it.go && it.go.tile === t && it.confidence >= 0.85, `it names the base it hits, how sure (${it && it.sure} ${it && it.confidence}) and where the horde is (click-through)`);
}
{
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  const t = tileAt(st, h, 3);
  const big = makeHorde(st, { tile: t, size: 500, role: "attack", goal: { baseId: h.id, tile: h.tile }, target: h.tile });
  const small = makeHorde(st, { tile: tileAt(st, h, 3, [t]), size: 6, role: "attack", goal: { baseId: h.id, tile: h.tile }, target: h.tile });
  st.live.add(big.tile); st.live.add(small.tile);
  const fc = fresh(st);
  check(byKey(fc, `horde:${big.id}`).level === 3 && /break-in/.test(byKey(fc, `horde:${big.id}`).text), "a horde bigger than the defences hold: severe, a break-in likely");
  check(byKey(fc, `horde:${small.id}`).level === 1, "a handful the walls stop: only a watch");
  const far = makeHorde(st, { tile: tileAt(st, h, 30) ?? tileAt(st, h, 20), size: 80, role: "attack", goal: { baseId: h.id, tile: h.tile }, target: h.tile });
  st.live.add(far.tile);
  check(!byKey(fresh(st), `horde:${far.id}`), "one too far out to arrive within the week: not on it");
}

section("Hordes the player does not know of stay off it");
{
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  const t = tileAt(st, h, 6);
  st.live.delete(t);
  for (const id of st.grid.within(t, 2)) delete st.knowledge[id];
  const hd = makeHorde(st, { tile: t, size: 90, role: "attack", goal: { baseId: h.id, tile: h.tile }, target: h.tile });
  check(!fresh(st).items.some((x) => x.kind === "horde" || x.kind === "drift"), "unseen, untracked, unwarned: nothing on the forecast");
  st.knowledge[t] = { hour: st.hour - 40, hordeSize: 90 };
  check(!byKey(fresh(st), `horde:${hd.id}`), "seen there 40 hours ago: no longer placed (only a stale guess near a base)");
  st.knowledge[t] = { hour: st.hour - 6, hordeSize: 90 };
  const seen = byKey(fresh(st), `horde:${hd.id}`);
  check(!!seen && seen.confidence < 0.85 && seen.source === "Sighting", `seen 6 hours ago: on it, less sure (${seen && seen.sure})`);
  delete st.knowledge[t];
  hd.warned = true;
  check(!!byKey(fresh(st), `horde:${hd.id}`), "the lookouts warned of it: on it");
  hd.warned = false;
  h.towerWatch = { ids: [hd.id], since: st.hour };
  check(!!byKey(fresh(st), `horde:${hd.id}`), "a watchtower tracks it: on it");
  delete h.towerWatch;
  st.live.add(t);
  check(byKey(fresh(st), `horde:${hd.id}`).source === "Seen on the map", "in sight: on it, seen");
}

section("A wandering horde near a base: its drift");
{
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  const t = tileAt(st, h, 3);
  const hd = makeHorde(st, { tile: t, size: 70, role: "roam" });
  hd.target = t;
  st.live.add(t);
  const it = byKey(fresh(st), `drift:${hd.id}`);
  check(!!it && it.level >= 1 && it.confidence < 0.85 && it.target.id === h.id, `it may drift onto the hub (${it && it.sure} ${it && it.confidence}), not a sure thing`);
  const tiny = makeHorde(st, { tile: tileAt(st, h, 2), size: 8, role: "roam" });
  st.live.add(tiny.tile);
  check(!byKey(fresh(st), `drift:${tiny.id}`), "a handful of wandering dead: not worth a line");
}

section("Food and water running out: on the day they do");
for (const N of [1, 2, 4, 7]) {
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  setFood(h, 10);
  const o = foodOutlook(st, h);
  const burn = o.stock / o.daysLeft; // days of food gone a day (eating, spoiling, the stations; less what the scavengers bring)
  const hoursTo = (N - 1) * 24 + 12 - (st.hour % 24); // the middle of day N (today is day 1 of the forecast)
  setFood(h, (burn * hoursTo) / 24);
  const fc = fresh(st);
  const it = byKey(fc, `food:${h.id}`);
  const want = day(st) + N - 1;
  check(!!it && it.day === want && it.offset === N - 1 && it.level === 2, `food for ${(hoursTo / 24).toFixed(2)} days: runs out on day ${it && it.day} (day ${want} wanted)`);
}
{
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  setFood(h, 0); h.hungerDays = 1;
  check(byKey(fresh(st), `food:${h.id}`)?.level === 3 && byKey(fresh(st), `food:${h.id}`)?.offset === 0, "out of food now: severe, today");
  h.hungerDays = 0; setFood(h, 400);
  const w = waterOutlook(st, h);
  if (w.net < 0) {
    h.stock.water = -w.net * 2.6; h.stock[RAW] = 0;
    const wo = waterOutlook(st, h);
    const it = byKey(fresh(st), `water:${h.id}`);
    check(!!it && it.day === Math.floor((st.hour + wo.daysLeft * 24) / 24) + 1 && it.level === 3, `water for ${wo.daysLeft.toFixed(1)} days: severe on day ${it && it.day}`);
  } else {
    h.stock.water = 0; h.stock[RAW] = 0;
    check(byKey(fresh(st), `water:${h.id}`)?.offset === 0, "out of water: today (the wells keep up here, so the stock was emptied)");
  }
  h.stock.water = 600;
  check(!fresh(st).items.some((x) => x.kind === "food" || x.kind === "water"), "plenty of both: neither on it");
}

section("Raids: seen or heard, never guessed");
{
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const from = tileAt(st, h, 5);
  const path = st.grid.within(h.tile, 5).length ? [from, tileAt(st, h, 4), tileAt(st, h, 3), tileAt(st, h, 2), tileAt(st, h, 1), h.tile] : [];
  const q = { id: 990001, owner: f.id, kind: "raid", phase: "out", target: { kind: "player", baseId: h.id, tile: h.tile }, path, idx: 0, progress: 0, strength: 30, members: [] };
  st.parties.push(q);
  st.live.delete(from);
  check(!fresh(st).items.some((x) => x.kind === "raid"), "a war party nobody saw or heard: not on it");
  (st.radioChan = st.radioChan || { traffic: {}, got: {}, memo: {} }).got[`raid:${q.id - (st.idBase || 0)}`] = day(st);
  const heard = fresh(st).items.find((x) => x.kind === "raid");
  check(!!heard && heard.source === "Radio (heard)" && heard.target.id === h.id && heard.confidence < 0.85, `heard on their channel: on it, less sure (${heard && heard.sure}), day ${heard && heard.day}`);
  q.warned = true;
  const seen = fresh(st).items.find((x) => x.kind === "raid");
  check(!!seen && seen.source === "Lookouts" && seen.level >= 2, `the lookouts saw it: ${seen && seen.sure}, ${seen && ["calm", "watch", "danger", "severe"][seen.level]}`);
  q.strength = 9999;
  check(fresh(st).items.find((x) => x.kind === "raid").level === 3, "far stronger than the defence: severe");
  q.phase = "siege";
  const sg = fresh(st).items.find((x) => x.kind === "raid");
  check(sg.offset === 0 && sg.level === 3, "at the walls: today, severe");
  st.parties.pop();
}

section("Teams in the field");
{
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  const far = tileAt(st, h, 8) || tileAt(st, h, 6);
  const ids = atBase(st, h.id).slice(0, 2).map((x) => x.id);
  const res = launchExpedition(st, { memberIds: ids, dest: far, mission: "move", stance: "normal", supplies: { food: 2, water: 2 } });
  const p = res.party;
  check(!!p, `a team sent 8 tiles out${res.error ? ` (${res.error})` : ""}`);
  if (p) {
    p.path = [far]; p.idx = 0; p.phase = "waiting"; // camped out there
    for (const k of Object.keys(p.supplies)) p.supplies[k] = 0;
    if (p.cargo) p.cargo.supplies = {};
    for (const x of partyMembers(st, p)) { x.hunger = 8; x.thirst = 6; } // nearly empty: hours, not days
    const fc = fresh(st);
    const dry = byKey(fc, `teamwater:${p.id}`), hungry = byKey(fc, `teamfood:${p.id}`);
    check(!!dry && dry.offset <= 1 && dry.level >= 2 && dry.go.team === p.id, `no water, thirsty, hours from home: runs dry on day ${dry && dry.day} (click opens the team)`);
    check(!!hungry && hungry.target.kind === "team" && hungry.target.id === p.id, `and goes hungry on day ${hungry && hungry.day}`);
    p.supplies.water = 40; setFood(p, 30);
    check(!byKey(fresh(st), `teamwater:${p.id}`) && !byKey(fresh(st), `teamfood:${p.id}`), "with plenty packed: neither");
    p.supplies.water = 0; setFood(p, 0);
    p.path = [st.grid.neighbors(h.tile).find((id) => land(st, id) && !st.factions.some((f) => f.bases.includes(id)))];
    check(!byKey(fresh(st), `teamwater:${p.id}`), "a tile from home: home before it matters");
  }
}

section("The weather, the days, the levels");
{
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  // On to a day when the forecast holds a storm or a blizzard (at most two months).
  const W = await import("../src/sim/weather.js");
  for (let i = 0; i < 24 * 60 && !(i >= 24 * 10 && st.hour % 24 === 8 && W.forecast(st, W.forecastRange(st)).some((x) => x.severe)); i++) { st.cards.length = 0; tickHour(st); }
  const fc = fresh(st);
  check(fc.days.length === THREAT.DAYS && fc.days[0].day === day(st) && fc.days.every((d, i) => d.offset === i && d.day === day(st) + i), "seven days, today first");
  check(fc.days.every((d) => d.level === Math.max(0, ...d.items.map((x) => x.level))) && fc.level === Math.max(0, ...fc.days.map((d) => d.level), ...fc.week.map((x) => Math.min(1, x.level))), "a day's level is its worst cause; the week's the worst day");
  check(fc.items.every((x) => x.confidence > 0 && x.confidence <= 1 && x.sure === sureWord(x.confidence) && x.text && x.why && x.source && x.target), "every cause: how sure, a line, why, where from, whom it hits");
  check(fc.days.every((d) => d.known === d.offset <= fc.range), `the days past the sky's reach (${fc.range} days) are marked`);
  check(fc.items.every((x, i, a) => !i || (a[i - 1].day ?? 1e9) <= (x.day ?? 1e9)), "in order of the day");
  // A storm forecast within the sky's reach shows on its day.
  const storms = W.forecast(st, fc.range).filter((x) => x.severe);
  check(storms.length > 0 && storms.every((s) => fc.items.some((x) => x.kind === "weather" && x.day === s.day)), `the forecast's storms are on it (${storms.map((x) => `${x.name} day ${x.day}`).join(", ")}; day ${day(st)})`);
}

section("Cost and the cache");
{
  const st = mk(), h = hub(st);
  // Twenty unattended days in a crowded hub (6 people, 4 beds) break everyone's mood and the run ends: the clock
  // stops and the last check never sees a new hour. Keep them in good spirits; this is about the forecast's cost.
  for (let i = 0; i < 24 * 20; i++) { st.cards.length = 0; for (const s of st.survivors) s.mood = Math.max(s.mood, 60); tickHour(st); }
  check(!st.gameOver, `the run still going on day ${day(st)}`);
  for (let i = 0; i < 6; i++) makeHorde(st, { tile: tileAt(st, h, 2 + i) || h.tile, size: 40 + i * 20, role: i % 2 ? "roam" : "attack", goal: i % 2 ? null : { baseId: h.id, tile: h.tile }, target: i % 2 ? null : h.tile });
  for (const x of st.hordes) st.live.add(x.tile);
  fresh(st);
  let t = performance.now();
  const N = 40;
  for (let i = 0; i < N; i++) fresh(st);
  const each = (performance.now() - t) / N;
  check(each < 15, `a fresh forecast takes ${each.toFixed(2)} ms`);
  dropForecastCache(st);
  const a = threatForecast(st);
  t = performance.now();
  for (let i = 0; i < 5000; i++) threatForecast(st);
  const cached = (performance.now() - t) / 5000;
  check(threatForecast(st) === a && cached < 0.02, `cached within the hour: ${(cached * 1000).toFixed(2)} µs a call`);
  st.cards.length = 0; tickHour(st);
  check(threatForecast(st) !== a && threatForecast(st).hour === st.hour, "a new hour, a new forecast");
}

section("The meter and its list (ui/threatbar.js)");
{
  const st = mk(), h = hub(st);
  clearHordes(st); quietBase(st, h);
  const t = tileAt(st, h, 2);
  const hd = makeHorde(st, { tile: t, size: 300, role: "attack", goal: { baseId: h.id, tile: h.tile }, target: h.tile });
  st.live.add(t);
  setFood(h, 0.4 * atBase(st, h.id).length + 1);
  dropForecastCache(st);
  const fc = threatForecast(st);
  const tb = threatBar(st);
  check((tb.btn.match(/class="tf-cell /g) || []).length === 7, "seven bars");
  check(new RegExp(`tf-word tf-l${fc.level}">${["Calm", "Watch", "Danger", "Severe"][fc.level]}<`).test(tb.btn), `the week's word: ${fc.label}`);
  check(fc.days.every((d, i) => new RegExp(`<i class="tf-cell tf-l${d.level}( tf-far)?"></i>`).test(tb.btn.split("<i ")[i + 1] ? `<i ${tb.btn.split("<i ")[i + 1]}` : "")), "each bar at its day's level");
  check(/aria-haspopup="true"/.test(tb.html) && /tf-sr/.test(tb.btn) && /Threat forecast, the next 7 days/.test(tb.btn), "a button with a spoken summary");
  check(tb.list.includes(`data-key="horde:${hd.id}"`) && /data-action="tf-go"/.test(tb.list) && /Seen on the map · sure/.test(tb.list), "the horde in the list: where from, how sure, whom");
  check(/Today · day \d+/.test(tb.list) && /nothing seen coming/.test(tb.list), "days named, the quiet ones folded");
  // Click-through: the horde on the map, the base's window.
  const did = [];
  const act = { center: (d) => did.push(["center", d.tile]), openbase: (d) => did.push(["openbase", d.id, d.tab]), "xp-open": (d) => did.push(["team", d.id]) };
  const ui = {};
  THREAT_ACTIONS["tf-go"](st, ui, { key: `horde:${hd.id}` }, act);
  const foodIt = fc.items.find((x) => x.kind === "food");
  if (foodIt) THREAT_ACTIONS["tf-go"](st, ui, { key: foodIt.key }, act);
  check(did[0] && did[0][0] === "center" && did[0][1] === t, "a click on the horde shows it on the map");
  check(!foodIt || (did[1] && did[1][0] === "openbase" && did[1][1] === h.id), "a click on the food opens the base");
  const parts = topbarParts(st, { speed: 1 });
  check(/id="tf-btn"/.test(parts.threat) && parts.forecast && typeof parts.forecast.list === "string" && !Object.keys(parts).includes("forecast"), "the top bar's threat slot, its three parts for main.js");
  check(renderTopbar(st, { speed: 1 }).includes('id="tf-btn"'), "the whole bar as one string has it too");
  // Opening and closing: the Needs button's rules with its own classes.
  const handlers = {}, classes = new Set();
  const btn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, blur() {} };
  const root = { dataset: {}, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) }, addEventListener: (k, f) => (handlers[k] = f), contains: () => false, querySelector: (s) => (s === ".tf-btn" ? btn : null) };
  initThreatBar(root, { activeElement: null, addEventListener() {} }, { addEventListener() {} });
  handlers.mouseenter();
  check(classes.has("tf-open") && btn.attrs["aria-expanded"] === "true", "hover opens it");
  handlers.click({ target: { closest: (s) => (s === ".tf-btn" ? btn : null) }, detail: 1 });
  handlers.mouseleave();
  await new Promise((r) => setTimeout(r, 300));
  check(classes.has("tf-open"), "a click pins it open (a tap, a TV remote)");
}

section("Hardcore: no base yet");
{
  const st = mk({ mode: "hardcore" });
  let ok = true, fc = null, tb = null;
  try { fc = fresh(st); tb = threatBar(st); } catch (e) { ok = false; console.log(e); }
  check(ok && fc.days.length === 7 && /tf-cell/.test(tb.btn), `the road team's forecast (${fc && fc.items.map((x) => x.kind).join(", ") || "calm"})`);
  const p = st.parties.find((x) => x.owner === "player");
  if (p) {
    for (const k of Object.keys(p.supplies)) p.supplies[k] = 0;
    if (p.cargo) p.cargo.supplies = {};
    check(!!byKey(fresh(st), `teamwater:${p.id}`), "no base and no water: the road team runs dry, on it");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
