// Outsiders: people from beyond the State of Calder who come onto the map, travel across it and leave again. They are
// not one of the map's groups (state.factions); they live in state.visitors and come in three kinds.
//
// Where and when
// - They enter on a land tile of the map's border (hives.js borderTiles: the same tiles as the border hordes, not
//   within 6 tiles of one of your bases; merchants prefer a border tile with a road) and leave from one: a party that
//   reaches its exit tile is gone from the map. Every outsider leaves by OUTSIDERS.*.stay days at the latest.
// - Spawns are rolled once a day on their own random numbers (state.visitorInfo.rng: the rest of a run draws the
//   world's dice as before until an outsider is met). Raiders: the first between days 20 and 26, then every
//   clamp(30 − 0.06 × day, 10, 30) × 0.75–1.25 days (about every 29 days early, 23 at day 120, 16 at day 240, 10 from day 334),
//   at most 1 band on the map (2 from day 120, 3 from day 240). Merchants: the first on days 8–14, then every 10–16
//   days, 1 at a time (2 from day 150). Explorers: the first on days 5–10, then every 6–12 days, at most 2.
//
// Raiders (kind "raiders")
// - A band of clamp(3 + day / 30 + 0–2, 3, 14) people, each as strong as 2.6 + min(3.4, day / 80) (clubs and old
//   pistols early, assault rifles and plate in the second year). They pick a target by its loot against how well it
//   is defended (never one stronger than they are): your bases (baseDefense, only when their strength is at least
//   0.6 of it), your teams in the field (not within 2 tiles of a base), your trade-route and supply convoys, other
//   groups' bases (8 + strength × 0.8, at 1.2, one per band), groups' caravans on foot, merchant caravans from outside, and
//   rich sites (loot 0.45+, nobody's land, not within 8 tiles of a group's base: their scavenging grounds). Once they carry loot worth 10 × their strength, have lost half the band,
//   were paid off or their days are up, they head for the nearest border tile.
// - Your base: a warning card when they are 4 tiles out and you can see or hear them (else when they arrive):
//   prepare defences, pay them off (4 × their strength in goods, from ammo, food, preserved food, meds, fuel, scrap,
//   parts), talk them down (Speech: 10% + 3.5% a point, at most 75%: half the price), defend in person (the deploy
//   battle on the base's map) or hold. After 8 hours at the walls it is decided by the numbers like a group's raid
//   (defence / strength: 1.2+ held, 0.8+ a break-in taking 20% of the stock (10% with a storehouse), less: overrun,
//   50% (25%), an outpost is lost). What they take, they carry: beat them later and you get it back.
// - Your teams: a team within 1 tile of a band that thinks it can win gets a card. They found you: fight, pay the
//   toll (35% of what the team carries, at most 3 × their strength), talk (Speech), run (Scouting, a vehicle,
//   stealthy pace). You saw them first: slip away (Stealth), ambush them, or wait for them to pass.
// - Other groups: a siege of 12 hours, then factions.js resolveRaidOnFaction (the same odds and losses as a raid
//   between groups); they keep 60% of what the group lost. Caravans and convoys are robbed when the band is 10%
//   stronger than their escort, else the band loses people. Sites lose 10–18% of their loot.
// - Radio (Groups tab, their tile in your coverage): pay them to leave the state, 1.25 × the tribute, 2% less a point
//   of Speech (at most 30%).
//
// Merchants (kind "merchants")
// - Traders from another state: 3–5 guards (+1 every 90 days, at most 7, power 3.5 + min(2.5, day / 120)) and 2
//   traders, walking with wagons along the roads. They visit up to 3 bases of the map's groups (never raider gangs or
//   zealots), trading with them (goods the group is short of for what the merchants lack), and one of your bases when
//   invited over the radio, or unannounced 55% of the time when nobody hears them. They carry what the map is short
//   of: fuel 15–40, meds 8–22, preserved food 20–50, parts 3–9, ammo 60–160, a manual or blueprint (75%, a second
//   25%), 1–3 books and 2–4 pieces of good gear, and want food, water, scrap and jars. Prices follow trade.js (their
//   stock per head sets their need: cheap fuel and meds, dear food) with their own profile (data.js TRADE_PREFS
//   "merchants": food, water, scrap and jars wanted, valuables and collectibles prized for resale, fuel, meds and ammo
//   cheaper, and a margin: they sell dear; travellers: "explorers", food, water, meds and camp gear). They trade with
//   the groups by demand on both sides (stock, kind and state). At your base they stay 24 hours and the trade
//   window opens; a team that meets them can trade on the road too.
// - Attack them (trade window or a road card) and word spreads: merchant reputation −45 (new merchants arrive with
//   goodwill 15 + reputation, hostile at −40: no trade, and they skip your bases from −30), known traders −15,
//   known communes and fortresses −8. Reputation recovers 0.25 a day.
// - When they come into your radio coverage they call: "a caravan from the north is passing Dunmore; we can stop at
//   your hub in about 30 hours if you want".
//
// Explorers (kind "explorers")
// - Scouts (40%, 2–3), refugees (35%, 2–5) or wanderers (25%, 1–2). They walk between 2–3 ruins away from the groups' grounds (searching each
//   4–8 hours: the site loses 3–6% of its loot), refugees come to your hub 75% of the time (wanderers 45%, scouts
//   30%), then leave. 8% are robbers in disguise: they ambush a team or rob the base that shelters them.
// - At your gate or on the road: hear their news (free: the tiles along their way so far are put on your map, as
//   they were when they passed; news of other states), buy the scouts' maps (2 tiles either side of their way),
//   trade (the trade window), take them in (a recruit card, recruits.js: refugees 1–3, wanderers 0–1), shelter them
//   for 3 days (1 food and 1 water each a day, mood +3 at the base; afterwards half the time a gift, a third of the
//   time someone asks to stay), or send them on.
//
// Raider bands that settle (settleBands, daily, at any time of the run): a band of SETTLE.people+ (8) that carries goods
// worth SETTLE.goods+ (what it looted: enough to start a base) may dig in (SETTLE.chance a day) at a site or a ruin
// within SETTLE.reach tiles of where it is, not within 6 tiles of your bases or 8 of a group's base, not on a hive's
// ground: it becomes one of the map's groups (a raider gang, hostile, its people and its loot as its start). The log
// says so when you can see or hear it, else travellers speak of it. Gangs from beyond the border (factions.js
// newGangs) still come when hostile groups are few.
//
// Seen only when you can see them (state.live) or hear them (radio coverage, a faded sprite on the map); the
// Groups tab lists those you know with their last known position. Decisions use state.visitorInfo.rng.
import { Rng } from "./rng.js";
import { SUPPLIES, SUPPLY_KEYS, GEAR } from "./data.js";
import {
  newId, log, addCard, day, hub, baseById, atBase, residents, combatPower, hurt, factionById, snapshot, mergeKnowledge, removeBase,
  supplyValue, skill, baseVision,
} from "./world.js";
import {
  planPath, moveCost, partyTile, partyMembers, tileLabel, removeParty, partyCapacity, cargoLoad, cargoRoom, unitsThatFit, carried, takeSupply,
  awaitOrders, travelHours,
} from "./parties.js";
import * as Parties from "./parties.js";
import { baseDefense, strength as groupStrength, resolveRaidOnFaction, changeGoodwill, attitude, siegePace, stolenText, makeGang } from "./factions.js";
import { raidDamage, raidReportCard } from "./breakdowns.js";
import { fightOdds, spotFirstChance, payPlan, COOLDOWN_HOURS } from "./conflicts.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { inCoverage, hasNetwork } from "./radio.js";
import { borderTiles } from "./hives.js";
import { newItem } from "./inventory.js";
import { BP_KEYS, bpItemKey, isKnown } from "./blueprints.js";
import { tradeSpeech, gainXp, USE, hash01 } from "./skills.js";
import { travelFactor } from "./weather.js";
import { available, need, demand, tradeContext, setQty, balanceWith, tradeVerdict, executeTrade, endTrade, maxBuyable, autoSellGear } from "./trade.js";
import { count } from "./buildings.js";
import { partyVehicle } from "./vehicles.js";
import { chronicleNote } from "./chronicle.js";
import { knownLoc } from "./discovery.js";

// ---------- numbers ----------
export const OUTSIDERS = {
  raiders: {
    firstDay: 20, firstSpread: 6, gapMax: 30, gapMin: 10, gapSlope: 0.06, gapJitter: 0.25, caps: [[0, 1], [120, 2], [240, 3]],
    size: { base: 3, perDays: 30, extra: 2, min: 3, max: 14 }, power: { base: 2.6, perDays: 80, max: 3.4 }, stay: [8, 14], speed: 1.1,
    siegeYou: 8, siegeGroup: 12, greed: 10, tribute: 4, radioPay: 1.25, warnTiles: 4, baseShare: 0.6, teamShare: 0.9, groupShare: 1.2, groupWeight: 0.35, groupRaids: 1, caravanWeight: 0.5,
    keepOff: 2, toll: 0.35, tollCap: 3, siteMin: 0.45, siteTake: [0.1, 0.18], groupKeep: 0.6,
  },
  merchants: {
    firstDay: 8, firstSpread: 6, gap: [10, 16], caps: [[0, 1], [150, 2]], guards: [3, 5], guardsPerDays: 90, guardsMax: 7,
    guardPower: 3.5, guardPowerPerDays: 120, guardPowerMax: 2.5, traders: 2, stops: 3, stayYou: 24, stayGroup: 12, speed: 0.9,
    hubChance: 0.55, stay: 18, capacity: 300, capPerGuard: 40, goodwill: 15, skipYou: -30,
  },
  explorers: {
    firstDay: 5, firstSpread: 5, gap: [6, 12], caps: [[0, 2]], speed: 1, hostile: 0.08, stay: 14, shelterDays: 3, shelterMood: 3,
    giftChance: 0.5, joinChance: 0.35, searchTake: [0.03, 0.06], hubChance: { scouts: 0.3, refugees: 0.75, wanderers: 0.45 },
  },
  meetCooldown: 48, rep: { attack: 45, recover: 0.25, traders: 15, others: 8 },
};
export const VISITOR_KINDS = ["raiders", "merchants", "explorers"];
export const VISITOR_COLORS = { raiders: "#7a1a1a", merchants: "#d9a520", explorers: "#9a9a9a" };
const O = OUTSIDERS;
const KIND_LABEL = { raiders: "Raiders from outside", merchants: "Merchants from outside", explorers: "Travellers from outside" };
const SUB_LABEL = { scouts: "scouts", refugees: "refugees", wanderers: "wanderers" };

// Neighbouring states by the side of the map they come from (flavour, captions and the radio).
const NEIGHBORS = {
  north: ["Harlan", "the Northern Reach", "Kesselton"],
  south: ["Tallis", "the Gulf Free Zone", "Marrow County"],
  east: ["Brennan", "the Eastern Compact", "Ostrava"],
  west: ["Ostler", "the Western Plains", "New Albion"],
};
const RAIDER_NAMES = ["the Ash Riders", "the Dust Wolves", "the Hollow Men", "the Blackwater Crew", "the Salt Kings", "the Rattlers", "the Grave Dogs", "the Iron Saints", "the Night Herons", "the Bone Carvers"];
const MERCHANT_NAMES = ["Kessler", "Ortega", "Halvorsen", "Mbeki", "Duval", "Tanaka", "Rourke", "Petrov", "Asante", "Lindgren"];
const RUMORS = [
  "In {home} the militias hold the river towns; the bridges are blown and nobody crosses at night.",
  "{home} had a hard winter: whole towns walked south with what they could carry.",
  "There is a radio voice out of {home} that promises food and walls to anyone who comes. Nobody they know has come back.",
  "The dead in {home} move in herds of thousands along the old interstate. They follow the noise of the trains that no longer run.",
  "A convoy of soldiers passed through {home} a month ago, heading for the coast. They did not stop for anyone.",
  "In {home} they burn the fields at the edge of town to keep the dead from hiding in the corn.",
  "Fuel is gold in {home}. A full can buys a rifle; a full truck buys a house.",
  "Someone in {home} has a working hospital and a surgeon. They charge a month's food for a bed.",
  "The towns of {home} trade with each other now: a market every full moon at the old fairground.",
  "The roads out of {home} are mined in places. Watch for cars parked across a bridge.",
];
// Good gear merchants bring (data.js GEAR keys), and the books (skills.js WARE_BOOKS: traders).
export const RARE_GEAR = ["ar", "plate", "nvg", "milradio", "surgkit", "assaultpack", "riothelmet", "vest", "huntrifle", "waterfilter", "suppressor", "flashlight", "shotgun",
  "carbine", "xbow", "compbow", "rucksack", "hikingpack", "camonet", "stove", "smokegren", "guitar"];
// What a band of explorers or refugees may carry to trade (and the valuables merchants bring to sell on).
export const TRAVEL_GEAR = ["comic", "novel", "survivalbook", "waterfilter", "bandagekit", "crowbar", "flashlight", "slingbag", "harmonica", "cards", "stove", "ragboots", "scentmask", "chocolate", "instcoffee", "flare", "photos"];
export const MERCHANT_VALUABLES = ["watch", "goldchain", "cigars", "scotch", "coffee", "cigarettes", "coins", "camera", "diamond", "tea"];
const RARE_BOOKS = ["medbook", "surgerybook", "enginebook", "gardenbook", "gunbook", "armymanual", "survivalbook", "talkbook", "lockbook", "leadbook", "scavbook"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (c) => `${Math.round(c * 100)}%`;
const firstName = (s) => s.name.split(" ")[0];
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const style = (state) => (state.governor && state.governor.personality) || "balanced";

// ---------- state ----------
export function visitorInfo(state) {
  if (!state.visitors) state.visitors = [];
  if (!state.visitorInfo) {
    const rng = new Rng(Math.floor(hash01(state.seed, "outsiders") * 4294967296) >>> 0);
    const first = (k) => O[k].firstDay + rng.int(0, O[k].firstSpread);
    state.visitorInfo = {
      rng, next: { raiders: first("raiders"), merchants: first("merchants"), explorers: first("explorers") }, rep: 0,
      stats: { raiders: 0, merchants: 0, explorers: 0, left: 0, wiped: 0, raidsOnYou: 0, raidsOnGroups: 0, robbed: 0, sites: 0, trades: 0, groupTrades: 0, intel: 0, sheltered: 0, paid: 0, attacked: 0, fights: 0 },
    };
  }
  return state.visitorInfo;
}
const vrng = (state) => visitorInfo(state).rng;
export const visitorsOf = (state) => state.visitors || [];
export const visitorById = (state, id) => visitorsOf(state).find((v) => v.id === Number(id)) || null;
export const vStrength = (v) => Math.max(0, v.size) * v.power;
export const merchantRep = (state) => visitorInfo(state).rep;
const capFor = (kind, d) => O[kind].caps.reduce((n, [from, k]) => (d >= from ? k : n), 0);

export function gapDays(kind, d, rng) {
  if (kind === "raiders") {
    const R = O.raiders;
    return Math.max(1, Math.round(clamp(R.gapMax - R.gapSlope * d, R.gapMin, R.gapMax) * rng.range(1 - R.gapJitter, 1 + R.gapJitter)));
  }
  return rng.int(O[kind].gap[0], O[kind].gap[1]);
}
export function raiderSize(d, extra) {
  const S = O.raiders.size;
  return clamp(Math.round(S.base + d / S.perDays + extra), S.min, S.max);
}
export const raiderPower = (d) => Math.round((O.raiders.power.base + Math.min(O.raiders.power.max, d / O.raiders.power.perDays)) * 10) / 10;
export function gearText(power) {
  if (power < 3.2) return "clubs, machetes and old pistols";
  if (power < 4.2) return "shotguns and hunting rifles";
  if (power < 5.2) return "rifles and body armor";
  return "assault rifles and plate armor";
}

// ---------- the border ----------
export const isBorder = (state, tile) => { const t = state.tiles[tile]; const g = state.grid; return t.x === 0 || t.y === 0 || t.x === g.width - 1 || t.y === g.height - 1; };
export function sideOf(state, tile) {
  const t = state.tiles[tile], g = state.grid;
  const d = { west: t.x, east: g.width - 1 - t.x, north: t.y, south: g.height - 1 - t.y };
  return Object.keys(d).sort((a, b) => d[a] - d[b])[0];
}
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };

