// The survival guns, parts and gear of 2026-10-19 (sim/data-survival.js, sim/survival.js; data-guns.js SURV_GEAR,
// data-gunmods.js's platforms and parts, data-kit.js SURV_MAGS / SURV_INTERNAL / SURV_CLIPS): every item is real and
// drawn, sits in its peers' range of numbers, and works through the system it belongs to (a pry bar forces locks, the
// armour has its class, a light shines, the rig has pouches, the bag is a med kit, the rangefinder is an optic, the
// carbine takes pistol magazines, the SKS fills from a clip), and every one turns up somewhere.
// Usage: node tools/survivaltest.js
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, toDataURL: () => "data:image/png;base64,AAAA" }) };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };

const { GEAR } = await import("../src/sim/data.js");
const { WEAPONS, KITS } = await import("../src/sim/combat.js");
const { createWorld, makeSurvivor, hub } = await import("../src/sim/world.js");
const { newItem, ensureInv, rigPouches, fitReason } = await import("../src/sim/inventory.js");
const { ARMOUR } = await import("../src/sim/armour.js");
const { LIGHTS, lightOf } = await import("../src/sim/lights.js");
const { barOf } = await import("../src/sim/locks.js");
const { kitBonusOf } = await import("../src/sim/medics.js");
const { opticsFor } = await import("../src/sim/optics.js");
const { modFits, ATTACH } = await import("../src/sim/gunmods.js");
const { magFitsGun, standardMag } = await import("../src/sim/mags.js");
const { MAGAZINES, INTERNAL, CLIPS } = await import("../src/sim/data-kit.js");
const { SURV_GEAR, SURV_WEAPONS, GUN_CLASS, GUN_RARITY } = await import("../src/sim/data-guns.js");
const { PART_INFO } = await import("../src/sim/data-gunmods.js");
const { SURV_ITEMS, SURV_TAGS, SURV_HELP } = await import("../src/sim/data-survival.js");
const { ITEM_TAGS } = await import("../src/sim/loot.js");
const { SURV_FINDS, AREA_SURV, WARE_SURV, rollSurvFind, rollAreaSurv, survWares, scavSurv } = await import("../src/sim/survival.js");
const { hasItemArt } = await import("../src/ui/itemart.js");
const { GUN_ART } = await import("../src/ui/gunspecs.js");

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
const section = (t) => console.log(t);

const GUNS = Object.keys(SURV_GEAR);
const PARTS = ["nvscope", "prism2x", "zhukov", "afg", "linearcomp", "singlepoint", "tapedlight"];
const MAGS = ["mag_uzi_20", "mag_uzi_32", "mag_ar7_8"];
const GEAR_KEYS = Object.keys(SURV_ITEMS);

section("Items");
check([...GUNS, ...PARTS, ...MAGS, "stripper762", ...GEAR_KEYS].every((k) => GEAR[k] && GEAR[k].name && GEAR[k].desc && GEAR[k].weight > 0 && GEAR[k].value > 0 && GEAR[k].cat), "every new item is in GEAR with a name, a description, a weight, a worth and a trade category");
check([...PARTS, ...MAGS, "stripper762", ...GEAR_KEYS].every((k) => hasItemArt(k)), "every new item that is not a gun has its own icon");
check(GUNS.every((k) => GUN_ART[k]), "every new gun has its own drawing spec");
check([...GUNS, ...GEAR_KEYS].every((k) => ITEM_TAGS[k] && ITEM_TAGS[k].length), "every new gun and piece of gear has theme tags");
check(GUNS.every((k) => GUN_CLASS[k] && GUN_RARITY[k] && WEAPONS[k] && GEAR[k].dur > 0), "every new gun has a class, a rarity, battle numbers and durability");
check(/SKS/.test(SURV_HELP) && /Halligan/.test(SURV_HELP), "the Help topic names them");

