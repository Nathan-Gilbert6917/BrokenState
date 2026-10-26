// Hotel variants, a dozen plans a kind (issue #38 of the interiors epic #7, the user's requests 2026-10-25: "every
// building should have several varients"; "for buildings with no to only a few varients create a dozen varients per
// building type"): data-hotels.js's variants laid out by hotellayout.js for the inn, the business hotel, the resort and
// the city tower.
// - distinct plans: each kind has 12+ distinct plans by #32's plan signature (the set of room roles, the role pairs with
//   a door between them, the entrance count, the footprint class) over its variants pinned and over the dice; 12+
//   names, 12+ distinct room lists; every variant in a chain of its kind, every chain's variants of its kind; the
//   setting weighs the dice
// - every variant, pinned, over several seeds: its storeys and footprint within its kind's row, every room and every
//   walkable cell reached, the lobby's desk, key rack and locked safe, guest rooms with beds and en suites,
//   housekeeping on every guest floor, two stair runs (an inn one), the laundry, the kitchen and its walk-in, its own
//   rooms (VARIANT_ROOMS), its grounds (a pool deck, courts, a corral), its name on the map and in the opening line
// - loot: each kind within ±10% of its classic plan's (#29's) a floor cell, each variant within ±25%
// - a hotel with a chain and no variant (one made before the variants) is its kind's classic plan, the same every time
// - the POI: its variant (hv) on dice of its own, its name with the variant's; the crawl place's; the scenes still roll
// Usage: node tools/hotelvarianttest.js [seed]
import { createWorld } from "../src/sim/world.js";
import { Rng } from "../src/sim/rng.js";
import { BUILDINGS, assemble, interiorIntro, buildingMap } from "../src/sim/buildingmaps.js";
import { HOTEL_VARIANTS, CLASSIC, hotelVariantsOf, hotelVariantById, hotelVariantFor } from "../src/sim/data-hotels.js";
import { HOTEL } from "../src/sim/hotellayout.js";
import { REAL_SIZE } from "../src/sim/data-buildingsize.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { hotelExtra, hotelSetting, hotelVariantOf } from "../src/sim/hotels.js";
import { poiName } from "../src/sim/pois.js";
import { poiPlace } from "../src/sim/poiraid.js";
import { placeOption } from "../src/sim/citycrawl.js";
import { CELL, AREAS, boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { hash01 } from "../src/sim/skills.js";

const QUICK = !!process.env.BS_QUICK;
const seed = Number(process.argv[2] || 5);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const MIN_PLANS = 12;
const t0 = performance.now();

const make = (o, s) => {
  const rng = new Rng(seed * 100003 + s * 7919);
  const spec = BUILDINGS.hotel.make(rng, o);
  const m = assemble(rng, spec, { key: "hotel", name: "Hotel", withVehicle: s % 2 === 1 });
  return { spec, m };
};
// #32's plan signature: the room roles, the pairs of roles with a door between them, the entrances, the footprint class.
function signature(spec, m) {
  const rooms = m.rooms.filter((a) => !a.outdoor);
  const roles = [...new Set(rooms.map((a) => a.role))].sort();
  const byDoor = new Map();
  for (const a of rooms) for (const d of a.doors || []) { const k = `${a.f || 0}:${d[0]},${d[1]}`; const l = byDoor.get(k) || []; l.push(a.role); byDoor.set(k, l); }
  const adj = new Set();
  for (const l of byDoor.values()) if (l.length >= 2) adj.add([...l].sort().join("-"));
  const ways = 1 + (m.exits || []).filter((e) => e.zone >= 0).length;
  return `${roles.join(",")}|${[...adj].sort().join(",")}|${ways}|${spec.foot}`;
}
// The room list: the rooms by name, their numbers off, as a set.
const roomList = (m) => [...new Set(m.rooms.filter((a) => !a.outdoor).map((a) => a.name.replace(/:.*$/, "").replace(/ \d+[A-Z]?$/, "")))].sort().join("|");
function walkFrom(m, sx, sy, cells) {
  const W = m.w, H = m.h, seen = new Uint8Array(W * H), q = [sy * W + sx];
  const pass = (c) => CELL[c.k].walk || c.k === "door";
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}

// ---------- 1. distinct plans ----------
section(`Distinct plans: each kind's variants pinned, and the dice (at least ${MIN_PLANS})`);
for (const kind of HOTEL.KINDS) {
  const vs = hotelVariantsOf(kind), sigs = new Set(), lists = new Set(), pinned = new Map();
  for (const v of vs) for (let s = 0; s < 3; s++) { const { spec, m } = make({ plan: v.id }, 100 + s); const g = signature(spec, m); sigs.add(g); lists.add(roomList(m)); if (!pinned.has(v.id)) pinned.set(v.id, g); }
  const own = new Set(pinned.values()).size;
  check(vs.length >= MIN_PLANS && new Set(vs.map((v) => v.name)).size === vs.length, `${kind}: ${vs.length} named variants (${vs.map((v) => v.name).join(", ")})`);
  check(own >= MIN_PLANS && sigs.size >= MIN_PLANS, `${kind}: ${own} distinct plans among the variants (${sigs.size} over 3 seeds each) by #32's signature`);
  check(lists.size >= MIN_PLANS, `${kind}: ${lists.size} distinct room lists`);
  // The dice: a chain's hotel picks its variants (60 seeds, the chains in turn, the settings in turn).
  const chains = FRANCHISES.hotel.filter((f) => f.plan.hotel === kind), drawn = new Map(), dsig = new Set();
  for (let s = 0; s < 60; s++) {
    const f = chains[s % chains.length], set = ["city", "suburb", "town", "scenic"][s % 4];
    const id = hotelVariantFor(kind, f.plan.variants, set, (s * 0.61803) % 1);
    drawn.set(id, (drawn.get(id) || 0) + 1);
    const { spec, m } = make({ variant: f.id, plan: id }, 300 + s);
    dsig.add(signature(spec, m));
  }
  check(drawn.size >= 10 && dsig.size >= 10, `${kind}: 60 hotels by the chains' dice draw ${drawn.size} variants, ${dsig.size} distinct plans`);
}
{
  // No chain, no variant (a sample hotel): a kind and a variant by the dice.
  const sigs = new Set(), names = new Set();
  for (let s = 0; s < 96; s++) { const { spec, m } = make({}, 500 + s); sigs.add(signature(spec, m)); names.add(spec.vname); }
  check(sigs.size >= 4 * MIN_PLANS && names.size >= 30, `a hotel with no chain: ${names.size} variants and ${sigs.size} distinct plans over 96 seeds`);
  // The chains: each variant in a chain of its kind; each chain's variants of its kind.
  const inChain = new Set(FRANCHISES.hotel.flatMap((f) => f.plan.variants || []));
  const orphans = HOTEL_VARIANTS.filter((v) => !inChain.has(v.id)).map((v) => v.id);
  const wrong = FRANCHISES.hotel.flatMap((f) => (f.plan.variants || []).filter((id) => !hotelVariantById(id) || hotelVariantById(id).kind !== f.plan.hotel).map((id) => `${f.id}:${id}`));
  check(!orphans.length && !wrong.length && FRANCHISES.hotel.every((f) => (f.plan.variants || []).length >= 5), `every variant in a chain of its kind, 5+ variants a chain (${FRANCHISES.hotel.map((f) => `${f.name} ${f.plan.variants.length}`).join(", ")})${orphans.length ? `; no chain: ${orphans.join(", ")}` : ""}${wrong.length ? `; wrong kind: ${wrong.join(", ")}` : ""}`);
  check(Object.values(CLASSIC).every((id) => hotelVariantById(id)), "each kind's classic plan (#29's) is one of its variants");
  // The setting weighs the dice.
  const count = (kind, set, id) => { let n = 0; for (let i = 0; i < 400; i++) if (hotelVariantFor(kind, null, set, (i + 0.5) / 400) === id) n++; return n; };
  const bc = count("business", "city", "biz-boutique"), bt = count("business", "town", "biz-boutique");
  const rr = count("resort", "suburb", "res-ranch"), rs = count("resort", "scenic", "res-ranch");
  check(bc > bt * 2 && rr === 0 && rs > 0, `the setting weighs the dice: a boutique hotel downtown ${bc} of 400 against ${bt} in a town; a dude ranch in the suburbs ${rr}, in scenic land ${rs}`);
}

// ---------- 2. every variant ----------
section("Every variant, pinned: reached, its rooms, its name");
// The rooms each variant has besides the hotel's own (their styles, the leaf's lay), and its grounds.
const VARIANT_ROOMS = {
  "inn-country": ["parlour", "breakfast", "ownersflat"], "inn-bnb": ["parlour", "library", "breakfast"], "inn-coaching": ["barroom", "winecellar", "boathouse", "ownersflat"],
  "inn-chalet": ["lodgehall", "bootroom", "spa", "beachstore"], "inn-lakeside": ["lodgehall", "boathouse", "hotelrestaurant"], "inn-mainstreet": ["giftshop", "barroom", "manager"],
  "inn-vineyard": ["tasting", "winecellar", "barrels"], "inn-boarding": ["parlour", "breakfast", "ownersflat"], "inn-fishing": ["giftshop", "lodgehall", "fishroom", "walkin"],
  "inn-hunting": ["lodgehall", "gunroom", "walkin"], "inn-seaside": ["sunroom", "beachstore"], "inn-hotspring": ["spa", "bootroom", "breakfast"],
  "biz-classic": ["hotelrestaurant", "conference", "bizcentre", "giftshop", "luggage", "liftlobby"], "biz-airport": ["hotelrestaurant", "parlour", "luggage"],
  "biz-conference": ["ballroom", "atrium", "conference", "loading"], "biz-extended": ["studio", "giftshop", "hotelgym", "breakfast"], "biz-allsuites": ["atrium", "suite", "barroom"],
  "biz-budget": ["breakfast", "icenook", "workshop"], "biz-boutique": ["gallery", "barroom", "hotelrestaurant"], "biz-convention": ["exhibit", "ballroom", "conference", "loading"],
  "biz-highway": ["indoorpool", "breakfast", "hotelgym"], "biz-medical": ["chemist", "parlour", "hotelrestaurant"], "biz-campus": ["giftshop", "conference", "bizcentre"],
  "biz-station": ["luggage", "hotelrestaurant", "ballroom", "library"],
  "res-classic": ["ballroom", "spa", "hotelgym", "hotelrestaurant", "barroom", "liftlobby"], "res-golf": ["giftshop", "barroom", "bootroom", "cartbarn"],
  "res-beach": ["giftshop", "barroom", "beachstore", "buffet", "spa"], "res-casino": ["casino", "cashier", "buffet", "showroom"], "res-spa": ["spa", "hotelgym", "barroom"],
  "res-mountain": ["skirental", "lodgehall", "bootroom", "barroom"], "res-waterpark": ["indoorpool", "arcade", "chemist"], "res-ranch": ["lodgehall", "buffet", "tackroom", "stable"],
  "res-cabins": ["lodgehall", "boathouse", "giftshop"], "res-family": ["kidsclub", "arcade", "buffet", "hotelgym"], "res-wellness": ["meditation", "spa", "yoga"],
  "res-wedding": ["chapel", "ballroom", "florist"],
  "tow-classic": ["penthouse", "barroom", "ballroom", "parking", "liftlobby", "hotelgym"], "tow-twin": ["atrium", "penthouse", "parking"], "tow-podium": ["giftshop", "buffet", "chemist", "barber"],
  "tow-atrium": ["atrium", "penthouse", "parking"], "tow-grand": ["barber", "library", "arcade", "spa", "ballroom"], "tow-core": ["penthouse", "barroom", "parking"],
  "tow-mixed": ["residence", "atrium", "parking"], "tow-capsule": ["pods", "parlour", "arcade"], "tow-casino": ["casino", "cashier", "buffet", "showroom"],
  "tow-convention": ["exhibit", "ballroom", "conference", "loading"], "tow-deco": ["gallery", "barroom", "library", "spa"], "tow-skylobby": ["atrium", "parking", "hotelrestaurant"],
};
const GROUNDS = { "res-classic": ["Pool deck", "Tennis court"], "res-family": ["Pool deck", "Tennis court"], "res-beach": ["Pool deck"], "res-ranch": ["Corral"], "res-golf": ["Pool deck"] };
const N = QUICK ? 3 : 6;
const GUEST = ["guestroom", "studio"];
for (const v of HOTEL_VARIANTS) {
  const errs = [], R = REAL_SIZE[`hotel${v.kind}`];
  let rooms0 = 0, storeys = [];
  for (let s = 0; s < N; s++) {
    let spec, m;
    try { ({ spec, m } = make({ plan: v.id }, 1000 + s)); } catch (e) { errs.push(`seed ${s}: ${e.message}`); continue; }
    const tag = `seed ${s}`;
    storeys.push(m.storeys);
    if (spec.vid !== v.id || m.plan.variant !== v.name || spec.hotel !== v.kind) errs.push(`${tag}: name ${m.plan.variant}`);
    if (spec.bw < R.w[0] || spec.bw > R.w[1] || spec.bh < R.d[0] || spec.bh > R.d[1] || m.storeys < R.storeys[0] || m.storeys > Math.min(R.storeys[1], 10)) errs.push(`${tag}: ${spec.bw}x${spec.bh}, ${m.storeys} storeys out of its row`);
    if (m.w > 200 || m.h > 200) errs.push(`${tag}: map ${m.w}x${m.h}`);
    const grids = m.floors || [{ cells: m.cells }];
    const at = (f, x, y) => grids[f].cells[y * m.w + x];
    const inside = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push(at(a.f || 0, x, y).k); return out; };
    const rooms = m.rooms.filter((a) => !a.outdoor), shop = (k) => rooms.filter((a) => a.shop === k);
    rooms0 += rooms.length;
    // Reached: from the front zone on the ground floor, from the stairs upstairs; every room and every walkable cell.
    const z0 = m.zones[0];
    const reach = grids.map((F, f) => (f === 0 ? walkFrom(m, z0.x0 + 1, z0.y0 + 1, F.cells) : walkFrom(m, m.stairs[0][0], m.stairs[0][1], F.cells)));
    for (const r of rooms) {
      let any = false;
      for (let y = r.y0 + 1; y < r.y0 + r.h - 1 && !any; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (reach[r.f || 0][y * m.w + x]) { any = true; break; }
      if (!any) errs.push(`${tag}: ${r.name} (floor ${r.f || 0}) not reached`);
    }
    grids.forEach((F, f) => { let cut = 0; for (let i = 0; i < m.w * m.h; i++) if ((CELL[F.cells[i].k].walk || F.cells[i].k === "door") && !reach[f][i]) cut++; if (cut) errs.push(`${tag}: floor ${f}: ${cut} cells cut off`); });
    if (rooms.some((a) => !a.shop && !["corridor", "stairwell"].includes(a.role))) errs.push(`${tag}: unstyled ${rooms.filter((a) => !a.shop && !["corridor", "stairwell"].includes(a.role)).map((a) => a.name).slice(0, 3).join(", ")}`);
    // The hotel's own: the lobby (its desk, key rack and locked safe), guest rooms with beds and en suites,
    // housekeeping a guest floor, the laundry, the kitchen (and the walk-in), the stair runs.
    const lobby = shop("hotellobby").find((a) => (a.f || 0) === 0);
    if (!lobby || !inside(lobby).includes("frontdesk") || !inside(lobby).includes("keyrack")) errs.push(`${tag}: no reception desk and key rack on the ground floor`);
    else if (!m.containers.some((c) => c.area === lobby.id && c.kind === "safe" && c.lockKind)) errs.push(`${tag}: no locked safe at the front desk`);
    const guest = rooms.filter((a) => GUEST.includes(a.shop));
    if (guest.length < 1) errs.push(`${tag}: no guest rooms`);
    for (const r of guest) {
      if (!inside(r).includes("bed")) errs.push(`${tag}: ${r.name} has no bed`);
      const bath = rooms.find((a) => a.shop === "ensuite" && a.unit && a.unit === r.unit);
      if (!bath) { errs.push(`${tag}: ${r.name} has no en suite`); continue; }
      const k = inside(bath);
      if (!k.includes("toilet") || !k.includes("sink") || !(k.includes("bathtub") || k.includes("shower"))) errs.push(`${tag}: ${bath.name} lacks a toilet, a sink or a tub`);
    }
    if (shop("studio").some((r) => !inside(r).includes("stove"))) errs.push(`${tag}: a studio without its kitchenette`);
    for (const f of new Set(guest.map((r) => r.f || 0))) if (!shop("housekeeping").some((a) => (a.f || 0) === f && inside(a).includes("linencart"))) errs.push(`${tag}: floor ${f} has no housekeeping`);
    if (v.kind === "inn" && (guest.length < 10 || guest.length > 20)) errs.push(`${tag}: ${guest.length} rooms`);
    if (v.kind !== "inn" && (m.runs || []).filter((r) => !r.single).length < 2) errs.push(`${tag}: ${(m.runs || []).length} stair runs`);
    if (!shop("hotellaundry").some((a) => inside(a).includes("washer") && inside(a).includes("dryer"))) errs.push(`${tag}: no laundry`);
    if (!shop("galley").some((a) => inside(a).includes("range"))) errs.push(`${tag}: no kitchen with its range`);
    if (v.kind !== "inn" && !shop("walkin").length) errs.push(`${tag}: no walk-in`);
    if (v.kind === "tower" && !shop("penthouse").some((a) => (a.f || 0) === m.storeys - 1)) errs.push(`${tag}: no penthouse on the top floor`);
    if (shop("liftlobby").length && !shop("liftlobby").every((a) => inside(a).includes("liftdoor"))) errs.push(`${tag}: a lift lobby with no lift doors`);
    for (const k of VARIANT_ROOMS[v.id] || ["?"]) if (!shop(k).length) errs.push(`${tag}: no ${k}`);
    for (const n of GROUNDS[v.id] || []) if (!m.rooms.some((a) => a.outdoor && a.name === n)) errs.push(`${tag}: no ${n} in the grounds`);
    if (!interiorIntro({ raid: { interior: true, plan: m.plan, storeys: m.storeys, runs: m.runs, stairs: m.stairs, areas: m.rooms } }).startsWith(`${v.name}.`)) errs.push(`${tag}: the opening line`);
  }
  check(!errs.length, `${v.kind} ${v.name}: ${N} built, ${Math.min(...storeys)}–${Math.max(...storeys)} storeys, ${Math.round(rooms0 / N)} rooms, all reached, with ${(VARIANT_ROOMS[v.id] || []).join(", ")}${errs.length ? ` (${[...new Set(errs)].slice(0, 4).join("; ")})` : ""}`);
}

// ---------- 3. loot ----------
section("Loot a floor cell (the footprint × the storeys) against each kind's classic plan (#29's)");
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
const lootOf = (m) => { let v = 0; for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type && AREAS[a.type]) v += value(boxLoot(a.type, c.kind)); } return v; };
const LS = QUICK ? 6 : 16;
for (const kind of HOTEL.KINDS) {
  const per = [];
  for (const v of hotelVariantsOf(kind)) {
    let w = 0, a = 0;
    for (let s = 0; s < LS; s++) { const { spec, m } = make({ plan: v.id }, 3000 + s); w += lootOf(m); a += spec.bw * spec.bh * m.storeys; }
    per.push([v, (w / a) * 100]);
  }
  const base = per.find(([v]) => v.id === CLASSIC[kind])[1], avg = per.reduce((t, [, d]) => t + d, 0) / per.length, r = avg / base;
  const off = per.filter(([, d]) => d / base < 0.75 || d / base > 1.25);
  console.log(`  ${kind}: the classic plan ${base.toFixed(1)} a 100 cells; the variants' ${avg.toFixed(1)} (×${r.toFixed(3)}): ${per.map(([v, d]) => `${v.id.split("-")[1]} ×${(d / base).toFixed(2)}`).join(", ")}`);
  check(r >= 0.9 && r <= 1.1, `${kind}: the variants' loot a floor cell within ±10% of the classic plan's (×${r.toFixed(3)})`);
  check(!off.length, `${kind}: every variant within ±25% of it${off.length ? ` (${off.map(([v, d]) => `${v.name} ×${(d / base).toFixed(2)}`).join(", ")})` : ""}`);
}

