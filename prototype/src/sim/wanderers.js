// People on the move in the wider state, met on the road and at the places you search:
//   neutral survivors  - on their own or in twos and threes, trying to get by. Talk to them (a chance by their mood,
//                        your best talker's Speech or Leadership, a gift of food and water, having met before): they
//                        may ask to join (a recruit card, recruits.js). Left alone they go on living (or not): they
//                        wander, may die, may join a band or a group or settle somewhere, and can be met again.
//   aggressive survivors - loose bands of 2–5 who rob and fight like raiders, from day 1 in both modes. They are not
//                        a raider group: no faction, no base, nothing to do with the raiders' day (hardcore-groups.js
//                        raidersFrom), which gates the organised gangs and the outsider raiders only.
//   military squads    - 3–5 soldiers of a military group (only while one stands: alive with a base; in hardcore until
//                        its base is overrun), out near their base fighting the dead. They use that group's goodwill:
//                        a hostile one stops you like a checkpoint (conflicts.js). They fight the dead and armed people
//                        who attack them, never you unless you attack them (thirdside.js on the battle map).
// Where: the road (events.js rollTravelEvent: a chance per tile entered), sites searched hour by hour (scavenge.js
// startScavenge: one roll on arrival) and raided on the map (scavenge.js raidEnemies: they are on the raid map, the
// neutrals and soldiers as a third side, thirdside.js), and building interiors (interiorOccupants below).
// How many: by the ground (cities most, then towns and suburbs, little in open country) × the mode: a steady low rate
// in a normal game; in hardcore many more in the first weeks (people fleeing) falling over the first months as people
// die, settle and join bands (× 1 + HC_EARLY × e^(−day / HC_FADE)).
// Every roll here uses hash01 or a generator seeded from it, never the world's random numbers, so a normal game where
// nobody is met plays exactly as before; the cards' own choices use the world's dice like any card.
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { LOCATIONS, FACTION_TYPES, GEAR } from "./data.js";
import { log, addCard, day, hub, skill, isNight, factionById, combatPower, snapshot, armedFactor, localId } from "./world.js";
import {
  partyMembers, partyTile, bestSkill, tileLabel, carried, takeSupply, wipeParty, partySpeed, addGearToCargo, unheardEnvoy,
} from "./parties.js";
import { attitude, changeGoodwill } from "./factions.js";
import { registerCombatHandler, startCombat, winOdds, KITS, WEAPONS } from "./combat.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { hash01, anyPerk, gainXp, USE } from "./skills.js";
import { Rng } from "./rng.js";
import { isRoadStart } from "./roadstart.js";
import { zombieToughness } from "./hives.js";
import { lootItem } from "./inventory.js";
import { groupCapture } from "./groupjails.js"; // prisoners of a three-way fight into a group's jail
import { kitSource, spend } from "./itemcond.js";
import { halt, resume, afterFight, rob, talkSkill, talker, runBonus, addCargo, addCargoRounds, triggerConflict, spotFirstChance } from "./conflicts.js";
import { bandsOf } from "./hardcore-groups.js";
import { sumRecs } from "./rounds.js"; // rounds by key: each gun judged by its own calibre
import { wandererJoinChance, wandererJoins } from "./groupcare.js"; // AI parity: groups recruit wanderers by type, food and beds
import { swapGun, kitGunSource, bodyGunSource } from "./gundist.js"; // the gun distribution: wanderers' guns
import { carriedRec } from "./ammo.js"; // the loose rounds people carry
import { PARLEY } from "./parley.js"; // fighting side by side (g.fought)

