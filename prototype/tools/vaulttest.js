// Vaulting half cover (src/sim/combat.js VAULT, vaultable, canVault, reachable, distField, moveAlong, moveMob; the
// user's request of 2026-10-17): a survivor and a human enemy cross a fence line a walker cannot; the end cell is
// never the fence; the step over it costs 1 + VAULT.COST; nobody vaults with a bag in their arms; the Climber's own
// way over (middead.js climbOver) still works; a vault is a scuff and the raid's noise (b.noise), and leaves the unit
// winded (VAULT.COST tiles less of movement for the rest of the turn, cleared by the next); a mid-fight save and load
// keeps it; the enemy turn completes on a map full of fences, and the human AI's field goes over them.
// Usage: node tools/vaulttest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import {
  createBattle, combatAct, registerCombatHandler, reachable, pathTo, distField, endPlayerTurn, runEnemyPhase, moveMob,
  dashRange, VAULT, MOVE, CELL, vaultable, canVault,
} from "../src/sim/combat.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
registerCombatHandler("vault", () => {});
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; return st; };
// An open battle map (every cell open ground, by day), your people in the player phase.
function battle(st, { count = 1, kind = "raiders", fighters = 2 } = {}) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, fighters).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind, count, power: 3, name: "Test" }, ambush: "player", canRetreat: false, handler: "vault", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; delete c.h; delete c.t; delete c.hp; delete c.mhp; }
  b.lit = null; b.floodAim = null; b.flares = [];
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  b.noise = 0;
  return b;
}
const idx = (b, x, y) => y * b.w + x;
const place = (u, x, y) => { u.x = x; u.y = y; };
// A fence down the whole map at column x: no way round it.
const fenceLine = (b, x) => { for (let y = 0; y < b.h; y++) b.cells[idx(b, x, y)].k = "fence"; };
const logHas = (b, re) => b.log.some((l) => re.test(l.text));

console.log("The vaultable cells");
{
  const st = world();
  const b = battle(st);
  const kinds = (ks) => ks.map((k) => vaultable(b, { k }));
  check(kinds(["fence", "crate", "car", "sandbag", "hay", "rock", "table", "counter", "barrel", "window", "smashed"]).every(Boolean), "a fence, crates, a car, sandbags, hay, a rock, a table, a counter, barrels, a window (open, closed or broken: windows.js): vaultable");
  check(!kinds(["wall", "tree", "boulder", "door", "open", "tanktrap", "bars", "rail", "well", "spikes"]).some(Boolean), "a wall, a tree, a door, open ground, a tank trap, cell bars, a railing, a well, a trap: not");
  check(!vaultable(b, { k: "car", car: { up: { p: 1 } } }) && vaultable(b, { k: "car", car: {} }), "a plated vehicle is full cover, not vaulted; a plain car is");
  const [u] = b.units.filter((x) => x.side === "player");
  const e = b.units.find((x) => x.side === "enemy");
  check(canVault(u) && canVault(e), "a survivor and a human enemy can vault");
  check(!canVault({ ...u, bag: newItem("duffle") }) && !canVault({ ...u, hands: { food: 2 } }) && !canVault({ ...u, carrying: 3 }) && !canVault({ ...u, dragging: 3 }) && !canVault({ ...u, down: true }), "not with a bag or supplies in the arms, carrying or dragging someone, or down");
  check(!canVault({ ...e, kind: "zombie" }), "never the dead");
}

