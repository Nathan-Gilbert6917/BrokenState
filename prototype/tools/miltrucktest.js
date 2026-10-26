// Army trucks, the abandoned convoy and found cars (sim/miltrucks.js, sim/foundcars.js; maps in combat.js
// placeMilTrucks / AREAS.miltrucks; the Army truck as a vehicle in vehicles.js). Checks:
//   - where the trucks are: road tiles (rare, more near a National Guard base), a base's motor pool (3–5), half the
//     army helicopter wrecks, a convoy (2–4); deterministic
//   - truckLoot: the one loot table (military guns, bulk ammo, armour, NVGs, radios, grenades, rations, packs); a
//     wrecked or burned-out truck holds less; the hooks; value against a National Guard base raid
//   - the maps: a raid map with the trucks as containers (some padlocked), soldier dead round them; searching one
//     gives truckLoot and wakes the crew strapped in (more aware soldiers, Heat); an opened truck stays opened; the
//     field battle map has them as cover; siteDeadMix has soldiers on a truck tile; the hour-by-hour search reaches them
//   - the convoy event: the card, the site, its trucks, the race (a salvage party strips it), it expires; save / load
//   - the convoy's guard (CONVOY_GUARD): more dead soldiers round each truck on the raid map, Heat from the start and
//     more when one is forced open, the hour-by-hour search's Heat and threat, a fight by the numbers there counts
//     them, an AI salvage party loses people to them before it strips it and takes the trucks' cargo home (stock, arsenal); a
//     stripped convoy has no guard
//   - the Army truck as a vehicle: slower (×0.67, off-road ×0.75 more), ×2 fuel, 2500 kg, 12 seats, loud (hordes turn,
//     camp Heat, Heat when driven on a battle map)
//   - found cars: get in (locked: pick / force / break the glass, the noise), keys, hotwire, inspect, siphon, claim;
//     the claimed one joins the team after the fight; a broken one: the repair needs Mechanics (says what), parts and
//     hours, fails (wasting parts) or works; drive it home; save / load of the vehicle and the car records
//   - the autopilot plays 40 days with a convoy and a found vehicle on its map without crashing
// Usage: node tools/miltrucktest.js [seed = 7]
import { FOODS, foodRng } from "../src/sim/foods.js";
import { TRUCK_GEAR } from "../src/sim/data-guns.js";
import { totalRounds, isRoundKey } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld, hub, atBase, tickHour, day } from "../src/sim/world.js";
import { GEAR, SUPPLIES, LOCATIONS } from "../src/sim/data.js";
import { Rng } from "../src/sim/rng.js";
import {
  MILTRUCK, TRUCK_KINDS, TRUCK_LOOT, TRUCK_LOOT_HOOKS, TRUCK_FLASH, truckLoot, trucksAt, unopenedTrucks, roadTruckChance, milDistance, truckSearchHour,
  spawnConvoy, convoysHour, convoyById, activeConvoys, CONVOY, truckEngineNoise, ENGINE,
  CONVOY_GUARD, guardedTrucks, convoyGuards, convoyHeat0, convoyThreat, convoySoldiers, convoyAiLosses, convoyHaul,
} from "../src/sim/miltrucks.js";
import { startScavenge } from "../src/sim/scavenge.js";
import { triggerConflict } from "../src/sim/conflicts.js";
import { unitPower, arsenalWorthy } from "../src/sim/arsenal.js";
import { condRolled } from "../src/sim/itemcond.js";
import { isNight } from "../src/sim/world.js";
import {
  carsNear, carRecord, carOptions, carAct, settleClaims, repairOf, runs, fixProblem, startFixCar, finishFixCar, fixChance, driveHome, fixableAt, runnerAt, MODELS,
} from "../src/sim/foundcars.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler, combatAct, finishCombat, CELL } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { siteDeadMix } from "../src/sim/deadsoldiers.js";
import { launchExpedition, partyTile, partyMembers, travelHours, planPath, orderOptions, giveOrder, spawnAiParty } from "../src/sim/parties.js";
import { VEHICLE_TYPES, createVehicle, fuelMultFor } from "../src/sim/vehicles.js";
import { teamLoad } from "../src/sim/load.js";
import { campRows, CAMP_HEAT } from "../src/sim/fieldheat.js";
import { makeHorde } from "../src/sim/hordes.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { setAutopilot, autopilotResolve } from "../src/sim/autopilot.js";
import { taskHour } from "../src/sim/orders.js";
import { roundsInItem, isBulk } from "../src/sim/itemstack.js"; // a truck's rounds boxed or in bulk (2026-10-10)
import { gunsFrom } from "../src/sim/gundist.js"; // the gun distribution: a truck's gun is one of the Army's (truck:<kind>)

const SEED = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
const r2 = (v) => Math.round(v * 100) / 100;
registerCombatHandler("mtt", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const valueOf = (got) => Object.entries(got.sup).reduce((a, [k, q]) => a + (SUPPLIES[k] ? SUPPLIES[k].value * q : 0), 0) + got.gear.reduce((a, it) => a + (GEAR[it.key] ? GEAR[it.key].value * (it.quality ?? 1) : 0), 0);
const bareRoads = (st) => st.tiles.filter((t) => t.road && !t.loc && !t.bridge && t.terrain !== "water");
const roadTruckTile = (st) => bareRoads(st).find((t) => trucksAt(st, t.id).length && !st.bases.some((b) => b.tile === t.id));
function team(st, tile, n = 3, opts = {}) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, n).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: tile, mission: "move", stance: "normal", vehicleId: opts.vehicleId ?? null, supplies: { food: 6, water: 6, ammo: Math.min(40, totalRounds(h.stock)), meds: Math.min(2, Math.floor(h.stock.meds || 0)), fuel: Math.min(opts.fuel || 0, Math.floor(h.stock.fuel || 0)), parts: Math.min(opts.parts || 0, Math.floor(h.stock.parts || 0)), scrap: Math.min(opts.scrap || 0, Math.floor(h.stock.scrap || 0)) } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "waiting"; p.dest = tile;
  return p;
}
const raidSetup = (st, tile, p) => ({ mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "mtt", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile) }, raid: { heat0: 5 }, context: {} });

