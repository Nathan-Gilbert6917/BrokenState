// Prison complexes (issue #31 of the interiors epic #7, the user's request 2026-10-25: "add … prisons max of 400x400"):
// a county jail, a state prison and a maximum-security penitentiary, each one map of many buildings (sim/prison.js,
// sim/prisonlayout.js, on sim/compound.js). Per kind, over several seeds:
//   - housing units with two-tier cells, each cell a steel bunk, a toilet and a sink behind bars with a cell door; the
//     upper tier a walkway with a railing over the day room's open well;
//   - central control joined to every housing unit indoors (secure corridors with sally-port doors);
//   - the yard, the chow hall, the infirmary and the armory;
//   - a perimeter of fence or wall with towers, crossed only at the gates (and the holes in the fence);
//   - every walkable cell reachable from the entry through the gates (and every upper floor from its stairs);
//   - the map at most 400 × 400 (and the module's cap);
//   - each building's containers apart in the ledger (their own ids, the building that holds them);
//   - a revisit restores it (the same map from the same dice; a save mid-raid loads as it was);
//   - an older save keeps the prison's one-building pick and has no jails; the scenes, the cell switch, the fence cut;
//   - the loot totals by kind and the turn time with 100 dead at the biggest size (reported).
// Run: node tools/prisontest.js [seeds]  (BS_QUICK=1: fewer seeds)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler, combatAct, endPlayerTurn, runEnemyPhase, CELL, AREAS, boxLoot, enemyUnit } from "../src/sim/combat.js";
import { BUILDINGS, siteBuildings, SITES } from "../src/sim/buildingmaps.js";
import { prisonMap, prisonKind, PRISON, switchPanel } from "../src/sim/prison.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { generatePois } from "../src/sim/pois.js";
import { poiPlace } from "../src/sim/poiraid.js";
import { WIRE, cutAct } from "../src/sim/wire.js";
import { newItem } from "../src/sim/inventory.js";

registerCombatHandler("ptest", () => {});
const QUICK = !!process.env.BS_QUICK;
const SEEDS = Number(process.argv[2] || (QUICK ? 3 : 8));
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();

