// Attacked alone (src/sim/loneattack.js; tripevents.js kinds "dead" / "deadbeast" and the attack card; events.js
// "straggler"; combat.js setup.afield and named fighters out of the walls; ui/settings.js saveBeforeFight). Checks:
//   - what comes at one person: 1–3 of the dead, or 1–3 dead beasts of the tile's kind, at the land's power
//   - a worker on a job trip set upon by the dead or the dead beasts at a base you run: the card "<name> was attacked
//     by …" with Save and fight (a save as the fight opens), Fight and by the numbers; headless, Fight resolves at once
//     and the trip goes on; on the map the battle has that one person only, with what they carry and no stock to draw
//     on, the trip holds while it is fought, and its end steers the trip (on, cut short, or over)
//   - the governor's base: no card, settled by the numbers (the dead beasts too)
//   - a team on foot: the straggler card for one of them, fought alone on the map (the rest stay off it), or by the
//     numbers at once; the log tells the outcome
// Usage: node tools/loneattacktest.js
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { planTrip } from "../src/sim/jobtrips.js";
import { fireTripEvent, holdTrip, TRIP_EV } from "../src/sim/tripevents.js";
import { LONE, loneEnemy, stragglerFits, attackCard } from "../src/sim/loneattack.js";
import { travelEventFits, travelEventCard, TRAVEL_EVENT_IDS } from "../src/sim/events.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { autoPlayerTurn, runEnemyPhase, closeCombat, active, registerCombatHandler } from "../src/sim/combat.js";
import { newItem, ensureInv } from "../src/sim/inventory.js";
import { beastMix } from "../src/sim/deadbeasts.js";
import { Rng } from "../src/sim/rng.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("lonetest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const r2 = (v) => Math.round(v * 100) / 100;
const logText = (st, n) => st.log.slice(0, st.log.length - n).map((l) => l.text);
const used = new WeakMap();
const fakeTile = (st, terrain, loc = null, infection = 0.3, road = false) => {
  const h = hub(st), taken = used.get(st) || new Set();
  const t = st.tiles.find((x) => x.id !== h.tile && x.terrain !== "water" && !taken.has(x.id) && st.grid.distance(x.id, h.tile) > 2 && !st.bases.some((b) => b.tile === x.id));
  taken.add(t.id); used.set(st, taken);
  st.tiles[t.id] = { ...t, terrain, road, infection, hive: false, loc: loc ? { type: loc, name: loc } : null };
  return t.id;
};
const weekWith = (st, tile) => { for (let w = 0; w < 40; w++) { st.hour = w * 24 * 7; if (beastMix(st, tile)) return w; } return -1; };
function mk(seed) {
  const state = createWorld({ seed, factionCount: 4 });
  state.started = true;
  state.visitorsOff = true;
  Object.assign(hub(state).stock, { food: 400, water: 400, fuel: 100, meds: 20, scrap: 100, ammo: 500, arrows: 50 });
  return state;
}
// A worker on their own at the hub, armed, on the wood job; the rest away on an errand.
function worker(state, job = "wood") {
  const b = hub(state);
  const people = atBase(state, b.id);
  for (const o of people.slice(1)) o.location = { kind: "errand", baseId: b.id, until: 99999 };
  const s = people[0];
  s.role = job; s.station = null; s.pinned = true; s.health = 100; s.inBed = false; s.conditions = []; s.mood = 70;
  s.gear = {}; s.pockets = []; ensureInv(s);
  s.gear.weapon = newItem("machete"); s.gear.armor = newItem("vest");
  return { b, s };
}
// A trip from 08:00 on day 3 (+i), the trouble forced at the work.
function forcedTrip(state, b, s, ev, i) {
  state.hour = 24 * (3 + (i % 40)) + 8;
  const t = planTrip(state, b, s, s.role, state.hour);
  t.n = i; t.evr = 1; s.trip = t;
  t.ev = { at: r2(t.arrive + 0.5), seed: i * 7919 + 13, force: { ...ev } };
  return t;
}
const answer = (state, i) => { const card = state.cards[0]; const c = card.choices[i]; state.cards.shift(); return c.resolve(state); }; // as main.js does

