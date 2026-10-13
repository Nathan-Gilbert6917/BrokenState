// City crawl: a team that goes into a city (or a town) to scavenge does not get one raid but works its way in block by
// block, like a roguelike extraction. The city is a round grid of blocks (citygrid.js: 15-30 across, a town 9-12); you
// come in on its rim on the side facing where you came from and from each block go left, right or straight on. Each
// block is a card: what the team sees from the street (two to four places, each a building with its own interior map,
// buildingmaps.js) and up to two street events, its zombie activity (CRAWL.THREAT) and the heat you have left there
// (CRAWL.TRAIL). Blocks deeper in toward the centre are more dangerous and richer (their level, 1-8). A block too hot
// to stay on can be slipped away from before you are seen (slipAway). The city's Alert grows with your noise and with
// every hour you stay. Getting out is the gamble: back along the path you came in by (through the heat you left), or
// straight on in one direction to the rim; from any block on the rim you walk out.
//
// The state is plain data on the team (p.crawl), so a game can be saved on a block card or inside a building:
//   { tile, city, visit, grid { size, r }, cell, heading, path, block (the level), deepest, alert, blocks: { cell: {
//     places, events, threat } }, buildings: { placeId: snapshot }, trail: { cell: heat }, enc, leaving ({ way, cells }),
//     inside, tally, log }
// The site remembers between crawls (tile.crawlMem): visits, how picked over each place is, the buildings as you left
// them, the blocks you have been to (the map), and what other groups took (aiscav.js: blocks near the rim picked over).
//
// Hooks elsewhere (small): scavenge.js startScavenge (a city or town tile: in the browser, or on autopilot →
// startCrawl), combat.js (finishCombat hands the battle to the handler; setup.raid.areas: a street map's areas; b.raid.deep:
// deeploot.js), buildingmaps.js raidBuilding (setup.raid.place), conflicts.js engagedWith ("crawl" holds the team),
// autopilot.js idleTeams (crawlAutoStep every hour), aiscav.js (mem.aiLoot), main.js / ui.js (the crawl window and
// its map, ui/citycrawl.js).
import { typeFind } from "./foods.js"; // a crawl's food finds as items
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { Rng } from "./rng.js";
import { hash01, gainXpAll, USE } from "./skills.js";
import { GEAR, SUPPLIES, supWeight } from "./data.js";
import { log, hurt, isNight, tickHour, day } from "./world.js";
import {
  partyMembers, partyTile, bestSkill, cargoRoom, unitsThatFit, carryCapacity, poolLoad, wipeParty, awaitOrders, tileLabel, teamName, giveOrder,
} from "./parties.js";
import { registerCombatHandler, createBattle, startCombat, autoResolveCombat, finishCombat, byNumbersOdds, AREAS, floodReach, say, setFloor, makeLosCache } from "./combat.js";
import { BUILDINGS, buildingHint, buildingSpec } from "./buildingmaps.js";
import { raidEnemies } from "./scavenge.js";
import { applyZType, battleTypes, eraKinds } from "./zombietypes.js";
import { eraTier } from "./hivetech.js";
import { ZTYPES } from "./hiveconst.js";
import { MILDEAD, siteDeadMix, maxMix } from "./deadsoldiers.js";
import { lootItem, itemLoad } from "./inventory.js";
import { areaSource, spend } from "./itemcond.js"; // the condition of what is found
import { rollAreaFind } from "./loot.js";
import { findCarried } from "./stealth.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { searchHazards } from "./health.js";
import { wormSearch } from "./worm.js"; // the worm: hands that handled the dead
import { FOLK, rollFolk, placeFolk, folkHint, noteFolk, folkAfterPlace } from "./floorfolk.js"; // who holds the upper floors (docs/multi-storey-crawl.md phase 3)
import { noteSearch } from "./relations.js";
import { factionById } from "./world.js";
import { changeGoodwill } from "./factions.js";
import { sortFind } from "./ammo.js"; // rounds by calibre
import { swapGun, areaSourceName } from "./gundist.js"; // the gun distribution: which gun a room or a sentry yields
import { crawlGuns } from "./gunfinds.js";
import { deepShift, cacheChance, isFine, valuePerKg, wantOf, DEEP } from "./deeploot.js"; // deeper blocks hold what is dear by the kilo; a full team swaps
import { itemValue } from "./valuation.js";
import { atBase } from "./world.js";
import { gridOf, inGrid, isEdge, levelOf, ringOf, maxLevel, entryOf, turn, lineOut, keyOf, xyOf, DIRS, DIR_NAMES, cellsOf } from "./citygrid.js"; // the round grid of blocks (2026-10-13) // a gun counter's or an armoury's extra gun (its own dice)

// ---------- tuning ----------
export const CRAWL = {
  MAX_BLOCK: 8,                 // the heart of the city: no block beyond this one
  PLACES: [2, 4],               // places on a block (2–3 at the edge; a fourth more likely deeper)
  EVENTS: { none: 0.3, two: 0.25, perBlock: 0.04 }, // a block's street events: none, one or two (two likelier deeper)
  BLOCKED: 0.12,                // a place shut this visit (fire, a collapse, the doors chained), by the visit's dice
  MOVE_HOURS: 1,                // walking to the next block
  LIE_LOW_HOURS: 1,             // waiting quietly on a block (Alert fades)
  EXIT_HOURS: 0.5,              // walking back out, a block
  // The dead in a building: the site's count (scavenge.js raidEnemies) × (base + perBlock × (block − 1)) × the place's own
  // factor; their power + powerPerBlock a block. Indoors buildingmaps.js scales them down again with the map's area.
  DEAD: { base: 0.7, perBlock: 0.25, powerPerBlock: 0.4 },
  // Raiders holed up in a place (guards in a room): from block `from`, chance + perBlock a block deeper.
  RAIDERS: { from: 2, chance: 0.08, perBlock: 0.06, max: 0.45, count: [2, 3], power: 3.5, powerPerBlock: 0.35 },
  // The special dead (zombietypes.js) among the dead in buildings and on the street: from block `from`, a share of
  // each one: chance + perBlock a block deeper + late × the game's year (112 days) gone, at most max.
  SPECIAL: { from: 3, chance: 0.06, perBlock: 0.05, late: 0.1, max: 0.45, types: ["runner", "runner", "spitter", "brute", "screamer"] },
  // A building's richness (combat.js searchBox: chance, amount and gear of what a container holds): base + a share of the
  // site's own loot, × (1 + perBlock × (block − 1)) × the place's factor × (1 − looted × picked over), clamped.
  RICH: { base: 0.55, site: 0.45, perBlock: 0.25, max: 1.8, min: 0.3, looted: 0.85 },
  SPAWN_PER_BLOCK: 2,           // more of the dead the Heat can bring in, a block deeper (combat.js spawnCap 12)
  INFECT_PER_BLOCK: 0.05,       // the raid's infection (Heat per turn, the power of the dead that come in) a block deeper
  // Alert 0–100: start (+ the city's infection × infection), + a building's Heat gained × fromHeat when you come out,
  // + fight / mapFight for a fight on the street, + move for walking a block, − decay an hour (not below the start).
  // creep (2026-10-13): the Alert no longer fades by itself while you are in the city; it rises creep an hour (the
  // dead drift toward where the living are), so the longer a crawl the more trouble on the street. Lie low to bring it down.
  ALERT: { start: 5, infection: 15, fromHeat: 0.3, fight: 8, mapFight: 5, move: 3, alarm: 12, decay: 2, creep: 1.5, lieLow: 12, turned: 6, names: ["Calm", "Uneasy", "Stirred", "Roused", "Swarming"] },
  // The Heat you start each building with: day / night + perBlock a block deeper + the Alert above the city's own
  // (its start) × fromAlert, at most max.
  HEAT0: { day: 5, night: 0, perBlock: 2, fromAlert: 0.35, max: 50 },
  // Trouble on the way to the next block: base + perBlock × (block reached − 1) + Alert × perAlert, × night, at most max.
  ENC: { base: 0.06, perBlock: 0.05, perAlert: 0.004, night: 1.25, max: 0.85, raiders: 0.15, raidersPerBlock: 0.05 },
  // The way out: one roll a block from where you are back to block 2 (block 1 is the city's edge): base + perBlock ×
  // (block − 1) + Alert × perAlert + overload × load, × night. At Alert fightAlert or more from block fightFrom or deeper
  // the streets are crawling: the first block on the way out is a fight (or a hard sneak).
  EXIT: { base: 0.03, perBlock: 0.07, perAlert: 0.004, load: 0.25, night: 1.2, max: 0.9, fightAlert: 70, fightFrom: 3 },
  // The trail (2026-10-13): the noise made on a block (whatever raises the Alert there: fights and shots, searches,
  // alarms, walking in) stays on that block's streets as its own heat, × (1 + perPerson for each of the team over 3),
  // × stealthy for a team travelling stealthily; it fades decay an hour. Going back the way you came, each block's
  // risk is + its trail × perTrail.
  TRAIL: { perPerson: 0.15, stealthy: 0.6, decay: 0.5, perTrail: 0.006 },
  // Slipping away from a block you have just come into (slipAway): Stealth + d10 against dc + activity level ×
  // perThreat + its heat / perHeat; hours.
  SLIP: { dc: 4, perThreat: 1.2, perHeat: 15, hours: 1 },
  // On the round grid a level is LEVEL_RINGS rings, so a walk in or out crosses about twice the blocks the old line of
  // blocks did: the chance of trouble walking into a block (ENC) and on each block of the way out (EXIT) × step.
  GRIDSTEP: { step: 0.4 },
  // Zombie activity (2026-10-13): each block of a city has its own level, 1-5, by the city's dice (the same every
  // visit; known once you stand on it): how many of the dead move on its streets. Its mult scales the block's own
  // danger and multiplies the heat there (the city's Alert and the block's trail): a little noise on a crawling block
  // is worse than a lot on a quiet one. Levels by weight; the new streets of another way out roll their own.
  THREAT: { names: ["", "Quiet", "Stirring", "Busy", "Infested", "Crawling"], mult: [0, 0.6, 0.8, 1, 1.35, 1.8], weights: [0, 0.2, 0.25, 0.25, 0.18, 0.12] },
  // Street fights: a horde of base + perBlock × block + Alert / alertDiv dead (power 2 + infection × 3 + DEAD.powerPerBlock
  // a block deeper); a patrol of raiders 2 + block / 2 (power 4 + 0.3 a block). A breakout is a horde × breakout.
  HORDE: { base: 3, perBlock: 1.5, alertDiv: 12, max: 20, breakout: 1.5 },
  PATROL: { base: 2, power: 4, powerPerBlock: 0.3, max: 8 },
  // Hiding from it: best Stealth + d10 against dc + perBlock × block + Alert × perAlert (+ night, + load × overload,
  // + big a person over three); lures: a noise maker, firecrackers or a bottle pull it away (their odds).
  HIDE: { dc: 8, perBlock: 1, perAlert: 0.06, night: -2, load: 3, big: 1, spottedDc: 4 },
  LURE: { noisemaker: 0.9, firecracker: 0.85, bottle: 0.7 },
  // Running from it: always away, but each person is hurt at hurt + perBlock × block (+ load × overload, + patrol: they
  // shoot), for dmg + dmgPerBlock × block.
  RUN: { hurt: 0.2, perBlock: 0.06, load: 0.3, patrol: 0.1, max: 0.9, dmg: [10, 25], dmgPerBlock: 3 },
  // Searching a place by the numbers (no map; the autopilot's crawl too): hours, the chance of a fight, rolls of loot.
  // (Fewer finds than playing the building's map, which is where the rewards are.)
  QUICK: { hours: 2, fight: 0.22, perBlock: 0.07, rolls: 3, rollsPerBlock: 0.75, looted: 0.5, alert: 4 }, // rollsPerBlock: more rolls a block deeper
  // The autopilot's crawl: how deep (depth), when it leaves (hurt, full), when it fights (sureOdds, fightOdds), what it
  // searches (searchOdds: the odds of the fight a search could bring, searchOdds below; 2026-10-13: was a place's
  // look, at most "A few of the dead about", which no place deeper than block 3 is, so it walked deep and searched
  // nothing). It goes on down to depth while the block it stands on had something it could search.
  AUTO: { depth: 4, hurt: 50, full: 0.85, sureOdds: 0.92, fightOdds: 0.8, searchOdds: 0.85, planOdds: 0.9, planShare: 0.67, blocks: 6, slipThreat: 5, slipHeat: 60 },
};

// Places a block can hold (buildingmaps.js BUILDINGS keys): weight at the edge + deep a block deeper (from block `from`),
// rich and dead × the building's richness and its dead, rare: shown as a find on the card.
export const PLACE_POOL = {
  grocery:     { w: 3,   deep: 0,     from: 1, rich: 1,    dead: 1 },
  corner:      { w: 3,   deep: -0.35, from: 1, rich: 0.8,  dead: 0.8 },
  pharmacy:    { w: 2,   deep: 0.15,  from: 1, rich: 1.1,  dead: 1 },
  apartments:  { w: 3,   deep: 0,     from: 1, rich: 0.9,  dead: 1.2 },
  offices:     { w: 2,   deep: 0.1,   from: 1, rich: 0.8,  dead: 1 },
  warehouse:   { w: 2,   deep: 0,     from: 1, rich: 1,    dead: 0.9 },
  hardware:    { w: 2,   deep: 0.1,   from: 1, rich: 1,    dead: 0.9 },
  autoshop:    { w: 2,   deep: -0.1,  from: 1, rich: 0.9,  dead: 0.8 },
  diner:       { w: 1.5, deep: -0.15, from: 1, rich: 0.9,  dead: 0.9 },
  motel:       { w: 1.5, deep: -0.1,  from: 1, rich: 0.9,  dead: 1 },
  church:      { w: 1,   deep: 0,     from: 1, rich: 0.9,  dead: 1.4 },
  school:      { w: 0.8, deep: 0.15,  from: 2, rich: 0.9,  dead: 1.4 },
  clinic:      { w: 0.8, deep: 0.25,  from: 2, rich: 1.1,  dead: 1.2 },
  firestation: { w: 0.6, deep: 0.2,   from: 2, rich: 1.1,  dead: 1 },
  supermarket: { w: 0.6, deep: 0.3,   from: 2, rich: 1.2,  dead: 1.3 },
  gunstore:    { w: 0.25, deep: 0.35, from: 2, rich: 1.2,  dead: 1,   rare: true },
  police:      { w: 0.15, deep: 0.35, from: 3, rich: 1.2,  dead: 1.3, rare: true },
  hospital:    { w: 0.1, deep: 0.35,  from: 3, rich: 1.25, dead: 1.6, rare: true },
  deptstore:   { w: 0.15, deep: 0.2,  from: 3, rich: 1.15, dead: 1.4 },
};
const STREETS = ["Front Street", "Main Street", "Oak Avenue", "3rd Street", "Market Street", "Elm Street", "Station Road", "Church Street", "Mill Lane", "Park Avenue",
  "Water Street", "5th Avenue", "Union Street", "King Street", "Bridge Street", "Center Street", "Maple Street", "Broad Street", "Pine Street", "Grand Avenue",
  "Court Street", "Liberty Avenue", "Canal Street", "8th Street", "Commerce Street", "Harbor Road", "Spring Street", "Walnut Street", "Bank Street", "Federal Plaza"];
