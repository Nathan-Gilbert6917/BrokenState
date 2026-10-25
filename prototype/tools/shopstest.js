// The town's and the city's shops and services as places (src/sim/shops.js, data-shops.js, shopshelves.js; the
// user's requests 2026-10-21: gun stores and pawn shops; the hardware store; "sporting good/out door store …
// electronics shop, radio shop, bookstore and libraries … grocery stores, diners, clinics, motels, churches, auto
// shops, animal/pet stores, fire station, police stations, garden center, clothing stores, vet clinics, car
// dealership, pizza shops and other restaurants, banks, bars, liquor store … more common in areas that makes sense
// … versions that fit the setting … for city, town, suburbs POIs and crawls"; "many variants for each to show being
// different franchises including colors, layout etc").
// - the data: every new kind is a site type with theme tags, raid rooms, a building and a map size; every placed kind
//   has its building; every franchise has a unique id and name, its weights by setting, a look (colours, style)
// - the sport items: football pads and a helmet, a goalie mask, a hockey stick, bats, golf clubs and bows at a
//   sporting goods store
// - as POIs: up to two on a suburb or city tile by its setting, more common where they make sense (banks downtown,
//   garden centers in the suburbs and towns, …); a franchise only where it stands (its weight there), its name the POI's
// - the crawl: city and town crawl blocks hold them besides their own places (those unchanged), never past the
//   block's most, never two of a kind; every place of a franchised kind is a franchise, a town's by the town's weights
// - the buildings: every franchise of every kind lays out and builds a raid map; plans change the layout (wider, a
//   flat above, the front room's floor and name); a POI or a crawl building left before franchises keeps its layout
// - a shop POI's shelves: guns, rigs, survival gear (gun store, pawn shop), materials (hardware), valuables (bank)
// - a search on a pawn shop POI runs hour by hour; the hardware store's materials
// - laid out for their kind (shoplayout.js, issue #16): every shop front has a checkout and its kind's pieces (a cold
//   case, the gun counter and racks, bookshelves, tanks, potting benches, clothes racks, a workbench...); every
//   restaurant a kitchen with a range and a walk-in cold room behind a steel door (a pizza place a pizza oven); every
//   motel room a bed and a bathroom; the bank's vault locked, its ATM; the office tower's desks, meeting rooms, server
//   racks; every container on its piece and reachable, every room's floor one walk; the same building the same layout;
//   loot per kind within ±10% of the old layout over 200 seeds; an older save's buildings furnished the old way; their
//   signs of survival (a motel room held, a stockroom shelter, a counter stand, a walk-in) on the new layouts only
// Usage: node tools/shopstest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { LOCATIONS, GEAR } from "../src/sim/data.js";
import { SITE_TAGS, AREA_TAGS, BUILDMAT_FINDS, SITE_WOOD } from "../src/sim/loot.js";
import { AREA_SETS, AREAS, WEAPONS } from "../src/sim/combat.js";
import { SITES, BUILDINGS, buildingHint, buildingMap, siteBuildings, assemble } from "../src/sim/buildingmaps.js";
import { COMMERCIAL_KEYS, styleName } from "../src/sim/shoplayout.js";
import { pieceDef } from "../src/sim/data-furniture.js";
import { boxLoot, CELL } from "../src/sim/combat.js";
import { supValue } from "../src/sim/data.js";
import { rollScenes } from "../src/sim/interiorscenes.js";
import { SIZES } from "../src/sim/battlesize.js";
import { SITE_KIT, AREA_KIT } from "../src/sim/carrykit.js";
import { SURV_FINDS, AREA_SURV } from "../src/sim/data-survival.js";
import { ARSENAL_FINDS } from "../src/sim/data-guns.js";
import { ARMOUR } from "../src/sim/armour.js";
import { HELMETS } from "../src/sim/helmets.js";
import { Rng } from "../src/sim/rng.js";
import { launchExpedition } from "../src/sim/parties.js";
import { startScavenge, searchHour } from "../src/sim/scavenge.js";
import * as CC from "../src/sim/citycrawl.js";
import { rollArea } from "../src/sim/citycrawl.js";
import { cellsOf, keyOf } from "../src/sim/citygrid.js";
import { SHOP, SHOP_KINDS, settingOf, franchiseById, franchiseName, shopExtras } from "../src/sim/shops.js";
import { NEW_KINDS, AREA_DEFS, PLACE_W, FRANCHISES } from "../src/sim/data-shops.js";
import { rollShopShelves, rollShopSupplies } from "../src/sim/shopshelves.js";
import { setPoiReveal, poiName } from "../src/sim/pois.js";
import { poiPlace } from "../src/sim/poiraid.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 7 }); st.started = true; st.cards.length = 0; return st; };
const RIGS = new Set(["chestrig", "tacvest", "makeshiftrig", "legrig"]);
const SURV = new Set(Object.values(SURV_FINDS).flatMap((r) => Object.keys(r.items)));
const isGun = (k) => !!(WEAPONS[k] && !WEAPONS[k].melee);
const say = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
const ASKED = ["sportshop", "electronics", "radioshop", "bookstore", "library", "grocery", "diner", "clinic", "motel", "church", "autoshop", "petstore", "firestation", "police", "garden", "clothing", "vet", "dealer", "pizza", "restaurant", "bank", "bar", "liquor"];

