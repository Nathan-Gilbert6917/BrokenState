// Amusement parks, fairgrounds and water parks (src/sim/amusement.js, amusementlayout.js, data-parks.js; issue #60 of
// the round-2 epic #39, the user's request 2026-10-26: "amusement parks").
// Usage: node tools/amusementtest.js [seed]   (BS_QUICK=1: fewer parks a variant)
// - The registry and the tables: 12+ variants in the shared picker (variantpick.js "amusement"), ids unique, each with
//   its REAL_SIZE row (#24), the type's MAP_CAP of 500, its placement row (#42) and its loot-sense row (#43).
// - Per variant, over several parks each: built from its own dice within its size row and the cap (a destination
//   theme park more than 300 a side); a food stand, a first-aid station, the maintenance shop, a cash office and the
//   employee area in every park; rides on the grounds (a coaster's track and its stalled cars, its station); the
//   rooms' loot types (snacks, prizes, first aid, tools and parts, fuel, the safe); everything reachable from the way
//   in (every container from a reached cell, every zone); each building's containers apart (c.house); the same park
//   twice; the new catalogue kinds all on the maps; the scenes (a stalled ride, a last stand in a ride station) seen.
// - The picker by the tile's class: a destination park by a city's centre only (huge, #42's size), fairgrounds most in
//   the towns, a pier or a funfair on the coast; a pin wins.
// - Placement: a new world's parks stand where the table says; an older world (placeLegacy) has none. A raid on one: its
//   intro, the dead spread, poiHouses its buildings.
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, runEnemyPhase, finishCombat, endPlayerTurn, CELL } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { poisOf, isSitePoi, ensurePois } from "../src/sim/pois.js";
import { poiRaidSetup, poiPlace } from "../src/sim/poiraid.js";
import { poiHouses } from "../src/sim/poicont.js";
import { buildingMap, buildingPlan, BUILDINGS, SITES } from "../src/sim/buildingmaps.js";
import { PARK, PARK_VARIANTS, parkVariant } from "../src/sim/amusement.js";
import { PARK_SCENES, registerParkScenes } from "../src/sim/amusementlayout.js";
import { SCENE_KINDS } from "../src/sim/interiorscenes.js";
import { variantsOf, pickVariant } from "../src/sim/variantpick.js";
import { REAL_SIZE } from "../src/sim/data-buildingsize.js";
import { MAP_CAP } from "../src/sim/battlesize.js";
import { PLACEMENT_ROWS } from "../src/sim/data-placement.js";
import { LOOT_SENSE } from "../src/sim/lootsense.js";
import { tileClass, placeWeight, sizeFor } from "../src/sim/placement.js";
import { AREAS } from "../src/sim/combat.js";

const seed = Number(process.argv[2] || 7);
const QUICK = !!process.env.BS_QUICK;
const PER = QUICK ? 3 : 6;
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed, size = "small") => { const st = createWorld({ seed: s, factionCount: 4, size }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };

const pass = (c) => !!c && (!!(CELL[c.k] && CELL[c.k].walk) || c.k === "door" || c.k === "boarded" || (!!c.moved && c.hp > 0));
function floodFrom(cells, w, h, starts) {
  const seen = new Uint8Array(w * h), q = [];
  for (const [x, y] of starts) if (pass(cells[y * w + x]) && !seen[y * w + x]) { seen[y * w + x] = 1; q.push(y * w + x); }
  while (q.length) {
    const i = q.pop(), x = i % w;
    for (const j of [x + 1 < w ? i + 1 : -1, x > 0 ? i - 1 : -1, i + w < w * h ? i + w : -1, i - w]) if (j >= 0 && !seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); }
  }
  return seen;
}
const ring = (c) => { const w = c.w || 1, h = c.h || 1, out = []; for (let y = c.y - 1; y <= c.y + h; y++) for (let x = c.x - 1; x <= c.x + w; x++) if (x < c.x || x >= c.x + w || y < c.y || y >= c.y + h) out.push([x, y]); return out; };
const sigMap = (m) => m.floors.map((F) => F.cells.map((c) => c.k[0]).join("")).join("/") + "|" + m.containers.map((c) => `${c.id}:${c.kind}:${c.x},${c.y},${c.f || 0}:${c.area}:${c.house ?? "-"}`).join(" ");

