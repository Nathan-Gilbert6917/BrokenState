// Carts (src/sim/carts.js): a wheelbarrow and a hand cart in the In arms slot. Their capacity and the share of the
// weight their pusher feels; a lone survivor walking off with a big haul; the slower pace off the roads; set down on the
// State Map (a death site, its marker), picked up again, fetched by the Recover mission, stripped by scavengers; in a
// fight: held (hands full, a tile less a move), Let go (a 1x1 cart on the map), loaded from the piles and bodies round
// it, Take cart; evac / retreat leaves a cart on the map behind and takes a held one; a win gives it back; a save round
// trip; the AI groups' coarse carts.
// Usage: node tools/cartstest.js [seed]   ("passed" / "failed" lines; exits 1 on a failure)
import { createWorld, hub, atBase, tickHour, survivorById } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem, moveItem, itemLoad, fitReason, ensureInv } from "../src/sim/inventory.js";
import { wornLoad, teamLoad } from "../src/sim/load.js";
import { launchExpedition, partyTile, cargoRoom, partyMembers, partyLoad, weighTeam } from "../src/sim/parties.js";
import * as C from "../src/sim/carry.js";
import * as K from "../src/sim/carts.js";
import { createBattle, combatAct, closeCombat, registerCombatHandler, canFire, fireRefusal, endBattleNow, finishCombat, runEnemyPhase, vaultable, siegeTarget, pathTo, moveAlong, CELL, reachable, shotOdds, endPlayerTurn, bash, driveTo } from "../src/sim/combat.js";
import { searchHeatMult } from "../src/sim/fieldheat.js";
import { crawlable, shoveable, shoveDests, overCost, CRAWL } from "../src/sim/barricade.js";
import { repairKind, repairItem } from "../src/sim/repair.js";
import { itemDur } from "../src/sim/crafting.js";
import { buildRate } from "../src/sim/buildings.js";
import { travelHours, estimateTrip, moveEstimate } from "../src/sim/parties.js";
import { dropToGround, groundPiles, pilesNear, groundAct } from "../src/sim/ground.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { raidMove } from "../src/sim/raidloot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { deathLabel } from "../src/sim/markers.js";
import { deathSitesDaily } from "../src/sim/economy.js";
import { sendParty, scavArrived } from "../src/sim/aiscav.js";
import { battleKg } from "../src/sim/carrykit.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { ITEM_TAGS, CART_FINDS, rollCartFind } from "../src/sim/loot.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "passed" : "failed"} ${what}`); return ok; };
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;
const r1 = (x) => Math.round(x * 10) / 10;

function world(s = seed) {
  const st = createWorld({ seed: s, factionCount: 4 });
  st.started = true; st.visitorsOff = true; st.noWanderers = true;
  st.hordes.length = 0;
  st.deathSites = st.deathSites.filter((d) => !d.abandoned); // carts.js seedRoadCarts: the abandoned carts tested by themselves (section 8)
  return st;
}
// A team of n out on a land tile 2 from the hub, waiting there, with the supplies given (no packs, empty pockets).
function teamOut(st, n = 1, supplies = { food: 2, water: 2 }, mission = "move", destTile = null) {
  const h = hub(st);
  Object.assign(h.stock, { water: 300, ammo: 300, meds: 20 });
  const crew = atBase(st, h.id).slice(0, n);
  for (const s of crew) { ensureInv(s); s.gear.backpack = null; s.gear.carry = null; s.pockets = s.pockets.map(() => null); s.health = 100; }
  const dest = destTile ?? st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission, stance: "normal", vehicleId: null, supplies });
  const p = res.party;
  if (!p) throw new Error(`no team: ${res.error || JSON.stringify(res)}`);
  if (mission === "move") { p.path = [dest]; p.idx = 0; p.phase = "waiting"; p.dest = dest; }
  return { p, crew };
}
const supKg = (p, k) => (p.supplies[k] || 0) + ((p.cargo && p.cargo.supplies[k]) || 0);

// ---------- 1. the items ----------
console.log("The items: In arms only, their own grid, what the pusher feels");
{
  const wb = newItem("wheelbarrow"), hc = newItem("handcart");
  check(K.isCart(wb) && K.isCart(hc) && GEAR.wheelbarrow.slots === 10 && GEAR.handcart.slots === 16, "a wheelbarrow (10 slots) and a hand cart (16 slots) are carts");
  check(!fitReason(hc, "carry") && /pushed in the arms/.test(fitReason(hc, "pack")) && /pushed in the arms/.test(fitReason(hc, "pocket")) && !!fitReason(hc, "backpack") && /pushed in the arms/.test(fitReason(hc, "bag")), "only the In arms slot takes one (not the pack, a pocket, the back, a bag)");
  check(near(itemLoad(hc), 22) && near(K.cartFree(hc), 180) && near(K.cartFree(wb), 90), `empty: the hand cart weighs 22 kg and takes 180, the wheelbarrow takes 90 (${itemLoad(hc)}, ${K.cartFree(hc)}, ${K.cartFree(wb)})`);
  const st = world();
  const s = atBase(st, hub(st).id)[0];
  ensureInv(s); s.gear.carry = null; s.gear.backpack = null;
  const w0 = wornLoad(s);
  s.gear.carry = hc;
  const case1 = newItem("riflecase");
  check(!fitReason(case1, "bag", s) && /too big for a pack/.test(fitReason(case1, "bag", null)), "a cart's grid takes bulky things (a rifle case), a bag's does not");
  hc.contents[0] = case1;
  hc.contents[1] = newItem("sledge");
  const all = itemLoad(hc);
  check(near(wornLoad(s) - w0, all * 0.2) && near(K.feltKg(hc), all * 0.2), `the puller feels a fifth of it: ${r1(all)} kg in all, ${r1(wornLoad(s) - w0)} kg on them`);
  const bk = battleKg(s); s.gear.carry = null; const bk0 = battleKg(s); s.gear.carry = hc;
  check(near(bk - bk0, all * 0.2), `in a fight too (battle kg ${r1(bk0)} → ${r1(bk)})`);
  const heavy = newItem("riflecase");
  hc.held = [{ k: "scrap", q: 85 }]; // 170 kg of scrap in it
  check(/is full/.test(fitReason(heavy, "bag", s)), `full: no more than its kg (${fitReason(heavy, "bag", s)})`);
  delete hc.held;
  check(CRAFTS.wheelbarrow && CRAFTS.wheelbarrow.needs === "workshop" && CRAFTS.handcart && ITEM_TAGS.wheelbarrow && ITEM_TAGS.handcart && CART_FINDS.hardware && CART_FINDS.farm, "crafted at a workshop, found at hardware stores and farms");
  // Found at a hardware store or a farm (its own dice).
  const site = st.tiles.find((t) => t.loc && CART_FINDS[t.loc.type]);
  let got = null;
  for (let h = 0; h < 2000 && !got && site; h++) { st.hour = h; got = rollCartFind(st, site.id, 3, "t"); }
  check(!!got && K.isCart(got), `a search turns one up now and then (${site ? site.loc.type : "no site"}: ${got ? got.name : "none"})`);
}

// ---------- 2. a lone survivor walks off with a big haul ----------
console.log("A lone survivor with a cart: the team's supplies go in it, felt at its share");
{
  const st = world();
  const { p, crew } = teamOut(st, 1, { food: 2, water: 2 });
  const [s] = crew;
  const capBare = partyLoad(st, p).capacity;
  s.gear.carry = newItem("handcart");
  const capCart = partyLoad(st, p).capacity;
  check(capCart > capBare + 100, `room (the puller's own max load bounds it: a fifth of 150 kg is 30): ${Math.round(capBare)} kg on foot, ${Math.round(capCart)} kg with a hand cart`);
  p.cargo.supplies.rawwater = 100;
  p.cargo.supplies.wood = 300; // 30 kg
  const h = C.settleHold(st, p);
  const inCart = C.kgOf(h.by[s.id].cart);
  check(inCart >= 129 && !Object.keys(h.by[s.id].hands).length, `the haul goes in the cart, not the arms (${C.recText(h.by[s.id].cart)}: ${r1(inCart)} kg)`);
  const t = partyLoad(st, p);
  const me = t.foot.people[0];
  check(me.band < 3 && me.load < 40, `${r1(me.load)} kg felt with ${r1(inCart + itemLoad(s.gear.carry))} kg pulled: ${me.bandName}, pace ${Math.round(me.speed * 100)}%`);
  // The same haul without the cart: overloaded.
  const cart = s.gear.carry;
  s.gear.carry = null;
  const bare = teamLoad([s], 130 + 4);
  check(bare.foot.people[0].band === 3, `without it the same haul is Overloaded (${r1(bare.foot.people[0].load)} kg)`);
  s.gear.carry = cart;
  C.settleHold(st, p);
  // Supplies moved by hand: out of the cart into the pack, back in.
  s.gear.backpack = newItem("backpack");
  const m1 = C.moveHeld(st, p, "rawwater", 4, { sid: s.id, place: "cart" }, { sid: s.id, place: "pack" });
  const m2 = C.moveHeld(st, p, "rawwater", 4, { sid: s.id, place: "pack" }, { sid: s.id, place: "cart" });
  check(/→/.test(m1) && /hand cart/.test(m2), `supplies move into and out of the cart (${m1} / ${m2})`);
  check(C.roomAt(st, p, { sid: s.id, place: "hands" }, "rawwater") === 0, "its puller's hands are on the handles: nothing more in the arms");
  // Off the roads: the hand cart drags.
  weighTeam(st, p);
  const ct = p.burden.cartTer;
  check(ct && ct.road === 1 && ct.plains === 0.85 && ct.forest === 0.6 && ct.hills === 0.6, `the hand cart's pace by ground: road ×1, farmland ×${ct && ct.plains}, forest ×${ct && ct.forest}, hills ×${ct && ct.hills}`);
  const v = C.holdView(st, p).people[0];
  check(v.cartItem === cart && v.cartKg > 100, `the panel's view: the cart and what is in it (${r1(v.cartKg)} kg, ${r1(v.cartRoom)} kg free)`);
}

