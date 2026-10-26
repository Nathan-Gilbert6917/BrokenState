// Civic and medical buildings at real scale, maps up to 350 × 350 (issue #49 of the round-2 epic #39, the user's
// request 2026-10-26: "updating the map size of civic and medical buildings to be max size of 350x350"):
//   - every plan of the hospital, infirmary, clinic, vet, church, police station, fire station, city hall and courthouse
//     has a sizes row (data-buildingsize.js CIVIC_REAL); in a new world each is laid out at it (realScale: its footprint
//     in the row's range, never smaller than drawn; its storeys the row's), its map within battlesize.js MAP_CAP, its
//     kind's signature rooms kept, its containers to the square metre within ±25% of its drawn plan's;
//     its loot to the square metre (the tables' value × civicvariants.js LOOT_K) within ±10% of its drawn plan's;
//   - the big ones are big: a regional medical centre 130 m across and more, a city's towers 6–10 storeys, a cathedral
//     70 m deep; a rural clinic stays small;
//   - the four multi-building sites (civicsite.js): the buildings and grounds each has (a medical centre's towers, ER,
//     ambulances, helipad, garage and clinic building; a churchyard's graves and hall; a police headquarters' impound
//     lot; a fire headquarters' drill tower and yard), the map within the cap, every walkable cell and every front door
//     reachable from the way in, the same every visit;
//   - placement (#42's table): the picker gives each kind the size class its row gives the tile class (a city centre's
//     huge hospital, a town's large one, a country clinic's small one), from plans that weigh something there;
//   - older saves: no new plan, no real scale (worldcfg.js legacyCivic), the same picks as the plans before #49.
// Usage: node tools/civicscaletest.js [seeds]
import { createWorld } from "../src/sim/world.js"; // (first: the modules' import order)
import { BUILDINGS, buildingMap, realScale, assemble } from "../src/sim/buildingmaps.js";
import { VARIANTS, VARIANT_KINDS, pickVariant, sizeOn } from "../src/sim/civicvariants.js";
import { CIVIC_SITE } from "../src/sim/civicsite.js";
import { REAL_SIZE, CIVIC_REAL } from "../src/sim/data-buildingsize.js";
import { MAP_CAP } from "../src/sim/battlesize.js";
import { PLACEMENT } from "../src/sim/data-placement.js";
import { variantsOf, pickFrom, variantOpts } from "../src/sim/variantpick.js";
import { legacyCivic } from "../src/sim/worldcfg.js";
import { Rng } from "../src/sim/rng.js";
import { boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";

const QUICK = !!process.env.BS_QUICK;
const SEEDS = Math.max(2, Number(process.argv[2]) || (QUICK ? 3 : 6));
const LOOT_SEEDS = 20; // a plan's loot to the square metre: its few containers need the seeds (quick or not)
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();
const KINDS = [...VARIANT_KINDS, "cityhall", "courthouse"];
const plansOf = (kind) => (VARIANTS[kind] ? VARIANTS[kind].map((v) => v.id) : variantsOf(`office:${kind}`).map((e) => e.id));
const SIGN = { // a kind's signature rooms (#36's), by role
  hospital: ["er", "ward", "pharmroom"], clinic: ["exam", "pharmroom"], infirmary: ["exam", "pharmroom"], vet: ["cells"], church: ["nave"],
  police: ["lobby", "office", "armory", "evidence", "cells", "bays"], firestation: ["bays", "dorm", "kitchen"],
};

// ======================================================================================
console.log("Every plan has a sizes row");
for (const kind of KINDS) {
  const rows = REAL_SIZE[kind].sizes || {}, missing = plansOf(kind).filter((id) => !rows[id]);
  check(!missing.length && CIVIC_REAL[kind], `${kind}: ${plansOf(kind).length} plans, every one a sizes row${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
}

// ======================================================================================
console.log("Each plan at real scale in a new world: its row's footprint and storeys, within its map cap");
const world = createWorld({ seed: 4901, factionCount: 3 });
check(!legacyCivic(world) && world.civicV === 1, "a new world is made at real scale (civicV)");
const cityT = world.tiles.find((t) => t.loc && t.loc.type === "city"), townT = world.tiles.find((t) => t.loc && t.loc.type === "town");
// The tables' value of a map's indoor containers (tools/lootsensetest.js's value) × their worth (c.lootK), and its rooms' floor.
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
const worth = (m, k = 1) => { const rooms = new Map(m.rooms.map((r) => [r.id, r])); let v = 0; for (const c of m.containers) { const a = rooms.get(c.area); if (a && a.type && !a.outdoor) v += value(boxLoot(a.type, c.kind, false)) * k; } return [v, m.rooms.filter((r) => !r.outdoor).reduce((x, r) => x + r.w * r.h, 0)]; };
const interior = (m) => { const B = m.building; let n = 0; for (const F of m.floors || [{ cells: m.cells }]) for (let y = B.y0; y < B.y0 + B.h; y++) for (let x = B.x0; x < B.x0 + B.w; x++) { const c = F.cells[y * m.w + x]; if (c && c.k !== "void" && c.k !== "wall") n++; } return n; };
// Plans stocked on purpose at real scale (civicvariants.js: a cabinet more in their exam rooms, the country's clinic and
// a dental practice): more containers to the square metre than drawn, their worth held to the drawn plan's (LOOT_K).
const STOCKED = new Set(["clinic/rural", "clinic/dental"]);
const SITE_PLANS = new Set(["hospital/medcampus", "church/churchyard", "police/hqsite", "firestation/hqsite"]);
for (const kind of KINDS) {
  const bad = [], sig = [], capBad = [], dens = [], worthOff = [];
  for (const id of plansOf(kind)) {
    const R = { ...REAL_SIZE[kind], ...REAL_SIZE[kind].sizes[id] }, D = { a: 0, ia: 0, b: 0, ib: 0, va: 0, fa: 0, vb: 0, fb: 0 };
    for (let s = 0; s < SEEDS; s++) for (const setting of ["city", "town"]) {
      const r = new Rng(9100 + s * 31), drawn = BUILDINGS[kind].make(r, { plan: id, setting });
      const r2 = new Rng(9100 + s * 31), spec = realScale(r2, BUILDINGS[kind].make(r2, { plan: id, civicReal: true, setting }), kind, { setting });
      const shaped = !!spec.shape, st = R.storeys && (setting === "city" && R.city ? R.city : R.storeys);
      if (id !== "general") {
        if (!shaped && (spec.bw < Math.max(R.w[0], drawn.bw) - 1 || spec.bw > Math.max(R.w[1], drawn.bw) + 1 || spec.bh < Math.max(R.d[0], drawn.bh) - 1 || spec.bh > Math.max(R.d[1], drawn.bh) + 1)) bad.push(`${id} ${spec.bw}×${spec.bh} (row ${R.w.join("–")} × ${R.d.join("–")})`);
        if (shaped && spec.bw * spec.bh < 0.8 * R.w[0] * R.d[0]) bad.push(`${id} shaped ${spec.bw}×${spec.bh} (row ${R.w[0]} × ${R.d[0]} at least)`);
        if (VARIANTS[kind] && st && (spec.height < st[0] || spec.height > st[1]) && spec.height !== drawn.storeys) bad.push(`${id} ${spec.height} storeys (row ${st.join("–")})`); // a plan of a fixed height keeps it
      }
      const m = assemble(new Rng(77 + s), spec, { key: kind, name: kind, noDecor: true }), md = assemble(new Rng(77 + s), drawn, { key: kind, name: kind, noDecor: true });
      D.a += m.containers.length; D.ia += interior(m); D.b += md.containers.length; D.ib += interior(md);

      if (s === 0 && setting === "city") {
        const roles = new Set(m.rooms.filter((a) => !a.outdoor).map((a) => a.role));
        const want = SIGN[kind] || [];
        if (want.some((x) => !roles.has(x))) sig.push(`${id} (${want.filter((x) => !roles.has(x)).join(", ")})`);
      }
    }
    // The loot to the square metre on seeds of its own (LOOT_SEEDS: not civicvariants.js LOOT_K's calibration seeds).
    for (let s = 0; s < LOOT_SEEDS; s++) for (const setting of ["city", "town"]) {
      const r = new Rng(5300 + s * 41), drawn = BUILDINGS[kind].make(r, { plan: id, setting });
      const r2 = new Rng(5300 + s * 41), spec = realScale(r2, BUILDINGS[kind].make(r2, { plan: id, civicReal: true, setting }), kind, { setting });
      const [va, fa] = worth(assemble(new Rng(91 + s), spec, { key: kind, name: kind, noDecor: true }), spec.lootK || 1), [vb, fb] = worth(assemble(new Rng(91 + s), drawn, { key: kind, name: kind, noDecor: true }));
      D.va += va; D.fa += fa; D.vb += vb; D.fb += fb;
    }
    const k = (D.a / D.ia) / Math.max(1e-9, D.b / D.ib); // over every seed and setting: a small plan's few containers are noisy alone
    if (id !== "general" && (k < 0.75 || k > (STOCKED.has(`${kind}/${id}`) ? 1.5 : 1.25))) dens.push(`${id} ×${k.toFixed(2)}`);
    const kv = (D.va / D.fa) / Math.max(1e-9, D.vb / D.fb); // the loot to the square metre (#43's economy), with the plan's worth (LOOT_K)
    if (id !== "general" && (kv < 0.9 || kv > 1.1)) worthOff.push(`${id} ×${kv.toFixed(2)}`);
    if (!SITE_PLANS.has(`${kind}/${id}`)) for (const t of [cityT, townT]) {
      const m = buildingMap(world, t.id, { id: `cs-${id}`, key: kind, name: kind, plan: id }, false), cap = MAP_CAP[kind] || 300;
      if (m.w > cap || m.h > cap) capBad.push(`${id} ${m.w}×${m.h}`);
    }
  }
  check(!bad.length, `${kind}: every plan laid out at its row's footprint and storeys${bad.length ? `: ${bad.slice(0, 6).join("; ")}` : ""}`);
  if (SIGN[kind]) check(!sig.length, `${kind}: the signature rooms in every plan at real scale (${SIGN[kind].join(", ")})${sig.length ? `: missing in ${sig.join("; ")}` : ""}`);
  check(!dens.length, `${kind}: containers to the square metre within ±25% of each drawn plan's${dens.length ? `: ${dens.join(", ")}` : ""}`);
  check(!worthOff.length, `${kind}: loot to the square metre (the tables' value × LOOT_K) within ±10% of each drawn plan's, on seeds of its own${worthOff.length ? `: ${worthOff.join(", ")}` : ""}`);
  check(!capBad.length, `${kind}: every map within its cap (${MAP_CAP[kind] || "the dials, 300"})${capBad.length ? `: ${capBad.join(", ")}` : ""}`);
}

// ======================================================================================
console.log("The big ones are big, a country clinic small");
{
  const city = (kind, id, n = SEEDS) => Array.from({ length: n }, (_, s) => { const r = new Rng(300 + s); return realScale(r, BUILDINGS[kind].make(r, { plan: id, civicReal: true, setting: "city" }), kind, { setting: "city" }); });
  const reg = city("hospital", "regional"), tow = city("hospital", "tower"), cat = city("church", "cathedral"), rur = city("clinic", "rural"), hq = city("police", "hq");
  check(reg.every((s) => s.bw >= 120 && s.bh >= 80 && s.height >= 6 && s.height <= 10 && s.shape && s.shape.parts.length === 3), `a regional medical centre: ${reg.map((s) => `${s.bw}×${s.bh}, ${s.height} storeys`).join("; ")} (a U of its tower and wings)`);
  check(tow.every((s) => s.height >= 7 && s.height <= 10), `a city's medical tower 7–10 storeys (${tow.map((s) => s.height).join(", ")})`);
  check(hq.every((s) => s.height >= 6 && s.height <= 10), `a city's police headquarters 6–10 storeys (${hq.map((s) => s.height).join(", ")})`);
  check(cat.every((s) => s.bh >= 70), `a cathedral at least 70 m deep (${cat.map((s) => `${s.bw}×${s.bh}`).join(", ")})`);
  check(rur.every((s) => s.bw * s.bh <= 16 * 12), `a rural health post stays small (${rur.map((s) => `${s.bw}×${s.bh}`).join(", ")})`);
}

// ======================================================================================
console.log("The multi-building sites (civicsite.js)");
const siteRun = (kind, plan, t, id = "cs-site") => buildingMap(world, t.id, { id, key: kind, name: kind, plan }, "car");
const reach = (m, sx, sy) => { const W = m.w, seen = new Uint8Array(W * m.h), st = [[sx, sy]]; seen[sy * W + sx] = 1; const walk = (c) => !!c && (c.k === "open" || c.k === "door" || c.k === "idoor" || c.k === "odoor" || c.k === "doorway" || c.k === "bdoor" || c.k === "stairs" || c.k === "vehicle" || /door/.test(c.k)); while (st.length) { const [x, y] = st.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= m.h || seen[Y * W + X]) continue; if (walk(m.cells[Y * W + X])) { seen[Y * W + X] = 1; st.push([X, Y]); } } } return seen; };
const sig = (m) => JSON.stringify([m.w, m.h, m.cells.map((c) => c.k).join(""), m.containers.map((c) => [c.x, c.y, c.kind, c.house])]);
for (const [kind, plan, site] of [["hospital", "medcampus", "medcampus"], ["church", "churchyard", "churchyard"], ["police", "hqsite", "policehq"], ["firestation", "hqsite", "firehq"]]) {
  for (const t of [cityT, townT]) {
    const m = siteRun(kind, plan, t), P = m.plan, g = (k) => (P.grounds || []).filter((x) => x.kind === k);
    const cap = Math.min(CIVIC_SITE.CAP, MAP_CAP[kind]);
    check(m.civicSite === site && m.street && P.word === "buildings" && m.vname === VARIANTS[kind].find((v) => v.id === plan).name, `${t.loc.type} ${site}: one map of the site, named for its plan (${m.vname})`);
    check(m.w <= cap && m.h <= cap, `${t.loc.type} ${site}: ${m.w} × ${m.h}, within ${cap}`);
    const names = P.houses.map((h) => h.name), keys = P.houses.map((h) => h.key);
    if (site === "medcampus") {
      check(P.houses.length === 5 && keys.filter((k) => k === "hospital").length === 3 && keys.includes("clinic") && keys.includes("parkgarage") && names.includes("Emergency Department"), `the towers, the emergency department, the clinic building and the garage (${names.join(", ")})`);
      check(g("apron").length === 1 && g("apron")[0].ambulances >= 1 && m.containers.some((c) => c.kind === "ambulance"), `ambulances on the ER's apron (${g("apron").map((x) => x.ambulances).join("")})`);
      check(g("helipad").length === 1 && g("lot").length === 1, "a helipad and the staff lot");
      check(P.houses.find((h) => h.name === "Emergency Department").rooms.some((id) => m.rooms[id].role === "ambbay"), "the emergency department's ambulance bay");
    }
    if (site === "churchyard") {
      check(names.includes("Parish Church") && names.includes("Parish Hall") && m.rooms.some((a) => a.role === "nave"), `the church and its parish hall (${names.join(", ")})`);
      const stones = m.cells.filter((c) => c.k === "headstone").length;
      check(g("cemetery").length === 1 && stones >= 60, `the churchyard's headstones in rows (${stones})`);
    }
    if (site === "policehq") {
      const imp = g("impound")[0];
      check(names.includes("Police Headquarters") && names.includes("Impound Office") && m.rooms.some((a) => a.role === "cells") && m.rooms.some((a) => a.role === "armory"), `the headquarters and the impound office (${names.join(", ")})`);
      check(imp && imp.cars >= 10 && m.cells.filter((c) => c.k === "wirefence").length > 2 * (imp.w + imp.h) - 12, `the impound lot fenced, its gate open, ${imp ? imp.cars : 0} impounded cars`);
    }
    if (site === "firehq") {
      const tw = P.houses.find((h) => h.name === "Drill Tower");
      check(names.includes("Fire Headquarters") && tw && tw.storeys >= 4 && m.rooms.some((a) => a.role === "bays"), `the headquarters and its drill tower (${tw ? tw.storeys : 0} storeys)`);
      check(g("drillyard").length === 1, "the drill yard");
    }
    // Every walkable cell of the ground floor and every front door reachable from the way in.
    const z = m.zones[0], seen = reach(m, z.x0 + 1, z.y0 + 1);
    let cut = 0;
    for (let i = 0; i < m.w * m.h; i++) if (m.cells[i].k === "open" && !seen[i]) cut++;
    const doors = P.houses.filter((h) => h.front && !seen[h.front.y * m.w + h.front.x]).map((h) => h.name);
    check(!cut && !doors.length, `${t.loc.type} ${site}: every open cell (${cut} cut off) and front door reachable from the way in${doors.length ? ` (not: ${doors.join(", ")})` : ""}`);
    check(sig(m) === sig(siteRun(kind, plan, t)), `${t.loc.type} ${site}: the same map every visit`);
  }
}

