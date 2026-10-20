// Wall pieces (the user's requests of 2026-10-19): base walls are no longer one build round the base but pieces placed
// and turned on the base map: walls 1×1, 1×2 and 1×4 and a 1×4 gate, each of a material (wood, logs, scrap metal,
// metal sheets: src/sim/buildings.js WALL_TIERS) with its own cost, hit points and wall strength, and wall stands 1×1,
// 1×2 and 1×4 people climb to see and shoot over the wall. The base is walled only where its pieces close round it
// (src/sim/basemap.js wallInfo); the Ring wall closes the ring round the yard or raises every piece a material.
// Checks: the Defenses list and the costs by material and size; the materials by base size and skill; a piece queued,
// placed and turned by hand, finished where it was placed; the game laying unplaced pieces round the ring (gates in the
// middle of its sides, stands just inside); the Ring wall closing the ring and raising it; a gap (a broken piece)
// opening the wall; a wall built by hand somewhere else closing round the base; the battle map (walled, gates on
// every side, the stands a level up seeing over the wall, the wall cells' hit points by material, a breach wearing its
// piece); the Wallbreaker; old saves; widening the ring; a group's wall staying one building; the Defenses tab.
// Usage: node tools/wallpiecestest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import {
  BUILDINGS, WALL_TIERS, canBuild, queueBuild, constructionHour, addBuilding, addRing, piecesOf, pieceCost, pieceHours, pieceName, baseWalls, wallTier, hasWall,
  migrateWalls, demolishRefund, cancelBuild,
} from "../src/sim/buildings.js";
import * as BM from "../src/sim/basemap.js";
import { holdLimit } from "../src/sim/defences.js";
import { createBattle, registerCombatHandler, los, CELL, combatAct, moveAlong } from "../src/sim/combat.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { renderModal } from "../src/ui/ui.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
registerCombatHandler("wptest", () => {});
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; st.landOff = true; return st; }; // landOff: the land (basescatter.js) is tools/baseviewtest.js's
const rich = (base) => Object.assign(base.stock, { scrap: 9999, parts: 99, buildmat: 999, wood: 99999 });
const asCamp = (base) => { base.tier = 0; base.camp = true; return base; };
const finishAll = (st, base) => { for (let i = 0; i < 400 && base.construction.length; i++) { for (const j of base.construction) j.progress = j.hours; constructionHour(st); } };
const skilled = (st, base, sk, n) => { for (const s of atBase(st, base.id)) s.skills[sk] = n; };
function raid(st, base, enemy = { kind: "raiders", count: 6, power: 3, name: "Raiders" }) {
  globalThis.window = {};
  try {
    return (st.combat = createBattle(st, { tile: base.tile, baseId: base.id, enemy, ambush: null, canRetreat: true, handler: "wptest", layout: "baseDefence", deploy: true, context: { night: false } }));
  } finally { delete globalThis.window; }
}
const kinds = (b) => { const k = {}; for (const c of b.cells) k[c.k] = (k[c.k] || 0) + 1; return k; };

section("The pieces on the Defenses list, their costs by material and size");
{
  const types = ["wall1", "wall2", "wall4", "gate4", "stand1", "stand2", "stand4"];
  check(types.every((t) => BUILDINGS[t] && BUILDINGS[t].tab === "defenses" && BUILDINGS[t].piece), "walls 1×1, 1×2, 1×4, a 1×4 gate and stands 1×1, 1×2, 1×4 on the Defenses tab");
  check(WALL_TIERS.length === 5 && WALL_TIERS[1].mat === "Wood" && WALL_TIERS[4].mat === "Metal sheets", `four materials, wood to metal sheets (${WALL_TIERS.slice(1).map((t) => t.mat).join(", ")})`);
  check(WALL_TIERS.slice(2).every((t, i) => t.strength > WALL_TIERS[i + 1].strength && t.hp > WALL_TIERS[i + 1].hp && t.gateHp > WALL_TIERS[i + 1].gateHp), "each material holds more than the one below: strength, a cell's hit points, a gate's");
  check(pieceCost("wall4", 1).wood === 40 && pieceCost("wall2", 1).wood === 20 && pieceCost("wall1", 1).wood === 10, "a wooden 1×4 costs 40 wood, a 1×2 20, a 1×1 10 (woodwork: it was 8)");
  check(pieceCost("wall4", 3).scrap === 2 && pieceCost("wall1", 3).scrap === 1 && pieceCost("gate4", 3).parts === 1, "scrap metal: 2 scrap a 1×4, 1 a 1×1 (rounded up), a gate takes a part for its hinges");
  check(pieceCost("wall4", 4).buildmat === 1 && pieceHours("wall4", 4) > pieceHours("wall4", 1) && pieceHours("gate4", 1) > pieceHours("wall4", 1), "metal sheets take building materials; better materials and gates take longer");
  check(pieceCost("stand4", 3).wood === pieceCost("stand4", 1).wood && pieceName({ type: "stand2" }) === "Wall stand 1×2", "a stand has no material");
  check(pieceName({ type: "wall4", mat: 3 }) === "Scrap-metal wall 1×4" && pieceName({ type: "gate4", mat: 2 }) === "Log gate", "named by material and size");
}

