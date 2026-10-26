// Where buildings stand: the placement table by setting (issue #42, src/sim/data-placement.js, src/sim/placement.js).
//   - the table: a row for every BUILDINGS key, every site type (SITES) and every POI kind, its classes and size classes
//     real, its "of" rows resolved, every kind standing somewhere;
//   - the tile classes: every class on the map, a centre within PLACE.CENTRE_R of a city's heart, the crawl's classes;
//   - over 100 worlds (30 with --quick / BS_QUICK): the big kinds' huge buildings within PLACE.BIG_R of a city's heart, the
//     hospitals by the city centres, no huge building on a rural tile and rural tiles mostly small, towns holding both
//     large and small buildings, every kind turning up at a sensible rate, no POI where the table says its kind never
//     stands;
//   - the crawl: a city crawl's heart holds more hospitals than its rim;
//   - older worlds: their POI lists and crawl blocks hash exactly as before the table (placeLegacy), a save from before
//     the data centres gets none (dcLegacy, issue #51); a save from before
//     loads as one; a new world's are the table's.
// Usage: node tools/placementtest.js [worlds]
import { createHash } from "node:crypto";
import { createWorld } from "../src/sim/world.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { BUILDINGS, SITES } from "../src/sim/buildingmaps.js";
import { LOCATIONS } from "../src/sim/data.js";
import { ensurePois, allPoiKinds } from "../src/sim/pois.js";
import { PLACEMENT, PLACEMENT_ROWS, TILE_CLASSES, SIZE_CLASSES, BIG_KINDS, PLACE } from "../src/sim/data-placement.js";
import { tileClass, crawlClass, sizeFor, placeWeight, classesOf, sizeClassOf, placementCtx, settingOfClass, cityDistance } from "../src/sim/placement.js";
import * as CC from "../src/sim/citycrawl.js";
import { gridOf, cellsOf, keyOf, maxLevel } from "../src/sim/citygrid.js";

const QUICK = !!process.env.BS_QUICK;
const WORLDS = Number(process.argv[2] || (QUICK ? 30 : 100));
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const hash = (x) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 16);

// ---------- 1. the table ----------
console.log("The table");
{
  const temp = (k) => LOCATIONS[k] && (LOCATIONS[k].temp || /^crash|^airdrop$|^convoy$/.test(k));
  const keys = [...new Set([...Object.keys(BUILDINGS), ...Object.keys(SITES), ...allPoiKinds(), ...Object.keys(LOCATIONS).filter((k) => !temp(k))])];
  const missing = keys.filter((k) => !PLACEMENT_ROWS[k]);
  check(!missing.length, `a row for every building key, site type and POI kind (${keys.length}; missing: ${missing.join(", ") || "none"})`);
  const bad = Object.entries(PLACEMENT).filter(([, r]) => Object.keys(r.at).some((c) => !TILE_CLASSES.includes(c)) || Object.values(r.size).some((s) => !SIZE_CLASSES.includes(s)) || Object.values(r.at).some((w) => !(w > 0)));
  check(!bad.length, `every row's classes, weights and sizes real (${bad.map(([k]) => k).join(", ") || "all"})`);
  const nowhere = Object.keys(PLACEMENT).filter((k) => !classesOf(k).length);
  check(!nowhere.length, `every kind stands somewhere (${nowhere.join(", ") || "all"})`);
  const ofs = Object.entries(PLACEMENT).filter(([, r]) => r.of);
  check(ofs.every(([, r]) => PLACEMENT_ROWS[r.of] && !/^of /.test(PLACEMENT_ROWS[r.of])), `a site's own buildings take its row (${ofs.length}: a barracks the military base's, a dorm the university's)`);
  check(TILE_CLASSES.every((c) => Object.values(PLACEMENT).some((r) => r.at[c] > 0)), "every tile class holds some kinds");
  const huge = Object.entries(PLACEMENT).filter(([, r]) => Object.entries(r.size).some(([c, s]) => s === "huge" && c !== "centre" && c !== "city")).map(([k]) => k);
  check(!huge.length, `huge only in a city's centre and blocks (${huge.join(", ") || "none elsewhere"})`);
  check(["hospital", "mall", "univ"].every((k) => sizeFor(k, "centre") === "huge") && sizeFor("hospital", "town") === "large" && sizeFor("clinic", "rural") === "small" && sizeFor("church", "rural") && sizeFor("feedstore", "rural") && sizeFor("farmstand", "rural") === "small",
    `the big kinds huge downtown, a town's county hospital large, the country's clinic, chapel, feed store and farm stand (${sizeFor("hospital", "centre")}, ${sizeFor("hospital", "town")}, ${sizeFor("clinic", "rural")})`);
  check(["supermarket", "school", "hospital"].every((k) => sizeFor(k, "town") === "large"), "a town's big-box store, regional high school and county hospital large");
  check(sizeClassOf(12, 10) === "small" && sizeClassOf(30, 30) === "medium" && sizeClassOf(60, 50, 2) === "large" && sizeClassOf(100, 80, 4) === "huge", "a footprint's size class by its floor area");
  check(settingOfClass("centre") === "city" && settingOfClass("suburb") === "town" && settingOfClass("scenic") === "rural" && placeWeight("hospital", "rural") === 0, "the classes as the layouts' three settings; a kind never where its row says not");
}

