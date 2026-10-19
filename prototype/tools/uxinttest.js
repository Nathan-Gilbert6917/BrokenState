// The UX branches wired together (ux-int): the carrying model (src/sim/carry.js) on the tactical ground piles
// (src/sim/ground.js) and the rounds kept in guns (src/sim/gunload.js); the team inventory window (src/sim/teaminv.js,
// src/ui/teaminv.js) with each member's holdings.
//   1. In a field battle a carrier sets down a load and a bag: both are ground piles (drawn on the map), the supplies
//      leave the pool, a gun in the bag leaves the team loaded; Pick up load takes the supplies back into the arms;
//      Carry in arms takes the bag off the pile (and a pack off a searched body) into the arms; won, what was set
//      down comes back and the gun's rounds are unloaded into the stores (no round made or lost).
//   2. Retreated: the loads set down stay on the tile's ground (the team panel's Pick up…).
//   3. The team inventory: who holds what (pockets, pack, arms, vehicle); Drop off what one member holds; loaded
//      supplies placed again; the bag in the arms dropped off whole.
//   4. The team's loads taken off a pile with the Ground window fill the taker's arms (hands full), as Pick up load.
//   5. A fight the team starts (an assault, a rescue, a raid): the loads go into the vehicle as far as it has room, the
//      rest is set down where each one starts; everyone starts with free hands; it comes back after unless beaten.
//   6. Fresh game set down stays fresh game: on the pile, picked up again (Pick up load, the Ground window, a win) and
//      left on the tile's ground after a retreat (still spoiling there).
// Usage: node tools/uxinttest.js [seed]   ("passed" / "failed" lines; exits 1 on a failure)
import { FOODS, unitsOf } from "../src/sim/foods.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { newItem, ensurePack, allCarried } from "../src/sim/inventory.js";
import { addMeat, meatIn } from "../src/sim/hunting.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { launchExpedition, partyTile, partyMembers } from "../src/sim/parties.js";
import * as C from "../src/sim/carry.js";
import * as G from "../src/sim/ground.js";
import * as RL from "../src/sim/raidloot.js";
import { createBattle, combatAct, registerCombatHandler, endBattleNow, finishCombat, closeCombat, canFire } from "../src/sim/combat.js";
import { teamHoldings, dropHeldOff, loadFromBase, dropOff } from "../src/sim/teaminv.js";
import { drawPileIso } from "../src/ui/ground.js";
import { teamInvModal } from "../src/ui/teaminv.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "passed" : "failed"} ${what}`); return ok; };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const section = (t) => console.log(t);
registerCombatHandler("uxint", () => {});

function world(s = seed) {
  const st = createWorld({ seed: s, factionCount: 4 });
  st.started = true; st.visitorsOff = true; st.noWanderers = true;
  st.hordes.length = 0;
  st.cards.length = 0;
  return st;
}
// A team of n, waiting on `tile` (default: a land tile 2 from the hub), no packs, empty pockets.
function teamOut(st, n = 2, supplies = { food: 4, water: 4 }, tile = null) {
  const h = hub(st);
  Object.assign(h.stock, { water: 300, ammo: 300, meds: 20 }); setFood(h, 300);
  const crew = atBase(st, h.id).slice(0, n);
  for (const s of crew) { s.gear.backpack = null; s.gear.carry = null; s.pockets = s.pockets.map(() => null); s.health = 100; }
  const dest = tile ?? st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: null, supplies });
  const p = res.party;
  if (!p) throw new Error(`no team: ${res.error || JSON.stringify(res)}`);
  p.path = [dest]; p.idx = 0; p.phase = "waiting"; p.dest = dest; p.orders = [];
  return { p, crew };
}
// A field battle for the team on an open map: the team on the left, the enemy far off, the player's turn.
function openBattle(st, p) {
  const setup = { tile: partyTile(p), partyId: p.id, enemy: { kind: "raiders", count: 2, power: 2 }, ambush: null, canRetreat: true, handler: "uxint", context: {} };
  const b = (st.combat = createBattle(st, setup));
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; delete c.bar; }
  b.losCache.fill(0);
  b.phase = "player"; b.fires = []; b.smoke = [];
  let i = 0;
  for (const u of b.units) {
    if (u.side === "player") { u.x = 2; u.y = 2 + 3 * i++; } else { u.x = 22; u.y = 3 + 3 * (i++ % 4); }
    u.f = 0; u.aware = true; u.ow = false; u.ap = 2;
  }
  return { b, setup };
}
// The team's rounds of a key: its supplies and cargo, and (physical rounds: gunload.js, mags.js) what its people carry in
// their guns, magazines and pockets, of that key.
const inStack = (st, k) => (Array.isArray(st) ? st.reduce((a, x) => a + (x.k === k ? x.n || 0 : 0), 0) : 0);
const carriedOf = (s, k) => allCarried(s).reduce((a, it) => a + (it.loaded ? (Array.isArray(it.loaded.stack) ? inStack(it.loaded.stack, k) : it.loaded.key === k ? it.loaded.n || 0 : 0) : 0) + inStack(it.stack, k) + (it.key === k ? Math.floor(Number(it.dur) || 0) : 0), 0);
const rounds = (p, k, st = null) => Math.max(0, (p.supplies && p.supplies[k]) || 0) + Math.max(0, (p.cargo && p.cargo.supplies && p.cargo.supplies[k]) || 0)
  + (st ? partyMembers(st, p).reduce((a, s) => a + carriedOf(s, k), 0) + (p.cargo ? p.cargo.gear.reduce((a, it) => a + (it.loaded && it.loaded.key === k ? it.loaded.n || 0 : 0), 0) : 0) : 0);
