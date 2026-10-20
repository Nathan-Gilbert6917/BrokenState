// Job trips (src/sim/jobtrips.js, tripland.js, grouptrips.js; the map's walkers in src/ui/workermap.js).
// Usage: node tools/jobtripstest.js [seed] (default 42).
// - The hours: walking costs time on the tile (0.5 h a tile each way), the farther tile gives less, each job's day at its
//   reference distance gives the old job's hours.
// - A woodcutter's day at the hub: home outside the job's hours, out by day on a route over the base's land, the load
//   credited when they get home (not at midnight), the day's deposits = the output counter = the midnight total.
// - Tile yields: the trip goes to the best ground (forest over farmland), trading the walk against what a tile holds.
// - Hunters out at dawn and dusk, home between; their catch comes in as they arrive. No cabin needed: the tiles next
//   to the base; a hunting cabin widens the grounds to 2 tiles out.
// - Fishing and fetching water need a water tile the base owns ("no water in the base's land"); with one the fisher
//   walks to its shore and the water carrier brings un-purified water by the bucket, into the barrels' room.
// - A base on alert: outdoor work on hold ("On hold: base under siege"), those out cut short and walk home.
// - Out of the walls: a hunter out mid-trip is not among the base's defenders (combatants, baseDefense); at night they are.
// - The groups: their food and wood by the land their bases hold, fewer at the walls by day, walkers by day.
// - Saves keep a trip under way; the Layers box has Base workers.
import { createWorld, tickHour, hub, atBase, hourOfDay, outOnTrip, homeAt, isHome } from "../src/sim/world.js";
import { TRIP, TRIP_JOBS, walkHours, onTileHours, distFactor, tripScale, ownedWater, workLand, tripRoute, NO_WATER, waterTripsADay } from "../src/sim/tripland.js";
import { tripState, tripTarget, planTrip, tripDay, outWorkers, loadText } from "../src/sim/jobtrips.js";
import { PACK, packFood } from "../src/sim/eating.js"; // the food a trip takes out (lunch)
import { groupFoodLand, groupWoodLand, groupHomeShare, groupWalkers, groupFetchedWater, GROUP_TRIPS, GROUP_LUNCH_SHARE } from "../src/sim/grouptrips.js";
import { describeActivity, baseWork } from "../src/sim/activity.js";
import { outputDays } from "../src/sim/output.js";
import * as Wd from "../src/sim/woodcutting.js";
import * as H from "../src/sim/hunting.js";
import { fetchWaterWhy, rawRoom, ROLES } from "../src/sim/economy.js";
import { WORK_TYPES } from "../src/sim/work.js";
import { addBuilding } from "../src/sim/buildings.js";
import { recomputeOwnership, baseDefense } from "../src/sim/factions.js";
import { combatants } from "../src/sim/combat.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { LAYERS } from "../src/sim/markers.js";
import { RAW } from "../src/sim/water.js";
import * as FW from "../src/sim/fieldworks.js"; // stockpiles as drop points (trips-plus #3)

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const note = (s) => console.log(`  ${s}`);
const r1 = (v) => Math.round(v * 10) / 10;
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;

function mk(seed) {
  const state = createWorld({ seed, factionCount: 6 });
  state.started = true;
  state.autoCombat = true;
  state.visitorsOff = true;
  Object.assign(hub(state).stock, { food: 400, water: 400, fuel: 100, meds: 20, scrap: 100, wood: 0 });
  return state;
}
const tickTo = (state, h) => { let n = 0; while (hourOfDay(state) !== h && n++ < 48) tickHour(state); };
// One person at the hub on a job, Manual and pinned (nothing moves them off it), fit to work.
function onJob(state, base, s, job) {
  s.role = job; s.station = null; s.pinned = true; s.health = 100; s.inBed = false; s.conditions = []; s.mood = 70;
  for (const x of atBase(state, base.id)) if (x !== s && x.role === job) x.role = "rest";
  return s;
}
function seedWith(test, from = SEED) {
  for (let seed = from; seed < from + 80; seed++) { const st = mk(seed); if (test(st, hub(st))) return st; }
  throw new Error("no seed found");
}

