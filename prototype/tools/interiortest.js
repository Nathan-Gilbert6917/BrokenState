// Building interiors (src/sim/buildingmaps.js): every archetype's map, the sites that use them, and raids played on them.
//   - every archetype generates for several seeds; map sizes are sane; every room is reachable from the front (locked
//     doors counted as ways through), heights only change on stairs or a ladder; every exit's zone is on the map edge
//     and reachable; containers can be reached; locked rooms and containers are there where the archetype puts them;
//   - every location type in combat.js AREA_SETS has buildings, or is one of the outdoor sites that keep the street map;
//   - the same site gives the same layout; a single-building site opens straight into its interior, a site with several
//     offers the choice (and the AI picks one); the occupants hook is called and its groups are placed;
//   - doors open as people walk through (sight changes), roller doors are loud, windows can be climbed (loud);
//   - a headless raid on interiors plays to the end, mostly to extraction.
// Usage: node tools/interiortest.js [seeds per archetype] [raids]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import {
  createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler, combatAct, CELL, AREAS, AREA_SETS, los, active, registerOccupantSide, occupantSide, chooseBuilding,
  playerVision, playerSees, enemyUnit, endPlayerTurn, survivorById,
} from "../src/sim/combat.js";
import { noiseAt } from "../src/sim/stealth.js";
import { newItem, stow } from "../src/sim/inventory.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { BUILDINGS, SITES, assemble, siteBuildings, buildingMap, buildingOptions, placeOccupantGroups, windowsNear, BMAP } from "../src/sim/buildingmaps.js";
import { Rng } from "../src/sim/rng.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const SEEDS = Number(process.argv[2] || 6);
const RAIDS = Number(process.argv[3] || 12);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();
registerCombatHandler("itest", () => {});