const DEPTHS = ["", "The city's edge", "Outer streets", "Inner streets", "Downtown", "Deep downtown", "The heart of the city", "The heart of the city", "The heart of the city"];
const BLOCK_TEXT = [
  "",
  "Shopfronts and a bus stop; cars left where they stopped. You can still see the way you came in.",
  "Taller buildings close in. Barricades nobody finished, windows boarded from the inside.",
  "Glass underfoot, burned-out cars nose to tail. The dead move between the buildings.",
  "Towers and the silence of a downtown that emptied in a day. The dead are everywhere.",
  "The heart of the outbreak's first days: barricades, abandoned checkpoints, too many of the dead.",
];

// ---------- street events ----------
// key: { title, text, min (block), w (weight), deep (weight a block deeper), choices: [{ id, label, tip }] }. Each
// event's choices are resolved in resolveEvent; anything that turns into a fight becomes an encounter (c.enc).
export const EVENTS = {
  car: { title: "An abandoned car", min: 1, w: 3, deep: 0, text: "A sedan sits with its doors open in the middle of the street. Keys in the ignition, no driver.",
    choices: [{ id: "search", label: "Search it", tip: "A few minutes. Glovebox, trunk, seats. Some cars still have an alarm (15%)." }, { id: "leave", label: "Leave it" }] },
  ambulance: { title: "A crashed ambulance", min: 1, w: 2, deep: 0.1, text: "An ambulance lies on its side against a shopfront, back doors hanging open. Something moves inside.",
    choices: [{ id: "map", label: "Search it (street map)", tip: "Search the wreck and the cars around it on a small street map." }, { id: "grab", label: "Grab what you can", tip: "Quick, by the numbers: medical supplies, and maybe a bite from whatever is strapped in the back." }, { id: "leave", label: "Leave it" }] },
  checkpoint: { title: "A barricaded checkpoint", min: 2, w: 1.5, deep: 0.25, text: "Sandbags and wire across the road, a guard shack, an army truck. The soldiers who held it are still here, some of them still moving.",
    choices: [{ id: "map", label: "Search the checkpoint (street map)", tip: "The shack, the truck and the sandbags on a small street map: ammunition, maybe armor and rifles. The dead in uniform are tougher." }, { id: "grab", label: "Pick through the sandbags", tip: "Quick, by the numbers: ammunition and a chance of gear; the dead soldiers may rise." }, { id: "leave", label: "Leave it" }] },
  survivor: { title: "Someone calls from a window", min: 1, w: 1.5, deep: 0, text: "A voice from a second-floor window: \"Hey! Down there! Please!\"",
    choices: [{ id: "help", label: "Go up to them", tip: "Most are what they seem: someone to take in, or someone who knows these streets. Some are bait." }, { id: "hush", label: "Signal them to be quiet", tip: "They might stop shouting. They might not." }, { id: "ignore", label: "Ignore them", tip: "They will keep calling for a while (Alert +4)." }] },
  horde: { title: "A horde passing through", min: 1, w: 1, deep: 0.35, text: "A slow river of the dead fills the cross street, heading your way.",
    choices: [{ id: "face", label: "Deal with it", tip: "Hide, lure it away, run or fight." }, { id: "wait", label: "Get off the street and wait", tip: "Two hours in a doorway; it moves on, most of the time." }] },
  smoke: { title: "Smoke from a looted store", min: 1, w: 1.5, deep: 0.1, text: "Smoke curls from a smashed shopfront. Whoever looted it left in a hurry, or did not leave.",
    choices: [{ id: "check", label: "Check it out", tip: "Leftovers, likely. Raiders still inside, maybe. The fire could spread." }, { id: "leave", label: "Leave it" }] },
  lookout: { title: "A raider lookout", min: 2, w: 1, deep: 0.2, text: "A figure with a rifle on a rooftop across the street, watching the road. Raiders hold something nearby.",
    choices: [{ id: "sneak", label: "Sneak past", tip: "Stealth: slip by below the lookout's line of sight." }, { id: "take", label: "Take him down quietly", tip: "Get up there and silence him: his gun and ammunition, and the raiders on this block lose their eyes (no raiders holed up in its places)." }, { id: "around", label: "Go another way", tip: "An hour around the long way." }] },
  truck: { title: "A stuck delivery truck", min: 1, w: 1.5, deep: 0, text: "A box truck wedged between two cars, its tank intact, its back roller door padlocked.",
    choices: [{ id: "siphon", label: "Siphon the fuel", tip: "An hour with a hose and a can: fuel. Clanking around makes some noise." }, { id: "break", label: "Break into the back", tip: "Crates of food and water, maybe. Maybe something else got in first." }, { id: "leave", label: "Leave it" }] },
  body: { title: "A body with a pack", min: 1, w: 2, deep: 0, text: "Someone lies face down by a hydrant, a full pack still on their back.",
    choices: [{ id: "take", label: "Take the pack", tip: "What they carried. Check that they are really dead." }, { id: "leave", label: "Leave it" }] },
  rooftop: { title: "A supply drop on a rooftop", min: 4, w: 1.2, deep: 0.2, text: "A parachute hangs from a rooftop aerial, a cargo pallet still strapped beneath it.",
    choices: [{ id: "climb", label: "Climb up for it", tip: "An hour up the fire escapes: food, water, medicine, ammunition and gear. A fall can hurt someone badly." }, { id: "leave", label: "Leave it" }] },
  rubble: { title: "A collapsed street", min: 3, w: 1, deep: 0.1, blocking: true, text: "A building front has come down across the road. The way deeper is buried under brick and steel.",
    choices: [{ id: "clear", label: "Clear a way through", tip: "An hour of shifting rubble. Noisy (Alert +6)." }, { id: "detour", label: "Find a way around", tip: "Two hours through back alleys. Quiet." }] },
};

// ---------- helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seedOf = (...parts) => Math.floor(hash01(...parts) * 4294967296);
const sumObj = (o) => Object.values(o || {}).reduce((a, v) => a + (v > 0 ? v : 0), 0);
export const crawlTile = (t) => !!t && ((t.loc && (t.loc.type === "city" || t.loc.type === "town")) || (!t.loc && t.terrain === "city")); // towns too (2026-10-13: a smaller grid)
export const alertName = (a) => CRAWL.ALERT.names[clamp(Math.floor(a / 20), 0, 4)];
const partyById = (state, id) => state.parties.find((x) => x.id === id) || null;
// The site's memory between crawls: visits, how picked over each place is (looted), the buildings as you left them
// (snaps), the blocks you have been to (cells: their activity level, the day), loot other groups took (aiLoot: aiscav.js).
const memOf = (t) => { const m = (t.crawlMem = t.crawlMem || { visits: 0, looted: {}, alert: 0, hour: 0 }); m.snaps = m.snaps || {}; m.cells = m.cells || {}; return m; };
export const crawlMemOf = memOf;
const yearGone = (state) => Math.min(2, day(state) / 112);

// The team's crawl, checked: a team that is gone, dead or no longer on the city's tile loses it.
export function crawlOf(state, p) {
  if (!p || !p.crawl) return null;
  if (!state.parties.includes(p) || !partyMembers(state, p).length || partyTile(p) !== p.crawl.tile) { delete p.crawl; return null; }
  if (p.phase !== "engaged") p.phase = "engaged"; // something else let the team go meanwhile (a card's answer): it is still in the city
  if (!p.crawl.grid) toGrid(state, p, p.crawl); // a save from before the round grid (2026-10-13)
  return p.crawl;
}
// A crawl saved on the old line of blocks: on the rim of the city's grid (where it would come in), what it found and
// carries kept, the Alert as it was; an encounter or a way out under way is dropped (you are at the edge).
function toGrid(state, p, c) {
  const t = state.tiles[c.tile];
  const g = gridOf(state, t);
  const ent = entryOf(g, null, hash01(state.seed, "cityentry", t.id, c.visit || 1));
  const key = keyOf(ent.x, ent.y);
  Object.assign(c, { v: 2, grid: { size: g.size, r: g.r }, cell: key, heading: ent.heading, path: [key], entry: key, block: levelOf(g, ent.x, ent.y), blocks: {}, trail: {}, enc: null, leaving: null, fresh: false, prev: null });
  c.trailMult = c.trailMult ?? trailMultOf(state, p);
  genBlock(state, c, key);
  say2(c, "(The city is a grid of blocks now: you are on its edge, with what you found.)", "info", state.hour);
}
// The crawl the window shows: the first of your teams in one, not while a building is being raided.
export function activeCrawl(state) {
  for (const p of state.parties) {
    if (p.owner !== "player" || !p.crawl) continue;
    const c = crawlOf(state, p);
    if (!c) continue;
    if (c.inside && !(state.combat && state.combat.setup && state.combat.setup.partyId === p.id)) c.inside = null; // the raid is gone (an old save)
    if (!c.inside) return p;
  }
  return null;
}
function say2(c, text, k = "info", hour = null) {
  c.log.push({ text, k, hour });
  if (c.log.length > 60) c.log.splice(0, c.log.length - 60);
}

// ---------- starting ----------
// The Alert a crawl starts at: the city's own (more with its Infection), or what is left of the last crawl's Alert,
// fading 1 an hour since.
function startAlert(state, t) {
  const mem = memOf(t);
  const floor = Math.round(CRAWL.ALERT.start + (t.infection || 0) * CRAWL.ALERT.infection);
  const left = Math.max(0, (mem.alert || 0) - (state.hour - (mem.hour || 0)));
  return { floor, alert: Math.max(floor, Math.round(left)) };
}

// Where a scavenge order would crawl (scavenge.js startScavenge): a team you drive, in the browser, with battles
// not resolved by the numbers (the autopilot sets that), on a city's tile.
export const crawlOffered = (state, p) =>
  !!p && p.owner === "player" && p.crewRole == null && p.kind !== "convoy" && !state.autoCombat && !state.autopilot &&
  typeof window !== "undefined" && crawlTile(state.tiles[partyTile(p)]);

// A team you moved onto a city (parties.js arrive, a Move order) asks whether to go in: its orders card gives way to
// this one, and "Not now" brings the orders card back. Not when queued orders carried the team on (no orders card).
export function offerCrawl(state, p) {
  if (p.phase !== "waiting" || !crawlOffered(state, p)) return false;
  const i = state.cards.findIndex((c) => c.isOrders && c.partyId === p.id);
  if (i < 0) return false;
  state.cards[i] = crawlCard(state, p, state.cards[i]);
  return true;
}
export function crawlCard(state, p, orders) {
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const city = tileLabel(state, tile);
  const visits = t.crawlMem ? t.crawlMem.visits : 0;
  const { alert } = startAlert(state, t);
  const n = partyMembers(state, p).length;
  return {
    title: `City crawl: ${city}`,
    isOrders: true, // still the team's orders card (one a team: awaitOrders replaces it; the autopilot answers it as one)
    partyId: p.id,
    text: `${teamName(state, p)} ${n === 1 ? "stands" : "stand"} at the edge of ${city}. Go in block by block: each block shows the places along its street (each one a building to raid) and what is happening outside, and you choose: go into a place, deal with the street, push deeper (richer, rarer places, and more and tougher dead) or head back out. Noise raises the city's Alert, lying low lets it fade, and every block between you and the edge is a risk on the way out. Alert now: ${alertName(alert)} (${alert}).${visits ? ` You have been in ${visits} time${visits === 1 ? "" : "s"}: the places searched before stay picked over.` : ""}${p.vehicle ? " The vehicle waits at the edge; inside you carry everything on foot." : ""}`,
    choices: [
      {
        label: "Go in block by block", hint: "Start a city crawl here: the first block's card opens.", order: true,
        resolve: (st) => { const res = giveOrder(st, p, "scavenge"); return p.crawl || st.combat ? "" : res; },
      },
      {
        label: "Not now", hint: "The team's usual orders: survey, claim, move on, return home…", order: true,
        resolve: (st) => { if (st.parties.includes(p)) st.cards.unshift(orders); return ""; },
      },
    ],
  };
}

