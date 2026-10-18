// Calibre compatibility (2026-10-10, the ar-platform branch: data-ammo.js CAL_ACCEPTS / CAL_REFUSE / KIT_ALT_CAL,
// rounds.js loads "<cal>:<type>", ammo.js gunCalsOf / gunTakes / loadRefusal / loadFx, mags.js magCalsOf / magTakes /
// magLoad, data-kit.js MAGAZINES cals / guns). Checks:
// - the new calibres on the ladder (.38 between 9mm and .357, .223 just under 5.56, .300 BLK between 5.56 and
//   7.62x39), .223 a common round, .38 boxes of 50 (hollow points 20);
// - a 5.56 gun takes .223; a .223-only gun refuses 5.56; a 5.56 (or .223) gun refuses .300 BLK (the dangerous-chamber
//   words); a .300 BLK gun refuses 5.56 and .223; a .357 takes .38 Special, a .38 revolver refuses .357, the gas
//   Magnum pistol .357 only;
// - a STANAG magazine holds all three and fits every AR-15 pattern gun; the AUG, FAL, M14 and SCAR-H each take their
//   own magazines (user: "AUG and FAL mags do not fit in AR platforms"; STANAG mags do not fit the AUG or the FAL);
//   a .308 bolt magazine no .223 bolt rifle;
// - in battle: a 5.56 rifle loaded with .223 fires .223 (its rounds spent, .223's damage and +3 aim), a spare STANAG
//   loaded with .223 swapped in loads .223, one loaded with .300 BLK is never fed to a 5.56 gun, a Reload asking for
//   .300 BLK is refused; a .357 with .38 hits lighter; the HUD shows the calibre loaded;
// - the gun builder offers .223 loads on a 5.56 gun and never .300 BLK; gunStats with .223;
// - a gun's rounds kept on it (gunload.js) of another calibre it takes; by the numbers a 5.56 gunner draws .223;
// - the AI: raiders' 5.56 rifles sometimes carry .223 (own dice), a fight with such loads runs and their bodies drop
//   .223; an old save's AUG with a STANAG fitted gets an AUG magazine.
// Usage: node tools/calcompattest.js [seed]
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const { CALIBERS, CAL_DMG, LADDER, ROUND_ECON, KIT_ALT_CAL } = await import("../src/sim/data-ammo.js");
const { retailBox } = await import("../src/sim/data-stacks.js");
const A = await import("../src/sim/ammo.js");
const R = await import("../src/sim/rounds.js");
const M = await import("../src/sim/mags.js");
const C = await import("../src/sim/combat.js");
const { MAGAZINES } = await import("../src/sim/data-kit.js");
const { createWorld, makeSurvivor, hub } = await import("../src/sim/world.js");
const { newItem } = await import("../src/sim/inventory.js");
const { gunStats } = await import("../src/sim/gunstats.js");
const { platformOf } = await import("../src/sim/gunmods.js");
const { migrateMagFits } = await import("../src/sim/carrykit.js");
const { gunIn } = await import("../src/sim/gunload.js");
const { GEAR } = await import("../src/sim/data.js");

const seed = Number(process.argv[2] || 7);
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
const mid = (d) => (d[0] + d[1]) / 2;

