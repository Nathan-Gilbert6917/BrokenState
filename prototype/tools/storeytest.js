// Storeys (docs/multi-storey-crawl.md, src/sim/buildingmaps.js + combat.js): buildings with several floors.
//   - every BUILDINGS type assembles with its storey range (STOREYS_BY_TYPE), a footprint of its class (spec.foot; "huge":
//     the supermarket since issue #22, its map its footprint and margins, past the largest class) and a
//     map that fits it; towers shrink as they grow; every floor is the ground map's size, "void" outside the footprint,
//     has the stairwell cells, and every walkable cell of it is reachable from the stairwell (the ground floor's
//     stairwell from the front zone);
//   - in a raid: b.floors / b.floor / setFloor and the aliases; Go up / Go down (1 action, the same x, y, refused when
//     the far cell is taken, the top only down, the ground only up); units on another floor are off this floor's map
//     (not seen, not bumped into, not reachable); containers on an upper floor are searchable only there; no extraction
//     from upstairs; the enemy phase runs on every floor that holds anyone and the view floor comes back; aware dead on
//     an empty floor drift to the stairwell and arrive next turn; Heat is one number; fx carry their floor;
//   - the city crawl: block depth adds storeys to offices and apartments (+1 at block 4, +2 at block 7, at most 8), the
//     card's count is the building's; a building left on an upper floor and gone back into is as it was left;
//   - save and load mid-raid on floor 2, then play to the end; the bot plays multi-storey buildings to the end;
//   - stair runs (issue #9): every multi-storey type has a run of steps against a wall with a landing at each end; its
//     steps are "stairs" on every floor it joins (the top step marked), its landings walkable on all of them, every room
//     of every floor reachable from a landing, no step a door's approach; Go up only from the top step, arriving there
//     a floor up with the upper landing next to it; a save from before (one-cell stairwells, no runs) still loads and
//     plays, and a building's kept snapshot from before restores its one-cell stairwells;
//   - footprint shapes (issue #23): a part with fewer storeys is open air above and one storey high (a gym's tall),
//     every floor up reached from its stairs, the runs in a part with every storey; a crawl's shaped school kept and
//     given back as it was left.
// Usage: node tools/storeytest.js [seeds=6]
import { turnToBox } from "../src/sim/vision.js";
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import {
  createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler, combatAct, CELL, los, active, activeAny, unitAt, setFloor, stairOptions,
  searchableNear, boxAt, playerSees, reachable, endPlayerTurn, finishCombat, HEIGHT, zoneAt, FLOOR_RICH, enemyUnit,
} from "../src/sim/combat.js";
import { BUILDINGS, STOREYS_BY_TYPE, MAX_STOREYS, assemble, buildingSpec, siteBuildings, runSteps, runLandings, runTop, STAIR_DIRS } from "../src/sim/buildingmaps.js";
import { sizeClass } from "../src/sim/battlesize.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { Rng } from "../src/sim/rng.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import * as CC from "../src/sim/citycrawl.js";

const SEEDS = Number(process.argv[2] || 6);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();
registerCombatHandler("stest", () => {});

// 4-way walk over one floor's grid (locked doors count as ways through).
function walk(cells, W, H, sx, sy) {
  const seen = new Uint8Array(W * H);
  const pass = (c) => CELL[c.k].walk || c.k === "door";
  const q = [sy * W + sx];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}

