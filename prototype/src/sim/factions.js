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
//   aggressive group within 15 tiles (50%). A winning raid between groups takes the base 80% of the time for an
//   aggressive attacker (50% otherwise), and they carry home half of the 40% of the stores the defenders lose.
// - When fewer than 2 aggressive groups are left hostile to you (from day 60), a new gang from beyond the border
//   settles 12–30 tiles from your hub (2% a day): 12–18 people, hostile.
import { FACTION_TYPES, FACTION_COLORS, GEAR } from "./data.js";
import {
  newId, log, addCard, day, hub, atBase, combatPower, hurt, playerStrength,
  factionById, baseById, survivorById, makeSurvivor, RADIO_RANGE, supplyValue,
} from "./world.js";
import { spawnAiParty, sendHelpSquad, removeParty, awaitOrders, tileLabel } from "./parties.js";
import { baseWalls, count } from "./buildings.js";
import { radioBasesInRange, removeBase } from "./world.js";
import { defendInPerson, raidForce } from "./conflicts.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { resolveWarRaid, warRaidOnPlayer, raidWeight, raidSoured, reservedForYou } from "./diplomacy.js";
import { allianceRaidHelp } from "./alliance.js";
import { aiScavDaily, FACTION_MAKE } from "./aiscav.js";
import { outsiderRaidOn } from "./visitors.js";
import { worldScale, sizeDef, worldSizeOf } from "./worldsize.js";
import { raidDamage, raidReportCard, RAID_DAMAGE } from "./breakdowns.js";
import { occupyPlayerBase, retreatFrom, nearestOtherBase, CONQUEST, ensureConquest } from "./conquest.js";
import { controlledLand, ALLIANCE } from "./alliance.js";

export const RAIDS = {
  REACH: 30, FACTION_REACH: 14, SIZE: [0.6, 1.0], CAP: 1.0, MIN: 4, ESCALATE: 0.25, ESC_MAX: 2,
  PLAYER_W: 2.5, GREED: 1500, LAND: 0.2, GRUDGE: 0.5, GRUDGE_MAX: 4, GRUDGE_FADE: 0.01, SIZE_REF: 35, DIST: 12,
  HOLD: 1.2, BREAK: 0.8, SIEGE_HOURS: 8, PACE: 1.2, PACE_MAX: 4, TRIBUTE_GW: 6, TRIBUTE_FADE: 0.5,
  PROVOKED: { military: 0.03, fortress: 0.02, traders: 0.01, commune: 0.01 },
  EXPAND_AGG: 0.02, EXPAND_RANGE: 7, KEEP_CLEAR: 3, BASES_AGG: 6, BASES: 4, HEIR_RANGE: 15, HEIR_CHANCE: 0.5,
  TAKE_BASE_AGG: 0.8, MIN_AGG: 2, NEW_GANG_FROM: 60, NEW_GANG: 0.02, RECRUIT: 0.12, RECRUIT_BASE: 0.02, RECRUIT_UNTIL: 45, COOL_OFF: 0.1,
  // Keeping a base won in a raid (keepChance): by type, × nearness to their own bases (1 within KEEP_NEAR tiles,
  // falling to 0.4 at KEEP_FAR), × richness (0.8 + stock value / 2000, at most 1.4); none beyond maxBases. A base
  // of yours: the hub × KEEP_HUB. A clearly outmatched group (raid ≥ ABANDON × its defence) may give up a base
  // that is not its main one (ABANDON_CHANCE) and fall back to the others.
  KEEP: { raider: 0.8, expansionist: 0.9, zealot: 0.7, military: 0.55, fortress: 0.5, traders: 0.3, commune: 0.3 },
  KEEP_NEAR: 7, KEEP_FAR: 25, KEEP_HUB: 0.35, ABANDON: 1.6, ABANDON_CHANCE: 0.5,
  // No new gang once the coalition holds NEW_GANG_LAND of the land (so a late gang never blocks a coalition close to
  // winning), and at most NEW_GANG_MAX of them in a run.
  NEW_GANG_LAND: 0.4, NEW_GANG_MAX: 3,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const PREFERRED_SITES = {
  raider: ["quarry", "factory", "prison", "gas", "truckstop", "motel", "autoshop", "town"],
  expansionist: ["town", "airport", "factory", "police"],
  zealot: ["church", "school", "univ", "hospital", "town"],
  military: ["military", "airport", "police", "ranger"],
  fortress: ["prison", "dam", "ranch", "town"],
  traders: ["town", "gas", "truckstop", "grocery", "mall"],
  commune: ["farm", "ranch", "feedstore", "town"],
};

export function createFactions(state, count) {
  const rng = state.rng;
  const g = state.grid;
  const hubTile = hub(state).tile;
  const types = ["raider", rng.pick(["military", "fortress"]), rng.pick(["traders", "commune"])];
  const all = Object.keys(FACTION_TYPES);
  while (types.length < count) types.push(rng.pick(all));
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
    const nearCap = sizeDef(worldSizeOf(state)).nearGroups;
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
      stock: { food: pop * 6, ammo: pop * 10 * def.arms, fuel: pop * 1, meds: pop, parts: 2, scrap: pop * 3, preserved: Math.round(pop * 0.5), jars: 0 }, // preserved / jars: storage.js
      lootedGear: [], raidCooldown: rng.int(4, 10),
    });
  });
}

