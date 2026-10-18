// Windows and the kinds of door (src/sim/windows.js, src/sim/buildingmaps.js DOOR_KINDS, src/sim/combat.js; the user's
// request of 2026-10-17): every window is unlocked, locked or fixed by the building's mix (houses mostly open, a
// shop's front mostly fixed); checking one is free and reveals it; an unlocked one opens from either side, a locked
// one from the inside only, a fixed one never; breaking one is loud (the raid's noise, Heat, the unaware nearby wake);
// shots pass a window closed, open or broken; a move vaults through an open or broken one at the vault's cost and
// crashes through a closed one (loud, the glass cuts); the sill is half cover in every state; a throw passes an open
// one; the dead clamber through an open or broken window, never a closed one; doors come by their kind per archetype
// (hit points, sight through a glass door, a security door's lock that is never forced, a glass door that breaks with
// a crash); a mid-fight save keeps it all; the headless raid bot finishes a raid on a house and on a shop.
// Usage: node tools/windowtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import {
  createBattle, combatAct, registerCombatHandler, reachable, distField, los, coverSides, autoPlayerTurn, runEnemyPhase, VAULT, MOVE, CELL,
  vaultable, vaultBreaks, vaultCost, clambers, canVault,
} from "../src/sim/combat.js";
import { WINDOW, windowState, windowOpen, isWindow, insideOf, windowsBy, openRefusal, windowWord, winMixOf } from "../src/sim/windows.js";
import { BUILDINGS, assemble, DOOR_KINDS, doorSees, throwBlocks } from "../src/sim/buildingmaps.js";
import { openOdds } from "../src/sim/locks.js";
import { Rng } from "../src/sim/rng.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
registerCombatHandler("wtest", () => {});
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; return st; };
const idx = (b, x, y) => y * b.w + x;
const place = (u, x, y) => { u.x = x; u.y = y; };
const logHas = (b, re) => b.log.some((l) => re.test(l.text));
// An open battle map (every cell open ground, by day), your people in the player phase, the enemy unaware and far off.
function battle(st, { count = 1, kind = "raiders", fighters = 2 } = {}) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, fighters).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind, count, power: 3, name: "Test" }, ambush: "player", canRetreat: false, handler: "wtest", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; delete c.win; delete c.dk; delete c.car; }
  b.lit = null; b.floodAim = null; b.flares = [];
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  b.noise = 0;
  b.units.forEach((u, i) => { if (u.side === "enemy") { place(u, b.w - 2, 2 + i); u.aware = false; } });
  return b;
}
// A house of walls on the open map: the border walls, floorboards inside; a window in the west wall at row wy.
function house(b, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = b.cells[idx(b, x, y)];
    const border = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    c.k = border ? "wall" : "open"; c.f = "floor";
  }
  b.losCache.fill(0);
}
const setWindow = (b, x, y, lock, open = false) => { const c = b.cells[idx(b, x, y)]; c.k = "window"; c.f = "floor"; c.win = { open, lock }; b.losCache.fill(0); return c; };
const mine = (b) => b.units.filter((u) => u.side === "player");
const foe = (b) => b.units.find((u) => u.side === "enemy");

