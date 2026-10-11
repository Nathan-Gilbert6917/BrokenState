// Raid loot by hand (sim/raidloot.js): the search window's rules. Each survivor carries their own finds up to their
// max load, a vehicle has its own trunk reached at the vehicle, the first look costs the action and a second is free,
// supplies move as far as they fit, gear goes in slots, what the ones who get out carry joins the team's cargo and
// what the lost carry is gone, a weapon picked up mid-raid is fought with at once, and a raid saved mid-search loads.
// Usage: node tools/raidloottest.js [seed]
import { FOODS } from "../src/sim/foods.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { SUPPLIES } from "../src/sim/data.js";
import { launchExpedition, partyCapacity, poolLoad, partyMembers } from "../src/sim/parties.js";
import { createBattle, combatAct, CELL, registerCombatHandler, unitAt, autoPlayerTurn, runEnemyPhase } from "../src/sim/combat.js";
import { newItem, itemLoad } from "../src/sim/inventory.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { maxLoad, wornLoad } from "../src/sim/load.js";
import * as RL from "../src/sim/raidloot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { STEALTH } from "../src/sim/stealth.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const EPS = 1e-6;
registerCombatHandler("rltest", () => {});

// A raid on a town site with a crew of 3 from the hub; opts.vehicle: "truck" or "bike".
function raid(opts = {}) {
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: seed * 100 + i, factionCount: 6 });
    st.cards.length = 0;
    st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["pharmacy", "store", "gunstore", "police", "warehouse", "house", "gas"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    for (const s of crew) s.traits = [];
    let vehicleId = null;
    if (opts.vehicle) vehicleId = createVehicle(st, opts.vehicle, { kind: "base", baseId: h.id }, { fuel: 30, count: 3 }).id;
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "rltest", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 0 }, context: {} };
    st.combat = createBattle(st, setup);
    const b = st.combat;
    if (b.raid.choose) b.raid.choose = null;
    if (!b.raid.containers.some((c) => c.kind !== "body" && !c.lock)) continue;
    return { st, b, p, crew };
  }
  throw new Error("no raid map");
}
const players = (b) => b.units.filter((u) => u.side === "player");
function standNext(b, u, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !CELL[b.cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
    u.x = nx; u.y = ny;
    return true;
  }
  return false;
}
// A container with these contents, next to the unit.
function boxWith(b, u, sup, gear = []) {
  const box = b.raid.containers.find((c) => c.kind !== "body" && !c.lock && standNext(b, u, c.x, c.y));
  box.contents = { sup: { ...sup }, gear };
  box.searched = false;
  return box;
}
const loose = (b) => players(b).filter((u) => !u.dead).reduce((a, u) => a + RL.haulLoad(u), 0);

// The weight rules first, with all the time in the world (hauling time has its own section below).
const HAUL0 = { ...RL.HAUL };
RL.HAUL.free = 1e9;

