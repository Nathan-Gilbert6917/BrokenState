// Searching on a raid map (sim/search.js, combat.js "search", raidloot.js stacks): splitting a supply stack moves
// exactly n and leaves the rest, never more than fits, hauling time paid on what moved; a full search costs 1 action
// (in the dark too) and shows everything; a quick rummage costs no action, shows 30–50% of the things, adds Heat and
// pulls the unaware dead and guards within its radius (walls muffle it indoors), once a turn; a full search after it
// shows the rest; the rummage costs Heat +5 and is heard 7 tiles off (9 in the dark), with a 6% chance (less with
// Scavenging or Stealth, more in the dark, always under 10%) of a cut hand that never downs anyone, the bot rummaging
// once a turn even cut every time; a locked container is 1 action a pick attempt at odds by Stealth, then 1 action to search; a raid
// saved mid-search keeps what is hidden; the raid bot rummages when pressed and searches in full when not.
// Usage: node tools/searchtest.js [seed] [v]
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { SUPPLIES } from "../src/sim/data.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, combatAct, CELL, registerCombatHandler, unitAt, autoPlayerTurn } from "../src/sim/combat.js";
import { newItem } from "../src/sim/inventory.js";
import * as RL from "../src/sim/raidloot.js";
import { SEARCH, hiddenCount, shownCount, quickRadius, quickHurtChance, quickHurtPct, quickHurt } from "../src/sim/search.js";
import { openOdds, PICK, LOCKS } from "../src/sim/locks.js";
import { BMAP } from "../src/sim/buildingmaps.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { inventoryModal, INV_ACTIONS, INV_CHANGE, invDrop } from "../src/ui/inventory.js";
import { chosenQty } from "../src/ui/stackmove.js";
import { renderCombatPanel } from "../src/ui/combat.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const VERBOSE = process.argv.includes("v"); // node tools/searchtest.js 7 v: every check
const check = (ok, msg) => { if (ok) { passes++; if (VERBOSE) console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
registerCombatHandler("srtest", () => {});

// A raid on a town site with a crew of 3 from the hub, no enemies on the map (tests put their own).
function raid(k = 0) {
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: seed * 100 + i + k * 7, factionCount: 6 });
    st.cards.length = 0;
    st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["pharmacy", "store", "gunstore", "police", "warehouse", "house", "gas"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    for (const s of crew) s.traits = [];
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "srtest", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 0 }, context: {} };
    st.combat = createBattle(st, setup);
    const b = st.combat;
    if (b.raid.choose) b.raid.choose = null;
    b.units = b.units.filter((u) => u.side === "player");
    b.night = false;
    if (b.raid.containers.filter((c) => c.kind !== "body" && !c.lock).length < 3) continue;
    return { st, b, p, crew };
  }
  throw new Error("no raid map");
}
const players = (b) => b.units.filter((u) => u.side === "player");
function standNext(b, u, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !CELL[b.cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
    u.x = nx; u.y = ny;
    return true;
  }
  return false;
}
// An unopened, unlocked container next to the unit (its contents rolled when searched), or one with these contents.
function freshBox(b, u, skip = []) {
  const box = b.raid.containers.find((c) => c.kind !== "body" && !c.lock && !skip.includes(c) && standNext(b, u, c.x, c.y));
  box.contents = null; box.hidden = null; box.quick = false; box.searched = false; box.partial = false;
  return box;
}
function boxWith(b, u, sup, gear = []) {
  const box = freshBox(b, u);
  box.contents = { sup: { ...sup }, gear };
  return box;
}
const fresh = (b, u) => { u.ap = 2; u.haulTurn = b.turn; u.hauledKg = 0; u.quickTurn = -1; };
const things = (box) => shownCount(box) + hiddenCount(box);
// One of the dead or a guard, unaware, at x, y (a copy of a player unit turned enemy: enough for the noise rules).
function enemyAt(b, kind, x, y) {
  const p = players(b)[0];
  const e = { ...p, id: b.nextId++, side: "enemy", kind, x, y, aware: false, dead: false, down: false, left: false, fled: false, ztype: null, boss: false, investigate: null, reinforcement: false, haul: null, sid: null, pod: 99 };
  b.units.push(e);
  return e;
}
// An open floor cell around (x, y) at distance d along a row or column, with nobody in it.
function openAt(b, x, y, d) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx * d, ny = y + dy * d;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !CELL[b.cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
    return [nx, ny, dx, dy];
  }
  return null;
}

