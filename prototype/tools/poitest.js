// Points of interest (src/sim/pois.js): the places a tile holds besides its site, the town suburb rings
// (mapgen.js), the new LOCATIONS kinds and their tables, the pools, what the player knows, and saves.
// Usage: node tools/poitest.js [seed] [--nocorpus]   (--nocorpus: skip the save corpus run, savecorpustest.js)
// - the same seed makes the same lists (and the same after a save and a load; a save from before POIs existed gets
//   them from its seed), another seed differs
// - every eligible tile's count is within the terrain's table (bare and with a site), never over 4; water, city and
//   town centres and hive tiles hold none; kinds come from the terrain's pool and every kind is a LOCATIONS type
//   with theme tags, a raid area set, a building (or the street map) and a size
// - the top POI is index 0: the site on a site tile (tile.loc untouched: no bare tile gains a loc), else the richest
// - hidden: in the known zone the top POI is known and at most 2 others hidden; in the unknown zone every POI of a
//   bare tile is hidden; a site keeps its discovery class; the hub never sees a count
// - pools: a site POI's pool is tile.loot (poiTake lowers it), an extra's its own, from its kind's richness; stripped
// - the town rings: radius 1–2 of suburb round every town centre, some towns 1 and some 2, land only, the centre and
//   countryside sites untouched, the town's shops on them; infection and loot follow the suburbs' rules
// - knowledge: a team's survey finds go in its report and reach the hub with it, a snapshot carries what is known,
//   the dev reveal shows everything, a save keeps the hub's record; a hive rising or falling clears the tile
// - the save corpus (tools/savecorpustest.js, 2 days) still loads
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWorld, hub, snapshot, mergeKnowledge, updateVision, tickHour } from "../src/sim/world.js";
import { LOCATIONS, SITE_ZONES, GEAR } from "../src/sim/data.js";
import { SITE_TAGS } from "../src/sim/loot.js";
import { AREA_SETS, AREAS } from "../src/sim/combat.js";
import { SITES, BUILDINGS, siteBuildings } from "../src/sim/buildingmaps.js";
import { SIZES } from "../src/sim/battlesize.js";
import { isPublicSite, siteKnown } from "../src/sim/discovery.js";
import { serializeState, deserializeState, saveToString, loadFromString } from "../src/sim/save.js";
import { launchExpedition, partyTile } from "../src/sim/parties.js";
import { destroyHive, newHive, ensureHives } from "../src/sim/hives.js";
import { WORLD_SIZES, SIZE_KEYS } from "../src/sim/worldsize.js";
import {
  POI, POI_KINDS, COUNTS, poiKinds, allPoiKinds, ensurePois, generatePois, poisOf, topPoi, poiAt, isSitePoi, poiName, inKnownZone, poiEligible,
  poiPool, poiTake, poiLedger, poiThreat, tileHeat, addTileHeat, poiKnown, poiKnownTo, knownPois, morePoisHidden, revealPois, learnPois,
  mergePoiFinds, poiSnapshot, poiKnowledge, setPoiReveal, packPois, clearPois, permanentSite,
  BUNKER_POI, MALL_POI,
} from "../src/sim/pois.js";
import { SHOP, SHOP_KINDS, settingOf } from "../src/sim/shops.js";
import { hotelSetting } from "../src/sim/hotels.js";

const args = process.argv.slice(2);
const corpus = !args.includes("--nocorpus");
const seed = Number(args.find((a) => /^\d+$/.test(a)) || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed, size = "normal") => { const st = createWorld({ seed: s, factionCount: 8, size }); st.started = true; st.cards.length = 0; return st; };
const sig = (st) => JSON.stringify(st.tiles.map((t) => t.pois));
const rich = (k) => LOCATIONS[k].richness;
// A tile's list without the extras on their own dice after it (poi.extra: a campsite, campsite.js; a gun store or a
// pawn shop, a hardware store or another shop or service, shops.js): the counts, the pools, the top and the hidden rules are the list's; section 4b checks them.
const base = (t) => t.pois.filter((p) => !p.extra);

