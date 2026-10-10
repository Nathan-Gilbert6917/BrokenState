// Gun slots that make sense for each gun (user, 2026-10-10: "Ensure each gun has attachment points for different
// components that makes sense for the gun. Example: a revolver cannot have a forward grip but can have a scope or
// suppressor."). The data: data-gunmods.js PLATFORMS (slots, parts, cat), CATEGORIES (never), WEAPON_SLOTS (a gun's own
// off / on / parts), PLATFORM_GUESS (a gun with no platform); the rules: gunmods.js slotRules / baseSlots / modFits /
// fitsSlot; old saves: gunmods.js relocateMisfits on load (save.js).
// Checks:
// - the tables are whole (every platform's kind exists, every slot and part named exists, every gun has a platform);
// - a revolver: no foregrip, no stock, no rail, but a scope on rings, a can or a compensator, grips, a laser grip;
//   the snub-nose no rings; a 1911 a laser grip but no rail light;
// - break actions (double, over-unders, single-shots, the sawn-off): no magazine, no foregrip, no light;
//   the plain pumps no foregrip, the railed police pump one; a bullpup no stock; the machine guns' bipods built in;
// - no gun can ever get a slot its kind never has (bare, or through a mount or a rail);
// - every gun has at least one slot, and every slot a gun can have has at least one part that fits it;
// - parts put on by the dice always fit: starter parts (every gun, many seeds), factory parts, enemies' and the AI's
//   guns (every kit × gun), the autopilot fitting from an armory, a new world's guns, a new run's gear picks;
// - a gun from another branch with no platform gets a sensible one (a .44 revolver, a P90, a lever .44, a single-shot);
// - the parts catalogue (2026-10-10): every new part a sane item that fits a gun and is found somewhere; every budget
//   clone strictly worse and cheaper than the part it copies; clones in homes and towns, brands in armouries; budget
//   parts wear out; a side-saddle loads a shell more; the AI's kits and the dice's starter parts draw from it;
// - a saved gun with a part that no longer fits: the part comes off on load and is kept (beside the gun in an armory,
//   in the carrier's kit, else the home armory), with a log line; a gun whose parts all fit is left alone.
// Usage: node tools/gunslottest.js
import { GEAR } from "../src/sim/data.js";
import { WEAPONS, KITS } from "../src/sim/combat.js";
import { createWorld, hub } from "../src/sim/world.js";
import { newItem } from "../src/sim/inventory.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { factoryFit } from "../src/sim/factoryfit.js";
import { sanitizeGunMods, gunWith } from "../src/sim/startgear.js";
import { GUN_WEAPONS } from "../src/sim/data-guns.js";
import {
  ATTACH, SLOTS, PLATFORMS, CATEGORIES, WEAPON_PLATFORM, WEAPON_SLOTS, platformOf, baseSlots, slotRules, modFits, modsFor,
  fitsSlot, fitMod, slotsOf, makeMod, randomStarterMods, enemyMods, ENEMY_MODS, fitFromPool, stripMisfits, relocateMisfits,
  misfitNote, gunCategory, guessPlatform, STARTER_MODS, reachableSlots, gunMods, wearMakeshiftMods, fittedKg, driftOf, modsText, attachText, stripMod,
} from "../src/sim/gunmods.js";
import { PLATFORM_GUESS, PART_INFO, BUDGET_MAGS, PART_FINDS } from "../src/sim/data-gunmods.js";
import { SITE_TAGS, AREA_TAGS, fitsTags } from "../src/sim/loot.js";
import { partPool } from "../src/sim/partfinds.js";
import { MAGAZINES } from "../src/sim/data-kit.js";
import { rezeroHour, REZERO_HOUR } from "../src/sim/repair.js";
import { benchTier, addBuilding, BUILDINGS } from "../src/sim/buildings.js";
import { lookOf, PART_ART } from "../src/ui/gunparts.js";

let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = Date.now();

// Every gun a person can hold: a GEAR weapon with a WEAPONS entry that is neither a blade, a bow, acid nor a launcher.
const isGun = (k) => { const w = WEAPONS[k], d = GEAR[k]; return !!(w && d && d.slot === "weapon" && !w.melee && !w.arrows && !w.acid && !w.launcher && !d.launcher); };
const guns = Object.keys(GEAR).filter(isGun);
// The slots a gun can ever have: bare, or opened by parts that fit it, nested (a mount, its red dot, its magnifier),
// found by fitting them for real.
const reachable = (k) => {
  const out = new Set(baseSlots(k));
  let frontier = [{}];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next = [];
    for (const mods of frontier) for (const p of modsFor(k)) {
      if (!ATTACH[p].adds || mods[ATTACH[p].slot]) continue;
      const g = { key: k, name: k, mods: { ...mods } };
      if (fitsSlot(g, makeMod(p))) continue;
      g.mods[ATTACH[p].slot] = makeMod(p);
      for (const x of slotsOf(g)) out.add(x);
      next.push(g.mods);
    }
    frontier = next.slice(0, 30);
  }
  return SLOTS.filter((x) => out.has(x));
};
const partsFor = (k, slot) => modsFor(k).filter((p) => ATTACH[p].slot === slot);
const gunItem = (k, mods = {}) => ({ key: k, name: GEAR[k].name, quality: 1, mods });
const fittedKgOf = (k) => fittedKg({ key: k });