// A team arrives at a city tile to scavenge (scavenge.js startScavenge): the crawl opens on a block on the rim of the
// city's round grid (citygrid.js), on the side facing where the team came from, heading in.
export function startCrawl(state, p) {
  const t = state.tiles[p.dest];
  const mem = memOf(t);
  mem.visits += 1;
  const { floor, alert } = startAlert(state, t);
  const g = gridOf(state, t);
  const home = state.bases.find((b) => b.id === p.homeBaseId) || state.bases[0];
  let angle = null;
  if (home && state.grid && home.tile !== t.id) { const a = state.tiles[home.tile], b = t; angle = Math.atan2((a.y ?? 0) - (b.y ?? 0), (a.x ?? 0) - (b.x ?? 0)); }
  const ent = entryOf(g, angle, hash01(state.seed, "cityentry", t.id, mem.visits));
  const key = keyOf(ent.x, ent.y);
  p.phase = "engaged";
  p.crawl = {
    v: 2, tile: p.dest, city: tileLabel(state, p.dest), visit: mem.visits, started: state.hour,
    grid: { size: g.size, r: g.r }, cell: key, heading: ent.heading, path: [key], entry: key,
    block: levelOf(g, ent.x, ent.y), deepest: 1, alert, floor,
    blocks: {}, buildings: { ...mem.snaps }, enc: null, leaving: null, inside: null,
    tally: { supplies: {}, gear: [] }, kills: 0, lost: [], log: [], hadVehicle: !!p.vehicle,
    trail: {}, trailMult: trailMultOf(state, p), fresh: false,
  };
  const c = p.crawl;
  aiLootCells(state, t, c); // other groups' scavenging since: the blocks near the rim they went through
  genBlock(state, c, key);
  noteCell(state, c, key);
  say2(c, `${teamName(state, p)} reaches the edge of ${c.city} (${g.size} blocks across) from the ${DIR_NAMES[(ent.heading + 2) % 4]}.${p.vehicle ? " The vehicle waits here at the edge; everything you find you carry on foot until you come back out." : ""}`, "info", state.hour);
  log(state, `${teamName(state, p)} goes into ${c.city} block by block.`, "info");
  return true;
}
// Other groups' scavenging here (aiscav.js adds what they took to mem.aiLoot): every AI_LOOT of it is a block they
// went through, near the rim (they do not go deep), picked over, and the buildings there not as you left them.
const AI_LOOT = 0.04, AI_RINGS = 3;
function aiLootCells(state, t, c) {
  const mem = memOf(t);
  let n = Math.floor((mem.aiLoot || 0) / AI_LOOT);
  if (!n) return;
  mem.aiLoot -= n * AI_LOOT;
  const g = c.grid;
  const rim = cellsOf(g).filter(([x, y]) => levelOf(g, x, y) <= 1 + Math.floor((AI_RINGS - 1) / 2) && Math.hypot(x + 0.5 - g.r, y + 0.5 - g.r) >= g.r - AI_RINGS);
  for (let k = 0; k < n && rim.length; k++) {
    const [x, y] = rim[Math.floor(hash01(state.seed, "ailoot", t.id, mem.visits, k) * rim.length)];
    const key = keyOf(x, y);
    for (let j = 0; j < CRAWL.PLACES[1]; j++) {
      const id = `${key}p${j}`;
      mem.looted[id] = 1 - (1 - (mem.looted[id] || 0)) * 0.3;
      delete mem.snaps[id]; delete c.buildings[id];
    }
    (mem.cells[key] = mem.cells[key] || {}).ai = day(state);
  }
}
// The tools: put the team on the nearest block of `level` straight in from where it stands (tools/crawlbalance.js
// --block, the tests), the path from its entry to there.
export function jumpToLevel(state, c, level) {
  const [x0, y0] = xyOf(c.entry || c.cell);
  let best = null, bd = Infinity;
  for (const [x, y] of cellsOf(c.grid)) if (levelOf(c.grid, x, y) === level) { const d = Math.abs(x - x0) + Math.abs(y - y0); if (d < bd) { bd = d; best = [x, y]; } }
  if (!best) return false;
  // A walked path from the entry: a step at a time along the longer way first (every block on it in the grid).
  const path = [keyOf(x0, y0)];
  let x = x0, y = y0, heading = c.heading;
  for (let g = 0; g < 200 && (x !== best[0] || y !== best[1]); g++) {
    const sx = Math.sign(best[0] - x), sy = Math.sign(best[1] - y);
    const tryX = Math.abs(best[0] - x) >= Math.abs(best[1] - y);
    const opts = tryX ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
    const step = opts.find(([dx, dy]) => (dx || dy) && inGrid(c.grid, x + dx, y + dy));
    if (!step) break;
    x += step[0]; y += step[1];
    heading = DIRS.findIndex(([dx, dy]) => dx === step[0] && dy === step[1]);
    path.push(keyOf(x, y));
  }
  for (const k of path) genBlock(state, c, k);
  const key = keyOf(x, y);
  c.cell = key; c.heading = heading; c.block = levelAt(c, key); c.deepest = Math.max(c.deepest, c.block); c.path = path;
  return c.block === level;
}
// The block on the map: its level of zombie activity and the day you were there (the crawl map, citycrawl window).
function noteCell(state, c, key) {
  const mem = memOf(state.tiles[c.tile]);
  const e = (mem.cells[key] = mem.cells[key] || {});
  e.threat = threatOf(state, c, key).level; e.day = day(state);
}
// How much heat the team leaves on a block's streets for each point of Alert it raises there (CRAWL.TRAIL).
export function trailMultOf(state, p) {
  const T = CRAWL.TRAIL;
  return (1 + T.perPerson * Math.max(0, partyMembers(state, p).length - 3)) * (p.stance === "stealthy" ? T.stealthy : 1);
}
// A block's zombie activity: { level 1-5, name, mult } by the city's dice (CRAWL.THREAT); salt: another way out's streets.
export function threatOf(state, c, key = c.cell, ...salt) {
  const T = CRAWL.THREAT;
  let r = hash01(state.seed, "crawl-threat", c.tile, key, ...salt), level = 1;
  for (let i = 1; i < T.weights.length; i++) { if (r < T.weights[i]) { level = i; break; } r -= T.weights[i]; level = i; }
  return { level, name: T.names[level], mult: T.mult[level] };
}
// The heat on a block's streets: the city's Alert and the block's own trail, × its activity.
export const blockHeat = (state, c, key = c.cell, mult = threatOf(state, c, key).mult) => (c.alert + ((c.trail || {})[key] || 0)) * mult;
// A block's level (1-8: the danger and loot tables' "block") from its place on the grid.
export const levelAt = (c, key) => { const [x, y] = xyOf(key); return levelOf(c.grid, x, y); };
// ---------- blocks ----------
// A block's places and events. The places are the city's own (seeded by the world, the tile and the block: the same
// buildings every visit); which one is shut this time and the street events change with the visit.
export function genBlock(state, c, cell = c.cell) {
  if (c.blocks[cell]) return c.blocks[cell];
  const n = levelAt(c, cell);
  const t = state.tiles[c.tile];
  const mem = memOf(t);
  const rng = new Rng(seedOf(state.seed, "crawl", c.tile, cell));
  const vr = new Rng(seedOf(state.seed, "crawl-visit", c.tile, cell, c.visit));
  const streetA = STREETS[(rng.int(0, STREETS.length - 1) + n * 7) % STREETS.length];
  const nPlaces = clamp(CRAWL.PLACES[0] + (rng.chance(0.5) ? 1 : 0) + (rng.chance(0.15 * (n - 1)) ? 1 : 0), CRAWL.PLACES[0], CRAWL.PLACES[1]);
  const pool = Object.keys(PLACE_POOL).filter((k) => BUILDINGS[k] && n >= PLACE_POOL[k].from);
  const places = [];
  for (let j = 0; j < nPlaces; j++) {
    const left = pool.filter((k) => !places.some((pl) => pl.key === k));
    const key = rng.weighted(left, (k) => Math.max(0.02, PLACE_POOL[k].w + PLACE_POOL[k].deep * (n - 1)));
    const P = PLACE_POOL[key];
    const street = rng.chance(0.6) ? streetA : STREETS[rng.int(0, STREETS.length - 1)];
    const id = `${cell}p${j}`;
    const raiders = n >= CRAWL.RAIDERS.from && rng.chance(Math.min(CRAWL.RAIDERS.max, CRAWL.RAIDERS.chance + CRAWL.RAIDERS.perBlock * (n - CRAWL.RAIDERS.from)));
    const place = {
      id, slot: j, key, name: `${BUILDINGS[key].name} on ${street}`, kind: BUILDINGS[key].name, rare: !!P.rare,
      dead: P.dead * (0.85 + rng.next() * 0.3), rich: P.rich, raiders,
      looted: mem.looted[id] || 0, // picked over by an earlier crawl
      blocked: null, quick: false,
      known: false, // what the team knows of its upper floors (lookAround, or having been inside): folkHint
    };
    // Who holds its upper floors (floorfolk.js), by the city's dice: the same people every visit.
    place.folk = rollFolk(rng, { key, n, storeys: placeStoreys(state, c, place, n), danger: placeDanger(state, c, place, n).level, raiders });
    places.push(place);
  }
  // This visit: a place may be shut.
  if (places.length > 2 && vr.chance(CRAWL.BLOCKED)) {
    const pl = vr.pick(places);
    pl.blocked = vr.pick(["Fire has gutted the front; the doors are buried.", "The entrance has caved in.", "The doors are chained and welded shut.", "Something has nested in the doorway: too many of the dead to get past."]);
  }
  // Street events this visit.
  const two = CRAWL.EVENTS.two + CRAWL.EVENTS.perBlock * (n - 1);
  const k = vr.chance(CRAWL.EVENTS.none) ? 0 : vr.chance(two) ? 2 : 1;
  const events = [];
  for (let i = 0; i < k; i++) {
    const keys = Object.keys(EVENTS).filter((e) => n >= EVENTS[e].min && !events.some((x) => x.key === e) && !(EVENTS[e].blocking && n >= CRAWL.MAX_BLOCK));
    if (!keys.length) break;
    const evk = vr.weighted(keys, (e) => Math.max(0.05, EVENTS[e].w + EVENTS[e].deep * (n - 1) + (e === "horde" ? c.alert / 60 : 0)));
    events.push({ id: `${cell}e${i}`, key: evk, done: false, result: "" });
  }
  c.blocks[cell] = { n, key: cell, street: streetA, places, events, threat: threatOf(state, c, cell).level };
  return c.blocks[cell];
}
export const blockOf = (c) => c.blocks[c.cell];
const placeById = (c, id) => Object.values(c.blocks).flatMap((b) => b.places).find((x) => x.id === id) || null;

export const deadMult = (n) => CRAWL.DEAD.base + CRAWL.DEAD.perBlock * (n - 1);
// How dangerous a place is: the expected dead (× the site's count) and its people, 1–5, and what it looks like.
const LOOKS = ["", "Quiet", "A few of the dead about", "Dangerous", "Very dangerous", "A death trap"];
export function placeDanger(state, c, place, n = c.block) {
  const t = state.tiles[c.tile];
  const inf = t.infection || 0;
  const dead = (1 + inf * 5 + 3) * deadMult(n) * place.dead; // scavenge.js raidEnemies, for a city
  const power = 2 + inf * 3 + CRAWL.DEAD.powerPerBlock * (n - 1);
  const score = dead * power / 12 + (place.raiders ? 2 : 0);
  return { dead, power, score, level: clamp(Math.round(score / 1.3), 1, 5) };
}
// What the team can tell from the street (Scouting 5+: exact; else ±1 by the place's own dice).
export function placeLooks(state, p, c, place) {
  const d = placeDanger(state, c, place);
  const sharp = bestSkill(state, p, "scouting") >= 5;
  const fuzz = sharp ? 0 : Math.round(hash01(state.seed, "looks", c.tile, place.id) * 2) - 1;
  const level = clamp(d.level + fuzz, 1, 5);
  const people = place.raiders && (sharp || hash01(state.seed, "movement", c.tile, place.id) < 0.5);
  return { level, text: LOOKS[level], people, sure: sharp };
}
// The richness a place's containers are rolled with (combat.js searchBox).
export function placeRichness(state, c, place, n = c.block) {
  const t = state.tiles[c.tile];
  const site = CRAWL.RICH.base + CRAWL.RICH.site * Math.min(1, t.loot ?? 0.5);
  return clamp(site * (1 + CRAWL.RICH.perBlock * (n - 1)) * place.rich * (1 - CRAWL.RICH.looted * (place.looted || 0)), CRAWL.RICH.min, CRAWL.RICH.max);
}
// A kind of special dead deeper in the city: one of the kinds the hives have grown by now (hivetech.js eraTier, by
// their shares); before any, one of SPECIAL.types.
export function crawlKind(state, rng) {
  const kinds = eraKinds(eraTier(state));
  const tot = Object.values(kinds).reduce((a, v) => a + v, 0);
  if (!tot) return rng.pick(CRAWL.SPECIAL.types);
  let r = rng.next() * tot;
  for (const k in kinds) { r -= kinds[k]; if (r < 0) return k; }
  return Object.keys(kinds)[0];
}
// The special dead's share at this depth (0 above block SPECIAL.from).
export function specialChance(state, n) {
  const S = CRAWL.SPECIAL;
  if (n < S.from) return 0;
  return Math.min(S.max, S.chance + S.perBlock * (n - S.from) + S.late * yearGone(state));
}
// Who is in a place: the site's own (scavenge.js raidEnemies: the dead, guards of a group that holds it, rival
// scavengers) with more and tougher dead deeper, and raiders holed up in it.
function placeGroups(state, c, place, n = c.block) {
  const groups = raidEnemies(state, c.tile).map((g) => ({ ...g }));
  for (const g of groups) {
    if (g.kind !== "zombies") continue;
    g.count = Math.max(1, Math.round(g.count * deadMult(n) * place.dead));
    g.power += CRAWL.DEAD.powerPerBlock * (n - 1);
    // A police station's dead are riot police (deadsoldiers.js MILDEAD.SITE), whatever the city around it.
    if (MILDEAD.SITE[place.key]) g.mix = maxMix(g.mix, MILDEAD.SITE[place.key]);
  }
  if (place.raiders) {
    const R = CRAWL.RAIDERS;
    groups.push({ kind: "raiders", count: state.rng.int(R.count[0], R.count[1]) + Math.floor(n / 3), power: R.power + R.powerPerBlock * (n - 1), name: "raiders holed up", guard: true });
  }
  return groups;
}

// The building a place opens (buildingmaps.js raidBuilding / buildingMap): its option id is the block and the slot, so
// the same place has the same floor plan every visit. Storeys (docs/multi-storey-crawl.md): block depth adds to the
// storey roll of offices and apartments, STOREY_BONUS.at1 from block STOREY_BONUS.from1, at2 from from2 (capped in
// buildingmaps.js MAX_STOREYS).
export const STOREY_BONUS = { from1: 4, at1: 1, from2: 7, at2: 2 };
export const storeyBonus = (n) => (n >= STOREY_BONUS.from2 ? STOREY_BONUS.at2 : n >= STOREY_BONUS.from1 ? STOREY_BONUS.at1 : 0);
export const placeOption = (c, place, n = c.block) => ({ id: `cc${n}-${place.slot}`, key: place.key, name: place.name, storeyBonus: storeyBonus(n) });
// How many storeys a place has (the block card): the archetype's dice for this place, without building its map.
export function placeStoreys(state, c, place, n = c.block) {
  const spec = buildingSpec(state, c.tile, placeOption(c, place, n));
  return typeof spec.storeys === "number" ? Math.max(1, spec.storeys) : 1;
}

