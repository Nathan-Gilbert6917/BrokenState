// Restaurants by kind of food, format and size (src/sim/eaterylayout.js, data-eateries.js; the user's request
// 2026-10-25, issue #33: "there should be a few dozen varients, sizes layout and kind of food for resauraunts"). Checks:
//   the table: at least 30 distinct cuisine × format × size combinations, built over the seeds from the franchises the
//   places draw (shops.js franchiseFor) and from the table itself; every variant's building has its size's footprint;
//   each its cuisine's signature cooking pieces (a tandoor in an Indian place, wok ranges in a Chinese one, a sushi
//   conveyor in a sushi place, deck ovens in a pizza place, smokers at a BBQ...); its format's front of house (a
//   drive-through window and its lane at fast food, a host stand at a sit-down, a counter with stools at a diner, the
//   bar's taps at a pub, an espresso bar at a café, a till at every counter); a kitchen with a range and the dish pit's
//   dish machine, a walk-in cold room behind a steel door; everything one walk (every room's floor and every container
//   reached from the street); the loot by cuisine (the rooms' mix, the mixes' signature foods); loot per area within
//   ±10% of the old restaurants'; the same building the same layout, two variants laid out differently; an older save
//   the old plan; booths in the place's colour; eateryVariant for #29 and #30; the scenes (a drive-through line, a
//   barricaded dining room, a kitchen fire, a last meal, the walk-in freezer) on the new layouts only.
// Usage: node tools/restauranttest.js
import "../src/sim/world.js"; // the modules' load order (as the game's)
import { BUILDINGS, assemble } from "../src/sim/buildingmaps.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { franchiseFor } from "../src/sim/shops.js";
import { CELL, boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { MIXES } from "../src/sim/foods.js";
import { rollScenes } from "../src/sim/interiorscenes.js";
import { VARIANTS, CUISINES, EAT_SIZE, SITDOWN, COUNTER } from "../src/sim/data-eateries.js";
import { eateryVariant, eateryCombos, EATERY } from "../src/sim/eaterylayout.js";
import { Rng } from "../src/sim/rng.js";

let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const QUICK = !!process.env.BS_QUICK;
const FOOD = ["restaurant", "pizza", "diner", "bar"];
const keyOf = (v) => (v.kind === "pizza" ? "pizza" : v.kind);
const make = (key, id, s, legacy = false) => { const rng = new Rng(7700 + s * 104729 + key.length); const spec = BUILDINGS[key].make(rng, { variant: id, legacy }); return { spec, m: assemble(rng, spec, { key, name: key, legacy }) }; };
const all = (m) => { const out = []; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) out.push([x, y, m.cells[y * m.w + x]]); return out; };
const inside = (m, a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y, m.cells[y * m.w + x]]); return out; };
const kinds = (m, a) => new Set((a ? inside(m, a) : all(m)).map(([, , c]) => c.k));
const walkable = (c) => CELL[c.k] && (CELL[c.k].walk || c.k === "door");

// ---------- 1. the table ----------
section("The variant table: cuisine × format × size");
{
  const combos = eateryCombos();
  check(combos.length >= 30, `at least 30 distinct cuisine × format × size combinations in the table (${combos.length}, ${VARIANTS.length} variants)`);
  check(new Set(VARIANTS.map((v) => v.cuisine)).size === Object.keys(CUISINES).length, `every cuisine has a place (${new Set(VARIANTS.map((v) => v.cuisine)).size} of ${Object.keys(CUISINES).length})`);
  check(new Set(VARIANTS.map((v) => v.format)).size === 11 && new Set(VARIANTS.map((v) => v.size)).size === 5, "every format (11) and every size (5) has a place");
  check(FOOD.reduce((n, k) => n + FRANCHISES[k].length, 0) >= 77 && FOOD.every((k) => FRANCHISES[k].every((f) => f.eat && CUISINES[f.eat.cuisine])), `the four food kinds' franchises, every one a variant (${FOOD.map((k) => `${k} ${FRANCHISES[k].length}`).join(", ")})`);
  const ids = VARIANTS.map((v) => `${v.kind}:${v.id}`), names = VARIANTS.map((v) => v.name);
  check(new Set(ids).size === ids.length && new Set(names).size === names.length, "no two variants share an id or a name");
  // Built over the seeds: the franchises the places draw, by setting.
  const seen = new Set();
  const N = QUICK ? 120 : 400;
  for (let s = 0; s < N; s++) for (const key of FOOD) for (const set of ["city", "suburb", "town"]) {
    const id = franchiseFor(key, set, ((s * 7919 + key.length * 104729 + set.length * 31) % 10007) / 10007);
    const f = FRANCHISES[key].find((x) => x.id === id);
    if (f && f.eat) seen.add(`${f.eat.cuisine}|${f.eat.format}|${f.eat.size}`);
  }
  check(seen.size >= 30, `at least 30 distinct combinations drawn by the places over the seeds (${seen.size})`);
}

