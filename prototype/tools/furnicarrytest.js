// Carrying furniture and appliances in a fight (issue #12, the user's request 2026-10-25; src/sim/furnicarry.js): a
// piece lifted in 2 actions (and 2 from a helper), the weight on the pace (alone: the full kg, crushed past 40 kg; two:
// half each), the tether (a move that would part them refused, the partner down sets it down), set down on a seen cell
// next to the carrier (a pair: left or right of the two, parallel), stowed in the vehicle (refused without the room),
// fixed pieces never lifted, a container's contents tipped onto the floor, the save round trip.
// Usage: node tools/furnicarrytest.js [seed]   ("ok" / "FAIL" lines; exits 1 on a failure)
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { launchExpedition, cargoRoom } from "../src/sim/parties.js";
import { createBattle, combatAct, CELL, registerCombatHandler, unitAt, canSeeAt, canVault, dashRange, moveMob } from "../src/sim/combat.js";
import { newItem, EQUIP_SLOTS, ensureInv } from "../src/sim/inventory.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import * as F from "../src/sim/furnicarry.js";
import { handsCount, handsRefusal, dropCarried } from "../src/sim/carry.js";
import { groundAt } from "../src/sim/ground.js";
import { atVehicle } from "../src/sim/raidloot.js";

const seed = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
registerCombatHandler("furnicarrytest", () => {});
const at = (b, x, y) => b.cells[y * b.w + x];

// A raid with a crew of 3 in plain kit (a pistol and a vest: about 5 kg each), the dead gone, and a clean 13 × 13 room
// of open floor to work in (x0, y0 its corner).
function raid(withCar = false) {
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: seed * 100 + i, factionCount: 6 });
    st.cards.length = 0;
    st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["store", "house", "warehouse", "gas"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    if (crew.length < 3) continue;
    for (const s of crew) { s.traits = []; ensureInv(s); for (const k of EQUIP_SLOTS) s.gear[k] = null; s.pockets = s.pockets.map(() => null); s.gear.weapon = newItem("pistol"); s.gear.armor = newItem("vest"); }
    const car = withCar ? (st.vehicles || []).find((v) => v.loc && v.loc.kind === "base" && v.loc.baseId === h.id && v.type !== "bike") : null;
    if (withCar && !car) continue;
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: car ? car.id : null, supplies: { food: 2, water: 2, ammo: 10, meds: 0 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "furnicarrytest", enemy: { kind: "zombies", count: 1, power: 1, groups: [] }, raid: { heat0: 0 }, context: {} };
    st.combat = createBattle(st, setup);
    const b = st.combat;
    if (b.raid.choose) b.raid.choose = null;
    if (b.floors && b.floors.length > 1) continue;
    b.units = b.units.filter((u) => u.side === "player");
    if (b.units.length < 3) continue;
    const x0 = Math.floor(b.w / 2) - 6, y0 = Math.floor(b.h / 2) - 6;
    for (let y = y0 - 1; y <= y0 + 13; y++) for (let x = x0 - 1; x <= x0 + 13; x++) { const c = at(b, x, y); for (const k of Object.keys(c)) delete c[k]; Object.assign(c, { k: x < x0 || y < y0 || x > x0 + 12 || y > y0 + 12 ? "wall" : "open", f: "floor" }); }
    b.raid.containers = b.raid.containers.filter((c) => c.x < x0 - 1 || c.y < y0 - 1 || c.x > x0 + 13 || c.y > y0 + 13);
    b.indoor = false; b.night = false;
    b.losCache.fill(0);
    const us = b.units.slice(0, 3);
    us.forEach((u, j) => { u.x = x0 + 1 + j * 4; u.y = y0 + 12; u.ap = 2; });
    return { st, b, p, us, x0, y0 };
  }
  throw new Error("no raid map");
}
const fresh = (b) => { for (const u of b.units) u.ap = 2; };
const put = (b, x, y, k) => { const c = at(b, x, y); c.k = k; delete c.hp; b.losCache.fill(0); };
const stand = (b, u, x, y) => { u.x = x; u.y = y; };