// ---------- the tables ----------
console.log("Tables");
{
  check(Object.entries(PLATFORMS).every(([, P]) => CATEGORIES[P.cat] && P.slots.every((s) => SLOTS.includes(s)) && Object.entries(P.parts || {}).every(([s, l]) => SLOTS.includes(s) && l.every((x) => ATTACH[x]))),
    "every platform has a kind, its slots are slots and its part lists name real parts");
  check(Object.values(CATEGORIES).every((c) => c.never.every((s) => SLOTS.includes(s))), "every kind's never-list names real slots");
  check(Object.values(WEAPON_PLATFORM).every((p) => PLATFORMS[p]), "every WEAPON_PLATFORM value is a platform");
  check(Object.values(WEAPON_SLOTS).every((o) => [...(o.off || []), ...(o.on || [])].every((s) => SLOTS.includes(s)) && Object.values(o.parts || {}).every((l) => l.every((x) => ATTACH[x]))), "every per-gun override names real slots and parts");
  check(PLATFORM_GUESS.every((r) => PLATFORMS[r.plat]), "every PLATFORM_GUESS row names a platform");
  const none = guns.filter((k) => !platformOf(k));
  check(!none.length, `every gun has a platform (${none.join(", ") || "all"})`);
}

// ---------- the revolver (the user's example) ----------
console.log("Revolvers and pistols");
{
  const rv = "revolver";
  check(gunCategory(rv) === "revolver" && !reachable(rv).includes("stock") && !reachable(rv).includes("rail") && !reachable(rv).includes("mag") && !reachable(rv).includes("bipod"), `a revolver has no stock, rail, magazine or bipod (${reachable(rv).join(", ")})`);
  check(!modFits(rv, "foregrip") && !modFits(rv, "anglegrip") && !reachable(rv).includes("grip") && partsFor(rv, "pgrip").includes("revgrip") && !partsFor(rv, "pgrip").includes("pgrip"), `a revolver takes no foregrip, only its own grips (${partsFor(rv, "pgrip").join(", ")})`);
  const why = fitsSlot(gunItem(rv), newItem("foregrip", 1));
  check(/no foregrip slot/.test(why), `fitting a foregrip to a revolver is refused, and says why ("${why}")`);
  check(reachable(rv).includes("optic") && partsFor(rv, "optic").includes("scope4x") && partsFor(rv, "optic").includes("reddot"), `a revolver takes a scope or a red dot (on rings: ${partsFor(rv, "optic").join(", ")})`);
  const scoped = gunItem(rv, {});
  check(!!fitsSlot(scoped, newItem("scope4x", 1)) && fitMod(scoped, newItem("scopemount", 1)).ok && fitMod(scoped, newItem("scope4x", 1)).ok && scoped.mods.optic.key === "scope4x", "a scope goes on a revolver once its rings are on");
  check(reachable(rv).includes("muzzle") && modFits(rv, "can9") && modFits(rv, "comp") && !modFits(rv, "riflecan") && fitMod(gunItem(rv), newItem("can9", 1)).ok, "a revolver takes a pistol-calibre suppressor (user, 2026-10-10) or a compensator, not a rifle can");
  check(modFits(rv, "laser") && !modFits(rv, "weaponlight") && !modFits(rv, "peq"), "a revolver takes a laser grip, not a rail light or an IR laser");
  check(!reachable("snub357").includes("mount") && !modFits("snub357", "scope4x") && modFits("snub357", "can9") && modFits("snub357", "revgrip"), "the snub-nose: no scope rings, but a can and grips");
  check(modFits("pistol45", "laser") && !modFits("pistol45", "weaponlight") && modFits("pistol", "weaponlight") && modFits("usp45", "weaponlight"), "a 1911 (no rail) a laser grip only; the polymer pistols a light on their rail");
  for (const k of guns.filter((g) => gunCategory(g) === "pistol")) check(["stock", "grip", "pgrip", "under", "bipod", "rail", "sling", "receiver"].every((s) => !reachable(k).includes(s)), `${k}: a pistol has no stock, foregrip, rail, bipod or sling (${reachable(k).join(", ")})`);
}

