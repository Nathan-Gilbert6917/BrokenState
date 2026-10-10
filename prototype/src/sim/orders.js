// Team orders that take time, and the order queue. A team works through its queue one order at a time:
// move, look around, camp, field repairs, treating someone, a mission on the spot, or going home.
// When an order finishes and nothing else is queued, the team reports in with an orders card
// (parties.js awaitOrders), which doubles as the "done, what next?" notice.
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { log, survivorById, baseById, hub } from "./world.js";
import {
  MISSIONS, partyMembers, partyTile, tileLabel, teamName, bestSkill, orderMove, giveOrder, startReturn, awaitOrders,
  survey, orderOptions, planPath, travelHours, hoursLeft, partySpeed, carried, takeSupply, starving, paceOpts, modeSpeed, cargoRoom, pitchHoursFor, pitchDone,
} from "./parties.js";
import { SUPPLIES } from "./data.js";
import { partyVehicle, partyVehicles, partyFuel } from "./vehicles.js";
import { fieldTreat, fieldTreatInfo, FIELD_TREAT_HOURS, BASE_HEAL_PER_DAY, isHurt } from "./medical.js";
import { boatPlan, launchBoat, landBoat, gatherMaterials, gatherProblem, GATHER_HOURS } from "./crossing.js";
import { fieldCraftOptions, fieldCraft } from "./crafting.js";
import { estimatePlan, startNearby } from "./plans.js";
import { startSearchArea } from "./crashes.js";
import { finishFixCar } from "./foundcars.js"; // a found vehicle repaired on the spot
import { startSweep, sweepHour, sweepDone, sweepOpts, sweepEstimate, routeFuel } from "./survey.js";
import { fireLit, FIRE } from "./fieldheat.js";
import { HUNT, huntProblem, huntHour, huntSummary, fishProblem, fishHour, fishSummary, snareProblem, snareWork, snareMode, snareHours } from "./hunting.js";
import { forageProblem, forageHour, forageSummary, campForageHour, campForageNote } from "./foraging.js";
import { healMult } from "./traits.js"; // Quick Healer
import { sourceEggs, addWormWater, teamWaterHow, wormHealMult } from "./worm.js";
import { woodProblem, woodHour, woodSummary, campFireHour } from "./woodcutting.js";
import { CLAIM, canClaim, claimTile, wellProblem, digWell } from "./claims.js"; // land claims and wells on them
import { LISTEN, listenProblem, listenIn } from "./radiolisten.js"; // Listen in: tune a receiver to a radio network
import { networkById } from "./radio.js";
import { capTask, holdName, COLLECT } from "./carry.js"; // a quantity to collect (o.qty: the team panel asks)

export const REPAIR_HOURS = 3;   // a roadside repair
export const FETCH_WATER_HOURS = 2; // Fetch water: filling containers at a river or lake
export const SURVEY_HOURS = 2;   // Look around
// (The timed Camp order left the panels on 2026-10-09: Set up camp makes a camp, a base, staging.js. "camp" stays an
// internal rest task for the governor's night stops, caravans, conflicts and plans' rest steps.)

// What a queued or running order is called in the panels and the log.
export function describeOrder(state, o) {
  switch (o.type) {
    case "move": return `Move to ${tileLabel(state, o.tile)}`;
    case "mission": return MISSIONS[o.mission]?.name || o.mission;
    case "camp": return o.hours ? `Camp ${o.hours}h` : "Camp (until broken)";
    case "repair": return "Repair vehicle";
    case "fixcar": return "Repair a found vehicle"; // foundcars.js
    case "treat": { const s = survivorById(state, o.survivorId); return `Treat ${s ? s.name.split(" ")[0] : "someone"}`; }
    case "survey": return "Look around";
    case "sweep": { const s = sweepOpts(o); return o.done != null ? `Surveying: ${o.done} of ${s.hours} hours, ${(o.found || []).length} place${(o.found || []).length === 1 ? "" : "s"} found` : `Survey ${s.radius} tiles around, ${s.hours}h`; }
    case "home": return "Return home";
    case "cross": return `Build a boat, cross to ${tileLabel(state, o.tile)}${o.mode === "leave" ? " (leave the vehicle)" : o.mode === "raft" ? " (raft the vehicle)" : ""}`;
    case "gather": return "Gather boat materials";
    case "water": return `Fetch water${o.qty != null ? ` (${o.qty})` : ""}`;
    case "craft": return `Craft: ${fieldCraftOptions(state, null).find((x) => x.key === o.recipe)?.name || o.recipe}`;
    case "nearby": return `Scavenge the best site within ${o.radius || 3} tiles${(o.count || 1) > 1 ? ` (×${o.count})` : ""}`;
    case "wait": return `Wait ${o.hours}h`;
    case "stage": return "Work on the staging camp"; // staging.js: until it is done or the materials run out
    case "searcharea": return "Search the area for the wreck";
    case "crewsearch": return "Scavenge"; // a crew's own search (crews.js)
    case "hunt": return `Hunt ${huntHours(o)}h${qtyNote(o)}`;
    case "fish": return `Fish ${huntHours(o)}h${qtyNote(o)}`;
    case "forage": return `Forage ${huntHours(o)}h${qtyNote(o)}`; // foraging.js
    case "wood": return `Cut wood ${huntHours(o)}h${qtyNote(o)}`; // woodcutting.js
    case "snare": return o.mode === "lift" ? "Check and lift the snares" : o.mode === "check" ? "Check the snares" : o.mode === "set" ? "Set snares" : "Snares: set, or check them";
    case "claim": return "Claim this tile"; // claims.js: a marker post, the land counts for the coalition
    case "pitch": return o.mission === "outpost" ? "Set up the outpost camp" : "Set up camp"; // staging.js pitchArrive (buildings.js CAMP.setupHours); then the camp stands (pitchDone)
    case "well": return "Dig a well"; // claims.js: on a claim next to one of your bases
    case "listen": { const n = o.net != null ? networkById(state, o.net) : null; return `Listen in${n ? ` on ${n.name}` : ""}`; } // radiolisten.js
  }
  return o.type;
}