// In a fight: the units' guns (u.stack) hold the rounds of the guns in hand.
const fightRounds = (b, p, k, st) => rounds(p, k, st) + b.units.filter((u) => u.side === "player" && u.sid != null).reduce((a, u) => a + inStack(u.stack, k), 0);

// ---------- 1. a load and a bag on the battle map's ground ----------
section("1. A carrier sets down a load and a bag in a fight: ground piles, picked up again, the rounds in the bag's gun");
{
  const st = world();
  const { p, crew } = teamOut(st, 2);
  const [a, c] = crew;
  for (const s of crew) s.gear.weapon = newItem("pistol");
  p.supplies.a_9mm_fmj = 60;
  p.cargo.supplies.rawwater = 40; // more than packs and pockets take: carried in the arms
  const pack = newItem("hikingpack");
  const spare = newItem("pistol");
  ensurePack(pack)[0] = spare;
  a.gear.carry = pack; // a bag in the arms, with a gun in it
  C.settleHold(st, p);
  const water0 = C.holdTotals(p).rawwater, r0 = rounds(p, "a_9mm_fmj", st);
  const { b, setup } = openBattle(st, p);
  const ua = b.units.find((u) => u.sid === a.id), uc = b.units.find((u) => u.sid === c.id);
  const carrier = b.units.find((u) => u.side === "player" && u.hands);
  check(ua.bag === pack && ua.startGuns.includes(spare), "the bag starts the fight in the arms, the gun in it counted as carried (starts loaded)");
  check(!!carrier && !canFire(b, carrier), `a carrier starts with full hands (${carrier ? C.recText(carrier.hands) : "none"})`);
  // Set it all down.
  const held = { ...carrier.hands };
  const heldAll = (carrier.hands.rawwater || 0) + (carrier !== ua && ua.hands ? ua.hands.rawwater || 0 : 0); // both set down
  check(combatAct(st, { type: "dropCarried", unit: carrier.id }) === "" && !carrier.hands, "Drop carried (free): the load is set down");
  if (carrier !== ua) check(combatAct(st, { type: "dropCarried", unit: ua.id }) === "" && !ua.bag && !a.gear.carry, "Drop carried: the bag is set down whole");
  else check(!ua.bag && !a.gear.carry, "Drop carried: the bag is set down with the load");
  const pileW = G.groundAt(b, carrier.x, carrier.y, 0), pileB = G.groundAt(b, ua.x, ua.y, 0);
  check(!!pileW && near(pileW.contents.sup.rawwater || 0, held.rawwater || 0) && G.pileCount(pileW) > 0, `the load is a ground pile on its cell (${C.recText(held)})`);
  check(!!pileB && pileB.contents.gear.includes(pack) && pack.contents.includes(spare), "the bag is in a pile on its cell, the gun still in it");
  check(near(C.holdTotals(p).rawwater, water0 - heldAll), `the supplies left the pool when set down (${water0} → ${Math.round(C.holdTotals(p).rawwater)} un-purified water)`);
  const inGun = spare.loaded ? spare.loaded.n : 0;
  check(inGun > 0 && near(fightRounds(b, p, "a_9mm_fmj", st), r0 - inGun), `the gun in the bag left the team loaded (${inGun} rounds in it, out of the team's ${r0}: ${fightRounds(b, p, "a_9mm_fmj", st)} left)`);
  // Drawn on the map.
  let fills = 0;
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : typeof k === "string" && /^(fill|stroke|beginPath|ellipse|fillRect|strokeText|fillText)/.test(k) ? () => { if (/^fill/.test(k)) fills++; } : undefined), set: (o, k, v) => { o[k] = v; return true; } });
  for (const pl of G.groundPiles(b)) drawPileIso(ctx, pl, (x, y) => [x * 16, y * 8], () => 0, 1);
  check(fills > 0, `the piles are drawn on the map (${G.groundPiles(b).filter((x) => G.pileCount(x)).length} pile(s))`);
  // Pick up load: the supplies back in the arms, back in the pool.
  const ap = carrier.ap;
  check(C.carriedNear(b, carrier).length > 0, "Pick up load is offered next to the load");
  const err = combatAct(st, { type: "pickCarried", unit: carrier.id });
  check(!err && carrier.hands && near(carrier.hands.rawwater || 0, held.rawwater || 0) && carrier.ap === ap - 1, `Pick up load: 1 action, hands full again (${err || C.recText(carrier.hands)})`);
  check(near(C.holdTotals(p).rawwater, water0 - heldAll + (held.rawwater || 0)) && !(pileW.contents.sup.rawwater > 0), "the supplies are off the pile and back in the pool");
  if (carrier === ua) check(ua.bag === pack && a.gear.carry === pack && !pileB.contents.gear.includes(pack), "and the bag back in the arms (one bag at a time)");
  if (ua.bag) combatAct(st, { type: "dropCarried", unit: ua.id }); // the bag down again, for the next one
  // Carry in arms off the pile, by the other one.
  const other = carrier === uc ? ua : uc;
  other.x = pileB.x + 1; other.y = pileB.y; other.hands = null;
  const os = survivorById(st, other.sid);
  if (os.gear.carry) os.gear.carry = null;
  const r = G.pickUpFromGround(st, b, other, pileB, pack, true);
  check(os.gear.carry === pack && other.bag === pack && !pileB.contents.gear.includes(pack), `Carry in arms: the bag off the pile into ${other.name.split(" ")[0]}'s arms (${r.msg})`);
  check(!canFire(b, other) && /Hands full/.test(combatAct(st, { type: "shoot", unit: other.id, target: b.units.find((u) => u.side === "enemy").id })), "hands full with it: no shooting (the one rule, carry.js handsRefusal)");
  check(/already carries/.test(C.bagRefusal(st, b, other, newItem("backpack"))), "one bag in the arms at a time");
  combatAct(st, { type: "dropCarried", unit: other.id });
  // A pack on a searched body: Carry in arms from the search window (the In arms slot).
  const foe = b.units.find((u) => u.side === "enemy");
  foe.dead = true; foe.hp = 0; foe.down = false; foe.x = uc.x + 1; foe.y = uc.y;
  uc.hands = null; uc.bag = null; c.gear.carry = null; uc.ap = 2;
  check(combatAct(st, { type: "searchBody", unit: uc.id, target: foe.id }) === "", "the dead raider next to them is searched");
  const box = G.bodyBoxOf(b, foe);
  const loot = newItem("backpack");
  box.contents.gear.push(loot);
  const why = C.bagRefusal(st, b, uc, loot);
  const msg = why || RL.raidMove(st, uc.id, `rbox:${box.id}:gear:${box.contents.gear.indexOf(loot)}`, `s:${c.id}:carry`);
  check(!why && c.gear.carry === loot && uc.bag === loot && !box.contents.gear.includes(loot), `Carry in arms off the body: the pack in ${c.name.split(" ")[0]}'s arms (${msg})`);
  // Win: what was set down comes back; the gun's rounds go into the stores.
  combatAct(st, { type: "dropCarried", unit: uc.id }); // the looted pack too
  // The rest got away and the searched raider's own things are put aside: only the team's rounds are counted below.
  box.contents.gear.length = 0; box.contents.sup = {};
  for (const u of b.units) if (u.side === "enemy" && !u.dead) { u.left = true; u.fled = true; u.x = -1; }
  endBattleNow(st, "victory");
  finishCombat(st, setup, b.result);
  closeCombat(st);
  const back = partyMembers(st, p).some((s) => s.gear.carry === pack) || p.cargo.gear.includes(pack);
  check(back && !spare.loaded, `won: the bag is back (${a.gear.carry === pack ? "in its carrier's arms" : "in the cargo"}), the gun in it unloaded`);
  check(near(rounds(p, "a_9mm_fmj", st), r0), `no round made or lost (${r0} → ${rounds(p, "a_9mm_fmj", st)})`);
  check(near(C.holdTotals(p).rawwater, water0), `the water is all the team's still (${Math.round(C.holdTotals(p).rawwater)} of ${water0})`);
  check(partyMembers(st, p).some((s) => s.gear.carry === loot) || p.cargo.gear.includes(loot) || hub(st).armory.includes(loot), "the looted pack set down came back too");
}

