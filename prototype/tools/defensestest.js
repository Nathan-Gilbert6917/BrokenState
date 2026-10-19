// Defenses (the user's requests of 2026-10-19): a Defenses tab in Construction for every size of base, the first
// defenses at a camp and more as the base grows (src/sim/buildings.js tab "defenses", size, DEF_SIZE); no wall a base
// did not build (baseWalls); the wall built up a tier at a time where it stands (WALL_TIERS: a stake fence, a timber
// palisade, a scrap-metal wall, a concrete wall), each with more wall strength and more hit points on the battle map
// (since the same day: a ring of wall pieces of a material, wood to metal sheets: tools/wallpiecestest.js);
// barbed wire and concertina wire that slow the living too unless they carry something to cut it with (src/sim/wire.js:
// a multitool, a repair kit's pliers, an axe, a hatchet, a machete), Cut wire; trenches that slow the dead more than the
// living; and every defense built standing on the base's battle map when it is raided (fort.js, interior.js, deploy.js).
// Usage: node tools/defensestest.js [seed]
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import {
  BUILDINGS, WALL_TIERS, count, canBuild, queueBuild, constructionHour, baseWalls, wallOf, wallTier, wallSectionHp, placeProblem, migrateWalls, addBuilding, cancelBuild, demolishRefund,
  piecesOf, hasWall,
} from "../src/sim/buildings.js";
import { holdLimit, defenceMult, tierMults, DEFENCE } from "../src/sim/defences.js";
import { baseDefense } from "../src/sim/factions.js";
import { createBattle, combatAct, registerCombatHandler, moveAlong, CELL } from "../src/sim/combat.js";
import { WIRE, cutterOf, cutTargets, wireStep } from "../src/sim/wire.js";
import { wallHp } from "../src/sim/deploy.js";
import { newItem, ensureInv } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { renderModal } from "../src/ui/ui.js";
import { MINES, minesLeft, minesKill, spendMines, settleMines, raidMines } from "../src/sim/mines.js";
import { hordeAttackBase, holdCheck, pitsOnRaid } from "../src/sim/defences.js";
import { SPIKES } from "../src/sim/combat.js";
import { makeHorde } from "../src/sim/hordes.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
registerCombatHandler("deftest", () => {});
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; return st; };
const rich = (base) => Object.assign(base.stock, { scrap: 999, parts: 99, buildmat: 99, electronics: 9, wood: 99999 });
const asCamp = (base) => { base.tier = 0; base.camp = true; return base; };
const asShelter = (base) => { base.tier = 0; delete base.camp; return base; };
const asOutpost = (base) => { delete base.tier; delete base.camp; base.type = "outpost"; return base; };
// Finishes every job in the queue (as the builders would).
const finishAll = (st, base) => { for (let i = 0; i < 40 && base.construction.length; i++) { for (const j of base.construction) j.progress = j.hours; constructionHour(st); } };
const skilled = (st, base, sk, n) => { const s = atBase(st, base.id)[0]; s.skills[sk] = Math.max(s.skills[sk] || 0, n); };

console.log("No free wall");
{
  const st = world();
  const h = hub(st);
  check(!wallOf(h) && baseWalls(h) === 0 && wallTier(h) === 0, `a new main base has no wall (strength ${baseWalls(h)})`);
  check(holdLimit(st, h) >= DEFENCE.WALL_BASE && wallHp(h) === 40, "the hold limit is the guards' and the bare 15; a section's hit points fall back to the bare 40");
}

