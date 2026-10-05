// Hardcore mode, the outbreak (src/sim/hardcore-outbreak.js, eras.js rampDay).
// - The start: 1–2 hives (never more), one by the outbreak origin, one 3–6 tiles from the military's base (a hive, or a
//   mass of the dead building one); no other hive, site or horde left from mapgen's hives; infection 0 away from the
//   outbreak areas on day 1; the era offset 180–365.
// - The first year (365 days, the player kept fed): infection spreads, towns and cities above open country by day 120;
//   by about day 365 the land's infection and the hive count are a normal start's (the same seed's normal world on its
//   day 1, printed side by side at days 1, 90, 180, 270, 365); no border hordes, no border hive and no tier above 0
//   before the offset allows; the military base's hive sends hordes that reach the base, and the base gives way in
//   the run (the day is printed).
// - The era offset: rampDay, the year, the victories' year, the outbreak floor, the tech tiers and the border mix in
//   a hardcore world count from the normal start; a normal world's are its own days.
// - Save / load a hardcore world mid-year: identical after another 30 days.
// Usage: node tools/hcoutbreaktest.js [seeds...]
import { createWorld, tickHour, day, hub } from "../src/sim/world.js";
import { HC, outbreakProgress, hardcoreEraOffset } from "../src/sim/hardcore-outbreak.js";
import { rampDay, yearOf, winOpen, hiveFloor, yearStartDay, ERAS, eraProgress, beforeFall, ensureEraState } from "../src/sim/eras.js";
import { hiveTier, eraTier, borderMix } from "../src/sim/hivetech.js";
import { TECH } from "../src/sim/hiveconst.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { raidEnemies } from "../src/sim/scavenge.js";

const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [42, 7, 1234, 2024];
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();
const at = (st, d) => { st.hour = (d - 1) * 24 + 6; return st; };
// The player kept alive and fed (the outbreak is under test, not the start).
const keep = (st) => {
  const h = hub(st);
  if (h) { h.stock.food = Math.max(h.stock.food || 0, 40); h.stock.water = Math.max(h.stock.water || 0, 40); }
  for (const s of st.survivors) if (s.alive) { s.health = 100; s.mood = Math.max(s.mood, 60); }
  // No raids and no hive attacks on your camp (eras.js pace): the groups and the start are not under test here.
  const E = ensureEraState(st);
  E.nextRaid = E.nextHorde = 1e9;
};

// Infection by kind of land: cities (city and suburb tiles), towns (within 2 of a town), open country (the rest).
function infStats(st) {
  const g = st.grid;
  const towns = st.tiles.filter((t) => t.loc && t.loc.type === "town").map((t) => t.id);
  const land = st.tiles.filter((t) => t.terrain !== "water");
  const urban = [], town = [], open = [];
  for (const t of land) {
    if (t.terrain === "city" || t.terrain === "suburb") urban.push(t);
    else if (towns.some((c) => g.distance(c, t.id) <= HC.SETTLE_R)) town.push(t);
    else if (!t.loc) open.push(t);
  }
  const m = (a) => (a.length ? a.reduce((s, t) => s + t.infection, 0) / a.length : 0);
  return { land: m(land), urban: m(urban), town: m(town), settle: m([...urban, ...town]), open: m(open), hot: land.filter((t) => t.infection >= 0.5).length / land.length };
}
const f3 = (v) => v.toFixed(3);
const row = (label, s, st) => `    ${label.padEnd(12)} land ${f3(s.land)}  cities ${f3(s.urban)}  towns ${f3(s.town)}  open ${f3(s.open)}  ≥50% ${f3(s.hot)}  hives ${st.hives.length}  sites ${st.hiveSites.length}`;

