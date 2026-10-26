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
//     scenes (an ER overrun, a sealed ward, the morgue's dead) roll; an older save keeps the old plan; since issue #36
//     every one of the kind's dozen plans (civicvariants.js) is built, pinned by its id: each keeps its kind's
//     signature rooms (a hospital's ER, wards and locked pharmacy, a clinic's or an infirmary's exam rooms and drug
//     cupboard, a vet's kennels), the floor-by-floor rooms checked on #14's own plan, the meds measured on it;
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
//     since issue #36 every one of the police station's, the fire station's and the church's dozen plans is built, each with
//     its kind's signature rooms (a nave and its altar in every church; a bell tower raised where a plan has one);
//   - footprint shapes (issue #23): every shaped building over many seeds keeps the rules (every walkable cell reached
//     on every floor, every part a door to another part or outside, windows and exits on outer walls, doors in walls,
//     the stairs in a part with every storey, containers reachable, no room across two parts, a lower part open air
//     above); half or more of the houses, schools, hospitals, churches and motels shaped (#36's kinds: their classic plan), an L, T or U among each; the
//     school a 50–70 × 34–46 box with two wings and a gym annex, 2–3 times the old floor; the loot by the floor; an
//     older save's rectangles cell for cell (save.js shapesLegacy); the neighbourhood's street still 3–5 houses;
//   - bunkers (bunkerlayout.js, issue #26): the military, mountain, government, shelter and prepper kinds each have
//     their signature rooms and pieces (the blast door, the airlock between two steel doors with its showers and hazmat
//     rack, the command centre, the barracks' bunks and footlockers, the genset, the pantry), no windows, the levels
//     named down, the Entrance level mostly rock, the stairs landing in the main tunnel, the escape hatch as a second
//     exit, every door reachable and the containers on their pieces; the loot per kind (the prepper's pantry the
//     richest food per area), the scenes, the POI rates on a world; every kind's twelve named plans (BUNKER_VARIANTS),
//     each built and checked, at least 12 distinct room lists a kind.
//   - military bases, air bases, airports, prisons laid out like the real thing (militarylayout.js, issue
//     #25): each building at its real size with its signature rooms and pieces (a footlocker by every bunk, an armory's
//     vault behind a locked vault door with weapon racks in rows, military vehicles in the motor pool's bays, a control
//     tower's cab on its top floor, a terminal's security lanes, gates and check-in, a prison's two tiers of cells, a
//     hangar's aircraft, a base's fence, towers and gatehouse, the HQ's
//     helipad), doors reachable, containers on their pieces; the loot at least what it was and no richer a square metre,
//     the armory the richest; an older save keeps its layouts; the sites (the air base's, a base's); air
//     bases on generated maps; the scenes; the crawl's checkpoint with its new pieces;
//   - hotels (hotellayout.js, issue #29), every kind (an inn, a business hotel, a resort, a tower) over its franchises'
//     seeds: the lobby with its reception desk, key rack and locked safe; guest floors of rooms each with a bed and its
//     en suite bathroom (a toilet, a sink, a tub or a shower); housekeeping on every guest floor; two stair runs at 6+
//     floors (every big hotel has two); the laundry and the kitchen (and its walk-in) back of house; every walkable cell
//     reachable on every floor; the map within 200 × 200; an inn's 10–20 rooms; the loot of each kind, reported.
//   - warehouses, factories and labs (industrylayout.js, issue #37): every one of their plans pinned is reached from the
//     front and up its stairs, nothing cut off, with its signature pieces (tools/industryvarianttest.js goes further).
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
import { SCHOOL_VARIANTS, BUILDINGS, SITES, assemble, siteBuildings, buildingMap, buildingOptions, placeOccupantGroups, windowsNear, BMAP, runSteps, runLandings } from "../src/sim/buildingmaps.js";
import { HOME_STYLES, HOME_KEYS, MEDICAL_STYLES, MED_KEYS } from "../src/sim/roomlayout.js";
import { rollScenes } from "../src/sim/interiorscenes.js";
import { COMMERCIAL_KEYS, styleName } from "../src/sim/shoplayout.js";
import { CIVIC_STYLES } from "../src/sim/civiclayout.js";
import { MIL_KEYS, MILITARY_STYLES, MIL_SIZE } from "../src/sim/militarylayout.js";
import { CAMPUS_KEYS } from "../src/sim/campuslayout.js";
import { BUNKER_STYLES, BUNKER_KEYS, BUNKER_VARIANTS } from "../src/sim/bunkerlayout.js"; // bunkers (issue #26)
import { INDUSTRY_KEYS, plansOf } from "../src/sim/industrylayout.js"; // warehouses, factories and labs (issue #37)
import { BUNKER_POI, POI } from "../src/sim/pois.js";
import { VARIANTS } from "../src/sim/civicvariants.js"; // a dozen plans each for the civic and medical kinds (issue #36)
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
const BS_QUICK = !!process.env.BS_QUICK; // runtests.js --quick: fewer seeded buildings for the loot comparisons
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
      let m, spec;
      try {
        const rng = new Rng(1000 + s * 7919 + key.length * 31);
        spec = BUILDINGS[key].make(rng);
        m = assemble(rng, spec, { key, name: BUILDINGS[key].name, withVehicle: s % 2 === 1 });
      } catch (e) { bad++; console.log(`  ${key} seed ${s}: ${e.stack}`); continue; }
      const W = m.w, H = m.h;
      sizes[key].push(`${W}x${H}`);
      const errs = [];
      const cap = mapCap(key); // a hotel's map up to 200 × 200 (its grounds round it, issue #29)
      const huge = spec.foot === "huge" || spec.foot === "xl" || (m.building && m.building.w >= 50); // a bunker at real-world scale (bunkerlayout.js BUNKER.SIZE, issue #26); the supermarket since issue #22: past the largest size class, its map its footprint and margins
      if (W < 14 || H < 14 || (MIL_KEYS.has(key) || CAMPUS_KEYS.has(key) || key === "campus" ? W > 300 || H > 300 : W > (cap || (huge ? m.building.w + 12 : 44)) || H > (cap || (huge ? m.building.h + 16 : 34)))) errs.push(`size ${W}x${H}`); // issue #25: the military buildings at their real size (the maps up to 300 × 300, #24)
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
        // Next to a container is next to any of its cells (combat.js nearBox: a car of 2 × 4 is searched from any side).
        const cw = c.w || 1, ch = c.h || 1;
        let near = false;
        for (let y = c.y - 1; y <= c.y + ch && !near; y++) for (let x = c.x - 1; x <= c.x + cw; x++) { if (x >= c.x && x < c.x + cw && y >= c.y && y < c.y + ch) continue; if (x >= 0 && y >= 0 && x < W && y < H && CELL[grid[y * W + x].k].walk && rf[y * W + x]) { near = true; break; } }
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
  // Every plan of the kind (civicvariants.js, issue #36), pinned by its id: the first (#14's) N times, the others a few.
  const runs = (keys, n) => keys.flatMap((key) => (VARIANTS[key] || [{ id: null }]).flatMap((v, vi) => Array.from({ length: vi === 0 ? n : Math.max(3, Math.ceil(n / 8)) }, (_, s) => [key, v.id, vi, s])));
  const MED_SIG = { hospital: ["er", "ward", "pharmroom"], clinic: ["exam", "pharmroom"], infirmary: ["exam", "pharmroom"], vet: ["cells"] };
  for (const [key, layout, vi, s] of runs(["hospital", "clinic", "infirmary", "vet"], N)) {
    const rng = new Rng(52000 + s * 7919 + key.length * 31 + vi * 104729);
    const m = assemble(rng, BUILDINGS[key].make(rng, { plan: layout }), { key, name: key });
    const grids = m.floors || [{ cells: m.cells }];
    const rooms = m.rooms.filter((a) => !a.outdoor);
    const tag = `${key}.${layout} ${s}`;
    for (const r of MED_SIG[key]) if (!rooms.some((a) => a.role === r)) err("plans", `${tag}: no ${r}`);
    built++;
    const cellsIn = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y, grids[a.f].cells[y * m.w + x]]); return out; };
    const kindsIn = (a) => new Set(cellsIn(a).map(([, , c]) => c.k));
    // The rooms by name on their floors (a hospital).
    if (key === "hospital") {
      const top = m.storeys - 1;
      if (layout === "general") for (const [onF, role, re] of FLOORS) for (let f = 0; f <= top; f++) if (onF(f, top) && !rooms.some((a) => a.f === f && a.role === role && re.test(a.name))) err("rooms", `${tag} floor ${f}: no ${role} ${re}`); // #14's plan floor by floor
      const ph = rooms.find((a) => a.role === "pharmroom");
      if (!ph || ph.locked !== "vault" || !m.lockedDoors.some((d) => d.area === ph.id)) err("pharmacy", `${tag} ${ph ? ph.locked : "none"}`);
      const safe = m.containers.find((c) => c.kind === "drugsafe");
      if (!safe || safe.lockKind !== "drugs") err("pharmacy", `${tag} drug safe ${safe ? safe.lockKind : "none"}`); else safes++;
      if (rooms.some((a) => a.role === "ambbay") && !m.containers.some((c) => c.kind === "ambulance" && c.w && c.h)) err("ambulance", tag); // a plan with an ambulance bay
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
  for (const [what, label] of [["plans", "every plan keeps its kind's signature rooms"], ["rooms", "a hospital's rooms by name on their floors"], ["signature", "every room has its signature pieces"], ["stand", "every bed has a nightstand or an IV stand beside it, every ER gurney its IV stand"], ["corridor", "a hospital's corridors 2 wide, the parked pieces on one wall"], ["pharmacy", "the pharmacy's steel door locked, its drug safe locked"], ["ambulance", "the ambulance in its bay, a container of its own"], ["reach", "every room's doors reachable from the stairs on every floor"], ["containers", "the containers are exactly the lootable pieces"]]) {
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
        const m = assemble(rng, BUILDINGS[key].make(rng, legacy ? { legacy } : { plan: VARIANTS[key][0].id }), { key, name: key, legacy, noDecor: true }); // #14's plan (every plan's meds by area: tools/variantcivictest.js)
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
  // Every plan of the kind (civicvariants.js, issue #36), pinned by its id: the first (#15's) N times, the others a few.
  const plans = ["police", "firestation", "school", "church"].flatMap((key) => (VARIANTS[key] || [{ id: null }]).flatMap((v, vi) => Array.from({ length: vi === 0 ? N : Math.max(3, Math.ceil(N / 8)) }, (_, s) => [key, v.id, vi, s])));
  for (const [key, layout, vi, s] of plans) {
    const rng = new Rng(47000 + s * 7919 + key.length * 13 + vi * 104729);
    const m = assemble(rng, BUILDINGS[key].make(rng, layout ? { plan: layout } : {}), { key, name: key });
    const tag = `${key}${layout ? `.${layout}` : ""} ${s}`;
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
      if (!civ("nave").length) err("nave: a nave", tag);
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
      if ((layout === "general" || rooms.some((a) => a.civic === "belltower")) && !rooms.some((a) => a.civic === "belltower" && a.up)) err("bell tower raised", tag); // #15's plan has one; another plan's where it has one
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
      const m = assemble(rng, BUILDINGS[key].make(rng, legacy ? { legacy } : VARIANTS[key] ? { plan: VARIANTS[key][0].id } : {}), { key, name: key, legacy }); // #15's plan (every plan's loot by area: tools/variantcivictest.js)
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
  for (const key of ["police", "school", "church"]) for (let i = 0; i < (key === "police" ? 30 : 60); i++) { // a church's pewdoors comes up about one map in 14: 60 of them (issue #24's real-size churches drew a run of 30 without it); a school's gymshelter one in 10 (issue #23's one-room schoolhouse has no gym)
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
console.log("\nFootprint shapes: buildings that are not boxes (issue #23)");
{
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DOORS = new Set(["idoor", "odoor", "door"]);
  const SEEDN = Math.max(40, SEEDS * 10);
  const shapedKeys = Object.keys(BUILDINGS).filter((k) => !BUILDINGS[k].street && k !== "deptstore"); // the department store stays a box
  const errs = {};
  const bad = (what, eg) => { (errs[what] = errs[what] || []).push(eg); };
  const kinds = {};
  let shapedN = 0, partsN = 0;
  const inPart = (p, x, y) => x >= p.x0 && x < p.x0 + p.w && y >= p.y0 && y < p.y0 + p.h;
  const edgeOf = (p, x, y) => inPart(p, x, y) && (x === p.x0 || y === p.y0 || x === p.x0 + p.w - 1 || y === p.y0 + p.h - 1);
  for (const key of shapedKeys) for (let s = 0; s < SEEDN; s++) {
    const rng = new Rng(23000 + s * 104729);
    const spec = BUILDINGS[key].make(rng, { shapes: true });
    const m = assemble(rng, spec, { key, name: key });
    const B = m.building;
    if (!B.parts) continue;
    shapedN++; partsN += B.parts.length;
    (kinds[key] = kinds[key] || {})[B.shape] = ((kinds[key] || {})[B.shape] || 0) + 1;
    const eg = `${key} #${s}`;
    for (const p of B.parts) for (const q of B.parts) if (p !== q) for (let y = p.y0; y < p.y0 + p.h; y++) for (let x = p.x0; x < p.x0 + p.w; x++) if (inPart(q, x, y) && !(edgeOf(p, x, y) && edgeOf(q, x, y))) bad("two parts overlap past a shared wall", eg);
    m.floors.forEach((F, f) => {
      const cells = F.cells, W = m.w, H = m.h, at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? cells[y * W + x] : null);
      const out = (c) => !c || c.f !== "floor";
      // Every walkable cell reachable (the ground from the front zone, a floor up from its stairs).
      const [sx, sy] = f === 0 ? [m.zones[0].x0 + 1, m.zones[0].y0 + 1] : m.stairs[0];
      const seen = walkFrom(m, sx, sy, true, cells);
      for (let i = 0; i < W * H; i++) if (CELL[cells[i].k] && CELL[cells[i].k].walk && cells[i].k !== "vehicle" && !seen[i]) { bad("every walkable cell reachable", `${eg} floor ${f}`); break; }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = cells[y * W + x];
        if ((c.k === "window" || c.k === "smashed") && !c.oneway && !N4.some(([dx, dy]) => out(at(x + dx, y + dy)))) bad("windows on outer walls only", `${eg} floor ${f} at ${x},${y}`);
        if (DOORS.has(c.k) && c.f === "floor" && !c.cellDoor) { // doors only in walls (a cell's own door stands in its bars: civiclayout.js)
          const wl = (q) => !!q && (q.k === "wall" || q.k === "bars" || q.k === "window" || DOORS.has(q.k));
          if (!((wl(at(x - 1, y)) && wl(at(x + 1, y))) || (wl(at(x, y - 1)) && wl(at(x, y + 1))))) bad("doors only in walls", `${eg} floor ${f} at ${x},${y}`);
        }
      }
      // Every part on this floor has a door to another part or to the outside (upstairs: or the stairs); a part with
      // fewer storeys is open air above.
      for (const p of B.parts) {
        if (p.storeys <= f) {
          for (let y = p.y0 + 1; y < p.y0 + p.h - 1; y++) for (let x = p.x0 + 1; x < p.x0 + p.w - 1; x++) if (B.parts.filter((q) => inPart(q, x, y)).length === 1 && at(x, y).k !== "void") { bad("a lower part is open air above", `${eg} floor ${f}`); y = Infinity; break; }
          continue;
        }
        let ok = f > 0 && m.stairs.some(([x, y]) => inPart(p, x, y));
        for (let y = p.y0; y < p.y0 + p.h && !ok; y++) for (let x = p.x0; x < p.x0 + p.w && !ok; x++) {
          if (!edgeOf(p, x, y) || !(DOORS.has(at(x, y).k) || at(x, y).k === "smashed")) continue;
          for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy, n = at(nx, ny); if (n && !inPart(p, nx, ny) && (out(n) || B.parts.some((q) => q !== p && q.storeys > f && inPart(q, nx, ny) && !edgeOf(q, nx, ny)))) ok = true; }
        }
        if (!ok) bad("every part has a door to another part or outside", `${eg} floor ${f} ${p.name}`);
      }
    });
    // No room straddles two parts; the stair runs inside a part with every storey; the exits on outer walls; every
    // container next to a walkable cell.
    for (const r of m.rooms) if (!r.outdoor) { const p = B.parts[r.part]; if (!p || r.x0 < p.x0 || r.y0 < p.y0 || r.x0 + r.w > p.x0 + p.w || r.y0 + r.h > p.y0 + p.h) bad("no room straddles two parts", `${eg} ${r.name}`); }
    // Every room whole: its doors' and stairs' cells reach each other inside it (a car or a piece never cuts it in two).
    for (const r of m.rooms) {
      if (r.outdoor) continue;
      const cells = m.floors[r.f || 0].cells, inR = (x, y) => x > r.x0 && y > r.y0 && x < r.x0 + r.w - 1 && y < r.y0 + r.h - 1, ok = (x, y) => inR(x, y) && CELL[cells[y * m.w + x].k] && (CELL[cells[y * m.w + x].k].walk || cells[y * m.w + x].k === "door");
      const goal = [];
      for (const [dx0, dy0] of r.doors || []) for (const [dx, dy] of N4) if (ok(dx0 + dx, dy0 + dy)) goal.push((dy0 + dy) * m.w + dx0 + dx);
      for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (cells[y * m.w + x].k === "stairs") goal.push(y * m.w + x);
      if (goal.length < 2) continue;
      const seen = new Set([goal[0]]), q = [goal[0]];
      while (q.length) { const i = q.pop(), x = i % m.w, y = (i / m.w) | 0; for (const [dx, dy] of N4) { const j = (y + dy) * m.w + x + dx; if (!seen.has(j) && ok(x + dx, y + dy)) { seen.add(j); q.push(j); } } }
      if (!goal.every((i) => seen.has(i))) bad("every room whole (its doors and stairs reach each other inside it)", `${eg} ${r.name}`);
    }
    for (const r of m.runs || []) for (const [x, y] of [...runSteps(r), ...runLandings(r)]) if (!B.parts.some((p) => p.storeys >= m.storeys && x > p.x0 && y > p.y0 && x < p.x0 + p.w - 1 && y < p.y0 + p.h - 1)) bad("the stairs inside a part with every storey", eg);
    for (const e of m.exits) for (const [x, y] of e.cells) if (!N4.some(([dx, dy]) => { const n = m.cells[(y + dy) * m.w + x + dx]; return n && n.f !== "floor"; })) bad("exits on outer walls", `${eg} ${e.name}`);
    for (const z of m.zones) if (!(z.x0 === 0 || z.y0 === 0 || z.x0 + z.w === m.w || z.y0 + z.h === m.h)) bad("the exits' zones at the map's edge", eg);
    for (const c of m.containers) {
      const cells = m.floors[c.f || 0].cells;
      let ok = false;
      for (let y = c.y - 1; y <= c.y + (c.h || 1); y++) for (let x = c.x - 1; x <= c.x + (c.w || 1); x++) { const q = cells[y * m.w + x]; if (q && CELL[q.k] && CELL[q.k].walk) ok = true; }
      if (!ok) bad("containers next to a walkable cell", `${eg} ${c.label}`);
    }
  }
  for (const [what, list] of Object.entries(errs)) check(false, `${what}: ${list.length} bad, e.g. ${list.slice(0, 3).join("; ")}`);
  check(!Object.keys(errs).length && shapedN > 0, `every shaped building keeps the rules (${shapedN} buildings of ${shapedKeys.length} kinds, ${partsN} parts, ${SEEDN} seeds each): every walkable cell reachable on every floor, every part a door out, windows and exits on outer walls, doors in walls, stairs in a part with every storey, containers reachable, no room across two parts and every room whole, lower parts open air above`);
  // Which buildings are shaped, and how: over 200 seeds (the spec's dice only), at least half of the new houses,
  // schools, hospitals, churches and motels are not plain rectangles, and an L, a T or a U turns up for each.
  const share = {};
  const CLASSIC = new Set(["police", "firestation", "hospital", "church"]); // issue #36's dozen plans a kind: the classic plan ("general") is the shaped one
  for (const key of ["house", "school", "hospital", "church", "motel", "police", "firestation", "offices", "apartments", "grocery", "gasstation"]) {
    const t = { n: 0, shaped: 0, kinds: {} };
    for (let s = 0; s < 200; s++) { const sp = BUILDINGS[key].make(new Rng(31000 + s * 7919), { shapes: true, ...(CLASSIC.has(key) ? { plan: "general" } : {}) }); t.n++; if (sp.shape) { t.shaped++; t.kinds[sp.shape.kind] = (t.kinds[sp.shape.kind] || 0) + 1; } }
    share[key] = t;
  }
  const line = (k) => `${k} ${share[k].shaped}/${share[k].n} (${Object.entries(share[k].kinds).map(([q, n]) => `${q} ${n}`).join(", ")})`;
  for (const key of ["house", "school", "hospital", "church", "motel"]) check(share[key].shaped >= share[key].n / 2 && ["L", "T", "U"].some((q) => share[key].kinds[q] > 0), `half or more shaped, an L, T or U among them: ${line(key)}`);
  const sm = { n: 0, shaped: 0 };
  for (let s = 0; s < 40; s++) { sm.n++; if ((BUILDINGS.supermarket.make(new Rng(32000 + s * 7919), { shapes: true }).shape || {}).kind === "notch") sm.shaped++; }
  check(sm.shaped === sm.n, `a supermarket's receiving dock an annex, its entrance's corner notched (${sm.shaped} of ${sm.n})`);
  check(share.police.kinds.L === share.police.n && share.firestation.kinds.annex === share.firestation.n && share.apartments.shaped > 0 && share.grocery.kinds.stepped > 0 && share.gasstation.kinds.annex > 0,
    `a police station an L (its sally port), a fire station's engine bay an annex, flats an L at times, a shop's back stepped: ${["police", "firestation", "apartments", "grocery", "gasstation"].map(line).join("; ")}`);
  // The school: a 50–70 × 34–46 box, two wings or more and a gym annex, its floors 2–3 times the old school's.
  const area = (m, f0) => { let n = 0; for (const F of f0 ? [m.floors[0]] : m.floors) for (const c of F.cells) if (c.f === "floor") n++; return n; };
  let sOk = 0, foot = 0, floorsNew = 0, floorsOld = 0, footOld = 0;
  const S = 60;
  for (let s = 0; s < S; s++) {
    const rng = new Rng(41000 + s * 7919), spec = BUILDINGS.school.make(rng, { shapes: true, plan: "highschool" }), m = assemble(rng, spec, { key: "school", name: "School", noDecor: true });
    const P = spec.shape.parts;
    if (spec.bw >= 50 && spec.bw <= 80 && spec.bh >= 34 && spec.bh <= 46 && P.filter((p) => p.wing).length >= 2 && P.some((p) => p.gym && p.storeys === 1 && p.tall)) sOk++;
    foot += area(m, true); floorsNew += area(m, false);
    const r2 = new Rng(41000 + s * 7919), m2 = assemble(r2, BUILDINGS.school.make(r2, {}), { key: "school", name: "School", noDecor: true });
    footOld += area(m2, true); floorsOld += area(m2, false);
  }
  check(sOk === S, `every suburban high school (the school's biggest plan) a 50–80 × 34–46 box (its auditorium past the issue's 70: a school at real size, 60–120 m) with two wings or more and a gym annex of one tall storey (${sOk} of ${S})`);
  const ratio = floorsNew / floorsOld;
  check(ratio >= 2 && ratio <= 3, `a school's floors (every storey) ${ratio.toFixed(2)} times the old school's (${Math.round(floorsNew / S)} cells against ${Math.round(floorsOld / S)}; its footprint ${(foot / footOld).toFixed(2)} times)`);
  // The school's dozen plans (SCHOOL_VARIANTS, the user's request 2026-10-25: "a dozen varients per building type"):
  // each built when pinned, named on the map's plan, laid out from its own room list (no two alike), every one keeping
  // the shape rules above; each setting's dice reach the plans it weighs, all twelve over the three settings.
  const lootVal = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  const vOk = [], vRooms = new Map(), vLoot = [];
  for (const v of SCHOOL_VARIANTS) {
    let ok = true, val = 0, cellsN = 0;
    const names = new Set();
    for (let s = 0; s < 12; s++) {
      const rng = new Rng(43000 + s * 7919), spec = BUILDINGS.school.make(rng, { shapes: true, plan: v.id }), m = assemble(rng, spec, { key: "school", name: "School", noDecor: true });
      if (spec.vid !== v.id || m.plan.variant !== v.name || !m.building.parts || !m.rooms.some((r) => r.role === "classroom")) ok = false;
      for (const r of m.rooms) if (!r.outdoor) names.add(r.name.replace(/ \d+$/, ""));
      for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type) val += lootVal(boxLoot(a.type, c.kind)); }
      cellsN += area(m, false);
    }
    if (ok) vOk.push(v.id);
    vRooms.set(v.id, [...names].sort().join("|"));
    vLoot.push(`${v.name} ${(val / 12).toFixed(0)} (${((val / cellsN) * 100).toFixed(1)}/100 cells)`);
  }
  check(vOk.length === SCHOOL_VARIANTS.length && SCHOOL_VARIANTS.length >= 12, `the school's ${SCHOOL_VARIANTS.length} plans each built when pinned, named, shaped, with classrooms (${vOk.length} ok)`);
  check(new Set(vRooms.values()).size === SCHOOL_VARIANTS.length, `no two school plans share their room list (${new Set(vRooms.values()).size} distinct)`);
  const seenV = new Set();
  for (const setting of ["rural", "town", "city"]) for (let s = 0; s < 300; s++) seenV.add(BUILDINGS.school.make(new Rng(44000 + s * 7919), { shapes: true, setting }).vid);
  check(seenV.size === SCHOOL_VARIANTS.length, `every school plan turns up by the settings' dice (${seenV.size} of ${SCHOOL_VARIANTS.length})`);
  console.log(`    the plans' loot: ${vLoot.join("; ")}`);
  // The loot: room by room as before (#14, #15, #16's styles), so a building holds what it did where its floor is about
  // the same (within ±10%) and more where it grew: the school by its area (reported per 100 cells of floor).
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  const lootOf = (key, shapes, n = 120, more = {}) => {
    let v = 0, cellsN = 0;
    for (let s = 0; s < n; s++) {
      const rng = new Rng(9000 + s * 104729 + 5), m = assemble(rng, BUILDINGS[key].make(rng, { shapes, ...more, ...(["police", "firestation", "hospital", "church"].includes(key) ? { plan: "general" } : {}) }), { key, name: key, noDecor: true });
      for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type) v += value(boxLoot(a.type, c.kind)); }
      cellsN += area(m, false);
    }
    return { v: v / n, cells: cellsN / n };
  };
  const rows = [];
  for (const key of ["house", "police", "firestation", "hospital", "gasstation", "supermarket"]) {
    const a = lootOf(key, false, key === "supermarket" ? 30 : 120), b = lootOf(key, true, key === "supermarket" ? 30 : 120);
    rows.push(`${key} ${b.v.toFixed(1)} against ${a.v.toFixed(1)}`);
    check(Math.abs(b.v / a.v - 1) <= 0.1, `a shaped ${key} holds what it did within ±10%: ${b.v.toFixed(1)} against ${a.v.toFixed(1)} (its floor ${b.cells.toFixed(0)} cells against ${a.cells.toFixed(0)})`);
  }
  const so = lootOf("school", false), sn = lootOf("school", true, 120, { plan: "highschool" }); // the issue's big school: the suburban high school
  const per = (x) => (x.v / x.cells) * 100;
  check(sn.v > so.v * 1.4 && Math.abs(per(sn) / per(so) - 1) <= 0.35, `the big school holds more by its floor: ${sn.v.toFixed(1)} against ${so.v.toFixed(1)} (${per(sn).toFixed(1)} against ${per(so).toFixed(1)} per 100 cells: its new floor is mostly classrooms and corridors of lockers)`);
  // Older saves: a building's spec seed gives the rectangle it always did (the roomsLegacy saves and those since #10
  // that came before the shapes: save.js shapesLegacy), the same map cell for cell as with no shapes asked.
  let same = 0, total = 0;
  for (const key of shapedKeys) for (let s = 0; s < 3; s++) for (const legacy of [true, false]) {
    const run = (o) => { const rng = new Rng(52000 + s * 7919); const m = assemble(rng, BUILDINGS[key].make(rng, o), { key, name: key, legacy }); return JSON.stringify({ c: m.floors.map((F) => F.cells), r: m.rooms, k: m.containers, d: m.lockedDoors }); };
    total++;
    if (run({ legacy, shapes: legacy }) === run({ legacy }) && !BUILDINGS[key].make(new Rng(52000 + s * 7919), { legacy, shapes: legacy }).shape) same++;
  }
  check(same === total, `an older save's buildings keep their rectangles, cell for cell (${same} of ${total}: every kind, legacy and since #10)`);
  const st = createWorld({ seed: 4343, factionCount: 2 });
  const old = JSON.parse(JSON.stringify(serializeState(st)));
  delete old.state.shapesV;
  const back = deserializeState(old), fresh = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  check(back.shapesLegacy === true && !fresh.shapesLegacy && st.shapesV === 1, "save.js: a save from before the shapes is marked shapesLegacy, a new world is not");
  const tile = st.tiles.find((t) => t.loc);
  const oldMap = buildingMap({ ...st, shapesLegacy: true }, tile.id, { id: "s1", key: "school", name: "School" }, false);
  const newMap = buildingMap(st, tile.id, { id: "s1", key: "school", name: "School" }, false);
  check(!oldMap.building.parts && !oldMap.plan.variant && newMap.building.parts && newMap.building.parts.length >= 2 && newMap.plan.variant, `a school at a site: the old save's the rectangle (${oldMap.building.w} × ${oldMap.building.h}), a new one's one of the dozen plans, shaped (${newMap.plan.variant}: ${newMap.building.shape}, ${newMap.building.w} × ${newMap.building.h}, ${newMap.w} × ${newMap.h} map)`);
  // The neighbourhood's street: 3–5 houses still, shaped ones among them, each fitting its plot, every cell reached.
  let streets = 0, shapedHouses = 0, houses = 0, streetBad = 0;
  for (let i = 0; i < 12; i++) {
    const m = buildingMap(st, st.tiles[i * 7].id, { id: `poi${i}:neighbourhood`, key: "neighbourhood", name: "Elm Street" }, false);
    streets++; houses += m.plan.houses.length; shapedHouses += m.buildings.filter((b) => b.parts).length;
    if (m.plan.houses.length < 3 || m.plan.houses.length > 5) streetBad++;
    const G = m.floors[0].cells.map((c) => (c.moved || c.k === "boarded" ? { ...c, k: "open" } : c)), seen = walkFrom(m, m.zones[0].x0 + 1, m.zones[0].y0 + 1, true, G); // the ground: the yards, the street and every house's ground floor (a scene's piece shoved into a doorway or its boards are a way through: shoved aside, torn down)
    for (let j = 0; j < m.w * m.h; j++) if (CELL[G[j].k] && CELL[G[j].k].walk && G[j].k !== "vehicle" && !seen[j]) { streetBad++; break; }
  }
  check(!streetBad && shapedHouses > 0, `a neighbourhood's street still holds 3–5 houses, every cell reached (${streets} streets, ${houses} houses, ${shapedHouses} of them shaped)`);
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

