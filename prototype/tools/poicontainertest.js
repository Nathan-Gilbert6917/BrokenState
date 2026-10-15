// Containers that persist per point of interest (src/sim/poicont.js; combat.js createRaid / searchBox, scavenge.js
// afterRaid / searchHour, locks.js).
// Usage: node tools/poicontainertest.js [seed]
// - layout: the same POI gives the same containers (ids, kinds, places) on every visit: with or without a vehicle,
//   from another side, hours later; a building POI, a street-map POI, a site's street map and one of its buildings
// - contents: a POI container's contents come from its own dice (the seed, the tile, the POI, the map, the id): the
//   same at another hour and in another world on the same seed, never drawn from state.rng; a non-POI raid still is
// - the ledger through a raid that ends by walking out: what was taken, put in (a swap) and left hidden by a rummage
//   is saved for every opened container, the unopened ones are not in the ledger; the pool falls by the opened
//   ones' share only; a revisit shows them as left and an unopened one still holds its original things
// - the other ends: a retreat, a wipe (every container your side opened is saved either way)
// - looted containers spawn empty, open and ransacked; the fresh share follows the pool (abstract looting)
// - abstract looting takes what you left (at risk), marks the container looted by that group, adds tile heat, and
//   the dialogue says "looted by others since your visit"; items you leave never raise the pool or the band
// - your own headless search takes through the same ledger (the pool, the containers, what you left goes in the finds)
// - save / load keeps the ledger; determinism of a whole round trip
// - the raid bot (combat.js autoRaidTurn) through a raid and a revisit of the same POI
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, runEnemyPhase, autoPlayerTurn, finishCombat, searchBox, endBattleNow, endPlayerTurn, chooseBuilding } from "../src/sim/combat.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { newItem } from "../src/sim/inventory.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { poisOf, poiAt, poiPool, poiFull, poiBand, isSitePoi, tileHeat, TILE_HEAT, knownPois } from "../src/sim/pois.js";
import { poiRaidSetup, poiContainerNote } from "../src/sim/poiraid.js";
import { contKey, ledgerBox, lootPoiAbstract, syncLedger, ledgerSummary, poiMapCount, CONT } from "../src/sim/poicont.js";
import { searchHour, startScavenge } from "../src/sim/scavenge.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);

const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
// A team of two from the hub (one launch per world: the raids reuse it), standing on the tile of each raid.
function team(st, opts = {}) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  for (const s of crew) { s.skills.scavenging = 6; s.traits = []; s.traitTier = {}; s.perks = []; }
  const go = (vehicleId) => launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId, supplies: { food: 6, water: 6, ammo: 20 } });
  let res = go(st.vehicles[0] ? st.vehicles[0].id : null);
  if (res.error) res = go(null); // the car is out (with an earlier team)
  if (res.error) throw new Error(`launch: ${res.error}`);
  st.cards.length = 0;
  const p = res.party;
  p.veh0 = p.vehicle;
  return p;
}
// A raid on POI i of tile t as the browser starts it (scavenge.js startScavenge's setup), on its map, no enemies.
function raid(st, p, t, i, opts = {}) {
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged"; p.vehicle = opts.vehicle ? p.veh0 : null;
  const rs = poiRaidSetup(st, t, i);
  const setup = {
    mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "nobody", groups: opts.groups || [] },
    raid: { heat0: 5, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null, ...(opts.building ? { building: opts.building, choose: false } : {}) },
    ...(opts.side ? { plan: { side: opts.side } } : {}), context: {},
  };
  st.combat = createBattle(st, setup);
  return st.combat;
}
const me = (b) => b.units.find((u) => u.side === "player" && !u.dead);
const boxesOf = (b) => b.raid.containers.filter(ledgerBox);
const sig = (b) => boxesOf(b).map((c) => `${c.id}:${c.kind}:${c.x},${c.y},${c.f || 0}:${c.area}`).join(" ");
const itemsSig = (c) => (c ? JSON.stringify({ sup: Object.fromEntries(Object.entries(c.sup || {}).sort()), gear: (c.gear || []).map((g) => [g.key, g.dur ?? null, g.cond ?? null, g.qty ?? null, g.loaded ?? null]) }) : "none");
const things = (c) => (c ? (c.gear || []).length + Object.values(c.sup || {}).filter((v) => v >= 1).length : 0);
// Open a container (the search window's look: rolled, nothing taken).
const open = (st, b, box) => { box.lock = box.lock ? { ...box.lock, open: true } : box.lock; searchBox(st, b, me(b), box, true); return box.contents; };
// End the raid: everyone walks out ("out"), everyone dead ("wiped"), or the retreat ("retreat"), then the handler.
function end(st, b, how = "out") {
  if (how === "retreat") endBattleNow(st, "retreat");
  else {
    for (const u of b.units) if (u.side === "player") { if (how === "wiped") { u.dead = true; u.hp = 0; } else u.left = true; }
    endPlayerTurn(st);
    runEnemyPhase(st);
  }
  check(b.over, `the raid ends (${how})`);
  finishCombat(st, b.setup, b.result);
}
// A tile with a POI of this kind (not the site), with a building or without.
function findPoi(st, kinds, { site = false } = {}) {
  for (const t of st.tiles) {
    if (t.id === hub(st).tile || st.bases.some((x) => x.tile === t.id)) continue;
    const L = poisOf(t);
    for (let i = 0; i < L.length; i++) if (kinds.includes(L[i].kind) && isSitePoi(t, i) === site && poiPool(t, i) > 0.1) return [t, i];
  }
  return null;
}

