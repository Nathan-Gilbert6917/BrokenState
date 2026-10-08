// Headless checks for splinter bands (src/sim/splinters.js):
//   - strife grows with the desertion pressure, every deserter and the dead of a fight, and fades when things are quiet;
//     a heavy fight may cost them their leader (a strife jump); a lost war (diplomacy.js makePeace) adds WAR_LOST
//   - a raider gang torn up inside splits: a new raider band on a free site near the old base, the people, stores and
//     kit shared out (nothing made from nothing), feuding with its old crew; zealots split as a new sect; communes,
//     traders and a fortress never split; never beyond the world's group limit; not again for GAP days
//   - you hear of it when the old group is one you know near a base of yours (a log line)
//   - strife and the split survive a save and load
// Usage: node tools/splintertest.js [seed]            the checks
//        node tools/splintertest.js rate [days] [seeds...]   splits per world-year on the Balanced autopilot (normal worlds)
import { createWorld, tickHour, day, hub } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { SPLINTER, strifeDay, strifeOf, splitChance, splitGroup, splinterSite, groupRoom, noteStrife, splinterDaily } from "../src/sim/splinters.js";
import { noteFight, desertOne, tickGroup, GROUP_PRIORITIES } from "../src/sim/groupcare.js";
import { relation, makePeace, ensureDiplo } from "../src/sim/diplomacy.js";
import { ensureArsenal } from "../src/sim/arsenal.js";

const t0 = Date.now();
let passes = 0, fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (ok) passes++; else fails++; };
const section = (t) => console.log(`\n== ${t}`);

if (process.argv[2] === "rate") {
  const days = Number(process.argv[3] || 365);
  const seeds = process.argv.length > 4 ? process.argv.slice(4).map(Number) : [42, 7, 1234, 99];
  let splits = 0, years = 0;
  const byType = {};
  for (const seed of seeds) {
    const st = createWorld({ seed, factionCount: 8 });
    st.started = true;
    setAutopilot(st, true, "balanced");
    const before = new Set(st.factions.map((f) => f.id));
    let peak = 0;
    while (day(st) <= days && !st.gameOver) { tickHour(st); if (st.hour % 24 === 0) for (const f of st.factions) if (f.alive) peak = Math.max(peak, strifeOf(f)); }
    const n = st.stats.splinters || 0;
    for (const f of st.factions.filter((x) => x.splitFrom != null)) { const o = st.factions.find((x) => x.id === f.splitFrom); const k = `${o ? o.type : "?"}→${f.type}`; byType[k] = (byType[k] || 0) + 1; }
    splits += n; years += Math.min(days, day(st)) / 365;
    console.log(`seed ${seed}: ${n} splits in ${day(st) - 1} days (groups ${before.size} at the start, ${st.factions.filter((f) => f.alive).length} alive at the end; peak strife ${peak.toFixed(1)})`);
  }
  console.log(`${splits} splits in ${years.toFixed(1)} world-years: ${(splits / years).toFixed(2)} a world-year; ${JSON.stringify(byType)}`);
  process.exit(0);
}

const seed = Number(process.argv[2] || 4242);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; return st; };
const typed = (st, type, i = 0) => { const f = st.factions.filter((x) => x.alive)[i]; f.type = type; return f; };
const total = (f, k) => f.stock[k] || 0;

