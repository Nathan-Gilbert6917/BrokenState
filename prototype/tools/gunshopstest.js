// Gun stores and pawn shops (src/sim/gunshops.js, shopshelves.js; the user's request 2026-10-21): the pawn shop is a
// site type with its tables, both shops stand as points of interest on the suburbs and the city blocks and on the
// blocks of the city and town crawls (their own dice: the places and lists before them unchanged), and their shelves,
// counters and cases turn up guns, rigs and survival gear more often than the town's other places.
// - the pawn shop: a LOCATIONS type with theme tags, a raid area set (its counter and a gun case), a building, a map
//   size and rows in the rigs, survival gear, extra guns, blades and small finds tables; gearRate on both shops
// - the crawl: a city's and a town's blocks hold gun stores and pawn shops besides their places (rare, on the card),
//   never a second of a kind, never past the block's most; the places before them are the same as without the shop
// - a shop POI's shelves: its own rigs, magazines, survival gear and guns by the search hour (nothing for another kind,
//   nothing extra for the tile's own site); a pawn shop and a gun store find rigs and guns far more often than a town
// - a search on a pawn shop POI runs hour by hour and the raid map's rooms are the shop's
// - the hardware store (the user's request 2026-10-21: "add hardware store that has increased spawn of materials needed
//   for building and crafting"): a POI and a crawl place like the others; its aisles (a raid area of their own) hold
//   building materials, lumber, scrap and parts; its search hour finds more of them than before, and as a POI its own
// Usage: node tools/gunshopstest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { LOCATIONS, GEAR } from "../src/sim/data.js";
import { SITE_TAGS, AREA_TAGS } from "../src/sim/loot.js";
import { AREA_SETS, AREAS, WEAPONS } from "../src/sim/combat.js";
import { SITES, BUILDINGS, buildingHint } from "../src/sim/buildingmaps.js";
import { SIZES } from "../src/sim/battlesize.js";
import { SITE_KIT, AREA_KIT } from "../src/sim/carrykit.js";
import { SURV_FINDS, AREA_SURV } from "../src/sim/data-survival.js";
import { ARSENAL_FINDS } from "../src/sim/data-guns.js";
import { Rng } from "../src/sim/rng.js";
import { launchExpedition } from "../src/sim/parties.js";
import { startScavenge, searchHour } from "../src/sim/scavenge.js";
import * as CC from "../src/sim/citycrawl.js";
import { cellsOf, keyOf } from "../src/sim/citygrid.js";
import { SHOP, SHOP_KINDS, shopPlace } from "../src/sim/gunshops.js";
import { rollShopShelves, rollShopSupplies } from "../src/sim/shopshelves.js";
import { BUILDMAT_FINDS, SITE_WOOD } from "../src/sim/loot.js";
import { rollArea } from "../src/sim/citycrawl.js";
import { setPoiReveal } from "../src/sim/pois.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 7 }); st.started = true; st.cards.length = 0; return st; };
const RIGS = new Set(["chestrig", "tacvest", "makeshiftrig", "legrig"]);
const SURV = new Set(Object.values(SURV_FINDS).flatMap((r) => Object.keys(r.items)));
const isGun = (k) => !!(WEAPONS[k] && !WEAPONS[k].melee);

