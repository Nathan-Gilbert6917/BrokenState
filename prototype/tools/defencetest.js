// Base defence in three tiers on two maps (src/sim/deploy.js the wall map, interior.js the yard and buildings map),
// verticality, the battle fog of war and the tiers by the numbers (defences.js).
// Checks: the yard map generated from a base's real buildings (deterministic per base, investments show), the wall
// map (wall and gate hit points, walkway, ladders, towers), battering through a wall, a door and a window, the breach
// carrying the battle over to the yard map (units, health, ammo, the attackers inside and outside), falling back by
// order, buildings as cover and the last stand, verticality (sight, aim, cover, climbing, line of sight over walls),
// fog of war (unseen enemies not drawn or targetable, the watchtower's view, night, night vision, a thermal, optics,
// floodlights, last-seen ghosts), the tiers by the numbers (autoResolveCombat, holdCheck, raids), the battle AI
// falling back and taking to the buildings, saving and loading mid-battle on each map, and determinism.
// Usage: node tools/defencetest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import {
  createBattle, combatAct, autoPlayerTurn, runEnemyPhase, endPlayerTurn, registerCombatHandler, active, unitAt, CELL, HEIGHT,
  reachable, shotOdds, meleeOdds, coverAgainst, sightRange, canSee, los, playerSees, playerVision, enemyGhosts, bash, distField,
  autoResolveCombat, heightAt, retreatAdvice,
} from "../src/sim/combat.js";
import { addBuilding, count } from "../src/sim/buildings.js";
import { DEPLOY, deployProblems, wallHp, gateHp, sideUntf } from "../src/sim/deploy.js";
import { INTERIOR, buildInterior, structuresOf, layoutSeed, tierAI, interiorSize, wallMapRows, yardDims, yardGeom } from "../src/sim/interior.js";
import { sizeClass } from "../src/sim/battlesize.js";
import { fightNow, holdCheck, tierMults, raidTier, tierLimits, breakInForce, TIERS } from "../src/sim/defences.js";
import { makeHorde } from "../src/sim/hordes.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { darkSight, nvgSight, nvgOn, activeLight } from "../src/sim/vision.js"; // night sight by the hour, night vision, lights

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("dt", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const BUILT = ["walls", "walls", "barricades", "barricades", "watchtower", "bunkhouse", "storehouse", "ammo_bench", "infirmary", "cistern", "well", "gate", "rain_catcher"];
function fortHub(st, list = BUILT, extra = 2) {
  const h = hub(st);
  for (const t of list) addBuilding(h, t);
  for (let i = 0; i < extra; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  for (const s of atBase(st, h.id)) { s.health = 100; if (!s.gear.weapon) s.gear.weapon = newItem("pistol"); }
  h.stock.ammo = 300; h.stock.meds = 10;
  return h;
}
// A base battle on the hub as the browser opens it (the deploy step).
function baseBattle(st, h, enemy = { kind: "zombies", count: 14, power: 3, name: "the horde" }, context = { through: 150 }) {
  globalThis.window = {};
  try {
    // ready: the defences manned (everyone at a post: defenceplan.js openStart), the maps are what is tested here.
    st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy, ambush: null, canRetreat: true, handler: "dt", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { strip: true, night: false, ready: { manned: true }, ...context } });
  } finally { delete globalThis.window; }
  return st.combat;
}
// An open battlefield with nothing on it (clean geometry for the rules), one of yours and one of theirs.
function cleanBattle(st, enemy = { kind: "raiders", count: 1, power: 3 }) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy, ambush: null, canRetreat: false, handler: "dt", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; delete c.h; delete c.t; }
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  const [p, q] = b.units.filter((u) => u.side === "player");
  const e = b.units.find((u) => u.side === "enemy");
  for (const u of b.units) if (u !== p && u !== q && u !== e) { u.dead = true; u.x = 0; u.y = 0; }
  return { b, p, q, e };
}
const cellAt = (b, x, y) => b.cells[y * b.w + x];
const setH = (b, x, y, k, h) => { const c = cellAt(b, x, y); c.k = k; if (h != null) c.h = h; b.losCache.fill(0); };
const play = (st, n = 240) => { for (let i = 0; i < n && st.combat && !st.combat.over; i++) { const b = st.combat; if (b.phase === "player" || b.phase === "deploy") autoPlayerTurn(st); else runEnemyPhase(st); } };
const eastOf = (b) => sideUntf(b.side, b.tier.w0, b.tier.h0);