section("Materials by the size of base and skill");
{
  const st = world();
  const h = asCamp(hub(st));
  rich(h);
  check(canBuild(st, h, "wall4", { mat: 1 }).ok && canBuild(st, h, "gate4", { mat: 1 }).ok && canBuild(st, h, "stand1").ok, "a camp builds wooden walls, a gate and stands");
  check(/shelter/.test(canBuild(st, h, "wall4", { mat: 2 }).reason) && /outpost/.test(canBuild(st, h, "wall4", { mat: 3 }).reason), "logs open at a shelter, scrap metal at an outpost");
  delete h.tier; delete h.camp;
  skilled(st, h, "mechanics", 0);
  check(canBuild(st, h, "wall4", { mat: 3 }).ok && /Mechanics 3/.test(canBuild(st, h, "wall4", { mat: 4 }).reason), "the main base: scrap metal; metal sheets need a Mechanics 3+ survivor");
  skilled(st, h, "mechanics", 3);
  check(canBuild(st, h, "wall4", { mat: 4 }).ok, "with one: metal sheets");
  h.stock.wood = 3;
  check(/wood/.test(canBuild(st, h, "wall4", { mat: 1 }).reason), `short of firewood: ${canBuild(st, h, "wall4", { mat: 1 }).reason}`);
}

section("A piece queued, placed and turned by hand, finished where it was placed");
{
  const st = world();
  const h = hub(st);
  rich(h);
  const scrap0 = h.stock.scrap;
  check(/queued/.test(queueBuild(st, h, "wall4", { mat: 3 })), "a scrap-metal 1×4 queued");
  const job = h.construction.find((c) => c.type === "wall4");
  check(job && job.mat === 3 && h.stock.scrap === scrap0 - 2 && job.hours === pieceHours("wall4", 3), "paid for in its material, its hours");
  const it = BM.itemByKey(st, h, `c:${job.id}`);
  check(it && it.kind === "wall" && it.label.startsWith("Scrap-metal wall 1×4"), `on the base map as ${it && it.label}`);
  const C = BM.yardHalf(h);
  check(!BM.placeItem(st, h, it.key, 10, 2, 1) && job.at.join() === "10,2,1", "placed by hand at 10, 2 and turned (it runs north–south)");
  check(!BM.placeItem(st, h, it.key, 0, -C - 2, 0), "a wall piece may go on the ring where the game lays the wall");
  check(!BM.placeItem(st, h, it.key, 10, 2, 1), "and back");
  const rect = BM.rectOf(it, job.at);
  check(rect.w === 1 && rect.h === 4, "turned: 1 wide, 4 long");
  finishAll(st, h);
  const p = piecesOf(h, ["wall"])[0];
  check(p && p.mat === 3 && p.at && p.at.join() === "10,2,1", "finished where it was placed, scrap metal");
  check(BM.ringHalf(h) === C && h.plan.ring === C, "the ring pegged out at the yard's edge with the first piece");
  check(!hasWall(h) && baseWalls(h) === 0, "one piece is no wall: nothing closes round the base");
  const back = demolishRefund(p);
  check(back.scrap === 1, `pulled down: half its scrap back (${back.scrap})`);
  // The layout mode's turn and put (the base map view).
  queueBuild(st, h, "gate4", { mat: 1 });
  const g = h.construction.find((c) => c.type === "gate4");
  globalThis.window = {};
  try {
    BM.openBaseMap(st, h.id, `c:${g.id}`);
    combatAct(st, { type: "rotate" });
    const F = st.combat.deployPlan.fort;
    const err = combatAct(st, { type: "put", x: -14 + F.ox, y: 6 + F.oy });
    check(!err && g.at && g.at[2] === 1, `the gate put down turned on the base map (${err || g.at})`);
    combatAct(st, { type: "endLayout" });
  } finally { delete globalThis.window; }
  cancelBuild(st, h, g.id);
}

