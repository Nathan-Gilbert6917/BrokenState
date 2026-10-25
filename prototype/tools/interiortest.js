// Building interiors (src/sim/buildingmaps.js): every archetype's map, the sites that use them, and raids played on them.
//   - every archetype generates for several seeds; map sizes are sane; every room is reachable from the front (locked
//     doors counted as ways through), heights only change on stairs or a ladder; every exit's zone is on the map edge
//     and reachable; containers can be reached; locked rooms and containers are there where the archetype puts them;
//   - every location type in combat.js AREA_SETS has buildings, or is one of the outdoor sites that keep the street map;
//   - the same site gives the same layout; a single-building site opens straight into its interior, a site with several
//     has its building picked before the map (by hand or by the AI's dice), never on it; the occupants hook is called
//     and its groups are placed;
//   - doors open as people walk through (sight changes), roller doors are loud, windows can be climbed (loud);
//   - a headless raid on interiors plays to the end, mostly to extraction;
//   - homes room by room (roomlayout.js, issue #10): every house, farmhouse, cabin, lodge, ranger station, apartment
//     and shop flat has a kitchen with a stove, a fridge and a sink, every bathroom a toilet, every bedroom a bed and a
//     wardrobe or a chest of drawers; every room's doors (and the stairs) stay reachable from each other; no piece of
//     2+ cells takes a door's front; the containers are exactly the lootable pieces of the home rooms; two houses lay a
//     room out differently; a sofa faces its TV; a house holds what it did before within ±10% (200 seeded houses, the
//     legacy layout against the new); an older save keeps the old layout (save.js roomsLegacy);
//   - hospitals, clinics, infirmaries and vets room by room (roomlayout.js MEDICAL_STYLES, issue #14): the rooms by
//     name on their floors (the ER, the waiting room, the pharmacy, the ambulance bay, the morgue and the cafeteria on a
//     hospital's ground floor; the theatre, the ICU and the supply room on the first floor up; the maternity ward, the
//     staff room and the laundry on the top floor; wards and a nurses' station on every floor up), each with its
//     signature pieces; every bed has a nightstand or an IV stand beside it (and every ER gurney its IV stand); the
//     corridors 2 wide, their parked pieces on one wall only; the pharmacy's steel door locked and its drug safe
//     locked; every room's doors reachable from the stairs on every floor; the containers exactly the lootable pieces
//     (and the ambulance); the meds per building within ±10% of the old layout (200 seeded buildings); the hospital's
//     scenes (an ER overrun, a sealed ward, the morgue's dead) roll; an older save keeps the old plan;
//   - commercial buildings laid out for their kind (shoplayout.js, issue #16: the rest in tools/shopstest.js): every
//     room's doors and stairs reachable from each other, no piece of 2+ cells on a door's front;
//   - civic buildings laid out for their kind (civiclayout.js, issue #15): a police station's rooms with their pieces
//     (the front desk's counter, the squad room's desks, the armory's gun racks, the evidence room's lockers, cells each
//     with bars, a cell door, a bunk, a toilet and a sink, a one-way window from an interview room, a police car in the
//     sally port), a fire station's engine bay behind a roller door with the fire engine in it and turnout lockers, a
//     school's classrooms with every desk facing the whiteboard wall, a corridor of lockers, a gym with bleachers and a
//     storage cage, a walk-in behind a cold room door, a church's pews in two columns either side of a clear aisle to
//     the altar; every room's doors reachable; the containers are exactly the lootable pieces and the vehicles; the
//     armory, the evidence room and a school hold what they did within ±10%; an older save keeps the old layouts;
//   - hotels (hotellayout.js, issue #29), every kind (an inn, a business hotel, a resort, a tower) over its franchises'
//     seeds: the lobby with its reception desk, key rack and locked safe; guest floors of rooms each with a bed and its
//     en suite bathroom (a toilet, a sink, a tub or a shower); housekeeping on every guest floor; two stair runs at 6+
//     floors (every big hotel has two); the laundry and the kitchen (and its walk-in) back of house; every walkable cell
//     reachable on every floor; the map within 200 × 200; an inn's 10–20 rooms; the loot of each kind, reported.
// Usage: node tools/interiortest.js [seeds per archetype] [raids]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import {
  createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler, combatAct, CELL, AREAS, AREA_SETS, los, active, registerOccupantSide, occupantSide,
  playerVision, playerSees, enemyUnit, endPlayerTurn, survivorById,
} from "../src/sim/combat.js";
import { noiseAt } from "../src/sim/stealth.js";
import { newItem, stow } from "../src/sim/inventory.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { raidBuildings, buildingPickFor } from "../src/sim/poiraid.js"; // a site's building, picked before the map
import { BUILDINGS, SITES, assemble, siteBuildings, buildingMap, buildingOptions, placeOccupantGroups, windowsNear, BMAP } from "../src/sim/buildingmaps.js";
import { HOME_STYLES, HOME_KEYS, MEDICAL_STYLES, MED_KEYS } from "../src/sim/roomlayout.js";
import { rollScenes } from "../src/sim/interiorscenes.js";
import { COMMERCIAL_KEYS, styleName } from "../src/sim/shoplayout.js";
import { CIVIC_STYLES } from "../src/sim/civiclayout.js";
import { pieceDef } from "../src/sim/data-furniture.js";
import { boxLoot, FLOOR_RICH } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { Rng } from "../src/sim/rng.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { mapCap } from "../src/sim/battlesize.js"; // a building's own map cap (a hotel's 200 × 200, issue #29)
import { HOTEL } from "../src/sim/hotellayout.js";
import { FRANCHISES } from "../src/sim/data-shops.js";

const SEEDS = Number(process.argv[2] || 6);
const FURN = new Set(Object.keys(CELL).filter((k) => pieceDef(k)));
const RAIDS = Number(process.argv[3] || 12);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();
registerCombatHandler("itest", () => {});

