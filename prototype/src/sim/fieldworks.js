// Field works (2026-10-10, user request): structures a base builds on the land it holds outside its walls, planned
// from the base window (Field works tab) and put up by its builders, who walk out to the site.
//
// Kinds (FIELD.KINDS; cost from the base's stores when the job is queued, work-hours plus the walk):
//   roadblock  Cars, logs and wire across a road tile. A hostile party (a raid, a war party, raiders from outside) or a
//              horde entering the tile is held while it batters a way through: hold hours = min(max hold, hp / its
//              rate), and the roadblock takes that damage. Guarded (1–2 guards on shifts, fieldworks-plus) the hold is
//              ROADBLOCK.guardHold × as long for the same damage and the guards shoot back (winOdds against the party:
//              won, it loses shotWin of its strength; lost, shotLose and the guards run for home, maybe hurt or killed);
//              at a horde they shoot some down first. Your own teams and friends' pass.
//   well       A dug well on open ground (not mountains): the yield of a claim well (claims.js WELL_YIELD: by a river or
//              lake 10 a day, farmland 6, forest 4, hills, suburbs, city 2), drawn down like one. Its water is fetched
//              by the base's water carriers (job trips: Fetch water, up to its yield a day, drawWell; with the trips'
//              hooks not installed, FIELD.PASSIVE_WELLS: hauled by the base's people, one well per 4) and is
//              un-purified, but deep ground water: half the eggs of the tile's ground (worm.js rawWaterEggs). Boil it.
//   tower      A watch tower. Only when manned (lookouts on shifts, the watch roster's way: fw.roster, rosterHour) it
//              sees FIELD.TOWER.day tiles around by day (night: FIELD.TOWER.night), live on the State Map, and its
//              lookouts warn the base of raids and hordes they see (watch.js lookoutsSpot). People out on a shift are out
//              of the base (location "post": no base work, not in a base battle; world.js residents keeps them fed,
//              healed and counted); off duty they are home (sleep.js: a night shift keeps them up, they sleep in after).
//   relay      An unmanned radio relay mast (radio.js radioNodes): RELAY_RANGE (6) tiles of coverage when it links to a
//              station or a linked relay, 1 part every RELAY_UPKEEP_DAYS days from its base (else the hub).
//   stockpile  A fenced drop point. Outdoor workers and teams leave goods here (dropPointsFor / depositAt; a team's
//              Unload order) up to FIELD.KINDS.stockpile.capKg; a team (Load order, the base's Send a haul team, or the
//              standing haul order fw.haul: every N days / at X kg, with a vehicle) brings it home. Raiders passing
//              over it, and a group's raid on it, take what is there.
//   blind      A hunting blind: the base's hunters on its tile find BLIND.mult × the game (tripland.js TRIP_HOOKS.game),
//              and it opens its tile to them past a cabinless base's grounds.
//   snares     A snare line (forest, hills, farmland): small game day by day (hunting.js snare rules × SNARES.lines),
//              checked by a hunter of the base each morning; rots, can be robbed (its wires torn).
//   cache      A buried fuel cache (CACHE: fuel, food, ammo, meds; capKg): restocked by the builders, drawn by teams;
//              the dead and passing raiders leave it alone, a raid sent for it finds it RAID.find of the time.
//   spikes     Spike traps: the dead and hostile parties crossing lose some of their number / strength; worn by it,
//              sprung under SPIKES.dead (a repair resets them).
// Threats: a horde entering a structure's tile batters it (FIELD.HORDE); a manned tower's lookouts shoot back from
// above; a hostile group within FIELD.RAID.range tiles may send a raid at it (an AI party, kind "fwraid": it fights the
// people on duty by the numbers, then takes the structure over (near their land), or empties it and smashes RAID.dmg
// of it: a sound one stands, a damaged one falls). The groups raid each other's the same way. Destroyed: gone.
// Repairs: per structure, by the base's builders (walk included), materials by kind and damage (repairCost).
// The groups build their own (groupFieldDaily/groupWants: towers when threatened, wells, stockpiles, roadblocks, spike
// traps, snare lines, blinds, caches), guard them, draw on and haul their stockpiles; you can wreck, capture or loot
// theirs with a team (orders "fwork"). The governor's share: govFieldWorks.
//
// state.fieldworks = { list: [fw], jobs: [job], news: [{ hour, fw, kind, text, tone, tile }], stats: { counts } }:
//   fw  = { id, kind, tile, owner: "player" | faction id, baseId (yours) | baseTile (a group's), hp, max, built,
//           garrison: [survivor ids out there now] (yours) | gar: n (a group's), roster?: { preset, shifts } (yours),
//           contents: { key: qty } (stockpile, cache), haul? (stockpile), held? / caught / robbed (snares),
//           found? (a group's cache), triggered? (spikes), well?: { yield, left, start, dug } (well), since, hitHour?,
//           relayDue?, offline? }
//   job = { id, type: "build" | "repair" | "demolish" | "stock", fw, baseId, progress, hours, paid: { key: qty } }
//   base.raidRoads = { tile: { n, last } }: the road tiles raids on that base came down (the governor's roadblocks).
// Older saves have no state.fieldworks: ensureFW makes an empty one.
import { log, atBase, baseById, hub, newId, skill, combatPower, hourOfDay, isNight, day, alive, survivorById, factionById, killSurvivor, hurt, localId } from "./world.js";
import { BUILDINGS, buildRate, isCamp, isShelter, gatherStalled, underAttack, matName } from "./buildings.js";
import { ownsTile, wellYield, wellRate, WELL_LEFT, CLAIM, claimOwner, hauledWells } from "./claims.js";
import { attitude, changeGoodwill, isAggressiveType } from "./factions.js";
import { tileLabel, spawnAiParty, partyTile, cargoRoom, carried, takeSupply, partyMembers, launchExpedition, removeParty } from "./parties.js";
import { queueOrder } from "./orders.js";
import { winOdds } from "./combat.js";
import { healthRest } from "./work.js";
import { SUPPLIES, SKILL_NAMES } from "./data.js";
import { hordeWallPower } from "./hordes.js";
import { RELAY_RANGE, RELAY_UPKEEP_DAYS } from "./radio.js";
import { TRIP_HOOKS } from "./tripland.js"; // the job trips' plug-in points: installed at load (installTripHooks, end of file)
import { GAME_TERRAIN, ANIMALS, SNARE, snareDayRate, takeGame, meatAt, addMeat } from "./hunting.js"; // blinds and snare lines
import { wormKill, wormMeatAt } from "./worm.js"; // a snare's catch may be infested, as the hunters'
import { inShift, shiftText, shiftHours } from "./watch.js"; // the shifts at a tower or a roadblock: the watch roster's hours
import { warBetween, raidWeight } from "./diplomacy.js"; // the groups' raids on each other's structures
import { FACTION_TYPES } from "./data.js";
import * as Weather from "./weather.js";
import { noteOutput } from "./output.js";
import { tripTarget } from "./jobtrips.js"; // where the base's scavengers and foragers go (the governor's stockpiles)

// ---------- the numbers ----------
export const FIELD = {
  KINDS: {
    roadblock: { name: "Roadblock", icon: "🚧", cost: { scrap: 10, wood: 150 }, hours: 10, hp: 60, road: true, garrison: 2,
      desc: "Wrecked cars, logs and wire across the road. A hostile party or a horde entering the tile is held while it forces a lane through (up to 10 hours for a party, 12 for a horde; the stronger they are, the sooner), and the roadblock takes the damage (a fresh one is left at about 40%). Guarded (1–2 people on shifts) it holds half as long again and the guards shoot back: they win or lose by the numbers, and a beaten guard runs for home, maybe hurt. Your teams and friends pass. Road tiles only." },
    well: { name: "Field well", icon: "🪣", cost: { scrap: 12, parts: 1 }, hours: 20, hp: 50,
      desc: "A dug well on the base's land: water a day by the ground (beside a river or lake 10, farmland 6, forest 4, hills, suburbs and city 2; not in the mountains), brought in by the base's water carriers (the Fetch water job: up to its yield a day). Deep ground water: half the worm's eggs of the ground, but still un-purified: boil it." },
    tower: { name: "Watch tower", icon: "🗼", cost: { scrap: 15, wood: 120 }, hours: 18, hp: 70, garrison: 2,
      desc: "A lookout tower. Manned (lookouts on shifts, like the base's watch roster: they walk out for their shift and come home off duty to eat and sleep) it shows the map 3 tiles around it by day (1 at night) and its lookouts warn the base of raids and hordes they see. Two shifts of 12 hours with one person each keep it watched round the clock; an empty shift is a gap. Unmanned it sees nothing." },
    relay: { name: "Relay mast", icon: "📡", cost: { scrap: 15, parts: 3 }, hours: 24, hp: 40, req: { mechanics: 3 },
      desc: "An unmanned radio relay on a mast: 6 tiles of radio coverage around it when a radio station or a linked relay reaches it (teams in coverage report live and can be called). Uses 1 part every 10 days from its base (else the hub). Needs a Mechanics 3+ survivor at the base to build." },
    stockpile: { name: "Stockpile", icon: "📦", cost: { scrap: 8, wood: 90 }, hours: 8, hp: 50, capKg: 200,
      desc: "A fenced drop point: outdoor workers and teams leave goods here instead of walking home (up to 200 kg), and a haul team brings it in (Send a haul team: a vehicle carries the most; or a standing order: every few days, or once it holds enough). Raiders passing over it take what is there." },
    blind: { name: "Hunting blind", icon: "🦌", cost: { wood: 60, scrap: 2 }, hours: 6, hp: 30, game: 0.3,
      desc: "A screened hide on game land. The base's hunters who hunt its tile get a third more game there (they pick it out when it is the best ground), and it opens its tile to them even past a base's hunting grounds without a cabin (up to 2 tiles). Only where there is game (forest, hills, farmland, mountains)." },
    snares: { name: "Snare line", icon: "🪤", cost: { scrap: 4, wood: 15 }, hours: 3, hp: 20, terrain: ["forest", "hills", "plains"],
      desc: "Two lines of snares left set on forest, hills or farmland: small game caught day by day, about 1–2 a day on good ground (less as the game thins). The base's hunters check it each morning and bring the catch in; with no hunter at the base it waits, and rots in 2–6 days by the heat. Someone may rob it (more often near towns, the dead or hostile people), tearing the wires: repair it." },
    cache: { name: "Fuel cache", icon: "🛢️", cost: { scrap: 6, wood: 40 }, hours: 5, hp: 40, capKg: 60, hidden: true,
      desc: "A buried, hidden store of fuel, ammo, food and meds (up to 60 kg) for teams on the road: they take what they need there (or leave some). The builders stock it from the base's stores (Restock). Hard to find: raiders passing over it and the dead leave it alone, and a raid sent for it often finds nothing." },
    spikes: { name: "Spike traps", icon: "🔺", cost: { scrap: 12, wood: 50 }, hours: 6, hp: 40,
      desc: "Sharpened stakes, pits and wire on the approach. The dead crossing the tile lose a few of their number, a hostile party loses some of its strength (a raid on you, raiders, a group's raid party), and each time the traps are worn down. Under 30% they are sprung and do nothing until repaired (reset). Your teams and friends know where they are." },
  },
  ORDER: ["tower", "roadblock", "well", "stockpile", "blind", "snares", "cache", "spikes", "relay"],
  RANGE: 3,                                   // the most tiles from the base (and the land must be yours)
  MAX: { hub: 8, outpost: 5, shelter: 2, camp: 0 },
  WALK: { pace: 0.5, shift: 8 },              // hours a tile each way; a trip out per `shift` work-hours
  TOWER: { day: 3, night: 1, warnBase: 4, perch: 1.5, aiDay: [6, 22] },
  // guardHold: × the hold with guards on duty; guards: their shots (as the tower's at a horde, kills ≤ hordeShot of it);
  // shotWin / shotLose: the share of a party's strength lost when the guards win / lose the exchange (winOdds).
  ROADBLOCK: { gap: 0.6, partyHold: 10, hordeHold: 12, partyRate: 4, partyPer: 0.4, hordeRate: 3, hordePer: 0.05, teamHostile: 3, teamCheck: 1, teamDamage: 10, guardHold: 1.5, cover: 1.2, shotWin: 0.35, shotLose: 0.12, hordeShot: 0.25 },
  HORDE: { base: 10, per: 5, siteLoss: 0.5, shot: 2, hurt: 0.5, killed: 0.1 },
  // A hostile group's raid on a structure of yours (raidsDaily): chance a day (+ perKg of a stockpile's goods, at most
  // max; half for an aggressive group that is not Hostile); a cache is cacheW as likely and found `find` of the time.
  // A group sends one such raid every `every` days at most. Won: taken over near their land (`near` tiles, `capture` of
  // the time), else emptied and `dmg` of its condition smashed (a sound one stands). Tuned 2026-10-10 by 180-day runs
  // on seeds 7/11/42 (was chance 0.02, capture 0.5, a won raid wrecked it outright, no cooldown).
  // ai: the groups' raids on each other's structures (war enemies full, aggressive neighbours half).
  RAID: { range: 10, chance: 0.05, perKg: 1 / 2500, max: 0.1, minPop: 6, str: [4, 12], capture: 0.25, near: 4, every: 5, dmg: 0.6, cacheW: 0.3, find: 0.35, ai: 1 },
  REPAIR: { share: 0.6, hoursShare: 0.5, minHours: 2 },
  DEMOLISH: { hours: 4, refund: 0.5 },
  TEAM: { destroy: 3, capture: 4, load: 1, unload: 1, check: 1, gw: -8, garPower: 2.5 },
  // pileDaily: kg a person a day their outdoor people drop at a group's stockpile; haulEvery: days between their haul
  // home; short: days of food under which they draw on it; cache: share of fuel/ammo/food sent out to a cache.
  AI: { every: 5, max: [1, 12, 4], stock: 0.15, gar: 2, garPop: 10, work: 3, pileDaily: 0.4, haulEvery: 6, short: 3, cache: 0.1 },
  GOV: { towerPop: 6, garrisonPop: 10, repairAt: 0.7, roadRaids: 2, pileHands: 2, pileEvery: 5 },
  // Shifts at a tower or a roadblock (the base's watch roster's way, watch.js): who walks out for which hours. Each shift
  // holds up to the structure's garrison; a person stands one shift at one structure. They leave the base `walk` hours
  // (the tiles × WALK.pace, whole hours) before it starts and are home that long after it ends.
  SHIFTS: {
    two:   { name: "Two 12-hour shifts", shifts: [["Day", 6, 18], ["Night", 18, 6]] },
    three: { name: "Three 8-hour shifts", shifts: [["Morning", 6, 14], ["Evening", 14, 22], ["Night", 22, 6]] },
    day:   { name: "Daylight only (06–22)", shifts: [["Day", 6, 22]] },
    night: { name: "Nights only (18–06)", shifts: [["Night", 18, 6]] },
  },
  BLIND: { mult: 1.35, groupFood: 1.5 },
  // Snare lines: lines × the hunting snares' line (hunting.js SNARE.count snares, snareDayRate); the catch keeps keep[]
  // days (hot / mild / cold), robbed theft a day (+near with the dead, hostile people or a town within 2), tearing
  // `tear` of its condition; under `dead` condition it catches nothing.
  SNARES: { lines: 2, keep: [2, 3, 6], theft: 0.04, near: 0.06, tear: 6, dead: 0.3 },
  CACHE: { mix: { fuel: 0.4, food: 0.3, ammo: 0.2, meds: 0.1 }, keys: ["fuel", "food", "water", "ammo", "meds"], spot: 0.4, spotPer: 0.05 },
  // Spike traps: the dead crossing lose horde + hordePer × size (at most hordeMax of them) × condition; a hostile party
  // `party` of its strength (× condition) and is held `hold` hours; each trigger wears wear (+ wearPer a kill) hp.
  SPIKES: { horde: 4, hordePer: 0.08, hordeMax: 0.15, party: 0.15, hold: 1, wear: 8, wearPer: 0.3, dead: 0.3, teamHurt: 0.3 },
  // The standing haul order's choices (per stockpile: every N days, or once it holds X kg), checked at `hour`.
  HAUL: { every: [0, 3, 5, 7, 10, 14], atKg: [0, 50, 100, 150], hour: 9 },
  NEWS_HOURS: 48,
  // The wells' water comes home by itself (the base's people haul it, as the claim wells'). Set false once the job
  // trips' Fetch water job walks to the wells (installTripHooks) so the water is not counted twice.
  PASSIVE_WELLS: true,
  DROP_MIN_KG: 10, // a stockpile takes a worker's load while it has this much room
};
const K = FIELD.KINDS;
// Materials to repair a structure from nothing (scaled by the damage): about 60% of its cost.
export const repairBase = (kind) => Object.fromEntries(Object.entries(K[kind].cost).map(([k, v]) => [k, Math.max(1, Math.round(v * FIELD.REPAIR.share))]));

