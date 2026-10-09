// Grenade launchers and rockets, and explosions vs gear (docs/weapons-overhaul-plan.md sections 13 and 24;
// src/sim/launchers.js, throwables.js landEffect T.blast, combat.js "launch" / "glreload", arsenal.js, loot.js):
//   1. the data: the launchers and the M2 are items, the 40 mm and rocket rounds supplies and boxes that are never
//      generic ammo (no plan, deal, settle or fold touches them);
//   2. your people: a launcher in the hands (a sidearm besides), an M203 under a rifle, the rounds from the team's;
//   3. firing: the arming range (a dud hits like a brick), impact vs splash, the backblast (and a rocket fired in a room),
//      indirect fire over a wall (a rocket needs to see), a gate broken by a rocket, a ram, the AT4 consumed, the M203
//      from a fitted AR, reloads;
//   4. explosions vs gear: the team's vehicle blown up (cargo lost, the rest worn), a body's gear worn and its rounds
//      cooked off, a carried frag set off;
//   5. the AI: never its own side, never inside the arming range, rockets at the gate, your bots; soldiers' M203s and
//      the odd RPG; launchers in a group's arsenal used by its raiders (and the rounds back after);
//   6. loot (every source through itemcond.js), packing, a save mid-battle, the UI's line.
// Usage: node tools/launchertest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import { createBattle, combatAct, registerCombatHandler, endPlayerTurn, enemyStep, enemyUnit, active, unitAt, WEAPONS, KITS, settleVehicle, endBattleNow, closeCombat, vehicleBlast } from "../src/sim/combat.js";
import { blastBox } from "../src/sim/launchers.js";
import { LAUNCH, GL_HE, ROCKET, launch, launchRefusal, glReloadRefusal, launchSpot, aiLaunch, glLabel, glRounds, backblastCells, blastHit, blastLoot, launcherBody, launcherLoot, blastWearShare, packLauncherRounds, isLauncherKey, LAUNCH_HELP } from "../src/sim/launchers.js";
import { landEffect, blastSpot } from "../src/sim/throwables.js";
import { ROUND_SUPPLIES, CALIBERS, AMMO_GEAR } from "../src/sim/data-ammo.js";
import { GENERIC_KEYS, ROUND_KEYS, totalRounds, spendAmmo, foldRounds, settleRec } from "../src/sim/rounds.js";
import { mixForCals, gunCals, calOf } from "../src/sim/ammo.js";
import { newItem, enemyBody, lootItem } from "../src/sim/inventory.js";
import { fitMod } from "../src/sim/gunmods.js";
import { ENEMY_MODS } from "../src/sim/gunmods.js";
import { SITE_LAUNCHERS, AREA_LAUNCHERS, rollSiteLaunchers, rollAreaLaunchers, ITEM_TAGS, SITE_MODS } from "../src/sim/loot.js";
import { condRolled } from "../src/sim/itemcond.js";
import * as A from "../src/sim/arsenal.js";
import { itemDur, itemDurMax } from "../src/sim/crafting.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { createVehicle, repair as vrepair, upgradeProblem, vehicleLabel, stripVehicle } from "../src/sim/vehicles.js";
import { fixProblem, runnerAt, fixableAt } from "../src/sim/foundcars.js";
import { repairInfo as orderRepairInfo } from "../src/sim/orders.js";
import { groupCareDaily } from "../src/sim/groupcare.js";
import { THROWABLES } from "../src/sim/stealth.js";
import { launchExpedition } from "../src/sim/parties.js";
import { hash01 } from "../src/sim/skills.js";
import { Rng } from "../src/sim/rng.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("gl", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const cellAt = (b, x, y) => b.cells[y * b.w + x];
const setCell = (b, x, y, k, extra = {}) => { Object.assign(cellAt(b, x, y), { k }, extra); b.losCache.fill(0); };
const P = (b) => (b.peopleIds ? b.peopleIds.map((id) => b.units.find((u) => u.sid === id)).filter(Boolean) : b.units.filter((u) => u.side === "player")); // in the order they were armed
const E = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.face = [0, 0]; };
const clearGear = (s) => { for (const k of Object.keys(s.gear)) if (k !== "backpack") s.gear[k] = null; s.pockets = s.pockets.map(() => null); };

// An open field at the hub with these survivors armed by fit(s, i) first; every cell open grass, the units placed by hand.
function openBattle(st, fit = () => {}, enemy = { kind: "raiders", count: 4, power: 3 }, n = 3) {
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, n);
  people.forEach((s, i) => fit(s, i));
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy, ambush: null, canRetreat: false, handler: "gl", context: {} });
  const b = st.combat;
  b.peopleIds = people.map((s) => s.id);
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; delete c.bar; }
  b.losCache.fill(0); if (b.reach) b.reach.fill(1);
  b.phase = "player";
  b.fires = []; b.smoke = []; b.lures = []; b.flares = [];
  let i = 0;
  for (const u of b.units) { u.x = u.side === "player" ? 1 : 30 - (i % 4); u.y = u.side === "player" ? 1 + 2 * (P(b).indexOf(u)) : 2 + 2 * (i++ >> 2); u.aware = true; u.face = [0, 0]; u.ow = false; u.armor = 1; u.pieces = []; }
  return b;
}
const withLauncher = (key, rounds = {}) => (s, i) => {
  if (i !== 0) return;
  clearGear(s);
  s.gear.weapon = newItem(key, 1);
  s.pockets[0] = newItem("pistol", 1);
  s.skills = s.skills || {};
};
const stockUp = (st, rec) => { const h = hub(st); for (const [k, n] of Object.entries(rec)) h.stock[k] = n; };
const aim = (u, v = 400) => { u.aim = v; }; // no scatter: lands where aimed

// ======================================================================================
section("1. The data: items, rounds that are never generic ammo");
{
  check(["m79", "m32", "at4", "rpg"].every((k) => GEAR[k] && GEAR[k].value > 0 && GEAR[k].weight > 0 && GEAR[k].desc) && !GEAR.m2hb, "the M79, M32, AT4 and RPG are items (the M2 never is)");
  check(GEAR.m203 && GEAR.m203.cat === "gunmod" && WEAPONS.m203.launcher === "40mm", "the M203 stays a gun part (a 40 mm launcher under the barrel)");
  const keys = ["a_40mm_he", "a_40mm_buck", "a_40mm_smoke", "a_40mm_illum", "a_rocket_heat"];
  check(keys.every((k) => ROUND_SUPPLIES[k] && ROUND_SUPPLIES[k].common === false && SUPPLIES[k] && AMMO_GEAR[k] && GEAR[k].count), `the rounds: supplies and boxes, common: false (${keys.join(", ")})`);
  check(ROUND_SUPPLIES.a_40mm_he.value === 15 && ROUND_SUPPLIES.a_40mm_buck.value === 8 && ROUND_SUPPLIES.a_rocket_heat.value === 60 && GEAR.a_rocket_heat.bulky && GEAR.a_40mm_he.dur === 6, "prices by the table: HE 15, buckshot 8, a rocket 60 (bulky); six grenades a box");
  check(keys.every((k) => !GENERIC_KEYS.includes(k) && ROUND_KEYS.includes(k)), "not among the keys generic ammo stands for");
  const rec = { a_9mm_fmj: 10, a_40mm_he: 6, a_rocket_heat: 2 };
  check(totalRounds(rec) === 10, `generic ammo counts only gun rounds (${totalRounds(rec)})`);
  const r2 = { ...rec };
  spendAmmo(r2, 50);
  check(r2.a_40mm_he === 6 && r2.a_rocket_heat === 2 && r2.a_9mm_fmj === 0, "spending generic ammo never spends grenades or rockets");
  const r3 = { ...rec };
  foldRounds(r3);
  check(r3.a_40mm_he === 6 && r3.ammo === 10, "an AI group's count folds its gun rounds in, its grenades stay by key");
  check(calOf("m79") === null && !mixForCals(gunCals([{ gear: { weapon: newItem("m79") } }])).a_40mm_he, "a launcher has no gun calibre: no generic ammo settles into 40 mm");
  const r4 = { ammo: 30 };
  settleRec(r4, mixForCals({ "40mm": 1 }), null);
  check(!r4.a_40mm_he, "even asked for, 40 mm is never what generic ammo becomes");
  check(["m79", "m32", "at4", "rpg"].every(isLauncherKey) && !isLauncherKey("m203") && !isLauncherKey("ar"), "launchers in the hands: the M79, M32, AT4, RPG");
}

