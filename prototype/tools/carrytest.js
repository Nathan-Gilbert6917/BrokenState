// Carrying the team's supplies (src/sim/carry.js): food, water, firewood and fresh game held person by person in
// pockets, packs and the arms (and the vehicle); hands full block weapons in a fight until Drop carried (free); the
// ground on the State Map (put down, picked up later by another team, spoiling, the marker); how much to collect;
// a save and load; the autopilot playing on.
// Usage: node tools/carrytest.js [seed]   ("passed" / "failed" lines; exits 1 on a failure)
import { FOODS, unitsOf } from "../src/sim/foods.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, atBase, tickHour, survivorById } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem, moveItem, itemLoad, isCarryable, fitReason } from "../src/sim/inventory.js";
import { wornLoad } from "../src/sim/load.js";
import { launchExpedition, partyTile, cargoRoom, partyMembers, carried, partyLoad, settleInto } from "../src/sim/parties.js";
import * as C from "../src/sim/carry.js";
import { createBattle, combatAct, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler, canFire, fireRefusal, finishCombat } from "../src/sim/combat.js";
import { startOrder, describeOrder } from "../src/sim/orders.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { deathLabel } from "../src/sim/markers.js";
import { addMeat, meatIn } from "../src/sim/hunting.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "passed" : "failed"} ${what}`); return ok; };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const sumPlaced = (h, k) => C.placedOf(h, k);

function world(s = seed) {
  const st = createWorld({ seed: s, factionCount: 4 });
  st.started = true; st.visitorsOff = true; st.noWanderers = true;
  st.hordes.length = 0;
  return st;
}
// A team of n out on a land tile 2 from the hub, waiting there, with the supplies given.
function teamOut(st, n = 2, supplies = { food: 6, water: 6 }) {
  const h = hub(st);
  Object.assign(h.stock, { water: 300, ammo: 300, meds: 20 }); setFood(h, 300);
  const crew = atBase(st, h.id).slice(0, n);
  for (const s of crew) { s.gear.backpack = null; s.pockets = s.pockets.map(() => null); s.health = 100; }
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: null, supplies });
  const p = res.party;
  if (!p) throw new Error(`no team: ${res.error || JSON.stringify(res)}`);
  p.path = [dest]; p.idx = 0; p.phase = "waiting"; p.dest = dest;
  return { p, crew };
}