// ---------- 2. retreated: it stays on the tile ----------
section("2. Retreated: the loads set down stay on the tile's ground");
{
  const st = world();
  const { p, crew } = teamOut(st, 2);
  p.cargo.supplies.rawwater = 40;
  const pack = newItem("hikingpack");
  crew[1].gear.carry = pack;
  C.settleHold(st, p);
  const water0 = C.holdTotals(p).rawwater;
  const { b, setup } = openBattle(st, p);
  const set = b.units.filter((u) => u.side === "player" && u.hands).reduce((a, u) => a + (u.hands.rawwater || 0), 0);
  check(combatAct(st, { type: "dropAllCarried" }) === "" && set > 0, `everyone sets down (${set} un-purified water and the bag)`);
  endBattleNow(st, "retreat");
  finishCombat(st, setup, b.result);
  closeCombat(st);
  const site = C.groundAt(st, partyTile(p));
  const onGround = site ? site.items.filter((it) => it.kind === "supply" && it.key === "rawwater").reduce((a, it) => a + it.qty, 0) : 0;
  check(!!site && near(onGround, set, 1) && site.items.some((it) => it.item === pack), `on the tile's ground: ${site ? C.groundText(site) : "nothing"}`);
  check(near(C.holdTotals(p).rawwater, water0 - set, 1) && !crew[1].gear.carry, "out of the pool and the arms");
  const i = site.items.findIndex((it) => it.item === pack);
  const m = C.pickUpGround(st, p, i, Infinity, crew[0].id);
  check(crew[0].gear.carry === pack, `the team panel's Pick up…: the bag into ${crew[0].name.split(" ")[0]}'s arms (${m})`);
}