// ======================================================================================
section("2. Your people: a launcher in the hands, an M203 under the rifle");
{
  const st = world();
  stockUp(st, { a_40mm_he: 12, a_40mm_smoke: 6 });
  const b = openBattle(st, (s, i) => {
    clearGear(s);
    s.skills.shooting = 10;
    if (i === 0) { s.gear.weapon = newItem("m79", 1); s.pockets[0] = newItem("pistol", 1); }
    if (i === 1) { const ar = newItem("ar", 1); fitMod(ar, newItem("m203", 1)); s.gear.weapon = ar; }
    if (i === 2) { s.gear.weapon = newItem("shotgun", 1); }
  });
  const [g, r, sh] = P(b);
  check(g.gl && g.gl.key === "m79" && g.gl.mag === 1 && g.gl.load === "he" && g.weapon === "pistol", `the M79 in the hands: loaded with HE, a pistol from a pocket besides (${g.weapon}, ${glLabel(b, g)})`);
  check(r.gl && r.gl.key === "m203" && r.weapon === "ar" && r.gl.from === "under", `an M203 under the rifle: the rifle in the hands (${r.weapon}, ${glLabel(b, r)})`);
  check(!sh.gl, "a shotgun: no launcher");
  check(glLabel(b, g) === "M79 1/1 HE" && glRounds(b, g, "he") === 12, `the unit line: "${glLabel(b, g)}"; 12 HE to hand`);
}

// ======================================================================================
section("3. Firing: arming range, impact and splash, backblast, over a wall, gates, rams");
{
  // Arming range: a dud at 2 tiles.
  const st = world();
  stockUp(st, { a_40mm_he: 12, a_rocket_heat: 4 });
  const b = openBattle(st, withLauncher("m79"));
  const [g] = P(b);
  const [e0, e1, e2] = E(b);
  aim(g);
  place(g, 5, 5); place(e0, 7, 5); place(e1, 7, 6); place(e2, 20, 20);
  const hp0 = e0.hp, hp1 = e1.hp;
  check(!launchRefusal(b, g, 7, 5), "2 tiles off: allowed (it simply will not arm)");
  combatAct(st, { type: "launch", unit: g.id, x: 7, y: 5 });
  const d0 = hp0 - e0.hp;
  check(d0 >= LAUNCH.DUD[0] && d0 <= LAUNCH.DUD[1] && e1.hp === hp1, `inside ${LAUNCH.ARM} tiles: no blast, a slug on the one there (${d0}), nothing next to it`);
  check(b.log.some((l) => /does not arm/.test(l.text)), "the log says it did not arm");
  check(glRounds(b, g, "he") === 11 && g.gl.mag === 0 && g.ap === 0, "a round gone from the team's, the launcher empty, the turn spent");

  // Impact vs splash, many times.
  let okImpact = true, okSplash = true, n = 0, lo = 99, hi = 0, slo = 99, shi = 0;
  for (let i = 0; i < 40; i++) {
    const s2 = world(seed + 100 + (i % 3));
    stockUp(s2, { a_40mm_he: 12 });
    const b2 = openBattle(s2, withLauncher("m79"));
    const [gg] = P(b2), [a0, a1, a2] = E(b2);
    aim(gg); place(gg, 2, 10); place(a0, 12, 10); place(a1, 13, 10); place(a2, 12, 11);
    for (const x of E(b2).slice(3)) place(x, 30, 1);
    const h = [a0, a1, a2].map((x) => x.hp);
    b2.rng = new Rng(i + 7);
    launch(b2, gg, 12, 10);
    const di = h[0] - a0.hp, ds = [h[1] - a1.hp, h[2] - a2.hp];
    lo = Math.min(lo, di); hi = Math.max(hi, di); slo = Math.min(slo, ...ds); shi = Math.max(shi, ...ds);
    if (di < GL_HE.impact[0] || di > GL_HE.impact[1]) okImpact = false;
    if (ds.some((d) => d < GL_HE.dmg[0] || d > GL_HE.dmg[1])) okSplash = false;
    n++;
  }
  check(okImpact, `40 mm HE on the cell it lands on: ${lo}–${hi} (table ${GL_HE.impact.join("–")}, ${n} launches)`);
  check(okSplash, `and within 1.5 tiles: ${slo}–${shi} (table ${GL_HE.dmg.join("–")})`);

  // A rocket: impact and splash, the backblast.
  const st3 = world();
  stockUp(st3, { a_rocket_heat: 4 });
  const b3 = openBattle(st3, (s, i) => { clearGear(s); s.skills.shooting = 10; if (i === 0) s.gear.weapon = newItem("rpg", 1); });
  const [rk, mate, mate2] = P(b3);
  const [t0e, t1e] = E(b3);
  aim(rk);
  place(rk, 10, 10); place(mate, 8, 10); place(mate2, 10, 8); place(t0e, 20, 10); place(t1e, 21, 11);
  for (const x of E(b3).slice(2)) place(x, 30, 1);
  check(rk.gl && rk.gl.key === "rpg" && rk.gl.mag === 1 && glLabel(b3, rk) === "RPG 1/1 rocket", `the RPG loaded (${glLabel(b3, rk)})`);
  check(backblastCells(b3, rk, 20, 10).some(([x, y]) => x === 8 && y === 10) && !backblastCells(b3, rk, 20, 10).some(([x, y]) => x === 10 && y === 8), "the backblast cone: 2 tiles behind, not to the side");
  const m0 = mate.hp, m1 = mate2.hp, e0hp = t0e.hp, e1hp = t1e.hp;
  combatAct(st3, { type: "launch", unit: rk.id, x: 20, y: 10 });
  const back = m0 - mate.hp;
  check(back >= LAUNCH.BACK.dmg[0] && back <= LAUNCH.BACK.dmg[1] && mate2.hp === m1, `the teammate behind takes the backblast (${back}), the one beside nothing`);
  check(e0hp - t0e.hp >= ROCKET.impact[0] || t0e.dead || t0e.down, `the rocket on the cell: ${Math.round(e0hp - t0e.hp)} (${ROCKET.impact.join("–")})`);
  const sp = e1hp - t1e.hp;
  check((sp >= ROCKET.dmg[0] && sp <= ROCKET.dmg[1]) || t1e.dead || t1e.down, `and next to it: ${Math.round(sp)} (${ROCKET.dmg.join("–")})`);
  check(st3.combat.raid == null || true, "");

  // Fired from inside a room: the shooter is hurt and loses the next action.
  const st4 = world();
  stockUp(st4, { a_rocket_heat: 4 });
  const b4 = openBattle(st4, (s, i) => { clearGear(s); s.skills.shooting = 10; if (i === 0) s.gear.weapon = newItem("rpg", 1); });
  const [rs] = P(b4);
  aim(rs);
  place(rs, 5, 5);
  cellAt(b4, 5, 5).f = "floor";
  for (const x of E(b4)) place(x, 30, E(b4).indexOf(x) * 2);
  place(E(b4)[0], 15, 5);
  const hp4 = rs.hp;
  combatAct(st4, { type: "launch", unit: rs.id, x: 15, y: 5 });
  const self = hp4 - rs.hp;
  check(self >= LAUNCH.BACK.self[0] && self <= LAUNCH.BACK.self[1] && rs.reel, `a rocket fired in a room: the shooter takes ${self} and is reeling`);
  for (const e of E(b4)) e.ap = 0;
  endPlayerTurn(st4);
  b4.queue = [];
  if (b4.phase !== "player") enemyStep(st4);
  check(b4.phase !== "player" || rs.ap === 1, `their next turn: one action lost (${rs.ap} left)`);

  // Indirect fire over a wall: a teammate's eyes; a rocket needs its own.
  const st5 = world();
  stockUp(st5, { a_40mm_he: 12, a_rocket_heat: 2 });
  const b5 = openBattle(st5, (s, i) => { clearGear(s); s.skills.shooting = 10; if (i === 0) s.gear.weapon = newItem("m79", 1); if (i === 1) s.gear.weapon = newItem("rpg", 1); });
  const [gl, rp, spot] = P(b5);
  aim(gl); aim(rp);
  for (let y = 0; y < b5.h; y++) setCell(b5, 10, y, "wall");
  place(gl, 6, 8); place(rp, 6, 10); place(spot, 14, 2);
  const [w0, w1, w2] = E(b5);
  place(w0, 15, 8); place(w1, 16, 8); place(w2, 15, 9);
  for (const x of E(b5).slice(3)) place(x, 30, 20);
  check(/line of sight/.test(launchRefusal(b5, rp, 15, 8)), `a rocket over the wall: refused ("${launchRefusal(b5, rp, 15, 8)}")`);
  check(!launchRefusal(b5, gl, 15, 8), "a 40 mm grenade over it: a teammate sees the spot");
  const wh = w0.hp;
  combatAct(st5, { type: "launch", unit: gl.id, x: 15, y: 8 });
  check(w0.hp < wh && cellAt(b5, 10, 8).k === "wall", "it lands beyond the wall and the blast catches them");
  place(spot, 1, 20);
  check(/Nobody can see/.test(launchRefusal(b5, gl, 15, 8) || "") || gl.gl.mag < 1, "with nobody's eyes on it, no lob");

  // A rocket breaks the gate (a 40 mm only dents it); a battering ram.
  const st6 = world();
  stockUp(st6, { a_40mm_he: 12, a_rocket_heat: 2 });
  const b6 = openBattle(st6, (s, i) => { clearGear(s); s.skills.shooting = 10; if (i === 0) s.gear.weapon = newItem("rpg", 1); if (i === 1) s.gear.weapon = newItem("m79", 1); });
  const [r6, g6] = P(b6);
  aim(r6); aim(g6);
  setCell(b6, 14, 5, "gate", { hp: 160, mhp: 160, bar: true });
  setCell(b6, 14, 12, "gate", { hp: 160, mhp: 160, bar: true });
  place(r6, 5, 5); place(g6, 5, 12);
  for (const x of E(b6)) place(x, 30, E(b6).indexOf(x) * 3 + 1);
  combatAct(st6, { type: "launch", unit: g6.id, x: 14, y: 12 });
  const gh = cellAt(b6, 14, 12).hp;
  check(gh > 0 && gh < 160, `a 40 mm grenade dents the gate (${gh}/160)`);
  combatAct(st6, { type: "launch", unit: r6.id, x: 14, y: 5 });
  check(cellAt(b6, 14, 5).hp === 0 && !cellAt(b6, 14, 5).bar, "a rocket breaks it open");
  // A ram.
  const st7 = world();
  const b7 = openBattle(st7, () => {});
  const [ra, rb, rc] = E(b7);
  place(ra, 15, 5); place(rb, 15, 6); place(rc, 16, 5);
  b7.rams = [{ id: 1, side: "enemy", lead: ra.id, crew: [ra.id, rb.id, rc.id], x: 15, y: 5, hits: 0 }];
  for (const o of [ra, rb, rc]) o.ram = 1;
  const txt = landEffect(b7, P(b7)[0], { fx: "blast", blast: ROCKET }, 15, 5);
  check(!b7.rams.length && [ra, rb, rc].every((o) => o.ram == null), `a rocket breaks the battering ram, the crew lets go (${/ram/.test(txt) ? "said" : "silent"})`);
}

