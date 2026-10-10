// The gun distribution (src/sim/gundist.js; data-guns.js GUN_CLASS, GUN_SOURCES, PLACE_DRAWS, THEME_DRAWS, HIVE_GUNS).
// Checks:
// - every gun has a class (uses and an era, GUN_CLASS) and a rarity tier, and is reachable from at least one source;
// - each source only yields guns whose class it draws (and, for a place, whose theme tags meet its own: the loot
//   audit), a list's gun only for one of its kind, a fighter's only within its band;
// - finds follow the rarity tiers (common ≫ uncommon > scarce > rare > very rare, a gun at a time);
// - escort and contractor kits (on the battle map and by the numbers), the hive crawl's rewards (the bones, the
//   core's hoard, the deep rooms), the city crawl's rooms (a police armoury, a gun counter, an Army checkpoint) and the
//   AI groups' armouries (starting kits, newcomers) hold guns of the 2026-10-10 arsenal;
// - each kind of fighter about as strong as before (the mean power of their guns), the AI groups' starting kits worth
//   about the same (arsenal.js weaponValue: AI parity, coarse);
// - the world's dice untouched: with the distribution off and on a world (normal and Hardcore) is made and runs its
//   first days under the autopilot on the same number of draws; the swaps are the same for the same roll;
// - the Customize catalogue offers every gun.
// Prints the sources table (each source's top guns). Usage: node tools/gunloottest.js
import { GEAR, LOCATIONS } from "../src/sim/data.js";
import { KITS, AREAS, enemyUnit } from "../src/sim/combat.js";
import { createWorld, tickHour } from "../src/sim/world.js";
import { Rng } from "../src/sim/rng.js";
import { hash01 } from "../src/sim/skills.js";
import { ITEM_TAGS, SITE_TAGS, AREA_TAGS } from "../src/sim/loot.js";
import { ARSENAL_GEAR, GUN_CLASS, GUN_USES, GUN_ERAS, GUN_RARITY, GUN_SOURCES, PLACE_DRAWS, ARSENAL_FINDS, HIVE_GUNS } from "../src/sim/data-guns.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { GUN_DIST, allGuns, isGun, gunClass, gunsFrom, swapGun, drawGun, sourceDef, areaSourceName, kitGunSource, resetGunDist } from "../src/sim/gundist.js";
import { guardGear, GUARD_KIT } from "../src/sim/escorts.js";
import { starterKit, newcomerKit, weaponValue, KIT_OF } from "../src/sim/arsenal.js";
import { hiveHoard, hiveDeepGun, HCRAWL } from "../src/sim/hivecrawl.js";
import { rollArea } from "../src/sim/citycrawl.js";
import { crawlGuns } from "../src/sim/gunfinds.js";
import { slotChoices } from "../src/sim/startgear.js";
import { itemPoints } from "../src/sim/custompoints.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const NEW = new Set(Object.keys(ARSENAL_GEAR));
const GUNS = allGuns();
const uses = (k) => gunClass(k).uses;
const draws = (name) => (sourceDef(name) || {}).draws || {};
const drawn = (name, k) => uses(k).some((u) => (draws(name)[u] || 0) > 0);

// ---------- every gun classed and reachable ----------
console.log("Classes");
const unclassed = GUNS.filter((k) => !GUN_CLASS[k]);
check(!unclassed.length, `every gun has a GUN_CLASS line (missing: ${unclassed.join(", ") || "none"})`);
const badClass = Object.entries(GUN_CLASS).filter(([k, tags]) => !GEAR[k] || !tags.some((t) => GUN_USES.includes(t)) || tags.filter((t) => GUN_ERAS.includes(t)).length !== 1 || tags.some((t) => !GUN_USES.includes(t) && !GUN_ERAS.includes(t)));
check(!badClass.length, `each class names a gun, at least one use and exactly one era (bad: ${badClass.map(([k]) => k).join(", ") || "none"})`);
check(GUNS.every((k) => GUN_RARITY[k]), `every gun has a rarity tier (missing: ${GUNS.filter((k) => !GUN_RARITY[k]).join(", ") || "none"})`);
check(!isGun("m79") && !isGun("compbow") && !isGun("machete") && isGun("ou12") && isGun("pipegun"), "launchers, bows and melee are not guns; the over-under and the pipe gun are");

