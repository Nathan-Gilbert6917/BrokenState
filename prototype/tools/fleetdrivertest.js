// Who drives each starting vehicle (sim/startfleet.js fleetDrivers, seatDrivers, pickDriver; 2026-10-24, user request:
// "For a new game start for setting vehicles also set which survivor is driving it with a dropdown of avaliable
// survivors").
//   1. by default one at each wheel: Normal and Custom the crew in order, Hardcore's car its owner (whose car it was);
//   2. a driver set on the screen is the one at that wheel (v.driver), kept through a rebuild; one picked who drives
//      another vehicle swaps with that one's driver; a crew made smaller drops a driver past it;
//   3. the screen: a Driver select on each vehicle's row (Customize on or off), the free survivors first and the ones at
//      another wheel under "Swap with"; Hardcore's start lines name a driver who is not the car's owner.
// Usage: node tools/fleetdrivertest.js
import { createWorld } from "../src/sim/world.js";
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

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