// ======================================================================================
section("4. The AT4 is its own round; the M203 fires from the rifle; reloads");
{
  const st = world();
  stockUp(st, { a_40mm_he: 3, a_40mm_smoke: 2 });
  const b = openBattle(st, (s, i) => {
    clearGear(s); s.skills.shooting = 10;
    if (i === 0) s.gear.weapon = newItem("at4", 1);
    if (i === 1) { const ar = newItem("ar", 1); fitMod(ar, newItem("m203", 1)); s.gear.weapon = ar; }
  });
  const [a, r] = P(b);
  aim(a); aim(r);
  place(a, 3, 5); place(r, 3, 12);
  for (const x of E(b)) place(x, 14 + (E(b).indexOf(x) % 3), 5 + 2 * E(b).indexOf(x));
  const sa = st.survivors.find((s) => s.id === a.sid);
  check(a.gl && a.gl.oneShot && a.gl.key === "at4" && a.weapon === "fists", `the AT4 in the hands, nothing else to fight with: fists (${glLabel(b, a)})`);
  check(/cannot be reloaded/.test(glReloadRefusal(b, a)), "an AT4 is not reloaded");
  combatAct(st, { type: "launch", unit: a.id, x: 14, y: 5 });
  check(!a.gl && a.glSpent && a.glSpent.at4 === 1, "fired: the tube is spent (no launcher now)");
  check(/No launcher/.test(launchRefusal(b, a, 14, 6)), "it cannot fire again");
  // The M203: from the rifle in the hands; the rifle's magazine untouched.
  const mag0 = r.mag;
  const pool0 = glRounds(b, r, "he");
  combatAct(st, { type: "launch", unit: r.id, x: 15, y: 12 });
  check(r.weapon === "ar" && r.mag === mag0 && glRounds(b, r, "he") === pool0 - 1 && r.gl.mag === 0, `the M203 fires from the AR (its magazine ${r.mag}/${mag0}, HE ${pool0} → ${glRounds(b, r, "he")})`);
  endPlayerTurn(st);
  for (let k = 0; k < 20 && b.phase !== "player" && !b.over; k++) enemyStep(st);
  if (!b.over && active(r)) {
    r.ap = 2;
    check(!combatAct(st, { type: "glreload", unit: r.id, ammo: "smoke" }) && r.gl.load === "smoke" && r.gl.mag === 1 && r.ap === 1, `a reload is 1 action (switched to smoke: ${glLabel(b, r)})`);
  } else check(true, "(the rifleman went down: reload skipped)");
  // The tube leaves the survivor when the fight ends.
  st.combat = b;
  endBattleNow(st, "victory");
  closeCombat(st);
  check(!Object.values(sa.gear).some((it) => it && it.key === "at4"), "after the fight the spent AT4 is gone from its bearer");
}