// A collecting order with a quantity (carry.js): ", at most 20 fresh game".
const qtyNote = (o) => (o.qty != null && COLLECT[o.type] ? `, at most ${o.qty} ${holdName(COLLECT[o.type])}` : "");

// The order the team is busy with right now.
export function orderLabel(state, p) {
  if (p.phase === "task" && p.task) return describeOrder(state, p.task);
  if (p.phase === "back") return "Return home";
  if (p.phase === "waiting") return "Waiting for orders";
  if (p.phase === "holding") return "Holding";
  const m = MISSIONS[p.mission]?.name || "Team";
  if (p.phase === "out") return p.mission === "move" ? `Move to ${tileLabel(state, p.dest)}` : `${m} at ${tileLabel(state, p.dest)}`;
  return m;
}

export const queueText = (state, p) => (p.orders || []).map((o) => describeOrder(state, o)).join(" → ");

// Teams you can give orders to: waiting or working on the spot (you know where they are), or in radio range.
export const contactable = (p) => p.owner === "player" && p.kind !== "convoy" && (p.phase === "waiting" || p.phase === "task" || p.radioLive);

// Status of the current order for the panels: label, hours left (null = open-ended) and share done.
export function orderStatus(state, p) {
  const label = orderLabel(state, p);
  let left = null, elapsed = 0;
  if (p.phase === "task" && p.task) {
    elapsed = p.task.done;
    left = p.task.hours != null ? Math.max(0, p.task.hours - p.task.done) : null;
  } else if (p.phase === "out" || p.phase === "back") {
    left = hoursLeft(state, p);
    elapsed = Math.max(0, state.hour - (p.orderStart ?? p.departed ?? state.hour));
  } else if (p.phase === "waiting") left = 0;
  const pct = left == null ? null : elapsed + left > 0 ? elapsed / (elapsed + left) : 1;
  return { label, left, elapsed, pct };
}

