// @ts-check
// Crashlanding: the start and the scripted chain (2026-10-24, the user's request; the numbers and the words in
// crashmode.js CRASH / CRASH_UNIT, the request quoted there). A normal-mode world of 500 × 250 hexes with no base:
// - The crash (prepareCrash, from world.js createWorld before the points of interest are made): the calendar is set to
//   year 4, day 1 (three years after the fall; eras.js yearStartDay), the crash tile is drawn with startpick.js
//   pickStart (open land that is no city, town, site, hive or Guard base, far enough out that the base across the map
//   is at least CRASH.FAR × the diagonal away: the new-run screen's New start position and Pick start on map work as in
//   Hardcore), the unit's base is the mirror of the crash tile through the map's centre snapped to the best tile within
//   CRASH.HOME_NEAR of it (a Guard base there, else open land where a Guard base site is placed, state.militaryIds), and
//   the unit's secret fallback (state.crash.nextTile: a mountain-edge tile far from the base in a quadrant of its own,
//   nothing on it: no site, no POI, nothing in the knowledge) is chosen but not made.
// - The start (setupCrashStart, after the groups and before the hives): one survivor (makeSurvivor, background
//   "soldier": hardcore-start.js archetypeOf), the fixed kit (CRASH_KIT: the carbine and pistol loaded, the chest rig
//   with spare magazines, the plate carrier and helmet, the trauma kit, a tourniquet, the broken military radio), the
//   party on the crash tile (owner "player", exile, no home base: it takes orders from its panel and Establish base
//   founds the first hub as the conquest.js exiles' does), the heli wreck on the tile (crashes.js placeSite: site
//   crash_mil at CRASH.WRECK_LOOT, found and known at once, expiring as crash sites do; the groups within reach race
//   for it; the crash's noise: pois.js addTileHeat CRASH.HEAT and the hordes within crashes.js CRASH.hordeRange lured
//   for CRASH.LURE_HOURS from crashHour), the unit's base in the knowledge as a Guard base with a "crashhome" marker,
//   the hives pre-aged (CRASH.HIVE_AGE_DAYS) and every tile's loot and non-site POI pool × CRASH.LOOT (the wreck kept).
// - The chain (crashHour, from world.js tickHour): the reveal when a team of yours stands on the base (state.crash.revealed:
//   the card, harder dead there: heat, infection, deadsoldiers.js siteDeadMix, hivetech.js siteSpecials), a young hive
//   born once your teams have left it (hives.js newHive, hive.crashBase; the tile's site stays with loc.look "hivebase":
//   ui/mapsprites.js paints the infested base), the hive's death (hives.js destroyHive → crashHiveDied: the message in
//   the wreckage with a general region, the bunker made on nextTile as a secret site with the unit's REMNANT in it
//   (the user, 2026-10-24: "Make the bunker hold the unit's remnant so you can join them and you can decide to end the
//   run or take over controlling that base": makeRemnant, a military AI group like any other, ADR 0001, unknown and
//   sealed off (hcNoExpand / hcNoGrow, no raids) until found, the cache as its stores, real people with soldiers' kit),
//   stage "trail"; hivecrawl.js hiveHoard → crashBaseHaul: the base's stores as the prize, once), the bunker found by a
//   team standing on it (crashBunkerFound: the group known and allied, the "Reunited" card: join them and end the run
//   (crashJoin: a victory, victoryReason "reunited"; Keep playing leaves them an ally in the coalition), take command of
//   the bunker (crashCommand: their people join your survivors with their kit, the base is yours through conquest.js
//   captureBase as a ceded base with all its stores, the group dissolved; stage "command"), or not yet (stage stays
//   "found" and the card comes again on every arrival of a team of yours: crashHour). The repaired radio (crafting.js →
//   noteRadioFixed) gets dead air on the unit's frequency: one log line and a chronicle note.
// - Cars (foundcars.js carRecord, citycrawl.js): crashCarDead says a car's engine is beyond repair (1 − CRASH.CAR_FIX),
//   crashSiphon scales the fuel in any tank (× CRASH.SIPHON).
import { CRASH, CRASH_UNIT, isCrashRun, crashHomeName } from "./crashmode.js";
import { achievementsEnd } from "./achievements.js"; // the run's achievements at the bunker's ending
import { makeSurvivor, applyCrew, crewDice, newId, log, addCard, snapshot, updateVision, day, checkGameOver, alive, factionById } from "./world.js";
import { yearStartDay } from "./eras.js";
import { pickStart, chosenStart, isSettlementTile } from "./startpick.js";
import { LOCATIONS, GEAR, SUPPLY_KEYS } from "./data.js";
import { newItem, stow, ensureInv, lootItem } from "./inventory.js";
import { applyArchetype, introCard } from "./hardcore-start.js";
import { partyMembers, partyTile, tileLabel, sightRadius, weighTeam, settleInto } from "./parties.js";
import { settleParty, sortFind } from "./ammo.js";
import { qtyOf } from "./foods.js";
import { crashes, placeSite, CRASH as CRASH_EV, CRASH_KINDS } from "./crashes.js";
import { addTileHeat, generatePois, clearPois, poisOf, isSitePoi, ensurePois } from "./pois.js";
import { ensureHives, newHive, HIVE } from "./hives.js";
import { createFactions, recomputeOwnership, makeGang, changeGoodwill } from "./factions.js";
import { ensureMembers, membersOf, removeMember } from "./members.js"; // the remnant's people (ADR 0001)
import { admitToAlliance } from "./alliance.js"; // joining them: the unit in the coalition
import { captureBase } from "./conquest.js"; // taking command: the bunker changes hands as a ceded base
import { issueKit, arsenalShareTo } from "./arsenal.js"; // the remnant's kit: issued to its people as they join you, the rest to the bunker's armory
import { assignStations } from "./buildings.js";
import { chronicleNote, startChronicle } from "./chronicle.js";
import { hash01 } from "./skills.js";
import { loadUpAll } from "./itemacts.js";
import { seedRoadCarts } from "./carts.js";

