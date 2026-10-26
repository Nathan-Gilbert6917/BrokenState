// A camp inside a POI: rooms Cleared or Not cleared, the dead per room, Defend waves out of the rooms, the way out and
// cut-off camps (src/sim/poirooms.js, issue #71, the heat epic #64 §4; the user's request 2026-10-26).
// Usage: node tools/poiroomstest.js [seed]
// - the room states: fogged → Not cleared; seen and empty → Cleared; the dead known → Not cleared
// - the dead per room always sum to the POI's pool (deadpop.js poiDead): kills, a refill (into the rooms nearest the
//   edge), every room Cleared means 0
// - the way out over the floors: the second-floor camp over a Not cleared hall is cut off ("runs through the hall");
//   the hall cleared opens it; a rope at the camp and a window onto seen, empty yard: a climb out (on foot only, not a
//   vehicle or hauling); no kit, no climb
// - the blocked jobs and orders: the land jobs (their *WorkWhy, the activity line), hauling, a team leaving; open
//   again once cleared
// - Defend waves out of the Not cleared rooms: open routes first, a shut door slows a room's dead; the wave's dead on
//   the camp's map in their rooms (another floor's at the stairs); the kills off their rooms; a fight lost lets the
//   trickle in (rooms Not cleared again)
// - going back in: a raid on the camp's POI map puts the POI's dead in their rooms; a kill there comes off its room;
//   leaving keeps what was cleared
// - build mode and the base map: builds only in Cleared rooms and on seen, empty yard; a site in a room turned Not
//   cleared stops (progress kept), a queued build there waits
// - arrivals fight their way in (headless: a fight by the numbers, then home); Break out; the governor breaks out
// - save / load keeps the rooms and the way; a record from before #71 (one floor, no rooms' dead) loads, deterministic
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { createBattle, combatAct, endPlayerTurn, runEnemyPhase, finishCombat, enemyUnit } from "../src/sim/combat.js";
import { launchExpedition, partyMembers, startReturn } from "../src/sim/parties.js";
import { poisOf, isSitePoi } from "../src/sim/pois.js";
import { poiRaidSetup } from "../src/sim/poiraid.js";
import { placeProblemAt, occupancy, FOOT } from "../src/sim/basemap.js";
import { constructionHour } from "../src/sim/buildings.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { killDead, poiDead, putBack, poiCap, openDead, drawFromTile } from "../src/sim/deadpop.js";
import { attackNow, settleWave } from "../src/sim/campattack.js";
import { forageWorkWhy } from "../src/sim/foraging.js";
import { woodWorkWhy } from "../src/sim/woodcutting.js";
import { huntWorkWhy, fishWorkWhy } from "../src/sim/hunting.js";
import { stoneWorkWhy } from "../src/sim/stone.js";
import { fetchWaterWhy } from "../src/sim/economy.js";
import { describeActivity } from "../src/sim/activity.js";
import { haulActivity } from "../src/sim/hauling.js";
import * as PC from "../src/sim/poicamp.js";
import * as PR from "../src/sim/poirooms.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (process.env.VERBOSE && ok) console.log(`  ok: ${msg}`); if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);

const W = () => { const st = createWorld({ seed, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
function findHouse(st) {
  for (const t of st.tiles) {
    if (t.hive || st.bases.some((x) => x.tile === t.id) || st.factions.some((f) => f.bases.includes(t.id))) continue;
    const L = poisOf(t);
    for (let i = 0; i < L.length; i++) if (L[i].kind === "house" && !isSitePoi(t, i)) return [t, i];
  }
  return null;
}
function team(st, n = 3, from = hub(st)) {
  const crew = atBase(st, from.id).slice(0, n);
  for (const s of crew) { s.traits = []; s.traitTier = {}; s.perks = []; s.health = 100; }
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: from.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 1 }, fromBaseId: from.id });
  if (res.error) throw new Error(`launch: ${res.error}`);
  st.cards.length = 0;
  return res.party;
}
function raid(st, p, t, i, extra = {}, deadPop = null) {
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
  const rs = poiRaidSetup(st, t, i);
  const setup = { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "nobody", groups: [] }, raid: { heat0: 5, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null, ...extra }, context: {}, ...(deadPop ? { deadPop } : {}) };
  st.combat = createBattle(st, setup);
  return st.combat;
}
const mine = (b) => b.units.filter((u) => u.side === "player" && !u.dead && !u.left);
const turn = (st) => { endPlayerTurn(st); runEnemyPhase(st); };
function zombie(b, x, y, f = b.floor || 0) {
  const z = enemyUnit(b, { chance: () => false, pick: (a) => a[0], range: (a) => a, int: (a) => a }, "zombies", 3, 1);
  z.x = x; z.y = y; z.f = f; z.ap = 0; z.mob = 0; z.aware = false;
  b.units.push(z);
  return z;
}
// The POI's pool set to n (as near as its cap lets): kills or put back.
function setDead(st, tile, i, n) {
  const c = poiDead(st, tile, i);
  if (c > n) killDead(st, tile, i, c - n);
  else if (c < n) putBack(st, tile, i, n - c);
  return poiDead(st, tile, i);
}
const sum = (P) => Object.values(P.zd || {}).reduce((a, v) => a + v, 0);
const all1 = (n) => PC.seenRle(new Uint8Array(n).fill(1));

