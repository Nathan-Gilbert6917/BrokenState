// Conflict encounters on the road, captives and rescue.
//
// While travelling, a team can run into other people (or a surge of the dead). A perception roll
// decides who sees whom first:
//   forced   - they found you first (ambush, roadblock, zealot patrol, checkpoint, a surge of the
//              dead). Limited reactions: run, surrender, talk / bribe, fight.
//   observed - you spotted them and they have not seen you (a camp by the road, raiders robbing
//              someone, two groups fighting, the dead swarming survivors, prisoners on the move).
//              Watch, slip away, ambush, talk, or take a side.
// Fights go through combat.js (startCombat + a registered handler), so they work the same whether
// the battle resolves instantly or on the tactical battle screen.
// A group that overheard a caravan of yours on the radio (intel.js g.lying) lies in wait for it: it is met
// INTEL.AMBUSH.MULT × as often, INTEL.AMBUSH.RANGE tiles further from their bases, and sees the team first more often.
//
// Captured survivors get location { kind: "captive", factionId, tile, since }. They can be
// rescued (Rescue mission: sneaked or stormed out on their base's map, rescueraid.js, or by the numbers here),
// ransomed (by radio or envoy with any group, raiders included: ransom.js; during a trade visit or at the gates), or
// released when goodwill is high. Over time they may escape (likelier with a pin, lockpicks or the keys they kept:
// location.tool), be recruited by their captors, or die.
import { hasWall } from "./buildings.js"; // a wall closed round a base of yours (the raid's siege kit)
import { spendAmmo } from "./rounds.js"; // a group's rounds by calibre
import { takeFood, FOODS } from "./foods.js"; // their food, days of it
import { TERRAIN, GEAR, SUPPLIES, FACTION_TYPES, supValue } from "./data.js";
import { zombieToughness } from "./hives.js";
import { stripAll, itemLoad, lootItem, armouredItem, allCarried } from "./inventory.js";
import { isRoundItem } from "./itemstack.js";
import { joinFromYours } from "./members.js"; // one of yours who turns goes over as themselves
import { kitSource, spend } from "./itemcond.js";
import { hasTrait, teamTraitFx, encounterMult, bribeMult } from "./traits.js"; // Fleet-Footed, Slow: a team on foot that runs from trouble; Night Owl; Strategic: fewer encounters; Diplomatic: cheaper bribes
import {
  log, addCard, day, hub, skill, hurt, isNight, factionById, snapshot, makeSurvivor, combatPower, alive, survivorById, checkGameOver,
  usesArrows,
} from "./world.js";
import {
  partyMembers, bestSkill, partyTile, tileLabel, partyCapacity, cargoLoad, cargoRoom, unitsThatFit, wipeParty, awaitOrders,
  removeParty, startReturn, STANCES,
} from "./parties.js";
import * as Parties from "./parties.js";
import { partyFuel, useFuel, partyVehicle, partyVehicles, createVehicle, VEHICLE_TYPES, fitTechnical, raidTurret, loseRaidHumvee, humveeLeftText, wearRaidHumvee } from "./vehicles.js";
import { attitude, changeGoodwill, isAggressiveType, collapseFaction, resolveRaidOnPlayer, raidRepelled, groupBroken } from "./factions.js";
import { raidDamage } from "./breakdowns.js";
import { perceptionChance, markAbandonedVehicle } from "./markers.js";
import { registerCombatHandler, startCombat, battlePending, byNumbersOdds } from "./combat.js";
import { advanceTradeQueue, tradePending } from "./trade.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { travelEffects } from "./weather.js";
import { opticsFor } from "./optics.js";
import { noteRescue } from "./relations.js";
import { anyPerk, hasPerk, gainXp, gainXpAll, USE } from "./skills.js";
import { driveOff } from "./aiscav.js";
import { warRaidOnPlayer } from "./diplomacy.js";
import { pwarTeamMult, pwarTeamRange } from "./playerwars.js"; // wars with you: their patrols hunt your teams
import { retreatFrom } from "./conquest.js";
import { siteDeadMix, armoredOf, maxMix, bodyLoot } from "./deadsoldiers.js";
import { beastMix } from "./deadbeasts.js"; // the dead beasts of the hills, the woods and the farmland
import { convoyGuards } from "./miltrucks.js"; // an Army convoy's guard among the dead met there
import { siteList } from "./zombietypes.js";
import { siteSpecials } from "./hivetech.js"; // the special dead met exploring
import { widenMix } from "./deadpool.js"; // the dead the years bring, whatever the hives do
import { keyWord } from "./water.js"; // "un-purified water" in texts
import { totalIn, sumRecs, ROUND_KEYS, isRoundKey } from "./rounds.js"; // rounds by calibre
import { addFindVia, kindTheme, findRounds, calRounds, partyCals, roundsText } from "./ammo.js";
import { hostileOutsiderOn, outsiderAttackCard } from "./visitors.js"; // outsiders on the same tile (contactAttack)
import { unitPower, addToArsenal, keepItem, arsenalWorthy, captureVehicle, arsenalText } from "./arsenal.js"; // group arsenals: their people's power by their kit; what they take goes into it
import { applyStolen } from "./basemap.js"; // the base map: what raiders got away with from the stores on it
import { captiveEscape, captiveDecline, captiveTurnMult, groupJailGuards } from "./groupjails.js"; // jailhouse: their jail's tier, the work they are put to
import { startRescueRaid, tacticalPossible, jailTier, JAIL } from "./rescueraid.js"; // the rescue played out on their base's map
import { weightOf } from "./groupcare.js"; // GROUP_PRIORITIES: each type's numbers on the road (meetOdds, stop, talkDc, bribes, pacts, ransoms, captives)
import { lyingFor, ambushSprung, INTEL } from "./intel.js"; // a group that overheard your caravan's route lies in wait
import { swapGun, bodyGunSource } from "./gundist.js"; // the gun distribution: a gun off their dead
import { marchingNow, NIGHT_MARCH } from "./nightmarch.js"; // pushing on through the night: more run-ins
import { note, goodsRounds } from "./ledger.js"; // the conservation test's ledger (off in play)
import { carriedRec } from "./ammo.js"; // the loose rounds people carry

// ---------- small helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (c) => `${Math.round(c * 100)}%`;
const first = (s) => s.name.split(" ")[0];
const names = (list) => list.map(first).join(", ");
const skillChance = (s, dc) => clamp((s + 10 - dc + 1) / 10, 0.05, 0.95);

export const COOLDOWN_HOURS = 20; // a team sees at most one conflict per this many hours

// Battle kit per group type (combat.js KITS). Every group fields humans only; "mixed" (humans plus the dead) is
// for places where both are found, like scavenge sites.
const KIND_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };
// How often a not-hostile group of an unknown type crosses your team's path (each type's: GROUP_PRIORITIES meetOdds).
const MEET_ODDS = 0.12;
const NOUN_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "guards", traders: "guards", commune: "militia" };

export const CONFLICT_TYPES = {
  // forced: they found you first
  ambush:       { mode: "forced",   name: "Ambush" },
  roadblock:    { mode: "forced",   name: "Roadblock" },
  zealotpatrol: { mode: "forced",   name: "Zealot patrol" },
  checkpoint:   { mode: "forced",   name: "Checkpoint" },
  challenge:    { mode: "forced",   name: "Challenged" },
  contest:      { mode: "forced",   name: "A contested site" }, // their scavengers and your team at the same site (aiscav.js)
  surge:        { mode: "forced",   name: "The dead surge" },
  // observed: you saw them first
  camp:         { mode: "observed", name: "Camp by the road" },
  robbery:      { mode: "observed", name: "A robbery" },
  skirmish:     { mode: "observed", name: "A firefight" },
  hordeattack:  { mode: "observed", name: "Survivors in trouble" },
  prisoners:    { mode: "observed", name: "Prisoners on the move" },
};

function stats(state) {
  if (!state.stats.conflicts) state.stats.conflicts = { types: {}, outcomes: {}, captured: 0, rescued: 0, joined: 0, captiveEvents: {} };
  return state.stats.conflicts;
}
function bump(state, key, sub) {
  const s = stats(state);
  s[key][sub] = (s[key][sub] || 0) + 1;
}

// Combat handlers are registered as this module loads, so a battle finishes correctly however it was started
// (combat.js builds its handler table on first use, which also works while the modules are still initialising).
registerCombatHandler("conflict", onConflictCombat);
registerCombatHandler("rescue", onRescueCombat);
registerCombatHandler("raidDefense", onRaidDefenseCombat);

function check(state, p, key, dc, bonus = 0) {
  const chance = skillChance(bestSkill(state, p, key) + bonus, dc);
  return state.rng.chance(chance);
}

export function addCargo(state, p, key, qty) {
  if (key === "food" || key === "preserved") return Parties.addFoodCargo(state, p, key, qty); // parties.js: days of food as items (foods.js)
  const room = cargoRoom(state, p);
  const take = Math.min(unitsThatFit(room, key), Math.max(0, Math.floor(qty)));
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + take;
  return take;
}

// n rounds into the cargo as far as the room goes, named by calibre (2026-10-09, user request: "All ammo should be
// based on caliber"): with a theme (data-ammo.js AMMO_MIX: what the people they came from shoot) the rounds such a
// place or group holds, else the common rounds of the team's guns. Returns the words ("20 9mm FMJ and 10 12 gauge 00
// buckshot"; "no rounds" when nothing fitted).
/** @param {any} state @param {any} p @param {number} n @param {string | null} [theme] @param {...any} salt */
export const addCargoRounds = (state, p, n, theme = null, ...salt) => roundsText(addCargoRoundsRec(state, p, n, theme, ...salt));
// The same, returning what fitted by key ({ key: q }).
/** @param {any} state @param {any} p @param {number} n @param {string | null} [theme] @param {...any} salt */
export function addCargoRoundsRec(state, p, n, theme = null, ...salt) {
  const parts = theme ? findRounds(theme, n, ...salt) : calRounds(n, partyCals(state, p));
  /** @type {Record<string, number>} */
  const got = {};
  for (const [k, q] of Object.entries(parts)) { const t = addCargo(state, p, k, q); if (t > 0) got[k] = t; }
  return got;
}

// Ammo the team can shoot with: packed plus found (both pools are used in a fight, combat.js); the same for the arrows
// its bows and crossbows shoot.
const carriedOf = (p, k) => Math.max(0, Math.floor(p.supplies[k] || 0)) + Math.max(0, Math.floor((p.cargo && p.cargo.supplies[k]) || 0));
const carriedAmmo = (p) => totalIn(p.supplies, p.cargo && p.cargo.supplies); // every round, any calibre (rounds.js)
const carriedRounds = (p, people = []) => sumRecs(p.supplies, p.cargo && p.cargo.supplies, carriedRec(people)); // by key: the armed factor judges each gun by its own calibre; and the rounds they carry at hand (ammo.js carriedRec)

// Bonus gear goes into the cargo only if there is room for it (parties.js addGearToCargo when it exists).
function stowGear(state, p, item) {
  if (typeof Parties.addGearToCargo === "function") {
    Parties.addGearToCargo(state, p, item);
    return p.cargo.gear.includes(item);
  }
  if (cargoRoom(state, p) < itemLoad(item)) return false;
  p.cargo.gear.push(item);
  return true;
}

// The quick resolver's own odds (combat.js byNumbersOdds), shown to the player: the team's power with the rounds and
// arrows it carries, a group's very people on the other side (docs/adr/0001-ai-parity.md), an ambush, the vehicles.
export function fightOdds(state, p, enemy, ambush) {
  const people = partyMembers(state, p);
  if (!people.length) return 0;
  return byNumbersOdds(state, { tile: partyTile(p), partyId: p.id, enemy: { ...enemy }, ambush }, people, { ammo: carriedRounds(p, people), arrows: carriedOf(p, "arrows") }).win;
}

function enemyGroup(state, p, f, scale = 1, horde = null) {
  const rng = state.rng;
  const n = partyMembers(state, p).length;
  if (!f) {
    const t = state.tiles[partyTile(p)];
    const count = Math.round((5 + t.infection * 14 + (isNight(state) ? 3 : 0)) * scale * rng.range(0.8, 1.25));
    // On a hive's land the dead are tougher: +1 power, +3 on the red-skull ring around a hive (hives.js).
    const hz = zombieToughness(state, partyTile(p));
    // The armoured dead (deadsoldiers.js): by a military site, or the ones a horde picked up crossing one.
    // The bred kinds met away from a hive's hordes (hivetech.js siteSpecials: towns and cities as the years go by, a
    // hive's land): each of the dead one of them at its share (a roll each).
    // The dead beasts of the land (deadbeasts.js beastMix), or the ones a horde picked up crossing it.
    const mix = maxMix(maxMix(maxMix(maxMix(siteDeadMix(state, partyTile(p)), armoredOf(horde && horde.mix)), horde ? null : siteSpecials(state, partyTile(p))), horde ? null : beastMix(state, partyTile(p))), horde ? null : widenMix(state, partyTile(p))); // deadpool.js: the dead the years bring
    const g = { kind: "zombies", count: Math.max(4, count), power: 1 + hz, name: hz >= 3 ? "the hive's dead" : "the dead" };
    if (mix) {
      g.mix = mix;
      g.types = {};
      for (const k of siteList(rng, mix, g.count)) if (k) g.types[k] = (g.types[k] || 0) + 1;
      if (!Object.keys(g.types).length) g.types = null;
    }
    // At an Army convoy nobody has stripped: its guard of dead soldiers comes too (miltrucks.js convoyGuards; no dice).
    const guard = horde ? 0 : convoyGuards(state, partyTile(p));
    if (guard) { g.count += guard; g.types = { ...(g.types || {}), soldier: ((g.types && g.types.soldier) || 0) + guard }; }
    return g;
  }
  const def = FACTION_TYPES[f.type];
  let count = Math.round((n * rng.range(0.8, 1.5) + 1) * scale);
  count = clamp(count, 2, Math.max(2, Math.min(10, Math.floor(f.pop / 3))));
  return { kind: KIND_OF[f.type], count, power: Math.round(unitPower(f, 2.2) * 10) / 10, factionId: f.id, name: `${f.name} ${NOUN_OF[f.type]}` }; // arsenal.js: 2.2 + arms × 1.6 × their kit
}