// ---------- 3. the ground: set down, found, picked up, fetched, stripped ----------
console.log("Set down on the State Map: one item on the ground with everything in it");
{
  const st = world();
  const { p, crew } = teamOut(st, 1, { food: 2, water: 2 });
  const [s] = crew;
  const cart = (s.gear.carry = newItem("handcart"));
  cart.contents[0] = newItem("machete");
  p.cargo.supplies.rawwater = 60;
  C.settleHold(st, p);
  const water0 = supKg(p, "rawwater");
  const tile = partyTile(p);
  const msg = C.dropHands(st, p, s.id);
  const site = C.groundAt(st, tile);
  const it = site && site.items.find((x) => x.item === cart);
  const lot = (cart.held || []).find((l) => l.k === "rawwater");
  check(it && !s.gear.carry && lot && near(lot.q, 60) && near(supKg(p, "rawwater"), water0 - 60), `set down with its 60 water and machete: out of the pool, in its lots (${msg})`);
  const mk = st.markers.find((m) => m.key === `death:${tile}`);
  check(mk && /Hand cart \(\d+(\.\d)? kg\)/.test(mk.label) && /Hand cart/.test(deathLabel(site)), `the marker names it with its weight (${mk && mk.label})`);
  check(near(it.cartKg, itemLoad(cart), 0.2) && it.cartKg > 22 + 60 && it.value > GEAR.handcart.value, `on the ground it weighs ${it.cartKg} kg and is worth ${it.value}`);
  // Taken back by the team: into the arms, the lots back in the pool and in the cart.
  const i = site.items.indexOf(it);
  const r = C.pickUpGround(st, p, i);
  const h = C.settleHold(st, p);
  check(s.gear.carry === cart && !cart.held && near(supKg(p, "rawwater"), water0) && near(h.by[s.id].cart.rawwater || 0, 60), `picked up again: pushed, the water back with the team, in the cart (${r})`);
  // Set down once more; a team sent to Recover it brings it home pushing it.
  C.dropHands(st, p, s.id);
  const st2 = st;
  const far = st2.tiles.find((t) => t.terrain !== "water" && st2.grid.distance(t.id, hub(st2).tile) === 2 && t.id !== tile && st2.tiles[t.id].roadLinks);
  const cart2 = newItem("wheelbarrow");
  cart2.held = [{ k: "scrap", q: 10 }];
  C.cartOnTile(st2, far.id, cart2);
  const { p: q, crew: qc } = teamOut(st2, 2, { food: 3, water: 3 }, "recover", far.id);
  for (let k = 0; k < 120 && !(q.phase === "waiting" || q.phase === "awaiting" || q.awaiting) && st2.parties.includes(q); k++) tickHour(st2);
  const pusher = qc.find((x) => x.gear && x.gear.carry === cart2);
  check(!!pusher, `the Recover mission fetches it into someone's arms (${pusher ? pusher.name : "nobody"}; team ${q.phase})`);
  // Scavengers: what is in it first, the best thing at a time, then the cart itself (a group keeps it).
  const st3 = world();
  const t3 = st3.tiles.find((t) => t.terrain !== "water" && t.road && !t.loc);
  const c3 = newItem("handcart");
  c3.contents[0] = newItem("machete"); c3.contents[1] = newItem("knife");
  c3.held = [{ k: "scrap", q: 5 }];
  const s3 = C.cartOnTile(st3, t3.id, c3);
  s3.day = -60; // old: the scavengers come
  const seen = [];
  for (let d = 0; d < 40 && st3.deathSites.includes(s3); d++) { deathSitesDaily(st3); seen.push((c3.contents.filter(Boolean).length) + (c3.held ? c3.held.length : 0)); }
  const carts = st3.factions.reduce((a, f) => a + (f.carts || 0), 0);
  check(!st3.deathSites.includes(s3) && seen.some((n) => n === 2) && seen.some((n) => n === 1) && carts === 1, `stripped a thing at a time (${seen.slice(0, 6).join(" → ")}), then the cart taken: a group has it (${carts})`);
}