// ---------- 1. the data ----------
section("The kinds, the franchises and their tables");
{
  for (const [k, d] of Object.entries(NEW_KINDS)) {
    const def = LOCATIONS[k];
    check(!!def && def.richness > 0 && def.gear.every((g) => GEAR[g]), `${k}: a LOCATIONS type with known gear`);
    check(!!SITE_TAGS[k] && Array.isArray(AREA_SETS[k]) && AREA_SETS[k].every((a) => AREAS[a]) && SIZES.SITE[k] != null, `${k}: theme tags, raid rooms, a map size`);
    check(!!SITES[k] && SITES[k].every((e) => BUILDINGS[Array.isArray(e) ? e[0] : e]), `${k}: its building`);
  }
  for (const a of Object.keys(AREA_DEFS)) check(!!AREAS[a] && !!AREA_TAGS[a], `${a}: a raid room with theme tags`);
  check(ASKED.every((k) => PLACE_W[k] && LOCATIONS[k] && SITES[k]), `every kind asked for is placed (${ASKED.filter((k) => !PLACE_W[k]).join(", ") || "all"})`);
  check(SHOP_KINDS.every((k) => LOCATIONS[k] && SITES[k] && ["city", "suburb", "town"].every((s) => PLACE_W[k][s] >= 0) && PLACE_W[k].crawl), "every placed kind: a site type, a building, weights by setting and in the crawl");
  const ids = new Set(), names = new Set();
  let dupId = 0, dupName = 0, badLook = 0, badW = 0, n = 0;
  const hex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
  for (const [kind, list] of Object.entries(FRANCHISES)) for (const f of list) {
    n++;
    if (ids.has(`${kind}:${f.id}`)) dupId++; ids.add(`${kind}:${f.id}`);
    if (names.has(f.name)) dupName++; names.add(f.name);
    if (!["wall", "trim", "sign", "text", "accent"].every((c) => hex(f.look[c])) || ![0, 1, 2, 3].includes(f.look.style)) badLook++;
    if (!["city", "suburb", "town"].every((s) => f.w[s] >= 0) || !(f.w.city + f.w.suburb + f.w.town > 0)) badW++;
  }
  check(!dupId && !dupName, `${n} franchises, ids and names all their own (${dupId} ids, ${dupName} names twice)`);
  check(!badLook && !badW, `each with a look (colours, a style 0–3) and its weights by setting (${badLook} looks, ${badW} weights off)`);
  const few = ASKED.filter((k) => (FRANCHISES[k] || []).length < 3);
  check(!few.length, `every kind asked for has at least 3 franchises (${few.join(", ") || "all"}; ${Object.entries(FRANCHISES).map(([k, l]) => `${k} ${l.length}`).join(", ")})`);
  for (const k of ASKED) check(["city", "suburb", "town"].every((s) => (FRANCHISES[k] || []).some((f) => f.w[s] > 0) || !PLACE_W[k][s]), `${k}: a franchise for every setting it stands in`);
}

// ---------- 2. the sport items ----------
section("Sporting goods: football gear, a goalie mask, a hockey stick, bats, clubs and bows");
{
  const sp = LOCATIONS.sportshop.gear, area = AREAS.sportshop.gear.map(([k]) => k);
  check(["footballhelmet", "sportspads", "goaliemask", "bat", "golfclub", "hockeystick", "compbow", "xbow"].every((k) => sp.includes(k) && area.includes(k)), "its shelves and its raid rooms hold them all");
  check(GEAR.goaliemask && GEAR.goaliemask.slot === "head" && ARMOUR.goaliemask && HELMETS.goaliemask, "the goalie mask: light head armour (armour.js, helmets.js)");
  check(GEAR.sportspads && GEAR.sportspads.slot === "armor" && GEAR.footballhelmet.slot === "head", "football pads and a helmet: light armour");
  check(GEAR.hockeystick && WEAPONS.hockeystick && WEAPONS.hockeystick.melee && WEAPONS.hockeystick.mclass === "blunt", "the hockey stick: a blunt melee weapon");
}

