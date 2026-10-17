// Headless check of how your teams move on the State Map: the glide between tiles (sim/parties.js glideAt, drawn by
// ui/render.js drawPlayerParty) and the arrival of a plain move.
//  - The glide: the main loop's clock (main.js step: the minutes of the coming hour, an hour every 20 s at 1×) is
//    run frame by frame at 0.25×, 0.5×, 1×, 2× and 3× while a team crosses several tiles, and where the map draws the team
//    each frame is measured along its way: it must never go backward (no snap back to the tile it left, when it gets
//    somewhere before the hour is out or when the hour ticks), never jump ahead by much, and end on the destination.
//    On foot (normal, stealthy, rushed), by truck on a road and off it, on bikes, with road blockages
//    (sim/roadblocks.js: the team is held up where it met one), and held by a card waiting in the tray (ui/pacing.js
//    holdsNextHour: it does not glide at all).
//  - The ETA and the arrival agree, and the glide gets there exactly as the sim does: a move ordered from the
//    right-click menu at any minute of the hour (sim/parties.js moveEstimate, wayOn: the minutes already
//    gone are not travelled) arrives at the minute the menu said, and the team arrives as the glide reaches the centre
//    of the destination (arrivalsDue: never there early, standing until the clock catches up); the team panel's time
//    left says the same all the way; launched from the planner (estimateTrip) likewise. On foot, by truck on and
//    off the road, on bikes; one tile and several; a stance changed and the clock speed changed under way.
//  - The same by the minute for the rest: a timed job (rest, wait, look around) ordered part-way through an hour
//    lasts its hours from then (orders.js task.owed, tasksDue); a convoy arrives at its minute; out of contact the map's
//    estimate (plannedPos) glides by the minute and gets there when the team does; a team redirected on the move turns
//    from where it is drawn (stepToNow, wayOn: no snap back) on the ETA it was given; queued orders start and end at
//    the minutes the queue's estimates said (queueEstimate).
//  - A road blockage met on the way shows its wait with the minutes left ("Clearing road 40m"), not a silent stop.
//  - The clock speeds: 0.25× is one of them (ui/pacing.js, the key table, the top bar).
//  - A plain move that got there raises no card (a log line instead) when the team can be reached without one; out of
//    contact, under the autopilot and for a mission with a result (recon) the card still comes.
// Usage: node tools/mapmovetest.js [seed]
import { commandable } from "../src/sim/plans.js";
import { createWorld, tickHour, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, planPath, partyTile, glideAt, giveOrder, teamName, setClockFrac, hoursLeft, hourCourse, clockText, arrivalsDue, onTheMove, plannedPos, plannedArrival, dispatchConvoy } from "../src/sim/parties.js";
import { teamTileMenu, runTeamAction } from "../src/ui/teamctx.js";
import { orderStatus, startOrder, queueOrder, queueEstimate } from "../src/sim/orders.js";
import { SPEEDS as GAME_SPEEDS, SLOWEST_SPEED } from "../src/ui/pacing.js";
import { KEYMAP, keyAction } from "../src/ui/keymap.js";
import { readFileSync } from "node:fs";
import { vehiclesAtBase, createVehicle, isBike } from "../src/sim/vehicles.js";
import { addBuilding } from "../src/sim/buildings.js";
import { pacingFrame, beforeHour, holdsNextHour, trayCards, cardUp } from "../src/ui/pacing.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => {
  if (ok) { passed++; console.log(`  passed: ${msg}`); } else { fails++; console.log(`  failed: ${msg}`); }
  return !!ok;
};
const section = (name) => console.log(name);

