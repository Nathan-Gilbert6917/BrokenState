// Barricades (src/sim/barricade.js; src/sim/combat.js CELL boarded, reachable, distField, breakCell, combatAct "shove" /
// "boardup" / "teardown"; the user's request of 2026-10-18): furniture shoved one tile for both actions (pushed onto a
// free cell beside it, or pulled onto the unit's own cell while they step back), a shoved piece getting hit points the
// dead batter; the dead crawling over half cover at CRAWL.COST (never a closed window, never stopping on it) and their
// field going over it, a walker's turn spent on a table; boards and nails (GEAR.boards, CRAFTS.boards) nailed across a
// door or a window from either side (loud, both actions, the bundle spent) making a wall for sight and movement with
// hit points the dead batter through (a boarded window ends broken, a boarded door broken in), layers up to BOARD.MAX,
// torn down again; a mid-fight save keeps it all; the enemy turn completes with the dead coming on over the fences.
// Usage: node tools/barricadetest.js [seed]
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import {
  createBattle, combatAct, registerCombatHandler, reachable, pathTo, distField, los, endPlayerTurn, runEnemyPhase, bash, moveMob,
  VAULT, MOVE, ZOMBIE_MOVE, CELL, canVault, siegeTarget, structureName,
} from "../src/sim/combat.js";
import { SHOVE, CRAWL, BOARD, FURNITURE, shoveable, canShove, shoveTargets, shoveDests, crawls, crawlable, boardTargets, boardsOf, tearTargets, isBoarded, boardedName } from "../src/sim/barricade.js";
import { windowOpen, insideOf } from "../src/sim/windows.js";
import { GEAR } from "../src/sim/data.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { newItem, ensureInv } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
registerCombatHandler("btest", () => {});
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; return st; };
const idx = (b, x, y) => y * b.w + x;
const place = (u, x, y) => { u.x = x; u.y = y; };
const logHas = (b, re) => b.log.some((l) => re.test(l.text));
// An open battle map (every cell open ground, by day), your people in the player phase, the enemy unaware and far off.
function battle(st, { count = 1, kind = "raiders", fighters = 2 } = {}) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, fighters).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind, count, power: 3, name: "Test" }, ambush: "player", canRetreat: false, handler: "btest", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; delete c.win; delete c.dk; delete c.car; delete c.under; delete c.boards; delete c.moved; }
  b.lit = null; b.floodAim = null; b.flares = [];
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  b.noise = 0;
  b.units.forEach((u, i) => { if (u.side === "enemy") { place(u, b.w - 2, 2 + i); u.aware = false; } });
  return b;
}
// A house of walls on the open map: the border walls, floorboards inside.
function house(b, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = b.cells[idx(b, x, y)];
    const border = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    c.k = border ? "wall" : "open"; c.f = "floor";
  }
  b.losCache.fill(0);
}
const setWindow = (b, x, y, lock = "none", open = false) => { const c = b.cells[idx(b, x, y)]; c.k = "window"; c.f = "floor"; c.win = { open, lock }; b.losCache.fill(0); return c; };
const setDoor = (b, x, y, hp = 30) => { const c = b.cells[idx(b, x, y)]; c.k = "idoor"; c.f = "floor"; c.dk = "wood"; c.hp = c.mhp = hp; b.losCache.fill(0); return c; };
const fenceLine = (b, x) => { for (let y = 0; y < b.h; y++) b.cells[idx(b, x, y)].k = "fence"; };
const mine = (b) => b.units.filter((u) => u.side === "player");
const giveBoards = (st, u, n = 1) => { const s = survivorById(st, u.sid); ensureInv(s); for (let i = 0; i < n; i++) s.pockets[i] = newItem("boards"); return s; };

console.log("What can be shoved, and by whom");
{
  const st = world();
  const b = battle(st);
  const kinds = (ks) => ks.map((k) => shoveable({ k }));
  check(kinds(["shelf", "cabinet", "counter", "table", "bed", "crate", "rack", "locker", "barrel", "hay", "sandbag"]).every(Boolean), "shelves, a cabinet, a counter, a table, a bed, crates, tall shelving, lockers, barrels, hay, sandbags: shoveable");
  check(!kinds(["wall", "car", "truck", "gunsafe", "window", "fence", "tree", "open", "idoor", "bars", "barricade"]).some(Boolean) && !shoveable({ k: "crate", car: {} }), "a wall, a car, a gun safe, a window, a fence, a tree, a door, cell bars, a base's barricade: not");
  check(Object.keys(FURNITURE).every((k) => CELL[k] && !CELL[k].walk && FURNITURE[k].hp > 0), "every shoveable kind is a cell nobody stands on, with hit points for when it is shoved");
  const [u] = mine(b);
  const e = b.units.find((x) => x.side === "enemy");
  check(canShove(u) && canShove(e) && !canShove({ ...u, bag: newItem("duffle") }) && !canShove({ ...u, kind: "zombie" }) && !canShove({ ...u, down: true }), "a person with free arms shoves (a human enemy could too); not with a bag in the arms, not the dead, not down");
}

