// The hands and the ground in the inventory windows (the user's reports, 2026-10-20; src/ui/inventory.js carriedList,
// fightGround, groundBox; src/sim/carry.js dropArmsSupply, groundToPerson, haulBusy; src/sim/raidloot.js raidMove):
//   1. "Hands full" never shows over an empty Carried list: the team's supplies taken off a ground pile in a team's
//      fight go into the arms (carry.js pileToArms, u.hands), not the finds carried loose, and the Carried list (the
//      search window's and the fight's Inventory window's) shows them; dragged onto the ground they are set down (free);
//      a crumb of a part-unit left carried loose fills no hands and goes along with the last whole unit moved.
//   2. A cart (or a bag) in the arms is in the Carried list of whoever holds it, its grid there, in a fight (taken with
//      Take cart too) and on the State Map (the Supplies carried box's Carried (hands) row); dragged onto the ground in a
//      fight it is let go (free).
//   3. The ground in a survivor's inventory: in a fight the piles on and next to them (picked up onto a pocket,
//      hauling; put down free); on the State Map the tile's ground (a thing onto a pocket, a cart twice-clicked into
//      the arms, supplies into the pool; a thing of theirs dropped on it goes down).
// Usage: node tools/invhandstest.js [seed]   ("passed" / "failed" lines; exits 1 on a failure)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { newItem, ensureInv } from "../src/sim/inventory.js";
import { launchExpedition, partyTile } from "../src/sim/parties.js";
import * as C from "../src/sim/carry.js";
import * as K from "../src/sim/carts.js";
import { createBattle, combatAct, registerCombatHandler } from "../src/sim/combat.js";
import { dropToGround, groundAt as pileAt } from "../src/sim/ground.js";
import { raidMove } from "../src/sim/raidloot.js";
import { inventoryModal, INV_ACTIONS, invDrop } from "../src/ui/inventory.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "passed" : "failed"} ${what}`); return ok; };
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

function world(s = seed) {
  const st = createWorld({ seed: s, factionCount: 4 });
  st.started = true; st.visitorsOff = true; st.noWanderers = true;
  st.hordes.length = 0;
  st.deathSites = st.deathSites.filter((d) => !d.abandoned);
  return st;
}
// A team of n out on a land tile 2 from the hub, waiting there (no packs, empty pockets).
function teamOut(st, n = 2, supplies = { food: 2, water: 2 }) {
  const h = hub(st);
  Object.assign(h.stock, { water: 300, ammo: 300, meds: 20 });
  const crew = atBase(st, h.id).slice(0, n);
  for (const s of crew) { ensureInv(s); s.gear.backpack = null; s.gear.carry = null; s.pockets = s.pockets.map(() => null); s.health = 100; }
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: null, supplies });
  const p = res.party;
  if (!p) throw new Error(`no team: ${res.error || JSON.stringify(res)}`);
  p.path = [dest]; p.idx = 0; p.phase = "waiting"; p.dest = dest;
  return { p, crew };
}
registerCombatHandler("invhandstest", () => {});
const fightSetup = (p) => ({ tile: partyTile(p), partyId: p.id, enemy: { kind: "zombies", count: 1, power: 1 }, ambush: null, canRetreat: true, handler: "invhandstest", context: {} });
const click = (st, ui, loc) => INV_ACTIONS["inv-click"](st, ui, { loc }, null);
// The Carried list's part of a window's html (from its label to the next label).
const carriedPart = (html) => { const i = html.indexOf(">Carried ("); return i < 0 ? "" : html.slice(i, html.indexOf('class="invlabel', i + 10) > 0 ? html.indexOf('class="invlabel', i + 10) : i + 4000); };