export const WANDER = {
  // The road: per tile a team enters, ROAD × the tile's density × the mode's factor (× NIGHT at night), at most ROAD_MAX;
  // a team meets nobody new for COOLDOWN hours after a meeting.
  ROAD: 0.03, ROAD_MAX: 0.1, NIGHT: 0.6, COOLDOWN: 10,
  // Density by ground, plus a site on the tile by its kind (data.js LOCATIONS cat), plus a road.
  GROUND: { city: 1, suburb: 0.55, plains: 0.15, forest: 0.1, hills: 0.1, mountain: 0.04, water: 0 },
  SITE_CAT: { urban: 0.3, town: 0.3, special: 0.2, rural: 0.08 }, ROAD_TILE: 0.06,
  // A site searched or raided: SITE × density × the mode's factor, at most SITE_MAX (one roll per visit).
  SITE: 0.25, SITE_MAX: 0.7,
  // One roll per site per SITE_WINDOW hours: whoever is there stays until met (a search, a raid), then is gone;
  // searching the same place again within the window meets nobody new.
  SITE_WINDOW: 72,
  // Hardcore: × (1 + HC_EARLY × e^(−day / HC_FADE)): about ×3.2 on day 1, ×2 by day 25, ×1.4 by day 60, ×1.1 by day 110.
  HC_EARLY: 2.2, HC_FADE: 35,
  // Who you meet (shares; the aggressive ones ×HOSTILE_CITY in a city; soldiers only near a military base).
  KIND: { neutral: 0.58, hostile: 0.3, military: 0.15 }, HOSTILE_CITY: 1.5, MIL_RANGE: 24, MIL_HARDCORE: 1.5,
  // Neutral groups: sizes [n, weight]; moods (weight, talk chance before skill).
  NEUTRAL_SIZE: [[1, 45], [2, 30], [3, 15], [4, 10]], NEUTRAL_POWER: 2.2,
  MOODS: { wary: { w: 0.4, talk: 0.2 }, friendly: { w: 0.35, talk: 0.45 }, desperate: { w: 0.25, talk: 0.35 } },
  TALK_SKILL: 0.025, GIFT_BONUS: 0.3, AGAIN_BONUS: 0.15, GIFT: { food: 2, water: 2 }, AI_FOOD: 4,
  // Aggressive survivors: 2–4 (one more in a city; never more than HOSTILE_OVER over the team met), power per head; what they take when you hand it over; the talk DC;
  // the chance one of them asks to come along after a good talk; a share seen robbing others (observed).
  HOSTILE_SIZE: [2, 4], HOSTILE_POWER: 2.6, HOSTILE_OVER: 1, ROB_SHARE: 0.3, TALK_DC: 10, JOIN_AFTER_TALK: 0.15, ROBBERY: 0.4,
  // Hardcore, a team of one or two (2026-10-07; by its head count, smallTeam): fewer eyes on the road and less worth
  // robbing. share: × the aggressive survivors' share of the road's meetings (the rest go to neutrals and squads, so
  // as many people are met); max: the most of them who stop it (in place of the team + HOSTILE_OVER, and below
  // HOSTILE_SIZE's floor of two for someone alone). Alone: half as often, one of them; a pair: three quarters, two.
  // Three or more: as before. Only in hardcore, where the team on the road is all you have and the first weeks are
  // crowded (HC_EARLY).
  HC_SMALL: { 1: { share: 0.5, max: 1 }, 2: { share: 0.75, max: 2 } },
  // Military squads: size, power per soldier; a share met fighting the dead; goodwill for news, help, an attack,
  // freeing their soldiers who had given up (GW_FREED: thirdPrisoners).
  SQUAD_SIZE: [3, 5], SQUAD_POWER: 5, FIGHTING: 0.45, GW_NEWS: 2, GW_HELP: 8, GW_ATTACK: -30, GW_ASIDE: 2, GW_FREED: 4,
  // The people you left (light simulation, once a day): at most MAX groups remembered; a chance a day to move a tile,
  // to lose one of them (DIE + infection × DIE_INF, + DIE_HORDE with a horde next to them), to join a band within 2
  // tiles (hardcore) or a group with a base within 3 (not raiders), to settle somewhere for good after SETTLE_AFTER
  // days; met again within AGAIN tiles (AGAIN_CHANCE of the neutral meetings there).
  SIM: { MAX: 40, MOVE: 0.5, DIE: 0.008, DIE_INF: 0.04, DIE_HORDE: 0.06, JOIN_BAND: 0.25, JOIN_GROUP: 0.04, SETTLE_AFTER: 25, SETTLE: 0.02, AGAIN: 2, AGAIN_CHANCE: 0.6 },
};
const W = WANDER;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (c) => `${Math.round(c * 100)}%`;
const first = (s) => s.name.split(" ")[0];
const names = (list) => (list.length <= 1 ? list.map(first).join("") : `${list.slice(0, -1).map(first).join(", ")} and ${first(list[list.length - 1])}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const skillChance = (s, dc) => clamp((s + 10 - dc + 1) / 10, 0.05, 0.95);
const NUM = ["no one", "one", "two", "three", "four", "five", "six"];
const UPSTAIRS_TYPES = new Set(["offices", "apartments", "police"]); // interiorOccupants: squatters prefer an upper floor here
// interiorOccupants: the rooms a building's people make for, by its kind and their side (the rooms' styles,
// civiclayout.js: the new saves' plans): a police station's armed squatters the squad room or the armory, a school's
// survivors the gym, a church's the nave. Unchanged where a building or a side has none. Issue #25 (militarylayout.js):
// the soldiers holding a base (side military) its ops room, comms, bays, the guard post and the vehicle bays; armed
// squatters the same rooms, a prison's control room, a terminal's security; survivors a barracks' day room, a prison's
// day room, a terminal's gates and lounges, a mess hall.
const KIND_ROOMS = { police: { hostile: ["squad", "armory"] }, school: { neutral: ["gym"] }, church: { neutral: ["nave"] },
  // Prisons and jails (issue #31, prisonlayout.js marks): whoever holds one keeps to a housing unit's day room or dorm.
  prison: { hostile: ["dayroom", "dorm"], neutral: ["dayroom", "dorm"] }, jail: { hostile: ["dayroom"], neutral: ["dayroom"] },
  hq: { military: ["ops", "comms", "mlobby"], hostile: ["ops", "comms"] }, barracks: { military: ["bay", "dutydesk"], hostile: ["bay", "mdayroom"], neutral: ["mdayroom", "bay"] },
  armorybldg: { military: ["issue"], hostile: ["issue", "armorer"] }, gatehouse: { military: ["guardpost"], hostile: ["guardpost"] }, motorpool: { military: ["vbays", "dispatchm"], hostile: ["dispatchm"] },
  messhall: { neutral: ["mess"], hostile: ["mess"] }, aidstation: { neutral: ["aidward"] }, hangar: { military: ["hfloor"], hostile: ["hoffice", "hfloor"] }, tower: { military: ["cab"], hostile: ["cab"] },
  flightops: { military: ["opsdesk", "crewroom"], hostile: ["crewroom"] }, terminal: { neutral: ["gates", "lounge"], hostile: ["security", "airline"] },
  cellblock: { hostile: ["pcontrol", "guardroom"], neutral: ["pdayroom"] },
  // Bunkers (issue #26, bunkerlayout.js marks): whoever holds one keeps to its bunk rooms and its command rooms.
  milbunker: { hostile: ["barracks", "command"], military: ["barracks", "command"], neutral: ["barracks", "quarters"] }, mountainbunker: { military: ["barracks", "command"], hostile: ["barracks", "command"], neutral: ["barracks", "quarters"] },
  govbunker: { hostile: ["situation", "barracks"], neutral: ["barracks"] }, shelter: { neutral: ["bunkhall"], hostile: ["bunkhall"] }, prepper: { neutral: ["prepbunks", "prepguns"], hostile: ["prepguns", "prepbunks"] } };
// Crashlanding's mountain bunker (crashstart.js, issue #26): the unit's remnant inside it while they hold it, their
// own people (ADR 0001: fighters.js memberize draws each soldier from the group's members, with what they carry), half
// in the barracks gallery and half in the command centre; soldiers of a third side who never fire on you unless you
// fire on them. [] in any other raid.
function remnantInside(state, tileId, plan) {
  const C = state.crash;
  if (!C || C.nextTile !== tileId || C.remnantFid == null || !plan || plan.key !== "mountainbunker") return [];
  const f = factionById(state, C.remnantFid);
  if (!f || !f.alive || !(f.bases || []).includes(tileId)) return [];
  const n = Math.max(1, Math.min(12, (f.people || []).length || f.pop || 0));
  const name = `the ${f.name.replace(/^The /, "")}`;
  const half = Math.ceil(n / 2);
  return [{ kind: "soldiers", side: "military", count: half, power: squadPower(f), name, factionId: f.id, remnant: true, at: "barracks" },
    ...(n - half > 0 ? [{ kind: "soldiers", side: "military", count: n - half, power: squadPower(f), name, factionId: f.id, remnant: true, at: "command" }] : [])];
}

// ---------- state ----------
export function wanderers(state) {
  if (!state.wanderers) state.wanderers = { groups: [], seq: 0, sites: {}, stats: {} };
  return state.wanderers;
}
function bump(state, key, n = 1) {
  const st = wanderers(state).stats;
  st[key] = (st[key] || 0) + n;
}
export const groupById = (state, wid) => (state.wanderers ? state.wanderers.groups.find((g) => g.wid === wid) : null) || null;
// A generator for one roll's details, seeded from the seed and the roll's keys (never the world's dice).
const rngFor = (state, ...k) => new Rng(Math.floor(hash01(state.seed, ...k) * 4294967296) >>> 0);
// makeCandidate draws from state.rng: lend it this roll's generator meanwhile.
function withRng(state, rng, fn) {
  const was = state.rng;
  state.rng = rng;
  try { return fn(); } finally { state.rng = was; }
}

// ---------- how many ----------
export function wanderDensity(state, tileId) {
  const t = state.tiles[tileId];
  if (!t || t.terrain === "water") return 0;
  let d = W.GROUND[t.terrain] ?? 0.1;
  if (t.loc && LOCATIONS[t.loc.type]) d += W.SITE_CAT[LOCATIONS[t.loc.type].cat] ?? 0.1;
  if (t.road) d += W.ROAD_TILE;
  return d;
}
// The mode's factor: 1 in a normal game; hardcore: people fleeing in the first weeks, fewer as the months go by.
export function modeFactor(state, d = day(state)) {
  return isRoadStart(state) ? 1 + W.HC_EARLY * Math.exp(-(d - 1) / W.HC_FADE) : 1;
}
// factor: the mode's (default); 1 for the chance a normal game would have on the tile (the tests' baseline).
export const roadChance = (state, tileId, night = isNight(state), factor = modeFactor(state)) => Math.min(W.ROAD_MAX, W.ROAD * wanderDensity(state, tileId) * factor) * (night ? W.NIGHT : 1);
export const siteChance = (state, tileId) => Math.min(W.SITE_MAX, W.SITE * wanderDensity(state, tileId) * modeFactor(state));

// The groups that send squads out: any living military group with a base (hardcore: the original one until its base
// falls, then whatever military groups come out of it), and fortress groups that came out of the military
// (hardcore-groups.js marks a founded splinter f.hcSplinter; one that turned raider sends no squads).
const militaries = (state) => state.factions.filter((f) => f.alive && f.bases.length && (f.type === "military" || (f.type === "fortress" && (f.hcSplinter || f.fromMilitary))));
function squadSource(state, tileId) {
  let best = null;
  for (const f of militaries(state)) {
    const d = Math.min(...f.bases.map((b) => state.grid.distance(b, tileId)));
    const w = Math.max(0, 1 - d / W.MIL_RANGE) * (f.hcMilitary ? W.MIL_HARDCORE : 1);
    if (w > 0 && (!best || w > best.w)) best = { f, w };
  }
  return best;
}
// hostileMult: × the aggressive survivors' share (a small team on the road in hardcore: HC_SMALL share).
function pickKind(state, tileId, rng, site = false, hostileMult = 1) {
  const t = state.tiles[tileId];
  const mil = squadSource(state, tileId);
  const opts = [
    { kind: "neutral", w: W.KIND.neutral },
    { kind: "hostile", w: W.KIND.hostile * (t.terrain === "city" ? W.HOSTILE_CITY : 1) * hostileMult },
  ];
  // A hostile military at a site would be a checkpoint in the middle of a search: they only stop you on the road.
  if (mil && !(site && attitude(mil.f) === "Hostile")) opts.push({ kind: "military", w: W.KIND.military * mil.w * 2, f: mil.f });
  return rng.weighted(opts, (o) => o.w);
}

// ---------- the people ----------
const MOOD_KEYS = Object.keys(W.MOODS);
// Exported for floorfolk.js: the survivors barricaded upstairs in a city building are a group like any other met here.
export function newNeutralGroup(state, tileId, rng) {
  const n = rng.weighted(W.NEUTRAL_SIZE, (x) => x[1])[0];
  const people = withRng(state, rng, () => Array.from({ length: n }, () => makeCandidate(state, { quality: 0.8, minHealth: 35, gearChance: 0.45 })));
  for (const s of people) { delete s.pending; s.wanderer = true; }
  const ws = wanderers(state);
  const g = {
    wid: ++ws.seq, kind: "neutral", people, tile: tileId, since: day(state), mood: rng.weighted(MOOD_KEYS, (k) => W.MOODS[k].w),
    met: 0, lastMet: null, talked: false, gifted: false, fled: isRoadStart(state) && day(state) < 30,
  };
  ws.groups.push(g);
  if (ws.groups.length > W.SIM.MAX) ws.groups.shift();
  return g;
}
// Someone you left before, still near here (or null).
function againNear(state, tileId, rng) {
  const ws = state.wanderers;
  if (!ws) return null;
  const near = ws.groups.filter((g) => g.met && g.people.length && state.grid.distance(g.tile, tileId) <= W.SIM.AGAIN && (g.lastMet == null || state.hour - g.lastMet >= 24));
  if (!near.length || !rng.chance(W.SIM.AGAIN_CHANCE)) return null;
  return near[0];
}
function neutralFor(state, tileId, rng) {
  const g = againNear(state, tileId, rng);
  if (g) { g.tile = tileId; bump(state, "again"); return { g, again: true }; }
  return { g: newNeutralGroup(state, tileId, rng), again: false };
}
const hostileCount = (state, tileId, rng) => rng.int(W.HOSTILE_SIZE[0], W.HOSTILE_SIZE[1]) + (state.tiles[tileId].terrain === "city" ? 1 : 0);
// A team of one or two in hardcore: its HC_SMALL row ({ share, max }), else null (three or more, or a normal game).
export const smallTeam = (state, p) => (isRoadStart(state) ? W.HC_SMALL[partyMembers(state, p).length] || null : null);
// Loose bands pick on people their own size: never more than HOSTILE_OVER over the team they stop (a small team in
// hardcore: never more than its HC_SMALL max).
export function sized(state, p, n) {
  const small = smallTeam(state, p);
  if (small) return Math.max(1, Math.min(n, small.max));
  return Math.max(W.HOSTILE_SIZE[0], Math.min(n, partyMembers(state, p).length + W.HOSTILE_OVER));
}
const squadPower = (f) => Math.round((2.2 + (FACTION_TYPES[f.type] ? FACTION_TYPES[f.type].arms : 1) * 1.6) * 10) / 10;
const weaponName = (s) => (s.gear.weapon && GEAR[s.gear.weapon.key] ? GEAR[s.gear.weapon.key].name.toLowerCase() : null);
const lookOf = (n) => (n === 1 ? "someone on their own" : n === 2 ? "two people" : `a group of ${NUM[n] || n}`);
function personLine(s) {
  const w = weaponName(s);
  return `${s.name}${w ? ` (a ${w}` : " (unarmed"}${s.health < 60 ? ", hurt" : ""})`;
}
const moodText = {
  wary: "They watch you with their hands near their weapons.",
  friendly: "One of them raises a hand in greeting.",
  desperate: "They look half-starved and very tired.",
};

// ---------- the road (events.js rollTravelEvent) ----------
// A key for the team in the rolls: its place among the teams out (ids depend on what else ran in the process, and
// the same seed must play the same in any process).
const teamKey = (state, p) => state.parties.indexOf(p);
// The card for a meeting on this tile, or null. A hostile military's checkpoint is added by conflicts.js itself
// (returns null then). p.eventHour is set either way.
export function rollWanderer(state, p, tileId) {
  if (state.noWanderers) return null; // test switch: nobody on the move is met
  if (p.owner !== "player" || p.kind === "convoy" || p.crewRole != null) return null;
  if (state.bases.some((b) => b.tile === tileId)) return null;
  if (state.wanderers) bump(state, "road-tiles"); // counted once someone has been met (no state at all before that)
  if (p.lastWander != null && state.hour - p.lastWander < W.COOLDOWN) return null;
  const c = roadChance(state, tileId);
  // The stats (wanderertest.js): the meetings expected on the tiles rolled, with the mode's factor and at ×1 (a normal
  // game's chance on the same tiles, by night and day), so a sample's meetings per tile can be read against the ground
  // walked and the factor's effect in the game measured apart from the dice and the terrain.
  if (state.wanderers) { bump(state, "road-expect", c); bump(state, "road-expect1", roadChance(state, tileId, isNight(state), 1)); }
  if (c <= 0 || hash01(state.seed, "wander-road", teamKey(state, p), tileId, state.hour) >= c) return null;
  const rng = rngFor(state, "wander-road-who", teamKey(state, p), tileId, state.hour);
  const small = smallTeam(state, p);
  const pick = pickKind(state, tileId, rng, false, small ? small.share : 1);
  p.lastWander = state.hour;
  bump(state, `road-${pick.kind}`);
  if (pick.kind === "military" && attitude(pick.f) === "Hostile") {
    triggerConflict(state, p, "checkpoint", pick.f.id); // conflicts.js adds its card
    p.eventHour = state.hour;
    return null;
  }
  if (pick.kind === "neutral") {
    const { g, again } = neutralFor(state, tileId, rng);
    return neutralCard(state, p, g, { again });
  }
  if (pick.kind === "hostile") {
    const n = hostileCount(state, tileId, rng);
    const spotted = rng.chance(spotFirstChance(state, p));
    if (spotted && rng.chance(W.ROBBERY)) {
      const { g } = neutralFor(state, tileId, rng);
      bump(state, "road-robbery");
      return robberyCard(state, p, n, g);
    }
    return spotted ? hostileSeenCard(state, p, n) : hostileCard(state, p, n, {});
  }
  const n = rng.int(W.SQUAD_SIZE[0], W.SQUAD_SIZE[1]);
  if (rng.chance(W.FIGHTING)) {
    const t = state.tiles[tileId];
    const dead = Math.max(4, Math.round((5 + t.infection * 10) * rng.range(1, 1.6)));
    bump(state, "road-squadfight");
    return squadFightCard(state, p, pick.f, n, dead);
  }
  return squadCard(state, p, pick.f, n, {});
}

// ---------- at a site ----------
// Who is at a site now: [{ kind: "neutral" | "hostile" | "military", wid?, n, f? }] (empty: nobody). One roll per tile
// and SITE_WINDOW hours, so the raid map, a building's interior and the hour-by-hour search agree; once met they are
// gone from the site (siteMet) for the rest of the window.
export function siteRoll(state, tileId) {
  const t = state.tiles[tileId];
  if (state.noWanderers || !t || t.terrain === "water" || t.hive) return []; // noWanderers: test switch
  if (state.bases.some((b) => b.tile === tileId) || state.factions.some((f) => f.alive && f.bases.includes(tileId))) return [];
  const key = `${tileId}:${Math.floor(state.hour / W.SITE_WINDOW)}`;
  const ws = state.wanderers;
  if (ws && ws.sites[key]) return ws.sites[key];
  const c = siteChance(state, tileId);
  if (hash01(state.seed, "wander-site", key) >= c) {
    if (ws) { ws.sites[key] = []; bump(state, "site-visits"); } // nobody: remembered too (once someone has been met)
    return [];
  }
  const rng = rngFor(state, "wander-site-who", key);
  const pick = pickKind(state, tileId, rng, true);
  const out = [];
  if (pick.kind === "neutral") out.push({ kind: "neutral", wid: neutralFor(state, tileId, rng).g.wid });
  else if (pick.kind === "hostile") out.push({ kind: "hostile", n: hostileCount(state, tileId, rng), seed: rng.int(1, 1e6) });
  else out.push({ kind: "military", n: rng.int(W.SQUAD_SIZE[0], W.SQUAD_SIZE[1]), fid: pick.f.id });
  wanderers(state).sites[key] = out;
  bump(state, `site-${pick.kind}`);
  bump(state, "site-visits");
  return out;
}

// The raid map's groups for them (scavenge.js raidEnemies; combat.js createRaid places them, the neutrals and the
// soldiers as a third side: thirdside.js).
export function siteWanderers(state, tileId) {
  const out = [];
  for (const r of siteRoll(state, tileId)) {
    if (r.kind === "neutral") {
      const g = groupById(state, r.wid);
      if (!g || !g.people.length) continue;
      out.push({ kind: "survivors", side: "neutral", count: g.people.length, power: W.NEUTRAL_POWER, name: g.people.length === 1 ? g.people[0].name.split(" ")[0] : "the survivors hiding here", wid: g.wid, people: g.people.map((s) => ({ name: s.name, weapon: s.gear.weapon ? s.gear.weapon.key : "fists", hp: s.health, s })) });
    } else if (r.kind === "hostile") {
      out.push({ kind: "survivors", count: r.n, power: W.HOSTILE_POWER, name: "armed survivors", guard: true, wanderer: "hostile" });
    } else {
      const f = factionById(state, r.fid);
      if (!f || !f.alive) continue;
      out.push({ kind: "soldiers", side: "military", count: r.n, power: squadPower(f), name: `the ${f.name.replace(/^The /, "")} squad`, factionId: f.id });
    }
  }
  return out;
}

// Who is inside a building being explored (sim/buildingmaps.js asks when it builds the map). The same people as
// siteWanderers for this tile and hour (place one or the other, not both).
// tile: the State Map tile (or its id); plan: the generated building ({ type, rooms, exits, ... }).
// Returns groups to place: [{ side: "neutral" | "hostile" | "military", people: [{ kit, weapon, power, name?, hp? }],
// room? (a plan room's id), aware, kind, count, power, name, factionId?, wid? }]. Hostile groups are the raid's guards
// (buildingmaps.js); neutral and military ones are placed as a third side by thirdside.js (registerOccupantSide).
export function interiorOccupants(state, tile, plan) {
  const tileId = typeof tile === "object" && tile ? tile.id : tile;
  if (tileId == null || !state.tiles[tileId]) return [];
  // A room away from the way in (not the entry, not locked) when the plan has one, by its id. Armed squatters in an
  // office tower, an apartment block or a police station with storeys hole up on an upper floor (docs/multi-storey-crawl.md).
  const rooms = plan && Array.isArray(plan.rooms) ? plan.rooms.filter((r) => !r.entry && !r.locked) : [];
  const upstairs = plan && plan.storeys > 1 && UPSTAIRS_TYPES.has(plan.key) ? rooms.filter((r) => (r.f || 0) > 0) : [];
  return [...remnantInside(state, tileId, plan), ...siteWanderers(state, tileId)].map((g, i) => {
    const kit = KITS[g.kind] || KITS.survivors;
    const rng = rngFor(state, "wander-inside", tileId, state.hour, i);
    const people = g.people ? g.people.map((x) => ({ kit: g.kind, weapon: WEAPONS[x.weapon] ? x.weapon : "fists", power: g.power, name: x.name, hp: x.hp, s: x.gear ? x : x.s })) // fighters.js: the person themselves
      : Array.from({ length: g.count }, () => ({ kit: g.kind, weapon: swapGun(kitGunSource(g.kind), rng.pick(kit.weapons), rng), power: g.power })); // gundist.js: a gun of their kind in the band
    const hostile = !g.side || g.side === "hostile";
    const kinds = plan && KIND_ROOMS[plan.key] && KIND_ROOMS[plan.key][hostile ? "hostile" : g.side];
    const theirs = g.at ? rooms.filter((r) => r.bunker === g.at) : kinds ? rooms.filter((r) => kinds.includes(r.civic) || kinds.includes(r.bunker) || kinds.includes(r.prison)) : []; // g.at: the remnant's own room
    const theirsUp = theirs.filter((r) => upstairs.includes(r));
    const pool = theirsUp.length ? theirsUp : theirs.length ? theirs : hostile ? (upstairs.length ? upstairs : rooms) : rooms; // the armed squatters (no side: the raid's guards)
    const room = pool.length ? pool[Math.floor(hash01(state.seed, "wander-room", tileId, state.hour, i) * pool.length)] : null;
    return { ...g, side: g.side || "hostile", people, aware: false, room: room ? room.id : undefined };
  });
}

// The hour-by-hour search (scavenge.js startScavenge, after the search slot is set): whoever is here makes a card.
// The team stays in its search; nothing on these cards moves it.
export function siteEncounter(state, p, tileId) {
  for (const r of siteRoll(state, tileId)) {
    let card = null;
    if (r.kind === "neutral") { const g = groupById(state, r.wid); if (g && g.people.length) card = neutralCard(state, p, g, { site: true }); }
    else if (r.kind === "hostile") card = hostileCard(state, p, r.n, { site: true });
    else { const f = factionById(state, r.fid); if (f && f.alive) card = squadCard(state, p, f, r.n, { site: true }); }
    if (card) addCard(state, card);
  }
  siteMet(state, tileId);
}
// The people at a site were met (a search, a raid): they leave it (the neutrals go on in the daily simulation).
export function siteMet(state, tileId) {
  const ws = state.wanderers;
  if (ws) ws.sites[`${tileId}:${Math.floor(state.hour / W.SITE_WINDOW)}`] = [];
}

// ---------- the cards ----------
const where = (state, p) => tileLabel(state, partyTile(p));
function card(state, p, opts, title, text, choices) {
  if (!opts.site) halt(p); // conflicts.js: the team stops for this; resume() lets it go on
  const live = (fn) => (st) => (st.parties.includes(p) && partyMembers(st, p).length ? fn(st) : "Too late: the team is no longer there.");
  for (const c of choices) c.resolve = live(c.resolve);
  return { title, text, where: where(state, p), partyId: p.id, wanderer: true, choices };
}
const goOn = (state, p, opts) => { if (!opts.site) resume(state, p); };
function delay(p, hours) { p.progress -= hours * partySpeed(p); }

// The talk with a neutral group: their mood, the team's best talker (conflicts.js talkSkill: Speech, Leadership − 2,
// a Peacemaker's Leadership, Smooth Talker), having met before, a gift.
export function talkChance(state, p, g, gift = false) {
  const m = W.MOODS[g.mood] || W.MOODS.wary;
  let c = m.talk + W.TALK_SKILL * talkSkill(state, p) + (g.talked || g.gifted ? W.AGAIN_BONUS : 0) + (gift ? W.GIFT_BONUS * (g.mood === "desperate" ? 1.3 : 1) : 0);
  if (anyPerk(partyMembers(state, p), "charming")) c += 0.05;
  c += Math.min(PARLEY.ODDS.foughtMax, (g.fought || 0) * PARLEY.ODDS.fought); // parley.js: they fought beside you on a raid's map
  return clamp(c, 0.05, 0.95);
}
function remember(state, g, p) {
  g.met += 1;
  g.lastMet = state.hour;
  g.tile = partyTile(p);
}
// They ask to join: the recruit card (recruits.js) for the team.
function askJoin(state, p, g, intro) {
  const list = g.people.filter((s) => !s.dead);
  if (!list.length) return "";
  for (const s of list) { s.pending = true; delete s.gone; }
  bump(state, "asked", list.length);
  offerRecruits(state, list, { source: "wanderer", partyId: p.id, title: list.length === 1 ? `${first(list[0])} asks to join` : "They ask to join", intro });
  return `${names(list)} ${list.length === 1 ? "asks" : "ask"} to come with you.`;
}

export function neutralCard(state, p, g, opts = {}) {
  const n = g.people.length;
  const team = partyMembers(state, p).length;
  const lead = opts.again ? `You run into ${names(g.people)} again${g.talked ? "; they remember you" : ""}.`
    : opts.site ? `Someone is already inside: ${lookOf(n)}, hiding${g.fled ? " from the chaos outside" : ""}.`
      : `${cap(lookOf(n))} on the road ${g.fled ? "with bags packed in a hurry, fleeing the fall of the towns" : "living rough"}.`;
  const text = `${lead} ${g.people.map(personLine).join(", ")}. ${moodText[g.mood] || ""}`;
  const talk = talkChance(state, p, g), gift = talkChance(state, p, g, true);
  const cost = Object.fromEntries(Object.entries(W.GIFT).map(([k, q]) => [k, q * n]));
  const costText = Object.entries(cost).map(([k, q]) => `${q} ${keyWord(k)}`).join(" and ");
  const short = (st) => Object.entries(cost).some(([k, q]) => carried(p, k) < q);
  const win = (st, gifted) => {
    gainXp(st, talker(st, p), "speech", USE.talk + USE.talkWon);
    remember(st, g, p);
    g.talked = true;
    bump(st, "talk-ok");
    goOn(st, p, opts);
    return `${gifted ? "They eat while you talk. " : ""}${askJoin(st, p, g, `${names(g.people)} ${n === 1 ? "has" : "have"} been ${g.fled ? "on the run since the fall" : "getting by on their own"} and would rather not be.`)}`;
  };
  const choices = [
    {
      label: "Talk to them", hint: `${pct(talk)} they trust you enough to ask to join (your best talker's Speech or Leadership; they are ${g.mood})${g.talked ? "; you have talked before" : ""}. Otherwise they keep their distance`,
      // The autopilot talks to everyone, except with no hub yet (hardcore's road team) and under AI_FOOD days of food a
      // head for them all: a bare first hub cannot feed many more mouths.
      ai: (st) => (hub(st) || carried(p, "food") / Math.max(1, team + n) >= W.AI_FOOD ? 1 : 0),
      resolve: (st) => {
        if (st.rng.chance(talk)) return win(st, false);
        gainXp(st, talker(st, p), "speech", USE.talk);
        remember(st, g, p);
        g.talked = true;
        bump(st, "talk-fail");
        goOn(st, p, opts);
        return `They keep their distance and move on. Maybe another time.`;
      },
    },
    {
      label: `Share food and water (${costText})`, hint: `${pct(gift)} they ask to join after; otherwise they thank you and go their own way. The team feels better for it`,
      disabled: (st) => short(st), ai: () => 0.2,
      resolve: (st) => {
        if (short(st)) return "The team no longer has that to spare.";
        for (const [k, q] of Object.entries(cost)) takeSupply(p, k, q);
        for (const m of partyMembers(st, p)) m.mood = clamp(m.mood + 2, 0, 100);
        g.gifted = true;
        bump(st, "gift");
        if (st.rng.chance(gift)) return win(st, true);
        remember(st, g, p);
        goOn(st, p, opts);
        return "They thank you, quietly, and go their own way.";
      },
    },
    {
      label: "Leave them be", hint: `They go on alone. ${team > 0 ? "You may meet them again" : ""}`.trim(), ai: () => 0.1,
      resolve: (st) => { remember(st, g, p); bump(st, "left"); goOn(st, p, opts); return n === 1 ? "You nod and walk on." : "You leave them to it."; },
    },
  ];
  return card(state, p, opts, opts.site ? `Survivors in ${tileLabel(state, partyTile(p))}` : n === 1 ? "A survivor on the road" : "Survivors on the road", text, choices);
}

