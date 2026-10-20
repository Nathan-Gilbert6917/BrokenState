// The gun and melee roster (docs/weapons-overhaul-plan.md sections 3, 4, 13, 22; src/sim/data-guns.js, factoryfit.js):
// every WEAPONS key has an item (GEAR) bar the natural weapons, the launchers and the mounted M2 (LATER_GEAR, wave 2),
// a calibre for every gun, and a look in the battle sprites; magazine sizes make sense (by kind of gun, the lever-action
// six); fire modes are well formed; the kits name real weapons; every new item has somewhere it is found; durability;
// the sniper rifle comes fitted with its scope and bipod from every source (loot, raid boxes, enemies' guns and bodies),
// the .50 with its scope, the marksman rifle sometimes; the brace and heavy fields.
// Usage: node tools/rostertest.js
import { GEAR, LOCATIONS } from "../src/sim/data.js";
import { WEAPONS, KITS, AREAS, enemyUnit } from "../src/sim/combat.js";
import { GUN_GEAR, GUN_WEAPONS, KIT_PATCH, WEAPON_PATCH, FACTORY_FIT, LATER_GEAR, ROSTER_TAGS, TRUCK_GEAR, ARSENAL_FINDS } from "../src/sim/data-guns.js";
import { gunPool } from "../src/sim/gunfinds.js";
import { INTERNAL } from "../src/sim/data-kit.js";
import { CALIBERS } from "../src/sim/data-ammo.js";
import { ATTACH } from "../src/sim/gunmods.js";
import { factoryFit, withFactory } from "../src/sim/factoryfit.js";
import { newItem, enemyBody, carryMods } from "../src/sim/inventory.js";
import { ITEM_TAGS, SITE_TAGS, AREA_TAGS } from "../src/sim/loot.js";
import { WEAPON_UNDRAWN, weaponPixels } from "../src/ui/sprites.js";
import { Rng } from "../src/sim/rng.js";
import { truckLoot } from "../src/sim/miltrucks.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`  FAIL: ${msg}`); } return ok; };
const list = (a) => a.join(", ") || "none";
const NATURAL = ["claws", "acid"]; // a zombie's teeth, a spitter's acid: no item
// The vehicle turret's guns (combat.js TURRET_WEAPON turret_m2 / turret_lmg, mounted: true) are no items either: the
// gun belongs to the vehicle (vehicles.js upgrades), its belt is the team's ammo.
const later = (k) => !!(WEAPONS[k] && (WEAPONS[k].mounted || WEAPONS[k].mount)); // the turrets' guns and the M2 (bolted to military vehicles: never an item); the launchers are items since wave 2
const launcherOrMount = (k) => !!(WEAPONS[k] && (WEAPONS[k].launcher || WEAPONS[k].mount));

// ---------- every weapon ----------
console.log("Weapons");
const keys = Object.keys(WEAPONS);
const noGear = keys.filter((k) => k !== "fists" && !NATURAL.includes(k) && !later(k) && !GEAR[k]);
check(!noGear.length, `every weapon has an item (missing: ${list(noGear)})`);
// (the M203 is also the economy agent's under-barrel part, data-gunmods.js: an item, cat gunmod, that fires nothing yet)
check(Object.keys(LATER_GEAR).every((k) => WEAPONS[k] && WEAPONS[k].launcher && GEAR[k] === LATER_GEAR[k]) && GEAR.m203 && GEAR.m203.cat === "gunmod" && !GEAR.m2hb, "the launchers are items (wave 2: LATER_GEAR in GEAR; the M203 a gun part); the M2 never is");
const guns = keys.filter((k) => !WEAPONS[k].melee && !WEAPONS[k].arrows && !WEAPONS[k].acid);
const noCal = guns.filter((k) => !WEAPONS[k].cal || (!CALIBERS[WEAPONS[k].cal] && !WEAPONS[k].launcher));
check(!noCal.length, `every gun has a known calibre (missing: ${list(noCal)})`);
const undrawn = keys.filter((k) => !WEAPON_UNDRAWN.includes(k) && !weaponPixels(k));
check(!undrawn.length, `every weapon has a look in the battle sprites (none for: ${list(undrawn)})`);
check(WEAPON_UNDRAWN.every((k) => !weaponPixels(k)), "bare hands, teeth and acid draw nothing");
for (const k of Object.keys(GUN_WEAPONS)) check(WEAPONS[k] === GUN_WEAPONS[k] || Object.keys(GUN_WEAPONS[k]).every((f) => WEAPONS[k][f] === GUN_WEAPONS[k][f]), `${k} merged into WEAPONS`);
check(Object.entries(WEAPON_PATCH).every(([k, p]) => WEAPONS[k] && Object.entries(p).every(([f, v]) => WEAPONS[k][f] === v)), "the patches to old weapons are merged");
check(Object.keys(GUN_GEAR).every((k) => WEAPONS[k]), "every new item is a weapon");
check(Object.keys(GUN_GEAR).every((k) => GEAR[k].slot === "weapon" && GEAR[k].weight > 0 && GEAR[k].value > 0 && GEAR[k].desc && GEAR[k].power > 0), "new weapons: hands slot, weight, value, power and a description");