// ---------- 1. determinism ----------
section("Determinism: the seed makes the lists");
{
  const a = W(), b = W(), c = W(seed + 1);
  check(sig(a) === sig(b), "the same seed makes the same lists");
  check(sig(a) !== sig(c), "another seed makes other lists");
  // Generated again on the same world: the same (no state.rng, no module state).
  check(a.tiles.every((t) => JSON.stringify(generatePois(a, t)) === JSON.stringify(t.pois)), "a list generated again is the same");
  check(a.rng.state === b.rng.state, "the map's own dice are untouched");
  const n = a.tiles.reduce((s, t) => s + t.pois.length, 0), tiles = a.tiles.filter((t) => t.pois.length).length;
  console.log(`  seed ${seed}: ${n} POIs on ${tiles} of ${a.tiles.length} tiles (${Object.entries(a.tiles.reduce((m, t) => { for (const p of t.pois) m[p.kind] = (m[p.kind] || 0) + 1; return m; }, {})).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", ")})`);
}

// ---------- 2. the kinds and their tables ----------
section("Kinds: every POI kind is a site type with its tables");
{
  const kinds = allPoiKinds();
  for (const k of kinds) {
    const def = LOCATIONS[k];
    check(!!def && def.richness > 0 && def.danger >= 0 && def.danger <= 3 && SITE_ZONES[def.cat] && ["public", "road", "secret"].includes(def.known), `${k} is a LOCATIONS type with richness, danger, a zone and a known rule`);
    check(def && def.gear.every((g) => GEAR[g]), `${k}: every gear key exists`);
    check(!!SITE_TAGS[k], `${k} has theme tags (loot.js SITE_TAGS)`);
    check(Array.isArray(AREA_SETS[k]) && AREA_SETS[k].every((a) => AREAS[a]), `${k} has a raid area set (combat.js AREA_SETS)`);
    const sb = siteBuildings({ loc: { type: k }, terrain: "plains" });
    check(!SITES[k] || (sb && sb.options.every((o) => BUILDINGS[o.key])), `${k}: its buildings (buildingmaps.js SITES) or the street map`);
    check(SIZES.SITE[k] != null, `${k} has a raid map size (battlesize.js)`);
    check(!def.temp, `${k} is not a temporary site`);
  }
  check(["house", "neighbourhood", "garage", "corner", "pizza", "farmstand", "shed", "blind", "campsite", "hikercamp", "mineshack"].every((k) => kinds.includes(k) && LOCATIONS[k]), "the new kinds are all in a pool");
  check(["house", "shed"].every((k) => rich(k) < rich("school") && rich(k) < rich("gas") && rich(k) < rich("farm")), "a lone house or shed ranks below a school, a gas station or a farm");
  for (const [terrain, pool] of Object.entries(POI_KINDS)) check(COUNTS[terrain] && pool.every((k) => LOCATIONS[k]), `${terrain}: a count row and known kinds (${pool.join(", ")})`);
  check(poiKinds("water").length === 0 && !COUNTS.water, "water has no pool");
  const sb = siteBuildings({ loc: { type: "pizza" }, terrain: "suburb" });
  check(sb && sb.options[0].key === "diner" && sb.options[0].name === "Pizza place", "the pizza place is the diner archetype under its own name");
  check(["campsite", "hikercamp", "blind"].every((k) => !SITES[k] && AREA_SETS[k].includes("campsite")), "a campsite, a hiker camp and a hunting blind are the open map");
  // The generic sprite fallback (ui/mapsprites.js): a kind without a painter does not throw, headless or with a stub.
  const M = await import("../src/ui/mapsprites.js");
  let threw = null;
  try { for (const k of kinds) M.poiSpriteCanvas(k); M.poiSpriteCanvas("nosuchkind"); } catch (e) { threw = e; }
  check(!threw, `poiSpriteCanvas falls back for a kind without a painter (${threw && threw.message})`);
}