console.log("Shoving: a push, a pull, where it can go, what it costs");
{
  const st = world();
  const b = battle(st);
  const [u, w] = mine(b);
  const e = b.units.find((x) => x.side === "enemy");
  place(w, 2, 2); place(e, 30, 20); e.aware = false;
  house(b, 8, 6, 9, 7); // x 8..16, y 6..12; the inside x 9..15, y 7..11
  const shelf = b.cells[idx(b, 12, 9)]; shelf.k = "shelf";
  place(u, 11, 9); u.ap = 2;
  check(shoveTargets(b, u).length === 1 && shoveTargets(b, u)[0].x === 12, "the shelf right next to the unit is found");
  place(u, 11, 8);
  check(!shoveTargets(b, u).length, "not diagonally");
  place(u, 11, 9);
  const dests = shoveDests(b, u, 12, 9);
  check(dests.length === 4 && dests.filter((d) => d.pull).length === 1 && dests.find((d) => d.pull).x === 11 && dests.find((d) => d.pull).back[0] === 10, `four ways: pushed east, north or south, or pulled west onto the unit's cell (they step back to 10,9) (${dests.map((d) => d.word).join("; ")})`);
  place(w, 13, 9);
  check(shoveDests(b, u, 12, 9).length === 3 && !shoveDests(b, u, 12, 9).some((d) => d.x === 13), "a cell with someone on it is no destination");
  place(w, 10, 9);
  check(!shoveDests(b, u, 12, 9).some((d) => d.pull), "no room behind the unit: no pull");
  place(w, 2, 2);
  b.cells[idx(b, 12, 10)].k = "table";
  check(shoveDests(b, u, 12, 9).length === 3 && !shoveDests(b, u, 12, 9).some((d) => d.y === 10), "a cell with something on it is no destination either");
  b.cells[idx(b, 12, 10)].k = "open";
  u.ap = 1;
  check(/both actions/.test(combatAct(st, { type: "shove", unit: u.id, x: 12, y: 9, tx: 13, ty: 9 })), "with one action left: refused (both actions)");
  u.ap = 2;
  check(/Say where|free open cell/.test(combatAct(st, { type: "shove", unit: u.id, x: 12, y: 9 })), "with several destinations and none named: it asks");
  let err = combatAct(st, { type: "shove", unit: u.id, x: 12, y: 9, tx: 13, ty: 9 });
  check(err === "" && b.cells[idx(b, 13, 9)].k === "shelf" && b.cells[idx(b, 12, 9)].k === "open" && b.cells[idx(b, 12, 9)].f === "floor", `pushed east: the shelf stands a tile on, open floor where it was (${err || "ok"})`);
  check(u.ap === 0 && u.x === 11 && u.y === 9, `both actions spent, the unit where it stood (${SHOVE.AP} actions)`);
  check(b.cells[idx(b, 13, 9)].hp === FURNITURE.shelf.hp && b.cells[idx(b, 13, 9)].mhp === FURNITURE.shelf.hp && b.cells[idx(b, 13, 9)].moved === true, `a shoved piece gets its hit points (${FURNITURE.shelf.hp}) and is marked moved`);
  check(b.noise === SHOVE.NOISE && logHas(b, /shoves the shelves east/), `the scrape: the raid's noise +${SHOVE.NOISE}, a log line`);
  check(u.face[0] === 1 && u.face[1] === 0, "the unit faces the piece");
  // The pull: onto the unit's own cell, the unit stepping back.
  u.ap = 2; place(u, 12, 9);
  err = combatAct(st, { type: "shove", unit: u.id, x: 13, y: 9, tx: 12, ty: 9 });
  check(err === "" && b.cells[idx(b, 12, 9)].k === "shelf" && b.cells[idx(b, 13, 9)].k === "open" && u.x === 11 && u.y === 9 && u.ap === 0, `pulled west: the shelf on the unit's cell, the unit stepped back to 11,9 (${err || "ok"})`);
  check(b.cells[idx(b, 12, 9)].hp === FURNITURE.shelf.hp && b.cells[idx(b, 12, 9)].moved, "its hit points go with it");
  check(logHas(b, /drags the shelves west, stepping back/), "the log says it was dragged");
  // A raid's container goes with its piece.
  b.raid = { containers: [{ id: 1, x: 12, y: 9, f: 0, kind: "shelf", searched: false, label: "Pantry: shelf" }], heat: 0, areas: [] };
  u.ap = 2;
  err = combatAct(st, { type: "shove", unit: u.id, x: 12, y: 9, tx: 12, ty: 8 });
  check(err === "" && b.raid.containers[0].x === 12 && b.raid.containers[0].y === 8 && b.cells[idx(b, 12, 8)].k === "shelf", `a raid's container keeps its cell when its shelf is shoved (${err || "ok"})`);
  delete b.raid;
  // A full-cover piece shoved into a corridor: the dead batter it (siegeTarget), at 0 it is rubble.
  const st2 = world();
  const b2 = battle(st2, { kind: "zombies", count: 1 });
  const [u2, w2] = mine(b2);
  const z = b2.units.find((x) => x.side === "enemy");
  for (let y = 0; y < b2.h; y++) if (y !== 10) b2.cells[idx(b2, 10, y)].k = "wall"; // a wall with one gap at 10,10
  b2.cells[idx(b2, 11, 10)].k = "locker";
  place(u2, 12, 10); place(w2, 2, 2); place(z, 9, 10); z.aware = true; u2.ap = 2;
  const err2 = combatAct(st2, { type: "shove", unit: u2.id, x: 11, y: 10, tx: 10, ty: 10 });
  check(err2 === "" && b2.cells[idx(b2, 10, 10)].k === "locker" && b2.cells[idx(b2, 10, 10)].hp === FURNITURE.locker.hp, `the lockers shoved into the gap in the wall (${err2 || "ok"})`);
  check(!isFinite(reachable(b2, z, 20).dist[idx(b2, 12, 10)]) && !isFinite(distField(b2, [[12, 10]])[idx(b2, 9, 10)]), "a walker cannot crawl over lockers (full cover): no way on foot");
  const fz = distField(b2, [[u2.x, u2.y]], z);
  check(isFinite(fz[idx(b2, z.x, z.y)]) && siegeTarget(b2, z, fz) && siegeTarget(b2, z, fz)[0] === 10 && siegeTarget(b2, z, fz)[1] === 10, "its siege field goes through them at the battering cost and it batters them");
  let blows = 0;
  while (b2.cells[idx(b2, 10, 10)].k === "locker" && blows < 20) { bash(b2, z, 10, 10); blows++; }
  check(b2.cells[idx(b2, 10, 10)].k === "rubble" && blows >= 2 && blows <= 8 && logHas(b2, /break through the lockers|lockers give way/i), `battered down in ${blows} blows: rubble (open floor) where the lockers stood`);
}