// ---------- 1. placing the pool ----------
console.log("Placing the team's supplies: packs, pockets, the arms");
{
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 6, water: 6 });
  const [a, b] = crew;
  a.gear.backpack = newItem("backpack"); // 6 slots
  p.cargo.supplies.rawwater = 30; // fetched from a river
  p.cargo.supplies.wood = 50;
  const h = C.settleHold(st, p);
  const tot = C.holdTotals(p);
  check(["food", "water", "rawwater", "wood"].every((k) => near(sumPlaced(h, k), tot[k])), `every unit is somewhere: ${["food", "water", "rawwater", "wood"].map((k) => `${k} ${sumPlaced(h, k)}/${tot[k]}`).join(", ")}`);
  const ra = h.by[a.id], rb = h.by[b.id];
  const packSlots = Object.entries(ra.pack).reduce((s, [k, q]) => s + Math.ceil(q / C.HOLD[k].pack - 1e-6), 0);
  check(packSlots <= 6 && packSlots === 6 && (ra.pack.water || 0) > 0, `the school backpack's 6 slots hold water first (${C.recText(ra.pack)}; ${packSlots} slots)`);
  check(Object.keys(rb.pack).length === 0, "no pack: nothing in the pack");
  check(Object.values(ra.pocket).reduce((x, y) => x + y, 0) + Object.values(rb.pocket).reduce((x, y) => x + y, 0) > 0 && !ra.pocket.wood && !rb.pocket.wood, `pockets take small things only (${C.recText(ra.pocket)} / ${C.recText(rb.pocket)}; no firewood)`);
  const handsA = C.kgOf(ra.hands), handsB = C.kgOf(rb.hands);
  check(handsA + handsB > 0 && handsA <= C.HANDS_KG + 1e-6 && handsB <= C.HANDS_KG + 1e-6, `the rest is carried in the arms, at most ${C.HANDS_KG} kg each (${Math.round(handsA * 10) / 10} kg and ${Math.round(handsB * 10) / 10} kg)`);
  const weak = [a, b].sort((x, y) => (combat(x) - combat(y)))[0];
  check(C.kgOf(h.by[weak.id].hands) >= Math.min(handsA, handsB), "the weaker fighter carries first");
  check(near(C.kgOf(ra.pack) + C.kgOf(ra.pocket) + C.kgOf(ra.hands) + C.kgOf(rb.pack) + C.kgOf(rb.pocket) + C.kgOf(rb.hands), C.kgOf(tot)), `the weights add up to the pool's (a day of food ${C.unitKg("food")} kg, water 1 kg, firewood 0.1 kg: ${C.kgOf(tot).toFixed(1)} kg)`);
  // Drinking lightens the arms first.
  const before = C.kgOf(h.by[a.id].hands) + C.kgOf(h.by[b.id].hands);
  p.cargo.supplies.rawwater -= 5;
  C.settleHold(st, p);
  const after = C.kgOf(h.by[a.id].hands) + C.kgOf(h.by[b.id].hands);
  check(near(before - after, 5), `5 water drunk comes off the arms first (${before} → ${after} kg)`);
  // A move by hand stays put; a full place refuses.
  const kOut = Object.keys(ra.pack)[0];
  const m1 = C.moveHeld(st, p, kOut, 1, { sid: a.id, place: "pack" }, { sid: a.id, place: "hands" });
  C.settleHold(st, p);
  check(/→/.test(m1) && (h.by[a.id].hands[kOut] || 0) >= 1, `moveHeld: 1 ${kOut} from the pack to the arms (${m1})`);
  const m2 = C.moveHeld(st, p, "wood", 10, { sid: (h.by[a.id].hands.wood ? a : b).id, place: "hands" }, { sid: b.id, place: "pack" });
  check(/No room/.test(m2), `no pack, no room (${m2})`);
  const m3 = C.moveHeld(st, p, "wood", 5, { sid: (h.by[a.id].hands.wood ? a : b).id, place: "hands" }, { sid: a.id, place: "pocket" });
  check(/No room/.test(m3), `firewood never goes in a pocket (${m3})`);
  // An item in the pack pushes supplies out into the arms.
  a.gear.backpack.contents[0] = newItem("flashlight");
  C.settleHold(st, p);
  const slots2 = Object.entries(h.by[a.id].pack).reduce((s, [k, q]) => s + Math.ceil(q / C.HOLD[k].pack - 1e-6), 0);
  check(slots2 <= 5 && ["food", "water", "rawwater", "wood"].every((k) => near(sumPlaced(h, k), C.holdTotals(p)[k])), `an item in the pack leaves 5 slots for supplies (${slots2}), the rest still held`);
  // Fresh game is its own stack at 1 kg a ration.
  addMeat(st, p, 4);
  C.settleHold(st, p);
  check(near(sumPlaced(h, "meat"), 4) && near(C.holdTotals(p).food + 4, carried(p, "food")), "fresh game is held as its own stack (food without it stays food)");
}
function combat(s) { return (s.skills && s.skills.shooting) || 0; }

// ---------- 2. a vehicle takes it ----------
console.log("A car carries it all; nobody's hands are full");
{
  const st = world();
  const { p } = teamOut(st, 2, { food: 6, water: 6 });
  const v = st.vehicles.find((x) => x.type !== "bike");
  if (v) {
    p.vehicleId = v.id; p.vehicle = true;
    p.cargo.supplies.rawwater = 40;
    C.settleHold(st, p);
    check(C.carriersOf(st, p).length === 0 && near(C.kgOf(p.hold.car), C.kgOf(C.holdTotals(p))), "with a car everything goes in the vehicle");
    check(C.fitsStowed(st, p, "rawwater") === Infinity, "a car: any amount fits with free hands");
  } else check(true, "(no car in this world to test)");
}

