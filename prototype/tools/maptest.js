// Map generation check over many seeds and every world size (sim/worldsize.js): site rules, counts per zone, roads,
// hub placement (open land, clear of the towns: startpick.js), every AI group placed (the most the size allows), hive density, and determinism per seed + size
// (a Normal map is also the same as one made without a size, as before sizes existed). Hidden sites (discovery.js):
// every type has a known rule, how many sites are off the pre-war map per size, and how many the hub sees on day 1.
// Usage: node tools/maptest.js [seeds] [firstSeed] [size=small|normal|large|huge|all]   (default: all sizes)
// Seeds: as given, else per size (SEEDS_BY_SIZE) since the presets grew (2026-10-24: Normal 250 × 150, Huge 500 × 300,
// a Huge build tens of seconds): Small 10, Normal 6, Large 4, Huge 2.
import { createWorld, hub } from "../src/sim/world.js";
import { LOCATIONS, GEAR, SITE_ZONES } from "../src/sim/data.js";
import { raidAreasFor, AREAS } from "../src/sim/combat.js";
import { WORLD_SIZES, SIZE_KEYS, areaScale } from "../src/sim/worldsize.js";
import { takeSize } from "./sizearg.js";
import { isPublicSite, hiddenSites, siteKnown, nearRoad } from "../src/sim/discovery.js";
import { isSettlementTile, startWhyNot } from "../src/sim/startpick.js";

const which = takeSize("all");
const SEEDS_BY_SIZE = { small: 10, normal: 6, large: 4, huge: 2 };
const seedsArg = Number(process.argv[2] || 0);
const first = Number(process.argv[3] || 1);
let fails = 0;
const check = (ok, msg) => {
  if (ok) return;
  fails++;
  if (fails <= 25) console.log("  FAIL:", msg);
};

// Every site type has its own raid buildings (not the terrain fallback), valid areas and valid gear.
const fallback = raidAreasFor({ terrain: "plains" });
for (const [type, def] of Object.entries(LOCATIONS)) {
  const set = raidAreasFor({ terrain: "none", loc: { type } });
  check(set !== fallback || type === "farm", `${type}: no raid area set (combat.js AREA_SETS)`);
  check(set.every((a) => AREAS[a]), `${type}: unknown raid area in ${set}`);
  check(def.gear.every((g) => GEAR[g]), `${type}: unknown gear in ${def.gear}`);
  check(SITE_ZONES[def.cat] && def.danger >= 0 && def.danger <= 3 && def.glyph && def.richness > 0, `${type}: missing cat / danger / glyph / richness`);
  check(["public", "road", "secret"].includes(def.known), `${type}: known must be public, road or secret (discovery.js)`);
  check(!def.temp || def.known === "secret", `${type}: a temporary site must be secret`);
}

const summary = [];
for (const size of which === "all" ? SIZE_KEYS : [which]) testSize(size);

