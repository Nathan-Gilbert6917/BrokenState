// Museums (issue #58, sim/museumlayout.js; the user's request 2026-10-26: "museum"):
//   - the variants: 12+ (MUSEUM_KEYS), each with its plans, registered with the shared picker (variantpick.js "museum",
//     "museum:<variant>"); every plan builds over SEEDS seeds a plan with its vid / vname, its footprint and storeys inside
//     its REAL_SIZE.museum.sizes row, its spec drawn at its real size (real);
//   - the rooms the issue names across the type (galleries and halls, an atrium, a gift shop, a café, archives and
//     storage, conservation labs, the loading dock, security, offices), and each variant its own (a dinosaur hall, a
//     vehicle hall, period rooms, play halls, hangars, a car hall, an engine shed, a boat hall, the Oval Office replica,
//     rooms of wax figures);
//   - the pieces: display cases (containers), plinths (sculptures), exhibit vehicles (aircraft, the Army's, cars; their
//     own containers), liftable art worth carrying (data-furniture.js FURNITURE_VALUE: 25+ an item);
//   - the loot: every variant has containers; the tables' value per 100 m² of floor printed by variant (the library's,
//     #34, about 5–7), the type's mean within MUSEUM_BAND; the military museum's arms vault locked, its cases
//     locks.js relic (a working antique in its lock loot), a gallery's cases showcase now and then;
//   - the picker: a city centre picks the big museums (large or huge), a town the small and medium ones, a pin wins,
//     an older save's pick is null;
//   - the scenes (interiorscenes.js: musloot, musshelter, musvault, musclosed) turn up over the plans;
//   - placement: the table's row (huge at a city centre, small in a town), PLACE_EXTRA's museums on a new world's map and
//     in its city crawl, none in an older world's.
// Usage: node tools/museumtest.js [seeds a plan, default 6; BS_QUICK=1: 3]
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, buildingMap, buildingSpec } from "../src/sim/buildingmaps.js";
import { MUSEUM_KEYS, MUSEUM_VARIANTS, MUSEUM_NAMES, museumSetting } from "../src/sim/museumlayout.js";
import { variantsOf, pickVariant, variantSize } from "../src/sim/variantpick.js";
import { REAL_SIZE } from "../src/sim/data-buildingsize.js";
import { FURNITURE_GEAR, FURNITURE_VALUE } from "../src/sim/data-furniture.js";
import { LOCKS } from "../src/sim/locks.js";
import { SCENE_KINDS } from "../src/sim/interiorscenes.js";
import { boxLoot, AREAS } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { sizeFor, PLACE_EXTRA } from "../src/sim/placement.js";
import { ensurePois } from "../src/sim/pois.js";
import * as CC from "../src/sim/citycrawl.js";
import { gridOf, cellsOf, keyOf } from "../src/sim/citygrid.js";

const SEEDS = Number(process.argv[2]) || (process.env.BS_QUICK ? 3 : 6);
const MUSEUM_BAND = [3, 12]; // the type's mean tables' value per 100 m² of floor (the library's #34 mean 6.9)
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };

const state = createWorld({ seed: 5858, factionCount: 4 });
state.roomsLegacy = false;
const tileId = Object.values(state.tiles).find((t) => t.terrain === "plains" && !t.loc).id;

// ---------- 1. the variants ----------
console.log("The variants");
check(MUSEUM_KEYS.length >= 12, `${MUSEUM_KEYS.length} variants (want 12+): ${MUSEUM_KEYS.map((k) => MUSEUM_NAMES[k]).join(", ")}`);
check(variantsOf("museum").length === MUSEUM_KEYS.length && MUSEUM_KEYS.every((v) => variantsOf(`museum:${v}`).length >= 2), "registered with the shared picker: museum and museum:<variant> (two plans or more each)");
check(MUSEUM_KEYS.every((v) => REAL_SIZE.museum.sizes[v] && REAL_SIZE.museum.planned), "every variant has its REAL_SIZE.museum.sizes row (planned)");
check(!!BUILDINGS.museum && BUILDINGS.museum.name === "Museum", "BUILDINGS.museum");

