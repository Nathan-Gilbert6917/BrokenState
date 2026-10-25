// Hotels (issue #29, src/sim/hotels.js, hotellayout.js): the data, where they stand and how often, and raids on them.
//   - the data: a site type, its building, its map cap (200 × 200), 6–10 named chains, each a kind (an inn, a business
//     hotel, a resort, a tower) and every kind some;
//   - the rates over 300 seeds (hotelExtra on every tile of three worlds, the world seed changed 300 times): a tile of
//     each setting holds a hotel at HOTELS.AT (within ±20% of it, or ±0.01), the kinds by the setting (a town's inns and
//     business hotels, a city's towers and business hotels, scenic land's resorts), and the hotels the worlds made hold;
//   - the crawl: a block holds a hotel at HOTELS.CRAWL by its level over 300 seeds; the crawl's own blocks hold some,
//     their franchise by the crawl (downtown's towers and business hotels, a town's inns);
//   - a hotel POI's building is the hotel (pois.js → poiraid.js poiPlace → buildingmaps.js), its franchise's kind;
//   - a raid on each kind plays to the end headless (setup.raid.place), its turns timed.
// Usage: node tools/hoteltest.js [seeds=300]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { LOCATIONS } from "../src/sim/data.js";
import { BUILDINGS, SITES, buildingMap } from "../src/sim/buildingmaps.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { MAP_CAP } from "../src/sim/battlesize.js";
import { HOTELS, hotelExtra, hotelSetting, hotelPlace } from "../src/sim/hotels.js";
import { HOTEL } from "../src/sim/hotellayout.js";
import { inKnownZone } from "../src/sim/pois.js";
import { poiPlace } from "../src/sim/poiraid.js";
import { crawlFranchise, franchiseById } from "../src/sim/shops.js";
import { FURNITURE_KINDS } from "../src/sim/data-furniture.js";

const SEEDS = Number(process.argv[2] || (process.env.BS_QUICK ? 300 : 300)); // the rates are checked over 300 seeds either way
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();
const kindOf = (v) => { const f = franchiseById("hotel", v); return f && f.plan ? f.plan.hotel : null; };
const pct = (x) => `${(x * 100).toFixed(1)}%`;
registerCombatHandler("htest", () => {});

console.log("The data");
{
  const L = LOCATIONS.hotel, F = FRANCHISES.hotel || [];
  check(!!L && L.richness > 0 && !!SITES.hotel && SITES.hotel[0] === "hotel" && !!BUILDINGS.hotel, "a site type (Hotel), its building and its site row");
  check(MAP_CAP.hotel === 200, "its map at most 200 × 200 (battlesize.js MAP_CAP)");
  check(F.length >= 6 && F.length <= 10 && new Set(F.map((f) => f.name)).size === F.length, `${F.length} named chains: ${F.map((f) => f.name).join(", ")}`);
  check(HOTEL.KINDS.every((k) => F.some((f) => f.plan && f.plan.hotel === k)) && F.every((f) => HOTEL.KINDS.includes(f.plan.hotel)), `every kind has its chains (${HOTEL.KINDS.map((k) => `${k} ${F.filter((f) => f.plan.hotel === k).length}`).join(", ")})`);
  const kinds = ["frontdesk", "suitcase", "minifridge", "luggagecart", "banquet", "liftdoor", "loungechair", "lounger", "tennisnet"];
  check(kinds.every((k) => FURNITURE_KINDS[k]), `the new catalogue kinds (${kinds.join(", ")})`);
}

