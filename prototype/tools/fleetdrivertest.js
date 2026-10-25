// Who drives each starting vehicle (sim/startfleet.js fleetDrivers, seatDrivers, pickDriver; 2026-10-24, user request:
// "For a new game start for setting vehicles also set which survivor is driving it with a dropdown of avaliable
// survivors").
//   1. by default one at each wheel: Normal and Custom the crew in order, Hardcore's car its owner (whose car it was);
//   2. a driver set on the screen is the one at that wheel (v.driver), kept through a rebuild; one picked who drives
//      another vehicle swaps with that one's driver; a crew made smaller drops a driver past it;
//   3. the screen: a Driver select on each vehicle's row (Customize on or off), the free survivors first and the ones at
//      another wheel under "Swap with"; Hardcore's start lines name a driver who is not the car's owner;
//   4. teams (sim/vehicles.js teamDrivers; 2026-10-24, user request: "make the driver be the one at the wheel in battles
//      and teams with vehicles"): a car's own driver on the team drives it, else the first free one; the team's card says so;
//   5. battles (sim/combat.js wheelSid, wheelUnit, wheelTaken): the team's driver takes the wheel as they get in, sits
//      in the cab, and nobody else drives while they are inside; out, anyone may.
// Usage: node tools/fleetdrivertest.js
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { teamDrivers, partyVehicles } from "../src/sim/vehicles.js";
import { createBattle, registerCombatHandler, combatAct, cabSeat, wheelUnit, wheelTaken, CELL } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { setRounds } from "../src/sim/ammo.js";
import { renderExpedition } from "../src/ui/expedition.js";
import { cleanFleet, fitFleet, fleetDrivers, fleetDriver, fleetVehicle, resizeFleet } from "../src/sim/startfleet.js";
import { newRunScreen } from "../src/ui/newgame.js";
import { SG_CHANGE } from "../src/ui/startgear.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const SMALL = { people: 4, groups: 3, hives: 3, cities: 1, towns: 6, military: 1 }; // a quick Custom map
const UI = (extra = {}) => ({ started: false, freeEdit: false, ironman: false, worldSize: "normal", factionCount: 5, nrMsg: "", ...extra });
const sel = (i, v) => ({ dataset: { i: String(i) }, value: String(v) });

section("1. one at each wheel by default");
{
  check(cleanFleet([{ driver: 2 }, { driver: "x" }, { driver: 40 }], "custom").map((f) => f.driver).join() === "2,,", "a driver made safe: a place in the crew, else null");
  check(fitFleet([{ driver: 3 }], 2, "normal")[0].driver === null, "a driver past the crew dropped");
  const cs = createWorld({ seed: 42, factionCount: 5, custom: SMALL, fleet: resizeFleet([], 3) });
  const d = fleetDrivers(cs);
  check(d.slice(0, 3).map((s) => s && s.id).join() === cs.survivors.slice(0, 3).map((s) => s.id).join() && d[3] === null, "Custom: the crew in order at the three wheels, the free slot none");
  check([0, 1, 2].every((i) => fleetVehicle(cs, i).driver === d[i].id), "each vehicle knows its driver (v.driver)");
  const hc = createWorld({ seed: 42, factionCount: 5, mode: "hardcore" });
  check(fleetDriver(hc, 0) && fleetDriver(hc, 0).id === hc.hardcore.start.carOwner && fleetVehicle(hc, 0).driver === hc.hardcore.start.carOwner, "Hardcore: the car's owner at its wheel");
}

