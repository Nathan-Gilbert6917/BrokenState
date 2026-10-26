// Military bases, air bases and airports, a dozen plans a type (issue #25 of the interiors epic #7, the user's requests
// 2026-10-25: "every building should have several varients"; "for buildings with no to only a few varients create a
// dozen varients per building type"): sim/milplans.js's plans for the barracks, the armory, the motor pool, the mess
// hall, the hangar, the terminal, the control building, the transmitter hut, the HQ, the aid station, the gatehouse,
// the control tower and flight operations.
// - distinct plans: by the dice over 72 seeds each type has 12+ distinct plans by #32's plan signature (the set of room
//   roles, the role pairs with a door between them, the entrance count, the footprint class), and every named plan
//   turns up; pinned, the twelve plans are twelve signatures;
// - every plan, pinned, over several seeds: its storeys in STOREYS_BY_TYPE's range, its footprint's class (storeytest.js's),
//   every room and every walkable cell reached (from the front, upstairs from the stairs), every room laid out by a
//   style (no room on the old furnishing but corridors, halls and stairwells; "standard" of the control building and the
//   transmitter hut is today's plan, laid out as it was), its name on the map and in the raid's opening line;
// - loot a floor cell: each type's mix of plans against its "standard" plan (and against an older save's where the type
//   had one), reported; within ×0.5–×1.5 of the standard's a cell;
// - older saves (legacy): today's plan, no plan name; the same map every time.
// Usage: node tools/milvarianttest.js [seed]
import { createWorld } from "../src/sim/world.js";
import { Rng } from "../src/sim/rng.js";
import { BUILDINGS, assemble, interiorIntro, STOREYS_BY_TYPE, siteBuildings, SITES } from "../src/sim/buildingmaps.js";
import { MIL_PLANS, MIL_PLAN_KEYS, MIL_SITES, milSiteOf } from "../src/sim/milplans.js";
import { MILITARY_STYLES } from "../src/sim/militarylayout.js";
import { CIVIC_STYLES } from "../src/sim/civiclayout.js";
import { CELL, AREAS, boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";

void createWorld;
const QUICK = !!process.env.BS_QUICK;
const seed = Number(process.argv[2] || 3);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const MIN_PLANS = 12;
const SITE = { hangar: "airbase" };

const make = (key, s, o = {}) => {
  const rng = new Rng(seed * 100003 + s * 7919 + key.length * 31);
  const spec = BUILDINGS[key].make(rng, { site: SITE[key] || null, ...o });
  const m = assemble(rng, spec, { key, name: BUILDINGS[key].name, legacy: !!o.legacy, withVehicle: s % 2 === 1 });
  return { spec, m };
};
// #32's plan signature: the room roles, the pairs of roles with a door between them, the entrances, the footprint class.
function signature(spec, m) {
  const rooms = m.rooms.filter((a) => !a.outdoor);
  const roles = [...new Set(rooms.map((a) => a.role))].sort();
  const byDoor = new Map();
  for (const a of rooms) for (const d of a.doors || []) { const k = `${a.f || 0}:${d[0]},${d[1]}`; const l = byDoor.get(k) || []; l.push(a.role); byDoor.set(k, l); }
  const adj = new Set();
  for (const l of byDoor.values()) if (l.length >= 2) adj.add([...l].sort().join("-"));
  const ways = 1 + (m.exits || []).filter((e) => e.zone >= 0).length;
  return `${roles.join(",")}|${[...adj].sort().join(",")}|${ways}|${spec.foot}`;
}
function walkFrom(m, sx, sy, cells) {
  const W = m.w, H = m.h, seen = new Uint8Array(W * H), q = [sy * W + sx];
  const pass = (c) => CELL[c.k].walk || c.k === "door";
  const hOf = (c) => c.h ?? CELL[c.k].h ?? 0;
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0, c = cells[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx, d = cells[j];
      if (seen[j] || !pass(d)) continue;
      if (hOf(c) !== hOf(d) && !CELL[c.k].climb && !CELL[d.k].climb && c.k !== "door" && d.k !== "door") continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}
const FOOT = { small: (a) => a <= 190, medium: (a) => a >= 90 && a <= 360, large: (a) => a >= 290, wide: (a, bw) => a >= 280 && bw >= 20, tower: (a, bw) => a <= 330 && bw <= 22 };

// ---------- 1. distinct plans ----------
const DRAWS = 72;
section(`Distinct plans: ${DRAWS} buildings a type by their dice (at least ${MIN_PLANS})`);
for (const key of MIL_PLAN_KEYS) {
  const sigs = new Set(), names = new Map();
  for (let s = 0; s < DRAWS; s++) {
    const { spec, m } = make(key, s);
    sigs.add(signature(spec, m));
    names.set(spec.vname, (names.get(spec.vname) || 0) + 1);
  }
  const pinned = new Set();
  for (const p of MIL_PLANS[key]) { const { spec, m } = make(key, 500, { plan: p.id }); pinned.add(signature(spec, m)); }
  console.log(`  ${key}: ${sigs.size} distinct drawn, ${pinned.size} of ${MIL_PLANS[key].length} pinned; drawn ${[...names].map(([n, c]) => `${n} ${c}`).join(", ")}`);
  check(sigs.size >= MIN_PLANS, `${key}: ${sigs.size} distinct plans by the dice (≥ ${MIN_PLANS})`);
  check(MIL_PLANS[key].length >= MIN_PLANS && pinned.size >= MIN_PLANS, `${key}: ${MIL_PLANS[key].length} named plans, ${pinned.size} distinct signatures among them`);
  check(names.size === MIL_PLANS[key].length, `${key}: every named plan drawn in ${DRAWS} buildings (${names.size} of ${MIL_PLANS[key].length})`);
}

// ---------- 2. every plan ----------
section("Every plan, pinned: reached, its storeys and footprint, its styles, its name");
const N = QUICK ? 3 : 6;
for (const key of MIL_PLAN_KEYS) for (const p of MIL_PLANS[key]) {
  const errs = [];
  let unstyled = 0;
  for (let s = 0; s < N; s++) {
    let spec, m;
    try { ({ spec, m } = make(key, 1000 + s, { plan: p.id })); } catch (e) { errs.push(`seed ${s}: ${e.message}`); continue; }
    const range = STOREYS_BY_TYPE[key], n = spec.storeys || 1;
    if (n < range[0] || n > range[1]) errs.push(`${n} storeys`);
    if (m.w > 300 || m.h > 300) errs.push(`map ${m.w}x${m.h}`);
    if (!FOOT[spec.foot] || !FOOT[spec.foot](spec.bw * spec.bh, spec.bw)) errs.push(`footprint ${spec.bw}x${spec.bh} is not ${spec.foot}`);
    if (spec.vid !== p.id || m.plan.variant !== p.name) errs.push(`name ${m.plan.variant}`);
    const z0 = m.zones[0];
    const reach = m.floors.map((F, f) => (f === 0 ? walkFrom(m, z0.x0 + 1, z0.y0 + 1, F.cells) : walkFrom(m, m.stairs[0][0], m.stairs[0][1], F.cells)));
    const rooms = m.rooms.filter((a) => !a.outdoor);
    for (const r of rooms) {
      let any = false;
      for (let y = r.y0 + 1; y < r.y0 + r.h - 1 && !any; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (reach[r.f || 0][y * m.w + x]) { any = true; break; }
      if (!any) errs.push(`${r.name} (floor ${r.f || 0}) not reached`);
    }
    m.floors.forEach((F, f) => { let pockets = 0; for (let i = 0; i < m.w * m.h; i++) if ((CELL[F.cells[i].k].walk || F.cells[i].k === "door") && !reach[f][i]) pockets++; if (pockets) errs.push(`floor ${f}: ${pockets} cells cut off`); });
    for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (!a || !a.type || !AREAS[a.type]) errs.push(`a container in ${a ? a.name : "no room"}`); }
    const legacyStd = p.id === "standard" && (key === "control" || key === "radio");
    if (!legacyStd) unstyled += rooms.filter((a) => !(a.civic && (MILITARY_STYLES[a.civic] || CIVIC_STYLES[a.civic])) && !["corridor", "hall", "stairwell", "laundry"].includes(a.role)).length;
    if (!interiorIntro({ raid: { interior: true, plan: m.plan, storeys: m.storeys, runs: m.runs, stairs: m.stairs, areas: m.rooms } }).startsWith(`${p.name}.`)) errs.push("the opening line");
  }
  check(!errs.length && !unstyled, `${key} ${p.name}: ${N} of ${N} built and reached, every room laid out by its style${errs.length || unstyled ? ` (${[...new Set(errs)].slice(0, 4).join("; ")}${unstyled ? `; ${unstyled} rooms unstyled` : ""})` : ""}`);
}

// ---------- 3. loot ----------
section("Loot a floor cell (the footprint × the storeys): the plans' mix against the standard plan's");
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
const lootOf = (m) => { let v = 0; for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type && AREAS[a.type]) v += value(boxLoot(a.type, c.kind)); } return v; };
const LS = QUICK ? 40 : 120;
const OLD = new Set(["barracks", "armorybldg", "motorpool", "messhall", "hangar", "terminal", "control", "radio"]);
for (const key of MIL_PLAN_KEYS) {
  const tot = (o) => { let v = 0, a = 0; for (let s = 0; s < LS; s++) { const { spec, m } = make(key, 3000 + s, o); v += lootOf(m); a += spec.bw * spec.bh * (spec.storeys || 1); } return { v: v / LS, d: (v / a) * 100 }; };
  const mix = tot({}), std = tot({ plan: "standard" }), old = OLD.has(key) ? tot({ legacy: true }) : null;
  const r = mix.d / std.d;
  console.log(`  ${key}: the mix ${mix.d.toFixed(1)} a 100 cells (${mix.v.toFixed(0)} a building), the standard ${std.d.toFixed(1)} (${std.v.toFixed(0)})${old ? `, an older save's ${old.d.toFixed(1)} (${old.v.toFixed(0)})` : ""}`);
  check(r >= 0.5 && r <= 1.5, `${key}: the plans' loot a cell within ×0.5–×1.5 of the standard's (×${r.toFixed(2)})`);
}

// ---------- 4. older saves ----------
section("Older saves: today's plan");
for (const key of MIL_PLAN_KEYS) {
  let same = true, plain = true;
  for (let s = 0; s < 4; s++) {
    const a = make(key, 5000 + s, { legacy: true }), b = make(key, 5000 + s, { legacy: true });
    if (JSON.stringify(a.m.cells) !== JSON.stringify(b.m.cells) || JSON.stringify(a.m.containers) !== JSON.stringify(b.m.containers)) same = false;
    if (OLD.has(key) && (a.spec.vid || a.m.plan.variant)) plain = false;
  }
  check(same && plain, `${key}: an older save's building is ${OLD.has(key) ? "today's plan (no plan name)" : "built the same"}, the same every time`);
}

// ---------- 5. the sites' layouts ----------
section("The sites' layouts: a dozen each for a base, an air base and an airport");
for (const [type, T] of Object.entries(MIL_SITES)) {
  const sig = (l) => `${[...l.extra].map((e) => (Array.isArray(e) ? e.join("/") : e)).sort().join(",")}|${l.fence}|${l.towers}|${l.gate}|${l.runway}`;
  const sigs = new Set(T.layouts.map(sig));
  check(T.layouts.length >= MIN_PLANS && sigs.size === T.layouts.length, `${type}: ${T.layouts.length} named layouts, ${sigs.size} distinct (${T.layouts.map((l) => l.name).join(", ")})`);
  // By the tile's dice: every layout turns up over 240 tiles; the core's ids as they were, the layout's buildings after.
  const seen = new Set();
  let coreOk = true, extraOk = true;
  const core = SITES[type].slice(0, T.core).map((e) => (Array.isArray(e) ? e[0] : e));
  for (let id = 0; id < 240; id++) {
    const tile = { id, loc: { type, name: `Site ${id}` }, pois: [] };
    const l = milSiteOf(tile);
    seen.add(l.id);
    const sb = siteBuildings(tile);
    if (core.some((k, i) => sb.options[i].id !== k)) coreOk = false;
    if (sb.options.length !== T.core + l.extra.length || !sb.options.every((o) => o.sv === l.id && BUILDINGS[o.key])) extraOk = false;
  }
  check(seen.size === T.layouts.length && coreOk && extraOk, `${type}: every layout drawn by the tiles' dice (${seen.size}), the core buildings' ids as they were, the layout's buildings after`);
}
{
  // The grounds follow the layout: the perimeter, the gate, the runway.
  const ground = (key, type, id, s = 0) => {
    const rng = new Rng(seed * 7 + s * 7919);
    const spec = BUILDINGS[key].make(rng, { site: type, plan: "standard" });
    spec.sl = MIL_SITES[type].layouts.find((l) => l.id === id);
    spec.margins = { left: 8, right: 14, front: 14, back: 10 };
    const m = assemble(rng, spec, { key, name: key });
    const k = new Map(); for (const c of m.cells) k.set(c.k, (k.get(c.k) || 0) + 1);
    return { g: m.plan.ground, k };
  };
  const open = ground("barracks", "military", "guard"), sand = ground("barracks", "military", "forward"), dbl = ground("barracks", "military", "depot"), wire = ground("barracks", "military", "garrison");
  check(open.g.fence === 0 && !open.k.get("fence") && !open.k.get("tower"), `an open base (National Guard armory): no fence, no towers (${open.g.fence}, ${open.k.get("tower") || 0})`);
  check(sand.g.fence > 0 && (sand.k.get("sandbag") || 0) > sand.g.fence * 0.9 && !sand.k.get("fence"), `a forward operating base: a sandbag perimeter (${sand.g.fence} sandbags), no fence`);
  check(dbl.k.get("wirefence") > 0 && dbl.g.fence > 0 && dbl.g.gate > 0, `a supply depot: a double fence, its gate on the side (${dbl.g.gate} gate pieces)`);
  check(wire.g.fence > 0 && wire.g.towers === 4 && wire.g.gate > 0, `a garrison: the fence, four towers and the gatehouse (${wire.g.towers} towers)`);
  const side = ground("hangar", "airbase", "airlift"), back = ground("hangar", "airbase", "guard"), front = ground("hangar", "airbase", "fighter");
  check(side.g.runway === "side" && back.g.runway === "back" && front.g.runway === "front" && back.g.fence === 0 && front.g.fence > 0, `an air base's runway across the front, down the side or along the back by its layout (${front.g.runway}, ${side.g.runway}, ${back.g.runway}); an Air Guard field unfenced`);
  const port = ground("terminal", "airport", "cargo"), field = ground("terminal", "airport", "county");
  check(port.g.fence > 0 && field.g.fence === 0, `an airport fenced or open by its layout (cargo airport ${port.g.fence}, county airfield ${field.g.fence})`);
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
