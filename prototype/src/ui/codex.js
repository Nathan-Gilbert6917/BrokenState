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
import { ZTYPES, GROWTHS, TECH, HIVE, BOSS_NAMES } from "../sim/hiveconst.js";
import { GEAR, SUPPLIES, CATEGORIES, FACTION_TYPES, FACTION_COLORS, SKILL_NAMES } from "../sim/data.js";
import { BUILDINGS, RECIPES, PLOT_NAMES } from "../sim/buildings.js";
import { CONDITIONS, SICK } from "../sim/health.js";
import { WORM, wormSeen } from "../sim/worm.js";
import { bossUnit, DEFENCE } from "../sim/defences.js";
import { ZOMBIE_MOVE, playerSees } from "../sim/combat.js";
import { zRevealed } from "../sim/zombietypes.js";
import { allItems, SLOT_NAMES, ARMOR_CAP } from "../sim/inventory.js";
import { day } from "../sim/world.js";
import { zombieCanvas, armoredCanvas, enemyCanvas } from "./sprites.js";
import { ztypeBattleCanvas, bossBattleCanvas, growthCanvas, siteSpriteCanvas } from "./hivesprites.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const pct = (v) => `${Math.round(v * 100)}%`;
const x = (v) => `×${Math.round(v * 100) / 100}`;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const list = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

export const CODEX_CATS = [
  ["dead", "The dead"], ["hives", "Hives"], ["items", "Items"], ["supplies", "Supplies"], ["buildings", "Buildings"],
  ["conditions", "Illness and injury"], ["groups", "Groups and outsiders"],
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
    stats.push(["Comes from", g ? `a hive with a ${g.name} (tier ${g.tier})` : z.military ? "military sites, police stations and hordes that crossed them" : k === "swarm" ? "a Carrier or Flinger, a Sleeper bursting" : k === "sleeper" ? "the bodies lying on battle maps, more on infected ground" : "—"]);
    out.push({
      key: `z:${k}`, cat: "dead", name: z.name, sub: g ? "Special dead, bred by hives" : z.military ? "The armoured dead" : "Special dead",
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
    text: "The hive's mother: met when you storm a hive (the Destroy hive mission), among its brood.",
    how: "Bring your best shooters, armor, meds and Molotovs (they burn the hive's guard down before the assault). Thin the brood first; focus fire on her.",
    sprite: () => bossBattleCanvas("broodmother"),
  });
  return out;
}