// Odds of a fight by the numbers (combat.js winOdds), with allies on the map (allyPower).
function odds(state, p, enemy, ambush, allyPower = 0) {
  const people = partyMembers(state, p);
  if (!people.length) return 0;
  let mine = people.reduce((a, s) => a + combatPower(s), 0) * armedFactor(people, sumRecs(p.supplies, p.cargo && p.cargo.supplies, carriedRec(people)), carried(p, "arrows")); // the guns' ammo, the bows' arrows
  let theirs = enemy.count * enemy.power;
  if (ambush === "player") mine *= 1.4;
  if (ambush === "enemy") theirs *= 1.4;
  mine += allyPower;
  return winOdds(mine / Math.max(0.1, theirs), { ...enemy, people: people.length, ambush });
}
const hostileEnemy = (n) => ({ kind: "survivors", count: n, power: W.HOSTILE_POWER, name: n === 1 ? "the armed stranger" : "the armed strangers" });

function fight(state, p, c, ambush, lead = "") {
  if (!c.site) halt(p);
  bump(state, `fight-${c.type}`);
  startCombat(state, {
    tile: partyTile(p), partyId: p.id, enemy: { ...c.enemy }, ambush, canRetreat: true, handler: "wanderer",
    ...(c.third ? { third: c.third } : {}), ...(c.allyPower ? { allyPower: c.allyPower } : {}),
    context: { type: c.type, site: !!c.site, enemy: c.enemy, wid: c.wid ?? null, factionId: c.factionId ?? null, partyId: p.id, lead, resumePhase: p.conflictResume || "out" },
  });
  return "";
}
function fightChoice(state, p, c, ambush, label, extra = "") {
  const o = odds(state, p, c.enemy, ambush, c.allyPower);
  return {
    label, hint: `About ${pct(o)} to win${ambush === "enemy" ? ", but they have the drop on you" : ambush === "player" ? ": you strike first" : ""}. Uses ammo; people may get hurt.${extra ? ` ${extra}` : ""}`,
    fight: { odds: o, enemy: c.enemy, ambush }, ai: () => o * 1.3 - 0.35,
    resolve: (st) => fight(st, p, c, ambush),
  };
}