console.log("\nBunkers (bunkerlayout.js)");
{
  // Each kind's signature rooms (by their bunker mark) and pieces, no windows on any level, the second exit where the
  // plan has one, the levels named down, the Entrance level mostly rock, the stair runs landing in the main tunnel, the
  // containers the lootable pieces, the scenes; loot per kind reported; the POI rates against BUNKER_POI.
  const N = Math.max(SEEDS * 3, 12);
  const errs = {};
  const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  // The rooms every plan of a kind has (its variants differ in the rest: bunkerlayout.js BUNKER_VARIANTS); food: one of.
  const SIG = {
    milbunker: { rooms: ["portal", "airlock", "checkpoint", "hatch", "tunnel", "genroom"], bunks: ["barracks", "quarters"], food: ["rations"], power: "genset" },
    mountainbunker: { rooms: ["garage", "guardpost", "portal", "airlock", "checkpoint", "hatch", "tunnel", "command", "comms", "barracks", "quarters", "armory", "magazine", "mess", "kitchen", "rations", "medbay", "genroom", "waterstore", "stores", "latrine"], bunks: ["barracks"], food: ["rations"], power: "genset", levels: 3 },
    govbunker: { rooms: ["guardpost", "portal", "airlock", "checkpoint", "hatch", "tunnel", "genroom"], bunks: ["barracks"], food: ["rations"], power: "genset" },
    shelter: { rooms: ["stairhead", "tunnel", "genroom"], bunks: ["bunkhall"], food: ["rations", "rootcellar"], power: "genset" },
    prepper: { rooms: ["shed", "prepguns"], bunks: ["prepbunks"], food: ["preppantry", "rootcellar"], power: "batteries" },
  };
  const PIECES = { airlock: ["deconshower", "hazmatrack"], command: ["maptable", "radioconsole", "screens"], situation: ["maptable", "radioconsole"], comms: ["radioconsole"], barracks: [["bunk", "cot"], "footlocker"], genroom: ["genset"], waterstore: ["watertank"], rations: ["rationshelf"], armory: ["gunrack"], medbay: [["hospbed", "medcab"]], hatch: ["escapeladder"], bunkhall: [["bunk", "cot"]], preppantry: ["rationshelf"], prepguns: ["gunrack", "radioconsole", "batteries"], prepairlock: ["hazmatrack"], portal: [] };
  const loot = {}, sceneKinds = new Set(), sizes = {}, plans = {}, named = {};
  // Every kind's every plan (BUNKER_VARIANTS, by o.plan), a few seeds each, and the dice's own pick; the mountain bunker by its own.
  const runs = [];
  for (const key of BUNKER_KEYS) for (let p = 0; p < BUNKER_VARIANTS[key].length; p++) for (let s = 0; s < 3; s++) runs.push([key, p, s]);
  for (const key of BUNKER_KEYS) for (let s = 0; s < N; s++) runs.push([key, null, s]);
  for (let s = 0; s < N; s++) runs.push(["mountainbunker", null, s]);
  for (const [key, plan, s] of runs) {
    const rng = new Rng(52000 + s * 7919 + key.length * 17 + (plan ?? 99) * 131);
    const spec = BUILDINGS[key].make(rng, plan == null ? {} : { plan });
    const m = assemble(rng, spec, { key, name: BUILDINGS[key].name, withVehicle: s % 2 === 1 });
    if (spec.variant) (named[key] = named[key] || new Set()).add(spec.variant);
    const tag = `${key} ${plan ?? "dice"} ${s}`, S = SIG[key];
    (sizes[key] = sizes[key] || new Set()).add(`${spec.bw}x${spec.bh}/${m.storeys}`);
    const grids = m.floors || [{ cells: m.cells }];
    const rooms = m.rooms.filter((a) => !a.outdoor);
    const at = (f, x, y) => (x >= 0 && y >= 0 && x < m.w && y < m.h ? grids[f].cells[y * m.w + x] : null);
    const cellsIn = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y, at(a.f, x, y)]); return out; };
    const marks = new Set(rooms.map((a) => a.bunker));
    for (const r of S.rooms) if (!marks.has(r)) err("rooms", `${tag} (${spec.variant}) no ${r}`);
    if (!S.bunks.some((r) => marks.has(r)) || !S.food.some((r) => marks.has(r))) err("rooms", `${tag} (${spec.variant}) no bunks or no food store`);
    (plans[key] = plans[key] || new Set()).add([m.storeys, ...grids.map((F, f) => rooms.filter((a) => (a.f || 0) === f).map((a) => a.bunker).sort().join(","))].join("|"));
    if (!rooms.every((a) => a.bunker && BUNKER_STYLES[a.bunker])) err("style", tag);
    for (const a of rooms) {
      const want = PIECES[a.bunker];
      if (!want) continue;
      const k = new Set(cellsIn(a).map(([, , c]) => c.k));
      for (const q of want) if (!(Array.isArray(q) ? q.some((z) => k.has(z)) : k.has(q))) err("pieces", `${tag} ${a.name}: no ${q}`);
    }
    if (![...grids.flatMap((F) => F.cells)].some((c) => c.k === S.power)) err("power", `${tag} no ${S.power}`);
    // No windows anywhere.
    if (grids.some((F) => F.cells.some((c) => c.k === "window" || c.k === "smashed"))) err("windows", tag);
    // The levels: the Entrance level, then down.
    const names = grids.map((F) => F.name);
    if (names[0] !== "Entrance level" || names.slice(1).some((n, i) => n !== `Level −${i + 1}`) || (S.levels && m.storeys !== S.levels) || m.storeys < 2) err("levels", `${tag} ${names.join("/")}`);
    // The blast door (military and government): the front door's kind; the airlock's doors steel.
    if (marks.has("portal") && key !== "shelter") {
      const fd = at(0, m.front.x, m.front.y);
      if (!fd || fd.dk !== "blast") err("blast", `${tag} ${fd && fd.dk}`);
      for (const a of rooms.filter((r) => r.bunker === "airlock")) if ((a.doors || []).length < 2 || !a.doors.every(([x, y]) => (at(a.f, x, y) || {}).dk === "steel")) err("airlock", `${tag} ${(a.doors || []).length} doors`);
    }
    // A second exit where the plan has one (the escape hatch), reachable.
    if ((spec.exits || []).some((e) => /hatch/i.test(e.name)) && !m.exits.some((e) => /hatch/i.test(e.name) && e.zone >= 0)) err("exit", `${tag} ${m.exits.map((e) => e.name)}`);
    if (["milbunker", "mountainbunker", "govbunker"].includes(key) && !m.exits.some((e) => /hatch/i.test(e.name))) err("exit", `${tag} no escape hatch`);
    // The Entrance level mostly rock (the footprint's crag), only the portal shows.
    const B = m.building;
    let rock = 0;
    for (let y = B.y0; y < B.y0 + B.h; y++) for (let x = B.x0; x < B.x0 + B.w; x++) { const c = at(0, x, y); if (c.k === "crag" || c.k === "ventstack") rock++; }
    if (rock < B.w * B.h * (key === "shelter" ? 0.4 : 0.5)) err("rock", `${tag} ${rock} of ${B.w * B.h}`);
    // The stair runs land in the main tunnel (military, government, shelter: the checkpoint's and the hatch's).
    if (marks.has("tunnel")) for (const [x, y] of m.stairs) for (let f = 1; f < grids.length; f++) {
      const r = rooms.find((a) => a.f === f && x > a.x0 && x < a.x0 + a.w - 1 && y > a.y0 && y < a.y0 + a.h - 1);
      if (!r || r.bunker !== "tunnel") err("runs", `${tag} (${spec.variant}) the stairs at ${x},${y} on ${f} in ${r && r.name}`);
    }
    // Every room's doors reachable from each other; the containers the lootable pieces (and the Humvee).
    for (const a of rooms) {
      const g = grids[a.f].cells;
      if ((a.doors || []).length) { const seen = walkFrom(m, a.doors[0][0], a.doors[0][1], true, g); for (const [x, y] of a.doors) if (!seen[y * m.w + x]) err("doors", `${tag} ${a.name} door ${x},${y}`); }
      const boxes = m.containers.filter((c) => c.area === a.id && c.kind !== "humvee");
      const bad = boxes.filter((b) => { const c = at(a.f, b.x, b.y); return !c || c.k !== b.kind || !(pieceDef(c.k) || {}).loot; }); // a footlocker past the room's share stands plain
      if (bad.length) err("containers", `${tag} ${a.name}: ${bad.map((b) => `${b.kind} on ${(at(a.f, b.x, b.y) || {}).k}`)}`);
    }
    // Loot: the value of every container's table (supplies by supValue, gear by value), and the food per floor cell.
    const L = (loot[key] = loot[key] || { v: 0, food: 0, guns: 0, elec: 0, area: 0, n: 0 });
    L.n++;
    for (const c of m.containers) {
      const a = m.rooms[c.area];
      const def = boxLoot(a.type, c.kind);
      if (!def) continue;
      L.v += value(def);
      for (const [k, [p, lo, hi]] of Object.entries(def.loot)) { if (k === "food" || k === "preserved") L.food += Math.min(0.95, p) * (lo + hi) / 2; if (k === "electronics") L.elec += Math.min(0.95, p) * (lo + hi) / 2; }
      for (const [k, p] of def.gear) if (GEAR[k] && GEAR[k].slot === "weapon" && GEAR[k].skill && GEAR[k].skill !== "melee") L.guns += p;
    }
    for (const a of rooms) L.area += (a.w - 2) * (a.h - 2);
    rollScenes(m, new Rng(900 + s), key); // last: a scene's barricade may stand across a way
    for (const sc of (m.scenes && m.scenes.list) || []) sceneKinds.add(sc.kind);
  }
  const fmt = (k) => `${k} ${(errs[k] || []).length}${errs[k] ? ` (${errs[k].slice(0, 3).join("; ")})` : ""}`;
  for (const [k, v] of Object.entries(sizes)) console.log(`    ${k.padEnd(15)} ${[...v].slice(0, 4).join(" ")}`);
  check(BUNKER_KEYS.every((k) => plans[k].size >= 12 && named[k].size >= 12), `a dozen distinct plans a kind, each named (${BUNKER_KEYS.map((k) => `${k} ${plans[k].size} plans, ${named[k].size} names`).join("; ")})`);
  for (const k of BUNKER_KEYS) console.log(`    ${k}: ${BUNKER_VARIANTS[k].map((v) => v.name).join(", ")}`);
  check(!errs.rooms && !errs.style, `every kind's signature rooms, each furnished by its style (${fmt("rooms")})`);
  check(!errs.pieces && !errs.power, `the signature pieces: the airlock's showers and hazmat rack, the command centre's map table, radios and screens, bunks and footlockers, the genset, the water tanks, the ration shelves (${fmt("pieces")}, ${fmt("power")})`);
  check(!errs.windows, `no windows on any level (${fmt("windows")})`);
  check(!errs.levels, `the Entrance level, then Level −1, Level −2 (${fmt("levels")})`);
  check(!errs.blast && !errs.airlock, `the blast door at the portal, the airlock between two steel doors (${fmt("blast")}, ${fmt("airlock")})`);
  check(!errs.exit, `a second exit where the plan has one: the escape hatch (${fmt("exit")})`);
  check(!errs.rock, `the Entrance level mostly rock: only the portal shows above (${fmt("rock")})`);
  check(!errs.runs, `the stairs land in the main tunnel (${fmt("runs")})`);
  check(!errs.doors && !errs.containers, `every room's doors reachable; the containers are the lootable pieces (${fmt("doors")}, ${fmt("containers")})`);
  for (const [k, L] of Object.entries(loot)) console.log(`    ${k.padEnd(15)} loot ${(L.v / L.n).toFixed(1)} a map, food ${(L.food / L.n).toFixed(1)} days (${(L.food / L.area).toFixed(3)} a floor cell), guns ${(L.guns / L.n).toFixed(2)}, electronics ${(L.elec / L.n).toFixed(1)}`);
  const perCell = (k) => loot[k].food / loot[k].area;
  check(perCell("prepper") > perCell("shelter") && perCell("prepper") > perCell("milbunker") && perCell("prepper") > perCell("govbunker"), `the prepper's pantry the richest food per area (${["prepper", "shelter", "milbunker", "govbunker"].map((k) => `${k} ${perCell(k).toFixed(3)}`).join(", ")})`);
  check(loot.govbunker.elec / loot.govbunker.n > loot.govbunker.guns / loot.govbunker.n && loot.milbunker.guns > loot.govbunker.guns, "the government bunker: more electronics than guns, fewer guns than the military's");
  const want = ["sealed", "lastlog", "bitten", "laststand", "sealedhatch", "booby"];
  check(want.every((k) => sceneKinds.has(k)), `the bunker scenes turn up (${want.filter((k) => sceneKinds.has(k)).join(", ")} of ${want.join(", ")})`);
  // The sites and points of interest (pois.js bunkerExtra) at their rates on a world.
  const st = createWorld({ seed: 4242, factionCount: 6 });
  const seen = {}, expect = {};
  for (const t of st.tiles) {
    for (const p of t.pois || []) if (p.extra === "bunker") seen[p.kind] = (seen[p.kind] || 0) + 1;
    const room = (t.pois || []).filter((p) => p.extra !== "bunker").length < POI.MAX; // a tile its other places leave room on (POI.MAX)
    for (const k of ["bunker", "govbunker", "shelter", "prepper"]) expect[k] = (expect[k] || 0) + (room ? BUNKER_POI[k][t.terrain] || 0 : 0);
  }
  console.log(`    on a ${st.grid.width} × ${st.grid.height} world: ${Object.keys(expect).map((k) => `${k} ${seen[k] || 0} (${expect[k].toFixed(1)} at the base rate on the tiles with room)`).join(", ")}`);
  check(["shelter", "prepper"].every((k) => (seen[k] || 0) >= expect[k] * 0.5 && (seen[k] || 0) <= expect[k] * 1.6) && (seen.bunker || 0) >= 1 && (seen.bunker || 0) <= expect.bunker * BUNKER_POI.NEAR, "the shelters and prepper bunkers at their rates, a military bunker or more (more often near a military site)");
  check(SITES.bunker_mil && SITES.bunker_mil[0] === "mountainbunker" && ["bunker", "govbunker", "shelter", "prepper"].every((k) => SITES[k] && BUILDINGS[SITES[k][0]]), "the bunker sites and points of interest open their bunkers");
}

