// Hunting, snares and fishing: food from the land itself (team orders on a tile, the hunting cabin at a base, and
// fishing at a base by the water). Everything here is fresh game: it is food, but it weighs twice as much as packed
// food on the way home (a carcass is bones and hide too) and it spoils fast until it is eaten, dried or smoked.
//
// The land (per tile; state.game for game, state.fish for fish, created on the first hunt):
//   abundance = terrain (forest 1, hills 0.8, farmland 0.55, mountains 0.5, suburbs 0.12, city 0.03)
//               × 1.1 by a river or lake (game comes to drink) × 0.8 on a site (people lived there)
//               × (1 − 0.6 × infection) × hive land 0.15 (its red ring 0.05) × 0.3 on one of your bases and × 0.6
//               next to one (people, noise and smoke)
//   level     = 1 untouched; every ration taken lowers it (a deer, 30 rations: −0.3; a rabbit −0.03; fish 1/50 a
//               ration), and it grows back toward 1 with a half-life of 20 days (fish 10): weeks, not days.
//   Words on the tile panel: plenty (abundance × level ≥ 0.6), some (≥ 0.3), scarce (≥ 0.08), none.
//
// Hunt (team order, N hours on a land tile): each hour rolls for big game and small game.
//   big:   6.5% × abundance × level × season × time of day × weather × team(big)   (a deer 30 rations, a wild hog 16;
//          hills and mountains only deer)
//   small: 32% × the same × team(small), a second one at a third of that   (rabbits, birds: 2 rations each)
//   season: spring 0.8, summer 0.9, autumn 1.25 (fat and moving), winter 0.95 (× 1.2 with snow on the ground: tracks)
//   time of day: dawn and dusk (05–07, 17–19) × 1.3, day × 1, night (20–04) × 0.35; a storm or blizzard × 0.5
//   team: the best three hunters count 1, ½ and ¼ (+0.08 a hand without a weapon, up to two, driving game):
//     a hunter = their best hunting weapon (big / small game: hunting rifle 1 / 0.8, bows and crossbows 0.6 + 0.08 ×
//     power for big game (scrap crossbow 0.8, compound bow 0.86, hunting crossbow 0.9) / 0.9,
//     shotgun 0.45 / 1.2, automatic 0.7 / 0.6, pistol 0.3 / 0.6; melee: none; a scope fitted to the gun × 1.15 / 1.05,
//     SCOPE_HUNT: the hunting rifle's own is in its numbers) × the weapon's skill gap ×
//     skill (0.55 + 0.09 × (0.5 Shooting + 0.35 Scouting + 0.15 Stealth)) × 1.25 with the Hunter perk.
//     Firearms need ammo carried (1 a shot); bows and crossbows are silent and need arrows (ARROW: each shot at game,
//     a second one after a miss as for guns, loses its arrow half the time: about 0.6 arrows a kill). Nobody with a
//     hunting weapon: no hunt (set snares instead).
//   Gunshots: each kill with a firearm is 1 shot, a second one (a miss first) 40% of the time for big game and 20% for
//     small: 1 ammo and +6 Heat each (× the gun's noise / 3) on top of the hour's Heat, and each wandering horde
//     within 3 tiles turns toward the shots 25% of the time (both × the gun attachments' noise, gunmods.js: a suppressor
//     cuts them to 35–50%, a muzzle brake adds 30%). Bows add nothing. (A rifle hunt in good country fires
//     5–8 shots in 8 hours: Heat ~40–50 from the shots alone.)
//
// The hunting mix (a setting per base, base.huntMix: traps / bows / guns in steps of 10%, DEFAULT_MIX all guns): the
//   share of the hunting hours spent on each method, for the base's hunters and for its teams' hunts.
//   Guns:  the hunter's best weapon (a rifle first; a bow if that is all they have): ammo, Heat and noise as above.
//   Bows:  bows and crossbows only, with arrows: silent, no Heat, no noise. Hunters without one drive game (+0.08).
//   Traps: snares and deadfalls worked in that hour: small game only, silent, no Heat, no ammo or arrows. At a base a
//          trap hour is a third of a day on two snare lines (the old weaponless hunter's work: CABIN.snareLines); on a
//          team's hunt the lines soak for hours, not a day: TRAP.field (half) of that, + TRAP.hand a hand past the
//          first (up to two). About half a rifle's food at a base (3 hunters, 20 autumn days: 116 vs 246) and
//          under a third on a team's hunt (a rifle and a bow, 8h of autumn forest: 7 vs 26).
//   Fallbacks (never louder than the mix): no gun or no ammo for a gun hour → a bow → traps; no bow or arrows → traps.
//   A team's hours follow the mix in turn (methodAt: the method furthest behind its share goes next); a base deals
//   its hunters' hours out each day (cabinPlan: gun hours to those with guns, bow hours to those with bows, the rest
//   on the snare lines; the fraction of an hour carries over to the next day, base.huntCarry). The governor
//   (autoHuntMix) quiets a cabin with wandering dead within 3 tiles (bows and traps), saves ammo for the walls with bows
//   when it is short, and mixes bows and guns when it has bows and arrows.
//   What does not fit in the cargo stays where it fell (the team takes what it can carry; the estimates follow the
//   chances of each load hour by hour, so they count what is really kept).
//   Expect: two decent hunters with a rifle and a pistol, 8 hours in autumn forest, ~20 food (a deer about every
//   other hunt, a few rabbits); summer about three quarters of that, farmland about half; a town almost nothing.
//
// Snares (team order): lay a line of 8 snares (2h) with snare wire (the coil stays with the line and comes back
//   when it is lifted) or 2 scrap (fence wire). Checking a line (1h) collects the catch and leaves it set; lifting
//   it (1h) also takes it up. Each day a line catches 1 small game (2 rations) × abundance × level × season, caught
//   game keeps 3 days (2 in the heat, 6 in the cold), and from the third day without a check each day has an 8%
//   chance (more by towns, in hive land, with a horde near) that it is robbed or sprung: the catch is gone, and
//   30% of the time the line with it. Quiet: Heat × 0.8 while setting or checking.
// Fish (team order, N hours on a river bank or a lake shore, with a fishing rod, a net or a spear carried): 0.6
//   rations an hour a rod (a makeshift rod 0.42), 1.2 a net worked by two (0.7 by one), a spear 0.5 (a pipe spear
//   0.35; GEAR fishPower), each × its condition (0.6 + 0.4 × quality: a well-made rod catches more) × water (a deep river bend or a lake 1, a river 0.85, a pond 0.6)
//   × season
//   (spring 1.15, summer 1, autumn 0.9, winter 0.75) × time of day (dawn/dusk 1.4, night 0.5) × skill
//   (0.6 + 0.08 × (0.6 Scouting + 0.4 Stealth)) × the water's level. Frozen water: ice fishing needs a tool to cut
//   the ice (crowbar, machete, hatchet or axe) and catches half. Spears (fish: "spear") strike in the shallows by
//   sight: daytime × 1.2, dawn and dusk × 1, night × 0.15, and no use through ice. One tool a fisher (a net two), the
//   best first. Tools wear (GEAR dur, days of fishing): a team's every FISH.wearHours fished, a base's each day of
//   the Fish job; a spear only half the time (FISH.spearWear: it is mostly a weapon). Quiet: Heat × 0.7.
//
// Fresh game is raw meat by the animal (foods.js 2026-10-10: a deer is raw venison, a wild hog raw boar, small game
//   raw rabbit or fowl, fish raw fish; a kill's rations are days of food, 2000 kcal):
//   Carried it weighs what the meat weighs: MEAT_KG (about 1.35 kg) a day of food (load.js bands: a deer on foot is a
//   heavy walk; a car carries it all). A team eats what spoils first, and raw meat keeps 2–3 days (fish a day and a
//   half) at room temperature, × CARRIED by the hour's temperature in a pack.
//   At a base it sits in the food rooms like any fresh food (storage.js: the coldest room first, it spoils fastest),
//   the cook fire makes meals of it and the drying racks take it first; a hunting cabin's smokehouse keeps it longer
//   (× CABIN.spoil) and smokes up to 6 days of it a day into 5 of jerky (fish: smoked fish).
//
// Hunting cabin (buildings.js "huntcabin", any base with game land within 2 tiles: abundance there adding up to 3):
//   the people on the Hunt work type / role (no fixed cap: as many as the food the land must bring in wants,
//   CABIN above) hunt the land within 2 tiles 4 hours a day (dawn and dusk: CABIN.huntHours) by the base's hunting
//   mix, with their own weapons or one lent for the day (huntLoans: the armory's, or a resident's who is not hunting
//   or on guard), the base's ammo (never its last 3 a head + 10: those are for the walls) and its arrows, the same
//   rolls and depletion as a team; trap hours (and a hunter without a weapon) tend
//   snares there (two lines' worth a full day). Gunshots around the base add to its Heat (base.huntNoise, hordes.js
//   baseHeat: the gun's noise / 3 a kill) and each wandering horde within 3 tiles of a hunting ground with gunfire that
//   day turns toward it 25% of the time. Fish work / role: a base on a river or a lake shore, one rod or net a fisher
//   (carried or in the armory), 3 hours a day. Expect a good hunter at a cabin in forest to bring in about 4–6 food a
//   day once the land settles (a farmer about 2), less in spring and on farmland.
import { gunMods, wearMuzzle, hasScope, isScope } from "./gunmods.js"; // a suppressed gun is quieter on a hunt; a scoped one hunts better
import { FACTORY_FIT } from "./data-guns.js"; // a gun that comes with its scope (the hunting rifle): its hunting numbers have it in
import { GEAR, SUPPLIES } from "./data.js";
import { log, skill, gearEffect, atBase, newId, baseById, hub } from "./world.js";
import { partyMembers, partyTile, tileLabel, teamName, cargoRoom, carried, takeSupply } from "./parties.js";
import { packOf, allCarried } from "./inventory.js";
import { wearHeld } from "./crafting.js"; // fishing tools wear by the day's fishing
import { hasPerk, gainXp } from "./skills.js";
import { zombieToughness } from "./hives.js";
import * as Weather from "./weather.js";
import { count } from "./buildings.js";
import { workFactor } from "./health.js";
import { foragingDaily, landFoodHands } from "./foraging.js";
import { wormKill, huntYieldMult, WORM } from "./worm.js";
import { FOODS, foodIn, foodUnits, addFood, takeFood, moveFood, ageLots, unitsOf, qtyOf, foodText, foodRng } from "./foods.js"; // game is raw meat by the animal
import { totalRounds, sumRecs } from "./rounds.js"; // rounds by calibre
import { huntRounds, huntLoad, takeHuntShots, baseAmmo } from "./ammo.js"; // a gun hunts with its own calibre and load (R9)
import { noteOutput } from "./output.js"; // the base's Work now panel: what each job brought in a day (activity.js)
import { workLand, distFactor, waterSources, shoreOf, NO_WATER, walkMult, tileGameMult } from "./tripland.js"; // the Hunt and Fish jobs in trips: the land, the water and the walking (jobtrips.js)