console.log("The dead crawl over half cover (CRAWL), never a closed window; people vault");
{
  const st = world();
  const b = battle(st, { kind: "zombies", count: 2 });
  const [u, w] = mine(b);
  const [z, z2] = b.units.filter((x) => x.side === "enemy");
  place(u, 2, 10); place(w, 2, 12);
  fenceLine(b, 10);
  place(z, 12, 10); place(z2, 12, 14); z.mob = ZOMBIE_MOVE; z.ap = 2;
  check(crawls(z) && !canVault(z) && crawlable(b, { k: "fence" }) && crawlable(b, { k: "table" }) && crawlable(b, { k: "shelf" }) && !crawlable(b, { k: "window", win: { open: false, lock: "none" } }) && !crawlable(b, { k: "rack" }) && !crawlable(b, { k: "locker" }) && !crawlable(b, { k: "wall" }), "a walker crawls over a fence, a table, a shelf; never a closed window, tall shelving, lockers or a wall");
  const rz = reachable(b, z, 20);
  check(isFinite(rz.dist[idx(b, 9, 10)]) && rz.dist[idx(b, 9, 10)] === 2 + 1 + CRAWL.COST, `a walker's reach crosses the fence line at 1 + CRAWL.COST a step (${rz.dist[idx(b, 9, 10)]} to the cell past it)`);
  check(!isFinite(rz.dist[idx(b, 10, 10)]), "never ending on the fence");
  check(pathTo(rz, 9, 10).some(([x, y]) => x === 10 && y === 10), "the path goes over the fence cell");
  check(CRAWL.COST > VAULT.COST, `the crawl costs the dead more than a person's vault (${CRAWL.COST} > ${VAULT.COST})`);
  const rs = reachable(b, u, 20);
  check(rs.dist[idx(b, 11, 10)] === 8 + 1 + VAULT.COST, `a survivor vaults it at 1 + VAULT.COST (${rs.dist[idx(b, 11, 10)]})`);
  // The field the dead steer by goes over it; the field of nobody in particular does not.
  const fz = distField(b, [[u.x, u.y]], z);
  check(isFinite(fz[idx(b, z.x, z.y)]) && Math.abs(fz[idx(b, z.x, z.y)] - (10 + CRAWL.COST)) < 1e-6, `distField for a walker goes over the fence at the crawl's cost (${fz[idx(b, z.x, z.y)]}: 10 steps + ${CRAWL.COST})`);
  check(!isFinite(distField(b, [[u.x, u.y]])[idx(b, z.x, z.y)]), "for nobody in particular the fence is a wall");
  // A closed window line: the dead stop; an open one they clamber through at the vault's cost.
  for (let y = 0; y < b.h; y++) { const c = b.cells[idx(b, 10, y)]; c.k = "window"; c.win = { open: false, lock: "none" }; }
  b.losCache.fill(0);
  check(!isFinite(reachable(b, z, 20).dist[idx(b, 9, 10)]), "a line of closed windows: no way through for a walker");
  b.cells[idx(b, 10, 10)].win.open = true;
  check(reachable(b, z, 20).dist[idx(b, 9, 10)] === 2 + 1 + VAULT.COST, `an open one is clambered through at the vault's cost as before (${reachable(b, z, 20).dist[idx(b, 9, 10)]})`);
  // The move: a walker at 3 tiles an action next to a table spends its whole turn getting over it.
  fenceLine(b, 10);
  for (let y = 0; y < b.h; y++) delete b.cells[idx(b, 10, y)].win;
  b.cells[idx(b, 10, 10)].k = "table";
  place(z, 11, 10); z.ap = 2; z.aware = true; z.vaulted = 0;
  const d1 = reachable(b, z, moveMob(z)).dist[idx(b, 9, 10)], d2 = reachable(b, z, moveMob(z) * z.ap).dist[idx(b, 9, 10)];
  check(!isFinite(d1) && isFinite(d2) && d2 === 2 + CRAWL.COST, `over the table to the cell past it: not within one action (${ZOMBIE_MOVE} tiles), within both (${d2} tiles: a step, the crawl, a step)`);
}