// ======================================================================================
console.log("On foot: each survivor carries their own share and finds");
{
  const { st, b, p } = raid();
  const us = players(b);
  check(us.every((u) => u.haul && u.haul.gear.length === 0), "everyone starts with empty arms");
  const shares = us.reduce((a, u) => a + u.share, 0);
  check(Math.abs(shares - poolLoad(p)) < 0.01, `the team's packed supplies are shared out among them (${shares.toFixed(2)} of ${poolLoad(p).toFixed(2)} kg)`);
  check(RL.trunkSpace(st, b) === null && !RL.atVehicle(b, us[0]), "no vehicle: no trunk");
  const u = us[0];
  const s = survivorById(st, u.sid);
  const room0 = RL.personalRoom(st, u);
  check(Math.abs(room0 - (maxLoad(s) - wornLoad(s) - u.share)) < EPS, `room = max load − worn − share (${room0.toFixed(2)} kg)`);

  // The first look: costs the action, rolls the contents, takes nothing.
  const box = b.raid.containers.find((c) => c.kind !== "body" && !c.lock && standNext(b, u, c.x, c.y));
  box.contents = null; box.searched = false;
  const cargo0 = JSON.stringify(p.cargo);
  u.ap = 2;
  const err = combatAct(st, { type: "search", unit: u.id, box: box.id, open: true });
  check(!err && u.ap === 1 && !!box.contents, `opening a container costs the action and rolls what is inside (${err || "ok"}, ap ${u.ap})`);
  check(JSON.stringify(p.cargo) === cargo0 && RL.haulLoad(u) === 0, "opening it takes nothing by itself");
  const err2 = combatAct(st, { type: "search", unit: u.id, box: box.id, open: true });
  check(!err2 && u.ap === 1, "opening it again is free");

  // Supplies: as many as fit, the rest stays.
  const room = RL.personalRoom(st, u);
  const k = "scrap", w = SUPPLIES[k].weight;
  const want = Math.floor(room / w) + 20;
  const box2 = boxWith(b, u, { [k]: want });
  const msg = RL.raidMove(st, u.id, `rbox:${box2.id}:sup:${k}`, `haul:${u.id}:list`);
  const took = u.haul.sup[k] || 0;
  check(took === Math.floor((room + EPS) / w) && box2.contents.sup[k] === want - took, `${want} ${k} offered: ${took} fit, ${box2.contents.sup[k]} stay inside (${msg})`);
  check(RL.personalRoom(st, u) > -EPS && RL.personalRoom(st, u) < w, `the survivor is filled up, not past it (${RL.personalRoom(st, u).toFixed(2)} kg left)`);
  check(b.raid.found[k] === took, `the raid counts what was taken (${b.raid.found[k]})`);
  check(/Too heavy/.test(RL.raidMove(st, u.id, `rbox:${box2.id}:sup:${k}`, `haul:${u.id}:list`)), "a full survivor takes no more");
  // Put half back.
  RL.raidMove(st, u.id, `haul:${u.id}:sup:${k}`, `rbox:${box2.id}:list`, Math.floor(took / 2));
  check(u.haul.sup[k] === took - Math.floor(took / 2) && b.raid.found[k] === u.haul.sup[k], `putting some back un-counts it (${u.haul.sup[k]} carried, found ${b.raid.found[k]})`);
  check(!box2.searched && box2.partial, "a container with things left in it is not done");
  // Someone else cannot take from it at a distance.
  const far = us[1];
  far.x = 0; far.y = 0;
  check(/next to it/.test(RL.raidMove(st, far.id, `rbox:${box2.id}:sup:${k}`, `haul:${far.id}:list`)), "only someone next to a container takes from it");

  // Gear: slots, pockets, the pack; a swap; things that do not fit a slot.
  u.haul.sup[k] = 0;
  s.gear.weapon = newItem("knife");
  s.pockets = s.pockets.map(() => null);
  const gun = newItem("pistol"), rifle = newItem("ar");
  const box3 = boxWith(b, u, {}, [gun, rifle]);
  check(/too big for a pocket/.test(RL.raidMove(st, u.id, `rbox:${box3.id}:gear:1`, `s:${s.id}:pocket:0`)), "a rifle does not go in a pocket");
  const m = RL.raidMove(st, u.id, `rbox:${box3.id}:gear:0`, `s:${s.id}:weapon`);
  check(s.gear.weapon === gun && box3.contents.gear.some((g) => g.key === "knife"), `taking a pistol into the hands swaps the knife into the container (${m})`);
  check(u.weapon === "pistol", `the unit fights with the pistol at once (${u.weapon})`);
  const m2 = RL.raidMove(st, u.id, `rbox:${box3.id}:gear:${box3.contents.gear.findIndex((g) => g.key === "knife")}`, `s:${s.id}:pocket:0`);
  check(s.pockets[0] && s.pockets[0].key === "knife", `the knife goes in a pocket (${m2})`);
  // Take all: what fits.
  u.haul.gear.length = 0;
  const box4 = boxWith(b, u, { f_rationbar: 2, water: 2 }, [newItem("pistol")]);
  const r = RL.raidTakeAll(st, u.id, box4.id);
  check(r.got.length >= 2 && box4.contents.gear.length === 0 && (u.haul.sup.f_rationbar || 0) >= 2, `Take all takes everything that fits (${r.got.join(", ")})`);
  check(box4.searched, "an emptied container is done");

  // Found ammo can be used at once (the haul is one of the battle's pools).
  const ammoBefore = b.pools.reduce((a, o) => a + Math.floor(o.ammo || 0), 0);
  const box5 = boxWith(b, u, { ammo: 5 });
  RL.raidMove(st, u.id, `rbox:${box5.id}:sup:ammo`, `haul:${u.id}:list`);
  check(b.pools.reduce((a, o) => a + Math.floor(o.ammo || 0), 0) === ammoBefore + 5, "found ammo counts for shooting at once");

  // Save mid-raid, load, and the haul is still one of the pools.
  const st2 = deserializeState(serializeState(st));
  const u2 = st2.combat.units.find((x) => x.id === u.id);
  check(st2.combat.pools.includes(u2.haul.sup), "a raid saved mid-search loads with what everyone carries still in the supply pools");

  // Extraction: those who get out bring what they carry; the lost lose it.
  const lost = us[2];
  const lostBox = boxWith(b, lost, { f_rationbar: 3 });
  RL.raidMove(st, lost.id, `rbox:${lostBox.id}:sup:f_rationbar`, `haul:${lost.id}:list`);
  const foodHome = (u.haul.sup.f_rationbar || 0);
  const cargoFood0 = (p.cargo.supplies.f_rationbar || 0) || 0;
  const zone = b.raid.zones[0];
  for (const x of us) if (x !== lost) { x.x = zone.x0 + 1; x.y = zone.y0 + 1; x.ap = 2; b.phase = "player"; }
  for (const x of us) if (x !== lost) { x.x = zone.x0 + us.indexOf(x); x.y = zone.y0 + 1; combatAct(st, { type: "extract", unit: x.id }); }
  lost.x = b.w - 1; lost.y = b.h - 1; lost.down = true;
  combatAct(st, { type: "end" });
  for (let i = 0; i < 20 && !b.over; i++) { runEnemyPhase(st); if (!b.over) combatAct(st, { type: "end" }); }
  check(b.over, "the raid ends when everyone left has extracted");
  const got = ((p.cargo.supplies.f_rationbar || 0) || 0) - cargoFood0;
  check(Math.abs(got - foodHome) < EPS || b.result.raid.carriedIds.includes(lost.sid), `the extracted bring their finds into the team's cargo (+${got} food, carried ${foodHome})`);
  if (!b.result.raid.carriedIds.includes(lost.sid)) check(!(((b.result.loot.supplies || {}).f_rationbar || 0) >= foodHome + 3), "what the lost carried is not counted as found");
}

