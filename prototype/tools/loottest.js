// Loot audit (src/sim/loot.js, data.js LOCATIONS, combat.js AREAS / KITS, and every other place items come from):
// every item has at least one source; everything a site type or raid area can hold fits its theme tags; every item
// has a category, a weight, a value and a description; valuables are light for their worth and good for nothing
// else (the four treats among them, candy, tobacco, wine and whiskey, give mood only: needs.js); weapons have battle numbers and throwables their throw; the small-finds rolls stay within their tables;
// then a table of sources per item (with its worth tier and weight).
// Also: frag grenades and the decoys have sources, ladders and rams are crafted siege kit, every lure has its senses.
// Usage: node tools/loottest.js [--quiet]   (--quiet: checks only, no table)
import { MOD_ATTACH } from "../src/sim/data-gunmods.js";
import { HEAD_FINDS, AREA_HEAD, WARE_HEAD } from "../src/sim/helmets.js"; // helmets and ear protection (their own dice)
import { GEAR, LOCATIONS, CATEGORIES } from "../src/sim/data.js";
import "../src/sim/blueprints.js"; // registers the blueprint items
import { SITE_TAGS, AREA_TAGS, ITEM_TAGS, SITE_FINDS, AREA_FINDS, HUNT_FINDS, LIGHT_FINDS, GUNMOD_FINDS, AREA_GUNMODS, WARE_GUNMODS, SITE_MODS, AREA_MODS, WARE_MODS, PARTS_MIX, sortParts, splitParts, SITE_GRENADES, AREA_GRENADES, SITE_LAUNCHERS, AREA_LAUNCHERS, fitsTags, rollFind, rollAreaFind, SITE_RELOAD, AREA_RELOAD } from "../src/sim/loot.js";
import { TRUCK_GEAR } from "../src/sim/data-guns.js"; // the new military weapons in Army trucks (factoryfit.js rosterTruckGear)
import { FLASH_KIT } from "../src/sim/throwables.js"; // the flashbangs and smoke grenades soldiers and guards carry (on their bodies after)
import { TRUCK_FLASH } from "../src/sim/miltrucks.js";
import { AREAS, AREA_SETS, KITS, WEAPONS } from "../src/sim/combat.js";
import { ZOMBIE_FINDS, ZOMBIE_PACKS, ZOMBIE_PACK_STUFF, ZOMBIE_PACK, enemyBody } from "../src/sim/inventory.js";
import { WARES } from "../src/sim/trade.js";
import { BOOK_SITES, WARE_BOOKS } from "../src/sim/skills.js";
import { RARE_GEAR, TRAVEL_GEAR, MERCHANT_VALUABLES } from "../src/sim/visitors.js";
import { RECRUIT_WEAPONS, RECRUIT_ARMOR, RECRUIT_KIT, RECRUIT_PERSONAL } from "../src/sim/recruits.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { HUMVEE_GEAR, HIKER_STUFF } from "../src/sim/events.js";
import { THROWABLES } from "../src/sim/stealth.js";
import { worthTier } from "../src/sim/valuation.js";
import { newItem, ZBODY } from "../src/sim/inventory.js";
import { MILDEAD } from "../src/sim/deadsoldiers.js";
import { AMMO_GEAR } from "../src/sim/data-ammo.js";
import { Rng } from "../src/sim/rng.js";
import { TREAT_ORDER } from "../src/sim/needs.js";
import { GUN_FINDS, SEARCH_TOOLS, GUN_STASH } from "../src/sim/gunsafes.js"; // gun safes, gun cases, drills (their own dice)
import { SITE_KIT, AREA_KIT, WARE_KIT } from "../src/sim/carrykit.js"; // carry kit: magazines, rigs, plates (their own dice)

const quiet = process.argv.includes("--quiet");
let pass = 0, fail = 0;
function check(ok, msg) {
  if (ok) pass++;
  else { fail++; console.log(`  FAIL: ${msg}`); }
}