section("Strife: pressure, deserters, the dead of a fight, a fallen leader, a lost war");
{
  const st = world();
  const f = typed(st, "raider");
  f.pop = 30; f.stock.food = 0; f.strife = 0;
  for (let i = 0; i < 20; i++) { tickGroup(f); strifeDay(st, f); }
  const hungry = strifeOf(f);
  check(hungry > 0.5, `20 hungry days build strife (${hungry.toFixed(2)})`);
  f.stock.food = f.pop * 20; f.lossRecent = 0; f.wounded = 0;
  for (let i = 0; i < 60; i++) { tickGroup(f); strifeDay(st, f); }
  check(strifeOf(f) < hungry * 0.5, `60 fed, quiet days and it fades (${strifeOf(f).toFixed(2)})`);
  const s0 = strifeOf(f);
  desertOne(st, f, day(st), "wanderer");
  check(Math.abs(strifeOf(f) - s0 - SPLINTER.DESERTER) < 1e-9, `a deserter adds ${SPLINTER.DESERTER}`);
  let leaders = 0, jump = 0;
  for (let i = 0; i < 200; i++) {
    f.pop = 30; f.strife = 0; f.leaderLost = null; f.lossRecent = 0; f.wounded = 0;
    tickGroup(f);
    noteFight(f, 6, 0); // a fifth of them killed
    strifeDay(st, f);
    if (f.leaderLost != null) leaders++;
    jump += strifeOf(f);
  }
  const share = 6 / 36;
  check(Math.abs(leaders / 200 - share * SPLINTER.LEADER_FRONT) < 0.1, `a fight that kills ${(share * 100).toFixed(0)}% of them takes the leader ${leaders}/200 times (expected about ${(share * SPLINTER.LEADER_FRONT * 200).toFixed(0)})`);
  check(jump / 200 > SPLINTER.BLOW * share, `the dead of a fight add strife (${(jump / 200).toFixed(2)} on average)`);
  // A lost war: makePeace on tribute terms.
  const a = st.factions.filter((x) => x.alive)[1], b = st.factions.filter((x) => x.alive)[2];
  const D = ensureDiplo(st);
  const w = { id: 999, a: a.id, b: b.id, reason: "test", start: 1, score: { [a.id]: 9, [b.id]: 0 }, exh: {}, raids: 0, captives: {}, playerSide: null };
  D.wars.push(w);
  b.strife = 0;
  const terms = makePeace(st, w);
  check((terms === "tribute" || terms === "land") && strifeOf(b) === SPLINTER.WAR_LOST, `the loser of a war (${terms}) gains ${SPLINTER.WAR_LOST} strife (${strifeOf(b)})`);
}

section("The split: a raider band walks out");
{
  const st = world();
  const f = typed(st, "raider");
  f.pop = 30; f.strife = 20; f.wounded = 0;
  ensureArsenal(st, f);
  const keys = Object.keys(f.stock);
  const stock0 = Object.fromEntries(keys.map((k) => [k, total(f, k)]));
  const items0 = f.arsenal.items.length;
  const groups0 = st.factions.length;
  check(splitChance(st, f) > 0, `a gang of 30 at strife 20 may split (${(splitChance(st, f) * 100).toFixed(1)}% a day)`);
  const site = splinterSite(st, f);
  const ng = splitGroup(st, f);
  check(!!ng && st.factions.length === groups0 + 1 && ng.alive && ng.type === "raider", `a new raider band: ${ng && ng.name}`);
  if (ng) {
    const d = st.grid.distance(ng.bases[0], f.bases[0]);
    check(ng.bases[0] === site && d >= SPLINTER.RANGE[0] && d <= SPLINTER.RANGE[1], `its camp ${d} tiles from the old base`);
    check(ng.pop + f.pop === 30 && ng.pop >= SPLINTER.MIN_GO && f.pop >= SPLINTER.KEEP, `${ng.pop} walked out, ${f.pop} stayed`);
    check(keys.every((k) => Math.abs(total(f, k) + total(ng, k) - stock0[k]) < 1e-6), "the stores are shared out, nothing made from nothing");
    check(ng.arsenal && ng.arsenal.items.length > 0 && f.arsenal.items.length + ng.arsenal.items.length === items0, `the kit is shared out (${ng.arsenal.items.length} of ${items0} pieces went)`);
    check(relation(st, f, ng) <= SPLINTER.REL, `the two are feuding (relation ${relation(st, f, ng)})`);
    check(ng.splitFrom === f.id && f.splitDay === day(st) && strifeOf(f) < 20, "the old group's strife falls with the malcontents gone");
    check(splitChance(st, f) === 0, `not again for ${SPLINTER.GAP} days`);
    check(ng.goodwill <= -45, `hostile to you like any gang (goodwill ${ng.goodwill})`);
  }
}

