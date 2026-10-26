// Sawmills and lumber yards (issue #53 of the round-2 epic #39, the user's request 2026-10-26: "saw mill";
// src/sim/sawmilllayout.js):
//   - the plans: thirteen in the shared picker (variantpick.js "sawmill"), ids unique, each pinned and built through
//     buildingMap with its id and name on the spec and the map, its size its REAL_SIZE row's, its storeys its row's;
//     their modal plan signatures (tools/plansig.js) all different;
//   - the rooms the issue names, each in the plans that have it with its pieces: the saw floor's headsaw, the green
//     chain's conveyors, a dry kiln's door and its lumber, the planer, the filing room's blade racks, the boiler, the
//     lumber shed's stacks, the office; the log yard's log piles and lumber stacks outside;
//   - the industrial mill: one map of seven buildings (compound.js) within the default cap, its log yard, its burner,
//     its log trucks and its lumber stacks to search, every walkable ground cell reached from the gate;
//   - every plan's map: every container reachable from the entry on its floor's walk (the ground from the entry zone,
//     an upper floor from its stairs);
//   - the loot: a lumber stack's wood and building materials, a blade rack's saws; per 100 m² of rooms within the
//     industrial band (a factory's and a warehouse's, ±45%);
//   - the picker by tile class: forest and hills favour the forest mills, a town the lumber yard and the millwork shop;
//   - placement: new worlds hold sawmills (placement.js PLACE_EXTRA), most on scenic tiles, some in towns, none on a
//     city's; an older world (placeLegacy) none; the table's row and the loot-sense row exist;
//   - the scenes: the saw floor's and the kiln's turn up on sawmills and on no other building;
//   - an older save's building: no plan (the factory's classic one).
// Usage: node tools/sawmilltest.js [seeds, default 6; BS_QUICK=1: 3] [worlds, default 12; BS_QUICK=1: 6]
import { createWorld } from "../src/sim/world.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { BUILDINGS, SITES, buildingMap, buildingSpec, STOREYS_BY_TYPE } from "../src/sim/buildingmaps.js";
import { SAWMILL_PLANS, SAWMILL_IDS, SAWMILL, SAWMILL_SCENES } from "../src/sim/sawmilllayout.js";
import { variantsOf, pickVariant } from "../src/sim/variantpick.js";
import { REAL_SIZE } from "../src/sim/data-buildingsize.js";
import { PLACEMENT_ROWS } from "../src/sim/data-placement.js";
import { PLACE_EXTRA, tileClass } from "../src/sim/placement.js";
import { LOOT_SENSE } from "../src/sim/lootsense.js";
import { LOCATIONS, GEAR, supValue } from "../src/sim/data.js";
import { CELL, boxLoot } from "../src/sim/combat.js";
import { rollScenes, sceneRng } from "../src/sim/interiorscenes.js";
import { ensurePois } from "../src/sim/pois.js";
import { Rng } from "../src/sim/rng.js";
import { planSignature } from "./plansig.js";

const QUICK = !!process.env.BS_QUICK;
const SEEDS = Number(process.argv[2]) || (QUICK ? 3 : 6);
const WORLDS = Number(process.argv[3]) || (QUICK ? 6 : 12);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();

const state = createWorld({ seed: 4242, factionCount: 4 });
state.roomsLegacy = false;
const forest = Object.values(state.tiles).find((t) => (t.terrain === "forest" || t.terrain === "hills") && !t.loc).id;
const opt = (plan, s) => ({ id: `smt${plan}${s}`, key: "sawmill", name: "Sawmill", plan });
const kindsIn = (m, r) => { const F = (m.floors || [{ cells: m.cells }])[r.f || 0].cells, out = new Set(); for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) out.add(F[y * m.w + x].k); return out; };
const all = (m) => { const out = new Set(); for (const F of m.floors || [{ cells: m.cells }]) for (const c of F.cells) out.add(c.k); return out; };
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
const pass = (c) => !!c && ((CELL[c.k] && CELL[c.k].walk) || ["door", "idoor", "odoor", "boarded", "bdoor"].includes(c.k)); // a scene's boarded door is a way through (boards come down)
function flood(cells, W, H, starts) {
  const seen = new Uint8Array(W * H), q = [];
  for (const [x, y] of starts) if (x >= 0 && y >= 0 && x < W && y < H && pass(cells[y * W + x])) { seen[y * W + x] = 1; q.push(y * W + x); }
  while (q.length) { const i = q.pop(), x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); } } }
  return seen;
}