// ---------- numbers ----------
export const HUNT = {
  big: 0.065, small: 0.32, bigDeplete: 100, smallDeplete: 60, halfLife: 20,
  shotHeat: 6, missChance: 0.4, missSmall: 0.2, drawChance: 0.25, drawRange: 3,
  minHours: 2, maxHours: 24, defHours: 8,
};
export const ANIMALS = {
  deer:  { name: "deer", plural: "deer", rations: 30, big: true, item: "f_venison" },
  hog:   { name: "wild hog", plural: "wild hogs", rations: 16, big: true, item: "f_boar" },
  small: { name: "small game", plural: "small game", rations: 2, big: false, item: null }, // rabbit or fowl (gameItem)
  fish:  { name: "fish", plural: "fish", rations: 1, big: false, item: "f_fish" },
};
export const SNARE = { count: 8, perDay: 1, setHours: 2, checkHours: 1, scrap: 2, theft: 0.08, wireLoss: 0.3, deplete: 60, safeDays: 2 };
export const FISH = { rod: 0.6, net: 1.2, netAlone: 0.7, deplete: 50, halfLife: 10, ice: 0.5, wearHours: 6, spearWear: 0.5 };
// The cabin's Hunt job has no head-count cap (tune-jobcaps: it was 2): hunters are sized to the food the land must
// bring in (foraging.js landFoodHands), each takes the best tile left and a kill thins it hard (a deer −0.3), so a
// crowd soon hunts poor ground. Fishers likewise (one rod or net each: the tools are the cap); the base's one spot
// gives each fisher past the first fishCrowd less (fishers' bank space and spooked fish; at least fishCrowdFloor).
export const MEAT_KG = 1.35; // kg of raw game a day of food, about (venison 1.33, boar 1, rabbit and fowl 1.4, fish 1.4)
// huntHours (2026-10-12, user request "improve hunting work at bases, it does not seem to do anything"): a base hunter's
// day at dawn and dusk, 4 hours (it was CABIN.hours, 3, the fishers' day still); the trip's scale is the same
// (tripland.js TRIP_JOBS.hunt.nominal).
export const CABIN = { radius: 2, hours: 3, huntHours: 4, smoke: 6, smokeOut: 5, land: 3, spoil: 0.6, snareLines: 2, fishCrowd: 0.1, fishCrowdFloor: 0.4 };
export const GAME_TERRAIN = { forest: 1, hills: 0.8, mountain: 0.5, plains: 0.55, suburb: 0.12, city: 0.03, water: 0 };
// Hunting weapons by trade category (data.js GEAR cat); a GEAR entry's own `hunt: { big, small }` overrides it.
export const HUNT_CAT = {
  rifle: { big: 1, small: 0.8 }, bow: { big: 0.85, small: 0.9 }, crossbow: { big: 0.85, small: 0.9 },
  shotgun: { big: 0.45, small: 1.2 }, automatic: { big: 0.7, small: 0.6 }, smg: { big: 0.5, small: 0.6 }, pistol: { big: 0.3, small: 0.6 },
};
// A scope on the hunter's gun (user request 2026-10-08): × these on its big and small game (a deer at 200 metres is a
// shot a scope makes). Any magnifying sight counts (gunmods.js isScope: the 4× scope, ACOG, LPVO, the tactical, thermal
// and scrap scopes; not a red dot or a holo sight) fitted to the gun. The hunting rifle's own scope is already in its
// numbers (rifle 1 / 0.8; it has no sight slot: user pick G4, food from it as before), as is the sniper rifle's and the
// .50's (their own hunt numbers). A scoped AR-15 hunts deer at 0.7 × 1.15 = 0.8; a scoped lever-action or carbine
// 1.15, past the hunting rifle's 1. Everyone who hunts with a gun reads it here (the Hunt job, a team's hunt, crews,
// the autopilot).
export const SCOPE_HUNT = { big: 1.15, small: 1.05 };
export const scopedForHunt = (item) => !!item && hasScope(item);
// Arrows (data.js SUPPLIES.arrows): the chance a shot at game loses its arrow; how many a hunting team takes from home
// when someone on it has a bow (plans.js applyPlan, packHuntArrows).
export const ARROW = { lost: 0.5, pack: 12 };
// Trap hours on a team's hunt (the mix's traps share): field × a base trapper's hour, + hand for each hand past the
// first (up to two).
export const TRAP = { field: 0.5, hand: 0.25 };
// The hunting mix (base.huntMix): percent of the hunting hours by method, in steps of 10, adding up to 100.
export const HUNT_METHODS = ["traps", "bows", "guns"];
export const METHOD_NAMES = { traps: "Traps", bows: "Bows", guns: "Guns" };
export const DEFAULT_MIX = { traps: 0, bows: 0, guns: 100 };
export const MIX_PRESETS = {
  guns:  { name: "Guns", mix: { traps: 0, bows: 0, guns: 100 }, desc: "Every hunter shoots their best weapon (a rifle first): the most food, ammo, Heat and noise." },
  mixed: { name: "Bows and guns", mix: { traps: 0, bows: 50, guns: 50 }, desc: "Half the hours with bows and arrows, half with guns: half the shots and their noise." },
  quiet: { name: "Quiet", mix: { traps: 40, bows: 60, guns: 0 }, desc: "Bows and traps only: no shots, no Heat, no noise; less food." },
  traps: { name: "Traps only", mix: { traps: 100, bows: 0, guns: 0 }, desc: "Snares and deadfalls: small game only, no ammo or arrows, silent; the least food." },
};
const ICE_TOOL = /^(crowbar|machete|sawmachete|springmachete|hatchet|axe|fireaxe|iceauger|woodaxe)$/;
const r1 = (x) => Math.round(x * 10) / 10;
const first = (s) => s.name.split(" ")[0];

// ---------- the land ----------
export function gameAbundance(state, tile) {
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return 0;
  let a = GAME_TERRAIN[t.terrain] ?? 0.3;
  if (t.river || state.grid.neighbors(tile).some((n) => state.tiles[n] && state.tiles[n].terrain === "water")) a *= 1.1;
  if (t.loc) a *= 0.8;
  a *= 1 - 0.6 * Math.max(0, Math.min(1, t.infection || 0));
  const tough = state.hives ? zombieToughness(state, tile) : 0;
  if (tough) a *= tough >= 3 ? 0.05 : 0.15;
  if (state.bases.some((b) => b.tile === tile)) a *= 0.3;
  else if (state.bases.some((b) => state.grid.distance(b.tile, tile) <= 1)) a *= 0.6; // people, noise and smoke next door
  return a;
}
const levelIn = (store, key, hour, half) => {
  const r = store && store[key];
  if (!r) return 1;
  const days = Math.max(0, hour - r[1]) / 24;
  return 1 - (1 - r[0]) * Math.pow(0.5, days / half);
};
export const gameLevel = (state, tile, hour = state.hour) => levelIn(state.game, tile, hour, HUNT.halfLife);
export const fishLevel = (state, tile, hour = state.hour) => levelIn(state.fish, tile, hour, FISH.halfLife);
function lower(state, key, tile, amount) {
  const store = state[key] || (state[key] = {});
  const now = key === "fish" ? fishLevel(state, tile) : gameLevel(state, tile);
  store[tile] = [Math.max(0, Math.round((now - amount) * 1e4) / 1e4), state.hour];
}
export const takeGame = (state, tile, rations, per) => lower(state, "game", tile, rations / per);
export const gameWord = (v) => (v >= 0.6 ? "plenty" : v >= 0.3 ? "some" : v >= 0.08 ? "scarce" : "none");

// ---------- seasons, hours, weather ----------
export function seasonGame(state, hour = state.hour) {
  const k = Weather.season(state, hour).key;
  const m = { spring: 0.8, summer: 0.9, autumn: 1.25, winter: 0.95 }[k] ?? 1;
  return m * ((Weather.weather(state, hour).snowCover || 0) >= 0.3 ? 1.2 : 1);
}
export const seasonFish = (state, hour = state.hour) => ({ spring: 1.15, summer: 1, autumn: 0.9, winter: 0.75 }[Weather.season(state, hour).key] ?? 1);
export function timeOfDay(hour, kind = "hunt") {
  const h = ((hour % 24) + 24) % 24;
  if (kind === "spear") return (h >= 5 && h <= 7) || (h >= 17 && h <= 19) ? 1 : h >= 20 || h <= 4 ? 0.15 : 1.2; // by sight
  if ((h >= 5 && h <= 7) || (h >= 17 && h <= 19)) return kind === "fish" ? 1.4 : 1.3;
  if (h >= 20 || h <= 4) return kind === "fish" ? 0.5 : 0.35;
  return 1;
}
const weatherMult = (state, hour, tile) => (Weather.weather(state, hour, tile).severe ? 0.5 : 1); // a storm over that tile (weather.js)
export const frozenAt = (state, hour = state.hour) => !!Weather.weather(state, hour).frozen;

// ---------- people and gear ----------
// Everything a person has on them: worn and held, pockets, and what is in the pack.
export const carriedItems = (s) => allCarried(s); // inventory.js: worn and held, pockets, rig pouches, the pack
export function huntWeaponInfo(item) {
  const d = item && GEAR[item.key];
  if (!d || d.slot !== "weapon") return null;
  let h = d.hunt || HUNT_CAT[d.cat];
  if (!h) return null;
  // Bows by their draw: a scrap crossbow 0.8 for deer, a compound bow 0.86, a hunting crossbow 0.9.
  if (!d.hunt && d.cat === "bow") h = { big: Math.min(0.95, 0.6 + 0.08 * (d.power || 2.5)), small: 0.9 };
  const noise = d.noise || 0;
  // Bows and crossbows hunt with arrows (bolts): a shot at game is often lost (ARROW).
  const bow = d.cat === "bow" || d.cat === "crossbow";
  // quiet: × the shot's noise from the gun's attachments (gunmods.js: a suppressor 0.35–0.5, a brake 1.3): the hunt's
  // Heat, the base's hunting noise and the chance the wandering dead turn toward the shots all scale with it.
  const quiet = noise >= 1 ? gunMods(item).noise : 1;
  const scoped = !d.hunt && noise >= 1 && scopedForHunt(item); // SCOPE_HUNT (an override has its scope in it)
  // A gun that comes with its scope (data-guns.js FACTORY_FIT: the hunting rifle, user pick 2026-10-10) has it in its
  // numbers: with a scope as it came, without one ÷ SCOPE_HUNT.
  const ownScope = !d.hunt && noise >= 1 && (FACTORY_FIT[item.key] || []).some(([p, keys]) => p >= 1 && keys.some((k) => isScope(k)));
  if (ownScope && !scoped) h = { big: h.big / SCOPE_HUNT.big, small: h.small / SCOPE_HUNT.small };
  else if (scoped && !ownScope) h = { big: h.big * SCOPE_HUNT.big, small: h.small * SCOPE_HUNT.small };
  return { key: item.key, name: d.name, big: h.big, small: h.small, loud: noise >= 1, noise: noise * quiet, quiet, ammo: noise >= 1, arrows: bow && noise < 1, scoped };
}
export const hunterSkill = (s) => 0.5 * skill(s, "shooting") + 0.35 * skill(s, "scouting") + 0.15 * skill(s, "stealth");
export const hunterMult = (s) => (0.55 + 0.09 * hunterSkill(s)) * (hasPerk(s, "hunter") ? 1.25 : 1);
// A person's best hunting weapon (null: none they can use; firearms only with ammo to hand, bows with arrows).
// only: "bow" (bows and crossbows), "gun" (firearms) or null (any).
// ammo: a number (any rounds) or a stock record (ammo.js: a gun needs rounds of its own calibre; its loaded type, R9,
// sets how it does on big and small game while there are rounds of it).
// extra: more weapons to hand (a base's armory lends its hunters one: huntLoans).
export function bestHuntWeapon(s, ammo = Infinity, arrows = Infinity, only = null, extra = null) {
  let best = null;
  for (const it of extra ? [...carriedItems(s), ...[].concat(extra)] : carriedItems(s)) {
    let w = huntWeaponInfo(it);
    if (!w || (w.ammo && huntRounds(ammo, it) < 1) || (w.arrows && arrows < 1)) continue;
    if ((only === "bow" && !w.arrows) || (only === "gun" && !w.ammo)) continue;
    const eff = gearEffect(s, it);
    if (!eff.usable) continue;
    if (w.ammo) { const ld = huntLoad(it, ammo); if (ld.big !== 1 || ld.small !== 1) w = { ...w, big: w.big * ld.big, small: w.small * ld.small, load: ld.type }; }
    const v = (w.big + 0.3 * w.small) * eff.mult;
    if (!best || v > best.v) best = { item: it, w, eff: eff.mult, v };
  }
  return best;
}
// The hunting weapons lent to the base's hunters for the day (2026-10-12: a base's hunters went out with a pistol, or
// with nothing but snares, while a rifle lay in the armory or hung on the shoulder of someone farming; woodcutters take
// the armory's axes the same way): the armory's, and the weapon in hand of anyone living here who is neither hunting
// nor on guard. The best one to the hunter it helps most, one each, only where it beats their own (ammo and arrows
// aside: the day's plan checks those). Nothing changes hands in the stores. hunters: who hunts (default: those on the
// Hunt job here). Map of survivor id → item.
export function huntLoans(state, base, hunters = null) {
  const out = new Map();
  const here = atBase(state, base.id);
  const who = hunters || here.filter((x) => x.role === "hunt");
  if (!who.length) return out;
  const ids = new Set(who.map((x) => x.id));
  const list = [...(base.armory || []), ...here.filter((x) => !ids.has(x.id) && x.role !== "guard" && x.gear && x.gear.weapon).map((x) => x.gear.weapon)].filter((it) => huntWeaponInfo(it));
  if (!list.length) return out;
  const val = (s, it) => { const w = huntWeaponInfo(it), e = gearEffect(s, it); return e.usable ? (w.big + 0.3 * w.small) * e.mult : 0; };
  const own = (s) => { const b = bestHuntWeapon(s); return b ? b.v : 0; };
  const left = [...list];
  for (const s of [...who].sort((a, b) => own(a) - own(b) || hunterMult(b) - hunterMult(a) || a.id - b.id)) {
    let best = null, bv = own(s);
    for (const it of left) { const v = val(s, it); if (v > bv + 1e-9) { best = it; bv = v; } }
    if (best) { out.set(s.id, best); left.splice(left.indexOf(best), 1); }
  }
  return out;
}
// Does anyone here carry a bow or crossbow they can use (arrows aside)?
export const hasBow = (people) => people.some((s) => !!bestHuntWeapon(s, 0, Infinity, "bow"));