// Every source the game rolls a gun from: the named ones, the places whose gear lists hold a gun or that have an
// extra-gun chance (gunfinds.js ARSENAL_FINDS), each with the guns its list gives (a list's gun swaps for its kind).
const sources = new Map(); // name -> [list keys] (null: a free draw)
for (const name of Object.keys(GUN_SOURCES)) sources.set(name, null);
for (const [type, L] of Object.entries(LOCATIONS)) {
  const listed = (L.gear || []).filter(isGun);
  if (listed.length || ARSENAL_FINDS.site[type]) sources.set(`site:${type}`, listed);
}
for (const [type, A] of Object.entries(AREAS)) {
  const listed = (A.gear || []).map(([k]) => k).filter(isGun);
  if (listed.length || ARSENAL_FINDS.area[type]) {
    sources.set(`area:${type}`, listed);
    for (const site of ["police", "military"]) if (PLACE_DRAWS[areaSourceName(type, site)]) sources.set(areaSourceName(type, site), listed);
  }
}
const reach = new Map();
for (const name of sources.keys()) for (const k of Object.keys(gunsFrom(name))) { if (!reach.has(k)) reach.set(k, []); reach.get(k).push(name); }
const lost = GUNS.filter((k) => !reach.has(k));
check(!lost.length, `every gun is reachable from a source (none for: ${lost.join(", ") || "none"})`);

// ---------- each source only yields what it draws ----------
console.log("Sources");
let badDraw = [], badTheme = [], badKind = [], badBand = [];
for (const [name, listed] of sources) {
  const def = sourceDef(name);
  if (!def) { badDraw.push(`${name}: no definition`); continue; }
  const pool = gunsFrom(name);
  for (const k of Object.keys(pool)) {
    if (!drawn(name, k)) badDraw.push(`${name}:${k}`);
    if (def.theme && !(ITEM_TAGS[k] || []).some((t) => def.theme.includes(t))) badTheme.push(`${name}:${k}`);
    if (def.cats && !def.cats.includes(GEAR[k].cat)) badKind.push(`${name}:${k}`);
  }
  // A list's gun (or, for a kit, each gun on its kind's lists) swapped on many rolls.
  const kind = /^kit:(.+)$/.exec(name);
  const lists = kind && KITS[kind[1]] ? [...KITS[kind[1]].weapons, ...(KITS[kind[1]].strong || [])].filter(isGun) : listed || [];
  for (const key of new Set(lists)) for (let i = 0; i < 60; i++) {
    const g = swapGun(name, key, [name, key, i]);
    if (g === key) continue; // nothing of the source's in its kind (or band): it stays
    if (!drawn(name, g)) badDraw.push(`${name}:${key}→${g}`);
    const same = Object.keys(pool).some((k) => GEAR[k].cat === GEAR[key].cat && (def.band == null || Math.abs(GEAR[k].power - GEAR[key].power) <= def.band + 1e-9));
    if (same && GEAR[g].cat !== GEAR[key].cat) badKind.push(`${name}:${key}→${g}`);
    if (def.band != null && Math.abs(GEAR[g].power - GEAR[key].power) > def.band + 1e-9) badBand.push(`${name}:${key}→${g}`);
  }
}
const few = (a) => [...new Set(a)].slice(0, 8).join(", ") || "none";
check(!badDraw.length, `every source yields only guns of the uses it draws (${few(badDraw)})`);
check(!badTheme.length, `a place yields only guns whose theme tags meet its own (the loot audit: ${few(badTheme)})`);
check(!badKind.length, `a list's gun swaps for one of its kind, a case's kinds hold (${few(badKind)})`);
check(!badBand.length, `a fighter's gun stays in its kit's band (${few(badBand)})`);
check(gunsFrom("site:military").m4 > 0 && !gunsFrom("site:military").ou20 && !gunsFrom("site:farm").m4 && gunsFrom("site:farm").ou20 > 0 && !gunsFrom("site:police").hk416,
  "an Army base keeps military carbines and no bird guns, a farm the reverse, a police station no special-forces rifles");