// ---------- 2. over the worlds ----------
console.log(`\n${WORLDS} worlds (small maps)`);
const tally = { cities: 0, cls: {}, kinds: {}, rural: { n: 0, small: 0, huge: [] }, bigFar: [], hospital: { n: 0, near: 0 }, notHere: [], towns: { n: 0, large: 0, small: 0, both: 0 }, crawl: { centre: [0, 0], suburb: [0, 0] }, crawlKinds: {}, centreFar: 0 };
const add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
let firstWorld = null;
for (let w = 0; w < WORLDS; w++) {
  const st = createWorld({ seed: 91000 + w, factionCount: 3, size: "small" });
  if (!firstWorld) firstWorld = st;
  tally.cities += (st.cityIds || []).length;
  const placed = []; // [kind, tile, cls, fromSite]
  for (const t of st.tiles) {
    const cls = tileClass(st, t);
    add(tally.cls, cls);
    if (cls === "centre" && cityDistance(st, t.id) > PLACE.CENTRE_R) tally.centreFar++;
    const site = t.loc && !LOCATIONS[t.loc.type].temp && !/^crash|^airdrop$|^convoy$/.test(t.loc.type) && t.loc.type !== "town" && t.loc.type !== "city" ? t.loc.type : null;
    if (site) placed.push([site, t, cls, true]);
    for (const p of t.pois || []) if (!p.site) placed.push([p.kind, t, cls, false]);
  }
  for (const [kind, t, cls, site] of placed) {
    add(tally.kinds, kind);
    const size = sizeFor(kind, cls);
    if (!site && !size) tally.notHere.push(`${kind} on ${cls}`);
    if (cls === "rural") { tally.rural.n++; if (size === "small" || size === "medium") tally.rural.small++; if (size === "huge") tally.rural.huge.push(kind); }
    if (size === "huge" && cityDistance(st, t.id) > PLACE.BIG_R) tally.bigFar.push(`${kind} ${cityDistance(st, t.id)} out`);
    if (kind === "hospital") { tally.hospital.n++; if (cityDistance(st, t.id) <= PLACE.BIG_R) tally.hospital.near++; }
  }
  // Towns: what their own tile and their ring hold (sites and POIs), by the table's size there.
  const byTown = new Map();
  for (const t of st.tiles) if (t.loc && t.loc.type === "town") byTown.set(t.id, { large: 0, small: 0 });
  for (const [kind, t, cls] of placed) {
    if (cls !== "town") continue;
    const town = [...byTown.keys()].find((id) => st.grid.distance(id, t.id) <= 2);
    if (town == null) continue;
    const s = sizeFor(kind, cls);
    if (s === "large" || s === "huge") byTown.get(town).large++;
    if (s === "small") byTown.get(town).small++;
  }
  for (const v of byTown.values()) { tally.towns.n++; if (v.large) tally.towns.large++; if (v.small) tally.towns.small++; if (v.large && v.small) tally.towns.both++; }
  // A city's crawl: the heart's blocks against the rim's.
  if (w < (QUICK ? 6 : 20)) {
    const t = st.tiles.find((x) => x.loc && x.loc.type === "city");
    const g = gridOf(st, t);
    const c = { tile: t.id, grid: { size: g.size, r: g.r, town: g.town }, blocks: {}, visit: 1, alert: 0, trail: {}, cell: null };
    for (const [x, y] of cellsOf(c.grid)) {
      const b = CC.genBlock(st, c, keyOf(x, y));
      const cls = crawlClass(c, b.n, "city");
      for (const p of b.places) add(tally.crawlKinds, p.key);
      if (cls !== "centre" && cls !== "suburb") continue;
      tally.crawl[cls][0] += b.places.length;
      tally.crawl[cls][1] += b.places.filter((p) => p.key === "hospital").length;
    }
  }
}
console.log(`  tiles by class: ${TILE_CLASSES.map((c) => `${c} ${tally.cls[c] || 0}`).join(", ")}`);
check(TILE_CLASSES.every((c) => tally.cls[c] > 0) && !tally.centreFar, `every class on the map; every centre tile within ${PLACE.CENTRE_R} of a city's heart`);
check(!tally.bigFar.length, `every huge building within ${PLACE.BIG_R} tiles of a city's heart (${tally.bigFar.slice(0, 6).join(", ") || "all"})`);
check(tally.hospital.near / tally.hospital.n >= 0.5, `hospitals by the city centres: ${pct(tally.hospital.near / tally.hospital.n)} of ${tally.hospital.n} within ${PLACE.BIG_R} tiles of a heart (at least half)`);
check(!tally.rural.huge.length, `no huge building on a rural tile (${tally.rural.n} placed there; ${tally.rural.huge.slice(0, 5).join(", ") || "none huge"})`);
check(tally.rural.small / tally.rural.n >= 0.85, `rural tiles hold small buildings: ${pct(tally.rural.small / tally.rural.n)} small or medium (at least 85%)`);
check(tally.towns.small / tally.towns.n >= 0.95 && tally.towns.large / tally.towns.n >= 0.5, `towns hold both: ${pct(tally.towns.both / tally.towns.n)} of ${tally.towns.n} both, ${pct(tally.towns.large / tally.towns.n)} a large building, ${pct(tally.towns.small / tally.towns.n)} a small one`);
check(!tally.notHere.length, `no POI where the table says its kind never stands (${[...new Set(tally.notHere)].slice(0, 8).join(", ") || "none"})`);
{
  // Every kind that stands on the map by itself (not a site's own building, not the land or a settlement; Crashlanding's
  // mountain bunker only there) turns up, on the map or in a city's crawl (city hall and the courthouse).
  const own = Object.keys(PLACEMENT).filter((k) => !PLACEMENT[k].of && LOCATIONS[k] && !["town", "city", "suburb", "plains", "forest", "hills", "mountain", "bunker_mil"].includes(k));
  const rare = own.filter((k) => !tally.kinds[k] && !tally.crawlKinds[k]);
  const per = (k) => (tally.kinds[k] || 0) / WORLDS;
  console.log(`  a world holds: ${own.map((k) => `${k} ${per(k).toFixed(1)}`).join(", ")}`);
  check(!rare.length, `every kind turns up (${own.length} kinds; none of: ${rare.join(", ") || "-"})`);
  const cities = tally.cities / WORLDS;
  check(per("hospital") >= cities && per("hospital") <= cities * 3 && per("house") > per("hospital") * 20 && per("clinic") > per("hospital") && per("church") > per("hospital"),
    `at sensible rates: a hospital or two a city, clinics and churches more, homes far more (${cities.toFixed(1)} cities, ${per("hospital").toFixed(1)} hospitals, ${per("clinic").toFixed(1)} clinics, ${per("church").toFixed(1)} churches, ${per("house").toFixed(1)} houses a world)`);
}
{
  const [cn, ch] = tally.crawl.centre, [sn, sh] = tally.crawl.suburb;
  check(cn > 0 && sn > 0 && ch / cn > (sh / sn) * 2, `a city crawl's heart holds more hospitals than its rim (${pct(ch / cn)} of ${cn} places against ${pct(sh / sn)} of ${sn})`);
  const g = { size: 30, r: 15 };
  check(crawlClass(g ? { grid: g } : null, 1) === "suburb" && crawlClass({ grid: g }, maxLevel(g)) === "centre" && crawlClass({ grid: { size: 10, r: 5, town: true } }, 3) === "town", "the crawl's classes: the rim suburbs, the heart the centre, a town's crawl a town");
}
{
  const st = firstWorld;
  const t = st.tiles.find((x) => tileClass(st, x) === "centre");
  const ctx = placementCtx(st, t, "hospital");
  check(ctx.tileClass === "centre" && ctx.setting === "centre" && ctx.size === "huge", `the picker's ctx: ${JSON.stringify(ctx)}`);
}

