// The Codex (key C, 📚 Codex in the top bar, Help → Codex and search): every kind of the dead, the hives and their
// growths, items, supplies, buildings, illnesses and injuries, and the groups and outsiders, with the numbers from the
// game's own tables (sim/hiveconst.js ZTYPES and GROWTHS, data.js GEAR and SUPPLIES, buildings.js BUILDINGS, health.js
// CONDITIONS, worm.js, data.js FACTION_TYPES, visitors.js) and a line on how to deal with each.
//
// An entry opens the first time the player meets the thing (codexScan, run by main.js at every refresh: the full scan
// once an in-game hour, a battle's units every time): a kind of the dead seen in a battle (playerSees; a crawler once
// revealed, a Sleeper once spotted or burst) or in a horde on a live tile (its mix, a Wallbreaker at its head), a hive
// or growth you know of, an item someone of yours holds or a base's armory keeps (looted, crafted, traded: it is
// there), a supply in a base's stock, a building built or queued at one of your bases, an illness someone has (the
// worm once spotted, an infected wound), a group you know, an outsider party on a live tile. Until then it shows as
// "???" with its category. state.codex = { seen: { key: day }, fresh: [keys not looked at yet] } is saved with the
// campaign (sim/save.js writes the whole state); an older save without it opens what its world already shows.
import { MEET } from "../sim/trademeet.js"; // meeting to trade: the wait, the groups' halfway rule
import { FOODS, FOOD_GROUPS } from "../sim/foods.js"; // food by type in the codex
import { STORE, FACTOR } from "../sim/storage.js"; // the food chain entries: food rooms and spoilage
import { WOOD } from "../sim/woodcutting.js"; // a camp's fire a day
import { COOK } from "../sim/cooking.js"; // a cook fire's wood
import { EAT } from "../sim/eating.js"; // "No hot food"
import { KITCHEN } from "../sim/kitchen.js"; // the stove's wood
import { HELMETS, HELMET_ATTACH, MOUNT_NAMES as HELM_MOUNTS } from "../sim/helmets.js"; // helmet mounts (codex lines)
import { ZTYPES, GROWTHS, TECH, HIVE, BOSS_NAMES } from "../sim/hiveconst.js";
import { GEAR, SUPPLIES, CATEGORIES, FACTION_TYPES, FACTION_COLORS, SKILL_NAMES, LOCATIONS, SITE_ZONES, DANGER_NAMES, siteDanger } from "../sim/data.js";
import { POI, allPoiKinds, poisOf, knownPois, TILE_HEAT } from "../sim/pois.js"; // points of interest: one entry a kind, opened once one is known; tile heat
import { poiSpriteCanvas } from "./mapsprites.js"; // their map sprites
import { STREET, DOOR_KINDS } from "../sim/buildingmaps.js"; // the neighbourhood's street of houses; the kinds of door
import { WINDOW } from "../sim/windows.js"; // the map's windows: open, locked, fixed or broken
import { BELT_KG } from "../sim/holsters.js"; // the side arm and melee slots (k:holsters)
import { PUSH, GRIP } from "../sim/shoving.js"; // people and the dead shoved back a tile or flat on their back
import { SHOVE, BOARD, CRAWL, FURNITURE, shoveable, isBoarded } from "../sim/barricade.js"; // furniture shoved in the way, boards over doors and windows, the dead crawling over half cover
import { NOMADS } from "../sim/nomads.js"; // nomad bands: one entry a tier
import { BAL } from "../sim/coalition.js"; // keeping the coalition together
import { ENVOY, envoysHelp } from "../sim/envoys.js"; // envoys and radio links
import { LOAN } from "../sim/loans.js"; // volunteers on loan, joint operations
import { ERA_OPEN } from "../sim/blueprints.js"; // the radio station's era
import { BUILDINGS, RECIPES, PLOT_NAMES } from "../sim/buildings.js";
import { CONDITIONS, SICK } from "../sim/health.js";
import { WORM, wormSeen } from "../sim/worm.js";
import { bossUnit, DEFENCE } from "../sim/defences.js";
import { ZOMBIE_MOVE, playerSees, VAULT, CELL } from "../sim/combat.js";
import { FURNITURE_KINDS } from "../sim/data-furniture.js"; // the furniture catalogue: the Barricades entry names its pieces
import { zRevealed } from "../sim/zombietypes.js";
import { FLASH } from "../sim/throwables.js"; // a flashbang's numbers
import { allItems, SLOT_NAMES, ARMOR_CAP } from "../sim/inventory.js";
import { MEDIC } from "../sim/medics.js"; // stabilizing oneself: the odds by item (MEDIC.SELF)
import { durUnit } from "../sim/crafting.js"; // what an item's uses count (fights, days of fishing...)
import { day } from "../sim/world.js";
import { BOND } from "../sim/bonds.js"; // bonds between survivors: the People entry
import { REL } from "../sim/relations.js";
import { FIELD } from "../sim/fieldworks.js"; // field works: one entry a kind
import { BLUEPRINTS, CRAFT_BOOKS, LOCKED, techName, unlockName } from "../sim/blueprints.js"; // what a manual or craft book unlocks
import { BIRTH } from "../sim/hivebirth.js"; // a hive being born: breaking up the gathering
import { HCRAWL, HIVEMIND } from "../sim/hivecrawl.js"; // the hive crawl and the Hivemind
import { FRONT_KINDS, FRONT, ICE, WEATHER, visibleFronts, iceRow } from "../sim/weather.js"; // weather fronts and river ice
import { threatForecast, THREAT } from "../sim/forecast.js"; // the top bar's 7-day threat forecast
import { zombieCanvas, armoredCanvas, enemyCanvas } from "./sprites.js";
import { keyLabel } from "./keymap.js";
import { ztypeBattleCanvas, bossBattleCanvas, growthCanvas, siteSpriteCanvas } from "./hivesprites.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const pct = (v) => `${Math.round(v * 100)}%`;
const x = (v) => `×${Math.round(v * 100) / 100}`;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const list = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

export const CODEX_CATS = [
  ["dead", "The dead"], ["hives", "Hives"], ["items", "Items"], ["supplies", "Supplies"], ["buildings", "Buildings"],
  ["places", "Places"], ["conditions", "Illness and injury"], ["people", "People"], ["groups", "Groups and outsiders"], ["weather", "Weather"],
];
const CAT_NAME = Object.fromEntries(CODEX_CATS);

// ---------- the entries ----------
// { key, cat, name, sub (the category line, shown on a locked entry too), stats: [[label, value]], text, how, sprite() }
const SENSE_WORDS = { noise: "noise", light: "light", heat: "heat" };
const senses = (s) => (!s ? "noise and light (as the ordinary dead)" : s.length ? list(s.map((k) => SENSE_WORDS[k] || k)) : "nothing (decoys do not work on it)");
const bredBy = (kind) => Object.values(GROWTHS).find((g) => g.unlocks === kind);

function deadEntries() {
  const out = [{
    key: "z:walker", cat: "dead", name: "The dead", sub: "Ordinary dead",
    stats: [["Moves", `${ZOMBIE_MOVE} tiles an action`], ["Follows", senses(null)], ["Strength", "by the Infection of the ground: tougher on hive land, much tougher on the red-skull ring"]],
    text: "Most of the dead are ordinary: slow, many, and drawn by noise and light. Gunfire draws more of them in; a horde on the State Map is these, with a hive's special dead mixed in.",
    how: "Fight from cover and from behind walls, use melee where you can (silent), and never let them surround one of your people. Decoys (noise, light) pull hordes and the battle's dead away.",
    sprite: () => zombieCanvas("walker", 7),
  }];
  for (const [k, z] of Object.entries(ZTYPES)) {
    const g = bredBy(k);
    const stats = [["Health", `${x(z.hp)} an ordinary zombie's`], ["Damage", x(z.dmg)], ["Moves", z.mob == null ? `${ZOMBIE_MOVE} tiles an action (as the ordinary dead)` : z.mob ? `${z.mob} tiles an action` : "never"]];
    if (z.armor < 1) stats.push(["Takes", `${pct(z.armor)} of each hit${z.military ? " (on average: by the weapon)" : ""}`]);
    if (z.burn && z.burn !== 1) stats.push(["Fire", `${x(z.burn)} damage from fire`]);
    stats.push(["Follows", senses(z.senses)]);
    if (z.share) stats.push(["In a horde", `about ${pct(z.share)} of a horde from a hive that breeds it`]);
    if (z.wall && z.wall !== 1) stats.push(["At the walls", `presses ${x(z.wall)} as hard as one of the ordinary dead`]);
    if (z.answers) stats.push(["Counters", `${z.answers}: bred by a hive whose hordes meet them (sim/counterdead.js)`]); // the counter-dead
    if (z.breed) stats.push(["Costs the hive", `${z.breed} resources each, on top of the horde`]);
    stats.push(["Comes from", g ? `a hive with a ${g.name} (tier ${g.tier})` : z.military ? "military sites, police stations and hordes that crossed them" : z.beast ? (k === "deadcat" || k === "deadhound" ? "the towns and the cities (the houses, neighbourhoods, motels and apartment blocks most of all)" + (k === "deadhound" ? ", the farmland and the farms" : "") + ", more on infected ground" : "the hills, the woods and the farmland (more on infected ground, by the farms, barns and ranches, and where an infested herd grazes), and hordes that crossed such land") : k === "swarm" ? "a Carrier or Flinger, a Sleeper bursting" : k === "sleeper" ? "the bodies lying on battle maps, more on infected ground" : "—"]);
    out.push({
      key: `z:${k}`, cat: "dead", name: z.name, sub: g ? "Special dead, bred by hives" : z.military ? "The armoured dead" : z.beast ? "The dead beasts" : "Special dead",
      stats, text: z.special, how: z.counter,
      sprite: () => (k === "runner" || k === "brute" ? zombieCanvas(k, 7) : k === "soldier" || k === "riot" ? armoredCanvas(k, 7) : k === "sleeper" ? zombieCanvas("bloated", 3) : ztypeBattleCanvas(k)),
    });
  }
  const boss = (kind) => bossUnit({ nextId: 0 }, kind);
  const wb = boss("wallbreaker"), bm = boss("broodmother");
  out.push({
    key: "z:wallbreaker", cat: "dead", name: BOSS_NAMES.horde, sub: "Boss",
    stats: [["Health", wb.hp], ["Takes", `${pct(wb.armor)} of each hit`], ["Damage", `${x(wb.dmgMult)} (crushing blows, ${wb.meleeAim} melee aim)`], ["Moves", `${wb.mob} tiles an action`],
      ["At the walls", `a base holds back only ${pct(DEFENCE.BOSS[1])} of its usual horde with one at the head, ${pct(DEFENCE.BOSS[2])} with two`], ["Comes from", `a hive with a Wallbreaker den, from day ${HIVE.BOSS_DAY}`]],
    text: "A grey brute with a concrete fist at the head of a horde. Every time its horde attacks it smashes a defence: a barricade, and the reinforced gate once no barricade is left.",
    how: "Meet its horde away from your walls, or have the heavy guns, armor and defenders ready at the base. Kill it and the horde is just a horde again. Burning the hive's Wallbreaker den stops new ones.",
    sprite: () => bossBattleCanvas("wallbreaker"),
  });
  out.push({
    key: "z:broodmother", cat: "dead", name: BOSS_NAMES.hive, sub: "Boss",
    stats: [["Health", bm.hp], ["Takes", `${pct(bm.armor)} of each hit`], ["Damage", `${x(bm.dmgMult)} (crushing blows, ${bm.meleeAim} melee aim)`], ["Moves", `${bm.mob} tiles an action`], ["Comes from", "the heart of every hive"]],
    text: `The hive's mother: she guards the ${BOSS_NAMES.hivemind} in the core room at the end of a hive crawl (the Destroy hive mission), among the last of the brood.`,
    how: `Bring your best shooters, armor, meds, a light each, and Molotovs and flashbangs for the core. Thin the brood on the way in; she falls with the ${BOSS_NAMES.hivemind}.`,
    sprite: () => bossBattleCanvas("broodmother"),
  });
  const hm = boss("hivemind");
  out.push({
    key: "z:hivemind", cat: "dead", name: BOSS_NAMES.hivemind, sub: "Boss",
    stats: [["Health", `${HIVEMIND.hp} (+${HIVEMIND.perTier} a tier of its hive)`], ["Takes", `${pct(hm.armor)} of each hit`], ["Moves", "never: it is rooted in the core"],
      ["Pulse", `every turn: everyone within ${HIVEMIND.pulse} tiles takes ${HIVEMIND.pulseDmg[0]}–${HIVEMIND.pulseDmg[1]}, ${pct(HIVEMIND.stun)} of them stunned (an action less)`],
      ["Lash", `${HIVEMIND.lash[0]}–${HIVEMIND.lash[1]} to someone next to it`], ["Brood", `${HIVEMIND.spawn[0]}–${HIVEMIND.spawn[1]} torn out of the walls every ${HIVEMIND.spawnEvery} turns, ${HIVEMIND.cap} + ${HIVEMIND.capTier} a tier in all`],
      ["Second phase", `below ${pct(HIVEMIND.P2.at)} of its health it tears open: the cave quakes (${HIVEMIND.P2.quake[0]}–${HIVEMIND.P2.quake[1]} pillars come down), its pulse reaches ${HIVEMIND.P2.pulse} tiles for ${HIVEMIND.P2.pulseDmg[0]}–${HIVEMIND.P2.pulseDmg[1]} (${pct(HIVEMIND.P2.stun)} stunned), ${HIVEMIND.P2.spawn[0]}–${HIVEMIND.P2.spawn[1]} brood at a time and ${HIVEMIND.P2.cap} more in all`],
      ["Hoard", "what the hive dragged in from the dead lies in its core: guns, armour, rounds, meds, now and then something rare (richer the older and fatter the hive)"],
      ["Comes from", `the core room of every hive, ${HCRAWL.DEPTH[0]}–${HCRAWL.DEPTH[HCRAWL.DEPTH.length - 1]} chambers in from its mouth by its tier`]],
    text: "The organ that thinks for a hive: a hill of folded flesh that beats like a heart at the end of the core room. Wounded past half it tears open and pulls the whole hive in with it. Kill it and the hive dies around you, its brood dropping where it stands.",
    how: "Crawl to it (follow the warmth: the core is the hottest place in the hive), with meds for the way and the fight, and a light each: the core is dark, and a light lets its carrier see further. Keep out of its pulse when you can and shoot it from range; the battle AI aims for it first. Save something for its second phase. Burning egg chambers on the way means fewer brood when you come back. Search its hoard after.",
    sprite: () => bossBattleCanvas("hivemind"),
  });
  return out;
}

