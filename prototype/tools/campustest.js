// College campus maps (issue #28: src/sim/campus.js campusMap, src/sim/campuslayout.js, src/sim/compound.js).
// Usage: node tools/campustest.js [seed]   (BS_QUICK=1: fewer seeds per kind)
// - generation, over seeds per campus kind (community college, liberal arts college, state university): the building
//   counts in their range, at least one connected pair (a walkway, a corridor or a bridge) and one building standing
//   alone, a quad or a courtyard, the dorms (none needed at a community college) with rooms of beds and desks and a
//   lounge on every floor, every walkable cell reachable (the ground from the way in, every upper floor from its stairs
//   and bridges), every building's front door reached, the map at most CAMPUS.MAX (500) across, each building's
//   containers inside it (c.house) with ids 1..n, the same campus every time (and with a vehicle)
// - the raid (createBattle at a university): one map, the intro naming the buildings, the dead spread by building and
//   denser in the dorms and the dining hall, Heat's clock by the area searched, students holed up in a dorm
// - the site's ledger: a building opened and left, another never entered; after a save and a load the revisit shows the
//   first as it was left and the second fresh
// - older saves: a university whose buildings a raid went into keeps its three; a fresh one is a campus
// - colleges on the State Map (mapgen.js): in towns, named, a community or a liberal arts college each
// - the POI rules: poiHouses counts the campus's buildings; another group's abstract raid thins several buildings
// - the scenes: the dorm barricade, the lecture hall shelter, the overrun dining hall, the sealed lab, the quarantine
//   tent on a quad, each on some campus
// - loot: the expected finds per building kind and per campus (printed), dorms with personal things, labs meds and
//   parts, the dining hall food, the security office guns and radios
// - the named plans (campusplans.js CAMPUS_VARIANTS, the user's request 2026-10-25: a dozen a type): at least twelve a
//   type, their names and ids apart, each building (rooms reachable, its containers, laid out for its kind, a dorm's
//   lounge on every floor, the plan's name on it), every two of a type different in at least two of issue #32's ways
//   (the room list, the ground floor's order, the doors out, corridor or open plan, the footprint's shape, the storeys);
//   the twelve site layouts (CAMPUS.LAYOUTS) each a whole campus, reachable, its name on the plan and in the briefing
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, runEnemyPhase, finishCombat, searchBox, endPlayerTurn, CELL, AREAS, boxLoot } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { newItem } from "../src/sim/inventory.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { poiAt, poiPool, poiFull, isSitePoi } from "../src/sim/pois.js";
import { poiRaidSetup } from "../src/sim/poiraid.js";
import { contKey, ledgerBox, lootPoiAbstract, poiHouses } from "../src/sim/poicont.js";
import { buildingMap, siteBuildings, BUILDINGS } from "../src/sim/buildingmaps.js";
import { CAMPUS, campusKind, campusHeatDims, campusBuildings, campusBriefing, campusLayout } from "../src/sim/campus.js";
import { CAMPUS_PLANS } from "../src/sim/campuslayout.js";
import { CAMPUS_VARIANTS } from "../src/sim/campusplans.js";
import { pieceDef } from "../src/sim/data-furniture.js";
import { AREA_FINDS } from "../src/sim/loot.js";

const seed = Number(process.argv[2] || 42);
const QUICK = !!process.env.BS_QUICK;
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const univOf = (st) => st.tiles.find((t) => t.loc && t.loc.type === "univ");
const OPT = { id: "campus", key: "campus", name: "Campus" };
const pass = (c) => !!c && (!!(CELL[c.k] && CELL[c.k].walk) || c.k === "door" || c.k === "boarded" || (!!c.moved && c.hp > 0)); // a locked door, a scene's barricade: ways through
const walkable = (c) => !!c && (!!(CELL[c.k] && CELL[c.k].walk) || c.k === "door");
function flood(cells, w, h, starts) {
  const seen = new Uint8Array(w * h), q = [];
  for (const [x, y] of starts) { const i = y * w + x; if (pass(cells[i]) && !seen[i]) { seen[i] = 1; q.push(i); } }
  while (q.length) {
    const i = q.pop(), x = i % w;
    for (const j of [x + 1 < w ? i + 1 : -1, x > 0 ? i - 1 : -1, i + w < w * h ? i + w : -1, i - w]) if (j >= 0 && !seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); }
  }
  return seen;
}
const inRect = (r, x, y) => x >= r.x0 && y >= r.y0 && x < r.x0 + r.w && y < r.y0 + r.h;
const sigMap = (m) => m.floors.map((F) => F.cells.map((c) => c.k[0]).join("")).join("/") + "|" + m.containers.map((c) => `${c.id}:${c.kind}:${c.x},${c.y},${c.f || 0}:${c.area}:${c.house ?? "-"}`).join(" ");
const sceneKinds = new Set();

