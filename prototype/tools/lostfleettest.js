// A whole team lost in the field keeps what it carried in its vehicles (sim/parties.js wipeParty, stowLost; the
// user's request 2026-10-25: "If a whole team is lost keep the vehicles in the tile lost to be recovered with whatever
// was in them as long as other groups do not loot it first"):
//   1. a team with two vehicles and cargo, wiped on a tile: both stand abandoned there with the cargo inside (each up
//      to its own room, the lead first), marked "cargo inside"; nothing lost, nothing on the ground but the dead's kit;
//   2. a new team recovers one (Recover vehicle: parties.js recoverVehicle) and gets its cargo back;
//   3. a group near the tile takes the other with its cargo into its stores (groupworld.js vehicleDaily, takeVehicle);
//   4. bikes: the racks take what they take, the rest goes on the ground; a group strips the racks and leaves the bikes
//      (groupworld.js stripRacks), the marker no longer says cargo inside;
//   5. no vehicle: everything on the ground as before (a death site, marked).
// Usage: node tools/lostfleettest.js
import { createWorld, hub, atBase, hurt } from "../src/sim/world.js";
import { launchExpedition, wipeIfEmpty, giveOrder, cargoLoad } from "../src/sim/parties.js";
import { partyVehicles, partyVehicle, createVehicle, setPartyVehicles, vehicleCapacity, VEHICLE_TYPES } from "../src/sim/vehicles.js";
import { groupWorldDaily, VEH } from "../src/sim/groupworld.js";
import { newItem } from "../src/sim/inventory.js";
import { supWeight } from "../src/sim/data.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);

// A world with a group near open land: the tile two from the group's first base where the team is lost.
function setup(fleet) {
  const state = createWorld({ seed: 33, factionCount: 5, fleet });
  const h = hub(state);
  const f = state.factions.find((x) => x.alive && x.bases.length && !x.outsider);
  const near = state.tiles.find((t) => t.terrain !== "water" && !t.loc && state.grid.distance(t.id, f.bases[0]) === 2 && !state.bases.some((b) => b.tile === t.id) && !state.factions.some((x) => x.bases.includes(t.id)) && !state.deathSites.some((d) => d.tile === t.id));
  return { state, h, f, tile: near.id };
}
function team(state, h, n, vehicleIds) {
  const crew = atBase(state, h.id).slice(0, n);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "move", stance: "normal", vehicleIds, supplies: { food: 0, water: 0, ammo: 0, meds: 0 } });
  if (res.error) throw new Error(res.error);
  return { p: res.party, crew };
}
const place = (p, tile) => { p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; };
const kill = (state, crew, tile) => { for (const s of crew) hurt(state, s, 9999, tile, "in a fight"); };
const groundAt = (state, tile) => state.deathSites.find((d) => d.tile === tile);
const groundOf = (state, tile, key) => ((groundAt(state, tile) || { items: [] }).items.filter((it) => it.key === key).reduce((a, it) => a + it.qty, 0));
const markOf = (state, v) => state.markers.find((m) => m.key === `vehicle:${v.id}`);