function hiveEntries() {
  const out = [{
    key: "h:hive", cat: "hives", name: "Infestation hive", sub: "Hive",
    stats: [["Holds", `the land within ${HIVE.TERRITORY} tiles (sites there show at least 3 skulls)`], ["Ring", `${HIVE.RING} tile of red-skull ground: much tougher dead`], ["Infection", `radiates out to ${HIVE.RADIATE} tiles`], ["Attacks", `your bases from up to ${HIVE.ATTACK_RANGE} tiles`]],
    text: "A red, glowing mound where the dead gather. It gains resources every day (more with other hives near) and spends them on hordes, Wallbreakers and growths; its hordes attack bases and its growths let it breed special dead.",
    how: `Destroy it with the Destroy hive mission: Enter the hive and crawl its chambers to the core (${HCRAWL.DEPTH.join(", ")} chambers deep by its tier), then kill the ${BOSS_NAMES.hivemind}. Nothing from outside kills it: no fire, no bombs. Thin its brood by crawling partway (cleared chambers stay clear a while), burn its egg chambers and the roots of its growths from inside, and bring Molotovs and flashbangs for the core. Burning its growths weakens it until you can.`,
    sprite: null,
  }, {
    key: "h:site", cat: "hives", name: "Hive being built", sub: "Hive",
    stats: [["Stands", `when ${HIVE.SITE_BIOMASS.toLocaleString("en-US")} of the dead have gone into it, at most ${HIVE.SITE_INTAKE} a day`],
      ["Break it up", `${BIRTH.FIGHT_MIN}–${BIRTH.FIGHT_MAX} of the dead at power ${BIRTH.FIGHT_POWER}+, no ${BOSS_NAMES.hive}`],
      ["Setback", `not begun: given up; under way: ${pct(BIRTH.SETBACK)} of its mound lost, unfed ${BIRTH.PAUSE_DAYS} days`]],
    text: "A raw mound of bones: hordes gather at a spot the hives picked, and once enough have come it starts turning into a new hive. You may hear of it on the radio or from travellers; once you see the dead massing a card asks what to do, and the map shows the days left until it stands.",
    how: "Strike while it is a build site: send a Cull horde team and Break up the gathering (a battle far smaller than storming a hive) before it stands, about four weeks from the first gathering. Mark it to keep an alert on it.",
    sprite: () => siteSpriteCanvas(true),
  }];
  for (const [k, g] of Object.entries(GROWTHS)) {
    const stats = [["Tier", g.tier], ["Costs the hive", `${g.cost} resources, ${g.days} days`]];
    if (g.unlocks && ZTYPES[g.unlocks]) stats.push(["Breeds", ZTYPES[g.unlocks].name]);
    if (g.counter && ZTYPES[g.unlocks]) stats.push(["Grown", `only by a hive whose hordes have met ${ZTYPES[g.unlocks].answers} (its read of them, the tile panel)`]);
    out.push({
      key: `h:${k}`, cat: "hives", name: g.name, sub: "Hive growth", stats, text: g.desc,
      how: `Burn the growth (right-click its tile): fight its guard in a small battle, or set it on fire (${TECH.FIRE_FUEL} fuel burns ${TECH.FIRE_DMG}% of it, ${TECH.BOMBS} Molotovs ${TECH.BOMB_DMG}%; it regrows ${TECH.REGROW}% a day). Destroying its hive withers it.`,
      sprite: () => growthCanvas(k),
    });
  }
  return out;
}

