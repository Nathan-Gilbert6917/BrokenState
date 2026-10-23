// Stone (sim/stone.js; the user's request 2026-10-23: "Add rocks as a material to gather like wood can be gathered from
// demolition of rocks in build mode and add a gathering job. This is used to create campfires and update other
// buildings that make sense to use rocks in the cost/recipe ... The first campfire for hardcore will also require the
// cost of wood and stone").
//   - the supply; rocks and boulders cleared on the build map give stone;
//   - the base job Gather stone: open while the stores are short, the day's stone into the stores;
//   - the team order Gather stone: stone into the team's cargo;
//   - the buildings with stone in their cost;
//   - a camp's fire takes its wood and stone carried (Set up camp, Establish base: hardcore's first camp), taken when
//     the camp stands; the governor is never held up by it.
// Usage: node tools/stonetest.js [seed]
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { SUPPLIES } from "../src/sim/data.js";
import { BUILDINGS, CAMP } from "../src/sim/buildings.js";
import { CLEAR } from "../src/sim/basescatter.js";
import { STONE, stoneAbundance, stoneDaily, stoneShort, quarryCrew } from "../src/sim/stone.js";
import { WORK_TYPES, WORK_KEYS } from "../src/sim/work.js";
import { ROLES } from "../src/sim/economy.js";
import { startOrder } from "../src/sim/orders.js";
import { launchExpedition, giveOrder, orderOptions, partyTile } from "../src/sim/parties.js";
import { fireCostProblem, campOption } from "../src/sim/staging.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { poiKnowledge } from "../src/sim/pois.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const world = (opts = {}) => { const st = createWorld({ seed, factionCount: 6, ...opts }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; return st; };

section("The supply, and the rocks on the build map");
{
  check(SUPPLIES.stone && SUPPLIES.stone.weight === 1, "Stone: a supply, 1 kg a unit");
  check(CLEAR.rock.get.stone > 0 && CLEAR.boulder.get.stone > CLEAR.rock.get.stone, `a rock rolled away gives stone (${CLEAR.rock.get.stone}), a boulder broken up more (${CLEAR.boulder.get.stone})`);
}

section("Buildings that take stone");
{
  for (const k of ["cookhouse", "boiler", "canteen", "well", "cistern", "cellar"]) check((BUILDINGS[k].cost.stone || 0) > 0, `${BUILDINGS[k].name}: ${BUILDINGS[k].cost.stone || 0} stone`);
  check(!BUILDINGS.camp_up.cost.stone && !BUILDINGS.outpost_up.cost.stone, "the step ups are as they were");
  check(CAMP.fireCost.wood > 0 && CAMP.fireCost.stone > 0, `a camp's fire: ${CAMP.fireCost.wood} wood, ${CAMP.fireCost.stone} stone`);
}

section("The Gather stone job at a base");
{
  const st = world();
  const h = hub(st);
  check(WORK_KEYS.includes("stone") && ROLES.stone && WORK_TYPES.stone.role === "stone", "a job on the Work tab, and a fixed job");
  h.stock.stone = 0;
  check(stoneShort(st, h) >= STONE.keep, `short with none in the stores (${stoneShort(st, h)})`);
  const ctx = { state: st, base: h, people: atBase(st, h.id) };
  const open = WORK_TYPES.stone.open(ctx);
  if (stoneAbundance(st, h.tile) >= 0.1) check(open.cap >= 1, `open while short (${JSON.stringify(open)})`);
  h.stock.stone = STONE.keep + 5;
  check(WORK_TYPES.stone.open(ctx).cap === 0, "closed with enough in the stores");
  h.stock.stone = 0;
  const [a, b] = atBase(st, h.id);
  a.role = "stone"; b.role = "stone";
  const got = stoneDaily(st, h);
  if (stoneAbundance(st, h.tile) >= 0.1) check(got && got.stone > 0 && h.stock.stone === got.stone, `two gatherers bring in a day's stone (${got && got.stone})`);
  const crew = quarryCrew([a], [{ key: "pickaxe", name: "Pickaxe" }]);
  check(crew[0].tool && crew[0].tool.key === "pickaxe", "a pickaxe from the armory goes to someone without a tool");
}

section("The Gather stone order");
{
  const st = world();
  const h = hub(st);
  const tile = st.grid.within(h.tile, 4).filter((t) => t !== h.tile && st.tiles[t].terrain !== "water").sort((x, y) => stoneAbundance(st, y) - stoneAbundance(st, x))[0];
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  if (check(!res.error, `a team leaves (${res.error || "ok"})`)) {
    const p = res.party;
    p.path = [tile]; p.idx = 0; p.phase = "waiting";
    st.hour = Math.floor(st.hour / 24) * 24 + 8; // daylight
    const text = startOrder(st, p, { type: "stone", hours: 4 });
    check(/gathers stone/.test(text) && p.task && p.task.type === "stone", `the order starts (${text})`);
    for (let i = 0; i < 6; i++) tickHour(st);
    const have = (p.cargo && p.cargo.supplies.stone) || 0;
    check(have > 0, `stone in the team's cargo after it (${have}, ${stoneAbundance(st, tile).toFixed(2)} on the tile)`);
  }
}

section("A camp's fire takes its wood and stone carried");
{
  const st = world();
  const h = hub(st);
  const tile = st.grid.within(h.tile, 5).find((t) => st.grid.distance(t, h.tile) >= 3 && st.tiles[t].terrain !== "water" && !st.tiles[t].loc && !st.bases.some((b) => b.tile === t));
  poiKnowledge(st, tile, true).surveyed = day(st);
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "waiting";
  p.supplies.wood = 0; p.supplies.stone = 0; if (p.cargo) { p.cargo.supplies.wood = 0; p.cargo.supplies.stone = 0; }
  check(/camp fire needs/.test(fireCostProblem(st, p)), `without them: ${fireCostProblem(st, p)}`);
  const opt = campOption(st, p, tile);
  check(opt && /camp fire/.test(opt.disabled || ""), "Set up camp is greyed out with the reason");
  const out = orderOptions(st, p).find((o) => o.mission === "outpost");
  check(!out || /camp fire/.test(out.disabled || ""), "and Build outpost");
  p.supplies.wood = 25; p.supplies.stone = 10;
  check(!fireCostProblem(st, p) && !campOption(st, p, tile).disabled, "with them: open");
  p.pitched = true; giveOrder(st, p, "camp");
  const camp = st.bases.find((b) => b.tile === tile);
  if (check(!!camp, "the camp stands")) check(Math.round(camp.stock.stone) === 10 - CAMP.fireCost.stone && Math.round(camp.stock.wood) >= 25 - CAMP.fireCost.wood, `the fire took its stone and wood (stores: ${camp.stock.stone} stone, ${camp.stock.wood} wood)`);
  st.autopilot = true;
  const q = { owner: "player", supplies: {}, cargo: { supplies: {}, gear: [] } };
  check(!fireCostProblem(st, q), "the governor's teams are never held up by it");
}

section("Hardcore: the first camp's fire too");
{
  const st = createWorld({ seed: 23, factionCount: 7, mode: "hardcore" });
  st.noWanderers = true;
  const p = roadTeam(st);
  p.supplies.wood = 0; p.supplies.stone = 0; if (p.cargo) { p.cargo.supplies.wood = 0; p.cargo.supplies.stone = 0; }
  const est = orderOptions(st, p).find((o) => o.mission === "establish");
  check(est && /camp fire needs/.test(est.disabled || ""), `Establish base waits for the fire's wood and stone (${est && est.disabled})`);
  const said = giveOrder(st, p, "establish");
  check(!st.bases.length, `ordered anyway, no camp goes up (${String(said).slice(0, 90)})`);
  p.supplies.wood = CAMP.fireCost.wood; p.supplies.stone = CAMP.fireCost.stone;
  const est2 = orderOptions(st, p).find((o) => o.mission === "establish");
  check(est2 && !/camp fire/.test(est2.disabled || ""), "carrying them: Establish base is open");
  void partyTile;
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
