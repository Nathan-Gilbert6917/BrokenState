// Rigs, plate carriers with inserts, and the weight of kit in a fight (docs/weapons-overhaul-plan.md sections 16, 17's
// inserts and the weight half of 18; src/sim/inventory.js rig slot and pouches, data-kit.js, carrykit.js, armour.js).
// Checks: pouches by kind, moveItem in and out of pouches and plate pockets with their fit reasons, a chest rig not
// over a pouched vest, allCarried and the searches that use it, weights (a carrier with its plates, the rounds in
// magazines) and the battle bands (mob and dash, enemies too), the escape penalty by kg, packing magazines for a trip,
// the per-hit armour on the carrier's front / back plate and its backer, broken plates gone after a fight, the plate swap
// in a fight, enemies' rigs and carriers (and what drops), the autopilot's kit and spare plates, starting carriers'
// steel plates, a save's round trip, and old saves' migration.
// Usage: node tools/rigtest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import {
  newItem, lootItem, moveItem, itemAt, fitReason, ensureInv, allCarried, carriedSpots, rigOf, rigPouches, itemLoad, insertsOf, isCarrier,
  migrateCarrier, START_DUR, startKit, stow, quickMove, enemyBody,
} from "../src/sim/inventory.js";
import { createBattle, registerCombatHandler, combatAct, damage, enemyUnit, escapeOdds, RETREAT, loadPenalty, dashRange, KITS } from "../src/sim/combat.js";
import { battleKg, bandFor, CARRY, equipKit, governPlates, migrateKit, packMags, starterMags, kitWorthy } from "../src/sim/carrykit.js";
import { findCarried } from "../src/sim/stealth.js";
import { carriedItems } from "../src/sim/hunting.js";
import { armourHit, curDur, armourBroken, dropBroken } from "../src/sim/armour.js";
import { launchExpedition } from "../src/sim/parties.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { setRounds } from "../src/sim/ammo.js";
import { Rng } from "../src/sim/rng.js";
import { itemValue } from "../src/sim/valuation.js";
import { repairKind } from "../src/sim/repair.js";
import { wornLoad, feelFactor } from "../src/sim/load.js";

const seed = Number(process.argv[2] || 11);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
const section = (t) => console.log(t);
const r1 = (v) => Math.round(v * 10) / 10;
registerCombatHandler("rigtest", () => {});

function person(state, weapon = "ar") {
  const s = makeSurvivor(state);
  s.traits = []; s.health = 100; s.skills.shooting = 8;
  for (const k of Object.keys(s.gear)) s.gear[k] = null;
  s.pockets = s.pockets.map(() => null);
  s.gear.weapon = weapon ? newItem(weapon) : null;
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  ensureInv(s);
  return s;
}
const L = (s, rest) => `s:${s.id}:${rest}`;
const st = createWorld({ seed, factionCount: 4 });
const h = hub(st);