// ---------- 1. the plans ----------
console.log("The plans");
const maps = {};
{
  const reg = variantsOf("sawmill");
  check(reg.length === SAWMILL_PLANS.length && reg.length >= 12 && new Set(reg.map((e) => e.id)).size === reg.length, `${reg.length} plans in the picker, ids unique (${reg.map((e) => e.id).join(", ")})`);
  check(!!BUILDINGS.sawmill && !!SITES.sawmill && !!STOREYS_BY_TYPE.sawmill && !!REAL_SIZE.sawmill && SAWMILL_IDS.every((id) => REAL_SIZE.sawmill.sizes[id]), "a BUILDINGS key, a site, a storey range and a REAL_SIZE row with a size for every plan");
  const bad = [], sigs = new Map();
  for (const id of SAWMILL_IDS) {
    maps[id] = [];
    const S = REAL_SIZE.sawmill.sizes[id];
    for (let s = 0; s < SEEDS; s++) {
      let m, spec;
      try { spec = buildingSpec(state, forest, opt(id, s)); m = buildingMap(state, forest, opt(id, s), s % 2 ? { kind: "car" } : null); } catch (e) { bad.push(`${id} ${s}: ${e.message}`); continue; }
      maps[id].push(m);
      if (spec.vid !== id || m.vid !== id || m.vname !== SAWMILL_PLANS.find((p) => p.id === id).name) bad.push(`${id}: vid ${spec.vid}/${m.vid}, vname ${m.vname}`);
      if (spec.bw < S.w[0] || spec.bw > S.w[1] || spec.bh < S.d[0] || spec.bh > S.d[1]) bad.push(`${id}: ${spec.bw} × ${spec.bh} off its row ${S.w} × ${S.d}`);
      const st = spec.storeys || 1;
      if (st < S.storeys[0] || st > S.storeys[1] || st < STOREYS_BY_TYPE.sawmill[0] || st > STOREYS_BY_TYPE.sawmill[1]) bad.push(`${id}: ${st} storeys`);
      if (m.w > SAWMILL.MILL.CAP || m.h > SAWMILL.MILL.CAP) bad.push(`${id}: a map of ${m.w} × ${m.h}`);
      const g = planSignature(m, spec.foot), L = sigs.get(id) || new Map();
      L.set(g.key, (L.get(g.key) || 0) + 1); sigs.set(id, L);
    }
  }
  check(!bad.length, `every plan pinned builds with its id, name, size and storeys, its map within ${SAWMILL.MILL.CAP} × ${SAWMILL.MILL.CAP} (${bad.slice(0, 3).join("; ") || "all"})`);
  const modal = SAWMILL_IDS.map((id) => [...(sigs.get(id) || new Map())].sort((a, b) => b[1] - a[1])[0]?.[0]);
  check(new Set(modal).size === SAWMILL_IDS.length, `each plan's most common signature its own (${new Set(modal).size} distinct of ${SAWMILL_IDS.length})`);
}

