// @ts-check
// Carry kit (docs/weapons-overhaul-plan.md sections 15-18): magazines as items, rigs, plate carriers and inserts,
// helmets and their attachments. Plain data that imports nothing; data.js merges KIT_GEAR into GEAR, gunmods.js merges
// KIT_ATTACH into ATTACH (a magazine fits a gun's "mag" slot). Wave 2 (agent E: magazines, rigs, carriers, inserts).
//
// Magazines ("physical magazines, virtual rounds", section 15): an item per platform and capacity, mag_<plat>_<cap>,
// holding one ammo type (item.load; null: the calibre's common round). The rounds stay counted in the pools (ammo.js);
// a magazine only says how many a gun takes before a reload, how many reloads a fighter has, and which type is loaded.
// A gun with no magazine item fitted has an implicit standard one (WEAPONS cap). The old gunmods "extended pistol
// magazine" (extmag) and "drum magazine" (drum) are magazine items now under their old keys (24 and 60 rounds); the
// shotgun tube extension stays an attachment (an internal magazine). pouch: the rig pouch kind it goes in.
// Empty weight in kg (loaded: + cap × the round's kg, load.js / mags.js magRoundsKg).

/** @type {Record<string, { plat: string[], cal: string, cap: number, kg: number, value: number, name: string, aim?: number, jam?: number, pouch: string, desc?: string }>} */
export const MAGAZINES = {
  mag_glock_8:     { plat: ["glock"], cal: "9mm", cap: 8, kg: 0.06, value: 3, pouch: "pistol", name: "Compact 9mm magazine (8)" },
  mag_glock_15:    { plat: ["glock"], cal: "9mm", cap: 15, kg: 0.07, value: 4, pouch: "pistol", name: "9mm pistol magazine (15)" },
  mag_glock_17:    { plat: ["glock"], cal: "9mm", cap: 17, kg: 0.08, value: 5, pouch: "pistol", name: "9mm pistol magazine (17)" },
  extmag:          { plat: ["glock"], cal: "9mm", cap: 24, kg: 0.15, value: 14, pouch: "pistol", name: "Extended 9mm magazine (24)" },
  mag_glock_33:    { plat: ["glock"], cal: "9mm", cap: 33, kg: 0.18, value: 12, pouch: "pistol", name: "9mm stick magazine (33)", aim: -1 },
  mag_1911_7:      { plat: ["p1911"], cal: "45acp", cap: 7, kg: 0.08, value: 4, pouch: "pistol", name: ".45 pistol magazine (7)" },
  mag_22_10:       { plat: ["rimpistol", "rimrifle"], cal: "22lr", cap: 10, kg: 0.05, value: 3, pouch: "pistol", name: ".22 magazine (10)" },
  mag_22_25:       { plat: ["rimpistol", "rimrifle"], cal: "22lr", cap: 25, kg: 0.09, value: 6, pouch: "pistol", name: ".22 magazine (25)" },
  mag_mp5_30:      { plat: ["mp5"], cal: "9mm", cap: 30, kg: 0.12, value: 6, pouch: "rifle", name: "SMG magazine (30)" },
  mag_stanag_20:   { plat: ["ar15", "m249", "bullpup"], cal: "556", cap: 20, kg: 0.1, value: 4, pouch: "rifle", name: "5.56 magazine (20)" },
  mag_stanag_30:   { plat: ["ar15", "m249", "bullpup"], cal: "556", cap: 30, kg: 0.12, value: 6, pouch: "rifle", name: "5.56 magazine (30)" },
  mag_stanag_40:   { plat: ["ar15", "m249", "bullpup"], cal: "556", cap: 40, kg: 0.15, value: 10, pouch: "rifle", name: "5.56 magazine (40)" },
  drum:            { plat: ["ar15"], cal: "556", cap: 60, kg: 1.1, value: 38, pouch: "rifle", name: "Drum magazine (60)", aim: -2, jam: 1.5 },
  mag_stanag_100:  { plat: ["ar15", "m249", "bullpup"], cal: "556", cap: 100, kg: 1.2, value: 70, pouch: "rifle", name: "5.56 double drum (100)", aim: -2, jam: 1.3 },
  mag_ak_30:       { plat: ["ak"], cal: "762x39", cap: 30, kg: 0.33, value: 6, pouch: "rifle", name: "AK magazine (30)" },
  mag_ak_45:       { plat: ["ak"], cal: "762x39", cap: 45, kg: 0.4, value: 12, pouch: "rifle", name: "AK magazine (45)" },
  mag_ak_75:       { plat: ["ak"], cal: "762x39", cap: 75, kg: 1.3, value: 40, pouch: "rifle", name: "AK drum (75)", aim: -2, jam: 1.3 },
  mag_ar10_10:     { plat: ["ar10"], cal: "308", cap: 10, kg: 0.12, value: 5, pouch: "rifle", name: ".308 rifle magazine (10)" },
  mag_ar10_20:     { plat: ["ar10"], cal: "308", cap: 20, kg: 0.15, value: 8, pouch: "rifle", name: ".308 rifle magazine (20)" },
  mag_bolt_5:      { plat: ["bolt"], cal: "308", cap: 5, kg: 0.1, value: 5, pouch: "rifle", name: "Bolt-action magazine (5)" },
  mag_bolt_10:     { plat: ["bolt"], cal: "308", cap: 10, kg: 0.15, value: 10, pouch: "rifle", name: "Bolt-action magazine (10)" },
  mag_50_10:       { plat: ["amr"], cal: "50bmg", cap: 10, kg: 0.5, value: 20, pouch: "rifle", name: ".50 magazine (10)" },
  mag_m249_100:    { plat: ["m249"], cal: "556", cap: 100, kg: 0.4, value: 15, pouch: "rifle", name: "Belt box (100)" },
  // The arsenal of 2026-10-10 (data-guns.js ARSENAL_GEAR): .308 battle rifle magazines (the FAL's, the M14's and the
  // SCAR-H's, one kind here), the .45 SMG's and pistol's, the hand cannon's, the .308 machine gun's belt.
  mag_battle_10:   { plat: ["battle"], cal: "308", cap: 10, kg: 0.15, value: 6, pouch: "rifle", name: ".308 battle rifle magazine (10)" },
  mag_battle_20:   { plat: ["battle"], cal: "308", cap: 20, kg: 0.25, value: 9, pouch: "rifle", name: ".308 battle rifle magazine (20)" },
  mag_ump_25:      { plat: ["ump"], cal: "45acp", cap: 25, kg: 0.15, value: 7, pouch: "rifle", name: ".45 SMG magazine (25)" },
  mag_poly45_12:   { plat: ["poly45"], cal: "45acp", cap: 12, kg: 0.09, value: 5, pouch: "pistol", name: ".45 pistol magazine (12)" },
  mag_deagle_9:    { plat: ["deagle"], cal: "357", cap: 9, kg: 0.12, value: 8, pouch: "pistol", name: "Magnum pistol magazine (9)" },
  mag_m240_100:    { plat: ["m240"], cal: "308", cap: 100, kg: 0.5, value: 18, pouch: "rifle", name: ".308 belt box (100)" },
};