// 1. Pouches.
section("Pouches");
{
  const s = person(st);
  h.armory.push(newItem("chestrig"));
  check(/Rig/.test(moveItem(st, `armory:${h.id}:list:${h.armory.length - 1}`, L(s, "rig"))) && s.gear.rig && s.gear.rig.key === "chestrig", "a chest rig goes on the Rig slot");
  const P = GEAR.chestrig.pouches;
  check(rigOf(s) === s.gear.rig && rigPouches(s).length === P.length && P.filter((k) => k === "rifle").length === 4 && P.filter((k) => k === "pistol").length === 2, `its pouches: ${P.join(", ")}`);
  const mag = newItem("mag_stanag_30");
  h.armory.push(mag);
  const ri = P.indexOf("rifle"), pi = P.indexOf("pistol"), gi = P.indexOf("grenade"), ai = P.indexOf("admin");
  check(moveItem(st, `armory:${h.id}:list:${h.armory.length - 1}`, L(s, `rig:${ri}`)) !== "" && itemAt(st, L(s, `rig:${ri}`)) === mag, "a rifle magazine into a rifle pouch");
  h.armory.push(newItem("mag_glock_15"));
  const why = moveItem(st, `armory:${h.id}:list:${h.armory.length - 1}`, L(s, `rig:${gi}`));
  check(/pouch does not take/.test(why) && !itemAt(st, L(s, `rig:${gi}`)), `a pistol magazine is refused by the grenade pouch ("${why}")`);
  check(!fitReason(newItem("mag_glock_15"), "pouch", s, "rifle") && /too long/.test(fitReason(newItem("mag_stanag_30"), "pouch", s, "pistol")), "a pistol magazine fits a rifle pouch; a rifle magazine is too long for a pistol pouch");
  check(!fitReason(newItem("frag"), "pouch", s, "grenade") && !!fitReason(newItem("frag"), "pouch", s, "admin") && !fitReason(newItem("bandagekit"), "pouch", s, "admin") && !!fitReason(newItem("machete"), "pouch", s, "admin"), "grenades in the grenade pouch; a bandage kit in admin; no frag or machete in admin");
  check(!fitReason(newItem("handradio"), "pouch", s, "radio") && !fitReason(newItem("speedloader"), "pouch", s, "pistol") && !fitReason(newItem("stripper308"), "pouch", s, "rifle"), "a radio in the radio pouch, a speedloader in a pistol pouch, a stripper clip in a rifle pouch");
  // Out to the pack, back in: moveItem both ways.
  s.gear.backpack = newItem("assaultpack");
  check(moveItem(st, L(s, `rig:${ri}`), L(s, "pack:0")) !== "" && s.gear.backpack.contents[0] === mag && !itemAt(st, L(s, `rig:${ri}`)), "a magazine out of a pouch into the pack");
  check(moveItem(st, L(s, "pack:0"), L(s, `rig:${ri + 1}`)) !== "" && itemAt(st, L(s, `rig:${ri + 1}`)) === mag, "and back into another rifle pouch");
  check(/inside itself/.test(moveItem(st, L(s, "rig"), L(s, `rig:${ai}`))), "a rig does not go into its own pouch");
  // stow and quickMove use pouches for their kinds.
  const g = newItem("frag");
  check(stow(s, g) === L(s, `rig:${gi}`), "stowing a grenade puts it in the grenade pouch");
  check(allCarried(s).includes(mag) && allCarried(s).includes(g) && carriedItems(s).includes(g), "allCarried (and hunting's carriedItems) count what is in the pouches");
  const fc = findCarried(s, "frag");
  check(fc && fc.item === g && (fc.take(), !itemAt(st, L(s, `rig:${gi}`))), "stealth.js findCarried finds a grenade in a pouch (a throw takes it from there)");
  check(carriedSpots(s).some((x) => x.item === mag && x.where === "rig"), "carriedSpots says where: a rig pouch");
  h.armory.push(newItem("mag_stanag_20"));
  const qm = quickMove(st, `armory:${h.id}:list:${h.armory.length - 1}`, s.id);
  check(/Rig pouch/.test(qm), `a double click puts a magazine in a free pouch of its kind ("${qm}")`);
  // A chest rig over a pouched vest.
  const t = person(st);
  t.gear.armor = newItem("tacvest");
  check(/pouches of its own/.test(fitReason(newItem("chestrig"), "rig", t)) && rigOf(t) === t.gear.armor, "a chest rig does not go over a tactical vest (its own pouches are the rig)");
  t.gear.armor = null; t.gear.rig = newItem("chestrig");
  check(/Take the Chest rig off first/.test(fitReason(newItem("plate"), "armor", t)) && !fitReason(newItem("vest"), "armor", t), "a carrier with pouches waits until the chest rig is off; a plain vest goes under it");
  check(itemLoad(s.gear.rig) > GEAR.chestrig.weight && r1(wornLoad(s)) === r1(allCarried(s).filter((x) => [s.gear.weapon, s.gear.rig, s.gear.backpack].includes(x)).reduce((a, x) => a + itemLoad(x), 0)), "a rig weighs what is in its pouches (worn load)");
}

