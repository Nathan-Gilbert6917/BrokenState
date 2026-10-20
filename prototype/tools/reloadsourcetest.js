// Reload sources (2026-10-17 user request: "reload guns including shotguns from loose ammo/shells from pockets, rigs in
// addition to pack, only reload from pack uses double action"; 2026-10-18 user rules, docs/reload-rules.md: PHYSICAL
// rounds for your side, src/sim/mags.js roundSources / roundSplit / roundSource / sourceWord / reloadPlan / doReload,
// src/sim/ammo.js boxesOf / takeBattleRounds, src/sim/combat.js reloadRefusal / aiReload / autoRaidTurn). Checks:
//   - a revolver with loose rounds in a pocket reloads 6 for 1 action; with the rounds only in the pack it costs both
//     actions and is refused with one left; the rounds leave the item; the log and the Reload button name the source;
//     a teammate's rounds and the team's bags are never a source (the refusal names where they are, nothing is spent);
//   - a rig admin pouch of loose 9mm feeds a 1-action top-up by hand (the rig's rounds in u.boxes right after the
//     pockets', u.handBoxes and u.pocketBoxes agree); the pack's top-up takes both; a teammate's box and the team's bags
//     are refused;
//   - a pump shotgun with shells only in the pack loads 6 straight out of it for both actions (no refusal), is refused
//     with one action left; Get shells is refused for your people (shells load straight in); the Inventory window moves
//     the box to a pocket for 1 action, then a Reload is 1;
//   - magazine swaps unchanged (rig 1, pocket 1, pack 2) but physical (the other magazine goes where the fresh one lay,
//     empty); with no loaded spare and nothing on them the base's stock is no source; a speedloader only by { clip: i }
//     (the auto plan loads rounds by hand), 1 from a pocket, 2 from the pack, filled out of their own rounds, used once;
//   - the AI and the raid bot: a revolver from the pocket (6 for 1 action), a shotgun with shells only in the pack
//     straight out of it for both actions (no Get shells), with one action left it waits; the raid bot's shotgunner
//     loads from the pocket packed for the trip, the team's bags untouched;
//   - the order of depletion: a Reload takes from the pocket first, then (only when nothing is at hand) the pack, and
//     never the teammate's or the pools; shots come out of the gun's stack and touch no box;
//   - the Reload order's cost and tip and the weapon panel's split ("N rds at hand" / "N in the pack", never "the team's");
//   - a save and load in the middle keeps the costs.
// Usage: node tools/reloadsourcetest.js [seed]
import { setRounds, giveRounds, newBox, boxesOf, takeBattleRounds, sideRounds } from "../src/sim/ammo.js";
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, autoPlayerTurn, loadMag, reloadRefusal, reloadCost, magIn, refitKit } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { newItem, packOf, rigPouches, carriedSpots } from "../src/sim/inventory.js";
import { roundItem } from "../src/sim/itemstack.js";
import { itemLoad } from "../src/sim/inventory.js";
import { ADMIN_KG } from "../src/sim/data-kit.js";
import { placeSlots } from "../src/sim/supitems.js";
import { MAGS, SHELLS, reloadPlan, reloadText, roundSplit, roundSource, sourceWord, shellsAt, shellsInPack, tracksMags, isStacked } from "../src/sim/mags.js";
import { stackN } from "../src/sim/roundstack.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("reloadsourcetest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = { addEventListener() {}, devicePixelRatio: 1 }; try { return fn(); } finally { if (!had) delete globalThis.window; } };

const K9 = "a_9mm_fmj", K357 = "a_357_fmj", K12 = "a_12ga_buck";
// A fighter with nothing but the gun (no spare magazines, no rig, no pack: the rounds go where each check puts them).
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
// A field battle on an open map; one enemy left standing far off so the fight goes on, the rest parked off the map.
function openBattle(state, crew, ammo = 0) {
  const h = hub(state);
  setRounds(h.stock, 0);
  if (ammo > 0) for (const s of crew) giveRounds(h.stock, ammo, [s.gear.weapon.key]);
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 1, power: 3 }, ambush: null, canRetreat: true, handler: "reloadsourcetest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0); b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  const far = b.units.find((u) => u.side === "enemy");
  if (far) { far.dead = false; far.x = b.w - 1; far.y = b.h - 1; far.hp = far.maxHp = 1e9; far.aware = false; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
const foes = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; };
const logHas = (b, re) => b.log.some((l) => re.test(l.text));
const lastLog = (b) => (b.log.length ? b.log[b.log.length - 1].text : "");
const again = (b, u, n = 0) => { b.phase = "player"; loadMag(u, n); u.ap = 2; }; // (loadMag trims the stack: the rounds vanish, a test's way to empty a gun)
const withPack = (s) => { s.gear.backpack = newItem("backpack"); return packOf(s); };
const L = (s, slot, i = null) => `s:${s.id}:${slot}${i == null ? "" : `:${i}`}`; // an inventory location (combatAct inv)
const loose = (s, key) => carriedSpots(s).filter((x) => x.item.key === key).reduce((a, x) => a + Math.floor(x.item.dur), 0); // rounds of a kind on them (an emptied stack is thrown away: sweepBoxes)
const loosePouch = Math.floor((ADMIN_KG + 1e-9) / itemLoad(roundItem(K9, 1, true))); // loose 9mm an admin pouch takes
const NO_SOURCE = /^No ammo to load: no .* on them \(none in their pockets, rig or pack\)\./;