// ---------- 2. every plan built ----------
console.log(`\nEvery plan, ${SEEDS} seeds`);
const rows = [], errs = [], roomNames = {}, kindsBy = {}, scenesSeen = new Set();
const ALL_ROOMS = new Set();
for (const v of MUSEUM_KEYS) for (const p of MUSEUM_VARIANTS[v].plans) {
  const S = REAL_SIZE.museum.sizes[v];
  let n = 0, area = 0, val = 0, boxes = 0, storeys = new Set();
  for (let s = 0; s < SEEDS; s++) {
    const opt = { id: `mt${v}${p}${s}`, key: "museum", name: "Museum", plan: `${v}/${p}` };
    let m, spec;
    try { spec = buildingSpec(state, tileId, opt); m = buildingMap(state, tileId, opt, null); } catch (e) { errs.push(`${v}/${p} ${s}: ${e.message}`); continue; }
    if (spec.vid !== `${v}/${p}` || spec.vname !== MUSEUM_NAMES[v] || m.vid !== spec.vid) errs.push(`${v}/${p}: vid ${spec.vid} / ${m.vid}, vname ${spec.vname}`);
    if (spec.bw < S.w[0] || spec.bw > S.w[1] || spec.bh < S.d[0] || spec.bh > S.d[1]) errs.push(`${v}/${p}: ${spec.bw} × ${spec.bh} outside ${S.w} × ${S.d}`);
    if (m.storeys < 1 || m.storeys > S.storeys[1]) errs.push(`${v}/${p}: ${m.storeys} storeys (row ${S.storeys})`);
    storeys.add(m.storeys);
    n++;
    area += spec.bw * spec.bh * m.storeys;
    for (const r of m.rooms) if (!r.outdoor) { (roomNames[v] = roomNames[v] || new Set()).add(r.name.replace(/ \d+[AB]?$/, "")); ALL_ROOMS.add(r.name); }
    const kinds = (kindsBy[v] = kindsBy[v] || {});
    for (const g of m.floors || [{ cells: m.cells }]) for (const c of g.cells) kinds[c.k] = (kinds[c.k] || 0) + 1;
    for (const c of m.containers) {
      const a = m.rooms.find((r) => r.id === c.area);
      kinds[`box:${c.kind}`] = (kinds[`box:${c.kind}`] || 0) + 1;
      if (c.lockKind) kinds[`lock:${c.lockKind}`] = (kinds[`lock:${c.lockKind}`] || 0) + 1;
      if (!a || !a.type || a.outdoor || !AREAS[a.type] || a.type === "wreck" || a.type === "roadcars") continue; // the cars left in the street are not the museum's
      val += value(boxLoot(a.type, c.kind)); boxes++;
    }
    for (const sc of (m.scenes && m.scenes.list) || []) scenesSeen.add(sc.kind);
  }
  rows.push({ v, p, n, area: area / Math.max(1, n), val: val / Math.max(1, n), boxes: boxes / Math.max(1, n), per: (val / Math.max(1, area)) * 100, storeys: [...storeys].sort().join("/") });
}
check(!errs.length, `every plan builds, named, at its row's size and storeys (${errs.length} problems: ${errs.slice(0, 4).join("; ")})`);
console.log("\n  plan                      floor m²  storeys  containers  value  per 100 m²");
for (const r of rows) console.log(`  ${`${r.v}/${r.p}`.padEnd(24)} ${r.area.toFixed(0).padStart(8)}  ${r.storeys.padStart(7)}  ${r.boxes.toFixed(1).padStart(10)}  ${r.val.toFixed(0).padStart(5)}  ${r.per.toFixed(1).padStart(10)}`);