// ======================================================================================
console.log(`Generation: every type (${Object.keys(BUILDINGS).length}), ${SEEDS} seeds each`);
{
  const FOOT = { // footprint area (cells) by class, and the biggest width a tower has
    small: (a) => a <= 190, medium: (a) => a >= 90 && a <= 360, large: (a) => a >= 290, wide: (a, bw) => a >= 280 && bw >= 20, tower: (a, bw) => a <= 330 && bw <= 22,
    huge: (a, bw) => a >= 1800 && bw >= 50, // the supermarket (issue #22): past the largest size class, its map its footprint and margins
  };
  let bad = 0, multi = 0, floorsSeen = 0;
  const towers = [];
  const storeysBy = {};
  for (const key of Object.keys(BUILDINGS)) {
    const range = STOREYS_BY_TYPE[key];
    storeysBy[key] = new Set();
    for (let s = 0; s < SEEDS; s++) {
      const rng = new Rng(500 + s * 7919 + key.length * 31);
      const spec = BUILDINGS[key].make(rng, {});
      const errs = [];
      const n = spec.storeys || 1;
      storeysBy[key].add(n);
      if (!range) errs.push("no storey range in STOREYS_BY_TYPE");
      else if (n < range[0] || n > range[1]) errs.push(`${n} storeys, expected ${range[0]}–${range[1]}`);
      if (!spec.foot || !FOOT[spec.foot]) errs.push(`no footprint class (${spec.foot})`);
      else if (!FOOT[spec.foot](spec.bw * spec.bh, spec.bw)) errs.push(`footprint ${spec.bw}x${spec.bh} is not ${spec.foot}`);
      if (spec.foot === "tower") towers.push([n, spec.bw * spec.bh]);
      if (n > 1 && typeof spec.upper !== "function") errs.push("storeys but no upper-floor plan");
      let m;
      try { m = assemble(rng, spec, { key, name: BUILDINGS[key].name, withVehicle: s % 2 === 1 }); } catch (e) { bad++; console.log(`  ${key} seed ${s}: ${e.stack}`); continue; }
      const W = m.w, H = m.h;
      // The map fits the footprint and its margins, and is one of the size classes.
      const [maxW, maxH] = spec.foot === "huge" ? [spec.bw + 12, spec.bh + 16] : [48, 36]; // a huge footprint: the map no bigger than it needs
      if (W < spec.bw + 8 || H < spec.bh + 9 || W > maxW || H > maxH) errs.push(`map ${W}x${H} for a ${spec.bw}x${spec.bh} footprint`);
      const cls = sizeClass(W, H);
      if (spec.foot === "tower" && !["S", "M"].includes(cls)) errs.push(`a tower on a ${cls} map`);
      if ((spec.foot === "large" || spec.foot === "wide") && cls === "S") errs.push(`a ${spec.foot} building on a Small map`);
      if (m.storeys !== n || !m.floors || m.floors.length !== n) errs.push(`${m.floors && m.floors.length} floors for ${n} storeys`);
      if (n > 1 && !(m.stairs.length >= 1 && m.stairs.length <= 2)) errs.push(`${m.stairs.length} stairwells`);
      // Stair runs: at least one, each against a wall (or the outside wall it climbs), its cells right on every floor.
      const runs = m.runs || [];
      const outCells = new Set(runs.filter((r) => r.out).flatMap((r) => [...runSteps(r), ...runLandings(r)]).map(([x, y]) => y * W + x));
      if (n > 1) {
        if (!runs.length || runs.length !== m.stairs.length || !runs.some((r) => !r.single && r.len >= 2)) errs.push(`no stair run (${runs.map((r) => (r.single ? "single" : r.len)).join(",")})`);
        for (const r of runs) {
          if (r.single) continue;
          const steps = runSteps(r), lands = runLandings(r), [tx, ty] = runTop(r);
          if (m.stairs.every(([x, y]) => x !== tx || y !== ty)) errs.push("a run's top step is not a stairwell cell");
          if (r.f0 !== 0 || r.f1 !== n - 1) errs.push(`a run joins floors ${r.f0}–${r.f1}`);
          const want = ["hospital", "school", "offices", "apartments"].includes(key) ? 3 : 2;
          if (r.len > want || r.len < 2) errs.push(`a run of ${r.len} steps in a ${key}`);
          for (let f = r.f0; f <= r.f1; f++) {
            const C = m.floors[f].cells;
            steps.forEach(([x, y], i) => { const c = C[y * W + x]; if (c.k !== "stairs" || c.step !== i + 1 || !!c.top !== (i === r.len - 1) || STAIR_DIRS[c.dir][0] !== r.dx || STAIR_DIRS[c.dir][1] !== r.dy) errs.push(`floor ${f}: run step ${i + 1} at ${x},${y} is ${c.k}`); });
            for (const [x, y] of lands) if (!CELL[C[y * W + x].k].walk || C[y * W + x].k === "stairs") errs.push(`floor ${f}: a landing at ${x},${y} is ${C[y * W + x].k}`);
          }
          // Against a wall: every step has a wall on one side across the run (on the ground floor; the motel's the outside wall).
          const G = m.floors[0].cells, across = r.dx ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
          if (!steps.every(([x, y]) => across.some(([ax, ay]) => ["wall", "window", "smashed"].includes(G[(y + ay) * W + x + ax].k)))) errs.push("a run not against a wall");
        }
        // No step is a door's approach, on any floor.
        for (let f = 0; f < n; f++) {
          const C = m.floors[f].cells;
          for (let i = 0; i < W * H; i++) {
            if (!["idoor", "odoor", "door"].includes(C[i].k)) continue;
            const x = i % W, y = (i / W) | 0;
            if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const c = C[(y + dy) * W + x + dx]; return c && c.k === "stairs" && c.step != null; })) errs.push(`floor ${f}: a door at ${x},${y} opens onto a step`);
          }
        }
      }
      if (n > 1) multi++;
      const B = m.building;
      const inB = (x, y) => x >= B.x0 && x < B.x0 + B.w && y >= B.y0 && y < B.y0 + B.h;
      for (let f = 0; f < m.floors.length; f++) {
        const F = m.floors[f];
        floorsSeen++;
        if (F.cells.length !== W * H) { errs.push(`floor ${f} is not ${W}x${H}`); continue; }
        if (!F.name) errs.push(`floor ${f} has no name`);
        for (const [sx, sy] of m.stairs) if (F.cells[sy * W + sx].k !== "stairs" || (!inB(sx, sy) && !outCells.has(sy * W + sx))) errs.push(`floor ${f}: no stairwell at ${sx},${sy}`);
        if (f > 0) {
          // Void outside the footprint, nothing but void there; every walkable cell reachable from the stairwell; windows, no exits.
          let voidIn = 0, solidOut = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = F.cells[y * W + x].k; if (inB(x, y) && k === "void") voidIn++; if (!inB(x, y) && k !== "void" && !outCells.has(y * W + x)) solidOut++; } // an outside stair (a motel's) stands beside the walls
          if (voidIn || solidOut) errs.push(`floor ${f}: ${voidIn} void cells inside, ${solidOut} cells outside the footprint`);
          const seen = walk(F.cells, W, H, m.stairs[0][0], m.stairs[0][1]);
          let cut = 0;
          for (let i = 0; i < W * H; i++) if ((CELL[F.cells[i].k].walk || F.cells[i].k === "door") && !seen[i]) cut++;
          if (cut) errs.push(`floor ${f}: ${cut} walkable cells cut off from the stairwell`);
          if (F.cells.some((c) => c.k === "smashed" || c.k === "vehicle")) errs.push(`floor ${f}: a smashed window or the vehicle upstairs`);
          const rooms = m.rooms.filter((a) => (a.f || 0) === f);
          if (!rooms.length) errs.push(`floor ${f}: no rooms`);
          // Every room of this floor reachable from a landing (the run's top landing, where the stairs arrive).
          const land = runs.find((r) => !r.single);
          if (land) {
            const [lx, ly] = runLandings(land)[1], fromL = walk(F.cells, W, H, lx, ly);
            const lost = rooms.filter((a) => { for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) if (fromL[y * W + x]) return false; return true; });
            if (lost.length) errs.push(`floor ${f}: ${lost.map((a) => a.name).join(", ")} not reached from the landing`);
          }
          if (!m.containers.some((c) => (c.f || 0) === f)) errs.push(`floor ${f}: nothing to search`);
        } else if (n > 1) {
          // The ground floor's stairwell is reached from the front zone.
          const z = m.zones[0];
          const seen = walk(F.cells, W, H, z.x0 + 1, z.y0 + (s % 2 === 1 ? 0 : 1));
          if (!m.stairs.every(([sx, sy]) => seen[sy * W + sx])) errs.push("the stairwell is cut off from the front");
          if (!(m.runs || []).every((r) => runLandings(r).every(([x, y]) => seen[y * W + x]))) errs.push("a landing is cut off from the front");
          if (!F.cells.some((c) => c.k === "wall" && c.t === 2)) errs.push("ground-floor walls not two storeys tall");
        }
      }
      // Room ids index the areas list; every room and container names its floor; no old-style lofts in a multi-storey building.
      if (m.rooms.some((a, i) => a.id !== i)) errs.push("room ids do not index the areas");
      if (m.containers.some((c) => (m.rooms[c.area].f || 0) !== (c.f || 0))) errs.push("a container on another floor than its room");
      if (n > 1 && m.cells.some((c) => c.k === "loft")) errs.push("a raised loft in a building with real storeys");
      if (key === "barn" && m.rooms.some((a) => a.up) && !m.cells.some((c) => c.k === "loft")) errs.push("the barn lost its hayloft");
      if (errs.length) { bad++; if (bad <= 15) console.log(`  ${key} seed ${s}: ${errs.slice(0, 4).join("; ")}`); }
    }
  }
  check(!bad, `every type assembles with its storeys, footprint class and map size; every floor connected to the stairwell, the stairwell to the front; stair runs against a wall, their steps on every floor, landings walkable, every room reached from a landing, no door onto a step (${bad} bad of ${Object.keys(BUILDINGS).length * SEEDS}; ${multi} multi-storey, ${floorsSeen} floors)`);
  console.log(`    storeys seen: ${Object.entries(storeysBy).map(([k, v]) => `${k} ${[...v].sort().join("/")}`).join(", ")}`);
  // Towers: the taller, the smaller the footprint (forced with the crawl's bonus to see the tall ones).
  for (let s = 0; s < SEEDS * 4; s++) { const spec = BUILDINGS.offices.make(new Rng(9000 + s), { storeyBonus: s % 3 }); towers.push([spec.storeys, spec.bw * spec.bh]); }
  const lowT = towers.filter(([n]) => n <= 4).map(([, a]) => a), highT = towers.filter(([n]) => n >= 7).map(([, a]) => a);
  const avg = (l) => l.reduce((a, v) => a + v, 0) / Math.max(1, l.length);
  check(lowT.length && highT.length && avg(highT) < avg(lowT) * 0.8, `office towers shrink as they grow (3–4 storeys ${avg(lowT).toFixed(0)} cells, 7–8 storeys ${avg(highT).toFixed(0)})`);
  check(towers.every(([n]) => n <= MAX_STOREYS) && towers.some(([n]) => n === MAX_STOREYS), `never more than ${MAX_STOREYS} storeys`);
}

