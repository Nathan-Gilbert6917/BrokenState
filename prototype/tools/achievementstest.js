// Achievements per run (sim/achievements.js; the user's request 2026-10-25), headless:
// - the table: about 25 rows or more, unique ids, a group, icon, name and description each, modes from hardcore.js
//   MODES, the hidden ones flagged;
// - awards from a set-up world: each fact set by hand (the dead put down, a radio, a solar array, a child, a hive's
//   victory, a group in the coalition, a Broodmother on the battle map, a raid on a military site, partners who
//   lasted, the founders alive at a victory) earns its row once, with the day, a log line, and no second award;
// - mode filters: a normal run never earns Hardcore's or Crashlanding's rows, a Hardcore run earns "Life on the road";
// - an older save without state.ach loads and earns as usual;
// - recording only: the checks never touch state.rng, and a seed played on the autopilot with achievements on and
//   off (state.achOff) ends the same (tools/digest.js over the state and every log line but the achievements'); the
//   run with them earns "A month on" on day 30.
// Usage: node tools/achievementstest.js [days=32]  (BS_QUICK=1: the same)
import { createWorld, tickHour, day, alive, newId, hub } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { MODES } from "../src/sim/hardcore.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { ACHIEVEMENTS, ACH, achievementsOf, achievementsDaily, achievementsEnd, achievementsBattle, earnAch, hasAch, runMode, achievementsFor, foundersOf } from "../src/sim/achievements.js";
import { digest } from "./digest.js";

const days = Number(process.argv[2] || 32);
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`FAIL ${msg}`); } else console.log(`ok   ${msg}`); };
const rngOf = (st) => JSON.stringify(st.rng);
const achLines = (st) => st.log.filter((l) => l.text.startsWith("🏆 Achievement")).map((l) => l.text);

// ---------- the table ----------
{
  const ids = ACHIEVEMENTS.map((a) => a.id);
  check(ACHIEVEMENTS.length >= 25, `${ACHIEVEMENTS.length} achievements (about 25 asked)`);
  check(new Set(ids).size === ids.length, "ids are unique");
  check(ACHIEVEMENTS.every((a) => a.name && a.desc && a.icon && a.group), "every row has a name, a description, an icon and a group");
  check(ACHIEVEMENTS.every((a) => !a.modes || a.modes.every((m) => MODES[m] || m === "road")), "every row's modes are run modes (hardcore.js MODES), or \"road\": any road start (issue #79)");
  const hidden = ACHIEVEMENTS.filter((a) => a.hidden).map((a) => a.id);
  check(hidden.includes("love") && hidden.includes("founders") && hidden.length === 2, `the hidden ones are flagged (${hidden.join(", ")})`);
}