console.log("Boards and nails: the item, the recipe");
{
  check(GEAR.boards && GEAR.boards.slot === "pack" && GEAR.boards.bulky && GEAR.boards.weight > 0 && /Board up/.test(GEAR.boards.desc), "GEAR.boards: a bulky pack item that says what it does");
  check(CRAFTS.boards && CRAFTS.boards.gear === "boards" && CRAFTS.boards.in.wood === 30 && CRAFTS.boards.in.scrap === 1 && CRAFTS.boards.field === true && CRAFTS.boards.min === 0, "CRAFTS.boards: 30 firewood and a scrap, by anyone, a team in the field too");
}

console.log("Boarding up a window: a wall for sight and movement, loud, the bundle spent; torn down again");
{
  const st = world();
  const b = battle(st, { kind: "zombies", count: 1 });
  const [u, w] = mine(b);
  const z = b.units.find((x) => x.side === "enemy");
  place(w, 2, 2); place(z, 30, 20); z.aware = false;
  house(b, 10, 8, 7, 6); // x 10..16, y 8..13; the west wall x = 10
  const c = setWindow(b, 10, 10, "none", true);
  place(u, 11, 10); u.ap = 2;
  check(/carries no boards/.test(combatAct(st, { type: "boardup", unit: u.id })), "without boards: refused, and it says what to craft");
  const s = giveBoards(st, u, 4);
  check(boardsOf(st, u) && boardsOf(st, u).item.key === "boards", "with a bundle in a pocket: found");
  check(boardTargets(b, u).length === 1 && boardTargets(b, u)[0].x === 10 && boardTargets(b, u)[0].word === "window", "the window next to the unit can be boarded");
  const saw = los(b, 8, 10, 12, 10);
  u.ap = 1;
  check(/both actions/.test(combatAct(st, { type: "boardup", unit: u.id })), "one action left: refused");
  u.ap = 2;
  let err = combatAct(st, { type: "boardup", unit: u.id });
  check(err === "" && c.k === "boarded" && isBoarded(c) && c.boards === 1 && c.hp === BOARD.HP && c.mhp === BOARD.HP, `boarded up: the cell is "boarded" with ${BOARD.HP} hit points (${err || "ok"})`);
  check(c.under && c.under.k === "window" && c.under.win && boardedName(c) === "Boarded window" && structureName(c) === "Boarded window", "what is under the boards is kept: a window");
  check(u.ap === 0 && s.pockets.filter((it) => it && it.key === "boards").length === 3, "both actions and one bundle spent");
  b.losCache.fill(0);
  check(saw && !los(b, 8, 10, 12, 10), "sight passed the open window; the boards block it");
  check(!CELL.boarded.walk && CELL.boarded.cover === 2 && !windowOpen(c) && !insideOf(b, 10, 10), "nobody stands or climbs there, full cover, nobody's side");
  check(b.noise === BOARD.NOISE && logHas(b, /nails boards across the window/) && logHas(b, /hammering is loud/i), `loud: the raid's noise +${BOARD.NOISE}, the log says so`);
  // Nobody's reach goes through it: the player's, a walker's, a vaulter's.
  place(u, 12, 10); u.ap = 2;
  check(!isFinite(reachable(b, u, 20).dist[idx(b, 9, 10)]), "no way through for your people");
  place(z, 9, 10); z.aware = true;
  check(!isFinite(reachable(b, z, 20).dist[idx(b, 11, 10)]), "nor for a walker on foot");
  const fz = distField(b, [[u.x, u.y]], z);
  check(isFinite(fz[idx(b, z.x, z.y)]) && fz[idx(b, z.x, z.y)] > 2 + BOARD.HP * 0.4, `a walker's siege field goes through it at the battering cost (${fz[idx(b, z.x, z.y)].toFixed(1)})`);
  const tgt = siegeTarget(b, z, fz);
  check(tgt && tgt[0] === 10 && tgt[1] === 10, "and it batters the boards");
  // A second layer, the most layers.
  place(u, 11, 10); u.ap = 2;
  err = combatAct(st, { type: "boardup", unit: u.id, x: 10, y: 10 });
  check(err === "" && c.boards === 2 && c.hp === 2 * BOARD.HP && c.mhp === 2 * BOARD.HP && logHas(b, /2 layers/), `a second bundle adds a layer (${c.hp} hit points) (${err || "ok"})`);
  u.ap = 2;
  err = combatAct(st, { type: "boardup", unit: u.id, x: 10, y: 10 });
  check(err === "" && c.boards === 3, `a third (${err || "ok"})`);
  u.ap = 2;
  check(/Stand right next to|Several/.test(combatAct(st, { type: "boardup", unit: u.id, x: 10, y: 10 })) && c.boards === BOARD.MAX, `no more than ${BOARD.MAX} layers`);
  // Saved and loaded mid-fight: the boards, what is under them, the layers.
  const st2 = loadFromString(saveToString(st));
  const b2 = st2.combat, c2 = b2.cells[idx(b2, 10, 10)];
  check(c2.k === "boarded" && c2.boards === 3 && c2.hp === 3 * BOARD.HP && c2.under && c2.under.k === "window" && !los(b2, 8, 10, 12, 10), "saved and loaded: the boards, the layers and the window under them kept");
  // Torn down from outside: the window back, shut.
  place(u, 9, 10); u.ap = 2;
  check(tearTargets(b, u).length === 1, "the boards next to the unit can be torn down (from outside too)");
  err = combatAct(st, { type: "teardown", unit: u.id });
  check(err === "" && c.k === "window" && c.win && !c.win.open && c.win.lock === "none" && !c.under && !c.boards && c.hp == null && u.ap === 0, `torn down: a closed, unlocked window again, no boards (${err || "ok"})`);
  check(b.noise === 3 * BOARD.NOISE + BOARD.TEAR.noise && logHas(b, /pries the boards off the window/), "quieter than nailing them up; the log says so");
  check(s.pockets.filter((it) => it && it.key === "boards").length === 1, "the bundles are spent, none come back (the fourth, refused, is still there)");
}