check(gunsFrom("area:armory@police").carbine > 0 && !(gunsFrom("area:armory@police").lmg > gunsFrom("area:armory@police").pistol) && gunsFrom("area:armory@military").m4 > gunsFrom("area:armory@police").m4 * 5,
  "a police station's armoury holds police guns, an Army base's the Army's");
// The same roll gives the same gun; off, the list's gun stays.
{
  const a = swapGun("site:gunstore", "pistol", [1, 2, 3]), b = swapGun("site:gunstore", "pistol", [1, 2, 3]);
  GUN_DIST.off = true;
  const c = swapGun("site:gunstore", "pistol", [1, 2, 3]);
  GUN_DIST.off = false;
  check(a === b && c === "pistol" && swapGun("site:gunstore", "vest", [1]) === "vest", `a swap is the same for the same roll (${a}); off, and for anything not a gun, the list's key stays`);
}

// ---------- rarity ----------
console.log("Rarity");
{
  const tiers = ["common", "uncommon", "scarce", "rare", "veryrare"];
  const per = Object.fromEntries(tiers.map((t) => [t, { n: 0, guns: new Set() }]));
  const names = ["site:gunstore", "site:military", "site:police", "site:farm", "hive:bones", "trader:merchants", "hive:hoard3", "stash:highMil", "kit:soldiers"];
  for (const name of names) {
    const pool = gunsFrom(name);
    for (const k of Object.keys(pool)) per[gunClass(k).tier].guns.add(`${name}:${k}`);
    for (let i = 0; i < 20000; i++) { const k = drawGun(name, hash01("rar", name, i)); if (k) per[gunClass(k).tier].n++; }
  }
  const mean = tiers.map((t) => (per[t].guns.size ? per[t].n / per[t].guns.size : null));
  const shown = tiers.map((t, i) => `${t} ${mean[i] == null ? "-" : mean[i].toFixed(0)}`).join(", ");
  const seq = mean.filter((m) => m != null);
  check(seq.every((m, i) => i === 0 || m < seq[i - 1]), `a gun of a commoner tier turns up more often than one of a rarer (finds a gun, where both are kept: ${shown})`);
  check(mean[0] > 10 * mean[4], `a common gun ≫ a very rare one (${(mean[0] / mean[4]).toFixed(0)}×)`);
  // Within one source the same holds: an armoury's M4 (scarce) over its M240 (very rare).
  const A = gunsFrom("area:armory@military");
  check(A.m4 > A.m240 * 5 && A.ar > A.scarh * 5, "an Army armoury: the scarce rifles far more often than the very rare");
}