// 2. Plate carriers and inserts.
section("Plate carriers");
{
  const c = newItem("plate");
  const ins = insertsOf(c);
  check(isCarrier(c) && ins.front && ins.back && ins.front.key === "ceramicplate" && ins.back.key === "ceramicplate", "a carrier comes with two ceramic plates");
  check(Math.abs(itemLoad(c) - (GEAR.plate.weight + 2 * GEAR.ceramicplate.weight)) < 1e-9, `it weighs its plates (${r1(itemLoad(c))} kg)`);
  check(itemValue(c) > itemValue(Object.assign(newItem("plate"), { inserts: { front: null, back: null } })), "and is worth them");
  const s = person(st);
  s.gear.armor = c;
  s.gear.backpack = newItem("assaultpack");
  const front = ins.front;
  check(moveItem(st, L(s, "insert:front"), L(s, "pack:0")) !== "" && !insertsOf(c).front && s.gear.backpack.contents[0] === front, "a plate out of its pocket into the pack (free at camp)");
  s.gear.backpack.contents[1] = newItem("bandagekit");
  check(/Only a plate/.test(moveItem(st, L(s, "pack:1"), L(s, "insert:front"))), "nothing but a plate goes in a plate pocket");
  s.gear.backpack.contents[2] = newItem("steelplate");
  check(moveItem(st, L(s, "pack:2"), L(s, "insert:front")) !== "" && insertsOf(c).front.key === "steelplate", "a steel plate in instead");
  const lp = lootItem("plate", "military", [seed, "p"]);
  check(lp.inserts.front.key === "ceramicplate" && lp.inserts.front.dur <= GEAR.ceramicplate.dur && Math.abs(lp.inserts.front.dur / GEAR.ceramicplate.dur - lp.dur / GEAR.plate.dur) < 0.06, `a looted military carrier: ceramic plates as worn as it is (${lp.dur}/${GEAR.plate.dur}, plates ${lp.inserts.front.dur}/${GEAR.ceramicplate.dur})`);
  const sp = newItem("plate", 1, 0.7, START_DUR), hk = startKit(newItem("plate", 1));
  check(sp.inserts.front.key === "steelplate" && sp.inserts.back.key === "steelplate" && hk.inserts.front.key === "steelplate", "a starting carrier (START_DUR, a custom background's or a hardcore start's) holds steel plates");
  check(!repairKind(sp.inserts.front).refuse && !!repairKind(lp.inserts.front).refuse && repairKind(c).kind === "soft", "steel plates can be patched, ceramic cannot; the carrier itself is a soft backer");
}