console.log("The state mix on a house and a shop (buildingmaps.js assemble, windows.js rollWin)");
{
  const tally = (key, n = 12) => {
    const t = { none: 0, locked: 0, fixed: 0, smashed: 0, bad: 0 };
    for (let i = 0; i < n; i++) {
      const rng = new Rng(seed * 100 + i);
      const spec = BUILDINGS[key].make(rng);
      const m = assemble(rng, spec, { key, name: BUILDINGS[key].name });
      for (const c of m.cells) {
        if (c.k === "smashed") { t.smashed++; if (c.win) t.bad++; }
        else if (c.k === "window") { if (c.win && !c.win.open && ["none", "locked", "fixed"].includes(c.win.lock)) t[c.win.lock]++; else t.bad++; }
      }
    }
    return t;
  };
  const hs = tally("house"), sh = tally("grocery");
  const n = (t) => t.none + t.locked + t.fixed;
  check(n(hs) > 30 && !hs.bad && n(sh) > 20 && !sh.bad, `every window carries a state, closed, unlocked, locked or fixed (${n(hs)} on 12 houses, ${n(sh)} on 12 groceries), a broken one none`);
  check(hs.none > hs.locked && hs.none > hs.fixed && hs.fixed / n(hs) < 0.3, `a house's windows are mostly unlocked (${hs.none} unlocked, ${hs.locked} locked, ${hs.fixed} fixed)`);
  check(sh.fixed > sh.none && sh.fixed > sh.locked, `a shop's are mostly fixed (${sh.none} unlocked, ${sh.locked} locked, ${sh.fixed} fixed)`);
  check(winMixOf("house") === WINDOW.MIX.house && winMixOf("grocery") === WINDOW.MIX.shop && winMixOf("police") === WINDOW.MIX.shop, "the mix by the building's key: houses, else the shop's");
  // The same seed, the same windows: the states come from the map's own dice, read not consumed (the containers after them unchanged).
  const two = () => { const rng = new Rng(seed); const spec = BUILDINGS.house.make(rng); const m = assemble(rng, spec, { key: "house", name: "House" }); return m; };
  const a = two(), bb = two();
  check(JSON.stringify(a.cells.map((c) => c.win || 0)) === JSON.stringify(bb.cells.map((c) => c.win || 0)) && JSON.stringify(a.containers) === JSON.stringify(bb.containers), "the same map twice: the same window states and the same containers after them");
}

console.log("Checking, opening, closing: free to check; locked ones open from inside only; fixed never");
{
  const st = world();
  const b = battle(st);
  house(b, 10, 8, 7, 6); // x 10..16, y 8..13; the west wall x = 10
  const [u, w] = mine(b);
  place(w, 2, 2);
  const c = setWindow(b, 10, 10, "none");
  place(u, 9, 10); u.ap = 2;
  check(!insideOf(b, 9, 10) && insideOf(b, 11, 10) && !insideOf(b, 10, 10), "insideOf: the yard is outside, the floorboards inside, the wall nobody's side");
  check(windowsBy(b, u).length === 1 && !windowsBy(b, u)[0].inside && windowWord(c) === "?", "the window next to the unit is found, from outside, its state unknown");
  const s0 = windowState(c);
  check(s0 && !s0.open && s0.lock === "none" && !s0.known, "windowState reads the cell");
  let err = combatAct(st, { type: "checkwindow", unit: u.id });
  check(err === "" && u.ap === 2 && c.win.known && windowWord(c) === "unlocked" && logHas(b, /tries the window: unlocked/), `Check window is free and reveals it (${err || "ok"})`);
  err = combatAct(st, { type: "openwindow", unit: u.id, x: 10, y: 10 });
  check(err === "" && c.win.open && u.ap === 2 - WINDOW.OPEN_AP && windowOpen(c) && windowWord(c) === "open" && b.noise === 0, `an unlocked window opens from outside for ${WINDOW.OPEN_AP} action, quietly (${err || "ok"})`);
  check(combatAct(st, { type: "openwindow", unit: u.id }) === "The window is open already.", "opened twice: refused");
  err = combatAct(st, { type: "closewindow", unit: u.id });
  check(err === "" && !c.win.open && u.ap === 2 - 2 * WINDOW.OPEN_AP, `and closes again for ${WINDOW.OPEN_AP} action (${err || "ok"})`);
  check(/cannot act|No actions left/.test(combatAct(st, { type: "openwindow", unit: u.id })), "no actions left: refused");
  check(combatAct(st, { type: "checkwindow", unit: u.id }) === "" && logHas(b, /tries the window: unlocked/), "a check is free even with no actions left");
  // Locked: not from outside, from inside yes.
  const L = setWindow(b, 10, 11, "locked");
  u.ap = 2; place(u, 9, 11);
  err = combatAct(st, { type: "openwindow", unit: u.id, x: 10, y: 11 });
  check(/locked from the inside/.test(err) && !L.win.open && L.win.known && u.ap === 2, `a locked window refuses from outside, with the reason, and the try reveals it for free ("${err}")`);
  check(openRefusal(b, u, L, false) !== "" && openRefusal(b, u, L, true) === "", "openRefusal: not from outside, fine from inside");
  place(u, 11, 11);
  err = combatAct(st, { type: "openwindow", unit: u.id, x: 10, y: 11 });
  check(err === "" && L.win.open && u.ap === 1 && logHas(b, /unlatched from the inside/), `from inside it opens (${err || "ok"})`);
  // Fixed: never.
  const F = setWindow(b, 10, 12, "fixed");
  u.ap = 2; place(u, 11, 12);
  err = combatAct(st, { type: "openwindow", unit: u.id, x: 10, y: 12 });
  check(/fixed/.test(err) && !F.win.open && u.ap === 2, `a fixed window never opens, even from inside ("${err}")`);
  check(combatAct(st, { type: "closewindow", unit: u.id, x: 10, y: 12 }) === "The window is closed already.", "closing a closed one: refused");
  place(u, 9, 9);
  check(/Stand right next to a window/.test(combatAct(st, { type: "checkwindow", unit: u.id })), "diagonal to a window only: nothing next to them");
}