// ---------- magazines ----------
console.log("Magazines");
const cap = (k) => WEAPONS[k].cap;
check(cap("leverrifle") === 6, "the lever-action holds 6 (section 3)");
const byCat = (cat) => guns.filter((k) => GEAR[k] && GEAR[k].cat === cat);
check(byCat("pistol").every((k) => cap(k) >= 5 && cap(k) <= (WEAPONS[k].cal === "57x28" ? 20 : 15)), `pistols hold 5–15 (a snub-nose five; the 5.7 pistol 20) (${byCat("pistol").map((k) => `${k} ${cap(k)}`).join(", ")})`);
check(byCat("shotgun").every((k) => cap(k) >= 1 && cap(k) <= (k === "ksg" ? 14 : 8)), `shotguns hold 1–8 (the bullpup pump's twin tubes 14) (${byCat("shotgun").map((k) => `${k} ${cap(k)}`).join(", ")})`);
check(byCat("automatic").every((k) => cap(k) >= (WEAPONS[k].cal === "308" || WEAPONS[k].cal === "45acp" ? 20 : k === "famas" ? 25 : 30)), `automatic weapons hold 30 or more (the .308 battle rifles 20, the .45 SMGs 25, the FAMAS 25) (${byCat("automatic").map((k) => `${k} ${cap(k)}`).join(", ")})`);
check(byCat("rifle").every((k) => cap(k) >= (INTERNAL[k] === 1 ? 1 : 5) && cap(k) <= 30), `rifles hold 5–30 (a single-shot one) (${byCat("rifle").map((k) => `${k} ${cap(k)}`).join(", ")})`);
check(guns.filter((k) => WEAPONS[k].ammo > 0 && !WEAPONS[k].mounted).every((k) => cap(k) % WEAPONS[k].ammo === 0 || WEAPONS[k].modes), "a magazine is a whole number of shots (or the gun has fire modes; a turret's belt aside)");
check(cap("dbshotgun") === 2 && cap("sawnoff") === 2 && cap("lmg") === 100 && cap("sniper") === 5 && cap("dmr") === 20 && cap("amr") === 10, "two barrels, a 100-round box, 5 in the sniper, 20 in the marksman rifle, 10 in the .50");

// ---------- fire modes ----------
console.log("Fire modes");
const moded = keys.filter((k) => WEAPONS[k].modes);
check(["smg", "ak", "lmg"].every((k) => moded.includes(k)), `the SMG, the AK and the machine gun have fire modes (${list(moded)})`);
const wellFormed = (m) => ["single", "burst", "auto"].every((n) => m[n] && Number.isInteger(m[n].rounds) && Number.isFinite(m[n].aim))
  && m.single.rounds === 1 && m.single.aim === 0 && m.burst.rounds >= 2 && m.burst.rounds <= 3 && m.auto.rounds >= 10 && m.auto.rounds <= 15
  && m.auto.aim < m.burst.aim && m.burst.aim < 0;
check(moded.every((k) => wellFormed(WEAPONS[k].modes)), "every mode set: single 1 round at 0, burst 2–3, auto 10–15, aim worse each step");
check(moded.every((k) => !WEAPONS[k].cap || cap(k) >= WEAPONS[k].modes.auto.rounds), "a full magazine holds a full-auto string");
check(!["pistol", "compact9", "pistol45", "pistol22", "dmr", "sniper", "huntrifle", "semishotgun"].some((k) => WEAPONS[k].modes), "semi-only guns have no modes");