// Walking over a map: 4-way steps; heights only change on stairs or a ladder (as combat.js climbCost); locked doors
// count as passable when lockedOk.
// cells: a grid (the ground map's, or an upper floor's: m.floors[f].cells).
function walkFrom(m, sx, sy, lockedOk = true, cells = m.cells) {
  const W = m.w, H = m.h, seen = new Uint8Array(W * H);
  const pass = (c) => CELL[c.k].walk || (lockedOk && c.k === "door");
  const hOf = (c) => c.h ?? CELL[c.k].h ?? 0;
  const climb = (c) => !!CELL[c.k].climb;
  const q = [sy * W + sx];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0, c = cells[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx, d = cells[j];
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
      const cap = mapCap(key); // a hotel's map up to 200 × 200 (its grounds round it, issue #29)
      const huge = m.building && m.building.w >= 50; // the supermarket since issue #22: past the largest size class, its map its footprint and margins
      if (W < 14 || H < 14 || W > (cap || (huge ? m.building.w + 12 : 44)) || H > (cap || (huge ? m.building.h + 16 : 34))) errs.push(`size ${W}x${H}`);
      const z0 = m.zones[0];
      const start = [z0.x0 + 1, z0.y0 + (s % 2 === 1 ? 0 : 1)];
      if (!CELL[m.cells[start[1] * W + start[0]].k].walk) errs.push("the front zone is blocked");
      const reach = walkFrom(m, start[0], start[1], true);
      // Storeys (multi-storey-crawl.md): every floor's grid, its reach from the first stairwell (storeytest.js goes further).
      const floors = m.floors || [{ cells: m.cells }];
      const gridOf = (f) => floors[f || 0].cells;
      const reachOf = floors.map((F, f) => (f === 0 ? reach : walkFrom(m, m.stairs[0][0], m.stairs[0][1], true, F.cells)));
      // Rooms reachable from the front (upstairs: from the stairwell).
      for (const r of m.rooms.filter((a) => !a.outdoor)) {
        let any = false;
        const rf = reachOf[r.f || 0];
        for (let y = r.y0 + 1; y < r.y0 + r.h - 1 && !any; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (rf[y * W + x]) { any = true; break; }
        if (!any) errs.push(`room ${r.name} (floor ${r.f || 0}) unreachable`);
      }
      // Every walkable cell reachable (no pockets), on every floor.
      let pockets = 0;
      floors.forEach((F, f) => { for (let i = 0; i < W * H; i++) if ((CELL[F.cells[i].k].walk || F.cells[i].k === "door") && !reachOf[f][i]) pockets++; });
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
        const grid = gridOf(c.f), rf = reachOf[c.f || 0];
        const k = grid[c.y * W + c.x].k;
        if (CELL[k].walk) errs.push(`container ${c.label} on walkable ${k}`);
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => { const x = c.x + dx, y = c.y + dy; return x >= 0 && y >= 0 && x < W && y < H && CELL[grid[y * W + x].k].walk && rf[y * W + x]; });
        if (!near) errs.push(`container ${c.label} unreachable`);
        const area = m.rooms[c.area];
        if (!area || area.id !== c.area || !AREAS[area.type]) errs.push(`container ${c.label} in an area with no loot type`);
        if ((area && (area.f || 0)) !== (c.f || 0)) errs.push(`container ${c.label} on floor ${c.f || 0}, its room on ${area && area.f}`);
      }
      // Locks: every locked room's doors are locked door cells, its containers flagged.
      for (const r of m.rooms.filter((a) => a.locked)) {
        locksBy[key].rooms++;
        const grid = gridOf(r.f);
        const ds = m.lockedDoors.filter((d) => d.area === r.id);
        if (!ds.length || !ds.every((d) => (d.f || 0) === (r.f || 0) && grid[d.y * W + d.x].k === "door")) errs.push(`locked room ${r.name} without locked doors`);
        if (m.containers.some((c) => c.area === r.id && !c.room)) errs.push(`a container in locked ${r.name} not flagged`);
        // With its doors shut, nothing inside is reachable from the front (upstairs: from the stairwell).
        const shut = r.f ? walkFrom(m, m.stairs[0][0], m.stairs[0][1], false, grid) : walkFrom(m, start[0], start[1], false);
        for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (shut[y * W + x]) { errs.push(`locked ${r.name} reachable with its doors shut`); y = 1e9; break; }
      }
      locksBy[key].boxes += m.containers.filter((c) => c.lockKind).length;
      locksBy[key].exits += m.exits.filter((e) => e.locked).length;
      // A raised loft (a barn's hayloft): walls two storeys tall, loft cells raised, a ladder or stairs up to it. Real
      // storeys (m.floors): the ground floor's walls two storeys tall, a stairwell on every floor.
      if (m.plan.tall && !(m.storeys > 1) && !m.cells.some((c) => c.k === "loft" && c.h === 1)) errs.push("tall but no upper floor");
      if (m.rooms.some((a) => a.up) && !m.cells.some((c) => c.k === "stairs" || c.k === "ladder")) errs.push("an upper floor with no stairs");
      if (m.storeys > 1 && !floors.every((F) => m.stairs.every(([x, y]) => F.cells[y * W + x].k === "stairs"))) errs.push("a floor without the stairwell");
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
  const outdoor = ["campground", "crashsite", "crash_mil", "crash_cargo", "crash_med", "crash_news", "airdrop", "convoy", "water", "road", "bridge", "blind", "campsite", "hikercamp"]; // blind, campsite, hikercamp: points of interest with no building (pois.js; buildingmaps.js SITES) // convoy: an Army convoy on a road (miltrucks.js) // road, bridge: a bare road and a bridge keep the street map (combat.js AREA_SETS)
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
    // opts.pick: a site's building picked before the map as the raid's start picks it for the AI (scavenge.js startScavenge, poiraid.js buildingPickFor).
    const bo = opts.pick ? raidBuildings(st, tile) : null;
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "itest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5, ...(opts.raid || {}), ...(bo ? { building: buildingPickFor(st, tile.id, bo) } : {}) }, context: {} };
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

console.log("A site with several buildings: picked before the map");
{
  // The choice is made before the raid map (poiraid.js buildingPickCard / buildingPickFor, the user's request
  // 2026-10-25; tools/buildingpicktest.js the whole flow): the map itself never offers it.
  const r = raidAt(["town", "farm", "city"], { raid: { choose: true } });
  const b = r.b;
  const opts = raidBuildings(r.st, r.tile);
  check(opts && opts.length >= 3 && opts[opts.length - 1].id === "street", `the choice before the map: ${opts ? opts.length - 1 : 0} buildings and the street (${opts ? opts.map((o) => o.name).join(", ") : ""})`);
  check(!b.raid.choose && !b.raid.interior, "a raid with none picked is the street map, nothing to choose on it");
  const pick = opts[0];
  const r1 = raidAt(["town", "farm", "city"], { raid: { building: pick.id } });
  const nb = r1.b;
  check(r1.tile.id === r.tile.id && nb.raid.interior && nb.raid.interior.id === pick.id && !nb.raid.choose && nb.units.filter((u) => u.side === "player").length === r1.crew.length, `the ${pick.name.toLowerCase()} picked before the map opens its own map (${nb.w}x${nb.h}, ${nb.raid.areas.filter((a) => !a.outdoor).length} rooms)`);
  const r3 = raidAt(["town", "farm", "city"], { pick: true, seed: 1200 });
  const want = buildingPickFor(r3.st, r3.tile.id, raidBuildings(r3.st, r3.tile));
  autoPlayerTurn(r3.st);
  check(!r3.st.combat.raid.choose && (want === "street" ? !r3.st.combat.raid.interior : r3.st.combat.raid.interior && r3.st.combat.raid.interior.id === want), `the AI's pick is made before the map by its own dice (${r3.st.combat.raid.interior ? r3.st.combat.raid.interior.name : "the street"}), then it plays that map`);
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

console.log("Where everyone starts (every unit on a walkable cell of its own floor, nobody on top of anyone)");
{
  // Units carry their storey in u.f (combat.js setFloor; b.floors[f].cells): a unit upstairs is checked against its
  // own floor's grid, not the ground floor's (an upstairs ward can be open where the ground floor has a wall).
  const types = ["hospital", "univ", "mall", "factory", "office", "military", "police", "pharmacy", "gunstore", "grocery", "clinic", "church", "autoshop", "motel", "apartments", "school", "hardware", "diner", "cabin", "barn", "firestation", "supermarket", "warehouse", "prison", "airport", "lodge", "ranch", "town", "city", "farm"];
  const bad = [];
  let units = 0, maps = 0, upstairs = 0;
  for (let s = 0; s < Math.max(2, Math.ceil(SEEDS / 2)); s++) {
    for (const type of types) {
      const r = raidAt([type], { seed: 5000 + s * 977 + type.length * 11, raid: { choose: true }, vehicle: s % 2 === 1 });
      if (!r) continue;
      const b = r.b;
      maps++;
      const seen = new Set();
      for (const u of b.units) {
        if (u.dead || u.off || u.fled || u.left) continue;
        units++;
        const f = u.f || 0;
        if (f) upstairs++;
        const grid = b.floors ? (b.floors[f] || {}).cells : b.cells;
        const where = `${type}${b.raid.interior ? ` (${b.raid.interior.key})` : " (street)"} seed ${s}: ${u.side} ${u.name}`;
        if (!grid) { bad.push(`${where} on floor ${f} of ${b.floors ? b.floors.length : 1}`); continue; }
        if (u.x < 0 || u.y < 0 || u.x >= b.w || u.y >= b.h) { bad.push(`${where} off the map at ${u.x},${u.y}`); continue; }
        const c = grid[u.y * b.w + u.x];
        if (!CELL[c.k].walk) bad.push(`${where} on ${c.k} at ${u.x},${u.y} floor ${f}`);
        const key = `${f}:${u.x},${u.y}`;
        if (seen.has(key)) bad.push(`${where} on someone at ${u.x},${u.y} floor ${f}`);
        seen.add(key);
      }
    }
  }
  check(maps >= types.length && !bad.length, `${units} units on ${maps} raid maps (${upstairs} upstairs) all start on walkable cells of their own floor, alone${bad.length ? `: ${bad.slice(0, 4).join("; ")}` : ""}`);
}

console.log(`Headless raids on building maps (${RAIDS})`);
{
  const types = ["police", "pharmacy", "gunstore", "grocery", "clinic", "church", "autoshop", "motel", "apartments", "school", "hardware", "diner", "cabin", "barn", "firestation", "supermarket", "town", "farm", "military"];
  let raids = 0, out = 0, timeouts = 0, crashes = 0, searched = 0, total = 0, doorsOpened = 0, interior = 0;
  const per = {};
  for (let i = 0; i < RAIDS; i++) {
    const type = types[i % types.length];
    let r;
    try { r = raidAt([type], { seed: 2000 + i * 13, pick: true, vehicle: i % 3 === 0 }); } catch (e) { crashes++; console.log(e.stack); continue; }
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

// ======================================================================================
console.log("\nHomes room by room (roomlayout.js)");
{
  const KEYS = ["house", "farmhouse", "cabin", "lodge", "ranger", "apartments", "corner"];
  const N = Math.max(SEEDS * 5, 30);
  const errs = {};
  const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
  let built = 0, flats = 0;
  const kitchenSigs = new Set();
  let sofas = 0, facingTv = 0;
  for (const key of KEYS) for (let s = 0; s < N; s++) {
    const rng = new Rng(31000 + s * 7919 + key.length * 17);
    const m = assemble(rng, BUILDINGS[key].make(rng, {}), { key, name: key });
    const grids = m.floors || [{ cells: m.cells }];
    const home = (a) => !!HOME_STYLES[a.role] && (HOME_KEYS.has(key) || a.flat);
    const rooms = m.rooms.filter((a) => !a.outdoor);
    if (key === "corner" && m.storeys < 2) continue; // no flat above this one
    built++;
    const cellsIn = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y, grids[a.f].cells[y * m.w + x]]); return out; };
    const kinds = (a) => new Set(cellsIn(a).map(([, , c]) => c.k));
    const tag = `${key} ${s}`;
    // A kitchen with a stove, a fridge and a sink (an apartment block: every flat's kitchen-living room has them).
    const kitchenOk = (a) => { const k = kinds(a); return k.has("stove") && k.has("fridge") && k.has("sink"); };
    if (key === "apartments") { for (const a of rooms.filter((r) => r.role === "apt")) { flats++; if (!kitchenOk(a)) err("kitchen", `${tag} ${a.name}`); } }
    else if (!rooms.some(kitchenOk)) err("kitchen", tag);
    for (const a of rooms.filter((r) => r.role === "kitchen")) kitchenSigs.add(cellsIn(a).map(([x, y, c]) => (FURN.has(c.k) ? `${x - a.x0},${y - a.y0}${c.k}` : "")).join(""));
    for (const a of rooms) {
      const k = kinds(a);
      if (a.role === "bath" && home(a) && !k.has("toilet")) err("toilet", `${tag} ${a.name}`);
      if (a.role === "bedroom" && home(a) && !(k.has("bed") || k.has("bunk"))) err("bed", `${tag} ${a.name}`);
      if (a.role === "bedroom" && home(a) && !(k.has("wardrobe") || k.has("dresser"))) err("wardrobe", `${tag} ${a.name}`);
      // Every door of the room (and every stair cell in it) reachable from its first door, on its floor.
      const doors = a.doors || [];
      if (doors.length) {
        const g = grids[a.f].cells;
        const seen = walkFrom(m, doors[0][0], doors[0][1], true, g);
        for (const [x, y] of doors) if (!seen[y * m.w + x]) err("doors", `${tag} ${a.name} door ${x},${y}`);
        for (const [x, y, c] of cellsIn(a)) if (c.k === "stairs" && !seen[y * m.w + x]) err("stairs", `${tag} ${a.name}`);
      }
      if (!home(a)) continue;
      // A piece of 2+ cells never on a door's front; the containers are exactly the lootable pieces.
      const g = grids[a.f].cells;
      const isDoor = (x, y) => ["idoor", "odoor", "door"].includes(g[y * m.w + x].k);
      const pieces = new Map();
      for (const [x, y, c] of cellsIn(a)) {
        const d = pieceDef(c.k);
        if (!d) continue;
        const id = c.pc ? `p${c.pc}` : `${x},${y}`;
        if (!pieces.has(id)) pieces.set(id, { k: c.k, cells: [] });
        pieces.get(id).cells.push([x, y]);
        if (c.pc && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isDoor(x + dx, y + dy))) err("doorway", `${tag} ${a.name} ${c.k}`);
      }
      const loot = [...pieces.values()].filter((p) => pieceDef(p.k).loot);
      const boxes = m.containers.filter((c) => c.area === a.id);
      const covered = (p) => boxes.some((b) => b.kind === p.k && p.cells.every(([x, y]) => x >= b.x && x < b.x + (b.w || 1) && y >= b.y && y < b.y + (b.h || 1)));
      if (loot.length !== boxes.length || !loot.every(covered)) err("containers", `${tag} ${a.name}: pieces ${loot.map((p) => p.k)} boxes ${boxes.map((b) => b.kind)}`);
      // A sofa faces its TV (fc: the way its front looks).
      const tv = [...pieces.values()].find((p) => p.k === "tvstand"), sofa = [...pieces.values()].find((p) => p.k === "sofa");
      if (tv && sofa) {
        sofas++;
        const fc = g[sofa.cells[0][1] * m.w + sofa.cells[0][0]].fc;
        const [sx, sy] = sofa.cells[0], [tx, ty] = tv.cells[0];
        const toward = fc === "n" ? ty < sy : fc === "s" ? ty > sy : fc === "w" ? tx < sx : fc === "e" ? tx > sx : false;
        if (toward) facingTv++;
      }
    }
  }
  for (const [what, label] of [["kitchen", "a kitchen with a stove, a fridge and a sink"], ["toilet", "every bathroom a toilet"], ["bed", "every bedroom a bed"], ["wardrobe", "every bedroom a wardrobe or a chest of drawers"], ["doors", "every room's doors reachable from each other"], ["stairs", "the stairs reachable from the rooms' doors"], ["doorway", "no piece of 2+ cells on a door's front"], ["containers", "the containers are exactly the lootable pieces"]]) {
    check(!errs[what], `${label} (${built} buildings, ${flats} flats)${errs[what] ? `: ${errs[what].length} bad, e.g. ${errs[what].slice(0, 3).join("; ")}` : ""}`);
  }
  check(kitchenSigs.size >= 10, `kitchens laid out differently house to house (${kitchenSigs.size} layouts)`);
  check(sofas > 0 && facingTv >= sofas * 0.9, `a sofa faces its TV (${facingTv} of ${sofas})`);
  // Loot per house: the old layout (legacy) against the new over 200 seeded houses, by a value of what the tables
  // hold (supplies by data.js supValue, gear by its value), within ±10%.
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  const total = (legacy) => {
    let v = 0, n = 0;
    for (let s = 0; s < 200; s++) {
      const rng = new Rng(9000 + s * 104729 + 5);
      const m = assemble(rng, BUILDINGS.house.make(rng, { legacy }), { key: "house", name: "House", legacy });
      for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type) { v += value(boxLoot(a.type, c.kind)); n++; } }
    }
    return { v: v / 200, n: n / 200 };
  };
  const before = total(true), after = total(false);
  check(Math.abs(after.v / before.v - 1) <= 0.1, `a house holds what it did within ±10%: ${after.v.toFixed(1)} against ${before.v.toFixed(1)} (${after.n.toFixed(1)} containers against ${before.n.toFixed(1)})`);
  // An older save keeps the old layout: no catalogue pieces beyond the old kinds, and save.js marks it.
  const OLD = new Set(["shelf", "locker", "cabinet", "counter", "crate", "rack", "table", "bed", "bars", "hay", "barrel", "gunsafe"]);
  let newKinds = 0;
  for (let s = 0; s < 10; s++) {
    const rng = new Rng(500 + s);
    const m = assemble(rng, BUILDINGS.house.make(rng, { legacy: true }), { key: "house", name: "House", legacy: true, noDecor: true }); // decor.js's plants and lamps are not this ticket's
    for (const F of m.floors || [{ cells: m.cells }]) for (const c of F.cells) if (pieceDef(c.k) && !OLD.has(c.k)) newKinds++;
  }
  check(!newKinds, `an older save's house is furnished the old way (${newKinds} new pieces)`);
  const st = createWorld({ seed: 4242, factionCount: 2 });
  const old = JSON.parse(JSON.stringify(serializeState(st)));
  delete old.state.roomsV;
  const back = deserializeState(old);
  const fresh = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  check(back.roomsLegacy === true && !fresh.roomsLegacy, "save.js: a save from before is marked roomsLegacy, a new world is not");
}