// ======================================================================================
console.log("A car: the team's things ride in it, the trunk is opened at the vehicle");
{
  const { st, b, p } = raid({ vehicle: "truck" });
  check(b.raid.vehicleZone >= 0, "the truck waits in its zone");
  const us = players(b);
  check(us.every((u) => u.share === 0), "with a car nobody carries the team's supplies in");
  const u = us[0];
  const z = b.raid.zones[b.raid.vehicleZone];
  u.x = z.x0 + 1; u.y = z.y0 + 1;
  check(RL.atVehicle(b, u), "standing in the vehicle zone reaches the trunk");
  const space0 = RL.trunkSpace(st, b);
  check(Math.abs(space0 - (partyCapacity(st, p) - poolLoad(p))) < 0.01, `trunk space = what the team can carry with it less its load (${space0.toFixed(1)} kg)`);
  // Pick up far away, walk back, unload.
  const box = boxWith(b, u, { scrap: 5 }, [newItem("ar")]);
  RL.raidTakeAll(st, u.id, box.id);
  const carried = RL.haulLoad(u);
  check(carried > 0 && Math.abs(RL.trunkSpace(st, b) - (space0 - carried)) < 0.01, `what people carry counts against the car too (it takes it home): ${RL.trunkSpace(st, b).toFixed(1)} kg free`);
  u.x = b.w - 2; u.y = 1;
  check(/at the vehicle/.test(RL.raidMove(st, u.id, `haul:${u.id}:sup:scrap`, `trunk:${p.id}:list`)), "away from the vehicle the trunk cannot be reached");
  u.x = z.x0 + 1; u.y = z.y0 + 1;
  const scrap0 = p.cargo.supplies.scrap || 0;
  const r = RL.stashAll(st, u.id);
  check(r.put.length >= 1 && RL.haulLoad(u) < EPS && (p.cargo.supplies.scrap || 0) - scrap0 === 5 && p.cargo.gear.some((g) => g.key === "ar"), `unloading puts what they carry in the car (${r.put.join(", ")})`);
  check(Math.abs(RL.trunkSpace(st, b) - (space0 - carried)) < 0.01, "moving things from a person into the car does not change how much more the car takes");
  check(RL.personalRoom(st, u) > carried - EPS, "and frees the survivor");
  // Take something out of the car.
  const it = p.cargo.gear.find((g) => g.key === "ar");
  const m = RL.raidMove(st, u.id, `trunk:${p.id}:gear:${p.cargo.gear.indexOf(it)}`, `haul:${u.id}:list`);
  check(u.haul.gear.includes(it) && !p.cargo.gear.includes(it), `taking a rifle out of the car (${m})`);
  // Packed supplies come out of the trunk too (found first, then packed).
  const fk = Object.keys(p.supplies).find((k) => FOODS[k] && p.supplies[k] >= 2) || "f_rationbar"; // the packed food, by type (sim/foods.js)
  const food0 = p.supplies[fk] || 0, held0 = u.haul.sup[fk] || 0;
  RL.raidMove(st, u.id, `trunk:${p.id}:sup:${fk}`, `haul:${u.id}:list`, 2);
  check(u.haul.sup[fk] === held0 + 2 && (p.supplies[fk] || 0) === food0 - 2, `packed food can be taken out of the car (2 ${FOODS[fk].word})`);
  // A full car: nothing more.
  p.cargo.supplies.scrap = (p.cargo.supplies.scrap || 0) + Math.ceil(RL.trunkSpace(st, b) / SUPPLIES.scrap.weight) + 5;
  const boxF = boxWith(b, u, { scrap: 10 });
  u.x = z.x0 + 1; u.y = z.y0 + 1;
  if (RL.atVehicle(b, u) && box.x != null) {
    const mf = RL.raidMove(st, u.id, `haul:${u.id}:sup:f_rationbar`, `trunk:${p.id}:list`);
    check(!/full/.test(mf), `a full car still takes what a person already carries (it rides home either way): ${mf}`);
  }
  const before = RL.haulLoad(u);
  standNext(b, u, boxF.x, boxF.y);
  const mf2 = RL.raidMove(st, u.id, `rbox:${boxF.id}:sup:scrap`, `haul:${u.id}:list`);
  check(/full/.test(mf2) && Math.abs(RL.haulLoad(u) - before) < EPS, `a full car: nobody can pick up more (${mf2})`);
}

