// Needs balance sample: autopilot campaigns (normal or hardcore) to a day, with what the needs model touches:
// survival, people alive, deaths by hunger, thirst and cold (and all deaths), hub fuel on days 60, 75 and 90 (winter is
// about campaign days 71-98), days a base went without heating fuel, days a team member's hunger or thirst was empty.
// Read-only (it changes no rule): every run plays out as it would without it.
// Usage: node tools/needsbalance.js [days=100] [runs=20] [normal|hardcore] [style=balanced] [firstSeed=1] [--json path]
import { writeFileSync } from "node:fs";
import { createWorld, tickHour, day, alive, hub } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { HEAT } from "../src/sim/upkeep.js";
// --noheat: no heating need (to tell the gauges' effect from the heating's).
if (process.argv.includes("--noheat")) HEAT.fuel = 0;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const jsonAt = process.argv.indexOf("--json");
const DAYS = Number(args[0] || 100), RUNS = Number(args[1] || 20), MODE = args[2] || "normal", STYLE = args[3] || "balanced", FIRST = Number(args[4] || 1);

const bucket = (c) => (/hunger|starvation/.test(c) ? "hunger" : /thirst/.test(c) ? "thirst" : /\bcold\b|froze/.test(c) ? "cold" : "other");
const rows = [];
const t0 = Date.now();
for (let i = 0; i < RUNS; i++) {
  const seed = FIRST + i;
  const state = createWorld({ seed, factionCount: 7, ...(MODE === "hardcore" ? { mode: "hardcore" } : {}) });
  setAutopilot(state, true, STYLE);
  const fuel = {};
  let coldDays = 0, emptyH = 0, emptyT = 0, rationDays = 0;
  let lastDay = 0;
  while (day(state) < DAYS && !state.gameOver) {
    tickHour(state);
    if (state.hour % 24 === 0) {
      const d = day(state);
      const h = hub(state);
      for (const k of [60, 75, 90]) if (d === k) fuel[k] = h ? Math.round(h.stock.fuel || 0) : null;
      for (const b of state.bases) { if (b.cold) coldDays++; if (b.rationing) rationDays++; }
      lastDay = d;
    }
    if (state.hour % 6 === 0) for (const s of alive(state)) { if ((s.hunger ?? 100) <= 0) emptyH++; if ((s.thirst ?? 100) <= 0) emptyT++; }
  }
  const deaths = { hunger: 0, thirst: 0, cold: 0, other: 0 };
  for (const m of state.memorial || []) deaths[bucket(m.cause || "")]++;
  const left = (state.survivors || []).filter((s) => s.left).length;
  rows.push({ seed, survived: !state.gameOver, day: lastDay, alive: alive(state).length, deaths, left, fuel, coldDays, emptyH: emptyH / 4, emptyT: emptyT / 4, rationDays });
  console.log(`seed ${seed}: ${state.gameOver ? `fell day ${lastDay}` : `day ${lastDay}`} · ${alive(state).length} alive · deaths hunger ${deaths.hunger} thirst ${deaths.thirst} cold ${deaths.cold} other ${deaths.other} · left ${left} · fuel d60/75/90 ${fuel[60] ?? "-"}/${fuel[75] ?? "-"}/${fuel[90] ?? "-"} · cold base-days ${coldDays} · empty hunger/thirst person-days ${emptyH / 4}/${emptyT / 4} · rationing base-days ${rationDays}`);
}
const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
const avg = (f) => Math.round((sum(f) / rows.length) * 10) / 10;
const fuelAvg = (k) => { const v = rows.filter((r) => r.fuel[k] != null); return v.length ? Math.round(v.reduce((a, r) => a + r.fuel[k], 0) / v.length) : "-"; };
console.log(`\n${MODE} ${STYLE}, ${RUNS} runs to day ${DAYS} (${Math.round((Date.now() - t0) / 1000)}s)`);
console.log(`survived ${rows.filter((r) => r.survived).length}/${rows.length} · alive avg ${avg((r) => r.alive)} · deaths avg ${avg((r) => r.deaths.hunger + r.deaths.thirst + r.deaths.cold + r.deaths.other)} (hunger ${sum((r) => r.deaths.hunger)}, thirst ${sum((r) => r.deaths.thirst)}, cold ${sum((r) => r.deaths.cold)} in all) · deserters avg ${avg((r) => r.left)}`);
console.log(`hub fuel avg day 60 ${fuelAvg(60)}, day 75 ${fuelAvg(75)}, day 90 ${fuelAvg(90)} · cold base-days ${sum((r) => r.coldDays)} · empty-gauge person-days hunger ${sum((r) => r.emptyH)}, thirst ${sum((r) => r.emptyT)} · rationing base-days ${sum((r) => r.rationDays)}`);
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(rows, null, 1));