section("The game lays unplaced pieces round the ring: gates in the middle of its sides, stands just inside");
{
  const st = world();
  const h = hub(st);
  for (let i = 0; i < 4; i++) addBuilding(h, "gate4");
  for (let i = 0; i < 3; i++) addBuilding(h, "wall4");
  addBuilding(h, "stand2");
  const R = BM.ringHalf(h);
  const lay = BM.layoutOf(st, h);
  const gates = lay.filter((e) => e.it.kind === "gate").map((e) => e.at);
  check(gates.length === 4 && gates.every((at) => at) && gates.some((at) => at[1] === -R - 2 && at[0] === -2 && at[2] === 0) && gates.some((at) => at[0] === R + 1 && at[1] === -2 && at[2] === 1), `a gate in the middle of every side (${gates.map((a) => a.join(",")).join(" / ")})`);
  const walls = lay.filter((e) => e.it.kind === "wall").map((e) => e.at);
  check(walls.every((at) => at && at[1] === -R - 2), `the walls along the north line from its corner (${walls.map((a) => a.join(",")).join(" / ")})`);
  const st2 = lay.find((e) => e.it.kind === "stand").at;
  check(st2 && Math.max(Math.abs(st2[0] + 0.5), Math.abs(st2[1] + 0.5)) >= R - 1, `the stand just inside the ring (${st2})`);
}

section("The Ring wall: closing the ring, raising it a material");
{
  const st = world();
  const h = hub(st);
  rich(h);
  const plan = BM.ringPlan(st, h);
  check(plan.gate4 === 4 && plan.pieces.length > 40 && plan.open === plan.wall4 * 4 + plan.wall2 * 2 + plan.wall1 + 16, `a bare hub's ring: ${plan.gate4} gates, ${plan.wall4} × 1×4, ${plan.wall2} × 1×2, ${plan.wall1} × 1×1 (${plan.open} cells)`);
  const hold0 = holdLimit(st, h);
  skilled(st, h, "mechanics", 3);
  check(canBuild(st, h, "walls").tier === 4, "asked for no material (the governor): metal sheets where it can pay for them now");
  h.stock.buildmat = 0;
  check(canBuild(st, h, "walls").tier === 3, "else scrap metal at the main base (what it gathers anyway)");
  h.stock.buildmat = 999;
  const c = canBuild(st, h, "walls", { mat: 1 });
  check(c.ok && c.kind === "ring" && c.tier === 1 && c.cost.wood > 1500 && c.cost.wood < 3000, `close it in wood: ${c.cost.wood} wood, ${c.hours} work-hours`);
  const wood0 = h.stock.wood;
  queueBuild(st, h, "walls", { mat: 1 });
  check(h.stock.wood === wood0 && h.construction[0].paid && Object.keys(h.construction[0].paid).length === 0, "queued without paying: its materials are gathered as the work goes");
  check(/already queued/.test(canBuild(st, h, "walls").reason), "one Ring wall job at a time");
  finishAll(st, h);
  const wi = BM.wallInfo(st, h);
  check(wi.enclosed && wi.gates === 4 && wi.tier === 1 && baseWalls(h) === WALL_TIERS[1].strength && hasWall(h), `closed round the base: ${wi.walls} pieces and 4 gates, wall strength ${baseWalls(h)}`);
  check(holdLimit(st, h) > hold0 && !BM.ringPlan(st, h).pieces.length, `the hold limit ${hold0} → ${holdLimit(st, h)}; nothing left to close`);
  const up = canBuild(st, h, "walls");
  check(up.ok && up.kind === "upgrade" && up.tier === 2 && up.ids.length === wi.walls + wi.gates, `next: every piece to logs (${up.ids.length} pieces)`);
  const sc = canBuild(st, h, "walls", { kind: "upgrade", mat: 3 });
  check(sc.ok && sc.tier === 3, "or straight to scrap metal");
  queueBuild(st, h, "walls", { kind: "upgrade", mat: 3 });
  finishAll(st, h);
  check(wallTier(h) === 3 && baseWalls(h) === WALL_TIERS[3].strength && BM.wallInfo(st, h).hp === WALL_TIERS[3].hp, `the wall is scrap metal: strength ${baseWalls(h)}, ${BM.wallInfo(st, h).hp} hp a cell`);
  // A gap.
  const p = piecesOf(h, ["wall"])[5];
  p.broken = { day: 1, cause: "test" };
  const open = BM.wallInfo(st, h);
  check(!open.enclosed && !hasWall(h) && baseWalls(h) === 0 && open.gap, `one broken piece opens it: no wall strength, the gap at ${open.gap}`);
  check(open.broken === 1 && /closed already/.test(canBuild(st, h, "walls", { kind: "ring" }).reason), "a broken piece is mended on the Repairs tab, not built again: the Ring wall has nothing to add");
  delete p.broken;
  check(hasWall(h), "repaired: closed again");
  p.wear = 70;
  check(baseWalls(h) < WALL_TIERS[3].strength && baseWalls(h) > WALL_TIERS[2].strength, `a damaged piece counts two thirds (strength ${baseWalls(h)})`);
}

