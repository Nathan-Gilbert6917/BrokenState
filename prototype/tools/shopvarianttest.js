// A dozen layout variants for every shop and service type (src/sim/shopvariants.js; issue #35, the user's requests
// 2026-10-25: "every building should have several varients"; "for buildings with no to only a few varients create a
// dozen varients per building type"):
//   - every type has 12+ variants, each with a unique id and name, and every pair of a type's variants differs in at
//     least two of: the room list, the arrangement, the entrances, a corridor, the size, the storeys;
//   - the count of distinct plans by the plan signature (#32's tools/varianttest.js: the set of room roles, their
//     adjacency through doors, the entrance count, the storeys and the footprint's class) over 60+ seeds and every
//     setting is 12+ for every type;
//   - the dice, the franchise and the setting pick them: every variant turns up on the dice; every franchise maps to
//     variants that exist, the kind's franchises covering all 12; a variant weighted 0 in a setting never turns up there;
//   - every variant keeps its kind's signature (the pharmacy's dispensary, the gun store's locked gun cage, the pawn
//     shop's gun case, the bank's vault behind its vault door and its ATM, the gas station's and the truck stop's pumps,
//     the truck stop's shop and diner, #22's corner store, grocery and supermarket rooms) and everything connected (every
//     room and every container reached from the front, upstairs from the stairs), with #23's footprint shapes too;
//   - the variant's name on the map (plan.variant) and in the raid's opening lines; an older save keeps the old plan;
//   - loot per kind within ±10% per area (a 100 cells) of today's (dev's before the variants; BS_QUICK: 60 seeds, else 200).
// Usage: node tools/shopvarianttest.js
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, assemble, interiorIntro } from "../src/sim/buildingmaps.js";
import { VARIANT_TYPES, SETTINGS, variantsOf, variantSetting, shopPlan, SIZES } from "../src/sim/shopvariants.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { CELL, AREAS, boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { Rng } from "../src/sim/rng.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const QUICK = !!process.env.BS_QUICK;
const KEYS = Object.keys(VARIANT_TYPES);
const MIN_PLANS = 12;
const frKind = (k) => (k === "gasstation" ? "gas" : k);
const make = (key, seed, o = {}) => { const rng = new Rng(seed); const spec = BUILDINGS[key].make(rng, o); return { spec, m: assemble(rng, spec, { key, name: key, legacy: !!o.legacy, noDecor: true }) }; };
void createWorld;

