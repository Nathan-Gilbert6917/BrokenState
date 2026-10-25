// Headless ETA check: launches teams to varied tiles (on foot / by truck, every stance, full and low fuel),
// then redirects them from where they stand and runs queued orders (move → camp → treat → move), and
// compares the estimated hours with the hours it really took on the shared clock.
// Boat crossings: walk or drive to a shore, build a boat and cross (on foot, truck on a raft, truck left
// behind), then move on from the far side; the estimate must match and the team must end up across.
// Hordes and road conflicts are switched off so only the movement model is compared; travel event cards
// still fire (resolved automatically) and their delays are counted separately. The hour-by-hour check
// re-estimates the remaining time every hour: arrival must match the last re-estimate exactly.
// Usage: node tools/etatest.js [cases per seed] [seeds...]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, estimateTrip, planPath, hoursLeft, orderMove, partyTile, plannedTile, STANCES, cargoLoad, travelHours, paceOpts, partyMembers } from "../src/sim/parties.js";
import { queueOrder, queueEstimate } from "../src/sim/orders.js";
import { vehiclesAtBase, partyFuel } from "../src/sim/vehicles.js";
import { crossingsFrom, boatPlan, boatOrder } from "../src/sim/crossing.js";

const perSeed = Number(process.argv[2] || 12);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [42, 7, 1234];
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`  FAIL: ${msg}`); } return ok; };

// Event cards: pick the first enabled choice (orders cards are left alone; they mean "arrived / done").
function resolveCards(state, p, stats) {
  for (let i = 0; i < state.cards.length;) {
    const c = state.cards[i];
    if (c.isOrders) { i++; continue; }
    state.cards.splice(i, 1);
    const before = p.progress;
    const pace = JSON.stringify([p.members, cargoLoad(p.cargo)]);
    const ch = c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled));
    if (ch) ch.resolve(state);
    stats.cards += 1;
    // A card that offers a fight (loneattack.js: one of them set upon alone, "Fight") holds the team while it lasts: an
    // event delay too (flagged as a 0.01h delay, as a load change below).
    if (c.choices.some((x) => /^(Save and fight|Fight)\b/.test(x.label || "")) && stats.delay === 0) stats.delay = 0.01;
    if (p.progress < before) stats.delay += Math.round(((before - p.progress) / (STANCES[p.stance]?.speed || 1)) * 10) / 10; // delays are real hours at any pace
    // A card that hands the team something to carry (a find) or someone to carry it with changes its load, and a
    // heavier load slows it at once (sim/load.js): an event effect like a delay (flagged as a 0.01h delay).
    if (JSON.stringify([p.members, cargoLoad(p.cargo)]) !== pace && stats.delay === 0) stats.delay = 0.01;
  }
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].isOrders) state.cards.splice(i, 1);
}

// Tick until the team stops moving (or something odd happens). Returns the hours taken.
// strict: also check against the hour-by-hour re-estimate (single moves; a queue mixes tasks in).
function runUntil(state, p, done, stats, strict = true) {
  const start = state.hour;
  let predicted = state.hour + hoursLeft(state, p);
  stats.drift = 0;
  let stuck0 = p.stuck;
  if (p.coldStart && p.coldStart.until > state.hour && !stats.cold) { stats.delay += p.coldStart.hours; stats.cold = true; } // a cold start (sim/weather.js coldStart): a roll at the start
  for (let n = 0; n < 24 * 40; n++) {
    state.hordes.length = 0;
    p.lastConflict = state.hour; // road conflicts off for this check
    state.noWanderers = true; // ... and the people met on the road (wanderers.js)
    tickHour(state);
    if (p.roadblock && p.roadblock.hour === state.hour) stats.delay += p.roadblock.mins / 60; // a road blockage (sim/roadblocks.js) is a delay like a card's
    if (p.stuck && p.stuck !== stuck0) { stats.delay += p.stuck.hours; stuck0 = p.stuck; } // stuck in the mud (sim/weather.js mudStuck): a roll, as a road blockage
    resolveCards(state, p, stats);
    if (state.combat) state.combat = null;
    if (!state.parties.includes(p)) return { hours: state.hour - start, gone: true };
    if (done(p)) {
      if (strict) check(state.hour === predicted, `arrived at ${state.hour}, last re-estimate said ${predicted}`);
      return { hours: state.hour - start };
    }
    const now = state.hour + hoursLeft(state, p);
    if (now !== predicted) stats.drift += 1; // only event delays (or a vehicle left behind) may move it
    predicted = now;
  }
  check(false, "never arrived");
  return { hours: Infinity };
}