// ---------- 3. the team inventory and the holdings ----------
section("3. The team inventory: who holds what; Drop off what one member holds; loads placed again");
{
  const st = world();
  const h = hub(st);
  const { p, crew } = teamOut(st, 2, { food: 4, water: 4 }, h.tile);
  p.cargo.supplies.rawwater = 30;
  const pack = newItem("hikingpack");
  crew[0].gear.carry = pack;
  const H = teamHoldings(st, p);
  const holders = H.members.filter((m) => m.hold && Object.keys(m.hold.hands).length);
  check(H.members.every((m) => m.hold) && holders.length > 0, `each member's holdings are in the team inventory (${H.members.map((m) => `${m.s.name.split(" ")[0]}: ${C.recText({ ...m.hold.pocket, ...m.hold.pack, ...m.hold.hands }) || "nothing"}`).join("; ")})`);
  check(H.members[0].spots.some((x) => x.item === pack && x.loc === `s:${crew[0].id}:carry`), "the bag in the arms is in the In arms slot");
  const ui = { inv: { team: p.id, sid: crew[0].id, tab: "drop" }, tiPick: null, invMsg: "" };
  const html = teamInvModal(st, ui) || "";
  check(/Drop off what/.test(html) && /Holds /.test(html), "the Drop off tab lists what each member holds, with Drop off for them");
  ui.inv.tab = "team";
  check(/Supplies .* carries/.test(teamInvModal(st, ui) || ""), "the Inventory tab shows the supplies under each paper doll");
  const m0 = holders[0];
  const q = m0.hold.hands.rawwater || 0;
  const stock0 = h.stock.rawwater || 0, pool0 = C.holdTotals(p).rawwater;
  const r = dropHeldOff(st, p, m0.s.id);
  const hv = C.holdView(st, p);
  const me = hv.people.find((x) => x.s === m0.s);
  check(q > 0 && near((h.stock.rawwater || 0) - stock0, q) && near(C.holdTotals(p).rawwater, pool0 - q) && !(me.hands.rawwater > 0), `Drop off what ${m0.s.name.split(" ")[0]} holds: ${r.text}`);
  const r2 = loadFromBase(st, p, { supplies: { food: 10 } });
  const hh = C.settleHold(st, p);
  check(r2.moved.length && near(C.placedOf(hh, "food"), C.holdTotals(p).food), `loaded supplies are placed (${r2.text}; ${Math.round(C.placedOf(hh, "food"))} food held of ${Math.round(C.holdTotals(p).food)})`);
  const r3 = dropOff(st, p, { items: [`s:${crew[0].id}:carry`] });
  check(!crew[0].gear.carry && h.armory.includes(pack), `the bag in the arms is dropped off whole (${r3.text})`);
}