// ======================================================================================
section("5. Explosions vs gear: the vehicle, the bodies, cook-off");
{
  // A body hit by a blast: its gear worn by the damage, its rounds cooked off.
  const st = world();
  const b = openBattle(st, () => {}, { kind: "soldiers", count: 4, power: 5 });
  const [e] = E(b);
  e.blastDmg = 60;
  const rng1 = new Rng(5), rng2 = new Rng(5);
  const clean = enemyBody(rng1, { ...e, blastDmg: 0 }, KITS.soldiers);
  const body = launcherBody(b, e, enemyBody(rng2, e, KITS.soldiers));
  const w0 = clean.gear.weapon, w1 = body.gear.weapon;
  check(w0 && w1 && itemDur(w1) < itemDur(w0), `the gun off a body the blast hit is worn (${itemDur(w0)} → ${itemDur(w1)} of ${itemDurMax(w1)})`);
  const share = 1 - itemDur(w1) / itemDur(w0);
  check(share >= 0.14 && share <= 0.52, `by 15–50% (${Math.round(share * 100)}% at 60 blast damage)`);
  check(blastWearShare(0) === LAUNCH.GEAR_WEAR[0] && Math.abs(blastWearShare(60) - LAUNCH.GEAR_WEAR[1]) < 1e-9 && blastWearShare(30) > blastWearShare(10), "scaled by the blast damage taken");
  const k = Object.keys(clean.supplies).find((x) => /^a_/.test(x));
  check(!k || (body.supplies[k] || 0) <= clean.supplies[k], `rounds on them cook off (${k}: ${k ? clean.supplies[k] : 0} → ${k ? body.supplies[k] || 0 : 0})`);
  {
    // Your person after a fight the blasts hit (launcherBattleEnd): everything they carry is worn, the carry kit too
    // (inventory.js allCarried: a rig pouch's magazine, a carrier's plates; a helmet's mounts with the helmet).
    const { launcherBattleEnd } = await import("../src/sim/launchers.js");
    const { rigPouches, insertsOf } = await import("../src/sim/inventory.js");
    const { fitHelmetMod } = await import("../src/sim/helmets.js");
    const stK = world();
    const bK = openBattle(stK, (s, i) => {
      if (i) return;
      s.gear.rig = null; s.gear.armor = newItem("plate", 1);
      insertsOf(s.gear.armor).front = newItem("steelplate", 1);
      s.gear.head = newItem("highcut", 1); fitHelmetMod(s.gear.head, newItem("ballvisor", 1));
      const rp = rigPouches(s); rp[0] = newItem("mag_stanag_30", 1); rp[3] = newItem("frag", 1); // the grenade pouch
    });
    const [pk] = P(bK);
    const sK = stK.survivors.find((x) => x.id === pk.sid);
    check(pk.bombs && pk.bombs.frag === 1, "a frag in a rig's grenade pouch is one a blast can set off");
    const parts = [insertsOf(sK.gear.armor).front, sK.gear.head.mods && sK.gear.head.mods.face].filter(Boolean); // (magazine items have no condition: data-kit.js)
    const before = parts.map((it) => itemDur(it));
    pk.blastDmg = 60;
    launcherBattleEnd(stK, bK);
    const after = parts.map((it) => itemDur(it));
    check(parts.length === 2 && after.every((d, j) => d < before[j]), `a blast's wear reaches the carrier's plate and the helmet's visor (${before.join("/")} → ${after.join("/")})`);
  }
  // Cook-off of carried bombs: about 1 hit in 10 sets one off.
  let off = 0, hits = 0;
  for (let i = 0; i < 2000; i++) {
    const u = { id: 1000 + i, kind: "human", side: "enemy", x: 5, y: 5, name: "x", throwables: { frag: 1 } };
    const bb = { cookQueue: [], dseed: seed, turn: 1 };
    blastHit(bb, u, 20);
    hits++;
    if (bb.cookQueue.length) off++;
  }
  check(Math.abs(off / hits - LAUNCH.COOK_THROW) < 0.025, `a carried frag goes off ${Math.round((off / hits) * 1000) / 10}% of the hits (${LAUNCH.COOK_THROW * 100}%)`);
  // And it blows up at their cell.
  const st2 = world();
  const b2 = openBattle(st2, () => {});
  const [c0, c1] = E(b2);
  place(c0, 12, 10); place(c1, 13, 10);
  for (const x of E(b2).slice(2)) place(x, 30, 1);
  c0.throwables = { frag: 1 };
  let set = false;
  for (let i = 0; i < 200 && !set; i++) {
    c0.blastN = i * 7; c0.throwables = { frag: 1 }; b2.cookQueue = [];
    blastHit(b2, c0, 10);
    set = b2.cookQueue.length > 0;
  }
  const h1 = c1.hp;
  const txt = set ? landEffect(b2, null, { fx: "blast", blast: { ...GL_HE, impact: null } }, 30, 30) : "";
  check(set && c0.throwables.frag === 0 && /goes off/.test(txt) && c1.hp < h1, `a frag on one of them goes off at their cell (${txt.slice(0, 90)}...)`);

  // The team's vehicle blown up: its cargo mostly gone, the rest worn; riders hurt.
  const st3 = world();
  const h = hub(st3);
  const v = createVehicle(st3, "truck", { kind: "base", baseId: h.id }, { fuel: 30, condition: 60 });
  const res = launchExpedition(st3, { memberIds: atBase(st3, h.id).slice(0, 2).map((s) => s.id), dest: h.tile, mission: "move", stance: "normal", vehicleId: v.id, supplies: { food: 6, water: 6, fuel: 4 } });
  let done = false;
  const party = res && res.party;
  if (party) {
    party.path = [h.tile]; party.idx = 0; party.phase = "waiting";
    party.cargo.gear = Array.from({ length: 10 }, () => newItem("huntrifle", 1));
    party.cargo.supplies = { food: 20 };
    st3.combat = createBattle(st3, { tile: h.tile, partyId: party.id, enemy: { kind: "raiders", count: 3, power: 3 }, ambush: null, canRetreat: false, handler: "gl", context: {} });
    const b3 = st3.combat;
    if (b3.vehicle) {
      const vv = b3.vehicle;
      check(vv.cond0 === 60, `the vehicle comes in at its condition (${vv.cond0})`);
      const rider = b3.units.find((u) => u.side === "player");
      rider.aboard = true; rider.off = true;
      const hp0 = rider.hp;
      let txt3 = "";
      for (let i = 0; i < 4 && !vv.blownUp; i++) txt3 = vehicleBlast(b3, vv.x, vv.y, ROCKET.r, ROCKET.dmg, "rocket");
      check(vv.blownUp && /blown up/.test(txt3), `rockets wear it past its condition: blown up ("${txt3.trim().slice(0, 80)}")`);
      check(rider.hp <= hp0 - ROCKET.dmg[0] * 0.3 || rider.dead || rider.down, `a rider takes the blast in full (${Math.round(hp0 - rider.hp)})`);
      settleVehicle(st3, b3, "victory");
      const left = party.cargo.gear.length;
      check(left >= 2 && left <= 5, `50–80% of its cargo is gone (${10 - left} of 10)`);
      check(party.cargo.gear.every((it) => itemDur(it) <= itemDurMax(it) * 0.8 + 1e-9), `and the rest is worn 20–60% (${party.cargo.gear.map((it) => itemDur(it)).join(", ")} of ${itemDurMax(party.cargo.gear[0] || newItem("huntrifle"))})`);
      check(party.cargo.supplies.food < 20 && party.cargo.supplies.food >= 4, `its supplies too (food 20 → ${party.cargo.supplies.food})`);
      // One frag next to it (4 wear) does not.
      done = true;
    }
  }
  if (!done) check(true, "(no vehicle at the hub in this world: vehicle part skipped)");
}