// ---------- long guns by kind ----------
console.log("Long guns by kind");
{
  const breaks = guns.filter((k) => gunCategory(k) === "break");
  check(["dbshotgun", "ou12", "ou20", "single12", "singlerifle", "sawnoff"].every((k) => breaks.includes(k)), `the break actions are the double, the over-unders, the single-shots and the sawn-off (${breaks.join(", ")})`);
  for (const k of breaks) check(["mag", "grip", "pgrip", "under", "tactical", "rail", "receiver"].every((s) => !reachable(k).includes(s)) && !modsFor(k).some((p) => ["mag", "grip"].includes(ATTACH[p].slot)), `${k}: a break action has no magazine, foregrip or light (${reachable(k).join(", ")})`);
  for (const k of breaks.filter((x) => x !== "sawnoff")) check(reachable(k).includes("optic") && reachable(k).includes("stock") && reachable(k).includes("muzzle"), `${k}: a sight on rings, a stock and a muzzle device (a choke)`);
  check(baseSlots("sawnoff").join() === "sling", `the sawn-off a sling only (${baseSlots("sawnoff").join(", ")})`);
  check(modFits("single12", "choke") && modFits("ou12", "choke") && modFits("singlerifle", "scope4x") && modFits("singlerifle", "can308"), "chokes on the break-action shotguns, a scope and a can on the single-shot rifle");
  check(!reachable("shotgun").includes("grip") && !reachable("pump20").includes("grip") && reachable("tacpump").includes("grip") && modFits("tacpump", "foregrip") && !modFits("shotgun", "foregrip"), "the plain pumps take no foregrip, the railed police pump does");
  check(["shotgun", "pump20", "tacpump"].every((k) => modFits(k, "weaponlight") && modFits(k, "tubeext") && modFits(k, "choke") && modFits(k, "recoilpad") && modFits(k, "reddot")), "pumps: a light, a tube extension, a choke, a recoil pad, a red dot on rings");
  check(!reachable("aug").includes("stock") && reachable("aug").includes("optic") && reachable("aug").includes("muzzle") && reachable("aug").includes("grip"), "the bullpup: a sight, a muzzle, a foregrip on its rail, no stock to swap");
  check(["lmg", "m240", "amr"].every((k) => !reachable(k).includes("bipod") && Object.keys(PLATFORMS[platformOf(k)].builtin || {}).includes("bipod")), "the machine guns' and the .50's bipods are built in (no bipod slot)");
  check(["leverrifle", "lever357"].every((k) => !reachable(k).includes("grip") && !reachable(k).includes("mag") && reachable(k).includes("optic") && !baseSlots(k).includes("optic")), "lever-actions: a sight only on rings, no foregrip, no magazine");
  check(["huntrifle", "sniper", "rifle22"].every((k) => !reachable(k).includes("grip") && !reachable(k).includes("rail") && reachable(k).includes("stock") && reachable(k).includes("muzzle")), "bolt-actions: no foregrip or rail, a stock and a muzzle");
  check(["ar", "carbine", "m4"].every((k) => ["optic", "muzzle", "mag", "stock", "rail", "under", "grip", "tactical", "bipod", "sling"].every((s) => reachable(k).includes(s))), "the AR-15 family: every slot");
  check(reachable("ump45").includes("grip") && !reachable("smg").includes("grip"), "the .45 SMG (railed) takes a foregrip, the MP5-style one not");
}

// ---------- every gun, every slot ----------
console.log("Every gun, every slot");
{
  const noSlot = guns.filter((k) => !baseSlots(k).length);
  check(!noSlot.length, `every gun has at least one slot (${noSlot.join(", ") || "all"})`);
  const empty = [];
  for (const k of guns) for (const s of reachable(k)) if (!partsFor(k, s).length) empty.push(`${k}.${s}`);
  check(!empty.length, `every slot of every gun has at least one part that fits (${empty.join(", ") || "all"})`);
  const breach = [];
  for (const k of guns) {
    const never = (CATEGORIES[gunCategory(k)] || { never: [] }).never.filter((s) => !((WEAPON_SLOTS[k] || {}).on || []).includes(s));
    for (const s of reachable(k)) if (never.includes(s)) breach.push(`${k}.${s}`);
  }
  check(!breach.length, `no gun can get a slot its kind never has (${breach.join(", ") || "none"})`);
  check(guns.every((k) => modsFor(k).every((p) => !slotRules(k).never.has(ATTACH[p].slot))), "no part fits a slot a gun can never have");
  check(guns.every((k) => reachableSlots(k).join() === reachable(k).join()), "gunmods.js reachableSlots (the balance sheet's column) agrees");
}