console.log("The Defenses tab: what each size of base takes");
{
  const st = world();
  const h = hub(st);
  const defs = Object.entries(BUILDINGS).filter(([, d]) => d.tab === "defenses").map(([k]) => k);
  check(["walls", "barbed_wire", "trench", "spike_pits", "barricades", "sandbag_wall", "razor_wire", "guard_towers", "minefield", "gate", "floodlights"].every((k) => defs.includes(k)), `the list: ${defs.join(", ")}`);
  check(defs.every((k) => BUILDINGS[k].size), "every defense names the smallest base that takes it");
  const at = (base) => defs.filter((k) => !placeProblem(base, k));
  asCamp(h);
  const camp = at(h);
  check(["walls", "barbed_wire", "trench", "spike_pits", "barricades"].every((k) => camp.includes(k)) && !camp.includes("sandbag_wall") && !camp.includes("razor_wire"), `a camp: ${camp.join(", ")}`);
  check(placeProblem(h, "sandbag_wall") === "Opens at a shelter" && /outpost/.test(placeProblem(h, "razor_wire")) && placeProblem(h, "guard_towers") === "Opens at the main base", "the rest say where they open");
  asShelter(h);
  const shelter = at(h);
  check(shelter.length > camp.length && shelter.includes("sandbag_wall") && shelter.includes("watchtower"), `a shelter: ${shelter.length} (a camp ${camp.length})`);
  asOutpost(h);
  const outpost = at(h);
  check(outpost.length > shelter.length && outpost.includes("razor_wire") && outpost.includes("gate") && !outpost.includes("guard_towers"), `an outpost: ${outpost.length}`);
  h.type = "hub";
  check(at(h).length > outpost.length && at(h).includes("guard_towers"), `the main base: ${at(h).length}`);
}

console.log("Walls by material, a ring of pieces closed and raised (tools/wallpiecestest.js has the pieces themselves)");
{
  const st = world();
  const h = asCamp(hub(st));
  rich(h);
  let c = canBuild(st, h, "walls");
  check(c.ok && c.kind === "ring" && c.tier === 1 && c.def.name === "Wooden wall", "a camp closes a ring of wooden pieces");
  const wood0 = h.stock.wood;
  queueBuild(st, h, "walls");
  check(h.stock.wood === wood0 && !canBuild(st, h, "walls").ok, `queued (${c.cost.wood} firewood, taken as the work goes); the next step waits for this one`);
  finishAll(st, h);
  check(hasWall(h) && wallTier(h) === 1 && baseWalls(h) === 2 && wallSectionHp(h) === 60 && wallHp(h) === 60, `standing: strength ${baseWalls(h)}, ${wallHp(h)} hp a cell`);
  c = canBuild(st, h, "walls");
  check(!c.ok && c.kind === "upgrade" && c.tier === 2 && /shelter/.test(c.reason), `a camp goes no further: ${c.reason}`);
  asShelter(h);
  check(canBuild(st, h, "walls").ok, "a shelter raises it to logs");
  queueBuild(st, h, "walls");
  const job = h.construction.find((j) => j.type === "walls");
  check(job && job.kind === "upgrade" && job.mat === 2 && job.ids.length === piecesOf(h).length, "an upgrade job on every piece standing");
  finishAll(st, h);
  check(!h.buildings.some((b) => b.type === "walls") && wallTier(h) === 2 && baseWalls(h) === 4 && wallHp(h) === 100, "the pieces are logs now (4, 100 hp)");
  check(!canBuild(st, h, "walls").ok, "scrap metal opens at an outpost");
  h.tier = undefined; h.type = "outpost"; delete h.tier;
  queueBuild(st, h, "walls"); finishAll(st, h);
  check(wallTier(h) === 3 && baseWalls(h) === 8 && wallHp(h) === 160, "an outpost: scrap metal (8, 160 hp)");
  const c4 = canBuild(st, h, "walls");
  check(!c4.ok && /main base/.test(c4.reason), "metal sheets: the main base only");
  h.type = "hub";
  for (const s of atBase(st, h.id)) s.skills.mechanics = 0;
  check(/Mechanics 3/.test(canBuild(st, h, "walls").reason), "metal sheets need a Mechanics 3+ survivor here");
  skilled(st, h, "mechanics", 3);
  queueBuild(st, h, "walls"); finishAll(st, h);
  check(wallTier(h) === 4 && baseWalls(h) === 12 && wallHp(h) === 240, "the main base: metal sheets (12, 240 hp)");
  check(canBuild(st, h, "walls").top, "the best there is");
  for (const p of piecesOf(h)) p.wear = 70;
  check(baseWalls(h) === 8 && wallHp(h) === 160, "damaged: two thirds of the strength and the hit points");
  const p = piecesOf(h, ["wall"]).find((x) => x.type === "wall4");
  const back = demolishRefund(p);
  check(back.scrap === 1 && back.buildmat === undefined, `a 1×4 of metal sheets pulled down: half its scrap back (${back.scrap}; its building materials are not salvaged)`);
}

