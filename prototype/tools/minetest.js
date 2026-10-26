// Mines and quarries (issue #52 of the round-2 epic #39, the user's request 2026-10-26: "Add mine, quarry";
// src/sim/minelayout.js):
//   - the plans: thirteen a type in the shared picker (variantpick.js "mine", "quarry"), ids unique, each pinned and
//     built through buildingMap with its id and name on the spec and the map, its size its REAL_SIZE row's, its storeys
//     its row's, its map within the cap (400); their modal plan signatures (tools/plansig.js) all different;
//   - the rooms the issue names, each with its pieces: the collar house's shaft and cage, the hoist, the generator, the
//     lamp room's racks, the dry's lockers, a magazine's explosives boxes, the tipple, the drifts' timber, the ore pass's
//     chute, the stopes, the room-and-pillar workings; the crusher, the screen house, the truck bays, the kilns...;
//   - underground: every floor below a mine's surface named "Level −n", every room on it dark (area under), reached by
//     the shaft's stair run; the generator's act (indoorlight.js gensetAct) lights them all, and without it the lights
//     will not come on; the drifts' cave-ins (the gold mine's every time, the others' now and then), never cutting a
//     container off;
//   - the mine complex and the open pit: one map of several buildings (compound.js) within 400 × 400, the complex's
//     floors below named as levels, the pit's benches, faces, haul road and pond, every walkable ground cell reached
//     from the gate;
//   - every plan's map: every container reachable from the entry on its floor's walk;
//   - the loot: an ore car's ore and scrap, a lamp rack's lamps, an explosives box's charges (rare) behind a magazine's
//     door that locks; per 100 m² of rooms within the industrial band (a factory's and a workshop's, ±50%);
//   - the picker by tile class; placement: new worlds hold mines and quarries in the hills and the mountains and now
//     and then in the country, never in a town or a city; an older world none; a new world's quarry site opens the
//     quarry type and its mine shacks the mine type, an older save's keep the workshop and the cabin;
//   - the scenes: the cave-in's, the refuge's and the magazine's turn up on these types and on no other building;
//   - an older save's building: no plan.
// Usage: node tools/minetest.js [seeds, default 4; BS_QUICK=1: 2] [worlds, default 8; BS_QUICK=1: 4]
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, SITES, MINE_SITES, buildingMap, buildingSpec, STOREYS_BY_TYPE, siteBuildings } from "../src/sim/buildingmaps.js";
import { MINE_PLANS, QUARRY_PLANS, MINE, MINE_SCENES } from "../src/sim/minelayout.js";
import { variantsOf, pickVariant } from "../src/sim/variantpick.js";
import { REAL_SIZE } from "../src/sim/data-buildingsize.js";
import { PLACEMENT_ROWS } from "../src/sim/data-placement.js";
import { PLACE_EXTRA, tileClass } from "../src/sim/placement.js";
import { LOOT_SENSE } from "../src/sim/lootsense.js";
import { LOCATIONS, GEAR, supValue } from "../src/sim/data.js";
import { CELL, boxLoot } from "../src/sim/combat.js";
import { MAP_CAP } from "../src/sim/battlesize.js";
import { indoorSetup, gensetAct, lightsAct } from "../src/sim/indoorlight.js";
import { ensurePois } from "../src/sim/pois.js";
import { poiPlace } from "../src/sim/poiraid.js";
import { Rng } from "../src/sim/rng.js";
import { planSignature } from "./plansig.js";

const QUICK = !!process.env.BS_QUICK;
const SEEDS = Number(process.argv[2]) || (QUICK ? 2 : 4);
const WORLDS = Number(process.argv[3]) || (QUICK ? 4 : 8);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();