// Hour estimates for every queued order, chained from where the current order ends.
// Travel uses the same stepping as real movement (travelHours); missions on the spot have no fixed time.
export function queueEstimate(state, p) {
  const sw = p.phase === "task" && p.task && p.task.type === "sweep" ? p.task : null; // a survey ends at its centre (survey.js)
  let tile = sw ? sw.center : p.dest ?? partyTile(p);
  let vehicle = p.vehicle || false;
  let fuel = vehicle === true ? partyFuel(state, p) - (sw ? routeFuel(state, sw.route.slice(sw.done), true, paceOpts(p).fuelMult) : 0) : 0;
  if (p.phase === "task" && p.task?.type === "cross" && p.task.mode === "leave" && !p.task.afloat) { vehicle = false; fuel = 0; }
  // A road delay still owed (negative progress, e.g. from a card on the last step) is paid by the next move.
  let owed = Math.min(0, p.progress || 0);
  // at: the hour each queued order starts (weather sets travel times by the hour, weather.js).
  let at = state.hour + (p.phase === "task" && p.task?.hours != null ? Math.max(0, p.task.hours - p.task.done) : 0);
  let left = p.progress || 0; // progress left over on arrival (a recon spends it first)
  if ((p.phase === "out" || p.phase === "back") && p.path && p.idx < p.path.length - 1) {
    const cur = travelHours(state, p.path.slice(p.idx), { vehicle, ...paceOpts(p), speed: modeSpeed(p, vehicle), progress: p.progress, fuel });
    at += cur.hours;
    tile = p.path[p.path.length - 1];
    vehicle = cur.vehicle;
    fuel = cur.fuelLeft;
    owed = 0;
    left = cur.progress;
  }
  // A recon on arrival spends two hours looking around, paid by the next move (parties.js survey).
  if (p.phase === "out" && p.mission === "recon") owed = Math.min(0, left - 2 * modeSpeed(p, vehicle));
  // A Survey mission on arrival: its hours (and a car's fuel) before the queue (survey.js).
  if (p.phase === "out" && p.mission === "sweep") {
    const sw = sweepEstimate(state, { ...sweepOpts(p.sweepPlan || {}), center: tile, mode: vehicle, stance: p.stance, fuelMult: paceOpts(p).fuelMult });
    at += sw.hours;
    if (vehicle === true) fuel = Math.max(0, fuel - sw.fuel);
  }
  return (p.orders || []).map((o) => {
    let hours = null;
    if (o.type === "move") {
      const res = planPath(state, tile, o.tile, vehicle);
      if (res) {
        const t = travelHours(state, res.path, { vehicle, ...paceOpts(p), speed: modeSpeed(p, vehicle), fuel, progress: owed, startHour: at });
        owed = 0;
        hours = t.hours;
        vehicle = t.vehicle;
        fuel = t.fuelLeft;
        tile = o.tile;
      }
    } else if (o.type === "camp") hours = o.hours;
    else if (o.type === "repair") hours = REPAIR_HOURS;
    else if (o.type === "treat") hours = FIELD_TREAT_HOURS;
    else if (o.type === "mission" && o.mission === "survey") hours = SURVEY_HOURS;
    else if (o.type === "mission" && pitchHoursFor(state, o.mission)) hours = pitchHoursFor(state, o.mission); // pitching a camp (parties.js)
    else if (o.type === "sweep" || (o.type === "mission" && o.mission === "sweep")) {
      const sw = sweepEstimate(state, { ...sweepOpts(o.type === "sweep" ? o : p.sweepPlan || {}), center: tile, mode: vehicle, stance: p.stance, fuelMult: paceOpts(p).fuelMult });
      hours = sw.hours;
      if (vehicle === true) fuel = Math.max(0, fuel - sw.fuel);
    }
    else if (o.type === "gather") hours = GATHER_HOURS;
    else if (o.type === "water") hours = FETCH_WATER_HOURS;
    else if (o.type === "hunt" || o.type === "fish" || o.type === "forage" || o.type === "wood") hours = huntHours(o);
    else if (o.type === "snare") hours = snareHours(state, o.at ?? tile, o.mode);
    else if (o.type === "claim") hours = CLAIM.HOURS;
    else if (o.type === "well") hours = CLAIM.WELL_HOURS;
    else if (o.type === "listen") hours = LISTEN.HOURS;
    else if (o.type === "craft") hours = fieldCraftOptions(state, p).find((x) => x.key === o.recipe)?.hours ?? null;
    else if (o.type === "wait") hours = o.hours;
    else if (o.type === "nearby") {
      // The sites the team would pick from here now (plans.js); the real pick happens when the step starts.
      const r = estimatePlan(state, { memberIds: p.members, dest: tile, vehicle, stance: p.stance, fuel, mission: "move", steps: [{ kind: "nearby", radius: o.radius, count: o.count, center: o.center }], homeBaseId: p.homeBaseId, from: tile, startHour: at, p });
      if (r) { hours = r.hours; tile = r.endTile; vehicle = r.vehicle; fuel = r.fuelLeft; owed = 0; }
    }
    else if (o.type === "home") {
      // The way home from where the queue leaves the team, planned like startReturn does (on foot if the
      // vehicle has no road home). No estimate when water cuts the team off.
      const home = baseById(state, p.homeBaseId) || hub(state);
      let res = home ? planPath(state, tile, home.tile, vehicle) : null; // no base left (conquest.js exiles): no way home
      if (!res && vehicle && home) { res = planPath(state, tile, home.tile, false); vehicle = false; fuel = 0; }
      if (res) {
        const t = travelHours(state, res.path, { vehicle, ...paceOpts(p), speed: modeSpeed(p, vehicle), fuel, progress: owed, startHour: at });
        owed = 0;
        hours = t.hours;
        vehicle = t.vehicle;
        fuel = t.fuelLeft;
        tile = home.tile;
      }
    } else if (o.type === "cross") {
      // Build and crossing hours were fixed when the order was given; the team ends up across the water.
      hours = o.build + o.cross;
      tile = o.tile;
      if (o.mode === "leave") { vehicle = false; fuel = 0; }
    }
    at += hours ?? 0;
    return { order: o, label: describeOrder(state, o), hours };
  });
}