console.log("Boarding up a door: on top of its own hit points; the dead batter through it, the door broken in");
{
  const st = world();
  const b = battle(st, { kind: "zombies", count: 1 });
  const [u, w] = mine(b);
  const z = b.units.find((x) => x.side === "enemy");
  place(w, 2, 2);
  house(b, 10, 8, 7, 6);
  const d = setDoor(b, 10, 10, 30);
  giveBoards(st, u, 2);
  place(u, 11, 10); u.ap = 2;
  u.brace = [10, 10]; d.held = u.id;
  let err = combatAct(st, { type: "boardup", unit: u.id });
  check(err === "" && d.k === "boarded" && d.hp === 30 + BOARD.HP && d.mhp === 30 + BOARD.HP && d.under.k === "idoor" && d.under.dk === "wood" && boardedName(d) === "Boarded door", `a closed door boarded: its own 30 and the boards' ${BOARD.HP} (${err || "ok"})`);
  check(!u.brace && d.held == null, "nobody braces it any more: the boards hold it");
  check(!isFinite(reachable(b, u, 20).dist[idx(b, 9, 10)]), "the door is closed to your own people too until the boards come down");
  // The dead batter it down: the boards go, and the door with them.
  place(z, 9, 10); z.aware = true; place(u, 14, 10);
  let blows = 0;
  while (d.k === "boarded" && blows < 30) { bash(b, z, 10, 10); blows++; }
  check(d.k === "doorway" && !d.under && !d.boards && blows >= 4 && blows <= 12 && logHas(b, /break through the boarded door/i), `battered through in ${blows} blows: a broken door (doorway), the boards gone`);
  check(isFinite(reachable(b, z, 20).dist[idx(b, 12, 10)]), "the walker comes in through it");
  // A doorway boarded: the boards alone; torn down, a doorway again.
  u.ap = 2; place(u, 11, 10); z.aware = false; place(z, 30, 20);
  err = combatAct(st, { type: "boardup", unit: u.id, x: 10, y: 10 });
  check(err === "" && d.k === "boarded" && d.hp === BOARD.HP && d.under.k === "doorway", `a broken door's frame boarded: the boards' ${BOARD.HP} alone (${err || "ok"})`);
  u.ap = 2;
  err = combatAct(st, { type: "teardown", unit: u.id, x: 10, y: 10 });
  check(err === "" && d.k === "doorway" && !d.under, `torn down: an open doorway again (${err || "ok"})`);
  // A boarded window battered through ends broken (the glass's crash).
  const wc = setWindow(b, 10, 11, "fixed");
  giveBoards(st, u, 1); u.ap = 2; place(u, 11, 11);
  err = combatAct(st, { type: "boardup", unit: u.id, x: 10, y: 11 });
  check(err === "" && wc.k === "boarded", `a fixed window boarded (${err || "ok"})`);
  place(z, 9, 11); z.aware = true; place(u, 14, 10);
  blows = 0;
  while (wc.k === "boarded" && blows < 30) { bash(b, z, 10, 11); blows++; }
  check(wc.k === "smashed" && !wc.win && !wc.under && windowOpen(wc), `a boarded window battered through (${blows} blows) ends broken: clambered through`);
}

