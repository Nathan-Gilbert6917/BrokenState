// A scripted playthrough of carrying furniture and appliances (issue #48, the user's request 2026-10-26: "Add a scripted
// play though of testing taking different pieces with one, two survivors and using vehicles and no vehicles"). It plays
// the sim's own orders (combat.js combatAct: move, liftPiece, setPiece, stowPiece, goup/godown, extract; the turns
// ended with endPlayerTurn / runEnemyPhase), no browser, on real raid maps (a house POI's own layout and pieces) and a
// real city crawl, over several seeds, and prints a transcript ("Turn 3: Ivy and Theo lift the refrigerator (2 actions
// each)") so a failure shows where the flow broke. The scenes:
//   A. Two survivors and the team's van at a house: one is refused the fridge alone; the two lift it (2 actions each),
//      tethered on adjacent cells at half its kg each, keep the tether through every move and out of the front door,
//      and load it into the van; the stove the same; the sofa (2 cells) set down to the side the player picks, lifted
//      again; one of the two downed: the piece set down, the tether ended; a piece upstairs (when the house has one)
//      carried down the stairs (both actions each); the van filled up: the sofa stays by the door (furnihome.js), in the
//      house's ledger (poi.cont.pieces).
//   B. One survivor and the van at a house: refused the fridge; lifts the microwave (2 actions), its weight on the
//      pace (carrykit.js weighPlayer, CARRY_KG past 40 kg), loads it; the shelves (25 kg: slowed to 4 tiles) set into the
//      front doorway: a barricade (barricade.js setPiece, the frame under it) the dead cannot walk through; lifted out
//      again and carried out of the raid in the arms: into the van's cargo on its own at extraction.
//   C. One survivor on foot: a chair carried out, dropped from exhaustion (furnihome.js exhaustText) by the door, in the
//      ledger.
//   D. Two survivors on foot: the oven between them out of the door, dropped from exhaustion with the chair of C still
//      there; the next raid on the house finds both by the door and lifts the oven again.
//   E. The city crawl with a van: a piece lifted inside a place, carried out (still in the arms, furnihome.js it.crawl),
//      the walk between blocks slowed (crawlMoveHours, crawlPieces on the card), back to the rim block where the van
//      waits and out: into the van.
//   F. Home: the pieces arrive as items (f_<kind>, the fridge's own key) in the armory; the fridge set (electric.js
//      setPlaced) is off without power and a cold room with a generator; the range cooks on the grid; the microwave
//      speeds meals; the shelves add storage (basestorage.js storageOf).
// Usage: node tools/carryplaytest.js [seed...]   (default 4 seeds, 2 with BS_QUICK; "ok" / "FAIL" lines, exits 1 on a
// failure). The browser version, by hand and outside the gate: node tools/carryplaysmoke.cjs <outdir>.
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { launchExpedition, cargoRoom, startReturn, partyMembers } from "../src/sim/parties.js";
import { createBattle, combatAct, finishCombat, endPlayerTurn, runEnemyPhase, CELL, reachable, pathTo, moveMob, dashRange, setFloor } from "../src/sim/combat.js";
import { stairTop } from "../src/sim/buildingmaps.js";
import { newItem, ensureInv, EQUIP_SLOTS } from "../src/sim/inventory.js";
import { poisOf, poiAt, poiPool, isSitePoi } from "../src/sim/pois.js";
import { poiRaidSetup } from "../src/sim/poiraid.js";
import { supWeight } from "../src/sim/data.js";
import { MAX_LOAD } from "../src/sim/load.js";
import { isFrame } from "../src/sim/barricade.js";
import { atVehicle } from "../src/sim/raidloot.js";
import * as F from "../src/sim/furnicarry.js";
import * as H from "../src/sim/furnihome.js";
import * as CC from "../src/sim/citycrawl.js";
import { rimOf, keyOf } from "../src/sim/citygrid.js";
import { BUILDINGS as BMAPS } from "../src/sim/buildingmaps.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { addBuilding } from "../src/sim/buildings.js";
import { setPlaced, placedItemKey } from "../src/sim/electric.js";
import { refreshPower, isPowered } from "../src/sim/power.js";
import { storeSpaces, storeFactor } from "../src/sim/storage.js";
import { microwaveOn, rangeFuel } from "../src/sim/appliances.js";
import { cookBills, ensureStations } from "../src/sim/cooking.js";
import { addFood } from "../src/sim/foods.js";
import { setFurniture } from "../src/sim/furniture.js";
import { storageOf } from "../src/sim/basestorage.js";
import * as BM from "../src/sim/basemap.js";

