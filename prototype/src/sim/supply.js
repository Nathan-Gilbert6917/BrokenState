// Supply runs: convoy jobs between your own bases (hub <-> outpost, outpost <-> outpost).
// A job is a saved template: crew, optional vehicle, goods to deliver, goods to pick up, what the convoy
// does at the destination (come back, hold there, or disband into that base) and a schedule (once, or
// every X days). Convoys travel with the shared party system (kind "convoy", routeKind "supply"):
// supplies drain, the escort-table events hit them, vehicles burn fuel and can be left behind, and the
// dead leave death sites. Dispatch happens on the daily tick, like trade routes.
import { SUPPLIES } from "./data.js";
import { newId, log, day, hub, baseById, survivorById, hurt, mergeKnowledge } from "./world.js";
import {
  STANCES, planPath, fuelForPath, carryCapacity, supplyLoad, unitsThatFit, partyCapacity, cargoLoad, cargoRoom,
  partyMembers, partyTile, startReturn, removeParty, travelHours, wipeIfEmpty,
} from "./parties.js";
import { vehicleById, partyVehicle, tank } from "./vehicles.js";
import { assignStations } from "./buildings.js";
import { isCaptive } from "./conflicts.js";

export const AT_DEST = {
  return:  { name: "Come back", desc: "Unload, load the pick-up goods and come home. Repeating jobs leave again on schedule." },
  hold:    { name: "Hold there", desc: "Unload and wait at the destination as a parked convoy. The crew do not work that base but eat from its stock. Send them home or disband them later." },
  disband: { name: "Disband", desc: "Unload, then the crew join the destination as staff and the vehicle parks there. The job is kept as a template you can recreate." },
};

const FUEL_MARGIN = 1.15;
const SITE_HOURS = 4; // unloading and loading at the far end

export const supplyRuns = (state) => state.supplyRuns || (state.supplyRuns = []);
export const supplyRunById = (state, id) => supplyRuns(state).find((j) => j.id === id);
export const jobParty = (state, job) => (job.partyId ? state.parties.find((p) => p.id === job.partyId) || null : null);
export const escortFor = (n) => (n >= 5 ? "heavy" : n >= 2 ? "standard" : "light");
const first = (s) => s.name.split(" ")[0];

export function jobName(state, job) {
  const o = baseById(state, job.originId), d = baseById(state, job.destId);
  return `${o ? o.name : "a lost base"} → ${d ? d.name : "a lost base"}`;
}

// Supply lines: known keys, whole positive numbers, one line per key.
export function cleanLines(lines) {
  const out = {};
  for (const l of lines || []) {
    const q = Math.floor(Number(l.qty) || 0);
    if (!SUPPLIES[l.key] || q <= 0) continue;
    out[l.key] = (out[l.key] || 0) + q;
  }
  return Object.entries(out).map(([key, qty]) => ({ key, qty }));
}
export const linesObj = (lines) => Object.fromEntries(cleanLines(lines).map((l) => [l.key, l.qty]));
export const linesText = (lines) => cleanLines(lines).map((l) => `${l.qty} ${l.key}`).join(", ") || "nothing";

// ---------- crew ----------
function crewProblem(state, s, origin) {
  if (!s) return "is gone";
  if (!s.alive) return s.left ? "has left the group" : "is dead";
  if (isCaptive(s)) return "is held captive";
  const loc = s.location;
  if (loc.kind === "base" && loc.baseId === origin.id) return null;
  if (loc.kind === "base") return `is at ${baseById(state, loc.baseId)?.name || "another base"}`;
  if (loc.kind === "party") return "is away with a team";
  if (loc.kind === "route") return "escorts a trade route";
  return "is elsewhere";
}

export function crewCheck(state, crewIds, origin) {
  const ready = [], missing = [];
  for (const id of crewIds) {
    const s = survivorById(state, id);
    const why = origin ? crewProblem(state, s, origin) : "has no base";
    if (why) missing.push(`${s ? first(s) : "someone"} ${why}`);
    else ready.push(s);
  }
  return { ready, missing };
}

