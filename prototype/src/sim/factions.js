// AI groups: creation, daily behaviour (growth, expansion, raids, convoys, attitude drift) and attacks.
//
// Raids on you (launchRaid, resolveRaidOnPlayer; numbers in RAIDS):
// - Who: a hostile group (goodwill −40 or below). Aggressive types roll their raid chance every day once the
//   cooldown (8–16 days) is over: raiders 10.5%, zealots 7.5%, expansionists 6% (data.js raid × 1.5). A peaceful
//   group you provoked into hostility raids too, rarely: military 4.5%, fortress 3%, traders and communes 1.5%;
//   left alone (no base of yours within 5 tiles, no new offence for 30 days) it cools off by 0.1 goodwill a day.
// - Reach: 30 tiles from the group's nearest base (they march from there), so outposts they push toward you bring
//   them closer. Which of your bases, or another group's base (within 14 tiles), they pick is weighted: your base
//   counts 2.5 × greed (its stock value / 1500, 0.4–3) × land (+20% for each outpost you hold) × grudge (+50% for
//   each raid you beat off or fight they lost against you, at most 4; it fades 1% a day) × their size (strength /
//   35, 0.6–2), ÷ (1 + tiles / 12). Big groups come for rich, sprawling holdouts that have hurt them.
// - Size: their scouts size the raid to the base's defence with everyone at a post ("Prepare defenses"): 0.6–1.0 ×
//   that, × their escalation, never more than the group's whole strength (and at least 4). Escalation: every
//   raid you drive off (or beat in person) makes their next one 25% bigger, up to 2×; a raid that gets in resets it.
// - The siege: 8 hours at the walls, but a strong defence drives them off sooner: each hour counts as defence /
//   strength / 1.2 hours (at least 1, at most 4), so at 2.4× they are gone after about 4 hours. Then the numbers
//   decide: defence ≥ 1.2 × strength drives them off (they lose 1–3 people, someone may be hurt), ≥ 0.8 is a
//   break-in (20% of the stock taken, 10% with a storehouse, two people hurt), below that the base is overrun (50% /
//   25%, three hurt, an outpost lost). What they take goes into their stores, and a raid that got in wins them
//   1–2 recruits.
// - Damage: the raid smashes buildings by its strength and the hours of the siege (breakdowns.js raidDamage):
//   scratches when they are driven off fast, a repair bill after a long siege, a break-in or an overrun. A card
//   says what was taken, who was hurt and what the repairs cost.
// - Tribute (the warning card: 30% of the food and 30 ammo) turns them back and buys +6 goodwill, but from an
//   aggressive group it fades again at 0.5 a day: they do not stay bought.
// Growth (factionsDaily, collapseFaction, newGangs):
// - Aggressive groups recruit drifters: when the usual growth roll does not add someone, 12% + 2% a base a day
//   (with food for two days a head, below 45 people).
// - Aggressive groups expand more (their expand rate + 2% × people / 18 a day) up to 2 + people / 10 bases (at most
//   6; other types 4), within 7 tiles of a base they hold, preferring rich sites and sites toward you (never within
//   3 tiles of your bases).
// - A group that breaks another (the raid or war raid that finishes it) takes over its bases (up to its cap), 2–4 of
//   its survivors and half its stores. A group broken by hordes or by you is picked over by the strongest
//   aggressive group within 15 tiles (50%). A winning raid between groups decides the base's fate (baseFate): raze
//   it (razeChance, aggressive types only), keep it (keepChance) or loot it and go; they carry home half of the 40%
//   of the stores the defenders lose. A group is broken at GROUP_BREAK (3) people.
// - When fewer than 2 aggressive groups are left hostile to you (from day 60), a new gang from beyond the border
//   settles 12–30 tiles from your hub (2% a day): 12–18 people, hostile, at any time of the run (makeGang; raider
//   bands from outside that settle use it too, visitors.js settleBands).
import { FACTION_TYPES, FACTION_COLORS, GEAR } from "./data.js";
import {
  newId, log, addCard, day, hub, atBase, combatPower, hurt, playerStrength,
  factionById, baseById, survivorById, makeSurvivor, RADIO_RANGE, supplyValue, armedFactor, spendShots, arrowsBack,
} from "./world.js";
import { spawnAiParty, sendHelpSquad, removeParty, awaitOrders, tileLabel } from "./parties.js";
import { baseWalls, count } from "./buildings.js";
import { radioBasesInRange, removeBase } from "./world.js";
import { playerTile } from "./hardcore-start.js";
import { defendInPerson, raidForce } from "./conflicts.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { resolveWarRaid, warRaidOnPlayer, raidWeight, raidSoured, reservedForYou } from "./diplomacy.js";
import { allianceRaidHelp } from "./alliance.js";
import { overwriteClaims } from "./claims.js"; // claims.js: a base founded takes the claims around it (agent A's hook)
import { aiScavDaily, FACTION_MAKE } from "./aiscav.js";
import { outsiderRaidOn } from "./visitors.js";
import { worldScale, stateSizeDef } from "./worldsize.js";
import { raidDamage, raidReportCard, RAID_DAMAGE } from "./breakdowns.js";
import { occupyPlayerBase, razePlayerBase, retreatFrom, nearestOtherBase, CONQUEST, ensureConquest } from "./conquest.js";
import { controlledLand, ALLIANCE, coalitionMask, isMember as isMemberOf } from "./alliance.js";
import { gangArms, recruitBonus, gangPopBonus, isLate, ERAS, raidPaceOpen, noteRaid, raidPrep, raidSizeRange } from "./eras.js";
import { raidTier } from "./defences.js";
import { SURPRISE } from "./watch.js"; // an unwatched night: the raiders get the first move
import { hcNoRaiders, hcGroupRaidsQuiet } from "./hardcore-groups.js";
import { raidSiegeKit, kitText } from "./siege.js";
import { freezeShare } from "./woodcutting.js";
import { ensureHives, hiveGuard, destroyHive, hivesLeftText } from "./hives.js";
import { markThreat } from "./hivetech.js";
import { reduceHorde } from "./hordes.js";
import { broodGrowth } from "./eras.js";
import { canRadioGroup } from "./radio.js";
import { keyWord } from "./water.js"; // "un-purified water" in texts
import { totalRounds } from "./rounds.js"; // rounds by calibre ("ammo": every round there)
import { payAmmo } from "./ammo.js";
import { freeOnCollapse } from "./groupjails.js"; // jailhouse: the people a collapsed group held walk home
import { groupWorksDaily, fieldsFactor, growthFactor, workshopFactor, storeFactor, groupBaseDefence } from "./groupworks.js"; // barestart: what the groups build
import { factionVehicles, groupTurretPower, raidTurretPower, loseRaidHumvee, humveeLeftText } from "./vehicles.js"; // a military group's motor pool: the Humvee's M2 in their raids, lost when one fails
import { ensureArsenal, groupStrength, kitFactor, arsenalDaily, capSiegeKit, raidOnBase, wallPower, raidCount, clashKit, inheritArsenal } from "./arsenal.js"; // group arsenals: everyone fights with what their group holds
import { groupCareDaily, groupCareWorld, tickGroup, prio, weightOf, canExpand, expanded, raidAnswer, fitPeople } from "./groupcare.js"; // AI parity: healing, repairs, hunger, desertion; the type profiles
import { groupWorldDaily, groupWorldWorld, intelDef, knownBase, fearsGroup, KNOW, abandonedAt, abandonedPull, occupyAbandoned, leaveGroupBase } from "./groupworld.js"; // AI parity: what they know, their vehicles, abandoned bases
import { raidPrisoners } from "./nonlethal.js"; // groups that take people alive: some of the beaten are taken, not killed
import { hash01 } from "./skills.js";
import { escortParty } from "./caravans.js"; // a convoy's guards (escorts.js)
import { noteGrievance, ceasefireWith, pwarRaidDone, pwarById, goalText } from "./playerwars.js"; // wars with you: what they hold against you, ceasefires, the score
import { sameBloc, blocOf, blocHelpFor, blocHelpAfter, jointRaid, jointAfter, blocPlayerHelp } from "./blocs.js"; // AI blocs: help, joint raids
import { flightDaily } from "./groupflight.js"; // groups leaving a base they cannot hold against the dead
import { splinterDaily } from "./splinters.js"; // splinter bands

