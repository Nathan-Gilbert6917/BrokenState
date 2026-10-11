// Headless checks for the team inventory and moving goods between a team and a base (sim/teaminv.js, ui/teaminv.js):
// listing a team's inventories (members' kit, the cargo, packed and found supplies), dropping off picked items and
// counts into a base (fresh game and the worm's eggs with the food, bodies in the car), loading from the base onto a
// member and into the cargo (rounds by calibre, magazines, boxes keep what they are), refusing what the team cannot
// carry (an item, a person's own max load, supplies cut to what fits, a worn pack the load needs), only at your own
// base, a save and load round trip, and a render smoke test of the window, the team panel's buttons and the base's
// Teams here card.
// Usage: node tools/teaminvtest.js [seed]
import { meatIn, meatAt } from "../src/sim/hunting.js";
import { wormMeatAt, wormMeatIn, wormVegAt } from "../src/sim/worm.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, planPath, partyTile, poolLoad, partyCapacity, partyMembers } from "../src/sim/parties.js";
import { vehiclesAtBase } from "../src/sim/vehicles.js";
import { newItem, stripAll, itemLoad, packOf } from "../src/sim/inventory.js";
import { wornLoad, maxLoad } from "../src/sim/load.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { teamBase, transferProblem, teamsAtBase, teamHoldings, baseHoldings, dropOff, dropAllCargo, dropAllSupplies, loadFromBase } from "../src/sim/teaminv.js";
import { SUPPLIES } from "../src/sim/data.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { water: 300, fuel: 100, meds: 20, parts: 10, scrap: 100, a_9mm_fmj: 200, a_556_fmj: 120 }); setFood(hub(state), 300);
  return state;
}
function tileNear(state, from, d, d2) {
  for (const t of state.tiles) {
    const dist = state.grid.distance(from, t.id);
    if (dist < d || dist > d2 || t.terrain === "water" || state.bases.some((b) => b.tile === t.id)) continue;
    if (planPath(state, from, t.id, false)) return t.id;
  }
  return null;
}
// A team of `n` (no traits, no gear: the base numbers), stood on `tile` and waiting.
function team(state, n, { vehicle = false, tile = hub(state).tile } = {}) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, n);
  for (const s of crew) { s.traits = []; stripAll(s); }
  let vehicleId = null;
  if (vehicle) { const v = vehiclesAtBase(state, h.id).find((x) => x.type !== "bike"); v.fuel = 30; v.condition = 100; vehicleId = v.id; }
  const dest = tileNear(state, h.tile, 2, 3);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId, supplies: { food: 4, water: 4 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = [];
  return p;
}
const armoryLoc = (b, it) => `armory:${b.id}:list:${b.armory.indexOf(it)}`;

// ---------------------------------------------------------------------------------------------------------
section("Where: only a team of yours standing on your base's tile");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2);
  check(teamBase(state, p) === h, "a team on the hub's tile is at the hub");
  check(transferProblem(state, p) === "", `no problem at the hub (${transferProblem(state, p)})`);
  check(teamsAtBase(state, h).includes(p), "the base lists the team as standing on its tile");
  const away = team(state, 1, { tile: tileNear(state, h.tile, 2, 3) });
  check(!teamBase(state, away) && /not at one of your bases/.test(transferProblem(state, away)), "a team away from your bases cannot drop off or load");
  check(!teamsAtBase(state, h).includes(away), "the base does not list a team elsewhere");
  const r = dropOff(state, away, { supplies: { food: 1 } });
  check(!r.moved.length && /not at/.test(r.text), "drop off away from a base is refused");
  state.combat = { over: false };
  check(/battle/.test(transferProblem(state, p)), "nothing moves during a battle");
  state.combat = null;
}