// ---------- the team ----------
// Load on foot: what the team carries (packed and found) against what its people can carry without the vehicle.
export function crawlLoad(state, p) {
  const cap = carryCapacity(state, partyMembers(state, p), null);
  const load = poolLoad(p);
  return { load, cap, ratio: cap > 0 ? load / cap : 9, over: Math.max(0, cap > 0 ? load / cap - 1 : 1) };
}
// Throwables to lure the dead away with: on the people or in the team's cargo.
function lureOf(state, p) {
  for (const key of ["noisemaker", "firecracker", "bottle"]) {
    for (const s of partyMembers(state, p)) { const f = findCarried(s, key); if (f) return { key, take: f.take }; }
    const i = p.cargo ? p.cargo.gear.findIndex((g) => g && g.key === key) : -1;
    if (i >= 0) return { key, take: () => p.cargo.gear.splice(i, 1) };
  }
  return null;
}
// Things found go into the team's cargo while there is room; the rest is left. A full team swaps (deeploot.js): a find
// worth more a kilo, for what its home base needs (wantOf), takes the place of the least wanted cargo it carries, at
// least DEEP.swapMargin better; what it puts down stays here. Returns the line.
function give(state, p, c, sup = {}, gear = []) {
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  typeFind(state, sup, "house", c.tile); // foods.js: "food" as a city's food (cans, rice, snacks), as much as its shelves still hold
  const base = state.bases.find((b) => b.id === p.homeBaseId) || state.bases[0] || null;
  const people = base ? atBase(state, base.id).length + partyMembers(state, p).length : 1;
  const supWorth = (k) => valuePerKg(k) * wantOf(base, people, k); // a kilo of it, as the base wants it
  const gearWorth = (g) => (itemValue(g) || 0) / Math.max(0.1, itemLoad(g));
  let room = cargoRoom(state, p);
  const got = [], left = [], dropped = [], downSup = {};
  // Finds, the most wanted a kilo first.
  const finds = [
    ...Object.entries(sup).filter(([k, q]) => q > 0 && SUPPLIES[k]).map(([k, q]) => ({ k, q, w: supWorth(k) })),
    ...gear.filter(Boolean).map((g) => ({ g, w: gearWorth(g) })),
  ].sort((a, b) => b.w - a.w);
  // Room by putting down the least wanted cargo worth less a kilo than `w` (by the margin): up to `kg`.
  const makeRoom = (kg, w) => {
    const cargo = [
      ...Object.entries(p.cargo.supplies).filter(([k, q]) => q > 0 && SUPPLIES[k] && supWeight(k) > 0).map(([k, q]) => ({ k, q, w: supWorth(k) })),
      ...p.cargo.gear.filter(Boolean).map((g) => ({ g, w: gearWorth(g) })),
    ].filter((x) => x.w * (1 + DEEP.swapMargin) < w).sort((a, b) => a.w - b.w);
    let freed = 0;
    for (const x of cargo) {
      if (freed >= kg) break;
      if (x.g) { p.cargo.gear.splice(p.cargo.gear.indexOf(x.g), 1); freed += itemLoad(x.g); dropped.push(x.g.name); continue; }
      const each = supWeight(x.k), n = Math.min(x.q, Math.ceil((kg - freed) / each));
      p.cargo.supplies[x.k] -= n; if (!(p.cargo.supplies[x.k] > 0)) delete p.cargo.supplies[x.k];
      if (c.tally.supplies[x.k]) { c.tally.supplies[x.k] = Math.max(0, c.tally.supplies[x.k] - n); if (!c.tally.supplies[x.k]) delete c.tally.supplies[x.k]; }
      freed += n * each; downSup[x.k] = (downSup[x.k] || 0) + n;
    }
    return freed;
  };
  for (const f of finds) {
    if (f.g) {
      const kg = itemLoad(f.g);
      if (room < kg) room += makeRoom(kg - room, f.w);
      if (room >= kg) { p.cargo.gear.push(f.g); c.tally.gear.push(f.g.name); room -= kg; got.push(f.g.name); }
      else left.push(f.g.name);
      continue;
    }
    const { k, q } = f;
    if (unitsThatFit(room, k) < q) room += makeRoom(q * supWeight(k) - room, f.w);
    const take = Math.min(q, unitsThatFit(room, k));
    if (take > 0) {
      p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take;
      c.tally.supplies[k] = (c.tally.supplies[k] || 0) + take;
      room -= take * supWeight(k);
      got.push(`${take} ${keyWord(k)}`);
    }
    if (q - take > 0) left.push(`${q - take} ${keyWord(k)}`);
  }
  dropped.unshift(...Object.entries(downSup).map(([k, n]) => `${n} ${keyWord(k)}`));
  return `${got.length ? got.join(", ") : "nothing useful"}${left.length ? ` (no room for ${left.join(", ")})` : ""}${dropped.length ? `; put down to make room: ${dropped.join(", ")}` : ""}`;
}
export { give as takeFinds }; // tools/deeploottest.js
// One container's worth from an area's loot table (as combat.js searchBox rolls it, without locks and books).
// site: the building or place it is in (a police station's armoury holds police guns, an Army checkpoint's the Army's:
// gundist.js areaSourceName).
export function rollArea(rng, type, rich, scav, site = "city") {
  const def = AREAS[type];
  const sup = {}, gear = [];
  if (!def) return { sup, gear };
  for (const [k, [p, lo, hi]] of Object.entries(def.loot)) {
    if (!rng.chance(Math.min(0.95, p * (0.6 + 0.4 * rich) * (1 + scav / 40)))) continue;
    sup[k] = Math.max(1, Math.round(rng.int(lo, hi) * (0.6 + 0.5 * rich) * (1 + scav / 25)));
  }
  for (const [key, p] of def.gear) if (GEAR[key] && rng.chance(p * (0.5 + rich) * (1 + scav / 30))) gear.push(lootItem(swapGun(areaSourceName(type, site), key, rng), areaSource(type, "city"), rng)); // itemcond.js; gundist.js: which gun (a hash of the draw)
  gear.push(...crawlGuns(type, site, rng)); // gunfinds.js: a gun counter's, an armoury's extra gun now and then (its own dice)
  const small = rollAreaFind(rng, type, rich, scav, "city");
  if (small) gear.push(small);
  return { sup, gear };
}
const addSup = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v; return a; };

// Hours pass on the shared clock; the Alert fades. Returns false when the team is gone.
function passHours(state, p, hours) {
  const c = p.crawl;
  for (let i = 0; i < hours; i++) {
    tickHour(state);
    if (!state.parties.includes(p) || !partyMembers(state, p).length) return false;
    if (c) {
      c.alert = clamp(c.alert + CRAWL.ALERT.creep, c.floor, 100); // the longer you stay, the more of the dead drift in
      for (const k of Object.keys(c.trail || {})) c.trail[k] = Math.max(0, c.trail[k] - CRAWL.TRAIL.decay);
    }
  }
  return true;
}
const addAlert = (c, v) => {
  c.alert = clamp(c.alert + v, 0, 100);
  if (v > 0) { const tr = c.trail || (c.trail = {}); const k = c.cell ?? c.block; tr[k] = clamp((tr[k] || 0) + v * (c.trailMult ?? 1), 0, 100); c.fresh = false; } // the block's own heat (CRAWL.TRAIL); noise: no slipping away unseen
};

// ---------- going into a place ----------
// A building's map: the raid on its interior (combat.js createRaid with setup.raid.place), tuned for the depth, with
// the building as it was left if the team was in it before on this crawl. opts.map false: searched by the numbers.
export function enterPlace(state, p, placeId, opts = {}) {
  const c = crawlOf(state, p);
  if (!c) return "The team is not in a city.";
  if (c.enc) return "Deal with what is in front of you first.";
  if (state.combat) return "A fight is already going on.";
  const blk = blockOf(c);
  const place = blk.places.find((x) => x.id === placeId);
  if (!place) return "No such place on this block.";
  if (place.blocked) return place.blocked;
  if (!opts.map) return quickSearch(state, p, place);
  const n = c.block;
  const t = state.tiles[c.tile];
  const snap = c.buildings[place.id] || null;
  const groups = snap ? [] : placeGroups(state, c, place);
  const total = groups.reduce((a, g) => a + g.count, 0);
  const H = CRAWL.HEAT0;
  const heat0 = Math.round(Math.min(H.max, (isNight(state) ? H.night : H.day) + H.perBlock * (n - 1) + Math.max(0, c.alert - c.floor) * H.fromAlert));
  const setup = {
    mode: "raid", tile: c.tile, partyId: p.id, canRetreat: true, ambush: null, handler: "crawl",
    enemy: { kind: groups.length > 1 ? "mixed" : groups[0]?.kind || "zombies", count: total, power: 3, name: groups.map((g) => g.name).join(" and ") || "nobody", groups },
    raid: { heat0, place: placeOption(c, place, n), gunSite: place.key }, // gundist.js: a police station's armoury draws police guns (as the quick search's)
    context: { factionIds: groups.filter((g) => g.factionId).map((g) => g.factionId), crawl: { kind: "place", place: place.id, block: n, heat0 } },
  };
  // The vehicle waits at the city's edge: not on the building's map.
  const veh = p.vehicle;
  let b;
  p.vehicle = null;
  try { b = createBattle(state, setup); } finally { p.vehicle = veh; }
  const R = b.raid;
  R.richness = placeRichness(state, c, place);
  R.deep = n; // combat.js searchBox: deeploot.js deepShift (the block's finds dearer by the kilo)
  R.spawnCap += CRAWL.SPAWN_PER_BLOCK * (n - 1);
  b.infection = Math.min(1, (t.infection || 0) + CRAWL.INFECT_PER_BLOCK * (n - 1));
  if (snap) restoreBuilding(state, b, snap);
  else {
    // The special dead deeper in (zombietypes.js).
    const sp = specialChance(state, n);
    if (sp > 0) for (const u of b.units) if (u.side === "enemy" && u.kind === "zombie" && !u.ztype && state.rng.chance(sp)) applyZType(u, crawlKind(state, state.rng), false, groups.find((g) => g.kind === "zombies")?.power || 3);
    // Who holds the upper floors (floorfolk.js): survivors barricaded in, the raiders holed up with a watcher, a nest on top.
    placeFolk(state, b, place, n, { kind: (rng) => crawlKind(state, rng) });
  }
  say(b, `City crawl, block ${n} (${DEPTHS[Math.min(n, DEPTHS.length - 1)]}). The city's Alert is ${alertName(c.alert)}: you start at Heat ${heat0}. Extract to come back out to the street.`, c.alert >= 60 ? "danger" : "info");
  c.inside = place.id;
  state.combat = b;
  return "";
}
// A street event's small map (a crashed ambulance, a checkpoint): the street raid with these areas.
// gunSite: the place its rooms' guns come from (gundist.js areaSourceName: "military" for an Army checkpoint's).
function enterStreet(state, p, ev, areas, groups, gunSite = "city") {
  const c = p.crawl;
  const n = c.block;
  const total = groups.reduce((a, g) => a + g.count, 0);
  const H = CRAWL.HEAT0;
  const heat0 = Math.round(Math.min(H.max, (isNight(state) ? H.night : H.day) + H.perBlock * (n - 1) + Math.max(0, c.alert - c.floor) * H.fromAlert));
  const setup = {
    mode: "raid", tile: c.tile, partyId: p.id, canRetreat: true, ambush: null, handler: "crawl",
    enemy: { kind: groups.length > 1 ? "mixed" : groups[0]?.kind || "zombies", count: total, power: 3, name: groups.map((g) => g.name).join(" and ") || "nobody", groups },
    raid: { heat0, building: "street", areas, gunSite },
    context: { factionIds: [], crawl: { kind: "street", event: ev.id, block: n, heat0 } },
  };
  const veh = p.vehicle;
  let b;
  p.vehicle = null;
  try { b = createBattle(state, setup); } finally { p.vehicle = veh; }
  b.raid.richness = clamp(placeRichness(state, c, { rich: 1.1, looted: 0 }), 0.5, 1.8);
  b.raid.spawnCap += CRAWL.SPAWN_PER_BLOCK * (n - 1);
  c.inside = ev.id;
  state.combat = b;
  return "";
}

// ---------- a building as you left it ----------
// What stays: the cells (doors opened or broken, windows smashed), the containers (searched, half-emptied, locks
// opened), the locked doors, and everyone still there where they stood (unaware again: they have calmed down), the
// dead you killed as bodies.
export function snapshotBuilding(b) {
  const R = b.raid;
  const units = b.units.filter((u) => u.side !== "player" && !u.left && !u.fled).map((u) => {
    const o = { ...u };
    delete o.wp;
    o.aware = false; o.surprised = false; o.ow = false; o.hunker = false;
    if (!o.dead) o.home = [o.x, o.y];
    return o;
  });
  const boxes = R.containers.filter((x) => x.kind !== "body");
  // Storeys (buildingmaps.js): every floor's cells are kept (the ground floor's are `cells`, as before).
  const ground = b.floors ? b.floors[0].cells : b.cells;
  return {
    w: b.w, h: b.h, cells: ground.map((x) => ({ ...x })), containers: R.containers.map((x) => ({ ...x })),
    floors: b.floors ? b.floors.map((F) => ({ cells: F.cells.map((x) => ({ ...x })), name: F.name })) : null,
    doors: R.doors ? R.doors.map((d) => ({ ...d, lock: d.lock ? { ...d.lock } : d.lock })) : null,
    units, occupants: R.occupants || null, heat: Math.round(R.heat), folk: R.folk || null, // floorfolk.js: who held the upper floors, and how it went
    searched: boxes.filter((x) => x.searched).length, total: boxes.length,
  };
}
export function restoreBuilding(state, b, snap) {
  if (!snap || snap.w !== b.w || snap.h !== b.h) return false;
  if (!!snap.floors !== !!b.floors || (snap.floors && snap.floors.length !== b.floors.length)) return false; // the building was rebuilt with other storeys: start afresh
  const R = b.raid;
  const players = b.units.filter((u) => u.side === "player");
  b.nextId = Math.max(b.nextId, ...snap.containers.map((x) => (x.id || 0) + 1), ...snap.units.map((u) => (u.id || 0) + 1));
  const ids = new Map();
  const back = [];
  for (const u of snap.units) {
    const o = { ...u, id: b.nextId++ };
    ids.set(u.id, o.id);
    if (o.dead) { o.reinforcement = true; o.restored = true; } // a body from before: not counted as killed again
    if (!o.dead && players.some((q) => q.x === o.x && q.y === o.y && (q.f || 0) === (o.f || 0))) continue;
    back.push(o);
  }
  b.units = [...players, ...back];
  R.containers = snap.containers.map((x) => ({ ...x, uid: x.uid != null && ids.has(x.uid) ? ids.get(x.uid) : x.uid }));
  if (snap.doors) R.doors = snap.doors.map((d) => ({ ...d, lock: d.lock ? { ...d.lock } : d.lock }));
  if (snap.occupants) R.occupants = snap.occupants;
  R.folk = snap.folk ? JSON.parse(JSON.stringify(snap.folk)) : null; // floorfolk.js (a met group stays met: no second card)
  const z = R.zones[0];
  if (b.floors) {
    // Every floor as it was left; the upper floors' reach floods from the first stairwell, the ground's from the front zone.
    const [sx, sy] = R.stairs[0];
    for (let f = 0; f < b.floors.length; f++) {
      const F = b.floors[f];
      F.cells = snap.floors[f].cells.map((x) => ({ ...x }));
      F.losCache = null;
      setFloor(b, f);
      floodReach(b, f ? sx : z.x0 + 1, f ? sy : z.y0 + 1);
    }
    setFloor(b, 0);
  } else {
    b.cells = snap.cells.map((x) => ({ ...x }));
    b.losCache = makeLosCache(b.w, b.h);
    floodReach(b, z.x0 + 1, z.y0 + 1);
  }
  b.enemyStart = b.units.filter((u) => u.side === "enemy" && !u.dead).length;
  say(b, `You go back into the ${R.interior ? R.interior.name.toLowerCase() : "building"}. It is as you left it: ${snap.searched} of ${snap.total} places searched.`, "info");
  return true;
}