// ---------- the new guns where the user asked for them ----------
console.log("Escort and contractor kits, crawls, AI armouries");
const newIn = (keys) => [...new Set(keys)].filter((k) => NEW.has(k));
{
  // On the battle map (combat.js enemyUnit) and by the numbers (escorts.js guardGear: a caravan's guards).
  const got = { escorts: [], contractors: [], guards: [] };
  for (const kind of Object.keys(got)) for (let i = 0; i < 400; i++) {
    const b = { nextId: 1, turn: 0, floor: 0, tileId: i, units: [] };
    const u = enemyUnit(b, new Rng(1000 + i), kind, i % 2 ? 7 : 5, 1);
    got[kind].push(u.weapon);
  }
  for (const kind of Object.keys(GUARD_KIT)) for (let i = 0; i < 200; i++) got[kind].push(...guardGear(kind, 4, (j, k) => hash01("gg", kind, i, j, k)).gear.map((it) => it.key));
  for (const kind of ["escorts", "contractors"]) check(newIn(got[kind]).length >= 3, `${kind}' kits hold new guns: ${newIn(got[kind]).join(", ") || "none"}`);
  check(newIn(got.contractors).some((k) => ["hk416", "scarl", "m4"].includes(k)), "contractors carry the modern carbines (M4, piston, modular)");
}
{
  // The hive crawl: the core's hoard (by tier), the bones' guns, the deep rooms' rare guns.
  const st = createWorld({ seed: 11, factionCount: 4 });
  const hoard = [], deep = [], bones = [];
  for (let i = 0; i < 300; i++) {
    const hive = { id: 900 + i, tile: i, res: (i % 5) * 60, born: -24 * 30 * (i % 6), income: 0, name: "test" };
    hoard.push(...hiveHoard(st, hive).gear.map((it) => it.key));
  }
  for (let i = 0; i < 3000; i++) { const k = hiveDeepGun(0.5, ["deep", i]); if (k) deep.push(k); }
  for (const key of HCRAWL.BONES.keys) for (let i = 0; i < 100; i++) bones.push(swapGun("hive:bones", key, ["bones", key, i]));
  check(newIn(hoard).length >= 4, `the core's hoard holds new guns: ${newIn(hoard).join(", ") || "none"}`);
  check(newIn(bones).length >= 4, `the bones hold new guns: ${newIn(bones).join(", ") || "none"}`);
  const rareShare = deep.filter((k) => ["rare", "veryrare"].includes(gunClass(k).tier)).length / Math.max(1, deep.length);
  check(deep.length > 1300 && deep.length < 1700 && rareShare > 0.5 && deep.every((k) => GEAR[k].power >= 5.5), `the deep rooms' finds: rare guns (${(100 * rareShare).toFixed(0)}% rare or very rare, ${deep.length} in 3000 at 50%)`);
  check(HIVE_GUNS.p + HIVE_GUNS.perLayer * 3 > HIVE_GUNS.p && HIVE_GUNS.from >= 2, "deeper layers find them more often, never at the mouth");
}
{
  // The city crawl by the numbers (citycrawl.js rollArea): a police station's armoury, a gun counter, an Army checkpoint.
  const got = { police: [], gunstore: [], military: [] };
  const room = { police: "armory", gunstore: "gunshop", military: "armory" };
  for (const site of Object.keys(got)) for (let i = 0; i < 1500; i++) got[site].push(...rollArea(new Rng(i * 7 + 1), room[site], 1.2, 5, site).gear.filter((it) => isGun(it.key)).map((it) => it.key));
  for (const site of Object.keys(got)) check(newIn(got[site]).length >= 2, `a city crawl's ${site === "military" ? "Army checkpoint" : site === "police" ? "police armoury" : "gun counter"} holds new guns: ${newIn(got[site]).join(", ") || "none"}`);
  check(got.police.every((k) => drawn("area:armory@police", k) || (AREAS.armory.gear || []).some(([g]) => g === k)) && got.military.every((k) => drawn("area:armory@military", k) || (AREAS.armory.gear || []).some(([g]) => g === k)), "each holds the guns it draws (police guns at the station, the Army's at the checkpoint)");
  const cg = []; for (let i = 0; i < 3000; i++) cg.push(...crawlGuns("gunshop", "gunstore", new Rng(i)).map((it) => it.key).filter(isGun));
  check(cg.length > 0 && cg.every((k) => drawn("area:gunshop", k)), `a crawl's gun counter turns up an extra gun now and then (${cg.length} in 3000)`);
}
{
  // The AI groups' armouries: their starting kits and their newcomers.
  for (const type of Object.keys(KIT_OF)) {
    const keys = [];
    for (let s = 0; s < 6; s++) keys.push(...starterKit(s + 1, `G${s}`, type, 30, 1.6).filter((it) => isGun(it.key)).map((it) => it.key));
    check(newIn(keys).length >= 1, `a ${type} group's starting armoury holds new guns: ${newIn(keys).join(", ") || "none"}`);
  }
  const st = createWorld({ seed: 5, factionCount: 6 });
  const f = st.factions.find((x) => x.type === "military") || st.factions[0];
  const keys = [];
  for (let i = 0; i < 400; i++) keys.push(...newcomerKit(st, f, ["nc", i]).filter((it) => isGun(it.key)).map((it) => it.key));
  check(newIn(keys).length >= 1, `newcomers to ${f.name} (${f.type}) bring new guns: ${newIn(keys).join(", ") || "none"}`);
}