// ---------- making a party ----------
function usedNames(state) { return new Set(visitorsOf(state).map((v) => v.name)); }
function makeVisitor(state, kind, tile, opts = {}) {
  const rng = vrng(state), d = day(state);
  const side = sideOf(state, tile);
  const info = visitorInfo(state);
  info.made = (info.made || 0) + 1;
  const v = {
    id: newId(), serial: info.made, kind, sub: null, name: "", tile, from: side, home: rng.pick(NEIGHBORS[side]), path: [tile], idx: 0, progress: 0,
    phase: "travel", goal: null, act: "crossing the border", entered: state.hour, until: state.hour + 24 * 14,
    size: 1, size0: 1, power: 2.5, stock: {}, wares: [], capacity: 60, met: {}, trail: [tile], trailHours: [state.hour], done: {},
    known: false, live: false, heard: false, seen: null, warned: false, hostile: false, joiners: 0, stops: [], stopIdx: -1, exit: null,
    // What trade.js reads from a group: a visitor is priced like one.
    type: "traders", pop: 4, goodwill: 0, alive: true, outsider: true, pact: null, bases: [], lootedGear: [], color: VISITOR_COLORS[kind],
  };
  for (const k of SUPPLY_KEYS) v.stock[k] = 0;
  const taken = usedNames(state);
  if (kind === "raiders") {
    const R = O.raiders;
    v.name = rng.pick(RAIDER_NAMES.filter((n) => !taken.has(n)).concat(taken.size >= RAIDER_NAMES.length ? RAIDER_NAMES : []));
    v.size = opts.size || raiderSize(d, rng.int(0, R.size.extra));
    v.power = opts.power || raiderPower(d);
    v.type = "raider";
    v.goodwill = -80;
    v.until = state.hour + 24 * rng.int(R.stay[0], R.stay[1]);
    v.capacity = 40 + v.size * 25;
    v.greed = Math.round(vStrength(v) * R.greed);
    v.hostile = true;
    v.stock.food = v.size * 3;
    v.stock.ammo = v.size * 10;
  } else if (kind === "merchants") {
    const M = O.merchants;
    const fam = rng.pick(MERCHANT_NAMES.filter((n) => !taken.has(`the ${n} caravan`)).concat(MERCHANT_NAMES));
    v.name = `the ${fam} caravan`;
    const guards = clamp(rng.int(M.guards[0], M.guards[1]) + Math.floor(d / M.guardsPerDays), M.guards[0], M.guardsMax);
    v.guards = guards;
    v.size = guards + M.traders;
    v.power = Math.round((M.guardPower + Math.min(M.guardPowerMax, d / M.guardPowerPerDays)) * 10) / 10;
    v.pop = v.size;
    v.goodwill = clamp(M.goodwill + visitorInfo(state).rep, -100, 40);
    v.capacity = M.capacity + guards * M.capPerGuard;
    v.until = state.hour + 24 * M.stay;
    v.wantsYou = rng.chance(M.hubChance) && visitorInfo(state).rep > M.skipYou;
    merchantGoods(state, v, rng);
  } else {
    const E = O.explorers;
    const r = rng.next();
    v.sub = opts.sub || (r < 0.4 ? "scouts" : r < 0.75 ? "refugees" : "wanderers");
    v.size = v.sub === "scouts" ? rng.int(2, 3) : v.sub === "refugees" ? rng.int(2, 5) : rng.int(1, 2);
    v.power = v.sub === "scouts" ? 3.2 : 2.2;
    v.pop = v.size;
    v.name = v.sub === "wanderers" ? (v.size === 1 ? "a lone wanderer" : "a pair of wanderers") : `${SUB_LABEL[v.sub]} from ${v.home}`;
    v.hostile = opts.hostile != null ? !!opts.hostile : rng.chance(E.hostile);
    v.goodwill = v.hostile ? -20 : 10;
    v.joiners = v.hostile ? 0 : v.sub === "refugees" ? Math.min(v.size, rng.int(1, 3)) : v.sub === "wanderers" ? (rng.chance(0.5) ? 1 : 0) : (rng.chance(0.1) ? 1 : 0);
    v.wantsYou = opts.wantsYou != null ? !!opts.wantsYou : rng.chance(E.hubChance[v.sub]);
    v.until = state.hour + 24 * E.stay;
    v.capacity = 20 * v.size;
    v.stock.food = rng.int(2, 6) * v.size;
    v.stock.water = rng.int(2, 5) * v.size;
    v.stock.ammo = v.sub === "scouts" ? rng.int(20, 40) : rng.int(0, 12);
    v.stock.meds = v.sub === "scouts" ? rng.int(1, 3) : 0;
    if (rng.chance(0.4)) v.wares.push(newItem(rng.pick(TRAVEL_GEAR), Math.round(rng.range(0.5, 0.9) * 100) / 100));
  }
  v.size0 = v.size;
  return v;
}

function merchantGoods(state, v, rng) {
  Object.assign(v.stock, {
    fuel: rng.int(15, 40), meds: rng.int(8, 22), preserved: rng.int(20, 50), parts: rng.int(3, 9), ammo: rng.int(60, 160),
    food: rng.int(5, 15), water: rng.int(10, 20), scrap: 0, jars: 0,
  });
  const unknown = BP_KEYS.filter((id) => !isKnown(state, id));
  const bps = rng.shuffle([...(unknown.length ? unknown : BP_KEYS)]);
  const nBp = rng.chance(0.75) ? (rng.chance(0.25) ? 2 : 1) : 0;
  for (const id of bps.slice(0, nBp)) if (GEAR[bpItemKey(id)]) v.wares.push(newItem(bpItemKey(id), 1));
  const books = rng.shuffle(RARE_BOOKS.filter((k) => GEAR[k]));
  for (const k of books.slice(0, rng.int(1, 3))) v.wares.push(newItem(k, 1));
  const gear = rng.shuffle(RARE_GEAR.filter((k) => GEAR[k]));
  for (const k of gear.slice(0, rng.int(2, 4))) {
    const it = newItem(k, Math.round(rng.range(0.7, 1) * 100) / 100);
    if (it.dur) it.dur = Math.max(1, Math.round(it.dur * rng.range(0.6, 1)));
    v.wares.push(it);
  }
  // A few valuables to sell on (they also buy them: TRADE_PREFS merchants).
  for (const k of rng.shuffle([...MERCHANT_VALUABLES]).slice(0, rng.int(1, 2))) v.wares.push(newItem(k, 1));
}

// A new party at the border (kind: "raiders" | "merchants" | "explorers"). opts: { tile, size, power, sub, hostile,
// wantsYou } for tests. Returns the party, or null when no border tile leads anywhere.
export function spawnVisitor(state, kind, opts = {}) {
  const info = visitorInfo(state);
  const rng = info.rng;
  let edge = borderTiles(state, 6);
  if (!edge.length) edge = borderTiles(state, 0);
  if (kind === "merchants") { const roads = edge.filter((t) => t.road); if (roads.length) edge = roads; }
  for (let tries = 0; tries < 6 && (edge.length || opts.tile != null); tries++) {
    const tile = opts.tile != null ? opts.tile : rng.pick(edge).id;
    const v = makeVisitor(state, kind, tile, opts);
    state.visitors.push(v);
    const ok = kind === "raiders" ? retargetRaiders(state, v, true) : kind === "merchants" ? planMerchants(state, v) : planExplorers(state, v);
    if (ok) {
      info.stats[kind]++;
      const what = kind === "raiders" ? `Raiders from ${v.home} (${cap1(v.name)}, ${v.size}) cross into the state` : kind === "merchants" ? `A merchant caravan from ${v.home} (${cap1(v.name)}) crosses into the state` : null;
      if (what) chronicleNote(state, `${what} from the ${v.from}.`, kind === "raiders" ? "danger" : "world", tile);
      return v;
    }
    state.visitors.splice(state.visitors.indexOf(v), 1);
    if (opts.tile != null) break;
  }
  return null;
}

// ---------- goals and paths ----------
function setGoal(state, v, goal, act) {
  // A band that comes for another of your bases (after a raid elsewhere, a chase, a roam) is warned of again:
  // v.warned belonged to the last base it came for (raidWarning sets v.warnedBase).
  if (goal.kind === "base" && v.warnedBase !== goal.baseId) v.warned = false;
  if (goal.tile === v.tile) {
    v.goal = goal;
    v.path = [v.tile];
    v.idx = 0;
    v.act = act;
    v.phase = "travel";
    return true;
  }
  const res = planPath(state, v.tile, goal.tile, false);
  if (!res) return false;
  v.goal = goal;
  v.path = res.path;
  v.idx = 0;
  v.act = act;
  v.phase = "travel";
  v.lastPath = state.hour;
  return true;
}

// The nearest border land tile they can walk to (prefer the side they are heading for).
function headOut(state, v, why = "") {
  const g = state.grid;
  const edge = borderTiles(state, 0);
  const prefer = v.exit != null ? [state.tiles[v.exit]] : [];
  const sorted = [...prefer, ...[...edge].sort((a, b) => g.distance(v.tile, a.id) - g.distance(v.tile, b.id) || a.id - b.id)];
  if (isBorder(state, v.tile)) { v.goal = { kind: "exit", tile: v.tile }; v.path = [v.tile]; v.idx = 0; v.phase = "travel"; v.act = "leaving the state"; return true; }
  for (const t of sorted.slice(0, 12)) {
    if (!t) continue;
    if (setGoal(state, v, { kind: "exit", tile: t.id }, `leaving the state${why ? ` ${why}` : ""}`)) return true;
  }
  return false;
}

export function leaveMap(state, v, how = "left") {
  const i = visitorsOf(state).indexOf(v);
  if (i < 0) return;
  state.visitors.splice(i, 1);
  const info = visitorInfo(state);
  if (state.trade && state.trade.visitorId === v.id) state.trade = null;
  if (state.tradeQueue) state.tradeQueue = state.tradeQueue.filter((t) => t.visitorId !== v.id);
  if (how === "wiped") {
    info.stats.wiped++;
    if (v.known && (v.live || v.heard)) log(state, `${cap1(v.name)} ${v.kind === "raiders" ? "are" : "were"} wiped out near ${tileLabel(state, v.tile)}.`, v.kind === "raiders" ? "good" : "danger");
    return;
  }
  if (how === "broken") { info.stats.wiped++; return; }
  info.stats.left++;
  if (isBorder(state, v.tile)) info.stats.leftAtBorder = (info.stats.leftAtBorder || 0) + 1; // off the map, as they should
  if (v.kind === "merchants") info.rep = clamp(info.rep + Math.max(0, (v.goodwill - v.startGoodwill) || 0) * 0.3, -100, 30);
  if (v.known) log(state, `${cap1(v.name)} ${v.kind === "explorers" && v.size === 1 ? "has" : "have"} left the State of Calder, to the ${sideOf(state, v.tile)}${v.kind === "raiders" && supplyValue(v.stock) > 40 ? ", with their loot" : ""}.`, "info");
}

// ---------- spawning (daily) ----------
export function visitorsDaily(state) {
  if (state.gameOver) return;
  const info = visitorInfo(state);
  const d = day(state);
  if (info.rep < 0) info.rep = Math.min(0, info.rep + O.rep.recover);
  for (const v of [...visitorsOf(state)]) if (v.phase === "sheltered") shelterDay(state, v);
  if (state.visitorsOff) return; // tools: a world without outsiders (the comparison runs)
  settleBands(state);
  for (const kind of VISITOR_KINDS) {
    if (d < info.next[kind]) continue;
    const n = visitorsOf(state).filter((v) => v.kind === kind).length;
    if (n < capFor(kind, d)) spawnVisitor(state, kind);
    info.next[kind] = d + gapDays(kind, d, info.rng);
  }
}

// ---------- raider bands that settle ----------
export const SETTLE = { people: 8, goods: 250, chance: 0.03, reach: 6 };
function settleBands(state) {
  const info = visitorInfo(state);
  const g = state.grid;
  for (const v of [...visitorsOf(state)]) {
    if (v.kind !== "raiders" || v.paid || v.phase === "battle" || v.phase === "siege" || v.size < SETTLE.people) continue;
    if (supplyValue(v.stock) < SETTLE.goods || !info.rng.chance(SETTLE.chance)) continue;
    const sites = g.within(v.tile, SETTLE.reach).map((id) => state.tiles[id]).filter((t) => (t.loc || t.ruin) && t.terrain !== "water" && !t.hive &&
      (t.owner == null || t.owner === undefined) && !(t.loc && (t.loc.type === "city" || t.loc.zone === "urban")) &&
      state.bases.every((b) => g.distance(b.tile, t.id) >= 6) && state.factions.every((f) => !f.alive || f.bases.every((b) => g.distance(b, t.id) >= 8)));
    if (!sites.length) continue;
    const site = sites.sort((a, b) => (b.ruin ? 1 : 0) - (a.ruin ? 1 : 0) || g.distance(v.tile, a.id) - g.distance(v.tile, b.id) || a.id - b.id)[0];
    const name = cap1(v.name.replace(/^the /i, ""));
    const f = makeGang(state, site.id, { type: "raider", pop: v.size, name, stock: v.stock, known: !!v.known, rng: info.rng });
    state.stats.bandsSettled = (state.stats.bandsSettled || 0) + 1;
    const place = site.ruin ? `the ruins of ${site.ruin.name}` : tileLabel(state, site.id);
    if (state.live.has(site.id) || inCoverage(state, site.id)) log(state, `${cap1(v.name)} have dug in at ${place}: a new gang in the state (${f.name}, ${v.size} people).`, "danger");
    else log(state, `Travellers speak of raiders from beyond the border digging in somewhere ${sideOf(state, site.id) ? `to the ${sideOf(state, site.id)}` : "out in the state"}.`, "danger");
    chronicleNote(state, `${cap1(v.name)} settled at ${tileLabel(state, site.id)}.`, "danger", site.id);
    const i = state.visitors.indexOf(v);
    if (i >= 0) state.visitors.splice(i, 1);
    if (state.trade && state.trade.visitorId === v.id) state.trade = null;
  }
}

