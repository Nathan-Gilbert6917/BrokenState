// The hands in a fight (the user's ask, 2026-10-19; src/sim/carry.js, raidloot.js, ground.js, combat.js): whatever a
// survivor carries in the carried part of the inventory (the search window's Carried column, a load or a bag in the
// arms) fills their hands: no shooting, reloading, climbing a window, opening or closing a door, and a closed door
// stays shut to their move, until it is set down (Drop carried: free, a ground pile) or stowed; two different things
// carried are both hands full and nothing more is taken from a container, the ground or a teammate (more of a kind
// already in hand still joins it; their own pack and pockets are still theirs to use); the indicator (the squad strip's
// chip, the roster line); half cover vaulted as part of a move (3 tiles, 6 with the hands full, never diagonally, the
// cover cell in the path); Set over cover (1 action, facing the cover: the load on the far side, picked up from the
// ground by anyone after); the raid bot sets its finds down to fight and treats both hands full as a full load.
// Usage: node tools/handstest.js [seed]   ("ok" / "FAIL" lines; exits 1 on a failure)
import { faceToward } from "../src/sim/vision.js";
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, combatAct, CELL, VAULT, registerCombatHandler, unitAt, reachable, pathTo, vaultsNear, vaultCost, canVault, canFire, fireRefusal, reloadRefusal, autoPlayerTurn, isRanged } from "../src/sim/combat.js";
import { newItem } from "../src/sim/inventory.js";
import * as RL from "../src/sim/raidloot.js";
import * as C from "../src/sim/carry.js";
import { groundAt, pilesNear, pileCount, pickUpFromGround } from "../src/sim/ground.js";
import { battles } from "./isobattles.js";

const seed = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
registerCombatHandler("handstest", () => {});
const W = (b) => b.w;
const at = (b, x, y) => (x >= 0 && y >= 0 && x < b.w && y < b.h ? b.cells[y * b.w + x] : null);
const free = (b, x, y) => { const c = at(b, x, y); return !!c && c.k === "open" && !(c.h) && !unitAt(b, x, y); };

// A raid on a town-like site with a crew of 3 from the hub (as tools/raidloottest.js), with a few of the dead about.
function raid() {
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: seed * 100 + i, factionCount: 6 });
    st.cards.length = 0;
    st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["pharmacy", "store", "gunstore", "police", "warehouse", "house", "gas"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    for (const s of crew) { s.traits = []; s.gear.weapon = newItem("pistol"); }
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "handstest", enemy: { kind: "zombies", count: 3, power: 2, groups: [] }, raid: { heat0: 0 }, context: {} };
    st.combat = createBattle(st, setup);
    const b = st.combat;
    if (b.raid.choose) b.raid.choose = null;
    if (!b.raid.containers.some((c) => c.kind !== "body" && !c.lock)) continue;
    if (!b.units.some((e) => e.side === "enemy")) continue;
    return { st, b, p, crew };
  }
  throw new Error("no raid map");
}
const players = (b) => b.units.filter((u) => u.side === "player");
function standNext(b, u, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (!free(b, nx, ny)) continue;
    u.x = nx; u.y = ny;
    faceToward(u, x, y);
    return true;
  }
  return false;
}
function boxWith(b, u, sup, gear = []) {
  const box = b.raid.containers.find((c) => c.kind !== "body" && !c.lock && standNext(b, u, c.x, c.y));
  box.contents = { sup: { ...sup }, gear };
  box.searched = false;
  return box;
}
const fresh = (b, u) => { u.ap = 2; u.haulTurn = b.turn; u.hauledKg = 0; u.jam = null; u.vaulted = 0; };
// A spot with `rows` open cells in three columns side by side (x, x+1, x+2), the unit put at the middle row of the
// first column. Returns { x, y } of the unit (the line of cover goes at x+1) or null.
function openSpot(b, u, rows = 7) {
  const half = (rows - 1) / 2;
  for (let y = half; y < b.h - half; y++) for (let x = 0; x + 2 < b.w; x++) {
    let ok = true;
    for (let dy = -half; dy <= half && ok; dy++) for (let dx = 0; dx <= 2; dx++) if (!free(b, x + dx, y + dy)) { ok = false; break; }
    if (!ok) continue;
    u.x = x; u.y = y;
    return { x, y };
  }
  return null;
}
const hasFence = (path, b) => path.some(([x, y]) => !CELL[at(b, x, y).k].walk);

