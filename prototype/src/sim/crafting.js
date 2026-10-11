// Hand crafting: survivors on the Craft role make makeshift gear (and a few supplies) by hand at any base,
// no station needed. Works like the construction queue: materials are paid when a job is queued, crafters
// put work-hours into the first job they are skilled enough for, and the item lands in the base armory.
// Some sturdier recipes still need a workshop (needs: "workshop" = an ammo bench or machine shop here).
// Gear has durability (item.dur, data.js GEAR dur / GEAR_DUR): it wears with every fight / treatment / day of work and
// breaks at 0. Makeshift gear has few uses; a crafted item's quality sets how many (craftedDur).
// Field crafting: a team in the field can make the simplest recipes (field: true) from what it carries.
// The Crafting skill: every recipe's quality, speed and XP come from Crafting; the recipe's own skill + min (and cmin,
// a Crafting minimum on the special recipes) only say who may attempt it. Quality is a roll around the expected
// condition (craftQuality), narrower the better the crafter; each finished craft gives Crafting XP by the kind of thing,
// the worth of what went into it and the quality it came out at (craftXp).
import { LIGHTS } from "./lights.js";
import { wearMakeshiftMods, attachText, fitsText } from "./gunmods.js"; // makeshift gun parts that wear by the fight
import { GEAR, SKILL_NAMES, SUPPLIES } from "./data.js";
import { log, atBase, skill, newId, gearEffect } from "./world.js";
import { count, BUILDINGS, benchOf } from "./buildings.js";
import { partyMembers, addGearToCargo } from "./parties.js";
import { ARMOR_SLOTS, SLOT_NAMES, EQUIP_SLOTS, ensurePack, stow, packOf } from "./inventory.js";
import { workFactor } from "./health.js";
import { hasPerk, hash01, gainXp } from "./skills.js";
import { craftLock, craftEdgeQuality, craftEdgeSpeed } from "./blueprints.js";
import { foodIn, takeFood } from "./foods.js"; // a recipe's food: days of it
import { stockHas, useStock, teamWaterIn, takeTeamWater, waterIn, RAW, keyWord } from "./water.js"; // recipes: water counts both kinds, un-purified used first
import { totalRounds, spendAmmo } from "./rounds.js"; // rounds by calibre ("ammo": any of them)
const carriedRounds = (p) => totalRounds(p.supplies) + totalRounds(p.cargo && p.cargo.supplies);
import { WORM, rawWaterEggs, purifyCap } from "./worm.js"; // TABS_WATER: what one purification tablet treats (the recipe text); the filters in use
import { WATER, waterCapacity, waterProduction } from "./economy.js"; // the filters in use: the tanks' room after the day's water (filtersInUse)
import { noteOutput } from "./output.js"; // the base's Work now panel: what each job brought in a day (activity.js)