// Aggressive survivors who found you first (on the road, or squatting at a site you came to search).
export function hostileCard(state, p, n, opts = {}) {
  n = sized(state, p, n);
  const c = { type: "hostile", site: !!opts.site, enemy: hostileEnemy(n) };
  const run = skillChance(bestSkill(state, p, "stealth") + runBonus(state, p), 9);
  const talk = skillChance(talkSkill(state, p), W.TALK_DC);
  // One of them (a small team in hardcore: HC_SMALL) or a band.
  const text = n === 1
    ? (opts.site ? `Someone armed has holed up in ${tileLabel(state, partyTile(p))} and is not sharing. They come out with a shotgun: "Turn around, or leave your bags."`
      : `A ragged man steps out from behind a wreck with a shotgun leveled at you: "Bags on the ground. Slowly."`)
    : opts.site ? `${cap(NUM[n] || String(n))} armed survivors have holed up in ${tileLabel(state, partyTile(p))} and are not sharing. They come out with a shotgun and a bat: "Turn around, or leave your bags."`
      : `${cap(NUM[n] || String(n))} ragged people step out from behind a wreck, armed with whatever they could find: "Bags on the ground. Slowly."`;
  const choices = [
    {
      label: "Hand over some of what you carry", hint: `They take about ${pct(W.ROB_SHARE)} of the team's supplies (not the gear) and let you go`, ai: () => 0.25,
      resolve: (st) => { const lost = rob(st, p, W.ROB_SHARE, null, false); bump(st, "robbed"); goOn(st, p, opts); return `They take ${lost} and back away into the ruins.`; },
    },
    {
      label: "Talk them down", hint: `Speech check, ${pct(talk)}. They are desperate, not soldiers. Failure: they open fire`,
      ai: () => talk - (1 - talk) * (1 - odds(state, p, c.enemy, opts.site ? null : "enemy")), // a failed talk is a fight on their terms
      resolve: (st) => {
        const ok = st.rng.chance(talk);
        gainXp(st, talker(st, p), "speech", USE.talk + (ok ? USE.talkWon : 0));
        if (!ok) { bump(st, "hostile-talk-fail"); return fight(st, p, c, opts.site ? null : "enemy", "They are not listening. Someone fires first."); }
        bump(st, "hostile-talk-ok");
        let extra = "";
        if (st.rng.chance(W.JOIN_AFTER_TALK)) {
          const s = makeCandidate(st, { quality: 0.8, minHealth: 40 });
          extra = ` As the others leave, ${s.name} hangs back and asks to come with you instead.`;
          offerRecruits(st, [s], { source: "wanderer", partyId: p.id, title: "One of them asks to join", intro: `${s.name} was with the people who tried to rob you, and is tired of it.` });
        }
        goOn(st, p, opts);
        return `Weapons lower. Nobody wants to die over a bag of beans.${extra}`;
      },
    },
  ];
  if (!opts.site) {
    choices.push({
      label: "Run for it", hint: `Stealth check, ${pct(run)}. Failure: they catch you and the fight starts on their terms`, ai: () => run * 0.7,
      resolve: (st) => {
        if (st.rng.chance(run)) { bump(st, "ran"); goOn(st, p, opts); return "You scatter and regroup further on. Nobody follows."; }
        return fight(st, p, c, "enemy", "They cut you off before you get clear.");
      },
    });
  }
  choices.push(fightChoice(state, p, c, opts.site ? null : "enemy", "Fight"));
  return card(state, p, opts, opts.site ? "Squatters with guns" : "Armed strangers", text, choices);
}

