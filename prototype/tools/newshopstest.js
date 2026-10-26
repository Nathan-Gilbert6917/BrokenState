// Six more shops (issue #55 of the round-2 epic #39, the user's request 2026-10-26: "furniture store, laundromat, thrift
// store, bakery, butcher, deli"; src/sim/data-newshops.js, the plans shopvariants.js's, the rooms shoplayout.js's):
//   - the tables: each kind a site type, a building, its SITES entry, its shop weights, 4+ franchises covering its
//     dozen plans, a placement row (#42), a loot-sense row (#43), a REAL_SIZE row with a sizes row a variant (#24), its
//     plans registered with the shared picker (#41) with their size classes;
//   - older saves: a world from before #55 (shopsR2Legacy; a save without shopsR2V loads as one) regenerates its POI
//     lists and its crawl blocks exactly as dev before this ticket (0e4a8b3);
//   - a new world: every kind stands somewhere, a bakery or a butcher out in the country (placement.js PLACE_EXTRA), and
//     its plan's size class the placement table's for its tile (a suburb's big-box furniture store, a town's small one);
//   - inside: a furniture store's showroom full of pieces to lift (the carry system's), a laundromat's washers and dryers
//     liftable, its change machine; a bakery's deck ovens and mixers; a butcher's band saw and walk-in; the deli's prep
//     kitchen #33's deli kitchen (its slicer; the flat-top where it fits), its food #33's deli mix;
//   - the food: a bakery's flour, sugar and bread (bread spoils in days), a butcher's meat;
//   - the scenes: a laundromat lived in, a showroom barricaded with its own stock, registered with their when.
// Usage: node tools/newshopstest.js [worlds, default 12; BS_QUICK=1: 6]
import { createHash } from "node:crypto";
import { createWorld } from "../src/sim/world.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { BUILDINGS, SITES, assemble, buildingSpec } from "../src/sim/buildingmaps.js";
import { LOCATIONS } from "../src/sim/data.js";
import { PLACE_W, FRANCHISES } from "../src/sim/data-shops.js";
import { NEWSHOP_KEYS, NEWSHOP_TYPES } from "../src/sim/data-newshops.js";
import { PLACEMENT_ROWS } from "../src/sim/data-placement.js";
import { REAL_SIZE } from "../src/sim/data-buildingsize.js";
import { LOOT_SENSE } from "../src/sim/lootsense.js";
import { FURNITURE_KINDS } from "../src/sim/data-furniture.js";
import { MIXES, FOODS } from "../src/sim/foods.js";
import { SCENE_KINDS } from "../src/sim/interiorscenes.js";
import { variantsOf, variantFor } from "../src/sim/variantpick.js";
import { ensurePois } from "../src/sim/pois.js";
import { tileClass, sizeFor } from "../src/sim/placement.js";
import * as CC from "../src/sim/citycrawl.js";
import { gridOf, cellsOf, keyOf } from "../src/sim/citygrid.js";
import { Rng } from "../src/sim/rng.js";

const QUICK = !!process.env.BS_QUICK;
const WORLDS = Number(process.argv[2] || (QUICK ? 6 : 12));
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();
const hash = (x) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 16);
const make = (key, seed, o = {}) => { const rng = new Rng(seed); const spec = BUILDINGS[key].make(rng, o); return assemble(rng, spec, { key, name: key, legacy: false, noDecor: true }); };
const cellsOfMap = (m) => (m.floors ? m.floors.flatMap((f) => f.cells) : m.cells);

// ---------- 1. the tables ----------
console.log("The tables");
{
  const bad = [];
  for (const k of NEWSHOP_KEYS) {
    if (!LOCATIONS[k]) bad.push(`${k}: no site type`);
    if (!BUILDINGS[k] || !SITES[k] || SITES[k][0] !== k) bad.push(`${k}: no building or SITES entry`);
    if (!PLACE_W[k]) bad.push(`${k}: no shop weights`);
    if (!PLACEMENT_ROWS[k]) bad.push(`${k}: no placement row`);
    if (!LOOT_SENSE[k]) bad.push(`${k}: no loot-sense row`);
    const fr = FRANCHISES[k] || [], vs = NEWSHOP_TYPES[k].variants, cover = new Set(fr.flatMap((f) => f.plan.variants));
    if (fr.length < 4 || vs.some((v) => !cover.has(v.id))) bad.push(`${k}: franchises (${fr.length}) do not cover its plans`);
    if (vs.length < 12) bad.push(`${k}: ${vs.length} plans`);
    const R = REAL_SIZE[k];
    if (!R || !R.planned || !R.sizes || vs.some((v) => !R.sizes[v.id] || !R.sizes[v.id].w || !R.sizes[v.id].d || !R.sizes[v.id].storeys)) bad.push(`${k}: REAL_SIZE sizes rows`);
    const reg = variantsOf(`shop:${k}`);
    if (reg.length !== vs.length || reg.some((e) => !e.sizeClass || !e.foot)) bad.push(`${k}: the picker's entries and their size classes`);
  }
  check(!bad.length, `each of the six: its site type, building, weights, franchises, placement and loot-sense rows, REAL_SIZE sizes a variant, picker entries (${bad.join("; ") || NEWSHOP_KEYS.join(", ")})`);
}