// ---------- 3. hands in a fight ----------
console.log("Hands full in a fight: no weapon until Drop carried (free)");
registerCombatHandler("carrytest", () => {});
{
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 4, water: 4 });
  for (const s of crew) s.gear.weapon = newItem("pistol");
  p.supplies.ammo = 60; p.supplies.a_9mm_fmj = 60;
  p.cargo.supplies.rawwater = 40;
  const setup = { tile: partyTile(p), partyId: p.id, enemy: { kind: "zombies", count: 2, power: 2 }, ambush: null, canRetreat: true, handler: "carrytest", context: {} };
  const b = (st.combat = createBattle(st, setup));
  const loaded = b.units.filter((u) => u.side === "player" && u.hands);
  check(loaded.length >= 1, `carriers start with their hands full (${loaded.map((u) => `${u.name.split(" ")[0]}: ${C.recText(u.hands)}`).join("; ")})`);
  const u = loaded[0];
  const foe = b.units.find((x) => x.side === "enemy");
  check(!canFire(b, u) && /Hands full/.test(fireRefusal(b, u)), `cannot fire (${fireRefusal(b, u)})`);
  const errShoot = combatAct(st, { type: "shoot", unit: u.id, target: foe.id });
  const errMelee = combatAct(st, { type: "melee", unit: u.id, target: foe.id });
  const errReload = combatAct(st, { type: "reload", unit: u.id });
  check(/Hands full/.test(errShoot) && /Hands full/.test(errMelee) && /Hands full/.test(errReload), "shoot, melee and reload are refused with hands full");
  const ap = u.ap;
  const err = combatAct(st, { type: "dropCarried", unit: u.id });
  const pile = b.fieldLoot && b.fieldLoot.containers.find((c) => c.kind === "ground" && c.x === u.x && c.y === u.y);
  check(!err && !u.hands && u.ap === ap && (b.armsDrops || []).length === 1 && pile && Object.values(pile.contents.sup).some((v) => v > 0), `Drop carried: free (${ap} actions left), the load is a pile on the cell (ground.js)`);
  check(canFire(b, u), "after dropping it the gun works again");
  // Bodies: carrying one blocks a blow with a weapon too.
  u.carrying = 999;
  check(/Hands full/.test(combatAct(st, { type: "melee", unit: u.id, target: foe.id })), "carrying a body blocks melee too");
  u.carrying = null;
  // Pick it up again (1 action).
  const e2 = combatAct(st, { type: "pickCarried", unit: u.id });
  check(!e2 && u.hands && u.ap === ap - 1, `Pick up load: 1 action, hands full again (${e2 || C.recText(u.hands)})`);
  // The AI drops before it fights, wins, and the team keeps it all.
  const poolBefore = C.kgOf(C.holdTotals(p));
  for (let i = 0; i < 60 && !b.over; i++) { autoPlayerTurn(st); runEnemyPhase(st); }
  check(b.over && b.units.filter((x) => x.side === "player").every((x) => !x.hands || x.left), "the battle AI set everything down");
  closeCombat(st);
  check(b.result.outcome !== "victory" || near(C.kgOf(C.holdTotals(p)), poolBefore, 0.6), `won: everything picked up again (${Math.round(poolBefore)} → ${Math.round(C.kgOf(C.holdTotals(p)))} kg; outcome ${b.result.outcome})`);
}
{
  // Retreat (a fight not won): what was set down stays on the ground of the tile.
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 4, water: 4 });
  p.cargo.supplies.rawwater = 40;
  const setup = { tile: partyTile(p), partyId: p.id, enemy: { kind: "zombies", count: 2, power: 2 }, ambush: null, canRetreat: true, handler: "carrytest", context: {} };
  const b = (st.combat = createBattle(st, setup));
  const set = b.units.filter((u) => u.side === "player" && u.hands);
  const kg = set.reduce((a, u) => a + C.kgOf(u.hands), 0), pool0 = C.kgOf(C.holdTotals(p));
  combatAct(st, { type: "dropAllCarried" });
  b.over = true; b.result = { outcome: "retreat", loot: { supplies: {}, gear: [] }, survivorsHurt: [], survivorsDead: [] };
  finishCombat(st, setup, b.result);
  const site = C.groundAt(st, partyTile(p));
  const onGround = site ? site.items.reduce((a, it) => a + (it.kind !== "supply" ? 0 : FOODS[it.key] ? unitsOf(it.key, it.qty) * C.unitKg(C.holdKeyOf(it.key)) : it.qty * C.unitKg(it.key)), 0) : 0; // food: days of it at the hold's kg a day
  check(site && near(onGround, kg, 0.05) && near(C.kgOf(C.holdTotals(p)), pool0 - kg, 0.05) && crew.every((s) => !C.handsOf(st, s)), `retreated: ${Math.round(kg)} kg set down stays on the ground (${site ? C.groundText(site) : "none"}), out of the pool`);
}
{
  // By the numbers: a fight lost drops what was carried; one won keeps it.
  const st = world();
  const { p } = teamOut(st, 2, { food: 4, water: 4 });
  p.cargo.supplies.rawwater = 40;
  const setup = { tile: partyTile(p), partyId: p.id, enemy: { kind: "zombies", count: 2, power: 2 }, handler: "carrytest", context: {} };
  const kg0 = C.kgOf(C.holdTotals(p));
  finishCombat(st, setup, { outcome: "victory", loot: { supplies: {}, gear: [] }, survivorsHurt: [], survivorsDead: [] });
  check(near(C.kgOf(C.holdTotals(p)), kg0), "by the numbers, won: nothing lost");
  const held = C.carriersOf(st, p).reduce((a, x) => a + C.kgOf(x.hands), 0);
  finishCombat(st, setup, { outcome: "retreat", loot: { supplies: {}, gear: [] }, survivorsHurt: [], survivorsDead: [] });
  check(held > 0 && near(C.kgOf(C.holdTotals(p)), kg0 - held, 0.05) && C.groundAt(st, partyTile(p)), `by the numbers, broken off: the ${Math.round(held)} kg carried by hand stays on the ground`);
}