// Aggressive survivors you saw first (waiting by the road).
function hostileSeenCard(state, p, n) {
  n = sized(state, p, n);
  const c = { type: "hostile", enemy: hostileEnemy(n) };
  const sneak = skillChance(bestSkill(state, p, "stealth") + (isNight(state) ? 1 : 0), 8 + Math.round(n / 3));
  const text = n === 1 ? "From cover you see someone with a shotgun crouched behind a wreck by the road, watching the way you were heading. They have not seen you."
    : `From cover you see ${NUM[n] || n} armed people crouched behind a wreck by the road, watching the way you were heading. They have not seen you.`;
  return card(state, p, {}, "Armed strangers ahead", text, [
    {
      label: "Slip around them", hint: `Stealth check, ${pct(sneak)}. Failure: they spot you and it turns into a hold-up`, ai: () => sneak,
      resolve: (st) => {
        if (st.rng.chance(sneak)) { bump(st, "sneaked"); resume(st, p); return "You loop wide through the scrub. They never knew you were there."; }
        addCard(st, hostileCard(st, p, n, {}));
        return "";
      },
    },
    {
      label: "Wait for them to move on (3 hours)", hint: "Safe, but slow: the team loses three hours", ai: () => 0.4,
      resolve: (st) => { delay(p, 3); bump(st, "waited"); resume(st, p); return "Eventually they get bored and drift away toward the town."; },
    },
    fightChoice(state, p, c, "player", "Ambush them"),
  ]);
}

