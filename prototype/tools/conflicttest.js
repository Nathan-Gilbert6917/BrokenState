// Headless conflict test: long campaigns with an auto-player that sends teams out often and picks
// varied card options. Reports how often each conflict type and outcome happens, conflicts per trip,
// captives taken and rescued, and checks for crashes and stuck teams.
// Usage: node tools/conflicttest.js [days] [seeds...]
import { createWorld, tickHour, day, alive, hub, atBase, combatPower } from "../src/sim/world.js";
import { launchExpedition, estimateTrip, startReturn, partyMembers } from "../src/sim/parties.js";
import { searchHour, extract } from "../src/sim/scavenge.js";
import { executeTrade, endTrade } from "../src/sim/trade.js";
import { allCaptives } from "../src/sim/conflicts.js";
import { vehiclesAtBase } from "../src/sim/vehicles.js";
import { Rng } from "../src/sim/rng.js";
import { POLICY_ORDER, RETREAT_POLICIES, teamPolicy } from "../src/sim/breakoff.js";

const days = Number(process.argv[2] || 120);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1, 2, 3, 4, 5, 6];

const total = { types: {}, outcomes: {}, captured: 0, rescued: 0, joined: 0, captiveEvents: {} };
const tripHist = {}; // conflicts per trip (trips of 3-5 days)
const allTripHist = {};
const byLen = {};
let trips = 0, problems = 0, conflictCards = 0, rescueLaunches = 0;
// Retreat by the numbers (breakoff.js): every team goes out with a random "Retreat if it goes badly" policy; fight
// choices carry their fight for the card's policy row and forecast; broken-off fights are counted by policy.
const policyFights = Object.fromEntries(POLICY_ORDER.map((k) => [k, { fights: 0, retreats: 0 }]));
let fightChoices = 0, badFight = 0;

function addInto(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === "number") a[k] = (a[k] || 0) + v;
    else addInto((a[k] = a[k] || {}), v);
  }
}