// ---------- the hunting mix (base.huntMix) ----------
const tens = (v) => Math.max(0, Math.min(100, Math.round((Number(v) || 0) / 10) * 10));
// A mix made whole: whole tens, adding up to 100 (what is missing or over goes to / comes off the loudest method kept).
export function normalMix(m) {
  const out = { traps: tens(m && m.traps), bows: tens(m && m.bows), guns: tens(m && m.guns) };
  let sum = out.traps + out.bows + out.guns;
  if (sum <= 0) return { ...DEFAULT_MIX };
  if (sum !== 100) {
    // Scale to 100, then put the rounding on the largest share.
    for (const k of HUNT_METHODS) out[k] = tens((out[k] * 100) / sum);
    sum = out.traps + out.bows + out.guns;
    const big = [...HUNT_METHODS].sort((a, b) => out[b] - out[a])[0];
    out[big] = Math.max(0, out[big] + 100 - sum);
  }
  return out;
}
// A base's hunting mix (DEFAULT_MIX until it is set). No base (a team with no home): the default.
export const huntMixOf = (base) => (base && base.huntMix ? normalMix(base.huntMix) : { ...DEFAULT_MIX });
const mixText = (m) => HUNT_METHODS.filter((k) => m[k] > 0).map((k) => `${METHOD_NAMES[k].toLowerCase()} ${m[k]}%`).join(", ");
export const huntMixText = (base) => mixText(huntMixOf(base));
// Sets the whole mix (a preset, the governor). Returns a message.
export function setHuntMix(base, mix) {
  const m = normalMix(mix);
  base.huntMix = m;
  return `${base.name} hunts with ${mixText(m)}.`;
}
// Sets one method's share; the other two share the rest as they did (evenly when both were 0). Returns a message.
export function setHuntShare(base, key, value) {
  if (!HUNT_METHODS.includes(key)) return "";
  const cur = huntMixOf(base);
  const v = tens(value);
  const others = HUNT_METHODS.filter((k) => k !== key);
  const rest = 100 - v;
  const was = cur[others[0]] + cur[others[1]];
  const out = { [key]: v };
  // The louder of the other two gets the rounding (guns before bows before traps).
  const [a, b] = [...others].sort((x, y) => HUNT_METHODS.indexOf(y) - HUNT_METHODS.indexOf(x));
  out[b] = was > 0 ? tens((rest * cur[b]) / was) : tens(rest / 2);
  out[b] = Math.min(rest, out[b]);
  out[a] = rest - out[b];
  return setHuntMix(base, out);
}
export const mixShares = (m) => ({ traps: m.traps / 100, bows: m.bows / 100, guns: m.guns / 100 });
// The method of each hour of a hunt in turn: the one furthest behind its share goes next (guns, then bows, then traps
// on a tie). All guns: every hour guns.
export function methodSeq(shares, hours) {
  const done = { traps: 0, bows: 0, guns: 0 };
  const out = [];
  for (let i = 1; i <= hours; i++) {
    let best = null, gap = -Infinity;
    for (const k of ["guns", "bows", "traps"]) {
      if (!(shares[k] > 0)) continue;
      const g = shares[k] * i - done[k];
      if (g > gap + 1e-9) { gap = g; best = k; }
    }
    best = best || "guns";
    done[best]++;
    out.push(best);
  }
  return out;
}
export const methodAt = (shares, k) => methodSeq(shares, k + 1)[k];
// A trap hour's chance of a catch (small game) on a team's hunt: n people at it.
export function trapRate(state, tile, hour, level = gameLevel(state, tile, hour), n = 1) {
  const base = (snareDayRate(state, tile, hour, level) * CABIN.snareLines) / CABIN.hours;
  return Math.min(0.9, base * TRAP.field * (1 + TRAP.hand * Math.min(2, Math.max(0, n - 1))));
}
// The mix a team hunts by: its home base's.
export const partyHuntMix = (state, p) => huntMixOf(baseById(state, p.homeBaseId) || hub(state));

// The people who can hunt, best first: { s, w, item, big, small } (power for big and small game).
// only: "bow" for bows and crossbows only (bestHuntWeapon).
export function huntersOf(members, ammo = Infinity, arrows = Infinity, only = null) {
  const out = [];
  for (const s of members) {
    const b = bestHuntWeapon(s, ammo, arrows, only);
    if (!b) continue;
    const m = hunterMult(s) * b.eff;
    out.push({ s, w: b.w, item: b.item, big: m * b.w.big, small: m * b.w.small });
  }
  return out.sort((a, b) => b.big + 0.3 * b.small - (a.big + 0.3 * a.small) || a.s.id - b.s.id);
}
const W3 = [1, 0.5, 0.25];
export function teamPower(hs, others = 0) {
  if (!hs.length) return { big: 0, small: 0, n: 0 };
  let big = 0, small = 0;
  hs.slice(0, 3).forEach((h, i) => { big += W3[i] * h.big; small += W3[i] * h.small; });
  const beat = 0.08 * Math.min(2, Math.max(0, others));
  return { big: big + beat, small, n: hs.length };
}

// ---------- hunting odds ----------
// Chances this hour on this tile at this level (no randomness): big and small game, and the mix of big game.
export function huntOdds(state, team, tile, hour, level = gameLevel(state, tile, hour)) {
  const base = gameAbundance(state, tile) * level * seasonGame(state, hour) * timeOfDay(hour) * weatherMult(state, hour, tile);
  const t = state.tiles[tile];
  const deer = t && (t.terrain === "hills" || t.terrain === "mountain") ? 1 : 0.7;
  return { big: Math.min(0.6, HUNT.big * base * team.big), small: Math.min(0.9, HUNT.small * base * team.small), deer, base };
}
const bigAvg = (deer) => deer * ANIMALS.deer.rations + (1 - deer) * ANIMALS.hog.rations;

// Expected haul of a hunt (no randomness): rations, kills, shots, arrows lost, with the land depleting as it goes.
// team: teamPower, or a huntTeam's team with its mix (team.mix: each hour's method in turn, methodSeq); loud: share of
// kills by firearms (without a mix); room: kg the team can still carry (what does not fit is left: rations are capped
// by it, all = what was bagged).
// A team's power × a hunting blind's game (sim/fieldworks.js, tripland.js tileGameMult): more game on that tile.
const blindTeam = (T, bm) => (bm > 1 && T ? { ...T, big: T.big * bm, small: T.small * bm } : T);
export function expectHunt(state, team, tile, hours, startHour = state.hour, loud = 0, room = Infinity, owner = "player") {
  const bm = tileGameMult(state, null, tile, owner); // a blind of yours on the tile
  let level = gameLevel(state, tile, startHour), rations = 0, big = 0, small = 0, shots = 0, arrows = 0, trapped = 0;
  const mix = team && team.mix;
  const seq = mix ? methodSeq(mix.shares, hours) : null;
  const hrs = { traps: 0, bows: 0, guns: 0 };
  // With a limit on what fits, the haul is lumpy (a deer is 30): the chances of each load carried are followed hour by
  // hour (what does not fit is left), so the expectation is that of what is really kept.
  const R = Number.isFinite(room) ? Math.max(0, Math.floor(room / MEAT_KG + 1e-9)) : null;
  let dist = R != null ? Object.assign(new Array(R + 1).fill(0), { 0: 1 }) : null;
  for (let h = 1; h <= hours; h++) {
    const m = seq ? seq[h - 1] : "guns";
    hrs[m]++;
    let nb, ns, deer = 0.7, bigs, smalls, dep;
    if (mix && m === "traps") {
      // Snares and deadfalls: one small game at most an hour, silent.
      const p = Math.min(0.9, trapRate(state, tile, startHour + h, level, mix.methods.traps.n) * bm);
      nb = 0; ns = p; trapped += p;
      bigs = [[0, 1]];
      smalls = [[0, 1 - p], [ANIMALS.small.rations, p]];
      dep = (ns * ANIMALS.small.rations) / SNARE.deplete;
    } else {
      const T = mix ? mix.methods[m].team : team;
      const o = huntOdds(state, blindTeam(T, bm), tile, startHour + h, level);
      nb = o.big; ns = o.small * (1 + o.small / 3); deer = o.deer;
      // Shots by who makes the kills (a kill goes to one of the best three by their power for that game: huntHour).
      const fired = (k) => nb * (1 + HUNT.missChance) * T[`${k}Big`] + ns * (1 + HUNT.missSmall) * T[`${k}Small`];
      if (T.loudBig != null) { shots += fired("loud"); arrows += fired("bow") * ARROW.lost; }
      else shots += (nb * (1 + HUNT.missChance) + ns * (1 + HUNT.missSmall)) * loud; // a team made by hand: loud given
      bigs = [[0, 1 - o.big], [ANIMALS.deer.rations, o.big * o.deer], [ANIMALS.hog.rations, o.big * (1 - o.deer)]];
      smalls = [[0, 1 - o.small], [ANIMALS.small.rations, o.small * (1 - o.small / 3)], [2 * ANIMALS.small.rations, o.small * (o.small / 3)]];
      dep = (nb * bigAvg(o.deer)) / HUNT.bigDeplete + (ns * ANIMALS.small.rations) / HUNT.smallDeplete;
    }
    const r = nb * bigAvg(deer) + ns * ANIMALS.small.rations;
    rations += r; big += nb; small += ns;
    if (dist && R > 0) {
      const next = new Array(R + 1).fill(0);
      for (let k = 0; k <= R; k++) {
        if (!dist[k]) continue;
        for (const [b, pb] of bigs) for (const [sm, ps] of smalls) if (pb * ps > 0) next[Math.min(R, k + b + sm)] += dist[k] * pb * ps;
      }
      dist = next;
    }
    level = Math.max(0, level - dep);
  }
  // Infested animals (worm.js) give a quarter of the meat: the estimate counts the share of them here.
  const ym = huntYieldMult(state, tile);
  const kept = (R == null ? rations : R === 0 ? 0 : dist.reduce((a, q, k) => a + q * k, 0)) * ym;
  return { rations: r1(kept), all: r1(rations * ym), big: r1(big), small: r1(small), shots: r1(shots), arrows: r1(arrows), trapped: r1(trapped), hours: hrs, levelAfter: level, perHour: hours ? kept / hours : 0 };
}
// Shares of the top three hunters' kills by firearms (loud) and by bows (bow): overall (the team's loud), and for big
// and small game as huntHour deals the kills out (by each one's power for that game).
function shareOf(hs, test) {
  const tot = hs.slice(0, 3).reduce((a, h, i) => a + W3[i] * (h.big + h.small), 0) || 1;
  return hs.slice(0, 3).reduce((a, h, i) => a + (test(h.w) ? W3[i] * (h.big + h.small) : 0), 0) / tot;
}
function killShares(team, hs) {
  const top = hs.slice(0, 3);
  const part = (test, key) => { const tot = top.reduce((a, h) => a + h[key], 0); return tot > 0 ? top.reduce((a, h) => a + (test(h.w) ? h[key] : 0), 0) / tot : 0; };
  team.loudBig = part((w) => w.loud, "big"); team.loudSmall = part((w) => w.loud, "small");
  team.bowBig = part((w) => w.arrows, "big"); team.bowSmall = part((w) => w.arrows, "small");
  return team;
}
// For a team (or a crew about to go): its hunters, power, how loud it is and why it cannot hunt. ammo and arrows: what
// it carries; mix: its home base's hunting mix (null: every hour with the best weapon, as all guns). With a mix that is
// not all guns the team carries the methods (team.mix: shares after the fallbacks, and each method's power): bow hours
// with nobody able to shoot a bow become trap hours.
export function huntTeam(state, members, ammo, { arrows = Infinity, mix = null } = {}) {
  const hs = huntersOf(members, ammo, arrows);
  const team = killShares(teamPower(hs, members.length - hs.length), hs);
  const loud = shareOf(hs, (w) => w.loud);
  const why = hs.length ? "" : "nobody carries a hunting weapon (a rifle, shotgun or pistol with ammo, or a bow or crossbow with arrows). Set snares instead.";
  const out = { hs, team, loud, why, bowHs: [] };
  const sh = mix ? mixShares(normalMix(mix)) : null;
  if (!sh || why || sh.guns >= 1) return out;
  const bowHs = huntersOf(members, ammo, arrows, "bow");
  const shares = { guns: sh.guns, bows: bowHs.length ? sh.bows : 0, traps: sh.traps + (bowHs.length ? 0 : sh.bows) };
  const methods = {
    guns: { team, loud },
    bows: bowHs.length ? { team: killShares(teamPower(bowHs, members.length - bowHs.length), bowHs), loud: 0 } : null,
    traps: { n: members.length },
  };
  out.bowHs = bowHs;
  out.team = { ...team, mix: { shares, methods } };
  out.shares = shares;
  return out;
}
// The tile panel's line: what the land holds and what a hunt would bring (a party, or a planner crew). mix: the hunting
// mix the team follows (its home base's).
export function huntInfo(state, tile, { members = null, ammo = Infinity, arrows = Infinity, mix = null, hours = HUNT.defHours, startHour = state.hour, room = Infinity } = {}) {
  const abundance = gameAbundance(state, tile);
  const level = gameLevel(state, tile);
  const word = gameWord(abundance * level);
  const out = { abundance, level, word, fishSpot: fishSpot(state, tile), fishLevel: fishLevel(state, tile) };
  if (members) {
    const t = huntTeam(state, members, ammo, { arrows, mix });
    out.why = t.why;
    out.est = t.why ? null : expectHunt(state, t.team, tile, hours, startHour, t.loud, room);
    out.loud = t.loud;
    out.hunters = t.hs.length;
  }
  return out;
}
// A team's huntTeam: what it carries and its home base's mix.
export const partyHuntTeam = (state, p, members = partyMembers(state, p)) => huntTeam(state, members, sumRecs(p.supplies, p.cargo && p.cargo.supplies), { arrows: carried(p, "arrows"), mix: partyHuntMix(state, p) });