// Internal magazines (a tube, a cylinder, a fixed box): Reload (1 action) adds this many rounds. A clip item (a
// speedloader, a stripper clip) carried fills it in one action instead (CLIPS). A gun with a magazine item fitted (a
// bolt rifle with a detachable box) reloads by magazine instead.
export const INTERNAL = { shotgun: 4, semishotgun: 4, leverrifle: 4, huntrifle: 3, revolver: 2, dbshotgun: 2, sawnoff: 2, pipegun: 1,
  // the arsenal of 2026-10-10: break actions load both barrels (or the one) a Reload, tubes and a cylinder as before
  ou12: 2, ou20: 2, single12: 1, singlerifle: 1, pump20: 4, tacpump: 4, lever357: 4, snub357: 2 };
// Clip items: the guns they feed and how many rounds a clip puts in at once. Used once a fight (refilled free after it).
export const CLIPS = {
  speedloader: { weapons: ["revolver"], n: 6, pouch: "pistol" }, // (the snub-nose's five-shot cylinder takes none: a speed strip at most)
  stripper308: { weapons: ["huntrifle"], n: 5, pouch: "rifle" },
};

// Carry kit in loot and on bodies (carrykit.js bodyKit / gunMags / the kit tables; inventory.js stowing into rig
// pouches): off only for tools/itemcondtest.js's baselines (the old finds and dice, before the carry kit only added).
export const KIT_LOOT = { on: true };
// Rig pouch kinds (section 16): what goes in each.
export const POUCH_NAMES = { rifle: "Rifle mag", pistol: "Pistol mag", grenade: "Grenade", radio: "Radio", admin: "Admin" };
export const POUCH_ICON = { rifle: "▮", pistol: "▯", grenade: "●", radio: "📻", admin: "✚" };
export const ADMIN_KG = 0.5; // an admin pouch takes small things up to this (meds, a flashlight, tablets, a small box of rounds)

