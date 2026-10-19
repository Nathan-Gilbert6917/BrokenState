// Nomads: baseless bands of survivors who camp, raid the places round their camp and move on. Their goal is to
// survive, not to grow. They are not one of the map's groups (state.factions): they live in state.nomads.bands, with
// group-shaped fields (type, pop, goodwill, stock, wares, bases: [], outsider: true) so trade.js can deal with them as
// it deals with the outsiders from visitors.js, and they never join diplomacy, pacts, blocs or the Calder Coalition.
// They hold no land and no claims and never found a base, so the coalition's land share and members never see them.
//
// Tiers (NOMADS.TIERS; fixed for a band's life; unlocked by the era: eras.js yearOf)
// - T0 Drifters (year 1 on): 2–5 people with nothing but what they made themselves out of scrap: pipe spears, spiked
//   bats, shivs, a scrap crossbow or a pipe shotgun, tyre vests (combat.js KITS.drifters, every piece a crafting.js
//   recipe). Wary, not hostile: they trade their makeshift bits for food. The weakest people on the road.
// - T1 Looters (year 1 on): 3–6 people, melee and a few pistols, no armour (combat.js KITS.looters). Hostile. Weak
//   in a fight: they rob a team weaker than them and scatter before one that is stronger.
// - T2 Survivalists (year 2 on): 4–8, the best foragers and hunters and a medic or two, hunting rifles, bows and
//   shotguns, light armour (KITS.survivalists). Neutral, willing to trade.
// - T3 Preppers (year 4 on): 5–10, adequate skills all round, rifles and carbines, plate carriers and steel (armour
//   AC 3 and up, KITS.preppers), a pickup or a Humvee. Neutral and defensive.
// A band starts near the bottom of its tier's range and stays small: it takes in neutral wanderers and refugees only
// while its food allows, less often the bigger it is, never past its tier's cap.
//
// Lifecycle (one daily step, one hourly step; world.js)
// - How many: about half the AI group count of the world size (worldsize.js defGroups / 2, NOMADS.SHARE): the first
//   ones on days FIRST, then one more every FILL days until the count is met; after that a slow respawn (GAP days)
//   holds it there. A band stays LIFE (one to two game years) and then moves off the map or disbands (a log line when
//   seen), so the bands turn over; a new band's tier is the open tier furthest below an even share (nextTier; the
//   drifters and the looters share the low slot). A new band comes in at the map's edge (hives.js borderTiles) or far from your bases (FAR_YOU) and
//   the groups' (FAR_GROUP), never on a hive's ground or among the dead.
// - Camp: CAMP days (2–5) on a tile. Each camp day it does one thing within NEAR (3) tiles of the camp, by the
//   groups' picker (grouppois.js groupTargets: need × what is left, POIs ahead of sites, POI_W): survey a tile it may
//   find more on (grouppois.js groupSurveyTile: the player's Survey odds with the tier's Scouting) or raid one place
//   (grouppois.js raidPoiAsGroup: the pool, the container ledger, the tile's heat, what your people left in a container
//   they opened goes into its stock and wares). Tiles it does not know are surveyed before they are raided. A raid on
//   a dangerous place can cost it someone (MISHAP, by the place's true threat, pois.js poiThreat, against the tier).
// - Then it breaks camp and walks (or drives) MOVE (4–8) tiles to the next one, by day: the best ground for places it
//   knows or may find, away from your walls, the groups' bases, hives and hordes.
// - Survival: it eats EAT a head a day and drinks DRINK; it forages and hunts FORAGE[tier] a head a day (× the ground,
//   × the season), finds water WATER[tier] (a camp on a river or a lake fills up). Short of food or water it loses
//   someone STARVE of the days; under MIN_POP it breaks up. The dead on its tile bite (HORDE_BITE); a horde near it
//   that it cannot face (hordes.js weight against its strength, FLEE_RATIO) makes it break camp and go the other way.
//   ROAD_DEATH a day for the rest of what the road does.
// Meeting your teams (the same tile; once in MEET_COOLDOWN hours per team): a card by tier. Looters stop a team they
// can take (pay their toll, talk, fight, run) and scatter before one they cannot; survivalists trade, swap news and
// share; preppers keep you at rifle range but trade. You can attack any band you meet, and a camp you have spotted
// (markers.js "nomadcamp", with the last time it was seen; parties.js mission "nomads"). A fight is a battle with the
// tier's kit (combat.js KITS; resolved by the numbers headless); win and what they carry is yours. No recruiting from
// them, no diplomacy.
// Seen only when you can see them (state.live): drawn on the map like a band on the road (ui/render.js), their camp
// marked. Every roll is on the nomads' own generator (state.nomads.rng) or a hash: the world's dice are untouched.
import { Rng } from "./rng.js";
import { SUPPLIES, SUPPLY_KEYS, STOCK_KEYS, supValue } from "./data.js";
import { newId, log, addCard, day, combatPower, skill, snapshot, hourOfDay } from "./world.js";
import {
  planPath, moveCost, partyTile, partyMembers, tileLabel, carried, takeSupply, awaitOrders, cargoRoom, unitsThatFit, addGearToCargo, wipeParty,
} from "./parties.js";
import { attitude, changeGoodwill } from "./factions.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { fightOdds, spotFirstChance, payPlan, COOLDOWN_HOURS } from "./conflicts.js";
import { borderTiles } from "./hives.js";
import { reduceHorde } from "./hordes.js";
import { hash01, gainXp, USE, tradeSpeech } from "./skills.js";
import { foodIn, takeFood, giveFood, ageCoarse, FOODS } from "./foods.js";
import { yearOf } from "./eras.js";
import { stateSizeDef } from "./worldsize.js";
import { wanderDensity, WANDER } from "./wanderers.js";
import { visitorsOf, leaveMap } from "./visitors.js";
import { lootItem } from "./inventory.js";
import { starterKit } from "./arsenal.js"; // a band's spare gun: one of its tier's kit (KIT_OF nomad0–3)
import { season } from "./weather.js";
import { available, tradeContext } from "./trade.js";
import { expandAmmo } from "./ammo.js";
import { keyWord } from "./water.js";
import { poisOf, poiPool, isSitePoi, permanentSite, poiThreat } from "./pois.js";
import { groupTargets, groupSurveyTile, raidPoiAsGroup, groupKnownPois, groupHiddenGuess, poiPlace } from "./grouppois.js";
import { chronicleNote } from "./chronicle.js";