// Walking over a map: 4-way steps; heights only change on stairs or a ladder (as combat.js climbCost); locked doors
// count as passable when lockedOk.
function walkFrom(m, sx, sy, lockedOk = true) {
  const W = m.w, H = m.h, seen = new Uint8Array(W * H);
  const pass = (c) => CELL[c.k].walk || (lockedOk && c.k === "door");
  const hOf = (c) => c.h ?? CELL[c.k].h ?? 0;
  const climb = (c) => !!CELL[c.k].climb;
  const q = [sy * W + sx];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0, c = m.cells[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx, d = m.cells[j];
      if (seen[j] || !pass(d)) continue;
      if (hOf(c) !== hOf(d) && !climb(c) && !climb(d) && c.k !== "door" && d.k !== "door") continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}

// ======================================================================================
console.log(`Every archetype (${Object.keys(BUILDINGS).length}), ${SEEDS} seeds each`);
{
  const sizes = {}, exitsBy = {}, locksBy = {};
  let bad = 0;
  for (const key of Object.keys(BUILDINGS)) {
    sizes[key] = []; exitsBy[key] = []; locksBy[key] = { rooms: 0, boxes: 0, exits: 0 };
    for (let s = 0; s < SEEDS; s++) {
      let m;
      try {
        const rng = new Rng(1000 + s * 7919 + key.length * 31);
        m = assemble(rng, BUILDINGS[key].make(rng), { key, name: BUILDINGS[key].name, withVehicle: s % 2 === 1 });
      } catch (e) { bad++; console.log(`  ${key} seed ${s}: ${e.stack}`); continue; }
      const W = m.w, H = m.h;
      sizes[key].push(`${W}x${H}`);
      const errs = [];
      if (W < 14 || H < 14 || W > 44 || H > 34) errs.push(`size ${W}x${H}`);
      const z0 = m.zones[0];
      const start = [z0.x0 + 1, z0.y0 + (s % 2 === 1 ? 0 : 1)];
      if (!CELL[m.cells[start[1] * W + start[0]].k].walk) errs.push("the front zone is blocked");
      const reach = walkFrom(m, start[0], start[1], true);
      // Rooms reachable from the front.
      for (const r of m.rooms.filter((a) => !a.outdoor)) {
        let any = false;
        for (let y = r.y0 + 1; y < r.y0 + r.h - 1 && !any; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (reach[y * W + x]) { any = true; break; }
        if (!any) errs.push(`room ${r.name} unreachable`);
      }
      // Every walkable cell reachable (no pockets).
      let pockets = 0;
      for (let i = 0; i < W * H; i++) if ((CELL[m.cells[i].k].walk || m.cells[i].k === "door") && !reach[i]) pockets++;
      if (pockets) errs.push(`${pockets} walkable cells cut off`);
      // Zones on the edge, reachable, not overlapping; the front zone at the bottom edge.
      if (z0.y0 + z0.h !== H) errs.push("the front zone is not on the front edge");
      for (const z of m.zones) {
        if (!(z.x0 === 0 || z.y0 === 0 || z.x0 + z.w === W || z.y0 + z.h === H)) errs.push(`zone ${z.name} not on an edge`);
        let ok = false;
        for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) if (reach[y * W + x]) ok = true;
        if (!ok) errs.push(`zone ${z.name} unreachable`);
      }
      // Each exit's door opens to the outside next to its zone side.
      for (const e of m.exits) {
        const c = m.cells[e.y * W + e.x];
        if (!["idoor", "door", "odoor"].includes(c.k)) errs.push(`exit ${e.name} is ${c.k}`);
      }
      exitsBy[key].push(m.exits.filter((e) => e.zone >= 0).map((e) => `${e.side}${e.locked ? "(L)" : ""}`).join("+") || "front only");
      // Containers: on a box cell, with a walkable cell next to them reached from the front (locked doors passable).
      for (const c of m.containers) {
        const k = m.cells[c.y * W + c.x].k;
        if (CELL[k].walk) errs.push(`container ${c.label} on walkable ${k}`);
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => { const x = c.x + dx, y = c.y + dy; return x >= 0 && y >= 0 && x < W && y < H && CELL[m.cells[y * W + x].k].walk && reach[y * W + x]; });
        if (!near) errs.push(`container ${c.label} unreachable`);
        const area = m.rooms[c.area];
        if (!area || !AREAS[area.type]) errs.push(`container ${c.label} in an area with no loot type`);
      }
      // Locks: every locked room's doors are locked door cells, its containers flagged.
      for (const r of m.rooms.filter((a) => a.locked)) {
        locksBy[key].rooms++;
        const ds = m.lockedDoors.filter((d) => d.area === r.id);
        if (!ds.length || !ds.every((d) => m.cells[d.y * W + d.x].k === "door")) errs.push(`locked room ${r.name} without locked doors`);
        if (m.containers.some((c) => c.area === r.id && !c.room)) errs.push(`a container in locked ${r.name} not flagged`);
        // With its doors shut, nothing inside is reachable from the front.
        const shut = walkFrom(m, start[0], start[1], false);
        for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (shut[y * W + x]) { errs.push(`locked ${r.name} reachable with its doors shut`); y = 1e9; break; }
      }
      locksBy[key].boxes += m.containers.filter((c) => c.lockKind).length;
      locksBy[key].exits += m.exits.filter((e) => e.locked).length;
      // Upper floors: walls two storeys tall, loft cells raised.
      if (m.plan.tall && !m.cells.some((c) => c.k === "loft" && c.h === 1)) errs.push("tall but no upper floor");
      if (m.rooms.some((a) => a.up) && !m.cells.some((c) => c.k === "stairs" || c.k === "ladder")) errs.push("an upper floor with no stairs");
      if (errs.length) { bad++; if (bad <= 12) console.log(`  ${key} seed ${s}: ${errs.slice(0, 4).join("; ")}`); }
    }
  }
  check(!bad, `every archetype generates, rooms and containers reachable, exits on the edges (${bad} bad maps)`);
  for (const key of Object.keys(BUILDINGS)) console.log(`    ${key.padEnd(12)} ${sizes[key].slice(0, 3).join(" ")}  exits: ${[...new Set(exitsBy[key])].slice(0, 3).join(" | ")}  locks/${SEEDS}: rooms ${locksBy[key].rooms}, boxes ${locksBy[key].boxes}, exits ${locksBy[key].exits}`);
  check(locksBy.police.rooms >= SEEDS && locksBy.gunstore.rooms >= Math.ceil(SEEDS / 2) && locksBy.pharmacy.rooms >= 1, `locked rooms where they belong: police ${locksBy.police.rooms}, gun store ${locksBy.gunstore.rooms}, pharmacy ${locksBy.pharmacy.rooms} in ${SEEDS} maps`);
  check(locksBy.gunstore.boxes > 0 && locksBy.police.boxes > 0 && locksBy.armorybldg.boxes > 0, "locked containers in gun cages, armories and evidence rooms");
}