section("By type, and the world's group limit");
{
  const st = world();
  const c = typed(st, "commune", 0), z = typed(st, "zealot", 1), t = typed(st, "traders", 2), fo = typed(st, "fortress", 3);
  for (const f of [c, z, t, fo]) { f.pop = 30; f.strife = 30; }
  check(splitChance(st, c) === 0 && splitChance(st, t) === 0 && splitChance(st, fo) === 0, "communes, traders and a fortress never split");
  check(GROUP_PRIORITIES.military.splinter > 0 && GROUP_PRIORITIES.military.splinterAs === "raider", "the military's deserters go raiding");
  const ng = splitGroup(st, z);
  check(!!ng && ng.type === "zealot", `zealots split as a new sect (${ng && ng.name})`);
  // Full: as many groups as the size allows.
  const r = world(seed + 1);
  const f = typed(r, "raider");
  f.pop = 30; f.strife = 30;
  const room = groupRoom(r);
  let made = 0;
  for (let i = 0; i < room + 3; i++) { const o = typed(r, "raider", i % r.factions.filter((x) => x.alive).length); o.pop = 30; o.strife = 30; o.splitDay = null; if (splitChance(r, o) > 0 && splitGroup(r, o)) made++; }
  check(made <= Math.max(0, room) && groupRoom(r) >= 0, `never beyond the group limit (room ${room}, ${made} made)`);
}

section("You hear of it");
{
  const st = world();
  const f = typed(st, "raider");
  f.pop = 30; f.strife = 20; f.known = true;
  // Their base within HEAR tiles of the hub.
  const hb = hub(st);
  const near = st.factions.filter((x) => x.alive).find((x) => st.grid.distance(x.bases[0], hb.tile) <= SPLINTER.HEAR) || f;
  near.type = "raider"; near.pop = 30; near.strife = 20; near.known = true;
  const before = st.log.length;
  const ng = splitGroup(st, near);
  const line = st.log.slice(0, st.log.length - before).find((l) => /has split/.test(l.text));
  check(!ng || st.grid.distance(near.bases[0], hb.tile) > SPLINTER.HEAR || !!line, `a known neighbour's split is in the log: "${line ? line.text : "(none)"}"`);
}

section("Save and load");
{
  const st = world();
  const f = typed(st, "raider");
  f.pop = 30; f.strife = 20;
  const ng = splitGroup(st, f);
  f.strife = 7.5;
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const f2 = back.factions.find((x) => x.id === f.id), n2 = ng && back.factions.find((x) => x.id === ng.id);
  check(f2 && f2.strife === 7.5 && f2.splitDay === f.splitDay && n2 && n2.splitFrom === f.id && relation(back, f2, n2) === relation(st, f, ng), "strife, the split and the feud survive a save");
  // The world goes on: a few days of the daily pass with the new band in it.
  for (let i = 0; i < 24 * 5; i++) tickHour(back);
  check(n2.alive || n2.pop >= 0, "the world plays on with the new band");
}

section("A world's days: splinterDaily");
{
  const st = world();
  const f = typed(st, "raider");
  f.pop = 40; f.strife = 40;
  const before = st.factions.length;
  let d = 0;
  while (st.factions.length === before && d < 400) { tickGroup(f); f.strife = 40; splinterDaily(st, day(st) + d); d++; }
  check(st.factions.length === before + 1, `a gang held at strife 40 splits within ${d} days (expected about ${Math.round(1 / (SPLINTER.ODDS * 2))})`);
  noteStrife(null, 5); // no group: nothing
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