section("Generation: by campus kind, the same campus every time");
const perKind = {};
const worlds = [];
for (const kind of ["community", "liberal", "state"]) {
  const K = CAMPUS.KINDS[kind], counts = [], seeds = QUICK ? [seed, seed + 1] : [seed, seed + 1, seed + 2, seed + 3, seed + 4];
  for (const s of seeds) {
    const st = W(s), t = univOf(st);
    if (!check(!!t, `seed ${s}: a university on the map`)) continue;
    t.loc.campus = kind;
    const tag = `${kind} seed ${s}`;
    const t0 = Date.now();
    const m = buildingMap(st, t.id, OPT, false);
    const ms = Date.now() - t0;
    if (s === seed) worlds.push({ kind, st, t, m });
    const P = m.plan, H = P.houses, n = H.length;
    counts.push(n);
    for (const sc of (m.scenes && m.scenes.list) || []) sceneKinds.add(sc.kind);
    check(campusKind(st, t) === kind && P.campus && P.kindName === K.name, `${tag}: a ${K.name.toLowerCase()} (${m.w} × ${m.h}, ${n} buildings, built in ${ms} ms)`);
    check(n >= Math.min(K.n[0], K.must.length) && n <= K.n[1], `${tag}: ${n} buildings, in ${K.n[0]}–${K.n[1]}`);
    check(m.w <= CAMPUS.MAX && m.h <= CAMPUS.MAX && m.w <= 500 && m.h <= 500, `${tag}: the map at most ${CAMPUS.MAX} across (${m.w} × ${m.h})`);
    const joined = new Set(P.links.flatMap((L) => [L.a, L.b]));
    check(P.links.length >= 1 && H.some((h) => !joined.has(h.k)), `${tag}: ${P.links.length} connected pairs (${P.links.map((L) => `${L.type}${L.f ? ` on floor ${L.f + 1}` : ""}`).join(", ")}), ${H.filter((h) => !joined.has(h.k)).length} standing alone`);
    // Each link a room of its own with a door into each building.
    check(P.links.every((L) => { const a = m.rooms[L.area]; return a && a.link === L.type && L.doors.filter(([x, y]) => inRect(H[L.a], x, y) || inRect(H[L.b], x, y)).length >= 2; }), `${tag}: each link is a room with a door into each of its buildings`);
    check(P.links.filter((L) => L.type === "bridge").every((L) => L.f >= 1 && H[L.a].storeys > L.f && H[L.b].storeys > L.f), `${tag}: a bridge joins the same upper floor of both buildings`);
    const quads = P.grounds.filter((g) => g.kind === "quad" || g.kind === "courtyard");
    check(quads.length >= 1, `${tag}: ${P.grounds.filter((g) => g.kind === "quad").length} quads, ${P.grounds.filter((g) => g.kind === "courtyard").length} courtyards`);
    // The dorms.
    const dorms = H.filter((h) => h.key === "dorm");
    check(K.dorms[0] === 0 || dorms.length >= 1, `${tag}: ${dorms.length} residence halls${K.dorms[0] === 0 ? " (none needed)" : ""}`);
    const roomsOf = (h) => m.rooms.filter((a) => a.house === h.k);
    const pieceIn = (a, k) => { const F = m.floors[a.f || 0].cells; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) if (F[y * m.w + x].k === k) return true; return false; };
    let dormRooms = 0, bad = [];
    for (const h of dorms) {
      for (const a of roomsOf(h).filter((q) => q.campus === "dormroom")) { dormRooms++; if (!pieceIn(a, "bed") || !pieceIn(a, "dormdesk")) bad.push(a.name); }
      for (let f = 0; f < h.storeys; f++) if (!roomsOf(h).some((a) => (a.f || 0) === f && a.campus === "lounge")) bad.push(`${h.name} floor ${f + 1}: no lounge`);
    }
    check(!bad.length, `${tag}: ${dormRooms} dorm rooms each with a bed and a desk, a lounge on every floor of every dorm (${bad.slice(0, 3).join("; ") || "all"})`);
    // Reachability: the ground from the way in, every upper floor from its stairs (and its bridges).
    const z = m.zones[0], g0 = flood(m.cells, m.w, m.h, [[z.x0 + 1, z.y0 + 1]]);
    let walk = 0, got = 0;
    m.cells.forEach((c, j) => { if (walkable(c)) { walk++; if (g0[j]) got++; } });
    check(walk === got, `${tag}: every walkable cell of the ground floor reached from the way in (${got}/${walk})`);
    const ups = m.floors.slice(1).map((F, g) => { const f = g + 1, st0 = m.stairs.filter(([x, y]) => pass(F.cells[y * m.w + x])); return { f, seen: flood(F.cells, m.w, m.h, st0) }; });
    let uw = 0, ug = 0;
    for (const { f, seen } of ups) m.floors[f].cells.forEach((c, j) => { if (walkable(c) && c.k !== "void") { uw++; if (seen[j]) ug++; } });
    check(uw === ug, `${tag}: every walkable cell upstairs reached from the stairs (${ug}/${uw} on ${m.floors.length - 1} upper floors)`);
    check(H.every((h) => h.front && g0[h.front.y * m.w + h.front.x]) && m.zones.every((q) => g0[(q.y0 + 1) * m.w + q.x0 + 1]), `${tag}: every building's front door and every way out reached (${m.zones.length} ways out)`);
    // Containers: numbered 1..n, each building's inside it, the rest the lots' cars.
    check(m.containers.every((c, k) => c.id === k + 1 && m.rooms[c.area]), `${tag}: containers 1..${m.containers.length}, each in a room or a lot`);
    check(m.containers.filter((c) => c.house != null).every((c) => inRect(H[c.house], c.x, c.y)) && m.containers.filter((c) => c.house == null).every((c) => c.kind === "car" && m.rooms[c.area].type === "wreck"), `${tag}: each building's containers inside it (c.house), the rest cars in the lots`);
    check(new Set(m.containers.map((c) => contKey("campus", c.id))).size === m.containers.length && H.every((h) => m.containers.some((c) => c.house === h.k)), `${tag}: every building's containers apart in the ledger (${H.length} buildings)`);
    check(H.every((h, j) => H.every((q, k) => j === k || h.x0 + h.w <= q.x0 || q.x0 + q.w <= h.x0 || h.y0 + h.h <= q.y0 || q.y0 + q.h <= h.y0)), `${tag}: the buildings stand apart`);
    if (s === seed) {
      const m2 = buildingMap(st, t.id, OPT, false), mv = buildingMap(st, t.id, OPT, "car");
      check(sigMap(m) === sigMap(m2), `${tag}: the same campus twice`);
      check(m.containers.map((c) => `${c.id}:${c.x},${c.y}`).join() === mv.containers.map((c) => `${c.id}:${c.x},${c.y}`).join(), `${tag}: the same containers with a vehicle`);
    }
  }
  perKind[kind] = counts;
}
console.log(`  buildings by kind: ${Object.entries(perKind).map(([k, c]) => `${k} ${c.join(", ")}`).join("; ")}`);