// How to use an item, by its trade category (data.js CATEGORIES); the item's own description says the rest.
const ITEM_HOW = {
  melee: "Hold it in the Hands slot and use Melee (E) next to an enemy: silent and needs no ammo. Quick weapons strike for 1 action (strike, then step away); spears reach 2 tiles and can be thrown. See Help: Guns and melee weapons.",
  pistol: "Hands slot: Shoot (F) costs ammo from the magazine (Reload, I: 1 action from a magazine or rounds in a pocket or the rig, both actions from the pack) and makes noise (it draws the dead, and Heat in a raid). Fits a pocket. Modify (⚙) opens the gun builder: its parts, its ammo, how reliable it is.",
  shotgun: "Hands slot: Shoot (F) costs a shell from the tube; Reload (I: 1 action) thumbs 2–4 shells in from those at hand (a pocket, the rig, a side-saddle); the pack's load for both actions, or Get shells (1 action) brings a handful to hand first. The pack is their own backpack and, on the road, the team's bags; never a base's stock (its defenders grab a box of shells out of it as the fight starts; a trip packs one at hand). Nobody starts with a free handful: a shotgunner with no shells on them or in the team's bags has only what is in the tube. Hits hard up close, poorly at range (buckshot spreads), and is loud. Buckshot catches a worm swarm. Modify (⚙) opens the gun builder: its parts, its ammo, how reliable it is.",
  rifle: "Hands slot: Shoot (F) costs ammo from the magazine (Reload, I: 1 action from a magazine, a clip or rounds in a pocket or the rig, both actions from the pack); the long-range gun, and loud. Rifle rounds get through the armoured dead. Modify (⚙) opens the gun builder: its parts, its ammo, how reliable it is.",
  automatic: "Hands slot: Shoot (F) fires by its fire mode (single, burst or full auto: Shift+F) from its magazine (Reload, I: 1 action): the best gun there is, hungry for ammo. Suppress (Shift+O) pins whoever is in the cone. Modify (⚙) opens the gun builder: its parts, its ammo, how reliable it is.",
  bow: "Hands slot: silent shots that use arrows (1 a shot), never ammo, and no reloading. With no arrows it is only a club. After a won fight about half the arrows shot are picked up again.",
  explosive: "From a pocket or the pack: Throw (G) in battle. Thrown, it is gone. Kept in a base's armory, some of them work as decoys when a horde comes.",
  gunmod: "Fitted in the gun builder (select a gun in the inventory and press Modify, or the ⚙ on it): one part in each slot the gun has (sight, mount, muzzle, magazine, under the barrel, stock, grip, rail, light or laser, bipod, sling), some opening more (a mount a sight, a rail a grip, a light and a bipod). It weighs and is worth what it is with the gun, and is sold and looted with it. See Help: Gun builder.",
  armor: `Worn (Body, Head, Arms, Legs): the power of every worn piece adds up, to at most ${ARMOR_CAP}. Heavy armor counts in the wearer's load.`,
  defence: "Kept in a base's armory: used on the approach when a horde attacks the base.",
  medical: "Kept on a medic or in the armory: used when treating people (at a base, in the field or in battle).",
  electronics: "In the Off hand, or kept in a base's armory: see its description.",
  packs: "Worn on the Backpack slot: more pack slots and a higher load.",
  tools: "In the Off hand or the pack: see its description for where it helps.",
  optics: "Carried by anyone on a team: the team sees further (see its description). A scout sent before a raid looks from further off with it (binoculars or a spotting scope +3 tiles by day, a monocular or a thermal +2; at night only a thermal): better odds of going unseen (Help: Choices before a raid).",
  camp: "Carried by a team: it helps where the team camps.",
  books: "Read at a base: it teaches its skill up to the level it names (or lifts the mood).",
  manuals: "Studied at a base: it opens buildings or recipes that need it.",
  luxury: "Read or used at a base for mood; also a trade good.",
  vehicle: "Team cargo: brought home, it joins the base's vehicles.",
};
// Items with a line of their own (over their kind's).
const ITEM_HOW_KEY = {
  nvg: "In the Off hand (or on a helmet's mount): at night it sees 12 tiles down the cone with no light to give you away; switch it off and on for free (Alt+N). A scout sent before a night raid looks from 12 tiles with it, not the dark's 4–7 (Help: Choices before a raid).",
  flashbang: "Throw (G) it into a room before you go in, or at two or more of them bunched in cover: the stunned lose actions and aim and cannot overwatch the doorway. Keep your own people out of its 2 tiles (or facing away). Useless against the dead, except as a loud lure.",
  ragplugs: "Crafted (Rag earplugs: 1 scrap, 1 hour, no skill, no book; a team makes them in the field too). Worn in the Ear pro slot (in a pocket or the pack they do nothing), under any helmet (a full-shell helmet takes no muffs): a pair goes in at the start of a fight and the tin lasts about 4 fights (more when well made). Weaker than foam earplugs (2 off a bang's loudness, not 3): a rifle fired outdoors still rings the shooter's ears now and then. Only the pair in Ear pro is used.",
  makeshiftpick: "Crafted (Makeshift picks (3): 1 scrap, 1 hour, no skill, no book; a team makes them in the field too), three to a stack of up to 10 in a pocket. In a raid, stand next to a locked door, cabinet or car: the Pick (makeshift) button shows the odds; the crowbar and lockpicks are used first when both are carried. Expect to lose one pick every other try; a safe, a steel security door or a gun safe needs the real picks, a key or force.",
};
const TRADE_HOW = "A trade good: groups pay for it by their kind (raiders love liquor and drugs; zealots will not touch them). Use it at a base for mood, or sell it.";
function itemEntries() {
  const out = [];
  for (const [k, g] of Object.entries(GEAR)) {
    if (g.supKey) continue; // a supply held as an item (sim/supitems.js): the supply's own entry covers it
    const cat = CATEGORIES[g.cat];
    const stats = [["Kind", cat ? cap(cat.name) : "—"], ["Slot", SLOT_NAMES[g.slot] || (g.slot === "pack" ? "Pocket or pack" : g.slot === "cargo" ? "Team cargo" : g.slot)]];
    if (g.power && ["weapon", "armor", "head", "arms", "legs"].includes(g.slot)) stats.push([g.slot === "weapon" ? "Power" : "Armor", g.power]);
    if (g.req) stats.push(["Needs", `${SKILL_NAMES[g.skill] || g.skill} ${g.req} for full effect`]);
    if (g.noise) stats.push(["Noise", g.noise]);
    if (g.medKit) stats.push(["Medicine", `+${g.medKit} when treating`]);
    if (g.selfStab && MEDIC.SELF[k]) stats.push(["Stabilize yourself", `down and bleeding in battle, in the off hand, a pocket or a rig pouch: ${MEDIC.SELF[k].BASE}% + ${MEDIC.SELF[k].MED} a point of Medicine, at most ${MEDIC.SELF[k].MAX}%, a try a turn; a use when it works`]);
    if (g.slots) stats.push(["Pack", `${g.slots} slots, +${g.carry || 0} kg load`]);
    if (g.tabs) stats.push(["Tablets", g.dur]);
    else if (g.count) stats.push(["Holds", g.dur]);
    else if (g.groom) stats.push(["Lasts", `${g.dur} days of use`]);
    else if (g.dur) stats.push(["Lasts", `${g.dur} ${durUnit(k)}${g.makeshift ? " (makeshift)" : ""}; found ones are part-worn, crafted ones last by their quality`]);
    if (g.fish) stats.push(["Fishing", `${g.fish === "net" ? "net, worked by two, 1.2" : `${g.fish}, ${g.fishPower ?? 0.6}`} food an hour${g.fish === "spear" ? " in daylight, not through ice" : ""}`]);
    if (g.book && g.book.skill) stats.push(["Teaches", `${SKILL_NAMES[g.book.skill]} up to ${g.book.max}, ${g.book.hours} h to read`]);
    // Manuals and craft books (blueprints.js): what they open, and the recipes they make better and faster.
    const tech = g.blueprint ? BLUEPRINTS[g.blueprint] : CRAFT_BOOKS[k];
    if (tech) {
      const opens = [...(tech.unlocks.buildings || []), ...(tech.unlocks.upgrades || []), ...(tech.unlocks.crafts || [])].map(unlockName); // upgrades: the generator's tier 3 (gen-tiers)
      if (opens.length) stats.push(["Unlocks", opens.join(", ")]);
      const edge = [...new Set([...(tech.unlocks.crafts || []), ...(tech.covers || [])])].map(unlockName);
      if (edge.length) stats.push(["Crafting edge", edge.join(", ")]);
    }
    if (LOCKED.crafts[k]) stats.push(["Recipe", `locked until ${techName(LOCKED.crafts[k])} is ${CRAFT_BOOKS[LOCKED.crafts[k]] ? "read" : "studied"}`]);
    if (k === "flashbang") stats.push(["Flash", `${FLASH.r} tiles in sight (${FLASH.near} through a doorway): −${FLASH.ap} action next turn (−${FLASH.apNear} within a tile), aim −${FLASH.aim}, no overwatch; facing away: aim −${FLASH.daze}`]);
    if (g.visor) stats.push(["Visor", `takes ${Math.round(FLASH.visor * 100)}% off a flashbang`]);
    if (g.ears) stats.push(["Ears", `${g.ears.cut} off a bang's loudness, hearing ${g.ears.hear > 0 ? "+" : ""}${g.ears.hear} tiles${g.ears.elec ? ", electronic" : ""}${g.ears.link ? ", team link" : ""}`]); // sim/hearing.js
    if (HELMETS[k]) stats.push(["Mounts", HELMETS[k].mounts.map((m) => HELM_MOUNTS[m].toLowerCase()).join(", ") || "none (a full shell)"]); // sim/helmets.js
    if (HELMET_ATTACH[k]) stats.push(["Helmet mount", `${HELM_MOUNTS[HELMET_ATTACH[k].mount].toLowerCase()}${HELMET_ATTACH[k].fits ? `: ${HELMET_ATTACH[k].fits.map((x) => (GEAR[x] ? GEAR[x].name : x).toLowerCase()).join(", ")}` : ""}`]);
    if (g.ac) stats.push(["Armour class", `${g.ac}${g.blunt ? " (blows and bites only)" : ""}`]);
    stats.push(["Weight", `${g.weight} kg${g.small ? ", fits a pocket" : g.bulky ? ", bulky" : ""}`]);
    out.push({ key: `i:${k}`, cat: "items", name: g.name, sub: cat ? cap(cat.name) : "Item", stats, text: g.desc, how: ITEM_HOW_KEY[k] || ITEM_HOW[g.cat] || TRADE_HOW, sprite: null });
  }
  return out;
}
const SUPPLY_HOW = {
  water: "Safe to drink. Everyone drinks about 1 a day (more in summer, a hot day 1.6+). Keep the tanks full before summer.",
  rawwater: "Purify it (the water boiler, water filters, a camp fire, tablets) before drinking: drunk as it is, it can carry the worm's eggs.",
  fuel: "Vehicles burn it, generators and floodlights use it; it heats a base in winter after the wood.",
  meds: "Treat wounds and illnesses (a dose each). Rare: keep a reserve, and a med station makes more.",
  ammo: "Every gunshot costs it (an assault rifle two); Reload in battle fills a gun's magazine from it. An ammo bench makes more from scrap (it needs a workbench at the base to build).",
  arrows: "What bows and crossbows shoot, in fights and on hunts (1 a shot). After a won fight about half are picked up again, after a loss or a retreat none; a hunt loses about half. Teams with a bow pack a dozen each. Made by hand from wood and a little scrap; found at hunting lodges, gun stores, sports shops and campgrounds.",
  parts: "Buildings, vehicle repairs and gear need them. A machine shop makes them from scrap.",
  scrap: "What almost everything is built and crafted from. Scavenging brings it in.",
  jars: "The preserving room fills them; most come back when the food in them is eaten.",
  wood: "Heats a base in winter before fuel, boils the water, fires camp fires. Anyone with an axe can cut it.",
  carparts: "Vehicle repairs, garage upgrades and car-part recipes take them. Garages, gas stations and wrecks hold them; stripping a car gives several.",
  gunparts: "Springs, pins and barrels: repairs to guns and their attachments take them. Gun stores, armouries and barracks hold them; a spare gun salvaged gives some.",
  electronics: "Repairs to lights, lasers, night vision and radios take them; the electronics recipes (a pocket radio decoy, lights, lasers, sights, ear defenders) and the grid's builds (the breaker panel, pumps, the fence charger, the freezer, solar arrays, battery banks, the perimeter alarm, heaters, a charging station) too. Radio towers, offices and news wrecks hold them; taking apart phones, cameras, laptops, powered sights, lights, radios, power tools and generators gives some; a stripped car gives 1\u20134 by its type and condition, a wreck on the base map 1.",
  buildmat: "Lumber, cinder blocks, nails and fixings: some of every building, defence and upgrade (about one for every 12 scrap of its cost; builders make what the stores lack from 3 scrap each on site), and what a camp takes to become a base (Build up into a shelter 2 and 20 scrap, Build up into a base 5 and 100 scrap, Establish the outpost 2 and 20 scrap). Crafted from scrap (3 each, anywhere, a team too). Scavenged: hardware stores and quarries hold the most, then warehouses, factories, barns, farms and towns (a find on top of the place's usual loot; people on Scavenge at a base turn up a few too). Heavy (3 kg each): carried in both arms (up to 4 a person) or a vehicle.",
  metalsheet: "Corrugated roofing, steel siding and plate, 6 kg a sheet: carried in both arms only, up to 4 a person (the Carried slot), or in a vehicle. Roofs, metal-sheet walls and gates, steel doors and plate (the garage, storehouse, warehouse, armory, reinforced gate, guard towers, bunkhouses and more), their repairs, a vehicle's sheet-metal plating, and sheet-metal armour and weapons take them. Scavenged at hardware stores, factories, warehouses, auto shops, barns, sheds and crash sites, and off car wrecks on raid maps; stripping a car, a wreck on the base map or a wrecked car on the road gives some; pulled-down buildings give half theirs back. Flattened out of 4 scrap at a workshop (crafting), or 5 scrap on a building site.",
  stone: "Field stone, 1 kg a unit: a camp's fire ring (setting up a camp takes some carried), a cook fire, a water boiler, a kitchen's hearth, a well's or a cistern's lining, a root cellar's walls. Clear rocks and boulders on the build map, put people on Gather stone, or give a team the Gather stone order: mountains and hills best, then rubble, by a river more.",
  // The reloading bench (sim/reloading.js).
  brass: "Fired cases and shotgun hulls: a reloading bench loads a round into each. About 60% of the rounds your side fires come back after a won fight (a revolver's all); gun stores, ranges and lodges have bags of it.",
  powder: "Smokeless powder, in charges (a 1 lb can holds 100 pistol, 40 rifle or 60 shotgun loads) for the reloading bench. Gun stores, lodges and ranches; arms dealers sell it.",
  primers: "A reloading bench needs one for every round. Rare: gun stores, the military; arms dealers and trading groups sell them.",
  blackpowder: "Made at a reloading bench from wood, scrap and food (crafting): used when the smokeless powder runs out. Its loads jam more (×1.5) and are louder.",
  matchprimers: "Made at a reloading bench (crafting, Mechanics 8): used when the factory primers run out. They fail three times as often.",
};
function supplyEntries() {
  return Object.entries(SUPPLIES).map(([k, v]) => (FOODS[k] ? {
    // Food by type (sim/foods.js): its calories, weight and shelf life, its kind and quality.
    key: `s:${k}`, cat: "supplies", name: `${FOODS[k].icon} ${v.name}`, sub: "Food",
    stats: [["Kind", FOOD_GROUPS[FOODS[k].group].name], ["Food value", `${FOODS[k].fv.toFixed(2)} (a meal is 1.00, three a day)`], ["Calories", `${FOODS[k].kcal} kcal (${Math.round((FOODS[k].kcal / 2000) * 100) / 100} of a day)`], ["Weight", `${v.weight} kg`], ["Keeps", FOODS[k].shelf >= 365 ? `about ${Math.round(FOODS[k].shelf / 365)} years` : `about ${FOODS[k].shelf} days at room temperature`], ["Quality", FOODS[k].tier]],
    text: FOODS[k].desc, how: FOODS[k].stable ? "Needs no cold room. Eaten after the food that spoils sooner." : "Fresh: it fills the base's food rooms, coldest first (a root cellar triples its life, a cold store in winter or a freezer much more); outside it spoils faster. The soonest to spoil is eaten first; spoiled food is thrown out.", sprite: null,
  } : {
    key: `s:${k}`, cat: "supplies", name: v.name, sub: "Supply",
    stats: [["Kind", cap((CATEGORIES[v.cat] || { name: v.cat }).name)], ["Weight", `${v.weight} kg a unit`]],
    text: "", how: SUPPLY_HOW[k] || (v.round && v.round.hand ? "Rounds loaded at a reloading bench (sim/reloading.js): fired like factory rounds of the same type (the factory ones first), but they jam more, less the better the loader was; loaded below Mechanics 8 they aim 1 worse." : v.round ? "Rounds of one calibre and type (ammo.js): the guns of that calibre fire them, the type loaded decides (Reload picks another when there is some). Counted together as Ammo on the screens; carried in boxes." : ""), sprite: null,
  }));
}
function buildingEntries() {
  return Object.entries(BUILDINGS).filter(([, b]) => !b.hidden && !b.furniture && !b.retired).map(([k, b]) => { // beds as furniture are items (their own entries); the retired makeshift cots
    const stats = [["Costs", Object.entries(b.cost).map(([s, n]) => `${n} ${(SUPPLIES[s] || { name: s }).name.toLowerCase()}`).join(", ")], ["Takes", `${b.hours} hours of building`], ["At most", `${b.max} a base`]];
    if (b.plot) stats.push(["Stands on", `a ${PLOT_NAMES[b.plot].toLowerCase()}`]);
    if (b.req) stats.push(["Needs", Object.entries(b.req).map(([s, n]) => `a ${SKILL_NAMES[s] || s} ${n}+ survivor there`).join(", ")]);
    if (b.upgrades) stats.push(["Upgrades", BUILDINGS[b.upgrades].name]);
    if (b.station && RECIPES[b.station]) stats.push(["Makes", RECIPES[b.station].desc]);
    if (b.outpostOnly) stats.push(["Only at", "outposts"]);
    if (b.shelterOnly) stats.push(["Only at", "a shelter"]);
    return {
      key: `b:${k}`, cat: "buildings", name: b.name, sub: b.defence ? "Defence" : b.station ? "Workshop station" : b.family === "bench" ? "Crafting bench" : b.family ? "Hospital" : "Building", stats, text: b.desc,
      how: `Build it from a base's Construction tab: the people on the Build role do the work.${b.station ? " It needs an operator (Workshops tab)." : ""}${b.defence ? " It counts when a horde attacks the base." : ""}`,
      sprite: null,
    };
  });
}
const CONDITION_HOW = {
  cut: "Treat it with meds (a dose) and keep it clean: a bandage kit or surgical kit helps the treater. A hospital bed stops wounds from going bad.",
  sprain: "Rest: it heals by itself in a week or two. A dose takes a lot off; light work only until then.",
  chestcold: "Keep them fed and warm; a dose or two clears it. Catching, so a crowded base spreads it. Watch for pneumonia in the cold.",
  fever: "Treat it early: untreated it climbs, and above 60 it can turn into pneumonia.",
  flu: "Catching and fast in a crowded base: treat it, and keep the sick off the road. In the cold it can become pneumonia.",
  dysentery: "Treat it and keep the water up (it drinks more). Good food storage and full tanks make it rarer.",
  stomach: "It passes in a few days; 1 meds ends it at once if you want. Purified water prevents it.",
  poisoning: "It passes in a day or two (they rest it out); 1 meds ends it at once. A better cook, a clean kitchen (Clean first) and cooked meat prevent it.",
  pneumonia: "It kills without meds: treat it at once and get them into a hospital bed. They cannot work until it clears.",
  campfever: "A course of meds (two doses or more) and rest: alone it drags on for weeks. Catching and worst where people are packed in: more beds, a hospital and keeping the sick apart slow it.",
  woundfever: "Treat it at once (two doses or more) and get them into a hospital bed: it kills without meds. It comes from an infected wound, so clean those too.",
};
function conditionEntries() {
  const out = Object.entries(CONDITIONS).map(([k, c]) => {
    const stats = [["Kind", cap(c.kind)], ["Starts at", `severity ${c.sev[0]}–${c.sev[1]}`], ["Untreated", c.drift > 0 ? `worse by ${c.drift} a day` : `eases ${-c.drift} a day`],
      ["Health", c.hp ? `−${c.hp} a day at severity 100` : "none lost"], ["Work", `${pct(c.work)} at severity 100`], ["A dose", `${c.meds} meds, takes ${c.treat} off`]];
    if (c.spread) stats.push(["Catching", `${pct(c.spread)} a day to each person with them`]);
    if (c.thirst) stats.push(["Water", `+${c.thirst} a day`]);
    return { key: `c:${k}`, cat: "conditions", name: `${c.icon} ${c.name}`, sub: c.kind === "injury" ? "Injury" : "Illness", stats, text: c.desc, how: CONDITION_HOW[k] || "", sprite: null };
  });
  out.push({
    key: "c:worm", cat: "conditions", name: "🪱 The worm", sub: "Illness",
    stats: [["Course", `about ${WORM.COURSE} days; in the brain from day ${WORM.BRAIN_FROM}`], ["Health", `−${WORM.DAY_HP[0]} on day 1, rising to −${WORM.LATE_HP} a day`], ["Work", `${pct(WORM.GUT_WORK)} in the gut, ${pct(WORM.BRAIN_WORK)} in the brain`],
      ["Healing", `${pct(WORM.HEAL)} of the usual while it is in them; a hospital bed does nothing for them`], ["Meds", `${WORM.DOSE_MEDS} a day from the base or the team once it is spotted: ${pct(WORM.MEDS_HP)} of the damage, the course half as fast (it never clears it)`], ["Cures", `a dewormer (sure) or a purge (${WORM.PURGE_MEDS} meds) in the gut; then only surgery (${WORM.SURGERY_MEDS} meds, a Clinic or better)`]],
    text: "The parasite the dead carry. Caught by swallowing its eggs: un-purified water, food grown or gathered on infected ground, game that was not cooked, hands that handled the dead. Whoever dies with it gets up as one of the dead.",
    how: "Purify the water, cook the meat, wash after searching. Watch for it (a medic spots it sooner) and cure it in the gut stage: a dewormer is a sure cure.",
    sprite: null,
  }, {
    key: "c:infwound", cat: "conditions", name: "🦠 Infected wound", sub: "Injury",
    stats: [["Sets in", "on wounds below 40 health: 5% a day at a base (not in a hospital bed that guards against it), 8% a day on the road"], ["Clears", "by itself 10% a day at 50+ health"], ["Treatment", "1 extra meds to clean it"]],
    text: "A wound gone bad.",
    how: "Treat it with meds; a Clinic or better cleans infected wounds reliably, and a field hospital bed stops them setting in.",
    sprite: null,
  });
  return out;
}
const GROUP_HOW = {
  raider: "They raid: walls, guards and defences at home, escorts on the road. Pay them off or talk them down when they come, or break them (assault their bases). They pay well for liquor, drugs, cigarettes and guns.",
  expansionist: "They grab land fast and raid when they think they can win. Keep your defences up, claim land first, or make a pact while they are not hostile.",
  zealot: "The most hostile of all: they rarely talk. Defend well; they will not touch liquor or drugs in trade.",
  military: "Neutral and heavily armed; they never raid. Trade for guns and armor, and help them when a hive gets close: they hold their base until one overruns it.",
  fortress: "Neutral and walled in; they hardly expand and never raid. Steady trade partners once you are on good terms.",
  traders: "Friendly and never raid: the best trade partners. A trade pact lets you set up a trade route.",
  commune: "Friendly farmers with food to spare and few guns; they never raid. Trade for food; they may need your protection.",
};
function groupEntries() {
  const kit = { military: "soldiers", zealot: "zealots" };
  const out = Object.entries(FACTION_TYPES).map(([k, t], i) => ({
    key: `g:${k}`, cat: "groups", name: t.label, sub: "Group",
    stats: [["Starts", `${t.attitude.toLowerCase()} (goodwill ${t.goodwill > 0 ? "+" : ""}${t.goodwill})`], ["Arms", x(t.arms)], ["Food", x(t.food)], ["Raids", t.raid ? `about ${pct(t.raid)} a day when it can` : "never"], ["Grows", t.expand >= 0.03 ? "fast" : t.expand >= 0.01 ? "slowly" : "hardly"]],
    text: `Groups of this kind: ${t.names.join(", ")}…`,
    how: GROUP_HOW[k] || "",
    sprite: () => enemyCanvas(kit[k] || "raiders", FACTION_COLORS[i % FACTION_COLORS.length], null, null, 5),
  }));
  out.push({
    key: "o:raiders", cat: "groups", name: "Raider band from outside", sub: "Outsiders",
    stats: [["Size", "3–14, bigger and better armed as the years go by"], ["Stays", "about 8–14 days"]],
    text: "A band from beyond the state's border that roams, robs bases, teams, caravans and rich sites, and leaves once it has enough. A band that grows rich enough may dig in and become one of the map's groups.",
    how: "Prepare your defences when they come near, pay them off, talk them down (Speech) or fight. Over the radio you can pay them to leave the state.",
    sprite: () => enemyCanvas("raiders", "#7a1a1a", null, null, 9),
  }, {
    key: "o:merchants", cat: "groups", name: "Merchant caravan", sub: "Outsiders",
    stats: [["Escort", "what the cargo is worth to them, out of their company's 2–8 hired guns and its vehicles (a pickup, a Humvee or an MRAP)"], ["Carries", "by speciality (arms dealers, medics, mechanics, general traders); manuals, books and valuables"]],
    text: "Traders from another state, walking the roads with wagons. They visit the groups' bases and, when invited over the radio (or by chance), yours: the trade window opens for a day.",
    how: "Invite them over the radio when they call. They want food, water, scrap and jars. Rob one on the road and everything in the wagons is yours; if anyone gets away or sees it, every merchant hears of it.",
    sprite: () => enemyCanvas("raiders", "#d9a520", null, null, 4),
  }, {
    key: "o:explorers", cat: "groups", name: "Travellers", sub: "Outsiders",
    stats: [["Kinds", "scouts, refugees, wanderers"], ["Robbers", `${pct(0.08)} of them are robbers in disguise`]],
    text: "Scouts, refugees or wanderers crossing the state. They search ruins along the way and often come to your gate.",
    how: "Hear their news (free), buy the scouts' maps, trade, shelter them for a few days or take them in. Keep an eye out: a few rob the base that shelters them.",
    sprite: () => enemyCanvas("raiders", "#9a9a9a", null, null, 2),
  });
  // Nomad bands (sim/nomads.js): one entry a tier, opened when one is seen.
  const NOMAD_TEXT = {
    0: ["wary, not hostile; they trade", "only what they made from scrap: pipe spears, spiked bats, shivs, a scrap crossbow or a pipe shotgun, tyre vests", "The weakest people on the road, getting by on makeshift gear. Trade food for their handmade bits, swap news, share food; a fight with them is short, and all you take is scrap work.", "From the start."],
    1: ["hostile", "melee weapons and a pistol or two, no armour", "They rob a team they can take and scatter before one that is stronger. Pay them, talk them down, fight or run; a team stronger than they are can run them down for what they drop.", "From the start."],
    2: ["neutral, willing to trade", "hunting rifles, bows and shotguns, light armour", "The best foragers and hunters on the road, with a medic or two. Trade with them, swap news, share food; they remember a kindness.", "From year 2."],
    3: ["neutral and defensive", "rifles and carbines, plate carriers and steel (armour class 3 and up), a pickup or a Humvee", "Well armed and careful: they keep you at rifle range but will trade. Attacking them is a hard fight.", "From year 4."],
  };
  for (const tier of [0, 1, 2, 3]) {
    const T = NOMADS.TIERS[tier], [att, arms, how, from] = NOMAD_TEXT[tier];
    out.push({
      key: `n:${tier}`, cat: "groups", name: `Nomads: ${T.name}`, sub: "Nomads",
      stats: [["Size", `${T.size[0]}–${T.size[1]} people (they start small and stay small)`], ["Attitude", att], ["Arms", arms], ["Appears", from]],
      text: `Baseless bands that camp a few days, survey and pick over the places round their camp, then move on 4–8 tiles. They forage and hunt, eat and drink every day, and can starve, fall to the dead or to you; new bands come in from the edge of the map so there are always about half as many as there are groups. They take in neutral wanderers and refugees when they have food to spare. They are not one of the state's groups: no land, no base, no pacts, never in the Calder Coalition. Their camps show on the map once your people have seen one.`,
      how: `${how} Send a team to attack a camp you have spotted (the tile's Attack the nomad camp). They take what you left in a container you opened near their camp.`,
      sprite: () => enemyCanvas(T.kit === "preppers" ? "soldiers" : "raiders", NOMADS.COLORS[tier], null, null, tier + 1),
    });
  }
  // Keeping the Calder Coalition together (sim/coalition.js): opened once a group has joined.
  out.push({
    key: "k:coalition", cat: "groups", name: "🤝 Keeping the coalition", sub: "Standing, asks and tolerance",
    stats: [["Standing", "goodwill plus what they remember: each act at once, a quarter of it for good, the rest fading in a month or two"], ["Asks", "every few days: a quarrel, a favour at another's expense, a trade, aid, fighters or rounds"], ["Refusals", `harder the more you refuse against what you grant (up to ×${BAL.FAT.MAX}), and "Requests ignored" deepens`], ["Leaving", `under a member's leave line (${BAL.LEAVE + Math.min(...Object.values(BAL.TOL)) - 3}–${BAL.LEAVE + Math.max(...Object.values(BAL.TOL)) + 3} by its kind) it may go; under 20 at once; far under, in anger`], ["Expulsion", `a member that cannot stand another demands it goes: expel, hold talks (${BAL.TALKS.food} days of food to each side) or refuse; refuse ${BAL.DEMAND_MAX} times and it leaves`]],
    text: "Every member of the Calder Coalition weighs you and the others all the time, as rulers do in a grand strategy game. What you grant and refuse, the rulings you make between them, the fights you join, all go on a ledger of named modifiers that fade with time, on top of their goodwill and their relations with each other. Neighbours rub each other raw on the border, trade partners and those who share an enemy grow closer, and now and then something happens between them. Touchy kinds (raiders, zealots, expansionists) leave sooner than communes and traders; a warlike member that leaves in anger declares war on you.",
    how: "Open Diplomacy → Coalition standing: each member's bar, its leave and hostile lines, what it remembers, its record and its risks, and the grid of how members feel about each other. Grant the asks of members close to their line, split quarrels when you can, and do not refuse the same member again and again. A member who leaves takes its land out of the count and is a group outside the coalition, which blocks the victory.", sprite: null,
  });
  // Volunteers on loan and joint operations (sim/loans.js): opened once you have asked for either.
  out.push({
    key: "k:loans", cat: "groups", name: "⚑ Volunteers on loan and joint operations", sub: "Their people with yours",
    stats: [["Asking", "Diplomacy → Envoys: Request volunteers (a base, how many, how long, a purpose, an offer or a favour) or Propose a joint operation; by envoy, or at once by radio"], ["They weigh", "standing, their kind, their own headcount and trouble (a war, a horde), the danger of the purpose, what you offer, a loot share"], ["On loan", `live at the base as your own in every way: roles, beds, food and water, rounds and supplies from the stores, teams, your fights; the base may give them gear, which stays when they go; what they came with is theirs (it never comes off them, never sold) and goes home with them; home when the days are up or their group calls them back`], ["Wanting to stay", "now and then one wants to stay for good (their mood, friends among your people, the days with you, trouble at home): send their group a request (by radio or envoy: a yes costs little or nothing, a no sends them home), just let them join (they may let it pass, hold it against you, or call the rest home), or send them home"], ["A death", `costs standing: ${LOAN.DEATH.other} in your care, ${LOAN.DEATH.fight} in a fight, ${LOAN.DEATH.op} on the work they came for`], ["Joint operation", `their party waits at the rendezvous up to ${LOAN.WAIT} days past the day; your team there: they join it as volunteers (their group's orders in a fight); after, they walk home together with their loot share to a base they choose; fighting together +${LOAN.FOUGHT}`]],
    text: "A group can lend you people: they walk to your base, live there and work like your own for the days agreed, and walk home again. Or several groups can join you for one blow: a hive, a crawl, a group's base, a horde, a place to raid. Their parties are people on the map, coming and going, with food for the road: a horde or raiders on the way kill them by name, and a party that never comes is missed (the operation goes on with whoever is there). The groups propose operations to you too.",
    how: "Mark the rendezvous (⚑ on the map) and bring a team there on or after the day. Promise a share of the loot to win a reluctant group over, and pay it: spending the haul before they get their share costs standing. Keep loaned people alive: a death in your care costs much more than one in the fight they came for. Someone who wants to stay: asking their group first is the safe way; keeping them after a no is the worst.", sprite: null,
  });
  // Envoys (sim/envoys.js): opened once you know a group.
  out.push({
    key: "k:envoys", cat: "groups", name: "✉ Envoys and radio links", sub: "Word carried in person",
    stats: [["Radio link", "your station or a linked relay reaching their base (+6 tiles) and a set of their own; starting bases have none, only military bases"], ["Envoy", "at least one survivor, a vehicle if you like, the goods; food and water for there and back; no other orders"], ["Answer", "given when the envoy arrives, known when it is home"], ["Everything", "without a link every word comes and goes in person: their asks, offers, jobs, calls for your people, wars on you, peace offers and terms; yours too, and the groups' own pacts, wars and peaces between themselves"], ["Lost", `on the way there: never delivered, no refusal; on the way back: what was agreed stands, you never hear it; out of your radio coverage you hear nothing of its loss until "no word" at ${ENVOY.OVERDUE}× the trip`], ["The station", `the Radio Engineering Handbook studied, or the mid game (year ${ERA_OPEN.radio})`]],
    text: envoysHelp(),
    how: "Diplomacy → Envoys (or a group's card: Communicate…): pick the message, the goods and who goes. The Messages list shows each one travelling, awaiting return, overdue, lost or returned with its answer. Coalition members' asks without a link come by their envoys, on the map with their errand: they can be intercepted, and their death loses the ask.", sprite: null,
  });
  return out;
}