// Why a team cannot hunt here ("" = it can).
export function huntProblem(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return "not on open water.";
  const h = partyHuntTeam(state, p);
  if (h.why) return h.why;
  if (gameAbundance(state, tile) < 0.02) return "there is no game here (a city, or the dead own this land).";
  return "";
}

// ---------- fresh game in the cargo ----------
// Game is raw meat by the animal (foods.js: a deer is venison, a wild hog boar, small game rabbit or fowl, fish raw
// fish), in days of food (rations) here and as items in the stocks: it weighs what the item weighs (a kilo of meat a
// kilo) and spoils by its own shelf (2–3 days, a day and a half for fish) like any food, faster in the heat.
const isGame = (k, f) => f.group === "rawmeat" || f.group === "rawfish";
// The item a kill is (small game: rabbit and squirrel or a bird, by the food dice).
export function gameItem(state, kind) {
  const a = ANIMALS[kind] || ANIMALS.small;
  if (kind === "small" || !a.item) return foodRng(state).chance(0.5) ? "f_smallgame" : "f_fowl";
  return a.item;
}
// Days of raw game in a team's cargo, at a base.
export const meatIn = (cargo) => (cargo && cargo.supplies ? foodUnits(cargo, isGame) : 0);
export const meatAt = (base) => (base ? foodUnits(base, isGame) : 0);
// Puts fresh game in a team's cargo, as much as fits. worm: how much of it carries the worm's eggs (worm.js: an
// egg lot). kind: the animal (ANIMALS). Returns the rations kept.
export function addMeat(state, p, rations, worm = 0, kind = "small") {
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  const item = gameItem(state, kind);
  const f = FOODS[item];
  const kgPerRation = f.kg / unitsOf(item, 1);
  const fit = Math.max(0, cargoRoom(state, p) + 1e-9) / kgPerRation;
  const kept = Math.max(0, Math.min(rations, Math.floor(fit * 10) / 10));
  if (kept <= 0) return 0;
  const w = rations > 0 ? kept * Math.min(1, Math.max(0, worm) / rations) : 0;
  if (kept - w > 1e-9) addFood(p.cargo, item, qtyOf(item, kept - w), { state });
  if (w > 1e-9) addFood(p.cargo, item, qtyOf(item, w), { state, egg: true });
  return kept;
}
// Takes `qty` days of fresh game out of a cargo (dropped: the soonest to spoil first). clean: eaten, only the meat
// without eggs (worm.js: that is eaten last, raw). Returns the days taken.
export function takeMeat(cargo, qty, { clean = false } = {}) {
  if (!cargo || !(qty > 0)) return 0;
  return takeFood(cargo, qty, { only: isGame, eggs: !clean }).units;
}
// A day's spoiling of carried food in the field at a mean temperature (the screens: × the shelf, foods.js).
export function fieldSpoilRate(temp) {
  return temp > 24 ? 0.35 : temp > 12 ? 0.22 : temp > 4 ? 0.12 : temp > -1 ? 0.06 : 0.02;
}
// Carried food (a team's packs and cargo): shelf used an hour × this (foods.js lots), by the hour's temperature: a
// pack in the sun is warm, a frozen one keeps.
export const CARRIED = { base: 1.2, hot: 1.6, cold: 0.6, frozen: 0.15 };
export const carriedFactor = (temp) => (temp > 24 ? CARRIED.hot : temp < -1 ? CARRIED.frozen : temp < 5 ? CARRIED.cold : CARRIED.base);
// Hourly for a team (parties.js): everything it carries ages by the hour's temperature; what spoils is thrown out.
// p.gameSpoiled adds up the days of food lost (the trip's summary).
export function gameSpoilHour(state, p) {
  const temp = Weather.weather(state).temp;
  const fac = carriedFactor(temp);
  let lost = 0;
  const items = {};
  for (const h of [p, p.cargo]) {
    if (!h || !(h.supplies || h.stock)) continue;
    const got = ageLots(h, 1 / 24, () => fac, state);
    for (const [k, q] of Object.entries(got)) { items[k] = (items[k] || 0) + q; lost += unitsOf(k, q); }
  }
  if (lost > 0) {
    p.gameSpoiled = (p.gameSpoiled || 0) + lost;
    if (p.owner === "player" && Object.values(items).some((q) => q >= 0.5)) log(state, `${teamName(state, p)} threw out food that had gone bad: ${foodText(items)}.`, "info");
  }
  return lost;
}
// A team unloading at a base (parties.js): its food goes into the base's stores with its lots (shelf left, eggs).
export function unloadGame(base, cargo, state = null) {
  if (cargo && cargo.supplies) moveFood(cargo, base, null, { state });
}

// ---------- one hour of hunting (orders.js taskHour) ----------
// Wandering hordes within reach turn toward gunshots.
// quiet: × the chance (a suppressed gun draws fewer; gunmods.js). The same dice either way.
export function drawHordes(state, tile, quiet = 1) { // exported for tools/gunmodtest.js
  let n = 0;
  for (const h of state.hordes) {
    if (!["roam", "border", undefined, null].includes(h.role)) continue;
    if (state.grid.distance(h.tile, tile) > HUNT.drawRange || h.tile === tile) continue;
    if (state.rng.chance(HUNT.drawChance * quiet)) { h.target = tile; h.path = null; n++; }
  }
  return n;
}
function bagged(got, key) { got[key] = (got[key] || 0) + 1; }
export function huntHour(state, p) {
  const t = p.task;
  const tile = partyTile(p);
  const got = t.got || (t.got = { rations: 0, left: 0, shots: 0, drawn: 0 });
  const members = partyMembers(state, p);
  const h = partyHuntTeam(state, p, members);
  if (h.why) { got.stopped = h.why; return false; }
  // The hour's method by the home base's mix (all guns: the best weapon every hour).
  const mix = h.team.mix;
  const m = mix ? methodAt(mix.shares, Math.max(0, (t.done || 1) - 1)) : "guns";
  const bm = tileGameMult(state, null, tile, p.owner); // a hunting blind of the team's owner there (sim/fieldworks.js)
  if (bm > 1) got.blind = bm;
  got.hrs = got.hrs || { traps: 0, bows: 0, guns: 0 };
  got.hrs[m]++;
  if (m === "traps") {
    // Snares and deadfalls worked this hour: small game now and then, not a sound.
    if (state.rng.chance(Math.min(0.9, trapRate(state, tile, state.hour, gameLevel(state, tile), members.length) * bm))) {
      const wk = wormKill(state, tile, ANIMALS.small.rations);
      const kept = addMeat(state, p, wk.rations, wk.worm, "small");
      bagged(got, "small");
      got.trapped = (got.trapped || 0) + 1;
      if (wk.infested) got.infested = (got.infested || 0) + 1;
      got.rations += kept;
      got.left += wk.rations - kept;
      takeGame(state, tile, ANIMALS.small.rations, SNARE.deplete);
    }
    for (const x of members) gainXp(state, x, "scouting", 0.5);
    return true;
  }
  const team = m === "bows" ? mix.methods.bows.team : h.team;
  const hs = m === "bows" ? h.bowHs : h.hs;
  const o = huntOdds(state, blindTeam(team, bm), tile, state.hour);
  const kills = [];
  if (state.rng.chance(o.big)) kills.push(state.rng.chance(o.deer) ? "deer" : "hog");
  if (state.rng.chance(o.small)) { kills.push("small"); if (state.rng.chance(o.small / 3)) kills.push("small"); }
  for (const k of kills) {
    const a = ANIMALS[k];
    const who = state.rng.weighted(hs.slice(0, 3), (x) => (a.big ? x.big : x.small) + 1e-6);
    if (who.w.ammo) {
      const shots = 1 + (state.rng.chance(a.big ? HUNT.missChance : HUNT.missSmall) ? 1 : 0);
      const used = takeHuntShots([p.cargo && p.cargo.supplies, p.supplies], who.item, shots); // ammo.js: the gun's own calibre, its load first
      got.shots += Math.max(1, used);
      p.heat = Math.min(100, (p.heat || 0) + HUNT.shotHeat * (who.w.noise / 3) * Math.max(1, used));
      got.drawn += drawHordes(state, tile, who.w.quiet ?? 1);
      if (who.item && wearMuzzle(who.item, Math.max(1, used))) got.wornMod = who.item.name; // an oil filter shot out (gunmods.js)
    } else if (who.w.arrows) {
      // A bow: silent, but a shot at game is often an arrow lost in the brush or broken in the animal.
      const shots = 1 + (state.rng.chance(a.big ? HUNT.missChance : HUNT.missSmall) ? 1 : 0);
      let lost = 0;
      for (let i = 0; i < shots; i++) if (state.rng.chance(ARROW.lost)) lost++;
      got.arrowShots = (got.arrowShots || 0) + shots;
      got.arrows = (got.arrows || 0) + takeSupply(p, "arrows", lost);
    }
    const wk = wormKill(state, tile, a.rations); // worm.js: an infested animal yields a quarter, all of it with eggs
    const kept = addMeat(state, p, wk.rations, wk.worm, k);
    bagged(got, k);
    if (wk.infested) got.infested = (got.infested || 0) + 1;
    got.rations += kept;
    got.left += wk.rations - kept;
    takeGame(state, tile, a.rations, a.big ? HUNT.bigDeplete : HUNT.smallDeplete);
    gainXp(state, who.s, "shooting", a.big ? 6 : 2);
  }
  for (const m of members) gainXp(state, m, "scouting", 0.5);
  return true;
}
// What the worm left in a haul (worm.js): infested animals, or game from infected land that needs cooking through.
function wormNote(state, tile, infested = 0) {
  if (infested) return ` ${infested === 1 ? "One was" : `${infested} were`} infested, grey and thin under the hide: a quarter of the meat, and it carries the worm's eggs. Cook it through before anyone eats it.`;
  if (((state.tiles[tile] || {}).infection || 0) >= WORM.MEAT_AT) return " The land here is infected: cook the meat through before anyone eats it.";
  return "";
}
const countText = (got, keys = ["deer", "hog", "small", "fish"]) => keys.filter((k) => got[k]).map((k) => `${got[k] === 1 && k !== "small" && k !== "fish" ? `a ${ANIMALS[k].name}` : `${got[k]} ${ANIMALS[k].plural}`}`).join(", ");
export function huntSummary(state, p, t) {
  const got = t.got || { rations: 0 };
  const what = countText(got);
  const heat = got.shots ? ` ${got.shots} shot${got.shots === 1 ? "" : "s"} fired (Heat ${Math.round(p.heat || 0)})${got.drawn ? `: the dead nearby heard it` : ""}.` : got.rations ? " Not a shot fired." : "";
  // The home base's hunting mix: how the hours went, the traps' catch and the arrows lost.
  const hrs = got.hrs || {};
  const how = (hrs.traps || 0) + (hrs.bows || 0) > 0 ? ` By the hunting mix: ${HUNT_METHODS.filter((k) => hrs[k]).map((k) => `${METHOD_NAMES[k].toLowerCase()} ${hrs[k]}h`).join(", ")}${got.trapped ? ` (the traps took ${got.trapped} small game)` : ""}.` : "";
  const arrows = got.arrowShots ? ` ${got.arrowShots} arrow${got.arrowShots === 1 ? "" : "s"} loosed, ${got.arrows || 0} lost.` : "";
  const left = (got.left >= 1 ? ` No room to carry ${Math.floor(got.left)} more: left where it fell.` : "") + how + arrows;
  const stop = (got.stopped ? ` Stopped: ${got.stopped}` : "") + (got.blind ? " Hunted from your blind here (more game)." : "");
  const level = gameWord(gameAbundance(state, partyTile(p)) * gameLevel(state, partyTile(p)));
  p.lastHaul = { kind: "hunt", rations: got.rations, hour: state.hour }; // for the trip report (and tests)
  const worm = wormNote(state, partyTile(p), got.infested);
  const text = got.rations > 0
    ? `Hunted ${t.done}h: ${what} (${Math.floor(got.rations)} days of food in raw meat, it spoils in days: eat it, cook it, or dry or smoke it at home).${worm}${heat}${left} Game left here: ${level}.${stop}`
    : `Hunted ${t.done}h and found nothing worth a shot.${heat} Game left here: ${level}.${stop}`;
  if (got.rations > 0) log(state, `${teamName(state, p)} hunted near ${tileLabel(state, partyTile(p))}: ${what}, ${Math.floor(got.rations)} days of food in raw meat.`, "good");
  return text;
}