// ---------- sources ----------
const src = new Map(); // key -> Set of labels
const add = (key, label) => { if (!src.has(key)) src.set(key, new Set()); src.get(key).add(label); };
const unknown = [];
const addAll = (keys, label) => { for (const k of keys) { if (!GEAR[k]) unknown.push(`${k} (${label})`); else add(k, label); } };

for (const [t, def] of Object.entries(LOCATIONS)) addAll(def.gear, `search:${t}`);
for (const [t, f] of Object.entries(SITE_FINDS)) addAll(Object.keys(f.items), `find:${t}`);
for (const [t, f] of Object.entries(HUNT_FINDS)) addAll(Object.keys(f.items), `huntfind:${t}`);
for (const [t, f] of Object.entries(LIGHT_FINDS)) addAll(Object.keys(f.items), `lightfind:${t}`);
for (const [t, f] of Object.entries(GUNMOD_FINDS)) addAll(Object.keys(f.items), `modfind:${t}`); // gun attachments (gunmods.js)
for (const [a, f] of Object.entries(AREA_GUNMODS)) addAll(Object.keys(f.items), `raid:${a}`);
for (const [t, f] of Object.entries(WARE_GUNMODS)) addAll(Object.keys(f.items), `sold:${t}`);
// The weapons overhaul's attachments and repair kits (loot.js SITE_MODS / AREA_MODS / WARE_MODS: their own dice).
for (const [t, f] of Object.entries(SITE_MODS)) addAll(Object.keys(f.items), `modfind:${t}`);
for (const [a, f] of Object.entries(AREA_MODS)) addAll(Object.keys(f.items), `raid:${a}`);
for (const [t, f] of Object.entries(WARE_MODS)) addAll(Object.keys(f.items), `sold:${t}`);
// Helmets, visors, mounts and ear protection (helmets.js HEAD_FINDS / AREA_HEAD / WARE_HEAD: their own dice).
for (const [t, f] of Object.entries(HEAD_FINDS)) addAll(Object.keys(f.items), `headfind:${t}`);
for (const [a, f] of Object.entries(AREA_HEAD)) addAll(Object.keys(f.items), `raid:${a}`);
for (const [t, f] of Object.entries(WARE_HEAD)) addAll(Object.keys(f.items), `sold:${t}`);
// The reloading bench's brass, powder and primers (loot.js SITE_RELOAD / AREA_RELOAD: their own dice).
for (const [t, f] of Object.entries(SITE_RELOAD)) addAll(Object.keys(f.items), `find:${t}`);
for (const [a, f] of Object.entries(AREA_RELOAD)) addAll(Object.keys(f.items), `raid:${a}`);
for (const [a, def] of Object.entries(AREAS)) addAll(def.gear.map(([k]) => k), `raid:${a}`);
for (const [a, f] of Object.entries(AREA_FINDS)) addAll(Object.keys(f.items), `raid:${a}`);
for (const [t, b] of Object.entries(BOOK_SITES)) addAll(b.books, `books:${t}`);
for (const [t, b] of Object.entries(WARE_BOOKS)) addAll(b.books, `sold:${t}`);
for (const [k, kit] of Object.entries(KITS)) {
  addAll(kit.weapons, `body:${k}`); addAll(kit.strong, `body:${k}`); addAll(kit.armor.filter(Boolean), `body:${k}`);
  addAll(kit.loot, `body:${k}`); addAll(kit.finds || [], `body:${k}`); if (kit.pack) addAll([kit.pack[0]], `body:${k}`);
}
addAll(ZOMBIE_FINDS, "body:zombie"); addAll(ZOMBIE_PACKS, "body:zombie"); addAll(ZOMBIE_PACK_STUFF, "body:zombie");
addAll(ZBODY.FINDS, "body:zombie"); // one of the dead searched in a raid (inventory.js deadBodyFinds)
// The armoured dead's bodies (deadsoldiers.js MILDEAD.BODY): a dead soldier's or riot cop's kit.
for (const [k, B] of Object.entries(MILDEAD.BODY)) addAll([...B.armor, ...B.items, ...(MILDEAD.BODY_EXTRA[k] || [])].map(([key]) => key), `body:dead ${k}`);
for (const [t, f] of Object.entries(SITE_GRENADES)) addAll(Object.keys(f.items), `find:${t}`); // flashbangs, smoke grenades (their own dice)
for (const [a, f] of Object.entries(AREA_GRENADES)) addAll(Object.keys(f.items), `raid:${a}`);
for (const [t, f] of Object.entries(SITE_LAUNCHERS)) addAll(Object.keys(f.items), `find:${t}`); // grenade launchers, rocket tubes, 40 mm, the M2 (launchers.js; their own dice)
for (const [a, f] of Object.entries(AREA_LAUNCHERS)) addAll(Object.keys(f.items), `raid:${a}`);
for (const [k, rows] of Object.entries(TRUCK_GEAR)) addAll(rows.map(([key]) => key), `truck:${k}`);
for (const [k, kit] of Object.entries(FLASH_KIT)) addAll(Object.keys(kit), `body:${k}`);
if (Object.keys(TRUCK_FLASH).length) addAll(["flashbang"], "truck"); // miltrucks.js: Army trucks' crates
for (const [t, list] of Object.entries(WARES)) addAll(list, `sold:${t}`);
addAll(RARE_GEAR, "merchants"); addAll(MERCHANT_VALUABLES, "merchants"); addAll(TRAVEL_GEAR, "travellers");
addAll(Object.keys(AMMO_GEAR), "rounds"); // a box is the item form of a supply of rounds found by key everywhere (ammo.js: starting colonists' pockets, opened into the stock)
addAll(Object.keys(RECRUIT_WEAPONS), "recruits"); addAll(RECRUIT_ARMOR, "recruits"); addAll(RECRUIT_KIT, "recruits"); addAll(RECRUIT_PERSONAL, "recruits");
for (const [k, r] of Object.entries(CRAFTS)) if (r.gear) addAll([r.gear], `craft:${k}`);
addAll(HUMVEE_GEAR, "event:humvee"); addAll(HIKER_STUFF, "event:hiker"); addAll(["hikingpack", "rucksack"], "event:hiker");
for (const k of Object.keys(GEAR)) if (GEAR[k].blueprint) add(k, "blueprints");
for (const [a, f] of Object.entries(GUN_FINDS)) addAll(Object.keys(f), `raid:${a}`); // gunsafes.js: tools and gun cases in raid containers
for (const [t, f] of Object.entries(SEARCH_TOOLS)) addAll(Object.keys(f), `find:${t}`); // gunsafes.js: tools in the hour-by-hour search
for (const [t, T] of Object.entries(GUN_STASH)) addAll([...Object.keys(T.guns), ...(T.items || []).flatMap(([w]) => (typeof w === "string" ? [w] : Object.keys(w)))], `safe:${t}`);
for (const [t, f] of Object.entries(SITE_KIT)) addAll(Object.keys(f.items), `kitfind:${t}`); // carrykit.js: magazines, rigs, plates
for (const [a, f] of Object.entries(AREA_KIT)) addAll(Object.keys(f.items), `raid:${a}`);
for (const [t, f] of Object.entries(WARE_KIT)) addAll(Object.keys(f.items), `sold:${t}`);