// A real camp in a house: set up, finished and settled in (poicamp.js), the team its people.
function foundCamp(st, t, i) {
  const p = team(st, 3);
  const b = raid(st, p, t, i);
  const at = PC.bestSquare(st, b);
  const cells = PC.squareCells(at[0], at[1]).filter(([x, y]) => b.cells[y * b.w + x].k === "open");
  mine(b).forEach((u, k) => { u.x = cells[k][0]; u.y = cells[k][1]; });
  const [u1, u2] = mine(b);
  u1.haul.sup.wood = 5; u2.haul.sup.stone = 8;
  if (combatAct(st, { type: "campSetup", unit: u1.id, x: at[0], y: at[1] })) throw new Error("setup refused");
  for (let k = 0; k < 20 && !b.poiCamp.done; k++) { for (const u of mine(b)) combatAct(st, { type: "campWork", unit: u.id }); if (!b.poiCamp.done) turn(st); }
  for (let k = 0; k < 6; k++) turn(st);
  if (combatAct(st, { type: "settleIn" })) throw new Error("settle refused");
  finishCombat(st, b.setup, b.result);
  st.cards.length = 0;
  return st.bases.find((x) => x.poi === i && x.tile === t.id);
}

// The second-floor example, by hand (a 20 × 14 map): a two-storey house, the hall (with the stairs and the front door)
// and the kitchen (through a closed door) below, one room upstairs with the camp and a window over the yard.
const SW = 20, SH = 14;
const HALL = "r0_4_3", KITCHEN = "r0_10_3", UP = "r1_4_3";
function synthFloors(kitchenDoor = "idoor") {
  const g0 = Array.from({ length: SW * SH }, () => ({ k: "open", f: "grass" }));
  const g1 = Array.from({ length: SW * SH }, () => ({ k: "void" }));
  const set = (g, x, y, k) => { g[y * SW + x] = { k }; };
  for (let y = 3; y <= 10; y++) for (let x = 4; x <= 15; x++) { const wall = x === 4 || x === 15 || y === 3 || y === 10; set(g0, x, y, wall ? "wall" : "open"); set(g1, x, y, wall ? "wall" : "open"); }
  for (let y = 3; y <= 10; y++) set(g0, 10, y, "wall");
  set(g0, 10, 6, kitchenDoor); set(g0, 4, 6, "odoor"); set(g0, 6, 5, "stairs"); set(g1, 6, 5, "stairs"); set(g1, 15, 6, "window");
  return { g0, g1 };
}
function synth(base) {
  const real = base.poiCamp, { g0, g1 } = synthFloors();
  const one = PR.packFloor(g1);
  base.poiCamp = {
    v: 2, poi: real.poi, mapId: real.mapId, f: 1, at: [11, 6], w: SW, h: SH, pal: one.pal, cells: one.cells,
    rooms: [{ x0: 4, y0: 3, w: 12, h: 8, name: "the upstairs" }],
    rm: [{ f: 0, x0: 4, y0: 3, w: 7, h: 8, name: "the hall" }, { f: 0, x0: 10, y0: 3, w: 6, h: 8, name: "the kitchen" }, { f: 1, x0: 4, y0: 3, w: 12, h: 8, name: "the upstairs" }],
    fl: { 0: PR.packFloor(g0) }, seen: all1(SW * SH), seenF: { 0: all1(SW * SH) }, knownBy: [],
  };
  return base.poiCamp;
}
// Puts the dead per room (and the pool to match).
function rooms(st, base, zd) {
  const n = Object.values(zd).reduce((a, v) => a + v, 0);
  const got = setDead(st, base.tile, base.poi, n);
  base.poiCamp.zd = { ...zd };
  return got === n;
}