const rows = [];
for (const seed of seeds) {
  for (let c = 0; c < perSeed; c++) {
    const state = createWorld({ seed: seed * 100 + c, factionCount: 6 });
    state.started = true;
    const h = hub(state);
    Object.assign(h.stock, { water: 500, fuel: 200, meds: 20, ammo: 300, parts: 10 }); setFood(h, 500);
    const rng = state.rng;
    const truck = vehiclesAtBase(state, h.id)[0];
    const byTruck = c % 2 === 1 && truck;
    const lowFuel = byTruck && c % 4 === 3; // too little fuel: the truck runs dry and they walk on
    const stance = Object.keys(STANCES)[c % 3];
    const pool = state.tiles.filter((t) => t.terrain !== "water" && t.id !== h.tile && state.grid.distance(t.id, h.tile) >= 3 && state.grid.distance(t.id, h.tile) <= 4 + c);
    const dest = rng.pick(pool.filter((t) => planPath(state, h.tile, t.id, !!byTruck)) || pool);
    if (!dest) continue;
    const crew = atBase(state, h.id).slice(0, 2).map((s) => s.id);
    if (byTruck) { truck.fuel = lowFuel ? 2 : 30; truck.condition = 100; }
    // What the team packs is part of its load (sim/load.js): it sets the pace, so the estimate gets it too. On foot
    // the pair packs a little less (they carry it all; by truck the truck does).
    const supplies = byTruck ? { food: 30, water: 30, meds: 4, parts: 2, fuel: !lowFuel ? 10 : 0 } : { food: 24, water: 22, meds: 4, parts: 2 };
    const fuel = byTruck ? truck.fuel + (supplies.fuel || 0) : 0;
    const est = estimateTrip(state, { memberIds: crew, dest: dest.id, vehicle: !!byTruck, v: byTruck ? truck : null, stance, fuel, supplies });
    const oldEst = planPath(state, h.tile, dest.id, !!byTruck).cost / STANCES[stance].speed; // the old formula
    const res = launchExpedition(state, { memberIds: crew, dest: dest.id, mission: "move", stance, vehicleId: byTruck ? truck.id : null, supplies });
    if (!check(!res.error, `launch: ${res.error}`)) continue;
    const p = res.party;
    // Night on the road (nightmarch.js): the estimates time the march itself, so the team pushes on through every
    // night of the trip (a "Night falls" card's Make camp spends the night's hours by the player's choice, not a slower
    // road; this resolver picks the first choice, which camped the queue and redirect legs 8-10h past the estimate).
    p.nightPlan = "push";
    // The carry limit itself: the same crew on foot cannot leave with the full load.
    if (c === 0) {
      const heavy = launchExpedition(state, { memberIds: atBase(state, h.id).slice(0, 1).map((s) => s.id), dest: dest.id, mission: "move", stance, supplies: { food: 60, water: 60 } });
      check(!!heavy.error && /carry/.test(heavy.error), "a walker left with 120 load (carry limit not checked at launch)");
    }
    const stats = { cards: 0, delay: 0 };
    const leg1 = runUntil(state, p, (q) => q.phase === "waiting", stats);
    const row = { seed: seed * 100 + c, how: byTruck ? (lowFuel ? "truck, 2 fuel" : "truck") : "foot", stance, tiles: est.tiles, est: est.hoursOut, old: oldEst, actual: leg1.hours, cards: stats.cards, delay: stats.delay, dry: est.dryAt != null };
    rows.push(row);
    if (stats.delay === 0 && !leg1.gone) {
      check(leg1.hours === est.hoursOut, `seed ${row.seed} launch: estimate ${est.hoursOut}h, took ${leg1.hours}h`);
      // The map's estimated ("?") position reaches the destination on the arrival hour, not before or after.
      check(plannedTile(state, p) === partyTile(p), `seed ${row.seed}: map estimate not at the destination on arrival`);
      state.hour -= 1;
      // (Unless it gets there at the very top of its last hour, est.exactOut whole: a step made cheaper between hours, the
      // weather easing, taken with what the hour before left over. With the clock by the minute it is there at minute 0
      // of that hour (parties.js hourCourse), so the estimate is right; headless, the tick of that hour lands it.)
      const topOfHour = Math.abs(est.exactOut - (est.hoursOut - 1)) < 1e-9;
      check(plannedTile(state, p) !== partyTile(p) || est.hoursOut === 0 || topOfHour, `seed ${row.seed}: map estimate at the destination an hour early`);
      state.hour += 1;
    }
    if (leg1.gone || !state.parties.includes(p)) continue;

    // Redirect from where it stands (orderMove), estimate = hoursLeft right after the order.
    const here = partyTile(p);
    const pool2 = state.tiles.filter((t) => t.terrain !== "water" && state.grid.distance(t.id, here) >= 2 && state.grid.distance(t.id, here) <= 6 && planPath(state, here, t.id, p.vehicle));
    if (!pool2.length) continue;
    const d2 = rng.pick(pool2).id;
    orderMove(state, p, d2);
    const est2 = hoursLeft(state, p);
    // The same with every weather front known (the moving team meets them all; the estimate counts only those on the
    // map now, weather.js): a front that forms on the way is a delay like a card's, not an estimate gone wrong.
    const est2All = travelHours(state, p.path.slice(p.idx), { vehicle: p.vehicle, ...paceOpts(p), progress: p.progress, fuel: p.vehicle === true ? partyFuel(state, p) : 0, known: Infinity }).hours;
    const s2 = { cards: 0, delay: est2All - est2 };
    const leg2 = runUntil(state, p, (q) => q.phase === "waiting", s2);
    rows.push({ seed: row.seed, how: `${p.vehicle ? "truck" : "foot"} (redirect)`, stance, tiles: planPath(state, here, d2, p.vehicle)?.path.length - 1, est: est2, old: null, actual: leg2.hours, cards: s2.cards, delay: s2.delay });
    if (s2.delay === 0 && !leg2.gone) check(leg2.hours === est2, `seed ${row.seed} redirect: estimate ${est2}h, took ${leg2.hours}h`);
    if (leg2.gone || !state.parties.includes(p)) continue;

    // Queue: move → camp 4h → treat → move, all given while the team waits. One estimate for the lot.
    const m = partyMembers(state, p)[0]; // a living one: one lost on the road (loneattack.js straggler) stays in p.members
    m.health = 60;
    const here3 = partyTile(p);
    const near = state.tiles.filter((t) => t.terrain !== "water" && state.grid.distance(t.id, here3) >= 2 && state.grid.distance(t.id, here3) <= 4 && planPath(state, here3, t.id, p.vehicle));
    if (near.length < 2) continue;
    const [qa, qb] = [rng.pick(near).id, rng.pick(near).id];
    p.orders = [];
    queueOrder(state, p, { type: "move", tile: qa }); // starts now
    const curLeft = hoursLeft(state, p);
    for (const o of [{ type: "camp", hours: 4 }, { type: "treat", survivorId: m.id }, { type: "move", tile: qb }]) queueOrder(state, p, o);
    const qe = queueEstimate(state, p);
    const est3 = curLeft + qe.reduce((s, x) => s + (x.hours ?? 0), 0);
    const s3 = { cards: 0, delay: 0 };
    const hpBefore = m.health;
    const leg3 = runUntil(state, p, (q) => q.phase === "waiting" && !q.orders.length && !state.cards.length, s3, false);
    if (!s3.cards) check(m.health > hpBefore, `queue: treat/camp did not heal (${hpBefore} → ${m.health})`);
    if (qa === qb) continue; // the last move was a no-op
    rows.push({ seed: row.seed, how: `queue: move, camp 4h, treat, move`, stance, tiles: null, est: est3, old: null, actual: leg3.hours, cards: s3.cards, delay: s3.delay });
    if (s3.delay === 0 && !leg3.gone) check(leg3.hours === est3, `seed ${row.seed} queue: estimate ${est3}h, took ${leg3.hours}h`);
  }
}

