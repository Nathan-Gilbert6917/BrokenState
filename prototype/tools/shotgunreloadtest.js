// Shotgun reloads (src/sim/mags.js SHELLS; the user's rules 2026-10-18, docs/reload-rules.md: physical rounds for your
// side). Your people: a shotgun loads like every gun, from the shells on the person (pockets, rig pouches, pack:
// mags.js roundSources), up to MAGS.LOOSE (6) a Reload whatever the Shooting skill (no dice, no steady hands, no shaky
// ones), the shells leaving the box as they go in; a pocket or the rig is 1 action, the pack both (refused with one;
// the Inventory window moves a box to a pocket for 1); never a teammate's box, never the team's bags or a base's stock
// (the refusal says where those are); Get shells is gone (nothing is dug out first), a side-saddle adds no loose
// handful. Enemies keep the old rule: START_HAND loose shells out of an endless bag, 2–4 a Reload by the dice, Get
// shells (GRAB) for more. Checks, on paired seeds:
//   - a tube's Reload puts 6 in, capped by the room in the tube and the shells in the box; the same seed gives the same;
//   - at hand: boxes in pockets and rig pouches (1 action); the pack loads straight in for both actions (refused with
//     one left), or the box goes to a pocket first (1 action, the Inventory window); in a base's defence the stock is
//     not the pack: with nothing on the person Reload and Get shells are refused, and the refusal says where the shells
//     are (the stock, a teammate);
//   - a base's defenders take SHELLS.CARRY shells each out of its stock as the fight starts (a pocket), as a trip packs;
//     the tube is filled out of them (24 left in the box);
//   - a double barrel takes both barrels (2), the sawn-off too, the pipe gun its one; the semi-auto is a tube; a tube
//     extension makes 8 (6, then 2);
//   - the AI's shotguns: enemies by the old rule (a handful out of a bag first when only the bag has shells); yours
//     straight out of the pack for both actions, no handful;
//   - no shells at all: refused; the Reload button and the log say how many and from where.
//   - a team packed for a trip carries SHELLS.CARRY shells a shotgunner at hand (a pocket or a rig pouch: carrykit.js
//     packShells, parties.js launchExpedition), out of what it packed; the team's bags never reload a gun in the field.
// Then the sustained fire of a pump before (SHELLS.on = false: no shell handling, no box of CARRY handed out of the
// stock) and after, shots over N turns.
// Usage: node tools/shotgunreloadtest.js [seed]
import { setRounds, giveRounds, newBox } from "../src/sim/ammo.js";
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, runEnemyPhase, autoPlayerTurn, canFire, loadMag, reload, reloadRefusal, endPlayerTurn, enemyStep, refitKit, WEAPONS } from "../src/sim/combat.js";
import { newItem, packOf, rigPouches, carriedSpots } from "../src/sim/inventory.js";
import { GEAR } from "../src/sim/data.js";
import { SHELLS, MAGS, shellsAt, shellRange, shellPlan, reloadText, reloadPlan, enemyMags, saddleHold } from "../src/sim/mags.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { fitMod } from "../src/sim/gunmods.js";
import { totalRounds } from "../src/sim/ammo.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("shotguntest", () => {});