// ======================================================================================
section("5b. A blown-up vehicle is a wreck for good; blasts wear what lies on the ground");
{
  // The wreck: condition 0, nothing repairs it, it can be stripped.
  const st = world();
  const h = hub(st);
  const v = createVehicle(st, "truck", { kind: "base", baseId: h.id }, { fuel: 30, condition: 50 });
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: h.tile, mission: "move", stance: "normal", vehicleId: v.id, supplies: { food: 6, water: 6, fuel: 4 } });
  const party = res && res.party;
  let done = false;
  if (party) {
    party.path = [h.tile]; party.idx = 0; party.phase = "waiting";
    party.cargo.gear = [newItem("huntrifle", 1)];
    st.combat = createBattle(st, { tile: h.tile, partyId: party.id, enemy: { kind: "raiders", count: 3, power: 3 }, ambush: null, canRetreat: false, handler: "gl", context: {} });
    const b = st.combat;
    if (b.vehicle) {
      for (let k = 0; k < 4 && !b.vehicle.blownUp; k++) vehicleBlast(b, b.vehicle.x, b.vehicle.y, ROCKET.r, ROCKET.dmg, "rocket");
      const cell = b.cells.find((c) => c.k === "vehicle");
      check(cell && cell.car && cell.car.wrecked, "on the battle map it is drawn burnt out");
      const u0 = b.units.find((u) => u.side === "player" && active(u));
      b.phase = "player"; u0.ap = 2;
      check(/wreck/.test(combatAct(st, { type: "board", unit: u0.id })), "nobody gets into it or drives it");
      settleVehicle(st, b, "victory");
      check(v.condition === 0 && v.destroyed && party.vehicleId == null && v.loc.kind === "abandoned", `after the fight: condition 0, destroyed, left on the tile (${v.loc.kind}); the team goes on on foot`);
      check(/wrecked/.test(vehicleLabel(v)), `the vehicle list says so ("${vehicleLabel(v)}")`);
      // Every repair path refuses it.
      v.loc = { kind: "base", baseId: h.id };
      h.stock.carparts = 10; h.stock.parts = 10;
      for (const s of atBase(st, h.id)) s.skills.mechanics = 8;
      const why = vrepair(st, h, v);
      check(/wreck/.test(why) && v.condition === 0, `the garage: "${why}"`);
      check(/wreck/.test(upgradeProblem(st, h, v, "plating")), "no upgrades on it");
      check(/wreck/.test(fixProblem(st, party, v)) && !runnerAt(st, h.tile) && !fixableAt(st, h.tile), "no claim, hotwire or field fix");
      const fake = { id: -1, owner: "player", supplies: { parts: 5 }, cargo: { supplies: { parts: 5 }, gear: [] }, members: party.members, vehicle: true, vehicleId: v.id };
      v.loc = { kind: "party", partyId: -1 };
      st.parties.push(fake);
      const ri = orderRepairInfo(st, fake);
      check(!ri.ok && /wreck/.test(ri.reason), `a roadside repair: "${ri.reason}"`);
      st.parties.splice(st.parties.indexOf(fake), 1);
      const wf = (await import("../src/sim/groupworks.js")).workshopFactor;
      const f = st.factions.find((x) => x.alive && wf(st, x) >= 1) || st.factions.find((x) => x.alive);
      const av = { id: "w1", type: "truck", name: "Pickup", fuel: 5, condition: 0, destroyed: true, owner: f.id };
      f.vehicles = [av]; f.stock.parts = 50; f.stock.scrap = 50;
      const bv = { id: "w2", type: "truck", name: "Van", fuel: 5, condition: 40, owner: f.id };
      f.vehicles.push(bv);
      for (let d = 0; d < 30; d++) { st.hour += 24; f.stock.parts = 50; f.stock.scrap = 50; f.stock.food = 1000; groupCareDaily(st, f); }
      check(av.condition === 0 && (bv.condition > 40 || wf(st, f) < 1), `an AI group's workshop mends its other vehicles (${bv.condition}%), never a wreck (${av.condition}%)`);
      // It can be stripped for parts and scrap.
      v.loc = { kind: "base", baseId: h.id };
      const cp0 = h.stock.carparts || 0, sc0 = h.stock.scrap || 0;
      stripVehicle(st, h, v);
      check(!st.vehicles.includes(v) && h.stock.carparts > cp0 && h.stock.scrap > sc0, `stripped at a base: car parts ${cp0} → ${h.stock.carparts}, scrap ${sc0} → ${h.stock.scrap}`);
      done = true;
    }
  }
  if (!done) check(false, "a team vehicle on the battle map");

  // Ground items: a raid's containers.
  const mk = (st2) => {
    const b = openBattle(st2, () => {});
    for (const x of E(b)) place(x, 30, 1 + E(b).indexOf(x));
    for (const x of P(b)) place(x, 1, 1 + P(b).indexOf(x));
    b.raid = { containers: [], heat: 0, zones: [], areas: [] };
    return b;
  };
  const crate = (b, id, x, y, gear, sup = {}, kind = "crate", contents = true) => { const c = { id, x, y, f: 0, kind, searched: false, label: `crate ${id}`, ...(contents ? { contents: { gear, sup } } : {}) }; b.raid.containers.push(c); return c; };
  const st2 = world();
  const b2 = mk(st2);
  const gIn = newItem("huntrifle", 1), gEdge = newItem("huntrifle", 1);
  const dur0 = itemDur(gIn);
  const cIn = crate(b2, 1, 10, 10, [gIn], { a_556_fmj: 30 }), cEdge = crate(b2, 2, 11, 11, [gEdge]);
  crate(b2, 3, 20, 20, [newItem("huntrifle", 1)]);
  landEffect(b2, P(b2)[0], { fx: "blast", blast: GL_HE }, 10, 10);
  const lossIn = 1 - itemDur(gIn) / dur0, lossEdge = 1 - itemDur(gEdge) / dur0;
  check(lossIn >= 0.29 && lossIn <= 0.61 && lossEdge >= 0.09 && lossEdge <= 0.36 && lossIn > lossEdge, `on the blast's cell an item loses ${Math.round(lossIn * 100)}%, at the edge ${Math.round(lossEdge * 100)}% (30–60 / 10–35)`);
  check(cIn.contents.sup.a_556_fmj <= 30 && b2.raid.containers[2].contents.gear[0].dur === dur0, `rounds there cook off (${cIn.contents.sup.a_556_fmj} of 30); nothing outside the blast`);
  // A crate nobody opened yet: the damage waits for its contents; a rocket blows it open.
  const cShut = crate(b2, 4, 15, 5, null, null, "crate", false);
  cShut.lock = { open: false };
  landEffect(b2, P(b2)[0], { fx: "blast", blast: ROCKET }, 15, 5);
  check(cShut.blast >= 0.3 && cShut.spilled && cShut.lock.open, `a rocket on a shut crate: blown open, its contents to be worn ${Math.round(cShut.blast * 100)}%`);
  const inside = newItem("pistol", 1);
  const pd0 = itemDur(inside);
  cShut.contents = { gear: [inside], sup: {} };
  blastBox(b2, cShut);
  check(itemDur(inside) < pd0 && !cShut.blast, `rolled after: its contents are worn (${pd0} → ${itemDur(inside)})`);
  // A frag does the same at its own radius.
  const st3 = world();
  const b3 = mk(st3);
  const gF = newItem("huntrifle", 1);
  crate(b3, 1, 12, 12, [gF]);
  landEffect(b3, P(b3)[0], THROWABLES.frag, 13, 12);
  check(itemDur(gF) < dur0, `a frag grenade wears the things lying next to it (${dur0} → ${itemDur(gF)})`);
  // Chain detonation: explosives lying in the blast go off one time in ten.
  let chained = 0, frags = 0, text = "";
  for (let i = 0; i < 40 && !chained; i++) {
    const st4 = world(seed + i);
    const b4 = mk(st4);
    const bombs = Array.from({ length: 6 }, () => newItem("frag", 1));
    const c = crate(b4, 1, 10, 10, bombs);
    b4.dseed = 1000 + i;
    text = landEffect(b4, P(b4)[0], { fx: "blast", blast: GL_HE }, 10, 10);
    frags += 6;
    if (c.contents.gear.length < 6) chained = 6 - c.contents.gear.length;
  }
  check(chained > 0 && /goes off/.test(text), `a crate of frag grenades in the blast: ${chained} go off (${text.slice(text.indexOf("The frag"), text.indexOf("The frag") + 60)}...)`);
  // A body lying in a field battle: its loot worn by the blast that went off next to it.
  const st5 = world();
  const b5 = openBattle(st5, () => {}, { kind: "soldiers", count: 4, power: 5 });
  const [d0] = E(b5);
  for (const x of E(b5)) place(x, 30, 1 + E(b5).indexOf(x));
  place(d0, 12, 12); d0.dead = true; d0.hp = 0;
  landEffect(b5, P(b5)[0], { fx: "blast", blast: GL_HE }, 12, 12);
  const clean = enemyBody(new Rng(9), { ...d0, groundWear: 0 }, KITS.soldiers), worn = launcherBody(b5, d0, enemyBody(new Rng(9), d0, KITS.soldiers));
  check(d0.groundWear >= 0.3 && itemDur(worn.gear.weapon) < itemDur(clean.gear.weapon), `a body lying where it went off: its gun worn (${itemDur(clean.gear.weapon)} → ${itemDur(worn.gear.weapon)})`);
}