// ======================================================================================
console.log("Bikes: the racks are the trunk");
{
  const { st, b, p } = raid({ vehicle: "bike" });
  if (check(b.raid.vehicleZone >= 0, "the bikes wait in their zone")) {
    const us = players(b);
    const t = RL.trunkInfo(st, b);
    check(t.bike && t.cap === 45, `3 bikes: 45 kg of racks (${t.cap})`);
    const shares = us.reduce((a, u) => a + u.share, 0);
    check(Math.abs(shares + Math.min(poolLoad(p), 45) - poolLoad(p)) < 0.05, `what is not on the racks is shared out among the people (${shares.toFixed(2)} kg)`);
  }
}

// ======================================================================================
Object.assign(RL.HAUL, HAUL0);
// A unit with a fresh turn: both actions, nothing hauled yet.
const fresh = (b, u) => { u.ap = 2; u.haulTurn = b.turn; u.hauledKg = 0; };
// Puts unit m on a free cell right next to unit u.
function besides(b, u, m) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = u.x + dx, ny = u.y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !CELL[b.cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
    m.x = nx; m.y = ny;
    return true;
  }
  return false;
}

// ======================================================================================
console.log("Hauling takes time: the first kg a turn are free, then kg an action");
{
  const { st, b } = raid();
  const [u] = players(b);
  fresh(b, u);
  u.share = -200; // room is not the limit here: time is
  const box = boxWith(b, u, { scrap: 40 });
  const w = SUPPLIES.scrap.weight;
  check(RL.haulBudget(b, u) === RL.HAUL.free + 2 * RL.HAUL.per, `with both actions left: ${RL.HAUL.free} kg free + ${RL.HAUL.per} kg an action (${RL.haulBudget(b, u)} kg)`);
  RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`, Math.floor(RL.HAUL.free / w));
  check(u.ap === 2, `the first ${RL.HAUL.free} kg cost nothing (ap ${u.ap})`);
  RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`, 1);
  check(u.ap === 1, `one more scrap starts the next ${RL.HAUL.per} kg: an action (ap ${u.ap})`);
  RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`);
  const most = Math.floor((RL.HAUL.free + 2 * RL.HAUL.per) / w);
  check(u.ap === 0 && u.haul.sup.scrap === most && box.contents.sup.scrap === 40 - most, `taking all of it stops when the actions run out (${u.haul.sup.scrap} carried, ${box.contents.sup.scrap} left)`);
  const late = RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`);
  check(/No time/.test(late), `with no actions left the rest waits ("${late.slice(0, 50)}…")`);
  const back = RL.raidMove(st, u.id, `haul:${u.id}:sup:scrap`, `rbox:${box.id}:list`, 2);
  check(!/No time/.test(back) && box.contents.sup.scrap === 42 - most, `putting things back is free (${back})`);
  // Next turn: the time is back.
  b.turn++; u.ap = 2;
  const again = RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`, 2);
  check(!/No time/.test(again) && RL.hauled(b, u) === 2 * w, `next turn they can haul again (${again})`);
  // One action left: free kg plus one action's worth.
  fresh(b, u); u.ap = 1; u.haul.sup.scrap = 0;
  const box2 = boxWith(b, u, { scrap: 30 });
  RL.raidMove(st, u.id, `rbox:${box2.id}:sup:scrap`, `haul:${u.id}:list`);
  check(u.ap === 0 && u.haul.sup.scrap === Math.floor((RL.HAUL.free + RL.HAUL.per) / w), `with one action: ${RL.HAUL.free + RL.HAUL.per} kg (${u.haul.sup.scrap} scrap)`);
  // One heavy thing: all the actions they have left.
  fresh(b, u); u.ap = 1; u.hauledKg = RL.HAUL.free + RL.HAUL.per - 1; u.haul.sup.scrap = 0;
  const box3 = boxWith(b, u, {}, [newItem("ar")]);
  const big = RL.raidMove(st, u.id, `rbox:${box3.id}:gear:0`, `haul:${u.id}:list`);
  check(!/No time/.test(big) && u.ap === 0 && u.haul.gear.some((g) => g.key === "ar"), `one heavy thing can always be lifted with what is left of the turn (${big})`);
  // Take all stops when time runs out, and says so.
  fresh(b, u); u.ap = 0;
  const box4 = boxWith(b, u, { scrap: 20 });
  const r = RL.raidTakeAll(st, u.id, box4.id);
  check(r.outOfTime && box4.contents.sup.scrap === 20 - Math.floor(RL.HAUL.free / w), `Take all with no actions left takes the free kg and stops (${r.got.join(", ")})`);
}

// ======================================================================================
console.log("Teammates next to each other hand things over");
{
  const { st, b } = raid();
  const [u, mate, far] = players(b);
  fresh(b, u);
  const box = boxWith(b, u, { f_rationbar: 2 }, [newItem("pistol")]);
  const placed = besides(b, u, mate);
  far.x = 0; far.y = 0;
  check(placed && RL.matesOf(b, u).includes(mate) && !RL.matesOf(b, u).includes(far), "the teammate right next to them can hand things over; one across the map cannot");
  RL.raidMove(st, u.id, `rbox:${box.id}:sup:f_rationbar`, `haul:${u.id}:list`);
  const ap0 = u.ap;
  const m = RL.raidMove(st, u.id, `haul:${u.id}:sup:f_rationbar`, `haul:${mate.id}:list`);
  check(mate.haul.sup.f_rationbar === 2 && !u.haul.sup.f_rationbar && u.ap === ap0, `handing food over takes no time (${m})`);
  const nope = RL.raidMove(st, u.id, `haul:${mate.id}:sup:f_rationbar`, `haul:${far.id}:list`);
  check(/right next to/.test(nope), `not to someone who is not next to them (${nope})`);
  // Straight from the box into the teammate's hands: they fight with it at once.
  const ms = survivorById(st, mate.sid);
  ms.gear.weapon = null;
  const mg = RL.raidMove(st, u.id, `rbox:${box.id}:gear:0`, `s:${ms.id}:weapon`);
  check(ms.gear.weapon && ms.gear.weapon.key === "pistol" && mate.weapon === "pistol", `a pistol from the box into the teammate's hands (${mg}; fights with ${mate.weapon})`);
  // Their own max load still holds.
  mate.haul.sup.scrap = (mate.haul.sup.scrap || 0) + Math.floor(RL.personalRoom(st, mate) / SUPPLIES.scrap.weight);
  u.haul.sup.scrap = 3;
  const full = RL.raidMove(st, u.id, `haul:${u.id}:sup:scrap`, `haul:${mate.id}:list`);
  check(/Too heavy/.test(full) && full.includes(mate.name.split(" ")[0]), `a full teammate takes no more (${full})`);
  // A downed teammate can be relieved of what they carry.
  mate.down = true;
  const rel = RL.raidMove(st, u.id, `haul:${mate.id}:sup:f_rationbar`, `haul:${u.id}:list`);
  check(u.haul.sup.f_rationbar === 2, `taking what a downed teammate carries (${rel})`);
}