// Aggressive survivors robbing neutrals: help the victims (they fight beside you as a third side), or not.
function robberyCard(state, p, n, g) {
  n = sized(state, p, n);
  const victims = g.people.length;
  const third = [{ side: "neutral", kind: "survivors", count: victims, power: W.NEUTRAL_POWER, name: victims === 1 ? first(g.people[0]) : "the travellers", wid: g.wid, people: g.people.map((s) => ({ name: s.name, weapon: s.gear.weapon ? s.gear.weapon.key : "fists", hp: s.health, s })) }];
  const c = { type: "rescue", enemy: hostileEnemy(n), wid: g.wid, third, allyPower: victims * W.NEUTRAL_POWER * 0.5 };
  const sneak = skillChance(bestSkill(state, p, "stealth") + (isNight(state) ? 1 : 0), 8 + Math.round(n / 3));
  const text = `Up ahead, ${n === 1 ? "an armed stranger has" : `${NUM[n] || n} armed strangers have`} stopped ${lookOf(victims)} (${names(g.people)}) and ${n === 1 ? "is" : "are"} going through their bags at gunpoint. Nobody has noticed you.`;
  return card(state, p, {}, "A robbery", text, [
    fightChoice(state, p, c, "player", "Help them: hit the robbers", "The travellers fight beside you, and will be grateful"),
    {
      label: "Slip away", hint: `Stealth check, ${pct(sneak)}. Failure: the robbers turn on you`, ai: () => sneak * 0.6,
      resolve: (st) => {
        g.lastMet = st.hour; // they never knew you: not met
        if (st.rng.chance(sneak)) { bump(st, "sneaked"); hurtGroup(st, g, 1); resume(st, p); return "You back off. The shouting fades behind you."; }
        addCard(st, hostileCard(st, p, n, {}));
        return "";
      },
    },
  ]);
}
// The robbers hurt someone you left with them (light: one of them may not make it).
function hurtGroup(state, g, k) {
  if (hash01(state.seed, "wander-robbed", g.wid, state.hour) < 0.3 && g.people.length > k - 1) {
    const s = g.people.pop();
    s.dead = true;
    bump(state, "died");
  }
}

// A military squad on the road or at a site (not hostile: a hostile one is a checkpoint, conflicts.js).
export function squadCard(state, p, f, n, opts = {}) {
  f.known = true;
  const att = attitude(f).toLowerCase();
  const enemy = { kind: "soldiers", count: n, power: squadPower(f), factionId: f.id, name: `the ${f.name.replace(/^The /, "")} squad` };
  const c = { type: "attackSquad", site: !!opts.site, enemy, factionId: f.id };
  const text = opts.site ? `A ${f.name} squad of ${NUM[n] || n} is clearing ${tileLabel(state, partyTile(p))} room by room. They are ${att}: the sergeant waves you over.`
    : `${cap(NUM[n] || String(n))} soldiers of ${f.name} come up the road in a loose file, rifles up, checking the ditches. They are ${att} and stop to size you up.`;
  const hives = (state.hives || []).filter((h) => state.grid.distance(h.tile, partyTile(p)) <= 20);
  const choices = [
    {
      label: opts.site ? "Work alongside them" : "Share news and move on",
      hint: opts.site ? `They clear the dead as you search (Heat −15); goodwill +${W.GW_ASIDE} with ${f.name}` : `Goodwill +${W.GW_NEWS} with ${f.name}; they mark their base${hives.length ? " and the hives they know of" : ""} on your map`,
      ai: () => 1,
      resolve: (st) => {
        bump(st, "squad-news");
        if (opts.site) {
          changeGoodwill(st, f, W.GW_ASIDE, "you worked alongside their soldiers");
          if (st.engagement && st.engagement.partyId === p.id) st.engagement.heat = Math.max(0, st.engagement.heat - 15);
          return "The soldiers take the ground floor; your people take the back rooms. The dead go down quietly.";
        }
        changeGoodwill(st, f, W.GW_NEWS, "you shared news with their soldiers");
        f.lastDiplomacy = day(st);
        for (const b of f.bases) p.seen.set(b, snapshot(st, b));
        for (const h of hives) p.seen.set(h.tile, snapshot(st, h.tile));
        resume(st, p);
        return `They trade what they know and push on.${hives.length ? ` They mark ${hives.length === 1 ? "a hive" : `${hives.length} hives`} on your map.` : ""}`;
      },
    },
    {
      label: "Keep your distance", hint: "Nothing gained, nothing lost", ai: () => 0.2,
      resolve: (st) => { goOn(st, p, opts); return "You step aside and let them pass."; },
    },
    fightChoice(state, p, c, opts.site ? null : "player", "Open fire on them", `Goodwill ${W.GW_ATTACK} with ${f.name}, and every soldier there fights back`),
  ];
  const atk = choices[2];
  const run = atk.resolve;
  atk.ai = () => -1;
  atk.resolve = (st) => { changeGoodwill(st, f, W.GW_ATTACK, "you fired on their soldiers"); return run(st); };
  return card(state, p, opts, opts.site ? `Soldiers in ${tileLabel(state, partyTile(p))}` : "A military squad", text, choices);
}