console.log(`\nWhere they stand: the rates over ${SEEDS} seeds`);
const worlds = [1, 2, 3].map((s) => createWorld({ seed: 500 + s, factionCount: 6 }));
{
  const tiles = { city: [], suburb: [], town: [], scenic: [] };
  for (const st of worlds) for (const t of st.tiles) { if (t.terrain === "water" || t.hive || (t.loc && (t.loc.type === "city" || t.loc.type === "town"))) continue; const s = hotelSetting(st, t); if (s) tiles[s].push([st, t]); }
  const hits = { city: 0, suburb: 0, town: 0, scenic: 0 }, kinds = { city: {}, suburb: {}, town: {}, scenic: {} };
  for (const set of Object.keys(tiles)) {
    const list = tiles[set].length > 120 ? tiles[set].filter((_, i) => i % Math.ceil(tiles[set].length / 120) === 0) : tiles[set];
    for (let s = 0; s < SEEDS; s++) for (const [st, t] of list) {
      const p = hotelExtra({ ...st, seed: 90000 + s * 7 }, t, [], true);
      if (!p) continue;
      hits[set]++;
      const k = kindOf(p.v);
      kinds[set][k] = (kinds[set][k] || 0) + 1;
    }
    const n = list.length * SEEDS, rate = hits[set] / Math.max(1, n), want = HOTELS.AT[set];
    const share = Object.entries(kinds[set]).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${pct(c / Math.max(1, hits[set]))}`).join(", ");
    check(n > 0 && Math.abs(rate - want) <= Math.max(0.01, want * 0.2), `${set}: ${pct(rate)} of ${list.length} tiles × ${SEEDS} seeds hold a hotel (stated ${pct(want)}); ${share}`);
  }
  check(!kinds.town.tower && !kinds.scenic.inn && !kinds.scenic.business && !kinds.scenic.tower && !kinds.city.inn && !kinds.city.resort, "towns get inns and business hotels (a resort now and then), cities towers and business hotels, scenic land resorts");
  check((kinds.city.tower || 0) > 0 && (kinds.town.inn || 0) > 0 && (kinds.scenic.resort || 0) > 0 && (kinds.suburb.business || 0) > 0, "each kind stands where it belongs");
  // The worlds as made: the hotels among their POIs (never past POI.MAX; a site's own list unchanged before it).
  let made = 0, over = 0, wrong = 0;
  const bySet = {};
  for (const st of worlds) for (const t of st.tiles) {
    if ((t.pois || []).length > HOTELS.MAX) over++;
    for (const [i, p] of (t.pois || []).entries()) {
      if (p.kind !== "hotel") continue;
      made++;
      const set = hotelSetting(st, t);
      bySet[set] = (bySet[set] || 0) + 1;
      const place = poiPlace(t, i);
      if (!place || place.key !== "hotel" || place.variant !== p.v) wrong++;
      if (p.extra !== "hotel" || i !== t.pois.length - 1) wrong++;
    }
  }
  check(made > 0 && !over && !wrong, `the three worlds hold ${made} hotels (${Object.entries(bySet).map(([k, n]) => `${k} ${n}`).join(", ")}), each the last of its tile's POIs, its building the hotel of its chain; no tile past ${HOTELS.MAX}`);
  // A hotel POI's map: its chain's kind.
  const st = worlds[0], t = st.tiles.find((x) => (x.pois || []).some((p) => p.kind === "hotel"));
  if (t) {
    const i = t.pois.findIndex((p) => p.kind === "hotel"), place = poiPlace(t, i);
    const m = buildingMap(st, t.id, place, false);
    check(m.w <= 200 && m.h <= 200 && m.storeys >= 2 && m.rooms.some((a) => a.shop === "hotellobby"), `a hotel POI opens its chain's building (${place.name}: a ${kindOf(place.variant)}, ${m.w} × ${m.h}, ${m.storeys} storeys)`);
  }
}

console.log(`\nThe crawl: a hotel on a block over ${SEEDS} seeds`);
{
  const st = worlds[0], tile = st.tiles.find((t) => t.loc && t.loc.type === "city") || st.tiles[0];
  for (const setting of ["city", "town"]) {
    const by = [];
    for (const n of [1, 3, 6]) {
      let hit = 0, tries = 0;
      for (let s = 0; s < SEEDS; s++) for (let cell = 0; cell < 10; cell++) { tries++; if (hotelPlace({ ...st, seed: 70000 + s }, tile.id, `${cell},${n}`, [], 4, n, setting)) hit++; }
      const C = HOTELS.CRAWL, want = Math.min(C.max, (C[setting] ?? C.city) + C.deep * (n - 1));
      by.push({ n, rate: hit / tries, want });
    }
    check(by.every((x) => Math.abs(x.rate - x.want) <= Math.max(0.01, x.want * 0.2)), `${setting}: ${by.map((x) => `block ${x.n} ${pct(x.rate)} (stated ${pct(x.want)})`).join(", ")}`);
  }
  check(!hotelPlace(st, tile.id, "0,0", [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }], 4, 1, "city") && !hotelPlace({ ...st, seed: 1 }, tile.id, "0,0", [{ key: "hotel" }], 4, 1, "city"), "never on a full block, never a second hotel");
  // The crawl's franchise: downtown towers and business hotels, a town's inns and business hotels.
  const kinds = { city: {}, town: {} };
  for (let s = 0; s < SEEDS; s++) for (const [set, n] of [["city", 5], ["town", 2]]) { const k = kindOf(crawlFranchise({ ...st, seed: 60000 + s }, tile.id, "1,1", 3, "hotel", set, n)); kinds[set][k] = (kinds[set][k] || 0) + 1; }
  check(!kinds.city.inn && !kinds.city.resort && (kinds.city.tower || 0) > 0 && !kinds.town.tower && (kinds.town.inn || 0) > 0, `the crawl's hotels by its setting (downtown: ${JSON.stringify(kinds.city)}; a town: ${JSON.stringify(kinds.town)})`);
}

console.log("\nA raid on each kind, played to the end headless");
{
  for (const v of ["willowcreek", "interstate", "pinecrest", "caldergrand"]) {
    const st = createWorld({ seed: 77, factionCount: 6 });
    st.cards.length = 0;
    const h = hub(st);
    for (const k of ["food", "water", "ammo", "meds"]) h.stock[k] = Math.max(h.stock[k] || 0, 300);
    const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile) || st.tiles.find((t) => t.terrain === "suburb");
    const crew = atBase(st, h.id).filter((s) => s.alive && !s.party).slice(0, 3);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 30, meds: 2 } });
    if (res.error) { check(false, `${v}: launch (${res.error})`); continue; }
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "htest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile.id) }, raid: { heat0: 5, place: { id: `htest-${v}`, key: "hotel", name: "Hotel", variant: v } }, context: {} };
    const tb = performance.now();
    st.combat = createBattle(st, setup);
    const b = st.combat, built = performance.now() - tb;
    let turns = 0, err = null;
    const tt = performance.now();
    try { while (!b.over && turns < 60) { autoPlayerTurn(st); runEnemyPhase(st); turns++; } } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); }
    const per = (performance.now() - tt) / Math.max(1, turns);
    check(!err && b.raid && b.floors && b.floors.length >= 2, `${v} (${kindOf(v)}): ${b.w} × ${b.h}, ${b.floors ? b.floors.length : 1} floors, ${b.raid.containers.length} containers, ${b.units.filter((u) => u.side === "enemy").length} of the dead; built in ${built.toFixed(0)} ms, ${turns} turns at ${per.toFixed(0)} ms a turn${b.over ? ", over" : ""}${err ? `: ${err}` : ""}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