// ---------- 2. older saves ----------
console.log("Older saves");
{
  // The hashes of two worlds' POI lists and their first city's and town's crawl blocks on dev before this ticket
  // (0e4a8b3, worlds made since #42, #54, #58 and #60): a save from before #55 regenerates exactly these.
  const BASE = { 4242: ["5226b79c7af26b02", "20bca0896464f29f"], 4243: ["8d084359037daebc", "3f97f8daf3c304db"] };
  const run = (seed, legacy) => {
    const st = createWorld({ seed, factionCount: 3, size: "small" });
    if (legacy) { st.shopsR2Legacy = true; st.civicLegacy = true; st.dcLegacy = true; st.sawLegacy = true; st.minesLegacy = true; st.farmLegacy = true; } // a save from before #55 is from before #49's civic real scale, #51's data centres and #53's sawmills #52's mines and #62's farms too (save.js marks them all)
    for (const t of st.tiles) delete t.pois;
    ensurePois(st);
    const blocks = [];
    for (const type of ["city", "town"]) {
      const t = st.tiles.find((x) => x.loc && x.loc.type === type);
      const g = gridOf(st, t);
      const c = { tile: t.id, grid: { size: g.size, r: g.r }, blocks: {}, visit: 1, alert: 0, trail: {}, cell: null };
      for (const [x, y] of cellsOf(c.grid)) { const b = CC.genBlock(st, c, keyOf(x, y)); blocks.push(b.places.map((p) => [p.key, p.v || "", p.name])); }
    }
    return { h: [hash(st.tiles.map((x) => x.pois)), hash(blocks)], kinds: new Set([...st.tiles.flatMap((x) => (x.pois || []).map((p) => p.kind)), ...blocks.flat().map((p) => p[0])]) };
  };
  for (const seed of Object.keys(BASE)) {
    const old = run(+seed, true), now = run(+seed, false);
    check(old.h[0] === BASE[seed][0] && old.h[1] === BASE[seed][1], `world ${seed} from before #55: its POIs and crawl blocks as on dev (${old.h.join(" ")})`);
    check(!NEWSHOP_KEYS.some((k) => old.kinds.has(k)), `world ${seed} from before #55: none of the six`);
    check(now.h[0] !== old.h[0] && NEWSHOP_KEYS.some((k) => now.kinds.has(k)), `world ${seed} as a new world: the six among its places`);
  }
  const st = createWorld({ seed: 4242, factionCount: 3, size: "small" });
  check(st.shopsR2V === 1 && !st.shopsR2Legacy, "a new world carries shopsR2V");
  delete st.shopsR2V;
  check(!!deserializeState(serializeState(st)).shopsR2Legacy, "a save from before #55 loads as one (shopsR2Legacy)");
}

// ---------- 3. a new world: where they stand and their sizes ----------
console.log(`New worlds (${WORLDS})`);
{
  const n = Object.fromEntries(NEWSHOP_KEYS.map((k) => [k, 0]));
  let country = 0, sized = 0, sizedOk = 0, crawl = 0;
  const byClass = {};
  for (let w = 0; w < WORLDS; w++) {
    const st = createWorld({ seed: 5500 + w, factionCount: 3, size: "small" });
    ensurePois(st);
    for (const t of st.tiles) for (const p of t.pois || []) {
      if (!NEWSHOP_KEYS.includes(p.kind)) continue;
      n[p.kind]++;
      const cls = tileClass(st, t);
      if (["rural", "highway", "coast", "scenic"].includes(cls)) country++;
      const want = sizeFor(p.kind, cls);
      const spec = buildingSpec(st, t.id, { id: `t${t.id}`, key: p.kind, variant: p.v || null, kind: p.kind });
      const e = variantFor(`shop:${p.kind}`, spec.vid);
      byClass[`${p.kind} ${cls}`] = (byClass[`${p.kind} ${cls}`] || 0) + 1;
      if (want && e) { sized++; if (e.sizeClass === want) sizedOk++; }
    }
    const town = st.tiles.find((x) => x.loc && x.loc.type === "town"), g = gridOf(st, town);
    const c = { tile: town.id, grid: { size: g.size, r: g.r }, blocks: {}, visit: 1, alert: 0, trail: {}, cell: null };
    for (const [x, y] of cellsOf(c.grid)) crawl += CC.genBlock(st, c, keyOf(x, y)).places.filter((p) => NEWSHOP_KEYS.includes(p.key)).length;
  }
  console.log(`  POIs: ${NEWSHOP_KEYS.map((k) => `${k} ${n[k]}`).join(", ")}; in the country ${country}; on a town's crawl ${crawl}`);
  check(NEWSHOP_KEYS.every((k) => n[k] > 0), "every kind stands somewhere in new worlds");
  check(country > 0, `a bakery or a butcher out in the country (${country})`);
  check(crawl > 0, `the six on the towns' crawls (${crawl})`);
  check(sized > 0 && sizedOk / sized >= 0.8, `a place's plan of the placement table's size class for its tile (${sizedOk} of ${sized})`);
  check(!Object.keys(byClass).some((k) => / (scenic|coast|rural|highway)$/.test(k) && !/^(bakery|butcher|furnstore|thrift|laundromat|deli) /.test(k)), "nothing odd in the country");
}