// in = materials (base stock), hours = work-hours, skill + min = who can make it, out = gear key or supplies.
// needs: "workshop" (an ammo bench or machine shop at this base) or a building key. field: can be made by a team.
export const CRAFTS = {
  pipespear:   { gear: "pipespear",   in: { scrap: 3 },           hours: 4,  skill: "mechanics", min: 0, field: true },
  spikedbat:   { gear: "spikedbat",   in: { scrap: 4 },           hours: 6,  skill: "mechanics", min: 0, field: true },
  sawmachete:  { gear: "sawmachete",  in: { scrap: 6 },           hours: 10, skill: "mechanics", min: 3 },
  // Knives (data-blades.js): a shiv ground from a strip of scrap anywhere; a Bowie knife forged from an old file at a workshop.
  shiv:        { gear: "shiv",        in: { scrap: 2 },           hours: 2,  skill: "mechanics", min: 0, field: true },
  bowie:       { gear: "bowie",       in: { scrap: 5 },           hours: 10, skill: "mechanics", min: 3, cmin: 4, needs: "workshop" },
  crossbow:    { gear: "crossbow",    in: { scrap: 8, parts: 1 }, hours: 16, skill: "mechanics", min: 5, needs: "workshop" },
  pipegun:     { gear: "pipegun",     in: { scrap: 6, parts: 2 }, hours: 14, skill: "mechanics", min: 6, needs: "workshop" },
  makeshiftrod: { gear: "makeshiftrod", in: { scrap: 1 },         hours: 2,  skill: "mechanics", min: 0, field: true },
  // Machine parts in crafting (freezer-parts 2026-10-10, user request "use these parts for crafting"): the recipes with
  // a mechanism take machine parts (springs, gears, bearings, valves): the crossbow, pipe gun, lights, suppressor,
  // bicycle, ram, repair kit, pulley bow as before, and these two for food: a real fishing rod with a reel (the
  // makeshift rod above is a sapling and a bent hook) and a spring-jawed bear trap. The pressure canner is no recipe
  // any more (machines-2: an upgrade fitted to a preserving room, buildings.js BUILDINGS.canner, its old 4 scrap and
  // 2 parts now the fitting's cost). TODO(food-types wave 2, cooking): a hand-crank grain mill (foods.js f_grain →
  // f_flour); a meat grinder for game (f_venison, f_boar → f_groundmeat, f_sausage).
  fishrod:     { gear: "fishrod",     in: { scrap: 2, parts: 1 }, hours: 6,  skill: "mechanics", min: 2 },
  beartrap:    { gear: "beartrap",    in: { scrap: 5, parts: 1 }, hours: 8,  skill: "mechanics", min: 2, needs: "workshop" },
  padding:     { gear: "padding",     in: { scrap: 2 },           hours: 3,  skill: "mechanics", min: 0, field: true },
  shinguards:  { gear: "shinguards",  in: { scrap: 2 },           hours: 3,  skill: "mechanics", min: 0, field: true },
  tirevest:    { gear: "tirevest",    in: { scrap: 6 },           hours: 8,  skill: "mechanics", min: 2 },
  scrapvest:   { gear: "scrapvest",   in: { scrap: 10, parts: 1 },hours: 18, skill: "mechanics", min: 4, needs: "workshop" },
  bandagekit:  { gear: "bandagekit",  in: { scrap: 2, meds: 1 },  hours: 4,  skill: "medicine",  min: 2, field: true },
  // medics.js MEDIC.SELF: a strap cut from a belt or webbing, a scrap rod for the windlass.
  tourniquet:  { gear: "tourniquet",  in: { scrap: 1 },           hours: 1,  skill: "medicine",  min: 1, field: true },
  dressings:   { name: "Boiled-rag dressings", supplies: { meds: 1 }, in: { scrap: 2, water: 2 }, hours: 6, skill: "medicine", min: 3, field: true,
                 desc: "Rags boiled clean and folded into dressings: 1 meds. Slower than a med station, but needs no building." },
  // Arrows and bolts for hunting with a bow or crossbow (hunting.js): straight shoots split from the firewood, fletched,
  // with scrap points.
  // Building materials (data.js buildmat; user request 2026-10-09: "Building materials can be crafted with scraps"):
  // scrap hammered, bolted and nailed into panels, beams and blocks. Anywhere, a team too.
  buildmat:    { name: "Building materials", supplies: { buildmat: 1 }, in: { scrap: 3 }, hours: 3, skill: "mechanics", min: 0, field: true,
                 desc: "Scrap hammered, bolted and nailed into panels, beams and blocks: 1 building material from 3 scrap. What a camp takes to become a base (with scrap): Establish the outpost, Build up into a shelter, Build up into a base." },
  arrows:      { name: "Arrows (12)", supplies: { arrows: 12 }, in: { wood: 30, scrap: 1 }, hours: 4, skill: "mechanics", min: 1, field: true,
                 desc: "Straight shafts split from firewood, fletched, with points filed from scrap: 12 arrows (or crossbow bolts), what a bow or crossbow shoots in fights and on hunts. A hunt loses about half the arrows it shoots; a won fight gets about half back." },
  crowbar:     { gear: "crowbar",     in: { scrap: 4 },           hours: 5,  skill: "mechanics", min: 1 },
  waterfilter: { gear: "waterfilter", in: { scrap: 4 },           hours: 6,  skill: "mechanics", min: 2, field: true },
  // tune-jobcaps: a filter that clogs at a base leaves its bucket and frame (base.spentFilters); fresh sand and
  // charcoal make it a filter again for a quarter of the scrap. spent: clogged filters it uses (at this base).
  repackfilter: { name: "Re-packed water filter", gear: "waterfilter", in: { scrap: 1 }, spent: 1, hours: 3, skill: "mechanics", min: 1,
                  desc: "Fresh sand and charcoal in a clogged filter's bucket (kept at the base each time one clogs there): a charcoal water filter again for 1 scrap." },
  // The worm (worm.js): a sure cure in the gut stage. Strong meds pressed into tablets at a med station.
  dewormer:    { gear: "dewormer",    in: { meds: 3, food: 1 },   hours: 8,  skill: "medicine",  min: 5, needs: "med_station" },
  // Purification tablets (worm.js): iodine from the meds pressed into a tube of 10 at a med station.
  puritabs:    { gear: "puritabs",    in: { meds: 1, scrap: 1 },  hours: 4,  skill: "medicine",  min: 3, needs: "med_station" },
  backpack:    { gear: "backpack",    in: { scrap: 3 },           hours: 5,  skill: "mechanics", min: 0 },
  // The stealth kit (stealth.js).
  noisemaker:  { gear: "noisemaker",  in: { scrap: 2 },           hours: 3,  skill: "mechanics", min: 1, field: true },
  firecracker: { gear: "firecracker", in: { scrap: 1, ammo: 8 },  hours: 3,  skill: "mechanics", min: 2, field: true },
  // A road flare (the hive crawl's: thrown down a passage, it lights the chamber beyond; in battle a light and a lure):
  // powder pulled from a few rounds and fuel packed in a scrap tube.
  flare:       { gear: "flare",       in: { scrap: 1, fuel: 1, ammo: 4 }, hours: 2, skill: "mechanics", min: 2, field: true },
  flashlight:  { gear: "flashlight",  in: { scrap: 2, parts: 1 }, hours: 6,  skill: "mechanics", min: 3 },
  // Lights (lights.js): a torch from firewood anywhere, a headlamp and a lantern at the bench, a spotlight in a workshop.
  torch:       { gear: "torch",       in: { wood: 1, scrap: 1 },  hours: 1,  skill: "mechanics", min: 0, field: true },
  headlamp:    { gear: "headlamp",    in: { scrap: 1, parts: 1 }, hours: 5,  skill: "mechanics", min: 3 },
  lantern:     { gear: "lantern",     in: { scrap: 3, parts: 1, fuel: 1 }, hours: 6, skill: "mechanics", min: 2 },
  spotlight:   { gear: "spotlight",   in: { scrap: 4, parts: 3 }, hours: 12, skill: "mechanics", min: 5, needs: "workshop" },
  suppressor:  { gear: "suppressor",  in: { scrap: 4, parts: 1 }, hours: 10, skill: "mechanics", min: 4, needs: "workshop" },
  // A bicycle built from frames and wheels (vehicles.js): it joins the base's bikes.
  bicycle:     { gear: "bicycle",     in: { scrap: 8, parts: 2 }, hours: 14, skill: "mechanics", min: 3, needs: "workshop" },
  // Carts (carts.js, data-carts.js): a tray beaten out of scrap on a wheel and two handles; a plank bed on two wheels
  // with a T handle. At a workshop (the welding, the wheels' bearings).
  wheelbarrow: { gear: "wheelbarrow", in: { scrap: 6, parts: 1 }, hours: 8, skill: "mechanics", min: 2, needs: "workshop" },
  handcart:    { gear: "handcart",    in: { scrap: 6, parts: 2, wood: 40 }, hours: 12, skill: "mechanics", min: 3, needs: "workshop" },
  // gearIn = items used up (from the base armory; in the field from the team's cargo or someone's pockets and pack).
  nailbat:     { gear: "nailbat",     gearIn: { bat: 1 }, in: { scrap: 1 }, hours: 2, skill: "mechanics", min: 0, field: true },
  molotov:     { gear: "molotov",     gearIn: { bottle: 1 }, in: { fuel: 1 }, hours: 1, skill: "mechanics", min: 0, field: true },
  pipebomb:    { gear: "pipebomb",    in: { scrap: 2, parts: 1, ammo: 15 }, hours: 6, skill: "mechanics", min: 5, needs: "workshop" },
  // Siege kit (siege.js): a ladder for walls, a ram for gates (taken along on an Assault, kit.js).
  ladder:      { gear: "ladder",      in: { scrap: 4 },           hours: 4,  skill: "mechanics", min: 1 },
  ram:         { gear: "ram",         in: { scrap: 8, parts: 2 }, hours: 10, skill: "mechanics", min: 3, needs: "workshop" },
  tripwire:    { gear: "tripwire",    in: { scrap: 1 },           hours: 2,  skill: "mechanics", min: 0, field: true },
  slingbag:    { gear: "slingbag",    in: { scrap: 2 },           hours: 3,  skill: "mechanics", min: 0 },
  // Camp kit against Heat (fieldheat.js): made by whoever knows how to keep quiet.
  ghillie:     { gear: "ghillie",     in: { scrap: 2 },           hours: 6,  skill: "stealth",   min: 2, field: true },
  ragboots:    { gear: "ragboots",    in: { scrap: 1 },           hours: 2,  skill: "stealth",   min: 0, field: true },
  scentmask:   { gear: "scentmask",   in: { scrap: 1, water: 1 }, hours: 2,  skill: "stealth",   min: 1, field: true },
  // Gun attachments (gunmods.js; docs/weapons-overhaul-plan.md section 5): a bottle over the muzzle in the field, a
  // solvent trap drilled out at a machine shop, a cheap magnifier for a scope, a rubber butt pad, a sling.
  bottlecan:   { gear: "bottlecan",   gearIn: { bottle: 1 }, in: { scrap: 1 }, hours: 1, skill: "mechanics", min: 0, field: true },
  makeshiftrig: { gear: "makeshiftrig", gearIn: { backpack: 1 }, in: { scrap: 1 }, hours: 3, skill: "mechanics", min: 0, field: true }, // carry kit (data-kit.js): a school bag cut into chest pouches
  steelplate:  { gear: "steelplate",  in: { scrap: 8 }, hours: 10, skill: "mechanics", min: 4, needs: "workshop" }, // a plate carrier's steel insert (section 16)
  solventcan:  { gear: "solventcan",  in: { scrap: 3, gunparts: 1 }, hours: 10, skill: "mechanics", min: 6, needs: "machine_shop" },
  scrapscope:  { gear: "scrapscope",  gearIn: { monocular: 1 }, in: { scrap: 2 }, hours: 4, skill: "mechanics", min: 2 },
  recoilpad:   { gear: "recoilpad",   in: { scrap: 1, wood: 10 }, hours: 2, skill: "mechanics", min: 0, field: true },
  sling:       { gear: "sling",       in: { scrap: 1 },           hours: 1,  skill: "mechanics", min: 0, field: true },
  // A field repair kit (repair.js): tools, pins and springs for 5 repairs on the road.
  repairkit:   { gear: "repairkit",   in: { scrap: 3, gunparts: 1, parts: 1 }, hours: 8, skill: "mechanics", min: 3, needs: "workshop" },
  // The reloading bench's own inputs (reloading.js; section 12): black powder from charcoal, sulphur and saltpetre
  // (firewood, scrap, food for the latrine's saltpetre), and match-head primers. Both are used only when the factory
  // powder or primers run out; loads with them are handloads that jam more (black powder: ×1.5 and louder; match-head
  // primers: misfires ×3).
  blackpowder: { name: "Black powder (a can)", supplies: { blackpowder: 100 }, in: { wood: 90, scrap: 1, food: 2 }, hours: 8, skill: "mechanics", min: 4, needs: "reload_bench",
                 desc: "Charcoal from firewood, sulphur scraped from old matches and batteries, saltpetre leached from the latrine: a can's worth of black powder (100 pistol charges) for the reloading bench, used when the smokeless powder runs out. Its loads foul the gun (jams ×1.5) and are louder." },
  matchprimers: { name: "Match-head primers (50)", supplies: { matchprimers: 50 }, in: { scrap: 1 }, hours: 6, skill: "mechanics", min: 8, needs: "reload_bench",
                 desc: "Spent primers knocked out, re-anviled and packed with scraped match heads: 50 primers for the reloading bench, used when the factory primers run out. They fail three times as often (misfires and jams ×3)." },
  // ---------- special gear (craft-books): locked until a craft book is read or a blueprint studied (blueprints.js) ----------
  // cmin: Crafting needed besides the recipe's own skill.
  springmachete: { gear: "springmachete", in: { scrap: 8, parts: 1 }, hours: 14, skill: "mechanics", min: 3, cmin: 5, needs: "workshop" },
  rivethelmet: { gear: "rivethelmet", in: { scrap: 6 },          hours: 10, skill: "mechanics", min: 2, cmin: 4 },
  pulleybow:   { gear: "pulleybow",   in: { scrap: 5, parts: 2, wood: 30 }, hours: 16, skill: "mechanics", min: 3, cmin: 6, needs: "workshop" },
  woodghillie: { gear: "woodghillie", in: { scrap: 3 },          hours: 10, skill: "stealth",   min: 3, cmin: 3 },
  traumakit:   { gear: "traumakit",   in: { scrap: 2, meds: 2 }, hours: 8,  skill: "medicine",  min: 4, cmin: 3 },
  // ---------- end of special gear ----------
};