console.log("The enemy turn with the dead coming on over fences and a shoved table");
{
  const st = world();
  const b = battle(st, { kind: "zombies", count: 6, fighters: 3 });
  const ps = mine(b);
  ps.forEach((p, i) => place(p, 3, 8 + i * 2));
  for (let x = 8; x < b.w - 4; x += 3) fenceLine(b, x);
  b.cells[idx(b, 8, 9)].k = "table"; b.cells[idx(b, 8, 9)].hp = b.cells[idx(b, 8, 9)].mhp = FURNITURE.table.hp; b.cells[idx(b, 8, 9)].moved = true;
  const zs = b.units.filter((x) => x.side === "enemy");
  zs.forEach((z, i) => { place(z, b.w - 3, 6 + i * 2); z.aware = true; });
  const d0 = zs.map((z) => z.x);
  let threw = null;
  const t0 = Date.now();
  try { endPlayerTurn(st); runEnemyPhase(st); } catch (e) { threw = e; }
  const ms = Date.now() - t0;
  check(!threw, `the enemy turn completes (${threw ? threw.message : "ok"})`);
  check(b.phase === "player" || b.over, "the player's turn comes round");
  const moved = zs.filter((z, i) => z.x < d0[i]).length;
  check(moved >= 3, `the dead come on westward over the fences (${moved} of ${zs.length} moved, ${ms} ms)`);
  check(zs.every((z) => CELL[b.cells[idx(b, z.x, z.y)].k].walk), "nobody of the dead stands on a fence or the table");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