// ---------- 1. the start ----------
console.log("The start");
for (const seed of seeds) {
  const st = createWorld({ seed, factionCount: 7, mode: "hardcore" });
  const g = st.grid, O = st.hardcore.outbreak;
  const off = st.hardcore.eraOffset;
  check(off >= HC.ERA_OFFSET[0] && off <= HC.ERA_OFFSET[1] && off === hardcoreEraOffset(st), `seed ${seed}: era offset ${off} days (${HC.ERA_OFFSET.join("–")})`);
  check(st.hives.length >= 1 && st.hives.length + st.hiveSites.length <= 2, `seed ${seed}: ${st.hives.length} hive(s) and ${st.hiveSites.length} gathering mass(es) at the start (1–2 in all; a normal start has ${O.normalHives})`);
  check(st.hives.some((h) => g.distance(h.tile, st.originId) <= 6), `seed ${seed}: a hive by the outbreak origin`);
  const flagged = st.tiles.filter((t) => t.hive).map((t) => t.id).sort().join();
  check(flagged === st.hives.map((h) => h.tile).sort().join() && st.hiveSites.every((s) => s.hardcore === "military") &&
    st.hordes.every((h) => h.role === "mass" && st.hiveSites.some((s) => s.id === h.site)), `seed ${seed}: no hive, site or horde left from the hives taken off the map`);
  const mf = st.factions.find((f) => f.alive && f.type === "military");
  const base = mf ? mf.bases[0] : st.militaryIds[0];
  const milNear = [...st.hives.map((h) => h.tile), ...st.hiveSites.map((s) => s.tile)].filter((t) => g.distance(t, base) >= HC.MIL_DIST[0] && g.distance(t, base) <= HC.MIL_DIST[1]);
  check(milNear.length >= 1 && O.mil && O.mil.base === base, `seed ${seed}: a ${st.hiveSites.length ? "mass building a hive" : "hive"} ${milNear.length ? g.distance(milNear[0], base) : "?"} tiles from the ${mf ? `military's base (${mf.name})` : "National Guard base (no military group)"}`);
  const centres = [...st.hives.map((h) => h.tile), ...st.hiveSites.map((s) => s.tile)];
  const away = st.tiles.filter((t) => centres.every((c) => g.distance(c, t.id) > HC.START_R + 1));
  const hotAway = away.filter((t) => t.infection > 0.005).length;
  const s1 = infStats(st);
  check(hotAway === 0, `seed ${seed}: infection 0 on all ${away.length} tiles away from the outbreak areas (${hotAway} above 0); ${f3(s1.land)} on the land on average`);
  check(st.tiles.every((t) => t.infGoal != null), `seed ${seed}: every tile keeps its normal-start level as the goal`);
}

// ---------- 2. the first year ----------
console.log("The first year (the player kept fed)");
const firstYear = seeds.slice(0, 3);
for (const seed of firstYear) {
  const n = createWorld({ seed, factionCount: 7 });
  const sn = infStats(n);
  const st = createWorld({ seed, factionCount: 7, mode: "hardcore" });
  st.started = true;
  const off = st.hardcore.eraOffset;
  const O = st.hardcore.outbreak;
  const mf = st.factions.find((f) => f.alive && f.type === "military");
  console.log(`  seed ${seed}: era offset ${off}, normal start ${n.hives.length} hives, military ${mf ? `${mf.name} (pop ${mf.pop})` : "none"}, base meant to give way about day ${O.mil ? O.mil.overrun : "-"}`);
  console.log(row("normal d1", sn, n));
  const marks = { 1: infStats(st) };
  console.log(row("hardcore d1", marks[1], st));
  // Scavenging reads the infection (scavenge.js raidEnemies: the dead's power is 2 + 3 × infection off a hive's land):
  // a town far from the outbreak.
  const far = st.tiles.filter((t) => t.loc && t.loc.type === "town" && st.hives.every((h) => st.grid.distance(h.tile, t.id) > 10) && st.hiveSites.every((s) => st.grid.distance(s.tile, t.id) > 10));
  const town = far.length ? far[far.length >> 1] : null;
  const deadPower = () => { const z = raidEnemies(st, town.id).find((x) => x.kind === "zombies"); return z ? z.power : 0; };
  const pow1 = town ? deadPower() : null;
  let tierEarly = 0, borderEarly = 0, borderSiteEarly = 0, floorEarly = 0, overrun = null, hitDay = null;
  const milBase = O.mil ? O.mil.base : null;
  while (day(st) <= 365 && !st.gameOver) {
    tickHour(st);
    if (st.hour % 24 !== 0) continue;
    keep(st);
    const d = day(st);
    if (d < off + TECH.TIER_DAY[1] && st.hives.some((h) => hiveTier(st, h) > 0)) tierEarly++;
    if (d < Math.round(off * HC.BORDER_FROM) && st.hiveInfo.stats.border > 0) borderEarly++;
    if (d <= off && (st.hiveInfo.stats.borderSites || 0) > 0) borderSiteEarly++;
    if (d <= off && hiveFloor(st) !== 0) floorEarly++;
    if (mf && hitDay == null && mf.hordeHitDay != null) hitDay = mf.hordeHitDay;
    if (mf && overrun == null && (!mf.alive || !mf.bases.includes(milBase))) overrun = d;
    if ([90, 120, 180, 270, 365].includes(d) && !marks[d]) { marks[d] = infStats(st); console.log(row(`hardcore d${d}`, marks[d], st)); }
  }
  if (!check(!st.gameOver, `seed ${seed}: the run lasted the year`)) continue;
  check(marks[1].land < marks[90].land && marks[90].land < marks[180].land && marks[180].land <= marks[365].land + 0.01, `seed ${seed}: the infection grows through the year (${[1, 90, 180, 365].map((d) => f3(marks[d].land)).join(" → ")})`);
  check(marks[120].settle > marks[120].open * 1.3, `seed ${seed}: day 120: towns and cities (${f3(marks[120].settle)}) well above open country (${f3(marks[120].open)})`);
  check(marks[90].land < sn.land * 0.85, `seed ${seed}: day 90: still well below a normal start (${f3(marks[90].land)} vs ${f3(sn.land)})`);
  check(Math.abs(marks[365].land - sn.land) <= sn.land * 0.2 && Math.abs(marks[365].urban - sn.urban) <= 0.15, `seed ${seed}: day 365: the land at a normal start's level (${f3(marks[365].land)} vs ${f3(sn.land)}; cities ${f3(marks[365].urban)} vs ${f3(sn.urban)})`);
  if (town) check(pow1 <= 2.05 && deadPower() > pow1 + 0.1, `seed ${seed}: scavenging ${town.loc.name}: the dead's power ${pow1.toFixed(2)} on day 1, ${deadPower().toFixed(2)} on day 365 (it reads the infection)`);
  const want = n.hives.length;
  check(st.hives.length + st.hiveSites.filter((s) => s.started != null).length >= want - 1 && st.hives.length <= want + 2, `seed ${seed}: day 365: ${st.hives.length} hives (${st.hiveSites.length} sites) against a normal start's ${want} (${st.hiveInfo.stats.built} built this year, ${st.hiveInfo.stats.destroyed} destroyed)`);
  check(!tierEarly, `seed ${seed}: no hive past tier 0 before day ${off + TECH.TIER_DAY[1]} (offset + ${TECH.TIER_DAY[1]})`);
  check(!borderEarly && !borderSiteEarly && !floorEarly, `seed ${seed}: no border hordes before day ${Math.round(off * HC.BORDER_FROM)}, no border hive and no hive floor before the normal start (day ${off + 1})`);
  if (mf) {
    check(hitDay != null && hitDay <= 60, `seed ${seed}: the base's hive's hordes reached ${mf.name}'s base (first on day ${hitDay}; ${O.mil.sent} hordes, ${O.mil.dead} of the dead sent)`);
    check(overrun != null && overrun >= 40 && overrun <= 220, `seed ${seed}: ${mf.name}'s base gave way on day ${overrun} (meant for about day ${O.mil.overrun}; months 2–6)`);
  } else console.log(`    (seed ${seed}: no military group in this world: the hive near the National Guard base sends nobody)`);
}

// ---------- 3. the era offset ----------
console.log("The era offset");
{
  const st = createWorld({ seed: 42, factionCount: 7, mode: "hardcore" });
  const n = createWorld({ seed: 42, factionCount: 7 });
  const off = st.hardcore.eraOffset;
  check([1, 50, off, off + 1, off + 100].every((d) => rampDay(at(st, d)) === Math.max(1, d - off)) && [1, 50, 400].every((d) => rampDay(at(n, d)) === d), `ramp day: hardcore day N = normal day N − ${off} (at least 1); a normal world's is its day`);
  check(yearOf(at(st, off)) === 1 && yearOf(at(st, off + yearStartDay(3))) === 3 && yearOf(at(n, yearStartDay(3))) === 3, `the year counts from the normal start (hardcore day ${off + yearStartDay(3)} is year 3)`);
  const win = yearStartDay(ERAS.WIN_FROM_YEAR);
  check(!winOpen(at(st, win)) && !winOpen(at(st, win + off - 1)) && winOpen(at(st, win + off)) && winOpen(at(n, win)), `no victory before day ${win + off} (a normal world: day ${win})`);
  check(eraProgress(at(st, 100)).winDay === win + off && eraProgress(at(st, 100)).fall.before && !eraProgress(at(st, off + 2)).fall.before && eraProgress(at(n, 100)).fall === null, "the Goals panel's numbers: the victories' day and the first year");
  check(beforeFall(at(st, off)) && !beforeFall(at(st, off + 1)) && !beforeFall(at(n, 5)), "before the fall's year is out: until the offset");
  st.noOutbreak = true;
  check(hiveFloor(at(st, off)) === 0 && hiveFloor(at(st, off + 1)) === ERAS.OUTBREAK.FLOOR[0][1] && hiveFloor(at(n, 1)) === ERAS.OUTBREAK.FLOOR[0][1], `the outbreak beyond the border keeps its floor of hives from day ${off + 1} (a normal world: day 1)`);
  const T1 = TECH.TIER_DAY[1];
  check(eraTier(at(st, T1)) === 0 && eraTier(at(st, off + T1 - 1)) === 0 && eraTier(at(st, off + T1)) === 1 && eraTier(at(n, T1)) === 1, `tech tier 1 opens on day ${off + T1} (a normal world: day ${T1})`);
  const hive = st.hives[0];
  hive.born = 0;
  check(hiveTier(at(st, off + 10), hive) === 0 && hiveTier(at(st, off + Math.ceil(T1 * (1 + TECH.JITTER)) + 1), hive) >= 1, "a hive's tier: by the ramp day");
  check(borderMix(at(st, TECH.BORDER_DAY)) === null && borderMix(at(st, TECH.BORDER_DAY + off)) !== null && borderMix(at(n, TECH.BORDER_DAY)) !== null, `border hordes carry the special dead from day ${TECH.BORDER_DAY + off} (a normal world: ${TECH.BORDER_DAY})`);
  check(n.hardcore === undefined && n.tiles.every((t) => t.infGoal === undefined) && n.hives.length >= 5, "a normal world: no hardcore state, no first-year goal levels, its 5–6 hives");
}

// ---------- 4. save and load ----------
console.log("Save and load");
{
  const st = createWorld({ seed: 7, factionCount: 7, mode: "hardcore" });
  st.started = true;
  while (day(st) < 80 && !st.gameOver) { tickHour(st); if (st.hour % 24 === 0) keep(st); }
  st.cards = [];
  const text = saveToString(st);
  // The chronicle's own timing (ms spent recording) is the one number that is not the world's (as in savetest.js).
  const play = (w) => { for (let i = 0; i < 30 * 24 && !w.gameOver; i++) { tickHour(w); if (w.hour % 24 === 0) keep(w); w.cards = []; } if (w.chronicle) w.chronicle.ms = 0; };
  play(st); // the original first: loading sets the id counter (world.js newId) back to the save's
  const a = saveToString(st);
  const B = loadFromString(text);
  play(B);
  const b = saveToString(B);
  check(a === b, `a hardcore world saved on day 80 and loaded plays the next 30 days the same (${Math.round(text.length / 1024)} KB)`);
  check(B.hardcore && B.hardcore.outbreak && B.hardcore.eraOffset === st.hardcore.eraOffset && outbreakProgress(B).offset === st.hardcore.eraOffset, "the first year's state is in the save");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
