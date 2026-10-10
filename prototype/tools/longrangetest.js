// Long guns, bipods and shooting from a moving vehicle (user requests 2026-10-08, branch bal-guns):
//   - light rounds at range (gunmods.js ROUND_REACH, modRange, combat.js shotOdds): a 5.56 / 7.62×39 / .22 round drops
//     past its reach whatever the sight, no part pushes the best range past it; the hunting rifle, the marksman and
//     sniper rifles beat a scoped AR-15, AK or carbine at 15 and 20 tiles; the Sniper perk does not cover the drop;
//     gunStats shows the reach; the odds' notes say why
//   - past the reach a hit does ×0.85 (G3); pistol rounds reach 8 tiles (G6)
//   - a scope hunts better (hunting.js SCOPE_HUNT): any magnifying sight fitted, not a red dot; the hunting rifle's own
//     scope is in its numbers (1, as before: G4), an override (the sniper rifle) left alone
//   - bipods (combat.js restCell, gunmods.js situationalAim, gunfire.js braceAim): +8 only rested on half cover next
//     to the shooter in the shot's line (standing still alone: nothing); not behind, not on full cover, not on a crate
//     below a walkway; the built-in bipods (machine gun, .50) the same; enemies the same, and a post scored from where
//     it would stand (the AI's scoreCell path) counts its rest; a wall shot over (a palisade from its walkway, a
//     barricade) is a rest too (G1); the autopilot rates a bipod a quarter of its +8 (G5)
//   - firing from a vehicle that moved this turn (combat.js rideAim, RIDE): the turret's gunner −10 after another
//     drove, −25 when they turned it themselves, the turret's overwatch in the other side's turn right after −10 too
//     (G2), nothing the turn after; the odds' notes;
//     the mark survives save / load
// Usage: node tools/longrangetest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, shotOdds, makeLosCache, restCell, rideAim, RIDE, driveTo, turnVehicle, manTurret, floodReach } from "../src/sim/combat.js";
import { newItem } from "../src/sim/inventory.js";
import { fitMod, gunMods, modRange, ROUND_REACH, hasScope, isScope, situationalAim, modScore, MOD_SCORE } from "../src/sim/gunmods.js";
import { gunStats } from "../src/sim/gunstats.js";
import { huntWeaponInfo, SCOPE_HUNT, HUNT_CAT } from "../src/sim/hunting.js";
import { WEAPONS } from "../src/sim/combat.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
registerCombatHandler("lr", () => {});
const st = createWorld({ seed, factionCount: 8 }); st.started = true;
const h = hub(st);
const s = atBase(st, h.id)[0];
const gunWith = (key, ...mods) => { const g = newItem(key); for (const m of mods) fitMod(g, newItem(m)); return g; };
// A battle with s holding gun, on an open map w × hh (the units' guns and parts as playerUnit set them).
function battle(gun, w = 30, hh = 7) {
  s.gear.weapon = gun;
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [s.id], enemy: { kind: "raiders", count: 1, power: 3, name: "Test" }, ambush: "player", canRetreat: false, handler: "lr", context: {} });
  const b = st.combat;
  b.w = w; b.h = hh;
  b.cells = Array.from({ length: w * hh }, () => ({ k: "open" }));
  b.losCache = makeLosCache(w, hh);
  floodReach(b, 0, 0);
  const u = b.units.find((x) => x.side === "player"), t = b.units.find((x) => x.side === "enemy");
  u.aim = 65; u.mode = "single"; u.movedT = b.turn - 1; u.noFall = false;
  t.aware = true; t.hunker = false;
  return { b, u, t };
}
const at = (b, x, y) => b.cells[y * b.w + x];
const odds = (gun, d) => { const { b, u, t } = battle(gun); u.x = 0; u.y = 3; t.x = d; t.y = 3; return shotOdds(b, u, t); };
const ev = (o) => (o.chance / 100) * ((o.dmg[0] + o.dmg[1]) / 2) * (1 + o.crit / 100);