// ---------- 4. the ground on the State Map ----------
console.log("The ground: put down by one team, picked up by another");
{
  const st = world();
  const { p, crew } = teamOut(st, 1, { food: 8, water: 4 });
  p.cargo.supplies.wood = 60;
  C.settleHold(st, p);
  const tile = partyTile(p);
  const msg = C.dropHands(st, p);
  const site = C.groundAt(st, tile);
  check(site && /firewood/.test(C.groundText(site)) && !C.carriersOf(st, p).length, `Set down: ${msg}`);
  const item = newItem("machete");
  crew[0].pockets[0] = null;
  p.cargo.gear.push(item);
  const m2 = C.dropItemToGround(st, `cargo:${p.id}:list:${p.cargo.gear.indexOf(item)}`);
  check(/on the ground/.test(m2) && site.items.some((it) => it.item === item), `an item on the ground (${m2})`);
  const mk = st.markers.find((m) => m.key === `death:${tile}`);
  check(mk && /Cargo left behind: .*firewood/.test(mk.label) && /Machete/.test(deathLabel(site)), `a marker on the map with the contents (${mk && mk.label})`);
  // Food on the ground spoils.
  C.dropHeld(st, p, "food", 4, { sid: crew[0].id, place: C.settleHold(st, p).by[crew[0].id].pack.food ? "pack" : C.settleHold(st, p).by[crew[0].id].pocket.food ? "pocket" : "hands" });
  const fit = site.items.find((it) => it.kind === "supply" && FOODS[it.key]);
  const left0 = fit ? fit.left ?? FOODS[fit.key].shelf : 0;
  C.groundDaily(st);
  check(!!fit && fit.left < left0, `food on the ground spoils: its shelf runs down (${fit ? `${FOODS[fit.key].name} ${Math.round(left0 * 10) / 10} → ${Math.round(fit.left * 10) / 10} days` : "none"})`);
  // Another team comes to the tile and picks part of it up.
  const { p: q } = teamOut(st, 1, { food: 2, water: 2 });
  q.path = [tile]; q.idx = 0; q.dest = tile;
  const iWood = site.items.findIndex((it) => it.key === "wood");
  const before = site.items[iWood].qty;
  const r = C.pickUpGround(st, q, iWood, 20);
  check(/Picked up 20 firewood/.test(r) && near(site.items[iWood].qty, before - 20) && near(q.cargo.supplies.wood || 0, 20), `another team picks up 20 of ${before} firewood (${r})`);
  const r2 = C.pickUpAll(st, q);
  check(/Picked up/.test(r2) && q.cargo.gear.includes(item), `Pick up all: ${r2}`);
  const left = C.groundAt(st, tile);
  if (!left) check(!st.markers.some((m) => m.key === `death:${tile}`), "an emptied ground loses its marker");
  else check(left.items.length > 0, `what did not fit stays (${C.groundText(left)})`);
  // Room is respected.
  const { p: r3 } = teamOut(st, 1, { food: 0, water: 0 });
  r3.path = [tile]; r3.idx = 0;
  const big = C.groundAt(st, tile, true);
  big.items.push({ kind: "supply", key: "scrap", name: "Scrap", qty: 500, value: 500 });
  const room = cargoRoom(st, r3);
  C.pickUpGround(st, r3, big.items.length - 1);
  check((r3.cargo.supplies.scrap || 0) * 2 <= room + 1e-6 && (r3.cargo.supplies.scrap || 0) > 0, `a pick up takes only what fits (${r3.cargo.supplies.scrap} scrap = ${(r3.cargo.supplies.scrap || 0) * 2} kg of ${Math.round(room)} kg room)`);
}