section("Layout: the same containers on every visit");
{
  const st = W();
  const p = team(st);
  for (const [kinds, what] of [[["house"], "a house (a building)"], [["campsite", "hikercamp", "blind"], "a camp (the street map)"], [["school", "gas", "garage"], "a school, gas station or garage"]]) {
    const f = findPoi(st, kinds);
    if (!check(!!f, `a ${kinds.join("/")} POI exists`)) continue;
    const [t, i] = f;
    const a = sig(raid(st, p, t, i)), v = sig(raid(st, p, t, i, { vehicle: true })), s = sig(raid(st, p, t, i, { side: "east" }));
    st.hour += 29;
    const later = sig(raid(st, p, t, i));
    st.combat = null;
    check(a && a === v && a === s && a === later, `${what}: the same container ids, kinds and places with a vehicle, from another side, 29 hours later (${boxesOf(raid(st, p, t, i)).length} containers)`);
    st.combat = null;
  }
  const site = st.tiles.find((t) => t.loc && t.loc.type === "farm" && isSitePoi(t, 0));
  if (check(!!site, "a farm site exists")) {
    const a = raid(st, p, site, 0);
    check(!!a.raid.choose && a.raid.poiDice === "poi0:street", `a site POI opens on its street map with its buildings to choose (${a.raid.poiDice})`);
    const sa = sig(a);
    st.hour += 5;
    check(sig(raid(st, p, site, 0, { vehicle: true })) === sa, "the site's street map is the same every visit (its own dice)");
    const fb = sig(raid(st, p, site, 0, { building: "farmhouse" }));
    check(fb && fb === sig(raid(st, p, site, 0, { building: "farmhouse", vehicle: true })), "and so is its farmhouse");
    check(poiMapCount(site, 0) === 3, `the farm site has three maps (farmhouse, barn, the street): ${poiMapCount(site, 0)}`);
    st.combat = null;
  }
}