// ---------- fishing ----------
// Where a team can fish: a land tile on the water. Rivers are water tiles (mapgen.js); a bridge is fished like the
// river under it. Kinds: a lake shore (open water that is not a river, 6+ water tiles within 2) and a deep river bend
// (rivers meeting or winding: 6+ water tiles within 2) × 1, a river × 0.85, a small lake or pond × 0.6.
export function fishSpot(state, tile) {
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge)) return null;
  const wet = state.grid.neighbors(tile).map((n) => state.tiles[n]).filter((x) => x && x.terrain === "water");
  if (t.bridge) wet.push(t);
  if (!wet.length) return null;
  const water = state.grid.within(tile, 2).filter((id) => state.tiles[id].terrain === "water").length;
  const river = wet.some((x) => x.river);
  if (river) return water >= 6 ? { kind: "bend", mult: 1, name: "a deep river bend" } : { kind: "river", mult: 0.85, name: "a river" };
  return water >= 6 ? { kind: "lake", mult: 1, name: "a lake shore" } : { kind: "pond", mult: 0.6, name: "a pond" };
}
const isRod = (it) => it && (it.key === "fishrod" || (GEAR[it.key] && GEAR[it.key].fish === "rod"));
const isNet = (it) => it && (it.key === "fishnet" || (GEAR[it.key] && GEAR[it.key].fish === "net"));
export const isSpear = (it) => !!(it && GEAR[it.key] && GEAR[it.key].fish === "spear");
export const isFishTool = (it) => isRod(it) || isNet(it) || isSpear(it);
// A tool's catch by its condition: a well-made (or well-kept) rod catches more (crafting.js: quality from the crafter).
const qualityYield = (it) => 0.6 + 0.4 * Math.max(0, Math.min(1, it.quality ?? 1));
export const fishToolPower = (it) => (GEAR[it.key].fishPower ?? FISH.rod) * qualityYield(it);
const isIceTool = (it) => it && (ICE_TOOL.test(it.key) || !!(GEAR[it.key] && GEAR[it.key].iceTool));
export const fisherMult = (s) => (0.6 + 0.08 * (0.6 * skill(s, "scouting") + 0.4 * skill(s, "stealth"))) * (hasPerk(s, "forager") ? 1.1 : 1);
// What a team (members and cargo items) has for fishing: rods, nets, spears, an ice tool, and its rigs' power.
// power = all of it (spear = the spears' part: by sight, not through ice); tools = the items in use (they wear).
// frozen: the water is iced over, so spears are left out and the rods and nets go first.
export function fishKit(members, extraItems = [], { frozen = false } = {}) {
  const items = [...members.flatMap((s) => carriedItems(s)), ...extraItems];
  const nets = items.filter(isNet).sort((a, b) => (b.quality ?? 1) - (a.quality ?? 1));
  const singles = items.filter((it) => isRod(it) || (!frozen && isSpear(it))).sort((a, b) => fishToolPower(b) - fishToolPower(a));
  const ice = items.some(isIceTool);
  const best = [...members].sort((a, b) => fisherMult(b) - fisherMult(a) || a.id - b.id);
  let people = members.length, power = 0, spear = 0, used = 0;
  const tools = [];
  for (const it of nets) { if (people <= 0) break; const two = people >= 2; power += (two ? FISH.net : FISH.netAlone) * qualityYield(it); people -= two ? 2 : 1; used += two ? 2 : 1; tools.push(it); }
  for (const it of singles) { if (people <= 0) break; if (isSpear(it)) spear += fishToolPower(it); else power += fishToolPower(it); people--; used++; tools.push(it); }
  const sk = used ? best.slice(0, used).reduce((a, s) => a + fisherMult(s), 0) / used : 0;
  return { rods: items.filter(isRod).length, nets: nets.length, spears: items.filter(isSpear).length, ice, power: (power + spear) * sk, spear: spear * sk, used, tools };
}
// Wears the fishing tools in use (fishKit tools) by a day of fishing; a spear only FISH.spearWear of the time.
function wearFishTools(state, kit, people, lists) {
  for (const it of kit.tools || []) if (!isSpear(it) || state.rng.chance(FISH.spearWear)) wearHeld(state, it, people, lists);
}
export function fishRate(state, kit, tile, hour, level = fishLevel(state, tile, hour)) {
  const spot = fishSpot(state, tile);
  if (!spot || !kit.power) return 0;
  const frozen = frozenAt(state, hour);
  const ice = frozen ? (kit.ice ? FISH.ice : 0) : 1;
  const spear = kit.spear || 0, line = kit.power - spear; // rods and nets; spears by sight, never through ice
  const rate = line * timeOfDay(hour, "fish") * ice + (frozen ? 0 : spear * timeOfDay(hour, "spear"));
  return rate * spot.mult * seasonFish(state, hour) * weatherMult(state, hour, tile) * level;
}
export function expectFish(state, kit, tile, hours, startHour = state.hour, room = Infinity) {
  let level = fishLevel(state, tile, startHour), rations = 0;
  for (let h = 1; h <= hours; h++) {
    const r = Math.min(3, fishRate(state, kit, tile, startHour + h, level));
    rations += r;
    level = Math.max(0, level - r / FISH.deplete);
  }
  const kept = Math.min(rations, Math.max(0, room) / MEAT_KG);
  return { rations: r1(kept), all: r1(rations), perHour: hours ? kept / hours : 0 };
}
export function fishProblem(state, p, tile = partyTile(p)) {
  const spot = fishSpot(state, tile);
  if (!spot) return "only on a river or a lake shore.";
  const kit = fishKit(partyMembers(state, p), (p.cargo && p.cargo.gear) || []);
  if (!kit.rods && !kit.nets && !kit.spears) return "needs a fishing rod, a net or a spear (rods and nets are found at cabins, campgrounds, lodges and hardware stores; a makeshift rod or a pipe spear can be made from scrap).";
  if (frozenAt(state) && !kit.rods && !kit.nets) return "the water is frozen: a spear is no use through the ice (ice fishing needs a rod or a net, and a tool to cut the hole).";
  if (frozenAt(state) && !kit.ice) return "the water is frozen: cutting a hole for ice fishing needs a crowbar, machete, hatchet or axe.";
  return "";
}
export function fishHour(state, p) {
  const t = p.task;
  const tile = partyTile(p);
  const got = t.got || (t.got = { rations: 0, left: 0, fish: 0 });
  const members = partyMembers(state, p);
  const cargo = (p.cargo && p.cargo.gear) || [];
  const kit = fishKit(members, cargo, { frozen: frozenAt(state) });
  const rate = Math.min(3, fishRate(state, kit, tile, state.hour));
  if (!(rate > 0)) { if (!kit.power) got.stopped = "no fishing gear left."; return false; }
  got.hours = (got.hours || 0) + 1;
  if (got.hours % FISH.wearHours === 0) wearFishTools(state, kit, members, [cargo]); // a day's fishing on the tools
  let n = 0;
  for (let i = 0; i < 3; i++) if (state.rng.chance(rate / 3)) n++;
  if (n) {
    const kept = addMeat(state, p, n, wormKill(state, tile, n, { fish: true }).worm, "fish"); // worm.js: fish from infected water carry eggs
    got.fish += n;
    got.rations += kept;
    got.left += n - kept;
    lower(state, "fish", tile, n / FISH.deplete);
  }
  for (const m of members.slice(0, Math.max(1, kit.used))) gainXp(state, m, "scouting", 0.6);
  return true;
}
export function fishSummary(state, p, t) {
  const got = t.got || { rations: 0, fish: 0 };
  const spot = fishSpot(state, partyTile(p));
  const ice = frozenAt(state) ? " through the ice" : "";
  const left = got.left >= 1 ? ` No room for ${Math.floor(got.left)} more.` : "";
  const word = gameWord(fishLevel(state, partyTile(p)));
  p.lastHaul = { kind: "fish", rations: got.rations, hour: state.hour };
  // The trip's catch so far (parties.js returnHome: what was caught against what reached the stores).
  const c = p.caught || (p.caught = { fish: 0, fished: 0 });
  c.fish = Math.round((c.fish + Math.max(0, got.rations || 0)) * 100) / 100;
  c.fished++;
  if (got.rations > 0) log(state, `${teamName(state, p)} fished ${spot ? spot.name : "the water"} near ${tileLabel(state, partyTile(p))}${ice}: ${r1(got.rations)} days of food in raw fish.`, "good");
  else log(state, `${teamName(state, p)} fished ${spot ? spot.name : "the water"} near ${tileLabel(state, partyTile(p))}${ice} for ${t.done}h and caught nothing.`, "info");
  return got.rations > 0
    ? `Fished ${t.done}h${ice}: ${Math.floor(got.rations)} days of food in raw fish (it spoils in a day or two).${wormNote(state, partyTile(p))}${left} Fish left here: ${word}.${got.stopped ? ` Stopped: ${got.stopped}` : ""}`
    : `Fished ${t.done}h${ice} and caught nothing worth keeping. Fish left here: ${word}.${got.stopped ? ` Stopped: ${got.stopped}` : ""}`;
}