let ENTRIES = null, BY_KEY = null;
// Points of interest (sim/pois.js): how places work, and one entry a kind (data.js LOCATIONS) with its map sprite,
// opened once the player knows one on a tile seen or reported.
const likely = (def) => Object.entries(def.loot).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => (k === "food" ? "food" : k === "preserved" ? "food that keeps" : SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k)).join(", ");
function placeEntries() {
  const out = [{
    key: "k:pois", cat: "places", name: "📍 Points of interest", sub: "How places work",
    stats: [["Per tile", `up to ${POI.MAX} by the land (mountains 0–1, hills and forest 0–2, farmland 0–3, suburbs 1–4); none on water, in a city or town centre or on a hive's tile`], ["Known", "on and by roads and in the towns' and cities' footprints all but a few are known from the start; elsewhere none until a team surveys the tile"], ["Loot", "a pool of its own in each place, from what its kind holds; nothing grows back, and other groups strip them too"]],
    text: "The houses, sheds, shops and camps a tile holds besides its site: a tile's best place is drawn on the map once you know it (a site tile keeps its site), the tile panel's Places rows list the ones you know with how picked over each is, and a pip at the sprite's corner counts them. What is hidden is never counted: the panel says \"possibly more unknown\".",
    how: "Click a tile to read its Places. Send a Survey (8 hours on the tile) to find the hidden ones, a Quick look (2 hours) for a faster, rougher look. Scavenge or raid a tile to pick one of its places to search.", sprite: null,
  }, {
    key: "k:containers", cat: "places", name: "📦 Containers that stay", sub: "What a place keeps between visits",
    stats: [["Unopened", "stays unopened with what it always held, until someone loots it"], ["Opened", "kept as you left it when the raid ends: what you did not take, what you put in or swapped, what a rummage left hidden, the lock picked or forced"], ["Lost", "things dropped on the floor and loot left on bodies"], ["Ransacked", "emptied by someone else (or by your own crews' searches): it stands open and empty"]],
    text: "Each place is the same building with the same drawers, cupboards and cars on every visit, and each container holds the same things whenever it is first opened. How picked over a place is (rich, some, little, picked clean) is how many of its containers are still untouched: other groups' raids ransack them, and they can take what you left behind too. What you leave in a container never makes the place richer.",
    how: "Leave things in a container you opened on a raid to come back for them. The dialogue that picks a place shows the containers you opened, what you left there, and \"looted by others since your visit\".", sprite: null,
  }, {
    key: "k:tileheat", cat: "places", name: "🔥 Tile heat", sub: "How stirred up a tile is",
    stats: [["Rises", `going into a place (+${TILE_HEAT.ENTER}), coming out (sneaking ${7}, normal ${13}, loud ${22}, plus the shots fired), other groups' raids (+${TILE_HEAT.AI})`], ["Falls", "about 10% a day"], ["Effect", `the threat of every place on the tile (up to +${TILE_HEAT.THREAT}), more of the dead in a raid there, and when very hot a horde or a wandering band drawn by the noise`], ["Words", "cold, warm, hot, very hot"]],
    text: "A tile's heat stays after the raid: every visit to its places stirs it up a little more, and noise and gunfire most. It is not the Heat of one raid (which starts afresh each time) nor a team's Field Heat. You see it as your people last saw it: the tile panel's Tile heat row and the place dialogue say how hot it was and how long ago, stale after two weeks.",
    how: "Spread your raids over several tiles, sneak in and out, and let a hot tile cool down for a week or two before going back.", sprite: null,
  }, {
    key: "k:aipois", cat: "places", name: "🎒 Other scavengers", sub: "Who else picks the places over",
    stats: [["Who", "the other groups' scavenging parties, raiders and travellers from outside, and in hardcore the bands on the road"], ["What they know", "the places by the roads and in the towns near where they live, and what their own surveys find (8 hours on a tile, as yours)"], ["Where first", "the places on the roads near their bases go first; off-road and unknown ground stays richer for longer"], ["Same tile", "in different places nobody minds; in the same place you meet them (a group at war with you comes for you either way)"]],
    text: "The places run down without you: the groups send parties to the places they know near their bases, one place at a time, and survey tiles to find the hidden ones. They ransack containers as they go, they take what you left in a container you opened, and their raids stir a tile up. A party in a place shows on the map beside your team, and the place dialogue says when one is in it right now. The log says when a place you can see (or hear of on your radio) is picked clean, or when strangers emptied what you left.",
    how: "Do not leave things in a container near a group's base for long. Survey off the roads for the places nobody has picked over yet.", sprite: null,
  }, {
    key: "k:trademeet", cat: "places", name: "🤝 Meeting to trade", sub: "At a base, halfway, or a tile you pick",
    stats: [["Where", "one of your bases, halfway along their road to it, or any tile you pick on the map (land, no base, no hive, not where the dead are)"], ["Their caravan", `waits ${MEET.WAIT_HOURS} hours at the tile, then goes home`], ["Fee", "none: each side walks its own leg"], ["Who trades", "any team of yours on the tile, from what it carries"], ["The groups", `their convoys meet at the partner's base, or halfway when the road between them is over ${MEET.AI_FAR_HOURS} hours`]],
    text: "When you ask a group for a trade caravan, or agree a deal over the radio with We meet, you choose where. At a base the caravan trades with that base's stores for a day. At a tile in the open it waits two days, and the trade window opens when a team of yours stands on that tile; a deal agreed over the radio is filled in and honoured. A group far from your bases may call asking to meet halfway. The groups trade among themselves the same way: a convoy to a near partner's base and back with their goods, or both convoys to the middle of the road when they live far apart.",
    how: "Meet halfway when their base is far: it halves their walk, so groups that will not come all the way may still come. Send the team with your side loaded (the trade caravan planner opens aimed at the tile), and get there inside the two days.", sprite: null,
  }];
  // Windows and doors on the battle maps (sim/windows.js, sim/buildingmaps.js DOOR_KINDS; opened on the first map with one).
  out.push({
    key: "k:windows", cat: "places", name: "🪟 Windows", sub: "Open, locked, fixed or broken",
    stats: [["Check", "free, from right next to it: unlocked, locked or fixed"], ["Open or close", `${WINDOW.OPEN_AP} action, quiet; an unlocked one from either side, a locked one from the inside only; a fixed one never`], ["Break", `${WINDOW.BREAK.ap} action, loud: the raid's noise +${WINDOW.BREAK.noise}, Heat +${WINDOW.BREAK.heat}, the unaware within ${WINDOW.BREAK.radius} tiles wake`], ["Through it", `a move may vault through an open or broken one (+${VAULT.COST} tiles, winded after) or crash through a closed one (as loud as breaking it, ${WINDOW.HURT[0]}–${WINDOW.HURT[1]} cuts); on a building's map Climb window (L) from next to it, quiet when it is open`], ["Cover", "half cover at the sill in every state; shots and sight pass; a throw passes an open or broken one"]],
    text: "Every window on a battle map is unlocked, locked or fixed; houses mostly open, shop fronts and offices are mostly fixed glass, and a few stand broken already. Nobody knows which until someone tries it. The dead never open a window: they clamber through an open or broken one, and on a base's map they claw a closed one in.",
    how: "Stand next to a window (not diagonally): click it or Check window to learn it; Open window for a quiet way out (locked ones from indoors only); Break window, or vault straight through with a move, for a loud quick escape. Shut a window behind you to keep a throw out.", sprite: null,
  }, {
    key: "k:doors", cat: "places", name: "🚪 Doors", sub: "The kinds of door",
    stats: Object.values(DOOR_KINDS).filter((K) => K.diff != null || K.lock === false).map((K) => [K.name, `${K.hp} hit points · ${K.desc}${K.see ? " · seen through when shut" : ""}${K.lock === false ? " · no lock" : K.diff != null ? ` · lock difficulty ${K.diff}` : ""}${K.kick === false ? " · not kicked in" : ""}${K.force === false ? " · not forced" : ""}`]),
    text: "A building's doors come by its kind: houses have a solid front door and a screen or a patio door at the back, shops and offices glass fronts and steel fire exits, police stations, armories, gun stores and cell blocks security doors, garages roller doors, barns plain wood. The kind sets how long the dead take to batter it down, whether it is seen through when shut, how hard its lock is to pick and whether it can be kicked in.",
    how: "Hover a door to read its kind. A glass or a screen door hides nothing: close it to slow the dead, not to break their sight. Pick a glass door's lock (easy) or just break it (loud). A security door is picked or keyed, never kicked or forced: batter it down if you must.", sprite: null,
  });
  // Barricades (sim/barricade.js): furniture shoved in the way, boards and nails over a door or window, the dead crawling over half cover.
  // The pieces by name from the furniture catalogue (sim/data-furniture.js): what is shoved, what is too heavy or fixed.
  const pieceList = (keys) => keys.map((k) => CELL[k].name.toLowerCase()).join(", ");
  const shoved = Object.keys(FURNITURE).filter((k) => CELL[k]), tallOnes = shoved.filter((k) => CELL[k].cover === 2 && FURNITURE_KINDS[k]);
  const fixedOnes = Object.keys(FURNITURE_KINDS).filter((k) => FURNITURE_KINDS[k].carry === "fixed");
  out.push({
    key: "k:barricades", cat: "places", name: "🪵 Barricades", sub: "Shove furniture, board up doors and windows",
    stats: [["Shove", `${SHOVE.AP} actions alone, ${SHOVE.HELP_AP} each with a teammate right next to the piece, from right next to it: one piece one tile, pushed onto a free cell beside it (open floor, or a broken or open door's frame to plug it) or pulled onto your own cell (you step back); the full-cover pieces take two people, or a Strong back or Melee ${SHOVE.STRONG_MELEE}+; the scrape is heard ${SHOVE.RADIUS} tiles off`], ["What shoves", pieceList(shoved)], ["Two people", pieceList(tallOnes)], ["Never shoved", `${pieceList(fixedOnes)}: plumbed in, bolted down or built in`], ["Board up", `${BOARD.AP} actions and a bundle of boards and nails (crafted from 30 wood and a scrap, anywhere): nailed across a closed door, a doorway or a window from either side; ${BOARD.HP} hit points a layer, up to ${BOARD.MAX} layers, on top of a closed door's own; loud (heard ${BOARD.RADIUS} tiles off, Heat +${BOARD.HEAT} in a raid)`], ["Tear down", `${BOARD.TEAR.ap} actions from either side: the door or window back, shut; about half the bundles come off whole, the rest are splintered`], ["The vehicle", "a bundle in the team's vehicle counts from next to it"], ["The dead", `crawl over half cover (a table, a shelf, crates, a fence) at +${CRAWL.COST} tiles, a walker's whole turn; never a closed window; batter boards and a shoved tall piece (${FURNITURE.locker.hp} hit points for lockers) or go round`], ["Raiders", `vault half cover as your people do; batter boards when there is no other way in; guards and militia holding a building shove a piece into a door frame or board an outer window while nothing is in sight to shoot`], ["Their bases", "a group's base you assault starts with the windows and doors on your side boarded, as far as its wood and scrap go"]],
    text: "Furniture in a doorway or a corridor slows the dead and stops a crowd: they crawl over a table or a shelf one at a time, spending their turn on it, and a tall piece (lockers, tall shelving) they must batter down or go round. Boards nailed across a door or a window close it for good until someone batters through: no sight, no way, full cover. Everything you can do, the other side can undo: the dead claw boards down and tear through a shoved locker, raiders batter their way in.",
    how: "Before the dead arrive, shove a shelf across the doorway and board up the windows of the room you hold: each board-up is loud, so do it early. Keep boards in the pack (4 kg a bundle). Tear the boards down again when you leave, or vault out of a window.", sprite: null,
  });
  // Shoving people and the dead (sim/shoving.js).
  out.push({
    key: "k:shoving", cat: "places", name: "🫸 Shoving", sub: "Push a foe back, or flat on their back",
    stats: [["Shove foe", `${PUSH.AP} action, from right next to them with free arms (Alt+V): about ${PUSH.BASE}% to land, better for a good hand-to-hand fighter, a Strong back, a Bulldozer and a target unaware or reeling, worse on the armoured dead and on a target hunkered down (−${PUSH.HUNKER}) or bracing a door (−${PUSH.BRACE})`], ["Lands", "pushed back a tile straight away, or flat on their back; always flat when there is no room behind them, after a fall or through a window; the one standing behind may go down too"], ["Flat on their back", `no overwatch, blows at them +${PUSH.FLOOR_AIM}; getting up costs the first action of their next turn`], ["Hazards", `into the flames, acid, a spike pit, a trench or a mine they get what is there; off a walkway, roof edge or ladder they fall (${PUSH.FALL[0]}–${PUSH.FALL[1]} a level); through a window they take the glass (${PUSH.GLASS[0]}–${PUSH.GLASS[1]}) and the crash is heard`], ["Not shoved", "brutes, wall-breakers, brood mothers, dead cows, bosses, anyone in a vehicle"], ["Held by the dead", `one of the dead that lands a blow may get hold of someone (${Math.round(GRIP.CHANCE * 100)}%; not the beasts, bosses or big ones): HELD, they cannot move, run or get into a vehicle, its bites are surer (+${GRIP.AIM}) and their odds of getting away in a retreat fall (−${GRIP.ESCAPE}); shove it off or floor it, kill it, or have someone shove them out of its reach`]],
    text: "A shove is the cheapest way to make room: a foe in your face is pushed back a tile or put flat on their back, where they cannot hold overwatch and are easy to hit. The target card shows what waits behind them. Enemy people shove too: a gunman shoves the dead or a fighter off before shooting, a fighter with a blade shoves and then strikes the floored, and anyone ringed by foes shoves one aside to run. Shoving is quiet, except through glass. A shove is also how someone held by the dead breaks free.",
    how: "Stand with a hazard behind them: a trench, a fire, a mine field, the lip of the wall. A Bulldozer (a trait) shoves hardest. Keep your back to a wall and a friend behind you: the enemy's shove has the same rules.", sprite: null,
  });
  // The belt and the ears (sim/holsters.js, sim/helmets.js earGearOf; the user's requests 2026-10-21).
  out.push({
    key: "k:holsters", cat: "places", name: "🔫 Side arm, melee and Ear pro", sub: "A handgun and a blade on the belt; ear protection that works",
    stats: [["Side arm", "a handgun only (no rifle, shotgun or submachine gun): Draw side arm (Alt+P), 1 action, the main weapon slung on its back; a gun carried into the fight comes loaded from the rounds they carry"], ["Melee", `a small melee weapon, one hand, ${BELT_KG} kg or less (a knife, a hatchet, a machete, a bat, a baton): Draw melee (Alt+M), 1 action; then Melee strikes whoever is right next to them with it, silently`], ["Main weapon", "Alt+R, 1 action: the slung gun back in the hands (a drawn side arm or blade goes back on the belt). When a fight ends everyone has their main weapon back in the hands"], ["Ear pro", "the only place ear protection works: earplugs (under any helmet, a pair used up a fight), muffs, electronic defenders, a team headset (not under a full-shell helmet). In a pocket, the pack or on the head they do nothing"]],
    text: "Every survivor has a side arm slot and a melee slot on the belt, and an Ear pro slot. Nothing on the belt does anything until it is drawn: drawing takes an action, so a dry rifle in a doorway full of the dead is a turn spent pulling the pistol or the hatchet. The other side plays by the same rule: the groups' people carry side arms and blades too and draw them when their rounds run out (and their governors and quartermasters hand them out of the armory, like yours). The dead were people once: some still carry a side arm with a few rounds, a knife or a machete, a pack of whatever kept them going.",
    how: "Give everyone a pistol and a knife from the armory (Equip best does it, the governor too). In a fight, when Reload says there is nothing left, draw the side arm; with one of the dead in their face, draw the blade instead. Put earplugs or muffs in Ear pro before a gunfight: in a pocket they do nothing.", sprite: null,
  });
  // A kind with more to say than the rest: the neighbourhood is a whole street of houses on one raid map (sim/buildingmaps.js streetMap).
  const NOTES = {
    neighbourhood: {
      stat: ["Map", `a street of ${STREET.HOUSES[0]}–${STREET.HOUSES[1]} houses, two storeys each, cars along the kerb, back gardens`],
      text: "Neighbourhood: a street of houses in a suburb or a small town, raided as one place. The raid opens on the street itself: a row of houses each side of the road, every house with its own rooms, doors, stairs and containers, side yards and fenced back gardens between them, cars parked along the kerb. The ways out are both ends of the street and the back gardens. More of the dead wander a street than a lone house.",
      how: "Pick it in the list of places like any other. Go through the houses one at a time: each house keeps its own containers between visits (one you never went into stays untouched, what you leave in one stays there), and the place's one picked-over band falls as the houses are searched. Searching hour by hour (crews, the autopilot) a team goes through it a house at a time, so it lasts several times as long as a lone house.",
    },
  };
  for (const k of allPoiKinds()) {
    const d = LOCATIONS[k];
    if (!d) continue;
    const zone = SITE_ZONES[d.cat], note = NOTES[k];
    out.push({
      key: `p:${k}`, cat: "places", name: d.name, sub: `${zone ? zone.name : "Place"} · point of interest`,
      stats: [["Danger", DANGER_NAMES[siteDanger({ type: k, zone: d.cat })]], ["Likely", likely(d)], ["Gear", d.gear.length ? list(d.gear.slice(0, 4).map((g) => (GEAR[g] ? GEAR[g].name.toLowerCase() : g))) + (d.gear.length > 4 ? "…" : "") : "none"], ["Worth", d.richness >= 0.5 ? "a good haul when untouched" : d.richness >= 0.3 ? "a modest haul when untouched" : "slim pickings even untouched"], ...(note && note.stat ? [note.stat] : [])],
      text: note ? note.text : `${d.name}: a place a tile holds${d.cat === "rural" ? " out in the countryside" : d.cat === "town" ? " in a suburb or a small town" : " on a city block"}, with loot of its own.`,
      how: note ? note.how : "Scavenge or raid the tile and pick it in the list of places; the search goes through its rooms and containers. A survey shows whether it stands on a tile before you go.",
      sprite: () => poiSpriteCanvas(k),
    });
  }
  return out;
}
// Field works (sim/fieldworks.js FIELD.KINDS): opened once one stands on the map where you see it (yours, or a group's).
function fieldEntries() {
  return FIELD.ORDER.map((k) => {
    const d = FIELD.KINDS[k];
    const stats = [["Costs", Object.entries(d.cost).map(([s, n]) => `${n} ${(SUPPLIES[s] || { name: s }).name.toLowerCase()}`).join(", ")], ["Takes", `${d.hours} work-hours and the walk`], ["Condition", String(d.hp)], ["Goes", d.road ? "on a road tile" : d.terrain ? "on forest, hills or farmland" : d.game ? "where there is game" : "on the base's land"]];
    if (d.garrison) stats.push(["People", `up to ${d.garrison} a shift`]);
    if (d.capKg) stats.push(["Holds", `${d.capKg} kg`]);
    if (d.req) stats.push(["Needs", Object.entries(d.req).map(([s, n]) => `a ${SKILL_NAMES[s] || s} ${n}+ survivor there`).join(", ")]);
    return { key: `fw:${k}`, cat: "buildings", name: `${d.icon} ${d.name}`, sub: "Field work", stats, text: d.desc, how: "Plan it from a base's Field works tab and click a green tile: the builders walk out and put it up. Help: Field works.", sprite: null };
  });
}
// How food works (the base window's Food tab, ui/foodchain.js): the chain, spoilage, fires. Open from the start.
const FOOD_CHAIN_KEYS = ["k:foodchain", "k:spoilage", "k:fires"];
function foodChainEntries() {
  return [{
    key: "k:foodchain", cat: "supplies", name: "🍽️ The food chain", sub: "How food works",
    stats: [["Where", "a base's window, Food tab"], ["Record", "the last 7 days, saved with the game"], ["A day of food", "2000 kcal (one person's day)"]],
    text: "Food runs left to right: Sources (farms and harvests, hunting and snares, fishing, foraging, scavenging and teams home, trade and gifts, your other bases; and the crops ripening), Stores (days of food on hand for everyone fed there, each food room and the days until its next lot spoils), Kitchen (the cooking stations, their bills, purified water and the fire's wood), Eating (heads, eaten a day, the ration level, what kind of food, hot food) and Losses (spoiled, eaten raw, sent out with teams, into packs). It ends with how long the food lasts at this rate and the biggest drain.",
    how: "Open the Food tab when the food chip turns yellow: the verdict names the biggest drain and one or two things to do (a root cellar, cooking the meat before it turns, more people on Farm, Hunt, Fish or Forage, Lean rations).", sprite: null,
  }, {
    key: "k:spoilage", cat: "supplies", name: "🗑️ Spoilage", sub: "How food works",
    stats: [["Outside", `×${FACTOR.outside} a day, worse in heat and rain`], ["Pantry, storehouse", `×${FACTOR.dry}`], ["Root cellar", `×${FACTOR.cellar} (+${STORE.rootCellar} days of room)`], ["Cold store", "×0.15–0.9 by the season"], ["Walk-in freezer", `×${FACTOR.freezer} while powered`]],
    text: "Every food keeps its own time at room temperature (bread days, raw meat two or three, potatoes a month, cans years). Fresh food fills the base's food rooms, the food that spoils fastest in the coldest room first; what does not fit sits outside and spoils fastest. Canned, dry and preserved food needs no room. A lot whose time runs out is thrown out (a line in the log). The soonest to spoil is eaten first.",
    how: "Build a root cellar (or a storehouse, a cold store, a freezer) before the harvest, dry the surplus on drying racks, cook raw meat into meals, and do not hunt more than the base eats in a few days.", sprite: null,
  }, {
    key: "k:fires", cat: "supplies", name: "🔥 Fires and wood", sub: "How food works",
    stats: [["Camp or shelter fire", `${WOOD.fire.shelter} wood a day (half where deadfall lies about)`], ["Cook fire", `${COOK.fireWood} wood an hour it cooks (${COOK.fireHours} hours a day)`], ["Kitchen stove", `${KITCHEN.wood.stove} a day + ${KITCHEN.wood.meal} a meal served`], ["No hot food", `${EAT.coldV[0]} mood after ${EAT.cold[0]} days, ${EAT.coldV[1]} after ${EAT.cold[1]}`]],
    text: "A camp's or shelter's fire burns its wood by the hour and goes out when the woodpile runs dry: no warmth, boiled water or cooking on it until it is lit again. A cook fire burns wood while it cooks; the Kitchen's stove every day. No fire, nothing cooks: raw meat is eaten raw (food poisoning, Ate raw food −7) and after a few days without a cooked meal everyone minds it (No hot food).",
    how: "Keep a few days of wood in store (the Food tab shows the hours left), put someone on Cut wood, and light the fire again once wood comes in.", sprite: null,
  }];
}
// How people get on (sim/relations.js, sim/bonds.js, sim/bondevents.js): opened once two of yours are more than
// strangers (a pair friendly or worse than neutral).
function peopleEntries() {
  const B = BOND;
  return [{
    key: "k:bonds", cat: "people", name: "🤝 Bonds between survivors", sub: "How people get on",
    stats: [
      ["Levels", `rival ${REL.rival} or below, disliked ${B.disliked}, neutral, friendly ${B.friendly}+, friend ${REL.friend}+, close friend ${REL.close}+ (partners: Family)`],
      ["Moves it", "chemistry, temper and traits; fighting side by side, saving each other, rough trips, crews on the same job, lessons, meals and a common room together; crowding, short rations, a rival's success, someone sitting the work out, quarrels, theft"],
      ["Beside a friend", `work +${pct(B.work.friend)} (a close friend +${pct(B.work.close)}, at most +${pct(B.work.cap)}) and mood +${B.mood.friend} on the same job at a base; the load +${pct(B.crewLoad.friend)} out on a job trip together`],
      ["Beside a rival", `mood ${B.mood.rival} on the same job, ${pct(B.quarrelChance)} a day of a quarrel; the load ${pct(B.crewLoad.rival)} out together`],
      ["In a fight", `+3 aim a friend alongside (up to +6), −2 a rival; nerve +${pct(B.nerve.friend)} a friend against a scream (up to +${pct(B.nerve.max)})`],
      ["Lessons", `from a friend +${pct(B.teach.friend)} XP, a close friend +${pct(B.teach.close)}, a rival ${pct(B.teach.rival)}`],
      ["Circles", `three or more who are all friends: +${B.clique.in} mood a day; whoever there is left out ${B.clique.out}`],
      ["Loss", `a close friend grieves ${B.closeGrief} days longer; a friend walking out is grieved at half, and a deeply unhappy close friend (mood under ${B.follow.mood}) may follow them`],
      ["A promise", `to a dying friend: mood +${B.promise.mood} and work +${pct(B.work.promise)} for ${B.promise.days} days; broken, mood ${B.promise.broken} and ${B.promise.brokenMood} a day for ${B.promise.brokenDays} days`],
    ],
    text: "Every pair of your people has one opinion of each other that drifts, day by day, toward how well they fit and what they have been through together. The survivor screen's People list shows each tie with its level and the main reason for it; the Bonds card shows what those ties do for them now, and the mood breakdown lists each one with its number. People lean toward the work a friend is on and away from a rival's (within the priorities you set). At the hub, how people get on brings its own cards: a feud that comes to blows, two old enemies making up, a friend asking to work alongside, someone asking to be taught, jealousy over the leader's favour, a theft from a friend, a newcomer welcomed or shunned; and a dying friend may ask for a promise. Other groups' people keep no opinions (they are treated as fed and rested); anyone who joins you is under these rules from the first day.",
    how: "Put friends on the same job and keep rivals apart. Talk rivals round or share a meal from the survivor screen, a common room and the Kitchen's hot meals bring everyone closer, and crowding and short rations drive them apart. Welcome a newcomer before a circle shuts them out.", sprite: null,
  }];
}
export function codexEntries() {
  if (!ENTRIES) {
    ENTRIES = [...deadEntries(), ...hiveEntries(), ...itemEntries(), ...supplyEntries(), ...foodChainEntries(), ...buildingEntries(), ...fieldEntries(), ...placeEntries(), ...conditionEntries(), ...peopleEntries(), ...groupEntries(), ...weatherEntries()];
    BY_KEY = new Map(ENTRIES.map((e) => [e.key, e]));
  }
  return ENTRIES;
}
export const codexEntry = (key) => (codexEntries(), BY_KEY.get(key) || null);

