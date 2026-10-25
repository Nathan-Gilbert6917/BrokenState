// The neighbourhood's street of houses (src/sim/buildingmaps.js streetMap; combat.js createRaid, poicont.js,
// scavenge.js).
// Usage: node tools/neighbourhoodtest.js [seed]
// - generation: 3–5 houses (streetHouses), the map the run's largest raid map (battlesize.js raidMaxDims; World… Raid map, largest), a small dial never narrower than its houses, the same street every
//   time (and with a vehicle, from another side), houses apart and inside the map, rooms and containers numbered on
//   (areas[id] is the room with that id, container ids 1..n), every house with rooms, a stairwell and containers
// - every house reachable: from the west end every walkable cell of the ground floor (locked doors and a scene's barricades as ways through),
//   every house's front door, every container; upstairs every container from a stairwell; every zone
// - the raid on it (createBattle): one POI map ("poi<i>:neighbourhood"), its storeys, the upper floors' reach from
//   every house's stairs, the intro naming the houses, the dead of the whole roster (more than one house's map)
// - per-house containers in the POI's ledger: a house opened and left, another never entered; the revisit shows the
//   first as left (and says so) and the other fresh; the one pool falls by each container's share across the street
// - depletion across the houses: a second house opened on a later raid takes the same share; others' abstract looting
//   ransacks containers in several houses; a house picked clean says so
// - the headless search: one POI with a larger pool (falls poiHouses times slower than the same search in a house)
// - a combat smoke run: the raid bot through a raid with the roster and a revisit (no exception, the ledger saved)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, runEnemyPhase, autoPlayerTurn, finishCombat, searchBox, endPlayerTurn, CELL } from "../src/sim/combat.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { newItem } from "../src/sim/inventory.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { poisOf, poiAt, poiPool, poiFull, isSitePoi, knownPois } from "../src/sim/pois.js";
import { poiRaidSetup, poiPlace } from "../src/sim/poiraid.js";
import { contKey, ledgerBox, lootPoiAbstract, poiHouses } from "../src/sim/poicont.js";
import { buildingMap, streetHouses, STREET, BUILDINGS } from "../src/sim/buildingmaps.js";
import { raidMaxDims, streetDeadScale } from "../src/sim/battlesize.js";
import { searchHour, startScavenge, raidEnemies } from "../src/sim/scavenge.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);