// ---------- 2. the rooms and their pieces ----------
console.log("The rooms the issue names, with their pieces");
{
  const want = [ // [role, pieces any of which it holds, plans]
    ["millsaw", ["headsaw", "lumberstack"], "saw floor"], ["millchain", ["conveyor"], "green chain"], ["millkiln", ["kilndoor"], "dry kiln"], ["millplaner", ["machine"], "planer shed"],
    ["millfiling", ["bladerack"], "filing room"], ["millboiler", ["boiler", "fueltank", "vat", "drum"], "boiler house"], ["millshed", ["lumberstack"], "lumber shed"], ["office", ["desk", "counter"], "office"],
  ];
  for (const [role, pieces, what] of want) {
    let n = 0, ok = 0; const plans = new Set(), miss = [];
    for (const id of SAWMILL_IDS) for (const m of maps[id]) for (const r of m.rooms.filter((a) => !a.outdoor && a.role === role)) { n++; plans.add(id); if (pieces.some((k) => kindsIn(m, r).has(k))) ok++; else miss.push(`${id}: ${r.name}`); }
    check(n > 0 && ok >= n * 0.9, `the ${what} (${role}): ${ok} of ${n} with ${pieces.join(" or ")}, in ${plans.size} plans${miss.length ? ` (missing in ${miss.slice(0, 3).join("; ")})` : ""}`);
  }
  const yards = SAWMILL_IDS.filter((id) => id !== "industrial" && maps[id].every((m) => m.rooms.some((a) => a.outdoor && all(m).has("logpile") || a.outdoor && all(m).has("lumberstack"))));
  check(yards.length >= 9, `log piles or lumber stacks in the yard outside ${yards.length} plans`);
  const heads = SAWMILL_IDS.filter((id) => maps[id].some((m) => all(m).has("headsaw")));
  check(heads.length >= 7, `a headsaw in ${heads.length} plans (${heads.join(", ")})`);
}

// ---------- 3. the industrial mill's yard ----------
console.log("The industrial mill's yard (compound.js)");
{
  const ms = maps.industrial;
  check(ms.length > 0 && ms.every((m) => m.compound && m.plan.compound && m.plan.houses.length === 7), `one map of seven buildings (${ms.map((m) => m.plan.houses.length).join(", ")})`);
  const names = new Set(ms.flatMap((m) => m.plan.houses.map((h) => h.name)));
  check(["Saw house", "Mill office", "Boiler house", "Dry kilns", "Planer shed"].every((n) => names.has(n)), `the saw house, office, boiler house, kilns and planer shed (${[...names].join(", ")})`);
  check(ms.every((m) => m.storeys === 2 && m.rooms.some((r) => r.f === 1 && r.role === "millfiling")), "the saw house's filing room upstairs");
  check(ms.every((m) => { const k = all(m); return k.has("logpile") && k.has("burner") && k.has("kilndoor") && k.has("headsaw"); }), "its log yard's piles, the burner, the kilns' doors, the headsaw");
  check(ms.every((m) => m.containers.some((c) => c.kind === "lumberstack" && m.rooms.find((r) => r.id === c.area)?.outdoor)), "lumber stacks to search out in the yard");
  check(ms.some((m) => m.containers.some((c) => /log truck/.test(c.label))), "a log truck in the log yard");
  let cut = 0;
  for (const m of ms) {
    const z = m.zones[0], F = m.floors[0].cells, seen = flood(F, m.w, m.h, [[z.x0 + 1, z.y0 + 1], [z.x0, z.y0], [z.x0 + 2, z.y0 + 2]]);
    const sealed = new Uint8Array(m.w * m.h); // a room a scene sealed (a barricade's boards and the furniture behind them)
    for (const r of m.rooms) if (r.scene && !(r.f || 0)) for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) sealed[y * m.w + x] = 1;
    for (let i = 0; i < F.length; i++) if (pass(F[i]) && F[i].k === "open" && !seen[i] && !sealed[i] && F[i].f !== "air") cut++;
  }
  check(cut === 0, `every open ground cell reached from the gate, but a room a scene sealed (${cut} cut off)`);
}