// ======================================================================================
// A raid on a site of one of these types (as interiortest.js raidAt), with everyone's floor and the stairs to hand.
function raidAt(types, opts = {}) {
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: (opts.seed || 300) + i, factionCount: 6 });
    st.cards.length = 0;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && types.includes(t.loc.type) && t.id !== h.tile);
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, opts.crew || 3);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const groups = opts.groups || raidEnemies(st, tile.id);
    // opts.key: the site's building of that kind (a town's house), its option picked before the map.
    const opt = opts.key ? (siteBuildings(tile) || { options: [] }).options.find((o) => o.key === opts.key) : null;
    if (opts.key && !opt) continue;
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "stest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5, ...(opt ? { building: opt.id } : {}) }, context: {} };
    st.combat = createBattle(st, setup);
    if (opts.want && !opts.want(st.combat)) continue;
    return { st, b: st.combat, p, tile, setup, crew };
  }
  return null;
}
const stairsOf = (b) => b.raid.stairs[0];
// Puts a unit on floor f at (x, y), moving whoever stood there off it (tests only).
function place(b, u, f, x, y) {
  for (const o of b.units) if (o !== u && (o.f || 0) === f && o.x === x && o.y === y && !o.dead) { o.x = Math.max(1, o.x - 2); }
  u.x = x; u.y = y; u.f = f; u.away = f !== (b.floor || 0);
}
const turn = (st) => { const b = st.combat; for (const p of b.units) if (p.side === "player") p.ap = 0; endPlayerTurn(st); runEnemyPhase(st); };