// ======================================================================================
console.log("Splitting a stack: exactly n move, the rest stays");
{
  const { st, b } = raid();
  const [u] = players(b);
  fresh(b, u);
  const box = boxWith(b, u, { f_rationbar: 5, ammo: 12 });
  const src = `rbox:${box.id}:sup:f_rationbar`, me = `haul:${u.id}:list`;
  check(RL.supplyFit(st, u.id, src, me).have === 5, "the stack shows its count (5 ration bars)");
  RL.raidMove(st, u.id, src, me, 1);
  check(u.haul.sup.f_rationbar === 1 && box.contents.sup.f_rationbar === 4, `take 1 of 5: 1 carried, 4 left (${u.haul.sup.f_rationbar}/${box.contents.sup.f_rationbar})`);
  RL.raidMove(st, u.id, src, me, 3);
  check(u.haul.sup.f_rationbar === 4 && box.contents.sup.f_rationbar === 1, `take 3 more: 4 carried, 1 left (${u.haul.sup.f_rationbar}/${box.contents.sup.f_rationbar})`);
  RL.raidMove(st, u.id, `haul:${u.id}:sup:f_rationbar`, `rbox:${box.id}:list`, 2);
  check(u.haul.sup.f_rationbar === 2 && box.contents.sup.f_rationbar === 3 && b.raid.found.f_rationbar === 2, `put 2 back: 2 carried, 3 inside, 2 counted as found (${b.raid.found.f_rationbar})`);
  RL.raidMove(st, u.id, src, me);
  check(u.haul.sup.f_rationbar === 5 && !(box.contents.sup.f_rationbar >= 1), "no number: the whole stack (as many as fit)");
  // A teammate next to them: hand over part of a stack.
  const m = players(b)[1];
  standNext(b, m, u.x, u.y);
  RL.raidMove(st, u.id, `haul:${u.id}:sup:f_rationbar`, `haul:${m.id}:list`, 2);
  check(u.haul.sup.f_rationbar === 3 && m.haul.sup.f_rationbar === 2, `hand 2 of 5 to a teammate (${u.haul.sup.f_rationbar} / ${m.haul.sup.f_rationbar})`);
  // Never more than fits: a qty past the room moves only what fits, and supplyFit says so beforehand.
  RL.HAUL.free = 1e9;
  const w = SUPPLIES.scrap.weight;
  const room = RL.personalRoom(st, u);
  const fits = Math.floor((room + 1e-6) / w);
  const big = boxWith(b, u, { scrap: fits + 10 });
  const f = RL.supplyFit(st, u.id, `rbox:${big.id}:sup:scrap`, me, fits + 5);
  check(f.n === fits && f.have === fits + 10, `asked for ${fits + 5} scrap: supplyFit says ${f.n} fit (of ${f.have})`);
  const msg = RL.raidMove(st, u.id, `rbox:${big.id}:sup:scrap`, me, fits + 5);
  check(u.haul.sup.scrap === fits && big.contents.sup.scrap === 10, `${fits} moved, 10 stay (${msg})`);
  check(/Too heavy/.test(RL.raidMove(st, u.id, `rbox:${big.id}:sup:scrap`, me, 1)) && RL.supplyFit(st, u.id, `rbox:${big.id}:sup:scrap`, me, 1).n === 0, "full: not even 1 more");
  RL.HAUL.free = 8;
}