console.log("Breaking a window is loud; shots pass it in every state; cover at the sill; a throw");
{
  const st = world();
  const b = battle(st);
  house(b, 10, 8, 7, 6);
  const [u, w] = mine(b), e = foe(b);
  place(w, 2, 2);
  const c = setWindow(b, 10, 10, "fixed");
  place(u, 9, 10); u.ap = 2;
  place(e, 9, 16); e.aware = false; // 6 tiles off: within WINDOW.BREAK.radius
  const n0 = b.noise;
  const err = combatAct(st, { type: "breakwindow", unit: u.id, x: 10, y: 10 });
  check(err === "" && c.k === "smashed" && !c.win && u.ap === 2 - WINDOW.BREAK.ap, `Break window: the cell is broken ("smashed"), ${WINDOW.BREAK.ap} action (${err || "ok"})`);
  check(b.noise === n0 + WINDOW.BREAK.noise, `loud: the raid's noise +${WINDOW.BREAK.noise} (${b.noise})`);
  check(e.aware === true && logHas(b, /Breaking glass carries/), `the unaware within ${WINDOW.BREAK.radius} tiles wake (alertNear)`);
  check(windowState(c).broken && windowOpen(c) && isWindow(c) && windowWord(c) === "broken", "a broken window is open, and still a window");
  check(combatAct(st, { type: "breakwindow", unit: u.id }) === "The window is broken already." && combatAct(st, { type: "closewindow", unit: u.id }) === "The window is broken: it cannot be closed.", "broken: not broken or closed again");
  // Shots and sight: through the window closed, open and broken; not through the wall beside it.
  const sees = () => { b.losCache.fill(0); return los(b, 8, 10, 12, 10); };
  check(!los(b, 8, 9, 12, 9), "the wall beside it blocks sight");
  c.k = "window"; c.win = { open: false, lock: "fixed" };
  check(sees(), "sight (and a shot) passes a closed window");
  c.win.open = true;
  check(sees(), "an open window");
  c.k = "smashed"; delete c.win;
  check(sees(), "a broken window");
  // Cover: the sill is half cover in every state (coverSides of the cell inside, facing west).
  const westOf = () => coverSides(b, 11, 10)[1];
  check(westOf() === 1, "a broken window: half cover from the inside");
  c.k = "window"; c.win = { open: true, lock: "none" };
  check(westOf() === 1, "an open window: half cover");
  c.win.open = false;
  check(westOf() === 1 && CELL.window.cover === 1 && CELL.smashed.cover === 1 && !CELL.smashed.walk, "a closed window: half cover; nobody stands in a broken one");
  // A throw: blocked by a closed window, through an open or a broken one.
  check(throwBlocks(c), "a throw is stopped by a closed window");
  c.win.open = true;
  check(!throwBlocks(c), "and passes an open one");
  c.k = "smashed"; delete c.win;
  check(!throwBlocks(c) && throwBlocks({ k: "idoor" }) && throwBlocks({ k: "wall" }), "and a broken one (a closed door and a wall still stop it)");
}