export const WORKSHOP_TYPES = ["ammo_bench", "reload_bench", "machine_shop"]; // stations with metal tools (a reloading bench is an ammo bench upgraded: reloading.js)
export const MAX_CRAFT_QUEUE = 8;
const FIELD_QUALITY = -0.05;  // made on the road with less to work with
const WORKSHOP_QUALITY = 0.1; // workshop recipes come out a little better

// The Crafting skill (data.js SKILLS). Quality roll: expected condition ± a spread of sd0 − sdPer × Crafting (at least
// sdMin), clamped to lo–1. XP per finished craft: base × kind[...] × √(worth of the inputs) × (1 + qSlope × (quality − qAt)).
export const CRAFT_SKILL = "crafting";
export const CRAFT_ROLL = { sd0: 0.09, sdPer: 0.003, sdMin: 0.025, lo: 0.6 };
export const CRAFT_XP = { base: 0.55, qAt: 0.75, qSlope: 2, kind: { weapon: 1.2, armor: 1.1, medical: 1.1, tool: 1, camp: 0.8, kit: 0.9, supplies: 0.6 } }; // base 2 → 0.55 (skills.js balance pass, tools/skillcurve.js --drill: a crafter kept in materials finishes about 8 cheap jobs a day, which made 40+ XP a day at 2, against a farmer's 11)
export const CRAFT_PERKS = { quickhands: 1.15, foreman: 1.15, goodeye: 0.04, mastercrafter: 0.06, scrapsaver: { min: 4, back: 1 } }; // skills.js PERK_TREE.crafting
export const craftSkill = (s) => skill(s, CRAFT_SKILL);
// May this person attempt the recipe? Its own skill at its min, and Crafting at its cmin.
export const canAttempt = (s, r) => !!s && skill(s, r.skill) >= r.min && craftSkill(s) >= (r.cmin || 0);
const attemptText = (r) => `${SKILL_NAMES[r.skill]} ${r.min}+${r.cmin ? ` and Crafting ${r.cmin}+` : ""}`;
// Recipe → its key (craftQuality gets the recipe itself).
const KEY_OF = new Map();
const keyOf = (r) => { if (!KEY_OF.has(r)) KEY_OF.set(r, Object.keys(CRAFTS).find((k) => CRAFTS[k] === r) || null); return KEY_OF.get(r); };

export const craftName = (key) => CRAFTS[key].name || GEAR[CRAFTS[key].gear].name;
export const craftQueue = (base) => base.crafting || (base.crafting = []);
export const hasWorkshop = (base) => WORKSHOP_TYPES.some((t) => count(base, t) > 0) || !!(benchOf(base) && benchOf(base).workshop); // a workbench or better (buildings.js BENCH)
// Crafting benches (buildings.js BENCH): a recipe needs one here unless a team can make it on the road (field), it
// has its own station (needs) or it only re-packs a clogged filter (spent). A workshop counts as a bench (old saves).
export const benchNeeded = (r) => !r.field && !r.needs && !r.spent;
export const hasBench = (base) => !!benchOf(base) || hasWorkshop(base);
// What the working bench here adds to hand crafting at this base: { rate: × work-hours, quality: + condition }.
export const benchBonus = (base) => { const b = base && benchOf(base); return { rate: b ? b.rate : 1, quality: b ? b.quality : 0 }; };
// An item's condition made at this base with its bench (craftQuality is the crafter's own; still at most 100%).
export const benchQuality = (q, base) => Math.round(Math.min(1, q + benchBonus(base).quality) * 100) / 100;

export function meetsNeeds(base, r) {
  if (!r.needs) return !benchNeeded(r) || hasBench(base);
  if (r.needs === "workshop") return hasWorkshop(base);
  return count(base, r.needs) > 0;
}
const needsText = (r) => (!r.needs ? "a crafting bench" : r.needs === "workshop" ? "a workshop (a workbench, ammo bench or machine shop)" : BUILDINGS[r.needs] ? `a ${BUILDINGS[r.needs].name.toLowerCase()}` : r.needs);