console.log("A raid in a building with storeys: floors, the stairs, what is off this floor");
{
  const r = raidAt(["office", "apartments", "hospital"], { want: (b) => b.floors && b.floors.length >= 3 });
  check(!!r, "test setup: a raid in a building of 3+ storeys");
  if (r) {
    const { st, b } = r;
    const R = b.raid;
    check(b.floors.length === R.storeys && b.floor === 0 && b.cells === b.floors[0].cells && b.reach === b.floors[0].reach && b.losCache === b.floors[0].losCache, `${R.interior.name}: ${R.storeys} storeys, the ground floor active, b.cells / reach / losCache alias floors[0]`);
    check(b.units.every((u) => typeof u.f === "number") && R.containers.every((c) => typeof c.f === "number"), "every unit and container has a floor");
    check(b.units.filter((u) => u.side === "player").every((u) => u.f === 0), "the team starts on the ground floor");
    const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie");
    const up = dead.filter((u) => u.f > 0);
    check(dead.length && up.length < dead.length && dead.filter((u) => u.f === 0).length >= dead.length * 0.3, `the dead are spread over the floors, most below (${dead.length - up.length} on the ground, ${up.length} above)`);
    check(R.containers.some((c) => c.f > 0) && R.containers.some((c) => c.f === 0), "containers on the upper floors and the ground");
    check(b.floors.every((F) => F.reach instanceof Uint8Array && F.cells.length === b.w * b.h && F.name), "every floor has its reach, its cells and a name");
    const [sx, sy] = stairsOf(b);
    const u = b.units.find((x) => x.side === "player");
    for (const o of b.units.filter((x) => x.side === "player" && x !== u)) { o.left = true; }
    // Up the stairs: 1 action, the same cell, the view follows; the top floor only down, the ground only up.
    place(b, u, 0, sx, sy);
    u.ap = 2; b.phase = "player";
    const so0 = stairOptions(b, u);
    check(so0.up && !so0.down, "on the ground floor's stairwell the stairs lead up, not down");
    let err = combatAct(st, { type: "godown", unit: u.id });
    check(err !== "" && u.f === 0, `going down from the ground floor is refused ("${err}")`);
    err = combatAct(st, { type: "goup", unit: u.id });
    check(err === "" && u.f === 1 && u.x === sx && u.y === sy && u.ap === 1 && b.floor === 1 && b.cells === b.floors[1].cells && b.losCache === b.floors[1].losCache, `Go up: 1 action, the same cell a floor up, the view follows (floor ${b.floor}, ${err || "ok"})`);
    check(b.fx.at(-1) && b.fx.at(-1).f === 0 && active(u) && !u.away, "fx carry the floor they happened on; the unit is active on its new floor");
    // Occupancy: someone on the stairwell above refuses the climb.
    const blocker = b.units.find((x) => x.side === "enemy" && !x.dead);
    place(b, blocker, 2, sx, sy);
    u.ap = 2;
    check(!stairOptions(b, u).up && stairOptions(b, u).down, "with someone on the stairwell above, only down is open");
    err = combatAct(st, { type: "goup", unit: u.id });
    check(err !== "" && u.f === 1 && u.ap === 2, `the climb up is refused while the cell above is taken ("${err}")`);
    place(b, blocker, 2, sx + 1, sy);
    if (!CELL[b.floors[2].cells[sy * b.w + sx + 1].k].walk) place(b, blocker, 2, sx, sy + 1);
    // A wounded teammate lying on the landing above is no wall: they are moved aside (a raid used to stall on it).
    {
      const hurt = b.units.find((x) => x.side === "player" && x !== u);
      hurt.left = false; hurt.down = true; hurt.stab = true; hurt.hp = 0;
      place(b, hurt, 2, sx, sy);
      check(stairOptions(b, u).up, "a wounded teammate lying on the landing above does not block the stairs");
      hurt.left = true; hurt.down = false; hurt.stab = false; // out of the way again for the rest
    }
    check(stairOptions(b, u).up, "and open again once it is free");
    // Off this floor: a unit a floor below at the same cell is neither seen nor bumped into nor reachable.
    const below = b.units.find((x) => x.side === "enemy" && !x.dead && x !== blocker);
    place(b, below, 0, sx, sy + 1);
    if (!CELL[b.floors[0].cells[(sy + 1) * b.w + sx].k].walk) place(b, below, 0, sx + 1, sy);
    below.aware = true;
    check(!active(below) && activeAny(below) && below.away && !unitAt(b, below.x, below.y) && !playerSees(b, below), "a unit on the floor below is off this floor's map: not active here, not seen, not standing in the way");
    const rch = reachable(b, u, 20);
    let voidReached = 0, outside = 0;
    for (let i = 0; i < b.w * b.h; i++) if (isFinite(rch.dist[i])) { if (b.cells[i].k === "void") voidReached++; const x = i % b.w, y = (i / b.w) | 0; const B = R.plan.building; if (x < B.x0 || x >= B.x0 + B.w || y < B.y0 || y >= B.y0 + B.h) outside++; }
    check(!voidReached && !outside, "movement upstairs never leaves the footprint (no void cell reachable)");
    // Sight: through the windows out over the void, but the ground floor's grid is another floor's.
    b.losCache.fill(0);
    const seesOut = los(b, sx, sy, 0, 0) !== undefined;
    check(seesOut && b.floors[0].cells !== b.cells, "sight is worked out on this floor's grid");
    // Containers: an upper-floor one is searchable only when standing next to it on that floor.
    const box = R.containers.find((c) => c.f === 1 && !c.searched && !(c.lock && !c.lock.open)); // an unlocked one: locks are another check (locks.js)
    check(!!box, "a container on floor 2 to search");
    if (box) {
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [box.x + dx, box.y + dy]).find(([x, y]) => CELL[b.floors[1].cells[y * b.w + x].k].walk);
      place(b, u, 1, side[0], side[1]);
      check(searchableNear(b, u).includes(box) && boxAt(b, box.x, box.y) === box, "next to it on its floor it can be searched");
      place(b, u, 0, side[0], side[1]);
      setFloor(b, 0);
      check(!searchableNear(b, u).includes(box) && boxAt(b, box.x, box.y) !== box, "from the same cell on the ground floor it cannot (another floor)");
      // Richer upstairs: the richness multiplier by floor.
      check(FLOOR_RICH.perFloor === 1.1 && FLOOR_RICH.cap === 1.5, "upper floors are richer: ×1.1 a floor, at most ×1.5");
      setFloor(b, 1);
      place(b, u, 1, side[0], side[1]);
      u.ap = 2;
      turnToBox(u, box); // vision.js: facing it
      err = combatAct(st, { type: "search", unit: u.id, box: box.id });
      // Hauling takes time (raidloot.js HAUL: 8 kg a turn free, then 12 kg an action): a heavy find (firewood is 3 kg
      // each, loot.js AREA_WOOD) may not all come out in the one action left, so come back next turn for the rest.
      const took = !!box.contents && (Object.keys(R.found).length > 0 || R.foundGear.length > 0);
      let turns = 1;
      while (err === "" && !box.searched && turns < 4) { b.turn++; b.phase = "player"; u.ap = 2; turns++; err = combatAct(st, { type: "search", unit: u.id, box: box.id }); }
      // Emptied, or searched with the rest left inside for want of room (one person's pack: food by type and firewood
      // weigh what they do, so a full cabinet seldom fits; combat.js searchBox "No room for the rest").
      check(err === "" && took && (box.searched || box.partial), `searching it upstairs works (${err || "ok"}, ${box.searched ? `emptied in ${turns} turn${turns === 1 ? "" : "s"}` : `${turns} turns, the rest left inside for want of room`})`);
    }
    // No extraction upstairs.
    const z = R.zones[0];
    b.phase = "player"; b.queue = []; // the search may have ended the turn
    setFloor(b, 1);
    place(b, u, 1, z.x0 + 1, z.y0 + 1);
    u.ap = 2;
    err = combatAct(st, { type: "extract", unit: u.id });
    check(/ground floor/.test(err) && !u.left, `no extraction from an upper floor ("${err}")`);
    check(zoneAt(b, z.x0 + 1, z.y0 + 1) === 0 && b.cells[(z.y0 + 1) * b.w + z.x0 + 1].k === "void", "the zone's cells are open air upstairs");
    // Down again (the dead pay more: HEIGHT.CLIMB_DEAD AP on arrival).
    place(b, u, 1, sx, sy);
    u.ap = 2;
    err = combatAct(st, { type: "godown", unit: u.id });
    check(err === "" && u.f === 0 && b.floor === 0 && u.ap === 1, `Go down: back on the ground floor (${err || "ok"})`);
    check(HEIGHT.CLIMB_DEAD === 2, "the dead's climb costs CLIMB_DEAD");
  }
}

