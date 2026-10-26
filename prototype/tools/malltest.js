// Shopping malls (src/sim/mall.js, malllayout.js, compound.js; buildingmaps.js SITES mall / stripmall / outlet;
// pois.js mallExtra; poicont.js poiHouses). Issue #30.
// Usage: node tools/malltest.js [seed]   (BS_QUICK=1: fewer malls a kind)
// Per variant (strip mall, regional mall, outlet centre), over several malls each:
// - the storefronts and the anchors in range; a regional mall's concourse, food court and cinema; at most MALL.CAP a side
// - every shop: a storefront door onto the concourse (the walk, the street) and a service door at the back onto the
//   service corridor (the alley, the lane)
// - the levels joined by escalators (stair runs) and a lift, both on every level, and the service stairs
// - everything reachable: every walkable cell of the ground floor from the entry zone (locked doors and a scene's
//   barricades as ways through), every upper floor's from its stairs, every container from a reached cell, every zone
// - each shop's containers apart (c.house, ids 1..n), each shop's rooms inside it; the same mall twice
// - the catalogue's new kinds on the map; the scenes registered with a when (only a mall's map has them)
// The raid on it (createBattle): the plan's intro naming the anchors, the dead crowded at the food court and the
// cinema, a shop's containers opened and left, the revisit restoring them and another shop fresh; poiHouses; a mall
// raided before (the old buildings in its ledger) keeps them; strip malls and outlets placed as POIs, never a city's.
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, runEnemyPhase, finishCombat, searchBox, endPlayerTurn, CELL } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { poisOf, isSitePoi } from "../src/sim/pois.js";
import { poiRaidSetup, poiPlace } from "../src/sim/poiraid.js";
import { contKey, ledgerBox, poiHouses } from "../src/sim/poicont.js";
import { buildingMap, siteBuildings, BUILDINGS, SITES } from "../src/sim/buildingmaps.js";
import { MALL, STRIP_VARIANTS, REGIONAL_VARIANTS, OUTLET_VARIANTS, DEPT_VARIANTS, deptstorePlan, UNIT_VARIANTS, mallArchetype } from "../src/sim/mall.js";
import { Rng } from "../src/sim/rng.js";
import { assemble } from "../src/sim/buildingmaps.js";
import { MALL_SCENES } from "../src/sim/malllayout.js";
import { SCENE_KINDS } from "../src/sim/interiorscenes.js";
import { FURNITURE_KINDS } from "../src/sim/data-furniture.js";

const seed = Number(process.argv[2] || 11);
const QUICK = !!process.env.BS_QUICK;
const PER = QUICK ? 3 : 8;
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };

const pass = (c) => !!c && (!!(CELL[c.k] && CELL[c.k].walk) || c.k === "door" || c.k === "boarded" || (!!c.moved && c.hp > 0));
function floodFrom(cells, w, h, starts) {
  const seen = new Uint8Array(w * h), q = [];
  for (const [x, y] of starts) if (pass(cells[y * w + x]) && !seen[y * w + x]) { seen[y * w + x] = 1; q.push(y * w + x); }
  while (q.length) {
    const i = q.pop(), x = i % w;
    for (const j of [x + 1 < w ? i + 1 : -1, x > 0 ? i - 1 : -1, i + w < w * h ? i + w : -1, i - w]) if (j >= 0 && !seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); }
  }
  return seen;
}
// The cells a container is searched from (combat.js boxRing: the eight round it).
const ring = (c) => { const w = c.w || 1, h = c.h || 1, out = []; for (let y = c.y - 1; y <= c.y + h; y++) for (let x = c.x - 1; x <= c.x + w; x++) if (x < c.x || x >= c.x + w || y < c.y || y >= c.y + h) out.push([x, y]); return out; };
const sigMap = (m) => m.floors.map((F) => F.cells.map((c) => c.k[0] + (c.k === "stairs" ? c.step : "")).join("")).join("/") + "|" + m.containers.map((c) => `${c.id}:${c.kind}:${c.x},${c.y},${c.f || 0}:${c.area}:${c.house ?? "-"}`).join(" ");
const RANGE = { stripmall: [5, 12], regionalmall: [40, 120], outlet: [12, 30] };
const ANCHORS = { stripmall: [0, 2], regionalmall: [1, 4], outlet: [0, 0] }; // by the variant (STRIP_VARIANTS: none to two; a dead mall's second anchor dark)
const kindsSeen = new Set(), storeLog = {}, lootLog = {};
const LOOT_VALUE = { food: 1, water: 1, meds: 3, ammo: 0.2, scrap: 0.5, parts: 1, fuel: 1 };