// ---------- fight balance: each kind as strong as before ----------
console.log("Fighters' strength");
{
  for (const kind of Object.keys(KITS)) {
    const K = KITS[kind];
    const list = [...K.weapons, ...(K.strong || [])].filter(isGun);
    if (!list.length) continue;
    let before = 0, after = 0, n = 0;
    for (const key of list) for (let i = 0; i < 200; i++) { before += GEAR[key].power; after += GEAR[swapGun(kitGunSource(kind), key, [kind, key, i])].power; n++; }
    const d = (after - before) / n;
    check(Math.abs(d) <= 0.2, `${kind}: their guns' mean power ${(before / n).toFixed(2)} → ${(after / n).toFixed(2)} (within 0.2)`);
  }
  // AI parity, coarse: a group's starting kit is worth about the same by the numbers with the distribution on.
  for (const type of Object.keys(KIT_OF)) {
    const worth = () => { let v = 0, n = 0; for (let s = 0; s < 8; s++) for (const it of starterKit(s + 1, `W${s}`, type, 24)) if (isGun(it.key)) { v += weaponValue(it); n++; } return v / Math.max(1, n); };
    const on = worth();
    GUN_DIST.off = true; const off = worth(); GUN_DIST.off = false;
    check(Math.abs(on - off) / off < 0.06, `a ${type} group's guns are worth ${off.toFixed(2)} → ${on.toFixed(2)} a gun (arsenal.js weaponValue, within 6%)`);
  }
}

// ---------- the world's dice ----------
console.log("The world's dice");
for (const mode of ["normal", "hardcore"]) {
  const run = (off, days) => {
    GUN_DIST.off = off;
    const st = createWorld({ seed: 4242, factionCount: 6, mode });
    const made = st.rng.state;
    st.started = true;
    setAutopilot(st, true, "balanced"); // searches, trades, fights: the swaps on the way
    for (let h = 0; h < days * 24 && !st.gameOver; h++) tickHour(st);
    GUN_DIST.off = false;
    return { made, ran: st.rng.state };
  };
  const a = run(true, 5), b = run(false, 5);
  check(a.made === b.made, `${mode}: a world is made on the same draws with the distribution off and on`);
  check(a.ran === b.ran, `${mode}: its first 5 days (the autopilot playing) draw the same (${a.ran} / ${b.ran})`);
}

// ---------- the Customize catalogue ----------
{
  const cat = new Set(slotChoices("weapon"));
  const missing = GUNS.filter((k) => !cat.has(k) || !(itemPoints(k) > 0));
  check(!missing.length, `the Customize catalogue offers every gun at a price (missing: ${missing.join(", ") || "none"})`);
}

// ---------- the table ----------
if (!process.argv.includes("quiet")) {
  console.log("\nSources (top guns, % of finds):");
  for (const name of [...sources.keys()].sort()) {
    const p = gunsFrom(name), tot = Object.values(p).reduce((a, b) => a + b, 0);
    if (!tot) continue;
    const top = Object.entries(p).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, w]) => `${k} ${((100 * w) / tot).toFixed(0)}`).join(", ");
    const nNew = Object.keys(p).filter((k) => NEW.has(k)).length;
    console.log(`  ${name.padEnd(24)} ${String(Object.keys(p).length).padStart(2)} guns (${nNew} new)  ${top}`);
  }
}
resetGunDist();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