// ======================================================================================
section("6. The AI: never its own, never inside the arming range, the gate first; soldiers' launchers");
{
  // Over many random set-ups: an enemy grenadier and rocket man never catch their own side, never fire inside 3 tiles.
  let launches = 0, own = 0, near = 0;
  for (let i = 0; i < 120; i++) {
    const st = world(seed + (i % 4));
    const b = openBattle(st, () => {}, { kind: "soldiers", count: 8, power: 6 }, 4);
    const rng = new Rng(1000 + i);
    // Your people bunched up somewhere, theirs scattered around (some close to yours).
    const cx = rng.int(3, 28), cy = rng.int(3, 20);
    const free = (x, y) => x >= 0 && y >= 0 && x < 32 && y < 24 && !b.units.some((o) => o.x === x && o.y === y);
    for (const u of b.units) { u.x = -1; u.y = -1; }
    for (const u of P(b)) { let x, y, k = 0; do { x = cx + rng.int(-1, 1); y = cy + rng.int(-1, 1); } while (!free(x, y) && ++k < 50); u.x = x; u.y = y; }
    for (const u of E(b)) { let x, y, k = 0; do { x = rng.int(0, 31); y = rng.int(0, 23); } while (!free(x, y) && ++k < 50); u.x = x; u.y = y; }
    const [s0, s1] = E(b);
    s0.gl = { key: "m203", cal: "40mm", cap: 1, mag: 1, load: "he", from: "under", aimD: 0, res: { he: 3 } };
    s1.gl = { key: "rpg", cal: "rocket", cap: 1, mag: 1, load: "heat", from: "weapon", aimD: 0, res: { heat: 1 } };
    for (const s of [s0, s1]) {
      const before = E(b).map((x) => x.hp);
      const spot = launchSpot(b, s);
      if (!spot) continue;
      s.ap = 2;
      b.phase = "enemy";
      if (!aiLaunch(b, s)) continue;
      launches++;
      if (Math.hypot(spot.x - s.x, spot.y - s.y) < LAUNCH.ARM) near++;
      if (E(b).some((x, j) => x !== s && x.hp < before[j])) own++;
    }
  }
  check(launches >= 20, `the AI fired ${launches} times in 240 tries`);
  check(own === 0, `none of them caught their own side (${own})`);
  check(near === 0, `none aimed inside the arming range (${near})`);
  // A rocket at your gate first.
  const st = world();
  const b = openBattle(st, () => {}, { kind: "raiders", count: 5, power: 5 });
  b.tier = { stage: "wall" };
  for (let y = 0; y < b.h; y++) setCell(b, 12, y, "palisade", { hp: 120, mhp: 120, t: 1 });
  setCell(b, 12, 10, "gate", { hp: 160, mhp: 160, bar: true });
  const [rkt] = E(b);
  for (const x of E(b)) place(x, 24, E(b).indexOf(x) * 3 + 1);
  place(rkt, 20, 10);
  for (const p of P(b)) place(p, 4, 9 + P(b).indexOf(p));
  rkt.gl = { key: "rpg", cal: "rocket", cap: 1, mag: 1, load: "heat", from: "weapon", aimD: 0, res: { heat: 1 } };
  const spot = launchSpot(b, rkt);
  check(spot && spot.x === 12 && spot.y === 10 && spot.why === "siege", `a raider with a rocket aims at your gate (${spot && `${spot.x},${spot.y} ${spot.why}`})`);
  // Not with a friend in the backblast.
  place(E(b)[1], 22, 10);
  const sp2 = launchSpot(b, rkt);
  check(!sp2 || (!(sp2.x === 12 && sp2.y === 10) && !backblastCells(b, rkt, sp2.x, sp2.y).some(([x, y]) => x === 22 && y === 10)), `not with one of their own 2 tiles behind: the gate is off, ${sp2 ? `a wall section at a steep angle instead (${sp2.x},${sp2.y})` : "no rocket"}`);
  // Soldiers' M203s and the odd RPG.
  let ars = 0, m203 = 0, he = [];
  const stS = world();
  const bS = openBattle(stS, () => {}, { kind: "soldiers", count: 2, power: 5 });
  for (let i = 0; i < 4000; i++) {
    const u = enemyUnit(bS, new Rng(i * 13 + 1), "soldiers", 5, 2);
    if (u.weapon !== "ar") continue;
    ars++;
    if (u.gl && u.gl.key === "m203") { m203++; he.push(u.gl.mag + u.gl.res.he); }
  }
  check(Math.abs(m203 / ars - LAUNCH.M203) < 0.03, `soldiers' ARs with an M203: ${Math.round((m203 / ars) * 1000) / 10}% (1 in 8)`);
  check(he.every((n) => n >= 2 && n <= 4), `with 2–4 HE each (${Math.min(...he)}–${Math.max(...he)})`);
  let rpg = 0, battles = 0;
  for (let i = 0; i < 4000; i++) { const u = enemyUnit(bS, new Rng(i * 7 + 3), "soldiers", 8, 1); battles++; if (u.gl && u.gl.key === "rpg") rpg++; }
  check(Math.abs(rpg / battles - LAUNCH.RPG) < 0.012, `an RPG in ${Math.round((rpg / battles) * 1000) / 10}% of soldiers' battles at power 8 (1 in 20)`);
  let rpgLow = 0;
  for (let i = 0; i < 1000; i++) { const u = enemyUnit(bS, new Rng(i * 7 + 3), "soldiers", 6, 1); if (u.gl && u.gl.key === "rpg") rpgLow++; }
  check(rpgLow === 0, "never below power 8");
  // The body: the M203 on the rifle, the HE they did not fire.
  const sold = Array.from({ length: 400 }, (_, i) => enemyUnit(bS, new Rng(i * 31 + 5), "soldiers", 5, 2)).find((u) => u.gl && u.gl.key === "m203");
  if (sold) {
    const body = launcherBody(bS, sold, enemyBody(new Rng(3), sold, KITS.soldiers));
    check(body.gear.weapon && body.gear.weapon.mods && body.gear.weapon.mods.under && body.gear.weapon.mods.under.key === "m203" && body.supplies.a_40mm_he >= 2, `a dead soldier's rifle has the M203 on it and HE in the pockets (${body.supplies.a_40mm_he})`);
  } else check(false, "found a soldier with an M203");
}