// Boat crossings: walk (or drive) to a shore, then queue "build a boat and cross" → move on the far side.
// The estimate (current order's hours left + queued hours) must match, and the team must end up across.
// Modes: on foot, truck on a raft, truck left on the shore.
for (const seed of seeds) {
  for (const mode of ["foot", "raft", "leave"]) {
    const state = createWorld({ seed: seed * 100 + 77, factionCount: 6 });
    state.started = true;
    const h = hub(state);
    Object.assign(h.stock, { water: 500, fuel: 200, meds: 20, ammo: 300, parts: 10, scrap: 200 }); setFood(h, 500);
    const truck = vehiclesAtBase(state, h.id)[0];
    const byTruck = mode !== "foot" && truck;
    if (mode !== "foot" && !truck) continue;
    if (byTruck) { truck.fuel = 30; truck.condition = 100; }
    // A shore the team can reach whose far side has land it can move on from (and, with the raft, drive on).
    const shores = state.tiles.filter((t) => t.terrain !== "water" && t.id !== h.tile && planPath(state, h.tile, t.id, !!byTruck) && crossingsFrom(state, t.id).length)
      .sort((a, b) => state.grid.distance(a.id, h.tile) - state.grid.distance(b.id, h.tile));
    let shore = null, far = null, onward = null;
    for (const t of shores) {
      for (const c of crossingsFrom(state, t.id)) {
        const drive = mode === "raft";
        if (drive && state.tiles[c.tile].terrain === "mountain" && !state.tiles[c.tile].road) continue; // no raft onto a mountain
        const next =state.tiles.find((x) => x.terrain !== "water" && x.id !== c.tile && state.grid.distance(x.id, c.tile) >= 2 && state.grid.distance(x.id, c.tile) <= 4 && planPath(state, c.tile, x.id, drive));
        if (next) { shore = t.id; far = c.tile; onward = next.id; break; }
      }
      if (shore != null) break;
    }
    if (shore == null) continue;
    const crew = atBase(state, h.id).slice(0, 3).map((s) => s.id);
    const supplies = { food: 30, water: 30, meds: 2, parts: byTruck ? 4 : 0, scrap: 45, fuel: byTruck ? 10 : 0 };
    const res = launchExpedition(state, { memberIds: crew, dest: shore, mission: "move", stance: "normal", vehicleId: byTruck ? truck.id : null, supplies: byTruck ? supplies : { food: 6, water: 6 } });
    if (!check(!res.error, `crossing launch: ${res.error}`)) continue;
    const p = res.party;
    p.nightPlan = "push"; // as above: the crossing's estimate is the march and the build, not a night's camp
    Object.assign(p.supplies, supplies); // on foot: handed the rest after leaving within the carry limit
    const s1 = { cards: 0, delay: 0 };
    runUntil(state, p, (q) => q.phase === "waiting", s1, false);
    if (!state.parties.includes(p) || partyTile(p) !== shore) continue;
    // Not every plan is affordable (big load + raft): show the plan, then cross only if it is.
    const plan = boatPlan(state, p, shore, far, mode === "foot" ? "raft" : mode);
    const order = boatOrder(state, p, shore, far, mode === "foot" ? "raft" : mode);
    check(!order.error, `boat order: ${order.error}`);
    if (!check(plan.ok, `seed ${seed} ${mode}: boat not affordable: ${plan.reason}`)) continue;
    p.orders = [];
    const scrapBefore = (p.supplies.scrap || 0) + (p.cargo.supplies.scrap || 0);
    queueOrder(state, p, order); // starts now
    check(p.phase === "task" && p.task?.type === "cross", `seed ${seed} ${mode}: crossing did not start`);
    queueOrder(state, p, { type: "move", tile: onward });
    const curLeft = p.task.hours - p.task.done;
    const est = curLeft + queueEstimate(state, p).reduce((s, x) => s + (x.hours ?? 0), 0);
    const s2 = { cards: 0, delay: 0 };
    let landed = false;
    const leg = runUntil(state, p, (q) => { if (partyTile(q) === far) landed = true; return q.phase === "waiting" && !q.orders.length && !state.cards.length; }, s2, false);
    check(landed, `seed ${seed} ${mode}: never stood on the far shore`);
    check(partyTile(p) === onward || leg.gone, `seed ${seed} ${mode}: ended at ${partyTile(p)}, wanted ${onward}`);
    const used = scrapBefore - ((p.supplies.scrap || 0) + (p.cargo.supplies.scrap || 0));
    check(used >= order.mats.scrap - 1e-9, `seed ${seed} ${mode}: scrap used ${used}, plan ${order.mats.scrap}`);
    if (mode === "leave") check(!p.vehicle && truck.loc.kind === "abandoned" && truck.loc.tile === shore, `seed ${seed}: truck not left on the shore`);
    if (mode === "raft") check(p.vehicle, `seed ${seed}: truck did not come along on the raft`);
    rows.push({ seed: seed * 100 + 77, how: `boat ${mode} (${matsTextOf(order.mats)}) + move`, stance: "normal", tiles: null, est, old: null, actual: leg.hours, cards: s2.cards, delay: s2.delay });
    if (s2.delay === 0 && !leg.gone) check(leg.hours === est, `seed ${seed} boat ${mode}: estimate ${est}h, took ${leg.hours}h`);
  }
}
function matsTextOf(m) { return `${m.scrap} scrap${m.parts ? `, ${m.parts} parts` : ""}`; }