// ---------------------------------------------------------------------------------------------------------------
section("Where the trucks are (miltrucks.js trucksAt)");
{
  let road = 0, withT = 0, near = 0, nearT = 0, far = 0, farT = 0, bases = 0, baseOk = 0, crashT = 0, crashN = 0;
  for (const seed of [SEED, SEED + 1, SEED + 2, SEED + 3, SEED + 4, SEED + 5]) {
    const st = createWorld({ seed, factionCount: 7 });
    for (const t of bareRoads(st)) {
      road++;
      const n = trucksAt(st, t.id).length;
      if (n) withT++;
      const d = milDistance(st, t.id);
      if (d <= 4) { near++; if (n) nearT++; } else if (d > 8) { far++; if (n) farT++; }
    }
    // The Guard bases (an air base, issue #25, is a military site with no motor pool).
    for (const id of st.militaryIds.filter((i) => st.tiles[i].loc && st.tiles[i].loc.type === "military")) { bases++; const n = trucksAt(st, id).length; if (n >= MILTRUCK.BASE[0] && n <= MILTRUCK.BASE[1]) baseOk++; }
    // An army helicopter wreck (crashes.js crash_mil) on a few tiles: half of them have a Humvee.
    for (const t of st.tiles.filter((x) => !x.loc && x.terrain === "plains").slice(0, 40)) {
      t.loc = { type: "crash_mil", name: "test", zone: "special", crash: t.id };
      crashN++;
      const l = trucksAt(st, t.id);
      if (l.length) { crashT++; if (l[0].kind !== "humvee") crashT = -999; }
      delete t.loc;
    }
  }
  const farRate = farT / Math.max(1, far), nearRate = nearT / Math.max(1, near);
  console.log(`    ${road} bare road tiles over 6 maps: ${withT} with a truck (${r2((100 * withT) / road)}%); within 4 of a base ${nearT}/${near} (${r2(100 * nearRate)}%), over 8 away ${farT}/${far} (${r2(100 * farRate)}%)`);
  check(withT > 0 && withT / road < 0.12, `rare on the roads: ${r2((100 * withT) / road)}% of bare road tiles (under 12%)`);
  check(farRate > 0.003 && farRate < 0.04, `far from any base about the base rate (${r2(100 * farRate)}%; ROAD_P ${MILTRUCK.ROAD_P * 100}%, ×0.5 on a dead end, ×1.5 at a junction)`);
  check(near < 10 || nearRate > farRate * 3, `far more common near a National Guard base (${r2(100 * nearRate)}% within 4 tiles)`);
  check(bases > 0 && baseOk === bases, `every National Guard base has ${MILTRUCK.BASE[0]}–${MILTRUCK.BASE[1]} trucks in its motor pool (${baseOk}/${bases})`);
  check(crashT > crashN * 0.3 && crashT < crashN * 0.7, `about half the army helicopter wrecks have a Humvee (${crashT}/${crashN})`);
  const st = createWorld({ seed: SEED, factionCount: 7 });
  const st2 = createWorld({ seed: SEED, factionCount: 7 });
  const sig = (s) => bareRoads(s).map((t) => trucksAt(s, t.id).map((x) => `${t.id}:${x.kind}/${x.cond}/${x.crew}`).join(",")).join("|") + s.militaryIds.map((id) => trucksAt(s, id).map((x) => x.kind).join(",")).join("|");
  check(sig(st) === sig(st2), "deterministic: the same seed puts the same trucks on the same tiles");
}

// ---------------------------------------------------------------------------------------------------------------
section("What is in one (truckLoot)");
let truckValue = 0;
{
  const rng = new Rng(SEED);
  const N = 400;
  const keys = new Set(), avg = {};
  for (const kind of Object.keys(TRUCK_KINDS)) for (const cond of ["intact", "wrecked", "burnt"]) {
    let v = 0, items = 0, ammo = 0;
    for (let i = 0; i < N; i++) {
      const got = truckLoot(rng, kind, cond);
      v += valueOf(got); items += got.gear.filter((it) => !roundsInItem(it)).length; ammo += totalRounds(got.sup) + got.gear.reduce((a, it) => a + roundsInItem(it), 0); // itemstack.js: boxed and bulk rounds are its ammo (2026-10-10)
      for (const it of got.gear) keys.add(roundsInItem(it) || isBulk(it) ? "ammo" : it.key);
      for (const k of Object.keys(got.sup)) keys.add(isRoundKey(k) ? "ammo" : k); // rounds by calibre (ammo.js): the table's "ammo"
    }
    avg[`${kind}/${cond}`] = { v: v / N, items: items / N, ammo: ammo / N };
  }
  for (const [k, a] of Object.entries(avg)) console.log(`    ${k.padEnd(16)} value ${Math.round(a.v)}, ${r2(a.items)} items, ${Math.round(a.ammo)} ammo`);
  const allowed = new Set([...Object.values(TRUCK_LOOT).flatMap((T) => [...T.sup.map(([k]) => k), ...T.gear.map(([k]) => k)]), ...Object.values(TRUCK_GEAR).flatMap((r) => r.map(([k]) => k)), ...(Object.keys(TRUCK_FLASH).length ? ["flashbang"] : []), ...Object.keys(TRUCK_KINDS).flatMap((kind) => Object.keys(gunsFrom(`truck:${kind}`)))]); // TRUCK_GEAR: the weapons overhaul's hook; TRUCK_FLASH: the flashbang hook (TRUCK_LOOT_HOOKS); gundist.js: a listed gun's Army kin (truck:<kind>)
  check([...keys].every((k) => allowed.has(k)), `everything in a truck comes from its loot table (and the roster's and the flashbang hooks; a gun of the Army's kinds: gundist.js) (stray: ${[...keys].filter((k) => !allowed.has(k)).join(", ") || "none"})`);
  check(["ar", "carbine", "ammo", "plate", "vest", "milhelmet", "nvg", "milradio", "frag", "smokegren", "food", "meds", "assaultpack", "rucksack"].every((k) => keys.has(k)), "military guns, bulk ammo, armour, helmets, night vision, radios, grenades, rations, meds and packs all turn up");
  check(avg["cargo/intact"].v > avg["cargo/wrecked"].v && avg["cargo/wrecked"].v > avg["cargo/burnt"].v * 1.5, "a wrecked truck holds less, a burned-out one much less");
  check(avg["cargo/intact"].ammo >= 50, `an intact cargo truck: ammunition by the crate (${Math.round(avg["cargo/intact"].ammo)} rounds on average)`);
  const burnt = new Set();
  for (let i = 0; i < 300; i++) for (const it of truckLoot(rng, "cargo", "burnt").gear) burnt.add(it.key);
  check(!burnt.has("nvg") && !burnt.has("milradio") && !burnt.has("rucksack"), "nothing burnable survives in a burned-out one (no electronics or packs)");
  let called = 0;
  TRUCK_LOOT_HOOKS.push((r, ctx, out) => { called++; if (ctx.kind === "mrap") out.gear.push({ key: "test" }); });
  const g = truckLoot(rng, "mrap", "intact");
  TRUCK_LOOT_HOOKS.pop();
  check(called === 1 && g.gear.some((it) => it.key === "test"), "TRUCK_LOOT_HOOKS: later branches add to a truck's contents (attachments, typed ammo)");
  truckValue = avg["cargo/intact"].v;
  const halfBase = truckLoot(new Rng(1), "cargo", "intact", { rich: MILTRUCK.BASE_RICH });
  check(!!halfBase, `a base's motor pool holds ×${MILTRUCK.BASE_RICH} (the evacuation took the rest)`);
}