// 1. Light rounds at range.
{
  console.log("Light rounds at range");
  check(ROUND_REACH["556"] && ROUND_REACH["762x39"] && !ROUND_REACH["308"] && !ROUND_REACH["3030"] && !ROUND_REACH["50bmg"], "5.56 and 7.62×39 have a reach; .308, .30-30 and .50 none");
  const acog = gunMods(gunWith("ar", "acog"));
  check(modRange(WEAPONS.ar, acog).opt === ROUND_REACH["556"].reach && modRange(WEAPONS.dmr, gunMods(gunWith("dmr", "acog"))).opt === WEAPONS.dmr.opt + 3, `an ACOG takes the AR-15 to its round's reach (${modRange(WEAPONS.ar, acog).opt} tiles), a marksman rifle the full +3`);
  check(gunStats(gunWith("ar", "acog")).opt === 10 && gunStats(gunWith("ar")).reach === 10 && gunStats(gunWith("ar")).drop === 2 && gunStats(gunWith("huntrifle")).reach == null, "the gun builder's numbers: best range 10, reach 10 (−2 a tile); the hunting rifle no reach");
  const hr = (d) => odds(gunWith("huntrifle"), d), arA = (d) => odds(gunWith("ar", "acog"), d), ak = (d) => odds(gunWith("ak", "sidemount", "acog"), d), cb = (d) => odds(gunWith("carbine", "acog"), d), ar = (d) => odds(gunWith("ar"), d);
  check(arA(10).chance === 79 && ar(10).chance === 70, `inside the reach nothing changes (AR-15 + ACOG ${arA(10).chance}% at 10 tiles, bare ${ar(10).chance}%)`);
  for (const d of [15, 20]) {
    const H = hr(d), rivals = [["AR-15 + ACOG", arA(d)], ["AK + ACOG", ak(d)], ["carbine + ACOG", cb(d)], ["bare AR-15", ar(d)]];
    check(rivals.every(([, o]) => o.chance < H.chance && ev(o) < ev(H)), `at ${d} tiles the hunting rifle (${H.chance}%, ${ev(H).toFixed(1)} a shot) beats ${rivals.map(([n, o]) => `${n} ${o.chance}% / ${ev(o).toFixed(1)}`).join(", ")}`);
    const D = odds(gunWith("dmr", "acog"), d), S = odds(gunWith("sniper"), d);
    check(D.chance > H.chance && S.chance > H.chance, `the marksman (${D.chance}%) and sniper rifles (${S.chance}%) better still at ${d}`);
  }
  check(H15drop(), "the odds' notes say the round drops");
  function H15drop() { const o = arA(15); return o.notes.some((n) => /drops past 10/.test(n)) && !hr(15).notes.some((n) => /drops/.test(n)); }
  // The Sniper perk: no fall-off, but the drop stays.
  const { b, u, t } = battle(gunWith("ar", "acog"));
  u.x = 0; u.y = 3; t.x = 20; t.y = 3;
  u.noFall = true;
  const perk = shotOdds(b, u, t).chance;
  check(perk === 79 - 20, `the Sniper perk drops the fall-off, not the round's drop (${perk}% at 20 tiles)`);
  // A match round reaches a tile further.
  u.noFall = false; u.load = "match";
  const m = shotOdds(b, u, t);
  check(m.notes.some((n) => /past 11 tiles/.test(n)), `a match round's reach is 11 tiles (${m.notes.join(", ")})`);
  // G3: past the reach a hit does less.
  const in10 = arA(10), out15 = arA(15);
  check(out15.dmg[0] === Math.round(in10.dmg[0] * ROUND_REACH["556"].dmg) && out15.dmg[1] === Math.round(in10.dmg[1] * ROUND_REACH["556"].dmg) && hr(15).dmg.join() === hr(10).dmg.join() && out15.notes.some((n) => /damage ×0.85/.test(n)), `a 5.56 hit past 10 tiles: ${in10.dmg.join("–")} → ${out15.dmg.join("–")}; the hunting rifle's ${hr(15).dmg.join("–")} either way`);
  // G6: pistol rounds reach 8 tiles.
  const p8 = odds(gunWith("pistol"), 8), p12 = odds(gunWith("pistol"), 12), rv12 = odds(gunWith("revolver"), 12);
  check(ROUND_REACH["9mm"].reach === 8 && !p8.notes.length && p12.notes.some((n) => /past 8 tiles/.test(n)) && rv12.notes.some((n) => /past 8 tiles/.test(n)) && p12.dmg[1] < p8.dmg[1], `pistol rounds drop past 8 tiles (9mm ${p8.chance}% at 8, ${p12.chance}% at 12; the .357 too)`);
  const smg = gunWith("smg", "scopemount", "scrapscope");
  check(modRange(WEAPONS.smg, gunMods(smg)).opt === 8, "a scrap scope on the SMG: best range 8, not 9");
}