const kitKg = (u) => u.armLoad;

console.log("one survivor lifts a 25 kg table: 2 actions, 4 tiles an action");
{
  const { st, b, us, x0, y0 } = raid();
  const u = us[0], s = survivorById(st, u.sid);
  const kit = kitKg(u);
  check(kit > 3 && kit < 13, `plain kit ${kit} kg (a pistol and a vest)`);
  stand(b, u, x0 + 4, y0 + 5); put(b, x0 + 5, y0 + 5, "table");
  u.ap = 1;
  check(/both actions/i.test(combatAct(st, { type: "liftPiece", unit: u.id, x: x0 + 5, y: y0 + 5 })), "one action left: refused (lifting takes both)");
  u.ap = 2;
  const err = combatAct(st, { type: "liftPiece", unit: u.id, x: x0 + 5, y: y0 + 5 });
  check(err === "", `lifted (${err || "ok"})`);
  check(u.ap === 0, `both actions spent (${u.ap} left)`);
  check(u.bag && u.bag.key === "f_table" && s.gear.carry === u.bag && u.piece === "table", "the table is in the arms (u.bag = s.gear.carry, the f_table item)");
  check(at(b, x0 + 5, y0 + 5).k === "open", "its cell is open floor again");
  check(Math.abs(u.armLoad - (kit + 25)) < 0.5, `weighed with its 25 kg (${u.armLoad} kg)`);
  check(u.mob === 4, `4 tiles an action (${u.mob})`);
  check(handsCount(u) === 2 && /table/.test(handsRefusal(u, "shoot")), `both hands full, named: "${handsRefusal(u, "shoot")}"`);
  check(!canVault(u) && dashRange(u) === moveMob(u), "no vault, no dash (one action's move at a time)");
  fresh(b);
  check(combatAct(st, { type: "move", unit: u.id, x: u.x, y: u.y - 6 }) !== "", "a 6-tile move (a dash) is refused");
  check(combatAct(st, { type: "move", unit: u.id, x: u.x, y: u.y - 4 }) === "" && u.ap === 1, "a 4-tile move: one action");
  check(/set it down/i.test(combatAct(st, { type: "search", unit: u.id })), "no searching with it");
}