// ---------- 1. the team's supplies in the arms ----------
console.log("1. Hands full is never an empty Carried list: the team's supplies in the arms are listed and set down");
{
  const st = world();
  const { p, crew } = teamOut(st);
  const [a] = crew;
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const u = bt.units.find((x) => x.sid === a.id);
  u.hands = null; u.bag = null; u.haul = { sup: {}, gear: [] };
  const pile = dropToGround(bt, u, "rawwater", 3);
  const msg = raidMove(st, u.id, `rbox:${pile.id}:sup:rawwater`, `haul:${u.id}:list`);
  check(C.handsBusy(u) && near((u.hands && u.hands.rawwater) || 0, 3) && !(u.haul.sup.rawwater > 0), `water off the ground goes into the arms, not loose: hands full (${msg})`);
  // The search window (the Ground window) and the fight's Inventory window both list it under Carried.
  const ui = { inv: { raid: true, uid: u.id, box: pile.id } };
  const html = inventoryModal(st, ui) || "";
  const cp = carriedPart(html);
  check(/hands full/.test(cp) && cp.includes(`arms:${u.id}:sup:rawwater`) && !/Nothing\. Drop finds here/.test(cp), "the Ground window's Carried list shows the water in the arms (not \"Nothing\" under \"hands full\")");
  const ui2 = { inv: { sid: a.id, peek: true } };
  const h2 = inventoryModal(st, ui2) || "";
  const cp2 = carriedPart(h2);
  check(cp2.includes(`arms:${u.id}:sup:rawwater`) && /hands full/.test(cp2) && /On the ground here/.test(h2), "the fight's Inventory window has a Carried list with it, and the ground");
  // Dragged onto the ground: set down there, free; the hands free again.
  const ap = u.ap;
  invDrop(st, ui2, `arms:${u.id}:sup:rawwater`, `rbox:${pile.id}:list`);
  const p2 = pileAt(bt, u.x, u.y, u.f || 0);
  check(!C.handsBusy(u) && !u.hands && p2 && near(p2.contents.sup.rawwater || 0, 3) && u.ap === ap, `dragged onto the ground: set down there, free, hands free (${ui2.invMsg})`);
  // Picked again (click), then the ground clicked; Set down.
  raidMove(st, u.id, `rbox:${p2.id}:sup:rawwater`, `haul:${u.id}:list`);
  check(C.handsBusy(u), "taken up again: in the arms");
  click(st, ui, `arms:${u.id}:sup:rawwater`);
  check(ui.invArms === `arms:${u.id}:sup:rawwater` && /Selected: <b>3 un-purified water/.test(inventoryModal(st, ui) || ""), "clicked in the Ground window: picked, a line says what and how");
  click(st, ui, `rbox:${p2.id}:list`);
  check(!C.handsBusy(u) && near(pileAt(bt, u.x, u.y, u.f || 0).contents.sup.rawwater || 0, 3), `then the ground clicked: set down (${ui.invMsg})`);
  raidMove(st, u.id, `rbox:${p2.id}:sup:rawwater`, `haul:${u.id}:list`);
  click(st, ui2, `arms:${u.id}:sup:rawwater`);
  INV_ACTIONS["inv-armsdown"](st, ui2);
  check(!C.handsBusy(u), "Set down (the selection line's button) in the fight's Inventory window: hands free");
  // Elsewhere than the ground: refused, said why.
  raidMove(st, u.id, `rbox:${p2.id}:sup:rawwater`, `haul:${u.id}:list`);
  invDrop(st, ui2, `arms:${u.id}:sup:rawwater`, `s:${a.id}:pocket:0`);
  check(C.handsBusy(u) && /ground/.test(ui2.invMsg || ""), `onto a pocket: no, the ground (${ui2.invMsg})`);
  combatAct(st, { type: "dropCarried", unit: u.id });

  // A crumb of a part-unit carried loose fills no hands; it goes along with the last whole unit.
  u.haul.sup.scrap = 0.5;
  check(!C.handsBusy(u) && C.handsCount(u) === 0, "half a unit of scrap left loose: not hands full (the list shows whole units)");
  u.haul.sup.scrap = 2.5;
  const pl = pileAt(bt, u.x, u.y, u.f || 0);
  const s0 = pl.contents.sup.scrap || 0;
  const mv = raidMove(st, u.id, `haul:${u.id}:sup:scrap`, `rbox:${pl.id}:list`);
  check(!(u.haul.sup.scrap > 1e-6) && near((pl.contents.sup.scrap || 0) - s0, 2.5) && !C.handsBusy(u), `2.5 scrap put down: all of it goes, no crumb left in the hands (${mv})`);
}