// ---------- the state ----------
export function ensureFW(state) {
  if (!state.fieldworks) state.fieldworks = { list: [], jobs: [], news: [] };
  const F = state.fieldworks;
  if (!F.list) F.list = [];
  if (!F.jobs) F.jobs = [];
  if (!F.news) F.news = [];
  if (!F.stats) F.stats = {};
  return F;
}
// Counts for the tuning runs and the ledger: raids sent at yours (raids), driven off (driven), taken (captured),
// wrecked or emptied (wrecked), the groups' raids on each other's (aiRaids, aiCaptured, aiWrecked), haul orders run.
export function fwStat(state, k, n = 1) {
  const S = ensureFW(state).stats;
  S[k] = (S[k] || 0) + n;
}
export const fwList = (state) => (state.fieldworks ? state.fieldworks.list : []);
export const fwById = (state, id) => fwList(state).find((x) => x.id === id) || null;
export const fwAt = (state, tile) => fwList(state).find((x) => x.tile === tile) || null;
export const kindName = (fw) => (fw && K[fw.kind] ? K[fw.kind].name : "Field work");
export const isMine = (fw) => !!fw && fw.owner === "player";
export const playerWorks = (state, base = null) => fwList(state).filter((x) => x.owner === "player" && (!base || x.baseId === base.id));
export const groupWorks = (state, f) => fwList(state).filter((x) => x.owner === f.id);
const jobsOf = (state, base) => (state.fieldworks ? state.fieldworks.jobs.filter((j) => j.baseId === base.id) : []);
export const jobFor = (state, fw) => (state.fieldworks ? state.fieldworks.jobs.find((j) => j.fw === fw.id) || null : null);
export const fieldJobs = jobsOf;
export const condition = (fw) => (fw.max > 0 ? Math.max(0, Math.min(1, fw.hp / fw.max)) : 1);
// Damage band for the icon: null (sound), "worn" (under 70%), "bad" (under 35%).
export const damageBand = (fw) => (!fw.built ? null : condition(fw) < 0.35 ? "bad" : condition(fw) < FIELD.GOV.repairAt ? "worn" : null);
const owned = (fw, who) => fw.owner === who;
const ownerName = (state, owner) => (owner === "player" ? "you" : (() => { const f = factionById(state, owner); return f && f.known ? f.name : "a group"; })());
function news(state, fw, text, tone = "danger") {
  const F = ensureFW(state);
  F.news.unshift({ hour: state.hour, fw: fw.id, kind: fw.kind, tile: fw.tile, text, tone });
  if (F.news.length > 40) F.news.length = 40;
  log(state, text, tone);
}
export const recentNews = (state) => (state.fieldworks ? state.fieldworks.news.filter((n) => state.hour - n.hour <= FIELD.NEWS_HOURS) : []);
const label = (state, fw) => `the ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}`;
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- where they can go ----------
export const maxWorks = (base) => FIELD.MAX[isCamp(base) ? "camp" : isShelter(base) ? "shelter" : base.type === "hub" ? "hub" : "outpost"];
// Why this kind cannot go on this tile for this base ("" = it can). costs: also check the stores and the skill.
export function placeProblem(state, base, kind, tile, costs = true) {
  const def = K[kind];
  if (!def) return "No such field work.";
  if (!base) return "No base.";
  const t = state.tiles[tile];
  if (!t) return "No such tile.";
  if (tile === base.tile) return "Field works go outside the base: pick a tile around it.";
  if (state.bases.some((b) => b.tile === tile)) return "Another of your bases stands there.";
  if (t.terrain === "water") return "Not on open water.";
  if (t.hive) return "A hive stands there.";
  if (state.factions.some((f) => f.alive && f.bases.includes(tile))) return "A group's base stands there.";
  if (state.grid.distance(base.tile, tile) > FIELD.RANGE) return `Too far from ${base.name} (at most ${FIELD.RANGE} tiles).`;
  if (!ownsTile(state, tile)) return "Only on land you hold: the ground around a base or a claim of yours.";
  const there = fwAt(state, tile);
  if (there) return `${there.owner === "player" ? "Your" : "A"} ${kindName(there).toLowerCase()} stands there already.`;
  if (def.road && !t.road) return "Roadblocks go on a road tile.";
  if (def.terrain && !def.terrain.includes(t.terrain)) return `${def.name}s go on forest, hills or farmland.`;
  if (def.game && GAME_TERRAIN[t.terrain] != null && GAME_TERRAIN[t.terrain] < def.game) return "Too little game there (a blind goes on forest, hills, farmland or mountains).";
  if (kind === "well") {
    if (!wellYield(state, tile)) return "Solid rock: no water to dig for.";
    if (state.claims && state.claims[tile] && state.claims[tile].well) return "A well is dug on that claim already.";
  }
  if (playerWorks(state, base).length >= maxWorks(base)) return maxWorks(base) ? `${base.name} has all the field works it can keep (${maxWorks(base)}).` : "A camp builds no field works: build it up first.";
  if (costs) {
    for (const [k, v] of Object.entries(def.cost)) if ((base.stock[k] || 0) < v) return `Needs ${v} ${matName(k, v)} at ${base.name} (have ${Math.floor(base.stock[k] || 0)}).`;
    if (def.req) for (const [sk, lvl] of Object.entries(def.req)) if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return `Needs a ${SKILL_NAMES[sk] || sk} ${lvl}+ survivor at ${base.name}.`;
  }
  return "";
}
// Every tile of the base's land within range, with why not (for the map's highlight and the tab's list).
export function placeTiles(state, base, kind) {
  if (!base) return [];
  return state.grid.within(base.tile, FIELD.RANGE).filter((id) => id !== base.tile && ownsTile(state, id))
    .map((id) => ({ tile: id, why: placeProblem(state, base, kind, id, false) }));
}
// The walk: hours there and back for each trip of FIELD.WALK.shift work-hours.
export const walkHours = (state, base, tile, work) => r1(state.grid.distance(base.tile, tile) * 2 * FIELD.WALK.pace * Math.max(1, Math.ceil(work / FIELD.WALK.shift)));

// ---------- planning (the base window) ----------
// Plans a field work: the materials leave the stores now, a site stands on the map and the builders go out to it.
// Returns the line to show, or why not ({ error }).
export function planFieldWork(state, base, kind, tile) {
  const why = placeProblem(state, base, kind, tile);
  if (why) return { error: why };
  const def = K[kind];
  for (const [k, v] of Object.entries(def.cost)) base.stock[k] -= v;
  const fw = { id: newId(), kind, tile, owner: "player", baseId: base.id, hp: def.hp, max: def.hp, built: false, garrison: [], contents: {}, since: state.hour };
  const F = ensureFW(state);
  F.list.push(fw);
  const walk = walkHours(state, base, tile, def.hours);
  F.jobs.push({ id: newId(), type: "build", fw: fw.id, baseId: base.id, progress: 0, hours: r1(def.hours + walk), paid: { ...def.cost } });
  const text = `${def.name} planned at ${tileLabel(state, tile)} for ${base.name}: ${def.hours} work-hours and ${walk} hours of walking for the builders.`;
  log(state, text, "info");
  return { text, fw };
}
// Cancel a job: an untouched build gives everything back (and the site goes), a started one half; a repair or a
// demolition just stops (a repair's materials: as a build's).
export function cancelFieldJob(state, jobId) {
  const F = ensureFW(state);
  const job = F.jobs.find((j) => j.id === jobId);
  if (!job) return "That job is gone.";
  const base = baseById(state, job.baseId);
  const fw = fwById(state, job.fw);
  const full = job.progress <= 0 || job.type === "stock"; // a restock's goods all come back
  if (base) for (const [k, v] of Object.entries(job.paid || {})) base.stock[k] = (base.stock[k] || 0) + (full ? v : Math.ceil(v / 2));
  F.jobs.splice(F.jobs.indexOf(job), 1);
  if (job.type === "build" && fw && !fw.built) F.list.splice(F.list.indexOf(fw), 1);
  return `Cancelled: ${jobText(state, job)}. ${Object.keys(job.paid || {}).length ? `${full ? "All" : "Half"} the materials were returned.` : ""}`.trim();
}
export function jobText(state, job) {
  const fw = fwById(state, job.fw);
  const n = fw ? kindName(fw).toLowerCase() : "field work";
  return job.type === "repair" ? `${fw && fw.kind === "spikes" ? "reset" : "repair"} the ${n}` : job.type === "demolish" ? `pull down the ${n}` : job.type === "stock" ? `carry supplies out to the ${n}` : `build a ${n}`;
}
// Repairs: materials by kind and damage (repairBase × the share missing, rounded up), hours by the damage (half the
// build's hours for a wreck, at least FIELD.REPAIR.minHours) plus the walk. { cost, hours, work, walk, missing }.
export function repairCost(state, fw) {
  const base = baseById(state, fw.baseId);
  const missing = 1 - condition(fw);
  const cost = {};
  for (const [k, v] of Object.entries(repairBase(fw.kind))) { const n = Math.ceil(v * missing - 1e-9); if (n > 0) cost[k] = n; }
  const work = Math.max(FIELD.REPAIR.minHours, r1(K[fw.kind].hours * FIELD.REPAIR.hoursShare * missing));
  const walk = base ? walkHours(state, base, fw.tile, work) : 0;
  return { cost, work, walk, hours: r1(work + walk), missing };
}
export function repairProblem(state, fw) {
  if (!fw || !isMine(fw)) return "Not yours.";
  if (!fw.built) return "Still being built.";
  if (fw.hp >= fw.max) return "Not damaged.";
  if (jobFor(state, fw)) return "A job is queued there already.";
  const base = baseById(state, fw.baseId);
  if (!base) return "Its base is gone.";
  const rc = repairCost(state, fw);
  for (const [k, v] of Object.entries(rc.cost)) if ((base.stock[k] || 0) < v) return `Needs ${v} ${matName(k, v)} at ${base.name} (have ${Math.floor(base.stock[k] || 0)}).`;
  return "";
}
export function queueRepair(state, fwId) {
  const fw = fwById(state, fwId);
  const why = repairProblem(state, fw);
  if (why) return { error: why };
  const base = baseById(state, fw.baseId);
  const rc = repairCost(state, fw);
  for (const [k, v] of Object.entries(rc.cost)) base.stock[k] -= v;
  ensureFW(state).jobs.push({ id: newId(), type: "repair", fw: fw.id, baseId: base.id, progress: 0, hours: rc.hours, paid: rc.cost, hpFrom: fw.hp });
  const text = `Repairs queued on ${label(state, fw)} (${costText(rc.cost)}, ${rc.hours} hours with the walk).`;
  return { text };
}
// Every damaged structure of this base that can be paid for, worst first. Returns { done: n, text, short: [why…] }.
export function repairAll(state, base) {
  const list = playerWorks(state, base).filter((fw) => fw.built && fw.hp < fw.max && !jobFor(state, fw)).sort((a, b) => condition(a) - condition(b));
  let done = 0;
  const short = [];
  for (const fw of list) { const r = queueRepair(state, fw.id); if (r.error) short.push(`${kindName(fw)}: ${r.error}`); else done++; }
  return { done, short, text: done ? `${done} repair${done === 1 ? "" : "s"} queued at ${base.name}.${short.length ? ` Not paid for: ${short.join("; ")}` : ""}` : list.length ? `No repairs could be paid for: ${short.join("; ")}` : "Nothing needs repairs." };
}
export function demolishProblem(state, fw) {
  if (!fw || !isMine(fw)) return "Not yours.";
  if (jobFor(state, fw)) return "A job is queued there already: cancel it first.";
  if (!baseById(state, fw.baseId)) return "Its base is gone.";
  return "";
}
export function queueDemolish(state, fwId) {
  const fw = fwById(state, fwId);
  const why = demolishProblem(state, fw);
  if (why) return { error: why };
  if (!fw.built) return { text: cancelFieldJob(state, jobFor(state, fw).id) };
  const base = baseById(state, fw.baseId);
  const hours = r1(FIELD.DEMOLISH.hours + walkHours(state, base, fw.tile, FIELD.DEMOLISH.hours));
  ensureFW(state).jobs.push({ id: newId(), type: "demolish", fw: fw.id, baseId: base.id, progress: 0, hours, paid: {} });
  return { text: `${kindName(fw)} at ${tileLabel(state, fw.tile)}: the builders will pull it down (${hours} hours with the walk; half its materials come back).` };
}
export const costText = (cost) => Object.entries(cost || {}).map(([k, v]) => `${v} ${matName(k, v)}`).join(", ") || "nothing";

// ---------- the builders' hour (buildings.js constructionHour) ----------
// A base with field jobs: the builders go out on the odd hours while the base's own queue has a job to work, every
// hour when it has none. The job in hand is the first one in the field queue whose site is clear (no hostile
// party or horde on it). Returns true when this hour went to the field (constructionHour then skips the base).
export function fieldBuildHour(state, base) {
  if (!state.fieldworks || !state.fieldworks.jobs.length) return false;
  const jobs = jobsOf(state, base);
  if (!jobs.length) return false;
  const rate = buildRate(state, base);
  if (rate <= 0) return false;
  const job = jobs.find((j) => { const fw = fwById(state, j.fw); return fw && !threatOn(state, fw.tile); });
  if (!job) return false;
  const baseWork = base.construction.some((c) => !gatherStalled(c));
  if (baseWork && state.hour % 2 === 0) return false;
  job.progress += rate;
  if (job.progress >= job.hours - 1e-9) finishJob(state, job);
  return true;
}
function finishJob(state, job) {
  const F = ensureFW(state);
  F.jobs.splice(F.jobs.indexOf(job), 1);
  const fw = fwById(state, job.fw);
  const base = baseById(state, job.baseId);
  if (!fw) return;
  if (job.type === "build") {
    fw.built = true;
    fw.hp = fw.max;
    if (fw.kind === "well") {
      const y = wellYield(state, fw.tile);
      const left = state.rng.int(WELL_LEFT.min, WELL_LEFT.max) + WELL_LEFT.perYield * y;
      fw.well = { yield: y, left, start: left, dug: state.hour };
    }
    if (fw.kind === "relay") fw.relayDue = day(state) + RELAY_UPKEEP_DAYS;
    log(state, `${kindName(fw)} finished at ${tileLabel(state, fw.tile)}${base ? ` (${base.name})` : ""}.`, "good");
  } else if (job.type === "repair") {
    fw.hp = fw.max;
    log(state, `The ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)} is repaired.`, "good");
  } else if (job.type === "stock") {
    for (const [k, v] of Object.entries(job.paid || {})) fw.contents[k] = r1((fw.contents[k] || 0) + v);
    log(state, `The cache at ${tileLabel(state, fw.tile)} is stocked: ${contentsText(fw)}.`, "good");
  } else if (job.type === "demolish") {
    if (base) for (const [k, v] of Object.entries(K[fw.kind].cost)) base.stock[k] = (base.stock[k] || 0) + Math.floor(v * FIELD.DEMOLISH.refund * condition(fw));
    if (base && fw.contents) for (const [k, v] of Object.entries(fw.contents)) base.stock[k] = (base.stock[k] || 0) + v;
    removeWork(state, fw);
    log(state, `The ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)} is pulled down; what could be saved is back at ${base ? base.name : "the base"}.`, "info");
  }
}
// A structure goes: its garrison comes home, its jobs end.
function removeWork(state, fw) {
  const F = ensureFW(state);
  recallAll(state, fw);
  F.jobs = F.jobs.filter((j) => j.fw !== fw.id);
  const i = F.list.indexOf(fw);
  if (i >= 0) F.list.splice(i, 1);
}