// ---------- 4. inside ----------
console.log("Inside");
{
  const lift = (k) => FURNITURE_KINDS[k] && FURNITURE_KINDS[k].carry !== "fixed";
  let pieces = 0, stores = 0;
  for (const v of NEWSHOP_TYPES.furnstore.variants) for (let s = 0; s < 3; s++) {
    const m = make("furnstore", 300 + s * 7919 + v.id.length, { layout: v.id });
    const rooms = m.rooms.filter((r) => r.type === "furnshow"), grid = (f) => (m.floors ? m.floors[f].cells : m.cells);
    const seen = new Set();
    for (const r of rooms) for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) { const c = grid(r.f || 0)[y * m.w + x]; if (lift(c.k) && !["shelf", "crate", "checkout", "counter"].includes(c.k)) seen.add(`${r.f || 0}:${c.pc ?? `${x},${y}`}`); }
    pieces += seen.size; stores++;
  }
  check(pieces / stores >= 10, `a furniture store's showroom full of pieces to lift (${(pieces / stores).toFixed(1)} a store: sofas, beds, wardrobes, tables, appliances)`);
  check(lift("washer") && lift("dryer") && lift("mixer") && lift("meatsaw") && lift("changer") && lift("foldtable"), "the washers, dryers, mixers, band saws, change machines and folding tables liftable");
  const bad = [];
  for (const k of ["laundromat", "bakery", "butcher", "deli"]) for (const v of NEWSHOP_TYPES[k].variants) {
    const m = make(k, 41 + v.id.length * 13, { layout: v.id }), cs = cellsOfMap(m), has = (x) => cs.some((c) => c.k === x);
    if (k === "laundromat" && !(has("washer") && has("dryer") && has("changer") && has("foldtable"))) bad.push(`${k} ${v.id}`);
    if (k === "bakery" && !(has("deckoven") && has("mixer") && (has("pastrycase") || has("displaycase")))) bad.push(`${k} ${v.id}`);
    if (k === "butcher" && !((has("meatsaw") || v.id === "sausage") && has("meatcase") && m.rooms.some((r) => /^Walk-in (cooler|freezer)$/.test(r.name)) || v.id === "stall")) bad.push(`${k} ${v.id}`);
    if (k === "deli") {
      const prep = m.rooms.find((r) => r.name === "Prep kitchen");
      if (!(prep && prep.shop === "eatkitchen" && prep.mix === "eat:deli" && has("slicer") && has("coldcase"))) bad.push(`${k} ${v.id}`);
    }
  }
  check(!bad.length, `a laundromat's machines, a bakery's ovens and mixers, a butcher's saw and walk-in (a market stall's walk-in the hall's), the deli's #33 kitchen in every plan (${bad.join(", ") || "all"})`);
}

// ---------- 5. the food and the scenes ----------
console.log("The food and the scenes");
{
  const b = MIXES.bakery, u = MIXES.butcher;
  check(!!b && b.f_flour > 0 && b.f_sugar > 0 && b.f_bread > 0 && FOODS.f_bread.shelf <= 7, "a bakery's food: flour, sugar and bread that spoils in days");
  check(!!u && u.f_frozenmeat > 0 && u.f_sausage > 0, "a butcher's food: meat and sausage");
  check(!!MIXES["eat:deli"], "the deli's food is #33's deli mix");
  check(["laundrycamp", "showroomwall"].every((s) => SCENE_KINDS[s] && typeof SCENE_KINDS[s].when === "function") && SCENE_KINDS.walkin.kinds.includes("butcher"), "the scenes registered with their when (and the walk-in's in a butcher's)");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