// ---------- the hour ----------
export function visitorsHour(state) {
  if (state.gameOver || !state.visitors || !state.visitors.length) return;
  for (const v of [...state.visitors]) {
    if (!state.visitors.includes(v)) continue;
    visitorHour(state, v);
    if (state.visitors.includes(v)) sight(state, v);
  }
  meetings(state);
}

function visitorHour(state, v) {
  // Too long on the map: they slip away wherever they are.
  if (state.hour > v.until + 24 * 6) return leaveMap(state, v);
  if (v.phase === "battle") {
    const mine = (s) => s && s.context && s.context.visitorId === v.id;
    if (mine(state.combat && state.combat.setup) || (state.combatQueue || []).some(mine)) return;
    v.phase = "travel"; // the fight never happened (nobody left to fight it)
    return nextGoal(state, v);
  }
  if (v.phase === "sheltered") { if (state.hour >= v.shelterUntil) endShelter(state, v); return; }
  if (v.phase === "gate") {
    if (state.cards.some((c) => c.visitorId === v.id) || (state.trade && state.trade.visitorId === v.id)) return;
    if (state.hour < v.stayUntil) return;
    return nextGoal(state, v);
  }
  if (v.phase === "stop") {
    if (state.trade && state.trade.visitorId === v.id && v.goal && v.goal.kind === "base" && state.hour < v.stayUntil + 6) return;
    if (state.hour >= v.stayUntil) leaveStop(state, v);
    return;
  }
  if (v.phase === "siege") {
    // At your walls a strong defence drives them off sooner (factions.js siegePace); the hours set the damage.
    v.siegeHours = (v.siegeHours || 0) + 1;
    v.siegeLeft -= v.goal.kind === "base" ? siegePace(state, baseById(state, v.goal.baseId), vStrength(v)) : 1;
    if (v.goal.kind === "base" && !v.warned) { v.warned = true; raidWarning(state, v); }
    if (v.siegeLeft <= 0) {
      if (v.goal.kind === "base") resolveRaidOnYou(state, v);
      else if (v.goal.kind === "faction") raidGroup(state, v);
      if (state.visitors.includes(v) && v.phase === "siege") nextGoal(state, v);
    }
    return;
  }
  if (v.phase === "search") {
    v.searchLeft -= 1;
    if (v.searchLeft <= 0) { searchSite(state, v); if (state.visitors.includes(v)) nextGoal(state, v); }
    return;
  }
  // On the road.
  if (state.hour >= v.until && (!v.goal || v.goal.kind !== "exit") && !headOut(state, v)) return leaveMap(state, v);
  chase(state, v);
  if (!state.visitors.includes(v)) return;
  const entered = step(state, v);
  for (const id of entered) {
    if (!v.trail.includes(id)) { v.trail.push(id); v.trailHours.push(state.hour); if (v.trail.length > 200) { v.trail.shift(); v.trailHours.shift(); } }
    hordeOnTile(state, v, id);
    if (!state.visitors.includes(v)) return;
  }
  chase(state, v); // a moving target within reach now: strike
  if (!state.visitors.includes(v) || v.phase !== "travel") return;
  if (v.kind === "raiders" && v.goal && v.goal.kind === "base" && !v.warned) {
    const base = baseById(state, v.goal.baseId);
    if (base && (state.live.has(v.tile) || inCoverage(state, v.tile)) && state.grid.distance(v.tile, base.tile) <= O.raiders.warnTiles) {
      v.warned = true;
      raidWarning(state, v);
    }
  }
  if (v.idx >= v.path.length - 1) arrive(state, v);
}

function step(state, v) {
  if (v.idx >= v.path.length - 1) return [];
  v.progress += O[v.kind].speed;
  const entered = [];
  while (v.idx < v.path.length - 1) {
    const from = v.path[v.idx], to = v.path[v.idx + 1];
    const cost = moveCost(state, from, to, false) * travelFactor(state, { vehicle: false, tileId: to, from, hour: state.hour });
    if (!Number.isFinite(cost)) { v.path = v.path.slice(0, v.idx + 1); break; }
    if (v.progress < cost) break;
    v.progress -= cost;
    v.idx += 1;
    entered.push(v.path[v.idx]);
  }
  if (v.idx >= v.path.length - 1) v.progress = 0;
  v.tile = v.path[v.idx];
  return entered;
}

// The dead on a tile they walk into: a fight that costs both sides.
function hordeOnTile(state, v, id) {
  const horde = state.hordes.find((h) => h.tile === id);
  if (!horde) return;
  const rng = vrng(state);
  const lost = v.kind === "explorers" ? (rng.chance(0.4) ? 1 : 0) : Math.ceil(v.size * 0.2);
  horde.size = Math.max(0, horde.size - Math.round(vStrength(v) * 0.6));
  if (horde.size < 5) state.hordes.splice(state.hordes.indexOf(horde), 1);
  v.size -= lost;
  if (v.size <= 0) leaveMap(state, v, "wiped");
}

// Moving targets: they follow a team, a caravan or a merchant train, and strike when within a tile.
function chase(state, v) {
  const goal = v.goal;
  if (!goal || !["party", "aiparty", "visitor"].includes(goal.kind)) return;
  const g = state.grid;
  const target = goal.kind === "visitor" ? visitorById(state, goal.visitorId) : state.parties.find((p) => p.id === goal.partyId);
  if (!target) return nextGoal(state, v);
  const tile = goal.kind === "visitor" ? target.tile : partyTile(target);
  if (goal.kind === "party" && state.bases.some((b) => g.distance(b.tile, tile) <= O.raiders.keepOff)) return nextGoal(state, v); // too close to your walls
  if (goal.kind === "party" && (v.spared || []).includes(`p${target.id}`)) return nextGoal(state, v);
  if (goal.kind === "aiparty" && target.phase === "trading") return nextGoal(state, v); // at your gates: they will not follow it there
  if (g.distance(v.tile, tile) <= 1) {
    if (goal.kind === "aiparty") return robAiParty(state, v, target);
    if (goal.kind === "visitor") return robMerchants(state, v, target);
    if (target.kind === "convoy") return hitConvoy(state, v, target);
    // A team of yours: meetings() gives the team its card. Met it lately (and it got away)? Then look elsewhere.
    if (v.met[target.id] != null && state.hour - v.met[target.id] < O.meetCooldown) return nextGoal(state, v);
    return;
  }
  if (tile !== goal.tile || state.hour - (v.lastPath || 0) >= 4) {
    goal.tile = tile;
    const res = planPath(state, v.tile, tile, false);
    if (!res) return nextGoal(state, v);
    v.path = res.path;
    v.idx = 0;
    v.lastPath = state.hour;
  }
}

function arrive(state, v) {
  const goal = v.goal;
  if (!goal) return nextGoal(state, v);
  if (v.tile !== goal.tile && !["party", "aiparty", "visitor"].includes(goal.kind)) {
    // Blocked on the way (the path was cut): try again from here.
    if (!setGoal(state, v, goal, v.act)) return nextGoal(state, v);
    return;
  }
  switch (goal.kind) {
    case "exit": return leaveMap(state, v);
    case "base": {
      const base = baseById(state, goal.baseId);
      if (!base || base.tile !== v.tile) return nextGoal(state, v);
      if (v.kind === "raiders") {
        v.phase = "siege";
        v.siegeLeft = O.raiders.siegeYou;
        v.siegeHours = 0;
        v.act = `at the walls of ${base.name}`;
        if (!v.warned) { v.warned = true; raidWarning(state, v); }
        return;
      }
      if (v.kind === "merchants") return merchantsAtBase(state, v, base);
      return explorersAtGate(state, v, base);
    }
    case "faction": {
      const f = factionById(state, goal.factionId);
      if (!f || !f.alive || !f.bases.includes(goal.tile)) return nextGoal(state, v);
      if (v.kind === "raiders") {
        v.phase = "siege";
        v.siegeLeft = O.raiders.siegeGroup;
        v.act = `besieging ${f.known ? f.name : "a group's base"} at ${tileLabel(state, goal.tile)}`;
        chronicleNote(state, `${cap1(v.name)}, raiders from outside, besiege ${f.name} ${placeOf(state, goal.tile)}.`, "world", goal.tile);
        return;
      }
      v.phase = "stop";
      v.stayUntil = state.hour + O.merchants.stayGroup;
      v.act = `trading at ${f.known ? f.name : tileLabel(state, goal.tile)}`;
      tradeWithGroup(state, v, f);
      return;
    }
    case "site": {
      v.phase = "search";
      v.searchLeft = vrng(state).int(4, 8);
      v.act = `${v.kind === "raiders" ? "looting" : "exploring"} ${tileLabel(state, goal.tile)}`;
      return;
    }
    default: return nextGoal(state, v);
  }
}
const placeOf = (state, tile) => { const t = state.tiles[tile]; return t && knownLoc(state, tile) ? `at ${t.loc.name}` : `near ${tileLabel(state, tile)}`; };

function nextGoal(state, v) {
  if (!state.visitors.includes(v)) return;
  v.phase = "travel";
  if (v.kind === "raiders") { if (!retargetRaiders(state, v)) headOut(state, v); return; }
  if (!nextStop(state, v)) headOut(state, v);
}

// Sites within GROUND tiles of a group's base are that group's scavenging grounds (aiscav.js range 10): outsiders do
// not loot or explore there.
export const GROUND = 8;
export const nearGroups = (state, tile) => state.factions.some((f) => f.alive && f.bases.some((b) => state.grid.distance(b, tile) <= GROUND));

// ---------- raiders: choosing a target ----------
const teamPower = (state, p) => partyMembers(state, p).reduce((a, s) => a + combatPower(s), 0);
export const carriedValue = (p) => SUPPLY_KEYS.reduce((a, k) => a + carried(p, k) * SUPPLIES[k].value, 0);

export function raidTargets(state, v) {
  const g = state.grid, S = vStrength(v), R = O.raiders, out = [];
  const near = (tile, max) => g.distance(v.tile, tile) <= max;
  for (const b of state.bases) {
    if ((v.spared || []).includes(b.id) || !near(b.tile, 32)) continue;
    const def = baseDefense(state, b);
    if (S < def * R.baseShare) continue;
    const val = Math.min(800, supplyValue(b.stock)) + 60;
    out.push({ w: (val / 100) * Math.min(2, S / (def + 4)) / (1 + g.distance(v.tile, b.tile) / 12), goal: { kind: "base", baseId: b.id, tile: b.tile }, act: `heading for ${b.name}` });
  }
  for (const p of state.parties) {
    if (!p.path || !p.path.length) continue;
    const tile = partyTile(p);
    if (!near(tile, 18)) continue;
    if (p.owner === "player") {
      if (state.bases.some((b) => g.distance(b.tile, tile) <= R.keepOff) || (v.spared || []).includes(`p${p.id}`)) continue;
      const pow = teamPower(state, p);
      if (!pow || S < pow * R.teamShare) continue;
      out.push({ w: ((carriedValue(p) + 40) / 100) * 0.8 / (1 + g.distance(v.tile, tile) / 10), goal: { kind: "party", partyId: p.id, tile }, act: "stalking travellers on the road" });
    } else if (p.kind === "caravan" || p.kind === "convoy") {
      if (S < (p.strength || 2) * 1.1 || p.phase === "trading" || (p.vehicle && !near(tile, 2))) continue; // a truck they can only catch close by
      out.push({ w: R.caravanWeight / (1 + g.distance(v.tile, tile) / 10), goal: { kind: "aiparty", partyId: p.id, tile }, act: "hunting a caravan" });
    }
  }
  for (const f of state.factions) {
    if (!f.alive || (v.groupRaids || 0) >= R.groupRaids) continue; // one group's base a band at most
    const def = 8 + groupStrength(f) * 0.8;
    if (S < def * R.groupShare) continue;
    for (const b of f.bases) {
      if (!near(b, 28)) continue;
      const val = Math.min(600, supplyValue(f.stock)) * 0.4 + 40;
      out.push({ w: R.groupWeight * (val / 100) * Math.min(2, S / def) / (1 + g.distance(v.tile, b) / 12), goal: { kind: "faction", factionId: f.id, tile: b }, act: `heading for ${f.known ? f.name : "a group's base"}` });
    }
  }
  for (const m of visitorsOf(state)) {
    if (m.kind !== "merchants" || m.phase === "stop" || S < vStrength(m) * 1.1 || !near(m.tile, 16)) continue;
    out.push({ w: 1.5 / (1 + g.distance(v.tile, m.tile) / 10), goal: { kind: "visitor", visitorId: m.id, tile: m.tile }, act: "hunting a merchant caravan" });
  }
  for (const id of g.within(v.tile, 14)) {
    const t = state.tiles[id];
    if (!t.loc || t.loot < R.siteMin || t.owner != null || t.hive || state.bases.some((b) => b.tile === id)) continue;
    if (nearGroups(state, id)) continue; // the groups' own scavenging grounds (aiscav.js): outsiders keep away
    out.push({ w: t.loot * 1.2 / (1 + g.distance(v.tile, id) / 8), goal: { kind: "site", tile: id }, act: `heading for ${tileLabel(state, id)}` });
  }
  return out;
}

function retargetRaiders(state, v, first = false) {
  const R = O.raiders;
  if (!first && (v.paid || state.hour >= v.until || v.size < Math.max(2, Math.ceil(v.size0 / 2)) || supplyValue(v.stock) - v.size * 8 >= v.greed)) return headOut(state, v);
  const rng = vrng(state);
  const opts = raidTargets(state, v);
  while (opts.length) {
    const pick = rng.weighted(opts, (x) => x.w);
    if (setGoal(state, v, pick.goal, pick.act)) return true;
    opts.splice(opts.indexOf(pick), 1);
  }
  if (first) return headOut(state, v);
  // Nothing worth it within reach: roam toward the middle of the state for a day, then look again.
  const g = state.grid;
  const mid = g.id(Math.floor(g.width / 2), Math.floor(g.height / 2));
  const land = g.within(mid, 6).filter((id) => state.tiles[id].terrain !== "water");
  if (!R || !land.length) return headOut(state, v);
  return setGoal(state, v, { kind: "roam", tile: rng.pick(land) }, "roaming the back roads");
}