// ---------------------------------------------------------------------------------------------------------------------
section("Generation: each kind, many malls");
const st0 = W(seed);
for (const key of ["stripmall", "regionalmall", "outlet"]) {
  storeLog[key] = []; lootLog[key] = [];
  for (let s = 0; s < PER; s++) {
    const tileId = 50 + s * 37, opt = { id: `${key}`, key, name: BUILDINGS[key].name };
    const t0 = Date.now();
    const m = buildingMap(st0, tileId, opt, false);
    const ms = Date.now() - t0;
    const P = m.plan, tag = `${key} #${s} (tile ${tileId}, ${m.w} × ${m.h}, ${m.storeys} level${m.storeys > 1 ? "s" : ""}, ${ms} ms)`;
    storeLog[key].push({ w: m.w, h: m.h, levels: m.storeys, storefronts: P.storefronts, shops: P.shops, vacant: P.vacant, anchors: P.anchors.map((a) => a.name), conts: m.containers.length, ms });
    check(m.compound && P.mall && P.kind === key, `${tag}: a mall's map`);
    check(m.w <= MALL.CAP && m.h <= MALL.CAP && m.w <= 500 && m.h <= 500, `${tag}: at most ${MALL.CAP} a side`);
    const [lo, hi] = RANGE[key];
    check(P.storefronts >= lo && P.storefronts <= hi, `${tag}: ${P.storefronts} storefronts (${lo}–${hi})`);
    check(P.anchors.length >= ANCHORS[key][0] && P.anchors.length <= ANCHORS[key][1], `${tag}: ${P.anchors.length} anchors (${P.anchors.map((a) => a.name).join(", ")})`);
    if (key === "regionalmall") {
      check(m.rooms.some((a) => a.role === "concourse" && a.f === 0) && m.rooms.some((a) => a.role === "foodcourt"), `${tag}: the concourse and the food court`);
      check(P.houses.some((h) => h.key === "cinema") && m.rooms.filter((a) => a.role === "screen").length >= 2, `${tag}: the cinema and its screens`);
      check(P.houses.some((h) => h.key === "mallservices") && m.rooms.some((a) => a.type === "mallsec") && m.rooms.some((a) => /First-aid/.test(a.name)), `${tag}: mall security and the first-aid room`);
      check(m.storeys >= 1 && m.storeys <= 3, `${tag}: 1–3 levels`);
      if (m.storeys > 1) {
        const all = (r) => r.f0 === 0 && r.f1 === m.storeys - 1;
        check(m.runs.filter((r) => r.esc && all(r)).length >= 2 && m.runs.some((r) => r.lift && r.single && all(r)), `${tag}: escalators and a lift join every level (${m.runs.filter((r) => r.esc).length} escalators)`);
        check(m.runs.some((r) => !r.esc && !r.lift && r.house == null && all(r)), `${tag}: the service stairs`);
        for (const r of m.runs.filter((q) => q.house == null)) for (let f = r.f0; f <= r.f1; f++) { const c = m.floors[f].cells[(r.y + (r.len - 1) * r.dy) * m.w + r.x + (r.len - 1) * r.dx]; if (!c || c.k !== "stairs" || !c.top) { check(false, `${tag}: the run at ${r.x},${r.y} tops out on floor ${f}`); break; } }
      }
    }
    // Shops: their storefront and their service door.
    const shops = P.houses.filter((h) => h.role === "shop" || h.role === "vacant" || h.role === "food");
    let noFront = [], noBack = [];
    for (const h of shops) {
      const f = h.f0 || 0, cells = m.floors[f].cells;
      const isDoor = (x, y) => /door/.test((cells[y * m.w + x] || {}).k || "");
      const onEdge = (x, y, side) => (side === "n" ? y === h.y0 : side === "s" ? y === h.y0 + h.h - 1 : side === "w" ? x === h.x0 : x === h.x0 + h.w - 1);
      const sides = { n: [], s: [], e: [], w: [] };
      for (let y = h.y0; y < h.y0 + h.h; y++) for (let x = h.x0; x < h.x0 + h.w; x++) for (const sd of ["n", "s", "e", "w"]) if (onEdge(x, y, sd) && isDoor(x, y)) sides[sd].push([x, y]);
      const front = h.front, fside = front ? (front.y === h.y0 ? "n" : front.y === h.y0 + h.h - 1 ? "s" : front.x === h.x0 ? "w" : "e") : null;
      const back = { n: "s", s: "n", e: "w", w: "e" }[fside];
      if (!front) noFront.push(h.name);
      const out = (x, y, sd) => { const [dx, dy] = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[sd]; return cells[(y + dy) * m.w + x + dx]; };
      const backOk = back && sides[back].some(([x, y]) => { const o = out(x, y, back); return o && pass(o); });
      if (!backOk) noBack.push(h.name);
      if (key === "regionalmall" && backOk) { const [x, y] = sides[back][0], [dx, dy] = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[back]; const a = m.rooms.find((r) => r.f === f && r.mall === "service" && x + dx >= r.x0 && x + dx < r.x0 + r.w && y + dy >= r.y0 && y + dy < r.y0 + r.h); if (!a) noBack.push(`${h.name} (not onto a service corridor)`); }
    }
    check(!noFront.length, `${tag}: every shop has its storefront door (${noFront.slice(0, 3).join(", ") || "all " + shops.length})`);
    check(!noBack.length, `${tag}: every shop has a back door onto the service corridor (${noBack.slice(0, 4).join("; ") || "all " + shops.length})`);
    // Reachability.
    const z = m.zones[0];
    const g = floodFrom(m.cells, m.w, m.h, [[z.x0 + 1, z.y0 + 1]]);
    let walk = 0, got = 0;
    const lost = [];
    m.cells.forEach((c, j) => { if (pass(c)) { walk++; if (g[j]) got++; else if (lost.length < 3) lost.push(`${j % m.w},${(j / m.w) | 0}:${c.k}`); } });
    check(walk === got, `${tag}: every walkable cell of the ground floor reached from the entry (${got}/${walk}; ${lost.join(" ")})`);
    const up = m.floors.map((F, f) => (f ? floodFrom(F.cells, m.w, m.h, m.stairs) : g));
    for (let f = 1; f < m.storeys; f++) {
      let w2 = 0, g2 = 0;
      const lost2 = [];
      m.floors[f].cells.forEach((c, j) => { if (pass(c)) { w2++; if (up[f][j]) g2++; else if (lost2.length < 3) lost2.push(`${j % m.w},${(j / m.w) | 0}:${c.k}`); } });
      check(w2 === g2, `${tag}: every walkable cell of level ${f + 1} reached from the stairs (${g2}/${w2}; ${lost2.join(" ")})`);
    }
    const reachBox = (c) => ring(c).some(([x, y]) => x >= 0 && y >= 0 && x < m.w && y < m.h && up[c.f || 0][y * m.w + x]);
    const unreached = m.containers.filter((c) => !reachBox(c));
    check(!unreached.length, `${tag}: every container searched from a reached cell (${unreached.slice(0, 3).map((c) => c.label).join("; ") || "all " + m.containers.length})`);
    check(m.zones.every((q) => g[(q.y0 + 1) * m.w + q.x0 + 1]) && new Set(m.zones.map((q) => q.side)).size >= 3, `${tag}: ${m.zones.length} ways out on ${new Set(m.zones.map((q) => q.side)).size} sides, all reached`);
    // The ledger: every container numbered, each shop's apart.
    check(m.rooms.every((a, i) => a.id === i) && m.containers.every((c, i) => c.id === i + 1 && m.rooms[c.area]), `${tag}: rooms numbered on, containers 1..${m.containers.length} each in a room`);
    const inside = P.houses.every((h) => m.containers.filter((c) => c.house === h.k).every((c) => c.x >= h.x0 && c.y >= h.y0 && c.x < h.x0 + h.w && c.y < h.y0 + h.h));
    check(inside && P.houses.every((h) => m.rooms.filter((a) => a.house === h.k).every((a) => a.x0 >= h.x0 && a.y0 >= h.y0 && a.x0 + a.w <= h.x0 + h.w && a.y0 + a.h <= h.y0 + h.h)), `${tag}: each building's rooms and containers inside it (c.house)`);
    const withBoxes = shops.filter((h) => h.role === "shop" && m.containers.some((c) => c.house === h.k));
    check(withBoxes.length >= Math.max(1, shops.filter((h) => h.role === "shop").length - 1), `${tag}: shops with containers of their own (${withBoxes.length}/${shops.filter((h) => h.role === "shop").length})`);
    if (s < 2) check(sigMap(m) === sigMap(buildingMap(st0, tileId, opt, false)), `${tag}: the same mall twice`);
    for (const F of m.floors) for (const c of F.cells) if (FURNITURE_KINDS[c.k]) kindsSeen.add(c.k);
    // Loot: the value of what the containers' rooms hold on average (AREAS tables), for the report.
    lootLog[key].push(m.containers.length);
  }
}
for (const key of Object.keys(storeLog)) {
  const L = storeLog[key], avg = (f) => (L.reduce((a, x) => a + f(x), 0) / L.length).toFixed(1);
  console.log(`  ${key}: ${avg((x) => x.w)} × ${avg((x) => x.h)} cells, ${avg((x) => x.levels)} levels, ${avg((x) => x.storefronts)} storefronts (${Math.min(...L.map((x) => x.storefronts))}–${Math.max(...L.map((x) => x.storefronts))}), ${avg((x) => x.shops)} shops, ${avg((x) => x.vacant)} vacant, ${avg((x) => x.conts)} containers, ${avg((x) => x.ms)} ms; anchors: ${[...new Set(L.flatMap((x) => x.anchors))].join(", ") || "none"}`);
}
section("The catalogue's new kinds on the maps; the scenes");
for (const k of ["kiosk", "mallbench", "planter", "fountain", "directory", "escalator", "cinemaseat", "projector", "concession", "arcadecab", "carousel"]) check(kindsSeen.has(k), `${k} stands in a mall`);
check(MALL_SCENES.every((k) => SCENE_KINDS[k] && typeof SCENE_KINDS[k].when === "function"), "the five mall scenes registered with a when");
{
  const fakeHouse = buildingMap(st0, 3, { id: "house", key: "house", name: "House" }, false);
  check(MALL_SCENES.every((k) => !SCENE_KINDS[k].when({ map: fakeHouse, rooms: fakeHouse.rooms })), "a house's map never has them");
  const seen = new Set();
  for (let s = 0; s < (QUICK ? 30 : 60); s++) { const m = buildingMap(st0, 200 + s, { id: "regionalmall", key: "regionalmall", name: "Mall" }, false); for (const sc of (m.scenes && m.scenes.list) || []) seen.add(sc.kind); }
  for (const k of MALL_SCENES) check(seen.has(k), `the ${k} scene turns up`);
}