// ---------- the calibres ----------
console.log("The new calibres");
const O = LADDER.ORDER, at = (c) => O.indexOf(c);
check(at("9mm") < at("38spl") && at("38spl") < at("357"), `.38 Special between 9mm and .357 on the ladder (${CAL_DMG["38spl"].join("–")})`);
check(at("223") === at("556") - 1 || (at("223") < at("556") && mid(CAL_DMG["223"]) < mid(CAL_DMG["556"]) && mid(CAL_DMG["556"]) - mid(CAL_DMG["223"]) <= 2), `.223 just under 5.56 (${CAL_DMG["223"].join("–")} vs ${CAL_DMG["556"].join("–")})`);
check(at("556") < at("300blk") && at("300blk") < at("762x39"), `.300 BLK between 5.56 and 7.62×39 (${CAL_DMG["300blk"].join("–")})`);
check(ROUND_ECON["223_fmj"][0] === "common" && ROUND_ECON["556_fmj"][0] === "common", ".223 FMJ is common, like 5.56");
check(CALIBERS["300blk"].types.includes("subsonic") && CALIBERS["300blk"].types.includes("fmj"), ".300 BLK: supersonic (FMJ) and subsonic");
check(retailBox("38spl", "fmj", CALIBERS["38spl"], "pistol") === 50 && retailBox("38spl", "hp", CALIBERS["38spl"], "pistol") === 20, ".38 Special boxes: 50, hollow points 20");
check(GEAR.a_38spl_fmj && GEAR.a_38spl_fmj.dur === 50 && GEAR.a_38spl_hp.dur === 20 && GEAR.a_223_fmj && GEAR.a_300blk_subsonic, "their boxes exist (a_38spl_fmj 50, a_38spl_hp 20, a_223_fmj, a_300blk_subsonic)");
check((CALIBERS["223"].aim || 0) > 0, ".223 shoots straighter (+aim)");

// ---------- guns and calibres ----------
console.log("Which guns take what");
check(A.gunTakes("ar15rifle", "556") && A.gunTakes("ar15rifle", "223"), "a 5.56 AR-15 takes 5.56 and .223");
check(A.gunTakes("m4", "223") && A.gunTakes("lmg", "223") && A.gunTakes("ar", "223"), "every 5.56 gun takes .223 (the M4, the LMG, the assault rifle)");
for (const g of ["ar223", "ranch223", "varmint223", "single223"]) check(A.gunTakes(g, "223") && !A.gunTakes(g, "556") && /too hot/.test(A.calRefusal(g, "556")), `${g} (.223 only) refuses 5.56: "${A.calRefusal(g, "556")}"`);
for (const g of ["ar15rifle", "m4", "ar223", "single556"]) check(!A.gunTakes(g, "300blk") && /blow/.test(A.calRefusal(g, "300blk")), `${g} refuses .300 BLK as dangerous: "${A.calRefusal(g, "300blk")}"`);
for (const g of ["ar300", "sbr300", "single300"]) check(A.gunTakes(g, "300blk") && !A.gunTakes(g, "556") && !A.gunTakes(g, "223"), `${g} takes .300 BLK only`);
check(A.gunTakes("revolver", "38spl") && A.gunTakes("snub357", "38spl") && A.gunTakes("lever357", "38spl"), ".357 revolvers and the lever gun take .38 Special");
check(!A.gunTakes("magnum", "38spl"), "the gas-operated Magnum pistol takes .357 only");
check(!A.gunTakes("snub38", "357") && !A.gunTakes("service38", "357") && /too long/.test(A.calRefusal("snub38", "357")), `a .38 revolver refuses .357: "${A.calRefusal("snub38", "357")}"`);
check(Object.keys(C.WEAPONS).filter((k) => A.gunTakes(k, "38spl")).every((k) => C.WEAPONS[k].cal === "357" || C.WEAPONS[k].cal === "38spl"), ".38 Special in no other guns");
const ars = Object.keys(C.WEAPONS).filter((k) => platformOf(k) === "ar15");
check(["ar15rifle", "ar223", "arpistol", "ar300", "sbr300", "ardmr"].every((k) => ars.includes(k)), `the new AR-pattern guns are the AR-15 platform (${ars.join(", ")})`);
check(["single556", "single223", "single300", "singlerifle"].every((k) => C.WEAPONS[k] && C.WEAPONS[k].cap === 1), "single-shot rifles in .308, 5.56, .223 and .300 BLK");

