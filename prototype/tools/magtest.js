// Gun magazines and the Reload action (src/sim/combat.js magazines: WEAPONS[k].cap, magCap, magIn, magShown, reload,
// reloadRefusal, fireRefusal; the AI's reloads in aiUnit / holdPost / the raid bot). Checks: the capacities, guns start
// loaded, a shot empties the magazine (and still takes the team's ammo), no shot / overwatch / double tap with an empty
// gun, Reload costs 1 action and fills the magazine as far as the team's ammo goes, reload and shoot in one turn, the
// magazine never shows more than the team has, enemies reload, your side's AI and the raid bot reload, a save in the
// middle of a battle keeps the magazines, a weapon swapped mid-raid (refitUnit), the UI's Reload button and I key.
// Usage: node tools/magtest.js [seed]
import { setRounds, giveRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import {
  WEAPONS, createBattle, combatAct, registerCombatHandler, runEnemyPhase, enemyStep, endPlayerTurn, autoPlayerTurn, canFire,
  magCap, magIn, magMaxOf, magShown, magLabel, magEmpty, hasMag, reloadRefusal, fireRefusal, refitUnit, loadMag, ammoLeft,
  reloadCost, reload,
} from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { gunMods, NO_MODS } from "../src/sim/gunmods.js";
import { starterMags, magRoundsKg } from "../src/sim/carrykit.js";
import { reloadPlan } from "../src/sim/mags.js";
import { GEAR } from "../src/sim/data.js";
import { rigPouches as ensureRigOf, itemLoad } from "../src/sim/inventory.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("magtest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };

function fighter(state, weapon = "pistol", shooting = 9) {
  const s = makeSurvivor(state);
  s.skills.shooting = shooting;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  if (s.gear.weapon) starterMags(s); // carrykit.js: two spare magazines in the pockets, as a colonist starts with (section 15)
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
// A field battle on an open map; the enemy parked off the map until placed.
function openBattle(state, crew, enemy = { kind: "raiders", count: 2, power: 3 }, ammo = 200) {
  const h = hub(state);
  setRounds(h.stock, 0); for (const s of crew) giveRounds(h.stock, ammo, [s.gear.weapon && s.gear.weapon.key].filter(Boolean)); // ammo.js: `ammo` rounds of each gun's calibre
  h.stock.meds = 0; h.stock.arrows = 50;
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "magtest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  return b;
}
const mine = (b, i = 0) => b.units.filter((u) => u.side === "player")[i];
const by = (b, s) => b.units.find((u) => u.sid === s.id); // the unit of a survivor (the battle orders them its own way)
const foes = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; };
const toughen = (u) => { u.hp = u.maxHp = 100000; }; // a target that soaks shots
const logHas = (b, re) => b.log.some((l) => re.test(l.text));

// 1. The capacities.
{
  console.log("Capacities");
  const want = { pistol: 15, shotgun: 6, huntrifle: 5, ar: 30, pipegun: 1, revolver: 6, leverrifle: 6, carbine: 30 }; // the lever-action: a tube of six (weapons overhaul section 3)
  for (const [k, n] of Object.entries(want)) check(WEAPONS[k].cap === n, `${WEAPONS[k].name} holds ${n} (has ${WEAPONS[k].cap})`);
  const guns = Object.entries(WEAPONS).filter(([, w]) => !w.melee && w.ammo > 0).map(([k]) => k);
  check(guns.every((k) => WEAPONS[k].cap > 0), `every gun that uses ammo has a magazine (${guns.join(", ")})`);
  const none = Object.entries(WEAPONS).filter(([, w]) => w.melee || !w.ammo).map(([k]) => k);
  check(none.every((k) => !WEAPONS[k].cap), `no magazine on melee weapons, bows, crossbows, acid (${none.length} of them)`);
  check(WEAPONS.ar.cap / WEAPONS.ar.ammo === 15, "the assault rifle's 30 rounds are 15 two-round shots");
  check(gunMods(newItem("pistol")) === NO_MODS || gunMods(newItem("pistol")).capMult != null, "gunmods.js gives the magazine numbers (cap, capMult)");
  const u = { weapon: "pistol", item: newItem("pistol") };
  const m = gunMods(u.item);
  check(magCap(u) === Math.round(15 * m.capMult) + m.cap, "magCap = round(cap × gunMods.capMult) + gunMods.cap");
  check(magCap({ weapon: "compbow" }) === 0 && magCap({ weapon: "fists" }) === 0 && magCap({ weapon: "acid" }) === 0, "magCap 0 for a bow, fists, acid");
}