section("Loot: what each building kind and each campus holds (expected finds of its containers' tables)");
{
  const val = (type, kind) => { const T = boxLoot(type, kind); if (!T) return {}; const o = {}; for (const [k, [p, lo, hi]] of Object.entries(T.loot)) o[k] = (o[k] || 0) + p * (lo + hi) / 2; o.gear = (T.gear || []).reduce((a, [, p]) => a + p, 0); return o; };
  const add = (a, b, f = 1) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v * f; return a; };
  const fmt = (o) => Object.entries(o).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ");
  const byKind = {}, nKind = {};
  for (const { kind, m } of worlds) {
    const tot = {};
    for (const c of m.containers) {
      const a = m.rooms[c.area], v = val(a.type, c.kind);
      add(tot, v);
      const h = c.house != null ? m.plan.houses[c.house] : null, k = h ? h.key : "lots";
      byKind[k] = add(byKind[k] || {}, v);
      const finds = AREA_FINDS[a.type];
      if (finds) byKind[k].finds = (byKind[k].finds || 0) + finds.p;
    }
    for (const h of m.plan.houses) nKind[h.key] = (nKind[h.key] || 0) + 1;
    console.log(`  ${kind}: ${m.containers.length} containers: ${fmt(tot)}`);
  }
  for (const [k, o] of Object.entries(byKind)) console.log(`    ${k}${nKind[k] ? ` (per building, ${nKind[k]} seen)` : ""}: ${fmt(Object.fromEntries(Object.entries(o).map(([q, v]) => [q, v / (nKind[k] || 1)])))}`);
  const per = (k) => Object.fromEntries(Object.entries(byKind[k] || {}).map(([q, v]) => [q, v / (nKind[k] || 1)]));
  check((per("dorm").food || 0) > 1 && (per("dorm").finds || 0) > 1, `dorms: food and personal things (phones, laptops: AREA_FINDS.house) (${fmt(per("dorm"))})`);
  check((per("sciencehall").meds || 0) > 0.5 && (per("sciencehall").parts || 0) > 0.5, `the science building: meds and parts (the lab's chemicals and electronics) (${fmt(per("sciencehall"))})`);
  check((per("dininghall").food || 0) > 5, `the dining hall: food (${fmt(per("dininghall"))})`);
  check(!byKind.security || ((per("security").ammo || 0) > 1 && (per("security").gear || 0) > 0.1), `campus security: guns and rounds (${fmt(per("security"))})`);
}