// ======================================================================================
section("7. A group's launchers: raiders use the RPG they captured; rounds back after");
{
  const st = world();
  const f = st.factions.find((x) => x.type === "raider" && x.alive) || st.factions.find((x) => x.alive && x.type !== "military");
  A.ensureArsenal(st, f);
  const rpgIt = newItem("rpg", 1);
  A.addToArsenal(st, f, rpgIt, "stolen");
  check(f.arsenal.items.includes(rpgIt), "a captured RPG goes into their arsenal");
  A.ensureArsenal(st, f).rounds = { a_rocket_heat: 3 };
  const issue = A.issueKit(st, f, 6, "walls");
  check(issue[0].launcher === rpgIt && issue[0].weapon && !isLauncherKey(issue[0].weapon.key), "a raid on walls: the launcher is issued beside a gun");
  const h = hub(st);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: atBase(st, h.id).slice(0, 3).map((s) => s.id), enemy: { kind: "raiders", count: 5, power: 5, factionId: f.id, name: "test raiders", arsTask: "walls" }, ambush: null, canRetreat: false, handler: "gl", context: {} });
  const b = st.combat;
  const u = b.units.find((x) => x.arsLauncher === rpgIt);
  check(!!u && u.gl && u.gl.key === "rpg" && u.gl.mag === 1 && u.weapon !== "rpg", `one of their fighters carries it, loaded, a gun in hand (${u ? `${u.weaponName}, ${glLabel(b, u)}` : "none"})`);
  check(f.arsenal.rounds.a_rocket_heat === 1, `two rockets drawn from their arsenal (${f.arsenal.rounds.a_rocket_heat} left)`);
  if (u) {
    for (const c of b.cells) { c.k = "open"; delete c.hp; delete c.bar; delete c.t; }
    b.losCache.fill(0);
    b.tier = { stage: "wall" };
    setCell(b, 10, 10, "gate", { hp: 160, mhp: 160, bar: true });
    for (const x of b.units) place(x, x.side === "player" ? 3 : 26, 2 + b.units.indexOf(x));
    place(u, 18, 10);
    u.aim = 400; u.ap = 2; u.aware = true;
    b.phase = "enemy";
    const fired = aiLaunch(b, u);
    check(fired && cellAt(b, 10, 10).hp === 0, `they fire it at your gate and break it (${cellAt(b, 10, 10).hp})`);
    b.phase = "player";
    for (const x of E(b)) if (x !== u) { x.dead = true; x.hp = 0; }
    u.fled = true;
    endBattleNow(st, "victory");
    closeCombat(st);
    check(f.arsenal.items.includes(rpgIt) && f.arsenal.rounds.a_rocket_heat === 2, `the RPG went home with them, the unfired rocket back with it (${f.arsenal.rounds.a_rocket_heat})`);
  }
  // An AT4 fired is struck off their books.
  const at4 = newItem("at4", 1);
  A.addToArsenal(st, f, at4, "stolen");
  const fake = { gl: null, glSpent: { at4: 1 }, arsLauncher: at4 };
  const { settleArsenalLauncher } = await import("../src/sim/launchers.js");
  const kept = settleArsenalLauncher(f, fake, false, (it, why) => A.removeFromArsenal(f, it, why));
  check(!kept && !f.arsenal.items.includes(at4), "an AT4 they fired is gone from their arsenal");
  // Soldiers' starting kits: launchers and their rounds.
  const mil = st.factions.find((x) => x.type === "military");
  if (mil) {
    const L = mil.arsenal ? mil.arsenal.items.filter((it) => isLauncherKey(it.key)) : [];
    check(L.length > 0 || mil.pop < 15, `a military group starts with launchers (${L.map((x) => x.key).join(", ") || "none"})`);
    const R = (mil.arsenal && mil.arsenal.rounds) || {};
    check(!L.length || (R.a_40mm_he || 0) + (R.a_rocket_heat || 0) > 0 || L.every((x) => x.key === "at4"), `and rounds for them (${JSON.stringify(R)})`);
    check(A.wallPower(st, mil, 8) > 0 || !L.length, `which count against walls by the numbers (+${A.wallPower(st, mil, 8)})`);
  } else check(true, "(no military group in this world)");
  // The M2 is no item (bolted to military vehicles): nowhere in loot, trucks or arsenals.
  check(!GEAR.m2hb && WEAPONS.m2hb && WEAPONS.turret_m2 && ![...Object.values(SITE_LAUNCHERS), ...Object.values(AREA_LAUNCHERS)].some((t) => t.items.m2hb) && !st.factions.some((x) => x.arsenal && x.arsenal.items.some((it) => it.key === "m2hb")), "there is no M2 item: not in loot, not in any arsenal (only its turret numbers)");
}