const state = createWorld({ seed: 4242, factionCount: 4 });
state.roomsLegacy = false;
const hills = Object.values(state.tiles).find((t) => (t.terrain === "hills" || t.terrain === "mountain") && !t.loc).id;
const TYPES = [["mine", MINE_PLANS], ["quarry", QUARRY_PLANS]];
const opt = (key, plan, s) => ({ id: `mt${key}${plan}${s}`, key, name: BUILDINGS[key].name, plan });
const floorsOf = (m) => m.floors || [{ cells: m.cells }];
const kindsIn = (m, r) => { const F = floorsOf(m)[r.f || 0].cells, out = new Set(); for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) out.add(F[y * m.w + x].k); return out; };
const all = (m) => { const out = new Map(); for (const F of floorsOf(m)) for (const c of F.cells) out.set(c.k, (out.get(c.k) || 0) + 1); return out; };
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
const pass = (c) => !!c && ((CELL[c.k] && CELL[c.k].walk) || ["door", "idoor", "odoor", "boarded", "bdoor"].includes(c.k)); // a scene's boarded door is a way through (boards come down)
function flood(cells, W, H, starts) {
  const seen = new Uint8Array(W * H), q = [];
  for (const [x, y] of starts) if (x >= 0 && y >= 0 && x < W && y < H && pass(cells[y * W + x])) { seen[y * W + x] = 1; q.push(y * W + x); }
  while (q.length) { const i = q.pop(), x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); } } }
  return seen;
}
// Each floor's walk: the ground from the entry zone, a floor above or below from the stair cells, joined through every
// floor's stairs (a level below the next is reached only down the shaft).
function reachAll(m) {
  const floors = floorsOf(m), z = m.zones[0];
  return floors.map((F, f) => flood(F.cells, m.w, m.h, f === 0 ? [[z.x0 + 1, z.y0 + 1], [z.x0, z.y0], [z.x0 + 2, z.y0 + 2]] : (m.stairs || []).map(([x, y]) => [x, y])));
}

// ---------- 1. the plans ----------
console.log("The plans");
const maps = { mine: {}, quarry: {} };
for (const [key, PLANS] of TYPES) {
  const ids = PLANS.map((p) => p.id), reg = variantsOf(key);
  check(reg.length === PLANS.length && reg.length >= 12 && new Set(reg.map((e) => e.id)).size === reg.length, `${key}: ${reg.length} plans in the picker, ids unique (${reg.map((e) => e.id).join(", ")})`);
  check(!!BUILDINGS[key] && !!STOREYS_BY_TYPE[key] && !!REAL_SIZE[key] && ids.every((id) => REAL_SIZE[key].sizes[id]) && MAP_CAP[key] === 400, `${key}: a BUILDINGS key, a storey range, a REAL_SIZE row with a size for every plan, a map cap of 400`);
  const bad = [], sigs = new Map();
  for (const id of ids) {
    maps[key][id] = [];
    const S = REAL_SIZE[key].sizes[id];
    for (let s = 0; s < SEEDS; s++) {
      let m, spec;
      try { spec = buildingSpec(state, hills, opt(key, id, s)); m = buildingMap(state, hills, opt(key, id, s), s % 2 ? { kind: "car" } : null); } catch (e) { bad.push(`${id} ${s}: ${e.message}`); continue; }
      maps[key][id].push(m);
      if (spec.vid !== id || m.vid !== id || m.vname !== PLANS.find((p) => p.id === id).name) bad.push(`${id}: vid ${spec.vid}/${m.vid}, vname ${m.vname}`);
      if (spec.bw < S.w[0] || spec.bw > S.w[1] || spec.bh < S.d[0] || spec.bh > S.d[1]) bad.push(`${id}: ${spec.bw} × ${spec.bh} off its row ${S.w} × ${S.d}`);
      const st = spec.storeys || 1;
      if (st < S.storeys[0] || st > S.storeys[1] || st < STOREYS_BY_TYPE[key][0] || st > STOREYS_BY_TYPE[key][1]) bad.push(`${id}: ${st} storeys`);
      if (m.w > MAP_CAP[key] || m.h > MAP_CAP[key]) bad.push(`${id}: a map of ${m.w} × ${m.h}`);
      const g = planSignature(m, spec.foot), L = sigs.get(id) || new Map();
      L.set(g.key, (L.get(g.key) || 0) + 1); sigs.set(id, L);
    }
  }
  check(!bad.length, `${key}: every plan pinned builds with its id, name, size and storeys, within ${MAP_CAP[key]} × ${MAP_CAP[key]} (${bad.slice(0, 3).join("; ") || "all"})`);
  const modal = ids.map((id) => [...(sigs.get(id) || new Map())].sort((a, b) => b[1] - a[1])[0]?.[0]);
  check(new Set(modal).size === ids.length, `${key}: each plan's most common signature its own (${new Set(modal).size} distinct of ${ids.length})`);
}
const every = (key) => Object.entries(maps[key]).flatMap(([id, ms]) => ms.map((m) => [id, m]));