// ---------- 1. the tables ----------
section(`The tables: ${KEYS.length} types`);
{
  const short = KEYS.filter((k) => variantsOf(k).length < MIN_PLANS);
  check(!short.length, `every type has ${MIN_PLANS}+ variants (${KEYS.map((k) => `${k} ${variantsOf(k).length}`).join(", ")})`);
  const dup = KEYS.filter((k) => { const vs = variantsOf(k); return new Set(vs.map((v) => v.id)).size !== vs.length || new Set(vs.map((v) => v.name)).size !== vs.length; });
  check(!dup.length, `every variant's id and name unique in its type${dup.length ? `: ${dup.join(", ")}` : ""}`);
  check(KEYS.every((k) => variantsOf(k).every((v) => Array.isArray(v.w) && v.w.length === SETTINGS.length && v.w.some((x) => x > 0) && SIZES[k][v.size])), "every variant has its weights by setting and a size of its type's table");
  // The criteria of the issue, from each variant's row: the rooms (the tokens, their resolved roles and names, the
  // upstairs plan, the pumps), the arrangement, the entrances, a corridor, the size class, the storeys.
  const desc = (k, v) => {
    const T = VARIANT_TYPES[k];
    const tok = (t) => (typeof t === "string" ? (t === "S" ? "sales" : t) : `${t.role}:${t.name}`);
    if (k === "supermarket") {
      const rooms = new Set([...(v.cafeX || []).map((l) => l.name), ...(v.pharmX || []).map((l) => l.name), ...(v.pumps ? ["pumps"] : []), ...(v.up ? [`up:${v.up}`] : []), ...(v.backD ? ["deep back of house"] : [])]);
      const ent = `${v.doors}+${String(v.docks)}+${v.fire ? 1 : 0}+${v.fire2 ? 2 : 0}`;
      return { rooms: [...rooms].sort().join(","), lay: `${(v.cafeX || []).length}/${(v.pharmX || []).length}/${v.backD || 0}`, ent, corridor: "no", size: v.size, st: String(v.st || 1) };
    }
    const all = [...(v.front || []), ...(v.mid || []), ...(v.back || []), ...(v.side || [])].map(([, t]) => tok(t));
    if (v.bays) all.push(`bay:${tok(v.bays.leaf)}`);
    if (v.st && v.up) all.push(`up:${v.up}`);
    if (v.pumps ?? T.pumps) all.push(`pumps:${v.pumps ?? T.pumps}`);
    const ent = [...(v.ex || []), ...(v.bays ? ["bay", ...(v.bays.back ? ["bayback"] : [])] : [])].sort().join("+") || "front";
    return { rooms: [...new Set(all)].sort().join(","), lay: v.lay || "strip", ent, corridor: v.lay === "corridor" ? "yes" : "no", size: v.size, st: String(v.st || 1) };
  };
  const close = [];
  for (const k of KEYS) {
    const vs = variantsOf(k), ds = vs.map((v) => desc(k, v));
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const n = Object.keys(ds[i]).filter((f) => ds[i][f] !== ds[j][f]).length;
      if (n < 2) close.push(`${k}: ${vs[i].id} / ${vs[j].id} (${n})`);
    }
  }
  check(!close.length, `every pair of a type's variants differs in 2+ of the rooms, the arrangement, the entrances, a corridor, the size, the storeys${close.length ? `: ${close.slice(0, 8).join("; ")}` : ""}`);
}

// ---------- 2. distinct plans by the plan signature (as tools/varianttest.js, #32) ----------
const SEEDS = 60;
section(`Distinct plans over ${SEEDS} seeds × every setting (and the franchises)`);
// The plan signature: the set of room roles, their adjacency through the doors, the entrance count, the storeys and the
// footprint's class.
const planSig = (m) => {
  const R = m.rooms.filter((a) => !a.outdoor);
  const roles = [...new Set(R.map((a) => a.role))].sort();
  const adj = new Set();
  const roomAt = (f, x, y) => R.find((a) => (a.f || 0) === f && x > a.x0 && x < a.x0 + a.w - 1 && y > a.y0 && y < a.y0 + a.h - 1);
  for (const a of R) for (const [x, y] of a.doors || []) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = roomAt(a.f || 0, x + dx, y + dy); if (b && b !== a) adj.add([a.role, b.role].sort().join("-")); }
  const a = m.building.w * m.building.h, cls = a <= 160 ? "S" : a <= 340 ? "M" : a <= 600 ? "L" : "H";
  return `${roles.join(",")}|${[...adj].sort().join(",")}|${1 + m.exits.length}|${m.storeys || 1}|${cls}`;
};
const counts = {};
{
  for (const k of KEYS) {
    const sigs = new Set(), fr = FRANCHISES[frKind(k)] || [];
    const sets = [null, ...SETTINGS];
    for (let s = 0; s < SEEDS; s++) for (let i = 0; i < sets.length; i += QUICK ? 2 : 1) {
      const o = { setting: sets[(s + i) % sets.length], variant: fr.length && s % 3 ? fr[s % fr.length].id : null };
      sigs.add(planSig(make(k, 31 + s * 7919 + i * 104729, o).m));
    }
    counts[k] = sigs.size;
  }
  const low = KEYS.filter((k) => counts[k] < MIN_PLANS);
  console.log(`  ${KEYS.map((k) => `${k} ${counts[k]}`).join(", ")}`);
  check(!low.length, `every type ${MIN_PLANS}+ distinct plans${low.length ? `: ${low.map((k) => `${k} ${counts[k]}`).join(", ")}` : ""}`);
}