// 1. The yard and buildings map from a base's real buildings.
section("The yard and buildings map: from the base's buildings, the same every time");
{
  const st = world();
  const h = fortHub(st);
  const a = buildInterior(h, { walled: true }), a2 = buildInterior(h, { walled: true });
  const sig = (l) => JSON.stringify(l.cells.map((c) => [c.k, c.h || 0, c.hp || 0]));
  check(sig(a) === sig(a2) && layoutSeed(h) === layoutSeed(h), `the same base lays out the same map twice (seed ${layoutSeed(h)})`);
  const names = a.buildings.map((s) => s.name);
  const want = structuresOf(h).map((s) => s.name);
  check(names.includes("Main house") && names.some((x) => x.startsWith("Bunkhouse")) && names.includes("Storehouse") && names.length >= Math.min(5, want.length), `its buildings are on it: ${names.join(", ")} (of ${want.join(", ")})`);
  check(a.lofts.length > 0 && a.cells.some((c) => c.k === "stairs"), `the main house and the bunkhouse have an upper floor (${a.lofts.length} cells, height 1) and stairs`);
  check(a.roofs.length > 0 && a.cells.some((c) => c.k === "ladder"), `the storehouse and the water tank are flat roofs (${a.roofs.length} cells) with a ladder`);
  check(a.doors.length >= a.buildings.filter((s) => !s.roof).length && a.doors.every(([x, y]) => a.cells[y * a.W + x].hp === INTERIOR.DOOR_HP || a.cells[y * a.W + x].hp === INTERIOR.WIDE_DOOR_HP), `every house has barred doors (${a.doors.length}, ${INTERIOR.DOOR_HP} hit points) and windows (${a.windows.length}, ${INTERIOR.WINDOW_HP})`);
  check(a.towers.length === 2 && a.cells.filter((c) => c.k === "barricade").length === count(h, "barricades") * 3 + 2, `a watchtower is two towers inside the wall; ${count(h, "barricades")} barricades + a reinforced gate are ${a.cells.filter((c) => c.k === "barricade").length} barricade cells in the yard`);
  check(a.cells.filter((c) => c.k === "palisade").every((c) => c.hp === wallHp(h)) && a.cells.some((c) => c.k === "gate" && c.hp === gateHp(h)), `the wall line along the east edge with its hit points (${wallHp(h)} a section, gate ${gateHp(h)})`);
  // Reachable: from the back gate to every door's outside, the ladders and the wall.
  const b = { w: a.W, h: a.H, cells: a.cells, losCache: new Int8Array(1), units: [] };
  const my = Math.floor(a.H / 2);
  const field = distField(b, [[0, my]], { side: "player", kind: "human" });
  const doorsOk = a.doors.every(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isFinite(field[(y + dy) * a.W + x + dx]) && !a.indoor[(y + dy) * a.W + x + dx]));
  check(doorsOk && isFinite(field[my * a.W + a.G.WALL_X - 1]), "every door and the wall can be reached from the back gate");
  check(sizeClass(a.W, a.H) === "L" || sizeClass(a.W, a.H) === "XL", `a hub's yard map is Large or Extra-large (${a.W}×${a.H}, sim/battlesize.js), its wall ${a.W - a.G.WALL_X} columns in from the east edge`);
  // A base with more buildings than fit in 16 rows: a taller yard map holds every one, and its wall map is as long.
  {
    const st3 = world();
    const h3 = fortHub(st3, [...BUILT, "bunkhouse", "garage", "radio", "common_room", "cells", "cellar"]);
    const big = buildInterior(h3, { walled: true });
    const want3 = structuresOf(h3).length;
    const b3 = baseBattle(st3, h3);
    const [w0, h0] = yardDims(h3);
    check(big.W === w0 && big.H >= h0 && (big.H - h0) % INTERIOR.H_GROW === 0 && w0 * h0 > yardDims(h).reduce((x, y) => x * y) && !big.missed && big.buildings.length === want3 && interiorSize(h3).H === big.H, `a base with ${want3} buildings gets a ${big.W}×${big.H} yard map holding all of them (one with ${structuresOf(h).length}: ${yardDims(h).join("×")}; no base: ${INTERIOR.W}×${INTERIOR.H})`);
    check(b3.tier.map === "wall" && Math.min(b3.w, b3.h) === 18 && Math.max(b3.w, b3.h) === big.H - INTERIOR.WALL_ROWS && b3.tier.h0 === wallMapRows(h3) && !deployProblems(b3).length, `and its wall map is as long: ${b3.tier.w0}×${b3.tier.h0}, the defenders on their posts`);
    st3.combat = null;
  }
  // Investments show: more barricades, a sandbag bundle in the armory, more buildings.
  const st2 = world();
  const h2 = fortHub(st2, ["walls"], 0);
  const bare = buildInterior(h2, { walled: true });
  addBuilding(h2, "barricades"); addBuilding(h2, "barricades"); addBuilding(h2, "bunkhouse"); h2.armory.push(newItem("sandbags"));
  const more = buildInterior(h2, { walled: true });
  const n = (l, k) => l.cells.filter((c) => c.k === k).length;
  check(n(more, "barricade") === n(bare, "barricade") + 6 && n(more, "sandbag") === n(bare, "sandbag") + 3 && more.buildings.length === bare.buildings.length + 1 && layoutSeed(h2) !== 0,
    `building more changes the map: barricades ${n(bare, "barricade")} → ${n(more, "barricade")}, sandbags ${n(bare, "sandbag")} → ${n(more, "sandbag")}, buildings ${bare.buildings.length} → ${more.buildings.length}`);
}