section("Contents: each container's own dice");
{
  const st1 = W(), st2 = W();
  const p1 = team(st1), p2 = team(st2);
  const [t1, i] = findPoi(st1, ["house"]);
  const t2 = st2.tiles[t1.id];
  const b1 = raid(st1, p1, t1, i);
  st2.hour += 53; // another hour, another world on the same seed
  const b2 = raid(st2, p2, t2, i);
  const rng0 = st1.rng.state;
  const c1 = boxesOf(b1).map((c) => itemsSig(open(st1, b1, c)));
  check(st1.rng.state === rng0, "opening a POI's containers draws nothing from state.rng");
  const c2 = boxesOf(b2).map((c) => itemsSig(open(st2, b2, c)));
  check(c1.length > 3 && c1.every((x, k) => x === c2[k]), `the same POI's containers hold the same things at another hour, in another world (${c1.length} containers, ${c1.filter((x) => x !== itemsSig({ sup: {}, gear: [] })).length} with something)`);
  check(new Set(c1).size > 1, "different containers hold different things");
  const f = findPoi(st1, ["house"]);
  const other = st1.tiles.find((t) => t.id !== t1.id && poisOf(t).some((x, j) => x.kind === "house" && !isSitePoi(t, j) && poiPool(t, j) > 0.1));
  if (other) {
    const j = poisOf(other).findIndex((x, k) => x.kind === "house" && !isSitePoi(other, k));
    const b3 = raid(st1, p1, other, j);
    const c3 = boxesOf(b3).map((c) => itemsSig(open(st1, b3, c)));
    check(c3.join("|") !== c1.join("|"), "another house holds other things");
  }
  // A raid on a tile without POIs (no setup.raid.poi) rolls from state.rng as before.
  const st = W();
  const p = team(st);
  const bare = st.tiles.find((t) => t.loc && !poisOf(t).length && t.terrain !== "water" && t.loc.type !== "town" && t.loc.type !== "city" && t.id !== hub(st).tile);
  if (bare) {
    p.path = [bare.id]; p.idx = 0; p.dest = bare.id; p.vehicle = null;
    const setup = { mode: "raid", tile: bare.id, partyId: p.id, canRetreat: true, ambush: null, handler: "x", enemy: { kind: "zombies", count: 0, power: 3, groups: [] }, raid: { heat0: 5 }, context: {} };
    const b = createBattle(st, setup);
    st.combat = b;
    const r0 = st.rng.state;
    const box = boxesOf(b).find((c) => !c.lock);
    if (box) { searchBox(st, b, me(b), box, true); check(st.rng.state !== r0 && !b.raid.poiDice, `a raid that is not on a POI (${bare.loc.name}) still rolls from state.rng`); }
    st.combat = null;
  }
}

section("The ledger: a raid that walks out, and the revisit");
let roundTrip = null;
{
  const st = W(), twin = W();
  const p = team(st), pt = team(twin);
  const [t, i] = findPoi(st, ["house"]);
  const pool0 = poiPool(t, i);
  const b = raid(st, p, t, i);
  const boxes = boxesOf(b);
  const fresh0 = boxes.filter((c) => !c.contents).map((c) => c.id);
  check(fresh0.length >= 4, `a fresh house: ${fresh0.length} of ${boxes.length} containers untouched (pool ${pool0.toFixed(2)} of ${poiFull(t, i).toFixed(2)})`);
  const [A, B, C, D] = fresh0.map((id) => boxes.find((c) => c.id === id));
  open(st, b, A); open(st, b, B);
  // Take something out of A (or note there was nothing), put a bandage into B (a swap: take one of B's things too).
  const tookA = A.contents.gear.length ? A.contents.gear.shift() : null;
  if (!tookA) { const k = Object.keys(A.contents.sup)[0]; if (k) delete A.contents.sup[k]; }
  const swapOut = B.contents.gear.length ? B.contents.gear.pop() : null;
  B.contents.gear.push(newItem("flashlight", 1));
  B.contents.sup.food = (B.contents.sup.food || 0) + 3; // leave three cans
  // A rummage through C: part of it stays hidden.
  C.lock = C.lock ? { ...C.lock, open: true } : C.lock;
  const u = me(b); u.ap = 2; u.quickTurn = -1;
  searchBox(st, b, u, C, true, true);
  const savedA = itemsSig(A.contents), savedB = itemsSig(B.contents), savedC = itemsSig(C.contents), hiddenC = itemsSig(C.hidden);
  end(st, b, "out");
  const L = poiAt(t, i).cont;
  check(!!L && L.mine[contKey("poi" + i + ":house", A.id)] && L.mine[contKey(`poi${i}:house`, B.id)] && L.mine[contKey(`poi${i}:house`, C.id)], `the three opened containers are in the ledger (${Object.keys(L ? L.mine : {}).join(", ")})`);
  check(!L.mine[contKey(`poi${i}:house`, D.id)] && !L.looted[contKey(`poi${i}:house`, D.id)], "an unopened one is not");
  check(itemsSig(L.mine[contKey(`poi${i}:house`, B.id)].contents) === savedB && L.mine[contKey(`poi${i}:house`, B.id)].contents.gear.some((g) => g.key === "flashlight"), "B holds what was put in it (the bandage, the cans)");
  check(L.mine[contKey(`poi${i}:house`, C.id)].quick === !!C.quick && itemsSig(L.mine[contKey(`poi${i}:house`, C.id)].hidden) === hiddenC, "C keeps the rummage: quick, and what it left hidden");
  const per = poiFull(t, i) / L.maps[`poi${i}:house`].length;
  check(Math.abs(pool0 - poiPool(t, i) - 3 * per) < 1e-9 && Math.abs(L.took - 3 * per) < 1e-9, `the pool fell by the three containers' share (${pool0.toFixed(3)} → ${poiPool(t, i).toFixed(3)}, ${per.toFixed(3)} each)`);
  check(L.n === boxes.length, `the ledger knows the map's containers (${L.n})`);
  const note = poiContainerNote(st, t, i);
  check(/you opened 3 containers/.test(note) && /left \d+ items? there/.test(note), `the dialogue's note: "${note}"`);
  // Revisit.
  st.hour += 30;
  const b2 = raid(st, p, t, i);
  const at = (id) => b2.raid.containers.find((c) => c.id === id);
  check(itemsSig(at(A.id).contents) === savedA && at(A.id).searched === !!A.searched, "A is as it was left");
  check(itemsSig(at(B.id).contents) === savedB, "B still holds the bandage and the cans");
  check(at(C.id).quick === !!C.quick && itemsSig(at(C.id).hidden) === hiddenC && itemsSig(at(C.id).contents) === savedC, "C still has its hidden rest (a full search brings it out)");
  check(!at(D.id).contents && b2.raid.poiFresh.includes(D.id), "D is still unopened");
  // D holds its original things: the twin world (same seed) opens D on a first visit.
  const tt = twin.tiles[t.id];
  const bt = raid(twin, pt, tt, i);
  const origD = itemsSig(open(twin, bt, bt.raid.containers.find((c) => c.id === D.id)));
  check(itemsSig(open(st, b2, at(D.id))) === origD, `the container never opened holds its original things on the revisit (${origD.slice(0, 60)}…)`);
  // Take the bandage now: B is saved without it.
  at(B.id).contents.gear = at(B.id).contents.gear.filter((g) => g.key !== "flashlight");
  end(st, b2, "wiped");
  check(!poiAt(t, i).cont.mine[contKey(`poi${i}:house`, B.id)].contents.gear.some((g) => g.key === "flashlight") && !!poiAt(t, i).cont.mine[contKey(`poi${i}:house`, D.id)], "a raid that ends with the team wiped saves the opened containers too (B without the bandage, D opened)");
  twin.combat = null;
  roundTrip = { st, t, i };
  void tookA; void swapOut;
}