section("Guns in their peers' range");
const within = (k, peers, f) => { const v = peers.map((p) => f(p)); return f(k) >= Math.min(...v) * 0.8 && f(k) <= Math.max(...v) * 1.2; };
check(within("sks", ["ranch223", "ak", "lever44"], (k) => GEAR[k].power) && WEAPONS.sks.cal === WEAPONS.ak.cal && WEAPONS.sks.dmg[0] === WEAPONS.ak.dmg[0], "the SKS: an AK's round and hits, a semi-auto's power");
check(GEAR.sks.value < GEAR.ak.value && GEAR.sks.power < GEAR.ak.power, "the SKS is cheaper and weaker than the AK (no full auto, ten rounds)");
check(GEAR.uzi.power < GEAR.smg.power && WEAPONS.uzi.modes.auto.aim > WEAPONS.smg.modes.auto.aim, "the Uzi: a little under the MP5, steadier on full auto");
check(GEAR.pcc9.power > GEAR.pistol.power && GEAR.pcc9.power < GEAR.carbine.power && WEAPONS.pcc9.opt > WEAPONS.pistol.opt, "the folding carbine: between the 9mm pistol and the police carbine, with more reach than the pistol");
check(WEAPONS.ksg.cap === 14 && GEAR.ksg.power > GEAR.shotgun.power && GEAR.ksg.power < GEAR.semishotgun.power && WEAPONS.ksg.rel > WEAPONS.shotgun.rel, "the bullpup pump: 14 shells, between the pump and the semi-auto, fussier than a plain pump");
check(GEAR.survival22.weight < GEAR.rifle22.weight && GEAR.survival22.power <= GEAR.rifle22.power && WEAPONS.survival22.rel >= WEAPONS.rifle22.rel, "the takedown .22: lighter, no stronger and no more reliable than the .22 rifle");

section("Magazines, clips and parts");
check(magFitsGun("pcc9", "mag_glock_17") && magFitsGun("pcc9", "mag_glock_33") && magFitsGun("pistol", "mag_glock_17"), "the folding carbine takes the polymer pistols' magazines, and the pistol still does");
check(magFitsGun("uzi", "mag_uzi_32") && !magFitsGun("uzi", "mag_glock_17") && !magFitsGun("smg", "mag_uzi_32"), "the Uzi takes its own magazines and no other gun does");
check(magFitsGun("survival22", "mag_ar7_8") && !magFitsGun("rifle22", "mag_ar7_8"), "the takedown .22 takes its own eight-rounders");
check(!standardMag("sks") && INTERNAL.sks > 0 && CLIPS.stripper762.weapons.includes("sks") && CLIPS.stripper762.n === WEAPONS.sks.cap, "the SKS: a fixed box filled by hand or from a ten-round stripper clip");
check(INTERNAL.ksg > 0 && !standardMag("ksg"), "the bullpup pump loads its tubes a few shells a Reload");
check(modFits("ak", "zhukov") && modFits("sks", "zhukov") && !modFits("ar", "zhukov"), "the Zhukov stock fits a Kalashnikov and an SKS, not an AR");
check(modFits("sks", "sidemount") && !modFits("sks", "mag_ak_30"), "the SKS takes the AK's side mount, not its magazines");
check(["ar", "huntrifle", "shotgun"].every((g) => modFits(g, "nvscope")) && ATTACH.nvscope.night > 0, "the night vision scope fits any gun with a sight and helps at night");
check(modFits("ak", "linearcomp") && !modFits("pistol", "linearcomp") && !(ATTACH.linearcomp.noise > 1), "the linear comp fits rifles and adds no noise");
check(modFits("ksg", "afg") && modFits("ksg", "weaponlight") && !modFits("ksg", "recoilpad") && !modFits("ksg", "tubeext"), "the bullpup pump takes a grip and a light, no stock pad or tube extension");
check(PART_INFO.tapedlight.dur > 0 && ATTACH.tapedlight.nightNear < ATTACH.weaponlight.nightNear && GEAR.tapedlight.value < GEAR.weaponlight.value, "the taped flashlight: a worse, cheaper weapon light that wears out");
check(MAGS.every((k) => MAGAZINES[k]), "the new magazines are magazines");