// The raid on a place (or a street map) is over (combat.js finishCombat): back out on the block.
registerCombatHandler("crawl", afterPlace);
function afterPlace(state, result, setup, battle) {
  const p = partyById(state, setup.partyId);
  const ctx = (setup.context && setup.context.crawl) || {};
  const t = state.tiles[setup.tile];
  const r = result.raid || { hours: 1, searched: 0, total: 0, heat: ctx.heat0 || 0 };
  const c = p && p.crawl;
  let line = "";
  if (c) c.inside = null;
  if (c && battle && battle.raid) {
    if (ctx.kind === "place") {
      const before = c.buildings[ctx.place];
      const snap = snapshotBuilding(battle);
      c.buildings[ctx.place] = snap;
      // The site remembers how picked over the place is (a later crawl finds less in it); the city a little too.
      const place = placeById(c, ctx.place);
      if (place) { place.known = true; noteFolk(place, battle); } // floorfolk.js: the team has been inside; the card says what is still up there
      if (place && snap.total) {
        const mem = memOf(t);
        mem.looted[ctx.place] = 1 - (1 - (place.looted || 0)) * (1 - snap.searched / snap.total);
        t.loot = Math.max(0.03, t.loot - 0.01 * Math.max(0, snap.searched - (before ? before.searched : 0)));
      }
      line = `${place ? place.name : "The building"}: ${result.outcome === "extracted" ? "out" : "nobody came out"} after ${r.hours} h (${snap.searched}/${snap.total} searched, Heat ${r.heat}).`;
    } else {
      const ev = Object.values(c.blocks).flatMap((x) => x.events).find((e) => e.id === ctx.event);
      if (ev) { ev.done = true; ev.result = `Searched (${r.searched}/${r.total}).`; }
      line = `${ev ? EVENTS[ev.key].title : "The street"}: ${result.outcome === "extracted" ? "done" : "nobody came out"} after ${r.hours} h (${r.searched}/${r.total} searched, Heat ${r.heat}).`;
    }
  }
  if (r.alerted) for (const id of setup.context.factionIds || []) { const f = factionById(state, id); if (f) changeGoodwill(state, f, -10, "you raided their land"); }
  if (!p || !state.parties.includes(p)) return;
  if (!partyMembers(state, p).length) { crawlWiped(state, p, line); return; }
  if (!c) { awaitOrders(state, p, "The team is out of the building."); return; }
  // Loot, kills and the noise you made.
  for (const [k, v] of Object.entries(result.loot.supplies || {})) c.tally.supplies[k] = (c.tally.supplies[k] || 0) + v;
  for (const g of result.loot.gear || []) c.tally.gear.push(g.name);
  c.kills += (result.enemiesKilled || 0) + (result.extraKilled || 0);
  for (const id of result.survivorsDead || []) { const s = state.survivors.find((x) => x.id === id); if (s) c.lost.push(s.name); }
  const gained = Math.max(0, (r.heat || 0) - (ctx.heat0 || 0));
  addAlert(c, gained * CRAWL.ALERT.fromHeat);
  const got = [...Object.entries(result.loot.supplies || {}).map(([k, v]) => `${v} ${keyWord(k)}`), ...(result.loot.gear || []).map((g) => g.name)];
  say2(c, `${line} ${got.length ? `Found ${got.join(", ")}.` : "Found nothing."}${(result.survivorsDead || []).length ? ` Lost: ${(result.survivorsDead || []).map((id) => state.survivors.find((x) => x.id === id)?.name).join(", ")}.` : ""} Alert +${Math.round(gained * CRAWL.ALERT.fromHeat)}.`, result.outcome === "extracted" ? "good" : "danger", state.hour);
  if (result.outcome === "extracted" && folkAfterPlace(state, p, battle)) say2(c, "The survivors from upstairs wait for you on the street.", "good", state.hour); // floorfolk.js: the recruit card
  for (let i = 0; i < (r.hours || 1); i++) searchHazards(state, partyMembers(state, p), c.city);
  wormSearch(state, p, c.tile, r.hours || 1); // worm.js
  passHours(state, p, r.hours || 1);
  if (state.parties.includes(p) && !partyMembers(state, p).length) crawlWiped(state, p, "");
}

// ---------- searching a place by the numbers ----------
export function quickSearch(state, p, place) {
  const c = p.crawl;
  const n = c.block;
  const rng = state.rng;
  const Q = CRAWL.QUICK;
  const members = partyMembers(state, p);
  // Maybe a fight first: the dead inside (some of them), the raiders holed up all of them.
  const fight = clamp((Q.fight + Q.perBlock * (n - 1) + blockHeat(state, c, c.cell) / 300 - bestSkill(state, p, "stealth") * 0.02) * (place.raiders ? 1.6 : 1) * (1 - 0.5 * (place.looted || 0)), 0.05, 0.9);
  let lines = [];
  if (rng.chance(fight)) {
    const groups = placeGroups(state, c, place).map((g) => (g.kind === "zombies" ? { ...g, count: Math.max(1, Math.round(g.count * 0.5)) } : g));
    const enemy = mergeGroups(groups);
    const sp = enemy.kind === "zombies" ? specialChance(state, n) : 0;
    if (sp > 0) enemy.types = { [crawlKind(state, rng)]: Math.max(1, Math.round(enemy.count * sp)) };
    const setup = { tile: c.tile, partyId: p.id, enemy, ambush: null, canRetreat: true, handler: "crawlfight", context: { crawl: { kind: "quick", place: place.id, block: n } } };
    const res = autoResolveCombat(state, setup);
    finishCombat(state, setup, res);
    if (!state.parties.includes(p) || !p.crawl) return "";
    lines.push(`A fight inside (${res.outcome}).`);
    if (res.outcome === "defeat") { place.quick = true; say2(c, `${place.name}: driven out before you could search it.`, "danger", state.hour); return lines.join(" "); }
  }
  const scav = bestSkill(state, p, "scavenging");
  const rich = placeRichness(state, c, place);
  const holds = buildingHint(place.key).holds.filter((x) => AREAS[x]);
  const sup = {}, gear = [];
  const rolls = Math.max(1, Math.round((Q.rolls + (Q.rollsPerBlock || 0) * (n - 1)) * (1 - 0.6 * (place.looted || 0))));
  for (let i = 0; i < rolls && holds.length; i++) { const r = rollArea(rng, rng.pick(holds), rich, scav, place.key); addSup(sup, r.sup); gear.push(...r.gear); }
  deepShift(sup, n); // deeploot.js: fewer tins, more rounds and meds the deeper the block
  // A cache (deeploot.js): a locker, a stash behind a panel, a medic's bag; only what is small and dear is taken.
  if (rng.chance(cacheChance(n))) {
    const area = rng.pick(DEEP.cacheAreas.filter((a) => AREAS[a]));
    if (area) {
      const r = rollArea(rng, area, DEEP.cacheRich, scav, place.key);
      for (const [k, v] of Object.entries(r.sup)) if (isFine(k) || k === "ammo") sup[k] = (sup[k] || 0) + v;
      gear.push(...r.gear);
      lines.push("A cache tucked away inside.");
    }
  }
  const text = give(state, p, c, sup, gear);
  place.quick = true;
  place.looted = 1 - (1 - (place.looted || 0)) * (1 - Q.looted);
  memOf(state.tiles[c.tile]).looted[place.id] = place.looted;
  addAlert(c, Q.alert);
  gainXpAll(state, members, "scavenging", USE.searchHour * Q.hours);
  gainXpAll(state, members, "stealth", USE.searchStealth * Q.hours); // skills.js: moving quietly through the ruins
  lines.push(`Searched by the numbers: ${text}.`);
  say2(c, `${place.name}: ${lines.join(" ")}`, "good", state.hour);
  for (let i = 0; i < Q.hours; i++) searchHazards(state, partyMembers(state, p), c.city);
  wormSearch(state, p, c.tile, Q.hours); // worm.js
  passHours(state, p, Q.hours);
  return lines.join(" ");
}
// The odds of winning the fight a quick search of this place could bring (quickSearch: half the dead inside, all the
// raiders), for the autopilot's choice of what to search.
export function searchOdds(state, p, c, place, n = c.block) {
  const groups = placeGroups(state, c, place, n).map((g) => (g.kind === "zombies" ? { ...g, count: Math.max(1, Math.round(g.count * 0.5)) } : g));
  return byNumbersOdds(state, { tile: c.tile, partyId: p.id, enemy: mergeGroups(groups), ambush: null, canRetreat: true }).win;
}
// The block the autopilot's crawl means to work (set on the city's edge): the deepest up to AUTO.depth where the places
// of the edge block, as deep as that, would be searched with a margin (planShare of them at planOdds or better).
// Deeper places are richer (RICH.perBlock) and hold the rarer finds; the blocks on the way are walked, not searched.
export function autoDepth(state, p, c) {
  const A = CRAWL.AUTO;
  const places = blockOf(c).places.filter((x) => !x.blocked);
  if (!places.length) return 1;
  let best = 1;
  for (let n = 2; n <= Math.min(A.depth, CRAWL.MAX_BLOCK, c.grid ? maxLevel(c.grid) : CRAWL.MAX_BLOCK); n++) {
    const ok = places.filter((x) => searchOdds(state, p, c, x, n) >= A.planOdds).length;
    if (ok < places.length * A.planShare) break; // deeper blocks hold worse places than the edge's: a margin
    if (streetOdds(state, p, c, n) < A.sureOdds) break; // the way down: a horde on that block's street it would not fight
    best = n;
  }
  return best;
}
// The odds against the horde a block's street can throw at the team (makeEncounter's, at the Alert it would have
// walked down with: + ALERT.move a block), for the autopilot's plan.
export function streetOdds(state, p, c, n) {
  const H = CRAWL.HORDE, inf = state.tiles[c.tile].infection || 0;
  const alert = c.alert + CRAWL.ALERT.move * (n - c.block);
  const enemy = { kind: "zombies", count: Math.min(H.max, Math.max(2, Math.round(H.base + H.perBlock * n + alert / H.alertDiv))), power: 2 + inf * 3 + CRAWL.DEAD.powerPerBlock * (n - 1), name: "a horde" };
  return byNumbersOdds(state, { tile: c.tile, partyId: p.id, enemy, ambush: null, canRetreat: true }).win;
}
function mergeGroups(groups) {
  const count = groups.reduce((a, g) => a + g.count, 0);
  const power = count ? groups.reduce((a, g) => a + g.count * g.power, 0) / count : 3;
  const kinds = new Set(groups.map((g) => g.kind));
  return { kind: kinds.size > 1 ? "mixed" : groups[0]?.kind || "zombies", count: Math.max(1, count), power, name: groups.map((g) => g.name).join(" and ") || "the dead" };
}