// 2. Loaded at the start; a shot empties the magazine; no shot when empty.
{
  console.log("Firing and empty guns");
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "pistol"), c = fighter(st, "ar");
  const b = openBattle(st, [a, c], { kind: "raiders", count: 3, power: 3 });
  const p = by(b, a), r = by(b, c);
  check(p.mag === 15 && p.magMax === 15 && magIn(p) === 15, "a pistol starts the battle loaded (15/15)");
  check(r.mag === 30 && magLabel(b, r) === "30/30", "an assault rifle starts loaded (30/30)");
  const humans = foes(b).filter((e) => e.kind === "human" && hasMag(e));
  check(humans.length > 0 && humans.every((e) => e.mag === e.magMax && e.magMax === WEAPONS[e.weapon].cap), "enemy guns start loaded");
  const e = foes(b)[0];
  place(p, 5, 5); place(r, 5, 7); place(e, 10, 5); toughen(e);
  const pool0 = ammoLeft(b), used0 = b.ammoUsed;
  check(combatAct(st, { type: "shoot", unit: p.id, target: e.id }) === "", "the pistol fires");
  check(p.mag === 14 && ammoLeft(b) === pool0 - 1 && b.ammoUsed === used0 + 1, "one shot: 14 in the magazine, 1 off the team's ammo, ammoUsed +1");
  r.ap = 2;
  check(combatAct(st, { type: "shoot", unit: r.id, target: e.id }) === "", "the rifle fires");
  check(r.mag === 28 && ammoLeft(b) === pool0 - 3, "a burst takes 2 from the magazine and 2 from the ammo");
  // Empty it.
  b.phase = "player"; p.ap = 2; loadMag(p, 0);
  check(magEmpty(b, p) && !canFire(b, p), "an empty pistol cannot fire");
  check(/empty/i.test(combatAct(st, { type: "shoot", unit: p.id, target: e.id })), "Shoot is refused: the gun is empty");
  check(/reload/i.test(combatAct(st, { type: "overwatch", unit: p.id })) && !p.ow, "Overwatch is refused with an empty gun");
  check(/empty/i.test(fireRefusal(b, p)), "fireRefusal says it is empty");
  check(p.ap === 2, "a refused shot costs nothing");
  // An assault rifle with 1 round cannot fire a burst.
  loadMag(r, 1); r.ap = 2;
  check(!canFire(b, r) && magEmpty(b, r), "an assault rifle with 1 round left cannot fire (a burst needs 2)");
}