console.log("Which sites use which buildings");
{
  const outdoor = ["campground", "crashsite", "crash_mil", "crash_cargo", "crash_med", "crash_news", "airdrop", "water"];
  const missing = Object.keys(AREA_SETS).filter((t) => !SITES[t] && !outdoor.includes(t));
  check(!missing.length, `every location type in AREA_SETS has buildings or keeps the street map (${missing.join(", ") || "all covered"})`);
  const bad = Object.values(SITES).flatMap((e) => (Array.isArray(e) ? e : e.list)).map((e) => (Array.isArray(e) ? e[0] : e)).filter((k) => !BUILDINGS[k]);
  check(!bad.length, `every building named by a site exists (${bad.join(", ") || "ok"})`);
  const single = siteBuildings({ loc: { type: "pharmacy" }, terrain: "city" }), multi = siteBuildings({ loc: { type: "farm" }, terrain: "plains" });
  check(single.single && !multi.single && multi.options.length === 2, "a pharmacy is one building, a farmstead two (farmhouse and barn)");
  const opts = buildingOptions({ loc: { type: "town" }, terrain: "suburb" });
  check(opts && opts.at(-1).id === "street" && opts.every((o) => o.hint) && new Set(opts.map((o) => o.id)).size === opts.length, `a town offers ${opts.length - 1} buildings and the street, each with a hint ("${opts[0].hint.slice(0, 60)}…")`);
  check(!siteBuildings({ loc: { type: "campground" }, terrain: "forest" }) && !siteBuildings({ loc: { type: "crash_mil" }, terrain: "plains" }), "campgrounds and crash sites keep the street map");
}

// ======================================================================================
// A raid on a site of one of these types, on its map (as the browser starts it, without the window).
function raidAt(types, opts = {}) {
  for (let i = 0; i < 40; i++) {
    const st = createWorld({ seed: (opts.seed || 300) + i, factionCount: 6 });
    st.cards.length = 0;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && types.includes(t.loc.type) && t.id !== h.tile);
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, opts.crew || 3);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: opts.vehicle ? st.vehicles[0].id : null, supplies: { food: 4, water: 4, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const groups = opts.groups || raidEnemies(st, tile.id);
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "itest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5, ...(opts.raid || {}) }, context: {} };
    st.combat = createBattle(st, setup);
    if (opts.want && !opts.want(st.combat)) continue;
    return { st, b: st.combat, p, tile, setup, crew };
  }
  return null;
}