section("A retreat saves the ledger too");
{
  const st = W();
  const p = team(st);
  const [t, i] = findPoi(st, ["campsite", "hikercamp", "blind", "garage", "shed"]);
  const b = raid(st, p, t, i);
  const box = boxesOf(b).find((c) => !c.contents);
  open(st, b, box);
  box.contents.gear.push(newItem("flashlight", 1));
  end(st, b, "retreat");
  const m = poiAt(t, i).cont && poiAt(t, i).cont.mine[contKey(b.raid.poiMap, box.id)];
  check(!!m && m.contents.gear.some((g) => g.key === "flashlight"), `a retreat from a ${poiAt(t, i).kind} keeps the container's contents (${b.raid.poiMap})`);
}

section("Looted containers, the pool and the band");
{
  const { st, t, i } = roundTrip;
  const mapId = `poi${i}:house`;
  const L = poiAt(t, i).cont;
  const ids = L.maps[mapId];
  const freshNow = () => ids.filter((id) => !(contKey(mapId, id) in L.looted) && !(contKey(mapId, id) in L.mine)).length;
  const keepFor = () => Math.round((ids.length - ((L.opened && L.opened[mapId]) || 0)) * Math.min(1, poiPool(t, i) / (poiFull(t, i) - (L.took || 0))));
  // Items you leave never raise the pool or the band.
  const pool1 = poiPool(t, i), band1 = poiBand(t, i);
  const P = team(st);
  const b = raid(st, P, t, i);
  const opened = boxesOf(b).find((c) => c.contents && !c.ransacked);
  if (opened) for (let k = 0; k < 5; k++) opened.contents.gear.push(newItem("flashlight", 1));
  end(st, b, "out");
  check(poiPool(t, i) === pool1 && poiBand(t, i) === band1, `leaving five bandages raises neither the pool nor the band (${pool1.toFixed(3)}, ${band1})`);
  // Another group takes half of what is left: the fresh share follows, the first in the seeded order first.
  const f0 = freshNow();
  const heat0 = tileHeat(st, t);
  const got = lootPoiAbstract(st, 7, t, i, poiPool(t, i) / 2);
  check(got && got.took > 0 && Math.abs(poiPool(t, i) - pool1 / 2) < 1e-9, `group 7 took half the pool (${got.took.toFixed(3)})`);
  check(freshNow() === Math.min(f0, keepFor()), `the fresh containers follow the pool (${f0} → ${freshNow()}, kept ${keepFor()})`);
  const by7 = Object.keys(L.looted).filter((k) => L.looted[k] === 7 && !L.mine[k]).length;
  check(by7 === f0 - freshNow(), `the fresh ones gone are marked looted by group 7 (${by7}; ${got.boxes} of yours emptied too)`);
  check(Math.abs(tileHeat(st, t) - heat0 - TILE_HEAT.AI) < 1e-9, `another group's raid adds tile heat (+${(tileHeat(st, t) - heat0).toFixed(1)})`);
  // They spawn empty, open and ransacked.
  const b2 = raid(st, P, t, i);
  const rans = boxesOf(b2).filter((c) => c.ransacked);
  check(rans.length >= f0 - freshNow() && rans.every((c) => c.contents && !things(c.contents) || L.mine[contKey(mapId, c.id)]) && rans.every((c) => c.searched || L.mine[contKey(mapId, c.id)]) && rans.every((c) => /\(ransacked\)$/.test(c.label)), `${rans.length} ransacked containers spawn empty, searched and say so`);
  check(rans.filter((c) => c.lock).every((c) => c.lock.open), "a ransacked locked container stands open");
  end(st, b2, "out");
  check(rans.filter((c) => !c.mine).every((c) => !L.mine[contKey(mapId, c.id)]), "a ransacked container left empty does not join yours");
  // The rest of the pool: what you left is at risk.
  const left0 = ledgerSummary(st, t, i).left;
  const got2 = lootPoiAbstract(st, 7, t, i, 1);
  check(got2.boxes > 0 && got2.left.gear.some((g) => g.key === "flashlight"), `taking everything takes what you left too (${got2.boxes} containers, ${got2.left.gear.length} things, ${left0} left before)`);
  check(ledgerSummary(st, t, i).left === 0 && Object.keys(L.mine).filter((k) => L.looted[k] === 7).length >= got2.boxes, "your containers are emptied and marked looted by them");
  check(/looted by others since your visit/.test(poiContainerNote(st, t, i)), `the dialogue says so: "${poiContainerNote(st, t, i)}"`);
  check(poiBand(t, i) === 3 && freshNow() === 0, `picked clean: no fresh container left (band ${poiBand(t, i)})`);
  // Save / load keeps the ledger.
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));
  check(JSON.stringify(poiAt(back.tiles[t.id], i).cont) === JSON.stringify(L) && poiPool(back.tiles[t.id], i) === poiPool(t, i), "save / load keeps the ledger and the pool");
}