let st, t, i, base, P;
section("Setting up: a camp in a house, then the second-floor example by hand");
{
  st = W();
  [t, i] = findHouse(st);
  base = foundCamp(st, t, i);
  check(!!base && PC.isPoiCamp(base), `a camp in the house of tile ${t.id} (POI ${i}): ${base && base.name}`);
  const real = base.poiCamp;
  check(real.v === PR.POIROOMS.V && Array.isArray(real.rm) && real.rm.length >= 1 && !!real.way, `the camp's record keeps every floor's rooms (${real.rm && real.rm.length}) and its way out (${real.way && (real.way.open ? "open" : "cut off")})`);
  check(sum(real) === poiDead(st, t.id, i), `the POI's dead are kept per room and sum to its pool (${sum(real)} = ${poiDead(st, t.id, i)})`);
}

section("Rooms are Cleared or Not cleared");
{
  P = synth(base);
  check(rooms(st, base, {}), "the pool emptied");
  P.seenF = { 0: "" }; // the ground floor never seen
  let v = PR.roomsView(st, base);
  const s = (id) => (v.find((r) => r.id === id) || {}).state;
  check(s(HALL) === "not" && s(KITCHEN) === "not", `fogged rooms are Not cleared (hall ${s(HALL)}, kitchen ${s(KITCHEN)})`);
  check(s(UP) === "cleared", `the upstairs, seen and empty: Cleared (${s(UP)})`);
  P.seenF = { 0: all1(SW * SH) };
  v = PR.roomsView(st, base);
  check(s(HALL) === "cleared" && s(KITCHEN) === "cleared", "seen and empty: Cleared");
  check(rooms(st, base, { [HALL]: 2 }), "two of the dead in the hall");
  v = PR.roomsView(st, base);
  check(s(HALL) === "not" && v.find((r) => r.id === HALL).dead === 2 && s(KITCHEN) === "cleared", `the dead known in the hall: Not cleared (${s(HALL)}, ${v.find((r) => r.id === HALL).dead})`);
}

section("The dead per room always sum to the POI's pool");
{
  check(rooms(st, base, { [HALL]: 1, [KITCHEN]: 2 }), "three of the dead in two rooms");
  killDead(st, t.id, i, 1);
  PR.syncRooms(st, base);
  check(sum(P) === poiDead(st, t.id, i) && sum(P) === 2 && P.zd[KITCHEN] === 1, `a kill by the numbers off the room with the most (${JSON.stringify(P.zd)})`);
  setDead(st, t.id, i, 0);
  PR.syncRooms(st, base);
  check(sum(P) === 0 && PR.roomsView(st, base).filter((r) => r.kind === "room").every((r) => r.state === "cleared"), "the pool at 0: every room Cleared");
  // A refill (the daily recalculation, the tile's trickle): into the zones nearest the map's edge, never the camp's.
  putBack(st, t.id, i, 2);
  PR.syncRooms(st, base);
  const got = Object.keys(P.zd).map((id) => PR.zonesOf(P).byId.get(id));
  check(sum(P) === poiDead(st, t.id, i) && got.length > 0 && got.every((z) => z.edge === 0 && z.id !== UP), `rooms turn Not cleared again: the dead that got in went to the zones nearest the edge (${got.map((z) => `${z.name} ${z.edge}`).join(", ")})`);
  const base2 = PR.roomsView(st, base).filter((r) => r.state === "not" && r.dead > 0);
  check(base2.length > 0, `those zones are Not cleared now (${base2.map((r) => r.name).join(", ")})`);
}