console.log("Raids on building maps");
{
  // The same site gives the same layout.
  const r1 = raidAt(["police"]);
  check(r1 && r1.b.raid.interior && r1.b.raid.interior.key === "police", `a police station opens straight into its interior (${r1 && r1.b.w}x${r1 && r1.b.h})`);
  const sig = (cells) => cells.map((c) => c.k).join(",");
  const again = buildingMap(r1.st, r1.tile.id, { id: "police", key: "police", name: "Police station" }, false);
  const other = buildingMap(r1.st, r1.tile.id + 1, { id: "police", key: "police", name: "Police station" }, false);
  check(sig(again.cells) === sig(r1.b.cells) && JSON.stringify(again.plan.rooms) === JSON.stringify(r1.b.raid.plan.rooms) && sig(other.cells) !== sig(again.cells), "the same site has the same floor plan every visit (another site another)");
  // Locked doors in the raid are locks.js doors; locked containers are locked.
  const b = r1.b;
  check((b.raid.doors || []).length > 0 && b.raid.doors.every((d) => b.cells[d.y * b.w + d.x].k === "door" && d.lock && !d.lock.open), `${b.raid.doors.length} locked door cells (${b.raid.areas.filter((a) => a.locked).map((a) => a.name).join(", ")})`);
  check(b.raid.containers.some((c) => c.lock), `locked containers inside (${b.raid.containers.filter((c) => c.lock).map((c) => c.label).join(", ")})`);
  check(b.raid.occupants && b.raid.occupants.asked, "the occupants hook (wanderers.js interiorOccupants) was asked");
  // The team starts at the front.
  const team = b.units.filter((u) => u.side === "player");
  check(team.every((u) => u.y >= b.raid.plan.building.y0 + b.raid.plan.building.h), "the team starts outside the front of the building");
  // The dead are mostly inside.
  const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie");
  const B = b.raid.plan.building, inB = (u) => u.x >= B.x0 && u.x < B.x0 + B.w && u.y >= B.y0 && u.y < B.y0 + B.h;
  check(!dead.length || dead.filter(inB).length >= dead.length / 2, `the dead are mostly inside (${dead.filter(inB).length} of ${dead.length})`);
}

console.log("Occupants");
{
  const r = raidAt(["pharmacy"], { groups: [] });
  const b = r.b;
  const before = b.units.filter((u) => u.side === "enemy").length;
  const calls = [];
  const realNeutral = occupantSide("neutral"); // thirdside.js registers the real one; this test swaps it for a probe
  registerOccupantSide("neutral", (st, bb, grp, place) => { calls.push(grp.side); for (const p of grp.people) { const c = place.cells()[0]; if (c) bb.units.push({ id: bb.nextId++, side: "neutral", kind: "human", name: p.name || "Survivor", x: c[0], y: c[1], hp: 50, maxHp: 50 }); } });
  placeOccupantGroups(r.st, b, [
    { side: "hostile", people: [{ kit: "raiders", weapon: "shotgun", name: "Mags Doyle" }, { kit: "raiders" }], room: "stock" },
    { side: "neutral", people: [{ name: "A survivor" }] },
    { side: "military", people: [{ kit: "soldiers" }, { kit: "soldiers" }] },
  ]);
  const hostile = b.units.filter((u) => u.occupant === "hostile");
  const stock = b.raid.areas.find((a) => a.role === "stock");
  check(hostile.length === 2 && hostile.some((u) => u.name === "Mags Doyle" && u.weapon === "shotgun") && hostile.every((u) => u.side === "enemy" && !u.aware), `hostile occupants are placed as unaware guards (${hostile.map((u) => `${u.name} at ${u.x},${u.y}`).join(", ")})`);
  check(!stock || hostile.every((u) => u.x > stock.x0 && u.x < stock.x0 + stock.w - 1 && u.y > stock.y0 && u.y < stock.y0 + stock.h - 1), "in the room they asked for (the stockroom)");
  check(calls.includes("neutral") && b.units.some((u) => u.side === "neutral"), "a side with a registered handler (neutral) is handed to it");
  check(b.units.filter((u) => u.side === "third" && u.team === "military").length === 2 && !b.raid.occupants.waiting.length, "the military squad is placed as a third side (thirdside.js)");
  check(b.units.filter((u) => u.side === "enemy").length === before + 2, "only the hostile ones joined the enemy");
  b.units = b.units.filter((u) => u.side !== "neutral");
  if (realNeutral) registerOccupantSide("neutral", realNeutral);
}