// ---------- 4. fights ----------
console.log("In a fight: a 1x1 cart, Let go (free), loaded from what lies round it, Take cart (1 action)");
registerCombatHandler("cartstest", () => {});
const fightSetup = (p) => ({ tile: partyTile(p), partyId: p.id, enemy: { kind: "zombies", count: 1, power: 1 }, ambush: null, canRetreat: true, handler: "cartstest", context: {} });
{
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 2, water: 2 });
  const [a, b2] = crew;
  a.gear.weapon = newItem("shotgun"); b2.gear.weapon = newItem("pistol");
  p.supplies.a_9mm_fmj = 60; p.supplies.a_12ga_buck = 30;
  const cart = (a.gear.carry = newItem("wheelbarrow"));
  cart.contents[0] = newItem("crowbar");
  p.cargo.supplies.wood = 200; // 20 kg: in the wheelbarrow
  C.settleHold(st, p);
  const wood0 = supKg(p, "wood");
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const u = bt.units.find((x) => x.sid === a.id), v = bt.units.find((x) => x.sid === b2.id);
  check(u.bag === cart && !canFire(bt, u) && /wheelbarrow/.test(fireRefusal(bt, u)), `starts pushing it: no shooting a long gun (${fireRefusal(bt, u)})`);
  const mobHeld = u.mob, ap = u.ap;
  check(!combatAct(st, { type: "letGoCart", unit: u.id }) && !u.bag && u.ap === ap && !a.gear.carry, "Let go: free, hands free");
  const box = K.cartBoxes(bt)[0];
  const cellK = box ? bt.cells[box.y * bt.w + box.x].k : "";
  check(box && Math.max(Math.abs(box.x - u.x), Math.abs(box.y - u.y)) === 1 && cellK === "cart" && box.cart === cart && box.contents.gear.some((g) => g.key === "crowbar") && near(box.contents.sup.wood || 0, 200) && near(supKg(p, "wood"), wood0 - 200), `the cart stands on the cell next to its pusher (a barricade: cell ${cellK}) with the crowbar and the firewood in it (out of the pool: ${r1(supKg(p, "wood"))} of ${r1(wood0)} wood left)`);
  check(canFire(bt, u) && u.mob === mobHeld + 1, `the gun works again; a tile more a move without it (${mobHeld} → ${u.mob})`);
  check(!groundPiles(bt).some((c) => !c.cart && c.x === box.x && c.y === box.y), "it is not a pile: things put down there make their own pile");
  // Load it from a pile next to it (the search window's move into the cart).
  v.x = u.x; v.y = u.y; // the other one stands by it
  const pile = dropToGround(bt, v, "scrap", 6);
  const msg = raidMove(st, v.id, `rbox:${pile.id}:sup:scrap`, `rbox:${box.id}:list`, 6);
  check((box.contents.sup.scrap || 0) === 6, `6 scrap off the pile into the wheelbarrow (${msg})`);
  const big = dropToGround(bt, v, newItem("sledge"));
  const sl = big.contents.gear.find((g) => g.key === "sledge");
  box.contents.sup.scrap = 40; // 80 kg: nearly full
  const full = raidMove(st, v.id, `rbox:${big.id}:gear:${big.contents.gear.indexOf(sl)}`, `rbox:${box.id}:list`);
  check(/is full/.test(full) && big.contents.gear.includes(sl), `no more than its kg (${full})`);
  box.contents.sup.scrap = 6;
  // Take cart: 1 action, next to it, everything back in it.
  const apV = v.ap;
  const tk = combatAct(st, { type: "takeCart", unit: v.id });
  check(!tk && v.bag === cart && b2.gear.carry === cart && v.ap === apV - 1 && !K.cartBoxes(bt).length && cart.contents.some((g) => g && g.key === "crowbar"), `Take cart: 1 action, the other one pushes it now with all in it (${tk || "ok"})`);
  const h = C.settleHold(st, p);
  check(near(supKg(p, "wood"), wood0) && near(h.by[b2.id].cart.wood || 0, 200) && (h.by[b2.id].cart.scrap || 0) >= 6 - 1e-6, `the firewood and the scrap back with the team, in the cart (${C.recText(h.by[b2.id].cart)})`);
  check(/No cart/.test(combatAct(st, { type: "takeCart", unit: u.id })), "nothing to take when no cart stands within reach");
  // Moving with it: the cart rolls with its pusher (it is in their arms).
  check(v.mob <= 4 && K.holdsCart(v), `pushing it: ${v.mob} tiles a move`);
  // Won: it comes back. Let go first, then the fight ends in a win.
  combatAct(st, { type: "letGoCart", unit: v.id });
  endBattleNow(st, "victory");
  closeCombat(st);
  check((b2.gear.carry === cart || a.gear.carry === cart) && near(supKg(p, "wood"), wood0), `won: the cart is pushed again, with its load (${b2.gear.carry === cart ? b2.name : a.name})`);
}
{
  // The evac rule: only a cart held leaves; one on the map stays on the tile's ground, all in it.
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 2, water: 2 });
  const [a, b2] = crew;
  const c1 = (a.gear.carry = newItem("handcart"));
  const c2 = (b2.gear.carry = newItem("wheelbarrow"));
  c1.contents[0] = newItem("machete");
  p.cargo.supplies.rawwater = 50;
  C.settleHold(st, p);
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const ua = bt.units.find((x) => x.sid === a.id), ub = bt.units.find((x) => x.sid === b2.id);
  combatAct(st, { type: "letGoCart", unit: ua.id });
  ua.left = true; ub.left = true; // both get out (the evac strip); only one pushes a cart
  endBattleNow(st, "retreat");
  closeCombat(st);
  const site = C.groundAt(st, partyTile(p));
  const left = site && site.items.find((x) => x.item === c1);
  check(left && !a.gear.carry && c1.contents.some((g) => g && g.key === "machete"), `the hand cart let go stays on the ground of the tile with what was in it (${site ? C.groundText(site) : "none"})`);
  check(b2.gear.carry === c2, "the wheelbarrow pushed off the map leaves with its pusher");
  const i = site.items.indexOf(left);
  C.pickUpGround(st, p, i);
  check(a.gear.carry === c1 || b2.gear.carry === c1 || p.cargo.gear.includes(c1), "and is found and taken back from the State Map");
  // By the numbers: a retreat keeps the carts held, a defeat sets them down.
  const st2 = world();
  const { p: q, crew: qc } = teamOut(st2, 1, { food: 2, water: 2 });
  const c3 = (qc[0].gear.carry = newItem("wheelbarrow"));
  const setup = fightSetup(q);
  finishCombat(st2, setup, { outcome: "retreat", loot: { supplies: {}, gear: [] }, survivorsHurt: [], survivorsDead: [] });
  check(qc[0].gear.carry === c3, "by the numbers, broken off: the cart is pushed off with them");
  finishCombat(st2, setup, { outcome: "defeat", loot: { supplies: {}, gear: [] }, survivorsHurt: [], survivorsDead: [] });
  check(!qc[0].alive || (!qc[0].gear.carry && C.groundAt(st2, partyTile(q)).items.some((x) => x.item === c3)), "by the numbers, beaten: it is left on the ground");
}
{
  // A fight the team starts (an assault): no car, the cart is let go where its pusher starts.
  const st = world();
  const { p, crew } = teamOut(st, 1, { food: 2, water: 2 });
  const cart = (crew[0].gear.carry = newItem("handcart"));
  registerCombatHandler("baseAssault", () => {});
  const setup = { ...fightSetup(p), handler: "baseAssault" };
  const bt = (st.combat = createBattle(st, setup));
  const u = bt.units.find((x) => x.sid === crew[0].id);
  check(!u.bag && K.cartBoxes(bt).some((c) => c.cart === cart && c.staged), "an assault starts with the cart let go where its pusher starts");
}

// ---------- 5. saves ----------
console.log("Saves: a cart pushed and one on the ground, with what is in them");
{
  const st = world();
  const { p, crew } = teamOut(st, 1, { food: 2, water: 2 });
  const [s] = crew;
  const cart = (s.gear.carry = newItem("handcart"));
  cart.contents[3] = newItem("riflecase");
  p.cargo.supplies.wood = 400;
  C.settleHold(st, p);
  const ground = newItem("wheelbarrow");
  ground.held = [{ k: "scrap", q: 7 }];
  ground.contents[0] = newItem("crowbar");
  C.cartOnTile(st, partyTile(p), ground);
  const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const s2 = survivorById(st2, s.id);
  const p2 = st2.parties.find((x) => x.id === p.id);
  const g2 = C.groundAt(st2, partyTile(p2)).items.find((x) => x.key === "wheelbarrow");
  check(K.isCart(s2.gear.carry) && s2.gear.carry.contents[3] && s2.gear.carry.contents[3].key === "riflecase" && s2.gear.carry.contents.length === 16, "the cart pushed keeps its grid and what is in it");
  check(near(C.kgOf(C.settleHold(st2, p2).by[s2.id].cart), C.kgOf(C.settleHold(st, p).by[s.id].cart)), "the team's supplies in it are where they were");
  check(g2 && g2.item.held[0].q === 7 && g2.item.contents[0].key === "crowbar" && g2.cartKg > 14, "the one on the ground keeps its lots and items");
}