// Where the team will be once its current and queued moves are done (start of a queued move).
export function queueEndTile(state, p) {
  const moves = (p.orders || []).filter((o) => o.type === "move" || o.type === "cross");
  return moves.length ? moves[moves.length - 1].tile : p.dest ?? partyTile(p);
}

// ---------- giving orders ----------
// Start now if the team is waiting for orders, otherwise add it to the end of the queue.
export function queueOrder(state, p, o) {
  p.orders = p.orders || [];
  if (p.phase === "waiting") return startOrder(state, p, o);
  // A queued job on the spot remembers the tile it was planned for (where the queue leaves the team): if the
  // team ends up somewhere else (stopped on the way, redirected), the job fails with a message instead of
  // running on the wrong tile.
  if (PLACED.includes(o.type) && o.at == null) o = { ...o, at: queueEndTile(state, p) };
  p.orders.push(o);
  return `Queued: ${describeOrder(state, o)} (after ${p.orders.length === 1 ? "the current order" : `${p.orders.length - 1} more`}).`;
}

export function removeQueued(state, p, i) {
  if (!p.orders || i < 0 || i >= p.orders.length) return "";
  const [o] = p.orders.splice(i, 1);
  reseatQueue(state, p);
  return `Removed from the queue: ${describeOrder(state, o)}.`;
}