// ===============================================================================}

console.log("\nWarehouses, factories and labs: a dozen plans each (industrylayout.js, issue #37)");
{
  // Every plan pinned (tools/industryvarianttest.js goes further: the distinct plans, loot, names, older saves): every
  // room reached from the front (upstairs from the stairs), no cell cut off, its signature pieces (racks and docks, a
  // production line, lab benches with fume hoods...).
  const bad = [];
  let n = 0;
  for (const key of INDUSTRY_KEYS) for (const p of plansOf(key)) for (let s = 0; s < 3; s++) {
    const rng = new Rng(7700 + s * 7919 + key.length);
    const spec = BUILDINGS[key].make(rng, { plan: p.id });
    const m = assemble(rng, spec, { key, name: BUILDINGS[key].name, withVehicle: s === 1 });
    n++;
    const z0 = m.zones[0];
    const reach = m.floors.map((F, f) => walkFrom(m, f ? m.stairs[0][0] : z0.x0 + 1, f ? m.stairs[0][1] : z0.y0 + 1, true, F.cells));
    for (const r of m.rooms.filter((a) => !a.outdoor)) {
      let any = false;
      for (let y = r.y0 + 1; y < r.y0 + r.h - 1 && !any; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (reach[r.f || 0][y * m.w + x]) { any = true; break; }
      if (!any) bad.push(`${p.name}: ${r.name} not reached`);
    }
    m.floors.forEach((F, f) => { for (let i = 0; i < m.w * m.h; i++) if ((CELL[F.cells[i].k].walk || F.cells[i].k === "door") && !reach[f][i]) { bad.push(`${p.name}: floor ${f} cut off`); break; } });
    const kinds = new Set(m.floors.flatMap((F) => F.cells.map((c) => c.k)));
    const rooms = m.rooms.filter((a) => !a.outdoor);
    const miss = p.sig.filter((k) => (k === "dock" ? !rooms.some((a) => a.role === "dock") : k === "unit" ? !rooms.some((a) => a.role === "unit") : !kinds.has(k)));
    if (miss.length) bad.push(`${p.name}: no ${miss.join(", ")}`);
  }
  check(!bad.length, `${n} industrial buildings (${INDUSTRY_KEYS.map((k) => `${plansOf(k).length} ${k} plans`).join(", ")}, 3 seeds each): all reached, each with its signature pieces${bad.length ? ` (${[...new Set(bad)].slice(0, 5).join("; ")})` : ""}`);
}
console.log("\nMilitary bases, air bases, airports and prisons laid out like the real thing (militarylayout.js)");
{
  const N = Math.max(SEEDS, 6);
  const errs = {};
  const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
  const VEH = new Set(["m35", "humvee", "helo", "jet", "cargoplane", "airliner", "firetruck", "engine"]);
  const SITE = { hangar: "airbase", warehouse: "military" };
  const counts = { bunks: 0, locked: 0, cells0: 0, cells1: 0, vehicles: 0, aircraft: 0, gates: 0, scanners: 0 };
  const sizeOk = [];
  for (const key of [...MIL_KEYS, "hangar:airport", "warehouse"]) for (let s = 0; s < N; s++) {
    const [k, siteArg] = key.split(":");
    const site = siteArg || SITE[k] || null;
    const rng = new Rng(61000 + s * 7919 + key.length * 17);
    const spec = BUILDINGS[k].make(rng, { site, plan: "standard" }); // today's plan of each (its dozen plans: tools/milvarianttest.js)
    const m = assemble(rng, spec, { key: k, name: k });
    const tag = `${key} ${s}`;
    const grids = m.floors || [{ cells: m.cells }];
    const rooms = m.rooms.filter((a) => !a.outdoor);
    const at = (f, x, y) => (x >= 0 && y >= 0 && x < m.w && y < m.h ? grids[f].cells[y * m.w + x] : null);
    const cellsIn = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y, at(a.f, x, y)]); return out; };
    const kinds = (a) => new Set(cellsIn(a).map(([, , c]) => c.k));
    const civ = (c) => rooms.filter((a) => a.civic === c);
    const need = (c, list, what) => { const rs = civ(c); if (!rs.length) err(`${c}-room`, tag); for (const a of rs) { const kk = kinds(a); if (!list.every((q) => (Array.isArray(q) ? q.some((z) => kk.has(z)) : kk.has(q)))) err(what, `${tag} ${a.name}: ${[...kk].join(",")}`); } };
    if (!rooms.every((a) => !a.civic || MILITARY_STYLES[a.civic] || CIVIC_STYLES[a.civic])) err("style", tag);
    // At its real size (MIL_SIZE, a metre a cell).
    const sz = MIL_SIZE[k === "warehouse" ? "supply" : k];
    if (sz && (spec.bw < sz.w[0] || spec.bw > sz.w[1] || spec.bh < sz.d[0] || spec.bh > sz.d[1] || m.storeys < sz.storeys[0] || m.storeys > sz.storeys[1])) err("real size", `${tag} ${spec.bw}x${spec.bh} ${m.storeys} storeys`);
    else sizeOk.push(key);
    // Every room's doors reachable from each other on its floor; every container on a lootable piece of its kind (a
    // vehicle's over the vehicle).
    for (const a of rooms) {
      const g = grids[a.f].cells;
      if ((a.doors || []).length) {
        const seen = walkFrom(m, a.doors[0][0], a.doors[0][1], true, g);
        for (const [x, y] of a.doors) if (!seen[y * m.w + x]) err("doors", `${tag} ${a.name} door ${x},${y}`);
      }
    }
    for (const c of m.containers) {
      const a = m.rooms.find((r) => r.id === c.area);
      if (!a || a.outdoor) continue;
      const cl = at(c.f || 0, c.x, c.y);
      if (VEH.has(c.kind)) { if (!cl || !cl.car) err("vehicle container", `${tag} ${c.kind}`); continue; }
      if (!cl || cl.k !== c.kind || !pieceDef(c.kind) || !pieceDef(c.kind).loot) { if (a.civic && MILITARY_STYLES[a.civic]) err("containers the pieces", `${tag} ${a.name}: ${c.kind} on ${cl && cl.k}`); }
    }
    // The signature rooms and pieces.
    if (k === "barracks") {
      need("dutydesk", ["counter"], "barracks: a duty desk");
      need("latrine", ["toilet", "shower"], "barracks: a latrine with toilets and showers");
      // Bunks with footlockers: every bunk (a bed in a two-person room) of a bay or a room has a footlocker by it.
      for (const a of [...civ("bay"), ...civ("twoman")]) {
        const beds = new Map();
        for (const [x, y, c] of cellsIn(a)) if ((c.k === "bunk" || c.k === "bed") && c.pc) { if (!beds.has(c.pc)) beds.set(c.pc, []); beds.get(c.pc).push([x, y]); }
        if (!beds.size) err("barracks: bunks", `${tag} ${a.name}`);
        for (const cs of beds.values()) {
          counts.bunks++;
          if (!cs.some(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (at(a.f, x + dx, y + dy) || {}).k === "footlocker"))) err("barracks: a footlocker by every bunk", `${tag} ${a.name}`);
        }
      }
    }
    if (k === "armorybldg") {
      // The arms vault behind its vault door (locked), weapon racks in rows.
      for (const a of civ("vault")) {
        const racks = cellsIn(a).filter(([, , c]) => c.k === "gunrack").length;
        const doors = m.lockedDoors.filter((d) => d.area === a.id);
        if (!a.locked || !doors.length || !doors.every((d) => d.dk === "vault")) err("armory: the vault behind a locked vault door", `${tag} ${a.locked && a.locked.kind}`); else counts.locked++;
        if (racks < 4) err("armory: weapon racks in rows", `${tag}: ${racks}`);
      }
      if (!civ("vault").length) err("armory: a vault", tag);
      need("ammostore", ["ammocab"], "armory: ammo cabinets");
      need("issue", ["counter", "bars"], "armory: a caged issue window");
      need("optics", ["sportcage"], "armory: the optics cage");
    }
    if (k === "motorpool") {
      const v = m.containers.filter((c) => (c.kind === "humvee" || c.kind === "m35") && civ("vbays").some((a) => a.id === c.area));
      counts.vehicles += v.length;
      if (!v.length || !v.every((c) => { const cl = at(0, c.x, c.y); return cl && cl.car && (cl.car.body === "humvee" || cl.car.body === "m35"); })) err("motor pool: military vehicles in the bays", tag);
      need("toolcrib", ["workbench"], "motor pool: a tool crib");
    }
    if (k === "tower") {
      const cab = civ("cab");
      if (cab.length !== 1 || cab[0].f !== m.storeys - 1) err("control tower: the cab on the top floor", `${tag}: ${cab.map((a) => a.f)}`);
      need("cab", ["radioconsole"], "control tower: radio consoles in the cab");
    }
    if (k === "terminal") {
      need("security", ["scanner"], "terminal: security lanes with scanners");
      need("gates", ["gateseat"], "terminal: gates with seating");
      need("checkin", ["counter", "baggagebelt"], "terminal: check-in desks and the belt");
      need("confiscated", ["evlocker"], "terminal: the confiscated items room");
      need("claim", ["baggagebelt"], "terminal: baggage claim");
      counts.scanners += rooms.filter((a) => a.civic === "security").reduce((n, a) => n + cellsIn(a).filter(([, , c]) => c.k === "scanner").length, 0);
      counts.gates += civ("gates").length;
    }
    if (k === "cellblock") {
      // Two tiers: cells (a cell door, bars, a bunk, a toilet and a sink) on both floors, round the day room.
      for (const a of civ("pcells")) for (const [x, y, c] of cellsIn(a)) if (c.cellDoor) {
        if (a.f === 0) counts.cells0++; else counts.cells1++;
        if (c.dk !== "cell") err("prison: cell doors", `${tag} ${x},${y} ${c.dk}`);
        const [ix, iy] = c.cellIn, dy = iy - y, inner = [[ix, iy], [ix, iy + dy], [ix, iy + 2 * dy], [ix - 1, iy], [ix - 1, iy + dy], [ix - 1, iy + 2 * dy]].map(([px, py]) => (at(a.f, px, py) || {}).k);
        if (!inner.includes("bunk") || !inner.includes("toilet") || !inner.includes("sink")) err("prison: a bunk, a toilet and a sink in each cell", `${tag} ${x},${y}`);
      }
      const tiers = new Set(civ("pcells").filter((a) => cellsIn(a).some(([, , c]) => c.cellDoor)).map((a) => a.f));
      if (!(tiers.has(0) && tiers.has(1))) err("prison: two tiers of cells", `${tag}: ${[...tiers]}`);
      need("pcontrol", ["secdesk"], "prison: the control room's monitors");
      need("visitation", ["teller"], "prison: visitation's glass divider");
      need("intake", ["intakelocker"], "prison: intake's property lockers");
      if (!m.plan.ground || !(m.plan.ground.fence > 0) || !(m.plan.ground.towers > 0)) err("prison: its perimeter fence and towers", tag);
    }
    if (k === "hangar") {
      const plane = m.containers.find((c) => ["jet", "cargoplane", "airliner"].includes(c.kind) && civ("hfloor").some((a) => a.id === c.area));
      const mil = site === "airbase";
      if (!plane) err("hangar: an aircraft on the floor", tag);
      else { counts.aircraft++; if (mil !== (plane.kind !== "airliner" && !(plane.kind === "cargoplane" && plane.w * plane.h === 48))) err("hangar: an air base's aircraft military, an airport's civil", `${tag} ${plane.kind}`); }
      if (!(m.exits || []).some((e) => e.roller && e.name === "Hangar door")) err("hangar: the hangar door", tag);
    }
    if (k === "hq") { need("ops", ["maptable", "radioconsole"], "HQ: the ops room's map table and radios"); need("cmdoffice", ["desk"], "HQ: the commander's office"); need("comms", ["radioconsole"], "HQ: the comms room"); }
    if (k === "messhall") { need("mess", ["counter", "table"], "mess hall: the serving line and tables"); need("galley", ["range"], "mess hall: the galley's ranges"); for (const a of civ("mwalkin")) if (!(a.doors || []).some(([x, y]) => (at(a.f, x, y) || {}).dk === "coldroom")) err("mess hall: the walk-in's cold room door", tag); }
    if (k === "aidstation") need("aidward", ["cot"], "aid station: cots");
    if (k === "gatehouse") need("guardpost", ["radioconsole"], "gatehouse: the guard post's radio");
    if (k === "flightops") need("crewroom", ["locker"], "flight ops: the crew room's lockers");
    if (["hq", "barracks", "armorybldg", "messhall", "motorpool", "aidstation", "gatehouse"].includes(k) && !(m.plan.ground && m.plan.ground.fence > 0 && m.plan.ground.towers > 0 && m.plan.ground.gate > 0)) err("base: the compound's fence, towers and gatehouse", `${tag} ${JSON.stringify(m.plan.ground)}`);
    if (k === "hq" && !(m.plan.ground && m.plan.ground.helo)) err("HQ: a helicopter wreck on the helipad", tag);
  }
  for (const [what, list] of Object.entries(errs)) check(false, `${what}: ${list.length} bad, e.g. ${list.slice(0, 3).join("; ")}`);
  check(!Object.keys(errs).length, `every military building's rooms have their signature pieces, doors reachable, containers the pieces, at its real size (${N} of each; ${counts.bunks} bunks, ${counts.locked} vaults, ${counts.vehicles} vehicles, ${counts.aircraft} aircraft, ${counts.cells0} + ${counts.cells1} cells, ${counts.scanners} scanners)`);
  // Loot (200 seeded buildings each: the old layout against the new): a rebuilt building holds at least what it did
  // (it is bigger: the totals scale with the area) and is no richer a square metre than it was (at most +25%); the
  // armory the richest a square metre.
  const value = (def) => { let v = 0; for (const [kk, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(kk); for (const [kk, p] of def.gear) v += p * ((GEAR[kk] && GEAR[kk].value) || 0); return v; };
  const LN = BS_QUICK ? 40 : 200;
  const loot = (k, legacy, site) => { let v = 0, area = 0; for (let s = 0; s < LN; s++) { const rng = new Rng(9000 + s * 104729 + 5); const spec = BUILDINGS[k].make(rng, { legacy, site }); const m = assemble(rng, spec, { key: k, name: k, legacy, noDecor: true }); area += spec.bw * spec.bh * (m.storeys || 1); for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type) v += value(boxLoot(a.type, c.kind)); } } return { v: v / LN, d: v / area }; };
  const dens = {};
  for (const [k, site] of [["barracks"], ["armorybldg"], ["motorpool"], ["messhall"], ["cellblock"], ["hangar", "airport"], ["hangar", "airbase"], ["terminal"], ["warehouse", "military"]]) {
    const b = loot(k, true, site), a = loot(k, false, site);
    dens[`${k}${site ? "@" + site : ""}`] = a.d;
    check(a.v >= b.v * 0.9 && a.d <= b.d * 1.25, `${k}${site ? ` at a ${site}` : ""} holds ${a.v.toFixed(0)} against ${b.v.toFixed(0)} (×${(a.v / b.v).toFixed(2)}; ${a.d.toFixed(2)} a m² against ${b.d.toFixed(2)})`);
  }
  check(Object.entries(dens).every(([kk, d]) => kk === "armorybldg" || d < dens.armorybldg), `the armory is the richest a square metre (${dens.armorybldg.toFixed(2)})`);
  // An older save keeps the old layouts: no military marks, none of the new pieces.
  let marks = 0, newKinds = 0;
  const NEW = new Set(["footlocker", "maptable", "radioconsole", "ammocrate", "barrier", "guardbooth", "fuelbladder", "enginestand", "baggagebelt", "scanner", "gateseat", "intakelocker", "luggage"]);
  for (const k of ["barracks", "armorybldg", "motorpool", "messhall", "cellblock", "hangar", "terminal", "warehouse"]) for (let s = 0; s < 6; s++) {
    const rng = new Rng(800 + s);
    const m = assemble(rng, BUILDINGS[k].make(rng, { legacy: true, site: SITE[k] }), { key: k, name: k, legacy: true, noDecor: true });
    marks += m.rooms.filter((a) => a.civic).length;
    for (const F of m.floors || [{ cells: m.cells }]) for (const c of F.cells) if (NEW.has(c.k)) newKinds++;
  }
  check(!marks && !newKinds, `an older save's barracks, armory, motor pool, mess hall, cell block, hangar, terminal and warehouse keep their old layouts (${marks} styled rooms, ${newKinds} new pieces)`);
  // The sites: an air base offers its hangars, tower, flight ops, barracks
  // and mess; a base its HQ, mess hall, aid station and gatehouse besides its first four (their ids as they were).
  const sb = (type) => siteBuildings({ loc: { type }, pois: [] });
  check(sb("airbase") && sb("airbase").options[0].key === "hangar" && sb("airbase").options.every((o) => o.site === "airbase" && BUILDINGS[o.key]), `an air base's buildings (${sb("airbase").options.map((o) => o.name).join(", ")}: by its layout, milplans.js MIL_SITES)`);
  check(sb("military").options.slice(0, 4).map((o) => o.id).join() === "barracks,armorybldg,motorpool,warehouse" && sb("military").options.length >= 4, "a base's buildings, its first four's ids as they were (the rest by its layout)");
  // The air base on generated maps: one a six of the military sites (a Normal map: two), never the only one.
  const ab = [1, 2].map((seed) => { const w = createWorld({ seed, factionCount: 3 }); return [w.tiles.filter((t) => t.loc && t.loc.type === "airbase").length, w.militaryIds.length, w.tiles.filter((t) => t.loc && t.loc.type === "military").length]; });
  check(ab.every(([a, n, g]) => a >= 1 && g >= 1 && a + g === n && a <= Math.ceil(n / 4)), `air bases on generated maps at a sensible rate (${ab.map(([a, n]) => `${a} of ${n} military sites`).join(", ")})`);
  // The scenes (registered by militarylayout.js) turn up.
  const sw = createWorld({ seed: 12, factionCount: 2 }), stiles = sw.tiles.filter((t) => t.loc).slice(0, 4);
  const seenKinds = new Set();
  for (const [k, sc] of [["barracks", 24], ["hq", 24], ["armorybldg", 30], ["cellblock", 24], ["terminal", 16], ["gatehouse", 24]]) for (let i = 0; i < sc; i++) {
    const m = buildingMap(sw, stiles[i % stiles.length].id, { key: k, id: `${k}-${i}`, name: k }, false);
    for (const x of (m.scenes && m.scenes.list) || []) seenKinds.add(x.kind);
  }
  const want = ["gatestand", "barracksoverrun", "armorybarricade", "helipadevac", "cellsopen", "terminalshelter"];
  check(want.every((kk) => seenKinds.has(kk)), `the military scenes turn up (${want.filter((kk) => seenKinds.has(kk)).join(", ")} of ${want.join(", ")})`);
  // The crawl's checkpoint (a street map) gets the new pieces: footlockers, gun racks, the Army truck, the barrier.
  const cw = createWorld({ seed: 4, factionCount: 2 }), ct = cw.tiles.find((t) => t.loc && t.loc.type === "city");
  const cb = createBattle(cw, { mode: "raid", tile: ct.id, partyId: null, canRetreat: true, ambush: null, handler: "itest", enemy: { kind: "zombies", count: 2, power: 2 }, raid: { heat0: 0, building: "street", areas: ["barracks", "armory", "wreck", "campsite"], gunSite: "military", checkpoint: true }, context: { factionIds: [] } });
  const ck = new Set(cb.cells.map((c) => c.k));
  check(ck.has("footlocker") && (ck.has("gunrack") || ck.has("ammocrate")) && cb.cells.some((c) => c.car && c.car.body === "m35"), `the crawl's checkpoint: footlockers, gun racks or ammo crates, the Army truck (${["footlocker", "gunrack", "ammocrate", "radioconsole", "barrier", "guardbooth"].filter((kk) => ck.has(kk)).join(", ")})`);
}

console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(fails ? 1 : 0);