// ======================================================================
section("The hours: the walk costs time on the tile");
{
  check(TRIP.pace === 0.5 && walkHours("wood", 1) === 0.5 && walkHours("wood", 2) === 1 && near(walkHours("wood", 0), TRIP.gate * TRIP.pace), `0.5 h a tile each way (the base's own tile ${walkHours("wood", 0)} h)`);
  check(walkHours("fish", 1) === 0.25 && walkHours("water", 2) === 0.75, "the water jobs walk to the shore, half a tile short of the water tile");
  const w = [0, 1, 2].map((d) => onTileHours("wood", d)), h = [1, 2].map((d) => onTileHours("hunt", d));
  note(`hours on the tile a day: wood ${w.join(" / ")} (0, 1, 2 tiles out), hunting ${h.join(" / ")} (1, 2 out); trips of water a day ${[1, 2].map(waterTripsADay).join(" / ")}`);
  check(w[0] > w[1] && w[1] > w[2] && h[0] > h[1], "the farther the tile, the fewer hours on it");
  check(near(distFactor("wood", 1), 1) && near(distFactor("hunt", 2), 1) && near(distFactor("fish", 1), 1), "each job's day at its reference distance is the old job's (wood 1 tile, hunting 2, fishing 1)");
  check(near(onTileHours("wood", 1) * tripScale("wood"), 6) && near(onTileHours("hunt", 2) * tripScale("hunt"), 4), "the daily hours there (wood 6, hunting 4: CABIN.huntHours since 2026-10-12)");
  check(distFactor("wood", 0) > 1.1 && distFactor("wood", 2) < 0.85 && distFactor("hunt", 1) > 1.4, `a near tile gives more, a far one less (wood ${r1(distFactor("wood", 0) * 100) / 100} / 1 / ${r1(distFactor("wood", 2) * 100) / 100})`);
  check(waterTripsADay(1) > waterTripsADay(2), "water fetched from farther: fewer trips a day");
}

