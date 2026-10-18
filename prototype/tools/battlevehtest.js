// Battle map conveniences (ui/combat.js) on stub canvases:
// - The camera follows the next survivor: when the selected one runs out of actions and the turn passes to the next
//   one with actions left, the view centers on them (not while the AI plays your side, not in the enemy's turn).
// - The vehicle in a field battle (sim/raidloot.js trunkVehicle): a click on the team's car, or N / the Vehicle button,
//   opens its trunk in the search window, from next to it only; supplies move between a survivor and the trunk with
//   the trunk's limits and the hauling time; not from afar, not without a vehicle, not in the enemy's turn; what is
//   carried loose still comes home in the cargo.
// Usage: node tools/battlevehtest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, CELL, unitAt } from "../src/sim/combat.js";
import { launchExpedition, poolLoad } from "../src/sim/parties.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { newItem } from "../src/sim/inventory.js";
import * as RL from "../src/sim/raidloot.js";
import { SUPPLIES } from "../src/sim/data.js";
import { groundEnd } from "../src/sim/ground.js";
import { battles } from "./isobattles.js";

const seed0 = Number(process.argv[2] || 21);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
registerCombatHandler("bvtest", () => {});

const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const INV = await import("../src/ui/inventory.js");
const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
  get: (o, k) => (k in o ? o[k] : () => {}),
});
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
const cui = UI.cui;
const draw = (st) => UI.drawCombat(st, 1e9);
// Where isoCenterOn(b, x, y) points the camera.
const aimAt = (b, x, y) => { const keep = ISO.iso.target; ISO.isoCenterOn(b, x, y); const t = ISO.iso.target; ISO.iso.target = keep; return t; };
const same = (a, c) => !!a && !!c && Math.abs(a.cx - c.cx) < 1e-6 && Math.abs(a.cy - c.cy) < 1e-6;

// ---------- 1. the camera follows the next survivor ----------
console.log("The camera follows the next survivor");
{
  const { st, b } = battles(seed0, ["field-town"])[0];
  draw(st);
  UI.renderCombatScreen(st);
  const mine = b.units.filter((u) => u.side === "player" && u.vol == null && !u.dead && !u.off);
  check(mine.length >= 2 && b.phase === "player", `a field battle in your turn with ${mine.length} of yours`);
  const [a, nx] = [mine.find((u) => u.id === cui.sel) || mine[0], null];
  cui.sel = a.id;
  ISO.iso.target = null;
  a.ap = 0; // out of actions
  UI.renderCombatScreen(st);
  const next = b.units.find((u) => u.id === cui.sel);
  check(next && next.id !== a.id && next.ap > 0, `the turn passes to the next one with actions (${next && next.name})`);
  check(same(ISO.iso.target, aimAt(b, next.x, next.y)), "the camera centers on them");
  // Still actions: no jump.
  ISO.iso.target = null;
  UI.renderCombatScreen(st);
  check(ISO.iso.target === null && cui.sel === next.id, "while the selected one has actions, the camera stays put");
  // A pick by hand (Tab) still only brings an off-screen one into view: unchanged.
  // The enemy's turn: nobody is picked for you and the camera is left alone.
  b.phase = "enemy";
  next.ap = 0;
  ISO.iso.target = null;
  UI.renderCombatScreen(st);
  check(ISO.iso.target === null, "not in the enemy's turn");
  b.phase = "player";
  void nx;
}

