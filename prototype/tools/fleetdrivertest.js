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
//      in the cab, and nobody else drives while they are inside; out, anyone may;
//   6. raids (sim/combat.js placeRaidConvoy; 2026-10-25, the user's report: "My team has two vehicles but only one
//      showed in the raid"): every vehicle the team has on the raid map, the others parked by the entry zone (b.convoy),
//      the team still starting there and every zone reachable, the lead's driver at its wheel; the same side picked
//      again in the plan (raidplan.js setEntry); a field map's lead placed on a crowded west edge too.
//   7. after a raid with fewer left than the vehicles need (sim/walkers.js raidVehiclePick, vehiclePickCard,
//      takeVehicles; 2026-10-25, the user's request: "If not enough people are left after a raid to drive a vehicle all
//      vehicles not driven are left at the POI you decide which was taken and which was left"): a card asks which go
//      on, the default the worst-first rule; the one picked goes on as the lead, the other stays at the POI's tile
//      (marked, what the people cannot carry left in it); the hourly sweep waits for the card, a team that sets off
//      takes the default; the autopilot and a headless run get the rule's pick at once; no card when there is a driver
//      for each.
// Usage: node tools/fleetdrivertest.js
import { createWorld, hub, atBase, hurt, tickHour } from "../src/sim/world.js";
import { launchExpedition, partyTile, orderMove, poolLoad, carryCapacity, partyMembers } from "../src/sim/parties.js";
import { teamDrivers, partyVehicles, partyVehicle } from "../src/sim/vehicles.js";
import { afterRaid } from "../src/sim/scavenge.js";
import { keepOptions, vehiclePickWanted } from "../src/sim/walkers.js";
import { poisOf } from "../src/sim/pois.js";
import { defaultChoice } from "../src/sim/cardrules.js";
import { createBattle, registerCombatHandler, combatAct, cabSeat, wheelUnit, wheelTaken, CELL } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { setEntry } from "../src/sim/raidplan.js";
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