// ---------------------------------------------------------------------------------------------------------------------
section("The registry and the tables");
const list = variantsOf(PARK.KEY);
check(list.length >= 12 && new Set(list.map((e) => e.id)).size === list.length, `${list.length} variants in the shared picker, ids unique (want 12+)`);
check(PARK_VARIANTS.every((v) => REAL_SIZE.amusement.sizes[v.id]), "a REAL_SIZE row for every variant (data-buildingsize.js)");
check(MAP_CAP.amusement === 500 && PARK_VARIANTS.every((v) => REAL_SIZE.amusement.sizes[v.id].w[1] <= 500 && REAL_SIZE.amusement.sizes[v.id].d[1] <= 500), "the type's map cap is 500 × 500 and every row fits it");
check(!!PLACEMENT_ROWS.amusement && sizeFor("amusement", "centre") === "huge" && sizeFor("amusement", "town") === "large" && placeWeight("amusement", "coast") > 0, "its placement row: huge by a city's centre, large in the towns, on the coast too (#42)");
check(!!LOOT_SENSE.amusement && SITES.amusement && BUILDINGS.amusement && BUILDINGS.amusement.park, "its loot-sense row (#43), its site and its building");
check(["concession", "midway", "giftshop", "parkaid", "ridemaint", "parkfuel", "cashoffice", "parkstaff", "ridestation", "exhibit"].every((k) => AREAS[k]), "its rooms' loot types in AREAS");
registerParkScenes();
check(PARK_SCENES.every((k) => SCENE_KINDS[k] && SCENE_KINDS[k].when), "its scenes registered, each with a when (only a park's map has them)");