// 3. Weights and battle bands.
section("Weight in a fight");
{
  check(bandFor(18).mob === 5 && !bandFor(18).dash && bandFor(25).mob === 5 && bandFor(25).dash === -1 && bandFor(35).mob === 4 && bandFor(45).mob === 3, "bands: ≤18 kg 5, ≤28 5 with a dash a tile short, ≤38 4, more 3");
  const s = person(st, "ar");
  const light = battleKg(s);
  starterMags(s);
  check(battleKg(s) > light + 2 * GEAR.mag_stanag_30.weight, `a loaded magazine weighs its rounds too (${r1(light)} → ${r1(battleKg(s))} kg)`);
  {
    // Wave 2's other kit weighs too: a helmet and its mounts, ear protection, a launcher and its loaded round.
    const { fitHelmetMod } = await import("../src/sim/helmets.js");
    const { kitKg } = await import("../src/sim/carrykit.js");
    const t = person(st, "ar");
    const k0 = battleKg(t);
    t.gear.head = newItem("highcut"); fitHelmetMod(t.gear.head, newItem("ballvisor"));
    t.pockets[3] = newItem("earplugs");
    t.gear.tool = newItem("m79");
    const k1 = battleKg(t);
    const want = GEAR.highcut.weight + GEAR.ballvisor.weight + GEAR.earplugs.weight + GEAR.m79.weight + 0.23;
    check(Math.abs(k1 - k0 - want) < 0.05, `battleKg counts a helmet and its visor, ear protection, a launcher and its round (+${r1(k1 - k0)} kg, want ${r1(want)})`);
    const e0 = kitKg({ kind: "human", weapon: "ar" }, "soldiers"), e1 = kitKg({ kind: "human", weapon: "ar", helmKey: "milhelmet", earKey: "earmuffs", gl: { key: "rpg", cal: "rocket", mag: 1, res: { heat: 1 }, from: "weapon" } }, "soldiers");
    check(Math.abs(e1 - e0 - (GEAR.milhelmet.weight + GEAR.earmuffs.weight + GEAR.rpg.weight + 2 * 2.6)) < 0.05, `an enemy's kit helmet, ear protection, RPG and rockets weigh on them (+${r1(e1 - e0)} kg)`);
  }
  s.gear.armor = newItem("plate"); s.gear.rig = null; s.gear.head = newItem("milhelmet"); s.gear.backpack = newItem("rucksack");
  for (let i = 0; i < 6; i++) s.gear.backpack.contents[i] = newItem("frag");
  s.gear.backpack.contents[6] = newItem("ceramicplate"); s.gear.backpack.contents[7] = newItem("steelplate");
  for (let i = 8; i < s.gear.backpack.contents.length && battleKg(s) * feelFactor(s) < 30; i++) s.gear.backpack.contents[i] = newItem("steelplate"); // a heavy load: over 28 kg
  const kg = battleKg(s);
  setRounds(h.stock, 300, ["ar"]);
  const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [s.id], enemy: { kind: "soldiers", count: 4, power: 5 }, ambush: null, canRetreat: true, handler: "rigtest", context: {} }));
  const u = b.units.find((x) => x.sid === s.id);
  const felt = kg * feelFactor(s);
  check(Math.abs(u.armLoad - kg) < 0.05 && u.mob === bandFor(felt).mob && u.dash === bandFor(felt).dash, `a fully kitted fighter: ${r1(kg)} kg (felt ${r1(felt)}: the pack's frame), mob ${u.mob}${u.dash ? `, dash ${u.dash}` : ""}`);
  check(felt > 28 && u.mob === 4, `over 28 kg felt: 4 tiles an action`);
  u.ap = 2; u.dash = -1; u.mob = 5;
  check(dashRange(u) === 9, "a Medium load's dash: 9 tiles, not 10");
  u.dash = bandFor(felt).dash; u.mob = bandFor(felt).mob;
  const sol = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  check(sol.length > 0 && sol.every((e) => e.armLoad > 0 && e.mob === bandFor(e.armLoad).mob), `enemies move by their kit's kg too (${sol.map((e) => `${e.armLoad} kg → ${e.mob}`).join(", ")})`);
  const carriers = sol.filter((e) => e.armorKey === "plate");
  check(carriers.every((e) => e.armLoad > 20), "a soldier in a carrier carries over 20 kg");
  // The escape check reads kg.
  check(loadPenalty(8) === 0 && loadPenalty(26) === 9 && RETREAT.KG === 0.5, "escape: −0.5 a kg over 8 (26 kg: −9)");
  const o = escapeOdds(b, u);
  check(o.parts.some((p) => /load carried/.test(p[0]) && p[1] === -Math.round(loadPenalty(u.armLoad))), `the escape odds list the load carried (${JSON.stringify(o.parts.find((p) => /load/.test(p[0])))})`);
  // 4. Per-hit armour on the plates.
  section("Hits on the carrier's plates");
  const c = s.gear.armor;
  const ins = insertsOf(c);
  const shooter = sol[0];
  u.x = 5; u.y = 5; u.face = [1, 0]; shooter.x = 10; shooter.y = 5;
  const f0 = curDur(ins.front), b0 = curDur(ins.back), c0 = curDur(c);
  const hitUntil = (moved) => { for (let i = 0; i < 80 && !moved(); i++) armourHit(b, u, 25, shooter, { how: "shot", crit: false }); }; // until a torso hit lands (locations are rolled)
  hitUntil(() => curDur(ins.front) < f0);
  check(curDur(ins.front) < f0 && curDur(ins.back) === b0 && curDur(c) === c0, `hits from the front wear the front plate (${f0} → ${r1(curDur(ins.front))}), not the back or the backer`);
  shooter.x = 0;
  hitUntil(() => curDur(ins.back) < b0);
  check(curDur(ins.back) < b0 && curDur(c) === c0, `from behind: the back plate (${b0} → ${r1(curDur(ins.back))})`);
  ins.front.dur = 0; ins.front.shattered = true; shooter.x = 10;
  hitUntil(() => curDur(c) < c0);
  check(curDur(c) < c0, `a shattered front plate: the soft backer takes it (${c0} → ${r1(curDur(c))})`);
  // The plate swap in the fight.
  b.phase = "player"; u.ap = 2; u.carrying = null;
  const pk0 = s.gear.backpack.contents.filter(Boolean).length;
  const why = combatAct(st, { type: "plate", unit: u.id });
  check(!why && insertsOf(c).front && insertsOf(c).front.key === "ceramicplate" && !armourBroken(insertsOf(c).front) && u.ap === 0 && s.gear.backpack.contents.filter(Boolean).length === pk0 - 1, `Swap plate: the best spare from the pack into the front pocket, 2 actions (${why || "ok"})`);
  u.ap = 2; b.phase = "player"; insertsOf(c).back.dur = GEAR[insertsOf(c).back.key].dur;
  const again = combatAct(st, { type: "plate", unit: u.id });
  check(/sound/.test(again), `and not again while both are sound (${again})`);
  ins.back.dur = 0; ins.back.shattered = true; c.dur = GEAR.plate.dur;
  dropBroken(st, s);
  check(insertsOf(c).back === null && s.gear.armor === c, `after the fight a shattered plate is gone; the carrier stays (${JSON.stringify(insertsOf(c).back && insertsOf(c).back.key)}, ${s.gear.armor === c}, ${c.dur})`);
  st.combat = null;
}