console.log("A site with several buildings: the choice");
{
  const r = raidAt(["town", "farm", "city"], { raid: { choose: true } });
  const b = r.b;
  check(b.raid.choose && b.raid.choose.length >= 3 && !b.raid.interior, `the street map opens with a choice of ${b.raid.choose.length - 1} buildings and the street (${b.raid.choose.map((o) => o.name).join(", ")})`);
  const pick = b.raid.choose[0];
  const err = combatAct(r.st, { type: "building", id: pick.id });
  const nb = r.st.combat;
  check(!err && nb !== b && nb.raid.interior && nb.raid.interior.id === pick.id && !nb.raid.choose && nb.units.filter((u) => u.side === "player").length === r.crew.length, `picking the ${pick.name.toLowerCase()} opens its own map (${nb.w}x${nb.h}, ${nb.raid.areas.filter((a) => !a.outdoor).length} rooms)`);
  const r2 = raidAt(["town", "farm", "city"], { raid: { choose: true }, seed: 900 });
  const u = r2.b.units.find((x) => x.side === "player");
  combatAct(r2.st, { type: "hunker", unit: u.id });
  check(!r2.b.raid.choose && chooseBuilding(r2.st, "street") !== "", "acting on the street map ends the choice (the street it is)");
  const r3 = raidAt(["town", "farm", "city"], { raid: { choose: true }, seed: 1200 });
  autoPlayerTurn(r3.st);
  check(!r3.st.combat.raid.choose, `the AI picks for itself (${r3.st.combat.raid.interior ? r3.st.combat.raid.interior.name : "the street"})`);
}

console.log("Doors, roller doors and windows");
{
  const r = raidAt(["warehouse", "autoshop", "firestation", "hardware"], { groups: [], want: (b) => b.cells.some((c) => c.k === "idoor" && !c.roll) && b.cells.some((c) => c.k === "idoor" && c.roll) && b.cells.some((c) => c.k === "window") });
  check(!!r, "test setup: a map with doors, a roller door and windows");
  if (r) {
    const { st, b } = r;
    const W = b.w;
    const u = b.units.find((x) => x.side === "player");
    for (const o of b.units.filter((x) => x.side === "player" && x !== u)) { o.x = 0; o.y = 0; o.left = true; }
    // A closed door blocks sight; walking through opens it.
    const walkable = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * W + x].k].walk && b.cells[y * W + x].k !== "idoor";
    let a1 = null, a2 = null, di = -1;
    for (let i = 0; i < b.cells.length && !a1; i++) {
      if (b.cells[i].k !== "idoor" || b.cells[i].roll || b.cells[i].h) continue;
      const x = i % W, y = (i / W) | 0;
      if (walkable(x - 1, y) && walkable(x + 1, y)) { a1 = [x - 1, y]; a2 = [x + 1, y]; di = i; }
      else if (walkable(x, y - 1) && walkable(x, y + 1)) { a1 = [x, y - 1]; a2 = [x, y + 1]; di = i; }
    }
    const dx = di % W, dy = (di / W) | 0;
    if (a1 && a2) {
      b.losCache.fill(0);
      const blocked = !los(b, a1[0], a1[1], a2[0], a2[1]);
      u.x = a1[0]; u.y = a1[1]; u.ap = 2; b.phase = "player";
      const err = combatAct(st, { type: "move", unit: u.id, x: dx, y: dy });
      check(blocked && !err && b.cells[di].k === "odoor" && los(b, a1[0], a1[1], a2[0], a2[1]), `a closed door blocks sight; walking into it opens it (${err || "ok"})`);
    } else check(false, "test setup: a closed door between two floor cells");
    // A roller door: loud.
    const ri = b.cells.findIndex((c) => c.k === "idoor" && c.roll);
    const rx = ri % W, ry = (ri / W) | 0;
    const rs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, c]) => [rx + a, ry + c]).find(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * W + x].k].walk && b.cells[y * W + x].k !== "idoor");
    if (rs) {
      u.x = rs[0]; u.y = rs[1]; u.ap = 2; b.phase = "player";
      const h0 = b.raid.heat;
      const err = combatAct(st, { type: "move", unit: u.id, x: rx, y: ry });
      const all = b.cells.filter((c) => c.roll);
      check(!err && all.every((c) => c.k === "odoor" || c.k === "door") && b.raid.heat >= h0 + BMAP.ROLLER.heat, `a roller door goes up whole and loud (Heat ${Math.round(h0)} → ${Math.round(b.raid.heat)})`);
    }
    // A window: climb through it.
    let done = false;
    for (let i = 0; i < b.cells.length && !done; i++) {
      if (b.cells[i].k !== "window") continue;
      const wx = i % W, wy = (i / W) | 0;
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sx = wx - ddx, sy = wy - ddy;
        if (sx < 0 || sy < 0 || sx >= b.w || sy >= b.h || !CELL[b.cells[sy * W + sx].k].walk || b.units.some((o) => !o.left && !o.dead && o !== u && o.x === sx && o.y === sy)) continue;
        u.x = sx; u.y = sy; u.ap = 2; b.phase = "player";
        const opts = windowsNear(b, u);
        if (!opts.some((o) => o.x === wx && o.y === wy)) continue;
        const h0 = b.raid.heat;
        const err = combatAct(st, { type: "climb", unit: u.id, x: wx, y: wy });
        check(!err && u.x === wx + ddx && u.y === wy + ddy && b.cells[i].k === "smashed" && b.raid.heat >= h0 + BMAP.CLIMB.heat && u.ap === 2 - BMAP.CLIMB.ap, `climbing through a window: through to the far side, the glass broken, Heat +${BMAP.CLIMB.heat} (${err || "ok"})`);
        done = true;
        break;
      }
    }
    check(done, "found a window to climb");
    void active;
  }
}