// 2. A scope hunts better.
{
  console.log("Scopes on a hunt");
  check(isScope("acog") && isScope("scope4x") && isScope("tacscope") && isScope("scrapscope") && !isScope("reddot") && !isScope("holo") && !isScope("precision"), "a scope magnifies (ACOG, 4×, tactical, scrap); a red dot, a holo sight and a stock do not");
  const ar = huntWeaponInfo(gunWith("ar")), arS = huntWeaponInfo(gunWith("ar", "acog")), arD = huntWeaponInfo(gunWith("ar", "reddot"));
  check(near(arS.big, HUNT_CAT.automatic.big * SCOPE_HUNT.big) && near(arS.small, HUNT_CAT.automatic.small * SCOPE_HUNT.small) && near(ar.big, HUNT_CAT.automatic.big) && near(arD.big, ar.big) && arS.scoped && !arD.scoped, `an AR-15 with an ACOG hunts deer at ${arS.big.toFixed(3)} (bare ${ar.big}, a red dot ${arD.big})`);
  const hr = huntWeaponInfo(gunWith("huntrifle")), lv = huntWeaponInfo(gunWith("leverrifle")), lvS = huntWeaponInfo(gunWith("leverrifle", "scopemount", "scope4x"));
  check(hasScope(gunWith("leverrifle", "scopemount", "scope4x")) && hr.big === HUNT_CAT.rifle.big && hr.small === HUNT_CAT.rifle.small && hr.scoped && (() => { const g = newItem("huntrifle"); delete g.mods; const b = huntWeaponInfo(g); return b.big < hr.big && !b.scoped; })() && near(lv.big, 1) && near(lvS.big, SCOPE_HUNT.big), `the hunting rifle as before with its scope, a part since 2026-10-10 (${hr.big} / ${hr.small}: its numbers have it in; without it less); a lever-action ${lv.big}, with a 4× scope ${lvS.big.toFixed(2)}`);
  const sn = huntWeaponInfo(gunWith("sniper"));
  check(sn.big === 1.25 && sn.small === 0.4 && !sn.scoped, "the sniper rifle's own numbers already count its scope (1.25 / 0.4)");
}