// 2. The wall map.
section("The wall map (tier 1)");
{
  const st = world();
  const h = fortHub(st);
  const b = baseBattle(st, h);
  const ks = (k) => b.cells.filter((c) => c.k === k);
  check(b.tier.map === "wall" && b.phase === "deploy" && deployProblems(b).length === 0, `opens on the wall map, deploy step, default posts valid (${deployProblems(b).join("; ") || "ok"})`);
  check(ks("palisade").every((c) => c.mhp === wallHp(h) && c.hp <= c.mhp && c.t === 1) && ks("gate").every((c) => c.bar && c.mhp === gateHp(h) && c.hp < c.mhp), `wall sections ${wallHp(h)} hit points and block sight from the ground; the gate barred, ${gateHp(h)}; 150 of the dead through have battered both (gate ${ks("gate")[0].hp})`);
  check(ks("walkway").length >= 6 && ks("walkway").every((c) => c.h === 1) && ks("ladder").length >= 3 && ks("tower").every((c) => c.h === 2), `a walkway (${ks("walkway").length} cells, height 1), ${ks("ladder").length} ladders, towers at height 2`);
  const on = b.units.filter((u) => u.side === "player" && ["walkway", "tower"].includes(cellAt(b, u.x, u.y).k));
  check(on.length >= 3 && on.every((u) => u.post === "wall" || u.post === "tower"), `the default posts put ${on.length} shooters on the walkway and the towers`);
  // Battering: the dead next to a wall section with nowhere to go batter it down; it becomes a breach and the walkway behind it comes down.
  const sec = (() => { for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (cellAt(b, x, y).k === "palisade") return [x, y]; return null; })();
  const z = b.units.find((u) => u.side === "enemy" && u.kind === "zombie");
  const hp0 = cellAt(b, sec[0], sec[1]).hp;
  let hits = 0;
  while (cellAt(b, sec[0], sec[1]).k === "palisade" && hits < 40) { bash(b, z, sec[0], sec[1]); hits++; }
  const broken = cellAt(b, sec[0], sec[1]);
  check(broken.k === "breach" && !broken.t && hits >= 3, `a wall section (${hp0} hit points) comes down after ${hits} blows: a breach`);
  const gateCell = (() => { for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (cellAt(b, x, y).k === "gate") return [x, y]; return null; })();
  const zr = reachable(b, z, 99);
  check(!isFinite(zr.dist[gateCell[1] * b.w + gateCell[0]]), "the dead cannot walk through the barred gate");
  const pz = b.units.find((u) => u.side === "player" && active(u));
  check(isFinite(reachable(b, pz, 99).dist[gateCell[1] * b.w + gateCell[0]]) || !!unitAt(b, gateCell[0], gateCell[1]), "your people can (it opens for them)");
}

// 3. The breach: the battle moves to the yard map, carrying everything over.
section("Through the wall: the yard and buildings map (tier 2)");
{
  const st = world();
  const h = fortHub(st);
  const b = baseBattle(st, h, { kind: "zombies", count: 12, power: 3, name: "the horde" });
  combatAct(st, { type: "start" });
  const un = eastOf(b);
  // Four of the dead are already inside the wall; one of yours is down on the walkway, one hurt.
  const zs = b.units.filter((u) => u.side === "enemy");
  let k = 0;
  for (let y = 0; y < b.h && k < 4; y++) for (let x = 0; x < b.w && k < 4; x++) {
    const [ex] = un(x, y);
    if (ex >= 4 && ex <= 7 && CELL[cellAt(b, x, y).k].walk && !unitAt(b, x, y)) { zs[k].x = x; zs[k].y = y; k++; }
  }
  const mine = b.units.filter((u) => u.side === "player");
  const downed = mine.find((u) => cellAt(b, u.x, u.y).k === "walkway");
  downed.down = true; downed.hp = 0; downed.bleed = 3;
  const hurt = mine.find((u) => u !== downed && active(u));
  hurt.hp = 37;
  const ammo0 = h.stock.ammo;
  const ids = new Set(b.units.map((u) => u.id));
  const outside0 = zs.filter((u) => { const [ex] = un(u.x, u.y); return ex > DEPLOY.WALL_X; }).length;
  for (const u of mine) u.ap = 0;
  endPlayerTurn(st);
  for (const u of b.units) if (u.side === "enemy") u.ap = 0; // they stand still this turn: the breach is checked as your turn starts
  runEnemyPhase(st);
  check(b.tier.map === "interior" && b.w * b.h === b.tier.w0 * b.tier.h0 && b.tier.w0 === interiorSize(st.bases.find((x) => x.id === b.setup.baseId)).W && b.phase === "deploy", `${k} of the dead inside the wall: on to the yard map (${b.w}×${b.h}), a redeploy first`);
  check(b.units.every((u) => ids.has(u.id)) && hurt.hp === 37 && downed.down && !downed.dead && h.stock.ammo === ammo0, "the same people carry over: health (37 stays 37), the downed still down, the base's ammo untouched");
  const unB = sideUntf(b.side, b.tier.w0, b.tier.h0);
  const [dx] = unB(downed.x, downed.y);
  const G = yardGeom(b.tier.w0);
  check(Math.abs(dx - (DEPLOY.LINE_X + G.SHIFT_X)) <= 2, `the one down on the walkway lies just inside the wall on the yard map (column ${dx}, the wall at ${G.WALL_X})`);
  const off = b.units.filter((u) => u.off);
  const inYard = zs.filter((u) => !u.off && !u.dead && b.tier.interior[u.y * b.w + u.x]);
  check(off.length === outside0 && inYard.length === k, `the ${k} inside came along, the ${off.length} outside wait to come in through the openings`);
  check(deployProblems(b).length === 0 && b.units.filter((u) => u.side === "player" && active(u)).every((u) => b.units.filter((e) => e.side === "enemy" && active(e)).every((e) => Math.hypot(e.x - u.x, e.y - u.y) >= INTERIOR.REDEPLOY_GAP)), `redeploy: valid posts, at least ${INTERIOR.REDEPLOY_GAP} tiles from the attackers`);
  const indoors = b.units.filter((u) => u.side === "player" && active(u) && b.tier.indoor[u.y * b.w + u.x]).length;
  check(indoors >= 1, `the default posts take people into the buildings (${indoors})`);
  combatAct(st, { type: "start" });
  check(b.phase === "player", "Hold the yard: your turn");
  for (const u of b.units) if (u.side === "player") u.ap = 0;
  endPlayerTurn(st);
  check(b.units.filter((u) => u.off).length < off.length, `${off.length - b.units.filter((u) => u.off).length} come in at the wall as the attackers' turn starts`);
  runEnemyPhase(st);
  play(st);
  check(b.over && b.result && ["yard", "buildings", "overrun", "abandoned"].includes(b.result.tier) && b.result.fellBack, `fought to the end on the yard map: ${b.result.outcome} (${b.result.tier})`);
}