console.log("A fence line between two open cells");
{
  const st = world();
  const b = battle(st);
  const [u, w] = b.units.filter((x) => x.side === "player");
  const e = b.units.find((x) => x.side === "enemy");
  place(w, 2, 2); place(e, 30, 20); e.aware = false;
  place(u, 8, 10);
  const open = reachable(b, u, 20).dist[idx(b, 11, 10)];
  fenceLine(b, 10);
  const r = reachable(b, u, 20);
  check(isFinite(r.dist[idx(b, 11, 10)]) && isFinite(r.dist[idx(b, 14, 12)]), "a survivor's reach crosses the fence");
  check(r.dist[idx(b, 11, 10)] === open + VAULT.COST && r.dist[idx(b, 11, 10)] === 2 + 1 + VAULT.COST, `the step over it costs 1 + VAULT.COST (${r.dist[idx(b, 11, 10)]} to the cell past it, ${open} on open ground)`);
  check(!isFinite(r.dist[idx(b, 10, 10)]) && !isFinite(r.dist[idx(b, 10, 9)]), "the fence itself is never the end of a move");
  check(pathTo(r, 11, 10).some(([x, y]) => x === 10 && y === 10), "the path goes over the fence cell");
  check(pathTo(r, 11, 11).length === 3 && pathTo(r, 11, 11).some(([x]) => x === 10), "no corner cutting: the way to the far diagonal goes over the fence, not past its corner");
  // The enemy's reach (a human) crosses the same way; a walker's never.
  place(e, 12, 10);
  const re = reachable(b, e, 20);
  check(isFinite(re.dist[idx(b, 9, 10)]) && re.dist[idx(b, 9, 10)] === 2 + 1 + VAULT.COST && !isFinite(re.dist[idx(b, 10, 10)]), "a human enemy vaults it the same way, never stopping on it");
  // A bag in the arms: no vault.
  u.bag = newItem("duffle");
  check(!isFinite(reachable(b, u, 20).dist[idx(b, 11, 10)]), "with a bag in the arms the fence is a wall");
  delete u.bag;
  u.hands = { food: 2 };
  check(!isFinite(reachable(b, u, 20).dist[idx(b, 11, 10)]), "with supplies in the arms too");
  delete u.hands;
  check(isFinite(reachable(b, u, 20).dist[idx(b, 11, 10)]), "arms free again: over it");
  // The field the human AI steers by goes over it; a walker's does not.
  const fe = distField(b, [[u.x, u.y]], e);
  check(isFinite(fe[idx(b, e.x, e.y)]) && Math.abs(fe[idx(b, e.x, e.y)] - (4 + VAULT.COST)) < 1e-6, `distField for a person goes over the fence at the vault's cost (${fe[idx(b, e.x, e.y)]}: 4 steps + ${VAULT.COST})`);
  check(!isFinite(distField(b, [[u.x, u.y]], { ...e, kind: "zombie" })[idx(b, e.x, e.y)]) && !isFinite(distField(b, [[u.x, u.y]])[idx(b, e.x, e.y)]), "for a walker, and for nobody in particular, the fence is a wall");
}

console.log("The dead: a walker stops, the Climber goes over its own way");
{
  const st = world();
  const b = battle(st, { kind: "zombies", count: 2 });
  const [u, w] = b.units.filter((x) => x.side === "player");
  const [z, c] = b.units.filter((x) => x.side === "enemy");
  place(u, 2, 2); place(w, 2, 4);
  fenceLine(b, 10);
  place(z, 12, 10); place(c, 12, 14);
  check(!canVault(z) && !isFinite(reachable(b, z, 20).dist[idx(b, 9, 10)]), "a walker cannot cross the fence line");
  c.ztype = "climber";
  const rc = reachable(b, c, 20);
  check(isFinite(rc.dist[idx(b, 9, 14)]) && !isFinite(rc.dist[idx(b, 10, 14)]), "a Climber still goes over it (climbOver), not stopping on it");
}