// ---------- what the player has seen ----------
export function codexState(state) {
  if (!state.codex || typeof state.codex !== "object") state.codex = { seen: {}, fresh: [] };
  const c = state.codex;
  if (!c.seen || typeof c.seen !== "object") c.seen = {};
  if (!Array.isArray(c.fresh)) c.fresh = [];
  return c;
}
export const codexSeen = (state, key) => !!(state.codex && state.codex.seen && state.codex.seen[key] != null);
// Opens an entry (true when it is new).
export function codexUnlock(state, key, quiet = false) {
  const c = codexState(state);
  if (c.seen[key] != null || !codexEntry(key)) return false;
  c.seen[key] = day(state);
  if (!quiet) c.fresh.push(key);
  return true;
}

// Everything the player can see now, as codex keys.
function seenNow(state) {
  const keys = new Set(["z:walker", ...FOOD_CHAIN_KEYS]); // everyone knows the ordinary dead, and how food works
  const live = state.live || new Set();
  const known = (tile) => live.has(tile) || !!(state.knowledge && state.knowledge[tile]);
  const item = (it) => { if (it && it.key && GEAR[it.key]) keys.add(`i:${it.key}`); if (it && Array.isArray(it.contents)) it.contents.forEach(item); };
  for (const s of state.survivors || []) {
    if (!s.alive) continue;
    try { allItems(s).forEach(item); } catch { /* an odd survivor: skip */ }
    for (const c of s.conditions || []) if (c && CONDITIONS[c.key]) keys.add(`c:${c.key}`);
    if (s.woundInfected) keys.add("c:infwound");
    if (wormSeen(s)) keys.add("c:worm");
  }
  for (const b of state.bases || []) {
    (b.armory || []).forEach(item);
    for (const [k, n] of Object.entries(b.stock || {})) if (n > 0 && SUPPLIES[k]) keys.add(`s:${k}`);
    for (const x of b.buildings || []) keys.add(`b:${x.type}`);
    for (const x of b.construction || []) keys.add(`b:${x.type}`);
  }
  for (const p of state.parties || []) if (p.owner === "player" && p.cargo) (p.cargo.gear || []).forEach(item);
  for (const h of state.hordes || []) {
    if (!live.has(h.tile)) continue;
    if (h.mix) for (const k in h.mix) if (h.mix[k] > 0 && ZTYPES[k]) keys.add(`z:${k}`);
    if (h.bosses) keys.add("z:wallbreaker");
  }
  for (const fw of (state.fieldworks && state.fieldworks.list) || []) if (fw.owner === "player" || (live.has(fw.tile) && (fw.kind !== "cache" || fw.found))) keys.add(`fw:${fw.kind}`); // sim/fieldworks.js
  for (const hv of state.hives || []) if (known(hv.tile)) keys.add("h:hive");
  for (const st of state.hiveSites || []) if (known(st.tile)) keys.add("h:site");
  for (const g of state.hiveGrowths || []) if (known(g.tile) && GROWTHS[g.kind]) keys.add(`h:${g.kind}`);
  for (const f of state.factions || []) if (f.known && FACTION_TYPES[f.type]) keys.add(`g:${f.type}`);
  if (state.alliance && Array.isArray(state.alliance.members) && state.alliance.members.length) keys.add("k:coalition"); // sim/coalition.js
  if ((state.factions || []).some((f) => f.known) || (state.envoys && state.envoys.msgs.length)) keys.add("k:envoys"); // sim/envoys.js
  if (state.vols && ((state.vols.baseLoans || []).length || (state.vols.ops || []).length)) keys.add("k:loans"); // sim/loans.js
  for (const v of state.visitors || []) if (v && live.has(v.tile)) keys.add(`o:${v.kind}`);
  for (const b of (state.nomads && state.nomads.bands) || []) if (b && b.known && live.has(b.tile)) keys.add(`n:${b.tier}`); // sim/nomads.js
  // Points of interest known on a tile seen or reported (sim/pois.js: the hub's knowledge, never a hidden one).
  for (const t of state.tiles || []) if (t && Array.isArray(t.pois) && t.pois.length && known(t.id)) for (const i of knownPois(state, t)) { keys.add(`p:${poisOf(t)[i].kind}`); keys.add("k:pois"); if (poisOf(t)[i].cont && Object.keys(poisOf(t)[i].cont.mine || {}).length) keys.add("k:containers"); if (poisOf(t)[i].cont && poisOf(t)[i].cont.last) keys.add("k:aipois"); }
  if (Object.values(state.poiKnow || {}).some((k) => k && k.heat)) keys.add("k:tileheat"); // a team has seen a tile's heat (sim/pois.js noteTileHeat)
  if (Object.values(state.rel || {}).some((r) => r && (r.o >= BOND.friendly || r.o <= BOND.disliked))) keys.add("k:bonds"); // sim/bonds.js: two of yours more than strangers
  weatherSeen(state, keys);
  return keys;
}
// ---------- weather (sim/weather.js FRONT_KINDS, ICE): opened when one is on the map ----------
const FRONT_HOW = {
  storm: "Wait it out or go round: teams under it are much slower, can be hurt on the road and ambushed more; boats are riskier. It moves on in hours.",
  rain: "Off-road gets slow (vehicles most): keep to the roads while it passes.",
  blizzard: "Stay in: very slow, frostbite and falls on the road, a tile less sight. The dead are slowed too.",
  snow: "Slower going, off-road most; it passes in hours.",
  fog: "Teams, bases' lookouts and watch towers see a tile less on the map (so do the groups' parties), and teams are easier to ambush; driving is slower. It burns off by midday.",
};
function weatherEntries() {
  const out = Object.entries(FRONT_KINDS).map(([k, f]) => ({
    key: `w:${k}`, cat: "weather", name: `${WEATHER[k].icon} ${f.name}`, sub: "Weather front",
    stats: [["Size", `${f.r[0]}–${f.r[1]} tiles across its middle (a Normal map; bigger on bigger maps)`], ["Speed", `${f.speed[0]}–${f.speed[1]} tiles an hour`], ["Lasts", k === "fog" ? "8–14 hours (forms before dawn)" : `up to ${FRONT.maxLife} hours, crossing the map from an edge`]],
    text: `${WEATHER[k].desc} Only under the front: the rest of the map has the day's own sky.`, how: FRONT_HOW[k] || "", sprite: null,
  }));
  out.push({
    key: "w:ice", cat: "weather", name: "❄️ Frozen river", sub: "Winter",
    stats: [["Freezes", "after a run of freezing days in deep winter, from the north down"], ["On foot", `${ICE.walk} hours a tile; thin early and late (someone may go through)`], ["Vehicles", "never"]],
    text: "A river frozen hard enough to walk on. Your teams can cross it, and so can other groups and the dead: a river that kept a base safe is open until the thaw.",
    how: "Watch the river by your bases in winter (an alert says when it freezes): man the walls on that side. When it thaws, anyone on it scrambles ashore.", sprite: null,
  });
  // The top bar's threat forecast (sim/forecast.js, ui/threatbar.js): opened the first time it shows more than calm.
  out.push({
    key: "w:threat", cat: "weather", name: "📊 Threat forecast", sub: "The top bar",
    stats: [["Days", `${THREAT.DAYS}, today first`], ["Levels", THREAT.NAMES.join(", ")], ["The sky", "read 3 days ahead; 4 with a watchtower, 5 with a radio station"], ["Sources", "weather and fronts, hordes and their drift, raids seen or heard on the radio, food, water, wood and generator fuel, crops and the frost, the worm and illness, teams in the field, a hive due near a base"]],
    text: "The seven bars beside the Needs button: each as tall and as hot as the worst thing coming that day. Hover (or click) for the causes: what, on which day, how sure, whom it hits and where it was learned. It holds only what your people know: a horde never seen, a raid nobody saw or heard, is not on it.",
    how: "Read it each morning: a red bar days out is time to man the walls, bring food in, cut wood or call a team home. Click a cause to see it (the base, the team, the horde on the map). A watchtower, a radio station and Listen in on a group's channel see further.", sprite: null,
  });
  return out;
}
function weatherSeen(state, keys) {
  try {
    for (const f of visibleFronts(state, 0)) keys.add(`w:${f.k}`);
    if (state.weather && iceRow(state) >= 0) keys.add("w:ice");
    if (Array.isArray(state.bases) && threatForecast(state).level >= 1) keys.add("w:threat");
  } catch { /* no weather yet */ }
}