const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
function team(st) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  for (const s of crew) { s.skills.scavenging = 6; s.traits = []; s.traitTier = {}; s.perks = []; }
  const go = (vehicleId) => launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId, supplies: { food: 6, water: 6, ammo: 20 } });
  let res = go(st.vehicles[0] ? st.vehicles[0].id : null);
  if (res.error) res = go(null);
  if (res.error) throw new Error(`launch: ${res.error}`);
  st.cards.length = 0;
  res.party.veh0 = res.party.vehicle;
  return res.party;
}
function raid(st, p, t, i, opts = {}) {
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged"; p.vehicle = opts.vehicle ? p.veh0 : null;
  const rs = poiRaidSetup(st, t, i);
  const setup = {
    mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "nobody", groups: opts.groups || [] },
    raid: { heat0: 5, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null },
    ...(opts.side ? { plan: { side: opts.side } } : {}), context: {},
  };
  st.combat = createBattle(st, setup);
  return st.combat;
}
const me = (b) => b.units.find((u) => u.side === "player" && !u.dead);
const boxesOf = (b) => b.raid.containers.filter(ledgerBox);
const open = (st, b, box) => { box.lock = box.lock ? { ...box.lock, open: true } : box.lock; searchBox(st, b, me(b), box, true); return box.contents; };
function end(st, b) {
  for (const u of b.units) if (u.side === "player") u.left = true;
  endPlayerTurn(st);
  runEnemyPhase(st);
  check(b.over, "the raid ends (walked out)");
  finishCombat(st, b.setup, b.result);
}
const itemsSig = (c) => (c ? JSON.stringify({ sup: Object.fromEntries(Object.entries(c.sup || {}).sort()), gear: (c.gear || []).map((g) => g.key) }) : "none");
// Every neighbourhood POI of a world (never the hub's tile or a base's).
const streets = (st) => {
  const out = [];
  for (const t of st.tiles) {
    if (t.id === hub(st).tile || st.bases.some((x) => x.tile === t.id)) continue;
    poisOf(t).forEach((q, i) => { if (q.kind === "neighbourhood" && !isSitePoi(t, i)) out.push([t, i]); });
  }
  return out;
};
const sigMap = (m) => m.floors.map((F) => F.cells.map((c) => c.k[0]).join("")).join("/") + "|" + m.containers.map((c) => `${c.id}:${c.kind}:${c.x},${c.y},${c.f || 0}:${c.area}:${c.house ?? "-"}`).join(" ");
const sigBattle = (b) => boxesOf(b).map((c) => `${c.id}:${c.kind}:${c.x},${c.y},${c.f || 0}:${c.area}`).join(" ");
// Flood over walkable cells (and locked doors, "door": ways through once opened) from (x, y).
function floodFrom(cells, w, h, starts) {
  const seen = new Uint8Array(w * h), q = [];
  const pass = (c) => !!(CELL[c.k] && CELL[c.k].walk) || c.k === "door" || c.k === "boarded" || (!!c.moved && c.hp > 0); // a locked door, and a room a scene barricaded (sim/interiorscenes.js: boards, a shoved piece: torn down or shoved), as ways through
  for (const [x, y] of starts) if (pass(cells[y * w + x]) && !seen[y * w + x]) { seen[y * w + x] = 1; q.push(y * w + x); }
  while (q.length) {
    const i = q.pop(), x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}
const ring = (c) => { const w = c.w || 1, h = c.h || 1, out = []; for (let y = c.y - 1; y <= c.y + h; y++) for (let x = c.x - 1; x <= c.x + w; x++) if ((x < c.x || x >= c.x + w || y < c.y || y >= c.y + h) && (x === c.x - 1 || x === c.x + w || y === c.y - 1 || y === c.y + h) && !((x === c.x - 1 || x === c.x + w) && (y === c.y - 1 || y === c.y + h))) out.push([x, y]); return out; };

section("Generation: the street, the same every time");
let tried = 0;
{
  const [MW, MH] = raidMaxDims(null);
  const counts = {};
  for (const s of [seed, seed + 1, seed + 2]) {
    const st = W(s);
    const list = streets(st);
    if (!check(list.length > 0, `seed ${s}: neighbourhoods on the map (${list.length})`)) continue;
    for (const [t, i] of list.slice(0, 6)) {
      tried++;
      const pl = poiPlace(t, i);
      const m = buildingMap(st, t.id, pl, false), m2 = buildingMap(st, t.id, pl, false), mv = buildingMap(st, t.id, pl, "car");
      const tag = `seed ${s} tile ${t.id} POI ${i}`;
      const n = m.plan.houses.length;
      counts[n] = (counts[n] || 0) + 1;
      check(pl.key === "neighbourhood" && BUILDINGS.neighbourhood.street && n === streetHouses(st, t.id, pl) && n >= STREET.HOUSES[0] && n <= STREET.HOUSES[1] && poiHouses(st, t, i) === n, `${tag}: ${n} houses (streetHouses, poiHouses)`);
      check(m.w === MW && m.h === MH, `${tag}: ${m.w} × ${m.h} the largest raid map (${MW} × ${MH})`);
      check(sigMap(m) === sigMap(m2), `${tag}: the same street twice`);
      check(m.containers.map((c) => `${c.id}:${c.kind}:${c.x},${c.y},${c.f || 0}:${c.area}`).join(" ") === mv.containers.map((c) => `${c.id}:${c.kind}:${c.x},${c.y},${c.f || 0}:${c.area}`).join(" "), `${tag}: the same containers with a vehicle`);
      check(m.rooms.every((a, k) => a.id === k) && m.containers.every((c, k) => c.id === k + 1 && m.rooms[c.area]), `${tag}: rooms numbered on (areas[id]), containers 1..${m.containers.length}, each in a room`);
      const R = m.plan.houses;
      const apart = R.every((a, j) => R.every((b, k) => j === k || a.x0 + a.w + 1 < b.x0 || b.x0 + b.w + 1 < a.x0 || a.y0 + a.h + 1 < b.y0 || b.y0 + b.h + 1 < a.y0));
      check(apart && R.every((h) => h.x0 >= 1 && h.y0 >= 1 && h.x0 + h.w < m.w && h.y0 + h.h < m.h), `${tag}: the houses stand apart, inside the map`);
      const per = R.map((h) => ({ rooms: m.rooms.filter((a) => a.house === h.k).length, boxes: m.containers.filter((c) => c.house === h.k).length, up: m.containers.filter((c) => c.house === h.k && c.f > 0).length, stairs: m.stairs.filter(([x, y]) => x >= h.x0 && x < h.x0 + h.w && y >= h.y0 && y < h.y0 + h.h).length }));
      check(per.every((q) => q.rooms >= 4 && q.boxes >= 3 && q.stairs >= 1 && q.up >= 1), `${tag}: every house has rooms, a stairwell, containers on both floors (${per.map((q) => `${q.rooms}r/${q.boxes}c`).join(", ")})`);
      check(R.every((h) => m.rooms.filter((a) => a.house === h.k).every((a) => a.x0 >= h.x0 && a.y0 >= h.y0 && a.x0 + a.w <= h.x0 + h.w && a.y0 + a.h <= h.y0 + h.h)), `${tag}: every room inside its house`);
      check(m.containers.filter((c) => c.house == null).every((c) => c.kind === "car" && m.rooms[c.area].type === "wreck"), `${tag}: the rest are the cars on the street (${m.containers.filter((c) => c.house == null).length})`);
      check(new Set(R.map((h) => h.name)).size === n && m.rooms.filter((a) => a.house != null).every((a) => a.name.endsWith(R[a.house].name)), `${tag}: houses numbered, rooms named after them (${R.map((h) => h.name).join(", ")})`);
      // Reachability.
      const z = m.zones[0];
      const g = floodFrom(m.cells, m.w, m.h, [[z.x0 + 1, z.y0 + 1]]);
      let walk = 0, got = 0;
      m.cells.forEach((c, j) => { if ((CELL[c.k] && CELL[c.k].walk) || c.k === "door") { walk++; if (g[j]) got++; } });
      check(walk === got, `${tag}: every walkable cell of the ground floor reached from the west end (${got}/${walk})`);
      check(R.every((h) => h.front && g[h.front.y * m.w + h.front.x]) && m.zones.every((q) => g[(q.y0 + 1) * m.w + q.x0 + 1]), `${tag}: every house's front door and every way out reached`);
      const up = m.floors.slice(1).map((F) => floodFrom(F.cells, m.w, m.h, m.stairs));
      const reachBox = (c) => ring(c).some(([x, y]) => x >= 0 && y >= 0 && x < m.w && y < m.h && (c.f ? up[c.f - 1] : g)[y * m.w + x]);
      check(m.containers.every(reachBox), `${tag}: every container can be searched from a reachable cell (${m.containers.filter((c) => !reachBox(c)).map((c) => c.label).join("; ") || "all"})`);
      check(m.zones.length === 4 && m.zones[0].side === "west" && new Set(m.zones.map((q) => q.side)).size === 4, `${tag}: the ways out: ${m.zones.map((q) => q.name).join(", ")}`);
    }
  }
  check(Object.keys(counts).length >= 2, `streets of different lengths (${JSON.stringify(counts)})`);
}

section("The raid on it");
let world = null;
{
  const st = W();
  const p = team(st);
  const [t, i] = streets(st)[0];
  poiAt(t, i).pool = Math.max(poiAt(t, i).pool, poiFull(t, i)); // untouched (a pool that starts below its full share finds that share ransacked at the first raid: poicont.js)
  const b = raid(st, p, t, i);
  const R = b.raid;
  check(R.interior && R.interior.key === "neighbourhood" && R.plan.street && R.poiMap === `poi${i}:neighbourhood`, `one POI map (${R.poiMap})`);
  check(b.floors && b.floors.length === 2 && R.storeys === 2 && R.stairs.length >= R.plan.houses.length, `two storeys, ${R.stairs.length} stairwells in ${R.plan.houses.length} houses`);
  const upBoxes = R.containers.filter((c) => c.f === 1);
  const upOk = upBoxes.every((c) => ring(c).some(([x, y]) => b.floors[1].reach[y * b.w + x]));
  check(upOk && upBoxes.length >= R.plan.houses.length, `the upper floors are reached from every house's stairs (${upBoxes.length} containers upstairs)`);
  const intro = b.log.map((l) => l.text).join(" ");
  check(/street at/.test(intro) && R.plan.houses.every((h) => intro.includes(h.name)) && /Ways out: west end of the street/.test(intro), "the intro names the houses and the ways out");
  check(sigBattle(raid(st, p, t, i, { vehicle: true })) === sigBattle(b) && sigBattle(raid(st, p, t, i, { side: "south" })) === sigBattle(b), "the same containers with a vehicle and from the back gardens");
  const sb = raid(st, p, t, i, { side: "south" });
  check(sb.raid.zones[0].side === "south" && sb.units.filter((u) => u.side === "player").every((u) => Math.abs(u.y - sb.h) < 6), "coming in from the back gardens starts the team there");
  // The dead: the whole roster on a street; a lone house's map takes about 0.6 of it.
  const groups = [{ kind: "zombies", count: 12, power: 2, name: "the dead" }];
  const bz = raid(st, p, t, i, { groups });
  const dead = bz.units.filter((u) => u.side === "enemy");
  const inHouse = new Set(dead.map((u) => (bz.raid.plan.houses.find((h) => u.x >= h.x0 && u.x < h.x0 + h.w && u.y >= h.y0 && u.y < h.y0 + h.h) || { k: "out" }).k));
  const house = st.tiles.map((tt) => [tt, poisOf(tt).findIndex((q, j) => q.kind === "house" && !isSitePoi(tt, j))]).find(([, j]) => j >= 0);
  const hz = house ? raid(st, p, house[0], house[1], { groups }).units.filter((u) => u.side === "enemy").length : 0;
  const want = Math.round(12 * streetDeadScale(bz.w, bz.h));
  check(dead.length === want && want >= 12 && dead.length > hz && inHouse.size >= 3, `the dead: ${dead.length} on the street (12 × ${streetDeadScale(bz.w, bz.h).toFixed(2)} for the bigger map), ${hz} in a lone house; spread over ${inHouse.size} houses and the yards`);
  st.combat = null;
  world = { st, p, t, i };
}

section("Per-house containers in the POI's ledger");
{
  const { st, p, t, i } = world;
  const pool0 = poiPool(t, i);
  const b = raid(st, p, t, i);
  const houses = b.raid.plan.houses;
  const A = houses[0], Bh = houses[houses.length - 1];
  const inA = boxesOf(b).filter((c) => c.house === A.k), inB = boxesOf(b).filter((c) => c.house === Bh.k);
  check(inA.every((c) => !c.contents) && inB.every((c) => !c.contents), `a fresh street: ${boxesOf(b).length} containers unopened (pool ${pool0.toFixed(2)})`);
  for (const c of inA) open(st, b, c);
  const left = inA.find((c) => c.contents);
  left.contents.gear.push(newItem("flashlight", 1));
  left.contents.sup.food = (left.contents.sup.food || 0) + 3;
  const saved = Object.fromEntries(inA.map((c) => [c.id, itemsSig(c.contents)]));
  end(st, b);
  const L = poiAt(t, i).cont, mapId = `poi${i}:neighbourhood`;
  const keys = Object.keys(L.mine);
  check(keys.length === inA.length && inA.every((c) => L.mine[contKey(mapId, c.id)]), `${A.name}'s ${inA.length} containers are in the ledger, nothing else (${keys.length})`);
  check(inB.every((c) => !L.mine[contKey(mapId, c.id)] && !L.looted[contKey(mapId, c.id)]), `${Bh.name}, never entered, is not`);
  const per = poiFull(t, i) / L.maps[mapId].length;
  check(L.maps[mapId].length === boxesOf(b).length && Math.abs(pool0 - poiPool(t, i) - inA.length * per) < 1e-9, `the one pool fell by ${A.name}'s containers' share of the street (${pool0.toFixed(3)} → ${poiPool(t, i).toFixed(3)}, ${per.toFixed(4)} each of ${L.maps[mapId].length})`);
  // Save / load, then the revisit.
  st.cards.length = 0;
  const st2 = deserializeState(serializeState(st));
  const p2 = st2.parties.find((x) => x.id === p.id);
  const t2 = st2.tiles[t.id];
  st2.hour += 30;
  const b2 = raid(st2, p2, t2, i);
  const at = (id) => b2.raid.containers.find((c) => c.id === id);
  check(inA.every((c) => itemsSig(at(c.id).contents) === saved[c.id] && at(c.id).mine), `after a save and load, ${A.name} is as it was left (the flashlight and the cans too)`);
  check(inB.every((c) => !at(c.id).contents && b2.raid.poiFresh.includes(c.id)), `${Bh.name} is still unopened`);
  check(new RegExp(`been through ${A.name.replace(".", "\\.")} before`).test(b2.log.map((l) => l.text).join(" ")), "the intro says which house you went through");
  // Depletion across the houses: the second house's containers take the same share.
  const pool1 = poiPool(t2, i);
  const inB2 = boxesOf(b2).filter((c) => c.house === Bh.k);
  for (const c of inB2) open(st2, b2, c);
  end(st2, b2);
  check(Math.abs(pool1 - poiPool(t2, i) - inB2.length * per) < 1e-9, `${Bh.name} opened on the next raid: the pool falls by the same share (${pool1.toFixed(3)} → ${poiPool(t2, i).toFixed(3)})`);
  // Others' abstract looting thins the street: containers in several houses ransacked.
  lootPoiAbstract(st2, 3, t2, i, 0.25);
  const L2 = poiAt(t2, i).cont;
  const b3 = raid(st2, p2, t2, i);
  const robbedIn = new Set(boxesOf(b3).filter((c) => c.ransacked === 3 && c.house != null).map((c) => c.house));
  check(robbedIn.size >= 2, `another group's raid ransacked containers in ${robbedIn.size} houses (${Object.values(L2.looted).filter((x) => x === 3).length} containers)`);
  const leftItem = boxesOf(b3).some((c) => c.house === A.k && c.contents && c.contents.gear.some((g) => g.key === "flashlight"));
  check(leftItem || L2.looted[contKey(mapId, left.id)] === 3, "the flashlight you left is still there, or that group took it (marked looted by them)");
  st2.combat = null;
  // Picked clean: every house's containers ransacked, the intro says they look ransacked.
  lootPoiAbstract(st2, 3, t2, i, 2);
  const b4 = raid(st2, p2, t2, i);
  check(boxesOf(b4).filter((c) => !c.mine).every((c) => c.ransacked != null) && /look ransacked|looks ransacked/.test(b4.log.map((l) => l.text).join(" ")) || boxesOf(b4).every((c) => c.mine), "a stripped street: every container you never opened is ransacked, and the intro says so");
  st2.combat = null;
}

section("The headless search: one POI with a larger pool");
{
  const st = W();
  const p = team(st);
  const [t, i] = streets(st).find(([tt, j]) => knownPois(st, tt, p).includes(j)) || streets(st)[0];
  const n = poiHouses(st, t, i);
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.poi = i; p.phase = "arrived";
  st.engagement = null;
  startScavenge(st, p);
  const e = st.engagement;
  check(e && e.poi === i, "the search goes into the neighbourhood as one POI");
  e.approach = "normal";
  const pool0 = poiPool(t, i);
  searchHour(st);
  const drop = pool0 - poiPool(t, i);
  check(Math.abs(drop - 0.05 / n) < 1e-9, `an hour takes a house's share: ${drop.toFixed(4)} of the pool (0.05 / ${n} houses)`);
  let h = 1;
  while (!e.done && e.poi === i && h < 400 && poiPool(t, i) > 0.06) { e.heat = 0; searchHour(st); h++; } // kept quiet: the hours, not the dead
  const house = (pool0 - 0.06) / 0.05;
  check(!e.done && h >= (n - 0.5) * house, `it takes ${n} times the hours a house of that pool would (${h} hours to ${poiPool(t, i).toFixed(2)}, a house ${Math.ceil(house)})`);
  st.engagement = null;
}

section("Combat smoke: the raid bot on the street, and a revisit");
{
  const st = W(seed + 1);
  const p = team(st);
  const [t, i] = streets(st)[0];
  let ok = true, err = null;
  try {
    const groups = raidEnemies(st, t.id).filter((g) => !g.side);
    const b = raid(st, p, t, i, { groups });
    let guard = 0;
    while (!b.over && guard++ < 300) { autoPlayerTurn(st); runEnemyPhase(st); }
    check(b.over, `the bot finishes the raid (${b.result ? b.result.outcome : "not over"}, ${b.result ? b.result.raid.searched : 0}/${b.result ? b.result.raid.total : 0} searched, ${b.units.filter((u) => u.side === "enemy").length} enemies)`);
    const opened = boxesOf(b).filter((c) => c.contents && (c.mine || c.ransacked == null)).map((c) => [c.id, itemsSig(c.contents)]); // not one that spawned ransacked and stayed empty
    finishCombat(st, b.setup, b.result);
    const L = poiAt(t, i).cont;
    check(opened.every(([id, s]) => L.mine[contKey(b.raid.poiMap, id)] && itemsSig(L.mine[contKey(b.raid.poiMap, id)].contents) === s), `every container the bot opened is saved (${opened.length})`);
    if (partyMembers(st, p).length) {
      st.hour += 48;
      const b2 = raid(st, p, t, i, { groups: [{ kind: "zombies", count: 6, power: 2, name: "the dead" }] });
      guard = 0;
      while (!b2.over && guard++ < 300) { autoPlayerTurn(st); runEnemyPhase(st); }
      check(b2.over, "the bot finishes the revisit");
      finishCombat(st, b2.setup, b2.result);
    }
  } catch (e) { ok = false; err = e; }
  check(ok, `no exception${err ? `: ${err.stack}` : ""}`);
}

console.log(`\n${passes} passed, ${fails} failed (${tried} streets generated)`);
process.exit(fails ? 1 : 0);