// 3. Reload: 1 action, full, as far as the ammo goes; reload and shoot in one turn; refusals.
{
  console.log("Reload");
  const st = createWorld({ seed: seed + 1, factionCount: 4 });
  const a = fighter(st, "pistol"), c = fighter(st, "huntrifle");
  const b = openBattle(st, [a, c], { kind: "raiders", count: 2, power: 3 });
  const p = by(b, a), q = by(b, c), e = foes(b)[0];
  place(p, 5, 5); place(q, 5, 8); place(e, 10, 5); toughen(e);
  check(/full/i.test(reloadRefusal(b, p)) && /full/i.test(combatAct(st, { type: "reload", unit: p.id })), "a full gun is not reloaded");
  loadMag(p, 0);
  const pool0 = ammoLeft(b);
  check(combatAct(st, { type: "reload", unit: p.id }) === "", "an empty gun reloads");
  check(p.ap === 1 && p.mag === 15, "Reload costs 1 action and fills the magazine (15/15)");
  check(ammoLeft(b) === pool0 && b.ammoUsed === 0, "reloading moves no ammo out of the pools (the magazine is a counter)");
  check(logHas(b, new RegExp(`${p.name} reloads the 9mm pistol \\(15/15\\)`)), "the log says so (\"… reloads the 9mm pistol (15/15).\")");
  check(combatAct(st, { type: "shoot", unit: p.id, target: e.id }) === "" && p.ap === 0 && p.mag === 14, "reload, then shoot with the other action: one turn");
  // Limited by the team's ammo.
  const pools = b.pools;
  const setAmmo = (n) => { for (const o of pools) setRounds(o, 0); pools[0].a_9mm_fmj = n; pools[0].a_308_fmj = n; }; // n rounds for each gun (ammo.js: by calibre)
  setAmmo(3);
  check(magShown(b, p) === 3 && magLabel(b, p) === "3/15", "14 loaded but 3 left in the team: it shows 3/15 (never more than the team has)");
  check(/spare/i.test(reloadRefusal(b, p)), "nothing to reload with: refused (every round left is loaded)");
  q.ap = 2; loadMag(q, 1); setAmmo(4);
  check(combatAct(st, { type: "reload", unit: q.id }) === "" && q.mag === 4 && magShown(b, q) === 4, "with 4 rounds left a rifle reloads to 4/5");
  setAmmo(0); loadMag(q, 0); q.ap = 2;
  check(/no ammo/i.test(combatAct(st, { type: "reload", unit: q.id })) && q.ap === 2, "no ammo at all: Reload refused, no action spent");
  check(/out of ammo/i.test(fireRefusal(b, q)), "and the gun is out of ammo, not just empty");
  setAmmo(50);
  // The pipe shotgun: a single shot, then reload.
  const st2 = createWorld({ seed: seed + 2, factionCount: 4 });
  const z = fighter(st2, "pipegun");
  const b2 = openBattle(st2, [z], { kind: "raiders", count: 1, power: 3 });
  const g = mine(b2), t = foes(b2)[0];
  place(g, 5, 5); place(t, 7, 5); toughen(t);
  check(g.mag === 1 && combatAct(st2, { type: "shoot", unit: g.id, target: t.id }) === "" && g.mag === 0 && magEmpty(b2, g), "the pipe shotgun fires its one shell and is empty");
  // The bow never needs reloading.
  const st3 = createWorld({ seed: seed + 3, factionCount: 4 });
  const bw = fighter(st3, "compbow");
  const b3 = openBattle(st3, [bw], { kind: "raiders", count: 1, power: 3 });
  const bu = mine(b3), bt = foes(b3)[0];
  place(bu, 5, 5); place(bt, 9, 5); toughen(bt);
  let shots = 0;
  for (let i = 0; i < 20; i++) { b3.phase = "player"; bu.ap = 2; if (combatAct(st3, { type: "shoot", unit: bu.id, target: bt.id }) === "") shots++; }
  check(shots === 20 && !hasMag(bu) && /no reloading/.test(reloadRefusal(b3, bu)), "a bow shoots 20 times without a reload (no magazine)");
}