const HOURS_PER_SECOND = 1 / 20; // main.js
const FRAME = 1 / 60;            // seconds a frame
const SPEEDS = [0.25, 0.5, 1, 2, 3];

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 7 });
  state.started = true;
  state.autoCombat = true;
  state.noWanderers = true;
  state.noRoadblocks = true;
  Object.assign(hub(state).stock, { food: 300, water: 300, fuel: 100, meds: 20, ammo: 300, parts: 10, scrap: 100 });
  return state;
}
const crewOf = (state, n) => atBase(state, hub(state).id).slice(0, n);
// A land tile d..d2 tiles away by `vehicle` (filter: a test on the path), not a base.
function tileNear(state, from, d, d2, vehicle = false, filter = () => true) {
  for (const t of state.tiles) {
    const dist = state.grid.distance(from, t.id);
    if (dist < d || dist > d2 || t.terrain === "water" || state.bases.some((b) => b.tile === t.id)) continue;
    const res = planPath(state, from, t.id, vehicle);
    if (res && filter(res.path)) return t.id;
  }
  return null;
}
const allRoad = (state) => (path) => path.every((id, i) => i === 0 || state.tiles[path[i - 1]].roadLinks.includes(id));
const noRoad = (state) => (path) => path.every((id, i) => i === 0 || !state.tiles[path[i - 1]].roadLinks.includes(id));
function send(state, n, dest, { stance = "normal", vehicleId = null, mission = "move" } = {}) {
  const res = launchExpedition(state, { memberIds: crewOf(state, n).map((s) => s.id), dest, mission, stance, vehicleId, supplies: { food: 4, water: 4 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  return res.party;
}
// Nothing on the road but the movement under test: no hordes, no road conflicts, event cards thrown away (keep: a
// card the case put there itself).
function calm(state, p, keep) {
  state.hordes.length = 0;
  p.lastConflict = state.hour;
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i] !== keep && !state.cards[i].isOrders) state.cards.splice(i, 1);
  if (state.combat) state.combat = null;
}

// Where the map draws the team (ui/render.js drawPlayerParty), as a distance along its way: i + t on the step from
// way[i] to way[i + 1]. from: the index to search the way from (the last place, so a way through a tile twice reads
// forward). Returns -1 if the team is somewhere not on the way from there on.
function drawnAt(state, p, way, frac, from) {
  const gl = glideAt(state, p, frac, holdsNextHour(state, p));
  const glide = gl.to !== gl.from && gl.t > 0 ? gl : null;
  const lo = Math.max(0, Math.floor(from));
  if (glide) {
    for (let i = Math.max(0, lo - 1); i < way.length - 1; i++) if (way[i] === glide.from && way[i + 1] === glide.to) return i + glide.t;
    return -1;
  }
  const at = partyTile(p);
  for (let i = lo; i < way.length; i++) if (way[i] === at) return i;
  return -1;
}

// Runs the main loop's clock frame by frame (main.js step: acc, the hour's minutes, beforeHour, tickHour) until the
// team stops or `hours` pass. Returns the measures: back (the worst step backward, in tiles), jump (the biggest step
// ahead in one frame), end (the last place), ticks, stalls (frames drawn on the tile it left after the glide had it
// further on), and the way.
function drive(state, p, speed, { hours = 60, keep = null, onHour = null } = {}) {
  const ui = { started: true, speed };
  const way = [...p.path];
  let acc = 0, last = drawnAt(state, p, way, 0, 0), back = 0, jump = 0, ticks = 0, lost = 0;
  for (let f = 0; f < hours * 1e4 && ticks < hours; f++) {
    pacingFrame(state, ui);
    acc += FRAME * speed * HOURS_PER_SECOND;
    while (acc >= 1) {
      calm(state, p, keep);
      beforeHour(state, ui);
      tickHour(state);
      calm(state, p, keep);
      pacingFrame(state, ui);
      acc -= 1;
      ticks++;
      if (onHour) onHour(ticks);
    }
    // main.js: a team that gets there at this minute arrives now (the glide is on the centre of the tile).
    arrivalsDue(state, Math.min(0.999, acc), (q) => holdsNextHour(state, q));
    if (!state.parties.includes(p)) break;
    const now = drawnAt(state, p, way, Math.max(0, Math.min(0.999, acc)), last);
    if (now < 0) { lost++; continue; }
    if (now < last) back = Math.max(back, last - now);
    else jump = Math.max(jump, now - last);
    last = Math.max(last, now);
    if (p.phase !== "out" && p.phase !== "back") break;
  }
  return { back, jump, end: last, ticks, lost, way };
}
const r2 = (x) => Math.round(x * 100) / 100;
// One trip at each speed, each from a fresh copy of the world (the same seed).
function tripAtSpeeds(label, setup) {
  for (const speed of SPEEDS) {
    const { state, p, opts } = setup();
    if (!p) { check(false, `${label}: no trip to make on seed ${SEED}`); return; }
    const res = drive(state, p, speed, opts || {});
    const steps = res.way.length - 1;
    check(res.back < 1e-6 && res.lost === 0, `${label} at ${speed}×: never drawn going back (worst ${r2(res.back)} tiles back, ${res.lost} frames off the way)`);
    check(res.jump < 0.2, `${label} at ${speed}×: no jump ahead (biggest step in a frame ${r2(res.jump)} tiles)`);
    check(Math.abs(res.end - steps) < 1e-6 && p.phase === "waiting", `${label} at ${speed}×: ends on the destination (${r2(res.end)} of ${steps} steps, ${res.ticks} h, ${p.phase})`);
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Glide on foot: smooth from tile to tile, no snap back on arriving (normal, stealthy, rushed)");
for (const stance of ["normal", "stealthy", "rushed"]) {
  tripAtSpeeds(`on foot, ${stance}`, () => {
    const state = mk();
    const dest = tileNear(state, hub(state).tile, 4, 5);
    return { state, p: dest == null ? null : send(state, 2, dest, { stance }) };
  });
}

section("Glide by truck: several tiles an hour on a road, two off it");
tripAtSpeeds("truck on a road", () => {
  const state = mk();
  const v = vehiclesAtBase(state, hub(state).id).find((x) => !isBike(x));
  if (!v) return { state, p: null };
  v.fuel = 40; v.condition = 100;
  const dest = tileNear(state, hub(state).tile, 6, 9, true, allRoad(state));
  return { state, p: dest == null ? null : send(state, 2, dest, { vehicleId: v.id }) };
});
tripAtSpeeds("truck off-road", () => {
  const state = mk();
  const v = vehiclesAtBase(state, hub(state).id).find((x) => !isBike(x));
  if (!v) return { state, p: null };
  v.fuel = 40; v.condition = 100;
  const dest = tileNear(state, hub(state).tile, 3, 5, true, noRoad(state));
  return { state, p: dest == null ? null : send(state, 2, dest, { vehicleId: v.id }) };
});

section("Glide on bikes");
tripAtSpeeds("bikes", () => {
  const state = mk();
  const bikes = createVehicle(state, "bike", { kind: "base", baseId: hub(state).id }, { count: 2, condition: 100 });
  const dest = tileNear(state, hub(state).tile, 5, 8, "bike");
  return { state, p: dest == null ? null : send(state, 2, dest, { vehicleId: bikes.id }) };
});

section("Road blockages: the team is held up where it meets one, and the glide waits there with it");
{
  let blocks = 0, trips = 0, worstBack = 0, worstJump = 0, lostFrames = 0, ended = 0;
  for (let k = 0; k < 24 && blocks < 4; k++) {
    for (const speed of [1, 3]) {
      const state = mk();
      state.noRoadblocks = false;
      for (let h = 0; h < k; h++) tickHour(state); // a different hour: other dice
      const v = vehiclesAtBase(state, hub(state).id).find((x) => !isBike(x));
      if (!v) break;
      v.fuel = 60; v.condition = 100;
      const dest = tileNear(state, hub(state).tile, 7, 11, true, allRoad(state));
      if (dest == null) break;
      const p = send(state, 2, dest, { vehicleId: v.id });
      let seen = 0;
      const res = drive(state, p, speed, { onHour: () => { if (p.roadblock && p.roadblock.hour === state.hour) seen++; } });
      trips++;
      blocks += seen;
      worstBack = Math.max(worstBack, res.back);
      worstJump = Math.max(worstJump, res.jump);
      lostFrames += res.lost;
      if (Math.abs(res.end - (res.way.length - 1)) < 1e-6) ended++;
      if (seen && p.roadblock) {
        const i = res.way.indexOf(p.roadblock.tile);
        check(i >= 0, `the blockage was on the way (${p.roadblock.mins} min at tile ${p.roadblock.tile})`);
      }
    }
  }
  check(blocks > 0, `blockages met: ${blocks} in ${trips} truck trips`);
  check(worstBack < 1e-6 && lostFrames === 0, `with blockages never drawn going back (worst ${r2(worstBack)} tiles)`);
  check(worstJump < 0.2, `with blockages no jump ahead (biggest ${r2(worstJump)} tiles in a frame)`);
  check(ended === trips, `every trip with blockages ends on its destination (${ended} of ${trips})`);
}

section("A team holding for a card in the tray does not glide (and does not jump back when the hour ticks)");
{
  const state = mk();
  const dest = tileNear(state, hub(state).tile, 5, 6);
  const p = send(state, 2, dest);
  const card = { title: "Something on the road", text: "A test card.", partyId: p.id, choices: [{ label: "OK", resolve: () => "" }] };
  let idxHeld = null, heldOk = true, sawHeld = false;
  const res = drive(state, p, 2, {
    keep: card,
    onHour: (h) => {
      if (h === 1) state.cards.push(card);
      if (h >= 2 && h <= 4) {
        sawHeld = sawHeld || holdsNextHour(state, p);
        if (idxHeld == null) idxHeld = p.idx;
        else if (p.idx !== idxHeld) heldOk = false;
      }
      if (h === 4) state.cards.splice(state.cards.indexOf(card), 1);
    },
  });
  check(sawHeld, "the card waits in the tray and the team holds (holdsNextHour)");
  check(heldOk, "it does not move on while the card waits");
  check(res.back < 1e-6 && res.lost === 0, `never drawn going back while held or after (worst ${r2(res.back)} tiles)`);
  check(Math.abs(res.end - (res.way.length - 1)) < 1e-6, "it goes on and gets there once the card is gone");
}

// ---------------------------------------------------------------------------------------------------------
// The main loop's clock as main.js runs it, from acc0 (the minutes of the hour already gone when the order was given):
// the sim told the minutes each frame (setClockFrac), 0 while the hour ticks. Returns the hours on the clock from the
// order to the arrival (arrive: the frame it got there, arrivalsDue), to the first frame the glide drew the team on the centre of its destination
// (reach), the worst step back and jump ahead, and the panels' time left on the way (lefts: [hours gone, left]).
// change(gone, ui): called each frame with the hours gone (a stance or speed change under way).
function clockRun(state, p, speed, acc0, { hours = 40, change = null } = {}) {
  const ui = { started: true, speed };
  const way = [...p.path], end = way.length - 1;
  let acc = acc0, ticks = 0, last = drawnAt(state, p, way, acc0, 0), back = 0, jump = 0, reach = null, arrive = null, lost = 0;
  const lefts = [];
  setClockFrac(acc);
  for (let f = 0; f < hours * 1e5 && ticks < hours; f++) {
    acc += FRAME * ui.speed * HOURS_PER_SECOND;
    while (acc >= 1) {
      setClockFrac(0);
      calm(state, p);
      beforeHour(state, ui);
      tickHour(state);
      calm(state, p);
      acc -= 1;
      ticks++;
    }
    setClockFrac(Math.min(0.999, acc));
    const gone = ticks + acc - acc0;
    if (change) change(gone, ui);
    arrivalsDue(state, Math.min(0.999, acc), (q) => holdsNextHour(state, q)); // main.js: arriving at the minute
    if (p.phase !== "out" && p.phase !== "back") { arrive = gone; break; }
    const now = drawnAt(state, p, way, Math.min(0.999, acc), last);
    if (now < 0) { lost++; continue; }
    if (now < last) back = Math.max(back, last - now);
    else jump = Math.max(jump, now - last);
    last = Math.max(last, now);
    if (reach == null && now >= end - 1e-6) reach = gone;
    if (f % 600 === 0) { const st = orderStatus(state, p); lefts.push([gone, st.left - Math.min(0.999, acc)]); }
  }
  setClockFrac(0);
  return { arrive, reach: reach ?? arrive, back, jump, lost, lefts, ticks };
}
// A team sent out (the hub has a radio station: in contact) and waiting at a tile, with a vehicle or not.
function waitingTeam(seed, { vehicle = null, bikes = false, stance = "normal", n = 2, road = false } = {}) {
  const state = mk(seed);
  addBuilding(hub(state), "radio");
  let vehicleId = null;
  if (bikes) vehicleId = createVehicle(state, "bike", { kind: "base", baseId: hub(state).id }, { count: n, condition: 100 }).id;
  else if (vehicle) {
    const v = vehiclesAtBase(state, hub(state).id).find((x) => !isBike(x));
    if (!v) return null;
    v.fuel = 60; v.condition = 100; vehicleId = v.id;
  }
  const mode = bikes ? "bike" : vehicle ? true : false;
  const first = tileNear(state, hub(state).tile, 2, road ? 4 : 2, mode, road ? allRoad(state) : () => true);
  if (first == null) return null;
  const p = send(state, n, first, { stance, vehicleId });
  for (let h = 0; h < 30 && p.phase !== "waiting"; h++) { tickHour(state); calm(state, p); }
  return p.phase === "waiting" ? { state, p } : null;
}
// Order a move from the right-click menu (ui/teamctx.js) acc0 into the hour: what the menu said (hours from that
// minute on the clock), the panels' time left just after, and the order given.
function menuMove(state, p, dest, acc0) {
  setClockFrac(acc0);
  const m = teamTileMenu(state, {}, p, dest);
  const it = m.items.find((x) => x.key === "move");
  const shown = it ? it.travel : null;
  const msg = it ? runTeamAction(state, {}, { id: p.id, tile: dest, key: "move", mode: "replace", ok: "1" }) : "no Move here";
  const left0 = p.phase === "out" ? hoursLeft(state, p, true) - acc0 : null;
  setClockFrac(0);
  return { shown, msg, left0 };
}
const MIN = 1 / 60;
// "2h 05m", "45m", "3h" back to hours.
const hrsOf = (t) => { const m = /^(?:(\d+)h)?\s*(?:(\d+)m)?$/.exec(String(t || "").trim()); return m ? Number(m[1] || 0) + Number(m[2] || 0) / 60 : NaN; };

section("The ETA is the arrival, and the glide reaches the destination's centre exactly as the move ends");
{
  const cases = [
    { label: "on foot, 1 tile", opts: {}, d: [1, 1] },
    { label: "on foot, 3 tiles", opts: {}, d: [3, 3] },
    { label: "on foot rushed, 2 tiles", opts: { stance: "rushed" }, d: [2, 2] },
    { label: "truck, 1 tile", opts: { vehicle: true }, d: [1, 1] },
    { label: "truck on a road, 3–7 tiles", opts: { vehicle: true, road: true }, d: [3, 7], filter: allRoad },
    { label: "truck off-road, 2–3 tiles", opts: { vehicle: true }, d: [2, 3], filter: noRoad },
    { label: "bikes, 3–5 tiles", opts: { bikes: true }, d: [3, 5] },
  ];
  for (const c of cases) {
    let ran = 0, etaOk = 0, reachOk = 0, smooth = 0, leftOk = 0, worst = "";
    for (const [k, acc0] of [0, 0.25, 0.6, 0.95].entries()) {
      for (const speed of [0.25, 1, 3]) {
        const w = waitingTeam(SEED + k, c.opts);
        if (!w) continue;
        const { state, p } = w;
        const dest = tileNear(state, partyTile(p), c.d[0], c.d[1], p.vehicle, c.filter ? c.filter(state) : () => true);
        if (dest == null) continue;
        const o = menuMove(state, p, dest, acc0);
        if (p.phase !== "out") { worst = `${c.label}: not sent (${o.msg})`; continue; }
        const r = clockRun(state, p, speed, acc0);
        ran++;
        // ETA: what the menu said = the hours from the order to the arrival (to the minute).
        if (r.arrive != null && Math.abs(o.shown - r.arrive) < MIN && Math.abs(o.left0 - r.arrive) < MIN) etaOk++;
        else worst = `${c.label} at ${acc0} into the hour, ${speed}×: shown ${r2(o.shown)} h, left ${r2(o.left0)} h, arrived after ${r2(r.arrive)} h`;
        // The glide gets to the centre of the destination as the move ends, not before (within a frame).
        if (r.arrive != null && r.reach >= r.arrive - 0.01) reachOk++;
        else worst = `${c.label} at ${acc0}, ${speed}×: the glide got there after ${r2(r.reach)} h, the move ended after ${r2(r.arrive)} h`;
        if (r.back < 1e-6 && r.jump < 0.2 && r.lost === 0) smooth++;
        else worst = `${c.label} at ${acc0}, ${speed}×: back ${r2(r.back)}, jump ${r2(r.jump)}, lost ${r.lost}`;
        // The panels' time left on the way: always the hours to the arrival.
        if (r.lefts.every(([gone, left]) => Math.abs(gone + left - r.arrive) < MIN)) leftOk++;
        else worst = `${c.label} at ${acc0}, ${speed}×: "left" on the way ${r.lefts.map(([g, l]) => r2(g + l)).join(", ")} vs arrival ${r2(r.arrive)}`;
      }
    }
    const why = worst ? ` (${worst})` : "";
    check(ran > 0 && etaOk === ran, `${c.label}: the menu's ETA is the arrival, ordered at any minute (${etaOk} of ${ran})${etaOk < ran ? why : ""}`);
    check(ran > 0 && reachOk === ran, `${c.label}: the glide reaches the destination's centre as the move ends, never before (${reachOk} of ${ran})${reachOk < ran ? why : ""}`);
    check(ran > 0 && smooth === ran, `${c.label}: smooth on the way (${smooth} of ${ran})${smooth < ran ? why : ""}`);
    check(ran > 0 && leftOk === ran, `${c.label}: the panels' time left agrees all the way (${leftOk} of ${ran})${leftOk < ran ? why : ""}`);
  }
}

section("No glide to the tile followed by a wait (the report: 3 h shown, 2 h taken, the car there after 1 h)");
{
  // A truck a few road tiles out, quicker than an hour's pace: the old glide got there part-way through the last hour
  // and stood there until the tick, and ordered at 55 minutes past, the old ETA counted the first hour whole.
  let ran = 0, ok = 0, line = "";
  for (let k = 0; k < 6; k++) {
    const w = waitingTeam(SEED + 10 + k, { vehicle: true });
    if (!w) continue;
    const { state, p } = w;
    const dest = tileNear(state, partyTile(p), 3, 6, true, allRoad(state));
    if (dest == null) continue;
    const o = menuMove(state, p, dest, 55 / 60);
    if (p.phase !== "out") continue;
    const r = clockRun(state, p, 1, 55 / 60);
    ran++;
    if (Math.abs(o.shown - r.arrive) < MIN && r.reach >= r.arrive - 0.01) ok++;
    line = `shown ${r2(o.shown)} h, arrived after ${r2(r.arrive)} h, the glide there after ${r2(r.reach)} h`;
  }
  check(ran > 0 && ok === ran, `a car ordered at :55: the ETA is the arrival and the glide ends on it (${ok} of ${ran}; last: ${line})`);
}

section("Changes under way: a stance changed mid-hour, the clock's speed changed mid-move");
{
  // On foot, normal to rushed half-way through the second hour: the tick moves the whole hour at the new pace, and the
  // glide eases onto it (no jump, never back); the time left is the arrival again from then on.
  let ran = 0, ok = 0, line = "";
  for (let k = 0; k < 4; k++) {
    const w = waitingTeam(SEED + 20 + k);
    if (!w) continue;
    const { state, p } = w;
    const dest = tileNear(state, partyTile(p), 4, 5, false);
    if (dest == null) continue;
    menuMove(state, p, dest, 0.3);
    if (p.phase !== "out") continue;
    let switched = false;
    const r = clockRun(state, p, 1, 0.3, { change: (h) => { if (!switched && h > 1.5) { p.stance = "rushed"; switched = true; } } });
    ran++;
    const after = r.lefts.filter(([g]) => g > 1.6);
    if (switched && r.back < 1e-6 && r.jump < 0.05 && after.every(([g, l]) => Math.abs(g + l - r.arrive) < MIN) && r.reach >= r.arrive - 0.01) ok++;
    line = `back ${r2(r.back)}, jump ${r2(r.jump)}, arrival ${r2(r.arrive)}, reach ${r2(r.reach)}`;
  }
  check(ran > 0 && ok === ran, `rushed from mid-way: eased on (no jump, no step back), the ETA follows, the glide ends on the arrival (${ok} of ${ran}; ${line})`);
  // A truck at 0.25× for the first hour, then 3×: the glide follows the clock's minutes, whatever its speed.
  let ran2 = 0, ok2 = 0, line2 = "";
  for (let k = 0; k < 4; k++) {
    const w = waitingTeam(SEED + 30 + k, { vehicle: true });
    if (!w) continue;
    const { state, p } = w;
    const dest = tileNear(state, partyTile(p), 5, 8, true);
    if (dest == null) continue;
    const o = menuMove(state, p, dest, 0.5);
    if (p.phase !== "out") continue;
    const r = clockRun(state, p, 0.25, 0.5, { change: (h, ui) => { if (h > 1) ui.speed = 3; } });
    ran2++;
    if (Math.abs(o.shown - r.arrive) < MIN && r.back < 1e-6 && r.jump < 0.2 && r.reach >= r.arrive - 0.01) ok2++;
    line2 = `shown ${r2(o.shown)}, arrived ${r2(r.arrive)}, back ${r2(r.back)}, jump ${r2(r.jump)}`;
  }
  check(ran2 > 0 && ok2 === ran2, `a truck at 0.25× then 3×: on time and smooth (${ok2} of ${ran2}; ${line2})`);
}

section("Launched from the planner: the trip's ETA counts from the minute it was sent");
{
  let ran = 0, ok = 0, line = "";
  for (const acc0 of [0, 0.4, 0.9]) {
    for (const vehicle of [false, true]) {
      const state = mk(SEED + 40);
      addBuilding(hub(state), "radio");
      const v = vehicle ? vehiclesAtBase(state, hub(state).id).find((x) => !isBike(x)) : null;
      if (vehicle && !v) continue;
      if (v) { v.fuel = 60; v.condition = 100; }
      const dest = tileNear(state, hub(state).tile, 3, 5, vehicle);
      if (dest == null) continue;
      setClockFrac(acc0);
      const p = send(state, 2, dest, { vehicleId: v ? v.id : null });
      const logged = (state.log.find((l) => / left for .*Arrives in about/.test(l.text)) || { text: "" }).text;
      const est = hrsOf((/Arrives in about ([^.;]+)/.exec(logged) || [])[1]); // what the log said, as the planner said it
      setClockFrac(0);
      const r = clockRun(state, p, 2, acc0);
      ran++;
      if (Math.abs(est - r.arrive) < MIN && r.reach >= r.arrive - 0.01 && r.back < 1e-6) ok++;
      line = `${vehicle ? "truck" : "foot"} at ${acc0}: "Arrives in about ${clockText(est)}", arrived after ${clockText(r.arrive)}`;
    }
  }
  check(ran > 0 && ok === ran, `the planner's ETA is the arrival, sent at any minute (${ok} of ${ran}; ${line})`);
}

section("A road blockage shows its wait on the map with the minutes left");
{
  let seen = 0, labelled = 0, fine = 0, line = "";
  for (let k = 0; k < 30 && seen < 3; k++) {
    const state = mk();
    state.noRoadblocks = false;
    for (let h = 0; h < k; h++) tickHour(state);
    const v = vehiclesAtBase(state, hub(state).id).find((x) => !isBike(x));
    if (!v) break;
    v.fuel = 60; v.condition = 100;
    const dest = tileNear(state, hub(state).tile, 7, 11, true, allRoad(state));
    if (dest == null) break;
    const p = send(state, 2, dest, { vehicleId: v.id });
    let met = false, label = null, up = 0;
    for (let h = 0; h < 30 && p.phase === "out"; h++) {
      calm(state, p);
      // Through the hour: a blockage in the course shows as a "road" wait with its minutes counting down.
      if (hourCourse(state, p).pts.some((x) => x.sit === "road")) met = true;
      let prev = null;
      for (let f = 0; f < 1; f += 0.02) {
        const g = glideAt(state, p, f);
        if (g.sit && g.sit.kind === "road") {
          label = label || g.sit;
          if (prev != null && g.sit.mins > prev + 1) up++;
          prev = g.sit.mins;
        } else prev = null;
      }
      tickHour(state);
    }
    if (!met) continue;
    seen++;
    if (label) labelled++;
    if (label && label.mins > 0 && !up) fine++;
    line = label ? `Clearing road ${label.mins}m` : "no label";
  }
  check(seen > 0, `blockages met on the way (${seen})`);
  check(labelled === seen && fine === seen, `each shows a road wait with the minutes left, counting down (${fine} of ${seen}; first: ${line})`);
  const render = readFileSync(new URL("../src/ui/render.js", import.meta.url), "utf8");
  check(/Clearing road/.test(render) && /gl && gl\.sit/.test(render), "the map draws it over the team (ui/render.js)");
}

section("0.25×: one of the clock's speeds");
{
  check(SLOWEST_SPEED === 0.25 && GAME_SPEEDS.join() === "0.5,1,2,3,5", `0.25× (key 0) below 0.5× 1× 2× 3× 5× (keys 1–5): ${SLOWEST_SPEED}, ${GAME_SPEEDS.join(" ")}`);
  check(KEYMAP.some((k) => k.id === "time.speed0" && /0\.25×/.test(k.label)) && keyAction({ code: "Digit0", key: "0", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, "map") === "time.speed0", "the key table: 0 is Speed 0.25× (rebindable)");
  const ui = readFileSync(new URL("../src/ui/ui.js", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/\[0\.25, "0\.25×"/.test(ui) && /time\.speed0/.test(main), "a 0.25× button in the top bar; main.js takes its key");
}

// ---------------------------------------------------------------------------------------------------------
// The main loop's clock (main.js) from acc0 until done() (checked each frame after the minute's arrivals and jobs):
// the hours on the clock it took, or null. frame(gone): called each frame.
function clockUntil(state, p, speed, acc0, done, { hours = 60, frame = null } = {}) {
  const ui = { started: true, speed };
  let acc = acc0, ticks = 0;
  for (let f = 0; f < hours * 1e5 && ticks < hours; f++) {
    acc += FRAME * speed * HOURS_PER_SECOND;
    while (acc >= 1) {
      setClockFrac(0);
      calm(state, p);
      beforeHour(state, ui);
      tickHour(state);
      calm(state, p);
      acc -= 1;
      ticks++;
    }
    setClockFrac(Math.min(0.999, acc));
    arrivalsDue(state, Math.min(0.999, acc), (q) => holdsNextHour(state, q));
    const gone = ticks + acc - acc0;
    if (frame) frame(gone, acc);
    if (done()) { setClockFrac(0); return gone; }
  }
  setClockFrac(0);
  return null;
}
// Where the map draws a team (in contact), in pixels (ui/render.js drawPlayerParty: the glide, else its tile).
function drawnPx(state, p, frac) {
  const g = state.grid;
  const gl = onTheMove(p) ? glideAt(state, p, frac, holdsNextHour(state, p)) : null;
  if (gl && gl.to !== gl.from && gl.t > 0) {
    const [ax, ay] = g.toPixel(gl.from, 1), [bx, by] = g.toPixel(gl.to, 1);
    return [ax + (bx - ax) * gl.t, ay + (by - ay) * gl.t];
  }
  return g.toPixel(partyTile(p), 1);
}
const pxDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const HEXPX = (state) => pxDist(state.grid.toPixel(0, 1), state.grid.toPixel(1, 1)); // a tile's width in pixels

section("Timed jobs ordered part-way through an hour end at their minute (rest, wait, look around)");
{
  let ran = 0, ok = 0, line = "";
  for (const [k, acc0] of [0.2, 0.55, 0.9].entries()) {
    for (const o of [{ type: "camp", hours: 3 }, { type: "wait", hours: 2 }, { type: "survey" }]) {
      const w = waitingTeam(SEED + 50 + k);
      if (!w) continue;
      const { state, p } = w;
      setClockFrac(acc0);
      startOrder(state, p, { ...o });
      const left0 = orderStatus(state, p).left - acc0;
      setClockFrac(0);
      if (p.phase !== "task") { line = `${o.type}: not started`; continue; }
      const want = p.task.hours;
      const took = clockUntil(state, p, 1, acc0, () => p.phase !== "task");
      ran++;
      if (took != null && Math.abs(took - want) < MIN && Math.abs(left0 - want) < MIN) ok++;
      line = `${o.type} ${want}h at ${acc0}: shown ${r2(left0)} h, took ${r2(took)} h`;
    }
  }
  check(ran > 0 && ok === ran, `a job's hours are its hours from the minute it was given, and its time left says so (${ok} of ${ran}; ${line})`);
  // Headless (the tools, the census): nothing changes, a job still ends as the hour ticks.
  const w = waitingTeam(SEED + 59);
  if (w) {
    const { state, p } = w;
    startOrder(state, p, { type: "camp", hours: 3 });
    let h = 0;
    while (p.phase === "task" && h < 10) { tickHour(state); calm(state, p); h++; }
    check(h === 3 && !p.task, `headless, a 3-hour rest still takes 3 ticks (${h})`);
  }
}

section("Convoys arrive at their minute too (no glide to the tile and a wait)");
{
  let ran = 0, ok = 0, line = "";
  for (let k = 0; k < 6 && ran < 3; k++) {
    const state = mk(SEED + 60 + k);
    const f = state.factions.find((x) => x.alive && x.bases.length);
    if (!f) continue;
    const crew = crewOf(state, 2).map((s) => s.id);
    const route = { id: 9000 + k, factionId: f.id, escortIds: crew, sendKey: "food", sendQty: 2, recvKey: "water", recvQty: 2, escort: "light", active: true };
    (state.routes = state.routes || []).push(route);
    dispatchConvoy(state, route);
    const p = state.parties.find((q) => q.kind === "convoy" && q.routeId === route.id);
    if (!p) continue;
    const want = hoursLeft(state, p, true), way = [...p.path];
    let reach = null;
    const took = clockUntil(state, p, 3, 0, () => p.phase !== "out" || !state.parties.includes(p), {
      frame: (gone, acc) => { if (reach == null && p.phase === "out" && drawnAt(state, p, way, acc, 0) >= way.length - 1 - 1e-6) reach = gone; },
    });
    if (took == null) continue;
    ran++;
    if (Math.abs(took - want) < MIN && (reach == null || reach >= took - 0.01)) ok++;
    line = `ETA ${r2(want)} h, arrived after ${r2(took)} h${reach != null ? `, glide there after ${r2(reach)} h` : ""}`;
  }
  check(ran > 0 && ok === ran, `a convoy arrives at the minute its glide gets there, as its ETA said (${ok} of ${ran}; ${line})`);
}

section("Out of contact: the map's estimate moves by the minute and arrives when the team does");
{
  let ran = 0, ok = 0, line = "";
  for (const [k, vehicle] of [false, true, false].entries()) {
    const state = mk(SEED + 70 + k); // no radio station: out of contact
    const v = vehicle ? vehiclesAtBase(state, hub(state).id).find((x) => !isBike(x)) : null;
    if (vehicle && !v) continue;
    if (v) { v.fuel = 60; v.condition = 100; }
    const dest = tileNear(state, hub(state).tile, 3, 5, vehicle);
    if (dest == null) continue;
    setClockFrac(0.35);
    const p = send(state, 2, dest, { vehicleId: v ? v.id : null });
    setClockFrac(0);
    const said = plannedArrival(state, p) - (state.hour + 0.35);
    let last = -1, back = 0, jump = 0, reach = null, lastPath = null;
    const took = clockUntil(state, p, 2, 0.35, () => p.phase !== "out", {
      frame: (gone, acc) => {
        const g = plannedPos(state, p, acc);
        if (lastPath && g.path !== lastPath && g.path.join() !== lastPath.join()) return;
        lastPath = g.path;
        if (last >= 0) { if (g.pos < last - 1e-9) back = Math.max(back, last - g.pos); else jump = Math.max(jump, g.pos - last); }
        last = g.pos;
        if (reach == null && g.pos >= g.path.length - 1 - 1e-9) reach = gone;
      },
    });
    if (took == null) continue;
    ran++;
    if (Math.abs(took - said) < MIN && back < 1e-9 && jump < 0.2 && (reach == null || Math.abs(reach - took) < 0.01)) ok++;
    line = `${vehicle ? "truck" : "foot"}: plan says ${r2(said)} h, the team took ${r2(took)} h, the estimate got there after ${r2(reach ?? took)} h (back ${r2(back)}, jump ${r2(jump)})`;
  }
  check(ran > 0 && ok === ran, `the estimate glides on smoothly and gets there at the team's minute (${ok} of ${ran}; ${line})`);
}

section("A team redirected on the move turns from where it is drawn (no snap back), on the ETA it was given");
{
  const cases = [
    { label: "on foot, back the way it came", opts: {}, pick: "home" },
    { label: "on foot, off to the side", opts: {}, pick: "side" },
    { label: "truck on a road, back the way it came", opts: { vehicle: true, road: true }, pick: "home" },
    { label: "truck, off to the side", opts: { vehicle: true }, pick: "side" },
  ];
  for (const c of cases) {
    let ran = 0, ok = 0, line = "";
    for (const [k, at] of [0.35, 0.7].entries()) {
      for (const s of [0, 1]) {
        const w = waitingTeam(SEED + 80 + k * 2 + s, c.opts);
        if (!w) continue;
        const { state, p } = w;
        const from = partyTile(p);
        const dest = tileNear(state, from, 4, 6, p.vehicle, c.opts.road ? allRoad(state) : () => true);
        if (dest == null) continue;
        menuMove(state, p, dest, 0);
        if (p.phase !== "out") continue;
        // Run on into the second hour (part-way along a step), then give the new way at that minute.
        let before = null, accAt = null;
        clockUntil(state, p, 1, 0, () => accAt != null, { frame: (gone, acc) => { if (gone >= 1 + at && accAt == null) { accAt = acc; before = drawnPx(state, p, acc); } } });
        if (accAt == null || p.phase !== "out") continue;
        const here = partyTile(p), next = p.path[p.idx + 1];
        const g = state.grid;
        const target = c.pick === "home" ? from : state.tiles.map((t) => t.id).find((id) => g.distance(here, id) === 2 && id !== dest && id !== from && state.tiles[id].terrain !== "water" && !state.bases.some((b) => b.tile === id) && planPath(state, here, id, p.vehicle) && planPath(state, here, id, p.vehicle).path[1] !== next);
        if (target == null) continue;
        const o = menuMove(state, p, target, accAt);
        setClockFrac(accAt);
        const after = drawnPx(state, p, accAt);
        setClockFrac(0);
        if (p.phase !== "out" || p.dest !== target) continue;
        let worst = 0, prev = after;
        const took = clockUntil(state, p, 1, accAt, () => p.phase !== "out", { frame: (gone, acc) => { const now = drawnPx(state, p, acc); worst = Math.max(worst, pxDist(now, prev)); prev = now; } });
        ran++;
        const snap = pxDist(before, after) / HEXPX(state);
        if (snap < 0.02 && worst / HEXPX(state) < 0.2 && took != null && Math.abs(took - o.shown) < MIN && partyTile(p) === target) ok++;
        line = `snap ${r2(snap)} tiles at the order, biggest step ${r2(worst / HEXPX(state))}, shown ${r2(o.shown)} h, took ${r2(took)} h`;
      }
    }
    check(ran > 0 && ok === ran, `${c.label}: no snap back, smooth, on its ETA (${ok} of ${ran}; ${line})`);
  }
}

section("Queued orders: the menu's 'after' and the queue's hours count from the real minutes");
{
  let ran = 0, ok = 0, line = "";
  for (const [k, acc0] of [0.3, 0.8].entries()) {
    for (const vehicle of [false, true]) {
      const w = waitingTeam(SEED + 90 + k * 2 + (vehicle ? 1 : 0), { vehicle });
      if (!w) continue;
      const { state, p } = w;
      const a = tileNear(state, partyTile(p), 2, 3, p.vehicle);
      if (a == null) continue;
      const b = tileNear(state, a, 2, 3, p.vehicle, (path) => !path.includes(partyTile(p)));
      if (b == null) continue;
      setClockFrac(acc0);
      queueOrder(state, p, { type: "move", tile: a }); // starts at once (it waits)
      queueOrder(state, p, { type: "move", tile: b });
      queueOrder(state, p, { type: "camp", hours: 2 });
      const left = orderStatus(state, p).left - acc0, q = queueEstimate(state, p);
      // The menu: queueing a move to b's neighbour says "after X" = all of that.
      const m = teamTileMenu(state, {}, p, b, { append: true });
      const camp = m.items.find((x) => x.move === false && x.ahead != null);
      setClockFrac(0);
      if (p.phase !== "out" || q.length !== 2 || q.some((x) => x.hours == null)) continue;
      const wantA = left, wantB = left + q[0].hours, wantEnd = wantB + q[1].hours;
      let gotA = null, gotB = null;
      const end = clockUntil(state, p, 2, acc0, () => p.phase === "waiting" && !(p.orders || []).length, {
        frame: (gone) => { if (gotA == null && partyTile(p) === a && p.dest !== a) gotA = gone; if (gotA == null && p.dest === b) gotA = gone; if (gotB == null && p.phase === "task") gotB = gone; },
      });
      ran++;
      const good = end != null && Math.abs(gotA - wantA) < MIN && Math.abs(gotB - wantB) < MIN && Math.abs(end - wantEnd) < MIN && (!camp || Math.abs(camp.ahead - wantEnd) < MIN);
      if (good) ok++;
      line = `${vehicle ? "truck" : "foot"} at ${acc0}: a ${r2(wantA)}/${r2(gotA)} h, b ${r2(wantB)}/${r2(gotB)} h, done ${r2(wantEnd)}/${r2(end)} h, menu after ${camp ? r2(camp.ahead) : "-"} h`;
    }
  }
  check(ran > 0 && ok === ran, `each queued order starts and ends at the minute the estimates said (${ok} of ${ran}; ${line})`);
}

section("Arriving in radio contact: a plain move raises no card, a log line instead");
{
  const state = mk();
  addBuilding(hub(state), "radio"); // a radio station at the hub: the team is in contact
  const dest = tileNear(state, hub(state).tile, 3, 4);
  const p = send(state, 2, dest);
  const res = drive(state, p, 3);
  check(p.phase === "waiting" && partyTile(p) === dest, `the team got there and waits (${p.phase})`);
  check(p.radioLive, "it is in radio contact there");
  check(!state.cards.some((c) => c.partyId === p.id), `no card about the team (${state.cards.filter((c) => c.partyId === p.id).map((c) => c.title).join("; ") || "none"})`);
  check(state.log.some((l) => /reached .* and waits for orders/.test(l.text) && l.text.startsWith(teamName(state, p))), "a log line says it got there");
  check(res.back < 1e-6, "and it was not drawn going back on the way");
  // The same order given where it stands (giveOrder: arrive at once), in contact: no card.
  giveOrder(state, p, "move");
  check(!state.cards.some((c) => c.partyId === p.id), "arriving again in contact: no card");
  // The autopilot answers the card itself (autopilot.js teamAct): it still gets one.
  state.autopilot = true;
  giveOrder(state, p, "move");
  state.autopilot = false;
  check(state.cards.some((c) => c.partyId === p.id && c.isOrders && !c.quietArrival), "under the autopilot: the orders card still comes");
  state.cards.length = 0;
  // A mission with a result (recon: what it spotted) keeps its card, and it pops up as before.
  giveOrder(state, p, "recon");
  const ui = { started: true, speed: 1 };
  pacingFrame(state, ui);
  check(state.cards.some((c) => c.partyId === p.id && c.isOrders && !c.quietArrival) && cardUp(state, ui), "a recon still reports with its card (and it stops the clock)");
}

section("Arriving out of radio range: orders reach it anyway (TEAM-01), so a plain move gets a log line, no card");
{
  const state = mk();
  const dest = tileNear(state, hub(state).tile, 3, 4);
  const p = send(state, 2, dest);
  const ui = { started: true, speed: 1 };
  drive(state, p, 3);
  pacingFrame(state, ui);
  const card = state.cards.find((c) => c.partyId === p.id && c.isOrders);
  check(!p.radioLive && p.phase === "waiting", `the team got there out of contact (no radio station) and waits (${p.phase})`);
  check(!card && !cardUp(state, ui) && commandable(state, p), `no orders card, nothing pops up, the clock runs, and it takes orders (${card ? card.title : "none"})`);
  for (let h = 0; h < 9; h++) { beforeHour(state, ui); tickHour(state); calm(state, p, card); pacingFrame(state, ui); }
  check(p.phase === "waiting" && !state.cards.some((c) => c.partyId === p.id && c.isOrders), "8 hours on it still waits quietly (no check-in cards)");
}

section("A card on the last tile (a surge of the dead: hide 4 hours) leaves the team on its destination: it still arrives");
{
  // Got there part-way through the hour (arrivalsDue: movedHour), the card met on the tile cut the move short before the
  // arrival, and once answered the team carries on at the end of its way with a delay owed: "0m left", never arriving.
  for (const how of ["minute", "tick"]) {
    const state = mk(SEED + 90);
    const dest = tileNear(state, hub(state).tile, 2, 3);
    const p = send(state, 2, dest);
    calm(state, p);
    p.idx = p.path.length - 1;
    p.progress = -4 * 0.9;
    p.movedHour = state.hour + 1;
    check(orderStatus(state, p).left === 0 && p.phase === "out", `${how}: on its destination, still out, 0m left (${p.phase})`);
    if (how === "minute") {
      setClockFrac(0.4);
      arrivalsDue(state, 0.4);
      setClockFrac(0);
      check(p.phase === "waiting", `at the next minute on the clock it arrives and waits (${p.phase})`);
    } else {
      tickHour(state);
      check(p.phase === "waiting", `headless, the hour's tick arrives it, moved that hour or not (${p.phase})`);
    }
  }
}

console.log(`\n${fails ? `${fails} failed, ` : ""}${passed} passed.`);
process.exit(fails ? 1 : 0);