export const RAIDS = {
  REACH: 30, FACTION_REACH: 14, SIZE: [0.6, 1.0], CAP: 1.0, MIN: 4, ESCALATE: 0.25, ESC_MAX: 2,
  PLAYER_W: 2.5, GREED: 1500, LAND: 0.2, GRUDGE: 0.5, GRUDGE_MAX: 4, GRUDGE_FADE: 0.01, SIZE_REF: 35, DIST: 12,
  HOLD: 1.2, BREAK: 0.8, SIEGE_HOURS: 8, PACE: 1.2, PACE_MAX: 4, TRIBUTE_GW: 6, TRIBUTE_FADE: 0.5,
  // A peaceful type you made hostile raids at its type's groupcare.js GROUP_PRIORITIES provoked a day. A target's
  // weight when an aggressive group picks whom to raid: GROUP_PRIORITIES raidBait (BAIT for an unknown type).
  BAIT: 0.6,
  EXPAND_AGG: 0.02, EXPAND_RANGE: 7, KEEP_CLEAR: 3, BASES_AGG: 6, BASES: 4, HEIR_RANGE: 15, HEIR_CHANCE: 0.5,
  BRIDGE_PICK: 0.35, BRIDGE_PICK_AGG: 0.6, // a bridge's weight against a site when a group expands (a barricade over the river)
  TAKE_BASE_AGG: 0.8, MIN_AGG: 2, NEW_GANG_FROM: 60, NEW_GANG: 0.02, RECRUIT: 0.12, RECRUIT_BASE: 0.02, RECRUIT_UNTIL: 45, COOL_OFF: 0.1,
  // Keeping a base won in a raid (keepChance): by type (GROUP_PRIORITIES keep; KEEP for an unknown type), × nearness
  // to their own bases (1 within KEEP_NEAR tiles, falling to 0.4 at KEEP_FAR), × richness (0.8 + stock value / 2000, at most 1.4); none beyond maxBases. A base
  // of yours: the hub × KEEP_HUB. A clearly outmatched group (raid ≥ ABANDON × its defence) may give up a base
  // that is not its main one (ABANDON_CHANCE) and fall back to the others.
  KEEP: 0.5, KEEP_NEAR: 7, KEEP_FAR: 25, KEEP_HUB: 0.35, ABANDON: 1.6, ABANDON_CHANCE: 0.5,
  // Razing a base won in a raid (razeChance): only aggressive types, by type (GROUP_PRIORITIES raze), × (1 + 0.25 a
  // grudge point, at most 4), × 1–2 by distance (a base they could not hold is burned, KEEP_NEAR to KEEP_FAR tiles from their own bases).
  RAZE_GRUDGE: 0.25, RAZE_RUIN_LOOT: 0.25,
  RAZE_HUB: 0.4, RAZE_EMPTY: 0.5, // your hub, and a base with nobody in it (nothing to make an example of), burn less often
};
// The AI groups against the hives (groupHiveWar, every day per group): a group with a hive within RANGE tiles of one
// of its bases looks at it every EVERY days and sends a war party by type (GROUP_PRIORITIES hiveWar: zealots always, the
// military and a fortress often, expansionists sometimes, traders and communes rarely, raiders never), with at least
// MIN_POP people. The party is SHARE of the group (at least MIN fighters) at the group's arms (strength); it kills
// FIGHT of the hive's guard per point of its strength (× 0.7–1.3, ÷ the brood's growth over the years, eras.js),
// burns STORES of the hive's stores per kill, and burns the hive out when the guard left is SMALL or fewer. The group
// loses people to it: LOSS × the guard's size against the kills, at most LOSS_MAX of the party. A hive you fought
// within PLAYER_DAYS days (fires, Molotovs, a storm: hives.js notePlayerFight): +GOODWILL with the group, you are
// fighting the same enemy. You hear of it when the group is in radio reach (radio.js canRadioGroup) or the hive is
// in sight; a hive destroyed counts like any other (hives.js destroyHive: the hive victory, the records).
export const GROUP_HIVE = {
  RANGE: 12, EVERY: [20, 40], MIN_POP: 10,
  SHARE: 0.35, MIN: 3, FIGHT: 2.5, STORES: 0.3, SMALL: 20, LOSS: 0.1, LOSS_MAX: 0.3, GOODWILL: 3, PLAYER_DAYS: 30,
};
// With these a fortress of 30 (11 fighters at arms 1.2: strength 13) kills about 33 of a guard a party: a hive with a
// guard of 100 and no brood chamber is burned out in 3–4 parties (a season) if it cannot rebuild its guard; one in a
// cluster that rebuilds (a medium horde every time the guard falls under its minimum) holds out until the group has
// grown to 40–50 or your fires have cut the guard first (then +GOODWILL). tools/grouphivetest.js measures it.
// A group of GROUP_BREAK people or fewer is broken (collapseFaction): every floor that kept groups above 8 (war raids,
// peace when a side is worn down) lets them be ground down this far.
export const GROUP_BREAK = 3;
export const groupBroken = (f) => !!f && f.pop <= GROUP_BREAK;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Where each type settles: groupcare.js GROUP_PRIORITIES sites (PREFERRED_SITES[type] reads it, as before).
export const PREFERRED_SITES = new Proxy({}, { get: (_, t) => (typeof t === "string" ? weightOf({ type: t }, "sites", undefined) : undefined), has: (_, t) => weightOf({ type: t }, "sites", null) != null });

export function createFactions(state, count) {
  const rng = state.rng;
  const g = state.grid;
  const hubTile = hub(state) ? hub(state).tile : playerTile(state); // hardcore: no hub yet, the team on the road
  const types =["raider", rng.pick(["military", "fortress"]), rng.pick(["traders", "commune"])];
  const all = Object.keys(FACTION_TYPES);
  while (types.length < count) types.push(rng.pick(all));
  types.length = Math.min(types.length, Math.max(0, count)); // fewer than three (the new-run screen allows none)
  rng.shuffle(types);
  const usedNames = new Set();
  types.forEach((type, i) => {
    const def = FACTION_TYPES[type];
    // Groups start outside the cities, spread apart, and within reach of the hub (8–30 tiles on a Normal map; by
    // the square root of the area on the others, worldsize.js) when there is room.
    const sites = state.tiles.filter((t) => t.loc && t.loc.type !== "city" && t.loc.zone !== "urban" && g.distance(t.id, hubTile) >= 8 &&
      state.factions.every((f) => f.bases.every((b) => g.distance(b, t.id) >= 8)));
    if (!sites.length) return;
    // Large and Huge maps (worldsize.js nearGroups): only the first few start within raid reach of the hub; the
    // rest settle beyond it and come into reach as they expand.
    const nearCap = stateSizeDef(state).nearGroups;
    const far = nearCap != null && i >= nearCap ? sites.filter((t) => g.distance(t.id, hubTile) > RAIDS.REACH + 2) : [];
    const reach = sites.filter((t) => g.distance(t.id, hubTile) <= (nearCap != null && i < nearCap ? RAIDS.REACH : Math.round(30 * Math.sqrt(worldScale(state)))));
    const pool = far.length ? far : reach.length ? reach : sites;
    const pref = pool.filter((t) => PREFERRED_SITES[type].includes(t.loc.type));
    const site = rng.pick(pref.length ? pref : pool);
    let name = rng.pick(def.names);
    if (usedNames.has(name)) name = def.names.find((n) => !usedNames.has(n)) || ["II", "III", "IV", "V", "VI", "VII", "VIII"].map((n) => `${name} ${n}`).find((n) => !usedNames.has(n)) || `${name} ${usedNames.size}`;
    usedNames.add(name);
    const pop = rng.int(14, 28);
    state.factions.push({
      id: newId(), name, type, color: FACTION_COLORS[i % FACTION_COLORS.length],
      bases: [site.id], pop, alive: true, known: false,
      goodwill: def.goodwill + rng.int(-8, 8), lastDiplomacy: 0, pact: null,
      stock: { food: pop * 6, ammo: pop * 10 * def.arms, fuel: pop * 1, meds: pop, parts: 2, scrap: pop * 3, preserved: Math.round(pop * 0.5), jars: 0, wood: pop * GROUP_WOOD.start, arrows: pop * 2 }, // preserved / jars: storage.js; wood: woodcutting.js
      lootedGear: [], raidCooldown: rng.int(4, 10),
    });
    factionVehicles(state.factions[state.factions.length - 1]); // vehicles.js: a military group starts with an Army truck and a Humvee (M2 turret)
    ensureArsenal(state, state.factions[state.factions.length - 1]); // arsenal.js: its weapons, armour and explosives (hashed: the world's dice stay put)
  });
}

// f.gear: the eras' better arms of an aggressive group (eras.js gangArms, set every day: 1 in the early game).
// arsenal.js groupStrength: people × arms × what their arsenal is worth a head against their type's starting kit (1 on
// day 0), the eras' arms in it (eraArms). A group with no arsenal yet (read before its first day) counts as at the start.
export const strength = (f) => (f.arsenal ? groupStrength(f) : f.pop * FACTION_TYPES[f.type].arms * (f.gear || 1));
export const isAggressiveType = (f) => FACTION_TYPES[f.type].attitude === "Aggressive";

export function attitude(f) {
  if (f.goodwill <= -40) return "Hostile";
  if (f.goodwill < 20) return "Neutral";
  if (f.goodwill < 70) return "Friendly";
  return "Allied";
}

export function changeGoodwill(state, f, amount, reason) {
  const before = attitude(f);
  f.goodwill = Math.max(-100, Math.min(100, f.goodwill + amount));
  if (amount < 0 && reason && reason !== "the tribute is spent") f.lastProvoked = day(state); // a peaceful group cools off 30 days after the last offence
  const after = attitude(f);
  if (before !== after && f.known) log(state, `${f.name} is now ${after.toLowerCase()} toward you${reason ? ` (${reason})` : ""}.`, after === "Hostile" ? "danger" : "good");
  breakPactIfHostile(state, f);
  if (amount < 0 && state.diplo) noteGrievance(state, f, amount, reason); // playerwars.js: filed as a grievance (a casus belli)
}

// A pact does not survive open hostility: a hostile group tears it up (and can raid you again, launchRaid).
export function breakPactIfHostile(state, f) {
  if (!f.pact || attitude(f) !== "Hostile") return false;
  const kind = f.pact === "trade" ? "trade pact" : "non-aggression pact";
  f.pact = null;
  log(state, `${f.name} has torn up your ${kind}.`, "danger");
  // A trade route needs the pact: it pauses, and escorts waiting at home go back to the hub's roster. A convoy
  // already on the road finds the gates shut and comes home.
  for (const r of state.routes || []) {
    if (!r.active || r.factionId !== f.id) continue;
    r.active = false;
    r.paused = "pact";
    for (const id of r.escortIds || []) {
      const s = survivorById(state, id);
      if (s && s.alive && s.location.kind === "route" && hub(state)) s.location = { kind: "base", baseId: hub(state).id };
    }
    log(state, `The trade route to ${f.name} is paused: there is no pact any more.`, "danger");
  }
  return true;
}

// Name for the log: a group you have not met is not named.
const knownName = (f, unknown = "an unknown group") => (f.known ? f.name : unknown);

export function recomputeOwnership(state) {
  const g = state.grid;
  for (const t of state.tiles) t.owner = null;
  for (const f of state.factions) {
    if (!f.alive) continue;
    for (const b of f.bases) for (const id of g.within(b, 2)) {
      const t = state.tiles[id];
      if (t.owner == null || g.distance(id, b) === 0) t.owner = f.id;
    }
  }
  for (const b of state.bases) for (const id of g.within(b.tile, b.type === "hub" ? 2 : 1)) {
    const t = state.tiles[id];
    if (!state.factions.some((f) => f.bases.includes(id))) t.owner = "player";
  }
}

function nearestPlayerBaseDistance(state, f) {
  let best = Infinity;
  for (const b of state.bases) for (const fb of f.bases) best = Math.min(best, state.grid.distance(b.tile, fb));
  return best;
}
// The group's base nearest to a tile (where its raid on that tile marches from).
export function nearestOwnBase(state, f, tile) {
  let best = f.bases[0], bd = Infinity;
  for (const b of f.bases) { const d = state.grid.distance(b, tile); if (d < bd) { bd = d; best = b; } }
  return best;
}
// How many bases a group can hold: aggressive groups grow with their people (2 + people / 10, at most 6).
export const maxBases = (f) => (isAggressiveType(f) ? clamp(2 + Math.floor(f.pop / 10), 2, RAIDS.BASES_AGG) : RAIDS.BASES);
// The chance a group that won a raid keeps the base (instead of looting it and going home): its type, how far it is
// from its own bases, how rich the place is; never beyond what it can hold. value: the base's stock value.
export function keepChance(state, f, tile, value = 0) {
  if (!f || !f.alive || f.bases.length >= maxBases(f) || f.bases.includes(tile)) return 0;
  const g = state.grid;
  const d = f.bases.length ? Math.min(...f.bases.map((b) => g.distance(b, tile))) : 0;
  const near = d <= RAIDS.KEEP_NEAR ? 1 : clamp(1 - (0.6 * (d - RAIDS.KEEP_NEAR)) / (RAIDS.KEEP_FAR - RAIDS.KEEP_NEAR), 0.4, 1);
  const rich = clamp(0.8 + value / 2000, 0.8, 1.4);
  return clamp(weightOf(f, "keep", RAIDS.KEEP) * near * rich, 0, 0.95);
}