// Short description of what a recipe makes (for the UI).
export function craftOutputText(key) {
  const r = CRAFTS[key];
  if (r.supplies) return Object.entries(r.supplies).map(([k, v]) => `+${v} ${keyWord(k)}`).join(", ");
  const d = GEAR[r.gear];
  const bits = [];
  // What the thing does, by kind: weapons have power, armor has armor, packs carry, tools give their bonus.
  if (d.slot === "weapon") bits.push(`weapon, power ${d.power}${d.fish === "spear" ? `, spears fish (${d.fishPower} food an hour in daylight)` : ""}`);
  else if (d.fish) bits.push(`fishing ${d.fish}, about ${d.fishPower ?? 0.6} food an hour on a river or lake shore, more at dawn and dusk`);
  else if (ARMOR_SLOTS.includes(d.slot)) bits.push(`${SLOT_NAMES[d.slot].toLowerCase()} armor ${d.power}`);
  else if (d.slot === "rig") bits.push(`chest rig, ${(d.pouches || []).length} pouches (${[...new Set(d.pouches || [])].join(", ")}), +${d.carry || 0} kg more to carry (max load); not worn over a vest with pouches`); // carry kit (data-kit.js)
  else if (d.slot === "insert") bits.push(`plate for a plate carrier's front or back pocket, armor ${d.power} (${/steel/.test(r.gear) ? "steel: it can spall, and can be patched" : "ceramic: it can shatter, and cannot be patched"})`); // section 16
  else if (d.slot === "backpack") bits.push(`pack, ${d.slots} pack slots, +${d.carry} kg more to carry (max load)${d.ease ? `, load counts ${Math.round(d.ease * 100)}% lighter` : ""}`);
  else if (r.gear === "bicycle") bits.push("a bike for the base: teams ride out on bikes, one each (faster on roads, no fuel, a 15 kg rack)");
  else if (r.gear === "beartrap") bits.push("a bear trap kept in a base's stores: set on the approach when a horde attacks, it catches about 3 of the dead (up to 4 traps; a quarter break each time)");
  else if (r.gear === "repairkit") bits.push("a field repair kit: mends a gun, an attachment, armour or a makeshift tool anywhere, one use a repair (half a workbench's restore, twice the lost maximum; repair.js)");
  else if (r.gear === "dewormer") bits.push("medicine: cures the worm while it is still in the gut, no medic needed, one use"); // worm.js
  else if (r.gear === "puritabs") bits.push(`medicine: a tube of ${d.dur} tablets, one makes ${WORM.TABS_WATER} un-purified water safe without stopping to boil it (for the road: teams drinking river or well water; a base only when its boiler is cold with nothing to burn and it has no water filter)`); // worm.js
  else {
    const fx = [];
    if (d.medKit) fx.push(`+${d.medKit} Medicine when treating`);
    if (d.selfStab) fx.push(`lets someone down and bleeding in battle stabilize themselves (a try a turn, better with Medicine) when carried in the off hand, a pocket or a rig pouch${d.medKit ? ": a use of the kit" : ": one use"}`);
    for (const [k, v] of Object.entries(d.bonus || {})) fx.push(`+${v} ${SKILL_NAMES[k]}${k === "scavenging" ? " for base scavenging" : ""}`);
    if (d.water) fx.push(`+${d.water} purified water a day at its base and purifies ${WORM.PURIFY_FILTER} un-purified water a day there (strains out the worm's eggs)`);
    // The stealth kit (stealth.js): thrown to pull guards away, a suppressor, a light for night raids.
    if (d.throw) fx.push(d.throw === "molotov" ? "thrown in battle, sets a 3 × 3 patch on fire for 2–3 turns (the dead walk into it), one use" : d.throw === "pipebomb" ? "thrown in battle (over walls too), blows up everyone within a tile and the cover there, one use" : "thrown in battle to pull unaware guards and the dead to a spot, one use");
    if (d.siege) fx.push(d.siege === "ladder" ? "set against a wall in battle to climb onto its walkway" : "carried by 2–3 to smash a barred gate or door, 16–24 a carrier a turn");
    if (d.suppressor) fx.push("a muzzle attachment (gunmods.js): fitted to a 9mm pistol or a rifle, halves the noise of its shots");
    else if (d.cat === "gunmod" && attachText(r.gear)) fx.push(`a gun attachment (gunmods.js): ${attachText(r.gear)}; fits ${fitsText(r.gear)}`);
    if (LIGHTS[r.gear]) fx.push(`a light: at night sees ${LIGHTS[r.gear].sight} tiles (7 without) and searches without fumbling, but is seen ${LIGHTS[r.gear].seen} tile${LIGHTS[r.gear].seen === 1 ? "" : "s"} further${LIGHTS[r.gear].free ? "; hands free" : "; in the off hand"}`); // lights.js
    if (d.heat) fx.push(`${Object.entries(d.heat).filter(([k]) => k !== "hours").map(([k, v]) => `Heat ×${v} ${k === "stay" ? "staying put" : k === "camp" ? "camping" : "searching"}`).join(", ")}${d.heat.hours ? `, for ${d.heat.hours} hours, used up` : ""}`);
    if (d.defence && d.defence.alarm) fx.push("an alarm for a base (everyone counts half on the walls) or a camp (less trouble)");
    bits.push(`${d.throw || d.suppressor || d.siege || d.cat === "gunmod" || (d.selfStab && !d.medKit) ? "kit" : d.heat ? "camp kit" : "tool"}${fx.length ? `, ${fx.join(", ")}` : ""}`);
  }
  if (d.req && d.skill) bits.push(`needs ${SKILL_NAMES[d.skill]} ${d.req}`);
  if (d.dur) bits.push(`lasts ${ownMax(d) ? `about ${d.dur}` : d.dur} ${durUnit(r.gear)}${ownMax(d) ? " (more when well made)" : ""}`);
  if (d.noise === 0 && d.slot === "weapon") bits.push("silent");
  return bits.join(", ");
}
export function durUnit(key) {
  const d = GEAR[key];
  if (d.tabs) return "tablets"; // purification tablets: dur counts the tablets in the tube (worm.js)
  if (d.count) return "left"; // a count stack (data-ammo.js: a box of rounds, primers): what is in it
  if (d.slot === "weapon" || ARMOR_SLOTS.includes(d.slot)) return "fights";
  if (d.medKit) return "treatments";
  if (d.selfStab) return "use"; // a tourniquet (medics.js MEDIC.SELF): one use
  if (key === "repairkit") return "repairs"; // repair.js: a field repair a use
  if (d.suppressor) return "shots";
  if (d.cat === "gunmod") return key === "scrapscope" ? "fights" : "shots"; // makeshift gun parts (gunmods.js)
  if (d.fish) return "days of fishing";
  if (d.heat) return "days in the field";
  return "days";
}

// ---------- the base craft queue ----------
// Crafters: people on the Craft role here (patients in a hospital bed do not work).
export const crafters = (state, base) => atBase(state, base.id).filter((s) => s.role === "craft" && !s.inBed);
const qualified = (state, base, r) => crafters(state, base).filter((s) => canAttempt(s, r));

// One crafter's work-hours per hour on a recipe: 1 + 3% per point of Crafting (× work factor, Machinist, Quick Hands;
// Foreman: someone else crafting at the base).
function crafterRate(s, team) {
  const foreman = team.some((o) => o !== s && hasPerk(o, "foreman")) ? CRAFT_PERKS.foreman : 1;
  return (1 + craftSkill(s) * 0.03) * workFactor(s) * (hasPerk(s, "machinist") ? 1.3 : 1) * (hasPerk(s, "quickhands") ? CRAFT_PERKS.quickhands : 1) * foreman; // the sick work less (health.js); perks (skills.js)
}
// Work-hours per hour on a recipe: what each crafter who may attempt it gives, × the recipe's edge (blueprints.js craftEdge).
export function craftRate(state, base, key) {
  const r = CRAFTS[key];
  const team = crafters(state, base);
  return qualified(state, base, r).reduce((a, s) => a + crafterRate(s, team), 0) * craftEdgeSpeed(state, key) * benchBonus(base).rate; // the bench here (benchBonus)
}

