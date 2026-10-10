// Headless balance/smoke test: runs the simulation without any UI.
// Usage: node tools/simtest.js [days] [seed] [factions] [size=small|normal|large|huge]
import { hiveTracker } from "../src/sim/hives.js";
import { createWorld, tickHour, day, alive, hub } from "../src/sim/world.js";
import { launchExpedition, estimateTrip, startReturn } from "../src/sim/parties.js";
import { searchHour, extract } from "../src/sim/scavenge.js";
import { executeTrade, endTrade } from "../src/sim/trade.js";
import { attitude } from "../src/sim/factions.js";
import { takeSize } from "./sizearg.js";

const size = takeSize();

const days = Number(process.argv[2] || 60);
const seed = Number(process.argv[3] || 12345);
const factionCount = Number(process.argv[4] || 7);

const state = createWorld({ seed, factionCount, size });
const t0 = performance.now();
let cardsResolved = 0;

function autoplay() {
  // Resolve cards with the first enabled choice.
  while (state.cards.length) {
    const c = state.cards.shift();
    const ch = (c.choices.find((x) => x.label === "Return home") || c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled)));
    if (ch) ch.resolve(state);
    cardsResolved++;
  }
  if (state.engagement) {
    if (!state.engagement.approach) state.engagement.approach = "normal";
    if (state.engagement.hours < 3 && state.engagement.heat < 50) {
      searchHour(state);
      tickHour(state);
    } else extract(state);
  }
  if (state.trade) {
    executeTrade(state);
    endTrade(state);
  }
  // Teams waiting for orders head home.
  for (const p of state.parties) if (p.owner === "player" && p.phase === "waiting") startReturn(state, p);
  // Every 6 days send a scavenging team to a random known location.
  if (state.hour % (24 * 6) === 12 && !state.parties.some((p) => p.owner === "player")) {
    const h = hub(state);
    const people = alive(state).filter((s) => s.location.kind === "base" && s.location.baseId === h.id).slice(0, 2);
    const targets = state.tiles.filter((t) => t.loc && state.grid.distance(t.id, h.tile) <= 8 && t.id !== h.tile);
    const dest = state.rng.pick(targets).id;
    const est = estimateTrip(state, { memberIds: people.map((s) => s.id), dest, vehicle: false, stance: "normal" });
    if (est && people.length) {
      const res = launchExpedition(state, {
        memberIds: people.map((s) => s.id), dest, mission: "scavenge", stance: "normal",
        supplies: { food: Math.min(h.stock.food, est.food + 2), water: Math.min(h.stock.water, est.water + 2), ammo: Math.min(h.stock.ammo, 20) },
      });
      if (res.error) console.log("launch error:", res.error);
    }
  }
}

while (day(state) <= days && !state.gameOver) {
  tickHour(state);
  autoplay();
}
const ms = performance.now() - t0;
const h = hub(state);
console.log(`Simulated ${day(state) - 1} days in ${ms.toFixed(0)} ms (seed ${seed}, ${state.grid.width}×${state.grid.height} map, ${state.factions.length} groups).`);
console.log(`Survivors alive: ${alive(state).length}, game over: ${state.gameOver}`);
console.log("Hub stock:", h ? JSON.stringify(h.stock) : "(no hub left: every base lost)");
console.log(`Hordes: ${state.hordes.length} (sizes ${state.hordes.map((x) => x.size).join(", ")})`);
{
  const hv = hiveTracker(state);
  console.log(`Hives: ${hv.hives} (built ${hv.stats.built}, destroyed ${hv.stats.destroyed}, resources ${hv.res}, +${hv.income}/day), build sites ${hv.sites.length}, horde attacks on your bases: held ${hv.stats.held}, break-ins ${hv.stats.breakIns} (beaten ${hv.stats.repelled}, overrun ${hv.stats.overrun})${state.victory ? " · VICTORY" : ""}`);
}
console.log(`Death sites: ${state.deathSites.length}, cards resolved: ${cardsResolved}`);
for (const f of state.factions) console.log(`  ${f.alive ? "" : "[gone] "}${f.name} (${f.type}) pop ${f.pop}, bases ${f.bases.length}, goodwill ${f.goodwill.toFixed(0)} ${attitude(f)}`);
console.log("Recent log:");
for (const l of state.log.slice(0, 15)) console.log(`  d${Math.floor(l.hour / 24) + 1} ${l.text}`);