// ---------- the garrison: lookouts (towers) and guards (roadblocks) on shifts ----------
// fw.roster = { preset, shifts: [{ name, from, to, ids }] } (yours): who stands which hours, as the base's watch roster
// (watch.js). Each hour (rosterHour) the people whose shift is near walk out (s.location = { kind: "post", fw, at: the
// hour they get there }), stand it, and walk home after; off duty they are at the base like anyone (they eat, sleep,
// work). fw.garrison: the ids out there now (walking out, on duty or walking home). A group's structure: fw.gar people,
// 2 round the clock, 1 by day (TOWER.aiDay).
export const garrisonCap = (fw) => (fw && K[fw.kind] ? K[fw.kind].garrison || 0 : 0);
export const onPost = (s) => !!s && !!s.location && s.location.kind === "post";
// Out of the base (job-trips' "who is home" check, base battles): someone out at a field work.
export const outOfBase = onPost;
export const postedAt = (state, fw) => (fw.garrison || []).map((id) => survivorById(state, id)).filter((s) => s && s.alive && s.location && s.location.kind === "post" && s.location.fw === fw.id);
const firstName = (s) => s.name.split(" ")[0];
// Hours to walk out to it (whole hours, at least 1).
export function shiftWalk(state, fw) {
  const b = baseById(state, fw.baseId);
  return b ? Math.max(1, Math.ceil(state.grid.distance(b.tile, fw.tile) * FIELD.WALK.pace - 1e-9)) : 1;
}
function makeRoster(key, old = null) {
  const p = FIELD.SHIFTS[key] || FIELD.SHIFTS.two;
  const prev = old ? old.shifts : [];
  return { preset: FIELD.SHIFTS[key] ? key : "two", shifts: p.shifts.map(([name, from, to]) => {
    const was = prev.find((o) => o.name === name) || prev.find((o) => o.from === from && o.to === to);
    return { name, from, to, ids: was ? was.ids.slice() : [] };
  }) };
}
export function ensureRoster(fw) {
  if (!fw.roster) fw.roster = makeRoster("two");
  return fw.roster;
}
export const rosterIds = (fw) => (fw && fw.roster ? [...new Set(fw.roster.shifts.flatMap((sh) => sh.ids))] : []);
export const shiftOf = (fw, sid) => (fw && fw.roster ? fw.roster.shifts.find((sh) => sh.ids.includes(sid)) || null : null);
// The structure whose roster this person is on (one at a time), or null.
export const rosterOf = (state, sid) => fwList(state).find((fw) => fw.owner === "player" && fw.roster && fw.roster.shifts.some((sh) => sh.ids.includes(sid))) || null;
// Change the shifts (a preset): people keep a shift that matches by name or hours; the rest are off the roster.
export function setRosterPreset(state, fw, key) {
  if (!fw || !isMine(fw) || !garrisonCap(fw) || !FIELD.SHIFTS[key]) return "";
  const kept = rosterIds(fw);
  fw.roster = makeRoster(key, fw.roster);
  const cap = garrisonCap(fw);
  for (const sh of fw.roster.shifts) sh.ids = sh.ids.slice(0, cap);
  const now = new Set(rosterIds(fw));
  for (const id of kept) if (!now.has(id)) { const s = survivorById(state, id); if (s && onPost(s) && s.location.fw === fw.id) sendHome(state, fw, s); }
  return `${kindName(fw)} at ${tileLabel(state, fw.tile)}: ${FIELD.SHIFTS[key].name.toLowerCase()}.`;
}
// The out window of a shift for a walk of w hours: [from − w, to + w) (all day when that covers the clock).
const outWindow = (sh, w) => (shiftHours(sh) + 2 * w >= 24 ? { from: 0, to: 0 } : { from: (sh.from - w + 24) % 24, to: (sh.to + w) % 24 });
// Someone out there now who stands their shift this hour: arrived, the shift's hours, fit.
function onDutyNow(state, fw, s, h = hourOfDay(state)) {
  if (!s || !s.alive || !onPost(s) || s.location.fw !== fw.id) return false;
  if ((s.location.at ?? 0) > state.hour) return false; // still walking out
  if (healthRest(s, state)) return false;
  const sh = shiftOf(fw, s.id);
  return !sh || inShift(sh, h); // no shift (an old save's posting, before rosterHour moves it): on duty
}
// The people on duty there now (yours), fit and arrived.
export const onDuty = (state, fw) => (fw.owner === "player" ? postedAt(state, fw).filter((s) => onDutyNow(state, fw, s)) : []);
// Why this person cannot go on this structure's roster ("" = they can). shiftIdx: a shift (else the emptiest).
export function postProblem(state, fw, s, shiftIdx = null) {
  if (!fw || !isMine(fw)) return "Not yours.";
  if (!garrisonCap(fw)) return "Nobody can be posted there.";
  if (!fw.built) return "Still being built.";
  if (!s || !s.alive) return "Nobody to post.";
  const R = ensureRoster(fw);
  const sh = shiftIdx != null ? R.shifts[shiftIdx] : pickShift(fw);
  if (!sh) return "No such shift.";
  if (sh.ids.includes(s.id)) return `${firstName(s)} stands that shift already.`;
  if (sh.ids.length >= garrisonCap(fw)) return `A shift there holds ${garrisonCap(fw)} at most.`;
  const L = s.location;
  if (!L || !((L.kind === "base" && L.baseId === fw.baseId) || (L.kind === "post" && L.baseId === fw.baseId))) return `${firstName(s)} is not at its base.`;
  return "";
}
// The shift with the fewest people (the first of them: Day before Night).
function pickShift(fw) {
  const R = ensureRoster(fw);
  return R.shifts.slice().sort((a, b) => a.ids.length - b.ids.length || R.shifts.indexOf(a) - R.shifts.indexOf(b))[0] || null;
}
// Put someone on a shift there (off any other roster first). They walk out when the shift comes round (now, if it is
// on): rosterHour. Returns { text } or { error }.
export function postPerson(state, fwId, sid, shiftIdx = null) {
  const fw = fwById(state, fwId), s = survivorById(state, sid);
  const why = postProblem(state, fw, s, shiftIdx);
  if (why) return { error: why };
  const sh = shiftIdx != null ? fw.roster.shifts[shiftIdx] : pickShift(fw);
  const other = rosterOf(state, s.id);
  if (other) for (const x of other.roster.shifts) x.ids = x.ids.filter((id) => id !== s.id);
  if (other && other !== fw && onPost(s)) sendHome(state, other, s);
  sh.ids.push(s.id);
  rosterHour(state, fw);
  const out = onPost(s) && s.location.fw === fw.id;
  return { text: `${firstName(s)} takes the ${sh.name.toLowerCase()} shift (${shiftText(sh)}) at the ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}${out ? ": walking out now" : ""}.` };
}
// Off the roster and home (theirs, else the hub). Returns the line.
export function recallPerson(state, sid, why = "") {
  const s = survivorById(state, sid);
  if (!s) return "";
  const fw = rosterOf(state, sid) || (onPost(s) ? fwById(state, s.location.fw) : null);
  if (fw && fw.roster) for (const sh of fw.roster.shifts) sh.ids = sh.ids.filter((id) => id !== s.id);
  if (!onPost(s)) return fw ? `${firstName(s)} is off the ${kindName(fw).toLowerCase()}'s shifts.` : "";
  return sendHome(state, fw, s, why);
}
// Home now (the roster kept): their shift is over, enemies at the structure, they ran for it.
function sendHome(state, fw, s, why = "") {
  if (!s || !onPost(s)) return "";
  const home = baseById(state, s.location.baseId) || hub(state);
  if (fw) fw.garrison = (fw.garrison || []).filter((id) => id !== s.id);
  else { const at = fwById(state, s.location.fw); if (at) at.garrison = at.garrison.filter((id) => id !== s.id); }
  if (home) s.location = { kind: "base", baseId: home.id };
  return `${firstName(s)} is back at ${home ? home.name : "the base"}${why ? `: ${why}` : ""}.`;
}
// Everyone out there home (the roster kept; drop: off it too). Returns the lines.
export function recallAll(state, fw, why = "", drop = false) {
  const lines = [];
  for (const s of postedAt(state, fw)) { const t = sendHome(state, fw, s, why); if (t) lines.push(t); }
  fw.garrison = [];
  if (drop && fw.roster) for (const sh of fw.roster.shifts) sh.ids = [];
  return lines;
}
// The hour's walking out and home for one structure's roster (or all of yours). Someone goes out when their shift's
// out window is on, they are at the base, fit (not in a bed, not resting hurt or ill) and nothing hostile stands
// there; they come home when it ends, or when they are hurt or ill.
export function rosterHour(state, only = null) {
  const h = hourOfDay(state);
  for (const fw of only ? [only] : fwList(state)) {
    if (fw.owner !== "player" || !fw.built || !garrisonCap(fw)) continue;
    // An older save's permanent posting: onto the shifts (the first to Day, the next to Night).
    if (!fw.roster && fw.garrison && fw.garrison.length) { ensureRoster(fw); fw.garrison.forEach((id, i) => { const sh = fw.roster.shifts[i % fw.roster.shifts.length]; if (sh.ids.length < garrisonCap(fw)) sh.ids.push(id); }); }
    if (!fw.roster) continue;
    const base = baseById(state, fw.baseId);
    const w = shiftWalk(state, fw);
    const blocked = threatOn(state, fw.tile);
    for (const sh of fw.roster.shifts) {
      sh.ids = sh.ids.filter((id) => { const s = survivorById(state, id); return s && s.alive; });
      const win = outWindow(sh, w);
      for (const id of sh.ids) {
        const s = survivorById(state, id);
        const want = inShift(win, h) && !blocked;
        const here = onPost(s) && s.location.fw === fw.id;
        if (here) {
          if (!want || healthRest(s, state)) sendHome(state, fw, s);
          continue;
        }
        if (!want || !base || s.location.kind !== "base" || s.location.baseId !== base.id || s.inBed || healthRest(s, state)) continue;
        // Late into the shift (less than the walk there and back left of it): wait for the next.
        const left = inShift(sh, h) ? (sh.to - h + 24) % 24 || 24 : shiftHours(sh) + w;
        if (left <= w) continue;
        s.location = { kind: "post", baseId: fw.baseId, fw: fw.id, tile: fw.tile, at: state.hour + w }; // there in w hours (at the shift's start when they left on time)
        if (!fw.garrison.includes(s.id)) fw.garrison.push(s.id);
      }
    }
  }
}
// Per hour of the day: how many on the roster would stand it (alive, fit, of this base: at home or out there now), the
// names; gaps are hours nobody covers. [{ h, n, who, shifts }]
export function shiftCoverage(state, fw) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    const who = [], shifts = [];
    for (const sh of (fw.roster ? fw.roster.shifts : [])) {
      if (!inShift(sh, h)) continue;
      shifts.push(sh);
      for (const id of sh.ids) {
        const s = survivorById(state, id);
        if (!s || !s.alive || healthRest(s, state) || s.inBed) continue;
        const L = s.location;
        if (!((L.kind === "base" && L.baseId === fw.baseId) || (L.kind === "post" && L.fw === fw.id))) continue;
        if (!who.includes(s)) who.push(s);
      }
    }
    out.push({ h, n: who.length, who, shifts });
  }
  return out;
}
// "On duty now: Ann · gaps 18–06" for the tab.
export function shiftLine(state, fw) {
  const cov = shiftCoverage(state, fw);
  const gaps = [];
  for (let h = 0; h < 24; h++) if (!cov[h].n) { if (gaps.length && gaps[gaps.length - 1][1] === h) gaps[gaps.length - 1][1] = h + 1; else gaps.push([h, h + 1]); }
  if (gaps.length > 1 && gaps[0][0] === 0 && gaps[gaps.length - 1][1] === 24) { const last = gaps.pop(); gaps[0][0] = last[0]; }
  const hh = (x) => String(x % 24).padStart(2, "0");
  const now = onDuty(state, fw).map(firstName);
  return { gaps, text: `${now.length ? `On duty now: ${now.join(", ")}` : "Nobody on duty now"}${!rosterIds(fw).length ? " · nobody on the shifts" : gaps.length ? ` · not covered ${gaps.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(", ")}` : " · covered round the clock"}` };
}
// A group's people on duty at a structure: 2 round the clock, 1 by day (TOWER.aiDay).
function groupDuty(state, fw) {
  if (!fw.built) return 0;
  const g = Math.min(fw.gar || 0, 2);
  if (g >= 2) return g;
  const h = hourOfDay(state);
  return g === 1 && h >= FIELD.TOWER.aiDay[0] && h < FIELD.TOWER.aiDay[1] ? 1 : 0;
}
// Lookouts on duty now (a tower; a roadblock's guards: guards()). A person resting hurt or ill keeps no watch.
export function lookouts(state, fw) {
  if (fw.owner !== "player") return fw.kind === "tower" ? groupDuty(state, fw) : 0;
  if (!fw.built || fw.kind !== "tower") return 0;
  return onDuty(state, fw).length;
}
export function guards(state, fw) {
  if (!fw.built || fw.kind !== "roadblock") return 0;
  return fw.owner === "player" ? onDuty(state, fw).length : groupDuty(state, fw);
}
export const manned = (state, fw) => fw.kind === "tower" && fw.built && lookouts(state, fw) > 0;
export const towerRadius = (state) => (isNight(state) ? FIELD.TOWER.night : FIELD.TOWER.day);
// The tiles your manned towers show live on the map (world.js liveTiles).
export function fieldSight(state) {
  const out = [];
  for (const fw of fwList(state)) if (fw.owner === "player" && manned(state, fw)) for (const id of state.grid.within(fw.tile, towerRadius(state))) out.push(id);
  return out;
}
// A manned tower of this base (or within TOWER.warnBase tiles of it) sees this tile (watch.js lookoutsSpot).
export function towerSees(state, base, tile) {
  if (!base || !state.fieldworks) return null;
  for (const fw of fwList(state)) {
    if (fw.owner !== "player" || !manned(state, fw)) continue;
    if (fw.baseId !== base.id && state.grid.distance(fw.tile, base.tile) > FIELD.TOWER.warnBase) continue;
    if (state.grid.distance(fw.tile, tile) <= towerRadius(state)) return fw;
  }
  return null;
}
export const towerSawText = (state, base, tile) => { const fw = towerSees(state, base, tile); return fw ? ` The lookouts on the tower at ${tileLabel(state, fw.tile)} saw them first.` : ""; };

// ---------- water (economy.js waterProduction; job-trips' Fetch water) ----------
// The wells of this base: [{ fw, tile, rate, today (the day's yield not yet drawn by the water carriers) }], best first.
export function waterSourcesFor(state, base) {
  return playerWorks(state, base).filter((fw) => fw.kind === "well" && fw.built && fw.well && fw.hp > 0)
    .map((fw) => ({ fw, tile: fw.tile, rate: wellRate(state, fw.well), today: wellToday(state, fw) })).sort((a, b) => b.rate - a.rate);
}
// The yield a well has left to give today (the job trips' water carriers draw it: drawWell).
export function wellToday(state, fw) {
  const w = fw && fw.well;
  if (!w) return 0;
  return Math.max(0, r1(wellRate(state, w) - (w.drawnDay === day(state) ? w.drawn || 0 : 0)));
}
// A water carrier fills up to q at a field well (job trips, TRIP_HOOKS.draw): at most the day's yield left; the well is
// drawn down by it and one at 0 is dry. Returns what they got.
export function drawWell(state, tile, q) {
  const fw = fwList(state).find((x) => x.tile === tile && x.kind === "well" && x.owner === "player" && x.built && x.well && x.hp > 0);
  if (!fw || !(q > 0)) return 0;
  const w = fw.well, today = day(state);
  const take = Math.min(q, wellToday(state, fw), Math.max(0, w.left));
  if (!(take > 0)) return 0;
  if (w.drawnDay !== today) { w.drawnDay = today; w.drawn = 0; }
  w.drawn = Math.round((w.drawn + take) * 100) / 100;
  w.left = Math.max(0, Math.round((w.left - take) * 100) / 100);
  if (w.left <= 0 && !w.dry) { w.dry = true; log(state, `The field well at ${tileLabel(state, fw.tile)} has run dry.`, "danger"); }
  return take;
}
// The well water hauled home today: the base's people haul one well per CLAIM.WELL_PER_PEOPLE of them, the claim wells
// (claims.js hauledWells) taking their share first. { total, wells: [{ fw, tile, rate, counted }] }.
export function fieldWellWater(state, base) {
  const src = FIELD.PASSIVE_WELLS ? waterSourcesFor(state, base) : [];
  if (!src.length) return { total: 0, wells: [] };
  const cw = hauledWells(state, base);
  const used = cw.wells.filter((w) => w.counted).length;
  const cap = Math.max(0, Math.floor(atBase(state, base.id).length / CLAIM.WELL_PER_PEOPLE) - used);
  let total = 0;
  const wells = src.map((x, i) => { const counted = i < cap && x.rate > 0; if (counted) total += x.rate; return { ...x, counted }; });
  return { total: r1(total), wells };
}
// Daily: what was hauled is drawn from the wells (economy.js baseDaily, after the claim wells).
export function drawFieldWells(state, base) {
  for (const o of fieldWellWater(state, base).wells) {
    if (!o.counted) continue;
    const w = o.fw.well;
    w.left = Math.max(0, r1(w.left - o.rate));
    if (w.left <= 0 && !w.dry) { w.dry = true; log(state, `The field well at ${tileLabel(state, o.tile)} has run dry.`, "danger"); }
  }
}