section("The raid on a state university");
let world = null;
{
  const st = W(), t = univOf(st);
  t.loc.campus = "state";
  const h = hub(st), crew = atBase(st, h.id).slice(0, 2);
  for (const s of crew) { s.skills.scavenging = 6; s.traits = []; s.traitTier = {}; s.perks = []; }
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 20 } });
  check(!res.error, `a team out (${res.error || "ok"})`);
  const p = res.party;
  st.cards.length = 0;
  const i = t.pois.findIndex((q, j) => isSitePoi(t, j));
  poiAt(t, i).pool = Math.max(poiAt(t, i).pool, poiFull(t, i));
  const raid = (stt, pp, tt, groups = []) => {
    pp.path = [tt.id]; pp.idx = 0; pp.dest = tt.id; pp.phase = "engaged"; pp.vehicle = null;
    const rs = poiRaidSetup(stt, tt, i);
    const setup = { mode: "raid", tile: tt.id, partyId: pp.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "the dead", groups }, raid: { heat0: 5, choose: rs.choose, poi: i, kind: rs.kind || null }, context: {} };
    stt.combat = createBattle(stt, setup);
    return stt.combat;
  };
  const sb = siteBuildings(t);
  check(sb && sb.single && sb.options[0].key === "campus" && BUILDINGS.campus.campus, "a university opens one campus map");
  const b = raid(st, p, t, [{ kind: "zombies", count: 30, power: 3, name: "the dead" }]);
  const R = b.raid, P = R.plan;
  const intro = b.log.map((l) => l.text).join(" ");
  check(R.interior.key === "campus" && P.campus && b.w <= CAMPUS.MAX, `the raid's map is the campus (${b.w} × ${b.h}, ${P.houses.length} buildings, ${R.storeys} storeys)`);
  check(/You reach the campus/.test(intro) && P.houses.every((q) => intro.includes(q.name)) && /Ways out:/.test(intro), "the intro names the buildings and the ways out");
  const brief = campusBriefing(b).join(" ");
  check(P.houses.every((q) => brief.includes(q.name)) && /nearest way in/.test(brief) && (!P.links.length || /Joined:/.test(brief)), `the raid plan lists the buildings by row with the nearest way in (${campusBriefing(b).length} lines)`);
  const dead = b.units.filter((u) => u.kind === "zombie");
  const where = (u) => P.houses.find((q) => inRect(q, u.x, u.y));
  const per = {};
  for (const u of dead) { const q = where(u), k = q ? q.key : "out"; per[k] = (per[k] || 0) + 1; }
  const area = (key) => P.houses.filter((q) => q.key === key).reduce((a, q) => a + q.w * q.h * q.storeys, 0);
  const dens = (key) => (per[key] || 0) / Math.max(1, area(key));
  const others = P.houses.filter((q) => !["dorm", "dininghall"].includes(q.key)).map((q) => q.key);
  const otherDens = others.reduce((a, k) => a + (per[k] || 0), 0) / Math.max(1, [...new Set(others)].reduce((a, k) => a + area(k), 0));
  check(dead.length >= 30 && dead.length <= CAMPUS.DEAD_MAX && (per.out || 0) >= 1 && Object.keys(per).length >= 5, `the dead: ${dead.length} (30 × the campus's area), ${per.out || 0} on the open ground, the rest in ${Object.keys(per).length - 1} kinds of building`);
  check(dens("dorm") + dens("dininghall") > otherDens, `the dorms and the dining hall the densest (${(dens("dorm") * 1000).toFixed(2)} and ${(dens("dininghall") * 1000).toFixed(2)} a thousand cells, the rest ${(otherDens * 1000).toFixed(2)})`);
  const [hw] = campusHeatDims(b);
  check(hw === 40 * 30, `Heat's clock reads the area searched, not the map's (${hw} cells before anything is opened)`);
  const big = P.houses.slice().sort((a, c) => c.w * c.h - a.w * a.h)[0];
  for (const c of R.containers.filter((q) => q.house === big.k).slice(0, 2)) c.searched = true;
  const [hw2] = campusHeatDims(b);
  check(hw2 > hw && hw2 < b.w * b.h, `searching a building grows it (${hw2} cells)`);
  for (const c of R.containers) c.searched = false;
  st.combat = null;
  // Students holed up in a dorm (floorfolk.js's survivors upstairs, CAMPUS.SURVIVORS of the time): forced on here.
  const was = CAMPUS.SURVIVORS;
  CAMPUS.SURVIVORS = 1;
  const bs = raid(st, p, t);
  CAMPUS.SURVIVORS = was;
  const S = bs.raid.folk && bs.raid.folk.survivors, room = S ? bs.raid.areas[S.room] : null, home = room && room.house != null ? bs.raid.plan.houses[room.house] : null;
  check(S && home && home.key === "dorm" && S.f >= 1 && bs.units.filter((u) => u.folk === "survivors").length >= 1, `students holed up in ${room ? room.name : "nowhere"} (floor ${S ? S.f + 1 : "-"}), its door barred (${S ? S.count : 0} of them)`);
  st.combat = null;
  world = { st, p, t, i, raid };
}