// ======================================================================================
console.log("Placement: each kind's plan of the size class #42's table gives its tile class");
for (const kind of VARIANT_KINDS) {
  const row = PLACEMENT[kind];
  if (!row || row.of) continue;
  for (const cls of Object.keys(row.size)) {
    const setting = cls === "centre" || cls === "city" ? "city" : cls === "suburb" ? "suburb" : cls === "town" ? "town" : "rural";
    const want = sizeOn(kind, cls), got = new Map();
    let wrong = 0, dead = 0;
    for (let s = 0; s < 300; s++) {
      const v = pickVariant(kind, new Rng(7000 + s), { civicReal: true, setting, tileClass: cls });
      const e = variantsOf(`civic:${kind}`).find((x) => x.id === v.id);
      got.set(v.id, (got.get(v.id) || 0) + 1);
      if (e.sizeClass !== want) wrong++;
      if (!(v.w && v.w[setting] > 0)) dead++;
    }
    check(!wrong && !dead && got.size >= 1, `${kind} on ${cls}: ${want} plans weighed for ${setting} (${[...got].map(([id, n]) => `${id} ${n}`).join(", ")})`);
  }
}
{
  const h = (cls) => pickVariant("hospital", new Rng(11), { civicReal: true, setting: cls === "town" ? "town" : "city", tileClass: cls });
  check(["centre", "city"].every((c) => ["huge"].includes(variantsOf("civic:hospital").find((e) => e.id === h(c).id).sizeClass)) && variantsOf("civic:hospital").find((e) => e.id === h("town").id).sizeClass === "large", "a city centre's hospital huge, a town's county hospital large");
}