function fighter(state, weapon, shooting = 9) {
  const s = makeSurvivor(state);
  s.skills.shooting = shooting;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = newItem(weapon);
  for (const slot of ["head", "armor", "arms", "legs", "tool", "rig", "backpack"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew, ammo = 200, enemy = { kind: "raiders", count: 1, power: 3 }) {
  const h = hub(state);
  setRounds(h.stock, 0);
  if (ammo > 0) for (const s of crew) giveRounds(h.stock, ammo, [s.gear.weapon.key]);
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "shotguntest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0); b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  const far = b.units.find((u) => u.side === "enemy"); // one left standing far off, so the fight is not over
  if (far) { far.dead = false; far.x = b.w - 1; far.y = b.h - 1; far.hp = far.maxHp = 1e9; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
const foes = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; };
const logHas = (b, re) => b.log.some((l) => re.test(l.text));
const boxOn = (s) => s.pockets.find((x) => x && /^a_12ga_/.test(x.key)) || null; // the shells in a pocket (the stock's box)
// Enemies (the old rule): Reloads from empty with plenty loose at hand, the shells each puts in.
function counts(b, u, n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) { loadMag(u, 0); u.ap = 2; u.hand = { buck: 1000 }; reload(b, u); out.push(u.mag); }
  return out;
}
// Yours: Reloads from empty, the pocket's box filled to CARRY before each (physical shells: they would run out), the
// shells each puts in.
function fromEmpty(b, u, box, n = 10) {
  const out = [];
  for (let i = 0; i < n; i++) { loadMag(u, 0); box.dur = SHELLS.CARRY; u.ap = 2; reload(b, u); out.push(u.mag); }
  return out;
}
const range = (xs) => `${Math.min(...xs)}–${Math.max(...xs)}`;

// 1. A pump with the base's shells: a box of CARRY in a pocket, 6 a Reload out of it, the room and the box cap it.
{
  console.log("Pump: shells a Reload");
  const st = createWorld({ seed, factionCount: 4 });
  const good = fighter(st, "shotgun", 9), poor = fighter(st, "shotgun", 0);
  const b = openBattle(st, [good, poor]);
  const g = by(b, good), p = by(b, poor);
  check(g.magMode === "internal" && g.magMax === 6 && g.mag === 6, "the pump is a tube (an internal magazine, 6), loaded at the start");
  const s0 = shellsAt(b, g);
  check(s0.box === SHELLS.CARRY - 6 && s0.hand === 0 && s0.pack === 0, `defending the base: ${SHELLS.CARRY} shells out of the stock in a pocket, 6 in the tube, ${SHELLS.CARRY - 6} at hand, nothing loose; the stock's rest is not theirs (${s0.at} at hand, ${s0.pack} in the pack)`);
  check(logHas(b, /Shells out of the stock: 30 shells at hand \(\w+\), 30 shells at hand/), "the log says so");
  check(hub(st).stock.a_12ga_buck === 400 - 2 * SHELLS.CARRY, `the stock is down by them (${hub(st).stock.a_12ga_buck} of 400)`);
  const gBox = boxOn(good), pBox = boxOn(poor);
  check(!!gBox && gBox.dur === SHELLS.CARRY - 6 && g.boxes[0] === gBox && !!pBox && pBox.dur === SHELLS.CARRY - 6, `the pocket's box is the gun's source (u.boxes[0]), ${gBox && gBox.dur} in it once the tube took its 6`);
  // 24 in the box: four Reloads of 6 empty it; the fifth finds nothing.
  const cg = [];
  for (let i = 0; i < 4; i++) { loadMag(g, 0); g.ap = 2; reload(b, g); cg.push(g.mag); }
  check(cg.every((n) => n === 6) && gBox.dur === 0 && shellsAt(b, g).at === 0, `Shooting 9 (aim ${Math.round(g.aim)}): 6 a Reload, no dice (${cg.join(", ")}); four Reloads empty the pocket's ${SHELLS.CARRY - 6}`);
  check(g.ap === 1, "a Reload is 1 action");
  check(logHas(b, /racks in 6 12 gauge 00 buckshot from a pocket \(6\/6\)\.$/), "the log: \"… racks in 6 12 gauge 00 buckshot from a pocket (6/6).\"");
  loadMag(g, 0); g.ap = 2;
  check(/^No ammo to load: no 12 gauge 00 buckshot on them \(none in their pockets, rig or pack\)/.test(reloadRefusal(b, g)) && combatAct(st, { type: "reload", unit: g.id }) !== "" && g.ap === 2 && g.mag === 0, `the fifth: the box empty, Reload refused, no action spent ("${reloadRefusal(b, g)}")`);
  const cp = fromEmpty(b, p, pBox, 6);
  check(cp.every((n) => n === 6) && p.ap === 1, `Shooting 0 (aim ${Math.round(p.aim)}): 6 a Reload too, 1 action (no steady hands, no shaky ones: ${range(cp)})`);
  const st2 = createWorld({ seed, factionCount: 4 });
  const good2 = fighter(st2, "shotgun", 9), poor2 = fighter(st2, "shotgun", 0);
  const b2 = openBattle(st2, [good2, poor2]);
  const g2 = by(b2, good2), cg2 = [];
  for (let i = 0; i < 4; i++) { loadMag(g2, 0); g2.ap = 2; reload(b2, g2); cg2.push(g2.mag); }
  check(cg2.join() === cg.join() && boxOn(good2).dur === 0, "paired: the same seed, the same shells Reload by Reload (nothing is rolled)");
  // The room in the tube caps it, and the shells leave the box as they go in.
  gBox.dur = SHELLS.CARRY; loadMag(g, 0); g.ap = 2; reload(b, g);
  loadMag(g, 5); g.ap = 2; reload(b, g);
  check(g.mag === 6 && gBox.dur === SHELLS.CARRY - 7, `5/6: one shell goes in (the tube's room), one leaves the pocket (${gBox.dur} left)`);
  loadMag(g, 4); g.ap = 2; reload(b, g);
  check(g.mag === 6 && gBox.dur === SHELLS.CARRY - 9 && logHas(b, /racks in 2 12 gauge 00 buckshot from a pocket \(6\/6\)\.$/), `4/6: two go in (6/6), two leave the pocket (${gBox.dur} left)`);
  // The shells in the box cap it.
  gBox.dur = 4; loadMag(g, 0); g.ap = 2;
  const p4 = reloadPlan(b, g), sp4 = shellPlan(b, g);
  check(p4.mode === "rounds" && p4.kind === "tube" && p4.from === "hand" && p4.cost === 1 && p4.n === 4 && sp4.n === 4 && sp4.room === 6 && sp4.at === 4, `4 in the pocket: the plan is 4 from a pocket, 1 action (${p4.n}, shellPlan ${sp4.n} of room ${sp4.room})`);
  reload(b, g);
  check(g.mag === 4 && gBox.dur === 0 && g.ap === 1, `4 go in, the box emptied (${g.mag}/6)`);
  const own = g.boxes.slice(), ownHand = g.handBoxes, ownPocket = g.pocketBoxes; // the pocket's box out of the stock
  g.boxes = [newBox("a_12ga_buck", 2)]; g.handBoxes = 0; g.pocketBoxes = 0; // a box of 2 in the pack
  loadMag(g, 0); g.ap = 2;
  const pk2 = reloadPlan(b, g);
  check(pk2.mode === "rounds" && pk2.from === "pack" && pk2.cost === 2 && pk2.n === 2, `a box of 2 in the pack: the plan is 2 out of the pack, both actions (${pk2.n} from ${pk2.from}, ${pk2.cost})`);
  reload(b, g);
  check(g.mag === 2 && g.ap === 0 && g.boxes[0].dur === 0 && shellsAt(b, g).hand === 0 && shellsAt(b, g).pack === 0, `2 go in for both actions, the box emptied, nothing loose anywhere (${g.mag})`);
  g.boxes = []; g.handBoxes = 0; g.hand = { buck: 5 };
  loadMag(g, 0); g.ap = 2;
  check(/on them/.test(reloadRefusal(b, g)) && /on them/.test(combatAct(st, { type: "reload", unit: g.id })) && g.ap === 2, `nothing on them (a loose counter u.hand is nothing for your people): Reload refused, no action spent ("${reloadRefusal(b, g)}")`);
  const r1 = reloadRefusal(b, g);
  check(pBox.dur === SHELLS.CARRY - 6 && /^No ammo to load: no 12 gauge 00 buckshot on them \(none in their pockets, rig or pack\)\. The base's 340 are in its stock and 24 are on teammates, not to hand in a fight: a gun loads only what its shooter carries \(pockets, rig, pack\)\.$/.test(r1), `the base's stock and the teammate's pocket do not load it: the refusal says where the shells are ("${r1}")`);
  const gs = combatAct(st, { type: "getshells", unit: g.id });
  check(/^Shells load straight from what they carry .*: nothing to get out first\.$/.test(gs) && g.ap === 2 && shellsAt(b, g).hand === 0, `Get shells is gone for your people: refused, no action spent ("${gs}")`);
  for (const o of b.pools) setRounds(o, 0);
  check(/on them \(none in their pockets, rig or pack\)\. 24 are on teammates, not to hand/.test(reloadRefusal(b, g)) && !/stock/.test(reloadRefusal(b, g)), "the base out of shells too: only the teammate's are named");
  const pOwn = p.boxes, pHand = p.handBoxes;
  p.boxes = []; p.handBoxes = 0;
  check(/on them \(none in their pockets, rig or pack\)\.$/.test(reloadRefusal(b, g)), "nobody with any: the refusal names nothing");
  p.boxes = pOwn; p.handBoxes = pHand;
  b.pools[0].a_12ga_buck = 50;
  g.boxes = own; g.handBoxes = ownHand; g.pocketBoxes = ownPocket; gBox.dur = SHELLS.CARRY - 6;
  loadMag(g, 0); loadMag(p, 0);
  check(/^1 action: 6 shells thumbed into the tube \(12 gauge 00 buckshot\) from a pocket\. Up to 6 go in by hand a Reload, from a pocket or the rig in 1 action, the pack both; only what they carry \(never a teammate's or the team's bags\)\. Reload opens the picker/.test(reloadText(b, g)), `the Reload button: "${reloadText(b, g)}"`);
  check(/^1 action: 6 shells thumbed into the tube/.test(reloadText(b, p)) && !/steady|shaken|shaky/.test(reloadText(b, p)), "the Reload button for Shooting 0 reads the same: no steady hands, no shaky ones");
  g.hp = 30;
  const ch = fromEmpty(b, g, gBox, 5);
  check(ch.every((n) => n === 6), `hurt below half: still 6 (${range(ch)})`);
  check(!/shaken/.test(reloadText(b, g)) && shellRange(b, g).shaken === false, "the button says nothing of shaken hands");
  g.hp = 100; g.suppressed = 1; loadMag(g, 0);
  const sr = shellRange(b, g);
  check(sr.lo === 6 && sr.hi === 6 && sr.steady === false && sr.shaken === false, `pinned by suppressing fire: still 6 (shellRange ${sr.lo}–${sr.hi}, no dice to lose)`);
  g.suppressed = 0;
}

// 2. A base's stock is not the pack: nothing on them, Reload and Get shells refused. Their own pack takes both actions
// (refused with one); the Inventory window moves the box to a pocket (1 action), then Reload is 1 action.
{
  console.log("The pack: both actions, or the box to a pocket first");
  const st = createWorld({ seed: seed + 1, factionCount: 4 });
  const a = fighter(st, "shotgun", 9);
  const b = openBattle(st, [a]); // 200 in the stock: 30 of them into a pocket as the fight starts
  const u = by(b, a);
  const pocketBox = boxOn(a);
  check(!!pocketBox && pocketBox.dur === SHELLS.CARRY - 6 && u.boxes[0] === pocketBox && u.handBoxes === 1 && u.pocketBoxes === 1, `the stock's box in a pocket, at hand (${pocketBox && pocketBox.dur} once the tube took its 6)`);
  // Nothing on them, the base's 170 in its stock: refused, and the refusal says where the shells are.
  a.pockets[a.pockets.indexOf(pocketBox)] = null; refitKit(b, u, a); loadMag(u, 0); u.ap = 2;
  check(u.boxes.length === 0 && /on them/.test(reloadRefusal(b, u)) && /base's 170 are in its stock/.test(reloadRefusal(b, u)), `nothing on them, 170 in the stock: "${reloadRefusal(b, u)}"`);
  check(/on them/.test(combatAct(st, { type: "reload", unit: u.id })) && u.ap === 2 && u.mag === 0, "Reload refused, no action spent");
  const gs0 = combatAct(st, { type: "getshells", unit: u.id });
  check(/nothing to get out first/.test(gs0) && u.ap === 2, `Get shells refused too: nothing is dug out first for your people ("${gs0}")`);
  // The same box in their backpack: the pack.
  a.gear.backpack = newItem("backpack"); packOf(a)[0] = pocketBox; refitKit(b, u, a);
  const pl = reloadPlan(b, u);
  check(pl.mode === "rounds" && pl.kind === "tube" && pl.from === "pack" && pl.cost === 2 && pl.n === 6 && pl.runs.length === 1 && pl.runs[0].where === "pack" && reloadRefusal(b, u) === "" && shellsAt(b, u).at === 0 && shellsAt(b, u).pack === SHELLS.CARRY - 6, `nothing at hand, the box in the backpack: the plan is 6 straight out of the pack, both actions (${pl.n} from ${pl.from}, ${pl.cost}; ${shellsAt(b, u).pack} in the pack)`);
  u.ap = 1;
  const r1 = reloadRefusal(b, u);
  check(/^The shells are in the pack: both actions to reload from the pack \(the Inventory window moves a box to a pocket for 1\)\.$/.test(r1) && combatAct(st, { type: "reload", unit: u.id }) === r1 && u.ap === 1 && u.mag === 0, `with one action left it is refused: "${r1}"`);
  check(/^Both actions: 6 shells thumbed into the tube \(12 gauge 00 buckshot\) from the pack \(both actions: the rounds are in the pack\)\. Up to 6 go in by hand a Reload/.test(reloadText(b, u)), `the Reload button says so ("${reloadText(b, u)}")`);
  u.ap = 2;
  check(/nothing to get out first/.test(combatAct(st, { type: "getshells", unit: u.id })) && u.ap === 2 && shellsAt(b, u).hand === 0, "Get shells: nothing comes to hand (refused, no action spent)");
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.mag === 6 && u.ap === 0 && pocketBox.dur === SHELLS.CARRY - 12 && logHas(b, /racks in 6 12 gauge 00 buckshot from the pack \(6\/6, both actions\)\.$/), `a Reload out of the pack: 6 in for both actions, the pack's box down to ${pocketBox.dur} ("… racks in 6 12 gauge 00 buckshot from the pack (6/6, both actions).")`);
  b.phase = "player"; u.ap = 2;
  const rf = combatAct(st, { type: "reload", unit: u.id });
  check(/is full \(6\/6\)/.test(rf) && u.ap === 2, `full: Reload refused ("${rf}")`);
  // A box in the backpack only (the team has none): the same; with one action, the box to a pocket first.
  const st2 = createWorld({ seed: seed + 2, factionCount: 4 });
  const c = fighter(st2, "shotgun", 9);
  c.gear.backpack = newItem("backpack");
  packOf(c)[0] = newBox("a_12ga_buck", 25);
  const b2 = openBattle(st2, [c], 0);
  const v = by(b2, c);
  const sv = shellsAt(b2, v);
  check(sv.at === 0 && sv.pack === 19, `a box in the backpack only: none at hand, 19 in the pack (6 loaded) (${sv.at} / ${sv.pack})`);
  loadMag(v, 0); v.ap = 2;
  check(combatAct(st2, { type: "reload", unit: v.id }) === "" && v.ap === 0 && v.mag === 6 && packOf(c)[0].dur === 13 && logHas(b2, /racks in 6 12 gauge 00 buckshot from the pack \(6\/6, both actions\)\.$/), `a Reload straight from the pack: both actions, 6 in, ${packOf(c)[0].dur} left in the pack`);
  b2.phase = "player"; loadMag(v, 0); v.ap = 2;
  check(/nothing to get out first/.test(combatAct(st2, { type: "getshells", unit: v.id })) && v.ap === 2, "Get shells: no handful comes out of the pack any more (refused)");
  const mv = combatAct(st2, { type: "inv", unit: v.id, from: `s:${c.id}:pack:0`, to: `s:${c.id}:pocket:0` });
  const pm = reloadPlan(b2, v);
  check(mv === "" && v.ap === 1 && c.pockets[0] && c.pockets[0].dur === 13 && !packOf(c)[0] && pm.from === "hand" && pm.cost === 1 && pm.n === 6, `or the box to a pocket in the Inventory window (1 action): at hand now, the plan 6 for 1 action (${pm.n} from ${pm.from}, ${pm.cost})`);
  check(combatAct(st2, { type: "reload", unit: v.id }) === "" && v.mag === 6 && v.ap === 0 && c.pockets[0].dur === 7 && logHas(b2, /racks in 6 12 gauge 00 buckshot from a pocket \(6\/6\)\.$/), `then Reload (1 action): 6 in from the pocket (${c.pockets[0].dur} left)`);
}

// 3. At hand: a box in a pocket, a box in a rig pouch; Reloads spend the rig's first, the shots come off the tube.
{
  console.log("Pockets and rig");
  const st = createWorld({ seed: seed + 3, factionCount: 4 });
  const pk = fighter(st, "shotgun", 9), rg = fighter(st, "shotgun", 9);
  pk.pockets[0] = newBox("a_12ga_buck", 25);
  rg.gear.rig = newItem("chestrig");
  rigPouches(rg)[0] = newBox("a_12ga_buck", 25);
  rg.gear.backpack = newItem("backpack");
  packOf(rg)[0] = newBox("a_12ga_buck", 25);
  const b = openBattle(st, [pk, rg], 0, { kind: "raiders", count: 1, power: 3 });
  const u = by(b, pk), w = by(b, rg), t = foes(b)[0];
  check(u.handBoxes === 1 && w.handBoxes === 1 && w.boxes.length === 2 && w.boxes[0] === rigPouches(rg)[0], "the pocket's box and the rig pouch's box are at hand (the rig's ahead of the pack's in u.boxes)");
  check(shellsAt(b, u).at === 19 && shellsAt(b, w).at === 19 && shellsAt(b, w).pack === 25 && shellsAt(b, u).pack === 0 && shellsAt(b, u).hand === 0, `25 in the box, 6 loaded: 19 at hand, nothing loose; the pack at home: their own backpack's box only, never the teammate's (${JSON.stringify(shellsAt(b, u))} ${JSON.stringify(shellsAt(b, w))})`);
  place(w, 5, 5); place(t, 7, 5); t.hp = t.maxHp = 1e9;
  let fired = 0;
  for (let i = 0; i < 30 && fired < 20; i++) { b.phase = "player"; w.ap = 2; w.jam = null; if (canFire(b, w)) { if (combatAct(st, { type: "shoot", unit: w.id, target: t.id }) === "") fired++; } else combatAct(st, { type: "reload", unit: w.id }); }
  check(rigPouches(rg)[0].dur === 1 && packOf(rg)[0].dur === 25 && w.mag === 4, `20 shots and three Reloads of 6: out of the rig's box first (rig ${rigPouches(rg)[0].dur}, pack ${packOf(rg)[0].dur}); the shots come off the tube (${w.mag}/6 in it)`);
  loadMag(w, 0); w.ap = 2;
  const p1 = reloadPlan(b, w);
  check(p1.n === 1 && p1.from === "hand" && p1.cost === 1 && combatAct(st, { type: "reload", unit: w.id }) === "" && w.mag === 1 && w.ap === 1 && !rigPouches(rg)[0], `the rig's last shell: the auto plan takes it alone, 1 action, never mixing the pack's in (${p1.n} from ${p1.from}); the emptied box is thrown away`);
  const p2 = reloadPlan(b, w);
  check(p2.n === 5 && p2.from === "pack" && p2.cost === 2 && /both actions/.test(reloadRefusal(b, w)), `then the pack: 5 more for both actions, refused with the one action left (${p2.n} from ${p2.from}, ${p2.cost})`);
  loadMag(u, 0); u.ap = 2;
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.mag === 6 && u.ap === 1 && pk.pockets[0].dur === 13, `the pocket's box reloads straight away: 6 in, 1 action (${pk.pockets[0].dur} left)`);
}

// 4. The double barrel: both barrels, 2; the semi-auto shotgun is a tube; the pipe gun one shell; a tube extension 8.
{
  console.log("Double barrel, semi-auto, pipe gun, tube extension");
  const st = createWorld({ seed: seed + 4, factionCount: 4 });
  const d = fighter(st, "dbshotgun", 0), so = fighter(st, "sawnoff", 9), se = fighter(st, "semishotgun", 9), pg = fighter(st, "pipegun", 9), ex = fighter(st, "shotgun", 9);
  fitMod(ex.gear.weapon, newItem("tubeext"));
  const b = openBattle(st, [d, so, se, pg, ex]);
  const ud = by(b, d), us = by(b, so), ue = by(b, se), upg = by(b, pg), ux = by(b, ex);
  const dBox = boxOn(d), sBox = boxOn(so), eBox = boxOn(se), pBox = boxOn(pg), xBox = boxOn(ex);
  check(ud.mag === 2 && dBox.dur === SHELLS.CARRY - 2 && upg.mag === 1 && pBox.dur === SHELLS.CARRY - 1, `each loaded out of its pocket's box at the start (the double barrel ${dBox.dur} left, the pipe gun ${pBox.dur})`);
  check(fromEmpty(b, ud, dBox, 10).every((n) => n === 2) && ud.ap === 1 && dBox.dur === SHELLS.CARRY - 2, "the double barrel: one Reload, both barrels (2/2), 1 action, 2 out of the pocket");
  check(fromEmpty(b, us, sBox, 10).every((n) => n === 2), "the sawn-off too");
  loadMag(ud, 1); ud.ap = 2; reload(b, ud);
  check(ud.mag === 2 && dBox.dur === SHELLS.CARRY - 3, "one barrel fired: 1 in (2/2), one out of the pocket");
  check(logHas(b, /breaks open the double-barrel shotgun and drops in 2 12 gauge 00 buckshot from a pocket \(2\/2\)\.$/) && logHas(b, /breaks open the double-barrel shotgun and drops in 1 12 gauge 00 buckshot from a pocket \(2\/2\)\.$/), "the log: \"… breaks open the double-barrel shotgun and drops in 2 12 gauge 00 buckshot from a pocket (2/2).\"");
  loadMag(ud, 0);
  check(/^1 action: 2 shells into the barrels \(12 gauge 00 buckshot\) from a pocket\./.test(reloadText(b, ud)), `the Reload button says the barrels ("${reloadText(b, ud)}")`);
  d.gear.backpack = newItem("backpack"); packOf(d)[0] = dBox; d.pockets[d.pockets.indexOf(dBox)] = null; refitKit(b, ud, d); // the stock's box in the backpack instead
  loadMag(ud, 0); ud.ap = 2;
  const pd = reloadPlan(b, ud);
  check(pd.mode === "rounds" && pd.kind === "break" && pd.from === "pack" && pd.cost === 2 && pd.n === 2 && combatAct(st, { type: "reload", unit: ud.id }) === "" && ud.mag === 2 && ud.ap === 0 && logHas(b, /drops in 2 12 gauge 00 buckshot from the pack \(2\/2, both actions\)\.$/), "the double barrel with none at hand: both barrels straight out of the pack, both actions");
  const ce = fromEmpty(b, ue, eBox, 10);
  check(ue.magMode === "internal" && ce.every((n) => n === 6), `the semi-auto shotgun: a tube, 6 a Reload (${range(ce)})`);
  check(fromEmpty(b, upg, pBox, 5).every((n) => n === 1) && logHas(b, /loads 1 12 gauge 00 buckshot from a pocket \(1\/1\)\.$/), "the pipe gun: its one shell");
  check(ux.magMax === 8 && ux.mag === 8 && xBox.dur === SHELLS.CARRY - 8, `a tube extension: 8 in the tube at the start, ${xBox.dur} in the pocket`);
  loadMag(ux, 0); ux.ap = 2;
  check(combatAct(st, { type: "reload", unit: ux.id }) === "" && ux.mag === 6 && ux.ap === 1 && reloadPlan(b, ux).n === 2, `from empty: 6 for 1 action (${MAGS.LOOSE} a Reload at most), the next Reload the last 2`);
  check(combatAct(st, { type: "reload", unit: ux.id }) === "" && ux.mag === 8 && ux.ap === 0 && xBox.dur === SHELLS.CARRY - 16 && logHas(b, /racks in 2 12 gauge 00 buckshot from a pocket \(8\/8\)\.$/), `then 2 (8/8), ${xBox.dur} in the pocket`);
}

// 5. The AI's shotguns: enemies by the old rule (the extra action spent when the bag is all there is), yours straight
// out of the pack.
{
  console.log("AI parity");
  const st = createWorld({ seed: seed + 5, factionCount: 4 });
  const a = fighter(st, "pistol");
  const b = openBattle(st, [a], 200, { kind: "raiders", count: 2, power: 3 });
  const e = foes(b)[0];
  e.weapon = "shotgun"; e.weaponName = "Pump shotgun"; e.item = null; e.arsItem = null; e.modItems = null;
  enemyMags(e, 6, 0, false);
  loadMag(e);
  check(e.magMode === "internal" && e.hand && e.hand.buck === SHELLS.START_HAND, `an enemy's pump: a tube, ${SHELLS.START_HAND} loose shells at hand`);
  const steady = e.aim >= SHELLS.STEADY_AIM;
  const ce = counts(b, e, 30);
  check(ce.every((n) => n >= (steady ? 3 : 2) && n <= (steady ? 4 : 3)), `an enemy (aim ${Math.round(e.aim)}): ${steady ? "3–4" : "2–3"} shells a Reload (${range(ce)})`);
  e.hand = { buck: 0 }; loadMag(e, 0); e.ap = 2;
  reload(b, e);
  check(e.mag >= 2 && e.ap === 0 && logHas(b, /racks in \d shells out of a bag \(\d\/6, both actions\)/), `none at hand: the enemy's own Reload digs shells straight out of a bag, both actions (${e.mag})`);
  // The enemy AI prefers a handful out of the bag (1 action) and a Reload from it (1 action): more at hand for the next.
  e.hand = { buck: 0 }; loadMag(e, 0);
  endPlayerTurn(st);
  let n = 0;
  while (b.phase === "enemy" && n++ < 20) enemyStep(st);
  check(logHas(b, /digs 8 shells out of a bag \(8 at hand\)/) && e.mag >= 2, `the enemy AI with none at hand: digs a handful out of a bag (1 action), then loads from it (${e.mag}/6)`);
  b.phase = "player";
  // Fights played by the AI: your side's shotguns out of the pocket's box, theirs out of the handful and the bag.
  const st2 = createWorld({ seed: seed + 6, factionCount: 4 });
  const crew = [fighter(st2, "shotgun", 5), fighter(st2, "shotgun", 7), fighter(st2, "dbshotgun", 4)];
  const h = hub(st2);
  setRounds(h.stock, 0); giveRounds(h.stock, 120, ["shotgun"]);
  const b2 = (st2.combat = createBattle(st2, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 5, power: 4 }, ambush: null, canRetreat: true, handler: "shotguntest", context: {} }));
  for (const u of b2.units) if (u.side === "player") loadMag(u, 0); // empty guns: the first turn is a Reload out of the pocket's box (a short fight would see none otherwise)
  const lines = new Set(); // every line as it is logged (the battle log keeps the last 80 only: a long fight loses the first turns')
  for (let t = 0; t < 80 && !b2.over; t++) { autoPlayerTurn(st2, { retreat: false }); for (const l of b2.log) lines.add(l.text); runEnemyPhase(st2); for (const l of b2.log) lines.add(l.text); }
  check(b2.over, `an AI-played fight with pumps and a double barrel ends (turn ${b2.turn})`);
  const yours = crew.map((s) => s.name);
  const said = (re) => [...lines].some((t) => re.test(t));
  check(said(new RegExp(`^(${yours.join("|")}) racks in 6 12 gauge 00 buckshot from a pocket \\(6/6\\)\\.$`)) && said(new RegExp(`^${crew[2].name} breaks open the double-barrel shotgun and drops in 2 12 gauge 00 buckshot from a pocket \\(2/2\\)\\.$`)), "your side's shotguns reload by the shell rules (6 into the tube, 2 into the barrels, out of the pocket's box)");
  check(!said(new RegExp(`^(${yours.join("|")}) (racks in \\d shells|takes \\d+ shells|digs \\d+ shells)`)), "none of yours by the old rule (a shells count, a handful out of the pack)");
  // Your side's AI with an empty pump and nothing at hand: straight out of the pack, both actions, no handful first.
  const st3 = createWorld({ seed: seed + 7, factionCount: 4 });
  const c3 = fighter(st3, "shotgun", 7);
  c3.gear.backpack = newItem("backpack"); packOf(c3)[0] = newBox("a_12ga_buck", 25); // their shells in the backpack, none in the stock
  const b3 = openBattle(st3, [c3], 0, { kind: "raiders", count: 1, power: 3 });
  const u3 = by(b3, c3), t3 = foes(b3)[0];
  place(u3, 5, 5); place(t3, 9, 5); t3.hp = t3.maxHp = 1e9;
  loadMag(u3, 0); u3.ap = 2;
  autoPlayerTurn(st3, { retreat: false });
  check(!logHas(b3, /takes \d+ shells of .* out of the pack/) && logHas(b3, new RegExp(`${c3.name} racks in 6 12 gauge 00 buckshot from the pack \\(6/6, both actions\\)`)) && u3.mag === 6 && packOf(c3)[0].dur === 13, `your side's AI, nothing at hand: no handful out of the pack, a Reload straight out of it for both actions (${u3.mag}/6, ${packOf(c3)[0].dur} left in the pack)`);
}