function minBaseDist(state, f, tileId) {
  return Math.min(...f.bases.map((b) => state.grid.distance(b, tileId)));
}

// Pay a value from what the team carries (found cargo first). Returns the plan, or null if short. Food by type
// (foods.js): whole items, the soonest to spoil first (by the catalog's shelf).
export function payPlan(p, value) {
  const plan = {};
  let left = value;
  for (const pool of [p.cargo.supplies, p.supplies]) {
    const foods = Object.keys(pool).filter((k) => FOODS[k]).sort((a, b) => FOODS[a].shelf - FOODS[b].shelf);
    const order = ["scrap", "parts", "ammo", ...ROUND_KEYS, "meds", "fuel", ...foods, "rawwater", "water"]; // rounds by calibre after any generic ammo (rounds.js)
    for (const k of order) {
      if (left <= 0) break;
      const have = Math.floor(pool[k] || 0);
      if (have <= 0 || !SUPPLIES[k]) continue;
      const q = Math.min(have, Math.ceil(left / supValue(k)));
      if (q <= 0) continue;
      plan[k] = (plan[k] || 0) + q;
      left -= q * supValue(k);
    }
  }
  return left > 0 ? null : plan;
}
const planText = (plan) => Object.entries(plan).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ");
// state: given, the rounds paid to a group are noted (ledger.js, a test switch).
function payFrom(p, plan, f, state = null) {
  for (const [k, q] of Object.entries(plan)) {
    const fromCargo = Math.min(q, Math.floor(p.cargo.supplies[k] || 0));
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) - fromCargo;
    p.supplies[k] = (p.supplies[k] || 0) - (q - fromCargo);
    if (f) { f.stock[k] = (f.stock[k] || 0) + q; if (isRoundKey(k) || k === "ammo") note(state, "from you", q); } // rounds by key, as yours (docs/adr/0001-ai-parity.md)
  }
}
const carriedValue = (p) => Object.keys(SUPPLIES).reduce((a, k) => a + (Math.floor(p.supplies[k] || 0) + Math.floor(p.cargo.supplies[k] || 0)) * supValue(k), 0);

// Robbery: a share of everything carried goes to the faction (or is lost).
export function rob(state, p, frac, f, takeGear = true, cargoOnly = false) {
  const taken = {};
  for (const pool of cargoOnly ? [p.cargo.supplies] : [p.supplies, p.cargo.supplies]) {
    for (const k of Object.keys(pool)) {
      const q = Math.floor((pool[k] || 0) * frac);
      if (q <= 0) continue;
      pool[k] -= q;
      taken[k] = (taken[k] || 0) + q;
      if (f) { f.stock[k] = (f.stock[k] || 0) + q; if (isRoundKey(k) || k === "ammo") note(state, "taken from you", q); } // rounds by key, as yours (docs/adr/0001-ai-parity.md); ledger.js
    }
  }
  const gear = takeGear ? p.cargo.gear.splice(0) : [];
  if (f) for (const g of gear) { f.lootedGear.push(g.name); keepItem(state, f, g, "stolen"); } // arsenal.js: guns, armour and explosives they will use, the rest on their shelf
  const parts = Object.entries(taken).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${keyWord(k)}`);
  if (gear.length) parts.push(...gear.map((g) => g.name));
  return parts.length ? parts.join(", ") : "nothing much";
}

export function injure(state, p, min, max, cause) {
  const m = partyMembers(state, p);
  if (!m.length) return "";
  const v = state.rng.pick(m);
  hurt(state, v, state.rng.int(min, max), partyTile(p), cause);
  if (!partyMembers(state, p).length) wipeParty(state, p);
  return v.alive ? `${first(v)} was hurt.` : `${v.name} was killed.`;
}

// Someone who asks to join after a road fight: a candidate, not in the group yet (recruits.js). askToJoin puts them
// on a recruit card: take them along if the team's rations allow, send them to a base on foot, give them supplies
// and part ways, or turn them away (stats.conflicts.joined counts those who join the team).
function newRecruit(state, p) {
  return makeCandidate(state, { quality: 0.85, minHealth: 40 });
}
function askToJoin(state, p, list, intro = "") {
  if (!list.length || !state.parties.includes(p)) return;
  offerRecruits(state, list, { source: "road", partyId: p.id, title: list.length === 1 ? "Someone asks to join" : "Survivors ask to join", intro });
}

// ---------- captives ----------
export const isCaptive = (s) => s.alive && s.location && s.location.kind === "captive";
export const captivesOf = (state, factionId) => state.survivors.filter((s) => isCaptive(s) && s.location.factionId === factionId);
export const allCaptives = (state) => state.survivors.filter(isCaptive);

export function takeCaptive(state, s, f, p) {
  if (p) p.members = p.members.filter((id) => id !== s.id);
  // Everything on them is taken: worn, held, pockets and pack (inventory.js).
  const kit = stripAll(s);
  note(state, "taken from you", goodsRounds(kit)); // ledger.js: the rounds in their guns, magazines and boxes come over to the AI side
  for (const g of kit) { f.lootedGear.push(`${first(s)}'s ${g.name}`); keepItem(state, f, g, "stolen"); } // arsenal.js: the kit onto their books, the rest on their shelf
  s.station = null;
  // fresh: their captors have still to find room for them (groupjails.js groupJailsHour: jailed, or sold, ransomed at
  // once, let go or killed when their jail is full).
  s.location = { kind: "captive", factionId: f.id, tile: f.bases[0], since: state.hour, fresh: true };
  stats(state).captured += 1;
  log(state, `${s.name} was taken prisoner by ${f.name}.`, "danger");
}

export function freeCaptive(state, s, p) {
  s.location = { kind: "party", partyId: p.id };
  if (!p.members.includes(s.id)) p.members.push(s.id);
  s.mood = Math.min(100, s.mood + 15);
  stats(state).rescued += 1;
  noteRescue(state, s, p); // relations.js: the rescuers' service record, and a bond with the one they freed
}

function releaseHome(state, s) {
  s.location = { kind: "base", baseId: hub(state).id };
  s.role = "rest";
}

// If the whole team is gone (captured), the party ends: the vehicle is seized.
function endIfEmpty(state, p, f) {
  if (!state.parties.includes(p) || partyMembers(state, p).length) return false;
  for (const v of partyVehicles(state, p)) { // every one of the team's (vehicles.js fleets)
    state.vehicles.splice(state.vehicles.indexOf(v), 1);
    if (f) captureVehicle(f, v, state); // arsenal.js: it is theirs now (f.vehicles), and anything left in it
    log(state, `${f ? f.name : "They"} took the ${v.name}.`, "danger");
  }
  if (f) {
    rob(state, p, 1, f);
  }
  removeParty(state, p);
  return true;
}

// Surrender terms by group type: who robs you, who takes prisoners.
export function surrenderTerms(state, f) {
  const att = attitude(f);
  switch (f.type) {
    case "zealot":
      return { rob: 0.7, gear: true, capturePer: att === "Hostile" ? 0.5 : 0.3, text: `Zealots are harsh: they take most of what you carry and all spare gear, and each of you has a ${pct(att === "Hostile" ? 0.5 : 0.3)} chance of being dragged off to ${f.name}'s base.` };
    case "raider":
    case "expansionist": {
      const c = f.goodwill < -50 ? 0.35 : 0.15;
      return { rob: 0.5, gear: true, captureOne: c, text: `They take about half of your supplies and cargo, and all carried gear. ${pct(c)} chance they keep one of you as a prisoner.` };
    }
    case "military":
    case "fortress": {
      const c = att === "Hostile" ? 0.25 : 0.05;
      return { rob: 0.3, gear: true, captureOne: c, text: `They confiscate about a third of what you carry and any spare gear. ${pct(c)} chance they detain one of you.` };
    }
    default:
      return { rob: 0.2, gear: false, captureOne: 0, text: "They take a fifth of your supplies as a toll and let you go. Your gear is left alone." };
  }
}

function applySurrender(state, p, c, f) {
  const terms = surrenderTerms(state, f);
  const rng = state.rng;
  const lost = rob(state, p, terms.rob, f, terms.gear); // exactly what the terms say: gear only where they name it
  const caught = [];
  const members = partyMembers(state, p);
  if (terms.capturePer) for (const m of members) if (rng.chance(terms.capturePer)) caught.push(m);
  if (terms.captureOne && members.length && rng.chance(terms.captureOne)) caught.push(rng.pick(members));
  for (const s of new Set(caught)) takeCaptive(state, s, f, p);
  bump(state, "outcomes", caught.length ? "surrender-captured" : "surrender-robbed");
  let text = `${f.name} took ${lost}.`;
  if (caught.length) text += ` They kept ${names([...new Set(caught)])} as prisoner${caught.length > 1 ? "s" : ""} at their base. Send a Rescue team, ransom them during a trade visit, or win their goodwill.`;
  if (endIfEmpty(state, p, f)) return `${text} The whole team is now held by ${f.name}.`;
  resume(state, p);
  return `${text} The rest of the team is let go.`;
}

// ---------- rolling encounters ----------
// Returns { chance, sources } for the tile a team just entered.
export function conflictChance(state, p, tileId) {
  const t = state.tiles[tileId];
  const sources = [];
  let humans = 0;
  for (const f of state.factions) {
    if (!f.alive || !f.bases.length) continue;
    const d = minBaseDist(state, f, tileId);
    const lying = lyingFor(state, f, p); // intel.js: they heard this caravan's route on your radio and wait for it
    const reach = pwarTeamRange(state, f) + (lying ? INTEL.AMBUSH.RANGE : 0); // playerwars.js: a group at war with you hunts your teams further out
    if (d > reach) continue;
    const att = attitude(f);
    let w = att === "Hostile" ? 1 : weightOf(f, "meetOdds", MEET_ODDS); // groupcare.js GROUP_PRIORITIES meetOdds
    if (f.pact) w *= 0.5;
    w *= (1 - d / (reach + 1.5)) * pwarTeamMult(state, f) * (lying ? INTEL.AMBUSH.MULT : 1);
    if (t.owner === f.id) w *= 1.4;
    humans += w;
    sources.push({ f, w });
  }
  // AI war parties and convoys passing close by.
  for (const q of state.parties) {
    if (q.owner === "player" || q.phase === "siege") continue;
    if (state.grid.distance(partyTile(q), tileId) > 1) continue;
    const f = factionById(state, q.owner);
    if (!f || !f.alive) continue;
    humans += 0.6;
    sources.push({ f, w: 0.6, aiParty: q });
  }
  const hordeNear = state.hordes.some((h) => state.grid.distance(h.tile, tileId) <= 2);
  const z = Math.max(0, t.infection - 0.25) * 2 + (hordeNear ? 0.4 : 0);
  if (z > 0) sources.push({ zombies: true, w: z * 0.6 });
  const traffic = TERRAIN[t.terrain].traffic + (t.road ? 0.15 : 0);
  let chance = 0.1 * humans + 0.06 * z + traffic * 0.08;
  const marching = marchingNow(state, p); // pushing on through the night (nightmarch.js): more trouble finds it
  if (marching) chance *= NIGHT_MARCH.CONFLICT;
  else if (isNight(state)) chance *= 1.25;
  chance *= { stealthy: 0.75, normal: 1, rushed: 1.2 }[p.stance] || 1;
  chance *= encounterMult(partyMembers(state, p)); // Strategic (traits.js): the team's best tier picks its routes and hours
  return { chance: Math.min(marching ? NIGHT_MARCH.CONFLICT_CAP : 0.35, chance), sources };
}

// Chance that the team spots the other side first.
export function spotFirstChance(state, p) {
  const members = partyMembers(state, p);
  let c = perceptionChance(state, members) + 0.1;
  if (p.stance === "stealthy") c += 0.25;
  if (p.stance === "rushed") c -= 0.1;
  if (p.vehicle) c -= 0.1;
  const fx = travelEffects(state, state.hour, partyTile(p)); // the weather where the team is (weather.js)
  c -= fx.ambush; // fog and whiteouts hide the other side until it is close
  if (isNight(state) && members.some((m) => m.traits.includes("nightowl") || (m.gear.tool && m.gear.tool.key === "nvg"))) c += 0.15;
  else if (!isNight(state)) c -= teamTraitFx(members, "nightowl", "day"); // Night Owl (traits.js): drowsy by day
  c += opticsFor(members, p.cargo, { still: p.phase !== "out" && p.phase !== "back", night: isNight(state), fog: fx.sight < 0 }).spot; // binoculars, a thermal at night (optics.js)
  return clamp(c, 0.05, 0.9);
}

export function rollConflict(state, p, tileId) {
  if (p.owner !== "player" || p.kind === "convoy") return null;
  if (state.bases.some((b) => state.grid.distance(b.tile, tileId) <= 1)) return null;
  if (p.lastConflict != null && state.hour - p.lastConflict < COOLDOWN_HOURS) return null;
  const { chance, sources } = conflictChance(state, p, tileId);
  if (!sources.length || !state.rng.chance(chance)) return null;
  const src = state.rng.weighted(sources, (s) => s.w);
  const lying = !src.zombies && !src.aiParty && lyingFor(state, src.f, p); // intel.js: waiting for this caravan, they see it first more often
  const spotted = state.rng.chance(spotFirstChance(state, p) * (lying ? INTEL.AMBUSH.SPOT : 1));
  const card = src.zombies ? zombieEncounter(state, p, spotted) : factionEncounter(state, p, src.f, spotted, src.aiParty);
  if (!card) return null;
  if (lying) ambushSprung(state, src.f, p); // "They knew we were coming"
  p.lastConflict = state.hour;
  p.conflictCount = (p.conflictCount || 0) + 1;
  return card;
}