section("What comes at one person (loneattack.js loneEnemy)");
{
  const st = mk(61);
  const farm = fakeTile(st, "plains", "farm", 0.5);
  st.hour = weekWith(st, farm) * 24 * 7;
  const rng = new Rng(3);
  const beast = loneEnemy(st, farm, rng, "beast"), dead = loneEnemy(st, farm, rng, "dead");
  check(beast.beast && beast.types && beast.types[beast.beast] === beast.count && beast.count >= 1 && beast.count <= 3 && /dead (dog|cow|hog|cat)/.test(beast.name), `the dead beasts of a farm: ${beast.name} (power ${beast.power})`);
  check(!dead.beast && dead.count >= 1 && dead.count <= 3 && /of the dead/.test(dead.name) && dead.power >= 2, `or the dead: ${dead.name}`);
  let beasts = 0;
  for (let i = 0; i < 200; i++) if (loneEnemy(st, farm, rng).beast) beasts++;
  check(beasts > 10 && beasts < 150, `the dice decide which (${beasts} of 200 the beasts' here)`);
  const clean = fakeTile(st, "plains", null, 0);
  st.hour = 0;
  check(!loneEnemy(st, clean, rng).beast || !beastMix(st, clean), "no beasts where the land has none");
}

section("A worker on a job trip (tripevents.js raiseCard → the attack card; headless the fight resolves at once)");
{
  const st = mk(62);
  const { b, s } = worker(st, "wood");
  st.autoCombat = true;
  const t = forcedTrip(st, b, s, { kind: "dead", n: 2 }, 1);
  const logN = st.log.length;
  fireTripEvent(st, b, s, t, Math.floor(t.ev.at));
  const card = st.cards[0];
  check(card && card.attack && card.attack.sid === s.id && card.title === `${s.name.split(" ")[0]} was attacked by 2 of the dead` && card.tripEv === s.id, `the card: "${card && card.title}"`);
  check(card && card.choices.length === 3 && card.choices[0].uiAction && card.choices[0].uiAction.type === "saveFight" && /^Save and fight$/.test(card.choices[0].label) && card.choices[1].label === "Fight" && /by the numbers|Leave it to them/.test(card.choices[2].label), "Save and fight, Fight, and leaving it to them");
  check(t.ev.pending && holdTrip(st, b, s, t, st.hour), "the worker holds where they are while the card waits");
  answer(st, 1); // Fight: headless, by the numbers at once through the battle's own resolver
  const lines = logText(st, logN);
  check(!t.ev.battle && !t.ev.pending && lines.some((l) => new RegExp(`${s.name.split(" ")[0]}.*(put down|ran from|got away|was killed)`).test(l)), `resolved and the trip steered: "${lines.find((l) => /put down|ran from|got away|was killed/.test(l)) || ""}"`);
  check(!st.cards.length, "the card is gone");
}

section("A worker on a job trip: the battle map, one person with what they carry");
{
  let fought = 0, lone = 0, noStock = 0, held = 0, settled = 0, beastsOn = 0, N = 0;
  for (const [i, ev] of [[{ kind: "dead", n: 2 }, 11], [{ kind: "deadbeast", beast: "deadhound", n: 3 }, 12], [{ kind: "dead", n: 1 }, 13], [{ kind: "deadbeast", beast: "deadstag", n: 1 }, 14]].map((x) => [x[1], x[0]])) {
    const st = mk(60 + i);
    const { b, s } = worker(st, "wood");
    const t = forcedTrip(st, b, s, ev, i);
    fireTripEvent(st, b, s, t, Math.floor(t.ev.at));
    if (!st.cards.length) continue;
    N++;
    inBrowser(() => answer(st, 1));
    const bt = st.combat;
    if (!bt) continue;
    fought++;
    const mine = bt.units.filter((u) => u.side === "player");
    if (mine.length === 1 && mine[0].sid === s.id && mine[0].weapon === "machete") lone++;
    if (bt.setup.afield && bt.pools.length === 1 && bt.pools[0] !== b.stock && !Object.keys(bt.pools[0]).length) noStock++;
    if (ev.kind === "deadbeast" && bt.units.filter((u) => u.ztype === ev.beast).length === ev.n) beastsOn++;
    if (t.ev.battle && holdTrip(st, b, s, t, st.hour + 1)) held++;
    for (let k = 0; k < 80 && !bt.over; k++) { autoPlayerTurn(st); if (!bt.over) runEnemyPhase(st); }
    const logN = st.log.length;
    if (bt.over) closeCombat(st);
    if (bt.over && !t.ev.battle && !t.ev.pending && (!s.alive || logText(st, logN).some((l) => /put down|ran from|got away|was killed/.test(l)))) settled++;
  }
  check(N === 4 && fought === 4, `${fought} of ${N} attacks opened a battle on the map`);
  check(lone === 4, "the battle has that one person only, with their own machete");
  check(noStock === 4, "afield: no stock to draw rounds or shells from (one empty pool)");
  check(beastsOn === 2, "the dead beasts of the event are the enemy (3 dead dogs; a dead stag)");
  check(held === 4, "the trip holds while the fight is on");
  check(settled === 4, `every fight's end steered the trip (${settled} of 4)`);
}

