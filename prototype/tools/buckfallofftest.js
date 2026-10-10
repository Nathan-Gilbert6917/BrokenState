// Buckshot loses damage at range (user requests 2026-10-10: "Make buckshot lose damage at range. Today range only lowers
// the hit chance."; then: full damage to 6 tiles, −10% a tile, a 40% floor, but never below a .22's hit; a choke adds
// tiles; the 40 mm canister the same). data-ammo.js AMMO_TYPES buck / bird carry spreadFull / spreadDrop / spreadMin,
// SPREAD_FLOOR the round no shot hits under (.22 FMJ), spreadFloor / spreadMult work the × out; combat.js shotOdds
// (every gun shot's damage, the battle HUD's numbers), launchers.js (the 40 mm canister) and ladder.js hitDamage (the
// tests, the balance sheet) all use it. Checks:
// - 12 ga 00 buckshot: full damage to 6 tiles, × 0.8 at 8, 0.6 at 10, then its floor, a .22's hit over its own (14 of 30,
//   0.47); 20 ga buckshot the same curve to its higher floor (14 of 25, 0.56); birdshot full to 5, −12% a tile, its floor
//   a .22's hit (12 ga 0.78, 20 ga 0.93); no spread load's hit is ever under a .22 FMJ hit; slugs and bullets keep theirs;
// - a choke adds its tiles (data: the part's spread; IC +1, full +2, turkey +3), in the battle too;
// - the 40 mm canister: the same curve, its floor a .22's hit over its own mean;
// - the battle's own numbers (shotOdds, a real unit with a pump, a double, a 20 ga and a rifle on a real battle map)
//   equal the ladder's at 2 / 4 / 6 / 8 / 10 / 12 tiles, and the odds line says the shot spreads;
// - the balance sheet's columns (ladder.js far) match;
// - the battle HUD's target card shows the lower damage range far off than near.
// Usage: node tools/buckfallofftest.js
import { AMMO_TYPES, CALIBERS, spreadMult, spreadFloor, SPREAD_FLOOR } from "../src/sim/data-ammo.js";
import { hitDamage, gunHit, ladderRows, FAR } from "../src/sim/ladder.js";
import { WEAPONS, createBattle, registerCombatHandler, shotOdds } from "../src/sim/combat.js";
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { newItem } from "../src/sim/inventory.js";
import { NO_MODS, ATTACH } from "../src/sim/gunmods.js";
import { LAUNCH } from "../src/sim/launchers.js";

let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const D = [2, 4, 6, 8, 10, 12];
const f2 = (v) => v.toFixed(2);

// ---------- the curve ----------
console.log("The fall-off curve (data-ammo.js spreadMult, spreadFloor)");
const low = hitDamage(SPREAD_FLOOR.cal, SPREAD_FLOOR.type);
const curve = (type, cal) => D.map((d) => spreadMult(type, d, { cal }));
for (const [type, cal] of [["buck", "12ga"], ["buck", "20ga"], ["bird", "12ga"], ["bird", "20ga"]]) console.log(`  ${CALIBERS[cal].name} ${AMMO_TYPES[type].name} at ${D.join(" / ")} tiles: ${curve(type, cal).map(f2).join(" / ")} (floor ${f2(spreadFloor(type, cal))})`);
const b12 = curve("buck", "12ga"), b20 = curve("buck", "20ga");
check(AMMO_TYPES.buck.spreadFull === 6 && AMMO_TYPES.buck.spreadDrop === 0.1 && AMMO_TYPES.buck.spreadMin === 0.4, "00 buckshot: full to 6 tiles, −10% a tile, floor 40% (data: AMMO_TYPES buck)");
check([1, 1, 1, 0.8, 0.6].every((v, i) => near(b12[i], v)) && near(b12[5], low / 30) && near(spreadFloor("buck", "12ga"), 14 / 30), `12 ga buckshot: 1 / 1 / 1 / 0.8 / 0.6, then a .22's hit over its own (${f2(14 / 30)})`);
check(near(b20[4], 0.6) && near(spreadFloor("buck", "20ga"), 14 / 25) && near(b20[5], 14 / 25), `20 ga buckshot: the same curve to its higher floor (${f2(14 / 25)})`);
check(near(spreadMult("buck", 30, { cal: "12ga" }), 14 / 30) && near(spreadMult("buck", 30), 0.4), "far off: the floor (a load of no calibre named: spreadMin)");
check(AMMO_TYPES.bird.spreadFull === 5 && near(spreadMult("bird", 6, { cal: "12ga" }), 0.88) && near(spreadFloor("bird", "12ga"), 14 / 18) && near(spreadFloor("bird", "20ga"), 14 / 15), "birdshot: full to 5, −12% a tile, its floor a .22's hit (12 ga 0.78, 20 ga 0.93)");
const spreadLoads = Object.keys(CALIBERS).filter((c) => CALIBERS[c].dmg).flatMap((c) => CALIBERS[c].types.filter((t) => AMMO_TYPES[t].spreadFull != null).map((t) => [c, t]));
check(spreadLoads.length >= 4 && spreadLoads.every(([c, t]) => [8, 10, 15, 20, 40].every((d) => hitDamage(c, t, null, { dist: d }) >= low - 1e-9)), `no buckshot or birdshot hit is ever under a .22 FMJ's (${low.toFixed(1)}): ${spreadLoads.map(([c, t]) => `${c} ${t}`).join(", ")}`);
check(D.every((d, i) => i === 0 || b12[i] <= b12[i - 1]), "never more damage further off");
check(["slug", "fmj", "sp", "ap", "ball", "hp", "match", "beanbag", "rubber"].every((t) => D.concat([20, 40]).every((d) => spreadMult(t, d, { cal: "12ga" }) === 1)), "slugs and bullets (and the less-lethal rounds) keep their damage at every range");
check(spreadMult(null, 10) === 1 && spreadMult("buck", 0) === 1, "no type, point blank: 1");