console.log("Defenses count: the hold limit, raids by the numbers");
{
  const st = world();
  const h = hub(st);
  const before = { hold: holdLimit(st, h), mult: defenceMult(st, h), def: baseDefense(st, h), t: tierMults(st, h) };
  for (const k of ["walls", "barbed_wire", "barbed_wire", "razor_wire", "sandbag_wall", "trench", "trench", "guard_towers"]) addBuilding(h, k);
  const after = { hold: holdLimit(st, h), mult: defenceMult(st, h), def: baseDefense(st, h), t: tierMults(st, h) };
  check(after.hold > before.hold && after.mult > before.mult + 0.5, `the hold limit ${before.hold} → ${after.hold} (×${before.mult.toFixed(2)} → ×${after.mult.toFixed(2)})`);
  check(after.def > before.def && after.t.wall > before.t.wall && after.t.yard > before.t.yard, "raids: the wall's defense and the wall and yard tiers rise");
}

console.log("Saves: walls from before the tiers");
{
  const st = world();
  const h = hub(st);
  for (let i = 0; i < 3; i++) h.buildings.push({ id: 9000 + i, type: "walls", wear: i * 10 });
  migrateWalls(st);
  check(!wallOf(h) && wallTier(h) === 4 && piecesOf(h).every((b) => b.wear === 20), "three old sections: a ring of metal-sheet pieces (the worst wear)");
  const st2 = world();
  hub(st2).buildings.push({ id: 9100, type: "walls" });
  const back = loadFromString(saveToString(st2));
  check(wallTier(hub(back)) === 2 && !wallOf(hub(back)), "a save with one old section loads as a ring of log pieces");
  const n = piecesOf(hub(back)).length;
  migrateWalls(back);
  check(wallTier(hub(back)) === 2 && piecesOf(hub(back)).length === n, "and again: nothing changes");
}

// A raid on the main base with its defenses built (the battle map as the browser gets it: the deploy step).
function raid(st, base, context = {}, kind = "raiders") {
  globalThis.window = {};
  try {
    const ids = atBase(st, base.id).slice(0, 3).map((s) => s.id);
    return (st.combat = createBattle(st, { tile: base.tile, baseId: base.id, fighterIds: ids, enemy: { kind, count: 5, power: 3, name: "Raiders" }, ambush: null, canRetreat: true, handler: "deftest", layout: "baseDefence", deploy: true, context: { night: false, ...context } }));
  } finally { delete globalThis.window; }
}
const cells = (b, k, test = () => true) => b.cells.filter((c) => c.k === k && test(c)).length;