// ---------- special fields ----------
console.log("Fields");
check(WEAPONS.lmg.heavy && WEAPONS.lmg.heavy.mob === -1 && WEAPONS.lmg.heavy.brace === 8, "the machine gun is heavy (−1 move, +8 braced)");
check(WEAPONS.sniper.brace === -15 && WEAPONS.amr.brace === -20 && WEAPONS.amr.pierce === 1 && WEAPONS.amr.common === false, "brace −15 sniper, −20 and pierce 1 on the .50, .50 rounds only");
check(WEAPONS.sniper.sniper === true && !WEAPONS.dmr.sniper, "the sniper rifle is marked for the sniper AI");
check(GEAR.sniper.hunt && GEAR.sniper.hunt.big === 1.25 && GEAR.rifle22.hunt.small === 1.1 && GEAR.smg.hunt && GEAR.amr.hunt, "hunting overrides (sniper, .22, SMG, .50)");
check(Object.keys(GUN_WEAPONS).filter((k) => GUN_WEAPONS[k].launcher).length === 5 && ["m79", "m203", "m32", "at4", "rpg"].every((k) => WEAPONS[k].launcher) && WEAPONS.m203.under && WEAPONS.at4.oneShot, "five launchers, data only (m203 under the barrel, the AT4 single shot)");
check(Object.keys(GUN_GEAR).every((k) => GEAR[k].dur >= (WEAPONS[k].melee ? 30 : 50) && GEAR[k].dur <= (WEAPONS[k].melee ? 70 : 90)), "durability: guns 50–90, melee 30–70");

// ---------- kits ----------
console.log("Kits");
const badKit = [];
for (const [kind, kit] of Object.entries(KITS)) for (const f of ["weapons", "strong"]) for (const k of kit[f] || []) if (!WEAPONS[k] || !GEAR[k]) badKit.push(`${kind}.${f}: ${k}`);
check(!badKit.length, `kits name real weapons (bad: ${list(badKit)})`);
check(Object.values(KITS).every((kit) => (kit.loot || []).every((k) => GEAR[k])), "kit loot names real items");
check(Object.keys(KIT_PATCH).every((k) => KITS[k]), "the patch names real kits");
check(!Object.values(KITS).some((kit) => [...kit.weapons, ...kit.strong, ...kit.loot].some((k) => k === "amr" || later(k) || launcherOrMount(k))), "no kit carries the .50 or a launcher (launchers.js arms them apart)");
const strong = KITS.soldiers.strong;
const share = (k) => 0.5 * strong.filter((x) => x === k).length / strong.length;
check(Math.abs(share("lmg") - 1 / 6) < 0.03 && Math.abs(share("sniper") - 1 / 10) < 0.01, `soldiers at power 7+: machine gun ${Math.round(share("lmg") * 100)}%, sniper ${Math.round(share("sniper") * 100)}%`);

// ---------- loot sources ----------
console.log("Sources");
const src = new Set();
for (const d of Object.values(LOCATIONS)) for (const k of d.gear) src.add(k);
for (const a of Object.values(AREAS)) for (const [k] of a.gear) src.add(k);
for (const kit of Object.values(KITS)) for (const k of [...kit.weapons, ...kit.strong, ...kit.loot]) src.add(k);
for (const rows of Object.values(TRUCK_GEAR)) for (const [k] of rows) src.add(k);
// the arsenal of 2026-10-10: its own tables (gunfinds.js: the guns whose tags meet a site's or an area's with a chance)
for (const [type, p] of Object.entries(ARSENAL_FINDS.site)) if (p > 0) for (const k of Object.keys(gunPool(SITE_TAGS[type] || []))) src.add(k);
for (const [area, p] of Object.entries(ARSENAL_FINDS.area)) if (p > 0) for (const k of Object.keys(gunPool(AREA_TAGS[area] || []))) src.add(k);
const orphans = Object.keys(GUN_GEAR).filter((k) => !src.has(k));
check(!orphans.length, `every new item is found somewhere (none for: ${list(orphans)})`);
check(Object.keys(ROSTER_TAGS).every((k) => ITEM_TAGS[k] && GEAR[k]) && Object.keys(GUN_GEAR).every((k) => ITEM_TAGS[k]), "every new item has loot theme tags");
check(!Object.values(LOCATIONS).some((d) => d.gear.some(launcherOrMount)) && !Object.values(AREAS).some((a) => a.gear.some(([k]) => launcherOrMount(k))), "launchers come only from their own tables (loot.js SITE_LAUNCHERS / AREA_LAUNCHERS), not the site gear lists");
check(["lmg", "amr", "sniper", "dmr", "smg"].every((k) => !Object.values(LOCATIONS).some((d) => d.gear.includes(k))), "the rare guns only in raid boxes (with their own small chances), not the site searches");