const roll = (state, ...k) => hash01(state.seed, "crashland", ...k);
const isLand = (t) => t && t.terrain !== "water" && t.terrain !== "mountain";
/** @param {any} state @param {number} id */
const groupBaseAt = (state, id) => state.factions.some((f) => f.alive !== false && (f.bases || []).includes(id));
/** The map's corner-to-corner hex distance. @param {any} g */
const diagonal = (g) => g.distance(0, g.width * g.height - 1);
/** Which quarter of the map a tile is in (0–3). @param {any} g @param {number} id */
function quadrant(g, id) {
  const [x, y] = g.xy(id);
  return (x * 2 >= g.width - 1 ? 1 : 0) + (y * 2 >= g.height - 1 ? 2 : 0);
}
const DIRS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
/** The compass word from one tile to another. @param {any} state @param {number} from @param {number} to */
function direction(state, from, to) {
  const [ax, ay] = state.grid.toPixel(from, 1), [bx, by] = state.grid.toPixel(to, 1);
  const a = Math.atan2(by - ay, bx - ax);
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
/** The nearest town or city centre to a tile: its tile, or null. @param {any} state @param {number} id */
function nearestTown(state, id) {
  let best = null, bd = Infinity;
  for (const t of state.tiles) {
    if (!t.loc || (t.loc.type !== "town" && t.loc.type !== "city")) continue;
    const d = state.grid.distance(t.id, id);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
/** Your teams standing on a tile (not convoys). @param {any} state @param {number} tile */
const teamsOn = (state, tile) => state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && p.path && partyTile(p) === tile && partyMembers(state, p).length);

// ---------- the map (world.js createWorld, before ensurePois) ----------
/**
 * The calendar, the crash tile, the unit's base and the secret bunker's tile. start: the new-run screen's New start
 * position / Pick start on map (startpick.js).
 * @param {any} state @param {{ roll?: number | null, not?: number | null, tile?: number | null } | null} start
 */
export function prepareCrash(state, start) {
  const g = state.grid, W = g.width, H = g.height, rng = state.rng;
  state.hour = (yearStartDay(CRASH.YEAR) - 1) * 24 + 6; // year 4, day 1, 06:00 (eras.js; the loot and the shops age with it: itemcond.js, foods.js)
  state.crash = { tile: null, homeTile: null, homeName: CRASH_UNIT.name, baseName: "", nextTile: null, nextName: `the ${CRASH_UNIT.name} ${CRASH_UNIT.bunker.toLowerCase()}`, revealed: null, hiveHidden: true, hiveBorn: null, hiveLooted: null, radioFixed: null, deadAir: null, stage: "base", trail: "", lureUntil: 0, remnantFid: null, bunkerTeams: [] };
  const diag = diagonal(g);
  const far = Math.ceil(CRASH.FAR * diag);
  const mirror = (id) => { const [x, y] = g.xy(id); return g.id(W - 1 - x, H - 1 - y); };
  const ok = (t) => isLand(t) && !t.hive && !t.loc && !isSettlementTile(t) && !state.militaryIds.includes(t.id) && !t.river;
  // Far enough out that the mirror tile (and anything within HOME_NEAR of it) is CRASH.FAR × the diagonal away and on
  // the other side of both centre lines: "on the other side diagonal to the crash site".
  const diagonalOk = (t) => { const m = mirror(t.id); return g.distance(t.id, m) >= far + CRASH.HOME_NEAR && Math.abs(2 * t.x - (W - 1)) > 2 * (CRASH.HOME_NEAR + 1) && Math.abs(2 * t.y - (H - 1)) > 2 * (CRASH.HOME_NEAR + 1); };
  const rolled = pickStart(rng, [() => state.tiles.filter((t) => ok(t) && diagonalOk(t)), () => state.tiles.filter(ok), () => state.tiles.filter((t) => isLand(t) && !t.hive)], start);
  const tile = chosenStart(state, start) || rolled;
  state.crash.tile = tile.id;
  // The unit's base: the mirror snapped to the best tile within HOME_NEAR of it.
  const m = mirror(tile.id);
  const near = g.within(m, CRASH.HOME_NEAR);
  const guard = near.filter((id) => state.militaryIds.includes(id) && (!state.tiles[id].loc || state.tiles[id].loc.type === "military")).sort((a, b) => g.distance(a, m) - g.distance(b, m) || a - b); // a Guard base (not an air base: issue #25)
  let home = guard[0] ?? null;
  if (home == null) {
    const open = near.filter((id) => { const t = state.tiles[id]; return ok(t) && t.terrain !== "suburb" && t.terrain !== "city"; }).sort((a, b) => g.distance(b, tile.id) - g.distance(a, tile.id) || a - b);
    home = open[0] ?? near.filter((id) => isLand(state.tiles[id]) && !state.tiles[id].hive && !isSettlementTile(state.tiles[id])).sort((a, b) => g.distance(b, tile.id) - g.distance(a, tile.id) || a - b)[0] ?? m;
    const t = state.tiles[home];
    t.loc = { type: "military", name: `${CRASH_UNIT.name} base`, zone: "special" };
    t.loot = LOCATIONS.military.richness;
    delete t.ruin;
    state.militaryIds.push(home);
  }
  state.crash.homeTile = home;
  state.crash.baseName = state.tiles[home].loc.name;
  // The secret bunker: a mountain-edge tile (mountains are walked over on foot: parties.js) far from the base, in a
  // quadrant that is neither the crash's nor the base's, with nothing on it. Deterministic from the seed.
  const qs = new Set([quadrant(g, tile.id), quadrant(g, home)]);
  const minFar = Math.ceil(CRASH.BUNKER_FAR * diag);
  const edge = (t) => t.terrain === "mountain" && g.neighbors(t.id).some((n) => isLand(state.tiles[n]));
  const bunkerOk = (t) => !t.loc && !t.hive && !qs.has(quadrant(g, t.id)) && g.distance(t.id, home) >= minFar && !state.militaryIds.includes(t.id) && !groupBaseAt(state, t.id);
  let cands = state.tiles.filter((t) => edge(t) && bunkerOk(t));
  if (!cands.length) cands = state.tiles.filter((t) => (t.terrain === "hills" || t.terrain === "forest") && bunkerOk(t));
  if (!cands.length) cands = state.tiles.filter((t) => isLand(t) && !isSettlementTile(t) && bunkerOk(t));
  state.crash.nextTile = cands.length ? cands[Math.floor(roll(state, "bunker") * cands.length) % cands.length].id : null;
}

// ---------- the start (world.js createWorld, after prepareCrash) ----------
/**
 * @param {any} state
 * @param {{ factionCount: number, crew?: any[] | null }} opts
 */
export function setupCrashStart(state, { factionCount, crew = null }) {
  const g = state.grid, C = state.crash, tile = C.tile;
  ensurePois(state); // pois.js: every tile's points of interest (hash dice from the seed), the unit's base site among them
  if (C.nextTile != null) clearPois(state.tiles[C.nextTile]); // nothing on the bunker's tile until it exists
  createFactions(state, factionCount);
  recomputeOwnership(state);
  // The survivor: a soldier (hardcore-start.js archetypeOf "soldier"), the dice's traits and look; the new-run screen's
  // edits (name, look, skills, traits) apply, its gear picks never: the kit is fixed.
  const endCrew = crewDice(state); // world.js: the soldier's own dice, to the kit below
  const s = makeSurvivor(state, 1.3);
  state.survivors.push(s);
  s.leader = true;
  applyArchetype(state, s, "soldier");
  if (crew) applyCrew(state, crew.map((c) => (c ? { ...c, gear: undefined, startGear: undefined } : c)));
  s.leader = true;
  delete s.startGear;
  delete s.startPoints;
  state.startPeople = 1;
  state.fleet = []; // no vehicle (the user: "You do not start with a vehicle")
  state.startVehicles = false;
  crashKit(state, s);
  endCrew();
  // The party: Hardcore's road team in a normal-mode world (exile, no home base: parties.js and staging.js treat a run
  // with no base alike in both modes).
  // The rounds: CRASH.RIFLE_ROUNDS and PISTOL_ROUNDS beyond what fills the guns and the spare magazines (loadUpAll below takes those out of the supplies).
  const sup = { water: CRASH.WATER, a_556_fmj: CRASH.RIFLE_ROUNDS + 30 * (1 + CRASH.STANAG_MAGS), a_9mm_fmj: CRASH.PISTOL_ROUNDS + 15 * (1 + CRASH.GLOCK_MAGS), meds: CRASH.MEDS, f_mre: qtyOf("f_mre", CRASH.MRE_DAYS) };
  for (const k of SUPPLY_KEYS) if (sup[k] == null) sup[k] = 0;
  const p = {
    id: newId(), owner: "player", kind: "expedition", mission: "move", teamMission: "crash", dest: tile, homeBaseId: null,
    members: [s.id], stance: "normal", vehicle: false, vehicleId: null, supplies: sup, cargo: { supplies: {}, gear: [] },
    path: [tile], idx: 0, progress: 0, phase: "waiting", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: true,
    departed: state.hour, plannedHours: 0, eventsSeen: 0, orders: [], orderStart: state.hour,
    planPath: [tile], planStart: state.hour, planVehicle: false, planFuel: 0, etaOut: 0, etaBack: null,
    exile: true, crashStart: true,
  };
  s.location = { kind: "party", partyId: p.id };
  s.role = "scavenge";
  s.station = null;
  state.parties.push(p);
  settleParty(state, p); // ammo.js: the team's calibres
  state.kitV = 2;
  state.ammoCal = 2; state.stacks = 1; state.physOutV = 1; // as every new world (save.js migrates older ones)
  loadUpAll(state, { stores: true }); // itemacts.js: the carbine, the pistol and the magazines loaded from the team's rounds (a soldier's issue comes loaded)
  weighTeam(state, p);
  p.sightNow = g.within(tile, sightRadius(state, p));
  // The wreck: a found crash site on the tile (crashes.js: the same record a wreck found mid-game has, so it burns out
  // in 7–10 days, the groups within reach race for it and a raid is a raid on the site).
  crashWreck(state, tile);
  addTileHeat(state, tile, CRASH.HEAT); // pois.js: the crash was loud (scavenge.js raidEnemies: more of the dead, a surge)
  C.lureUntil = state.hour + CRASH.LURE_HOURS; // crashHour: the hordes within reach come to the noise
  // The unit's base: known in the fog as a Guard base (nothing of what waits there), and marked.
  state.knowledge[C.homeTile] = snapshot(state, C.homeTile);
  state.markers.push(homeMarker(state));
  seedRoadCarts(state); // carts.js: abandoned carts on the roads (its own dice)
  // The hives: as the map makes them, three years older (their tiers follow the calendar: hivetech.js), then the loot.
  ensureHives(state);
  for (const h of state.hives) h.born -= CRASH.HIVE_AGE_DAYS * 24;
  crashLootScale(state);
  state.crashNext = state.hour + (CRASH_EV.firstMin + Math.floor(roll(state, "nextcrash") * (CRASH_EV.firstMax - CRASH_EV.firstMin + 1))) * 24; // crashes.js: its first scheduled crash counts from this day, not day 1
  updateVision(state);
  const unit = crashHomeName(state), town = nearestTown(state, tile);
  const where = town ? `${g.distance(tile, town.id)} tiles ${direction(state, town.id, tile)} of ${town.loc.name}` : "in open country";
  log(state, `Year ${CRASH.YEAR}, three years after Calder fell. The helicopter is down ${where} and ${s.name.split(" ")[0]} is the only one who got out. ${unit}'s base is on the far side of the state, ${g.distance(tile, C.homeTile)} tiles to the ${direction(state, tile, C.homeTile)}. ${state.factions.length} other groups are out there somewhere.`, "info");
  log(state, `The wreck can be searched (Scavenge), but the crash was loud: the dead are coming. Take what you can carry and go.`, "danger");
  const text = `Three years after the fall of Calder. The relief flight to the allied group across the state line was shot down ${where}: you are the only one who walked away. The radio took the hit and is dead until it is repaired (a soldering iron, electronics, parts and scrap). The wreck holds the flight's supplies but the crash was loud and the dead are on their way: take what you can carry and go. ${unit}'s base is on the far side of the state, ${g.distance(tile, C.homeTile)} tiles to the ${direction(state, tile, C.homeTile)} (marked on the map). No base, no vehicle: survive, and build up a group of your own if you must.`;
  addCard(state, introCard("Crashlanding", text, "The team waits for orders: click it on the map, or open the Teams tab. The clock is stopped until you press Space."));
  startChronicle(state);
  return p;
}

// The fixed kit (crashmode.js CRASH_KIT): put on after any crew edit, so the new-run screen never changes it.
/** @param {any} state @param {any} s */
export function crashKit(state, s) {
  ensureInv(s);
  for (const k of ["weapon", "sidearm", "tool", "head", "armor", "rig", "backpack", "melee", "slung"]) if (k in s.gear) s.gear[k] = null;
  s.pockets = s.pockets.map(() => null);
  const w = (key, i) => newItem(key, 1, hash01(state.seed, "crashkit", key, i)); // part-worn as a soldier's issue is, on hashed dice
  s.gear.weapon = w("m4", 0);
  s.gear.sidearm = w("pistol", 1);
  s.gear.rig = newItem("chestrig");
  s.gear.armor = newItem("plate"); // the plate carrier keeps its ceramic plates (inventory.js newItem, not startKit)
  s.gear.head = w("milhelmet", 2);
  s.gear.tool = newItem("traumakit");
  ensureInv(s);
  for (let i = 0; i < CRASH.STANAG_MAGS; i++) stow(s, newItem("mag_stanag_30"));
  for (let i = 0; i < CRASH.GLOCK_MAGS; i++) stow(s, newItem("mag_glock_15"));
  stow(s, newItem("tourniquet"));
  stow(s, newItem("milradio_broken")); // a pocket (no radio pouch on a chest rig): crafting.js partyItems finds it there
  s.crashKit = true;
}

// The heli wreck as crashes.js keeps a found wreck: the record, the site on the tile, the race.
/** @param {any} state @param {number} tile */
function crashWreck(state, tile) {
  const g = state.grid, list = crashes(state), n = state.crashSeq || 0;
  const t = state.tiles[tile];
  const town = nearestTown(state, tile);
  const life = CRASH_EV.lifeMin + Math.floor(roll(state, "life") * (CRASH_EV.lifeMax - CRASH_EV.lifeMin + 1));
  state.crashSeq = n + 1;
  const c = {
    id: n + 1, kind: "heli", tile, center: tile, radius: 0, radius0: 0, seenHour: state.hour, expires: state.hour + life * 24, found: true, foundHour: state.hour, foundBy: null,
    witness: "You", from: "team", cleared: [], looks: 0, race: /** @type {any[]} */ ([]), stripped: 0, gone: false, prevLoot: t.loot ?? 0, lured: 0, crashStart: true,
    name: `${CRASH_KINDS.heli.name} wreck${town ? ` near ${town.loc.name}` : ""}`,
  };
  list.push(c);
  placeSite(state, c);
  t.loot = CRASH.WRECK_LOOT; // the relief flight's supplies: well above a wreck's usual
  state.knowledge[tile] = snapshot(state, tile);
  // The groups within reach saw it come down: most send a salvage party (crashes.js crashesHour sends them).
  state.factions.forEach((f, i) => {
    if (!f.alive || !f.bases.length) return;
    const d = Math.min(...f.bases.map((b) => g.distance(b, tile)));
    if (d > CRASH_EV.raceRange || roll(state, "race", i) >= 0.6) return;
    c.race.push({ fid: f.id, at: state.hour + CRASH_EV.raceMin + Math.floor(roll(state, "rat", i) * (CRASH_EV.raceMax - CRASH_EV.raceMin + 1)), sent: false });
  });
  state.stats.crashes = (state.stats.crashes || 0) + 1;
  return c;
}

// The base's map marker (markers.js MARKER_TYPES.crashhome): where to go, then what became of it.
/** @param {any} state */
function homeMarker(state) {
  const C = state.crash, unit = crashHomeName(state);
  const label = C.stage === "trail" || C.stage === "found" ? `${unit}: fell back to ${C.region || "the hills"}` : C.hiveBorn ? `${unit}: overrun, a hive forming` : C.revealed ? `${unit}: silent, the gates breached` : `${unit}: your base`;
  return { key: "crashhome", type: "crashhome", tile: C.homeTile, hour: state.hour, label, info: { name: C.baseName, trail: C.trail || "" } };
}
/** @param {any} state */
function refreshMarker(state) {
  const i = state.markers.findIndex((m) => m.key === "crashhome");
  const m = homeMarker(state);
  if (i >= 0) state.markers[i] = m; else state.markers.push(m);
}

// Loot diminished (the user: "Loot spawns are starting to be diminished"): every tile's loot and every non-site POI's
// pool × CRASH.LOOT, after the hives (hives.js newHive clears POIs on hive tiles); the wreck keeps its own.
/** @param {any} state */
export function crashLootScale(state) {
  const C = state.crash;
  for (const t of state.tiles) {
    poisOf(t).forEach((p, i) => { if (!isSitePoi(t, i) && p.pool > 0) p.pool = p.pool * CRASH.LOOT; });
    if (t.id === C.tile || !(t.loot > 0)) continue;
    t.loot = t.loot * CRASH.LOOT;
  }
}

// ---------- the hour (world.js tickHour) ----------
/** @param {any} state */
export function crashHour(state) {
  if (!isCrashRun(state) || state.gameOver) return;
  const C = state.crash, g = state.grid;
  // The crash's noise: the hordes within reach come to the wreck for a while (crashes.js does this for a mid-game crash;
  // a fresh world has no hordes yet, so it is done here as they appear).
  if (state.hour < C.lureUntil) {
    for (const h of state.hordes) {
      if (h.lureUntil && state.hour < h.lureUntil) continue;
      if (g.distance(h.tile, C.tile) <= CRASH_EV.hordeRange) { h.target = C.tile; h.lureUntil = C.lureUntil; }
    }
  }
  const home = C.homeTile;
  if (home == null) return;
  const here = teamsOn(state, home);
  if (!C.revealed && here.length) crashReveal(state, here[0]);
  else if (C.revealed && !C.hiveBorn && !here.length && C.stage === "base") crashHiveBorn(state);
  if (C.nextTile != null && (C.stage === "trail" || C.stage === "found")) {
    const at = teamsOn(state, C.nextTile), ids = at.map((p) => p.id);
    const fresh = at.find((p) => !(C.bunkerTeams || []).includes(p.id)); // a team that was not on the tile last hour: an arrival
    if (C.stage === "trail" && at.length) crashBunkerFound(state, at[0]);
    else if (C.stage === "found" && fresh && !state.cards.some((c) => c.crashReunited)) addCard(state, reunitedCard(state, fresh)); // "Not yet": the choice comes again on every arrival
    C.bunkerTeams = ids;
  }
}

// The reveal (the user: "when you make it back to base the base was taken over by a hive ... There are some supplies
// you can scavange from the base but it will have harder zombies").
/** @param {any} state @param {any} p */
export function crashReveal(state, p) {
  const C = state.crash, unit = crashHomeName(state), t = state.tiles[C.homeTile];
  C.revealed = state.hour;
  t.loot = Math.max(t.loot || 0, CRASH.HOME_LOOT);
  t.infection = Math.max(t.infection || 0, CRASH.HOME_INFECTION);
  if (t.infBase != null) t.infBase = Math.max(t.infBase, CRASH.HOME_INFECTION);
  addTileHeat(state, C.homeTile, CRASH.HOME_HEAT);
  refreshMarker(state);
  if (p && p.seen) p.seen.set(C.homeTile, snapshot(state, C.homeTile));
  state.knowledge[C.homeTile] = snapshot(state, C.homeTile);
  const text = `${C.baseName} is silent. The gates are breached and nobody answers at the wire. Inside, the dead wear Guard uniform, and in the motor pool something is growing out of the ground: a hive is starting to form here. ${unit} is gone. The stores still hold supplies, but the dead here are harder than the road's: take what you can and go. After that it is on you to keep surviving.`;
  log(state, `☠ ${unit}'s base at ${tileLabel(state, C.homeTile)} has fallen: the dead in Guard uniform hold it and a hive is forming in the motor pool. Some supplies are left in the stores (Scavenge: the dead here are harder).`, "danger");
  chronicleNote(state, `${unit}'s base found overrun: a hive forming where the unit was.`, "danger", C.homeTile, true);
  addCard(state, { ...introCard("The base has fallen", text, "Scavenge the base for what is left, then leave before the hive takes root."), where: tileLabel(state, C.homeTile), crashReveal: true });
}

// Once your teams have left (the user: "once you leave change the military base sprite on the world map to a hive
// infested one"): a young hive is born on the tile (hives.js newHive: small, its own infection and hordes from then
// on). The site stays (loc.look "hivebase": the infested Guard base on the map; raiding the tile is the hive's business
// now: the Destroy hive mission and the crawl, hivecrawl.js, whose hoard is the base's stores).
/** @param {any} state */
export function crashHiveBorn(state) {
  const C = state.crash, t = state.tiles[C.homeTile], unit = crashHomeName(state);
  ensureHives(state);
  const hive = newHive(state, C.homeTile, HIVE.START_RES);
  hive.crashBase = true;
  hive.name = `the hive at ${C.baseName}`;
  state.hives.push(hive);
  C.hiveBorn = state.hour;
  C.hiveHidden = false;
  if (t.loc) { t.loc.look = "hivebase"; t.loc.name = `${C.baseName} (overrun)`; }
  t.hiveBase = true;
  refreshMarker(state);
  state.knowledge[C.homeTile] = snapshot(state, C.homeTile);
  log(state, `The hive at ${C.baseName} has taken root: ${unit}'s base is a hive now. Its hordes will come as any hive's do; destroying it is the way to the stores.`, "danger");
  chronicleNote(state, `A hive rose in ${unit}'s base.`, "world", C.homeTile, true);
}

// The hive dies (hives.js destroyHive, whoever killed it): the message in the wreckage (the user: "Find a message in
// the wreckage after defeating the hive of people fleeing to another location"), a general region only, and the
// bunker made on its tile as a secret site (discovery.js: known once your people have intel on the tile).
/** @param {any} state @param {any} hive */
export function crashHiveDied(state, hive) {
  if (!isCrashRun(state) || !hive || !hive.crashBase) return;
  const C = state.crash;
  if (C.stage !== "base") return;
  const unit = crashHomeName(state), t = state.tiles[C.homeTile];
  C.stage = "trail";
  C.hiveDied = state.hour;
  if (t.loc) { delete t.loc.look; t.loc.name = `${C.baseName} (ruin)`; }
  t.hiveBase = false;
  t.hiveRuin = true;
  const nt = C.nextTile != null ? state.tiles[C.nextTile] : null;
  if (nt) {
    const kind = nt.terrain === "mountain" ? "the mountains" : "the high country";
    const town = nearestTown(state, nt.id);
    C.region = `${kind} to the ${direction(state, C.homeTile, nt.id)}${town ? `, somewhere ${direction(state, town.id, nt.id)} of ${town.loc.name}` : ""}`;
    nt.loc = { type: "bunker_mil", name: C.nextName, zone: "special" };
    nt.loot = CRASH.BUNKER_LOOT;
    nt.pois = generatePois(state, nt); // pois.js: the site's points of interest, as a site made mid-game gets them
    state.knowledge[nt.id] = null; // nothing known of the tile: the secret site is found by standing on it or a look (discovery.js)
    makeRemnant(state, nt.id); // the unit's remnant holds it (unknown until found)
  } else C.region = "the hills";
  C.trail = `A last entry in the command post's log, under the wreckage: "${unit} falling back with everyone who can walk. Rally at the old bunker in ${C.region}. Leave word for the flight." No name, no distance: only ${C.region}.`;
  refreshMarker(state);
  log(state, `📜 In the wreckage of ${C.baseName}: ${C.trail}`, "good");
  chronicleNote(state, `A message in the ruins of ${unit}'s base: they fell back to ${C.region}.`, "good", C.homeTile, true);
  addCard(state, { ...introCard("A message in the wreckage", `${C.trail} Finding the place is yours to do: nothing marks it on the map.`, "The region is kept on the base's marker tooltip."), where: tileLabel(state, C.homeTile), crashTrail: true });
}

// Winning pays (the user: "Fighting the hive and winning provides good loot"): the base's stores as the hive's hoard,
// once (hivecrawl.js hiveHoard adds it to the hoard a team or a group takes). { gear, supplies }.
/** @param {any} state @param {any} hive */
export function crashBaseHaul(state, hive) {
  if (!isCrashRun(state) || !hive || !hive.crashBase || state.crash.hiveLooted) return null;
  const C = state.crash, H = CRASH.HAUL, unit = crashHomeName(state);
  C.hiveLooted = state.hour;
  const gear = [];
  let i = 0;
  const add = (key) => { if (GEAR[key]) gear.push(lootItem(key, "soldier", [state.seed, "crashhaul", i++])); };
  const guns = ["m4", "ar", "carbine", "dmr", "pistol", "lmg"], armour = ["plate", "milhelmet", "vest", "highcut", "ceramicplate"], rare = ["nvg", "thermal", "milradio", "traumakit", "binoculars", "commset"];
  for (let k = 0; k < H.guns; k++) add(guns[Math.floor(roll(state, "haulgun", k) * guns.length) % guns.length]);
  for (let k = 0; k < H.armour; k++) add(armour[Math.floor(roll(state, "haularm", k) * armour.length) % armour.length]);
  for (let k = 0; k < H.rare; k++) add(rare[Math.floor(roll(state, "haulrare", k) * rare.length) % rare.length]);
  /** @type {Record<string, number>} */
  const supplies = { ammo: H.rounds, meds: H.meds, water: H.water, fuel: H.fuel, electronics: H.electronics, parts: H.parts, scrap: H.scrap, f_mre: Math.round(qtyOf("f_mre", H.food)) };
  sortFind(supplies, "military", state.seed, "crashhaul"); // ammo.js: the rounds by the Army's calibres
  log(state, `The stores of ${C.baseName} are the prize: ${unit}'s rounds, rifles, armour, rations, meds and fuel, what the hive did not foul.`, "good");
  chronicleNote(state, `${unit}'s stores taken back from the hive.`, "good", C.homeTile, true);
  return { gear, supplies };
}

// The unit's remnant (the user, 2026-10-24): a military AI group at the bunker, in the game's own shape (factions.js
// makeGang: ADR 0001, a group like any other), REMNANT.POP people with soldiers' kit (members.js ensureMembers from its
// arsenal), the cache as its stores; unknown (no knowledge, no marker) and sealed off until found: it does not expand
// or grow (the Hardcore military's hcNoExpand / hcNoGrow), raids nobody (goodwill 0, the military's raid 0, a long
// cooldown) and trades with nobody who does not know it. The dead can still raid it as any base.
const REMNANT = { POP: [6, 10], GOODWILL: 80 };
/** @param {any} state @param {number} tile */
function makeRemnant(state, tile) {
  const C = state.crash, K = CRASH.CACHE, unit = crashHomeName(state);
  const pop = REMNANT.POP[0] + Math.floor(roll(state, "remnant") * (REMNANT.POP[1] - REMNANT.POP[0] + 1));
  const f = makeGang(state, tile, { type: "military", name: `${unit} remnant`, pop, known: false, stock: { food: K.food, water: K.water, meds: K.meds, fuel: K.fuel, parts: K.parts, electronics: K.electronics, ammo: K.rounds } });
  f.goodwill = 0;
  f.crashRemnant = true;
  f.hcNoExpand = true; // factions.js: no new bases
  f.hcNoGrow = true; // factions.js, splinters.js, groupflight.js, blocs.js: no growth, no splinters, no flight, no bloc
  f.raidCooldown = 9999;
  f.lastDiplomacy = day(state);
  ensureMembers(state, f); // their people now, so a team finds them in the flesh
  C.remnantFid = f.id;
  return f;
}
/** The remnant's group, while it stands. @param {any} state */
export const crashRemnant = (state) => (isCrashRun(state) && state.crash.remnantFid != null ? factionById(state, state.crash.remnantFid) || null : null);

// The bunker's own marker (type crashhome too): where the remnant is and what was decided.
/** @param {any} state */
function refreshBunkerMarker(state) {
  const C = state.crash, unit = crashHomeName(state);
  const label = C.stage === "command" ? `${unit}: the bunker is yours` : C.stage === "joined" ? `${unit}: reunited` : `${unit} remnant: the bunker (join them or take command: the choice is open when a team of yours is there)`;
  const m = { key: "crashbunker", type: "crashhome", tile: C.nextTile, hour: state.hour, label, info: { name: C.nextName, trail: C.trail || "" } };
  const i = state.markers.findIndex((x) => x.key === "crashbunker");
  if (i >= 0) state.markers[i] = m; else state.markers.push(m);
}

// The bunker found (a team of yours standing on it): the remnant is known and allied, and the "Reunited" card asks.
/** @param {any} state @param {any} p */
export function crashBunkerFound(state, p) {
  const C = state.crash, unit = crashHomeName(state), tile = C.nextTile;
  C.stage = "found";
  C.found = state.hour;
  const f = crashAlly(state);
  if (p && p.seen) p.seen.set(tile, snapshot(state, tile));
  state.knowledge[tile] = snapshot(state, tile);
  log(state, `🏔 ${tileLabel(state, tile)}: ${C.nextName} found, and ${unit} is in it: ${f ? `${f.pop} of them, dug in behind a steel door` : "what is left of them"}. Join them, take command of the bunker, or go on alone: the choice is open whenever a team of yours is there.`, "good");
  chronicleNote(state, `${C.nextName} found: ${unit}'s remnant holds it.`, "good", tile, true);
  addCard(state, reunitedCard(state, p));
}
// "Not yet", and the ground of the other two: the remnant known, in the Allied band (factions.js attitude), marked.
/** @param {any} state */
export function crashAlly(state) {
  const f = crashRemnant(state);
  if (f) {
    f.known = true;
    if (f.goodwill < REMNANT.GOODWILL) changeGoodwill(state, f, REMNANT.GOODWILL - f.goodwill, "you made it back to your unit", true);
  }
  refreshBunkerMarker(state);
  return f;
}
// The card (the user, 2026-10-24): join them and end the run, take command of the bunker, or not yet.
/** @param {any} state @param {any} p */
export function reunitedCard(state, p) {
  const C = state.crash, unit = crashHomeName(state), f = crashRemnant(state), tile = C.nextTile;
  const n = f ? f.pop : 0;
  const text = `Behind a rockfall, a steel door, and a sentry who knows the challenge: ${C.nextName}. ${unit} is here: ${n ? `${n} of them` : "what is left of them"}, cots, a cold stove, a wall of supply crates. The CO comes down the passage: "We lost the base to the dead. We held what we could and fell back here. You are the first word from the flight. You can stay: there is a bunk and a rifle with your name on it. Or you can take this place over and we will follow your orders. Or go on with what you are building out there and come back when you are ready."`;
  return {
    title: "Reunited", partyId: p ? p.id : null, where: tileLabel(state, tile), crashReunited: true,
    text,
    choices: [
      { label: "Join them: the run ends", hint: "You made it back: the run ends as a victory (Keep playing leaves the remnant an ally in your coalition and goes on).", ai: () => 0, resolve: (/** @type {any} */ st) => crashJoin(st, p) },
      { label: "Take command of the bunker", hint: "The bunker becomes your base (your hub if you have none), their people join yours with their kit, and the group is yours to run.", ai: () => 3, resolve: (/** @type {any} */ st) => crashCommand(st, p) },
      { label: "Not yet", hint: "They hold the bunker as an allied group; the choice comes again whenever a team of yours arrives here.", ai: () => 1, resolve: (/** @type {any} */ st) => { crashAlly(st); return `${unit} holds the bunker as your ally. Come back when you are ready: the choice is open on every arrival.`; } },
    ],
  };
}
// Join them: the run ends as a victory in the game's own shape (world.js checkGameOver's flags; the end screen's Keep
// playing: main.js keepplaying sets victoryKept and clears gameOver). Kept playing, the remnant is an ally in the coalition.
/** @param {any} state @param {any} p */
export function crashJoin(state, p) {
  const C = state.crash, unit = crashHomeName(state);
  const f = crashAlly(state);
  if (f) admitToAlliance(state, f, "you made it back to your unit", true);
  C.stage = "joined";
  C.joined = state.hour;
  C.joinedBy = p ? p.id : null;
  refreshBunkerMarker(state);
  state.victory = true;
  state.victoryReason = "reunited";
  state.gameOver = true;
  // Keep the opening words: the end screen (ui/ui.js gameOverWords) says them too.
  log(state, `You made it back. ${unit} takes you in at ${C.nextName}: ${alive(state).length} of you made it to day ${day(state)}, three years and more after Calder fell.`, "good");
  chronicleNote(state, `Reunited: you made it back to ${unit}.`, "good", C.nextTile, true);
  achievementsEnd(state); // achievements.js: the bunker's and the ending's, before the end screen reads them
  return `You made it back. ${unit} takes you in.`;
}
// Take command: their people join your survivors with their kit (members.js removeMember: what they carry goes with
// them), then the bunker changes hands as a ceded base (conquest.js captureBase: your hub when you have none, their
// buildings, their motor pool; no fallout) with all of its stores (captureBase keeps half: the rest is added), the team
// moves in (parties.js settleInto) and the group is dissolved (captureBase: its last base gone, factions.js collapseFaction).
/** @param {any} state @param {any} p */
export function crashCommand(state, p) {
  const C = state.crash, unit = crashHomeName(state), tile = C.nextTile;
  const f = crashRemnant(state);
  if (!f || !f.alive || !f.bases.includes(tile)) return "The remnant is not at the bunker any more.";
  const people = [...membersOf(f)];
  // Their kit: a group keeps it in its arsenal and hands it out as its people go out (arsenal.js issueKit); they take it
  // with them now (removeMember's forgetCarried strikes what they carry off the group's books).
  const kits = issueKit(state, f, people.length, "home");
  people.forEach((s, j) => {
    const kit = kits[j];
    if (!kit) return;
    if (kit.weapon && !s.gear.weapon) s.gear.weapon = kit.weapon;
    for (const [slot, it] of Object.entries(kit.armour || {})) if (it && slot in s.gear && !s.gear[slot]) s.gear[slot] = it;
  });
  for (const s of people) {
    removeMember(state, f, s, "gone"); // their kit stays on them and leaves the group's books with them
    delete s.fid;
    s.formerId = s.id;
    s.id = newId();
    s.role = "guard";
    s.station = null;
    s.alive = true;
    state.survivors.push(s);
  }
  f.pop = 0;
  /** @type {Record<string, number>} */
  const all = { ...(f.stock || {}) };
  const team = p && state.parties.includes(p) ? p : null;
  const text = captureBase(state, f, tile, team, { ceded: true, people: 0 });
  const base = state.bases.find((b) => b.tile === tile);
  if (base) {
    arsenalShareTo(state, f, 1, base.armory); // the rest of their spare kit (captureBase took half) into the bunker's armory
    for (const [k, q] of Object.entries(all)) { const n = Math.max(0, Number(q) || 0); const rest = n - Math.floor(n * 0.5); if (rest > 0) base.stock[k] = (base.stock[k] || 0) + rest; } // the half captureBase left as spoiled (conquest.js CONQUEST.STOCK_SHARE): theirs is yours whole
    for (const s of people) s.location = { kind: "base", baseId: base.id };
    if (team && state.parties.includes(team)) settleInto(state, team, base);
    assignStations(state, base);
    state.knowledge[tile] = snapshot(state, tile);
  }
  C.stage = "command";
  C.command = state.hour;
  C.remnantJoined = people.length;
  refreshBunkerMarker(state);
  recomputeOwnership(state);
  log(state, `You took command of ${C.nextName}: ${people.length} of ${unit} ${people.length === 1 ? "is" : "are"} yours now, with their kit${base ? `, and the bunker is ${base.type === "hub" ? "your hub" : "an outpost of yours"}` : ""}. ${unit}'s remnant is your group.`, "good");
  chronicleNote(state, `You took command of ${C.nextName}: ${unit}'s remnant is yours.`, "good", tile, true);
  addCard(state, { ...introCard("Command of the bunker", `${text} ${people.length} of ${unit} fall in under your orders, with their rifles and their kit; the stores are yours whole. The state is still out there: that is on you to keep surviving.`, "The bunker is a base of yours now: Manage it as any other."), where: tileLabel(state, tile), crashCommand: true });
  checkGameOver(state);
  return text;
}

// ---------- the radio (crafting.js) ----------
// The military radio repaired (crafting.js CRAFTS.milradio, at a bench or in the field): dead air on the unit's
// frequency, once.
/** @param {any} state @param {string} recipeKey */
export function noteRadioFixed(state, recipeKey) {
  if (recipeKey !== "milradio" || !isCrashRun(state)) return;
  const C = state.crash;
  if (!C.radioFixed) C.radioFixed = state.hour;
  if (C.deadAir) return;
  C.deadAir = state.hour;
  const unit = crashHomeName(state);
  log(state, `📻 The military radio works again. ${unit}'s frequency answers with dead air: nobody is transmitting from the base.`, "warn");
  chronicleNote(state, `The radio repaired: ${unit}'s frequency is dead air.`, "world", C.homeTile ?? -1, false);
}

// ---------- cars (foundcars.js, citycrawl.js) ----------
/** A car's engine beyond repair by the crash run's rule (the user: "Most cars will not be repairable"). r: a 0–1 die. @param {any} state @param {number} r */
export const crashCarDead = (state, r) => isCrashRun(state) && r >= CRASH.CAR_FIX;
/** Fuel siphoned in a crash run (the user: "limited fuel can be siphoned"). @param {any} state @param {number} n */
export const crashSiphon = (state, n) => (isCrashRun(state) ? Math.floor(n * CRASH.SIPHON) : n);