// ---------- raiders: your bases ----------
export function outsiderRaidOn(state, baseId) {
  return visitorsOf(state).some((v) => v.kind === "raiders" && v.goal && v.goal.kind === "base" && v.goal.baseId === baseId && (v.phase === "travel" || v.phase === "siege" || v.phase === "battle"));
}
export const tributeValue = (v) => Math.round(vStrength(v) * O.raiders.tribute);
const PAY_ORDER = ["ammo", "food", "preserved", "meds", "fuel", "scrap", "parts"];
// Goods worth `value` from a stock, in PAY_ORDER (null when the stock does not hold that much).
export function stockPlan(stock, value) {
  const plan = {};
  let left = value;
  for (const k of PAY_ORDER) {
    if (left <= 0) break;
    const have = Math.floor(stock[k] || 0);
    if (have <= 0) continue;
    const q = Math.min(have, Math.ceil(left / SUPPLIES[k].value));
    plan[k] = q;
    left -= q * SUPPLIES[k].value;
  }
  return left > 0 ? null : plan;
}
const planText = (plan) => Object.entries(plan).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${k}`).join(", ");
function payFromStock(stock, plan, to) {
  for (const [k, q] of Object.entries(plan)) {
    stock[k] = Math.max(0, (stock[k] || 0) - q);
    if (to) to[k] = (to[k] || 0) + q;
  }
}
const talkChance = (speech) => clamp(0.1 + 0.035 * speech, 0.1, 0.75);

function raidWarning(state, v) {
  const base = baseById(state, v.goal.baseId);
  if (!base) return;
  v.warnedBase = base.id;
  v.known = true;
  v.seen = { tile: v.tile, hour: state.hour };
  const def = baseDefense(state, base);
  const was = base.alert;
  base.alert = true;
  const prepared = baseDefense(state, base);
  base.alert = was;
  const S = vStrength(v);
  const speech = tradeSpeech(atBase(state, base.id));
  const tc = talkChance(speech);
  const price = () => stockPlan(base.stock, tributeValue(v));
  const half = () => stockPlan(base.stock, Math.ceil(tributeValue(v) / 2));
  const there = (st) => st.visitors.includes(v) && st.bases.includes(base);
  const dist = state.grid.distance(v.tile, base.tile);
  const ratio = def / Math.max(1, S), ratioP = prepared / Math.max(1, S);
  const P = (st) => style(st);
  const p0 = price();
  addCard(state, {
    title: `Outsider raiders heading for ${base.name}`, visitorId: v.id,
    text: `${cap1(v.name)}, about ${v.size} raiders from ${v.home} with ${gearText(v.power)}, are ${dist ? `${dist} tile${dist === 1 ? "" : "s"} out` : "at the walls"} (strength about ${Math.round(S)}). They are not one of the groups you know: they want what is in your stores, and then they will be gone. Current defense: ${Math.round(def)}.`,
    choices: [
      {
        label: "Prepare defenses", hint: `Everyone at the base takes a post. Defense ${Math.round(def)} → ${Math.round(prepared)}. Held at 1.2× their strength, a break-in from 0.8×`,
        ai: (st) => (ratioP >= 1.2 ? 70 : ratioP >= 0.9 ? 45 : 20),
        resolve: (st) => { base.alert = true; return `${base.name} prepares for the attack.`; },
      },
      {
        label: `Pay them off (${p0 ? planText(p0) : `${tributeValue(v)} worth of goods`})`, hint: "They take it and leave the state",
        disabled: (st) => !there(st) || !price(),
        ai: (st) => (!price() ? -99 : P(st) === "cautious" ? (ratioP < 1.5 ? 80 : 30) : P(st) === "aggressive" ? (ratioP < 0.8 ? 50 : 5) : ratioP < 1 ? 65 : 25),
        resolve: (st) => {
          if (!there(st)) return "The raiders are gone.";
          const plan = price();
          if (!plan) return `${base.name} no longer has that to give. They keep coming.`;
          payFromStock(base.stock, plan, v.stock);
          paidOff(st, v, base);
          return `${cap1(v.name)} took ${planText(plan)} and turned back.`;
        },
      },
      {
        label: `Talk them down (Speech ${speech}: ${pct(tc)})`, hint: "If it works they settle for half the price and leave; if not, they come on",
        disabled: (st) => !there(st) || !half(),
        ai: (st) => (!half() ? -99 : tc * 70 + (P(st) === "cautious" ? 10 : 0)),
        resolve: (st) => {
          if (!there(st)) return "The raiders are gone.";
          const best = [...atBase(st, base.id)].sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0];
          if (best) gainXp(st, best, "speech", USE.talk);
          if (!vrng(st).chance(tc)) return `They laugh at the offer. ${cap1(v.name)} keep coming.`;
          const plan = half();
          if (!plan) return "There is not enough in the stores even for that.";
          payFromStock(base.stock, plan, v.stock);
          paidOff(st, v, base);
          return `${best ? firstName(best) : "Your speaker"} talked them down: they took ${planText(plan)} and turned back.`;
        },
      },
      {
        label: "Defend in person (tactical)", hint: `Fight them yourself with the people at ${base.name} (${atBase(state, base.id).length} there). Win and the band is broken, and what they carry is yours; lose and they break in`,
        disabled: (st) => !atBase(st, base.id).length || !there(st),
        ai: (st) => (P(st) === "aggressive" && ratioP >= 0.9 ? 85 : ratioP >= 1.6 ? 50 : 10),
        resolve: (st) => defendAgainst(st, v, base),
      },
      { label: "Hold as you are", ai: () => (ratio >= 1.6 ? 60 : 5), resolve: () => "You wait." },
    ],
  });
}

function paidOff(state, v, base) {
  v.paid = true;
  v.spared = [...(v.spared || []), base ? base.id : -1];
  if (base) base.alert = false;
  visitorInfo(state).stats.paid++;
  v.phase = "travel";
  headOut(state, v, "with your payment");
}

function defendAgainst(state, v, base) {
  if (!state.visitors.includes(v)) return "The raiders are gone.";
  const siegeHours = v.phase === "siege" ? v.siegeHours || 0 : 0;
  v.phase = "battle";
  startCombat(state, {
    tile: base.tile, baseId: base.id,
    enemy: { kind: "raiders", count: clamp(v.size, 1, 14), power: v.power, name: cap1(v.name) },
    ambush: base.alert ? "player" : null, canRetreat: true, handler: "outsiderRaid", context: { visitorId: v.id, baseId: base.id, fromTile: v.tile, strength: vStrength(v), siegeHours }, // canRetreat: a way out away from them (deploy.js); they loot and move on
    layout: "baseDefence", deploy: true,
  });
  return "";
}

function steal(base, frac, into) {
  for (const k of Object.keys(base.stock)) {
    const q = Math.floor((base.stock[k] || 0) * frac);
    if (q <= 0) continue;
    base.stock[k] -= q;
    if (into && SUPPLIES[k]) into[k] = (into[k] || 0) + q;
  }
}

// After 8 hours at the walls: the numbers decide (the same thresholds as a group's raid, factions.js).
export function resolveRaidOnYou(state, v, beaten = null) {
  const base = baseById(state, v.goal && v.goal.baseId);
  const rng = vrng(state);
  if (!base) return nextGoal(state, v);
  const info = visitorInfo(state);
  info.stats.raidsOnYou++;
  const people = beaten ? [] : atBase(state, base.id);
  const def = baseDefense(state, base);
  if (!beaten) base.stock.ammo = Math.max(0, (base.stock.ammo || 0) - people.length * 3);
  const ratio = beaten ? (beaten === "broken" ? 1 : 0) : def / Math.max(1, vStrength(v));
  const store = count(base, "storehouse") > 0;
  const att = vStrength(v);
  const hours = beaten ? 8 : Math.max(1, v.siegeHours || O.raiders.siegeYou);
  const before = { ...base.stock };
  base.alert = false;
  let outcome, head;
  if (ratio >= 1.2) {
    outcome = "held";
    state.stats.raidsRepelled += 1;
    v.size -= rng.int(1, 3);
    head = `${base.name} drove off ${v.name} after ${hours} hour${hours === 1 ? "" : "s"} at the walls.`;
    log(state, `${base.name} drove off ${v.name}, raiders from outside the state.`, "good");
    if (people.length && rng.chance(0.4)) hurt(state, people[rng.int(0, people.length - 1)], rng.int(10, 30), base.tile, `defending ${base.name}`);
    v.spared = [...(v.spared || []), base.id];
  } else if (ratio >= 0.8) {
    outcome = "broken";
    head = `${cap1(v.name)} broke into ${base.name} before being pushed out.`;
    log(state, `${cap1(v.name)} broke into ${base.name} before being pushed out. Supplies were stolen.`, "danger");
    steal(base, store ? 0.1 : 0.2, v.stock);
    for (let i = 0; i < 2 && people.length; i++) hurt(state, people[rng.int(0, people.length - 1)], rng.int(15, 45), base.tile, `defending ${base.name}`);
    v.size -= 1;
    v.spared = [...(v.spared || []), base.id];
  } else {
    outcome = "overrun";
    head = `${cap1(v.name)} overran ${base.name}.`;
    log(state, `${cap1(v.name)} overran ${base.name}.`, "death");
    steal(base, store ? 0.25 : 0.5, v.stock);
    for (let i = 0; i < 3 && people.length; i++) hurt(state, people[rng.int(0, people.length - 1)], rng.int(30, 70), base.tile, `when ${base.name} was overrun`);
    v.spared = [...(v.spared || []), base.id];
    // Raiders from outside never keep a base (they are passing through, conquest.js): an outpost they overrun is
    // burned and lost as before; one your people pulled out of (the evac strip) they only loot.
    if (base.type === "outpost" && beaten !== "retreat" && (people.length || beaten)) removeBase(state, base, "has been lost"); // an empty one is looted and left standing
  }
  // breakdowns.js: what they smashed, by their strength and the hours at the walls; a card with the bill.
  const kept = state.bases.includes(base);
  const dmg = kept ? raidDamage(state, base, { strength: att, hours, outcome, by: v.name }) : null;
  if (dmg && (dmg.broken.length || dmg.destroyed || dmg.damaged.length)) log(state, `${base.name}: ${dmg.text}`, outcome === "held" ? "info" : "danger");
  v.lastDamage = dmg ? dmg.text : "";
  if (!beaten && kept) {
    const took = stolenText(before, base.stock);
    raidReportCard(state, base, { title: outcome === "held" ? `${cap1(v.name)} driven off` : `Raid on ${base.name}`, text: [head, took ? `They took ${took}.` : "", dmg.text].filter(Boolean).join(" "), dmg });
  }
  if (v.size <= 0) return leaveMap(state, v, "broken");
  v.phase = "travel";
  if (!retargetRaiders(state, v)) headOut(state, v);
}

// ---------- raiders: everyone else ----------
function raidGroup(state, v) {
  const f = factionById(state, v.goal.factionId);
  if (!f || !f.alive || !f.bases.includes(v.goal.tile)) return;
  const info = visitorInfo(state);
  info.stats.raidsOnGroups++;
  v.groupRaids = (v.groupRaids || 0) + 1;
  const before = { ...f.stock };
  const party = { id: v.id, owner: "outsider", kind: "raid", strength: vStrength(v), target: { kind: "faction", factionId: f.id, tile: v.goal.tile }, raidName: `${v.name} (raiders from outside)` };
  const held = resolveRaidOnFaction(state, party, []);
  const rng = vrng(state);
  if (held) v.size -= rng.int(1, 2);
  else {
    let room = Math.max(0, v.capacity - cargoWeight(v.stock));
    for (const k of SUPPLY_KEYS) {
      const lost = Math.max(0, (before[k] || 0) - (f.stock[k] || 0));
      const q = Math.min(Math.floor(lost * O.raiders.groupKeep), Math.floor(room / SUPPLIES[k].weight));
      if (q <= 0) continue;
      v.stock[k] = (v.stock[k] || 0) + q;
      room -= q * SUPPLIES[k].weight;
    }
    v.size -= rng.chance(0.5) ? 1 : 0;
  }
  chronicleNote(state, held ? `${f.name} held off ${v.name}, raiders from outside.` : `${cap1(v.name)}, raiders from outside, hit ${f.name} hard.`, "world", v.goal.tile);
  if (v.size <= 0) leaveMap(state, v, "broken");
}
const cargoWeight = (stock) => SUPPLY_KEYS.reduce((a, k) => a + Math.max(0, stock[k] || 0) * SUPPLIES[k].weight, 0);
function addToStock(v, sup) {
  let room = Math.max(0, v.capacity - cargoWeight(v.stock));
  for (const [k, q0] of Object.entries(sup)) {
    if (!SUPPLIES[k]) continue;
    const q = Math.min(Math.floor(q0), Math.floor(room / SUPPLIES[k].weight));
    if (q <= 0) continue;
    v.stock[k] = (v.stock[k] || 0) + q;
    room -= q * SUPPLIES[k].weight;
  }
}

function robAiParty(state, v, q) {
  const f = factionById(state, q.owner);
  const rng = vrng(state);
  const seen = state.live.has(partyTile(q));
  if (vStrength(v) >= (q.strength || 2) * 1.1) {
    if (q.goods && q.goods.supplies) addToStock(v, q.goods.supplies);
    else addToStock(v, { food: 10, scrap: 10 });
    visitorInfo(state).stats.robbed++;
    if (seen) log(state, `${cap1(v.name)}, raiders from outside, robbed a ${f && f.known ? `${f.name} ` : ""}caravan near ${tileLabel(state, partyTile(q))}.`, "danger");
    removeParty(state, q);
    v.size -= rng.chance(0.3) ? 1 : 0;
  } else {
    v.size -= rng.int(1, 2);
    q.strength = (q.strength || 2) * 0.8;
  }
  if (v.size <= 0) return leaveMap(state, v, "broken");
  nextGoal(state, v);
}

function robMerchants(state, v, m) {
  const rng = vrng(state);
  const a = vStrength(v), d = vStrength(m);
  const win = rng.chance(clamp(0.5 + (a / Math.max(1, d) - 1) * 0.6, 0.05, 0.95));
  const seen = state.live.has(m.tile) || state.live.has(v.tile);
  if (win) {
    addToStock(v, m.stock);
    for (const k of SUPPLY_KEYS) m.stock[k] = Math.floor((m.stock[k] || 0) * 0.3);
    m.wares.splice(0, Math.ceil(m.wares.length / 2));
    m.size = Math.max(1, m.size - rng.int(1, 3));
    m.guards = Math.max(0, (m.guards || 0) - 2);
    v.size -= rng.int(0, 1);
    visitorInfo(state).stats.robbed++;
    if (seen || m.known) log(state, `${cap1(v.name)} fell on ${m.name} near ${tileLabel(state, m.tile)} and plundered the wagons.`, "danger");
    chronicleNote(state, `Raiders from outside plundered ${m.name} ${placeOf(state, m.tile)}.`, "world", m.tile);
    m.phase = "travel";
    headOut(state, m, "after the robbery");
  } else {
    v.size -= rng.int(1, 3);
    m.size = Math.max(1, m.size - rng.int(0, 1));
    if (seen || m.known) log(state, `The guards of ${m.name} beat off ${v.name} near ${tileLabel(state, m.tile)}.`, "info");
  }
  if (v.size <= 0) return leaveMap(state, v, "broken");
  nextGoal(state, v);
}

// Your trade-route and supply convoys: the escort decides it (no card: convoys are auto-resolved, like road trouble).
function hitConvoy(state, v, p) {
  const rng = vrng(state);
  const members = partyMembers(state, p);
  const mine = members.reduce((a, s) => a + combatPower(s), 0) * 1.1;
  const win = rng.chance(clamp(0.5 + (vStrength(v) / Math.max(1, mine) - 1) * 0.6, 0.05, 0.95));
  const where = tileLabel(state, partyTile(p));
  if (win) {
    const taken = {};
    for (const k of Object.keys(p.cargo.supplies)) {
      const q = Math.floor((p.cargo.supplies[k] || 0) * 0.5);
      if (q <= 0) continue;
      p.cargo.supplies[k] -= q;
      taken[k] = q;
    }
    addToStock(v, taken);
    if (members.length) hurt(state, members[rng.int(0, members.length - 1)], rng.int(15, 45), partyTile(p), `when ${v.name} hit the convoy`);
    visitorInfo(state).stats.robbed++;
    log(state, `${cap1(v.name)}, raiders from outside, hit your convoy near ${where} and took ${planText(taken) || "nothing much"}.`, "danger");
  } else {
    v.size -= rng.int(1, 2);
    log(state, `Your convoy near ${where} beat off ${v.name}, raiders from outside.`, "good");
  }
  if (v.size <= 0) return leaveMap(state, v, "broken");
  v.spared = [...(v.spared || []), `p${p.id}`];
  nextGoal(state, v);
}

function searchSite(state, v) {
  const t = state.tiles[v.goal.tile];
  if (!t || !t.loc) return;
  const rng = vrng(state);
  const range = v.kind === "raiders" ? O.raiders.siteTake : O.explorers.searchTake;
  const take = t.loot * rng.range(range[0], range[1]);
  // aiscav.js keeps a floor under every site; outsiders never take it below that either.
  const floor = 0.03;
  const got = Math.max(0, Math.min(take, t.loot - floor));
  if (got <= 0) return;
  t.loot -= got;
  visitorInfo(state).stats.sites++;
  const value = got * (v.kind === "raiders" ? 300 : 120);
  addToStock(v, { food: Math.round(value * 0.35 / 2), ammo: Math.round(value * 0.25 / 0.5), scrap: Math.round(value * 0.2), meds: Math.round(value * 0.1 / 6), fuel: Math.round(value * 0.1 / 3) });
  if (state.live.has(t.id)) log(state, `${cap1(v.name)} ${v.kind === "raiders" ? "loot" : "pick through"} ${t.loc.name}.`, v.kind === "raiders" ? "danger" : "info");
}

// ---------- merchants ----------
function merchantStopBase(state, v) {
  const list = [...state.bases].sort((a, b) => (a.type === "hub" ? -1 : 0) - (b.type === "hub" ? -1 : 0) || state.grid.distance(v.tile, a.tile) - state.grid.distance(v.tile, b.tile));
  return list.find((b) => planPath(state, v.tile, b.tile, false)) || null;
}
function planMerchants(state, v) {
  const g = state.grid, rng = vrng(state);
  const groups = state.factions.filter((f) => f.alive && f.bases.length && f.type !== "raider" && f.type !== "zealot")
    .sort((a, b) => g.distance(v.tile, a.bases[0]) - g.distance(v.tile, b.bases[0]) || a.id - b.id);
  const picks = groups.slice(0, 2);
  const rest = groups.slice(2);
  if (rest.length && picks.length < O.merchants.stops) picks.push(rng.pick(rest));
  const stops = picks.map((f) => ({ kind: "faction", factionId: f.id, tile: f.bases[0] }));
  if (v.wantsYou) {
    const b = merchantStopBase(state, v);
    if (b) stops.splice(rng.int(0, stops.length), 0, { kind: "base", baseId: b.id, tile: b.tile });
  }
  // Order the stops nearest first from where they came in.
  const ordered = [];
  let at = v.tile;
  while (stops.length) {
    stops.sort((a, b) => g.distance(at, a.tile) - g.distance(at, b.tile) || a.tile - b.tile);
    const s = stops.shift();
    ordered.push(s);
    at = s.tile;
  }
  v.stops = ordered;
  v.stopIdx = -1;
  const far = borderTiles(state, 0).filter((t) => sideOf(state, t.id) === OPPOSITE[v.from]);
  v.exit = far.length ? rng.pick(far).id : null;
  v.startGoodwill = v.goodwill;
  if (!nextStop(state, v)) return headOut(state, v);
  return true;
}

function planExplorers(state, v) {
  const g = state.grid, rng = vrng(state);
  const sites = state.tiles.filter((t) => t.loc && t.loot >= 0.12 && !t.hive && t.owner == null && g.distance(v.tile, t.id) <= 24 && !state.bases.some((b) => b.tile === t.id) && !nearGroups(state, t.id));
  const picks = rng.shuffle(sites).slice(0, rng.int(2, 3)).map((t) => ({ kind: "site", tile: t.id }));
  if (v.wantsYou) {
    const b = merchantStopBase(state, v);
    if (b) picks.splice(rng.int(0, picks.length), 0, { kind: "base", baseId: b.id, tile: b.tile });
  }
  v.stops = picks;
  v.stopIdx = -1;
  if (!nextStop(state, v)) return headOut(state, v);
  return true;
}

function nextStop(state, v) {
  while (++v.stopIdx < v.stops.length) {
    const s = v.stops[v.stopIdx];
    if (s.kind === "faction") {
      const f = factionById(state, s.factionId);
      if (!f || !f.alive || !f.bases.length) continue;
      if (!f.bases.includes(s.tile)) s.tile = f.bases[0];
      if (setGoal(state, v, { ...s }, `on the road to ${f.known ? f.name : tileLabel(state, s.tile)}`)) return true;
    } else if (s.kind === "base") {
      const b = baseById(state, s.baseId);
      if (!b || (v.kind === "merchants" && (v.declined || attitude(v) === "Hostile" || visitorInfo(state).rep <= O.merchants.skipYou))) continue;
      if (setGoal(state, v, { kind: "base", baseId: b.id, tile: b.tile }, `on the road to ${b.name}`)) return true;
    } else if (s.kind === "site") {
      const t = state.tiles[s.tile];
      if (setGoal(state, v, { ...s }, `on the way to ${tileLabel(state, s.tile)}`)) return true;
    }
  }
  return false;
}

function leaveStop(state, v) {
  if (state.trade && state.trade.visitorId === v.id) state.trade = null;
  if (state.tradeQueue) state.tradeQueue = state.tradeQueue.filter((t) => t.visitorId !== v.id);
  const base = v.goal && v.goal.kind === "base" ? baseById(state, v.goal.baseId) : null;
  if (base && v.kind === "merchants") log(state, `${cap1(v.name)} leave ${base.name} and move on.`, "info");
  nextGoal(state, v);
}

function merchantsAtBase(state, v, base) {
  if (attitude(v) === "Hostile" || v.declined) return nextGoal(state, v);
  v.phase = "stop";
  v.stayUntil = state.hour + O.merchants.stayYou;
  v.act = `trading at ${base.name}`;
  v.known = true;
  v.seen = { tile: v.tile, hour: state.hour };
  const end = v.stayUntil;
  log(state, `A merchant caravan from ${v.home} (${v.name}) has arrived at ${base.name}. It stays until day ${Math.floor(end / 24) + 1}, ${String(end % 24).padStart(2, "0")}:00.`, "good");
  openVisitorTrade(state, v, { baseId: base.id });
}

// The goods the merchants sell a group and what they take for them: what the group is short of (need 1.2+) for what
// the merchants lack, at the group's need on both sides (value for value), at most a third of the merchants' stock.
export function tradeWithGroup(state, v, f) {
  // demand (trade.js): stock, kind and state on each side (a group at war wants ammo; merchants want food and scrap).
  const want = (x, k) => demand(state, x, k);
  const sells = SUPPLY_KEYS.filter((k) => want(f, k) >= 1.2 && available(v, k) > 0).sort((a, b) => want(f, b) - want(f, a));
  const wants = SUPPLY_KEYS.filter((k) => want(v, k) >= 1.2 && available(f, k) > 0).sort((a, b) => want(v, b) - want(v, a));
  const gave = [], got = [];
  for (const k of sells.slice(0, 2)) {
    const q = Math.min(available(v, k), Math.ceil((v.stock[k] || 0) / 3));
    if (q <= 0) continue;
    let value = q * SUPPLIES[k].value * want(f, k) * 0.9;
    const pay = {};
    for (const w of wants) {
      if (value <= 0) break;
      const per = SUPPLIES[w].value * want(v, w);
      const take = Math.min(available(f, w) - (pay[w] || 0), Math.ceil(value / per));
      if (take <= 0) continue;
      pay[w] = (pay[w] || 0) + take;
      value -= take * per;
    }
    if (!Object.keys(pay).length) continue;
    v.stock[k] -= q;
    f.stock[k] = (f.stock[k] || 0) + q;
    for (const [w, n] of Object.entries(pay)) { f.stock[w] -= n; v.stock[w] = (v.stock[w] || 0) + n; got.push(`${n} ${w}`); }
    gave.push(`${q} ${k}`);
  }
  // A piece of gear changes hands now and then (the group's wares, trade.js).
  if (v.wares.length && f.wares && vrng(state).chance(0.35)) f.wares.push(v.wares.splice(vrng(state).int(0, v.wares.length - 1), 1)[0]);
  if (!gave.length) return false;
  visitorInfo(state).stats.groupTrades++;
  if (f.known && (state.live.has(v.tile) || inCoverage(state, v.tile, 4))) log(state, `${cap1(v.name)} traded with ${f.name}: ${gave.join(", ")} for ${got.join(", ")}.`, "info");
  return true;
}

// The radio call when they come into your coverage: they offer to stop at your hub (or nearest base they can reach).
function merchantCall(state, v) {
  if (v.called || attitude(v) === "Hostile" || visitorInfo(state).rep <= O.merchants.skipYou) return;
  const base = merchantStopBase(state, v);
  if (!base) return;
  v.called = true;
  const coming = v.stops.some((s, i) => i >= v.stopIdx && s.kind === "base");
  const res = planPath(state, v.tile, base.tile, false);
  const eta = res ? travelHours(state, res.path, { speed: O.merchants.speed }).hours : null;
  const goods = goodsText(v);
  addCard(state, {
    title: "Traders on the radio", visitorId: v.id,
    text: `A caravan from ${v.home} (${v.name}: ${v.guards} guards, ${O.merchants.traders} traders) is passing ${placeOf(state, v.tile).replace(/^at /, "")}. They carry ${goods}. "We can stop at ${base.name}${eta != null ? ` in about ${eta} hours` : ""} if you want."${coming ? " They were coming your way anyway." : ""}`,
    choices: [
      {
        label: `Yes, come to ${base.name}`, hint: "They head for your base next and stay a day to trade (the trade window opens when they arrive)",
        ai: () => 70,
        resolve: (st) => inviteMerchants(st, v, base) },
      {
        label: "Not this time", hint: "They go on to the other groups and leave the state",
        ai: () => 10,
        resolve: (st) => { v.declined = true; if (v.goal && v.goal.kind === "base") nextGoal(st, v); return `${cap1(v.name)} will pass you by.`; },
      },
    ],
  });
}
export function goodsText(v) {
  const sup = SUPPLY_KEYS.filter((k) => (v.stock[k] || 0) >= 5).sort((a, b) => (v.stock[b] || 0) * SUPPLIES[b].value - (v.stock[a] || 0) * SUPPLIES[a].value).slice(0, 4).map((k) => SUPPLIES[k].name.toLowerCase());
  const items = v.wares.slice(0, 4).map((g) => g.name);
  return [...sup, ...items].join(", ") + (v.wares.length > 4 ? ` and ${v.wares.length - 4} more item${v.wares.length - 4 === 1 ? "" : "s"}` : "") || "very little";
}

// They come to one of your bases next (radio invite or the Groups tab).
export function inviteMerchants(state, v, base = null) {
  if (!state.visitors.includes(v) || v.kind !== "merchants") return "They are gone.";
  if (attitude(v) === "Hostile") return `${cap1(v.name)} want nothing to do with you.`;
  const b = base || merchantStopBase(state, v);
  if (!b) return "None of your bases can be reached from where they are.";
  v.declined = false;
  if (v.phase === "stop" && v.goal && v.goal.kind === "base" && v.goal.baseId === b.id) return `${cap1(v.name)} are already at ${b.name}.`;
  const at = v.stopIdx + 1;
  v.stops = v.stops.filter((s, i) => i < at || s.kind !== "base");
  v.stops.splice(at, 0, { kind: "base", baseId: b.id, tile: b.tile });
  if (v.phase === "travel" || v.phase === "search") { v.stopIdx = at - 1; v.phase = "travel"; nextStop(state, v); }
  return `${cap1(v.name)} will come to ${b.name}.`;
}

// ---------- trading with them (trade.js tradeContext / advanceTradeQueue call these) ----------
// where: { baseId } (they stop at your base) or { partyId } (your team meets them). Returns true when the window
// opened, false when it waits its turn behind another trade.
export function openVisitorTrade(state, v, where) {
  const t = { visitorId: v.id, baseId: where.baseId ?? null, partyId: where.partyId ?? null, factionId: null, offer: {}, ask: {}, offerGear: [], askGear: [], intel: { area: "", sightings: false, sell: false } };
  if (t.partyId != null) {
    const p = state.parties.find((x) => x.id === t.partyId);
    if (!p) return false;
    p.phase = "engaged";
  }
  if (state.trade && state.trade.visitorId === v.id) return true;
  if (state.trade && tradeContext(state)) {
    const q = (state.tradeQueue = state.tradeQueue || []);
    if (!q.some((x) => x.visitorId === v.id && x.partyId === t.partyId)) q.push(t);
    return false;
  }
  v.known = true;
  state.trade = t;
  return true;
}
export function resumeVisitorTrade(state, t) {
  const v = visitorById(state, t.visitorId);
  if (t.partyId != null) {
    const p = state.parties.find((x) => x.id === t.partyId);
    if (!p || p.phase !== "engaged" || !partyMembers(state, p).length) return;
    if (!v || attitude(v) === "Hostile" || state.grid.distance(partyTile(p), v.tile) > 1) { awaitOrders(state, p, "The traders have moved on."); return; }
  } else if (!v || v.phase !== "stop") return;
  state.trade = t;
}
export function visitorTradeContext(state, t) {
  const v = visitorById(state, t.visitorId);
  if (!v || !v.alive) return null;
  const have = {}, theirHave = {};
  for (const k of SUPPLY_KEYS) theirHave[k] = available(v, k);
  if (t.partyId == null) {
    const base = baseById(state, t.baseId);
    if (!base || v.phase !== "stop" || v.tile !== base.tile) return null;
    const speech = tradeSpeech(atBase(state, base.id));
    for (const k of SUPPLY_KEYS) have[k] = Math.max(0, Math.floor(base.stock[k] || 0));
    // trade.js treats this as a caravan at your gates: their goods are the visitor's own stock and wares.
    const caravan = { id: v.id, goods: { supplies: v.stock, gear: v.wares }, capacity: v.capacity, strength: vStrength(v), stayUntil: v.stayUntil, phase: "trading", visitorId: v.id };
    return { kind: "caravan", t, f: v, caravan, base, p: null, speech, have, theirHave, myGear: base.armory, theirGear: v.wares, center: v.tile, visitor: v };
  }
  const p = state.parties.find((q) => q.id === t.partyId);
  if (!p || state.grid.distance(partyTile(p), v.tile) > 1) return null;
  const speech = tradeSpeech(partyMembers(state, p));
  for (const k of SUPPLY_KEYS) have[k] = Math.max(0, Math.floor((p.supplies[k] || 0) + (p.cargo.supplies[k] || 0)));
  return { kind: "visit", t, f: v, p, caravan: null, base: null, speech, have, theirHave, myGear: p.cargo.gear, theirGear: v.wares, center: partyTile(p), visitor: v };
}

// The autopilot at the merchants' wagons (autopilot.js handleTrade): buys a manual nobody has studied when the
// hub has surplus to pay with, then what the hub is short of with what it has plenty of. needs: autopilot.js needs().
export function autoVisitorTrade(state, needs, styleKey = "balanced") {
  const ctx = tradeContext(state);
  if (!ctx || !ctx.visitor) return "";
  const t = ctx.t;
  t.offer = {}; t.ask = {}; t.offerGear = []; t.askGear = []; t.deal = null;
  const out = [];
  // Pay with what they want most (trade.js demand) among what the hub has plenty of.
  const plenty = Object.keys(needs).filter((k) => needs[k] <= 0.6 && (ctx.have[k] || 0) > 0).sort((a, b) => demand(state, ctx.f, b) - demand(state, ctx.f, a) || needs[a] - needs[b]);
  const short = Object.keys(needs).filter((k) => needs[k] >= 1.2 && (ctx.theirHave[k] || 0) > 0).sort((a, b) => needs[b] - needs[a]);
  const tryDeal = () => {
    for (const k of plenty) { if (tradeVerdict(state).ok) break; if (!t.ask[k]) balanceWith(state, k); }
    if (tradeVerdict(state).ok) { const r = executeTrade(state); if (/^Traded/.test(r)) { out.push(r.replace(/^Traded with [^:]+: /, "").replace(/\.$/, "")); return true; } }
    t.offer = {}; t.ask = {}; t.offerGear = []; t.askGear = [];
    return false;
  };
  // A manual for a building or craft you cannot make yet (blueprints.js), one at a time.
  const bp = ctx.theirGear.findIndex((g) => GEAR[g.key] && GEAR[g.key].blueprint && !isKnown(state, GEAR[g.key].blueprint));
  if (bp >= 0 && plenty.length && styleKey !== "aggressive") { t.askGear = [ctx.theirGear[bp]]; tryDeal(); }
  for (const k of short.slice(0, 2)) setQty(state, "theirs", k, Math.min(ctx.theirHave[k], k === "ammo" ? 80 : 20));
  if (short.length) tryDeal();
  // At a base: valuables and spare weapons they pay well for (trade.js autoSellGear).
  if (ctx.base && tradeContext(state)) { const r = autoSellGear(state, needs); if (/^Traded/.test(r)) out.push(r.replace(/^Traded with [^:]+: /, "").replace(/\.$/, "")); }
  if (ctx.p) {
    // A team: carry space decides; the visit ends and the team goes on.
    endTrade(state);
  } else endTrade(state);
  if (out.length) visitorInfo(state).stats.trades++;
  return out.length ? out.join("; ") : "nothing worth swapping";
}

// Attacking merchants (the trade window at your base, or a team's road card): reputation first, then the fight.
function blameYou(state, v) {
  const info = visitorInfo(state);
  info.rep = clamp(info.rep - O.rep.attack, -100, 30);
  info.stats.attacked++;
  v.goodwill = -100;
  for (const f of state.factions) {
    if (!f.alive || !f.known) continue;
    if (f.type === "traders") changeGoodwill(state, f, -O.rep.traders, "word of your attack on travelling merchants spreads");
    else if (f.type === "commune" || f.type === "fortress") changeGoodwill(state, f, -O.rep.others, "word of your attack on travelling merchants spreads");
  }
}
export function attackMerchants(state, v, where) {
  if (!state.visitors.includes(v) || v.kind === "raiders") return "They are gone.";
  const base = where.baseId != null ? baseById(state, where.baseId) : null;
  const p = where.partyId != null ? state.parties.find((x) => x.id === where.partyId) : null;
  if (base && !atBase(state, base.id).length) return `Nobody at ${base.name} can fight.`;
  if (!base && !p) return "";
  if (state.trade && state.trade.visitorId === v.id) state.trade = null;
  blameYou(state, v);
  log(state, `You turn your guns on ${v.name}${base ? ` at ${base.name}` : ""}.`, "danger");
  v.phase = "battle";
  startCombat(state, {
    tile: base ? base.tile : partyTile(p), baseId: base ? base.id : undefined, partyId: p ? p.id : undefined,
    enemy: { kind: v.kind === "merchants" ? "guards" : "raiders", count: clamp(v.kind === "merchants" ? (v.guards || 1) : v.size, 1, 14), power: v.power, name: `${cap1(v.name)}'s guards` },
    ambush: "player", canRetreat: true, handler: "outsiderFight", context: { visitorId: v.id, baseId: base ? base.id : null, partyId: p ? p.id : null, robbing: true },
  });
  return "";
}