// ---------- 3. as points of interest ----------
section("As points of interest: by the setting, franchises where they stand");
{
  const by = { city: {}, suburb: {}, town: {} }, tiles = { city: 0, suburb: 0, town: 0 };
  let wrongFr = 0, named = 0, frs = 0, over = 0, twice = 0;
  const seen = new Set();
  for (const s of [seed, seed + 1, seed + 2]) {
    const st = W(s);
    for (const t of st.tiles) {
      const set = settingOf(st, t);
      if (set) tiles[set]++;
      if (t.pois.length > 4) over++;
      const kinds = t.pois.map((p) => p.kind);
      if (new Set(kinds).size !== kinds.length && t.pois.filter((p) => p.extra === "shop").some((p) => kinds.filter((k) => k === p.kind).length > 1)) twice++;
      for (const [i, p] of t.pois.entries()) {
        if (p.extra === "shop") by[set][p.kind] = (by[set][p.kind] || 0) + 1;
        if (!p.v) continue;
        frs++; seen.add(`${p.kind}:${p.v}`);
        const f = franchiseById(p.kind, p.v);
        if (!f || (set && !(f.w[set] > 0))) wrongFr++;
        if (!p.site && poiName(t, i) === f.name) named++;
      }
    }
  }
  for (const set of ["city", "suburb", "town"]) console.log(`  ${set} (${tiles[set]} tiles): ${say(by[set])}`);
  check(SHOP_KINDS.filter((k) => !["corner"].includes(k)).every((k) => ["city", "suburb", "town"].some((s) => by[s][k] > 0)), `every kind stands somewhere (${SHOP_KINDS.filter((k) => !["city", "suburb", "town"].some((s) => by[s][k] > 0)).join(", ") || "all"})`);
  // Where each is more common: the share of the shops on a tile of each setting, over many worlds' dice (the picker
  // itself, shopExtras, on a city block, a city's suburb and a town's ring of one world, the seed changed).
  const st = W();
  const pick = { city: st.tiles.find((t) => settingOf(st, t) === "city"), suburb: st.tiles.find((t) => settingOf(st, t) === "suburb"), town: st.tiles.find((t) => settingOf(st, t) === "town") };
  const share = { city: {}, suburb: {}, town: {} };
  for (const [set, t] of Object.entries(pick)) {
    let n = 0;
    for (let k = 0; k < 4000; k++) for (const p of shopExtras({ ...st, seed: 100000 + k }, { ...t, loc: null }, [], true, 4)) { share[set][p.kind] = (share[set][p.kind] || 0) + 1; n++; }
    for (const k of Object.keys(share[set])) share[set][k] /= n;
  }
  const sh = (set, k) => share[set][k] || 0;
  const pct = (set, k) => `${(100 * sh(set, k)).toFixed(1)}%`;
  check(["bank", "clothing", "electronics", "bookstore", "restaurant"].every((k) => sh("city", k) > sh("town", k)), `banks, clothing, electronics, bookstores and restaurants more common downtown (banks ${pct("city", "bank")} of a city block's shops, ${pct("town", "bank")} of a town's)`);
  check(["garden", "dealer", "petstore", "hardware"].every((k) => sh("suburb", k) > sh("city", k)), `garden centers, dealerships, pet stores and hardware more common in the suburbs (garden ${pct("suburb", "garden")} against ${pct("city", "garden")} downtown)`);
  check(["diner", "church", "vet", "gunstore", "motel"].every((k) => sh("town", k) > sh("city", k)), `diners, churches, vets, gun stores and motels more common in the towns (diners ${pct("town", "diner")} against ${pct("city", "diner")})`);
  check(!over && !twice, `never over 4 places, never two of a kind (${over}, ${twice})`);
  check(frs > 500 && !wrongFr, `${frs} places of franchised kinds, each one of its kind's franchises that stands in its setting (${wrongFr} not)`);
  check(named > 300, `a franchise's name is the POI's (${named})`);
  check(seen.size > 100, `many franchises seen across 3 worlds (${seen.size} of ${Object.values(FRANCHISES).flat().length})`);
}

// ---------- 4. the crawl ----------
section("The city and town crawls: shops and services on the blocks, as franchises");
{
  const byKind = { city: {}, town: {} };
  let over = 0, twice = 0, same = 0, cmp = 0, slots = 0, frPlaces = 0, frWrong = 0, frNamed = 0, extras = 0;
  for (const s of [seed, seed + 1, seed + 2]) {
    const st = W(s);
    const h = hub(st);
    for (const type of ["city", "town"]) {
      const tile = st.tiles.find((t) => t.loc && t.loc.type === type && t.id !== h.tile);
      if (!tile) continue;
      const crew = atBase(st, h.id).slice(0, 2).map((x) => x.id);
      const res = launchExpedition(st, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2 } });
      if (res.error) continue;
      const p = res.party;
      p.path = [tile.id]; p.idx = 0; p.dest = tile.id; p.phase = "engaged";
      CC.startCrawl(st, p);
      const c = p.crawl;
      for (const [x, y] of cellsOf(c.grid)) {
        const key = keyOf(x, y);
        const blk = CC.genBlock(st, c, key);
        // The same block with no shops on the dice: the places before the shops, as the block's own dice make them.
        const c2 = { ...c, blocks: {} };
        const saved = SHOP.CRAWL;
        SHOP.CRAWL = { city: [], town: [] };
        const b2 = CC.genBlock(st, c2, key);
        SHOP.CRAWL = saved;
        const shops = blk.places.slice(b2.places.length);
        extras += shops.length;
        for (const pl of shops) {
          byKind[type][pl.key] = (byKind[type][pl.key] || 0) + 1;
          if (pl.id !== `${key}p${pl.slot}` || !SHOP_KINDS.includes(pl.key)) slots++;
        }
        for (const pl of blk.places) {
          if (!pl.v) continue;
          frPlaces++;
          const f = franchiseById(pl.key, pl.v);
          const set = type === "town" ? "town" : blk.n <= SHOP.OUTER ? "suburb" : "city";
          if (!f || !(f.w[set] > 0)) frWrong++;
          if (pl.name.startsWith(f ? f.name : "?")) frNamed++;
        }
        if (blk.places.length > CC.CRAWL.PLACES[1]) over++;
        const keys = blk.places.map((pl) => pl.key);
        if (new Set(keys).size !== keys.length) twice++;
        cmp++;
        if (JSON.stringify(b2.places.map((pl) => [pl.key, pl.name, pl.raiders, pl.dead])) === JSON.stringify(blk.places.slice(0, b2.places.length).map((pl) => [pl.key, pl.name, pl.raiders, pl.dead]))) same++;
      }
    }
  }
  console.log(`  3 seeds, ${extras} extra places: city ${say(byKind.city)}; town ${say(byKind.town)}`);
  check(Object.keys(byKind.city).length >= 15 && Object.keys(byKind.town).length >= 10, `city and town crawls hold many kinds (${Object.keys(byKind.city).length} and ${Object.keys(byKind.town).length})`);
  check(!slots, `in the next slots (${slots} off)`);
  check(!over && !twice, `never past the block's most, never two of a kind (${over} over, ${twice} twice)`);
  check(cmp > 0 && same === cmp, `every block's own places are as they were, names aside: the same buildings (${same} of ${cmp} blocks)`);
  check(frPlaces > 200 && !frWrong && frNamed === frPlaces, `${frPlaces} crawl places are franchises that stand in their setting and carry their names (${frWrong} wrong, ${frPlaces - frNamed} unnamed)`);
}