// How likely a winning raid burns the base to the ground (aggressive types only): GROUP_PRIORITIES raze, see RAIDS.
export function razeChance(state, f, tile) {
  const raze = weightOf(f, "raze", 0);
  if (!f || !f.alive || !raze) return 0;
  const g = state.grid;
  const d = f.bases.length ? Math.min(...f.bases.filter((b) => b !== tile).map((b) => g.distance(b, tile)).concat([99])) : 99;
  const far = d <= RAIDS.KEEP_NEAR ? 1 : clamp(1 + (d - RAIDS.KEEP_NEAR) / (RAIDS.KEEP_FAR - RAIDS.KEEP_NEAR), 1, 2);
  return clamp(raze * (1 + RAIDS.RAZE_GRUDGE * Math.min(4, f.grudge || 0)) * far, 0, 0.8);
}
// What a group does with a base it won: "raze" (burn it down), "keep" (hold it) or "leave" (loot it and go home).
// keepMult scales the wish to keep it (the hub, a break-in).
export function baseFate(state, f, tile, value = 0, keepMult = 1, razeMult = 1) {
  const rng = state.rng;
  if (rng.chance(razeChance(state, f, tile) * razeMult)) return "raze";
  return rng.chance(keepChance(state, f, tile, value) * keepMult) ? "keep" : "leave";
}
// A group's base burned down by another group: nobody holds the tile, it is a ruin (a little to scavenge, cheap to build on).
export function razeGroupBase(state, target, tile, attacker) {
  const t = state.tiles[tile];
  t.ruin = { name: tileLabel(state, tile), day: day(state), by: attacker ? attacker.name : "raiders", from: target ? target.name : "" };
  t.loot = Math.max(t.loot || 0, RAIDS.RAZE_RUIN_LOOT);
  state.stats.razedGroups = (state.stats.razedGroups || 0) + 1;
  if ((attacker && attacker.known) || (target && target.known) || state.live.has(tile)) log(state, `${attacker ? knownName(attacker, "Raiders") : "Raiders"} burned ${target ? `${knownName(target, "a group")}'s base at ` : ""}${tileLabel(state, tile)} to the ground.`, "danger");
}

// A group's woodpile a head: at the start, the most it keeps, cut a day, burned on a freezing day (the share of freezing
// days by the time of year, woodcutting.js FREEZE_SHARE).
export const GROUP_WOOD = { start: 120, cap: 240, cut: 3.6, burn: 9 }; // firewood of 0.1 kg (30 times the old 3 kg units)
export function factionsDaily(state) {
  const rng = state.rng;
  const today = day(state);
  const governs = state.factions.some((f) => f.alive && !isAggressiveType(f)) && controlledLand(state).pct > ALLIANCE.LAND_NEEDED;
  for (const f of state.factions) {
    if (!f.alive) continue;
    const def = FACTION_TYPES[f.type];
    tickGroup(f); // groupcare.js: the group's own day count (its daily rolls)
    // Eras (eras.js): from year 3 the aggressive groups arm themselves better every year.
    if (isAggressiveType(f)) f.gear = gangArms(state);
    // Food and growth.
    // Their fields and workshops: food a little short of what they eat for the less farming types (the rest from
    // the sites they strip, aiscav.js), and FACTION_MAKE of the old ammo, scrap, fuel and meds made from nothing.
    const off = !!state.aiScavOff; // test switch (tools/depletetest.js): the old economy, no scavenging groups
    // groupworks.js: a group short of wells and fields gets a little less from the land, and one sleeping rough grows
    // slower (CROWDED_GROWTH; both 1 once it has built them; old saves are built up).
    f.stock.food += f.pop * ((off ? 0.88 : 0.86) + 0.25 * def.food) * fieldsFactor(state, f) - f.pop;
    // Growth: newcomers by the type's pull (groupcare.js GROUP_PRIORITIES recruit: 0.7 + 0.3 x it, so about as before);
    // wanderers and deserters join through their own systems (wanderers.js, groupcare.js).
    if (f.stock.food > f.pop * 4 && f.pop < 50 && !f.hcNoGrow && rng.chance(0.25 * growthFactor(state, f) * (0.7 + 0.3 * prio(f, "recruit")))) f.pop += 1; // hcNoGrow: hardcore's besieged military
    // Drifters, deserters and the desperate join the strong: an aggressive group with food on hand recruits.
    else if (isAggressiveType(f) && f.pop < RAIDS.RECRUIT_UNTIL + recruitBonus(state) && f.stock.food >= f.pop * 2 && rng.chance(RAIDS.RECRUIT + RAIDS.RECRUIT_BASE * f.bases.length)) f.pop += 1;
    if (f.stock.food < 0) {
      f.stock.food = 0;
      if (rng.chance(0.35)) f.pop -= 1;
    }
    // groupworks.js: without a workshop they make less, without a storehouse they keep less (1 once built).
    const mk = (off ? 1 : FACTION_MAKE) * workshopFactor(state, f), cap = storeFactor(state, f);
    f.stock.ammo = Math.min(f.pop * 30 * cap, f.stock.ammo + f.pop * 0.3 * def.arms * mk);
    f.stock.scrap = Math.min(f.pop * 10 * cap, f.stock.scrap + f.pop * 0.2 * mk);
    f.stock.fuel = Math.min(f.pop * 3 * cap, f.stock.fuel + f.pop * 0.04 * mk); // fuel is scarce (economy rework)
    f.stock.meds = Math.min(f.pop * 3 * cap, f.stock.meds + f.pop * 0.04 * mk);
    groupWorksDaily(state, f); // groupworks.js: the base starts bare; water, fields, quarters, walls, by need
    arsenalDaily(state, f); // arsenal.js: newcomers' weapons, makeshift weapons and explosives from their scrap
    groupCareDaily(state, f); // groupcare.js: the wounded heal (meds, medics), repairs at a workshop, food bought when short, desertion
    groupWorldDaily(state, f); // groupworld.js: scouting (and spies at your walls), vehicles taken, stolen, sold, fitted out
    // Firewood (woodcutting.js): they cut a little every day and burn it on freezing days, so their woodpile (and its
    // price, trade.js) runs low by the end of a winter and fills again by the autumn.
    f.stock.wood = Math.max(0, Math.min(f.pop * GROUP_WOOD.cap, (f.stock.wood ?? f.pop * GROUP_WOOD.start) + f.pop * (GROUP_WOOD.cut - GROUP_WOOD.burn * freezeShare(today - 1))));

    // Expansion: claim a nearby site. Aggressive groups push out more, toward rich sites and toward you.
    const agg = isAggressiveType(f);
    // groupcare.js: a new base takes scrap and fit people at home; the wounded and the hungry put it off.
    if (!f.hcNoExpand && f.bases.length < maxBases(f) && canExpand(f) && rng.chance((def.expand + (agg ? RAIDS.EXPAND_AGG : 0)) * (fitPeople(f) / 18) * prio(f, "expand") / weightOf(f, "expand"))) {
      const g = state.grid;
      const cands = [];
      const seen = new Set();
      for (const b of f.bases) for (const id of g.within(b, agg ? RAIDS.EXPAND_RANGE : 6)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const t = state.tiles[id];
        // A site, or a bridge: a base on a bridge barricades the road over the river (parties.js bridgeClosedTo), so a
        // group that wants you kept out, or the river crossing for itself, takes one (BRIDGE_PICK of a pick, more for
        // aggressive groups, and only a bridge within reach of you or on their side of the river).
        const bridge = !!t.bridge && !t.loc;
        const left = abandonedAt(state, id); // groupworld.js: a base left standing (its works, some stores)
        if ((bridge || left || (t.loc && t.loc.type !== "city")) && (t.owner == null) && !(left && state.hordes.some((hh) => hh.tile === id)) && !state.bases.some((pb) => pb.tile === id) &&
          state.factions.every((o) => !o.bases.includes(id)) && !reservedForYou(state, id) && // land left for your outpost after a peace (diplomacy.js)
          !(agg && state.bases.some((pb) => g.distance(pb.tile, id) <= RAIDS.KEEP_CLEAR))) cands.push(t);
      }
      if (cands.length) {
        let t;
        const toYou = (id) => { let d = Infinity; for (const pb of state.bases) d = Math.min(d, g.distance(pb.tile, id)); return d; };
        // A bridge is weighed like a middling site, and more the nearer it lies to you (it is a barricade against you).
        const bridgeW = (c) => (agg ? RAIDS.BRIDGE_PICK_AGG : RAIDS.BRIDGE_PICK) * (1 + 2 / (1 + toYou(c.id) / 6));
        const pull = (c) => { const a = abandonedAt(state, c.id); return a ? abandonedPull(f, a) : 1; }; // groupworld.js: cheaper than building from nothing
        if (agg) t = rng.weighted(cands, (c) => (c.bridge && !c.loc ? bridgeW(c) : (0.4 + (c.loot || 0)) * (1 + 2 / (1 + toYou(c.id) / 6))) * pull(c));
        else t = rng.weighted(cands, (c) => (c.bridge && !c.loc ? bridgeW(c) : 1) * pull(c));
        f.bases.push(t.id);
        occupyAbandoned(state, f, t.id); // groupworld.js: the works and stores left there are theirs (a card when it was yours)
        expanded(f);
        overwriteClaims(state, t.id, 2, f.id, t.loc ? `${knownName(f, "a group")} has taken over ${t.loc.name}` : `${knownName(f, "a group")} has barricaded the bridge at ${tileLabel(state, t.id)}`); // claims.js (agent A's hook: keep it)
        if (state.knowledge[t.id] && state.live.has(t.id)) log(state, t.loc ? `${knownName(f, "An unknown group")} has taken over ${t.loc.name}.` : `${knownName(f, "An unknown group")} has barricaded the bridge at ${tileLabel(state, t.id)}: the road over the river is closed to everyone else.`, "danger");
      }
    }

    // Attitude drift: pressure from your bases makes neutral and friendly groups hostile.
    if (!isAggressiveType(f) && attitude(f) !== "Hostile") {
      const close = nearestPlayerBaseDistance(state, f) <= 5;
      const stronger = playerStrength(state) > strength(f) * 0.6;
      const neglected = today - f.lastDiplomacy > 10;
      if (close && stronger && neglected) {
        const rate = def.attitude === "Neutral" ? 1.5 : 0.7;
        changeGoodwill(state, f, -rate, "your expansion near their land");
      }
    } else if (!isAggressiveType(f) && nearestPlayerBaseDistance(state, f) > 5 && today - (f.lastProvoked || 0) > 30) {
      // A peaceful group you provoked into hostility cools off slowly once you leave it alone (no base of yours
      // within 5 tiles, nothing new against it for 30 days): +0.1 goodwill a day.
      changeGoodwill(state, f, RAIDS.COOL_OFF, "time has passed");
    }
    if (state.routes.some((r) => r.active && r.factionId === f.id)) changeGoodwill(state, f, 0.3);
    // Eras (eras.js BANDWAGON): a coalition that governs the state (over half the land) wins the peaceful groups over
    // with time: they warm to it every day, up to BANDWAGON_CAP (the aggressive ones never do: break them).
    if (governs && !isAggressiveType(f) && f.goodwill < ERAS.BANDWAGON_CAP && !isMemberOf(state, f)) changeGoodwill(state, f, ERAS.BANDWAGON);

    // Tribute buys an aggressive group off only for a while; grudges fade slowly.
    if (f.boughtGw > 0) {
      const x = Math.min(RAIDS.TRIBUTE_FADE, f.boughtGw);
      f.boughtGw -= x;
      changeGoodwill(state, f, -x, "the tribute is spent");
    }
    if (f.grudge > 0) f.grudge = Math.max(0, f.grudge * (1 - RAIDS.GRUDGE_FADE) - 0.001);

    // Raids by aggressive groups (and by peaceful ones you provoked into hostility: only on you, and rarely).
    f.raidCooldown -= 1;
    const raidRate = def.raid > 0 ? def.raid : attitude(f) === "Hostile" ? weightOf(f, "provoked", 0) : 0;
    // Hardcore (hardcore-groups.js): quiet while the bands are still founding their hubs.
    // groupcare.js prio: hunger pushes a raid, the wounded hold it back (the type's own rate is FACTION_TYPES raid).
    // groupworld.js: a group that has scouted you lately comes more often.
    const scouted = f.scoutedYou != null && today - f.scoutedYou <= KNOW.SCOUTED_DAYS ? KNOW.SCOUTED : 1;
    if (raidRate > 0 && f.raidCooldown <= 0 && fitPeople(f) >= 8 && !hcGroupRaidsQuiet(state) && rng.chance(raidRate * 1.5 * scouted * (weightOf(f, "raid") ? prio(f, "raid") / weightOf(f, "raid") : 1))) {
      launchRaid(state, f);
      f.raidCooldown = rng.int(8, 16);
    }

    // The hives near them are a threat to everyone: a war party against one now and then (GROUP_HIVE).
    groupHiveWar(state, f, today);

    // Trade convoys between friendly groups make the world feel alive (GROUP_PRIORITIES convoy: a day's chance).
    const convoy = weightOf(f, "convoy", 0);
    if (convoy > 0 && rng.chance(convoy)) {
      const partners = state.factions.filter((o) => o.alive && o !== f && !isAggressiveType(o));
      if (partners.length) {
        const mates = partners.filter((o) => sameBloc(state, f, o)); // blocs.js: trade first within the bloc
        const to = rng.pick(mates.length && hash01(state.seed, "convoy", f.name, today) < 0.6 ? mates : partners);
        const q = spawnAiParty(state, f, "convoy", f.bases[0], to.bases[0], { strength: Math.max(2, f.pop * 0.1), targetFaction: to.id });
        // caravans.js escortParty: what it carries (the 10 food and 10 scrap it delivers) is worth a token guard to them.
        if (q) { q.goods = { supplies: { food: 10, scrap: 10 }, gear: [] }; escortParty(state, f, q, q.goods); }
      }
    }

    if (groupBroken(f)) collapseFaction(state, f);
  }
  groupCareWorld(state); // groupcare.js: your deserters may join a group near the base they left
  groupWorldWorld(state); // groupworld.js: abandoned bases decay
  flightDaily(state); // groupflight.js: a group leaves a base it cannot hold against a horde coming at it
  splinterDaily(state); // splinters.js: strife; a group torn up inside splits, a new band walks out
  newGangs(state);
  aiScavDaily(state); // aiscav.js: scavenging parties out, sites in their own land stripped
  clearStaleAlerts(state);
}

// ---------- the groups against the hives (GROUP_HIVE) ----------
// The hive a group would fight: the nearest within GROUP_HIVE.RANGE of any of its bases (null: none).
export function groupHiveTarget(state, f) {
  const g = state.grid;
  let best = null, bd = Infinity;
  for (const hv of state.hives || []) {
    for (const b of f.bases) { const d = g.distance(b, hv.tile); if (d <= GROUP_HIVE.RANGE && (d < bd || (d === bd && hv.id < best.id))) { best = hv; bd = d; } }
  }
  return best;
}
// The war party a group sends: its fighters and their strength (by the group's arms, eras.js gear).
export const groupHiveParty = (f) => { const fighters = Math.max(GROUP_HIVE.MIN, Math.round(f.pop * GROUP_HIVE.SHARE)); return { fighters, power: fighters * FACTION_TYPES[f.type].arms * (f.arsenal ? kitFactor(f) : f.gear || 1) }; }; // arsenal.js: by their kit (the eras' arms in it)

// One group's day against the hives: on its day (f.hiveDay; EVERY days apart), with a hive in reach and the people
// for it, a war party goes ODDS of the time by type. Resolved by the numbers the same day (see GROUP_HIVE); the
// group remembers its fights (f.hiveFights, f.hiveKills). Returns what happened: null (nothing), "driven" or "burned".
export function groupHiveWar(state, f, today = day(state)) {
  const rng = state.rng;
  ensureHives(state);
  if (f.hcNoGrow) return null; // hardcore's besieged military fights its hive its own way (hardcore-groups.js culls)
  if (f.hiveDay == null) f.hiveDay = today + rng.int(GROUP_HIVE.EVERY[0], GROUP_HIVE.EVERY[1]);
  if (today < f.hiveDay) return null;
  const hive = groupHiveTarget(state, f);
  if (!hive) { f.hiveDay = today + GROUP_HIVE.EVERY[0]; return null; } // nothing in reach: look again in a while
  f.hiveDay = today + rng.int(GROUP_HIVE.EVERY[0], GROUP_HIVE.EVERY[1]);
  const odds = weightOf(f, "hiveWar", 0); // groupcare.js GROUP_PRIORITIES
  if (f.pop < GROUP_HIVE.MIN_POP || !odds || !rng.chance(odds)) return null;
  const { fighters, power } = groupHiveParty(f);
  const guard = hiveGuard(state, hive);
  const size = guard ? guard.size : 0;
  const kill = Math.round((power * GROUP_HIVE.FIGHT * rng.range(0.7, 1.3)) / broodGrowth(state));
  const cut = Math.min(size, kill);
  if (guard && cut > 0) reduceHorde(state, guard, cut);
  hive.res = Math.max(0, hive.res - Math.round(cut * GROUP_HIVE.STORES));
  markThreat(state, hive); // hivetech.js: it builds for defence
  const dead = Math.min(fighters, Math.round(fighters * Math.min(GROUP_HIVE.LOSS_MAX, (GROUP_HIVE.LOSS * size) / Math.max(1, kill)) * rng.range(0.5, 1.5)));
  f.pop = Math.max(0, f.pop - dead);
  clashKit(state, f, fighters, dead, null, 0, "b", 0, true, "hive"); // arsenal.js: the dead's kit stays on the hive's ground
  f.hiveFights = (f.hiveFights || 0) + 1;
  f.hiveKills = (f.hiveKills || 0) + cut;
  const stats = state.hiveInfo.stats;
  stats.groupStorms = (stats.groupStorms || 0) + 1;
  // Fighting the hive you fought lately: they think better of you.
  if (hive.playerDay != null && today - hive.playerDay <= GROUP_HIVE.PLAYER_DAYS) changeGoodwill(state, f, GROUP_HIVE.GOODWILL, "fighting the same hive as you");
  const burned = size - cut <= GROUP_HIVE.SMALL;
  const heard = state.live.has(hive.tile) || canRadioGroup(state, f); // in sight, or the group within radio reach
  const who = knownName(f, "An unknown group");
  if (burned) {
    f.hivesBurned = (f.hivesBurned || 0) + 1;
    stats.groupKills = (stats.groupKills || 0) + 1;
    destroyHive(state, hive, `by ${knownName(f, "another group")}'s fighters`, { quiet: true }); // the hive victory and the records as for any hive
    if (heard) log(state, `${who}'s fighters stormed ${hive.name} and burned it out${dead ? `, losing ${dead} of their own` : ""}. ${hivesLeftText(state)}`, "good");
    return "burned";
  }
  if (heard) log(state, `${who}'s fighters stormed ${hive.name} and were driven off${cut ? ` after cutting down about ${cut} of its brood` : ""}${dead ? ` (${dead} of them killed)` : ""}.`, "info");
  return "driven";
}

// The state is never empty of predators for long: with fewer than 2 hostile aggressive groups (from day 60), a gang
// from beyond the border settles a free site 12–30 tiles from your hub (2% a day): 12–18 people, hostile.
function newGangs(state) {
  if (day(state) < RAIDS.NEW_GANG_FROM || state.noNewGangs) return; // noNewGangs: test switch
  if (hcNoRaiders(state)) return; // hardcore-groups.js: no gangs before the raiders appear
  const minAgg = isLate(state) ? Math.max(RAIDS.MIN_AGG, ERAS.LATE_MIN_AGG) : RAIDS.MIN_AGG; // eras.js: one more in the late game
  // A state the coalition governs (over half the land held) is closed to new gangs: its patrols turn them back.
  if (controlledLand(state).pct > ALLIANCE.LAND_NEEDED) return;
  if (state.factions.filter((f) => f.alive && isAggressiveType(f) && attitude(f) === "Hostile").length >= minAgg) return;
  const rng = state.rng;
  if (!rng.chance(RAIDS.NEW_GANG)) return;
  const g = state.grid;
  const h = hub(state);
  if (!h) return;
  const held = coalitionMask(state); // alliance.js: not on the coalition's land
  const sites = state.tiles.filter((t) => t.loc && t.loc.type !== "city" && t.loc.zone !== "urban" && t.owner == null && !held[t.id] &&
    g.distance(t.id, h.tile) >= 12 && g.distance(t.id, h.tile) <= 30 && !t.hive &&
    state.bases.every((b) => g.distance(b.tile, t.id) >= 6) &&
    state.factions.every((f) => !f.alive || f.bases.every((b) => g.distance(b, t.id) >= 8)));
  if (!sites.length) return;
  const type = rng.pick(["raider", "raider", "zealot", "expansionist"]);
  const site = rng.pick(sites);
  makeGang(state, site.id, { type, pop: rng.int(12, 18) + gangPopBonus(state), rng }); // eras.js: bigger gangs in later years
  state.stats.newGangs = (state.stats.newGangs || 0) + 1;
  if (state.live.has(site.id)) log(state, `A new gang from beyond the border has moved into ${site.loc.name}.`, "danger");
  else log(state, `Travellers speak of a new gang settling somewhere ${dirFromHub(state, site.id)}.`, "danger");
}
// A new hostile group on a tile (a gang from beyond the border, a raider band from outside that settles: visitors.js).
// opts: { type, pop, name, stock (added to the usual start), known, rng }. Returns the group.
export function makeGang(state, tile, opts = {}) {
  const rng = opts.rng || state.rng;
  const type = opts.type || "raider";
  const def = FACTION_TYPES[type];
  const used = new Set(state.factions.map((f) => f.name));
  const name = opts.name && !used.has(opts.name) ? opts.name : def.names.find((n) => !used.has(n)) || ["II", "III", "IV", "V", "VI"].map((n) => `${def.names[0]} ${n}`).find((n) => !used.has(n)) || `${def.names[0]} ${state.factions.length}`;
  const pop = opts.pop || 12;
  const f = {
    id: newId(), name, type, color: FACTION_COLORS[state.factions.length % FACTION_COLORS.length],
    bases: [tile], pop, alive: true, known: !!opts.known,
    goodwill: Math.min(-45, def.goodwill - rng.int(0, 10)), lastDiplomacy: 0, pact: null,
    stock: { food: pop * 6, ammo: pop * 10 * def.arms, fuel: pop * 1, meds: pop, parts: 2, scrap: pop * 3, preserved: Math.round(pop * 0.5), jars: 0, wood: pop * GROUP_WOOD.start, arrows: pop * 2 },
    lootedGear: [], raidCooldown: rng.int(6, 12), arrived: day(state), gear: isAggressiveType({ type }) ? gangArms(state) : 1,
  };
  for (const [k, q] of Object.entries(opts.stock || {})) if (Number.isFinite(q) && q > 0) f.stock[k] = (f.stock[k] || 0) + q;
  state.factions.push(f);
  ensureArsenal(state, f); // arsenal.js: the kit they bring (later in the run some of their kit's best guns, eras.js gangArms)
  const t = state.tiles[tile];
  if (t.ruin) delete t.ruin; // they built on the ruins
  recomputeOwnership(state);
  return f;
}
function dirFromHub(state, tile) {
  if (!hub(state)) return "out in the state";
  const a = state.tiles[hub(state).tile], b = state.tiles[tile];
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) * 2 ? (dx > 0 ? "to the east" : "to the west") : Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? "to the south" : "to the north") : `to the ${dy > 0 ? "south" : "north"}${dx > 0 ? "east" : "west"}`;
}