// ======================================================================================
console.log("Finds carried loose fill the hands: no shooting, reloading, doors or windows until set down or stowed");
{
  const { st, b } = raid();
  const [u, mate] = players(b);
  const s = survivorById(st, u.sid);
  fresh(b, u);
  check(isRanged(u) && !C.handsBusy(u) && C.handsCount(u) === 0, `starts with a gun in hand and empty hands (${u.weaponName})`);
  const fire0 = fireRefusal(b, u);
  const box = boxWith(b, u, { scrap: 4 });
  const m = RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`);
  check((u.haul.sup.scrap || 0) === 4 && C.handsBusy(u) && C.haulBusy(u) && C.handsCount(u) === 1, `4 scrap carried loose: hands full, one thing in them (${m})`);
  check(!canFire(b, u) && /Hands full/.test(fireRefusal(b, u)) && /scrap/.test(fireRefusal(b, u)), `cannot fire: "${fireRefusal(b, u)}"`);
  check(/Hands full/.test(reloadRefusal(b, u)), `cannot reload: "${reloadRefusal(b, u)}"`);
  const foe = b.units.find((e) => e.side === "enemy" && !e.away) || b.units.find((e) => e.side === "enemy");
  check(/Hands full/.test(combatAct(st, { type: "shoot", unit: u.id, target: foe.id })), "the Shoot order is refused");
  check(/Hands full/.test(combatAct(st, { type: "reload", unit: u.id })), "the Reload order is refused");
  check(/Hands full/.test(combatAct(st, { type: "climb", unit: u.id })), "climbing through a window is refused");
  check(["openwindow", "closewindow", "breakwindow", "checkwindow"].every((t) => /Hands full/.test(combatAct(st, { type: t, unit: u.id, x: 0, y: 0 }))), "opening, closing, trying and breaking a window are refused");
  check(/Hands full/.test(combatAct(st, { type: "close", unit: u.id })) && /Hands full/.test(combatAct(st, { type: "open", unit: u.id, target: 0, method: "force" })), "closing a door and working a lock are refused");
  check(u.ap === 2, "none of it cost an action");
  // A closed door next to them: shut to them (the move goes round), open to them once the scrap is set down.
  const spot = openSpot(b, u, 3);
  check(!!spot, "open ground for a door");
  if (spot) {
    const door = at(b, spot.x + 1, spot.y);
    door.k = "idoor"; door.hp = door.mhp = 30;
    at(b, spot.x + 1, spot.y - 1).k = "wall"; at(b, spot.x + 1, spot.y + 1).k = "wall";
    b.losCache.fill(0);
    const r1 = reachable(b, u, 12, { manual: true });
    const dFull = r1.dist[spot.y * W(b) + spot.x + 2];
    check(dFull !== 2, `hands full: the closed door stays shut, the cell beyond it is ${isFinite(dFull) ? `${dFull} tiles round` : "out of reach"}`);
    b.botTurn = true; // the battle AI is not held up by a door (combat.js autoPlayerTurn): it would never get its loot through
    check(reachable(b, u, 12, { manual: true }).dist[spot.y * W(b) + spot.x + 2] === 2, "the AI playing the side goes through the door with its hands full");
    b.botTurn = false;
    const found0 = JSON.stringify(b.raid.found);
    const err = combatAct(st, { type: "dropCarried", unit: u.id });
    const pile = groundAt(b, u.x, u.y, u.f || 0);
    check(!err && !C.handsBusy(u) && !(u.haul.sup.scrap > 0) && pile && pile.contents.sup.scrap === 4 && u.ap === 2, `Drop carried (free): the scrap lies on a pile on the cell (${err || "ok"})`);
    check(JSON.stringify(b.raid.found) === found0, "what was set down still counts as found");
    const r2 = reachable(b, u, 12, { manual: true });
    check(r2.dist[spot.y * W(b) + spot.x + 2] === 2, "hands free: through the closed door in 2");
    check(canFire(b, u) === (fire0 === ""), `and the gun fires again (${fireRefusal(b, u) || "ok"})`);
    // Picked up again from the ground (hauling): hands full again (scrap is one of the team's own kinds of supply, so
    // off a pile it goes into the arms, carry.js pileToArms; either way the hands are full).
    const r = pickUpFromGround(st, b, u, pile);
    check(r.got.some((x) => /scrap/.test(x)) && ((u.hands && u.hands.scrap) || 0) + (u.haul.sup.scrap || 0) === 4 && C.handsBusy(u) && !canFire(b, u), `picked up again from the ground: hands full (${r.got.join(", ")}; ${C.armsText(u)})`);
    check(!combatAct(st, { type: "dropCarried", unit: u.id }) && !C.handsBusy(u) && pileCount(groundAt(b, u.x, u.y, u.f || 0)) > 0, "set down again: hands free, the pile back on the cell");
  }
  void mate;
}

// ======================================================================================
console.log("Two different things carried: both hands full, nothing more is taken");
{
  const { st, b } = raid();
  const [u, mate] = players(b);
  const s = survivorById(st, u.sid);
  fresh(b, u);
  s.pockets = s.pockets.map(() => null);
  s.gear.backpack = newItem("backpack");
  const box = boxWith(b, u, { scrap: 4, meds: 2 }, [newItem("knife"), newItem("flashlight")]);
  RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`);
  const m2 = RL.raidMove(st, u.id, `rbox:${box.id}:sup:meds`, `haul:${u.id}:list`);
  check(C.handsCount(u) === 2 && (u.haul.sup.meds || 0) === 2, `scrap and meds carried: both hands full (${m2})`);
  const no = RL.raidMove(st, u.id, `rbox:${box.id}:gear:0`, `s:${s.id}:pocket:0`);
  check(/Both hands full/.test(no) && !s.pockets[0], `a knife from the container is refused, even into a pocket ("${no}")`);
  const ta = RL.raidTakeAll(st, u.id, box.id);
  check(ta.got.length === 0 && box.contents.gear.length === 2, "Take all takes nothing more");
  box.contents.sup.scrap = 3;
  const more = RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`);
  check((u.haul.sup.scrap || 0) === 7 && C.handsCount(u) === 2, `more scrap joins the scrap in hand (${more})`);
  // Something put down frees a hand: the knife comes, into the pocket (their own places are still theirs).
  const err = combatAct(st, { type: "drop", unit: u.id, loc: `haul:${u.id}:sup:meds` });
  check(!err && C.handsCount(u) === 1 && (groundAt(b, u.x, u.y, u.f || 0).contents.sup.meds || 0) === 2, `the meds put down on the ground (free): one hand free (${err || "ok"})`);
  const yes = RL.raidMove(st, u.id, `rbox:${box.id}:gear:0`, `s:${s.id}:pocket:0`);
  check(s.pockets[0] && s.pockets[0].key === "knife" && C.handsCount(u) === 1, `the knife into the pocket (${yes}); a pocket is not a hand`);
  const fl = RL.raidMove(st, u.id, `rbox:${box.id}:gear:0`, `haul:${u.id}:list`);
  check(u.haul.gear.some((g) => g.key === "flashlight") && C.handsCount(u) === 2, `the flashlight carried loose: both hands full again (${fl})`);
  const pk = RL.raidMove(st, u.id, `haul:${u.id}:gear:0`, `s:${s.id}:pack:0`);
  check(!u.haul.gear.length && C.handsCount(u) === 1, `carried into the pack: a hand free (${pk})`);
  // A teammate with both hands full takes nothing handed over; one with a hand free does.
  fresh(b, mate);
  mate.x = u.x; mate.y = u.y; standNext(b, mate, u.x, u.y);
  mate.haul = { sup: { water: 2, food: 1 }, gear: [] };
  const hand = RL.raidMove(st, u.id, `haul:${u.id}:sup:scrap`, `haul:${mate.id}:list`);
  check(/Both hands full/.test(hand) && (u.haul.sup.scrap || 0) === 7, `a teammate with both hands full takes nothing (${hand})`);
  mate.haul.sup.food = 0;
  const hand2 = RL.raidMove(st, u.id, `haul:${u.id}:sup:scrap`, `haul:${mate.id}:list`);
  check((mate.haul.sup.scrap || 0) === 7 && C.handsCount(mate) === 2, `with a hand free they take it (${hand2})`);
  // Picking up a bag into the arms counts the same.
  check(/Both hands full/.test(C.bagRefusal(st, b, mate, newItem("backpack"))), "a bag into the arms is refused with both hands full");
}

// ======================================================================================
console.log("The indicator: the squad strip's chip and the roster line");
{
  const { st, b } = raid();
  const [u] = players(b);
  const HUD = await import("../src/ui/battlehud.js");
  check(!HUD.unitChips(st, b, u).some((c) => /HANDS/.test(c[0])), "no chip with empty hands");
  u.haul = { sup: { scrap: 3 }, gear: [] };
  const chip = HUD.unitChips(st, b, u).find((c) => /HANDS/.test(c[0]));
  check(!!chip && chip[1] === "warn" && /scrap/.test(chip[2]) && /shooting/.test(chip[2]), `one thing carried: ${chip ? `${chip[0]} chip: "${chip[2]}"` : "no chip"}`);
  u.haul.gear.push(newItem("knife"));
  const chip2 = HUD.unitChips(st, b, u).find((c) => /HANDS/.test(c[0]));
  check(!!chip2 && /✋✋/.test(chip2[0]) && /nothing more/.test(chip2[2]), `two things: ${chip2 ? chip2[0] : "no chip"}`);
  check(/knife/.test(C.armsText(u)) && /3 scrap/.test(C.armsText(u)), `the text names it all (${C.armsText(u)})`);
  // The orders (ui/combat.js, headless with a stub canvas): Shoot greyed with the hands reason, Set over cover offered.
  globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => null, toDataURL: () => "data:," }), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const UI = await import("../src/ui/combat.js");
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => null });
  b.phase = "player"; u.ap = 2;
  const orders = UI.unitOrders(st, b, u).list;
  const shoot = orders.find((o) => o.v === "shoot");
  check(!!shoot && !shoot.ok && /Hands full/.test(shoot.why), `Shoot greyed out: "${shoot && shoot.why}"`);
  const drop = orders.find((o) => o.v === "dropCarried");
  check(!!drop && drop.ok && /scrap/.test(drop.tip), "Drop carried offered (free)");
  const spot = openSpot(b, u, 3);
  if (spot) {
    at(b, spot.x + 1, spot.y).k = "fence";
    faceToward(u, spot.x + 1, spot.y);
    const so = UI.unitOrders(st, b, u).list.find((o) => o.v === "setOver");
    check(!!so && so.ok && /far side of the fence/.test(so.tip), `Set over cover offered facing a fence (${so ? so.tip.slice(0, 60) : "none"}…)`);
    const mv = UI.unitOrders(st, b, u).list.find((o) => o.v === "move");
    check(/costs double: \+6 tiles/.test(mv.tip) && /closed doors stay shut/.test(mv.tip), "the Move tip says the vault costs double with the hands full, and doors stay shut");
  }
}

// ======================================================================================
console.log("Vaulting half cover (the base rules): the hands full of a load cost double the movement, never a closed window");
{
  const { st, b } = battles(seed, ["field-town"])[0];
  const u = players(b).find((x) => !x.dead);
  fresh(b, u);
  const spot = openSpot(b, u, 7);
  check(!!spot, "open ground for a line of fence");
  if (spot) {
    for (let dy = -3; dy <= 3; dy++) at(b, spot.x + 1, spot.y + dy).k = "fence";
    b.losCache.fill(0);
    const far = spot.y * W(b) + spot.x + 2;
    const plain = 2 + VAULT.COST; // the two steps and the vault
    const r = reachable(b, u, 16, { manual: true });
    const path = pathTo(r, spot.x + 2, spot.y);
    check(r.dist[far] === plain, `free hands: the cell beyond the fence is ${r.dist[far]} tiles (2 steps + ${VAULT.COST})`);
    check(path.length === 2 && hasFence(path, b) && path[0][0] === spot.x + 1, `the path goes over the fence (${JSON.stringify(path)})`);
    check(!isFinite(r.dist[spot.y * W(b) + spot.x + 1]), "nobody stands on the fence");
    const vn = vaultsNear(b, u);
    check(vn.length === 1 && vn[0].x === spot.x + 1 && vn[0].to[0] === spot.x + 2 && vn[0].free, "vaultsNear: the fence east, with the free cell beyond");
    u.haul = { sup: { scrap: 3 }, gear: [] };
    check(canVault(u), "carrying a load does not stop a vault (a cart pushed or a body carried does)");
    const cost = vaultCost(b, at(b, spot.x + 1, spot.y), u);
    check(cost === 2 + 2 * VAULT.COST, `with the hands full the vault itself costs ${cost}: the whole crossing doubles`);
    const r2 = reachable(b, u, 16, { manual: true });
    check(r2.dist[far] === 2 * plain && hasFence(pathTo(r2, spot.x + 2, spot.y), b), `hands full: ${r2.dist[far]} tiles (twice ${plain}), still over the fence`);
    // The move itself: over the fence with the load.
    const ap0 = u.ap, mob = u.mob;
    const err = combatAct(st, { type: "move", unit: u.id, x: spot.x + 2, y: spot.y });
    check(!err && u.x === spot.x + 2 && u.y === spot.y, `moved over the fence with the arms full (${err || "ok"})`);
    check(u.ap === ap0 - (2 * plain <= mob ? 1 : 2), `it cost ${ap0 - u.ap} action${ap0 - u.ap === 1 ? "" : "s"} (pace ${mob})`);
    const said = b.log.slice(-4).map((l) => l.text).find((t) => /vaults/.test(t)) || "";
    check(/vaults the fence/i.test(said) && /twice the movement/.test(said), `the log says so: "${said}"`);
    // Back the other way with free hands: the plain cost.
    u.haul = null; fresh(b, u);
    const err2 = combatAct(st, { type: "move", unit: u.id, x: spot.x, y: spot.y });
    check(!err2 && u.x === spot.x && u.ap === 2 - (plain <= mob ? 1 : 2), `back over it with free hands (${err2 || "ok"}, ap ${u.ap})`);
    // A closed window with the hands full is not crashed through; an open one is vaulted at double.
    fresh(b, u);
    const win = at(b, spot.x + 1, spot.y);
    win.k = "window"; win.win = { open: false, lock: "none", known: true };
    b.losCache.fill(0);
    u.haul = { sup: { scrap: 3 }, gear: [] };
    const r3 = reachable(b, u, 16, { manual: true });
    check(!pathTo(r3, spot.x + 2, spot.y).some(([x, y]) => x === spot.x + 1 && y === spot.y), `hands full: the closed window is not gone through (the cell beyond is ${r3.dist[spot.y * W(b) + spot.x + 2]} tiles round)`);
    win.win.open = true;
    const r4 = reachable(b, u, 16, { manual: true });
    check(r4.dist[spot.y * W(b) + spot.x + 2] === 2 * plain, `an open window is vaulted at double (${r4.dist[spot.y * W(b) + spot.x + 2]})`);
    u.haul = null;
    const r5 = reachable(b, u, 16, { manual: true });
    win.win.open = false;
    const r6 = reachable(b, u, 16, { manual: true });
    check(r5.dist[spot.y * W(b) + spot.x + 2] === plain && r6.dist[spot.y * W(b) + spot.x + 2] === plain + 1, `free hands: an open window ${r5.dist[spot.y * W(b) + spot.x + 2]}, a closed one one tile dearer (${r6.dist[spot.y * W(b) + spot.x + 2]})`);
    // Pushing or helping with a cart (carts.js) is no vault.
    u.cartHelp = 1;
    check(!canVault(u), "helping pull a cart: no vault");
    u.cartHelp = null;
    win.k = "fence";
  }
}

// ======================================================================================
console.log("Set over cover: the load on the far side (1 action, facing it), picked up from the ground by anyone");
{
  const { st, b } = battles(seed, ["field-town"])[0];
  const [u, v] = players(b).filter((x) => !x.dead);
  fresh(b, u); fresh(b, v);
  const spot = openSpot(b, u, 7);
  check(!!spot, "open ground for a fence");
  if (spot) {
    for (let dy = -3; dy <= 3; dy++) at(b, spot.x + 1, spot.y + dy).k = "sandbag";
    b.losCache.fill(0);
    u.haul = { sup: { scrap: 3 }, gear: [newItem("crowbar")] };
    check(/Not carrying/.test(combatAct(st, { type: "setOver", unit: v.id })), "nothing carried: nothing to set over");
    // Two covers next to them (the sandbags east, a crate north): facing neither, the order asks them to face one.
    at(b, spot.x, spot.y - 1).k = "crate";
    faceToward(u, spot.x, spot.y + 1); // facing south
    const whyFace = combatAct(st, { type: "setOver", unit: u.id });
    check(/Face the half cover/.test(whyFace) && u.ap === 2 && C.handsBusy(u), `facing neither cover: "${whyFace}"`);
    at(b, spot.x, spot.y - 1).k = "open";
    // One cover next to them: it is the one, and the order turns them to it (facing is free).
    const err = combatAct(st, { type: "setOver", unit: u.id });
    const pile = groundAt(b, spot.x + 2, spot.y, 0);
    check(!err && u.ap === 1 && !C.handsBusy(u) && pile && pile.contents.sup.scrap === 3 && pile.contents.gear.some((g) => g.key === "crowbar"), `set over the sandbags: a pile on the far side, hands free, 1 action (${err || "ok"})`);
    check(Math.round(u.face[0]) === 1 && Math.round(u.face[1]) === 0, "and they face the sandbags now");
    check(!groundAt(b, u.x, u.y, 0) || !pileCount(groundAt(b, u.x, u.y, 0)), "nothing on their own cell");
    check(/far side of the cover/.test(b.log[b.log.length - 1].text), `the log: "${b.log[b.log.length - 1].text}"`);
    // Over after it with free hands: the pile is under their feet; a teammate next to it can take it too.
    const err2 = combatAct(st, { type: "move", unit: u.id, x: spot.x + 2, y: spot.y });
    check(!err2 && u.x === spot.x + 2 && pilesNear(b, u).includes(pile), `vaulted after it: the pile within reach (${err2 || "ok"})`);
    v.x = spot.x + 2; v.y = spot.y + 1; fresh(b, v);
    const r = pickUpFromGround(st, b, v, pile);
    check(r.got.some((x) => /scrap/.test(x)) && r.got.some((x) => /Crowbar/.test(x)) && C.handsBusy(v) && !pileCount(pile), `a teammate picks it all up from the ground (${r.got.join(", ")})`);
    // Clicking a cover cell: act.x / act.y picks it; one that is not vaultable is refused.
    fresh(b, v); v.x = spot.x + 2; v.y = spot.y; u.x = spot.x; u.y = spot.y - 1;
    const bad = combatAct(st, { type: "setOver", unit: v.id, x: spot.x + 2, y: spot.y + 1 });
    check(/No half cover/.test(bad), `an open cell is no cover to set it over (${bad})`);
    const ok = combatAct(st, { type: "setOver", unit: v.id, x: spot.x + 1, y: spot.y });
    const p2 = groundAt(b, spot.x, spot.y, 0);
    check(!ok && p2 && p2.contents.sup.scrap === 3 && !C.handsBusy(v), `named cover: set back over to the west side (${ok || "ok"})`);
  }
}

// ======================================================================================
console.log("The raid bot: finds set down to fight, both hands full counts as a full load");
{
  const { st, b } = raid();
  const [u] = players(b);
  const zombie = b.units.find((e) => e.side === "enemy");
  fresh(b, u);
  u.f = 0;
  zombie.away = false; zombie.off = false; zombie.dormant = false; zombie.f = 0; // the first enemies on these maps may be folk upstairs: one is brought down to fight
  u.haul = { sup: { scrap: 3 }, gear: [] };
  standNext(b, zombie, u.x, u.y);
  zombie.aware = true; zombie.ap = 2;
  for (const o of players(b)) if (o !== u) { o.x = 0; o.y = 0; o.ap = 0; }
  const x0 = u.x, y0 = u.y, zx0 = zombie.x, zy0 = zombie.y;
  const n0 = b.log.length;
  autoPlayerTurn(st);
  if (process.env.HANDS_DEBUG) console.log("   start", x0, y0, "zombie start", zx0, zy0, "|", b.log.slice(n0).map((l) => l.text).join(" | "), "| zombie", zombie.x, zombie.y, "unit", u.x, u.y, "ap", u.ap, "haul", JSON.stringify(u.haul));
  const pile = groundAt(b, x0, y0, 0);
  check(!C.haulBusy(u) && pile && pile.contents.sup.scrap === 3, `the bot sets its scrap down where it stood to fight (${pile ? "a pile" : "no pile"}, hands ${C.handsBusy(u) ? "full" : "free"})`);
  check(b.log.some((l) => /sets down 3 scrap/.test(l.text)), "the log says it set the scrap down");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