// ---------- awards on a set-up world ----------
const st = createWorld({ seed: 5, factionCount: 6 });
st.started = true;
check(!st.ach && achievementsOf(st).length === 0, "a new run starts with none");
check(runMode(st) === "normal", "a plain run's mode is normal");
{
  const r0 = rngOf(st);
  achievementsDaily(st);
  check(!achievementsOf(st).length, "nothing earned on day 1 of a fresh world");
  // The facts, set by hand.
  const people = alive(st);
  people[0].rec = { ...(people[0].rec || {}), killsZ: ACH.kills - 10 };
  people[1].rec = { ...(people[1].rec || {}), killsZ: 10, hives: 1 };
  const h = hub(st);
  h.radio = true;
  h.buildings.push({ id: newId(), type: "solar_array" });
  st.family = { births: 1, bornOn: {} };
  st.stats.raidsRepelled = 1;
  const a = people[0], b = people[1];
  const k = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  st.rel = st.rel || {};
  st.rel[k] = { o: 80, h: 20, met: 1, p: true, pDay: 1 };
  st.hour += 24 * (ACH.love + 1); // day 102: past the hundred days for the survival rows and the partners
  const got = achievementsDaily(st);
  for (const id of ["kills", "hive", "radio", "solar", "child", "held", "love", "day30", "day100", "nodeath"]) check(got.includes(id), `earned ${id}`);
  check(!got.includes("day365") && !got.includes("winhives") && !got.includes("founders"), "not earned what is not so (day 365, a victory, the founders)");
  check(st.ach.kills === day(st), `kept with its day (kills: day ${st.ach.kills})`);
  check(achLines(st).some((t) => t.includes("A thousand dead")), "a log line says so");
  const n = achLines(st).length;
  achievementsDaily(st);
  check(earnAch(st, "kills") === false && achLines(st).length === n, "no second award");
  check(rngOf(st) === r0, "the daily pass never touches state.rng");

  // Mode filters: a normal run never earns Hardcore's or Crashlanding's rows.
  check(!earnAch(st, "road") && !earnAch(st, "bunker") && !earnAch(st, "mainhub") && !hasAch(st, "road"), "a normal run cannot earn Hardcore's or Crashlanding's rows");
  check(achievementsFor(st).every((x) => !x.modes || x.modes.includes("normal")), "achievementsFor lists the normal run's rows only");
  st.crash = { stage: "found", found: st.hour };
  check(runMode(st) === "crash" && earnAch(st, "bunker"), "a Crashlanding run earns the bunker");
  delete st.crash;

  // The endings: a victory with every founder alive.
  check(foundersOf(st).length === people.length, `the founders are the starting crew (${foundersOf(st).length})`);
  st.victory = true; st.hivesWon = true;
  achievementsEnd(st);
  check(hasAch(st, "winhives") && hasAch(st, "founders"), "the hive victory and the hidden founders' row at the ending");
  st.victory = false; st.hivesWon = false;

  // A battle's end: a raid won on a military site; a Broodmother put down by your people.
  const mil = st.tiles.findIndex((t) => t.loc && t.loc.type === "military");
  achievementsBattle(st, { mode: "raid", tile: mil }, { outcome: "defeat" }, null);
  check(!hasAch(st, "military"), "a raid lost on a military site earns nothing");
  achievementsBattle(st, { mode: "raid", tile: mil }, { outcome: "extracted" }, { tileId: mil, units: [{ boss: "broodmother", dead: true, killedBy: "player" }] });
  check(mil >= 0 && hasAch(st, "military") && hasAch(st, "brood"), "a raid won on a military site and a Broodmother put down");
  check(rngOf(st) === r0, "no award touched state.rng");
  // The list the UI and the hall of fame read: oldest first, known ids only.
  st.ach.gone = 3; // a row taken out of the table
  const list = achievementsOf(st);
  check(list.every((x) => x.id !== "gone") && list.every((x, i) => i === 0 || list[i - 1].day <= x.day), "achievementsOf: known ids, oldest first");
  delete st.ach.gone;
}

// ---------- an older save without state.ach ----------
{
  delete st.ach;
  const back = loadFromString(saveToString(st, { dropCards: true }));
  check(achievementsOf(back).length === 0, "an older save without state.ach loads with none");
  achievementsDaily(back);
  check(hasAch(back, "day30") && hasAch(back, "kills"), "and earns as usual after");
}

// ---------- Hardcore: life on the road ----------
{
  const hc = createWorld({ seed: 5, factionCount: 6, mode: "hardcore" });
  hc.started = true;
  check(runMode(hc) === "hardcore", "a Hardcore run's mode is hardcore");
  hc.hour += 24 * ACH.road;
  const noBase = !hc.bases.length;
  achievementsDaily(hc);
  check(!noBase || hasAch(hc, "road"), `Hardcore, ${ACH.road} days with no base: Life on the road${noBase ? "" : " (skipped: this start has a base)"}`);
  check(!hasAch(hc, "bunker"), "a Hardcore run never earns the bunker");
}

// ---------- the same seed with and without achievements ----------
const ID_STEP = 1e6;
function run(off) {
  let id0 = newId();
  while (id0 % ID_STEP) id0 = newId();
  const w = createWorld({ seed: 42, factionCount: 8 });
  w.started = true;
  if (off) w.achOff = true;
  setAutopilot(w, true, "balanced");
  const lines = [];
  const unshift = w.log.unshift;
  w.log.unshift = function (...x) { for (const l of x) if (!l.text.startsWith("🏆 Achievement")) lines.push(`${l.hour} ${l.text}`); return unshift.apply(this, x); };
  while (day(w) <= days && !w.gameOver) tickHour(w);
  const id1 = newId();
  const ach = w.ach;
  delete w.ach; delete w.achOff;
  return { st: w, lines, id0, id1, ach };
}
{
  const A = run(false), B = run(true);
  check(!!A.ach && A.ach.day30 === 30, `the run earned A month on on day 30 (${JSON.stringify(A.ach)})`);
  check(!B.ach, "the run with achievements off earned none");
  const da = digest(A), db = digest(B);
  check(JSON.stringify(A.st.rng) === JSON.stringify(B.st.rng), "the world's dice end in the same place with and without them");
  check(JSON.stringify(da) === JSON.stringify(db), `the same seed plays out the same with and without them (${days} days)`);
}

console.log(fails ? `\n${fails} check(s) failed` : "\nall achievement checks passed");
process.exit(fails ? 1 : 0);