// 4. Falling back by order.
section("Falling back from the wall");
{
  const st = world();
  const h = fortHub(st);
  const b = baseBattle(st, h);
  combatAct(st, { type: "start" });
  check(combatAct(st, { type: "fallBack" }) === "" && b.tier.map === "interior" && b.tier.why === "ordered", "Fall back (Shift+R on the wall map): to the yard map");
  check(b.units.filter((u) => u.off).length === b.units.filter((u) => u.side === "enemy").length, "everyone still outside waits to come through the openings");
  combatAct(st, { type: "start" });
  check(b.phase === "enemy", "after the redeploy the attackers move first");
  check(combatAct(st, { type: "fallBack" }) !== "", "there is nowhere further to fall back to");
}

// 5. Buildings: barred doors, windows, cover inside.
section("The buildings (tier 3)");
{
  const st = world();
  const h = fortHub(st);
  const b = baseBattle(st, h);
  combatAct(st, { type: "start" });
  combatAct(st, { type: "fallBack" });
  combatAct(st, { type: "start" });
  runEnemyPhase(st);
  const outsideDoor = (x0, y0) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x0 + dx, y0 + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && !b.tier.indoor[y * b.w + x] && CELL[cellAt(b, x, y).k].walk && heightAt(b, x, y) === 0);
  let doorAt = null, out = null;
  for (let i = 0; i < b.w * b.h && !doorAt; i++) if (b.cells[i].k === "bdoor") { const o = outsideDoor(i % b.w, (i / b.w) | 0); if (o) { doorAt = [i % b.w, (i / b.w) | 0]; out = o; } }
  const z = b.units.find((u) => u.side === "enemy" && u.kind === "zombie");
  z.off = false;
  const blocker = unitAt(b, out[0], out[1]); if (blocker) { blocker.x = 0; blocker.y = 0; }
  z.x = out[0]; z.y = out[1];
  const zr = reachable(b, z, 99);
  check(!isFinite(zr.dist[doorAt[1] * b.w + doorAt[0]]), "a barred door: the dead cannot walk in");
  let blows = 0;
  while (cellAt(b, doorAt[0], doorAt[1]).k === "bdoor" && blows < 20) { bash(b, z, doorAt[0], doorAt[1]); blows++; }
  check(cellAt(b, doorAt[0], doorAt[1]).k === "doorway" && isFinite(reachable(b, z, 99).dist[doorAt[1] * b.w + doorAt[0]]), `${blows} blows break it in: now they can`);
  // Cover inside: next to a wall, against someone outside in front of it.
  const wallC = (() => { for (let i = 0; i < b.w * b.h; i++) if (b.cells[i].k === "wall") { const x = i % b.w, y = (i / b.w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ix = x + dx, iy = y + dy, ox = x - dx, oy = y - dy; if (ix >= 0 && iy >= 0 && ox >= 0 && oy >= 0 && ix < b.w && iy < b.h && ox < b.w && oy < b.h && b.tier.indoor[iy * b.w + ix] && cellAt(b, ix, iy).k === "open" && !b.tier.indoor[oy * b.w + ox]) return [ix, iy, x - dx * 4, y - dy * 4]; } } return null; })();
  check(!!wallC && coverAgainst(b, wallC[0], wallC[1], Math.max(0, Math.min(b.w - 1, wallC[2])), Math.max(0, Math.min(b.h - 1, wallC[3]))).level === 2, "inside, against a wall: full cover from the yard");
  // The window: battered in, it is a hole.
  const win = (() => { for (let i = 0; i < b.w * b.h; i++) if (b.cells[i].k === "window") return [i % b.w, (i / b.w) | 0]; return null; })();
  const c = cellAt(b, win[0], win[1]);
  check(c.hp === INTERIOR.WINDOW_HP && !CELL.window.walk, `windows: ${c.hp} hit points, half cover, not a way in`);
  // The last stand: the yard full of the dead, your people outside the buildings: the AI takes them in.
  const T = b.tier;
  T.stage = "buildings";
  const u = b.units.find((p) => p.side === "player" && active(p) && !T.indoor[p.y * b.w + p.x]) || b.units.find((p) => p.side === "player" && active(p));
  if (T.indoor[u.y * b.w + u.x]) { for (let i = 0; i < b.w * b.h; i++) if (!T.indoor[i] && T.interior[i] && CELL[b.cells[i].k].walk && !unitAt(b, i % b.w, (i / b.w) | 0) && heightAt(b, i % b.w, (i / b.w) | 0) === 0) { u.x = i % b.w; u.y = (i / b.w) | 0; break; } }
  const field = (x, y) => { let best = 99; for (let i = 0; i < b.w * b.h; i++) if (T.indoor[i]) best = Math.min(best, Math.hypot(i % b.w - x, ((i / b.w) | 0) - y)); return best; };
  const before = field(u.x, u.y);
  u.ap = 2; b.phase = "player";
  const moved = tierAI(b, u);
  check(moved && field(u.x, u.y) < before, `the last stand: the battle AI takes ${u.name} toward the buildings (${before.toFixed(1)} → ${field(u.x, u.y).toFixed(1)} tiles)`);
}