// Reorder the queue: the order at `from` moves to position `to` (both 0-based within the queue; the team panel's
// arrows and drag and drop). Jobs on the spot are tied again to the tile where the moves now before them leave
// the team (their `at`, see queueOrder), so a scavenge dragged behind another move runs at that move's end.
export function reorderQueued(state, p, from, to) {
  const n = (p.orders || []).length;
  if (from < 0 || from >= n || to < 0 || to >= n) return "";
  if (from === to) return "";
  const [o] = p.orders.splice(from, 1);
  p.orders.splice(to, 0, o);
  reseatQueue(state, p);
  return `${describeOrder(state, o)}: now ${ordinal(to + 1)} in the queue.`;
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

// After the queue changed shape: every job on the spot is planned for the tile the queue reaches before it
// (the same walk as queueEndTile: moves and crossings set the tile, going home ends at the base).
function reseatQueue(state, p) {
  let tile = p.dest ?? partyTile(p);
  for (const o of p.orders || []) {
    if (o.type === "move" || o.type === "cross") tile = o.tile;
    else if (o.type === "home") { const home = baseById(state, p.homeBaseId) || hub(state); if (home) tile = home.tile; }
    else if (PLACED.includes(o.type)) o.at = tile;
  }
}

// Cancel the move under way (the team panel's ✕ on the "Now" line of the queue): the team stops on the tile it
// has reached and carries on with its queue from there (a job planned for the old destination fails with a
// message and holds the rest), or waits for orders. Unlike a stop on the way (a card), the trip is not put back.
export function cancelMove(state, p) {
  if (p.phase !== "out" && p.phase !== "back") return "The team is not on the move.";
  const was = orderLabel(state, p);
  const tile = partyTile(p);
  p.dest = tile; // stopped here on purpose: awaitOrders treats the order as finished here (no requeue of the trip)
  p.mission = "move";
  awaitOrders(state, p, `${was} cancelled: the team stops at ${tileLabel(state, tile)}.`, { failed: true });
  return `${was} cancelled. The team stops at ${tileLabel(state, tile)}${(p.orders || []).length || p.phase !== "waiting" ? "" : " and waits for orders"}.`;
}

// Pick the queue back up after the team was stopped on the way.
export function resumeQueue(state, p) {
  if (!p.orders || !p.orders.length) return "Nothing queued.";
  const o = p.orders.shift();
  return startOrder(state, p, o);
}

// Called by awaitOrders when the current order finished where it was meant to: run the next one.
export function continueQueue(state, p, text) {
  if (!p.orders || !p.orders.length) return false;
  const o = p.orders.shift();
  if (text) log(state, `${teamName(state, p)}: ${text}`, "info");
  log(state, `${teamName(state, p)}: next order, ${describeOrder(state, o)}.`, "info");
  startOrder(state, p, o);
  return true;
}

const PLACED = ["mission", "survey", "gather", "water", "hunt", "fish", "forage", "wood", "snare", "claim", "well"]; // order types tied to the tile they were queued for
// Hours of a hunt, fishing or foraging order: as given, within 2–24 (8 if none).
export const huntHours = (o) => Math.max(HUNT.minHours, Math.min(HUNT.maxHours, Math.round(o.hours || HUNT.defHours)));

// Starts an order right away. If it cannot start, the team reports back (and the queue moves on).
export function startOrder(state, p, o) {
  // An orders card still open for this team is out of date now.
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].isOrders && state.cards[i].partyId === p.id) state.cards.splice(i, 1);
  // hold: the rest of the queue waits too (the team is in the wrong place for it).
  const fail = (msg, hold = false) => {
    if (p.phase === "waiting") awaitOrders(state, p, msg, { failed: true, hold });
    return msg;
  };
  // A boat already on the water cannot be called back: the order waits until the team lands.
  if (p.phase === "task" && p.task?.afloat) {
    p.orders = p.orders || [];
    p.orders.unshift(o);
    return `On the water; after landing: ${describeOrder(state, o)}.`;
  }
  // Planned for another tile (the team was stopped or redirected before it got there): not here.
  // The order is dropped and the rest of the queue waits for the player.
  if (o.at != null && o.at !== partyTile(p) && PLACED.includes(o.type)) {
    return fail(`${describeOrder(state, o)} was planned for ${tileLabel(state, o.at)}, but the team is at ${tileLabel(state, partyTile(p))}: not done.${(p.orders || []).length ? " The rest of the queue is on hold." : ""}`, true);
  }
  if (o.type !== "move" && p.phase === "task") p.task = null; // switching jobs on the spot
  switch (o.type) {
    case "move": {
      const msg = orderMove(state, p, o.tile);
      return p.phase === "out" && p.dest === o.tile ? msg : fail(msg);
    }
    case "mission": {
      const opt = orderOptions(state, p).find((x) => x.mission === o.mission);
      if (!opt || opt.disabled) return fail(`${MISSIONS[o.mission]?.name || o.mission}: ${opt ? opt.disabled : "not possible here"}.`);
      return giveOrder(state, p, o.mission) || `${teamName(state, p)}: ${MISSIONS[o.mission].name}.`;
    }
    case "survey":
      return startOrder(state, p, { type: "mission", mission: "survey" });
    case "sweep":
      // A survey around where the team stands (survey.js): the queue's Survey step, the team panel, the right-click menu.
      if (state.tiles[partyTile(p)].terrain === "water" && !state.tiles[partyTile(p)].bridge) return fail("Survey: not from the water.");
      return startSweep(state, p, o);
    case "camp":
      if (o.fire != null) p.campFire = !!o.fire; // the camp fire (fieldheat.js): lit unless told otherwise
      startTask(state, p, { type: "camp", hours: o.hours ?? null });
      return `The team makes camp${o.hours ? ` for ${o.hours} hours` : " until you break it"}${fireLit(p) ? "" : ", without a fire"}.`;
    case "repair": {
      const r = repairInfo(state, p);
      if (!r.ok) return fail(`Repair: ${r.reason}`);
      startTask(state, p, { type: "repair", hours: REPAIR_HOURS });
      return `Working on the ${r.v.name} (${REPAIR_HOURS}h, about +${r.gain}%).`;
    }
    case "treat": {
      const s = survivorById(state, o.survivorId);
      const info = fieldTreatInfo(state, p, s);
      if (!info.ok) return fail(`Treat: ${info.reason}`);
      startTask(state, p, { type: "treat", survivorId: o.survivorId, hours: info.hours || FIELD_TREAT_HOURS });
      return `Treating ${s.name.split(" ")[0]} (${info.hours || FIELD_TREAT_HOURS}h).`;
    }
    case "home":
      // A failure text when the team cannot leave (cut off by water: it waits with a "Cannot go home" card).
      return startReturn(state, p) || "The team heads home.";
    case "craft": {
      // Field crafting (crafting.js): the hours pass first, then the item is made from the team's supplies.
      const opt = fieldCraftOptions(state, p).find((x) => x.key === o.recipe);
      if (!opt || !opt.ok) return fail(`Craft: ${opt ? opt.reason : "not possible in the field"}.`);
      startTask(state, p, { type: "craft", recipe: o.recipe, hours: opt.hours });
      return `Crafting ${opt.name.toLowerCase()} (${opt.hours}h).`;
    }
    case "nearby":
      // Scavenge the best site within reach (plans.js): picked now, from what the team knows.
      return startNearby(state, p, o);
    case "searcharea":
      // Look around the crash circle until the wreck turns up, then search it (crashes.js).
      return startSearchArea(state, p, o);
    case "wait":
      startTask(state, p, { type: "wait", hours: Math.max(1, o.hours || 6) });
      return `The team waits here for ${Math.max(1, o.hours || 6)} hours.`;
    case "gather": {
      // Only on a shore with land across the water, and only while there is something left to find there.
      const why = gatherProblem(state, partyTile(p));
      if (why) return fail(`Gather materials: ${why}`);
      startTask(state, p, { type: "gather", hours: GATHER_HOURS });
      return `The team searches the shore for boat materials (${GATHER_HOURS}h).`;
    }
    case "water": {
      // Only on a tile next to a river or lake: every free container is filled (cargo room, by weight).
      if (!besideWater(state, partyTile(p))) return fail("Fetch water: only on a tile next to a river or lake.");
      startTask(state, p, { type: "water", hours: FETCH_WATER_HOURS, qty: o.qty });
      return `The team fills every container it has with water (${FETCH_WATER_HOURS}h).`;
    }
    case "hunt": {
      const why = huntProblem(state, p);
      if (why) return fail(`Hunt: ${why}`);
      startTask(state, p, { type: "hunt", hours: huntHours(o), qty: o.qty });
      return `The team goes hunting (${huntHours(o)}h).`;
    }
    case "fish": {
      const why = fishProblem(state, p);
      if (why) return fail(`Fish: ${why}`);
      startTask(state, p, { type: "fish", hours: huntHours(o), qty: o.qty });
      return `The team goes fishing (${huntHours(o)}h).`;
    }
    case "forage": {
      // Wild food off the land (foraging.js): berries, nuts, mushrooms, greens, roots, by the terrain and the season.
      const why = forageProblem(state, p);
      if (why) return fail(`Forage: ${why}`);
      startTask(state, p, { type: "forage", hours: huntHours(o), qty: o.qty });
      return `The team goes foraging (${huntHours(o)}h).`;
    }
    case "wood": {
      // Firewood for the winter (woodcutting.js): by the land, the tools and the people.
      const why = woodProblem(state, p);
      if (why) return fail(`Cut wood: ${why}`);
      startTask(state, p, { type: "wood", hours: huntHours(o), qty: o.qty });
      return `The team cuts wood (${huntHours(o)}h).`;
    }
    case "snare": {
      const mode = snareMode(state, partyTile(p), o.mode);
      const why = snareProblem(state, p, partyTile(p), mode);
      if (why) return fail(`Snares: ${why}`);
      const hours = snareHours(state, partyTile(p), mode);
      startTask(state, p, { type: "snare", mode, hours });
      return mode === "set" ? `The team sets a line of snares (${hours}h).` : `The team checks the snares (${hours}h).`;
    }
    case "claim": {
      // A marker post on this tile (claims.js): it must border land you hold; the scrap is taken when the post is up.
      const why = canClaim(state, partyTile(p));
      if (why) return fail(`Claim this tile: ${why}`);
      if (carried(p, "scrap") < CLAIM.SCRAP) return fail(`Claim this tile: needs ${CLAIM.SCRAP} scrap carried for the marker post (have ${Math.floor(carried(p, "scrap"))}).`);
      startTask(state, p, { type: "claim", hours: CLAIM.HOURS });
      return `The team paces out the tile and raises a marker post (${CLAIM.HOURS}h, ${CLAIM.SCRAP} scrap).`;
    }
    case "well": {
      // A well on a claim of yours next to one of your bases (claims.js): the yield by the ground, 24 hours of digging.
      const why = wellProblem(state, p, partyTile(p));
      if (why) return fail(`Dig a well: ${why}`);
      startTask(state, p, { type: "well", hours: CLAIM.WELL_HOURS });
      return `The team starts digging a well (${CLAIM.WELL_HOURS}h, ${CLAIM.WELL_SCRAP} scrap and ${CLAIM.WELL_PARTS} part when it is done).`;
    }
    case "listen": {
      // Tune the team's receiver to a radio network whose coverage it stands in (radiolisten.js); an hour at the set.
      const why = listenProblem(state, p, false, o.net ?? null);
      if (why) return fail(`Listen in: ${why}`);
      startTask(state, p, { type: "listen", net: o.net ?? null, hours: LISTEN.HOURS });
      return `The team cranks up the radio and listens in (${LISTEN.HOURS}h).`;
    }
    case "cross": {
      const from = partyTile(p);
      const plan = boatPlan(state, p, from, o.tile, o.mode);
      if (!plan.crossing) return fail(`Boat: ${plan.reason}`);
      // Use the hours and materials fixed when the order was given (the queue estimate counted on them),
      // unless the team's vehicle changed since (gained or lost one): then the boat is planned again.
      const same = !o.mode || o.mode === plan.mode;
      const mats = (same && o.mats) || plan.mats;
      const short = Object.entries(mats).filter(([k, q]) => plan.have[k] < q);
      if (short.length) return fail(`Boat: needs ${short.map(([k, q]) => `${q} ${keyWord(k)} (have ${plan.have[k]})`).join(", ")}. Gather materials on the shore or bring scrap.`);
      if (!plan.ok && !Object.keys(plan.missing).length) return fail(`Boat: ${plan.reason}`);
      const build = (same ? o.build : null) ?? plan.build, cross = (same ? o.cross : null) ?? plan.cross;
      startTask(state, p, { type: "cross", tile: o.tile, from, mode: plan.mode, mats, build, cross, hours: build + cross, risk: plan.risk });
      p.dest = o.tile; // finished only once the team stands on the far shore (a stop or failure keeps the queue on hold)
      return `Building a boat to cross to ${tileLabel(state, o.tile)} (${build}h, then ${cross}h on the water).`;
    }
  }
  return "";
}

