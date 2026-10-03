// Map generation check over many seeds: site rules, counts per zone, roads, hub placement and determinism.
// Usage: node tools/maptest.js [seeds] [firstSeed]
import { createWorld, hub } from "../src/sim/world.js";
import { LOCATIONS, GEAR, SITE_ZONES } from "../src/sim/data.js";
import { raidAreasFor, AREAS } from "../src/sim/combat.js";

const seeds = Number(process.argv[2] || 30);
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
}

const zoneTotals = {}, typeTotals = {};
let total = 0, minTotal = Infinity, maxTotal = 0, genMs = 0, milCount = 0, hubMilMin = Infinity, hubCityMin = Infinity;
const extras = [0, 0, 0, 0];
for (let i = 0; i < seeds; i++) {
  const seed = first + i;
  const t0 = performance.now();
  const s = createWorld({ seed, factionCount: 8 });
  genMs += performance.now() - t0;
  const g = s.grid;
  const sites = s.tiles.filter((t) => t.loc);
  const zones = {};
  for (const t of sites) {
    zones[t.loc.zone] = (zones[t.loc.zone] || 0) + 1;
    zoneTotals[t.loc.zone] = (zoneTotals[t.loc.zone] || 0) + 1;
    typeTotals[t.loc.type] = (typeTotals[t.loc.type] || 0) + 1;
    check(LOCATIONS[t.loc.type] && SITE_ZONES[t.loc.zone], `seed ${seed}: bad site ${JSON.stringify(t.loc)}`);
  }
  total += sites.length;
  minTotal = Math.min(minTotal, sites.length);
  maxTotal = Math.max(maxTotal, sites.length);

  // Names are unique.
  const names = new Set(sites.map((t) => t.loc.name));
  check(names.size === sites.length, `seed ${seed}: ${sites.length - names.size} duplicate site names`);

  // At least one National Guard base, off the road and away from the hub and the settlements.
  const mil = sites.filter((t) => t.loc.type === "military");
  milCount += mil.length;
  check(mil.length >= 1, `seed ${seed}: no military base`);
  const h = hub(s);
  for (const m of mil) {
    check(!m.road, `seed ${seed}: military base ${m.loc.name} sits on a road`);
    hubMilMin = Math.min(hubMilMin, g.distance(m.id, h.tile));
    check(g.distance(m.id, h.tile) >= 8, `seed ${seed}: military base ${g.distance(m.id, h.tile)} tiles from the hub`);
  }

  // Every town and city has a police station and an auto shop of its own; towns get 0–2 extras next to them.
  const centers = sites.filter((t) => t.loc.type === "town" || t.loc.type === "city");
  check(centers.filter((t) => t.loc.type === "city").length >= 1, `seed ${seed}: no city`);
  for (const c of centers) {
    const own = sites.filter((t) => t.loc.settlement === c.id && t !== c);
    check(own.some((t) => t.loc.type === "police"), `seed ${seed}: ${c.loc.name} has no police station`);
    check(own.some((t) => t.loc.type === "autoshop"), `seed ${seed}: ${c.loc.name} has no auto shop`);
    if (c.loc.type === "city") {
      check(own.length >= 12, `seed ${seed}: ${c.loc.name} has only ${own.length} sites`);
      check(own.every((t) => t.terrain === "city" || t.terrain === "suburb"), `seed ${seed}: ${c.loc.name} site outside its blocks`);
    } else {
      const core = own.filter((t) => g.distance(t.id, c.id) === 1 && t.loc.zone === "town").length;
      extras[Math.min(3, core - 2)] = (extras[Math.min(3, core - 2)] || 0) + 1;
      check(core >= 2 && core <= 4, `seed ${seed}: ${c.loc.name} has ${core} shops next to its center`);
    }
  }
  check(sites.filter((t) => t.loc.type === "city").every((c) => sites.filter((t) => t.loc.settlement === c.id && t.loc.type === "police").length >= 2),
    `seed ${seed}: a city has fewer than 2 police stations`);

  // Roads join every town and city (bridges count); countryside sites may be off-road.
  const reach = new Set([s.cityId]);
  const queue = [s.cityId];
  while (queue.length) for (const n of s.tiles[queue.pop()].roadLinks) if (!reach.has(n)) { reach.add(n); queue.push(n); }
  for (const c of centers) check(reach.has(c.id), `seed ${seed}: ${c.loc.name} is not on the road network`);
  const offRoad = sites.filter((t) => t.loc.zone === "rural" && !t.road).length;
  check(offRoad > 0, `seed ${seed}: every countryside site is on a road`);

  // The hub is a small town, not inside a city.
  const ht = s.tiles[h.tile];
  check(ht.loc && ht.loc.type === "town" && ht.terrain !== "city" && ht.terrain !== "suburb", `seed ${seed}: hub is not a small town`);
  hubCityMin = Math.min(hubCityMin, ...s.cityIds.map((c) => g.distance(c, h.tile)));
  check(s.factions.length === 8, `seed ${seed}: only ${s.factions.length} of 8 groups placed`);

  // Same seed, same map.
  if (i < 5) {
    const sig = (st) => JSON.stringify(st.tiles.map((t) => [t.terrain, t.road, t.loc && t.loc.name, Math.round(t.infection * 1000), t.hive]));
    check(sig(createWorld({ seed, factionCount: 8 })) === sig(s), `seed ${seed}: not deterministic`);
  }
  if (i < 3) {
    const byType = {};
    for (const t of sites) byType[t.loc.type] = (byType[t.loc.type] || 0) + 1;
    console.log(`seed ${seed}: ${g.width}×${g.height}, ${sites.length} sites (${Object.entries(zones).map(([z, n]) => `${z} ${n}`).join(", ")}), ` +
      `${s.tiles.filter((t) => t.road).length} road tiles, hives ${s.tiles.filter((t) => t.hive).length}, hub ${ht.loc.name}`);
    console.log(`  ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }
}
const avg = (n) => (n / seeds).toFixed(1);
console.log(`\n${seeds} seeds: sites avg ${avg(total)} (min ${minTotal}, max ${maxTotal}); per zone ${Object.entries(zoneTotals).map(([z, n]) => `${z} ${avg(n)}`).join(", ")}`);
console.log(`military bases avg ${avg(milCount)}, closest to a hub ${hubMilMin}; hub to nearest city min ${hubCityMin}; towns with 0/1/2 extra shops: ${extras.slice(0, 3).join("/")}`);
console.log(`types (avg per map): ${Object.entries(typeTotals).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${avg(n)}`).join(", ")}`);
console.log(`createWorld avg ${(genMs / seeds).toFixed(0)} ms. ${fails ? `${fails} FAILED checks` : "All checks passed."}`);
if (fails) process.exit(1);