// A battle's units the player sees now (each kind once: a kind already open is not looked at again).
function battleSeen(state, out) {
  const b = state.combat;
  if (!b || !b.units) return;
  for (const t of b.units) {
    if (t.side === "player" || t.dead || t.off) continue;
    const key = t.boss ? `z:${t.boss}` : t.ztype ? `z:${t.ztype}` : t.kind === "zombie" ? "z:walker" : null;
    if (!key || codexSeen(state, key) || out.has(key)) continue;
    try { if ((t.ztype !== "crawler" || zRevealed(b, t)) && (b.over || playerSees(b, t))) out.add(key); } catch { /* a unit the sight check does not know */ }
  }
  for (const c of b.corpses || []) if (c.sleeper && (c.spotted || c.burst)) out.add("z:sleeper");
  // Windows and doors (sim/windows.js, sim/buildingmaps.js DOOR_KINDS): the entries open on the first map with one.
  if (!codexSeen(state, "k:windows") && b.cells && b.cells.some((c) => c.k === "window" || c.k === "smashed")) out.add("k:windows");
  if (!codexSeen(state, "k:doors") && b.cells && b.cells.some((c) => c.k === "idoor" || c.k === "odoor" || c.k === "door" || c.k === "bdoor")) out.add("k:doors");
  if (!codexSeen(state, "k:barricades") && b.cells && b.cells.some((c) => isBoarded(c) || (shoveable(c) && c.f === "floor"))) out.add("k:barricades"); // sim/barricade.js: the first map with furniture indoors, or boards
  if (!codexSeen(state, "k:shoving") && b.units && b.units.some((u) => u.side === "player" && u.kind === "human" && u.sid != null)) out.add("k:shoving"); // sim/shoving.js: the first battle with one of yours in it
}