// ---------- explorers ----------
function explorersAtGate(state, v, base) {
  v.phase = "gate";
  v.stayUntil = state.hour + 12;
  v.act = `at the gate of ${base.name}`;
  v.known = true;
  v.seen = { tile: v.tile, hour: state.hour };
  v.gateBase = base.id;
  gateCard(state, v, base, "");
}

// What they saw on the way, as of when they passed: the tiles within r of their trail (r 1, scouts' maps 2).
export function intelTiles(state, v, r = 1) {
  const out = new Map();
  v.trail.forEach((id, i) => { for (const n of state.grid.within(id, r)) { const h = v.trailHours[i] ?? state.hour; if (!out.has(n) || out.get(n) < h) out.set(n, h); } });
  return out;
}
// Puts their report on your map (to = null) or into a team's report (to = the team: carried home or radioed in).
export function giveIntel(state, v, r = 1, to = null) {
  const tiles = intelTiles(state, v, r);
  let n = 0;
  for (const [id, h] of tiles) {
    const snap = { ...snapshot(state, id), hour: Math.min(state.hour, h) };
    if (to) { const cur = to.seen.get(id); if (!cur || cur.hour < snap.hour) { to.seen.set(id, snap); n++; } }
    else { const cur = state.knowledge[id]; if (!cur || cur.hour < snap.hour) { state.knowledge[id] = snap; n++; } }
  }
  if (to && to.radioLive) mergeKnowledge(state, to.seen);
  visitorInfo(state).stats.intel++;
  return n;
}
export function rumor(state, v) {
  const i = Math.floor(hash01(state.seed, "rumor", v.serial) * RUMORS.length) % RUMORS.length; // never the id: ids are process-wide
  return RUMORS[i].replace("{home}", v.home);
}