// ---------- the maps on their own (the generator's dice) ----------
const fake = (seed) => ({ seed });
const opt = (key) => ({ key, id: key, name: BUILDINGS[key].name });
// A prison map of the kind wanted: the kind is the site's dice (prisonKind by the tile), so walk the tiles.
function mapOf(kind, seed) {
  if (kind === "jail") return { m: prisonMap(fake(seed), 7, opt("jail"), false), tileId: 7 };
  for (let t = 0; t < 400; t++) if (prisonKind(fake(seed), t, opt("prison")) === kind) return { m: prisonMap(fake(seed), t, opt("prison"), false), tileId: t };
  return null;
}
const I = (m, x, y) => y * m.w + x;
const pass = (c) => !!c && ((CELL[c.k] && CELL[c.k].walk) || c.k === "door" || c.k === "idoor" || c.k === "odoor");
function flood(m, f, starts, ok = pass) {
  const cells = m.floors[f].cells, seen = new Uint8Array(m.w * m.h), q = [];
  for (const [x, y] of starts) { const i = I(m, x, y); if (ok(cells[i], x, y) && !seen[i]) { seen[i] = 1; q.push(i); } }
  while (q.length) {
    const i = q.pop(), x = i % m.w, y = (i / m.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = I(m, nx, ny);
      if (!seen[j] && ok(cells[j], nx, ny)) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}
const zoneStart = (m) => [m.zones[0].x0 + 1, m.zones[0].y0 + 1];
const inR = (r, x, y) => x >= r.x0 && y >= r.y0 && x < r.x0 + r.w && y < r.y0 + r.h;
// A cell of a tier: its door, the cell behind it (2 × 3: the door's column and the one beside), what stands in it.
function cellsOf(m, f) {
  const out = [], cells = m.floors[f].cells;
  cells.forEach((c, i) => {
    if (!c.cellDoor || !c.cellIn) return;
    const x = i % m.w, y = (i / m.w) | 0, dx = Math.sign(c.cellIn[0] - x), dy = Math.sign(c.cellIn[1] - y); // into the cell (a turned building's along x)
    const inside = [];
    for (let s = 1; s <= 3; s++) for (const t of [-1, 0, 1]) inside.push(cells[I(m, x + s * dx + (dx ? 0 : t), y + s * dy + (dy ? 0 : t))].k);
    const bars = dy ? cells[I(m, x - 1, y)].k === "bars" || cells[I(m, x + 1, y)].k === "bars" : cells[I(m, x, y - 1)].k === "bars" || cells[I(m, x, y + 1)].k === "bars";
    out.push({ x, y, f, tier: c.tier, bunk: inside.includes("steelbunk"), loo: inside.includes("steeltoilet"), bars, door: ["idoor", "odoor", "door"].includes(c.k) && c.dk === "cell" });
  });
  return out;
}
function hash(m) {
  let h = 0;
  for (const F of m.floors) for (const c of F.cells) { const s = c.k + (c.f || "") + (c.dk || ""); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; }
  for (const c of m.containers) h = (h * 31 + c.id * 7 + c.x * 13 + c.y * 17 + (c.house ?? -1)) | 0;
  return h;
}
// The loot a container rolls, its worth by the table's chances (supplies by their mid count, gear by its odds).
function worth(m, c) {
  const a = m.rooms[c.area];
  if (!a || !a.type || !AREAS[a.type]) return { sup: 0, gear: 0 };
  const T = boxLoot(a.type, c.kind);
  let sup = 0, gear = 0;
  for (const [, [p, lo, hi]] of Object.entries(T.loot || {})) sup += p * (lo + hi) / 2;
  for (const [, p] of T.gear || []) gear += p;
  return { sup, gear };
}

const LOOT = {};
for (const kind of ["jail", "state", "max"]) {
  console.log(`${PRISON.KINDS[kind].name}: ${SEEDS} seeds`);
  const W = {}; // why each check failed (its first case)
  let ok2tier = true, okCells = true, cellsSeen = 0, okRail = true, okJoin = true, okBld = true, okPerim = true, okGates = true, okReach = true, okUp = true, okSize = true, okLedger = true, okRevisit = true, towers = 0, beds = [], sizes = [], why = "";
  const tot = { boxes: 0, sup: 0, gear: 0, armory: 0, property: 0, food: 0, meds: 0, cells: 0 };
  for (let s = 0; s < SEEDS; s++) {
    const got = mapOf(kind, 100 + s * 7);
    if (!got) { okSize = false; why = "no map"; continue; }
    const m = got.m, P = m.plan;
    sizes.push(`${m.w}×${m.h}`);
    beds.push(P.beds);
    if (m.w > 400 || m.h > 400 || m.w > PRISON.CAP || m.h > PRISON.CAP) okSize = false;
    // Housing units with two tiers of cells.
    const units = P.units.filter((u) => !P.houses[u.house] || !u.dorm);
    for (const u of units) {
      const H = P.houses.find((h) => h.k === u.house);
      const lower = cellsOf(m, 0).filter((c) => c.tier === u.unitId), upper = m.floors[1] ? cellsOf(m, 1).filter((c) => c.tier === u.unitId) : [];
      if (!lower.length || !upper.length) { ok2tier = false; W.ok2tier = W.ok2tier || `${u.name}: ${lower.length} / ${upper.length} cells`; }
      for (const c of [...lower, ...upper]) { cellsSeen++; if (!(c.bunk && c.loo && c.bars && c.door)) { okCells = false; W.okCells = W.okCells || `${u.name} cell at ${c.x},${c.y}: ${JSON.stringify(c)}`; } }
      // The upper tier: a railing over the well (open air) inside the unit.
      if (H && m.floors[1]) { let rail = 0, air = 0; for (let y = H.y0; y < H.y0 + H.h; y++) for (let x = H.x0; x < H.x0 + H.w; x++) { const k = m.floors[1].cells[I(m, x, y)].k; if (k === "rail") rail++; if (k === "void") air++; } if (!rail || !air) { okRail = false; W.okRail = W.okRail || `${u.name}: rail ${rail}, air ${air}`; } }
    }
    // Central control joined to every unit indoors: a flood over floor cells (no outdoor ground) from central control.
    const ctl = m.rooms.find((a) => a.prison === "control" && !a.outdoor);
    const indoor = (c) => pass(c) && c.f === "floor";
    const roomCellsOf = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y]); return out; };
    const reached = (seen, a) => !!a && roomCellsOf(a).some(([x, y]) => seen[I(m, x, y)]);
    const fromCtl = ctl ? flood(m, ctl.f || 0, roomCellsOf(ctl), indoor) : null;
    for (const u of P.units) {
      const pk = m.rooms.find((a) => a.prison === (u.dorm ? "dorm" : "picket") && a.unitId === u.unitId && !(a.f > 0));
      if (kind === "jail" && ctl && ctl.f > 0) { // a jail's control room is upstairs: its floor below joined instead (the main building's corridor)
        const main = m.rooms.find((a) => a.role === "corridor" && a.house === P.control && !(a.f > 0));
        const fromMain = main ? flood(m, 0, roomCellsOf(main), indoor) : null;
        if (!pk || !fromMain || !reached(fromMain, pk)) { okJoin = false; W.okJoin = W.okJoin || `${u.name} not joined to the jail`; }
        continue;
      }
      if (!pk || !fromCtl || !reached(fromCtl, pk)) { okJoin = false; W.okJoin = W.okJoin || `${u.name} not joined to control`; }
    }
    if (kind !== "jail" && P.conns.length < P.units.length) { okJoin = false; W.okJoin = W.okJoin || `${P.conns.length} corridors for ${P.units.length} units`; }
    // The yard, the chow hall, the infirmary, the armory.
    const roles = new Set(P.houses.map((h) => h.role)), roomRoles = new Set(m.rooms.map((a) => a.role));
    const needB = kind === "jail" ? [] : ["chow", "infirmary", "armory"];
    const needR = kind === "jail" ? ["yard", "pkitchen", "pward", "property", "visitation", "booking", "holding"] : ["yard", "chow", "pkitchen", "pward", "parmory", "property"].filter((r) => r !== "property");
    for (const r of needB) if (!roles.has(r)) { okBld = false; W.okBld = W.okBld || `no ${r}`; }
    for (const r of needR) if (!roomRoles.has(r)) { okBld = false; W.okBld = W.okBld || `no ${r} room`; }
    // The perimeter: the inside (the inner fence's rect, off the buildings) is reached from the entry only through the
    // gates or a hole, never over the fence or the wall.
    if (P.perimeter) {
      towers += P.towers.length;
      if (P.towers.length < 4) { okPerim = false; W.okPerim = W.okPerim || `${P.towers.length} towers`; }
      const R = P.perimeter.inner, mid = [R.x0 + Math.floor(R.w / 2), R.y0 + 4];
      const probe = [];
      for (let y = R.y0 + 2; y < R.y0 + R.h - 2 && probe.length < 20; y += 7) for (let x = R.x0 + 2; x < R.x0 + R.w - 2 && probe.length < 20; x += 11) { const c = m.cells[I(m, x, y)]; if (c.k === "open" && c.f !== "floor") probe.push([x, y]); }
      const noGate = flood(m, 0, [zoneStart(m)], (c) => pass(c) && c.k !== "gate" && !c.hole && c.f !== "floor" && !c.sally);
      if (probe.some(([x, y]) => noGate[I(m, x, y)])) { okPerim = false; W.okPerim = W.okPerim || "the inside reached without a gate"; }
      const withGate = flood(m, 0, [zoneStart(m)]);
      if (!probe.every(([x, y]) => withGate[I(m, x, y)])) { okGates = false; W.okGates = W.okGates || "the inside not reached through the gates"; }
      const pf = m.cells.filter((c) => c.k === "pfence").length, wl = m.cells.filter((c) => c.k === "wall" && c.t === 2 && c.f === "floor").length;
      if (!pf || (P.perimeter.wall && !wl)) { okPerim = false; W.okPerim = W.okPerim || `fence ${pf}, wall ${wl}`; }
    }
    // Every walkable cell reachable from the entry (floor 0); every upper floor's from its stairs.
    const r0 = flood(m, 0, [zoneStart(m)]);
    let lost = 0;
    m.cells.forEach((c, i) => { if (CELL[c.k] && CELL[c.k].walk && !r0[i]) lost++; });
    if (lost) { okReach = false; W.okReach = W.okReach || `${lost} cells cut off on the ground floor`; }
    for (let f = 1; f < m.floors.length; f++) {
      const r = flood(m, f, m.stairs);
      let lf = 0;
      m.floors[f].cells.forEach((c, i) => { if (CELL[c.k] && CELL[c.k].walk && c.k !== "void" && !r[i]) lf++; });
      if (lf) { const i = m.floors[f].cells.findIndex((c, j) => CELL[c.k] && CELL[c.k].walk && c.k !== "void" && !r[j]); okUp = false; W.okUp = W.okUp || `${lf} cells cut off on floor ${f + 1}, the first a ${m.floors[f].cells[i].k} at ${i % m.w},${(i / m.w) | 0} in ${(P.houses.find((h) => inR(h, i % m.w, (i / m.w) | 0)) || {}).name}`; }
    }
    // The ledger: every container its own id, the building that holds it (an indoor one), the outdoor ones their area's.
    const ids = new Set(m.containers.map((c) => c.id));
    if (ids.size !== m.containers.length) { okLedger = false; W.okLedger = W.okLedger || "container ids repeat"; }
    for (const c of m.containers) {
      const a = m.rooms[c.area];
      if (!a) { okLedger = false; W.okLedger = W.okLedger || `container ${c.id} has no area`; continue; }
      if (!a.outdoor) { const H = P.houses.find((h) => h.k === c.house); if (!H || !inR(H, c.x, c.y)) { okLedger = false; W.okLedger = W.okLedger || `container ${c.id} not in its building`; } }
    }
    // The same map from the same dice.
    const again = kind === "jail" ? prisonMap(fake(100 + s * 7), got.tileId, opt("jail"), false) : prisonMap(fake(100 + s * 7), got.tileId, opt("prison"), false);
    if (hash(again) !== hash(m)) { okRevisit = false; W.okRevisit = W.okRevisit || "a second visit differs"; }
    // Loot.
    for (const c of m.containers) {
      const w = worth(m, c), a = m.rooms[c.area];
      tot.boxes++; tot.sup += w.sup; tot.gear += w.gear;
      if (a && a.type === "parmory") tot.armory += w.sup + w.gear * 10;
      if (a && a.type === "property") tot.property += w.gear;
      if (a && (a.type === "pkitchen" || a.type === "pstores")) tot.food += w.sup;
      if (a && (a.type === "clinic" || a.type === "pharmacy")) tot.meds += w.sup;
      if (c.kind === "steelbunk") tot.cells += w.gear;
    }
  }
  const avg = (v) => Math.round((v / Math.max(1, SEEDS)) * 10) / 10;
  LOOT[kind] = { containers: avg(tot.boxes), supplies: avg(tot.sup), gear: avg(tot.gear), armory: avg(tot.armory), property: avg(tot.property), food: avg(tot.food), meds: avg(tot.meds), contraband: avg(tot.cells) };
  console.log(`  maps ${[...new Set(sizes)].slice(0, 6).join(", ")}; beds ${Math.min(...beds)}–${Math.max(...beds)}; ${cellsSeen} cells checked${towers ? `; ${Math.round(towers / SEEDS)} towers a map` : ""}`);
  check(ok2tier, `housing units with cells on two tiers${ok2tier ? "" : ` (${W.ok2tier})`}`);
  check(okCells, `every cell a steel bunk, a toilet and sink behind bars with a cell door${okCells ? "" : ` (${W.okCells})`}`);
  check(okRail, `the upper tier a walkway with a railing over an open well${okRail ? "" : ` (${W.okRail})`}`);
  check(okJoin, `${kind === "jail" ? "the pods joined to the jail" : "central control joined to every housing unit"} indoors${okJoin ? "" : ` (${W.okJoin})`}`);
  check(okBld, `the yard, the chow hall or kitchen, the infirmary or medical room${kind === "jail" ? ", booking, visitation, holding tanks, the property room" : " and the armory"}${okBld ? "" : ` (${W.okBld})`}`);
  if (kind !== "jail") { check(okPerim, `a perimeter of ${kind === "max" ? "a wall and a fence" : "a double fence"} with towers, crossed only at the gates${okPerim ? "" : ` (${W.okPerim})`}`); check(okGates, "the inside reached through the gates"); }
  check(okReach, `every walkable cell reachable from the entry${okReach ? "" : ` (${W.okReach})`}`);
  check(okUp, `every upper-floor cell reachable from the stairs${okUp ? "" : ` (${W.okUp})`}`);
  check(okSize, `the map at most ${PRISON.CAP} × ${PRISON.CAP} (the user's 400 × 400 at most)`);
  check(okLedger, `each building's containers apart (own ids, their building)${okLedger ? "" : ` (${W.okLedger})`}`);
  check(okRevisit, "a revisit restores it (the same map from the same dice)");
  check(Math.min(...beds) >= PRISON.KINDS[kind].beds[0] && Math.max(...beds) <= PRISON.KINDS[kind].beds[1], `the beds in ${PRISON.KINDS[kind].beds.join("–")} (${Math.min(...beds)}–${Math.max(...beds)})`);
}
console.log("The loot (expected over the tables, a map on average):");
for (const [k, L] of Object.entries(LOOT)) console.log(`  ${k}: ${L.containers} containers, ${L.supplies} supplies, ${L.gear} gear finds; the armory ${L.armory} (supplies + 10 × gear), the property room ${L.property} gear, the kitchen and stores ${L.food} food, meds ${L.meds}, the cells' contraband ${L.contraband}`);
for (const k of ["state", "max"]) check(LOOT[k].armory > 0 && LOOT[k].food > 0 && LOOT[k].property > 0 && LOOT[k].contraband > 0, `${k}: an armory, food in bulk, inmates' belongings and contraband`);