section("The site's ledger: each building apart, a revisit as it was left");
{
  const { st, p, t, i, raid } = world;
  const b = raid(st, p, t);
  const me = b.units.find((u) => u.side === "player" && !u.dead);
  const boxes = b.raid.containers.filter(ledgerBox), H = b.raid.plan.houses;
  const A = H.find((q) => q.key === "dorm") || H[0], Bh = H.find((q) => q.k !== A.k && q.key !== A.key) || H[H.length - 1];
  const inA = boxes.filter((c) => c.house === A.k).slice(0, 12), inB = boxes.filter((c) => c.house === Bh.k);
  for (const c of inA) { c.lock = c.lock ? { ...c.lock, open: true } : c.lock; searchBox(st, b, me, c, true); }
  const left = inA.find((c) => c.contents);
  if (left) { left.contents.gear.push(newItem("flashlight", 1)); left.contents.sup.food = (left.contents.sup.food || 0) + 3; }
  const sig = (c) => (c && c.contents ? JSON.stringify({ sup: Object.fromEntries(Object.entries(c.contents.sup || {}).sort()), gear: (c.contents.gear || []).map((g) => g.key) }) : "none");
  const saved = Object.fromEntries(inA.map((c) => [c.id, sig(c)]));
  for (const u of b.units) if (u.side === "player") u.left = true;
  endPlayerTurn(st); runEnemyPhase(st);
  check(b.over, "the raid ends (walked out)");
  finishCombat(st, b.setup, b.result);
  const L = poiAt(t, i).cont, mapId = "campus";
  check(inA.every((c) => L.mine[contKey(mapId, c.id)]) && inB.every((c) => !L.mine[contKey(mapId, c.id)]), `${A.name}'s ${inA.length} opened containers are in the ledger, ${Bh.name}'s are not`);
  check(L.maps[mapId] && L.maps[mapId].length === boxes.length, `the ledger knows the campus's ${boxes.length} containers as one map`);
  st.cards.length = 0;
  const st2 = deserializeState(serializeState(st));
  const p2 = st2.parties.find((x) => x.id === p.id), t2 = st2.tiles[t.id];
  st2.hour += 30;
  const b2 = raid(st2, p2, t2);
  const at = (id) => b2.raid.containers.find((c) => c.id === id);
  check(inA.every((c) => sig(at(c.id)) === saved[c.id] && at(c.id).mine), `after a save and a load, ${A.name} is as it was left (the flashlight and the tins too)`);
  check(inB.every((c) => !at(c.id).contents), `${Bh.name} is still unopened`);
  check(new RegExp(`been through ${A.name} before`).test(b2.log.map((l) => l.text).join(" ")), "the intro says which building you went through");
  st2.combat = null;
  // Another group's abstract raid (the POI rules: a building at a time) thins several buildings.
  const n = poiHouses(st2, t2, i);
  check(n === b2.raid.plan.houses.length && n === campusBuildings(st2, t2), `poiHouses counts the campus's ${n} buildings`);
  lootPoiAbstract(st2, 3, t2, i, 0.3);
  const b3 = raid(st2, p2, t2);
  const robbedIn = new Set(b3.raid.containers.filter((c) => c.ransacked === 3 && c.house != null).map((c) => c.house));
  check(robbedIn.size >= 3, `another group's raid ransacked containers in ${robbedIn.size} buildings`);
  st2.combat = null;
}