section("The way out: the second-floor camp over a Not cleared hall");
{
  check(rooms(st, base, {}), "the hall empty");
  check(PR.refreshWay(st, base).open, "the way out is open with the hall empty");
  st.cards.length = 0;
  check(rooms(st, base, { [HALL]: 2 }), "the hall holds two of the dead");
  base.armory = (base.armory || []).filter((it) => !it || (it.key !== "rope" && it.key !== "ladder"));
  base.buildings = (base.buildings || []).filter((x) => !/bed|bunk|cot/.test(String(x.type)));
  let w = PR.refreshWay(st, base);
  check(!w.open && !w.climb && w.through === "the hall", `cut off: the stairs come down into the hall (${JSON.stringify(w)})`);
  check(/^Cut off: the way out runs through the hall \(dead known\)/.test(PR.cutOffWhy(st, base)), `the reason: "${PR.cutOffWhy(st, base)}"`);
  check(st.cards.some((c) => c.title === PR.POIROOMS.WAY_CUT), "a change of the way says so (a card: Way out: cut off)");
  check(PR.wayOut(st, base) === P.way, "the way is cached (read, not searched again)");
  // The kitchen does not matter: the route runs hall → front door.
  check(rooms(st, base, { [KITCHEN]: Math.min(3, poiCap(st, t.id, i)) }), "the hall empty, the kitchen full");
  w = PR.refreshWay(st, base);
  check(w.open && PR.cutOffWhy(st, base) === "", `the hall cleared: the way out is open (${JSON.stringify(w)})`);
  // The front door's room fogged: cut off through fog.
  P.seenF = { 0: PC.seenRle(PR.zonesOf(P).list.reduce((a, z) => { if (z.f === 0 && z.id !== HALL) for (const c of z.cells) a[c] = 1; return a; }, new Uint8Array(SW * SH))) };
  w = PR.refreshWay(st, base);
  check(!w.open && w.through === "the hall" && /through the hall \(fogged\)/.test(PR.cutOffWhy(st, base)), `a fogged hall cuts it off too ("${PR.cutOffWhy(st, base)}")`);
  P.seenF = { 0: all1(SW * SH) };
  // A climb: a rope at the camp and the window over seen, empty yard.
  check(rooms(st, base, { [HALL]: 2 }), "the hall full again");
  base.armory.push({ key: "rope", name: "Coil of rope" });
  w = PR.refreshWay(st, base);
  check(!w.open && w.climb && PR.cutOffWhy(st, base) === "", `a rope from the upstairs window: a climb out, for people on foot (${JSON.stringify(w)})`);
  check(/Cut off for loads/.test(PR.cutOffWhy(st, base, { heavy: true })), `not for furniture, heavy loads or vehicles ("${PR.cutOffWhy(st, base, { heavy: true })}")`);
  // The ground under the window with the dead on it: no climb.
  const yz = PR.zoneAt(P, 0, 16, 6);
  P.zd[yz.id] = 1; setDead(st, t.id, i, 3);
  w = PR.refreshWay(st, base);
  check(!w.climb, `the dead under the window (${yz.name}): no climb`);
  delete P.zd[yz.id]; setDead(st, t.id, i, 2);
  base.armory = base.armory.filter((it) => it.key !== "rope");
  w = PR.refreshWay(st, base);
  check(!w.open && !w.climb, "no rope, ladder or sheets: no climb");
  base.armory.push({ key: "ladder", name: "Siege ladder" });
  check(PR.refreshWay(st, base).climb, "a siege ladder does it too");
  base.armory = base.armory.filter((it) => it.key !== "ladder");
  PR.refreshWay(st, base);
}