// "Prepare defenses" lasts until that raid is resolved. If the raid never arrives (bought off, broken on the
// road, its group gone), the base stands down.
export function clearStaleAlerts(state) {
  for (const b of state.bases) {
    if (!b.alert) continue;
    const coming = state.parties.some((p) => p.kind === "raid" && !p.returning && p.target && p.target.kind === "player" && p.target.baseId === b.id) ||
      outsiderRaidOn(state, b.id); // raiders from outside the state (visitors.js)
    if (!coming) b.alert = false;
  }
}

function launchRaid(state, f) {
  const rng = state.rng;
  const g = state.grid;
  const origin = f.bases[0];
  const targets = [];
  // Only a hostile group raids you: the same line as the "Hostile" label (and a hostile group has no pact left).
  // Eras (eras.js): only when the pace of raids on you allows a new one, and only a base it can take on: its whole
  // strength at least PREP × the base's defence with everyone at a post (rising over the years: fewer, bigger raids).
  if (attitude(f) === "Hostile" && raidPaceOpen(state) && !ceasefireWith(state, f)) { // playerwars.js: not under a ceasefire with you
    for (const b of state.bases) {
      const from = nearestOwnBase(state, f, b.tile);
      const d = g.distance(from, b.tile);
      if (d > RAIDS.REACH) continue; // the same reach on every map size: on a bigger one the far groups must expand toward you first
      const known = intelDef(state, f, b); // groupworld.js: only a base they know, judged by what they saw (old intel stays old)
      if (known == null) continue;
      if (strength(f) * RAIDS.CAP < raidPrep(state) * known) continue;
      targets.push({ kind: "player", baseId: b.id, tile: b.tile, from, w: playerRaidWeight(state, f, b, d) });
    }
  }
  // Peaceful groups you provoked only come for you; aggressive ones raid their neighbours too.
  if (FACTION_TYPES[f.type].raid > 0) for (const o of state.factions) {
    if (!o.alive || o === f) continue;
    const rw = raidWeight(state, f, o); // diplomacy.js: never a pact partner or a fellow coalition member, war enemies first
    if (!rw) continue;
    if (fearsGroup(state, f, o)) continue; // groupworld.js: a group they think too strong for them
    for (const b of o.bases) {
      if (g.distance(origin, b) > RAIDS.FACTION_REACH || !knownBase(state, f, b)) continue; // only bases they know
      targets.push({ kind: "faction", factionId: o.id, tile: b, w: weightOf(o, "raidBait", RAIDS.BAIT) * rw });
    }
  }
  if (!targets.length) return;
  const tgt = rng.weighted(targets, (t) => t.w);
  if (tgt.kind === "player") {
    launchRaidOnBase(state, f, baseById(state, tgt.baseId), { from: tgt.from });
    return;
  }
  const raidStrength = Math.max(RAIDS.MIN, strength(f) * rng.range(0.25, 0.4));
  const p = spawnAiParty(state, f, "raid", origin, tgt.tile, { strength: raidStrength, target: tgt });
  // blocs.js: a raid on their bloc's foe draws members along.
  const b = p && blocOf(state, f);
  if (b && b.foe && b.foe.kind === "group" && b.foe.id === tgt.factionId) { const j = jointRaid(state, f, tgt.tile, { kind: "group", id: tgt.factionId }); if (j) { p.strength += j.power; p.joint = j.ids; } }
}
// A raid of f's on one of your bases (launchRaid; playerwars.js war raids). opts: { from (the tile they march from),
// prepared (siege kit as if they had been beaten off before) }. Returns the party or null.
export function launchRaidOnBase(state, f, base, opts = {}) {
  if (!f || !base) return null;
  const from = opts.from ?? nearestOwnBase(state, f, base.tile);
  const p = spawnAiParty(state, f, "raid", from, base.tile, { strength: raidSize(state, f, base), target: { kind: "player", baseId: base.id, tile: base.tile } });
  if (p) {
    p.esc = f.raidEsc || 1; f.raidedYou = day(state); noteRaid(state); // the autopilot's grudge (autopilot.js conquest); the pace (eras.js)
    // Siege kit by how prepared they are (siege.js): ladders, a ram, grenades against a walled base.
    p.siege = capSiegeKit(state, f, raidSiegeKit(state, base, { count: raidForce(f, p.strength).count, key: p.id, prepared: !!opts.prepared || p.esc > 1.01 || weightOf(f, "siegePrep", 0) > 0, kind: weightOf(f, "bombs", "pipebomb") })); // arsenal.js: only the explosives they hold
  }
  return p;
}

