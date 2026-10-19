// Vehicle wear and repairs under the autopilot (census) and the rules the vehicle-wear pass set (checks).
//
//   node tools/vehiclewear.js check
//       The rules (seconds): the governor's repair before a trip (car parts first, a called-off trip gives back what
//       it took, of either kind; no top-up past the threshold), parked cars in a garage kept out of the frost,
//       AI groups' vehicle repairs and car parts (parity), spare car parts for a long drive, a car worth less than
//       its parts stripped.
//   node tools/vehiclewear.js census [days=730] [styles=balanced] [seeds=1,2,3] [--json path]
//       Plays autopilot campaigns and watches, without changing a rule, where vehicle condition goes and where parts
//       go: every change to a vehicle's condition and fuel and every change to a stock's machine / car parts is
//       caught as it happens (an accessor on the vehicle, a Proxy on the stock) and put down to the code that made it
//       (the call stack). Reports condition lost by cause (road / off-road wear, breakdown cards, battles, frost, river
//       crossings, passers-by stripping an abandoned car), restored by cause, parts used by purpose, the repairs (the
//       condition they started from, the kind of parts, whether the car then left on a trip), cars lost, trips by car
//       / bikes / on foot, why a trip went without a car (whyNoCar) and fuel burnt. Rough cost: a 730-day run is 10–25
//       minutes (one process each; run them detached).
//   node tools/vehiclewear.js report a.json[,a2.json…] [b.json[,b2.json…]]
//       The census tables again from --json files (comma-joined: one column), side by side when several are given
//       (two: before / after).
import { createWorld, tickHour, day, hub } from "../src/sim/world.js";
import { setAutopilot, PERSONALITIES } from "../src/sim/autopilot.js";
import * as AP from "../src/sim/autopilot.js";
import * as V from "../src/sim/vehicles.js";
import * as BD from "../src/sim/breakdowns.js";
import { addBuilding } from "../src/sim/buildings.js";
import { writeFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const mode = argv[0] || "check";

// ===================================================================================================================
// census
// ===================================================================================================================
const SIM = /at (?:(?:async )?([\w$.<>\[\] ]+?) \()?[^\n]*?[\\/]src[\\/](sim|ui)[\\/]([\w]+)\.js:(\d+)/;
function frames() {
  const e = {};
  const lim = Error.stackTraceLimit;
  Error.stackTraceLimit = 30;
  Error.captureStackTrace(e, frames);
  Error.stackTraceLimit = lim;
  const out = [];
  for (const l of e.stack.split("\n").slice(1)) {
    const m = SIM.exec(l);
    if (m) out.push({ fn: (m[1] || "?").replace(/^Object\./, ""), file: m[3] + ".js", line: +m[4] });
  }
  return out;
}
const has = (fr, file, fn) => fr.some((f) => f.file === file && (!fn || f.fn === fn || f.fn.endsWith("." + fn)));
const at = (f) => (f ? `${f.fn}@${f.file}:${f.line}` : "?");

// Why a vehicle's condition changed (d: the change).
function condCause(fr, d, bike) {
  const f0 = fr[0];
  if (!f0) return "?";
  if (f0.file === "vehicles.js" && f0.fn === "wear") {
    const road = bike ? Math.abs(d) < 0.2 : Math.abs(d) < 0.5;
    return `${has(fr, "survey.js") ? "survey " : ""}${road ? "road" : "off-road"} wear`;
  }
  if (f0.file === "vehicles.js" && f0.fn === "repair") return `repair at base (${repairCaller(fr)})`;
  if (f0.file === "vehicles.js" && f0.fn === "vehiclesDaily") return "abandoned: stripped by passers-by";
  if (f0.file === "events.js") return d > 0 ? "breakdown: spare part" : "breakdown: failed spot repair";
  if (f0.file === "autopilot.js" && (f0.fn === "off" || has(fr, "autopilot.js", "launchTrip"))) return "trip called off: repair undone";
  if (f0.file === "breakdowns.js") return "frost / blizzard while parked";
  if (f0.file === "crossing.js") return "river crossing";
  if (f0.file === "combat.js") return "battle map";
  if (f0.file === "groupcare.js") return d > 0 ? "AI group repair" : "AI group fight wear";
  if (f0.file === "foundcars.js") return "found car restored";
  if (f0.file === "parties.js") return d > 0 ? "recovered / restored" : `parties: ${at(f0)}`;
  return at(f0);
}
function repairCaller(fr) {
  const i = fr.findIndex((f) => f.file === "vehicles.js" && f.fn === "repair");
  const c = fr[i + 1];
  return c ? `${c.file === "autopilot.js" ? "autopilot " : ""}${c.fn}` : "?";
}
// What a stock's parts went on (d < 0) or came from (d > 0).
function partsCause(fr, d) {
  if (has(fr, "vehicles.js", "repair")) return `vehicle repair (${repairCaller(fr)})`;
  if (has(fr, "events.js") && fr.some((f) => f.file === "events.js" && f.line >= 806 && f.line <= 864)) return "vehicle: breakdown spare part";
  if (has(fr, "autopilot.js", "launchTrip") && d > 0) return "trip called off: refund";
  if (has(fr, "vehicles.js", "stripVehicle")) return "car stripped for parts";
  if (has(fr, "foundcars.js")) return "vehicle: found car restored";
  if (has(fr, "vehicles.js", "garageHour") || has(fr, "vehicles.js", "queueUpgrade") || has(fr, "vehicles.js", "queueGarage")) return "vehicle: garage upgrade";
  if (has(fr, "parties.js", "recoverVehicle")) return "vehicle: recovered";
  if (has(fr, "groupcare.js", "repairVehicles")) return "vehicle repair (AI group)";
  const f = fr.find((x) => x.file !== "vehicles.js") || fr[0];
  return f ? `${f.file.replace(/\.js$/, "")}:${f.fn}` : "?";
}

function census() {
  const rest = argv.slice(1).filter((a) => !a.startsWith("--"));
  const ji = argv.indexOf("--json");
  const jsonPath = ji >= 0 ? argv[ji + 1] : null;
  if (jsonPath) rest.splice(rest.indexOf(jsonPath), 1);
  const days = Number(rest[0] || 730);
  const styles = (rest[1] || "balanced") === "all" ? Object.keys(PERSONALITIES) : (rest[1] || "balanced").split(",");
  const seeds = (rest[2] || "1,2,3").split(",").map(Number);
  const runs = [];
  for (const style of styles) for (const seed of seeds) {
    const t0 = Date.now();
    const r = runOne(seed, style, days);
    r.secs = Math.round((Date.now() - t0) / 1000);
    runs.push(r);
    console.log(`  ${style} seed ${seed}: day ${r.days}${r.fell ? " (fell)" : ""}, ${r.secs}s`);
  }
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(runs, null, 1));
  printReport([runs]);
}

// Why a trip the governor launched went without a car, read just after it left (launchTrip's rules: a car for a
// drive of 3+ tiles, or 1+ for wood; never an outpost, occupy, rescue or sweep; the best-kept car at 30%+; fuel for
// the round trip from its tank and the base's fuel past 4 and the winter's heating). "fuel?" is a rough round-trip
// figure (1 a tile each way), so "car fit, fuel enough (rough)" means the planner turned it down for something else.
const NO_CAR_MISSIONS = ["outpost", "occupy", "rescue", "sweep"];
function whyNoCar(state, p) {
  const home = state.bases.find((b) => b.id === p.homeBaseId);
  if (!home) return "no home base";
  if (NO_CAR_MISSIONS.includes(p.mission)) return `mission (${p.mission})`;
  const dist = state.grid.distance(home.tile, p.dest);
  const wood = p.plan && p.plan.steps && p.plan.steps.some((x) => x.kind === "wood");
  if (dist < (wood ? 1 : 3)) return "under 3 tiles";
  const owned = state.vehicles.filter((v) => V.isCar(v) && !v.destroyed && v.loc.kind !== "abandoned");
  if (!owned.length) return "no car owned";
  const cars = V.carsAtBase(state, home.id).filter((v) => v.condition > 0);
  if (!cars.length) return "car out with another team / at another base";
  const best = cars.sort((a, b) => b.condition - a.condition)[0];
  if (best.condition < 30) return "car under 30%";
  const hold = AP.heatHold ? AP.heatHold(state, home) : 0;
  const need = 2 * dist;
  if (best.fuel + Math.max(0, (home.stock.fuel || 0) - 4 - hold) < need) return (best.fuel + Math.max(0, (home.stock.fuel || 0) - 4) >= need ? "fuel: held back for heating" : "fuel: not enough");
  return "car fit, fuel enough (rough): planner chose foot";
}
function runOne(seed, style, days) {
  const state = createWorld({ seed, factionCount: 8 });
  state.started = true;
  setAutopilot(state, true, style);
  const R = {
    seed, style, days: 0, fell: false,
    lost: {}, gained: {}, partsUsed: {}, partsIn: {}, carparts: {}, // by cause: condition, then parts by purpose
    repairs: [], // { from, to, pay: { parts, carparts }, caller, left: hours until it left on a trip (null: not in 7 days), cars: cars at the base }
    fuel: { tank: 0, cans: 0 },
    trips: { car: 0, bike: 0, foot: 0, carTiles: 0 }, carsLost: {}, aiVeh: { lost: 0, gained: 0, parts: 0 },
    noCar: {}, // why a trip went without a car (whyNoCar)
    cars: [], // hourly: [cars, at bases, mean condition]
    out: { alive: 0, deaths: 0, left: 0, fuelDays0: 0, fuelSum: 0, fuelDays: 0 }, // the run's outcome: people, the hub's fuel at noon
  };
  const add = (o, k, q) => { o[k] = (o[k] || 0) + q; };
  const pending = new Map(); // vehicle -> repair records waiting to see it leave
  let curRepair = null;
  let payBuf = {}; // what the repair being made paid (the stock pays before the condition rises)
  // ---- the vehicle accessors ----
  const wrapped = new WeakSet();
  const wrapVeh = (v, ai) => {
    if (!v || wrapped.has(v)) return;
    wrapped.add(v);
    let cond = v.condition, fuel = v.fuel;
    Object.defineProperty(v, "condition", {
      enumerable: true, configurable: true,
      get: () => cond,
      set: (x) => {
        const d = x - cond;
        if (Math.abs(d) > 1e-9) {
          const fr = frames();
          const c = condCause(fr, d, v.type === "bike");
          if (ai) add(R.aiVeh, d < 0 ? "lost" : "gained", Math.abs(d));
          else if (d < 0) add(R.lost, (v.type === "bike" ? "bikes: " : "") + c, -d);
          else add(R.gained, (v.type === "bike" ? "bikes: " : "") + c, d);
          if (!ai && c.startsWith("repair at base")) {
            curRepair = { from: cond, to: x, pay: payBuf, caller: repairCaller(fr), left: null, hour: state.hour, cars: V.carsAtBase(state, v.loc.baseId).length, veh: v };
            payBuf = {};
            R.repairs.push(curRepair);
            pending.set(curRepair, v);
          }
          if (!ai && c === "trip called off: repair undone") {
            for (const r of R.repairs.filter((y) => y.veh === v && y.hour === state.hour && !y.undone)) { r.undone = true; pending.delete(r); } // tripUndo: every repair of the hour at once
          }
        }
        cond = x;
      },
    });
    if (ai) return;
    let loc = v.loc;
    Object.defineProperty(v, "loc", {
      enumerable: true, configurable: true,
      get: () => loc,
      set: (x) => {
        if (x && x.kind === "abandoned" && (!loc || loc.kind !== "abandoned") && v.type !== "bike") {
          const fr = frames();
          const i = fr.findIndex((f) => f.fn === "leaveVehicle" || f.fn === "abandonVehicle" || f.fn === "markLeft");
          const by = fr.slice(i + 1).find((f) => !["leaveVehicle", "abandonVehicle", "markLeft", "resolve", "?"].includes(f.fn)) || fr[i + 1];
          add(R.carsLost, `left on the road by ${by ? `${by.fn}@${by.file}` : "?"}${fr.some((f) => f.file === "events.js" && f.line >= 806 && f.line <= 864) ? " (breakdown card)" : ""}`, 1);
        }
        loc = x;
      },
    });
    Object.defineProperty(v, "fuel", {
      enumerable: true, configurable: true,
      get: () => fuel,
      set: (x) => { const d = x - fuel; if (d < -1e-9) { const fr = frames(); if (has(fr, "vehicles.js", "useFuel")) R.fuel.tank -= d; } fuel = x; },
    });
  };
  // ---- the stock proxies ----
  const proxied = new WeakSet();
  const KEYS = new Set(["parts", "carparts", "fuel"]);
  const wrapStock = (holder, key, kind) => {
    const s = holder[key];
    if (!s || proxied.has(s)) return;
    const px = new Proxy(s, {
      set(t, k, val) {
        if (KEYS.has(k)) {
          const d = (Number(val) || 0) - (Number(t[k]) || 0);
          if (Math.abs(d) > 1e-9) {
            const fr = frames();
            if (k === "fuel") { if (d < 0 && has(fr, "vehicles.js", "useFuel")) R.fuel.cans -= d; }
            else {
              const c = partsCause(fr, d);
              if (kind === "ai") { if (c.includes("AI group")) R.aiVeh.parts -= d; }
              else {
                add(d < 0 ? R.partsUsed : R.partsIn, `${k === "carparts" ? "car" : "machine"} · ${c}`, Math.abs(d));
                if (c.startsWith("vehicle repair") && d < 0) payBuf[k] = (payBuf[k] || 0) - d;
              }
            }
          }
        }
        t[k] = val;
        return true;
      },
    });
    proxied.add(px);
    holder[key] = px;
  };
  const wrapAll = () => {
    for (const v of state.vehicles) wrapVeh(v, false);
    for (const f of state.factions || []) for (const v of f.vehicles || []) wrapVeh(v, true);
    for (const b of state.bases) if (b.owner == null || b.owner === "player") wrapStock(b, "stock", "base");
    for (const f of state.factions || []) wrapStock(f, "stock", "ai");
    for (const p of state.parties) if (p.owner === "player") { wrapStock(p, "supplies", "party"); if (p.cargo) wrapStock(p.cargo, "supplies", "party"); }
  };
  // ---- trips, losses ----
  const seenParty = new Set();
  const vehLoc = new Map(); // id -> loc kind
  const prevIds = new Set();
  while (day(state) <= days && !state.gameOver) {
    wrapAll();
    curRepair = null;
    payBuf = {};
    tickHour(state);
    curRepair = null;
    for (const p of state.parties) {
      if (p.owner !== "player" || seenParty.has(p.id)) continue;
      seenParty.add(p.id);
      const vs = V.partyVehicles(state, p);
      if (vs.some((x) => V.isCar(x))) R.trips.car++; else if (vs.length) R.trips.bike++; else R.trips.foot++;
      if (!vs.some((x) => V.isCar(x))) add(R.noCar, whyNoCar(state, p), 1);
    }
    for (const [r, v] of pending) {
      if (v.loc.kind === "party") { r.left = state.hour - r.hour; pending.delete(r); }
      else if (state.hour - r.hour > 24 * 7 || !state.vehicles.includes(v)) pending.delete(r);
    }
    const ids = new Set();
    for (const v of state.vehicles) {
      if (v.type === "bike") continue;
      ids.add(v.id);
      const was = vehLoc.get(v.id);
      if (v.loc.kind !== "abandoned" && was === "abandoned") add(R.carsLost, "abandoned car recovered", 1);
      if (v.destroyed && !v._vwDead) { v._vwDead = true; add(R.carsLost, "wrecked (blown up)", 1); }
      vehLoc.set(v.id, v.loc.kind);
    }
    for (const id of prevIds) if (!ids.has(id)) add(R.carsLost, vehLoc.get(id) === "abandoned" ? "abandoned car stripped / gone" : "gone from a base or team (stripped, sold, given)", 1);
    prevIds.clear();
    for (const id of ids) prevIds.add(id);
    if (state.hour % 24 === 12 && hub(state)) { const f = hub(state).stock.fuel || 0; R.out.fuelDays++; R.out.fuelSum += f; if (f < 1) R.out.fuelDays0++; }
    { // every hour (car-hours; the report shows them as days)
      const cars = state.vehicles.filter((v) => V.isCar(v) && v.loc.kind !== "abandoned");
      const parked = cars.filter((v) => v.loc.kind === "base");
      R.cars.push([cars.length, parked.length, cars.length ? Math.round(cars.reduce((a, v) => a + v.condition, 0) / cars.length) : 0]);
    }
  }
  R.days = day(state);
  R.out.alive = state.survivors.filter((s) => s.alive).length;
  R.out.deaths = state.survivors.filter((s) => !s.alive && !s.left).length;
  R.out.left = state.survivors.filter((s) => s.left).length;
  R.fell = !!state.gameOver;
  for (const r of R.repairs) delete r.veh;
  return R;
}

// ---------- the report ----------
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const r1 = (x) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
function merge(runs) {
  const out = { runs: runs.length, days: 0, lost: {}, gained: {}, partsUsed: {}, partsIn: {}, noCar: {}, repairs: [], fuel: { tank: 0, cans: 0 }, trips: { car: 0, bike: 0, foot: 0 }, carsLost: {}, aiVeh: { lost: 0, gained: 0, parts: 0 }, carDays: 0, parkedDays: 0, condSum: 0, out: { alive: 0, deaths: 0, left: 0, fuelDays0: 0, fuelSum: 0, fuelDays: 0, fell: 0 } };
  for (const r of runs) {
    out.days += r.days;
    for (const k of ["lost", "gained", "partsUsed", "partsIn", "carsLost", "noCar"]) for (const [a, b] of Object.entries(r[k] || {})) out[k][a] = (out[k][a] || 0) + b;
    out.repairs.push(...r.repairs);
    for (const k of ["tank", "cans"]) out.fuel[k] += r.fuel[k];
    if (r.out) for (const k of Object.keys(r.out)) out.out[k] += r.out[k];
    if (r.fell) out.out.fell++;
    for (const k of ["car", "bike", "foot"]) out.trips[k] += r.trips[k];
    for (const k of ["lost", "gained", "parts"]) out.aiVeh[k] += r.aiVeh[k];
    for (const [c, p, m] of r.cars) { out.carDays += c / 24; out.parkedDays += p / 24; out.condSum += (m * c) / 24; }
  }
  return out;
}
const colName = (i, n) => (n === 1 ? "value" : n === 2 ? (i ? "after" : "before") : `#${i + 1}`);
function table(title, cols, keysOf, cell) {
  const keys = [...new Set(cols.flatMap(keysOf))].sort((a, b) => cell(cols[0], b) - cell(cols[0], a) || cell(cols[cols.length - 1], b) - cell(cols[cols.length - 1], a));
  console.log(`\n${title}`);
  console.log(`| | ${cols.map((_, i) => colName(i, cols.length)).join(" | ")} |`);
  console.log(`|---|${cols.map(() => "---:").join("|")}|`);
  for (const k of keys) console.log(`| ${k} | ${cols.map((c) => r1(cell(c, k))).join(" | ")} |`);
}
function printReport(sets) {
  const M = sets.map(merge);
  const yrs = (m) => m.days / 112; // game years (112 days)
  console.log(`\nRuns: ${M.map((m) => `${m.runs} runs, ${m.days} days (${r1(yrs(m))} game years)`).join(" | ")}`);
  table("Condition lost, by cause (all player vehicles)", M, (m) => Object.keys(m.lost), (m, k) => m.lost[k] || 0);
  table("Condition restored, by cause", M, (m) => Object.keys(m.gained), (m, k) => m.gained[k] || 0);
  table("Parts used (base stocks and teams' supplies), by kind · purpose", M, (m) => Object.keys(m.partsUsed), (m, k) => m.partsUsed[k] || 0);
  const veh = (m) => Object.entries(m.partsUsed).filter(([k]) => /vehicle/.test(k)).reduce((a, [, q]) => a + q, 0) - Object.entries(m.partsIn).filter(([k]) => /refund/.test(k)).reduce((a, [, q]) => a + q, 0);
  const vehMachine = (m) => Object.entries(m.partsUsed).filter(([k]) => /^machine.*vehicle/.test(k)).reduce((a, [, q]) => a + q, 0) - (m.partsIn["machine · trip called off: refund"] || 0);
  const machineAll = (m) => Object.entries(m.partsUsed).filter(([k]) => /^machine/.test(k) && !/launchExpedition|trade|caravan|deposit|unload|arrive|homecoming|transfer|supply/i.test(k)).reduce((a, [, q]) => a + q, 0) - (m.partsIn["machine · trip called off: refund"] || 0);
  table("Parts given back", M, (m) => Object.keys(m.partsIn).filter((k) => /refund|stripped/.test(k)), (m, k) => m.partsIn[k] || 0);
  const rep = (m) => m.repairs.filter((r) => !r.undone);
  const S = (f) => M.map(f);
  console.log("\nSummary");
  console.log(`| | ${M.map((_, i) => colName(i, M.length)).join(" | ")} |`);
  console.log(`|---|${M.map(() => "---:").join("|")}|`);
  const row = (k, f) => console.log(`| ${k} | ${S(f).map((x) => (typeof x === "number" ? r1(x) : x)).join(" | ")} |`);
  row("condition lost per 100 days", (m) => (100 * sum(m.lost)) / m.days);
  row("condition restored per 100 days", (m) => (100 * sum(m.gained)) / m.days);
  row("parts (both kinds) on vehicles, net of refunds", veh);
  row("machine parts on vehicles, net", vehMachine);
  row("machine parts used, all purposes (rough: transfers left out)", machineAll);
  row("base repairs kept (not undone)", (m) => rep(m).length);
  row("base repairs undone (trip called off)", (m) => m.repairs.filter((r) => r.undone).length);
  row("repairs paid in car parts / machine parts", (m) => `${rep(m).filter((r) => r.pay.carparts).length} / ${rep(m).filter((r) => r.pay.parts).length}`);
  row("repairs: mean condition before", (m) => rep(m).reduce((a, r) => a + r.from, 0) / Math.max(1, rep(m).length));
  row("repairs: condition before ≥ 40", (m) => rep(m).filter((r) => r.from >= 40).length);
  row("repairs: car left on a trip within 1 h / 7 days / never", (m) => `${rep(m).filter((r) => r.left != null && r.left <= 1).length} / ${rep(m).filter((r) => r.left != null && r.left > 1).length} / ${rep(m).filter((r) => r.left == null).length}`);
  row("repairs: base had 2+ cars", (m) => rep(m).filter((r) => r.cars >= 2).length);
  row("trips by car / bikes / on foot", (m) => `${m.trips.car} / ${m.trips.bike} / ${m.trips.foot}`);
  row("fuel burnt (tanks + cans)", (m) => m.fuel.tank + m.fuel.cans);
  row("car-days (cars owned × days)", (m) => m.carDays);
  row("share of car-days parked", (m) => `${Math.round((100 * m.parkedDays) / Math.max(1, m.carDays))}%`);
  row("mean condition of the cars", (m) => m.condSum / Math.max(1, m.carDays));
  row("people alive at the end / dead / left (runs that fell)", (m) => `${m.out.alive} / ${m.out.deaths} / ${m.out.left} (${m.out.fell})`);
  row("days the hub had under 1 fuel at noon / mean hub fuel", (m) => `${m.out.fuelDays0} / ${r1(m.out.fuelSum / Math.max(1, m.out.fuelDays))}`);
  row("AI groups' vehicles: lost / restored / parts", (m) => `${r1(m.aiVeh.lost)} / ${r1(m.aiVeh.gained)} / ${r1(m.aiVeh.parts)}`);
  table("Trips without a car: why (whyNoCar)", M, (m) => Object.keys(m.noCar), (m, k) => m.noCar[k] || 0);
  table("Cars lost and found", M, (m) => Object.keys(m.carsLost), (m, k) => m.carsLost[k] || 0);
  const hist = (m) => { const h = {}; for (const r of rep(m)) { const b = `${Math.floor(r.from / 10) * 10}–${Math.floor(r.from / 10) * 10 + 9}`; h[b] = (h[b] || 0) + 1; } return h; };
  const H = M.map(hist);
  table("Repairs by condition before", H.map((h) => ({ h })), (x) => Object.keys(x.h), (x, k) => x.h[k] || 0);
}

// ===================================================================================================================
// checks
// ===================================================================================================================
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };

async function checks() {
  const t0 = Date.now();
  const AP = await import("../src/sim/autopilot.js");
  const GC = await import("../src/sim/groupcare.js");
  const world = () => { const st = createWorld({ seed: 42, factionCount: 8 }); st.started = true; return st; };
  console.log("The governor's repair before a trip");
  {
    const R = AP.VEH_REPAIR;
    check(!!R && R.below > 0 && R.below <= 60, `the governor mends a car for a trip under ${R && R.below}% condition`);
    const st = world(), h = hub(st);
    for (const v of V.carsAtBase(st, h.id)) st.vehicles.splice(st.vehicles.indexOf(v), 1);
    const v = V.createVehicle(st, "truck", { kind: "base", baseId: h.id }, { condition: 30, fuel: 30 });
    addBuilding(h, "garage");
    h.stock.parts = 6; h.stock.carparts = 2;
    const did = AP.tripRepair(st, h, v);
    check(did && v.condition > 30 && h.stock.carparts === 1 && h.stock.parts === 6, `car parts first: one car part, no machine parts (${v.condition}%, car ${h.stock.carparts}, machine ${h.stock.parts})`);
    v.condition = 30; h.stock.carparts = 0; h.stock.parts = 6;
    AP.tripRepair(st, h, v);
    check(v.condition > 30 && h.stock.parts === 4, "no car parts: two machine parts stand in");
    v.condition = 30; h.stock.carparts = 0; h.stock.parts = 1;
    check(!AP.tripRepair(st, h, v) && v.condition === 30, "neither: no repair");
    v.condition = R.below + 5; h.stock.carparts = 5;
    check(!AP.tripRepair(st, h, v) && v.condition === R.below + 5 && h.stock.carparts === 5, "no top-up of a car above the threshold");
    // Machine parts are kept for the machines: a stand-in only past the hub's machine reserve, and only for a car in poor shape.
    v.condition = 30; h.stock.carparts = 0; h.stock.parts = AP.VEH_REPAIR.machineKeep(st, h) + 1;
    check(!AP.tripRepair(st, h, v) && v.condition === 30, "machine parts at or under the machine reserve stay for the machines");
    v.condition = 10; h.stock.carparts = 0; h.stock.parts = 1;
    check(!AP.tripRepair(st, h, v), "a car in a bad way still needs the parts to be there");
  }
  console.log("A called-off trip gives back what its repair took");
  {
    const st = world(), h = hub(st);
    for (const v of V.carsAtBase(st, h.id)) st.vehicles.splice(st.vehicles.indexOf(v), 1);
    const v = V.createVehicle(st, "truck", { kind: "base", baseId: h.id }, { condition: 30, fuel: 10 });
    addBuilding(h, "garage");
    h.stock.parts = 6; h.stock.carparts = 3; h.stock.fuel = 50;
    const took = AP.tripTook();
    AP.tripRepair(st, h, v, took);
    const f0 = v.fuel; V.refuel(st, h, v); took.fuel += v.fuel - f0;
    h.stock.parts -= 2; // the trip packs two machine parts (a well-digging team) before it is called off: not given back
    AP.tripUndo(h, v, took);
    check(v.condition === 30 && v.fuel === 10 && h.stock.carparts === 3 && h.stock.parts === 4 && h.stock.fuel === 50, `the car part, the condition and the fuel come back, nothing more (${v.condition}%, fuel ${v.fuel}/${h.stock.fuel}, car ${h.stock.carparts}, machine ${h.stock.parts})`);
    v.condition = 10; h.stock.carparts = 0; h.stock.parts = 20;
    for (const b of h.buildings.filter((x) => x.type === "garage")) h.buildings.splice(h.buildings.indexOf(b), 1);
    const crew = st.survivors.filter((x) => x.alive && x.location.kind === "base" && x.location.baseId === h.id);
    crew[0].skills.mechanics = Math.max(crew[0].skills.mechanics || 0, 4);
    const t2 = AP.tripTook();
    AP.tripRepair(st, h, v, t2);
    check(v.condition >= 30, `no garage (+12 a repair): a car at 10% is mended past the 30% a drive needs, not left at 22% (${v.condition}%, ${t2.parts} machine parts)`);
  }
  console.log("Parked in a garage, out of the frost");
  {
    check(BD.WEAR.vehicleFrost > 0 && BD.WEAR.vehicleBlizzard > BD.WEAR.vehicleFrost, "frost and blizzard still wear cars parked in the open");
    check(V.GARAGE_SHELTER >= 1, `a garage keeps ${V.GARAGE_SHELTER} car${V.GARAGE_SHELTER === 1 ? "" : "s"} (each) out of the weather`);
    const st = world(), h = hub(st);
    for (const v of V.vehiclesAtBase(st, h.id)) st.vehicles.splice(st.vehicles.indexOf(v), 1);
    const a = V.createVehicle(st, "truck", { kind: "base", baseId: h.id }, { condition: 80 });
    const b = V.createVehicle(st, "sedan", { kind: "base", baseId: h.id }, { condition: 70 });
    check(V.shelteredAt(st, h).size === 0, "no garage: no car sheltered");
    addBuilding(h, "garage");
    const sh = V.shelteredAt(st, h);
    check(sh.size === Math.min(2, V.GARAGE_SHELTER) && sh.has(a), "a garage shelters the best-kept car first");
    check(V.frostWear(st, h, a, 2) === (sh.has(a) ? 0 : 2) && V.frostWear(st, h, b, 2) === (sh.has(b) ? 0 : 2), "frostWear: nothing for a sheltered car, the day's wear for the rest");
  }
  console.log("AI groups' vehicles (parity)");
  {
    const C = GC.CARE.VEHICLE;
    check(C.below <= 60, `an AI group mends a vehicle under ${C.below}% (the governor's threshold is ${AP.VEH_REPAIR.below}%)`);
    check(C.step >= 15 && C.carparts >= 1, `${C.carparts} car part${C.carparts === 1 ? "" : "s"} a repair, +${C.step}`);
    const TR = await import("../src/sim/trade.js");
    const st = world();
    const f = st.factions.find((x) => x.alive && x.bases.length && !x.outsider);
    f.stock.parts = 10; f.stock.carparts = 2; f.stock.scrap = 10;
    const a = V.groupCost(f, { carparts: 1, scrap: 2 }, TR.groupStockKey);
    check(a.ok && a.cost.carparts === 1 && !a.cost.parts, "a group pays a vehicle repair in car parts first");
    f.stock.carparts = 0;
    const b2 = V.groupCost(f, { carparts: 1, scrap: 2 }, TR.groupStockKey);
    check(b2.ok && b2.cost.parts === V.CARPART_SUB && !b2.cost.carparts, "none: two machine parts stand in");
    f.stock.parts = 1;
    check(!V.groupCost(f, { carparts: 1, scrap: 2 }, TR.groupStockKey).ok, "neither: it waits");
    const SC = await import("../src/sim/aiscav.js");
    const t = st.tiles.find((x) => x.loc && x.loc.type === "autoshop") || st.tiles.find((x) => x.loc && x.loc.type === "gas");
    if (t) {
      const hl = SC.haulFor({ ...t, loot: 1 }, 1, 1, 1);
      check(hl.carparts > 0, `a group's haul from an ${t.loc.type} brings car parts home (${hl.carparts.toFixed(2)} car, ${(hl.parts || 0).toFixed(2)} machine)`);
    }
  }
  console.log("Spare car parts for a long drive");
  {
    check(V.carSpares(V.CAR_SPARES.tiles - 1, 5) === 0, `under ${V.CAR_SPARES.tiles} tiles: none`);
    check(V.carSpares(V.CAR_SPARES.tiles, 5) === V.CAR_SPARES.n, `${V.CAR_SPARES.tiles}+ tiles: ${V.CAR_SPARES.n}`);
    check(V.carSpares(9, 1) === 1 && V.carSpares(9, 0) === 0, "never more than the stores hold");
    check(V.carSpares(9, 5, 1) === V.CAR_SPARES.n - 1 && V.carSpares(9, 5, 0, 3) === 1, "less what is packed already, and what the room takes (3 kg each)");
    const P = await import("../src/sim/parties.js");
    const st = world(), h = hub(st);
    for (const v of V.carsAtBase(st, h.id)) st.vehicles.splice(st.vehicles.indexOf(v), 1);
    const v = V.createVehicle(st, "truck", { kind: "base", baseId: h.id }, { condition: 80, fuel: 30 });
    h.stock.carparts = 3; h.stock.food = 200; h.stock.water = 200;
    const crew = st.survivors.filter((x) => x.alive && x.location.kind === "base" && x.location.baseId === h.id).slice(0, 2);
    const far = st.tiles.filter((x) => x.road && st.grid.distance(h.tile, x.id) >= V.CAR_SPARES.tiles + 1 && st.grid.distance(h.tile, x.id) <= 9 && P.planPath(st, h.tile, x.id, true)).map((x) => x.id)[0];
    if (check(far != null, "a road tile 6–9 tiles out to drive to")) {
      const r = P.launchExpedition(st, { memberIds: crew.map((x) => x.id), dest: far, mission: "scavenge", stance: "normal", vehicleId: v.id, supplies: { food: 6, water: 6 }, spares: true });
      check(!r.error && r.party.supplies.carparts === V.CAR_SPARES.n && h.stock.carparts === 3 - V.CAR_SPARES.n, `the team packs ${r.party && r.party.supplies.carparts} car parts, the stores keep ${h.stock.carparts}${r.error ? ` (${r.error})` : ""}`);
    }
  }
  console.log("A car worth less than its parts");
  {
    const st = world(), h = hub(st);
    for (const v of V.carsAtBase(st, h.id)) st.vehicles.splice(st.vehicles.indexOf(v), 1);
    for (const s of st.survivors) if (s.skills) s.skills.mechanics = Math.min(3, s.skills.mechanics || 0);
    for (const b of h.buildings.filter((x) => x.type === "garage")) h.buildings.splice(h.buildings.indexOf(b), 1);
    const good = V.createVehicle(st, "truck", { kind: "base", baseId: h.id }, { condition: 15 });
    check(AP.stripDeadCars(st, h).length === 0 && st.vehicles.includes(good), "the base's last running car is kept, however worn");
    const bad = V.createVehicle(st, "sedan", { kind: "base", baseId: h.id }, { condition: 12 });
    const c0 = h.stock.carparts || 0;
    check(AP.stripDeadCars(st, h).length === 1 && !st.vehicles.includes(bad) && st.vehicles.includes(good) && (h.stock.carparts || 0) > c0, `a second car under ${AP.STRIP_AT.below}% with nobody to mend it is stripped (the worse one): +${(h.stock.carparts || 0) - c0} car parts`);
    const mid = V.createVehicle(st, "sedan", { kind: "base", baseId: h.id }, { condition: 12 });
    addBuilding(h, "garage");
    check(AP.stripDeadCars(st, h).length === 0 && st.vehicles.includes(mid), "with a garage it is kept for repairs");
    const wreck = V.createVehicle(st, "sedan", { kind: "base", baseId: h.id }, { condition: 0 });
    wreck.destroyed = true;
    check(AP.stripDeadCars(st, h).length === 1 && !st.vehicles.includes(wreck), "a burnt-out wreck is always stripped");
  }
  console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (fail) process.exitCode = 1;
}

if (mode === "census") census();
else if (mode === "report") printReport(argv.slice(1).map((ps) => ps.split(",").flatMap((p) => JSON.parse(readFileSync(p, "utf8"))))); // a,b,c: one column of several files
else await checks();