// ---------- snares ----------
export const snareLine = (state, tile) => (state.snares || []).find((l) => l.tile === tile) || null;
const findWire = (members, cargo) => {
  for (const s of members) {
    const pk = packOf(s);
    const pi = s.pockets ? s.pockets.findIndex((it) => it && it.key === "snarewire") : -1;
    if (pi >= 0) return { take: () => { const it = s.pockets[pi]; s.pockets[pi] = null; return it; } };
    const ci = pk ? pk.findIndex((it) => it && it.key === "snarewire") : -1; // packOf: the pack's slots
    if (ci >= 0) return { take: () => { const it = pk[ci]; pk[ci] = null; return it; } };
  }
  const gi = cargo && cargo.gear ? cargo.gear.findIndex((it) => it && it.key === "snarewire") : -1;
  if (gi >= 0) return { take: () => cargo.gear.splice(gi, 1)[0] };
  return null;
};
export const snareMode = (state, tile, mode = null) => mode || (snareLine(state, tile) ? "check" : "set");
export const snareHours = (state, tile, mode = null) => (snareMode(state, tile, mode) === "set" ? SNARE.setHours : SNARE.checkHours);
export function snareProblem(state, p, tile = partyTile(p), mode = null) {
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return "not on open water.";
  const m = snareMode(state, tile, mode);
  if (m !== "set") return snareLine(state, tile) ? "" : "no snare line of yours here.";
  if (snareLine(state, tile)) return "a line is already set here: check it instead.";
  if (gameAbundance(state, tile) < 0.02) return "nothing to catch here.";
  if (!findWire(partyMembers(state, p), p.cargo) && carried(p, "scrap") < SNARE.scrap) return `needs snare wire or ${SNARE.scrap} scrap (fence wire).`;
  return "";
}
// How long caught game keeps in a snare (days), by the temperature.
const keepDays = (temp) => (temp > 22 ? 2 : temp < 3 ? 6 : 3);
const theftChance = (state, tile) => {
  const near = state.grid.within(tile, 2).map((id) => state.tiles[id]);
  const town = near.some((t) => t.terrain === "city" || t.terrain === "suburb") ? 0.08 : 0;
  const hive = state.hives && zombieToughness(state, tile) ? 0.1 : 0;
  const horde = state.hordes.some((h) => state.grid.distance(h.tile, tile) <= 3) ? 0.08 : 0;
  return SNARE.theft + town + hive + horde;
};
export const snareDayRate = (state, tile, hour, level = gameLevel(state, tile, hour)) => SNARE.perDay * gameAbundance(state, tile) * level * seasonGame(state, hour);
// Expected catch of a line from its last check until `hour` (no theft or rot: an upper guide).
export function expectSnare(state, tile, from, to) {
  let level = gameLevel(state, tile, from), n = 0;
  for (let d = 0; d < (to - from) / 24; d++) {
    const frac = Math.min(1, (to - from) / 24 - d);
    const c = snareDayRate(state, tile, from + d * 24, level) * frac;
    n += c;
    level = Math.max(0, level - (c * ANIMALS.small.rations) / SNARE.deplete);
  }
  return { animals: r1(n), rations: r1(n * ANIMALS.small.rations) };
}
// What a line holds now: rolled day by day since its last check (catches, rot, theft). Changes the line.
function rollSnares(state, line) {
  const start = line.check ?? line.set;
  const days = Math.max(0, (state.hour - start) / 24);
  let held = [], robbed = 0, rotted = 0, gone = false;
  for (let d = 0; d < Math.ceil(days - 1e-9); d++) {
    const frac = Math.min(1, days - d);
    const hour = start + d * 24;
    const per = Math.min(0.9, snareDayRate(state, line.tile, hour) / SNARE.count) * frac;
    let n = 0;
    for (let i = 0; i < SNARE.count; i++) if (state.rng.chance(per)) n++;
    for (let i = 0; i < n; i++) held.push(d);
    if (n) takeGame(state, line.tile, n * ANIMALS.small.rations, SNARE.deplete);
    const keep = keepDays(Weather.weather(state, hour + 12).temp);
    const fresh = held.filter((x) => d - x < keep);
    rotted += held.length - fresh.length;
    held = fresh;
    if (d >= SNARE.safeDays && state.rng.chance(theftChance(state, line.tile))) {
      robbed += held.length;
      held = [];
      if (state.rng.chance(SNARE.wireLoss)) { gone = true; break; }
    }
  }
  return { animals: held.length, robbed, rotted, gone, days };
}
// The snare order's work, when its hours are done (orders.js finishTask). mode: set, check or lift.
export function snareWork(state, p, mode) {
  const tile = partyTile(p);
  const members = partyMembers(state, p);
  const where = tileLabel(state, tile);
  if (mode === "set") {
    const why = snareProblem(state, p, tile, "set");
    if (why) return `Snares: ${why}`;
    const wire = findWire(members, p.cargo);
    const item = wire ? wire.take() : null;
    if (!item) takeSupply(p, "scrap", SNARE.scrap);
    state.snares = state.snares || [];
    state.snares.push({ id: newId(), tile, set: state.hour, check: null, wire: item || null, by: members.map((s) => s.id) });
    const e = expectSnare(state, tile, state.hour, state.hour + 72);
    log(state, `${teamName(state, p)} set a line of snares near ${where}.`, "info");
    return `Set a line of ${SNARE.count} snares near ${where} (${item ? "with the snare wire" : `${SNARE.scrap} scrap of fence wire`}). Expect about ${e.animals} small game in 3 days; check them within 2–3 days, before the catch rots or someone else takes it.`;
  }
  const line = snareLine(state, tile);
  if (!line) return "Snares: no line of yours here.";
  const r = rollSnares(state, line);
  line.check = state.hour;
  // Each animal may be infested (worm.js): a quarter of the meat, with the worm's eggs.
  let rations = 0, worm = 0, infested = 0;
  for (let i = 0; i < r.animals; i++) {
    const wk = wormKill(state, tile, ANIMALS.small.rations);
    rations += wk.rations;
    worm += wk.worm;
    if (wk.infested) infested++;
  }
  const kept = addMeat(state, p, rations, worm, "small");
  for (const m of members) gainXp(state, m, "scouting", 1);
  let text = r.animals ? `The snares held ${r.animals} small game (${Math.round(kept * 10) / 10} days of food in raw meat${kept < rations - 0.05 ? `; no room for ${Math.round((rations - kept) * 10) / 10}` : ""}).${wormNote(state, tile, infested)}` : "The snares were empty.";
  if (r.rotted) text += ` ${r.rotted} caught earlier had gone bad.`;
  if (r.robbed) text += ` Something got to the line first: ${r.robbed} taken.`;
  const lift = mode === "lift" || r.gone;
  if (lift) {
    state.snares.splice(state.snares.indexOf(line), 1);
    if (r.gone) text += " The line itself was torn up and the wire is gone.";
    else if (line.wire) {
      p.cargo = p.cargo || { supplies: {}, gear: [] };
      p.cargo.gear.push(line.wire);
      text += " Lifted the line: the snare wire is back in the cargo.";
    } else text += " Lifted the line.";
  } else text += " The line stays set.";
  if (r.animals || r.robbed) log(state, `${teamName(state, p)} checked the snares near ${where}: ${r.animals} small game${r.robbed ? `, ${r.robbed} stolen` : ""}.`, r.animals ? "good" : "info");
  return text;
}
// Lines nobody comes back for: after 30 days unchecked a line is gone (torn up, rusted, sprung for good).
export function snaresDaily(state) {
  if (!state.snares || !state.snares.length) return;
  state.snares = state.snares.filter((l) => state.hour - (l.check ?? l.set) < 30 * 24);
}

// ---------- the hunting cabin and the base's hunters and fishers ----------
// The game land within a hunting cabin's reach (CABIN.radius): whether a cabin can be built here and is worth it.
export const gameLand = (state, base) => state.grid.within(base.tile, CABIN.radius).reduce((a, id) => a + gameAbundance(state, id), 0);
export function cabinProblem(state, base) {
  if (gameLand(state, base) < CABIN.land) return "too little game land around it (it needs forest, hills or farmland within 2 tiles).";
  return "";
}
// The base's hunting grounds (user rule 2026-10-10: any base, outpost or camp hunts and snares without a cabin): its
// own tile and the tiles next to it (HUNT_GROUND.bare); a Hunting cabin widens them to CABIN.radius (2) and keeps its
// smoke house and slower spoiling. Only the base's land (tripland.js workLand: no other group's ground); the hunters
// walk to the tile they pick (jobtrips.js), so the far ground costs hours. Game shies from the walls (gameAbundance:
// the base's own tile × 0.3, the tiles next to it × 0.6), so a base without a cabin brings in less.
export const HUNT_GROUND = { bare: 1, full: 19 }; // bare: the radius without a cabin; full: the tiles within 2 (CABIN.land is for those)
export const huntRadius = (base) => (count(base, "huntcabin") > 0 ? CABIN.radius : HUNT_GROUND.bare);
export const huntGrounds = (state, base) => workLand(state, base.tile).filter((id) => state.grid.distance(base.tile, id) <= huntRadius(base));
const baseHasHunting = (base) => count(base, "huntcabin") > 0; // the cabin: its smoke house, slower spoiling, the wider grounds
// Why nobody here can hunt as work ("" = they can). Used by work.js: the grounds hold too little game (CABIN.land for
// the full 19 tiles of a cabin's reach, its share for fewer).
export function huntWorkWhy(state, base) {
  const g = huntGrounds(state, base);
  const land = g.reduce((a, id) => a + gameAbundance(state, id), 0);
  if (land < CABIN.land * (g.length / HUNT_GROUND.full) || !huntTripTile(state, base)) return count(base, "huntcabin") > 0 ? "no game land around" : "no game land next to the base (a hunting cabin reaches 2 tiles out)";
  return "";
}
// What a Hunting cabin would add at this base (trips-plus #5: the governor and the base leaders value it by this, not by
// the game land within 2): the best hunting trip's day with the grounds widened to CABIN.radius against the tiles next
// to the base (huntTripTile: the game a tile holds now × its walk), as a ratio: 1 = nothing gained, 1.5 = half again as
// much meat a hunter; Infinity when the tiles next to the base cannot be hunted (too little game: huntWorkWhy) and the
// wider grounds can. 1 when the wider grounds hold nothing either.
export function cabinGain(state, base, hour = state.hour) {
  const v = (t) => (t ? t.v * t.f : 0);
  const far = v(huntTripTile(state, base, hour, CABIN.radius));
  if (!(far > 0)) return 1;
  const bare = workLand(state, base.tile).filter((id) => state.grid.distance(base.tile, id) <= HUNT_GROUND.bare);
  const land = bare.reduce((a, id) => a + gameAbundance(state, id), 0);
  const near = land < CABIN.land * (bare.length / HUNT_GROUND.full) ? 0 : v(huntTripTile(state, base, hour, HUNT_GROUND.bare));
  return near > 0 ? Math.max(1, far / near) : Infinity;
}
export const CABIN_GAIN = 1.3; // the governor builds one where it gives at least this (hunting.js cabinGain)
export function fishTools(state, base, people = atBase(state, base.id), opts = {}) {
  return fishKit(people, base.armory || [], opts);
}
export function fishWorkWhy(state, base) {
  if (!fishWater(state, base)) return NO_WATER; // a water tile of the base's own (tripland.js waterSources)
  const k = fishTools(state, base);
  if (!k.rods && !k.nets && !k.spears) return "no fishing rod, net or spear here";
  return "";
}
// The Fish job's tools: one rod or spear each, a net worked by two. No other cap (tune-jobcaps: it was at most 2).
export const fishWorkCap = (state, base) => { const k = fishTools(state, base); return k.rods + 2 * k.nets + k.spears; };
// The share each of n fishers at the base's one spot counts (the k-th max(fishCrowdFloor, 1 − fishCrowd × k)).
export const fishCrowdShare = (n) => {
  if (n <= 1) return 1;
  let a = 0;
  for (let k = 0; k < n; k++) a += Math.max(CABIN.fishCrowdFloor, 1 - CABIN.fishCrowd * k);
  return a / n;
};
// Expected food a day for one hunter at this base now (an average one with a hunting rifle, a compound bow for the
// mix's bow hours, the snare lines for its trap hours: the job's sizing), from the best tile around, CABIN.huntHours at
// dawn and dusk.
export function baseHuntDay(state, base, hour = state.hour) {
  const t = huntTripTile(state, base, hour);
  if (!t) return 0;
  const tile = t.id;
  const sh = mixShares(huntMixOf(base));
  const m = 0.82, rifle = { big: m * HUNT_CAT.rifle.big, small: m * HUNT_CAT.rifle.small }, bow = { big: m * 0.86, small: m * 0.9 };
  const dayStart = hour - (hour % 24);
  let r = 0;
  for (const hh of DAWN_DUSK.slice(0, CABIN.huntHours)) {
    const o = huntOdds(state, rifle, tile, dayStart + hh);
    r += sh.guns * (o.big * bigAvg(o.deer) + o.small * ANIMALS.small.rations);
    if (sh.bows > 0) { const b = huntOdds(state, bow, tile, dayStart + hh); r += sh.bows * (b.big * bigAvg(b.deer) + b.small * ANIMALS.small.rations); }
  }
  if (sh.traps > 0) r += sh.traps * snareDayRate(state, tile, dayStart + 12) * CABIN.snareLines * ANIMALS.small.rations;
  return r * t.f;
}
// Expected food a day for one fisher with a rod at this base now (an average one: the job's sizing).
export function baseFishDay(state, base, hour = state.hour) {
  const kit = { rods: 1, nets: 0, ice: true, power: FISH.rod * 0.85, used: 1 };
  const w = fishWater(state, base);
  if (!w) return 0;
  const dayStart = hour - (hour % 24);
  let r = 0;
  for (const hh of DAWN_DUSK.slice(0, CABIN.hours)) r += fishRate(state, kit, w.shore, dayStart + hh);
  return r * distFactor("fish", w.d, walkMult(state));
}
// The Hunt job's room (no fixed cap): hunters to close the land food gap to goalDays (foraging.js landFoodHands).
export const huntWorkCap = (state, base, goalDays) => landFoodHands(state, base, goalDays, baseHuntDay(state, base));
// What the Hunt job has brought in lately against what its sizing expected (ap-food, 2026-10-11): the job's hunters are
// sized by baseHuntDay (an average hunter with a hunting rifle on the best tile), and at a base without a cabin they
// brought in well under half of it (seed 5021: 40 of 96 over the first 27 hunter-days; pistols, quiet mixes, thinned
// ground). base.huntRec: [day, got, expected] for each day the job went out, the last HUNT_YIELD.days. huntYield:
// { got, exp, days, ratio (got / exp, null under HUNT_YIELD.min days), poor (ratio under HUNT_YIELD.low) }. The
// governor sends its no-cabin hunters back to the plots while it is poor (autopilot.js planRoles).
export const HUNT_YIELD = { days: 14, min: 4, low: 0.5 };
export function recordHuntYield(state, base, got, exp) {
  const d = Math.floor(state.hour / 24);
  const rec = (Array.isArray(base.huntRec) ? base.huntRec : []).filter((x) => d - x[0] < HUNT_YIELD.days);
  if (exp > 0) rec.push([d, r1(Math.max(0, got)), r1(exp)]);
  if (rec.length) base.huntRec = rec; else delete base.huntRec;
}
export function huntYield(state, base) {
  const d = Math.floor(state.hour / 24);
  const rec = (Array.isArray(base.huntRec) ? base.huntRec : []).filter((x) => d - x[0] < HUNT_YIELD.days);
  const got = rec.reduce((a, x) => a + x[1], 0), exp = rec.reduce((a, x) => a + x[2], 0);
  const ratio = rec.length >= HUNT_YIELD.min && exp > 0 ? got / exp : null;
  return { got: r1(got), exp: r1(exp), days: rec.length, ratio, poor: ratio != null && ratio < HUNT_YIELD.low };
}
// The Fish job's room: fishers to close it, at most one a rod (two a net).
export const fishWorkHands = (state, base, goalDays) => Math.min(fishWorkCap(state, base), landFoodHands(state, base, goalDays, baseFishDay(state, base)));
// The tile the base's hunters go to (jobtrips.js): the best of its hunting grounds (huntRadius) by the game it holds now,
// walking included (tripland.js distFactor: two tiles out 1, one 1.5): { id, v, d, f }. A hunting blind on a tile
// (sim/fieldworks.js, tripland.js tileGameMult) adds to what it is worth, and opens it past a cabinless base's grounds.
// radius: the grounds' reach (default the base's own: huntRadius; cabinGain asks what 2 would give).
export function huntTripTile(state, base, hour = state.hour, radius = huntRadius(base)) {
  let best = null;
  const m = walkMult(state); // the game's walking pace (tripland.js PACES)
  for (const id of workLand(state, base.tile)) {
    const a = gameAbundance(state, id);
    const gm = tileGameMult(state, base, id);
    if (a <= 0.02 || (state.grid.distance(base.tile, id) > radius && gm <= 1)) continue;
    const d = state.grid.distance(base.tile, id), f = distFactor("hunt", d, m), v = a * gameLevel(state, id, hour) * gm;
    if (!best || v * f > best.v * best.f + 1e-12 || (Math.abs(v * f - best.v * best.f) <= 1e-12 && id < best.id)) best = { id, v, d, f };
  }
  return best;
}
// Where the base's fishers go: its nearest water tile with a fishing spot (tripland.js waterSources: the water it owns,
// or what sim/fieldworks adds), fished from the shore tile beside it: { id, d, shore, spot } or null.
export function fishWater(state, base) {
  for (const w of waterSources(state, base)) {
    const shore = shoreOf(state, base.tile, w.id);
    const spot = fishSpot(state, shore);
    if (spot) return { id: w.id, d: w.d, shore, spot };
  }
  return null;
}