// ---------- 5. the buildings ----------
section("The buildings: every franchise lays out, plans change the layout");
{
  const st = W();
  const tile = st.tiles.find((t) => t.terrain === "suburb" && !t.loc);
  let bad = 0, built = 0;
  const keyOfKind = (k) => { const e = SITES[k] && SITES[k][0]; return Array.isArray(e) ? e[0] : e; };
  for (const [kind, list] of Object.entries(FRANCHISES)) {
    const key = keyOfKind(kind);
    if (!key || !BUILDINGS[key]) continue;
    for (const f of list) {
      try {
        const map = buildingMap(st, tile.id, { id: `t:${kind}:${f.id}`, key, name: f.name, variant: f.id, kind }, false);
        const rooms = (map.rooms || map.plan?.rooms || []);
        if (!map || !(map.w > 0 || map.cells)) throw new Error("no map");
        built++;
        if (rooms.length && rooms.some((r) => r.type && !AREAS[r.type])) throw new Error("a room of no area");
      } catch (e) { bad++; console.log(`    ${kind}/${f.id}: ${e.message}`); }
    }
  }
  check(built > 140 && !bad, `${built} franchise buildings build a raid map (${bad} failed)`);
  const spec = (kind, id, s = 3) => BUILDINGS[keyOfKind(kind)].make(new Rng(s), { variant: id, kind });
  check(spec("sportshop", "peaksports").bw >= spec("sportshop", "bigbuck").bw, "a wide franchise is wider (Peak Sports against Big Buck)");
  const stor = Array.from({ length: 12 }, (_, s) => spec("bank", "mercantile", s).storeys), one = Array.from({ length: 12 }, (_, s) => spec("bank", "libertysl", s).storeys);
  check(Math.min(...stor) >= 2 && Math.max(...one) === 1, `a franchise's storeys (Mercantile Trust ${Math.min(...stor)}–${Math.max(...stor)}, Liberty Savings & Loan 1)`);
  const flats = Array.from({ length: 20 }, (_, s) => spec("grocery", "bodega", s).storeys).filter((n) => n > 1).length;
  check(flats > 8 && Array.from({ length: 20 }, (_, s) => spec("grocery", "freshway", s).storeys).every((n) => n === 1), `a bodega has a flat above most of the time (${flats} of 20), FreshWay never`);
  const room = (kind, id) => JSON.stringify(spec(kind, id).program).match(/"name":"([^"]+)"/)[1];
  check(room("restaurant", "beanthere") === "Cafe" && room("restaurant", "noodlehouse") === "Noodle bar", `a franchise names its front room (Bean There: ${room("restaurant", "beanthere")}, Noodle House: ${room("restaurant", "noodlehouse")})`);
  // A POI saved before franchises (no v) opens the building it always did; a crawl building left before them too.
  const t = st.tiles.find((x) => x.pois.some((p) => p.v && SITES[p.kind]));
  const i = t.pois.findIndex((p) => p.v && SITES[p.kind]);
  const withV = poiPlace(t, i), keep = t.pois[i].v;
  delete t.pois[i].v;
  const without = poiPlace(t, i);
  t.pois[i].v = keep;
  check(withV.variant === keep && withV.name === franchiseName(t.pois[i].kind, keep) && !without.variant, `a POI's building carries its franchise (${withV.name}); one saved without opens the old layout`);
  const opt = CC.placeOption({ buildings: { a: { searched: 1 } } }, { id: "a", slot: 0, key: "bar", name: "x", v: "omalleys" }, 1);
  const opt2 = CC.placeOption({ buildings: {} }, { id: "a", slot: 0, key: "bar", name: "x", v: "omalleys" }, 1);
  check(!opt.variant && opt2.variant === "omalleys", "a crawl building left before franchises keeps its old layout; a new one is laid out by its franchise");
  const site = st.tiles.find((x) => x.loc && x.pois[0] && x.pois[0].site && x.pois[0].v && SITES[x.loc.type] && SITES[x.loc.type].length === 1);
  if (site) check(siteBuildings(site).options[0].variant === site.pois[0].v, `a single-building site's building is its franchise's (${site.loc.name}: ${franchiseName(site.loc.type, site.pois[0].v)})`);
}

// ---------- 5b. a bank's and a liquor store's shelves ----------
section("A bank's vault and a liquor store's shelves");
{
  const st = W();
  const tile = st.tiles.find((t) => t.terrain === "city" && !(t.loc && SHOP_KINDS.includes(t.loc.type)));
  const tally = (kind, keys, n = 2000) => { let k = 0; for (let i = 0; i < n; i++) { st.hour = 2000 + i; for (const it of rollShopShelves(st, tile.id, kind, 1, 1, `b${i}`)) if (keys.includes(GEAR[it.key].cat)) k++; } return k; };
  const bank = tally("bank", ["jewelry", "collectibles"]), liquor = tally("liquor", ["liquor", "smokes"]);
  check(bank > 50 && liquor > 200, `as POIs: a bank's valuables (${bank} in 2000 hours), a liquor store's bottles and smokes (${liquor})`);
  const rng = new Rng(5);
  let vault = 0;
  for (let i = 0; i < 2000; i++) { const r = rollArea(rng, "bankvault", 1, 0, "bank"); vault += r.gear.filter((g) => ["jewelry", "collectibles"].includes(GEAR[g.key].cat)).length; }
  check(vault > 400, `a vault's boxes: valuables (${vault} in 2000 boxes)`);
}