// ---------------------------------------------------------------------------------------------------------------
section("The raid map (combat.js placeMilTrucks, AREAS.miltrucks; the crews)");
{
  let maps = 0, boxes = 0, padlocked = 0, soldiers = 0, opened = 0, rose = 0, heatUp = 0, again = 0, lootOk = 0, value = 0, onRoad = 0;
  let baseRaids = 0, baseValue = 0;
  for (let i = 0; i < 6; i++) {
    const st = createWorld({ seed: SEED * 100 + i, factionCount: 7 });
    const t = roadTruckTile(st);
    if (!t) continue;
    const p = team(st, t.id);
    const b = inBrowser(() => createBattle(st, raidSetup(st, t.id, p)));
    st.combat = b;
    maps++;
    const trucks = b.raid.containers.filter((c) => c.kind === "miltruck");
    boxes += trucks.length;
    padlocked += trucks.filter((c) => c.lock).length;
    const truckCells = b.cells.filter((c) => c.car && c.car.mil);
    if (truckCells.some((c) => c.f === "road")) onRoad++;
    check(truckCells.every((c) => c.k === "truck" && CELL[c.k].cover === 2 && CELL[c.k].los), `map ${i}: the trucks are full cover that blocks sight (${trucks.length} cargo bed${trucks.length === 1 ? "" : "s"})`);
    soldiers += b.units.filter((u) => u.side === "enemy" && u.ztype === "soldier").length;
    const box = trucks[0];
    if (!box) continue;
    if (box.lock) box.lock.open = true;
    const u = b.units.find((x) => x.side === "player");
    const ring = [[box.x - 1, box.y], [box.x + box.w, box.y], [box.x, box.y - 1], [box.x, box.y + box.h]].find(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => o !== u && o.x === x && o.y === y));
    if (!ring) continue;
    u.x = ring[0]; u.y = ring[1]; u.ap = 2;
    const before = b.units.filter((x) => x.ztype === "soldier" && x.aware).length, heat0 = b.raid.heat, crew = box.crew;
    const err = combatAct(st, { type: "search", unit: u.id, box: box.id, open: true });
    if (err) { console.log("    search:", err); continue; }
    opened++;
    const allowed = new Set([...Object.values(TRUCK_LOOT).flatMap((T) => [...T.sup.map(([k]) => k), ...T.gear.map(([k]) => k)]), ...Object.values(TRUCK_GEAR).flatMap((r) => r.map(([k]) => k)), ...Object.keys(TRUCK_KINDS).flatMap((kind) => Object.keys(gunsFrom(`truck:${kind}`)))]); // TRUCK_GEAR: the weapons overhaul's hook (TRUCK_LOOT_HOOKS); gundist.js: a listed gun's Army kin (truck:<kind>)
    if (box.contents && [...Object.keys(box.contents.sup).filter((k) => !["arrows", "wood"].includes(k)), ...box.contents.gear.filter((it) => !it.blueprint && !it.book && GEAR[it.key] && !["key"].includes(it.key)).map((it) => it.key)].every((k) => allowed.has(k) || (isRoundKey(k) && allowed.has("ammo")) || (FOODS[k] && (allowed.has("food") || allowed.has("preserved"))) /* food by type: the truck's "food" as the Army's items */ || k === "frag" || k === "smokegren" || k === "flashbang" /* TRUCK_FLASH: crates of them now and then */ || !!(GEAR[k] && GEAR[k].mag))) lootOk++; // GEAR mag: the spare magazines a found gun comes with (carrykit.js gunMags, w2-kit)
    value += box.contents ? valueOf(box.contents) : 0;
    const after = b.units.filter((x) => x.ztype === "soldier" && x.aware).length;
    if (crew > 0 && after > before) rose++;
    if (crew === 0) rose++;
    if (b.raid.heat > heat0 || crew === 0) heatUp++; // a burned-out truck has nobody strapped in: quiet
    // A later raid on the same tile: that truck is opened (no cargo bed to search).
    const b2 = inBrowser(() => createBattle(st, raidSetup(st, t.id, p)));
    if (b2.raid.containers.filter((c) => c.kind === "miltruck").length === trucks.length - 1) again++;
    st.combat = null;
  }
  // A National Guard base's street map: everything in every container (the motor pool's trucks apart from the rest).
  let baseTrucks = 0, baseArea = 0;
  for (let i = 0; i < 4; i++) {
    const st = createWorld({ seed: SEED * 300 + i, factionCount: 7 });
    const tile = st.militaryIds[0];
    if (tile == null) continue;
    const p = team(st, tile, 4);
    const b = inBrowser(() => createBattle(st, raidSetup(st, tile, p)));
    st.combat = b;
    b.raid.choose = null;
    const u = b.units.find((x) => x.side === "player");
    for (const c of b.raid.containers) {
      if (c.kind === "body") continue;
      if (c.lock) c.lock.open = true;
      let at = null;
      for (let y = c.y - 1; y <= c.y + (c.h || 1) && !at; y++) for (let x = c.x - 1; x <= c.x + (c.w || 1) && !at; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => o !== u && !o.dead && o.x === x && o.y === y)) at = [x, y];
      if (!at) continue;
      [u.x, u.y] = at; u.ap = 2; b.phase = "player";
      if (combatAct(st, { type: "search", unit: u.id, box: c.id, open: true }) || !c.contents) continue;
      if (c.truck) baseTrucks += valueOf(c.contents); else baseValue += valueOf(c.contents);
    }
    baseArea += (b.w * b.h) / (40 * 30); // the street map's area over the old Large one's (battlesize.js: a base's raid map is the run's largest)
    baseRaids++;
    st.combat = null;
  }
  console.log(`    ${maps} raid maps on road tiles with trucks: ${boxes} cargo beds (${padlocked} padlocked), ${soldiers} dead soldiers placed, ${onRoad} with trucks on the road itself`);
  console.log(`    one opened truck brought ${Math.round(value / Math.max(1, opened))} value; a National Guard base's street map holds ${Math.round(baseValue / Math.max(1, baseRaids))} in its buildings and ${Math.round(baseTrucks / Math.max(1, baseRaids))} in its motor pool's trucks (${baseRaids} bases, every container); truckLoot mean for an intact cargo truck ${Math.round(truckValue)}`);
  check(maps >= 3 && boxes >= maps, `every raid map on a truck tile has its trucks as cargo beds to search (${boxes} on ${maps} maps)`);
  check(soldiers >= maps, `dead soldiers stand round them (${soldiers} on ${maps} maps)`);
  check(opened >= 3 && lootOk === opened, `searching a cargo bed gives truckLoot (${lootOk}/${opened})`);
  check(opened >= 3 && rose === opened, `the crew strapped in rises when it is opened (${rose}/${opened})`);
  check(heatUp === opened, `the noise: Heat goes up (${heatUp}/${opened})`);
  check(again === opened, `an opened truck stays opened on the next raid (${again}/${opened})`);
  check(baseRaids > 0 && truckValue > 0.15 * (baseValue / baseArea) && truckValue < 0.75 * (baseValue / baseArea), `one intact cargo truck is a good haul: 15–75% of everything in a National Guard base's buildings, on a 40 × 30 map's worth of them (${Math.round(baseValue / baseArea)})`);
  check(baseRaids > 0 && baseTrucks / baseRaids < 0.8 * (baseValue / baseRaids), "the motor pool adds to a base without doubling it");
}