section("Older saves and the State Map");
{
  const st = W(), t = univOf(st);
  const i = t.pois.findIndex((q, j) => isSitePoi(t, j));
  check(siteBuildings(t).single && siteBuildings(t).options[0].key === "campus", "a university nobody has raided is a campus");
  const poi = poiAt(t, i);
  poi.cont = { n: 4, looted: {}, mine: {}, maps: { lab: [1, 2, 3, 4] }, took: 0, opened: {}, last: null };
  const old = siteBuildings(t);
  check(!old.single && old.options.map((o) => o.key).join() === "lab,offices,messhall", `one whose lab a raid went into keeps its buildings (${old.options.map((o) => o.name).join(", ")})`);
  poi.cont.maps = { campus: [1, 2] };
  check(siteBuildings(t).single, "one raided as a campus stays one");
  const colleges = st.tiles.filter((q) => q.loc && q.loc.type === "college");
  check(colleges.length >= 3 && colleges.every((q) => q.loc.settlement != null && st.tiles[q.loc.settlement].loc.type === "town" && /College/.test(q.loc.name)), `${colleges.length} colleges in towns (${colleges.slice(0, 3).map((q) => q.loc.name).join(", ")}…)`);
  check(colleges.every((q) => ["community", "liberal"].includes(campusKind(st, q))) && new Set(colleges.map((q) => campusKind(st, q))).size === 2, "each a community or a liberal arts college, both kinds on the map");
  check(colleges.every((q) => siteBuildings(q).single && siteBuildings(q).options[0].key === "campus"), "a college opens a campus map");
  check(new Set(st.tiles.filter((q) => q.loc).map((q) => q.loc.name)).size === st.tiles.filter((q) => q.loc).length, "every site's name unique, the colleges' among them");
  const c = colleges.find((q) => campusKind(st, q) === "community");
  if (c) { const m = buildingMap(st, c.id, OPT, false); check(m.plan.campus && m.plan.kindName === "Community college" && m.w <= 160, `${c.loc.name}: a community college of ${m.plan.houses.length} buildings on ${m.w} × ${m.h}`); }
}