section("Cut off: the jobs and orders that leave the map are blocked");
{
  check(!!PR.cutOffWhy(st, base), "cut off now");
  const whys = { forage: forageWorkWhy(st, base), wood: woodWorkWhy(st, base), hunt: huntWorkWhy(st, base), fish: fishWorkWhy(st, base), stone: stoneWorkWhy(st, base), water: fetchWaterWhy(st, base) };
  check(Object.values(whys).every((x) => /^Cut off/.test(x)), `the land jobs greyed with the reason (${Object.entries(whys).map(([k, v]) => `${k}: ${v.slice(0, 30)}`).join("; ")})`);
  const s = atBase(st, base.id)[0];
  s.role = "scavenge";
  const a = describeActivity(st, s, 10);
  check(/Cut off/.test(a.text) && a.kind !== "work", `a scavenger's day: "${a.text}"`);
  s.role = "haul";
  const hA = haulActivity(st, base, s, 10);
  check(/Cut off/.test(hA.text), `hauling: "${hA.text}"`);
  const res = launchExpedition(st, { memberIds: [s.id], dest: base.tile, mission: "scavenge", stance: "normal", supplies: {}, fromBaseId: base.id });
  check(!!res.error && /Cut off/.test(res.error), `a team leaving: "${res.error}"`);
  // A climb lets people on foot go, not a vehicle.
  base.armory.push({ key: "rope", name: "Coil of rope" });
  PR.refreshWay(st, base);
  check(!/Cut off/.test(forageWorkWhy(st, base)), "a climb out: foraging (on foot) goes on");
  const r2 = launchExpedition(st, { memberIds: [s.id], dest: base.tile, mission: "scavenge", stance: "normal", supplies: {}, fromBaseId: base.id, vehicleId: 987654 });
  check(!!r2.error && /Cut off for loads/.test(r2.error), `a vehicle cannot leave by a window ("${r2.error}")`);
  check(/Cut off/.test(haulActivity(st, base, s, 10).text), "hauling cannot either");
  base.armory = base.armory.filter((it) => it.key !== "rope");
  s.role = "rest";
  PR.refreshWay(st, base);
}

section("Defend waves come out of the Not cleared rooms");
{
  check(rooms(st, base, { [HALL]: 1, [KITCHEN]: 4 }), "one in the hall, four in the kitchen behind a closed door");
  let rw = PR.roomWave(st, base, 4);
  check(rw.rooms[HALL] === 1 && rw.rooms[KITCHEN] === 2 && rw.total === 3, `the open route first (the hall), the shut door lets half the kitchen out (${JSON.stringify(rw)})`);
  const { g0 } = synthFloors("odoor");
  P.fl = { 0: PR.packFloor(g0) };
  rw = PR.roomWave(st, base, 4);
  check(rw.rooms[KITCHEN] === 3 && rw.total === 4, `the door open: the kitchen's dead come as they like (${JSON.stringify(rw)})`);
  P.fl = { 0: PR.packFloor(synthFloors().g0) };
  // A wave from the pools (campattack.js): its grounds' part out of the rooms.
  st.cards.length = 0; base.campAttack = { after: 0 };
  for (const x of atBase(st, base.id)) x.health = 100;
  const w = attackNow(st, base, { grounds: true });
  check(!!w && !!w.rooms && Object.values(w.rooms).reduce((a, v) => a + v, 0) === w.g && w.g > 0, `the wave's dead come out of the rooms (${w && JSON.stringify(w.rooms)})`);
  // On the camp's map: their rooms (the ground floor's at the stairs: the camp is upstairs).
  const b = createBattle(st, { tile: base.tile, baseId: base.id, enemy: { kind: "zombies", count: w.g, power: 2, name: "the dead" }, ambush: null, canRetreat: true, handler: null, layout: "baseDefence", deploy: true, context: { baseId: base.id, dead: w.g, raiders: 0, wave: w.g, rooms: w.rooms } });
  const F = b.deployPlan.fort;
  const atStairs = b.units.filter((u) => u.side === "enemy" && u.room && u.x === 6 - P.at[0] + F.ox && u.y === 5 - P.at[1] + F.oy);
  check(atStairs.length === 1, `the camp's map is its floor: the ground floor's dead come up the stairs (${atStairs.length} at the stairs)`);
  // The kills come off their rooms.
  const before = { ...P.zd };
  settleWave(st, base, w, 1, 0);
  const off = Object.keys(before).filter((id) => (P.zd[id] || 0) < before[id]);
  check(off.length === 1 && Object.keys(w.rooms).includes(off[0]) && sum(P) === poiDead(st, t.id, i), `one killed: off its room (${off}), the rooms still sum to the pool (${sum(P)} = ${poiDead(st, t.id, i)})`);
  // A fight lost: the trickle's survivors get into the place.
  const o0 = openDead(st, t.id), p0 = poiDead(st, t.id, i);
  if (o0 > 0) {
    const drawn = drawFromTile(st, t.id, Math.min(2, o0)); // drawn out of the open ground, as waveSource does
    const w2 = { g: 0, d: drawn, r: 0, rp: 0, poi: i };
    settleWave(st, base, w2, 0, 0, { brokeIn: true });
    check(poiDead(st, t.id, i) === p0 + drawn && openDead(st, t.id) === o0 - drawn && sum(P) === poiDead(st, t.id, i), `a fight lost: the trickle's ${drawn} got into the place (its pool ${p0} → ${poiDead(st, t.id, i)}, in the rooms; the open ground ${o0} → ${openDead(st, t.id)})`);
  } else check(true, "");
}