// ---------- 3. the rooms and the pieces ----------
console.log("\nThe rooms and the pieces");
const has = (v, re) => [...(roomNames[v] || [])].some((n) => re.test(n));
const ISSUE_ROOMS = [["galleries", /Galler|hall$/i], ["an atrium", /Atrium|Lobby|Rotunda|Great hall|Entrance/], ["a gift shop", /shop|store|chandlery/i], ["a café", /Café|Snack bar/], ["archives and storage", /Archive|store$|Store/], ["a conservation lab", /Conservation|Preparation lab|conservation/], ["the loading dock", /Loading dock/], ["security", /^Security$/], ["offices", /Offices|office/]];
for (const [what, re] of ISSUE_ROOMS) check(["art", "natural", "presidential"].some((v) => has(v, re)) && MUSEUM_KEYS.filter((v) => has(v, re)).length >= 2, `${what} in the big museums (${MUSEUM_KEYS.filter((v) => has(v, re)).join(", ")})`);
const OWN = { natural: /Dinosaur hall/, military: /Vehicle hall|Drill hall/, localhist: /as it was|Parlour|Front room/, children: /Climbing hall|Play hall/, aviation: /hangar/i, car: /Car hall|Classic cars/, railway: /shed/i, maritime: /Boat hall/, presidential: /Oval Office/, wax: /Figure hall|Hollywood|World leaders|Royals/, art: /Sculpture/, science: /Planetarium/, county: /Exhibit hall|Pioneer hall/ };
for (const v of MUSEUM_KEYS) check(!OWN[v] || has(v, OWN[v]), `${MUSEUM_NAMES[v]}: its own rooms (${[...(roomNames[v] || [])].slice(0, 8).join(", ")})`);
const k = (v, kind) => (kindsBy[v] && kindsBy[v][kind]) || 0;
check(MUSEUM_KEYS.every((v) => k(v, "box:displaycase") > 0), `display cases searched in every variant (${MUSEUM_KEYS.map((v) => `${v} ${k(v, "box:displaycase")}`).join(", ")})`);
check(k("art", "sculpture") > 0 && k("natural", "fossil") > 0 && k("wax", "waxfigure") > 0 && k("railway", "railcar") > 0 && k("maritime", "boat") > 0 && k("military", "cannon") > 0, "plinths (sculptures), skeletons, wax figures, handcars, boats, field guns");
check(k("aviation", "box:exhibitplane") > 0 && k("military", "box:exhibitcar") > 0 && k("car", "box:exhibitcar") > 0, `exhibit vehicles: aircraft ${k("aviation", "box:exhibitplane")}, the Army's ${k("military", "box:exhibitcar")}, cars ${k("car", "box:exhibitcar")}`);
const art = Object.keys(FURNITURE_VALUE);
check(art.every((a) => FURNITURE_GEAR[`f_${a}`] && FURNITURE_GEAR[`f_${a}`].value >= 25) && art.every((a) => MUSEUM_KEYS.some((v) => k(v, a) > 0)), `liftable art worth carrying, laid out: ${art.map((a) => `${a} ${FURNITURE_GEAR[`f_${a}`].value}`).join(", ")}`);

// ---------- 4. the loot ----------
console.log("\nThe loot");
check(rows.every((r) => r.boxes >= 2), `every plan has containers (${rows.filter((r) => r.boxes < 2).map((r) => `${r.v}/${r.p}`).join(", ") || "all"})`);
const meanPer = rows.reduce((a, r) => a + r.per, 0) / rows.length;
check(meanPer >= MUSEUM_BAND[0] && meanPer <= MUSEUM_BAND[1], `the tables' value per 100 m² of floor: ${meanPer.toFixed(1)} mean (the library's about 6.9; band ${MUSEUM_BAND.join("–")})`);
check(k("military", "lock:relic") > 0 && LOCKS.relic && LOCKS.showcase, `the arms vault's cases locked (relic: ${k("military", "lock:relic")}), a gallery's now and then (showcase: ${MUSEUM_KEYS.reduce((a, v) => a + k(v, "lock:showcase"), 0)})`);
check(["musgallery", "musgift", "muscafe", "muslab", "musstore", "musdock", "mussec", "musarms"].every((t) => AREAS[t]), "the museum's areas (combat.js AREAS from data-museums.js)");
check(!AREAS.musarms.gear.some(([g]) => GEAR[g] && ["pistol", "rifle", "shotgun", "automatic"].includes(GEAR[g].cat)) && !AREAS.mussec.gear.some(([g]) => GEAR[g] && ["pistol", "rifle", "shotgun", "automatic"].includes(GEAR[g].cat)), "no guns on a gallery's shelves or with security: only in the arms vault's locked cases");