// Expected item condition from Crafting: 75% at 0, 100% at 20. Workshop recipes +10%, field crafts −5%, the recipe's
// edge from known manuals and read craft books (state; blueprints.js craftEdge). The roll (rollQuality) spreads around it.
export function craftQuality(skillLevel, r, field = false, state = null) {
  const q = 0.75 + skillLevel * 0.0125 + (r.needs ? WORKSHOP_QUALITY : 0) + (field ? FIELD_QUALITY : 0) + craftEdgeQuality(state, keyOf(r));
  return Math.round(Math.max(CRAFT_ROLL.lo, Math.min(1, q)) * 100) / 100;
}
// The expected condition of a job at a base: the best qualified crafter's Crafting, plus Good Eye / Master Crafter
// among the crafters there. null when nobody there may attempt it.
export function craftMean(state, base, key) {
  const r = CRAFTS[key];
  const q = qualified(state, base, r);
  if (!q.length) return null;
  const team = crafters(state, base);
  const perk = (team.some((s) => hasPerk(s, "goodeye")) ? CRAFT_PERKS.goodeye : 0) + (team.some((s) => hasPerk(s, "mastercrafter")) ? CRAFT_PERKS.mastercrafter : 0);
  const m = benchQuality(craftQuality(Math.max(...q.map(craftSkill)), r, false, state) + perk, base); // the bench here (benchBonus)
  return Math.round(Math.max(CRAFT_ROLL.lo, Math.min(1, m)) * 100) / 100;
}
// A quality roll around the mean: four uniforms (us, each 0–1) make a bell of sd 1, times the spread at this Crafting.
export function rollQuality(mean, level, us) {
  const z = (us[0] + us[1] + us[2] + us[3] - 2) * Math.sqrt(3);
  const sd = Math.max(CRAFT_ROLL.sdMin, CRAFT_ROLL.sd0 - CRAFT_ROLL.sdPer * level);
  return Math.round(Math.max(CRAFT_ROLL.lo, Math.min(1, mean + z * sd)) * 100) / 100;
}
// Rolled with hash01 (skills.js), never the world's random numbers: crafting moves no other result. tag: the craft.
export function craftRoll(state, mean, level, tag, twice = false) {
  const roll = (n) => rollQuality(mean, level, [0, 1, 2, 3].map((i) => hash01(state.seed, "craftq", tag, n, i)));
  return twice ? Math.max(roll(0), roll(1)) : roll(0);
}
// Worth of what a recipe uses up (data.js SUPPLIES value, GEAR value for items).
export function craftInputValue(r) {
  let v = 0;
  for (const [k, n] of Object.entries(r.in || {})) v += n * ((SUPPLIES[k] && SUPPLIES[k].value) || 0);
  for (const [k, n] of Object.entries(r.gearIn || {})) v += n * ((GEAR[k] && GEAR[k].value) || 0);
  return v;
}
// The kind of thing a recipe makes (CRAFT_XP.kind).
export function craftKind(r) {
  if (r.supplies) return r.supplies.meds ? "medical" : "supplies";
  const d = GEAR[r.gear];
  if (d.slot === "weapon") return "weapon";
  if (ARMOR_SLOTS.includes(d.slot)) return "armor";
  if (d.medKit || r.skill === "medicine") return "medical";
  if (d.heat) return "camp";
  if (d.throw || d.siege || d.suppressor || d.defence) return "kit";
  return "tool";
}
// Crafting XP for one finished craft at this quality.
export function craftXp(r, quality) {
  const qf = Math.max(0.3, 1 + CRAFT_XP.qSlope * (quality - CRAFT_XP.qAt));
  return Math.round(CRAFT_XP.base * (CRAFT_XP.kind[craftKind(r)] || 1) * Math.sqrt(Math.max(1, craftInputValue(r))) * qf * 100) / 100;
}

export function canCraft(state, base, key) {
  const r = CRAFTS[key];
  if (!r) return { ok: false, reason: "Unknown recipe" };
  if (craftQueue(base).length >= MAX_CRAFT_QUEUE) return { ok: false, reason: `Queue is full (${MAX_CRAFT_QUEUE})` };
  if (!meetsNeeds(base, r)) return { ok: false, reason: `Needs ${needsText(r)} here` };
  if (!atBase(state, base.id).some((s) => canAttempt(s, r))) return { ok: false, reason: `Needs a ${attemptText(r)} survivor here` };
  for (const [k, v] of Object.entries(r.in)) if (stockHas(base.stock, k) < v) return { ok: false, reason: `Needs ${v} ${keyWord(k)} (have ${Math.floor(stockHas(base.stock, k))})` };
  for (const [k, v] of Object.entries(r.gearIn || {})) if (base.armory.filter((it) => it && it.key === k).length < v) return { ok: false, reason: `Needs ${v > 1 ? `${v} × ` : "a "}${GEAR[k].name} in the armory` };
  if (r.spent && (base.spentFilters || 0) < r.spent) return { ok: false, reason: "Needs a clogged water filter here (one is kept each time a filter clogs at this base)" };
  const lock = craftLock(state, key); // blueprints.js: advanced recipes need a studied blueprint
  if (lock) return { ok: false, reason: lock, locked: true };
  return { ok: true };
}

// What a recipe uses, for the screens: "1 scrap, 1 fuel, a Empty bottle".
export function craftInText(r) {
  return [...Object.entries(r.in).map(([k, v]) => `${v} ${keyWord(k)}`), ...Object.entries(r.gearIn || {}).map(([k, v]) => `${v > 1 ? `${v} × ` : ""}${GEAR[k].name.toLowerCase()}`)].join(", ");
}

export function queueCraft(state, base, key) {
  const chk = canCraft(state, base, key);
  if (!chk.ok) return chk.reason;
  const r = CRAFTS[key];
  for (const [k, v] of Object.entries(r.in)) useStock(base.stock, k, v);
  const taken = [];
  for (const [k, v] of Object.entries(r.gearIn || {})) for (let i = 0; i < v; i++) taken.push(...base.armory.splice(base.armory.findIndex((it) => it && it.key === k), 1));
  if (r.spent) base.spentFilters -= r.spent;
  craftQueue(base).push({ id: newId(), recipe: key, progress: 0, hours: r.hours, ...(taken.length ? { gearTaken: taken } : {}), ...(r.spent ? { spent: r.spent } : {}) });
  const note = crafters(state, base).length ? "" : " Nobody is on the Craft role yet.";
  return `${craftName(key)} queued at ${base.name}.${note}`;
}