// ---------- 4. every container reachable ----------
console.log("Every container reachable");
{
  let total = 0; const cut = [];
  for (const id of SAWMILL_IDS) for (const m of maps[id]) {
    const floors = m.floors || [{ cells: m.cells }], z = m.zones[0];
    const reach = floors.map((F, f) => flood(F.cells, m.w, m.h, f === 0 ? [[z.x0 + 1, z.y0 + 1], [z.x0, z.y0], [z.x0 + 2, z.y0 + 2]] : (m.stairs || []).map(([x, y]) => [x, y])));
    for (const c of m.containers) {
      total++;
      const R = reach[c.f || 0], ok = [];
      for (let y = c.y - 1; y <= c.y + (c.h || 1); y++) for (let x = c.x - 1; x <= c.x + (c.w || 1); x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h && R[y * m.w + x] && (x === c.x - 1 || x === c.x + (c.w || 1) || y === c.y - 1 || y === c.y + (c.h || 1))) ok.push(1);
      if (!ok.length) cut.push(`${id}: ${c.label}`);
    }
  }
  check(cut.length <= Math.ceil(total * 0.01), `${total - cut.length} of ${total} containers reachable (${cut.slice(0, 3).join("; ") || "all"})`);
}

// ---------- 5. the loot ----------
console.log("The loot");
{
  const ls = boxLoot("hardware", "lumberstack"), br = boxLoot("workshop", "bladerack");
  check(ls.loot.wood && ls.loot.buildmat, `a lumber stack holds wood and building materials (${Object.keys(ls.loot).join(", ")})`);
  check(["handsaw", "bowsaw"].every((k) => br.gear.some(([g]) => g === k)), `a saw-blade rack holds saws (${br.gear.map(([g]) => g).join(", ")})`);
  const per = (key, plan, n) => { let v = 0, a = 0; for (let s = 0; s < n; s++) { const m = buildingMap(state, forest, { id: `smloot${key}${plan || ""}${s}`, key, name: key, ...(plan ? { plan } : {}) }, null); for (const r of m.rooms) if (!r.outdoor) a += Math.max(0, r.w - 2) * Math.max(0, r.h - 2); for (const c of m.containers) { const r = m.rooms.find((q) => q.id === c.area); if (r && r.type) v += value(boxLoot(r.type, c.kind)); } } return (v / a) * 100; };
  const band = (per("factory", null, 6) + per("warehouse", null, 6)) / 2;
  const off = SAWMILL_IDS.filter((id) => id !== "portable").map((id) => [id, per("sawmill", id, 3)]).filter(([, v]) => v < band * 0.55 || v > band * 1.45);
  check(!off.length, `loot per 100 m² of rooms within ±45% of the factory's and the warehouse's ${band.toFixed(0)} (${off.map(([id, v]) => `${id} ${v.toFixed(0)}`).join(", ") || "every plan but the portable mill, whose finds are its yard's"})`);
  check(!!LOOT_SENSE.sawmill && LOOT_SENSE.sawmill.never.includes("guns"), "a loot-sense row (lootsense.js): no guns in a sawmill's rooms");
}

// ---------- 6. the picker by tile class ----------
console.log("The picker by tile class");
{
  const share = (cls, ids, n = 400) => { let k = 0; for (let s = 0; s < n; s++) { const e = pickVariant("sawmill", new Rng(9000 + s * 7919), { tileClass: cls }); if (e && ids.includes(e.id)) k++; } return k / n; };
  const forestMills = ["family", "industrial", "portable", "logsort", "shingle", "kilnmill"], townShops = ["lumberyard", "millwork", "pallet"];
  const sf = share("scenic", forestMills), tf = share("town", forestMills), tt = share("town", townShops), st = share("scenic", townShops);
  check(sf > tf + 0.2 && tt > st + 0.2, `forest mills ${(sf * 100).toFixed(0)}% on scenic tiles (${(tf * 100).toFixed(0)}% in town), town yards ${(tt * 100).toFixed(0)}% in town (${(st * 100).toFixed(0)}% on scenic)`);
  const seen = new Set(); for (const cls of ["scenic", "rural", "town", "coast", "highway", "suburb"]) for (let s = 0; s < 300; s++) seen.add(pickVariant("sawmill", new Rng(100 + s * 31), { tileClass: cls }).id);
  check(seen.size === SAWMILL_IDS.length, `every plan picked somewhere (${seen.size})`);
  check(buildingSpec({ ...state, roomsLegacy: true }, forest, opt(null, 0)).vid == null, "an older save's building: no plan");
}