console.log("Sources");
check(!unknown.length, `every listed item exists in GEAR${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
// (The M203, an attachment, is in army stock since the launcher wave: loot.js SITE_MODS / AREA_MODS.)
const orphans = Object.keys(GEAR).filter((k) => !src.has(k));
check(!orphans.length, `every item has at least one source${orphans.length ? ` (none for: ${orphans.join(", ")})` : ""}`);
const VAL5 = ["goldring", "cigarettes", "whiskey", "coffee", "batteries"];
check(VAL5.every((k) => [...(src.get(k) || [])].some((l) => /^(find|raid|body):/.test(l))), "the five old valuables can now be found (searches, raids or bodies)");

// ---------- themes ----------
console.log("Themes");
check(Object.keys(LOCATIONS).every((t) => SITE_TAGS[t]), `every site type has theme tags (missing: ${Object.keys(LOCATIONS).filter((t) => !SITE_TAGS[t]).join(", ") || "none"})`);
check(Object.keys(AREAS).every((a) => AREA_TAGS[a]), `every raid area has theme tags (missing: ${Object.keys(AREAS).filter((a) => !AREA_TAGS[a]).join(", ") || "none"})`);
check(Object.keys(SITE_FINDS).every((t) => LOCATIONS[t]) && Object.keys(AREA_FINDS).every((a) => AREAS[a]), "finds tables only name real site types and raid areas");
const misfits = [];
for (const [t, def] of Object.entries(LOCATIONS)) for (const k of [...def.gear, ...Object.keys((SITE_FINDS[t] || {}).items || {}), ...Object.keys((HUNT_FINDS[t] || {}).items || {}), ...Object.keys((LIGHT_FINDS[t] || {}).items || {}), ...Object.keys((GUNMOD_FINDS[t] || {}).items || {}), ...Object.keys((SITE_MODS[t] || {}).items || {}), ...Object.keys((HEAD_FINDS[t] || {}).items || {})]) if (!fitsTags(k, SITE_TAGS[t] || [])) misfits.push(`${k} at ${t}`);
for (const [a, def] of Object.entries(AREAS)) for (const k of [...def.gear.map(([x]) => x), ...Object.keys((AREA_FINDS[a] || {}).items || {}), ...Object.keys((AREA_GUNMODS[a] || {}).items || {}), ...Object.keys((AREA_MODS[a] || {}).items || {}), ...Object.keys((AREA_GRENADES[a] || {}).items || {}), ...Object.keys((AREA_HEAD[a] || {}).items || {})]) if (!fitsTags(k, AREA_TAGS[a] || [])) misfits.push(`${k} in raid area ${a}`);
for (const [t, f] of Object.entries(SITE_GRENADES)) for (const k of Object.keys(f.items)) if (!LOCATIONS[t] || !fitsTags(k, SITE_TAGS[t] || [])) misfits.push(`${k} at ${t} (grenades)`);
for (const a of Object.keys(AREA_GRENADES)) if (!AREAS[a]) misfits.push(`grenades in unknown raid area ${a}`);
for (const [t, f] of Object.entries(SITE_LAUNCHERS)) for (const k of Object.keys(f.items)) if (!LOCATIONS[t] || !fitsTags(k, SITE_TAGS[t] || [])) misfits.push(`${k} at ${t} (launchers)`);
for (const [a, f] of Object.entries(AREA_LAUNCHERS)) for (const k of Object.keys(f.items)) if (!AREAS[a] || !fitsTags(k, AREA_TAGS[a] || [])) misfits.push(`${k} in raid area ${a} (launchers)`);
for (const [a, f] of Object.entries(GUN_FINDS)) for (const k of Object.keys(f)) if (!AREAS[a] || !fitsTags(k, AREA_TAGS[a] || [])) misfits.push(`${k} in raid area ${a} (gun finds)`);
for (const [t, f] of Object.entries(SEARCH_TOOLS)) for (const k of Object.keys(f)) if (!LOCATIONS[t] || !fitsTags(k, SITE_TAGS[t] || [])) misfits.push(`${k} at ${t} (tools)`);
for (const [t, f] of Object.entries(SITE_RELOAD)) for (const k of Object.keys(f.items)) if (!LOCATIONS[t] || !fitsTags(k, SITE_TAGS[t] || [])) misfits.push(`${k} at ${t} (reloading)`);
for (const [a, f] of Object.entries(AREA_RELOAD)) for (const k of Object.keys(f.items)) if (!AREAS[a] || !fitsTags(k, AREA_TAGS[a] || [])) misfits.push(`${k} in raid area ${a} (reloading)`);
for (const [t, f] of Object.entries(SITE_KIT)) for (const k of Object.keys(f.items)) if (!LOCATIONS[t] || !fitsTags(k, SITE_TAGS[t] || [])) misfits.push(`${k} at ${t} (carry kit)`);
for (const [a, f] of Object.entries(AREA_KIT)) for (const k of Object.keys(f.items)) if (!AREAS[a] || !fitsTags(k, AREA_TAGS[a] || [])) misfits.push(`${k} in raid area ${a} (carry kit)`);
check(!misfits.length, `everything a site or raid area holds fits its theme${misfits.length ? ` (misfits: ${misfits.join("; ")})` : ""}`);
const placed = new Set([...Object.values(LOCATIONS).flatMap((d) => d.gear), ...Object.values(SITE_FINDS).flatMap((f) => Object.keys(f.items)), ...Object.values(HUNT_FINDS).flatMap((f) => Object.keys(f.items)), ...Object.values(LIGHT_FINDS).flatMap((f) => Object.keys(f.items)), ...Object.values(AREAS).flatMap((d) => d.gear.map(([k]) => k)), ...Object.values(AREA_FINDS).flatMap((f) => Object.keys(f.items))]);
check([...placed].every((k) => ITEM_TAGS[k]), `every item placed at a site has theme tags (missing: ${[...placed].filter((k) => !ITEM_TAGS[k]).join(", ") || "none"})`);
check(Object.keys(ITEM_TAGS).every((k) => GEAR[k]), "theme tags only for real items");
// A few that must stay true (the audit's point).
const sitesOf = (k) => Object.entries(LOCATIONS).filter(([, d]) => d.gear.includes(k)).map(([t]) => t);
check(!sitesOf("milradio").includes("univ") && !AREAS.lab.gear.some(([k]) => k === "milradio") && !AREAS.newswreck.gear.some(([k]) => k === "milradio"), "no military radios in universities, labs or news helicopters");
check(["huntrifle", "compbow", "xbow", "ghillie", "camonet"].every((k) => LOCATIONS.lodge.gear.includes(k)) && SITE_FINDS.lodge.items.gamecall, "a hunting lodge: rifles, bows, camo and game calls");
check(["baton", "carbine", "riotarms", "pistol", "riothelmet"].every((k) => LOCATIONS.police.gear.includes(k)) && SITE_FINDS.police.items.cuffs, "a police station: batons, riot gear, pistols, cuffs and a carbine");
check(["prybar", "sledge", "barbedwire", "crowbar"].every((k) => LOCATIONS.hardware.gear.includes(k)), "a hardware store: crowbars, sledgehammers and barbed wire");
check(["bat", "sportspads", "backpack"].every((k) => LOCATIONS.school.gear.includes(k)) && BOOK_SITES.school, "a school: bats, sports gear, bags and books");
check(["surgkit", "bandagekit"].every((k) => LOCATIONS.hospital.gear.includes(k)), "a hospital: medical kits");
check(SITE_FINDS.gas.items.cigarettes && SITE_FINDS.gas.items.lighters && SITE_FINDS.truckstop.items.smokes, "gas stations and truck stops: cigarettes and lighters");
check(["goldring", "watch", "photos"].every((k) => AREA_FINDS.house.items[k]) && SITE_FINDS.mall.items.diamond, "houses and malls hold jewelry and keepsakes");
check(KITS.raiders.finds.includes("cigarettes") && KITS.raiders.finds.includes("goldchain"), "raider bodies carry cigarettes and gold");

// ---------- every item ----------
console.log("Items");
const bad = (pred) => Object.entries(GEAR).filter(([k, d]) => pred(k, d)).map(([k]) => k);
check(!bad((k, d) => !CATEGORIES[d.cat]).length, `every item has a trade category (${bad((k, d) => !CATEGORIES[d.cat]).join(", ") || "all"})`);
check(!bad((k, d) => !(Number.isFinite(d.weight) && d.weight > 0)).length, `every item weighs something (${bad((k, d) => !(Number.isFinite(d.weight) && d.weight > 0)).join(", ") || "all"})`);
check(!bad((k, d) => !(d.value > 0)).length, `every item has a hidden value (${bad((k, d) => !(d.value > 0)).join(", ") || "all"})`);
check(!bad((k, d) => !d.desc).length, `every item has a description (${bad((k, d) => !d.desc).join(", ") || "all"})`);
const vals = Object.entries(GEAR).filter(([, d]) => d.valuable);
check(vals.length >= 28, `a full set of valuables (${vals.length}; soap and razors moved to toiletries 2026-10-06)`);
const fams = new Set(vals.map(([, d]) => d.cat));
check(["jewelry", "smokes", "liquor", "treats", "gadgets", "collectibles", "household"].every((c) => fams.has(c)), `valuables in every valuable family (${[...fams].join(", ")})`);
check(vals.every(([, d]) => d.value / d.weight >= 6), `valuables are light for their worth (worst ${vals.map(([k, d]) => [k, d.value / d.weight]).sort((a, b) => a[1] - b[1])[0].map((x) => (typeof x === "number" ? x.toFixed(1) : x)).join(" ")} a kg)`);
check(vals.every(([, d]) => !d.comfort && !d.heat && !d.throw && !d.defence && !d.book && d.slot === "pack" && !d.power), "valuables are good for nothing but trade (no comfort, heat, throw, defence, book or power)");
// The exception (needs.js treats): candy, tobacco, wine and whiskey can be used up for mood, nothing else: no food,
// water or health in them (tobacco costs health), and a team only reaches for them when someone is really low.
const TREAT_VALUABLES = ["candy", "tobacco", "wine", "whiskey"];
const usable = vals.filter(([, d]) => d.use).map(([k]) => k).sort();
check(usable.join(",") === [...TREAT_VALUABLES].sort().join(","), `the only usable valuables are the four treats (${usable.join(", ")})`);
check(TREAT_VALUABLES.every((k) => GEAR[k].use.mood > 0 && !(GEAR[k].use.hp > 0) && !GEAR[k].use.food && !GEAR[k].use.water && !GEAR[k].use.heal && GEAR[k].useVerb && TREAT_ORDER.includes(k)), "a treat valuable gives mood only (no food, water or health) and is on the team's treat list");
check(vals.every(([, d]) => CATEGORIES[d.cat].group === "valuables"), "valuables sit in the valuables family");
const weapons = Object.entries(GEAR).filter(([, d]) => d.slot === "weapon");
check(weapons.every(([k]) => WEAPONS[k]), `every weapon has battle numbers (${weapons.filter(([k]) => !WEAPONS[k]).map(([k]) => k).join(", ") || "all"})`);
check(weapons.filter(([k]) => !WEAPONS[k].melee).every(([k]) => Number.isFinite(WEAPONS[k].ammo) && Number.isFinite(WEAPONS[k].opt)), "every ranged weapon has a range and an ammo use");
check(["compbow", "xbow", "crossbow"].every((k) => WEAPONS[k].ammo === 0 && WEAPONS[k].arrows === 1 && WEAPONS[k].noise === 0), "bows are silent and shoot arrows, never ammo");
check(["prybar", "fireaxe", "sledge"].every((k) => GEAR[k].pry), "crowbar, fire axe and sledgehammer force locks");
const throwers = Object.entries(GEAR).filter(([, d]) => d.throw);
check(throwers.every(([k, d]) => d.throw === k && THROWABLES[k]), "every throwable is in the throw table under its own key");
check(Object.keys(THROWABLES).every((k) => GEAR[k] && GEAR[k].throw === k), "the throw table names only throwable items");
// Siege kit and decoys (siege.js, decoys.js): grenades and decoys are found, ladders and rams are made.
const srcOf = (k) => [...(src.get(k) || [])];
check(srcOf("frag").some((l) => /^(find|raid|body):/.test(l)) && srcOf("frag").some((l) => /military|soldiers|armory|barracks/.test(l)), `frag grenades come from soldiers and military places (${srcOf("frag").slice(0, 6).join(", ")})`);
check(["alarmclock", "pocketradio", "handwarmer", "heatpack"].every((k) => srcOf(k).some((l) => /^(find|raid):/.test(l))), "the decoys (alarm clock, pocket radio, hand warmers, heat pack) turn up in searches");
check(["ladder", "ram"].every((k) => srcOf(k).some((l) => /^craft:/.test(l)) && GEAR[k].bulky && GEAR[k].siege === k), "siege ladders and battering rams are crafted, bulky (cargo only) and siege kit");
check(srcOf("molotov").some((l) => /^craft:/.test(l)) && srcOf("molotov").some((l) => /^(body|find|raid|sold):/.test(l)), "Molotovs are still crafted and found");
check(Object.entries(THROWABLES).every(([, T]) => !T.radius || (Array.isArray(T.sense) && T.sense.length)), "every lure says what the dead sense of it (noise, heat, light)");
check(Object.entries(THROWABLES).every(([, T]) => !T.decoy || ["spot", "thrower", "none"].includes(T.people)), "every decoy says what people make of it");
const packs = Object.entries(GEAR).filter(([, d]) => d.slot === "backpack");
check(packs.every(([, d]) => d.slots > 0 && d.carry > 0), "every pack has slots and carry");
check(GEAR.slingbag.slots === 3 && GEAR.backpack.slots === 6 && GEAR.hikingpack.slots === 10 && GEAR.assaultpack.slots === 8 && GEAR.rucksack.slots === 14, "packs: sling bag 3, school backpack 6, assault pack 8, hiking pack 10, frame rucksack 14 slots");
check(GEAR.rucksack.carry > GEAR.hikingpack.carry && GEAR.hikingpack.carry > GEAR.assaultpack.carry && GEAR.rucksack.ease > GEAR.assaultpack.ease, "the frame rucksack carries the most and spreads the weight best");
check(ZOMBIE_PACKS.every((k) => GEAR[k].slot === "backpack") && ZOMBIE_PACK_STUFF.every((k) => GEAR[k] && !GEAR[k].bulky && !GEAR[k].slots), "the dead's bags are packs, with things that fit in them");
const tiers = Object.fromEntries(Object.keys(GEAR).map((k) => [k, worthTier(newItem(k, 1))]));
check(tiers.diamond === "valuable" || tiers.diamond === "rare", "a diamond ring is valuable");
check(tiers.photos === "junk" && tiers.toiletpaper !== "rare", "family photos are worth nothing in trade");
check(tiers.carbine === "rare" || tiers.carbine === "valuable", "a police carbine is worth a lot");

// ---------- the rolls ----------
console.log("Rolls");
const st = { seed: 99, hour: 0, tiles: [] };
let fine = true, got = 0;
for (const [t] of Object.entries(SITE_FINDS)) {
  st.tiles[0] = { loc: { type: t }, loot: 1 };
  for (let h = 0; h < 400; h++) {
    st.hour = h;
    const it = rollFind(st, 0, 1, "x");
    if (!it) continue;
    got++;
    if (!SITE_FINDS[t].items[it.key]) fine = false;
  }
}
check(fine && got > 0, `search-hour finds only come from the site's table (${got} in ${Object.keys(SITE_FINDS).length * 400} hours)`);
const rate = got / (Object.keys(SITE_FINDS).length * 400);
check(rate > 0.05 && rate < 0.2, `about one small find in ten search hours at full loot (${(rate * 100).toFixed(1)}%)`);
st.tiles[0] = { loc: { type: "town" }, loot: 0.1 };
let low = 0;
for (let h = 0; h < 2000; h++) { st.hour = h; if (rollFind(st, 0, 1, "y")) low++; }
check(low < 2000 * 0.12 * 0.15, `a picked-over site gives fewer finds (${low} in 2000 hours at 10% loot)`);
st.tiles[0] = { terrain: "plains" };
check(rollFind(st, 0, 5, "z") === null, "open ground has no finds table");
const rng = new Rng(7);
fine = true; got = 0;
for (const a of Object.keys(AREA_FINDS)) for (let i = 0; i < 300; i++) { const it = rollAreaFind(rng, a, 1, 5); if (it) { got++; if (!AREA_FINDS[a].items[it.key]) fine = false; } }
check(fine && got > 0, `raid containers' finds only come from the area's table (${got} in ${Object.keys(AREA_FINDS).length * 300})`);
let zpacks = 0, zitems = 0;
for (let i = 0; i < 4000; i++) {
  const body = enemyBody(rng, { kind: "zombie", name: "Z", id: i }, null);
  if (body.gear.backpack) { zpacks++; zitems += body.gear.backpack.contents.filter(Boolean).length; }
}
check(Math.abs(zpacks / 4000 - ZOMBIE_PACK) < 0.02, `about ${ZOMBIE_PACK * 100}% of the dead wear a bag (${((zpacks / 4000) * 100).toFixed(1)}%)`);
check(zpacks && zitems / zpacks >= 1 && zitems / zpacks <= 3, `with a few things inside (${(zitems / Math.max(1, zpacks)).toFixed(1)} on average)`);
let rfinds = 0;
for (let i = 0; i < 3000; i++) { const body = enemyBody(rng, { kind: "human", name: "R", id: i, weapon: "pistol", kit: "raiders" }, KITS.raiders); if (body.pockets.some((it) => it && KITS.raiders.finds.includes(it.key))) rfinds++; }
check(rfinds / 3000 > 0.12 && rfinds / 3000 < 0.35, `a raider's pockets hold something small about one time in five (${((rfinds / 3000) * 100).toFixed(0)}%)`);

// ---------- parts by kind (section 10) ----------
console.log("Parts by kind");
check(Object.keys(SITE_MODS).every((t) => LOCATIONS[t]) && Object.keys(AREA_MODS).every((a) => AREAS[a]), "the overhaul's attachment tables only name real site types and raid areas");
check(Object.keys(PARTS_MIX).every((t) => LOCATIONS[t] || AREAS[t]), `the parts mix only names real site types and raid areas (${Object.keys(PARTS_MIX).filter((t) => !LOCATIONS[t] && !AREAS[t]).join(", ") || "all real"})`);
{
  const stp = { seed: 5, hour: 10 };
  const tally = (place) => { const t = {}; for (let i = 0; i < 200; i++) for (const [k, v] of Object.entries(sortParts(stp, place, 5, `x${i}`))) t[k] = (t[k] || 0) + v; return t; };
  const auto = tally("autoshop"), guns = tally("gunstore"), radio = tally("radiotower"), farm = tally("farm");
  const sum = (t) => Object.values(t).reduce((a, b) => a + b, 0);
  check(sum(auto) === 1000 && Math.abs(auto.carparts / 1000 - 0.6) < 0.06 && Math.abs(guns.gunparts / 1000 - 0.6) < 0.06 && Math.abs(radio.electronics / 1000 - 0.6) < 0.06, `an auto shop's parts are 60% car parts (${auto.carparts / 10}%), a gun store's gun parts (${guns.gunparts / 10}%), a radio tower's electronics (${radio.electronics / 10}%); the rest machine parts`);
  check(farm.parts === 1000, "elsewhere they are machine parts");
  const sup = { parts: 4, scrap: 2 };
  splitParts(stp, sup, "garage", "y");
  check(sup.scrap === 2 && (sup.parts || 0) + (sup.carparts || 0) + (sup.gunparts || 0) + (sup.electronics || 0) === 4, `a raid container's parts split the same way (${JSON.stringify(sup)})`);
}

// ---------- the table ----------
if (!quiet) {
  console.log("\nSources per item (tier, kg, how many places, a few of them):");
  const group = (labels) => {
    const by = {};
    for (const l of labels) { const [kind, where] = l.split(":"); (by[kind] = by[kind] || []).push(where || ""); }
    return Object.entries(by).map(([k, w]) => `${k}${w[0] ? ` ${w.slice(0, 6).join(",")}${w.length > 6 ? `+${w.length - 6}` : ""}` : ""}`).join("; ");
  };
  const rows = Object.keys(GEAR).filter((k) => !GEAR[k].blueprint).sort((a, b) => (GEAR[a].cat || "").localeCompare(GEAR[b].cat || "") || a.localeCompare(b));
  for (const k of rows) {
    const s = [...(src.get(k) || [])];
    console.log(`${k.padEnd(14)} ${(GEAR[k].cat || "").padEnd(12)} ${tiers[k].padEnd(9)} ${String(GEAR[k].weight).padStart(5)} kg ${String(s.length).padStart(3)}  ${group(s).slice(0, 150)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