// ---------- 2. the rooms and their pieces ----------
console.log("The rooms the issue names, with their pieces");
{
  const want = [ // [type, role, pieces any of which it holds, what]
    ["mine", "minecollar", ["headframe"], "collar house's shaft and cage"], ["mine", "minehoist", ["hoist"], "hoist house's drum"], ["mine", "minegen", ["genset"], "generator house's genset"],
    ["mine", "minelamp", ["lamprack"], "lamp room's racks"], ["mine", "minedry", ["locker", "shower"], "dry's lockers and showers"], ["mine", "minemag", ["powderbox"], "magazine's explosives boxes"],
    ["mine", "minetipple", ["orechute", "conveyor"], "tipple"], ["mine", "minedrift", ["timberset", "orecart"], "drift's timber and ore cars"], ["mine", "minestope", ["gravelpile", "orecart"], "stope's broken ore"],
    ["mine", "mineorepass", ["orechute"], "ore pass's chute"], ["mine", "mineworkings", ["pillar"], "room-and-pillar workings"], ["mine", "minerefuge", ["cot", "watertank"], "refuge chamber"],
    ["quarry", "qcrusher", ["jawcrusher"], "crusher room"], ["quarry", "qscreen", ["screendeck"], "screen house"], ["quarry", "qbay", ["toolchest", "carlift", "forklift"], "truck bay"],
    ["quarry", "qkiln", ["kiln"], "lime kilns"], ["quarry", "qmixer", ["mixer"], "mixer house"], ["quarry", "qcut", ["machine", "gravelpile"], "cutting shed"], ["quarry", "minemag", ["powderbox"], "quarry magazine"],
    ["quarry", "qscale", ["counter", "desk"], "scale office"],
  ];
  for (const [key, role, pieces, what] of want) {
    let n = 0, ok = 0; const plans = new Set(), miss = [];
    for (const [id, m] of every(key)) for (const r of m.rooms.filter((a) => !a.outdoor && a.role === role)) { n++; plans.add(id); if (pieces.some((k) => kindsIn(m, r).has(k))) ok++; else miss.push(`${id}: ${r.name}`); }
    check(n > 0 && ok >= n * 0.9, `${key}: the ${what} (${role}): ${ok} of ${n} with ${pieces.join(" or ")}, in ${plans.size} plans${miss.length ? ` (missing in ${miss.slice(0, 3).join("; ")})` : ""}`);
  }
  const yards = QUARRY_PLANS.filter((p) => maps.quarry[p.id].every((m) => all(m).has("gravelpile")));
  check(yards.length >= 10, `stockpiles at ${yards.length} of the quarry's plans`);
}