section("1. a team with two vehicles lost in the field: the vehicles stay with the cargo inside");
const S = setup([{ type: "truck" }, { type: "van" }]);
let truck, van;
{
  const { state, h, tile } = S;
  const ids = state.vehicles.filter((v) => v.loc.kind === "base").slice(0, 2).map((v) => v.id);
  const { p, crew } = team(state, h, 2, ids);
  [truck, van] = partyVehicles(state, p);
  check(truck.type === "truck" && van.type === "van" && partyVehicle(state, p) === truck, "the pickup leads, the van second");
  place(p, tile);
  // More than the pickup takes: the rest fills the van.
  const scrapKg = supWeight("scrap");
  const scrap = Math.ceil((vehicleCapacity(truck) + 100) / scrapKg);
  p.cargo.supplies = { scrap, meds: 4 };
  p.supplies = { fuel: 6, water: 10 };
  const blade = newItem("machete"), vest = newItem("vest", 0.8);
  p.cargo.gear = [blade, vest];
  const kg0 = cargoLoad(p.cargo) + cargoLoad({ supplies: p.supplies, gear: [] });
  kill(state, crew, tile);
  wipeIfEmpty(state, p);
  check(!state.parties.includes(p), "the team is gone");
  check([truck, van].every((v) => v.loc.kind === "abandoned" && v.loc.tile === tile), "both vehicles abandoned on the tile where it was lost");
  const inTruck = cargoLoad(truck.cargo), inVan = cargoLoad(van.cargo);
  check(inTruck > 0 && inTruck <= vehicleCapacity(truck) + 1e-6 && inVan > 0 && inVan <= vehicleCapacity(van) + 1e-6, `each filled up to its own room, the lead first (pickup ${Math.round(inTruck)}/${vehicleCapacity(truck)} kg, van ${Math.round(inVan)}/${vehicleCapacity(van)} kg)`);
  check(vehicleCapacity(truck) - inTruck < scrapKg + 1, "the pickup is full before the van takes any");
  const sum = (k) => ((truck.cargo && truck.cargo.supplies[k]) || 0) + ((van.cargo && van.cargo.supplies[k]) || 0) + groundOf(state, tile, k);
  check(sum("scrap") === scrap && sum("meds") === 4 && sum("fuel") === 6 && sum("water") === 10, `nothing lost: scrap ${sum("scrap")}/${scrap}, meds ${sum("meds")}, fuel ${sum("fuel")}, water ${sum("water")}`);
  const gearIn = [...(truck.cargo ? truck.cargo.gear : []), ...(van.cargo ? van.cargo.gear : [])];
  check(p.cargo.gear.length === 0 && [blade, vest].every((g) => gearIn.includes(g)), "the cargo's gear in the vehicles (the very items)");
  check(Math.abs(inTruck + inVan - kg0) < 1, `all of it inside: ${Math.round(inTruck + inVan)} of ${Math.round(kg0)} kg (the two take ${vehicleCapacity(truck) + vehicleCapacity(van)} kg)`);
  check(!groundAt(state, tile) || groundAt(state, tile).items.every((it) => !["scrap", "meds", "fuel", "water"].includes(it.key)), "nothing of the cargo on the ground (only the dead's own kit)");
  check([truck, van].every((v) => markOf(state, v) && /cargo inside/.test(markOf(state, v).label) && markOf(state, v).tile === tile), `marked on the map with cargo inside (${markOf(state, truck) && markOf(state, truck).label})`);
  const line = state.log.find((l) => /A whole team was lost/.test(l.text));
  check(!!line && /with what it carried inside/.test(line.text), `the log says what it carried is inside ("${line && line.text}")`);
}

section("2. a new team recovers the pickup and gets its cargo back");
{
  const { state, h, tile } = S;
  const { p } = team(state, h, 2, []);
  place(p, tile);
  truck.fuel = Math.max(truck.fuel, 15); truck.condition = Math.max(truck.condition, 60);
  const want = { ...truck.cargo.supplies };
  const items = [...truck.cargo.gear];
  const g0 = Object.fromEntries(Object.keys(want).map((k) => [k, groundOf(state, tile, k)]));
  p.cargo = { supplies: {}, gear: [] };
  giveOrder(state, p, "getvehicle");
  check(partyVehicles(state, p).includes(truck) && truck.loc.kind === "party", "the pickup is the team's again");
  const got = (k) => p.cargo.supplies[k] || 0;
  const onGround = (g) => (groundAt(state, tile) || { items: [] }).items.some((it) => it.item === g);
  check(!truck.cargo && items.some((g) => p.cargo.gear.includes(g)) && got("scrap") > 0 && got("meds") === (want.meds || 0), `its cargo came back with it (${Object.keys(want).map((k) => `${got(k)}/${want[k]} ${k}`).join(", ")}; ${p.cargo.gear.map((g) => g.name).join(", ")})`);
  check(items.every((g) => p.cargo.gear.includes(g) || onGround(g)), `its gear with the team or, with no room left, on the ground (${items.filter(onGround).map((g) => g.name).join(", ") || "none"})`);
  // A full pickup is more than a team riding in it has room for: the rest is set down on the tile, never lost.
  check(Object.entries(want).every(([k, q]) => Math.abs(got(k) + groundOf(state, tile, k) - g0[k] - q) < 1e-6), `what the team had no room for lies on the ground there (${Object.keys(want).map((k) => `${groundOf(state, tile, k) - g0[k]} ${k}`).join(", ")})`);
  check(!markOf(state, truck) || !p.spotted.get(`vehicle:${truck.id}`) || p.spotted.get(`vehicle:${truck.id}`).remove, "its marker goes");
  check(van.loc.kind === "abandoned" && van.loc.tile === tile && !!van.cargo, "the van still stands there with its cargo");
}