console.log("Raided: the defenses stand on the battle map");
{
  const st = world();
  const h = hub(st);
  const bare = raid(st, h);
  check(!cells(bare, "palisade") && !cells(bare, "wire") && !cells(bare, "trench"), "no defenses built: no wall, no wire, no trench on the map");
  st.combat = null;
  for (const k of ["walls", "walls", "barbed_wire", "barbed_wire", "razor_wire", "trench", "trench", "sandbag_wall", "sandbag_wall", "guard_towers"]) addBuilding(h, k);
  const b = raid(st, h);
  const wall = b.cells.filter((c) => c.k === "palisade");
  check(wall.length > 0 && wall.every((c) => c.mhp === WALL_TIERS[2].hp), `the fort map: the timber palisade's sections at ${WALL_TIERS[2].hp} hp (${wall.length})`);
  check(cells(b, "wire", (c) => !c.razor) > 40 && cells(b, "wire", (c) => c.razor) > 20, `barbed wire rings (${cells(b, "wire", (c) => !c.razor)}) and concertina wire (${cells(b, "wire", (c) => c.razor)})`);
  check(cells(b, "trench") > 30, `the trenches (${cells(b, "trench")} cells)`);
  check(cells(b, "sandbag") >= 8, `sandbag positions (${cells(b, "sandbag")} cells)`);
  check(b.deployPlan.fort.towers.length >= 2 && cells(b, "tower") >= 2, "the guard towers on the walkway");
  const F = b.deployPlan.fort, w = F.wall;
  const out = b.units.filter((u) => u.side === "enemy").every((u) => Math.max(w.x0 - u.x, u.x - w.x1, w.y0 - u.y, u.y - w.y1) > F.wireOut);
  check(out, `the raiders start beyond the wire (${F.wireOut} cells out)`);
  st.combat = null;
  // Without a wall: the yard map, the lines in front of the yard.
  const st2 = world();
  const h2 = hub(st2);
  for (const k of ["barbed_wire", "razor_wire", "trench", "sandbag_wall"]) addBuilding(h2, k);
  const b2 = raid(st2, h2);
  // The base map (sim/basemap.js): a base without walls fights on its own map, the wire rings round its yard, the trench where it was placed.
  check(b2.tier.map === "fort" && !b2.tier.walled && cells(b2, "wire") > 10 && cells(b2, "wire", (c) => c.razor) > 5 && cells(b2, "trench") > 5, "no wall: the base map with wire rings, concertina wire and a trench");
  st2.combat = null;
  // The old wall-line map (a bridge, the tests' strip).
  const st3 = world();
  const h3 = hub(st3);
  for (const k of ["walls", "walls", "walls", "barbed_wire", "razor_wire", "trench", "guard_towers"]) addBuilding(h3, k);
  const b3 = raid(st3, h3, { strip: true });
  check(cells(b3, "palisade", (c) => c.mhp === WALL_TIERS[3].hp) > 0 && cells(b3, "wire") > 5 && cells(b3, "tower") >= 2, "the wall-line map: the scrap-metal wall, the wire, the guard towers");
}

// An open map for the wire and the trench: one of yours, a raider, one of the dead.
function field(st) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, 1).map((s) => s.id);
  const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind: "raiders", count: 1, power: 3, name: "Test" }, ambush: "player", canRetreat: false, handler: "deftest", context: {} }));
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; delete c.razor; }
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  return b;
}
const at = (b, x, y) => b.cells[y * b.w + x];

console.log("Wire: the dead stopped, the living snagged unless they cut it");
{
  const st = world();
  const b = field(st);
  const u = b.units.find((x) => x.side === "player"), e = b.units.find((x) => x.side === "enemy");
  const s = survivorById(st, u.sid);
  ensureInv(s);
  for (const k of Object.keys(s.gear)) if (s.gear[k] && ["multitool", "repairkit", "fireaxe", "hatchet", "machete", "sawmachete"].includes(s.gear[k].key)) s.gear[k] = null;
  s.pockets = s.pockets.map((it) => (it && ["multitool", "repairkit"].includes(it.key) ? null : it));
  u.cutter = 0; e.cutter = 0; e.weapon = "pistol";
  u.x = 5; u.y = 5; u.ap = 2; e.x = 20; e.y = 20;
  at(b, 7, 5).k = "wire";
  const hp0 = u.hp;
  moveAlong(b, u, [[6, 5], [7, 5], [8, 5]]);
  check(u.x === 7 && u.ap === 0 && u.hp < hp0 && at(b, 7, 5).k === "wire", `no cutter: snagged on the wire (−${Math.round((hp0 - u.hp) * 10) / 10}, the rest of the turn)`);
  // A multitool in a pocket.
  s.pockets[0] = newItem("multitool");
  u.cutter = cutterOf(st, u) ? "multitool" : 0;
  check(cutterOf(st, u) && cutterOf(st, u).key === "multitool", "a multitool cuts wire");
  u.x = 5; u.y = 8; u.ap = 2; at(b, 7, 8).k = "wire";
  const hp1 = u.hp;
  moveAlong(b, u, [[6, 8], [7, 8], [8, 8]]);
  check(u.x === 7 && u.hp === hp1 && at(b, 7, 8).k === "open", "with it: cut through, no cuts, the move ends there");
  // Cut wire next to them.
  u.x = 5; u.y = 11; u.ap = 2; at(b, 6, 11).k = "wire"; at(b, 6, 11).razor = true;
  check(cutTargets(b, u).length === 1, "Cut wire: the wire right next to them");
  const err = combatAct(st, { type: "cutwire", unit: u.id, x: 6, y: 11 });
  check(!err && at(b, 6, 11).k === "open" && u.ap === 2 - WIRE.AP, `cut away for ${WIRE.AP} action`);
  // Without a cutter it is refused.
  s.pockets[0] = null; u.cutter = 0; at(b, 6, 11).k = "wire";
  check(!!combatAct(st, { type: "cutwire", unit: u.id, x: 6, y: 11 }) && at(b, 6, 11).k === "wire", "nothing to cut it with: refused");
  // The raider with snips cuts through; one of the dead stops.
  e.cutter = 1; e.x = 10; e.y = 14; e.ap = 2; at(b, 12, 14).k = "wire";
  moveAlong(b, e, [[11, 14], [12, 14], [13, 14]]);
  check(e.x === 12 && at(b, 12, 14).k === "open" && e.ap > 0, "a raider with snips cuts through");
  const z = { ...e, id: 999, kind: "zombie", name: "Walker", hp: 40, maxHp: 40, cutter: 0, x: 10, y: 17, ap: 2 };
  b.units.push(z);
  at(b, 12, 17).k = "wire"; at(b, 12, 17).razor = true;
  moveAlong(b, z, [[11, 17], [12, 17], [13, 17]]);
  check(z.x === 12 && z.ap === 0 && z.hp < 40 && at(b, 12, 17).k === "wire", "one of the dead: stopped for the turn and cut by the razor wire");
  check(wireStep(st, b, z, 12, 17, { say() {}, damage() { return 0; } }) === false, "the dead never cut wire");
}