// ---------- 3. underground ----------
console.log("Underground: the levels, the dark and the generator, the cave-ins");
{
  const deep = MINE_PLANS.filter((p) => maps.mine[p.id].some((m) => (m.storeys || 1) > 1 && m.rooms.some((r) => r.f > 0 && r.under)));
  check(deep.length >= 8, `${deep.length} mine plans with levels below (${deep.map((p) => p.id).join(", ")})`);
  const badName = [], lit = [], dark = [], noGen = [];
  for (const p of deep) for (const m of maps.mine[p.id]) {
    const F = floorsOf(m);
    for (let f = 1; f < F.length; f++) if (!m.compound && F[f].name !== `Level −${f}`) badName.push(`${p.id}: floor ${f} "${F[f].name}"`);
    if (m.compound) for (let f = 1; f < F.length; f++) if (F[f].name !== `Level −${f}`) badName.push(`${p.id}: floor ${f} "${F[f].name}"`);
    const below = m.rooms.filter((r) => !r.outdoor && (r.f || 0) > 0 && (!m.compound || r.house === 0));
    if (below.some((r) => !r.under)) badName.push(`${p.id}: a room below not underground (${below.find((r) => !r.under).name})`);
    // The generator: a battle stand-in on the surface floor's cells, the raid's rooms as the map's.
    let gx = -1, gy = -1;
    for (let i = 0; i < F[0].cells.length && gx < 0; i++) if (F[0].cells[i].k === "genset") { gx = i % m.w; gy = (i / m.w) | 0; }
    if (gx < 0) { if (p.id !== "gold") noGen.push(p.id); continue; }
    const b = { w: m.w, h: m.h, cells: F[0].cells, floors: F, night: false, indoor: true, raid: { areas: m.rooms.map((r) => ({ ...r })) } };
    indoorSetup(b);
    const unders = b.raid.areas.filter((a) => a.under && !a.outdoor && a.w > 2 && a.h > 2);
    if (!unders.length || unders.some((a) => !a.dark || a.on)) dark.push(p.id);
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [gx + dx, gy + dy]).find(([x, y]) => pass(F[0].cells[y * m.w + x]));
    const u = { x: nb ? nb[0] : gx, y: nb ? nb[1] : gy, f: 0, ap: 4 };
    const sw = unders.find((a) => a.sw);
    const before = sw ? lightsAct(b, { x: sw.sw[0], y: sw.sw[1], f: sw.f, ap: 4 }, { area: sw.id }) : { err: "no switch" };
    const r = gensetAct(b, u);
    if (r.err || !r.on || !r.loud || unders.some((a) => !a.on) || !before.err) lit.push(`${p.id}${r.err ? `: ${r.err}` : ""}`);
  }
  check(!badName.length, `every floor below named "Level −n", every room on it underground (${badName.slice(0, 3).join("; ") || "all"})`);
  check(!noGen.length, `a generator on the surface of every mine with levels but the abandoned gold mine (${noGen.join(", ") || "all"})`);
  check(!dark.length, `the rooms below dark by day, their lights off (${dark.join(", ") || "all"})`);
  check(!lit.length, `the lights below will not come on without the generator, and starting it (loud) lights every one (${lit.slice(0, 3).join("; ") || "all"})`);
  const golds = maps.mine.gold.filter((m) => all(m).has("cavein")).length;
  const caved = MINE_PLANS.filter((p) => p.id !== "gold" && maps.mine[p.id].some((m) => all(m).has("cavein")));
  check(golds === maps.mine.gold.length && caved.length >= 2, `cave-ins: in every gold mine (${golds} of ${maps.mine.gold.length}), now and then in ${caved.length} other plans (${caved.map((p) => p.id).join(", ")})`);
}