// ---------- stockpiles (drop points) ----------
const kgIn = (rec) => Object.entries(rec || {}).reduce((a, [k, q]) => a + (q > 0 && SUPPLIES[k] ? q * SUPPLIES[k].weight : 0), 0);
export const stockKg = (fw) => r1(kgIn(fw.contents));
export const stockRoom = (fw) => Math.max(0, (K[fw.kind].capKg || 0) - kgIn(fw.contents));
export const contentsText = (fw) => Object.entries(fw.contents || {}).filter(([, q]) => q >= 0.5).map(([k, q]) => `${Math.floor(q)} ${matName(k, q)}`).join(", ") || "empty";
// The stockpiles of this base an outdoor worker can leave goods at: [{ fw, tile, room (kg) }], nearest to `near` first.
export function dropPointsFor(state, base, near = null) {
  const list = playerWorks(state, base).filter((fw) => fw.kind === "stockpile" && fw.built && fw.hp > 0 && !threatOn(state, fw.tile));
  const at = near == null ? base.tile : near;
  return list.map((fw) => ({ fw, tile: fw.tile, room: r1(stockRoom(fw)) })).sort((a, b) => state.grid.distance(a.tile, at) - state.grid.distance(b.tile, at) || a.fw.id - b.fw.id);
}
// Leave up to qty of a supply at a stockpile. Returns what it took (by its room).
export function depositAt(state, fw, key, qty) {
  if (!fw || (fw.kind !== "stockpile" && fw.kind !== "cache") || !fw.built || !SUPPLIES[key] || !(qty > 0)) return 0;
  const w = SUPPLIES[key].weight || 1;
  const take = Math.min(qty, Math.floor((stockRoom(fw) / w) * 100) / 100);
  if (take <= 0) return 0;
  fw.contents[key] = r1((fw.contents[key] || 0) + take);
  return take;
}
// Everything at a stockpile into a team's cargo, as far as there is room (heaviest-value first). Returns the line.
export function loadFromStockpile(state, p, fw) {
  if (!p.cargo) p.cargo = { supplies: {}, gear: [] };
  const got = [];
  const keys = Object.keys(fw.contents || {}).sort((a, b) => (SUPPLIES[b] ? SUPPLIES[b].value / SUPPLIES[b].weight : 0) - (SUPPLIES[a] ? SUPPLIES[a].value / SUPPLIES[a].weight : 0));
  for (const k of keys) {
    const q = fw.contents[k] || 0;
    if (q <= 0 || !SUPPLIES[k]) continue;
    const fits = Math.min(q, Math.floor(cargoRoom(state, p) / SUPPLIES[k].weight));
    if (fits <= 0) continue;
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + fits;
    fw.contents[k] = r1(q - fits);
    if (fw.contents[k] <= 0) delete fw.contents[k];
    got.push(`${fits} ${matName(k, fits)}`);
  }
  return got.length ? `Loaded from the stockpile: ${got.join(", ")}.${Object.keys(fw.contents).length ? ` Left there: ${contentsText(fw)} (no room).` : ""}` : Object.keys(fw.contents || {}).length ? "No room to carry anything more." : "The stockpile is empty.";
}
// A team leaves what it found (not its own food, water, meds and ammo) at a stockpile of yours.
const KEEP = new Set(["food", "water", "rawwater", "meds", "ammo", "arrows", "fuel"]);
export function unloadToStockpile(state, p, fw) {
  const got = [];
  const keys = new Set([...Object.keys((p.cargo && p.cargo.supplies) || {}), ...Object.keys(p.supplies || {})]);
  for (const k of keys) {
    if (KEEP.has(k) || !SUPPLIES[k] || SUPPLIES[k].cat === "ammo") continue;
    const have = carried(p, k);
    if (have < 1) continue;
    const put = depositAt(state, fw, k, Math.floor(have));
    if (put > 0) { takeSupply(p, k, put); got.push(`${put} ${matName(k, put)}`); }
  }
  return got.length ? `Left at the stockpile: ${got.join(", ")} (${stockKg(fw)} of ${K.stockpile.capKg} kg).` : stockRoom(fw) < 1 ? "The stockpile is full." : "Nothing to leave there (the team keeps its food, water, meds and ammo).";
}
// The base's Send a haul team: up to 2 fit people (the strongest backs) and the base's best running vehicle go to
// the stockpile, load it and come home. Returns the line or { error }.
export function sendHaul(state, fwId, { needCar = false } = {}) {
  const fw = fwById(state, fwId);
  if (!fw || !isMine(fw) || fw.kind !== "stockpile") return { error: "No stockpile of yours." };
  if (!Object.keys(fw.contents || {}).length) return { error: "The stockpile is empty." };
  const base = baseById(state, fw.baseId);
  if (!base) return { error: "Its base is gone." };
  const people = atBase(state, base.id).filter((s) => !healthRest(s) && !s.pinned && !s.leader && s.health >= 50).sort((a, b) => (a.role === "build") - (b.role === "build") || combatPower(b) - combatPower(a)); // the builders last
  if (!people.length) return { error: `Nobody fit at ${base.name} to send.` };
  const cars = state.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === base.id && v.condition > 0 && !v.count && (v.fuel || 0) >= 2).sort((a, b) => (b.cargo || 0) - (a.cargo || 0));
  if (needCar && !cars.length) return { error: `No running vehicle with fuel at ${base.name}.` };
  const crew = people.slice(0, 2).map((s) => s.id);
  const sup = { food: Math.min(Math.floor(base.stock.food || 0), crew.length), water: Math.min(Math.floor(base.stock.water || 0), crew.length) };
  let res = cars.length ? launchExpedition(state, { memberIds: crew, dest: fw.tile, mission: "move", stance: "normal", supplies: sup, vehicleId: cars[0].id, fromBaseId: base.id, quiet: true }) : null;
  if ((!res || res.error) && !needCar) res = launchExpedition(state, { memberIds: crew, dest: fw.tile, mission: "move", stance: "normal", supplies: sup, fromBaseId: base.id, quiet: true });
  if (!res || res.error) return { error: res ? res.error : "The vehicle could not set out." };
  const p = res.party;
  p.haulFor = fw.id;
  queueOrder(state, p, { type: "fwork", act: "load", at: fw.tile });
  queueOrder(state, p, { type: "home" });
  const text = `${crew.map((id) => survivorById(state, id).name.split(" ")[0]).join(" and ")} set out from ${base.name} to haul the stockpile at ${tileLabel(state, fw.tile)}${p.vehicle ? " with a vehicle" : " on foot"}.`;
  log(state, text, "info");
  return { text, party: p };
}

// ---------- the standing haul order (a stockpile's "Haul every N days / when it holds X kg") ----------
// fw.haul = { every (days, 0 off), atKg (0 off), next (the day of the next), last: { day, ok?, why? } }. Checked at
// FIELD.HAUL.hour: due on its day or once it holds atKg; it runs the Send a haul team with the base's best running
// vehicle (none: skipped), and skips a base under attack or with nobody fit (tried again the next day).
export function setHaul(state, fw, every, atKg) {
  if (!fw || !isMine(fw) || fw.kind !== "stockpile") return "";
  const e = Math.max(0, Math.round(Number(every) || 0)), k = Math.max(0, Math.round(Number(atKg) || 0));
  if (!e && !k) { delete fw.haul; return `The stockpile at ${tileLabel(state, fw.tile)}: no standing haul order.`; }
  const was = fw.haul || {};
  fw.haul = { every: e, atKg: k, next: e ? (was.every === e && was.next != null ? was.next : day(state) + e) : null, last: was.last || null };
  return `The stockpile at ${tileLabel(state, fw.tile)}: hauled ${[e ? `every ${e} days` : "", k ? `once it holds ${k} kg` : ""].filter(Boolean).join(" or ")} (with a vehicle).`;
}
// "Next haul: day 12" / "when it holds 100 kg" / "" (no order).
export function haulText(state, fw) {
  const H = fw.haul;
  if (!H || (!H.every && !H.atKg)) return "";
  const bits = [];
  if (H.every) bits.push(H.next != null && H.next <= day(state) ? "next haul: today (at 09:00)" : `next haul: day ${H.next}`);
  if (H.atKg) bits.push(`or once it holds ${H.atKg} kg`);
  const last = H.last ? (H.last.ok ? ` · last hauled day ${H.last.day}` : H.last.why ? ` · day ${H.last.day} skipped: ${H.last.why}` : "") : "";
  return `${bits.join(" ")}${last}`;
}
function haulHour(state) {
  const today = day(state);
  for (const fw of fwList(state)) {
    if (fw.owner !== "player" || fw.kind !== "stockpile" || !fw.built || !fw.haul) continue;
    const H = fw.haul;
    if (!H.every && !H.atKg) continue;
    const dueDay = H.every && today >= (H.next ?? 0), dueKg = H.atKg && stockKg(fw) >= H.atKg;
    if (!dueDay && !dueKg) continue;
    if (state.parties.some((q) => q.haulFor === fw.id)) continue; // one on its way already
    if (!Object.keys(fw.contents || {}).length) { if (dueDay) H.next = today + H.every; H.last = { day: today, why: "nothing there" }; continue; }
    const base = baseById(state, fw.baseId);
    if (!base) continue;
    if (underAttack(state, base)) { H.last = { day: today, why: `${base.name} is under attack` }; continue; }
    if (threatOn(state, fw.tile)) { H.last = { day: today, why: "enemies at the stockpile" }; continue; }
    const r = sendHaul(state, fw.id, { needCar: true });
    if (r.error) { H.last = { day: today, why: r.error.replace(/\.$/, "").replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()) }; continue; }
    H.last = { day: today, ok: true };
    if (H.every) H.next = today + H.every;
    fwStat(state, "hauls");
  }
}

// ---------- snare lines ----------
// fw.held = [{ day, n }]: the catch waiting in the snares by the day it was caught. Rolled each day (snareLinesDaily)
// as the hunting snares are (hunting.js snareDayRate a line, SNARE.count snares to a line; the game thinned by it); kept
// SNARES.keep days by the heat (over 22°: 2, under 3°: 6, else 3); robbed SNARES.theft a day (+near: a town, the dead or
// a stranger's party within 2), the wires torn (SNARES.tear of its condition). Checked: yours each morning by a hunter
// of its base (any of them at home), into the base's food; a group's by their own people, into their stores.
export const snareHeld = (fw) => (fw.held || []).reduce((a, x) => a + x.n, 0);
export const snareHeldText = (fw) => { const n = snareHeld(fw); return n ? `${n} small game` : "nothing yet"; };
export const snaresWork = (fw) => !!fw && fw.built && condition(fw) >= FIELD.SNARES.dead;
function keepDaysAt(state, tile) {
  const t = Weather.weather(state, state.hour, tile).temp;
  return FIELD.SNARES.keep[t > 22 ? 0 : t < 3 ? 2 : 1];
}
// Expected small game a day on that tile now (the tab's guide).
export const snareExpect = (state, fw) => r1(snareDayRate(state, fw.tile, state.hour) * FIELD.SNARES.lines);
function snareRobbers(state, fw) {
  const g = state.grid;
  if (state.grid.within(fw.tile, 2).some((id) => ["city", "suburb"].includes(state.tiles[id].terrain))) return true;
  if (state.hordes.some((h) => g.distance(h.tile, fw.tile) <= 2)) return true;
  return state.parties.some((p) => p.owner !== fw.owner && p.owner !== "player" && g.distance(partyTile(p), fw.tile) <= 2) || (state.visitors || []).some((v) => g.distance(v.tile, fw.tile) <= 2);
}
function snareDay(state, fw) {
  const S = FIELD.SNARES;
  const today = day(state);
  fw.held = (fw.held || []).filter((x) => today - x.day < keepDaysAt(state, fw.tile) || void (fw.rotted = (fw.rotted || 0) + x.n));
  if (snaresWork(fw)) {
    const n0 = SNARE.count * S.lines;
    const per = Math.min(0.9, (snareDayRate(state, fw.tile, state.hour) * S.lines) / n0);
    let n = 0;
    for (let i = 0; i < n0; i++) if (state.rng.chance(per)) n++;
    if (n) { fw.held.push({ day: today, n }); takeGame(state, fw.tile, n * ANIMALS.small.rations, SNARE.deplete); fw.caught = (fw.caught || 0) + n; }
  }
  const held = snareHeld(fw);
  if (held && state.rng.chance(S.theft + (snareRobbers(state, fw) ? S.near : 0))) {
    fw.held = [];
    fw.robbed = (fw.robbed || 0) + held;
    if (fw.owner === "player") news(state, fw, `Someone robbed the snare line at ${tileLabel(state, fw.tile)}: ${held} small game taken and wires torn.`, "warn");
    if (fw.hp - S.tear <= 0) damageWork(state, fw, S.tear, "thieves");
    else fw.hp = r1(fw.hp - S.tear);
  }
}
// The catch out of the snares: into a team's cargo (party), a base's stores (base) or a group's (else). Each animal
// may be infested (worm.js wormKill), as the hunters'. Returns the line.
export function takeSnares(state, fw, { party = null, base = null, rob = false } = {}) {
  const n = snareHeld(fw);
  if (!n) return rob ? "Nothing in their snares." : "The snares were empty.";
  let rations = 0, worm = 0;
  for (let i = 0; i < n; i++) { const wk = wormKill(state, fw.tile, ANIMALS.small.rations); rations += wk.rations; worm += wk.worm; }
  fw.held = [];
  if (party) {
    const kept = addMeat(state, party, rations, worm);
    return `${rob ? "Took the catch from their snares" : "The snares held"}: ${n} small game (${kept} food of fresh game${kept < rations ? `; no room for ${rations - kept}` : ""}).`;
  }
  if (base) {
    if (worm > 0) base.wormMeat = wormMeatAt(base) + worm;
    base.stock.food = (base.stock.food || 0) + rations;
    base.meat = meatAt(base) + rations;
    noteOutput(state, base, "hunt", rations, "food");
    return `${n} small game from the snare line at ${tileLabel(state, fw.tile)} (${rations} food).`;
  }
  const f = factionById(state, fw.owner);
  if (f) f.stock.food = (f.stock.food || 0) + rations;
  return "";
}
// Daily (fieldworksDaily): every snare line's day; a group's people take their catch in.
function snareLinesDaily(state) {
  for (const fw of fwList(state)) {
    if (fw.kind !== "snares" || !fw.built) continue;
    snareDay(state, fw);
    if (fw.owner !== "player") takeSnares(state, fw);
  }
}
// Each morning (FIELD.HAUL.hour − 1): a hunter at the base checks its snare lines.
function snareCheckHour(state) {
  for (const fw of fwList(state)) {
    if (fw.owner !== "player" || fw.kind !== "snares" || !fw.built || !snareHeld(fw)) continue;
    const base = baseById(state, fw.baseId);
    if (!base || threatOn(state, fw.tile)) continue;
    const hunter = atBase(state, base.id).find((s) => s.role === "hunt" && !healthRest(s, state) && !s.inBed);
    if (!hunter) continue;
    const line = takeSnares(state, fw, { base });
    fw.checked = { day: day(state), by: hunter.id };
    if (line) log(state, `${firstName(hunter)} checked the snares: ${line}`, "good");
  }
}

// ---------- caches ----------
const cacheKey = (k) => FIELD.CACHE.keys.includes(k) || (!!SUPPLIES[k] && SUPPLIES[k].cat === "ammo");
// What a restock would take from the base's stores to fill the cache (by FIELD.CACHE.mix of its room in kg; at most
// half of the base's own of each; ammo: its most plentiful rounds). { key: qty }
export function cachePlan(state, fw) {
  const base = baseById(state, fw.baseId);
  if (!base) return {};
  const room = stockRoom(fw);
  const out = {};
  for (const [k, share] of Object.entries(FIELD.CACHE.mix)) {
    let kg = room * share;
    const keys = k === "ammo" ? Object.keys(base.stock).filter((x) => SUPPLIES[x] && SUPPLIES[x].cat === "ammo" && (base.stock[x] || 0) >= 2).sort((a, b) => (base.stock[b] || 0) - (base.stock[a] || 0) || (a < b ? -1 : 1)).slice(0, 2) : [k];
    for (const key of keys) {
      if (!SUPPLIES[key] || kg <= 0) continue;
      const w = SUPPLIES[key].weight || 1;
      const q = Math.floor(Math.min((base.stock[key] || 0) / 2, kg / w / (k === "ammo" ? keys.length : 1)));
      if (q > 0) { out[key] = q; kg -= q * w; }
    }
  }
  return out;
}
export function restockProblem(state, fw) {
  if (!fw || !isMine(fw) || fw.kind !== "cache") return "Not a cache of yours.";
  if (!fw.built) return "Still being built.";
  if (jobFor(state, fw)) return "A job is queued there already.";
  if (stockRoom(fw) < 2) return "It is full.";
  if (!Object.keys(cachePlan(state, fw)).length) return "Nothing to spare at its base.";
  return "";
}
// Restock: the goods leave the stores now, the builders carry them out (a job: the walk there and back and an hour).
export function queueRestock(state, fwId) {
  const fw = fwById(state, fwId);
  const why = restockProblem(state, fw);
  if (why) return { error: why };
  const base = baseById(state, fw.baseId);
  const plan = cachePlan(state, fw);
  for (const [k, v] of Object.entries(plan)) base.stock[k] -= v;
  const hours = r1(1 + walkHours(state, base, fw.tile, 1));
  ensureFW(state).jobs.push({ id: newId(), type: "stock", fw: fw.id, baseId: base.id, progress: 0, hours, paid: plan });
  return { text: `The builders will carry ${costText(plan)} out to the cache at ${tileLabel(state, fw.tile)} (${hours} hours with the walk).` };
}
// A team takes what it can carry of the cache into its supplies.
export function drawFromCache(state, p, fw) {
  p.supplies = p.supplies || {};
  const got = [];
  for (const k of Object.keys(fw.contents || {}).sort()) {
    const q = fw.contents[k] || 0;
    if (q < 1 || !SUPPLIES[k]) continue;
    const fits = Math.min(Math.floor(q), Math.floor(cargoRoom(state, p) / (SUPPLIES[k].weight || 1)));
    if (fits <= 0) continue;
    p.supplies[k] = (p.supplies[k] || 0) + fits;
    fw.contents[k] = r1(q - fits);
    if (fw.contents[k] <= 0) delete fw.contents[k];
    got.push(`${fits} ${matName(k, fits)}`);
  }
  return got.length ? `Took from the cache: ${got.join(", ")}.${Object.keys(fw.contents).length ? ` Left there: ${contentsText(fw)}.` : ""}` : Object.keys(fw.contents || {}).length ? "No room to carry anything more." : "The cache is empty.";
}
// A team leaves the supplies it carries as cargo (fuel, food, water, meds, ammo) in the cache, as far as there is room.
export function stashInCache(state, p, fw) {
  const got = [];
  const cargo = (p.cargo && p.cargo.supplies) || {};
  for (const k of Object.keys(cargo).sort()) {
    if (!cacheKey(k) || (cargo[k] || 0) < 1) continue;
    const put = depositAt(state, fw, k, Math.floor(cargo[k]));
    if (put > 0) { cargo[k] -= put; if (cargo[k] <= 0) delete cargo[k]; got.push(`${put} ${matName(k, put)}`); }
  }
  return got.length ? `Left in the cache: ${got.join(", ")} (${stockKg(fw)} of ${K.cache.capKg} kg).` : stockRoom(fw) < 1 ? "The cache is full." : "Nothing to leave (only what the team carries as cargo goes in).";
}

