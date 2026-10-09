// Headless check of how your teams move on the State Map: the glide between tiles (sim/parties.js glideAt, drawn by
// ui/render.js drawPlayerParty) and the arrival of a plain move.
//  - The glide: the main loop's clock (main.js step: the minutes of the coming hour, an hour every 20 s at 1×) is
//    run frame by frame at 0.5×, 1×, 2× and 3× while a team crosses several tiles, and where the map draws the team
//    each frame is measured along its way: it must never go backward (no snap back to the tile it left, when it gets
//    somewhere before the hour is out or when the hour ticks), never jump ahead by much, and end on the destination.
//    On foot (normal, stealthy, rushed), by truck on a road and off it, on bikes, with road blockages
//    (sim/roadblocks.js: the team is held up where it met one), and held by a card waiting in the tray (ui/pacing.js
//    holdsNextHour: it does not glide at all).
//  - A plain move that got there raises no card (a log line instead) when the team can be reached without one; out of
//    contact, under the autopilot and for a mission with a result (recon) the card still comes.
// Usage: node tools/mapmovetest.js [seed]
import { createWorld, tickHour, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, planPath, partyTile, glideAt, giveOrder, teamName } from "../src/sim/parties.js";
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
const SPEEDS = [0.5, 1, 2, 3];

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

section("Arriving out of contact: the orders card is the only way to reach the team, so it comes, in the tray (no pop-up)");
{
  const state = mk();
  const dest = tileNear(state, hub(state).tile, 3, 4);
  const p = send(state, 2, dest);
  const ui = { started: true, speed: 1 };
  drive(state, p, 3);
  pacingFrame(state, ui);
  const card = state.cards.find((c) => c.partyId === p.id && c.isOrders);
  check(!p.radioLive && p.phase === "waiting", `the team got there out of contact (no radio station) and waits (${p.phase})`);
  check(card && card.quietArrival, `its orders card came (${card ? card.title : "none"})`);
  check(card && trayCards(state).includes(card) && !cardUp(state, ui), "it waits in the tray: nothing pops up, the clock runs");
  // Left there, it opens by itself instead of taking "Hold here" (that would leave the team out of reach).
  for (let h = 0; h < 9; h++) { beforeHour(state, ui); tickHour(state); calm(state, p, card); pacingFrame(state, ui); }
  check(state.cards.includes(card) && card.tray.kind === "always" && cardUp(state, ui), "left 8 hours, it opens (the team is still reachable)");
}

console.log(`\n${fails ? `${fails} failed, ` : ""}${passed} passed.`);
process.exit(fails ? 1 : 0);