section("Abstract looting before any raid: the pool alone, the containers at the first visit");
{
  const st = W();
  const p = team(st);
  const [t, i] = findPoi(st, ["house"]);
  const full = poiFull(t, i);
  lootPoiAbstract(st, 4, t, i, poiPool(t, i) - full * 0.45);
  check(poiAt(t, i).cont && !poiAt(t, i).cont.maps && poiAt(t, i).cont.last.by === 4, "no map built for it: the pool falls and who took it is noted");
  const b = raid(st, p, t, i);
  const n = boxesOf(b).length, fresh = boxesOf(b).filter((c) => !c.contents).length;
  check(fresh === Math.round(n * 0.45), `at the first visit ${fresh} of ${n} are fresh (45% of what it held)`);
  check(boxesOf(b).filter((c) => c.ransacked).every((c) => c.ransacked === 4), "the ransacked ones are put down to the group that raided it");
  check(syncLedger(st, t, i, b.raid.poiMap, 9) === 0, "syncing again marks nothing more");
  check(/others have looted here/.test(poiContainerNote(st, t, i)) || /looted by others/.test(poiContainerNote(st, t, i)), `the note: "${poiContainerNote(st, t, i)}"`);
  st.combat = null;
}

section("Your own headless search takes through the ledger");
{
  const st = W();
  const p = team(st);
  const [t, i] = findPoi(st, ["house"]);
  // A raid first: open two containers, leave a bandage in one.
  const b = raid(st, p, t, i);
  const [x, y] = boxesOf(b).filter((c) => !c.contents);
  open(st, b, x); open(st, b, y);
  x.contents.gear.push(newItem("flashlight", 1));
  end(st, b, "out");
  const L = poiAt(t, i).cont;
  const mapId = Object.keys(L.maps)[0];
  // The headless search on the same POI (the autopilot, a crew, the tools).
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.poi = i; p.phase = "arrived";
  st.engagement = null;
  const heat0 = tileHeat(st, t);
  startScavenge(st, p);
  const e = st.engagement;
  check(e && e.poi === i, "the search goes into that POI");
  check(tileHeat(st, t) - heat0 === TILE_HEAT.ENTER, `going in adds tile heat (+${tileHeat(st, t) - heat0})`);
  e.approach = "normal";
  const pool0 = poiPool(t, i);
  let gotBandage = false;
  for (let h = 0; h < 12 && !e.done && poiPool(t, i) > CONT.FLOOR + 0.001; h++) { searchHour(st); if (e.found.gear.some((g) => g.key === "flashlight")) gotBandage = true; }
  check(poiPool(t, i) < pool0, `the search lowers the pool (${pool0.toFixed(3)} → ${poiPool(t, i).toFixed(3)})`);
  const mine = Object.values(L.looted).filter((by) => by === "player").length;
  check(mine > 0, `containers emptied by your own crew are marked so (${mine})`);
  check(gotBandage && /left in a container here before/.test(e.log.join(" ")), "what you left there comes away with the team (the bandage, a log line)");
  st.engagement = null;
}