section("6. raids: every vehicle of the team on the map");
{
  // A team of three with both starting vehicles (the pickup its lead, the third survivor at its wheel, the van along).
  const fleetOut = (state, dest) => {
    const h = hub(state), crew = [state.survivors[2], ...atBase(state, h.id).filter((s) => s !== state.survivors[2]).slice(0, 2)];
    setRounds(h.stock, 200, crew.map((s) => s.gear.weapon && s.gear.weapon.key).filter(Boolean));
    const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "scavenge", stance: "normal", vehicleIds: state.vehicles.filter((v) => v.loc.kind === "base").slice(0, 2).map((v) => v.id), supplies: { food: 6, water: 6, ammo: 30, meds: 1 } });
    if (res.error) return null;
    res.party.path = [dest]; res.party.idx = 0; res.party.phase = "engaged";
    return res.party;
  };
  const raidOf = (state, p, plan = false) => createBattle(state, { mode: "raid", tile: p.dest, partyId: p.id, canRetreat: true, ambush: null, handler: "fleetdrivertest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(state, p.dest) }, raid: { heat0: 5 }, context: {}, ...(plan ? { plan: true } : {}) });
  const bodies = (b) => new Set(b.cells.filter((c) => c.k === "vehicle" && c.car).map((c) => c.car.id)).size;
  const fair = (b) => {
    const team = b.units.filter((u) => u.side === "player"), z = b.raid.zones[0];
    const reached = (q) => { for (let y = q.y0; y < q.y0 + q.h; y++) for (let x = q.x0; x < q.x0 + q.w; x++) if (b.reach[y * b.w + x]) return true; return false; };
    const off = (c) => b.raid.zones.every((q) => c.x + c.w <= q.x0 || q.x0 + q.w <= c.x || c.y + c.h <= q.y0 || q.y0 + q.h <= c.y);
    return team.every((u) => b.reach[u.y * b.w + u.x] && Math.hypot(u.x - z.x0 - 1, u.y - z.y0 - 1) <= 4) && team.every((u, i) => !team.some((o, j) => j < i && o.x === u.x && o.y === u.y)) && b.raid.zones.every(reached) && (b.convoy || []).every(off);
  };
  let maps = 0, all = 0, ok = 0;
  for (const seed of [21, 3, 5, 7, 11, 13, 17, 19, 23, 29]) {
    const state = createWorld({ seed, factionCount: 5, fleet: [{ type: "truck", driver: 2 }, { type: "van" }] });
    const h = hub(state);
    const sites = state.tiles.filter((t) => t.loc && t.terrain !== "water" && t.id !== h.tile && state.grid.distance(t.id, h.tile) > 1 && state.grid.distance(t.id, h.tile) < 12);
    for (const t of sites.slice(0, 2)) {
      const p = fleetOut(state, t.id);
      if (!p) continue;
      const b = state.combat = raidOf(state, p);
      maps++;
      if (b.vehicle && b.convoy && b.convoy.length === 1 && bodies(b) === 2) all++;
      if (fair(b)) ok++;
      if (seed === 21 && t === sites[0]) {
        const van = partyVehicles(state, p)[1], z = b.raid.zones[0], c = b.convoy && b.convoy[0];
        check(partyVehicles(state, p).length === 2 && !!b.vehicle && !!c && c.vid === van.id, `the user's report: two vehicles, both on the raid map (the ${van.name} parked: ${c ? `${c.x},${c.y}` : "missing"})`);
        check(!!c && Math.hypot(c.x - z.x0, c.y - z.y0) <= 14 && Math.min(c.x, c.y, b.w - c.x - c.w, b.h - c.y - c.h) <= 2, `parked by the edge, beside the entry zone (the ${z.side})`);
        check(!!c && c.ax === b.vehicle.ax && b.cells[c.y * b.w + c.x].k === "vehicle" && b.cells[c.y * b.w + c.x].car.body === "car", `turned as the lead one is, drawn as the team's own (${c ? `${c.ax}, ${b.cells[c.y * b.w + c.x].car.body}` : "-"})`);
        const w = wheelUnit(b);
        check(!!w && w.sid === state.survivors[2].id && b.vehicle.wheelSid === w.sid, `the lead's driver still at its wheel (${w ? w.name : "none"})`);
        // The plan's other side: the same map again, both vehicles at that side.
        const pb = state.combat = raidOf(state, p, true);
        const other = pb.setup.plan.sides.find((s) => s !== pb.setup.plan.side);
        if (other) {
          setEntry(state, other);
          const nb = state.combat, nz = nb.raid.zones[0];
          check(nz.side === other && nb.convoy && nb.convoy.length === 1 && bodies(nb) === 2 && Math.hypot(nb.convoy[0].x - nz.x0, nb.convoy[0].y - nz.y0) <= 14 && fair(nb), `in from the ${other} instead: both vehicles there`);
        }
      }
      state.combat = null;
      // A field fight on the same site: the lead by the west edge (any free row: a forest's edge), the van beside it.
      const f = state.combat = createBattle(state, { tile: p.dest, partyId: p.id, canRetreat: true, ambush: null, handler: "fleetdrivertest", enemy: { kind: "raiders", count: 2, power: 3 }, context: {} });
      maps++;
      if (f.vehicle && f.convoy && f.convoy.length === 1) all++;
      ok++;
      state.combat = null;
    }
  }
  check(maps >= 20 && all === maps, `every map with both vehicles on it (${all} of ${maps}: raids and field fights)`);
  check(ok === maps, `the team starts at the entry, every zone reachable, no vehicle on a zone (${ok} of ${maps})`);
}

section("7. after a raid: fewer left than the vehicles need, the player picks which go on");
{
  // A team of three with the pickup (its lead) and the van raids a POI; two die, one gets out with both vehicles kept.
  const raidEnd = (opts = {}) => {
    const state = createWorld({ seed: 21, factionCount: 5, fleet: [{ type: "truck", driver: 2 }, { type: "van" }] });
    const h = hub(state);
    const crew = [state.survivors[2], ...atBase(state, h.id).filter((s) => s !== state.survivors[2]).slice(0, 2)];
    const go = (x) => launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: x.id, mission: "scavenge", stance: "normal", vehicleIds: state.vehicles.filter((v) => v.loc.kind === "base").slice(0, 2).map((v) => v.id), supplies: { food: 6, water: 6, ammo: 30, meds: 1 } });
    let t = null, res = null;
    for (const x of state.tiles) {
      if (!(poisOf(x).length && x.road && !x.loc && x.terrain !== "water" && x.id !== h.tile && state.grid.distance(x.id, h.tile) > 1 && state.grid.distance(x.id, h.tile) < 12)) continue;
      res = go(x);
      if (!res.error) { t = x; break; }
    }
    if (!t) throw new Error(res ? res.error : "no POI tile");
    const p = res.party;
    p.path = [t.id]; p.idx = 0; p.phase = "engaged";
    const [truck, van] = partyVehicles(state, p);
    truck.condition = 90; van.condition = 40; // the rule leaves the van (the worse one)
    if (opts.load) p.cargo.supplies.scrap = (p.cargo.supplies.scrap || 0) + opts.load; // more than the people and the van carry
    state.vehiclePickAlways = !!opts.card;
    if (opts.autopilot) state.autopilot = true;
    const lost = crew.slice(opts.keep || 1);
    for (const s of lost) hurt(state, s, 9999, t.id, "while scavenging");
    state.cards.length = 0;
    const out = crew.slice(0, opts.keep || 1).map((s) => s.id);
    afterRaid(state, { outcome: "extracted", loot: { supplies: {}, gear: [] }, survivorsDead: lost.map((s) => s.id), survivorsHurt: [], raid: { extractedIds: out, carriedIds: [], hadVehicle: true, vehicleKept: true, hours: 1, searched: 0, total: 0, heat: 5 } }, { partyId: p.id, tile: t.id, raid: { poi: 0 }, context: {} });
    return { state, p, t, truck, van, card: state.cards.find((c) => c.vehiclePickFor === p.id) };
  };
  const leftAt = (state, p, v, tile) => v.loc.kind === "abandoned" && v.loc.tile === tile && !!(p.spotted && p.spotted.get(`vehicle:${v.id}`)) && p.spotted.get(`vehicle:${v.id}`).tile === tile;
  {
    const { state, p, t, truck, van, card } = raidEnd({ card: true, load: 0 });
    check(!!card && card.choices.length === 2, `one left for two vehicles: a card asks which goes on (${card ? card.choices.map((c) => c.label).join(" / ") : "none"})`);
    check(!!card && card.text.includes(truck.name) && card.text.includes(van.name) && /condition 90%/.test(card.text) && /condition 40%/.test(card.text) && /fuel \d+\/\d+/.test(card.text) && /carries \d+ kg/.test(card.text), "the card lists each vehicle: name, kind, condition, fuel, what it carries");
    check(partyVehicles(state, p).length === 2 && !!p.vehiclePick && p.vehiclePick.tile === t.id, "nothing left yet: the vehicles wait for the pick (the raid's hour went by)");
    tickHour(state); tickHour(state);
    check(partyVehicles(state, p).length === 2 && !state.cards.some((c) => c.title === "Vehicles left behind"), "the hourly sweep waits for the card too");
    const def = defaultChoice(state, card);
    check(!!def && def === card.choices[0] && def.label.includes(truck.name) && def.ai() > card.choices[1].ai(), `the default and the AI's pick: the rule's, the van in the worse shape left (${def ? def.label : "none"})`);
    const take = card.choices.find((c) => c.label.includes(van.name));
    const line = take.resolve(state);
    state.cards.splice(state.cards.indexOf(card), 1);
    check(partyVehicles(state, p).length === 1 && partyVehicle(state, p) === van && p.vehicleId === van.id, `picking the second vehicle: the ${van.name} goes on, the lead now`);
    check(leftAt(state, p, truck, t.id) && partyTile(p) === t.id, `the ${truck.name} stays at the POI's tile, marked on the map (${line})`);
    check(!p.vehiclePick && !state.cards.some((c) => c.vehiclePickFor === p.id), "the pick made: nothing waits any more");
    tickHour(state);
    check(partyVehicles(state, p).length === 1 && partyVehicle(state, p) === van, "the next hour leaves nothing more");
  }
  {
    // A heavy load: what the one left and the van cannot carry stays in the pickup.
    const probe = raidEnd({ card: true });
    const room = carryCapacity(probe.state, partyMembers(probe.state, probe.p), probe.van) - poolLoad(probe.p);
    const { state, p, t, truck, van, card } = raidEnd({ card: true, load: Math.ceil((room + 60) / 2) });
    const take = card && card.choices.find((c) => c.label.includes(van.name));
    check(!!take && /kg of the team's .* load will not fit/.test(take.hint), `the choice says how much of the load stays (${take ? take.hint : "none"})`);
    take.resolve(state);
    check(leftAt(state, p, truck, t.id) && !!truck.cargo && (truck.cargo.supplies.scrap || 0) > 0 && poolLoad(p) <= carryCapacity(state, partyMembers(state, p), van) + 1e-6, `what does not fit stays in the ${truck.name} (${truck.cargo ? truck.cargo.supplies.scrap : 0} scrap)`);
  }
  {
    // The team sets off before answering: the default (the rule's pick), the card gone.
    const { state, p, t, truck, van, card } = raidEnd({ card: true });
    const to = state.tiles.find((x) => x.road && x.terrain !== "water" && state.grid.distance(x.id, t.id) === 3);
    orderMove(state, p, to.id);
    tickHour(state);
    check(!!card && !state.cards.includes(card) && !p.vehiclePick && partyVehicles(state, p).length === 1 && partyVehicle(state, p) === truck && leftAt(state, p, van, t.id), `set off first: the default, the ${van.name} left at the POI's tile, the card gone`);
  }
  {
    // Headless (no card) and the autopilot: the rule picks at once, the van left there.
    for (const [name, opts] of [["a headless run", {}], ["the autopilot", { card: true, autopilot: true }]]) {
      const { state, p, t, truck, van, card } = raidEnd(opts);
      check(!card && !p.vehiclePick && partyVehicles(state, p).length === 1 && partyVehicle(state, p) === truck && leftAt(state, p, van, t.id), `${name}: no card, the ${van.name} (worse shape) left at the POI's tile at once`);
      check((state.log || []).some((l) => /fewer people than vehicles now/.test(l.text || l)), `${name}: the log says what was left, as it always has`);
    }
    const { state, p } = raidEnd({ card: true });
    check(vehiclePickWanted(state, p) && !vehiclePickWanted({ ...state, autopilot: true }, p) && !vehiclePickWanted({ ...state, vehiclePickAlways: false }, p) && !vehiclePickWanted(state, { ...p, crewRole: "scav" }), "the card for your own team by hand only: not the autopilot, a crew or a headless run");
  }
  {
    // A driver for each: no card, nothing left.
    const { state, p, card } = raidEnd({ card: true, keep: 2 });
    check(!card && partyVehicles(state, p).length === 2 && !state.cards.some((c) => c.title === "Vehicles left behind") && keepOptions(state, p).length === 0, "two left for two vehicles: no card, both go on");
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