// ---------- moving ----------
// The chance of trouble walking to block n (from the block before it).
// The chance of trouble walking into a block (key; its level from the grid): its activity scales its danger and multiplies
// its heat (the Alert and its trail): CRAWL.THREAT. mult: as known (a block not yet seen is reckoned at 1 in what the
// window shows; the roll uses the block's own).
export function moveRisk(state, c, key = c.cell, mult = threatOf(state, c, key).mult) {
  const E = CRAWL.ENC;
  const n = levelAt(c, key);
  return Math.min(E.max, ((E.base + E.perBlock * (n - 1)) * mult + blockHeat(state, c, key, mult) * E.perAlert) * (isNight(state) ? E.night : 1) * CRAWL.GRIDSTEP.step);
}
// The way out, block by block: way "back" the blocks of the path you came in by, in reverse, each at its level, the
// Alert, the load and the heat you left there (its trail), × its activity; way "line": straight on in one direction
// (dir 0-3, north, east, south, west) to the rim, through the blocks in between (blocks you have seen at their own
// activity and heat; the rest reckoned at 1 till you are on them). From a block on the rim you walk out: no risk.
// { way, dir, steps: [{ cell, block (level), p, trail, threat, known }], any, breakout, hours }.
export function exitRisk(state, p, c = p.crawl, way = (c.leaving && c.leaving.way) || "back", dir = c.leaving && c.leaving.dir) {
  const X = CRAWL.EXIT, T = CRAWL.TRAIL;
  const over = crawlLoad(state, p).over;
  const night = isNight(state) ? X.night : 1;
  const mem = memOf(state.tiles[c.tile]);
  const at = (key, known) => {
    const n = levelAt(c, key), trail = (c.trail || {})[key] || 0, th = known ? threatOf(state, c, key) : { level: 0, mult: 1 };
    return { cell: key, block: n, trail: Math.round(trail), threat: th.level, known,
      p: Math.min(X.max, ((X.base + X.perBlock * (n - 1)) * th.mult + (c.alert * X.perAlert + trail * T.perTrail) * th.mult + over * X.load) * night * CRAWL.GRIDSTEP.step) };
  };
  const breakout = c.alert >= X.fightAlert && c.block >= X.fightFrom && !(c.leaving && c.leaving.started);
  let cells;
  if (c.leaving && c.leaving.cells) cells = c.leaving.cells;
  else if (way === "line") { const [x, y] = xyOf(c.cell); cells = lineOut(c.grid, x, y, dir ?? c.heading); }
  else cells = c.path.slice(0, -1).reverse(); // the path back, not the block you stand on
  const steps = cells.map((k) => at(k, !!c.blocks[k] || !!mem.cells[k]));
  const any = 1 - steps.reduce((a, s) => a * (1 - s.p), 1);
  const hours = steps.reduce((a, s) => a + (s.known ? CRAWL.EXIT_HOURS : CRAWL.MOVE_HOURS), 0);
  return { way, dir: way === "line" ? (dir ?? c.heading) : null, steps, any: breakout ? 1 : any, breakout, hours, edge: onEdge(c) };
}
export const onEdge = (c) => { const [x, y] = xyOf(c.cell); return isEdge(c.grid, x, y); };
// Where a turn from here leads: { way, heading, cell (null: off the grid, out of the city), level }.
export function waysOn(c) {
  const [x, y] = xyOf(c.cell);
  return ["left", "straight", "right"].map((way) => {
    const h = turn(c.heading, way), [dx, dy] = DIRS[h], nx = x + dx, ny = y + dy;
    const cell = inGrid(c.grid, nx, ny) ? keyOf(nx, ny) : null;
    return { way, heading: h, dir: DIR_NAMES[h], cell, level: cell ? levelOf(c.grid, nx, ny) : 0, ring: cell ? ringOf(c.grid, nx, ny) : 0 };
  });
}
// On to the next block: left, right or straight on from the way you are heading (an hour's walk; maybe trouble on the
// way, an encounter), then that block's card. The blocks deeper in toward the centre are more dangerous and richer.
export function nextBlock(state, p, way = "straight") {
  const c = crawlOf(state, p);
  if (!c) return "The team is not in a city.";
  if (c.enc) return "Deal with what is in front of you first.";
  const opt = waysOn(c).find((w) => w.way === way);
  if (!opt || !opt.cell) return "That way leads out of the city: leave from here.";
  const blk = blockOf(c);
  const wall = blk.events.find((e) => !e.done && EVENTS[e.key].blocking);
  if (wall && way === "straight") return `${EVENTS[wall.key].title}: the way straight on is blocked until you clear it or find a way around.`;
  const risk = moveRisk(state, c, opt.cell);
  addAlert(c, CRAWL.ALERT.move);
  if (!passHours(state, p, CRAWL.MOVE_HOURS)) return crawlGoneText(state, p);
  if (c.enc) return ""; // one of you turned on the way (crawlTurned): that first
  const from = { cell: c.cell, heading: c.heading };
  if (state.rng.chance(risk)) {
    c.enc = makeEncounter(state, c, opt.level, { move: opt.cell, heading: opt.heading, cell: opt.cell });
    say2(c, `On the way ${opt.dir}: ${c.enc.text}`, "danger", state.hour);
    return ""; // the encounter card says it
  }
  arriveBlock(state, p, opt.cell, opt.heading, from);
  return "";
}
function arriveBlock(state, p, key, heading = null, from = null) {
  const c = p.crawl;
  c.prev = from || { cell: c.cell, heading: c.heading };
  c.cell = key;
  if (heading != null) c.heading = heading;
  c.block = levelAt(c, key);
  c.deepest = Math.max(c.deepest, c.block);
  // The way back: the path, with any loop you walked cut out (you are where you were: the way back from here is shorter).
  const i = c.path.indexOf(key);
  if (i >= 0) c.path.length = i + 1; else c.path.push(key);
  const blk = genBlock(state, c, key);
  noteCell(state, c, key);
  c.fresh = true; // nothing done here yet: you can still slip away unseen (slipAway)
  const th = threatOf(state, c, key);
  say2(c, `${blk.street}: ${DEPTHS[Math.min(c.block, DEPTHS.length - 1)]}. Zombie activity: ${th.name.toLowerCase()}.${onEdge(c) ? " The edge of the city: you can leave from here." : ""}`, th.level >= 4 ? "danger" : "info", state.hour);
}
// Slip away from a block you have just come into (too many of the dead): back the way you came onto the block before,
// quietly, before anything here notices you. Stealth + d10 against SLIP.dc + its activity level × perThreat + the
// heat here / perHeat (+ big a person over three). Fail: they have seen you (an encounter here, spotted).
export function slipChance(state, p, c = p.crawl) {
  const H = CRAWL.SLIP, th = threatOf(state, c, c.cell);
  const dc = H.dc + th.level * H.perThreat + blockHeat(state, c, c.cell, th.mult) / H.perHeat + Math.max(0, partyMembers(state, p).length - 3) * CRAWL.HIDE.big;
  return clamp((bestSkill(state, p, "stealth") + 10 - Math.ceil(dc) + 1) / 10, 0.05, 0.95);
}
export function slipAway(state, p) {
  const c = crawlOf(state, p);
  if (!c) return "The team is not in a city.";
  if (c.enc) return "Deal with what is in front of you first.";
  if (!c.fresh || !c.prev) return "You have made yourselves known here: there is no slipping away now.";
  const ok = state.rng.chance(slipChance(state, p, c));
  if (!passHours(state, p, CRAWL.SLIP.hours)) return crawlGoneText(state, p);
  if (!p.crawl || c.enc) return "";
  if (!ok) {
    c.fresh = false;
    c.enc = makeEncounter(state, c, c.block, { spotted: true, cell: c.cell });
    say2(c, `Backing out, you are seen: ${c.enc.text}`, "danger", state.hour);
    return "";
  }
  gainXpAll(state, partyMembers(state, p), "stealth", USE.sneakSearch);
  const back = c.prev;
  c.path.pop();
  c.cell = back.cell; c.heading = back.heading; c.block = levelAt(c, back.cell); c.prev = null; c.fresh = false;
  genBlock(state, c, back.cell);
  say2(c, `You back out of there unseen, onto ${blockOf(c).street} again. Another way, then.`, "good", state.hour);
  return "";
}
// Lie low: an hour off the street, the Alert fades (and a little trouble now and then).
export function lieLow(state, p) {
  const c = crawlOf(state, p);
  if (!c) return "The team is not in a city.";
  if (c.enc) return "Deal with what is in front of you first.";
  const risk = moveRisk(state, c, c.cell) * 0.4;
  addAlert(c, -CRAWL.ALERT.lieLow);
  c.alert = Math.max(c.floor, c.alert);
  if (!passHours(state, p, CRAWL.LIE_LOW_HOURS)) return crawlGoneText(state, p);
  if (c.enc) return ""; // one of you turned (crawlTurned)
  if (state.rng.chance(risk)) {
    c.enc = makeEncounter(state, c, c.block, { cell: c.cell });
    say2(c, `Lying low: ${c.enc.text}`, "danger", state.hour);
    return "";
  }
  say2(c, `You lie low for an hour. Alert ${alertName(c.alert)} (${Math.round(c.alert)}).`, "info", state.hour);
  return "";
}

// Look around: an hour watching the block's places from a doorway (Scouting). What the team can make out of each
// place's upper floors (floorfolk.js: lights, voices and a watcher, something nesting) goes on the block card (place.known);
// one look a block each visit. No noise, but the hour passes (the Alert creeps up, CRAWL.ALERT.creep).
export function lookAround(state, p) {
  const c = crawlOf(state, p);
  if (!c) return "The team is not in a city.";
  if (c.enc) return "Deal with what is in front of you first.";
  const blk = blockOf(c);
  if (blk.looked) return "You have looked this block over already.";
  const L = FOLK.LOOK;
  const chance = Math.min(L.max, L.base + L.perScout * bestSkill(state, p, "scouting"));
  blk.looked = true;
  const seen = [], missed = [];
  for (const pl of blk.places) {
    if (pl.blocked || placeStoreys(state, c, pl) < 2) continue;
    if (pl.known || state.rng.chance(chance)) { pl.known = true; seen.push(pl); } else missed.push(pl);
  }
  gainXpAll(state, partyMembers(state, p), "scouting", USE.survey);
  if (!passHours(state, p, L.hours)) return crawlGoneText(state, p);
  const text = `An hour watching the block from a doorway.${seen.length ? ` ${seen.map((pl) => `${pl.name}: ${folkHint(pl)}`).join(". ")}.` : ""}${missed.length ? ` ${missed.map((x) => x.name).join(", ")}: nothing you could make out.` : ""}${!seen.length && !missed.length ? " Nothing here has an upper floor worth watching." : ""}`;
  say2(c, text, "info", state.hour);
  return text;
}
// The chance a look reads a place (the window's tip).
export const lookChance = (state, p) => Math.min(FOLK.LOOK.max, FOLK.LOOK.base + FOLK.LOOK.perScout * bestSkill(state, p, "scouting"));

// ---------- leaving ----------
// Back out to the edge, a block at a time: each can hold trouble (exitRisk); at a high Alert from deep in, the first
// block on the way is a breakout.
// way: "here" (you stand on the rim: you walk out), "back" (the path you came in by, through the heat you left), "line"
// (dir 0-3: straight on in one direction to the rim, through blocks you may not know).
export function leaveCity(state, p, way = "back", dir = null) {
  const c = crawlOf(state, p);
  if (!c) return "The team is not in a city.";
  if (c.enc) return "Deal with what is in front of you first.";
  const X = CRAWL.EXIT;
  if (way === "here" || (way === "back" && c.path.length <= 1)) {
    if (!onEdge(c)) return "This is not the edge of the city: go back the way you came, or keep going one way to the edge.";
    say2(c, "You walk out of the city here.", "info", state.hour);
    return finishCrawl(state, p);
  }
  const d = dir ?? c.heading;
  const ex = exitRisk(state, p, c, way === "line" ? "line" : "back", d);
  c.leaving = { way: ex.way, dir: ex.dir, cells: ex.steps.map((x) => x.cell), at: c.block };
  say2(c, ex.way === "line" ? `You head ${DIR_NAMES[d]}, keeping to one direction until you reach the edge of the city.` : "You head back the way you came.", "info", state.hour);
  if (c.alert >= X.fightAlert && c.block >= X.fightFrom) {
    c.leaving.started = true;
    c.enc = makeEncounter(state, c, c.block, { exit: true, breakout: true, cell: c.cell });
    say2(c, c.enc.text, "danger", state.hour);
    return "";
  }
  c.leaving.started = true;
  return stepLeave(state, p);
}
// On the way out with nothing in front of you (a save made between two blocks): keep going.
export function continueLeaving(state, p) {
  const c = crawlOf(state, p);
  if (!c || !c.leaving || c.enc) return "";
  return stepLeave(state, p);
}
// A block at a time: walk onto the next block of the way out (the map follows you), roll its trouble; past the last one
// you are out (the last block is on the rim).
function stepLeave(state, p) {
  const c = p.crawl;
  if (!c) return ""; // the crawl already ended (a team wiped on the way out)
  while (c.leaving && c.leaving.cells && c.leaving.cells.length) {
    const key = c.leaving.cells[0];
    const known = !!c.blocks[key] || !!memOf(state.tiles[c.tile]).cells[key];
    const risk = exitRiskOf(state, p, c, key);
    if (!passHours(state, p, known ? CRAWL.EXIT_HOURS : CRAWL.MOVE_HOURS)) return crawlGoneText(state, p);
    if (!p.crawl) return ""; // the hour wiped the team and ended the crawl
    if (c.enc) return ""; // one of you turned (crawlTurned)
    if (state.rng.chance(risk)) {
      const th = threatOf(state, c, key);
      c.enc = makeEncounter(state, c, levelAt(c, key), { exit: true, cell: key });
      say2(c, `On the way out (${th.name.toLowerCase()} streets${(c.trail || {})[key] >= 10 ? "; the dead your noise drew here are still about" : ""}): ${c.enc.text}`, "danger", state.hour);
      return "";
    }
    passThrough(state, c, key);
  }
  return p.crawl ? finishCrawl(state, p) : "";
}
// The trouble on one block of the way out (as exitRisk's steps, with the block's own activity once it is rolled).
function exitRiskOf(state, p, c, key) {
  const X = CRAWL.EXIT, T = CRAWL.TRAIL;
  const n = levelAt(c, key), trail = (c.trail || {})[key] || 0, m = threatOf(state, c, key).mult;
  return Math.min(X.max, ((X.base + X.perBlock * (n - 1)) * m + (c.alert * X.perAlert + trail * T.perTrail) * m + crawlLoad(state, p).over * X.load) * (isNight(state) ? X.night : 1) * CRAWL.GRIDSTEP.step);
}
// Onto a block of the way out: it is where you are now (the map, the level), and it leaves the list.
function passThrough(state, c, key) {
  c.leaving.cells.shift();
  const [x0, y0] = xyOf(c.cell), [x1, y1] = xyOf(key);
  const h = DIRS.findIndex(([dx, dy]) => dx === Math.sign(x1 - x0) && dy === Math.sign(y1 - y0));
  c.cell = key; if (h >= 0) c.heading = h; c.block = levelAt(c, key); c.leaving.at = c.block;
  if (c.leaving.way === "back") { const i = c.path.indexOf(key); if (i >= 0) c.path.length = i + 1; } else c.path.push(key);
  genBlock(state, c, key);
  noteCell(state, c, key);
}
function finishCrawl(state, p) {
  const c = p.crawl;
  if (!c) return "";
  const t = state.tiles[c.tile];
  const mem = memOf(t);
  mem.alert = c.alert;
  mem.hour = state.hour;
  Object.assign(mem.snaps, c.buildings); // the buildings as you left them, for the next visit (unless another group goes through)
  delete p.crawl;
  const got = [...Object.entries(c.tally.supplies).map(([k, v]) => `${v} ${keyWord(k)}`), ...c.tally.gear];
  const text = `Out of ${c.city} after ${state.hour - c.started} h, as deep as block ${c.deepest}${got.length ? `, with ${got.join(", ")}` : ", empty-handed"}.${c.lost.length ? ` Lost: ${c.lost.join(", ")}.` : ""}`;
  log(state, `${teamName(state, p)}: ${text}`, got.length ? "good" : "info");
  noteSearch(state, partyMembers(state, p));
  awaitOrders(state, p, text);
  return text;
}
function crawlWiped(state, p, line) {
  const c = p.crawl;
  delete p.crawl;
  if (c) {
    const t = state.tiles[c.tile];
    const mem = memOf(t);
    mem.alert = c.alert; mem.hour = state.hour;
    Object.assign(mem.snaps, c.buildings);
    log(state, `${line ? line + " " : ""}The team died in ${c.city}, ${c.block > 1 ? `${c.block} levels in` : "near its edge"}. What they carried lies where they fell.`, "death");
  }
  wipeParty(state, p);
}
function crawlGoneText(state, p) {
  if (state.parties.includes(p) && !partyMembers(state, p).length) crawlWiped(state, p, "");
  return "The team is gone.";
}