// 4. The enemy reloads.
{
  console.log("Enemy AI");
  const st = createWorld({ seed: seed + 4, factionCount: 4 });
  const a = fighter(st, "pistol");
  const b = openBattle(st, [a], { kind: "raiders", count: 2, power: 3 });
  const p = mine(b);
  place(p, 5, 5); toughen(p);
  const e = foes(b).find((x) => x.kind === "human");
  e.weapon = "pistol"; e.weaponName = "9mm pistol"; loadMag(e, 0);
  place(e, 11, 5);
  endPlayerTurn(st);
  let n = 0;
  while (b.phase === "enemy" && n++ < 20) enemyStep(st);
  check(logHas(b, new RegExp(`${e.name} reloads`)), "an enemy with an empty gun reloads in its turn");
  check(e.mag >= e.magMax - 1, `and its magazine is full again (or one shot spent): ${e.mag}/${e.magMax}`);
  // A gun that was swapped after enemyUnit (buildingmaps.js hands out weapons) counts as loaded.
  const f = foes(b).find((x) => x !== e && x.kind === "human");
  f.weapon = "huntrifle";
  check(magIn(f) === 5 && magMaxOf(f) === 5 && canFire(b, f), "a weapon handed out after enemyUnit counts as fully loaded");
  // Low and nothing in reach: topped up instead of standing idle.
  const st2 = createWorld({ seed: seed + 5, factionCount: 4 });
  const a2 = fighter(st2, "pistol");
  const b2 = openBattle(st2, [a2], { kind: "raiders", count: 1, power: 3 });
  const p2 = mine(b2), e2 = foes(b2)[0];
  e2.weapon = "pistol"; e2.weaponName = "9mm pistol";
  place(p2, 2, 2); place(e2, b2.w - 3, b2.h - 3);
  for (const c of b2.cells) c.k = "open";
  // A wall between them: no shot.
  for (let y = 0; y < b2.h; y++) b2.cells[y * b2.w + Math.floor(b2.w / 2)].k = "wall";
  b2.losCache.fill(0);
  loadMag(e2, 3);
  endPlayerTurn(st2);
  n = 0;
  while (b2.phase === "enemy" && n++ < 20) enemyStep(st2);
  check(e2.mag === e2.magMax, `an enemy under half full with nobody in reach tops up (${e2.mag}/${e2.magMax})`);
}