// ---------- planning ----------
// Route, vehicle, road supplies and carry space for one run. Used by dispatch and by the setup form.
export function planSupplyRun(state, o) {
  const origin = baseById(state, o.originId), dest = baseById(state, o.destId);
  if (!origin) return { error: "the home base is gone" };
  if (!dest) return { error: "the destination base is gone" };
  if (origin.id === dest.id) return { error: "the destination must be a different base" };
  const crew = (o.crewIds || []).map((id) => survivorById(state, id)).filter((s) => s && s.alive);
  const n = crew.length;
  const deliver = o.deliver || {};
  const twoWay = o.atDest !== "disband";
  const warnings = [];
  // The vehicle must be parked at the origin, running, with a road there and fuel for at least the way out.
  const v = o.vehicleId ? vehicleById(state, o.vehicleId) : null;
  let vPath = null, fuelOut = 0, fuelWant = 0, vProblem = null;
  if (o.vehicleId) {
    if (!v) vProblem = "the vehicle is gone";
    else if (v.loc.kind !== "base" || v.loc.baseId !== origin.id) vProblem = `the ${v.name} is not parked at ${origin.name}`;
    else if (v.condition <= 0) vProblem = `the ${v.name} needs repairs`;
    else if (!(vPath = planPath(state, origin.tile, dest.tile, true))) vProblem = `no road for the ${v.name}`;
    else {
      const leg = fuelForPath(state, vPath.path);
      fuelOut = Math.ceil(leg * FUEL_MARGIN);
      fuelWant = Math.ceil(leg * (twoWay ? 2 : 1) * FUEL_MARGIN);
      const avail = v.fuel + Math.floor(origin.stock.fuel || 0) - (deliver.fuel || 0);
      if (avail < fuelOut) vProblem = `not enough fuel for the ${v.name} (needs ${fuelOut}, ${Math.max(0, Math.floor(avail))} available)`;
      else if (avail < fuelWant) warnings.push(`Fuel covers only the way out (${Math.floor(avail)} of ${fuelWant}). The way back needs fuel from ${dest.name}.`);
    }
  }
  const useVehicle = !!v && !vProblem;
  const res = useVehicle ? vPath : planPath(state, origin.tile, dest.tile, false);
  if (!res) return { error: `no route from ${origin.name} to ${dest.name}` };
  const speed = STANCES[o.stance]?.speed || 1;
  const hoursOut = travelHours(state, res.path, { vehicle: useVehicle, speed }).hours; // same stepping as real movement
  const hours = twoWay ? hoursOut * 2 + SITE_HOURS : hoursOut + SITE_HOURS;
  return {
    origin, dest, crew, v, useVehicle, vProblem, warnings,
    path: res.path, tiles: res.path.length - 1, hoursOut, hours,
    need: n ? Math.ceil((n * (hoursOut + SITE_HOURS)) / 24) : 0, // food and water for the way out
    want: n ? Math.ceil((n * hours) / 24) + 1 : 0,               // the whole trip plus a spare day
    fuelOut: useVehicle ? fuelOut : 0, fuelWant: useVehicle ? fuelWant : 0,
    capacity: carryCapacity(state, crew, useVehicle ? v : null), load: supplyLoad(deliver),
  };
}

// Estimate and warnings for the setup form.
export function supplyEstimate(state, f) {
  const deliver = linesObj(f.deliver);
  const plan = planSupplyRun(state, { originId: f.originId, destId: f.destId, crewIds: f.crew, vehicleId: f.vehicleId, deliver, stance: f.stance, atDest: f.atDest });
  if (plan.error) return plan;
  const { origin, dest } = plan;
  const warnings = [...plan.warnings];
  if (!f.crew.length) warnings.push("Pick at least one survivor for the crew.");
  if (plan.vProblem) warnings.push(`${plan.vProblem[0].toUpperCase()}${plan.vProblem.slice(1)}: the convoy would go on foot with hand carts.`);
  for (const [k, q] of Object.entries(deliver)) {
    const have = Math.floor(origin.stock[k] || 0);
    if (have < q) warnings.push(`${origin.name} has only ${have} ${k} (sending ${q})${f.allowPartial ? ": it sends what is there" : ": the run waits until there is enough"}.`);
  }
  for (const k of ["food", "water"]) {
    const left = Math.floor(origin.stock[k] || 0) - (deliver[k] || 0);
    if (left < plan.need) warnings.push(`Not enough ${k} left at ${origin.name} for the road (needs ${plan.need} after the delivery).`);
  }
  if (plan.load > plan.capacity) warnings.push(`The delivery weighs ${Math.ceil(plan.load)}, more than the crew${plan.useVehicle ? " and vehicle" : ""} can carry (${plan.capacity}).`);
  if (f.atDest !== "disband") {
    const pick = linesObj(f.pickup);
    for (const [k, q] of Object.entries(pick)) {
      const have = Math.floor(dest.stock[k] || 0);
      if (have < q) warnings.push(`${dest.name} has ${have} ${k} right now (picking up ${q}).`);
    }
    if (supplyLoad(pick) > plan.capacity) warnings.push(`The pick-up weighs more than the convoy can carry (${plan.capacity}); the rest stays behind.`);
  }
  return { ...plan, warnings };
}