// ======================================================================================
console.log("\nHospitals, clinics, infirmaries and vets room by room (roomlayout.js MEDICAL_STYLES)");
{
  const N = Math.max(SEEDS * 4, 24);
  const errs = {};
  const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
  const NEAR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // The pieces a room must have, by role (any one of a list; a vet's or a clinic's where they differ).
  const SIG = {
    er: [["gurney"], ["ivstand"], ["desk"]], ward: [["hospbed", "bars"]], icu: [["hospbed"], ["monitor"]], theatre: [["optable", "vettable"], ["instcab"]],
    pharmroom: [["drugsafe", "medcab"], ["counter"]], morgue: [["morguelocker"], ["autopsy"]], lobby: [["counter"], ["chair"]], nursestation: [["counter"], ["desk"], ["medcart"]],
    cafeteria: [["counter"], ["table"], ["chair"]], kitchen: [["fridge"], ["stove"], ["sink"]], staffroom: [["fridge"]], breakroom: [["fridge"]], laundry: [["washer"]],
    storage: [["rack", "shelf", "crate"]], office: [["desk"]], restroom: [["toilet"]], exam: [["exambed", "vettable"], ["medcab"]], cells: [["bars"]],
  };
  // Where a hospital's rooms are: [floor test, role, name pattern].
  const FLOORS = [
    [(f) => f === 0, "er", /Emergency/], [(f) => f === 0, "lobby", /Waiting room/], [(f) => f === 0, "pharmroom", /Pharmacy/], [(f) => f === 0, "ambbay", /Ambulance bay/],
    [(f) => f === 0, "morgue", /Morgue/], [(f) => f === 0, "cafeteria", /Cafeteria/], [(f) => f === 0, "kitchen", /Kitchen/], [(f) => f === 0, "restroom", /Restroom/],
    [(f) => f === 1, "theatre", /Operating theatre/], [(f) => f === 1, "icu", /ICU/], [(f) => f === 1, "storage", /Supply room/],
    [(f, top) => f === top, "ward", /Maternity ward/], [(f, top) => f === top, "staffroom", /Staff room/], [(f, top) => f === top, "laundry", /Laundry/],
    [(f) => f >= 1, "ward", /^Ward/], [(f) => f >= 1, "nursestation", /Nurses' station/], [(f) => f >= 1, "office", /Doctors' office/],
  ];
  let built = 0, beds = 0, gurneys = 0, scenes = {}, rise = 0, safes = 0;
  for (const key of ["hospital", "clinic", "infirmary", "vet"]) for (let s = 0; s < N; s++) {
    const rng = new Rng(52000 + s * 7919 + key.length * 31);
    const m = assemble(rng, BUILDINGS[key].make(rng, {}), { key, name: key });
    const grids = m.floors || [{ cells: m.cells }];
    const rooms = m.rooms.filter((a) => !a.outdoor);
    const tag = `${key} ${s}`;
    built++;
    const cellsIn = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y, grids[a.f].cells[y * m.w + x]]); return out; };
    const kindsIn = (a) => new Set(cellsIn(a).map(([, , c]) => c.k));
    // The rooms by name on their floors (a hospital).
    if (key === "hospital") {
      const top = m.storeys - 1;
      for (const [onF, role, re] of FLOORS) for (let f = 0; f <= top; f++) if (onF(f, top) && !rooms.some((a) => a.f === f && a.role === role && re.test(a.name))) err("rooms", `${tag} floor ${f}: no ${role} ${re}`);
      const ph = rooms.find((a) => a.role === "pharmroom");
      if (!ph || ph.locked !== "vault" || !m.lockedDoors.some((d) => d.area === ph.id)) err("pharmacy", `${tag} ${ph ? ph.locked : "none"}`);
      const safe = m.containers.find((c) => c.kind === "drugsafe");
      if (!safe || safe.lockKind !== "drugs") err("pharmacy", `${tag} drug safe ${safe ? safe.lockKind : "none"}`); else safes++;
      if (!m.containers.some((c) => c.kind === "ambulance" && c.w && c.h)) err("ambulance", tag);
    }
    for (const a of rooms) {
      const ks = kindsIn(a), g = grids[a.f].cells;
      if (key === "vet" && a.role === "storage" && /stalls/i.test(a.name)) continue; // a country vet's barn: the old furnishing
      for (const any of SIG[a.role] || []) if (!any.some((k) => ks.has(k))) err("signature", `${tag} ${a.name} (${a.role}) has no ${any.join(" or ")}`);
      // Every bed with its stand beside it (a hospital bed: a nightstand or an IV stand; an ER gurney: its IV stand).
      const pieces = new Map();
      for (const [x, y, c] of cellsIn(a)) {
        const d = pieceDef(c.k);
        if (!d) continue;
        const id = c.pc ? `p${c.pc}` : `${x},${y}`;
        if (!pieces.has(id)) pieces.set(id, { k: c.k, cells: [] });
        pieces.get(id).cells.push([x, y]);
      }
      for (const p of pieces.values()) {
        const want = p.k === "hospbed" ? ["nightstand", "ivstand"] : p.k === "gurney" && a.role === "er" ? ["ivstand"] : null;
        if (!want) continue;
        if (p.k === "hospbed") beds++; else gurneys++;
        const by = p.cells.some(([x, y]) => NEAR4.some(([dx, dy]) => want.includes(g[(y + dy) * m.w + x + dx].k)));
        if (!by) err("stand", `${tag} ${a.name} ${p.k} at ${p.cells[0]}`);
      }
      // The containers are exactly the lootable pieces (the ambulance its own).
      const loot = [...pieces.values()].filter((p) => pieceDef(p.k).loot);
      const boxes = m.containers.filter((c) => c.area === a.id && c.kind !== "ambulance");
      const covered = (p) => boxes.some((b) => b.kind === p.k && p.cells.every(([x, y]) => x >= b.x && x < b.x + (b.w || 1) && y >= b.y && y < b.y + (b.h || 1)));
      if (MEDICAL_STYLES[a.role] && (loot.length !== boxes.length || !loot.every(covered))) err("containers", `${tag} ${a.name}: pieces ${loot.map((p) => p.k)} boxes ${boxes.map((b) => b.kind)}`);
      // A hospital's corridors 2 wide, their parked pieces along one wall only.
      if (key === "hospital" && a.role === "corridor") {
        const iw = a.w - 2, ih = a.h - 2;
        if (Math.min(iw, ih) < 2) err("corridor", `${tag} ${a.name} ${iw}x${ih}`);
        const rows = new Set(cellsIn(a).filter(([, , c]) => pieceDef(c.k)).map(([x, y]) => (iw >= ih ? y : x)));
        if (rows.size > 1) err("corridor", `${tag} ${a.name}: pieces along ${rows.size} walls`);
      }
    }
    // Every room's doors reachable from the stairs on every floor (or from the front door on a one-storey building).
    grids.forEach((F, f) => {
      const st = (m.stairs || []).find(([x, y]) => F.cells[y * m.w + x].k === "stairs");
      const from = st || (f === 0 ? [m.front.x, m.front.y] : null);
      if (!from) return;
      const seen = walkFrom(m, from[0], from[1], true, F.cells);
      for (const a of rooms.filter((r) => r.f === f)) for (const [x, y] of a.doors || []) if (!seen[y * m.w + x]) err("reach", `${tag} floor ${f} ${a.name} door ${x},${y}`);
    });
  }
  // The hospital's scenes (interiorscenes.js) over 60 hospitals of their own (they shove pieces and seal doors).
  for (let s = 0; s < 60; s++) {
    const rng = new Rng(61000 + s * 7919);
    const m = assemble(rng, BUILDINGS.hospital.make(rng, {}), { key: "hospital", name: "hospital" });
    const sc = rollScenes(m, new Rng(700 + s), "hospital");
    for (const x of (sc && sc.list) || []) { scenes[x.kind] = (scenes[x.kind] || 0) + 1; if (x.kind === "morgue") rise += x.rise || 0; }
  }
  for (const [what, label] of [["rooms", "a hospital's rooms by name on their floors"], ["signature", "every room has its signature pieces"], ["stand", "every bed has a nightstand or an IV stand beside it, every ER gurney its IV stand"], ["corridor", "a hospital's corridors 2 wide, the parked pieces on one wall"], ["pharmacy", "the pharmacy's steel door locked, its drug safe locked"], ["ambulance", "the ambulance in its bay, a container of its own"], ["reach", "every room's doors reachable from the stairs on every floor"], ["containers", "the containers are exactly the lootable pieces"]]) {
    check(!errs[what], `${label} (${built} buildings, ${beds} beds, ${gurneys} gurneys, ${safes} drug safes)${errs[what] ? `: ${errs[what].length} bad, e.g. ${errs[what].slice(0, 3).join("; ")}` : ""}`);
  }
  check(scenes.eroverrun > 0 && scenes.sealedward > 0 && scenes.morgue > 0 && rise > 0, `a hospital's scenes roll: ER overrun ${scenes.eroverrun || 0}, sealed ward ${scenes.sealedward || 0}, the morgue's dead ${scenes.morgue || 0} (${rise} rising)`);
  // The meds per building: the old layout (legacy) against the new over 200 seeded buildings (the expected meds of each
  // container's table, by its floor's richness), within ±10%.
  const meds = (def) => { const r = def.loot.meds; return r ? Math.min(0.95, r[0]) * ((r[1] + r[2]) / 2) : 0; };
  for (const key of ["hospital", "clinic", "vet"]) {
    const total = (legacy) => {
      let v = 0;
      const by = {};
      for (let s = 0; s < 200; s++) {
        const rng = new Rng(9000 + s * 104729 + 5);
        const m = assemble(rng, BUILDINGS[key].make(rng, { legacy }), { key, name: key, legacy, noDecor: true });
        for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (!a || !a.type) continue; const x = meds(boxLoot(a.type, c.kind)) * Math.min(FLOOR_RICH.cap, Math.pow(FLOOR_RICH.perFloor, c.f || 0)); v += x; by[a.role] = (by[a.role] || 0) + x; }
      }
      return { v: v / 200, by };
    };
    const before = total(true), after = total(false);
    check(Math.abs(after.v / before.v - 1) <= 0.1, `a ${key} holds the meds it did within ±10%: ${after.v.toFixed(1)} against ${before.v.toFixed(1)}`);
    if (key === "hospital") {
      const per = (role) => { const n = 200 * 1; return (after.by[role] || 0) / n; };
      const wardBox = (after.by.ward || 0) / Math.max(1, 200), pharm = per("pharmroom"), theatre = per("theatre");
      check(pharm > per("er") && theatre > per("er") && pharm > wardBox && theatre > wardBox, `the pharmacy (${pharm.toFixed(1)}) and the theatre (${theatre.toFixed(1)}) the richest rooms, the ER ${per("er").toFixed(1)}, all the wards together ${wardBox.toFixed(1)}`);
    }
  }
  // An older save keeps the old plan: no room of the new roles, no catalogue piece beyond the old kinds.
  const OLD = new Set(["shelf", "locker", "cabinet", "counter", "crate", "rack", "table", "bed", "bars", "hay", "barrel", "gunsafe"]);
  let newer = 0;
  for (const key of ["hospital", "clinic", "vet"]) for (let s = 0; s < 6; s++) {
    const rng = new Rng(800 + s);
    const m = assemble(rng, BUILDINGS[key].make(rng, { legacy: true }), { key, name: key, legacy: true, noDecor: true });
    for (const F of m.floors || [{ cells: m.cells }]) for (const c of F.cells) if (pieceDef(c.k) && !OLD.has(c.k)) newer++;
    for (const a of m.rooms) if (["er", "icu", "theatre", "morgue", "ambbay", "nursestation", "laundry", "staffroom"].includes(a.role)) newer++;
  }
  check(!newer, `an older save's hospital, clinic and vet keep the old plan (${newer} new rooms or pieces)`);
}