// 6. Sustained fire: a pump shooting whenever it can (a shot ends the turn), reloading when empty, from full, 30 turns,
// before (SHELLS.on = false: no shell handling, a plain internal magazine of 6 by the same 6-a-Reload rule, and no box
// of CARRY handed out of the base's stock) and after. "stand": 2 actions a turn; "move": 1 action a turn (the other
// spent moving). Shells: the base's stock (a box of CARRY handed out as the fight starts; before, the stock is not a
// source at all: the tube's 6 are the fight) or 3 boxes in the pockets.
{
  console.log("Sustained fire (shots in 10 / 30 turns, a pump from full, 8 seeds)");
  const run = (shooting, pocket, on, s0, apTurn) => {
    SHELLS.on = on;
    try {
      const st = createWorld({ seed: s0, factionCount: 4 });
      const f = fighter(st, "shotgun", shooting);
      if (pocket) for (let i = 0; i < 3; i++) f.pockets[i] = newBox("a_12ga_buck", 25);
      const b = openBattle(st, [f], pocket ? 0 : 400, { kind: "raiders", count: 1, power: 3 });
      const u = by(b, f), t = foes(b)[0];
      place(u, 5, 5); place(t, 7, 5); t.hp = t.maxHp = 1e9;
      const shots = [];
      let n = 0;
      for (let turn = 1; turn <= 30; turn++) {
        b.phase = "player"; u.ap = apTurn; u.cd = 0;
        for (let guard = 0; u.ap > 0 && guard < 4; guard++) {
          u.jam = null;
          if (canFire(b, u)) { if (combatAct(st, { type: "shoot", unit: u.id, target: t.id }) === "") n++; break; }
          if (combatAct(st, { type: "reload", unit: u.id }) === "") continue;
          if (combatAct(st, { type: "getshells", unit: u.id }) !== "") break;
        }
        shots.push(n);
      }
      return { s10: shots[9], s30: shots[29] };
    } finally { SHELLS.on = true; }
  };
  const avg = (shooting, pocket, on, apTurn) => { let a = 0, c = 0; for (let i = 0; i < 8; i++) { const r = run(shooting, pocket, on, seed + 100 + i, apTurn); a += r.s10; c += r.s30; } return { s10: a / 8, s30: c / 8 }; };
  for (const apTurn of [2, 1]) for (const [label, sh, pk] of [["Shooting 3, the base's stock", 3, false], ["Shooting 9, the base's stock", 9, false], ["Shooting 3, boxes in pockets", 3, true], ["Shooting 9, boxes in pockets", 9, true]]) {
    const before = avg(sh, pk, false, apTurn), after = avg(sh, pk, true, apTurn);
    console.log(`    ${apTurn === 2 ? "stand" : "move "} ${label.padEnd(30)} before ${before.s10.toFixed(1)} / ${before.s30.toFixed(1)}   after ${after.s10.toFixed(1)} / ${after.s30.toFixed(1)}  (${Math.round((after.s30 / before.s30 - 1) * 100)}% over 30 turns)`);
    // With boxes in the pockets the shell rules are a plain internal magazine (6 a Reload from the pocket, 1 action):
    // the same shots. Out of the stock, the handed-out box is what keeps a defender firing at all (before, the stock
    // is no source: 6 shots and done). Standing, a shot every turn (the 1-action Reload leaves the other for the shot);
    // moving, a turn to reload every 6 shots. Never crippled.
    const same = apTurn === 2 && pk;
    check(after.s30 >= before.s30 * 0.5 && (!same || after.s30 <= before.s30 * 1.1 + 1e-9), `${apTurn === 2 ? "standing" : "moving"}, ${label}: ${same ? "about as fast as before" : "no slower than before"}, not crippled`);
    check(after.s30 === (apTurn === 2 ? 30 : 26) && after.s10 === (apTurn === 2 ? 10 : 9), `${apTurn === 2 ? "standing: a shot every turn (30 in 30)" : "moving: 26 in 30 (a turn to reload every 6)"} (${after.s10} / ${after.s30})`);
    if (pk) check(before.s30 === after.s30, "boxes in the pockets: the shell rules change nothing (6 a Reload either way)");
  }
}