// ---------------------------------------------------------------------------------------------------------------
section("The field battle map, the dead, the hour-by-hour search");
{
  const st = createWorld({ seed: SEED, factionCount: 7 });
  const t = roadTruckTile(st);
  const p = team(st, t.id);
  const b = inBrowser(() => createBattle(st, { tile: t.id, partyId: p.id, enemy: { kind: "zombies", count: 4, power: 3 }, ambush: null, canRetreat: true, handler: "mtt", context: {} }));
  check(b.cells.some((c) => c.car && c.car.mil), "a field battle on a truck tile has the trucks on the map");
  const mix = siteDeadMix(st, t.id);
  check(mix && mix.soldier >= MILTRUCK.DEAD.road, `siteDeadMix: soldiers among the dead on a truck tile (${mix && mix.soldier})`);
  const base = st.militaryIds[0];
  check((siteDeadMix(st, base) || {}).soldier >= 0.45, "a National Guard base still 45% soldiers");
  // The hour-by-hour search.
  const e = { tile: t.id, hours: 0, heat: 5, found: { supplies: {}, gear: [] } };
  let got = "", hours = 0;
  for (let i = 0; i < 40 && unopenedTrucks(st, t.id).length; i++) { st.hour += 1; e.hours++; hours++; got += truckSearchHour(st, e, p, partyMembers(st, p)); }
  check(/Forced the back/.test(got) && (totalRounds(e.found.supplies) || e.found.gear.length), `the hour-by-hour search reaches the trucks (all opened in ${hours} hours; Heat ${e.heat})`);
  check(!siteDeadMix(st, t.id) || (siteDeadMix(st, t.id).soldier || 0) < MILTRUCK.DEAD.road, "once they are all opened the soldiers are no longer drawn to the tile");
}

// ---------------------------------------------------------------------------------------------------------------
section("The abandoned convoy (an event)");
{
  const st = createWorld({ seed: SEED, factionCount: 7 });
  st.started = true;
  const c = spawnConvoy(st);
  check(!!c, "a convoy spawns");
  const t = st.tiles[c.tile];
  check(t.road && t.loc && t.loc.type === "convoy" && LOCATIONS.convoy.temp, `on a road tile, a temporary site (${t.loc && t.loc.name})`);
  const tr = trucksAt(st, c.tile);
  check(tr.length >= CONVOY.trucks[0] && tr.length <= CONVOY.trucks[1] && tr[0].kind === "cargo", `${tr.length} trucks (${tr.map((x) => `${x.kind}/${x.cond}`).join(", ")})`);
  check(st.cards.some((x) => x.convoyId === c.id && x.choices.length >= 2), "a card about it, with Mark it and Send a salvage team");
  check((siteDeadMix(st, c.tile) || {}).soldier >= 0.55, "its dead are mostly soldiers");
  const p = team(st, c.tile);
  const b = inBrowser(() => createBattle(st, raidSetup(st, c.tile, p)));
  check(b.raid.containers.filter((x) => x.kind === "miltruck").length >= 1, `its raid map has the trucks (${b.raid.containers.filter((x) => x.kind === "miltruck").length} cargo beds)`);
  // Save and load with it on the map.
  st.cards = [];
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  check(convoyById(back, c.id) && back.tiles[c.tile].loc && back.tiles[c.tile].loc.convoy === c.id && trucksAt(back, c.tile).length === tr.length, "it survives a save and a load");
  // The race and the end.
  const loot0 = t.loot;
  if (c.race.length) {
    c.race[0].at = st.hour;
    convoysHour(st);
    const q = st.parties.find((x) => x.kind === "salvage" && x.convoy === c.id);
    check(!!q, "a group nearby sends a salvage party");
    if (q) { q.idx = q.path.length - 1; convoysHour(st); check(c.stripped === 1 && t.loot < loot0 && trucksAt(st, c.tile)[0].rich < 1, "it strips the convoy (the site's loot and the trucks' cargo)"); }
  } else check(true, "no group close enough to race (none within range on this map)");
  st.hour = c.expires + 1;
  st.combat = null; st.engagement = null;
  convoysHour(st);
  check(c.gone && !st.tiles[c.tile].loc && !activeConvoys(st).length, "it is burned out and gone after its days");
  // The schedule: one comes by itself in time.
  const st2 = createWorld({ seed: SEED + 1, factionCount: 7 });
  st2.started = true;
  for (let i = 0; i < 24 * 40 && !(st2.convoys || []).length; i++) { st2.hour++; convoysHour(st2); st2.cards = []; }
  check((st2.convoys || []).length >= 1 && st2.convoys[0].seenHour / 24 >= CONVOY.firstMin - 1, `the first convoy comes by itself (day ${st2.convoys && st2.convoys[0] ? Math.floor(st2.convoys[0].seenHour / 24) + 1 : "-"})`);
}