console.log("The enemy phase floor by floor, the drift to the stairs");
{
  const r = raidAt(["office", "apartments", "hospital"], { groups: [], want: (b) => b.floors && b.floors.length >= 3 });
  check(!!r, "test setup: an empty building of 3+ storeys");
  if (r) {
    const { st, b } = r;
    b.raid.spawnCap = 0;
    const [sx, sy] = stairsOf(b);
    const me = b.units.filter((x) => x.side === "player");
    const u = me[0];
    for (const o of me.slice(1)) o.left = true;
    u.hp = u.maxHp = 9999;
    const W = b.w;
    const openOn = (f, near, d0 = 2) => { const F = b.floors[f]; for (let d = d0; d < 12; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) { const x = near[0] + dx, y = near[1] + dy; if (x > 0 && y > 0 && x < W - 1 && y < b.h - 1 && F.cells[y * W + x].k === "open") return [x, y]; } return null; };
    // A player on floor 2 (index 1) with an aware zombie 4+ tiles off on the same floor: the AI runs there, and the view comes back.
    const cellU = openOn(1, [sx, sy], 3); // off the landings: the dead hunting them must not stand on the stairwell
    place(b, u, 1, cellU[0], cellU[1]);
    setFloor(b, 1);
    const zc = openOn(1, cellU, 4) || openOn(1, [sx, sy], 5);
    const z1 = enemyUnit(b, st.rng, "zombies", 2, 1); z1.aware = true; z1.pod = 50; place(b, z1, 1, zc[0], zc[1]); b.units.push(z1);
    // An aware zombie alone on the ground floor: it drifts to the stairs and comes up next turn.
    const g0 = openOn(0, [sx, sy], 3);
    const z0 = enemyUnit(b, st.rng, "zombies", 2, 2); z0.aware = true; z0.pod = 51; place(b, z0, 0, g0[0], g0[1]); b.units.push(z0);
    // An unaware one on the top floor stays put.
    const g2 = openOn(2, [sx, sy], 3);
    const z2 = enemyUnit(b, st.rng, "zombies", 2, 3); z2.aware = false; z2.pod = 52; place(b, z2, 2, g2[0], g2[1]); b.units.push(z2);
    setFloor(b, 1);
    // The walking distance too (the cell found may be in the next room: a hospital's office beside a ward, #14).
    const walk = (x0, y0) => { const F = b.floors[1].cells, D = new Int32Array(W * b.h).fill(-1), q = [y0 * W + x0]; D[q[0]] = 0; for (let k = 0; k < q.length; k++) { const i = q[k], x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (y + dy) * W + x + dx; if (x + dx >= 0 && x + dx < W && D[j] < 0 && CELL[F[j].k] && CELL[F[j].k].walk) { D[j] = D[i] + 1; q.push(j); } } } return D; };
    const D = walk(u.x, u.y), p0 = D[z1.y * W + z1.x];
    const d0 = Math.hypot(z1.x - u.x, z1.y - u.y);
    b.phase = "player";
    turn(st);
    const d1 = Math.hypot(z1.x - u.x, z1.y - u.y), p1 = D[z1.y * W + z1.x];
    check(d1 < d0 || (p0 > 0 && p1 >= 0 && p1 < p0) || z1.ap === 0 && b.log.some((l) => /Zombie 1/.test(l.text)), `the dead on the player's floor act (distance ${d0.toFixed(1)} → ${d1.toFixed(1)}, walking ${p0} → ${p1})`);
    check(b.floor === 1 && b.cells === b.floors[1].cells && !u.away, "after the enemy phase the view is back on the player's floor");
    check(!!z0.drift && z0.drift.to === 1 && z0.drift.x === sx && z0.drift.y === sy, `the aware one alone downstairs is sent to the stairwell toward the player's floor (${JSON.stringify(z0.drift)})`);
    check(z2.f === 2 && !z2.drift && !z2.aware && Math.hypot(z2.x - g2[0], z2.y - g2[1]) <= 4.5, "an unaware one on another floor stays on its floor, unaware (a shuffle at most)");
    turn(st);
    check(z0.f === 1 && z0.x === sx && z0.y === sy && !z0.drift, `next turn it arrives on the stairwell of the player's floor (floor ${z0.f} at ${z0.x},${z0.y})`);
    check(b.log.some((l) => /comes up the stairs/.test(l.text)), "and the log says so");
    check(typeof b.raid.heat === "number", "Heat stays one number for the building");
    // The stairwell taken: the next drifter waits.
    const z3 = enemyUnit(b, st.rng, "zombies", 2, 4); z3.aware = true; z3.pod = 53; place(b, z3, 0, g0[0], g0[1]); b.units.push(z3);
    place(b, z0, 1, sx, sy); z0.ap = 0;
    turn(st);
    const marked = !!z3.drift;
    turn(st);
    check(marked && (z3.f === 0 ? z0.x === sx && z0.y === sy && z0.f === 1 : z3.x === sx && z3.y === sy), `a drifter waits while the stairwell above is taken (floor ${z3.f}), or steps off once it is free`);
    void active;
  }
}