// ======================================================================================
console.log("Older saves: the plans before #49, at their drawn sizes");
{
  let same = 0, n = 0, fresh = 0, scaled = 0;
  for (const kind of VARIANT_KINDS) {
    const old = variantsOf(`civic:${kind}`).filter((e) => !e.fresh), opts = variantOpts(`civic:${kind}`);
    for (let s = 0; s < 200; s++) for (const setting of ["city", "suburb", "town", "rural"]) {
      const o = { setting, ...(s % 5 === 0 ? { site: "prison" } : {}), ...(s % 7 === 0 ? { variant: (old.find((e) => e.fr) || { fr: [null] }).fr[0] } : {}) };
      const a = pickVariant(kind, new Rng(s + 1), o), r = new Rng(s + 1).next();
      const b = pickFrom(old, null, { plan: null, franchise: o.variant || null, site: o.site || null, setting, r }, opts);
      n++; if (a && b && a.id === b.id) same++;
      if (a && a.fresh) fresh++;
      const sp = BUILDINGS[kind].make(new Rng(s + 1), o);
      if (sp.vscale || sp.civicSite || sp.realSize) scaled++;
    }
  }
  check(same === n && !fresh, `an older save's picks are the plans before #49's, the same walk (${same}/${n}; new plans ${fresh})`);
  check(!scaled, `no real scale, no site, outside a new world (${scaled})`);
  const old = createWorld({ seed: 4901, factionCount: 3 });
  old.civicLegacy = true;
  const t = old.tiles.find((x) => x.loc && x.loc.type === "city");
  const ms = KINDS.map((key) => buildingMap(old, t.id, { id: "old", key, name: key }, false));
  check(legacyCivic(old) && ms.every((m) => !m.civicSite && !(m.plan && /medcampus|churchyard|hqsite|regional|county/.test(m.plan.vid || ""))), "an older save's world: no site, none of the new plans");
}

console.log(`\n${passes} passed, ${fails} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