// Cancelling an untouched job refunds everything; a started one gives half back, rounded up (like construction).
// Items it was to use (gearIn) always go back to the armory.
export function cancelCraft(state, base, id) {
  const q = craftQueue(base);
  const job = q.find((c) => c.id === id);
  if (!job) return "That job is gone.";
  const full = job.progress <= 0;
  for (const [k, v] of Object.entries(CRAFTS[job.recipe].in)) { const key = k === "water" ? RAW : k; base.stock[key] = (base.stock[key] || 0) + (full ? v : Math.ceil(v / 2)); } // water comes back un-purified
  if (job.gearTaken) base.armory.push(...job.gearTaken);
  if (job.spent) base.spentFilters = (base.spentFilters || 0) + job.spent;
  q.splice(q.indexOf(job), 1);
  return `Cancelled ${craftName(job.recipe)}. ${full ? "All" : "Half"} the materials were returned.`;
}

// A job held back this hour (job.held = the hour): work priorities leave the governor's or a steward's water filter
// queued while the tanks are full enough and a build is queued (work.js holdFilters); the crafters work the jobs behind it.
export const craftHeld = (state, job) => job.held != null && state.hour - job.held <= 1;
// Why a job is not moving (empty string when it is).
export function craftJobStatus(state, base, job) {
  const r = CRAFTS[job.recipe];
  if (craftHeld(state, job)) return "Waits: the tanks are full enough and a build is queued (its scrap goes to the build first)";
  if (!crafters(state, base).length) return "No crafters. Set someone's role to Craft.";
  if (!meetsNeeds(base, r)) return `Needs ${needsText(r)} here`;
  if (!qualified(state, base, r).length) return `No crafter with ${attemptText(r)}`;
  // A craft order's minimum quality (production.js): the job moves while the expected condition reaches it (a roll
  // below it does not count toward the order, which then queues another).
  if (job.minQ && r.gear) {
    const q = craftMean(state, base, job.recipe);
    if (q + 1e-9 < job.minQ) return `No crafter good enough for ${Math.round(job.minQ * 100)}% (expected ${Math.round(q * 100)}%)`;
  }
  return "";
}

// Hourly: crafters work the first job in the queue they can do (blocked jobs are skipped, not lost).
export function craftingHour(state) {
  for (const base of state.bases) {
    if (base.gearRepairHour === state.hour) continue; // repair.js: the crafters spent this hour on a repair
    const q = craftQueue(base);
    const job = q.find((j) => !craftJobStatus(state, base, j));
    if (!job) continue;
    const rate = craftRate(state, base, job.recipe);
    job.progress += rate;
    noteOutput(state, base, "craft", rate, "workh");
    if (job.progress < job.hours) continue;
    q.splice(q.indexOf(job), 1);
    noteOutput(state, base, "craft", 1, "items");
    const r = CRAFTS[job.recipe];
    const team = crafters(state, base);
    const able = qualified(state, base, r);
    const mean = craftMean(state, base, job.recipe) ?? benchQuality(craftQuality(0, r, false, state), base);
    const best = Math.max(0, ...able.map(craftSkill));
    // Tagged by the hour, the base's place and the recipe (not ids: they come from a counter shared by every world in a process).
    const quality = r.supplies ? mean : craftRoll(state, mean, best, `${state.hour}:${state.bases.indexOf(base)}:${job.recipe}`, team.some((s) => hasPerk(s, "steadybench"))); // Steady Bench: the better of two
    if (r.supplies) {
      for (const [k, v] of Object.entries(r.supplies)) base.stock[k] = (base.stock[k] || 0) + v;
      log(state, `${craftName(job.recipe)} finished at ${base.name}.`, "good");
    } else {
      const item = makeItem(r.gear, quality);
      if (item.dur && team.some((s) => hasPerk(s, "tinkerer"))) { item.dur = Math.round(item.dur * 1.5); if (!GEAR[item.key].tabs) item.durMax = item.dur; } // Tinkerer (skills.js): lasts 50% longer
      base.armory.push(item);
      log(state, `${item.name} crafted at ${base.name} (condition ${Math.round(item.quality * 100)}%). It is in the armory.`, "good");
    }
    // Crafting XP for whoever worked it, by their share of the work this hour (skills.js gainXp: the daily use cap).
    const xp = craftXp(r, quality);
    const rates = able.map((s) => crafterRate(s, team));
    const total = rates.reduce((a, v) => a + v, 0);
    able.forEach((s, i) => gainXp(state, s, CRAFT_SKILL, total > 0 ? (xp * rates[i]) / total : xp / able.length));
    // Scrap Saver: a big job gives a scrap back.
    if ((r.in.scrap || 0) >= CRAFT_PERKS.scrapsaver.min && team.some((s) => hasPerk(s, "scrapsaver"))) base.stock.scrap = (base.stock.scrap || 0) + CRAFT_PERKS.scrapsaver.back;
  }
}

// ---------- items and durability ----------
// A crafted item's uses by its quality: the listed dur at 75% (a crafter with no skill), up to 20% more at 100%,
// 12% less at the 60% floor. Quality also sets what it does: a weapon's damage and an armor piece's protection
// (world.js combatPower, combat.js, inventory.js itemArmor) and a fishing tool's catch (hunting.js fishToolPower).
export const craftedDur = (dur, quality = 1) => Math.max(1, Math.round(dur * (0.4 + 0.8 * Math.max(0, Math.min(1, quality)))));
// Durability with its own maximum (item.durMax: crafted, or worn part-way when found); counts, not wear, stay out.
const ownMax = (d) => d && d.dur && !d.tabs && !d.groom && !d.count; // count stacks (data-ammo.js boxes) count what is left
export function makeItem(key, quality = 1) {
  const d = GEAR[key];
  const item = { key, name: d.name, quality };
  if (d.dur) item.dur = d.dur;
  if (ownMax(d)) { item.dur = craftedDur(d.dur, quality); if (item.dur !== d.dur) item.durMax = item.dur; }
  if (d.slots) ensurePack(item); // a pack comes with empty pack slots
  return item;
}

// Uses left (null = does not wear). Items made before durability (loot, older code) start full.
export function itemDur(item) {
  if (!item) return null;
  const d = GEAR[item.key];
  if (!d || !d.dur) return null;
  return item.dur != null ? item.dur : itemDurMax(item);
}
// Its uses when new: its own (crafted by quality, a Tinkerer's) or the listed ones.
export function itemDurMax(item) {
  const d = item && GEAR[item.key];
  if (!d || !d.dur) return null;
  return item.durMax || d.dur;
}

// Wears an item by n uses. Returns true when it broke.
export function wear(item, n = 1) {
  const left = itemDur(item);
  if (left == null) return false;
  item.dur = Math.max(0, left - n);
  return item.dur <= 0;
}

// Wears what a survivor has in a slot; a broken item is gone.
// item.lastUsed: the day it last wore (repair.js: the autopilot mends what is used first).
const used = (state, item) => { if (item && state && Number.isFinite(state.hour) && itemDur(item) != null) item.lastUsed = Math.floor(state.hour / 24); };
export function wearSlot(state, s, slot, n = 1) {
  const item = s.gear[slot];
  used(state, item);
  if (!item || !wear(item, n)) return false;
  s.gear[slot] = null;
  log(state, `${s.name.split(" ")[0]}'s ${item.name} broke.`, "danger");
  return true;
}