// ---------- 3. where and how many ----------
section("Where and how many: by terrain, never on water, centres or hives");
for (const size of SIZE_KEYS) {
  const st = W(seed, size);
  let bad = 0, over = 0, badKind = 0, onBad = 0, locWritten = 0;
  const byT = {};
  const perT = {};
  for (const t of st.tiles) {
    const list = base(t);
    const centre = t.loc && (t.loc.type === "city" || t.loc.type === "town");
    if (t.terrain === "water" || centre || t.hive) { if (list.length) onBad++; continue; }
    if (!COUNTS[t.terrain]) { if (list.length) onBad++; continue; }
    const site = permanentSite(t);
    const [bMin, bMax, eMin, eMax] = COUNTS[t.terrain];
    const extras = list.length - (site ? 1 : 0);
    const [lo, hi] = site ? [eMin, eMax] : [bMin, bMax];
    if (extras < lo || extras > hi) bad++;
    if (t.pois.length > POI.MAX) over++;
    for (const [i, p] of list.entries()) {
      if (i === 0 && site) { if (!p.site || p.kind !== t.loc.type) badKind++; continue; }
      if (!POI_KINDS[t.terrain].includes(p.kind) || p.site) badKind++;
    }
    if (!site && t.loc && permanentSite(t)) locWritten++;
    const key = `${t.terrain}${site ? "+site" : ""}`;
    byT[key] = (byT[key] || 0) + extras;
    perT[key] = (perT[key] || 0) + 1;
    if (!site && list.length && t.loc) locWritten++; // a bare tile's list must not have come with a loc
  }
  check(!bad, `${size}: every count is within its terrain's table (${bad} off)`);
  check(!over, `${size}: never more than ${POI.MAX} (${over} over)`);
  check(!badKind, `${size}: kinds from the terrain's pool, the site first on a site tile (${badKind} wrong)`);
  check(!onBad, `${size}: nothing on water, city or town centres or hive tiles (${onBad})`);
  check(!locWritten, `${size}: no bare tile gained a tile.loc (${locWritten})`);
  // The site count is the map's (POIs never add a tile.loc): the same as a map without POIs would place.
  const locs = st.tiles.filter((t) => t.loc).length;
  check(locs === st.tiles.filter((t) => t.loc && t.pois.every((p, i) => i > 0 || p.site || !permanentSite(t))).length, `${size}: every site tile's POI 0 is the site (${locs} sites)`);
  console.log(`  ${size}: extras per tile ${Object.entries(byT).map(([k, n]) => `${k} ${(n / perT[k]).toFixed(2)}`).join(", ")}`);
}

// ---------- 4. the top POI and the pools ----------
section("The top POI and the pools");
{
  const st = W();
  let notTop = 0, siteBelow = 0;
  for (const t of st.tiles) {
    const list = base(t);
    if (!list.length) continue;
    const top = topPoi(t);
    check(top === list[0], "topPoi is index 0");
    if (list.some((p) => rich(p.kind) > rich(top.kind))) notTop++;
    if (permanentSite(t) && list.slice(1).some((p) => rich(p.kind) > rich(t.loc.type))) siteBelow++;
  }
  check(!notTop, `the top POI is the richest on every tile (${notTop} not)`);
  check(!siteBelow, `no extra out-ranks the site it stands by (${siteBelow})`);
  // Ties: two kinds of one richness on a tile keep a fixed order (by the hash of the tile and the kind).
  const tie = st.tiles.find((t) => !t.loc && t.pois.length > 1 && rich(t.pois[0].kind) === rich(t.pois[1].kind) && t.pois[0].kind !== t.pois[1].kind);
  if (tie) check(JSON.stringify(generatePois(st, tie)) === JSON.stringify(tie.pois), `a tie keeps its order (${tie.pois[0].kind} over ${tie.pois[1].kind} on tile ${tie.id})`);
  // A site POI's pool is tile.loot; an extra's its own.
  const s = st.tiles.find((t) => permanentSite(t) && t.pois.length >= 2);
  check(!!s, "a site tile with an extra");
  if (s) {
    check(isSitePoi(s, 0) && !isSitePoi(s, 1), "POI 0 is the site, POI 1 is not");
    check(poiPool(s, 0) === s.loot && s.pois[0].pool === null, `the site POI's pool is tile.loot (${s.loot.toFixed(2)})`);
    const p1 = poiPool(s, 1), def = LOCATIONS[s.pois[1].kind];
    check(p1 > 0 && p1 >= def.richness * POI.POOL[0] - 1e-9 && p1 <= Math.min(1, def.richness * POI.POOL[1] * POI.URBAN_RICH) + 1e-9, `an extra's pool comes from its kind's richness (${s.pois[1].kind} ${p1.toFixed(2)} of ${def.richness})`);
    const loot0 = s.loot;
    const took = poiTake(s, 0, 0.1);
    check(Math.abs(took - Math.min(0.1, loot0)) < 1e-9 && Math.abs(s.loot - (loot0 - took)) < 1e-9 && poiPool(s, 0) === s.loot, "poiTake on the site POI lowers tile.loot");
    const e0 = poiPool(s, 1);
    poiTake(s, 1, 0.05);
    check(Math.abs(poiPool(s, 1) - (e0 - 0.05)) < 1e-9 && s.loot === loot0 - took, "poiTake on an extra lowers its own pool, not tile.loot");
    poiTake(s, 1, 5);
    check(poiPool(s, 1) === 0 && s.pois[1].stripped, "a pool never goes below 0 and the POI is stripped");
    check(poiName(s, 0) === s.loc.name && poiName(s, 1) === def.name, "the site POI carries the site's name, an extra its kind's");
    const led = poiLedger(s, 1);
    check(led && led.n === 0 && led === s.pois[1].cont && poiLedger(s, 1) === led, "the container ledger is made once, empty");
    const th0 = poiThreat(st, s, 1);
    check(th0 === (def.danger || 0) + s.infection && tileHeat(st, s) === 0 && addTileHeat(st, s, 10) === 10 && Math.abs(poiThreat(st, s, 1) - th0 - 0.15) < 1e-9, "threat = danger + infection + heat (a cold tile 0; heat 10 → +0.15: tools/poiheattest.js)");
  }
  check(poiAt(st.tiles[0], 99) === null && poiPool(st.tiles[0], 99) === 0 && poiTake(st.tiles[0], 99, 1) === 0, "a missing index is harmless");
}

