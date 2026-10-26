// Industrial buildings, a dozen plans a type (issue #37 of the interiors epic #7, the user's requests 2026-10-25: "every
// building should have several varients"; "for buildings with no to only a few varients create a dozen varients per
// building type"): sim/industrylayout.js's plans for the warehouse, the factory and the lab building.
// - distinct plans: over 72 seeds and settings each type has 12+ distinct plans by #32's plan signature (the set of
//   room roles, the role pairs with a door between them, the entrance count, the footprint class), and every named plan
//   turns up; the setting weighs the dice (a rural site's grain elevators and sawmills, a campus's teaching labs)
// - every plan, pinned, over several seeds: its storeys and its footprint's class (storeytest.js's), every room and every
//   walkable cell reached (from the front, upstairs from the stairs), its signature pieces (racks and docks, a production line, lab benches with fume hoods...), the rooms'
//   styles used (no room on the old furnishing), its name on the map and in the raid's opening line
// - loot: each kind within ±10% of today's a floor cell (the old plan, 200 seeds; BS_QUICK 80); the finds fit (parts
//   and scrap at a fabrication works, meds at a pharmaceutical lab, food at a food plant, fuel at a fuel depot)
// - older saves (legacy): today's plan, no plan name, no industrial room; the same map every time
// - the building's name before the raid (buildingOptions) is its plan's; the scenes roll only on the new plans
// Usage: node tools/industryvarianttest.js [seed]
import { planSignature } from "./plansig.js"; // #32's plan signature, shared with tools/varianttest.js
import { createWorld } from "../src/sim/world.js";
import { Rng } from "../src/sim/rng.js";
import { BUILDINGS, assemble, buildingOptions, interiorIntro, STOREYS_BY_TYPE } from "../src/sim/buildingmaps.js";
import { INDUSTRY_PLANS, INDUSTRY_KEYS, INDUSTRY_STYLES, plansOf, settingOf } from "../src/sim/industrylayout.js";
import { CELL, AREAS, boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { rollScenes } from "../src/sim/interiorscenes.js";
import { pieceDef } from "../src/sim/data-furniture.js";

const QUICK = !!process.env.BS_QUICK;
const seed = Number(process.argv[2] || 3);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const MIN_PLANS = 12;
// (Not a military site: a base's warehouse is #25's supply warehouse, militarylayout.js; checked below.)
const SITES = ["city", "town", "warehouse", "factory", "univ", "farm", "forest", "airport", "quarry", "dam", "mall", "plains"];

const make = (key, s, o = {}) => {
  const rng = new Rng(seed * 100003 + s * 7919 + key.length * 31);
  const spec = BUILDINGS[key].make(rng, o);
  const m = assemble(rng, spec, { key, name: BUILDINGS[key].name, legacy: !!o.legacy, withVehicle: s % 2 === 1 });
  return { spec, m };
};
// #32's plan signature (tools/plansig.js): the room roles, the pairs of roles with a door between them, the entrances,
// the footprint class.
const signature = (spec, m) => planSignature(m, spec.foot).key;
function walkFrom(m, sx, sy, cells) {
  const W = m.w, H = m.h, seen = new Uint8Array(W * H), q = [sy * W + sx];
  const pass = (c) => CELL[c.k].walk || c.k === "door";
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
// The footprint classes as tools/storeytest.js checks them.
const FOOT = { small: (a) => a <= 190, medium: (a) => a >= 90 && a <= 360, large: (a) => a >= 290, wide: (a, bw) => a >= 280 && bw >= 20 };
const kindsOf = (m) => { const k = new Map(); for (const F of m.floors) for (const c of F.cells) k.set(c.k, (k.get(c.k) || 0) + 1); return k; };

// ---------- 1. distinct plans ----------
section(`Distinct plans: ${SITES.length * 6} seeds and settings a type (at least ${MIN_PLANS})`);
for (const key of INDUSTRY_KEYS) {
  const sigs = new Set(), names = new Map();
  for (let s = 0; s < SITES.length * 6; s++) {
    const { spec, m } = make(key, s, { site: SITES[s % SITES.length] });
    sigs.add(signature(spec, m));
    names.set(spec.vname, (names.get(spec.vname) || 0) + 1);
  }
  // Every plan pinned once more (the dice may skip a rare one in 72 draws): the plans the type can have.
  const pinned = new Set();
  for (const p of plansOf(key)) for (let s = 0; s < 3; s++) { const { spec, m } = make(key, 500 + s, { plan: p.id }); pinned.add(signature(spec, m)); }
  console.log(`  ${key}: ${sigs.size} distinct plans drawn, ${pinned.size} over the ${plansOf(key).length} plans pinned; drawn ${[...names].map(([n, c]) => `${n} ${c}`).join(", ")}`);
  check(sigs.size >= MIN_PLANS, `${key}: ${sigs.size} distinct plans by the dice and the setting (≥ ${MIN_PLANS})`);
  check(plansOf(key).length >= MIN_PLANS + 1 && pinned.size >= MIN_PLANS, `${key}: ${plansOf(key).length} named plans, ${pinned.size} distinct signatures among them`);
  check(names.size >= 10, `${key}: ${names.size} of the named plans drawn in ${SITES.length * 6} buildings`);
}
{
  // The setting weighs the dice.
  const count = (key, site, id) => { let n = 0; for (let s = 0; s < 120; s++) if (BUILDINGS[key].make(new Rng(9000 + s), { site }).vid === id) n++; return n; };
  const rural = count("warehouse", "farm", "grain"), city = count("warehouse", "city", "grain");
  check(rural > city * 3 && rural >= 15, `a grain elevator at a farm far more often than in a city (${rural} against ${city} of 120)`);
  const campus = count("lab", "univ", "teaching"), town = count("lab", "city", "teaching");
  check(campus > town * 2, `a teaching lab at a university more often than in a city (${campus} against ${town} of 120)`);
  check(settingOf("farm") === "rural" && settingOf("univ") === "campus" && settingOf(null) === "any", "the settings by site");
  const mil = BUILDINGS.warehouse.make(new Rng(9100), { site: "military" });
  check(!mil.vid, "a military base's warehouse is still #25's supply warehouse (militarylayout.js), not one of these plans");
}

// ---------- 2. every plan ----------
section("Every plan, pinned: reached, its pieces, its styles, its name");
const N = QUICK ? 6 : 12;
for (const key of INDUSTRY_KEYS) for (const p of plansOf(key)) {
  const errs = [];
  let unstyled = 0, sigHits = 0;
  for (let s = 0; s < N; s++) {
    let spec, m;
    try { ({ spec, m } = make(key, 1000 + s, { plan: p.id })); } catch (e) { errs.push(`seed ${s}: ${e.message}`); continue; }
    const range = STOREYS_BY_TYPE[key];
    const n = spec.storeys || 1;
    if (n < range[0] || n > range[1]) errs.push(`${n} storeys`);
    if (m.w > (spec.foot === "huge" ? spec.bw + 12 : 44) || m.h > (spec.foot === "huge" ? spec.bh + 16 : 34)) errs.push(`map ${m.w}x${m.h}`);
    if (!FOOT[spec.foot] || !FOOT[spec.foot](spec.bw * spec.bh, spec.bw)) errs.push(`footprint ${spec.bw}x${spec.bh} is not ${spec.foot}`);
    if (spec.vid !== p.id || m.plan.variant !== p.name || m.plan.vid !== p.id) errs.push(`name ${m.plan.variant}`);
    // Reached: from the front zone on the ground floor, from the stairs upstairs.
    const z0 = m.zones[0];
    const reach = m.floors.map((F, f) => (f === 0 ? walkFrom(m, z0.x0 + 1, z0.y0 + 1, F.cells) : walkFrom(m, m.stairs[0][0], m.stairs[0][1], F.cells)));
    for (const r of m.rooms.filter((a) => !a.outdoor)) {
      let any = false;
      for (let y = r.y0 + 1; y < r.y0 + r.h - 1 && !any; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (reach[r.f || 0][y * m.w + x]) { any = true; break; }
      if (!any) errs.push(`${r.name} (floor ${r.f || 0}) not reached`);
    }
    m.floors.forEach((F, f) => { let pockets = 0; for (let i = 0; i < m.w * m.h; i++) if ((CELL[F.cells[i].k].walk || F.cells[i].k === "door") && !reach[f][i]) pockets++; if (pockets) errs.push(`floor ${f}: ${pockets} cells cut off`); });
    // Containers stand on their pieces, in a room with a loot type.
    for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (!a || !a.type || !AREAS[a.type]) errs.push(`a container in ${a ? a.name : "no room"}`); }
    // Its signature pieces (and rooms: a dock with two roller doors, the units behind theirs).
    const kinds = kindsOf(m);
    const rooms = m.rooms.filter((a) => !a.outdoor);
    const ok = p.sig.every((k) => (k === "dock" ? rooms.some((a) => a.role === "dock") && m.exits.filter((e) => e.roller).length >= 1 : k === "unit" ? rooms.filter((a) => a.role === "unit").length >= 8 : kinds.has(k)));
    if (ok) sigHits++;
    else errs.push(`missing ${p.sig.filter((k) => k !== "dock" && k !== "unit" && !kinds.has(k)).join(", ") || p.sig.join(", ")}`);
    // A lab's rooms are all industrylayout.js's (a lab building has no commercial styles to fall back on).
    if (key === "lab" && p.id !== "general") unstyled += rooms.filter((a) => !a.ind && !["corridor", "hall", "restroom"].includes(a.role)).length;
    if (!interiorIntro({ raid: { interior: true, plan: m.plan, storeys: m.storeys, runs: m.runs, stairs: m.stairs, areas: m.rooms } }).startsWith(`${p.name}.`)) errs.push("the opening line");
  }
  check(!errs.length && sigHits === N, `${key} ${p.name}: ${N} of ${N} reached, with ${p.sig.join(" and ") || "its rooms"}${errs.length ? ` (${[...new Set(errs)].slice(0, 4).join("; ")})` : ""}`);
  if (key === "lab" && p.id !== "general") check(unstyled === 0, `${key} ${p.name}: every room laid out by its style (${unstyled} not)`);
}
{
  // Every size the dice can roll keeps to its class (the spec alone, 80 seeds a plan).
  const off = [];
  for (const key of INDUSTRY_KEYS) for (const p of plansOf(key)) for (let s = 0; s < 80; s++) {
    const spec = BUILDINGS[key].make(new Rng(8800 + s * 31), { plan: p.id });
    if (!FOOT[spec.foot] || !FOOT[spec.foot](spec.bw * spec.bh, spec.bw)) off.push(`${p.name} ${spec.bw}x${spec.bh} ${spec.foot}`);
  }
  check(!off.length, `every footprint the dice roll is of its class (${[...new Set(off)].slice(0, 4).join("; ") || "80 seeds a plan"})`);
}
{
  const used = new Set();
  for (const key of INDUSTRY_KEYS) for (const p of INDUSTRY_PLANS[key]) for (let s = 0; s < 3; s++) for (const a of make(key, 2000 + s, { plan: p.id }).m.rooms) if (a.ind) used.add(a.ind);
  const unused = Object.keys(INDUSTRY_STYLES).filter((k) => !used.has(k));
  check(!unused.length, `every room style is used by a plan (${unused.join(", ") || Object.keys(INDUSTRY_STYLES).length + " styles"})`);
  const kinds = ["fumehood", "conveyor", "vat", "kiln", "loom", "grainbin", "labfreezer"];
  const seen = new Set();
  for (const key of INDUSTRY_KEYS) for (const p of INDUSTRY_PLANS[key]) for (const k of kindsOf(make(key, 2100, { plan: p.id }).m).keys()) seen.add(k);
  check(kinds.every((k) => seen.has(k) && pieceDef(k)), `the new pieces are laid (${kinds.filter((k) => !seen.has(k)).join(", ") || kinds.join(", ")})`);
}

// ---------- 3. loot ----------
section("Loot a floor cell (the footprint × the storeys) against today's");
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
const lootOf = (m) => { let v = 0; const by = {}; for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (!a || !a.type) continue; const d = boxLoot(a.type, c.kind); v += value(d); for (const [k, [p, lo, hi]] of Object.entries(d.loot)) by[k] = (by[k] || 0) + Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); } return { v, by }; };
const LS = QUICK ? 80 : 200;
for (const key of INDUSTRY_KEYS) {
  let was = 0, now = 0, wasA = 0, nowA = 0;
  for (let s = 0; s < LS; s++) {
    const a = make(key, 3000 + s, { legacy: true }), b = make(key, 3000 + s, {});
    was += lootOf(a.m).v; wasA += a.spec.bw * a.spec.bh * (a.spec.storeys || 1);
    now += lootOf(b.m).v; nowA += b.spec.bw * b.spec.bh * (b.spec.storeys || 1);
  }
  const r = (now / nowA) / (was / wasA);
  console.log(`  ${key}: ${((now / nowA) * 100).toFixed(1)} a 100 cells against ${((was / wasA) * 100).toFixed(1)} (×${r.toFixed(3)}); ${(now / LS).toFixed(0)} a building against ${(was / LS).toFixed(0)}`);
  check(r >= 0.9 && r <= 1.1, `${key}: loot a cell within ±10% of today's (×${r.toFixed(3)})`);
}
{
  const finds = (key, id) => { const by = {}; for (let s = 0; s < 20; s++) for (const [k, v] of Object.entries(lootOf(make(key, 4000 + s, { plan: id }).m).by)) by[k] = (by[k] || 0) + v; const t = Object.values(by).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v / t])); };
  const fab = finds("factory", "fab"), pharma = finds("lab", "pharma"), food = finds("factory", "foodplant"), fuel = finds("warehouse", "fueldepot");
  const pct = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(", ");
  console.log(`  fabrication works: ${pct(fab)}; pharmaceutical lab: ${pct(pharma)}; food plant: ${pct(food)}; fuel depot: ${pct(fuel)}`);
  check((fab.parts || 0) + (fab.scrap || 0) > 0.6, "a fabrication works holds parts and scrap");
  check((pharma.meds || 0) > 0.4, "a pharmaceutical lab holds meds");
  check((food.food || 0) + (food.preserved || 0) + (food.water || 0) > 0.5, "a food plant holds food");
  check((fuel.fuel || 0) > 0.15, "a fuel depot holds fuel");
}

