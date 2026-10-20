// Headless checks for AI groups fleeing the dead (src/sim/groupflight.js):
//   - a big horde coming at a group's only base that it cannot hold: they settle a new site farther from the dead, lose
//     a few people and the stores they cannot carry; the old base stands abandoned (its works, some stores) and can be
//     taken over (groupworld.js occupyAbandoned)
//   - with another base they fall back to it (it becomes the main one); with nowhere to go an ally takes them in
//   - a horde they can hold: they stay; zealots stand far more often than communes
//   - overrun: a horde walking into the base (hordes.js onHordeEnter) and winning by RATIO: they leave
//   - it survives a save and load
// Usage: node tools/flighttest.js [seed]                checks
//        node tools/flighttest.js rate [days] [seeds...]  flights per world-year on the Balanced autopilot (normal worlds)
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, day, hub } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { makeHorde, hordesHour, HOURS_PER_TILE, hordeWallPower } from "../src/sim/hordes.js";
import { FLIGHT, flightDaily, fleeBase, fleeSite, baseHold, hordesComing, cannotHold, hordeOverrun } from "../src/sim/groupflight.js";
import { abandonedAt, occupyAbandoned } from "../src/sim/groupworld.js";
import { changeRelation, relation } from "../src/sim/diplomacy.js";
import { tickGroup } from "../src/sim/groupcare.js";
import { totalRounds } from "../src/sim/ammo.js";
import { ensureMembers, syncMembers, membersOf } from "../src/sim/members.js";

const t0 = Date.now();
let passes = 0, fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (ok) passes++; else fails++; };
const section = (t) => console.log(`\n== ${t}`);

if (process.argv[2] === "rate") {
  const days = Number(process.argv[3] || 365);
  const seeds = process.argv.length > 4 ? process.argv.slice(4).map(Number) : [42, 7, 1234, 99];
  let flights = 0, years = 0;
  const how = {};
  for (const seed of seeds) {
    const st = createWorld({ seed, factionCount: 8 });
    st.started = true;
    setAutopilot(st, true, "balanced");
    const lines = [];
    const unshift = st.log.unshift;
    st.log.unshift = function (...x) { for (const l of x) if (/abandoned .* (ahead of a horde|after the dead broke in)/.test(l.text)) lines.push(`day ${Math.floor(l.hour / 24) + 1}: ${l.text}`); return unshift.apply(this, x); };
    while (day(st) <= days && !st.gameOver) tickHour(st);
    const n = st.stats.groupFlights || 0;
    for (const f of st.factions) if (f.flights) how[f.type] = (how[f.type] || 0) + f.flights;
    flights += n; years += Math.min(days, day(st)) / 365;
    console.log(`seed ${seed}: ${n} flights in ${day(st) - 1} days (${st.factions.filter((f) => f.joinedAlly != null).length} groups taken in by an ally)`);
    for (const l of lines.slice(0, 4)) console.log(`  ${l}`);
  }
  console.log(`${flights} flights in ${years.toFixed(1)} world-years: ${(flights / years).toFixed(2)} a world-year; by type ${JSON.stringify(how)}`);
  process.exit(0);
}

const seed = Number(process.argv[2] || 4242);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.noNewGangs = true; return st; };
// A group with one base (the others' bases dropped), of a type, and a horde `dist` tiles off coming for it.
function setup(st, type = "commune", size = 500, dist = 2, i = 0) {
  const f = st.factions.filter((x) => x.alive)[i];
  f.type = type; f.pop = 20; f.bases = [f.bases[0]];
  const tile = f.bases[0];
  const g = st.grid;
  const at = g.within(tile, dist).find((id) => g.distance(id, tile) === dist && st.tiles[id].terrain !== "water") ?? g.within(tile, dist)[0];
  const h = makeHorde(st, { tile: at, size, role: "attack", target: tile, goal: { factionId: f.id, tile } });
  return { f, tile, h };
}

section("Ahead of a horde they cannot hold: a new site");
{
  const st = world();
  const { f, tile, h } = setup(st);
  check(hordesComing(st, tile).includes(h) && cannotHold(st, f, tile, [h]), `a horde of ${h.size} (${hordeWallPower(h).toFixed(1)} on the walls) against a defence of ${baseHold(st, f, tile).toFixed(1)}: they cannot hold`);
  const pop0 = f.pop, food0 = food(f), ammo0 = totalRounds(f.stock); // rounds by calibre (ammo.js)
  const odds = FLIGHT.ODDS;
  FLIGHT.ODDS = 99; // they always go
  flightDaily(st);
  FLIGHT.ODDS = odds;
  const g = st.grid;
  check(!f.bases.includes(tile) && f.bases.length === 1 && f.alive, `they left (${f.bases[0] === tile ? "still there" : `now at ${f.bases[0]}`})`);
  check(g.distance(f.bases[0], h.tile) >= g.distance(tile, h.tile) + FLIGHT.AWAY, `the new site is farther from the dead (${g.distance(f.bases[0], h.tile)} tiles against ${g.distance(tile, h.tile)})`);
  check(f.pop < pop0 && f.pop >= pop0 * (1 - FLIGHT.STRAGGLE[1]) - 1, `a few lost on the way (${pop0} → ${f.pop})`);
  check(food(f) < food0 && totalRounds(f.stock) < ammo0 && food(f) >= food0 * (1 - FLIGHT.LEAVE) - 1, `the stores they could not carry stayed (food ${Math.round(food0)} → ${Math.round(food(f))}, rounds ${ammo0} → ${totalRounds(f.stock)})`);
  const rec = abandonedAt(st, tile);
  check(!!rec && rec.from === f.id && (food(rec) || 0) > 0, `the old base stands abandoned with some stores (${rec ? JSON.stringify(rec.stock) : "none"})`);
  check(f.fledDay === day(st) && (st.stats.groupFlights || 0) === 1, "counted (stats.groupFlights)");
  // Someone else can take it over.
  const o = st.factions.find((x) => x.alive && x !== f);
  o.bases.push(tile);
  occupyAbandoned(st, o, tile);
  check(!abandonedAt(st, tile), `${o.name} takes the abandoned base over`);
}