// ---------- dispatch ----------
function blockRun(state, job, reason, manual) {
  // Log once per kind of problem (numbers change daily), or whenever the player pressed the button.
  const sig = reason.replace(/\d+/g, "#");
  if (manual || job.blockedSig !== sig) log(state, `Supply run ${jobName(state, job)} cannot leave: ${reason}.`, "danger");
  job.blocked = reason;
  job.blockedSig = sig;
  return `Cannot leave: ${reason}.`;
}

export function dispatchSupplyRun(state, job, manual = false) {
  if (jobParty(state, job)) return "That convoy is already on the road.";
  const origin = baseById(state, job.originId);
  const dest = baseById(state, job.destId);
  if (!origin) return blockRun(state, job, "the home base is gone", manual);
  if (!dest) return blockRun(state, job, "the destination base is gone", manual);
  const { ready, missing } = crewCheck(state, job.crewIds, origin);
  if (!ready.length) return blockRun(state, job, `no crew at ${origin.name} (${missing.join(", ") || "nobody picked"})`, manual);
  // Goods to send.
  const deliver = {};
  const short = [];
  for (const l of cleanLines(job.deliver)) {
    const have = Math.floor(origin.stock[l.key] || 0);
    if (have >= l.qty) deliver[l.key] = l.qty;
    else if (job.allowPartial) { if (have > 0) deliver[l.key] = have; }
    else short.push(`${l.qty} ${l.key} (has ${have})`);
  }
  if (short.length) return blockRun(state, job, `not enough at ${origin.name} to send ${short.join(", ")}`, manual);
  const plan = planSupplyRun(state, { ...job, crewIds: ready.map((s) => s.id), deliver });
  if (plan.error) return blockRun(state, job, plan.error, manual);
  if (plan.load > plan.capacity) {
    return blockRun(state, job, `the load (${Math.ceil(plan.load)}) is more than the ${plan.useVehicle ? "crew and vehicle" : "crew"} can carry (${plan.capacity})${plan.vProblem ? `, and ${plan.vProblem}` : ""}`, manual);
  }
  // Road supplies come from what is left after the delivery.
  const left = (k) => Math.floor(origin.stock[k] || 0) - (deliver[k] || 0);
  for (const k of ["food", "water"]) {
    if (left(k) < plan.need) return blockRun(state, job, `not enough ${k} at ${origin.name} for the road (needs ${plan.need} after the delivery, has ${Math.max(0, left(k))})`, manual);
  }
  const supplies = { food: Math.min(plan.want, left("food")), water: Math.min(plan.want, left("water")), fuel: 0, meds: 0, ammo: Math.max(0, Math.min(ready.length * 5, left("ammo"))) };
  for (const [k, q] of Object.entries(deliver)) origin.stock[k] -= q;
  for (const k of ["food", "water", "ammo"]) origin.stock[k] -= supplies[k];
  const v = plan.useVehicle ? plan.v : null;
  if (v) {
    const top = Math.max(0, Math.min(plan.fuelWant - v.fuel, tank(v) - v.fuel, Math.floor(origin.stock.fuel || 0)));
    v.fuel += top;
    origin.stock.fuel -= top;
    // Jerry cans for whatever the tank cannot hold.
    const cans = Math.max(0, Math.min(plan.fuelWant - v.fuel, Math.floor(origin.stock.fuel || 0)));
    supplies.fuel = cans;
    origin.stock.fuel -= cans;
  }
  const p = {
    id: newId(), owner: "player", kind: "convoy", routeKind: "supply", mission: "route", supplyJobId: job.id,
    // The run's own terms, fixed when it leaves: editing the job later only changes the next run.
    atDest: AT_DEST[job.atDest] ? job.atDest : "return", pickup: cleanLines(job.pickup),
    dest: dest.tile, destBaseId: dest.id, homeBaseId: origin.id, escort: escortFor(ready.length),
    members: ready.map((s) => s.id), stance: job.stance || "normal", vehicle: !!v, vehicleId: v ? v.id : null,
    supplies, cargo: { supplies: { ...deliver }, gear: [] },
    path: plan.path, idx: 0, progress: 0, phase: "out", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false,
    departed: state.hour, plannedHours: plan.hours, eventsSeen: 0,
  };
  if (v) v.loc = { kind: "party", partyId: p.id };
  for (const s of ready) s.location = { kind: "party", partyId: p.id };
  state.parties.push(p);
  job.partyId = p.id;
  job.status = "road";
  job.blocked = null;
  job.blockedSig = null;
  job.runs = (job.runs || 0) + 1;
  job.lastDay = day(state);
  job.nextDay = job.repeat > 0 ? day(state) + job.repeat : null;
  const notes = [];
  if (missing.length) notes.push(`without ${missing.join(", ")}`);
  if (plan.vProblem) notes.push(`on foot because ${plan.vProblem}`);
  const msg = `Supply run ${jobName(state, job)} left with ${linesText(Object.entries(deliver).map(([key, qty]) => ({ key, qty })))} (${ready.map(first).join(", ")}, ${v ? `in the ${v.name}` : "with hand carts"}${notes.length ? `; ${notes.join("; ")}` : ""}). About ${Math.ceil(plan.hoursOut)}h each way.`;
  log(state, msg, "info");
  return msg;
}