// ---------- 4. the Ground window: the team's loads into the arms ----------
section("4. The team's loads taken off a pile with the Ground window fill the arms");
{
  const st = world();
  const { p } = teamOut(st, 2);
  p.cargo.supplies.rawwater = 40;
  const { b } = openBattle(st, p);
  const carrier = b.units.find((u) => u.side === "player" && u.hands);
  const other = b.units.find((u) => u.side === "player" && u !== carrier);
  const w0 = C.holdTotals(p).rawwater;
  const held = carrier.hands.rawwater || 0;
  combatAct(st, { type: "dropCarried", unit: carrier.id });
  if (other.hands || other.bag) combatAct(st, { type: "dropCarried", unit: other.id });
  const w1 = C.holdTotals(p).rawwater;
  other.x = carrier.x + 1; other.y = carrier.y; other.ap = 2;
  G.fieldReady(b, st);
  const pile = G.groundAt(b, carrier.x, carrier.y, 0);
  const before = pile.contents.sup.rawwater || 0;
  const msg = RL.raidMove(st, other.id, `rbox:${pile.id}:sup:rawwater`, `haul:${other.id}:list`);
  const took = before - (pile.contents.sup.rawwater || 0);
  check(held > 0 && took > 0 && near((other.hands && other.hands.rawwater) || 0, took) && !(other.haul.sup.rawwater > 0), `taken through the window, it is in ${other.name.split(" ")[0]}'s arms, not loose (${msg})`);
  check(!canFire(b, other), "hands full: no shooting until it is set down");
  check(near(C.holdTotals(p).rawwater, w1 + took) && w1 < w0, "and back in the team's pool");
  closeCombat(st);
}