console.log("Vaulting through: open and broken at the vault's cost, a closed one crashed through (loud, the glass cuts)");
{
  const st = world();
  const b = battle(st);
  house(b, 10, 8, 7, 6);
  const [u, w] = mine(b), e = foe(b);
  place(w, 2, 2); place(e, 9, 16); e.aware = false;
  const c = setWindow(b, 10, 10, "none", true);
  place(u, 8, 10); u.ap = 2; u.sneaking = false; u.mob = MOVE;
  check(vaultable(b, c) && !vaultBreaks(c) && vaultCost(b, c) === VAULT.COST && canVault(u), "an open window is vaultable at VAULT.COST");
  let r = reachable(b, u, 20);
  check(Math.abs(r.dist[idx(b, 11, 10)] - (3 + VAULT.COST)) < 1e-6 && !isFinite(r.dist[idx(b, 10, 10)]), `the reach goes through it at 1 + VAULT.COST a step (${r.dist[idx(b, 11, 10)]} to the cell inside), never ending on the sill`);
  c.k = "smashed"; delete c.win;
  r = reachable(b, u, 20);
  check(vaultable(b, c) && Math.abs(r.dist[idx(b, 11, 10)] - (3 + VAULT.COST)) < 1e-6, "a broken window the same");
  c.k = "window"; c.win = { open: false, lock: "locked" };
  r = reachable(b, u, 20);
  check(vaultBreaks(c) && vaultCost(b, c) === VAULT.COST + WINDOW.SMASH_COST && Math.abs(r.dist[idx(b, 11, 10)] - (3 + VAULT.COST + WINDOW.SMASH_COST)) < 1e-6, `a closed window is vaultable too, ${WINDOW.SMASH_COST} tile dearer (${r.dist[idx(b, 11, 10)]})`);
  // The move through a closed window: it breaks, the glass cuts, the crash carries, winded after.
  place(u, 9, 10);
  const hp0 = u.hp, n0 = b.noise;
  const err = combatAct(st, { type: "move", unit: u.id, x: 11, y: 10 });
  check(err === "" && u.x === 11 && u.y === 10, `a move through it lands inside (${err || "ok"})`);
  check(c.k === "smashed" && !c.win, "the window is broken by the vault");
  check(u.hp < hp0 && hp0 - u.hp >= WINDOW.HURT[0] - 1e-6 && hp0 - u.hp <= WINDOW.HURT[1] + 1e-6, `the glass cuts ${WINDOW.HURT[0]}–${WINDOW.HURT[1]}, armour or not (${hp0 - u.hp})`);
  check(b.noise === n0 + WINDOW.BREAK.noise + VAULT.NOISE, `loud: the raid's noise +${WINDOW.BREAK.noise} for the glass and +${VAULT.NOISE} for the vault (${b.noise - n0})`);
  check(e.aware === true, "the unaware nearby wake");
  check(u.vaulted === VAULT.COST && logHas(b, /crashes through the window/) && logHas(b, /vaults through the window/), "winded as after any vault, and the log says so");
  check(u.ap === 1, `within one action (1 + ${VAULT.COST} + ${WINDOW.SMASH_COST} + 1 of ${MOVE} tiles)`);
  // A move through an open window: quiet but for the vault's scuff, nobody hurt.
  const st2 = world();
  const b2 = battle(st2);
  house(b2, 10, 8, 7, 6);
  const [u2, w2] = mine(b2), e2 = foe(b2);
  place(w2, 2, 2); place(e2, 30, 20); e2.aware = false;
  const c2 = setWindow(b2, 10, 10, "none", true);
  place(u2, 8, 10); u2.ap = 2; u2.sneaking = false; u2.mob = MOVE;
  const hp2 = u2.hp;
  const err2 = combatAct(st2, { type: "move", unit: u2.id, x: 11, y: 10 });
  check(err2 === "" && u2.x === 11 && c2.k === "window" && c2.win.open && u2.hp === hp2 && b2.noise === VAULT.NOISE && !e2.aware && logHas(b2, /vaults through the open window/), `through an open window: the window stays, nobody cut, only the vault's noise (${err2 || "ok"})`);
  // Arms full: no vault through a window either.
  u2.hands = { food: 2 };
  check(!isFinite(reachable(b2, u2, 20).dist[idx(b2, 8, 10)]) || !canVault(u2), "with the arms full the window is a wall");
  delete u2.hands;
}