console.log("the same survivor with a 60 kg fridge alone: 2 tiles; two sharing it: 30 kg each, faster");
{
  const { st, b, us, x0, y0 } = raid();
  const [u, v] = us, s = survivorById(st, u.sid);
  stand(b, u, x0 + 4, y0 + 5); put(b, x0 + 5, y0 + 5, "fridge");
  check(/takes two/.test(combatAct(st, { type: "liftPiece", unit: u.id, x: x0 + 5, y: y0 + 5, helper: -1 })), "the fridge (a \"two\" piece in the catalogue) is not lifted alone");
  put(b, x0 + 5, y0 + 5, "open");
  // Alone with it all the same: carried in from the road in the arms (the State Map's own carrying), the same rules.
  const fr = newItem("fridge");
  s.gear.carry = fr; u.bag = fr; u.piece = F.pieceKindOf(fr);
  F.reweigh(st, b, u);
  check(u.piece === "fridge", "the Refrigerator item (GEAR.fridge) in the arms is a piece");
  check(u.mob === 2, `alone: 2 tiles an action (${u.mob}; 3 × 40 / 60)`);
  check(F.crushMob(3, 120) === 1 && F.crushMob(3, 60) === 2 && F.crushMob(4, 30) === 4, "LIFT.CRUSH: 120 kg 1 tile, 60 kg 2, under 40 kg as the band");
  const alone = u.mob;
  fresh(b);
  check(dropCarried(st, b, u) === "" && !u.piece && s.gear.carry == null, "Drop carried: set down next to them, the arms free");
  const cell = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [u.x + dx, u.y + dy]).find(([x, y]) => at(b, x, y).k === "fridge");
  check(!!cell, "the fridge stands on a cell next to them");
  stand(b, v, cell[0] + (cell[0] === u.x ? 1 : 0), cell[1] + (cell[1] === u.y ? 1 : 0));
  if (unitAt(b, v.x, v.y) !== v || at(b, v.x, v.y).k !== "open") { stand(b, v, u.x + (u.x - cell[0] || 1), u.y + (u.y - cell[1])); }
  fresh(b);
  check(F.liftHelpers(b, u, { x: cell[0], y: cell[1] }).includes(v), "the teammate next to it (or to the lifter) can take the other end");
  const err = combatAct(st, { type: "liftPiece", unit: u.id, x: cell[0], y: cell[1], helper: v.id });
  check(err === "", `two lift it (${err || "ok"})`);
  check(u.ap === 0 && v.ap === 0, `2 actions from each (${u.ap}, ${v.ap} left)`);
  check(u.tether === v.id && v.tether === u.id, "tethered to each other");
  check(u.shareKg === 30 && v.shareKg === 30, `each weighed at half: ${u.shareKg} and ${v.shareKg} kg`);
  check(u.armLoad > 30 && u.armLoad < 40 && v.armLoad > 30 && v.armLoad < 40, `their loads ${u.armLoad} and ${v.armLoad} kg (kit + 30)`);
  check(u.mob === 4 && v.mob === 4 && u.mob > alone, `both at 4 tiles an action (${u.mob}, ${v.mob}), faster than one alone (${alone})`);
  check(/other end/.test(handsRefusal(v, "open")), `the helper's hands are full too: "${handsRefusal(v, "open")}"`);
  // A move by either: the other steps along for free.
  fresh(b);
  const ux = u.x, uy = u.y;
  check(combatAct(st, { type: "move", unit: u.id, x: ux, y: uy - 3 }) === "", "the carrier moves 3");
  check(Math.max(Math.abs(u.x - v.x), Math.abs(u.y - v.y)) === 1 && v.ap === 2, `the helper followed for free (next to them, ${v.ap} actions left)`);
  check(combatAct(st, { type: "move", unit: v.id, x: v.x - 2, y: v.y }) === "" && Math.max(Math.abs(u.x - v.x), Math.abs(u.y - v.y)) === 1, "the helper leads a move: the carrier follows");
  // The save keeps the tether, the shares and the item in the arms.
  const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const b2 = st2.combat, u2 = b2.units.find((x) => x.id === u.id), v2 = b2.units.find((x) => x.id === v.id), s2 = survivorById(st2, u.sid);
  check(u2.tether === v.id && v2.tether === u.id && u2.shareKg === 30 && v2.shareKg === 30, "saved and loaded: u.tether and u.shareKg kept");
  check(s2.gear.carry && s2.gear.carry.key === "fridge" && s2.gear.carry === u2.bag, "saved and loaded: the fridge in s.gear.carry, the same item as u.bag");
}

console.log("a tethered move that would part them is refused; the partner going down sets it down");
{
  const { st, b, us, x0, y0 } = raid();
  const [u, v] = us;
  // v shut in a closet: walls all round but the corner toward u, which nobody squeezes through diagonally with a load.
  const bx = x0 + 3, by = y0 + 6;
  stand(b, v, bx, by); stand(b, u, bx + 1, by - 1);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [-1, 1]]) put(b, bx + dx, by + dy, "wall");
  put(b, bx + 2, by - 1, "fridge");
  fresh(b);
  check(combatAct(st, { type: "liftPiece", unit: u.id, x: bx + 2, y: by - 1, helper: v.id }) === "", "two lift the fridge, one of them in a closet");
  fresh(b);
  const why = combatAct(st, { type: "move", unit: u.id, x: bx + 1, y: by - 4 });
  check(/keep up/.test(why), `a move the other cannot follow is refused: "${why}"`);
  check(u.x === bx + 1 && u.y === by - 1, "nobody moved");
  v.down = true; v.bleed = 3;
  F.tetherRound(st, b);
  check(!u.piece && !v.piece && u.tether == null && v.tether == null && !u.bag, "the partner down: the piece set down, the tether ended");
  const k = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => at(b, u.x + dx, u.y + dy).k === "fridge");
  check(k, "the fridge stands next to the carrier");
}