// ---------- 6. the AI groups (coarse) ----------
console.log("AI groups: carts as a count, a bigger haul for a party on foot");
{
  const st = world();
  const f = st.factions.find((x) => x.alive && x.bases.length);
  f.carts = 3; f.stock.fuel = 0; // on foot
  const site = st.tiles.find((t) => t.loc && CART_FINDS[t.loc.type] && st.grid.distance(t.id, f.bases[0]) > 1) || st.tiles.find((t) => t.loc && st.grid.distance(t.id, f.bases[0]) > 1);
  const q = sendParty(st, f, f.bases[0], site.id);
  const want = q ? Math.min(2, Math.max(1, Math.floor(q.strength / 2))) : -1;
  check(q && !q.vehicle && q.scav.carts === want && f.carts === 3 - want && near(K.aiCartMult(q), 1 + 0.15 * want), `a party on foot (strength ${q && q.strength}) takes ${want} of the group's 3 carts: ${q ? Math.round((K.aiCartMult(q) - 1) * 100) : 0}% more of what it finds`);
  q.phase = "home";
  scavArrived(st, q);
  check(f.carts >= 3, `home: the carts are back (${f.carts}; one more found now and then)`);
  const q2 = sendParty(st, f, f.bases[0], site.id);
  f.carts = 0; q2.scav.carts = 0;
  check(near(K.aiCartMult(q2), 1), "without carts: no bonus");
}


// One of the dead's siege target next to a cell, if it is that cell (a cart is never one: no hit points).
const siegeTargetOf = (b, z, x, y) => { const zx = z.x, zy = z.y; z.x = x + 1; z.y = y; const t = siegeTarget(b, z); z.x = zx; z.y = zy; return !!t && t[0] === x && t[1] === y; };

// ---------- 7. the picks of 2026-10-11: cover and blocking, noise, wear, terrain, two on a cart, found carts, bikes,
// the enemy's carts, the base's jobs, a pistol one-handed ----------
console.log("A cart let go: a barricade (low cover; the living shove it or go round, the dead crawl over it)");
{
  check(CELL.cart && !CELL.cart.walk && CELL.cart.cover === 1 && !CELL.cart.los, "a cart's cell: no walking through, low cover (1), sight passes");
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 2, water: 2 });
  const [a] = crew;
  const cart = (a.gear.carry = newItem("handcart"));
  const bt = (st.combat = createBattle(st, { ...fightSetup(p), enemy: { kind: "zombies", count: 2, power: 1 } }));
  const u = bt.units.find((x) => x.sid === a.id);
  const cells = K.parkCells(bt, u);
  const [px, py] = cells[cells.length - 1];
  const err = combatAct(st, { type: "parkCart", unit: u.id, x: px, y: py });
  const box = K.cartBoxes(bt)[0];
  const c = bt.cells[py * bt.w + px];
  check(!err && box && box.x === px && box.y === py && c.k === "cart" && !(c.hp > 0), `Park cart: on the cell asked (${px},${py}), its cell a barricade (${c.k}; no hit points: the dead crawl over it, they do not batter it)`);
  const z = bt.units.find((x) => x.side === "enemy");
  const r = reachable(bt, z, 200);
  check(!isFinite(r.dist[py * bt.w + px]), "nobody stops on it (pathing goes round or over)");
  check(!vaultable(bt, c) && crawlable(bt, c) && shoveable(c), "the barricades' rules: the living never vault it (they shove it or go round), the dead crawl over it");
  check(overCost(bt, z, c) === CRAWL.COST, `one of the dead crawls over it at the half cover's cost (${overCost(bt, z, c)} tiles over the step: a walker's whole turn)`);
  const under = box.under.k;
  const wear0 = itemDur(cart), load0 = JSON.stringify(box.contents);
  for (let i = 0; i < 5; i++) bash(bt, z, px, py);
  check(c.k === "cart" && box.blocking && itemDur(cart) === wear0 && !siegeTargetOf(bt, z, px, py), "the dead never batter it (no hit points: crawling over replaces battering it down)");
  // One of the dead crawls across it: it lands on the far side; the cart and what is in it are not touched.
  const sides = [[1, 0], [0, 1]].map(([dx, dy]) => [px + dx, py + dy, px - dx, py - dy]).find(([ax, ay, bx2, by2]) => [[ax, ay], [bx2, by2]].every(([x, y]) => x >= 0 && y >= 0 && x < bt.w && y < bt.h && CELL[bt.cells[y * bt.w + x].k].walk && !bt.units.some((o) => o !== z && o.x === x && o.y === y)));
  if (sides) {
    const [ax, ay, bx2, by2] = sides;
    z.x = ax; z.y = ay; z.f = 0;
    for (const o of bt.units) if (o.side === "player") { o.x = 0; o.y = 0; }
    // Walls either side of the line for the test, so the only way is over the cart.
    const nx = ay === by2 ? 0 : 1, ny = ay === by2 ? 1 : 0, walled = [];
    for (let t2 = -1; t2 <= 1; t2++) for (const sg of [-1, 1]) { const x = px + t2 * (1 - nx) + sg * nx, y = py + t2 * (1 - ny) + sg * ny; const cl = x >= 0 && y >= 0 && x < bt.w && y < bt.h ? bt.cells[y * bt.w + x] : null; if (cl) { walled.push([cl, cl.k]); cl.k = "wall"; } }
    const r2 = reachable(bt, z, 20);
    const pth = pathTo(r2, bx2, by2);
    moveAlong(bt, z, pth);
    for (const [cl, k] of walled) cl.k = k;
    check(isFinite(r2.dist[by2 * bt.w + bx2]) && pth.some(([x, y]) => x === px && y === py) && z.x === bx2 && z.y === by2 && JSON.stringify(box.contents) === load0 && K.cartBoxes(bt).includes(box) && box.blocking, `a walker crawls over it to the far side (${pth.map((q) => q.join(",")).join(" → ")}); the cart and its load untouched`);
  } else check(true, "(no straight line over the cart on this map)");
  // Shoved like furniture (barricade.js shove: both actions, one tile): the cart and its load go with it.
  const v0 = bt.units.find((x) => x.sid === crew[1].id);
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [px + dx, py + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < bt.w && y < bt.h && CELL[bt.cells[y * bt.w + x].k].walk && !bt.units.some((o) => o !== v0 && o.x === x && o.y === y));
  v0.x = spot[0]; v0.y = spot[1]; v0.ap = 2; z.x = bt.w - 1; z.y = bt.h - 1;
  if (bt.phase !== "player") { bt.phase = "player"; }
  const dests = shoveDests(bt, v0, px, py).filter((d) => !d.pull);
  const n0 = box.contents.gear.length + Object.keys(box.contents.sup).length;
  const err2 = dests.length ? combatAct(st, { type: "shove", unit: v0.id, x: px, y: py, tx: dests[0].x, ty: dests[0].y }) : "no room";
  check(!err2 && box.x === dests[0].x && box.y === dests[0].y && bt.cells[box.y * bt.w + box.x].k === "cart" && bt.cells[py * bt.w + px].k === under && box.contents.gear.length + Object.keys(box.contents.sup).length === n0 && v0.ap === 0, `shoved one tile like furniture (both actions): to ${box.x},${box.y} with its load, its old cell ${bt.cells[py * bt.w + px].k} again${err2 ? ` (${err2})` : ""}`);
  const npx = box.x, npy = box.y;
  // Take it back: its cell is what it was.
  const v = v0;
  v.ap = 2;
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [npx + dx, npy + dy]).find(([x, y]) => x > 0 && y > 0 && x < bt.w - 1 && y < bt.h - 1 && CELL[bt.cells[y * bt.w + x].k].walk && !bt.units.some((o) => o !== v && o.x === x && o.y === y));
  if (nb) { v.x = nb[0]; v.y = nb[1]; }
  const under2 = box.under.k;
  const tk = combatAct(st, { type: "takeCart", unit: v.id, box: box.id });
  check(!tk && crew[1].gear.carry === cart && bt.cells[npy * bt.w + npx].k === under2, `Take cart: back in the arms, its cell ${bt.cells[npy * bt.w + npx].k} again (${tk || "ok"})`);
  v.ap = 2;
  // Let go without a cell asked: next to its pusher, the free cell nearest the enemy.
  combatAct(st, { type: "letGoCart", unit: v.id });
  const b2 = K.cartBoxes(bt)[0];
  check(b2 && b2.blocking && Math.max(Math.abs(b2.x - v.x), Math.abs(b2.y - v.y)) === 1, `Let go: it stands next to them as a barricade (${b2 && `${b2.x},${b2.y}`})`);
  // Cover: someone behind it is harder to hit than in the open (the same shot, the cart's cell open again).
  const sh = bt.units.find((x) => x.side === "enemy");
  const t = v;
  for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = b2.x + ox, y = b2.y + oy; if (x > 4 && y > 4 && x < bt.w - 5 && y < bt.h - 5 && CELL[bt.cells[y * bt.w + x].k].walk && !bt.units.some((o) => o !== t && o.x === x && o.y === y)) { t.x = x; t.y = y; break; } } // right behind it
  const dx = b2.x - t.x, dy = b2.y - t.y;
  sh.x = t.x + dx * 4; sh.y = t.y + dy * 4; // straight on, the cart between
  const o1 = shotOdds(bt, sh, t, sh.x, sh.y, { parts: true });
  const cc = bt.cells[b2.y * bt.w + b2.x], k0 = cc.k;
  cc.k = b2.under.k; const o2 = shotOdds(bt, sh, t, sh.x, sh.y, { parts: true }); cc.k = k0;
  check(o1.cover >= 1 && o2.cover < o1.cover && o1.aim < o2.aim, `low cover: behind the cart a shot at ${t.name.split(" ")[0]} has cover ${o1.cover} (aim ${Math.round(o2.aim)} → ${Math.round(o1.aim)}; open: cover ${o2.cover})`);
}

