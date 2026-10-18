// Reload sources (2026-10-17 user request: "reload guns including shotguns from loose ammo/shells from pockets, rigs in
// addition to pack, only reload from pack uses double action"; src/sim/mags.js roundSplit / roundSource / sourceWord /
// reloadPlan, src/sim/ammo.js boxesOf / takeBattleRounds, src/sim/combat.js reloadRefusal / aiReload). Checks:
//   - a revolver with loose rounds in a pocket reloads for 1 action; with the rounds only in the pack it costs both
//     actions and is refused with one left; the log and the Reload button name the source;
//   - a rig admin pouch of loose 9mm feeds a 1-action top-up (the rig's rounds in u.boxes right after the pockets',
//     u.handBoxes and u.pocketBoxes agree); the pack's top up for 2, a teammate's and the team's bags for 2 (an internal
//     magazine's Reload from them too: only what is at hand is quick);
//   - a pump shotgun with shells only in the pack reloads straight out of it for both actions (no refusal), is refused
//     with one action left, and after Get shells reloads for 1;
//   - magazine swaps unchanged (rig 1, pocket 1, pack 2), a speedloader by where it is;
//   - the AI and the raid bot: a revolver from the pocket, a shotgun takes a handful out of the pack before loading;
//   - the order of depletion: at hand, then the pack, then a teammate's, then the pools;
//   - the Reload order's cost and tip and the weapon panel's split (at hand / in the pack / the team's);
//   - a save and load in the middle keeps the costs.
// Usage: node tools/reloadsourcetest.js [seed]
import { setRounds, giveRounds, newBox, boxesOf, takeBattleRounds, roundsOf } from "../src/sim/ammo.js";
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, autoPlayerTurn, loadMag, reloadRefusal, reloadCost, magIn, refitKit } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { newItem, packOf, rigPouches, carriedSpots } from "../src/sim/inventory.js";
import { roundItem } from "../src/sim/itemstack.js";
import { itemLoad } from "../src/sim/inventory.js";
import { ADMIN_KG } from "../src/sim/data-kit.js";
import { placeSlots } from "../src/sim/supitems.js";
import { MAGS, SHELLS, reloadPlan, reloadText, roundSplit, roundSource, sourceWord, shellsAt, shellsInPack, tracksMags } from "../src/sim/mags.js";
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
const again = (b, u, n = 0) => { b.phase = "player"; loadMag(u, n); u.ap = 2; };
const withPack = (s) => { s.gear.backpack = newItem("backpack"); return packOf(s); };
const loosePouch = Math.floor((ADMIN_KG + 1e-9) / itemLoad(roundItem(K9, 1, true))); // loose 9mm an admin pouch takes