// ---------- 4b. the extras on their own dice ----------
section("Extras on their own dice: a campsite, a gun store, a pawn shop or a hardware store after the list");
{
  let shops = 0, wrong = 0, twice = 0, outranks = 0, badPool = 0, shownOut = 0, notLast = 0, camps = 0, campWrong = 0, bunkers = 0, bunkerWrong = 0, hotels = 0, hotelWrong = 0, malls = 0, mallWrong = 0;
  const byKind = {};
  for (const size of SIZE_KEYS) {
    const st = W(seed, size);
    for (const t of st.tiles) {
      const ex = t.pois.filter((p) => p.extra);
      if (!ex.length) continue;
      if (t.pois.findIndex((p) => p.extra) !== t.pois.length - ex.length) notLast++; // the extras come after the list
      for (const p of ex) {
        if (p.extra === "campsite") { camps++; if (p.kind !== "campsite" || t.terrain === "suburb" || t.terrain === "city") campWrong++; continue; }
        if (p.extra === "mall") { malls++; if (!MALL_POI[p.kind] || t.terrain === "city" || (p.kind === "outlet" && !t.road) || (permanentSite(t) && rich(p.kind) > rich(t.loc.type)) || t.pois.filter((q) => q.kind === p.kind).length > 1) mallWrong++; continue; } // pois.js mallExtra (issue #30)
        if (p.extra === "bunker") { bunkers++; if (!BUNKER_POI[p.kind] || !BUNKER_POI[p.kind][t.terrain] || (permanentSite(t) && rich(p.kind) > rich(t.loc.type))) bunkerWrong++; continue; } // pois.js bunkerExtra (issue #26)
        if (p.extra === "hotel") { hotels++; if (p.kind !== "hotel" || !hotelSetting(st, t) || (t.loc && t.loc.type === "hotel") || t.pois.filter((q) => q.kind === "hotel").length > 1) hotelWrong++; continue; } // hotels.js hotelExtra (issue #29)
        shops++;
        byKind[p.kind] = (byKind[p.kind] || 0) + 1;
        if (p.extra !== "shop" || !SHOP_KINDS.includes(p.kind) || !settingOf(st, t) || (t.loc && t.loc.type === p.kind)) wrong++;
        if (t.pois.filter((q) => q.kind === p.kind).length > 1) twice++;
        if (permanentSite(t) && rich(p.kind) > rich(t.loc.type)) outranks++;
        const r = rich(p.kind) * (t.terrain === "city" ? SHOP.URBAN_RICH : 1);
        if (!(p.pool >= r * SHOP.POOL[0] - 1e-9 && p.pool <= Math.min(1, r * SHOP.POOL[1]) + 1e-9)) badPool++;
        if (!inKnownZone(st, t) && !p.hidden) shownOut++;
      }
    }
  }
  check(shops > 0 && Object.keys(byKind).length >= 20, `the shops and services stand on the suburbs and city blocks (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ")})`);
  check(!wrong, `a shop extra is a shop or a service on a suburb or city block, never the tile's own site's kind (${wrong})`);
  check(malls > 0 && !mallWrong, `strip malls and outlet centres (${malls}) on their own ground (suburbs and towns, an outlet on a road), never a city block, one a tile, never above the site (${mallWrong})`);
  check(!twice, `never two of a kind on a tile (${twice})`);
  check(!outranks, `a shop never out-ranks the site it stands by (${outranks})`);
  check(!badPool, `a shop's pool comes from its kind's richness (${badPool} off)`);
  check(!shownOut, `in the unknown zone a shop is hidden (${shownOut} shown)`);
  check(!notLast, `the extras come after the tile's own list (${notLast})`);
  check(!campWrong, `a campsite extra is a campsite off the suburbs and city blocks (${campWrong} of ${camps})`);
  check(bunkers > 0 && !bunkerWrong, `a bunker extra is a bunker kind on a terrain that holds it, never out-ranking the site (${bunkerWrong} of ${bunkers})`); // pois.js bunkerExtra (issue #26)
  check(hotels > 0 && !hotelWrong, `a hotel extra is one hotel on a tile that holds one (a suburb or city block, a town, scenic land by a road), never the tile's own site (${hotelWrong} of ${hotels})`); // hotels.js hotelExtra (issue #29)
  for (const k of SHOP_KINDS) check(!!SITES[k] && !!BUILDINGS[k] && Array.isArray(AREA_SETS[k]) && !!SITE_TAGS[k] && SIZES.SITE[k] != null, `${k}: a building, a raid area set, theme tags and a map size`);
  check(AREAS.pawnshop && AREA_SETS.pawnshop.includes("pawnshop") && AREA_SETS.pawnshop.includes("gunshop"), "a pawn shop's raid map has its counter and a gun case");
  check((LOCATIONS.pawnshop.gearRate || 1) > 1 && (LOCATIONS.gunstore.gearRate || 1) > 1, "the shops' shelves turn up gear more often (gearRate)");
}