// ======================================================================================
console.log("Someone who bleeds out drops what they carried");
{
  const { st, b } = raid();
  const [u, lost] = players(b);
  fresh(b, lost);
  const box = boxWith(b, lost, { f_rationbar: 3 }, [newItem("pistol")]);
  RL.raidTakeAll(st, lost.id, box.id);
  const found0 = JSON.stringify(b.raid.found);
  lost.down = true; lost.bleed = 1; lost.stab = false;
  combatAct(st, { type: "end" });
  for (let i = 0; i < 10 && b.phase !== "player" && !b.over; i++) runEnemyPhase(st);
  const pile = b.raid.containers.find((c) => c.drop && c.kind !== "ground"); // not the loads the team set down coming in (carry.js stageLoads)
  check(lost.dead && pile && pile.x === lost.x && pile.y === lost.y && pile.contents.sup.f_rationbar === 3, `bleeding out leaves a pile of what they carried where they fell (${pile ? pile.label : "none"})`);
  check(RL.haulLoad(lost) === 0, "and they carry nothing any more");
  if (pile) {
    fresh(b, u);
    standNext(b, u, pile.x, pile.y);
    const err = combatAct(st, { type: "search", unit: u.id, box: pile.id, open: true });
    check(!err && u.ap === 2, `the pile opens for free (${err || "ok"})`);
    RL.raidMove(st, u.id, `rbox:${pile.id}:sup:f_rationbar`, `haul:${u.id}:list`);
    check(u.haul.sup.f_rationbar === 3 && JSON.stringify(b.raid.found) === found0, `a teammate picks it up; it is not counted twice (${JSON.stringify(b.raid.found)})`);
  }
  // Left on the map at the end, a pile is lost and not counted.
  u.haul.sup.f_rationbar = 0;
  b.raid.found.water = 4;
  u.haul.sup.water = 4;
  const pile2 = RL.dropHaul(b, u);
  RL.raidHome(st, b, new Set());
  check(!!pile2 && !(b.raid.found.water > 0), `a pile left behind is not counted as found when the raid ends (${JSON.stringify(b.raid.found)})`);
}

