// Headless checks for wrecked cars and other finds on the map (parties.js investigate, markers.js mergeSpots,
// vehicles.js wreckCost / wreckSupplies, the governor's trips to finds in autopilot.js planTrip).
// The census (seed 1, balanced, 6eace3f) had the governor send two people to the same wrecked car every two to four
// days for weeks: another team had taken it, an older sighting put it back on the map, the team found it "cleaned out"
// and the marker stayed. It also packed 2 machine parts the hub did not have, though a car is mended with car parts.
// Usage: node tools/wrecktest.js [seed]
import { createWorld, tickHour, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, planPath, carried, reportsLive } from "../src/sim/parties.js";
import { mergeSpots } from "../src/sim/markers.js";
import { wreckCost, wreckSupplies, WRECK, CARPART_SUB } from "../src/sim/vehicles.js";
import { setAutopilot, autopilotDaily } from "../src/sim/autopilot.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(stock = {}) {
  const state = createWorld({ seed: SEED, factionCount: 7 });
  state.started = true;
  state.autoCombat = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { food: 300, water: 300, fuel: 100, meds: 20, ammo: 300, parts: 0, carparts: 0, scrap: 100, ...stock });
  return state;
}
// A reachable land tile 2..4 tiles from the hub with nothing hidden on it.
function wreckTile(state) {
  const h = hub(state);
  for (const t of state.tiles) {
    const d = state.grid.distance(h.tile, t.id);
    if (d < 2 || d > 4 || t.terrain === "water" || t.hidden || t.loc || state.bases.some((b) => b.tile === t.id)) continue;
    if (planPath(state, h.tile, t.id, false)) return t.id;
  }
  return null;
}
function arrive(state, p) {
  for (let i = 0; i < 24 * 4 && p.phase !== "engaged" && p.phase !== "waiting" && state.parties.includes(p); i++) {
    state.hordes.length = 0;
    tickHour(state);
    if (state.combat) state.combat = null;
    for (let k = state.cards.length - 1; k >= 0; k--) if (state.cards[k].partyId !== p.id) state.cards.splice(k, 1);
  }
}
function sendTo(state, tile, supplies) {
  const h = hub(state);
  for (const [k, q] of Object.entries(supplies)) h.stock[k] = (h.stock[k] || 0) + q; // the hub has what the team takes
  const ids = atBase(state, h.id).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(state, { memberIds: ids, dest: tile, mission: "investigate", stance: "normal", supplies: { food: 5, water: 5, ...supplies } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  return res.party;
}
const wreckCard = (state, p) => state.cards.find((c) => c.partyId === p.id && c.title === "Wrecked car");
const isOff = (c) => (typeof c.disabled === "function" ? c.disabled() : !!c.disabled);

// ---------------------------------------------------------------------------------------------------------
section("The price of a restore: car parts, machine parts standing in");
{
  const pay = (stock) => wreckCost((k) => stock[k] || 0);
  check(pay({ carparts: 2, fuel: 6 }).ok && pay({ carparts: 2, fuel: 6 }).car === 2 && !pay({ carparts: 2, fuel: 6 }).parts, "2 car parts and 6 fuel pay for it");
  check(pay({ parts: 2 * CARPART_SUB, fuel: 6 }).ok && pay({ parts: 4, fuel: 6 }).parts === 4, `${2 * CARPART_SUB} machine parts stand in for the car parts`);
  check(pay({ carparts: 1, parts: CARPART_SUB, fuel: 6 }).ok, "a car part and machine parts for the other");
  check(!pay({ parts: 2, fuel: 6 }).ok, "2 machine parts alone are not enough any more (car parts: part kinds)");
  check(!pay({ carparts: 2, fuel: 5 }).ok, "short of fuel: no restore");
  check(wreckSupplies({ parts: 0, carparts: 0, fuel: 50 }) === null, "a hub with no parts of either kind packs nothing for a restore");
  const kit = wreckSupplies({ carparts: 5, parts: 9, fuel: 50 });
  check(kit && kit.carparts === WRECK.parts && !kit.parts && kit.fuel === WRECK.fuel, `the kit takes car parts first (${JSON.stringify(kit)})`);
}

section("Restoring a wreck takes the car parts");
{
  const state = mk();
  const tile = wreckTile(state);
  state.tiles[tile].hidden = { type: "car", known: true, taken: false };
  const p = sendTo(state, tile, { carparts: 2, fuel: 6, parts: 3 });
  arrive(state, p);
  const card = wreckCard(state, p);
  if (check(card, "no Wrecked car card on arrival")) {
    const restore = card.choices.find((c) => /^Restore/.test(c.label));
    check(restore && !isOff(restore), `restore offered with 2 car parts (${restore && restore.label})`);
    const chance = state.rng.chance;
    state.rng.chance = () => true;
    restore.resolve(state);
    state.rng.chance = chance;
    check(carried(p, "carparts") === 0 && carried(p, "parts") === 3, `paid in car parts, machine parts kept (car ${carried(p, "carparts")}, machine ${carried(p, "parts")})`);
    check(p.vehicle && state.tiles[tile].hidden.taken, "the car runs and the wreck is gone");
  }
  // Machine parts alone, 2 of them: the old price; not enough now.
  const s2 = mk();
  const t2 = wreckTile(s2);
  s2.tiles[t2].hidden = { type: "car", known: true, taken: false };
  const p2 = sendTo(s2, t2, { parts: 2, fuel: 6 });
  arrive(s2, p2);
  const c2 = wreckCard(s2, p2);
  if (check(c2, "no Wrecked car card on arrival (2 machine parts)")) {
    check(isOff(c2.choices.find((c) => /^Restore/.test(c.label))), "restore offered with only 2 machine parts");
    check(!isOff(c2.choices.find((c) => /^Strip/.test(c.label))), "stripping is always there");
  }
}

section("A find already taken: the marker is put right");
{
  const state = mk();
  const tile = wreckTile(state);
  state.tiles[tile].hidden = { type: "car", known: true, taken: true };
  const key = `car:${tile}`;
  state.markers.push({ key, type: "car", tile, hour: state.hour - 50, label: "Wrecked car" }); // a stale sighting
  const p = sendTo(state, tile, {});
  arrive(state, p);
  const e = p.spotted && p.spotted.get(key);
  // A team reporting live (parties.js reportsLive: TEAM_INTEL_EVERYWHERE, or in radio range) puts the marker right as it
  // sees the tile (markers.js updateLiveMarkers), before it gets there: nothing left for its report to correct.
  const live = reportsLive(p) && state.markers.some((x) => x.key === key && x.info && x.info.emptied);
  check(live || (e && e.info && e.info.emptied), "the team does not report the cleaned-out wreck as emptied");
  mergeSpots(state, p.spotted);
  const m = state.markers.find((x) => x.key === key);
  check(m && m.info && m.info.emptied, "the marker still shows a wreck to visit");
  // An older sighting of a find since taken is not put back on the map.
  state.markers.splice(state.markers.indexOf(m), 1);
  mergeSpots(state, new Map([[key, { key, type: "car", tile, hour: state.hour - 100, label: "Wrecked car" }]]));
  check(!state.markers.some((x) => x.key === key && !(x.info && x.info.emptied)), "an old report put a taken wreck back on the map");
}

section("The governor: one trip to a find, not one every few days");
{
  const state = mk({ parts: 0, carparts: 0 });
  setAutopilot(state, true, "balanced");
  const h = hub(state);
  const tile = wreckTile(state);
  state.tiles[tile].hidden = { type: "car", known: true, taken: true };
  const key = `car:${tile}`;
  state.markers.push({ key, type: "car", tile, hour: state.hour, label: "Wrecked car" });
  let trips = 0, packed = 0;
  const seen = new Set();
  for (let i = 0; i < 24 * 110 && !state.gameOver; i++) { // 110 days (40 before 2026-10-10: the arsenal balance changed the campaign, its one trip came on day 55; 60 until food-types: food by type changed it again, the trip came on day 107)
    state.hordes.length = 0;
    tickHour(state);
    for (const p of state.parties) {
      if (p.owner !== "player" || seen.has(p.id) || p.dest !== tile) continue;
      seen.add(p.id);
      if (p.mission !== "investigate") continue; // a hunt or a walk that ends on the same tile
      trips++;
      if (process.env.WRECK_DEBUG) console.log(`  day ${Math.floor(state.hour / 24)}: ${p.mission} to the wreck`);
      packed += (p.supplies.parts || 0) + (p.supplies.carparts || 0);
    }
  }
  check(trips <= 1, `${trips} trips to the same cleaned-out wreck in 110 days`);
  check(packed === 0, `a team packed ${packed} parts for a wreck it could not restore (the hub has its car, or no parts)`);
  const g = state.governor || {};
  check(!state.markers.some((m) => m.key === key && !(m.info && m.info.emptied)), "the wreck is still on the map to visit after 110 days");
  console.log(`  ${trips} trip(s) to the cleaned-out wreck in 110 days; hub parts ${h.stock.parts || 0}, car parts ${h.stock.carparts || 0}${g.findTried ? `; tried ${Object.keys(g.findTried).length} find(s)` : ""}`);
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