// 3. Bipods: rested on half cover next to the shooter in the shot's line.
{
  console.log("Bipods");
  const { b, u, t } = battle(gunWith("huntrifle", "bipod"));
  u.x = 5; u.y = 3; t.x = 13; t.y = 3;
  const open = shotOdds(b, u, t).chance;
  check(situationalAim(b, u, 8) === 0 && !shotOdds(b, u, t).notes.length, `standing still in the open: no bipod bonus (${open}%)`);
  at(b, 6, 3).k = "sandbag"; b.losCache.fill(0);
  const rested = shotOdds(b, u, t);
  check(rested.chance - open === 8 && rested.notes.some((n) => /bipod rested \+8/.test(n)), `sandbags right in front: +8 (${open}% → ${rested.chance}%; "${rested.notes.join(", ")}")`);
  u.movedT = b.turn;
  check(shotOdds(b, u, t).chance === rested.chance, "moving first does not matter: the rest is what counts");
  u.movedT = b.turn - 1;
  at(b, 6, 3).k = "open"; at(b, 4, 3).k = "sandbag"; at(b, 5, 2).k = "crate"; b.losCache.fill(0);
  check(shotOdds(b, u, t).chance === open, "half cover behind or beside the shooter, off the line: nothing");
  at(b, 4, 3).k = "open"; at(b, 5, 2).k = "open";
  at(b, 6, 4).k = "crate"; b.losCache.fill(0);
  check(!!restCell(b, 5, 3, 11, 6) && restCell(b, 5, 3, 11, 6).join() === "6,4" && !restCell(b, 5, 3, 11, 3), "a diagonal shot rests on the cell it crosses (6,4); a straight one does not");
  at(b, 6, 4).k = "open";
  at(b, 6, 3).k = "boulder"; b.losCache.fill(0);
  check(!restCell(b, 5, 3, 13, 3), "full cover (a boulder) is not a rest");
  at(b, 6, 3).k = "sandbag";
  at(b, 5, 3).h = 1; // the shooter up on a walkway, the sandbags down below
  check(!restCell(b, 5, 3, 13, 3), "a crate or sandbags below a shooter on a walkway: no rest");
  // G1: a wall shot over is a rest: the palisade from the walkway behind it, a barricade on the ground; not a boulder.
  at(b, 6, 3).k = "palisade";
  check(!!restCell(b, 5, 3, 13, 3), "the palisade from its walkway: a rest");
  delete at(b, 5, 3).h;
  at(b, 6, 3).k = "barricade";
  check(!!restCell(b, 5, 3, 13, 3), "a barricade on the ground: a rest");
  at(b, 6, 3).k = "boulder";
  check(!restCell(b, 5, 3, 13, 3), "a boulder (blocks sight): no rest");
  at(b, 6, 3).k = "sandbag";
  // G5: the autopilot rates a bipod at a quarter of its +8.
  check(modScore("bipod") === MOD_SCORE.rest * 8 && MOD_SCORE.rest === 0.25, `the autopilot's worth of a bipod: ${modScore("bipod")} (was 4)`);
  // The AI scores a post from where it would stand (scoreCell calls shotOdds from that cell): the rest counts there.
  t.x = 13; t.y = 3; u.x = 1; u.y = 1; b.losCache.fill(0);
  const fromPost = shotOdds(b, u, t, 5, 3).chance, fromOpen = shotOdds(b, u, t, 5, 5).chance;
  check(fromPost - fromOpen === 8, `scoring a post behind sandbags (from elsewhere): +8 over one in the open (${fromOpen}% → ${fromPost}%)`);
  // Enemies: the same rule (a militia rifleman with a bipod).
  u.x = 13; u.y = 3; t.x = 5; t.y = 3;
  t.weapon = "huntrifle"; t.gm = gunMods(gunWith("huntrifle", "bipod")); t.gmWeapon = "huntrifle"; t.movedT = b.turn - 1; t.aim = 50; u.aware = true;
  at(b, 6, 3).k = "open"; b.losCache.fill(0);
  const eOpen = shotOdds(b, t, u).chance;
  at(b, 6, 3).k = "sandbag"; b.losCache.fill(0);
  check(shotOdds(b, t, u).chance - eOpen === 8, `an enemy's bipod: +8 only rested (${eOpen}% → ${shotOdds(b, t, u).chance}%)`);
  // Built in: the machine gun and the .50.
  for (const key of ["lmg", "amr"]) {
    const x = battle(gunWith(key));
    x.u.x = 5; x.u.y = 3; x.t.x = 12; x.t.y = 3; x.u.aim = 40;
    const a = shotOdds(x.b, x.u, x.t).chance;
    at(x.b, 6, 3).k = "sandbag"; x.b.losCache.fill(0);
    check(shotOdds(x.b, x.u, x.t).chance - a === 8, `the ${WEAPONS[key].name}'s built-in bipod: +8 only rested (${a}% → ${shotOdds(x.b, x.u, x.t).chance}%)`);
  }
}

