// Headless regression checks for teams on the State Map: launch rules, wiped teams, cards, the order queue,
// vehicles and cargo left behind, markers, gathering, camps, supply-run edits and names.
// Each block builds a small scripted case (stock, wounds and positions are set by hand; the rules are the game's).
// Usage: node tools/teamtest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js";
import { FOODS } from "../src/sim/foods.js";
import { FOOD_PACK_KG } from "../src/sim/parties.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, hurt, survivorById, addCard } from "../src/sim/world.js";
import {
  launchExpedition, planPath, partyTile, partyMembers, partyCapacity, cargoLoad, carryCapacity, supplyLoad, orderOptions, giveOrder,
  awaitOrders, startReturn, orderMove, removeParty, wipeIfEmpty, pruneCards, teamName, tileLabel, addGearToCargo, leaveVehicle,
  takeSupply, carried, missionProblem,
  bridgeClosedTo,
} from "../src/sim/parties.js";
import { queueOrder, queueEstimate, queueText, startOrder, resumeQueue, stopTask, campHealPerHour } from "../src/sim/orders.js";
import { vehiclesAtBase, abandonVehicle, tank } from "../src/sim/vehicles.js";
import { crossingsFrom, boatOrder, gatherInfo, shoreScrap, SHORE_SCRAP } from "../src/sim/crossing.js";
import { rollTravelEvent } from "../src/sim/events.js";
import { newItem, stripAll, allItems } from "../src/sim/inventory.js";
import { saveSupplyRun, dispatchSupplyRun, jobParty, supplyRunById } from "../src/sim/supply.js";
import { searchBusy } from "../src/sim/scavenge.js";
import { WATER } from "../src/sim/economy.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED, stock = {}) {
  const state = createWorld({ seed, factionCount: 7 });
  state.started = true;
  state.autoCombat = true;
  state.noWanderers = true; // people met on the road (wanderers.js) would stop the teams under test with their own cards
  const { food: days = 300, ...rest } = stock; // food: days of it (tools/foodkit.js)
  Object.assign(hub(state).stock, { water: 300, fuel: 100, meds: 20, ammo: 300, parts: 10, scrap: 100, ...rest });
  setFood(hub(state), days);
  return state;
}
const crewOf = (state, n) => atBase(state, hub(state).id).slice(0, n);
const truckOf = (state) => { const v = vehiclesAtBase(state, hub(state).id)[0]; v.fuel = 30; v.condition = 100; return v; };
const quiet = (state, p) => { state.hordes.length = 0; if (p) p.lastConflict = state.hour; };
// Event and conflict cards are thrown away unanswered (their dice would blur the case); orders cards stay.
const dropEvents = (state) => { for (let i = state.cards.length - 1; i >= 0; i--) if (!state.cards[i].isOrders) state.cards.splice(i, 1); };
function tick(state, n, p, until) {
  for (let i = 0; i < n; i++) {
    quiet(state, p);
    tickHour(state);
    if (state.combat) state.combat = null;
    dropEvents(state);
    if (until && until()) return true;
  }
  return !until;
}
// A land tile d..d2 tiles from `from` that can be reached (and is not one of your bases).
function tileNear(state, from, d, d2, { vehicle = false, filter = () => true } = {}) {
  for (const t of state.tiles) {
    const dist = state.grid.distance(from, t.id);
    if (dist < d || dist > d2 || t.terrain === "water" || state.bases.some((b) => b.tile === t.id) || !filter(t)) continue;
    if (planPath(state, from, t.id, vehicle)) return t.id;
  }
  return null;
}
// Launches light (within the carry limit) and then hands the team what the case needs.
function send(state, ids, dest, mission, { vehicleId = null, grant = {}, stance = "normal", supplies = null } = {}) {
  const res = launchExpedition(state, { memberIds: ids, dest, mission, stance, vehicleId, supplies: supplies || { food: 5, water: 5, ammo: 20, meds: 1 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const { food: days, ...rest } = grant; // food: days of it, as ration bars (tools/foodkit.js)
  Object.assign(res.party.supplies, rest);
  if (days != null) setFood(res.party, days);
  return res.party;
}
const arriveAt = (state, p) => tick(state, 24 * 6, p, () => p.phase === "waiting" || !state.parties.includes(p));
const ordersCardOf = (state, p) => state.cards.find((c) => c.isOrders && c.partyId === p.id);
const orphans = (state) => state.vehicles.filter((v) => v.loc.kind === "party" && !state.parties.some((q) => q.id === v.loc.partyId)).length;
const plain = (s) => { s.traits = []; stripAll(s); return s; }; // no traits, no gear: damage and carry space are the base numbers

// ---------------------------------------------------------------------------------------------------------
section("Launch: carry limit, crew and mission checks (T-9, T-15, T-29, P-16)");
{
  const state = mk();
  const h = hub(state);
  const [a, b, c] = crewOf(state, 3).map(plain);
  const dest = tileNear(state, h.tile, 3, 4);
  const heavy = launchExpedition(state, { memberIds: [a.id], dest, mission: "move", stance: "normal", supplies: { food: 40, water: 35, scrap: 25 } });
  check(heavy.error && /carry/i.test(heavy.error), `one walker left with a 100 load: ${heavy.error || "no error"}`);
  check(food(h) === 300, "a refused launch took stock from the hub");
  // By weight (sim/load.js): 10 days of food (FOOD_PACK_KG a day: 9 kg) + 5 water (5 kg) + scrap (2 kg each) up to
  // the walker's 40 kg.
  const cap = carryCapacity(state, [a], null);
  const fits = { food: 10, water: 5, scrap: (cap - 10 * FOOD_PACK_KG - 5) / 2 };
  check(cap === 40 && supplyLoad(fits) === cap, `test setup: load equals capacity (${supplyLoad(fits)} of ${cap})`);
  const ok = launchExpedition(state, { memberIds: [a.id], dest, mission: "move", stance: "normal", supplies: fits });
  check(!ok.error, `a load equal to the carry space was refused: ${ok.error}`);
  check(ok.party && ["water", "fuel", "meds", "ammo", "parts", "scrap"].every((k) => Number.isFinite(ok.party.supplies[k])) && food(ok.party) >= 10, "a supply key is missing on the team (later maths would give NaN), or its days of food");
  check(/Arrives in about (\d+h( \d\dm)?|\d+m)\./.test(state.log[0].text) && !/back in about/.test(state.log[0].text), `a one-way move says when it is back: "${state.log[0].text}"`);
  // A worn pack adds carry space, at launch like everywhere else.
  b.gear.backpack = newItem("assaultpack");
  const capB = carryCapacity(state, [b], null);
  check(capB === 40 + 10 - 2, `test setup: the assault pack adds 10 kg (and weighs 2): ${capB}`);
  const packed = launchExpedition(state, { memberIds: [b.id], dest, mission: "move", stance: "normal", supplies: { food: capB } });
  check(!packed.error, `a worn pack did not count at launch: ${packed.error}`);
  // Crew: on a team already, dead, or the same person twice.
  check(!!launchExpedition(state, { memberIds: [a.id], dest, mission: "move", stance: "normal", supplies: {} }).error, "someone already on a team was launched again");
  c.alive = false;
  check(!!launchExpedition(state, { memberIds: [c.id], dest, mission: "move", stance: "normal", supplies: {} }).error, "a dead survivor was launched");
  c.alive = true;
  const twice = launchExpedition(state, { memberIds: [c.id, c.id], dest, mission: "move", stance: "normal", supplies: {} });
  check(!twice.error && twice.party.members.length === 1, "the same survivor is on a team twice");
  // Missions the tile can never take.
  const water = state.tiles.find((t) => t.terrain === "water" && !t.bridge); // open water (a bridge may be barricaded with an outpost)
  check(!!missionProblem(state, water.id, "outpost"), "an outpost on water is allowed");
  check(!!missionProblem(state, h.tile, "outpost"), "an outpost on your own base is allowed");
  const days = launchExpedition(state, { memberIds: [crewOf(state, 1)[0].id], dest, mission: "scavenge", stance: "normal", supplies: { food: 3, water: 3 } });
  check(!days.error && /back in about \d+ days?\./.test(state.log[0].text) && !/1 days/.test(state.log[0].text), `round-trip launch text: "${state.log[0].text}"`);
}

section("An outpost on a bridge barricades it (T-15, changed: parties.js bridgeClosedTo)");
{
  let done = false;
  for (let seed = 1; seed < 40 && !done; seed++) {
    const state = mk(seed);
    const h = hub(state);
    const bridge = state.tiles.filter((t) => t.bridge && t.owner == null && planPath(state, h.tile, t.id, false))
      .sort((x, y) => state.grid.distance(h.tile, x.id) - state.grid.distance(h.tile, y.id))[0];
    if (!bridge) continue;
    done = true;
    const crew = crewOf(state, 2);
    const p = send(state, crew.map((s) => s.id), bridge.id, "move", { grant: { scrap: 20 } });
    arriveAt(state, p);
    if (!check(state.parties.includes(p) && partyTile(p) === bridge.id, "test setup: the team did not reach the bridge")) break;
    check(orderOptions(state, p).some((o) => o.mission === "outpost"), "Build outpost is not offered on a bridge");
    state.cards.length = 0;
    giveOrder(state, p, "outpost");
    for (let i = 0; i < 48 && !state.bases.some((x) => x.tile === bridge.id); i++) { tickHour(state); state.cards.length = 0; } // pitching the camp: its fire and the clearing of its 5 × 5 (staging.js siteSetup)
    const base = state.bases.find((x) => x.tile === bridge.id);
    check(!!base, "no outpost was founded on the bridge");
    check(base && /Bridge Barricade/.test(base.name), `the barricade is named for the bridge ("${base && base.name}")`);
    const f = state.factions.find((x) => x.alive);
    check(!f || bridgeClosedTo(state, bridge.id, f.id), "the barricade does not close the bridge to the other groups");
  }
  check(done, "no map with a reachable bridge in seeds 1-39");
}

// ---------------------------------------------------------------------------------------------------------
section("A team with nobody left is always wiped: cargo to a death site, vehicle marked (T-3, C-25, P-2, B-30)");
{
  // Shot dead at the gates of a hostile group (the old crash: rng.pick([]) on the next orders card).
  const state = mk(7);
  const h = hub(state);
  const f = state.factions.filter((x) => planPath(state, h.tile, x.bases[0], true)).sort((x, y) => state.grid.distance(h.tile, x.bases[0]) - state.grid.distance(h.tile, y.bases[0]))[0];
  f.goodwill = -80;
  f.known = true;
  const [s] = crewOf(state, 1).map(plain);
  const truck = truckOf(state);
  const p = send(state, [s.id], f.bases[0], "trade", { vehicleId: truck.id, grant: { fuel: 10, scrap: 5 } });
  const pack = newItem("assaultpack");
  pack.contents[0] = newItem("pistol");
  const worn = newItem("crossbow", 0.6);
  worn.dur = 2;
  p.cargo.gear.push(pack, worn);
  p.cargo.supplies.scrap = 40;
  // Stopped an hour short of the gates: a truck covers up to 4 road tiles an hour (a quarter of an hour each).
  tick(state, 24 * 5, p, () => state.grid.distance(partyTile(p), f.bases[0]) <= 4 || !state.parties.includes(p));
  s.health = 3;
  tick(state, 6, p, () => !s.alive);
  check(!s.alive, "test setup: the trader was not shot at the gates");
  check(!state.parties.includes(p), "the dead team still exists");
  check(!state.cards.some((c) => c.partyId === p.id), "a card is open for a team with nobody left");
  check(truck.loc.kind === "abandoned" && truck.loc.tile === f.bases[0], `the truck is ${JSON.stringify(truck.loc)}, not abandoned at the gates`);
  check(orphans(state) === 0, "a vehicle points at a team that is gone");
  check(state.markers.some((m) => m.key === `vehicle:${truck.id}`), "no map marker for the truck of the lost team");
  const site = state.deathSites.find((d) => d.tile === f.bases[0]);
  check(site && site.items.some((i) => i.key === "scrap" && i.qty >= 40), "the lost team's cargo is not at the death site");
  check(site && state.markers.some((m) => m.key === `death:${site.tile}`), "no map marker for the death site of the lost team");
  const left = site && site.items.find((i) => i.key === "assaultpack");
  check(left && left.item === pack && left.item.contents[0], "the pack in the cargo lost its contents at the death site");
  const bow = site && site.items.find((i) => i.key === "crossbow");
  check(bow && bow.item === worn && bow.item.quality === 0.6 && bow.item.dur === 2, "the worn crossbow lost its condition at the death site");
  tick(state, 3, null);
  check(!state.gameOver && orphans(state) === 0, "ticking on after the wipe broke something");
}
{
  // The hourly sweep: however the people were lost, the next hour ends the team as a wiped team.
  const state = mk();
  const h = hub(state);
  const [a, b] = crewOf(state, 2);
  const truck = truckOf(state);
  const p = send(state, [a.id, b.id], tileNear(state, h.tile, 5, 6, { vehicle: true }), "move", { vehicleId: truck.id });
  tick(state, 2, p);
  setFood(p.cargo, 12);
  a.alive = false; b.alive = false; // lost without wipeParty (a battle started some other way, a card, ...)
  const at = partyTile(p);
  tick(state, 1, null);
  check(!state.parties.includes(p), "a team of the dead was not swept after an hour");
  check(truck.loc.kind === "abandoned" && truck.loc.tile === at && state.markers.some((m) => m.key === `vehicle:${truck.id}`), "the swept team's truck is not abandoned with a marker");
  check(state.deathSites.some((d) => d.tile === at && d.items.some((i) => !!FOODS[i.key])), "the swept team's cargo is not at a death site");
}
{
  // "Cold feet" on a one-person team: the team turns around with everything, nobody is teleported.
  const state = mk();
  const h = hub(state);
  const [s] = crewOf(state, 1);
  s.traits = ["coward"];
  const truck = truckOf(state);
  const p = send(state, [s.id], tileNear(state, h.tile, 6, 8, { vehicle: true }), "move", { vehicleId: truck.id, grant: { scrap: 10 } });
  tick(state, 2, p);
  let card = null;
  for (let i = 0; i < 4000 && !card; i++) {
    quiet(state, p);
    const c = rollTravelEvent(state, p, partyTile(p));
    if (c && c.title === "Cold feet") card = c;
  }
  if (check(!!card, "test setup: no Cold feet card rolled")) {
    const text = card.choices[1].resolve(state);
    check(state.parties.includes(p) && p.members.includes(s.id) && p.phase === "back", `the solo coward left an empty team behind (${text})`);
    check(s.location.kind === "party", "the solo coward was teleported home");
    arriveAt(state, p);
    check(!state.parties.includes(p) && truck.loc.kind === "base" && s.location.kind === "base", "the coward's team did not get home with its truck");
    check(orphans(state) === 0, "a vehicle points at a team that is gone");
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Cards never outlive their team or the person they are about (T-2, P-13)");
{
  const state = mk();
  const h = hub(state);
  const [a, b] = crewOf(state, 2);
  a.traits = ["coward"];
  const p = send(state, [a.id, b.id], tileNear(state, h.tile, 6, 8), "move");
  tick(state, 2, p);
  let cold = null, other = null;
  for (let i = 0; i < 6000 && !(cold && other); i++) {
    quiet(state, p);
    const c = rollTravelEvent(state, p, partyTile(p));
    if (!c) continue;
    if (c.title === "Cold feet") cold = cold || c;
    else if (!c.conflict && c.title !== "The worm" && c.title !== "Tempers flare") other = other || c;
  }
  if (check(cold && other, "test setup: cards not rolled")) {
    // About someone who has died since: dropped, and answering it anyway does nothing.
    state.cards.length = 0;
    addCard(state, cold);
    const mood = b.mood;
    hurt(state, a, 999, partyTile(p), "for the test");
    pruneCards(state);
    check(!state.cards.includes(cold), "a card about a dead survivor is still in the queue");
    check(/Too late/.test(cold.choices[0].resolve(state)) && b.mood === mood, "a card about a dead survivor still took effect");
    // About a team that went home: gone with the team, and harmless if answered.
    addCard(state, other);
    startReturn(state, p);
    arriveAt(state, p);
    check(!state.parties.includes(p), "test setup: the team did not get home");
    check(!state.cards.some((c) => c.partyId === p.id), "a card is still open for a team that is home");
    const food0 = food(h);
    for (const ch of other.choices) check(/Too late/.test(ch.resolve(state)), `"${other.title} → ${ch.label}" still ran for a team that is gone`);
    check(food(h) === food0 && !state.deathSites.some((d) => d.names.includes("the lost team")), "a stale card changed the world");
    check(!state.survivors.some((s) => s.alive && s.location.kind === "party" && !state.parties.some((q) => q.id === s.location.partyId)), "a survivor is on a team that does not exist");
  }
}
{
  // At most one event card per team per hour, even when a vehicle enters several tiles.
  let worst = 0, cards = 0;
  for (const seed of [SEED, SEED + 1, SEED + 2]) {
    const state = mk(seed);
    const h = hub(state);
    const crew = crewOf(state, 2);
    const truck = truckOf(state);
    const far = state.tiles.filter((t) => t.terrain !== "water" && planPath(state, h.tile, t.id, true)).sort((x, y) => state.grid.distance(h.tile, y.id) - state.grid.distance(h.tile, x.id))[0];
    const p = send(state, crew.map((s) => s.id), far.id, "move", { vehicleId: truck.id, stance: "rushed", grant: { fuel: 80, food: 40, water: 40 } });
    for (let i = 0; i < 80 && state.parties.includes(p) && p.phase === "out"; i++) {
      p.lastConflict = state.hour;
      truck.condition = 30; // breakdowns often
      tickHour(state);
      const n = state.cards.filter((c) => !c.isOrders && c.partyId === p.id).length;
      worst = Math.max(worst, n);
      cards += n;
      state.cards.length = 0;
      if (state.combat) state.combat = null;
      if (p.phase === "engaged") p.phase = "out";
    }
  }
  check(cards > 0, "test setup: no event cards at all");
  check(worst <= 1, `${worst} event cards for one team in one hour`);
}

// ---------------------------------------------------------------------------------------------------------
section("Order queue: an interrupted trip resumes to the right tile (T-4, T-20)");
{
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 2);
  const p = send(state, crew.map((s) => s.id), tileNear(state, h.tile, 3, 3), "move", { grant: { scrap: 20, food: 20, water: 20 } });
  arriveAt(state, p);
  state.cards.length = 0;
  const A = tileNear(state, partyTile(p), 6, 7, { filter: (t) => t.owner == null && !state.factions.some((f) => f.bases.includes(t.id)) });
  queueOrder(state, p, { type: "move", tile: A });
  queueOrder(state, p, { type: "mission", mission: "outpost" });
  queueOrder(state, p, { type: "home" });
  const est = queueEstimate(state, p);
  check(est[est.length - 1].order.type === "home" && est[est.length - 1].hours > 0, "no time estimate for a queued Return home");
  p.orders.pop();
  tick(state, 3, p);
  state.cards.length = 0;
  const stoppedAt = partyTile(p);
  check(stoppedAt !== A, "test setup: the team already arrived");
  p.phase = "engaged"; // as after a road fight: "Stop and wait for orders" (conflicts.js)
  awaitOrders(state, p, "");
  check(p.orders[0] && p.orders[0].type === "move" && p.orders[0].tile === A, `the interrupted move is not back at the front of the queue (${queueText(state, p)})`);
  const card = ordersCardOf(state, p);
  check(card && !/^Done/.test(card.title), `a team stopped on the way got a card titled "${card && card.title}"`);
  const resume = card && card.choices.find((c) => /^Resume queued/.test(c.label));
  state.cards.length = 0;
  if (check(!!resume, "no Resume queued orders choice")) {
    resume.resolve(state);
    tick(state, 24 * 4, p, () => !state.parties.includes(p) || p.phase === "waiting");
    const ob = state.bases.find((x) => x.type === "outpost");
    check(ob && ob.tile === A, `the outpost was founded at ${ob ? tileLabel(state, ob.tile) : "nowhere"}, not at ${tileLabel(state, A)}`);
  }
}
{
  // A queued job on the spot remembers its tile: after a redirect it fails with a message instead of running there.
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 2);
  const site = state.tiles.filter((t) => t.loc && t.loot > 0.2 && t.id !== h.tile && state.grid.distance(h.tile, t.id) >= 4 && planPath(state, h.tile, t.id, false))
    .sort((x, y) => state.grid.distance(h.tile, x.id) - state.grid.distance(h.tile, y.id))[0];
  const p = send(state, crew.map((s) => s.id), site.id, "move");
  tick(state, 1, p);
  queueOrder(state, p, { type: "mission", mission: "scavenge" });
  check(p.orders[0].at === site.id, "a queued mission does not remember its tile");
  const other = tileNear(state, partyTile(p), 1, 2, { filter: (t) => t.id !== site.id && t.loot > 0.05 });
  orderMove(state, p, other);
  tick(state, 24, p, () => p.phase === "waiting" || p.phase === "engaged");
  check(!state.engagement && p.phase === "waiting" && partyTile(p) === other, "the queued search ran on the redirect tile");
  const card = ordersCardOf(state, p);
  check(card && /was planned for/.test(card.text) && !/^Done/.test(card.title), `no message for the job on the wrong tile: "${card && card.title}: ${card && card.text}"`);
}

section("Orders cards: launch name kept, \"Done\" only when something was done, return home (P-19, P-27)");
{
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 2);
  const p = send(state, crew.map((s) => s.id), tileNear(state, h.tile, 3, 3), "recon");
  const name = teamName(state, p);
  check(/^Recon team/.test(name), `team name at launch: ${name}`);
  arriveAt(state, p);
  check(/^Done: /.test(ordersCardOf(state, p)?.title || ""), `arrival card titled "${ordersCardOf(state, p)?.title}"`);
  state.cards.length = 0;
  startOrder(state, p, { type: "repair" }); // no vehicle: cannot start
  check(ordersCardOf(state, p) && !/^Done/.test(ordersCardOf(state, p).title), `a failed order is titled "${ordersCardOf(state, p)?.title}"`);
  state.cards.length = 0;
  startOrder(state, p, { type: "camp", hours: 8 });
  tick(state, 2, p);
  stopTask(state, p);
  state.cards.length = 0;
  startOrder(state, p, { type: "survey" });
  check(teamName(state, p) === name, `the team was renamed by an order: ${teamName(state, p)}`);
  orderMove(state, p, tileNear(state, partyTile(p), 2, 2));
  check(teamName(state, p) === name, `the team was renamed by a move: ${teamName(state, p)}`);
  // Return home: "" when it leaves, a reason (and a "Cannot go home" card) when it cannot.
  arriveAt(state, p);
  state.cards.length = 0;
  check(startReturn(state, p) === "" && p.phase === "back", "startReturn did not report a clean start");
}

// ---------------------------------------------------------------------------------------------------------
section("Water: gathering and boats (T-8, T-17, P-17, P-19)");
{
  let done = false;
  for (let seed = SEED; seed < SEED + 30 && !done; seed++) {
    const state = mk(seed);
    const h = hub(state);
    const shores = state.tiles.filter((t) => t.terrain !== "water" && t.id !== h.tile && !state.bases.some((b) => b.tile === t.id) && crossingsFrom(state, t.id).length && planPath(state, h.tile, t.id, false))
      .sort((x, y) => state.grid.distance(h.tile, x.id) - state.grid.distance(h.tile, y.id));
    // A crossing to land the hub cannot walk to (so "Return home" from there fails).
    let shore = null, far = null;
    for (const t of shores) {
      const c = crossingsFrom(state, t.id).find((x) => !planPath(state, x.tile, h.tile, false));
      if (c) { shore = t.id; far = c.tile; break; }
    }
    if (shore == null) continue;
    done = true;
    const crew = crewOf(state, 2);
    const inland = tileNear(state, h.tile, 2, 4, { filter: (t) => !crossingsFrom(state, t.id).length });
    const p = send(state, crew.map((s) => s.id), inland, "move", { grant: { food: 40, water: 30 } });
    arriveAt(state, p);
    state.cards.length = 0;
    startOrder(state, p, { type: "gather" });
    check(p.phase === "waiting" && !(p.cargo.supplies.scrap > 0), "Gather materials started away from any shore");
    check(/only on a shore/.test(ordersCardOf(state, p)?.text || ""), "no reason given for refusing to gather inland");
    state.cards.length = 0;
    orderMove(state, p, shore);
    arriveAt(state, p);
    if (!check(state.parties.includes(p) && partyTile(p) === shore, "test setup: the team did not reach the shore")) break;
    let total = 0, runs = 0;
    for (let i = 0; i < 8; i++) {
      state.cards.length = 0;
      startOrder(state, p, { type: "gather" });
      if (p.phase !== "task") break;
      runs++;
      tick(state, 4, p, () => p.phase === "waiting");
    }
    total = p.cargo.supplies.scrap || 0;
    check(runs >= 1 && runs <= 5 && total > 0 && total <= SHORE_SCRAP + 1, `gathering on one shore gave ${total} scrap in ${runs} runs (limit about ${SHORE_SCRAP})`);
    check(gatherInfo(state, p, shore).left === 0 && shoreScrap(state, shore) < 1, "the shore is not picked clean after gathering it out");
    const hourNow = state.hour;
    state.hour += 24 * 12;
    check(shoreScrap(state, shore) >= 3 && shoreScrap(state, shore) <= SHORE_SCRAP, `after 12 days the shore holds ${shoreScrap(state, shore).toFixed(1)} (should regrow slowly)`);
    state.hour = hourNow;
    // Cross, then try to go home: cut off.
    p.supplies.scrap = 40;
    state.cards.length = 0;
    const order = boatOrder(state, p, shore, far, "raft");
    startOrder(state, p, order);
    tick(state, 40, p, () => p.phase === "waiting");
    if (check(partyTile(p) === far, "test setup: the team did not cross")) {
      state.cards.length = 0;
      const logs = state.log.length;
      const why = startReturn(state, p);
      const card = ordersCardOf(state, p);
      check(!!why && p.phase === "waiting", "startReturn across water reported success");
      check(card && card.title === "Cannot go home", `the cut-off card is titled "${card && card.title}"`);
      check(startOrder(state, p, { type: "home" }) !== "The team heads home.", "the queue says the team heads home when it cannot");
    }
  }
  check(done, "no map with a crossing to cut-off land in 30 seeds");
}
{
  // A boat order queued before the team has its vehicle is planned again when it starts (the raft is not free).
  let done = false;
  for (let seed = SEED; seed < SEED + 30 && !done; seed++) {
    const state = mk(seed);
    const h = hub(state);
    const truck = truckOf(state);
    const shore = state.tiles.filter((t) => t.terrain !== "water" && t.id !== h.tile && crossingsFrom(state, t.id).some((c) => state.tiles[c.tile].terrain !== "mountain") && planPath(state, h.tile, t.id, true))
      .sort((x, y) => state.grid.distance(h.tile, x.id) - state.grid.distance(h.tile, y.id))[0];
    if (!shore) continue;
    done = true;
    const far = crossingsFrom(state, shore.id).find((c) => state.tiles[c.tile].terrain !== "mountain").tile;
    const crew = crewOf(state, 2);
    const p = send(state, crew.map((s) => s.id), shore.id, "move", { vehicleId: truck.id, grant: { scrap: 60, parts: 4 } });
    arriveAt(state, p);
    state.cards.length = 0;
    abandonVehicle(state, p, shore.id, "test");
    const onFoot = boatOrder(state, p, shore.id, far, "raft"); // planned without a vehicle
    truck.loc = { kind: "party", partyId: p.id };
    p.vehicle = true;
    p.vehicleId = truck.id;
    startOrder(state, p, onFoot);
    check(p.phase === "task" && p.task.mats.scrap > onFoot.mats.scrap && p.task.mats.parts > 0, `the truck is rafted for the price of a foot boat (${JSON.stringify(p.task && p.task.mats)} vs ${JSON.stringify(onFoot.mats)})`);
  }
  check(done, "no map with a shore a truck can reach");
}

// ---------------------------------------------------------------------------------------------------------
section("Vehicles left behind: fuel in the tank counts, cargo stays inside and is logged (T-6, T-11, P-5)");
{
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 2).map(plain);
  const truck = truckOf(state);
  const p = send(state, crew.map((s) => s.id), tileNear(state, h.tile, 3, 4, { vehicle: true }), "move", { vehicleId: truck.id });
  arriveAt(state, p);
  state.cards.length = 0;
  p.cargo.supplies = { scrap: 60, food: 30, parts: 3 };
  p.cargo.gear.push(newItem("ar"), newItem("plate"));
  const before = cargoLoad(p.cargo);
  const logs = state.log.length;
  const left = leaveVehicle(state, p, partyTile(p), "left on the shore");
  check(!p.vehicle && truck.loc.kind === "abandoned", "test setup: the truck was not left");
  check(cargoLoad(p.cargo) <= partyCapacity(state, p) + 1e-9, `the team on foot still carries ${cargoLoad(p.cargo)} of ${partyCapacity(state, p)}`);
  check(!!left && truck.cargo && Math.abs(cargoLoad(truck.cargo) + cargoLoad(p.cargo) - before) < 1e-6, "cargo dropped with the vehicle vanished");
  check(state.log.length > logs && /stayed in the/.test(state.log[0].text), "nothing in the log about the cargo left behind");
  check(/cargo inside/.test(p.spotted.get(`vehicle:${truck.id}`)?.label || ""), "the vehicle's marker does not mention the cargo");
  // Same tile, no fuel cans, fuel in the tank: the team can drive it again and the cargo is back on board.
  p.supplies.fuel = 0;
  check(truck.fuel >= 2, "test setup: tank is empty");
  const opt = orderOptions(state, p).find((o) => o.mission === "getvehicle");
  check(opt && !opt.disabled, `Recover vehicle is blocked with ${truck.fuel.toFixed(1)} fuel in the tank: ${opt && opt.disabled}`);
  giveOrder(state, p, "getvehicle");
  check(p.vehicle && truck.loc.kind === "party", "the truck with fuel in its tank was not recovered");
  check(!truck.cargo && Math.abs(cargoLoad(p.cargo) - before) < 1e-6, "the cargo left in the truck did not come back with it");
  // An empty tank and no cans: refused, with the reason.
  state.cards.length = 0;
  leaveVehicle(state, p, partyTile(p), "test");
  truck.fuel = 0;
  const opt2 = orderOptions(state, p).find((o) => o.mission === "getvehicle");
  check(opt2 && !!opt2.disabled, "Recover vehicle is offered with no fuel anywhere");
  p.supplies.fuel = 3;
  giveOrder(state, p, "getvehicle");
  check(p.vehicle && truck.fuel === 3 && carried(p, "fuel") === 0, `carried fuel was not poured in (tank ${truck.fuel}, carried ${carried(p, "fuel")})`);
}
{
  // Running dry on the road: the same rule.
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 2).map(plain);
  const truck = truckOf(state);
  const p = send(state, crew.map((s) => s.id), tileNear(state, h.tile, 9, 11, { vehicle: true }), "move", { vehicleId: truck.id });
  truck.fuel = 2;
  p.cargo.supplies = { scrap: 60, food: 30 };
  tick(state, 30, p, () => !p.vehicle);
  check(!p.vehicle && truck.cargo && (truck.cargo.supplies.scrap || 0) > 0, "the truck ran dry and the cargo the team could not carry is not in it");
  check(state.log.some((l) => /stayed in the/.test(l.text)), "running dry: nothing in the log about the cargo");
}