console.log("set down: a cell they can see, next to them; the cell is the piece with its hp");
{
  const { st, b, us, x0, y0 } = raid();
  const u = us[0];
  stand(b, u, x0 + 6, y0 + 6); put(b, x0 + 7, y0 + 6, "table");
  put(b, x0 + 7, y0 + 6, "bed"); put(b, x0 + 7, y0 + 7, "bed"); // a bed: 1 × 2 in the catalogue, laid as two cells
  {
    check(F.liftDef("bed").size.join("x") === "1x2", "a bed is a 2-cell piece");
    check(combatAct(st, { type: "liftPiece", unit: u.id, x: x0 + 7, y: y0 + 6 }) === "", "lifted");
    check(at(b, x0 + 7, y0 + 6).k === "open" && at(b, x0 + 7, y0 + 7).k === "open", "both its cells are open floor again");
    fresh(b);
    b.smoke = [{ x: x0 + 6, y: y0 + 5, thick: true, turns: 3 }]; // thick smoke on the cell north of them: the one beyond it unseen
    const why = combatAct(st, { type: "setPiece", unit: u.id, x: x0 + 6, y: y0 + 5 });
    check(/see/.test(why) && u.piece === "bed", `onto a cell whose far half they cannot see: refused ("${why}")`);
    b.smoke = [];
    check(combatAct(st, { type: "setPiece", unit: u.id, x: x0 + 9, y: y0 + 6 }) !== "", "not next to them: refused");
    const err = combatAct(st, { type: "setPiece", unit: u.id, x: x0 + 6, y: y0 + 5 });
    check(err === "" && u.ap === 1, `set down north of them (${err || "ok"}; 1 action)`);
    const c1 = at(b, x0 + 6, y0 + 5), c2 = at(b, x0 + 6, y0 + 4);
    check(c1.k === "bed" && c2.k === "bed" && c1.hp === F.liftDef("bed").hp && c1.moved, `both cells are the bed, ${c1.hp} hp`);
    check(!u.bag && !u.piece && survivorById(st, u.sid).gear.carry == null, "the arms free again");
  }
}

console.log("a pair sets it down to the side they choose, parallel to them");
{
  const { st, b, us, x0, y0 } = raid();
  const [u, v] = us;
  const cx = x0 + 6, cy = y0 + 6;
  stand(b, u, cx, cy); stand(b, v, cx + 1, cy); put(b, cx, cy - 1, "locker");
  check(/takes two/.test(combatAct(st, { type: "liftPiece", unit: u.id, x: cx, y: cy - 1, helper: -1 })), "a locker (a \"two\" piece) alone: refused");
  check(combatAct(st, { type: "liftPiece", unit: u.id, x: cx, y: cy - 1 }) === "" && u.tether === v.id, "two lift it (the helper next to them taken)");
  fresh(b);
  const sides = F.setTargets(b, u).map((t) => t.side).sort().join(",");
  check(sides === "left,right", `both sides offered (${sides})`);
  check(combatAct(st, { type: "setPiece", unit: v.id, side: "right" }) === "", "set down to the right");
  check(at(b, cx, cy + 1).k === "locker" && at(b, cx, cy - 1).k === "open", "on the right of the two (the carrier faces the helper: south), beside the carrier");
  check(u.ap === 1 && v.ap === 1, "1 action each");
  // A sofa (2 × 1 in the catalogue): along the two, parallel to them.
  put(b, cx, cy - 1, "sofa"); put(b, cx + 1, cy - 1, "sofa");
  fresh(b);
  check(combatAct(st, { type: "liftPiece", unit: u.id, x: cx, y: cy - 1, helper: v.id }) === "" && at(b, cx + 1, cy - 1).k === "open", "a sofa (2 cells) lifted by the two");
  fresh(b);
  check(combatAct(st, { type: "setPiece", unit: u.id, side: "right" }) !== "", "the locker stands on their right: no room for the sofa there");
  check(combatAct(st, { type: "setPiece", unit: u.id, side: "left" }) === "", "set down to the left");
  check(at(b, cx, cy - 1).k === "sofa" && at(b, cx + 1, cy - 1).k === "sofa", "both cells beside the two, parallel");
}