section("Listing: members' kit, the cargo and the supplies");
{
  const state = mk();
  const p = team(state, 2, { vehicle: true });
  const [a, b] = partyMembers(state, p);
  a.gear.weapon = newItem("pistol"); a.gear.backpack = newItem("backpack"); a.pockets[1] = newItem("knife");
  packOf(a)[2] = newItem("bandagekit");
  b.gear.armor = newItem("plate");
  const mag = newItem("mag_glock_17"); mag.load = "hp";
  b.pockets[0] = mag;
  const box = newItem("primers"); box.dur = 37;
  p.cargo.gear.push(newItem("crowbar"), box);
  setFood(p.cargo, 6); p.cargo.supplies.a_9mm_fmj = 30;
  const H = teamHoldings(state, p);
  const am = H.members.find((m) => m.s === a), bm = H.members.find((m) => m.s === b);
  check(H.members.length === 2, "both members listed");
  check(am.spots.some((x) => x.loc === `s:${a.id}:weapon` && x.item.key === "pistol"), "the gun in hand is listed with its location");
  check(am.spots.some((x) => x.loc === `s:${a.id}:pocket:1`) && am.spots.some((x) => x.loc === `s:${a.id}:pack:2` && x.item.key === "bandagekit"), "pockets and pack slots are listed");
  check(bm.spots.some((x) => x.where === "insert"), "a worn carrier's plates are listed");
  check(bm.spots.some((x) => x.item === mag), "a magazine is listed as an item");
  check(near(am.worn, wornLoad(a)) && am.max === maxLoad(a), "each member's worn load and max load");
  check(H.cargo.vehicle && /team cargo/.test(H.cargo.name), `the vehicle's cargo is named (${H.cargo.name})`);
  check(H.cargo.gear.length === 2 && H.cargo.gear[1].item === box && H.cargo.gear[1].loc === `cargo:${p.id}:list:1`, "the cargo's items with their locations");
  const fr = H.cargo.supplies.f_rationbar; // food by type (sim/foods.js): the hub's ration bars, packed (whole bars) and found
  check(fr && fr.packed === 4 && fr.found === 5 && fr.all === 9, `food: packed and found apart and together, by item (${JSON.stringify(fr)})`);
  check(H.cargo.supplies.a_9mm_fmj && H.cargo.supplies.a_9mm_fmj.found === 30, "rounds by calibre and type");
  check(near(H.load, poolLoad(p)) && near(H.cap, partyCapacity(state, p)), "load and capacity");
  const B = baseHoldings(state, hub(state));
  check(near(food(B), 300 - food(p)) && B.stock.a_9mm_fmj === 200, "the base's stores");
}

section("Drop off: picked items and counts into the base");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2, { vehicle: true });
  const [a] = partyMembers(state, p);
  const knife = newItem("knife"); knife.quality = 0.42; a.pockets[0] = knife;
  const mag = newItem("mag_glock_17"); mag.load = "hp"; a.pockets[1] = mag;
  const box = newItem("primers"); box.dur = 37;
  const crow = newItem("crowbar");
  p.cargo.gear.push(crow, box);
  setFood(p.cargo, 6); p.cargo.supplies.a_9mm_fmj = 30; p.cargo.supplies.scrap = 5;
  const before = { food: food(h), a9: h.stock.a_9mm_fmj, armory: h.armory.length, packed: food(p) };
  const r = dropOff(state, p, { items: [`s:${a.id}:pocket:0`, `s:${a.id}:pocket:1`, `cargo:${p.id}:list:1`], supplies: { food: 8, a_9mm_fmj: 12 } });
  check(r.moved.length === 5 && !r.refused.length, `moved: ${r.text}`);
  check(!a.pockets[0] && !a.pockets[1] && h.armory.includes(knife) && h.armory.includes(mag) && h.armory.includes(box), "the picked items left the team and are in the armory");
  check(knife.quality === 0.42 && mag.load === "hp" && box.dur === 37, "condition, a magazine's load and a box's count go with them");
  check(p.cargo.gear.length === 1 && p.cargo.gear[0] === crow, "the item not picked stays in the cargo");
  check(near(food(h), before.food + 8) && near(food(p.cargo), 0) && near(food(p), before.packed - 2), "8 days of food: the 6 found first, then 2 of the packed");
  check(h.stock.a_9mm_fmj === before.a9 + 12 && p.cargo.supplies.a_9mm_fmj === 18, "12 rounds of 9mm FMJ by their own key");
  check(p.cargo.supplies.scrap === 5, "a supply not picked stays");
  const r2 = dropOff(state, p, { supplies: { meds: 3 } });
  check(!r2.moved.length && /Nothing/.test(r2.text), "a supply the team does not have moves nothing");
}