// ======================================================================================
// The lab: an interior raid's map wiped to two rooms split by a wall (column 12) with one door at (12, 6); one of your
// people, the dead and guards placed by hand; no waves.
function lab(opts = {}) {
  const r = raidAt(["house", "pharmacy", "police"], { groups: [], seed: 4000 + (opts.seed || 0) });
  const { st, b } = r;
  const W = b.w, H = b.h;
  b.cells = b.cells.map(() => ({ k: "open", f: "floor", fl: "tile" }));
  for (let y = 0; y < H; y++) b.cells[y * W + 12] = { k: "wall", f: "floor" };
  b.cells[6 * W + 12] = { k: opts.open ? "odoor" : "idoor", f: "floor", hp: 30, mhp: 30 };
  b.reach = new Uint8Array(W * H).fill(1);
  b.losCache.fill(0);
  b.raid.containers = []; b.raid.doors = []; b.raid.spawnCap = 0; b.raid.heat = 0;
  const me = b.units.filter((u) => u.side === "player");
  const u = me[0];
  for (const o of me.slice(1)) { o.left = true; o.x = 0; o.y = H - 1; }
  b.units = b.units.filter((x) => x.side === "player");
  u.x = 11; u.y = 6; u.ap = 2; u.hp = u.maxHp = 9999; // a punching bag: the tests count turns, not wounds
  b.phase = "player"; b.turn = 1; b.peeks = [];
  const add = (kind, x, y, aware = true) => { const e = enemyUnit(b, st.rng, kind, 2, b.units.length + 1); e.x = x; e.y = y; e.aware = aware; e.pod = b.units.length + 10; e.home = [x, y]; if (kind !== "zombies") e.hp = e.maxHp = 9999; b.units.push(e); return e; };
  const door = () => b.cells[6 * W + 12];
  const turn = () => { for (const p of b.units) if (p.side === "player") p.ap = 0; endPlayerTurn(st); runEnemyPhase(st); };
  return { st, b, u, add, door, turn, W };
}