section("Carry space for items; markers cleared when nothing is there (T-12, T-13, T-14, T-22, B-23)");
{
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 4).map(plain);
  const far = tileNear(state, h.tile, 4, 5);
  const p = send(state, [crew[0].id, crew[1].id], far, "move");
  arriveAt(state, p);
  state.cards.length = 0;
  const dead = crew[0];
  dead.gear.weapon = newItem("ar");
  dead.gear.armor = newItem("plate");
  dead.pockets = [newItem("pistol"), newItem("knife"), newItem("milradio"), newItem("surgkit")];
  const n = allItems(dead).length;
  // The one left carries most of what it can already (sim/load.js: by weight), so not everything fits.
  p.supplies.water = (p.supplies.water || 0) + 26;
  hurt(state, dead, 999, partyTile(p), "for the test");
  giveOrder(state, p, "recover");
  check(cargoLoad(p.cargo) <= partyCapacity(state, p) + 1e-9, `recover overfilled the cargo: ${cargoLoad(p.cargo)} of ${partyCapacity(state, p)}`);
  const site = state.deathSites.find((d) => d.tile === far);
  check(p.cargo.gear.length > 0 && site && site.items.length === n - p.cargo.gear.length, "what did not fit is not left at the death site");
  check(/No room to carry/.test(ordersCardOf(state, p)?.text || ""), "recover does not say what was left behind");
  check(!addGearToCargo(state, p, newItem("plate")), "addGearToCargo put an 8 kg item into a cargo with less room");
  // Somebody else takes the rest; a second team finds nothing and the marker goes when it reports.
  state.cards.length = 0;
  startReturn(state, p);
  arriveAt(state, p);
  check(state.markers.some((m) => m.key === `death:${far}`), "test setup: no death marker at the hub");
  state.deathSites.length = 0;
  const p2 = send(state, [crew[2].id, crew[3].id], far, "recover");
  arriveAt(state, p2);
  check(/Nothing left/.test(ordersCardOf(state, p2)?.text || "") && !/^Done/.test(ordersCardOf(state, p2)?.title || ""), "no 'Nothing left' report");
  check(!state.markers.some((m) => m.key === `death:${far}`), "the death marker stayed after a team found nothing there");
}
{
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 4);
  const truck = truckOf(state);
  const far = tileNear(state, h.tile, 6, 7, { vehicle: true, filter: (t) => !state.grid.within(h.tile, 4).includes(t.id) });
  const p = send(state, [crew[0].id, crew[1].id], far, "move", { vehicleId: truck.id });
  arriveAt(state, p);
  state.cards.length = 0;
  leaveVehicle(state, p, far, "broke down");
  startReturn(state, p);
  arriveAt(state, p);
  check(state.markers.some((m) => m.key === `vehicle:${truck.id}`), "test setup: no vehicle marker at the hub");
  state.vehicles.splice(state.vehicles.indexOf(truck), 1); // stripped to the frame meanwhile
  const p2 = send(state, [crew[2].id, crew[3].id], far, "getvehicle", { grant: { fuel: 5 } });
  arriveAt(state, p2);
  check(/vehicle is gone/.test(ordersCardOf(state, p2)?.text || ""), "no 'vehicle is gone' report");
  check(!state.markers.some((m) => m.type === "vehicle" && m.tile === far), "the vehicle marker stayed after a team found it gone");
}
{
  // Someone who dies with nothing on them leaves no lasting site or marker.
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 2);
  const p = send(state, crew.map((s) => s.id), tileNear(state, h.tile, 4, 5), "move");
  arriveAt(state, p);
  state.cards.length = 0;
  stripAll(crew[0]);
  hurt(state, crew[0], 999, partyTile(p), "for the test");
  startReturn(state, p);
  arriveAt(state, p);
  tick(state, 24, null);
  check(!state.deathSites.some((d) => !d.items.length), "an empty death site is still there after a day");
  check(!state.markers.some((m) => m.type === "death"), "a marker for an empty death site is on the map");
}