console.log("Trenches slow the dead more than the living");
{
  const st = world();
  const b = field(st);
  const u = b.units.find((x) => x.side === "player");
  u.x = 5; u.y = 5; u.ap = 1;
  at(b, 7, 5).k = "trench";
  moveAlong(b, u, [[6, 5], [7, 5], [8, 5]]);
  check(u.x === 7 && u.ap === 1, "the living: the move ends in the trench, the next action kept");
  moveAlong(b, u, [[8, 5], [9, 5]]);
  check(u.x === 9, "and climb out with it");
  const z = { ...u, id: 998, side: "enemy", kind: "zombie", name: "Walker", sid: undefined, x: 5, y: 9, ap: 2, hp: 40, maxHp: 40 };
  b.units.push(z);
  at(b, 7, 9).k = "trench";
  moveAlong(b, z, [[6, 9], [7, 9], [8, 9]]);
  check(z.x === 7 && z.ap === 0, "the dead: the rest of their turn lost");
  check(CELL.trench.trap === "trench" && BUILDINGS.trench.size === "camp" && BUILDINGS.trench.max === 2, "any base digs a trench, two lines at most");
}

console.log("Spike pits hurt raiders too");
{
  const st = world();
  const b = field(st);
  const u = b.units.find((x) => x.side === "player"), e = b.units.find((x) => x.side === "enemy");
  e.x = 5; e.y = 5; e.ap = 2; at(b, 7, 5).k = "spikes";
  const hp0 = e.hp;
  moveAlong(b, e, [[6, 5], [7, 5], [8, 5]]);
  check(e.x === 7 && e.hp < hp0 && e.ap > 0, `a raider falls in: hurt (−${Math.round(hp0 - e.hp)}), the move ends in the pit, the next action kept to climb out`);
  e.dead = true; // (the raider off the map: a foe seen on the way would stop the walk, and this is about the pit)
  u.x = 5; u.y = 8; u.ap = 2; at(b, 7, 8).k = "spikes";
  const hp1 = u.hp;
  moveAlong(b, u, [[6, 8], [7, 8], [8, 8]]);
  check(u.x === 8 && u.hp === hp1, "one of yours walks over the pit: they know where it is");
  const z = { ...e, id: 997, kind: "zombie", name: "Walker", hp: 60, maxHp: 60, x: 5, y: 11, ap: 2, dead: false, down: false };
  b.units.push(z);
  at(b, 7, 11).k = "spikes";
  moveAlong(b, z, [[6, 11], [7, 11], [8, 11]]);
  check(z.hp < 60 && z.hp >= 60 - SPIKES.DEAD[1], "one of the dead is impaled as before");
  // The raid's battle map has the pits standing (a horde's had them used up on the way: defences.js).
  st.combat = null;
  const st2 = world();
  const h2 = hub(st2);
  addBuilding(h2, "walls"); addBuilding(h2, "spike_pits"); addBuilding(h2, "spike_pits");
  const b2 = raid(st2, h2);
  check(cells(b2, "spikes") >= 5, `a raid on a walled base meets the pits (${cells(b2, "spikes")} cells)`);
  st2.combat = null;
  const st3 = world();
  const h3 = hub(st3);
  addBuilding(h3, "spike_pits");
  check(cells(raid(st3, h3), "spikes") >= 3, "and without a wall, across the yard's approach");
  let dead = 0;
  for (let i = 0; i < 200; i++) dead += pitsOnRaid(st3, h3);
  check(dead > 60 && dead < 140 && count(h3, "spike_pits") === 1, `a raid by the numbers loses a raider half the time a pit (${dead} in 200), the pits stay`);
}