// ======================================================================
section("A woodcutter's day: home outside the hours, out on the base's land, the load in as they arrive");
{
  const state = seedWith((st, b) => !Wd.woodWorkWhy(st, b));
  const base = hub(state);
  const cutter = onJob(state, base, atBase(state, base.id)[0], "wood");
  base.armory.push(newItem("fireaxe"));
  tickTo(state, 3);
  check(!cutter.trip && !outOnTrip(state, cutter) && isHome(state, cutter), "03:00: at home (asleep), no trip");
  tickTo(state, 7);
  const t = cutter.trip;
  check(packFood(cutter) >= PACK.trip - 1e-6, `out with at least ${PACK.trip} day of food for lunch (${Math.round(packFood(cutter) * 10) / 10})`);
  check(t && t.job === "wood" && t.leave === state.hour && outOnTrip(state, cutter, state.hour + 0.5), `07:00: out on a trip (${t && `to tile ${t.tile}, ${t.d} out, home at ${t.home}`})`);
  const land = new Set(workLand(state, base.tile));
  const route = t ? tripRoute(state, base.tile, t.tile) : [];
  check(route.length && route[0] === base.tile && route[route.length - 1] === t.tile && route.every((id) => land.has(id) && state.grid.distance(base.tile, id) <= TRIP.radius), `the route stays on the base's land (${route.join(" → ")})`);
  const tg = Wd.woodTripTile(state, base);
  check(t && tg && t.tile === tg.id, "to the best wood tile for its walk (woodTripTile)");
  // Its phases by the clock.
  const st0 = tripState(state, cutter, t.leave + 0.1), st1 = tripState(state, cutter, (t.arrive + t.workEnd) / 2);
  check(st0 && st0.phase === "out" && /^Heading to/.test(st0.text) && st1 && st1.phase === "work" && st1.progress > 0.4 && st1.progress < 0.6 && /\d+%$/.test(st1.text), `the phases: "${st0 && st0.text}", "${st1 && st1.text}"`);
  const a = describeActivity(state, cutter);
  check(a.kind === "work" && a.job === "wood" && /Heading to|Felling|Chopping|Splitting/.test(a.text), `the activity line: "${a.text}"`);
  // The load comes in when they are home: not before.
  const w0 = base.stock.wood || 0;
  let creditAt = null, carry = null;
  for (let n = 0; n < 12 && creditAt == null; n++) {
    const before = base.stock.wood || 0, tr = cutter.trip;
    tickHour(state);
    if (tr && tr.carry) carry = tr;
    if ((base.stock.wood || 0) > before + 0.001) creditAt = state.hour;
  }
  check(creditAt != null && carry && carry.home >= creditAt && carry.home < creditAt + 1, `the wood is in the store in the hour they get home (${creditAt}:00, home ${carry && r1(carry.home)})`);
  const back = carry ? tripState(state, { trip: carry }, carry.home - 0.05) : null;
  check(back && back.phase === "back" && /^Bringing .*wood.* back$/.test(back.text), `on the way home: "${back && back.text}"`);
  check(base.tripPops && base.tripPops.some((p) => /^\+\d+ wood$/.test(p.text)), `a deposit pop for the map (${base.tripPops && base.tripPops.map((p) => p.text).join(", ")})`);
  // Out again in the afternoon, home by the end of the hours.
  tickTo(state, 15);
  check(cutter.trip && cutter.trip.n >= 1, "out again after the deposit (the second trip)");
  tickTo(state, 20);
  check(!cutter.trip && !outOnTrip(state, cutter), "20:00: the hours over, home");
  check(/Eating dinner/.test(describeActivity(state, cutter).text), `20:00, dinner (meals.js): "${describeActivity(state, cutter).text}"`);
  tickTo(state, 21);
  check(/Done chopping/.test(describeActivity(state, cutter).text), `the evening: "${describeActivity(state, cutter).text}"`);
  const day0 = Math.floor((state.hour - 1) / 24) + 1;
  const T = base.tripTally && base.tripTally.wood;
  const counter = outputDays(base, "wood").find((d) => d.day === day0);
  check(T && counter && near(counter.by.wood, T.wood, 0.05) && near((base.stock.wood || 0) - w0, T.wood, 0.05), `the day's deposits ${T && T.wood} = the output counter ${counter && counter.by.wood} = the store's rise ${r1((base.stock.wood || 0) - w0)}`);
  tickTo(state, 1);
  check(near(base.woodToday, r1(T.wood), 0.06), `midnight: the day's total (woodToday ${base.woodToday})`);
}

// ======================================================================
section("Tile yields: the best ground, the walk against what a tile holds");
{
  const state = seedWith((st, b) => !Wd.woodWorkWhy(st, b));
  const base = hub(state);
  const tg = Wd.woodTripTile(state, base);
  const land = workLand(state, base.tile).filter((id) => Wd.woodAbundance(state, id) >= 0.04);
  const score = (id) => Wd.woodAbundance(state, id) * Wd.woodLevel(state, id) * distFactor("wood", state.grid.distance(base.tile, id));
  check(land.every((id) => score(id) <= score(tg.id) + 1e-9), `the chosen tile is the best by yield × walk (${state.tiles[tg.id].terrain}, ${tg.d} out)`);
  check(Wd.WOOD_TERRAIN.forest > Wd.WOOD_TERRAIN.plains && Wd.WOOD_TERRAIN.plains > Wd.WOOD_TERRAIN.city, "forest gives more wood than farmland, farmland than a city");
  // Cut the chosen tile bare: the trip goes elsewhere.
  Wd.takeWood(state, tg.id, Wd.WOOD.deplete * 0.9);
  const tg2 = Wd.woodTripTile(state, base);
  check(tg2 && tg2.id !== tg.id, `cut bare, the next trip goes to other ground (${tg2 && `${state.tiles[tg2.id].terrain}, ${tg2.d} out`})`);
}