console.log("The city crawl: taller deeper in, the card's count, a building left upstairs");
{
  check(CC.storeyBonus(1) === 0 && CC.storeyBonus(3) === 0 && CC.storeyBonus(4) === 1 && CC.storeyBonus(6) === 1 && CC.storeyBonus(7) === 2 && CC.storeyBonus(8) === 2, "block depth: +1 storey at block 4+, +2 at block 7+");
  const state = createWorld({ seed: 31, factionCount: 7 });
  const h = hub(state);
  const city = state.tiles.find((t) => t.loc && t.loc.type === "city");
  const crew = atBase(state, h.id).slice(0, 3).map((x) => x.id);
  for (const k of ["food", "water", "ammo", "meds"]) h.stock[k] = 200;
  const res = launchExpedition(state, { memberIds: crew, dest: city.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60, meds: 3 } });
  const p = res.party;
  p.path = [city.id]; p.idx = 0; p.dest = city.id; p.phase = "engaged";
  CC.startCrawl(state, p);
  const c = p.crawl;
  const office = { id: "t-o", slot: 9, key: "offices", name: "Office building on Test Street", kind: "Office building", dead: 1, rich: 1, raiders: false, looted: 0, blocked: null, quick: false };
  const s1 = CC.placeStoreys(state, c, office, 1), s4 = CC.placeStoreys(state, c, office, 4), s7 = CC.placeStoreys(state, c, office, 7);
  check(s4 >= s1 && s7 >= s4 && s7 <= MAX_STOREYS && s7 >= 5, `the same office tower has more storeys deeper in (block 1: ${s1}, block 4: ${s4}, block 7: ${s7})`);
  let maxSeen = 0;
  for (let i = 0; i < 30; i++) maxSeen = Math.max(maxSeen, CC.placeStoreys(state, c, { ...office, slot: 20 + i }, 8));
  check(maxSeen <= MAX_STOREYS, `never more than ${MAX_STOREYS} (deepest block, 30 towers: at most ${maxSeen})`);
  check(buildingSpec(state, c.tile, CC.placeOption(c, office, 7)).storeys === s7, "the card's count is the building's own dice");
  // Enter an apartment block deep in (block 7, or the deepest this city's round grid has): the raid's storeys match the card.
  const deep = [7, 6, 5, 4].find((n) => CC.jumpToLevel(state, c, n));
  check(deep >= 4, `test setup: a block 4+ deep (${deep})`);
  const blk = CC.blockOf(c);
  const flats = { ...office, id: "t-a", slot: 8, key: "apartments", name: "Apartment block on Test Street", kind: "Apartment block" };
  blk.places = [flats];
  const want = CC.placeStoreys(state, c, flats);
  const err = CC.enterPlace(state, p, flats.id, { map: true });
  const b = state.combat;
  check(!err && b && b.raid.storeys === want && b.floors.length === want && want >= 4, `entering it opens a raid with the card's ${want} storeys (${err || "ok"})`);
  // Leave something searched upstairs, go back out, come back: as it was left.
  const [sx, sy] = stairsOf(b);
  const u = b.units.find((x) => x.side === "player");
  const box = b.raid.containers.find((x) => x.f === 1);
  box.searched = true;
  place(b, u, 1, sx, sy);
  setFloor(b, 1);
  const up1 = b.units.find((x) => x.side === "enemy" && x.f > 0 && !x.dead);
  const upCount = b.units.filter((x) => x.side === "enemy" && x.f > 0 && !x.dead).length;
  u.ap = 2; b.phase = "player";
  const down = combatAct(state, { type: "godown", unit: u.id });
  check(down === "" && u.f === 0, `Go down from floor 2 in the crawl's building (${down || "ok"})`);
  setFloor(b, 0);
  const z = b.raid.zones[0];
  for (const o of b.units.filter((x) => x.side === "player" && !x.dead && !x.left)) { o.x = z.x0 + 1; o.y = z.y0 + 1; o.ap = 2; combatAct(state, { type: "extract", unit: o.id }); }
  check(b.over && b.result.outcome === "extracted", "the team walks out from the ground floor");
  finishCombat(state, b.setup, b.result);
  const snap = c.buildings[flats.id];
  check(snap && snap.floors && snap.floors.length === want, `the building is kept with all its ${want} floors`);
  CC.enterPlace(state, p, flats.id, { map: true });
  const b2 = state.combat;
  check(b2 && b2.floors.length === want && b2.floor === 0 && b2.cells === b2.floors[0].cells, "going back in restores every floor, the ground floor active");
  check(b2.raid.containers.some((x) => x.id === box.id && x.f === 1 && x.searched), "what was searched upstairs stays searched");
  check(b2.units.filter((x) => x.side === "enemy" && x.f > 0 && !x.dead).length === upCount && (!up1 || b2.units.some((x) => x.f === up1.f && x.x === up1.x && x.y === up1.y)), "the dead upstairs are where they were");
  check(b2.units.every((x) => x.side !== "player" || (x.f === 0 && !x.away)), "the team comes in on the ground floor");
  for (const o of b2.units.filter((x) => x.side === "player" && !x.dead && !x.left)) { o.x = z.x0 + 1; o.y = z.y0 + 1; o.ap = 2; combatAct(state, { type: "extract", unit: o.id }); }
  finishCombat(state, b2.setup, b2.result);
}

console.log("Footprint shapes: parts with fewer storeys (issue #23)");
{
  // A shape's part with fewer storeys than its building (a school's gym, a hospital's ER, a garage) is open air on the
  // floors above it, its walls one storey high unless it is a tall one; every floor up is reached from its stairs; every
  // stair run stands in a part with every storey.
  let n = 0, lowParts = 0, bad = [];
  for (const key of ["school", "hospital", "police", "firestation", "motel", "house", "farmhouse", "offices", "apartments", "corner"]) for (let s = 0; s < Math.max(10, SEEDS * 3); s++) {
    const rng = new Rng(61000 + s * 7919), spec = BUILDINGS[key].make(rng, { shapes: true });
    if (!spec.shape || spec.storeys < 2) continue;
    const m = assemble(rng, spec, { key, name: key });
    n++;
    const P = m.building.parts, inside = (p, x, y) => x > p.x0 && y > p.y0 && x < p.x0 + p.w - 1 && y < p.y0 + p.h - 1, only = (p, x, y) => P.every((q) => q === p || !(x >= q.x0 && y >= q.y0 && x < q.x0 + q.w && y < q.y0 + q.h));
    for (const p of P) {
      if (p.storeys >= m.storeys) continue;
      lowParts++;
      for (let f = p.storeys; f < m.storeys; f++) for (let y = p.y0; y < p.y0 + p.h; y++) for (let x = p.x0; x < p.x0 + p.w; x++) if (only(p, x, y) && m.floors[f].cells[y * m.w + x].k !== "void") { bad.push(`${key} #${s} ${p.name} floor ${f}`); y = Infinity; break; }
      for (let y = p.y0; y < p.y0 + p.h; y++) for (let x = p.x0; x < p.x0 + p.w; x++) { const c = m.cells[y * m.w + x]; if (only(p, x, y) && c.t === 2 && p.storeys === 1 && !p.tall) { bad.push(`${key} #${s} ${p.name}: two-storey walls`); y = Infinity; break; } }
    }
    for (const r of m.runs || []) for (const [x, y] of [...runSteps(r), ...runLandings(r)]) if (!P.some((p) => p.storeys >= m.storeys && inside(p, x, y))) bad.push(`${key} #${s}: a run outside a full part`);
    for (let f = 1; f < m.storeys; f++) {
      const F = m.floors[f].cells, [sx, sy] = m.stairs[0], seen = walk(F, m.w, m.h, sx, sy);
      for (let i = 0; i < m.w * m.h; i++) if (CELL[F[i].k] && CELL[F[i].k].walk && !seen[i]) { bad.push(`${key} #${s} floor ${f} unreachable`); break; }
    }
  }
  check(!bad.length && lowParts > 0, `${n} shaped buildings with storeys, ${lowParts} lower parts: open air above, a one-storey part's walls one storey high (a gym's tall), every floor up reached from its stairs, the runs in a part with every storey${bad.length ? `: ${bad.slice(0, 4).join("; ")}` : ""}`);
  // The city crawl: a shaped school kept as it was left (every floor, its parts' cells) and given back.
  const state = createWorld({ seed: 33, factionCount: 7 });
  const h = hub(state), city = state.tiles.find((t) => t.loc && t.loc.type === "city");
  for (const k of ["food", "water", "ammo", "meds"]) h.stock[k] = 200;
  const res = launchExpedition(state, { memberIds: atBase(state, h.id).slice(0, 3).map((x) => x.id), dest: city.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60, meds: 3 } });
  const p = res.party;
  p.path = [city.id]; p.idx = 0; p.dest = city.id; p.phase = "engaged";
  CC.startCrawl(state, p);
  const c = p.crawl, blk = CC.blockOf(c);
  const school = { id: "t-s", slot: 4, key: "school", name: "School on Test Street", kind: "School", dead: 1, rich: 1, raiders: false, looted: 0, blocked: null, quick: false };
  blk.places = [school];
  const err = CC.enterPlace(state, p, school.id, { map: true });
  const b = state.combat;
  const shapeOf = (bb) => JSON.stringify(bb.raid.plan.building.parts);
  check(!err && b && b.raid.plan.building.parts && b.raid.plan.building.parts.length >= 4, `a crawl's school is shaped (${b && b.raid.plan.building.shape}, ${b && b.w} × ${b && b.h}, ${b && b.floors ? b.floors.length : 1} floors)`);
  const box = b.raid.containers.find((x) => (x.f || 0) === 0);
  box.searched = true;
  const lowCell = (() => { const P = b.raid.plan.building.parts.find((q) => q.storeys < b.floors.length); return P ? [P.x0 + 1, P.y0 + 1] : null; })();
  const z = b.raid.zones[0];
  for (const o of b.units.filter((x) => x.side === "player" && !x.dead && !x.left)) { o.x = z.x0 + 1; o.y = z.y0 + 1; o.f = 0; o.ap = 2; combatAct(state, { type: "extract", unit: o.id }); }
  finishCombat(state, b.setup, b.result);
  const snap = c.buildings[school.id];
  check(snap && snap.floors && snap.floors.length === b.floors.length, `the school is kept with its ${b.floors.length} floors`);
  CC.enterPlace(state, p, school.id, { map: true });
  const b2 = state.combat;
  check(b2 && shapeOf(b2) === shapeOf(b) && b2.floors.every((F, f) => F.cells.map((q) => q.k).join() === snap.floors[f].cells.map((q) => q.k).join()) && b2.raid.containers.some((x) => x.id === box.id && x.searched)
    && (!lowCell || b2.floors[b2.floors.length - 1].cells[lowCell[1] * b2.w + lowCell[0]].k === "void"), "going back in gives it back as it was left: its parts, every floor's cells (a lower part open air above), what was searched");
  for (const o of b2.units.filter((x) => x.side === "player" && !x.dead && !x.left)) { o.x = z.x0 + 1; o.y = z.y0 + 1; o.f = 0; o.ap = 2; combatAct(state, { type: "extract", unit: o.id }); }
  finishCombat(state, b2.setup, b2.result);
}