// ---------- 3. a shop POI's shelves ----------
section("A shop POI's shelves: guns, rigs and survival gear");
{
  const st = W();
  const tile = st.tiles.find((t) => t.terrain === "suburb" && !(t.loc && SHOP_KINDS.includes(t.loc.type)));
  const tally = (kind, n = 3000) => {
    const out = { items: 0, rigs: 0, guns: 0, surv: 0 };
    for (let i = 0; i < n; i++) {
      st.hour = 1000 + i;
      for (const it of rollShopShelves(st, tile.id, kind, 1, 1, `t${i}`)) {
        out.items++;
        if (RIGS.has(it.key)) out.rigs++;
        if (isGun(it.key)) out.guns++;
        if (SURV.has(it.key)) out.surv++;
      }
    }
    return out;
  };
  const pawn = tally("pawnshop"), gun = tally("gunstore");
  console.log(`  3000 search hours: pawn shop ${JSON.stringify(pawn)}, gun store ${JSON.stringify(gun)}`);
  check(pawn.rigs > 60 && pawn.guns > 60 && pawn.surv > 100, "a pawn shop's shelves: rigs, guns and survival gear");
  check(gun.rigs > 60 && gun.guns > 60, "a gun store's: rigs and guns");
  check(rollShopShelves(st, tile.id, "house", 1, 1, "x").length === 0 && rollShopShelves(st, tile.id, "pharmacy", 1, 1, "x").length === 0, "nothing for another kind");
  const site = st.tiles.find((t) => t.loc && t.loc.type === "gunstore");
  if (site) check(Array.from({ length: 200 }, (_, i) => rollShopShelves(st, site.id, "gunstore", 1, 1, `s${i}`).length).every((n) => n === 0), "nothing extra for the tile's own gun store site (its tables roll by the site)");
  const low = tally("pawnshop", 1000), lowLeft = (() => { let n = 0; for (let i = 0; i < 1000; i++) { st.hour = 1000 + i; n += rollShopShelves(st, tile.id, "pawnshop", 0.2, 1, `t${i}`).length; } return n; })();
  check(lowLeft < low.items * 0.5, `a picked-over shop finds less (${lowLeft} at 20% left, ${low.items} full)`);
  // Against the town's other places: the town site's kit roll finds a rig a search hour about this often.
  const townRig = SITE_KIT.town ? Object.keys(SITE_KIT.town.items).filter((k) => RIGS.has(k)).length : 0;
  check(!townRig, "a town's own kit roll has no rigs at all (the shops are where they are)");
}

// ---------- 4. a search on a pawn shop POI ----------
section("A search hour by hour on a pawn shop POI");
{
  let done = false;
  for (let s = seed; s < seed + 30 && !done; s++) {
    const st = W(s);
    st.autoCombat = true;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.id !== h.tile && t.pois.some((p) => p.kind === "pawnshop"));
    if (!tile) continue;
    setPoiReveal(true);
    const idx = tile.pois.findIndex((p) => p.kind === "pawnshop");
    tile.pois[idx].hidden = false;
    const crew = atBase(st, h.id).slice(0, 3).map((x) => x.id);
    const res = launchExpedition(st, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
    if (res.error) { setPoiReveal(false); continue; }
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.dest = tile.id; p.phase = "engaged";
    p.poi = idx;
    const ok = startScavenge(st, p);
    const e = st.engagement;
    check(ok && e && e.poi === idx, `the search goes into the pawn shop (tile ${tile.id}, POI ${idx})`);
    if (e) e.approach = "normal"; // the approach the card asks for (scavenge.js APPROACHES)
    let threw = null;
    try { for (let i = 0; i < 8 && e && !e.done; i++) searchHour(st); } catch (err) { threw = err; }
    check(!threw, `eight search hours run (${threw && threw.stack})`);
    if (e) console.log(`  found: ${e.found.gear.map((g) => g.name).join(", ") || "no gear"}; ${Object.entries(e.found.supplies).map(([k, v]) => `${v} ${k}`).join(", ")}`);
    setPoiReveal(false);
    done = true;
  }
  check(done, "a world with a pawn shop POI");
}