// ======================================================================
section("Hunters: out at dawn and dusk, the catch in as they arrive");
{
  const state = seedWith((st, b) => { addBuilding(b, "huntcabin"); return !H.huntWorkWhy(st, b); });
  const base = hub(state);
  const hunter = onJob(state, base, atBase(state, base.id)[1], "hunt");
  hunter.gear.weapon = newItem("huntrifle"); hunter.skills.shooting = 8;
  tickTo(state, 5);
  check(!hunter.trip, "05:00: not out yet");
  tickTo(state, 7);
  check(hunter.trip && outOnTrip(state, hunter, state.hour + 0.5) && hunter.trip.d === H.huntTripTile(state, base).d, `07:00: out hunting ${hunter.trip && hunter.trip.d} tiles out`);
  tickTo(state, 12);
  check(!hunter.trip, "midday: home between the hunts");
  check(/^Eating lunch/.test(describeActivity(state, hunter).text), `12:00, lunch at home: "${describeActivity(state, hunter).text}"`);
  tickTo(state, 13);
  check(/out again at dusk/.test(describeActivity(state, hunter).text), `"${describeActivity(state, hunter).text}"`);
  tickTo(state, 17);
  check(hunter.trip && hunter.trip.home <= state.hour - (state.hour % 24) + 20, "17:00: out for the dusk hunt, home by 20:00");
  tickTo(state, 21);
  const T = base.tripTally && base.tripTally.hunt;
  const counter = outputDays(base, "hunt").find((d) => d.day === Math.floor((state.hour - 1) / 24) + 1);
  check(T && T.who.includes(hunter.id) && counter && near(counter.by.food, T.rations || 0, 0.05), `the day's catch: ${T ? r1(T.rations || 0) : 0} food on ${T ? T.hrs ? r1((T.hrs.guns || 0) + (T.hrs.bows || 0) + (T.hrs.traps || 0)) : 0 : 0} hours, = the output counter`);
  // Many days: the deposits add up to what the job brings in by the old reckoning (one hunter, two tiles out: 3 hours).
  let got = 0;
  for (let d = 0; d < 10; d++) { tickTo(state, 0); onJob(state, base, hunter, "hunt"); tickTo(state, 21); // kept fit and on the job (sickrest.js would rest an ill one)
    got += (base.tripTally && base.tripTally.hunt && base.tripTally.hunt.rations) || 0; }
  note(`a hunter with a hunting rifle, 10 more days: ${r1(got)} food (≈ ${r1(H.baseHuntDay(state, base) * 10)} for an average hunter)`);
  check(got > 0, "the hunter brings in game");
}

// ======================================================================
section("Hunting without a cabin: the tiles next to the base; a cabin widens the grounds");
{
  // The hub stands in a town and every town has a ring of suburbs round it (mapgen.js), so no seed's hub has game
  // land next door any more: give it back its wild ground (the bare suburb blocks next to it become forest).
  const wild = (st, b) => { for (const n of st.grid.neighbors(b.tile)) { const t = st.tiles[n]; if (t.terrain === "suburb" && !t.loc) t.terrain = "forest"; } };
  const state = seedWith((st, b) => { wild(st, b); return !H.huntWorkWhy(st, b) && !b.buildings.some((x) => x.type === "huntcabin"); });
  const base = hub(state);
  check(H.huntRadius(base) === 1 && H.huntWorkWhy(state, base) === "", `no cabin: the Hunt job works (${H.huntGrounds(state, base).length} tiles of hunting grounds)`);
  const hunter = onJob(state, base, atBase(state, base.id)[1], "hunt");
  hunter.gear.weapon = newItem("huntrifle");
  tickTo(state, 7);
  check(hunter.trip && hunter.trip.d <= 1, `the hunter goes no farther than the tiles next to the base (${hunter.trip && hunter.trip.d} out)`);
  const bare = H.baseHuntDay(state, base);
  addBuilding(base, "huntcabin");
  const t2 = H.huntTripTile(state, base);
  check(H.huntRadius(base) === 2 && H.huntGrounds(state, base).some((id) => state.grid.distance(base.tile, id) === 2) && H.baseHuntDay(state, base) >= bare - 1e-9, `a hunting cabin: grounds 2 tiles out (the best ${t2 && t2.d} out; an average hunter ${r1(bare)} → ${r1(H.baseHuntDay(state, base))} food a day)`);
  const city = state.tiles.find((t) => t.terrain === "city");
  const cb = { ...base, id: -7, tile: city.id, type: "outpost", buildings: [], construction: [], armory: [], stock: {} };
  check(/no game land/.test(H.huntWorkWhy(state, cb)), `a base in a city: "${H.huntWorkWhy(state, cb)}"`);
}