// A team that stayed in one place too long (fieldheat.js decides when): the same cards as on the road. Who comes
// is drawn from the road's sources here plus the dead that always wander (weight 0.3); a horde within 3 tiles
// (opts.horde) is drawn in as a bigger surge. Lookouts at a camp spot trouble a little more often (+10%).
// Returns the card (not added) or null when the team saw them first and let them pass.
export function stationaryEncounter(state, p, opts = {}) {
  const tile = partyTile(p);
  const { sources } = conflictChance(state, p, tile);
  const src = state.rng.weighted([...sources, { zombies: true, w: 0.3 + (opts.horde ? 0.6 : 0) }], (s) => s.w);
  const spotted = state.rng.chance(Math.min(0.9, spotFirstChance(state, p) + 0.1));
  let card;
  if (src.zombies && opts.horde && !spotted) {
    const scale = Math.min(2.2, 1.2 + opts.horde.size / 150);
    card = forcedCard(state, p, makeConflict(state, p, "surge", null, enemyGroup(state, p, null, scale, opts.horde), { identified: true, horde: opts.horde.size }));
  } else card = src.zombies ? zombieEncounter(state, p, spotted) : factionEncounter(state, p, src.f, spotted, src.aiParty);
  if (!card) return null;
  p.lastConflict = state.hour;
  p.conflictCount = (p.conflictCount || 0) + 1;
  return card;
}

// ---------- contact: on the same tile as an enemy ----------
// A team that shares a tile with a horde or an enemy group's party on the move (a war party, a raid, a hostile group's
// scavengers or convoy) is attacked: always, by day or night, whatever the 20-hour cooldown on road encounters, with
// the forced card's choices (run, fight, hide from the dead, pay or talk to people). By day a team sees them coming
// on the map and can steer round them; at night it sees only its own tile (parties.js sightRadius: night vision
// goggles a tile round) and can walk straight into them. Checked on every tile a team enters (parties.js onEnterTile:
// the team stops on that tile) and every hour for teams standing still (tickHour: the enemy came to them).
// The same horde, party or band does not attack the same team again for CONTACT.AGAIN hours (it ran, or won). Outsider
// raiders and robbers (visitors.js) on the same tile stop the team too, with their own card.
export const CONTACT = { AGAIN: 3, HORDE_MIN: 5 };
// Is this party an enemy to your teams? A group at war with you (Hostile), or raiders and expansionists you have no
// pact or alliance with; a raid is always an enemy. Sieges are fought at the walls, not here.
export function enemyParty(state, q) {
  if (!q || q.owner === "player" || q.phase === "siege") return null;
  const f = factionById(state, q.owner);
  if (!f || !f.alive) return null;
  const att = attitude(f);
  if (q.kind === "raid" || att === "Hostile" || (isAggressiveType(f) && att !== "Allied" && !f.pact)) return f;
  return null;
}
// What an enemy on this tile would attack the team with: { horde } or { party, f }, or null.
export function contactOn(state, p, tile) {
  const seen = p.contacts || {};
  const fresh = (key) => seen[key] == null || state.hour - seen[key] >= CONTACT.AGAIN;
  // A team sent to cull this horde, or to storm the hive or growth it guards, meets it on its own terms (parties.js
  // arrive: the cull card, the hive's battle), not as an ambush.
  const culling = (h) => ["cull", "hive", "growth"].includes(p.mission) && p.dest != null && state.grid.distance(h.tile, p.dest) <= 1;
  // The same after the hive's card (hives.js hiveArrive sets p.hiveVisit): a team still standing on the mound's tile
  // once it has set its fires, backed off or been given new orders (and has not walked off yet, say at night) is not
  // ambushed by that hive's own guard every CONTACT.AGAIN hours: the card was its meeting with the guard. The red ring's
  // own trouble (fieldheat.js) still finds it. Off the tile the mark is dropped.
  if (p.hiveVisit != null && p.hiveVisit !== tile) delete p.hiveVisit;
  const visited = (h) => p.hiveVisit === tile && h.tile === tile && h.role === "guard";
  const horde = state.hordes.find((h) => h.tile === tile && h.size >= CONTACT.HORDE_MIN && fresh(`h${h.id}`) && !culling(h) && !visited(h));
  if (horde) return { horde, key: `h${horde.id}` };
  const v = hostileOutsiderOn(state, p, tile, fresh); // visitors.js: raiders from beyond the border, robbers on the road
  if (v) return { visitor: v, key: `v${v.id}` };
  for (const q of state.parties) {
    if (q.owner === "player" || !q.path || partyTile(q) !== tile) continue;
    const f = enemyParty(state, q);
    if (f && fresh(`p${q.id}`)) return { party: q, f, key: `p${q.id}` };
  }
  return null;
}
// Can this team be caught out here? A team of yours in the field (not a convoy, not at a base, not already in a
// fight or a card about one).
function inTheOpen(state, p, tile) {
  if (p.owner !== "player" || p.kind === "convoy" || !state.parties.includes(p) || !partyMembers(state, p).length) return false;
  if (["engaged", "holding", "helping", "siege"].includes(p.phase)) return false;
  if (state.bases.some((b) => b.tile === tile)) return false;
  return !state.cards.some((c) => c.partyId === p.id && c.kind === "conflict");
}
// The attack, if an enemy is on the team's tile: the card is added and returned (null if none).
export function contactAttack(state, p, tile = partyTile(p)) {
  if (!inTheOpen(state, p, tile)) return null;
  const hit = contactOn(state, p, tile);
  if (!hit) return null;
  const dark = isNight(state);
  let card;
  if (hit.visitor) card = outsiderAttackCard(state, hit.visitor, p);
  else if (hit.horde) {
    const h = hit.horde, scale = Math.min(2.2, 1.2 + h.size / 150);
    const enemy = enemyGroup(state, p, null, scale, h);
    card = forcedCard(state, p, makeConflict(state, p, "surge", null, enemy, {
      identified: true, horde: h.size, contact: true,
      text: dark ? `In the dark the team walks straight into a horde: about ${h.size} of the dead, all around, and the nearest ${enemy.count} are already on them.` :
        `A horde of about ${h.size} of the dead is on this ground with the team, and the nearest ${enemy.count} come at them.`,
    }));
  } else {
    const { party: q, f } = hit;
    const what = q.kind === "raid" ? "raiding party" : q.kind === "convoy" ? "convoy" : q.kind === "scav" ? "scavengers" : "war party";
    card = forcedCard(state, p, makeConflict(state, p, "ambush", f, enemyGroup(state, p, f, q.kind === "raid" ? 1.5 : 1), {
      aiPartyId: q.id, contact: true,
      text: dark ? `In the dark the team blunders into a ${f.name} ${what} camped on the same ground. Shouts, then shots: they are on you before anyone can get away.` :
        `A ${f.name} ${what} is on the same ground as the team, and they open fire.`,
    }));
  }
  if (!card) return null;
  (p.contacts || (p.contacts = {}))[hit.key] = state.hour;
  p.lastConflict = state.hour;
  p.conflictCount = (p.conflictCount || 0) + 1;
  addCard(state, card);
  return card;
}
// Every hour, after everyone has moved (world.js tickHour): teams standing still with an enemy come onto their tile.
export function contactHour(state) {
  for (const p of [...state.parties]) if (p.owner === "player") contactAttack(state, p);
}

// Build a conflict of a given type for a party (also used by the test tools and the console). extra: fields for the
// conflict (contest: scavPartyId, site).
export function triggerConflict(state, p, type, factionId, extra = {}) {
  const f = factionId != null ? factionById(state, factionId) : null;
  const def = CONFLICT_TYPES[type];
  if (!def) return null;
  let card;
  if (type === "surge") card = zombieEncounter(state, p, false);
  else if (type === "hordeattack") card = zombieEncounter(state, p, true, true);
  else {
    const g = f || state.factions.find((x) => x.alive);
    if (!g) return null;
    card = def.mode === "forced" ? forcedCard(state, p, makeConflict(state, p, type, g, enemyGroup(state, p, g), extra)) : observedCard(state, p, observedConflict(state, p, g, type));
  }
  if (card) {
    p.lastConflict = state.hour;
    p.conflictCount = (p.conflictCount || 0) + 1;
    addCard(state, card);
  }
  return card;
}

function makeConflict(state, p, type, f, enemy, extra = {}) {
  bump(state, "types", type);
  return {
    type, mode: CONFLICT_TYPES[type].mode, partyId: p.id, tile: partyTile(p), factionId: f ? f.id : null,
    enemy, exact: false, identified: f ? f.known : true, ...extra,
  };
}

export function halt(p) {
  if (p.phase !== "engaged") {
    // A team found while standing still (fieldheat.js) goes back to its camp or work, or to waiting.
    p.conflictResume = p.phase === "back" ? "back" : p.phase === "task" && p.task ? "task" : p.phase === "waiting" ? "waiting" : "out";
    p.phase = "engaged";
  }
}
export function resume(state, p) {
  if (!state.parties.includes(p)) return;
  const was = p.conflictResume;
  delete p.conflictResume;
  if (p.phase !== "engaged") return;
  if (was === "task" && !p.task) { awaitOrders(state, p, "", { failed: true, hold: true }); return; }
  // A team that was waiting reports in again (its old card was answered or dropped).
  if (was === "waiting") { awaitOrders(state, p, "", { failed: true, hold: true }); return; }
  p.phase = was || "out";
}

// What stopping your team looks like (groupcare.js GROUP_PRIORITIES stop; none: by their attitude).
function forcedTypeFor(state, p, f) {
  const att = attitude(f);
  const t = state.tiles[partyTile(p)];
  const stop = weightOf(f, "stop", null);
  if (stop === "checkpoint") return att === "Allied" ? null : "checkpoint";
  if (stop === "roadblock") {
    if (att !== "Hostile") return "roadblock";
    return t.road && state.rng.chance(0.5) ? "roadblock" : "ambush";
  }
  if (stop) return stop;
  if (att === "Hostile") return "ambush";
  if (att === "Neutral") return "challenge";
  return null;
}

function factionEncounter(state, p, f, spotted, aiParty) {
  if (spotted) {
    const type = pickObserved(state, p, f, aiParty);
    if (!type) return null;
    return observedCard(state, p, observedConflict(state, p, f, type, aiParty));
  }
  const type = forcedTypeFor(state, p, f);
  if (!type) return null;
  const scale = aiParty && aiParty.kind === "raid" ? 1.5 : 1;
  return forcedCard(state, p, makeConflict(state, p, type, f, enemyGroup(state, p, f, scale), { aiPartyId: aiParty ? aiParty.id : null })); // aiPartyId: their vehicle on the battle map (startFight)
}

function zombieEncounter(state, p, spotted, force = false) {
  if (spotted && (force || state.rng.chance(0.6))) {
    const victims = state.rng.chance(0.4) ? state.factions.find((f) => f.alive && !isAggressiveType(f) && attitude(f) !== "Hostile" && minBaseDist(state, f, partyTile(p)) <= 8) : null;
    const c = makeConflict(state, p, "hordeattack", null, enemyGroup(state, p, null, 1.2), { victimId: victims ? victims.id : null, strangers: state.rng.int(1, 3), identified: true });
    return observedCard(state, p, c);
  }
  if (spotted) return null; // you saw the dead first and simply went around
  return forcedCard(state, p, makeConflict(state, p, "surge", null, enemyGroup(state, p, null), { identified: true }));
}

function pickObserved(state, p, f, aiParty) {
  const opts = [{ type: "camp", w: 3 }];
  const tile = partyTile(p);
  if (isAggressiveType(f) || attitude(f) === "Hostile") {
    opts.push({ type: "robbery", w: 2 });
    if (f.type !== "expansionist" || captivesOf(state, f.id).length) opts.push({ type: "prisoners", w: captivesOf(state, f.id).length ? 3 : 1 });
  }
  if (state.factions.some((o) => o.alive && o !== f && o.bases.length && minBaseDist(state, o, tile) <= 7)) opts.push({ type: "skirmish", w: aiParty ? 3 : 1.2 });
  return state.rng.weighted(opts, (o) => o.w).type;
}

function observedConflict(state, p, f, type, aiParty) {
  const rng = state.rng;
  const tile = partyTile(p);
  const extra = {};
  let scale = 1;
  if (type === "robbery") {
    const v = state.factions.find((o) => o.alive && o !== f && (o.type === "traders" || o.type === "commune"));
    extra.victimId = v && rng.chance(0.6) ? v.id : null;
    extra.strangers = extra.victimId ? (rng.chance(0.25) ? 1 : 0) : rng.int(1, 2);
  } else if (type === "skirmish") {
    const others = state.factions.filter((o) => o.alive && o !== f && o.bases.length && minBaseDist(state, o, tile) <= 7);
    const o = others.length ? rng.pick(others) : state.factions.find((x) => x.alive && x !== f);
    extra.otherId = o ? o.id : null;
    extra.otherEnemy = o ? enemyGroup(state, p, o, 1.2) : null;
    scale = 1.2;
  } else if (type === "prisoners") {
    const mine = captivesOf(state, f.id);
    extra.held = mine.slice(0, 3).map((s) => s.id);
    extra.strangers = rng.int(1, 2);
  } else if (type === "camp") {
    scale = 1.1;
  }
  if (aiParty) extra.aiPartyId = aiParty.id;
  return makeConflict(state, p, type, f, enemyGroup(state, p, f, scale), { ...extra, aiPartyId: aiParty ? aiParty.id : null });
}