console.log("Peeking, closing and bracing doors, the dead at a door, noise indoors (a two-room lab)");
{
  // Peek: see the next room this turn without moving or spending an action.
  {
    const { st, b, u, add, W } = lab();
    const z = add("zombies", 16, 6, false);
    const before = playerVision(b)[6 * W + 16];
    const err = combatAct(st, { type: "peek", unit: u.id });
    const vis = playerVision(b);
    check(!err && !before && vis[6 * W + 16] && vis[2 * W + 15] && playerSees(b, z) && u.x === 11 && u.y === 6 && u.ap === 2, `a peek through a closed door shows the room beyond and who is in it, without moving or an action (${err || "ok"})`);
    check(combatAct(st, { type: "peek", unit: u.id }) !== "", "once a turn per unit");
    b.turn++;
    check(!playerVision(b)[6 * W + 16], "the next turn the room is dark again");
  }
  // Close a door: sight is cut.
  {
    const { st, b, u, door } = lab({ open: true });
    const saw = los(b, 11, 6, 15, 6);
    const err = combatAct(st, { type: "close", unit: u.id });
    check(saw && !err && door().k === "idoor" && !los(b, 11, 6, 15, 6) && u.ap === 1, `closing an open door (1 action, quiet) blocks sight again (${err || "ok"})`);
  }
  // The dead batter a closed door: turns by its strength; two together faster; bracing it slows them.
  const batter = (n, brace) => {
    const { st, b, u, add, door } = lab({ seed: n + (brace ? 10 : 0) });
    for (let i = 0; i < n; i++) add("zombies", 13 + i, 6 + (i ? 1 : 0));
    if (brace) combatAct(st, { type: "brace", unit: u.id });
    let t = 0;
    while (door().k === "idoor" && t < 30) { turn(st, b); t++; }
    return { t, k: door().k, heat: b.raid.heat, log: b.log.map((l) => l.text).join("|") };
    function turn() { for (const p of b.units) if (p.side === "player") p.ap = 0; endPlayerTurn(st); runEnemyPhase(st); }
  };
  const one = batter(1), two = batter(2), held = batter(1, true);
  check(one.k === "doorway" && one.t >= 2 && one.heat > 0, `one of the dead batters a 30-point door down in ${one.t} turns, noisily (Heat ${Math.round(one.heat)}); it stays broken`);
  check(two.t <= one.t, `two together take ${two.t} turns`);
  check(held.t > one.t, `braced from this side it holds ${held.t} turns`);
  // A closed door behind someone running buys turns.
  const chase = (open) => {
    const L = lab({ open, seed: 30 });
    L.u.x = 4; L.u.y = 6;
    L.add("zombies", 17, 6);
    let t = 0;
    while (!L.b.units.some((e) => e.side === "enemy" && Math.max(Math.abs(e.x - L.u.x), Math.abs(e.y - L.u.y)) <= 1) && t < 30) { L.turn(); t++; }
    return t;
  };
  const tOpen = chase(true), tShut = chase(false);
  check(tShut >= tOpen + 2, `the dead reach someone behind an open door in ${tOpen} turns, behind a shut one in ${tShut}`);
  // Humans open doors (an action: they stop in the doorway); a braced door they must break.
  {
    const L = lab({ seed: 40 });
    L.u.x = 4; L.u.y = 6;
    const g = L.add("raiders", 15, 6);
    let t = 0;
    while (L.door().k === "idoor" && t < 6) { L.turn(); t++; }
    check(L.door().k === "odoor", `a raider opens the closed door (turn ${t})`);
    const M = lab({ seed: 41 });
    M.add("raiders", 15, 6);
    combatAct(M.st, { type: "brace", unit: M.u.id });
    M.turn();
    check(M.door().k !== "odoor", `braced, it does not open for them (${M.door().k}, ${M.door().hp}/${M.door().mhp})`);
    void g;
  }
  // Thrown noise indoors: through the doorway into the other room, it pulls the dead there; at a wall it drops short.
  {
    const L = lab({ open: true, seed: 50 });
    L.u.x = 9; L.u.y = 6;
    const z = L.add("zombies", 7, 7, false);
    const chaser = L.add("zombies", 4, 5, true);
    const s = survivorById(L.st, L.u.sid);
    stow(s, newItem("firecracker"));
    const err = combatAct(L.st, { type: "throw", unit: L.u.id, item: "firecracker", x: 16, y: 6 });
    check(!err && z.investigate && z.investigate.x === 16 && !chaser.aware && chaser.investigate, `firecrackers thrown through the doorway into the next room pull the dead to them, even one after you that is not close by (${err || "ok"})`);
    L.u.x = 1; L.u.y = L.b.h - 2; // slip away out of their sight
    for (let i = 0; i < 6; i++) L.turn();
    check(z.x > 12 || chaser.x > 12, `they go into the other room after it (${z.x},${z.y} and ${chaser.x},${chaser.y})`);
    const M = lab({ seed: 51 });
    M.u.x = 8; M.u.y = 3;
    stow(survivorById(M.st, M.u.sid), newItem("bottle"));
    combatAct(M.st, { type: "throw", unit: M.u.id, item: "bottle", x: 15, y: 3 });
    const lure = (M.b.lures || [])[0];
    check(lure && lure.x <= 11, `thrown at a wall it drops short (landed ${lure && `${lure.x},${lure.y}`})`);
    // Through a wall a noise carries less far.
    const N = lab({ seed: 52 });
    const far = N.add("zombies", 18, 6, false);
    noiseAt(N.b, 8, 6, 8);
    check(!far.investigate, "a noise 10 tiles off behind a wall and a shut door is not heard (it would be in the open)");
  }
}