// ---------- 2. the vehicle in a field battle ----------
console.log("The vehicle's trunk in a field battle");
function fieldWithCar(seed, type = "sedan") {
  for (let i = 0; i < 40; i++) {
    const st = createWorld({ seed: seed * 100 + i, factionCount: 6 });
    st.started = true; st.cards.length = 0; st.crashNext = 1e9;
    const h = hub(st);
    for (let k = 0; k < 3; k++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
    for (const s of atBase(st, h.id)) { s.health = 100; s.traits = []; if (!s.gear.weapon) s.gear.weapon = newItem("pistol"); }
    const tile = st.tiles.find((t) => t.id !== h.tile && !t.loc && t.road && !t.bridge && t.terrain !== "water" && st.grid.distance(t.id, h.tile) > 1);
    if (!tile) continue;
    const veh = type ? createVehicle(st, type, { kind: "base", baseId: h.id }, { fuel: 30, count: 3 }) : null;
    const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 3).map((s) => s.id), dest: tile.id, mission: "move", stance: "normal", vehicleId: veh ? veh.id : null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    st.combat = createBattle(st, { tile: tile.id, partyId: p.id, enemy: { kind: "zombies", count: 2, power: 2 }, ambush: null, canRetreat: true, handler: "bvtest", context: {} });
    if (type && !st.combat.vehicle) continue;
    return { st, b: st.combat, p };
  }
  throw new Error("no field battle");
}
// Put u on a free walkable cell next to the vehicle (or far from it).
function place(b, u, near) {
  const v = b.vehicle;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const d = Math.max(x < v.x ? v.x - x : x >= v.x + v.w ? x - (v.x + v.w - 1) : 0, y < v.y ? v.y - y : y >= v.y + v.h ? y - (v.y + v.h - 1) : 0);
    if ((near ? d === 1 : d > 6) && CELL[b.cells[y * b.w + x].k].walk && b.cells[y * b.w + x].k !== "vehicle" && (!unitAt(b, x, y) || unitAt(b, x, y) === u)) { u.x = x; u.y = y; return true; }
  }
  return false;
}
// A screen point that picks one of the vehicle's cells.
function vehiclePx(b) {
  for (let py = 0; py < 900; py += 3) for (let px = 0; px < 1600; px += 3) {
    const c = ISO.isoPick(b, px, py);
    if (c && b.cells[c.y * b.w + c.x].k === "vehicle") return [px, py];
  }
  return null;
}
{
  const { st, b, p } = fieldWithCar(seed0);
  draw(st);
  UI.renderCombatScreen(st);
  const u = b.units.find((x) => x.id === cui.sel);
  check(!!b.vehicle && !b.raid && !!RL.trunkVehicle(st, b), "a field battle with the team's car on the map has a trunk");
  check(RL.trunkVehicle(st, b) && RL.trunkSpace(st, b) != null, "its room is known (cargo room less what is carried loose)");
  // From afar: no window.
  place(b, u, false);
  ISO.isoCenterOn(b, b.vehicle.x, b.vehicle.y, false);
  draw(st);
  let at = vehiclePx(b);
  check(!!at, "the car can be clicked on the map");
  cui.lootReq = null;
  if (at) UI.combatClick(st, at[0], at[1]);
  check(!cui.lootReq && /Walk next to the vehicle/.test(cui.msg), "from afar a click on it says to walk there");
  UI.combatAction(st, "cb-act", { v: "vehicle" });
  check(!cui.lootReq, "and N does not open it from afar");
  // Next to it: the click opens the trunk window (no action spent).
  place(b, u, true);
  cui.sel = u.id;
  draw(st);
  at = vehiclePx(b);
  const ap0 = u.ap;
  if (at) UI.combatClick(st, at[0], at[1]);
  check(cui.lootReq && cui.lootReq.uid === u.id && cui.lootReq.box == null && u.ap === ap0, "next to it a click opens the vehicle (free)");
  const ui = {};
  INV.takeLootReq(st, ui);
  check(ui.inv && ui.inv.raid && ui.inv.uid === u.id, "the search window opens on the survivor");
  const html = INV.inventoryModal ? INV.inventoryModal(st, ui) : "";
  check(typeof html === "string" && html.includes(`trunk:${p.id}:list`) && /Vehicle:/.test(html), "the window shows the vehicle's trunk");
  // The panel's Vehicle button (N) opens it too.
  check(/data-v="vehicle"(?![^>]*disabled)/.test(UI.renderCombatScreen(st)), "the panel has an enabled Vehicle button next to it");
  cui.lootReq = null;
  UI.combatAction(st, "cb-act", { v: "vehicle" });
  check(cui.lootReq && cui.lootReq.uid === u.id, "N / Vehicle opens it");
  cui.lootReq = null;
  // Out of the trunk onto the survivor, and back: quantities and totals stay whole.
  RL.HAUL.free = 1e9;
  const food0 = Object.keys(p.supplies).find((k) => (p.supplies[k] || 0) >= 2 && k !== "ammo") || "water";
  const total = () => Math.floor(p.supplies[food0] || 0) + Math.floor(p.cargo.supplies[food0] || 0) + Math.floor(u.haul.sup[food0] || 0);
  const t0 = total(), space0 = RL.trunkSpace(st, b), pool0 = poolLoad(p);
  let msg = RL.raidMove(st, u.id, `trunk:${p.id}:sup:${food0}`, `haul:${u.id}:list`, 2);
  check(Math.floor(u.haul.sup[food0] || 0) === 2 && total() === t0, `2 ${food0} out of the trunk onto ${u.name.split(" ")[0]}, none made or lost (${msg || "ok"})`);
  check(poolLoad(p) < pool0 && Math.abs(RL.trunkSpace(st, b) - space0) < 1e-6, "the trunk is lighter; its room is the same (what is carried loose rides home in it)");
  msg = RL.raidMove(st, u.id, `haul:${u.id}:sup:${food0}`, `trunk:${p.id}:list`);
  check(!(u.haul.sup[food0] >= 1) && total() === t0, `and back in (${msg || "ok"})`);
  // Out of the trunk only what the survivor can carry: their max load holds.
  const w = SUPPLIES.scrap.weight, N = Math.floor((RL.trunkSpace(st, b) - 1) / w);
  p.cargo.supplies.scrap = (p.cargo.supplies.scrap || 0) + N;
  const scrap0 = p.cargo.supplies.scrap, roomKg = RL.personalLoad(st, u).room;
  check(N * w > roomKg, `the car holds more scrap (${N}, ${Math.round(N * w)} kg) than ${u.name.split(" ")[0]} can carry (${Math.round(roomKg)} kg)`);
  msg = RL.raidMove(st, u.id, `trunk:${p.id}:sup:scrap`, `haul:${u.id}:list`, N);
  const took = Math.floor(u.haul.sup.scrap || 0);
  check(took > 0 && took < N && RL.personalLoad(st, u).room >= -1e-6 && p.cargo.supplies.scrap + took === scrap0, `only what fits on them comes out (${took} of ${N}; ${msg})`);
  RL.raidMove(st, u.id, `haul:${u.id}:sup:scrap`, `trunk:${p.id}:list`);
  check(!(u.haul.sup.scrap >= 1) && p.cargo.supplies.scrap === scrap0, "and all of it goes back in");
  p.cargo.supplies.scrap -= N;
  // From afar the trunk cannot be used.
  place(b, u, false);
  msg = RL.raidMove(st, u.id, `trunk:${p.id}:sup:${food0}`, `haul:${u.id}:list`, 1);
  check(!(u.haul.sup[food0] >= 1) && /at the vehicle/.test(msg), `away from the car nothing comes out (${msg})`);
  // The hauling time holds.
  RL.HAUL.free = 0;
  place(b, u, true);
  u.ap = 0; u.hauledKg = 0; u.haulTurn = b.turn;
  msg = RL.raidMove(st, u.id, `trunk:${p.id}:sup:${food0}`, `haul:${u.id}:list`, 1);
  check(!(u.haul.sup[food0] >= 1) && /No time/.test(msg), `no actions left: no hauling (${msg})`);
  RL.HAUL.free = 8;
  // In the enemy's turn the map is not clickable.
  u.ap = 2;
  b.phase = "enemy";
  cui.lootReq = null;
  draw(st);
  at = vehiclePx(b);
  if (at) UI.combatClick(st, at[0], at[1]);
  check(!cui.lootReq, "not in the enemy's turn");
  b.phase = "player";
  // A burnt-out wreck is not opened (its cargo goes up with it).
  b.vehicle.blownUp = true;
  place(b, u, true);
  cui.lootReq = null;
  UI.combatAction(st, "cb-act", { v: "vehicle" });
  msg = RL.raidMove(st, u.id, `trunk:${p.id}:sup:${food0}`, `haul:${u.id}:list`, 1);
  check(!cui.lootReq && /wreck/.test(cui.msg) && !(u.haul.sup[food0] >= 1) && !RL.trunkVehicle(st, b), `a blown-up car is not opened (${cui.msg}; ${msg})`);
  check(/data-v="vehicle" disabled data-tip="[^"]*burnt-out wreck/.test(UI.renderCombatScreen(st)), "and its Vehicle button is greyed: a burnt-out wreck");
  b.vehicle.blownUp = false;
  // What is carried loose still comes home in the cargo.
  u.haul.sup[food0] = 3;
  const cargo0 = p.cargo.supplies[food0] || 0;
  groundEnd(st, b, "victory");
  check((p.cargo.supplies[food0] || 0) === cargo0 + 3, "what is carried loose joins the team's cargo at the end");
  st.combat = null;
}
{
  const { st, b } = fieldWithCar(seed0 + 1, null);
  check(!b.vehicle && !RL.trunkVehicle(st, b), "on foot: no trunk");
  draw(st);
  check(/data-v="vehicle" disabled data-tip="[^"]*on foot/.test(UI.renderCombatScreen(st)), "and its Vehicle button is greyed: you came on foot");
  st.combat = null;
}
{
  // A raid keeps its own vehicle rules.
  const { st, b } = battles(seed0, ["raid"])[0];
  check(RL.trunkVehicle(st, b) === RL.raidVehicle(st, b), "a raid's trunk is the raid's vehicle, as before");
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