section("Drop off: fresh game, the worm's eggs, bodies, all cargo, all supplies");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2, { vehicle: true });
  setFood(p.cargo, 4); addDays(p.cargo, 4, "f_venison"); addDays(p.cargo, 2, "f_venison", { egg: true });
  const meat0 = meatAt(h), egg0 = wormMeatAt(h);
  dropOff(state, p, { supplies: { meat: 4 } }); // days of raw meat (carry.js hold key)
  check(near(meatAt(h) - meat0, 4) && near(meatIn(p.cargo), 2) && near(food(p.cargo), 6), `fresh game arrives as fresh game (base +${meatAt(h) - meat0}, team ${meatIn(p.cargo)} left)`);
  check(near(wormMeatAt(h) - egg0 + wormMeatIn(p.cargo), 2, 1e-6), `the worm's eggs go with their meat (${wormMeatAt(h) - egg0} in, ${wormMeatIn(p.cargo)} still carried)`);
  addDays(p.cargo, 2, "f_roots", { egg: true });
  p.cargo.bodies = [{ id: 999, name: "Dale Cooper", items: [newItem("knife")], supplies: {}, worm: false }];
  p.cargo.gear.push(newItem("crowbar"));
  p.cargo.supplies.scrap = 3;
  const r = dropAllCargo(state, p);
  check(!p.cargo.gear.length && near(food(p.cargo) || 0, 0) && near(p.cargo.supplies.scrap || 0, 0), `all cargo: gear and found supplies gone (${r.text})`);
  check((h.bodies || []).some((x) => x.name === "Dale Cooper") && !p.cargo.bodies.length, "a body in the car is laid out at the base");
  check(near(meatIn(p.cargo), 0) && wormVegAt(h).forage >= 2 - 1e-9, "the rest of the game and the forage with eggs go in as at a homecoming");
  check(food(p) >= 4 && p.supplies.water === 4, "the packed supplies stay with Drop off all cargo");
  dropAllSupplies(state, p);
  check(near(food(p), 0) && near(p.supplies.water, 0), "Drop off all supplies empties the packed ones too");
}

section("Drop off: a worn pack the load needs stays");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 1);
  const [a] = partyMembers(state, p);
  const pack = newItem("backpack");
  a.gear.backpack = pack;
  const cap = partyCapacity(state, p);
  p.cargo.supplies.scrap = Math.floor((cap - poolLoad(p)) / SUPPLIES.scrap.weight); // full to the limit with the pack on
  const r = dropOff(state, p, { items: [`s:${a.id}:backpack`] });
  check(a.gear.backpack === pack && !h.armory.includes(pack) && r.refused.length === 1, `refused: ${r.refused[0] || "(none)"}`);
  p.cargo.supplies.scrap = 0;
  const r2 = dropOff(state, p, { items: [`s:${a.id}:backpack`] });
  check(!a.gear.backpack && h.armory.includes(pack) && r2.moved.length === 1, "with room to spare the pack goes in");
}

section("Load: onto a member and into the vehicle");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2, { vehicle: true });
  const [a, b] = partyMembers(state, p);
  const pistol = newItem("pistol"); pistol.quality = 0.77;
  const mag = newItem("mag_glock_17"); mag.load = "hp";
  const crow = newItem("crowbar");
  const bike = newItem("bicycle");
  h.armory.push(pistol, mag, crow, bike);
  const r = loadFromBase(state, p, { items: [armoryLoc(h, pistol), armoryLoc(h, mag)] }, a.id);
  check(a.gear.weapon === pistol && pistol.quality === 0.77, `the pistol into ${a.name.split(" ")[0]}'s hands, condition kept (${r.text})`);
  check(a.pockets.includes(mag) && mag.load === "hp", "the magazine into a pocket, its load kept");
  check(!h.armory.includes(pistol) && !h.armory.includes(mag), "both left the armory");
  const r2 = loadFromBase(state, p, { items: [armoryLoc(h, bike)] }, b.id);
  check(h.armory.includes(bike) && r2.refused.length === 1 && /no free place/.test(r2.refused[0]), `a bicycle does not go on a person: ${r2.refused[0]}`);
  const r3 = loadFromBase(state, p, { items: [armoryLoc(h, crow), armoryLoc(h, bike)] }, "cargo");
  check(p.cargo.gear.includes(crow) && p.cargo.gear.includes(bike) && r3.moved.length === 2, `the crowbar and the bike into the vehicle (${r3.text})`);
  const food0 = food(p), a9 = h.stock.a_9mm_fmj;
  const r4 = loadFromBase(state, p, { supplies: { food: 10, a_9mm_fmj: 50, meds: 2 } }, "cargo");
  check(food(p) >= food0 + 10 && food(p) < food0 + 10 + 1.21 && p.supplies.a_9mm_fmj === 50 && p.supplies.meds === 2, `supplies into the packed supplies (${r4.text}; whole ration bars)`);
  check(h.stock.a_9mm_fmj === a9 - 50, "rounds left the stores by their own key");
  const r5 = loadFromBase(state, p, { supplies: { meds: 1000 } }, "cargo");
  check(h.stock.meds === 0 && p.supplies.meds === 20 && !r5.refused.length, "asking for more than the stores have takes what there is");
  const stranger = atBase(state, h.id)[0];
  const r6 = loadFromBase(state, p, { items: [] }, stranger.id);
  check(/not on the team/.test(r6.text), "a person not on the team is not a target");
}