console.log("Noise: a cart rattles");
{
  const st = world();
  const { p, crew } = teamOut(st, 1, { food: 2, water: 2 });
  const k0 = searchHeatMult(st, p).mult;
  crew[0].gear.carry = newItem("wheelbarrow");
  const k1 = searchHeatMult(st, p).mult;
  check(near(k1 / k0, 1.05, 1e-6), `a search makes 5% more Heat with a cart along (×${r1(k1 / k0 * 100) / 100})`);
  const bt = (st.combat = createBattle(st, { ...fightSetup(p), enemy: { kind: "zombies", count: 3, power: 1 } }));
  const u = bt.units.find((x) => x.sid === crew[0].id);
  const zs = bt.units.filter((x) => x.side === "enemy");
  for (const [i, z] of zs.entries()) { z.aware = false; z.investigate = null; z.x = u.x + 2 + i; z.y = u.y; } // close by, unaware
  K.cartMoved(st, bt, u);
  check(zs.some((z) => z.aware || z.investigate), `pushed, it rattles: the unaware dead close by wake or come to look (${zs.filter((z) => z.aware).length} awake, ${zs.filter((z) => z.investigate).length} coming)`);
}

console.log("Wear: rough ground wears the wheels; broken it drags; a workbench mends it with parts");
{
  const st = world();
  const { p, crew } = teamOut(st, 1, { food: 2, water: 2 });
  const cart = (crew[0].gear.carry = newItem("handcart"));
  const forest = st.tiles.find((t) => t.terrain === "forest");
  const from = st.grid.neighbors(forest.id).find((n) => !st.tiles[n].roadLinks.includes(forest.id)) ?? forest.id;
  const d0 = itemDur(cart);
  K.cartWearStep(st, p, from, forest.id);
  check(near(d0 - itemDur(cart), K.CART_WEAR.forest), `a step into forest off the road: ${r1(d0)} → ${r1(itemDur(cart))}`);
  const road = st.tiles.find((t) => t.roadLinks && t.roadLinks.length);
  const d1 = itemDur(cart);
  K.cartWearStep(st, p, road.id, road.roadLinks[0]);
  check(near(itemDur(cart), d1), "on the road: no wear");
  cart.dur = 0.5;
  const broke = K.cartWearStep(st, p, from, forest.id);
  weighTeam(st, p);
  check(broke && K.cartBroken(cart) && K.cartFrac(cart) === 0.75 && p.burden.cartTer.road === 0.5 && p.burden.cartTer.plains === 0.5, `worn out: a wheel off, it drags (75% of it felt, half pace on roads too)`);
  const rk = repairKind(cart);
  check(rk && rk.kind === "cart" && rk.def.in.parts === 1, `repaired as a "cart wheel": ${JSON.stringify(rk && rk.def.in)}`);
  const mech = atBase(st, hub(st).id)[0];
  const res = repairItem(st, hub(st), cart, mech, { tier: 2 });
  check(!K.cartBroken(cart) && itemDur(cart) > 10, `mended at a workbench: ${res.msg}`);
}

console.log("Terrain: a hand cart drags in forest and hills, the wheelbarrow less");
{
  const hc = newItem("handcart"), wb = newItem("wheelbarrow");
  const mk = (it) => ({ gear: { carry: it }, id: 1 });
  const th = K.cartTerrain([mk(hc)]), tw = K.cartTerrain([mk(wb)]);
  check(th.forest === 0.6 && th.hills === 0.6 && th.plains === 0.85 && th.road === 1 && tw.forest === 0.85 && tw.plains === 0.95, `hand cart forest ×${th.forest}, farmland ×${th.plains}; wheelbarrow forest ×${tw.forest}, farmland ×${tw.plains}`);
  const st = world();
  const path = [];
  let at = st.tiles.find((t) => t.terrain === "forest" && !t.road).id;
  path.push(at);
  for (let i = 0; i < 4; i++) { const n = st.grid.neighbors(at).find((x) => st.tiles[x].terrain === "forest" && !path.includes(x)); if (n == null) break; path.push(n); at = n; }
  const plain = travelHours(st, path, { speed: 1, weather: false }).hours, carted = travelHours(st, path, { speed: 1, weather: false, cartTer: th }).hours;
  check(path.length > 2 && carted > plain, `${path.length - 1} forest tiles: ${plain} hours on foot, ${carted} pulling a hand cart (the planner counts it)`);
}

console.log("Two on a hand cart: a helper halves the felt share and the drag");
{
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 2, water: 2 });
  const [a, h] = crew;
  const cart = (a.gear.carry = newItem("handcart"));
  p.cargo.supplies.wood = 600;
  C.settleHold(st, p);
  const f0 = K.feltKg(cart, a), t0 = K.cartTerrain([a]);
  const msg = C.setCartHelp(st, p, h.id, a.id);
  const f1 = K.feltKg(cart, a), t1 = K.cartTerrain(partyMembers(st, p));
  check(near(f1, f0 / 2) && near(t1.forest, 0.8) && near(t1.plains, 0.925), `${msg} (felt ${r1(f0)} → ${r1(f1)} kg; forest ×${t0.forest} → ×${t1.forest})`);
  check(C.roomAt(st, p, { sid: h.id, place: "hands" }, "wood") === 0, "the helper's arms are full too");
  a.gear.carry = newItem("wheelbarrow"); C.settleHold(st, p);
  check(/takes one person/.test(C.setCartHelp(st, p, h.id, a.id)), "a wheelbarrow takes one person");
  a.gear.carry = cart; C.setCartHelp(st, p, h.id, a.id);
  // In a fight: hands full, the pusher at full pace while the helper keeps up, the helper follows a move (1 action).
  h.gear.weapon = newItem("pistol"); p.supplies.a_9mm_fmj = 60;
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const pu = bt.units.find((x) => x.sid === a.id), hu = bt.units.find((x) => x.sid === h.id);
  if (Math.max(Math.abs(pu.x - hu.x), Math.abs(pu.y - hu.y)) !== 1) { hu.x = pu.x; hu.y = pu.y + (pu.y > 0 ? -1 : 1); K.cartHelpStart(st, bt); }
  check(hu.cartHelp === pu.id && pu.cartHelped === hu.id, "they start the fight pulling it together");
  check(C.handsBusy(hu) && !K.oneHandOk({ ...hu, weapon: "huntrifle" }) && K.oneHandOk(hu), "the helper's hands are full (a pistol one-handed at most)");
  const mobPair = pu.mob;
  const ap = hu.ap;
  let moved = "x";
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1]]) { moved = combatAct(st, { type: "move", unit: pu.id, x: pu.x + dx, y: pu.y + dy }); if (!moved) break; }
  check(!moved && hu.cartHelp === pu.id && Math.max(Math.abs(pu.x - hu.x), Math.abs(pu.y - hu.y)) === 1 && hu.ap === ap - 1, `the helper follows the pusher (1 action), still next to them`);
  combatAct(st, { type: "letGoCart", unit: hu.id });
  check(hu.cartHelp == null && pu.cartHelped == null && pu.mob === mobPair - 1, `the helper lets go: the pusher a tile slower a move (${mobPair} → ${pu.mob})`);
}