// How much a group wants to hit one of your bases (see the header): greed, your land, their grudge, their size, distance.
export function playerRaidWeight(state, f, b, d) {
  const greed = clamp(supplyValue(b.stock) / RAIDS.GREED, 0.4, 3);
  const land = 1 + RAIDS.LAND * Math.max(0, state.bases.filter((x) => !x.captured).length - 1); // bases you took from groups (conquest.js) do not count: the spoils of war, not your sprawl
  const grudge = 1 + RAIDS.GRUDGE * Math.min(RAIDS.GRUDGE_MAX, f.grudge || 0);
  const size = clamp(strength(f) / RAIDS.SIZE_REF, 0.6, 2);
  return RAIDS.PLAYER_W * greed * land * grudge * size / (1 + d / RAIDS.DIST);
}

// The base's defence with everyone at a post ("Prepare defenses"): what a group's scouts size a raid to.
export function preparedDefense(state, base) {
  const was = base.alert;
  base.alert = true;
  const prepared = baseDefense(state, base);
  base.alert = was;
  return prepared;
}
// The raid's strength: sized to the base's prepared defence (0.6–1.0 × in the early game, more in later years:
// eras.js RAIDS.SIZE; × escalation), at most the whole group.
export function raidSize(state, f, base) {
  const prepared = intelDef(state, f, base) ?? preparedDefense(state, base); // groupworld.js: sized on what their scouts saw
  const [lo, hi] = raidSizeRange(state);
  const want = prepared * state.rng.range(lo, hi) * (f.raidEsc || 1);
  return Math.max(RAIDS.MIN, Math.min(strength(f) * RAIDS.CAP, want));
}

// A siege hour at your base: a strong defence drives them off sooner (each hour counts defence / strength / 1.2,
// 1 to 4). parties.js and visitors.js take this off the siege's hours left.
export function siegePace(state, base, att) {
  if (!base) return 1;
  return clamp(baseDefense(state, base) / Math.max(1, att) / RAIDS.PACE, 1, RAIDS.PACE_MAX);
}

// What a raid on this base is likely to cost if you fight it with everyone at a post, against what the tribute costs,
// both in supply value (the autopilot weighs one against the other). A building wrecked is worth about 9 (its
// repair materials), a wound about 25; the damage budget / 130 is about how many buildings break.
export function raidStakes(state, base, party) {
  const was = base.alert;
  base.alert = true;
  const r = baseDefense(state, base) / Math.max(1, party.strength);
  base.alert = was;
  const value = supplyValue(base.stock);
  const store = count(base, "storehouse") > 0;
  const wrecked = (mult, hours) => (party.strength * RAID_DAMAGE.perStrength * Math.min(1, hours / 8) * mult) / 130 * 9;
  const held = wrecked(RAID_DAMAGE.outcome.held, 8 / clamp(r / RAIDS.PACE, 1, RAIDS.PACE_MAX)) + 0.4 * 25;
  const breakIn = value * (store ? 0.1 : 0.2) + wrecked(RAID_DAMAGE.outcome.broken, 8) + 2 * 25;
  const overrun = value * (store ? 0.25 : 0.5) + wrecked(RAID_DAMAGE.outcome.overrun, 8) + 3 * 40 + (base.type === "outpost" ? 300 : 0);
  const fight = r >= 1.4 ? held : r >= RAIDS.HOLD ? 0.7 * held + 0.3 * breakIn : r >= 0.9 ? breakIn : r >= RAIDS.BREAK ? (breakIn + overrun) / 2 : overrun;
  const food = Math.min(Math.floor(base.stock.food || 0), Math.ceil((base.stock.food || 0) * 0.3));
  return { ratio: r, fight: Math.round(fight), tribute: Math.round(food * 2 + 30 * 0.5) };
}