// ---------------------------------------------------------------------------------------------------------------------
section("Generation: every variant, several parks each");
const st0 = W(seed);
const tile0 = st0.tiles.find((t) => t.terrain === "plains" && !t.loc).id;
const NEW_KINDS = ["coastertrack", "coastercar", "ferriswheel", "teacup", "bumpercar", "waterslide", "trampoline", "windmill", "lightdisplay", "ticketbooth", "gokart"];
const kindsSeen = new Set(), scenesSeen = new Set(), rows = [];
for (const V of PARK_VARIANTS) {
  const S = REAL_SIZE.amusement.sizes[V.id], errs = [], tally = { rooms: 0, boxes: 0, rides: 0, w: 0, h: 0, ms: 0 };
  for (let n = 0; n < PER; n++) {
    const opt = { id: `at${V.id}${n}`, key: PARK.KEY, name: "Amusement park", plan: V.id };
    const t0 = Date.now();
    let m;
    try { m = buildingMap(st0, tile0, opt, null); } catch (e) { errs.push(`build: ${e.message}`); continue; }
    tally.ms += Date.now() - t0;
    if (m.plan.vid !== V.id) errs.push(`its plan ${m.plan.vid}`);
    if (m.w < S.w[0] || m.w > S.w[1] || m.h < S.d[0] || m.h > S.d[1] || m.w > 500 || m.h > 500) errs.push(`size ${m.w} × ${m.h} outside its row`);
    const rooms = m.rooms.filter((a) => !a.outdoor), roles = new Set(rooms.map((a) => a.role));
    for (const r of ["pkstand", "pkaid", "pkshop", "pkcash", "pkstaff"]) if (!roles.has(r)) errs.push(`no ${r}`);
    const rides = m.rooms.filter((a) => a.outdoor && a.ride);
    if (V.theme !== "hall" && !rides.length) errs.push("no rides");
    if (V.theme === "hall" && !roles.has("pkcourt")) errs.push("no trampoline court");
    if (rides.some((a) => a.ride === "coaster") && !roles.has("pkstation")) errs.push("a coaster with no station");
    for (const a of rides.filter((q) => q.ride === "coaster")) { let track = 0, cars = 0; for (let y = a.y0; y < a.y0 + a.h; y++) for (let x = a.x0; x < a.x0 + a.w; x++) { const k = m.cells[y * m.w + x].k; if (k === "coastertrack") track++; if (k === "coastercar") cars++; } if (track < 60 || cars < 2) errs.push(`${a.name}: ${track} track, ${cars} car cells`); }
    const types = new Set(m.containers.map((c) => (m.rooms[c.area] || {}).type));
    for (const t of ["concession", "parkaid", "ridemaint", "parkfuel", "cashoffice", "parkstaff"]) if (!types.has(t)) errs.push(`no ${t} container`);
    if (!m.rooms.some((a) => a.lot)) errs.push("no parking lot");
    // Everything reachable from the way in.
    const seen = floodFrom(m.cells, m.w, m.h, [[m.zones[0].x0 + 1, m.zones[0].y0 + 1]]);
    const lost = m.containers.filter((c) => (c.f || 0) === 0 && !ring(c).some(([x, y]) => x >= 0 && y >= 0 && x < m.w && y < m.h && seen[y * m.w + x]));
    if (lost.length) errs.push(`${lost.length} containers out of reach (${lost.slice(0, 2).map((c) => c.label).join("; ")})`);
    const zl = m.zones.filter((z) => !seen[(z.y0 + 1) * m.w + z.x0 + 1]);
    if (zl.length) errs.push(`zones out of reach: ${zl.map((z) => z.name).join(", ")}`);
    const fronts = m.plan.houses.filter((h) => h.front && !ring({ x: h.front.x, y: h.front.y }).some(([x, y]) => seen[y * m.w + x]));
    if (fronts.length) errs.push(`${fronts.length} front doors out of reach (${fronts.slice(0, 2).map((h) => h.name).join(", ")})`);
    if (m.containers.some((c) => m.rooms[c.area] && !m.rooms[c.area].outdoor && c.house == null)) errs.push("a building's container with no house");
    if (n === 0 && sigMap(buildingMap(st0, tile0, opt, null)) !== sigMap(m)) errs.push("not the same park twice");
    for (const c of m.cells) if (NEW_KINDS.includes(c.k)) kindsSeen.add(c.k);
    for (const F of m.floors) for (const c of F.cells) if (NEW_KINDS.includes(c.k)) kindsSeen.add(c.k);
    for (const s of (m.scenes && m.scenes.list) || []) scenesSeen.add(s.kind);
    tally.rooms += rooms.length; tally.boxes += m.containers.length; tally.rides += rides.length + rooms.filter((a) => a.role === "pkride").length; tally.w += m.w; tally.h += m.h;
  }
  check(!errs.length, `${V.name}: ${errs.length ? errs.slice(0, 4).join("; ") : `${PER} parks as planned`}`);
  rows.push(`  ${V.id.padEnd(11)} ${String(Math.round(tally.w / PER)).padStart(4)} × ${String(Math.round(tally.h / PER)).padEnd(4)} rooms ${(tally.rooms / PER).toFixed(0).padStart(3)}  containers ${(tally.boxes / PER).toFixed(0).padStart(4)}  rides ${(tally.rides / PER).toFixed(1).padStart(4)}  ${(tally.ms / PER).toFixed(0)} ms`);
}
console.log(rows.join("\n"));
check(Math.max(...[0, 1, 2].map((n) => buildingMap(st0, tile0, { id: `atbig${n}`, key: PARK.KEY, name: "Park", plan: "themepark" }, null).w)) > 400, "a destination theme park is more than 400 across (up to 500 × 500)");
check(NEW_KINDS.every((k) => kindsSeen.has(k)), `the new catalogue kinds on the maps (${NEW_KINDS.filter((k) => !kindsSeen.has(k)).join(", ") || "all"} missing)`);
{
  for (let n = 0; n < 40 && !(scenesSeen.has("stalledride") && scenesSeen.has("stationstand")); n++) { const m = buildingMap(st0, tile0, { id: `atsc${n}`, key: PARK.KEY, name: "Park", plan: n % 2 ? "regional" : "themepark" }, null); for (const s of (m.scenes && m.scenes.list) || []) scenesSeen.add(s.kind); }
  check(scenesSeen.has("stalledride") && scenesSeen.has("stationstand"), `the parks' scenes turn up (${[...scenesSeen].join(", ")})`);
}

