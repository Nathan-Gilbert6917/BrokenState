// Teamwork on job trips (src/sim/teamwork.js; jobtrips.js rollLoad / tripState, tripevents.js crew events,
// loneattack.js "attacked together", grouptrips.js / groupworks.js the AI side). Checks:
//   - two woodcutters on one tile at the same time form a crew and get the bonus (teamMult); the activity line names
//     the mate
//   - one event roll for the crew (the second is covered by the first's), and the card names both
//   - an attack puts both on the battle map, the dead scaled to the crew
//   - loot as items goes to one member by the dice, the same on the same seed, and spills to the other when full
//   - different tiles or different jobs: no crew
//   - the same seed gives the same result twice
//   - the AI groups: their crews, the felling bonus, fewer losses on the land
// Usage: node tools/teamworktest.js
import { createWorld, hub, atBase, localId } from "../src/sim/world.js";
import { planTrip, tripState } from "../src/sim/jobtrips.js";
import { armTripEvent, fireTripEvent } from "../src/sim/tripevents.js";
import { TEAM, teamMult, crewAt, noteMates, shareLoot, crewDead, groupCrew } from "../src/sim/teamwork.js";
import { GROUP_TRIPS, groupTripLosses } from "../src/sim/grouptrips.js";
import { newItem, ensureInv } from "../src/sim/inventory.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const r2 = (v) => Math.round(v * 100) / 100;
const first = (s) => s.name.split(" ")[0];

function mk(seed) {
  const state = createWorld({ seed, factionCount: 4 });
  state.started = true;
  state.visitorsOff = true;
  Object.assign(hub(state).stock, { food: 400, water: 400, fuel: 100, meds: 20, scrap: 100, ammo: 500, arrows: 50 });
  return state;
}
// Two woodcutters at the hub, armed; the rest away on an errand.
function pair(state, job = "wood") {
  const b = hub(state);
  const people = atBase(state, b.id);
  for (const o of people.slice(2)) o.location = { kind: "errand", baseId: b.id, until: 99999 };
  const two = people.slice(0, 2);
  for (const s of two) {
    s.role = job; s.station = null; s.pinned = true; s.health = 100; s.inBed = false; s.conditions = []; s.mood = 70;
    s.gear = {}; s.pockets = []; ensureInv(s);
    s.gear.weapon = newItem("machete"); s.gear.armor = newItem("vest");
  }
  return { b, a: two[0], c: two[1] };
}
// Both out from 08:00 on day 3 on the same trip.
function out(state, b, list, i = 1) {
  state.hour = 24 * 3 + 8;
  for (const s of list) { const t = planTrip(state, b, s, s.role, state.hour); t.n = i; s.trip = t; }
}

section("Two woodcutters on one tile: a crew, and the bonus");
{
  const st = mk(71);
  const { b, a, c } = pair(st);
  out(st, b, [a, c]);
  check(a.trip.tile === c.trip.tile, `the same tile (${a.trip.tile})`);
  const crew = crewAt(st, a, a.trip.arrive + 0.1);
  check(crew.length === 2 && crew.includes(c), "they form a crew");
  check(noteMates(st, a) === 2 && a.trip.mates.includes(c.id) && c.trip.mates.includes(a.id), "each counts the other (kept on both trips)");
  check(teamMult("wood", 1) === 1 && teamMult("wood", 2) === 1 + TEAM.pair && teamMult("wood", 3) === 1 + TEAM.pair + TEAM.more && teamMult("wood", 9) === 1 + TEAM.cap, `the bonus: alone ×1, a pair ×${teamMult("wood", 2)}, three ×${teamMult("wood", 3)}, at most ×${teamMult("wood", 9)}`);
  check(teamMult("hunt", 2) < teamMult("wood", 2) && teamMult("water", 2) === 1, `hunting pays some back for the noise (×${teamMult("hunt", 2)}); water none`);
  const ts = tripState(st, a, a.trip.arrive + 0.5);
  check(ts && new RegExp(`with ${first(c)}`).test(ts.text), `the activity line: "${ts && ts.text}"`);
}

section("Different tiles or different jobs: no crew");
{
  const st = mk(72);
  const { b, a, c } = pair(st);
  out(st, b, [a, c]);
  const other = st.tiles.find((x) => x.id !== a.trip.tile && x.terrain !== "water");
  c.trip.tile = other.id;
  check(crewAt(st, a, a.trip.arrive + 0.1).length === 1, "another tile: alone");
  c.trip.tile = a.trip.tile; c.trip.job = "forage";
  check(crewAt(st, a, a.trip.arrive + 0.1).length === 1, "another job: alone");
}