console.log("A raid inside a building saved and loaded halfway");
{
  const r = raidAt(["police", "pharmacy"], { seed: 77 });
  for (let i = 0; i < 3 && !r.st.combat.over; i++) { autoPlayerTurn(r.st); runEnemyPhase(r.st); }
  const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(r.st))));
  const b2 = st2.combat;
  let g = 0;
  try { while (b2 && !b2.over && g++ < 200) { autoPlayerTurn(st2); runEnemyPhase(st2); } } catch (e) { console.log(e.stack); }
  check(b2 && b2.raid.interior && b2.raid.interior.key === r.b.raid.interior.key && b2.over, `loads with its building (${b2 && b2.raid.interior.name}, ${b2 && b2.raid.doors.length} locked doors) and plays to the end (${b2 && b2.result && b2.result.outcome})`);
}

console.log(`Headless raids on building maps (${RAIDS})`);
{
  const types = ["police", "pharmacy", "gunstore", "grocery", "clinic", "church", "autoshop", "motel", "apartments", "school", "hardware", "diner", "cabin", "barn", "firestation", "supermarket", "town", "farm", "military"];
  let raids = 0, out = 0, timeouts = 0, crashes = 0, searched = 0, total = 0, doorsOpened = 0, interior = 0;
  const per = {};
  for (let i = 0; i < RAIDS; i++) {
    const type = types[i % types.length];
    let r;
    try { r = raidAt([type], { seed: 2000 + i * 13, raid: { choose: true }, vehicle: i % 3 === 0 }); } catch (e) { crashes++; console.log(e.stack); continue; }
    if (!r) continue;
    const { st } = r;
    try {
      let g = 0;
      while (!st.combat.over && g++ < 200) { autoPlayerTurn(st); runEnemyPhase(st); }
    } catch (e) { crashes++; if (crashes < 3) console.log(type, e.stack); continue; }
    const b = st.combat;
    if (!b.over) { timeouts++; continue; }
    raids++;
    if (b.raid.interior) interior++;
    if (b.result.outcome === "extracted") out++;
    searched += b.result.raid.searched; total += b.result.raid.total;
    doorsOpened += b.cells.filter((c) => c.k === "odoor").length;
    const k = b.raid.interior ? b.raid.interior.key : "street";
    per[k] = (per[k] || 0) + 1;
  }
  check(!crashes && !timeouts, `${raids} raids played to the end (${crashes} crashes, ${timeouts} timeouts)`);
  check(interior >= raids * 0.6, `most of them inside a building (${interior}): ${Object.entries(per).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  check(out >= raids * 0.4, `the bot gets out of most (${out} of ${raids}); searched ${searched} of ${total} containers; ${doorsOpened} open doors at the end`);
}

console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(fails ? 1 : 0);
