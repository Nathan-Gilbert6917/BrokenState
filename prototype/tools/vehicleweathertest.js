// Weather on the road for vehicles (src/sim/weather.js VEHICLE_WX, mudOdds / mudStuck / vehicleFuelWx / coldStart /
// roadOutlook; parties.js moveHour, aiPartyHour, launchExpedition, spawnAiParty, travelHours, fuelForPath, estimateTrip;
// the user's request 2026-10-25: "make weather and seasons matter more for decisions"):
//   1. mud odds by season, rain hours, road vs off-road and the vehicle's model;
//   2. a car stuck in the mud and freed again ("Stuck in mud: free in N h"), and a save and load while stuck;
//   3. fuel: snow and frost × 1.15, a blizzard × 1.3, in the real use and every estimate (winter range shrinks);
//   4. a cold start in a blizzard or a hard frost, none from a garage;
//   5. no fords: an unbridged river is closed to vehicles in every season (as before), so there is none to flood;
//   6. the planner's outlook text;
//   7. the groups' parties: the same mud, the same cold start, the same fuel in their estimates.
// Usage: node tools/vehicleweathertest.js [seed=7]
import { setFood } from "./foodkit.js";
import { createWorld, hub, makeSurvivor, atBase, tickHour } from "../src/sim/world.js";
import { launchExpedition, planPath, fuelForPath, estimateTrip, spawnAiParty, partyTile, moveCost, travelHours } from "../src/sim/parties.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { orderLabel } from "../src/sim/orders.js";
import { addBuilding } from "../src/sim/buildings.js";
import { worksAt } from "../src/sim/groupworks.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import * as WX from "../src/sim/weather.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const M = WX.VEHICLE_WX;
const keep = JSON.parse(JSON.stringify(M));
const restore = () => { Object.assign(M.MUD, keep.MUD); Object.assign(M.COLD, keep.COLD); Object.assign(M.FUEL, keep.FUEL); };

function setup() {
  const st = createWorld({ seed: SEED, factionCount: 4 });
  Object.assign(st, { started: true, noNewGangs: true, noPlayerWars: true, noWars: true, noBlocs: true, noWanderers: true, noRoadblocks: true });
  const h = hub(st);
  Object.assign(h.stock, { water: 400, meds: 80, fuel: 400, parts: 40 }); setFood(h, 600);
  for (let i = 0; i < 6; i++) makeSurvivor(st, h.id);
  st.hordes.length = 0;
  st.cards.length = 0;
  return { st, h };
}
// A tile 3–6 off the hub reached by car with off-road steps on the way.
function offroadDest(st, h) {
  for (const t of st.grid.within(h.tile, 6)) {
    if (st.grid.distance(t, h.tile) < 3 || st.tiles[t].terrain === "water") continue;
    const r = planPath(st, h.tile, t, true);
    if (r && r.path.slice(1).filter((x, i) => !st.tiles[r.path[i]].roadLinks.includes(x)).length >= 2) return { tile: t, path: r.path };
  }
  return null;
}
const hourWhere = (st, test, from = 0, to = 24 * 120) => { for (let h = from; h < to; h += 1) if (test(h)) return h; return null; };
const car = (st, h, type = "sedan") => createVehicle(st, type, { kind: "base", baseId: h.id }, { fuel: 60, condition: 90 });
const send = (st, h, v, dest) => {
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: v.id, supplies: { food: 3, water: 6, fuel: 10 } });
  if (res.error) throw new Error(res.error);
  return res.party;
};

section("1. mud odds: spring, rain hours, road vs off-road, the model");
{
  const { st, h } = setup();
  const t = h.tile;
  const spring = hourWhere(st, (x) => WX.season(st, x).key === "spring" && !WX.wetGround(st, t, x));
  const summerDry = hourWhere(st, (x) => WX.season(st, x).key === "summer" && !WX.wetGround(st, t, x));
  const summerWet = hourWhere(st, (x) => WX.season(st, x).key === "summer" && WX.wetGround(st, t, x)) ?? hourWhere(st, (x) => WX.season(st, x).key === "autumn" && WX.wetGround(st, t, x));
  const winter = hourWhere(st, (x) => WX.season(st, x).key === "winter");
  check(WX.mudOdds(st, t, spring, "sedan") === M.MUD.SPRING, `spring: ${M.MUD.SPRING} a step for a sedan`);
  check(WX.mudOdds(st, t, summerDry, "sedan") === 0, "a dry summer day: none");
  check(summerWet != null && WX.mudOdds(st, t, summerWet, "sedan") >= M.MUD.WET, `after ${3}+ hours of rain on the tile (puddles.js's clock), any season but winter: ${M.MUD.WET} or more`);
  check(WX.mudOdds(st, t, winter, "sedan") === 0, "winter: none (the ground is frozen or snowed over)");
  check(WX.mudOdds(st, t, spring, "hummer") < WX.mudOdds(st, t, spring, "suv") && WX.mudOdds(st, t, spring, "suv") < WX.mudOdds(st, t, spring, "sedan"), "four-wheel drive and the Army's less (hummer < suv < sedan)");
  check(WX.mudTypeMult(["sedan", "hummer"]) === 1, "a fleet goes by its worst");
  // Never on a road: the roll is skipped.
  const road = st.tiles.find((x) => x.roadLinks && x.roadLinks.length);
  M.MUD.SPRING = 1;
  st.hour = spring;
  const p = { vehicle: true, owner: "player", vehicleId: null, path: [] };
  check(WX.mudStuck(st, p, road.id, road.roadLinks[0], spring) === 0, "a road step: never stuck");
  restore();
}