// ---------- encounters ----------
// What the team runs into on the street: a horde (the dead; the special dead deeper), a patrol of raiders, or at a high
// Alert on the way out a breakout (a big horde between you and the edge).
// One of the team died with the worm in them on a block card (worm.js wormRise, from the midnight tick while the crawl passes its
// hours): the encounter "One of you turned", fought like the street encounters (the window's choices, the autopilot's
// crawlAutoStep); the Alert rises. With an encounter already in front of them, the risen joins it. Returns true.
export function crawlTurned(state, p, s) {
  const c = crawlOf(state, p);
  if (!c) return false;
  const name = `${s.name.split(" ")[0]} (turned)`;
  if (c.enc) {
    c.enc.enemy = { ...c.enc.enemy, count: (c.enc.enemy.count || 0) + 1 };
    c.enc.text = `${c.enc.text} And ${s.name} has just died among you with the worm in them and got up again: one more of the dead.`;
  } else c.enc = makeEncounter(state, c, c.block, { kind: "turned", name, who: s.name, cell: c.cell });
  addAlert(c, CRAWL.ALERT.turned);
  say2(c, `One of you turned: ${s.name} died with the worm in them and got up again, the worm in their eyes.`, "danger", state.hour);
  return true;
}
function makeEncounter(state, c, n, ctx) {
  const t = state.tiles[c.tile];
  const rng = state.rng;
  const inf = t.infection || 0;
  const E = CRAWL.ENC;
  if (ctx.kind === "turned") {
    const enemy = { kind: "zombies", count: 1, power: 2 + inf * 3 + CRAWL.DEAD.powerPerBlock * (n - 1), name: ctx.name || "one of you, turned" };
    return { kind: "turned", block: n, enemy, text: `One of you turned: ${ctx.who || "one of the team"} died with the worm in them and got up again among you, the worm in their eyes.`, move: null, exit: false, event: null, spotted: true };
  }
  const raiders = !ctx.breakout && !ctx.kind && n >= 2 && rng.chance(E.raiders + E.raidersPerBlock * (n - 2));
  const kind = ctx.kind || (ctx.breakout ? "breakout" : raiders ? "patrol" : "horde");
  let enemy;
  if (kind === "patrol") {
    const P = CRAWL.PATROL;
    enemy = { kind: "raiders", count: Math.min(P.max, P.base + Math.ceil(n / 2) + (ctx.small ? -1 : 0)), power: P.power + P.powerPerBlock * (n - 1), name: "a raider patrol" };
  } else {
    const Hh = CRAWL.HORDE;
    const where = ctx.cell || ctx.move || c.cell;
    const mult = ctx.mult ?? threatOf(state, c, where).mult; // CRAWL.THREAT: the block's activity × its heat
    let count = (Hh.base + Hh.perBlock * n) * Math.sqrt(mult) + blockHeat(state, c, where, mult) / Hh.alertDiv;
    if (kind === "breakout") count *= Hh.breakout;
    if (ctx.small) count *= 0.5;
    enemy = { kind: "zombies", count: Math.min(Hh.max, Math.max(2, Math.round(count))), power: 2 + inf * 3 + CRAWL.DEAD.powerPerBlock * (n - 1), name: kind === "breakout" ? "the dead filling the streets" : "a horde" };
    const sp = specialChance(state, n);
    if (sp > 0) {
      const k = Math.round(enemy.count * sp);
      if (k > 0) enemy.types = { [crawlKind(state, rng)]: k };
    }
    // The armoured dead of the city (deadsoldiers.js siteDeadMix: riot police, soldiers near a base): no dice.
    const mil = siteDeadMix(state, c.tile);
    if (mil) {
      enemy.mix = mil;
      const add = battleTypes(mil, enemy.count) || {};
      const have = Object.values(enemy.types || {}).reduce((a, v) => a + v, 0);
      for (const k of Object.keys(add)) { const m = Math.min(add[k], enemy.count - have); if (m > 0) (enemy.types = enemy.types || {})[k] = m; }
    }
  }
  const text = kind === "patrol" ? `${enemy.count} raiders come down the street, guns up.` :
    kind === "breakout" ? `The city is roused: ${enemy.count} of the dead fill the streets between you and the edge. You will have to fight your way out, or find a gap.` :
    `${enemy.count} of the dead${enemy.types ? ` (${Object.entries(enemy.types).map(([k, v]) => `${v} ${ZTYPES[k] ? ZTYPES[k].name.toLowerCase() : "special"}${v > 1 ? "s" : ""}`).join(", ")})` : ""} shamble into the street ahead.`;
  return { kind, block: n, cell: ctx.cell || ctx.move || c.cell, heading: ctx.heading ?? null, enemy, text, move: ctx.move || null, exit: !!ctx.exit, event: ctx.event || null, spotted: !!ctx.spotted };
}
const runHurt = (e, over) => { const R = CRAWL.RUN; return Math.min(R.max, R.hurt + R.perBlock * e.block + over * R.load + (e.kind === "patrol" ? R.patrol : 0)); };
// The fight's setup (combat.js): on a street map, or by the numbers.
function encSetup(p, c, e) {
  return {
    tile: c.tile, partyId: p.id, enemy: { ...e.enemy }, ambush: e.spotted ? "enemy" : null, canRetreat: true, handler: "crawlfight",
    context: { crawl: { kind: "enc", block: e.block, cell: e.cell, heading: e.heading, move: e.move, exit: e.exit, event: e.event } },
  };
}
// The odds and options an encounter offers (the window and the autopilot).
export function encounterOptions(state, p) {
  const c = p.crawl;
  const e = c && c.enc;
  if (!e) return [];
  const odds = byNumbersOdds(state, encSetup(p, c, e));
  const H = CRAWL.HIDE;
  const over = crawlLoad(state, p).over;
  const members = partyMembers(state, p);
  const dc = (e.spotted ? H.spottedDc : 0) + H.dc + H.perBlock * e.block + c.alert * H.perAlert + (isNight(state) ? H.night : 0) + over * H.load + Math.max(0, members.length - 3) * H.big + (e.kind === "breakout" ? 2 : 0);
  const st = bestSkill(state, p, "stealth");
  const hide = clamp((st + 10 - Math.ceil(dc) + 1) / 10, 0, 1);
  const lure = lureOf(state, p);
  const R = CRAWL.RUN;
  const hurtP = runHurt(e, over);
  const out = [
    { id: "fight", label: "Fight (battle map)", tip: `Fight it out on the street. By the numbers you would win about ${Math.round(odds.win * 100)}%.`, odds: odds.win },
    { id: "numbers", label: "Fight by the numbers", tip: `Quick: about ${Math.round(odds.win * 100)}% to win; a lost fight against the dead can cost everyone. Gunfire raises the Alert.`, odds: odds.win },
  ];
  if (e.kind !== "patrol" || !e.spotted) out.push({ id: "hide", label: e.spotted ? "Break contact and hide" : "Hide", tip: `Stealth ${st} + d10 against ${Math.ceil(dc)}: about ${Math.round(hide * 100)}%. An hour. Fail and they find you first.`, odds: hide });
  if (e.kind !== "patrol") out.push({ id: "lure", label: lure ? `Throw ${lure.key === "noisemaker" ? "a noise maker" : lure.key === "firecracker" ? "firecrackers" : "a bottle"}` : "Throw something (none carried)", tip: lure ? `Pull them away down a side street: about ${Math.round(CRAWL.LURE[lure.key] * 100)}%.` : "Carry a noise maker, firecrackers or bottles to lure the dead away.", odds: lure ? CRAWL.LURE[lure.key] : 0, disabled: !lure });
  out.push({ id: "run", label: e.exit ? "Run for it" : e.move ? "Fall back" : "Run", tip: `${e.exit ? "Sprint for the edge" : e.move ? "Back to the block you came from" : "Get away"}: each of you about ${Math.round(hurtP * 100)}% to be hurt on the way.${over > 0 ? " Overloaded: slower." : ""}`, odds: 1 });
  return out;
}
// The answer to an encounter. opts.map: a fight on the street map (the browser), else by the numbers.
export function resolveEncounter(state, p, choice, opts = {}) {
  const c = crawlOf(state, p);
  if (!c || !c.enc) return "Nothing to answer.";
  const e = c.enc;
  const rng = state.rng;
  const members = partyMembers(state, p);
  if (choice === "fight" || choice === "numbers") {
    const setup = encSetup(p, c, e);
    c.enc = { ...e, fighting: true };
    if (choice === "fight" && opts.map && !state.combat) { startCombat(state, setup); return ""; }
    const res = autoResolveCombat(state, setup);
    finishCombat(state, setup, res);
    return res.outcome === "victory" ? "You fought through." : res.outcome === "retreat" ? "You broke off and got away." : "It went badly.";
  }
  if (choice === "hide") {
    const opt = encounterOptions(state, p).find((o) => o.id === "hide");
    if (!opt) return "No way to hide from these.";
    if (!passHours(state, p, 1)) return crawlGoneText(state, p);
    if (rng.chance(opt.odds)) {
      gainXpAll(state, partyMembers(state, p), "stealth", USE.sneakSearch);
      say2(c, `You hide until ${e.kind === "patrol" ? "they pass" : "they shuffle on"}.`, "good", state.hour);
      return continueAfter(state, p, e, true);
    }
    c.enc = { ...e, spotted: true };
    say2(c, "They found you! No time to slip away now.", "danger", state.hour);
    return "They found you.";
  }
  if (choice === "lure") {
    const lure = lureOf(state, p);
    if (!lure || e.kind === "patrol") return "Nothing to throw.";
    lure.take();
    if (lure.key === "firecracker") addAlert(c, 6);
    if (rng.chance(CRAWL.LURE[lure.key])) {
      say2(c, `The ${lure.key === "noisemaker" ? "noise maker" : lure.key === "firecracker" ? "firecrackers" : "bottle"} pulls them away down a side street.`, "good", state.hour);
      return continueAfter(state, p, e, true);
    }
    c.enc = { ...e, spotted: true };
    say2(c, "They ignore the lure and come straight for you.", "danger", state.hour);
    return "The lure failed.";
  }
  if (choice === "run") {
    const R = CRAWL.RUN;
    const over = crawlLoad(state, p).over;
    const hurtP = runHurt(e, over);
    const hit = [];
    for (const s of members) {
      if (!rng.chance(hurtP)) continue;
      hurt(state, s, rng.int(R.dmg[0], R.dmg[1]) + R.dmgPerBlock * e.block, c.tile, `running from ${e.enemy.name} in ${c.city}`);
      hit.push(s.alive ? s.name.split(" ")[0] : `${s.name} (killed)`);
      if (!s.alive) c.lost.push(s.name);
    }
    addAlert(c, 4);
    say2(c, `You run.${hit.length ? ` Hurt on the way: ${hit.join(", ")}.` : " Everyone gets clear."}`, hit.length ? "danger" : "info", state.hour);
    if (!partyMembers(state, p).length) { crawlWiped(state, p, ""); return "Nobody got away."; }
    if (!passHours(state, p, 1)) return crawlGoneText(state, p);
    // Running: on the way out you get through; going deeper you fall back where you were; elsewhere you get away.
    if (e.move) { c.enc = null; say2(c, `You fall back onto ${blockOf(c).street}.`, "info", state.hour); return "You fell back."; }
    return continueAfter(state, p, e, true);
  }
  return "Unknown choice.";
}
// After an encounter: on the way deeper you arrive; on the way out you go on; an event's fight is just over.
function continueAfter(state, p, e, ok) {
  const c = p.crawl;
  if (!c) return "";
  c.enc = null;
  if (!ok) {
    if (e.move) { say2(c, `Driven back, you stay on ${blockOf(c).street}.`, "danger", state.hour); return "Driven back."; }
    if (e.exit) {
      // Pinned down: back on that block's card; leave again (new rolls), lie low first, or search.
      // Pinned down where it happened: that block's card; leave again (new rolls), lie low first, or search.
      if (c.leaving && e.cell && e.cell !== c.cell) passThrough(state, c, e.cell);
      c.leaving = null;
      genBlock(state, c, c.cell);
      say2(c, `Pinned down on ${blockOf(c).street}. You will have to try again.`, "danger", state.hour);
      return "Pinned down.";
    }
    return "";
  }
  if (e.move) { arriveBlock(state, p, e.move, e.heading ?? null); return ""; }
  if (e.exit && c.leaving) {
    if (c.leaving.cells && c.leaving.cells[0] === e.cell) passThrough(state, c, e.cell); // through it
    return stepLeave(state, p);
  }
  return "";
}
// A street fight is over (combat.js finishCombat): on a map or by the numbers.
registerCombatHandler("crawlfight", afterFight);
function afterFight(state, result, setup, battle) {
  const p = partyById(state, setup.partyId);
  const ctx = (setup.context && setup.context.crawl) || {};
  if (!p || !state.parties.includes(p)) return;
  if (!partyMembers(state, p).length) { crawlWiped(state, p, `Killed by ${setup.enemy.name}.`); return; }
  const c = p.crawl;
  if (!c) return;
  c.kills += result.enemiesKilled || 0;
  for (const id of result.survivorsDead || []) { const s = state.survivors.find((x) => x.id === id); if (s) c.lost.push(s.name); }
  addAlert(c, battle ? CRAWL.ALERT.mapFight + (result.ammoUsed || 0) / 20 : CRAWL.ALERT.fight);
  const ok = result.outcome === "victory" || result.outcome === "retreat";
  const dead = (result.survivorsDead || []).map((id) => state.survivors.find((x) => x.id === id)?.name).filter(Boolean);
  say2(c, `Fight with ${setup.enemy.name}: ${result.outcome === "victory" ? "won" : result.outcome === "retreat" ? "broke off and got away" : "lost"}.${dead.length ? ` Killed: ${dead.join(", ")}.` : ""}`, ok ? "good" : "danger", state.hour);
  if (ctx.kind === "quick") return; // quickSearch goes on with the search
  const e = c.enc || { block: ctx.block, cell: ctx.cell, heading: ctx.heading, move: ctx.move, exit: ctx.exit, event: ctx.event };
  continueAfter(state, p, e, ok);
}