section("Determinism of a round trip");
{
  const run = () => {
    const st = W();
    const p = team(st);
    const [t, i] = findPoi(st, ["house"]);
    const b = raid(st, p, t, i);
    for (const c of boxesOf(b).slice(0, 3)) open(st, b, c);
    end(st, b, "out");
    lootPoiAbstract(st, 3, t, i, 0.1);
    const b2 = raid(st, p, t, i);
    for (const c of boxesOf(b2)) if (!c.contents) { open(st, b2, c); break; }
    end(st, b2, "out");
    return JSON.stringify(poiAt(t, i).cont) + poiPool(t, i) + JSON.stringify(st.tileHeat || {});
  };
  check(run() === run(), "the same raids give the same ledger, pool and heat");
}

section("The raid bot: a raid and a revisit of the same POI");
{
  const st = W(seed + 1);
  const p = team(st);
  const [t, i] = findPoi(st, ["house", "garage", "corner", "school"]) || findPoi(st, ["shed", "farm"]);
  let ok = true, err = null;
  try {
    const b = raid(st, p, t, i);
    let guard = 0;
    while (!b.over && guard++ < 200) { autoPlayerTurn(st); runEnemyPhase(st); }
    check(b.over, `the bot finishes the raid (${b.result ? b.result.outcome : "not over"}, ${b.result ? b.result.raid.searched : 0}/${b.result ? b.result.raid.total : 0} searched)`);
    const opened = boxesOf(b).filter((c) => c.contents).map((c) => [c.id, itemsSig(c.contents)]);
    finishCombat(st, b.setup, b.result);
    const L = poiAt(t, i).cont;
    check(opened.every(([id, s]) => L.mine[contKey(b.raid.poiMap, id)] && itemsSig(L.mine[contKey(b.raid.poiMap, id)].contents) === s), `every container the bot opened is saved as it left it (${opened.length})`);
    if (partyMembers(st, p).length) {
      st.hour += 48;
      const b2 = raid(st, p, t, i);
      check(opened.every(([id, s]) => itemsSig(b2.raid.containers.find((c) => c.id === id).contents) === s), "the revisit shows them as left");
      guard = 0;
      while (!b2.over && guard++ < 200) { autoPlayerTurn(st); runEnemyPhase(st); }
      finishCombat(st, b2.setup, b2.result);
      check(b2.over, "the bot finishes the revisit");
    }
  } catch (e) { ok = false; err = e; }
  check(ok, `no exception${err ? `: ${err.stack}` : ""}`);
  void knownPois; void chooseBuilding;
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