console.log("The search window: pick how many, then where");
{
  const { st, b } = raid(8);
  const [u] = players(b);
  fresh(b, u);
  const box = boxWith(b, u, { f_rationbar: 6 });
  const ui = { inv: { raid: true, uid: u.id, box: box.id }, invSel: null, invMsg: "" };
  const src = `rbox:${box.id}:sup:f_rationbar`;
  INV_ACTIONS["inv-click"](st, ui, { loc: src });
  check(ui.invSel === src && ui.stack && ui.stack.ns === "raid" && chosenQty(st, ui, "raid") === 6, "click a stack: it is picked and the stack mover opens, all 6 (they all fit) by default");
  INV_ACTIONS["sm-qty"](st, ui, { v: "one" });
  INV_ACTIONS["sm-qty"](st, ui, { v: "inc" });
  check(chosenQty(st, ui, "raid") === 2, `1, then +: ${chosenQty(st, ui, "raid")}`);
  INV_CHANGE["sm-qtyset"](st, ui, { value: "40" });
  check(chosenQty(st, ui, "raid") === 6, `typed 40: held to the stack (${chosenQty(st, ui, "raid")})`);
  INV_CHANGE["sm-qtyset"](st, ui, { value: "3" });
  let html = "";
  try { html = inventoryModal(st, ui) || ""; } catch (e) { html = `ERR ${e.message}`; }
  check(/data-action="sm-qtyset"/.test(html) && /value="3"/.test(html) && /fit in /.test(html), `the window shows the number to move and how many fit (${html.startsWith("ERR") ? html : "ok"})`);
  INV_ACTIONS["inv-click"](st, ui, { loc: `haul:${u.id}:list` });
  check(u.haul.sup.f_rationbar === 3 && box.contents.sup.f_rationbar === 3 && ui.invSel == null, `then click Carried: 3 taken, 3 left (${ui.invMsg})`);
  INV_ACTIONS["inv-click"](st, ui, { loc: src }, { shiftKey: true });
  check(u.haul.sup.f_rationbar === 6 && !(box.contents.sup.f_rationbar >= 1), "Shift+click: the rest of the stack straight across");
  invDrop(st, ui, `haul:${u.id}:sup:f_rationbar`, `rbox:${box.id}:list`, false, true);
  check(u.haul.sup.f_rationbar === 5 && box.contents.sup.f_rationbar === 1, "Ctrl-drop: one");
  invDrop(st, ui, `haul:${u.id}:sup:f_rationbar`, `rbox:${box.id}:list`, true);
  check(u.haul.sup.f_rationbar === 3 && box.contents.sup.f_rationbar === 3, "Shift-drop: half");
  // A rummaged container: the window says more may be hidden and offers the full search.
  fresh(b, u);
  const q = freshBox(b, u, [box]);
  combatAct(st, { type: "search", unit: u.id, box: q.id, open: true, quick: true });
  ui.inv.box = q.id; ui.invSel = null;
  try { html = inventoryModal(st, ui) || ""; } catch (e) { html = `ERR ${e.message}`; }
  check(/may turn up more/.test(html) && /data-action="rl-full"/.test(html), "a rummaged container: \"a full search may turn up more\" and its button");
  const t = things(q);
  INV_ACTIONS["rl-full"](st, ui);
  check(u.ap === 2 - SEARCH.ap && shownCount(q) === t && !q.quick, `Search it in full from the window: ${SEARCH.ap} action, all ${t} in sight`);
}