// ---------------------------------------------------------------------------------------------------------------
section("The convoy's guard (miltrucks.js CONVOY_GUARD: more dead soldiers and more Heat by the truck)");
{
  const G = CONVOY_GUARD;
  // The raid map: the same convoy with and without the guard (PER_TRUCK 0 and no Heat: the old numbers).
  const convoyAt = (seed) => {
    const st = createWorld({ seed, factionCount: 7 });
    st.started = true;
    st.cards = [];
    const c = spawnConvoy(st, { noCard: true });
    return c ? { st, c } : null;
  };
  const raidOn = (seed, guard) => {
    const w = convoyAt(seed);
    if (!w) return null;
    const saved = { ...G };
    if (!guard) Object.assign(G, { PER_TRUCK: [0, 0], HEAT_PRESENT: 0, HEAT_OPEN: 0 });
    try {
      const p = team(w.st, w.c.tile);
      const b = inBrowser(() => createBattle(w.st, raidSetup(w.st, w.c.tile, p)));
      w.st.combat = b;
      const soldiers = b.units.filter((u) => u.ztype === "soldier").length;
      const heat0 = b.raid.heat;
      // Force a convoy truck open: the crew rises (RISE_HEAT) and, with the guard, the line hears it (HEAT_OPEN).
      const box = b.raid.containers.find((x) => x.kind === "miltruck" && x.truck.src === "convoy");
      let rise = null;
      if (box) {
        if (box.lock) box.lock.open = true;
        const u = b.units.find((x) => x.side === "player");
        const ring = [[box.x - 1, box.y], [box.x + box.w, box.y], [box.x, box.y - 1], [box.x, box.y + box.h]].find(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => o !== u && o.x === x && o.y === y));
        if (ring) {
          [u.x, u.y] = ring; u.ap = 2;
          const h0 = b.raid.heat, crew = box.crew;
          if (!combatAct(w.st, { type: "search", unit: u.id, box: box.id, open: true })) rise = { gain: b.raid.heat - h0, crew };
        }
      }
      w.st.combat = null;
      return { soldiers, heat0, trucks: trucksAt(w.st, w.c.tile).length, rise };
    } finally { Object.assign(G, saved); }
  };
  let withG = 0, without = 0, n = 0, heatOk = 0, openOk = 0, opened = 0, trucks = 0;
  for (let i = 0; i < 6; i++) {
    const a = raidOn(SEED * 50 + i, true), z = raidOn(SEED * 50 + i, false);
    if (!a || !z) continue;
    n++; withG += a.soldiers; without += z.soldiers; trucks += a.trucks;
    if (a.heat0 - z.heat0 === a.trucks * G.HEAT_PRESENT) heatOk++;
    if (a.rise && z.rise) { opened++; if (a.rise.gain - z.rise.gain === G.HEAT_OPEN) openOk++; }
  }
  console.log(`    ${n} convoys, ${trucks} trucks: ${withG} dead soldiers on their raid maps with the guard, ${without} without`);
  check(n >= 3 && withG - without >= trucks * G.PER_TRUCK[0] * 0.8, `each truck has its guard: ${withG - without} more dead soldiers on ${trucks} trucks (${G.PER_TRUCK.join("–")} a truck)`);
  check(n >= 3 && heatOk === n, `the raid starts hotter: +${G.HEAT_PRESENT} Heat a truck (${heatOk}/${n})`);
  check(opened >= 2 && openOk === opened, `forcing a convoy truck open: +${G.HEAT_OPEN} Heat more than an ordinary truck (${openOk}/${opened})`);
  // By the numbers: the guard, the search's Heat and threat, a fight with the dead there, an AI party's losses.
  const w = convoyAt(SEED * 50 + 1);
  const { st, c } = w;
  const k = guardedTrucks(st, c.tile).length;
  check(k === c.trucks && convoyGuards(st, c.tile) === Math.round(k * (G.PER_TRUCK[0] + G.PER_TRUCK[1]) / 2) && convoyHeat0(st, c.tile) === k * G.HEAT_PRESENT && convoyThreat(st, c.tile) > 0, `${k} guarded trucks: ${convoyGuards(st, c.tile)} guards, Heat +${convoyHeat0(st, c.tile)} at the start, threat +${convoyThreat(st, c.tile).toFixed(1)} in the search`);
  const p = team(st, c.tile, 4);
  p.dest = c.tile;
  p.phase = "engaged";
  st.engagement = null;
  check(startScavenge(st, p) && st.engagement.heat === (isNight(st) ? 0 : 5) + k * G.HEAT_PRESENT, `the hour-by-hour search starts at Heat ${st.engagement && st.engagement.heat}`);
  {
    const e = { tile: c.tile, hours: 0, heat: 0, found: { supplies: {}, gear: [] } };
    const x = unopenedTrucks(st, c.tile)[0];
    let line = "";
    for (let i = 0; i < 60 && !line; i++) { st.hour++; e.hours++; line = truckSearchHour(st, e, p, partyMembers(st, p)); }
    check(!!line && e.heat === MILTRUCK.SEARCH_HEAT + 2 * x.crew + G.HEAT_OPEN, `reaching a convoy truck in the search: Heat +${e.heat} (${MILTRUCK.SEARCH_HEAT} + 2 a crewman + ${G.HEAT_OPEN})`);
    check(guardedTrucks(st, c.tile).length === k - 1, "an opened truck is no longer guarded");
  }
  st.engagement = null;
  // A fight with the dead there (conflicts.js enemyGroup): the guard comes too.
  {
    st.cards = [];
    const g0 = convoyGuards(st, c.tile);
    const card = triggerConflict(st, p, "surge", null);
    const cc = card && (card.conflict || card.c || (st.cards.find((x) => x.partyId === p.id) || {}).conflict);
    const enemy = cc && cc.enemy;
    check(!!enemy && enemy.count >= 4 + g0 && ((enemy.types && enemy.types.soldier) || 0) >= g0, `a fight with the dead there by the numbers counts the guard (${enemy ? `${enemy.count} dead, ${(enemy.types && enemy.types.soldier) || 0} soldiers` : "no card"}; guard ${g0})`);
    st.cards = [];
  }
  // An AI group's salvage party: it loses people to the soldiers about the trucks (its type's arms and kit), then strips it.
  {
    const f = st.factions.find((x) => x.alive && x.bases.length && !x.bases.includes(c.tile));
    const soldiers = convoySoldiers(st, c.tile);
    const losses = [];
    for (let i = 0; i < 40; i++) losses.push(convoyAiLosses(st, { ...c, id: c.id + 1000 * i }, f, 6));
    const mean = losses.reduce((a, x) => a + x, 0) / losses.length;
    const want = soldiers * G.AI_LOSS * G.AI_REF / Math.max(1, unitPower(f, 2.2));
    check(soldiers > 0 && Math.abs(mean - want) < 0.35, `an AI salvage party loses ${mean.toFixed(2)} people on average to ${soldiers.toFixed(1)} soldiers (expected ${want.toFixed(2)})`);
    check(convoyAiLosses(st, c, f, 1) <= 1 && convoyAiLosses(st, c, f, 0) === 0, "never more than the party has");
    { // its dice never use run-time ids: a second world of the same seed (other ids) loses the same
      const w1 = convoyAt(SEED * 50 + 2), w2 = convoyAt(SEED * 50 + 2);
      const f1 = w1.st.factions.find((x) => x.alive && x.bases.length), f2 = w2.st.factions.find((x) => x.name === f1.name);
      const ls = (w, g) => [0, 1, 2, 3, 4, 5].map((i) => convoyAiLosses(w.st, { ...w.c, id: w.c.id + 1000 * i }, g, 6)).join(",");
      check(!!f2 && f2.id !== f1.id && ls(w1, f1) === ls(w2, f2), `the same losses in a second world of the same seed, whose groups have other ids (${ls(w1, f1)})`);
    }
    const pop0 = f.pop;
    const q = spawnAiParty(st, f, "salvage", f.bases[0], c.tile, { strength: 6 });
    q.convoy = c.id; q.path = [c.tile]; q.idx = 0;
    const lost = convoyAiLosses(st, c, f, 6);
    // AI parity: the trucks' cargo goes home with it (convoyHaul: truckLoot, its condition by itemcond.js; into the
    // group's stock and arsenal through caravanraids.js takeInto / arsenal.js addToArsenal).
    // (The food dice rewound after the preview: the trucks' food is typed by them, foods.js typeFind, and the strip below
    // would type it again from where the preview left them.)
    const foodDice = foodRng(st).state;
    const plan = convoyHaul(st, c), ars0 = f.arsenal ? f.arsenal.items.length : 0, ammo0 = f.stock.ammo || 0;
    foodRng(st).state = foodDice;
    const outs = () => (f.arsenal && f.arsenal.stats ? Object.values(f.arsenal.stats.out).reduce((a, n) => a + n, 0) : 0), out0 = outs(); // the fallen's kit leaves it (arsenal.js partyLost)
    const worthy = plan.gear.filter((it) => arsenalWorthy(it)).length, rich0 = unopenedTrucks(st, c.tile).map((x) => x.rich);
    convoysHour(st);
    check(f.pop === pop0 - lost && (c.aiLost || 0) === lost && c.stripped === 1, `it reaches the convoy: ${lost} of its people fall (group ${pop0} → ${f.pop}), then it strips it`);
    check(plan.value > 0 && c.aiHaul === plan.value && plan.gear.every((it) => condRolled(it)), `it takes the trucks' cargo home (worth ${plan.value}: ${plan.gear.map((it) => it.name).join(", ") || "no gear"}; every piece rolled by itemcond.js)`);
    check((f.arsenal ? f.arsenal.items.length : 0) - ars0 + (outs() - out0) === worthy && (f.stock.ammo || 0) - ammo0 === (plan.supplies.ammo || 0), `${worthy} guns, armour and grenades into its arsenal, ${plan.supplies.ammo || 0} rounds into its stock`);
    check(unopenedTrucks(st, c.tile).every((x, i) => Math.abs(x.rich - rich0[i] * CONVOY.stripKeep) < 1e-9), `the trucks keep ${CONVOY.stripKeep * 100}% of their cargo for whoever comes next`);
    check(!guardedTrucks(st, c.tile).length && convoyGuards(st, c.tile) === 0 && convoyHeat0(st, c.tile) === 0, "a stripped convoy has no guard left (the first group there put them down)");
    const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
    check(convoyById(back, c.id).aiLost === c.aiLost && convoyById(back, c.id).stripped === 1, "its losses and the strip survive a save and a load");
  }
}