// 5. Your side's AI (the AI plays my side, auto-played fights) and the raid bot reload.
{
  console.log("Your side's AI and the raid bot");
  const st = createWorld({ seed: seed + 6, factionCount: 4 });
  const a = fighter(st, "pistol"), c = fighter(st, "pistol");
  const b = openBattle(st, [a, c], { kind: "raiders", count: 1, power: 3 });
  const p = by(b, a), q = by(b, c), e = foes(b)[0];
  place(p, 5, 5); place(q, 5, 7); place(e, 11, 6); toughen(e);
  loadMag(p, 0); loadMag(q, 0);
  autoPlayerTurn(st, { retreat: false });
  check(logHas(b, new RegExp(`${p.name} reloads`)) && logHas(b, new RegExp(`${q.name} reloads`)), "the AI playing your side reloads empty guns");
  check(b.log.some((l) => new RegExp(`^${p.name} shoots`).test(l.text)) || p.mag < 15, "and shoots with the other action");
  // Out of ammo: no reload, the AI goes for melee instead of stalling.
  const st2 = createWorld({ seed: seed + 7, factionCount: 4 });
  const a2 = fighter(st2, "pistol");
  const b2 = openBattle(st2, [a2], { kind: "raiders", count: 1, power: 3 }, 0);
  const p2 = mine(b2), e2 = foes(b2)[0];
  place(p2, 5, 5); place(e2, 9, 5); toughen(e2);
  loadMag(p2, 0);
  autoPlayerTurn(st2, { retreat: false });
  check(!logHas(b2, /reloads/) && b2.phase !== "player", "with no ammo the AI does not try to reload and the turn still ends");
  // A whole fight played by the AI on both sides finishes (nobody stuck on an empty gun).
  const st3 = createWorld({ seed: seed + 8, factionCount: 4 });
  const crew = [fighter(st3, "pipegun"), fighter(st3, "huntrifle"), fighter(st3, "revolver")];
  const h = hub(st3);
  setRounds(h.stock, 120, crew.map((s) => s.gear.weapon.key)); // ammo.js: rounds that fit their guns
  const b3 = (st3.combat = createBattle(st3, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 4, power: 4 }, ambush: null, canRetreat: true, handler: "magtest", context: {} }));
  for (let t = 0; t < 80 && !b3.over; t++) { autoPlayerTurn(st3, { retreat: false }); runEnemyPhase(st3); }
  check(b3.over, `an AI-played fight with a pipe shotgun, a hunting rifle and a revolver ends (turn ${b3.turn})`);
  check(logHas(b3, /reloads/), "with reloads along the way");
  // The raid bot.
  const st4 = createWorld({ seed: seed + 9, factionCount: 4 });
  const h4 = hub(st4);
  const team = [fighter(st4, "pistol"), fighter(st4, "pistol")];
  const tile = st4.tiles.find((t) => t.loc && t.id !== h4.tile && st4.grid.distance(t.id, h4.tile) > 1);
  const res = launchExpedition(st4, { memberIds: team.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 1 } });
  if (res.error) check(false, `raid team launched (${res.error})`);
  else {
    const pt = res.party;
    pt.path = [tile.id]; pt.idx = 0; pt.phase = "engaged";
    const rb = inBrowser(() => (st4.combat = createBattle(st4, { mode: "raid", tile: tile.id, partyId: pt.id, canRetreat: true, ambush: null, handler: "magtest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st4, tile.id) }, raid: { heat0: 5 }, context: {} })));
    if (rb.raid && rb.raid.choose) { rb.raid.choose = null; }
    const ru = rb.units.find((u) => u.side === "player");
    loadMag(ru, 0);
    for (const u of rb.units) if (u.side !== "player") { u.aware = false; }
    autoPlayerTurn(st4);
    const ru2 = st4.combat && st4.combat.units ? st4.combat.units.find((u) => u.sid === ru.sid) || ru : ru;
    check(logHas(st4.combat || rb, new RegExp(`${ru.name} reloads`)) || magIn(ru2) > 0, "the raid bot reloads an empty gun when there is time");
  }
}

// 6. Saves: a battle saved in the middle keeps its magazines; an old save without them counts guns loaded.
{
  console.log("Saves");
  const st = createWorld({ seed: seed + 10, factionCount: 4 });
  const a = fighter(st, "pistol"), c = fighter(st, "shotgun");
  const b = openBattle(st, [a, c], { kind: "raiders", count: 2, power: 3 });
  const p = by(b, a), q = by(b, c), e = foes(b).find((x) => x.kind === "human");
  place(p, 5, 5); place(q, 5, 7); place(e, 12, 6);
  loadMag(p, 7); loadMag(q, 2); loadMag(e, 1);
  const st2 = loadFromString(saveToString(st));
  const b2 = st2.combat;
  const p2 = b2.units.find((u) => u.id === p.id), q2 = b2.units.find((u) => u.id === q.id), e2 = b2.units.find((u) => u.id === e.id);
  check(p2.mag === 7 && p2.magMax === 15 && magLabel(b2, p2) === "7/15", "the pistol's 7/15 survives a save and load");
  check(q2.mag === 2 && magIn(q2) === 2 && e2.mag === 1, "the shotgun's 2/6 and the enemy's 1 round too");
  b2.phase = "player"; q2.ap = 2;
  check(combatAct(st2, { type: "reload", unit: q2.id }) === "" && q2.mag === 6, "and Reload works on the loaded battle");
  delete p2.mag; delete p2.magMax; delete p2.magW;
  check(magIn(p2) === 15 && magMaxOf(p2) === 15 && canFire(b2, p2), "a unit from a save made before magazines counts as loaded");
}

// 7. A weapon swapped mid-raid (refitUnit).
{
  console.log("Weapon swaps (refitUnit)");
  const st = createWorld({ seed: seed + 11, factionCount: 4 });
  const a = fighter(st, "pistol");
  const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 3 });
  const p = mine(b);
  p.fit = { aim: p.aim, dmgMult: p.dmgMult, armor: p.armor, medicine: p.medicine };
  loadMag(p, 9);
  const first = a.gear.weapon;
  a.gear.weapon = newItem("pistol");
  refitUnit(b, p, a);
  // gunload.js: the rounds are the gun's, not the hand's: the old pistol keeps its 9, another one found comes empty.
  check(p.weapon === "pistol" && p.mag === 0 && p.magMax === 15 && first.loaded && first.loaded.n === 9, "another pistol (found): it comes empty (0/15); the 9 loaded rounds stay in the old one");
  a.gear.weapon = newItem("shotgun");
  refitUnit(b, p, a);
  check(p.weapon === "shotgun" && p.mag === 0 && p.magMax === 6 && magEmpty(b, p), "a shotgun picked up: it comes empty (0/6), Reload to load it");
  p.ap = 2;
  check(/no ammo/i.test(reloadRefusal(b, p)), "with no shells to hand it cannot be loaded (ammo.js: a gun takes its own calibre)");
  b.pools[0].a_12ga_buck = 20;
  check(combatAct(st, { type: "reload", unit: p.id }) === "" && p.mag === 4 && p.ap === 1, "with shells, a Reload puts 4 in the pump's tube (4/6, 1 action: an internal magazine)");
  a.gear.weapon = null;
  refitUnit(b, p, a);
  check(p.weapon === "fists" && !hasMag(p) && magLabel(b, p) === "", "put down: fists, no magazine");
}

// 9. Magazines as items (wave 2, section 15: physical magazines, virtual rounds; src/sim/mags.js).
{
  console.log("Magazines as items");
  const st = createWorld({ seed: seed + 20, factionCount: 4 });
  const a = fighter(st, "ar");
  a.pockets = a.pockets.map(() => null);
  a.gear.rig = newItem("chestrig");
  a.gear.backpack = newItem("assaultpack");
  const rp = ensureRigOf(a);
  rp[0] = newItem("mag_stanag_30"); // rig
  a.pockets[0] = newItem("mag_stanag_20"); // pocket
  a.gear.backpack.contents[0] = Object.assign(newItem("mag_stanag_30"), { load: "ap" }); // pack, AP
  a.gear.backpack.contents[1] = newItem("mag_glock_15"); // does not fit an AR
  const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 3 });
  b.pools[0].a_556_ap = 60;
  const p = by(b, a);
  const sp = p.mags.filter((m) => m.where !== "gun");
  check(p.magMode === "box" && sp.length === 3 && sp.map((m) => m.where).sort().join() === "pack,pocket,rig" && p.mags[0].where === "gun" && p.mags[0].key === "mag_stanag_30", `u.mags: the gun's (implicit standard 30) and the 3 spares that fit, by where (${sp.map((m) => `${m.key}@${m.where}`).join(", ")})`);
  check(magCap(p) === 30 && p.mag === 30, "the gun starts with its standard magazine full (30/30)");
  place(p, 5, 5); place(foes(b)[0], 16, 5); toughen(foes(b)[0]); foes(b)[0].aware = false; // someone left on the map: the fight goes on
  b.phase = "player";
  loadMag(p, 0); p.ap = 2;
  check(reloadCost(b, p) === 1 && combatAct(st, { type: "reload", unit: p.id }) === "" && p.ap === 1 && p.mag === 30 && p.mags.find((m) => m.where === "gun").cap === 30, "Reload: the rig's magazine (1 action), 30/30");
  check(p.mags.filter((m) => m.where === "rig").length === 1 && p.mags.find((m) => m.where === "rig").n === 0, "the emptied one is kept, in the rig pouch the fresh one came from");
  loadMag(p, 0); p.ap = 2; b.phase = "player";
  check(combatAct(st, { type: "reload", unit: p.id }) === "" && p.ap === 1 && p.magMax === 20 && p.mag === 20, "next: the pocket's 20-round magazine (1 action, 20/20)");
  loadMag(p, 0); p.ap = 2; b.phase = "player";
  check(reloadCost(b, p) === 2 && combatAct(st, { type: "reload", unit: p.id }) === "" && p.ap === 0 && p.load === "ap" && p.mag === 30, "then the pack's: 2 actions, and its AP rounds switch the gun's load");
  b.phase = "player"; loadMag(p, 3); p.ap = 1;
  check(reloadCost(b, p) === 2 && /top-up takes 2/.test(combatAct(st, { type: "reload", unit: p.id })) && p.ap === 1, "no loaded spare left: a top-up takes 2 actions (refused with 1)");
  p.ap = 2; b.phase = "player";
  check(combatAct(st, { type: "reload", unit: p.id }) === "" && p.ap === 0 && p.mag === p.magMax && logHas(b, /top-up/), "with 2 it tops up the magazine in the gun");
  b.phase = "player"; p.ap = 2;
  check(reloadCost(b, p, "fmj") === 2, "a type with no loaded magazine of it: a top-up with it (2 actions)");
  {
    // A drum's −2 aim (and its jams) leave with the drum: a reload to a standard magazine recomputes the gun's numbers.
    const stD = createWorld({ seed: seed + 22, factionCount: 4 });
    const d = fighter(stD, "ar");
    d.pockets = d.pockets.map(() => null);
    d.gear.weapon.mods = { ...(d.gear.weapon.mods || {}), mag: newItem("drum") };
    d.pockets[0] = newItem("mag_stanag_30");
    const bD = openBattle(stD, [d], { kind: "raiders", count: 1, power: 3 });
    const pd = by(bD, d);
    const withDrum = gunMods(d.gear.weapon), bare = gunMods(Object.assign({}, d.gear.weapon, { mods: Object.fromEntries(Object.entries(d.gear.weapon.mods).filter(([k]) => k !== "mag")) }));
    place(pd, 5, 5); place(foes(bD)[0], 16, 5); toughen(foes(bD)[0]); foes(bD)[0].aware = false;
    bD.phase = "player"; loadMag(pd, 0); pd.ap = 2;
    const aim0 = pd.gm.aim;
    check(aim0 === withDrum.aim && withDrum.aim < bare.aim, `the drum fitted: its aim on the unit (${aim0}, without it ${bare.aim})`);
    check(combatAct(stD, { type: "reload", unit: pd.id }) === "" && pd.magMax === 30 && pd.gm.aim === bare.aim && pd.gm.jam === bare.jam, `a reload to the standard 30: the drum's aim and jams are gone (aim ${pd.gm.aim})`);
  }
  // Internal magazines.
  const st2 = createWorld({ seed: seed + 21, factionCount: 4 });
  const crew = ["shotgun", "leverrifle", "huntrifle", "revolver", "dbshotgun"].map((k) => fighter(st2, k));
  crew[3].pockets = crew[3].pockets.map(() => null); crew[3].pockets[0] = newItem("speedloader");
  crew[2].pockets = crew[2].pockets.map(() => null); crew[2].pockets[0] = newItem("stripper308");
  const h2 = hub(st2);
  setRounds(h2.stock, 400, crew.map((s) => s.gear.weapon.key));
  const b2 = (st2.combat = createBattle(st2, { tile: h2.tile, baseId: h2.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 1, power: 3 }, ambush: null, canRetreat: true, handler: "magtest", context: {} }));
  for (const u of b2.units) if (u.side === "enemy") { u.x = -10; u.y = -10; u.dead = true; }
  b2.phase = "player";
  const inc = { shotgun: 4, leverrifle: 4, huntrifle: 3, revolver: 2, dbshotgun: 2 };
  for (const s of crew) {
    const u = by(b2, s);
    loadMag(u, 0); u.ap = 2;
    const k = u.weapon;
    const first = reloadPlan(b2, u);
    reload(b2, u);
    const want = k === "revolver" || k === "huntrifle" ? u.magMax : Math.min(u.magMax, inc[k]);
    check(u.magMode === "internal" && u.mag === want && u.ap === 1, `${WEAPONS[k].name}: an internal magazine, a Reload puts ${want} in (${first.mode}${first.mode === "clip" ? `: a ${GEAR[u.clips[first.i].key].name.toLowerCase()}` : ""}), 1 action`);
    if (k === "revolver" || k === "huntrifle") { loadMag(u, 0); u.ap = 2; reload(b2, u); check(u.mag === inc[k], `${WEAPONS[k].name}: the clip is used once a fight; the next Reload puts ${inc[k]} in`); }
  }
  // An enemy's spares.
  const st3 = createWorld({ seed: seed + 22, factionCount: 4 });
  const b3 = openBattle(st3, [fighter(st3, "pistol")], { kind: "soldiers", count: 3, power: 5 });
  const e = foes(b3).find((x) => x.magMode === "box");
  if (e) {
    const n = e.mags.filter((m) => m.where !== "gun").length;
    let swaps = 0;
    for (let i = 0; i < n; i++) { loadMag(e, 0); e.ap = 2; const pl = reloadPlan(b3, e); if (pl.mode === "swap") swaps++; reload(b3, e); }
    check(swaps === n && n >= 3, `an enemy soldier changes magazines ${n} times (3–5 spares)`);
  } else check(false, "a soldier with a magazine gun to test");
  // Implicit magazine, an old extended mag, a drum, the tube extension, weights.
  const old = newItem("pistol"); old.mods = { mag: { key: "extmag", name: "Extended pistol magazine", quality: 1 } };
  check(magCap({ weapon: "pistol", item: newItem("pistol") }) === 15 && magCap({ weapon: "pistol", item: old }) === 24 && magCap({ weapon: "ar", item: Object.assign(newItem("ar"), { mods: { mag: newItem("drum") } }) }) === 60, "a gun with no magazine item: its standard one (15); an old save's extended mag: a 24-round magazine; a drum 60");
  check(magCap({ weapon: "shotgun", item: Object.assign(newItem("shotgun"), { mods: { mag: newItem("tubeext") } }) }) === 8, "the tube extension stays an attachment (+2 shells)");
  check(Math.abs(itemLoad(newItem("mag_stanag_30")) - 0.12) < 1e-9 && Math.abs(magRoundsKg({ gear: { weapon: null }, pockets: [newItem("mag_stanag_30")] }) - 30 * 0.012) < 1e-6, "a magazine weighs its empty weight as an item (0.12 kg); its rounds count in a fight (+0.36 kg loaded)");
}