// ======================================================================================
console.log("\nCommercial buildings room by room (shoplayout.js)");
{
  const N = Math.max(SEEDS, 4);
  const errs = {};
  const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
  let built = 0, styled = 0;
  for (const key of COMMERCIAL_KEYS) for (let s = 0; s < N; s++) {
    const rng = new Rng(52000 + s * 7919 + key.length * 13);
    const m = assemble(rng, BUILDINGS[key].make(rng, {}), { key, name: key });
    const grids = m.floors || [{ cells: m.cells }];
    built++;
    for (const a of m.rooms.filter((r) => !r.outdoor)) {
      const g = grids[a.f].cells, doors = a.doors || [];
      if (styleName(a, key)) styled++;
      if (doors.length) {
        const seen = walkFrom(m, doors[0][0], doors[0][1], true, g);
        for (const [x, y] of doors) if (!seen[y * m.w + x]) err("doors", `${key} ${s} ${a.name} door ${x},${y}`);
        for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) if (g[y * m.w + x].k === "stairs" && !seen[y * m.w + x]) err("stairs", `${key} ${s} ${a.name}`);
      }
      const isDoor = (x, y) => ["idoor", "odoor", "door"].includes(g[y * m.w + x].k);
      for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) {
        const c = g[y * m.w + x];
        if (c.pc && pieceDef(c.k) && styleName(a, key) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isDoor(x + dx, y + dy))) err("doorway", `${key} ${s} ${a.name} ${c.k}`);
      }
    }
  }
  for (const [what, label] of [["doors", "every room's doors reachable from each other"], ["stairs", "the stairs reachable from the rooms' doors"], ["doorway", "no piece of 2+ cells on a door's front"]]) {
    check(!errs[what], `${label} (${built} commercial buildings, ${styled} rooms styled)${errs[what] ? `: ${errs[what].length} bad, e.g. ${errs[what].slice(0, 3).join("; ")}` : ""}`);
  }
}