console.log("The dead clamber through an open or broken window, never a closed one");
{
  const st = world();
  const b = battle(st, { kind: "zombies", count: 2 });
  house(b, 10, 8, 7, 6);
  const [u, w] = mine(b);
  const [z, z2] = b.units.filter((x) => x.side === "enemy");
  place(u, 12, 10); place(w, 12, 11);
  place(z, 8, 10); place(z2, 2, 2);
  const c = setWindow(b, 10, 10, "none", false);
  check(clambers(z) && !canVault(z), "a walker clambers (and never vaults)");
  check(!isFinite(reachable(b, z, 20).dist[idx(b, 11, 10)]), "a closed window stops it");
  c.win.open = true;
  let r = reachable(b, z, 20);
  check(isFinite(r.dist[idx(b, 11, 10)]) && Math.abs(r.dist[idx(b, 11, 10)] - (3 + VAULT.COST)) < 1e-6 && !isFinite(r.dist[idx(b, 10, 10)]), `an open one it goes through at the vault's cost (${r.dist[idx(b, 11, 10)]}), never stopping on the sill`);
  c.k = "smashed"; delete c.win;
  r = reachable(b, z, 20);
  check(isFinite(r.dist[idx(b, 11, 10)]), "a broken one too");
  const f = distField(b, [[u.x, u.y]], z);
  check(isFinite(f[idx(b, z.x, z.y)]) && Math.abs(f[idx(b, z.x, z.y)] - (4 + VAULT.COST)) < 1e-6, `its field goes through it at the same cost (${f[idx(b, z.x, z.y)]})`);
  c.k = "window"; c.win = { open: false, lock: "none" };
  check(!isFinite(distField(b, [[u.x, u.y]], z)[idx(b, z.x, z.y)]), "and not through a closed one (the field is keyed by the state: no stale answer)");
}