// ---------- 5. hidden by zone ----------
section("Hidden by the zone");
{
  const st = W();
  let knownTopHidden = 0, tooMany = 0, unknownShown = 0, siteClass = 0, inZone = 0, outZone = 0;
  for (const t of st.tiles) {
    const list = base(t);
    if (!list.length) continue;
    const site = permanentSite(t), zone = inKnownZone(st, t);
    if (zone) inZone++; else outZone++;
    const rest = list.slice(1);
    if (site && list[0].hidden !== !isPublicSite(st, t.id)) siteClass++;
    if (zone) {
      if (!site && list[0].hidden) knownTopHidden++;
      if (rest.filter((p) => p.hidden).length > POI.HIDDEN_MAX) tooMany++;
    } else if (rest.some((p) => !p.hidden) || (!site && !list[0].hidden)) unknownShown++;
  }
  check(!knownTopHidden, `known zone: a bare tile's top POI is never hidden (${knownTopHidden})`);
  check(!tooMany, `known zone: at most ${POI.HIDDEN_MAX} hidden (${tooMany} over)`);
  check(!unknownShown, `unknown zone: every POI of a bare tile and every extra hidden (${unknownShown} shown)`);
  check(!siteClass, `a site keeps its discovery class (${siteClass} wrong)`);
  check(inZone > 0 && outZone > 0, `tiles in both zones (${inZone} known, ${outZone} unknown)`);
  // The known zone: roads, next to roads, city and town footprints; nothing else.
  const g = st.grid;
  let zoneWrong = 0;
  for (const t of st.tiles) {
    const road = t.road || g.neighbors(t.id).some((n) => st.tiles[n].road);
    const city = st.cityIds.some((c, i) => g.distance(c, t.id) <= POI.CITY_R[i ? 1 : 0]);
    const town = g.within(t.id, POI.TOWN_R).some((id) => st.tiles[id].loc && st.tiles[id].loc.type === "town");
    const urban = t.terrain === "city" || t.terrain === "suburb";
    if (inKnownZone(st, t) !== (road || city || town || urban)) zoneWrong++;
  }
  check(!zoneWrong, `the known zone is roads, their neighbours and the city and town footprints (${zoneWrong} wrong)`);
}