// 6. Verticality.
section("Verticality: sight, aim, cover, climbing");
{
  const st = world();
  fortHub(st, [], 0);
  const { b, p, q, e } = cleanBattle(st);
  p.x = 4; p.y = 6; q.x = 2; q.y = 2; e.x = 12; e.y = 6; e.aware = true;
  const s0 = sightRange(b, p), a0 = shotOdds(b, p, e).chance;
  setH(b, 4, 6, "walkway", 1);
  check(sightRange(b, p) === s0 + HEIGHT.SIGHT, `height 1: sight ${s0} → ${sightRange(b, p)}`);
  check(shotOdds(b, p, e).chance === Math.min(95, a0 + HEIGHT.AIM), `aim down at a lower target: ${a0}% → ${shotOdds(b, p, e).chance}%`);
  check(coverAgainst(b, 4, 6, 12, 6).level === HEIGHT.COVER && coverAgainst(b, 4, 6, 5, 6).level === 0, "half cover against a shooter below, none against one right next to them");
  setH(b, 4, 6, "tower", 2);
  check(sightRange(b, p) === s0 + 2 * HEIGHT.SIGHT && shotOdds(b, p, e).chance === Math.min(95, a0 + HEIGHT.MAX_AIM) && coverAgainst(b, 4, 6, 12, 6).level === 2, `a watchtower (height 2): sight ${sightRange(b, p)}, +${HEIGHT.MAX_AIM} aim, full cover`);
  // Line of sight over a wall: from the ground a wall blocks; from a walkway (height 1) a wall right in front does not.
  setH(b, 4, 6, "open", 0); delete cellAt(b, 4, 6).h;
  setH(b, 5, 6, "wall");
  check(!los(b, 4, 6, 12, 6), "on the ground a wall blocks the line of sight");
  setH(b, 4, 6, "walkway", 1);
  check(los(b, 4, 6, 12, 6), "from the walkway behind it, the line passes over");
  setH(b, 5, 6, "open"); setH(b, 11, 6, "wall");
  check(!los(b, 4, 6, 12, 6), "but not into the dead ground right behind a wall near the target");
  setH(b, 11, 6, "open");
  // Climbing: only by a ladder, 1 move a level (the dead 2).
  setH(b, 4, 6, "open", 0); delete cellAt(b, 4, 6).h;
  setH(b, 6, 6, "walkway", 1);
  let r = reachable(b, p, 10);
  check(!isFinite(r.dist[6 * b.w + 6]), "no ladder: the walkway cannot be climbed");
  setH(b, 5, 6, "ladder");
  r = reachable(b, p, 10);
  check(Math.abs(r.dist[6 * b.w + 6] - (2 + HEIGHT.CLIMB)) < 1e-6, `by the ladder: 2 steps + ${HEIGHT.CLIMB} to climb = ${r.dist[6 * b.w + 6]}`);
  const z = { ...e, kind: "zombie", side: "enemy", x: 4, y: 6, id: 999 };
  b.units.push(z); p.x = 1; p.y = 1;
  r = reachable(b, z, 10);
  b.units.pop();
  check(Math.abs(r.dist[6 * b.w + 6] - (2 + HEIGHT.CLIMB_DEAD)) < 1e-6, `the dead climb slower: ${r.dist[6 * b.w + 6]}`);
  // Striking up at someone higher.
  p.x = 6; p.y = 6; e.x = 7; e.y = 6;
  setH(b, 7, 6, "open"); delete cellAt(b, 7, 6).h;
  const up = meleeOdds(b, e, p).chance;
  setH(b, 6, 6, "open"); delete cellAt(b, 6, 6).h;
  check(meleeOdds(b, e, p).chance - up === HEIGHT.MELEE_UP || meleeOdds(b, e, p).chance === 95, `a blow struck up at someone higher: ${HEIGHT.MELEE_UP} harder (${up}% vs ${meleeOdds(b, e, p).chance}%)`);
}