// ---------- 5. how much to collect ----------
console.log("How much to collect");
{
  const st = world();
  const { p } = teamOut(st, 2, { food: 4, water: 4 });
  const tile = st.tiles.find((t) => t.terrain !== "water" && st.grid.neighbors(t.id).some((n) => st.tiles[n].terrain === "water"));
  p.path = [tile.id]; p.idx = 0; p.dest = tile.id;
  const info = C.collectInfo(st, p, "water");
  check(info && info.key === "rawwater" && info.kg === 1 && info.max === Math.floor(cargoRoom(st, p)) && info.stowed <= info.max, `the box: ${info.max} un-purified water fit (${Math.round(info.room)} kg room), ${info.stowed} with free hands`);
  startOrder(st, p, { type: "water", qty: 12 });
  check(describeOrder(st, p.task) === "Fetch water (12)", `the order says how much (${describeOrder(st, p.task)})`);
  for (let i = 0; i < 3 && p.phase === "task"; i++) tickHour(st);
  check((p.cargo.supplies.rawwater || 0) === 12, `Fetch water with 12 asked: 12 carried (${p.cargo.supplies.rawwater})`);
  const room2 = Math.floor(cargoRoom(st, p));
  p.phase = "waiting"; p.task = null;
  startOrder(st, p, { type: "water" });
  for (let i = 0; i < 3 && p.phase === "task"; i++) tickHour(st);
  check((p.cargo.supplies.rawwater || 0) >= 12 + room2 - 2, `no quantity (the governor, the AI): the most that fits (${p.cargo.supplies.rawwater})`);
  // A capped task's room.
  const { p: q } = teamOut(st, 2, { food: 4, water: 4 });
  q.path = [tile.id]; q.idx = 0; q.dest = tile.id;
  startOrder(st, q, { type: "wood", hours: 4, qty: 30 });
  if (q.phase === "task") {
    check(near(cargoRoom(st, q), 3, 0.01), `Cut wood, 30 asked: room for 3 kg (30 × 0.1) while it works (${cargoRoom(st, q)})`);
    for (let i = 0; i < 6 && q.phase === "task"; i++) tickHour(st);
    check((q.cargo.supplies.wood || 0) <= 30.0001, `it stops at 30 firewood (${Math.round((q.cargo.supplies.wood || 0) * 10) / 10})`);
  } else check(true, `(no wood on this tile: ${q.lastMsg || "skipped"})`);
}