// ---------- at the destination ----------
export function supplyArrive(state, p) {
  const job = supplyRunById(state, p.supplyJobId);
  const dest = baseById(state, p.destBaseId);
  const name = job ? jobName(state, job) : "convoy";
  if (!dest) {
    log(state, `Supply run ${name}: the destination base is gone. The convoy turns back with its cargo.`, "danger");
    if (job) job.lastResult = `Day ${day(state)}: destination gone, turned back`;
    startReturn(state, p);
    return;
  }
  const got = [];
  for (const [k, v] of Object.entries(p.cargo.supplies)) {
    const q = Math.floor(v);
    if (q > 0) {
      dest.stock[k] = (dest.stock[k] || 0) + q;
      got.push(`${q} ${k}`);
    }
  }
  p.cargo.supplies = {};
  dest.armory.push(...p.cargo.gear);
  p.cargo.gear = [];
  mergeKnowledge(state, p.seen, p.spotted, p);
  const delivered = got.join(", ") || "nothing";
  if (job) job.lastResult = `Day ${day(state)}: delivered ${delivered} to ${dest.name}`;
  // What this convoy left with (not the job as edited since); a deleted job's convoy comes home.
  const mode = !job ? "return" : p.atDest || job.atDest;
  if (mode === "disband") return disbandAt(state, p, dest, job, `delivered ${delivered}`);
  if (mode === "hold") {
    p.phase = "holding";
    p.path = [partyTile(p)];
    p.idx = 0;
    p.progress = 0;
    job.status = "holding";
    log(state, `Supply run ${name} delivered ${delivered} and is holding at ${dest.name}.`, "good");
    return;
  }
  log(state, `Supply run ${name} delivered ${delivered} to ${dest.name}.`, "good");
  headHome(state, p, job);
}