// The gun builder's art for a magazine (ui/gunart.js PART_ART): by its size.
const magLook = (k, cap) => (k === "extmag" ? "extmag" : cap >= 50 ? "drum" : cap > 30 ? "stick40" : cap > 20 ? "stick30" : cap > 10 ? "stick20" : "stick10");
const P = (spec) => spec.flatMap(([kind, n]) => Array.from({ length: n }, () => kind));
// Inserts (section 17): AC / dmax / material are armour.js ARMOUR's; weight, worth and where they turn up here.
/** @type {Record<string, any>} */
export const KIT_GEAR = {
  // Rigs (EQUIP slot "rig"): pouches by kind; carry: kg added to the max load.
  chestrig:     { name: "Chest rig", slot: "rig", skill: null, power: 0, req: 0, value: 30, noise: 0, weight: 0.8, carry: 2, cat: "packs",
    pouches: P([["rifle", 4], ["pistol", 2], ["grenade", 1], ["admin", 2]]),
    desc: "A military chest rig: 4 rifle magazine pouches, 2 pistol pouches, a grenade pouch and 2 admin pouches. A magazine from a pouch reloads in 1 action (2 from the pack); +2 kg max load. Not over a vest or a carrier with its own pouches." },
  makeshiftrig: { name: "Makeshift rig", slot: "rig", skill: null, power: 0, req: 0, value: 6, noise: 0, weight: 0.7, carry: 1, cat: "packs", makeshift: true, dur: 40, burnShare: 0.6,
    pouches: P([["rifle", 2], ["pistol", 1], ["grenade", 1], ["admin", 1]]),
    desc: "A school backpack cut down and sewn into pouches across the chest: 2 rifle magazine pouches, a pistol pouch, a grenade pouch and an admin pouch; +1 kg max load. Crafted from a backpack and a scrap." },
  tacvest:      { name: "Tactical vest", slot: "armor", skill: null, power: 2, req: 0, value: 70, noise: 0, weight: 3.2, carry: 2, dur: 45, cat: "armor",
    pouches: P([["rifle", 3], ["pistol", 2], ["grenade", 1], ["radio", 1], ["admin", 1]]),
    desc: "Soft armour (AC2) with pouches sewn on: 3 rifle magazine pouches, 2 pistol pouches, a grenade, a radio and an admin pouch; +2 kg max load. Police and SWAT kit." },
  plate:        { name: "Plate carrier", slot: "armor", skill: null, power: 4, req: 0, value: 60, noise: 0, weight: 1.5, carry: 1, dur: 40, cat: "armor",
    pouches: P([["rifle", 2], ["pistol", 1], ["grenade", 1], ["admin", 1]]), inserts: ["front", "back"],
    desc: "A military carrier with a soft backer (AC2) and two plate pockets, front and back: ceramic (AC5), steel (AC4) or soft (AC2) inserts. A hit on the chest meets the front plate (the back plate from behind), then the backer. Pouches for 2 rifle magazines, a pistol magazine, a grenade and an admin pouch; +1 kg max load. Swapping a plate: 2 actions in a fight, free at camp." },
  ceramicplate: { name: "Ceramic plate", slot: "insert", skill: null, power: 4, req: 0, value: 40, noise: 0, weight: 2.5, dur: 45, cat: "armor",
    desc: "A ceramic rifle plate for a plate carrier (AC5): stops rifle rounds, but cracks: shatters after enough hard hits, and cannot be repaired." },
  steelplate:   { name: "Steel plate", slot: "insert", skill: null, power: 3.5, req: 0, value: 25, noise: 0, weight: 3.5, dur: 80, cat: "armor",
    desc: "A steel plate for a plate carrier (AC4): heavy and lasting; a stopped rifle round may spall. A workbench can patch it (welding)." },
  softinsert:   { name: "Soft armour insert", slot: "insert", skill: null, power: 2, req: 0, value: 15, noise: 0, weight: 1, dur: 35, cat: "armor",
    desc: "A soft armour panel for a plate carrier (AC2): stops pistol rounds and shot, little against rifles." },
  // Clips (CLIPS): an internal magazine filled at once.
  speedloader:  { name: "Revolver speedloader", slot: "pack", skill: null, power: 0, req: 0, value: 6, noise: 0, small: true, weight: 0.05, cat: "gunmod",
    desc: "Six rounds held ready for a revolver's cylinder: a Reload fills it at once (instead of 2 rounds), once a fight. In a pistol pouch or a pocket." },
  stripper308:  { name: ".308 stripper clip", slot: "pack", skill: null, power: 0, req: 0, value: 2, noise: 0, small: true, weight: 0.02, cat: "gunmod",
    desc: "Five .308 rounds on a clip: a Reload fills the hunting rifle's magazine at once (instead of 3 rounds), once a fight. In a rifle pouch or a pocket." },
};
for (const [k, m] of Object.entries(MAGAZINES)) {
  KIT_GEAR[k] = { name: m.name, slot: "pack", skill: null, power: 0, req: 0, value: m.value, noise: 0, small: true, weight: m.kg, cat: "gunmod", mag: { plat: m.plat, cal: m.cal, cap: m.cap }, pouch: m.pouch, look: magLook(k, m.cap),
    desc: m.desc || `A ${m.cap}-round magazine${m.aim ? ` (heavy and clumsy: ${m.aim} aim${m.jam ? `, jams ×${m.jam}` : ""})` : ""}. It holds one kind of round. A spare in a rig pouch or a pocket reloads in 1 action, from the pack in 2.` };
}
for (const [k, c] of Object.entries(CLIPS)) KIT_GEAR[k].pouch = c.pouch;