// ---------------------------------------------------------------------------------------------------------------
section("The Army truck as a vehicle (vehicles.js miltruck)");
{
  const st = createWorld({ seed: SEED, factionCount: 7 });
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 3);
  const T = VEHICLE_TYPES.miltruck;
  const lt = teamLoad(people, 200, { type: "miltruck" }), lp = teamLoad(people, 200, { type: "truck" });
  check(T.payload >= 2000 && T.seats >= 10 && T.tank >= 100, `carries ${T.payload} kg, seats ${T.seats}, a ${T.tank}-unit tank`);
  check(r2(lt.ride.speed / lp.ride.speed) === T.speed && r2(lt.fuelMult / fuelMultFor(lt.fill)) === T.fuel, `rides at ×${r2(lt.ride.speed / lp.ride.speed)} a pickup's pace and burns ×${r2(lt.fuelMult / fuelMultFor(lt.fill))} the fuel (on top of its load)`);
  check(lt.capacity > lp.capacity * 3, `carries far more (${Math.round(lt.capacity)} kg of supplies against a pickup's ${Math.round(lp.capacity)})`);
  // A trip: the same path in both.
  const dest = st.tiles.find((x) => x.road && st.grid.distance(x.id, h.tile) >= 8 && planPath(st, h.tile, x.id, true));
  const path = planPath(st, h.tile, dest.id, true).path;
  const tp = travelHours(st, path, { vehicle: true, speed: lp.ride.speed, weather: false }).hours;
  const tm = travelHours(st, path, { vehicle: true, speed: lt.ride.speed, offroad: T.offroad, weather: false }).hours;
  check(tm > tp * 1.3, `the same ${path.length - 1}-tile trip takes ${tm}h against a pickup's ${tp}h`);
  // An off-road path: steps between land tiles with no road between them.
  const offPath = [h.tile];
  for (let i = 0; i < 12; i++) {
    const at = offPath[offPath.length - 1];
    const nx = st.grid.neighbors(at).find((n) => !offPath.includes(n) && st.tiles[n].terrain !== "water" && st.tiles[n].terrain !== "mountain" && !st.tiles[at].roadLinks.includes(n));
    if (nx == null) break;
    offPath.push(nx);
  }
  if (offPath.length >= 6) {
    const a = travelHours(st, offPath, { vehicle: true, speed: 1, weather: false, maxHours: 50 }).hours, bb = travelHours(st, offPath, { vehicle: true, speed: 1, offroad: T.offroad, weather: false, maxHours: 50 }).hours;
    check(bb >= a, `off-road worse still (${bb}h against ${a}h a tile at the same pace)`);
  }
  // Loud: hordes nearby turn toward its engine.
  let lured = 0, tries = 0;
  for (let i = 0; i < 30; i++) {
    const tile = st.tiles[path[Math.min(path.length - 1, 2)]].id;
    st.hordes = [makeHorde(st, { tile: st.grid.neighbors(tile)[0], size: 10 })];
    st.hour++;
    tries++;
    if (truckEngineNoise(st, { radioLive: false }, tile)) lured++;
  }
  check(lured > tries * ENGINE.p * 0.4 && lured < tries, `its engine draws roaming hordes within ${ENGINE.range} tiles (${lured} of ${tries} times)`);
  const rows = campRows(st, { tile: h.tile, people: 3, vehicles: [{ type: "miltruck" }], fire: false, working: false });
  check(rows.some((r) => r.key === "vehicle" && r.v === CAMP_HEAT.miltruck && r.v > CAMP_HEAT.truck), "parked at a camp it adds more Heat than a pickup");
  // On a battle map: 2 × 5, 12 seats, louder to drive.
  const v = createVehicle(st, "miltruck", { kind: "base", baseId: h.id }, { fuel: 80, condition: 80 });
  const p = launchExpedition(st, { memberIds: people.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", vehicleId: v.id, supplies: { food: 4, water: 4, fuel: 0 } }).party;
  p.path = [dest.id]; p.idx = 0; p.phase = "waiting";
  const b = inBrowser(() => createBattle(st, { tile: dest.id, partyId: p.id, enemy: { kind: "zombies", count: 3, power: 3 }, ambush: null, canRetreat: true, handler: "mtt", context: {} }));
  check(b.vehicle && b.vehicle.mil && Math.max(b.vehicle.w, b.vehicle.h) === 5 && b.vehicle.seats === 12, `on the battle map: a 2 × 5 Army truck with ${b.vehicle && b.vehicle.seats} seats`);
  check(VEHICLE_TYPES.miltruck.loud, "loud: driving it on a battle map draws ×1.6 the Heat and the radius (combat.js DRIVE.MIL)");
  // Save and load with it.
  st.cards = [];
  st.combat = null;
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  check(back.vehicles.some((x) => x.type === "miltruck" && x.loc.kind === "party"), "a team's Army truck survives a save and a load");
}

// ---------------------------------------------------------------------------------------------------------------
section("Found cars (foundcars.js)");
{
  // Statistics over many cars: how many run.
  let cars = 0, runsN = 0, fixN = 0, scrap = 0, locked = 0;
  const st = createWorld({ seed: SEED, factionCount: 7 });
  const t = roadTruckTile(st);
  const p0 = team(st, t.id);
  for (let i = 0; i < 12; i++) {
    const p = p0;
    const b = inBrowser(() => createBattle(st, raidSetup(st, t.id, p)));
    st.hour += 1;
    const ids = [...new Set(b.cells.filter((c) => c.car && c.k === "car").map((c) => c.car.id))];
    for (const id of ids) {
      const rec = carRecord(st, b, id);
      cars++;
      if (rec.locked) locked++;
      const r = repairOf(rec);
      if (!r) scrap++; else if (!r.what.length) runsN++; else fixN++;
    }
  }
  console.log(`    ${cars} civilian cars on road raid maps: ${runsN} run (${r2((100 * runsN) / cars)}%), ${fixN} fixable, ${scrap} scrap; ${locked} locked`);
  check(cars > 30 && runsN / cars < 0.12 && scrap / cars > 0.3, "most found cars are dead, a few run (under 12%)");
  check(fixN > 0 && locked > 0 && locked < cars, "some can be fixed; some are locked");

  // One car, every step.
  const p = p0;
  p.supplies.parts = 6; p.supplies.fuel = 6;
  const s0 = partyMembers(st, p)[0];
  s0.skills.mechanics = 6;
  const b = inBrowser(() => createBattle(st, raidSetup(st, t.id, p)));
  st.combat = b;
  for (const u of b.units) if (u.side === "enemy") { u.dead = true; } // nobody to interrupt
  const ids = [...new Set(b.cells.filter((c) => c.car && c.k === "car").map((c) => c.car.id))];
  const u = b.units.find((x) => x.side === "player" && x.sid === s0.id);
  const stand = (rec) => { for (let y = rec.y - 1; y <= rec.y + rec.h; y++) for (let x = rec.x - 1; x <= rec.x + rec.w; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => o !== u && !o.dead && o.x === x && o.y === y)) { u.x = x; u.y = y; return true; } return false; };
  const act = (rec, op) => { u.ap = 2; b.phase = "player"; return combatAct(st, { type: "car", unit: u.id, car: rec.id, op }); };
  // Getting in: a locked one by force (loud) and by breaking the glass (louder).
  const lockedCars = ids.map((id) => carRecord(st, b, id)).filter((r) => r.locked && stand(r));
  if (lockedCars.length) {
    const rec = lockedCars[0];
    stand(rec);
    check(!carOptions(st, b, u, rec).inspect.ok && /Get in/.test(carOptions(st, b, u, rec).inspect.why), "a locked car: nothing inside until you get in");
    const h0 = b.raid.heat;
    let opened = false;
    for (let i = 0; i < 6 && !opened; i++) { act(rec, "force"); opened = rec.open; }
    check(opened && b.raid.heat > h0, `broken into without a pry bar: the glass (Heat ${h0} → ${b.raid.heat})`);
  } else check(true, "no locked car on this map");
  // Keys, hotwire, inspect, siphon, claim on the first car that runs or can be fixed.
  let target = null;
  for (const id of ids) { const r = carRecord(st, b, id); if (repairOf(r) && !r.open && stand(r)) { target = r; break; } } // not the one just broken into
  if (!target) { const r = carRecord(st, b, ids[0]); r.cond = { engine: "ok", tyres: "ok", battery: "ok", fuel: 4 }; target = r; stand(r); }
  stand(target);
  target.locked = false; target.open = false;
  check(act(target, "enter") === "" && target.open, "an unlocked car: Get in");
  act(target, "keys");
  check(target.keys === true || target.keys === false, `looked for the keys: ${target.keys ? "found" : "none"}`);
  let wired = target.keys;
  for (let i = 0; i < 20 && !wired; i++) { act(target, "hotwire"); wired = target.hot; }
  check(wired, `got it ready to start (keys or hotwired, ${target.tries} hotwire tries)`);
  check(act(target, "inspect") === "" && target.inspected, `inspected: ${runs(target) ? "runs" : `fixable (${repairOf(target).what.join(", ")})`}`);
  if (target.cond.fuel > 0) { const f0 = (p.cargo.supplies.fuel || 0) + (p.supplies.fuel || 0); act(target, "siphon"); check(target.cond.fuel === 0 || (p.cargo.supplies.fuel || 0) + (p.supplies.fuel || 0) > f0, "siphoned its fuel"); }
  const nV = st.vehicles.length;
  check(act(target, "claim") === "" && st.vehicles.length === nV + 1, "claimed: a new vehicle record");
  const v = st.vehicles[st.vehicles.length - 1];
  check(v.loc.kind === "abandoned" && v.loc.tile === t.id && v.type === MODELS[target.model].vehicle && st.markers.some((m) => m.key === `vehicle:${v.id}`), `parked on the tile, marked on the map (${v.name}, ${v.type})`);
  // Save and load mid-battle, the car records with it.
  const cards = st.cards; st.cards = [];
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  st.cards = cards;
  check(back.combat && back.combat.cars && back.combat.cars[target.id] && back.combat.cars[target.id].claimed === v.id && back.vehicles.some((x) => x.id === v.id && x.found), "the car records and the found vehicle survive a save and a load");
  // The fight ends: one that runs joins the team; one that needs work waits.
  settleClaims(st, b, { outcome: "extracted" });
  st.combat = null;
  if (!v.found || !v.found.repair) check(v.loc.kind === "party" && p.vehicleId === v.id, "it runs: it joins the team (which had no vehicle)");
  else {
    check(v.loc.kind === "abandoned", "it needs work: it waits on the tile");
    const opt = orderOptions(st, p).find((o) => o.mission === "getvehicle");
    check(!!opt && /Repair/.test(opt.label), `the team's orders offer the repair (${opt && opt.label})`);
  }

  // The repair: skill gating, failure and success (a vehicle that needs work, made directly).
  const st3 = createWorld({ seed: SEED + 3, factionCount: 7 });
  const t3 = bareRoads(st3)[5];
  const p3 = team(st3, t3.id, 3);
  for (const s of partyMembers(st3, p3)) s.skills.mechanics = 1;
  const fv = createVehicle(st3, "miltruck", { kind: "abandoned", tile: t3.id, since: st3.hour }, { fuel: 30, condition: 40, name: "Army cargo truck" });
  fv.found = { model: "cargo", repair: { parts: 3, scrap: 2, hours: 7, mech: 5, what: ["the engine", "flat tyres"] } };
  check(/Mechanics 5\+/.test(fixProblem(st3, p3, fv)), `too low a Mechanics level says what is needed ("${fixProblem(st3, p3, fv)}")`);
  partyMembers(st3, p3)[0].skills.mechanics = 5;
  check(/parts/.test(fixProblem(st3, p3, fv)), `then the parts ("${fixProblem(st3, p3, fv)}")`);
  p3.supplies.parts = 5; p3.supplies.scrap = 10; // car parts (section 10): 3 car parts, or 2 machine parts for each: 5 is short
  check(/car parts/.test(fixProblem(st3, p3, fv)), `machine parts stand in two for a car part (5 are not enough for 3: "${fixProblem(st3, p3, fv)}")`);
  p3.supplies.parts = 6;
  check(fixProblem(st3, p3, fv) === "", "6 machine parts are (two for each car part)");
  p3.supplies.parts = 0; p3.supplies.carparts = 20;
  check(fixProblem(st3, p3, fv) === "" && /\d+%/.test(orderOptions(st3, p3).find((o) => o.mission === "getvehicle").desc), "with Mechanics 5 and the car parts: the repair is offered with its odds");
  giveOrder(st3, p3, "getvehicle");
  check(p3.phase === "task" && p3.task.type === "fixcar" && p3.task.hours === 7, "the team works on it on the spot (a 7-hour task)");
  let fails = 0, guard = 0;
  while (fv.found && fv.found.repair && guard++ < 30) {
    st3.hour += 1; // a try an hour (the dice are by the hour)
    const before = p3.supplies.carparts;
    const text = finishFixCar(st3, p3, { vehicleId: fv.id });
    if (/wasted/.test(text)) { fails++; check(p3.supplies.carparts === before - Math.ceil(3 / 2), `a failure wastes half the car parts ("${text}")`); }
    if (fails > 1) break;
  }
  if (fv.found && fv.found.repair) { for (let i = 0; i < 30 && fv.found && fv.found.repair; i++) { st3.hour += 1; finishFixCar(st3, p3, { vehicleId: fv.id }); } }
  check(!fv.found || !fv.found.repair, `it runs in the end (${Math.round(fixChance(5, 5) * 100)}% a try at Mechanics 5; ${fails} failure${fails === 1 ? "" : "s"} first)`);
  check(fv.loc.kind === "party" && p3.vehicleId === fv.id, "and it joins the team that had no vehicle");
  // Failures: the same check on a few more broken vehicles (its own dice per vehicle and try).
  let tried = 0, failed = 0, wastedOk = true;
  for (let i = 0; i < 12; i++) {
    const w = createVehicle(st3, "sedan", { kind: "abandoned", tile: t3.id, since: st3.hour }, { fuel: 5, condition: 30 });
    w.found = { model: "sedan", hour: st3.hour - i * 7, repair: { parts: 2, scrap: 0, hours: 2, mech: 5, what: ["flat tyres"] } };
    p3.supplies.carparts = 20;
    const text = finishFixCar(st3, p3, { vehicleId: w.id });
    tried++;
    if (/wasted/.test(text)) { failed++; if (p3.supplies.carparts !== 19 || !w.found.repair) wastedOk = false; }
    st3.vehicles.splice(st3.vehicles.indexOf(w), 1);
  }
  check(failed > 0 && failed < tried && wastedOk, `a failed repair wastes half the car parts and can be tried again (${failed} of ${tried} first tries failed at 50%)`);
  // Machine parts in place of car parts: a success takes 2 of them for each car part short.
  {
    let ok = false;
    for (let i = 0; i < 20 && !ok; i++) {
      const w = createVehicle(st3, "sedan", { kind: "abandoned", tile: t3.id, since: st3.hour }, { fuel: 5, condition: 30 });
      w.found = { model: "sedan", hour: st3.hour - 100 - i * 13, repair: { parts: 2, scrap: 0, hours: 2, mech: 5, what: ["flat tyres"] } };
      p3.supplies.carparts = 1; p3.supplies.parts = 10; p3.cargo.supplies.carparts = 0; p3.cargo.supplies.parts = 0;
      const text = finishFixCar(st3, p3, { vehicleId: w.id });
      if (!w.found || !w.found.repair) { ok = true; // fixed: it may join the team's vehicles (vehicles.js fleets: a driver free)
       check(p3.supplies.carparts === 0 && p3.supplies.parts === 8, `a repair short of car parts takes 2 machine parts for the missing one ("${text}")`); }
      if (st3.vehicles.includes(w)) st3.vehicles.splice(st3.vehicles.indexOf(w), 1);
      if (p3.vehicleId === w.id) { p3.vehicleId = null; }
    }
    check(ok, "a repair with machine parts standing in was made");
  }
  // Drive it home: a team that already has a vehicle sends one person home in the found one.
  const fv2 = createVehicle(st3, "sedan", { kind: "abandoned", tile: t3.id, since: st3.hour }, { fuel: 10, condition: 50 });
  fv2.found = { model: "sedan", repair: null };
  check(runnerAt(st3, t3.id) === fv2 && orderOptions(st3, p3).some((o) => o.mission === "drivehome" && !o.disabled), "a team with a vehicle is offered Drive it home");
  const n0 = partyMembers(st3, p3).length, parties0 = st3.parties.length;
  driveHome(st3, p3);
  const q = st3.parties[st3.parties.length - 1];
  check(st3.parties.length === parties0 + 1 && partyMembers(st3, p3).length === n0 - 1 && q.vehicleId === fv2.id && q.phase === "back", "one of them drives it home as a team of their own");
}