// ---------- numbers ----------
export const NOMADS = {
  SHARE: 0.5,                 // × the world size's default AI group count
  FIRST: [2, 6], FILL: [2, 5], GAP: [8, 16], // the first band's day, the gaps while filling up, the respawn's gap
  HC_START: 2, HC_FILL: [1, 3], // hardcore: the first fill-up goes to this × the target, the bands this many days apart
  FAR_YOU: 12, FAR_GROUP: 6, BORDER: 0.5, // a new band: this far from your bases and the groups'; a share at the map's edge
  CAMP: [2, 5], MOVE: [4, 8], NEAR: 3, POI_W: 1.6, // camp days, the next camp's distance, raiding reach, POIs ahead of sites
  KEEP_YOU: 2, KEEP_GROUP: 2, HORDE_CLEAR: 2, // a camp at least this far from your bases, the groups' bases, any horde
  DAY_FROM: 6, DAY_TO: 20, SPEED: 0.6, CAR_SPEED: 1.4, // walking by day (hardcore-groups.js bands' pace); a vehicle
  EAT: 0.7, DRINK: 0.6, STARVE: 0.25, MIN_POP: 2, ROAD_DEATH: 0.004, // a head a day; a day short: a chance to lose one
  FOOD_START: [4, 7], WATER_START: 3, // days of food and water they start with (a head)
  GROUND: { plains: 1, forest: 1.15, hills: 0.9, mountain: 0.55, suburb: 0.55, city: 0.3, water: 0 }, // forage by ground
  WINTER: 0.45, AUTUMN: 1.2, // × forage in those seasons
  TAKE: 0.012, // pool units a raid takes a head (grouppois.js raidPoiAsGroup's need)
  MISHAP: 0.012, // a raid's chance to lose someone, a point of true threat, / the tier's toughness
  HORDE_BITE: 30, HORDE_KILL: 1.2, FLEE_RATIO: 0.7, FLEE_NEAR: 2, // the dead
  RECRUIT_FOOD: 5, RECRUIT_NEAR: 2, JOIN_WANDERER: 0.25, JOIN_REFUGEE: 0.2, ROADSIDE: 0.05, // recruiting (days of food a head)
  LIFE: [112, 224], // days a band stays in these parts (one to two game years), then it moves off the map or disbands
  MEET_COOLDOWN: 48, TOLL: 0.3, TOLL_CAP: 3, FLEE_TEAM: 0.9, // meetings: looters scatter before a team this strong (× theirs)
  WARES_MAX: 12, ERA_POWER: 0.1, ERA_POWER_MAX: 0.6, // their power: + this a year from year 3
  TIERS: {
    0: { key: "drifters", name: "Drifters", kit: "drifters", size: [2, 5], start: [2, 3], power: 1.7, type: "commune", goodwill: [-15, 5],
      scouting: 2, forage: 0.6, water: 0.6, tough: 0.8, ammo: [0, 4], meds: [0, 1], theme: "farm", food: "wild", unlock: 1,
      vehicle: null, wares: [2, 4], gear: ["pipespear", "shiv", "makeshiftrod", "makeshiftpick", "ragplugs", "ragboots", "torch", "tourniquet", "slingbag", "cookpot", "noisemaker", "padding", "tripwire"] },
    1: { key: "looters", name: "Looters", kit: "looters", size: [3, 6], start: [3, 4], power: 2.4, type: "raider", goodwill: [-60, -45],
      scouting: 3, forage: 0.55, water: 0.55, tough: 1, ammo: [4, 12], meds: [0, 1], theme: "raider", food: "raider", unlock: 1,
      vehicle: null, gear: ["crowbar", "flashlight", "slingbag", "lighters", "cigarettes", "watch", "goldchain", "smokes"] },
    2: { key: "survivalists", name: "Survivalists", kit: "survivalists", size: [4, 8], start: [4, 5], power: 3.2, type: "commune", goodwill: [-5, 15],
      scouting: 5, forage: 0.85, water: 0.75, tough: 1.4, ammo: [15, 40], meds: [2, 5], theme: "hunt", food: "travel", unlock: 2,
      vehicle: [[null, 0.75], ["truck", 0.25]], gear: ["snarewire", "fishrod", "waterfilter", "stove", "bandagekit", "binoculars", "compbow", "hikingpack"] },
    3: { key: "preppers", name: "Preppers", kit: "preppers", size: [5, 10], start: [5, 7], power: 4.4, type: "fortress", goodwill: [-15, 5],
      scouting: 4, forage: 0.65, water: 0.65, tough: 2, ammo: [60, 140], meds: [4, 9], theme: "guns", food: "keeps", unlock: 4,
      vehicle: [["truck", 0.6], ["humvee", 0.4]], gear: ["binoculars", "handradio", "waterfilter", "stove", "nvg", "bandagekit", "rucksack", "milhelmet"] },
  },
  VEH_POWER: { truck: 3, humvee: 8 }, // a vehicle's strength (escorts.js ESCORT_VEHICLES' scale)
  COLORS: { 0: "#8a7f6a", 1: "#b5652b", 2: "#7f9a4a", 3: "#5f7286" },
};
const N = NOMADS;
export const NOMAD_TIERS = [0, 1, 2, 3];
const NAMES = {
  0: ["the Tin Can Folk", "the Scrap Walkers", "the Patchwork Band", "the Pipe Spears", "the Duct Tape Crew", "the Junk Pilgrims", "the Ragged Few", "the Bottle Kids"],
  1: ["the Scrap Rats", "the Crows", "the Ditch Kings", "the Rag Pickers", "the Gutter Dogs", "the Magpies", "the Rust Boys", "the Hollow Hands"],
  2: ["the Pine Walkers", "the Long Road Band", "the Creek People", "the Hawthorn Folk", "the Ash Hollow Band", "the Wayfarers", "the Fox Run Band", "the Ridge Walkers"],
  3: ["the Ironwood Preppers", "the Bunker Crew", "the Granite Company", "the Blackrock Outfit", "the Silo Men", "the Stockpile", "the Last Watch", "the Vault Families"],
};
const LOOK = {
  0: "thin, ragged people with pipe spears, taped-up bats and tyre-rubber vests, everything they carry made by hand from scrap",
  1: "ragged people with clubs, machetes and a pistol or two, eyes on everything you carry",
  2: "weathered walkers with hunting rifles and bows, game hung on their packs",
  3: "a disciplined crew in plate carriers and helmets with good rifles, a vehicle close by",
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (c) => `${Math.round(c * 100)}%`;
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const firstName = (s) => s.name.split(" ")[0];
const style = (state) => (state.governor && state.governor.personality) || "balanced";

// ---------- state ----------
export function nomads(state) {
  if (!state.nomads || !Array.isArray(state.nomads.bands)) {
    const rng = new Rng(Math.floor(hash01(state.seed, "nomads") * 4294967296) >>> 0);
    state.nomads = { rng, bands: [], seq: 0, next: N.FIRST[0] + rng.int(0, N.FIRST[1] - N.FIRST[0]), filled: false, stats: newStats() };
  }
  return state.nomads;
}
function newStats() {
  return { spawned: 0, tiers: { 0: 0, 1: 0, 2: 0, 3: 0 }, left: 0, starved: 0, broke: 0, killed: 0, beaten: 0, horde: 0, mishap: 0, road: 0, recruited: 0, recruits: { wanderers: 0, refugees: 0, roadside: 0 }, surveys: 0, found: 0, raids: 0, took: 0, camps: 0, moves: 0, fled: 0, met: 0, fights: 0, trades: 0, leftTaken: 0, peak: 0 };
}
const nrng = (state) => nomads(state).rng;
export const nomadsOf = (state) => (state.nomads && Array.isArray(state.nomads.bands) ? state.nomads.bands : []);
export const nomadById = (state, id) => nomadsOf(state).find((b) => String(b.id) === String(id)) || null;
// The count the respawn holds: half the size's default AI group count.
export const nomadTarget = (state) => Math.max(1, Math.round(stateSizeDef(state).defGroups * N.SHARE));
// The count the first fill-up aims for: the target, or HC_START × it on a hardcore run (more bands on the road at the
// start; once filled the respawn holds only the target, so the extra bands thin out as they starve, break up or leave).
export const nomadStartTarget = (state) => (state.mode === "hardcore" ? Math.round(nomadTarget(state) * N.HC_START) : nomadTarget(state));
// The tiers open in this year of the run (hardcore: counted from the normal start, eras.js rampDay).
export const nomadTiers = (state) => NOMAD_TIERS.filter((t) => yearOf(state) >= N.TIERS[t].unlock);
export const tierOf = (b) => N.TIERS[b.tier] || N.TIERS[1];
export const nomadPower = (state, b) => Math.round((tierOf(b).power + clamp((yearOf(state) - 2) * N.ERA_POWER, 0, N.ERA_POWER_MAX)) * 10) / 10;
export const nomadStrength = (state, b) => Math.max(0, b.pop) * nomadPower(state, b) + (b.vehicle ? N.VEH_POWER[b.vehicle] || 0 : 0);
export const nomadEnemy = (state, b) => ({ kind: tierOf(b).kit, count: clamp(b.pop, 1, 14), power: nomadPower(state, b), name: cap1(b.name) });
const roundPop = (n) => (n >= 8 ? `about ${n}` : `${n}`);
export const tierName = (b) => `${tierOf(b).name}`;

// ---------- spawning ----------
const pickW = (rng, list) => { const tot = list.reduce((a, [, w]) => a + w, 0); let r = rng.next() * tot; for (const [k, w] of list) { r -= w; if (r < 0) return k; } return list[list.length - 1][0]; };
const TIER_W = { 1: 0.5, 2: 0.35, 3: 0.15 };
// The low slot: drifters (T0) and looters (T1) share tier 1's place in the even share, so the drifters do not crowd
// out the later tiers; within it the one with fewer bands, ties by LOW_W.
const SLOT = { 0: 1, 1: 1, 2: 2, 3: 3 }, LOW_W = { 0: 0.45, 1: 0.55 };
// The tier of a new band: the open slot furthest below an even share of the bands on the map (so a tier just unlocked
// shows up with the next bands); ties by the era weights on the nomads' dice.
export function nextTier(state, rng = nrng(state)) {
  const tiers = nomadTiers(state), slots = [...new Set(tiers.map((t) => SLOT[t]))], have = { 0: 0, 1: 0, 2: 0, 3: 0 }, inSlot = { 1: 0, 2: 0, 3: 0 };
  for (const b of nomadsOf(state)) { have[b.tier]++; inSlot[SLOT[b.tier] || 1]++; }
  const even = (nomadsOf(state).length + 1) / slots.length;
  const gap = (sl) => even - inSlot[sl];
  const most = Math.max(...slots.map(gap));
  const short = slots.filter((sl) => gap(sl) >= most - 1e-9);
  const slot = pickW(rng, short.map((sl) => [sl, TIER_W[sl]]));
  const low = tiers.filter((t) => SLOT[t] === slot);
  if (low.length < 2) return low[0] ?? slot;
  const fewest = Math.min(...low.map((t) => have[t]));
  return pickW(rng, low.filter((t) => have[t] === fewest).map((t) => [t, LOW_W[t]]));
}
function spawnTile(state, rng) {
  const g = state.grid;
  const far = (t) => t.terrain !== "water" && !t.hive && !t.ruin && !(t.loc && (t.loc.type === "city" || t.loc.type === "town")) &&
    !state.hordes.some((h) => g.distance(h.tile, t.id) <= N.HORDE_CLEAR) &&
    (state.factions || []).every((f) => !f.alive || f.bases.every((b) => g.distance(b, t.id) >= N.FAR_GROUP));
  if (rng.chance(N.BORDER)) {
    const edge = borderTiles(state, N.FAR_YOU).filter(far);
    if (edge.length) return rng.pick(edge).id;
  }
  // Inland, far from your bases: a few tries at random, then the edge.
  for (let i = 0; i < 40; i++) {
    const t = state.tiles[rng.int(0, state.tiles.length - 1)];
    if (far(t) && state.bases.every((b) => g.distance(b.tile, t.id) >= N.FAR_YOU)) return t.id;
  }
  const edge = borderTiles(state, 6).filter(far);
  return edge.length ? rng.pick(edge).id : null;
}
// A new band (opts: { tier, tile, pop } for tools). Returns it, or null when nowhere fits.
export function spawnNomads(state, opts = {}) {
  const S = nomads(state), rng = S.rng;
  const tier = opts.tier != null && N.TIERS[opts.tier] ? opts.tier : nextTier(state, rng);
  const T = N.TIERS[tier];
  const tile = opts.tile != null ? opts.tile : spawnTile(state, rng);
  if (tile == null) return null;
  const serial = ++S.seq;
  const used = new Set(nomadsOf(state).map((b) => b.name));
  const names = NAMES[tier].filter((n) => !used.has(n));
  const name = names.length ? rng.pick(names) : `${rng.pick(NAMES[tier])} (${serial})`;
  const pop = opts.pop || rng.int(T.start[0], T.start[1]);
  const vehicle = T.vehicle ? pickW(rng, T.vehicle) : null;
  const b = {
    id: newId(), serial, tier, kit: T.kit, name, label: `Nomads (${T.name})`, kind: "nomads", nomad: true,
    // What trade.js reads from a group: a band is priced like one of its type.
    type: T.type, pop, goodwill: rng.int(T.goodwill[0], T.goodwill[1]), alive: true, outsider: true, pact: null, bases: [], color: N.COLORS[tier],
    stock: {}, wares: [], capacity: 25 * pop + (vehicle ? 150 : 0), vehicle, scouting: T.scouting, seeRange: N.NEAR,
    tile, camp: null, phase: "travel", path: [tile], idx: 0, progress: 0, campUntil: 0, act: "on the road",
    born: day(state), until: day(state) + rng.int(N.LIFE[0], N.LIFE[1]), known: false, met: {}, spared: [], lastSeen: null, hungry: 0, raided: 0, lastRaid: null,
  };
  for (const k of STOCK_KEYS) b.stock[k] = 0;
  giveFood(state, b.stock, pop * rng.range(N.FOOD_START[0], N.FOOD_START[1]), T.food, { rng });
  b.stock.water = Math.round(pop * N.WATER_START);
  b.stock.ammo = rng.int(T.ammo[0], T.ammo[1]);
  b.stock.meds = rng.int(T.meds[0], T.meds[1]);
  if (vehicle) b.stock.fuel = rng.int(6, 16);
  const nw = T.wares || [1, 3]; // the drifters start with more of their makeshift bits: it is all they have to trade
  for (let i = 0, n = rng.int(nw[0], nw[1]); i < n; i++) b.wares.push(lootItem(rng.pick(T.gear), "survivor", [state.seed, "nomadware", serial, i]));
  const spare = starterKit(state.seed, `nomads#${serial}`, `nomad${tier}`, 1).find((it) => it && it.key);
  if (spare) b.wares.push(spare);
  S.bands.push(b);
  S.stats.spawned++;
  S.stats.tiers[tier] = (S.stats.tiers[tier] || 0) + 1; // a save from before the drifters has no tier 0 count
  S.stats.peak = Math.max(S.stats.peak, S.bands.length);
  pitchCamp(state, b);
  return b;
}
function spawnDaily(state) {
  const S = nomads(state), d = day(state);
  if (d < S.next) return;
  const target = S.filled ? nomadTarget(state) : nomadStartTarget(state);
  if (nomadsOf(state).length < target) spawnNomads(state);
  const full = nomadsOf(state).length >= target;
  if (full) S.filled = true;
  const gap = S.filled ? N.GAP : state.mode === "hardcore" ? N.HC_FILL : N.FILL;
  S.next = d + S.rng.int(gap[0], gap[1]);
}

// ---------- the band leaves the map (starved, broken up, beaten) ----------
function breakUp(state, b, why) {
  const S = nomads(state);
  const i = S.bands.indexOf(b);
  if (i < 0) return;
  S.bands.splice(i, 1);
  b.alive = false;
  S.stats[why] = (S.stats[why] || 0) + 1;
  if (state.trade && state.trade.nomadId === b.id) state.trade = null;
  if (state.tradeQueue) state.tradeQueue = state.tradeQueue.filter((t) => t.nomadId !== b.id);
  dropCampMarker(state, b);
  if (b.known) {
    const text = why === "starved" ? `${cap1(b.name)}, the ${tierName(b).toLowerCase()} on the road, are no more: hunger broke them up.`
      : why === "beaten" ? `${cap1(b.name)} are finished: the last of them scattered.`
      : why === "left" ? `${cap1(b.name)}, the ${tierName(b).toLowerCase()}, have packed up and moved on out of these parts.`
      : `${cap1(b.name)}, the ${tierName(b).toLowerCase()} on the road, are no more.`;
    if ((state.live && state.live.has(b.tile)) || why === "beaten") log(state, text, why === "beaten" ? "good" : "info");
  }
}
function losePeople(state, b, n, why, reason) {
  b.pop = Math.max(0, b.pop - n);
  if (b.known && state.live && state.live.has(b.tile) && n > 0) log(state, `${cap1(b.name)} lost ${n === 1 ? "one of their people" : `${n} people`} ${reason}.`, "info");
  if (b.pop < N.MIN_POP) { breakUp(state, b, why); return true; }
  return false;
}

// ---------- the day ----------
export function nomadsDaily(state) {
  if (state.gameOver || state.nomadsOff) return;
  const S = nomads(state);
  for (const b of [...S.bands]) if (S.bands.includes(b)) bandDay(state, b);
  spawnDaily(state);
  S.stats.peak = Math.max(S.stats.peak, S.bands.length);
}

// Their needs (0–1 a good) for the groups' picker (grouppois.js kindValue: share of the good × (base want + need)).
export function nomadNeeds(b) {
  const pop = Math.max(1, b.pop);
  return {
    food: clamp(1 - foodIn(b.stock) / (pop * 6), 0, 1), preserved: clamp(1 - foodIn(b.stock) / (pop * 6), 0, 1) * 0.8,
    water: clamp(1 - (b.stock.water || 0) / (pop * 3), 0, 1), meds: clamp(1 - (b.stock.meds || 0) / (pop * 0.8), 0, 1),
    ammo: clamp(1 - (b.stock.ammo || 0) / (pop * (b.tier <= 1 ? 3 : 10)), 0, 1), fuel: b.vehicle ? clamp(1 - (b.stock.fuel || 0) / 12, 0, 1) : 0,
    scrap: 0.1, parts: 0.1,
  };
}
const waterAt = (state, tile) => { const t = state.tiles[tile]; return !!(t && (t.river || state.grid.neighbors(tile).some((n) => state.tiles[n] && state.tiles[n].terrain === "water"))); };

export function bandDay(state, b) {
  const rng = nrng(state), T = tierOf(b);
  const t = state.tiles[b.tile];
  // Food and water: what they forage, hunt and find, then what they eat and drink.
  const s = season(state).key;
  const ground = N.GROUND[t.terrain] ?? 0.8;
  const forage = b.pop * T.forage * ground * (s === "winter" ? N.WINTER : s === "autumn" ? N.AUTUMN : 1) * rng.range(0.7, 1.3);
  if (forage > 0) giveFood(state, b.stock, forage, { f_berries: 2, f_roots: 2, f_wildgreens: 2, f_nuts: 1, f_smallgame: 3 }, { rng });
  b.stock.water = (b.stock.water || 0) + b.pop * T.water * (s === "winter" ? 0.8 : 1) * rng.range(0.6, 1.3);
  if (b.phase === "camp" && waterAt(state, b.tile)) b.stock.water = Math.max(b.stock.water, b.pop * 4);
  const eat = b.pop * N.EAT, drink = b.pop * N.DRINK;
  const short = eat - takeFood(b.stock, eat, { state }).units;
  ageCoarse(b.stock);
  const dry = Math.max(0, drink - (b.stock.water || 0));
  b.stock.water = Math.max(0, (b.stock.water || 0) - drink);
  if (short > eat * 0.25 || dry > drink * 0.25) {
    b.hungry = (b.hungry || 0) + 1;
    if (rng.chance(N.STARVE * Math.min(2, b.hungry / 2 + 0.5)) && losePeople(state, b, 1, "starved", "to hunger")) return;
  } else b.hungry = 0;
  if (rng.chance(N.ROAD_DEATH) && losePeople(state, b, 1, "road", "on the road")) return;
  // Their time here is up (NOMADS.LIFE): they move off the map or go their separate ways; the respawn brings others.
  if (day(state) >= (b.until ?? b.born + N.LIFE[1]) && b.phase !== "battle") { breakUp(state, b, "left"); return; }
  // The dead near them: a horde they cannot face sends them the other way.
  const flee = hordeThreat(state, b);
  if (flee) { b.fled = flee.tile; nomads(state).stats.fled++; breakCamp(state, b, flee.tile); return; }
  if (b.phase !== "camp") return;
  // Camp: one thing a day near the camp, a survey or a raid; then the recruits; then, when the days are up, on.
  campWork(state, b);
  if (!nomadsOf(state).includes(b)) return;
  recruit(state, b);
  if (state.hour >= b.campUntil) breakCamp(state, b);
}

function hordeThreat(state, b) {
  const g = state.grid, str = nomadStrength(state, b);
  let worst = null;
  for (const h of state.hordes) {
    if (g.distance(h.tile, b.tile) > N.FLEE_NEAR) continue;
    if (h.size * 0.12 < str * N.FLEE_RATIO) continue;
    if (!worst || h.size > worst.size) worst = h;
  }
  return worst;
}

export function campWork(state, b) {
  const g = state.grid, S = nomads(state).stats, T = tierOf(b);
  const ok = (t) => t.terrain !== "water" && !t.hive && !(t.loc && !permanentSite(t) && !poisOf(t).length) &&
    !state.bases.some((x) => x.tile === t.id) && !(state.factions || []).some((f) => f.alive && f.bases.includes(t.id)) &&
    !state.hordes.some((h) => h.tile === t.id);
  const list = groupTargets(state, b, [b.camp ?? b.tile], { range: N.NEAR, need: nomadNeeds(b), ok, poiW: N.POI_W }).filter((x) => x.poi != null);
  const top = list[0];
  if (!top) return;
  const t = state.tiles[top.tile];
  if (top.survey) {
    const r = groupSurveyTile(state, b, t, { n: Math.max(2, Math.round(b.pop / 2)) });
    S.surveys++; S.found += r.found.length;
    b.act = `camped near ${tileLabel(state, b.camp ?? b.tile)}, surveying ${g.distance(top.tile, b.tile) ? tileLabel(state, top.tile) : "the ground round the camp"}`;
    return;
  }
  const need = N.TAKE * b.pop;
  const r = raidPoiAsGroup(state, b, t, top.poi, need, { name: b.known ? cap1(b.name) : undefined, hours: 8 });
  if (!r) return;
  S.raids++; S.took += r.took; S.leftTaken += r.boxes || 0;
  b.raided++;
  b.lastRaid = { tile: t.id, poi: top.poi, hour: state.hour };
  b.act = `camped near ${tileLabel(state, b.camp ?? b.tile)}, picking through ${poiPlace(state, t, top.poi)}`;
  for (const [k, q] of Object.entries(r.goods)) if (q > 0 && (SUPPLIES[k] || FOODS[k])) b.stock[k] = (b.stock[k] || 0) + q;
  // What your people left in a container they opened: into their wares (they carry it with them; they trade it on).
  for (const it of r.gear || []) b.wares.push(it);
  if (b.wares.length > N.WARES_MAX) b.wares.splice(0, b.wares.length - N.WARES_MAX);
  // A dangerous place can cost them someone (its true threat against the tier's toughness).
  const threat = poiThreat(state, t, top.poi);
  if (nrng(state).chance(clamp((N.MISHAP * threat) / T.tough, 0, 0.25))) { S.mishap++; losePeople(state, b, 1, "mishap", `in ${poiPlace(state, t, top.poi)}`); }
}

// Recruits: neutral wanderers (wanderers.js: people you met and left, and the road's unmet ones by the ground's
// density) and refugees from outside (visitors.js explorers), only while their food allows, less often the bigger
// they are, never past the cap.
export function recruit(state, b) {
  const T = tierOf(b), S = nomads(state).stats, rng = nrng(state), g = state.grid;
  const room = T.size[1] - b.pop;
  if (room <= 0 || foodIn(b.stock) < b.pop * N.RECRUIT_FOOD) return;
  const small = Math.max(0.15, 1 - (b.pop - T.size[0]) / Math.max(1, T.size[1] - T.size[0]));
  const join = (n, src) => { const k = Math.min(n, T.size[1] - b.pop); if (k <= 0) return 0; b.pop += k; b.capacity = 25 * b.pop + (b.vehicle ? 150 : 0); S.recruited += k; S.recruits[src] += k; return k; };
  // People you met and left (state.wanderers): a neutral group within reach, if it fits.
  const ws = state.wanderers;
  if (ws && Array.isArray(ws.groups)) for (const wg of [...ws.groups]) {
    if (wg.kind !== "neutral" || !wg.people.length || wg.people.length > room || g.distance(wg.tile, b.tile) > N.RECRUIT_NEAR) continue;
    if (!rng.chance(N.JOIN_WANDERER * small)) continue;
    for (const s of wg.people) s.joinedNomads = b.id;
    join(wg.people.length, "wanderers");
    ws.groups.splice(ws.groups.indexOf(wg), 1);
    return;
  }
  // Refugees and wanderers from outside, passing by.
  for (const v of visitorsOf(state)) {
    if (v.kind !== "explorers" || v.hostile || (v.sub !== "refugees" && v.sub !== "wanderers") || v.size <= 0) continue;
    if (!["travel", "search"].includes(v.phase) || g.distance(v.tile, b.tile) > N.RECRUIT_NEAR || !rng.chance(N.JOIN_REFUGEE * small)) continue;
    const k = join(Math.min(v.size, rng.int(1, 2)), "refugees");
    v.size -= k;
    v.joiners = Math.min(v.joiners || 0, v.size);
    if (v.size <= 0) leaveMap(state, v, "broken");
    return;
  }
  // Someone on the road (the wanderers' density of the ground: towns and roads more, the wild less).
  if (rng.chance(N.ROADSIDE * wanderDensity(state, b.tile) * WANDER.KIND.neutral * small)) join(1, "roadside");
}

// ---------- camps and moves ----------
function pitchCamp(state, b) {
  const rng = nrng(state);
  b.phase = "camp";
  b.camp = b.tile;
  b.path = [b.tile]; b.idx = 0; b.progress = 0;
  b.campUntil = state.hour + 24 * rng.int(N.CAMP[0], N.CAMP[1]);
  b.act = `camped near ${tileLabel(state, b.tile)}`;
  nomads(state).stats.camps++;
}
// The next camp: MOVE tiles off, the best ground for places it knows or may find, away from walls, hives and the
// dead; away from `from` (a horde it runs from) when given.
function nextCamp(state, b, from = null) {
  const g = state.grid, rng = nrng(state), need = nomadNeeds(b);
  const cands = [];
  for (const id of g.within(b.tile, N.MOVE[1])) {
    const d = g.distance(b.tile, id);
    if (d < N.MOVE[0]) continue;
    const t = state.tiles[id];
    if (t.terrain === "water" || t.hive || (t.loc && (t.loc.type === "city" || t.loc.type === "town"))) continue;
    if (state.bases.some((x) => g.distance(x.tile, id) < N.KEEP_YOU)) continue;
    if ((state.factions || []).some((f) => f.alive && f.bases.some((x) => g.distance(x, id) < N.KEEP_GROUP))) continue;
    if (state.hordes.some((h) => g.distance(h.tile, id) <= N.HORDE_CLEAR)) continue;
    if (from != null && g.distance(from, id) <= g.distance(from, b.tile)) continue;
    let score = 0;
    for (const n of g.within(id, 1)) {
      const nt = state.tiles[n];
      if (!poisOf(nt).length) continue;
      for (const i of groupKnownPois(state, b, nt)) score += poiPool(nt, i) * (isSitePoi(nt, i) ? 0.6 : 1);
      score += groupHiddenGuess(state, nt) * 0.4;
    }
    if (from != null) score += g.distance(from, id) * 0.2;
    if (b.lastCamp != null && g.distance(b.lastCamp, id) <= N.NEAR) score *= 0.5; // fresh ground
    cands.push({ id, score: score * rng.range(0.6, 1.4) });
  }
  cands.sort((x, y) => y.score - x.score || x.id - y.id);
  return cands.slice(0, 6).map((c) => c.id);
}
export function breakCamp(state, b, from = null) {
  const S = nomads(state).stats;
  for (const id of nextCamp(state, b, from)) {
    let res = b.vehicle && (b.stock.fuel || 0) > 1 ? planPath(state, b.tile, id, true, "nomads") : null;
    const driving = !!res;
    if (!res) res = planPath(state, b.tile, id, false, "nomads");
    if (!res || !res.path || res.path.length < 2) continue;
    if (b.camp != null) b.lastCamp = b.camp;
    b.camp = null;
    b.phase = "travel";
    b.path = res.path; b.idx = 0; b.progress = 0; b.driving = driving;
    b.act = from != null ? "on the move, away from the dead" : `on the move, towards ${tileLabel(state, id)}`;
    S.moves++;
    return true;
  }
  // Nowhere to go: they stay a little longer.
  b.campUntil = state.hour + 24;
  return false;
}

// ---------- the hour ----------
export function nomadsHour(state) {
  if (state.gameOver || !state.nomads || !nomadsOf(state).length) return;
  for (const b of [...nomadsOf(state)]) {
    if (!nomadsOf(state).includes(b)) continue;
    if (b.phase === "travel") move(state, b);
    if (!nomadsOf(state).includes(b)) continue;
    sight(state, b);
  }
  meetings(state);
  campMarkersSeen(state);
}
function move(state, b) {
  const h = hourOfDay(state);
  if (!b.driving && (h < N.DAY_FROM || h >= N.DAY_TO)) return;
  b.progress += b.driving ? N.CAR_SPEED : N.SPEED;
  while (b.idx < b.path.length - 1) {
    const from = b.path[b.idx], to = b.path[b.idx + 1];
    const cost = moveCost(state, from, to, !!b.driving, "nomads");
    if (!Number.isFinite(cost)) { b.path = b.path.slice(0, b.idx + 1); break; }
    if (b.progress < cost) break;
    b.progress -= cost;
    b.idx += 1;
    b.tile = to;
    if (b.driving) b.stock.fuel = Math.max(0, (b.stock.fuel || 0) - 0.3);
    if (hordeBite(state, b)) return;
  }
  if (b.driving && !(b.stock.fuel > 0)) b.driving = false; // out of fuel: on foot
  if (b.idx >= b.path.length - 1) pitchCamp(state, b);
}
// The dead on their tile: people lost, the dead thinned.
function hordeBite(state, b) {
  const hz = state.hordes.find((x) => x.tile === b.tile);
  if (!hz) return false;
  const rng = nrng(state);
  const lost = Math.min(b.pop, Math.max(0, Math.round((hz.size / N.HORDE_BITE) * rng.range(0.3, 1.1) / tierOf(b).tough)));
  reduceHorde(state, hz, nomadStrength(state, b) * N.HORDE_KILL);
  if (lost) { nomads(state).stats.horde += lost; return losePeople(state, b, lost, "horde", `to the dead near ${tileLabel(state, b.tile)}`); }
  return false;
}

// ---------- being seen; camp markers ----------
const campKey = (b) => `nomadcamp:${b.serial}`;
function sight(state, b) {
  if (!state.live || !state.live.has(b.tile)) return;
  if (!b.known) {
    b.known = true;
    log(state, `Your people spotted ${tierName(b).toLowerCase()} on the move near ${tileLabel(state, b.tile)}: ${LOOK[b.tier]}, ${roundPop(b.pop)} of them (${b.name}).`, b.tier === 1 ? "danger" : "info");
  }
  b.lastSeen = { tile: b.tile, hour: state.hour };
  if (b.phase === "camp") {
    const label = `Nomad camp: ${cap1(b.name)} (${tierName(b).toLowerCase()}, ${roundPop(b.pop)})`;
    const cur = state.markers.find((m) => m.key === campKey(b));
    const e = { key: campKey(b), type: "nomadcamp", tile: b.tile, hour: state.hour, label, info: { nomadId: b.id, tier: b.tier } };
    if (cur) Object.assign(cur, e); else state.markers.push(e);
  }
}
function dropCampMarker(state, b) {
  const i = state.markers ? state.markers.findIndex((m) => m.key === campKey(b)) : -1;
  if (i >= 0) state.markers.splice(i, 1);
}
// A camp marker on a tile in view where that band no longer camps: gone (they moved on).
function campMarkersSeen(state) {
  if (!state.markers || !state.live) return;
  for (let i = state.markers.length - 1; i >= 0; i--) {
    const m = state.markers[i];
    if (m.type !== "nomadcamp" || !state.live.has(m.tile)) continue;
    const b = nomadById(state, m.info && m.info.nomadId);
    if (!b || b.phase !== "camp" || b.tile !== m.tile) state.markers.splice(i, 1);
  }
}
// The band camping on a tile (a known camp: one you have seen), or null.
export function nomadCampAt(state, tile, knownOnly = true) {
  return nomadsOf(state).find((b) => b.phase === "camp" && b.tile === tile && (!knownOnly || b.known)) || null;
}
export const campMarkerAt = (state, tile) => (state.markers || []).some((m) => m.type === "nomadcamp" && m.tile === tile);

// ---------- meeting your teams ----------
const teamPower = (state, p) => partyMembers(state, p).reduce((a, s) => a + combatPower(s), 0);
function halt(p) {
  if (p.phase !== "engaged") {
    p.conflictResume = p.phase === "back" ? "back" : p.phase === "task" && p.task ? "task" : p.phase === "waiting" ? "waiting" : "out";
    p.phase = "engaged";
  }
}
function resume(state, p) {
  if (!state.parties.includes(p)) return;
  const was = p.conflictResume;
  delete p.conflictResume;
  if (p.phase !== "engaged") return;
  if (was === "task" && !p.task) { awaitOrders(state, p, "", { failed: true, hold: true }); return; }
  if (was === "waiting") { awaitOrders(state, p, "", { failed: true, hold: true }); return; }
  p.phase = was || "out";
}
function meetings(state) {
  const g = state.grid;
  for (const p of [...state.parties]) {
    if (p.owner !== "player" || p.kind === "convoy" || !state.parties.includes(p)) continue;
    if (p.phase === "engaged" || p.phase === "holding" || p.phase === "helping") continue;
    if (p.mission === "nomads" && p.phase !== "waiting") continue; // on its way to attack a camp: parties.js arrive deals with it
    const tile = partyTile(p);
    if (tile == null || state.bases.some((x) => g.distance(x.tile, tile) <= 0)) continue;
    if (state.cards.some((c) => c.partyId === p.id) || !partyMembers(state, p).length) continue;
    if (p.lastConflict != null && state.hour - p.lastConflict < COOLDOWN_HOURS) continue;
    for (const b of nomadsOf(state)) {
      if (b.tile !== tile || b.phase === "battle") continue;
      if (b.met[p.id] != null && state.hour - b.met[p.id] < N.MEET_COOLDOWN) continue;
      b.met[p.id] = state.hour;
      const card = meetCard(state, b, p);
      if (!card) continue;
      b.known = true;
      b.lastSeen = { tile: b.tile, hour: state.hour };
      p.lastConflict = state.hour;
      nomads(state).stats.met++;
      addCard(state, card);
      break;
    }
  }
}
// The card for a team on their tile (null: they let it be). Exported for tools.
export function meetCard(state, b, p) {
  if (b.tier === 1 && attitude(b) === "Hostile") {
    const mine = teamPower(state, p), theirs = nomadStrength(state, b);
    if (theirs < mine * N.FLEE_TEAM) return scatterCard(state, b, p);
    return stopCard(state, b, p);
  }
  return talkCard(state, b, p);
}
const fightAi = (st, odds) => { const need = { cautious: 0.8, balanced: 0.65, aggressive: 0.5 }[style(st)] ?? 0.65; return odds >= need ? 80 + odds * 10 : odds * 40; };
const ok = (st, b, p) => st.parties.includes(p) && nomadsOf(st).includes(b);
const planText = (plan) => Object.entries(plan).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ");
const carriedValue = (p) => SUPPLY_KEYS.reduce((a, k) => a + carried(p, k) * supValue(k), 0);

// Looters who meet a team they can take: pay, talk, fight or run.
function stopCard(state, b, p) {
  halt(p);
  const enemy = nomadEnemy(state, b);
  const odds = fightOdds(state, p, enemy, "enemy");
  const tollValue = Math.max(10, Math.round(Math.min(carriedValue(p) * N.TOLL, nomadStrength(state, b) * N.TOLL_CAP)));
  const toll = () => payPlan(p, tollValue);
  const t0 = toll();
  const speech = Math.max(0, ...partyMembers(state, p).map((s) => skill(s, "speech")));
  const scouting = Math.max(0, ...partyMembers(state, p).map((s) => skill(s, "scouting")));
  const tc = clamp(0.15 + 0.04 * speech, 0.15, 0.8);
  const rc = clamp(0.35 + 0.03 * scouting + (p.vehicle ? 0.2 : 0) + (p.stance === "stealthy" ? 0.1 : 0), 0.1, 0.9);
  const done = (st, text) => { resume(st, p); if (nomadsOf(st).includes(b)) b.spared = [...(b.spared || []), p.id].slice(-20); return text; };
  return {
    title: `Looters on the road: ${cap1(b.name)}`, partyId: p.id, nomadId: b.id, where: tileLabel(state, partyTile(p)),
    text: `${b.pop} nomads, ${LOOK[1]}, block the way. They want ${t0 ? planText(t0) : "whatever you carry"}. Your team's strength ${Math.round(teamPower(state, p))}, theirs about ${Math.round(nomadStrength(state, b))}.`,
    choices: [
      { label: `Fight (${pct(odds)} by the numbers)`, hint: "A battle: they have the drop on you. Win and what they carry is yours", fight: { odds, enemy, ambush: "enemy" }, ai: (st) => fightAi(st, odds), resolve: (st) => (ok(st, b, p) ? nomadFight(st, b, p, "enemy") : done(st, "They are gone.")) },
      {
        label: `Pay them (${t0 ? planText(t0) : "not enough"})`, hint: "They take it and melt away", disabled: (st) => !ok(st, b, p) || !toll(),
        ai: (st) => (!toll() ? -99 : style(st) === "cautious" ? 70 : 45),
        resolve: (st) => { if (!ok(st, b, p)) return done(st, "They are gone."); const plan = toll(); if (!plan) return done(st, "You have nothing they want."); for (const [k, q] of Object.entries(plan)) { takeSupply(p, k, q); b.stock[k] = (b.stock[k] || 0) + q; } return done(st, `You handed over ${planText(plan)} and they let you pass.`); },
      },
      {
        label: `Talk them down (Speech ${speech}: ${pct(tc)})`, hint: "They are hungry, not brave: a good talker can send them off empty-handed. If not, they attack", ai: () => tc * 70,
        resolve: (st) => {
          if (!ok(st, b, p)) return done(st, "They are gone.");
          const best = [...partyMembers(st, p)].sort((a, c) => skill(c, "speech") - skill(a, "speech") || a.id - c.id)[0];
          if (best) gainXp(st, best, "speech", USE.talk);
          if (nrng(st).chance(tc)) return done(st, `${best ? firstName(best) : "Your speaker"} talked them out of it. They slink off.`);
          return nomadFight(st, b, p, "enemy");
        },
      },
      { label: `Run for it (${pct(rc)})`, hint: "Scouting, a vehicle and a stealthy pace help. If they catch you, it is a fight", ai: () => rc * 60, resolve: (st) => (!ok(st, b, p) ? done(st, "They are gone.") : nrng(st).chance(rc) ? done(st, "You got away.") : nomadFight(st, b, p, "enemy")) },
    ],
  };
}
// Looters who meet a team stronger than they are: they scatter. Chase them or let them go.
function scatterCard(state, b, p) {
  halt(p);
  const enemy = nomadEnemy(state, b);
  const odds = fightOdds(state, p, enemy, "player");
  const done = (st, text) => { resume(st, p); return text; };
  return {
    title: `Looters: ${cap1(b.name)}`, partyId: p.id, nomadId: b.id, where: tileLabel(state, partyTile(p)),
    text: `${b.pop} nomads, ${LOOK[1]}, size your team up and back off into cover. They will not fight people as strong as you.`,
    choices: [
      { label: "Let them go", ai: () => 40, resolve: (st) => done(st, "They melt away.") },
      { label: `Run them down (${pct(odds)} by the numbers)`, hint: "A fight with the drop on them; they run when it turns against them. Win and what they carry is yours", fight: { odds, enemy, ambush: "player" }, ai: (st) => fightAi(st, odds) - 25, resolve: (st) => (ok(st, b, p) ? nomadFight(st, b, p, "player", { chase: true }) : done(st, "They are gone.")) },
    ],
  };
}
// Survivalists and preppers (and looters who have warmed to you): talk, trade, share, or attack.
function talkCard(state, b, p) {
  halt(p);
  const enemy = nomadEnemy(state, b);
  const odds = fightOdds(state, p, enemy, "player");
  const hostile = attitude(b) === "Hostile";
  const done = (st, text) => { resume(st, p); return text; };
  const give = { food: 2 * b.pop };
  const mood = b.tier === 3 ? "They keep your people at rifle range the whole time, polite and watchful." : b.tier === 2 ? "They are wary but glad of news." : b.tier === 0 ? "They keep their distance and their spears close, eyes on your food and your guns." : "They watch your packs.";
  const choices = [
    {
      label: "Trade with them", hint: hostile ? "They will not trade with you" : "The trade window, from what the team carries", disabled: hostile,
      ai: () => (b.tier === 1 ? 10 : 55),
      resolve: (st) => { if (!ok(st, b, p)) return done(st, "They are gone."); openNomadTrade(st, b, p); delete p.conflictResume; return ""; },
    },
    {
      label: "Swap news", hint: "Free: the ground round their camp on your team's map", disabled: () => hostile || !!(b.newsTo || []).includes(p.id), ai: () => 60,
      resolve: (st) => {
        if (!ok(st, b, p)) return done(st, "They are gone.");
        b.newsTo = [...(b.newsTo || []), p.id].slice(-20);
        let n = 0;
        for (const id of st.grid.within(b.tile, 2)) { p.seen.set(id, snapshot(st, id)); n++; }
        changeGoodwill(st, b, 2, "");
        return done(st, `${cap1(b.name)} tell you about the ground round here (${n} tiles on your team's map).`);
      },
    },
    {
      label: `Share food (${give.food} days)`, hint: "Goodwill +10 with them", disabled: (st) => !st.parties.includes(p) || carried(p, "food") < give.food,
      ai: (st) => (carried(p, "food") >= give.food * 3 && b.tier !== 1 ? 15 : -20),
      resolve: (st) => { if (!ok(st, b, p)) return done(st, "They are gone."); takeSupply(p, "food", give.food); giveFood(st, b.stock, give.food, "travel", { rng: nrng(st) }); changeGoodwill(st, b, 10, ""); return done(st, `${cap1(b.name)} take the food gratefully.`); },
    },
    { label: `Attack them (${pct(odds)} by the numbers)`, hint: `A battle against ${b.pop} ${tierName(b).toLowerCase()} (${b.tier === 3 ? "plate armour and rifles" : b.tier === 2 ? "hunting rifles and bows" : b.tier === 0 ? "pipe spears and scrap weapons" : "clubs and pistols"}). Win and what they carry is yours`, fight: { odds, enemy, ambush: "player" }, ai: () => -40, resolve: (st) => (ok(st, b, p) ? nomadFight(st, b, p, "player", { attacked: true }) : done(st, "They are gone.")) },
    { label: "Move on", ai: () => 20, resolve: (st) => done(st, "") },
  ];
  return {
    title: `${tierName(b)} on the road: ${cap1(b.name)}`, partyId: p.id, nomadId: b.id, where: tileLabel(state, partyTile(p)),
    text: `Your team meets ${LOOK[b.tier]}: ${b.name}, ${roundPop(b.pop)} nomads, ${b.act}. They have no base and want none. ${mood}`,
    choices,
  };
}

// ---------- attacking a camp (parties.js mission "nomads") ----------
// A team sent against a camp you spotted arrives: the card (attack, or leave). Returns "" (parties.js arrive).
export function nomadCampArrive(state, p) {
  const g = state.grid;
  const b = nomadsOf(state).find((x) => x.tile === p.dest && x.phase === "camp") || nomadsOf(state).find((x) => g.distance(x.tile, partyTile(p)) <= 0);
  if (!b) {
    const m = (state.markers || []).find((x) => x.type === "nomadcamp" && x.tile === p.dest);
    if (m) state.markers.splice(state.markers.indexOf(m), 1);
    awaitOrders(state, p, "The camp is gone: they have moved on.", { failed: true });
    return "";
  }
  b.known = true;
  b.met[p.id] = state.hour;
  p.phase = "engaged";
  p.conflictResume = "waiting";
  const enemy = nomadEnemy(state, b);
  const odds = fightOdds(state, p, enemy, "player");
  const done = (st, text) => { awaitOrders(st, p, text); return ""; };
  addCard(state, {
    title: `The camp of ${cap1(b.name)}`, partyId: p.id, nomadId: b.id, where: tileLabel(state, p.dest),
    text: `Your team has the camp in sight: ${LOOK[b.tier]}, ${roundPop(b.pop)} of them (${tierName(b).toLowerCase()}). Their strength about ${Math.round(nomadStrength(state, b))}, yours ${Math.round(teamPower(state, p))}.`,
    choices: [
      { label: `Attack the camp (${pct(odds)} by the numbers)`, hint: "A battle with the drop on them. Win and everything in the camp is yours", fight: { odds, enemy, ambush: "player" }, ai: (st) => fightAi(st, odds), resolve: (st) => (ok(st, b, p) ? nomadFight(st, b, p, "player", { attacked: true, camp: true }) : done(st, "They are gone.")) },
      { label: "Talk to them instead", hint: "The meeting card", disabled: (st) => attitude(b) === "Hostile", ai: () => 10, resolve: (st) => { if (!ok(st, b, p)) return done(st, "They are gone."); p.phase = "waiting"; delete p.conflictResume; addCard(st, talkCard(st, b, p)); return ""; } },
      { label: "Leave them be", ai: () => 30, resolve: (st) => done(st, "Your team leaves the camp alone.") },
    ],
  });
  return "";
}

// ---------- fights ----------
// Looters scatter before a team that is beating them: they flee instead of fighting it out (opts.chase), dropping
// part of what they carry. Otherwise a battle with the tier's kit.
function nomadFight(state, b, p, ambush, opts = {}) {
  if (!nomadsOf(state).includes(b)) { resume(state, p); return "They are gone."; }
  const S = nomads(state).stats;
  S.fights++;
  if (opts.attacked && b.tier !== 1) changeGoodwill(state, b, -60, "you attacked them");
  if (b.tier === 1 && opts.chase && nomadStrength(state, b) < teamPower(state, p) * N.FLEE_TEAM * 0.8) {
    // They run: what they drop is yours.
    const dropped = {};
    for (const k of Object.keys(b.stock)) { const q = Math.floor((b.stock[k] || 0) * 0.4); if (q > 0 && SUPPLIES[k]) { b.stock[k] -= q; dropped[k] = q; } }
    const got = cargoAdd(state, p, dropped);
    breakCamp(state, b, partyTile(p));
    resume(state, p);
    return `They scattered before you could close in${planText(got) ? `, dropping ${planText(got)}` : ""}.`;
  }
  b.phase = "battle";
  startCombat(state, {
    tile: partyTile(p), partyId: p.id, enemy: nomadEnemy(state, b), ambush, canRetreat: true, handler: "nomadFight",
    context: { nomadId: b.id, partyId: p.id, camp: !!opts.camp },
  });
  return "";
}
function cargoAdd(state, p, sup) {
  const got = {};
  for (const [k, q0] of Object.entries(sup)) {
    if (!SUPPLIES[k] || q0 < 1) continue;
    const q = Math.min(Math.floor(q0), unitsThatFit(cargoRoom(state, p), k));
    if (q <= 0) continue;
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + q;
    got[k] = q;
  }
  return got;
}
function onNomadFight(state, result, setup) {
  const c = setup.context;
  const b = nomadById(state, c.nomadId);
  const p = c.partyId != null ? state.parties.find((x) => x.id === c.partyId) : null;
  const name = b ? cap1(b.name) : setup.enemy.name;
  const lines = [];
  if (b) { b.pop -= result.enemiesKilled || 0; if (b.phase === "battle") b.phase = b.camp != null ? "camp" : "travel"; nomads(state).stats.killed += result.enemiesKilled || 0; }
  if (p && state.parties.includes(p) && !partyMembers(state, p).length) {
    const where = tileLabel(state, partyTile(p));
    wipeParty(state, p);
    log(state, `The whole team was lost fighting ${name}.`, "death");
    addCard(state, { title: `The fight with ${name}`, text: `The whole team was lost fighting ${name} near ${where}. Where they fell is marked on the map.`, where, choices: [{ label: "OK", resolve: () => "" }] });
    if (b && b.pop < N.MIN_POP) breakUp(state, b, "beaten");
    return;
  }
  if (result.outcome === "victory") {
    let got = {};
    const items = [];
    if (b) {
      if (p && state.parties.includes(p)) {
        expandAmmo(b.stock, tierOf(b).theme);
        got = cargoAdd(state, p, b.stock);
        for (const it of [...b.wares]) if (addGearToCargo(state, p, it)) items.push(it.name);
      }
      breakUp(state, b, "beaten");
    }
    lines.push(`You beat ${name}${c.camp ? " and took their camp" : ""}.`);
    const what = [planText(got), ...items].filter(Boolean).join(", ");
    if (what) lines.push(`Taken from them: ${what}.`);
    log(state, `${name} (nomads) were beaten${p ? ` near ${tileLabel(state, partyTile(p))}` : ""}.`, "good");
    chronicleNote(state, `${name}, nomads, were broken by your people.`, "world", p ? partyTile(p) : b ? b.tile : null);
  } else {
    if (p && state.parties.includes(p)) {
      const frac = result.outcome === "retreat" ? 0.2 : 0.35;
      const taken = {};
      for (const pool of result.outcome === "retreat" ? [p.cargo.supplies] : [p.supplies, p.cargo.supplies]) {
        for (const k of Object.keys(pool)) { const q = Math.floor((pool[k] || 0) * frac); if (q > 0) { pool[k] -= q; taken[k] = (taken[k] || 0) + q; } }
      }
      if (b && nomadsOf(state).includes(b)) for (const [k, q] of Object.entries(taken)) b.stock[k] = (b.stock[k] || 0) + q;
      lines.push(result.outcome === "retreat" ? `You pulled back${planText(taken) ? `, dropping ${planText(taken)}` : ""}.` : `You lost the fight${planText(taken) ? ` and they took ${planText(taken)}` : ""}.`);
    } else lines.push("You lost the fight.");
    log(state, `Fight with ${name} (nomads): ${result.outcome}.`, "danger");
    if (b && nomadsOf(state).includes(b)) {
      if (b.pop < N.MIN_POP) breakUp(state, b, "beaten");
      else { b.spared = [...(b.spared || []), p ? p.id : -1].slice(-20); if (b.phase === "camp") breakCamp(state, b); }
    }
  }
  const dead = (result.survivorsDead || []).length;
  if (dead) lines.push(`${dead} of yours died.`);
  if (p && state.parties.includes(p)) {
    p.phase = "engaged";
    if (!p.conflictResume) p.conflictResume = "out";
    addCard(state, { title: `The fight with ${name}`, text: lines.join(" "), partyId: p.id, where: tileLabel(state, partyTile(p)), choices: [{ label: "OK", resolve: (st) => { resume(st, p); return ""; } }] });
  } else addCard(state, { title: `The fight with ${name}`, text: lines.join(" "), choices: [{ label: "OK", resolve: () => "" }] });
}
registerCombatHandler("nomadFight", onNomadFight);

// ---------- trade (trade.js reads this as a visit: the team trades from what it carries) ----------
export function openNomadTrade(state, b, p) {
  const t = { nomadId: b.id, partyId: p.id, factionId: null, offer: {}, ask: {}, offerGear: [], askGear: [], intel: { area: "", sightings: false, sell: false } };
  p.phase = "engaged";
  if (state.trade && state.trade.nomadId === b.id) return true;
  if (state.trade && tradeContext(state)) {
    const q = (state.tradeQueue = state.tradeQueue || []);
    if (!q.some((x) => x.nomadId === b.id && x.partyId === p.id)) q.push(t);
    return false;
  }
  b.known = true;
  nomads(state).stats.trades++;
  state.trade = t;
  return true;
}
export function resumeNomadTrade(state, t) {
  const b = nomadById(state, t.nomadId);
  const p = state.parties.find((x) => x.id === t.partyId);
  if (!p || p.phase !== "engaged" || !partyMembers(state, p).length) return;
  if (!b || attitude(b) === "Hostile" || state.grid.distance(partyTile(p), b.tile) > 1) { awaitOrders(state, p, "The nomads have moved on."); return; }
  state.trade = t;
}
export function nomadTradeContext(state, t) {
  const b = nomadById(state, t.nomadId);
  if (!b || !b.alive) return null;
  const p = state.parties.find((q) => q.id === t.partyId);
  if (!p || state.grid.distance(partyTile(p), b.tile) > 1) return null;
  expandAmmo(b.stock, tierOf(b).theme); // ammo.js: their rounds by calibre
  const have = {}, theirHave = {};
  for (const k of SUPPLY_KEYS) theirHave[k] = available(b, k);
  theirHave.ammo = 0;
  for (const k of SUPPLY_KEYS) have[k] = Math.max(0, Math.floor((p.supplies[k] || 0) + (p.cargo.supplies[k] || 0)));
  return { kind: "visit", t, f: b, p, caravan: null, base: null, speech: tradeSpeech(partyMembers(state, p)), have, theirHave, myGear: p.cargo.gear, theirGear: b.wares, center: partyTile(p), nomad: b };
}

// ---------- the map, tooltips, tools ----------
// Bands drawn where you can see them (ui/render.js), in the shape hardcore-groups.js hcMapBands gives.
export function nomadMapBands(state) {
  return nomadsOf(state).map((b) => ({ id: b.id, name: b.name, type: b.type, tile: b.tile, pop: b.pop, color: b.color, path: b.path, idx: b.idx, convoy: !!b.driving, camp: b.phase === "camp", nomad: true, known: b.known }));
}
export function nomadTipLines(state, tile, live = state.live) {
  const out = [];
  for (const b of nomadsOf(state)) {
    if (b.tile !== tile || !live || !live.has(tile)) continue;
    out.push({ color: b.color, text: b.known ? `${cap1(b.name)}: ${roundPop(b.pop)} nomads (${tierName(b).toLowerCase()}, ${attitude(b).toLowerCase()}), ${b.act}` : `A band of ${roundPop(b.pop)} nomads, ${b.act}` });
  }
  return out;
}
// Nomads alive now, by tier (tools, the stats).
export function nomadCounts(state) {
  const out = { n: 0, people: 0, 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const b of nomadsOf(state)) { out.n++; out.people += b.pop; out[b.tier]++; }
  return out;
}