console.log("Cancelling a wall upgrade");
{
  const st = world();
  const h = hub(st);
  rich(h);
  addBuilding(h, "walls");
  const scrap0 = h.stock.scrap;
  queueBuild(st, h, "walls");
  cancelBuild(st, h, h.construction[0].id);
  check(h.stock.scrap === scrap0 && wallTier(h) === 1, "an untouched upgrade cancelled: everything back, the wall as it was");
}

console.log("Land mines: the main base's minefield");
{
  const st = world();
  const h = hub(st);
  rich(h);
  for (const s of atBase(st, h.id)) s.skills.mechanics = 0;
  check(/Mechanics 4/.test(canBuild(st, h, "minefield").reason), "needs a Mechanics 4+ survivor here");
  skilled(st, h, "mechanics", 4);
  check(canBuild(st, h, "minefield").ok, "the main base builds a minefield");
  asOutpost(h);
  check(placeProblem(h, "minefield") === "Opens at the main base", "an outpost does not (main hub only)");
  h.type = "hub";
  const f = addBuilding(h, "minefield");
  check(f.mines === MINES.PER && minesLeft(h) === MINES.PER && minesKill(h, 100) === MINES.PER * MINES.KILL, `${MINES.PER} mines a field, ${MINES.KILL} of the dead each`);
  const before = holdCheck(st, h, 60);
  check(before.after === 60 - minesKill(h, 60), "the hold check counts the dead the mines take before the walls");
  spendMines(h, MINES.PER - 1);
  check(minesLeft(h) === 1 && count(h, "minefield") === 1, "mines spent one by one");
  spendMines(h, 1);
  check(!count(h, "minefield"), "an empty field is cleared away (build it again)");
  addBuilding(h, "minefield");
  const r = raidMines(st, h);
  check(r.used === MINES.RAID && minesLeft(h) === MINES.PER - MINES.RAID, `a raid by the numbers sets off ${MINES.RAID}`);
  // A horde by the numbers.
  const st2 = world();
  const h2 = hub(st2);
  addBuilding(h2, "walls"); addBuilding(h2, "minefield");
  const hd = makeHorde(st2, { tile: h2.tile, size: 30, split: true });
  const size0 = hd.size;
  hordeAttackBase(st2, hd, h2);
  check(minesLeft(h2) < MINES.PER && (hd.size < size0 || !st2.hordes.includes(hd)), `a horde of ${size0} walks into it: ${MINES.PER - minesLeft(h2)} mines gone off, ${size0 - hd.size} of the dead taken`);
}