// 4. Firing from a vehicle that moved this turn.
{
  console.log("Shooting from a moving vehicle");
  const { b, u: g, t } = battle(gunWith("huntrifle"), 30, 12);
  // The team's car with an M2 on its roof, two aboard (g mans the gun, r drives).
  const v = { x: 2, y: 2, w: 2, h: 3, ax: "y", kind: "hummer", up: { turret: { gun: "m2hb" } } };
  b.vehicle = v;
  for (let y = v.y; y < v.y + v.h; y++) for (let x = v.x; x < v.x + v.w; x++) at(b, x, y).k = "vehicle", at(b, x, y).car = { ax: "y", i: y - v.y, j: x - v.x };
  b.losCache.fill(0); floodReach(b, 0, 0);
  const r = { ...g, id: 999991, name: "Driver", aboard: true, off: true, x: v.x, y: v.y, ap: 2 };
  b.units.push(r);
  g.aboard = true; g.off = true; g.ap = 2;
  b.phase = "player";
  check(!manTurret(b, g) && g.gunner, "a rider mans the turret");
  t.x = 20; t.y = 3; t.aware = true;
  const still = shotOdds(b, g, t).chance;
  check(rideAim(b, g) === 0, `parked: no penalty (${still}%)`);
  const err = driveTo(b, r, 6, 5);
  const moving = shotOdds(b, g, t), mk = v.movedK;
  v.movedK = null; const parked = shotOdds(b, g, t).chance; v.movedK = mk; // the same spot, not moved this turn
  check(!err && v.movedK != null && parked - moving.chance === RIDE.TURRET && moving.notes.some((n) => /vehicle moving -10/.test(n)), `after another rider drove it: the turret −${RIDE.TURRET} (${parked}% → ${moving.chance}%; "${moving.notes.join(", ")}")${err ? ` [${err}]` : ""}`);
  check(rideAim(b, r) === -RIDE.DRIVER, `the driver (were they to shoot): −${RIDE.DRIVER}`);
  const save = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const b2 = save.combat, g2 = b2 && b2.units.find((x) => x.id === g.id);
  check(!!g2 && b2.vehicle.movedK === v.movedK && rideAim(b2, g2) === -RIDE.TURRET, "the mark survives save / load");
  b.phase = "enemy";
  check(rideAim(b, g) === -RIDE.TURRET && rideAim(b, r) === 0, "the turret's overwatch in the enemy's turn right after: −10 too (G2)");
  b.phase = "player"; b.turn += 1;
  check(rideAim(b, g) === 0, "next turn: nothing");
  g.ap = 2;
  const terr = turnVehicle(b, g);
  check(!terr && rideAim(b, g) === -RIDE.DRIVER && g.gunner, `a gunner who turned it from the turret (the turn is no longer refused with the turret manned): −${RIDE.DRIVER}${terr ? ` [${terr}]` : ""}`);
  check(rideAim(b, r) === -RIDE.RIDER, `a rider who did nothing: −${RIDE.RIDER}`);
  // The enemy's Humvee: the same rule for their gunner.
  b.raidHumvee = { x: 20, y: 8, w: 2, h: 3, movedK: (b.turn || 0) * 2 + 1 };
  const eg = { side: "enemy", gunner: true };
  b.phase = "enemy";
  check(rideAim(b, eg) === -RIDE.TURRET, "their gunner on a Humvee that moved in their turn: the same −10");
  b.phase = "player"; b.turn += 1;
  check(rideAim(b, eg) === -RIDE.TURRET, "and on overwatch in your turn right after");
}

console.log(`\n${fail ? "FAILED" : "passed"}: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