// 1. A revolver: loose rounds in a pocket (1 action) against the same rounds only in the pack (both actions).
{
  console.log("A revolver: a pocket against the pack");
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "revolver"), c = fighter(st, "revolver");
  a.pockets[0] = roundItem(K357, 12, true);
  withPack(c)[0] = roundItem(K357, 12, true);
  const b = openBattle(st, [a, c]);
  const u = by(b, a), v = by(b, c);
  check(u.magMode === "internal" && u.mag === 6 && v.mag === 6, "both revolvers take the field loaded (6/6) out of their own 12 rounds");
  check(u.handBoxes === 1 && u.pocketBoxes === 1 && u.boxes[0] === a.pockets[0] && v.handBoxes === 0 && v.pocketBoxes === 0 && v.boxes[0] === packOf(c)[0], "the pocket's rounds are at hand (handBoxes 1, pocketBoxes 1), the pack's are not (0)");
  const ra = roundSplit(b, u), rc = roundSplit(b, v);
  check(ra.hand === 6 && ra.pack === 0 && ra.mate === 12 && ra.pool === 0 && rc.hand === 0 && rc.pack === 6 && rc.mate === 12, `past the 6 loaded: 6 at hand for one, 6 in the pack for the other, the other's 12 as a teammate's (their loaded rounds are a counter, as ammo.js roundsOf has it) (${JSON.stringify(ra)} / ${JSON.stringify(rc)})`);
  check(roundSource(b, u) === "hand" && roundSource(b, v) === "pack", "roundSource: hand / pack");
  again(b, u); again(b, v);
  const pa = reloadPlan(b, u), pc = reloadPlan(b, v);
  check(pa.mode === "internal" && pa.from === "hand" && pa.cost === 1 && reloadCost(b, u) === 1, `the pocket: an internal Reload for 1 action (${pa.mode} from ${pa.from}, ${pa.cost})`);
  check(pc.mode === "internal" && pc.from === "pack" && pc.cost === 2 && reloadCost(b, v) === 2, `the pack: the same for both actions (${pc.mode} from ${pc.from}, ${pc.cost})`);
  check(sourceWord(u, "hand") === "a pocket" && sourceWord(v, "pack") === "the pack", `in words: "${sourceWord(u, "hand")}" / "${sourceWord(v, "pack")}"`);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 1 && u.mag === 2 && /reloads the \.357 revolver \(2\/6 from a pocket\)/.test(lastLog(b)), `Reload from the pocket: 1 action, 2 rounds in (a cylinder, two a Reload) ("${lastLog(b)}")`);
  check(/^1 action: 2 more rounds in from a pocket/.test(reloadText(b, u)), `the Reload button: "${reloadText(b, u)}"`);
  v.ap = 1;
  const r1 = reloadRefusal(b, v);
  check(/^The rounds are in the pack: both actions to reload from the pack\./.test(r1) && combatAct(st, { type: "reload", unit: v.id }) === r1 && v.ap === 1 && v.mag === 0, `with one action left the pack is refused: "${r1}"`);
  check(/^Both actions: 2 more rounds in from the pack \(both actions: the rounds are in the pack\)/.test(reloadText(b, v)), `the Reload button: "${reloadText(b, v)}"`);
  v.ap = 2;
  check(combatAct(st, { type: "reload", unit: v.id }) === "" && v.ap === 0 && v.mag === 2 && /reloads the \.357 revolver \(2\/6 out of the pack, both actions\)/.test(lastLog(b)), `with both: 2 rounds in, no action left ("${lastLog(b)}")`);
  // No rounds anywhere but a teammate's: both actions, like the pack (the team's bags the same).
  packOf(c)[0] = null; refitKit(b, v, c);
  again(b, v);
  check(roundSource(b, v) === "mate" && reloadPlan(b, v).cost === 2 && combatAct(st, { type: "reload", unit: v.id }) === "" && v.ap === 0 && v.mag === 2, "a teammate's rounds only: an internal Reload takes both actions, like the pack");
  a.pockets[0] = null; refitKit(b, u, a);
  b.pools[0][K357] = 30;
  again(b, v);
  check(roundSource(b, v) === "pool" && sourceWord(v, "pool") === "the team's ammo" && reloadPlan(b, v).cost === 2 && v.ap === 2 && combatAct(st, { type: "reload", unit: v.id }) === "" && v.ap === 0, "the team's bags only: both actions too");
}

