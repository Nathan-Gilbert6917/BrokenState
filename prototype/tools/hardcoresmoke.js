// Smoke test for hardcore mode: a hardcore world can be created and run for a few days, and a normal world still
// starts with its hub; the hardcore start doubles every POI pool (hardcore-loot.js) and the surplus wears off.
// Usage: node tools/hardcoresmoke.js
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { poisOf, isSitePoi } from "../src/sim/pois.js";
import { HC_LOOT } from "../src/sim/hardcore-loot.js";

let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fail++; };

const normal = createWorld({ seed: 4242, factionCount: 7 });
check(normal.mode === "normal" && normal.bases.length === 1 && normal.survivors.length === 6, "normal world: one hub, six survivors");

const hc = createWorld({ seed: 4242, factionCount: 7, mode: "hardcore" });
check(hc.mode === "hardcore", "hardcore world: mode set");
// Points of interest (pois.js, Session 4b): every POI's own pool starts at hardcore-loot.js HC_LOOT.START × a normal start.
const pois = hc.tiles.flatMap((t) => poisOf(t).map((p, i) => [t, p, i])).filter(([t, p, i]) => !isSitePoi(t, i) && p.pool > 0);
check(pois.length > 0 && pois.every(([, p]) => p.poolNormal > 0 && Math.abs(p.pool - p.poolNormal * HC_LOOT.START) < 1e-9), `hardcore world: ${pois.length} POI pools at ${HC_LOOT.START} × a normal start`);
const normalPoi = normal.tiles.flatMap((t) => poisOf(t)).filter((p) => p.pool > 0);
check(normalPoi.every((p) => p.poolNormal == null), "normal world: POI pools as made");
try {
  for (let i = 0; i < 24 * 5; i++) tickHour(hc);
  check(day(hc) >= 5, `hardcore world runs (day ${day(hc)})`);
  check(pois.every(([, p]) => p.poolNormal == null || p.pool < p.poolNormal * HC_LOOT.START), "the POI surplus wears off day by day");
} catch (e) {
  check(false, `hardcore world runs: ${e.stack.split("\n").slice(0, 3).join(" | ")}`);
}
process.exit(fail ? 1 : 0);