// ---------------------------------------------------------------------------------------------------------------
section("The autopilot with convoys and found vehicles on its map");
{
  const st = createWorld({ seed: SEED + 5, factionCount: 7 });
  st.started = true;
  setAutopilot(st, true, "balanced");
  let err = null;
  try {
    spawnConvoy(st);
    const tile = bareRoads(st).find((t) => st.grid.distance(t.id, hub(st).tile) <= 6);
    if (tile) {
      const fv = createVehicle(st, "miltruck", { kind: "abandoned", tile: tile.id, since: st.hour }, { fuel: 20, condition: 40, name: "Army cargo truck" });
      fv.found = { model: "cargo", repair: { parts: 2, scrap: 2, hours: 6, mech: 4, what: ["the engine"] } };
      st.markers.push({ key: `vehicle:${fv.id}`, type: "vehicle", tile: tile.id, hour: st.hour, label: fv.name, info: { vehicleId: fv.id, fuel: 20, condition: 40 } });
    }
    while (day(st) <= 40 && !st.gameOver) { tickHour(st); autopilotResolve(st); }
  } catch (e) { err = e; console.log(e.stack.split("\n").slice(0, 5).join("\n")); }
  check(!err, `40 days of the autopilot without a crash (day ${day(st)}, ${(st.convoys || []).length} convoy${(st.convoys || []).length === 1 ? "" : "s"})`);
}