// ---------- 2. every variant's building ----------
section("Every variant laid out: its cuisine's line, its format's front, a kitchen, a walk-in and a dish pit, one walk");
const errs = {}, stat = { built: 0 };
const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
const built = [];
{
  const S = QUICK ? 2 : 5;
  const FRONT = {
    fastfood: ["drivewindow", "checkout", "menuboard"], fastcasual: ["checkout", "steamtable|coldcase"], cafe: ["espresso", "pastrycase", "checkout"], diner: ["barcounter", "barstool", "pastrycase", "checkout"],
    family: ["hoststand", "checkout"], fine: ["hoststand", "clothtable", "barcounter", "winerack"], buffet: ["hoststand", "steamtable", "saladbar"], pub: ["barcounter", "barstool", "beertower"],
    kiosk: ["checkout"], ghost: ["checkout"], banquet: ["hoststand", "stage"],
  };
  for (const v of VARIANTS) for (let s = 0; s < S; s++) {
    const key = keyOf(v), { spec, m } = make(key, v.id, s), tag = `${v.id} ${s}`;
    stat.built++;
    built.push({ v, m, spec });
    const R = m.rooms.filter((a) => !a.outdoor), K = kinds(m);
    if (!spec.eat || spec.eat.id !== v.id) err("variant", tag);
    // the footprint by size
    const Z = EAT_SIZE[v.size], b = m.building;
    if (b.w < Z.w[0] || b.w > Z.w[1] || b.h < Z.h[0] || b.h > Z.h[1]) err("size", `${tag} ${b.w}×${b.h}`);
    for (const k of CUISINES[v.cuisine].sig) if (!K.has(k)) err("sig", `${tag}: no ${k}`);
    for (const k of FRONT[v.format]) if (!k.split("|").some((q) => K.has(q))) err("front", `${tag}: no ${k}`);
    if (v.format === "fastfood" && !m.rooms.some((a) => a.outdoor && a.drive)) err("lane", tag);
    if (v.format === "fastfood" && m.building.w >= 16 && !K.has("playplace")) stat.noplay = (stat.noplay || 0) + 1;
    if (v.brew && !K.has("brewtank")) err("brew", tag);
    const kit = R.filter((a) => a.role === "kitchen");
    if (!kit.length || !kit.some((a) => kinds(m, a).has("range"))) err("kitchen", tag);
    if (!kit.some((a) => kinds(m, a).has("dishpit"))) err("dishpit", tag);
    const cold = R.find((a) => /^Walk-in cold room/.test(a.name));
    if (!cold || !kinds(m, cold).has("coldshelf")) err("walkin", tag);
    else if (!cold.doors.some(([x, y]) => m.cells[y * m.w + x].dk === "steel")) err("steel", tag);
    if (!R.some((a) => a.role === "office" && kinds(m, a).has("safe")) && R.some((a) => a.role === "office")) err("safe", tag);
    // One walk: every walkable cell of the map from the first exit, every container from a cell beside it.
    const seen = new Uint8Array(m.w * m.h), start = m.cells.findIndex((c, i) => walkable(c) && (i % m.w === 0 || i < m.w));
    const q = [start]; seen[start] = 1;
    while (q.length) { const i = q.pop(), x = i % m.w, y = (i / m.w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue; const j = ny * m.w + nx; if (!seen[j] && walkable(m.cells[j])) { seen[j] = 1; q.push(j); } } }
    const cut = m.cells.findIndex((c, i) => walkable(c) && !seen[i]);
    if (cut >= 0) err("walk", `${tag} at ${cut % m.w},${(cut / m.w) | 0} (${m.cells[cut].k})`);
    for (const c of m.containers) {
      let ok = false;
      for (let y = c.y - 1; y <= c.y + (c.h || 1); y++) for (let x = c.x - 1; x <= c.x + (c.w || 1); x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h && seen[y * m.w + x]) ok = true;
      if (!ok) err("reach", `${tag} ${c.label}`);
    }
    // the cuisine's food in its rooms
    if (!R.filter((a) => a.type === "kitchen").every((a) => a.mix === `eat:${v.cuisine}`)) err("mix", tag);
    // booths in the place's colour
    if (K.has("booth") && !m.cells.some((c) => c.k === "booth" && c.tint)) err("tint", tag);
  }
  const label = {
    variant: "each building is its variant", size: "each footprint its size's (EAT_SIZE)", sig: "each its cuisine's signature pieces (a tandoor, wok ranges, a sushi conveyor, deck ovens, smokers...)",
    front: "each its format's front of house (a drive-through window at fast food, a host stand at a sit-down...)", lane: "every fast-food place a drive-through lane outside", brew: "every brewpub its brewing tanks",
    kitchen: "every kitchen a range", dishpit: "every kitchen the dish pit's dish machine", walkin: "every place a walk-in cold room of cold-room shelving", steel: "behind a steel door",
    safe: "the manager's office its safe", walk: "every walkable cell one walk from the street", reach: "every container reached", mix: "the kitchens and walk-ins hold the cuisine's food (eat:<cuisine>)", tint: "the booths in the place's colour",
  };
  for (const [k, msg] of Object.entries(label)) check(!errs[k], `${msg} (${stat.built} buildings)${errs[k] ? `: ${errs[k].length} bad, e.g. ${errs[k].slice(0, 4).join("; ")}` : ""}`);
  check(!stat.noplay || stat.noplay < VARIANTS.filter((v) => v.format === "fastfood").length * S * 0.5, `most medium and large fast-food places have a play area (${stat.noplay || 0} without)`);
  const sig = (m) => m.cells.map((c) => c.k).join(",");
  const a = make("restaurant", "taj palace" && "tajpalace", 3).m, a2 = make("restaurant", "tajpalace", 3).m;
  check(sig(a) === sig(a2), "the same building lays out the same every visit");
  // Every variant its own plan, at least a dozen a kind (the user's request 2026-10-25: "a dozen varients per building
  // type"; #32's varianttest MIN_PLANS): pizza places, diners and bars too.
  const plans = FOOD.map((k) => { const vs = VARIANTS.filter((v) => v.kind === k); return [k, vs.length, new Set(vs.map((v) => sig(make(keyOf(v), v.id, 1).m))).size]; });
  check(plans.every(([, n, d]) => n === d && d >= 12), `every variant lays out its own way, a dozen plans or more a kind (${plans.map(([k, n, d]) => `${k} ${d} of ${n}`).join(", ")})`);
}