function gateCard(state, v, base, lead) {
  if (!state.visitors.includes(v) || !state.bases.includes(base)) return;
  const n = v.size;
  const here = (st) => st.visitors.includes(v) && (v.phase === "gate" || v.phase === "sheltered") && st.bases.includes(base);
  const gone = "They have moved on.";
  const again = (st, text) => { if (here(st) && v.phase === "gate") gateCard(st, v, base, text); return text; };
  const choices = [];
  const people = atBase(state, base.id);
  if (!v.done.news) {
    choices.push({
      label: "Hear their news", hint: v.sub === "scouts" ? "News of other states, and the hordes they passed" : "News of other states, and the way they came marked on your map (as it was when they passed)",
      ai: () => 90,
      resolve: (st) => {
        if (!here(st)) return gone;
        v.done.news = true;
        let text = `"${rumor(st, v)}"`;
        if (v.sub !== "scouts") { const k = giveIntel(st, v, 1); text += k ? ` They mark the way they came on your map (${k} tiles).` : " The way they came is already on your map."; }
        else {
          let h = 0;
          for (const id of new Set(v.trail)) if (st.hordes.some((x) => st.grid.distance(x.tile, id) <= 2)) { st.knowledge[id] = snapshot(st, id); h++; }
          text += h ? ` They point out the dead they passed (${h} tiles on your map).` : " They saw no hordes on the way.";
        }
        log(st, `Travellers at ${base.name}: ${text}`, "info");
        return again(st, text);
      },
    });
  }
  if (v.sub === "scouts" && !v.done.maps) {
    const price = () => stockPlan(base.stock, scoutPrice(v));
    choices.push({
      label: `Buy their maps (${price() ? planText(price()) : `${scoutPrice(v)} worth of goods`})`, hint: "Everything within 2 tiles of the way they came, on your map as it was when they passed",
      disabled: (st) => !here(st) || !price(),
      ai: (st) => (price() && style(st) !== "aggressive" ? 40 : -99),
      resolve: (st) => {
        if (!here(st)) return gone;
        const plan = price();
        if (!plan) return "You cannot pay for that now.";
        payFromStock(base.stock, plan, v.stock);
        v.done.maps = true;
        v.done.news = true;
        return again(st, `You bought their maps: ${giveIntel(st, v, 2)} tiles on your map.`);
      },
    });
  }
  if (!v.done.trade && (SUPPLY_KEYS.some((k) => available(v, k) > 0) || v.wares.length)) {
    choices.push({
      label: "Trade with them", hint: "Opens the trade window (they carry little). Their other offers wait in the Groups tab",
      ai: () => -50,
      resolve: (st) => { if (!here(st)) return gone; v.done.trade = true; openVisitorTrade(st, v, { baseId: base.id }); v.phase = "stop"; v.stayUntil = st.hour + 6; return ""; },
    });
  }
  if (v.joiners > 0 && !v.hostile) {
    choices.push({
      label: `Hear who wants to stay (${v.joiners})`, hint: "A recruit card: who they are, beds, food and water",
      ai: () => 45,
      resolve: (st) => {
        if (!here(st)) return gone;
        const k = v.joiners;
        v.joiners = 0;
        const list = Array.from({ length: k }, () => makeCandidate(st, { quality: v.sub === "refugees" ? 0.85 : 0.9, minHealth: v.sub === "refugees" ? 40 : 55 }));
        v.size = Math.max(0, v.size - k);
        offerRecruits(st, list, { source: "outsiders", baseId: base.id, title: k === 1 ? "A traveller asks to stay" : "Travellers ask to stay", intro: `${cap1(v.name)} at ${base.name}: ${k === 1 ? "one of them asks" : `${k} of them ask`} to stay.` });
        if (v.size <= 0) { leaveMap(st, v, "broken"); return "They all ask to stay."; }
        return again(st, "");
      },
    });
  }
  if (!v.done.shelter) {
    const cost = n * O.explorers.shelterDays;
    choices.push({
      label: `Shelter them for ${O.explorers.shelterDays} days (${cost} food, ${cost} water)`, hint: `${n} ${n === 1 ? "person" : "people"} eat and drink at ${base.name} (1 food and 1 water each a day). Everyone there feels better for it (mood +${O.explorers.shelterMood}); guests often leave a gift`,
      disabled: (st) => !here(st) || (base.stock.food || 0) < cost || (base.stock.water || 0) < cost,
      ai: (st) => { const d = (base.stock.food || 0) / Math.max(1, residents(st, base.id).length + n); return style(st) === "aggressive" ? -10 : d >= (style(st) === "cautious" ? 30 : 18) ? 35 : -10; },
      resolve: (st) => {
        if (!here(st)) return gone;
        v.done.shelter = true;
        v.phase = "sheltered";
        v.shelterBase = base.id;
        v.shelterUntil = st.hour + 24 * O.explorers.shelterDays;
        v.act = `sheltering at ${base.name}`;
        for (const o of residents(st, base.id)) o.mood = clamp(o.mood + O.explorers.shelterMood, 0, 100);
        visitorInfo(st).stats.sheltered++;
        return `${cap1(v.name)} stay at ${base.name} for ${O.explorers.shelterDays} days.`;
      },
    });
  }
  choices.push({
    label: "Send them on their way", hint: "No cost",
    ai: () => 5,
    resolve: (st) => { if (!here(st)) return gone; if (v.phase === "gate") nextGoal(st, v); return `${cap1(v.name)} walk on.`; },
  });
  const kind = v.sub === "scouts" ? `${n} scouts from ${v.home}, mapping the roads` : v.sub === "refugees" ? `${n} refugees from ${v.home}, tired and hungry` : `${n === 1 ? "a wanderer" : "two wanderers"} from ${v.home}`;
  addCard(state, {
    title: `Travellers at ${base.name}`, visitorId: v.id,
    text: `${lead ? `${lead} ` : ""}${cap1(kind)} at the gate${people.length ? "" : " (nobody is there to talk to them)"}. They came in from the ${v.from} ${Math.max(1, Math.round((state.hour - v.entered) / 24))} days ago.`,
    choices,
  });
}
export const scoutPrice = (v) => Math.round(12 + Math.min(60, new Set(v.trail).size * 0.5));