// ---------- 4. the mine complex and the open pit ----------
console.log("The mine complex and the open pit (compound.js)");
{
  const cx = maps.mine.complex, pit = maps.quarry.pit;
  check(cx.length > 0 && cx.every((m) => m.compound && m.plan.houses.length === 5), `the mine complex: one map of five buildings (${cx.map((m) => m.plan.houses.length).join(", ")})`);
  check(cx.every((m) => ["Headframe and hoist house", "Office and dry", "Ore mill", "Mine shops", "Explosives magazine"].every((n) => m.plan.houses.some((h) => h.name === n))), "its headframe, office and dry, ore mill, shops and magazine");
  check(cx.every((m) => { const k = all(m); return k.has("headframe") && k.has("orecart") && k.has("gravelpile") && k.has("genset") && m.rooms.some((r) => r.under && r.f > 0); }), "its shaft, ore cars on the track, the waste dump, the generator, its levels below");
  check(pit.length > 0 && pit.every((m) => m.compound && m.plan.houses.length === 4), `the open pit: one map of four buildings (${pit.map((m) => m.plan.houses.length).join(", ")})`);
  check(pit.every((m) => { const k = all(m); return k.get("crag") > 40 && k.has("water") && k.has("jawcrusher") && k.has("gravelpile"); }), "the pit's faces between its benches, the pond at its bottom, the crusher, the stockpiles");
  check(pit.some((m) => m.containers.some((c) => /haul truck|loader/.test(c.label))), "haul trucks and a loader on the benches");
  const sizes = [...cx, ...pit].map((m) => `${m.w}×${m.h}`);
  check([...cx, ...pit].every((m) => m.w <= MINE.PIT.CAP && m.h <= MINE.PIT.CAP), `within 400 × 400 (${sizes.join(", ")})`);
  let cut = 0;
  for (const m of [...cx, ...pit]) {
    const z = m.zones[0], F = m.floors[0].cells, seen = flood(F, m.w, m.h, [[z.x0 + 1, z.y0 + 1], [z.x0, z.y0], [z.x0 + 2, z.y0 + 2]]);
    const sealed = new Uint8Array(m.w * m.h);
    for (const r of m.rooms) if (r.scene && !(r.f || 0)) for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) sealed[y * m.w + x] = 1;
    for (let i = 0; i < F.length; i++) if (pass(F[i]) && F[i].k === "open" && !seen[i] && !sealed[i] && F[i].f !== "air") cut++;
  }
  check(cut === 0, `every open ground cell reached from the gate, every bench of the pit down the haul road (${cut} cut off)`);
}

// ---------- 5. every container reachable ----------
console.log("Every container reachable");
{
  let total = 0; const cut = [];
  for (const [key] of TYPES) for (const [id, m] of every(key)) {
    const reach = reachAll(m);
    for (const c of m.containers) {
      total++;
      const R = reach[c.f || 0]; let ok = false;
      for (let y = c.y - 1; y <= c.y + (c.h || 1) && !ok; y++) for (let x = c.x - 1; x <= c.x + (c.w || 1) && !ok; x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h && R[y * m.w + x] && (x === c.x - 1 || x === c.x + (c.w || 1) || y === c.y - 1 || y === c.y + (c.h || 1))) ok = true;
      if (!ok) cut.push(`${key}/${id}: ${c.label}`);
    }
  }
  check(cut.length <= Math.ceil(total * 0.01), `${total - cut.length} of ${total} containers reachable (${cut.slice(0, 3).join("; ") || "all"})`);
}