// ---------- 3. the pick: the dice, the franchise, the setting ----------
section("Picked by the dice, the franchise and the setting");
{
  const missing = [];
  for (const k of KEYS) {
    const seen = new Set();
    for (let s = 0; s < 400 && seen.size < variantsOf(k).length; s++) seen.add(make(k, 7 + s * 131).spec.layout.id);
    const not = variantsOf(k).filter((v) => !seen.has(v.id)).map((v) => v.id);
    if (not.length) missing.push(`${k}: ${not.join(", ")}`);
  }
  check(!missing.length, `every variant turns up on the dice${missing.length ? `: ${missing.join("; ")}` : ""}`);
  const badFr = [], uncovered = [];
  for (const k of KEYS) {
    const fr = FRANCHISES[frKind(k)] || [];
    if (!fr.length) continue;
    const ids = new Set(variantsOf(k).map((v) => v.id)), cover = new Set();
    for (const f of fr) { const vs = (f.plan && f.plan.variants) || []; if (!vs.length || vs.some((id) => !ids.has(id))) badFr.push(`${k} ${f.id}`); vs.forEach((id) => cover.add(id)); }
    if (cover.size < ids.size) uncovered.push(`${k}: ${[...ids].filter((id) => !cover.has(id)).join(", ")}`);
    // A franchise's place is one of its variants.
    for (const f of fr) for (let s = 0; s < 6; s++) { const id = make(k, 3 + s * 17, { variant: f.id }).spec.layout.id; if (!((f.plan && f.plan.variants) || []).includes(id)) badFr.push(`${k} ${f.id} gave ${id}`); }
  }
  check(!badFr.length, `every franchise maps to variants of its kind and its places are one of them${badFr.length ? `: ${badFr.slice(0, 6).join("; ")}` : ""}`);
  check(!uncovered.length, `a kind's franchises cover all its variants${uncovered.length ? `: ${uncovered.join("; ")}` : ""}`);
  const zero = [];
  for (const k of KEYS) SETTINGS.forEach((set, si) => {
    const off = new Set(variantsOf(k).filter((v) => !(v.w[si] > 0)).map((v) => v.id));
    if (!off.size || off.size === variantsOf(k).length) return; // none weighted there (a truck stop in a city): all alike
    for (let s = 0; s < 40; s++) { const id = make(k, 11 + s * 37, { setting: set }).spec.layout.id; if (off.has(id)) { zero.push(`${k} ${id} in ${set}`); break; } }
  });
  check(!zero.length, `a variant weighted 0 in a setting never turns up there${zero.length ? `: ${zero.slice(0, 6).join("; ")}` : ""}`);
  check(variantSetting({ terrain: "city" }) === "city" && variantSetting({ terrain: "suburb" }) === "town" && variantSetting({ terrain: "plains", road: true }) === "highway" && variantSetting({ terrain: "forest" }) === "rural", "a tile's setting: a city, a town's suburb, a highway, the country");
  const p = shopPlan("pharmacy", { layout: "drivethru", size: "S", seed: 5 });
  check(!!p && p.layout.id === "drivethru" && p.bw <= SIZES.pharmacy.S[1] && !!p.program, "shopPlan: a kind's plan for a strip mall's slot by its variant and size");
}