// You beat their raid (by the numbers or in person): they hold a grudge and come back stronger next time.
export function raidRepelled(state, f) {
  if (!f) return;
  f.raidEsc = Math.min(RAIDS.ESC_MAX, (f.raidEsc || 1) * (1 + RAIDS.ESCALATE));
  f.grudge = Math.min(RAIDS.GRUDGE_MAX * 2, (f.grudge || 0) + 1);
}

// surprise (watch.js surpriseAt: raiders over the walls on an unwatched night): everyone but the guards counts
// SURPRISE.ASLEEP instead of 0.8, until the base is put on alert.
export function baseDefense(state, base, surprise = false) {
  const people = atBase(state, base.id);
  let d = baseWalls(base) * 2;
  const mult = (s) => (s.role === "guard" ? 1.5 : base.alert ? 1.3 : surprise ? SURPRISE.ASLEEP : 0.8);
  for (const s of people) d += combatPower(s) * mult(s);
  // Short of ammo (under 3 a head) the guns count 70%, short of arrows the bows (world.js armedFactor).
  return d * armedFactor(people, base.stock, base.stock.arrows || 0, { short: 0.7, weight: mult });
}

// Called when a raid party reaches its target and the siege timer runs out.
// opts.beaten ("overrun" | "broken"): the defenders already fought this raid on the battle map and lost
// (conflicts.js). Then only the break-in is applied: no second fight by the numbers, no further injuries.
export function resolveRaidOnPlayer(state, party, opts = {}) {
  const res = resolveRaidOnPlayerNow(state, party, opts);
  if (res) {
    pwarRaidDone(state, party, res); // playerwars.js: a raid in a war with you counts for the war
    jointAfter(state, party, res.outcome !== "held"); // blocs.js: the members who marched with them
  }
  return res;
}
function resolveRaidOnPlayerNow(state, party, opts = {}) {
  const rng = state.rng;
  const base = baseById(state, party.target.baseId);
  const f = factionById(state, party.owner);
  if (!base || !f) return null;
  f.known = true; // they are at your walls: you know who they are
  const beaten = opts.beaten || null;
  // Abandoned before they got here (Retreat on the warning card): they walk in and keep it, or burn it (conquest.js).
  if (!beaten && base.abandoned != null && !atBase(state, base.id).length) {
    warRaidOnPlayer(state, party, false);
    raidWon(state, f);
    if (rng.chance(razeChance(state, f, base.tile) * (base.type === "hub" ? RAIDS.RAZE_HUB : 1))) { razePlayerBase(state, base, f); return { outcome: "razed", text: `${f.name} burned ${base.name} to the ground.`, dmg: null }; }
    const occ = occupyPlayerBase(state, base, f, { garrison: raidForce(f, party.strength).count, retreated: true, outcome: "retreat" });
    return { outcome: "taken", text: occ ? `${f.name} moved into ${base.name}.` : "", dmg: null };
  }
  const people = beaten ? [] : atBase(state, base.id);
  const armory0 = opts.armory0 ?? base.armory.length; // arsenal.js: what is added to the armory from here on is your dead's gear
  const allies = beaten ? { power: 0, names: [] } : allianceRaidHelp(state, base, f); // alliance.js: coalition members send fighters
  if (!beaten) { const bh = blocPlayerHelp(state, base, f, baseDefense(state, base, !!party.surprise)); if (bh.power > 0) { allies.power += bh.power; allies.names = [...allies.names, ...bh.names]; } } // blocs.js: a bloc you stand with
  const caught = !!party.surprise; // watch.js surpriseAt: they came on an unwatched night (parties.js, at the walls)
  const def = baseDefense(state, base, caught) + allies.power;
  const att = party.strength + raidTurretPower(state, party) + (baseWalls(base) ? wallPower(state, f, raidCount(f, party.strength)) : 0); // vehicles.js: the Humvee and its M2 if the raid brought it; arsenal.js: launchers against walls
  if (allies.names.length) log(state, `Fighters from ${allies.names.join(" and ")} came to help defend ${base.name}.`, "good");
  const shot = beaten ? { ammo: 0, arrows: 0 } : spendShots(base.stock, people, 3); // 3 a head: the bows' in arrows, the rest's in ammo
  // The walls, the yard and the buildings (defences.js raidTier): held at the wall, a break-in pushed back from the
  // yard or the buildings, or overrun.
  const rt = beaten ? null : raidTier(state, base, def, att, RAIDS.HOLD, RAIDS.BREAK, party.siege || null, caught); // siege.js: their ladders, ram and grenades
  const ratio = beaten ? (beaten === "broken" ? 1 : 0) : rt.ratio;
  const hours = beaten ? RAIDS.SIEGE_HOURS : Math.max(1, party.siegeHours || RAIDS.SIEGE_HOURS);
  const before = { ...base.stock };
  const hurtWho = new Map();
  const wound = (s, amt, why) => { hurt(state, s, amt, base.tile, why); hurtWho.set(s.id, `${s.name.split(" ")[0]}${s.alive ? "" : " (killed)"}`); };
  warRaidOnPlayer(state, party, ratio >= RAIDS.HOLD); // diplomacy.js: a war raid on your base counts for the war
  let outcome, head, keep = false, raze = false, theirDead = 0, kitMoved = null;
  // arsenal.js raidOnBase: their dead's kit (yours when you hold the field), your dead's gear and a share of your armory
  // (theirs when they got in), the rounds and explosives they spent.
  const settleKit = () => (kitMoved = kitMoved || raidOnBase(state, f, base, party, { outcome, theirDead, armory0, store: count(base, "storehouse") > 0 }));
  if (ratio >= RAIDS.HOLD) {
    outcome = "held";
    state.stats.raidsRepelled += 1;
    head = `${base.name} drove off the ${f.name.replace(/^The /, "")} raid after ${hours} hour${hours === 1 ? "" : "s"} at the walls.`;
    log(state, `${base.name} drove off the ${f.name.replace(/^The /, "")} raid.`, "good");
    if (people.length && rng.chance(0.4)) wound(rng.pick(people), rng.int(10, 30), `defending ${base.name}`);
    theirDead = rng.int(1, 3);
    f.pop = Math.max(0, f.pop - theirDead);
    raidRepelled(state, f);
    if (shot.arrows) base.stock.arrows = (base.stock.arrows || 0) + arrowsBack(shot.arrows); // the field is yours: about half the arrows picked up
    const hv = loseRaidHumvee(state, party, { base }); // vehicles.js: the Humvee they brought is left behind, yours
    if (hv) head += ` ${humveeLeftText(f, hv, base)}`;
  } else if (ratio >= RAIDS.BREAK) {
    outcome = "broken";
    head = rt && rt.tier === "buildings" ? `${f.name} broke into ${base.name} and took the yard, but your people held the buildings and drove them out.` : `${f.name} broke into ${base.name} before being pushed out.`;
    log(state, `${f.name} broke into ${base.name} before being pushed out. Supplies were stolen.`, "danger");
    steal(base.stock, count(base, "storehouse") ? 0.1 : 0.2, f.stock);
    for (let i = 0; i < (rt && rt.tier === "buildings" ? 3 : 2) && people.length; i++) wound(rng.pick(people), rng.int(15, 45), `defending ${base.name}`);
    theirDead = Math.min(1, f.pop);
    f.pop = Math.max(0, f.pop - 1);
    raidWon(state, f);
    if (shot.arrows) base.stock.arrows = (base.stock.arrows || 0) + arrowsBack(shot.arrows); // pushed out: the arrows in the yard are yours
    // An outpost they broke into may be kept (a third as likely as after an overrun): the people there leave.
    if (base.type === "outpost" && rng.chance(keepChance(state, f, base.tile, supplyValue(base.stock)) * CONQUEST.BREAKIN_KEEP)) keep = true;
  } else {
    outcome = "overrun";
    head = `${f.name} overran ${base.name}.`;
    log(state, `${f.name} overran ${base.name}.`, "death");
    steal(base.stock, count(base, "storehouse") ? 0.25 : 0.5, f.stock);
    for (let i = 0; i < 3 && people.length; i++) wound(rng.pick(people), rng.int(30, 70), `when ${base.name} was overrun`);
    raidWon(state, f);
    settleKit();
    // They may keep it (conquest.js: the people there walk to your nearest base; the hub's job moves there), or burn
    // it to the ground (aggressive types: razeChance).
    const fate = baseFate(state, f, base.tile, supplyValue(base.stock), base.type === "hub" ? RAIDS.KEEP_HUB : 1,
      (base.type === "hub" ? RAIDS.RAZE_HUB : 1) * (people.length || beaten ? 1 : RAIDS.RAZE_EMPTY));
    keep = fate === "keep";
    raze = fate === "raze";
    if (raze) {
      razePlayerBase(state, base, f);
      return { outcome: "razed", text: `${head} They burned ${base.name} to the ground.`, dmg: null };
    }
    if (!keep && base.type === "outpost" && (people.length || beaten)) { // an empty one (land you hold, conquest.js) is looted and left standing
      // Survivors who live flee to the hub; the outpost is lost (world.removeBase: vehicles left behind,
      // stations cleared, supply runs paused, and the log says what went with it).
      removeBase(state, base, "has been lost");
    }
  }
  settleKit();
  base.alert = false;
  // The raid damage stays on a base they keep (its walls are what an assault to take it back faces).
  const dmg = state.bases.includes(base) ? raidDamage(state, base, { strength: att, hours, outcome, by: f.name }) : null;
  if (keep && state.bases.includes(base)) {
    occupyPlayerBase(state, base, f, { garrison: raidForce(f, att).count, outcome });
    return { outcome: "taken", text: `${head} They kept ${base.name}.`, dmg };
  }
  const kept = state.bases.includes(base);
  if (dmg && (dmg.broken.length || dmg.destroyed || dmg.damaged.length)) log(state, `${base.name}: ${dmg.text}`, outcome === "held" ? "info" : "danger");
  const took = stolenText(before, base.stock);
  const hurtNames = [...hurtWho.values()];
  if (caught && !beaten) head = `${party.surprise}: the raiders were over the wall before anyone woke. ${head}`;
  const kitWords = (list) => [...new Set(list.map((it) => it.name))].slice(0, 4).join(", ");
  const text = [head, took ? `They took ${took}.` : "", kitMoved && kitMoved.stole.length ? `They carried off ${kitWords(kitMoved.stole)}${kitMoved.stole.length > 4 ? " and more" : ""} from the armory and the fallen.` : "",
    kitMoved && kitMoved.dropped.length ? `Their dead left ${kitWords(kitMoved.dropped)} behind (in the armory now).` : "",
    hurtNames.length ? `Hurt: ${hurtNames.join(", ")}.` : "",
    dmg ? dmg.text : `${base.name} is lost.`].filter(Boolean).join(" ");
  if (!beaten && kept) raidReportCard(state, base, { title: outcome === "held" ? `${f.name} driven off` : `Raid on ${base.name}`, text, dmg });
  return { outcome, text, dmg };
}
// A raid that got in: the escalation starts over and the win draws 1–2 recruits to them.
function raidWon(state, f) {
  f.raidEsc = 1;
  f.pop += state.rng.int(1, 2);
}