// 7. Packed for a trip: shells at hand out of the packed rounds; the team's bags are never a source in the field; a
// side-saddle adds nothing for your people.
{
  console.log("Shells at hand for a trip");
  const st = createWorld({ seed: seed + 9, factionCount: 4 });
  st.started = true;
  const h = hub(st);
  const sg = fighter(st, "shotgun", 7), db = fighter(st, "dbshotgun", 5), pi = fighter(st, "pistol", 5);
  sg.pockets[0] = newItem("headlamp");
  setRounds(h.stock, 0); giveRounds(h.stock, 300, ["shotgun", "pistol"]);
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2).id;
  const res = launchExpedition(st, { memberIds: [sg.id, db.id, pi.id], dest, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { ammo: 150, food: 3, water: 3 } });
  const p = res.party;
  check(!!p, `a team of a pump, a double barrel and a pistol sets out (${res.error || "ok"})`);
  if (p) {
    const shellsOn = (s) => s.pockets.filter((x) => x && /^a_12ga_/.test(x.key)).reduce((a, x) => a + x.dur, 0);
    const packed = totalRounds(p.supplies) + partyMembers(st, p).reduce((a, s) => a + shellsOn(s), 0);
    check(shellsOn(sg) === SHELLS.CARRY && shellsOn(db) === SHELLS.CARRY && shellsOn(pi) === 0, `each shotgunner carries ${SHELLS.CARRY} shells in a pocket (${shellsOn(sg)}, ${shellsOn(db)}; the pistol none)`);
    // (and the launch's loadout, parties.js: the pistol's magazine and the spares it carries; the shotguns' loads are
    // the shells already at hand)
    const pistolLoad = WEAPONS.pistol.cap + carriedSpots(pi).filter((x) => x.item && GEAR[x.item.key] && GEAR[x.item.key].mag).reduce((a, x) => a + GEAR[x.item.key].mag.cap, 0);
    check(packed === 150 + pistolLoad, `out of what the team packed: ${totalRounds(p.supplies)} in the pack + ${shellsOn(sg) + shellsOn(db)} at hand = ${packed} of 150 and the pistol's ${pistolLoad}`);
    const b = (st.combat = createBattle(st, { tile: dest, partyId: p.id, enemy: { kind: "raiders", count: 1, power: 3 }, ambush: null, canRetreat: true, handler: "shotguntest", context: {} }));
    const u = by(b, sg), s0 = shellsAt(b, u);
    check(u.mag === 6 && s0.box === SHELLS.CARRY - 6 && s0.at === SHELLS.CARRY - 6 && s0.hand === 0 && s0.pack === 0, `in the fight: 6 in the tube and ${s0.at} at hand out of the pocket's ${SHELLS.CARRY} (no loose handful), ${s0.pack} in the pack (the team's bags are not it)`);
    const d = by(b, db), sd = shellsAt(b, d);
    check(sd.at === SHELLS.CARRY - 2, `the double barrel: 2 in the barrels, ${sd.at} at hand`);
    // On the road the team's bags are never a source (nor a teammate's box): the pocket's box shot off, a Reload is
    // refused, and the refusal says where the shells are; Get shells too.
    const sgBox = boxOn(sg);
    const bags = b.pools.reduce((a, o) => a + Math.max(0, Math.floor(o.a_12ga_buck || 0)), 0);
    sgBox.dur = 0; loadMag(u, 0); u.ap = 1;
    const s1 = shellsAt(b, u), r1 = reloadRefusal(b, u);
    check(s1.at === 0 && s1.pack === 0 && bags > 0 && new RegExp(`^No ammo to load: no 12 gauge 00 buckshot on them \\(none in their pockets, rig or pack\\)\\. The team's ${bags} are in its bags and ${SHELLS.CARRY - 2} are on teammates, not to hand in a fight: a gun loads only what its shooter carries \\(pockets, rig, pack\\)\\.$`).test(r1) && combatAct(st, { type: "reload", unit: u.id }) === r1 && u.ap === 1 && u.mag === 0, `the pocket's box shot off: nothing at hand, nothing in the pack; the team's ${bags} in its bags and the double barrel's ${SHELLS.CARRY - 2} never load it ("${r1}")`);
    u.ap = 2;
    const gs = combatAct(st, { type: "getshells", unit: u.id });
    check(/nothing to get out first/.test(gs) && u.ap === 2 && combatAct(st, { type: "reload", unit: u.id }) === r1 && u.ap === 2 && u.mag === 0, `Get shells refused too, and both actions change nothing ("${gs}")`);
    for (const o of b.pools) setRounds(o, 0);
    for (const o of b.units) if (o.side === "player" && o.boxes) for (const x of o.boxes) x.dur = 0;
    loadMag(u, 0); u.ap = 2;
    check(/^No ammo to load: no 12 gauge 00 buckshot on them \(none in their pockets, rig or pack\)\.$/.test(reloadRefusal(b, u)) && reloadRefusal(b, u) === combatAct(st, { type: "reload", unit: u.id }) && u.ap === 2 && /nothing to get out first/.test(combatAct(st, { type: "getshells", unit: u.id })), `the bags and the teammate's box empty too: the refusal names nothing else ("${reloadRefusal(b, u)}")`);
    st.combat = null;
  }
  // Packed again with shells already at hand: topped up to CARRY, not more.
  const st2 = createWorld({ seed: seed + 10, factionCount: 4 });
  st2.started = true;
  const h2 = hub(st2);
  const sg2 = fighter(st2, "shotgun", 7);
  sg2.pockets[1] = newBox("a_12ga_buck", 10);
  setRounds(h2.stock, 0); giveRounds(h2.stock, 200, ["shotgun"]);
  const dest2 = st2.tiles.find((t) => t.terrain !== "water" && st2.grid.distance(t.id, h2.tile) === 2).id;
  const r2 = launchExpedition(st2, { memberIds: [sg2.id], dest: dest2, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { ammo: 60, food: 2, water: 2 } });
  const at2 = sg2.pockets.filter((x) => x && /^a_12ga_/.test(x.key)).reduce((a, x) => a + x.dur, 0);
  check(!!r2.party && at2 === SHELLS.CARRY && sg2.pockets.filter((x) => x && /^a_12ga_/.test(x.key)).length === 1, `a pocket box of 10 is topped up to ${SHELLS.CARRY} (${at2}, one stack)`);
  // A small box in a pocket, defending the base: topped up to CARRY out of the stock, then the tube filled out of it.
  {
    const st4 = createWorld({ seed: seed + 12, factionCount: 4 });
    const f4 = fighter(st4, "shotgun", 7);
    f4.pockets[0] = newBox("a_12ga_buck", 8);
    const b4 = openBattle(st4, [f4], 200);
    const s4 = shellsAt(b4, by(b4, f4));
    check(s4.at === SHELLS.CARRY - 6 && s4.box === SHELLS.CARRY - 6 && s4.hand === 0 && f4.pockets[0].dur === SHELLS.CARRY - 6 && f4.pockets.filter((x) => x && /^a_12ga_/.test(x.key)).length === 1, `a box of 8 in a pocket, defending the base: topped up to ${SHELLS.CARRY} out of the stock (one stack), the tube's 6 out of it, ${s4.at} in the box, nothing loose`);
    // The stock empty: the box of 8 is all there is (6 in the tube, 2 at hand), nothing out of the team's or the base's.
    const st5 = createWorld({ seed: seed + 13, factionCount: 4 });
    const f5 = fighter(st5, "shotgun", 7);
    f5.pockets[0] = newBox("a_12ga_buck", 8);
    const b5 = openBattle(st5, [f5], 0);
    const s5 = shellsAt(b5, by(b5, f5));
    check(s5.at === 2 && s5.box === 2 && s5.hand === 0 && s5.pack === 0, `an empty stock: the box of 8 is all they have (6 in the tube, ${s5.at} at hand)`);
    st4.combat = null; st5.combat = null;
  }
  // A side-saddle: nothing loose for your people (saddleHold is an enemy thing): the box at hand and the pack's as on a bare pump.
  const st3 = createWorld({ seed: seed + 11, factionCount: 4 });
  const a3 = fighter(st3, "shotgun", 7), b3f = fighter(st3, "shotgun", 7);
  fitMod(a3.gear.weapon, newItem("sidesaddle"));
  for (const s of [a3, b3f]) { s.gear.backpack = newItem("backpack"); packOf(s)[0] = newBox("a_12ga_buck", 25); } // a box in each backpack: the pack
  const b3 = openBattle(st3, [a3, b3f], 200);
  const ua = by(b3, a3), ub = by(b3, b3f);
  check(saddleHold(ua) === SHELLS.SADDLE && shellsAt(b3, ua).hand === 0 && shellsAt(b3, ub).hand === 0 && shellsAt(b3, ua).at === SHELLS.CARRY - 6 && shellsAt(b3, ub).at === SHELLS.CARRY - 6 && shellsAt(b3, ua).pack === 25 && shellsAt(b3, ub).pack === 25, `a side-saddle holds ${SHELLS.SADDLE} for an enemy, nothing loose for yours (${shellsAt(b3, ua).hand} against ${shellsAt(b3, ub).hand}; the pocket's ${shellsAt(b3, ua).at} against ${shellsAt(b3, ub).at}, the pack ${shellsAt(b3, ua).pack} against ${shellsAt(b3, ub).pack})`);
  loadMag(ua, 0); ua.ap = 2;
  const pa = reloadPlan(b3, ua);
  check(pa.n === 6 && pa.from === "hand" && pa.cost === 1 && shellRange(b3, ua).hi === 6 && shellRange(b3, ua).saddle === 0, `the saddled pump reloads 6 out of the pocket's box like any (${pa.n} from ${pa.from}, no saddle bonus)`);
  // A saddled pump with the pocket's box only: nothing loose (the saddle is not a source).
  const st6 = createWorld({ seed: seed + 14, factionCount: 4 });
  const a6 = fighter(st6, "shotgun", 7);
  fitMod(a6.gear.weapon, newItem("sidesaddle"));
  const b6 = openBattle(st6, [a6], 200);
  check(shellsAt(b6, by(b6, a6)).hand === 0 && shellsAt(b6, by(b6, a6)).at === SHELLS.CARRY - 6, `a saddled pump with the pocket's box only: nothing loose beyond it (${shellsAt(b6, by(b6, a6)).at} at hand)`);
  st6.combat = null;
  ua.ap = 2; ub.ap = 2;
  check(/nothing to get out first/.test(combatAct(st3, { type: "getshells", unit: ua.id })) && /nothing to get out first/.test(combatAct(st3, { type: "getshells", unit: ub.id })) && ua.ap === 2 && ub.ap === 2, "Get shells is refused on the saddled pump and the bare one alike");
  st3.combat = null;
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