const pad = (v, n) => String(v ?? "").padEnd(n);
console.log(`${pad("seed", 7)}${pad("transport", 34)}${pad("stance", 9)}${pad("tiles", 6)}${pad("estimate", 9)}${pad("actual", 7)}${pad("old est", 8)}events/delay`);
for (const r of rows) {
  console.log(`${pad(r.seed, 7)}${pad(r.how + (r.dry ? " (runs dry)" : ""), 34)}${pad(r.stance, 9)}${pad(r.tiles, 6)}${pad(r.est + "h", 9)}${pad(r.actual + "h", 7)}${pad(r.old != null ? r.old.toFixed(1) + "h" : "", 8)}${r.cards ? `${r.cards} card(s), +${r.delay}h delay` : ""}`);
}
const clean = rows.filter((r) => r.delay === 0 && isFinite(r.actual));
const exact = clean.filter((r) => r.est === r.actual).length;
const oldOff = rows.filter((r) => r.old != null && r.delay === 0).map((r) => Math.abs(r.old - r.actual));
console.log(`\n${exact}/${clean.length} trips without event delays matched the estimate to the hour.`);
if (oldOff.length) console.log(`Old one-way formula (path cost / speed) was off by ${(oldOff.reduce((a, b) => a + b, 0) / oldOff.length).toFixed(1)}h on average (max ${Math.max(...oldOff).toFixed(1)}h); the planner showed only the round trip.`);
console.log(fails ? `${fails} FAILURE(S)` : "All checks passed.");
process.exit(fails ? 1 : 0);