section("Break out, arrivals fighting in, the governor");
{
  check(rooms(st, base, { [HALL]: 2 }), "the hall holds two again");
  PR.refreshWay(st, base);
  check(!!PR.cutOffWhy(st, base), "cut off");
  for (const s of atBase(st, base.id)) { s.health = 100; s.inBed = false; }
  check(PR.breakOutProblem(st, base) === "", `Break out can be given ("${PR.breakOutProblem(st, base)}")`);
  const d0 = poiDead(st, t.id, i);
  check(PR.breakOut(st, base.id) === "" && !st.combat, "Break out: the fight on the camp's map, played out headless");
  check(poiDead(st, t.id, i) < d0 && sum(P) === poiDead(st, t.id, i), `the dead in the hall fought (${d0} → ${poiDead(st, t.id, i)}), the rooms still sum to the pool`);
  check(st.log.some((l) => /break out/.test(String(l.text || l.msg || l))), "the log says how it went");
  if (!PR.cutOffWhy(st, base)) check(PR.roomsView(st, base).find((r) => r.id === HALL).state === "cleared", "the hall cleared by the fight counts as seen and Cleared");
  // The governor: a cut-off camp with fighters home breaks out.
  check(rooms(st, base, { [HALL]: 1 }), "one in the hall");
  PR.refreshWay(st, base);
  check(PR.govBreakOut(st) === (atBase(st, base.id).length >= 2), "the governor breaks out of a cut-off camp with fighters home");
  // Arrivals: a team coming home fights its way in.
  check(rooms(st, base, { [HALL]: 2 }), "the hall holds two");
  PR.refreshWay(st, base);
  const p = team(st, 2);
  p.homeBaseId = base.id; p.path = [base.tile]; p.idx = 0; p.dest = base.tile;
  const ids = partyMembers(st, p).map((s) => s.id);
  startReturn(st, p);
  const home = ids.filter((id) => { const s = survivorById(st, id); return s && s.location && s.location.kind === "base" && s.location.baseId === base.id; });
  const fought = st.log.some((l) => /fight their way in/.test(String(l.text || l.msg || l)));
  check(fought, "the team reaching a cut-off camp fights its way in");
  check(home.length > 0 ? !st.parties.includes(p) && poiDead(st, t.id, i) < 2 : st.parties.includes(p), `won: home (${home.length} in); lost: still a team outside (dead left ${poiDead(st, t.id, i)})`);
}

section("Builds only in Cleared rooms and on seen, empty yard");
{
  check(rooms(st, base, {}), "every room empty");
  const occ = occupancy(st, base);
  const bunks = { ...FOOT.bunks, type: "bunks", key: null };
  const fits = (gx, gy) => placeProblemAt(base, bunks, gx, gy, 0, occ);
  let spot = null;
  for (let y = 4; y <= 9 && !spot; y++) for (let x = 5; x <= 14 && !spot; x++) if (!fits(x - P.at[0], y - P.at[1])) spot = [x - P.at[0], y - P.at[1]];
  check(!!spot, `bunks fit in the Cleared upstairs (at grid ${spot})`);
  P.zd = { [UP]: 1 }; setDead(st, t.id, i, 1);
  check(spot && /Not cleared: the upstairs \(dead known\)/.test(fits(spot[0], spot[1])), `the upstairs Not cleared: refused ("${spot && fits(spot[0], spot[1])}")`);
  const site = { type: "bunks", at: [spot[0], spot[1], 0] };
  check(/Not cleared/.test(PC.siteRoomWhy(base, site)), "a build site there stops");
  base.construction.push({ id: 99999, type: "bunks", progress: 0.5, hours: FOOT.bunks ? 6 : 6, cost: {}, paid: true, at: site.at.slice() });
  for (const s of atBase(st, base.id)) s.role = "build";
  constructionHour(st);
  const job = base.construction.find((c) => c.id === 99999);
  check(!!job && job.progress === 0.5, `a queued build in a Not cleared room waits, its progress kept (${job && job.progress})`);
  setDead(st, t.id, i, 0); PR.syncRooms(st, base);
  constructionHour(st);
  check(!job || job.progress > 0.5 || !base.construction.includes(job), `cleared again: the work goes on (${job && job.progress})`);
  base.construction = base.construction.filter((c) => c.id !== 99999);
}