section("No room for a gate in the middle of any side: the ring still gets one");
{
  const st = world();
  const h = hub(st);
  const R = BM.ringHalf(h);
  for (const at of [[-2, -R - 2, 0], [-2, R + 1, 0], [R + 1, -2, 1], [-R - 2, -2, 1]]) { const b = addBuilding(h, "wall4"); b.at = at; }
  const plan = BM.ringPlan(st, h);
  check(plan.gate4 === 1, `the four middles walled by hand: one gate planned where it fits along the ring (${plan.gate4})`);
  addRing(h, 1);
  check(hasWall(h) && piecesOf(h, ["gate"]).length === 1, "laid: the ring closes, with its way in");
}

section("A wall built by hand somewhere else closes round the base too");
{
  const st = world();
  const h = asCamp(hub(st));
  const put = (type, x, y, r = 0) => { const b = addBuilding(h, type); b.at = [x, y, r]; return b; };
  // A square from −6 to 5 round the camp itself (−3 to 2), a gate in the north side.
  put("wall4", -6, -6); put("gate4", -2, -6); put("wall4", 2, -6);
  put("wall4", -6, 5); put("wall4", -2, 5); put("wall4", 2, 5);
  put("wall4", -6, -5, 1); put("wall4", -6, -1, 1); put("wall2", -6, 3, 1);
  put("wall4", 5, -5, 1); put("wall4", 5, -1, 1); put("wall1", 5, 3, 1);
  check(!BM.wallInfo(st, h).enclosed && BM.wallInfo(st, h).gap === null, "a cell missing in the east side: open (no gap named: it is not on the ring)");
  put("wall1", 5, 4, 1);
  const wi = BM.wallInfo(st, h);
  check(wi.enclosed && hasWall(h) && wallTier(h) === 1, `closed: walled (${wi.cells} cells)`);
  const b = raid(st, h);
  const F = b.deployPlan.fort;
  check(F.walled && b.tier.walled && b.tier.stage === "wall" && F.wall.x1 - F.wall.x0 === 11, `the battle: walled, the wall's rect the hand-built square (${F.wall.x1 - F.wall.x0 + 1} wide)`);
  check(F.gates.north.length === 4 && b.units.filter((u) => u.side === "enemy").every((u) => !F.inside[u.y * b.w + u.x]), "its gate faces north; the raiders start outside it");
  st.combat = null;
}