// ---------- magazines ----------
console.log("Magazines");
for (const c of ["556", "223", "300blk"]) check(M.magTakes("mag_stanag_30", c), `a STANAG magazine holds ${CALIBERS[c].name}`);
check(ars.every((k) => M.magFitsGun(k, "mag_stanag_30")), "a STANAG magazine fits every AR-15 pattern gun (the .223 and .300 BLK ones too)");
check(M.magFitsGun("lmg", "mag_stanag_30"), "and the light machine gun");
const own = { aug: "mag_aug_30", fal: "mag_fal_20", m1a: "mag_m14_20", scarh: "mag_battle_20", ranch223: "mag_mini14_20" };
for (const [g, m] of Object.entries(own)) check(M.standardMag(g) === m, `${g}: its own magazine (${M.standardMag(g)})`);
const augFal = Object.keys(MAGAZINES).filter((k) => /^mag_(aug|fal)_/.test(k));
check(augFal.every((m) => ars.every((g) => !M.magFitsGun(g, m))) && augFal.every((m) => !M.magFitsGun("lmg", m)), `AUG and FAL magazines fit no AR-15 pattern gun (${augFal.join(", ")})`);
const stanags = Object.keys(MAGAZINES).filter((k) => M.magTakes(k, "300blk"));
check(stanags.every((m) => !M.magFitsGun("aug", m) && !M.magFitsGun("fal", m)), `STANAG magazines fit neither the AUG nor the FAL (${stanags.join(", ")})`);
check(["mag_aug_30", "mag_aug_42"].every((m) => M.magFitsGun("aug", m) && !M.magFitsGun("fal", m)), "AUG magazines fit the AUG only");
check(["mag_fal_20", "mag_fal_30"].every((m) => M.magFitsGun("fal", m) && !M.magFitsGun("scarh", m) && !M.magFitsGun("m1a", m) && !M.magFitsGun("aug", m)), "FAL magazines fit the FAL only (not the SCAR-H, the M14, the AUG)");
check(!M.magFitsGun("fal", "mag_battle_20") && !M.magFitsGun("m1a", "mag_battle_20") && M.magFitsGun("scarh", "mag_battle_20"), "the SCAR-H's magazine fits only the SCAR-H");
check(!M.magFitsGun("varmint223", "mag_bolt_5") && M.magFitsGun("huntrifle", "mag_bolt_5"), "a .308 bolt magazine fits no .223 bolt rifle");
check(!M.magFitsGun("ar15rifle", "mag_mini14_20") && M.magFitsGun("ranch223", "mag_mini14_30"), "the ranch rifle's magazines are its own");

// ---------- loads ----------
console.log("Loads");
check(R.typeFor("556", "223:sp") === "223:sp" && R.typeFor("223", "223:sp") === "sp" && R.typeFor("556", "fmj") === "fmj", "loads normalise against their holder's calibre");
check(R.keyFor("556", "223:sp") === "a_223_sp" && R.roundName("556", "223:sp") === ".223 Rem soft point", "a 5.56 gun's .223 load names the .223 round");
check(R.rebaseLoad("556", "223:fmj", "223") === "fmj" && R.rebaseLoad("223", "fmj", "556") === "223:fmj", "a load moves between a magazine and a gun of another calibre");
const lc = (await import("../src/ui/gunbuilder.js")).loadChoices;
const ch = lc(newItem("ar15rifle")).map(([v]) => v);
check(ch.includes("223:sp") && ch.includes("223:fmj") && !ch.some((v) => v.startsWith("300blk")), `the gun builder offers .223 on a 5.56 gun, never .300 BLK (${ch.join(", ")})`);
check(!lc(newItem("ar223")).some(([v]) => v.startsWith("556")), "and no 5.56 on a .223 gun");
const s556 = gunStats({ key: "ar15rifle" }), s223 = gunStats({ key: "ar15rifle", load: "223:fmj" });
check(s223.aim === s556.aim + 3 && mid(s223.dmg) < mid(s556.dmg) && s223.loadCal === "223", `gunStats: .223 in the AR-15: +3 aim, less damage (${s556.dmg.join("–")} → ${s223.dmg.join("–")})`);
const s357 = gunStats({ key: "revolver" }), s38 = gunStats({ key: "revolver", load: "38spl:fmj" });
check(mid(s38.dmg) < mid(s357.dmg) && mid(s38.dmg) > mid(s357.dmg) * 0.75, `a .357 with .38 Special hits a little lighter (${s357.dmg.join("–")} → ${s38.dmg.join("–")})`);
const bad = gunStats({ key: "ar15rifle", load: "300blk:fmj" });
check(bad.loadCal === "556", "gunStats never loads a refused calibre (.300 BLK in a 5.56 gun: its own round)");

