// Eras (src/sim/eras.js, outbreak.js): the calendar (game years of 112 days, as weather.js), the threats growing by
// year (hordes, the aggressive groups' arms, recruits and new gangs, outsider raider bands), the victories' clocks
// (no victory before year 10, the Calder Accord held for a year of the late game, the hive victory only once the outbreak beyond the
// border has burned out and the state has been kept clear for a season), new hives rising near the border while
// it burns, and then a short long-run check: autopilot campaigns (one per style) to the end of year 6 — no victory
// before year 10, hives and aggressive groups still in the state at the start of year 5, no NaN, no crash.
// Usage: node tools/eratest.js [days=658] (the long-run part; 658 = the last day of year 6)
//   BS_QUICK=1 (npm run test:quick): the same checks on less: the coalition's world played 15 days (not 30), the
//   hives destroyed on day 5 (not 20) and the border's hive watched until it has started (not to day 90), two campaigns (cautious, aggressive) in two
//   workers to day 61 (not three to day 658): the hives and aggressive groups are checked there, not in year 5.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { createWorld, tickHour, day, checkGameOver } from "../src/sim/world.js";
import { seasonOfDay, YEAR_DAYS as WEATHER_YEAR } from "../src/sim/weather.js";
import * as E from "../src/sim/eras.js";
import { ensureAlliance, controlledLand, landCentres, ALLIANCE, allianceVictory, goalsProgress } from "../src/sim/alliance.js";
import { destroyHive, hivesSecured } from "../src/sim/hives.js";
import { strength, makeGang, factionsDaily } from "../src/sim/factions.js";
import { eraArms, unitPower } from "../src/sim/arsenal.js";
import { assaultForce } from "../src/sim/conquest.js";
import { relation, changeRelation } from "../src/sim/diplomacy.js";
import { makeHorde } from "../src/sim/hordes.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { FACTION_TYPES } from "../src/sim/data.js";
import { runCampaign } from "./balancesim.js";

if (!isMainThread && workerData === "eratest") {
  parentPort.on("message", (spec) => parentPort.postMessage(runCampaign(spec)));
} else if (isMainThread) await main();