// 2. A rig admin pouch of loose 9mm feeds a 1-action top-up; the pack's, a teammate's and the team's bags cost 2.
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
  check(u.magMode === "box" && u.mags.length === 1 && u.mag === 15, "a pistol with no spare magazine: the one in the gun, 15/15");
  const r0 = roundSplit(b, u);
  check(r0.hand === 50 + loosePouch - 15 && r0.pack === 50 && r0.mate === 0 && r0.pool === 0, `past the 15 loaded (claimed off the hand first): ${r0.hand} at hand, ${r0.pack} in the pack`);
  again(b, u, 3);
  const p0 = reloadPlan(b, u);
  check(p0.mode === "topup" && p0.from === "hand" && p0.cost === 1, `a top-up from the rounds at hand: 1 action (${p0.mode} from ${p0.from}, ${p0.cost})`);
  a.pockets[1] = null; refitKit(b, u, a); // the rig's alone at hand now
  check(u.handBoxes === 1 && u.pocketBoxes === 0 && sourceWord(u, "hand") === "the rig", `the pocket's box gone: the rig's loose rounds are at hand (handBoxes ${u.handBoxes}, "${sourceWord(u, "hand")}")`);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 1 && u.mag === 15 && /no spare magazine left, a top-up from the rig \(1 action\)/.test(lastLog(b)), `Reload: topped up from the rig for 1 action ("${lastLog(b)}")`);
  check(/^1 action: no loaded spare magazine, so the one in the gun is topped up from the rig\./.test(reloadText(b, u)), `the Reload button: "${reloadText(b, u)}"`);
  admin.list[admin.i] = null; refitKit(b, u, a); // the pack's box alone
  again(b, u, 3);
  const p1 = reloadPlan(b, u);
  check(p1.from === "pack" && p1.cost === 2 && reloadCost(b, u) === 2, "the pack's box alone: a top-up takes both actions");
  u.ap = 1;
  check(/both actions to reload from the pack/.test(reloadRefusal(b, u)) && combatAct(st, { type: "reload", unit: u.id }) !== "" && u.mag === 3, "refused with one action left");
  u.ap = 2;
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 0 && u.mag === 15 && /a top-up from the pack \(2 actions\)/.test(lastLog(b)), `with both: topped up ("${lastLog(b)}")`);
  // A teammate's box: 2 actions (as before); the team's bags: 2 (as before).
  packOf(a)[0] = null; refitKit(b, u, a);
  c.pockets[0] = newBox(K9, 50); refitKit(b, v, c);
  again(b, u, 3);
  check(roundSource(b, u) === "mate" && reloadPlan(b, u).cost === MAGS.TOPUP_AP && reloadPlan(b, u).cost === 2, "a teammate's box only: a top-up takes 2 actions (as before)");
  u.ap = 1;
  check(/top-up takes 2 actions \(from a teammate's rounds\)/.test(reloadRefusal(b, u)), `with one: "${reloadRefusal(b, u)}"`);
  c.pockets[0] = null; refitKit(b, v, c);
  b.pools[0][K9] = 100;
  again(b, u, 3);
  check(roundSource(b, u) === "pool" && reloadPlan(b, u).cost === 2 && combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 0 && /a top-up from the team's ammo \(2 actions\)/.test(lastLog(b)), `the team's bags only: 2 actions (as before) ("${lastLog(b)}")`);
}

// 3. A pump shotgun with shells only in the pack: both actions straight out of it; one action: refused; Get shells, then 1.
{
  console.log("A pump: the pack for both actions, or Get shells then 1");
  const st = createWorld({ seed: seed + 2, factionCount: 4 });
  const a = fighter(st, "shotgun");
  withPack(a)[0] = newBox(K12, 25);
  const b = openBattle(st, [a]);
  const u = by(b, a);
  const s0 = shellsAt(b, u);
  check(u.mag === 6 && s0.at === 0 && s0.pack === 19 && shellsInPack(b, u), `6 in the tube out of the pack's 25, none at hand, 19 in the pack: a Reload would dig in the pack (${s0.at} / ${s0.pack})`);
  again(b, u);
  const p = reloadPlan(b, u);
  check(p.mode === "tube" && p.from === "pack" && p.cost === 2 && reloadRefusal(b, u) === "", `the plan: a tube loaded straight out of the pack, both actions (${p.mode} from ${p.from}, ${p.cost})`);
  check(/^Both actions: [34](–4)? shells thumbed into the tube \(steady hands \+1\), dug out of the pack \(none at hand\)\. 0 shells at hand, 25 in the pack\. Get shells \(1 action\) brings 8 to hand instead/.test(reloadText(b, u)), `the Reload button: "${reloadText(b, u)}"`);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 0 && u.mag >= 3 && u.mag <= 4 && /racks in [34] shells out of the pack \([34]\/6, 0 left at hand, both actions\)/.test(lastLog(b)), `Reload: ${u.mag} shells in for both actions, no refusal ("${lastLog(b)}")`);
  check(packOf(a)[0].dur === 25 && roundsOf(b, u) === 25, "the box is the same: the shells leave it only when fired (virtual rounds)");
  again(b, u);
  u.ap = 1;
  const r1 = reloadRefusal(b, u);
  check(/^The shells are in the pack: both actions to reload from the pack \(or Get shells, 1 action/.test(r1) && combatAct(st, { type: "reload", unit: u.id }) === r1 && u.mag === 0 && u.ap === 1, `with one action left: refused, "${r1}"`);
  check(combatAct(st, { type: "getshells", unit: u.id }) === "" && u.ap === 0 && shellsAt(b, u).hand === SHELLS.GRAB && !shellsInPack(b, u), `Get shells (1 action): ${SHELLS.GRAB} loose at hand`);
  b.phase = "player"; u.ap = 2;
  const p2 = reloadPlan(b, u);
  check(p2.mode === "internal" && p2.from === "hand" && p2.cost === 1 && combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 1 && u.mag >= 3 && /racks in [34] shells \([34]\/6, [45] left at hand\)/.test(lastLog(b)), `then a Reload from the shells at hand: 1 action, ${u.mag} in ("${lastLog(b)}")`);
  check(/^1 action: \d(–\d)? shells thumbed into the tube/.test(reloadText(b, u)) && /from the shells at hand/.test(reloadText(b, u)) && /the pack's take both actions/.test(reloadText(b, u)), `the Reload button (the tube's room caps it): "${reloadText(b, u)}"`);
  // A box in a pocket: at hand, 1 action, as before.
  const st2 = createWorld({ seed: seed + 3, factionCount: 4 });
  const c = fighter(st2, "shotgun");
  c.pockets[0] = newBox(K12, 25);
  const b2 = openBattle(st2, [c]);
  const v = by(b2, c);
  again(b2, v);
  check(reloadPlan(b2, v).cost === 1 && reloadPlan(b2, v).from === "hand" && combatAct(st2, { type: "reload", unit: v.id }) === "" && v.ap === 1 && v.mag >= 3, `a box in a pocket: 1 action, ${v.mag} in (as before)`);
}

// 4. Magazine swaps unchanged: rig 1, pocket 1, pack 2; a speedloader by where it is.
{
  console.log("Magazines and clips: unchanged");
  const st = createWorld({ seed: seed + 4, factionCount: 4 });
  const a = fighter(st, "ar");
  a.gear.rig = newItem("chestrig");
  rigPouches(a)[0] = newItem("mag_stanag_30");
  a.pockets[0] = newItem("mag_stanag_20");
  withPack(a)[0] = newItem("mag_stanag_30");
  const b = openBattle(st, [a], 400);
  const u = by(b, a);
  const costs = [];
  for (let i = 0; i < 3; i++) { again(b, u); const p = reloadPlan(b, u); costs.push(`${p.mode}@${p.from}:${p.cost}`); check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 2 - p.cost, `swap ${i + 1}: ${p.mode} from ${p.from}, ${p.cost} action${p.cost === 1 ? "" : "s"}`); }
  check(costs.join(" ") === "swap@rig:1 swap@pocket:1 swap@pack:2", `the rig's first, then the pocket's, then the pack's (${costs.join(" ")})`);
  again(b, u, 3);
  check(reloadPlan(b, u).mode === "topup" && reloadPlan(b, u).from === "pool" && reloadPlan(b, u).cost === 2, "no loaded spare left, the rounds in the team's bags: a top-up for 2 (as before)");
  const st2 = createWorld({ seed: seed + 5, factionCount: 4 });
  const c = fighter(st2, "revolver"), d = fighter(st2, "revolver");
  c.pockets[0] = newItem("speedloader");
  withPack(d)[0] = newItem("speedloader");
  const b2 = openBattle(st2, [c, d], 100);
  const v = by(b2, c), w = by(b2, d);
  again(b2, v); again(b2, w);
  check(reloadPlan(b2, v).mode === "clip" && reloadPlan(b2, v).cost === 1 && reloadPlan(b2, w).mode === "clip" && reloadPlan(b2, w).cost === 2, "a speedloader in a pocket 1, in the pack 2 (as before)");
}

// 5. The AI and the raid bot.
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
  autoPlayerTurn(st, { retreat: false });
  check(logHas(b, new RegExp(`${a.name} reloads the \\.357 revolver \\(\\d/6 from a pocket\\)`)) && magIn(u) >= 1, `your side's AI: the revolver reloads from the pocket (1 action; ${magIn(u)}/6)`);
  check(logHas(b, new RegExp(`${c.name} takes ${SHELLS.GRAB} shells of 12 gauge .* out of the pack`)) && logHas(b, new RegExp(`${c.name} racks in [34] shells \\(`)) && !logHas(b, /out of the pack \(.*both actions\)/), `the pump: a handful out of the pack (1 action), then a Reload from it (1), not both actions on the pack (${magIn(v)}/6)`);
  // With one action left the pump still gets its handful out (the Reload waits for the next turn).
  const st2 = createWorld({ seed: seed + 7, factionCount: 4 });
  const d = fighter(st2, "shotgun");
  withPack(d)[0] = newBox(K12, 25);
  const b2 = openBattle(st2, [d]);
  const w = by(b2, d), e2 = foes(b2)[0];
  place(w, 5, 5); place(e2, 12, 5); e2.aware = true;
  loadMag(w, 0); w.ap = 1;
  autoPlayerTurn(st2, { retreat: false });
  check(logHas(b2, new RegExp(`${d.name} takes ${SHELLS.GRAB} shells of .* out of the pack`)) && !logHas(b2, /out of the pack \(.*both actions\)/), `with one action: Get shells first (${shellsAt(b2, w).hand} at hand, ${magIn(w)}/6), never both actions on the pack`);
  // The raid bot: a shotgunner whose shells are all in the team's bags takes a handful out first.
  const st3 = createWorld({ seed: seed + 8, factionCount: 4 });
  const h3 = hub(st3);
  const g = fighter(st3, "shotgun");
  const tile = st3.tiles.find((t) => t.loc && t.id !== h3.tile && st3.grid.distance(t.id, h3.tile) > 1);
  setRounds(h3.stock, 0); giveRounds(h3.stock, 100, ["shotgun"]);
  const res = launchExpedition(st3, { memberIds: [g.id], dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 1 } });
  if (res.error) check(false, `raid team launched (${res.error})`);
  else {
    const pt = res.party;
    for (const it of g.pockets) if (it && /^a_12ga_/.test(it.key)) it.dur = 0; // (carrykit.js packShells: the trip's shells at hand, spent for this check)
    pt.path = [tile.id]; pt.idx = 0; pt.phase = "engaged";
    const rb = inBrowser(() => (st3.combat = createBattle(st3, { mode: "raid", tile: tile.id, partyId: pt.id, canRetreat: true, ambush: null, handler: "reloadsourcetest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st3, tile.id) }, raid: { heat0: 5 }, context: {} })));
    if (rb.raid && rb.raid.choose) rb.raid.choose = null;
    const ru = rb.units.find((x) => x.side === "player");
    ru.hand = { buck: 0 }; loadMag(ru, 0);
    for (const x of rb.units) if (x.side !== "player") x.aware = false;
    const inPack = shellsInPack(rb, ru);
    autoPlayerTurn(st3);
    const rb2 = st3.combat && st3.combat.units ? st3.combat : rb;
    check(inPack && (logHas(rb2, new RegExp(`${g.name} takes \\d+ shells of .* out of the pack`)) || logHas(rb2, new RegExp(`${g.name} racks in`))) && !logHas(rb2, /out of the pack \(.*both actions\)/), "the raid bot with shells only in the bags: a handful out first, never both actions on the pack");
  }
}

// 6. The order of depletion: at hand, the pack, a teammate's, the pools.
{
  console.log("Depletion: hand, pack, mates, pools");
  const st = createWorld({ seed: seed + 9, factionCount: 4 });
  const a = fighter(st, "pistol"), c = fighter(st, "pistol");
  a.pockets[0] = newBox(K9, 5);
  withPack(a)[0] = newBox(K9, 5);
  c.pockets[0] = newBox(K9, 5);
  const b = openBattle(st, [a, c]);
  b.pools[0][K9] = 100;
  const u = by(b, a);
  loadMag(u, 0);
  const r = roundSplit(b, u);
  check(r.hand === 5 && r.pack === 5 && r.mate === 5 && r.pool === 100 && roundSource(b, u) === "hand", `roundSplit with the gun empty: ${JSON.stringify(r)}, the source the hand`);
  check(takeBattleRounds(b, u, 3) === 3 && a.pockets[0].dur === 2 && packOf(a)[0].dur === 5, "3 rounds: out of the pocket's box first");
  check(takeBattleRounds(b, u, 4) === 4 && a.pockets[0].dur === 0 && packOf(a)[0].dur === 3 && roundSource(b, u) === "pack", "4 more: the pocket's last 2, then 2 out of the pack; the source is the pack now");
  check(takeBattleRounds(b, u, 5) === 5 && packOf(a)[0].dur === 0 && c.pockets[0].dur === 3 && roundSource(b, u) === "mate", "5 more: the pack's 3, then 2 of the teammate's; the source a teammate's");
  check(takeBattleRounds(b, u, 5) === 5 && c.pockets[0].dur === 0 && b.pools[0][K9] === 98 && roundSource(b, u) === "pool", "5 more: the teammate's 3, then the team's bags; the source the pools");
  b.pools[0][K9] = 0;
  check(roundSource(b, u) === null && /no ammo/i.test(reloadRefusal(b, u)), "nothing left: no source, Reload refused");
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
    c.pockets[1] = roundItem(K357, 4, true);
    const b = openBattle(st, [a, c]);
    b.pools[0][K357] = 10;
    const u = by(b, a), v = by(b, c);
    again(b, u); again(b, v);
    const res = [];
    const order = (x) => UI.unitOrders(st, b, x).list.find((o) => o.v === "reload");
    const oa = order(u), oc = order(v);
    res.push([oa && oa.ok && oa.ap === 1 && /from a pocket/.test(oa.tip), `the pocket's Reload order: 1 action, the tip says from a pocket (${oa && oa.ap}, "${oa && oa.tip.slice(0, 70)}")`]);
    res.push([oc && oc.ok && oc.ap === 1, "the other has 4 loose in a pocket too: 1 action from them first"]);
    c.pockets[1] = null; refitKit(b, v, c);
    const oc2 = order(v);
    res.push([oc2 && oc2.ok && oc2.ap === 2 && /from the pack/.test(oc2.tip) && /both actions/.test(oc2.tip), `the pack's Reload order: 2 actions, the tip says the pack and both actions (${oc2 && oc2.ap})`]);
    v.ap = 1;
    const oc3 = order(v);
    res.push([oc3 && !oc3.ok && /both actions to reload from the pack/.test(oc3.why || ""), `with one action: greyed, "${oc3 && oc3.why}"`]);
    v.ap = 2; loadMag(v, 0);
    const info = HUD.weaponInfo(st, b, v);
    res.push([info.rounds && info.rounds.hand === 0 && info.rounds.pack === 12 && info.rounds.mate === 12 && info.rounds.pool === 10, `weaponInfo.rounds: ${JSON.stringify(info.rounds)}`]);
    const strip = (h) => String(h).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const txt = strip(HUD.weaponPanelHtml(st, b, v));
    res.push([/0 rds at hand/.test(txt) && /12 in the pack/.test(txt) && /22 the team's/.test(txt), `the panel: at hand, in the pack, the team's ("${(txt.match(/\d+ rds at hand.*?team's/) || [""])[0]}")`]);
    const ta = strip(HUD.weaponPanelHtml(st, b, u));
    res.push([/12 rds at hand/.test(ta) && !/in the pack/.test(ta) && /22 the team's/.test(ta), `the pocket's: "${(ta.match(/\d+ rds at hand.*?team's/) || [""])[0]}"`]);
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
  check(u2.handBoxes === 1 && u2.pocketBoxes === 1 && v2.handBoxes === 0 && tracksMags(u2), "the loaded battle keeps handBoxes and pocketBoxes");
  check(reloadCost(b2, u2) === 1 && reloadCost(b2, v2) === 2 && reloadPlan(b2, w2).from === "pack" && reloadPlan(b2, w2).cost === 2, "and the costs: the pocket 1, the pack 2, the pump's shells in the pack 2");
  b2.phase = "player";
  check(combatAct(st2, { type: "reload", unit: u2.id }) === "" && u2.ap === 1 && u2.mag === 2, "a Reload from the pocket on the loaded battle: 1 action");
  check(combatAct(st2, { type: "reload", unit: v2.id }) === "" && v2.ap === 0 && v2.mag === 2, "and from the pack: both");
  check(combatAct(st2, { type: "reload", unit: w2.id }) === "" && w2.ap === 0 && w2.mag >= 3, "the pump straight out of the pack: both");
}

console.log(`\n${passes} passed, ${fails} failed`);
console.log(fails ? "failed" : "passed");
process.exit(fails ? 1 : 0);