section("2. a driver set, kept, swapped");
{
  const fleet = [{ type: "truck", driver: 2 }, { type: "van" }];
  const cs = createWorld({ seed: 42, factionCount: 5, custom: SMALL, fleet });
  check(fleetDriver(cs, 0) === cs.survivors[2] && fleetDriver(cs, 1) === cs.survivors[0], "the third survivor drives the pickup, the first free one the van");
  const ui = UI({ mode: "custom", fleet: cleanFleet(fleet, "custom") });
  check(SG_CHANGE["fleet-driver"](cs, ui, sel(1, 2)) === "fleet" && ui.fleet[1].driver === 2 && ui.fleet[0].driver === 0, "picking the pickup's driver for the van swaps them");
  const re = createWorld({ seed: 42, factionCount: 5, custom: SMALL, fleet: ui.fleet });
  check(fleetDriver(re, 1) === re.survivors[2] && fleetDriver(re, 0) === re.survivors[0] && fleetVehicle(re, 1).driver === re.survivors[2].id, "the world again: the drivers as picked");
  check(SG_CHANGE["fleet-driver"](re, ui, sel(1, 2)) === false, "the same driver again: nothing to do");
  check(SG_CHANGE["fleet-driver"](re, UI({ started: true, fleet: ui.fleet }), sel(1, 3)) === false, "not once started");
  const hfleet = [{ type: null, driver: null }, { type: "suv", driver: null }];
  const h0 = createWorld({ seed: 7, factionCount: 5, mode: "hardcore", startPeople: 3, fleet: hfleet });
  const owner = h0.survivors.findIndex((s) => s.id === h0.hardcore.start.carOwner), other = h0.survivors.findIndex((s, i) => i !== owner && s !== fleetDriver(h0, 1));
  const hu = UI({ mode: "hardcore", fleet: cleanFleet(hfleet, "hardcore") });
  SG_CHANGE["fleet-driver"](h0, hu, sel(0, other));
  const h1 = createWorld({ seed: 7, factionCount: 5, mode: "hardcore", startPeople: 3, fleet: hu.fleet });
  check(fleetDriver(h1, 0) === h1.survivors[other] && h1.survivors.findIndex((s) => s.id === h1.hardcore.start.carOwner) === owner && h1.survivors.map((s) => s.name).join() === h0.survivors.map((s) => s.name).join(), "Hardcore: another at the car's wheel, the same crew and owner");
  const first = h1.survivors[other].name.split(" ")[0];
  check(h1.hardcore.start.grabbed.some((l) => l.includes(`${first} at the wheel`)), `Hardcore: the start's line names ${first} at the wheel`);
  check(h1.hardcore.start.grabbed.some((l) => /\(\w+ driving\)/.test(l)), "and who drives the SUV along");
}

section("3. the screen");
{
  const cs = createWorld({ seed: 42, factionCount: 5, custom: SMALL, fleet: resizeFleet([], 2) });
  for (const free of [false, true]) {
    const h = newRunScreen(cs, UI({ mode: "custom", freeEdit: free }));
    const s0 = (h.match(/data-action="fleet-driver" data-i="0"[\s\S]*?<\/select>/) || [""])[0];
    check((h.match(/data-action="fleet-driver"/g) || []).length === 2, `Customize ${free ? "on" : "off"}: a Driver select on each vehicle`);
    check(new RegExp(`value="0" selected>${cs.survivors[0].name}<`).test(s0) && s0.includes(`>${cs.survivors[2].name}<`) && /<optgroup label="Swap with"><option value="1" >[^<]+ \(at Vehicle 2\)</.test(s0), `Customize ${free ? "on" : "off"}: its driver, the free ones, and the one at Vehicle 2's wheel under Swap with`);
  }
}

registerCombatHandler("fleetdrivertest", () => {});
// A team of three from the hub with its pickup (the hub's first vehicle), the third survivor its driver unless not on it.
const teamOut = (state, ids) => {
  const h = hub(state);
  setRounds(h.stock, 200, ids.map((id) => state.survivors.find((s) => s.id === id)).map((s) => s.gear.weapon && s.gear.weapon.key).filter(Boolean));
  const res = launchExpedition(state, { memberIds: ids, dest: state.tiles.find((t) => t.road && !t.loc && t.terrain !== "water" && t.id !== h.tile && state.grid.distance(t.id, h.tile) > 1).id, mission: "scavenge", stance: "normal", vehicleId: state.vehicles[0].id, supplies: { food: 6, water: 6, ammo: 30, meds: 1 } });
  if (res.error) throw new Error(res.error);
  return res.party;
};

