// Unique names on every map (the user, 2026-10-24: "Make sure when any world map is built all city and POI names are
// unique"; sim/mapgen.js usedNames / siteNames / uniqueName / settlementName, sim/pois.js makePoi):
//  1. On a Small and a Normal map on two seeds each, and on a Crashlanding map: every city name, town name and named
//     site (tile.loc.name: countryside sites, landmarks, highway stops, Guard bases, farms...) is unique on the map; no
//     bare number was ever needed ("Hadley 2": the pools and their forms did not run dry); how many names took a
//     distinguishing form ("North Hadley", "Hadley Crossing", "Old Miller Farm") or a numeral ("Hadley II") is printed.
//  2. On every tile, no two POIs carry the same name (pois.js poiName: a franchise or a named place; a kind label such
//     as "Shed" may repeat, the same chain twice on a tile may not), and no two POIs of a kind share a franchise.
//  3. The same seed gives the same names (deterministic).
//  4. A Huge map once (500 × 300, the slowest: timed), the same checks; skipped under BS_QUICK=1.
// Usage: node tools/uniquenametest.js   (BS_QUICK=1 skips the Huge map)
import { createWorld } from "../src/sim/world.js";
import { WORLD_SIZES } from "../src/sim/worldsize.js";
import { CRASH } from "../src/sim/crashmode.js";
import { poisOf, poiName, poiDef } from "../src/sim/pois.js";

const QUICK = process.env.BS_QUICK === "1";
let passed = 0, fails = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = Date.now();

const FORM = /^(North|South|East|West|Upper|Lower|Old|New|Fort|Port|Mount|Lake|Little) |( (Crossing|Junction|Springs|Heights|Mills|Station|Corners|Hollow|Falls|Grove|Landing|City))$/;
const NUMERAL = / (II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/;
const NUMBERED = / \d+$/;
const dupes = (names) => { const seen = new Set(), out = []; for (const n of names) { if (seen.has(n)) out.push(n); seen.add(n); } return out; };

function checkWorld(label, s) {
  const sites = s.tiles.filter((t) => t.loc);
  const towns = sites.filter((t) => t.loc.type === "town"), cities = sites.filter((t) => t.loc.type === "city");
  const names = sites.map((t) => t.loc.name);
  const d = dupes(names);
  check(!d.length, `${label}: ${d.length} site names repeat (${d.slice(0, 5).join("; ")})`);
  check(!dupes(cities.map((t) => t.loc.name)).length && !dupes(towns.map((t) => t.loc.name)).length, `${label}: a city or town name repeats`);
  const numbered = names.filter((n) => NUMBERED.test(n));
  check(!numbered.length, `${label}: ${numbered.length} names took a bare number (${numbered.slice(0, 5).join("; ")})`);
  check(names.every((n) => typeof n === "string" && n.trim().length > 0), `${label}: an empty site name`);
  // POIs: no two names on a tile, no two franchises of a kind on a tile.
  let poiTiles = 0, bad = 0, badFr = 0, named = 0, unnamed = 0;
  const first = [];
  for (const t of s.tiles) {
    const l = poisOf(t);
    if (!l.length) continue;
    poiTiles++;
    const nm = l.map((p, i) => poiName(t, i)).filter(Boolean);
    named += nm.length;
    const dn = dupes(nm.filter((n, i) => l[i] && (l[i].v || l[i].site))); // a franchise or a named place; kind labels may repeat
    if (dn.length) { bad++; if (first.length < 3) first.push(`tile ${t.id}: ${dn.join(", ")}`); }
    const fr = l.filter((p) => p.v).map((p) => `${p.kind}:${p.v}`);
    if (new Set(fr).size !== fr.length) badFr++;
    if (!nm.every((n) => n && n.length) || !l.every((p) => poiDef(p))) unnamed++;
  }
  check(!unnamed, `${label}: ${unnamed} tiles hold a POI with no name or of an unknown kind`);
  check(!bad, `${label}: ${bad} tiles carry the same POI name twice (${first.join("; ")})`);
  check(!badFr, `${label}: ${badFr} tiles carry the same franchise twice`);
  const formed = names.filter((n) => FORM.test(n)).length, numerals = names.filter((n) => NUMERAL.test(n)).length;
  console.log(`  ${label}: ${s.grid.width} × ${s.grid.height}, ${cities.length} cities, ${towns.length} towns, ${sites.length} named sites, all unique; ${formed} in a distinguishing form (${towns.filter((t) => FORM.test(t.loc.name)).length} towns, ${cities.filter((t) => FORM.test(t.loc.name)).length} cities), ${numerals} with a numeral; ${poiTiles} tiles with POIs (${named} names), none twice on a tile`);
  return names;
}
const build = (opts) => { const t = Date.now(); const s = createWorld(opts); return { s, ms: Date.now() - t }; };

console.log("1-2. Small and Normal maps on two seeds, a Crashlanding map");
const seen = {};
for (const size of ["small", "normal"]) for (const seed of [7, 11]) {
  const { s, ms } = build({ seed, factionCount: WORLD_SIZES[size].defGroups, size });
  seen[`${size}:${seed}`] = checkWorld(`${WORLD_SIZES[size].label} seed ${seed} (${(ms / 1000).toFixed(1)} s)`, s);
}
{
  const { s, ms } = build({ seed: 7, factionCount: WORLD_SIZES.large.defGroups, crash: true });
  check(s.grid.width === CRASH.W && s.grid.height === CRASH.H, `the crash map is ${CRASH.W} × ${CRASH.H}`);
  checkWorld(`Crashlanding seed 7 (${(ms / 1000).toFixed(1)} s)`, s);
  check(!!(s.tiles[s.crash.homeTile].loc && s.tiles[s.crash.homeTile].loc.name), "the unit's base is named");
}

console.log("3. The same seed, the same names");
{
  const again = createWorld({ seed: 7, factionCount: WORLD_SIZES.small.defGroups, size: "small" });
  const names = again.tiles.filter((t) => t.loc).map((t) => t.loc.name);
  check(JSON.stringify(names) === JSON.stringify(seen["small:7"]), "a Small map on seed 7 names its sites the same twice");
  check(JSON.stringify(seen["small:7"]) !== JSON.stringify(seen["small:11"]), "another seed, other names");
}

if (QUICK) console.log("4. Huge map: skipped (BS_QUICK)");
else {
  console.log("4. A Huge map");
  const { s, ms } = build({ seed: 7, factionCount: WORLD_SIZES.huge.defGroups, size: "huge" });
  checkWorld(`Huge seed 7 (${(ms / 1000).toFixed(1)} s)`, s);
  check(ms < 120000, `a Huge map builds in under two minutes (${(ms / 1000).toFixed(1)} s)`);
}

console.log(`\n${passed} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