// ---------- battle ----------
console.log("Battle");
C.registerCombatHandler("calcompat", () => {});
const state = createWorld({ seed, factionCount: 4 });
function fighter(weapon, load = null) {
  const s = makeSurvivor(state);
  s.skills.shooting = 9; s.traits = []; s.health = 100;
  s.gear.weapon = newItem(weapon);
  if (load) s.gear.weapon.load = load;
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function battle(crew, stock, enemy = { kind: "raiders", count: 2, power: 3 }) {
  const h = hub(state);
  A.setRounds(h.stock, 0);
  Object.assign(h.stock, stock);
  const b = (state.combat = C.createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "calcompat", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0); b.reach.fill(1); b.dark = false; b.night = false; b.phase = "player";
  return b;
}
const unitOf = (b, s) => b.units.find((u) => u.sid === s.id);
{
  const s = fighter("ar15rifle", "223:fmj");
  s.pockets[0] = { ...newItem("mag_stanag_30"), load: "223:sp" }; // a spare STANAG with .223 soft points
  s.pockets[1] = { ...newItem("mag_stanag_30"), load: "300blk:fmj" }; // one with .300 BLK in it
  const b = battle([s], { a_223_fmj: 120, a_223_sp: 60, a_556_fmj: 0, a_300blk_fmj: 60 });
  const u = unitOf(b, s);
  check(u.load === "223:fmj" && A.unitRound(u).cal === "223", `a 5.56 AR-15 loaded with .223 takes the field with it (u.load ${u.load})`);
  check(u.mags.every((m) => !String(m.load).startsWith("300blk")), "the spare STANAG with .300 BLK is never fed to it");
  check(u.mags.some((m) => m.where !== "gun" && m.load === "223:sp"), "the spare with .223 soft points is a spare of .223 soft points");
  const foe = b.units.find((x) => x.side === "enemy");
  foe.x = u.x + 4; foe.y = u.y; foe.dead = false; foe.down = false; foe.aware = true; foe.hp = foe.maxHp = 100000;
  const o223 = C.shotOdds(b, u, foe);
  const was = u.load; u.load = "fmj"; const o556 = C.shotOdds(b, u, foe); u.load = was;
  check(o223.chance >= Math.min(95, o556.chance + 3) && mid(o223.dmg) < mid(o556.dmg), `.223 shoots straighter and lighter than 5.56 from it (${o556.chance}% ${o556.dmg.join("–")} → ${o223.chance}% ${o223.dmg.join("–")})`);
  check(C.shotHit(u).cal === "223" && C.shotHit(u).ammo === "fmj", "its hits are .223 (armour reads them as .223)");
  const inGun = () => (u.stack || []).filter((r) => r.k === "a_223_fmj").reduce((a, r) => a + r.n, 0); // physical rounds (mags.js): the shot comes out of the gun's stack
  const before = inGun();
  C.fire(b, u, foe);
  const after = inGun();
  check(after < before && before > 0, `a shot spends .223 out of the gun (${before} → ${after})`);
  const why = C.reloadRefusal(b, u, "300blk:fmj");
  check(/blow/.test(why), `a Reload asking for .300 BLK is refused: "${why}"`);
  check(!A.loadsFor(b, u).some((x) => x.cal === "300blk") && A.loadsFor(b, u).some((x) => x.type === "223:sp"), "the reload chooser lists .223, never .300 BLK");
  check(!C.reloadRefusal(b, u, "223:sp"), "a Reload with .223 soft points is allowed");
  u.mag = 0; u.ap = 2;
  C.reload(b, u, "223:sp");
  check(u.load === "223:sp" && C.shotHit(u).ammo === "sp" && C.shotHit(u).cal === "223", `the spare loaded with .223 swapped in: it fires .223 soft points (u.load ${u.load})`);
  let hud = null;
  try { hud = (await import("../src/ui/battlehud.js")).weaponInfo(state, b, u); } catch (e) { console.log("  (HUD not loadable here:", e.message, ")"); }
  check(hud && hud.cal === ".223 Rem" && hud.otherCal && hud.load === "sp", `the HUD shows the calibre loaded (${hud && hud.cal} ${hud && hud.loadShort})`);
  state.combat = null;
}
{
  const s = fighter("ar223");
  const b = battle([s], { a_556_fmj: 200, a_223_fmj: 0 });
  const u = unitOf(b, s);
  check(A.unitRound(u).cal === "223" && A.roundsOf(b, u, "*") === 0, "a .223 AR with only 5.56 to hand has nothing it can fire");
  const why = C.reloadRefusal(b, u, "556:fmj");
  check(/too hot/.test(why), `a Reload asking for 5.56 in it is refused: "${why}"`);
  state.combat = null;
}
{
  const s = fighter("ar15rifle");
  const b = battle([s], { a_223_fmj: 90 }); // no 5.56 at all: it takes .223
  const u = unitOf(b, s);
  check(u.load === "223:fmj", `a 5.56 rifle with only .223 to hand loads .223 (${u.load})`);
  state.combat = null;
}
{
  const s = fighter("revolver", "38spl:hp");
  const b = battle([s], { a_38spl_hp: 40, a_357_fmj: 40 });
  const u = unitOf(b, s);
  check(u.load === "38spl:hp" && C.shotHit(u).cal === "38spl", "a .357 revolver loaded with .38 hollow points fires them");
  const s2 = fighter("snub38", "357:fmj");
  const b2 = battle([s2], { a_357_fmj: 40, a_38spl_fmj: 40 });
  const u2 = unitOf(b2, s2);
  check(u2.load === "fmj" && A.unitRound(u2).cal === "38spl", "a .38 revolver set to .357 loads its own .38 instead");
  state.combat = null;
}
// The rounds kept in a gun (gunload.js): .223 in a 5.56 gun come back as its load; in a .300 BLK gun they do not.
{
  const u = { side: "enemy", weapon: "ar15rifle", load: null };
  const n = gunIn({ units: [], pools: [] }, u, { key: "ar15rifle", loaded: { n: 12, key: "a_223_fmj" } });
  check(n === 12 && u.load === "223:fmj", "a 5.56 gun with .223 kept in it is loaded with .223");
  const u2 = { side: "enemy", weapon: "ar300", load: null };
  gunIn({ units: [], pools: [] }, u2, { key: "ar300", loaded: { n: 12, key: "a_556_fmj" } });
  check(u2.load == null, "5.56 kept in a .300 BLK gun is never its load");
}
// By the numbers: a 5.56 gunner draws .223 when the 5.56 is gone; a .223 gunner never draws 5.56.
{
  const rec = { a_223_fmj: 10, a_556_fmj: 0 };
  const g = A.drawShots(rec, [{ gear: { weapon: { key: "ar15rifle" } } }], 6);
  check(g.n === 6 && rec.a_223_fmj === 4, "by the numbers a 5.56 gunner fires .223");
  const rec2 = { a_556_fmj: 10 };
  const g2 = A.drawShots(rec2, [{ gear: { weapon: { key: "ar223" } } }], 6);
  check(g2.n === 0 && rec2.a_556_fmj === 10, "a .223 gunner never fires 5.56");
  const cals = A.gunCals([{ gear: { weapon: { key: "ar15rifle" } } }]);
  check(cals["556"] > 0 && cals["223"] === 0 && A.mixForCals(cals).a_556_fmj && !A.mixForCals(cals).a_223_fmj, "generic ammo for a 5.56 gun becomes 5.56; its .223 counts as usable");
  check(A.usableIn({ a_223_fmj: 30 }, cals) === 30, "rounds at hand: .223 counts for a 5.56 gun");
}

// ---------- the AI ----------
console.log("The AI");
{
  let alt = 0, n = 400;
  for (let i = 0; i < n; i++) { const l = A.enemyLoad("raiders", "ar15rifle", seed, i); if (String(l).startsWith("223:")) alt++; if (A.loadRefusal("ar15rifle", l)) alt = -1e9; }
  check(alt > n * KIT_ALT_CAL.raiders["223"] * 0.6 && alt < n * KIT_ALT_CAL.raiders["223"] * 1.4, `raiders' 5.56 rifles carry .223 now and then (${alt} of ${n}), never a refused round`);
  let a38 = 0;
  for (let i = 0; i < n; i++) if (String(A.enemyLoad("survivors", "revolver", seed, i)).startsWith("38spl:")) a38++;
  check(a38 > 0, `survivors' .357 revolvers carry .38 now and then (${a38} of ${n})`);
  check([...Array(200)].every((_, i) => !String(A.enemyLoad("soldiers", "m4", seed, i)).includes(":")), "soldiers' rifles keep 5.56");
  // A fight where the raiders carry AR-15s with .223 and .38 revolvers: it runs, and their bodies drop .223.
  const s = fighter("ar15rifle");
  const b = battle([s], { a_556_fmj: 300 }, { kind: "raiders", count: 4, power: 4 });
  const foes = b.units.filter((x) => x.side === "enemy");
  foes.forEach((f, i) => { f.weapon = i % 2 ? "service38" : "ar15rifle"; f.weaponName = C.WEAPONS[f.weapon].name; f.load = i % 2 ? "fmj" : "223:fmj"; f.mag = null; C.loadMag(f); f.mags = null; f.magsW = null; M.enemyMags(f, C.magMaxOf(f), 2, false); f.aware = true; });
  let ok = true;
  try { for (let t = 0; t < 6 && !b.over; t++) { C.endPlayerTurn(state); if (state.combat !== b) break; } } catch (e) { ok = false; console.log("   ", e.stack); }
  check(ok, "a fight with enemies loaded with .223 and .38 runs");
  check(foes.every((f) => f.weapon !== "ar15rifle" || !f.mags || f.mags.every((m) => m.load === "223:fmj")), "their spare magazines hold their .223");
  const dead = foes.find((f) => f.weapon === "ar15rifle");
  const drop = A.bodyRounds(dead, 10);
  check(drop.a_223_fmj === 10, `a raider's body drops the .223 it fought with (${JSON.stringify(drop)})`);
  state.combat = null;
}

// ---------- an old save ----------
console.log("An old save");
{
  const aug = newItem("aug"); aug.mods = { mag: { ...newItem("mag_stanag_30") } };
  const fal = newItem("fal"); fal.mods = { mag: { ...newItem("mag_battle_20") } };
  const ar = newItem("m4"); ar.mods = { mag: { ...newItem("mag_stanag_40") } };
  const st = { survivors: [], bases: [{ armory: [aug, fal, ar] }] };
  migrateMagFits(st);
  check(aug.mods.mag.key === "mag_aug_30" && fal.mods.mag.key === "mag_fal_20" && ar.mods.mag.key === "mag_stanag_40" && st.magFitV === 1, `an AUG's STANAG becomes an AUG magazine, a FAL's SCAR-H magazine a FAL one, an M4 keeps its STANAG (${aug.mods.mag.key}, ${fal.mods.mag.key})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