// 7. Fog of war.
section("Fog of war");
{
  const st = world();
  fortHub(st, [], 0);
  const { b, p, q, e } = cleanBattle(st);
  p.x = 2; p.y = 6; q.x = 2; q.y = 8; e.x = 12; e.y = 6; e.aware = true;
  check(playerSees(b, e) && playerVision(b)[6 * b.w + 12] === 1, "an enemy in the open within sight is seen");
  combatAct(st, { type: "hunker", unit: q.id }); // anything that bumps the battle records what is seen
  for (let y = 0; y < b.h; y++) setH(b, 8, y, "wall");
  check(!playerSees(b, e) && playerVision(b)[6 * b.w + 12] === 0, "behind a wall it is not (and its cell is fogged)");
  check(combatAct(st, { type: "shoot", unit: p.id, target: e.id }) === "No line of sight.", "an unseen enemy cannot be shot");
  const g = enemyGhosts(b);
  check(g.length === 1 && g[0].x === 12 && g[0].turn === 1, "a ghost marks where it was last seen (turn 1)");
  for (let y = 0; y < b.h; y++) setH(b, 8, y, "open");
  // A watchtower sees over a 1-storey wall and further.
  e.x = 16; e.y = 6;
  for (let y = 0; y < b.h; y++) setH(b, 10, y, "wall");
  check(!playerSees(b, e), "the ground cannot see past a wall 8 tiles off");
  setH(b, 2, 6, "tower", 2);
  check(los(b, 2, 6, 16, 6) && playerSees(b, e) && sightRange(b, p) === p.sight + 4, `a manned watchtower sees over it (sight ${sightRange(b, p)})`);
  setH(b, 2, 6, "open"); delete cellAt(b, 2, 6).h;
  for (let y = 0; y < b.h; y++) setH(b, 10, y, "open");
  // Night: 7 tiles; night vision 13; a thermal at night too; binoculars only by day.
  const st2 = world();
  const h2 = fortHub(st2, ["walls"], 0);
  const people = atBase(st2, h2.id);
  people[0].gear.tool = newItem("nvg");
  people[1].gear.tool = newItem("thermal");
  people[2].gear.tool = null;
  const b2 = baseBattle(st2, h2, { kind: "zombies", count: 6, power: 2 }, { through: 50, night: true });
  const unit = (s) => b2.units.find((u) => u.sid === s.id);
  const [n0, n1, n2] = [unit(people[0]), unit(people[1]), unit(people[2])];
  // Night sight by the hour (vision.js, 2026-10-12): plain eyes see darkSight tiles (7 at dusk, 4 in the dead of
  // night), night vision as far as a military flashlight's beam (nvgSight: 12), a thermal the same with its +2.
  check(b2.night && n2.sight === darkSight(b2) && n0.sight === nvgSight(n0) && nvgSight(n0) === 12 && n1.sight === 12 && n1.optic === 2,`a base battle at night: plain sight ${n2.sight}, night vision ${n0.sight}, a thermal ${n1.sight} (+${n1.optic})`);
  check(b2.units.filter((u) => u.side === "enemy").every((u) => u.sight === 5), "the dead see 5 at night");
  const st3 = world();
  const h3 = fortHub(st3, ["walls"], 0);
  atBase(st3, h3.id)[2].gear.pack = null;
  atBase(st3, h3.id)[2].pockets = [newItem("binoculars"), null, null, null];
  const b3 = baseBattle(st3, h3, { kind: "zombies", count: 6, power: 2 }, { through: 50, night: false });
  const bin = b3.units.find((u) => u.sid === atBase(st3, h3.id)[2].id);
  check(bin && bin.optic === 3 && sightRange(b3, bin) >= 16, `binoculars by day: +${bin && bin.optic} sight`);
  // Floodlights at night: a lit cell is seen out to the daylight range.
  const st4 = world();
  const h4 = fortHub(st4, ["walls", "floodlights"], 0);
  h4.stock.fuel = 10;
  const b4 = baseBattle(st4, h4, { kind: "zombies", count: 6, power: 2 }, { through: 50, night: true, floodlit: true });
  // The eye: a plain-sighted defender on the ground with some floodlit ground in its line of sight beyond what it sees
  // in the dark (darkSight, by the hour: vision.js; the wrecks on the road through the yard can hide every lit cell
  // from one of them). A lit cell is seen out to the daylight range whatever way they face (combat.js canSeeAt).
  const eyes = b4.units.filter((u) => u.side === "player" && active(u) && u.sight === darkSight(b4) && !nvgOn(u) && !activeLight(u) && heightAt(b4, u.x, u.y) === 0);
  const litInLos = (eye) => { let n = 0; for (let i = 0; i < b4.w * b4.h; i++) { const x = i % b4.w, y = (i / b4.w) | 0, d = Math.hypot(x - eye.x, y - eye.y); if (b4.lit[i] && d > sightRange(b4, eye) && d <= 13 && los(b4, eye.x, eye.y, x, y)) n++; } return n; };
  const eye = eyes.find((u) => litInLos(u) > 0) || eyes[0];
  let litFar = 0, darkFar = 0;
  if (eye) for (let i = 0; i < b4.w * b4.h; i++) {
    const x = i % b4.w, y = (i / b4.w) | 0, d = Math.hypot(x - eye.x, y - eye.y);
    if (d <= sightRange(b4, eye) || d > 13 || !los(b4, eye.x, eye.y, x, y)) continue;
    const seen = playerVision(b4)[i];
    if (b4.lit[i]) litFar += seen ? 1 : 0; else darkFar += seen ? 1 : 0;
  }
  check(!!eye && litFar > 0, `at night floodlit ground beyond plain sight is seen (${litFar} cells), dark ground beyond it only by others (${darkFar})`);
}