console.log("The move: a vault, its noise, winded after");
{
  const st = world();
  const b = battle(st);
  const [u, w] = b.units.filter((x) => x.side === "player");
  const e = b.units.find((x) => x.side === "enemy");
  place(w, 2, 2); place(e, 30, 20); e.aware = false;
  place(u, 8, 10); u.ap = 2; u.sneaking = false; u.mob = MOVE; // mob: unloaded (carrykit.js weighPlayer sets it by the load band)
  fenceLine(b, 10);
  check(combatAct(st, { type: "move", unit: u.id, x: 10, y: 10 }) === "Cannot move there.", "a move onto the fence is refused");
  const err = combatAct(st, { type: "move", unit: u.id, x: 11, y: 10 });
  check(err === "" && u.x === 11 && u.y === 10, `a move over it lands past it (${err || "ok"})`);
  check(u.ap === 1, `within one action's tiles (2 + 1 + ${VAULT.COST} of ${MOVE}): 1 action`);
  check(u.vaulted === VAULT.COST && moveMob(u) === MOVE - VAULT.COST, `winded: ${VAULT.COST} tiles less of movement for the rest of the turn (moveMob ${moveMob(u)})`);
  check(dashRange(u) === MOVE - VAULT.COST, "the reach for the next move is the shorter one");
  check(b.noise === VAULT.NOISE, `the raid's noise rises by VAULT.NOISE (${b.noise})`);
  check(logHas(b, /vaults the fence/), "the log says so");
  check(b.fx.some((f) => f.type === "noise" && f.kind === "scuff"), "a scuff is heard");
  const r2 = reachable(b, u, moveMob(u) * u.ap);
  let far = 0;
  for (let i = 0; i < b.w * b.h; i++) if (isFinite(r2.dist[i])) far = Math.max(far, r2.dist[i]);
  check(far === MOVE - VAULT.COST, `the reach bands' one-action band stops at ${MOVE - VAULT.COST} tiles now`);
  // A sneaking unit vaults at the sneak pace, silently (but the raid's noise still counts it).
  const st2 = world();
  const b2 = battle(st2);
  const [u2, w2] = b2.units.filter((x) => x.side === "player");
  const e2 = b2.units.find((x) => x.side === "enemy");
  place(w2, 2, 2); place(e2, 30, 20); e2.aware = false;
  place(u2, 8, 10); u2.ap = 2; u2.sneaking = true; u2.mob = MOVE;
  fenceLine(b2, 10);
  const n0 = b2.fx.filter((f) => f.type === "noise").length;
  const err2 = combatAct(st2, { type: "move", unit: u2.id, x: 11, y: 10 });
  check(err2 === "" && u2.x === 11 && u2.vaulted === VAULT.COST && b2.noise === VAULT.NOISE, `sneaking, the vault still works (${err2 || "ok"})`);
  check(b2.fx.filter((f) => f.type === "noise").length === n0, "and makes no scuff");
  // A mid-fight save keeps the state.
  const st3 = loadFromString(saveToString(st));
  const b3 = st3.combat;
  const u3 = b3.units.find((x) => x.id === u.id);
  check(!!u3 && u3.vaulted === VAULT.COST && moveMob(u3) === MOVE - VAULT.COST && b3.cells[idx(b3, 10, 10)].k === "fence" && b3.noise === VAULT.NOISE, "saved and loaded mid-fight: still winded, the fence and the noise kept");
  check(isFinite(reachable(b3, u3, 20).dist[idx(b3, 8, 10)]) && !isFinite(reachable(b3, u3, 20).dist[idx(b3, 10, 10)]), "and the loaded battle paths over the fence as before");
  // The next turn clears it.
  endPlayerTurn(st);
  runEnemyPhase(st);
  check(b.phase === "player" && !u.vaulted && moveMob(u) === MOVE, "a fresh turn: no longer winded");
}

console.log("The enemy turn on a map full of fences");
{
  const st = world();
  const b = battle(st, { kind: "raiders", count: 4, fighters: 2 });
  const mine = b.units.filter((x) => x.side === "player");
  const theirs = b.units.filter((x) => x.side === "enemy");
  for (let x = 3; x < b.w - 2; x += 2) fenceLine(b, x); // fences down every other column
  mine.forEach((u, i) => place(u, 0, 2 + i * 3));
  theirs.forEach((e, i) => { place(e, b.w - 1, 2 + i * 3); e.aware = true; });
  const start = theirs.map((e) => [e.x, e.y]);
  const t0 = Date.now();
  let threw = null;
  try { endPlayerTurn(st); runEnemyPhase(st); } catch (err) { threw = err; }
  const ms = Date.now() - t0;
  check(!threw && b.phase === "player", `the enemy turn completes (${threw ? threw.message : `${ms} ms`})`);
  check(ms < 8000, `in reasonable time (${ms} ms)`);
  const moved = theirs.filter((e, i) => e.x !== start[i][0] || e.y !== start[i][1]);
  check(moved.length > 0 && theirs.every((e) => CELL[b.cells[idx(b, e.x, e.y)].k].walk), `they come on over the fences (${moved.length} moved) and nobody stands on one`);
  check(theirs.some((e) => e.x < b.w - 2), "at least one of them is past the first fence");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