// 1. A revolver: loose rounds in a pocket (1 action) against the same rounds only in the pack (both actions).
{
  console.log("A revolver: a pocket against the pack");
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "revolver"), c = fighter(st, "revolver");
  a.pockets[0] = roundItem(K357, 12, true);
  withPack(c)[0] = roundItem(K357, 12, true);
  const b = openBattle(st, [a, c]);
  const u = by(b, a), v = by(b, c);
  check(isStacked(u) && isStacked(v) && u.magMode === "internal" && u.mag === 6 && v.mag === 6 && stackN(u.stack) === 6, "both revolvers take the field loaded (6/6) out of their own 12 rounds, physically (u.stack)");
  check(a.pockets[0].dur === 6 && packOf(c)[0].dur === 6, "the 6 loaded left the items: 6 left in the pocket, 6 in the pack");
  check(u.handBoxes === 1 && u.pocketBoxes === 1 && u.boxes[0] === a.pockets[0] && v.handBoxes === 0 && v.pocketBoxes === 0 && v.boxes[0] === packOf(c)[0], "the pocket's rounds are at hand (handBoxes 1, pocketBoxes 1), the pack's are not (0)");
  const ra = roundSplit(b, u), rc = roundSplit(b, v);
  check(ra.hand === 6 && ra.pack === 0 && ra.mate === 0 && ra.pool === 0 && rc.hand === 0 && rc.pack === 6 && rc.mate === 0 && rc.pool === 0, `the 6 left: at hand for one, in the pack for the other; the other's are never a teammate's source (mate 0) (${JSON.stringify(ra)} / ${JSON.stringify(rc)})`);
  check(roundSource(b, u) === "hand" && roundSource(b, v) === "pack", "roundSource: hand / pack");
  again(b, u); again(b, v);
  const pa = reloadPlan(b, u), pc = reloadPlan(b, v);
  check(pa.mode === "rounds" && pa.kind === "internal" && pa.from === "hand" && pa.cost === 1 && pa.n === 6 && pa.runs.length === 1 && pa.runs[0].where === "pocket" && reloadCost(b, u) === 1, `the pocket: 6 rounds by hand into the cylinder for 1 action (${pa.mode}/${pa.kind} ${pa.n} from ${pa.from}, ${pa.cost})`);
  check(pc.mode === "rounds" && pc.kind === "internal" && pc.from === "pack" && pc.cost === 2 && pc.n === 6 && reloadCost(b, v) === 2, `the pack: the same 6 for both actions (${pc.mode}/${pc.kind} ${pc.n} from ${pc.from}, ${pc.cost})`);
  check(sourceWord(u, "hand") === "a pocket" && sourceWord(v, "pack") === "the pack", `in words: "${sourceWord(u, "hand")}" / "${sourceWord(v, "pack")}"`);
  check(/^1 action: 6 rounds in \(\.357 Magnum FMJ\) from a pocket\. Up to 6 go in by hand a Reload, from a pocket or the rig in 1 action, the pack both; only what they carry \(never a teammate's or the team's bags\)\. Reload opens the picker/.test(reloadText(b, u)), `the Reload button: "${reloadText(b, u)}"`);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 1 && u.mag === 6 && /reloads the \.357 revolver: 6 \.357 Magnum FMJ from a pocket \(6\/6\)\./.test(lastLog(b)), `Reload from the pocket: 1 action, all 6 in ("${lastLog(b)}")`);
  check(loose(a, K357) === 0 && a.pockets[0] === null, "the 6 left the pocket: the emptied stack is thrown away");
  check(/^The \.357 revolver is full \(6\/6\)\./.test(reloadText(b, u)) && /full/.test(reloadRefusal(b, u)), `full now: "${reloadRefusal(b, u)}"`);
  v.ap = 1;
  const r1 = reloadRefusal(b, v);
  check(/^The rounds are in the pack: both actions to reload from the pack \(the Inventory window moves a box to a pocket for 1\)\./.test(r1) && combatAct(st, { type: "reload", unit: v.id }) === r1 && v.ap === 1 && v.mag === 0 && packOf(c)[0].dur === 6, `with one action left the pack is refused, nothing spent: "${r1}"`);
  check(/^Both actions: 6 rounds in \(\.357 Magnum FMJ\) from the pack \(both actions: the rounds are in the pack\)\./.test(reloadText(b, v)), `the Reload button: "${reloadText(b, v)}"`);
  v.ap = 2;
  check(combatAct(st, { type: "reload", unit: v.id }) === "" && v.ap === 0 && v.mag === 6 && /reloads the \.357 revolver: 6 \.357 Magnum FMJ from the pack \(6\/6, both actions\)\./.test(lastLog(b)) && loose(c, K357) === 0, `with both: 6 in, no action left, the pack's stack emptied ("${lastLog(b)}")`);
  // Nothing on them but a teammate's rounds: never a source; the refusal says where they are, and they are not touched.
  a.pockets[0] = roundItem(K357, 20, true); refitKit(b, u, a); refitKit(b, v, c);
  again(b, v);
  const rm = roundSplit(b, v);
  check(rm.mate === 0 && rm.hand === 0 && rm.pack === 0 && roundSource(b, v) === null, `a teammate's 20 only: roundSplit counts none of them (${JSON.stringify(rm)}), no source`);
  const r2 = reloadRefusal(b, v);
  check(NO_SOURCE.test(r2) && / 20 are on teammates, not to hand in a fight: a gun loads only what its shooter carries \(pockets, rig, pack\)\.$/.test(r2) && combatAct(st, { type: "reload", unit: v.id }) === r2 && v.ap === 2 && v.mag === 0 && a.pockets[0].dur === 20, `refused, the teammate's box untouched: "${r2}"`);
  b.pools[0][K357] = 30;
  again(b, v);
  const r3 = reloadRefusal(b, v);
  check(roundSource(b, v) === null && roundSplit(b, v).pool === 0 && NO_SOURCE.test(r3) && /The base's 30 are in its stock and 20 are on teammates, not to hand in a fight/.test(r3) && combatAct(st, { type: "reload", unit: v.id }) === r3 && v.ap === 2 && b.pools[0][K357] === 30, `the team's bags (the base's stock) are no source either: "${r3}"`);
}

// 2. A rig admin pouch of loose 9mm feeds a 1-action top-up by hand; the pack's costs 2; a teammate's and the team's bags are refused.
{
  console.log("A top-up: the rig against the pack and the team's");
  const st = createWorld({ seed: seed + 1, factionCount: 4 });
  const a = fighter(st, "pistol"), c = fighter(st, "pistol");
  a.gear.rig = newItem("chestrig");
  const admin = placeSlots(a, "rig")[0];
  admin.list[admin.i] = roundItem(K9, loosePouch, true);
  a.pockets[1] = newBox(K9, 50);
  withPack(a)[0] = newBox(K9, 50);
  const b = openBattle(st, [a, c]);
  const u = by(b, a), v = by(b, c);
  const spots = carriedSpots(a);
  check(boxesOf(a).length === 3 && boxesOf(a)[0] === a.pockets[1] && boxesOf(a)[1] === admin.list[admin.i] && boxesOf(a)[2] === packOf(a)[0], "ammo.js boxesOf: the pocket's box, then the rig pouch's loose rounds, then the pack's box");
  check(u.handBoxes === 2 && u.pocketBoxes === 1 && u.boxes.length === 3 && u.boxes[1] === admin.list[admin.i] && spots.some((x) => x.where === "rig" && x.item === admin.list[admin.i]), `u.boxes agrees with u.handBoxes (${u.handBoxes}: the pocket's and the rig's) and u.pocketBoxes (${u.pocketBoxes})`);
  check(u.magMode === "box" && u.mags.length === 1 && u.mag === 15 && isStacked(u), "a pistol with no spare magazine: the one in the gun, 15/15, physical");
  check(a.pockets[1].dur === 35 && admin.list[admin.i].dur === loosePouch && packOf(a)[0].dur === 50, `the 15 came out of the pocket's box first (${a.pockets[1].dur} left of 50), the rig's ${loosePouch} and the pack's 50 untouched`);
  const r0 = roundSplit(b, u);
  check(r0.hand === 35 + loosePouch && r0.pack === 50 && r0.mate === 0 && r0.pool === 0, `the rest: ${r0.hand} at hand, ${r0.pack} in the pack`);
  again(b, u, 3);
  const p0 = reloadPlan(b, u);
  check(p0.mode === "rounds" && p0.kind === "topup" && p0.from === "hand" && p0.cost === 1 && p0.n === MAGS.LOOSE && p0.runs[0].where === "pocket", `a top-up by hand from the rounds at hand: up to ${MAGS.LOOSE}, 1 action, the pocket's box first (${p0.mode}/${p0.kind} ${p0.n} from ${p0.from}, ${p0.cost})`);
  a.pockets[1] = null; refitKit(b, u, a); // the rig's alone at hand now
  check(u.handBoxes === 1 && u.pocketBoxes === 0 && sourceWord(u, "hand") === "the rig" && reloadPlan(b, u).runs[0].where === "rig", `the pocket's box gone: the rig's loose rounds are at hand (handBoxes ${u.handBoxes}, "${sourceWord(u, "hand")}")`);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 1 && u.mag === 9 && /tops up the 9mm pistol's magazine by hand: 6 9mm FMJ from the rig \(9\/15\)\./.test(lastLog(b)), `Reload: 6 topped up by hand from the rig for 1 action (3 → 9) ("${lastLog(b)}")`);
  check(admin.list[admin.i].dur === loosePouch - 6, `the 6 left the pouch (${admin.list[admin.i].dur} of ${loosePouch})`);
  check(/^1 action: 6 rounds by hand into the magazine in the gun \(9mm FMJ\) from the rig\./.test(reloadText(b, u)), `the Reload button: "${reloadText(b, u)}"`);
  admin.list[admin.i] = null; refitKit(b, u, a); // the pack's box alone
  again(b, u, 3);
  const p1 = reloadPlan(b, u);
  check(p1.kind === "topup" && p1.from === "pack" && p1.cost === 2 && p1.n === 6 && reloadCost(b, u) === 2, "the pack's box alone: a top-up of 6 takes both actions");
  u.ap = 1;
  check(/^The rounds are in the pack: both actions to reload from the pack/.test(reloadRefusal(b, u)) && combatAct(st, { type: "reload", unit: u.id }) !== "" && u.mag === 3 && packOf(a)[0].dur === 50, "refused with one action left, the box untouched");
  u.ap = 2;
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 0 && u.mag === 9 && /tops up the 9mm pistol's magazine by hand: 6 9mm FMJ from the pack \(9\/15, both actions\)\./.test(lastLog(b)) && packOf(a)[0].dur === 44, `with both: 6 topped up, 44 left in the pack ("${lastLog(b)}")`);
  // A teammate's box: never a source (the refusal says where the rounds are); the team's bags: the same.
  packOf(a)[0] = null; refitKit(b, u, a);
  c.pockets[0] = newBox(K9, 50); refitKit(b, v, c);
  again(b, u, 3);
  const r1 = reloadRefusal(b, u);
  check(roundSource(b, u) === null && roundSplit(b, u).mate === 0 && reloadPlan(b, u).why === r1, "a teammate's box only: no source, the plan refuses");
  check(/^No ammo to load: no loaded spare magazine, and no rounds for the 9mm pistol on them \(none in their pockets, rig or pack\)\. 50 are on teammates, not to hand in a fight/.test(r1) && combatAct(st, { type: "reload", unit: u.id }) === r1 && u.ap === 2 && u.mag === 3 && c.pockets[0].dur === 50, `refused, nothing spent, the teammate's 50 untouched: "${r1}"`);
  u.ap = 1;
  check(reloadRefusal(b, u) === r1, "with one action: the same refusal (not the cost's)");
  c.pockets[0] = null; refitKit(b, v, c);
  b.pools[0][K9] = 100;
  again(b, u, 3);
  const r2 = reloadRefusal(b, u);
  check(roundSource(b, u) === null && roundSplit(b, u).pool === 0 && /^No ammo to load: no loaded spare magazine, and no rounds for the 9mm pistol on them \(none in their pockets, rig or pack\)\. The base's 100 are in its stock, not to hand in a fight/.test(r2) && combatAct(st, { type: "reload", unit: u.id }) === r2 && u.ap === 2 && u.mag === 3 && b.pools[0][K9] === 100, `the team's bags only: refused, the stock untouched ("${r2}")`);
  check(reloadText(b, u).startsWith(r2), "the Reload button says the same");
}

// 3. A pump shotgun with shells only in the pack: 6 straight out of it for both actions; one action: refused; no Get shells; the box to a pocket, then 1.
{
  console.log("A pump: the pack for both actions, or the box to a pocket then 1");
  const st = createWorld({ seed: seed + 2, factionCount: 4 });
  const a = fighter(st, "shotgun");
  withPack(a)[0] = newBox(K12, 25);
  const b = openBattle(st, [a]);
  const u = by(b, a);
  const s0 = shellsAt(b, u);
  check(isStacked(u) && u.mag === 6 && packOf(a)[0].dur === 19 && s0.at === 0 && s0.box === 0 && s0.hand === 0 && s0.pack === 19 && !shellsInPack(b, u), `6 in the tube out of the pack's 25 (19 left in the box), none at hand: shellsAt ${JSON.stringify(s0)}; shellsInPack is false for your people`);
  again(b, u);
  const p = reloadPlan(b, u);
  check(p.mode === "rounds" && p.kind === "tube" && p.from === "pack" && p.cost === 2 && p.n === 6 && reloadRefusal(b, u) === "", `the plan: 6 shells into the tube straight out of the pack, both actions (${p.mode}/${p.kind} ${p.n} from ${p.from}, ${p.cost})`);
  check(/^Both actions: 6 shells thumbed into the tube \(12 gauge 00 buckshot\) from the pack \(both actions: the rounds are in the pack\)\. Up to 6 go in by hand a Reload/.test(reloadText(b, u)), `the Reload button: "${reloadText(b, u)}"`);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 0 && u.mag === 6 && /racks in 6 12 gauge 00 buckshot from the pack \(6\/6, both actions\)\./.test(lastLog(b)), `Reload: 6 shells in for both actions, no refusal ("${lastLog(b)}")`);
  check(packOf(a)[0].dur === 13, `the shells left the box as they went in (${packOf(a)[0].dur} left of 25: 6 at the start, 6 now)`);
  again(b, u);
  u.ap = 1;
  const r1 = reloadRefusal(b, u);
  check(/^The shells are in the pack: both actions to reload from the pack \(the Inventory window moves a box to a pocket for 1\)\./.test(r1) && combatAct(st, { type: "reload", unit: u.id }) === r1 && u.mag === 0 && u.ap === 1 && packOf(a)[0].dur === 13, `with one action left: refused, "${r1}"`);
  const g = combatAct(st, { type: "getshells", unit: u.id });
  check(/^Shells load straight from what they carry \(a pocket or the rig 1 action, the pack both\): nothing to get out first\./.test(g) && u.ap === 1 && shellsAt(b, u).hand === 0 && shellsAt(b, u).at === 0, `Get shells is refused for your people, no action spent: "${g}"`);
  // The Inventory window: the box to a pocket (1 action), then the Reload is 1.
  check(combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 0), to: L(a, "pocket", 0) }) === "" && u.ap === 0 && a.pockets[0] && a.pockets[0].dur === 13 && u.handBoxes === 1 && u.pocketBoxes === 1, `the box moved to a pocket for 1 action (${a.pockets[0] && a.pockets[0].dur} shells at hand now)`);
  const p2 = reloadPlan(b, u);
  check(p2.kind === "tube" && p2.from === "hand" && p2.cost === 1 && p2.n === 6 && shellsAt(b, u).at === 13 && shellsAt(b, u).pack === 0, `then the plan: 6 from the pocket for 1 action (${p2.n} from ${p2.from}, ${p2.cost})`);
  b.phase = "player"; u.ap = 2;
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 1 && u.mag === 6 && /racks in 6 12 gauge 00 buckshot from a pocket \(6\/6\)\./.test(lastLog(b)) && a.pockets[0].dur === 7, `a Reload from the pocket: 1 action, 6 in, 7 left ("${lastLog(b)}")`);
  check(/^The pump shotgun is full \(6\/6\)\./.test(reloadText(b, u)), `the Reload button (the tube full): "${reloadText(b, u)}"`);
  // A box in a pocket from the start: at hand, 1 action.
  const st2 = createWorld({ seed: seed + 3, factionCount: 4 });
  const c = fighter(st2, "shotgun");
  c.pockets[0] = newBox(K12, 25);
  const b2 = openBattle(st2, [c]);
  const v = by(b2, c);
  again(b2, v);
  check(reloadPlan(b2, v).cost === 1 && reloadPlan(b2, v).from === "hand" && combatAct(st2, { type: "reload", unit: v.id }) === "" && v.ap === 1 && v.mag === 6 && c.pockets[0].dur === 13, `a box in a pocket: 1 action, 6 in, 13 left of 25 (6 at the start)`);
}