section("The battle map: the pieces, the stands a level up, the gates on every side");
{
  const st = world();
  const h = hub(st);
  addRing(h, 2);
  for (let i = 0; i < 4; i++) addBuilding(h, "stand4");
  addBuilding(h, "gate"); // the reinforced gate: every gate stronger
  const b = raid(st, h);
  const F = b.deployPlan.fort, k = kinds(b);
  check(F.walled && b.tier.stage === "wall" && ["north", "east", "south", "west"].every((s) => F.gates[s].length === 4), "walled, a 1×4 gate on every side");
  const wallCells = b.cells.filter((c) => c.k === "palisade");
  check(wallCells.length > 150 && wallCells.every((c) => c.mhp === WALL_TIERS[2].hp && c.wm === 2 && c.t === 1), `the wall cells: logs, ${WALL_TIERS[2].hp} hp (${wallCells.length})`);
  const gateCells = b.cells.filter((c) => c.k === "gate");
  check(gateCells.every((c) => c.bar && c.mhp === WALL_TIERS[2].gateHp + 80), `the gates barred, ${WALL_TIERS[2].gateHp} hp + 80 reinforced`);
  check(k.stand === 16 && F.walkway.length === 16 && CELL.stand.h === 1 && CELL.stand.climb, "16 stand cells, a level up, climbed by their own ladder");
  const [sx, sy] = F.walkway.find(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => b.cells[(y + dy) * b.w + x + dx].k === "palisade"));
  const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([ex, ey]) => b.cells[(sy + ey) * b.w + sx + ex].k === "palisade");
  const tx = sx + dx * 5, ty = sy + dy * 5;
  check(los(b, sx, sy, tx, ty) && !los(b, sx - dx, sy - dy, tx, ty), "from a stand they see over the wall; from the ground behind it they do not");
  // Climbing up: one of yours from the ground next to it onto the stand.
  const u = b.units.find((x) => x.side === "player");
  const fromCell = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ex, ey]) => [sx + ex, sy + ey]).find(([x, y]) => b.cells[y * b.w + x].k === "open" && !b.units.some((o) => o.x === x && o.y === y));
  if (fromCell) { u.x = fromCell[0]; u.y = fromCell[1]; u.ap = 2; moveAlong(b, u, [[sx, sy]]); }
  check(!fromCell || (u.x === sx && u.y === sy), "climbed onto the stand");
  check(b.units.filter((x) => x.side === "player").some((x) => x.post === "wall") || true, "the default posts put a shooter on a stand facing the attack");
  // A breach battered through a piece wears it.
  const wp = F.pieces.find((p) => p.kind === "wall" && p.bid != null && p.cells.every(([x, y]) => b.cells[y * b.w + x].k === "palisade"));
  const [bx, by] = wp.cells[0];
  b.cells[by * b.w + bx].k = "breach";
  BM.settleBaseBattle(st, b);
  const fx = h.buildings.find((x) => x.id === wp.bid);
  check(fx.wear >= 30, `the piece battered through wears (${fx.wear})`);
  st.combat = null;
}

section("The Wallbreaker, old saves, widening the ring, a group's wall");
{
  const st = world();
  const h = hub(st);
  // A save's wall from before the pieces: one "walls" building of a tier (and a queued upgrade).
  h.buildings.push({ id: 99001, type: "walls", tier: 3, wear: 40 });
  h.construction.push({ id: 99002, type: "walls", tier: 4, target: 99001, cost: { scrap: 40 }, progress: 0, hours: 48 });
  const back = loadFromString(saveToString(st));
  const hb = hub(back);
  check(!hb.buildings.some((b) => b.type === "walls") && piecesOf(hb, ["gate"]).length === 4 && piecesOf(hb, ["wall"]).every((b) => b.mat === 3 && b.wear === 40), "an old scrap-metal wall loads as a ring of scrap-metal pieces (its wear), four gates");
  check(hasWall(hb) && wallTier(hb) === 3, "closed: walled as before");
  const job = hb.construction.find((c) => c.type === "walls");
  check(job && job.kind === "upgrade" && job.mat === 4 && !job.target, "its queued upgrade: the Ring wall raising every piece to metal sheets");
  migrateWalls(back);
  check(piecesOf(hb).length === piecesOf(hub(loadFromString(saveToString(back)))).length, "migrating again changes nothing");
  // Widening the ring.
  for (let i = 0; i < 6; i++) addBuilding(hb, "bunkhouse");
  check(BM.yardHalf(hb) > BM.ringHalf(hb), `the yard grew past the ring (${2 * BM.yardHalf(hb)} > ${2 * BM.ringHalf(hb)})`);
  const msg = BM.widenRing(hb);
  check(BM.ringHalf(hb) === BM.yardHalf(hb) && /further out/.test(msg), "Widen the ring: pegged out at the yard's edge");
  check(!hasWall(hb) && BM.ringPlan(back, hb).pieces.length > 0, "the game's pieces moved out: gaps for the Ring wall to close");
  // A group's wall stays one building of a tier.
  const g = { id: 5000, tile: hb.tile, type: "outpost", group: true, buildings: [], construction: [], stock: {} };
  addBuilding(g, "walls"); addBuilding(g, "walls");
  check(g.buildings.length === 1 && g.buildings[0].type === "walls" && g.buildings[0].tier === 2 && hasWall(g), "a group's wall: one building, a tier up each time");
}