// ======================================================================
section("Fishing and fetching water need a water tile the base owns");
{
  const dry = seedWith((st, b) => ownedWater(st, b.tile).length === 0);
  const db = hub(dry);
  db.armory.push(newItem("fishrod"));
  check(H.fishWorkWhy(dry, db) === NO_WATER && fetchWaterWhy(dry, db) === NO_WATER, `no water tile in the hub's land: "${H.fishWorkWhy(dry, db)}"`);
  const ctx = { state: dry, base: db, people: atBase(dry, db.id), foodDays: 3 };
  check(WORK_TYPES.fish.open(ctx).cap === 0 && WORK_TYPES.water.open(ctx).cap === 0, "the Fish and Fetch water jobs are closed there");
  const f0 = onJob(dry, db, atBase(dry, db.id)[0], "fish");
  tickTo(dry, 7);
  check(!f0.trip && describeActivity(dry, f0).kind === "stalled" && /no water in the base's land/.test(describeActivity(dry, f0).text), `a fisher there: "${describeActivity(dry, f0).text}"`);
  check(!!ROLES.water && !!WORK_TYPES.water && !!TRIP_JOBS.water, "Fetch water is a role, a work type and a trip job");

  const wet = seedWith((st, b) => !!H.fishWater(st, b));
  const wb = hub(wet);
  wb.armory.push(newItem("fishrod"));
  const fw = H.fishWater(wet, wb);
  check(H.fishWorkWhy(wet, wb) === "" && wet.tiles[fw.id].terrain === "water" && wet.tiles[fw.id].owner === "player", `the hub owns water ${fw.d} tile${fw.d === 1 ? "" : "s"} out: fishing works`);
  const fisher = onJob(wet, wb, atBase(wet, wb.id)[0], "fish");
  tickTo(wet, 7);
  check(fisher.trip && fisher.trip.tile === fw.id && fisher.trip.at === fw.shore, "the fisher walks to the nearest water tile the base owns, fishing from its shore");
  const fs = tripState(wet, fisher, (fisher.trip.arrive + fisher.trip.workEnd) / 2);
  check(fs && /^(Casting|Fishing) at the (river|water) \d+%$/.test(fs.text), `"${fs && fs.text}"`);
  // Fetch water: two buckets a trip, un-purified, into the barrels' room.
  const carrier = onJob(wet, wb, atBase(wet, wb.id)[1], "water");
  wb.stock.water = 0; wb.stock[RAW] = 0;
  const room = rawRoom(wb);
  tickTo(wet, 0); tickTo(wet, 7);
  check(carrier.trip && carrier.trip.job === "water" && wet.tiles[carrier.trip.tile].terrain === "water", "07:00: the water carrier sets out for the water");
  let raw0 = wb.stock[RAW] || 0, firstIn = null;
  for (let n = 0; n < 6 && firstIn == null; n++) { tickHour(wet); if ((wb.stock[RAW] || 0) > raw0 + 1e-9) firstIn = (wb.stock[RAW] || 0) - raw0; }
  check(firstIn != null && near(firstIn, TRIP_JOBS.water.perTrip, 0.01), `two buckets in: +${firstIn} un-purified water`);
  tickTo(wet, 20);
  const Tw = wb.tripTally && wb.tripTally.water;
  note(`a day of fetching water ${fw.d} tile${fw.d === 1 ? "" : "s"} out: ${Tw ? Tw.water : 0} water in ${Tw ? Math.round(Tw.water / TRIP_JOBS.water.perTrip) : 0} trips (room ${r1(room)})`);
  check(Tw && Tw.water >= TRIP_JOBS.water.perTrip * 2 && (wb.stock.water || 0) === 0, "several trips a day, all of it un-purified");
  wb.stock[RAW] = 1e6;
  check(rawRoom(wb) < 1 && /barrels are full/.test(fetchWaterWhy(wet, wb)), `no room in the barrels: "${fetchWaterWhy(wet, wb)}"`);
}

// ======================================================================
section("A base on alert: the outdoor work on hold, those out come home; out of the walls, not in the fight");
{
  const state = seedWith((st, b) => { addBuilding(b, "huntcabin"); return !H.huntWorkWhy(st, b); });
  const base = hub(state);
  const hunter = onJob(state, base, atBase(state, base.id)[1], "hunt");
  hunter.gear.weapon = newItem("huntrifle");
  tickTo(state, 7);
  const t = hunter.trip;
  check(t && outOnTrip(state, hunter), "07:00: the hunter is out");
  // Raiders attack now: the hunter is not among the defenders.
  const inFight = combatants(state, { baseId: base.id });
  check(!inFight.includes(hunter) && inFight.length === homeAt(state, base.id).length && inFight.length === atBase(state, base.id).length - outWorkers(state, base, state.hour).length, `an attack mid-trip: ${inFight.length} defenders, the hunter out on the land not among them`);
  const d1 = baseDefense(state, base);
  const keep = hunter.trip; delete hunter.trip;
  const d2 = baseDefense(state, base);
  hunter.trip = keep;
  check(d1 < d2, `the base's defence by the numbers counts only those home (${r1(d1)} against ${r1(d2)} with the hunter in)`);
  // The base on alert: on hold, the trip cut short.
  base.alert = true;
  const home0 = t.home;
  tickHour(state);
  const a = describeActivity(state, hunter);
  check(a.kind === "off" && a.hold === "siege" && /On hold: base under siege/.test(a.text), `on hold: "${a.text}"`);
  check(!hunter.trip || (hunter.trip.cut && hunter.trip.home < home0), `the hunt cut short: home at ${hunter.trip ? r1(hunter.trip.home) : "now"} instead of ${home0}`);
  const row = baseWork(state, base).find((r) => r.job === "hunt");
  check(row && row.hold === "siege" && /On hold/.test(row.why), `the Work now panel: "${row && row.why}"`);
  for (let n = 0; n < 4; n++) tickHour(state);
  check(!hunter.trip && homeAt(state, base.id).includes(hunter), "home again, and no new trip while the alert lasts");
  base.alert = false;
  tickTo(state, 23);
  check(combatants(state, { baseId: base.id }).includes(hunter), "at night: home and in the fight");
}

// ======================================================================
section("The groups: their land, their walls by day, their walkers");
{
  const state = mk(SEED);
  recomputeOwnership(state);
  const fs = state.factions.filter((f) => f.alive && f.bases.length);
  const food = fs.map((f) => groupFoodLand(state, f)), wood = fs.map((f) => groupWoodLand(state, f));
  note(`food from the land × ${food.map((x) => x.toFixed(2)).join(", ")}; wood × ${wood.map((x) => x.toFixed(2)).join(", ")}`);
  check(food.every((x) => x >= 0.9 - 1e-9 && x <= 1.1 + GROUP_TRIPS.fish + 1e-9) && wood.every((x) => x >= 0.5 * GROUP_LUNCH_SHARE - 1e-9 && x <= 1.5 * GROUP_LUNCH_SHARE + 1e-9), "by the land their bases hold (0.9–1.1 food, 0.5–1.5 wood, less the lunch hour)");
  check(Math.abs(GROUP_LUNCH_SHARE - 11 / 12) < 1e-9, "their woodcutters stop for lunch too (11 of their 12 outdoor hours)");
  check(groupHomeShare(12) < 1 && groupHomeShare(23) === 1, `by day ${Math.round((1 - groupHomeShare(12)) * 100)}% of them are out at work, none at night`);
  const f = fs.find((x) => x.pop / x.bases.length >= 4) || fs[0];
  const ws = groupWalkers(state, f, f.bases[0], 10 * 24 + 11);
  check(ws.every((w) => state.tiles[w.tile].owner == null || state.tiles[w.tile].owner === f.id) && groupWalkers(state, f, f.bases[0], 10 * 24 + 2).length === 0, `walkers by day on their own land (${ws.length} at 11:00), none at night`);
  const withWater = fs.filter((x) => x.bases.some((t) => ownedWater(state, t, x.id).length));
  check(fs.every((x) => (groupFetchedWater(state, x) > 0) === withWater.includes(x)), `water carried only where a base holds water (${withWater.length} of ${fs.length} groups)`);
}

// ======================================================================
section("Saves keep a trip under way; the map's layer");
{
  const state = seedWith((st, b) => !Wd.woodWorkWhy(st, b));
  const base = hub(state);
  const cutter = onJob(state, base, atBase(state, base.id)[0], "wood");
  tickTo(state, 9);
  const t = cutter.trip;
  const st2 = loadFromString(saveToString(state));
  const c2 = st2.survivors.find((s) => s.id === cutter.id);
  check(c2.trip && c2.trip.home === t.home && c2.trip.tile === t.tile, "a trip under way survives a save and load");
  tickTo(st2, 15);
  check(c2.trip && c2.trip.n >= 1 && (hub(st2).tripTally && hub(st2).tripTally.wood && hub(st2).tripTally.wood.wood > 0), "and carries on after it: the load in, out again");
  check(!!LAYERS.workers && /Base workers/.test(LAYERS.workers.name), "the Layers box has Base workers");
  const pt = planTrip(state, base, cutter, "wood", Math.floor(state.hour / 24) * 24 + 18.9);
  check(pt === null, "no trip starts too late to work at all");
  check(loadText({ job: "hunt", carry: { rations: 18, deer: 0, small: 2 } }) === "18 kg meat (2 small game)", "the load in words: 18 kg meat (2 small game)");
}

// ======================================================================
section("Stockpiles as drop points: a trip that is not the window's last leaves its load nearer the work");
{
  // A hub whose woodcutters go 2 tiles out, with room for a stockpile on a tile next to both the hub and that ground.
  const pileSpot = (st, b, tg) => st.grid.neighbors(tg).find((id) => st.grid.distance(id, b.tile) === 1 && FW.placeProblem(st, b, "stockpile", id) === "");
  const state = seedWith((st, b) => { b.stock.wood = 200; const t = Wd.woodTripTile(st, b); return !Wd.woodWorkWhy(st, b) && t && t.d === 2 && pileSpot(st, b, t.id) != null; }); // (the stockpile's 90 wood)
  const base = hub(state);
  const cutter = onJob(state, base, atBase(state, base.id)[0], "wood");
  base.armory.push(newItem("fireaxe"));
  const tg = Wd.woodTripTile(state, base);
  const at = pileSpot(state, base, tg.id);
  // Without a stockpile: the morning's trip walks home.
  const d0 = Math.floor(state.hour / 24) * 24 + 24;
  const plain = planTrip(state, base, cutter, "wood", d0 + 7);
  const noPileSave = saveToString(state);
  const r = FW.planFieldWork(state, base, "stockpile", at);
  const job = FW.jobFor(state, r.fw);
  job.progress = job.hours;
  const bld = atBase(state, base.id)[1]; bld.role = "build"; bld.pinned = true;
  FW.fieldBuildHour(state, base);
  const pile = r.fw;
  // A day's output from the ground 2 tiles out, with and without the stockpile beside it (the same world from here: a
  // copy made before it stood, the walk back to the base each time).
  const dayEnd = Math.floor(state.hour / 24) * 24 + 48;
  const noPile = loadFromString(noPileSave);
  const wd = (T) => (T && T.wood && T.wood.wood) || 0;
  const without = wd(tripDay(noPile, hub(noPile), dayEnd)), withIt = wd(tripDay(state, base, dayEnd));
  const tgWith = Wd.woodTripTile(state, base);
  note(`a woodcutter's day 2 tiles out: ${Math.round(without)} wood walking home, ${Math.round(withIt)} with the stockpile beside the ground (now going to ${tgWith.d} out)`);
  check(without > 0 && tgWith.d === 2 && withIt > without * 1.05, "far ground pays with a stockpile next to it: the day's wood rises (the midday load dropped there, out again from it, home at the end of the hours)");
  delete base.tripTally;
  check(pile && pile.built, `a stockpile stands next to the woods (${state.tiles[at].x},${state.tiles[at].y}), 1 tile from the hub`);
  const t1 = planTrip(state, base, cutter, "wood", d0 + 7);
  check(t1 && t1.drop === pile.tile && t1.workEnd - t1.arrive > plain.workEnd - plain.arrive + 0.2, `the morning trip drops at the stockpile: ${Math.round((t1.workEnd - t1.arrive) * 100) / 100} h at the work against ${Math.round((plain.workEnd - plain.arrive) * 100) / 100} walking home`);
  note(`the morning trip: ${Math.round((t1.workEnd - t1.arrive) * 100) / 100} h at the work dropping at the stockpile, ${Math.round((plain.workEnd - plain.arrive) * 100) / 100} h walking home`);
  const st1 = tripState(state, { trip: { ...t1, carry: { wood: 140 } } }, t1.home - 0.05);
  check(st1 && /^Dropping .*wood.* at stockpile \(\d+,\d+\)$/.test(st1.text), `on the way: "${st1 && st1.text}"`);
  const t2 = planTrip(state, base, cutter, "wood", t1.home + TRIP.deposit, t1.drop);
  check(t2 && t2.from === pile.tile && t2.drop == null && t2.arrive - t2.leave < plain.arrive - plain.leave, "the afternoon trip sets out from the stockpile (a shorter walk) and brings its load home (the window's last)");
  // A day of it: the morning's wood in the stockpile, the afternoon's at the base.
  tickTo(state, 6);
  const wood0 = base.stock.wood || 0, pile0 = pile.contents.wood || 0;
  let sawDrop = "";
  for (let i = 0; i < 16; i++) {
    tickHour(state);
    const a = describeActivity(state, cutter);
    if (/stockpile \(\d+,\d+\)/.test(a.why)) sawDrop = `${a.text} — ${a.why}`;
  }
  check((pile.contents.wood || 0) > pile0 && (base.stock.wood || 0) > wood0, `the morning's wood at the stockpile (${pile.contents.wood || 0}), the afternoon's at the base (+${Math.round((base.stock.wood || 0) - wood0)})`);
  check(/stockpile \(\d+,\d+\)/.test(sawDrop) && /haul team/.test(sawDrop), `the Work now line and its tooltip: "${sawDrop}"`);
  // The haul team brings it home.
  const inPile = pile.contents.wood || 0, w1 = base.stock.wood || 0;
  cutter.role = "rest";
  const res = FW.sendHaul(state, pile.id);
  check(res && !res.error, `a haul team sets out (${res && (res.error || res.text)})`);
  for (let i = 0; i < 24 && res.party && state.parties.includes(res.party); i++) tickHour(state);
  note(`a day: ${inPile} wood left at the stockpile; the haul brings it in`);
  const burned = (base.heat && base.heat.wood) || 0; // the night's fire at midnight meanwhile (fire-nights: upkeep.js HEAT.night)
  check(!(pile.contents.wood > 0.5) && (base.stock.wood || 0) + burned >= w1 + inPile * 0.9, `the haul brought it home: the stockpile ${JSON.stringify(pile.contents)}, the base's wood ${Math.round(w1)} → ${Math.round(base.stock.wood || 0)} (${Math.round(burned)} burned for the night's fire meanwhile)`);
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