// Restock for the way back from the destination, load the pick-up, and start home.
function headHome(state, p, job) {
  const dest = baseById(state, p.destBaseId);
  const home = baseById(state, p.homeBaseId) || hub(state);
  if (dest) {
    const n = partyMembers(state, p).length;
    const back = planPath(state, dest.tile, home.tile, p.vehicle) || planPath(state, dest.tile, home.tile, false);
    if (back) {
      const need = Math.ceil((n * (back.cost / (STANCES[p.stance]?.speed || 1) + 2)) / 24) + 1;
      for (const k of ["food", "water"]) {
        const top = Math.max(0, Math.min(need - Math.floor(p.supplies[k] || 0), Math.floor(dest.stock[k] || 0)));
        dest.stock[k] -= top;
        p.supplies[k] = (p.supplies[k] || 0) + top;
      }
      const v = partyVehicle(state, p);
      if (v) {
        const needF = Math.ceil(fuelForPath(state, back.path) * FUEL_MARGIN);
        const top = Math.max(0, Math.min(needF - v.fuel - (p.supplies.fuel || 0), tank(v) - v.fuel, Math.floor(dest.stock.fuel || 0)));
        v.fuel += top;
        dest.stock.fuel -= top;
      }
    }
    if (job && (p.atDest || job.atDest) !== "disband") {
      const got = [], short = [];
      for (const l of cleanLines(p.pickup || job.pickup)) {
        const room = cargoRoom(state, p);
        const take = Math.max(0, Math.min(l.qty, Math.floor(dest.stock[l.key] || 0), unitsThatFit(room, l.key)));
        if (take > 0) {
          dest.stock[l.key] -= take;
          p.cargo.supplies[l.key] = (p.cargo.supplies[l.key] || 0) + take;
          got.push(`${take} ${l.key}`);
        }
        if (take < l.qty) short.push(`${l.qty - take} ${l.key}`);
      }
      if (got.length || short.length) {
        log(state, `Supply run ${jobName(state, job)} loaded ${got.join(", ") || "nothing"} at ${dest.name}${short.length ? ` (${short.join(", ")} short: not in stock or no room)` : ""}.`, short.length ? "danger" : "info");
      }
    }
  }
  if (job) job.status = "road";
  startReturn(state, p);
}

function disbandAt(state, p, dest, job, what) {
  const members = partyMembers(state, p);
  for (const [k, v] of Object.entries(p.supplies)) dest.stock[k] = (dest.stock[k] || 0) + Math.max(0, Math.floor(v));
  for (const [k, v] of Object.entries(p.cargo.supplies)) dest.stock[k] = (dest.stock[k] || 0) + Math.max(0, Math.floor(v));
  dest.armory.push(...p.cargo.gear);
  const v = partyVehicle(state, p);
  if (v) v.loc = { kind: "base", baseId: dest.id };
  for (const m of members) m.location = { kind: "base", baseId: dest.id };
  mergeKnowledge(state, p.seen, p.spotted, p);
  removeParty(state, p);
  assignStations(state, dest);
  if (job) {
    job.partyId = null;
    job.status = "disbanded";
    job.lastResult = `Day ${day(state)}: ${what}, disbanded at ${dest.name}`;
  }
  log(state, `Supply run ${job ? jobName(state, job) : ""} ${what}. ${members.map(first).join(", ")} joined ${dest.name}${v ? ` and the ${v.name} is parked there` : ""}. The job is saved: recreate it any time.`, "good");
}

// Called by returnHome when a supply convoy is back.
export function supplyReturned(state, p, home, loot) {
  const job = supplyRunById(state, p.supplyJobId);
  log(state, `Supply convoy${job ? ` (${jobName(state, job)})` : ""} is back at ${home.name}${loot.length ? ` with ${loot.join(", ")}` : ""}.`, "good");
  if (!job || job.partyId !== p.id) return;
  job.partyId = null;
  job.status = job.repeat > 0 ? "waiting" : "done";
  job.lastResult = `Day ${day(state)}: back at ${home.name}${loot.length ? ` with ${loot.join(", ")}` : ""}`;
}

// A held convoy goes home (with the pick-up) or disbands into the base it is parked at.
export function releaseHeld(state, job, how) {
  const p = jobParty(state, job);
  if (!p || p.phase !== "holding") return "That convoy is not holding anywhere.";
  if (how === "disband") {
    const dest = baseById(state, p.destBaseId);
    if (!dest) return "That base is gone.";
    disbandAt(state, p, dest, job, "stood down after holding");
    return `The crew joined ${dest.name}.`;
  }
  headHome(state, p, job);
  log(state, `The held convoy (${jobName(state, job)}) heads home.`, "info");
  return "The convoy loads up and heads home.";
}