// ---------- the cards ----------
function baseCard(state, p, c, title, text, choices) {
  halt(p);
  return { kind: "conflict", conflict: c, title, text, where: tileLabel(state, partyTile(p)), partyId: p.id, choices };
}

function fNameOf(state, c) {
  const f = factionById(state, c.factionId);
  if (!f) return "the dead";
  return c.identified ? f.name : "an unknown group";
}

function forcedCard(state, p, c, followUp = false) {
  const f = factionById(state, c.factionId);
  if (f && c.type !== "surge") {
    // They talk to you, so you learn who they are.
    f.known = true;
    c.identified = true;
  }
  const n = c.enemy.count;
  const texts = {
    ambush: `Shots crack over your heads. ${f && f.name} fighters had the road covered and you walked right into it. About ${n} of them, dug in.`,
    roadblock: `A barricade of cars and wire. ${f && f.name} gunmen step out and demand a toll to pass.`,
    zealotpatrol: `Figures in ash-grey robes block the way: a ${f && f.name} patrol. They demand you kneel and give up what is "unclean".`,
    checkpoint: `A ${f && f.name} checkpoint: sandbags, a barrier, rifles. They order you to stop for inspection.`,
    challenge: `${f && f.name} sentries step out of cover, weapons raised. They want to know who you are and why you are on their land.`,
    contest: `${f && f.name} scavengers are already working ${c.site != null ? Parties.tileLabel(state, c.site) : "this place"}: about ${n} of them, with sacks, crowbars and rifles. They say it is theirs and want you gone.`,
    surge: `The dead pour out of the buildings around you: about ${n}, and more behind them. They have your scent.`,
  };
  const text = followUp ? c.followText : c.text || texts[c.type]; // c.text: a contact attack's own words (contactAttack)
  return baseCard(state, p, c, followUp ? `${CONFLICT_TYPES[c.type].name}: no deal` : CONFLICT_TYPES[c.type].name, text, forcedChoices(state, p, c));
}

function forcedChoices(state, p, c) {
  const f = factionById(state, c.factionId);
  const ch = [];
  const fightAmbush = c.type === "ambush" || c.type === "surge" || c.caught ? "enemy" : null;
  if (f && !c.noBribe) ch.push(bribeChoice(state, p, c, f));
  ch.push(runChoice(state, p, c, f));
  if (c.type === "surge") ch.push(hideChoice(state, p, c));
  if (f && !c.noTalk) ch.push(talkChoice(state, p, c, f));
  if (f && f.pact && !c.noTalk) ch.push(pactChoice(state, p, c, f));
  if (f) ch.push(surrenderChoice(state, p, c, f));
  ch.push(fightChoice(state, p, c, fightAmbush, c.type === "ambush" || c.type === "surge" ? 2 : 10));
  return ch;
}

function runDc(c) {
  return { ambush: 12, roadblock: 9, zealotpatrol: 11, checkpoint: 11, challenge: 9, contest: 9, surge: 10 }[c.type] ?? 11;
}
export function runBonus(state, p) {
  let b = 0;
  if (p.vehicle && partyFuel(state, p) >= 2) b += state.tiles[partyTile(p)].road ? 4 : 3;
  if (isNight(state)) b += 1;
  if (partyMembers(state, p).length >= 4) b -= 1;
  if (!p.vehicle && partyMembers(state, p).every((m) => hasTrait(m, "fleet"))) b += 1; // a team on foot runs at its slowest: all Fleet-Footed (traits.js)
  if (!p.vehicle && partyMembers(state, p).some((m) => hasTrait(m, "slow"))) b -= 1; // and anyone Slow holds it back
  return b;
}

function runChoice(state, p, c, f) {
  const chance = skillChance(bestSkill(state, p, "stealth") + runBonus(state, p), runDc(c));
  const vehicle = p.vehicle && partyFuel(state, p) >= 2;
  return {
    label: vehicle ? "Floor it and run" : "Run for it",
    hint: `Stealth check, ${pct(chance)}${vehicle ? " (vehicle helps, uses 2 fuel)" : ""}. Failure: someone gets hurt, you drop cargo, or they catch you and the fight starts on their terms`,
    resolve: (st) => {
      if (vehicle) useFuel(st, p, 2);
      if (st.rng.chance(chance)) {
        bump(st, "outcomes", "run-ok");
        resume(st, p);
        return vehicle ? "Tires scream. You are out of range before they react." : "You scatter into cover and regroup further on. Nobody follows.";
      }
      const r = st.rng.next();
      if (r < 0.4) {
        bump(st, "outcomes", "run-hurt");
        const txt = injure(st, p, 10, 35, `fleeing ${f ? f.name : "the dead"}`);
        resume(st, p);
        return `You get away, but not cleanly. ${txt}`;
      }
      if (r < 0.7 && cargoLoad(p.cargo) > 0) {
        bump(st, "outcomes", "run-dropped");
        const lost = rob(st, p, 0.45, f, false, true);
        resume(st, p);
        return `You get away, but drop part of the load in the scramble: ${lost}.`;
      }
      bump(st, "outcomes", "run-caught");
      return startFight(st, p, c, "enemy", 2, "They cut you off before you get clear.");
    },
  };
}

function hideChoice(state, p, c) {
  const t = state.tiles[partyTile(p)];
  const dc = 9 + Math.round(t.infection * 4);
  const chance = skillChance(bestSkill(state, p, "stealth"), dc);
  return {
    label: "Hide and let them pass (4 hours)",
    hint: `Stealth check, ${pct(chance)}. Failure: they find you and you fight with no time to set up`,
    resolve: (st) => {
      p.progress -= 4;
      gainXpAll(st, partyMembers(st, p), "stealth", USE.hide); // skills.js
      if (st.rng.chance(chance)) {
        bump(st, "outcomes", "hide-ok");
        resume(st, p);
        return "You hold your breath in a cellar while the dead shuffle past overhead.";
      }
      bump(st, "outcomes", "hide-fail");
      return startFight(st, p, c, "enemy", 0, "A door gives way. They are inside with you.");
    },
  };
}

function talkDc(f, c) {
  const att = attitude(f);
  return ({ Hostile: 14, Neutral: 10, Friendly: 7, Allied: 4 }[att]) + weightOf(f, "talkDc", 0) + (c.type === "ambush" ? 1 : 0); // GROUP_PRIORITIES talkDc
}
// Perks (skills.js): Peacemaker's Leadership counts in full; Smooth Talker +2.
export function talkSkill(state, p) {
  const team = partyMembers(state, p);
  const v = Math.max(bestSkill(state, p, "speech"), bestSkill(state, p, "leadership") - 2, ...team.filter((s) => hasPerk(s, "peacemaker")).map((s) => skill(s, "leadership")));
  return v + (anyPerk(team, "smooth") ? 2 : 0);
}
// Who does the talking (Speech XP): the best talker on the team.
export const talker = (state, p) => [...partyMembers(state, p)].sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0];

function talkChoice(state, p, c, f) {
  const team = partyMembers(state, p);
  const chance = Math.min(0.95, skillChance(talkSkill(state, p), talkDc(f, c)) + (anyPerk(team, "silvertongue") ? 0.15 : 0)); // Silver Tongue (skills.js)
  const again = anyPerk(team, "diplomat") && !c.retalk; // Diplomat: one more try after a failed talk
  const deal = weightOf(f, "sharesNews", 0) > 0; // GROUP_PRIORITIES sharesNews
  return {
    label: c.type === "checkpoint" ? "Talk your way through" : "Talk them down",
    hint: `Speech check, ${pct(chance)} (they are ${attitude(f).toLowerCase()}). Success: you pass and goodwill rises a little${deal ? "; they may share news of the area" : ""}. Failure: ${anyPerk(team, "peacemaker") ? "" : "goodwill drops and "}they get angrier (${again ? "Diplomat: you may talk once more" : "no second chance to talk"})`,
    resolve: (st) => {
      const won = st.rng.chance(chance);
      gainXp(st, talker(st, p), "speech", USE.talk + (won ? USE.talkWon : 0)); // skills.js
      if (won) {
        bump(st, "outcomes", "talk-ok");
        changeGoodwill(st, f, anyPerk(partyMembers(st, p), "charming") ? 6 : 3, "you talked it out"); // Charming (skills.js)
        f.lastDiplomacy = day(st);
        let extra = "";
        if (deal) {
          for (const b of f.bases) p.seen.set(b, snapshot(st, b));
          extra = ` They mark their bases on your map${attitude(f) === "Friendly" || attitude(f) === "Allied" ? " and wish you luck" : ""}.`;
        }
        resume(st, p);
        return `A tense minute, then they lower their weapons and let you through.${extra}`;
      }
      bump(st, "outcomes", "talk-fail");
      if (!anyPerk(partyMembers(st, p), "peacemaker")) changeGoodwill(st, f, -3, "a bad conversation"); // Peacemaker: no goodwill lost
      const c2 = { ...c, noTalk: !again, retalk: true, followText: `They are not buying it. ${f.name}'s ${NOUN_OF[f.type]} close in, angrier now. The price just went up.`, bribeMult: 1.5 };
      addCard(st, forcedCard(st, p, c2, true));
      return "";
    },
  };
}

function bribeValue(c, f) {
  return Math.round((15 + c.enemy.count * 6) * weightOf(f, "bribeCost", 1) * (c.bribeMult || 1)); // GROUP_PRIORITIES bribeCost
}
function bribeChance(f) {
  return weightOf(f, "bribeOdds", 0.95); // GROUP_PRIORITIES bribeOdds (an unknown type keeps its word 95% of the time)
}

function bribeChoice(state, p, c, f) {
  const value = Math.round(bribeValue(c, f) * (anyPerk(partyMembers(state, p), "negotiator") ? 0.75 : 1) * bribeMult(partyMembers(state, p))); // Negotiator (skills.js); Diplomatic, the team's best (traits.js)
  const plan = payPlan(p, value);
  const chance = bribeChance(f);
  const toll = c.type === "roadblock";
  return {
    label: toll ? "Pay the toll" : c.type === "checkpoint" ? "Grease some palms" : "Offer them supplies",
    hint: plan ? `Costs ${planText(plan)} (goes to ${f.name}). ${chance >= 0.95 ? "They take it and let you pass" : `${pct(chance)} they take it and let you pass; otherwise they take it and attack anyway`}` : `You do not carry enough (needs about ${value} worth of goods)`,
    disabled: () => !payPlan(p, value),
    resolve: (st) => {
      const pl = payPlan(p, value);
      if (!pl) {
        // The goods went elsewhere since the card came up (an earlier card this hour): same stand-off, pick again.
        addCard(st, forcedCard(st, p, c, !!c.followText));
        return "You no longer carry enough to pay that.";
      }
      payFrom(p, pl, f, state);
      if (st.rng.chance(chance)) {
        bump(st, "outcomes", "bribe-ok");
        changeGoodwill(st, f, 2);
        resume(st, p);
        return `${f.name} take ${planText(pl)} and wave you on.`;
      }
      bump(st, "outcomes", "bribe-fail");
      return startFight(st, p, c, null, 0, `They take ${planText(pl)}, then open fire anyway.`);
    },
  };
}

function pactChoice(state, p, c, f) {
  const chance = weightOf(f, "pactOdds", 0.97); // GROUP_PRIORITIES pactOdds
  return {
    label: `Invoke your ${f.pact === "trade" ? "trade" : "non-aggression"} pact`,
    hint: `${pct(chance)}: they honour the pact and let you pass. Breaking faith would cost them`,
    resolve: (st) => {
      if (st.rng.chance(chance)) {
        bump(st, "outcomes", "pact-ok");
        resume(st, p);
        return `The leader checks with someone over the radio, then waves you through. The pact holds.`;
      }
      bump(st, "outcomes", "pact-fail");
      changeGoodwill(st, f, -5);
      const c2 = { ...c, noTalk: true, followText: `"Pacts are for the faithful." ${f.name} ignore the pact.` };
      addCard(st, forcedCard(st, p, c2, true));
      return "";
    },
  };
}

function surrenderChoice(state, p, c, f) {
  const terms = surrenderTerms(state, f);
  return {
    label: c.type === "checkpoint" ? "Submit to inspection" : "Surrender",
    hint: terms.text,
    resolve: (st) => applySurrender(st, p, c, f),
  };
}

function fightChoice(state, p, c, ambush, goodwillHit) {
  const odds = fightOdds(state, p, c.enemy, ambush);
  const f = factionById(state, c.factionId);
  return {
    label: ambush === "enemy" ? "Fight back" : "Open fire",
    hint: `About ${pct(odds)} to win${ambush === "enemy" ? ", but they have the drop on you" : ""}. Uses ammo; people will get hurt.${f ? ` ${goodwillHit >= 5 ? "Big" : "Small"} goodwill loss with ${f.name}` : ""}`,
    fight: { odds, enemy: c.enemy, ambush }, // the card's retreat policy and forecast (breakoff.js, ui.js)
    resolve: (st) => startFight(st, p, c, ambush, goodwillHit, ""),
  };
}

