// Sickness census: autopilot campaigns (normal or hardcore) for a game year (112 days), counting what illness does:
// illnesses (and injuries) that start, by kind, by cause and by season; illness-days; meds spent on illness (bases and
// teams); deaths from illness and all deaths; meds in stock (bases + teams) at the end of each season.
// Read-only: it watches the survivors' conditions hour by hour and changes nothing.
// Usage: node tools/sickcensus.js [days=112] [runs=20] [normal|hardcore] [style=balanced] [firstSeed=1] [--json path]
import { writeFileSync } from "node:fs";
import { createWorld, tickHour, day, alive } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { CONDITIONS } from "../src/sim/health.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const jsonAt = process.argv.indexOf("--json");
const DAYS = Number(args[0] || 112), RUNS = Number(args[1] || 20), MODE = args[2] || "normal", STYLE = args[3] || "balanced", FIRST = Number(args[4] || 1);

// Where a case came from: the condition's cause tag (health.js, newer code) or its "why" text.
function causeOf(c) {
  if (c.cause) return c.cause;
  const w = c.why || "";
  if (/caught from/.test(w)) return "contagion";
  if (/went to the lungs|after the/.test(w)) return "worsened";
  if (/crowded/.test(w)) return "crowding";
  if (/dirty water/.test(w)) return "water";
  if (/unboiled|cold food/.test(w)) return "camp";
  if (/mushroom/.test(w)) return "mushroom";
  if (/hunger|drinking|puddles/.test(w)) return "hunger";
  if (/heat|cold|freez|blizzard|rain|bitter/.test(w)) return "weather";
  if (/searching|filth/.test(w)) return "search";
  if (/wound/.test(w)) return "wound";
  return "work";
}
const ILL_DEATH = /of (fever|flu|dysentery|pneumonia|an infected wound|a chill|cold sickness|stomach|infection)/;
const medsHeld = (state) => state.bases.reduce((a, b) => a + Math.max(0, b.stock.meds || 0), 0)
  + state.parties.filter((p) => p.owner === "player").reduce((a, p) => a + Math.max(0, (p.supplies && p.supplies.meds) || 0) + Math.max(0, (p.cargo && p.cargo.supplies && p.cargo.supplies.meds) || 0), 0);

const rows = [];
const t0 = Date.now();
for (let i = 0; i < RUNS; i++) {
  const seed = FIRST + i;
  const state = createWorld({ seed, factionCount: 7, ...(MODE === "hardcore" ? { mode: "hardcore" } : {}) });
  setAutopilot(state, true, STYLE);
  const seen = new Set();
  const ill = { n: 0, byKey: {}, byCause: {}, bySeason: [0, 0, 0, 0], days: 0, injuries: 0 };
  const meds = {};
  let lastDay = 0, popDays = 0;
  while (day(state) < DAYS && !state.gameOver) {
    tickHour(state);
    for (const s of state.survivors) {
      if (!s.alive || !Array.isArray(s.conditions)) continue;
      for (const c of s.conditions) {
        const d = CONDITIONS[c.key];
        if (!d) continue;
        const k = `${s.id}:${c.key}:${c.since}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (d.kind !== "illness") { ill.injuries++; continue; }
        ill.n++;
        ill.byKey[c.key] = (ill.byKey[c.key] || 0) + 1;
        const cs = causeOf(c);
        ill.byCause[cs] = (ill.byCause[cs] || 0) + 1;
        ill.bySeason[Math.min(3, Math.floor((day(state) - 1) / 28))]++;
      }
    }
    if (state.hour % 24 === 0) {
      const d = day(state);
      for (const s of alive(state)) { popDays++; if ((s.conditions || []).some((c) => CONDITIONS[c.key] && CONDITIONS[c.key].kind === "illness")) ill.days++; }
      if (d % 28 === 1 && d > 1) meds[d - 1] = Math.round(medsHeld(state));
      lastDay = d;
    }
  }
  meds.end = Math.round(medsHeld(state));
  const deaths = (state.memorial || []).length;
  const illDeaths = (state.memorial || []).filter((m) => ILL_DEATH.test(m.cause || "")).length;
  const st = state.sickStats || {};
  rows.push({ seed, survived: !state.gameOver, day: lastDay, alive: alive(state).length, popDays, ill, medsIll: state.medsUsed || 0, medsBase: st.medsBase, medsTeam: st.medsTeam, meds, deaths, illDeaths });
  console.log(`seed ${seed}: ${state.gameOver ? `fell day ${lastDay}` : `day ${lastDay}`} · ${alive(state).length} alive · illnesses ${ill.n} (${Object.entries(ill.byKey).map(([k, v]) => `${k} ${v}`).join(", ")}) · by season ${ill.bySeason.join("/")} · injuries ${ill.injuries} · ill-days ${ill.days} of ${popDays} person-days · meds on illness ${state.medsUsed || 0}${st.medsBase != null ? ` (base ${st.medsBase}, team ${st.medsTeam})` : ""} · meds held ${Object.entries(meds).map(([k, v]) => `${k}:${v}`).join(" ")} · deaths ${deaths} (illness ${illDeaths})`);
}
const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
const avg = (f) => Math.round((sum(f) / rows.length) * 10) / 10;
const causes = {};
for (const r of rows) for (const [k, v] of Object.entries(r.ill.byCause)) causes[k] = (causes[k] || 0) + v;
const keys = {};
for (const r of rows) for (const [k, v] of Object.entries(r.ill.byKey)) keys[k] = (keys[k] || 0) + v;
const per10 = Math.round((sum((r) => r.ill.n) / Math.max(1, sum((r) => r.popDays)) * 10 * 28) * 10) / 10;
console.log(`\n${MODE} ${STYLE}, ${RUNS} runs to day ${DAYS} (${Math.round((Date.now() - t0) / 1000)}s)`);
console.log(`survived ${rows.filter((r) => r.survived).length}/${rows.length} · alive avg ${avg((r) => r.alive)} · deaths avg ${avg((r) => r.deaths)} · illness deaths avg ${avg((r) => r.illDeaths)} (${sum((r) => r.illDeaths)} in all)`);
console.log(`illnesses per game avg ${avg((r) => r.ill.n)} · per 10 people per season ${per10} · by season ${[0, 1, 2, 3].map((q) => avg((r) => r.ill.bySeason[q])).join("/")} · injuries avg ${avg((r) => r.ill.injuries)} · ill person-days ${Math.round(sum((r) => r.ill.days) / Math.max(1, sum((r) => r.popDays)) * 1000) / 10}%`);
console.log(`by kind: ${Object.entries(keys).map(([k, v]) => `${k} ${Math.round(v / rows.length * 10) / 10}`).join(", ")}`);
console.log(`by cause: ${Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / rows.length * 10) / 10}`).join(", ")}`);
console.log(`meds on illness avg ${avg((r) => r.medsIll)}${rows[0].medsBase != null ? ` (base ${avg((r) => r.medsBase || 0)}, team ${avg((r) => r.medsTeam || 0)})` : ""} · meds held avg ${[28, 56, 84].map((k) => `d${k} ${avg((r) => r.meds[k] ?? 0)}`).join(", ")}, end ${avg((r) => r.meds.end)}`);
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(rows, null, 1));
