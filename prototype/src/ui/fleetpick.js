// The vehicle picker the planners share (the Form a team window, the trip planner, the move-out planner): On foot, the
// base's bikes and each car parked there (and, editing a team, its own), click to take or leave each, up to
// MAX_VEHICLES (sim/vehicles.js fleets). Each button shows seats, payload, fuel and condition; the line under them the
// totals; problems (the cap, a person to each vehicle, a seat each, enough bikes, a car with an empty tank) come from
// sim/teamform.js pickProblem / fleetPlan, the same checks the launch makes.
import { vehiclesAtBase, carsAtBase, bikesAtBase, isBike, isCar, vehicleById, payloadOf, tank, upgradeText, VEHICLE_TYPES, MAX_VEHICLES, SEATS, seatsOf, vehicleCapacity, fleetOf } from "../sim/vehicles.js";
import { fleetPlan } from "../sim/teamform.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);

// opts: { base, ids (picked vehicle ids), crewN (people), cans (fuel cans packed or carried), action (the buttons'
// data-action; data-v is the id, "" for On foot), own (a team's own vehicles, editing it), party (that team) }.
export function fleetPicker(state, { base, ids = [], crewN = 0, cans = 0, action, own = [], party = null }) {
  const picked = ids.map((id) => vehicleById(state, id)).filter(Boolean);
  const isOn = (x) => picked.includes(x) || (isBike(x) && picked.some(isBike));
  const full = picked.length >= MAX_VEHICLES;
  const cars = [...own.filter(isCar), ...carsAtBase(state, base.id)];
  const ownBikes = own.filter(isBike).reduce((a, x) => a + (x.count || 1), 0);
  const nBikes = bikesAtBase(state, base.id) + ownBikes;
  const bikeStack = vehiclesAtBase(state, base.id).find(isBike) || own.find(isBike) || null;
  const nCars = picked.filter(isCar).length;
  const n = Math.max(1, crewN);
  const bikeNeed = nCars ? Math.max(1, n - nCars) : n;
  const where = base.type === "hub" ? "the hub" : base.name;
  const btn = (id, active, label, hint, sub, off = "") => `<button data-action="${action}" data-v="${id}" class="${active ? "active" : ""}" ${off ? "disabled" : ""}${tip(off || hint)}>${active ? "✓ " : ""}${label}<span class="hint">${sub}</span></button>`;
  const opts = [btn("", !picked.length, "On foot", "Slow, silent, goes anywhere but water. The people carry everything: a heavy load slows them and makes them eat and drink more (load bands).", "no vehicle")];
  if (bikeStack && nBikes) {
    const on = isOn(bikeStack);
    opts.push(btn(bikeStack.id, on, "Bicycles", `Faster than walking on roads, walking pace off them. No fuel, quiet. Each rack carries ${VEHICLE_TYPES.bike.rack} kg; riding takes most of the load's slow-down away. A bike each, or with cars a bike for each person not driving one (every vehicle needs its own person); with cars the convoy keeps to the bikes' pace on roads.`,
      `${nBikes} at ${esc(where)} · ${bikeNeed} needed · rack ${VEHICLE_TYPES.bike.rack} kg each · condition ${Math.round(bikeStack.condition)}%`, !on && full ? `${MAX_VEHICLES} vehicles already` : !on && nBikes < bikeNeed ? `Only ${nBikes} bike${nBikes === 1 ? "" : "s"} for ${bikeNeed}` : bikeStack.condition <= 0 ? "Needs repairs" : ""));
  }
  for (const v of cars) {
    const on = isOn(v);
    const seats = SEATS[v.type] || 4;
    const noFuel = !on && v.fuel < 1 && !(cans >= 1) ? `The ${v.name} has no fuel: refuel it at the base, or pack fuel cans` : "";
    const noDriver = !on && picked.reduce((a, x) => a + (isBike(x) ? 0 : 1), 0) + 1 > n && crewN > 0 ? `Every vehicle needs its own person: ${crewN} ${crewN === 1 ? "person" : "people"} for ${nCars + 1} cars` : "";
    opts.push(btn(v.id, on, esc(v.name), `Fast on roads, cannot cross mountains. Burns about 0.6 fuel a road tile, 1.5 off-road, more when loaded past 60%. Payload ${payloadOf(v)} kg, riders (80 kg each) included: they feel none of their load. ${seats} seats. Each car needs its own driver; with two or more vehicles everyone needs a seat.${upgradeText(v) ? ` ${upgradeText(v)}.` : ""}`,
      `${seats} seats · ${payloadOf(v)} kg payload · fuel ${n0(v.fuel)}/${tank(v)} · condition ${Math.round(v.condition)}%${upgradeText(v) ? ` · ${esc(upgradeText(v))}` : ""}`, v.condition <= 0 ? "Needs repairs first" : !on && full ? `${MAX_VEHICLES} vehicles already` : noFuel || noDriver));
  }
  const plan = picked.length ? fleetPlan(state, base, party, picked.map((x) => x.id), n) : null;
  const fleet = plan ? plan.fleet || fleetOf(picked) : null;
  const sum = fleet ? `${picked.length}/${MAX_VEHICLES} vehicles · ${seatsOf(fleet)} seats · ${Math.round(vehicleCapacity(fleet))} kg payload and racks${isCar(fleet) ? ` · fuel ${n0(fleet.fuel)}/${tank(fleet)}` : ""}` : `0/${MAX_VEHICLES} vehicles`;
  const prob = plan && plan.problem ? `<div class="small danger">${esc(plan.problem)}</div>` : "";
  return `<div class="choices">${opts.join("")}</div><div class="small muted"${tip(`Up to ${MAX_VEHICLES} vehicles: seats, payload and fuel add up; the slowest sets the pace (bikes among cars: the bikes' pace on roads, the cars' off them). Every vehicle needs its own person (a driver, a rider), and with two or more vehicles everyone needs a seat. Wear hits every vehicle, a breakdown one of them; a vehicle lost on the way can leave some walking, and the team slows to their pace. On a battle map the first car is the one you drive; the others stand beside it.`)}>${sum}${cars.length || nBikes ? "" : ` · no vehicles at ${esc(where)}`}</div>${prob}`;
}

// A click on a vehicle: take it or leave it (bikes: the base's lot and the team's own are one choice). Returns
// { ids, msg }.
export function toggleFleetIds(state, ids, id) {
  if (id == null || id === "") return { ids: [], msg: "" };
  const v = vehicleById(state, Number(id));
  if (!v) return { ids, msg: "" };
  const has = (ids || []).map((x) => vehicleById(state, x)).filter(Boolean);
  const on = has.includes(v) || (isBike(v) && has.some(isBike));
  if (on) return { ids: has.filter((x) => x !== v && !(isBike(v) && isBike(x))).map((x) => x.id), msg: "" };
  if (has.length >= MAX_VEHICLES) return { ids, msg: `At most ${MAX_VEHICLES} vehicles to a team.` };
  return { ids: [...has.map((x) => x.id), v.id], msg: "" };
}
// The lead of a picked list (the first car, else the bikes): the planners' pl.vehicleId for code that wants one.
export function leadId(state, ids) {
  const vs = (ids || []).map((x) => vehicleById(state, x)).filter(Boolean);
  const lead = vs.find((x) => !isBike(x)) || vs[0];
  return lead ? lead.id : null;
}