// Where each turns up (loot.js ITEM_TAGS: theme tags).
/** @type {Record<string, string[]>} */
export const KIT_TAGS = {
  chestrig: ["military", "guns", "crash"], makeshiftrig: ["crime", "camp"], tacvest: ["police", "prison", "guns"],
  ceramicplate: ["military", "crash"], steelplate: ["guns", "crime", "industry", "military"], softinsert: ["police", "military", "prison"],
  speedloader: ["guns", "police", "home"], stripper308: ["hunt", "guns", "military"],
};
for (const [k, m] of Object.entries(MAGAZINES)) {
  const p = m.plat;
  KIT_TAGS[k] = p.includes("glock") || p.includes("p1911") ? ["guns", "police", "crime", "home"] : p.includes("rimpistol") ? ["guns", "hunt", "farm", "home"]
    : p.includes("ak") ? ["guns", "crime", "military"] : p.includes("bolt") ? ["hunt", "guns", "military"] : p.includes("mp5") ? ["police", "military", "guns"]
    : p.includes("amr") || (p.includes("m249") && !p.includes("ar15")) ? ["military"] : ["military", "guns", "police", "crash"];
}
// Magazines as gun parts (gunmods.js ATTACH: the gun builder's magazine slot lists them by platform).
/** @type {Record<string, any>} */
export const KIT_ATTACH = {};
for (const [k, m] of Object.entries(MAGAZINES)) KIT_ATTACH[k] = { slot: "mag", short: `${m.cap}-round mag`, look: magLook(k, m.cap), fits: { plat: m.plat }, magCap: m.cap, ...(m.aim ? { aim: m.aim } : {}), ...(m.jam ? { jam: m.jam } : {}) };
