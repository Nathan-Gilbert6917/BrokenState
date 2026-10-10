// Buckshot loses damage at range (user request 2026-10-10: "Make buckshot lose damage at range. Today range only lowers
// the hit chance."). data-ammo.js AMMO_TYPES buck / bird carry spreadFull / spreadDrop / spreadMin and spreadMult works
// the × out; combat.js shotOdds (every gun shot's damage, the battle HUD's numbers) and ladder.js hitDamage (the tests,
// the balance sheet) both use it. Checks:
// - 12 ga and 20 ga 00 buckshot: full damage at 2 and 4 tiles, then down: × 0.8 at 6, 0.6 at 8, 0.4 at 10 (and never
//   under 0.4 further off); birdshot sooner and further (full to 3, 0.4 at 8, 0.3 from 9); slugs and bullets keep
//   theirs at every range;
// - the battle's own numbers (shotOdds, a real unit with a pump, a double, a 20 ga and a rifle on a real battle map)
//   equal the ladder's at 2 / 4 / 6 / 8 / 10 tiles, and the odds line says the shot spreads;
// - the balance sheet's columns (ladder.js far) match;
// - the battle HUD's target card shows the lower damage range at 8 tiles than at 3.
// Usage: node tools/buckfallofftest.js
import { AMMO_TYPES, CALIBERS, spreadMult } from "../src/sim/data-ammo.js";
import { hitDamage, gunHit, ladderRows, FAR } from "../src/sim/ladder.js";
import { WEAPONS, createBattle, registerCombatHandler, shotOdds } from "../src/sim/combat.js";
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { newItem } from "../src/sim/inventory.js";
import { NO_MODS } from "../src/sim/gunmods.js";

let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const D = [2, 4, 6, 8, 10];

// ---------- the curve ----------
console.log("The fall-off curve (data-ammo.js spreadMult)");
const buck = D.map((d) => spreadMult("buck", d)), bird = D.map((d) => spreadMult("bird", d));
console.log(`  00 buckshot at ${D.join(" / ")} tiles: ${buck.map((v) => v.toFixed(2)).join(" / ")}`);
console.log(`  birdshot    at ${D.join(" / ")} tiles: ${bird.map((v) => v.toFixed(2)).join(" / ")}`);
check([1, 1, 0.8, 0.6, 0.4].every((v, i) => near(buck[i], v)), "00 buckshot: full to 4 tiles, then × 0.8 / 0.6 / 0.4 at 6 / 8 / 10");
check([12, 16, 30].every((d) => near(spreadMult("buck", d), 0.4)), "and never under 0.4 further off");
check(bird.every((v, i) => v <= buck[i] + 1e-9) && near(bird[0], 1) && bird[1] < 1 && near(spreadMult("bird", 8), 0.4) && near(spreadMult("bird", 12), 0.3), "birdshot spreads sooner and further (full to 3, 0.4 at 8, floor 0.3)");
check(D.every((d, i) => i === 0 || buck[i] <= buck[i - 1]), "never more damage further off");
check(["slug", "fmj", "sp", "ap", "ball", "hp", "match", "beanbag", "rubber"].every((t) => D.concat([20, 40]).every((d) => spreadMult(t, d) === 1)), "slugs and bullets (and the less-lethal rounds) keep their damage at every range");
check(AMMO_TYPES.buck.spreadFull === 4 && AMMO_TYPES.buck.spreadDrop > 0 && AMMO_TYPES.buck.spreadMin > 0 && AMMO_TYPES.slug.spreadFull == null, "the parameters are data (AMMO_TYPES buck / bird spreadFull, spreadDrop, spreadMin), a slug has none");
check(spreadMult(null, 10) === 1 && spreadMult("buck", 0) === 1, "no type, point blank: 1");

// ---------- the ladder ----------
console.log("ladder.js (the tests and the balance sheet)");
for (const cal of ["12ga", "20ga"]) {
  const h = D.map((d) => hitDamage(cal, "buck", null, { dist: d }));
  console.log(`  ${CALIBERS[cal].name} buckshot, mean hit unarmoured at ${D.join(" / ")}: ${h.map((v) => v.toFixed(1)).join(" / ")}; slug ${D.map((d) => hitDamage(cal, "slug", null, { dist: d }).toFixed(1)).join(" / ")}`);
  check(D.every((d, i) => near(h[i], hitDamage(cal, "buck") * buck[i], 1e-9)), `${CALIBERS[cal].name} buckshot: its hit × the curve`);
  check(D.every((d) => near(hitDamage(cal, "slug", null, { dist: d }), hitDamage(cal, "slug"))), `${CALIBERS[cal].name} slug: the same hit at every range`);
}
check(hitDamage("12ga", "buck", { ac: 2, cond: 1 }, { dist: 8 }) < hitDamage("12ga", "buck", { ac: 2, cond: 1 }), "on a vest too");
check(near(hitDamage("308", "fmj", null, { dist: 10 }), hitDamage("308", "fmj")), "a .308 hit is the same at 10 tiles");
const far = ladderRows().filter((r) => r.far != null);
check(far.length && far.every((r) => (r.type === "buck" || r.type === "bird") && r.far < r.bare) && ladderRows().filter((r) => r.type === "slug").every((r) => r.far == null), `ladderRows' "far" column (${FAR} tiles): buckshot and birdshot only, under their hit up close`);
check(near(gunHit(WEAPONS.shotgun, null, 8).bare, Math.round(gunHit(WEAPONS.shotgun).bare * 0.6 * 10) / 10, 0.11), "gunHit at 8 tiles: the pump's hit × 0.6");

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
    const want = (d) => [0, 1].map((i) => Math.round(w.dmg[i] * (AMMO_TYPES[load].dmg ?? 1) * spreadMult(load, d)));
    const ok = rows.every(({ d, o }) => o.dmg[0] === want(d)[0] && o.dmg[1] === want(d)[1]);
    const ladderOk = rows.every(({ d, o }) => Math.abs(avg(o.dmg) - hitDamage(cal, load, null, { base: avg(w.dmg), dist: d }) / ((AMMO_TYPES[load].soft ?? 1) / (AMMO_TYPES[load].dmg ?? 1))) <= 0.51);
    const noted = rows.every(({ d, o }) => (spreadMult(load, d) < 1) === o.notes.some((n) => /shot spreads/.test(n)));
    check(ok && ladderOk && noted, `${k} with ${AMMO_TYPES[load].name}: damage at ${D.join(" / ")} tiles ${rows.map(({ o }) => o.dmg.join("–")).join(" / ")} (the ladder's, the odds line says when it spreads)`);
  }
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
  const near3 = card(3), far8 = card(8);
  const shown = (c) => c.html.includes(`${c.o.dmg[0]}–${c.o.dmg[1]} dmg`);
  check(shown(near3) && shown(far8) && far8.o.dmg[1] < near3.o.dmg[1], `the target card's damage: ${near3.o.dmg.join("–")} at 3 tiles, ${far8.o.dmg.join("–")} at 8`);
} catch (e) {
  check(false, `the battle HUD: ${e.message}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