// ---------- the raid ----------
function world(seed) { const st = createWorld({ seed, factionCount: 6 }); st.cards.length = 0; return st; }
function raidOn(st, tile, raid = {}) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 3);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 30, meds: 2 } });
  if (res.error) return null;
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "ptest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile.id) }, raid: { heat0: 5, ...raid }, context: {} };
  st.combat = createBattle(st, setup);
  return { st, b: st.combat, p, setup, crew };
}
console.log("The raid on a prison");
let st = null, tile = null;
for (let s = 0; s < 40 && !tile; s++) { st = world(500 + s); tile = st.tiles.find((t) => t.loc && t.loc.type === "prison" && t.id !== hub(st).tile); }
check(!!tile, "a world has a prison");
if (tile) {
  const sb = siteBuildings(tile, st);
  check(sb && sb.single && sb.options[0].key === "prison", "a prison opens one complex (no pick of a building)");
  const R = raidOn(st, tile);
  check(!!R && !!R.b.raid.plan && R.b.raid.plan.complex, "the raid is on the complex");
  if (R) {
    const b = R.b, P = b.raid.plan;
    const intro = b.log.map((l) => l.text || l).join(" ");
    check(/Housing: Housing unit A/.test(intro) && /armory/.test(intro) && /sally port/.test(intro), `the plan's intro names the housing units, the armory and the gate`);
    const dead = b.units.filter((u) => u.kind === "zombie" && !u.dead);
    const housed = dead.filter((u) => b.raid.areas.some((a) => (a.prison === "tier" || a.prison === "dayroom" || a.prison === "dorm" || a.prison === "picket") && (a.f || 0) === (u.f || 0) && inR(a, u.x, u.y)));
    check(dead.length && housed.length / dead.length >= 0.35, `the dead dense in the housing units (${housed.length} of ${dead.length})`);
    const guardBodies = b.units.filter((u) => u.dead && u.name === "A corrections officer");
    check(guardBodies.length >= 3, `the guards dead at their posts with their kit (${guardBodies.length})`);
    check(b.raid.containers.some((c) => c.kind === "body" && c.full && c.kit === "guards"), "a guard's body is searched for their kit");
    check(b.raid.zones.every((z) => !P.perimeter || !inR(P.perimeter.outer, z.x0 + 1, z.y0 + 1)), "the ways out are outside the perimeter");
    // The switch: next to an officers' station's panel, its unit's cell doors open; loud.
    const pk = b.raid.areas.find((a) => a.prison === "picket" && !(a.f > 0));
    let panel = null;
    for (let y = pk.y0 + 1; y < pk.y0 + pk.h - 1 && !panel; y++) for (let x = pk.x0 + 1; x < pk.x0 + pk.w - 1 && !panel; x++) if (b.cells[y * b.w + x].k === "ctrlpanel") panel = [x, y];
    const u = b.units.find((q) => q.side === "player");
    if (panel && u) {
      const spot = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => [panel[0] + dx, panel[1] + dy]).find(([x, y]) => b.cells[y * b.w + x].k === "open" && b.cells[y * b.w + x].f === "floor");
      if (spot) {
        for (const o of b.units) if (o !== u && o.x === spot[0] && o.y === spot[1] && (o.f || 0) === 0) o.x = Math.max(1, o.x - 3);
        u.x = spot[0]; u.y = spot[1]; u.f = 0; u.ap = 2;
        const sw = switchPanel(b, u);
        const heat = b.raid.heat;
        const err = combatAct(R.st, { type: "cellswitch", unit: u.id });
        const shut = b.floors.flatMap((F) => F.cells).filter((c) => c.cellDoor && c.tier === pk.unitId && c.k !== "odoor").length;
        check(!err && sw && shut === 0 && b.raid.heat > heat, `the officers' station's panel opens its block's cell doors, loudly${err ? ` (${err})` : ""}`);
      } else check(false, "a cell next to the panel");
    } else check(false, "an officers' station's control panel");
    // The fence: a cutter takes FENCE_CUTS actions to make a hole.
    const fc = b.cells.findIndex((c) => c.k === "pfence");
    if (fc >= 0 && u) {
      const fx = fc % b.w, fy = (fc / b.w) | 0;
      const nb = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => [fx + dx, fy + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && b.cells[y * b.w + x].k === "open");
      const s = R.st.survivors.find((q) => q.id === u.sid);
      if (nb && s) {
        s.gear.weapon = newItem("machete");
        u.x = nb[0]; u.y = nb[1]; u.f = 0;
        let n = 0, err = "";
        for (; n < WIRE.FENCE_CUTS + 2 && b.cells[fc].k === "pfence"; n++) { u.ap = 1; err = cutAct(R.st, b, u, { x: fx, y: fy }, { say: () => {}, alertNear: () => {} }); if (err) break; }
        check(!err && n === WIRE.FENCE_CUTS && b.cells[fc].k === "open" && b.cells[fc].hole, `the fence is cut in ${n} actions with a cutter (${WIRE.FENCE_CUTS}), then a hole${err ? ` (${err})` : ""}`);
      }
    }
    // A save mid-raid loads as it was.
    const save = serializeState(R.st), back = deserializeState(save);
    const b2 = back.combat;
    check(b2 && b2.w === b.w && b2.floors.length === b.floors.length && b2.floors[1].cells.every((c, i) => c.k === b.floors[1].cells[i].k) && b2.raid.containers.length === b.raid.containers.length, `a save mid-raid restores the complex (${Math.round(JSON.stringify(save).length / 1024)} KB)`);
    // The turn with 100 dead at this size (headless).
    const b3 = b;
    for (const q of b3.units) if (q.side === "player") q.ap = 0;
    const deadNow = b3.units.filter((q) => q.kind === "zombie" && !q.dead).length;
    const tt = performance.now();
    endPlayerTurn(R.st); runEnemyPhase(R.st);
    console.log(`  a turn (the enemy phase) on ${b3.w} × ${b3.h} with ${deadNow} of the dead: ${Math.round(performance.now() - tt)} ms`);
  }
}
console.log("The turn at the biggest size: a maximum-security penitentiary with 100 of the dead (headless)");
{
  let R = null;
  for (let s = 0; s < 80 && !R; s++) {
    const w = world(1200 + s), t = w.tiles.find((q) => q.loc && q.loc.type === "prison" && q.id !== hub(w).tile);
    if (t && prisonKind(w, t.id, { key: "prison" }) === "max") R = raidOn(w, t);
  }
  if (check(!!R, "a world has a penitentiary")) {
    const b = R.b, rng = b.rng;
    const live = () => b.units.filter((q) => q.kind === "zombie" && !q.dead && !q.off);
    const free = [];
    for (const a of b.raid.areas) if (!a.outdoor && !(a.f > 0) && (a.prison === "dayroom" || a.prison === "tier" || a.prison === "chow" || a.role === "corridor")) for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) if (b.reach[y * b.w + x] && b.cells[y * b.w + x].k === "open" && !b.units.some((q) => q.x === x && q.y === y)) free.push([x, y]);
    let id = 900;
    while (live().length < 100 && free.length) { const [x, y] = free.splice(Math.floor(rng.next() * free.length), 1)[0]; const u = enemyUnit(b, rng, "zombies", 3, ++id); Object.assign(u, { x, y, f: 0, aware: false, pod: 500 + id, home: [x, y] }); b.units.push(u); }
    // Wake a third of them (the ones who heard the team come in): they hunt, the rest wander, as in play.
    live().forEach((q, i) => { if (i % 3 === 0) q.aware = true; });
    const times = [];
    for (let t = 0; t < (QUICK ? 2 : 4); t++) {
      for (const q of b.units) if (q.side === "player") q.ap = 0;
      const t1 = performance.now();
      endPlayerTurn(R.st); runEnemyPhase(R.st);
      times.push(performance.now() - t1);
      if (b.over) break;
    }
    const avg = Math.round(times.reduce((a, v) => a + v, 0) / times.length), max = Math.round(Math.max(...times));
    console.log(`  ${b.w} × ${b.h}, ${b.floors.length} floors, ${live().length} of the dead: a turn ${avg} ms on average, ${max} ms at most (${times.map((v) => Math.round(v)).join(", ")})`);
    check(avg < 1500, `a turn under 1.5 s headless with 100 of the dead (${avg} ms)`);
  }
}
console.log("Scenes, holders, an older save, the jail");
{
  const seen = new Set();
  for (let s = 0; s < (QUICK ? 10 : 24); s++) {
    const w = world(900 + (s % 3));
    const t = w.tiles.find((q) => q.loc && q.loc.type === "prison");
    if (!t) continue;
    t.id; // the scenes ride on the site's own dice: vary the option id instead
    const m = prisonMap(w, t.id, { key: "prison", id: `prison#${s}`, name: "State prison" }, false);
    const { rollScenes, sceneRng } = await import("../src/sim/interiorscenes.js");
    rollScenes(m, sceneRng(w, t.id, { id: `prison#${s}` }), "prison");
    for (const sc of (m.scenes && m.scenes.list) || []) seen.add(sc.kind);
  }
  const want = ["opened", "lockdown", "guardstand", "takeover", "bus"];
  check(want.every((k) => seen.has(k)), `the prisons' scenes appear (${[...seen].join(", ")})`);
  // An older save: the prison's pick of one building, no jails.
  const w = world(500);
  const t = w.tiles.find((q) => q.loc && q.loc.type === "prison");
  w.prisonLegacy = true;
  const sb = t ? siteBuildings(t, w) : null;
  check(!!sb && !sb.single && sb.options.some((o) => o.key === "cellblock"), "an older save keeps the prison's pick of one building (the roomsLegacy rule)");
  const anyJail = w.tiles.some((q) => generatePois(w, q).some((p) => p.kind === "jail"));
  check(!anyJail, "an older save has no county jails");
  w.prisonLegacy = false;
  const towns = w.tiles.filter((q) => q.loc && q.loc.type === "town").length;
  const jails = w.tiles.filter((q) => (q.pois || []).some((p) => p.kind === "jail"));
  check(jails.length >= 1 && jails.length <= towns, `a new world has county jails by its towns (${jails.length} for ${towns} towns)`);
  if (jails.length) {
    const jt = jails[0], i = jt.pois.findIndex((p) => p.kind === "jail");
    const R = raidOn(w, jt, { poi: i, place: poiPlace(jt, i) });
    check(!!R && R.b.raid.plan && R.b.raid.plan.complex === "jail" && R.b.raid.plan.units.length === 2, "a raid on a county jail opens the jail and its two pods");
  }
  // A prison gang holding a unit somewhere over the seeds.
  let held = 0;
  for (let s = 0; s < (QUICK ? 8 : 16) && !held; s++) {
    const ws = world(700 + s), tt = ws.tiles.find((q) => q.loc && q.loc.type === "prison" && q.id !== hub(ws).tile);
    if (!tt) continue;
    const R = raidOn(ws, tt);
    if (R && R.b.raid.holders) held = R.b.units.filter((q) => q.occupant === "hostile" && q.who).length || R.b.raid.holders.n;
  }
  check(held >= 3, `a prison gang holds a unit, survivor records of their own (${held})`);
}
console.log(`\n${passes} passed, ${fails} failed (${Math.round((performance.now() - t0) / 1000)} s)`);
process.exit(fails ? 1 : 0);