// 4. Magazine swaps unchanged in cost (rig 1, pocket 1, pack 2) but physical; a speedloader only by { clip: i }, by where it is.
{
  console.log("Magazines and clips");
  const st = createWorld({ seed: seed + 4, factionCount: 4 });
  const a = fighter(st, "ar");
  a.gear.rig = newItem("chestrig");
  rigPouches(a)[0] = newItem("mag_stanag_30");
  a.pockets[0] = newItem("mag_stanag_20");
  withPack(a)[0] = newItem("mag_stanag_30");
  const b = openBattle(st, [a], 400);
  const u = by(b, a);
  const K556 = "a_556_fmj";
  check(u.mag === 30 && u.mags.filter((m) => m.where !== "gun").every((m) => m.item && stackN(m.item.stack) === m.cap) && b.pools[0][K556] === 400 - 140 && loose(a, K556) === 30, `the gun and the three spares filled out of the base's stock at the start, and a magazine's worth loose at hand (carrykit.js packShells: ${400 - b.pools[0][K556]} of 400, ${loose(a, K556)} loose)`);
  const costs = [];
  for (let i = 0; i < 3; i++) {
    again(b, u);
    const p = reloadPlan(b, u), where = p.from;
    costs.push(`${p.mode}@${p.from}:${p.cost}`);
    check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 2 - p.cost && u.mag === p.n && new RegExp(`reloads the assault rifle( \\(\\d+-round mag\\))? \\(${p.n}/${p.n}\\): a fresh magazine from ${where === "pack" ? "the pack" : where === "rig" ? "the rig" : "a pocket"}; the other goes there empty\\.`).test(lastLog(b)), `swap ${i + 1}: ${p.mode} from ${p.from}, ${p.cost} action${p.cost === 1 ? "" : "s"}, the emptied one goes there ("${lastLog(b)}")`);
    const slot = u.mags.find((m) => m.where === where);
    check(slot && slot.n === 0 && slot.item && stackN(slot.item.stack) === 0 && a.gear.weapon.mods.mag && a.gear.weapon.mods.mag !== slot.item, `the ${where}'s entry is the empty magazine now, the fresh one is the gun's fitted magazine`);
  }
  check(costs.join(" ") === "swap@rig:1 swap@pocket:1 swap@pack:2", `the rig's first, then the pocket's, then the pack's (${costs.join(" ")})`);
  // The magazine's worth at hand is theirs to load: topped up by hand out of the pocket until none is left on them.
  for (let i = 0; i < 12 && loose(a, K556) > 0; i++) { again(b, u); combatAct(st, { type: "reload", unit: u.id }); }
  check(loose(a, K556) === 0, `the 30 loose at hand loaded out of their pocket (${loose(a, K556)} left)`);
  again(b, u, 3);
  const p3 = reloadPlan(b, u);
  check(p3.mode === "rounds" && p3.kind === "topup" && p3.n === 0 && /^No ammo to load: no loaded spare magazine, and no rounds for the assault rifle on them \(none in their pockets, rig or pack\)\. The base's 260 are in its stock, not to hand in a fight/.test(p3.why) && reloadRefusal(b, u) === p3.why && b.pools[0][K556] === 260, `no loaded spare left and nothing on them: the stock's 260 are no source ("${p3.why}")`);
  // A speedloader: never the auto plan's; { clip: 0 } fills the cylinder out of their own rounds, 1 from a pocket, 2 from the pack, once a fight.
  const st2 = createWorld({ seed: seed + 5, factionCount: 4 });
  const c = fighter(st2, "revolver"), d = fighter(st2, "revolver");
  c.pockets[0] = newItem("speedloader");
  c.pockets[1] = roundItem(K357, 20, true);
  withPack(d)[0] = newItem("speedloader");
  packOf(d)[1] = roundItem(K357, 20, true);
  const b2 = openBattle(st2, [c, d]); // (no .357 in the stock: a defender would grab a pocketful of it at hand, carrykit.js looseWant)
  const v = by(b2, c), w = by(b2, d);
  check(v.clips.length === 1 && v.clips[0].where === "pocket" && !v.clips[0].used && w.clips.length === 1 && w.clips[0].where === "pack" && loose(c, K357) === 14 && loose(d, K357) === 14, "each has a speedloader (u.clips: a pocket / the pack) and 14 of their own 20 past the 6 loaded");
  again(b2, v); again(b2, w);
  check(reloadPlan(b2, v).mode === "rounds" && reloadPlan(b2, v).cost === 1 && reloadPlan(b2, w).mode === "rounds" && reloadPlan(b2, w).cost === 2, "the auto plan never takes the speedloader: rounds by hand (1 from the pocket, 2 from the pack)");
  const cv = reloadPlan(b2, v, { clip: 0 }), cw = reloadPlan(b2, w, { clip: 0 });
  check(cv.mode === "clip" && cv.from === "pocket" && cv.cost === 1 && cv.n === 6 && cv.runs[0].where === "pocket" && cw.mode === "clip" && cw.from === "pack" && cw.cost === 2 && cw.n === 6 && cw.runs[0].where === "pack", `{ clip: 0 }: a speedloader in a pocket 1 action, in the pack 2, filled with 6 of their own rounds (${cv.cost} / ${cw.cost})`);
  check(combatAct(st2, { type: "reload", unit: v.id, clip: 0 }) === "" && v.ap === 1 && v.mag === 6 && /reloads the \.357 revolver with a revolver speedloader: 6 \.357 Magnum FMJ \(6\/6\)\./.test(lastLog(b2)) && loose(c, K357) === 8 && v.clips[0].used, `the pocket's speedloader: 1 action, 6 in, 6 fewer in the pocket, used ("${lastLog(b2)}")`);
  again(b2, v);
  check(/was used already/.test(reloadPlan(b2, v, { clip: 0 }).why) && combatAct(st2, { type: "reload", unit: v.id, clip: 0 }) !== "" && v.mag === 0, `once a fight: "${reloadPlan(b2, v, { clip: 0 }).why}"`);
  w.ap = 1;
  check(/^The clip is in the pack: 2 actions\./.test(reloadRefusal(b2, w, { clip: 0 })) && combatAct(st2, { type: "reload", unit: w.id, clip: 0 }) !== "" && w.mag === 0 && loose(d, K357) === 14, "the pack's speedloader with one action left: refused, nothing spent");
  w.ap = 2;
  check(combatAct(st2, { type: "reload", unit: w.id, clip: 0 }) === "" && w.ap === 0 && w.mag === 6 && loose(d, K357) === 8, "with both: 6 in out of the pack's rounds");
}