for (const seed of seeds) {
  const state = createWorld({ seed, factionCount: 8 });
  const pick = new Rng(seed * 7919 + 1);
  const tracked = new Map(); // party id -> party
  let engagedSince = new Map();
  try {
    while (day(state) <= days && !state.gameOver) {
      tickHour(state);
      // Cards: pick a random enabled choice (never the "move" one, which needs a map click).
      let n = 0;
      while (state.cards.length) {
        if (++n > 60) { console.log(`seed ${seed}: possible card loop at day ${day(state)}: ${state.cards[0].title}`); problems++; state.cards.length = 0; break; }
        const c = state.cards.shift();
        if (c.kind === "conflict") conflictCards++;
        const opts = c.choices.filter((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled));
        for (const x of c.choices) if (x.fight && x.fight.enemy) { fightChoices++; if (!(x.fight.enemy.count > 0) || (x.fight.odds != null && !(x.fight.odds >= 0 && x.fight.odds <= 1))) badFight++; }
        if (!opts.length) continue;
        // Mostly random, but keep the after-fight teams moving rather than idling.
        const ch = pick.pick(opts);
        const fp = ch.fight && c.partyId != null ? state.parties.find((x) => x.id === c.partyId) : null;
        const pol = fp ? teamPolicy(state, fp) : null;
        const r0 = (state.stats.conflicts && state.stats.conflicts.outcomes["combat-retreat"]) || 0;
        ch.resolve(state);
        if (pol && ch.fight.enemy) { policyFights[pol].fights++; if (((state.stats.conflicts && state.stats.conflicts.outcomes["combat-retreat"]) || 0) > r0) policyFights[pol].retreats++; }
      }
      if (state.engagement) {
        if (!state.engagement.approach) state.engagement.approach = "normal";
        if (state.engagement.hours < 3 && state.engagement.heat < 50) searchHour(state);
        else extract(state);
      }
      if (state.trade) {
        executeTrade(state);
        endTrade(state);
      }
      const h = hub(state);
      for (const p of state.parties) {
        if (p.owner !== "player") continue;
        tracked.set(p.id, p);
        if (p.phase === "waiting") startReturn(state, p);
        // Stuck detection: engaged with nothing to resolve it.
        if (p.phase === "engaged" && !state.cards.length && !state.engagement && !state.trade) {
          const since = engagedSince.get(p.id) ?? state.hour;
          engagedSince.set(p.id, since);
          if (state.hour - since > 48) { console.log(`seed ${seed}: team ${p.id} stuck engaged since day ${Math.floor(since / 24) + 1} (mission ${p.mission})`); problems++; p.phase = "back"; engagedSince.delete(p.id); }
        } else engagedSince.delete(p.id);
      }
      // Trips that ended.
      for (const [id, p] of tracked) {
        if (state.parties.includes(p)) continue;
        tracked.delete(id);
        if (p.kind === "convoy") continue;
        trips++;
        const k = p.conflictCount || 0;
        allTripHist[k] = (allTripHist[k] || 0) + 1;
        const len = (state.hour - p.departed) / 24;
        if (len >= 3 && len <= 5) tripHist[k] = (tripHist[k] || 0) + 1;
        const b = len < 1 ? "<1d" : len < 2 ? "1-2d" : len < 3 ? "2-3d" : len <= 5 ? "3-5d" : ">5d";
        (byLen[b] = byLen[b] || { trips: 0, conflicts: 0 }).trips++;
        byLen[b].conflicts += k;
      }
      // Send teams out every 2 days (morning), up to two at a time.
      const mine = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy");
      if (h && state.hour % 48 === 8 && mine.length < 2) { // no hub: the random player abandoned its last base to a raid (conquest.js retreat)
        const pool = atBase(state, h.id).filter((s) => s.health > 50);
        if (pool.length >= 3) {
          const captives = allCaptives(state);
          let dest, mission;
          if (captives.length && !mine.some((p) => p.mission === "rescue") && pick.chance(0.7)) {
            dest = captives[0].location.tile;
            mission = "rescue";
            rescueLaunches++;
          } else {
            const targets = state.tiles.filter((t) => t.terrain !== "water" && state.grid.distance(t.id, h.tile) >= 4 && state.grid.distance(t.id, h.tile) <= pick.pick([8, 12, 16]));
            dest = pick.pick(targets).id;
            const fb = state.factions.find((f) => f.alive && f.bases.includes(dest));
            mission = fb ? "trade" : state.tiles[dest].loot > 0.1 ? pick.pick(["scavenge", "recon"]) : pick.pick(["recon", "move"]);
          }
          const crew = pool.sort((a, b) => combatPower(b) - combatPower(a)).slice(0, mission === "rescue" ? 3 : pick.int(2, 3));
          const truck = pick.chance(0.4) ? vehiclesAtBase(state, h.id).find((v) => v.condition > 30 && v.fuel > 6) : null;
          const stance = pick.pick(["stealthy", "normal", "normal", "rushed"]);
          const est = estimateTrip(state, { memberIds: crew.map((s) => s.id), dest, vehicle: !!truck, stance });
          if (est) {
            const sup = {
              food: Math.min(Math.floor(h.stock.food), Math.ceil(est.food * 1.3) + 1),
              water: Math.min(Math.floor(h.stock.water), Math.ceil(est.water * 1.3) + 1),
              ammo: Math.min(Math.floor(h.stock.ammo), 15 * crew.length),
              meds: Math.min(Math.floor(h.stock.meds), 2),
              fuel: truck ? Math.min(Math.floor(h.stock.fuel), 6) : 0,
            };
            const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission, stance, vehicleId: truck ? truck.id : null, supplies: sup });
            if (res.error && !/route/.test(res.error)) console.log(`seed ${seed}: launch error: ${res.error}`);
            else if (res.party) res.party.retreatPolicy = POLICY_ORDER[(res.party.id + seed) % POLICY_ORDER.length]; // as if set on its first card
          }
        }
      }
      // Keep the hub fed so the campaign keeps sending teams (this test is about conflicts, not farming).
      if (h && state.hour % 24 === 0 && h.stock.food < 30) h.stock.food += 30;
    }
  } catch (e) {
    problems++;
    console.log(`seed ${seed}: CRASH on day ${day(state)}:`, e.stack);
  }
  const cs = state.stats.conflicts || { types: {}, outcomes: {}, captured: 0, rescued: 0, joined: 0, captiveEvents: {} };
  addInto(total, cs);
  const held = allCaptives(state).length;
  console.log(`seed ${seed}: day ${day(state)}, alive ${alive(state).length}, gameOver ${state.gameOver}, conflicts ${Object.values(cs.types).reduce((a, b) => a + b, 0)}, captured ${cs.captured}, rescued ${cs.rescued}, still held ${held}`);
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log("\nConflict types:", total.types, `(total ${sum(total.types)})`);
console.log("Outcomes:", total.outcomes);
console.log(`Captured ${total.captured}, rescued/freed back to a team ${total.rescued}, strangers joined ${total.joined}, rescue launches ${rescueLaunches}`);
console.log("Captive events:", total.captiveEvents);
console.log(`Trips: ${trips}. Conflicts per trip (all):`, allTripHist);
console.log("Conflicts per trip (3-5 day trips):", tripHist);
console.log("Mean conflicts per trip by trip length:", Object.fromEntries(Object.entries(byLen).map(([k, v]) => [k, `${v.trips} trips, ${(v.conflicts / v.trips).toFixed(2)}`])));
console.log(`Fight choices: ${fightChoices} (${badFight} without a usable fight for the card's forecast). Fights by the team's retreat policy: ${POLICY_ORDER.map((k) => `${RETREAT_POLICIES[k].name} ${policyFights[k].retreats}/${policyFights[k].fights} broken off`).join(", ")}`);
if (badFight) { console.log("PROBLEM: a fight choice without a usable fight"); problems++; }
if (policyFights.never.retreats) { console.log("PROBLEM: a team set to Never broke off a fight by the numbers"); problems++; }
const tried = POLICY_ORDER.filter((k) => k !== "never").reduce((a, k) => a + policyFights[k].fights, 0);
if (tried >= 10 && !POLICY_ORDER.some((k) => k !== "never" && policyFights[k].retreats)) { console.log("PROBLEM: no team ever broke off a fight by its policy"); problems++; }
console.log(`Conflict cards shown: ${conflictCards}. Problems: ${problems}`);
if (problems) process.exitCode = 1;