console.log("Found on the map: carts in the barns and garages of a raid, by the road in a fight");
{
  registerCombatHandler("cartsraid", () => {});
  const saved = { ...K.MAP_CARTS.areas };
  for (const k of Object.keys(K.MAP_CARTS.areas)) K.MAP_CARTS.areas[k] = 1;
  K.MAP_CARTS.areas.pharmacy = 1; K.MAP_CARTS.areas.office = 1; K.MAP_CARTS.areas.gunshop = 1;
  let found = null;
  for (let i = 0; i < 40 && !found; i++) {
    const st = createWorld({ seed: seed * 100 + i, factionCount: 4 });
    st.cards.length = 0; st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["warehouse", "house", "store", "farm", "barn"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 2);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2 } });
    if (res.error) continue;
    const p = res.party; p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const b = (st.combat = createBattle(st, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "cartsraid", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 0 }, context: {} }));
    const boxes = K.cartBoxes(b);
    if (boxes.length) found = { st, b, boxes };
  }
  Object.assign(K.MAP_CARTS.areas, saved);
  delete K.MAP_CARTS.areas.pharmacy; delete K.MAP_CARTS.areas.office; delete K.MAP_CARTS.areas.gunshop;
  check(found && found.boxes.every((c) => c.found && c.blocking && found.b.cells[c.y * found.b.w + c.x].k === "cart"), `a raid map has ${found ? found.boxes.length : 0} abandoned cart(s) standing in it (${found ? found.boxes.map((c) => c.label).join(", ") : "none"})`);
  // By a road: its own dice by the hour; the first hour it comes up.
  const st = world();
  const { p } = teamOut(st, 1, { food: 2, water: 2 });
  const roadTile = st.tiles.find((t) => t.road && t.terrain !== "water" && !t.loc);
  let bx = null;
  for (let hh = 0; hh < 400 && !bx; hh++) {
    st.hour = 500 + hh;
    st.combat = null;
    const bt = createBattle(st, { ...fightSetup(p), tile: roadTile.id });
    if (K.cartBoxes(bt).length) bx = K.cartBoxes(bt)[0];
  }
  check(bx && bx.found, `a fight by a road: now and then an abandoned cart by it (${bx ? bx.label : "none in 400 hours"})`);
  // Untouched, it stays part of the place.
  if (bx) { const b = st.combat; endBattleNow(st, "victory"); closeCombat(st); check(!C.groundAt(st, roadTile.id) || !C.groundAt(st, roadTile.id).items.some((x) => x.item === bx.cart), "left untouched, it is not carried off or marked"); void b; }
}

console.log("Bike trailer: a bike tows a cart");
{
  const st = world();
  const s = atBase(st, hub(st).id)[0];
  ensureInv(s); s.gear.carry = null; s.gear.backpack = null;
  const bike = { type: "bike", count: 1 };
  const t0 = teamLoad([s], 0, bike);
  s.gear.carry = newItem("handcart");
  const t1 = teamLoad([s], 100, bike);
  check(t1.trailer >= 179 && t1.capacity > t0.capacity + 170, `a bike with a hand cart: ${Math.round(t0.capacity)} → ${Math.round(t1.capacity)} kg room (trailer ${t1.trailer} kg)`);
  check(t1.ride.people[0].load < 15, `the rider feels none of the trailer (${r1(t1.ride.people[0].load)} kg on them with 100 kg in tow)`);
}

console.log("The enemy's carts: their scavengers push carts with their haul, let go, and lose them when beaten");
{
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 2, water: 2 });
  for (const s of crew) s.gear.weapon = newItem("pistol");
  p.supplies.a_9mm_fmj = 60;
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const q = { id: 990001, owner: f.id, kind: "scav", strength: 4, scav: { carts: 2, got: { scrap: 40, wood: 200 }, site: partyTile(p) } };
  st.parties.push(q);
  const setup = { ...fightSetup(p), enemy: { kind: "raiders", count: 3, power: 2, factionId: f.id, carts: 2, cartPartyId: q.id } };
  const bt = (st.combat = createBattle(st, setup));
  const pushers = bt.units.filter((x) => x.side === "enemy" && K.holdsCart(x));
  check(pushers.length === 2 && pushers.every((x) => (x.bag.held || []).length) && q.scav.got.scrap < 40, `2 of them start pushing carts with part of their haul (${pushers.map((x) => x.bag.name).join(", ")}; ${q.scav.got.scrap} scrap left in the haul)`);
  endPlayerTurn(st);
  const theirs = K.cartBoxes(bt).filter((c) => c.aiParty === q.id);
  check(theirs.length === 2 && !bt.units.some((x) => x.side === "enemy" && K.holdsCart(x)), "they let go when their side moves: 2 carts on the map");
  const n0 = q.scav.carts;
  for (const x of bt.units) if (x.side === "enemy") { x.dead = true; x.hp = 0; }
  endBattleNow(st, "victory"); closeCombat(st);
  const got = crew.filter((s) => K.isCart(s.gear.carry)).length + p.cargo.gear.filter((it) => K.isCart(it)).length + ((C.groundAt(st, partyTile(p)) || { items: [] }).items.filter((x) => K.isCart(x.item)).length);
  check(got === 2 && q.scav.carts === n0 - 2, `beaten: both carts and what was in them are yours (${got}); the group has ${q.scav.carts} out`);
  // You lose: they keep them, their load back in the haul.
  const st2 = world();
  const { p: p2 } = teamOut(st2, 1, { food: 2, water: 2 });
  const q2 = { id: 990002, owner: f.id, kind: "scav", strength: 4, scav: { carts: 1, got: { scrap: 40 }, site: partyTile(p2) } };
  st2.parties.push(q2);
  const bt2 = (st2.combat = createBattle(st2, { ...fightSetup(p2), enemy: { kind: "raiders", count: 2, power: 2, carts: 1, cartPartyId: q2.id } }));
  endPlayerTurn(st2);
  endBattleNow(st2, "defeat"); closeCombat(st2);
  check(q2.scav.carts === 1 && near(q2.scav.got.scrap, 40), `you lose: they keep the cart and their haul (${q2.scav.got.scrap} scrap)`);
  void bt2;
}