section("One roll for the crew; the card names both; the battle has both");
function attack(seed) {
  const st = mk(seed);
  const { b, a, c } = pair(st);
  out(st, b, [a, c]);
  armTripEvent(st, b, a, a.trip);
  armTripEvent(st, b, c, c.trip);
  const res = { coveredBy: c.trip.evBy, cEv: !!c.trip.ev, lead: !!a.trip.evLead };
  const t = a.trip;
  t.ev = { at: r2(t.arrive + 0.5), seed: 4242, force: { kind: "dead", n: 2 } };
  fireTripEvent(st, b, a, t, Math.floor(t.ev.at));
  const card = st.cards[0];
  res.title = card && card.title;
  res.n = t.ev.n;
  res.follow = c.trip.follow && c.trip.follow.sid === a.id;
  inBrowser(() => { st.cards.shift(); card.choices[1].resolve(st); });
  res.mine = st.combat ? st.combat.units.filter((u) => u.side === "player").map((u) => u.sid).sort() : [];
  res.enemies = st.combat ? st.combat.units.filter((u) => u.side === "enemy").length : 0;
  return { st, a, c, res };
}
{
  const { a, c, res } = attack(73);
  check(res.coveredBy === a.id && !res.cEv && res.lead, "the second's trip is covered by the first's roll (no roll of its own)");
  check(res.title && res.title.includes(first(a)) && res.title.includes(first(c)) && /were attacked/.test(res.title), `the card: "${res.title}"`);
  check(res.n === crewDead(2, 2) && res.n === 3, `the dead scaled to the crew: 2 → ${res.n}`);
  check(res.follow, "the mate holds with them (t.follow)");
  check(res.mine.length === 2 && res.mine.includes(a.id) && res.mine.includes(c.id), `both on the battle map (${res.mine.length} of yours)`);
  check(res.enemies === 3, `against ${res.enemies} of the dead`);
}

section("Loot: one of them by the dice, the same on the seed, the other when the first is full");
function loot(seed) {
  const st = mk(seed);
  const { a, c } = pair(st);
  const it = newItem("knife");
  const pick = shareLoot(st, [a, c], it, 99, 0, true);
  return { st, a, c, it, pick };
}
{
  const x = loot(74), y = loot(74);
  check(x.pick && y.pick && first(x.pick) === first(y.pick), `the same seed, the same one: ${x.pick && x.pick.name}`);
  let as = 0;
  for (let i = 0; i < 40; i++) if (shareLoot(x.st, [x.a, x.c], newItem("knife"), i, 0, true) === x.a) as++;
  check(as > 5 && as < 35, `random between them (${as} of 40 to ${first(x.a)})`);
  const got = shareLoot(x.st, [x.a, x.c], x.it, 99);
  check(got === x.pick && x.it.tripFind, "stowed on the one the dice picked");
  // The picked one full: no pack, pockets full, hands full, the belt too (holsters.js: a knife goes on the belt).
  const full = x.pick, other = full === x.a ? x.c : x.a;
  full.gear = { weapon: newItem("machete"), armor: newItem("vest"), tool: newItem("crowbar"), melee: newItem("knife") };
  full.pockets = full.pockets.map(() => newItem("bandagekit"));
  const it2 = newItem("knife");
  const got2 = shareLoot(x.st, [x.a, x.c], it2, 99);
  check(got2 === other, `${first(full)} full: it goes to ${got2 && first(got2)}`);
}

section("The same seed twice");
{
  // The ids world-local (world.js localId): the second world's ids run on from the first's.
  const local = ({ st, res }) => ({ ...res, coveredBy: localId(st, res.coveredBy), mine: res.mine.map((id) => localId(st, id)) });
  const p = local(attack(75)), q = local(attack(75));
  check(JSON.stringify(p) === JSON.stringify(q), "the same crew, the same roll, the same card and battle");
}

section("The AI groups: crews, the felling, the losses");
{
  const st = mk(76);
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const big = { ...f, pop: 30, bases: [f.bases[0]] }, small = { ...f, pop: 6, bases: [f.bases[0]] };
  check(groupCrew(big, GROUP_TRIPS.outShare) >= 2 && groupCrew(small, GROUP_TRIPS.outShare) === 1, `a base of 30 works in crews of ${groupCrew(big, GROUP_TRIPS.outShare)}, a base of 6 alone`);
  check(teamMult("wood", 2) > 1, `their felling crew-days × ${teamMult("wood", 2)} (groupworks.js startWork)`);
  check(TEAM.aiRisk < 1 && TEAM.aiWound < 1, `a crew on the land: deaths × ${TEAM.aiRisk}, wounds × ${TEAM.aiWound}`);
  const r = groupTripLosses(st, big);
  check(r.crew >= 2, `groupTripLosses counts the crew (${r.crew})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