// Fetch water: on a land tile next to a river or lake, the team fills what it can carry (its cargo room, water
// weighs 1 kg; a haul limit set for the team counts) and brings it home like any find. Rivers and lakes do not run dry.
// It is un-purified water (water.js): the base purifies it (its boiler, filters), the team boils it at a camp fire,
// filters it or drops purification tablets in (worm.js drinkHour).
export const besideWater = (state, tile) => state.tiles[tile] && state.tiles[tile].terrain !== "water" && state.grid.neighbors(tile).some((id) => state.tiles[id] && state.tiles[id].terrain === "water");
export function fetchWater(state, p) {
  const units = Math.floor(cargoRoom(state, p) / SUPPLIES.rawwater.weight);
  if (units < 1) return "No room left to carry any water.";
  p.cargo.supplies.rawwater = (p.cargo.supplies.rawwater || 0) + units;
  // worm.js: river water on infected land carries the worm's eggs (a filter carried, a camp fire or tablets make it safe).
  const eggs = sourceEggs(state, partyTile(p));
  addWormWater(state, p, units, eggs);
  const how = teamWaterHow(state, p);
  const land = eggs > 0 ? "The land here is infected" : "Even from clean ground un-purified water can carry the worm";
  const worm = how === "filter" ? ` ${land}, but the team's water filter strains it.` : how === "fire" ? ` ${land}: the camp fire boils it.` : how === "tabs" ? ` ${land}: the team drops purification tablets in before drinking it.` : ` ${land}: boil it at a camp fire (or filter it) before drinking it.`;
  return `Filled the containers: ${units} un-purified water to carry home.${worm}`;
}