function shelterDay(state, v) {
  const base = baseById(state, v.shelterBase);
  if (!base) return endShelter(state, v);
  base.stock.food = Math.max(0, (base.stock.food || 0) - v.size);
  base.stock.water = Math.max(0, (base.stock.water || 0) - v.size);
}
function endShelter(state, v) {
  const base = baseById(state, v.shelterBase);
  const rng = vrng(state);
  v.phase = "travel";
  if (base && v.hostile) {
    const took = {};
    for (const k of ["food", "meds", "ammo"]) { const q = Math.floor((base.stock[k] || 0) * 0.12); if (q > 0) { base.stock[k] -= q; took[k] = q; } }
    addToStock(v, took);
    v.hostile = false;
    log(state, `The guests at ${base.name} were thieves: ${cap1(v.name)} slipped away in the night with ${planText(took) || "what they could carry"}.`, "danger");
    return headOut(state, v, "with your supplies");
  }
  if (base) {
    const bits = [];
    if (rng.chance(O.explorers.giftChance)) {
      if (v.wares.length) { const g = v.wares.shift(); base.armory.push(g); bits.push(`left a gift: ${g.name}`); }
      else { const n = giveIntel(state, v, 2); bits.push(`left a hand-drawn map (${n} tiles)`); }
    }
    log(state, `${cap1(v.name)} leave ${base.name}${bits.length ? ` and ${bits.join(" and ")}` : ""}.`, "good");
    if (rng.chance(O.explorers.joinChance) && v.size > 0) {
      const s = makeCandidate(state, { quality: 0.85, minHealth: 50 });
      v.size -= 1;
      offerRecruits(state, [s], { source: "outsiders", baseId: base.id, title: "A guest asks to stay", intro: `After ${O.explorers.shelterDays} days at ${base.name}, one of ${v.name} asks to stay for good.` });
      if (v.size <= 0) return leaveMap(state, v, "broken");
    }
  }
  nextGoal(state, v);
}

// ---------- your teams meet them ----------
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
    const tile = partyTile(p);
    if (tile == null || state.bases.some((b) => g.distance(b.tile, tile) <= 1)) continue;
    if (state.cards.some((c) => c.partyId === p.id) || !partyMembers(state, p).length) continue;
    if (p.lastConflict != null && state.hour - p.lastConflict < COOLDOWN_HOURS) continue; // one road encounter per 20 hours (conflicts.js)
    for (const v of visitorsOf(state)) {
      if (!["travel", "search", "stop"].includes(v.phase) || g.distance(v.tile, tile) > 1) continue;
      if (v.met[p.id] != null && state.hour - v.met[p.id] < O.meetCooldown) continue;
      if (v.kind === "merchants" && v.phase === "stop" && v.goal && v.goal.kind === "base") continue;
      const card = meetCard(state, v, p);
      v.met[p.id] = state.hour;
      if (card) { v.known = true; v.seen = { tile: v.tile, hour: state.hour }; p.lastConflict = state.hour; addCard(state, card); break; }
    }
  }
}

function meetCard(state, v, p) {
  const rng = vrng(state);
  const spotted = rng.chance(spotFirstChance(state, p));
  if (v.kind === "raiders" || (v.kind === "explorers" && v.hostile)) {
    const S = vStrength(v), mine = teamPower(state, p);
    const hunting = v.goal && v.goal.kind === "party" && v.goal.partyId === p.id;
    const bold = hunting || S >= mine * (v.kind === "raiders" ? O.raiders.teamShare : 1);
    // Robbers posing as travellers: they only drop the act against a team they can take.
    if (v.kind === "explorers") return bold && !spotted ? stopCard(state, v, p) : explorerRoadCard(state, v, p);
    if (!bold) return spotted ? watchCard(state, v, p) : null;
    return spotted ? watchCard(state, v, p) : stopCard(state, v, p);
  }
  if (v.kind === "merchants") return merchantRoadCard(state, v, p);
  return explorerRoadCard(state, v, p);
}

const enemyOf = (v) => ({ kind: v.kind === "merchants" ? "guards" : "raiders", count: clamp(v.kind === "merchants" ? (v.guards || 1) : v.size, 1, 14), power: v.power, name: cap1(v.name) });
function teamFight(state, v, p, ambush, extra = {}) {
  if (!state.visitors.includes(v)) { resume(state, p); return "They are gone."; }
  v.phase = "battle";
  visitorInfo(state).stats.fights++;
  startCombat(state, {
    tile: partyTile(p), partyId: p.id, enemy: enemyOf(v), ambush, canRetreat: true, handler: "outsiderFight",
    context: { visitorId: v.id, partyId: p.id, baseId: null, ...extra },
  });
  return "";
}
const fightAi = (st, odds) => { const need = { cautious: 0.8, balanced: 0.65, aggressive: 0.5 }[style(st)] ?? 0.65; return odds >= need ? 80 + odds * 10 : odds * 40; };

// They found you: fight, pay the toll, talk, or run.
function stopCard(state, v, p) {
  halt(p);
  const enemy = enemyOf(v);
  const odds = fightOdds(state, p, enemy, "enemy");
  const tollValue = Math.max(15, Math.round(Math.min(carriedValue(p) * O.raiders.toll, vStrength(v) * O.raiders.tollCap)));
  const toll = () => payPlan(p, tollValue);
  const t0 = toll();
  const speech = Math.max(0, ...partyMembers(state, p).map((s) => skill(s, "speech")));
  const scouting = Math.max(0, ...partyMembers(state, p).map((s) => skill(s, "scouting")));
  const tc = talkChance(speech);
  const rc = clamp(0.3 + 0.025 * scouting + (partyVehicle(state, p) ? 0.2 : 0) + (p.stance === "stealthy" ? 0.1 : 0) - (partyMembers(state, p).length > 4 ? 0.1 : 0), 0.1, 0.85);
  const ok = (st) => st.parties.includes(p) && st.visitors.includes(v);
  const payToll = (st, plan) => { for (const [k, q] of Object.entries(plan)) { takeSupply(p, k, q); v.stock[k] = (v.stock[k] || 0) + q; } };
  const done = (st, text) => { resume(st, p); if (st.visitors.includes(v)) { v.spared = [...(v.spared || []), `p${p.id}`]; if (v.goal && v.goal.kind === "party" && v.goal.partyId === p.id) nextGoal(st, v); } return text; };
  return {
    title: `${v.kind === "raiders" ? "Raiders from outside" : "Robbers on the road"}: ${cap1(v.name)}`, partyId: p.id, visitorId: v.id, where: tileLabel(state, partyTile(p)),
    text: v.kind === "raiders"
      ? `${v.size} raiders from ${v.home} step out across the road with ${gearText(v.power)}. They are nobody you know, and they want ${t0 ? planText(t0) : "everything you carry"} or they open fire. Your team's strength ${Math.round(teamPower(state, p))}, theirs about ${Math.round(vStrength(v))}.`
      : `The ${SUB_LABEL[v.sub] || "travellers"} from ${v.home} were not what they seemed: ${v.size} of them draw knives and pistols and demand ${t0 ? planText(t0) : "your packs"}.`,
    choices: [
      { label: `Fight (${pct(odds)} by the numbers)`, hint: "A battle: they have the drop on you", ai: (st) => fightAi(st, odds), resolve: (st) => (ok(st) ? teamFight(st, v, p, "enemy") : done(st, "They are gone.")) },
      {
        label: `Pay the toll (${t0 ? planText(t0) : "not enough"})`, hint: "They take it and let you pass", disabled: (st) => !ok(st) || !toll(),
        ai: (st) => (toll() ? (style(st) === "cautious" ? 75 : 55) : -99),
        resolve: (st) => { if (!ok(st)) return done(st, "They are gone."); const plan = toll(); if (!plan) return done(st, "You have nothing they want."); payToll(st, plan); return done(st, `You paid ${planText(plan)} and walked on.`); },
      },
      {
        label: `Talk your way out (Speech ${speech}: ${pct(tc)})`, hint: "If it works they let you go for a token; if not, they open fire", ai: () => tc * 70,
        resolve: (st) => {
          if (!ok(st)) return done(st, "They are gone.");
          const best = [...partyMembers(st, p)].sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0];
          if (best) gainXp(st, best, "speech", USE.talk);
          if (vrng(st).chance(tc)) return done(st, `${best ? firstName(best) : "Your speaker"} talked them out of it. They let you pass.`);
          return teamFight(st, v, p, "enemy");
        },
      },
      {
        label: `Run for it (${pct(rc)})`, hint: "Scouting, a vehicle and a stealthy pace help. If they catch you, it is a fight", ai: () => rc * 65,
        resolve: (st) => (!ok(st) ? done(st, "They are gone.") : vrng(st).chance(rc) ? done(st, "You got away.") : teamFight(st, v, p, "enemy")),
      },
    ],
  };
}

// You saw them first: slip away, ambush them, or let them pass.
function watchCard(state, v, p) {
  halt(p);
  const enemy = enemyOf(v);
  const odds = fightOdds(state, p, enemy, "player");
  const stealth = Math.max(0, ...partyMembers(state, p).map((s) => skill(s, "stealth")));
  const sc = clamp(0.45 + 0.03 * stealth + (p.stance === "stealthy" ? 0.15 : 0), 0.2, 0.9);
  const ok = (st) => st.parties.includes(p) && st.visitors.includes(v);
  const done = (st, text) => { resume(st, p); if (st.visitors.includes(v)) { v.spared = [...(v.spared || []), `p${p.id}`]; if (v.goal && v.goal.kind === "party" && v.goal.partyId === p.id) nextGoal(st, v); } return text; };
  return {
    title: `${v.kind === "raiders" ? "Raiders ahead" : "Strangers ahead"}: ${cap1(v.name)}`, partyId: p.id, visitorId: v.id, where: tileLabel(state, partyTile(p)),
    text: `Your team spots ${v.size} ${v.kind === "raiders" ? `raiders from ${v.home}` : "armed strangers"} ${v.act ? `(${v.act})` : ""} before they see you: ${gearText(v.power)}. Your strength ${Math.round(teamPower(state, p))}, theirs about ${Math.round(vStrength(v))}.`,
    choices: [
      { label: `Slip away (${pct(sc)})`, hint: "Stealth. If they notice you, they come for you", ai: () => sc * 70, resolve: (st) => (!ok(st) ? done(st, "They are gone.") : vrng(st).chance(sc) ? done(st, "You let them go by and slipped away.") : (st.cards.push(stopCard(st, v, p)), "They saw you.")) },
      { label: `Ambush them (${pct(odds)} by the numbers)`, hint: "A battle with the drop on them. Win and what they carry is yours", ai: (st) => fightAi(st, odds) + (style(st) === "aggressive" ? 10 : 0), resolve: (st) => (ok(st) ? teamFight(st, v, p, "player") : done(st, "They are gone.")) },
      { label: "Lie low and let them pass", hint: "You lose a little time", ai: () => 30, resolve: (st) => { p.progress = (p.progress || 0) - 1; return done(st, "They passed without seeing you."); } },
    ],
  };
}

function merchantRoadCard(state, v, p) {
  halt(p);
  const ok = (st) => st.parties.includes(p) && st.visitors.includes(v);
  const done = (st, text) => { resume(st, p); return text; };
  const odds = fightOdds(state, p, enemyOf(v), null);
  const hostile = attitude(v) === "Hostile";
  return {
    title: `Traders on the road: ${cap1(v.name)}`, partyId: p.id, visitorId: v.id, where: tileLabel(state, partyTile(p)),
    text: `A caravan from ${v.home}: wagons, ${v.guards} guards and ${O.merchants.traders} traders, ${v.act}. They carry ${goodsText(v)}.${hostile ? " They have heard what you did to other traders and keep their rifles on you." : ""}`,
    choices: [
      { label: "Trade with them", hint: hostile ? "They will not trade with you" : "The trade window, from what the team carries", disabled: hostile, ai: () => 60, resolve: (st) => { if (!ok(st)) return done(st, "They are gone."); openVisitorTrade(st, v, { partyId: p.id }); delete p.conflictResume; return ""; } },
      {
        label: "Ask for news of the road", hint: "Free: the way they came, on your team's map, and news of other states", disabled: () => !!v.done.roadNews || hostile, ai: () => 70,
        resolve: (st) => { if (!ok(st)) return done(st, "They are gone."); v.done.roadNews = true; const n = giveIntel(st, v, 1, p); return done(st, `"${rumor(st, v)}" They mark the way they came (${n} tiles).`); },
      },
      { label: `Rob them (${pct(odds)} by the numbers)`, hint: "A fight with their guards. Every trading group hears of it, and merchants will shun you", ai: () => -50, resolve: (st) => (ok(st) ? attackMerchants(st, v, { partyId: p.id }) : done(st, "They are gone.")) },
      { label: "Move on", ai: () => 20, resolve: (st) => done(st, "") },
    ],
  };
}

function explorerRoadCard(state, v, p) {
  halt(p);
  const ok = (st) => st.parties.includes(p) && st.visitors.includes(v);
  const done = (st, text) => { resume(st, p); return text; };
  const n = v.size;
  const choices = [
    {
      label: "Swap news", hint: "The way they came on your team's map (as it was when they passed), and news of other states", disabled: () => !!v.done.roadNews, ai: () => 70,
      resolve: (st) => { if (!ok(st)) return done(st, "They are gone."); v.done.roadNews = true; const k = giveIntel(st, v, v.sub === "scouts" ? 2 : 1, p); return done(st, `"${rumor(st, v)}" They show you the way they came (${k} tiles).`); },
    },
  ];
  if (SUPPLY_KEYS.some((k) => available(v, k) > 0) || v.wares.length) choices.push({ label: "Trade with them", hint: "The trade window (they carry little)", ai: () => -20, resolve: (st) => { if (!ok(st)) return done(st, "They are gone."); openVisitorTrade(st, v, { partyId: p.id }); delete p.conflictResume; return ""; } });
  if (v.joiners > 0) {
    choices.push({
      label: `Hear who wants to join (${v.joiners})`, hint: "A recruit card: take them along, send them to a base, or part ways", ai: () => 45,
      resolve: (st) => {
        if (!ok(st)) return done(st, "They are gone.");
        const k = v.joiners;
        v.joiners = 0;
        const list = Array.from({ length: k }, () => makeCandidate(st, { quality: 0.85, minHealth: 45 }));
        v.size = Math.max(0, v.size - k);
        if (v.size <= 0) leaveMap(st, v, "broken");
        resume(st, p);
        offerRecruits(st, list, { source: "outsiders", partyId: p.id, title: k === 1 ? "A traveller asks to join" : "Travellers ask to join", intro: `Met on the road: ${k === 1 ? "one of them asks" : `${k} of them ask`} to come with you.` });
        return "";
      },
    });
  }
  const give = { food: 2 * n, water: 2 * n };
  choices.push({
    label: `Share supplies (${give.food} food, ${give.water} water)`, hint: "The team feels better for it (mood +2), and they share their map", disabled: (st) => carried(p, "food") < give.food || carried(p, "water") < give.water,
    ai: (st) => (carried(p, "food") >= give.food * 3 ? 25 : -20),
    resolve: (st) => {
      if (!ok(st)) return done(st, "They are gone.");
      takeSupply(p, "food", give.food); takeSupply(p, "water", give.water);
      for (const s of partyMembers(st, p)) s.mood = clamp(s.mood + 2, 0, 100);
      const k = v.done.roadNews ? 0 : giveIntel(st, v, 1, p);
      v.done.roadNews = true;
      return done(st, `They thank you${k ? ` and mark the way they came on your map (${k} tiles)` : ""}.`);
    },
  });
  choices.push({ label: "Move on", ai: () => 10, resolve: (st) => done(st, "") });
  return {
    title: `Travellers from outside: ${cap1(v.name)}`, partyId: p.id, visitorId: v.id, where: tileLabel(state, partyTile(p)),
    text: `${cap1(v.sub === "wanderers" ? v.name : `${n} ${SUB_LABEL[v.sub]}`)} from ${v.home}, ${v.act}. ${v.sub === "scouts" ? "They are mapping the roads for their people back home." : v.sub === "refugees" ? "They are looking for somewhere safe." : "They wander, and they have seen a lot."}`,
    choices,
  };
}