console.log("Saved and loaded mid-raid on floor 3");
{
  const r = raidAt(["office", "apartments", "hospital"], { seed: 700, want: (b) => b.floors && b.floors.length >= 3 });
  check(!!r, "test setup: a 3+ storey raid");
  if (r) {
    const { st, b } = r;
    const [sx, sy] = stairsOf(b);
    const u = b.units.find((x) => x.side === "player");
    place(b, u, 2, sx, sy);
    setFloor(b, 2);
    autoPlayerTurn(st); runEnemyPhase(st);
    const saved = serializeState(st);
    const st2 = deserializeState(JSON.parse(JSON.stringify(saved)));
    const b2 = st2.combat;
    check(b2.floors.length === b.floors.length && b2.floor === b.floor && b2.cells === b2.floors[b2.floor].cells && b2.reach === b2.floors[b2.floor].reach && b2.losCache === b2.floors[b2.floor].losCache, `loaded: ${b2.floors.length} floors, floor ${b2.floor} active, the aliases point into floors[${b2.floor}]`);
    check(b2.losCache instanceof Int8Array && b2.floors.every((F) => F.reach instanceof Uint8Array && (F.losCache == null || F.losCache instanceof Int8Array)), "typed arrays round-trip on every floor");
    check(b2.units.every((o) => o.away === ((o.f || 0) !== b2.floor)), "the away flags match the active floor after loading");
    check(b2.floors.every((F, f) => F.cells.length === b2.w * b2.h && F.cells.every((cl, i) => cl.k === b.floors[f].cells[i].k)), "every floor's cells are the same as before");
    check(b2.raid.stairs.length === b.raid.stairs.length && b2.raid.storeys === b.raid.storeys, "the stairwells and the storey count");
    let g = 0, crash = null;
    try { while (!b2.over && g++ < 200) { autoPlayerTurn(st2); runEnemyPhase(st2); } } catch (e) { crash = e; console.log(e.stack); }
    check(!crash && b2.over, `plays on to the end after loading (${b2.result && b2.result.outcome}, ${g} turns)`);
  }
}