// ---------- 4. older saves ----------
section("Older saves: today's plan");
for (const key of INDUSTRY_KEYS) {
  let same = true, plain = true;
  for (let s = 0; s < 6; s++) {
    const a = make(key, 5000 + s, { legacy: true }), b = make(key, 5000 + s, { legacy: true });
    if (JSON.stringify(a.m.cells) !== JSON.stringify(b.m.cells) || JSON.stringify(a.m.containers) !== JSON.stringify(b.m.containers)) same = false;
    if (a.spec.vid || a.m.plan.variant || a.m.rooms.some((r) => r.ind) || a.spec.yardPieces) plain = false;
  }
  check(same && plain, `${key}: an older save's building is today's plan (no plan name, no industrial room), the same every time`);
}

// ---------- 5. names and scenes ----------
section("Names before the raid, and the scenes");
{
  const st = createWorld({ seed: 11, factionCount: 3 });
  const t = st.tiles.find((q) => q.loc && q.loc.type === "warehouse") || st.tiles.find((q) => q.loc && q.loc.type === "factory");
  const opts = t ? buildingOptions(t, st) : null;
  const ind = opts ? opts.filter((o) => INDUSTRY_KEYS.includes(o.key)) : [];
  const names = new Set(plansOf("warehouse").concat(plansOf("factory")).map((p) => p.name));
  check(!!ind.length && ind.every((o) => names.has(o.name) || o.name === "Second warehouse"), `a ${t ? t.loc.type : "?"} site's buildings by their plans' names (${ind.map((o) => o.name).join(", ")})`);
  let rolled = 0, legacyRolled = 0;
  for (let s = 0; s < 120; s++) {
    const key = INDUSTRY_KEYS[s % 3];
    const IND = ["coldshut", "breach", "lineshelter"];
    const s1 = rollScenes(make(key, 6000 + s, {}).m, new Rng(70 + s), key);
    if (s1 && s1.list.some((x) => IND.includes(x.kind))) rolled++;
    const s2 = rollScenes(make(key, 6000 + s, { legacy: true }).m, new Rng(70 + s), key);
    if (s2 && s2.list.some((x) => IND.includes(x.kind))) legacyRolled++;
  }
  check(rolled > 0 && legacyRolled === 0, `the industrial scenes on the new plans (${rolled} of 120), never on an older save's (${legacyRolled})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