// ---------- 4. every variant: its kind's signature, everything connected ----------
section("Every variant keeps its kind's signature, everything connected");
{
  const grid = (m, f) => (m.floors ? m.floors[f || 0].cells : m.cells);
  const walk = (m, f, sx, sy) => {
    const g = grid(m, f), seen = new Uint8Array(m.w * m.h), q = [sy * m.w + sx];
    seen[q[0]] = 1;
    while (q.length) { const i = q.pop(), x = i % m.w, y = (i / m.w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue; const j = ny * m.w + nx; const c = g[j]; if (!seen[j] && (CELL[c.k].walk || c.k === "door" || c.k === "stairs" || c.k === "ladder")) { seen[j] = 1; q.push(j); } } }
    return seen;
  };
  const has = (m, re) => m.rooms.some((a) => !a.outdoor && re.test(a.name));
  const SIGN = {
    pharmacy: (m) => m.rooms.some((a) => a.role === "dispensary"),
    gunstore: (m) => m.rooms.some((a) => a.name === "Gun cage" && a.role === "armory"), // locked behind its vault door on the dice, as before (below)
    pawnshop: (m) => has(m, /^Gun case$/),
    bank: (m) => { const v = m.rooms.find((a) => a.name === "Vault"); return !!v && m.lockedDoors.some((d) => d.area === v.id && d.kind === "vault") && m.containers.some((c) => c.kind === "atm"); },
    gasstation: (m) => m.rooms.some((a) => a.outdoor && a.type === "pumps"),
    truckstop: (m) => m.rooms.some((a) => a.outdoor && a.type === "pumps") && has(m, /^Shop$/) && has(m, /^Diner$/) && m.rooms.some((a) => a.role === "kitchen"),
    corner: (m) => has(m, /^Store$/) && has(m, /^Stockroom/),
    grocery: (m) => has(m, /^Sales floor$/) && has(m, /^Stockroom/) && has(m, /^Walk-in cooler/),
    supermarket: (m) => ["Sales floor", "Café", "Bakery", "Pharmacy", "Deli and butcher", "Warehouse", "Walk-in cooler", "Walk-in freezer", "Compactor and baler", "Cash office"].every((n) => has(m, new RegExp(`^${n}`))) && m.exits.filter((e) => e.roller && e.side === "back").length >= 2,
    dealer: (m) => m.rooms.some((a) => a.role === "sales"),
    garden: (m) => has(m, /^Greenhouse$/),
    clothing: (m) => has(m, /^Fitting rooms$/),
    hardware: (m) => has(m, /^Tool crib$/),
  };
  const errs = {};
  const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
  let built = 0, cages = 0, locked = 0;
  for (const k of KEYS) for (const v of variantsOf(k)) for (let s = 0; s < (QUICK ? 2 : 4); s++) {
    const { m } = make(k, 900 + s * 7919 + v.id.length, { layout: v.id, shapes: s % 2 === 1 }), tag = `${k} ${v.id} ${s}${s % 2 ? " shaped" : ""}`; // every other one with #23's footprint shapes (a new save's)
    built++;
    if (m.plan.variant !== v.name || m.plan.vid !== v.id) err("name", tag);
    if (SIGN[k] && !SIGN[k](m)) err("signature", tag);
    if (k === "gunstore") { const g = m.rooms.find((a) => a.name === "Gun cage"); cages++; if (g && m.lockedDoors.some((d) => d.area === g.id && d.kind === "vault")) locked++; }
    const z = m.zones[0], f0 = walk(m, 0, z.x0 + 1, z.y0 + 1);
    const reach = (m.floors || [{}]).map((_, f) => (f === 0 ? f0 : walk(m, f, m.stairs[0][0], m.stairs[0][1])));
    for (const a of m.rooms.filter((r) => !r.outdoor)) {
      let any = false;
      for (let y = a.y0 + 1; y < a.y0 + a.h - 1 && !any; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) if (reach[a.f || 0][y * m.w + x]) { any = true; break; }
      if (!any) err("rooms", `${tag} ${a.name} (floor ${a.f || 0})`);
    }
    for (const c of m.containers) {
      if (c.kind === "car" || c.kind === "boxtruck") continue;
      const R = reach[c.f || 0];
      let ok = false;
      for (let y = c.y - 1; y <= c.y + (c.h || 1) && !ok; y++) for (let x = c.x - 1; x <= c.x + (c.w || 1); x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h && R[y * m.w + x]) { ok = true; break; }
      if (!ok) err("boxes", `${tag} ${c.label}`);
      const a = m.rooms[c.area];
      if (!a || !AREAS[a.type]) err("loot", `${tag} ${c.label}`);
    }
    if (m.storeys > 1 && !(m.runs || []).some((r) => !r.single && r.len >= 2)) err("stairs", tag);
  }
  const msg = { name: "the variant's name and id on its map (plan.variant, plan.vid)", signature: "every variant its kind's signature rooms and pieces", rooms: "every room reached from the front (upstairs from the stairs)", boxes: "every container reached", loot: "every container in a room with a loot type", stairs: "a flight of stairs in every multi-storey variant" };
  for (const [k, t] of Object.entries(msg)) check(!errs[k], `${t} (${built} buildings)${errs[k] ? `: ${errs[k].length} bad, e.g. ${errs[k].slice(0, 4).join("; ")}` : ""}`);
  check(locked >= cages * 0.7, `the gun store's gun cage locked behind its vault door in most (${locked} of ${cages})`);
  // The raid's opening lines name the layout.
  const { m } = make("pharmacy", 5, { layout: "drivethru" });
  check(interiorIntro({ raid: { interior: true, plan: m.plan, storeys: m.storeys, runs: m.runs, stairs: m.stairs, areas: m.rooms } }).startsWith("Chain drugstore with a drive-through."), "the raid's opening lines name the layout");
  // An older save keeps the old plan: no layout, the old footprint's rooms.
  check(KEYS.every((k) => !make(k, 77, { legacy: true }).spec.layout), "an older save's plan is the old one (no variant)");
}