section("2. stuck in the mud and freed; a save and load while stuck");
{
  const { st, h } = setup();
  const d = offroadDest(st, h);
  check(!!d, "a route with off-road steps");
  M.MUD.SPRING = 1; M.MUD.WET = 1; M.MUD.HOURS = [3, 3];
  st.hour = hourWhere(st, (x) => WX.season(st, x).key === "spring" && x % 24 === 9);
  const p = send(st, h, car(st, h, "sedan"), d.tile);
  let label = "";
  for (let i = 0; i < 12 && !p.stuck; i++) tickHour(st);
  label = orderLabel(st, p);
  check(!!p.stuck && p.stuck.hours === 3 && (p.progress || 0) < 0, `bogged down off the road (${p.stuck && p.stuck.hours} h owed)`);
  check(/Stuck in mud: free in \d+ h/.test(label), `the team's card says so ("${label}")`);
  check(st.log.some((l) => /bogged down in the mud/.test(l.text)), "a diary line");
  M.MUD.SPRING = 0; M.MUD.WET = 0;
  const st2 = loadFromString(saveToString(st));
  const p2 = st2.parties.find((x) => x.id === p.id);
  check(!!p2 && p2.stuck && p2.stuck.until === p.stuck.until && p2.progress === p.progress, "the stuck state survives a save and load");
  const at = p.idx;
  for (let i = 0; i < 6 && p.idx === at; i++) tickHour(st);
  check(p.idx > at || p.phase !== "out", "freed after its hours, it drives on");
  restore();
}

section("3. fuel: snow and frost × 1.15, a blizzard × 1.3; winter range shrinks");
{
  const { st, h } = setup();
  const t = h.tile;
  const snow = hourWhere(st, (x) => ["snow", "frost"].includes(WX.weatherAt(st, t, x).key));
  check(snow != null && WX.vehicleFuelWx(st, t, snow) === M.FUEL.snow, `snow or a hard frost: × ${M.FUEL.snow}`);
  check(WX.vehicleFuelWx(st, t, 12) === 1 || WX.weatherAt(st, t, 12).snowCover >= M.FUEL.SNOW_COVER, "a spring day: × 1");
  const bliz = hourWhere(st, (x) => WX.weatherAt(st, t, x).key === "blizzard", 0, 24 * 400);
  if (bliz != null) check(WX.vehicleFuelWx(st, t, bliz) === M.FUEL.blizzard, `a blizzard: × ${M.FUEL.blizzard}`);
  const d = offroadDest(st, h);
  st.hour = snow; // the fronts known by then (an estimate counts only those on the map)
  const fair = fuelForPath(st, d.path, 1, null), cold = fuelForPath(st, d.path, 1, snow);
  check(cold > fair, `the estimate in the cold is higher (${cold.toFixed(1)} vs ${fair.toFixed(1)})`);
  const tf = travelHours(st, d.path, { vehicle: true, startHour: snow, known: snow, fuel: 1e9 });
  check(tf.fuelUsed > tf.fuelFair, "travelHours burns the weather's fuel step by step");
  const v = car(st, h, "sedan");
  const est = estimateTrip(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: d.tile, vehicle: true, stance: "normal", homeBaseId: h.id, fuel: 60, v });
  check(est.fuel >= Math.ceil(fair * 2 - 1e-9) && est.outlook && est.outlook.fuelPct >= 1, `the planner's fuel includes it (${est.fuel}, outlook fuel +${est.outlook && est.outlook.fuelPct}%)`);
  // The real use, tile by tile.
  const p = send(st, h, v, d.tile);
  const f0 = v.fuel + (p.supplies.fuel || 0);
  for (let i = 0; i < 10 && p.phase === "out"; i++) tickHour(st);
  check(f0 - (v.fuel + (p.supplies.fuel || 0)) > fuelForPath(st, p.path.slice(0, p.idx + 1), 1, null) * 0.99, "the drive itself burns more in the cold");
}

