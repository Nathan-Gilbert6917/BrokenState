// City crawl test, part 4 (split from tools/citycrawltest.js, issue #74; the shared setup in citycrawlkit.js): the quick
// search's parity with the laid-out building (issue #21, 10e), the kinds of PLACE_POOL citycrawlquicktest.js leaves
// out (the second, the fourth...): a container searched quickly holds what the map's holds, within ±10%.
// Usage: node tools/citycrawlquick2test.js   (BS_QUICK=1: 30 buildings a kind, not 200)
import * as CC from "../src/sim/citycrawl.js";
import { crawlIn, quickParity, QN } from "./citycrawlkit.js"; // the shared setup (issue #74: the test split in four, run side by side by the gate)

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } };
const t0 = performance.now();

console.log("Parity (issue #21): the quick search (its parity, the odd kinds)");
(() => {
  // 10e (the rest of it in citycrawlquicktest.js): the quick search's parity with the laid-out building, the other kinds.
  const { state, p, c } = crawlIn(2106);
  const kinds = Object.keys(CC.PLACE_POOL).filter((k, i) => i % 2 === 1); // the second, the fourth... (the rest: citycrawlquicktest.js)
  const { bad, worst } = quickParity(state, p, c, kinds);
  check(!bad.length, `a container searched quickly holds what the laid-out building's holds by its table, every other kind (${kinds.join(", ")}) within ±10% (${QN} buildings a kind; worst ${Math.round(worst * 100)}%)${bad.length ? `: off ${bad.join(", ")}` : ""}`);
})();

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