section("3. a group near the tile takes the van with its cargo");
{
  const { state, f } = S;
  const take0 = VEH.TAKE;
  VEH.TAKE = 1e9; // their dice always say yes
  const stock0 = { ...f.stock };
  const want = { ...van.cargo.supplies };
  const rec0 = (f.vehicles || []).length;
  for (let i = 0; i < 30 && state.vehicles.includes(van); i++) groupWorldDaily(state, f);
  VEH.TAKE = take0;
  check(!state.vehicles.includes(van) && (f.vehicles || []).length > rec0, `${f.name} took the van into its motor pool`);
  check(Object.entries(want).every(([k, q]) => ((f.stock[k === "rawwater" ? "water" : k] || 0) - (stock0[k === "rawwater" ? "water" : k] || 0)) >= q - 1e-6), `what was in it went into their stores (${Object.entries(want).map(([k, q]) => `${q} ${k}`).join(", ")})`);
  check(!markOf(state, van), "its marker is gone");
}

section("4. bikes: the racks take what they take, the rest on the ground; a group strips the racks");
{
  const { state, h, f, tile } = setup([]);
  const { p, crew } = team(state, h, 2, []);
  const bikes = createVehicle(state, "bike", { kind: "base", baseId: h.id }, { count: 2, condition: 80 });
  setPartyVehicles(state, p, [bikes]);
  place(p, tile);
  const rack = vehicleCapacity(bikes);
  check(rack === 2 * VEHICLE_TYPES.bike.rack, `two bikes: ${rack} kg of racks`);
  const n = Math.ceil((rack + 20) / supWeight("scrap"));
  p.cargo.supplies = { scrap: n };
  p.cargo.gear = [];
  p.supplies = {};
  kill(state, crew, tile);
  wipeIfEmpty(state, p);
  const onRack = (bikes.cargo && bikes.cargo.supplies.scrap) || 0;
  check(bikes.loc.kind === "abandoned" && bikes.loc.tile === tile && onRack > 0 && onRack * supWeight("scrap") <= rack + 1e-6, `the bikes stay with ${onRack} scrap on the racks`);
  check(onRack + groundOf(state, tile, "scrap") === n && groundOf(state, tile, "scrap") > 0, `the rest on the ground (${groundOf(state, tile, "scrap")})`);
  check(/cargo inside/.test((markOf(state, bikes) || { label: "" }).label), "marked with cargo inside");
  const take0 = VEH.TAKE;
  VEH.TAKE = 1e9;
  const s0 = f.stock.scrap || 0;
  for (let i = 0; i < 30 && bikes.cargo; i++) groupWorldDaily(state, f);
  VEH.TAKE = take0;
  check(state.vehicles.includes(bikes) && bikes.loc.kind === "abandoned" && !bikes.cargo, "the group leaves the bikes but strips the racks");
  check((f.stock.scrap || 0) - s0 >= onRack, `the racks' scrap into their stores (+${(f.stock.scrap || 0) - s0})`);
  const strip = state.log.find((l) => /stripped what was on the/.test(l.text));
  check(!f.known && !state.live.has(tile) ? !strip : !!strip, `logged where you would know of it (${strip ? `"${strip.text}"` : "out of sight: no line"})`);
  check(markOf(state, bikes) && !/cargo inside/.test(markOf(state, bikes).label) && /stripped/.test(markOf(state, bikes).label), `the marker says so (${markOf(state, bikes) && markOf(state, bikes).label})`);
  const again = state.vehicles.length;
  groupWorldDaily(state, f);
  check(state.vehicles.includes(bikes) && state.vehicles.length <= again, "empty bikes are left alone");
}

section("5. no vehicle: the cargo on the ground as before");
{
  const { state, h, tile } = setup([]);
  const { p, crew } = team(state, h, 2, []);
  place(p, tile);
  check(!partyVehicles(state, p).length, "a team on foot");
  p.cargo.supplies = { scrap: 5, meds: 2 };
  p.supplies = { water: 3 };
  kill(state, crew, tile);
  wipeIfEmpty(state, p);
  check(groundOf(state, tile, "scrap") === 5 && groundOf(state, tile, "meds") === 2 && groundOf(state, tile, "water") === 3, "everything it carried on the ground (a death site)");
  check(state.markers.some((m) => m.key === `death:${tile}`), "the death site is marked");
  check(!state.vehicles.some((v) => v.loc.kind === "abandoned" && v.loc.tile === tile && v.cargo), "no vehicle there");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