// ---------- hunting blinds (the job trips' hunters: tripland.js TRIP_HOOKS.game) ----------
// × on the game a base's hunters find on this tile (a blind of yours there): FIELD.BLIND.mult, else 1.
export function blindMult(state, base, tile) {
  const fw = fwAt(state, tile);
  return fw && fw.kind === "blind" && fw.built && fw.owner === "player" && fw.hp > 0 ? FIELD.BLIND.mult : 1;
}

// ---------- the job trips' plug-in points (job-trips branch: tripland.js TRIP_HOOKS) ----------
// At integration: installTripHooks(TRIP_HOOKS) once (main.js or tripland.js). Then
//   water(state, base, job, list): the base's wells join the water carriers' sources (Fetch water; not the fishers),
//     { id, d, well: true }, sorted in with the river and lake tiles by distance;
//   deposit(state, base, s, job): an outdoor worker's load goes to the nearest stockpile of the base with room (and
//     DROP_MIN_KG to spare) when it is nearer the worker's tile than the base is: { tile, stock: its contents, fw }.
// and FIELD.PASSIVE_WELLS can be set false (the carriers bring the well water instead).
export function installTripHooks(hooks, { passiveWells = false } = {}) {
  if (!hooks) return;
  const prevWater = hooks.water, prevDeposit = hooks.deposit;
  hooks.water = (state, base, job, list) => {
    const base0 = prevWater ? prevWater(state, base, job, list) || list : list;
    if (job !== "water") return base0;
    const wells = waterSourcesFor(state, base).filter((w) => w.rate > 0 && w.today >= 0.5).map((w) => ({ id: w.tile, d: state.grid.distance(base.tile, w.tile), well: true })); // drawn dry for today: the carriers go elsewhere
    return [...base0, ...wells].sort((a, b) => a.d - b.d || a.id - b.id);
  };
  hooks.deposit = (state, base, s, job) => {
    const prev = prevDeposit ? prevDeposit(state, base, s, job) : null;
    if (prev && prev.tile != null) return prev;
    const at = s && s.trip && s.trip.at != null ? s.trip.at : null;
    if (at == null || job === "water") return null;
    const drop = dropPointsFor(state, base, at).find((d) => d.room >= FIELD.DROP_MIN_KG && state.grid.distance(d.tile, at) < state.grid.distance(base.tile, at));
    return drop ? { tile: drop.tile, stock: drop.fw.contents, fw: drop.fw } : null;
  };
  const prevGame = hooks.game;
  hooks.game = (state, base, tile) => blindMult(state, base, tile) * (prevGame ? prevGame(state, base, tile) || 1 : 1); // a hunting blind
  const prevDraw = hooks.draw;
  hooks.draw = (state, base, tile, q) => (fwAt(state, tile) && fwAt(state, tile).kind === "well" ? drawWell(state, tile, q) : prevDraw ? prevDraw(state, base, tile, q) : q);
  FIELD.PASSIVE_WELLS = !!passiveWells;
}

// ---------- radio (radio.js radioNodes, groupNetwork) ----------
export function fieldRelayNodes(state) {
  const out = [];
  for (const fw of fwList(state)) {
    if (fw.kind !== "relay" || !fw.built || fw.hp <= 0 || fw.owner !== "player") continue;
    const base = baseById(state, fw.baseId) || hub(state);
    if (!base) continue;
    out.push({ base, tile: fw.tile, range: RELAY_RANGE, kind: "relay", linked: false, offline: !!fw.offline, field: fw.id });
  }
  return out;
}
export const groupRelayTiles = (state, f) => fwList(state).filter((fw) => fw.kind === "relay" && fw.built && fw.owner === f.id).map((fw) => fw.tile);
function relayUpkeep(state) {
  const today = day(state);
  for (const fw of fwList(state)) {
    if (fw.kind !== "relay" || !fw.built || fw.owner !== "player") continue;
    if (fw.relayDue == null) fw.relayDue = today + RELAY_UPKEEP_DAYS;
    if (today < fw.relayDue && !fw.offline) continue;
    const b = baseById(state, fw.baseId), h = hub(state);
    const from = b && (b.stock.parts || 0) >= 1 ? b : h && (h.stock.parts || 0) >= 1 ? h : null;
    if (from) {
      from.stock.parts -= 1;
      fw.relayDue = today + RELAY_UPKEEP_DAYS;
      if (fw.offline) log(state, `The relay mast at ${tileLabel(state, fw.tile)} is back on the air.`, "good");
      fw.offline = false;
    } else if (!fw.offline) {
      fw.offline = true;
      log(state, `The relay mast at ${tileLabel(state, fw.tile)} went off the air: it needs 1 part.`, "danger");
    }
  }
}

// ---------- who is hostile to whom ----------
// An AI party is hostile to a structure's owner: yours: a hostile group's party, a raid on you, outsiders; a group's:
// a raid on that group.
function partyHostile(state, fw, p) {
  if (p.owner === fw.owner) return false;
  if (fw.owner === "player") {
    if (p.owner === "player") return false;
    if (p.owner === "outsider") return true;
    if (p.kind === "raid" && p.target && p.target.kind === "player") return true;
    if (p.kind === "fwraid") return true;
    const f = typeof p.owner === "number" ? factionById(state, p.owner) : null;
    return !!f && f.alive && attitude(f) === "Hostile";
  }
  if (p.owner === "player") return false; // your teams: teamEnter
  return (p.kind === "raid" && p.target && p.target.factionId === fw.owner) || (p.kind === "fwraid" && p.target && p.target.fw === fw.id);
}
// Something hostile to the owner stands on the tile (a horde, a hostile party, outsider raiders).
export function threatOn(state, tile) {
  const fw = fwAt(state, tile);
  if (state.hordes.some((h) => h.tile === tile && h.size >= 5)) return true;
  if (!fw) return false;
  if (state.parties.some((p) => p.owner !== "player" && partyTile(p) === tile && partyHostile(state, fw, p))) return true;
  if (fw.owner === "player" && (state.visitors || []).some((v) => v.kind === "raiders" && v.tile === tile)) return true;
  return false;
}