// main.js refresh: opens what the player sees. The full scan once an in-game hour (or force), the battle each time.
// The first scan of a world opens what it already shows quietly; later ones flash "New in the Codex".
const scanned = new WeakMap(); // state -> the hour of its last full scan
export function codexScan(state, ui, force = false) {
  if (!state || !ui || !ui.started) return [];
  const c = codexState(state);
  const first = !Object.keys(c.seen).length;
  const keys = new Set();
  if (force || scanned.get(state) !== state.hour) { scanned.set(state, state.hour); for (const k of seenNow(state)) keys.add(k); }
  if (state.combat) battleSeen(state, keys);
  const fresh = [...keys].filter((k) => codexUnlock(state, k, first));
  if (fresh.length && !first && typeof performance !== "undefined") {
    const names = fresh.map((k) => codexEntry(k).name);
    ui.flash = { text: `New in the Codex: ${names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ")} (C).`, at: performance.now() };
  }
  return fresh;
}

// ---------- the window ----------
export function openCodex(ui, key = null) {
  const e = key ? codexEntry(key) : null;
  ui.codex = { cat: e ? e.cat : (ui.codex && ui.codex.cat) || "dead", sel: e ? key : null, q: "" };
}
const urls = new Map();
function spriteHTML(e, size = 6) {
  if (!e.sprite || typeof document === "undefined") return "";
  try {
    const cv = e.sprite();
    if (!cv) return "";
    let u = urls.get(cv);
    if (!u) { u = cv.toDataURL("image/png"); urls.set(cv, u); }
    return `<img class="sprite cxsprite" src="${u}" alt="" style="height:${size}rem">`;
  } catch { return ""; }
}