section("The scenes");
{
  const want = ["dormbarricade", "lectureshelter", "diningoverrun", "sealedlab", "quarantine"];
  for (let s = seed + 10; s < seed + (QUICK ? 18 : 26) && !want.every((k) => sceneKinds.has(k)); s++) {
    const st = W(s), t = univOf(st);
    for (const kind of ["liberal", "state"]) { t.loc.campus = kind; const m = buildingMap(st, t.id, OPT, false); for (const sc of (m.scenes && m.scenes.list) || []) sceneKinds.add(sc.kind); }
  }
  for (const k of want) check(sceneKinds.has(k), `the ${k} scene turns up`);
}

section("The campus buildings alone (setup.raid.place)");
{
  const st = W(), t = univOf(st);
  for (const key of [...Object.keys(CAMPUS_PLANS), "chapel", "healthcentre"]) {
    const m = buildingMap(st, t.id, { id: `solo:${key}`, key, name: BUILDINGS[key].name }, false);
    const z = m.zones[0], g0 = flood(m.cells, m.w, m.h, [[z.x0 + 1, z.y0 + 1]]);
    let walk = 0, got = 0;
    m.cells.forEach((c, j) => { if (walkable(c)) { walk++; if (g0[j]) got++; } });
    const styled = m.rooms.filter((a) => !a.outdoor && (a.campus || a.civic || a.shop || a.office || a.lib || a.ind)).length;
    check(walk === got && m.containers.length > 0 && (key === "healthcentre" || styled >= Math.ceil(m.rooms.filter((a) => !a.outdoor).length * 0.6)), `${BUILDINGS[key].name}: ${m.rooms.filter((a) => !a.outdoor).length} rooms (${styled} laid out for their kind), ${m.containers.length} containers, ${m.storeys || 1} storeys, all reachable`);
  }
  const used = new Set();
  for (const key of Object.keys(CAMPUS_PLANS)) { const m = buildingMap(st, t.id, { id: `solo2:${key}`, key, name: key }, false); for (const F of m.floors || [{ cells: m.cells }]) for (const c of F.cells) used.add(c.k); }
  const mine = ["dormdesk", "minifridge", "lectureseat", "lectern", "fumehood", "carrel", "mailboxes"];
  check(mine.every((k) => used.has(k) && pieceDef(k)), `the new pieces stand in the buildings (${mine.filter((k) => !used.has(k)).join(", ") || mine.join(", ")})`);
}