// Start a battle for a conflict. The handler applies the aftermath.
function startFight(state, p, c, ambush, goodwillHit, lead, extra = {}) {
  halt(p);
  bump(state, "outcomes", `fight-${c.type}`);
  const f = factionById(state, c.factionId);
  const enemy = extra.enemy || c.enemy;
  // Their party drove here (aiscav.js vehicleType): the vehicle stands on their side of the map, theirs to lose.
  const theirs = state.parties.find((q) => q.owner !== "player" && (q.id === c.aiPartyId || q.id === c.scavPartyId) && q.vehicleType);
  // Their scavengers' carts (carts.js enemyCarts): pushed onto the map by some of them, loaded with part of their haul.
  const carted = state.parties.find((q) => q.owner !== "player" && (q.id === c.aiPartyId || q.id === c.scavPartyId) && q.scav && q.scav.carts > 0);
  startCombat(state, {
    tile: partyTile(p), partyId: p.id,
    enemy: { kind: enemy.kind, count: enemy.count, power: enemy.power, factionId: enemy.factionId ?? (f ? f.id : undefined), partyId: c.aiPartyId ?? c.scavPartyId ?? undefined, name: enemy.name, ...(enemy.mix ? { mix: enemy.mix } : {}), ...(theirs ? { vehicle: theirs.vehicleType, vehiclePartyId: theirs.id } : {}), ...(carted ? { carts: carted.scav.carts, cartPartyId: carted.id } : {}) }, // mix: dead soldiers among them (deadsoldiers.js)
    ambush, canRetreat: true, handler: "conflict",
    context: { ...c, lead, goodwillHit, resumePhase: p.conflictResume || "out", ...extra },
  });
  return "";
}

// ---------- observed conflicts ----------
function observedCard(state, p, c) {
  const f = factionById(state, c.factionId);
  const who = fNameOf(state, c);
  const n = c.exact ? `${c.enemy.count}` : `about ${c.enemy.count}`;
  const victim = c.victimId ? factionById(state, c.victimId) : null;
  const other = c.otherId ? factionById(state, c.otherId) : null;
  const held = (c.held || []).map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s));
  const texts = {
    camp: `From cover you see a camp by the road: ${n} ${f ? NOUN_OF[f.type] : "people"} of ${who}, cooking and cleaning rifles. They have not seen you.`,
    robbery: `Up ahead, ${n} ${who} fighters have stopped ${victim ? `a ${victim.name} wagon` : "a family of travellers"} and are stripping it. Nobody has noticed you.`,
    skirmish: `Gunfire ahead: ${who} and ${other ? other.name : "another group"} are trading shots across the road. Neither side has seen you.`,
    hordeattack: `${n} of the dead are clawing at a barricaded house. ${victim ? `${victim.name} people` : "Survivors"} are shooting from the upper windows, and running out of time.`,
    prisoners: `A column of ${who} (${n} armed) is marching prisoners along the road, hands tied.${held.length ? ` You recognise ${names(held)}!` : ""}`,
  };
  const text = (c.note ? c.note + " " : "") + texts[c.type];
  return baseCard(state, p, c, CONFLICT_TYPES[c.type].name, text, observedChoices(state, p, c));
}

function observedChoices(state, p, c) {
  const f = factionById(state, c.factionId);
  const ch = [];
  if (!c.observed && c.type !== "hordeattack") ch.push(observeChoice(state, p, c, f));
  ch.push(sneakChoice(state, p, c, f));
  if (c.type === "skirmish") {
    const other = factionById(state, c.otherId);
    if (other) ch.push(helpSideChoice(state, p, c, other, f, c.enemy));
    if (other && f) ch.push(helpSideChoice(state, p, c, f, other, c.otherEnemy));
    return ch;
  }
  if (c.type === "hordeattack") {
    ch.push(distractChoice(state, p, c));
    ch.push(ambushChoice(state, p, c, "Help them: hit the dead from behind", 0));
    return ch;
  }
  if (c.type === "robbery") ch.push(ambushChoice(state, p, c, `Ambush the robbers`, 20));
  if (c.type === "prisoners") ch.push(ambushChoice(state, p, c, `Ambush the column and free the prisoners`, 20));
  if (c.type === "camp") {
    ch.push(stealChoice(state, p, c, f));
    ch.push(ambushChoice(state, p, c, "Ambush the camp", 20));
  }
  if (f && c.type !== "robbery") ch.push(approachChoice(state, p, c, f));
  if (f && c.type === "robbery") ch.push(joinRobberyChoice(state, p, c, f));
  return ch;
}

function observeChoice(state, p, c, f) {
  const scout = bestSkill(state, p, "scouting");
  const risk = clamp(0.18 - scout * 0.012, 0.04, 0.2);
  return {
    label: c.type === "prisoners" ? "Follow them at a distance (2 hours)" : "Watch them (2 hours)",
    hint: `Learn their exact numbers, who they are and where their base is (on the map when the team reports). ${pct(risk)} they notice you`,
    resolve: (st) => {
      p.progress -= 2;
      bump(st, "outcomes", "observe");
      const c2 = { ...c, observed: true, exact: true, identified: true };
      if (f) {
        f.known = true;
        f.arsenalSeen = day(st); // arsenal.js: a good look at their kit
        for (const b of f.bases) p.seen.set(b, snapshot(st, b));
      }
      if (st.rng.chance(risk) && f) {
        const t = forcedTypeFor(st, p, f) || "challenge";
        addCard(st, forcedCard(st, p, { ...c2, type: t, mode: "forced", caught: t === "ambush", followText: `A sentry spots you in the brush. ${f.name}'s ${NOUN_OF[f.type]} fan out toward you.` }, true));
        return "";
      }
      const held = captivesOf(st, f ? f.id : -1);
      const bits = [`${c.enemy.count} of them, about ${Math.round(c.enemy.power)} fighting strength each.`];
      if (f) bits.push(`They are ${f.name} (${FACTION_TYPES[f.type].label.toLowerCase()}, about ${Math.round(f.pop / 5) * 5 || f.pop} people at home). Their base location goes on the map when the team reports.`);
      if (f) { const kit = arsenalText(st, f); if (kit) bits.push(`Their kit: ${kit}`); } // arsenal.js
      if (held.length) bits.push(`They hold ${names(held)} at their base.`);
      addCard(st, observedCard(st, p, { ...c2, note: bits.join(" ") }));
      return "";
    },
  };
}

function sneakDc(c) {
  return 8 + Math.round(c.enemy.count / 3) + (c.type === "camp" ? 1 : 0);
}

function sneakChoice(state, p, c, f) {
  const chance = skillChance(bestSkill(state, p, "stealth") + (isNight(state) ? 1 : 0), sneakDc(c));
  return {
    label: "Slip away unseen",
    hint: `Stealth check, ${pct(chance)}. Failure: they spot you, and it turns into a confrontation on their terms`,
    resolve: (st) => {
      if (st.rng.chance(chance)) {
        bump(st, "outcomes", "sneak-ok");
        resume(st, p);
        return c.type === "hordeattack" ? "You leave them to it. The shooting stops behind you a while later." : "You back off and loop around. They never knew you were there.";
      }
      bump(st, "outcomes", "sneak-fail");
      if (!f) return startFight(st, p, c, "enemy", 0, "A dead hand closes on an ankle. The whole pack turns toward you.");
      const t = forcedTypeFor(st, p, f) || "challenge";
      addCard(st, forcedCard(st, p, { ...c, type: t, mode: "forced", caught: t === "ambush", identified: true, followText: `A branch snaps. ${f.name}'s ${NOUN_OF[f.type]} swing around, weapons up. You have been seen.` }, true));
      return "";
    },
  };
}

function ambushChoice(state, p, c, label, goodwillHit) {
  const f = factionById(state, c.factionId);
  const enemy = c.type === "hordeattack" ? { ...c.enemy, count: Math.max(3, Math.round(c.enemy.count * 0.7)) } : c.enemy;
  const odds = fightOdds(state, p, enemy, "player");
  const victim = c.victimId ? factionById(state, c.victimId) : null;
  const gains = {
    robbery: `Save the victims${victim ? ` (big goodwill with ${victim.name})` : " (they may join you)"} and take the robbers' haul`,
    prisoners: `Free the prisoners: they join your team${(c.held || []).length ? ", including your own people" : ""}`,
    camp: "Take their ammo, food and maybe gear",
    hordeattack: `The survivors join you${victim ? ` and ${victim.name} will be grateful` : ""}`,
  }[c.type] || "Loot";
  return {
    label,
    hint: `You strike first: about ${pct(odds)} to win. ${gains}.${f && goodwillHit ? ` Large goodwill loss with ${f.name}` : ""}`,
    fight: { odds, enemy, ambush: "player" },
    resolve: (st) => startFight(st, p, c, "player", goodwillHit, "", { enemy }),
  };
}

function helpSideChoice(state, p, c, helped, hit, enemy) {
  const half = { ...enemy, count: Math.max(2, Math.round(enemy.count * 0.6)) };
  const odds = fightOdds(state, p, half, "player");
  return {
    label: `Help ${helped.name}`,
    hint: `Hit ${hit.name} from the flank while they are busy: about ${pct(odds)} to win. Goodwill +15 with ${helped.name}, -15 with ${hit.name}`,
    fight: { odds, enemy: half, ambush: "player" },
    resolve: (st) => startFight(st, p, { ...c, factionId: hit.id, helpedId: helped.id }, "player", 15, "", { enemy: half, factionId: hit.id, helpedId: helped.id }),
  };
}

function distractChoice(state, p, c) {
  const fuel = partyFuel(state, p) >= 2;
  const chance = skillChance(bestSkill(state, p, "stealth") + (fuel ? 2 : 0), 10);
  return {
    label: fuel ? "Draw the dead off with a fire (2 fuel)" : "Draw the dead off with gunfire (10 rounds, the calibres your guns need least)",
    hint: `Stealth check, ${pct(chance)}. Success: the survivors escape (some may join you). Failure: the dead come for you instead`,
    disabled: () => partyFuel(state, p) < 2 && carriedAmmo(p) < 10,
    resolve: (st) => {
      // Paid with what the team has now: fuel for a fire, else ammo (found ammo first).
      if (fuel && partyFuel(st, p) >= 2) useFuel(st, p, 2);
      else if (carriedAmmo(p) >= 10) payFrom(p, { ammo: 10 }, null);
      else {
        addCard(st, observedCard(st, p, c));
        return "You no longer have the fuel or the ammo for that.";
      }
      if (st.rng.chance(chance)) {
        bump(st, "outcomes", "distract-ok");
        const victim = c.victimId ? factionById(st, c.victimId) : null;
        let text = "The dead turn toward the flames and the survivors break out.";
        if (victim) {
          changeGoodwill(st, victim, 10, "you saved their people");
          text += ` They are ${victim.name} people, and will remember this.`;
        } else if (st.rng.chance(0.5)) {
          const s = newRecruit(st, p);
          text += ` ${s.name} asks to come with you.`;
          askToJoin(st, p, [s], `${s.name} got out of the swarm with your help.`);
        }
        resume(st, p);
        return text;
      }
      bump(st, "outcomes", "distract-fail");
      return startFight(st, p, c, null, 0, "The dead come for you instead.");
    },
  };
}

function stealChoice(state, p, c, f) {
  const chance = skillChance(bestSkill(state, p, "stealth") + (isNight(state) ? 2 : 0), 12);
  return {
    label: "Steal from their supplies",
    hint: `Stealth check, ${pct(chance)}${isNight(state) ? " (night helps)" : ""}. Success: grab ammo and food unseen. Failure: they catch you in the act and the fight starts on their terms`,
    resolve: (st) => {
      if (st.rng.chance(chance)) {
        bump(st, "outcomes", "steal-ok");
        const stolen = addCargoRoundsRec(st, p, st.rng.int(15, 40), f ? kindTheme(f.type) : "raider", "steal", partyTile(p), st.hour); // ammo.js: their rounds, by calibre
        const ammo = Object.values(stolen).reduce((a, q) => a + q, 0);
        const food = addCargo(st, p, "food", st.rng.int(4, 10));
        if (f) { spendAmmo(f.stock, ammo); takeFood(f.stock, food); } // rounds.js: out of their rounds (docs/adr/0001-ai-parity.md: by calibre); foods.js: their food
        resume(st, p);
        return `You crawl out with ${roundsText(stolen)} and ${food} days of food. Nobody saw a thing.`;
      }
      bump(st, "outcomes", "steal-fail");
      if (f) changeGoodwill(st, f, -8, "you tried to rob them");
      return startFight(st, p, { ...c, caught: true }, "enemy", 0, "A shout goes up. They caught you with your hands in their crates.");
    },
  };
}

function approachChoice(state, p, c, f) {
  const att = attitude(f);
  const hostile = att === "Hostile";
  return {
    label: "Approach openly and talk",
    hint: hostile ? `They are hostile: it becomes a confrontation, but nobody has the drop on anyone` : `They are ${att.toLowerCase()}: share news (+goodwill, they mark their bases on your map)${c.type === "prisoners" ? ", and you can offer to buy the prisoners" : ""}`,
    resolve: (st) => {
      bump(st, "outcomes", "approach");
      if (hostile) {
        const t = forcedTypeFor(st, p, f) === "ambush" ? "roadblock" : (forcedTypeFor(st, p, f) || "challenge");
        addCard(st, forcedCard(st, p, { ...c, type: t, mode: "forced", identified: true, followText: `You walk out with your hands visible. ${f.name}'s ${NOUN_OF[f.type]} train their rifles on you. They want something before you go anywhere.` }, true));
        return "";
      }
      f.known = true;
      changeGoodwill(st, f, 3, "a friendly meeting");
      f.lastDiplomacy = day(st);
      for (const b of f.bases) p.seen.set(b, snapshot(st, b));
      if (c.type === "prisoners") {
        addCard(st, buyPrisonersCard(st, p, c, f));
        return "";
      }
      resume(st, p);
      return `You share news over a fire. ${f.name} mark their bases on your map.`;
    },
  };
}