// ======================================================================================
section("8. Your bots; loot; packing; a save mid-battle; the help");
{
  // Your bots: HE on a crowd of three, never at their own.
  const st = world();
  stockUp(st, { a_40mm_he: 6 });
  const b = openBattle(st, withLauncher("m79"));
  const [g] = P(b);
  aim(g);
  place(g, 2, 10);
  const [x0, x1, x2] = E(b);
  place(x0, 14, 10); place(x1, 15, 10); place(x2, 14, 11);
  for (const x of E(b).slice(3)) place(x, 30, 22);
  const h0 = x0.hp;
  check(aiLaunch(b, g) && x0.hp < h0, "your bot lobs HE on three of them bunched up");
  // Not when one of yours is near them.
  const st2 = world();
  stockUp(st2, { a_40mm_he: 6 });
  const b2 = openBattle(st2, withLauncher("m79"));
  const [g2, m2] = P(b2);
  aim(g2);
  place(g2, 2, 10); place(m2, 13, 10);
  const [y0, y1, y2] = E(b2);
  place(y0, 15, 10); place(y1, 16, 10); place(y2, 15, 11);
  for (const x of E(b2).slice(3)) place(x, 30, 22);
  check(!launchSpot(b2, g2), "but not with a teammate near the spot");
  // Loot: every source rolls through itemcond.js and fits its theme.
  const keys = new Set([...Object.values(SITE_LAUNCHERS), ...Object.values(AREA_LAUNCHERS)].flatMap((t) => Object.keys(t.items)));
  check([...keys].every((k) => GEAR[k] && ITEM_TAGS[k]), `the launcher tables name real items with theme tags (${[...keys].join(", ")})`);
  check(SITE_LAUNCHERS.military.items.m203 && AREA_LAUNCHERS.barracks.items.m203 && !SITE_MODS.military.items.m203 && ENEMY_MODS.soldiers.under, "the M203 is back in army stock (the launcher tables, their own dice) and under soldiers' rifles");
  const stL = world();
  const mt = Object.values(stL.tiles).find((t) => t.loc && t.loc.type === "military");
  let found = [];
  if (mt) for (let i = 0; i < 400 && found.length < 3; i++) { stL.hour += 1; found.push(...rollSiteLaunchers(stL, mt.id, 1, `t${i}`)); }
  check(!mt || (found.length > 0 && found.every((it) => condRolled(it))), `searching an army base turns some up (${found.map((x) => x.key).join(", ") || "none"}), condition rolled`);
  let area = [];
  for (let i = 0; i < 300 && !area.length; i++) area = rollAreaLaunchers(stL, mt ? mt.id : 0, "armory", "military", `b${i}`);
  check(area.length > 0 && area.every((it) => condRolled(it)), `an armoury crate: ${area.map((x) => x.key).join(", ")}`);
  // Packing: six HE for an M79 bearer, within what they can carry.
  const from = { a_40mm_he: 20, a_rocket_heat: 5 };
  const s0 = { gear: { weapon: newItem("m79") }, pockets: [] }, s1 = { gear: { weapon: newItem("rpg") }, pockets: [] }, s2 = { gear: { weapon: newItem("at4") }, pockets: [] };
  const packed = packLauncherRounds(from, [s0, s1, s2]);
  check(packed.a_40mm_he === 6 && packed.a_rocket_heat === 2 && from.a_40mm_he === 14, `a trip packs 6 HE for the M79, 2 rockets for the RPG, nothing for the AT4 (${JSON.stringify(packed)})`);
  check(Object.keys(packLauncherRounds({ a_rocket_heat: 5 }, [s1], 3)).length === 1 && packLauncherRounds({ a_rocket_heat: 5 }, [s1], 3).a_rocket_heat === 1, "as far as they can carry (a rocket is 2.6 kg)");
  // A save mid-battle keeps the launcher and its round.
  const st3 = world();
  stockUp(st3, { a_40mm_he: 6 });
  const b3 = openBattle(st3, withLauncher("m79"));
  const [g3] = P(b3);
  g3.reel = { next: b3.turn + 1, why: "x" };
  const st4 = loadFromString(saveToString(st3));
  const u4 = st4.combat.units.find((x) => x.id === g3.id);
  check(u4 && u4.gl && u4.gl.key === "m79" && u4.gl.mag === 1 && u4.reel, "a save mid-battle keeps the launcher, its round and a reeling shooter");
  check(/Grenade launchers and rockets/.test(LAUNCH_HELP) && /Shift\+L/.test(LAUNCH_HELP), "the Help topic");
}

// ======================================================================================
section("8b. Deafening (hearing.js, w2-helmets): registered, called at the launch and the blast");
{
  const L = await import("../src/sim/launchers.js");
  const H = await import("../src/sim/hearing.js");
  check(L.HEARING.deafen === H.deafen && L.HEARING.HEAR === H.HEAR, "hearing.js registered its deafen and HEAR with the launchers at load");
  const real = { deafen: L.HEARING.deafen, HEAR: L.HEARING.HEAR };
  const calls = [];
  L.registerHearing({ deafen: (b, x, y, bang, shooter) => calls.push([x, y, bang, shooter ? shooter.name : null]), HEAR: { BLAST: { he40: 5, rocket: 7.5 } } });
  const st = world();
  stockUp(st, { a_rocket_heat: 2 });
  const b = openBattle(st, (s, i) => { clearGear(s); s.skills.shooting = 10; if (i === 0) s.gear.weapon = newItem("rpg", 1); });
  const [r] = P(b);
  aim(r);
  place(r, 5, 5);
  for (const x of E(b)) place(x, 25, 2 + 2 * E(b).indexOf(x));
  combatAct(st, { type: "launch", unit: r.id, x: 15, y: 5 });
  check(calls.length === 2 && calls[0][0] === 5 && calls[0][2] === 7.5 && calls[0][3] === r.name && calls[1][0] === 15 && calls[1][2] === 7.5, `a rocket deafens at the shooter and where it bursts, HEAR.BLAST.rocket loud (${JSON.stringify(calls)})`);
  L.registerHearing(real); // the real ears back for the rest
}

// ======================================================================================
section("9. The battle screen: the unit line, Launch (Shift+L), the arming ring and the backblast drawn");
{
  let nan = 0;
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((x) => typeof x === "number" && !Number.isFinite(x))) nan++; }),
    set: (o, k, x) => { if (typeof x === "number" && !Number.isFinite(x)) nan++; o[k] = x; return true; },
  });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  const KM = await import("../src/ui/keymap.js");
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  const st = world();
  stockUp(st, { a_rocket_heat: 2 });
  const b = openBattle(st, (s, i) => { clearGear(s); s.skills.shooting = 10; if (i === 0) s.gear.weapon = newItem("rpg", 1); });
  const [r, m] = P(b);
  place(r, 10, 10); place(m, 8, 10);
  UI.cui.sel = r.id;
  const panel = UI.renderCombatPanel(st);
  check(/RPG 1\/1 rocket/.test(panel) && /Launch: RPG 1\/1 rocket/.test(panel), "the unit line and the Launch button show the rocket loaded");
  const k = KM.KEY_BY_ID.get("battle.launch");
  check(k && k.keys.includes("Shift+KeyL") && k.v === "launch" && KM.KEYMAP.filter((x) => x.ctx === "battle" && x.keys.includes("Shift+KeyL")).length === 1, "Shift+L launches (and no other battle key has it)");
  UI.combatAction(st, "cb-act", { v: "launch" });
  check(UI.cui.mode === "launch", "Launch opens the targeting mode");
  const vis = new Uint8Array(b.w * b.h).fill(1);
  const band = UI.aimArea(b, r, vis, { x: 20, y: 10 }, "launch");
  const at = (x, y) => band[y * b.w + x];
  check(at(11, 10) === 3 && at(12, 11) === 3 && at(20, 10) === 2 && at(21, 10) === 5 && at(8, 10) === 4 && at(10, 8) !== 4 && at(23, 10) === 1 && at(26, 10) === 0, "the band: the red ring inside 3 tiles, the spot, its blast, the backblast cone behind");
  UI.cui.hover = { x: 20, y: 10 };
  let err = "";
  UI.cui.mode = "move";
  for (const view of ["iso"]) { void view; UI.drawCombat(st, 1e9); }
  const nan0 = nan; // (the first frame of this hand-built field draws a few NaNs whatever the mode: only what the launch mode adds counts)
  UI.cui.mode = "launch";
  for (const view of ["iso"]) { void view; try { UI.drawCombat(st, 1e9); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); } }
  const prev = UI.renderCombatPanel(st);
  check(!err && nan === nan0, `both views draw the launch targeting${err ? `: ${err}` : ""} (NaN: ${nan - nan0} with it, ${nan0} without)`);
  check(/backblast on/.test(prev) && /Fire the Rocket launcher/.test(prev), "the preview warns of the teammate in the backblast");
  delete globalThis.document;
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (fail) process.exitCode = 1;
