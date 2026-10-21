// Sandbags (the user's request 2026-10-21: "Add sandbags as a defense build they can be halfcover and when next to
// each other the sprites meld together to make a wall of sandbags. Determine what the recipe cost should be"): the
// 1×1 Sandbags on the Defenses tab (src/sim/buildings.js sandbag1: 1 scrap, a work-hour, from a camp), placed by hand on
// the base map (basemap.js FOOT sandbag1) or laid by the game in a row, half cover on the battle map (combat.js CELL
// sandbag), counted in the yard by the numbers (defences.js TIERS.YARD.sandbags), burst in a fight and refilled as a
// repair (breakdowns.js FIXTURES sandbag1, basemap.js MAP_WEAR.sandbag). The sprite's joins: ui/isoview.js.
// Usage: node tools/sandbagstest.js [seed]
import { createWorld, hub } from "../src/sim/world.js";
import { registerCombatHandler, CELL } from "../src/sim/combat.js";
import { BUILDINGS, addBuilding, queueBuild, constructionHour, canBuild, placeProblem, count, CAMP, SHELTER } from "../src/sim/buildings.js";
import { tierMults, TIERS } from "../src/sim/defences.js";
import { FIXTURES } from "../src/sim/breakdowns.js";
import * as BM from "../src/sim/basemap.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
registerCombatHandler("sbt", () => {});
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; st.landOff = true; return st; };
const rich = (base) => Object.assign(base.stock, { scrap: 999, parts: 99, buildmat: 99, wood: 99999 });
const asCamp = (base) => { base.tier = 0; base.camp = true; base.buildings = []; base.construction = []; delete base.plan; return base; };
const finishAll = (st, base) => { for (let i = 0; i < 40 && base.construction.length; i++) { for (const j of base.construction) j.progress = j.hours; constructionHour(st); } };
const openView = (st, base) => { st.combat = null; globalThis.window = {}; try { const err = BM.openBaseMap(st, base.id); if (err) throw new Error(err); return st.combat; } finally { delete globalThis.window; } };
const cellAt = (b, gx, gy) => { const F = b.deployPlan.fort; return b.cells[(gy + F.oy) * b.w + gx + F.ox]; };

section("The build and its cost");
{
  const d = BUILDINGS.sandbag1;
  check(d && d.name === "Sandbags" && d.tab === "defenses" && d.size === "camp" && d.defence, "Sandbags on the Defenses tab, from a camp");
  check(d.cost.scrap === 1 && Object.keys(d.cost).length === 1 && d.hours === 1, `1 scrap and a work-hour a cell (${JSON.stringify(d.cost)}, ${d.hours} h)`);
  const pos = BUILDINGS.sandbag_wall;
  check(d.cost.scrap * 4 < pos.cost.scrap && d.hours > BUILDINGS.wall1.hours, "four of them less scrap than the 4-cell Sandbag positions, more work a cell than a wooden wall 1×1");
  check(CAMP.build.sandbag1 > 0 && SHELTER.build.sandbag1 > CAMP.build.sandbag1 && d.max > SHELTER.build.sandbag1, `a camp ${CAMP.build.sandbag1}, a shelter ${SHELTER.build.sandbag1}, a base ${d.max}`);
  const st = world(), c = asCamp(hub(st));
  rich(c);
  check(placeProblem(c, "sandbag1") === "" && canBuild(st, c, "sandbag1").ok, "a camp can build them");
  const f = BM.FOOT.sandbag1;
  check(f && f.kind === "defence" && f.k === "sandbag" && f.w === 1 && f.h === 1, "one sandbag cell on the map");
  check(CELL.sandbag.cover === 1 && !CELL.sandbag.walk && !CELL.sandbag.los, "the sandbag cell: half cover, not walked, no block to sight");
  check(BM.buildMenu(st, c).some((m) => m.type === "sandbag1" && m.group === "Defences" && m.ok), "on the base map's Build list under Defences");
  const fx = FIXTURES.sandbag1;
  check(fx && fx.raidOnly && fx.outer && fx.repair.cost.scrap === 1 && fx.repair.hours === 1, "a fixture: worn only in raids, refilled for its own cost");
}