// ---------- 7. placement ----------
console.log("Placement (placement.js PLACE_EXTRA, data-placement.js)");
{
  check(!!PLACEMENT_ROWS.sawmill && PLACE_EXTRA.some(([k]) => k === "sawmill") && !!LOCATIONS.sawmill, "its placement row, its PLACE_EXTRA entry and its LOCATIONS kind");
  const by = {}; let n = 0, old = 0;
  for (let w = 0; w < WORLDS; w++) {
    const st = createWorld({ seed: 7000 + w * 13, factionCount: 3, size: "small" });
    for (const t of st.tiles) delete t.pois;
    ensurePois(st);
    for (const t of st.tiles) for (const p of t.pois || []) if (p.kind === "sawmill") { n++; const c = tileClass(st, t); by[c] = (by[c] || 0) + 1; }
    if (w < 2) { const o = createWorld({ seed: 7000 + w * 13, factionCount: 3, size: "small" }); o.placeLegacy = true; for (const t of o.tiles) delete t.pois; ensurePois(o); for (const t of o.tiles) for (const p of t.pois || []) if (p.kind === "sawmill") old++; }
  }
  const scenic = by.scenic || 0, town = by.town || 0;
  check(n >= WORLDS && scenic / n >= 0.4, `${n} sawmills in ${WORLDS} worlds, ${((scenic / n) * 100).toFixed(0)}% on scenic tiles (${Object.entries(by).map(([c, k]) => `${c} ${k}`).join(", ")})`);
  check(town > 0 && !(by.city || by.centre), `some in towns (${town}), none in a city`);
  check(old === 0, `an older world (placeLegacy) holds none (${old})`);
  // A save from before the sawmills (no sawV: save.js sawLegacy) gets none, and every other place it holds stays as it was.
  const st = createWorld({ seed: 7000, factionCount: 3, size: "small" });
  check(st.sawV === 1 && !st.sawLegacy, "a new world carries sawV");
  for (const t of st.tiles) delete t.pois;
  ensurePois(st);
  const pre = { ...st }; delete pre.sawV;
  const back = deserializeState(serializeState(pre));
  for (const t of back.tiles) delete t.pois;
  ensurePois(back);
  const others = (s) => s.tiles.map((t) => (t.pois || []).filter((p) => p.kind !== "sawmill").map((p) => p.kind).join(",")).join(";");
  const saws = (s) => s.tiles.reduce((k, t) => k + (t.pois || []).filter((p) => p.kind === "sawmill").length, 0);
  check(!!back.sawLegacy && saws(back) === 0, `a save from before the sawmills loads as one (sawLegacy): none on its tiles (new world: ${saws(st)})`);
  check(others(back) === others(st), "its other places are the new world's, sawmills aside (sawmills are last in PLACE_EXTRA)");
}

// ---------- 8. the scenes ----------
console.log("The scenes");
{
  const got = {};
  for (const id of SAWMILL_IDS) for (let s = 0; s < 30; s++) {
    const m = buildingMap(state, forest, { id: `smsc${id}${s}`, key: "sawmill", name: "Sawmill", plan: id }, null);
    for (const sc of ((m.scenes && m.scenes.list) || [])) got[sc.kind] = (got[sc.kind] || 0) + 1;
  }
  check(SAWMILL_SCENES.every((k) => got[k] > 0), `the saw floor's and the kiln's scenes on sawmills (${SAWMILL_SCENES.map((k) => `${k} ${got[k] || 0}`).join(", ")})`);
  let other = 0;
  for (const key of ["factory", "warehouse", "house"]) for (let s = 0; s < 20; s++) {
    const m = buildingMap(state, forest, { id: `smsx${key}${s}`, key, name: key }, null);
    for (const sc of ((m.scenes && m.scenes.list) || [])) if (SAWMILL_SCENES.includes(sc.kind)) other++;
  }
  check(other === 0, `none on another building (${other})`);
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
