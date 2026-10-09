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
// Usage: node tools/uxinttest.js [seed]   ("passed" / "failed" lines; exits 1 on a failure)
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { newItem, ensurePack } from "../src/sim/inventory.js";
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
  Object.assign(h.stock, { food: 300, water: 300, ammo: 300, meds: 20 });
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
const rounds = (p, k) => Math.max(0, (p.supplies && p.supplies[k]) || 0) + Math.max(0, (p.cargo && p.cargo.supplies && p.cargo.supplies[k]) || 0);

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
  const water0 = C.holdTotals(p).rawwater, r0 = rounds(p, "a_9mm_fmj");
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
  check(inGun > 0 && near(rounds(p, "a_9mm_fmj"), r0 - inGun), `the gun in the bag left the team loaded (${inGun} rounds in it, out of the team's ${r0})`);
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
  check(near(rounds(p, "a_9mm_fmj"), r0), `no round made or lost (${r0} → ${rounds(p, "a_9mm_fmj")})`);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