section("4. teams: the car's driver at its wheel");
{
  const state = createWorld({ seed: 21, factionCount: 5, fleet: [{ type: "truck", driver: 2 }] });
  const crew = atBase(state, hub(state).id), d = state.survivors[2];
  check(state.vehicles[0].driver === d.id, `the pickup's driver: ${d.name}`);
  const p = teamOut(state, [crew[0].id, crew[1].id, d.id].filter((id, i, a) => a.indexOf(id) === i));
  check(teamDrivers(state, p).get(partyVehicles(state, p)[0].id) === d, "on the team: they drive it");
  const html = renderExpedition(state, { tab: "team" }, p);
  check(html.includes(`${d.name} at the wheel`), "the team's vehicle card names them at the wheel");
  const s2 = createWorld({ seed: 21, factionCount: 5, fleet: [{ type: "truck", driver: 2 }] });
  const others = atBase(s2, hub(s2).id).filter((s) => s.id !== s2.survivors[2].id).slice(0, 3);
  const q = teamOut(s2, others.map((s) => s.id));
  check(teamDrivers(s2, q).get(partyVehicles(s2, q)[0].id) === others[0], "its driver not on the team: the first of the team drives it");
}

section("5. battles: the team's driver at the wheel");
{
  const state = createWorld({ seed: 21, factionCount: 5, fleet: [{ type: "truck", driver: 2 }] });
  const d = state.survivors[2], crew = [d, ...atBase(state, hub(state).id).filter((s) => s !== d).slice(0, 2)];
  const p = teamOut(state, crew.map((s) => s.id));
  p.path = [p.dest]; p.idx = 0; p.phase = "engaged";
  const b = state.combat = createBattle(state, { mode: "raid", tile: p.dest, partyId: p.id, canRetreat: true, ambush: null, handler: "fleetdrivertest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(state, p.dest) }, raid: { heat0: 5 }, context: {} });
  const v = b.vehicle, w = wheelUnit(b), o = b.units.find((x) => x.side === "player" && x !== w);
  check(!!v && v.wheelSid === d.id && !!w && w.sid === d.id, `the map's car knows its driver (${w ? w.name : "none"})`);
  // Both beside it (the cells round the car), then in: the other first.
  const ring = [];
  for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) { if (x < 0 || y < 0 || x >= b.w || y >= b.h || (x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h)) continue; const c = b.cells[y * b.w + x]; if (CELL[c.k].walk && c.k !== "vehicle" && !b.units.some((u) => u.x === x && u.y === y && !u.off)) ring.push([x, y]); }
  [w.x, w.y] = ring[0]; [o.x, o.y] = ring[1];
  o.ap = 2; w.ap = 2;
  check(!combatAct(state, { type: "board", unit: o.id }) && cabSeat(b, v) === o, "the other one in first: in the cab for now");
  check(!combatAct(state, { type: "board", unit: w.id }) && v.driver === w.id && cabSeat(b, v) === w && b.log.some((l) => (l.text || l).includes("takes the wheel")), "the driver in: they take the wheel");
  check(wheelTaken(b, o) === w && wheelTaken(b, w) === null, "nobody else drives while they are inside");
  o.ap = 2;
  const err = combatAct(state, { type: "drive", unit: o.id, x: v.x + 4, y: v.y });
  check(/at the wheel/.test(err || ""), `the other one's Drive refused (${err})`);
  w.ap = 2;
  const own = combatAct(state, { type: "drive", unit: w.id, x: v.x + 4, y: v.y });
  check(!/at the wheel/.test(own || ""), `the driver drives (${own || "ok"})`);
  w.ap = 2;
  combatAct(state, { type: "disembark", unit: w.id });
  check(!w.aboard && wheelTaken(b, o) === null && cabSeat(b, v) === o, "the driver out: the other one at the wheel, free to drive");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