section("The named plans: a dozen a building type");
{
  const st = W(), t = univOf(st), SEEDS_V = QUICK ? 1 : 3;
  const base = (n) => n.replace(/ \d+$/, "");
  for (const [key, list] of Object.entries(CAMPUS_VARIANTS)) {
    check(list.length >= 12 && new Set(list.map((V) => V.name)).size === list.length && new Set(list.map((V) => V.id)).size === list.length, `${CAMPUS_PLANS[key] ? BUILDINGS[key].name : key}: ${list.length} named plans (${list.map((V) => V.name).join(", ")})`);
    const bad = [], feats = [];
    list.forEach((V, i) => {
      for (let s = 0; s < SEEDS_V; s++) {
        const m = buildingMap(st, t.id, { id: `plan:${key}:${i}:${s}`, key, name: BUILDINGS[key].name, plan: i }, false);
        const z = m.zones[0], g0 = flood(m.cells, m.w, m.h, [[z.x0 + 1, z.y0 + 1]]);
        let walk = 0, got = 0, uw = 0, ug = 0;
        m.cells.forEach((c, j) => { if (walkable(c)) { walk++; if (g0[j]) got++; } });
        (m.floors || []).slice(1).forEach((F) => { const seen = flood(F.cells, m.w, m.h, m.stairs.filter(([x, y]) => pass(F.cells[y * m.w + x]))); F.cells.forEach((c, j) => { if (walkable(c)) { uw++; if (seen[j]) ug++; } }); });
        const rooms = m.rooms.filter((a) => !a.outdoor), nf = m.storeys || 1;
        const styled = rooms.filter((a) => a.campus || a.civic || a.shop || a.office || a.lib || a.ind).length;
        const lounges = key !== "dorm" || Array.from({ length: nf }, (_, f) => rooms.some((a) => (a.f || 0) === f && a.campus === "lounge")).every(Boolean);
        if (walk !== got || uw !== ug || !m.containers.length || !lounges || styled < Math.ceil(rooms.length * 0.6) || m.plan.variant !== V.name) bad.push(`${V.id} (seed ${s}: ${got}/${walk}, ${ug}/${uw} upstairs, ${m.containers.length} boxes, ${styled}/${rooms.length} styled${lounges ? "" : ", a floor with no lounge"})`);
        if (s === 0) feats.push({ id: V.id, list: [...new Set(rooms.map((a) => base(a.name)))].sort().join("|"), order: rooms.filter((a) => !a.f).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((a) => base(a.name)).join(">"),
          doors: m.exits.map((e) => e.side).sort().join(","), open: rooms.some((a) => a.role === "corridor") ? "corridor" : "open", foot: `${Math.round((m.building.w / m.building.h) * 2) / 2}`, storeys: `${(V.storeys || []).join("-")}` });
      }
    });
    check(!bad.length, `${BUILDINGS[key].name}: every plan builds, reachable, furnished for its kind, named on its map${bad.length ? `: ${bad.slice(0, 4).join("; ")}` : ""}`);
    const thin = [];
    for (let i = 0; i < feats.length; i++) for (let j = i + 1; j < feats.length; j++) { const d = ["list", "order", "doors", "open", "foot", "storeys"].filter((k) => feats[i][k] !== feats[j][k]); if (d.length < 2) thin.push(`${feats[i].id} ~ ${feats[j].id}`); }
    check(!thin.length, `${BUILDINGS[key].name}: every two plans differ in two ways or more${thin.length ? ` (not ${thin.join(", ")})` : ""}`);
  }
  // The site layouts: a liberal arts college laid out each way.
  const L0 = CAMPUS.LAYOUTS;
  check(L0.length >= 12 && new Set(L0.map((L) => L.name)).size === L0.length, `${L0.length} site layouts (${L0.map((L) => L.name).join(", ")})`);
  t.loc.campus = "liberal";
  const seen = new Set(), bad = [];
  for (const L of L0) {
    const m = buildingMap(st, t.id, { ...OPT, id: `campus:${L.id}`, layout: L.id }, false);
    const z = m.zones[0], g0 = flood(m.cells, m.w, m.h, [[z.x0 + 1, z.y0 + 1]]);
    let walk = 0, got = 0;
    m.cells.forEach((c, j) => { if (walkable(c)) { walk++; if (g0[j]) got++; } });
    const P = m.plan, sig = `${P.houses.map((h) => `${h.key}@${h.row}`).join(",")}|${P.links.map((q) => q.type).join(",")}|${P.grounds.map((g) => `${g.kind}${g.h}`).join(",")}`;
    seen.add(sig);
    if (walk !== got || P.layout !== L.id || campusLayout(st, t.id, { id: `campus:${L.id}`, layout: L.id }) !== L) bad.push(`${L.id} (${got}/${walk})`);
    if (L.id === "colleges" && !P.houses.some((h) => h.key === "dorm" && P.houses.some((q) => q.row === h.row && q.key !== "dorm" && q.key !== "dininghall"))) bad.push("colleges: no dorm among the academic buildings");
    if (L.id === "skybridges" && P.links.some((q) => q.type === "walkway")) bad.push("skybridges: a walkway");
    if (L.id === "connected" && P.links.some((q) => q.type !== "corridor")) bad.push("connected: a link not a corridor");
  }
  delete t.loc.campus;
  check(!bad.length && seen.size === L0.length, `every site layout lays a whole campus out its own way (${seen.size} different, every cell reachable)${bad.length ? `: ${bad.join("; ")}` : ""}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
