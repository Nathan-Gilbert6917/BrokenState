// Smoke test for hardcore mode: a hardcore world can be created and run for a few days, and a normal world still
// starts with its hub. Usage: node tools/hardcoresmoke.js
import { createWorld, tickHour, day } from "../src/sim/world.js";

let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fail++; };

const normal = createWorld({ seed: 4242, factionCount: 7 });
check(normal.mode === "normal" && normal.bases.length === 1 && normal.survivors.length === 6, "normal world: one hub, six survivors");

const hc = createWorld({ seed: 4242, factionCount: 7, mode: "hardcore" });
check(hc.mode === "hardcore", "hardcore world: mode set");
try {
  for (let i = 0; i < 24 * 5; i++) tickHour(hc);
  check(day(hc) >= 5, `hardcore world runs (day ${day(hc)})`);
} catch (e) {
  check(false, `hardcore world runs: ${e.stack.split("\n").slice(0, 3).join(" | ")}`);
}
process.exit(fail ? 1 : 0);