section("Placed by hand, laid by the game");
{
  const st = world(), h = hub(st);
  rich(h);
  const placed = [];
  for (let i = 0; i < 4; i++) {
    queueBuild(st, h, "sandbag1");
    const job = h.construction.filter((c) => c.type === "sandbag1").pop();
    check(BM.placeItem(st, h, `c:${job.id}`, 6 + i, 8, 0) === "", `the ${i + 1}${["st", "nd", "rd", "th"][i]} placed at ${6 + i}, 8, right against the one before`);
    placed.push(job.id);
  }
  finishAll(st, h);
  check(count(h, "sandbag1") === 4 && h.buildings.filter((b) => b.type === "sandbag1").every((b) => b.at && b.at[1] === 8), "four built, each where it was placed");
  // Two more queued from the Construction tab, not placed: the game puts them on from the end of the row.
  queueBuild(st, h, "sandbag1"); queueBuild(st, h, "sandbag1");
  finishAll(st, h);
  const lay = BM.layoutOf(st, h).filter((e) => e.it.type === "sandbag1");
  const cells = new Set(lay.filter((e) => e.at).map((e) => `${e.at[0]},${e.at[1]}`));
  const auto = lay.filter((e) => e.auto && e.at);
  check(auto.length === 2 && auto.every((e) => e.at[1] === 8 && (cells.has(`${e.at[0] - 1},8`) || cells.has(`${e.at[0] + 1},8`))), `the two the game laid carry the row on (${auto.map((e) => e.at.slice(0, 2).join(",")).join(" ")})`);
  const b = openView(st, h);
  check([6, 7, 8, 9].every((x) => cellAt(b, x, 8).k === "sandbag"), "on the battle map: a row of sandbag cells");
  // Half cover by the numbers too: the yard tier.
  const yard = tierMults(st, h).yard;
  h.buildings = h.buildings.filter((x) => x.type !== "sandbag1");
  check(Math.abs(yard - tierMults(st, h).yard - 6 * TIERS.YARD.sandbags) < 1e-9, `the yard tier +${(TIERS.YARD.sandbags * 100).toFixed(1)}% each (${yard.toFixed(3)})`);
  for (let i = 0; i < 40; i++) addBuilding(h, "sandbag1");
  check(Math.abs(tierMults(st, h).yard - yard + 6 * TIERS.YARD.sandbags - TIERS.YARD.sandbagMax * TIERS.YARD.sandbags) < 1e-9, `at most the first ${TIERS.YARD.sandbagMax} count`);
}

section("Burst in a fight, no cover until refilled");
{
  const st = world(), h = hub(st);
  rich(h);
  const keep = addBuilding(h, "sandbag1"), burst = addBuilding(h, "sandbag1");
  check(BM.placeItem(st, h, `b:${keep.id}`, 6, 8, 0) === "" && BM.placeItem(st, h, `b:${burst.id}`, 7, 8, 0) === "", "two side by side");
  const b = openView(st, h);
  cellAt(b, 7, 8).k = "open"; // smashed by the dead (zombietypes.js SMASH) or shoved off
  delete b.layout; delete b.drill; b.units = b.units || []; // as a raid's map: the view is a drill (settleBaseBattle skips one)
  BM.settleBaseBattle(st, b);
  st.combat = null;
  check(burst.broken && !keep.broken && !(keep.wear > 0), "the one gone from its cell is burst, the other untouched");
  check(count(h, "sandbag1") === 1, "a burst one does not count");
  const b2 = openView(st, h);
  check(cellAt(b2, 6, 8).k === "sandbag" && cellAt(b2, 7, 8).k !== "sandbag", "on the next map the burst cell is open ground");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