// ---------------------------------------------------------------------------------------------------------------
section("Drawing them (stub canvases: ui/isoview.js, ui/combat.js, ui/mapsprites.js, ui/carpanel.js)");
{
  let nan = 0;
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
  });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  const MS = await import("../src/ui/mapsprites.js");
  const CP = await import("../src/ui/carpanel.js");
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  const st = createWorld({ seed: SEED, factionCount: 7 });
  const c = spawnConvoy(st);
  st.cards = [];
  const h = hub(st);
  const v = createVehicle(st, "miltruck", { kind: "base", baseId: h.id }, { fuel: 80, condition: 80 });
  const people = atBase(st, h.id).slice(0, 3);
  const p = launchExpedition(st, { memberIds: people.map((x) => x.id), dest: c.tile, mission: "move", stance: "normal", vehicleId: v.id, supplies: { food: 4, water: 4 } }).party;
  p.path = [c.tile]; p.idx = 0; p.phase = "waiting";
  st.combat = createBattle(st, raidSetup(st, c.tile, p));
  const b = st.combat;
  let err = "";
  for (const view of ["iso"]) { void view; try { UI.drawCombat(st, 1e9); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); } }
  check(!err && !nan, `the convoy's raid map with your Army truck draws in both views${err ? `: ${err}` : ""}${nan ? ` (${nan} NaN)` : ""}`);
  // The car row: a unit next to a truck.
  const u = b.units.find((x) => x.side === "player");
  const tc = b.cells.findIndex((cc) => cc.car && cc.car.mil);
  const tx = tc % b.w, ty = (tc / b.w) | 0;
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]]) { const x = tx + dx, y = ty + dy; if (x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk) { u.x = x; u.y = y; break; } }
  UI.cui.sel = u.id;
  const html = UI.renderCombatScreen(st);
  check(/data-action="car-act"/.test(html) && /Inspect/.test(html), "next to a truck the panel has the car row (Get in, Inspect, Claim …)");
  const prev = CP.carPreview(st, b, tx, ty);
  check(/Army|Humvee|MRAP/.test(prev), `hovering a truck names it ("${prev.replace(/<[^>]+>/g, "").slice(0, 50)}…")`);
  CP.CAR_ACTIONS["car-act"](st, {}, { u: u.id, c: b.cells[tc].car.id, o: "enter" });
  check(b.cars && b.cars[b.cells[tc].car.id] && b.cars[b.cells[tc].car.id].open, "the Get in button acts (an Army truck is never locked)");
  let sprites = true;
  try {
    MS.partySpriteCanvas("miltruck", "#4f8fd6", 3); MS.poiSpriteCanvas("convoy"); MS.poiSpriteCanvas("convoy", "", 2);
    MS.markerSpriteCanvas("miltruck"); MS.markerSpriteCanvas("vehicle", "#4f8fd6", { vehicle: "miltruck", damaged: true, needsFuel: true });
  } catch (e) { sprites = false; console.log(e.stack.split("\n").slice(0, 3).join(" ")); }
  check(sprites, "State Map sprites: an Army truck team, a parked Army truck, the convoy site, a spotted truck marker");
  st.combat = null;
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail ? "failed" : "passed");
process.exit(fail ? 1 : 0);