// ======================================================================================
console.log("\nPolice stations, fire stations, schools and churches laid out for their kind (civiclayout.js)");
{
  const N = Math.max(SEEDS * 4, 24);
  const errs = {};
  const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let classes = 0, desks = 0, facing = 0, cellsN = 0, naves = 0;
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  for (const key of ["police", "firestation", "school", "church"]) for (let s = 0; s < N; s++) {
    const rng = new Rng(47000 + s * 7919 + key.length * 13);
    const m = assemble(rng, BUILDINGS[key].make(rng, {}), { key, name: key });
    const tag = `${key} ${s}`;
    const grids = m.floors || [{ cells: m.cells }];
    const rooms = m.rooms.filter((a) => !a.outdoor);
    const at = (f, x, y) => (x >= 0 && y >= 0 && x < m.w && y < m.h ? grids[f].cells[y * m.w + x] : null);
    const cellsIn = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y, at(a.f, x, y)]); return out; };
    const kinds = (a) => new Set(cellsIn(a).map(([, , c]) => c.k));
    const civ = (c) => rooms.filter((a) => a.civic === c);
    const need = (c, list, what) => { const rs = civ(c); if (!rs.length) err(`${c}-room`, tag); for (const a of rs) { const k = kinds(a); if (!list.every((q) => (Array.isArray(q) ? q.some((z) => k.has(z)) : k.has(q)))) err(what, `${tag} ${a.name}: ${[...k].join(",")}`); } };
    if (!rooms.every((a) => !a.civic || CIVIC_STYLES[a.civic])) err("style", tag);
    // Every room's doors (and the stairs) reachable from each other on its floor; the containers are the pieces.
    for (const a of rooms) {
      const g = grids[a.f].cells;
      if ((a.doors || []).length) {
        const seen = walkFrom(m, a.doors[0][0], a.doors[0][1], true, g);
        for (const [x, y] of a.doors) if (!seen[y * m.w + x]) err("doors", `${tag} ${a.name} door ${x},${y}`);
      }
      if (!a.civic) continue;
      const pieces = new Map();
      for (const [x, y, c] of cellsIn(a)) { const d = pieceDef(c.k); if (!d || !d.loot) continue; const id = c.pc ? `p${c.pc}` : `${x},${y}`; if (!pieces.has(id)) pieces.set(id, { k: c.k, cells: [] }); pieces.get(id).cells.push([x, y]); }
      const boxes = m.containers.filter((c) => c.area === a.id && !["engine", "ambulance", "policecar"].includes(c.kind));
      const covered = (p) => boxes.some((b) => b.kind === p.k && p.cells.every(([x, y]) => x >= b.x && x < b.x + (b.w || 1) && y >= b.y && y < b.y + (b.h || 1)));
      if (pieces.size !== boxes.length || ![...pieces.values()].every(covered)) err("containers", `${tag} ${a.name}: pieces ${[...pieces.values()].map((p) => p.k)} boxes ${boxes.map((b) => b.kind)}`);
    }
    if (key === "police") {
      need("frontdesk", ["counter"], "front desk: a counter");
      need("armory", ["gunrack", "locker"], "armory: gun racks and a locker");
      need("evidence", ["evlocker"], "evidence room: evidence lockers");
      need("chief", ["desk"], "chief's office: a desk");
      if (!civ("squad").some((a) => kinds(a).has("desk"))) err("squad room: desks", tag);
      // The cells: each cell door a cell door (DOOR_KINDS.cell) with bars beside it, a bunk, a toilet and a sink inside.
      const cells = [];
      for (const a of civ("cells")) for (const [x, y, c] of cellsIn(a)) if (c.cellDoor) cells.push([a, x, y, c]);
      if (cells.length < 2) err("cells: at least two", `${tag}: ${cells.length}`);
      for (const [a, x, y, c] of cells) {
        cellsN++;
        if (c.dk !== "cell") err("cell door", `${tag} ${x},${y} ${c.dk}`);
        if (![[1, 0], [-1, 0]].some(([dx]) => (at(a.f, x + dx, y) || {}).k === "bars")) err("cell bars", `${tag} ${x},${y}`);
        const [ix, iy] = c.cellIn, dy = iy - y, inner = [[ix, iy], [ix, iy + dy], [ix, iy + 2 * dy], [ix - 1, iy], [ix - 1, iy + dy], [ix - 1, iy + 2 * dy]].map(([px, py]) => (at(a.f, px, py) || {}).k);
        if (!inner.includes("bunk") || !inner.includes("toilet") || !inner.includes("sink")) err("cell: a bunk, a toilet and a sink", `${tag} ${x},${y}: ${inner}`);
      }
      // An interview room's one-way window into its observation nook.
      for (const a of civ("interview")) {
        const win = []; for (let y = a.y0; y < a.y0 + a.h; y++) for (let x = a.x0; x < a.x0 + a.w; x++) { const c = at(a.f, x, y); if (c && c.oneway && c.k === "window") win.push([x, y]); }
        if (!win.length) err("interview: a one-way window", `${tag} ${a.name}`);
        if (!kinds(a).has("table") || cellsIn(a).filter(([, , c]) => c.k === "chair").length < 2) err("interview: a table and two chairs", `${tag} ${a.name}`);
      }
      if (!m.containers.some((c) => c.kind === "policecar" && c.w * c.h >= 6)) err("sally port: a police car", tag);
    }
    if (key === "firestation") {
      for (const a of civ("enginebay")) {
        const roller = (m.exits || []).some((e) => e.roller && e.name === "Bay door"); // a roller door (a locked one is a locked door)
        const engine = m.containers.find((c) => c.area === a.id && c.kind === "engine");
        if (!roller) err("engine bay: a roller door", tag);
        if (!engine || engine.w * engine.h !== 10 || at(a.f, engine.x, engine.y).k !== "truck" || at(a.f, engine.x, engine.y).car.body !== "engine") err("engine bay: the fire engine (a truck of 2 × 5)", tag);
        if (!kinds(a).has("turnout")) err("engine bay: turnout lockers", tag);
      }
      need("fdorm", ["bunk"], "dorm: bunks");
      need("fkitchen", ["fridge", "stove", "sink"], "kitchen: fridge, stove, sink");
    }
    if (key === "school") {
      for (const a of civ("classroom")) {
        classes++;
        const k = kinds(a);
        if (!k.has("teacherdesk") || !k.has("schooldesk")) err("classroom: desks", `${tag} ${a.name}`);
        // The whiteboard's wall: every school desk faces it.
        const board = []; for (let y = a.y0; y < a.y0 + a.h; y++) for (let x = a.x0; x < a.x0 + a.w; x++) { const c = at(a.f, x, y); if (c && c.wart && c.wart.k === "whiteboard") board.push([x, y]); }
        const side = board.map(([x, y]) => (y === a.y0 ? "n" : y === a.y0 + a.h - 1 ? "s" : x === a.x0 ? "w" : "e"));
        for (const [, , c] of cellsIn(a)) if (c.k === "schooldesk") { desks++; if (side.includes(c.fc)) facing++; }
        if (!board.length) err("classroom: a whiteboard", `${tag} ${a.name}`);
      }
      need("schoolhall", ["schoollocker"], "corridor: lockers");
      need("gym", ["bleachers", "sportcage"], "gym: bleachers and a storage cage");
      need("cafeteria", ["counter", "table"], "cafeteria: a counter and tables");
      for (const a of civ("walkin")) if (!(a.doors || []).some(([x, y]) => (at(a.f, x, y) || {}).dk === "coldroom")) err("walk-in: a cold room door", `${tag}`);
    }
    if (key === "church") {
      for (const a of civ("nave")) {
        naves++;
        const pews = cellsIn(a).filter(([, , c]) => c.k === "pew"), altar = cellsIn(a).filter(([, , c]) => c.k === "altar");
        if (!altar.length || a.aisle == null) { err("nave: an altar", tag); continue; }
        const left = pews.filter(([x]) => x < a.aisle), right = pews.filter(([x]) => x > a.aisle);
        if (!left.length || !right.length) err("nave: pews in two columns", `${tag}: ${left.length} left, ${right.length} right`);
        if (pews.some(([, , c]) => c.fc !== "n")) err("nave: the pews face the altar", tag);
        const ay = Math.max(...altar.map(([, y]) => y));
        for (let y = ay + 1; y < a.y0 + a.h - 1; y++) { const c = at(a.f, a.aisle, y); if (!c || !CELL[c.k].walk) err("nave: a clear centre aisle", `${tag} ${a.aisle},${y} ${c && c.k}`); }
      }
      if (!rooms.some((a) => a.civic === "belltower" && a.up)) err("bell tower raised", tag);
    }
  }
  for (const [what, list] of Object.entries(errs)) check(false, `${what}: ${list.length} bad, e.g. ${list.slice(0, 3).join("; ")}`);
  check(!Object.keys(errs).length, `every civic building's rooms have their signature pieces, doors reachable, containers the pieces (${N} of each; ${cellsN} cells, ${classes} classrooms, ${naves} naves)`);
  check(desks > 0 && facing === desks, `every classroom's desks face its whiteboard wall (${facing} of ${desks})`);
  // Loot: the armory and the evidence room of a police station, and a whole school, over 200 seeded buildings: the old
  // layout (legacy) against the new, within ±10%.
  const total = (key, legacy, pick) => {
    let v = 0;
    for (let s = 0; s < 200; s++) {
      const rng = new Rng(9000 + s * 104729 + 5);
      const m = assemble(rng, BUILDINGS[key].make(rng, { legacy }), { key, name: key, legacy });
      for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type && pick(a)) v += value(boxLoot(a.type, c.kind)); }
    }
    return v / 200;
  };
  for (const [key, label, pick] of [["police", "the armory", (a) => a.role === "armory"], ["police", "the evidence room", (a) => a.role === "evidence"], ["school", "a school", () => true]]) {
    const before = total(key, true, pick), after = total(key, false, pick);
    check(Math.abs(after / before - 1) <= 0.1, `${label} holds what it did within ±10%: ${after.toFixed(1)} against ${before.toFixed(1)}`);
  }
  // An older save keeps the old layouts: no civic marks, none of the new pieces.
  let marks = 0, newKinds = 0;
  const NEW = new Set(["gunrack", "ammocab", "evlocker", "turnout", "schoollocker", "sportcage", "pew", "altar", "schooldesk", "teacherdesk", "bleachers", "cot", "candles"]);
  for (const key of ["police", "firestation", "school", "church"]) for (let s = 0; s < 6; s++) {
    const rng = new Rng(700 + s);
    const m = assemble(rng, BUILDINGS[key].make(rng, { legacy: true }), { key, name: key, legacy: true, noDecor: true });
    marks += m.rooms.filter((a) => a.civic).length;
    for (const F of m.floors || [{ cells: m.cells }]) for (const c of F.cells) if (NEW.has(c.k)) newKinds++;
  }
  check(!marks && !newKinds, `an older save's police station, fire station, school and church keep their old layouts (${marks} styled rooms, ${newKinds} new pieces)`);
  // The civic scenes (interiorscenes.js, registered by civiclayout.js): each turns up; a turned prisoner is one of the
  // dead that rises, behind a cell door that is a locked door of the map.
  const sw = createWorld({ seed: 11, factionCount: 2 }), stiles = sw.tiles.filter((t) => t.loc).slice(0, 4);
  const seenKinds = new Set();
  let turnedOk = true;
  for (const key of ["police", "school", "church"]) for (let i = 0; i < 30; i++) {
    const m = buildingMap(sw, stiles[i % stiles.length].id, { key, id: `${key}-${i}`, name: key }, false);
    for (const sc of (m.scenes && m.scenes.list) || []) {
      seenKinds.add(sc.kind);
      if (sc.kind !== "turned") continue;
      const c = (m.floors ? m.floors[sc.f].cells : m.cells)[sc.y * m.w + sc.x];
      const locked = m.lockedDoors.some((d) => d.x === sc.x && d.y === sc.y && (d.f || 0) === sc.f && d.dk === "cell");
      const risen = m.scenes.bodies.some((b) => b.sleeper && !b.human && b.x === c.cellIn[0] && b.y === c.cellIn[1]);
      if (c.k !== "door" || c.dk !== "cell" || !locked || !risen) turnedOk = false;
    }
  }
  const want = ["frontstand", "turned", "classbar", "gymshelter", "naveshelter", "pewdoors"];
  check(want.every((k) => seenKinds.has(k)), `the civic scenes turn up (${want.filter((k) => seenKinds.has(k)).join(", ")} of ${want.join(", ")})`);
  check(turnedOk, "a turned prisoner: one of the dead that rises, behind a locked cell door");
}