export function codexModal(state, ui) {
  const C = ui.codex || (ui.codex = { cat: "dead", sel: null, q: "" });
  const all = codexEntries();
  const cx = codexState(state);
  const fresh = new Set(cx.fresh);
  const seen = (e) => cx.seen[e.key] != null;
  const q = String(C.q || "").trim().toLowerCase();
  const tabs = CODEX_CATS.map(([k, l]) => {
    const inCat = all.filter((e) => e.cat === k);
    const n = inCat.filter(seen).length, nNew = inCat.filter((e) => fresh.has(e.key)).length;
    return `<button data-action="cx-cat" data-cat="${k}" class="${!q && C.cat === k ? "active" : ""}"${tip(`${n} of ${inCat.length} found`)}>${l} <span class="small muted">${n}/${inCat.length}</span>${nNew ? ` <span class="cxnew">${nNew} new</span>` : ""}</button>`;
  }).join("");
  const shown = q ? all.filter((e) => seen(e) && (e.name.toLowerCase().includes(q) || e.sub.toLowerCase().includes(q))) : all.filter((e) => e.cat === C.cat);
  const rows = shown.map((e) => (seen(e)
    ? `<button class="cxrow${C.sel === e.key ? " active" : ""}" data-action="cx-pick" data-key="${e.key}"><span>${esc(e.name)}${fresh.has(e.key) ? ` <span class="cxnew">new</span>` : ""}</span><span class="small muted">${esc(q ? CAT_NAME[e.cat] : e.sub)}</span></button>`
    : `<div class="cxrow locked"${tip("Not met yet: it opens the first time your people see it")}><span>???</span><span class="small muted">${esc(e.sub)}</span></div>`)).join("");
  const cur = C.sel ? codexEntry(C.sel) : null;
  const detail = cur && seen(cur) ? `<div class="cxdetail">
      <div class="cxhead">${spriteHTML(cur)}<div><h2>${esc(cur.name)}</h2><div class="small muted">${esc(cur.sub)} · ${esc(CAT_NAME[cur.cat])} · first seen on day ${cx.seen[cur.key]}</div></div></div>
      ${cur.stats.length ? `<table class="helptable cxstats">${cur.stats.map(([l, v]) => `<tr><td><b>${esc(l)}</b></td><td>${esc(v)}</td></tr>`).join("")}</table>` : ""}
      ${cur.text ? `<div class="text">${esc(cur.text)}</div>` : ""}
      ${cur.how ? `<div class="cxhow"><b>How to deal with it:</b> ${esc(cur.how)}</div>` : ""}
    </div>` : `<div class="cxdetail muted small">${shown.some(seen) ? "Pick an entry on the left." : "Nothing here yet: entries open the first time your people meet the thing."}</div>`;
  const total = all.filter(seen).length;
  return `<div class="box wide codex"><div class="spread"><h1>📚 Codex</h1><span class="small muted">${total} of ${all.length} found</span>
      <button data-action="cx-close"${tip("Close (C or Esc)")}>Close</button></div>
    <div class="row settabs cxtabs">${tabs}</div>
    <div class="cxwrap"><div class="cxlist"><input type="text" class="cxsearch" data-action="cx-q" placeholder="Find an entry (Enter)" value="${esc(C.q || "")}">${rows || `<div class="muted small">Nothing found.</div>`}</div>${detail}</div></div>`;
}

// main.js registers them: fn(state, ui, data).
export const CODEX_ACTIONS = {
  "cx-open": (state, ui, d) => { codexScan(state, ui, true); openCodex(ui, d && d.key); if (d && d.key) CODEX_ACTIONS["cx-pick"](state, ui, d); },
  "cx-close": (state, ui) => { ui.codex = null; },
  "cx-cat": (state, ui, d) => { if (!ui.codex) openCodex(ui); ui.codex.cat = d.cat; ui.codex.q = ""; },
  "cx-pick": (state, ui, d) => {
    if (!ui.codex) openCodex(ui);
    ui.codex.sel = d.key;
    const c = codexState(state);
    c.fresh = c.fresh.filter((k) => k !== d.key); // looked at: no longer new
  },
};
export const CODEX_CHANGE = {
  "cx-q": (state, ui, el) => { if (!ui.codex) openCodex(ui); ui.codex.q = String(el.value || "").slice(0, 60); },
};
// The top bar's button: 📚 Codex, with the count of entries not looked at yet.
export function codexButton(state) {
  const n = state && state.codex && Array.isArray(state.codex.fresh) ? state.codex.fresh.length : 0;
  return `<button data-action="cx-open"${tip(`Codex: the dead, items, buildings, illnesses and groups you have met (${keyLabel("win.codex") || "no key"})${n ? `. ${n} new` : ""}`)}>📚 Codex${n ? ` <span class="cxnew">${n}</span>` : ""}</button>`;
}