// ---------- 6. the town rings ----------
section("The town suburb rings");
{
  const radii = { 1: 0, 2: 0 };
  let bad = 0, centres = 0, holes = 0, farRing = 0, rural = 0;
  for (const s of [seed, seed + 1, seed + 2]) {
    const st = W(s);
    const g = st.grid;
    const towns = st.tiles.filter((t) => t.loc && t.loc.type === "town");
    for (const town of towns) {
      if (town.terrain === "suburb" || town.terrain === "city") centres++;
      const ok = (t) => !t.river && t.terrain !== "water" && t.terrain !== "mountain" && !(t.loc && t.loc.zone === "rural");
      const ring1 = g.within(town.id, 1).filter((id) => id !== town.id).map((id) => st.tiles[id]).filter(ok);
      const ring2 = g.within(town.id, 2).filter((id) => g.distance(town.id, id) === 2).map((id) => st.tiles[id]).filter(ok);
      if (ring1.some((t) => t.terrain !== "suburb")) holes++;
      const r2 = ring2.length ? ring2.filter((t) => t.terrain === "suburb").length / ring2.length : 1;
      // Radius 2: the whole second ring; radius 1: only what another ring or a city footprint reaches.
      const near = (t) => towns.some((o) => o !== town && g.distance(o.id, t.id) <= 2) || st.cityIds.some((c) => g.distance(c, t.id) <= 4);
      if (r2 === 1) radii[2]++;
      else if (ring2.every((t) => t.terrain !== "suburb" || near(t))) radii[1]++;
      else bad++;
      for (const t of ring2) if (t.loc && t.loc.zone === "rural" && t.terrain === "suburb") rural++;
      for (const id of g.within(town.id, 3)) { const t = st.tiles[id]; if (g.distance(town.id, id) === 3 && t.terrain === "suburb" && !near(t) && !towns.some((o) => o !== town && g.distance(o.id, id) <= 2)) farRing++; }
    }
  }
  check(!centres, `the town centre keeps its own ground (${centres} turned)`);
  check(!holes, `radius 1: every land tile round a town is suburb (${holes} towns with a hole)`);
  check(!bad && radii[1] > 0 && radii[2] > 0, `radius 1 or 2 per town, both kinds (${radii[1]} at 1, ${radii[2]} at 2, ${bad} neither)`);
  check(!rural, `a countryside site by a town keeps its ground (${rural})`);
  check(!farRing, `no ring reaches 3 tiles out (${farRing})`);
  const st = W();
  const town = st.tiles.find((t) => t.loc && t.loc.type === "town");
  const shops = st.tiles.filter((t) => t.loc && t.loc.settlement === town.id && t !== town && t.loc.zone === "town");
  check(shops.length >= 2 && shops.every((t) => t.terrain === "suburb"), `${town.loc.name}'s shops stand in its suburbs (${shops.map((t) => t.loc.type).join(", ")})`);
  check(st.grid.within(town.id, 1).map((id) => st.tiles[id]).filter((t) => t.terrain === "suburb" && !t.loc).every((t) => t.loot >= 0.3 - 1e-9), "a bare ring tile has the suburbs' minor loot");
  // The same map as before the rings under them: every site, road and hive where it was (the ring is laid last).
  const same = (a, b) => a.tiles.every((t, i) => (t.loc && t.loc.name) === (b.tiles[i].loc && b.tiles[i].loc.name) && t.road === b.tiles[i].road && t.hive === b.tiles[i].hive);
  check(same(st, W()), "the map is the same twice");
}