// Wears an item wherever it is kept: on one of these people (a slot, a pocket, the pack) or in one of these lists (a
// team's cargo, a base's armory). A broken item is gone. Returns true when it broke.
export function wearHeld(state, item, people = [], lists = [], n = 1) {
  used(state, item);
  if (!item || !wear(item, n)) return false;
  let who = null;
  for (const s of people) {
    if (!s || !s.gear) continue;
    for (const k of Object.keys(s.gear)) if (s.gear[k] === item) { s.gear[k] = null; who = s; }
    (s.pockets || []).forEach((it, i) => { if (it === item) { s.pockets[i] = null; who = s; } });
    const pk = s.gear.backpack && s.gear.backpack.contents;
    (pk || []).forEach((it, i) => { if (it === item) { pk[i] = null; who = s; } });
    if (who) break;
  }
  if (!who) for (const l of lists) { const i = (l || []).indexOf(item); if (i >= 0) { l.splice(i, 1); break; } }
  log(state, `${who ? `${who.name.split(" ")[0]}'s` : "The"} ${item.name} broke.`, "danger");
  return true;
}

// After a fight: weapons and every worn armor piece (body, head, arms, legs) lose one use.
export function wearAfterFight(state, people) {
  for (const s of people) {
    if (!s || !s.alive) continue;
    wearSlot(state, s, "weapon");
    for (const slot of ARMOR_SLOTS) wearSlot(state, s, slot);
    for (const m of wearMakeshiftMods(s.gear.weapon)) log(state, `${s.name.split(" ")[0]}'s ${m.name} fell apart.`, "danger"); // gunmods.js: a scrap scope wears a fight at a time
  }
}

// A treatment with a kit that wears (the bandage kit) uses it up a little: at a base, in the field and in battle.
export function useMedKit(state, s) {
  if (s && s.alive && s.gear.tool && GEAR[s.gear.tool.key] && GEAR[s.gear.tool.key].medKit) wearSlot(state, s, "tool");
}

// Medicine bonus from the kit in the off hand (GEAR[key].medKit): +2 for a bandage kit, +4 for a surgical kit.
// The usual skill-gap rule applies (world.gearEffect): a surgical kit needs Medicine 10 for the full bonus,
// gives less below that and nothing below 3. One rule for treating at a base, in the field and in battle.
export function medKitBonus(s) {
  const t = s && s.gear && s.gear.tool;
  const d = t && GEAR[t.key];
  if (!d || !d.medKit) return 0;
  const eff = gearEffect(s, t);
  return eff.usable ? Math.round(d.medKit * eff.mult * 10) / 10 : 0;
}

// Skill bonus a tool gives for base work (crowbar: Scavenging).
export function toolBonus(s, skillKey) {
  const t = s.gear.tool;
  if (!t) return 0;
  const b = GEAR[t.key].bonus;
  return (b && b[skillKey]) || 0;
}

// A water filter job (made or re-packed), and the recipe to queue for one here: a clogged one re-packed (1 scrap)
// while this base keeps one, else a new one (4 scrap).
export const isFilterJob = (j) => !!j && (j.recipe === "waterfilter" || j.recipe === "repackfilter");
export const filterRecipe = (base) => ((base.spentFilters || 0) >= CRAFTS.repackfilter.spent ? "repackfilter" : "waterfilter");
// Water filters in use (tune-jobcaps): a filter clogs only on the days water runs through it. One always does (it
// cleans the drinking water: dysentery four times rarer, health.js); more only while their water is wanted (the
// tanks have room after tomorrow's wells, streams and rain, which fill them first: a filter's water above that only
// spills over) or while the worm's eggs are in the water and the boiler or a shelter's fire leave part of the day's
// drinking for the filters to strain (worm.js PURIFY_FILTER each). The rest stand dry in the armory and keep. Before,
// every filter clogged day by day, needed or not: the governor's summer filters (made for a heat wave that might not
// come, 3 weeks ahead) clogged in full tanks and were made again, 4 scrap each (a 29-person hub ~25 between days 120
// and 200 of a 200-day run). A filter that does clog leaves its bucket at the base (base.spentFilters): re-packed for
// 1 scrap (CRAFTS.repackfilter) before a new one is made (filterRecipe). Over 10 Balanced 200-day runs (seeds 1–9, 42)
// the filters' scrap went 800 → 406 (days 120–200: 380 → 155; the 32-person hub of seed 8 200 → 79), 200 filters
// queued → 154 (of them 70 re-packed), buildings 399 → 412.
export function filtersInUse(state, base, n) {
  if (!n) return 0;
  // Under the autopilot, up to the governor's fill level (autopilot.js filterFill: a few days of drinking, the summer
  // store), not the whole room its summer store built.
  const fillTo = state.autopilot && Number.isFinite(base.filterFill) ? Math.min(waterCapacity(base), base.filterFill) : waterCapacity(base);
  const room = Math.max(0, fillTo - waterIn(base.stock) - waterProduction(state, base).total);
  let use = Math.ceil(room / WATER.filter - 1e-9);
  if (rawWaterEggs(state, base).eggs > 0) {
    const cap = purifyCap(state, base);
    use = Math.max(use, Math.ceil(Math.max(0, cap.drink - cap.boiler - cap.fire) / WORM.PURIFY_FILTER - 1e-9));
  }
  return Math.min(n, Math.max(1, use));
}
// Daily: the water filters in use make water at their base (in the armory or held by someone there) and wear out,
// the most worn first (filtersInUse); tools used for base work (crowbar while scavenging) wear by a day.
export function craftingDaily(state) {
  for (const base of state.bases) {
    const people = atBase(state, base.id);
    let water = 0;
    const list = [
      ...base.armory.filter((it) => it && GEAR[it.key] && GEAR[it.key].water).map((item) => ({ item })),
      ...people.filter((s) => s.gear.tool && GEAR[s.gear.tool.key] && GEAR[s.gear.tool.key].water).map((s) => ({ item: s.gear.tool, s })),
    ];
    const use = filtersInUse(state, base, list.length);
    base.filtersInUse = use;
    for (const f of [...list].sort((a, b) => (itemDur(a.item) ?? 99) - (itemDur(b.item) ?? 99)).slice(0, use)) {
      water += GEAR[f.item.key].water;
      if (f.s) { if (wearSlot(state, f.s, "tool")) base.spentFilters = (base.spentFilters || 0) + 1; continue; }
      if (wear(f.item)) {
        base.armory.splice(base.armory.indexOf(f.item), 1);
        base.spentFilters = (base.spentFilters || 0) + 1;
        log(state, `The ${f.item.name} at ${base.name} clogged up: its bucket is kept, re-packed for 1 scrap (Crafting).`, "danger");
      }
    }
    for (const s of people) {
      const t = s.gear.tool;
      if (!t) continue;
      const d = GEAR[t.key];
      if (!d.water && d.bonus && d.bonus.scavenging && s.role === "scavenge" && !s.inBed) wearSlot(state, s, "tool");
    }
    if (water) base.stock.water = (base.stock.water || 0) + water;
  }
  // Camp kit (GEAR heat: the ghillie wrap, rag boots, camo netting, the stove) wears a day for each day a team is out
  // with it; the scent mask is used up by the hour instead (fieldheat.js).
  for (const p of state.parties || []) {
    if (p.owner !== "player") continue;
    const team = partyMembers(state, p);
    const cargo = (p.cargo && p.cargo.gear) || [];
    const kit = [...team.flatMap((s) => heldItems(s)), ...cargo].filter((it) => it && GEAR[it.key] && GEAR[it.key].heat && GEAR[it.key].dur);
    for (const it of kit) wearHeld(state, it, team, [cargo]);
  }
}
// Everything on a person: worn and held, pockets, the pack's slots.
const heldItems = (s) => [...Object.values(s.gear || {}), ...(s.pockets || []), ...((packOf(s)) || [])].filter(Boolean);

// ---------- field crafting (a team on the road) ----------
const partyHas = (p, k) => (k === "water" ? teamWaterIn(p) : k === "ammo" ? carriedRounds(p) : k === "food" ? foodIn(p.supplies || {}) + foodIn((p.cargo && p.cargo.supplies) || {}) : Math.max(0, p.supplies[k] || 0) + Math.max(0, (p.cargo && p.cargo.supplies[k]) || 0)); // food: days of it (foods.js)
function partyTake(p, k, qty) {
  if (k === "water") { takeTeamWater(p, qty, { rawFirst: true }); return; } // boiled in the work: un-purified first (water.js)
  if (k === "ammo") { const c = spendAmmo(p.cargo && p.cargo.supplies, qty, p.ammoCals).n; spendAmmo(p.supplies, qty - c, p.ammoCals); return; } // rounds.js: any calibre, the ones its guns need least
  if (k === "food") { takeFood([p.cargo, p].filter(Boolean), qty, { eggs: false }); return; } // foods.js: days of food, the soonest to spoil first
  const fromCargo = Math.min(qty, Math.max(0, (p.cargo && p.cargo.supplies[k]) || 0));
  if (fromCargo) p.cargo.supplies[k] -= fromCargo;
  p.supplies[k] = (p.supplies[k] || 0) - (qty - fromCargo);
}

// Simple recipes a team can make from what it carries. Each: { key, name, ok, reason, in, hours, skill, min, out }.
// hours is how long the work would take; fieldCraft does not move the clock (an order can add the wait).
export function fieldCraftOptions(state, party) {
  const members = party ? partyMembers(state, party) : [];
  return Object.entries(CRAFTS).filter(([, r]) => r.field).map(([key, r]) => {
    let reason = "";
    if (!members.length) reason = "Nobody on this team.";
    else if (!members.some((s) => canAttempt(s, r))) reason = `Needs ${attemptText(r)} on the team`;
    else {
      const miss = Object.entries(r.in).find(([k, v]) => partyHas(party, k) < v);
      if (miss) reason = `Needs ${miss[1]} ${miss[0]}; the team carries ${Math.floor(partyHas(party, miss[0]))}`;
      const missG = Object.entries(r.gearIn || {}).find(([k, v]) => partyItems(state, party).filter((x) => x.it.key === k).length < v);
      if (!reason && missG) reason = `Needs ${missG[1] > 1 ? `${missG[1]} × ` : "a "}${GEAR[missG[0]].name.toLowerCase()} with the team`;
    }
    return { key, name: craftName(key), ok: !reason, reason, in: { ...r.in }, gearIn: { ...(r.gearIn || {}) }, inText: craftInText(r), hours: r.hours, skill: r.skill, min: r.min, out: craftOutputText(key) };
  });
}

// Items a team has: in its cargo and on its people (pockets, hands, pack). [{ it, take() }]
function partyItems(state, party) {
  const out = [];
  const cargo = (party.cargo && party.cargo.gear) || [];
  for (const it of cargo) out.push({ it, take: () => cargo.splice(cargo.indexOf(it), 1) });
  for (const s of partyMembers(state, party)) {
    for (const [k, it] of Object.entries(s.gear || {})) if (it) out.push({ it, take: () => { s.gear[k] = null; } });
    (s.pockets || []).forEach((it, i) => { if (it) out.push({ it, take: () => { s.pockets[i] = null; } }); });
    const pk = s.gear && s.gear.backpack && s.gear.backpack.contents;
    (pk || []).forEach((it, i) => { if (it) out.push({ it, take: () => { pk[i] = null; } }); });
  }
  return out;
}

// Makes one field recipe from the team's supplies. Gear goes to a member with that slot free, else into the cargo.
export function fieldCraft(state, party, recipeKey) {
  const opt = fieldCraftOptions(state, party).find((o) => o.key === recipeKey);
  if (!opt) return "The team cannot make that in the field.";
  if (!opt.ok) return opt.reason;
  const r = CRAFTS[recipeKey];
  // An item nobody can wear needs room in the cargo (parties.js addGearToCargo); checked before materials are used.
  const worn = !r.supplies && EQUIP_SLOTS.includes(GEAR[r.gear].slot);
  const roomOn = (s) => (worn ? !s.gear[GEAR[r.gear].slot] : (GEAR[r.gear].small && (s.pockets || []).includes(null)) || (!GEAR[r.gear].bulky && (packOf(s) || []).includes(null)));
  if (!r.supplies && !partyMembers(state, party).some(roomOn)) {
    const probe = makeItem(r.gear, 1);
    if (!addGearToCargo(state, party, probe)) return `No free ${SLOT_NAMES[GEAR[r.gear].slot] || "slot"} on anyone and no room in the cargo for a ${probe.name}: not made.`;
    party.cargo.gear.splice(party.cargo.gear.indexOf(probe), 1);
  }
  for (const [k, v] of Object.entries(r.in)) partyTake(party, k, v);
  for (const [k, v] of Object.entries(r.gearIn || {})) for (let i = 0; i < v; i++) { const x = partyItems(state, party).find((y) => y.it.key === k); if (x) x.take(); }
  const members = partyMembers(state, party);
  const able = members.filter((s) => canAttempt(s, r));
  const maker = able.reduce((a, s) => (craftSkill(s) > craftSkill(a) ? s : a), able[0]); // the best at Crafting who may attempt it
  const who = maker.name.split(" ")[0];
  const mean = craftQuality(craftSkill(maker), r, true, state);
  const quality = r.supplies ? mean : craftRoll(state, mean, craftSkill(maker), `f${state.parties.indexOf(party)}:${state.hour}:${recipeKey}:${maker.name}`, hasPerk(maker, "steadybench"));
  gainXp(state, maker, CRAFT_SKILL, craftXp(r, quality)); // Crafting XP for the maker
  if (r.supplies) {
    for (const [k, v] of Object.entries(r.supplies)) party.supplies[k] = (party.supplies[k] || 0) + v;
    return `${who} makes ${craftName(recipeKey).toLowerCase()} (${opt.out}) in about ${r.hours} hours.`;
  }
  const item = makeItem(r.gear, quality);
  const slot = GEAR[r.gear].slot;
  // Worn kit to a free slot; small things (throwables, camp kit) to a pocket or a pack (they are not worn).
  if (!EQUIP_SLOTS.includes(slot)) {
    for (const s of members) {
      const at = stow(s, item);
      if (at) return `${who} makes a ${item.name} in about ${r.hours} hours; ${s.name.split(" ")[0]} keeps it (${at.includes(":pocket:") ? "pocket" : "pack"}).`;
    }
  }
  const taker = EQUIP_SLOTS.includes(slot) ? members.find((s) => !s.gear[slot]) : null;
  if (taker) {
    taker.gear[slot] = item;
    return `${who} makes a ${item.name} in about ${r.hours} hours; ${taker.name.split(" ")[0]} takes it (${slot}).`;
  }
  party.cargo = party.cargo || { supplies: {}, gear: [] };
  party.cargo.gear.push(item);
  return `${who} makes a ${item.name} in about ${r.hours} hours. It goes in the cargo.`;
}

