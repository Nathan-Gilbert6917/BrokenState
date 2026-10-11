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
import { launchExpedition, partyTile, cargoRoom, partyMembers, partyLoad, weighTeam, offroadOf } from "../src/sim/parties.js";
import * as C from "../src/sim/carry.js";
import * as K from "../src/sim/carts.js";
import { createBattle, combatAct, closeCombat, registerCombatHandler, canFire, fireRefusal, endBattleNow, finishCombat } from "../src/sim/combat.js";
import { dropToGround, groundPiles } from "../src/sim/ground.js";
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
  check(p.burden.cartOff === 0.7 && offroadOf(p) === 0.7, `off the roads ×${offroadOf(p)} pace (the wheelbarrow ×${GEAR.wheelbarrow.cart.offroad})`);
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
  for (const s of crew) s.gear.weapon = newItem("pistol");
  p.supplies.a_9mm_fmj = 60;
  const cart = (a.gear.carry = newItem("wheelbarrow"));
  cart.contents[0] = newItem("crowbar");
  p.cargo.supplies.wood = 200; // 20 kg: in the wheelbarrow
  C.settleHold(st, p);
  const wood0 = supKg(p, "wood");
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const u = bt.units.find((x) => x.sid === a.id), v = bt.units.find((x) => x.sid === b2.id);
  check(u.bag === cart && !canFire(bt, u) && /wheelbarrow/.test(fireRefusal(bt, u)), `starts pushing it: no shooting (${fireRefusal(bt, u)})`);
  const mobHeld = u.mob, ap = u.ap;
  check(!combatAct(st, { type: "letGoCart", unit: u.id }) && !u.bag && u.ap === ap && !a.gear.carry, "Let go: free, hands free");
  const box = K.cartBoxes(bt)[0];
  check(box && box.x === u.x && box.y === u.y && box.cart === cart && box.contents.gear.some((g) => g.key === "crowbar") && near(box.contents.sup.wood || 0, 200) && near(supKg(p, "wood"), wood0 - 200), `the cart stands on its cell with the crowbar and the firewood in it (out of the pool: ${r1(supKg(p, "wood"))} of ${r1(wood0)} wood left)`);
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