// ---------- fights (combat.js handlers) ----------
function cargoAdd(state, p, sup) {
  const got = {};
  for (const [k, q0] of Object.entries(sup)) {
    if (!SUPPLIES[k] || q0 < 1) continue;
    const room = cargoRoom(state, p);
    const q = Math.min(Math.floor(q0), unitsThatFit(room, k));
    if (q <= 0) continue;
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + q;
    got[k] = q;
  }
  return got;
}

function onOutsiderFight(state, result, setup) {
  const c = setup.context;
  const v = visitorById(state, c.visitorId);
  const p = c.partyId != null ? state.parties.find((x) => x.id === c.partyId) : null;
  const base = c.baseId != null ? baseById(state, c.baseId) : null;
  const name = v ? cap1(v.name) : setup.enemy.name;
  const lines = [];
  if (v) { v.size -= result.enemiesKilled || 0; if (v.kind === "merchants") v.guards = Math.max(0, (v.guards || 0) - (result.enemiesKilled || 0)); }
  if (p && state.parties.includes(p) && !partyMembers(state, p).length) {
    Parties.wipeParty(state, p);
    log(state, `The whole team was lost fighting ${name}.`, "death");
    if (v) { v.phase = "travel"; nextGoal(state, v); }
    return;
  }
  if (result.outcome === "victory") {
    let got = {};
    let items = [];
    if (v) {
      if (p && state.parties.includes(p)) {
        got = cargoAdd(state, p, v.stock);
        for (const g of [...v.wares]) { if (typeof Parties.addGearToCargo === "function") { Parties.addGearToCargo(state, p, g); if (p.cargo.gear.includes(g)) items.push(g.name); } }
      } else if (base) {
        for (const k of SUPPLY_KEYS) { const q = Math.floor(v.stock[k] || 0); if (q > 0) { base.stock[k] = (base.stock[k] || 0) + q; got[k] = q; } }
        items = v.wares.map((g) => g.name);
        base.armory.push(...v.wares);
      }
      leaveMap(state, v, "broken");
    }
    lines.push(`You beat ${name}.`);
    const what = [planText(got), ...items].filter(Boolean).join(", ");
    if (what) lines.push(`Taken from them: ${what}.`);
    log(state, `${name} ${c.robbing ? "were robbed" : "were beaten"}${p ? ` near ${tileLabel(state, partyTile(p))}` : base ? ` at ${base.name}` : ""}.`, c.robbing ? "danger" : "good");
  } else {
    if (p && state.parties.includes(p)) {
      const frac = result.outcome === "retreat" ? 0.25 : c.robbing ? 0.1 : 0.4;
      const taken = {};
      for (const pool of result.outcome === "retreat" ? [p.cargo.supplies] : [p.supplies, p.cargo.supplies]) {
        for (const k of Object.keys(pool)) { const q = Math.floor((pool[k] || 0) * frac); if (q > 0) { pool[k] -= q; taken[k] = (taken[k] || 0) + q; } }
      }
      if (v && !c.robbing) addToStock(v, taken);
      lines.push(result.outcome === "retreat" ? `You pulled back${planText(taken) ? `, dropping ${planText(taken)}` : ""}.` : `You lost the fight${planText(taken) ? ` and they took ${planText(taken)}` : ""}.`);
    } else lines.push(c.robbing ? "Their guards held you off and the wagons got away." : "You lost the fight.");
    log(state, `Fight with ${name}: ${result.outcome}.`, "danger");
    if (v && state.visitors.includes(v)) {
      if (v.size <= 0) leaveMap(state, v, "broken");
      else {
        v.phase = "travel";
        if (p) v.spared = [...(v.spared || []), `p${p.id}`];
        if (c.robbing) headOut(state, v, "after the attack"); else nextGoal(state, v);
      }
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
registerCombatHandler("outsiderFight", onOutsiderFight);

function onOutsiderRaid(state, result, setup) {
  const c = setup.context;
  const v = visitorById(state, c.visitorId);
  const base = baseById(state, c.baseId);
  let text;
  if (v) v.size -= result.enemiesKilled || 0;
  if (result.outcome === "victory") {
    if (base) base.alert = false;
    state.stats.raidsRepelled += 1;
    const got = [];
    if (v && base) for (const k of SUPPLY_KEYS) { const q = Math.floor(v.stock[k] || 0); if (q > 0) { base.stock[k] = (base.stock[k] || 0) + q; got.push(`${q} ${k}`); } }
    if (v) leaveMap(state, v, "broken");
    text = `${base ? base.name : "The base"} broke ${v ? v.name : "the raiders"} in a stand-up fight.${got.length ? ` What they carried is yours: ${got.join(", ")}.` : ""}`;
    log(state, text, "good");
    // A stand-up fight at the walls still costs a little (breakdowns.js): a turn counts as 20 minutes of siege.
    if (base && state.bases.includes(base)) text += ` ${raidDamage(state, base, { strength: c.strength || 0, hours: (c.siegeHours || 0) + Math.max(1, Math.min(8, (result.turns || 6) / 3)), outcome: "won", by: v ? v.name : "the raiders" }).text}`;
  } else {
    const left = (result.enemiesLeft || 0) / Math.max(1, setup.enemy.count);
    // Pulled out of the fight (the evac strip): raiders from outside do not keep bases; they loot it as an overrun
    // and move on, and the people who got out come back.
    const how = result.outcome === "retreat" ? "retreat" : left > 0.5 ? "overrun" : "broken";
    if (v) v.lastDamage = "";
    if (v && base && state.bases.includes(base) && v.size > 0) resolveRaidOnYou(state, v, how);
    else if (v && v.size <= 0) leaveMap(state, v, "broken");
    text = !v ? "The defenders were beaten, but the raiders had already gone." : how === "retreat" ? `Your people pulled out. ${cap1(v.name)} took what they wanted and moved on; ${base ? base.name : "the base"} is still yours.` : how === "overrun" ? `The defenders were beaten. ${cap1(v.name)} took what they wanted.` : `The defenders were beaten, but ${v.name} were too badly mauled to hold the base. They grabbed what they could carry.`;
    if (v && v.lastDamage) text += ` ${v.lastDamage}`;
  }
  addCard(state, { title: "Raid defense", text, choices: [{ label: "OK", resolve: () => "" }] });
}
registerCombatHandler("outsiderRaid", onOutsiderRaid);

// ---------- being seen ----------
function sight(state, v) {
  const live = state.live.has(v.tile);
  const heard = !live && inCoverage(state, v.tile);
  v.live = live;
  v.heard = heard;
  if (!live && !heard) return;
  v.seen = { tile: v.tile, hour: state.hour };
  if (!v.known) { v.known = true; announce(state, v, live); }
  if (v.kind === "merchants" && !v.called && (heard || (live && hasNetwork(state)))) merchantCall(state, v);
}

function announce(state, v, live) {
  const near = placeOf(state, v.tile);
  const tower = live ? state.bases.find((b) => b.watchtower && state.grid.distance(b.tile, v.tile) <= baseVision(b)) : null;
  const by = live ? (tower ? `The watchtower at ${tower.name} spots` : "Lookouts spot") : "Radio chatter:";
  if (v.kind === "raiders") {
    log(state, live ? `${by} raiders from outside the state: about ${v.size} of ${v.name}, with ${gearText(v.power)}, ${near}.` : `${by} raiders from beyond the border (${v.name}, about ${v.size}) are on the move ${near}.`, "danger");
  } else if (v.kind === "merchants") {
    if (live) log(state, `${by} a merchant caravan from ${v.home} (${v.name}) on the road ${near}.`, "info");
  } else {
    log(state, live ? `${by} ${v.sub === "wanderers" ? v.name : `${v.size} ${SUB_LABEL[v.sub]}`} from ${v.home} ${near}.` : `${by} ${v.sub === "wanderers" ? v.name : SUB_LABEL[v.sub]} from ${v.home} are travelling ${near}.`, "info");
  }
}

// ---------- the Groups tab, tooltips, alerts ----------
export function attitudeOf(v) {
  if (v.kind === "raiders") return v.paid ? "Paid off" : "Hostile";
  if (v.kind === "explorers") return "Wary";
  return attitude(v);
}
export function visitorView(state, v) {
  const live = state.live.has(v.tile);
  const heard = !live && inCoverage(state, v.tile);
  const at = live || heard ? v.tile : v.seen ? v.seen.tile : null;
  return {
    v, live, heard, tile: at, age: v.seen ? state.hour - v.seen.hour : null,
    label: KIND_LABEL[v.kind], sub: v.sub, name: cap1(v.name), size: v.size, strength: Math.round(vStrength(v)), home: v.home, from: v.from,
    act: live || heard ? v.act : "last seen " + (v.act || "on the road"), attitude: attitudeOf(v), where: at != null ? placeOf(state, at) : "unknown",
    gear: v.kind === "raiders" ? gearText(v.power) : null,
    canPay: v.kind === "raiders" && !v.paid && (live || heard) && hasNetwork(state) && inCoverage(state, v.tile),
    payPlan: v.kind === "raiders" && hub(state) ? stockPlan(hub(state).stock, radioPayValue(state, v)) : null,
    canInvite: v.kind === "merchants" && (live || heard) && hasNetwork(state) && inCoverage(state, v.tile) && attitude(v) !== "Hostile" && !(v.goal && v.goal.kind === "base"),
    tradeHere: v.kind !== "raiders" && v.phase === "stop" && v.goal && v.goal.kind === "base" ? baseById(state, v.goal.baseId) : null,
    gate: v.kind === "explorers" && v.phase === "gate" && !state.cards.some((c) => c.visitorId === v.id) ? baseById(state, v.gateBase) : null,
    canNews: v.kind === "explorers" && !v.hostile && !v.done.radioNews && (live || heard) && hasNetwork(state) && inCoverage(state, v.tile),
  };
}
export const knownVisitors = (state) => visitorsOf(state).filter((v) => v.known);
export function radioPayValue(state, v) {
  const h = hub(state);
  const sp = h ? tradeSpeech(atBase(state, h.id)) : 0;
  return Math.round(tributeValue(v) * O.raiders.radioPay * (1 - Math.min(0.3, 0.02 * sp)));
}

// Groups tab: pay a band you can reach by radio to leave the state ("Diplomacy").
export function radioPayRaiders(state, v) {
  if (!state.visitors.includes(v) || v.kind !== "raiders") return "They are gone.";
  if (v.paid) return `${cap1(v.name)} are already leaving.`;
  if (!hasNetwork(state) || !inCoverage(state, v.tile)) return "They are out of radio reach.";
  const h = hub(state);
  const plan = stockPlan(h.stock, radioPayValue(state, v));
  if (!plan) return `${h.name} does not have ${radioPayValue(state, v)} worth of goods to offer.`;
  payFromStock(h.stock, plan, v.stock);
  paidOff(state, v, null);
  log(state, `Over the radio, ${v.name} agreed to leave the state for ${planText(plan)}. A runner took it out to them.`, "info");
  return `${cap1(v.name)} took ${planText(plan)} and are leaving the state.`;
}
export function radioNewsFrom(state, v) {
  if (!state.visitors.includes(v)) return "They are gone.";
  if (!hasNetwork(state) || !inCoverage(state, v.tile)) return "They are out of radio reach.";
  if (v.done.radioNews) return "They told you what they know.";
  v.done.radioNews = true;
  const n = v.hostile ? 0 : giveIntel(state, v, 1);
  const text = `${cap1(v.name)} on the radio: "${rumor(state, v)}"${n ? ` They read out the roads they took (${n} tiles on your map).` : ""}`;
  log(state, text, "info");
  return text;
}
export function reopenGate(state, v) {
  const base = baseById(state, v.gateBase);
  if (!base || v.phase !== "gate" || state.cards.some((c) => c.visitorId === v.id)) return "";
  v.stayUntil = Math.max(v.stayUntil, state.hour + 6);
  gateCard(state, v, base, "");
  return "";
}

export function visitorAlertsData(state) {
  const out = [];
  const g = state.grid;
  for (const v of visitorsOf(state)) {
    const live = state.live.has(v.tile), heard = !live && inCoverage(state, v.tile);
    if (!live && !heard) continue;
    if (v.kind === "raiders" && !v.paid) {
      let best = null, dist = Infinity;
      for (const b of state.bases) { const d = g.distance(v.tile, b.tile); if (d < dist) { dist = d; best = b; } }
      if (!best || dist > 8) continue;
      const heading = v.goal && v.goal.kind === "base" ? baseById(state, v.goal.baseId) : null;
      out.push({ v, kind: "raiders", base: heading || best, dist, heading: !!heading, siege: v.phase === "siege" });
    } else if (v.kind === "merchants" && v.phase === "stop" && v.goal && v.goal.kind === "base") {
      out.push({ v, kind: "merchants", base: baseById(state, v.goal.baseId), dist: 0 });
    }
  }
  return out;
}

// Map tooltip lines for a tile (render.js): outsiders you can see or hear there.
export function visitorTipLines(state, tile, liveSet = state.live) {
  const out = [];
  for (const v of visitorsOf(state)) {
    if (v.tile !== tile || !(liveSet.has(tile) || inCoverage(state, tile))) continue;
    out.push({ color: VISITOR_COLORS[v.kind], text: `${cap1(v.name)} (${KIND_LABEL[v.kind].toLowerCase()}, ${v.size}): ${v.act}` });
  }
  return out;
}

// ---------- timelapse (chronicle.js) ----------
export const visitorCode = (v) => VISITOR_KINDS.indexOf(v.kind);