console.log("The kinds of door: placed by archetype, hit points, sight, locks");
{
  const build = (key, i = 0) => { const rng = new Rng(seed * 10 + i); const spec = BUILDINGS[key].make(rng); return assemble(rng, spec, { key, name: BUILDINGS[key].name }); };
  const doorsOf = (m) => m.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.k === "idoor" || c.k === "odoor" || c.k === "door");
  const hs = build("house"), sh = build("grocery"), pd = build("police");
  const front = (m) => m.cells[m.front.y * m.w + m.front.x];
  check(front(hs).dk === "front" && front(hs).mhp === DOOR_KINDS.front.hp, `a house's front door is a front door of ${DOOR_KINDS.front.hp} hit points`);
  check(front(sh).dk === "glass" && front(sh).mhp === DOOR_KINDS.glass.hp && doorSees(front(sh)) === (front(sh).k !== "odoor"), `a grocery's is a glass door of ${DOOR_KINDS.glass.hp}, seen through when shut`);
  check(front(pd).dk === "security" && front(pd).mhp === DOOR_KINDS.security.hp, `a police station's a security door of ${DOOR_KINDS.security.hp}`);
  let houseBacks = 0, houseExits = 0;
  for (let i = 0; i < 10; i++) { const m = build("house", i); for (const ex of m.exits) { if (ex.roller) continue; houseExits++; const c = m.cells[ex.y * m.w + ex.x]; if (ex.side === "back" && (c.dk === "screen" || c.dk === "glass")) houseBacks++; } }
  check(houseBacks > 0, `houses get a screen or a patio door at the back (${houseBacks} of ${houseExits} exits over 10 houses)`);
  const inner = doorsOf(hs).filter(({ c }) => !c.roll && c.dk === "wood");
  check(inner.length > 0 && inner.every(({ c }) => c.mhp === DOOR_KINDS.wood.hp || c.mhp >= 160), "the inner doors are wood (30 hit points; a locked room's door holds as a locked door)");
  check(doorsOf(hs).concat(doorsOf(sh), doorsOf(pd)).every(({ c }) => c.dk && DOOR_KINDS[c.dk] && c.mhp > 0), "every door cell carries a kind and hit points");
  check(doorsOf(sh).concat(doorsOf(pd)).filter(({ c }) => c.roll).every(({ c }) => c.dk === "roller" && c.mhp === DOOR_KINDS.roller.hp), "roller doors stay roller doors");
  const lockedGlass = Object.values(DOOR_KINDS).filter((K) => K.lock === false);
  check(lockedGlass.length === 1 && lockedGlass[0] === DOOR_KINDS.screen && hs.lockedDoors.every((d) => d.dk && d.dk !== "screen"), "a screen door has no lock; the locked doors carry their kind for the lock");
  // Sight through a closed glass door, not a wooden one (combat.js los).
  const st = world();
  const b = battle(st);
  house(b, 10, 8, 7, 6);
  const d = b.cells[idx(b, 10, 10)];
  d.k = "idoor"; d.f = "floor"; d.dk = "wood"; d.hp = d.mhp = DOOR_KINDS.wood.hp;
  b.losCache.fill(0);
  check(!los(b, 8, 10, 12, 10), "a closed wooden door blocks sight");
  d.dk = "glass"; d.hp = d.mhp = DOOR_KINDS.glass.hp; b.losCache.fill(0);
  check(los(b, 8, 10, 12, 10) && doorSees(d), "a closed glass door is seen through");
  d.dk = "screen"; b.losCache.fill(0);
  check(los(b, 8, 10, 12, 10), "a screen door too");
  d.k = "odoor"; b.losCache.fill(0);
  check(los(b, 8, 10, 12, 10), "and any door open");
  // Locks by the kind (locks.js openOdds): a security door is never forced; a glass door's lock is easy.
  const [u, w] = mine(b);
  place(w, 2, 2); place(u, 9, 10); u.ap = 2;
  const plain = openOdds(st, b, u, { kind: "door", open: false, tries: 0 });
  const sec = openOdds(st, b, u, { kind: "door", open: false, tries: 0, dk: "security" });
  const gl = openOdds(st, b, u, { kind: "door", open: false, tries: 0, dk: "glass" });
  check(!sec.force.ok && /cannot be forced/.test(sec.force.why) && sec.pick.chance < plain.pick.chance, `a security door refuses force ("${sec.force.why}") and is harder to pick (${Math.round(sec.pick.chance * 100)}% vs ${Math.round(plain.pick.chance * 100)}%)`);
  check(gl.pick.chance > plain.pick.chance && (gl.force.ok || gl.force.chance > plain.force.chance), `a glass door's lock is easier (pick ${Math.round(gl.pick.chance * 100)}%)`);
  // A glass door battered: it breaks fast and with a crash (breakCell: the glass's noise).
  d.k = "idoor"; d.dk = "glass"; d.hp = d.mhp = DOOR_KINDS.glass.hp; b.losCache.fill(0);
  const e = foe(b); place(e, 9, 16); e.aware = false;
  const n0 = b.noise;
  let blows = 0;
  while (d.k === "idoor" && blows < 8) { u.ap = 2; const err = combatAct(st, { type: "melee", unit: u.id, x: 10, y: 10 }); if (err) { console.log("    melee:", err); break; } blows++; }
  check(d.k === "doorway" && blows <= 4, `a glass door goes down in a few blows (${blows})`);
  check(b.noise === n0 + WINDOW.BREAK.noise && e.aware && logHas(b, /glass door gives way/i), `and breaks with a crash: noise +${WINDOW.BREAK.noise}, the unaware nearby wake, the log names the door`);
}