// ---------- 4. a hotel made before the variants ----------
section("A hotel with a chain and no variant (made before the variants): its kind's classic plan");
for (const f of FRANCHISES.hotel) {
  const a = make({ variant: f.id }, 4000), b = make({ variant: f.id }, 4000), c = make({ variant: f.id, plan: CLASSIC[f.plan.hotel] }, 4000);
  const same = JSON.stringify(a.m.cells) === JSON.stringify(b.m.cells) && JSON.stringify(a.m.containers) === JSON.stringify(b.m.containers);
  const classic = a.spec.vid === CLASSIC[f.plan.hotel] && JSON.stringify(a.m.cells) === JSON.stringify(c.m.cells);
  check(same && classic, `${f.name}: ${a.spec.vname}, the same every time`);
}

// ---------- 5. the POI, the crawl, the scenes ----------
section("The POI's variant and name, the crawl's, the scenes");
{
  const worlds = [1, 2, 3].map((s) => createWorld({ seed: 700 + s, factionCount: 4 }));
  let made = 0, named = 0, mapped = 0, ofChain = 0;
  const seen = new Set();
  for (const st of worlds) for (const t of st.tiles) for (const [i, p] of (t.pois || []).entries()) {
    if (p.kind !== "hotel") continue;
    made++;
    seen.add(p.hv);
    const f = FRANCHISES.hotel.find((x) => x.id === p.v);
    if (f && f.plan.variants.includes(p.hv)) ofChain++;
    if (poiName(t, i) === `${f ? f.name : "?"} (${hotelVariantById(p.hv) ? hotelVariantById(p.hv).name : "?"})`) named++;
    const pl = poiPlace(t, i);
    if (pl && pl.plan === p.hv && pl.variant === p.v) mapped++;
  }
  check(made > 0 && ofChain === made && named === made && mapped === made, `the worlds' ${made} hotels: each a variant of its chain (${seen.size} variants), its name with the variant's, its raid the variant`);
  // A hotel POI's dice: hotelExtra's variant is the chain's by the setting, and everything else on the POI is as it was.
  const st = worlds[0], t = st.tiles.find((x) => (x.pois || []).some((p) => p.kind === "hotel"));
  if (t) {
    const i = t.pois.findIndex((p) => p.kind === "hotel"), p = t.pois[i];
    const again = hotelExtra(st, t, t.pois.slice(0, i), true);
    check(!!again && again.v === p.v && again.hv === p.hv && p.hv === hotelVariantOf(p.v, hotelSetting(st, t), hash01(st.seed, "hotelvar", t.id)), `a POI's variant from dice of its own, its chain's by the setting (${poiName(t, i)})`);
    const m = buildingMap(st, t.id, poiPlace(t, i), false);
    check(m.plan.variant === hotelVariantById(p.hv).name, `its map is its variant's (${m.plan.variant}, ${m.w} × ${m.h})`);
  }
  // The crawl: a place's variant goes to its building (citycrawl.js placeOption), its chain's.
  const place = { id: "1,1p3", slot: 3, key: "hotel", name: "Hotel", v: "caldergrand", hv: hotelVariantOf("caldergrand", "city", 0.4) };
  const opt = placeOption({ tile: 0, block: 3, buildings: {} }, place, 3);
  check(opt.plan === place.hv && opt.variant === "caldergrand" && FRANCHISES.hotel.find((x) => x.id === "caldergrand").plan.variants.includes(place.hv), `a crawl hotel's variant goes to its building (${hotelVariantById(place.hv).name})`);
  check(!placeOption({ tile: 0, block: 3, buildings: { "1,1p3": { v: "harborview" } } }, place, 3).plan, "a crawl building kept with another chain keeps its own plan (no variant)");
  // The scenes still turn up over the variants.
  const sw = createWorld({ seed: 13, factionCount: 2 }), tiles = sw.tiles.filter((x) => x.loc).slice(0, 4), kinds = new Set();
  for (let i = 0; i < 48; i++) {
    const v = HOTEL_VARIANTS[i % HOTEL_VARIANTS.length];
    const f = FRANCHISES.hotel.find((x) => x.plan.hotel === v.kind);
    const m = buildingMap(sw, tiles[i % tiles.length].id, { key: "hotel", id: `hv-${i}`, name: "Hotel", variant: f.id, plan: v.id }, false);
    for (const sc of (m.scenes && m.scenes.list) || []) kinds.add(sc.kind);
  }
  check(["hotelbarricade", "lobbyoverrun"].every((k) => kinds.has(k)), `the hotels' scenes over the 48 variants (${[...kinds].join(", ")})`);
}

console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(fails ? 1 : 0);
