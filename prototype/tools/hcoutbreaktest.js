// Hardcore mode, the outbreak (src/sim/hardcore-outbreak.js, eras.js rampDay).
// - The start (16 seeds): one hive, in the city nearest the outbreak origin; the tile 3–6 from the military's base
//   where the dead will mass a few days after its strike force leaves; your three far from that city; no other hive,
//   site or horde left from mapgen's hives; infection 0 away from the outbreak area on day 1; the era offset 56–112
//   days (half to one 112-day game year).
// - The first year (250 days, the player kept fed): infection spreads, towns and cities above open country by day 30;
//   by day 112 at the latest the land's infection and the hive count are a normal start's (the same seed's normal world
//   on its day 1, printed side by side at days 1, 30, 60, 90, 112); no border hordes, no border hive and no tier above 0
//   before the offset allows; the dead mass by the military base and their hive stands (it once never did on seed 42:
//   the garrison's sorties ate the mass), its hordes reach the base and it gives way on days 20–60 (the day is printed).
// - The era offset: rampDay, the year, the victories' year, the outbreak floor, the tech tiers and the border mix in
//   a hardcore world count from the normal start; a normal world's are its own days.
// - Save / load a hardcore world mid-year: identical after another 30 days.
// Usage: node tools/hcoutbreaktest.js [seeds...]
import { createWorld, tickHour, day, hub } from "../src/sim/world.js";
import { HC, outbreakProgress, hardcoreEraOffset, hcOutbreakCity } from "../src/sim/hardcore-outbreak.js";
import { hcMilitary } from "../src/sim/hardcore-groups.js";
import { HC_START } from "../src/sim/hardcore-start.js";
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
  // Before the first hub the three are on the road (hardcore-start.js): keep the team's food and water up too.
  for (const p of st.parties) if (p.owner === "player" && p.supplies) { p.supplies.food = Math.max(p.supplies.food || 0, 10); p.supplies.water = Math.max(p.supplies.water || 0, 10); }
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
const startSeeds = process.argv.length > 2 ? seeds : [...seeds, 99, 4242, 5, 77, 31337, 1, 2, 3, 11, 13, 500, 888];
for (const seed of startSeeds) {
  const st = createWorld({ seed, factionCount: 7, mode: "hardcore" });
  const g = st.grid, O = st.hardcore.outbreak;
  const off = st.hardcore.eraOffset;
  check(off >= HC.ERA_OFFSET[0] && off <= HC.ERA_OFFSET[1] && off === hardcoreEraOffset(st), `seed ${seed}: era offset ${off} days (${HC.ERA_OFFSET.join("–")})`);
  check(st.hives.length === 1 && st.hiveSites.length === 0, `seed ${seed}: ${st.hives.length} hive and ${st.hiveSites.length} gathering mass at the start (one hive; a normal start has ${O.normalHives})`);
  const city = O.city;
  const nearest = [...st.cityIds].sort((a, b) => g.distance(a, st.originId) - g.distance(b, st.originId) || a - b)[0];
  check(city === nearest && city === hcOutbreakCity(st) && st.hives.length && st.hives[0].id === O.cityHive && g.distance(st.hives[0].tile, city) <= HC.CITY_REACH,
    `seed ${seed}: the first hive is in ${st.tiles[city].loc.name} (the city nearest the origin, ${g.distance(city, st.originId)} tiles from it), ${g.distance(st.hives[0].tile, city)} from its centre on ${st.tiles[st.hives[0].tile].terrain}`);
  const flagged = st.tiles.filter((t) => t.hive).map((t) => t.id).sort().join();
  check(flagged === st.hives.map((h) => h.tile).sort().join() && st.hordes.every((h) => h.hive === O.cityHive), `seed ${seed}: no hive, site or horde left from the hives taken off the map`);
  const mf = st.factions.find((f) => f.alive && f.type === "military");
  const base = mf ? mf.bases[0] : st.militaryIds[0];
  const md = O.mil ? g.distance(O.mil.tile, base) : -1;
  const strikeDay = hcMilitary(st) ? hcMilitary(st).strikeDay : null;
  check(O.mil && O.mil.base === base && md >= HC.MIL_DIST[0] && md <= HC.MIL_DIST[1] && !st.tiles[O.mil.tile].hive &&
    O.mil.gatherDay >= strikeDay + HC.MIL_GATHER[0] && O.mil.gatherDay <= strikeDay + HC.MIL_GATHER[1],
    `seed ${seed}: the base's hive will rise ${md} tiles from ${mf ? `the military's base (${mf.name})` : "the National Guard base"}: the dead mass there on day ${O.mil && O.mil.gatherDay} (the strike force leaves on day ${strikeDay})`);
  const team = st.parties.find((p) => p.owner === "player");
  if (team) check(g.distance(team.path[team.idx], city) >= HC_START.SPAWN.outbreakCity[1], `seed ${seed}: your three start ${g.distance(team.path[team.idx], city)} tiles from the outbreak city`);
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
  let tierEarly = 0, borderEarly = 0, borderSiteEarly = 0, floorEarly = 0, overrun = null, hitDay = null, hives112 = 0;
  const milBase = O.mil ? O.mil.base : null;
  while (day(st) <= 250 && !st.gameOver) {
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
    if ([30, 60, 90, 112, 250].includes(d) && !marks[d]) { marks[d] = infStats(st); console.log(row(`hardcore d${d}`, marks[d], st)); }
    if (d === 112) hives112 = st.hives.length + st.hiveSites.filter((s) => s.started != null).length;
  }
  if (!check(!st.gameOver, `seed ${seed}: the run lasted the year`)) continue;
  check(marks[1].land < marks[30].land && marks[30].land < marks[60].land && marks[60].land <= marks[112].land + 0.01, `seed ${seed}: the infection grows through the year (${[1, 30, 60, 112].map((d) => f3(marks[d].land)).join(" → ")})`);
  check(marks[30].settle > marks[30].open * 1.3, `seed ${seed}: day 30: towns and cities (${f3(marks[30].settle)}) well above open country (${f3(marks[30].open)})`);
  check(marks[30].land < sn.land * 0.85, `seed ${seed}: day 30: still well below a normal start (${f3(marks[30].land)} vs ${f3(sn.land)})`);
  check(Math.abs(marks[112].land - sn.land) <= sn.land * 0.2 && Math.abs(marks[112].urban - sn.urban) <= 0.15, `seed ${seed}: day 112: the land at a normal start's level (${f3(marks[112].land)} vs ${f3(sn.land)}; cities ${f3(marks[112].urban)} vs ${f3(sn.urban)})`);
  if (town) check(pow1 <= 2.05 && deadPower() > pow1 + 0.1, `seed ${seed}: scavenging ${town.loc.name}: the dead's power ${pow1.toFixed(2)} on day 1, ${deadPower().toFixed(2)} on day 250 (it reads the infection)`);
  const want = n.hives.length;
  check(hives112 >= want - 1 && hives112 <= want + 1 && st.hives.length <= want + 2, `seed ${seed}: day 112: ${hives112} hives standing or being built against a normal start's ${want} (day 250: ${st.hives.length}; ${st.hiveInfo.stats.built} built, ${st.hiveInfo.stats.destroyed} destroyed)`);
  check(!tierEarly, `seed ${seed}: no hive past tier 0 before day ${off + TECH.TIER_DAY[1]} (offset + ${TECH.TIER_DAY[1]})`);
  check(!borderEarly && !borderSiteEarly && !floorEarly, `seed ${seed}: no border hordes before day ${Math.round(off * HC.BORDER_FROM)}, no border hive and no hive floor before the normal start (day ${off + 1})`);
  if (mf) {
    const M = O.mil;
    check(M.gathered === M.gatherDay && M.stood != null && M.stood <= M.gatherDay + M.standsIn + 4, `seed ${seed}: the dead massed by the base on day ${M.gathered} and their hive stood on day ${M.stood} (meant in ${M.standsIn} days; ${M.fed} more of the dead drifted in)`);
    check(hitDay != null && M.stood != null && hitDay <= M.stood + 12, `seed ${seed}: the base's hive's hordes reached ${mf.name}'s base (first on day ${hitDay}; ${M.sent} hordes, ${M.dead} of the dead sent)`);
    check(overrun != null && overrun >= 20 && overrun <= 60 && overrun > M.stood, `seed ${seed}: ${mf.name}'s base gave way on day ${overrun}, ${overrun - M.stood} days after its hive stood (meant for about day ${M.overrun}; 20–60)`);
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
  check(eraProgress(at(st, 20)).winDay === win + off && eraProgress(at(st, 20)).fall.before && !eraProgress(at(st, off + 2)).fall.before && eraProgress(at(n, 100)).fall === null, "the Goals panel's numbers: the victories' day and the first year");
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
