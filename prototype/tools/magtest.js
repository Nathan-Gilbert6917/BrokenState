// Gun magazines and the Reload action (src/sim/combat.js magazines: WEAPONS[k].cap, magCap, magIn, magShown, reload,
// reloadRefusal, fireRefusal; the AI's reloads in aiUnit / holdPost / the raid bot; src/sim/mags.js reloadPlan / doReload).
// Your side's rounds are PHYSICAL in a fight (2026-10-18 user rules, mags.js header): the gun's rounds are its stack
// (u.stack, u.mag its total), each spare magazine item carries its own (item.stack), a shot comes off the gun's stack
// and a Reload draws ONLY on the shooter's own pockets, rig pouches and pack (never a teammate's rounds, never the team's
// bags or a base's stock): a spare magazine swapped in physically (rig or pocket 1 action, the pack 2; the one in the gun
// goes where the fresh one lay, with what it had), else up to 6 loose rounds a Reload whatever the gun (a pocket or the
// rig 1 action, the pack both), the rounds leaving the item as they go in; a clip only when picked ({ clip: i }).
// Enemies keep the old rule (counters, an endless reserve). Checks: the capacities, guns start loaded, a shot empties the
// magazine (and comes off the side's total), no shot / overwatch with an empty gun, Reload's costs and numbers, the
// refusals that say where the rounds are, reload and shoot in one turn, the gun shows its own rounds whatever the stock
// holds, enemies reload, your side's AI and the raid bot reload from what they carry, a save in the middle of a battle
// keeps the magazines, a weapon swapped mid-raid (refitUnit), magazines as items (a physical swap, a top-up by hand, a
// type asked for by name, a drum), internal magazines (6 a Reload, a clip when picked), the UI's Reload button and I key.
// Usage: node tools/magtest.js [seed]
import { setRounds, giveRounds, newBox, boxesOf, sweepBoxes } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import {
  WEAPONS, createBattle, combatAct, registerCombatHandler, runEnemyPhase, enemyStep, endPlayerTurn, autoPlayerTurn, canFire,
  magCap, magIn, magMaxOf, magShown, magLabel, magEmpty, hasMag, reloadRefusal, fireRefusal, refitUnit, refitKit, loadMag, ammoLeft,
  reloadCost, reload,
} from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { gunMods, NO_MODS } from "../src/sim/gunmods.js";
import { starterMags, magRoundsKg } from "../src/sim/carrykit.js";
import { reloadPlan, fittedMag, MAGS } from "../src/sim/mags.js";
import { GEAR } from "../src/sim/data.js";
import { rigPouches as ensureRigOf, itemLoad, packOf, carriedSpots } from "../src/sim/inventory.js";
import { roundItem } from "../src/sim/itemstack.js";
import { stackText, stackN } from "../src/sim/roundstack.js";
import { baseKey } from "../src/sim/rounds.js";

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
const keepFoe = (b, x = 16, y = 5) => { const e = foes(b)[0]; place(e, x, y); toughen(e); e.aware = false; return e; }; // someone left on the map: the fight goes on (an act with no live enemy ends it: Victory)
const logHas = (b, re) => b.log.some((l) => re.test(l.text));
const lastLog = (b) => (b.log.length ? b.log[b.log.length - 1].text : "");
const rounds = (s, key) => carriedSpots(s).filter((x) => x.item.key === key).reduce((a, x) => a + Math.floor(x.item.dur), 0); // rounds of a key on a person (boxed or loose)

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
  check(humans.length > 0 && humans.every((e) => e.mag === e.magMax && e.magMax === magCap(e) && e.magMax >= WEAPONS[e.weapon].cap), "enemy guns start loaded (full to the capacity of the magazine fitted: an extended one holds more than the gun's own)");
  const e = foes(b)[0];
  place(p, 5, 5); place(r, 5, 7); place(e, 10, 5); toughen(e);
  const pool0 = ammoLeft(b), used0 = b.ammoUsed;
  check(combatAct(st, { type: "shoot", unit: p.id, target: e.id }) === "", "the pistol fires");
  check(p.mag === 14 && stackN(p.stack) === 14 && ammoLeft(b) === pool0 - 1 && b.ammoUsed === used0 + 1, "one shot: 14 in the magazine (off the gun's stack), 1 off the side's total, ammoUsed +1");
  r.ap = 2;
  check(combatAct(st, { type: "shoot", unit: r.id, target: e.id }) === "", "the rifle fires");
  check(r.mag === 28 && ammoLeft(b) === pool0 - 3, "a burst takes 2 from the magazine and 2 off the side's total");
  // Empty it.
  b.phase = "player"; p.ap = 2; loadMag(p, 0); p.jam = null; // (a jam on the shot before, the seed's dice, would be refused first: gunfire.js)
  check(magEmpty(b, p) && !canFire(b, p), "an empty pistol cannot fire");
  check(/empty/i.test(combatAct(st, { type: "shoot", unit: p.id, target: e.id })), "Shoot is refused: the gun is empty");
  check(/reload/i.test(combatAct(st, { type: "overwatch", unit: p.id })) && !p.ow, "Overwatch is refused with an empty gun");
  check(/empty/i.test(fireRefusal(b, p)), "fireRefusal says it is empty");
  check(p.ap === 2, "a refused shot costs nothing");
  // An assault rifle with 1 round cannot fire a burst.
  loadMag(r, 1); r.ap = 2;
  check(!canFire(b, r) && magEmpty(b, r), "an assault rifle with 1 round left cannot fire (a burst needs 2)");
}