section("Going back in: the raid on the camp's POI map, with the rooms as they stand");
{
  const st2 = W();
  const [t2, i2] = findHouse(st2);
  const base2 = foundCamp(st2, t2, i2);
  const P2 = base2.poiCamp;
  const Z = PR.zonesOf(P2), roomZ = Z.list.filter((z) => z.kind === "room" && z.f === (P2.f || 0) && !z.cells.some((c) => Math.abs((c % P2.w) - P2.at[0]) <= 2 && Math.abs(Math.floor(c / P2.w) - P2.at[1]) <= 2));
  check(roomZ.length > 0, `the house has rooms off the camp's square (${roomZ.map((z) => z.name).join(", ")})`);
  const z0 = roomZ[0];
  const n = Math.min(2, poiCap(st2, t2.id, i2));
  setDead(st2, t2.id, i2, n);
  P2.zd = { [z0.id]: n };
  const p = team(st2, 2);
  const b = raid(st2, p, t2, i2, {}, { tile: t2.id, poi: i2, roster: n, raiders: 0 });
  for (let k = 0; k < n; k++) zombie(b, 0, k);
  PR.roomsOnRaid(st2, b, base2);
  const inRoom = b.units.filter((u) => u.side === "enemy" && u.room === z0.id && z0.cells.includes(u.y * P2.w + u.x));
  check(inRoom.length === n, `the POI's dead are on the map in their room, ${z0.name} (${inRoom.length}/${n})`);
  inRoom[0].dead = true; inRoom[0].hp = 0;
  for (const u of mine(b)) u.left = true;
  turn(st2);
  finishCombat(st2, b.setup, b.result || { outcome: "retreat", loot: { supplies: {}, gear: [] }, raid: { hours: 1, searched: 0, total: 0 } });
  check(P2.zd[z0.id] === n - 1 && sum(P2) === poiDead(st2, t2.id, i2), `the one killed came off its room; leaving keeps what was cleared (${JSON.stringify(P2.zd)}, pool ${poiDead(st2, t2.id, i2)})`);
}

section("Save and load; a record from before #71");
{
  check(rooms(st, base, { [HALL]: 2 }), "the hall holds two");
  PR.refreshWay(st, base);
  st.cards.length = 0;
  const w2 = deserializeState(serializeState(st));
  const b2 = w2.bases.find((x) => x.id === base.id);
  check(!!b2 && JSON.stringify(b2.poiCamp.zd) === JSON.stringify(P.zd) && b2.poiCamp.way.open === P.way.open && b2.poiCamp.way.through === "the hall", "save / load keeps the rooms' dead and the way out");
  check(PR.cutOffWhy(w2, b2) === PR.cutOffWhy(st, base), "the loaded camp is cut off the same");
  // An older record: the camp's floor only, no rooms' dead, no way kept.
  const old = (w) => { const bb = w.bases.find((x) => x.id === base.id); const Q = bb.poiCamp; Q.v = 1; delete Q.rm; delete Q.fl; delete Q.seenF; delete Q.zd; delete Q.way; delete Q.cz; return bb; };
  const ser = serializeState(st);
  const a = old(deserializeState(ser)), c = old(deserializeState(ser));
  const va = PR.roomsView(deserializeState(ser), a);
  check(JSON.stringify(PR.roomsView(st, a)) === JSON.stringify(PR.roomsView(st, c)) && va.length > 0, `an older record loads; its rooms seeded from the pool the same every time (${va.length} zones)`);
  const wa = PR.wayOut(st, a);
  check(wa.open && sum(a.poiCamp) === poiDead(st, a.tile, a.poi), `its way out worked out: the upstairs record never kept the floor below, so its stairs count as the way out (${JSON.stringify(wa)}); the rooms sum to the pool`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