// A squad fighting the dead: help them (the soldiers are a third side beside you), watch, or slip away.
function squadFightCard(state, p, f, n, dead) {
  f.known = true;
  const t = state.tiles[partyTile(p)];
  const enemy = { kind: "zombies", count: dead, power: 1 + zombieToughness(state, t.id), name: "the dead" };
  const third = [{ side: "military", kind: "soldiers", count: n, power: squadPower(f), name: `the ${f.name.replace(/^The /, "")} squad`, factionId: f.id }];
  const c = { type: "helpSquad", enemy, factionId: f.id, third, allyPower: n * squadPower(f) * 0.8 };
  const text = `Gunfire ahead: ${NUM[n] || n} ${f.name} soldiers are holding a crossroads against about ${dead} of the dead. They are giving ground.`;
  const squadWins = clamp(winOdds((n * squadPower(f)) / Math.max(0.1, dead * enemy.power), { kind: "zombies", count: dead, people: n }), 0.1, 0.95);
  return card(state, p, {}, "Soldiers fighting the dead", text, [
    fightChoice(state, p, c, "player", "Help them", `The soldiers fight beside you. Goodwill +${W.GW_HELP} with ${f.name}, and they may share their ammo`),
    {
      label: "Watch from cover", hint: `They hold about ${pct(squadWins)} of the time; either way you learn where their base is`, ai: () => 0.3,
      resolve: (st) => {
        for (const b of f.bases) p.seen.set(b, snapshot(st, b));
        resume(st, p);
        if (st.rng.chance(squadWins)) return "They hold. The last of the dead go down and the soldiers move on, dragging a wounded man.";
        const lost = Math.min(n, st.rng.int(1, 3));
        f.pop = Math.max(0, f.pop - lost);
        bump(st, "squad-lost", lost);
        return `The line breaks. ${cap(NUM[lost] || String(lost))} of the soldiers do not get away.`;
      },
    },
    {
      label: "Slip away", hint: "Leave them to it", ai: () => 0.2,
      resolve: (st) => { resume(st, p); return "You leave the gunfire behind you."; },
    },
  ]);
}

// ---------- after a fight ----------
// A neutral group's losses on the map: the people whose units fell (thirdside.js thirdResult deadPeople), else as many
// from the end of the list (a fight by the numbers); the rest keep the health the fight left them.
function fallen(state, g, r) {
  if (Array.isArray(r.deadPeople) && r.deadPeople.length) {
    for (const s of r.deadPeople) { const i = g.people.indexOf(s); if (i >= 0) { g.people.splice(i, 1); s.dead = true; s.alive = false; bump(state, "died"); } }
  } else for (let i = 0; i < r.dead && g.people.length; i++) { const s = g.people.pop(); s.dead = true; bump(state, "died"); }
  for (const [s, hp] of r.hurt || []) if (g.people.includes(s)) s.health = Math.max(1, Math.min(100, Math.round(hp)));
}
registerCombatHandler("wanderer", onWandererCombat);

function onWandererCombat(state, result, setup) {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId);
  const f = c.factionId != null ? factionById(state, c.factionId) : null;
  const rng = state.rng;
  bump(state, `fight-${result.outcome}`);
  const lines = c.lead ? [c.lead] : [];
  const third = result.third || null;
  const g = c.wid != null ? groupById(state, c.wid) : null;
  // The third side's losses (fought on the map), else by the numbers.
  if (third) for (const r of third) {
    if (r.team === "military" && f) {
      if (r.dead) f.pop = Math.max(0, f.pop - r.dead);
      if (r.hostile) changeGoodwill(state, f, W.GW_ATTACK, "you fired on their soldiers");
    }
    if (r.team === "neutral" && g) {
      fallen(state, g, r); // the very people who fell on the map (fighters.js), the rest with the health they kept
    }
    lines.push(...thirdPrisoners(state, r, r.team === "military" ? f : null, r.team === "neutral" ? g : null, setup.enemy));
  }
  if (c.type === "attackSquad" && f && result.enemiesKilled) f.pop = Math.max(0, f.pop - Math.ceil(result.enemiesKilled * 0.6));
  const dead = (result.survivorsDead || []).length;
  if (p && state.parties.includes(p) && !partyMembers(state, p).length) {
    const quiet = unheardEnvoy(p); // parties.js: an envoy out of radio coverage: heard of only when overdue (envoys.js)
    wipeParty(state, p);
    if (!quiet) log(state, `The whole team was lost fighting ${c.enemy.name}.`, "death");
    return;
  }
  if (!p || !state.parties.includes(p)) return;
  if (result.outcome === "victory") {
    lines.push(`You won. ${result.enemiesKilled || "Several"} of ${c.enemy.name} are down.`);
    if (!result.tactical && c.enemy.kind !== "zombies") {
      lines.push(`Taken from them: ${addCargoRounds(state, p, rng.int(c.type === "attackSquad" ? 20 : 3, c.type === "attackSquad" ? 50 : 12), c.type === "attackSquad" ? "military" : "raider", "wanderer", c.id ? localId(state, c.id) : 0, state.hour)}, ${addCargo(state, p, "food", rng.int(1, 4))} days of food.`); // rounds by calibre: what such people shoot (ammo.js)
      if (rng.chance(c.type === "attackSquad" ? 0.35 : 0.2)) {
        const key = swapGun(bodyGunSource(c.enemy.kind), rng.pick(c.type === "attackSquad" ? ["ar", "vest", "carbine"] : ["pistol", "knife", "bat", "revolver"]), rng); // gundist.js: a gun of their kind
        const item = lootItem(key, kitSource(c.enemy.kind), spend(rng)); // itemcond.js: by who they were
        lines.push(addGearToCargo(state, p, item) !== false && p.cargo.gear.includes(item) ? `Also a ${item.name}.` : `No room for the ${item.name} they had.`);
      }
    }
    if (c.type === "rescue" && g) {
      const hostile = third && third.some((r) => r.team === "neutral" && r.hostile);
      if (hostile) lines.push("The travellers you fired on want nothing more to do with you.");
      else if (g.people.length) { remember(state, g, p); g.talked = true; lines.push(`The travellers are safe. ${askJoin(state, p, g, `${names(g.people)} owe you their lives and ask to stay with you.`)}`); }
      else lines.push("None of the travellers made it.");
    }
    if (c.type === "helpSquad" && f) {
      const turned = third && third.some((r) => r.team === "military" && r.hostile);
      if (!turned) {
        changeGoodwill(state, f, W.GW_HELP, "you fought beside their soldiers");
        f.lastDiplomacy = day(state);
        for (const b of f.bases) p.seen.set(b, snapshot(state, b));
        lines.push(`The sergeant shakes your hand: ${addCargoRounds(state, p, rng.int(15, 30), "military", "sergeant", state.hour)} from their packs, and their base marked on your map.`);
        bump(state, "squad-helped");
      }
    }
  } else if (result.outcome === "retreat") {
    if (result.summary) lines.push(result.summary);
    const lost = c.enemy.kind === "survivors" && p.cargo && Object.values(p.cargo.supplies).some((q) => q >= 1) ? rob(state, p, 0.2, null, false, true) : "";
    lines.push(`You pulled back.${lost ? ` Some of the load was dropped: ${lost}.` : ""}`);
  } else {
    lines.push("You lost the fight and scattered.");
    if (c.enemy.kind === "survivors") lines.push(`They took ${rob(state, p, 0.45, null)}.`);
    else if (c.type === "attackSquad") lines.push(`The soldiers confiscate ${rob(state, p, 0.3, null)}.`);
  }
  if (dead) lines.push(`Dead: ${(result.survivorsDead || []).map((id) => (state.survivors.find((s) => s.id === id) || { name: "someone" }).name).join(", ")}.`);
  const text = lines.join(" ");
  log(state, `Fight near ${tileLabel(state, partyTile(p))}: ${result.outcome}.`, result.outcome === "victory" ? "good" : "danger");
  if (c.site) { log(state, text, "info"); return; }
  afterFight(state, p, { ...c, resumePhase: c.resumePhase }, text); // conflicts.js: carry on, return home, or wait
}