// ---------------------------------------------------------------------------------------------------------
section("Camp without food or water does not heal (T-7)");
{
  const state = mk();
  const h = hub(state);
  const [s] = crewOf(state, 1).map(plain);
  s.skills.medicine = 16;
  const p = send(state, [s.id], tileNear(state, h.tile, 3, 4), "move", { grant: { water: 60 } });
  arriveAt(state, p);
  state.cards.length = 0;
  setFood(p, 0);
  setFood(p.cargo, 0);
  s.health = 80;
  s.mood = 50;
  s.hunger = 5; // needs.js: already hungry (a full gauge would carry them about three days first)
  startOrder(state, p, { type: "camp", hours: null });
  tick(state, 48, p);
  check(s.health < 80 - 20, `two days camping with no food and an empty stomach: health 80 → ${s.health.toFixed(1)} (hunger should cost about 26)`);
  check(s.mood <= 50, `spirits rose in a starving camp (${s.mood.toFixed(1)})`);
  check(campHealPerHour(state, p, s) === 0, "the panel still shows camp healing while starving");
  setFood(p, 10);
  tick(state, 24, p);
  check(campHealPerHour(state, p, s) > 0, "camp healing did not come back once the team ate");
}

section("Old cards cannot take stock below zero or make it NaN (B-4, B-11, B-22, T-18, C-23)");
{
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 2);
  const truck = truckOf(state);
  const p = send(state, crew.map((s) => s.id), tileNear(state, h.tile, 6, 8, { vehicle: true }), "move", { vehicleId: truck.id, grant: { carparts: 1 } }); // a spare part is a car part now (events.js: or 2 machine parts)
  tick(state, 2, p);
  truck.condition = 5;
  const cards = [];
  for (let i = 0; i < 4000 && cards.length < 2; i++) {
    quiet(state, p);
    const c = rollTravelEvent(state, p, partyTile(p));
    if (c && c.title === "Breakdown") cards.push(c);
  }
  if (check(cards.length === 2, "test setup: no two Breakdown cards")) {
    const spare = (c) => c.choices.find((x) => /spare part/.test(x.label));
    check(!spare(cards[0]).disabled && !spare(cards[1]).disabled, "spare part disabled with a part carried");
    spare(cards[0]).resolve(state);
    check(spare(cards[1]).disabled === true, "the second card still offers the part that was just used");
    spare(cards[1]).resolve(state);
    check(carried(p, "carparts") === 0 && Number.isFinite(p.supplies.carparts) && p.supplies.carparts >= 0, `car parts on the team: ${p.supplies.carparts}`);
    const partsHome = h.stock.carparts;
    delete p.supplies.ammo; // as an old save or a tool might leave it
    p.supplies.meds = NaN;
    startReturn(state, p);
    arriveAt(state, p);
    check(h.stock.carparts === partsHome && Number.isFinite(h.stock.meds) && Number.isFinite(h.stock.ammo), `hub stock after the team came home: car parts ${h.stock.carparts}, meds ${h.stock.meds}, ammo ${h.stock.ammo}`);
    // Abandoning through a second, older card does nothing once the vehicle is gone.
  }
}
{
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 2);
  const dest = tileNear(state, h.tile, 2, 3);
  state.hordes.push({ id: 9001, tile: dest, size: 12, target: null, move: 0 });
  const p = send(state, crew.map((s) => s.id), dest, "cull");
  delete p.supplies.ammo;
  for (let i = 0; i < 40 && p.phase !== "engaged"; i++) { p.lastConflict = state.hour; tickHour(state); for (let j = state.cards.length - 1; j >= 0; j--) if (!/horde of/i.test(state.cards[j].title)) state.cards.splice(j, 1); }
  const card = state.cards.find((c) => /^A horde of/.test(c.title));
  if (check(!!card, "test setup: no cull card")) {
    const mine = state.hordes.find((x) => x.id === 9001);
    state.hordes.splice(state.hordes.indexOf(mine), 1); // merged away before the card is answered
    state.hordes.push({ id: 9002, tile: tileNear(state, h.tile, 12, 14), size: 77, target: null, move: 0 });
    card.choices[0].resolve(state);
    check(state.hordes.some((x) => x.id === 9002), "the cull card removed a different horde");
    check(!Number.isNaN(p.supplies.ammo) && !(p.supplies.ammo < 0), `ammo after the cull card: ${p.supplies.ammo}`);
  }
  // Mood has a floor.
  const [a, b] = crew;
  a.mood = 4; b.mood = 4;
  let arg = null;
  if (state.parties.includes(p)) {
    for (let i = 0; i < 6000 && !arg; i++) { quiet(state, p); const c = rollTravelEvent(state, p, partyTile(p)); if (c && c.title === "Tempers flare") arg = c; }
    if (check(!!arg, "test setup: no Tempers flare card")) {
      for (const s of crew) s.skills.leadership = 0;
      for (let i = 0; i < 20; i++) arg.choices[0].resolve(state);
      check(a.mood >= 0 && b.mood >= 0, `mood below zero: ${a.mood}, ${b.mood}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
section("One search at a time: the slot is not overwritten (T-29)");
{
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 4);
  const sites = state.tiles.filter((t) => t.loc && t.loot > 0.2 && t.id !== h.tile && planPath(state, h.tile, t.id, false)).sort((x, y) => state.grid.distance(h.tile, x.id) - state.grid.distance(h.tile, y.id));
  const p1 = send(state, [crew[0].id, crew[1].id], sites[0].id, "move");
  const p2 = send(state, [crew[2].id, crew[3].id], sites[1].id, "move");
  tick(state, 24 * 3, null, () => p1.phase === "waiting" && p2.phase === "waiting");
  state.cards.length = 0;
  giveOrder(state, p1, "scavenge");
  check(state.engagement && state.engagement.partyId === p1.id, "test setup: the first search did not start");
  check(searchBusy(state, p2), "searchBusy does not see the running search");
  giveOrder(state, p2, "scavenge");
  check(state.engagement && state.engagement.partyId === p1.id, "the second team's search replaced the first");
  check(p2.phase === "waiting" && /Another team/.test(ordersCardOf(state, p2)?.text || ""), "the second team was not told to wait");
}

section("Supply runs: an edit changes the next run only; held convoys drink (T-16, T-21)");
{
  const state = mk();
  const h = hub(state);
  const crew = crewOf(state, 4);
  const spot = tileNear(state, h.tile, 4, 5, { filter: (t) => t.owner == null && !state.factions.some((f) => f.bases.includes(t.id)) });
  const founders = send(state, [crew[0].id], spot, "outpost", { supplies: { food: 0, water: 0, scrap: 15 } });
  tick(state, 24 * 3, founders, () => !state.parties.includes(founders));
  const op = state.bases.find((b) => b.type === "outpost");
  if (check(!!op, "test setup: no outpost")) {
    Object.assign(op.stock, { water: 0 }); setFood(op, 50);
    const res = saveSupplyRun(state, { jobId: null, originId: h.id, destId: op.id, crew: [crew[1].id, crew[2].id], vehicleId: null, deliver: [{ key: "scrap", qty: 5 }], pickup: [], atDest: "hold", schedule: "once", every: 5, stance: "normal", allowPartial: false });
    const job = res.job;
    dispatchSupplyRun(state, job, true);
    const p = jobParty(state, job);
    if (check(!!p, `test setup: the convoy did not leave (${job.blocked})`)) {
      // Edited while the convoy is on the road: this convoy still holds, as ordered when it left.
      saveSupplyRun(state, { jobId: job.id, originId: h.id, destId: op.id, crew: [crew[1].id, crew[2].id], vehicleId: null, deliver: [{ key: "scrap", qty: 5 }], pickup: [], atDest: "disband", schedule: "once", every: 5, stance: "normal", allowPartial: false });
      tick(state, 24 * 3, p, () => p.phase === "holding" || !state.parties.includes(p));
      check(state.parties.includes(p) && p.phase === "holding", "an edit to the job changed what the convoy on the road does at the destination");
      p.supplies.water = 0;
      op.stock.water = 0;
      // A dry outpost: no spring or stream here for this check (outposts have their own small water supply now).
      const wet = { spring: WATER.spring, stream: WATER.stream };
      WATER.spring = 0; WATER.stream = 0;
      const hp = partyMembers(state, p).map((s) => s.health);
      tick(state, 24 * 3, p);
      Object.assign(WATER, wet);
      const now = partyMembers(state, p).map((s) => s.health);
      check(now.length < hp.length || now.some((x, i) => x < hp[i]), "a convoy holding at a base with no water is not thirsty");
    }
  }
}

section("Names (T-19)");
{
  let cityTowns = 0, dupGroups = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const state = createWorld({ seed, factionCount: 10 });
    cityTowns += state.tiles.filter((t) => t.loc && t.loc.type === "town" && /City/.test(t.loc.name)).length;
    const names = state.factions.map((f) => f.name);
    if (new Set(names).size !== names.length) dupGroups++;
  }
  check(cityTowns === 0, `${cityTowns} small towns are called "... City"`);
  check(dupGroups === 0, `${dupGroups} of 40 worlds have two groups with the same name`);
}

console.log(fails ? `\n${passed} passed, ${fails} FAILED` : `\nAll ${passed} checks passed.`);
process.exit(fails ? 1 : 0);