export const ammoKeep = (state, base) => atBase(state, base.id).length * 3 + 10; // ammo the cabin's hunters leave for the walls
const DAWN_DUSK = [6, 17, 7, 18, 5, 19]; // the hours a base's hunters and fishers are out (dawn and dusk first)
// The day's hours of the base's hunters by its hunting mix: [{ s, hours, guns, bows, traps }] in the hunters' order.
// The mix's gun hours go to those with a gun first (a loud weapon, the best first), then to anyone with a weapon (a
// bow-only hunter shoots the bow); gun hours nobody can take become bow hours, which go to those with a bow and arrows
// (bow-only hunters first); every other hour is on the snare lines. The fraction of an hour the mix asks for carries
// over to the next day (base.huntCarry), so one hunter at 50% guns shoots 1 or 2 of their 3 hours in turn.
export function cabinPlan(state, base, hunters, ammo = Infinity, arrows = Infinity, mix = huntMixOf(base)) {
  const lend = huntLoans(state, base, hunters);
  const rows = hunters.map((s) => ({ s, hours: Math.round(CABIN.huntHours * Math.min(1, workFactor(s))), guns: 0, bows: 0, traps: 0, any: bestHuntWeapon(s, ammo, arrows, null, lend.get(s.id)), bow: bestHuntWeapon(s, ammo, arrows, "bow", lend.get(s.id)) }));
  const S = rows.reduce((a, r) => a + r.hours, 0);
  // Whole hours: the guns' share, and the guns' and bows' together (the rest is the traps'), each with its carry.
  const carry = { ...(base.huntCarry || {}) };
  const want = (k, share) => { const x = share * S + (carry[k] || 0); const q = Math.floor(x + 1e-9); carry[k] = Math.round((x - q) * 1e4) / 1e4; return q; };
  let g = want("guns", mix.guns / 100);
  let bw = Math.max(0, want("loud", (mix.guns + mix.bows) / 100) - g);
  if (carry.guns || carry.loud) base.huntCarry = { guns: carry.guns || 0, loud: carry.loud || 0 };
  else delete base.huntCarry;
  const loud = (r) => (r.any && r.any.w.loud ? 1 : 0);
  for (const r of rows.filter((x) => x.any).sort((a, b) => loud(b) - loud(a) || b.any.v - a.any.v || a.s.id - b.s.id)) { const n = Math.min(r.hours, g); r.guns = n; g -= n; }
  bw += g;
  for (const r of rows.filter((x) => x.bow && x.guns < x.hours).sort((a, b) => loud(a) - loud(b) || b.bow.v - a.bow.v || a.s.id - b.s.id)) { const n = Math.min(r.hours - r.guns, bw); r.bows = n; bw -= n; }
  for (const r of rows) r.traps = r.hours - r.guns - r.bows;
  return rows;
}
// A hunter's plan for the day (cabinPlan, once a day for the base's hunters: base.huntPlan): their hours with guns,
// bows and on the snares. Someone who joins the hunt later in the day gets their own (the mix's carry left alone).
export function hunterDayPlan(state, base, s) {
  const dayIdx = Math.floor(state.hour / 24);
  const spare = Math.max(0, totalRounds(base.stock) - ammoKeep(state, base)), quiver = Math.max(0, base.stock.arrows || 0);
  let P = base.huntPlan;
  if (!P || P.day !== dayIdx) {
    const hunters = atBase(state, base.id).filter((x) => x.role === "hunt" && !x.inBed && workFactor(x) >= 0.35);
    P = base.huntPlan = { day: dayIdx, rows: {} };
    for (const r of cabinPlan(state, base, hunters, spare, quiver)) P.rows[r.s.id] = { guns: r.guns, bows: r.bows, traps: r.traps, hours: r.hours };
  }
  if (!P.rows[s.id]) {
    const keep = base.huntCarry;
    const r = cabinPlan(state, base, [s], spare, quiver)[0];
    if (keep) base.huntCarry = keep; else delete base.huntCarry;
    P.rows[s.id] = { guns: r.guns, bows: r.bows, traps: r.traps, hours: r.hours };
  }
  return P.rows[s.id];
}
// One hunter's trip (jobtrips.js): `hours` of the old job's hours (the walk already out of them: the day's CABIN.huntHours
// one tile out) on `tile`, read at `hour` (dawn or dusk). Their share of the day's plan by method (hunterDayPlan); each
// hour's weapon chosen again (the ammo or arrows may run out), whole hours rolled as the old job did and the last
// part-hour at its share of the odds. The walls' ammo is never taken (ammoKeep). Returns the catch (rations, deer,
// hog, small, shots, arrows, trapped, hrs, noise, gunfire { tile: quiet }, worm, infested): it comes home with them.
export function huntTrip(state, base, s, tile, hours, hour) {
  const row = hunterDayPlan(state, base, s);
  const frac = hours / CABIN.huntHours;
  const lent = huntLoans(state, base).get(s.id); // the armory's hunting weapon this hunter takes out today, if any
  const blind = tileGameMult(state, base, tile); // a hunting blind there (sim/fieldworks.js): more game for the hunters
  const got = { rations: 0, shots: 0, hrs: { traps: 0, bows: 0, guns: 0 }, noise: 0, gunfire: {} };
  const spare = () => Math.max(0, totalRounds(base.stock) - ammoKeep(state, base));
  const spareFor = () => (spare() > 0 ? base.stock : 0); // ammo.js: a gun needs rounds of its own calibre (and the walls' keep left)
  const quiver = () => Math.max(0, base.stock.arrows || 0);
  const parts = (a) => { const out = []; let x = a; while (x > 1e-9) { out.push(Math.min(1, x)); x -= 1; } return out; };
  let trapHours = row.traps * frac, shot = false;
  for (const [m, a] of [["guns", row.guns * frac], ["bows", row.bows * frac]]) for (const w of parts(a)) {
    const b = bestHuntWeapon(s, spareFor(), quiver(), m === "bows" ? "bow" : null, lent);
    if (!b) { trapHours += w; continue; }
    shot = true;
    got.hrs[b.w.arrows ? "bows" : "guns"] += w;
    const mult = hunterMult(s) * b.eff * blind;
    const team = { big: mult * b.w.big, small: mult * b.w.small };
    const o = huntOdds(state, team, tile, hour);
    const kills = [];
    if (state.rng.chance(o.big * w)) kills.push(state.rng.chance(o.deer) ? "deer" : "hog");
    if (state.rng.chance(o.small * w)) kills.push("small");
    for (const k of kills) {
      if (b.w.ammo) {
        const shots = 1 + (state.rng.chance(ANIMALS[k].big ? HUNT.missChance : HUNT.missSmall) ? 1 : 0);
        const used = takeHuntShots([base.stock], b.item, Math.min(shots, Math.floor(spare()))); // ammo.js: its calibre, its load first
        got.shots += used;
        got.noise += b.w.noise / 3;
        got.gunfire[tile] = Math.max(got.gunfire[tile] || 0, b.w.quiet ?? 1); // the loudest gun on that ground counts
        wearMuzzle(b.item, Math.max(1, used)); // an oil filter wears a shot at a time (gunmods.js)
      } else if (b.w.arrows) {
        // Silent, but a shot at game is often an arrow lost (ARROW.lost a shot; a miss first now and then).
        const shots = 1 + (state.rng.chance(ANIMALS[k].big ? HUNT.missChance : HUNT.missSmall) ? 1 : 0);
        let lost = 0;
        for (let j = 0; j < shots; j++) if (state.rng.chance(ARROW.lost)) lost++;
        lost = Math.min(lost, Math.floor(quiver()));
        base.stock.arrows = (base.stock.arrows || 0) - lost;
        got.arrowShots = (got.arrowShots || 0) + shots;
        got.arrows = (got.arrows || 0) + lost;
      }
      bagged(got, k);
      cabinKill(state, got, tile, ANIMALS[k].rations, k); // foods.js: the animal's meat by item
      takeGame(state, tile, ANIMALS[k].rations, ANIMALS[k].big ? HUNT.bigDeplete : HUNT.smallDeplete);
      gainXp(state, s, "shooting", ANIMALS[k].big ? 6 : 2);
    }
  }
  if (trapHours > 1e-9) {
    // Trap hours (and a hunter without a weapon): the cabin's snare lines (two lines; a full day's work is
    // CABIN.huntHours on them).
    got.hrs.traps += trapHours;
    const rate = snareDayRate(state, tile, hour) * CABIN.snareLines * (trapHours / CABIN.huntHours) * blind;
    let n = 0;
    for (let i = 0; i < SNARE.count * CABIN.snareLines; i++) if (state.rng.chance(Math.min(0.9, rate / (SNARE.count * CABIN.snareLines)))) n++;
    if (n) {
      got.small = (got.small || 0) + n;
      got.trapped = (got.trapped || 0) + n;
      for (let i = 0; i < n; i++) cabinKill(state, got, tile, ANIMALS.small.rations, "small");
      takeGame(state, tile, n * ANIMALS.small.rations, SNARE.deplete);
    }
  }
  gainXp(state, s, "scouting", (shot || !row.hours ? 4 : 3) * frac);
  return got;
}
// One fisher's trip (jobtrips.js): `hours` of the old job's hours on the bank at `shore` (fishWater), read at `hour`.
// The base's fishing tools are shared out over its fishers (fishTools; each one past the first catches a little less:
// fishCrowdShare), so their trips together catch what the old day's fishing did. Returns { rations, fish, worm, infested }.
export function fishTrip(state, base, s, shore, hours, hour) {
  // Only the tools they took out (jobtrips.js checkOutTool: from the armory into their hands or pack): one who has
  // none catches nothing, and the armory's rods left at home fish for nobody.
  const frozen = frozenAt(state, hour);
  if (!carriedItems(s).some((it) => isFishTool(it) && (!frozen || !isSpear(it)))) return { rations: 0, fish: 0, noTool: true };
  const fishers = atBase(state, base.id).filter((x) => x.role === "fish" && !x.inBed && workFactor(x) >= 0.35 && x.trip && x.trip.job === "fish");
  if (!fishers.includes(s)) fishers.push(s);
  const k0 = fishKit(fishers, [], { frozen });
  const share = fishCrowdShare(k0.used) / fishers.length;
  const kit = { ...k0, power: k0.power * share, spear: (k0.spear || 0) * share };
  const want = fishRate(state, kit, shore, hour) * hours;
  const got = { rations: 0, fish: 0 };
  const rolls = Math.max(3, Math.ceil(want * 2)); // three rolls a trip at least (more for a big catch)
  let n = 0;
  for (let i = 0; i < rolls; i++) if (state.rng.chance(Math.min(1, want / rolls))) n++;
  if (n) { got.fish = n; cabinKill(state, got, shore, n, "fish"); lower(state, "fish", shore, n / FISH.deplete); }
  return got;
}
// Daily (economy.js baseDaily): the Hunt and Fish jobs' day is in (their trips brought the catch home through the day,
// jobtrips.js), and the Forage job's (foraging.js). Here what the day leaves behind: the gunshots' noise for the
// base's Heat and the hordes they drew, the fishing tools' wear, the summary (base.huntLast) and the log. Returns the
// day's catch (rations, shots, hrs, deer, hog, small, fish, arrows, trapped, drawn …).
export function huntingDaily(state, base) {
  foragingDaily(state, base);
  const people = atBase(state, base.id).filter((s) => !s.inBed && workFactor(s) >= 0.35);
  const hunters = people.filter((s) => s.role === "hunt");
  const fishers = people.filter((s) => s.role === "fish");
  const T = base.tripTally && base.tripTally.day === Math.floor((state.hour - 1) / 24) ? base.tripTally : null;
  const h = (T && T.hunt) || null, fi = (T && T.fish) || null;
  const got = { rations: 0, shots: 0 };
  for (const x of [h, fi]) if (x) for (const k of ["rations", "shots", "deer", "hog", "small", "fish", "arrows", "arrowShots", "trapped", "worm", "infested"]) if (x[k]) got[k] = Math.round(((got[k] || 0) + x[k]) * 100) / 100;
  if (h && h.hrs) got.hrs = { traps: r1(h.hrs.traps || 0), bows: r1(h.hrs.bows || 0), guns: r1(h.hrs.guns || 0) };
  base.huntNoise = Math.round(((h && h.noise) || 0) * 10) / 10; // hordes.js baseHeat: gunshots around the base
  // Gunfire carries: each wandering horde within 3 tiles of a hunting ground with shots today may turn toward it.
  for (const [tile, quiet] of Object.entries((h && h.gunfire) || {})) got.drawn = (got.drawn || 0) + drawHordes(state, Number(tile), quiet);
  if (got.hrs) base.huntLast = { day: Math.floor(state.hour / 24), mix: huntMixOf(base), hrs: got.hrs, rations: Math.round(((h && h.rations) || 0) * 10) / 10, shots: got.shots, arrows: got.arrows || 0, trapped: got.trapped || 0, drawn: got.drawn || 0, noise: base.huntNoise };
  // The day's catch against what the job's sizing expected of those who went out (huntYield).
  if (h && h.who && h.who.length) recordHuntYield(state, base, h.rations || 0, h.who.length * baseHuntDay(state, base, state.hour - 12));
  if (hunters.length && !h) noteOutput(state, base, "hunt", 0, "food");
  if (fishers.length && !fishWorkWhy(state, base)) {
    const k0 = fishTools(state, base, fishers, { frozen: frozenAt(state) });
    for (const s of fishers) gainXp(state, s, "scouting", 3);
    wearFishTools(state, k0, fishers, [base.armory]); // a day of fishing on the rods, nets and spears
  }
  if (fishers.length && !fi) noteOutput(state, base, "fish", 0, "food");
  if (got.rations > 0) {
    const who = [...new Set([...((h && h.who) || []), ...((fi && fi.who) || [])])].map((id) => state.survivors.find((x) => x.id === id)).filter(Boolean);
    const worm = got.infested ? ` ${got.infested} of them infested: a quarter of the meat, with the worm's eggs.` : got.worm > 0 ? " Some of it is from infected land and needs cooking through." : "";
    log(state, `${(who.length ? who : [...hunters, ...fishers]).map(first).join(" and ")} brought in ${countText(got)} at ${base.name} (${Math.floor(got.rations)} days of food in raw meat and fish).${worm}`, "good");
  }
  return got;
}
// One kill by a base's hunters, snares or fishers (worm.js wormKill): what it adds to the day's catch, by the item
// (got.items / got.eggItems: { key: q }, the meat with the worm's eggs apart).
function cabinKill(state, got, tile, rations, kind = "small") {
  const wk = wormKill(state, tile, rations, { fish: kind === "fish" });
  got.rations += wk.rations;
  if (wk.worm > 0) got.worm = (got.worm || 0) + wk.worm;
  if (wk.infested) got.infested = (got.infested || 0) + 1;
  const item = gameItem(state, kind);
  const clean = Math.max(0, wk.rations - wk.worm);
  if (clean > 0) { got.items = got.items || {}; got.items[item] = (got.items[item] || 0) + qtyOf(item, clean); }
  if (wk.worm > 0) { got.eggItems = got.eggItems || {}; got.eggItems[item] = (got.eggItems[item] || 0) + qtyOf(item, wk.worm); }
}
// A day's catch into a base's stores (or a hunter's trip home, job-trips): got.items and got.eggItems ({ key: q }), or
// a bare count of rations (got.rations) of `kind` (the deer, hog, small game or fish of an older caller).
export function depositGame(state, base, got, kind = "small") {
  if (!got) return 0;
  let n = 0;
  if (!got.items && !got.eggItems && got.rations > 0) {
    const item = gameItem(state, kind), w = Math.max(0, Math.min(got.rations, got.worm || 0));
    n += addFood(base, item, qtyOf(item, got.rations - w), { state });
    if (w > 0) n += addFood(base, item, qtyOf(item, w), { state, egg: true });
    return n;
  }
  for (const [k, q] of Object.entries(got.items || {})) n += addFood(base, k, q, { state });
  for (const [k, q] of Object.entries(got.eggItems || {})) n += addFood(base, k, q, { state, egg: true });
  return n;
}