console.log("into the vehicle: the item in the cargo; refused without the room");
{
  const { st, b, p, us, x0, y0 } = raid(true);
  const [u, v] = us;
  stand(b, u, x0 + 4, y0 + 5); stand(b, v, x0 + 4, y0 + 6); put(b, x0 + 5, y0 + 5, "fridge");
  check(combatAct(st, { type: "liftPiece", unit: u.id, x: x0 + 5, y: y0 + 5, helper: v.id }) === "", "lifted by two");
  fresh(b);
  check(/vehicle/.test(combatAct(st, { type: "stowPiece", unit: u.id })), "away from the vehicle: refused");
  const z = b.vehicle ? { x: b.vehicle.x - 1, y: b.vehicle.y } : { x: b.raid.zones[b.raid.vehicleZone].x0, y: b.raid.zones[b.raid.vehicleZone].y0 };
  stand(b, u, z.x, z.y); stand(b, v, z.x, z.y + 1);
  check(atVehicle(b, u), "at the vehicle");
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  const room = cargoRoom(st, p);
  const pad = [];
  while (cargoRoom(st, p) > 40) { const it = newItem("f_locker"); p.cargo.gear.push(it); pad.push(it); }
  const why = combatAct(st, { type: "stowPiece", unit: u.id });
  check(/No room .* for the refrigerator \(\d+ kg over\)/.test(why), `the cargo short: "${why}" (${Math.round(room)} kg free before)`);
  for (const it of pad) p.cargo.gear.splice(p.cargo.gear.indexOf(it), 1);
  const err = combatAct(st, { type: "stowPiece", unit: u.id });
  check(err === "" && p.cargo.gear.some((it) => it.key === "fridge") && !u.bag && !u.piece && !v.piece && v.tether == null, `stowed: the fridge in p.cargo, the tether ended (${err || "ok"})`);
}