// ---------- street events ----------
export function eventChoices(state, p, ev) {
  const E = EVENTS[ev.key];
  if (!E || ev.done) return [];
  return E.choices.map((ch) => ({ ...ch, tip: ch.tip || "" }));
}
export function resolveEvent(state, p, eventId, choice, opts = {}) {
  const c = crawlOf(state, p);
  if (!c) return "The team is not in a city.";
  if (c.enc) return "Deal with what is in front of you first.";
  const blk = blockOf(c);
  const ev = blk.events.find((x) => x.id === eventId);
  if (!ev || ev.done) return "That is over.";
  const E = EVENTS[ev.key];
  const rng = state.rng;
  const n = c.block;
  const members = partyMembers(state, p);
  const scav = bestSkill(state, p, "scavenging");
  const rich = placeRichness(state, c, { rich: 1, looted: 0 });
  const done = (text, k = "info") => { ev.done = true; ev.result = text; say2(c, `${E.title}: ${text}`, k, state.hour); return text; };
  const fightNow = (kind, extra = {}) => {
    ev.done = true;
    c.enc = makeEncounter(state, c, n, { kind, event: ev.id, ...extra });
    ev.result = c.enc.text;
    say2(c, `${E.title}: ${c.enc.text}`, "danger", state.hour);
    return c.enc.text;
  };
  if (choice === "leave" || choice === "ignore") {
    if (choice === "ignore") addAlert(c, 4);
    return done(choice === "ignore" ? "You keep going. The voice calls after you for a long time." : "You leave it.");
  }
  switch (ev.key) {
    case "car": {
      const r = rollArea(rng, "wreck", rich, scav);
      const text = give(state, p, c, r.sup, r.gear);
      if (rng.chance(0.15)) {
        addAlert(c, CRAWL.ALERT.alarm);
        if (rng.chance(0.5)) { ev.done = true; const t = fightNow("horde", { small: true }); return `The car alarm goes off! ${text}. ${t}`; }
        return done(`The car alarm goes off (Alert +${CRAWL.ALERT.alarm})! You grab ${text} and get clear.`, "danger");
      }
      return done(`You find ${text}.`, "good");
    }
    case "ambulance":
    case "checkpoint": {
      const mil = ev.key === "checkpoint";
      if (choice === "map") {
        if (!opts.map) return eventGrab(state, p, c, ev, mil, done, fightNow);
        const inf = state.tiles[c.tile].infection || 0;
        const dead = { kind: "zombies", count: Math.round((mil ? 4 : 3) + n * 0.8 + inf * 3), power: 2 + inf * 3 + CRAWL.DEAD.powerPerBlock * (n - 1) + (mil ? 1 : 0), name: mil ? "the dead in uniform" : "the dead" };
        if (mil) dead.mix = { soldier: MILDEAD.CHECKPOINT }; // the soldiers who held it, still in their armour (deadsoldiers.js)
        const err = enterStreet(state, p, ev, mil ? ["barracks", "armory", "wreck", "campsite"] : ["medwreck", "wreck", "wreck"], [dead], mil ? "military" : "city");
        return err;
      }
      return eventGrab(state, p, c, ev, mil, done, fightNow);
    }
    case "survivor": {
      if (choice === "hush") {
        if (rng.chance(0.7)) return done("They go quiet and wave you on.");
        addAlert(c, 6);
        return done("They keep shouting (Alert +6).", "danger");
      }
      const roll = rng.next();
      if (n >= 2 && roll < 0.1 + 0.03 * n) return fightNow("patrol", { small: true, spotted: true }); // bait: raiders (deeper in)
      if (roll < 0.65) {
        const s = makeCandidate(state, { quality: 0.8, minHealth: 40 });
        offerRecruits(state, [s], { partyId: p.id });
        return done(`${s.name} has been holed up here for weeks. They ask to come with you.`, "good");
      }
      // Someone who knows these streets: the next block's places are scouted (looks exact) and a stash.
      const r = rollArea(rng, rng.pick(["house", "store", "house"]), rich, scav); // his flat's cupboards (meds: medfinds.js)
      const text = give(state, p, c, r.sup, r.gear);
      addAlert(c, -5);
      return done(`An old man who will not leave his flat. He shares what he can spare (${text}) and tells you which streets the dead avoid (Alert −5).`, "good");
    }
    case "horde": {
      if (choice === "wait") {
        if (!passHours(state, p, 2)) return crawlGoneText(state, p);
        if (rng.chance(0.2 + 0.03 * n)) return fightNow("horde", { spotted: false });
        addAlert(c, -4);
        return done("You wait it out in a doorway. Two hours later the street is empty.");
      }
      return fightNow("horde");
    }
    case "smoke": {
      if (!passHours(state, p, 1)) return crawlGoneText(state, p);
      const roll = rng.next();
      if (roll < 0.35) return fightNow("patrol", { small: true });
      if (roll < 0.5) { addAlert(c, 8); return done("The fire flares up as you go in; the smoke rises over the rooftops (Alert +8). Nothing left worth the risk.", "danger"); }
      const r = rollArea(rng, "store", rich * 0.6, scav);
      return done(`Leftovers the looters missed: ${give(state, p, c, r.sup, r.gear)}.`, "good");
    }
    case "lookout": {
      if (choice === "around") {
        if (!passHours(state, p, 1)) return crawlGoneText(state, p);
        return done("An hour around the long way. He never sees you.");
      }
      const st = bestSkill(state, p, "stealth");
      const dc = 6 + n * 0.5 + (choice === "take" ? 2 : 0) + (isNight(state) ? -2 : 0);
      const ok = st + rng.int(1, 10) >= dc;
      if (!ok) { addAlert(c, 10); return fightNow("patrol", { spotted: true }); }
      gainXpAll(state, members, "stealth", USE.sneakSearch);
      if (choice === "sneak") return done("You slip past below his line of sight.", "good");
      for (const pl of blk.places) pl.raiders = false;
      const gear = [lootItem(swapGun("city:sentry", rng.pick(["huntrifle", "pistol", "shotgun"]), rng), "raider", spend(rng))]; // gundist.js: which gun
      return done(`You take him down without a sound: ${give(state, p, c, sortFind({ ammo: rng.int(8, 20) }, "raider", "crawlguard", c.tile, state.hour), gear)}. The raiders on this block are blind now: nobody holed up in its places.`, "good");
    }
    case "truck": {
      if (choice === "siphon") {
        if (!passHours(state, p, 1)) return crawlGoneText(state, p);
        if (rng.chance(0.25)) addAlert(c, 5);
        return done(`You fill what cans you have: ${give(state, p, c, { fuel: rng.int(4, 10) }, [])}.`, "good");
      }
      if (rng.chance(0.2 + 0.03 * n)) { addAlert(c, 4); return fightNow("horde", { small: true, spotted: true }); }
      const r = rollArea(rng, "warehouse", rich, scav);
      addSup(r.sup, { food: rng.int(3, 10), water: rng.int(2, 8) });
      addAlert(c, 4);
      return done(`The padlock gives: ${give(state, p, c, r.sup, r.gear)}.`, "good");
    }
    case "body": {
      if (rng.chance(0.25)) {
        const v = rng.pick(members);
        hurt(state, v, rng.int(8, 22), c.tile, `bitten by a body that was not dead in ${c.city}`);
        if (!v.alive) c.lost.push(v.name);
        else say2(c, `It was not dead: it bites ${v.name.split(" ")[0]} before you put it down.`, "danger", state.hour);
      }
      const pack = lootItem(rng.pick(["slingbag", "backpack", "backpack", "hikingpack"]), "survivor", spend(rng));
      const r = rollArea(rng, "house", rich, scav);
      addSup(r.sup, { food: rng.int(1, 4), water: rng.int(0, 3), ammo: rng.chance(0.5) ? rng.int(4, 14) : 0 });
      const text = give(state, p, c, sortFind(r.sup, "home", "crawlbody", c.tile, state.hour), [pack, ...r.gear]); // ammo.js: rounds by calibre
      if (!partyMembers(state, p).length) { crawlWiped(state, p, ""); return "The body was not dead."; }
      return done(`${text}.`, "good");
    }
    case "rooftop": {
      if (!passHours(state, p, 1)) return crawlGoneText(state, p);
      addAlert(c, 4);
      if (rng.chance(0.25)) {
        const v = rng.pick(members);
        hurt(state, v, rng.int(15, 35), c.tile, `a fall from a fire escape in ${c.city}`);
        if (!v.alive) { c.lost.push(v.name); if (!partyMembers(state, p).length) { crawlWiped(state, p, ""); return "The fall killed them."; } }
        else say2(c, `${v.name.split(" ")[0]} falls from the fire escape.`, "danger", state.hour);
      }
      const sup = {}, gear = [];
      for (let i = 0; i < 3; i++) { const r = rollArea(rng, "cargodrop", Math.max(1.2, rich), scav); addSup(sup, r.sup); gear.push(...r.gear); }
      return done(`The pallet is intact: ${give(state, p, c, sup, gear)}.`, "good");
    }
    case "rubble": {
      if (choice === "clear") { if (!passHours(state, p, 1)) return crawlGoneText(state, p); addAlert(c, 6); return done("An hour of shifting brick. The way is open (Alert +6)."); }
      if (!passHours(state, p, 2)) return crawlGoneText(state, p);
      return done("Two hours through back alleys and courtyards. You come out past the rubble.");
    }
    default: return done("Nothing happens.");
  }
}
// The ambulance or the checkpoint searched by the numbers.
function eventGrab(state, p, c, ev, mil, done, fightNow) {
  const rng = state.rng;
  const n = c.block;
  const members = partyMembers(state, p);
  const scav = bestSkill(state, p, "scavenging");
  const rich = placeRichness(state, c, { rich: 1.1, looted: 0 });
  if (rng.chance(mil ? 0.3 : 0.35)) {
    if (mil) return fightNow("horde", { small: true, spotted: true });
    const v = rng.pick(members);
    hurt(state, v, rng.int(10, 25), c.tile, `bitten in a crashed ambulance in ${c.city}`);
    if (!v.alive) { c.lost.push(v.name); if (!partyMembers(state, p).length) { crawlWiped(state, p, ""); return "Nobody got out."; } }
    say2(c, `Something strapped in the back gets its teeth into ${v.name.split(" ")[0]}.`, "danger", state.hour);
  }
  const sup = {}, gear = [];
  for (let i = 0; i < 2; i++) { const r = rollArea(rng, mil ? (i ? "barracks" : "armory") : "medwreck", rich, scav, mil ? "military" : "city"); addSup(sup, r.sup); gear.push(...r.gear); }
  if (mil) addSup(sup, { ammo: rng.int(8, 25) });
  sortFind(sup, mil ? "military" : "home", "crawlwreck", c.tile, state.hour); // ammo.js: rounds by calibre
  return done(`You grab ${give(state, p, c, sup, gear)}.`, "good");
}

// ---------- the autopilot ----------
// A crawl on autopilot (autopilot.js idleTeams, once an hour): at the rim it plans the level to work (autoDepth) and walks
// in toward it, turning away from blocks it knows are crawling; on a block it has just come into that is too hot
// (activity AUTO.slipThreat+, or Infested with heat) it slips away and goes another way; at its level it searches the
// places it can win (AUTO.searchOdds), then moves on along the level (or a level deeper, AUTO.depth at most) to another
// block it has not worked, AUTO.blocks at most, until hurt or loaded; then it leaves the safest way (from the rim:
// straight out; else back the way it came or straight on in one of the four directions, the lowest risk). Encounters:
// fight what it should win, else hide, lure or run.
export function crawlAutoStep(state, p) {
  const c = crawlOf(state, p);
  if (!c) return;
  if (c.inside) { if (!state.combat) c.inside = null; else return; }
  const A = CRAWL.AUTO;
  if (c.enc) {
    const opts = encounterOptions(state, p);
    const fight = opts.find((o) => o.id === "numbers");
    const lure = opts.find((o) => o.id === "lure" && !o.disabled);
    const hide = opts.find((o) => o.id === "hide");
    // A lost fight by the numbers can cost everyone: it fights only good odds and otherwise slips away or runs.
    const pick = fight && fight.odds >= A.sureOdds ? "numbers" : lure && lure.odds >= 0.7 ? "lure" : hide && hide.odds >= 0.6 && !c.enc.spotted ? "hide" : fight && fight.odds >= A.fightOdds ? "numbers" : "run";
    resolveEncounter(state, p, pick, { map: false });
    return;
  }
  if (c.leaving) { stepLeave(state, p); return; }
  const members = partyMembers(state, p);
  const hurtNow = members.some((s) => s.health < A.hurt);
  const full = crawlLoad(state, p).ratio > A.full || cargoRoom(state, p) < 2;
  const blk = blockOf(c);
  const mem = memOf(state.tiles[c.tile]);
  c.avoid = c.avoid || {};
  const th = threatOf(state, c, c.cell);
  // Too hot a block, just come into: back out quietly and go another way.
  if (c.fresh && c.prev && (th.level >= A.slipThreat || (th.level >= A.slipThreat - 1 && blockHeat(state, c, c.cell, th.mult) >= A.slipHeat)) && slipChance(state, p, c) >= 0.4) {
    c.avoid[c.cell] = true;
    slipAway(state, p);
    return;
  }
  if (!hurtNow && !full) {
    for (const ev of blk.events) if (!ev.done && EVENTS[ev.key].blocking) { resolveEvent(state, p, ev.id, "detour"); return; }
    if (c.autoDepth == null) c.autoDepth = autoDepth(state, p, c); // the level it means to work, judged at the rim
    const known = (k) => (c.blocks[k] ? c.blocks[k].threat : mem.cells[k] && mem.cells[k].threat) || 0;
    const ways = waysOn(c).filter((w) => w.cell && !c.avoid[w.cell] && known(w.cell) < A.slipThreat);
    // On the way in it walks, deeper where it can, the quieter way when it knows.
    if (c.block < c.autoDepth) {
      const [x, y] = xyOf(c.cell), ring = ringOf(c.grid, x, y);
      const go = ways.filter((w) => w.ring > ring).sort((a, b) => known(a.cell) - known(b.cell) || b.ring - a.ring)[0] || ways.filter((w) => w.ring >= ring && !c.blocks[w.cell])[0];
      if (go) { nextBlock(state, p, go.way); return; }
    }
    const fit = blk.places.filter((x) => !x.blocked && searchOdds(state, p, c, x) >= A.searchOdds);
    const todo = fit.filter((x) => !x.quick && !c.buildings[x.id]).sort((a, b) => placeDanger(state, c, a).score - placeDanger(state, c, b).score);
    if (todo.length) { quickSearch(state, p, todo[0]); return; }
    // Come all this way and nothing it is sure of left here: a place it should still win (fightOdds) rather than none.
    const worked = blk.places.some((x) => x.quick);
    const fair = !worked && blk.places.filter((x) => !x.blocked && !x.quick && !c.buildings[x.id] && searchOdds(state, p, c, x) >= A.fightOdds);
    if (fair && fair.length) { quickSearch(state, p, fair[0]); return; }
    // Room to spare: another block it has not been on, along the level or a level deeper (if this one was workable).
    c.worked = (c.worked || 0) + 1;
    if (c.worked < A.blocks) {
      const next = ways.filter((w) => !c.blocks[w.cell] && w.level >= c.block - 0 && w.level <= Math.min(A.depth, c.block + (fit.length ? 1 : 0))).sort((a, b) => b.level - a.level || known(a.cell) - known(b.cell))[0];
      if (next) { nextBlock(state, p, next.way); return; }
    }
  }
  // Out: from the rim straight out; else the lowest risk of the way back and the four straight lines.
  if (onEdge(c)) { leaveCity(state, p, "here"); return; }
  const opts = [{ way: "back", dir: null, r: exitRisk(state, p, c, "back").any }, ...[0, 1, 2, 3].map((d) => ({ way: "line", dir: d, r: exitRisk(state, p, c, "line", d).any }))];
  const best = opts.sort((a, b) => a.r - b.r)[0];
  leaveCity(state, p, best.way, best.dir);
}