console.log("Stair runs: up from the top step, the landings, a save from before the runs");
{
  for (const [types, label] of [[["hospital"], "hospital"], [["house", "town"], "house"]]) {
    const r = raidAt(types, { seed: 640, key: label, want: (b) => b.floors && b.floors.length >= 2 && b.raid.runs && b.raid.runs.some((q) => !q.single) });
    check(!!r, `test setup: a raid in a ${label} with a stair run`);
    if (!r) continue;
    const { st, b } = r;
    const R = b.raid, run = R.runs.find((q) => !q.single);
    const steps = runSteps(run), [lo, hi] = runLandings(run), [tx, ty] = runTop(run);
    // The dead waiting upstairs by the stairwell start on the landings, not on the steps (looked at before anyone moves).
    const onSteps = b.units.filter((o) => o.side === "enemy" && (o.f || 0) > 0 && !o.dead && R.runs.some((q) => runSteps(q).some(([x, y]) => o.x === x && o.y === y)));
    check(!onSteps.length, `${label}: none of the dead upstairs start on a step (${onSteps.length})`);
    const u = b.units.find((x) => x.side === "player");
    for (const o of b.units) if (o !== u && !o.dead && [[lo[0], lo[1]], ...steps, hi].some(([x, y]) => o.x === x && o.y === y)) { o.x = 1; o.y = 1; }
    // On the bottom step the stairs do not change floor yet: the floor changes at the top step.
    place(b, u, 0, steps[0][0], steps[0][1]);
    setFloor(b, 0);
    u.ap = 2; b.phase = "player";
    let err = combatAct(st, { type: "goup", unit: u.id });
    check(err !== "" && /top step/.test(err) && u.f === 0 && u.ap === 2, `${label}: on the bottom step Go up is refused ("${err}")`);
    check(!stairOptions(b, u).up, `${label}: no stair options off the top step`);
    // Walked up the run from the bottom landing: along the steps to the top one (a move), then Go up.
    place(b, u, 0, lo[0], lo[1]);
    const res = combatAct(st, { type: "move", unit: u.id, x: tx, y: ty });
    check(res === "" && u.x === tx && u.y === ty, `${label}: walks the run from the bottom landing to the top step (${res || "ok"})`);
    u.ap = 2;
    err = combatAct(st, { type: "goup", unit: u.id });
    check(err === "" && u.f === 1 && u.x === tx && u.y === ty && b.floor === 1, `${label}: Go up from the top step: a floor up, the same cell (${err || "ok"})`);
    const upHi = b.floors[1].cells[hi[1] * b.w + hi[0]];
    check(CELL[upHi.k].walk && upHi.landing && Math.abs(hi[0] - u.x) + Math.abs(hi[1] - u.y) === 1, `${label}: the upper landing is next to it, walkable (${upHi.k})`);
    const step = combatAct(st, { type: "move", unit: u.id, x: hi[0], y: hi[1] });
    check(step === "" && u.x === hi[0] && u.y === hi[1] && u.f === 1, `${label}: steps off onto the upper landing (${step || "ok"})`);
    check(/flight of \d steps|outside stair/.test(b.log.map((l) => l.text).join(" ")), `${label}: the opening lines say where the stairs are`);
  }
  // A save from before the runs: one-cell stairwells (no c.step), no b.raid.runs. It loads, any stairs cell changes floor, it plays on.
  const r = raidAt(["office", "apartments"], { seed: 720, want: (b) => b.floors && b.floors.length >= 3 });
  check(!!r, "test setup: a raid to turn into an older save");
  if (r) {
    const { st, b } = r;
    const R = b.raid;
    for (const F of b.floors) for (const run of R.runs) {
      for (const [x, y] of [...runSteps(run), ...runLandings(run)]) { const c = F.cells[y * b.w + x]; if (c.k === "stairs") c.k = "open"; delete c.step; delete c.top; delete c.dir; delete c.len; delete c.landing; }
      const [x, y] = runTop(run);
      F.cells[y * b.w + x].k = "stairs";
    }
    delete R.runs;
    const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
    const b2 = st2.combat, [sx, sy] = b2.raid.stairs[0];
    const u = b2.units.find((x) => x.side === "player");
    place(b2, u, 0, sx, sy); setFloor(b2, 0);
    u.ap = 2; b2.phase = "player";
    const err = combatAct(st2, { type: "goup", unit: u.id });
    check(!b2.raid.runs && err === "" && u.f === 1, `an older save (one-cell stairwells) loads and its stairwell takes you up (${err || "ok"})`);
    let g = 0, crash = null;
    try { while (!b2.over && g++ < 200) { autoPlayerTurn(st2); runEnemyPhase(st2); } } catch (e) { crash = e; console.log(e.stack); }
    check(!crash && b2.over, `and plays on to the end (${b2.result && b2.result.outcome}, ${g} turns)`);
  }
  // A building's kept snapshot from before the runs (citycrawl.js snapshotBuilding: no stairs, one-cell stairwells in
  // its cells) restored into a battle of today's runs: its own stairwells come back with it.
  const r2 = raidAt(["office", "apartments"], { seed: 760, want: (b) => b.floors && b.floors.length >= 3 });
  if (r2) {
    const { st, b } = r2;
    const snap = CC.snapshotBuilding(b);
    delete snap.stairs; delete snap.runs;
    const old = [];
    for (const F of snap.floors) F.cells.forEach((c, i) => { if (c.k === "stairs") { c.k = "open"; } delete c.step; delete c.top; delete c.dir; delete c.landing; });
    const room = b.raid.areas.find((a) => !a.outdoor && (a.f || 0) === 0 && a.entry);
    const cx = room.x0 + Math.floor(room.w / 2), cy = room.y0 + Math.floor(room.h / 2);
    for (const F of snap.floors) F.cells[cy * b.w + cx].k = "stairs";
    old.push([cx, cy]);
    const ok = CC.restoreBuilding(st, b, snap);
    check(ok && b.raid.stairs.length === 1 && b.raid.stairs[0][0] === cx && b.raid.stairs[0][1] === cy && !(b.raid.runs || []).length, `an older building snapshot restores its own one-cell stairwell (${JSON.stringify(b.raid.stairs)})`);
    const u = b.units.find((x) => x.side === "player");
    place(b, u, 0, cx, cy); setFloor(b, 0); u.ap = 2; b.phase = "player";
    check(stairOptions(b, u).up, "and it takes you up");
  }
}

console.log("The bot in multi-storey buildings");
{
  let raids = 0, out = 0, climbed = 0, crashes = 0, timeouts = 0, upSearched = 0;
  for (let i = 0; i < Math.max(6, SEEDS * 2); i++) {
    let r;
    try { r = raidAt([["office"], ["apartments"], ["hospital"]][i % 3], { seed: 1000 + i * 17, want: (b) => b.floors && b.floors.length >= 2 }); } catch (e) { crashes++; console.log(e.stack); continue; }
    if (!r) continue;
    const { st } = r;
    // Every other raid the ground floor is already picked clean: the bot has to go upstairs for anything.
    if (i % 2 === 1) for (const c of st.combat.raid.containers) if (!c.f) c.searched = true;
    try {
      let g = 0, wentUp = false;
      // A climb: the log line, looked for every turn (b.log keeps only its last 80 lines), or one of the team upstairs.
      const upNow = () => st.combat.log.some((l) => /goes up the stairs/.test(l.text)) || st.combat.units.some((x) => x.side === "player" && (x.f || 0) > 0 && !x.dead);
      while (!st.combat.over && g++ < 200) { autoPlayerTurn(st); if (upNow()) wentUp = true; runEnemyPhase(st); }
      const b = st.combat;
      if (!b.over) { timeouts++; continue; }
      raids++;
      if (b.result.outcome === "extracted") out++;
      if (wentUp) climbed++;
      upSearched += b.raid.containers.filter((c) => c.f > 0 && c.searched).length;
      check(b.units.filter((x) => x.side === "player" && x.left).every((x) => x.f === 0), `whoever extracted did so from the ground floor (${b.raid.interior.name})`);
    } catch (e) { crashes++; if (crashes < 3) console.log(e.stack); }
  }
  check(raids > 0 && !crashes && !timeouts, `${raids} multi-storey raids played to the end (${crashes} crashes, ${timeouts} timeouts)`);
  check(climbed > 0, `the bot took the stairs up in ${climbed} of them and searched ${upSearched} containers upstairs; ${out} got out`);
}

console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(fails ? 1 : 0);