const QUICK = !!process.env.BS_QUICK;
const SEEDS = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (!SEEDS.length) SEEDS.push(...(QUICK ? [42, 5] : [42, 7, 1, 5])); // 1 and 5: a house of two storeys (the stairs)
let passed = 0, failed = 0;
let where = ""; // the scene and seed, on every FAIL line
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}${ok ? "" : `   [${where}]`}`); return ok; };
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const first = (u) => String(u.name).split(" ")[0];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const N4 = N8.slice(0, 4);
class Stop extends Error {} // a step the flow cannot go on from: the scene ends there, the FAIL line says why
const LIVE = []; // the teams out: a scene that stops sends its team home, so the next scene has the people and the van

// ---------- the transcript ----------
let turn = 1;
const T = (line) => console.log(`    Turn ${turn}: ${line}`);
const say = (line) => console.log(`    ${line}`);
const need = (ok, msg) => { if (!check(ok, msg)) { const e = new Stop(msg); e.told = true; throw e; } };

// ---------- the world, the team, the raid ----------
function world(seed) {
  const st = createWorld({ seed, factionCount: 8 });
  st.started = true; st.cards.length = 0; st.crashNext = 1e9; st.visitorsOff = true;
  return st;
}
// n survivors from the hub in plain kit (a pistol and a vest), on foot or in the hub's car or van.
function team(st, n, vehicle) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, n);
  for (const s of crew) { s.traits = []; s.traitTier = {}; s.perks = []; ensureInv(s); for (const k of EQUIP_SLOTS) s.gear[k] = null; s.pockets = s.pockets.map(() => null); s.gear.carry = null; s.gear.weapon = newItem("pistol"); s.gear.armor = newItem("vest"); }
  const v = vehicle ? st.vehicles.find((x) => x.type !== "bike" && x.loc && x.loc.kind === "base" && x.loc.baseId === h.id) : null;
  if (vehicle && !v) throw new Stop("no car or van at the hub");
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: v ? v.id : null, supplies: { food: 1, water: 1, ammo: 0 } });
  if (res.error) throw new Stop(`launch: ${res.error}`);
  st.cards.length = 0;
  LIVE.push(res.party);
  return { p: res.party, v };
}
// The nearest house POI to the hub (not a site), the same one every scene of a seed.
function houseOf(st) {
  const h = hub(st), ht = st.tiles[h.tile];
  let best = null;
  for (const t of st.tiles) {
    if (t.id === h.tile || st.bases.some((x) => x.tile === t.id)) continue;
    const L = poisOf(t);
    for (let i = 0; i < L.length; i++) {
      if (L[i].kind !== "house" || isSitePoi(t, i) || poiPool(t, i) <= 0.1) continue;
      const d = Math.hypot(t.x - ht.x, t.y - ht.y);
      if (!best || d < best.d) best = { t, i, d };
    }
  }
  if (!best) throw new Stop("no house on the map");
  return [best.t, best.i];
}
// A raid on the house: nobody else on the map but the team (the dead and the house's own folk out of the way: the
// script is about the carrying), everyone at 2 actions.
function raid(st, p, t, i) {
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
  const rs = poiRaidSetup(st, t, i);
  const setup = { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 1, power: 3, name: "a walker", groups: [] }, raid: { heat0: 0, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null }, context: {} };
  st.combat = createBattle(st, setup);
  const b = st.combat;
  if (b.raid.choose) b.raid.choose = null;
  b.walker = b.units.find((u) => u.side === "enemy") || null; // kept off the map for the barricade (scene B)
  quiet(b);
  for (const u of b.units) u.ap = 2;
  turn = 1;
  check(mine(b).every((u) => { const c = cellAt(b, u.x, u.y, u.f || 0); return c && CELL[c.k] && CELL[c.k].walk; }), `everyone starts on a cell they can stand on (${mine(b).map((u) => `${first(u)} ${cellAt(b, u.x, u.y, u.f || 0).k}`).join(", ")}; the bug the playthrough found: a piece the ledger put by the door stood on someone)`);
  return b;
}
const mine = (b) => b.units.filter((u) => u.side === "player" && !u.dead && !u.left);
const floorCells = (b, f) => (b.floors ? b.floors[f].cells : b.cells);
const cellAt = (b, x, y, f = 0) => (x < 0 || y < 0 || x >= b.w || y >= b.h ? null : floorCells(b, f)[y * b.w + x]);
const walkable = (b, x, y, f = 0) => { const c = cellAt(b, x, y, f); return !!c && !!CELL[c.k] && CELL[c.k].walk && c.k !== "vehicle" && c.k !== "stairs" && !b.units.some((o) => !o.dead && !o.left && (o.f || 0) === f && o.x === x && o.y === y); };
const onFloor = (b, f) => { if (b.floors) setFloor(b, f); };

// Nobody but the team on the map, and nobody coming: the script is about the carrying. The dead and the house's folk
// off the map, the bodies too (one with the worm in it gets up as a swarm: carriers.js carrierRound), no Heat waves
// (combat.js raidTurn spawnWave: R.spawnCap), no infection's reinforcements.
function quiet(b) {
  b.units = b.units.filter((u) => u.side === "player");
  b.corpses = [];
  b.infection = 0;
  b.heat = 0;
  if (b.raid) { b.raid.heat = 0; b.raid.spawnCap = 0; }
}
// The end of the player's turn (nobody else on the map: the enemy phase is empty), everyone back at 2 actions.
function nextTurn(st, b) {
  if (b.raid) { b.raid.heat = 0; b.raid.spawnCap = 0; }
  endPlayerTurn(st);
  if (!b.over) runEnemyPhase(st);
  turn++;
  const others = b.units.filter((u) => u.side !== "player" && !u.dead);
  if (!b.walker) b.walker = others.find((u) => u.kind === "zombie" && !u.boss && (u.size || 1) === 1) || null; // kept for the barricade
  if (others.length) { say(`(${others.map((u) => u.name.toLowerCase()).join(", ")} turned up: the script takes ${others.length > 1 ? "them" : "it"} off the map)`); b.units = b.units.filter((u) => u.side === "player"); }
  for (const u of mine(b)) if (u.ap < 2) u.ap = 2;
}
// u walks to (x, y) on its floor by the move order, a cell at most one action's pace at a time (so the actions say
// the pace), turns ended as the actions run out; a tethered partner follows (combat.js followTether). Returns the
// actions spent and the tiles walked.
function walkTo(st, b, u0, x, y, what = "") {
  onFloor(b, u0.f || 0);
  let actions = 0, tiles = 0, guard = 0;
  let u = u0, o = F.partnerOf(b, u0);
  // A pair: either end may lead (furnicarry.js: the other steps along); the one with a way there leads.
  if (o && !isFinite(reachable(b, u, 400, { manual: true }).dist[y * b.w + x]) && isFinite(reachable(b, o, 400, { manual: true }).dist[y * b.w + x])) { [u, o] = [o, u]; T(`${first(u)} leads the way (${first(o)} is on the far side).`); }
  const there = () => (u.x === x && u.y === y) || (o && o.x === x && o.y === y); // a pair: either end on the cell
  while (!there() && guard++ < 80) {
    if (u.ap <= 0 || (o && o.ap < 0)) nextTurn(st, b);
    let r = reachable(b, u, 400, { manual: true });
    const j = y * b.w + x;
    if (o) { // a pair: the end nearer the cell leads (the other steps into the way behind it otherwise, in a corridor)
      const r2 = reachable(b, o, 400, { manual: true });
      if (r2.dist[j] < r.dist[j]) { [u, o] = [o, u]; r = r2; if (guard > 1) T(`${first(u)} leads on (${first(o)} is behind).`); }
    }
    if (!isFinite(r.dist[j])) throw new Stop(`${first(u)} has no way to ${x},${y}${what ? ` (${what})` : ""}`);
    const path = pathTo(r, x, y), mob = moveMob(u);
    let err = "Cannot move there.";
    // One action's pace a move where it can be; a step only a dash reaches (a vault over half cover costs more than
    // a plain step) with both actions.
    const order = [...path.keys()].reverse().filter((k) => r.dist[path[k][1] * b.w + path[k][0]] <= mob);
    if (!order.length && u.ap < 2) { nextTurn(st, b); continue; }
    if (!order.length) order.push(...[...path.keys()].reverse().filter((k) => r.dist[path[k][1] * b.w + path[k][0]] <= dashRange(u)));
    for (const k of order) {
      if (!err) break;
      const [px, py] = path[k];
      const before = { x: u.x, y: u.y };
      err = combatAct(st, { type: "move", unit: u.id, x: px, y: py });
      if (!err) { actions++; tiles += k + 1; }
    }
    if (err) throw new Stop(`${first(u)} cannot walk on toward ${x},${y}: "${err}" (at ${u.x},${u.y} f${u.f || 0}, ${u.ap} actions, ${mob} tiles an action, the first step ${path[0] ? `${path[0]} costs ${r.dist[path[0][1] * b.w + path[0][0]]}` : "none"}, ${path.length} steps)`);
    if (o && cheb(u, o) !== 1) throw new Stop(`the tether broke on a move: ${first(u)} at ${u.x},${u.y}, ${first(o)} at ${o.x},${o.y}`);
  }
  if (!there()) throw new Stop(`${first(u)} never got to ${x},${y}`);
  return { actions, tiles, lead: u };
}
// A free walkable cell next to (x, y) (straight on first) that u can reach, nearest u first; `not`: cells to avoid.
function besideCell(b, u, x, y, f = 0, not = []) {
  onFloor(b, f);
  const r = reachable(b, u, 400, { manual: true });
  const L = [];
  for (const [dx, dy] of N8) {
    const cx = x + dx, cy = y + dy;
    if (!walkable(b, cx, cy, f) && !(u.x === cx && u.y === cy)) continue;
    if (not.some((q) => q.x === cx && q.y === cy)) continue;
    const d = u.x === cx && u.y === cy ? 0 : r.dist[cy * b.w + cx];
    if (isFinite(d)) L.push({ x: cx, y: cy, d: d + (dx && dy ? 0.5 : 0) });
  }
  L.sort((a, c) => a.d - c.d);
  return L[0] || null;
}
// The cells of a kind on floor f, a 1-cell piece's own or the first cell of a bigger one.
function piecesOn(b, kind, f = 0) {
  const out = [];
  const C = floorCells(b, f);
  for (let j = 0; j < C.length; j++) if (C[j].k === kind) out.push({ x: j % b.w, y: (j / b.w) | 0, f });
  return out;
}
// Can someone with a piece in the arms standing at (x, y) on floor f get to the way out (or `to`: the cells to reach,
// the stairs from upstairs)? With a piece nobody vaults half cover (combat.js canVault) and a closed door stays shut
// (reachable noDoors: the doors are opened first, clearWay), so a table left across a doorway shuts a room. carryRoute:
// the cells it would be carried along (the doors counted open), [] without a way.
function carryRoute(b, u, x, y, f = 0, to = null) {
  const spots = to || zoneSpotsAll(b, b.raid && b.raid.vehicleZone >= 0);
  if (spots.some((q) => q.x === x && q.y === y)) return [[x, y]];
  onFloor(b, f);
  const C = floorCells(b, f), shut = [];
  C.forEach((c, j) => { if (c.k === "idoor") { shut.push(j); c.k = "odoor"; } });
  const keep = { x: u.x, y: u.y, f: u.f, piece: u.piece };
  u.x = x; u.y = y; u.f = f; u.piece = u.piece || "table";
  const r = reachable(b, u, 400, { manual: true });
  Object.assign(u, keep);
  for (const j of shut) C[j].k = "idoor";
  onFloor(b, u.f || 0);
  const end = spots.filter((q) => isFinite(r.dist[q.y * b.w + q.x])).sort((a, c) => r.dist[a.y * b.w + a.x] - r.dist[c.y * b.w + c.x])[0];
  return end ? pathTo(r, end.x, end.y) : [];
}
const carryWayOut = (b, u, x, y, f = 0, to = null) => carryRoute(b, u, x, y, f, to).length > 0;
const liftable = (b, u, P) => { const a = besideCell(b, u, P.x, P.y, P.f || 0); return !!a && carryWayOut(b, u, a.x, a.y, P.f || 0, P.to || null); };
// A piece of `kind` on the map that can be lifted and carried out; else one the script stands on an open cell inside
// (said so).
function findOrPut(st, b, u, kind, f = 0) {
  for (const P of piecesOn(b, kind, f)) if (liftable(b, u, P)) return P;
  const d = F.liftDef(kind);
  const C = floorCells(b, f);
  for (let j = 0; j < C.length; j++) {
    const x = j % b.w, y = (j / b.w) | 0;
    if (C[j].k !== "open" || C[j].f !== "floor" || !b.indoorAt?.(x, y) && false) continue;
    const cells = d.size[0] * d.size[1] > 1 ? [[x, y], [x + 1, y]] : [[x, y]];
    if (!cells.every(([cx, cy]) => walkable(b, cx, cy, f) && cellAt(b, cx, cy, f).f === "floor")) continue;
    if (!N4.every(([dx, dy]) => { const n = cellAt(b, x + dx, y + dy, f); return n && n.k !== "wall"; })) continue;
    for (const [cx, cy] of cells) { const c = cellAt(b, cx, cy, f); c.k = kind; c.hp = d.hp; }
    b.losCache && b.losCache.fill(0);
    if (liftable(b, u, { x, y, f })) { say(`(no ${d.name.toLowerCase()} here to carry out: the script stands one at ${x},${y})`); return { x, y, f }; }
    for (const [cx, cy] of cells) cellAt(b, cx, cy, f).k = "open";
  }
  throw new Stop(`nowhere to find or stand a ${kind}`);
}
// The way out: the vehicle's zone (or the front door's) and a cell in it for each of n.
function zoneOf(b, vehicle) {
  const R = b.raid;
  const zi = vehicle && R.vehicleZone >= 0 ? R.vehicleZone : Math.max(0, R.zones.findIndex((z) => z.exit === "front"));
  return R.zones[zi];
}
function zoneSpots(b, vehicle) {
  const z = zoneOf(b, vehicle), out = [];
  for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) if (walkable(b, x, y, 0)) out.push({ x, y });
  return out;
}
function zoneSpotsAll(b, vehicle) {
  const z = zoneOf(b, vehicle), out = [];
  for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) out.push({ x, y });
  return out;
}
// The pair's lift: u stands next to the piece, o next to u (or the piece); 2 actions each.
// Hands full, a closed door stays shut (combat.js reachable noDoors): before a piece is lifted, the one who will lead
// opens the closed doors on the way it will be carried out (carryRoute), empty-handed, by walking onto each.
function clearWay(st, b, u, f = 0, from = u, to = null) {
  if (f !== (u.f || 0)) return;
  const doors = carryRoute(b, u, from.x, from.y, f, to).filter(([x, y]) => cellAt(b, x, y, f).k === "idoor");
  for (const [x, y] of doors) {
    if (cellAt(b, x, y, f).k !== "idoor") continue;
    const a = besideCell(b, u, x, y, f);
    if (!a) continue;
    walkTo(st, b, u, a.x, a.y, "to a door on the way out");
    if (u.ap < 1) nextTurn(st, b);
    const e = combatAct(st, { type: "move", unit: u.id, x, y });
    if (!e && cellAt(b, x, y, f).k === "odoor") T(`${first(u)} opens the door at ${x},${y} on the way out (the hands will be full).`);
  }
}
function pairLift(st, b, u, o, P, name) {
  const at0 = besideCell(b, u, P.x, P.y, P.f);
  if (at0) clearWay(st, b, u, P.f, at0, P.to || null);
  const at = besideCell(b, u, P.x, P.y, P.f);
  need(!!at, `a cell beside the ${name} for ${first(u)}`);
  walkTo(st, b, u, at.x, at.y, `to the ${name}`);
  const ot = besideCell(b, o, u.x, u.y, P.f, [{ x: P.x, y: P.y }]);
  need(!!ot, `a cell beside ${first(u)} for ${first(o)}`);
  walkTo(st, b, o, ot.x, ot.y, `beside ${first(u)}`);
  if (u.ap < 2 || o.ap < 2) nextTurn(st, b);
  const err = combatAct(st, { type: "liftPiece", unit: u.id, x: P.x, y: P.y, helper: o.id });
  need(err === "", `${first(u)} and ${first(o)} lift the ${name} (${err || "ok"})`);
  T(`${first(u)} and ${first(o)} lift the ${name} (2 actions each: ${u.ap} and ${o.ap} left).`);
}
// The pair (u leading) to a free cell in the way-out zone, the partner beside; the tether checked at each move.
function pairTo(st, b, u, x, y, what) {
  const o = F.partnerOf(b, u);
  const w = walkTo(st, b, u, x, y, what);
  check(!o || (cheb(u, o) === 1 && u.tether === o.id && o.tether === u.id), `${what}: the two still tethered on adjacent cells (${u.x},${u.y} and ${o ? `${o.x},${o.y}` : "-"})`);
  return w;
}
// The stow at the vehicle (1 action), the room checked first.
function stow(st, b, u0, name) {
  const o0 = F.partnerOf(b, u0);
  const u = !atVehicle(b, u0) && o0 && atVehicle(b, o0) ? o0 : u0; // the end of the pair at the vehicle loads it
  if (u.ap < 1) nextTurn(st, b);
  const err = combatAct(st, { type: "stowPiece", unit: u.id });
  T(`${first(u)} loads the ${name} into the vehicle${err ? `: refused, "${err}"` : " (1 action)"}.`);
  return err;
}
// Everyone left extracts from the zone (a pair together); the raid ends and its handler runs.
function extractAll(st, b, vehicle) {
  const spots = zoneSpots(b, vehicle);
  const free = () => spots.filter((q) => walkable(b, q.x, q.y, 0));
  const inZone = (q) => zoneSpotsAll(b, vehicle).some((s) => s.x === q.x && s.y === q.y) || (vehicle && atVehicle(b, q));
  for (let u of mine(b)) {
    if (u.left || u.down) continue;
    if ((u.f || 0) !== 0) throw new Stop(`${first(u)} is still upstairs`);
    let o = F.partnerOf(b, u);
    if (o && !inZone(u) && inZone(o)) [u, o] = [o, u]; // the end of the pair in the way out gives the order
    if (!inZone(u)) {
      const s = free().find((q) => !o || free().some((r) => cheb(q, r) === 1));
      need(!!s, `room for ${first(u)} in the way out`);
      walkTo(st, b, u, s.x, s.y, "to the way out");
      if (o && !inZone(u) && inZone(o)) [u, o] = [o, u];
    }
    if (u.ap < 1) nextTurn(st, b);
    if (o && o.ap < 1) nextTurn(st, b);
    const note = u.piece ? H.extractNote(st, b, u) : "";
    const err = combatAct(st, { type: "extract", unit: u.id });
    need(err === "", `${first(u)} extracts (${err || "ok"})`);
    T(`${first(u)}${o ? ` and ${first(o)}` : ""} extract${o ? "" : "s"}${note ? ` (the warning: "${note}")` : ""}.`);
  }
  if (!b.over) nextTurn(st, b);
  need(b.over, "the raid is over");
  finishCombat(st, b.setup, b.result);
  st.combat = null;
}
const ledgerOf = (t, i, kind) => { const c = poiAt(t, i).cont; return c && c.pieces ? Object.values(c.pieces).flat().filter((o) => o.cell.k === kind && o.cell.moved) : []; };
const summaryHas = (b, rx) => (b.summary || []).find((l) => rx.test(l)) || "";
const logHas = (st, rx) => (st.log.find((l) => rx.test(l.text)) || {}).text || "";
// Home: the team turns for its base from the tile it is on (the drive itself left out: the arrival is parties.js's
// own returnHome, through startReturn).
function home(st, p) {
  const h = hub(st);
  p.path = [h.tile]; p.idx = 0; p.progress = 0;
  const err = startReturn(st, p);
  need(err === "" && !st.parties.includes(p), `the team is home (${err || "ok"})`);
  return true;
}

// ---------- the scenes ----------
// A. Two survivors and the van.
function sceneA(st) {
  const [t, i] = houseOf(st);
  const { p, v } = team(st, 2, true);
  const b = raid(st, p, t, i);
  const [u, o] = mine(b);
  say(`${first(u)} and ${first(o)} drive the ${v.type} to ${t.loc ? t.loc.name || "the house" : "the house"} (${poisOf(t)[i].name || "a house"}): ${b.floors ? b.floors.length : 1} floor(s), the ${v.type} at the ${zoneOf(b, true).name.toLowerCase()}.`);
  check(b.raid.vehicleZone >= 0 && !!b.vehicle, "the van is on the raid map");
  const mob0 = u.mob;
  // The fridge: refused alone, then the two.
  const FR = findOrPut(st, b, u, "fridge");
  const at = besideCell(b, u, FR.x, FR.y);
  walkTo(st, b, u, at.x, at.y, "to the fridge");
  if (u.ap < 2) nextTurn(st, b);
  const why = combatAct(st, { type: "liftPiece", unit: u.id, x: FR.x, y: FR.y, helper: -1 });
  T(`${first(u)} tries the refrigerator alone: "${why}"`);
  check(/takes two/.test(why) && u.ap === 2 && !u.piece, "one survivor is refused a two-person piece (no actions spent)");
  pairLift(st, b, u, o, FR, "refrigerator");
  check(u.ap === 0 && o.ap === 0, "2 actions from each");
  check(u.tether === o.id && o.tether === u.id && cheb(u, o) === 1, "tethered, on adjacent cells");
  check(u.shareKg === 30 && o.shareKg === 30, `each carries half its 60 kg (${u.shareKg} and ${o.shareKg})`);
  check(survivorById(st, u.sid).gear.carry === u.bag && u.bag.key === "fridge" && cellAt(b, FR.x, FR.y).k !== "fridge", "the fridge item in the arms, its cell empty");
  say(`(paces: ${first(u)} ${mob0} tiles an action before, ${u.mob} with half the fridge; ${first(o)} ${o.mob})`);
  check(u.mob <= mob0 && u.mob === F.crushMob(u.mob, u.armLoad) && u.armLoad < MAX_LOAD, `half the fridge is under ${MAX_LOAD} kg: their load band's pace (${u.armLoad} kg, ${u.mob} tiles)`);
  // Out of the house to the van, the tether through every move and the front door.
  nextTurn(st, b);
  const spots = zoneSpots(b, true);
  const s = spots.find((q) => spots.some((r) => cheb(q, r) === 1 && !(r.x === q.x && r.y === q.y)));
  need(!!s, "a cell at the van for the two");
  const w = pairTo(st, b, u, s.x, s.y, "out of the front door to the van");
  T(`${first(u)} and ${first(o)} carry the refrigerator out to the ${v.type}: ${w.actions} moves, ${first(o)} stepping along beside.`);
  const err = stow(st, b, u, "refrigerator");
  check(err === "" && p.cargo.gear.some((it) => it.key === "fridge") && !u.piece && !o.piece && u.tether == null, "the fridge is in the van's cargo, the tether ended");
  // The stove the same way.
  nextTurn(st, b);
  const SV = findOrPut(st, b, u, "stove");
  pairLift(st, b, u, o, SV, "kitchen range");
  nextTurn(st, b);
  const s2 = zoneSpots(b, true).find((q) => zoneSpots(b, true).some((r) => cheb(q, r) === 1));
  pairTo(st, b, u, s2.x, s2.y, "the range out to the van");
  check(stow(st, b, u, "kitchen range") === "" && p.cargo.gear.some((it) => it.key === "f_stove"), "the range is in the van's cargo");
  // The sofa (2 cells): set down to the side the player picks, one of them downed, lifted again.
  nextTurn(st, b);
  const SO = findOrPut(st, b, u, "sofa");
  pairLift(st, b, u, o, SO, "sofa");
  check(piecesOn(b, "sofa").every((q) => cheb(q, SO) > 1 || cellAt(b, q.x, q.y).k === "sofa") && cellAt(b, SO.x, SO.y).k !== "sofa", "both of the sofa's cells empty");
  nextTurn(st, b);
  const os = openSpot(b, u);
  need(!!os, "open ground to set the sofa down on");
  const wo = pairTo(st, b, u, os.x, os.y, "the sofa out onto open ground");
  T(`${first(u)} and ${first(o)} carry the sofa out onto open ground (${wo.actions} moves).`);
  if (u.ap < 1 || o.ap < 1) nextTurn(st, b);
  lineUp(st, b, u);
  if (u.ap < 1 || o.ap < 1) nextTurn(st, b);
  const sides = F.setTargets(b, u);
  T(`Set down: the chooser offers ${sides.map((q) => q.side).join(" and ") || "nothing"}.`);
  const side = sides.find((q) => q.side === "left") || sides[0];
  need(!!side, "a side of the two to set the sofa on");
  const ap0 = [u.ap, o.ap];
  const e3 = combatAct(st, { type: "setPiece", unit: u.id, side: side.side });
  const sofaCells = piecesOn(b, "sofa").filter((q) => cellAt(b, q.x, q.y).moved);
  T(`${first(u)} and ${first(o)} set the sofa down to the ${side.side} (1 action each): it stands on ${sofaCells.map((q) => `${q.x},${q.y}`).join(" and ")}.`);
  const par = sofaCells.length === 2 && ((sofaCells[0].x === sofaCells[1].x) === (u.x === o.x)) && sofaCells.every((q) => cheb(q, u) <= 1 || cheb(q, o) <= 1);
  check(e3 === "" && !u.piece && !o.piece && par && u.ap === ap0[0] - 1 && o.ap === ap0[1] - 1, `set to the ${side.side}, parallel to the two, 1 action each (${e3 || "ok"}; ${first(u)} ${u.x},${u.y}, ${first(o)} ${o.x},${o.y}; actions ${ap0.join(",")} → ${u.ap},${o.ap})`);
  nextTurn(st, b);
  const S1 = sofaCells[0];
  const e4 = combatAct(st, { type: "liftPiece", unit: u.id, x: S1.x, y: S1.y, helper: o.id });
  T(`${first(u)} and ${first(o)} lift the sofa again${e4 ? `: "${e4}"` : ""}.`);
  check(e4 === "" && u.tether === o.id, "lifted again from where it was set");
  o.down = true; o.hp = 1; o.stab = true;
  F.tetherRound(st, b);
  T(`${first(o)} goes down: the sofa drops.`);
  check(!u.piece && !o.piece && u.tether == null && o.tether == null && !survivorById(st, u.sid).gear.carry, "one of the two downed: the piece set down, the tether ended");
  check(piecesOn(b, "sofa").some((q) => cheb(q, u) <= 2 && cellAt(b, q.x, q.y).moved), "the sofa stands next to them");
  o.down = false; o.hp = Math.max(o.hp, 10); o.stab = false; o.bleed = 0;
  say(`(the script gets ${first(o)} back on their feet)`);
  nextTurn(st, b);
  // Upstairs: a piece carried down the stairs (both actions each), when this house has a second floor and a piece on it.
  if (b.floors && b.floors.length > 1) stairsDown(st, b, u, o, p, v);
  else say("(one floor here: no stairs to carry a piece down)");
  // The van full: the sofa between the two at extraction stays by the door, in the ledger.
  nextTurn(st, b);
  const S2 = piecesOn(b, "sofa").find((q) => cellAt(b, q.x, q.y).moved) || piecesOn(b, "sofa")[0];
  pairLift(st, b, u, o, S2, "sofa");
  const room = cargoRoom(st, p);
  p.cargo.supplies.scrap = (p.cargo.supplies.scrap || 0) + Math.ceil(Math.max(0, room - 20) / supWeight("scrap"));
  say(`(the script loads the ${v.type} with scrap: ${Math.round(cargoRoom(st, p))} kg of room left for a 45 kg sofa)`);
  nextTurn(st, b);
  extractAll(st, b, true);
  check(!p.cargo.gear.some((it) => it.key === "f_sofa"), "the sofa is not in the full van");
  const lootKeys = b.result.loot.gear.map((g) => g.key);
  check(lootKeys.includes("fridge") && lootKeys.includes("f_stove"), `the pieces loaded during the raid are in its loot (${lootKeys.filter((k) => F.isPieceItem({ key: k }) || k === "fridge").join(", ") || "none"}; the bug the playthrough found: "Loot: nothing" with a fridge in the van)`);
  const full = summaryHas(b, /is full: the sofa stays by the door/);
  T(`The raid ends: "${full || (b.summary || []).join(" / ")}"`);
  check(!!full, "the van too full: the sofa stays by the door (furnihome.js), said in the summary");
  check(ledgerOf(t, i, "sofa").length >= 1, "and kept in the house's ledger (poi.cont.pieces)");
  const scr = p.cargo.supplies.scrap; p.cargo.supplies.scrap = 0; // the script's ballast out again before home
  say(`(the script takes its ${scr} scrap back out)`);
  return { p, t, i };
}
// A piece upstairs carried down: the two up the stairs empty-handed, the piece lifted on the first floor, down the
// stairs (2 actions each), out to the van and loaded.
function stairsDown(st, b, u, o, p, v) {
  // The stairwell's top step on the ground floor, the same cell a floor up.
  const C0 = floorCells(b, 0), C1 = floorCells(b, 1);
  let top = null;
  for (let j = 0; j < C0.length && !top; j++) if (stairTop(C0[j]) && C1[j] && C1[j].k === "stairs") top = { x: j % b.w, y: (j / b.w) | 0 };
  if (!top) { say("(a second floor, but no stairwell found: no stairs this seed)"); return; }
  // A one-cell piece up there that the two can carry to the stairwell (tried from the landing, empty-handed).
  const one = (k) => F.liftDef(k) && F.liftDef(k).item && F.liftDef(k).size[0] * F.liftDef(k).size[1] === 1;
  const ups = ["fridge", "stove", "dresser", "wardrobe", "nightstand", "bed", "bunk", "chair", "table", "armchair"].filter(one).flatMap((k) => piecesOn(b, k, 1).map((P) => ({ ...P, k, to: [top] })));
  if (!ups.length) { say("(a second floor, but no single-cell piece up there: no stairs this seed)"); return; }
  onFloor(b, 0);
  for (const x of [u, o]) {
    walkTo(st, b, x, top.x, top.y, "to the stairs");
    if (x.ap < 1) nextTurn(st, b);
    const e = combatAct(st, { type: "goup", unit: x.id });
    need(e === "" && x.f === 1, `${first(x)} goes upstairs (${e || "ok"})`);
    T(`${first(x)} goes up the stairs (1 action).`);
    const off = besideCell(b, x, top.x, top.y, 1);
    if (off) walkTo(st, b, x, off.x, off.y, "off the landing");
  }
  const P = ups.find((q) => liftable(b, u, q));
  if (!P) { // the pieces up there are boxed in (half cover across the doorways): back down empty-handed
    say(`(none of the ${ups.length} pieces upstairs has a way to the stairs with the hands full: they come back down)`);
    for (const x of [u, o]) {
      walkTo(st, b, x, top.x, top.y, "back to the stairs");
      if (x.ap < 1) nextTurn(st, b);
      need(combatAct(st, { type: "godown", unit: x.id }) === "" && x.f === 0, `${first(x)} comes back down`);
      const off = besideCell(b, x, top.x, top.y, 0);
      if (off) walkTo(st, b, x, off.x, off.y, "off the stairs");
    }
    return;
  }
  const kind = P.k, name = F.liftDef(kind).name.toLowerCase();
  nextTurn(st, b);
  pairLift(st, b, u, o, P, name);
  nextTurn(st, b);
  ({ lead: u } = walkTo(st, b, u, top.x, top.y, "back to the stairs"));
  o = F.partnerOf(b, u);
  if (u.ap < 2 || o.ap < 2) nextTurn(st, b);
  u.ap = 1;
  const short = combatAct(st, { type: "godown", unit: u.id });
  check(/both actions/.test(short), `the stairs with a piece take both actions: "${short}"`);
  u.ap = 2;
  const e = combatAct(st, { type: "godown", unit: u.id });
  T(`${first(u)} and ${first(o)} carry the ${name} down the stairs${e ? `: "${e}"` : " (both actions each)"}.`);
  check(e === "" && u.f === 0 && o.f === 0 && u.ap === 0 && o.ap === 0 && u.tether === o.id && cheb(u, o) === 1, "down the stairs together: both actions each, still tethered");
  nextTurn(st, b);
  const s = zoneSpots(b, true).find((q) => zoneSpots(b, true).some((r) => cheb(q, r) === 1));
  pairTo(st, b, u, s.x, s.y, `the ${name} out to the van`);
  const err = stow(st, b, u, name);
  check(err === "" && p.cargo.gear.some((it) => it.key === F.liftDef(kind).item), `the ${name} from upstairs is in the van`);
  if (err) { const pt = F.carriedPiece(b, u); if (pt) combatAct(st, { type: "setPiece", unit: u.id, side: F.setTargets(b, u)[0]?.side }); }
}
// B. One survivor and the van: the microwave, the shelves in the doorway.
function sceneB(st) {
  const [t, i] = houseOf(st);
  const { p, v } = team(st, 1, true);
  const b = raid(st, p, t, i);
  const [u] = mine(b);
  say(`${first(u)} drives the ${v.type} to the house alone.`);
  const base = { kg: u.armLoad, mob: u.mob };
  const FR = piecesOn(b, "fridge").find((q) => besideCell(b, u, q.x, q.y));
  if (FR) {
    const a = besideCell(b, u, FR.x, FR.y);
    walkTo(st, b, u, a.x, a.y, "to the fridge");
    if (u.ap < 2) nextTurn(st, b);
    const why = combatAct(st, { type: "liftPiece", unit: u.id, x: FR.x, y: FR.y });
    T(`${first(u)} tries the refrigerator: "${why}"`);
    check(/takes two/.test(why) && !u.piece, "alone: refused a two-person piece (no one to take the other end)");
  }
  nextTurn(st, b);
  const MW = findOrPut(st, b, u, "microwave");
  clearWay(st, b, u, 0, besideCell(b, u, MW.x, MW.y) || u);
  const a = besideCell(b, u, MW.x, MW.y);
  walkTo(st, b, u, a.x, a.y, "to the microwave");
  if (u.ap < 2) nextTurn(st, b);
  u.ap = 1;
  const short = combatAct(st, { type: "liftPiece", unit: u.id, x: MW.x, y: MW.y });
  check(/both actions/.test(short) && !u.piece, `one action left: refused ("${short}")`);
  u.ap = 2;
  const e1 = combatAct(st, { type: "liftPiece", unit: u.id, x: MW.x, y: MW.y });
  T(`${first(u)} lifts the microwave alone (2 actions; ${u.ap} left).`);
  check(e1 === "" && u.ap === 0 && u.piece === "microwave" && u.bag.key === "f_microwave" && u.tether == null, "one survivor lifts a light piece: 2 actions, alone");
  check(Math.abs(u.armLoad - (base.kg + 15)) < 0.5 && u.mob <= base.mob, `its 15 kg on them (${base.kg} → ${u.armLoad} kg; ${base.mob} → ${u.mob} tiles an action)`);
  nextTurn(st, b);
  const z = zoneSpots(b, true)[0];
  const w1 = walkTo(st, b, u, z.x, z.y, "the microwave to the van");
  T(`${first(u)} carries the microwave to the ${v.type} (${w1.actions} moves).`);
  check(stow(st, b, u, "microwave") === "" && p.cargo.gear.some((it) => it.key === "f_microwave"), "the microwave is in the van");
  // The shelves: 25 kg, slowed; set into the front doorway as a barricade, lifted out again.
  nextTurn(st, b);
  const SH = findOrPut(st, b, u, "shelf");
  clearWay(st, b, u, 0, besideCell(b, u, SH.x, SH.y) || u);
  const a2 = besideCell(b, u, SH.x, SH.y);
  walkTo(st, b, u, a2.x, a2.y, "to the shelves");
  if (u.ap < 2) nextTurn(st, b);
  check(combatAct(st, { type: "liftPiece", unit: u.id, x: SH.x, y: SH.y }) === "" && u.piece === "shelf", "the shelves lifted alone");
  T(`${first(u)} lifts the shelves (25 kg): ${u.mob} tiles an action now, from ${base.mob}.`);
  check(u.mob < base.mob && u.mob === F.crushMob(u.mob, u.armLoad), `slowed by the weight (${u.armLoad} kg: ${u.mob} tiles an action)`);
  const door = frontDoor(b, u);
  if (door) {
    nextTurn(st, b);
    const inside = door.inside;
    walkTo(st, b, u, inside.x, inside.y, "to the front door");
    if (u.ap < 1) nextTurn(st, b);
    const e2 = combatAct(st, { type: "setPiece", unit: u.id, x: door.x, y: door.y });
    const dc = cellAt(b, door.x, door.y);
    T(`${first(u)} sets the shelves in the front doorway (${door.x},${door.y})${e2 ? `: "${e2}"` : ": a barricade"}.`);
    check(e2 === "" && dc.k === "shelf" && !!dc.frame && isFrame(dc.frame), `a piece in the doorway is a barricade, the door frame kept under it (${dc.k}, frame ${dc.frame ? dc.frame.k : "none"})`);
    const zd = b.walker;
    if (zd && door.outside) {
      zd.x = door.outside.x; zd.y = door.outside.y; zd.f = 0; zd.dead = false; zd.aware = true;
      b.units.push(zd);
      const r = reachable(b, zd, 6);
      check(!isFinite(r.dist[door.y * b.w + door.x]) && !isFinite(r.dist[inside.y * b.w + inside.x]), `the dead cannot walk through it (a walker at ${zd.x},${zd.y}: no way in through the door)`);
      b.units.splice(b.units.indexOf(zd), 1);
    } else say("(no walker to try the door)");
    nextTurn(st, b);
    const e3 = combatAct(st, { type: "liftPiece", unit: u.id, x: door.x, y: door.y });
    T(`${first(u)} lifts the shelves out of the doorway again${e3 ? `: "${e3}"` : ""}.`);
    check(e3 === "" && cellAt(b, door.x, door.y).k === door.k && !cellAt(b, door.x, door.y).frame, `the doorway is a door again (${cellAt(b, door.x, door.y).k})`);
  } else say("(no front doorway to barricade on this map)");
  // Out with the shelves in the arms: into the van on its own at extraction.
  nextTurn(st, b);
  B_NOTE.text = H.extractNote(st, b, u);
  extractAll(st, b, true);
  const line = summaryHas(b, /heaved the shelves into/) || logHas(st, /heaved the shelves into/);
  T(`The raid ends: "${line}"`);
  check(/^The shelves go into/.test(B_NOTE.text) && /^Ivy heaved|heaved the shelves into/.test(line), `a plural name reads right: "${B_NOTE.text}" (the bug the playthrough found: "The shelves goes into")`);
  check(H.piecesText(["shelves"]) === "some shelves" && H.exhaustText(["shelves"], true).includes("They stand by the door") && H.piecesText(["shelves", "shelves", "chair"]) === "two lots of shelves, a chair", `and in the exhaustion message: "${H.exhaustText(["shelves", "chair"], true)}"`);
  check(p.cargo.gear.some((it) => it.key === "f_shelf") && !survivorById(st, u.sid).gear.carry, "extracting with the shelves in the arms: into the van's cargo by itself");
  return { p };
}
// A pair standing diagonally has no side to set a 2-cell piece down on, parallel to them: one steps straight beside
// the other (the other stays: still next to them).
function lineUp(st, b, u) {
  const o = F.partnerOf(b, u);
  if (!o || u.x === o.x || u.y === o.y) return;
  for (const [x, y] of [[u.x, o.y], [o.x, u.y]]) {
    if (!walkable(b, x, y, u.f || 0)) continue;
    const e = combatAct(st, { type: "move", unit: o.id, x, y });
    if (!e) { T(`${first(o)} steps round to stand straight beside ${first(u)} (diagonal, there is no side to set a 2-cell piece on).`); return; }
  }
}
// Open ground outdoors, nearest u: a cell with every cell within 2 of it free to walk on.
function openSpot(b, u) {
  const o = F.partnerOf(b, u), ru = reachable(b, u, 400, { manual: true }), ro = o ? reachable(b, o, 400, { manual: true }) : null;
  const r = { dist: ru.dist.map((d, j) => Math.min(d, ro ? ro.dist[j] : Infinity)) }; // either end may lead (walkTo)
  let best = null;
  for (let y = 2; y < b.h - 2; y++) for (let x = 2; x < b.w - 2; x++) {
    const d = r.dist[y * b.w + x];
    if (!isFinite(d) || (best && d >= best.d)) continue;
    let ok = true;
    for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) { const c = cellAt(b, x + dx, y + dy); ok = !!c && c.k === "open" && (walkable(b, x + dx, y + dy) || (x + dx === u.x && y + dy === u.y) || F.partnerOf(b, u) && x + dx === F.partnerOf(b, u).x && y + dy === F.partnerOf(b, u).y); }
    if (ok) best = { x, y, d };
  }
  return best;
}
const B_NOTE = { text: "" };
// The house's front door: the door cell by the front zone on the way in, the walkable cells either side of it.
function frontDoor(b, u) {
  const r = reachable(b, u, 400, { manual: true });
  const reach = (q) => (q.x === u.x && q.y === u.y) || isFinite(r.dist[q.y * b.w + q.x]);
  const z = zoneOf(b, true);
  const zc = { x: z.x0 + (z.w >> 1), y: z.y0 + (z.h >> 1) };
  let best = null;
  const C = floorCells(b, 0);
  for (let j = 0; j < C.length; j++) {
    const c = C[j];
    if (!["odoor", "idoor", "doorway"].includes(c.k)) continue;
    const x = j % b.w, y = (j / b.w) | 0;
    const sides = [[[0, 1], [0, -1]], [[1, 0], [-1, 0]]].map(([[ax, ay], [bx, by]]) => [{ x: x + ax, y: y + ay }, { x: x + bx, y: y + by }]).find(([p1, p2]) => walkable(b, p1.x, p1.y) && walkable(b, p2.x, p2.y));
    if (!sides) continue;
    const [p1, p2] = sides;
    if (!reach(p1) || !reach(p2)) continue;
    const d = Math.hypot(x - zc.x, y - zc.y);
    const outside = Math.hypot(p1.x - zc.x, p1.y - zc.y) < Math.hypot(p2.x - zc.x, p2.y - zc.y) ? p1 : p2, inside = outside === p1 ? p2 : p1;
    if (!best || d < best.d) best = { x, y, k: c.k, d, inside, outside };
  }
  if (best && best.k === "idoor") { const c = cellAt(b, best.x, best.y); c.k = "odoor"; best.k = "odoor"; say(`(the front door at ${best.x},${best.y} is opened)`); }
  return best;
}
// C. One survivor on foot: a chair, dropped from exhaustion.
function sceneC(st, t, i) {
  const { p } = team(st, 1, false);
  const b = raid(st, p, t, i);
  const [u] = mine(b);
  say(`${first(u)} walks to the house alone, on foot.`);
  const CH = findOrPut(st, b, u, "chair");
  clearWay(st, b, u, 0, besideCell(b, u, CH.x, CH.y) || u);
  const a = besideCell(b, u, CH.x, CH.y);
  walkTo(st, b, u, a.x, a.y, "to the chair");
  if (u.ap < 2) nextTurn(st, b);
  check(combatAct(st, { type: "liftPiece", unit: u.id, x: CH.x, y: CH.y }) === "" && u.piece === "chair", "the chair lifted alone");
  T(`${first(u)} lifts a chair (2 actions).`);
  nextTurn(st, b);
  check(/No vehicle: .* dropped at the door/.test(H.extractNote(st, b, u)), `the warning before leaving: "${H.extractNote(st, b, u)}"`);
  extractAll(st, b, false);
  const m = summaryHas(b, /Exhausted, the team dropped what it was carrying: a chair\. It stands by the door/);
  T(`The raid ends: "${m}"`);
  check(!!m && !!logHas(st, /Exhausted, the team dropped what it was carrying/), "on foot: the \"dropped due to exhaustion\" message, in the summary and the log");
  check(ledgerOf(t, i, "chair").length >= 1 && !survivorById(st, u.sid).gear.carry, "the chair left by the door, in the house's ledger");
  return home(st, p);
}
// D. Two survivors on foot: the oven, dropped from exhaustion; the next raid finds it and the chair by the door.
function sceneD(st, t, i) {
  const { p } = team(st, 2, false);
  let b = raid(st, p, t, i);
  const [u, o] = mine(b);
  say(`${first(u)} and ${first(o)} walk to the house, on foot.`);
  const OV = findOrPut(st, b, u, "oven");
  pairLift(st, b, u, o, OV, "oven");
  check(u.shareKg === 20 && o.shareKg === 20, `the 40 kg oven at half each (${u.shareKg}, ${o.shareKg})`);
  nextTurn(st, b);
  extractAll(st, b, false);
  const m = summaryHas(b, /Exhausted, the team dropped what it was carrying: an oven\. It stands by the door/);
  T(`The raid ends: "${m}"`);
  check(!!m, "two on foot: the oven dropped from exhaustion, the message names it");
  check(ledgerOf(t, i, "oven").length >= 1, "the oven in the house's ledger");
  // The next visit: both by the door, the oven lifted again.
  st.hour += 30;
  b = raid(st, p, t, i);
  const [u2, o2] = mine(b);
  const ov = piecesOn(b, "oven").find((q) => cellAt(b, q.x, q.y).moved), ch = piecesOn(b, "chair").find((q) => cellAt(b, q.x, q.y).moved);
  T(`They come back: the oven stands at ${ov ? `${ov.x},${ov.y}` : "nowhere"}, the chair at ${ch ? `${ch.x},${ch.y}` : "nowhere"}.`);
  check(!!ov && !!ch, "the next raid finds the oven and the chair where they were dropped");
  if (ov) {
    pairLift(st, b, u2, o2, ov, "oven");
    check(u2.piece === "oven", "the oven lifted again");
    nextTurn(st, b);
    if (!F.setTargets(b, u2).length) { const os = openSpot(b, u2); if (os) { pairTo(st, b, u2, os.x, os.y, "the oven out onto open ground"); if (u2.ap < 1 || o2.ap < 1) nextTurn(st, b); } }
    const sides = F.setTargets(b, u2);
    check(sides.length > 0 && combatAct(st, { type: "setPiece", unit: o2.id, side: sides[sides.length - 1].side }) === "", `and set down again (to the ${sides.length ? sides[sides.length - 1].side : "-"}, by ${first(o2)})`);
  }
  extractAll(st, b, false);
  return home(st, p);
}
// E. The city crawl with a van: a piece out of a place, block to block, out at the rim into the van.
function sceneE(st) {
  const city = st.tiles.find((x) => x.loc && x.loc.type === "city");
  if (!city) throw new Stop("no city");
  const crew = atBase(st, hub(st).id).slice(0, 2);
  need(crew.length === 2, `two at home for the crawl (${crew.length})`);
  for (const s of crew) { ensureInv(s); s.gear.carry = null; }
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: city.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 20 } });
  need(!res.error, `the team for the crawl (${res.error || "ok"})`);
  const p = res.party;
  LIVE.push(p);
  p.path = [city.id]; p.idx = 0; p.dest = city.id; p.phase = "engaged";
  const van = createVehicle(st, "van", { kind: "party", partyId: p.id }, { condition: 90 });
  p.vehicleId = van.id; p.vehicleIds = [van.id]; p.vehicle = true;
  CC.startCrawl(st, p);
  const c = p.crawl;
  c.alert = 0;
  const [a, m] = partyMembers(st, p);
  say(`${first(a)} and ${first(m)} drive into ${city.loc.name || "the city"}: the crawl starts at the rim, the van waits there.`);
  // A place on the entry block with a piece two can lift by the door.
  let b = null;
  for (let slot = 30; slot < 90 && !b; slot++) {
    const key = ["apartments", "house", "office"][slot % 3];
    if (!BMAPS[key]) continue;
    const pl = { id: `t48-${key}-${slot}`, slot, key, name: `${BMAPS[key].name} on Test Street`, kind: BMAPS[key].name, dead: 0, rich: 1, raiders: false, looted: 0, blocked: null, quick: false, known: false, folk: { survivors: false, raidersUp: false, nest: false } };
    CC.blockOf(c).places = [pl];
    CC.enterPlace(st, p, pl.id, { map: true });
    const bb = st.combat;
    if (bb) { quiet(bb); for (const x of bb.units) x.ap = 2; }
    const ok = bb && ["fridge", "stove", "oven", "sofa", "armchair", "table"].some((k) => piecesOn(bb, k).some((q) => liftable(bb, bb.units[0], q)));
    if (ok) { b = bb; b.placeName = pl.name; } else { st.combat = null; c.inside = null; }
  }
  need(!!b, "a place in the city with a piece by the way in");
  turn = 1;
  const [ua, um] = mine(b);
  const kind = ["fridge", "stove", "oven", "sofa", "armchair", "table"].find((k) => piecesOn(b, k).some((q) => liftable(b, ua, q)));
  const P = piecesOn(b, kind).find((q) => liftable(b, ua, q));
  const name = F.liftDef(kind).name.toLowerCase();
  say(`They go into ${b.placeName}.`);
  pairLift(st, b, ua, um, P, name);
  nextTurn(st, b);
  check(/slows the walk/.test(H.extractNote(st, b, ua)), `the warning: "${H.extractNote(st, b, ua)}"`);
  const vz = b.raid.vehicleZone >= 0; // the way out the script looked for a carry route to (carryRoute)
  const s = zoneSpots(b, vz).find((q) => zoneSpots(b, vz).some((r) => cheb(q, r) === 1));
  need(!!s, "the way out of the place");
  for (const x of mine(b)) if (x.ap < 1) nextTurn(st, b);
  const bx = b;
  extractAllCrawl(st, bx, ua, s);
  const sa = survivorById(st, ua.sid);
  check(!!sa.gear.carry && sa.gear.carry.crawl && !(p.cargo.gear || []).some((it) => it === sa.gear.carry), `out of the place: the ${name} still in the arms, marked as the crawl's`);
  check(CC.carryLine(st, p) !== "" && H.crawlPieces(st, p).length === 1, `the crawl card: "${CC.carryLine(st, p)}"`);
  // A block away and back: the walk slowed by the piece.
  const plain = CC.CRAWL.MOVE_HOURS;
  const hrs = H.crawlMoveHours(st, p, plain);
  check(hrs === CC.carryPace(st, p).hours, `furnihome.js crawlMoveHours and citycrawl.js carryPace agree (${hrs} h, ${CC.carryPace(st, p).hours} h; the bug the playthrough found: a pair weighed with the whole piece)`);
  const ways = CC.waysOn(c).filter((w) => w.cell && !w.wall);
  need(ways.length > 0, "a way on from the entry block");
  const h0 = st.hour;
  CC.nextBlock(st, p, ways[0].dir);
  if (c.enc) { say(`(on the way: "${c.enc.text}" — the script waves it off)`); c.enc = null; }
  say(`They carry the ${name} a block (${st.hour - h0} h, ${plain} h empty-handed).`);
  const heavy = F.liftDef(kind).kg / 2 > 20; // half of it on each of the two past the light band: a slower walk
  check(st.hour - h0 === hrs && (heavy ? hrs > plain : hrs >= plain), `the walk between blocks by the slowest carrier's pace (crawlMoveHours: ${hrs} h, ${plain} h empty-handed; ${F.liftDef(kind).kg} kg between two)`);
  for (let k = 0; k < 4 && c.cell !== c.entry; k++) {
    const back = CC.waysOn(c).find((w) => w.cell === c.entry) || CC.waysOn(c).find((w) => w.back);
    need(!!back, "the way back to the entry block");
    CC.nextBlock(st, p, back.dir);
    if (c.enc) { say(`(on the way: "${c.enc.text}" — the script waves it off)`); c.enc = null; }
  }
  need(c.cell === c.entry, `back at the entry block (${c.cell}, the entry ${c.entry})`);
  say(`And back to the block at the rim where the van waits (${c.cell === c.entry ? "the entry" : c.cell}).`);
  c.alert = 0;
  const wo = CC.walkOut(st, p);
  need(wo === "" || !st.parties.includes(p) || !p.crawl, `they walk out of the city (${wo || "ok"})`);
  const line = logHas(st, /heaved .* into the/) || (c.log || []).map((l) => l.text).find((l) => /heaved|into the/.test(l)) || "";
  say(`They leave the city: "${line}"`);
  check(!sa.gear.carry && p.cargo.gear.some((it) => it.key === F.liftDef(kind).item), `out at the rim with the ${name}: into the van`);
  return { p };
}
// A crawl place's way out: the pair to the front zone and out (the raid's end keeps the piece in the arms).
function extractAllCrawl(st, b, ua, s) {
  pairTo(st, b, ua, s.x, s.y, "out of the place");
  const z = zoneSpotsAll(b, b.raid.vehicleZone >= 0), inZ = (q) => z.some((c) => c.x === q.x && c.y === q.y);
  for (const x of mine(b).sort((p, q) => inZ(q) - inZ(p))) {
    if (x.left) continue;
    if (x.ap < 1) nextTurn(st, b);
    const e = combatAct(st, { type: "extract", unit: x.id });
    need(e === "", `${first(x)} walks out of the place (${e || "ok"})`);
  }
  if (!b.over) nextTurn(st, b);
  need(b.over, "out of the place");
  finishCombat(st, b.setup, b.result);
}
// F. Home: the pieces as items, and each in its system.
function sceneF(st, before) {
  const h = hub(st);
  const keys = h.armory.filter(Boolean).map((it) => it.key);
  const want = ["fridge", "f_stove", "f_microwave", "f_shelf"];
  say(`At ${h.name}: the armory holds ${want.map((k) => `${keys.filter((x) => x === k).length} × ${k}`).join(", ")}.`);
  check(want.every((k) => keys.filter((x) => x === k).length > (before[k] || 0)), "the pieces arrive as items (f_<kind>; the fridge its own key) in the armory");
  BM.clearAllLand(st, h);
  if (!h.buildings.some((x) => x.type === "gen_hall")) { addBuilding(h, "gen_hall"); say("(the script puts up a hall to set them in)"); }
  for (const x of h.buildings.filter((q) => q.type === "generator")) h.buildings.splice(h.buildings.indexOf(x), 1);
  const fr = setPlaced(st, h, "fridge");
  check(!fr.err && fr.rec, `the fridge set in the hall (${fr.err || "ok"})`);
  refreshPower(st, h);
  const off = storeSpaces(h);
  say(`No generator: ${off.filter((x) => /fridge/.test(x.key)).map((x) => `${x.name} ${x.cap}`).join(", ")}.`);
  check(fr.rec && !isPowered(h, fr.rec) && off.some((x) => x.key === "fridgeoff") && !off.some((x) => x.key === "fridge"), "no power: the fridge is a cupboard (Refrigerators (off))");
  const gen = addBuilding(h, "generator");
  h.stock.fuel = Math.max(h.stock.fuel || 0, 100);
  gen.tank = 5; // a new generator's tank is filled by the refuel chore by day (power.js refuelChore); the script fills it now
  say(`(a generator built, its tank filled with 5 fuel)`);
  const ps = refreshPower(st, h);
  const on = storeSpaces(h);
  say(`A generator: ${on.filter((x) => /fridge/.test(x.key)).map((x) => `${x.name} ${x.cap}`).join(", ")} (supply ${ps.supply}, demand ${ps.demand}${ps.gens.some((g) => !g.running) ? `; ${ps.gens.filter((g) => !g.running).map((g) => g.why || "a generator off").join(", ")}` : ""}).`);
  check(fr.rec && isPowered(h, fr.rec) && on.some((x) => x.key === "fridge" && x.kind === "fridge") && storeFactor("fridge", 20) < 1, `on the generator: a cold room that keeps food (×${storeFactor("fridge", 20)})`);
  const rg = setPlaced(st, h, "range");
  const mw = setPlaced(st, h, "microwave");
  check(!rg.err && !mw.err, `the range and the microwave set (${rg.err || mw.err || "ok"})`);
  addFood(h, "f_potatoes", 200); addFood(h, "f_venison", 50);
  ensureStations(st, h); // the range's first bill (cooking.js: a new station starts with one)
  refreshPower(st, h);
  cookBills(st, h);
  const r = h.cookDay && h.cookDay.st && h.cookDay.st.range;
  say(`The range: ${r ? `${r.batches} batches, ${r.why || "cooking"}` : "no report"}; fuel ${rangeFuel(st, h) || "none"}; the microwave ${microwaveOn(h) ? "on" : "off"}.`);
  check(!!r && r.batches > 0, "the found range cooks");
  check(microwaveOn(h), "the microwave runs on the grid (its ×1.1 on meals)");
  const cap0 = storageOf(st, h).cap;
  const sh = setFurniture(st, h, "f_shelf");
  const cap1 = storageOf(st, h).cap;
  say(`The shelves: ${sh.err || sh.msg}; storage ${cap0} → ${cap1} kg.`);
  check(!sh.err && cap1 === cap0 + 40, "the shelves add 40 kg of storage");
  return true;
}