// ---------- fresh game at a base (storage.js storageDaily) ----------
// The hunting cabin's smokehouse: up to CABIN.smoke days of raw meat and fish a day (those with the worm's eggs
// first: smoked, they are safe) into CABIN.smokeOut of jerky (fish: smoked fish). Returns { smoked, dried }.
export function baseGameDaily(state, base) {
  const out = { smoked: 0, dried: 0, spoiled: 0 };
  if (!baseHasHunting(base) || !atBase(state, base.id).length || !(meatAt(base) > 0)) return out;
  const isGame = (k, f) => f.group === "rawmeat" || f.group === "rawfish";
  const a = takeFood(base, CABIN.smoke, { only: isGame, clean: false, state });
  const b = CABIN.smoke - a.units > 1e-9 ? takeFood(base, CABIN.smoke - a.units, { only: isGame, eggs: false, state }) : { units: 0, items: {} };
  for (const r of [a, b]) for (const [k, q] of Object.entries(r.items)) {
    const into = FOODS[k].group === "rawfish" ? "f_smokedfish" : "f_jerky";
    const u = unitsOf(k, q) * (CABIN.smokeOut / CABIN.smoke);
    addFood(base, into, qtyOf(into, u), { state });
    out.dried += u;
  }
  out.smoked = a.units + b.units;
  return out;
}

// ---------- for the autopilot and crews ----------
// The best tiles to hunt within `range` of `from` for these people, by expected rations a trip hour.
// arrows and mix: what the team will carry and follow (huntTeam).
export function huntTargets(state, from, range, members, { ammo = Infinity, arrows = Infinity, mix = null, hours = HUNT.defHours, startHour = state.hour, limit = 6 } = {}) {
  const t = huntTeam(state, members, ammo, { arrows, mix });
  if (t.why) return [];
  const out = [];
  for (const id of state.grid.within(from, range)) {
    if (id === from || state.tiles[id].terrain === "water") continue;
    const a = gameAbundance(state, id);
    if (a * gameLevel(state, id) < 0.25) continue;
    if (state.parties.some((p) => p.owner === "player" && p.dest === id)) continue;
    const e = expectHunt(state, t.team, id, hours, startHour, t.loud);
    out.push({ tile: id, est: e, dist: state.grid.distance(from, id), snares: !!snareLine(state, id) });
  }
  return out.sort((a, b) => b.est.rations / (1 + b.dist / 5) - a.est.rations / (1 + a.dist / 5) || a.tile - b.tile).slice(0, limit);
}
export function fishTargets(state, from, range, members, extraItems = [], { hours = HUNT.defHours, startHour = state.hour, limit = 4 } = {}) {
  const kit = fishKit(members, extraItems, { frozen: frozenAt(state, startHour) });
  if (!kit.power) return [];
  const out = [];
  for (const id of state.grid.within(from, range)) {
    if (id === from || !fishSpot(state, id)) continue;
    if (frozenAt(state, startHour) && !kit.ice) continue;
    if (state.parties.some((p) => p.owner === "player" && p.dest === id)) continue;
    const e = expectFish(state, kit, id, hours, startHour);
    if (e.rations < 2) continue;
    out.push({ tile: id, est: e, dist: state.grid.distance(from, id) });
  }
  return out.sort((a, b) => b.est.rations / (1 + b.dist / 5) - a.est.rations / (1 + a.dist / 5) || a.tile - b.tile).slice(0, limit);
}
// A fishing rod or net in a base's armory (else a spear), moved into a team's cargo (autopilot, crews). Returns the item or null.
export function packFishingGear(state, base, p) {
  let i = (base.armory || []).findIndex((it) => isNet(it) || isRod(it));
  if (i < 0) i = (base.armory || []).findIndex(isSpear);
  if (i < 0) return null;
  const [it] = base.armory.splice(i, 1);
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  p.cargo.gear.push(it);
  return it;
}
export const hasFishingGear = (items) => (items || []).some(isFishTool);
// Arrows a hunting team takes from home: up to ARROW.pack while someone on it has a bow or crossbow and carries fewer.
export function huntArrowsFor(state, home, members, carriedNow = 0) {
  if (!home || !hasBow(members)) return 0;
  return Math.max(0, Math.min(Math.floor(home.stock.arrows || 0), ARROW.pack - Math.floor(carriedNow)));
}
// The arrows above, moved from the base's stock into the team's supplies (plans.js applyPlan). Returns how many.
export function packHuntArrows(state, home, p) {
  const n = huntArrowsFor(state, home, partyMembers(state, p), carried(p, "arrows"));
  if (n <= 0) return 0;
  home.stock.arrows -= n;
  p.supplies.arrows = (p.supplies.arrows || 0) + n;
  return n;
}
// The governor's hunting mix for a base (autopilot.js planRoles). With a hunting cabin or people on the Hunt job (they
// shoot on the base's hunting grounds, huntGrounds) and wandering dead within HUNT.drawRange of the base, or the dead at its gates: quiet (bows and
// traps; without a bow and arrows half traps, half guns: half the shots), unless the stores are down to AUTO_MIX.hungry
// days of food (food first then). A base with neither hunts only with its teams, away from its walls: the dead near
// it leave their mix alone. Bows only while the ammo above the walls' keep is short (under AUTO_MIX.ammo) and there are
// bows and arrows; bows and guns half and half with bows and arrows; else every hunter's best weapon (all guns).
export const AUTO_MIX = { ammo: 30, arrows: 4, hungry: 5, quietNoBows: { traps: 50, bows: 0, guns: 50 } };
export function autoHuntMix(state, base) {
  const people = atBase(state, base.id);
  const bows = hasBow(people) && (base.stock.arrows || 0) >= AUTO_MIX.arrows;
  const food = foodIn(base.stock) / Math.max(1, people.length);
  const near = (baseHasHunting(base) || people.some((s) => s.role === "hunt")) && food >= AUTO_MIX.hungry && state.hordes.some((h) => (["roam", "border", undefined, null].includes(h.role) && state.grid.distance(h.tile, base.tile) <= HUNT.drawRange) ||
    (h.role === "attack" && h.goal && h.goal.baseId === base.id));
  if (near) return bows ? { ...MIX_PRESETS.quiet.mix } : { ...AUTO_MIX.quietNoBows };
  const spare = baseAmmo(state, base) - ammoKeep(state, base); // ammo.js: the rounds that fit the guns here
  if (bows && spare < AUTO_MIX.ammo) return { traps: 0, bows: 100, guns: 0 };
  return bows ? { ...MIX_PRESETS.mixed.mix } : { ...DEFAULT_MIX };
}