// 5. Enemies' rigs, carriers, magazines and what drops.
section("Enemies");
{
  const w = createWorld({ seed: seed + 1, factionCount: 4 });
  const hh = hub(w);
  const s = person(w, "pistol");
  const b = (w.combat = createBattle(w, { tile: hh.tile, baseId: hh.id, fighterIds: [s.id], enemy: { kind: "raiders", count: 1, power: 3 }, ambush: null, canRetreat: true, handler: "rigtest", context: {} }));
  const make = (kind, n) => Array.from({ length: n }, (_, i) => enemyUnit(b, new Rng(seed * 7 + i), kind, 5, i + 1));
  const sold = make("soldiers", 60), guards = make("guards", 60), raid = make("raiders", 200);
  const rigged = (u) => !!u.rigKey || !!(u.armorKey && GEAR[u.armorKey].pouches);
  check(sold.filter(rigged).length / sold.length > 0.8, `soldiers wear a chest rig or a carrier's pouches (${sold.filter(rigged).length}/${sold.length})`);
  check(guards.some((u) => u.armorKey === "tacvest") && guards.every((u) => u.armorKey !== "tacvest" || !u.rigKey), `police: tactical vests (${guards.filter((u) => u.armorKey === "tacvest").length}/${guards.length})`);
  // User decision (2026-10-08): soldiers in full kit move 4, not 5 (carrykit.js CARRY.BASE_KG.soldiers).
  const many = [...sold, ...make("soldiers", 140).map((u) => u)];
  const fullKit = (u) => u.armorKey === "plate" || (!!u.rigKey && !!u.helmKey && ["ar", "carbine", "huntrifle"].includes(u.weapon));
  const full = many.filter(fullKit), light = many.filter((u) => !fullKit(u) && u.armorKey !== "plate");
  check(full.length > 50 && full.every((u) => u.mob === 4), `soldiers in full kit (a plate carrier, or a rig with a helmet and a rifle) move 4 (${full.filter((u) => u.mob === 4).length}/${full.length}; ${Math.min(...full.map((u) => u.armLoad))}–${Math.max(...full.map((u) => u.armLoad))} kg)`);
  check(light.some((u) => u.mob === 5), `a lightly kitted soldier (no carrier) can still move 5 (${light.filter((u) => u.mob === 5).length}/${light.length})`);
  {
    // Your people by the same rule: the kg they carry into the fight sets the band. In a full-kit soldier's kit and
    // load (their carrier with plates, helmet, rifle, magazines, and a pack that makes up a soldier's field load, felt) they move 4.
    const sk = full.find((u) => u.armorKey === "plate" && u.helmKey) || full[0];
    const pl = person(w, "ar");
    pl.gear.armor = Object.assign(newItem("plate"), { inserts: { front: newItem("ceramicplate"), back: newItem("ceramicplate") } });
    pl.gear.head = newItem(sk.helmKey || "milhelmet");
    const pp = rigPouches(pl); pp[0] = newItem("mag_stanag_30"); pp[1] = newItem("mag_stanag_30");
    const kit = battleKg(pl);
    pl.gear.backpack = newItem("rucksack");
    for (let i = 0; i < pl.gear.backpack.contents.length && battleKg(pl) * feelFactor(pl) < sk.armLoad; i++) pl.gear.backpack.contents[i] = newItem("bottle");
    for (let i = 0; i < pl.gear.backpack.contents.length && battleKg(pl) * feelFactor(pl) < sk.armLoad; i++) pl.gear.backpack.contents[i] = newItem("steelplate");
    const kg = battleKg(pl), felt = kg * feelFactor(pl);
    check(bandFor(felt).mob === 4 && bandFor(sk.armLoad).mob === 4, `one of your people with a soldier's kit and load moves 4 too (${r1(kit)} kg of kit, ${r1(kg)} kg with the pack, felt ${r1(felt)}; the soldier ${sk.armLoad} kg)`);
  }
  const mk = raid.filter((u) => u.rigKey === "makeshiftrig").length / raid.length;
  check(mk > 0.2 && mk < 0.4, `raiders: a makeshift rig about 30% (${Math.round(mk * 100)}%)`);
  const spares = (u) => (u.mags || []).filter((m) => m.where !== "gun").length;
  const gunners = sold.filter((u) => u.magMode === "box");
  check(gunners.length && gunners.every((u) => spares(u) >= 3 && spares(u) <= 5), "a soldier with a magazine gun carries 3–5 spares");
  const rg = raid.filter((u) => u.magMode === "box");
  check(rg.length && rg.every((u) => spares(u) >= 1 && spares(u) <= 3), "a raider 1–3");
  const e = gunners.find((u) => u.armorKey === "plate") || gunners[0];
  e.pieces = undefined;
  const body = enemyBody(new Rng(3), e, KITS.soldiers);
  const mags = allCarried(body).filter((it) => GEAR[it.key].mag);
  check(mags.length === spares(e) && mags.every((m) => !e.load || e.load === "fmj" || m.load === e.load), `their spare magazines drop with the body (${mags.length}), loaded with their type`);
  check(e.armorKey !== "plate" || (body.gear.armor && body.gear.armor.inserts), "a soldier's carrier drops with its plates");
  check(kitWorthy(newItem("chestrig")) && kitWorthy(newItem("mag_ak_30")) && kitWorthy(newItem("ceramicplate")) && !kitWorthy(newItem("knife")), "rigs, magazines and plates go in an AI group's arsenal");
  w.combat = null;
}