console.log("Saved and loaded mid-fight: the windows' states, the doors' kinds");
{
  const st = world();
  const b = battle(st);
  house(b, 10, 8, 7, 6);
  const [u, w] = mine(b);
  place(w, 2, 2); place(u, 9, 10); u.ap = 2;
  setWindow(b, 10, 10, "locked");
  setWindow(b, 10, 11, "none", true);
  const c3 = setWindow(b, 10, 12, "fixed"); c3.win.known = true;
  const d = b.cells[idx(b, 13, 8)]; d.k = "door"; d.dk = "security"; d.hp = d.mhp = DOOR_KINDS.security.hp;
  b.doors = [{ id: 1, x: 13, y: 8, lock: { kind: "door", open: false, tries: 0, dk: "security" } }];
  combatAct(st, { type: "checkwindow", unit: u.id, x: 10, y: 10 });
  const st2 = loadFromString(saveToString(st));
  const b2 = st2.combat;
  const W = (x, y) => b2.cells[idx(b2, x, y)];
  check(!!b2 && W(10, 10).k === "window" && W(10, 10).win.lock === "locked" && W(10, 10).win.known === true && !W(10, 10).win.open, "a checked, locked window as it was");
  check(W(10, 11).win.open && W(10, 11).win.lock === "none" && W(10, 12).win.lock === "fixed" && W(10, 12).win.known, "an open one and a fixed one too");
  check(W(13, 8).dk === "security" && W(13, 8).mhp === DOOR_KINDS.security.hp && b2.doors[0].lock.dk === "security", "the door's kind on the cell and on its lock");
  const u2 = b2.units.find((x) => x.id === u.id);
  check(!!u2 && /locked from the inside/.test(combatAct(st2, { type: "openwindow", unit: u2.id, x: 10, y: 10 })), "and the loaded battle plays on by the same rules");
  // A window with no state (an old save): closed and unlocked.
  const old = { k: "window", f: "floor" };
  check(windowState(old).lock === "none" && !windowState(old).open && !windowOpen(old) && vaultable(b, old) && vaultBreaks(old), "a window from an old save: closed, unlocked, vaultable (crashed through)");
}