console.log("a fixed piece is never lifted; a lootable one leaves its contents on a ground pile");
{
  const { st, b, us, x0, y0 } = raid();
  const u = us[0];
  stand(b, u, x0 + 4, y0 + 5); put(b, x0 + 5, y0 + 5, "toilet");
  check(/fixed/.test(combatAct(st, { type: "liftPiece", unit: u.id, x: x0 + 5, y: y0 + 5 })) && at(b, x0 + 5, y0 + 5).k === "toilet", "a toilet (fixed: plumbed in) cannot be lifted");
  put(b, x0 + 5, y0 + 5, "open"); put(b, x0 + 3, y0 + 5, "cabinet");
  const knife = newItem("knife");
  const box = { id: b.nextId++, x: x0 + 3, y: y0 + 5, f: 0, area: b.raid.containers.find((c) => c.area != null)?.area ?? 0, kind: "cabinet", searched: false, label: "Kitchen: cabinet", contents: { sup: { food: 2 }, gear: [knife] } };
  b.raid.containers.push(box);
  fresh(b);
  check(combatAct(st, { type: "liftPiece", unit: u.id, x: x0 + 3, y: y0 + 5 }) === "", "the cabinet lifted");
  const pile = groundAt(b, x0 + 3, y0 + 5, 0);
  check(!!pile && pile.contents.gear.includes(knife) && pile.contents.sup.food === 2, "its knife and food on a ground pile where it stood");
  check(box.searched && !box.contents.gear.length && !Object.keys(box.contents.sup).length, "the cabinet's container empty, searched");
  fresh(b);
  check(combatAct(st, { type: "setPiece", unit: u.id, x: x0 + 4, y: y0 + 4 }) === "" && box.x === x0 + 4 && box.y === y0 + 4, "set down: its container with it, empty");
  // A desk as roomlayout.js lays it: 2 × 1, its number on both cells (c.pc), one container of w × h over both.
  stand(b, u, x0 + 8, y0 + 9);
  for (const x of [x0 + 8, x0 + 9]) { put(b, x, y0 + 8, "desk"); at(b, x, y0 + 8).pc = 7; }
  const pen = newItem("knife");
  const dbox = { id: b.nextId++, x: x0 + 8, y: y0 + 8, w: 2, h: 1, f: 0, area: box.area, kind: "desk", searched: false, label: "Office: desk", contents: { sup: {}, gear: [pen] } };
  b.raid.containers.push(dbox);
  fresh(b);
  check(combatAct(st, { type: "liftPiece", unit: u.id, x: x0 + 8, y: y0 + 8 }) === "", "a 2-cell desk lifted");
  check(at(b, x0 + 8, y0 + 8).k === "open" && at(b, x0 + 9, y0 + 8).k === "open" && !at(b, x0 + 9, y0 + 8).pc, "both its cells open floor, its number gone");
  check(dbox.searched && !dbox.contents.gear.length && groundAt(b, x0 + 8, y0 + 8, 0)?.contents.gear.includes(pen), "its one container emptied onto the floor");
  fresh(b);
  check(combatAct(st, { type: "setPiece", unit: u.id, x: x0 + 8, y: y0 + 10 }) === "" && dbox.x === x0 + 8 && dbox.y === y0 + 10 && dbox.w === 1 && dbox.h === 2, `set down south of them, turned: its container ${dbox.w} × ${dbox.h} over both cells`);
}

console.log("the orders: Lift, its chooser, Set down, Load into vehicle (ui/combat.js on stub canvases)");
{
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = globalThis.document || { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  const { st, b, us, x0, y0 } = raid();
  const [u, v] = us;
  stand(b, u, x0 + 6, y0 + 6); stand(b, v, x0 + 6, y0 + 7); put(b, x0 + 7, y0 + 6, "fridge");
  UI.cui.sel = u.id;
  const lift = UI.unitOrders(st, b, u).list.find((o) => o.v === "liftPiece");
  check(!!lift && lift.ok && lift.ap === F.LIFT.AP, "Lift offered next to the fridge (2 actions)");
  UI.combatAction(st, "cb-act", { v: "liftPiece" });
  const html = UI.unitOrders(st, b, u).extra;
  check(!/Alone/.test(html) && new RegExp(`With ${v.name.split(" ")[0]}`).test(html), "the fridge takes two: the chooser names the teammate who can take the other end (no Alone)");
  UI.combatAction(st, "cb-act", { v: "liftPiece", k: `${x0 + 7},${y0 + 6},${v.id},-1` });
  check(u.tether === v.id && u.piece === "fridge", "picked: the two lift it");
  fresh(b);
  UI.cui.sel = u.id; // the one who acted had no actions left: the selection moved on
  const orders = UI.unitOrders(st, b, u).list;
  check(orders.some((o) => o.v === "setPiece" && o.ok) && orders.some((o) => o.v === "stowPiece" && !o.ok && /vehicle/.test(o.why || "")), "Set down offered; Load into vehicle greyed away from it (with why)");
  UI.combatAction(st, "cb-act", { v: "setPiece" });
  check(/Left of the two|Right of the two/.test(UI.unitOrders(st, b, u).extra), "Set down asks which side of the two");
  UI.combatAction(st, "cb-act", { v: "setPiece", k: "left" });
  check(!u.piece && !v.piece, "set down on the side picked");
  let drew = "";
  try { UI.drawCombat(st, 1e9); } catch (e) { drew = String(e.stack).split("\n").slice(0, 2).join(" "); }
  check(!drew, `the battle draws${drew ? ` (${drew})` : ""}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