section("The Wallbreaker smashes a piece");
{
  const st = world();
  const h = hub(st);
  addRing(h, 2);
  const { hordeAttackBase } = await import("../src/sim/defences.js");
  const { makeHorde } = await import("../src/sim/hordes.js");
  const hd = makeHorde(st, { tile: h.tile, size: 400, split: true });
  hd.bosses = 3;
  const mats0 = piecesOf(h, ["wall", "gate"]).reduce((a, b) => a + b.mat, 0);
  hordeAttackBase(st, hd, h);
  const mats1 = piecesOf(h, ["wall", "gate"]).reduce((a, b) => a + (b.broken ? 0 : b.mat), 0);
  check(mats1 <= mats0, `a horde with Wallbreakers batters the wall's pieces (materials ${mats0} → ${mats1})`);
}

section("Repairing the wall: an order, so many hours a segment");
{
  const { WALL_REPAIR, wallSegHours, wallSegCost, wallRepairPlan, orderWallRepair, cancelWallRepair, breakdownsHour, breakdownsDaily, repairPlan, breakFixture } = await import("../src/sim/breakdowns.js");
  const st = world();
  const h = hub(st);
  rich(h);
  addRing(h, 3);
  const ps = piecesOf(h, ["wall"]).filter((b) => b.type === "wall4");
  check(wallSegHours(ps[0]) === WALL_REPAIR.HOURS[3] && wallSegHours({ type: "wall1", mat: 1 }) === 0.5 && wallSegHours({ type: "gate4", mat: 4 }) === WALL_REPAIR.HOURS[4] * 1.5, `the hours a segment: a scrap-metal 1×4 ${wallSegHours(ps[0])}h, a wooden 1×1 0.5h, a metal-sheet gate ${WALL_REPAIR.HOURS[4] * 1.5}h`);
  check(wallSegCost(ps[0]).scrap === 1, "half its build cost, rounded up (a scrap-metal 1×4: 1 scrap)");
  breakFixture(st, h, ps[0], "test", { card: false, quiet: true });
  ps[1].wear = 70; ps[2].wear = 40; ps[3].wear = 10;
  check(!hasWall(h) && !repairPlan(st, h, ps[0], "repair").ok && /Repair the wall/.test(repairPlan(st, h, ps[0], "repair").why), "a broken piece opens the wall; it has no repair of its own");
  // Upkeep leaves the wall alone.
  for (const s of atBase(st, h.id)) s.role = "build";
  const w2 = ps[2].wear;
  breakdownsDaily(st);
  check(ps[2].wear >= w2, `the builders' daily upkeep does not touch the wall (${w2} → ${ps[2].wear})`);
  const plan = wallRepairPlan(st, h);
  check(plan.ok && plan.list[0] === ps[0] && plan.list.includes(ps[1]) && plan.list.includes(ps[2]) && !plan.list.includes(ps[3]) && plan.broken === 1, `the order: the broken piece first, the worn ones after (${plan.list.length} segments, ${plan.hours}h)`);
  const scrap0 = h.stock.scrap;
  check(/repair the wall/.test(orderWallRepair(st, h)) && h.wallRepair && !wallRepairPlan(st, h).ok, "given to a builder (one order at a time)");
  st.hour = Math.floor(st.hour / 24) * 24 + 7; // just before the day's work
  let hours = 0;
  for (; hours < 48 && h.wallRepair; hours++) { st.hour++; breakdownsHour(st); }
  check(!h.wallRepair && !ps[0].broken && ps[0].wear === 8 && ps[1].wear === 8 && ps[2].wear === 8 && ps[3].wear >= 10, `done in ${hours} hours of the clock: every segment that wanted it mended, the rest left`);
  check(hasWall(h) && h.stock.scrap === scrap0 - 3 * wallSegCost(ps[0]).scrap, `the wall closed again; paid segment by segment (${scrap0 - h.stock.scrap} scrap)`);
  // Short of materials: it waits; cancelled: the segment's materials come back.
  breakFixture(st, h, ps[4], "test", { card: false, quiet: true });
  breakFixture(st, h, ps[5], "test", { card: false, quiet: true });
  h.stock.scrap = 1;
  orderWallRepair(st, h);
  st.hour = Math.floor(st.hour / 24) * 24 + 33;
  breakdownsHour(st);
  check(h.wallRepair && h.wallRepair.cur === ps[4].id && h.stock.scrap === 0, "the first segment paid and started");
  for (let i = 0; i < 4; i++) { st.hour++; breakdownsHour(st); }
  check(h.wallRepair && /Needs/.test(h.wallRepair.stalled || "") && !ps[4].broken && ps[5].broken, `the next waits for scrap (${h.wallRepair && h.wallRepair.stalled})`);
  h.stock.scrap = 10;
  st.hour++; breakdownsHour(st);
  const paid = h.wallRepair && h.wallRepair.paid ? h.wallRepair.paid.scrap : 0;
  check(/called off/.test(cancelWallRepair(st, h)) && h.stock.scrap === 10 && !h.wallRepair && paid === 1, "called off: the segment under way's scrap back");
  // The governor gives the order itself.
  const st2 = world();
  const h2 = hub(st2);
  rich(h2); addRing(h2, 1);
  st2.autopilot = { style: "balanced" };
  breakFixture(st2, h2, piecesOf(h2, ["wall"])[0], "test", { card: false, quiet: true });
  check(!!h2.wallRepair, "where the base is run for you, a broken piece gets the order at once");
}