// 8. The tiers by the numbers.
section("The tiers by the numbers");
{
  const st = world();
  const h = hub(st);
  // The hub starts bare (barestart); these numbers were set on the old start's buildings (a wall section, a bunkhouse:
  // with neither, one more barricade lands on a flat stretch of the horde's strength and the yard limit stays put).
  for (const t of ["farm_plot", "farm_plot", "craftbench", "bunkhouse", "walls"]) addBuilding(h, t);
  const m0 = tierMults(st, h, false);
  for (const t of ["walls", "watchtower", "gate", "barricades", "barricades", "bunkhouse"]) addBuilding(h, t);
  h.armory.push(newItem("sandbags"));
  const m1 = tierMults(st, h, false);
  check(m1.wall > m0.wall && m1.yard > m0.yard && m1.buildings > m0.buildings, `walls, a tower and the gate raise the wall tier (${m0.wall.toFixed(2)} → ${m1.wall.toFixed(2)}), barricades and sandbags the yard (${m0.yard.toFixed(2)} → ${m1.yard.toFixed(2)}), a bunkhouse the buildings (${m0.buildings.toFixed(2)} → ${m1.buildings.toFixed(2)})`);
  const c = holdCheck(st, h, 2000);
  const small = holdCheck(st, h, 30);
  check(small.holds && small.tier === "wall" && !c.holds && c.through > 0 && c.tier === "overrun" && c.buildingsLimit >= c.yardLimit, `holdCheck: 30 held at the walls; 2000 breaks in (${c.through} inside) past the yard (holds ${c.yardLimit}) and the buildings (${c.buildingsLimit})`);
  // One barricade raises the yard's multiplier; the limit is a horde count, and the horde's strength has flat stretches
  // (one step can land on one, as the defenders' traits move their power), so it must not fall and enough to cross a
  // stretch must raise it. A stretch is about one of the dead wide (breakInForce: n of them at a power rounded to 0.1,
  // n one more every 7 broken in): 1/n of the strength, 7% at n = 14, more than two barricades' 6% (the start's people
  // are rolled anew whenever the world's dice change: seed 42's defenders went 30.4 → 31.7 over the merges of
  // 2026-10-10/11 and landed at the foot of one). So the barricades that add more than 1/n, and one more for the rounding.
  const lim0 = tierLimits(st, h).yard, yard0 = tierMults(st, h, false).yard;
  const need = Math.ceil(1 / breakInForce(st, h, lim0).count / TIERS.YARD.barricade) + 1;
  const lims = [lim0];
  for (let i = 0; i < need; i++) { addBuilding(h, "barricades"); lims.push(tierLimits(st, h).yard); }
  check(tierMults(st, h, false).yard > yard0 && lims.every((l, i) => !i || l >= lims[i - 1]) && lims[need] > lim0, `more barricades: the yard holds more (${lims.join(" → ")})`);
  // A raid by the numbers through the tiers.
  const r1 = raidTier(st, h, 100, 70, 1.2, 0.8), r2 = raidTier(st, h, 100, 115, 1.2, 0.8), r3 = raidTier(st, h, 100, 400, 1.2, 0.8);
  check(r1.tier === "wall" && ["yard", "buildings"].includes(r2.tier) && r2.ratio >= 0.8 && r2.ratio < 1.2 && r3.tier === "overrun", `raids: 100 against 70 held at the wall, against 115 pushed back from the ${r2.tier}, against 400 overrun`);
  // autoResolveCombat counts the tiers on a base battle.
  let walls = 0, wins = 0, n = 0;
  for (let i = 0; i < 40; i++) {
    const w = world(seed + i);
    const hh = fortHub(w, BUILT, 0);
    const res = autoResolveCombat(w, { tile: hh.tile, baseId: hh.id, enemy: { kind: "raiders", count: 5, power: 3 }, ambush: null, canRetreat: true, handler: "dt", layout: "baseDefence", context: { strip: true, night: false } });
    n++; if (res.outcome === "victory") wins++; if (res.tier === "wall") walls++;
    if (!res.tier) { walls = -99; break; }
  }
  check(walls >= 0 && wins > 0, `auto-resolve of a base battle reports where it was decided (${wins}/${n} won, ${walls} at the walls)`);
}