function hiveEntries() {
  const out = [{
    key: "h:hive", cat: "hives", name: "Infestation hive", sub: "Hive",
    stats: [["Holds", `the land within ${HIVE.TERRITORY} tiles (sites there show at least 3 skulls)`], ["Ring", `${HIVE.RING} tile of red-skull ground: much tougher dead`], ["Infection", `radiates out to ${HIVE.RADIATE} tiles`], ["Attacks", `your bases from up to ${HIVE.ATTACK_RANGE} tiles`]],
    text: "A red, glowing mound where the dead gather. It gains resources every day (more with other hives near) and spends them on hordes, Wallbreakers and growths; its hordes attack bases and its growths let it breed special dead.",
    how: "Destroy it with the Destroy hive mission (a hard battle against its brood and the Broodmother): Molotovs carried by the team burn its guard down first. Burning its growths weakens it until you can.",
    sprite: null,
  }, {
    key: "h:site", cat: "hives", name: "Hive being built", sub: "Hive",
    stats: [["Stands", `when ${HIVE.SITE_BIOMASS.toLocaleString("en-US")} of the dead have gone into it, at most ${HIVE.SITE_INTAKE} a day`]],
    text: "A raw mound of bones: hordes gather at a spot the hives picked, and once enough have come it starts turning into a new hive.",
    how: "Strike while it is a build site: break the hordes gathering there before it stands (about four weeks from the first gathering).",
    sprite: () => siteSpriteCanvas(true),
  }];
  for (const [k, g] of Object.entries(GROWTHS)) {
    const stats = [["Tier", g.tier], ["Costs the hive", `${g.cost} resources, ${g.days} days`]];
    if (g.unlocks && ZTYPES[g.unlocks]) stats.push(["Breeds", ZTYPES[g.unlocks].name]);
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
  melee: "Hold it in the Hands slot and use Melee (E) next to an enemy: silent and needs no ammo.",
  pistol: "Hands slot: Shoot (F) costs ammo and makes noise (it draws the dead, and Heat in a raid). Fits a pocket.",
  shotgun: "Hands slot: Shoot (F) costs ammo, hits hard up close, poorly at range, and is loud. Buckshot catches a worm swarm.",
  rifle: "Hands slot: Shoot (F) costs ammo; the long-range gun, and loud. Rifle rounds get through the armoured dead.",
  automatic: "Hands slot: Shoot (F) fires two rounds a shot: the best gun there is, hungry for ammo.",
  bow: "Hands slot: silent shots that need no ammo.",
  explosive: "From a pocket or the pack: Throw (G) in battle. Thrown, it is gone. Kept in a base's armory, some of them work as decoys when a horde comes.",
  gunmod: "Carried by whoever has a gun it fits: works from the pack or a pocket.",
  armor: `Worn (Body, Head, Arms, Legs): the power of every worn piece adds up, to at most ${ARMOR_CAP}. Heavy armor counts in the wearer's load.`,
  defence: "Kept in a base's armory: used on the approach when a horde attacks the base.",
  medical: "Kept on a medic or in the armory: used when treating people (at a base, in the field or in battle).",
  electronics: "In the Off hand, or kept in a base's armory: see its description.",
  packs: "Worn on the Backpack slot: more pack slots and a higher load.",
  tools: "In the Off hand or the pack: see its description for where it helps.",
  optics: "Carried by anyone on a team: the team sees further (see its description).",
  camp: "Carried by a team: it helps where the team camps.",
  books: "Read at a base: it teaches its skill up to the level it names (or lifts the mood).",
  manuals: "Studied at a base: it opens buildings or recipes that need it.",
  luxury: "Read or used at a base for mood; also a trade good.",
  vehicle: "Team cargo: brought home, it joins the base's vehicles.",
};
const TRADE_HOW = "A trade good: groups pay for it by their kind (raiders love liquor and drugs; zealots will not touch them). Use it at a base for mood, or sell it.";
function itemEntries() {
  const out = [];
  for (const [k, g] of Object.entries(GEAR)) {
    const cat = CATEGORIES[g.cat];
    const stats = [["Kind", cat ? cap(cat.name) : "—"], ["Slot", SLOT_NAMES[g.slot] || (g.slot === "pack" ? "Pocket or pack" : g.slot === "cargo" ? "Team cargo" : g.slot)]];
    if (g.power && ["weapon", "armor", "head", "arms", "legs"].includes(g.slot)) stats.push([g.slot === "weapon" ? "Power" : "Armor", g.power]);
    if (g.req) stats.push(["Needs", `${SKILL_NAMES[g.skill] || g.skill} ${g.req} for full effect`]);
    if (g.noise) stats.push(["Noise", g.noise]);
    if (g.medKit) stats.push(["Medicine", `+${g.medKit} when treating`]);
    if (g.slots) stats.push(["Pack", `${g.slots} slots, +${g.carry || 0} kg load`]);
    if (g.makeshift && g.dur) stats.push([g.tabs ? "Tablets" : "Lasts", g.tabs ? g.dur : `${g.dur} uses (makeshift)`]);
    else if (g.tabs) stats.push(["Tablets", g.dur]);
    stats.push(["Weight", `${g.weight} kg${g.small ? ", fits a pocket" : g.bulky ? ", bulky" : ""}`]);
    out.push({ key: `i:${k}`, cat: "items", name: g.name, sub: cat ? cap(cat.name) : "Item", stats, text: g.desc, how: ITEM_HOW[g.cat] || TRADE_HOW, sprite: null });
  }
  return out;
}
const SUPPLY_HOW = {
  food: "Everyone eats a ration a day. Fresh food needs storage room or it spoils: preserve the surplus, grow and store enough for the winter.",
  water: "Safe to drink. Everyone drinks about 1 a day (more in summer, a hot day 1.6+). Keep the tanks full before summer.",
  rawwater: "Purify it (the water boiler, water filters, a camp fire, tablets) before drinking: drunk as it is, it can carry the worm's eggs.",
  fuel: "Vehicles burn it, generators and floodlights use it; it heats a base in winter after the firewood.",
  meds: "Treat wounds and illnesses (a dose each). Rare: keep a reserve, and a med station makes more.",
  ammo: "Every gunshot costs it (an assault rifle two). An ammo bench makes more from scrap.",
  arrows: "Bows and crossbows lose some when they hunt (in a fight they are picked up again). Made by hand from firewood and a little scrap; found at hunting lodges, gun stores, sports shops and campgrounds.",
  parts: "Buildings, vehicle repairs and gear need them. A machine shop makes them from scrap.",
  scrap: "What almost everything is built and crafted from. Scavenging brings it in.",
  preserved: "Eaten after the fresh food; barely spoils, needs no cellar, lighter on a trip and sells well.",
  jars: "The preserving kitchen fills them; most come back when the food in them is eaten.",
  wood: "Heats a base in winter before fuel, boils the water, fires camp fires. Anyone with an axe can cut it.",
};
function supplyEntries() {
  return Object.entries(SUPPLIES).map(([k, v]) => ({
    key: `s:${k}`, cat: "supplies", name: v.name, sub: "Supply",
    stats: [["Kind", cap((CATEGORIES[v.cat] || { name: v.cat }).name)], ["Weight", `${v.weight} kg a unit`]],
    text: "", how: SUPPLY_HOW[k] || "", sprite: null,
  }));
}
function buildingEntries() {
  return Object.entries(BUILDINGS).map(([k, b]) => {
    const stats = [["Costs", Object.entries(b.cost).map(([s, n]) => `${n} ${(SUPPLIES[s] || { name: s }).name.toLowerCase()}`).join(", ")], ["Takes", `${b.hours} hours of building`], ["At most", `${b.max} a base`]];
    if (b.plot) stats.push(["Stands on", `a ${PLOT_NAMES[b.plot].toLowerCase()}`]);
    if (b.req) stats.push(["Needs", Object.entries(b.req).map(([s, n]) => `a ${SKILL_NAMES[s] || s} ${n}+ survivor there`).join(", ")]);
    if (b.upgrades) stats.push(["Upgrades", BUILDINGS[b.upgrades].name]);
    if (b.station && RECIPES[b.station]) stats.push(["Makes", RECIPES[b.station].desc]);
    if (b.outpostOnly) stats.push(["Only at", "outposts"]);
    if (b.shelterOnly) stats.push(["Only at", "a shelter"]);
    return {
      key: `b:${k}`, cat: "buildings", name: b.name, sub: b.defence ? "Defence" : b.station ? "Workshop station" : b.family ? "Hospital" : "Building", stats, text: b.desc,
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
  stomach: "It passes in a few days; 1 meds ends it at once if you want. Purified water and cooked food prevent it.",
  pneumonia: "It kills without meds: treat it at once and get them into a hospital bed. They cannot work until it clears.",
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
      ["Healing", `${pct(WORM.HEAL)} of the usual while it is in them`], ["Cures", `a dewormer (sure) or a purge (${WORM.PURGE_MEDS} meds) in the gut; then only surgery (${WORM.SURGERY_MEDS} meds, a Clinic or better)`]],
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
    stats: [["Guards", "3–5 at first, up to 7"], ["Carries", "fuel, meds, preserved food, parts, ammo, manuals, books and good gear"]],
    text: "Traders from another state, walking the roads with wagons. They visit the groups' bases and, when invited over the radio (or by chance), yours: the trade window opens for a day.",
    how: "Invite them over the radio when they call. They want food, water, scrap and jars. Attack one and every merchant hears of it.",
    sprite: () => enemyCanvas("raiders", "#d9a520", null, null, 4),
  }, {
    key: "o:explorers", cat: "groups", name: "Travellers", sub: "Outsiders",
    stats: [["Kinds", "scouts, refugees, wanderers"], ["Robbers", `${pct(0.08)} of them are robbers in disguise`]],
    text: "Scouts, refugees or wanderers crossing the state. They search ruins along the way and often come to your gate.",
    how: "Hear their news (free), buy the scouts' maps, trade, shelter them for a few days or take them in. Keep an eye out: a few rob the base that shelters them.",
    sprite: () => enemyCanvas("raiders", "#9a9a9a", null, null, 2),
  });
  return out;
}

let ENTRIES = null, BY_KEY = null;
export function codexEntries() {
  if (!ENTRIES) {
    ENTRIES = [...deadEntries(), ...hiveEntries(), ...itemEntries(), ...supplyEntries(), ...buildingEntries(), ...conditionEntries(), ...groupEntries()];
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
  const keys = new Set(["z:walker"]); // everyone knows the ordinary dead
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
  for (const hv of state.hives || []) if (known(hv.tile)) keys.add("h:hive");
  for (const st of state.hiveSites || []) if (known(st.tile)) keys.add("h:site");
  for (const g of state.hiveGrowths || []) if (known(g.tile) && GROWTHS[g.kind]) keys.add(`h:${g.kind}`);
  for (const f of state.factions || []) if (f.known && FACTION_TYPES[f.type]) keys.add(`g:${f.type}`);
  for (const v of state.visitors || []) if (v && live.has(v.tile)) keys.add(`o:${v.kind}`);
  return keys;
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
  return `<button data-action="cx-open"${tip(`Codex: the dead, items, buildings, illnesses and groups you have met (C)${n ? `. ${n} new` : ""}`)}>📚 Codex${n ? ` <span class="cxnew">${n}</span>` : ""}</button>`;
}