// ---------- managing jobs ----------
export function saveSupplyRun(state, f) {
  const origin = baseById(state, f.originId), dest = baseById(state, f.destId);
  if (!origin) return { error: "The home base is gone." };
  if (!dest) return { error: "Pick a destination base." };
  if (origin.id === dest.id) return { error: "The destination must be a different base." };
  if (!f.crew.length) return { error: "Pick at least one survivor for the crew." };
  let job = f.jobId ? supplyRunById(state, f.jobId) : null;
  const isNew = !job;
  if (!job) {
    job = { id: newId(), runs: 0, status: "waiting", partyId: null, nextDay: null };
    supplyRuns(state).push(job);
  }
  Object.assign(job, {
    originId: origin.id, destId: dest.id, crewIds: [...f.crew], vehicleId: f.vehicleId || null,
    deliver: cleanLines(f.deliver), pickup: cleanLines(f.pickup), atDest: AT_DEST[f.atDest] ? f.atDest : "return",
    repeat: f.schedule === "repeat" ? Math.max(1, Math.floor(Number(f.every) || 1)) : 0,
    stance: STANCES[f.stance] ? f.stance : "normal", allowPartial: !!f.allowPartial,
    paused: false, blocked: null, blockedSig: null,
  });
  if (!jobParty(state, job)) {
    if (isNew || job.nextDay == null || job.status === "disbanded" || job.status === "done") job.nextDay = day(state) + 1;
    job.status = "waiting";
  }
  log(state, `Supply run ${jobName(state, job)} ${isNew ? "set up" : "saved"}: ${linesText(job.deliver)} out${job.atDest === "return" ? `, ${linesText(job.pickup)} back` : job.atDest === "hold" ? ", then hold there" : ", then disband there"}, ${job.repeat ? `every ${job.repeat} day${job.repeat === 1 ? "" : "s"}` : "once"}. ${jobParty(state, job) ? "Changes apply to the next run." : `First departure day ${job.nextDay}.`}`, "good");
  return { job };
}

export function pauseSupplyRun(state, job, paused) {
  job.paused = paused;
  if (!paused && !jobParty(state, job)) {
    if (job.status === "done" || job.status === "disbanded") return "Use Run again or Recreate for this job.";
    if (job.nextDay == null) job.nextDay = day(state) + 1;
  }
  return paused ? "Paused. No new convoys leave until you resume." : `Resumed. Next departure day ${Math.max(job.nextDay ?? 0, day(state) + 1)}.`;
}

export function deleteSupplyRun(state, job) {
  const p = jobParty(state, job);
  if (p && p.phase === "holding") headHome(state, p, job);
  const list = supplyRuns(state);
  list.splice(list.indexOf(job), 1);
  return p ? "Job deleted. The convoy finishes its trip and comes home." : "Job deleted.";
}

// The setup form for a new job, an edit, or a recreate. Recreating picks the crew again where they are
// now: from the destination (after a disband) the run goes the other way, with deliver and pick-up swapped.
export function jobForm(state, job, baseId, mode) {
  if (!job) {
    return { jobId: null, originId: baseId, destId: state.bases.find((b) => b.id !== baseId)?.id ?? null, crew: [], vehicleId: null,
      deliver: [{ key: "food", qty: 20 }], pickup: [], atDest: "return", schedule: "repeat", every: 5, stance: "normal", allowPartial: false };
  }
  let originId = job.originId, destId = job.destId, deliver = job.deliver, pickup = job.pickup;
  if (mode === "recreate") {
    const count = {};
    for (const id of job.crewIds) {
      const s = survivorById(state, id);
      if (s && s.alive && s.location.kind === "base") count[s.location.baseId] = (count[s.location.baseId] || 0) + 1;
    }
    const where = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    originId = where ? Number(where[0]) : baseId;
    if (originId === job.destId) {
      destId = job.originId;
      [deliver, pickup] = [job.pickup, job.deliver];
    }
    if (originId === destId) destId = state.bases.find((b) => b.id !== originId)?.id ?? null;
  }
  const crew = mode === "recreate"
    ? job.crewIds.filter((id) => { const s = survivorById(state, id); return s && s.alive && s.location.kind === "base" && s.location.baseId === originId; })
    : [...job.crewIds];
  const v = job.vehicleId ? vehicleById(state, job.vehicleId) : null;
  const vehicleId = mode === "recreate" ? (v && v.loc.kind === "base" && v.loc.baseId === originId ? v.id : null) : job.vehicleId;
  return {
    jobId: job.id, mode, originId, destId, crew, vehicleId,
    deliver: deliver.map((l) => ({ ...l })), pickup: pickup.map((l) => ({ ...l })),
    atDest: job.atDest, schedule: job.repeat ? "repeat" : "once", every: job.repeat || 5, stance: job.stance, allowPartial: !!job.allowPartial,
  };
}