// ---------- 6. save and load ----------
console.log("Save and load");
{
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 6, water: 6 });
  crew[0].gear.backpack = newItem("assaultpack");
  p.cargo.supplies.rawwater = 30;
  C.settleHold(st, p);
  C.moveHeld(st, p, "food", 2, { sid: crew[0].id, place: C.settleHold(st, p).by[crew[0].id].pack.food ? "pack" : "pocket" }, { sid: crew[1].id, place: "hands" });
  const h6 = C.settleHold(st, p);
  const at = Object.entries(h6.by).flatMap(([sid, r]) => C.PLACES.map((pl) => ({ sid: Number(sid), place: pl, q: r[pl].rawwater || 0 }))).find((x) => x.q >= 5);
  C.dropHeld(st, p, "rawwater", 5, { sid: at.sid, place: at.place });
  const want = JSON.stringify(p.hold);
  const ground = C.groundText(C.groundAt(st, partyTile(p)));
  const ld = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const q = ld.parties.find((x) => x.id === p.id);
  check(JSON.stringify(q.hold) === want, "p.hold comes back as it was");
  check(ground !== "nothing" && C.groundText(C.groundAt(ld, partyTile(q))) === ground, `the ground comes back (${ground})`);
  C.settleHold(ld, q);
  check(JSON.stringify(q.hold) === want, "and settles to the same");
}