section("Load: refusing what the team cannot carry");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 1); // on foot
  const [a] = partyMembers(state, p);
  const room = () => partyCapacity(state, p) - poolLoad(p);
  p.cargo.supplies.scrap = Math.floor((room() - 1) / SUPPLIES.scrap.weight); // about a kilo or two left
  const anvil = newItem("sledge");
  h.armory.push(anvil);
  check(itemLoad(anvil) > room(), `the sledgehammer (${itemLoad(anvil)} kg) is more than the room left (${room().toFixed(2)} kg)`);
  const r = loadFromBase(state, p, { items: [armoryLoc(h, anvil)] }, "cargo");
  check(h.armory.includes(anvil) && !p.cargo.gear.includes(anvil) && /No room/.test(r.refused[0] || ""), `refused into the cargo: ${r.refused[0]}`);
  const r2 = loadFromBase(state, p, { items: [armoryLoc(h, anvil)] }, a.id);
  check(h.armory.includes(anvil) && a.gear.weapon !== anvil && r2.refused.length === 1, `refused onto the person: ${r2.refused[0]}`);
  const before = { load: poolLoad(p), stock: h.stock.water };
  const r3 = loadFromBase(state, p, { supplies: { water: 50 } }, "cargo");
  const got = p.supplies.water - 4;
  check(got >= 0 && got < 50 && poolLoad(p) <= partyCapacity(state, p) + 1e-9 && h.stock.water === before.stock - got, `water cut to what fits: ${got} of 50 (${r3.refused[0] || ""})`);
  // A person's own max load: plates and armour piled on one walker.
  p.cargo.supplies.scrap = 0; p.supplies.water = 0;
  const q = team(state, 2, { vehicle: true });
  const [c] = partyMembers(state, q);
  c.gear.armor = newItem("plate"); c.gear.backpack = newItem("backpack");
  for (let i = 0; i < packOf(c).length; i++) packOf(c)[i] = newItem("steelplate");
  const plate = newItem("sledge");
  h.armory.push(plate);
  c.gear.weapon = null;
  c.traits = ["badback"]; // a 28 kg max load
  c.gear.tool = newItem("tirevest"); // 5 kg more carried (set straight in: only the weight matters here)
  const heavy = wornLoad(c) + itemLoad(plate) > maxLoad(c);
  check(heavy, `the case is heavy enough (${wornLoad(c).toFixed(1)} + ${itemLoad(plate)} of ${maxLoad(c)} kg)`);
  const r4 = loadFromBase(state, q, { items: [armoryLoc(h, plate)] }, c.id);
  check((h.armory.includes(plate) && /too heavy/.test(r4.refused[0] || "")), `nobody wears more than their max load (${wornLoad(c).toFixed(1)}/${maxLoad(c)} kg: ${r4.refused[0] || r4.text})`);
}

section("Save and load");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2, { vehicle: true });
  const [a] = partyMembers(state, p);
  const knife = newItem("knife"); knife.quality = 0.5;
  a.pockets[0] = knife;
  setFood(p.cargo, 3);
  dropOff(state, p, { items: [`s:${a.id}:pocket:0`], supplies: { food: 3 } });
  const mag = newItem("mag_glock_17"); mag.load = "hp";
  h.armory.push(mag);
  loadFromBase(state, p, { items: [armoryLoc(h, mag)], supplies: { a_9mm_fmj: 20 } }, a.id);
  const text = saveToString(state);
  const B = loadFromString(text);
  const hb = hub(B), pb = B.parties.find((x) => x.id === p.id);
  const ab = pb && partyMembers(B, pb).find((s) => s.id === a.id);
  check(!!pb && teamBase(B, pb) === hb, "the team is still at the hub after a load");
  check(hb.armory.some((g) => g.key === "knife" && g.quality === 0.5), "the dropped knife is in the armory, condition kept");
  check(!!ab && ab.pockets.some((g) => g && g.key === "mag_glock_17" && g.load === "hp"), "the loaded magazine is in the pocket, its load kept");
  check(pb.supplies.a_9mm_fmj === 20 && hb.stock.a_9mm_fmj === h.stock.a_9mm_fmj && food(hb) === food(h), "supplies on both sides as saved");
  const r = dropOff(B, pb, { items: [`s:${a.id}:pocket:${ab.pockets.findIndex((g) => g && g.key === "mag_glock_17")}`], supplies: { a_9mm_fmj: 20 } });
  check(r.moved.length === 2 && hb.armory.some((g) => g.key === "mag_glock_17") && !pb.supplies.a_9mm_fmj, `transfers work on the loaded world (${r.text})`);
  check(saveToString(B).length > 0, "the world saves again after");
}