// ---------- 2. carts and bags in the Carried list ----------
console.log("2. A cart in the arms is in its pusher's Carried list (in a fight and on the State Map)");
{
  const st = world();
  const { p, crew } = teamOut(st);
  const [a, b2] = crew;
  const cart = (a.gear.carry = newItem("wheelbarrow"));
  cart.contents[0] = newItem("crowbar");
  C.settleHold(st, p);
  // The State Map: the Supplies carried box's Carried (hands) row names it.
  const uiM = { inv: { sid: a.id } };
  const hm = inventoryModal(st, uiM) || "";
  check(/Carried \(hands\)<\/b> pushes the wheelbarrow/.test(hm), "State Map: the Carried (hands) row says who pushes the wheelbarrow");
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const u = bt.units.find((x) => x.sid === a.id), v = bt.units.find((x) => x.sid === b2.id);
  check(u.bag === cart && C.handsBusy(u), "the fight starts with it pushed: hands full");
  const ui = { inv: { sid: a.id, peek: true } };
  const hp = inventoryModal(st, ui) || "";
  const cp = carriedPart(hp);
  check(cp.includes(`data-loc="s:${a.id}:carry"`) && />pushed</.test(cp) && hp.indexOf(`s:${a.id}:bag:0`) > hp.indexOf(">Carried (") && hp.split(`data-loc="s:${a.id}:bag:0"`).length === 2, "the fight's Inventory window: the wheelbarrow in Carried, pushed, with its grid (the crowbar's cell)");
  const uiR = { inv: { raid: true, uid: u.id, box: null } };
  dropToGround(bt, u, "scrap", 1); // a loot layer for the search window
  const cpr = carriedPart(inventoryModal(st, uiR) || "");
  check(cpr.includes(`data-loc="s:${a.id}:carry"`) && !/Nothing\. Drop finds here/.test(cpr), "the Ground window's Carried list has it too");
  // Dragged onto the ground: let go (free), a cart on the map with all in it.
  const ap = u.ap;
  invDrop(st, ui, `s:${a.id}:carry`, `here:${u.id}:list`);
  const box = K.cartBoxes(bt)[0];
  check(!u.bag && !a.gear.carry && box && box.cart === cart && u.ap === ap, `dragged onto the ground: let go there, free (${ui.invMsg})`);
  // Taken by the other one (Take cart): in their Carried list now.
  v.x = box.x + (box.x > 0 ? -1 : 1); v.y = box.y; v.f = box.f || 0;
  if (bt.cells[v.y * bt.w + v.x].k !== "open" && bt.cells[v.y * bt.w + v.x].k !== "floor") { v.x = u.x; v.y = u.y; }
  const tk = combatAct(st, { type: "takeCart", unit: v.id, box: box.id });
  const uiV = { inv: { sid: b2.id, peek: true } };
  const cpv = carriedPart(inventoryModal(st, uiV) || "");
  check(!tk && v.bag === cart && cpv.includes(`data-loc="s:${b2.id}:carry"`) && /hands full/.test(cpv), `Take cart: in the taker's Carried list (${tk || "ok"})`);
  // The search window: the cart picked, then the ground clicked: let go.
  const uiRV = { inv: { raid: true, uid: v.id, box: null } };
  inventoryModal(st, uiRV);
  click(st, uiRV, `s:${b2.id}:carry`);
  const own = pileAt(bt, v.x, v.y, v.f || 0) || dropToGround(bt, v, "scrap", 1);
  click(st, uiRV, `rbox:${own.id}:list`);
  check(!v.bag && K.cartBoxes(bt).length === 1, `the search window: picked, then the ground clicked: let go (${uiRV.invMsg})`);
}