function buyPrisonersCard(state, p, c, f) {
  const held = (c.held || []).map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s));
  const n = held.length + (c.strangers || 0);
  const value = ransomValue(f, n);
  const plan = payPlan(p, value);
  return baseCard(state, p, c, "Buying freedom", `${f.name} will sell the ${n} prisoner${n === 1 ? "" : "s"}${held.length ? `, including ${names(held)}` : ""}.`, [
    {
      label: "Pay for them",
      hint: plan ? `Costs ${planText(plan)}. The prisoners join your team` : `You do not carry enough (about ${value} worth of goods)`,
      disabled: () => !payPlan(p, value),
      resolve: (st) => {
        const pl = payPlan(p, value);
        if (!pl) {
          addCard(st, buyPrisonersCard(st, p, c, f)); // the offer stands; pay later or leave them
          return "You no longer carry enough to pay that.";
        }
        payFrom(p, pl, f, state);
        for (const s of held) if (isCaptive(s)) freeCaptive(st, s, p);
        const fresh = [];
        for (let i = 0; i < (c.strangers || 0); i++) fresh.push(newRecruit(st, p));
        bump(st, "outcomes", "bought-prisoners");
        askToJoin(st, p, fresh, `You paid for their freedom.`);
        resume(st, p);
        return `Paid ${planText(pl)}.${held.length ? ` ${names(held)} ${held.length === 1 ? "joins" : "join"} the team.` : ""}${fresh.length ? ` ${names(fresh)} ${fresh.length === 1 ? "asks" : "ask"} to come with you.` : ""}`;
      },
    },
    { label: "Leave them", hint: "Move on", resolve: (st) => { resume(st, p); return "You leave the column behind."; } },
  ]);
}

function joinRobberyChoice(state, p, c, f) {
  const victim = c.victimId ? factionById(state, c.victimId) : null;
  return {
    label: `Join in and take a share`,
    hint: `The robbers let you take a cut (+goodwill with ${f.name}).${victim ? ` Goodwill loss with ${victim.name} if word gets out (50%)` : ""} Your team's mood drops`,
    resolve: (st) => {
      bump(st, "outcomes", "join-robbery");
      changeGoodwill(st, f, 6, "you joined their robbery");
      const food = addCargo(st, p, "food", st.rng.int(4, 10));
      const scrap = addCargo(st, p, "scrap", st.rng.int(3, 8));
      if (victim && st.rng.chance(0.5)) changeGoodwill(st, victim, -15, "you robbed their people");
      for (const m of partyMembers(st, p)) m.mood = Math.max(0, m.mood - 6);
      resume(st, p);
      return `You take ${food} days of food and ${scrap} scrap. Nobody on the team meets anyone's eyes.`;
    },
  };
}

// ---------- combat aftermath ----------
export function afterFight(state, p, c, text) {
  if (!state.parties.includes(p)) return;
  if (c.resumePhase === "back") {
    p.phase = "engaged";
    p.conflictResume = "back";
    addCard(state, {
      title: "After the fight", text, partyId: p.id, where: tileLabel(state, partyTile(p)),
      choices: [
        { label: "Continue home", hint: "Keep heading back to base", resolve: (st) => { resume(st, p); return ""; } },
        { label: "Stop and wait for orders", hint: "The team waits here for your call", resolve: (st) => { delete p.conflictResume; awaitOrders(st, p, ""); return ""; } },
      ],
    });
    return;
  }
  p.phase = "engaged";
  // Found while camping or working on the spot (fieldheat.js): carry on with that; otherwise the trip.
  const still = c.resumePhase === "task" && p.task ? "task" : c.resumePhase === "waiting" ? "waiting" : "out";
  p.conflictResume = still;
  addCard(state, {
    title: "After the fight", text, partyId: p.id, where: tileLabel(state, partyTile(p)),
    choices: [
      still === "out" ? { label: `Continue to ${tileLabel(state, p.dest)}`, hint: "Carry on with the original trip", resolve: (st) => { resume(st, p); return ""; } }
        : { label: still === "task" ? "Carry on here" : "Wait here", hint: still === "task" ? "Back to what the team was doing on this tile (it is still drawing attention: Heat)" : "The team reports in for orders", resolve: (st) => { resume(st, p); return ""; } },
      { label: "Return home", hint: "Head back to base with the wounded and whatever was won", resolve: (st) => { delete p.conflictResume; startReturn(st, p); return "The team heads home."; } },
      { label: "Stop and wait for orders", hint: "Choose what the team does next", resolve: (st) => { delete p.conflictResume; awaitOrders(st, p, ""); return ""; } },
    ],
  });
}

// Their scavenging party's vehicle (aiscav.js), left on the field when you beat them: an abandoned vehicle where the fight
// was, marked on the map for any team to recover ("Recover vehicle"), with a little fuel in it and the wear of the fight.
function takeTheirVehicle(state, p, f, ev) {
  const rng = state.rng;
  const type = VEHICLE_TYPES[ev.type] ? ev.type : "truck";
  const tile = partyTile(p);
  const v = createVehicle(state, type, { kind: "abandoned", tile, since: state.hour }, { fuel: rng.int(2, 8), condition: rng.int(40, 75) });
  const tech = fitTechnical(state, v, f ? f.id : null, ev.partyId ?? ""); // vehicles.js: a raider technical keeps its scrap plating
  markAbandonedVehicle(state, v, `left by ${f ? f.name : "them"} after the fight`);
  const q = state.parties.find((x) => x.id === ev.partyId);
  if (q) { q.vehicle = false; q.vehicleType = null; }
  return `Their ${v.name}${tech ? " (a technical: scrap plating welded on)" : ""} stands where they left it (${Math.round(v.condition)}%, ${v.fuel} fuel): marked on the map, any team can recover it (Recover vehicle).`;
}
function onConflictCombat(state, result, setup) {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId);
  const f = factionById(state, c.factionId);
  const rng = state.rng;
  bump(state, "outcomes", `combat-${result.outcome}`);
  const lines = [];
  if (c.lead) lines.push(c.lead);
  if (f && result.enemiesKilled) {
    f.pop = Math.max(0, f.pop - Math.ceil(result.enemiesKilled * 0.6));
  }
  if (f && c.goodwillHit) changeGoodwill(state, f, -c.goodwillHit, "you attacked their people");
  const dead = (result.survivorsDead || []).map((id) => survivorById(state, id)).filter(Boolean);
  if (p && state.parties.includes(p) && !partyMembers(state, p).length) {
    wipeParty(state, p);
    log(state, `The whole team was lost fighting ${c.enemy.name}.`, "death");
    if (f && groupBroken(f)) collapseFaction(state, f);
    return;
  }
  if (!p || !state.parties.includes(p)) return;
  if (result.outcome === "victory") {
    lines.push(`You won. ${result.enemiesKilled || "Several"} of ${c.enemy.name} are down.`);
    lines.push(...victoryRewards(state, p, c, result));
    // The vehicle their party came in: from the battle map, or a fight resolved by the numbers against a party that drove.
    const ev = result.enemyVehicle || (setup.enemy && setup.enemy.vehicle ? { type: setup.enemy.vehicle, partyId: setup.enemy.vehiclePartyId } : null);
    if (ev) lines.push(takeTheirVehicle(state, p, f, ev));
  } else if (result.outcome === "retreat") {
    const lost = cargoLoad(p.cargo) > 0 ? rob(state, p, 0.25, f, false, true) : "";
    if (result.summary) lines.push(result.summary); // broken off by the numbers (breakoff.js): who got out, carried, taken
    lines.push(`You pulled back.${lost ? ` Some of the load was dropped: ${lost}.` : ""}`);
  } else {
    lines.push(`You lost the fight and scattered.`);
    if (f && c.enemy.kind !== "zombies") {
      // A trade caravan of yours (caravans.js) loses its whole load (caravanraids.js), and a share of the rest.
      const load = p.caravan ? rob(state, p, 1, f, true, true) : "";
      const lost = rob(state, p, 0.4, f);
      lines.push(`They took ${load && load !== "nothing much" ? `the whole load (${load}) and ` : ""}${lost}.`);
      const members = partyMembers(state, p);
      if (members.length && rng.chance(0.35)) {
        const s = rng.pick(members);
        takeCaptive(state, s, f, p);
        lines.push(`${s.name} was dragged off as a prisoner.`);
      }
    }
  }
  if (dead.length) lines.push(`Dead: ${dead.map((s) => s.name).join(", ")}.`);
  if (f && groupBroken(f)) collapseFaction(state, f);
  if (endIfEmpty(state, p, f)) {
    log(state, `${lines.join(" ")} Nobody from the team is free.`, "death");
    return;
  }
  const text = lines.join(" ");
  log(state, `Fight near ${tileLabel(state, partyTile(p))}: ${result.outcome}.`, result.outcome === "victory" ? "good" : "danger");
  afterFight(state, p, c, text);
}