console.log("Land mines on the battle map");
{
  const st = world();
  const h = hub(st);
  addBuilding(h, "walls"); addBuilding(h, "minefield");
  const b = raid(st, h);
  const mines = b.cells.map((c, i) => [c, i]).filter(([c]) => c.mine);
  check(b.mines && b.mines.laid === MINES.PER && mines.length === MINES.PER, `the fort map: ${mines.length} mines buried in the margin`);
  const F = b.deployPlan.fort, w = F.wall;
  check(mines.every(([, i]) => { const x = i % b.w, y = (i - x) / b.w; return Math.max(w.x0 - x, x - w.x1, w.y0 - y, y - w.y1) >= 2; }) && b.units.filter((u) => u.side === "enemy").every((u) => !b.cells[u.y * b.w + u.x].mine), "outside the wall's foot, none under an attacker at the start");
  // A raider steps on one; one of yours does not set it off.
  const [, mi] = mines[0];
  const mx = mi % b.w, my = (mi - mx) / b.w;
  const e = b.units.find((u) => u.side === "enemy");
  const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [mx + dx, my + dy]).find(([x, y]) => b.cells[y * b.w + x] && CELL[b.cells[y * b.w + x].k].walk && !b.cells[y * b.w + x].mine);
  const me = b.units.find((u) => u.side === "player");
  const mx0 = me.x, my0 = me.y;
  me.x = near[0]; me.y = near[1];
  moveAlong(b, me, [[mx, my]]);
  check(me.x === mx && b.cells[mi].mine, "one of yours steps on it: nothing (they know where it is)");
  me.x = mx0; me.y = my0;
  e.x = near[0]; e.y = near[1]; e.ap = 2;
  const hp0 = e.hp;
  moveAlong(b, e, [[mx, my], [mx + (mx - near[0]), my + (my - near[1])]]);
  check(!b.cells[mi].mine && e.x === mx && (e.hp < hp0 || e.dead || e.down), `a raider steps on one: it goes off under them (${Math.round(hp0)} → ${e.dead ? "dead" : Math.round(e.hp)})`);
  settleMines(st, b);
  check(minesLeft(h) === MINES.PER - 1, `the fight over: the base keeps the ${minesLeft(h)} that did not go off`);
  st.combat = null;
  const st2 = world();
  const h2 = hub(st2);
  addBuilding(h2, "minefield");
  const b2 = raid(st2, h2);
  check(b2.tier.map === "fort" && !b2.tier.walled && b2.mines && b2.cells.filter((c) => c.mine).length === MINES.PER, "no wall: the mines are in the open ground round the yard (the base map)");
}

console.log("The Defenses tab in the base window");
{
  const ui = (baseView) => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView, expedition: null, diary: null, roster: null, help: false });
  const plain = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const st = world();
  const h = hub(st);
  rich(h);
  const bld = plain(renderModal(st, ui({ id: h.id, tab: "construction" })));
  check(/Buildings/.test(bld) && /Defenses/.test(bld) && !/Barbed wire fence/.test(bld), "Construction: a Buildings and a Defenses tab, the defenses not in the buildings' list");
  const html = renderModal(st, ui({ id: h.id, tab: "construction", cx: "defenses" }));
  const txt = plain(html);
  check(/No wall\./.test(txt) && /Wooden wall 1×4/.test(txt) && /Metal sheets/.test(txt) && /data-type="walls"/.test(html), "the walls card: none yet, the pieces in wood, the materials up to metal sheets, Close the ring");
  check(["Camp and up", "Shelter and up", "Outpost and up", "Main hub"].every((t) => txt.includes(t)) && /Barbed wire fence/.test(txt) && /Trench and stakes/.test(txt) && /Guard towers/.test(txt), "the defenses by the size of base they open at");
  asCamp(h);
  const camp = plain(renderModal(st, ui({ id: h.id, tab: "construction", cx: "defenses" })));
  check(/Opens at a shelter/.test(camp) && /Opens at the main base/.test(camp), "at a camp: the bigger bases' defenses say where they open");
  delete h.tier; delete h.camp;
  addBuilding(h, "walls"); addBuilding(h, "barbed_wire");
  const def = plain(renderModal(st, ui({ id: h.id, tab: "defence" })));
  check(/Defenses built/.test(def) && /closed wall, mostly wooden wall/.test(def) && /barbed wire fence/.test(def) && /Build defenses/.test(def), "the Defence tab: what is built, a way to the Defenses list");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