function testSize(size) {
  const def = WORLD_SIZES[size];
  const seeds = seedsArg || SEEDS_BY_SIZE[size] || 4;
  const groups = def.groups[1]; // the most this size allows: every one of them must find a place
  const make = (seed) => createWorld({ seed, factionCount: groups, size });
  console.log(`\n=== ${def.label} (${def.w}×${def.h}, ${def.w * def.h} tiles), ${groups} groups ===`);
  const zoneTotals = {}, typeTotals = {};
  let total = 0, minTotal = Infinity, maxTotal = 0, genMs = 0, milCount = 0, hubMilMin = Infinity, hubCityMin = Infinity, hubHiveMin = Infinity;
  let hives = 0, towns = 0, cities = 0, minHives = Infinity, maxHives = 0, factionGap = Infinity, factionFar = 0;
  const extras = [0, 0, 0, 0];
  let hiddenTotal = 0, hiddenSeen = 0, hiddenNear = 0;
  const hiddenTypes = {};
  for (let i = 0; i < seeds; i++) {
    const seed = first + i;
    const t0 = performance.now();
    const s = make(seed);
    genMs += performance.now() - t0;
    const g = s.grid;
    check(g.width === def.w && g.height === def.h && s.tiles.length === def.w * def.h && s.worldSize === size, `${size} seed ${seed}: map is ${g.width}×${g.height}`);
    check(s.knowledge.length === s.tiles.length, `${size} seed ${seed}: knowledge has ${s.knowledge.length} entries for ${s.tiles.length} tiles`);
    const sites = s.tiles.filter((t) => t.loc);
    const zones = {};
    for (const t of sites) {
      zones[t.loc.zone] = (zones[t.loc.zone] || 0) + 1;
      zoneTotals[t.loc.zone] = (zoneTotals[t.loc.zone] || 0) + 1;
      typeTotals[t.loc.type] = (typeTotals[t.loc.type] || 0) + 1;
      check(LOCATIONS[t.loc.type] && SITE_ZONES[t.loc.zone], `${size} seed ${seed}: bad site ${JSON.stringify(t.loc)}`);
    }
    total += sites.length;
    // Hidden sites: the rule per type (public anywhere, road only within 1 tile of a road, secret never); nothing
    // hidden is known on day 1 outside the hub's view, everything hidden inside it is.
    const hidden = hiddenSites(s), hv = new Set(g.within(hub(s).tile, 3));
    for (const t of sites) {
      const k = LOCATIONS[t.loc.type].known, pub = isPublicSite(s, t.id);
      check(pub === (k === "public" || (k === "road" && nearRoad(s, t.id))), `${size} seed ${seed}: ${t.loc.name} (${t.loc.type}) classified wrong`);
      if (pub) continue;
      hiddenTypes[t.loc.type] = (hiddenTypes[t.loc.type] || 0) + 1;
      check(siteKnown(s, t.id) === hv.has(t.id), `${size} seed ${seed}: hidden ${t.loc.name} known ${siteKnown(s, t.id)} on day 1 (in the hub's view: ${hv.has(t.id)})`);
    }
    check(hidden.length === sites.filter((t) => !isPublicSite(s, t.id)).length, `${size} seed ${seed}: hiddenSites lists ${hidden.length}`);
    check(!sites.some((t) => ["town", "city", "military", "mall", "hospital", "airport"].includes(t.loc.type) && hidden.includes(t.id)), `${size} seed ${seed}: a town, city or landmark is hidden`);
    hiddenTotal += hidden.length;
    hiddenSeen += hidden.filter((id) => siteKnown(s, id)).length;
    hiddenNear += hidden.filter((id) => g.distance(id, hub(s).tile) <= 12).length;
    minTotal = Math.min(minTotal, sites.length);
    maxTotal = Math.max(maxTotal, sites.length);

    // Names are unique.
    const names = new Set(sites.map((t) => t.loc.name));
    check(names.size === sites.length, `${size} seed ${seed}: ${sites.length - names.size} duplicate site names`);
    check(!sites.some((t) => /\s\d+$/.test(t.loc.name) && (t.loc.type === "town" || t.loc.type === "city")), `${size} seed ${seed}: a town or city with a numbered name`);

    // At least one National Guard base (Huge maps: two), off the road and away from the hub and the settlements.
    const mil = sites.filter((t) => t.loc.type === "military");
    milCount += mil.length;
    check(mil.length >= def.military, `${size} seed ${seed}: ${mil.length} military bases (at least ${def.military})`);
    const h = hub(s);
    for (const m of mil) {
      check(!m.road, `${size} seed ${seed}: military base ${m.loc.name} sits on a road`);
      hubMilMin = Math.min(hubMilMin, g.distance(m.id, h.tile));
      check(g.distance(m.id, h.tile) >= 8, `${size} seed ${seed}: military base ${g.distance(m.id, h.tile)} tiles from the hub`);
    }

    // Every town and city has a police station and an auto shop of its own; towns get 0–2 extras next to them.
    const centers = sites.filter((t) => t.loc.type === "town" || t.loc.type === "city");
    const nCities = centers.filter((t) => t.loc.type === "city").length, nTowns = centers.length - nCities;
    cities += nCities;
    towns += nTowns;
    check(nCities === def.cities, `${size} seed ${seed}: ${nCities} cities (expected ${def.cities})`);
    check(nTowns >= Math.round(13 * areaScale(def)) - 2, `${size} seed ${seed}: only ${nTowns} towns`);
    for (const c of centers) {
      const own = sites.filter((t) => t.loc.settlement === c.id && t !== c);
      check(own.some((t) => t.loc.type === "police"), `${size} seed ${seed}: ${c.loc.name} has no police station`);
      check(own.some((t) => t.loc.type === "autoshop"), `${size} seed ${seed}: ${c.loc.name} has no auto shop`);
      if (c.loc.type === "city") {
        check(own.length >= 12, `${size} seed ${seed}: ${c.loc.name} has only ${own.length} sites`);
        check(own.every((t) => t.terrain === "city" || t.terrain === "suburb"), `${size} seed ${seed}: ${c.loc.name} site outside its blocks`);
      } else {
        const core = own.filter((t) => g.distance(t.id, c.id) === 1 && t.loc.zone === "town").length;
        extras[Math.min(3, core - 2)] = (extras[Math.min(3, core - 2)] || 0) + 1;
        check(core >= 2 && core <= 4, `${size} seed ${seed}: ${c.loc.name} has ${core} shops next to its center`);
      }
    }
    check(sites.filter((t) => t.loc.type === "city").every((c) => sites.filter((t) => t.loc.settlement === c.id && t.loc.type === "police").length >= 2),
      `${size} seed ${seed}: a city has fewer than 2 police stations`);

    // Roads join every town and city (bridges count); countryside sites may be off-road.
    const reach = new Set([s.cityId]);
    const queue = [s.cityId];
    while (queue.length) for (const n of s.tiles[queue.pop()].roadLinks) if (!reach.has(n)) { reach.add(n); queue.push(n); }
    for (const c of centers) check(reach.has(c.id), `${size} seed ${seed}: ${c.loc.name} is not on the road network`);
    const offRoad = sites.filter((t) => t.loc.zone === "rural" && !t.road).length;
    check(offRoad > 0, `${size} seed ${seed}: every countryside site is on a road`);

    // The hub is out in the open (the user's request 2026-10-22, docs/features/campaign.md): never in a town or a city,
    // START_CLEAR tiles or more from the towns, cities, hives, the Guard's bases and the other groups (startpick.js).
    const ht = s.tiles[h.tile];
    check(!isSettlementTile(ht) && ht.terrain !== "water" && ht.terrain !== "mountain" && !ht.hive, `${size} seed ${seed}: hub is in a town or a city, or not on open land`);
    const why = startWhyNot(s, h.tile);
    check(!why, `${size} seed ${seed}: hub breaks the start rule (${why})`);
    hubCityMin = Math.min(hubCityMin, ...s.cityIds.map((c) => g.distance(c, h.tile)));
    const hiveTiles = s.tiles.filter((t) => t.hive);
    for (const t of hiveTiles) hubHiveMin = Math.min(hubHiveMin, g.distance(t.id, h.tile));
    check(hiveTiles.every((t) => g.distance(t.id, h.tile) >= 6), `${size} seed ${seed}: a hive within 5 tiles of the hub`);
    hives += hiveTiles.length;
    minHives = Math.min(minHives, hiveTiles.length);
    maxHives = Math.max(maxHives, hiveTiles.length);
    check(s.hives.length === hiveTiles.length, `${size} seed ${seed}: hives.js has ${s.hives.length} of ${hiveTiles.length} hives`);

    // Every group placed, on its own site, spread apart.
    check(s.factions.length === groups, `${size} seed ${seed}: only ${s.factions.length} of ${groups} groups placed`);
    const fb = s.factions.map((f) => f.bases[0]);
    check(new Set(fb).size === fb.length && fb.every((b) => s.tiles[b].loc), `${size} seed ${seed}: two groups share a base, or one has no site`);
    for (let a = 0; a < fb.length; a++) {
      factionFar = Math.max(factionFar, g.distance(fb[a], h.tile));
      for (let b = a + 1; b < fb.length; b++) factionGap = Math.min(factionGap, g.distance(fb[a], fb[b]));
    }
    check(new Set(s.factions.map((f) => f.color)).size === s.factions.length, `${size} seed ${seed}: two groups share a color`);
    check(new Set(s.factions.map((f) => f.name)).size === s.factions.length, `${size} seed ${seed}: two groups share a name`);

    // Same seed and size, same map; a Normal map is the same as one made without a size.
    if (i < 5) {
      const sig = (st) => JSON.stringify([st.tiles.map((t) => [t.terrain, t.road, t.loc && t.loc.name, Math.round(t.infection * 1000), t.hive]), st.factions.map((f) => [f.name, f.bases])]);
      const mine = sig(s);
      check(sig(make(seed)) === mine, `${size} seed ${seed}: not deterministic`);
      if (size === "normal") check(sig(createWorld({ seed, factionCount: groups })) === mine, `seed ${seed}: a Normal map differs from one made without a size`);
      else check(sig(createWorld({ seed, factionCount: groups })) !== mine, `${size} seed ${seed}: the same map as Normal`);
    }
    if (i < 2) {
      const byType = {};
      for (const t of sites) byType[t.loc.type] = (byType[t.loc.type] || 0) + 1;
      console.log(`seed ${seed}: ${g.width}×${g.height}, ${sites.length} sites (${Object.entries(zones).map(([z, n]) => `${z} ${n}`).join(", ")}), ` +
        `${s.tiles.filter((t) => t.road).length} road tiles, hives ${hiveTiles.length}, hub ${h.name}`);
      console.log(`  ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    }
  }
  const avg = (n) => (n / seeds).toFixed(1);
  const tiles = def.w * def.h;
  const density = (hives / seeds / tiles) * 1000;
  // Hive density near the original 64 × 42 map's (about 1.9 per 1,000 tiles; the new presets' hot spots (worldsize.js,
  // customDef's round(A − 0.5) with 3 hives each) give about 1.6 on Normal and Large and 1.55 on Huge, 2 on Small: 2026-10-24).
  check(density >= 1.4 && density <= 2.9, `${size}: ${density.toFixed(2)} hives per 1,000 tiles`);
  console.log(`${seeds} seeds: sites avg ${avg(total)} (min ${minTotal}, max ${maxTotal}); per zone ${Object.entries(zoneTotals).map(([z, n]) => `${z} ${avg(n)}`).join(", ")}`);
  console.log(`cities ${avg(cities)}, towns ${avg(towns)}, hives avg ${avg(hives)} (${minHives}–${maxHives}, ${density.toFixed(2)} per 1,000 tiles), closest hive to a hub ${hubHiveMin}`);
  console.log(`military bases avg ${avg(milCount)}, closest to a hub ${hubMilMin}; hub to nearest city min ${hubCityMin}; groups at least ${factionGap} apart, farthest ${factionFar} from the hub; towns with 0/1/2 extra shops: ${extras.slice(0, 3).join("/")}`);
  console.log(`types (avg per map): ${Object.entries(typeTotals).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${avg(n)}`).join(", ")}`);
  const pct = Math.round((hiddenTotal / total) * 100);
  console.log(`hidden sites (off the pre-war map) avg ${avg(hiddenTotal)} of ${avg(total)} (${pct}%), ${avg(hiddenNear)} within 12 tiles of the hub, ${avg(hiddenSeen)} in the hub's view on day 1; by type: ${Object.entries(hiddenTypes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${avg(n)}`).join(", ")}`);
  console.log(`createWorld avg ${(genMs / seeds).toFixed(0)} ms`);
  summary.push(`${def.label.padEnd(6)} ${String(def.w).padStart(3)}×${String(def.h).padEnd(3)} ${String(tiles).padStart(5)} tiles · ${avg(total)} sites (${avg(hiddenTotal)} hidden, ${pct}%) · ${avg(cities)} cities · ${avg(towns)} towns · ${avg(hives)} hives · ${groups} groups · ${(genMs / seeds).toFixed(0)} ms`);
}
console.log(`\nSizes:\n  ${summary.join("\n  ")}`);
console.log(fails ? `${fails} FAILED checks` : "All checks passed.");
if (fails) process.exit(1);