// ======================================================================================
console.log("A tool picked up mid-raid works at once");
{
  const { st, b } = raid();
  const u = players(b)[0];
  const s = survivorById(st, u.sid);
  fresh(b, u);
  s.gear.tool = null;
  b.night = true;
  u.daySight = 9; u.sight = 3; u.light = u.nvg = false;
  const box = boxWith(b, u, {}, [newItem("flashlight"), newItem("nvg"), newItem("bandagekit")]);
  RL.raidMove(st, u.id, `rbox:${box.id}:gear:0`, `s:${s.id}:tool`);
  check(u.light && u.sight === Math.min(9, STEALTH.LIGHT_SIGHT), `a flashlight in the off hand: the light is on (sight ${u.sight})`);
  const iN = box.contents.gear.findIndex((g) => g.key === "nvg");
  RL.raidMove(st, u.id, `rbox:${box.id}:gear:${iN}`, `s:${s.id}:tool`);
  check(u.nvg && !u.light && u.sight === 9, `night vision instead: sees as by day (sight ${u.sight})`);
  const med0 = u.medicine;
  const iK = box.contents.gear.findIndex((g) => g.key === "bandagekit");
  RL.raidMove(st, u.id, `rbox:${box.id}:gear:${iK}`, `s:${s.id}:tool`);
  check(u.medKit && u.medKit.key === "bandagekit" && u.medicine > med0 && !u.nvg && u.sight === Math.min(9, STEALTH.NIGHT_SIGHT), `a bandage kit: better treatment (${med0} → ${u.medicine}), and the dark again (sight ${u.sight})`);
}