export const strength = (f) => f.pop * FACTION_TYPES[f.type].arms;
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
  return clamp((RAIDS.KEEP[f.type] ?? 0.5) * near * rich, 0, 0.95);
}

export function factionsDaily(state) {
  const rng = state.rng;
  const today = day(state);
  for (const f of state.factions) {
    if (!f.alive) continue;
    const def = FACTION_TYPES[f.type];
    // Food and growth.
    // Their fields and workshops: food a little short of what they eat for the less farming types (the rest from
    // the sites they strip, aiscav.js), and FACTION_MAKE of the old ammo, scrap, fuel and meds made from nothing.
    const off = !!state.aiScavOff; // test switch (tools/depletetest.js): the old economy, no scavenging groups
    f.stock.food += f.pop * ((off ? 0.88 : 0.86) + 0.25 * def.food) - f.pop;
    if (f.stock.food > f.pop * 4 && f.pop < 50 && rng.chance(0.25)) f.pop += 1;
    // Drifters, deserters and the desperate join the strong: an aggressive group with food on hand recruits.
    else if (isAggressiveType(f) && f.pop < RAIDS.RECRUIT_UNTIL && f.stock.food >= f.pop * 2 && rng.chance(RAIDS.RECRUIT + RAIDS.RECRUIT_BASE * f.bases.length)) f.pop += 1;
    if (f.stock.food < 0) {
      f.stock.food = 0;
      if (rng.chance(0.35)) f.pop -= 1;
    }
    const mk = off ? 1 : FACTION_MAKE;
    f.stock.ammo = Math.min(f.pop * 30, f.stock.ammo + f.pop * 0.3 * def.arms * mk);
    f.stock.scrap = Math.min(f.pop * 10, f.stock.scrap + f.pop * 0.2 * mk);
    f.stock.fuel = Math.min(f.pop * 3, f.stock.fuel + f.pop * 0.04 * mk); // fuel is scarce (economy rework)
    f.stock.meds = Math.min(f.pop * 3, f.stock.meds + f.pop * 0.04 * mk);

    // Expansion: claim a nearby site. Aggressive groups push out more, toward rich sites and toward you.
    const agg = isAggressiveType(f);
    if (f.bases.length < maxBases(f) && rng.chance((def.expand + (agg ? RAIDS.EXPAND_AGG : 0)) * (f.pop / 18))) {
      const g = state.grid;
      const cands = [];
      const seen = new Set();
      for (const b of f.bases) for (const id of g.within(b, agg ? RAIDS.EXPAND_RANGE : 6)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const t = state.tiles[id];
        if (t.loc && t.loc.type !== "city" && (t.owner == null) && !state.bases.some((pb) => pb.tile === id) &&
          state.factions.every((o) => !o.bases.includes(id)) && !reservedForYou(state, id) && // land left for your outpost after a peace (diplomacy.js)
          !(agg && state.bases.some((pb) => g.distance(pb.tile, id) <= RAIDS.KEEP_CLEAR))) cands.push(t);
      }
      if (cands.length) {
        let t;
        if (agg) {
          const toYou = (id) => { let d = Infinity; for (const pb of state.bases) d = Math.min(d, g.distance(pb.tile, id)); return d; };
          t = rng.weighted(cands, (c) => (0.4 + (c.loot || 0)) * (1 + 2 / (1 + toYou(c.id) / 6)));
        } else t = rng.pick(cands);
        f.bases.push(t.id);
        if (state.knowledge[t.id] && state.live.has(t.id)) log(state, `${knownName(f, "An unknown group")} has taken over ${t.loc.name}.`, "danger");
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

    // Tribute buys an aggressive group off only for a while; grudges fade slowly.
    if (f.boughtGw > 0) {
      const x = Math.min(RAIDS.TRIBUTE_FADE, f.boughtGw);
      f.boughtGw -= x;
      changeGoodwill(state, f, -x, "the tribute is spent");
    }
    if (f.grudge > 0) f.grudge = Math.max(0, f.grudge * (1 - RAIDS.GRUDGE_FADE) - 0.001);

    // Raids by aggressive groups (and by peaceful ones you provoked into hostility: only on you, and rarely).
    f.raidCooldown -= 1;
    const raidRate = def.raid > 0 ? def.raid : attitude(f) === "Hostile" ? RAIDS.PROVOKED[f.type] || 0 : 0;
    if (raidRate > 0 && f.raidCooldown <= 0 && f.pop >= 8 && rng.chance(raidRate * 1.5)) {
      launchRaid(state, f);
      f.raidCooldown = rng.int(8, 16);
    }

    // Trade convoys between friendly groups make the world feel alive.
    if ((f.type === "traders" || f.type === "commune" || f.type === "fortress") && rng.chance(0.15)) {
      const partners = state.factions.filter((o) => o.alive && o !== f && !isAggressiveType(o));
      if (partners.length) {
        const to = rng.pick(partners);
        spawnAiParty(state, f, "convoy", f.bases[0], to.bases[0], { strength: Math.max(2, f.pop * 0.1), targetFaction: to.id });
      }
    }

    if (f.pop <= 2) collapseFaction(state, f);
  }
  newGangs(state);
  aiScavDaily(state); // aiscav.js: scavenging parties out, sites in their own land stripped
  clearStaleAlerts(state);
}

// The state is never empty of predators for long: with fewer than 2 hostile aggressive groups (from day 60), a gang
// from beyond the border settles a free site 12–30 tiles from your hub (2% a day): 12–18 people, hostile.
function newGangs(state) {
  if (day(state) < RAIDS.NEW_GANG_FROM || state.noNewGangs) return; // noNewGangs: test switch
  if (state.factions.filter((f) => f.alive && isAggressiveType(f) && attitude(f) === "Hostile").length >= RAIDS.MIN_AGG) return;
  const rng = state.rng;
  if (!rng.chance(RAIDS.NEW_GANG)) return;
  const g = state.grid;
  const h = hub(state);
  if (!h) return;
  // The coalition close to winning: the border stays quiet (and never more than NEW_GANG_MAX new gangs a run).
  if ((state.stats.newGangs || 0) >= RAIDS.NEW_GANG_MAX || controlledLand(state).pct >= RAIDS.NEW_GANG_LAND) return;
  const sites = state.tiles.filter((t) => t.loc && t.loc.type !== "city" && t.loc.zone !== "urban" && t.owner == null &&
    g.distance(t.id, h.tile) >= 12 && g.distance(t.id, h.tile) <= 30 && !t.hive &&
    state.bases.every((b) => g.distance(b.tile, t.id) >= 6) &&
    state.factions.every((f) => !f.alive || f.bases.every((b) => g.distance(b, t.id) >= 8)));
  if (!sites.length) return;
  const type = rng.pick(["raider", "raider", "zealot", "expansionist"]);
  const def = FACTION_TYPES[type];
  const site = rng.pick(sites);
  const used = new Set(state.factions.map((f) => f.name));
  const name = def.names.find((n) => !used.has(n)) || ["II", "III", "IV", "V", "VI"].map((n) => `${def.names[0]} ${n}`).find((n) => !used.has(n)) || `${def.names[0]} ${state.factions.length}`;
  const pop = rng.int(12, 18);
  const f = {
    id: newId(), name, type, color: FACTION_COLORS[state.factions.length % FACTION_COLORS.length],
    bases: [site.id], pop, alive: true, known: false,
    goodwill: Math.min(-45, def.goodwill - rng.int(0, 10)), lastDiplomacy: 0, pact: null,
    stock: { food: pop * 6, ammo: pop * 10 * def.arms, fuel: pop * 1, meds: pop, parts: 2, scrap: pop * 3, preserved: Math.round(pop * 0.5), jars: 0 },
    lootedGear: [], raidCooldown: rng.int(6, 12), arrived: day(state),
  };
  state.factions.push(f);
  recomputeOwnership(state);
  state.stats.newGangs = (state.stats.newGangs || 0) + 1;
  if (state.live.has(site.id)) log(state, `A new gang from beyond the border has moved into ${site.loc.name}.`, "danger");
  else log(state, `Travellers speak of a new gang settling somewhere ${dirFromHub(state, site.id)}.`, "danger");
}
function dirFromHub(state, tile) {
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
  if (attitude(f) === "Hostile") {
    for (const b of state.bases) {
      const from = nearestOwnBase(state, f, b.tile);
      const d = g.distance(from, b.tile);
      if (d > RAIDS.REACH) continue; // the same reach on every map size: on a bigger one the far groups must expand toward you first
      targets.push({ kind: "player", baseId: b.id, tile: b.tile, from, w: playerRaidWeight(state, f, b, d) });
    }
  }
  // Peaceful groups you provoked only come for you; aggressive ones raid their neighbours too.
  if (FACTION_TYPES[f.type].raid > 0) for (const o of state.factions) {
    if (!o.alive || o === f) continue;
    const rw = raidWeight(state, f, o); // diplomacy.js: never a pact partner or a fellow coalition member, war enemies first
    if (!rw) continue;
    for (const b of o.bases) {
      if (g.distance(origin, b) > RAIDS.FACTION_REACH) continue;
      targets.push({ kind: "faction", factionId: o.id, tile: b, w: (o.type === "commune" || o.type === "traders" ? 1.2 : 0.6) * rw });
    }
  }
  if (!targets.length) return;
  const tgt = rng.weighted(targets, (t) => t.w);
  if (tgt.kind === "player") {
    const base = baseById(state, tgt.baseId);
    const p = spawnAiParty(state, f, "raid", tgt.from, tgt.tile, { strength: raidSize(state, f, base), target: { kind: "player", baseId: tgt.baseId, tile: tgt.tile } });
    if (p) { p.esc = f.raidEsc || 1; f.raidedYou = day(state); } // the autopilot's grudge (autopilot.js conquest)
    return;
  }
  const raidStrength = Math.max(RAIDS.MIN, strength(f) * rng.range(0.25, 0.4));
  spawnAiParty(state, f, "raid", origin, tgt.tile, { strength: raidStrength, target: tgt });
}

// How much a group wants to hit one of your bases (see the header): greed, your land, their grudge, their size, distance.
export function playerRaidWeight(state, f, b, d) {
  const greed = clamp(supplyValue(b.stock) / RAIDS.GREED, 0.4, 3);
  const land = 1 + RAIDS.LAND * Math.max(0, state.bases.filter((x) => !x.captured).length - 1); // bases you took from groups (conquest.js) do not count: the spoils of war, not your sprawl
  const grudge = 1 + RAIDS.GRUDGE * Math.min(RAIDS.GRUDGE_MAX, f.grudge || 0);
  const size = clamp(strength(f) / RAIDS.SIZE_REF, 0.6, 2);
  return RAIDS.PLAYER_W * greed * land * grudge * size / (1 + d / RAIDS.DIST);
}

// The raid's strength: sized to the base's prepared defence (0.6–1.0 ×, × escalation), at most the whole group.
export function raidSize(state, f, base) {
  const was = base.alert;
  base.alert = true;
  const prepared = baseDefense(state, base);
  base.alert = was;
  const want = prepared * state.rng.range(RAIDS.SIZE[0], RAIDS.SIZE[1]) * (f.raidEsc || 1);
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

export function baseDefense(state, base) {
  const people = atBase(state, base.id);
  let d = baseWalls(base) * 2;
  for (const s of people) {
    const mult = s.role === "guard" ? 1.5 : base.alert ? 1.3 : 0.8;
    d += combatPower(s) * mult;
  }
  if ((base.stock.ammo || 0) < people.length * 3) d *= 0.7;
  return d;
}

// Called when a raid party reaches its target and the siege timer runs out.
// opts.beaten ("overrun" | "broken"): the defenders already fought this raid on the battle map and lost
// (conflicts.js). Then only the break-in is applied: no second fight by the numbers, no further injuries.
export function resolveRaidOnPlayer(state, party, opts = {}) {
  const rng = state.rng;
  const base = baseById(state, party.target.baseId);
  const f = factionById(state, party.owner);
  if (!base || !f) return null;
  f.known = true; // they are at your walls: you know who they are
  const beaten = opts.beaten || null;
  // Abandoned before they got here (Retreat on the warning card): they walk in and keep it (conquest.js).
  if (!beaten && base.abandoned != null && !atBase(state, base.id).length) {
    warRaidOnPlayer(state, party, false);
    raidWon(state, f);
    const occ = occupyPlayerBase(state, base, f, { garrison: raidForce(f, party.strength).count, retreated: true, outcome: "retreat" });
    return { outcome: "taken", text: occ ? `${f.name} moved into ${base.name}.` : "", dmg: null };
  }
  const people = beaten ? [] : atBase(state, base.id);
  const allies = beaten ? { power: 0, names: [] } : allianceRaidHelp(state, base, f); // alliance.js: coalition members send fighters
  const def = baseDefense(state, base) + allies.power;
  const att = party.strength;
  if (allies.names.length) log(state, `Fighters from ${allies.names.join(" and ")} came to help defend ${base.name}.`, "good");
  if (!beaten) base.stock.ammo = Math.max(0, (base.stock.ammo || 0) - people.length * 3);
  const ratio = beaten ? (beaten === "broken" ? 1 : 0) : def / att;
  const hours = beaten ? RAIDS.SIEGE_HOURS : Math.max(1, party.siegeHours || RAIDS.SIEGE_HOURS);
  const before = { ...base.stock };
  const hurtWho = new Map();
  const wound = (s, amt, why) => { hurt(state, s, amt, base.tile, why); hurtWho.set(s.id, `${s.name.split(" ")[0]}${s.alive ? "" : " (killed)"}`); };
  warRaidOnPlayer(state, party, ratio >= RAIDS.HOLD); // diplomacy.js: a war raid on your base counts for the war
  let outcome, head, keep = false;
  if (ratio >= RAIDS.HOLD) {
    outcome = "held";
    state.stats.raidsRepelled += 1;
    head = `${base.name} drove off the ${f.name} raid after ${hours} hour${hours === 1 ? "" : "s"} at the walls.`;
    log(state, `${base.name} drove off the ${f.name} raid.`, "good");
    if (people.length && rng.chance(0.4)) wound(rng.pick(people), rng.int(10, 30), `defending ${base.name}`);
    f.pop = Math.max(0, f.pop - rng.int(1, 3));
    raidRepelled(state, f);
  } else if (ratio >= RAIDS.BREAK) {
    outcome = "broken";
    head = `${f.name} broke into ${base.name} before being pushed out.`;
    log(state, `${f.name} broke into ${base.name} before being pushed out. Supplies were stolen.`, "danger");
    steal(base.stock, count(base, "storehouse") ? 0.1 : 0.2, f.stock);
    for (let i = 0; i < 2 && people.length; i++) wound(rng.pick(people), rng.int(15, 45), `defending ${base.name}`);
    f.pop = Math.max(0, f.pop - 1);
    raidWon(state, f);
    // An outpost they broke into may be kept (a third as likely as after an overrun): the people there leave.
    if (base.type === "outpost" && rng.chance(keepChance(state, f, base.tile, supplyValue(base.stock)) * CONQUEST.BREAKIN_KEEP)) keep = true;
  } else {
    outcome = "overrun";
    head = `${f.name} overran ${base.name}.`;
    log(state, `${f.name} overran ${base.name}.`, "death");
    steal(base.stock, count(base, "storehouse") ? 0.25 : 0.5, f.stock);
    for (let i = 0; i < 3 && people.length; i++) wound(rng.pick(people), rng.int(30, 70), `when ${base.name} was overrun`);
    raidWon(state, f);
    // They may keep it (conquest.js: the people there walk to your nearest base; the hub's job moves there).
    keep = rng.chance(keepChance(state, f, base.tile, supplyValue(base.stock)) * (base.type === "hub" ? RAIDS.KEEP_HUB : 1));
    if (!keep && base.type === "outpost" && (people.length || beaten)) { // an empty one (land you hold, conquest.js) is looted and left standing
      // Survivors who live flee to the hub; the outpost is lost (world.removeBase: vehicles left behind,
      // stations cleared, supply runs paused, and the log says what went with it).
      removeBase(state, base, "has been lost");
    }
  }
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
  const text = [head, took ? `They took ${took}.` : "", hurtNames.length ? `Hurt: ${hurtNames.join(", ")}.` : "",
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
    if (into && k !== "water") into[k] = (into[k] || 0) + Math.max(0, (stock[k] || 0) - left);
    stock[k] = left;
  }
}
// "40 food, 12 ammo and 3 meds": what left the stock (the biggest losses first, at most four).
export function stolenText(before, after) {
  const lost = Object.keys(before).map((k) => [k, Math.floor((before[k] || 0) - (after[k] || 0))]).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const parts = lost.map(([k, q]) => `${q} ${k}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
}

export function resolveRaidOnFaction(state, party, helpers) {
  const rng = state.rng;
  const target = factionById(state, party.target.factionId);
  const attacker = typeof party.owner === "number" ? factionById(state, party.owner) : null;
  if (!target || !target.alive) return;
  // Trade prices remember it (valuation.js): raided lately, or a horde at their walls.
  target.hitDay = day(state);
  if (!attacker && !party.raidName) target.hordeHitDay = day(state);
  const helpPower = helpers.reduce((s, h) => s + h, 0);
  if (party.warId != null) { // diplomacy.js: raids in a war between groups, with their own odds and terms
    const held = resolveWarRaid(state, party, attacker, target, helpPower);
    if (target.pop <= 2) collapseFaction(state, target, attacker);
    return held;
  }
  raidSoured(state, attacker, target);
  const def = 8 + strength(target) * 0.8 + helpPower;
  const att = party.strength;
  // Only report fights you could know about: raids on groups you know, anything you can see. Groups you have not
  // met are not named.
  const who = attacker ? knownName(attacker) : party.raidName || "a horde"; // raidName: raiders from outside (visitors.js)
  const whom = knownName(target, `the people at ${tileLabel(state, party.target.tile)}`);
  const report = state.live.has(party.target.tile) || (attacker && target.known);
  // Clearly outmatched at a base that is not their main one: they may give it up and fall back to the others.
  if (att > def * RAIDS.ABANDON && target.bases.length > 1 && party.target.tile !== target.bases[0] && rng.chance(RAIDS.ABANDON_CHANCE)) {
    const lost = party.target.tile;
    target.bases = target.bases.filter((b) => b !== lost);
    for (const k of Object.keys(target.stock)) { const q = target.stock[k] * 0.1; target.stock[k] -= q; if (attacker) attacker.stock[k] = (attacker.stock[k] || 0) + q; }
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
    for (const k of Object.keys(target.stock)) {
      const lost = target.stock[k] * 0.4;
      target.stock[k] -= lost;
      if (attacker) attacker.stock[k] = (attacker.stock[k] || 0) + lost / 2; // half of it is carried home
    }
    if (target.bases.length > 1 && rng.chance(0.5)) {
      const lost = party.target.tile;
      target.bases = target.bases.filter((b) => b !== lost);
      target.lostBaseDay = day(state); // valuation.js: they want weapons and defences, and sell off fine things
      if (attacker && rng.chance(keepChance(state, attacker, lost))) attacker.bases.push(lost); // keepChance: type, distance, room (was 80% / 50%)
      recomputeOwnership(state); // a base changed hands: the land around it follows at once
    }
    if (report) log(state, `${who[0].toUpperCase() + who.slice(1)} hit ${whom} hard (${loss} dead).`, "danger");
    if (attacker && isAggressiveType(attacker) && rng.chance(0.5)) attacker.pop += 1; // a win draws fighters to them
    if (target.pop <= 2) collapseFaction(state, target, attacker);
    return false;
  }
  target.pop = Math.max(1, target.pop - rng.int(0, 2));
  if (attacker) attacker.pop = Math.max(0, attacker.pop - rng.int(1, 3));
  if (report) log(state, `${whom[0].toUpperCase() + whom.slice(1)} held off ${who}.`, "info");
  return true;
}

// by: the group whose raid finished them (it takes over what is left); otherwise the strongest aggressive group
// within 15 tiles may move in on the ruins (50%).
export function collapseFaction(state, f, by = null) {
  if (!f.alive) return;
  const ruins = [...f.bases];
  f.alive = false;
  f.bases = [];
  f.pact = null;
  if (f.known) log(state, `${f.name} has collapsed.`, "danger");
  takeOver(state, f, ruins, by);
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
  if (state.rng.chance(0.6) && hub(state)) {
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
        disabled: () => (h.stock.ammo || 0) < 40,
        resolve: (st) => {
          // Checked against what the hub holds now, not when the message came in.
          if ((h.stock.ammo || 0) < 40) return `${h.name} no longer has 40 ammo to spare.`;
          if (!st.parties.includes(party)) return `Too late: the fight at ${target.name} is already over.`;
          h.stock.ammo -= 40;
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
  const def = baseDefense(state, base);
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
    text: `Lookouts spot about ${force.count} ${f.name} fighter${force.count === 1 ? "" : "s"} on the way (strength about ${Math.round(party.strength)}${(party.esc || 1) > 1.01 ? `, ${Math.round(((party.esc || 1) - 1) * 100)}% more than they would have sent before you beat them off` : ""}). Current defense: ${Math.round(def)}. Held at ${RAIDS.HOLD}× their strength, a break-in from ${RAIDS.BREAK}×; the longer they stay at the walls, the more they smash.`,
    choices: [
      { label: "Prepare defenses", hint: `Everyone at the base takes a post: non-guards count 1.3× their combat power instead of 0.8× (guards stay at 1.5×). Defense ${Math.round(def)} → ${Math.round(prepared)}. Building and repairs stop here until the raid is over`, resolve: (st) => { base.alert = true; return `${base.name} prepares for the attack.`; } },
      {
        label: "Pay tribute (30% of the food, 30 ammo)",
        hint: `About ${tributeNow().food} food right now. They turn back and goodwill rises by ${RAIDS.TRIBUTE_GW}${isAggressiveType(f) ? `, but it fades again (${RAIDS.TRIBUTE_FADE} a day): they will be back` : ""}`,
        disabled: (st) => (base.stock.ammo || 0) < 30 || !st.parties.includes(party),
        resolve: (st) => {
          if (!st.parties.includes(party)) return "The raiders are already gone.";
          if ((base.stock.ammo || 0) < 30) return `${base.name} no longer has 30 ammo to offer. The raiders keep coming.`;
          const t = tributeNow();
          base.stock.food = Math.max(0, (base.stock.food || 0) - t.food);
          base.stock.ammo -= t.ammo;
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