// ---------- 6. the loot ----------
console.log("The loot");
{
  const oc = boxLoot("mineunder", "orecart"), lr = boxLoot("minelamp", "lamprack"), pb = boxLoot("minemag", "powderbox");
  check(oc.loot.stone && oc.loot.scrap, `an ore car holds ore (stone) and scrap (${Object.keys(oc.loot).join(", ")})`);
  check(["headlamp", "batteries", "hardhat"].every((k) => lr.gear.some(([g]) => g === k)), `a cap-lamp rack holds lamps, batteries and hard hats (${lr.gear.map(([g]) => g).join(", ")})`);
  const charge = pb.gear.find(([g]) => g === "pipebomb");
  check(!!charge && charge[1] <= 0.15, `an explosives box holds a charge, rarely (${charge ? charge[1] : "none"})`);
  const mags = [...every("mine"), ...every("quarry")].flatMap(([, m]) => m.rooms.filter((r) => r.role === "minemag" && !r.outdoor));
  check(mags.length > 0 && mags.filter((r) => r.locked).length >= mags.length * 0.5, `the magazines' doors locked (${mags.filter((r) => r.locked).length} of ${mags.length})`);
  const boom = [...every("mine"), ...every("quarry")].flatMap(([, m]) => m.containers.filter((c) => c.kind === "powderbox").map((c) => m.rooms.find((r) => r.id === c.area)));
  check(boom.length > 0 && boom.every((r) => r && r.role === "minemag"), `explosives boxes only in the magazines (${boom.length})`);
  const per = (key, plan, n) => { let v = 0, a = 0; for (let s = 0; s < n; s++) { const m = buildingMap(state, hills, { id: `mtloot${key}${plan || ""}${s}`, key, name: key, ...(plan ? { plan } : {}) }, null); for (const r of m.rooms) if (!r.outdoor) a += Math.max(0, r.w - 2) * Math.max(0, r.h - 2); for (const c of m.containers) { const r = m.rooms.find((q) => q.id === c.area); if (r && r.type) v += value(boxLoot(r.type, c.kind)); } } return (v / a) * 100; };
  const band = (per("factory", null, 6) + per("workshop", null, 6)) / 2;
  const rows = [];
  for (const [key, PLANS] of TYPES) for (const p of PLANS) rows.push([`${key}/${p.id}`, per(key, p.id, 2)]);
  const off = rows.filter(([, v]) => v < band * 0.5 || v > band * 1.5);
  console.log(`    loot a 100 m² of rooms: ${rows.map(([id, v]) => `${id} ${v.toFixed(0)}`).join(", ")} (the band ${band.toFixed(0)})`);
  check(!off.length, `loot per 100 m² of rooms within ±50% of the factory's and the workshop's ${band.toFixed(0)} (${off.map(([id, v]) => `${id} ${v.toFixed(0)}`).join(", ") || "every plan"})`);
  check(["mine", "quarry"].every((k) => LOOT_SENSE[k] && LOOT_SENSE[k].never.includes("guns") && !LOOT_SENSE[k].never.includes("explosive")), "loot-sense rows (lootsense.js): no guns, explosives allowed");
}

// ---------- 7. the picker by tile class ----------
console.log("The picker by tile class");
{
  for (const [key, PLANS] of TYPES) {
    const seen = new Set(); for (const cls of ["scenic", "rural", "coast"]) for (let s = 0; s < 300; s++) seen.add(pickVariant(key, new Rng(100 + s * 31), { tileClass: cls }).id);
    check(seen.size === PLANS.length, `${key}: every plan picked somewhere (${seen.size})`);
    check(buildingSpec({ ...state, roomsLegacy: true }, hills, opt(key, null, 0)).vid == null, `${key}: an older save's building: no plan`);
  }
  const share = (cls, ids, n = 400) => { let k = 0; for (let s = 0; s < n; s++) { const e = pickVariant("mine", new Rng(9000 + s * 7919), { tileClass: cls }); if (e && ids.includes(e.id)) k++; } return k / n; };
  const hillMines = ["shaft", "hardrock", "drift", "gold", "slope"], sc = share("scenic", hillMines), ru = share("rural", hillMines);
  check(sc > ru + 0.1, `hill mines ${(sc * 100).toFixed(0)}% on scenic tiles (${(ru * 100).toFixed(0)}% in open country)`);
}