// ---------- 3. older worlds ----------
console.log("\nOlder worlds");
{
  // The hashes of two worlds' POI lists and their first city's and town's crawl blocks, from dev before the table
  // (016f555): an older save regenerates exactly these.
  const BASE = { 4242: ["9fe2456855e99de6", "1d818c3569a06463"], 4243: ["2de2a78738056c6b", "960da84ac7d53f41"] };
  const run = (seed, legacy) => {
    const st = createWorld({ seed, factionCount: 3, size: "small" });
    if (legacy) { st.placeLegacy = true; st.shopsR2Legacy = true; st.civicLegacy = true; } // a save from before the table is from before #55's shops and #49's civic real scale too (save.js marks all three)
    for (const t of st.tiles) delete t.pois;
    ensurePois(st);
    const blocks = [];
    for (const type of ["city", "town"]) {
      const t = st.tiles.find((x) => x.loc && x.loc.type === type);
      const g = gridOf(st, t);
      const c = { tile: t.id, grid: { size: g.size, r: g.r }, blocks: {}, visit: 1, alert: 0, trail: {}, cell: null };
      for (const [x, y] of cellsOf(c.grid)) { const b = CC.genBlock(st, c, keyOf(x, y)); blocks.push(b.places.map((p) => [p.key, p.v || "", p.name])); }
    }
    return [hash(st.tiles.map((x) => x.pois)), hash(blocks)];
  };
  for (const seed of Object.keys(BASE)) {
    const old = run(+seed, true), now = run(+seed, false);
    check(old[0] === BASE[seed][0] && old[1] === BASE[seed][1], `world ${seed} as an older save: its POIs and crawl blocks as before (${old.join(" ")})`);
    check(now[0] !== old[0] && now[1] !== old[1], `world ${seed} as a new world: placed by the table (${now.join(" ")})`);
  }
  const st = createWorld({ seed: 4242, factionCount: 3, size: "small" });
  check(st.placeV === 1 && !st.placeLegacy, "a new world carries placeV");
  delete st.placeV;
  const back = deserializeState(serializeState(st));
  check(!!back.placeLegacy, "a save from before the table loads as an older world (placeLegacy)");
  // Data centres (issue #51): a new world carries dcV; a save from before them loads with none on its tiles (dcLegacy).
  const dc = createWorld({ seed: 4242, factionCount: 3, size: "small" });
  check(dc.dcV === 1 && !dc.dcLegacy, "a new world carries dcV (issue #51)");
  delete dc.dcV;
  const dcBack = deserializeState(serializeState(dc));
  for (const t of dcBack.tiles) delete t.pois;
  ensurePois(dcBack);
  check(!!dcBack.dcLegacy && !dcBack.tiles.some((t) => (t.pois || []).some((p) => p.kind === "datacenter")), "a save from before the data centres loads as one (dcLegacy): none on its tiles");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