// ---------- 5. the hardware store ----------
section("The hardware store: materials for building and crafting");
{
  const A = AREAS.hardware;
  check(!!A && ["scrap", "parts", "buildmat", "wood"].every((k) => A.loot[k]) && A.gear.some(([k]) => k === "hammer") && A.gear.some(([k]) => k === "boards"), "its aisles: scrap, parts, building materials, lumber; hammers, boards and nails");
  check(AREA_SETS.hardware.filter((a) => a === "hardware").length >= 2 && buildingHint("hardware").holds.includes("hardware"), `its raid map and its building are its aisles (${buildingHint("hardware").holds.join(", ")})`);
  // Its aisles against the old ones (a workshop and a store): building materials, scrap and parts by the container.
  const rng = new Rng(7);
  const sum = (type) => { const o = {}; for (let i = 0; i < 4000; i++) for (const [k, v] of Object.entries(rollArea(rng, type, 1, 0, "hardware").sup)) o[k] = (o[k] || 0) + v; return o; };
  const hw = sum("hardware"), ws = sum("workshop"), st = sum("store");
  console.log(`  4000 containers: aisles ${JSON.stringify(hw)}; workshop ${JSON.stringify(ws)}; store ${JSON.stringify(st)}`);
  check((hw.buildmat || 0) > 1000 && !(ws.buildmat || 0) && !(st.buildmat || 0), "building materials on its shelves (none in a workshop or a store)");
  check((hw.scrap || 0) > (ws.scrap || 0) * 0.9 && (hw.parts || 0) > (ws.parts || 0) * 0.9, "scrap and parts as a workshop's");
  check(BUILDMAT_FINDS.hardware[0] >= 0.5 && BUILDMAT_FINDS.hardware[0] === Math.max(...Object.values(BUILDMAT_FINDS).map((r) => r[0])) && SITE_WOOD.hardware[0] >= 0.4, `the search hour: building materials ${BUILDMAT_FINDS.hardware.join("/")}, the most of anywhere; wood ${SITE_WOOD.hardware.join("/")}`);
  check(LOCATIONS.hardware.loot.scrap >= 7 && LOCATIONS.hardware.loot.parts >= 3 && LOCATIONS.hardware.gear.includes("toolbox"), "its search table: more scrap and parts, a toolbox on the shelves");
  // As a POI: its own building materials and wood by the hour.
  const s0 = W();
  const tile = s0.tiles.find((t) => t.terrain === "suburb" && !(t.loc && t.loc.type === "hardware"));
  const got = { buildmat: 0, wood: 0, hours: 0 };
  for (let i = 0; i < 2000; i++) { s0.hour = 5000 + i; const r = rollShopSupplies(s0, tile.id, "hardware", 1, 1, `m${i}`); got.buildmat += r.buildmat || 0; got.wood += r.wood || 0; if (r.buildmat) got.hours++; }
  console.log(`  2000 search hours as a POI: ${got.buildmat} building materials in ${got.hours} hours, ${got.wood} wood`);
  check(got.hours > 2000 * 0.45 && got.wood > 0, "a hardware POI's shelves: building materials about every other hour, and wood");
  check(!Object.keys(rollShopSupplies(s0, tile.id, "pawnshop", 1, 1, "x")).length && !Object.keys(rollShopSupplies(s0, tile.id, "house", 1, 1, "x")).length, "none for a pawn shop or a house");
  const site = s0.tiles.find((t) => t.loc && t.loc.type === "hardware");
  if (site) check(!Object.keys(rollShopSupplies(s0, site.id, "hardware", 1, 1, "x")).length, "nothing extra for the tile's own hardware site (its tables roll by the site)");
  const tools = { n: 0 };
  for (let i = 0; i < 3000; i++) { s0.hour = 9000 + i; tools.n += rollShopShelves(s0, tile.id, "hardware", 1, 1, `k${i}`).length; }
  check(tools.n > 300, `its shelves' small finds, lamps, carts and hard hats as a POI (${tools.n} in 3000 hours)`);
}