// ======================================================================================
console.log("\nHotels room by room (hotellayout.js): an inn, a business hotel, a resort, a city tower");
{
  const N = Math.max(SEEDS, 4);
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  const byKind = {};
  for (const kind of HOTEL.KINDS) {
    const ids = FRANCHISES.hotel.filter((f) => f.plan.hotel === kind).map((f) => f.id);
    const errs = [], rep = byKind[kind] = { maps: 0, w: [], h: [], storeys: [], rooms: [], boxes: [], loot: [], area: [] };
    for (let s = 0; s < N; s++) {
      const v = ids[s % ids.length];
      const rng = new Rng(61000 + s * 7919 + kind.length * 17);
      const spec = BUILDINGS.hotel.make(rng, { variant: v });
      let m;
      try { m = assemble(rng, spec, { key: "hotel", name: "Hotel", withVehicle: s % 2 === 1 }); } catch (e) { errs.push(`${v} ${s}: ${e.message}`); continue; }
      const tag = `${v} ${s}`;
      if (spec.hotel !== kind) errs.push(`${tag}: a ${spec.hotel}`);
      rep.maps++; rep.w.push(m.w); rep.h.push(m.h); rep.storeys.push(m.storeys);
      const grids = m.floors || [{ cells: m.cells }];
      const at = (f, x, y) => grids[f].cells[y * m.w + x];
      const inside = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push(at(a.f || 0, x, y).k); return out; };
      const rooms = m.rooms.filter((a) => !a.outdoor), shop = (k) => rooms.filter((a) => a.shop === k);
      // The map within its cap; every walkable cell reachable on every floor (from the front zone, upstairs the stairs).
      if (m.w > 200 || m.h > 200 || m.w > mapCap("hotel") || m.h > mapCap("hotel")) errs.push(`${tag}: map ${m.w}x${m.h}`);
      const z0 = m.zones[0];
      grids.forEach((F, f) => {
        const seen = f === 0 ? walkFrom(m, z0.x0 + 1, z0.y0 + (s % 2 === 1 ? 0 : 1)) : walkFrom(m, m.stairs[0][0], m.stairs[0][1], true, F.cells);
        let cut = 0;
        for (let i = 0; i < m.w * m.h; i++) if ((CELL[F.cells[i].k].walk || F.cells[i].k === "door") && !seen[i]) cut++;
        if (cut) errs.push(`${tag}: floor ${f}: ${cut} walkable cells cut off`);
        if (f > 0 && !m.stairs.every(([x, y]) => seen[y * m.w + x])) errs.push(`${tag}: floor ${f}: a stairwell cut off`);
      });
      // The lobby: the reception desk, the key rack, the safe (locked: cash and valuables).
      const lobby = shop("hotellobby").find((a) => (a.f || 0) === 0);
      if (!lobby || !inside(lobby).includes("frontdesk") || !inside(lobby).includes("keyrack")) errs.push(`${tag}: no reception desk and key rack in the lobby`);
      else if (!m.containers.some((c) => c.area === lobby.id && c.kind === "safe" && c.lockKind)) errs.push(`${tag}: no locked safe at the front desk`);
      // Guest floors: rooms of beds, each with its en suite bathroom (a toilet, a sink, a tub or a shower).
      const guest = shop("guestroom");
      if (guest.length < 1) errs.push(`${tag}: no guest rooms`);
      for (const r of guest) {
        if (!inside(r).includes("bed")) errs.push(`${tag}: ${r.name} has no bed`);
        const bath = rooms.find((a) => a.shop === "ensuite" && a.unit && a.unit === r.unit);
        if (!bath) { errs.push(`${tag}: ${r.name} has no en suite`); continue; }
        const k = inside(bath);
        if (!k.includes("toilet") || !k.includes("sink") || !(k.includes("bathtub") || k.includes("shower"))) errs.push(`${tag}: ${bath.name} lacks a toilet, a sink or a tub (${[...new Set(k)].join(" ")})`);
      }
      // Housekeeping (and the ice nook) on every guest floor.
      const guestFloors = [...new Set(guest.map((r) => r.f || 0))];
      for (const f of guestFloors) {
        if (!shop("housekeeping").some((a) => (a.f || 0) === f)) errs.push(`${tag}: floor ${f} has no housekeeping`);
        else if (!shop("housekeeping").some((a) => (a.f || 0) === f && inside(a).includes("linencart"))) errs.push(`${tag}: floor ${f}'s housekeeping has no linen cart`);
      }
      // Two stair runs at 6+ floors (every big hotel has two), on every floor.
      if ((m.storeys >= 6 || kind !== "inn") && (m.runs || []).filter((r) => !r.single).length < 2) errs.push(`${tag}: ${m.storeys} storeys, ${(m.runs || []).length} stair runs`);
      // Back of house: the laundry (washers, dryers), the kitchen and its walk-in.
      const laundry = shop("hotellaundry");
      if (!laundry.length || !laundry.some((a) => inside(a).includes("washer") && inside(a).includes("dryer"))) errs.push(`${tag}: no laundry with washers and dryers`);
      if (!shop("galley").some((a) => inside(a).includes("range"))) errs.push(`${tag}: no kitchen with its range`);
      if (kind !== "inn" && !shop("walkin").length) errs.push(`${tag}: no walk-in cold room`);
      // The kind's own rooms.
      const need = { inn: ["parlour", "breakfast", "ownersflat"], business: ["hotelrestaurant", "conference", "bizcentre", "giftshop", "luggage", "liftlobby"], resort: ["ballroom", "spa", "hotelgym", "hotelrestaurant", "barroom", "liftlobby"], tower: ["penthouse", "barroom", "ballroom", "parking", "liftlobby", "hotelgym"] }[kind];
      for (const k of need) if (!shop(k).length) errs.push(`${tag}: no ${k}`);
      if (kind === "resort" && !["Pool deck", "Tennis court"].every((n) => m.rooms.some((a) => a.outdoor && a.name === n))) errs.push(`${tag}: no pool deck or tennis court in the grounds`);
      if (kind === "resort" && !m.cells.some((c) => c.f === "pool")) errs.push(`${tag}: the pool deck has no pool`);
      if (kind === "tower" && !shop("penthouse").some((a) => (a.f || 0) === m.storeys - 1)) errs.push(`${tag}: the penthouse is not on the top floor`);
      if (kind === "inn" && (guest.length < 10 || guest.length > 20)) errs.push(`${tag}: ${guest.length} rooms`);
      if (shop("liftlobby").length && !shop("liftlobby").every((a) => inside(a).includes("liftdoor"))) errs.push(`${tag}: a lift lobby with no lift doors`);
      // The loot (the containers' tables' worth).
      let worth = 0;
      for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type && AREAS[a.type]) worth += value(boxLoot(a.type, c.kind)); }
      rep.rooms.push(guest.length); rep.boxes.push(m.containers.length); rep.loot.push(worth); rep.area.push(spec.bw * spec.bh * m.storeys);
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0), rng2 = (a) => `${Math.min(...a)}–${Math.max(...a)}`;
    check(!errs.length, `${kind}: ${rep.maps} hotels (${ids.join(", ")}), maps ${rng2(rep.w)} × ${rng2(rep.h)}, ${rng2(rep.storeys)} storeys, ${rng2(rep.rooms)} rooms: lobby and reception, guest rooms with beds and en suites, housekeeping a floor, ${kind === "inn" ? "one stair run" : "two stair runs"}, laundry and kitchen, all connected, within 200 × 200${errs.length ? `: ${errs.length} bad, e.g. ${errs.slice(0, 4).join("; ")}` : ""}`);
    console.log(`    loot: ${avg(rep.boxes).toFixed(0)} containers, worth ${avg(rep.loot).toFixed(0)} (${(avg(rep.loot) / Math.max(1, avg(rep.area)) * 100).toFixed(1)} per 100 cells of floor)`);
  }
  // The hotel's scenes turn up (the map's own dice: buildingMap → rollScenes).
  const sw = createWorld({ seed: 13, factionCount: 2 }), stiles = sw.tiles.filter((t) => t.loc).slice(0, 4);
  const seenKinds = new Set();
  const vs = ["willowcreek", "interstate", "pinecrest", "caldergrand", "meridian", "harborview", "lakeshore", "oldmill"];
  for (let i = 0; i < 64; i++) {
    const m = buildingMap(sw, stiles[i % stiles.length].id, { key: "hotel", id: `hotel-${i}`, name: "Hotel", variant: vs[i % vs.length] }, false);
    for (const sc of (m.scenes && m.scenes.list) || []) seenKinds.add(sc.kind);
  }
  const want = ["hotelbarricade", "evaccentre", "lobbyoverrun", "penthouse"];
  check(want.every((k) => seenKinds.has(k)), `the hotel's scenes turn up (${want.filter((k) => seenKinds.has(k)).join(", ")} of ${want.join(", ")}; also ${[...seenKinds].filter((k) => !want.includes(k)).join(", ")})`);
}

console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(fails ? 1 : 0);