async function main() {
  const QUICK = !!process.env.BS_QUICK;
  const DAYS = Number(process.argv[2] || (QUICK ? 61 : 658));
  let pass = 0, fail = 0;
  const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
  const world = (seed = 42) => { const st = createWorld({ seed, factionCount: 8 }); st.started = true; return st; };
  const at = (st, d) => { st.hour = (d - 1) * 24 + 6; return st; };
  const t0 = Date.now();

  console.log("Calendar");
  {
    check(E.YEAR_DAYS === WEATHER_YEAR, `a year is ${E.YEAR_DAYS} days, as weather.js`);
    const ok = [1, 98, 99, 210, 211, 434, 435, 546, 547, 995, 1555, 1666, 1667].every((d) => E.yearOfDay(d) === seasonOfDay(d - 1).year);
    check(ok, "yearOfDay matches the season display's year on days 1, 98, 99, 435, 547, 995, 1555, 1667 ...");
    check([2, 5, 6, 10, 15].every((y) => E.yearOfDay(E.yearStartDay(y)) === y && E.yearOfDay(E.yearStartDay(y) - 1) === y - 1), `years start on days ${[2, 5, 6, 10, 15].map(E.yearStartDay).join(", ")} (years 2, 5, 6, 10, 15)`);
    const st = world();
    // Retimed 2026-10-09 (the progression census): the mid game from year 5, the late game (and the victories) from year 10.
    const [, mid, late] = E.ERAS.LIST.map((x) => x.from);
    check(mid === 5 && late === 10 && E.ERAS.WIN_FROM_YEAR === late, `the eras: mid game from year ${mid}, late game from year ${late}, the victories open with it (year ${E.ERAS.WIN_FROM_YEAR})`);
    check(E.eraOf(at(st, 50)).key === "early" && E.eraOf(at(st, E.yearStartDay(mid) - 1)).key === "early" && E.eraOf(at(st, E.yearStartDay(mid))).key === "mid" && E.eraOf(at(st, E.yearStartDay(late) - 1)).key === "mid" && E.eraOf(at(st, E.yearStartDay(late))).key === "late",
      `eras: early in years 1–${mid - 1}, mid from year ${mid} (day ${E.yearStartDay(mid)}), late from year ${late} (day ${E.yearStartDay(late)})`);
  }

  console.log("Threats grow by year");
  {
    const st = world();
    const g = (d) => { at(st, d); return { h: E.hordeGrowth(st), a: E.gangArms(st), r: E.raiderSizeBonus(st), p: E.raiderPowerBonus(st), gp: E.gangPopBonus(st), rc: E.recruitBonus(st) }; };
    const y2 = g(E.yearStartDay(3) - 1), y3 = g(E.yearStartDay(3)), y5 = g(E.yearStartDay(5)), y30 = g(E.yearStartDay(30));
    check(y2.h === 1 && y2.a === 1 && y2.r === 0 && y2.p === 0 && y2.gp === 0 && y2.rc === 0, `nothing grows before year ${E.ERAS.GROW_FROM}`);
    check(y3.h > 1 && y5.h > y3.h && y5.a > y3.a && y5.r > y3.r && y5.p > y3.p, `year 3 → 5: hordes ×${y3.h.toFixed(2)} → ×${y5.h.toFixed(2)}, gang arms ×${y3.a.toFixed(2)} → ×${y5.a.toFixed(2)}, raider bands +${y3.r} → +${y5.r} people, +${y3.p.toFixed(1)} → +${y5.p.toFixed(1)} power`);
    check(y30.h === 1 + E.ERAS.GROW.hordeMax && y30.a === 1 + E.ERAS.GROW.gangArmsMax && y30.r === E.ERAS.GROW.raiderSizeMax, "the growth stops at its caps");
    // A new roaming horde in year 6 is bigger, a split part is not.
    at(st, E.yearStartDay(6));
    const tile = st.tiles.find((t) => t.terrain !== "water").id;
    const h = makeHorde(st, { tile, size: 100, role: "roam" }), gd = makeHorde(st, { tile, size: 100, role: "guard" }), sp = makeHorde(st, { tile, size: 100, role: "roam", split: true });
    check(h.size === Math.round(100 * E.hordeGrowth(st)) && gd.size === 100 && sp.size === 100, `year 6: a new roaming horde of 100 comes as ${h.size}; a hive's guard and a split part keep their size`);
    st.hordes.length = 0;
    // Aggressive groups arm themselves; a peaceful group does not.
    const agg = st.factions.find((f) => ["raider", "zealot", "expansionist"].includes(f.type) && f.alive);
    const calm = st.factions.find((f) => ["traders", "commune", "military", "fortress"].includes(f.type) && f.alive);
    factionsDaily(st);
    // Through their arsenal (arsenal.js kitFactor × eraArms): the strength by the numbers and their battle units' power.
    const noEra = (f, fn) => { const g0 = f.gear; f.gear = 1; const v = fn(f); f.gear = g0; return v; };
    const ratio = strength(agg) / noEra(agg, strength), uRatio = (unitPower(agg) - 2.2) / (noEra(agg, unitPower) - 2.2);
    check(agg.gear === E.gangArms(st) && Math.abs(ratio - E.gangArms(st)) < 1e-9 && Math.abs(uRatio - E.gangArms(st)) < 1e-9 && strength(calm) === noEra(calm, strength) && eraArms(calm) === 1,
      `year 6: an aggressive group's strength ×${ratio.toFixed(2)} through its arsenal (its fighters' power too); a ${calm.type} group's unchanged`);
    const gang = makeGang(st, st.tiles.find((t) => t.loc && t.owner == null && !t.hive).id, { type: "raider", pop: 15 });
    check(gang.gear === E.gangArms(st) && eraArms(gang) === 1, "a new gang arrives with the year's arms, in the kit it brings (not counted twice)");
  }

  console.log("Coalition fighters in base assaults");
  {
    const st = world(4);
    const g = st.grid;
    let pair = null;
    for (const f of st.factions) for (const m of st.factions) {
      if (pair || f === m || !f.alive || !m.alive) continue;
      if (m.bases.some((b) => g.distance(b, f.bases[0]) <= 15)) pair = { f, m };
    }
    if (check(!!pair, "two groups within 15 tiles of each other")) {
      const { f, m } = pair;
      if (relation(st, m, f) >= 10) changeRelation(st, m, f, -40 - relation(st, m, f));
      f.pop = 40;
      const before = assaultForce(st, f, f.bases[0]);
      const A = ensureAlliance(st);
      A.members.push(m.id);
      const mid = assaultForce(st, f, f.bases[0]);
      at(st, E.yearStartDay(E.ERAS.LIST[2].from)); // the late game
      const late = assaultForce(st, f, f.bases[0]);
      check(mid.count < before.count && mid.allies && late.count < mid.count,
        `a member nearby keeps defenders busy: ${before.count} → ${mid.count} (year 1) → ${late.count} (late game, one more fighter)`);
      check(late.count >= Math.min(before.count, 3) && before.count - late.count <= Math.floor(before.count * 0.4), "at most 40% of them, at least 3 left");
    }
  }

  console.log("Victory clocks");
  {
    // The coalition: every group in and over half the land on day 30 is not a victory; the Accord has to run.
    const st = world(1);
    setAutopilot(st, true, "balanced"); // played: left alone, a bare-start holdout is gone by day 30 (and the game with it)
    const CLOCK_DAY = QUICK ? 15 : 30; // quick: still year 1, half the autopilot days
    while (day(st) < CLOCK_DAY) tickHour(st);
    setAutopilot(st, false);
    const A = ensureAlliance(st);
    for (const f of st.factions) if (f.alive) { f.known = true; f.pact = "trade"; f.goodwill = 80; if (!A.members.includes(f.id)) A.members.push(f.id); }
    A.founded = 1;
    let n = 0;
    const g = st.grid;
    while (controlledLand(st).pct <= ALLIANCE.LAND_NEEDED && n < 40) {
      const held = new Uint8Array(st.tiles.length);
      for (const c of landCentres(st)) for (const id of g.within(c.tile, c.r)) held[id] = 1;
      const t = st.tiles.find((x) => x.terrain !== "water" && !held[x.id] && !x.hive && !st.bases.some((b) => b.tile === x.id) && st.factions.every((f) => !f.bases.includes(x.id)));
      if (!t) break;
      st.bases.push({ id: 900000 + n, tile: t.id, type: "outpost", name: `Test ${n}`, stock: { food: 0, water: 0 }, buildings: [], construction: [], armory: [] });
      n++;
    }
    st.hives.length = 0; st.hiveSites.length = 0; // 2026-10-13: the coalition wins only with no hive standing and no group outside
    check(allianceVictory(st), `the coalition's conditions hold on day ${CLOCK_DAY} (${n} outposts, ${(controlledLand(st).pct * 100).toFixed(0)}% land)`);
    check(!checkGameOver(st), "but no victory: it is year 1 and the Accord has not been held");
    E.erasVictoryDaily(st, true, false); E.erasVictoryDaily(st, true, false);
    check(st.era.accord === 0 && st.era.accordFirst != null, `the Accord's clock does not run before year ${E.ERAS.WIN_FROM_YEAR} (the land held on day ${CLOCK_DAY}: first held noted, 0 days counted)`);
    at(st, E.yearStartDay(E.ERAS.WIN_FROM_YEAR));
    E.erasVictoryDaily(st, true, false); E.erasVictoryDaily(st, true, false); E.erasVictoryDaily(st, false, false);
    check(st.era.accord === 0, "from then it counts a day it holds and loses two for a day it does not");
    at(st, E.yearStartDay(E.ERAS.WIN_FROM_YEAR) - 1);
    st.era.accord = E.ERAS.ACCORD.DAYS;
    check(!checkGameOver(st), `a full Accord in year ${E.ERAS.WIN_FROM_YEAR - 1}: still no victory (none before year ${E.ERAS.WIN_FROM_YEAR})`);
    at(st, E.yearStartDay(E.ERAS.WIN_FROM_YEAR));
    st.era.accord = E.ERAS.ACCORD.DAYS - 1;
    check(!checkGameOver(st), `year ${E.ERAS.WIN_FROM_YEAR}, the Accord one day short: no victory`);
    st.era.accord = E.ERAS.ACCORD.DAYS;
    A.founded = day(st) - 28 * E.ERAS.ACCORD.SEASONS + 28;
    check(!checkGameOver(st), `the Accord held but the coalition only ${E.coalitionSeasons(st)} seasons old: no victory`);
    A.founded = 1;
    check(checkGameOver(st) && st.victory && st.victoryReason === "alliance", `year ${E.ERAS.WIN_FROM_YEAR}, the Accord held ${E.ERAS.ACCORD.DAYS} days, the coalition ${E.coalitionSeasons(st)} seasons old: the coalition's victory`);
    const gp = goalsProgress(st);
    check(gp.era && gp.era.year === E.ERAS.WIN_FROM_YEAR && gp.era.accordNeed === E.ERAS.ACCORD.DAYS, "the Goals panel's numbers (goalsProgress.era)");

    // The hives: every one destroyed in year 1: new ones rise near the border, and no hive victory.
    const s2 = world(3);
    setAutopilot(s2, true, "balanced");
    while (day(s2) < (QUICK ? 5 : 20)) tickHour(s2); // quick: the hives destroyed on day 5 (the border's mass comes 20–40 days later)
    for (const h of [...s2.hives]) destroyHive(s2, h, "test");
    // poured: the border's log line, seen as it is written (the log keeps 200 lines: by day 90 a busy run has scrolled it out).
    let border = null, secured = 0, poured = false;
    // Quick: stopped once the border's hive has started and the log said so.
    while (day(s2) < 90 && !s2.gameOver && !(QUICK && border && border.started != null && poured)) { tickHour(s2); if (s2.hour % 24 === 0 && hivesSecured(s2)) secured++; if (!border) border = s2.hiveSites.find((x) => x.border) || null; if (!poured) poured = s2.log.slice(0, 20).some((l) => /pouring over the/.test(l.text)); }
    check(!!border && border.started != null, `a mass of the dead comes over the border and starts a hive (${border ? `day ${Math.floor(border.chosen / 24) + 1}` : "none"})`);
    check(!s2.victory, `no hive victory (${secured} days with no hive standing or being built, before the outbreak burned out)`);
    check(s2.hives.length + s2.hiveSites.filter((x) => x.started != null).length >= 1 && poured, `hives in the state again on day ${QUICK ? day(s2) : 90} (${s2.hives.length} standing, ${s2.hiveSites.length} sites); the log says so`);
    // After the burn-out and a season clear: the hive victory.
    const s3 = world(5);
    s3.hives.length = 0; s3.hiveSites.length = 0;
    for (const t of s3.tiles) t.hive = false;
    at(s3, E.yearStartDay(E.burnoutYear(s3)) - 1);
    check(E.hiveFloor(s3) >= 1 && !checkGameOver(s3), `year ${E.burnoutYear(s3) - 1}: the outbreak beyond the border still burns (it keeps ${E.hiveFloor(s3)} hive(s)): no hive victory`);
    at(s3, E.yearStartDay(E.burnoutYear(s3)));
    check(E.hiveFloor(s3) === 0 && E.burnedOut(s3), `year ${E.burnoutYear(s3)}: it has burned out (this world's year, ${E.ERAS.OUTBREAK.BURNOUT.join("–")})`);
    const capAfter = E.hiveCap(s3), capBefore = E.hiveCap(at(world(5), E.yearStartDay(E.burnoutYear(s3)) - 1));
    check(capAfter === 0 && capBefore > 0, `and from then no new hive site is picked (hiveCap ${capAfter}; the year before, ${capBefore})`);
    check(E.hiveStarve(s3) === E.ERAS.OUTBREAK.STARVE && E.ERAS.OUTBREAK.STARVE < 1 && E.hiveStarve(at(world(5), E.yearStartDay(E.burnoutYear(s3)) - 1)) === 1, `and the hives left starve: their resources × ${E.ERAS.OUTBREAK.STARVE} (× 1 the year before)`);
    E.ensureEraState(s3).clear = E.ERAS.CONTAIN.DAYS - 1;
    check(!checkGameOver(s3), "a day short of a season clear: no victory");
    s3.era.clear = E.ERAS.CONTAIN.DAYS;
    check(checkGameOver(s3) && s3.victory && s3.victoryReason === "hives", "a season clear: the hive victory");
    E.ensureEraState(s2);
    E.erasVictoryDaily(s2, false, true); E.erasVictoryDaily(s2, false, false);
    check(s2.era.clear === 0, "a hive rising again (or a site starting) sets the count back to zero");
  }

  console.log(`Long runs: ${QUICK ? "two autopilot campaigns (cautious, aggressive)" : "one autopilot campaign per style"} to day ${DAYS} (end of year ${E.yearOfDay(DAYS)})`);
  {
    const specs = ["cautious", "balanced", "aggressive"].map((style, i) => ({ seed: 11 + i, style, days: DAYS })).filter((s) => !QUICK || s.style !== "balanced"); // quick: two workers
    const results = await Promise.all(specs.map((spec) => new Promise((resolve, reject) => {
      // A heap cap a campaign: its live heap stays a few hundred MB, but uncapped each worker grew to 1.8 GB on the
      // 500 × 500 base maps (5.4 GB for the three, killed by the machine's memory limit with the other tests running,
      // 2026-10-24); capped at 1 GB the three peaked at 2.6 GB with no slower days.
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: "eratest", resourceLimits: { maxOldGenerationSizeMb: 1024 } });
      w.on("message", (r) => { w.terminate(); resolve(r); });
      w.on("error", reject);
      w.postMessage(spec);
    })));
    // Quick: the campaigns end on day 61 (balancesim samples every 30 days), so the hives and the aggressive groups are
    // looked at there (a weaker check than year 5's: the threats have not grown yet, but neither must the state have
    // been cleared).
    const AT = QUICK ? "day 61" : "the start of year 5";
    const y5 = QUICK ? 61 : E.yearStartDay(5), win = E.yearStartDay(E.ERAS.WIN_FROM_YEAR);
    for (const r of results) {
      const s5 = r.samples.find((s) => s.day === y5);
      const won = r.outcome === "hives" || r.outcome === "alliance";
      check(r.outcome !== "crash" && !r.problems.length, `${r.style} seed ${r.seed}: ${r.outcome} on day ${r.endDay} (year ${E.yearOfDay(r.endDay)}), no crash, NaN or stuck team${r.problems.length ? `: ${r.problems[0]}` : ""}`);
      check(!won || r.endDay >= win, `${r.style}: no victory before year ${E.ERAS.WIN_FROM_YEAR} (day ${win})`);
      // One campaign a style: a gang can be ground down days before the next one settles from beyond the border, so
      // the aggressive groups are checked over the three runs (below); the hives in every one.
      if (s5) check(s5.hives + s5.building > 0, `${r.style}: ${AT.replace(/^the /, "")}: ${s5.hives} hives (+${s5.building} building), ${s5.agg} aggressive groups, ${s5.hordes} hordes, ${s5.pop} people`);
      else if (DAYS >= y5) check(r.outcome === "fell" && r.endDay < y5, `${r.style}: fell before ${QUICK ? "day 61" : "year 5"} (day ${r.endDay}), so nothing to check there`);
    }
    const with5 = results.map((r) => r.samples.find((s) => s.day === y5)).filter(Boolean);
    if (with5.length) check(with5.filter((s) => s.agg > 0).length >= Math.min(2, with5.length), `aggressive groups still in the state at ${AT} in at least two of the ${QUICK ? "two" : "three"} runs (${with5.map((s) => s.agg).join(", ")})`);
  }
  console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  process.exit(fail ? 1 : 0);
}