// Prisoners in a three-way fight (thirdside.js thirdResult): the third side's people who gave up to the enemy are
// led off by it (a group's soldiers: into the enemy group's jail, groupjails.js, or just gone from the squad; the
// travellers: gone from their group) or freed (goodwill with the soldiers' group, W.GW_FREED); the enemy's people
// who gave up to the soldiers go into their group's jail (to travellers: let go). f: the soldiers' group; g: the
// travellers' group. Returns lines for the fight's report.
export function thirdPrisoners(state, r, f, g, enemy) {
  const out = [];
  const ef = enemy && enemy.factionId != null ? factionById(state, enemy.factionId) : null;
  if (r.taken) {
    bump(state, "third-taken", r.taken);
    if (f) { f.pop = Math.max(0, f.pop - r.taken); if (ef && ef.alive) groupCapture(state, ef, f, r.taken); }
    if (g) for (let i = 0; i < r.taken && g.people.length; i++) g.people.pop();
    out.push(`${r.taken} of ${r.name} gave up and were led off by ${enemy ? enemy.name : "the attackers"}.`);
  }
  if (r.freed) {
    bump(state, "third-freed", r.freed);
    if (f && !r.hostile) changeGoodwill(state, f, W.GW_FREED, "you freed their soldiers");
    out.push(`${r.freed} of ${r.name} who had given up are free again.`);
  }
  if (r.held) {
    bump(state, "third-held", r.held);
    if (f && ef && ef.alive) { ef.pop = Math.max(0, ef.pop - r.held); groupCapture(state, f, ef, r.held); }
    out.push(f ? `${cap(r.name)} took ${r.held} of ${enemy ? enemy.name : "them"} prisoner.` : `${cap(r.name)} disarmed ${r.held} of ${enemy ? enemy.name : "them"} and let them go.`);
  }
  return out;
}

// ---------- after a raid on the map (scavenge.js afterRaid) ----------
// The neutrals you found (and did not fire on) can be talked to now; the soldiers remember how it went.
export function wanderersAfterRaid(state, p, result, tileId = null) {
  if (tileId != null && state.wanderers) siteMet(state, tileId);
  const third = result && result.third;
  if (!third) return;
  for (const r of third) {
    if (r.team === "military") {
      const f = factionById(state, r.factionId);
      if (!f) continue;
      if (r.dead) f.pop = Math.max(0, f.pop - r.dead);
      thirdPrisoners(state, r, f, null, null); // a raid: the site's people have no group to lead them off to
      if (r.hostile) { changeGoodwill(state, f, W.GW_ATTACK, "you fired on their soldiers"); bump(state, "raid-squad-attacked"); }
      else if (r.met) { changeGoodwill(state, f, W.GW_ASIDE, "you kept out of their soldiers' way"); bump(state, "raid-squad-met"); }
      continue;
    }
    const g = groupById(state, r.wid);
    if (!g) continue;
    fallen(state, g, r); // the very people who fell on the map (fighters.js), the rest with the health they kept
    thirdPrisoners(state, r, null, g, null);
    if (r.hostile) {
      if (p && state.parties.includes(p)) for (const m of partyMembers(state, p)) m.mood = clamp(m.mood - 4, 0, 100);
      bump(state, "raid-neutral-attacked");
      continue;
    }
    if (!r.met || r.noCard || !g.people.length || !p || !state.parties.includes(p) || !partyMembers(state, p).length) continue; // noCard: they agreed to join on the map (parley.js: its recruit card)
    bump(state, "raid-neutral-met");
    addCard(state, neutralCard(state, p, g, { site: true }));
  }
}

// ---------- the people you left (once a day, world.js) ----------
export function wanderersDaily(state) {
  const ws = state.wanderers;
  if (!ws) return;
  const d = day(state);
  // Site rolls from before the last window are dropped.
  const win = Math.floor(state.hour / W.SITE_WINDOW);
  for (const k of Object.keys(ws.sites)) if (Number(k.split(":")[1]) < win - 1) delete ws.sites[k];
  if (!ws.groups.length) return;
  const S = W.SIM;
  const g0 = state.grid;
  for (const g of [...ws.groups]) {
    // Those who joined you (or are walking to a base, or died) are no longer out here.
    g.people = g.people.filter((s) => !s.dead && !state.survivors.includes(s) && !s.walking);
    const gone = () => ws.groups.splice(ws.groups.indexOf(g), 1);
    if (!g.people.length) { gone(); continue; }
    const h = (k) => hash01(state.seed, "wander-sim", g.wid, d, k);
    if (h("move") < S.MOVE) {
      const next = g0.within(g.tile, 1).filter((id) => id !== g.tile && state.tiles[id].terrain !== "water" && !state.tiles[id].hive);
      if (next.length) g.tile = next[Math.floor(h("where") * next.length)];
    }
    const t = state.tiles[g.tile];
    const horde = state.hordes.some((x) => g0.distance(x.tile, g.tile) <= 1);
    if (h("die") < S.DIE + (t.infection || 0) * S.DIE_INF + (horde ? S.DIE_HORDE : 0)) {
      const s = g.people.pop();
      s.dead = true;
      bump(state, "died");
      if (!g.people.length) { gone(); continue; }
    }
    const n = g.people.length;
    const band = bandsOf(state).find((b) => b.pop > 0 && g0.distance(b.tile, g.tile) <= 2);
    if (band && h("band") < S.JOIN_BAND) { band.pop += n; bump(state, "joined-band", n); gone(); continue; }
    // A group with a base within 3 tiles may take them in (groupcare.js: its type, food and beds, their mood; raiders
    // press-gang); their gear goes into its arsenal.
    const f = state.factions.find((x) => x.alive && !x.outsider && x.bases.length && Math.min(...x.bases.map((b) => g0.distance(b, g.tile))) <= 3);
    if (f && g.kind !== "hostile" && h("group") < wandererJoinChance(state, f, g)) { wandererJoins(state, f, g); bump(state, "joined-group", n); gone(); continue; }
    if (d - g.since > S.SETTLE_AFTER && h("settle") < S.SETTLE) { bump(state, "settled", n); gone(); continue; }
  }
}