// ---------- 1. the pawn shop and its tables ----------
section("The pawn shop: a site type with its tables");
{
  const d = LOCATIONS.pawnshop;
  check(!!d && d.richness > 0 && d.gear.every((g) => GEAR[g]), "a LOCATIONS type with richness and known gear");
  check(d.gear.filter(isGun).length >= 8 && ["hikingpack", "waterfilter", "stove", "headlamp", "handradio"].every((k) => d.gear.includes(k)), "its gear: handguns and hunting guns, packs, a filter, a stove, a lamp, a radio");
  check(!!SITE_TAGS.pawnshop && !!AREA_TAGS.pawnshop && SITES.pawnshop && BUILDINGS.pawnshop && SIZES.SITE.pawnshop != null, "theme tags, a building, a map size");
  check(AREA_SETS.pawnshop.includes("pawnshop") && AREA_SETS.pawnshop.includes("gunshop") && AREAS.pawnshop.gear.some(([k]) => isGun(k)), "a raid's areas: its counter (with guns) and a gun case");
  const holds = buildingHint("pawnshop").holds;
  check(holds.includes("pawnshop") && holds.includes("gunshop"), `the building's rooms are its counter and its gun case (${holds.join(", ")})`);
  const b = BUILDINGS.pawnshop.make(new Rng(1));
  check(!!b && b.bw > 0 && b.bh > 0, "the building lays out");
  check(SITE_KIT.pawnshop && AREA_KIT.pawnshop && SURV_FINDS.pawnshop && AREA_SURV.pawnshop && ARSENAL_FINDS.site.pawnshop > 0 && ARSENAL_FINDS.area.pawnshop > 0, "rows in the rigs, survival gear and extra-gun tables");
  check(Object.keys(SITE_KIT.pawnshop.items).some((k) => RIGS.has(k)) && Object.keys(SURV_FINDS.pawnshop.items).some((k) => RIGS.has(k)), "rigs among them");
  check(LOCATIONS.gunstore.gearRate > 1 && LOCATIONS.pawnshop.gearRate > 1, `the shops' gear roll × ${LOCATIONS.gunstore.gearRate} and × ${LOCATIONS.pawnshop.gearRate}`);
  const rigShare = (row) => Object.entries(row.items).filter(([k]) => RIGS.has(k)).reduce((a, [, w]) => a + w, 0) / Object.values(row.items).reduce((a, w) => a + w, 0);
  check(rigShare(SITE_KIT.gunstore) * SITE_KIT.gunstore.p > 0.01 && SURV_FINDS.gunstore.p >= 0.1, `a gun store's rigs: ${(100 * rigShare(SITE_KIT.gunstore) * SITE_KIT.gunstore.p).toFixed(1)}% a search hour from its kit roll, survival gear ${SURV_FINDS.gunstore.p}`);
}

// ---------- 2. the crawl ----------
section("The city and town crawls: shops on the blocks");
{
  const byKind = { city: {}, town: {} };
  let twice = 0, over = 0, notRare = 0, same = 0, cmp = 0, slots = 0;
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
        // The same block with no shops on the dice: the places before the shop, as the block's own dice make them.
        const c2 = { ...c, blocks: {} };
        const saved = SHOP.CRAWL;
        SHOP.CRAWL = {};
        const b2 = CC.genBlock(st, c2, key);
        SHOP.CRAWL = saved;
        const shops = blk.places.length === b2.places.length + 1 ? [blk.places[blk.places.length - 1]] : [];
        for (const pl of shops) {
          byKind[type][pl.key] = (byKind[type][pl.key] || 0) + 1;
          if (!!pl.rare !== !!SHOP.PLACE[pl.key].rare || !SHOP_KINDS.includes(pl.key)) notRare++;
          if (pl.slot !== blk.places.length - 1 || pl.id !== `${key}p${pl.slot}`) slots++;
        }
        if (blk.places.length > CC.CRAWL.PLACES[1]) over++;
        const keys = blk.places.map((pl) => pl.key);
        if (new Set(keys).size !== keys.length) twice++;
        cmp++;
        if (JSON.stringify(b2.places.map((pl) => [pl.key, pl.name, pl.raiders, pl.dead])) === JSON.stringify(blk.places.slice(0, b2.places.length).map((pl) => [pl.key, pl.name, pl.raiders, pl.dead]))) same++;
      }
    }
  }
  const say = (o) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  console.log(`  3 seeds: city ${say(byKind.city)}; town ${say(byKind.town)}`);
  check((byKind.city.pawnshop || 0) > 0 && (byKind.city.gunstore || 0) > 0, `city crawls hold pawn shops and gun stores (${say(byKind.city)})`);
  check((byKind.town.pawnshop || 0) + (byKind.town.gunstore || 0) > 0, `town crawls hold them too (${say(byKind.town)})`);
  check(!notRare && !slots, `a gun store and a pawn shop shown as finds on the card, in the next slot (${notRare} wrong, ${slots} off)`);
  check(!over && !twice, `never past the block's most, never two of a kind (${over} over, ${twice} twice)`);
  check(cmp > 0 && same === cmp, `every block's places before a shop are as they were (${same} of ${cmp} blocks)`);
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

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