// What raiders take goes home with them (into: their group's stock): a raid that gets in feeds the group.
function steal(stock, frac, into = null) {
  for (const k of Object.keys(stock)) {
    const left = Math.floor((stock[k] || 0) * (1 - frac));
    if (into && k !== "water" && k !== "rawwater") into[k] = (into[k] || 0) + Math.max(0, (stock[k] || 0) - left);
    stock[k] = left;
  }
}
// "40 food, 12 ammo and 3 meds": what left the stock (the biggest losses first, at most four).
export function stolenText(before, after) {
  const lost = Object.keys(before).map((k) => [k, Math.floor((before[k] || 0) - (after[k] || 0))]).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const parts = lost.map(([k, q]) => `${q} ${keyWord(k)}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
}

export function resolveRaidOnFaction(state, party, helpers) {
  const target = factionById(state, party.target.factionId);
  const attacker = typeof party.owner === "number" ? factionById(state, party.owner) : null;
  if (!target || !target.alive) return;
  // Trade prices remember it (valuation.js): raided lately, or a horde at their walls.
  target.hitDay = day(state);
  if (!attacker && !party.raidName) target.hordeHitDay = day(state);
  // blocs.js: the target's bloc sends what it can spare to the base hit.
  const bloc = blocHelpFor(state, target, party.target.tile, attacker);
  const helpPower = helpers.reduce((s, h) => s + h, 0) + bloc.power;
  if (party.warId != null) { // diplomacy.js: raids in a war between groups, with their own odds and terms
    const held = resolveWarRaid(state, party, attacker, target, helpPower);
    if (held) loseRaidHumvee(state, party, { faction: target }); // vehicles.js: the raid's Humvee falls to the defenders
    blocHelpAfter(state, bloc, held, target);
    jointAfter(state, party, !held);
    if (groupBroken(target)) collapseFaction(state, target, attacker);
    return held;
  }
  const held = resolveOrdinaryRaid(state, party, attacker, target, helpPower);
  blocHelpAfter(state, bloc, held, target);
  jointAfter(state, party, !held);
  return held;
}
// An ordinary raid between groups (or by raiders from outside, or a horde) at its end: true when the defenders held.
function resolveOrdinaryRaid(state, party, attacker, target, helpPower) {
  const rng = state.rng;
  raidSoured(state, attacker, target);
  const def = groupBaseDefence(state, target, party.target.tile) + strength(target) * 0.8 + helpPower + (party.target.tile === target.bases[0] ? groupTurretPower(target) : 0); // 8 for a walled base (groupworks.js: half that bare); vehicles.js: a military group's Humvee at home
  const att = party.strength + raidTurretPower(state, party); // and the one a raid brought
  const attN = attacker ? raidCount(attacker, party.strength) : 0; // arsenal.js: the raiders' kit
  // Only report fights you could know about: raids on groups you know, anything you can see. Groups you have not
  // met are not named.
  const who = attacker ? knownName(attacker) : party.raidName || "a horde"; // raidName: raiders from outside (visitors.js)
  const whom = knownName(target, `the people at ${tileLabel(state, party.target.tile)}`);
  const report = state.live.has(party.target.tile) || (attacker && target.known);
  // groupcare.js: clearly outmatched, a group may pay tribute rather than fight (as you can), by its type.
  if (raidAnswer(state, attacker, target, att, def) === "tribute") {
    if (report) log(state, `${whom[0].toUpperCase() + whom.slice(1)} paid ${who} off rather than fight.`, "info");
    return false;
  }
  // Clearly outmatched at a base that is not their main one: they may give it up and fall back to the others.
  if (att > def * RAIDS.ABANDON && target.bases.length > 1 && party.target.tile !== target.bases[0] && rng.chance(RAIDS.ABANDON_CHANCE)) {
    const lost = party.target.tile;
    target.bases = target.bases.filter((b) => b !== lost);
    for (const k of Object.keys(target.stock)) { const q = target.stock[k] * 0.1; target.stock[k] -= q; if (attacker) attacker.stock[k] = (attacker.stock[k] || 0) + q; }
    if (attacker) clashKit(state, attacker, 0, 0, target, 0, "a", 0.2, false); // arsenal.js: the spare kit left behind there, half carried off
    const kept = attacker && rng.chance(keepChance(state, attacker, lost));
    if (kept) attacker.bases.push(lost);
    recomputeOwnership(state);
    state.stats.abandonedBases = (state.stats.abandonedBases || 0) + 1;
    if (report) log(state, `${whom[0].toUpperCase() + whom.slice(1)} gave up ${tileLabel(state, lost)} to ${who} without a fight${kept ? "" : " (it stands empty)"}.`, "info");
    return false;
  }
  if (att > def * 1.1) {
    const loss = Math.ceil(target.pop * rng.range(0.2, 0.35));
    target.pop -= loss;
    clashKit(state, attacker, attN, 0, target, loss, "a", 0.4); // arsenal.js: the field is theirs: half the dead's kit and of the spare kit they lose
    // nonlethal.js raidPrisoners: the winners take a share of the beaten alive by type, into their jail (groupjails.js:
    // as many as it holds; the rest sold on, let go or killed by type). Returns those taken alive (fewer dead).
    const taken = raidPrisoners(state, attacker, target, loss);
    for (const k of Object.keys(target.stock)) {
      const lost = target.stock[k] * 0.4;
      target.stock[k] -= lost;
      if (attacker) attacker.stock[k] = (attacker.stock[k] || 0) + lost / 2; // half of it is carried home
    }
    if (target.bases.length > 1 && rng.chance(0.5)) {
      const lost = party.target.tile;
      target.bases = target.bases.filter((b) => b !== lost);
      target.lostBaseDay = day(state); // valuation.js: they want weapons and defences, and sell off fine things
      const fate = attacker ? baseFate(state, attacker, lost) : "leave"; // keep it, burn it or loot it and go
      if (fate === "keep") attacker.bases.push(lost);
      else if (fate === "raze") razeGroupBase(state, target, lost, attacker);
      else if (leaveGroupBase(state, target, lost, 0.5 / Math.max(1, target.bases.length + 1))) state.stats.leftBases = (state.stats.leftBases || 0) + 1; // groupworld.js: looted and left standing, its works there for whoever comes
      recomputeOwnership(state); // a base changed hands: the land around it follows at once
    }
    if (report) log(state, `${who[0].toUpperCase() + who.slice(1)} hit ${whom} hard (${loss - taken} dead${taken ? `, ${taken} taken prisoner` : ""}).`, "danger");
    if (attacker && isAggressiveType(attacker) && rng.chance(0.5)) attacker.pop += 1; // a win draws fighters to them
    if (groupBroken(target)) collapseFaction(state, target, attacker);
    return false;
  }
  const tp = target.pop;
  target.pop = Math.max(1, target.pop - rng.int(0, 2));
  const ap = attacker ? attacker.pop : 0;
  if (attacker) attacker.pop = Math.max(0, attacker.pop - rng.int(1, 3));
  clashKit(state, attacker, attN, attacker ? ap - attacker.pop : 0, target, tp - target.pop, "b"); // arsenal.js: the defenders hold the field
  const hv = loseRaidHumvee(state, party, { faction: target }); // vehicles.js: the raid's Humvee falls to the defenders
  if (report) log(state, `${whom[0].toUpperCase() + whom.slice(1)} held off ${who}${hv ? ` and took their ${hv.name}` : ""}.`, "info");
  return true;
}

// by: the group whose raid finished them (it takes over what is left); otherwise the strongest aggressive group
// within 15 tiles may move in on the ruins (50%). opts.into: they went over to that group (groupflight.js: taken in
// by an ally), so nobody takes over the ruins, no refugees come to you and nothing is said of a collapse.
export function collapseFaction(state, f, by = null, opts = {}) {
  if (!f.alive) return;
  const ruins = [...f.bases];
  f.alive = false;
  f.bases = [];
  f.pact = null;
  freeOnCollapse(state, f); // groupjails.js: the people they held walk home
  if (f.known && !opts.into) log(state, `${f.name} has collapsed.`, "danger");
  if (!opts.into) takeOver(state, f, ruins, by);
  // groupworld.js: the bases nobody took stand empty, their works and some stores left for whoever comes.
  for (const t of ruins) leaveGroupBase(state, f, t, 1 / Math.max(1, ruins.length));
  // Their people on the road are gone with them: raids, sieges and convoys end here.
  for (const q of [...state.parties]) {
    if (q.owner !== f.id) continue;
    // Your relief squad at a siege they were laying: nothing left to fight.
    for (const h of state.parties.filter((x) => x.owner === "player" && x.phase === "helping" && x.helpFor === q.id)) {
      awaitOrders(state, h, `The attackers melted away: ${knownName(f, "their group")} has fallen apart.`);
    }
    removeParty(state, q);
  }
  // Their land is nobody's from this moment (patrol cards and outpost sites read tile owners).
  recomputeOwnership(state);
  clearStaleAlerts(state);
  // Some survivors look for a new home.
  // A recruit card (recruits.js): 1–3 of them, with the hub's beds, food and water.
  if (!opts.into && state.rng.chance(0.6) && hub(state)) {
    const n = state.rng.int(1, 3);
    const list = Array.from({ length: n }, () => makeCandidate(state, { quality: 0.9, minHealth: 45 }));
    offerRecruits(state, list, {
      source: "refugees", baseId: hub(state).id, title: "Refugees at the gate",
      intro: `Survivors from ${knownName(f, "a group that fell apart out in the dead lands")} have reached ${hub(state).name}. They ask to join you.`,
    });
  }
}

// The winner takes the spoils: bases (nearest to its own first, up to its cap), 2–4 survivors and half the stores.
function takeOver(state, f, ruins, by) {
  if (!ruins.length) return;
  const g = state.grid;
  const near = (o) => Math.min(...o.bases.map((b) => Math.min(...ruins.map((r) => g.distance(b, r)))));
  let heir = by && by.alive && by !== f && by.bases.length ? by : null;
  if (!heir) {
    const cands = state.factions.filter((o) => o.alive && o !== f && isAggressiveType(o) && o.bases.length && near(o) <= RAIDS.HEIR_RANGE);
    if (!cands.length || !state.rng.chance(RAIDS.HEIR_CHANCE)) return;
    heir = cands.sort((a, b) => strength(b) - strength(a) || a.id - b.id)[0];
  }
  const taken = [];
  for (const r of [...ruins].sort((a, b) => Math.min(...heir.bases.map((x) => g.distance(x, a))) - Math.min(...heir.bases.map((x) => g.distance(x, b))))) {
    if (heir.bases.length >= maxBases(heir)) break;
    if (state.bases.some((pb) => pb.tile === r) || state.factions.some((o) => o.alive && o.bases.includes(r))) continue;
    heir.bases.push(r);
    taken.push(r);
  }
  heir.pop += state.rng.int(2, 4);
  for (const k of Object.keys(f.stock)) heir.stock[k] = (heir.stock[k] || 0) + Math.floor((f.stock[k] || 0) / 2);
  inheritArsenal(state, heir, f); // arsenal.js: half their kit, and their vehicles
  state.stats.takeovers = (state.stats.takeovers || 0) + 1;
  if (heir.known || f.known || taken.some((t) => state.live.has(t))) {
    log(state, `${knownName(heir, "Another group")} has taken over what was left of ${knownName(f, "a broken group")}${taken.length ? ` (${taken.length} base${taken.length === 1 ? "" : "s"})` : ""}.`, isAggressiveType(heir) ? "danger" : "info");
  }
}

export function recruit(state, n, foodCost) {
  const h = hub(state);
  h.stock.food = Math.max(0, h.stock.food + foodCost);
  const names = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(state, 0.9);
    s.location = { kind: "base", baseId: h.id };
    s.role = "farm";
    state.survivors.push(s);
    state.stats.peopleSaved += 1;
    names.push(s.name);
  }
  return `${names.join(" and ")} joined the group.`;
}

// Calls for help: a neutral or friendly group under attack near your bases asks for support.
export function maybeCallForHelp(state, party) {
  const target = factionById(state, party.target.factionId);
  if (!target || !target.alive || isAggressiveType(target) || attitude(target) === "Hostile") return;
  const near = state.bases.some((b) => state.grid.distance(b.tile, party.target.tile) <= 7);
  if (!near) return;
  const h = hub(state);
  const radio = radioBasesInRange(state, party.target.tile, 4).length > 0;
  const delay = radio ? 0 : Math.max(4, state.grid.distance(h.tile, party.target.tile) * 2);
  party.helpCall = { arrivesAt: state.hour + delay, radio };
}

export function deliverHelpCall(state, party) {
  const target = factionById(state, party.target.factionId);
  const attacker = typeof party.owner === "number" ? factionById(state, party.owner) : null;
  const h = hub(state);
  const tooLate = !state.parties.includes(party);
  const via = party.helpCall.radio ? "over the radio" : "by a runner";
  if (tooLate) {
    addCard(state, { title: "A call for help, too late", text: `A runner from ${target.name} arrives. They were attacked, but the fight is already over.`, choices: [{ label: "OK", resolve: () => "" }] });
    return;
  }
  target.known = true; // they sent word: you know who they are now
  const atkName = attacker ? knownName(attacker, "a group they do not know") : `a horde of ${Math.round(party.strength / 0.15)}`;
  addCard(state, {
    title: `${target.name} asks for help`,
    text: `${target.name} (${attitude(target).toLowerCase()}) is under siege by ${atkName}. The message came ${via}. They hold for about ${Math.max(1, party.siegeLeft ?? 18)} more hours.`,
    choices: [
      {
        label: "Send a squad (best 3 fighters at the hub)",
        hint: "Big goodwill gain if they arrive in time",
        resolve: (st) => sendHelpSquad(st, party, target),
      },
      {
        label: "Send 40 ammo",
        hint: "Strengthens their defense, small goodwill gain",
        disabled: () => totalRounds(h.stock) < 40,
        resolve: (st) => {
          // Checked against what the hub holds now, not when the message came in.
          if (totalRounds(h.stock) < 40) return `${h.name} no longer has 40 ammo to spare.`;
          if (!st.parties.includes(party)) return `Too late: the fight at ${target.name} is already over.`;
          payAmmo(st, h, 40); // ammo.js: the rounds its guns need least
          party.strength *= 0.8;
          changeGoodwill(st, target, 6, "you sent ammo");
          target.lastDiplomacy = day(st);
          return `Ammo sent to ${target.name}.`;
        },
      },
      {
        label: "Ignore it",
        hint: "Costs goodwill",
        resolve: (st) => {
          changeGoodwill(st, target, attitude(target) === "Friendly" || attitude(target) === "Allied" ? -14 : -8, "you ignored their call");
          return `You ignored ${target.name}.`;
        },
      },
    ],
  });
}

export function raidWarning(state, party) {
  const base = baseById(state, party.target.baseId);
  const f = factionById(state, party.owner);
  if (!base || !f) return;
  f.known = true; // close enough to count: the lookouts know whose people these are
  const caught = party.surprise || ""; // watch.js surpriseAt: an unwatched night (set at the walls, parties.js)
  const def = baseDefense(state, base, !!caught);
  // What "Prepare defenses" does, with the real numbers (baseDefense: non-guards count 1.3 instead of 0.8).
  const wasAlert = base.alert;
  base.alert = true;
  const prepared = baseDefense(state, base);
  base.alert = wasAlert;
  const force = raidForce(f, party.strength);
  // Tribute is a share of the food on hand when it is paid, and never more than there is.
  const tributeNow = () => ({ food: Math.min(Math.floor(base.stock.food || 0), Math.ceil((base.stock.food || 0) * 0.3)), ammo: 30 });
  addCard(state, {
    title: `Raiders heading for ${base.name}`,
    text: `${caught ? `${caught}: the raiders were over the wall before anyone woke. Until they are beaten off the walls do not count, and everyone but the guards fights half-asleep (${SURPRISE.ASLEEP}× their combat power instead of 0.8×) unless you rouse them (Prepare defenses). ` : ""}${razeChance(state, f, base.tile) >= 0.15 ? `${f.name} burn what they cannot hold: if they overrun ${base.name} they may raze it. ` : ""}Lookouts spot about ${force.count} ${f.name} fighter${force.count === 1 ? "" : "s"} on the way (strength about ${Math.round(party.strength)}${(party.esc || 1) > 1.01 ? `, ${Math.round(((party.esc || 1) - 1) * 100)}% more than they would have sent before you beat them off` : ""}). ${party.watchSaw ? `${party.watchSaw.trim()} ` : ""}${party.siege ? `${kitText(party.siege)} ` : ""}${raidWarLine(state, party)}Current defense: ${Math.round(def)}. Held at ${RAIDS.HOLD}× their strength (walls, a watchtower, the gate and the trench add to it), a break-in from ${RAIDS.BREAK}× (barricades, sandbags, wire and the buildings help push one back); the longer they stay at the walls, the more they smash.`,
    choices: [
      { label: "Prepare defenses", hint: `Everyone at the base takes a post: non-guards count 1.3× their combat power instead of 0.8× (guards stay at 1.5×). Defense ${Math.round(def)} → ${Math.round(prepared)}. Building and repairs stop here until the raid is over`, resolve: (st) => { base.alert = true; return `${base.name} prepares for the attack.`; } },
      {
        label: "Pay tribute (30% of the food, 30 ammo)",
        hint: `About ${tributeNow().food} food right now. They turn back and goodwill rises by ${RAIDS.TRIBUTE_GW}${isAggressiveType(f) ? `, but it fades again (${RAIDS.TRIBUTE_FADE} a day): they will be back` : ""}`,
        disabled: (st) => totalRounds(base.stock) < 30 || !st.parties.includes(party),
        resolve: (st) => {
          if (!st.parties.includes(party)) return "The raiders are already gone.";
          if (totalRounds(base.stock) < 30) return `${base.name} no longer has 30 ammo to offer. The raiders keep coming.`;
          const t = tributeNow();
          base.stock.food = Math.max(0, (base.stock.food || 0) - t.food);
          payAmmo(st, base, t.ammo); // ammo.js: the rounds its guns need least
          changeGoodwill(st, f, RAIDS.TRIBUTE_GW, "tribute");
          if (isAggressiveType(f)) f.boughtGw = (f.boughtGw || 0) + RAIDS.TRIBUTE_GW; // fades again (factionsDaily)
          party.returning = true;
          base.alert = false; // the raid is off: the base stands down
          return `${f.name} took the tribute (${t.food} food, ${t.ammo} ammo) and turned back.`;
        },
      },
      {
        label: "Defend in person (tactical)",
        hint: `Fight the ${force.count} attacker${force.count === 1 ? "" : "s"} yourself with the people at ${base.name} (${atBase(state, base.id).length} there; the best 8 take the field). Win and the raid is broken; lose and they break in and take what they want`,
        disabled: (st) => !atBase(st, base.id).length || !st.parties.includes(party),
        resolve: (st) => defendInPerson(st, party),
      },
      retreatChoice(state, base, party, f),
      { label: "Hold as you are", resolve: () => "You wait." },
    ],
  });
}

// A raid in a war with you (playerwars.js) or with bloc members along (blocs.js): a line for the warning card.
function raidWarLine(state, party) {
  const w = party.pwarId != null ? pwarById(state, party.pwarId) : null;
  const along = (party.joint || []).map((id) => factionById(state, id)).filter(Boolean).map((x) => (x.known ? x.name : "another group"));
  return `${w ? `This is their war on you (their goal: ${goalText(state, w)})${party.siegeLen ? `: a siege, ${party.siegeLen} hours at the walls unless you drive them off sooner` : ""}. ` : ""}${along.length ? `Fighters from ${along.join(" and ")} march with them. ` : ""}`;
}

// "Retreat": everyone at the base leaves before the raid gets there (conquest.js retreatFrom); the raiders walk in
// and keep it. To your nearest other base, or onto the road when this is the last one.
function retreatChoice(state, base, party, f) {
  const to = nearestOtherBase(state, base);
  const n = atBase(state, base.id).length;
  return {
    label: to ? `Retreat to ${to.name}` : `Abandon ${base.name} and take to the road`,
    hint: `Everyone at ${base.name} (${n}) leaves now with what they can carry (water, food, scrap, ammo, meds; a vehicle if one is parked there)${to ? ` and walks to ${to.name}, ${state.grid.distance(to.tile, base.tile)} tiles away` : ": you have no other base, so they become a team on the road that has to found a new base or take this one back"}. ${f.name} take ${base.name} without a fight, with what is left in it. Nobody is hurt here; you can try to take it back later (Assault their base).`,
    retreat: true,
    disabled: (st) => !st.bases.includes(base) || !atBase(st, base.id).length || !st.parties.includes(party),
    resolve: (st) => {
      if (!st.parties.includes(party)) return "The raiders are already gone.";
      return retreatFrom(st, base, party);
    },
  };
}