section("Another base: they fall back to it");
{
  const st = world();
  const { f, tile } = setup(st, "traders");
  const g = st.grid;
  const other = g.within(tile, 8).find((id) => g.distance(id, tile) >= 5 && st.tiles[id].loc && st.factions.every((o) => !o.bases.includes(id)));
  f.bases.push(other);
  const r = fleeBase(st, f, tile, [tile + 1]);
  check(r && r.to === "base" && f.bases[0] === other && f.bases.length === 1, `fell back to their base at ${other} (${r && r.to})`);
}

section("Nowhere to go: an ally takes them in");
{
  const st = world();
  const { f, tile, h } = setup(st, "commune");
  const ally = st.factions.filter((x) => x.alive && x !== f).sort((a, b) => st.grid.distance(a.bases[0], tile) - st.grid.distance(b.bases[0], tile))[0];
  changeRelation(st, f, ally, 80 - relation(st, f, ally));
  const site = FLIGHT.SITE;
  FLIGHT.SITE = [99, 99]; // no site anywhere
  const range = FLIGHT.ALLY_RANGE;
  FLIGHT.ALLY_RANGE = 999;
  const pop0 = ally.pop, theirs = f.pop;
  const r = fleeBase(st, f, tile, [h.tile]);
  FLIGHT.SITE = site; FLIGHT.ALLY_RANGE = range;
  check(r && r.to === "ally" && !f.alive && f.joinedAlly === ally.id, `taken in by ${ally.name} (${r && r.to})`);
  check(ally.pop > pop0 && ally.pop <= pop0 + theirs, `their people went over (${pop0} → ${ally.pop})`);
  check(!!abandonedAt(st, tile), "their base stands abandoned");
}

section("A horde they can hold; zealots stand, communes run");
{
  const st = world();
  const { f, tile, h } = setup(st, "commune", 20);
  check(!cannotHold(st, f, tile, [h]), `a horde of ${h.size}: they hold (${hordeWallPower(h).toFixed(1)} against ${baseHold(st, f, tile).toFixed(1)})`);
  flightDaily(st);
  check(f.bases.includes(tile), "and stay");
  let ran = { zealot: 0, commune: 0 };
  for (const type of ["zealot", "commune"]) {
    for (let i = 0; i < 40; i++) {
      const s = world(seed + 10 + i);
      const x = setup(s, type);
      tickGroup(x.f);
      flightDaily(s);
      if (!x.f.bases.includes(x.tile)) ran[type]++;
    }
  }
  check(ran.commune > ran.zealot * 1.8 && ran.commune > 0, `zealots run ${ran.zealot}/40 times, communes ${ran.commune}/40 (the type's flee)`);
}

section("Overrun: the dead walk in and win");
{
  const st = world();
  const { f, tile, h } = setup(st, "commune", 600, 1);
  // Eight of them, unarmed: the dead that break in (your rule, defences.js breakInForce: at most 20 of them, fought by
  // the numbers on the very people there) beat them at the odds' cap (combat.js ODDS MAX). Twenty unarmed hold one
  // time in four (the dead the map's odds, 2026-10-19), and twenty armed would hold, as yours would.
  f.pop = 8;
  ensureMembers(st, f); syncMembers(st, f);
  for (const s of membersOf(f)) { s.gear.weapon = null; s.gear.tool = null; }
  h.move = HOURS_PER_TILE - 0.01;
  const pop0 = f.pop;
  hordesHour(st); // the horde steps in: the fight (factions.js), then the flight
  check(!f.alive || !f.bases.includes(tile), `overrun, they left (${f.alive ? `now at ${f.bases[0]}` : "gone"}; ${pop0} → ${f.pop} people)`);
  check(!!abandonedAt(st, tile) || !f.alive, "the base stands abandoned");
  // Held: nothing.
  const s2 = world(seed + 1);
  const x = setup(s2, "commune", 30, 1);
  check(hordeOverrun(s2, x.f, x.tile, 1, 10, true) === null && hordeOverrun(s2, x.f, x.tile, 12, 10, false) === null, "held, or won by less than RATIO: they stay");
}

section("Save and load");
{
  const st = world();
  const { f, tile, h } = setup(st);
  fleeBase(st, f, tile, [h.tile]);
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const f2 = back.factions.find((x) => x.id === f.id);
  check(f2 && f2.fledDay === f.fledDay && f2.flights === 1 && !!abandonedAt(back, tile) && f2.bases[0] === f.bases[0], "the flight and the abandoned base survive a save");
  for (let i = 0; i < 24 * 3; i++) tickHour(back);
  check(f2.alive, "and the world plays on");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