console.log("The base's jobs: a cart at the base, a woodcutter or a builder hauls 10% more");
{
  const st = world();
  const h = hub(st);
  const people = atBase(st, h.id);
  for (const s of people) { s.role = "idle"; ensureInv(s); s.gear.carry = null; }
  people[0].role = "build";
  h.armory = (h.armory || []).filter((it) => !K.isCart(it));
  const r0 = buildRate(st, h);
  h.armory.push(newItem("wheelbarrow"));
  const r1b = buildRate(st, h);
  check(K.baseCarts(st, h) === 1 && near(r1b, r0 * 1.1, 1e-6), `a builder with the base's wheelbarrow: ${r1(r0 * 100) / 100} → ${r1(r1b * 100) / 100} a day`);
  h.armory[h.armory.length - 1].dur = 0;
  check(K.baseCarts(st, h) === 0, "a broken one does not count");
  check(near(K.aiWorkMult({ carts: 2 }), 1.1) && near(K.aiWorkMult({ carts: 1 }), 1.05) && K.aiWorkMult({}) === 1, "AI groups: up to 10% more off their land with carts (coarse)");
}

console.log("A pistol one-handed while pushing: Shoot only, -15 aim");
{
  const st = world();
  const { p, crew } = teamOut(st, 1, { food: 2, water: 2 });
  crew[0].gear.weapon = newItem("pistol");
  p.supplies.a_9mm_fmj = 60;
  crew[0].gear.carry = newItem("wheelbarrow");
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const u = bt.units.find((x) => x.sid === crew[0].id);
  const foe = bt.units.find((x) => x.side === "enemy");
  check(K.oneHandOk(u) && canFire(bt, u), "pushing a cart, a pistol can still fire");
  const withCart = shotOdds(bt, u, foe, u.x, u.y, { parts: true });
  const bag = u.bag; u.bag = null;
  const without = shotOdds(bt, u, foe, u.x, u.y, { parts: true });
  u.bag = bag;
  check(near(without.aim - withCart.aim, 15) && withCart.parts.some(([l]) => /One-handed/.test(l)), `one-handed: aim ${Math.round(without.aim)} → ${Math.round(withCart.aim)} (−15)`);
  check(/Hands full/.test(combatAct(st, { type: "reload", unit: u.id })) && /Hands full/.test(combatAct(st, { type: "overwatch", unit: u.id })), "no reload, no overwatch with a hand on the cart");
}


// ---------- 8. round 3 (2026-10-11): a cart's load only through the cart, brutes and vehicles, park beside (1 action),
// raiders park as cover, abandoned carts on the roads, route wear ----------
console.log("What is in a cart is had only through the cart: not off the ground, not spilled");
{
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 2, water: 2 });
  const [a, b2] = crew;
  const cart = (a.gear.carry = newItem("wheelbarrow"));
  cart.contents[0] = newItem("crowbar");
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const u = bt.units.find((x) => x.sid === a.id), v = bt.units.find((x) => x.sid === b2.id);
  combatAct(st, { type: "letGoCart", unit: u.id });
  const box = K.cartBoxes(bt)[0];
  check(box && pilesNear(bt, u).every((c) => !c.cart) && box.contents.gear.length === 1, "the Ground window does not list a cart (its crowbar is not a loose thing on the ground)");
  const r = groundAct(st, bt, u, { type: "pickUp", unit: u.id });
  check(/Nothing/.test(r) && box.contents.gear.length === 1, `Pick up from the ground takes nothing out of it (${r})`);
  // Its grid's slots: no more items than it has room for, so nothing ever spills when it is packed again.
  v.x = u.x; v.y = u.y;
  for (let i = 0; i < 9; i++) box.contents.gear.push(newItem("knife"));
  const pile = dropToGround(bt, v, newItem("knife"));
  const why = raidMove(st, v.id, `rbox:${pile.id}:gear:0`, `rbox:${box.id}:list`);
  check(/slots taken/.test(why), `its grid full (10 slots): no more items (${why})`);
  // A brute's one blow and a vehicle's ram: the cell opens, the cart takes heavy wear, its load stays in it.
  const c = bt.cells[box.y * bt.w + box.x], d0 = itemDur(cart), n0 = box.contents.gear.length;
  K.cartKnocked(bt, box.x, box.y, "brute");
  check(c.k !== "cart" && near(d0 - itemDur(cart), Math.min(d0, K.CART_WEAR.brute)) && box.contents.gear.length === n0 && K.cartBoxes(bt).includes(box) && !pilesNear(bt, v).some((q) => q.contents.gear.includes(cart)), `a brute smashes it aside in one blow: cell ${c.k}, wear ${r1(d0)} → ${r1(itemDur(cart))}, its ${n0} things still in it`);
}
{
  // A vehicle drives through a parked cart (combat.js driveTo).
  registerCombatHandler("cartsram", () => {});
  let done = null;
  for (let i = 0; i < 40 && !done; i++) {
    const st = createWorld({ seed: seed * 100 + i, factionCount: 4 });
    st.cards.length = 0; st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["pharmacy", "store", "gunstore", "police", "warehouse", "house", "gas"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 2);
    const veh = createVehicle(st, "truck", { kind: "base", baseId: h.id }, { fuel: 30 });
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: veh.id, supplies: { food: 2, water: 2 } });
    if (res.error) continue;
    const p = res.party; p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    crew[1].gear.carry = newItem("handcart");
    const b = (st.combat = createBattle(st, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "cartsram", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 0 }, context: {} }));
    if (b.raid.choose) b.raid.choose = null;
    const vv = b.vehicle;
    const drv = b.units.find((x) => x.side === "player" && x.sid === crew[0].id);
    const pu = b.units.find((x) => x.side === "player" && x.sid === crew[1].id);
    if (pu && !K.holdsCart(pu)) { const ct = newItem("handcart"); crew[1].gear.carry = ct; pu.bag = ct; } // a raid starts with the loads in the truck: handed one on the map
    if (!vv || !drv || !pu || !K.holdsCart(pu)) continue;
    // A straight run east from the vehicle along its first row: the cart parked two cells ahead of it.
    const y = vv.y, cx = vv.x + vv.w + 1;
    const clear = (x) => x < b.w && CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => o.x === x && o.y === y && o !== pu && o !== drv);
    if (![vv.x + vv.w, cx, cx + 1, cx + 2].every(clear)) continue;
    for (const o of b.units) if (o.side === "player" && o !== drv && o !== pu) { o.x = 0; o.y = b.h - 1; }
    pu.x = cx + 1; pu.y = y; pu.ap = 2;
    if (!K.parkCells(b, pu).some(([x2, y2]) => x2 === cx && y2 === y)) continue;
    if (combatAct(st, { type: "parkCart", unit: pu.id, x: cx, y })) continue;
    pu.x = cx + 1; pu.y = Math.min(b.h - 1, y + 3);
    const box = K.cartBoxes(b).find((q) => q.x === cx && q.y === y);
    if (!box || !box.blocking) continue;
    drv.x = vv.x - 1; drv.y = y; if (!CELL[b.cells[drv.y * b.w + drv.x].k].walk) { drv.aboard = true; }
    const d0 = itemDur(box.cart);
    const err = driveTo(b, drv, cx + 1 + Math.floor((vv.w - 1) / 2), y + Math.floor((vv.h - 1) / 2));
    if (err) continue;
    done = { b, box, d0 };
  }
  if (done) check(done.b.cells[done.box.y * done.b.w + done.box.x].k !== "cart" && itemDur(done.box.cart) <= done.d0 - Math.min(done.d0, K.CART_WEAR.ram) + 1e-6 && K.cartBoxes(done.b).includes(done.box), `a vehicle rams through a parked cart: wrecked (wear ${r1(done.d0)} → ${r1(itemDur(done.box.cart))}), the way open, the cart and its load still there`);
  else check(K.CART_WEAR.ram === 25, "(no straight run for the vehicle on these maps: the ram's wear checked only)");
}