// ---------- 3. loot ----------
section("Loot: by cuisine, and per area as the old restaurants");
{
  const want = { pizza: ["f_flour", "f_cheese"], mexican: ["f_drybeans", "f_rice"], chinese: ["f_rice"], japanese: ["f_rice"], indian: ["f_rice", "f_drybeans"], italian: ["f_pasta"], steak: ["f_frozenmeat"], burgers: ["f_frozenmeat", "f_potatoes"], chicken: ["f_frozenmeat", "f_potatoes"], coffee: ["f_sugar", "f_flour"], noodles: ["f_pasta"], bbq: ["f_frozenmeat"] };
  check(Object.entries(want).every(([c, ks]) => MIXES[`eat:${c}`] && ks.every((k) => MIXES[`eat:${c}`][k] > 0)) && Object.keys(CUISINES).every((c) => MIXES[`eat:${c}`] && MIXES[`eat:${c}:keeps`]), "every cuisine's food mix and its keeps (a pizza place flour and cheese, a Mexican one beans and rice, a Chinese one rice, a steakhouse meat...)");
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  const perArea = (m) => { let v = 0, area = 0; for (const a of m.rooms.filter((r) => !r.outdoor)) area += (a.w - 2) * (a.h - 2); for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type && !a.outdoor) v += value(boxLoot(a.type, c.kind)); } return [v, area]; };
  const N = QUICK ? 60 : 200, rows = [], off = [];
  let oldV = 0, oldA = 0, newV = 0, newA = 0;
  for (const key of FOOD) {
    let ov = 0, oa = 0, nv = 0, na = 0;
    const fr = FRANCHISES[key];
    for (let s = 0; s < N; s++) {
      const id = fr[s % fr.length].id;
      const old = make(key, ["burgerbarn", "cluckshack", "tacorio", "goldenwok", "bigsky", "smokypete", "beanthere", "substation", "noodlehouse", "sals", "tonys", "pizzapalace", "sliceheaven", "brickoven", "piehole", "starlite", "route9", "lous", "silverspoon", "waffleshack", "rustynail", "roadhouse61", "omalleys", "velvetlounge", "touchdown", "lastcall", "neonmoose"].includes(id) ? id : fr[s % 5].id, s, true).m;
      const [a, b] = perArea(old); ov += a; oa += b;
      const [c, d] = perArea(make(key, id, s).m); nv += c; na += d;
    }
    const r = nv / na / (ov / oa) - 1;
    rows.push(`${key} ${(r * 100).toFixed(0)}% (${(nv / na).toFixed(2)} a cell against ${(ov / oa).toFixed(2)})`);
    if (Math.abs(r) > 0.1) off.push(key);
    oldV += ov; oldA += oa; newV += nv; newA += na;
  }
  const r = newV / newA / (oldV / oldA) - 1;
  console.log(`  loot per area: ${rows.join("; ")}; all ${(r * 100).toFixed(0)}%`);
  check(!off.length, `each food kind holds what the old restaurants did per area within ±10% (${rows.join("; ")})`);
  // the biggest hold the most
  const tot = (v) => { const { m } = make(keyOf(v), v.id, 2); return m.containers.length; };
  check(tot(VARIANTS.find((v) => v.id === "emperorsbuffet")) > 3 * tot(VARIANTS.find((v) => v.id === "topdog")), "a buffet palace holds far more than a hot dog kiosk");
  // A BBQ's pit room propane, a food truck's.
  const truck = built.find((b) => b.v.id === "elcamion" && b.m.containers.some((c) => c.kind === "foodtruck"));
  check(!!truck && boxLoot("kitchen", "foodtruck").loot.propane, "a food truck parked at its commissary, its propane");
  check(built.some((b) => b.v.cuisine === "bbq" && b.m.rooms.some((a) => a.type === "pitroom")), "a BBQ's pit room (propane: appliances.js AREA_PROPANE)");
}