// ---------------------------------------------------------------------------------------------------------------------
section("A dozen plans a type (issue #32's rule): each mall kind's variants and the department store's");
{
  const sigOf = (m) => { const P = m.plan, roles = {}; for (const h of P.houses) roles[h.role] = (roles[h.role] || 0) + 1; return JSON.stringify({ lv: m.storeys, an: P.anchors.length, roles, food: !!P.foodCourt, cin: !!P.cinema, gar: !!P.garage, ww: P.walkways || 0, shape: Math.round(m.w / 40) + "x" + Math.round(m.h / 40), faces: [...new Set(P.houses.filter((h) => h.role === "shop" || h.role === "vacant").map((h) => h.face))].sort().join(""), top: (() => { const n = {}; for (const h of P.houses) if (h.role === "shop") n[h.key] = (n[h.key] || 0) + 1; return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || ""; })(), pads: P.houses.filter((h) => h.role === "pad").map((h) => h.key).join(","), lib: P.houses.some((h) => h.key === "library"), anchors: P.anchors.map((a) => a.kind).sort().join(","), plaza: (() => { const pz = m.rooms.find((a) => a.role === "plaza"); return pz ? Math.round(((pz.x0 + pz.w / 2) / m.w) * 3) : -1; })(), fcAt: (m.rooms.find((a) => a.role === "foodcourt") || {}).f ?? -1, cinAt: (P.houses.find((h) => h.key === "cinema") || {}).f0 ?? -1, cinW: Math.round(((P.houses.find((h) => h.key === "cinema") || {}).w || 0) / 10), vac: Math.round((P.vacant / Math.max(1, P.storefronts)) * 5) }); };
  for (const [key, list] of [["stripmall", STRIP_VARIANTS], ["regionalmall", REGIONAL_VARIANTS], ["outlet", OUTLET_VARIANTS]]) {
    check(list.length >= 12 && new Set(list.map((v) => v.id)).size === list.length && new Set(list.map((v) => v.name)).size === list.length, `${key}: ${list.length} named variants (${list.map((v) => v.name).join(", ")})`);
    const sigs = new Set(), bad = [];
    for (const V of list) {
      const m = buildingMap(st0, 77, { id: key, key, name: BUILDINGS[key].name, variant: V.id }, false);
      if (m.plan.vid !== V.id || m.plan.variant !== V.name) bad.push(`${V.id}: plan says ${m.plan.vid}`);
      const [lo, hi] = RANGE[key];
      if (m.plan.storefronts < lo || m.plan.storefronts > hi || m.w > MALL.CAP || m.h > MALL.CAP) bad.push(`${V.id}: ${m.plan.storefronts} storefronts, ${m.w} × ${m.h}`);
      sigs.add(sigOf(m));
    }
    check(!bad.length, `${key}: every variant built, named on its plan, in range (${bad.slice(0, 3).join("; ") || "all"})`);
    check(sigs.size >= 12, `${key}: ${sigs.size} distinct plans (levels, anchors, the buildings by role, the food court, the cinema, the garage, walkways, shape, vacancy)`);
  }
  check(DEPT_VARIANTS.length >= 12 && new Set(DEPT_VARIANTS.map((v) => v.name)).size === DEPT_VARIANTS.length, `deptstore: ${DEPT_VARIANTS.length} named variants`);
  const dsigs = new Set(), dbad = [];
  for (const V of DEPT_VARIANTS) {
    const r = new Rng(31), spec = deptstorePlan(r, { variant: V.id }), m = assemble(r, spec, { key: "deptstore", name: "Department store" });
    if (spec.vid !== V.id || spec.vname !== V.name) dbad.push(`${V.id}: unnamed`);
    const rooms = m.rooms.filter((a) => !a.outdoor);
    if (!rooms.some((a) => a.role === "sales" && a.entry) || !m.containers.length) dbad.push(`${V.id}: no sales floor or nothing to search`);
    dsigs.add(JSON.stringify({ st: m.storeys, rooms: [...new Set(rooms.map((a) => `${a.role}:${a.name.replace(/[ ,]*floor \d+$/, "")}`))].sort(), big: Math.round((spec.bw * spec.bh) / 150) }));
  }
  check(!dbad.length, `deptstore: every variant a sales floor at its front and containers (${dbad.join("; ") || "all"})`);
  check(dsigs.size >= 12, `deptstore: ${dsigs.size} distinct plans (rooms, storeys, footprint)`);
  // A mall's own units (mall.js UNIT_VARIANTS): a dozen named variants each, every one built at the narrowest slot it
  // takes (its min; a cinema at its narrowest, a utility room 6 wide) and 15 deep, named on its spec; a cinema's two
  // screens and more and its booth, the offices' mall security and first-aid room in every one; a dozen plans by rooms.
  for (const [kind, list] of Object.entries(UNIT_VARIANTS)) {
    const ubad = [], usigs = new Set();
    for (const V of list) {
      const w = kind === "cinema" ? MALL.CINEMA.W[0] : Math.max(V.min || 0, V.min === 0 && kind === "mallrestrooms" ? 6 : 10);
      let m, spec;
      try { const r = new Rng(17); spec = mallArchetype(kind, r, { variant: V.id, w, d: 15 }); m = assemble(r, spec, { key: kind, name: kind }); } catch (e) { ubad.push(`${V.id}: ${e.message}`); continue; }
      const rooms = m.rooms.filter((a) => !a.outdoor);
      if (spec.vid !== V.id || spec.vname !== V.name) ubad.push(`${V.id}: unnamed`);
      if (kind === "cinema" && (rooms.filter((a) => a.role === "screen").length < 2 || !rooms.some((a) => a.role === "projection"))) ubad.push(`${V.id}: screens or booth`);
      if (kind === "mallservices" && (!rooms.some((a) => a.type === "mallsec") || !rooms.some((a) => /First-aid/.test(a.name)))) ubad.push(`${V.id}: security or first aid`);
      usigs.add([...new Set(rooms.map((a) => a.role))].sort().join(","));
    }
    check(list.length >= 12 && new Set(list.map((v) => v.name)).size === list.length && !ubad.length, `${kind}: ${list.length} named variants, each built at its narrowest slot (${ubad.slice(0, 3).join("; ") || "all"})`);
    check(usigs.size >= 12, `${kind}: ${usigs.size} distinct plans by their rooms`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
section("Sites and places");
check(SITES.mall.length === 1 && SITES.mall[0] === "regionalmall" && BUILDINGS.regionalmall.compound && SITES.stripmall && SITES.outlet, "the mall site is a regional mall; strip malls and outlets have their sites");
{
  let strip = 0, outlet = 0, cityStrip = 0, malls = 0;
  for (const s of [seed, seed + 1]) {
    const st = W(s);
    for (const t of st.tiles) {
      poisOf(t).forEach((q) => { if (q.kind === "stripmall") { strip++; if (t.terrain === "city") cityStrip++; } if (q.kind === "outlet") outlet++; });
      if (t.loc && t.loc.type === "mall") malls++;
    }
  }
  check(strip > 0 && outlet > 0 && cityStrip === 0, `strip malls (${strip}) and outlets (${outlet}) placed, none on a city block`);
  check(malls > 0, `regional malls on the cities' edges (${malls})`);
}

// ---------------------------------------------------------------------------------------------------------------------
section("The raid: the intro, the dead, the ledger kept shop by shop, the revisit");
function team(st) {
  const h = hub(st), crew = atBase(st, h.id).slice(0, 2);
  for (const s of crew) { s.skills.scavenging = 6; s.traits = []; s.traitTier = {}; s.perks = []; }
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 0 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  st.cards.length = 0;
  return res.party;
}
function raid(st, p, t, i, groups) {
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged"; p.vehicle = null;
  const rs = poiRaidSetup(st, t, i);
  const setup = { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "the dead", groups: groups || [] }, raid: { heat0: 5, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null }, context: {} };
  st.combat = createBattle(st, setup);
  return st.combat;
}
function end(st, b) {
  for (const u of b.units) if (u.side === "player") u.left = true;
  endPlayerTurn(st); runEnemyPhase(st);
  finishCombat(st, b.setup, b.result);
}
const me = (b) => b.units.find((u) => u.side === "player" && !u.dead);
{
  const st = W(seed);
  const t = st.tiles.find((x) => x.loc && x.loc.type === "mall" && Array.isArray(x.pois) && x.pois[0] && x.pois[0].site);
  if (check(!!t, "a world has a regional mall site")) {
    const sb = siteBuildings(t);
    check(sb && sb.single && sb.options[0].key === "regionalmall", "its building is the whole mall");
    const p = team(st);
    const t0 = Date.now();
    const b = raid(st, p, t, 0, [{ kind: "zombies", count: 20, power: 3 }]);
    const setupMs = Date.now() - t0;
    check(b.raid.plan && b.raid.plan.mall && b.w <= MALL.CAP, `the raid is on the mall's map (${b.w} × ${b.h}, set up in ${setupMs} ms)`);
    const log = b.log.map((l) => l.text || l).join(" ");
    check(/Anchor/.test(log) && b.raid.plan.anchors.every((a) => log.includes(a.name)), "the intro names the anchors");
    const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie");
    const roomOf = (u) => b.raid.areas.find((a) => !a.outdoor && (a.f || 0) === (u.f || 0) && u.x > a.x0 && u.x < a.x0 + a.w - 1 && u.y > a.y0 && u.y < a.y0 + a.h - 1);
    const area = (a) => Math.max(1, (a.w - 2) * (a.h - 2));
    const crowd = (pred) => { const rooms = b.raid.areas.filter((a) => !a.outdoor && pred(a)); const n = dead.filter((u) => { const r = roomOf(u); return r && pred(r); }).length; return n / Math.max(1, rooms.reduce((s, a) => s + area(a), 0)); };
    const fc = crowd((a) => a.role === "foodcourt" || a.role === "screen"), rest = crowd((a) => a.role !== "foodcourt" && a.role !== "screen");
    check(dead.length >= 20, `the dead of a big map (${dead.length})`);
    check(fc > rest, `the dead thicker at the food court and the cinema (${(fc * 100).toFixed(2)} vs ${(rest * 100).toFixed(2)} a hundred cells)`);
    check(poiHouses(st, t, 0) === b.raid.plan.houses.length && poiHouses(st, t, 0) > 30, `poiHouses: the mall's ${b.raid.plan.houses.length} buildings`);
    // Open a box in one shop, leave the rest.
    const boxes = b.raid.containers.filter((c) => ledgerBox(c) && !c.contents && !c.searched); // fresh ones (the pool has others marked ransacked)
    const shopA = b.raid.plan.houses.find((h) => h.role === "shop" && boxes.some((c) => c.house === h.k && !c.lockKind && (c.f || 0) === 0));
    const shopB = b.raid.plan.houses.find((h) => h !== shopA && h.role === "shop" && boxes.some((c) => c.house === h.k));
    const boxA = boxes.find((c) => c.house === shopA.k && !c.lockKind && (c.f || 0) === 0);
    const u = me(b);
    const side = ring(boxA).find(([x, y]) => b.cells[y * b.w + x] && CELL[b.cells[y * b.w + x].k].walk);
    u.x = side[0]; u.y = side[1];
    searchBox(st, b, u, boxA, true);
    const before = JSON.stringify(boxA.contents || {});
    end(st, b);
    const led = t.pois[0].cont;
    check(led && led.mine[contKey("regionalmall", boxA.id)], `the ledger keeps ${shopA.name}'s container as left`);
    check(!boxes.filter((c) => c.house === shopB.k).some((c) => led.mine[contKey("regionalmall", c.id)]), `${shopB.name} untouched in the ledger`);
    const b2 = raid(st, p, t, 0, []);
    const again = b2.raid.containers.find((c) => c.id === boxA.id);
    check(!!boxA.contents && again && !!again.contents && JSON.stringify(again.contents) === before, "the revisit restores the shop's container as it was left");
    const bBoxes = b2.raid.containers.filter((c) => c.house === shopB.k && ledgerBox(c));
    check(bBoxes.every((c) => !t.pois[0].cont.mine[contKey("regionalmall", c.id)]) && bBoxes.some((c) => !c.contents), `another shop (${shopB.name}) fresh on the revisit (only the pool's share thinned by others: ${bBoxes.filter((c) => !c.contents).length}/${bBoxes.length} unopened)`);
    end(st, b2);
    // A mall raided before the malls (its ledger has the old buildings' maps): it keeps them.
    const t2 = st.tiles.find((x) => x !== t && x.loc && x.loc.type === "mall" && x.pois && x.pois[0] && x.pois[0].site) || t;
    const saved = t2.pois[0].cont;
    t2.pois[0].cont = { n: 4, looted: {}, mine: {}, maps: { deptstore: [1, 2, 3, 4] }, took: 0, opened: {}, last: null };
    const old = siteBuildings(t2);
    check(old && !old.single && old.options.some((o) => o.key === "deptstore") && old.options.some((o) => o.name === "Food court"), "a mall raided before keeps its old buildings (the roomsLegacy rule)");
    t2.pois[0].cont = saved;
  }
  // A strip mall and an outlet as POIs: a raid into each.
  for (const kind of ["stripmall", "outlet"]) {
    let found = null;
    for (const s of [seed, seed + 1, seed + 2]) { const sw = s === seed ? st : W(s); for (const t of sw.tiles) poisOf(t).forEach((q, i) => { if (!found && q.kind === kind && !isSitePoi(t, i)) found = [sw, t, i]; }); if (found) break; }
    if (!check(!!found, `a ${kind} POI to raid`)) continue;
    const [sw, t, i] = found;
    const pl = poiPlace(t, i);
    check(pl.key === kind && poiHouses(sw, t, i) > 4, `${kind}: its place is the whole mall (${poiHouses(sw, t, i)} buildings)`);
    const p = team(sw);
    const b = raid(sw, p, t, i, [{ kind: "zombies", count: 8, power: 3 }]);
    check(b.raid.plan && b.raid.plan.mall && b.raid.plan.kind === kind, `${kind}: the raid on its map (${b.w} × ${b.h})`);
    end(sw, b);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