function victoryRewards(state, p, c, result) {
  const rng = state.rng;
  const out = [];
  const f = factionById(state, c.factionId);
  if (c.type === "robbery") {
    const victim = c.victimId ? factionById(state, c.victimId) : null;
    if (victim) {
      changeGoodwill(state, victim, 15, "you saved their people");
      out.push(`The ${victim.name} traders are safe, and grateful: ${addCargo(state, p, "meds", rng.int(2, 4))} meds as thanks.`);
    }
    const fresh = [];
    for (let i = 0; i < (c.strangers || 0); i++) fresh.push(newRecruit(state, p));
    if (fresh.length) out.push(`${names(fresh)} ${fresh.length === 1 ? "asks" : "ask"} to come with you.`);
    askToJoin(state, p, fresh, "The robbers' victims are free.");
    out.push(`The robbers' haul: ${addCargo(state, p, "food", rng.int(6, 14))} days of food, ${addCargo(state, p, "scrap", rng.int(4, 10))} scrap.`);
  } else if (c.type === "prisoners") {
    const held = (c.held || []).map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s));
    for (const s of held) freeCaptive(state, s, p);
    const fresh = [];
    for (let i = 0; i < (c.strangers || 0); i++) fresh.push(newRecruit(state, p));
    if (held.length) out.push(`Freed: ${names(held)}, back with the team.`);
    if (fresh.length) out.push(`${held.length ? "The other prisoners" : "The prisoners"}, ${names(fresh)}, ${fresh.length === 1 ? "asks" : "ask"} to come with you.`);
    askToJoin(state, p, fresh, "Freed from the prisoner column.");
  } else if (c.type === "camp" || c.type === "ambush" || c.type === "roadblock" || c.type === "checkpoint" || c.type === "zealotpatrol" || c.type === "challenge" || c.type === "contest") {
    if (result && result.tactical) {
      // Fought on the map: the dead were there to search (the loot screen, or "Take all"), and that is the loot.
      // Nothing is paid a second time here.
      const got = [...Object.entries(result.loot.supplies).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${keyWord(k)}`), ...result.loot.gear.map((g) => g.name)];
      if (got.length) out.push(`Taken from the bodies: ${got.join(", ")}.`);
    } else {
      // Resolved by the numbers: there were no bodies to search, so the haul is rolled here.
      out.push(`Taken from the bodies: ${addCargoRounds(state, p, rng.int(15, 45), f ? kindTheme(f.type) : "raider", "bodies", partyTile(p), state.hour)}, ${addCargo(state, p, "food", rng.int(2, 8))} days of food.`); // rounds by calibre
      if (rng.chance(0.3)) {
        const key = swapGun(bodyGunSource(c.enemy && c.enemy.kind || (f && KIND_OF[f.type]) || "raiders"), rng.pick(["pistol", "shotgun", "huntrifle", "vest"]), rng); // gundist.js: a gun of their kind
        const dropped = (result && result.arsDropped) || []; // arsenal.js settleArsenal: what their dead carried (a group's people)
        const item = dropped.length ? (spend(rng), dropped[0]) : lootItem(key, kitSource(c.enemy && c.enemy.kind || (f && KIND_OF[f.type])), spend(rng)); // itemcond.js: by who they were
        out.push(stowGear(state, p, item) ? `Also a ${item.name}.` : `No room to carry the ${item.name} they had; it was left behind.`);
      }
    }
  } else if (c.type === "hordeattack") {
    const victim = c.victimId ? factionById(state, c.victimId) : null;
    if (victim) {
      changeGoodwill(state, victim, 12, "you saved their people");
      out.push(`The survivors are ${victim.name} people. They will remember this.`);
      if (rng.chance(0.3)) {
        const s = newRecruit(state, p);
        out.push(`${s.name} asks to stay with you anyway.`);
        askToJoin(state, p, [s], `${s.name} would rather stay with you than go back to ${victim.name}.`);
      }
    } else {
      const fresh = [];
      for (let i = 0; i < (c.strangers || 1); i++) fresh.push(newRecruit(state, p));
      out.push(`The survivors, ${names(fresh)}, ask to join the team.`);
      askToJoin(state, p, fresh, "You cut them out of the swarm.");
    }
  } else if (c.type === "skirmish") {
    const helped = factionById(state, c.helpedId);
    if (helped) {
      changeGoodwill(state, helped, 15, "you fought beside them");
      helped.lastDiplomacy = day(state);
      const key = rng.pick(["ammo", "meds"]);
      out.push(`${helped.name} thank you with ${key === "ammo" ? addCargoRounds(state, p, 40, kindTheme(helped.type), "thanks", partyTile(p), state.hour) : `${addCargo(state, p, key, 4)} ${key}`}.`); // rounds by calibre (their kind's)
    }
  }
  // Dead soldiers among the dead (deadsoldiers.js), the fight resolved by the numbers: a body or two to strip (on the
  // map they are searched like any body, so nothing here then).
  const mil = c.enemy && c.enemy.kind === "zombies" && !(result && result.tactical) ? armoredOf(c.enemy.mix) : null;
  if (mil) {
    const got = [];
    for (const kind of Object.keys(mil)) {
      const n = Math.min(2, Math.round(c.enemy.count * mil[kind] * 0.5));
      for (let i = 0; i < n; i++) {
        const loot = bodyLoot(rng, kind, armouredItem);
        for (const [k, q] of Object.entries(loot.sup)) got.push(`${addCargo(state, p, k, q)} ${keyWord(k)}`);
        for (const g of loot.gear) if (stowGear(state, p, g)) got.push(g.name);
      }
    }
    if (got.length) out.push(`Off the dead soldiers: ${got.join(", ")}.`);
  }
  if (c.type === "contest" && c.scavPartyId != null) {
    const said = driveOff(state, p, c.scavPartyId, addCargo); // aiscav.js: they leave the site, and drop their haul
    if (said) out.push(said);
  }
  if (c.aiPartyId) {
    const q = state.parties.find((x) => x.id === c.aiPartyId);
    if (q) {
      q.strength *= 0.4;
      if (q.strength < 2) removeParty(state, q);
      out.push(q.kind === "scav" ? "Their scavengers scatter." : "Their war party is broken.");
    }
  }
  return out;
}

// ---------- rescue missions ----------
const jailWord = (f, tile, state = null) => (JAIL[jailTier(f, tile, state)] || JAIL.makeshift).name; // jailhouse: the group's own jail (groupjails.js)
// The jail's own guards (groupjails.js groupJailGuards), for the rescue card: "2 of them guard the holding cells".
function jailGuardsLine(state, f) {
  const n = groupJailGuards(state, f);
  const jail = jailWord(f, f.bases[0], state).toLowerCase();
  return n ? `${n} of them ${n === 1 ? "guards" : "guard"} the ${jail} (on the map, posted at its door)` : `nobody guards the ${jail}`;
}
export function guardsFor(state, p, f) {
  const def = FACTION_TYPES[f.type];
  return {
    kind: KIND_OF[f.type], count: clamp(Math.round(f.pop * 0.3), 3, 12), power: Math.round(unitPower(f, 2.6) * 10) / 10, // arsenal.js: by their kit
    factionId: f.id, name: `${f.name} guards`, arsTask: "home",
  };
}

export function ransomValue(f, n) {
  const att = attitude(f);
  return Math.round(n * (40 + weightOf(f, "ransomHead", 0)) * ({ Hostile: 1.5, Neutral: 1, Friendly: 0.7, Allied: 0.5 }[att]));
}

export function rescueArrive(state, p) {
  const f = state.factions.find((x) => x.alive && x.bases.includes(p.dest));
  const held = f ? captivesOf(state, f.id) : [];
  if (!f || !held.length) {
    awaitOrders(state, p, f ? `${f.name} holds none of your people here.` : `Nobody holds ${tileLabel(state, p.dest)} anymore.`);
    return "";
  }
  f.known = true;
  addCard(state, rescueCard(state, p, f, held));
  return "";
}

function rescueCard(state, p, f, held) {
  const guards = guardsFor(state, p, f);
  const night = isNight(state);
  const stealthDc = 11 + Math.round(guards.count / 3) - (night ? 2 : 0);
  const sneak = skillChance(bestSkill(state, p, "stealth"), stealthDc);
  const assault = fightOdds(state, p, guards, null);
  const talkDcV = ({ Hostile: 16, Neutral: 11, Friendly: 7, Allied: 4 }[attitude(f)]) + weightOf(f, "rescueDc", 0); // GROUP_PRIORITIES rescueDc
  const talk = skillChance(talkSkill(state, p), talkDcV);
  const value = ransomValue(f, held.length);
  const plan = payPlan(p, value);
  const c = { type: "rescue", mode: "rescue", partyId: p.id, tile: partyTile(p), factionId: f.id, enemy: guards, exact: false, identified: true, held: held.map((s) => s.id) };
  p.phase = "engaged";
  p.conflictResume = "out";
  return {
    kind: "conflict", conflict: c, partyId: p.id, where: tileLabel(state, partyTile(p)),
    title: `Rescue at ${tileLabel(state, p.dest)}`,
    text: `${f.name} hold ${names(held)} here. About ${guards.count} guards are on the walls${night ? ", fewer awake at this hour" : ""}; ${jailGuardsLine(state, f)}.`,
    choices: [
      ...(tacticalPossible(state) ? [
        {
          label: "Sneak in on the map",
          hint: `Play it out on their base's map: nobody has seen you${night ? ", a third of them are asleep and the rest see less in the dark" : " (night would help: a third of them asleep)"}. Reach the ${jailWord(f, partyTile(p), state)}, get past its lock (the jailer's keys, lockpicks, force) and the ropes, and get everyone out by the edge of the map. Your people inside can work at the ropes and the lock themselves. Once the alarm is up, they all come. About ${pct(assault)} if it comes to a straight fight`,
          fight: { odds: assault, enemy: guards, ambush: null },
          resolve: (st) => { bump(st, "outcomes", "rescue-raid-sneak"); return startRescueRaid(st, p, f, "sneak"); },
        },
        {
          label: "Storm the base on the map",
          hint: `Play it out on their base's map, guns first: about ${pct(assault)} to beat the ${guards.count} guards. Their armory can be raided; your people inside can break out. Goodwill with ${f.name} collapses`,
          fight: { odds: assault, enemy: guards, ambush: null },
          resolve: (st) => { bump(st, "outcomes", "rescue-raid-assault"); return startRescueRaid(st, p, f, "assault"); },
        },
      ] : []),
      {
        label: tacticalPossible(state) ? "Sneak in by the numbers" : "Sneak in and get them out",
        hint: `Stealth check, ${pct(sneak)}${night ? " (night helps)" : " (better at night)"}. Failure: the alarm goes up and you fight the guards on their terms`,
        resolve: (st) => {
          if (st.rng.chance(sneak)) {
            for (const s of held) if (isCaptive(s)) freeCaptive(st, s, p);
            bump(st, "outcomes", "rescue-stealth");
            changeGoodwill(st, f, -5, "you broke out their prisoners");
            log(st, `${names(held)} ${held.length === 1 ? "was" : "were"} freed from ${f.name}.`, "good");
            delete p.conflictResume;
            awaitOrders(st, p, `In and out unseen: ${names(held)} ${held.length === 1 ? "is" : "are"} free.`);
            return "";
          }
          bump(st, "outcomes", "rescue-alarm");
          return startRescueFight(st, p, f, guards, "enemy", "alarm", true);
        },
      },
      {
        label: tacticalPossible(state) ? "Storm by the numbers" : "Storm the base",
        hint: `About ${pct(assault)} to win against ${guards.count} guards. Victory frees everyone held here. Goodwill with ${f.name} collapses`,
        fight: { odds: assault, enemy: guards, ambush: null },
        resolve: (st) => startRescueFight(st, p, f, guards, null, "assault", true),
      },
      {
        label: "Negotiate their release",
        hint: `Speech check, ${pct(talk)} (they are ${attitude(f).toLowerCase()}). Failure costs a little goodwill; you can still pay or fight`,
        resolve: (st) => {
          if (st.rng.chance(talk)) {
            for (const s of held) if (isCaptive(s)) freeCaptive(st, s, p);
            bump(st, "outcomes", "rescue-talk");
            delete p.conflictResume;
            awaitOrders(st, p, `${f.name} let ${names(held)} go.`);
            return "";
          }
          changeGoodwill(st, f, -3, "a failed negotiation");
          p.triedTalk = { ...(p.triedTalk || {}), [f.id]: true };
          bump(st, "outcomes", "rescue-talkfail");
          addCard(st, rescueCard(st, p, f, held.filter(isCaptive)));
          return `${f.name} refuse to talk. You can still try something else.`;
        },
        disabled: !!(p.triedTalk && p.triedTalk[f.id]),
      },
      {
        label: "Pay a ransom",
        hint: plan ? `Costs ${planText(plan)}. They hand over ${names(held)}` : `You do not carry enough (about ${value} worth of goods)`,
        disabled: () => !payPlan(p, value),
        resolve: (st) => {
          const pl = payPlan(p, value);
          if (!pl) {
            // Short of the price by now: the team is still at the gates with the other options.
            const still = held.filter(isCaptive);
            if (still.length) addCard(st, rescueCard(st, p, f, still));
            else { delete p.conflictResume; awaitOrders(st, p, `${f.name} holds none of your people here any more.`); }
            return "You no longer carry enough for the ransom.";
          }
          payFrom(p, pl, f, state);
          for (const s of held) if (isCaptive(s)) freeCaptive(st, s, p);
          bump(st, "outcomes", "rescue-ransom");
          changeGoodwill(st, f, 2);
          delete p.conflictResume;
          awaitOrders(st, p, `Paid ${planText(pl)}. ${names(held)} ${held.length === 1 ? "is" : "are"} back with the team.`);
          return "";
        },
      },
      { label: "Leave for now", hint: "Wait for orders outside", resolve: (st) => { delete p.conflictResume; awaitOrders(st, p, ""); return ""; } },
    ],
  };
}

// quick: by the numbers even with the battle screen there (the card's "by the numbers" choices).
function startRescueFight(state, p, f, guards, ambush, mode, quick = false) {
  p.phase = "engaged";
  startCombat(state, {
    tile: partyTile(p), partyId: p.id, enemy: { ...guards }, ambush, canRetreat: true, handler: "rescue", quick,
    context: { partyId: p.id, factionId: f.id, mode },
  });
  return "";
}

// The rescue's fight settled (by the numbers; rescueraid.js hands a raid fought by the numbers here too).
export function settleRescue(state, result, setup) { return onRescueCombat(state, result, setup); }
function onRescueCombat(state, result, setup) {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId);
  const f = factionById(state, c.factionId);
  bump(state, "outcomes", `rescue-${result.outcome}`);
  if (f) {
    f.pop = Math.max(0, f.pop - Math.ceil((result.enemiesKilled || 0) * 0.6));
    changeGoodwill(state, f, c.mode === "assault" ? -30 : -20, "you attacked their base");
  }
  if (p && state.parties.includes(p) && !partyMembers(state, p).length) {
    wipeParty(state, p);
    log(state, `The rescue team died at ${f ? f.name : "the enemy base"}.`, "death");
    return;
  }
  if (!p || !state.parties.includes(p)) return;
  let text;
  if (result.outcome === "victory" && f) {
    const held = captivesOf(state, f.id).filter((s) => s.location.tile === p.dest || f.bases.includes(p.dest));
    for (const s of held) freeCaptive(state, s, p);
    text = `The guards are beaten. ${held.length ? `${names(held)} ${held.length === 1 ? "is" : "are"} free.` : "But the prisoners had been moved."}`;
    log(state, `Your team broke into ${f.name}'s base${held.length ? ` and freed ${names(held)}` : ""}.`, "good");
  } else {
    text = result.outcome === "retreat" ? `${result.summary ? `${result.summary} ` : ""}You pulled back from the walls.` : "The attack failed.";
    const members = partyMembers(state, p);
    if (f && result.outcome === "defeat" && members.length && state.rng.chance(0.3)) {
      const s = state.rng.pick(members);
      takeCaptive(state, s, f, p);
      text += ` ${s.name} was caught.`;
    }
  }
  if (f && groupBroken(f)) collapseFaction(state, f);
  if (endIfEmpty(state, p, f)) return;
  delete p.conflictResume;
  awaitOrders(state, p, text);
}

// Ransom offered at the start of a trade visit.
export function ransomOnTradeCard(state, p, f) {
  const held = captivesOf(state, f.id);
  if (!held.length) return null;
  const value = Math.round(ransomValue(f, held.length) * 0.9);
  const plan = payPlan(p, value);
  const talk = skillChance(talkSkill(state, p), ({ Hostile: 16, Neutral: 11, Friendly: 7, Allied: 4 }[attitude(f)]) + weightOf(f, "rescueDc", 0));
  return {
    kind: "conflict", partyId: p.id,
    conflict: { type: "ransom", mode: "rescue", partyId: p.id, factionId: f.id, enemy: guardsFor(state, p, f), exact: false, identified: true, held: held.map((s) => s.id) },
    title: `Your people at ${f.name}`,
    text: `${f.name} hold ${names(held)}. Before you trade, you can try to get them back.`,
    choices: [
      {
        label: "Pay the ransom",
        hint: plan ? `Costs ${planText(plan)} from what the team carries. They join the team` : `You do not carry enough (about ${value} worth of goods)`,
        disabled: () => !payPlan(p, value),
        resolve: (st) => {
          const pl = payPlan(p, value);
          if (!pl) return "You no longer carry enough for the ransom. The trade visit goes on.";
          payFrom(p, pl, f, state);
          for (const s of held) if (isCaptive(s)) freeCaptive(st, s, p);
          changeGoodwill(st, f, 2);
          bump(st, "outcomes", "trade-ransom");
          return `Paid ${planText(pl)}. ${names(held)} rejoin the team.`;
        },
      },
      {
        label: "Ask them to let them go",
        hint: `Speech check, ${pct(talk)}. Failure costs a little goodwill`,
        resolve: (st) => {
          if (st.rng.chance(talk)) {
            for (const s of held) if (isCaptive(s)) freeCaptive(st, s, p);
            bump(st, "outcomes", "trade-talk");
            return `${f.name} agree. ${names(held)} rejoin the team.`;
          }
          changeGoodwill(st, f, -2);
          return `${f.name} refuse.`;
        },
      },
      { label: "Not now", hint: "Go on with the trade visit", resolve: () => "" },
    ],
  };
}