// ---------- 7. a bag carried in the arms ----------
console.log("A bag carried in the arms: weight, hands full, set down whole, picked up again");
const lootedPack = () => { const pk = newItem("hikingpack"); pk.contents[0] = newItem("flashlight"); pk.contents[1] = newItem("machete"); pk.contents[2] = newItem("knife"); return pk; };
const bagKgOf = (pk) => itemLoad(pk);
{
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 4, water: 4 });
  const [a, b] = crew;
  a.gear.backpack = newItem("backpack"); // already wears a pack
  const pk = lootedPack();
  p.cargo.gear.push(pk);
  const kgBag = bagKgOf(pk);
  const worn0 = wornLoad(a), total0 = partyLoad(st, p).total;
  check(isCarryable(pk) && !isCarryable(newItem("machete")) && /Only a bag/.test(fitReason(newItem("machete"), "carry")), "packs, rigs and cases can be carried in the arms; a machete cannot");
  const m = moveItem(st, `cargo:${p.id}:list:${p.cargo.gear.indexOf(pk)}`, `s:${a.id}:carry`);
  check(a.gear.carry === pk && !p.cargo.gear.includes(pk), `from the team's cargo into ${a.name.split(" ")[0]}'s arms (${m})`);
  check(near(wornLoad(a) - worn0, kgBag) && near(partyLoad(st, p).total, total0), `the bag and everything in it weigh on them: +${Math.round(kgBag * 10) / 10} kg (the team's total the same: it was in the cargo)`);
  check(C.carriersOf(st, p).some((x) => x.s === a && x.bag === pk), "they count as carrying (hands full)");
  // Supplies go to others' arms first; their arms have less room.
  p.cargo.supplies.rawwater = 30;
  const h = C.settleHold(st, p);
  check(C.kgOf(h.by[a.id].hands) + kgBag <= C.HANDS_KG + 1e-6 || C.kgOf(h.by[b.id].hands) >= C.HANDS_KG - 1e-6, `supplies go to the free arms first (${C.recText(h.by[b.id].hands)} / ${C.recText(h.by[a.id].hands)})`);
  // The API.
  check(/already carries/.test(C.carryBag(st, p, a, newItem("slingbag"))) && /Only a bag/.test(C.carryBag(st, p, b, newItem("machete"))), "carryBag: one bag at a time, only containers");
  // Take something out; it stays one bag.
  const out = moveItem(st, `s:${a.id}:bag:0`, `cargo:${p.id}:list`);
  check(!pk.contents[0] && p.cargo.gear.some((it) => it.key === "flashlight"), `things come out of the carried bag (${out})`);
  // In a fight.
  const setup = { tile: partyTile(p), partyId: p.id, enemy: { kind: "zombies", count: 2, power: 2 }, ambush: null, canRetreat: true, handler: "carrytest", context: {} };
  for (const s of crew) s.gear.weapon = newItem("pistol");
  p.supplies.a_9mm_fmj = 60;
  const bt = (st.combat = createBattle(st, setup));
  const u = bt.units.find((x) => x.sid === a.id);
  const foe = bt.units.find((x) => x.side === "enemy");
  check(u.bag === pk && !canFire(bt, u) && /the Hiking pack/.test(fireRefusal(bt, u)), `starts the fight with the bag in the arms: no shooting (${fireRefusal(bt, u)})`);
  check(/Hands full/.test(combatAct(st, { type: "melee", unit: u.id, target: foe.id })) && /Hands full/.test(combatAct(st, { type: "reload", unit: u.id })), "no melee, no reload");
  const ap = u.ap;
  check(!combatAct(st, { type: "dropCarried", unit: u.id }) && !u.bag && u.ap === ap && !a.gear.carry && (bt.armsDrops || []).some((c) => c.item === pk) && bt.fieldLoot.containers.some((c) => c.kind === "ground" && c.contents.gear.includes(pk)), "Drop carried: free; the bag lies in a pile on the cell (contents inside), off the survivor");
  check(canFire(bt, u), "hands free: the gun works");
  check(!combatAct(st, { type: "pickCarried", unit: u.id }) && u.bag === pk && a.gear.carry === pk, "Pick up load: the bag back in the arms");
  for (let i = 0; i < 60 && !bt.over; i++) { autoPlayerTurn(st); runEnemyPhase(st); }
  closeCombat(st);
  check(bt.result.outcome !== "victory" || (a.alive ? a.gear.carry === pk : true), `the AI set the bag down to fight; won, it is back in the arms (${bt.result.outcome})`);
  // Retreat: the bag stays on the ground, whole.
  if (a.alive && p.members.includes(a.id)) {
    if (!a.gear.carry) { a.gear.carry = pk; }
    const bt2 = (st.combat = createBattle(st, setup));
    combatAct(st, { type: "dropAllCarried" });
    bt2.over = true; bt2.result = { outcome: "retreat", loot: { supplies: {}, gear: [] }, survivorsHurt: [], survivorsDead: [] };
    finishCombat(st, setup, bt2.result);
    const site = C.groundAt(st, partyTile(p));
    const it = site && site.items.find((x) => x.item === pk);
    check(it && !a.gear.carry && pk.contents.filter(Boolean).length === 2, `retreated: the bag stays on the ground with its contents (${site ? C.groundText(site) : "none"})`);
    // Another teammate picks it up into their arms.
    const i = site.items.indexOf(it);
    const r = C.pickUpGround(st, p, i, Infinity, b.id);
    check(b.gear.carry === pk && !site.items.includes(it), `picked up into ${b.name.split(" ")[0]}'s arms from the ground (${r})`);
    // By the numbers, broken off: dropped.
    finishCombat(st, setup, { outcome: "retreat", loot: { supplies: {}, gear: [] }, survivorsHurt: [], survivorsDead: [] });
    const site2 = C.groundAt(st, partyTile(p));
    check(!b.gear.carry && site2 && site2.items.some((x) => x.item === pk), "by the numbers, broken off: the bag stays on the ground");
    // Set down on the State Map and picked up into the arms; put on.
    const j = site2.items.findIndex((x) => x.item === pk);
    C.pickUpGround(st, p, j, Infinity, b.id);
    const msg = C.dropHands(st, p, b.id);
    check(/Hiking pack \(with what is in it\)/.test(msg) && !b.gear.carry, `Set down on the map: ${msg}`);
    const k = C.groundAt(st, partyTile(p)).items.findIndex((x) => x.item === pk);
    C.pickUpGround(st, p, k, Infinity, b.id);
    b.gear.backpack = null;
    const on = moveItem(st, `s:${b.id}:carry`, `s:${b.id}:backpack`);
    check(b.gear.backpack === pk && !b.gear.carry && !C.carriersOf(st, p).some((x) => x.s === b && x.bag), `put on when the back is free (${on})`);
    const off = moveItem(st, `s:${b.id}:backpack`, `s:${b.id}:carry`);
    check(b.gear.carry === pk && !b.gear.backpack, `and off into the arms again (${off})`);
    // Save and load.
    const ld = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
    const b2 = survivorById(ld, b.id);
    check(b2.gear.carry && b2.gear.carry.key === "hikingpack" && b2.gear.carry.contents.filter(Boolean).length === 2, "a carried bag (and what is in it) survives a save and load");
    // Home: the bag goes in the armory.
    const home = hub(st);
    settleInto(st, p, home);
    check(!b.gear.carry && home.armory.includes(pk), "home again, a carried bag goes in the armory");
  } else check(true, "(the carrier fell: skipped the rest)");
}