// ---------- 8. placement and the renovated sites ----------
console.log("Placement (placement.js PLACE_EXTRA, data-placement.js) and the renovated sites");
{
  check(["mine", "quarry"].every((k) => !!PLACEMENT_ROWS[k] && PLACE_EXTRA.some(([e]) => e === k) && !!LOCATIONS[k]) && !!SITES.mine && MINE_SITES.quarry && MINE_SITES.mineshack, "their placement rows, PLACE_EXTRA entries, LOCATIONS kinds and sites");
  const by = {}; let n = 0, old = 0, poiMines = 0, poiOk = 0, siteOk = 0, sites = 0, oldSite = 0;
  for (let w = 0; w < WORLDS; w++) {
    const st = createWorld({ seed: 7000 + w * 13, factionCount: 3, size: "small" });
    for (const t of st.tiles) delete t.pois;
    ensurePois(st);
    for (const t of st.tiles) (t.pois || []).forEach((p, i) => {
      if (p.kind === "mine" || (p.kind === "quarry" && p.extra === "place")) { n++; const c = tileClass(st, t); by[c] = (by[c] || 0) + 1; }
      if ((p.kind === "mineshack" || p.kind === "quarry" || p.kind === "mine") && !p.site) { poiMines++; const pl = poiPlace(t, i); if (pl && (pl.key === "mine" || pl.key === "quarry")) poiOk++; }
    });
    for (const t of st.tiles) if (t.loc && t.loc.type === "quarry") { sites++; const sb = siteBuildings(t, st); if (sb && sb.options[0].key === "quarry") siteOk++; const o = { ...st, minesLegacy: true }; const ob = siteBuildings(t, o); if (ob && ob.options[0].key === "workshop") oldSite++; }
    if (w < 2) { const o = createWorld({ seed: 7000 + w * 13, factionCount: 3, size: "small" }); o.minesLegacy = true; for (const t of o.tiles) delete t.pois; ensurePois(o); for (const t of o.tiles) for (const p of t.pois || []) if (p.kind === "mine" || p.m) old++; }
  }
  const hillsN = by.scenic || 0;
  check(n >= WORLDS && hillsN / n >= 0.6, `${n} mines and quarries placed in ${WORLDS} worlds, ${((hillsN / n) * 100).toFixed(0)}% in the hills and mountains (${Object.entries(by).map(([c, k]) => `${c} ${k}`).join(", ")})`);
  check(!(by.town || by.city || by.centre || by.suburb), "none in a town, a suburb or a city");
  check(old === 0, `an older world (minesLegacy) holds no new mine and no renovated POI (${old})`);
  check(poiMines > 0 && poiOk === poiMines, `a new world's mine shacks and quarries open the new types (${poiOk} of ${poiMines})`);
  check(sites > 0 && siteOk === sites && oldSite === sites, `a quarry site opens the quarry type in a new world (${siteOk} of ${sites}), the workshop in an older one (${oldSite})`);
}

// ---------- 9. the scenes ----------
console.log("The scenes");
{
  const got = {};
  for (const [key, PLANS] of TYPES) for (const p of PLANS) for (let s = 0; s < (p.id === "complex" || p.id === "pit" ? 4 : 24); s++) {
    const m = buildingMap(state, hills, { id: `mtsc${key}${p.id}${s}`, key, name: key, plan: p.id }, null);
    for (const sc of ((m.scenes && m.scenes.list) || [])) got[sc.kind] = (got[sc.kind] || 0) + 1;
  }
  check(MINE_SCENES.every((k) => got[k] > 0), `the cave-in's, the refuge's and the magazine's scenes on mines and quarries (${MINE_SCENES.map((k) => `${k} ${got[k] || 0}`).join(", ")})`);
  let other = 0;
  for (const key of ["factory", "warehouse", "milbunker"]) for (let s = 0; s < 16; s++) {
    const m = buildingMap(state, hills, { id: `mtsx${key}${s}`, key, name: key }, null);
    for (const sc of ((m.scenes && m.scenes.list) || [])) if (MINE_SCENES.includes(sc.kind)) other++;
  }
  check(other === 0, `none on another building (${other})`);
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