section("The governor's base: no card, settled by the numbers (the dead beasts too)");
{
  const st = mk(63);
  const { b, s } = worker(st, "wood");
  st.autopilot = true;
  const t = forcedTrip(st, b, s, { kind: "deadbeast", beast: "deadhog", n: 2 }, 21);
  const logN = st.log.length;
  fireTripEvent(st, b, s, t, Math.floor(t.ev.at));
  const lines = logText(st, logN);
  check(!st.cards.length && !t.ev.pending && lines.some((l) => /dead hogs/.test(l)), `by the numbers: "${lines.find((l) => /dead hogs/.test(l)) || ""}"`);
  check(TRIP_EV.kinds.deadbeast > 0, "the dead beasts are a kind of trouble on a trip");
}

section("A team on foot: the straggler card (events.js), fought alone on the map or by the numbers");
{
  const st = mk(64);
  const h = hub(st);
  const tile = fakeTile(st, "forest", null, 0.5);
  st.hour = Math.max(0, weekWith(st, tile)) * 24 * 7 + 10;
  const crew = atBase(st, h.id).slice(0, 3);
  for (const m of crew) { m.gear = m.gear || {}; ensureInv(m); if (!m.gear.weapon) m.gear.weapon = newItem("machete"); }
  const l = launchExpedition(st, { memberIds: crew.map((x) => x.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
  const p = l && l.party;
  check(!!p && p.vehicle !== true, "a team of three on foot");
  if (p) {
    p.path = [tile]; p.idx = 0;
    st.tiles[tile].infection = 0.5;
    check(TRAVEL_EVENT_IDS.includes("straggler") && stragglerFits(st, p, st.tiles[tile]) && travelEventFits(st, p, "straggler", tile), "the straggler card fits a team on foot on infected ground");
    check(!stragglerFits(st, { ...p, vehicle: true }, st.tiles[tile]), "not a team driving");
    const card = travelEventCard(st, p, "straggler", tile);
    const who = crew.find((m) => m.id === card.attack.sid);
    check(!!who && card.partyId === p.id && /was attacked by/.test(card.title) && card.choices[0].uiAction.type === "saveFight" && card.choices.length === 3, `the card: "${card.title}"`);
    st.cards.push(card);
    inBrowser(() => answer(st, 1));
    const bt = st.combat;
    const mine = bt ? bt.units.filter((u) => u.side === "player") : [];
    check(!!bt && mine.length === 1 && mine[0].sid === who.id && bt.setup.partyId === p.id && bt.setup.afield, "the battle: that one person, the rest of the team off the map, no cargo to draw on");
    if (bt) {
      for (let k = 0; k < 80 && !bt.over; k++) { autoPlayerTurn(st); if (!bt.over) runEnemyPhase(st); }
      const logN = st.log.length;
      if (bt.over) closeCombat(st);
      const lines = logText(st, logN);
      check(bt.over && !st.combat && lines.some((l) => new RegExp(`${who.name}.*(put down|ran from|got away|was lost)`).test(l)), `the log tells it: "${lines.find((l) => /put down|ran from|got away|was lost/.test(l)) || ""}"`);
      check(partyMembers(st, p).length === (who.alive ? 3 : 2), "the team walks on");
    }
    // By the numbers: resolved at once, no map.
    const card2 = travelEventCard(st, p, "straggler", tile);
    st.cards.push(card2);
    const logN2 = st.log.length;
    inBrowser(() => answer(st, 2));
    check(!st.combat && logText(st, logN2).some((l) => /put down|ran from|got away|was lost/.test(l)), "by the numbers: no map, the log tells it");
  }
}

section("Save and fight (ui/settings.js saveBeforeFight)");
{
  try {
    const S = await import("../src/ui/settings.js");
    check(typeof S.saveBeforeFight === "function" && S.saveBeforeFight({ ironman: null }, { started: true }, "x", null) === null, "headless (no save API): nothing written, no error");
  } catch (e) { check(false, `ui/settings.js imports headless: ${e.message}`); }
  const st = mk(65);
  const { b, s } = worker(st, "wood");
  const card = attackCard(st, s, { kind: "zombies", count: 1, power: 2, name: "one of the dead" }, { where: "the woods", text: "t", setup: { tile: b.tile, baseId: b.id, fighterIds: [s.id], afield: true, enemy: { kind: "zombies", count: 1, power: 2, name: "one of the dead" }, ambush: "enemy", canRetreat: true, handler: "lonetest", context: {} }, byNumbers: { label: "No", hint: "", resolve: () => "" } });
  check(card.choices[0].uiAction.name === `Attacked: ${s.name.split(" ")[0]}, the woods`, `the save's name: "${card.choices[0].uiAction.name}"`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