// ---------- 7. what the player knows ----------
section("What the player knows");
{
  const st = W();
  updateVision(st);
  const h = hub(st);
  const g = st.grid;
  // A tile in the known zone with a hidden extra, and one in the unknown zone, both out of the hub's view.
  const far = (t) => g.distance(t.id, h.tile) > 6;
  const kz = st.tiles.find((t) => far(t) && !t.loc && inKnownZone(st, t) && t.pois.length > 1 && t.pois.some((p) => p.hidden));
  const uz = st.tiles.find((t) => far(t) && !t.loc && !inKnownZone(st, t) && t.pois.length > 0);
  check(!!kz && !!uz, "a known-zone tile with a hidden extra and an unknown-zone tile");
  const hid = kz.pois.findIndex((p) => p.hidden);
  check(poiKnown(st, kz, 0) && !poiKnown(st, kz, hid) && knownPois(st, kz).length === kz.pois.filter((p) => !p.hidden).length && morePoisHidden(st, kz), "known zone: the top POI known, the hidden one not, more may be hidden");
  check(knownPois(st, uz).length === 0 && morePoisHidden(st, uz), "unknown zone: nothing known");
  check(poiKnown(st, kz.id, 0) === poiKnown(st, kz, 0), "a tile id works as well as the tile");
  // A snapshot carries what is known; a site POI goes by the site's discovery.
  const snap = snapshot(st, kz.id);
  check(Array.isArray(snap.pois) && snap.pois.length === knownPois(st, kz).length && snap.pois.every((x) => x.kind === kz.pois[x.i].kind) && snap.surveyed === undefined, "a snapshot lists the known POIs by index and kind");
  const bare = st.tiles.find((t) => !t.pois.length);
  check(snapshot(st, bare.id).pois === undefined, "a tile without POIs adds nothing to its snapshot");
  const hiddenSite = st.tiles.find((t) => permanentSite(t) && !isPublicSite(st, t.id) && !siteKnown(st, t.id));
  if (hiddenSite) {
    check(!poiKnown(st, hiddenSite, 0), `${hiddenSite.loc.name}: a hidden site's POI is unknown`);
    st.knowledge[hiddenSite.id] = snapshot(st, hiddenSite.id);
    check(poiKnown(st, hiddenSite, 0), "known once the tile is seen (discovery.js)");
  }
  // A team's survey: its finds stay in its report until the hub gets it.
  const ids = Object.values(st.survivors).filter((s) => s.location && s.location.kind === "base" && s.location.baseId === h.id).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: ids, dest: kz.id, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  check(!res.error, `a team sent out (${res.error || "ok"})`);
  const p = res.party;
  p.path = [kz.id]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.dest = kz.id; p.orders = [];
  const none = revealPois(st, p, kz, { chance: 0 });
  check(none.length === 0 && !p.poiFinds, "nothing found at chance 0");
  const found = revealPois(st, p, kz, { all: true, stamp: "surveyed" });
  check(found.includes(hid) && found.length === kz.pois.filter((x) => x.hidden).length, `a full survey finds every hidden POI (${found.length})`);
  check(poiKnownTo(st, kz, hid, p) && !poiKnown(st, kz, hid) && p.poiFinds.get(kz.id).surveyed === Math.floor(st.hour / 24) + 1, "the team knows it, the hub does not yet; the survey day is stamped");
  check(knownPois(st, kz, p).length === kz.pois.length && !morePoisHidden(st, kz, p), "to the team, nothing more is hidden there");
  check(revealPois(st, p, kz, { all: true }).length === 0, "found once");
  mergeKnowledge(st, p.seen || new Map(), p.spotted || null, p);
  check(poiKnown(st, kz, hid) && poiKnowledge(st, kz.id).surveyed > 0 && !p.poiFinds.size, "its report reaches the hub: known there, the finds cleared");
  // A chance roll is a hash roll: the same hour and team find the same.
  const u2 = st.tiles.find((t) => far(t) && !t.loc && !inKnownZone(st, t) && t.pois.length >= 3);
  if (u2) {
    const a = revealPois(st, null, u2, { chance: 0.5 });
    const st2 = W(); st2.hour = st.hour;
    const b = revealPois(st2, null, st2.tiles[u2.id], { chance: 0.5 });
    check(JSON.stringify(a) === JSON.stringify(b) && a.length < u2.pois.length, `a chance roll is deterministic and partial (${a.length} of ${u2.pois.length})`);
    check(a.every((i) => poiKnown(st, u2, i)) && u2.pois.some((_, i) => !poiKnown(st, u2, i)), "found straight into the hub's record without a team");
  }
  // A quick look stamps "looked"; a report's stamp only moves forward.
  revealPois(st, null, uz, { chance: 0, stamp: "looked" });
  const d = Math.floor(st.hour / 24) + 1;
  check(poiKnowledge(st, uz.id).looked === d, "a quick look stamps the day");
  learnPois(st, uz.id, { looked: d - 3 });
  check(poiKnowledge(st, uz.id).looked === d, "an older report does not move the stamp back");
  // The dev reveal.
  setPoiReveal(true);
  check(poiKnown(st, uz, 0) && !morePoisHidden(st, uz), "the dev reveal shows every POI");
  const before = knownPois(st, uz).length;
  setPoiReveal(false);
  check(knownPois(st, uz).length < before, "and hides them again");
  // A hive rising or falling clears the tile.
  const ht = st.tiles.find((t) => !t.hive && !t.loc && t.pois.length && far(t));
  ensureHives(st);
  const hv = newHive(st, ht.id, { biomass: 10 });
  st.hives.push(hv);
  check(poisOf(ht).length === 0 && ht.pois.length === 0, "a hive rising clears the tile's POIs");
  destroyHive(st, hv, "", { quiet: true });
  check(!ht.hive && ht.pois.length === 0 && generatePois(st, ht).length > 0 && packPois(st)[ht.id] && packPois(st)[ht.id].list.length === 0, "destroyed, the tile stays empty (and a save remembers it)");
  clearPois(st.tiles[0]);
  check(poiEligible(st, st.tiles[0]) === (st.tiles[0].terrain !== "water" && !st.tiles[0].hive && !(st.tiles[0].loc && ["city", "town"].includes(st.tiles[0].loc.type))), "eligibility reads the tile");
}