console.log("Headless raids: bots carry, unload at the vehicle, extract");
{
  // A bot that is full walks back to the truck and unloads, then goes on.
  const { st, b, p } = raid({ vehicle: "truck" });
  const u = players(b)[0];
  for (const x of players(b)) if (x !== u) x.left = true; // just the one
  const fill = Math.floor(RL.personalRoom(st, u) / SUPPLIES.scrap.weight);
  u.haul.sup.scrap = fill;
  const box = b.raid.containers.find((c) => c.kind !== "body" && !c.lock && c.x > b.raid.zones[b.raid.vehicleZone].x0 + 6);
  if (box) standNext(b, u, box.x, box.y);
  const scrap0 = p.cargo.supplies.scrap || 0;
  for (let t = 0; t < 30 && !b.over && (p.cargo.supplies.scrap || 0) - scrap0 < fill; t++) { autoPlayerTurn(st); if (!b.over) runEnemyPhase(st); }
  const put = (p.cargo.supplies.scrap || 0) - scrap0;
  check(put >= fill - 2 && RL.personalRoom(st, u) >= 2, `a full bot walks back to the truck and unloads until it has room again (${put} of ${fill} scrap in, ${RL.personalRoom(st, u).toFixed(1)} kg free)`);
}
{
  let runs = 0, unloads = 0, hauled = 0, over = 0, crashes = 0;
  for (const vehicle of [null, "truck"]) {
    for (let i = 0; i < 6; i++) {
      try {
        const { st, b, p } = raid({ vehicle });
        const z = b.raid.zones[b.raid.vehicleZone] || null;
        const cargo0 = poolLoad(p);
        for (let t = 0; t < 120 && !b.over; t++) {
          autoPlayerTurn(st);
          if (!b.over) runEnemyPhase(st);
          for (const u of players(b)) if (!u.dead && RL.personalRoom(st, u) < -0.01 && RL.haulLoad(u) > 0) over++;
        }
        if (z && b.log.some((l) => /into the vehicle/.test(l.text))) unloads++;
        hauled += poolLoad(p) - cargo0;
        runs++;
      } catch (e) { crashes++; console.log(e); }
    }
  }
  check(crashes === 0 && runs === 12, `12 auto raids, no crashes (${crashes})`);
  check(over === 0, `no survivor ever carries past their max (${over})`);
  check(hauled > 0, `the bots bring loot home (${hauled.toFixed(0)} kg in all)`);
  console.log(`  ${unloads} raids with a trip back to the truck`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