// ---------- 5. the picker ----------
console.log("\nThe picker");
const ROLLS = Array.from({ length: 200 }, (_, i) => (i + 0.5) / 200);
const sizes = (ctx) => { const o = {}; for (const r of ROLLS) { const e = pickVariant("museum", null, { ...ctx, r }); const s = variantSize("museum", e); o[s] = (o[s] || 0) + 1; } return o; };
const centre = sizes({ setting: museumSetting({ tileClass: "centre", lset: "city" }) }), town = sizes({ setting: museumSetting({ tileClass: "town", lset: "town" }) });
check(((centre.large || 0) + (centre.huge || 0)) / ROLLS.length >= 0.8 && (centre.huge || 0) / ROLLS.length >= 0.4, `a city centre's museums big: ${JSON.stringify(centre)}`);
check(((town.small || 0) + (town.medium || 0)) / ROLLS.length >= 0.8 && (town.small || 0) / ROLLS.length >= 0.5, `a town's small and medium: ${JSON.stringify(town)}`);
check(pickVariant("museum", null, { plan: "wax", setting: "centre", r: 0.5 }).id === "wax" && pickVariant("museum", null, { legacy: true }) === null, "a pin wins; an older save's pick is null");
check(MUSEUM_KEYS.every((v) => ROLLS.some((r) => ["centre", "city", "suburb", "town", "rural", "coast", "highway"].some((set) => pickVariant("museum", null, { setting: set, r }).id === v))), "every variant stands somewhere");

// ---------- 6. the scenes ----------
console.log("\nThe scenes");
check(["musloot", "musshelter", "musvault", "musclosed"].every((s) => SCENE_KINDS[s] && SCENE_KINDS[s].when), "registered with their when");
check(["musloot", "musshelter", "musvault", "musclosed"].filter((s) => scenesSeen.has(s)).length >= 3, `turn up over the plans: ${[...scenesSeen].join(", ")}`);

// ---------- 7. placement ----------
console.log("\nPlacement");
check(sizeFor("museum", "centre") === "huge" && sizeFor("museum", "town") === "small" && sizeFor("museum", "city") === "large" && PLACE_EXTRA.some(([kind]) => kind === "museum"), "the table: huge at a city centre, large in the city, small in a town; PLACE_EXTRA holds it");
{
  let pois = 0, crawl = 0, oldPois = 0, oldCrawl = 0, worlds = process.env.BS_QUICK ? 4 : 8;
  for (let w = 0; w < worlds; w++) {
    for (const legacy of [false, true]) {
      const st = createWorld({ seed: 58000 + w, factionCount: 3, size: "small" });
      if (legacy) { st.placeLegacy = true; delete st.placeV; for (const t of st.tiles) delete t.pois; ensurePois(st); }
      const n = st.tiles.reduce((a, t) => a + (t.pois || []).filter((p) => p.kind === "museum").length, 0);
      const city = st.tiles.find((x) => x.loc && x.loc.type === "city");
      let c0 = 0;
      if (city) {
        const g = gridOf(st, city), c = { tile: city.id, grid: { size: g.size, r: g.r, town: g.town }, blocks: {}, visit: 1, alert: 0, trail: {}, cell: null };
        for (const [x, y] of cellsOf(c.grid)) {
          const b = CC.genBlock(st, c, keyOf(x, y));
          for (const pl of b.places) if (pl.key === "museum") { c0++; if (!legacy && !buildingMap(st, city.id, CC.placeOption(c, pl, b.n), false).vid) c0 = -999; }
        }
      }
      if (legacy) { oldPois += n; oldCrawl += c0; } else { pois += n; crawl += c0; }
    }
  }
  check(pois > 0 && crawl > 0, `a new world's museums: ${pois} on the map, ${crawl} in its city crawls (${worlds} worlds)`);
  check(oldPois === 0 && oldCrawl === 0, `an older world's: none (${oldPois} on the map, ${oldCrawl} in its crawls)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