// ---------- the run ----------
for (const seed of SEEDS) {
  console.log(`\nSeed ${seed}`);
  const st = world(seed);
  const h = hub(st);
  const before = {};
  for (const it of h.armory.filter(Boolean)) before[it.key] = (before[it.key] || 0) + 1;
  let house = null;
  const scene = (name, fn) => {
    where = `seed ${seed}, ${name}`;
    console.log(` ${name}`);
    const out = (() => { try { return fn(); } catch (e) { if (e instanceof Stop) { if (!e.told) check(false, e.message); } else check(false, `crashed: ${String(e.stack).split("\n").slice(0, 3).join(" | ")}`); return null; } })();
    if (!out) { // stopped: the battle dropped, the team home with whatever is in its arms put down
      st.combat = null;
      for (const q of LIVE.splice(0)) if (st.parties.includes(q)) { for (const m of partyMembers(st, q)) if (m.gear) m.gear.carry = null; delete q.crawl; q.path = [hub(st).tile]; q.idx = 0; startReturn(st, q); }
    }
    return out;
  };
  const A = scene("A. Two survivors and the van: the fridge, the range, the sofa, the stairs, a full van", () => sceneA(st));
  if (A) { scene("A. home", () => home(st, A.p)); house = [A.t, A.i]; }
  const B = scene("B. One survivor and the van: the microwave, the shelves in the doorway", () => sceneB(st));
  if (B) scene("B. home", () => home(st, B.p));
  if (!house) try { house = houseOf(st); } catch { house = null; }
  if (house) {
    scene("C. One survivor on foot: a chair dropped from exhaustion", () => sceneC(st, ...house));
    scene("D. Two survivors on foot: the oven dropped, found again next time", () => sceneD(st, ...house));
  }
  const E = scene("E. The city crawl with the van: a piece block to block, out at the rim", () => sceneE(st));
  if (E) scene("E. home", () => home(st, E.p));
  scene("F. At the base: the fridge on a generator, the range, the microwave, the shelves", () => sceneF(st, before));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