// 5. The AI and the raid bot: a revolver from the pocket; a shotgun with shells only in the pack straight out of it (no Get shells).
{
  console.log("The AI and the raid bot");
  const st = createWorld({ seed: seed + 6, factionCount: 4 });
  const a = fighter(st, "revolver"), c = fighter(st, "shotgun");
  a.pockets[0] = roundItem(K357, 20, true);
  withPack(c)[0] = newBox(K12, 25);
  const b = openBattle(st, [a, c]);
  const u = by(b, a), v = by(b, c), e = foes(b)[0];
  place(u, 5, 5); place(v, 5, 7); place(e, 12, 6); e.aware = true;
  loadMag(u, 0); loadMag(v, 0); u.ap = 2; v.ap = 2;
  st.autoRetreat = false; // (the AI would sound the retreat against an unkillable foe: retreattest.js)
  autoPlayerTurn(st, { retreat: false });
  check(logHas(b, new RegExp(`${a.name} reloads the \\.357 revolver: 6 \\.357 Magnum FMJ from a pocket \\(6/6\\)\\.`)) && magIn(u) >= 5 && loose(a, K357) === 8, `your side's AI: the revolver reloads 6 from its own pocket (1 action; ${magIn(u)}/6 after its shot, ${loose(a, K357)} left of 20)`);
  check(logHas(b, new RegExp(`${c.name} racks in 6 12 gauge 00 buckshot from the pack \\(6/6, both actions\\)\\.`)) && !logHas(b, /takes \d+ shells of .* out of the pack/) && magIn(v) === 6 && packOf(c)[0].dur === 13, `the pump with shells only in the pack: 6 straight out of it for both actions, no Get shells (${magIn(v)}/6, ${packOf(c)[0].dur} left in the box)`);
  // With one action left and the shells in the pack the AI cannot reload (both actions): it waits, nothing spent.
  const st2 = createWorld({ seed: seed + 7, factionCount: 4 });
  const d = fighter(st2, "shotgun");
  withPack(d)[0] = newBox(K12, 25);
  const b2 = openBattle(st2, [d]);
  const w = by(b2, d), e2 = foes(b2)[0];
  place(w, 5, 5); place(e2, 12, 5); e2.aware = true;
  loadMag(w, 0); w.ap = 1;
  st2.autoRetreat = false;
  autoPlayerTurn(st2, { retreat: false });
  check(!logHas(b2, /racks in|takes \d+ shells/) && magIn(w) === 0 && packOf(d)[0].dur === 19 && !b2.over, `with one action: no Reload from the pack (both actions), no Get shells; the tube stays empty (${magIn(w)}/6), the box ${packOf(d)[0].dur}`);
  // The raid bot: a shotgunner loads from the pocket packed for the trip (carrykit.js packShells), never from the team's bags.
  const st3 = createWorld({ seed: seed + 8, factionCount: 4 });
  const h3 = hub(st3);
  const g = fighter(st3, "shotgun");
  const tile = st3.tiles.find((t) => t.loc && t.id !== h3.tile && st3.grid.distance(t.id, h3.tile) > 1);
  setRounds(h3.stock, 0); giveRounds(h3.stock, 100, ["shotgun"]);
  const res = launchExpedition(st3, { memberIds: [g.id], dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 1 } });
  if (res.error) check(false, `raid team launched (${res.error})`);
  else {
    const pt = res.party;
    check(loose(g, K12) === SHELLS.CARRY && pt.supplies[K12] === 40 - SHELLS.CARRY, `the trip's shells: ${SHELLS.CARRY} in a pocket, the other ${pt.supplies[K12]} in the team's bags`);
    pt.path = [tile.id]; pt.idx = 0; pt.phase = "engaged";
    const rb = inBrowser(() => (st3.combat = createBattle(st3, { mode: "raid", tile: tile.id, partyId: pt.id, canRetreat: true, ambush: null, handler: "reloadsourcetest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st3, tile.id) }, raid: { heat0: 5 }, context: {} })));
    if (rb.raid && rb.raid.choose) rb.raid.choose = null;
    const ru = rb.units.find((x) => x.side === "player");
    const bags0 = rb.pools.reduce((n, p) => n + (p[K12] || 0), 0);
    check(isStacked(ru) && ru.mag === 6 && loose(g, K12) === SHELLS.CARRY - 6 && bags0 === 40 - SHELLS.CARRY, `the tube filled out of the pocket at the start (${loose(g, K12)} left there), the bags' ${bags0} untouched`);
    // One action: the Reload and nothing after it (with more, the bot goes on to search and extract, and the battle's
    // end puts the gun's rounds back in the pocket).
    loadMag(ru, 0); ru.ap = 1;
    for (const x of rb.units) if (x.side !== "player") x.aware = false;
    st3.autoRetreat = false;
    autoPlayerTurn(st3);
    const rb2 = st3.combat && st3.combat.units ? st3.combat : rb;
    // The bot may search and extract in the same turn (the fight over, the gun's rounds stay in it or go to a pocket):
    // either way the 6 racked in are the pocket's (the test threw away the first 6).
    const inGun = () => { const l = g.gear.weapon && g.gear.weapon.loaded; return !l ? 0 : Array.isArray(l.stack) ? l.stack.reduce((a, x) => a + (x.n || 0), 0) : l.n || 0; };
    const shellsKept = () => (magIn(ru) === 6 && loose(g, K12) === SHELLS.CARRY - 12) || (magIn(ru) === 0 && loose(g, K12) + inGun() === SHELLS.CARRY - 6);
    check(logHas(rb2, new RegExp(`${g.name} racks in 6 12 gauge 00 buckshot from a pocket \\(6/6\\)\\.`)) && !logHas(rb2, /takes \d+ shells of .* out of the pack|out of the pack \(.*both actions\)/) && shellsKept() && rb2.pools.reduce((n, p) => n + (p[K12] || 0), 0) === bags0, `the raid bot: 6 from the pocket for 1 action (${loose(g, K12)} left there), no Get shells, the bags still ${bags0}`);
  }
}

// 6. The order of depletion: a Reload takes from the pocket first, then (only when nothing is at hand) the pack, never a teammate's or the pools; shots touch no box.
{
  console.log("Depletion: the pocket, then the pack; never a teammate's or the pools");
  const st = createWorld({ seed: seed + 9, factionCount: 4 });
  const a = fighter(st, "pistol"), c = fighter(st, "pistol");
  a.pockets[0] = newBox(K9, 20);
  withPack(a)[0] = newBox(K9, 5);
  c.pockets[0] = newBox(K9, 20);
  const b = openBattle(st, [a, c]);
  b.pools[0][K9] = 100;
  const u = by(b, a);
  check(u.mag === 15 && a.pockets[0].dur === 5 && packOf(a)[0].dur === 5 && c.pockets[0].dur === 5, "the start: each pistol's 15 out of its own pocket's box (5 left), the pack's 5 untouched");
  const total0 = sideRounds(b);
  loadMag(u, 0);
  const r = roundSplit(b, u);
  check(r.hand === 5 && r.pack === 5 && r.mate === 0 && r.pool === 0 && roundSource(b, u) === "hand", `roundSplit with the gun empty: ${JSON.stringify(r)} (the teammate's 5 and the pools' 100 are not counted), the source the hand`);
  u.ap = 2;
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 1 && u.mag === 5 && /tops up the 9mm pistol's magazine by hand: 5 9mm FMJ from a pocket \(5\/15\)\./.test(lastLog(b)) && loose(a, K9) === 5 && a.pockets[0] === null && packOf(a)[0].dur === 5, "a Reload: the pocket's last 5 (1 action), the pack's 5 untouched, the emptied box thrown away");
  check(roundSource(b, u) === "pack" && reloadPlan(b, u).cost === 2 && reloadPlan(b, u).n === 5, "the source is the pack now (both actions): the pack only when nothing is at hand");
  b.phase = "player"; u.ap = 2;
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 0 && u.mag === 10 && /tops up the 9mm pistol's magazine by hand: 5 9mm FMJ from the pack \(10\/15, both actions\)\./.test(lastLog(b)) && loose(a, K9) === 0, "then the pack's 5 for both actions (10/15), nothing left on them");
  b.phase = "player"; u.ap = 2;
  const r1 = reloadRefusal(b, u);
  check(roundSource(b, u) === null && /^No ammo to load: no loaded spare magazine, and no rounds for the 9mm pistol on them \(none in their pockets, rig or pack\)\. The base's 100 are in its stock and 5 are on teammates, not to hand in a fight/.test(r1) && combatAct(st, { type: "reload", unit: u.id }) === r1 && u.mag === 10 && c.pockets[0].dur === 5 && b.pools[0][K9] === 100, `nothing on them: no source, Reload refused; the teammate's 5 and the stock's 100 never drawn on ("${r1}")`);
  // Shots: off the top of the gun's stack; no box, no teammate's, no pool is touched.
  check(takeBattleRounds(b, u, 3) === 3 && u.mag === 7 && stackN(u.stack) === 7 && c.pockets[0].dur === 5 && b.pools[0][K9] === 100, "3 rounds shot: out of the gun's stack (7/15), the teammate's box and the stock untouched");
  check(takeBattleRounds(b, u, 20) === 7 && u.mag === 0 && takeBattleRounds(b, u, 1) === 0 && c.pockets[0].dur === 5 && b.pools[0][K9] === 100, "20 more asked for: only the 7 in the gun come out, then none (the shots never dig in a box)");
  check(sideRounds(b) === total0 - 15 - 10, `the side's rounds: ${total0} at the start, 15 thrown away by the test, 10 shot: ${sideRounds(b)} (counted once throughout)`);
}

// 7. The Reload order and the weapon panel (UI).
{
  console.log("UI: the Reload order and the weapon panel");
  const out = await inBrowser(async () => {
    const UI = await import("../src/ui/combat.js");
    const HUD = await import("../src/ui/battlehud.js");
    const st = createWorld({ seed: seed + 10, factionCount: 4 });
    const a = fighter(st, "revolver"), c = fighter(st, "revolver");
    a.pockets[0] = roundItem(K357, 12, true);
    withPack(c)[0] = roundItem(K357, 12, true);
    c.pockets[1] = roundItem(K357, 10, true);
    const b = openBattle(st, [a, c]);
    b.pools[0][K357] = 10;
    const u = by(b, a), v = by(b, c);
    const res = [];
    res.push([a.pockets[0].dur === 6 && c.pockets[1].dur === 4 && packOf(c)[0].dur === 12, "the start: 6 left in one's pocket; the other's cylinder came out of the pocket (4 left), the pack's 12 untouched"]);
    again(b, u); again(b, v);
    const order = (x) => UI.unitOrders(st, b, x).list.find((o) => o.v === "reload");
    const oa = order(u), oc = order(v);
    res.push([oa && oa.ok && oa.ap === 1 && /^\.357 revolver \(0\/6 now\)\. 1 action: 6 rounds in \(\.357 Magnum FMJ\) from a pocket\./.test(oa.tip), `the pocket's Reload order: 1 action, the tip says 6 from a pocket (${oa && oa.ap}, "${oa && oa.tip.slice(0, 70)}")`]);
    res.push([oc && oc.ok && oc.ap === 1 && /1 action: 4 rounds in \(\.357 Magnum FMJ\) from a pocket\./.test(oc.tip), `the other has 4 loose in a pocket too: 1 action, those 4 first (${oc && oc.ap}, "${oc && oc.tip.slice(0, 70)}")`]);
    c.pockets[1] = null; refitKit(b, v, c);
    const oc2 = order(v);
    res.push([oc2 && oc2.ok && oc2.ap === 2 && /Both actions: 6 rounds in \(\.357 Magnum FMJ\) from the pack \(both actions: the rounds are in the pack\)/.test(oc2.tip), `the pack's Reload order: 2 actions, the tip says the pack and both actions (${oc2 && oc2.ap})`]);
    v.ap = 1;
    const oc3 = order(v);
    res.push([oc3 && oc3.ok && oc3.ap === 2 && oc3.why === "" && /both actions to reload from the pack \(the Inventory window moves a box to a pocket for 1\)\.$/.test(oc3.tip), `with one action: the order still opens the picker (the pack's load greyed there), its tip ends with the refusal (ok ${oc3 && oc3.ok}, "${oc3 && oc3.tip.slice(-90)}")`]);
    v.ap = 2; loadMag(v, 0);
    const info = HUD.weaponInfo(st, b, v);
    res.push([info.rounds && info.rounds.hand === 0 && info.rounds.pack === 12 && info.rounds.mate === 0 && info.rounds.pool === 0, `weaponInfo.rounds: ${JSON.stringify(info.rounds)} (the teammate's 6 and the pools' 10 not counted)`]);
    const strip = (h) => String(h).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const txt = strip(HUD.weaponPanelHtml(st, b, v));
    res.push([/0 rds at hand/.test(txt) && /12 in the pack/.test(txt) && !/the team's/.test(txt), `the panel: at hand, in the pack, never the team's ("${(txt.match(/\d+ rds at hand.*?in the pack/) || [""])[0]}")`]);
    const ta = strip(HUD.weaponPanelHtml(st, b, u));
    res.push([/6 rds at hand/.test(ta) && !/in the pack/.test(ta) && !/the team's/.test(ta), `the pocket's: "${(ta.match(/\d+ rds at hand/) || [""])[0]}", no pack, no team's`]);
    return res;
  }).catch((err) => [[false, `UI checks ran (${err.stack || err.message})`]]);
  for (const [o, m] of out) check(o, m);
}

// 8. A save and load in the middle keeps the costs.
{
  console.log("Saves");
  const st = createWorld({ seed: seed + 11, factionCount: 4 });
  const a = fighter(st, "revolver"), c = fighter(st, "revolver"), d = fighter(st, "shotgun");
  a.pockets[0] = roundItem(K357, 12, true);
  withPack(c)[0] = roundItem(K357, 12, true);
  withPack(d)[0] = newBox(K12, 25);
  const b = openBattle(st, [a, c, d]);
  for (const s of [a, c, d]) again(b, by(b, s));
  const st2 = loadFromString(saveToString(st));
  const b2 = st2.combat;
  const u2 = b2.units.find((x) => x.sid === a.id), v2 = b2.units.find((x) => x.sid === c.id), w2 = b2.units.find((x) => x.sid === d.id);
  const a2 = st2.survivors.find((x) => x.id === a.id), c2 = st2.survivors.find((x) => x.id === c.id), d2 = st2.survivors.find((x) => x.id === d.id);
  check(u2.handBoxes === 1 && u2.pocketBoxes === 1 && v2.handBoxes === 0 && tracksMags(u2) && isStacked(u2) && isStacked(v2) && isStacked(w2) && u2.mag === 0, "the loaded battle keeps handBoxes and pocketBoxes, the units stacked (physical), the guns empty");
  check(reloadCost(b2, u2) === 1 && reloadCost(b2, v2) === 2 && reloadPlan(b2, w2).from === "pack" && reloadPlan(b2, w2).cost === 2, "and the costs: the pocket 1, the pack 2, the pump's shells in the pack 2");
  b2.phase = "player";
  check(combatAct(st2, { type: "reload", unit: u2.id }) === "" && u2.ap === 1 && u2.mag === 6 && loose(a2, K357) === 0 && /from a pocket \(6\/6\)\./.test(lastLog(b2)), "a Reload from the pocket on the loaded battle: 1 action, 6 in, the pocket's 6 gone");
  check(combatAct(st2, { type: "reload", unit: v2.id }) === "" && v2.ap === 0 && v2.mag === 6 && loose(c2, K357) === 0 && /from the pack \(6\/6, both actions\)\./.test(lastLog(b2)), "and from the pack: both, 6 in");
  check(combatAct(st2, { type: "reload", unit: w2.id }) === "" && w2.ap === 0 && w2.mag === 6 && packOf(d2)[0].dur === 13 && /racks in 6 .* from the pack \(6\/6, both actions\)\./.test(lastLog(b2)), "the pump straight out of the pack: both, 6 in, 13 left in the box");
}

console.log(`\n${passes} passed, ${fails} failed`);
console.log(fails ? "failed" : "passed");
process.exit(fails ? 1 : 0);