console.log("Moving and parking: a held cart moves with its pusher; parking takes an action, on a side cell");
{
  const st = world();
  const { p, crew } = teamOut(st, 1, { food: 2, water: 2 });
  const cart = (crew[0].gear.carry = newItem("handcart"));
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const u = bt.units.find((x) => x.sid === crew[0].id);
  const x0 = u.x, y0 = u.y;
  let moved = "x";
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { moved = combatAct(st, { type: "move", unit: u.id, x: u.x + dx, y: u.y + dy }); if (!moved) break; }
  check(!moved && u.bag === cart && (u.x !== x0 || u.y !== y0), "it moves with its pusher (only their tiles a move are fewer)");
  if (bt.phase !== "player") runEnemyPhase(st); // a lone unit that spent its actions ended the turn
  u.ap = 2;
  const cells = K.parkCells(bt, u);
  check(cells.length > 0 && cells.every(([x, y]) => Math.abs(x - u.x) + Math.abs(y - u.y) === 1), `Park cart: only the cells left, right, in front and behind (${cells.length} free)`);
  const diag = [u.x + 1, u.y + 1];
  const dg = combatAct(st, { type: "parkCart", unit: u.id, x: diag[0], y: diag[1] });
  check(/beside them/.test(dg), `not on a corner (${dg})`);
  const err = combatAct(st, { type: "parkCart", unit: u.id, x: cells[0][0], y: cells[0][1] });
  check(!err && !u.bag && u.ap === 1 && K.cartBoxes(bt)[0].blocking, `parked: 1 action (${u.ap} left), its cell a barricade${err ? ` (${err})` : ""}`);
  // The free emergency Let go: the nearest free side cell, or under their feet when every side is taken.
  u.ap = 2; // (a lone unit out of actions would end the turn)
  combatAct(st, { type: "takeCart", unit: u.id });
  const box2 = K.cartBoxes(bt);
  check(u.bag === cart && !box2.length, "taken back");
  u.ap = 2;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const c = bt.cells[(u.y + dy) * bt.w + u.x + dx]; if (c) { c.k0 = c.k; c.k = "wall"; } }
  const lg = combatAct(st, { type: "letGoCart", unit: u.id });
  const b3 = K.cartBoxes(bt)[0];
  void lg;
  check(b3 && b3.x === u.x && b3.y === u.y && !b3.blocking && u.ap === 2, `Let go (free) with no free side cell: under their feet, no barricade (${b3 ? `${b3.x},${b3.y} vs ${u.x},${u.y}, blocking ${b3.blocking}` : "none"}, ${u.ap} actions)`);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const c = bt.cells[(u.y + dy) * bt.w + u.x + dx]; if (c && c.k0) { c.k = c.k0; delete c.k0; } }
}

console.log("Raiders park their carts as cover, facing you");
{
  const st = world();
  const { p, crew } = teamOut(st, 2, { food: 2, water: 2 });
  for (const s of crew) s.gear.weapon = newItem("pistol");
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const q = { id: 990003, owner: f.id, kind: "scav", strength: 4, scav: { carts: 2, got: { scrap: 40 }, site: partyTile(p) } };
  st.parties.push(q);
  const bt = (st.combat = createBattle(st, { ...fightSetup(p), enemy: { kind: "raiders", count: 3, power: 2, factionId: f.id, carts: 2, cartPartyId: q.id } }));
  const pushers = bt.units.filter((x) => x.side === "enemy" && K.holdsCart(x));
  const at = pushers.map((u) => ({ u, x: u.x, y: u.y }));
  endPlayerTurn(st);
  const mine = bt.units.filter((x) => x.side === "player");
  const nearest = (x, y) => Math.min(...mine.map((m) => Math.hypot(m.x - x, m.y - y)));
  const faced = ({ x, y }) => { const box = K.cartBoxes(bt).find((c) => c.aiParty === q.id && Math.abs(c.x - x) + Math.abs(c.y - y) === 1); return box && box.blocking && nearest(box.x, box.y) <= nearest(x, y); };
  const under = ({ x, y }) => K.cartBoxes(bt).some((c) => c.aiParty === q.id && c.x === x && c.y === y && !c.blocking); // no free side cell: under their feet
  check(pushers.length === 2 && at.some(faced) && at.every((a) => faced(a) || under(a)), "they park on the side cell facing your people (a barricade between; under their feet when no side is free)");
  void p;
}

console.log("Abandoned carts on the roads near towns (a new world)");
{
  const st = createWorld({ seed: seed + 11, factionCount: 4 });
  const ab = st.deathSites.filter((d) => d.abandoned);
  const towns = st.tiles.filter((t) => t.loc && (t.loc.type === "town" || t.loc.type === "city"));
  check(ab.length >= 1 && ab.every((d) => st.tiles[d.tile].road && towns.some((w) => st.grid.distance(w.id, d.tile) <= K.ROAD_CARTS.range) && K.isCart(d.items[0].item)), `${ab.length} carts abandoned on roads near towns`);
  check(/^Abandoned cart: (Wheelbarrow|Hand cart) \(/.test(deathLabel(ab[0])), `its marker: ${deathLabel(ab[0])}`);
  const st2 = createWorld({ seed: seed + 11, factionCount: 4 });
  check(JSON.stringify(st2.deathSites.map((d) => d.tile)) === JSON.stringify(st.deathSites.map((d) => d.tile)), "the same world, the same carts (its own dice)");
  // Found and opened by a team: one thing out, the cart stays; then taken whole.
  const site = ab.find((d) => d.items[0].item.held) || ab[0];
  const cart = site.items[0].item;
  st.started = true; st.visitorsOff = true; st.noWanderers = true;
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 1);
  for (const s of crew) { ensureInv(s); s.gear.carry = null; s.gear.backpack = null; }
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: site.tile, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2 } });
  const p = res.party; p.path = [site.tile]; p.idx = 0; p.phase = "waiting"; p.dest = site.tile;
  if (cart.held) {
    const k = cart.held[0].k, have = cart.held[0].q;
    const m = C.takeFromGroundCart(st, p, 0, { lot: 0 });
    check(/Took/.test(m) && site.items[0].item === cart && ((p.cargo.supplies[k] || 0) > 0 || (p.supplies[k] || 0) > 0), `opened on the ground: ${m} (${have} there; the cart stays)`);
  } else check(true, "(this one was empty)");
  const r = C.pickUpGround(st, p, 0);
  check(crew[0].gear.carry === cart, `then taken whole: ${r}`);
  // The groups' scavengers find them slowly.
  const st3 = createWorld({ seed: seed + 11, factionCount: 4 });
  const ab3 = st3.deathSites.filter((d) => d.abandoned);
  const n0 = ab3.length;
  for (let d = 0; d < 20; d++) { st3.hour = 24 * (d + 1); deathSitesDaily(st3); }
  const n20 = st3.deathSites.filter((d) => d.abandoned).length;
  const carts = st3.factions.reduce((a, f) => a + (f.carts || 0), 0);
  check(n20 <= n0 && n20 >= 1, `after 20 days ${n0 - n20} of ${n0} taken by the groups (they keep ${carts} cart${carts === 1 ? "" : "s"}); the rest still lie there`);
}

console.log("Trip estimates show the cart wear of the route");
{
  const st = world();
  const h = hub(st);
  const off = st.tiles.find((t) => t.terrain === "forest" && !t.road && st.grid.distance(t.id, h.tile) >= 4 && st.grid.distance(t.id, h.tile) <= 7);
  const est = estimateTrip(st, { memberIds: [atBase(st, h.id)[0].id], dest: off.id, vehicle: false, stance: "normal" });
  check(est && est.cartWearOut > 0 && near(est.cartWearOut, K.cartRouteWear(st, est.path)), `on foot to a forest ${st.grid.distance(off.id, h.tile)} tiles out: this route costs ~${est && Math.round(est.cartWearOut + est.cartWearBack)} wear (${est && est.cartWearOut} out, ${est && est.cartWearBack} back)`);
  const { p, crew } = teamOut(st, 1, { food: 2, water: 2 });
  crew[0].gear.carry = newItem("handcart");
  const m = moveEstimate(st, p, off.id);
  check(m && m.cartWear >= 0 && near(m.cartWear, K.cartRouteWear(st, m.path)), `a team's move order: ~${m && m.cartWear} wear`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