// ---------------------------------------------------------------------------------------------------------------------
section("The picker by the tile's class");
{
  const pickAt = (cls, n = 300) => { const c = {}; for (let i = 0; i < n; i++) { const v = parkVariant(st0, tile0, { id: `pk${cls}${i}`, setting: cls }); c[v.id] = (c[v.id] || 0) + 1; } return c; };
  const centre = pickAt("centre"), town = pickAt("town"), coast = pickAt("coast"), city = pickAt("city");
  const top = (c) => Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  check(centre.themepark === 300, `a city's centre: a destination theme park (${JSON.stringify(centre)})`);
  check(!town.themepark && !city.themepark && !coast.themepark, "a destination park only by a city's centre (the table's huge)");
  check(top(town) === "fairground", `a town: fairgrounds most (${JSON.stringify(town)})`);
  check((coast.pier || 0) + (coast.funfair || 0) > 150, `the coast: a pier or a funfair most (${JSON.stringify(coast)})`);
  check(Object.keys(city).length >= 3, `a city's blocks: several kinds (${JSON.stringify(city)})`);
  check(parkVariant(st0, tile0, { id: "pin", plan: "pier", setting: "town" }).id === "pier" && pickVariant(PARK.KEY, null, { plan: "western" }).id === "western", "a pin wins");
  const P = buildingPlan(st0, tile0, { id: "plan1", key: PARK.KEY, name: "Amusement park" }), m = buildingMap(st0, tile0, { id: "plan1", key: PARK.KEY, name: "Amusement park" }, null);
  check(P && P.vid === m.plan.vid && P.vname === m.vname, `buildingPlan names the park's plan without building it (${P && P.vname})`);
}

// ---------------------------------------------------------------------------------------------------------------------
section("Placement: a new world's parks, an older world's none");
let found = null;
{
  const byCls = {}, byVar = {};
  let n = 0, wrong = 0;
  for (const s of [seed, seed + 1, seed + 2, seed + 3]) {
    const st = s === seed ? st0 : W(s);
    for (const t of st.tiles) poisOf(t).forEach((q, i) => {
      if (q.kind !== PARK.KEY) return;
      n++;
      const cls = tileClass(st, t), v = parkVariant(st, t.id, poiPlace(t, i));
      byCls[cls] = (byCls[cls] || 0) + 1; byVar[v.id] = (byVar[v.id] || 0) + 1;
      if (!placeWeight(PARK.KEY, cls) || (v.id === "themepark" && cls !== "centre")) wrong++;
      if (!found && !isSitePoi(t, i)) found = [st, t, i];
    });
  }
  console.log(`  ${n} parks over 4 worlds: by class ${JSON.stringify(byCls)}; by variant ${JSON.stringify(byVar)}`);
  check(n >= 4, `parks placed in new worlds (${n})`);
  check(!wrong, `every park where the table puts it (${wrong} not)`);
  const old = createWorld({ seed, factionCount: 4, size: "small" });
  old.placeLegacy = true;
  for (const t of old.tiles) delete t.pois;
  ensurePois(old);
  check(!old.tiles.some((t) => poisOf(t).some((q) => q.kind === PARK.KEY)), "an older world (before the table) has none: its POIs as they were");
}

// ---------------------------------------------------------------------------------------------------------------------
section("The raid on a park");
if (check(!!found, "a park POI to raid")) {
  const [st, t, i] = found;
  const h = hub(st), crew = atBase(st, h.id).slice(0, 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 0 } });
  if (check(!res.error, `a team out (${res.error || "ok"})`)) {
    const p = res.party;
    p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged"; p.vehicle = null;
    const rs = poiRaidSetup(st, t, i);
    const setup = { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "the dead", groups: [{ kind: "zombies", count: 20, power: 3 }] }, raid: { heat0: 5, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null }, context: {} };
    const t0 = Date.now();
    const b = (st.combat = createBattle(st, setup));
    check(b.raid.plan && b.raid.plan.park && b.w <= 500 && b.h <= 500, `the raid is on the park's map (${b.raid.plan && b.raid.plan.vname}, ${b.w} × ${b.h}, set up in ${Date.now() - t0} ms)`);
    const log = b.log.map((l) => l.text || l).join(" ");
    check(/maintenance shop/.test(log) && log.includes((b.raid.plan.vname || "").toLowerCase()), "the intro names the park and where to head");
    const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie");
    check(dead.length >= 15 && dead.length <= 120, `the dead spread over the park (${dead.length})`);
    check(poiHouses(st, t, i) === b.raid.plan.houses.length && b.raid.plan.houses.length >= 2, `poiHouses: its ${b.raid.plan.houses.length} buildings`);
    for (const u of b.units) if (u.side === "player") u.left = true;
    endPlayerTurn(st); runEnemyPhase(st);
    finishCombat(st, b.setup, b.result);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