// Work on the spot: the team stays on its tile until the task is done (or you stop it).
export function startTask(state, p, task) {
  const tile = partyTile(p);
  p.phase = "task";
  p.path = [tile];
  p.idx = 0;
  p.progress = Math.min(0, p.progress);
  p.dest = tile;
  p.task = { ...task, done: 0 };
  if (p.task.qty == null) delete p.task.qty;
  else capTask(p, p.task); // carry.js: stop collecting at the quantity asked (parties.js cargoRoom)
  p.orderStart = state.hour;
}

// Hourly, from playerPartyHour.
export function taskHour(state, p) {
  const t = p.task;
  if (!t) return awaitOrders(state, p, "", { failed: true });
  t.done += 1;
  if (t.type === "camp") campHour(state, p);
  if (t.type === "sweep") sweepHour(state, p); // survey.js: move on, look, roll for finds
  if (!state.parties.includes(p) || p.task !== t) return;
  // Hunting, fishing and foraging roll every hour (hunting.js, foraging.js); with nothing left to do it with, the job ends early.
  if ((t.type === "hunt" && !huntHour(state, p)) || (t.type === "fish" && !fishHour(state, p)) || (t.type === "forage" && !forageHour(state, p)) || (t.type === "wood" && !woodHour(state, p))) {
    if (state.parties.includes(p)) finishTask(state, p);
    return;
  }
  if (t.type === "cross" && !t.afloat && t.done >= t.build) {
    const err = launchBoat(state, p);
    if (err) return awaitOrders(state, p, err, { failed: true });
  }
  if (!state.parties.includes(p)) return;
  if (t.hours != null && t.done >= t.hours) finishTask(state, p);
}

// Stop the current task now (break camp, or give up on a repair/treatment before it is done).
export function stopTask(state, p) {
  if (p.phase !== "task" || !p.task) return "The team is not working on anything here.";
  if (p.task.type === "camp") return finishTask(state, p);
  if (p.task.type === "cross" && p.task.afloat) return "The boat is already on the water.";
  const label = describeOrder(state, p.task);
  awaitOrders(state, p, `${label} stopped.`, { failed: true }); // stopped, not done
  return `${label} stopped.`;
}