section("4. a cold start in a blizzard or a hard frost; none from a garage");
{
  const { st, h } = setup();
  const frost = hourWhere(st, (x) => M.COLD.KINDS.includes(WX.weatherAt(st, h.tile, x).key), 0, 24 * 400);
  check(frost != null, "a frost or a blizzard in the year");
  M.COLD.CHANCE = 1; M.COLD.HOURS = [2, 2];
  st.hour = frost;
  const d = offroadDest(st, h);
  const p = send(st, h, car(st, h), d.tile);
  check(!!p.coldStart && p.coldStart.hours === 2 && (p.progress || 0) < -1, "the engines would not start: 2 hours owed");
  check(st.log.some((l) => /would not start in the cold/.test(l.text)), "a diary line");
  addBuilding(h, "garage");
  const q = send(st, h, car(st, h, "suv"), d.tile);
  check(!q.coldStart, "a car from the garage starts");
  st.hour = hourWhere(st, (x) => !M.COLD.KINDS.includes(WX.weatherAt(st, h.tile, x).key));
  check(WX.coldStartRisk(st, h.tile, st.hour) === 0, "no cold start out of the cold");
  restore();
}

section("5. no fords to flood: an unbridged river is closed to vehicles in every season");
{
  const { st } = setup();
  const river = st.tiles.find((t) => t.terrain === "water" && !t.bridge);
  const bank = river && st.grid.neighbors(river.id).find((x) => st.tiles[x].terrain !== "water");
  check(!!river && [12, 24 * 40, 24 * 75].every((hr) => moveCost(st, bank, river.id, true, "player", hr) === Infinity), "a car never crosses a river without a bridge (spring, summer, winter): nothing for a storm to close");
}

section("6. the planner's outlook");
{
  const { st, h } = setup();
  const d = offroadDest(st, h);
  st.hour = hourWhere(st, (x) => WX.season(st, x).key === "spring" && x % 24 === 8);
  const est = estimateTrip(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: d.tile, vehicle: true, stance: "normal", homeBaseId: h.id, fuel: 60, v: car(st, h) });
  console.log(`    "${est.outlook.text}"`);
  check(est.outlook.mud > 0 && /^Spring mud on \d+ of \d+ tiles/.test(est.outlook.text) && /may get stuck \(\d+%\)/.test(est.outlook.text), "spring: mud on N of M tiles, may get stuck (odds)");
  check(est.outlook.stuck > 0 && est.outlook.stuck < 1, `the odds of getting stuck on the way (${Math.round(est.outlook.stuck * 100)}%)`);
  const foot = estimateTrip(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: d.tile, vehicle: false, stance: "normal", homeBaseId: h.id });
  check(!foot.outlook, "on foot: no vehicle outlook");
}

section("7. the groups' parties obey the same rules");
{
  const { st, h } = setup();
  const f = st.factions.find((x) => x.alive && x.bases.length && !x.outsider);
  const to = st.grid.within(f.bases[0], 6).find((t) => st.grid.distance(t, f.bases[0]) >= 3 && st.tiles[t].terrain !== "water" && (() => { const r = planPath(st, f.bases[0], t, true, f.id); return r && r.path.slice(1).some((x, i) => !st.tiles[r.path[i]].roadLinks.includes(x)); })());
  M.MUD.SPRING = 1; M.MUD.WET = 1; M.MUD.HOURS = [4, 4];
  st.hour = hourWhere(st, (x) => WX.season(st, x).key === "spring" && x % 24 === 10);
  const q = spawnAiParty(st, f, "convoy", f.bases[0], to, { strength: 4 });
  for (let i = 0; i < 10 && !q.stuck && st.parties.includes(q); i++) tickHour(st);
  check(!!q.stuck && q.stuck.hours === 4 && q.progress < 0, `their convoy bogs down too (${q.stuck && q.stuck.hours} h)`);
  restore();
  M.COLD.CHANCE = 1;
  st.hour = hourWhere(st, (x) => M.COLD.KINDS.includes(WX.weatherAt(st, f.bases[0], x).key), 0, 24 * 400);
  const c = spawnAiParty(st, f, "convoy", f.bases[0], to, { strength: 4 });
  check(!!c.coldStart && c.progress < 0, "their convoy's cold start");
  worksAt(f, f.bases[0]).garage = 1;
  const g = spawnAiParty(st, f, "convoy", f.bases[0], to, { strength: 4 });
  check(!g.coldStart, "none from their garage");
  restore();
  const r = planPath(st, f.bases[0], to, true, f.id);
  check(fuelForPath(st, r.path, 1, st.hour) >= fuelForPath(st, r.path, 1, null), "their hauls' and caravans' fuel estimates (fuelForPath) count the weather as yours do");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