// ---------- chokes ----------
console.log("Chokes (a part's spread: + tiles of full damage)");
check(ATTACH.icchoke.spread === 1 && ATTACH.choke.spread === 2 && ATTACH.turkeychoke.spread === 3, "the improved cylinder +1, the full choke +2, the turkey choke +3 (by its tightness)");
check(near(spreadMult("buck", 8, { cal: "12ga", extra: 2 }), 1) && near(spreadMult("buck", 9, { cal: "12ga", extra: 3 }), 1) && near(spreadMult("buck", 10, { cal: "12ga", extra: 2 }), 0.8), "a full choke: full damage to 8 tiles, 0.8 at 10; a turkey choke to 9");

// ---------- the 40 mm canister ----------
console.log("The 40 mm canister (launchers.js)");
const bm = (LAUNCH.BUCK.dmg[0] + LAUNCH.BUCK.dmg[1]) / 2;
check(near(spreadMult("buck", 4, { base: bm }), 1) && near(spreadMult("buck", 8, { base: bm }), 0.8) && near(spreadMult("buck", 20, { base: bm }), Math.max(0.4, low / bm)), `its buckshot the same curve: 1 to 6 tiles, 0.8 at 8 (its range ${LAUNCH.BUCK.range}), its floor ${f2(Math.max(0.4, low / bm))}`);

// ---------- the ladder ----------
console.log("ladder.js (the tests and the balance sheet)");
for (const cal of ["12ga", "20ga"]) {
  const h = D.map((d) => hitDamage(cal, "buck", null, { dist: d }));
  console.log(`  ${CALIBERS[cal].name} buckshot, mean hit unarmoured at ${D.join(" / ")}: ${h.map((v) => v.toFixed(1)).join(" / ")}; slug ${D.map((d) => hitDamage(cal, "slug", null, { dist: d }).toFixed(1)).join(" / ")}`);
  check(D.every((d, i) => near(h[i], hitDamage(cal, "buck") * curve("buck", cal)[i], 1e-9)), `${CALIBERS[cal].name} buckshot: its hit × the curve`);
  check(D.every((d) => near(hitDamage(cal, "slug", null, { dist: d }), hitDamage(cal, "slug"))), `${CALIBERS[cal].name} slug: the same hit at every range`);
}
check(hitDamage("12ga", "buck", { ac: 2, cond: 1 }, { dist: 9 }) < hitDamage("12ga", "buck", { ac: 2, cond: 1 }), "on a vest too");
check(near(hitDamage("308", "fmj", null, { dist: 10 }), hitDamage("308", "fmj")), "a .308 hit is the same at 10 tiles");
const far = ladderRows().filter((r) => r.far != null);
check(far.length && far.every((r) => (r.type === "buck" || r.type === "bird") && r.far < r.bare) && ladderRows().filter((r) => r.type === "slug").every((r) => r.far == null), `ladderRows' "far" column (${FAR} tiles): buckshot and birdshot only, under their hit up close`);
check(near(gunHit(WEAPONS.shotgun, null, 10).bare, Math.round(gunHit(WEAPONS.shotgun).bare * 0.6 * 10) / 10, 0.11), "gunHit at 10 tiles: the pump's hit × 0.6");