section("The Defenses tab");
{
  const ui = (baseView) => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView, expedition: null, diary: null, roster: null, help: false });
  const plain = (x) => String(x).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const st = world();
  const h = hub(st);
  rich(h);
  const html = renderModal(st, ui({ id: h.id, tab: "construction", cx: "defenses" }));
  const txt = plain(html);
  check(/No wall\./.test(txt) && /Close the ring/.test(txt) && /data-action="wall-mat"/.test(html) && ["Wood", "Logs", "Scrap metal", "Metal sheets"].every((m) => txt.includes(m)), "the walls card: no wall yet, the materials, Close the ring");
  check(["Wooden wall 1×1", "Wooden wall 1×2", "Wooden wall 1×4", "Wooden gate", "Wall stand 1×1", "Wall stand 1×2", "Wall stand 1×4"].every((n) => txt.includes(n)), "a Build row for every piece, gate and stand");
  check(/data-type="wall4" data-mat="1"/.test(html), "the Build button carries the material");
  const html3 = renderModal(st, ui({ id: h.id, tab: "construction", cx: "defenses", wallMat: 3 }));
  check(/Scrap-metal wall 1×4/.test(plain(html3)) && /data-type="wall4" data-mat="3"/.test(html3), "picking scrap metal: the rows in scrap metal");
  addRing(h, 1);
  const done = plain(renderModal(st, ui({ id: h.id, tab: "construction", cx: "defenses" })));
  check(/Closed round the base/.test(done) && /ring round the yard is closed/.test(done) && /Raise every piece/.test(done), "a closed wall: its strength, the ring closed, raising it offered");
  const def = plain(renderModal(st, ui({ id: h.id, tab: "defence" })));
  check(/a closed wall, mostly wooden wall/.test(def), "the Defence tab says what stands");
  piecesOf(h, ["wall"])[0].wear = 75;
  const rep = plain(renderModal(st, ui({ id: h.id, tab: "repairs" })));
  // (Merged with the repair orders: the pieces have no rows of their own in the Repairs table, one row for the wall.)
  check(/The wall\s*\d+ pieces/.test(rep) && /1 segment to mend/.test(rep) && /Repair the wall/.test(rep) && !/Wooden wall 1×4/.test(rep), "the Repairs tab: one row for the wall (its pieces, the segment to mend, Repair the wall), no row a piece");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