// ---------- damage ----------
// n hit points off. Destroyed: gone (its garrison flees home, a stockpile's goods are lost). Returns true if destroyed.
export function damageWork(state, fw, n, why) {
  if (!fw || n <= 0) return false;
  if (!fw.built) {
    const job = jobFor(state, fw);
    if (job) job.progress = Math.max(0, job.progress * FIELD.HORDE.siteLoss);
    if (fw.owner === "player") news(state, fw, `The ${kindName(fw).toLowerCase()} going up at ${tileLabel(state, fw.tile)} was set back by ${why}.`, "warn");
    return false;
  }
  fw.hp = Math.max(0, r1(fw.hp - n));
  fw.hitHour = state.hour;
  if (fw.hp > 0) {
    if (fw.owner === "player") news(state, fw, `${cap(label(state, fw))} was damaged by ${why} (${Math.round(condition(fw) * 100)}% left).`, condition(fw) < 0.35 ? "danger" : "warn");
    return false;
  }
  if (fw.owner === "player") news(state, fw, `${cap(label(state, fw))} was destroyed by ${why}.${fw.kind === "stockpile" && Object.keys(fw.contents || {}).length ? ` What was there (${contentsText(fw)}) is lost.` : ""}`, "danger");
  else if (state.live && state.live.has(fw.tile)) log(state, `${ownerName(state, fw.owner)}'s ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)} was destroyed by ${why}.`, "info");
  removeWork(state, fw);
  return true;
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// The people posted at a structure that falls run for it: each hurt FIELD.HORDE.hurt of the time, killed `killed`.
function scatter(state, fw, killed = FIELD.HORDE.killed) {
  const lines = [];
  for (const s of postedAt(state, fw)) {
    if (state.rng.chance(killed)) { killSurvivor(state, s, fw.tile, `at the ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}`); lines.push(`${s.name} was killed`); continue; }
    if (state.rng.chance(FIELD.HORDE.hurt)) { hurt(state, s, state.rng.int(15, 40), fw.tile, `at the ${kindName(fw).toLowerCase()}`); lines.push(`${s.name.split(" ")[0]} got away hurt`); }
    else lines.push(`${s.name.split(" ")[0]} got away`);
  }
  recallAll(state, fw);
  return lines;
}

// ---------- hordes (hordes.js) ----------
// The roadblock's hold: hours a crowd at `rate` hp an hour takes to force a lane through it (ROADBLOCK.gap of its
// condition; at most `most` hours), and that damage: a fresh roadblock stands a lane forced through it, at 40%.
function holdOf(fw, rate, most, mult = 1) {
  const hours = Math.min(most, (mult * fw.hp * FIELD.ROADBLOCK.gap) / Math.max(0.5, rate)); // a lane forced through it: GAP of what stands (guarded: × guardHold, under fire)
  return { hours: r1(hours), dmg: r1((hours * rate) / mult) }; // the same lane cut, slower under the guards' fire
}
// The guards' or lookouts' shots at a horde: kills (at most `most` of it).
function shotsAtHorde(state, fw, h, most) {
  const shots = fw.owner === "player" ? onDuty(state, fw).reduce((a, s) => a + combatPower(s), 0) : (fw.kind === "tower" ? groupDuty(state, fw) : guards(state, fw)) * FIELD.TEAM.garPower;
  return Math.min(Math.floor(h.size * most), Math.round(shots * FIELD.HORDE.shot));
}
// A horde entered a tile (hordes.js onHordeEnter, before a base there): a roadblock holds it (h.move goes back; its
// guards shoot), spike traps cut it down, a manned tower's lookouts shoot from above, any structure is battered; a
// buried cache is left alone. Returns nothing.
export function hordeEnter(state, h) {
  const fw = fwAt(state, h.tile);
  if (!fw) return;
  if (fw.kind === "cache" && fw.built) return; // buried: the dead walk over it
  const power = hordeWallPower(h);
  const who = `a horde of about ${h.size}`;
  if (fw.kind === "spikes" && fw.built) { spikesHorde(state, fw, h); return; }
  if (fw.kind === "roadblock" && fw.built) {
    const g = guards(state, fw);
    const kills = g ? shotsAtHorde(state, fw, h, FIELD.ROADBLOCK.hordeShot) : 0;
    if (kills > 0) h.size -= kills;
    const rate = (FIELD.ROADBLOCK.hordeRate + h.size * FIELD.ROADBLOCK.hordePer) * (h.bosses ? 1.6 : 1);
    const hold = holdOf(fw, rate, FIELD.ROADBLOCK.hordeHold * (g ? FIELD.ROADBLOCK.guardHold : 1), g ? FIELD.ROADBLOCK.guardHold : 1);
    h.move = (h.move || 0) - hold.hours;
    if (fw.owner === "player") news(state, fw, `The roadblock at ${tileLabel(state, fw.tile)} holds ${who} for about ${Math.round(hold.hours)} hours${kills ? `; the guards shot down about ${kills}` : ""}.`, "warn");
    // The guards run for it when the dead will be through it.
    if (fw.owner === "player" && postedAt(state, fw).length && hold.dmg >= fw.hp) {
      const lines = scatter(state, fw);
      news(state, fw, `The guards fled ${label(state, fw)} before ${who}: ${lines.join(", ")}.`, "danger");
    }
    damageWork(state, fw, hold.dmg, who);
    return;
  }
  // Lookouts in a tower shoot down from it before it is battered.
  if (fw.kind === "tower" && fw.built) {
    const kills = shotsAtHorde(state, fw, h, 0.3);
    if (kills > 0) { h.size -= kills; if (fw.owner === "player") log(state, `The lookouts on the tower at ${tileLabel(state, fw.tile)} shot down about ${kills} of the dead.`, "info"); }
  }
  const dmg = FIELD.HORDE.base + power * FIELD.HORDE.per * (fw.kind === "tower" ? 0.7 : 1);
  // A structure about to fall: its people run for it first (hurt or killed by the dice).
  if (fw.built && fw.owner === "player" && dmg >= fw.hp && postedAt(state, fw).length) {
    const lines = scatter(state, fw);
    news(state, fw, `The lookouts fled ${label(state, fw)} before ${who}: ${lines.join(", ")}.`, "danger");
  }
  damageWork(state, fw, dmg, who);
}
// Spike traps under a horde: kills by its size × condition (none once sprung), worn by each crossing.
export const spikesLive = (fw) => !!fw && fw.built && condition(fw) >= FIELD.SPIKES.dead;
function spikesHorde(state, fw, h) {
  const S = FIELD.SPIKES;
  if (!spikesLive(fw)) return;
  const kills = Math.min(Math.floor(h.size * S.hordeMax), Math.round((S.horde + h.size * S.hordePer) * condition(fw)));
  if (kills > 0) h.size -= kills;
  fw.hp = Math.max(0, r1(fw.hp - (S.wear + kills * S.wearPer)));
  fw.hitHour = state.hour;
  fw.triggered = (fw.triggered || 0) + 1;
  if (fw.owner === "player") news(state, fw, `The spike traps at ${tileLabel(state, fw.tile)} caught a horde: about ${kills} of the dead down (${Math.round(condition(fw) * 100)}% left${spikesLive(fw) ? "" : ": sprung, reset them"}).`, spikesLive(fw) ? "info" : "warn");
}
// Spike traps under a hostile party: a share of its strength (× condition), an hour's hold; worn.
function spikesParty(state, fw, p, who) {
  const S = FIELD.SPIKES;
  if (!spikesLive(fw)) return;
  const share = S.party * condition(fw);
  p.strength = Math.max(0.5, r1((p.strength || 0) * (1 - share)));
  p.progress = (p.progress || 0) - S.hold * (p.vehicle ? 1 : 0.9);
  fw.hp = Math.max(0, r1(fw.hp - S.wear));
  fw.hitHour = state.hour;
  fw.triggered = (fw.triggered || 0) + 1;
  if (fw.owner === "player") news(state, fw, `${who} ran into the spike traps at ${tileLabel(state, fw.tile)} (about ${Math.round(share * 100)}% of their strength lost; the traps at ${Math.round(condition(fw) * 100)}%).`, "info");
  else if (state.live && state.live.has(fw.tile)) log(state, `${who} ran into ${ownerName(state, fw.owner)}'s spike traps at ${tileLabel(state, fw.tile)}.`, "info");
}

// ---------- AI parties (parties.js aiPartyHour) ----------
// An AI party entered a tile: a hostile roadblock holds it (its progress goes back, the roadblock takes the damage;
// its guards fight by the numbers); spike traps cut it down; a raid passing over a stockpile empties it (a buried
// cache is not seen). A raid on one of your bases notes the road it came by (base.raidRoads: the governor's
// roadblocks).
export function partyEnter(state, p, tile) {
  noteRaidRoad(state, p, tile);
  const fw = fwAt(state, tile);
  if (!fw || !fw.built || !partyHostile(state, fw, p)) return;
  const f = factionById(state, p.owner);
  const who = f && f.known ? f.name : p.owner === "outsider" ? "Raiders" : "A hostile party";
  if (fw.kind === "spikes") { spikesParty(state, fw, p, who); return; }
  if (fw.kind === "roadblock") {
    const R = FIELD.ROADBLOCK;
    const g = guards(state, fw);
    let fight = "";
    if (g) {
      // The guards shoot back: by the numbers (winOdds), from behind the cars and logs (ROADBLOCK.cover).
      const gp = garrisonPower(state, fw);
      const odds = winOdds(gp / Math.max(0.5, p.strength || 1), { people: Math.max(1, g), count: Math.max(1, Math.round((p.strength || 1) / 3)) });
      if (state.rng.chance(odds)) {
        p.strength = Math.max(0.5, r1((p.strength || 1) * (1 - R.shotWin)));
        if (fw.owner === "player") for (const s of onDuty(state, fw)) if (state.rng.chance(0.15)) hurt(state, s, state.rng.int(5, 20), fw.tile, "guarding the roadblock");
        fight = `; the guards shot back and cut them down by about ${Math.round(R.shotWin * 100)}%`;
        fwStat(state, fw.owner === "player" ? "guardWins" : "aiGuardWins");
      } else {
        p.strength = Math.max(0.5, r1((p.strength || 1) * (1 - R.shotLose)));
        if (fw.owner === "player") { const lines = scatter(state, fw, 0.1); fight = `; the guards were overrun (${lines.join(", ")})`; } else fw.gar = 0;
        fwStat(state, fw.owner === "player" ? "guardLosses" : "aiGuardLosses");
      }
    }
    const rate = R.partyRate + (p.strength || 1) * R.partyPer;
    const hold = holdOf(fw, rate, R.partyHold * (g ? R.guardHold : 1), g ? R.guardHold : 1);
    p.progress = (p.progress || 0) - hold.hours * (p.vehicle ? 1 : 0.9);
    if (fw.owner === "player") news(state, fw, `The roadblock at ${tileLabel(state, fw.tile)} holds up ${p.kind === "raid" ? "a raiding party" : "a hostile party"}${f && f.known ? ` of ${f.name}` : ""} for about ${Math.round(hold.hours)} hours${fight}.`, fight.includes("overrun") ? "danger" : "warn");
    else if (state.live && state.live.has(fw.tile)) log(state, `${cap(ownerName(state, fw.owner))}'s roadblock at ${tileLabel(state, fw.tile)} holds up ${who === "A hostile party" ? "a hostile party" : who}${fight}.`, "info");
    damageWork(state, fw, hold.dmg, f && f.known ? f.name : "raiders");
    return;
  }
  if (fw.kind === "stockpile" && p.kind === "raid" && Object.keys(fw.contents || {}).length) {
    const what = contentsText(fw);
    if (f) for (const [k, v] of Object.entries(fw.contents)) f.stock[k] = (f.stock[k] || 0) + v;
    fw.contents = {};
    if (fw.owner === "player") news(state, fw, `${f && f.known ? f.name : "Raiders"} on their way past emptied the stockpile at ${tileLabel(state, fw.tile)} (${what}).`, "danger");
    else if (state.live && state.live.has(fw.tile)) log(state, `${who} emptied ${ownerName(state, fw.owner)}'s stockpile at ${tileLabel(state, fw.tile)} on their way past.`, "info");
  }
}
// A raid on a base of yours notes the road it came in by: base.raidRoads = { tile: { n, last } } for the road tiles of
// the base's land within FIELD.RANGE it crossed (each raid once a tile).
function noteRaidRoad(state, p, tile) {
  if (p.kind !== "raid" || !p.target || p.target.kind !== "player") return;
  const base = baseById(state, p.target.baseId);
  const t = state.tiles[tile];
  if (!base || !t || !t.road || tile === base.tile || state.grid.distance(base.tile, tile) > FIELD.RANGE || !ownsTile(state, tile)) return;
  p.fwRoads = p.fwRoads || [];
  if (p.fwRoads.includes(tile)) return;
  p.fwRoads.push(tile);
  base.raidRoads = base.raidRoads || {};
  const r = base.raidRoads[tile] || (base.raidRoads[tile] = { n: 0, last: 0 });
  r.n++;
  r.last = day(state);
}
// A team of yours entered a tile: a group's roadblock stops it a while (hostile: FIELD.ROADBLOCK.teamHostile hours and
// the roadblock takes a beating; otherwise a checkpoint, teamCheck hours; allies wave it through); a hostile group's
// spike traps may hurt someone; a group's hidden cache may be spotted (CACHE.spot + the best scout's CACHE.spotPer).
export function teamEnter(state, p, tile, speed = 1) {
  const fw = fwAt(state, tile);
  if (!fw || !fw.built || fw.owner === "player") return;
  const f = factionById(state, fw.owner);
  if (!f || !f.alive) return;
  const att = attitude(f);
  if (fw.kind === "cache") {
    if (fw.found) return;
    const scout = Math.max(0, ...partyMembers(state, p).map((s) => skill(s, "scouting")));
    if (state.rng.chance(FIELD.CACHE.spot + scout * FIELD.CACHE.spotPer)) { fw.found = true; log(state, `The team found a hidden cache of ${f.known ? f.name : "a group"}'s at ${tileLabel(state, tile)} (${contentsText(fw)}).`, "good"); }
    return;
  }
  if (fw.kind === "spikes") {
    if (att !== "Hostile" || !spikesLive(fw)) return;
    const hurtOnes = [];
    for (const s of partyMembers(state, p)) if (state.rng.chance(FIELD.SPIKES.teamHurt * condition(fw))) { hurt(state, s, state.rng.int(5, 18), tile, "on spike traps"); hurtOnes.push(firstName(s)); }
    fw.hp = Math.max(0, r1(fw.hp - FIELD.SPIKES.wear));
    if (hurtOnes.length) log(state, `The team walked into ${f.known ? f.name : "a group"}'s spike traps at ${tileLabel(state, tile)}: ${hurtOnes.join(", ")} hurt.`, "danger");
    return;
  }
  if (fw.kind !== "roadblock") return;
  if (att === "Allied" || f.pact) return;
  const hostile = att === "Hostile";
  const hours = hostile ? FIELD.ROADBLOCK.teamHostile : FIELD.ROADBLOCK.teamCheck;
  p.progress = (p.progress || 0) - hours * speed;
  log(state, hostile ? `The team forced a way through ${f.known ? f.name : "a group"}'s roadblock at ${tileLabel(state, tile)} (${hours} hours).` : `${f.known ? f.name : "A group"}'s checkpoint at ${tileLabel(state, tile)} stopped the team for an hour of questions.`, "info");
  if (hostile) damageWork(state, fw, FIELD.ROADBLOCK.teamDamage, "your team");
}

// ---------- raids on field works ----------
// Once a day: a hostile group near a structure may send a small raid at it (an AI party, kind "fwraid"). Yours: a
// Hostile group (or an aggressive one that is not friendly, half as often) within RAID.range of it. A group's
// (AI parity): a group at war with its owner, or an aggressive raider that would raid them (diplomacy.js raidWeight:
// never a pact partner, a bloc mate or a fellow coalition member), half as often, × RAID.ai. A cache is
// RAID.cacheW as likely to be gone for (they would have to know of it).
export function raidChance(state, fw) {
  const R = FIELD.RAID;
  return Math.min(R.max, R.chance + (fw.kind === "stockpile" || fw.kind === "cache" ? stockKg(fw) * R.perKg : 0)) * (fw.kind === "cache" ? R.cacheW : 1);
}
export function raidersNear(state, fw) {
  const R = FIELD.RAID;
  const near = (f) => Math.min(...f.bases.map((b) => state.grid.distance(b, fw.tile)));
  const out = [];
  for (const f of state.factions) {
    if (!f.alive || !f.bases.length || f.pop < R.minPop || f.id === fw.owner) continue;
    let w = 0;
    if (fw.owner === "player") w = attitude(f) === "Hostile" ? 1 : isAggressiveType(f) && attitude(f) !== "Friendly" && attitude(f) !== "Allied" && !f.pact ? 0.5 : 0;
    else {
      const o = factionById(state, fw.owner);
      if (!o || !o.alive) continue;
      w = (state.diplo && warBetween(state, f, o) ? 1 : (FACTION_TYPES[f.type] && FACTION_TYPES[f.type].raid > 0 && raidWeight(state, f, o) > 0 ? 0.5 : 0)) * R.ai;
    }
    if (w <= 0) continue;
    const d = near(f);
    if (d <= R.range) out.push({ f, d, w });
  }
  return out.sort((a, b) => a.d - b.d || a.f.id - b.f.id);
}
function raidsDaily(state) {
  for (const fw of [...fwList(state)]) {
    if (!fw.built) continue;
    if (state.parties.some((p) => p.kind === "fwraid" && p.target && p.target.fw === fw.id)) continue;
    const today = day(state);
    const near = raidersNear(state, fw).filter((x) => today - (x.f.fwRaidDay ?? -999) >= FIELD.RAID.every); // one raid of theirs every RAID.every days at most
    if (!near.length) continue;
    const { f, w } = near[0];
    if (!state.rng.chance(raidChance(state, fw) * w)) continue;
    const p = sendFieldRaid(state, f, fw);
    if (p) { f.fwRaidDay = today; fwStat(state, fw.owner === "player" ? "raids" : "aiRaids"); }
  }
}
// A group's raid on a structure (also the tests). Returns the party or null.
export function sendFieldRaid(state, f, fw, strength = null) {
  const from = f.bases.slice().sort((a, b) => state.grid.distance(a, fw.tile) - state.grid.distance(b, fw.tile))[0];
  const str = strength ?? state.rng.int(FIELD.RAID.str[0], FIELD.RAID.str[1]) + Math.min(6, Math.floor(f.pop / 10));
  const p = spawnAiParty(state, f, "fwraid", from, fw.tile, { strength: str, target: { kind: "field", fw: fw.id, tile: fw.tile, factionId: f.id, owner: fw.owner } });
  return p;
}
// The garrison's power behind the structure (a tower's height × TOWER.perch; a roadblock's cars and logs × cover).
function garrisonPower(state, fw) {
  const base = fw.owner === "player" ? onDuty(state, fw).reduce((a, s) => a + combatPower(s), 0) : (fw.kind === "tower" ? groupDuty(state, fw) : fw.kind === "roadblock" ? guards(state, fw) : fw.gar || 0) * FIELD.TEAM.garPower;
  return base * (fw.kind === "tower" ? FIELD.TOWER.perch : fw.kind === "roadblock" ? FIELD.ROADBLOCK.cover : 1);
}
const garWord = (fw) => (fw.kind === "roadblock" ? "guards" : "lookouts");
// The raid is there (parties.js aiPartyHour, at the end of its path): the people on duty fight by the numbers; won,
// the raiders go home beaten; lost (or nobody there), they take the structure over (near their land, CAPTURE of the
// time; never a relay), or empty it and wreck it. A cache is found RAID.find of the time (else they go home with
// nothing). The groups' raids on each other's go the same way (logged where you see it).
export function fieldRaidArrive(state, p) {
  const fw = p.target ? fwById(state, p.target.fw) : null;
  const f = factionById(state, p.owner);
  removeParty(state, p);
  if (!fw || !f || fw.owner === f.id) return;
  const mine = fw.owner === "player";
  const seen = mine || (state.live && state.live.has(fw.tile));
  const who = f.known ? f.name : "Raiders";
  const whose = mine ? "" : `${cap(ownerName(state, fw.owner))}'s `;
  if (fw.kind === "cache" && !state.rng.chance(FIELD.RAID.find)) {
    if (mine) news(state, fw, `${who} searched round the cache at ${tileLabel(state, fw.tile)} and went home with nothing: it stayed hidden.`, "warn");
    fwStat(state, mine ? "hidden" : "aiHidden");
    return;
  }
  const gp = garrisonPower(state, fw);
  if (gp > 0) {
    const n = mine ? onDuty(state, fw).length : Math.max(1, fw.gar || 1);
    const odds = winOdds(gp / Math.max(0.5, p.strength), { people: Math.max(1, n), count: Math.max(1, Math.round(p.strength / 3)) });
    if (state.rng.chance(odds)) {
      if (mine) {
        for (const s of onDuty(state, fw)) if (state.rng.chance(0.25)) hurt(state, s, state.rng.int(8, 25), fw.tile, `holding the ${kindName(fw).toLowerCase()}`);
        news(state, fw, `${who} attacked ${label(state, fw)}; the ${garWord(fw)} drove them off.`, "warn");
      } else if (seen) log(state, `${who} attacked ${whose}${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)} and were driven off.`, "info");
      fwStat(state, mine ? "driven" : "aiDriven");
      damageWork(state, fw, 8, who);
      return;
    }
    if (mine) {
      const lines = scatter(state, fw, 0.15);
      news(state, fw, `${who} overran ${label(state, fw)}: ${lines.join(", ")}.`, "danger");
    } else fw.gar = 0;
  }
  if ((fw.kind === "stockpile" || fw.kind === "cache") && Object.keys(fw.contents || {}).length) {
    const what = contentsText(fw);
    for (const [k, v] of Object.entries(fw.contents)) f.stock[k] = (f.stock[k] || 0) + v;
    fw.contents = {};
    if (mine) news(state, fw, `${who} emptied the ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)} (${what}).`, "danger");
    else if (seen) log(state, `${who} emptied ${whose}${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}.`, "info");
  }
  const nearLand = Math.min(...f.bases.map((b) => state.grid.distance(b, fw.tile))) <= FIELD.RAID.near;
  if (fw.kind !== "relay" && nearLand && state.rng.chance(FIELD.RAID.capture)) {
    if (!mine && seen) log(state, `${who} took ${whose}${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}.`, "info");
    fwStat(state, mine ? "captured" : "aiCaptured");
    captureWork(state, fw, f.id);
    return;
  }
  // Otherwise they smash what they can in the time they have: RAID.dmg of its condition (a sound one is left standing,
  // one already damaged falls).
  const dmg = r1(fw.max * FIELD.RAID.dmg);
  fwStat(state, fw.hp - dmg <= 0 ? (mine ? "wrecked" : "aiWrecked") : mine ? "damaged" : "aiDamaged");
  if (!mine && seen && fw.hp - dmg > 0) log(state, `${who} raided ${whose}${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}.`, "info");
  damageWork(state, fw, dmg, who);
}
// A structure changes hands: the old garrison goes, the job queue drops it; a group's garrison of FIELD.AI.gar.
export function captureWork(state, fw, owner, baseId = null) {
  const was = fw.owner;
  recallAll(state, fw);
  delete fw.roster; // the shifts were yours
  delete fw.haul;
  delete fw.found;
  ensureFW(state).jobs = ensureFW(state).jobs.filter((j) => j.fw !== fw.id);
  fw.owner = owner;
  fw.captured = { from: was, hour: state.hour };
  fw.hp = Math.max(fw.hp, Math.round(fw.max * 0.4));
  if (owner === "player") {
    fw.baseId = baseId ?? nearestBase(state, fw.tile)?.id ?? null;
    fw.gar = 0;
    delete fw.baseTile;
  } else {
    const f = factionById(state, owner);
    fw.baseTile = f && f.bases.length ? f.bases.slice().sort((a, b) => state.grid.distance(a, fw.tile) - state.grid.distance(b, fw.tile))[0] : null;
    fw.gar = fw.kind === "tower" || fw.kind === "roadblock" ? FIELD.AI.gar : 0;
    fw.garrison = [];
    delete fw.baseId;
  }
  if (was === "player") news(state, fw, `${ownerName(state, owner) === "a group" ? "A group" : ownerName(state, owner)} took ${label(state, fw)} from you. Send a team to take it back (Capture).`, "danger");
  else if (owner === "player") log(state, `Your team took ${label(state, fw)} from ${ownerName(state, was)}.`, "good");
}
const nearestBase = (state, tile) => state.bases.slice().sort((a, b) => state.grid.distance(a.tile, tile) - state.grid.distance(b.tile, tile))[0] || null;

// ---------- your teams at a structure (orders.js "fwork") ----------
// What a team can do here: [{ act, label, hours, why, hint }].
export function teamActs(state, p, tile) {
  const fw = fwAt(state, tile);
  if (!fw) return [];
  const T = FIELD.TEAM;
  const out = [];
  if (fw.owner === "player") {
    if (fw.kind === "stockpile" && fw.built) {
      out.push({ act: "load", label: `Load from the stockpile (${T.load}h)`, hours: T.load, why: Object.keys(fw.contents || {}).length ? (cargoRoom(state, p) < 1 ? "No room to carry anything." : "") : "The stockpile is empty.", hint: `Take what is there (${contentsText(fw)}) as far as there is room; bring it home.` });
      out.push({ act: "unload", label: `Leave finds at the stockpile (${T.unload}h)`, hours: T.unload, why: stockRoom(fw) < 1 ? "The stockpile is full." : "", hint: "Leave what the team found (scrap, parts, materials, firewood…) here for a haul team; it keeps its food, water, meds and ammo." });
    }
    if (fw.kind === "cache" && fw.built) {
      out.push({ act: "draw", label: `Take supplies from the cache (${T.load}h)`, hours: T.load, why: Object.keys(fw.contents || {}).length ? (cargoRoom(state, p) < 1 ? "No room to carry anything." : "") : "The cache is empty.", hint: `Fuel, food, water, meds and ammo into the team's supplies, as far as there is room (${contentsText(fw)}).` });
      out.push({ act: "stash", label: `Leave supplies in the cache (${T.unload}h)`, hours: T.unload, why: stockRoom(fw) < 1 ? "The cache is full." : "", hint: "Leave the fuel, food, water, meds and ammo the team carries as cargo (not its own packs) for a later team." });
    }
    if (fw.kind === "snares" && fw.built) out.push({ act: "check", label: `Check the snare line (${T.check}h)`, hours: T.check, why: "", hint: `Take the catch (${snareHeldText(fw)}) into the cargo; the line stays set.` });
    return out;
  }
  if (fw.kind === "cache" && !fw.found) return []; // a group's hidden cache: not found yet (teamEnter)
  const f = factionById(state, fw.owner);
  const gar = fw.gar || 0;
  const fight = gar ? ` (${gar} on guard: a fight)` : "";
  const gw = f && attitude(f) !== "Hostile" ? ` Goodwill ${T.gw} with ${f.known ? f.name : "them"}.` : "";
  out.push({ act: "destroy", label: `Wreck their ${kindName(fw).toLowerCase()} (${T.destroy}h)${fight}`, hours: T.destroy, why: fw.built ? "" : "Not built yet.", hint: `Pull it down and burn what is left.${gw}` });
  if (fw.kind !== "relay") out.push({ act: "capture", label: `Take their ${kindName(fw).toLowerCase()} (${T.capture}h)${fight}`, hours: T.capture, why: !fw.built ? "Not built yet." : !state.bases.length ? "You have no base to hold it from." : "", hint: `It becomes yours, held from your nearest base${fw.kind === "tower" ? " (post lookouts there from its Field works tab)" : ""}.${gw}` });
  if (fw.kind === "snares" && fw.built) out.push({ act: "rob", label: `Rob their snare line (${T.check}h)`, hours: T.check, why: snareHeld(fw) ? "" : "Nothing in the snares.", hint: `Take the catch (${snareHeldText(fw)}).${gw}` });
  if ((fw.kind === "stockpile" || fw.kind === "cache") && Object.keys(fw.contents || {}).length) out.push({ act: "loot", label: `Take the goods in their ${kindName(fw).toLowerCase()} (${T.load}h)${fight}`, hours: T.load, why: cargoRoom(state, p) < 1 ? "No room to carry anything." : "", hint: `${contentsText(fw)}.${gw}` });
  return out;
}
export function teamActProblem(state, p, act) {
  const a = teamActs(state, p, partyTile(p)).find((x) => x.act === act);
  if (!a) return "Nothing of that kind here.";
  return a.why;
}
export const teamActHours = (act) => (act === "destroy" ? FIELD.TEAM.destroy : act === "capture" ? FIELD.TEAM.capture : act === "unload" || act === "stash" ? FIELD.TEAM.unload : act === "check" || act === "rob" ? FIELD.TEAM.check : FIELD.TEAM.load);
// The task is done (orders.js finishTask). Returns the line.
export function teamActDone(state, p, act) {
  const tile = partyTile(p);
  const fw = fwAt(state, tile);
  if (!fw) return "The field work is gone.";
  if (act === "load" && fw.owner === "player") return loadFromStockpile(state, p, fw);
  if (act === "unload" && fw.owner === "player") return unloadToStockpile(state, p, fw);
  if (act === "draw" && fw.owner === "player") return drawFromCache(state, p, fw);
  if (act === "stash" && fw.owner === "player") return stashInCache(state, p, fw);
  if (act === "check" && fw.owner === "player") return takeSnares(state, fw, { party: p });
  if (fw.owner === "player") return "It is yours already.";
  const f = factionById(state, fw.owner);
  // Their guard first, by the numbers.
  if ((fw.gar || 0) > 0) {
    const members = partyMembers(state, p);
    const mine = members.reduce((a, s) => a + combatPower(s), 0);
    const odds = winOdds(mine / Math.max(0.5, garrisonPower(state, fw)), { people: members.length, count: fw.gar });
    if (!state.rng.chance(odds)) {
      for (const s of members) if (state.rng.chance(0.5)) hurt(state, s, state.rng.int(10, 30), tile, `attacking a ${kindName(fw).toLowerCase()}`);
      return `The guards at their ${kindName(fw).toLowerCase()} drove the team off. ${members.map((s) => `${s.name.split(" ")[0]} ${Math.floor(s.health)}`).join(", ")}.`;
    }
    fw.gar = 0;
  }
  if (f && f.alive && attitude(f) !== "Hostile") changeGoodwill(state, f, FIELD.TEAM.gw, `your team hit their ${kindName(fw).toLowerCase()}`);
  if (act === "rob") return takeSnares(state, fw, { party: p, rob: true });
  if (act === "loot") {
    if (!p.cargo) p.cargo = { supplies: {}, gear: [] };
    const got = [];
    for (const [k, q] of Object.entries(fw.contents || {})) {
      const fits = Math.min(q, Math.floor(cargoRoom(state, p) / (SUPPLIES[k] ? SUPPLIES[k].weight : 1)));
      if (fits <= 0) continue;
      p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + fits;
      fw.contents[k] = q - fits;
      if (fw.contents[k] <= 0) delete fw.contents[k];
      got.push(`${fits} ${matName(k, fits)}`);
    }
    return got.length ? `The team took ${got.join(", ")} from their ${kindName(fw).toLowerCase()}.` : "No room for any of it.";
  }
  if (act === "capture") {
    const base = nearestBase(state, tile);
    captureWork(state, fw, "player", base ? base.id : null);
    return `The ${kindName(fw).toLowerCase()} is yours, held from ${base ? base.name : "your nearest base"}.`;
  }
  const name = kindName(fw).toLowerCase();
  removeWork(state, fw);
  return `The team wrecked ${f && f.known ? `${f.name}'s` : "their"} ${name}.`;
}

// ---------- the groups' own (AI parity) ----------
// Every FIELD.AI.every days a group may put one up near its main base (coarse, paid from its stores, standing after
// FIELD.AI.work days): groupWants. Daily: repairs from scrap; guards on their towers and roadblocks once they have the
// people (AI.gar: 2, round the clock; 1 by day); their stockpile fills with what their outdoor people drop there
// (AI.pileDaily kg a person, out of their stores) and goes home every AI.haulEvery days (not while hostile people or
// the dead stand on it); they draw on their stockpiles and caches when short (food under AI.short days a person, fuel
// or ammo run out); their snare lines' catch (snareLinesDaily) and their blinds' game (BLIND.groupFood) feed them.
// At most max[0] + people / max[1], up to max[2].
export function groupFieldDaily(state) {
  const A = FIELD.AI;
  for (const f of state.factions) {
    if (!f.alive || !f.bases.length) continue;
    const mine = groupWorks(state, f);
    for (const fw of mine) {
      if (!fw.built && day(state) >= (fw.readyDay || 0)) { fw.built = true; fw.hp = fw.max; if (garrisonCap(fw) && f.pop >= A.garPop) fw.gar = A.gar; }
      if (fw.built && garrisonCap(fw) && !fw.gar && f.pop >= A.garPop && state.rng.chance(0.3)) fw.gar = A.gar;
      if (fw.built && fw.hp < fw.max && (f.stock.scrap || 0) >= 4) { f.stock.scrap -= 2; fw.hp = Math.min(fw.max, fw.hp + fw.max * 0.25); }
      if (fw.built) groupStores(state, f, fw);
    }
    if ((day(state) + localId(state, f.id)) % A.every !== 0) continue; // localId: the same days in a replay of the seed
    const maxN = Math.min(A.max[2], A.max[0] + Math.floor(f.pop / A.max[1]));
    if (mine.length >= maxN) continue;
    const pick = groupWants(state, f, mine);
    if (!pick) continue;
    const cost = { scrap: Math.ceil((K[pick.kind].cost.scrap || 0) * 0.6), parts: K[pick.kind].cost.parts ? 1 : 0 };
    if ((f.stock.scrap || 0) < cost.scrap + 5 || (f.stock.parts || 0) < cost.parts) continue;
    f.stock.scrap -= cost.scrap;
    if (cost.parts) f.stock.parts -= cost.parts;
    buildGroupWork(state, f, pick.kind, pick.tile, false);
  }
}
// A group's stockpile or cache, and its blind, for the day (groupFieldDaily).
function groupStores(state, f, fw) {
  const A = FIELD.AI;
  if (fw.kind === "blind") { f.stock.food = (f.stock.food || 0) + FIELD.BLIND.groupFood; return; }
  if (fw.kind !== "stockpile" && fw.kind !== "cache") return;
  if (threatOn(state, fw.tile)) return; // hostile people or the dead on it: nobody goes near
  const c = fw.contents || (fw.contents = {});
  const move = (k) => { if ((c[k] || 0) > 0) { f.stock[k] = (f.stock[k] || 0) + c[k]; delete c[k]; return true; } return false; };
  // Short: into the stores.
  let drew = false;
  if ((f.stock.food || 0) < f.pop * A.short) drew = move("food") || drew;
  for (const k of ["fuel", "ammo"]) if ((f.stock[k] || 0) < 1) drew = move(k) || drew;
  if (drew) { fw.drawn = day(state); fwStat(state, "aiDrawn"); }
  if (fw.kind !== "stockpile") return;
  // Their outdoor people drop goods here: AI.pileDaily kg a person (scrap, food, firewood), out of their stores.
  const kg = Math.min(stockRoom(fw), f.pop * A.pileDaily);
  if (kg >= 1) for (const [k, share] of [["scrap", 0.5], ["food", 0.3], ["wood", 0.2]]) {
    if (!SUPPLIES[k] || (k === "food" && (f.stock.food || 0) < f.pop * A.short * 2)) continue; // none of their food while it runs short
    const q = Math.min(Math.floor((kg * share) / SUPPLIES[k].weight), Math.floor((f.stock[k] || 0) * 0.1));
    if (q > 0) { f.stock[k] -= q; c[k] = (c[k] || 0) + q; }
  }
  // Hauled home now and then.
  if ((day(state) + localId(state, f.id) + fw.tile) % A.haulEvery === 0 && Object.keys(c).length) {
    const what = contentsText(fw);
    for (const k of Object.keys(c)) move(k);
    fw.hauled = day(state);
    fwStat(state, "aiHauls");
    if (state.live && state.live.has(fw.tile)) log(state, `${f.known ? f.name : "A group"} hauled their stockpile at ${tileLabel(state, fw.tile)} home (${what}).`, "info");
  }
}
// Puts a group's structure on a tile (now: built; else ready in FIELD.AI.work days). Also the tests.
export function buildGroupWork(state, f, kind, tile, now = true) {
  const def = K[kind];
  const fw = { id: newId(), kind, tile, owner: f.id, baseTile: f.bases[0], hp: def.hp, max: def.hp, built: !!now, readyDay: day(state) + FIELD.AI.work, garrison: [], gar: now && garrisonCap({ kind }) ? FIELD.AI.gar : 0, contents: {}, since: state.hour };
  if (kind === "stockpile" || kind === "cache") {
    // A share of their stores goes out there (a forward cache), within its room.
    const keys = kind === "cache" ? ["fuel", "ammo", "food"] : ["food", "scrap", "ammo", "fuel"];
    for (const k of keys) {
      const put = Math.min(Math.floor((f.stock[k] || 0) * (kind === "cache" ? FIELD.AI.cache : FIELD.AI.stock)), Math.floor(stockRoomOf(fw) / SUPPLIES[k].weight));
      if (put > 0) { fw.contents[k] = (fw.contents[k] || 0) + put; f.stock[k] -= put; }
    }
  }
  if (kind === "well") {
    const y = wellYield(state, tile);
    fw.well = { yield: y, left: WELL_LEFT.max, start: WELL_LEFT.max, dug: state.hour };
  }
  ensureFW(state).list.push(fw);
  if (kind !== "cache" && state.live && state.live.has(tile)) log(state, `${f.known ? f.name : "A group"} ${now ? "put up" : "is putting up"} a ${def.name.toLowerCase()} at ${tileLabel(state, tile)}.`, "info");
  return fw;
}
const stockRoomOf = (fw) => Math.max(0, (K[fw.kind].capKg || 0) - kgIn(fw.contents));
// What a group would put up next, and where: { kind, tile } or null. In order: a tower when threatened, a well while
// its water is short, a stockpile when its stores are big, a roadblock on a road through its land (aggressive), spike
// traps toward the dead when a horde is near, a snare line while food is short, a blind beside it, a cache (an
// aggressive group with fuel and ammo to hide).
export function groupWants(state, f, mine = groupWorks(state, f)) {
  const has = (k) => mine.some((x) => x.kind === k);
  const main = f.bases[0];
  const land = state.grid.within(main, 2).filter((id) => id !== main && state.tiles[id].owner === f.id && state.tiles[id].terrain !== "water" && !state.tiles[id].hive && !fwAt(state, id) && !state.bases.some((b) => b.tile === id) && !state.factions.some((o) => o.alive && o.bases.includes(id)));
  if (!land.length) return null;
  const g = state.grid;
  const hordeNear = state.hordes.filter((h) => g.distance(h.tile, main) <= 6).sort((a, b) => g.distance(a.tile, main) - g.distance(b.tile, main))[0] || null;
  const threat = !!hordeNear || state.factions.some((o) => o !== f && o.alive && isAggressiveType(o) && o.bases.some((b) => g.distance(b, main) <= 12)) || state.bases.some((b) => g.distance(b.tile, main) <= 8 && attitude(f) === "Hostile");
  const pickBy = (fn, from = land) => from.slice().sort((a, b) => fn(b) - fn(a) || a - b)[0];
  if (!has("tower") && threat) return { kind: "tower", tile: pickBy((id) => g.distance(id, main) * 10 + (state.tiles[id].terrain === "hills" ? 5 : 0)) };
  if (!has("well") && (f.stock.water == null || (f.stock.water || 0) < f.pop * 3)) { const t = pickBy((id) => wellYield(state, id)); if (wellYield(state, t) > 0) return { kind: "well", tile: t }; }
  if (!has("stockpile") && ((f.stock.scrap || 0) + (f.stock.food || 0)) > f.pop * 20) return { kind: "stockpile", tile: pickBy((id) => -g.distance(id, main)) };
  if (!has("roadblock") && isAggressiveType(f)) { const roads = land.filter((id) => state.tiles[id].road); if (roads.length) return { kind: "roadblock", tile: roads.sort((a, b) => g.distance(b, main) - g.distance(a, main) || a - b)[0] }; }
  if (!has("spikes") && hordeNear) return { kind: "spikes", tile: pickBy((id) => -g.distance(id, hordeNear.tile) * 10 + g.distance(id, main)) };
  const game = land.filter((id) => K.snares.terrain.includes(state.tiles[id].terrain));
  if (!has("snares") && game.length && (f.stock.food || 0) < f.pop * 10) return { kind: "snares", tile: pickBy((id) => GAME_TERRAIN[state.tiles[id].terrain] || 0, game) };
  if (!has("blind") && has("snares") && game.length) return { kind: "blind", tile: pickBy((id) => (GAME_TERRAIN[state.tiles[id].terrain] || 0) * 10 + g.distance(id, main), game) };
  if (!has("cache") && isAggressiveType(f) && (f.stock.fuel || 0) + (f.stock.ammo || 0) * 0.05 > 20) return { kind: "cache", tile: pickBy((id) => g.distance(id, main) * 10 - (state.tiles[id].road ? 5 : 0)) };
  return null;
}
// A group's manned towers near a base add to its defence (factions.js resolveRaidOnFaction via groupworks.js): ×.
export function groupFieldDefence(state, f, tile) {
  const n = fwList(state).filter((fw) => fw.owner === f.id && fw.kind === "tower" && fw.built && (fw.gar || 0) > 0 && state.grid.distance(fw.tile, tile) <= 3).length;
  return 1 + 0.1 * Math.min(2, n);
}
// A group's field wells (groupworks.js provisioned): wells that count as built water works.
export const groupFieldWells = (state, f) => fwList(state).filter((fw) => fw.owner === f.id && fw.kind === "well" && fw.built).length;

// ---------- the governor and a base's leader (autopilot.js governBase) ----------
// Modest: repairs to anything below FIELD.GOV.repairAt (spike traps reset); one new structure at a time: a well when
// the water runs short, a tower when the base is threatened, a roadblock on a road raids keep coming down (the same road
// tile in base.raidRoads at least GOV.roadRaids times), a stockpile out by the scavengers' and foragers' far ground
// (GOV.pileHands of them working 2 tiles out, no stockpile of the base nearer them than the walls; with a running
// vehicle a standing haul order every GOV.pileEvery days, else a haul on foot once it holds 150 kg). People on the
// shifts: tower lookouts while threatened (one at a base of GOV.garrisonPop, two at twice that), roadblock guards while
// a raid on the base is on its way or the road has seen raids and the base is threatened. Returns the lines said.
export function govFieldWorks(state, base, { threatened = false, waterShort = false } = {}) {
  const lines = [];
  if (!base || maxWorks(base) <= 0) return lines;
  const mine = playerWorks(state, base);
  const n = atBase(state, base.id).length + mine.reduce((a, fw) => a + postedAt(state, fw).length, 0);
  const busy = jobsOf(state, base).length > 0;
  const pickTile = (kind, score, only = null) => placeTiles(state, base, kind).filter((x) => (!only || only(x.tile)) && !placeProblem(state, base, kind, x.tile)).sort((a, b) => score(b.tile) - score(a.tile) || a.tile - b.tile)[0];
  let planned = busy;
  const plan = (kind, t) => { if (planned || !t) return; const r = planFieldWork(state, base, kind, t.tile); if (!r.error) { lines.push(r.text); planned = true; } };
  // Repairs first.
  for (const fw of mine) if (fw.built && condition(fw) < FIELD.GOV.repairAt && !jobFor(state, fw)) { const r = queueRepair(state, fw.id); if (!r.error) lines.push(r.text); }
  if (!mine.some((x) => x.kind === "well") && waterShort) {
    const t = pickTile("well", (id) => wellYield(state, id) * 10 - state.grid.distance(base.tile, id));
    if (t && wellYield(state, t.tile) >= 4) plan("well", t);
  }
  if (threatened && n >= FIELD.GOV.towerPop && !mine.some((x) => x.kind === "tower")) plan("tower", pickTile("tower", (id) => state.grid.distance(base.tile, id) * 10 + (state.tiles[id].terrain === "hills" ? 5 : 0)));
  // A roadblock on the road the raids keep using.
  const road = raidRoad(state, base);
  if (road != null && !mine.some((x) => x.kind === "roadblock" && x.tile === road)) plan("roadblock", pickTile("roadblock", (id) => -state.grid.distance(id, road) * 10 + state.grid.distance(id, base.tile), (id) => state.grid.distance(id, road) <= 1 && (base.raidRoads[id] ? base.raidRoads[id].n : 0) >= 1));
  // A stockpile by the far crews.
  const far = farCrewTile(state, base);
  if (far != null && !dropPointsFor(state, base, far).some((d) => state.grid.distance(d.tile, far) < state.grid.distance(base.tile, far))) {
    plan("stockpile", pickTile("stockpile", (id) => -state.grid.distance(id, far) * 10 - state.grid.distance(id, base.tile), (id) => state.grid.distance(id, far) < state.grid.distance(base.tile, far)));
  }
  // The stockpiles' hauling: a standing order with a vehicle; else on foot once it is heavy.
  for (const fw of mine.filter((x) => x.kind === "stockpile" && x.built)) {
    const car = state.vehicles.some((v) => v.loc.kind === "base" && v.loc.baseId === base.id && v.condition > 0 && !v.count && (v.fuel || 0) >= 2);
    if (car && !fw.haul) lines.push(setHaul(state, fw, FIELD.GOV.pileEvery, 120));
    else if (!car && stockKg(fw) >= 150 && !underAttack(state, base) && !state.parties.some((q) => q.haulFor === fw.id)) { const r = sendHaul(state, fw.id); if (!r.error) lines.push(r.text); }
  }
  // People on the shifts.
  const raidOn = state.parties.some((q) => q.kind === "raid" && q.target && q.target.kind === "player" && q.target.baseId === base.id);
  const wantFor = (fw) => {
    const two = n >= FIELD.GOV.garrisonPop * 2 ? 2 : n >= FIELD.GOV.garrisonPop ? 1 : 0;
    if (fw.kind === "tower") return threatened ? two : 0;
    if (fw.kind === "roadblock") return raidOn || (threatened && base.raidRoads && base.raidRoads[fw.tile]) ? two : 0;
    return 0;
  };
  for (const fw of mine.filter((x) => garrisonCap(x) && x.built)) {
    const want = wantFor(fw);
    const have = rosterIds(fw);
    if (have.length < want) {
      const busyIds = new Set(fwList(state).flatMap((x) => rosterIds(x)));
      const sk = fw.kind === "tower" ? "scouting" : "shooting";
      const pick = atBase(state, base.id).filter((s) => !busyIds.has(s.id) && !healthRest(s) && !s.pinned && !s.leader && s.role !== "medic" && s.role !== "build").sort((a, b) => skill(b, sk) - skill(a, sk) || a.id - b.id)[0];
      if (pick) { const r = postPerson(state, fw.id, pick.id); if (!r.error) lines.push(r.text); }
    } else if (have.length > want) for (const id of have.slice(want)) { const t = recallPerson(state, id, "the danger has passed"); if (t) lines.push(t); }
  }
  return lines;
}
// The road tile of the base's land the raids keep coming down (base.raidRoads: the most raids, at least GOV.roadRaids),
// or null.
export function raidRoad(state, base) {
  const R = base && base.raidRoads;
  if (!R) return null;
  const best = Object.entries(R).map(([t, r]) => ({ t: Number(t), n: r.n })).filter((x) => x.n >= FIELD.GOV.roadRaids && state.tiles[x.t] && state.tiles[x.t].road)
    .sort((a, b) => b.n - a.n || state.grid.distance(b.t, base.tile) - state.grid.distance(a.t, base.tile) || a.t - b.t)[0];
  return best ? best.t : null;
}
// The tile the base's scavengers or foragers go to (jobtrips.js tripTarget) when it is 2 tiles out and GOV.pileHands of
// them work it, or null.
export function farCrewTile(state, base) {
  const best = [];
  for (const job of ["scavenge", "forage"]) {
    const n = atBase(state, base.id).filter((s) => s.role === job).length;
    if (n < FIELD.GOV.pileHands) continue;
    const t = tripTarget(state, base, job);
    if (t && t.d >= 2) best.push({ tile: t.at, n });
  }
  best.sort((a, b) => b.n - a.n || a.tile - b.tile);
  return best.length ? best[0].tile : null;
}

// ---------- the hour and the day ----------
// Hourly (world.js tickHour, after the parties and hordes move): garrisons tidied (dead, moved, a structure gone), the
// shifts walk out and home (rosterHour), people at a structure with enemies on it come home; in the morning the
// snare lines are checked (HAUL.hour − 1) and the standing haul orders run (HAUL.hour).
export function fieldworksHour(state) {
  if (!state.fieldworks) return;
  for (const fw of fwList(state)) {
    if (fw.owner !== "player" || !fw.garrison || !fw.garrison.length) continue;
    fw.garrison = fw.garrison.filter((id) => { const s = survivorById(state, id); return s && s.alive && s.location && s.location.kind === "post" && s.location.fw === fw.id; });
  }
  // Anyone on a post whose structure is gone, or whose base is gone, comes home.
  for (const s of alive(state)) if (onPost(s) && !fwById(state, s.location.fw)) sendHome(state, null, s);
  // Hostiles camped on a structure: its people come home (they go out again once it is clear).
  for (const fw of fwList(state)) if (fw.owner === "player" && fw.garrison && fw.garrison.length && threatOn(state, fw.tile) && !state.hordes.some((h) => h.tile === fw.tile)) {
    const lines = recallAll(state, fw, `enemies at the ${kindName(fw).toLowerCase()}`);
    if (lines.length) news(state, fw, `The ${garWord(fw)} left the ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}: enemies there.`, "warn");
  }
  rosterHour(state);
  const h = hourOfDay(state);
  if (h === FIELD.HAUL.hour - 1) snareCheckHour(state);
  if (h === FIELD.HAUL.hour) haulHour(state);
}
// Daily (world.js, with the groups): relays' upkeep, the raids on structures, the groups' own building, the snare
// lines' day, structures whose base is gone (held from your nearest base, or abandoned with none), hordes drawn to lit
// towers.
export function fieldworksDaily(state) {
  if (!state.fieldworks && !state.factions.some((f) => f.alive)) return;
  ensureFW(state);
  for (const fw of [...fwList(state)]) {
    if (fw.owner === "player" && !baseById(state, fw.baseId)) {
      const b = nearestBase(state, fw.tile);
      if (b && state.grid.distance(b.tile, fw.tile) <= FIELD.RANGE + 2) fw.baseId = b.id;
      else { removeWork(state, fw); continue; }
    }
    if (typeof fw.owner === "number") {
      const f = factionById(state, fw.owner);
      if (!f || !f.alive || !f.bases.length) { removeWork(state, fw); continue; }
    }
  }
  relayUpkeep(state);
  raidsDaily(state);
  groupFieldDaily(state);
  snareLinesDaily(state);
  // A manned tower's fire and voices draw a roaming horde within 3 tiles now and then.
  for (const fw of fwList(state)) {
    if (fw.kind !== "tower" || !fw.built || (fw.owner === "player" ? !rosterIds(fw).length && !postedAt(state, fw).length : !(fw.gar > 0))) continue;
    for (const h of state.hordes) if ((h.role === "roam" || h.role === "border") && state.grid.distance(h.tile, fw.tile) <= 3 && h.tile !== fw.tile && state.rng.chance(0.15)) { h.target = fw.tile; h.path = null; }
  }
}

// ---------- help (ui/help.js "Field works"; ui/codex.js) ----------
// The Help topic, built from the numbers above so it never drifts from them.
export function fieldWorksHelp() {
  const R = FIELD.ROADBLOCK, T = FIELD.TOWER, Rd = FIELD.RAID;
  const kinds = FIELD.ORDER.map((k) => { const d = K[k]; return `<tr><td>${d.icon}</td><td><b>${d.name}</b><br><span class="muted">${costText(d.cost)}; ${d.hours} work-hours + the walk; condition ${d.hp}${d.req ? "; a Mechanics 3+ survivor" : ""}</span></td><td>${d.desc}</td></tr>`; }).join("");
  return `Structures a base puts up on the land it holds outside its walls: open a base's <b>Field works</b> tab, pick a kind and click a green tile on the map (at most ${FIELD.RANGE} tiles out, on the base's own ground or a claim of yours; a hub keeps ${FIELD.MAX.hub}, an outpost ${FIELD.MAX.outpost}, a shelter ${FIELD.MAX.shelter}, a camp none). The materials leave the stores when you place it; the base's builders walk out and put it up (their hours include the walk, ${FIELD.WALK.pace} h a tile each way), sharing their time with the base's own building queue.
    <table class="helptable">${kinds}</table>
    <b>Lookouts and guards on shifts.</b> A watch tower's lookouts and a roadblock's guards stand shifts, like the base's watch roster: pick how the day is split (${Object.values(FIELD.SHIFTS).map((x) => x.name.toLowerCase()).join(", ")}) and who stands each shift (up to ${garrisonCap({ kind: "tower" })} a shift). They walk out for their shift (leaving early by the walk, so the one coming relieves the one going) and come home after it to eat and sleep; off duty they work at the base like anyone. A night shift keeps them up: they sleep in after it. The strip under the shifts shows each hour of the day: red hours nobody covers (an empty shift, someone hurt, ill, away or in a bed). One person on each of two 12-hour shifts keeps a tower watched round the clock. A manned tower shows ${T.day} tiles round it by day and ${T.night} at night, live on the map (hover or select it for the ring), and its lookouts warn the base of raids and hordes they see. A guarded roadblock holds ${R.guardHold}× as long and the guards shoot back.<br><br>
    <b>Threats.</b> A horde entering a structure's tile batters it (a roadblock holds it while it forces a lane: up to ${R.hordeHold} hours, the lookouts or guards shoot down some of it first; spike traps cut it down instead; a buried cache is left alone). A hostile group within ${Rd.range} tiles may send a small raid at one (about ${Math.round(Rd.chance * 100)}% a day for each structure while one is near, more for a full stockpile, half for an aggressive group that is not Hostile, ${Math.round(Rd.cacheW * 100)}% as often for a cache, which they find only ${Math.round(Rd.find * 100)}% of the time). The people on duty fight it by the numbers; if they lose or nobody is there, the raiders take it over when it is within ${Rd.near} tiles of their land (${Math.round(Rd.capture * 100)}% of the time) or empty it and wreck it. Raiders passing over a stockpile empty it. The groups raid each other's structures by the same rules (war enemies, and aggressive groups their neighbours); you see it where you have eyes. Send a team to take one back (Capture), or to wreck, take or loot a group's.<br><br>
    <b>Repairs.</b> Damaged ones show a 🔧 on the map and an alert. Repair from the tab (materials by the damage, about ${Math.round(FIELD.REPAIR.share * 100)}% of the cost for a wreck; the builders walk out), or Repair all. Spike traps are reset the same way once sprung (under ${Math.round(FIELD.SPIKES.dead * 100)}%); a robbed snare line's wires too.<br><br>
    <b>Hauling.</b> Outdoor workers drop their loads at a stockpile out past them; Send a haul team brings it in (two people, the base's best running vehicle if there is one), or set a standing order on the stockpile: every few days, or once it holds enough (with a vehicle; skipped under attack, with no vehicle or nobody fit, and tried again the next day). A fuel cache is the other way round: the builders carry supplies out (Restock) and teams on the road take them.<br><br>
    <b>The groups</b> build their own (towers when threatened, wells, stockpiles, roadblocks, spike traps, snare lines, blinds and hidden caches), guard them, draw on their stockpiles and caches when short and haul them home now and then. The governor (and a base steward) repairs, digs a well when water runs short, puts up a tower when threatened and staffs its shifts, a roadblock on a road raids have come down ${FIELD.GOV.roadRaids}+ times, and a stockpile out by scavengers or foragers working 2 tiles out (with a standing haul order when there is a vehicle).`;
}

// ---------- text ----------
export function fwStatusText(state, fw) {
  const bits = [];
  if (!fw.built) { const j = jobFor(state, fw); bits.push(j ? `going up: ${Math.round((j.progress / j.hours) * 100)}%` : "a site"); }
  else {
    bits.push(`condition ${Math.round(condition(fw) * 100)}%`);
    if (fw.kind === "tower") bits.push(fw.owner === "player" ? (rosterIds(fw).length ? `${rosterIds(fw).length} on its shifts, ${manned(state, fw) ? `${lookouts(state, fw)} watching now` : "dark now"}` : "unmanned: sees nothing") : `${fw.gar || 0} on guard`);
    if (fw.kind === "roadblock") bits.push(fw.owner === "player" ? (rosterIds(fw).length ? `${rosterIds(fw).length} on its shifts, ${guards(state, fw) ? `${guards(state, fw)} on guard now` : "unguarded now"}` : "unguarded") : fw.gar ? `${fw.gar} on guard` : "unguarded");
    if (fw.kind === "snares") bits.push(`${snaresWork(fw) ? `about ${snareExpect(state, fw)} small game a day` : "torn: catches nothing until repaired"} · in the snares: ${snareHeldText(fw)}`);
    if (fw.kind === "blind") bits.push(`hunters here find ×${FIELD.BLIND.mult} game`);
    if (fw.kind === "cache") bits.push(`${stockKg(fw)}/${K.cache.capKg} kg: ${contentsText(fw)}${fw.owner !== "player" && !fw.found ? " (hidden)" : ""}`);
    if (fw.kind === "spikes") bits.push(spikesLive(fw) ? `set${fw.triggered ? ` (sprung ${fw.triggered}×)` : ""}` : "sprung: reset them (Repair)");
    if (fw.kind === "well" && fw.well) bits.push(fw.well.left <= 0 ? "dry" : `${wellRate(state, fw.well)} water a day, ${Math.round(fw.well.left)} left`);
    if (fw.kind === "stockpile") { bits.push(`${stockKg(fw)}/${K.stockpile.capKg} kg: ${contentsText(fw)}`); if (fw.owner === "player" && haulText(state, fw)) bits.push(haulText(state, fw)); }
    if (fw.kind === "relay") bits.push(fw.offline ? "offline: needs 1 part" : "on the air");
  }
  const j = jobFor(state, fw);
  if (fw.built && j) bits.push(`${j.type === "repair" ? (fw.kind === "spikes" ? "resetting" : "repairs") : j.type === "stock" ? "restocking" : "demolition"} ${Math.round((j.progress / j.hours) * 100)}%`);
  return bits.join(" · ");
}
// The map's hover lines for a tile.
export function fwTooltip(state, tile) {
  const fw = fwAt(state, tile);
  if (!fw) return "";
  const base = fw.owner === "player" ? baseById(state, fw.baseId) : null;
  const who = fw.owner === "player" ? `yours${base ? ` (${base.name})` : ""}` : ownerName(state, fw.owner);
  const band = damageBand(fw);
  return `${K[fw.kind].icon} ${kindName(fw)}, ${who}: ${fwStatusText(state, fw)}${band ? ` · 🔧 ${band === "bad" ? "badly damaged" : "needs repair"}` : ""}`;
}

// The job trips (sim/jobtrips.js) are always on: the field wells join the water carriers' sources (their water comes in
// by the Fetch water job, not by itself: FIELD.PASSIVE_WELLS false) and the stockpiles are drop points. Installed once
// here, at load, so the game and the headless tools (tools/*.js) both get it.
installTripHooks(TRIP_HOOKS);