// 3. Reload: a fresh magazine from a pocket (1 action, physical: the emptied one lies where the fresh one came from), a
// swap moves nothing out of the side's total; reload and shoot in one turn; the gun shows its own rounds whatever the
// stock holds; refusals say where the rounds are; loose rounds in a pocket load a rifle (up to 6 a Reload, 1 action)
// and leave the pocket as they go in.
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
  const plan = reloadPlan(b, p);
  check(plan.mode === "swap" && plan.from === "pocket" && plan.cost === 1 && plan.n === 15, `an empty pistol: the plan is a swap, a pocket's full magazine (${plan.mode} ${plan.n} from ${plan.from}, ${plan.cost} action)`);
  const fresh = p.mags[plan.i].item;
  check(combatAct(st, { type: "reload", unit: p.id }) === "", "an empty gun reloads");
  check(p.ap === 1 && p.mag === 15 && stackN(p.stack) === 15, "Reload costs 1 action and the fresh magazine is full (15/15)");
  check(ammoLeft(b) === pool0 && b.ammoUsed === 0, `a swap moves nothing out of the side's total (${pool0}: the stock, the guns and the magazines, counted once)`);
  check(logHas(b, new RegExp(`${p.name} reloads the 9mm pistol( \\(15-round mag\\))? \\(15/15\\): a fresh magazine from a pocket; the other goes there empty\\.`)), `the log names the swap ("${lastLog(b)}")`);
  check(a.pockets.filter((x) => x && x.key === "mag_glock_15").length === 2 && !a.pockets.includes(fresh) && p.mags.filter((m) => m.where === "pocket").map((m) => m.n).sort().join() === "0,15" && fittedMag(a.gear.weapon) === fresh, "the gun's own magazine (made a thing of, empty) lies in the pocket the fresh one came from (0); the other spare is still full (15); the fresh one is the gun's fitted magazine (its rounds are the gun's stack)");
  check(combatAct(st, { type: "shoot", unit: p.id, target: e.id }) === "" && p.ap === 0 && p.mag === 14, "reload, then shoot with the other action: one turn");
  check(ammoLeft(b) === pool0 - 1, "the shot came off the gun's stack: the side's total is one less");
  // The gun's rounds are its own: the base's stock never shows through, and is never a source.
  const pools = b.pools;
  const setAmmo = (n) => { for (const o of pools) setRounds(o, 0); pools[0].a_9mm_fmj = n; pools[0].a_308_fmj = n; }; // n rounds for each gun in the base's stock (ammo.js: by calibre)
  setAmmo(3);
  check(magShown(b, p) === 14 && magLabel(b, p) === "14/15", "14 in the gun with 3 left in the stock: it shows 14/15 (the rounds in the gun are physical, not a counter against the stock)");
  check(reloadRefusal(b, p) === "" && reloadPlan(b, p).mode === "swap" && reloadPlan(b, p).n === 15, "a loaded spare left in a pocket: a Reload would swap it in (the 14 would go to the pocket with the magazine)");
  for (const m of p.mags) if (m.where !== "gun") m.item.stack = []; // (the test empties both spares)
  for (const it of boxesOf(a)) it.dur = 0; sweepBoxes(a); // (and the rounds every gun takes to the field at hand: carrykit.js looseWant)
  refitKit(b, p, a);
  const why = reloadRefusal(b, p);
  check(/^No ammo to load: no loaded spare magazine, and no rounds for the 9mm pistol/.test(why) && /none in their pockets, rig or pack/.test(why) && /The base's 3 are in its stock, not to hand in a fight/.test(why), `no loaded spare and nothing loose on them: refused, the base's 3 named as out of reach ("${why}")`);
  // The rifle: an internal magazine, loose rounds out of a pocket; the rounds leave the pocket as they go in.
  for (const it of boxesOf(c)) it.dur = 0; sweepBoxes(c); // (the test empties what the rifle took to the field at hand: carrykit.js looseWant)
  q.ap = 2; loadMag(q, 1); setAmmo(4);
  check(/^No ammo to load: no \.308/.test(reloadRefusal(b, q)) && /base's 4 are in its stock/.test(reloadRefusal(b, q)) && combatAct(st, { type: "reload", unit: q.id }) !== "" && q.ap === 2, "a rifle at 1/5 with 4 in the stock and none on them: refused, nothing spent (the stock is not a source)");
  c.pockets[0] = roundItem("a_308_fmj", 4, true);
  refitKit(b, q, c);
  const rp = reloadPlan(b, q);
  check(rp.mode === "rounds" && rp.kind === "internal" && rp.from === "hand" && rp.cost === 1 && rp.n === 4, `4 loose .308 in a pocket: the plan loads all 4 from the pocket for 1 action (${rp.mode} ${rp.n} from ${rp.from}, ${rp.cost})`);
  check(combatAct(st, { type: "reload", unit: q.id }) === "" && q.mag === 5 && magShown(b, q) === 5 && q.ap === 1 && !c.pockets[0] && rounds(c, "a_308_fmj") === 0, "the rifle is 5/5 for 1 action; the pocket's 4 went in and the emptied stack was thrown away");
  check(logHas(b, /reloads the hunting rifle[^:]*: 4 \.308 \/ 7\.62 NATO FMJ from a pocket \(5\/5\)\./), `the log: 4 .308 from a pocket (5/5) ("${lastLog(b)}")`);
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
  for (const s of crew) s.pockets[0] = roundItem(baseKey(WEAPONS[s.gear.weapon.key].cal), 20, true); // the rounds they reload from: only what they carry (the base's stock is not a source in a fight)
  const h = hub(st3);
  setRounds(h.stock, 120, crew.map((s) => s.gear.weapon.key)); // ammo.js: rounds that fit their guns
  const b3 = (st3.combat = createBattle(st3, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 4, power: 4 }, ambush: null, canRetreat: true, handler: "magtest", context: {} }));
  for (let t = 0; t < 80 && !b3.over; t++) { autoPlayerTurn(st3, { retreat: false }); runEnemyPhase(st3); }
  check(b3.over, `an AI-played fight with a pipe shotgun, a hunting rifle and a revolver ends (turn ${b3.turn})`);
  const ours = b3.log.filter((l) => crew.some((s) => l.text.startsWith(s.name)) && /reloads the|loads \d/.test(l.text)).map((l) => l.text); // (the rifle's and the revolver's turn up when the fight runs long enough: the seed decides)
  check(ours.length > 0 && ours.every((t) => / from a pocket \(\d\/\d\)\.$/.test(t)) && ours.some((t) => /loads 1 12 gauge 00 buckshot from a pocket \(1\/1\)\./.test(t)), `with reloads along the way (${ours.length}), every one out of the shooter's own pocket (the pipe shotgun its one shell; the rifle and the revolver by the round)`);
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
  check(/on them/.test(reloadRefusal(b, p)), "with no shells on them it cannot be loaded (mags.js SHELLS: a shotgun loads only what its shooter carries)");
  b.pools[0].a_12ga_buck = 20;
  check(/on them/.test(reloadRefusal(b, p)) && /base's 20 are in its stock/.test(reloadRefusal(b, p)), `the base's 20 in its stock do not load it; the refusal says where they are ("${reloadRefusal(b, p)}")`);
  // mags.js (tools/reloadpicktest.js): a box of shells in their own backpack, none at hand: a Reload loads them straight
  // out of the pack for both actions, 6 a Reload (Get shells is gone for your people: nothing is dug out first).
  a.gear.backpack = newItem("backpack"); packOf(a)[0] = newBox("a_12ga_buck", 20);
  refitUnit(b, p, a);
  place(p, 5, 5); keepFoe(b); // someone left on the map: the fight goes on
  p.ap = 2;
  const sp = reloadPlan(b, p);
  check(sp.mode === "rounds" && sp.kind === "tube" && sp.from === "pack" && sp.cost === 2 && sp.n === 6 && reloadCost(b, p) === 2, `with a box of 20 shells in their backpack: the plan thumbs 6 into the tube straight from the pack for both actions (${sp.mode} ${sp.n} from ${sp.from}, ${sp.cost})`);
  p.ap = 1;
  check(/shells are in the pack: both actions/.test(reloadRefusal(b, p)) && combatAct(st, { type: "reload", unit: p.id }) !== "" && p.mag === 0 && p.ap === 1, "with one action left: refused, nothing spent");
  p.ap = 2;
  check(combatAct(st, { type: "reload", unit: p.id }) === "" && p.mag === 6 && p.ap === 0 && packOf(a)[0].dur === 14, `a Reload from the pack (both actions) puts 6 in the pump's tube; the 6 left the box (${p.mag}/6, ${packOf(a)[0].dur} in the box)`);
  check(logHas(b, /racks in 6 12 gauge 00 buckshot from the pack \(6\/6, both actions\)\./), `the log: "${lastLog(b)}"`);
  b.phase = "player"; p.ap = 2;
  check(/nothing to get/.test(combatAct(st, { type: "getshells", unit: p.id })) && p.ap === 2, "Get shells is refused for your people (nothing spent): shells load straight from what they carry");
  // The box moved to a pocket (the Inventory window, 1 action): the next Reload is 1 action.
  a.pockets[3] = packOf(a)[0]; packOf(a)[0] = null; refitUnit(b, p, a);
  b.phase = "player"; p.ap = 2; loadMag(p, 0);
  check(reloadCost(b, p) === 1 && combatAct(st, { type: "reload", unit: p.id }) === "" && p.mag === 6 && p.ap === 1 && a.pockets[3].dur === 8, `the box in a pocket: 6 more for 1 action (${a.pockets[3].dur} left in the box)`);
  a.gear.weapon = null;
  refitUnit(b, p, a);
  check(p.weapon === "fists" && !hasMag(p) && magLabel(b, p) === "", "put down: fists, no magazine");
}

// 9. Magazines as items (wave 2, section 15; 2026-10-18: physical magazines AND physical rounds; src/sim/mags.js).
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
  const apMag = Object.assign(newItem("mag_stanag_30"), { load: "ap", stack: [{ k: "a_556_ap", n: 30 }] }); // pack, 30 AP in it already (a magazine with a stack keeps it: fillUnit)
  a.gear.backpack.contents[0] = apMag;
  a.gear.backpack.contents[1] = newItem("mag_glock_15"); // does not fit an AR
  const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 3 });
  b.pools[0].a_556_ap = 60; // AP in the base's stock: never a source in a fight (only what they carry)
  const p = by(b, a);
  const sp = p.mags.filter((m) => m.where !== "gun");
  check(p.magMode === "box" && sp.length === 3 && sp.map((m) => m.where).sort().join() === "pack,pocket,rig" && p.mags[0].where === "gun" && p.mags[0].key === "mag_stanag_30", `u.mags: the gun's (implicit standard 30) and the 3 spares that fit, by where (${sp.map((m) => `${m.key}@${m.where}`).join(", ")})`);
  check(magCap(p) === 30 && p.mag === 30 && stackN(p.stack) === 30, "the gun starts with its standard magazine full (30/30, out of the base's stock as the fight starts)");
  check(sp.every((m) => m.n === m.cap) && sp.find((m) => m.where === "pack").load === "ap" && stackN(apMag.stack) === 30 && stackN(rp[0].stack) === 30 && stackN(a.pockets[0].stack) === 20, "the spares take the field full: the rig's 30 and the pocket's 20 out of the stock, the pack's with its own 30 AP");
  place(p, 5, 5); keepFoe(b); // someone left on the map: the fight goes on
  b.phase = "player";
  loadMag(p, 0); p.ap = 2;
  const rigMag = rp[0];
  check(reloadCost(b, p) === 1 && combatAct(st, { type: "reload", unit: p.id }) === "" && p.ap === 1 && p.mag === 30 && p.mags.find((m) => m.where === "gun").cap === 30 && fittedMag(a.gear.weapon) === rigMag, "Reload: the rig's magazine (1 action), 30/30; it is the gun's fitted magazine now (a physical swap)");
  check(p.mags.filter((m) => m.where === "rig").length === 1 && p.mags.find((m) => m.where === "rig").n === 0 && rp[0] && rp[0] !== rigMag && rp[0].key === "mag_stanag_30" && stackN(rp[0].stack) === 0 && rp[0].unloaded, "the gun's own standard magazine (made a thing of, empty) lies in the rig pouch the fresh one came from");
  loadMag(p, 0); p.ap = 2; b.phase = "player";
  const pocketMag = a.pockets[0];
  check(combatAct(st, { type: "reload", unit: p.id }) === "" && p.ap === 1 && p.magMax === 20 && p.mag === 20 && fittedMag(a.gear.weapon) === pocketMag, "next: the pocket's 20-round magazine (1 action, 20/20), the gun's fitted magazine now");
  check(a.pockets[0] === rigMag && stackN(rigMag.stack) === 0 && p.mags.some((m) => m.where === "pocket" && m.item === rigMag && m.n === 0 && m.cap === 30), "the emptied 30-round magazine out of the gun went into the pocket the 20 came from (its entry: pocket, 0/30)");
  loadMag(p, 0); p.ap = 2; b.phase = "player";
  check(reloadCost(b, p) === 2 && combatAct(st, { type: "reload", unit: p.id }) === "" && p.ap === 0 && p.load === "ap" && p.mag === 30 && fittedMag(a.gear.weapon) === apMag && stackText("556", p.stack) === "5.56 NATO armour-piercing ×30", "then the pack's: 2 actions, its 30 AP are the gun's stack now and AP is in the chamber");
  check(logHas(b, /loads the assault rifle[^:]*with 5\.56 NATO armour-piercing \(30\/30\): a magazine from the pack; the other goes there empty\./) && a.gear.backpack.contents[0].key === "mag_stanag_20" && stackN(a.gear.backpack.contents[0].stack) === 0, `the log names the switch; the emptied 20-round magazine lies in the pack ("${lastLog(b)}")`);
  // No loaded spare left and nothing loose on them: refused (the base's 60 AP in its stock are not a source).
  b.phase = "player"; loadMag(p, 3); p.ap = 1;
  for (const it of boxesOf(a)) it.dur = 0; sweepBoxes(a); refitKit(b, p, a); // (the test empties the rounds at hand the gun took to the field: carrykit.js looseWant)
  const none = reloadRefusal(b, p);
  check(/^No ammo to load: no loaded spare magazine, and no rounds for the assault rifle/.test(none) && /The base's 60 are in its stock, not to hand in a fight/.test(none) && combatAct(st, { type: "reload", unit: p.id }) !== "" && p.ap === 1 && p.mag === 3, `no loaded spare and nothing loose on them: refused, nothing spent ("${none}")`);
  // Loose rounds in the pack: a top-up by hand, 6 a Reload, both actions.
  a.gear.backpack.contents[2] = roundItem("a_556_fmj", 10, true);
  refitKit(b, p, a); p.ap = 1; b.phase = "player";
  check(reloadCost(b, p) === 2 && /rounds are in the pack: both actions/.test(reloadRefusal(b, p)) && /both actions/.test(combatAct(st, { type: "reload", unit: p.id })) && p.ap === 1 && p.mag === 3, "10 loose FMJ in the pack: a top-up by hand takes both actions (refused with 1)");
  p.ap = 2; b.phase = "player";
  check(combatAct(st, { type: "reload", unit: p.id }) === "" && p.ap === 0 && p.mag === 9 && p.load === "fmj" && stackText("556", p.stack) === "5.56 NATO FMJ ×6, 5.56 NATO armour-piercing ×3" && a.gear.backpack.contents[2].dur === 4, `with 2: 6 go in on top of the 3 AP (9/30), FMJ in the chamber, 4 left in the pack (${stackText("556", p.stack)})`);
  check(logHas(b, /tops up the assault rifle[^:]*'s magazine by hand: 6 5\.56 NATO FMJ from the pack \(9\/30; chamber: 5\.56 NATO FMJ, both actions\)\./), `the log: a top-up by hand, the chamber named ("${lastLog(b)}")`);
  // A type asked for by name: its rounds from the nearest place (none on them: refused, the stock named).
  b.phase = "player"; p.ap = 2;
  const noAp = reloadRefusal(b, p, "ap");
  check(/^No ammo to load: no 5\.56 NATO armour-piercing on them/.test(noAp) && /No loaded spare magazine of it either/.test(noAp) && /base's 60 are in its stock/.test(noAp), `AP asked for with none on them: refused ("${noAp}")`);
  a.pockets[1] = roundItem("a_556_ap", 12, true); refitKit(b, p, a); p.ap = 2; b.phase = "player";
  check(reloadCost(b, p, "ap") === 1 && reloadPlan(b, p, "ap").n === 6 && combatAct(st, { type: "reload", unit: p.id, ammo: "ap" }) === "" && p.ap === 1 && p.mag === 15 && p.load === "ap" && stackText("556", p.stack) === "5.56 NATO armour-piercing ×6, 5.56 NATO FMJ ×6, 5.56 NATO armour-piercing ×3" && a.pockets[1].dur === 6, `12 AP in a pocket: a top-up with AP by name, 6 for 1 action, on top (15/30, AP in the chamber, 6 left in the pocket)`);
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
    check(fittedMag(d.gear.weapon) && fittedMag(d.gear.weapon).key === "mag_stanag_30" && d.pockets[0] && d.pockets[0].key === "drum" && stackN(d.pockets[0].stack) === 0 && pd.mags.some((m) => m.where === "pocket" && m.key === "drum" && m.n === 0), "the swap is physical: the 30 is the gun's fitted magazine, the drum lies in the pocket, empty");
  }
  // Internal magazines: up to MAGS.LOOSE (6) a Reload whatever the gun, out of the shooter's own pocket (1 action), the
  // rounds leaving the pocket; a clip (speedloader, stripper clip) only when picked ({ clip: i }), once a fight.
  const st2 = createWorld({ seed: seed + 21, factionCount: 4 });
  const crew = ["shotgun", "leverrifle", "huntrifle", "revolver", "dbshotgun"].map((k) => fighter(st2, k));
  crew[3].pockets = crew[3].pockets.map(() => null); crew[3].pockets[0] = newItem("speedloader");
  crew[2].pockets = crew[2].pockets.map(() => null); crew[2].pockets[0] = newItem("stripper308");
  for (const s of crew.slice(1, 4)) s.pockets[1] = roundItem(baseKey(WEAPONS[s.gear.weapon.key].cal), 20, true); // 20 loose rounds of the gun's common load in a pocket (the shotgunners get 30 shells out of the stock: carrykit.js packShells)
  const h2 = hub(st2);
  setRounds(h2.stock, 400, crew.map((s) => s.gear.weapon.key));
  const b2 = (st2.combat = createBattle(st2, { tile: h2.tile, baseId: h2.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 1, power: 3 }, ambush: null, canRetreat: true, handler: "magtest", context: {} }));
  for (const u of b2.units) if (u.side === "enemy") { u.x = -10; u.y = -10; u.dead = true; }
  keepFoe(b2, 18, 12); // someone left on the map: the fight goes on
  b2.phase = "player";
  const per = { shotgun: 6, leverrifle: 6, huntrifle: 5, revolver: 6, dbshotgun: 2 }; // min(MAGS.LOOSE, the gun's capacity)
  const clips = { huntrifle: { key: "stripper308", n: 5, word: ".308 stripper clip" }, revolver: { key: "speedloader", n: 6, word: "revolver speedloader" } }; // data-kit.js CLIPS
  const kindOf = { shotgun: "tube", leverrifle: "internal", huntrifle: "internal", revolver: "internal", dbshotgun: "break" };
  check(MAGS.LOOSE === 6, "MAGS.LOOSE: 6 loose rounds a Reload");
  for (const s of crew) {
    const u = by(b2, s);
    const k = u.weapon, cap = u.magMax, key = baseKey(WEAPONS[k].cal), start = k === "shotgun" || k === "dbshotgun" ? 30 : 20;
    check(u.magMode === "internal" && u.mag === cap && rounds(s, key) === start - cap, `${WEAPONS[k].name}: an internal magazine, full (${cap}) out of the shooter's own ${start} at the fight's start (${rounds(s, key)} left in the pocket)`);
    loadMag(u, 0); u.ap = 2;
    const first = reloadPlan(b2, u);
    check(first.mode === "rounds" && first.kind === kindOf[k] && first.from === "hand" && first.cost === 1 && first.n === per[k], `${WEAPONS[k].name}: from empty, the plan puts ${per[k]} in from the pocket for 1 action (${first.mode}/${first.kind} ${first.n} from ${first.from}, ${first.cost}${u.clips && u.clips.length ? "; the clip is not used unless picked" : ""})`);
    check(combatAct(st2, { type: "reload", unit: u.id }) === "" && u.mag === per[k] && u.ap === 1 && rounds(s, key) === start - cap - per[k], `${WEAPONS[k].name}: a Reload puts ${per[k]} in (${u.mag}/${cap}), 1 action, and ${per[k]} left the pocket (${rounds(s, key)} left)`);
    if (clips[k]) {
      const c = clips[k];
      loadMag(u, 0); u.ap = 2;
      const cp = reloadPlan(b2, u, { clip: 0 });
      check(u.clips.length === 1 && u.clips[0].key === c.key && cp.mode === "clip" && cp.from === "pocket" && cp.cost === 1 && cp.n === c.n && !cp.why, `${WEAPONS[k].name}: the ${c.word} picked: ${c.n} out of the pocket's rounds for 1 action`);
      check(combatAct(st2, { type: "reload", unit: u.id, clip: 0 }) === "" && u.mag === c.n && u.ap === 1 && rounds(s, key) === start - cap - per[k] - c.n && u.clips[0].used, `${WEAPONS[k].name}: the clip fills it (${u.mag}/${cap}); ${c.n} left the pocket (${rounds(s, key)} left); the clip is used`);
      check(new RegExp(`reloads the ${k === "revolver" ? "\\.357 revolver" : "hunting rifle[^:]*"} with a ${c.word.replace(".", "\\.")}: ${c.n} .* \\(${c.n}/${cap}\\)\\.`).test(lastLog(b2)), `the log: "${lastLog(b2)}"`);
      loadMag(u, 0); u.ap = 2;
      const left = Math.min(per[k], rounds(s, key));
      check(/used already/.test(reloadPlan(b2, u, { clip: 0 }).why) && reloadPlan(b2, u).mode === "rounds" && reloadPlan(b2, u).n === left, `${WEAPONS[k].name}: the clip is used once a fight; the next Reload is ${left} by hand (the ${rounds(s, key)} left in the pocket, up to ${per[k]})`);
    }
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
    let html = UI.renderCombatScreen(st);
    const has = (s) => html.includes(s);
    const out = [];
    out.push([(has("9mm pistol <b>7/15</b>") && has('data-v="reload"')), "the panel shows 9mm pistol 7/15 and a Reload button"]);
    loadMag(p, 0);
    html = UI.renderCombatScreen(st);
    out.push([has("Empty — reload"), "an empty gun is flagged: Empty — reload"]);
    const k = KM.KEY_BY_ID.get("battle.reload");
    out.push([!!k && k.keys.includes("KeyI"), "the I key is Reload (battle.reload)"]);
    const clash = KM.KEYMAP ? KM.KEYMAP.filter((x) => x.ctx === "battle" && x.id !== "battle.reload" && x.keys.includes("KeyI")) : [];
    out.push([clash.length === 0, "and nothing else in battle uses I"]);
    // The Reload button (or I) with something to pick from opens the picker first; the second press is the plain reload
    // (the next loaded magazine, else the chamber's round from the nearest place).
    UI.combatAction(st, "cb-act", { v: "reload" });
    out.push([p.mag === 0 && p.ap === 2 && UI.cui.ammoAsk === p.id && /pick a magazine or rounds/.test(UI.cui.msg || ""), "the first press of Reload opens the picker (nothing loaded, nothing spent)"]);
    html = UI.renderCombatScreen(st);
    out.push([has("cbreload") && has('data-mag="'), "the picker lists the spare magazines"]);
    UI.combatAction(st, "cb-act", { v: "reload" });
    out.push([p.mag === 15 && p.ap === 1 && UI.cui.ammoAsk == null, "the second press reloads: the pocket's magazine (15/15, 1 action left), the picker closed"]);
    // With nothing on them to pick from, one press says why.
    const st2 = createWorld({ seed: seed + 13, factionCount: 4 });
    const a2 = fighter(st2, "pistol");
    a2.pockets = a2.pockets.map(() => null); // no spares
    const b2 = openBattle(st2, [a2], { kind: "raiders", count: 1, power: 3 });
    const p2 = mine(b2), e2 = foes(b2)[0];
    for (const it of boxesOf(a2)) it.dur = 0; sweepBoxes(a2); refitKit(b2, p2, a2); // (no rounds at hand either: carrykit.js looseWant)
    place(p2, 5, 5); place(e2, 10, 5); toughen(e2);
    UI.cui.sel = p2.id;
    loadMag(p2, 0);
    html = UI.renderCombatScreen(st2);
    out.push([has("Out of ammo") && !has("Empty — reload"), "an empty gun with nothing on them to load is flagged Out of ammo"]);
    UI.combatAction(st2, "cb-act", { v: "reload" });
    out.push([p2.mag === 0 && p2.ap === 2 && /^No ammo to load: no loaded spare magazine, and no rounds for the 9mm pistol on them/.test(UI.cui.msg || "") && /base's \d+ are in its stock/.test(UI.cui.msg || ""), `one press with nothing to pick from: the refusal, nothing spent ("${UI.cui.msg}")`]);
    return out;
  }).catch((err) => [[false, `UI checks ran (${err.message})`]]);
  for (const [o, m] of ok) check(o, m);
}

console.log(`\n${passes} passed, ${fails} failed`);
console.log(fails ? "failed" : "passed");
process.exit(fails ? 1 : 0);