// ---------- parts the dice put on ----------
console.log("Parts put on by the dice");
{
  const bad = [];
  const misfit = (g, why) => { const copy = JSON.parse(JSON.stringify(g)); const off = stripMisfits(copy); if (off.length) bad.push(`${why} ${g.key}: ${off.map((m) => m.key).join(", ")}`); };
  for (const k of guns) for (let sd = 1; sd <= 40; sd++) {
    const g = newItem(k, 1);
    randomStarterMods({ state: sd * 7919 }, g, sd);
    misfit(g, "starter");
    misfit(factoryFit(newItem(k, 1), sd), "factory");
  }
  check(!bad.filter((x) => x.startsWith("starter")).length, `starter parts always fit (${bad.filter((x) => x.startsWith("starter")).slice(0, 4).join("; ") || "all"})`);
  check(!bad.filter((x) => x.startsWith("factory")).length, `factory parts always fit (${bad.filter((x) => x.startsWith("factory")).slice(0, 4).join("; ") || "all"})`);
  check(STARTER_MODS.every((p) => ATTACH[p] && guns.some((k) => modFits(k, p))), "every starter part fits some gun");
  const ebad = [];
  for (const kit of Object.keys(ENEMY_MODS)) for (const k of guns) for (let sd = 1; sd <= 12; sd++) {
    const mods = enemyMods(kit, k, sd * 104729, `${kit}${sd}`);
    if (!mods) continue;
    const g = gunItem(k, mods);
    const off = stripMisfits(JSON.parse(JSON.stringify(g)));
    if (off.length) ebad.push(`${kit} ${k}: ${off.map((m) => m.key).join(", ")}`);
  }
  check(!ebad.length, `enemies' and the AI's gun parts always fit (every kit × gun; ${ebad.slice(0, 4).join("; ") || "all"})`);
  // The autopilot fitting from an armory full of every part.
  const pool = Object.keys(ATTACH).filter((p) => GEAR[p]).map((p) => newItem(p, 1));
  const held = guns.map((k) => newItem(k, 1));
  fitFromPool(pool, held);
  const pbad = held.filter((g) => stripMisfits(JSON.parse(JSON.stringify(g))).length).map((g) => g.key);
  check(!pbad.length, `the autopilot's armory fitting only fits what fits (${pbad.join(", ") || "all"})`);
  // A new world's guns (the colonists', the armory's, the AI groups' people and stores): nothing to take off.
  let moved = 0, kits = 0;
  for (const sd of [3, 11, 29]) {
    const st = createWorld({ seed: sd, factionCount: 6 });
    moved += relocateMisfits(st).length;
    kits += (st.survivors || []).filter((s) => s.gear && s.gear.weapon && s.gear.weapon.mods).length;
  }
  check(moved === 0, `a new world's guns carry nothing that does not fit (${moved} moved; ${kits} colonists' guns had parts)`);
  // The new-run gear picker: a foregrip picked for a revolver or a plain pump is dropped; on the police pump it stays.
  check(!sanitizeGunMods("revolver", { grip: "foregrip" }) && (sanitizeGunMods("revolver", { grip: "revgrip", muzzle: "can9" }) || {}).muzzle === "can9" && !sanitizeGunMods("shotgun", { grip: "foregrip" }) && (sanitizeGunMods("tacpump", { grip: "foregrip" }) || {}).grip === "foregrip",
    "the new-run gear picker keeps only parts that fit (a revolver's can and grips; no foregrip on a revolver or a plain pump)");
  check(!(gunWith("revolver", { grip: "anglegrip" }).mods || {}).grip, "a picked gun built with a part that does not fit comes without it");
  // Every kit's guns exist and take parts (AI parity: the AI's people use the same rules).
  check(Object.values(KITS).every((K) => [...(K.weapons || []), ...(K.strong || [])].filter((k) => isGun(k)).every((k) => platformOf(k))), "every gun in the AI's kits has a platform");
}

// ---------- a gun with no platform (another branch's) ----------
console.log("Guessing a platform");
{
  const fake = {
    t_rev44: [{ name: ".44 Magnum revolver", cat: "pistol", desc: "A six-shot .44." }, "357", "revolver"],
    t_p90: [{ name: "P90-style PDW", cat: "automatic", desc: "A bullet hose." }, "9mm", "pdw"],
    t_lever44: [{ name: "Lever-action .44 carbine", cat: "rifle", desc: "A ranch gun." }, "357", "lever"],
    t_single223: [{ name: ".223 single-shot rifle", cat: "rifle", desc: "One round." }, "556", "single"],
    t_arpistol: [{ name: "AR pistol", cat: "pistol", desc: "A short AR-15." }, "556", "arpistol"],
    t_varmint: [{ name: ".223 varmint rifle", cat: "rifle", desc: "A heavy-barrelled bolt gun." }, "556", "bolt"],
    t_g3: [{ name: "Roller-delayed battle rifle", cat: "automatic", desc: "A .308." }, "308", "battle"],
  };
  for (const [k, [d, cal]] of Object.entries(fake)) { GEAR[k] = { slot: "weapon", skill: "shooting", power: 3, req: 0, value: 10, noise: 2, weight: 1, ...d }; GUN_WEAPONS[k] = { cal }; }
  for (const [k, [, , want]] of Object.entries(fake)) check(guessPlatform(k) === want && platformOf(k) === want, `${GEAR[k].name}: ${want} (${guessPlatform(k)})`);
  check(!modFits("t_rev44", "foregrip") && modFits("t_rev44", "can9") && !modFits("t_single223", "foregrip") && !reachable("t_single223").includes("mag") && !reachable("t_p90").includes("grip"), "and its slots follow its kind (no foregrip on the .44 revolver or a single-shot, no foregrip on the P90)");
  for (const k of Object.keys(fake)) { delete GEAR[k]; delete GUN_WEAPONS[k]; delete WEAPON_PLATFORM[k]; }
}