// ---------- 5. a fight the team starts: set down first, the vehicle first ----------
section("5. A fight the team starts: the loads into the vehicle as far as there is room, the rest set down at the start");
registerCombatHandler("uxstaged", () => {});
C.STAGED_HANDLERS.add("uxstaged");
const stagedSetup = (p, extra = {}) => ({ tile: partyTile(p), partyId: p.id, enemy: { kind: "raiders", count: 2, power: 2 }, ambush: null, canRetreat: true, handler: "uxstaged", context: {}, ...extra });
const armsOf = (h) => Object.values(h.by).reduce((a, r) => a + (r.hands.rawwater || 0), 0);
{
  // On foot: everything in the arms is set down where each one starts.
  const st = world();
  const { p, crew } = teamOut(st, 2);
  p.cargo.supplies.rawwater = 40;
  const pack = newItem("hikingpack");
  crew[0].gear.carry = pack;
  const inArms = armsOf(C.settleHold(st, p));
  const w0 = C.holdTotals(p).rawwater;
  const setup = stagedSetup(p);
  const b = (st.combat = createBattle(st, setup));
  check(b.units.filter((u) => u.side === "player").every((u) => !u.hands && !u.bag) && !crew[0].gear.carry, "everyone starts with free hands");
  const piles = G.groundPiles(b).filter((c) => G.pileCount(c));
  const onGround = piles.reduce((a, c) => a + (c.contents.sup.rawwater || 0), 0);
  check(inArms > 0 && near(onGround, inArms) && piles.some((c) => c.contents.gear.includes(pack)) && b.armsDrops.every((d) => d.staged), `on foot: set down where they start (${Math.round(onGround)} un-purified water and the bag)`);
  check(near(C.holdTotals(p).rawwater, w0 - inArms), "out of the pool while it lies there");
  endBattleNow(st, "retreat");
  finishCombat(st, setup, b.result);
  closeCombat(st);
  check(near(C.holdTotals(p).rawwater, w0) && crew[0].gear.carry === pack, "retreated (not beaten): picked up again, the bag back in the arms");
}
{
  // With a car: the bag rides in it (the supplies were in it already: a car takes them all).
  const st = world();
  const { p, crew } = teamOut(st, 2);
  const car = createVehicle(st, "sedan", { kind: "party", partyId: p.id }, { fuel: 20 });
  p.vehicleId = car.id;
  p.cargo.supplies.rawwater = 40;
  const pack = newItem("hikingpack");
  crew[0].gear.carry = pack;
  const b = (st.combat = createBattle(st, stagedSetup(p)));
  check(p.cargo.gear.includes(pack) && !crew[0].gear.carry && !G.groundPiles(b).some((c) => c.contents.gear.includes(pack)), `with room in the ${car.name || "car"}: the bag goes in it, not on the ground`);
  check(b.units.filter((u) => u.side === "player").every((u) => !u.hands && !u.bag) && !G.groundPiles(b).some((c) => c.contents.sup.rawwater > 0), "nothing set down, everyone starts with free hands");
  closeCombat(st);
}
{
  // Beaten: what was set down at the start stays on the tile.
  const st = world();
  const { p } = teamOut(st, 2);
  p.cargo.supplies.rawwater = 40;
  C.settleHold(st, p);
  const w0 = C.holdTotals(p).rawwater;
  const setup = stagedSetup(p);
  const b = (st.combat = createBattle(st, setup));
  const down = G.groundPiles(b).reduce((a, c) => a + (c.contents.sup.rawwater || 0), 0);
  b.over = true; b.result = { outcome: "defeat", loot: { supplies: {}, gear: [] }, survivorsHurt: [], survivorsDead: [] };
  finishCombat(st, setup, b.result);
  const site = C.groundAt(st, partyTile(p));
  const left = site ? site.items.filter((it) => it.key === "rawwater").reduce((a, it) => a + it.qty, 0) : 0;
  check(down > 0 && near(left, down) && near(C.holdTotals(p).rawwater, w0 - down), `beaten: what was set down stays on the tile's ground (${Math.round(left)})`);
}
{
  // A raid: the same before going in.
  let done = false;
  for (let i = 0; i < 40 && !done; i++) {
    const st = world(seed * 100 + i);
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["pharmacy", "store", "gunstore", "police", "warehouse", "house", "gas"].includes(t.loc.type));
    if (!tile) continue;
    const { p, crew } = teamOut(st, 2, { food: 4, water: 4 }, tile.id);
    p.cargo.supplies.rawwater = 40;
    const pack = newItem("hikingpack");
    crew[1].gear.carry = pack;
    const inArms = armsOf(C.settleHold(st, p));
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "uxstaged", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 0 }, context: {} };
    const b = (st.combat = createBattle(st, setup));
    if (!b || !b.raid) { closeCombat(st); continue; }
    done = true;
    const piles = b.raid.containers.filter((c) => c.kind === "ground" && G.pileCount(c));
    check(inArms > 0 && near(piles.reduce((a, c) => a + (c.contents.sup.rawwater || 0), 0), inArms) && piles.some((c) => c.contents.gear.includes(pack)) && b.units.every((u) => !u.bag && !u.hands), "a raid: the loads and the bag are set down where the team comes in, hands free");
    closeCombat(st);
  }
  check(done, "(a raid map was found)");
}