// ---------- 3. the ground in the inventory windows ----------
console.log("3. The ground in a survivor's inventory: in a fight (piles on and next to them) and on the State Map");
{
  const st = world();
  const { p, crew } = teamOut(st);
  const [a] = crew;
  const bt = (st.combat = createBattle(st, fightSetup(p)));
  const u = bt.units.find((x) => x.sid === a.id);
  u.hands = null; u.bag = null; u.haul = { sup: {}, gear: [] };
  const knife = newItem("knife");
  const pile = dropToGround(bt, u, knife);
  const ui = { inv: { sid: a.id, peek: true } };
  const html = inventoryModal(st, ui) || "";
  check(html.includes(`rbox:${pile.id}:gear:0`) && /On the ground here/.test(html), "the fight's Inventory window shows the knife on the ground under them");
  click(st, ui, `rbox:${pile.id}:gear:0`);
  check(ui.invSel === `rbox:${pile.id}:gear:0` && /Selected: <b>Kitchen knife/i.test(inventoryModal(st, ui) || ""), "clicked: picked (a line says so)");
  click(st, ui, `s:${a.id}:pocket:0`);
  check(a.pockets[0] === knife && !pile.contents.gear.includes(knife), `then a pocket clicked: picked up into it (${ui.invMsg})`);
  invDrop(st, ui, `s:${a.id}:pocket:0`, `rbox:${pile.id}:list`);
  check(!a.pockets[0] && pile.contents.gear.includes(knife), `dragged back onto the ground: put down (${ui.invMsg})`);
  // A pile next to them is within reach too.
  const ox = u.x, oy = u.y;
  u.x = ox + 1 < bt.w ? ox + 1 : ox - 1;
  const h2 = inventoryModal(st, ui) || "";
  check(/On the ground next to them/.test(h2) && h2.includes(`rbox:${pile.id}:gear:`), "a step away: the pile is listed as next to them");
  u.x = ox; u.y = oy;
  // Not their turn: shown, not moved.
  bt.phase = "enemy";
  invDrop(st, ui, `rbox:${pile.id}:gear:0`, `s:${a.id}:pocket:0`);
  check(!a.pockets[0] && /enemy turn/.test(ui.invMsg || ""), `on the enemy's turn nothing moves (${ui.invMsg})`);
  bt.phase = "player";
  st.combat = null;
}
{
  const st = world();
  const { p, crew } = teamOut(st);
  const [a, b2] = crew;
  const tile = partyTile(p);
  const knife = newItem("knife");
  C.leaveOnGround(st, tile, { scrap: 3 }, [knife]);
  const ui = { inv: { sid: a.id } };
  let html = inventoryModal(st, ui) || "";
  const site = () => C.groundAt(st, tile);
  const at = (pred) => site() ? site().items.findIndex(pred) : -1;
  const ki = at((it) => it.item === knife);
  check(/On the ground here/.test(html) && html.includes(`gnd:${p.id}:${ki}`) && html.includes(`gnd:${p.id}:list`), "State Map: the survivor's window shows the tile's ground, a drop box");
  click(st, ui, `gnd:${p.id}:${ki}`);
  check(ui.invSel === `gnd:${p.id}:${ki}` && /Selected on the ground/.test(inventoryModal(st, ui) || ""), "a thing on the ground clicked: picked");
  click(st, ui, `s:${a.id}:pocket:1`);
  check(a.pockets[1] === knife && at((it) => it.item === knife) < 0, `then a pocket clicked: picked up into it (${ui.invMsg})`);
  click(st, ui, `s:${a.id}:pocket:1`);
  click(st, ui, `gnd:${p.id}:list`);
  check(!a.pockets[1] && at((it) => it.item === knife) >= 0, `a thing of theirs, then the ground: put down (${ui.invMsg})`);
  invDrop(st, ui, `gnd:${p.id}:${at((it) => it.item === knife)}`, `s:${b2.id}:pocket:0`);
  check(b2.pockets[0] === knife, `dragged from the ground onto a teammate's pocket: theirs (${ui.invMsg})`);
  // Supplies: clicked twice, into the team's pool.
  const si = at((it) => it.kind === "supply" && it.key === "scrap");
  const sc0 = (p.supplies.scrap || 0) + ((p.cargo && p.cargo.supplies.scrap) || 0);
  click(st, ui, `gnd:${p.id}:${si}`); click(st, ui, `gnd:${p.id}:${si}`);
  const sc1 = (p.supplies.scrap || 0) + ((p.cargo && p.cargo.supplies.scrap) || 0);
  check(near(sc1 - sc0, 3) && at((it) => it.kind === "supply" && it.key === "scrap") < 0, `3 scrap clicked twice: the team's (${ui.invMsg})`);
  // A cart on the ground: clicked twice, into this survivor's arms; their Carried (hands) row says so.
  const cart = newItem("handcart");
  C.cartOnTile(st, tile, cart);
  const ci = at((it) => it.item === cart);
  html = inventoryModal(st, ui) || "";
  check(html.includes(`gnd:${p.id}:${ci}`) && />cart</.test(html), "a cart on the ground is listed (marked a cart)");
  click(st, ui, `gnd:${p.id}:${ci}`); click(st, ui, `gnd:${p.id}:${ci}`);
  check(a.gear.carry === cart && at((it) => it.item === cart) < 0, `clicked twice: ${a.name.split(" ")[0]} pushes it (${ui.invMsg})`);
  check(/Carried \(hands\)<\/b> pushes the hand cart/.test(inventoryModal(st, ui) || ""), "and their Carried (hands) row says so");
  // At a base there is no ground box (things go in the armory there).
  const hb = atBase(st, hub(st).id)[0];
  check(!/On the ground here/.test(inventoryModal(st, { inv: { sid: hb.id } }) || ""), "at a base: no ground box");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