// ---------- 5. loot per area ----------
// Today's: each kind's loot a 100 cells (all its floors) on dev before the variants (a110710, a new save's plan, 200 seeds
// as below: #22's corner store, grocery and supermarket by their tiers), against which the variants hold within ±10%.
const TODAY = { pharmacy: 175.1, gasstation: 87.2, truckstop: 91.4, gunstore: 207.4, pawnshop: 193.9, sportshop: 76.4, electronics: 65.7, radioshop: 67.8, bookstore: 13.3, petstore: 58.4, garden: 43.7, clothing: 31.1, liquor: 29.8, hardware: 113.2, feedstore: 76.3, dealer: 36.2, bank: 16.5, autoshop: 62.8, garage: 75.1, workshop: 68.1, corner: 121.6, grocery: 40.8, supermarket: 57.5 };
const LN = QUICK ? 60 : 200;
section(`Loot per kind by the area against today's (${LN} seeds)`);
{
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  const tally = (k) => {
    let v = 0, area = 0;
    const fr = FRANCHISES[frKind(k)] || [];
    for (let s = 0; s < LN; s++) {
      const { m } = make(k, 9000 + s * 104729 + k.length, { variant: fr.length ? fr[s % fr.length].id : null });
      area += m.building.w * m.building.h * (m.storeys || 1);
      for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type) v += value(boxLoot(a.type, c.kind)); }
    }
    return { v: v / LN, dens: (v / area) * 100 };
  };
  const rows = [], off = [];
  for (const k of KEYS) {
    const now = tally(k), r = now.dens / TODAY[k] - 1;
    rows.push(`${k} ${TODAY[k].toFixed(1)}→${now.dens.toFixed(1)} (${r >= 0 ? "+" : ""}${(r * 100).toFixed(0)}%; ${now.v.toFixed(0)} a building)`);
    if (!(Math.abs(r) <= 0.1)) off.push(k);
  }
  console.log(`  ${rows.join("\n  ")}`);
  check(!off.length, `every kind within ±10% a 100 cells of today's${off.length ? `: ${off.join(", ")}` : ""}`);
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