// Days of raw game lying on a pile (food by type: the items, sim/foods.js).
const rawOn = (pile) => Object.entries((pile && pile.contents && pile.contents.sup) || {}).reduce((a, [k, q]) => a + (FOODS[k] && FOODS[k].raw ? unitsOf(k, q) : 0), 0);
// ---------- 6. fresh game stays fresh ----------
section("6. Fresh game set down in a fight stays fresh game");
{
  const st = world();
  const { p } = teamOut(st, 2);
  p.cargo.supplies.rawwater = 30;
  addMeat(st, p, 8);
  const h = C.settleHold(st, p);
  const meat0 = meatIn(p.cargo), food0 = (food(p.cargo) || 0) + (food(p) || 0); // found and packed: set down and picked up, the food comes back to the cargo
  const hold = Object.values(h.by).find((r) => (r.hands.meat || 0) > 0);
  check(!!hold, `fresh game is carried in the arms (${hold ? C.recText(hold.hands) : "none"})`);
  const { b, setup } = openBattle(st, p);
  const carrier = b.units.find((u) => u.side === "player" && u.hands && u.hands.meat > 0);
  const m = carrier.hands.meat;
  combatAct(st, { type: "dropCarried", unit: carrier.id });
  const pile = G.groundAt(b, carrier.x, carrier.y, 0);
  check(near(rawOn(pile), m) && near(meatIn(p.cargo), meat0 - m), `on the pile it is fresh game (${rawOn(pile)} days of food: ${Object.keys(pile.contents.sup).join(", ")}), out of the cargo's fresh game`);
  combatAct(st, { type: "pickCarried", unit: carrier.id });
  check(near(carrier.hands.meat || 0, m) && near(meatIn(p.cargo), meat0) && near(food(p.cargo) + (food(p) || 0), food0), "Pick up load: fresh game again, in the arms and the cargo");
  // The Ground window.
  combatAct(st, { type: "dropCarried", unit: carrier.id });
  const other = b.units.find((u) => u.side === "player" && u !== carrier);
  if (other.hands || other.bag) combatAct(st, { type: "dropCarried", unit: other.id });
  other.x = carrier.x + 1; other.y = carrier.y; other.ap = 2;
  G.fieldReady(b, st);
  const pf = rawOn(pile), gk = Object.keys(pile.contents.sup).find((k) => FOODS[k] && FOODS[k].raw);
  RL.raidMove(st, other.id, `rbox:${pile.id}:sup:${gk}`, `haul:${other.id}:list`);
  const tookF = pf - rawOn(pile);
  check(tookF >= m * 0.9 && near((other.hands && other.hands.meat) || 0, tookF, 1e-6) && near(meatIn(p.cargo), meat0 - rawOn(pile), 1e-6), `the Ground window: fresh game into the arms, fresh in the cargo (${C.recText(other.hands || {})})`);
  // A win: set down again, picked up after as fresh game.
  combatAct(st, { type: "dropCarried", unit: other.id });
  for (const u of b.units) if (u.side === "enemy") { u.left = true; u.fled = true; u.x = -1; }
  endBattleNow(st, "victory");
  finishCombat(st, setup, b.result);
  closeCombat(st);
  check(near(meatIn(p.cargo), meat0), `won: back as fresh game (${meatIn(p.cargo)} of ${meat0})`);
}
{
  // A retreat: on the tile's ground as fresh game, spoiling at the field rate.
  const st = world();
  const { p } = teamOut(st, 2);
  p.cargo.supplies.rawwater = 30;
  addMeat(st, p, 8);
  C.settleHold(st, p);
  const meat0 = meatIn(p.cargo);
  const { b, setup } = openBattle(st, p);
  const m = b.units.filter((u) => u.side === "player" && u.hands).reduce((a, u) => a + (u.hands.meat || 0), 0);
  combatAct(st, { type: "dropAllCarried" });
  endBattleNow(st, "retreat");
  finishCombat(st, setup, b.result);
  closeCombat(st);
  const site = C.groundAt(st, partyTile(p));
  const it = site && site.items.find((x) => x.kind === "supply" && FOODS[x.key] && FOODS[x.key].raw);
  check(m > 0 && !!it && Math.abs(unitsOf(it.key, it.qty) - m) <= unitsOf(it.key, 1) && near(meatIn(p.cargo), meat0 - m), `retreated: fresh game on the tile's ground (${site ? C.groundText(site) : "nothing"})`);
  if (it) {
    const l0 = it.left ?? FOODS[it.key].shelf;
    C.groundDaily(st);
    check(it.left < l0, `it spoils there at the field rate (shelf left ${Math.round(l0 * 10) / 10} → ${Math.round(it.left * 10) / 10} days; gone at 0)`);
    C.pickUpGround(st, p, site.items.indexOf(it));
    check(meatIn(p.cargo) > meat0 - m + 0.5, `picked up from the team panel: fresh game in the cargo again (${meatIn(p.cargo)})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