// ---------- 8. saves ----------
section("Saves: changes only, old saves get their lists");
{
  const st = W();
  const t = st.tiles.find((x) => !x.loc && x.pois.length > 1);
  poiTake(t, 1, 0.1); t.pois[1].visits = 3; t.pois[1].lastDay = 4;
  poiLedger(t, 0).looted["3"] = 7;
  revealPois(st, null, t, { all: true, stamp: "surveyed" });
  const mods = packPois(st);
  check(Object.keys(mods).length === 1 && mods[t.id].m && Object.keys(mods[t.id].m).length === 2, `only the changed POIs are packed (${Object.keys(mods).length} tiles)`);
  const text = saveToString(st);
  check(st.tiles.every((x) => Array.isArray(x.pois)) && !("poiMods" in st), "the world keeps its lists after a save");
  const save = JSON.parse(text);
  const lists = (s) => (JSON.stringify(s).match(/"threatStamp"/g) || []).length; // a field only a POI has
  check(JSON.stringify(save.state).includes('"poiMods"') && lists(save.state) === 2, `the save holds poiMods and no lists on the tiles (${lists(save.state)} POIs written)`);
  const st2 = loadFromString(text);
  check(sig(st2) === sig(st) && !("poiMods" in st2), "loaded: the same lists, the changes on them");
  check(JSON.stringify(st2.poiKnow) === JSON.stringify(st.poiKnow) && poiKnown(st2, t.id, 1), "the hub's record is saved");
  check(saveToString(st2) === text, "saved again: the same save");
  // A save from before POIs: no lists, no record, no mods. Loaded, it gets the seed's lists and tile.loot as the pools.
  const old = JSON.parse(JSON.stringify(serializeState(W())));
  const raw = JSON.stringify(old);
  check(lists(old) === 0, "a fresh save writes no POI at all");
  const bare = JSON.parse(raw.replace(/"poiMods":\{[^}]*\}/, '"poiMods":null').replace(/"poiKnow":\{[^}]*\}/, '"poiKnow":null'));
  const st3 = deserializeState(bare);
  check(sig(st3) === sig(W()) && st3.poiKnow && typeof st3.poiKnow === "object" && !("poiMods" in st3), "an old save gets the seed's lists and an empty record");
  const site = st3.tiles.find((x) => permanentSite(x) && x.pois.length);
  check(poiPool(site, 0) === site.loot, "its sites' loot stands as their POI's pool");
  // A day on, saved and loaded, the same.
  for (let i = 0; i < 24; i++) tickHour(st);
  st.cards.length = 0;
  const st4 = loadFromString(saveToString(st));
  check(sig(st4) === sig(st), "after a day: saved and loaded the same");
}

// ---------- 9. the save corpus ----------
if (corpus) {
  section("The save corpus (tools/savecorpustest.js 2)");
  const here = dirname(fileURLToPath(import.meta.url));
  let ok = true, out = "";
  try { out = execFileSync(process.execPath, [join(here, "savecorpustest.js"), "2"], { encoding: "utf8", timeout: 600000 }); } catch (e) { ok = false; out = (e.stdout || "") + (e.stderr || ""); }
  const last = out.trim().split("\n").pop();
  check(ok && /0 failed/.test(last), `every save in the corpus loads with POIs (${last})`);
}

console.log(`\n${passes} passed, ${fails} failed.`);
if (fails) process.exit(1);