// ---------- 6. laid out for their kind ----------
section("Laid out for their kind (shoplayout.js, issue #16)");
{
  const N = process.env.BS_QUICK ? 10 : 30;
  const FK = { gasstation: "gas" };
  const KEYS = [...COMMERCIAL_KEYS];
  const make = (key, s, legacy = false, noDecor = false) => {
    const fr = FRANCHISES[FK[key] || key] || [], rng = new Rng(9000 + s * 104729 + key.length);
    return assemble(rng, BUILDINGS[key].make(rng, { variant: fr.length ? fr[s % fr.length].id : null, legacy }), { key, name: key, legacy, noDecor });
  };
  const grid = (m, f) => (m.floors ? m.floors[f].cells : m.cells);
  const inside = (m, a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y, grid(m, a.f)[y * m.w + x]]); return out; };
  const kinds = (m, a) => new Set(inside(m, a).map(([, , c]) => c.k));
  const walk = (m, f, sx, sy) => {
    const g = grid(m, f), seen = new Uint8Array(m.w * m.h), q = [sy * m.w + sx];
    seen[q[0]] = 1;
    while (q.length) { const i = q.pop(), x = i % m.w, y = (i / m.w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue; const j = ny * m.w + nx; if (!seen[j] && (CELL[g[j].k].walk || g[j].k === "door")) { seen[j] = 1; q.push(j); } } }
    return seen;
  };
  const SIG = {
    grocery: ["coldcase", "rack"], corner: ["coldcase"], gasstation: ["coldcase"], liquor: ["coldcase"], truckstop: ["coldcase", "barcounter"], pharmacy: ["rack"], sportshop: ["rack"], petstore: ["tank"],
    feedstore: ["rack"], garden: ["pottingbench"], hardware: ["workbench", "rack"], gunstore: ["displaycase", "gunrack"], pawnshop: ["displaycase", "bars"], electronics: ["workbench"], radioshop: ["workbench"],
    bookstore: ["bookshelf"], clothing: ["clothesrack"], restaurant: ["table"], diner: ["barcounter", "barstool"], pizza: ["barcounter", "barstool"], bar: ["barcounter", "barstool"], supermarket: ["coldcase", "rack"], deptstore: ["clothesrack"],
  };
  const errs = {}, seen = {};
  const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
  const saw = (k) => { seen[k] = (seen[k] || 0) + 1; };
  let built = 0, styled = 0, rooms = 0;
  for (const key of KEYS) for (let s = 0; s < N; s++) {
    const m = make(key, s), tag = `${key} ${s}`;
    built++;
    const R = m.rooms.filter((a) => !a.outdoor);
    for (const a of R) { rooms++; if (styleName(a, key)) styled++; }
    // Every shop front (a sales floor, a dining room, a bar) has a checkout; the kind's own pieces in its fronts.
    const fronts = R.filter((a) => a.f === 0 && (a.role === "sales" || a.role === "dining") && (SIG[key] || ["supermarket", "deptstore"].includes(key)));
    for (const a of fronts) if (!kinds(m, a).has("checkout")) err("checkout", `${tag} ${a.name}`);
    if (SIG[key]) { const all = new Set(fronts.flatMap((a) => [...kinds(m, a)])); for (const k of SIG[key]) if (!all.has(k)) err("signature", `${tag}: no ${k}`); }
    // Every restaurant, diner and pizza place: a kitchen with a range, the walk-in cold room behind a steel door.
    if (["restaurant", "diner", "pizza"].includes(key)) {
      const kit = R.filter((a) => a.role === "kitchen");
      if (!kit.some((a) => kinds(m, a).has("range"))) err("range", tag);
      if (key === "pizza" && !kit.some((a) => kinds(m, a).has("pizzaoven") || kinds(m, a).has("oven"))) err("oven", tag);
      const cold = R.find((a) => /Walk-in/.test(a.name));
      if (!cold || !kinds(m, cold).has("coldshelf")) err("walkin", tag);
      else if (!cold.doors.some(([x, y]) => grid(m, cold.f)[y * m.w + x].dk === "steel")) err("steel", tag);
    }
    if (key === "bar" && !R.some((a) => a.role === "kitchen" && kinds(m, a).has("range")) && R.some((a) => a.role === "kitchen")) err("range", tag);
    // A motel: every room a bed, as many bathrooms with a toilet; the front desk's safe; the laundry.
    if (key === "motel") {
      const mr = R.filter((a) => a.role === "motelroom"), baths = R.filter((a) => a.role === "bath" && kinds(m, a).has("toilet"));
      for (const a of mr) if (!kinds(m, a).has("bed")) err("motelbed", `${tag} ${a.name}`);
      if (baths.length < mr.length) err("motelbath", `${tag}: ${baths.length} of ${mr.length}`);
      if (!m.containers.some((c) => c.kind === "safe" && c.lockKind === "safe")) err("motelsafe", tag);
      if (R.some((a) => a.name === "Laundry" && kinds(m, a).has("washer"))) saw("laundry");
    }
    // A bank: the vault behind its locked vault door, the ATM by the front door, the safe-deposit room.
    if (key === "bank") {
      const v = R.find((a) => a.name === "Vault");
      if (!v || !m.lockedDoors.some((d) => d.area === v.id && d.kind === "vault")) err("vault", tag);
      if (!m.containers.some((c) => c.kind === "atm" && c.lockKind === "safe")) err("atm", tag);
      if (R.some((a) => a.name === "Safe-deposit room" && kinds(m, a).has("deposit"))) saw("deposit");
      if (R.some((a) => a.name === "Banking hall" && kinds(m, a).has("teller"))) saw("teller");
    }
    if (key === "offices") for (const a of R) for (const k of kinds(m, a)) if (["desk", "cubicle", "whiteboard", "serverrack", "secdesk", "copier", "sofa", "safe", "fridge"].includes(k)) saw(`office ${k}`);
    if (key === "supermarket") { if (R.filter((a) => a.role === "sales").reduce((n, a) => n + inside(m, a).filter(([, , c]) => c.k === "checkout").length, 0) < 2) err("lanes", tag); if (R.some((a) => a.name === "Deli" && kinds(m, a).has("oven"))) saw("deli oven"); if (R.some((a) => a.name === "Pharmacy counter")) saw("pharmacy counter"); }
    for (const [k, test] of [["pallet racks", key === "warehouse" && R.some((a) => kinds(m, a).has("palletrack"))], ["machine tools", key === "factory" && R.some((a) => kinds(m, a).has("machine"))], ["car lift", ["autoshop", "garage", "dealer"].includes(key) && R.some((a) => kinds(m, a).has("carlift"))], ["saddle rack", key === "barn" && R.some((a) => kinds(m, a).has("saddlerack"))], ["greenhouse", key === "garden" && R.some((a) => a.name === "Greenhouse")], ["jukebox", key === "bar" && R.some((a) => kinds(m, a).has("jukebox"))], ["fryer", R.some((a) => kinds(m, a).has("fryer"))]]) if (test) saw(k);
    // Every container on a piece of its kind and searched from a cell its room's first door reaches; every room's
    // floor one walk (the aisles leave a 1-cell walk).
    for (const c of m.containers) {
      const a = m.rooms.find((r) => r.id === c.area);
      if (!a || a.outdoor || c.kind === "car") continue;
      const g = grid(m, c.f || 0);
      if (g[c.y * m.w + c.x].k !== c.kind) err("onpiece", `${tag} ${c.label} on ${g[c.y * m.w + c.x].k}`);
    }
    for (const a of R) {
      if (!a.doors || !a.doors.length) continue;
      const w = walk(m, a.f, a.doors[0][0], a.doors[0][1]), g = grid(m, a.f);
      for (const [x, y, c] of inside(m, a)) if ((CELL[c.k].walk || c.k === "door") && !w[y * m.w + x]) { err("walk", `${tag} ${a.name} ${x},${y}`); break; }
      for (const c of m.containers.filter((q) => q.area === a.id)) if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w[(c.y + dy) * m.w + c.x + dx])) err("reach", `${tag} ${c.label}`);
      if (g.length !== m.w * m.h) err("grid", tag);
    }
  }
  const label = { checkout: "every shop front has a checkout", signature: "every front its kind's pieces", range: "every restaurant's kitchen a range", oven: "a pizza place's pizza oven", walkin: "every restaurant a walk-in cold room of cold-room shelving", steel: "behind a steel door", motelbed: "every motel room a bed", motelbath: "every motel room its bathroom with a toilet", motelsafe: "the motel's front desk safe, locked", vault: "the bank's vault behind a locked vault door", atm: "the bank's ATM, a locked container", lanes: "a supermarket's checkout lanes", onpiece: "every container stands on its piece", reach: "every container searched from a cell its room's door reaches", walk: "every room's floor one walk (the aisles leave a 1-cell walk)", grid: "every floor's grid whole" };
  for (const [k, msg] of Object.entries(label)) check(!errs[k], `${msg} (${built} buildings)${errs[k] ? `: ${errs[k].length} bad, e.g. ${errs[k].slice(0, 3).join("; ")}` : ""}`);
  if (process.env.SHOPS_DEBUG) console.log(JSON.stringify(errs.signature || []));
  check(styled >= rooms * 0.85, `the rooms take their styles (${styled} of ${rooms})`);
  const want = ["laundry", "deposit", "teller", "office desk", "office cubicle", "office whiteboard", "office serverrack", "office secdesk", "office copier", "office fridge", "deli oven", "pharmacy counter", "pallet racks", "machine tools", "car lift", "saddle rack", "greenhouse", "jukebox", "fryer"];
  check(want.every((k) => seen[k]), `the rooms' pieces turn up (${want.map((k) => `${k} ${seen[k] || 0}`).join(", ")})`);
  // The same building the same layout (a saved site keeps its map); two of a kind laid out differently.
  const sig = (m) => grid(m, 0).map((c) => c.k).join(",");
  check(KEYS.every((k) => sig(make(k, 3)) === sig(make(k, 3))), "the same building lays out the same every visit");
  check(KEYS.filter((k) => sig(make(k, 3)) !== sig(make(k, 4))).length >= KEYS.length - 1, "two of a kind lay out differently");
  // Loot per kind: the old layout (legacy) against the new over 200 seeds, by the tables' value (as tools/interiortest.js).
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  const total = (key, legacy) => { let v = 0; for (let s = 0; s < 200; s++) { const m = make(key, s, legacy); for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type) v += value(boxLoot(a.type, c.kind)); } } return v / 200; };
  const off = [], rows = [];
  for (const key of KEYS) { const b = total(key, true), a = total(key, false), r = a / b - 1; rows.push(`${key} ${(r * 100).toFixed(0)}%`); if (Math.abs(r) > 0.1) off.push(`${key} ${a.toFixed(0)} against ${b.toFixed(0)}`); }
  check(!off.length, `every kind holds what it did within ±10% (200 seeds each: ${off.join("; ") || rows.join(", ")})`);
  // An older save: furnished the old way (none of the new pieces, no style's marks).
  const NEWK = new Set(["range", "fryer", "pizzaoven", "coldshelf", "jukebox", "pooltable", "clothesrack", "gunrack", "tank", "pottingbench", "palletrack", "tirerack", "compressor", "carlift", "machine", "forklift", "saddlerack", "cubicle", "whiteboard", "watercooler", "secdesk", "keyrack", "icemachine", "teller", "deposit", "atm", "stanchion", "checkout", "displaycase", "coldcase", "barcounter", "barstool", "desk", "filing", "bookshelf"]);
  let newer = 0;
  for (const key of KEYS) for (let s = 0; s < 3; s++) { const m = make(key, s, true, true); for (const F of m.floors || [{ cells: m.cells }]) for (const c of F.cells) if (NEWK.has(c.k)) newer++; if (m.rooms.some((a) => /Walk-in cold|ATM lobby|Safe-deposit|Pharmacy counter|Greenhouse/.test(a.name) && !/^Walk-in$/.test(a.name))) newer++; }
  check(!newer, `an older save's shops are furnished and planned the old way (${newer} new pieces or rooms)`);
  // Their signs of survival (interiorscenes.js registerScene): a motel room held, a stockroom shelter, a counter stand,
  // a walk-in hiding place; only on a map laid out by these styles.
  const SC = { motel: "motelhold", supermarket: "stockshelter", gunstore: "counterstand", liquor: "counterstand", restaurant: "walkin", diner: "walkin" };
  const got = {}, old = {};
  for (const [key, kind] of Object.entries(SC)) for (let s = 0; s < 40; s++) for (const legacy of [false, true]) {
    const S = rollScenes(make(key, s, legacy), new Rng(900 + s), key);
    if (S && S.list.some((x) => x.kind === kind)) (legacy ? old : got)[key] = ((legacy ? old : got)[key] || 0) + 1;
  }
  check(Object.keys(SC).every((k) => got[k] > 0) && !Object.keys(old).length, `their scenes turn up on the new layouts, none on an older save's (${Object.entries(SC).map(([k, v]) => `${k} ${v} ${got[k] || 0}`).join(", ")})`);
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