console.log("Hauling time is paid on what moved");
{
  const { st, b } = raid(1);
  const [u] = players(b);
  fresh(b, u);
  u.share = -200;
  const w = SUPPLIES.scrap.weight;
  const box = boxWith(b, u, { scrap: 60 });
  const free = Math.floor(RL.HAUL.free / w);
  RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`, free);
  check(u.ap === 2 && u.hauledKg <= RL.HAUL.free + 1e-9, `${free} scrap (${(free * w).toFixed(1)} kg) inside the free ${RL.HAUL.free} kg: no action`);
  const more = Math.ceil(RL.HAUL.per / w / 2);
  RL.raidMove(st, u.id, `rbox:${box.id}:sup:scrap`, `haul:${u.id}:list`, more);
  check(u.ap === 1 && Math.abs(u.hauledKg - (free + more) * w) < 1e-6, `${more} more: one action, ${u.hauledKg.toFixed(1)} kg hauled this turn (only what moved)`);
}

// ======================================================================================
console.log("Full search: 1 action, everything shows (in the dark too)");
{
  const { st, b } = raid(2);
  const [u] = players(b);
  for (const night of [false, true]) {
    fresh(b, u);
    b.night = night; u.light = false; u.nvg = false;
    const box = freshBox(b, u);
    const err = combatAct(st, { type: "search", unit: u.id, box: box.id, open: true });
    check(!err && u.ap === 2 - SEARCH.ap && !!box.contents && !box.quick && hiddenCount(box) === 0, `${night ? "at night without a light" : "by day"}: a full search costs ${SEARCH.ap} action and hides nothing (${err || "ok"}, ap ${u.ap})`);
    const again = combatAct(st, { type: "search", unit: u.id, box: box.id, open: true });
    check(!again && u.ap === 2 - SEARCH.ap, "opening it again is free");
  }
  b.night = false;
  u.ap = 0;
  check(!!combatAct(st, { type: "search", unit: u.id, box: freshBox(b, u).id, open: true }), "no actions left: no search");
}

// ======================================================================================
console.log("Quick search: no action, 30–50% shows, once a turn, loud");
{
  const { st, b } = raid(3);
  const [u] = players(b);
  let shown = 0, total = 0, inRange = true, heatOk = true, apOk = true;
  const used = [];
  for (let i = 0; i < 160; i++) {
    fresh(b, u);
    const box = freshBox(b, u, used.length < 3 ? used : []);
    used.push(box);
    const heat0 = b.raid.heat;
    // A never-opened container: its contents roll (fresh each time), then all but a share is hidden.
    const err = combatAct(st, { type: "search", unit: u.id, box: box.id, open: true, quick: true });
    if (err) { check(false, `rummage refused: ${err}`); break; }
    if (u.ap !== 2) apOk = false;
    if (Math.abs(b.raid.heat - Math.min(100, heat0 + SEARCH.quick.heat)) > 1e-6) heatOk = false;
    const t = things(box);
    if (t) {
      const s = shownCount(box);
      if (s < Math.floor(SEARCH.quick.reveal[0] * t) || s > Math.ceil(SEARCH.quick.reveal[1] * t)) inRange = false;
      shown += s; total += t;
    }
    b.raid.heat = 0;
  }
  check(apOk, "a rummage costs no action");
  check(heatOk, `a rummage adds ${SEARCH.quick.heat} Heat`);
  check(inRange, `each rummage shows between ${SEARCH.quick.reveal[0] * 100}% and ${SEARCH.quick.reveal[1] * 100}% of the things (rounded)`);
  const share = shown / Math.max(1, total);
  check(total > 100 && share >= 0.33 && share <= 0.47, `over ${total} things ${Math.round(share * 100)}% showed (30–50%, about 40%)`);

  // One container followed through: the rummage, then the full search.
  fresh(b, u);
  const big = freshBox(b, u);
  combatAct(st, { type: "search", unit: u.id, box: big.id, open: true, quick: true });
  const t0 = things(big), s0 = shownCount(big);
  check(big.quick && t0 === s0 + hiddenCount(big), `rummaged: ${s0} of ${t0} in sight, the rest hidden on the container`);
  // Once a turn; not on something already opened; needs an action left.
  const other = freshBox(b, u, [big]);
  check(/already rummaged this turn/.test(combatAct(st, { type: "search", unit: u.id, box: other.id, open: true, quick: true }) || ""), "once a turn");
  u.quickTurn = -1;
  standNext(b, u, big.x, big.y);
  check(/full search/.test(combatAct(st, { type: "search", unit: u.id, box: big.id, open: true, quick: true }) || ""), "not twice on the same container: a full search finds the rest");
  u.ap = 0;
  standNext(b, u, other.x, other.y);
  check(!!combatAct(st, { type: "search", unit: u.id, box: other.id, open: true, quick: true }), "no actions left: no rummage either");

  // The full search after it: 1 action, everything shows.
  fresh(b, u);
  standNext(b, u, big.x, big.y);
  const hid = hiddenCount(big);
  const err = combatAct(st, { type: "search", unit: u.id, box: big.id, open: true });
  check(!err && u.ap === 2 - SEARCH.ap && !big.quick && !big.hidden && shownCount(big) === t0, `a full search after the rummage: ${SEARCH.ap} action, ${hid} more turn up, all ${t0} in sight`);
  // A rummaged container is not done until searched in full, even emptied.
  fresh(b, u);
  const q = freshBox(b, u, [big]);
  combatAct(st, { type: "search", unit: u.id, box: q.id, open: true, quick: true });
  q.contents.sup = { f_rationbar: 1 }; // what turned up: one ration bar, taken
  q.contents.gear.length = 0;
  RL.raidMove(st, u.id, `rbox:${q.id}:sup:f_rationbar`, `haul:${u.id}:list`);
  check(shownCount(q) === 0 && !q.searched, "rummaged and emptied: still not searched (a full search may find more)");
  fresh(b, u);
  standNext(b, u, q.x, q.y);
  combatAct(st, { type: "search", unit: u.id, box: q.id, open: true });
  check(q.searched === (shownCount(q) === 0), "searched in full: done once nothing is left");
}

console.log("Quick search noise: who hears it");
{
  const { st, b } = raid(4);
  const [u] = players(b);
  fresh(b, u);
  const box = freshBox(b, u, b.raid.containers.filter((c) => c.kind === "car")); // no car alarm (it wakes everyone)
  b.raid.interior = null; // as on the street: nothing muffles it (walls indoors: the next section)
  const R = quickRadius(b, u);
  // The dead and a guard inside the radius, one of the dead beyond it (outdoors nothing muffles it).
  const taken = new Set();
  const within = (lo, hi) => {
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const d = Math.hypot(x - box.x, y - box.y);
      if (d < lo || d > hi || taken.has(y * b.w + x) || !CELL[b.cells[y * b.w + x].k].walk || unitAt(b, x, y)) continue;
      taken.add(y * b.w + x);
      return [x, y];
    }
    return null;
  };
  const spots = [within(R - 2, R - 0.5), within(R - 3, R - 1), within(R + 2, R + 4)];
  if (spots.some((s) => !s)) check(false, "no open cells for the listeners");
  else {
    const near = enemyAt(b, "zombie", spots[0][0], spots[0][1]);
    const guard = enemyAt(b, "human", spots[1][0], spots[1][1]);
    const far = enemyAt(b, "zombie", spots[2][0], spots[2][1]);
    const aware = enemyAt(b, "zombie", spots[0][0], spots[0][1]); // shares the cell: only the noise rules look
    aware.aware = true;
    const qerr = combatAct(st, { type: "search", unit: u.id, box: box.id, open: true, quick: true });
    check(!qerr, `the rummage happens (${qerr || "ok"})`);
    check(near.investigate && near.investigate.x === box.x && near.investigate.y === box.y, `one of the dead ${Math.round(Math.hypot(near.x - box.x, near.y - box.y))} tiles off comes to look`);
    check(guard.investigate && guard.investigate.x === box.x, "an unaware guard inside the radius comes to look");
    check(!far.investigate, `one ${Math.round(Math.hypot(far.x - box.x, far.y - box.y))} tiles off (beyond ${R}) does not hear it`);
    check(!aware.investigate, "the dead already after you keep at it");
  }
  // The dark: heard further without a light.
  b.night = true; u.light = false; u.nvg = false;
  check(quickRadius(b, u) === SEARCH.quick.radius + SEARCH.quick.dark, `in the dark without a light: heard ${quickRadius(b, u)} tiles off`);
  u.light = true;
  check(quickRadius(b, u) === SEARCH.quick.radius, "with a flashlight: the usual radius");
  b.night = false;
}

console.log("Quick search noise indoors: walls muffle it");
{
  const { st, b } = raid(5);
  const [u] = players(b);
  fresh(b, u);
  const box = freshBox(b, u);
  const R = quickRadius(b, u);
  // Indoors (a building's map): each wall between counts BMAP.WALL_DAMP tiles more.
  b.raid.interior = b.raid.interior || { name: "Test building" };
  const d = R - 1; // in earshot with no wall
  const spot = openAt(b, box.x, box.y, d);
  const spot2 = (() => { // another line for the walled listener
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (spot && dx === spot[2] && dy === spot[3]) continue;
      const nx = box.x + dx * d, ny = box.y + dy * d;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !CELL[b.cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
      return [nx, ny, dx, dy];
    }
    return null;
  })();
  if (!spot || !spot2) check(false, "no open cells for the listeners");
  else {
    // Clear the first line, wall the second between box and listener.
    for (let i = 1; i < d; i++) { const c = b.cells[(box.y + spot[3] * i) * b.w + box.x + spot[2] * i]; if (c) c.k = "open"; }
    for (let i = 1; i < d; i++) { const c = b.cells[(box.y + spot2[3] * i) * b.w + box.x + spot2[2] * i]; if (c) c.k = "open"; }
    const mid = Math.floor(d / 2);
    b.cells[(box.y + spot2[3] * mid) * b.w + box.x + spot2[2] * mid].k = "wall";
    b.losCache.fill(0);
    const open = enemyAt(b, "zombie", spot[0], spot[1]);
    const walled = enemyAt(b, "zombie", spot2[0], spot2[1]);
    combatAct(st, { type: "search", unit: u.id, box: box.id, open: true, quick: true });
    check(!!open.investigate, `indoors, ${d} tiles off with nothing between: heard`);
    check(!walled.investigate, `${d} tiles off behind a wall (+${BMAP.WALL_DAMP}, past ${R}): not heard`);
  }
}

// ======================================================================================
console.log("Quick search costs: Heat +5, heard 7 tiles off (9 in the dark), a chance to cut a hand");
{
  const Q = SEARCH.quick, H = Q.hurt;
  check(Q.heat === 5 && Q.radius === 7 && Q.radius + Q.dark === 9, `Heat +${Q.heat}, heard ${Q.radius} tiles off, ${Q.radius + Q.dark} in the dark without a light`);
  const { st, b } = raid(9);
  const [u] = players(b);
  const s = survivorById(st, u.sid);
  s.traits = [];
  const setUp = (scav, stealth, night, light) => { s.skills.scavenging = scav; s.skills.stealth = stealth; b.night = night; u.light = light; u.nvg = false; };
  // The chance: 6% by day, less with Scavenging or Stealth (the better of the two), more in the dark, never 10%.
  const cases = [
    ["Scavenging 0, Stealth 0, by day", 0, 0, false, false, H.base],
    ["Scavenging 10", 10, 0, false, false, H.base * (1 - 10 * H.perSkill)],
    ["Stealth 20 (Scavenging 4)", 4, 20, false, false, H.base * (1 - 20 * H.perSkill)],
    ["in the dark without a light", 0, 0, true, false, H.base + H.dark],
    ["in the dark with a flashlight", 0, 0, true, true, H.base],
    ["Scavenging 20 in the dark", 20, 0, true, false, (H.base + H.dark) * (1 - 20 * H.perSkill)],
  ];
  let allUnder = true;
  for (const [label, sc, sl, night, light, want] of cases) {
    setUp(sc, sl, night, light);
    const p = quickHurtChance(st, b, u);
    if (!(p < 0.1)) allUnder = false;
    check(Math.abs(p - Math.min(H.max, want)) < 1e-9, `${label}: ${(p * 100).toFixed(1)}% a rummage`);
  }
  check(allUnder, "every case under 10%");
  setUp(0, 0, true, false);
  for (const k of ["scavenging", "stealth"]) s.skills[k] = 99; // past the cap: held at 20
  check(quickHurtChance(st, b, u) <= H.max && Math.abs(quickHurtChance(st, b, u) - (H.base + H.dark) * (1 - H.skillCap * H.perSkill)) < 1e-9, "skills count only up to 20");
  setUp(0, 0, false, false);
  check(quickHurtPct(st, b, u) === "6%", `shown as ${quickHurtPct(st, b, u)}`);
  // The panel: the line and the Quick search button's tooltip, for the survivor next to something unopened.
  {
    fresh(b, u);
    freshBox(b, u);
    b.phase = "player"; // the first of the crew is selected (autoSelect)
    let html = "";
    try { html = renderCombatPanel(st) || ""; } catch (e) { html = `ERR ${e.message}`; }
    check(/Quick search: shows 30–50%, loud, 6% chance of cutting yourself/.test(html), `the raid panel: "Quick search: shows 30–50%, loud, 6% chance of cutting yourself" (${html.startsWith("ERR") ? html : "ok"})`);
    check(/data-v="quick"[^>]*data-tip="[^"]*6% chance of cutting yourself/.test(html), "the Quick search button's tooltip gives the chance");
  }

  // Over many tries the cuts come at those rates.
  const N = 4000;
  const rate = (sc, sl, night, light) => {
    setUp(sc, sl, night, light);
    let n = 0;
    for (let i = 0; i < N; i++) { u.hp = 60; if (quickHurt(st, b, u)) n++; }
    s.conditions = (s.conditions || []).filter((c) => c.key !== "cut");
    return n / N;
  };
  const tol = (p) => 3.5 * Math.sqrt(p * (1 - p) / N);
  for (const [label, sc, sl, night, light] of [["by day, no skill", 0, 0, false, false], ["Scavenging 20", 20, 0, false, false], ["in the dark without a light", 0, 0, true, false], ["Stealth 12 in the dark", 0, 12, true, false]]) {
    setUp(sc, sl, night, light);
    const p = quickHurtChance(st, b, u);
    const r = rate(sc, sl, night, light);
    check(Math.abs(r - p) <= tol(p), `${label}: ${(r * 100).toFixed(1)}% of ${N} rummages cut a hand (chance ${(p * 100).toFixed(1)}%)`);
  }

  // What a cut does: a few health (never down), a cut on the survivor that needs dressing, a line in the log.
  const save = { base: H.base, max: H.max };
  H.base = 1; H.max = 1;
  setUp(0, 0, false, false);
  s.conditions = [];
  fresh(b, u);
  u.hp = 40;
  const box = freshBox(b, u);
  const n0 = b.log.length;
  combatAct(st, { type: "search", unit: u.id, box: box.id, open: true, quick: true });
  const cut = (s.conditions || []).find((c) => c.key === "cut");
  const lines = b.log.slice(n0).map((l) => l.text).join("\n");
  check(u.hp <= 40 - H.hp[0] && u.hp >= 40 - H.hp[1], `a cut costs ${H.hp[0]}–${H.hp[1]} health (${40 - u.hp})`);
  check(!!cut && cut.sev >= H.sev[0] && cut.sev <= H.sev[1] && cut.cause === "search", `a cut on the survivor, severity ${cut ? cut.sev : "none"} (${H.sev[0]}–${H.sev[1]}: needs dressing, can get infected)`);
  check(/cuts a hand on .*needs dressing/.test(lines), "the battle log says so");
  // Never down: at 2 health it costs at most 1.
  let down = false;
  for (let i = 0; i < 30; i++) { u.hp = 2; u.down = false; quickHurt(st, b, u); if (u.hp < 1 || u.down) down = true; }
  check(!down, "a cut never puts anyone down");
  u.hp = 40;

  // The raid bot, pressed and cutting itself every time: still one rummage a turn, and its turns go on (it searches,
  // moves, leaves) instead of rummaging again.
  let maxPer = 0, downs = 0, turns = 0, other = 0, rummages = 0;
  for (let k = 0; k < 6; k++) {
    const { st: st2, b: b2 } = raid(20 + k);
    const us = players(b2);
    for (const o of us.slice(1)) o.left = true;
    const bot = us[0];
    b2.raid.heat = 45;
    for (let t = 0; t < 4 && !b2.over && !bot.left; t++) {
      fresh(b2, bot);
      freshBox(b2, bot);
      b2.phase = "player"; // the enemy turn skipped: nobody else is on the map
      const before = b2.log.length;
      autoPlayerTurn(st2);
      const mine = b2.log.slice(before).filter((l) => l.text.startsWith(bot.name));
      const n = mine.filter((l) => /rummages through/.test(l.text)).length;
      maxPer = Math.max(maxPer, n);
      rummages += n;
      if (mine.some((l) => !/rummages through|cuts a hand/.test(l.text)) || bot.left) other++;
      if (bot.down) downs++;
      turns++;
      b2.turn++;
      b2.raid.heat = Math.max(45, b2.raid.heat);
    }
  }
  H.base = save.base; H.max = save.max;
  check(rummages > 0 && maxPer <= 1 && downs === 0, `the bot cut on every rummage: ${rummages} rummages over ${turns} turns, at most ${maxPer} a turn, never down from it`);
  check(other > 0, `and it gets on with other things (${other} turns with more than the rummage)`);
}

// ======================================================================================
console.log("Locked: 1 action a pick attempt, odds by Stealth, then 1 action to search");
{
  const { st, b } = raid(6);
  const [u] = players(b);
  const s = survivorById(st, u.sid);
  s.pockets[0] = newItem("crowbar"); // the Crowbar and lockpicks item
  fresh(b, u);
  const box = freshBox(b, u);
  box.lock = { kind: "drugs", open: false, tries: 0 };
  const diff = LOCKS.drugs.diff;
  const odds = [];
  for (const sk of [0, 5, 10]) {
    s.skills.stealth = sk;
    const o = openOdds(st, b, u, box.lock).pick;
    odds.push(o.chance);
    const want = Math.max(0.05, Math.min(0.95, PICK.base + PICK.perStealth * sk - PICK.perDiff * (diff - 1)));
    check(o.ok && Math.abs(o.chance - want) < 1e-9 && o.ap === 1, `Stealth ${sk}: ${Math.round(o.chance * 100)}% a try, 1 action`);
  }
  check(odds[0] < odds[1] && odds[1] < odds[2], "more Stealth, better odds");
  check(/locked/.test(combatAct(st, { type: "search", unit: u.id, box: box.id, open: true }) || ""), "locked: no search until it is open");
  check(/locked/.test(combatAct(st, { type: "search", unit: u.id, box: box.id, open: true, quick: true }) || ""), "locked: no rummage either");
  // Pick until it opens: every attempt costs one action.
  s.skills.stealth = 0;
  let tries = 0, apOk = true;
  for (let t = 0; t < 40 && !box.lock.open; t++) {
    fresh(b, u);
    const err = combatAct(st, { type: "open", unit: u.id, target: `c${box.id}`, method: "pick" });
    tries++;
    if (err || u.ap !== 1) apOk = false;
    b.turn++;
    s.pockets[0] = s.pockets[0] || newItem("crowbar");
    if (s.pockets[0].dur != null) s.pockets[0].dur = 99;
  }
  check(box.lock.open && apOk, `picked open after ${tries} attempt${tries === 1 ? "" : "s"}, each 1 action`);
  fresh(b, u);
  const err = combatAct(st, { type: "search", unit: u.id, box: box.id, open: true });
  check(!err && u.ap === 2 - SEARCH.ap, `open: the search is ${SEARCH.ap} action (${err || "ok"})`);
}

// ======================================================================================
console.log("Saved mid-search: hidden stays hidden, shown stays shown");
{
  const { st, b } = raid(7);
  const [u] = players(b);
  fresh(b, u);
  let box = null;
  for (let i = 0; i < 20; i++) {
    const c = freshBox(b, u, box ? [box] : []);
    u.quickTurn = -1;
    combatAct(st, { type: "search", unit: u.id, box: c.id, open: true, quick: true });
    if (hiddenCount(c) > 0 && shownCount(c) > 0) { box = c; break; }
    box = c;
  }
  const s0 = shownCount(box), h0 = hiddenCount(box), keys = JSON.stringify(box.hidden);
  const st2 = deserializeState(serializeState(st));
  const box2 = st2.combat.raid.containers.find((c) => c.id === box.id);
  check(box2.quick && shownCount(box2) === s0 && hiddenCount(box2) === h0 && JSON.stringify(box2.hidden) === keys, `loaded: ${s0} in sight, ${h0} still hidden, the same things`);
  const u2 = st2.combat.units.find((x) => x.id === u.id);
  u2.ap = 2; u2.quickTurn = -1;
  const err = combatAct(st2, { type: "search", unit: u2.id, box: box2.id, open: true });
  check(!err && shownCount(box2) === s0 + h0 && !box2.hidden, "and the full search after loading turns them up");
}

// ======================================================================================
console.log("The raid bot: rummages when pressed, searches in full when not");
{
  // Pressed (Heat 45): a rummage next to it, no action spent on it.
  let pressedQuick = 0, calmFull = 0, calmQuick = 0, tried = 0;
  for (let k = 0; k < 6; k++) {
    for (const heat of [45, 5]) {
      const { st, b } = raid(10 + k);
      const us = players(b);
      // Only the first acts: the others extracted already.
      for (const o of us.slice(1)) o.left = true;
      const u = us[0];
      fresh(b, u);
      const box = freshBox(b, u);
      b.raid.heat = heat;
      autoPlayerTurn(st);
      tried++;
      if (heat > 20) { if (box.quick || /rummages/.test(b.log.map((l) => l.text).join("\n"))) pressedQuick++; }
      else { if (box.contents && !box.quick) calmFull++; if (/rummages/.test(b.log.map((l) => l.text).join("\n"))) calmQuick++; }
    }
  }
  check(pressedQuick >= 5, `Heat 45: the bot rummages through the container next to it (${pressedQuick} of 6)`);
  check(calmFull >= 5 && calmQuick === 0, `Heat 5: it searches in full (${calmFull} of 6) and never rummages (${calmQuick})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exitCode = 1;