// ---------- 8. the autopilot plays on ----------
console.log("The autopilot keeps working");
{
  const st = world(seed + 1);
  setAutopilot(st, true, "balanced");
  let err = null, teams = 0, held = 0;
  try {
    for (let i = 0; i < 24 * 20; i++) {
      tickHour(st);
      for (const p of st.parties) if (p.owner === "player" && p.kind !== "convoy") { teams++; const h = C.settleHold(st, p); if (h) for (const k of C.HOLD_KEYS) { if (Math.abs(C.placedOf(h, k) - C.holdTotals(p)[k]) > 1e-3) held++; } }
    }
  } catch (e) { err = e; }
  check(!err, `20 days on autopilot, no error${err ? `: ${err.stack}` : ""}`);
  check(held === 0, `every team's supplies always all placed (${teams} team-hours checked, ${held} mismatches)`);
  check(st.survivors.some((s) => s.alive), "people still alive");
}

// ---------- 9. the fights a team starts ----------
console.log("The fights a team starts set their loads down first (the vehicle first); the others catch them full-handed");
{
  const S = (setup, raid = false) => C.stagedStart({ setup, raid: raid ? {} : undefined });
  check(["baseAssault", "hiveAssault", "growthAssault", "rescueRaid", "rescue", "jobRescue"].every((h) => S({ handler: h })) && S({ mode: "raid", handler: "scavenge" }) && S({ handler: "crawl" }, true), "an assault on a base, a hive or a growth, a rescue, a raid: loads set down at the start");
  check(!["conflict", "wanderer", "roadCaravan", "outsiderFight", "crawlfight", "handoverAmbush"].some((h) => S({ handler: h })), "a fight on the road (an ambush, a band, outsiders): arms full as they were");
  const st = world();
  const { p } = teamOut(st, 2, { food: 4, water: 4 });
  p.cargo.supplies.rawwater = 40;
  registerCombatHandler("baseAssault9", () => {});
  C.STAGED_HANDLERS.add("baseAssault9");
  const setup = { tile: partyTile(p), partyId: p.id, enemy: { kind: "raiders", count: 2, power: 2 }, ambush: null, canRetreat: true, handler: "baseAssault9", context: {} };
  const kg0 = C.kgOf(C.holdTotals(p));
  const b = (st.combat = createBattle(st, setup));
  const down = (b.armsDrops || []).reduce((a, d) => a + C.kgOf(d.sup), 0);
  check(b.units.every((u) => !u.hands) && down > 0 && (b.armsDrops || []).every((d) => d.staged), `an assault starts with free hands, ${Math.round(down)} kg set down where they start`);
  b.over = true; b.result = { outcome: "retreat", loot: { supplies: {}, gear: [] }, survivorsHurt: [], survivorsDead: [] };
  finishCombat(st, setup, b.result);
  closeCombat(st);
  check(near(C.kgOf(C.holdTotals(p)), kg0, 0.05), "pulled out (not beaten): it is picked up again on the way");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