// ---------- 4. older saves, the API, the scenes ----------
section("Older saves, eateryVariant for #29 and #30, the scenes");
{
  const NEW = new Set(["flattop", "deckoven", "wokrange", "tandoor", "dishpit", "hoststand", "menuboard", "drivewindow", "steamtable", "dryshelf"]);
  let newer = 0;
  for (const key of FOOD) for (let s = 0; s < 6; s++) { const id = FRANCHISES[key][s % 5].id; const { m, spec } = make(key, id, s, true); if (spec.eat || m.cells.some((c) => NEW.has(c.k)) || m.rooms.some((a) => a.mix)) newer++; }
  check(!newer, `an older save's restaurants keep the old plan (${newer} new)`);
  const hotel = eateryVariant({ format: ["family", "fine"], setting: "hotel", r: 0.3 });
  const court = eateryVariant({ format: COUNTER, setting: "mall", r: 0.7 });
  const sushi = eateryVariant({ cuisine: "japanese", format: SITDOWN, r: 0.1 });
  const avoid = eateryVariant({ format: "kiosk", setting: "mall", r: 0.5, avoid: [court ? court.id : ""] });
  check(!!hotel && ["family", "fine"].includes(hotel.format) && hotel.at.includes("hotel"), `a hotel's restaurant from the table (${hotel && hotel.name})`);
  check(!!court && COUNTER.includes(court.format) && court.at.includes("mall"), `a food court's counter (${court && court.name})`);
  check(!!sushi && sushi.cuisine === "japanese", `by cuisine (${sushi && sushi.name})`);
  check(!!avoid && avoid.id !== (court && court.id), `avoid: not the same variant twice (${avoid && avoid.name})`);
  check(!!eateryVariant({ format: "banquet", cuisine: "nope", size: "tiny", setting: "mall" }), "a query that fits nothing still finds its format (the filters dropped in turn)");
  // the scenes
  const want = ["drivethru", "dinebarricade", "kitchenfire", "lastmeal", "freezershut", "walkin"], got = {};
  let old = 0;
  const pick = VARIANTS.filter((v) => ["fastfood", "family", "fine", "buffet", "diner"].includes(v.format));
  for (let s = 0; s < (QUICK ? 120 : 300); s++) {
    const v = pick[s % pick.length], key = keyOf(v);
    const S = rollScenes(make(key, v.id, s).m, new Rng(500 + s), key);
    for (const x of (S && S.list) || []) got[x.kind] = (got[x.kind] || 0) + 1;
    if (s < 40) { const L = rollScenes(make(key, FRANCHISES[key][s % 5].id, s, true).m, new Rng(500 + s), key); if (L && L.list.some((x) => ["drivethru", "dinebarricade", "kitchenfire", "lastmeal"].includes(x.kind))) old++; }
  }
  const ff = VARIANTS.filter((v) => v.format === "fastfood"); // the drive-through line: fast food only, with cars in its lane
  for (let s = 0; s < 60 && !got.drivethru; s++) { const v = ff[s % ff.length], S = rollScenes(make(keyOf(v), v.id, s).m, new Rng(900 + s), keyOf(v)); for (const x of (S && S.list) || []) if (x.kind === "drivethru") got.drivethru = (got.drivethru || 0) + 1; }
  check(want.every((k) => got[k] > 0), `the scenes turn up (${want.map((k) => `${k} ${got[k] || 0}`).join(", ")})`);
  check(!old, `none of the new ones on an older save's layout (${old})`);
  const fire = built.map((b) => { const S = rollScenes(b.m, new Rng(3), keyOf(b.v)); return S && S.list.some((x) => x.kind === "kitchenfire") ? b.m : null; }).find(Boolean);
  check(!fire || fire.cells.some((c) => c.scorch), "a kitchen fire leaves scorch on the floor");
}

console.log(`\n${passes} passed, ${fails} failed`);
void EATERY;
process.exit(fails ? 1 : 0);
