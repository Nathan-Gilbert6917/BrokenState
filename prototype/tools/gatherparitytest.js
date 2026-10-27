// A base's gathering jobs yield as a team's land orders do (the user's request 2026-10-27: "Fix gathering orders when
// coming from a base set as work to match output yield of when doing so when in a team. I had one survivor chop wood
// and they came back with 33 but doing so from a team would not bring back 33 alone."): an hour at the work on a job
// trip (jobtrips.js) counts as an hour of a team's order (tripland.js tripScale 1; it was 0.6 for wood and forage, the
// old 6-hour day spread over the trips' 10 hours on the tile, and 0.43 for fishing). The same person with the same tool
// on the same tile at the same hour cuts the same wood and forages the same food either way (the dice held at their
// middle), and the day estimates that size the jobs count the day's hours at the work.
// Usage: node tools/gatherparitytest.js [seed]
import { setFood } from "./foodkit.js";
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { stripAll, newItem, stow } from "../src/sim/inventory.js";
import { tripScale, tripDayHours, onTileHours, TRIP_JOBS } from "../src/sim/tripland.js";
import { tripDay } from "../src/sim/jobtrips.js";
import * as Wd from "../src/sim/woodcutting.js";
import * as Fg from "../src/sim/foraging.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const note = (msg) => console.log(`  · ${msg}`);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true; state.noWanderers = true; state.cards = [];
  state.hour = Math.floor(state.hour / 24) * 24 + 24;
  Object.assign(hub(state).stock, { water: 300, fuel: 100, meds: 20, parts: 10, scrap: 100 }); setFood(hub(state), 300);
  return state;
}
// One survivor of the hub, fit and bare (no traits, no gear), the only one on `job`.
function lone(state, job) {
  const base = hub(state);
  const s = atBase(state, base.id)[0];
  s.traits = []; stripAll(s); s.health = 100; s.conditions = []; s.mood = 70; s.inBed = false;
  for (const x of atBase(state, base.id)) if (x !== s) x.role = "rest";
  s.role = job; s.pinned = true; s.station = null;
  return s;
}
// That survivor alone as a team, stood on `tile`.
function team(state, s, tile) {
  const res = launchExpedition(state, { memberIds: [s.id], dest: tile, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = []; p.radioLive = true;
  state.cards = [];
  return p;
}
// The dice held at their middle (a roll of 0.5: each job's average hour), put back after.
function midDice(state, fn) {
  const real = state.rng;
  const mid = Object.create(Object.getPrototypeOf(real));
  mid.next = () => 0.5;
  state.rng = mid;
  try { return fn(); } finally { state.rng = real; }
}

section("An hour at the work counts in full, as a team's");
{
  for (const job of ["wood", "forage", "hunt", "fish"]) check(tripScale(job) === 1, `${job}: an hour on the tile is an hour of work (scale ${tripScale(job)})`);
  check(tripScale("scavenge") < 1 && TRIP_JOBS.scavenge.nominal === 1, "scavenging keeps its old day's scale (no team order to match)");
  check(Wd.WOOD.base.hours === onTileHours("wood", 1) && Wd.WOOD.base.hours === 10, `the Cut wood job's day is its hours at the work one tile out (${Wd.WOOD.base.hours})`);
  check(Fg.FORAGE.base.hours === tripDayHours("forage") && Fg.FORAGE.base.hours === 10, `the Forage job's day likewise (${Fg.FORAGE.base.hours})`);
}

section("Cut wood: a woodcutter's trip against the same person on a team's order");
{
  for (const axe of [false, true]) {
    const state = mk();
    const base = hub(state);
    const s = lone(state, "wood");
    if (axe) stow(s, newItem("axe")); // in their hands either way (a trip takes the armory's out: jobtrips.js checkOutTool)
    const tg = Wd.woodTripTile(state, base);
    check(tg && tg.v > 0.05, `the base's woodcutters have land (${tg && tg.id}, ${tg && tg.d} out)`);
    const hour = Math.floor(state.hour / 24) * 24 + 34; // 10:00 the next day: daylight for both
    const trip = midDice(state, () => Wd.woodTrip(state, base, s, tg.id, 4, hour));
    state.wood = {}; // the land as it was
    const p = team(state, s, tg.id);
    const was = state.hour;
    state.hour = hour;
    p.task = { type: "wood", hours: 4, done: 0 };
    p.phase = "task";
    midDice(state, () => { for (let i = 0; i < 4; i++) { Wd.woodHour(state, p); state.hour++; } });
    state.hour = was;
    note(`${axe ? "a felling axe" : "bare hands"}, 4 hours at 10:00: the base's trip ${Math.round(trip.wood)} wood, the team of that one person ${Math.round(p.task.got.wood)}`);
    check(trip.tool === axe, `the trip ${axe ? "cuts with the axe" : "cuts by hand"}`);
    check(trip.wood > 0 && near(trip.wood, p.task.got.wood, 0.02), `${axe ? "with an axe" : "by hand"}: a base woodcutter's 4 hours bring in what the team's 4 do`);
  }
}

section("Cut wood: a day of trips against a team's day");
{
  const state = mk(SEED);
  const base = hub(state);
  const s = lone(state, "wood");
  const tg = Wd.woodTripTile(state, base);
  const dayEnd = Math.floor(state.hour / 24) * 24 + 48;
  const T = tripDay(state, base, dayEnd);
  const got = (T && T.wood && T.wood.wood) || 0;
  const hrs = onTileHours("wood", tg.d) - 1; // the lunch hour out of it
  const tools = (base.armory || []).filter(Wd.isChopTool); // the armory's best goes out with them, as a team's spare would
  const team8 = Wd.expectWood(state, [s], tg.id, hrs, dayEnd - 24 + 7, Infinity, Wd.chopPower(Wd.chopCrew([s], tools))).all;
  note(`a lone woodcutter's day ${tg.d} out: ${Math.round(got)} wood in ${hrs} hours at the work; a team of them, the same hours from 7:00: ≈ ${Math.round(team8)}`);
  check(got > 0.7 * team8 && got < 1.4 * team8, "a day of trips brings in about a team's day for the same hours (it was 0.6 of it)");
  check(Math.abs(Wd.baseWoodDay(state, base, s) / team8 - 1) < 0.3, `the job's day estimate (baseWoodDay ${Math.round(Wd.baseWoodDay(state, base, s))}) counts those hours too`);
}

section("Forage: a forager's trip against the same person on a team's order");
{
  // A summer's day, when the land gives.
  const state = mk(SEED);
  state.hour += 24 * 60;
  const base = hub(state);
  const s = lone(state, "forage");
  const tg = Fg.forageTripTile(state, base);
  check(tg && tg.v > 0.05, `the base's foragers have land (${tg && tg.id})`);
  const hour = Math.floor(state.hour / 24) * 24 + 10;
  const trip = midDice(state, () => Fg.forageTrip(state, base, s, tg.id, 3, hour));
  state.forage = {};
  const p = team(state, s, tg.id);
  const was = state.hour;
  state.hour = hour;
  p.task = { type: "forage", hours: 3, done: 0 };
  p.phase = "task";
  midDice(state, () => { for (let i = 0; i < 3; i++) { Fg.forageHour(state, p); state.hour++; } });
  state.hour = was;
  note(`a lone forager, 3 hours at 10:00: the trip ${trip.food.toFixed(2)} food, the team ${p.task.got.rations.toFixed(2)}`);
  check(trip.food > 0 && near(trip.food, p.task.got.rations, 0.05), "a base forager's hours bring in what a team of that one person gathers");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