// ---------- captives over time ----------
// A captive who kept something hidden after a failed rescue (rescueraid.js: location.tool) escapes likelier, a day.
export const CAPTIVE_TOOL = { pin: 0.005, picks: 0.01, key: 0.015 };
export function captivesDaily(state) {
  const rng = state.rng;
  if (!hub(state)) return; // no base left (conquest.js exiles): nowhere to come home to; they stay where they are
  for (const s of allCaptives(state)) {
    const f = factionById(state, s.location.factionId);
    const days = (state.hour - s.location.since) / 24;
    if (!f || !f.alive || !f.bases.length) {
      if (rng.chance(0.75)) {
        releaseHome(state, s);
        captiveEvent(state, "freed", `${s.name} is home`, `${f ? f.name : "Their captors"} fell apart, and ${s.name} walked out in the chaos. They made it back to ${hub(state).name}.`, "good");
      } else {
        s.location = { kind: "base", baseId: hub(state).id };
        hurt(state, s, 999, null, `trying to get home after ${f ? f.name : "their captors"} collapsed`);
        captiveEvent(state, "lost", `${s.name} is lost`, `${f ? f.name : "Their captors"} fell apart. ${s.name} never made it home.`, "death");
      }
      continue;
    }
    if (!f.bases.includes(s.location.tile)) s.location.tile = f.bases[0];
    s.mood = Math.max(0, s.mood - 2);
    // groupjails.js: worked by their captors (health and mood down; raiders worst), and some do not survive it.
    if (captiveDecline(state, s, f)) {
      captiveEvent(state, "killed", `${s.name} is dead`, `Word comes that ${s.name} was worked to death by ${f.name}.`, "death");
      checkGameOver(state);
      continue;
    }
    const att = attitude(f);
    if ((att === "Friendly" || att === "Allied") && rng.chance(0.35)) {
      releaseHome(state, s);
      captiveEvent(state, "released", `${f.name} release ${first(s)}`, `Relations with ${f.name} are good enough that they let ${s.name} go. ${first(s)} is back at ${hub(state).name}.`, "good");
    } else if (weightOf(f, "killCaptive", 0) > 0 && days > 2 && rng.chance(weightOf(f, "killCaptive", 0))) { // GROUP_PRIORITIES killCaptive
      hurt(state, s, 999, null, `at the hands of ${f.name}`);
      captiveEvent(state, "killed", `${s.name} is dead`, `Word comes that ${f.name} "purified" ${s.name}.`, "death");
    } else if (days > 10 && !s.leader && rng.chance(weightOf(f, "turnCaptive", 0.015) * captiveTurnMult(s))) { // GROUP_PRIORITIES turnCaptive; broken by it: more likely
      // They go over as the very person (members.js joinFromYours: into the group's list, a stub of who they were stays
      // in yours), with whatever was left on them; their kit onto the group's books as a recruit's. Their rounds came
      // over with them as a captive (takeCaptive noted them).
      joinFromYours(state, f, s, f.bases && f.bases[0]);
      for (const it of allCarried(s)) if (it && !isRoundItem(it)) addToArsenal(state, f, it, "recruit");
      const stub = state.survivors.find((x) => x.id === s.formerId);
      if (stub) stub.recruitedBy = f.id;
      captiveEvent(state, "recruited", `${first(s)} has joined ${f.name}`, `After ${Math.floor(days)} days as a prisoner, ${s.name} has taken ${f.name}'s side. They are one of them now.`, "death");
      checkGameOver(state); // the last one alive changing sides ends the run (world.js)
    } else if (rng.chance(captiveEscape(state, s, f))) { // groupjails.js: their jail's tier, the work detail, Stealth, and a pin, lockpicks or the keys kept hidden (CAPTIVE_TOOL, rescueraid.js)
      s.health = Math.max(10, s.health - rng.int(5, 25));
      releaseHome(state, s);
      captiveEvent(state, "escaped", `${first(s)} escaped!`, `${s.name} slipped out of ${f.name}'s base and made it home, hungry and hurt.`, "good");
    }
  }
}

function captiveEvent(state, key, title, text, kind) {
  bump(state, "captiveEvents", key);
  log(state, text, kind);
  addCard(state, { title, text, choices: [{ label: "OK", resolve: () => "" }] });
}

// ---------- base defense in person (from the raid warning) ----------
const baseHasWalls = (base) => hasWall(base); // buildings.js: a wall closed round it
// A raid of a given strength as people on the battle map: the head count the lookouts report (at least 1), and
// each attacker's power set so that count × power is the raid's stated strength.
export function raidForce(f, strength) {
  const usual = unitPower(f, 2.2); // arsenal.js: 2.2 + arms × 1.6 × their kit (raidCount counts the same)
  const count = clamp(Math.round(strength / usual), 1, 14);
  return { count, power: Math.round((strength / count) * 10) / 10 };
}

export function defendInPerson(state, raid) {
  const f = factionById(state, raid.owner);
  const base = state.bases.find((b) => b.id === raid.target.baseId);
  if (!f || !base) return "";
  const force = raidForce(f, raid.strength);
  startCombat(state, {
    tile: base.tile, baseId: base.id,
    enemy: { kind: KIND_OF[f.type], count: force.count, power: force.power, factionId: f.id, partyId: raid.id, name: `${f.name} raiders`, siege: raid.siege || null, arsTask: baseHasWalls(base) ? "walls" : "raid", ...(raidTurret(state, raid) ? { turret: raidTurret(state, raid) } : {}) }, // siege.js: their ladders, ram and grenades; arsTask: arsenal.js issueKit; turret: the Humvee the raid brought (vehicles.js; on the map: combat.js placeRaidHumvee)
    // raid.surprise (watch.js surpriseAt: an unwatched night): they are over the wall and have the first move.
    ambush: raid.surprise ? "enemy" : base.alert ? "player" : null, canRetreat: true, handler: "raidDefense", context: { raidId: raid.id, baseId: base.id, factionId: f.id, surprise: !!raid.surprise, armory0: base.armory.length }, // the way out: away from the attack (deploy.js); armory0: your dead's gear is what lands in the armory after it (arsenal.js)
    layout: "baseDefence", deploy: true, // deploy.js: the base's walls on the map, defenders placed first
  });
  return "";
}

function onRaidDefenseCombat(state, result, setup, battle = null) {
  const c = setup.context;
  const raid = state.parties.find((x) => x.id === c.raidId);
  const f = factionById(state, c.factionId);
  const base = state.bases.find((b) => b.id === c.baseId);
  if (f) f.pop = Math.max(0, f.pop - Math.ceil((result.enemiesKilled || 0) * 0.7));
  const humveeKept = !!raid && (result.outcome !== "victory" || !!result.humveeOut); // combat.js raidCarTurn: it drove off with them, or they won
  if (humveeKept && result.humveeWear) wearRaidHumvee(state, raid, result.humveeWear); // vehicles.js: what it took on the map
  let text;
  if (result.outcome === "retreat" && base && state.bases.includes(base) && raid && f) {
    // Pulled out of the fight: the base is abandoned to them (conquest.js), its people walk to the nearest base.
    retreatFrom(state, base, raid);
    resolveRaidOnPlayer(state, raid);
    removeParty(state, raid);
    text = `Your people pulled out of ${base.name} and left it to ${f.name}.${state.bases.includes(base) ? "" : " They are on their way to another base."}`;
    if (groupBroken(f)) collapseFaction(state, f);
    addCard(state, { title: "Raid defense", text, choices: [{ label: "OK", resolve: () => "" }] });
    return;
  }
  if (result.outcome === "victory") {
    if (raid) warRaidOnPlayer(state, raid, true); // diplomacy.js: a war raid beaten off counts for the war, as one held by the numbers
    const hv = raid && base && state.bases.includes(base) && !humveeKept ? loseRaidHumvee(state, raid, { base }) : null; // vehicles.js: the Humvee they brought is left behind (unless it drove off)
    if (raid) removeParty(state, raid);
    if (base) base.alert = false;
    state.stats.raidsRepelled += 1;
    raidRepelled(state, f); // factions.js: a grudge, and their next raid bigger
    text = `${base ? base.name : "The base"} beat off the ${f ? f.name : ""} raid in a stand-up fight.`;
    log(state, text, "good");
    if (hv) { text += ` ${humveeLeftText(f, hv, base)}`; log(state, humveeLeftText(f, hv, base), "good"); }
    else if (result.humveeOut) text += " Their Humvee got away.";
    // What the raiders who slipped away carried off from the stores on the base map (basemap.js) goes home with them.
    const took = battle && battle.stolen && base && state.bases.includes(base) ? applyStolen(state, base, battle.stolen) : null;
    if (took && f) { for (const [k, q] of Object.entries(took.sup)) f.stock[k] = (f.stock[k] || 0) + q; for (const g of took.gear) { f.lootedGear.push(g.name); addToArsenal(state, f, g, "stolen"); } text += ` ${took.text}`; log(state, `Raiders got away from ${base.name} with some of the stores: ${took.text}`, "danger"); }
    // A stand-up fight at the walls still costs a little: a turn of the battle counts as 20 minutes of siege.
    if (base && raid && state.bases.includes(base)) {
      const dmg = raidDamage(state, base, { strength: raid.strength, hours: (raid.siegeHours || 0) + clamp((result.turns || 6) / 3, 1, 8), outcome: "won", by: f ? f.name : "the raiders" });
      text += ` ${dmg.text}`;
    }
  } else {
    // That battle was the raid, and the defenders lost it: the raiders are inside and take what they came for.
    // There is no second fight by the numbers; the people at the base have already taken their losses.
    const left = (result.enemiesLeft || 0) / Math.max(1, setup.enemy.count);
    const how = left > 0.5 ? "overrun" : "broken";
    const name = base ? base.name : "the base";
    const res = raid && base && state.bases.includes(base) ? resolveRaidOnPlayer(state, raid, { beaten: how, armory0: c.armory0 }) : null;
    if (raid) removeParty(state, raid);
    text = !raid ? `The defenders were beaten, but the raiders had already turned back.`
      : how === "overrun" ? `The defenders were beaten. ${f ? f.name : "The raiders"} overran ${name} and took what they wanted.`
      : `The defenders were beaten, but the raiders were too badly mauled to hold ${name}. They grabbed what they could carry and left.`;
    if (res && res.dmg) text += ` ${res.dmg.text}`;
  }
  if (f && groupBroken(f)) collapseFaction(state, f);
  addCard(state, { title: "Raid defense", text, choices: [{ label: "OK", resolve: () => "" }] });
}

// ---------- stranded teams ----------
// What is holding an "engaged" team in place: "card", "battle", "search", "trade", or null when nothing is.
export function engagedWith(state, p) {
  if (state.cards.some((c) => c.partyId === p.id)) return "card";
  if (battlePending(state, p.id)) return "battle";
  if (state.engagement && state.engagement.partyId === p.id) return "search";
  if (tradePending(state, p.id)) return "trade";
  if (p.crawl) return "crawl"; // a city crawl (citycrawl.js): its block card holds the team
  if (p.hiveCrawl) return "crawl"; // a hive crawl (hivecrawl.js): its window holds the team
  return null;
}

// Every hour (world.js tickHour): an engaged team must have something that will let it go again. If nothing
// does for two hours running (its card was lost, a one-at-a-time screen went to another team), the team
// checks in for orders. That works in or out of radio range: a waiting team can always be given orders.
export function releaseStranded(state) {
  if (state.resolving) return; // inside a battle's aftermath (e.g. the hours a raid took, scavenge.js afterRaid)
  advanceTradeQueue(state);
  for (const p of [...state.parties]) {
    if (!state.parties.includes(p) || p.owner !== "player") continue;
    if (p.phase !== "engaged" || engagedWith(state, p) || !partyMembers(state, p).length) {
      delete p.stranded;
      continue;
    }
    p.stranded = (p.stranded || 0) + 1;
    if (p.stranded < 2) continue;
    delete p.stranded;
    delete p.conflictResume;
    if (p.kind === "convoy") startReturn(state, p);
    else awaitOrders(state, p, "The team regroups and checks in.");
  }
}

// ---------- for the UI ----------
// Everything the approach panel shows about a conflict card.
export function conflictView(state, c) {
  const p = state.parties.find((x) => x.id === c.partyId);
  const f = c.factionId != null ? factionById(state, c.factionId) : null;
  const members = p ? partyMembers(state, p) : [];
  const e = c.enemy;
  const lo = c.exact ? e.count : Math.max(1, Math.round(e.count * 0.75));
  const hi = c.exact ? e.count : Math.round(e.count * 1.3);
  const mine = members.reduce((a, m) => a + combatPower(m), 0);
  const v = p ? partyVehicle(state, p) : null;
  return {
    party: p, members, faction: f, identified: c.identified || !f,
    attitude: f ? attitude(f) : null, typeLabel: f ? FACTION_TYPES[f.type].label : "The dead",
    countText: lo === hi ? `${lo}` : `${lo}–${hi}`,
    theirStrength: Math.round(e.count * e.power), myStrength: Math.round(mine),
    ammo: p ? carriedAmmo(p) : 0,
    arrows: p ? carriedOf(p, "arrows") : 0, archers: members.filter(usesArrows).length, // the bows shoot arrows (world.js usesArrows)
    vehicle: v ? `${v.name}, fuel ${Math.floor(partyFuel(state, p))}` : "On foot",
    skills: p ? { stealth: bestSkill(state, p, "stealth"), speech: bestSkill(state, p, "speech"), scouting: bestSkill(state, p, "scouting") } : {},
    held: (c.held || []).map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s)),
    victim: c.victimId ? factionById(state, c.victimId) : null,
    other: c.otherId ? factionById(state, c.otherId) : null,
    modeText: c.mode === "forced" ? "They found you first" : c.mode === "observed" ? "You spotted them first. They have not seen you" : "At their gates",
  };
}