// ---------- the battle: shotOdds equals the ladder ----------
console.log("combat.js shotOdds (the battle's own numbers) = ladder.js");
const state = createWorld({ seed: 11, factionCount: 4 });
registerCombatHandler("bucktest", () => {});
const base = hub(state);
function fighter(weapon) {
  const s = makeSurvivor(state);
  s.skills.shooting = 9; s.traits = []; s.health = 100;
  s.gear.weapon = newItem(weapon);
  s.location = { kind: "base", baseId: base.id };
  state.survivors.push(s);
  return s;
}
const guns = ["shotgun", "dbshotgun", "pump20", "ou12", "huntrifle"];
const people = guns.map(fighter);
state.combat = createBattle(state, { tile: base.tile, baseId: base.id, fighterIds: people.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "bucktest", context: {} });
const b = state.combat;
const foe = b.units.find((u) => u.side === "enemy");
foe.aware = true; foe.surprised = false;
const avg = (d) => (d[0] + d[1]) / 2;
for (const k of guns) {
  const u = b.units.find((x) => x.side === "player" && x.weapon === k);
  if (!check(!!u, `${k}: a unit with it`)) continue;
  u.dmgMult = 1; u.gm = NO_MODS; u.gmWeapon = u.weapon;
  const w = WEAPONS[k], cal = w.cal;
  for (const load of CALIBERS[cal].types.filter((t) => t === "buck" || t === "slug" || t === "bird" || t === "fmj" || t === "sp")) {
    u.load = load;
    const rows = D.map((d) => { const o = shotOdds(b, u, foe, foe.x - d, foe.y); return { d, o }; });
    const want = (d) => [0, 1].map((i) => Math.round(w.dmg[i] * (AMMO_TYPES[load].dmg ?? 1) * spreadMult(load, d, { cal })));
    const ok = rows.every(({ d, o }) => o.dmg[0] === want(d)[0] && o.dmg[1] === want(d)[1]);
    const ladderOk = rows.every(({ d, o }) => Math.abs(avg(o.dmg) - hitDamage(cal, load, null, { base: avg(w.dmg), dist: d }) / ((AMMO_TYPES[load].soft ?? 1) / (AMMO_TYPES[load].dmg ?? 1))) <= 0.51);
    const noted = rows.every(({ d, o }) => (spreadMult(load, d, { cal }) < 1) === o.notes.some((n) => /shot spreads/.test(n)));
    check(ok && ladderOk && noted, `${k} with ${AMMO_TYPES[load].name}: damage at ${D.join(" / ")} tiles ${rows.map(({ o }) => o.dmg.join("–")).join(" / ")} (the ladder's, the odds line says when it spreads)`);
  }
}
{
  // A choke fitted (its spread in the unit's attachments: gunmods.js gunMods): full damage further out.
  const u = b.units.find((x) => x.side === "player" && x.weapon === "shotgun");
  u.load = "buck"; u.dmgMult = 1; u.gm = { ...NO_MODS, spread: ATTACH.choke.spread }; u.gmWeapon = u.weapon;
  const at8 = shotOdds(b, u, foe, foe.x - 8, foe.y), at10 = shotOdds(b, u, foe, foe.x - 10, foe.y);
  check(at8.dmg[1] === WEAPONS.shotgun.dmg[1] && at10.dmg[1] === Math.round(WEAPONS.shotgun.dmg[1] * 0.8) && at10.notes.some((n) => /past 8 tiles/.test(n)), `with a full choke the pump hits ${at8.dmg.join("–")} at 8 tiles, ${at10.dmg.join("–")} at 10 (spreads past 8)`);
  u.gm = NO_MODS;
}

// ---------- the battle HUD's target card ----------
console.log("The battle HUD");
try {
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = globalThis.document || { createElement: () => cvs(0, 0), getElementById: () => null, documentElement: { style: { getPropertyValue: () => "1" } } };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const HUD = await import("../src/ui/battlehud.js");
  const u = b.units.find((x) => x.side === "player" && x.weapon === "shotgun");
  u.load = "buck";
  const card = (d) => { u.x = foe.x - d; u.y = foe.y; const o = shotOdds(b, u, foe); return { o, html: HUD.targetCardHtml(b, u, foe, { ...o, ok: true, kind: "shot" }) }; };
  const near3 = card(3), far8 = card(10);
  const shown = (c) => c.html.includes(`${c.o.dmg[0]}–${c.o.dmg[1]} dmg`);
  check(shown(near3) && shown(far8) && far8.o.dmg[1] < near3.o.dmg[1], `the target card's damage: ${near3.o.dmg.join("–")} at 3 tiles, ${far8.o.dmg.join("–")} at 10`);
} catch (e) {
  check(false, `the battle HUD: ${e.message}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