// A raid on a building (as the browser starts it): Heat from the glass, the inside by the rooms, the bot's raid.
function raidAt(types, opts = {}) {
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: (opts.seed || 300) + i, factionCount: 6 });
    st.cards.length = 0;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && types.includes(t.loc.type) && t.id !== h.tile);
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const groups = opts.groups || raidEnemies(st, tile.id);
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "wtest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5, ...(opts.raid || {}) }, context: {} };
    st.combat = createBattle(st, setup);
    if (!st.combat.raid.interior) continue;
    if (opts.want && !opts.want(st.combat)) continue;
    return { st, b: st.combat, p, tile };
  }
  return null;
}
console.log("On a building's map: Heat from the glass, inside and outside by the rooms");
{
  // A closed window on the ground floor with floor on one side and the yard on the other, both free to stand on.
  const spotOf = (b) => {
    for (let i = 0; i < b.cells.length; i++) {
      const c = b.cells[i];
      if (c.k !== "window" || !c.win) continue;
      const x = i % b.w, y = (i / b.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ox = x + dx, oy = y + dy, ix = x - dx, iy = y - dy;
        if (ox < 0 || oy < 0 || ox >= b.w || oy >= b.h || ix < 0 || iy < 0 || ix >= b.w || iy >= b.h) continue;
        const o = b.cells[oy * b.w + ox], n = b.cells[iy * b.w + ix];
        if (CELL[o.k].walk && CELL[n.k].walk && !insideOf(b, ox, oy) && insideOf(b, ix, iy) && !b.units.some((q) => (q.x === ox && q.y === oy) || (q.x === ix && q.y === iy))) return { x, y, ox, oy, ix, iy };
      }
    }
    return null;
  };
  const r = raidAt(["grocery", "pharmacy", "hardware", "cabin", "lodge", "diner"], { groups: [], want: (b) => !!spotOf(b) });
  check(!!r, "test setup: a raid on a building with a closed window between the yard and a room");
  if (r) {
    const { st, b } = r;
    const s = spotOf(b);
    const u = b.units.find((x) => x.side === "player");
    place(u, s.ox, s.oy); u.ap = 2; u.f = 0;
    b.phase = "player";
    const c = b.cells[idx(b, s.x, s.y)];
    check(windowsBy(b, u).length >= 1 && !windowsBy(b, u).find((w) => w.x === s.x).inside, "from the yard the window is next to them, outside (the rooms say so)");
    const h0 = b.raid.heat, n0 = b.noise;
    const err = combatAct(st, { type: "breakwindow", unit: u.id, x: s.x, y: s.y });
    check(err === "" && c.k === "smashed" && b.raid.heat === Math.min(100, h0 + WINDOW.BREAK.heat) && b.noise === n0 + WINDOW.BREAK.noise, `Break window in a raid: Heat +${WINDOW.BREAK.heat}, noise +${WINDOW.BREAK.noise} (${err || "ok"})`);
    place(u, s.ix, s.iy); u.ap = 2;
    check(windowsBy(b, u).find((w) => w.x === s.x).inside === true, "from the room it is inside");
    // Climb through the broken window: quiet.
    const h1 = b.raid.heat;
    const err2 = combatAct(st, { type: "climb", unit: u.id, x: s.x, y: s.y });
    check(err2 === "" && u.x === s.ox && u.y === s.oy && b.raid.heat === h1 && logHas(b, /climbs through the broken window: quiet/), `Climb window through a broken one: quiet, no Heat (${err2 || "ok"})`);
  }
}

console.log("The headless raid bot finishes a raid on a house and on a shop");
{
  for (const [name, types] of [["a house", ["cabin", "lodge", "ranger"]], ["a shop", ["grocery", "pharmacy", "hardware", "diner"]]]) {
    const r = raidAt(types, { seed: 400 });
    check(!!r, `test setup: a raid on ${name}`);
    if (!r) continue;
    const { st, b } = r;
    const wins = b.cells.filter((c) => c.k === "window" || c.k === "smashed").length;
    let guard = 0, threw = null;
    try { while (!b.over && guard++ < 200) { autoPlayerTurn(st); runEnemyPhase(st); } } catch (e) { threw = e; }
    check(!threw && b.over, `${name} (${b.raid.interior.key}, ${wins} windows): the raid ends (${threw ? threw.message : `${guard} turns, ${b.result || "?"}`})`);
    check(b.units.filter((x) => x.side === "player").every((x) => x.left || x.dead || x.fled || CELL[b.cells[x.y * b.w + x.x].k].walk), "nobody of yours stands on a window's sill");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