// 9. The AI: posts on the wall, falling back when it is lost, fighting it out headless.
section("The battle AI");
{
  const st = world();
  const h = fortHub(st);
  const b = baseBattle(st, h, { kind: "zombies", count: 20, power: 6, name: "the horde" }, { through: 400 });
  combatAct(st, { type: "start" });
  // The wall is clearly lost: half of the team down.
  const mine = b.units.filter((u) => u.side === "player");
  mine.slice(0, Math.ceil(mine.length / 2)).forEach((u) => { u.down = true; u.hp = 0; u.bleed = 3; });
  const adv = retreatAdvice(b);
  check(!!adv && adv.fallBack, `half the defenders down on the wall: the AI's advice is to fall back (${adv ? adv.why : "none"})`);
  autoPlayerTurn(st);
  check(b.tier.map === "interior", "and it falls back to the yard");
  // Headless (the autopilot's break-ins): fightNow plays both maps to the end.
  const st2 = world(seed + 1);
  const h2 = fortHub(st2);
  const hd = makeHorde(st2, { tile: h2.tile, size: 300, role: "attack" });
  st2.combat = null;
  fightNow(st2, { tile: h2.tile, baseId: h2.id, enemy: { kind: "zombies", count: 16, power: 3.5, name: "the horde" }, ambush: null, canRetreat: true, handler: "dt", layout: "baseDefence", downedLive: 0.4, deploy: true, context: { strip: true, hordeId: hd.id, through: 250 } });
  check(!st2.combat, "headless, a break-in is fought to the end on both maps");
}

// 10. Saving and loading mid-battle on each map, and determinism.
section("Saving mid-battle, determinism");
{
  // A break-in played by the AI (falling back on turn fallAt if given), saved and loaded the first time it is the
  // player's turn on the map saveOn (null: never). Returns whether it saved and the battle's signature.
  const run = (s, { saveOn = null, fallAt = 0 } = {}) => {
    const st = world(s);
    const h = fortHub(st);
    baseBattle(st, h, { kind: "zombies", count: 16, power: 4, name: "the horde" }, { through: 300 });
    let cur = st, saved = false;
    for (let i = 0; i < 300 && cur.combat && !cur.combat.over; i++) {
      const b = cur.combat;
      if (saveOn && !saved && b.phase === "player" && b.tier.map === saveOn) { cur = loadFromString(saveToString(cur)); saved = true; continue; }
      if (fallAt && b.turn === fallAt && b.phase === "player" && b.tier.map === "wall") { combatAct(cur, { type: "fallBack" }); continue; }
      if (b.phase === "player" || b.phase === "deploy") autoPlayerTurn(cur); else runEnemyPhase(cur);
    }
    const b = cur.combat;
    return { saved, sig: JSON.stringify([b.result && b.result.outcome, b.result && b.result.tier, b.turn, b.log.map((l) => l.text), b.units.map((u) => [u.x, u.y, Math.round(u.hp), !!u.dead])]) };
  };
  const plain = run(seed + 5), again = run(seed + 5);
  check(plain.sig === again.sig && plain.sig.length > 500, `the same seed plays out the same (${plain.sig.length} characters)`);
  const onWall = run(seed + 5, { saveOn: "wall" });
  check(onWall.saved && onWall.sig === plain.sig, "saved and loaded on the wall map: it plays on the same");
  const yardPlain = run(seed + 6, { fallAt: 3 }), onYard = run(seed + 6, { fallAt: 3, saveOn: "interior" });
  check(onYard.saved && onYard.sig === yardPlain.sig, "saved and loaded on the yard map: it plays on the same");
}

// 11. A base without walls.
section("A base without walls");
{
  const st = world();
  const h = fortHub(st, ["barricades", "bunkhouse", "spike_pits"], 0);
  h.buildings = h.buildings.filter((x) => x.type !== "walls");
  const b = baseBattle(st, h, { kind: "raiders", count: 6, power: 3, name: "raiders" }, { pits: 1 });
  check(b.tier.map === "interior" && !b.deploy.walled && b.cells.some((c) => c.k === "spikes") && deployProblems(b).length === 0, "no walls: the battle opens on the yard map, the spike pits in the yard");
  combatAct(st, { type: "start" });
  play(st);
  check(b.over && ["yard", "buildings", "overrun", "abandoned"].includes(b.result.tier), `fought out on the yard map: ${b.result.outcome} (${b.result.tier})`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
