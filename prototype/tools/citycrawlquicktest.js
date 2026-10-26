// City crawl test, part 3 (split from tools/citycrawltest.js, issue #74; the shared setup in citycrawlkit.js): the parity
// with the raid tickets (issue #21, 10e): the hint line from the archetype; the quick search's parity with the laid-out
// building, every other kind of PLACE_POOL (the first, the third...; the rest are citycrawlquick2test.js); the quick
// search's pieces with and without a vehicle at the rim; the hive crawl takes nothing new.
// Usage: node tools/citycrawlquicktest.js   (BS_QUICK=1: 30 buildings a kind, not 200)
import { partyMembers } from "../src/sim/parties.js";
import * as CC from "../src/sim/citycrawl.js";
import { buildingPlan } from "../src/sim/buildingmaps.js";
import { liftDef } from "../src/sim/furnicarry.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { readFileSync } from "node:fs";
import { crawlIn, testPlace, quickParity, QN } from "./citycrawlkit.js"; // the shared setup (issue #74: the test split in four, run side by side by the gate)

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } };
const t0 = performance.now();

console.log("Parity (issue #21): hints, the quick search (its parity, the even kinds)");
(() => {
  // 10e. The hint line from the archetype; the quick search's parity with the laid-out building; its pieces.
  const { state, p, c } = crawlIn(2106);
  const hosp = testPlace(state, c, "hospital", 5);
  const hint = CC.placeHint(state, c, hosp);
  // After the kind, the place's plan by name (issue #40: buildingmaps.js buildingPlan, "Hospital (Trauma centre): …").
  const hplan = (buildingPlan(state, c.tile, CC.placeOption(c, hosp, c.block)) || {}).vname || "";
  const hhead = hplan ? `Hospital \\(${hplan.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)` : "Hospital";
  check(new RegExp(`^${hhead}: \\d+ floors( open of \\d+)?, wards`).test(hint) && hint.includes(String(CC.placeStoreys(state, c, hosp))), `the hint names the kind's signature rooms: "${hint}"`);
  check(CC.placeHint(state, c, testPlace(state, c, "offices", 5)).includes("offices") && !/Corridor/i.test(CC.placeHint(state, c, testPlace(state, c, "offices", 5))), "an office tower's: offices (not its corridors)");
  // Per kind over QN buildings: every container opened both ways, the supplies found within ±10%.
  const kinds = Object.keys(CC.PLACE_POOL).filter((k, i) => i % 2 === 0); // every other kind (the rest: citycrawlquick2test.js)
  const { bad, worst } = quickParity(state, p, c, kinds);
  check(!bad.length, `a container searched quickly holds what the laid-out building's holds by its table, every other kind (${kinds.join(", ")}) within ±10% (${QN} buildings a kind; worst ${Math.round(worst * 100)}%)${bad.length ? `: off ${bad.join(", ")}` : ""}`);
  // No pieces on foot; with the vehicle at the rim, the worthiest "one" piece once a place.
  const pl = testPlace(state, c, "deptstore", 77);
  const prof = CC.placeProfile(state, c, pl);
  c.enc = null;
  CC.quickSearch(state, p, pl);
  check(!(c.atVehicle || []).length && !partyMembers(state, p).some((s) => s.gear.carry), "no vehicle: the quick search takes no furniture");
  const car = createVehicle(state, "van", { kind: "party", partyId: p.id }, { condition: 90 });
  p.vehicleId = car.id; p.vehicleIds = [car.id];
  const pl2 = testPlace(state, c, "deptstore", 78);
  const best = CC.placeProfile(state, c, pl2).best;
  // No fight on this search: the check is the piece going out to the vehicle, and a fight the dice roll (at least
  // QUICK.fightMin) can end the crawl first, so whether it passed hung on the world's dice (a new world's placement
  // table, issue #42, moved them).
  const Q = CC.CRAWL.QUICK, fightWas = [Q.fight, Q.perBlock, Q.fightMin, Q.fightMax];
  Q.fight = 0; Q.perBlock = 0; Q.fightMin = 0; Q.fightMax = 0;
  try { CC.quickSearch(state, p, pl2); } finally { [Q.fight, Q.perBlock, Q.fightMin, Q.fightMax] = fightWas; }
  check(!best || ((c.atVehicle || []).length === 1 && liftDef(best).carry === "one" && pl2.pieceTaken === best), `a vehicle at the rim: one "one" piece by worth goes out to it (${best})`);
  void prof;
  // The hive crawl takes nothing new.
  const hive = readFileSync(new URL("../src/sim/hivecrawl.js", import.meta.url), "utf8");
  check(!/furnicarry|interiorscenes|floorfolk/.test(hive), "hivecrawl.js imports nothing new");
})();

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