section("Gear through its systems");
const st = createWorld({ seed: 11, factionCount: 6 });
const person = () => { const s = makeSurvivor(st); for (const k of Object.keys(s.gear)) s.gear[k] = null; s.pockets = s.pockets.map(() => null); s.location = { kind: "base", baseId: hub(st).id }; st.survivors.push(s); ensureInv(s); s.skills.medicine = 6; return s; };
{
  const s = person();
  check(!barOf(s), "no pry bar, nothing to force a lock with");
  s.gear.weapon = newItem("halligan");
  check(!!barOf(s) && WEAPONS.halligan.melee && WEAPONS.halligan.stab, "the Halligan bar forces locks, and it is a melee weapon whose pick finds a dead soldier's gap");
  check(WEAPONS.halligan.dmg[1] < WEAPONS.fireaxe.dmg[1] && WEAPONS.pipewrench.dmg[1] < WEAPONS.prybar.dmg[1] + 1 && GEAR.pipewrench.dur > GEAR.prybar.dur, "the bar hits under a fire axe, the wrench about a crowbar and outlasts it");
}
check(ARMOUR.leatherjacket.ac === 1 && ARMOUR.chainsleeves.ac === 2 && ARMOUR.motopants.ac === 1 && ["leatherjacket", "chainsleeves", "motopants"].every((k) => ARMOUR[k].dmax === GEAR[k].dur), "the armour has its class, and its durability is the item's");
check(GEAR.leatherjacket.slot === "armor" && GEAR.chainsleeves.slot === "arms" && GEAR.motopants.slot === "legs", "torso, arms and legs");
{
  const s = person();
  s.pockets[0] = newItem("anglelight");
  check(lightOf(s) === "anglelight", "an angle-head flashlight in a pocket lights the way, hands free");
  s.gear.tool = newItem("solarlantern");
  check(LIGHTS.solarlantern.pool < LIGHTS.lantern.pool && GEAR.solarlantern.weight < GEAR.lantern.weight && LIGHTS.anglelight.sight > LIGHTS.headlamp.sight && LIGHTS.anglelight.seen > LIGHTS.headlamp.seen, "the solar lantern: dimmer and lighter than the lantern; the angle-head light: further than a headlamp, seen further off");
}
{
  const s = person();
  check(!fitReason(newItem("legrig"), "rig", s), "a drop-leg rig goes on the Rig slot");
  s.gear.rig = newItem("legrig");
  const P = rigPouches(s), kinds = GEAR.legrig.pouches.join();
  check(Array.isArray(P) && P.length === 4 && kinds === "pistol,pistol,admin,pocket", `it has two pistol pouches, an admin pouch and a pocket (${kinds})`);
}
{
  const s = person();
  const bonus = kitBonusOf(s, newItem("jumpbag"));
  check(bonus > 0 && GEAR.jumpbag.medKit === 3 && !GEAR.jumpbag.small, `the jump bag is a med kit (+${bonus} Medicine for a medic of 6), too big for a pocket`);
  const s2 = person(); s2.pockets[0] = newItem("rangefinder");
  const o = opticsFor([s2]);
  check(o.look > 1 && o.reach >= 1 && o.look < opticsFor([Object.assign(person(), { pockets: [newItem("binoculars")] })]).look, "the rangefinder is an optic, a little under binoculars for looking");
}

section("Where they turn up");
const listed = new Set([...Object.values(SURV_FINDS), ...Object.values(AREA_SURV), ...Object.values(WARE_SURV)].flatMap((t) => Object.keys(t.items)));
check(GEAR_KEYS.every((k) => listed.has(k)), "every piece of survival gear is in a find table");
check([...listed].every((k) => SURV_TAGS[k]), "only survival gear in its tables");
{
  const town = Object.keys(st.tiles).find((id) => st.tiles[id].loc && st.tiles[id].loc.type === "hardware") ?? Object.keys(st.tiles).find((id) => st.tiles[id].loc && SURV_FINDS[st.tiles[id].loc.type]);
  let n = 0;
  for (let h = 0; h < 3000; h++) { st.hour = h; if (rollSurvFind(st, town, 1, "t")) n++; }
  check(n > 0, `a search turns them up now and then (${n} in 3000 hours at a ${st.tiles[town].loc.type})`);
  let a = 0, w = 0, sc = 0;
  for (let i = 0; i < 500; i++) if (rollAreaSurv(st, town, "garage", `g${i}`)) a++;
  for (let i = 0; i < 300; i++) w += survWares(st, "traders", `T${i}`).length;
  for (let i = 0; i < 400; i++) if (scavSurv("hardware", [st.seed, "t", i])) sc++;
  check(a > 0 && w > 0 && sc > 0, `in garages (${a}/500), on traders' tables (${w}/300) and for the groups' scavengers (${sc}/400)`);
}
check(["raiders", "survivors", "militia", "fighters"].every((k) => KITS[k].weapons.some((g) => GUNS.includes(g)) || (KITS[k].strong || []).some((g) => GUNS.includes(g))), "raiders, survivors, militia and fighters carry the new guns");
check(KITS.raiders.loot.includes("leatherjacket") && KITS.fighters.loot.includes("halligan"), "bodies carry the gear");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