// 6. The autopilot's kit, spare plates, packing for a trip.
section("Kit from the armory");
{
  const w = createWorld({ seed: seed + 2, factionCount: 4 });
  const hh = hub(w);
  const s = person(w, "ar");
  s.gear.armor = newItem("plate");
  insertsOf(s.gear.armor).back = null;
  hh.armory.push(newItem("chestrig"), newItem("steelplate"), newItem("ceramicplate"), ...Array.from({ length: 6 }, () => newItem("mag_stanag_30")), newItem("mag_glock_15"));
  const got = equipKit(hh.armory, [s]);
  check(!s.gear.rig && insertsOf(s.gear.armor).back && insertsOf(s.gear.armor).back.key === "ceramicplate", "the empty back pocket gets the best plate (ceramic); no chest rig over the carrier's pouches");
  const mine = carriedSpots(s).filter((x) => GEAR[x.item.key].mag);
  check(mine.length === CARRY.PACK.rifle && mine.filter((x) => x.where === "rig").length === 2 && mine.every((x) => x.item.key === "mag_stanag_30"), `spare magazines: ${mine.length} for the rifle, the carrier's two rifle pouches first, then pockets (${mine.map((x) => x.where).join(", ")})`);
  check(got.length >= 2, `what moved is reported (${got.length})`);
  const t = person(w, "pistol");
  equipKit(hh.armory, [t]);
  const tm = carriedSpots(t).filter((x) => GEAR[x.item.key].mag);
  check(t.gear.rig && t.gear.rig.key === "chestrig" && tm.length >= 1 && tm.length <= CARRY.PACK.pistol && tm.every((x) => x.where === "rig" && x.item.key === "mag_glock_15"), `a person in no vest: the chest rig, and pistol magazines into its pouches (${tm.length})`);
  // Broken plates replaced from the armory; a worn steel plate in the armory to the bench.
  insertsOf(s.gear.armor).front.dur = 0; insertsOf(s.gear.armor).front.shattered = true;
  const msgs = governPlates(w, hh, [s], null);
  check(msgs.length === 1 && insertsOf(s.gear.armor).front.key === "steelplate" && !armourBroken(insertsOf(s.gear.armor).front), `the governor swaps a broken plate for a spare (${msgs.join("; ")})`);
  // Packing for a trip.
  const p1 = person(w, "ar"), p2 = person(w, "pistol");
  p1.gear.rig = newItem("chestrig");
  hh.armory.push(...Array.from({ length: 8 }, () => newItem("mag_stanag_30")), ...Array.from({ length: 4 }, () => newItem("mag_glock_15")));
  setRounds(hh.stock, 400, ["ar", "pistol"]);
  hh.stock.food = 50; hh.stock.water = 50;
  const tile = w.tiles.find((x) => x.loc && x.id !== hh.tile && w.grid.distance(x.id, hh.tile) > 1 && w.grid.distance(x.id, hh.tile) < 6);
  const res = launchExpedition(w, { memberIds: [p1.id, p2.id], dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 60 } });
  const m1 = carriedSpots(p1).filter((x) => GEAR[x.item.key].mag), m2 = carriedSpots(p2).filter((x) => GEAR[x.item.key].mag);
  check(!res.error && m1.length === 4 && m1.every((x) => x.where === "rig") && m2.length === 3, `a team packs spare magazines from the armory: rifle 4 (in the rig), pistol 3 (${m1.length} / ${m2.length})`);
  check(packMags([], [p1]).length === 0, "nothing more to pack once they have theirs");
}

