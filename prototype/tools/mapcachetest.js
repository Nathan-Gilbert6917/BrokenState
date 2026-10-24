// The map kept between new-run settings (the user's request 2026-10-24: "When changing a setting in the start menu it
// loads the map each time. After generating the map cache it and only update the whole map on new seeds and generating
// new maps"; sim/mapgen.js MAP_CACHE, sim/world.js worldMapCached, main.js gen):
//   1. a world built from the kept land is the very world an uncached build makes (its tiles, groups, crew, bases and
//      dice), for a change of groups, hives, mode, people and vehicle, in Normal, Hardcore, Custom and Crashlanding;
//   2. worldMapCached says so: true for the same seed and size, false for a new seed, a new size or new Custom map
//      counts (cities, towns, military sites), true again for Custom's other counts (groups, hives, people);
//   3. a world built from the cache never changes the kept land: playing it, or its tiles edited, leaves the next
//      build as it was;
//   4. a change that keeps the map is faster than building it (the land is most of a build's time).
// Usage: node tools/mapcachetest.js
import { createWorld, worldMapCached, tickHour } from "../src/sim/world.js";
import { clearMapCache } from "../src/sim/mapgen.js";

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log("FAIL", msg); } };
// Ids count on across worlds (newId): a tile's owner is taken from the world's own first id.
const sig = (st) => JSON.stringify({
  tiles: st.tiles.map((t) => ({ ...t, owner: t.owner == null ? null : t.owner - st.idBase })), rng: st.rng.state, city: st.cityId, origin: st.originId, mil: st.militaryIds,
  survivors: st.survivors.map((s) => [s.name, s.skills, s.traits, s.gear]), factions: st.factions.map((f) => [f.name, f.home, f.members?.length]),
  bases: st.bases.map((b) => [b.name, b.tileId]), vehicles: st.vehicles.length,
});
// The world built twice: once from nothing (the cache cleared), once from the cache warmed by `warm`.
function same(opts, warm, label) {
  clearMapCache();
  const cold = sig(createWorld(opts));
  clearMapCache();
  createWorld(warm);
  check(worldMapCached(opts), `${label}: the map is kept`);
  const hot = sig(createWorld(opts));
  check(cold === hot, `${label}: the world from the kept map is the uncached one`);
}

// 1. Every setting that keeps the map.
const S = 41;
const base = { seed: S, size: "small", factionCount: null };
same({ ...base, factionCount: 3 }, base, "groups");
same({ ...base, hives: 2 }, base, "fewer hives");
same({ ...base, hives: 12 }, { ...base, hives: 2 }, "more hives");
same({ ...base, mode: "hardcore" }, base, "Hardcore");
same({ ...base, mode: "hardcore", startPeople: 2, vehicle: false }, { ...base, mode: "hardcore" }, "Hardcore people and vehicle");
same({ ...base, startPeople: 3, vehicle: false }, base, "people and vehicle");
const cust = { people: 3, groups: 4, hives: 6, cities: 2, towns: 10, military: 2 };
same({ ...base, custom: { ...cust, groups: 9, hives: 2, people: 5 } }, { ...base, custom: cust }, "Custom's groups, hives and people");
same({ seed: S, crash: true, factionCount: null }, { seed: S, crash: true, factionCount: null }, "Crashlanding");

// 2. What the cache says.
clearMapCache();
createWorld(base);
check(worldMapCached({ ...base, factionCount: 6, hives: 9, mode: "hardcore" }), "groups, hives and mode keep the map");
check(!worldMapCached({ ...base, seed: S + 1 }), "a new seed is a new map");
check(!worldMapCached({ ...base, size: "normal" }), "a new size is a new map");
check(!worldMapCached({ ...base, custom: cust }), "Custom's map counts are a new map");
createWorld({ ...base, custom: cust });
check(worldMapCached({ ...base, custom: { ...cust, groups: 2, hives: 1, people: 1 } }), "Custom's other counts keep its map");
check(!worldMapCached({ ...base, custom: { ...cust, towns: 11 } }), "Custom's towns are a new map");
check(worldMapCached(base), "the earlier map is still kept");

// 3. The kept land is never touched by a world built on it.
clearMapCache();
const first = sig(createWorld(base));
const w = createWorld(base);
for (const t of w.tiles) { t.terrain = "water"; t.hive = !t.hive; if (t.loc) t.loc.name = "X"; }
const w2 = createWorld(base);
for (let h = 0; h < 48; h++) tickHour(w2);
check(sig(createWorld(base)) === first, "the kept map is as it was built");

// 4. Faster.
clearMapCache();
const n = { seed: 9, size: "normal", factionCount: null };
let t = performance.now();
createWorld(n);
const cold = performance.now() - t;
t = performance.now();
createWorld({ ...n, factionCount: 4 });
const hot = performance.now() - t;
console.log(`Normal map: built ${cold.toFixed(0)} ms, from the kept land ${hot.toFixed(0)} ms`);
check(hot < cold * 0.75, "a kept map builds faster");

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log("mapcachetest: all passed");