// 8. The UI: the Reload button, the I key, the magazine on the unit panel, the empty flag.
{
  console.log("UI");
  const ok = await inBrowser(async () => {
    const UI = await import("../src/ui/combat.js");
    const KM = await import("../src/ui/keymap.js");
    const st = createWorld({ seed: seed + 12, factionCount: 4 });
    const a = fighter(st, "pistol");
    const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 3 });
    const p = mine(b), e = foes(b)[0];
    place(p, 5, 5); place(e, 10, 5); toughen(e);
    UI.cui.sel = p.id;
    loadMag(p, 7);
    let html = UI.renderCombatPanel(st);
    const has = (s) => html.includes(s);
    const out = [];
    out.push([(has("9mm pistol <b>7/15</b>") && has('data-v="reload"')), "the panel shows 9mm pistol 7/15 and a Reload button"]);
    loadMag(p, 0);
    html = UI.renderCombatPanel(st);
    out.push([has("Empty — reload"), "an empty gun is flagged: Empty — reload"]);
    const k = KM.KEY_BY_ID.get("battle.reload");
    out.push([!!k && k.keys.includes("KeyI"), "the I key is Reload (battle.reload)"]);
    const clash = KM.KEYMAP ? KM.KEYMAP.filter((x) => x.ctx === "battle" && x.id !== "battle.reload" && x.keys.includes("KeyI")) : [];
    out.push([clash.length === 0, "and nothing else in battle uses I"]);
    UI.combatAction(st, "cb-act", { v: "reload" });
    out.push([p.mag === 15 && p.ap === 1, "the Reload button reloads (15/15, 1 action left)"]);
    return out;
  }).catch((err) => [[false, `UI checks ran (${err.message})`]]);
  for (const [o, m] of ok) check(o, m);
}

console.log(`\n${passes} passed, ${fails} failed`);
console.log(fails ? "failed" : "passed");
process.exit(fails ? 1 : 0);