export function supplyStatus(state, job) {
  const p = jobParty(state, job);
  const dest = baseById(state, job.destId);
  const tail = job.paused ? " · paused, will not repeat" : "";
  if (p) {
    if (p.phase === "holding") return { key: "holding", text: `Holding at ${baseById(state, p.destBaseId)?.name || "the destination"}${tail}` };
    return { key: "road", text: `${p.phase === "back" ? "On the road home" : `On the road to ${dest ? dest.name : "the destination"}`}${tail}` };
  }
  if (job.status === "disbanded") return { key: "disbanded", text: "Disbanded. Recreate to send it again" };
  if (job.paused) return { key: "paused", text: "Paused" };
  if (job.status === "done") return { key: "done", text: "Done (one-off). Run again or recreate" };
  if (job.blocked) return { key: "blocked", text: `Blocked: ${job.blocked}` };
  return { key: "waiting", text: job.nextDay != null ? `Waiting · next departure day ${job.nextDay}` : "Waiting" };
}

// Stock an outpost holds back from its daily surplus shipping to the hub: goods a run from here will send
// (plus road food and water), goods a run will pick up here, and one delivery's worth of what runs bring
// here (otherwise the delivery would be shipped straight back).
export function supplyReserve(state, base) {
  const keep = {};
  const add = (k, q) => (keep[k] = (keep[k] || 0) + q);
  for (const job of supplyRuns(state)) {
    if (job.paused || job.status === "disbanded" || job.status === "done") continue;
    if (job.originId === base.id) {
      for (const l of job.deliver) add(l.key, l.qty);
      add("food", job.crewIds.length * 3);
      add("water", job.crewIds.length * 3);
    }
    if (job.destId === base.id) {
      for (const l of job.deliver) add(l.key, l.qty);
      if (job.atDest !== "disband") for (const l of job.pickup) add(l.key, l.qty);
    }
  }
  // A convoy holding here eats from this base and needs food and water for the way home.
  for (const p of state.parties) {
    if (p.routeKind === "supply" && p.phase === "holding" && p.destBaseId === base.id) {
      add("food", p.members.length * 4);
      add("water", p.members.length * 2);
    }
  }
  return keep;
}

// ---------- daily tick ----------
export function supplyDaily(state) {
  const d = day(state);
  for (const job of [...supplyRuns(state)]) {
    const p = jobParty(state, job);
    if (job.partyId && !p) {
      // The party vanished without coming home: everyone died or the convoy was otherwise lost.
      job.partyId = null;
      job.status = job.repeat > 0 ? "waiting" : "done";
      job.lastResult = `Day ${d}: lost on the road`;
      log(state, `Supply run ${jobName(state, job)} never arrived. Look for a death site or an abandoned vehicle on its road.`, "death");
    }
    if (p && p.phase === "holding") holdUpkeep(state, p, job);
    if (p || job.paused || job.status === "disbanded" || job.status === "done") continue;
    if (job.nextDay != null && d >= job.nextDay) dispatchSupplyRun(state, job);
  }
}

// A held convoy eats from the base it waits at, and rests.
function holdUpkeep(state, p, job) {
  const dest = baseById(state, p.destBaseId);
  if (!dest) {
    log(state, `The base the convoy was holding at is gone. The convoy (${jobName(state, job)}) heads home.`, "danger");
    headHome(state, p, job);
    return;
  }
  // One food and one water per person a day, from the base first, then from what the convoy carries.
  const draw = (k) => {
    if ((dest.stock[k] || 0) >= 1) dest.stock[k] -= 1;
    else if ((p.supplies[k] || 0) >= 1) p.supplies[k] -= 1;
    else return false;
    return true;
  };
  let short = "";
  for (const m of partyMembers(state, p)) {
    const fed = draw("food"), watered = draw("water");
    if (!fed) hurt(state, m, 6, dest.tile, `of hunger while holding at ${dest.name}`, { raw: true });
    if (!watered && m.alive) hurt(state, m, 8, dest.tile, `of thirst while holding at ${dest.name}`, { raw: true });
    if (fed && watered) m.health = Math.min(100, m.health + 3);
    else short = !fed && !watered ? "food and water" : !fed ? "food" : "water";
  }
  if (short) log(state, `The convoy holding at ${dest.name} (${jobName(state, job)}) has no ${short}. Send it home or stock the base.`, "danger");
  // If the last of the crew died here, the convoy ends as a wiped team: its goods go into this base's stores.
  wipeIfEmpty(state, p);
}