// 7. A save's round trip and old saves.
section("Saves");
{
  const w = createWorld({ seed: seed + 3, factionCount: 4 });
  const s = person(w, "ar");
  s.gear.rig = newItem("chestrig");
  rigPouches(s)[0] = Object.assign(newItem("mag_stanag_30"), { load: "ap" });
  s.gear.armor = newItem("plate");
  insertsOf(s.gear.armor).front.dur = 17;
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(w))));
  const s2 = back.survivors.find((x) => x.id === s.id);
  check(s2.gear.rig.contents[0].key === "mag_stanag_30" && s2.gear.rig.contents[0].load === "ap" && s2.gear.armor.inserts.front.dur === 17 && back.kitV === 2, "a rig's pouches (a magazine of AP), a carrier's worn plate survive a save and load");
  // An old save: a single-piece plate carrier (dur on the old 45 scale), a gun with no spare magazines, no kitV.
  const o = createWorld({ seed: seed + 4, factionCount: 4 });
  const p = person(o, "ar");
  const old = { key: "plate", name: "Plate carrier", quality: 0.9, dur: 30 };
  p.gear.armor = old;
  const shat = { key: "plate", name: "Plate carrier", quality: 1, dur: 0, shattered: true };
  hub(o).armory.push(shat);
  delete o.kitV;
  const mod = { key: "pistol", name: "9mm pistol", quality: 1, mods: { mag: { key: "extmag", name: "Extended pistol magazine", quality: 1 } } };
  hub(o).armory.push(mod);
  const loaded = deserializeState(JSON.parse(JSON.stringify(serializeState(o))));
  const lp = loaded.survivors.find((x) => x.id === p.id);
  const c = lp.gear.armor;
  check(c.inserts && c.inserts.front.key === "ceramicplate" && c.inserts.front.dur === Math.round(45 * 30 / 45) && c.dur === Math.round(GEAR.plate.dur * 30 / 45), `an old carrier (30 of 45): two ceramic plates at 30, its backer at ${c.dur} of ${GEAR.plate.dur}`);
  const ls = hub(loaded).armory.find((x) => x.key === "plate");
  check(ls && ls.inserts && !ls.inserts.front && !ls.inserts.back && ls.dur > 0 && !ls.shattered, "an old shattered carrier: no plates, its backer kept");
  check(carriedSpots(lp).filter((x) => GEAR[x.item.key].mag).length + hub(loaded).armory.filter((x) => x.key === "mag_stanag_30").length === CARRY.START && loaded.kitV === 2, "an old save's people get their gun's spare magazines once");
  const lm = hub(loaded).armory.find((x) => x.key === "pistol" && x.mods);
  check(lm && lm.mods.mag.key === "extmag" && GEAR.extmag.mag.cap === 24, "an old fitted extended magazine is a 24-round magazine item on the gun");
  migrateKit(loaded);
  check(carriedSpots(lp).filter((x) => GEAR[x.item.key].mag).length + hub(loaded).armory.filter((x) => x.key === "mag_stanag_30").length === CARRY.START, "and only once");
  const raw = { key: "plate", name: "x", dur: 45 };
  migrateCarrier(raw);
  check(raw.inserts.front.dur === GEAR.ceramicplate.dur && raw.dur === GEAR.plate.dur, "a full old carrier: full plates, a full backer");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