// ---------- the parts catalogue (user, 2026-10-10: Tarkov-like and common US parts, cheaper and worse Chinese clones) ----------
console.log("Parts catalogue");
{
  const RARITIES = ["common", "uncommon", "scarce", "rare", "veryrare"];
  const known = new Set([...Object.values(SITE_TAGS), ...Object.values(AREA_TAGS), ...Object.values(PART_FINDS.WARE_TAGS)].flat());
  const insane = [];
  for (const [k, i] of Object.entries(PART_INFO)) {
    const a = ATTACH[k], d = GEAR[k];
    if (!a || !d || d.cat !== "gunmod" || !d.small) insane.push(`${k}: not a gunmod item`);
    else if (!(i.value >= 1 && i.value <= 300) || !(i.weight > 0 && i.weight <= 1.5)) insane.push(`${k}: value ${i.value}, kg ${i.weight}`);
    else if (!["brand", "civil", "budget"].includes(i.tier) || !RARITIES.includes(i.rarity) || !i.tags.length || !i.tags.every((tg) => known.has(tg))) insane.push(`${k}: tier/rarity/tags`);
    else if (!!i.dur !== (i.tier === "budget" && !!i.dur) || (i.tier === "budget" && !i.brandOf) || (i.brandOf && i.tier !== "budget")) insane.push(`${k}: budget fields`);
    else if (i.tier !== "civil" && !/\(|-style|modelled on|Chinese|copy|clone|marketplace/i.test(i.name + " " + i.desc)) insane.push(`${k}: names no maker or origin`);
    else if (!(GEAR[k].value === i.value && GEAR[k].weight === i.weight && GEAR[k].name === i.name)) insane.push(`${k}: GEAR differs from PART_INFO`);
  }
  check(!insane.length, `every new part is a sane item: a value and weight in range, a tier, a rarity, known tags, a maker named (${insane.join("; ") || "all"})`);
  const waits = [];
  const unfit = Object.keys(PART_INFO).filter((k) => !waits.includes(k) && !guns.some((g) => modFits(g, k)));
  check(!unfit.length, `every new part fits at least one gun there is now (${unfit.join(", ") || "all"})`);
  check(platformOf("arpistol") === "ar15" && modFits("arpistol", "pistolbrace") && !modFits("arpistol", "collapsible") && !modFits("ar15rifle", "pistolbrace") && modFits("arpistol", "pgrip") && modFits("arpistol", "chandle") && !reachable("arpistol").includes("under") && !reachable("arpistol").includes("bipod") && modFits("arpistol", "mag_stanag_30"),
    "the AR pistol (an AR-15: its magazines and parts) takes a pistol brace as its only stock, a pistol grip and a charging handle, no M203 or bipod; a full AR no brace");
  // Budget clones: strictly worse and cheaper than the part they copy.
  const better = { aim: 1, close: 1, opt: 1, brace: 1, moving: 1, nightNear: 1, night: 1, peq: 1, reload: 1, hand: 1, magCap: 0 };
  const worse = [];
  const clones = [...Object.entries(PART_INFO).filter(([, i]) => i.brandOf), ...Object.entries(BUDGET_MAGS)];
  for (const [k, i] of clones) {
    const a = ATTACH[k], b = ATTACH[i.brandOf];
    if (!a || !b || a.slot !== b.slot) { worse.push(`${k}: copies ${i.brandOf} (no such part in that slot)`); continue; }
    const bad = [];
    for (const f of Object.keys(better)) if ((a[f] || 0) > (b[f] || 0)) bad.push(f);
    if ((a.fall || 0) < (b.fall || 0)) bad.push("fall");
    if ((a.jam ?? 1) < (b.jam ?? 1)) bad.push("jam");
    if ((b.noise ?? 1) < 1 ? (a.noise ?? 1) < (b.noise ?? 1) : (a.noise ?? 1) < (b.noise ?? 1)) bad.push("noise");
    if ((a.light && !b.light) || (a.flashless && !b.flashless) || (a.thermal && !b.thermal)) bad.push("flags");
    if ((a.adds || []).length > (b.adds || []).length) bad.push("adds");
    if ((Number.isFinite(a.wt) || Number.isFinite(b.wt)) && fittedKgOf(k) < fittedKgOf(i.brandOf) - 1e-9) bad.push("kg"); // (a fitted handguard or stock: its weight on the gun counts)
    const strictly = Object.keys(better).some((f) => (a[f] || 0) < (b[f] || 0)) || (a.fall || 0) > (b.fall || 0) || (a.jam ?? 1) > (b.jam ?? 1) || Math.abs((a.noise ?? 1) - 1) < Math.abs((b.noise ?? 1) - 1) && (b.noise ?? 1) < 1 || ((b.noise ?? 1) > 1 && (a.noise ?? 1) > (b.noise ?? 1)) || (a.close || 0) < (b.close || 0) || (GEAR[k].dur && !GEAR[i.brandOf].dur) || fittedKgOf(k) > fittedKgOf(i.brandOf);
    if (bad.length || !strictly) worse.push(`${k} vs ${i.brandOf}: ${bad.join(", ") || "no worse"}`);
    if (!(GEAR[k].value < GEAR[i.brandOf].value)) worse.push(`${k}: ${GEAR[k].value} not cheaper than ${i.brandOf} ${GEAR[i.brandOf].value}`);
  }
  check(clones.length >= 20 && !worse.length, `every budget clone (${clones.length}) is strictly worse and cheaper than the part it copies (${worse.join("; ") || "all"})`);
  check(Object.values(PART_INFO).filter((i) => i.tier === "budget").every((i) => i.rarity === "common" || i.rarity === "uncommon") && Object.values(PART_INFO).filter((i) => i.tier === "brand").every((i) => i.rarity !== "common"), "the clones are common, the brands never");
  // Where they turn up: clones in homes, malls and the town; brands at the gun store, the police, the military.
  const town = partPool(SITE_TAGS.town), mil = partPool(SITE_TAGS.military), house = partPool(AREA_TAGS.house), shop = partPool(SITE_TAGS.gunstore);
  check(town.cheapdot > 0 && house.cheaplight > 0 && !town.aimpoint && !house.can556pro && mil.aimpoint > 0 && mil.can556pro > 0 && !mil.cheapdot && shop.huntscope > 0, "budget clones in homes and towns, brands at the military and the gun store");
  check(Object.keys(PART_INFO).every((k) => [...Object.keys(PART_FINDS.site).map((s) => SITE_TAGS[s]), ...Object.keys(PART_FINDS.area).map((a) => AREA_TAGS[a]), ...Object.values(PART_FINDS.WARE_TAGS)].some((tg) => partPool(tg)[k] > 0)), "every new part can be found somewhere or bought");
  check(Object.entries(PART_FINDS.site).every(([s]) => Object.keys(partPool(SITE_TAGS[s])).every((k) => fitsTags(k, SITE_TAGS[s]))), "a site's catalogue finds all fit its tags");
  // Budget parts wear out; a side-saddle loads a shell more; the AI's people carry the catalogue too.
  const g = gunItem("ar", {}); fitMod(g, { ...newItem("cheapdot", 1), dur: 1 });
  const gone = wearMakeshiftMods(g, 1);
  check(gone.length === 1 && gone[0].key === "cheapdot" && !(g.mods && g.mods.optic), "a budget red dot falls apart when its fights run out");
  const pump = gunItem("shotgun", {}); fitMod(pump, newItem("sidesaddle", 1));
  check(gunMods(pump).reload === 1 && gunMods(gunItem("tacpump", {})).reload === 0, "a side-saddle: a Reload puts one more shell in the tube");
  const kitParts = new Set(Object.values(ENEMY_MODS).flatMap((row) => Object.values(row).flatMap((r) => r[1])));
  check(["aimpoint", "cheapdot", "surefire", "cheaplight", "huntscope", "cheapscope", "can556pro", "cheapcan", "pgrip", "chandle", "sidesaddle"].every((k) => kitParts.has(k)), "the AI's people's kits draw from the catalogue (brands for soldiers and guards, clones for raiders and survivors)");
  check(STARTER_MODS.filter((k) => PART_INFO[k]).length >= 8 && STARTER_MODS.every((k) => GEAR[k].value <= 25), "the dice's starter parts include the cheap clones (all low-value)");
}

// ---------- the user's picks of 2026-10-10 ----------
console.log("Picks: the hunting rifle's scope, the magnifier, drift, more clones, buttstock carriers");
{
  // 1. The hunting rifle: a sight slot, its scope a factory part; fitted, its numbers are what they were.
  const hr = newItem("huntrifle", 1), w = WEAPONS.huntrifle, gm = gunMods(hr);
  check(baseSlots("huntrifle").includes("optic") && hr.mods && hr.mods.optic && hr.mods.optic.key === "huntrifscope", "the hunting rifle has a sight slot and comes with its scope fitted (a part)");
  check(w.aim + gm.aim === 5 && w.opt + gm.opt === 12 && Math.abs(w.fall + gm.fall - 2) < 1e-9 && w.close + gm.close === -10, `with its scope its numbers are as before (aim ${w.aim + gm.aim}, best range ${w.opt + gm.opt}, fall-off ${(w.fall + gm.fall).toFixed(1)}, close ${w.close + gm.close})`);
  check(Math.abs(GEAR.huntrifle.weight + GEAR.huntrifscope.weight - 4) < 1e-9 && GEAR.huntrifle.value + GEAR.huntrifscope.value === 55, "its weight and worth with the scope are as before (4 kg, 55)");
  const sw = newItem("huntrifle", 1); stripMod(sw, "optic");
  check(!fitMod(sw, newItem("huntscope", 1)).why && sw.mods.optic.key === "huntscope" && gunMods(sw).aim > gm.aim, "the scope comes off for a better one (a Leupold-style hunting scope: +1 more aim)");
  // 2. The magnifier: its own slot behind a red dot or holo sight.
  const ar = newItem("ar", 1);
  check(!!fitsSlot(ar, newItem("magnifier", 1)) && /red dot|holo|sight/i.test(fitsSlot(ar, newItem("magnifier", 1))), `no magnifier without a sight to sit behind ("${fitsSlot(ar, newItem("magnifier", 1))}")`);
  fitMod(ar, newItem("holo", 1));
  check(!fitMod(ar, newItem("magnifier", 1)).why && ar.mods.magnifier, "a holo sight opens the magnifier slot; the magnifier goes behind it");
  const am = gunMods(ar);
  check(am.aim === 5 && am.close === 1 && am.opt === 2 && Math.abs(am.fall + 0.3) < 1e-9, "a holo sight and a magnifier: the old combined part's numbers (+5 aim, +1 close, +2 range, −0.3 fall-off)");
  const off = stripMod(ar, "optic");
  check(off.length === 2 && !ar.mods, "taking the sight off takes the magnifier with it");
  check(!reachable("dbshotgun").includes("magnifier") && !reachable("pistol").includes("magnifier") && !reachable("huntrifle").includes("magnifier") && reachable("shotgun").includes("magnifier") && reachable("ak").includes("magnifier"),
    "a magnifier on rifles and shotguns with a red dot (even on rings or a side mount), never a pistol, a break action or a bolt rifle");
  check(!GEAR.holomag && !GEAR.cheapmag && !ATTACH.holomag, "the combined holo + magnifier parts are gone (split into two)");
  // 4. Budget sights drift off zero, re-zeroed at a workbench.
  const cd = newItem("ar", 1); fitMod(cd, newItem("cheapdot", 1));
  const fresh = gunMods(cd).aim;
  for (let i = 0; i < 12; i++) wearMakeshiftMods(cd, 1);
  check(cd.mods.optic.zero === 12 && driftOf(cd.mods.optic) === 2 && gunMods(cd).aim === fresh - 2 && /off zero, −2 aim/.test(modsText(cd)), `a budget red dot 12 fights on is off zero: −2 aim, and the tooltip says so ("${modsText(cd)}")`);
  for (let i = 0; i < 10; i++) wearMakeshiftMods(cd, 1);
  check(driftOf(cd.mods.optic) === 4 || !cd.mods, "it drifts no further than −4 (or breaks first)");
  check(/drifts off zero/.test(attachText("cheapdot")) && !/drifts off zero/.test(attachText("aimpoint")) && driftOf(newItem("aimpoint", 1)) === 0, "only budget sights drift (the brands hold zero)");
  const st0 = createWorld({ seed: 9, factionCount: 3 });
  const H0 = hub(st0);
  const rz = newItem("ar", 1); fitMod(rz, newItem("cheapdot", 1)); rz.mods.optic.zero = 11; H0.armory.push(rz);
  const hadBench = benchTier(H0) >= 2;
  if (!hadBench) addBuilding(H0, Object.keys(BUILDINGS).find((k) => BUILDINGS[k].family === "bench" && BUILDINGS[k].tier === 2));
  st0.hour = Math.floor(st0.hour / 24) * 24 + REZERO_HOUR;
  const n = rezeroHour(st0);
  check(benchTier(H0) >= 2 && n >= 1 && rz.mods.optic.zero === 0 && driftOf(rz.mods.optic) === 0, `at a base with a workbench, budget sights are re-zeroed every morning (${n})`);
  // 5. More clones (strictly worse and cheaper: the clones check above); 6. buttstock carriers.
  check(["cheapcan308", "cheapcan12", "cheapsling", "cheapmagnifier", "cheapcuff"].every((k) => PART_INFO[k] && PART_INFO[k].tier === "budget") && MAGAZINES.mag_ak_75c && MAGAZINES.mag_ak_75c.jam > MAGAZINES.mag_ak_75.jam && modFits("ak", "mag_ak_75c"),
    "the new clones: a .308 fuel-filter can, a shotgun can, a sling, a magnifier, an elastic shell holder, a Chinese AK drum (jams more)");
  check(modFits("dbshotgun", "buttcuff") && modFits("single12", "buttcuff") && modFits("shotgun", "buttcuff") && modFits("leverrifle", "riflecuff") && !reachable("sawnoff").includes("cuff") && !reachable("singlerifle").includes("cuff") && !reachable("ar").includes("cuff") && !modFits("leverrifle", "buttcuff"),
    "a buttstock shell holder on break actions, pumps and semi-autos (not the sawn-off), a cartridge cuff on a lever-action; none on a single-shot rifle or an AR");
  const db = newItem("dbshotgun", 1); fitMod(db, newItem("buttcuff", 1));
  const lv = newItem("leverrifle", 1); fitMod(lv, newItem("riflecuff", 1));
  check(gunMods(db).hand === 5 && gunMods(lv).reload === 1 && /loose shells at hand/.test(attachText("buttcuff")), "a shell holder: 5 more shells at hand at a fight's start; a cartridge cuff: a round more a Reload");
  check(["magnifier", "cheapmagnifier", "huntrifscope", "cheapcan308", "cheapcan12", "cheapsling", "buttcuff", "cheapcuff", "riflecuff"].every((k) => /^p:|^[a-z]/.test(lookOf({ key: k }, ATTACH[k].slot)) && PART_ART[lookOf({ key: k }, ATTACH[k].slot)]), "every new part has a look (ui/gunspecs.js PART_SPEC)");
  check(!reachable("shotgun").includes("grip") && reachable("tacpump").includes("grip"), "pick 3: the foregrip stays the police pump's only");
}

// ---------- old saves: parts that no longer fit ----------
console.log("Migration");
{
  const st = createWorld({ seed: 5, factionCount: 4 });
  st.started = true;
  const H = hub(st), s0 = st.survivors[0], s1 = st.survivors[1];
  // In the armory: a plain pump with a foregrip (it fitted before 2026-10-10) and a red dot that still fits.
  const pump = gunItem("shotgun", { grip: newItem("foregrip", 0.8), optic: newItem("reddot", 1), mount: newItem("scopemount", 1) });
  H.armory.push(pump);
  // In someone's hands: a revolver with a weapon light (now a laser grip only) and its rubber grips (still fine).
  const rev = gunItem("revolver", { tactical: newItem("weaponlight", 0.9), grip: newItem("revgrip", 1) }); // (its grips under the old slot key: they move to the pistol grip)
  s0.gear.weapon = rev;
  // In someone's hands with full pockets and pack: a sawn-off with a sling and a stock part on it (nowhere on them).
  const sawn = gunItem("sawnoff", { stock: newItem("recoilpad", 1), sling: newItem("sling", 1) });
  s1.gear.weapon = sawn;
  const filler = Object.keys(GEAR).find((k) => GEAR[k].small && GEAR[k].slot === "pack" && !ATTACH[k] && !GEAR[k].count && !GEAR[k].pouch);
  s1.pockets = s1.pockets.map(() => newItem(filler, 1));
  if (Array.isArray(s1.gear.pack)) s1.gear.pack = s1.gear.pack.map(() => newItem(filler, 1));
  if (s1.gear.rig) s1.gear.rig = null;
  const fine = gunItem("ar", { optic: newItem("acog", 1), rail: newItem("quadrail", 1), grip: newItem("foregrip", 1) });
  // From before the picks of 2026-10-10 (attachV 1): a combined holo + magnifier on an AR and a loose budget set, a
  // hunting rifle without its scope part.
  const combo = gunItem("m4", { optic: { key: "holomag", name: "Holo sight and 3× magnifier", quality: 0.9 } });
  H.armory.push(combo, { key: "cheapmag", name: "Budget dot and 3× magnifier set (Chinese clone)", quality: 0.8, dur: 10 });
  const oldHr = gunItem("huntrifle", {}); delete oldHr.mods; H.armory.push(oldHr);
  st.attachV = 1;
  H.armory.push(fine);
  const before = H.armory.length;
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const bH = hub(back);
  const bPump = bH.armory.find((g) => g.key === "shotgun" && g.mods && g.mods.optic);
  const bRev = back.survivors[0].gear.weapon, bSawn = back.survivors[1].gear.weapon;
  check(bPump && !bPump.mods.grip && bPump.mods.optic.key === "reddot" && bPump.mods.mount.key === "scopemount", "the pump's foregrip came off; its red dot and rings stayed");
  check(bH.armory.some((x) => x.key === "foregrip" && x.quality === 0.8), "the foregrip is kept beside the pump in the armory (its condition with it)");
  check(bRev && bRev.key === "revolver" && !(bRev.mods && bRev.mods.tactical) && !bRev.mods.grip && bRev.mods.pgrip && bRev.mods.pgrip.key === "revgrip", "the revolver's weapon light came off; its grips stayed (moved to the pistol-grip slot)");
  const carried = (s) => [...(s.pockets || []), ...(Array.isArray(s.gear.pack) ? s.gear.pack : []), ...((s.gear.rig && s.gear.rig.pouches) || [])].filter(Boolean);
  check(carried(back.survivors[0]).some((x) => x.key === "weaponlight") || bH.armory.some((x) => x.key === "weaponlight"), "the weapon light is kept (in its owner's kit, else the armory)");
  check(bSawn && bSawn.mods && bSawn.mods.sling && !bSawn.mods.stock && (bH.armory.some((x) => x.key === "recoilpad") || carried(back.survivors[1]).some((x) => x.key === "recoilpad")), "the sawn-off's recoil pad came off and was kept (no room on its owner: the armory)");
  const bFine = bH.armory.find((g) => g.key === "ar");
  check(bFine && bFine.mods.optic.key === "acog" && bFine.mods.grip.key === "foregrip" && bFine.mods.rail.key === "quadrail", "an AR whose parts all fit is left alone");
  check(bH.armory.length >= before + 1, `the armory grew by what came off there (${before} → ${bH.armory.length})`);
  const line = (back.log || []).find((l) => /no longer fit their guns/.test(l.text));
  if (process.env.SHOW) console.log("   ", line && line.text);
  check(!!line && /Vertical foregrip|foregrip/i.test(line.text) && /revolver/i.test(line.text), `a log line says what came off (${line ? line.text : "none"})`);
  const bCombo = bH.armory.find((g) => g.key === "m4" && g.mods && g.mods.magnifier);
  check(bCombo && bCombo.mods.optic.key === "holo" && bCombo.mods.optic.quality === 0.9 && bCombo.mods.magnifier.key === "magnifier", "an old combined holo + magnifier on a gun: now a holo sight and a magnifier, both fitted");
  check(bH.armory.some((x) => x.key === "cheapdot" && x.dur === 10) && bH.armory.some((x) => x.key === "cheapmagnifier") && !bH.armory.some((x) => x.key === "cheapmag"), "a loose old budget set: a budget red dot (its wear kept) and a budget magnifier beside it");
  check(bH.armory.filter((g) => g.key === "huntrifle").every((g) => g.mods && g.mods.optic && g.mods.optic.key === "huntrifscope") && back.attachV === 2, "every old hunting rifle has its scope fitted as a part");
  // Loading again moves nothing more (a part is never lost or doubled).
  const again = deserializeState(JSON.parse(JSON.stringify(serializeState(back))));
  const count = (S, key) => { let n = 0; const seen = new Set(); const w = (o) => { if (!o || typeof o !== "object" || seen.has(o)) return; seen.add(o); if (o.key === key && o.name) n++; for (const v of Object.values(o)) w(v); }; w(S.survivors); w(S.bases); return n; };
  check(count(again, "foregrip") === count(back, "foregrip") && count(again, "weaponlight") === count(back, "weaponlight") && !(again.log || []).filter((l) => /no longer fit their guns/.test(l.text)).slice(1).length, "a second load moves nothing and adds no line");
  check(misfitNote([]) === "", "no line when nothing moved");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