section("Screens");
{
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => "data:image/png;base64," }) };
  const { teamInvModal, teamInvBar, teamsHereCard, TEAMINV_ACTIONS, TEAMINV_CHANGE } = await import("../src/ui/teaminv.js");
  const { INV_ACTIONS } = await import("../src/ui/inventory.js");
  const state = mk();
  const h = hub(state);
  const p = team(state, 2, { vehicle: true });
  const [a, b] = partyMembers(state, p);
  a.pockets[0] = newItem("knife");
  p.cargo.gear.push(newItem("crowbar"));
  setFood(p.cargo, 5);
  const ui = { inv: null, invSel: null, invMsg: "" };
  check(/Team inventory/.test(teamInvBar(state, p)) && /Drop off at/.test(teamInvBar(state, p)) && /Load from/.test(teamInvBar(state, p)), "the team panel offers the inventory, Drop off and Load at the hub");
  check(/Load team/.test(teamsHereCard(state, h)), "the base's Armory tab lists the team with Load and Drop off");
  TEAMINV_ACTIONS["ti-open"](state, ui, { id: String(p.id), tab: "team" });
  let html = teamInvModal(state, ui) || "";
  check(/Team inventory/.test(html) && html.includes(`s:${a.id}:pocket:0`) && html.includes(`s:${b.id}:weapon`) && html.includes(`cargo:${p.id}:list`), "the team tab shows every member's doll and the cargo");
  check(!/data-action="inv-click"/.test(html) && /data-action="ti-click"/.test(html), "its clicks go through the team window");
  TEAMINV_ACTIONS["ti-click"](state, ui, { loc: `s:${a.id}:pocket:0` });
  TEAMINV_ACTIONS["ti-click"](state, ui, { loc: `s:${b.id}:pocket:2` });
  check(b.pockets[2] && b.pockets[2].key === "knife" && !a.pockets[0], "a click and a click move a knife from one member to another");
  TEAMINV_ACTIONS["ti-tab"](state, ui, { tab: "drop" });
  html = teamInvModal(state, ui) || "";
  check(/Drop off picked/.test(html) && /data-action="ti-pick"/.test(html) && /Drop off all cargo/.test(html), "the drop off view: pickable team items and the quick buttons");
  TEAMINV_ACTIONS["ti-pick"](state, ui, { loc: `cargo:${p.id}:list:0` });
  TEAMINV_ACTIONS["ti-sup"](state, ui, { key: "f_rationbar", side: "team" }); // food by type: the item
  TEAMINV_CHANGE["ti-qty"](state, ui, { dataset: { key: "f_rationbar" }, value: "3" });
  const food0 = food(h);
  TEAMINV_ACTIONS["ti-go"](state, ui, {});
  check(h.armory.some((g) => g.key === "crowbar") && near(food(h), food0 + 3.6), `picked and dropped off (3 ration bars, 3.6 days): ${ui.invMsg}`);
  TEAMINV_ACTIONS["ti-tab"](state, ui, { tab: "load" });
  html = teamInvModal(state, ui) || "";
  check(/Load picked/.test(html) && /data-action="ti-target"/.test(html), "the load view: targets on the team, pickable base items");
  const crowLoc = armoryLoc(h, h.armory.find((g) => g.key === "crowbar"));
  TEAMINV_ACTIONS["ti-pick"](state, ui, { loc: crowLoc });
  TEAMINV_ACTIONS["ti-target"](state, ui, { v: String(a.id) });
  TEAMINV_ACTIONS["ti-go"](state, ui, {});
  check(partyMembers(state, p)[0].gear.tool?.key === "crowbar" || [...a.pockets, ...(packOf(a) || [])].some((g) => g && g.key === "crowbar") || a.gear.weapon?.key === "crowbar", `the crowbar onto ${a.name.split(" ")[0]}: ${ui.invMsg}`);
  INV_ACTIONS["inv-close"](state, ui, {});
  check(!ui.inv, "Close closes it");
  const away = team(state, 1, { tile: tileNear(state, h.tile, 2, 3) });
  check(!/Drop off/.test(teamInvBar(state, away)) && /Team inventory/.test(teamInvBar(state, away)), "away from a base: the inventory only");
  TEAMINV_ACTIONS["ti-open"](state, ui, { id: String(away.id), tab: "drop" });
  html = teamInvModal(state, ui) || "";
  check(ui.inv.tab === "team" && /Team inventory/.test(html), "asking for Drop off away from a base shows the inventory");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