// ---------- the sniper rifle fitted ----------
console.log("Fitted when found");
// The parts are the economy agent's (data-gunmods.js: tacscope, acog; gunmods.js: the bipod, its own slot), fitted by
// its platform rules (gunmods.js modFits).
const fitted = (it) => !!(it && it.mods && it.mods.optic && ["tacscope"].includes(it.mods.optic.key) && it.mods.bipod && it.mods.bipod.key === "bipod");
// 1. Made from nothing, with dice, from a raid box roll's rng.
check(fitted(newItem("sniper")) && fitted(newItem("sniper", 0.7, new Rng(5))) && fitted(newItem("sniper", 1, 0.3)), "newItem: a sniper rifle always has a tactical scope and a bipod (with or without dice)");
check(newItem("amr").mods && newItem("amr").mods.optic.key === "tacscope", "the .50 always has its scope");
// 2. Every raid area and site that holds it: the item a roll makes.
const rng = new Rng(9);
let all = true;
for (const [a, def] of Object.entries(AREAS)) for (const [k] of def.gear) if (k === "sniper") { for (let i = 0; i < 20; i++) { rng.next(); if (!fitted(newItem(k, 1, rng))) all = false; } }
check(all, "every raid box sniper rifle comes fitted");
// 3. Enemies: the gun they carry, and the one on their body.
let units = 0, bodies = 0, bad = 0;
const b = { nextId: 1, turn: 1, floor: 0 };
for (let i = 0; i < 400 && units < 30; i++) {
  const r = new Rng(1000 + i);
  const u = enemyUnit(b, r, "soldiers", 9, i);
  if (u.weapon !== "sniper") continue;
  units++;
  const mi = (u.item && u.item.mods) || u.modItems; // a person (fighters.js): the parts are on the gun in their hands
  if (!mi || !mi.optic || mi.optic.key !== "tacscope" || !mi.bipod || mi.bipod.key !== "bipod") bad++;
  const body = enemyBody(new Rng(2000 + i), u, KITS.soldiers);
  if (body.gear && body.gear.weapon && body.gear.weapon.key === "sniper") { bodies++; if (!fitted(body.gear.weapon)) bad++; }
}
check(units > 0 && bodies > 0 && !bad, `soldiers' sniper rifles and the ones on their bodies are fitted (${units} carried, ${bodies} looted, ${bad} bare)`);
// 3b. Army trucks (miltrucks.js truckLoot, the roster's hook).
let tr = 0, trBad = 0;
for (let i = 0; i < 3000 && tr < 20; i++) for (const it of truckLoot(new Rng(i), "cargo").gear) if (it.key === "sniper") { tr++; if (!fitted(it)) trBad++; }
check(tr > 0 && !trBad, `Army trucks carry sniper rifles, fitted (${tr} found, ${trBad} bare)`);
// 4. The marksman rifle: about 60% a scope, 40% a bipod, where there are dice.
let opt = 0, bip = 0;
const N = 2000;
for (let i = 0; i < N; i++) { const it = factoryFit({ key: "dmr" }, i * 7919); if (it.mods && it.mods.optic) opt++; if (it.mods && it.mods.bipod) bip++; }
check(Math.abs(opt / N - 0.6) < 0.04 && Math.abs(bip / N - 0.4) < 0.04, `the marksman rifle: a scope ${Math.round((opt / N) * 100)}%, a bipod ${Math.round((bip / N) * 100)}%`);
check(!factoryFit({ key: "dmr" }, null).mods, "no dice (a trader's stock): no chance parts");
const scopes = new Set();
for (let i = 0; i < 200; i++) { const it = factoryFit({ key: "dmr" }, i); if (it.mods && it.mods.optic) scopes.add(it.mods.optic.key); }
check(scopes.has("acog") && scopes.has("tacscope"), "its scope is an ACOG or a tactical scope");
// 5. A part already on a mount stays; a missing part is skipped.
const held = { key: "sniper", mods: { optic: { key: "reddot", name: "Red dot", quality: 1 } } };
factoryFit(held);
check(held.mods.optic.key === "reddot" && held.mods.bipod.key === "bipod", "a mount already taken keeps its part");
const save = ATTACH.tacscope; delete ATTACH.tacscope;
check(!factoryFit({ key: "sniper" }).mods.optic, "a part that does not exist yet is skipped");
ATTACH.tacscope = save;
check(withFactory("pistol", null, 1, 1) === null && withFactory("sniper", null, 1, 1).optic, "withFactory: nothing for other guns, the parts for the sniper rifle");
// Looted: exactly the parts the enemy carried (its factory ones among them), not a second roll.
const gun = newItem("dmr", 1, 12345);
const carried = withFactory("dmr", { muzzle: { key: "riflecan", name: "x", quality: 0.5 } }, 77, 3);
carryMods({ modItems: carried, gmWeapon: "dmr" }, gun);
check(Object.keys(gun.mods || {}).sort().join() === Object.keys(carried).sort().join() && gun.mods.muzzle.key === "riflecan", "looted with exactly the parts the enemy carried");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