function finishTask(state, p) {
  const t = p.task;
  let text = "";
  if (t.type === "pitch") { p.task = null; pitchDone(state, p); return ""; } // parties.js: the camp stands (or the card says why not)
  if (t.type === "survey") text = survey(state, p, 0.25, false);
  else if (t.type === "sweep") text = sweepDone(state, p);
  else if (t.type === "camp") text = `Broke camp after ${t.done} hour${t.done === 1 ? "" : "s"} of rest. ${healthLine(state, p)}${campForageNote(state, p, t)}`;
  else if (t.type === "repair") text = fieldRepair(state, p);
  else if (t.type === "fixcar") text = finishFixCar(state, p, t); // foundcars.js: the Mechanics check, the parts
  else if (t.type === "treat") text = fieldTreat(state, p, t.survivorId);
  else if (t.type === "gather") text = gatherMaterials(state, p, partyTile(p));
  else if (t.type === "water") text = fetchWater(state, p);
  else if (t.type === "craft") text = fieldCraft(state, p, t.recipe);
  else if (t.type === "wait") text = `Waited ${t.done} hour${t.done === 1 ? "" : "s"}.`;
  else if (t.type === "cross") text = landBoat(state, p);
  else if (t.type === "hunt") text = huntSummary(state, p, t);
  else if (t.type === "fish") text = fishSummary(state, p, t);
  else if (t.type === "forage") text = forageSummary(state, p, t);
  else if (t.type === "wood") text = woodSummary(state, p, t);
  else if (t.type === "snare") text = snareWork(state, p, t.mode);
  else if (t.type === "claim") text = claimTile(state, p, partyTile(p)); // claims.js (checked again now: it may have been taken meanwhile)
  else if (t.type === "well") text = digWell(state, p, partyTile(p));
  else if (t.type === "listen") text = listenIn(state, p, t.net, false).text; // radiolisten.js: tuned, and the last few days caught up
  awaitOrders(state, p, text); // keeps p.task until then, so the card can say what finished
  return text;
}

const healthLine = (state, p) => `Health: ${partyMembers(state, p).map((m) => `${m.name.split(" ")[0]} ${Math.floor(m.health)}`).join(", ")}.`;

// Resting in camp: the hurt heal at twice the rate of a base without a hospital, spirits lift a little.
// An infected wound does not heal in camp (it needs meds); anyone with the worm in them heals at half the rate (worm.js). A camp with no food or no water gives no rest:
// nobody heals and nobody cheers up until the team eats and drinks again (parties.js consume). In daylight the fit
// forage around the camp, part of each hour (foraging.js campForageHour): a hungry camp feeds itself a little.
export const campHealPerHour = (state, p, s) => (isHurt(s) && !s.woundInfected && !starving(p) ? ((BASE_HEAL_PER_DAY * 2 + bestSkill(state, p, "medicine") * 0.4) / 24) * wormHealMult(s) * healMult(s) : 0); // Quick Healer (traits.js)
// The camp fire (fieldheat.js FIRE, a toggle in the team panel) lifts spirits more: +0.3 an hour lit, +0.1 out.
function campHour(state, p) {
  campForageHour(state, p);
  campFireHour(state, p); // woodcutting.js: a fire on bare ground burns carried firewood, or goes out
  if (starving(p)) return;
  const mood = fireLit(p) ? FIRE.campMood : FIRE.campMoodOut;
  for (const s of partyMembers(state, p)) {
    s.health = Math.min(100, s.health + campHealPerHour(state, p, s));
    s.mood = Math.min(100, (s.mood || 0) + mood);
  }
}

// ---------- roadside repairs ----------
const take = takeSupply; // found cargo first, then packed supplies (parties.js)

// One part and a few hours: worth more with a good mechanic (+8% and +1.5% per Mechanics point; a base repairs
// +25% per part with a garage, +12% without: vehicles.js repair).
export function repairInfo(state, p) {
  // Several vehicles: the worst one that can still be mended (vehicles.js fleets).
  const fixable = partyVehicles(state, p).filter((x) => !x.destroyed && x.condition < 100).sort((a, b) => a.condition - b.condition);
  const v = fixable[0] || partyVehicle(state, p);
  const mech = bestSkill(state, p, "mechanics");
  const gain = Math.round(8 + mech * 1.5);
  let reason = "";
  if (!v) reason = "No vehicle with the team.";
  else if (v.destroyed) reason = `The ${v.name} is a burnt-out wreck: nothing repairs it.`; // blown up (launchers.js)
  else if (v.condition >= 100) reason = `The ${v.name} is in top shape.`;
  else if (carried(p, "parts") < 1) reason = "Needs 1 part carried.";
  return { ok: !reason, reason, v, gain, mech, hours: REPAIR_HOURS, parts: carried(p, "parts") };
}

function fieldRepair(state, p) {
  const r = repairInfo(state, p);
  if (!r.ok) return `Repair: ${r.reason}`;
  take(p, "parts", 1);
  const before = r.v.condition;
  r.v.condition = Math.min(100, r.v.condition + r.gain);
  return `Roadside repair on the ${r.v.name}: condition ${Math.round(before)}% → ${Math.round(r.v.condition)}% (1 part).`;
}
