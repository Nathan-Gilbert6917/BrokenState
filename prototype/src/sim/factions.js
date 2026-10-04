// AI groups: creation, daily behaviour (growth, expansion, raids, convoys, attitude drift) and attacks.
import { FACTION_TYPES, FACTION_COLORS, GEAR } from "./data.js";
import {
  newId, log, addCard, day, hub, atBase, combatPower, hurt, playerStrength,
  factionById, baseById, survivorById, makeSurvivor, RADIO_RANGE,
} from "./world.js";
import { spawnAiParty, sendHelpSquad, removeParty, awaitOrders, tileLabel } from "./parties.js";
import { baseWalls, count } from "./buildings.js";
import { radioBasesInRange, removeBase } from "./world.js";
import { defendInPerson, raidForce } from "./conflicts.js";
import { makeCandidate, offerRecruits } from "./recruits.js";

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
    // Groups start outside the cities, spread apart, and within reach of the hub (8–30 tiles) when there is room.
    const sites = state.tiles.filter((t) => t.loc && t.loc.type !== "city" && t.loc.zone !== "urban" && g.distance(t.id, hubTile) >= 8 &&
      state.factions.every((f) => f.bases.every((b) => g.distance(b, t.id) >= 8)));
    if (!sites.length) return;
    const reach = sites.filter((t) => g.distance(t.id, hubTile) <= 30);
    const pool = reach.length ? reach : sites;
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
      if (s && s.alive && s.location.kind === "route") s.location = { kind: "base", baseId: hub(state).id };
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

export function factionsDaily(state) {
  const rng = state.rng;
  const today = day(state);
  for (const f of state.factions) {
    if (!f.alive) continue;
    const def = FACTION_TYPES[f.type];
    // Food and growth.
    f.stock.food += f.pop * (0.88 + 0.25 * def.food) - f.pop;
    if (f.stock.food > f.pop * 4 && f.pop < 50 && rng.chance(0.25)) f.pop += 1;
    if (f.stock.food < 0) {
      f.stock.food = 0;
      if (rng.chance(0.35)) f.pop -= 1;
    }
    f.stock.ammo = Math.min(f.pop * 30, f.stock.ammo + f.pop * 0.3 * def.arms);
    f.stock.scrap = Math.min(f.pop * 10, f.stock.scrap + f.pop * 0.2);
    f.stock.fuel = Math.min(f.pop * 3, f.stock.fuel + f.pop * 0.04); // fuel is scarce (economy rework)
    f.stock.meds = Math.min(f.pop * 3, f.stock.meds + f.pop * 0.04);

    // Expansion: claim a nearby site.
    if (f.bases.length < 4 && rng.chance(def.expand * (f.pop / 18))) {
      const g = state.grid;
      const cands = [];
      for (const b of f.bases) for (const id of g.within(b, 6)) {
        const t = state.tiles[id];
        if (t.loc && t.loc.type !== "city" && (t.owner == null) && !state.bases.some((pb) => pb.tile === id) &&
          state.factions.every((o) => !o.bases.includes(id))) cands.push(t);
      }
      if (cands.length) {
        const t = rng.pick(cands);
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
    }
    if (state.routes.some((r) => r.active && r.factionId === f.id)) changeGoodwill(state, f, 0.3);

    // Raids by aggressive groups.
    f.raidCooldown -= 1;
    if (def.raid > 0 && f.raidCooldown <= 0 && f.pop >= 8 && rng.chance(def.raid * 1.5)) {
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
  clearStaleAlerts(state);
}

// "Prepare defenses" lasts until that raid is resolved. If the raid never arrives (bought off, broken on the
// road, its group gone), the base stands down.
export function clearStaleAlerts(state) {
  for (const b of state.bases) {
    if (!b.alert) continue;
    const coming = state.parties.some((p) => p.kind === "raid" && !p.returning && p.target && p.target.kind === "player" && p.target.baseId === b.id);
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
      const d = g.distance(origin, b.tile);
      if (d > 20) continue;
      const def = baseDefense(state, b);
      targets.push({ kind: "player", baseId: b.id, tile: b.tile, w: 5 / (1 + def / 25) });
    }
  }
  for (const o of state.factions) {
    if (!o.alive || o === f) continue;
    for (const b of o.bases) {
      if (g.distance(origin, b) > 14) continue;
      targets.push({ kind: "faction", factionId: o.id, tile: b, w: o.type === "commune" || o.type === "traders" ? 1.2 : 0.6 });
    }
  }
  if (!targets.length) return;
  const tgt = rng.weighted(targets, (t) => t.w);
  const raidStrength = Math.max(4, strength(f) * rng.range(0.25, 0.4));
  spawnAiParty(state, f, "raid", origin, tgt.tile, { strength: raidStrength, target: tgt });
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
  if (!base || !f) return;
  f.known = true; // they are at your walls: you know who they are
  const beaten = opts.beaten || null;
  const people = beaten ? [] : atBase(state, base.id);
  const def = baseDefense(state, base);
  const att = party.strength;
  if (!beaten) base.stock.ammo = Math.max(0, (base.stock.ammo || 0) - people.length * 3);
  const ratio = beaten ? (beaten === "broken" ? 1 : 0) : def / att;
  if (ratio >= 1.2) {
    state.stats.raidsRepelled += 1;
    log(state, `${base.name} drove off the ${f.name} raid.`, "good");
    if (people.length && rng.chance(0.4)) hurt(state, rng.pick(people), rng.int(10, 30), base.tile, `defending ${base.name}`);
    f.pop = Math.max(0, f.pop - rng.int(1, 3));
  } else if (ratio >= 0.8) {
    log(state, `${f.name} broke into ${base.name} before being pushed out. Supplies were stolen.`, "danger");
    steal(base.stock, count(base, "storehouse") ? 0.1 : 0.2);
    for (let i = 0; i < 2 && people.length; i++) hurt(state, rng.pick(people), rng.int(15, 45), base.tile, `defending ${base.name}`);
    f.pop = Math.max(0, f.pop - 1);
  } else {
    log(state, `${f.name} overran ${base.name}.`, "death");
    steal(base.stock, count(base, "storehouse") ? 0.25 : 0.5);
    for (let i = 0; i < 3 && people.length; i++) hurt(state, rng.pick(people), rng.int(30, 70), base.tile, `when ${base.name} was overrun`);
    if (base.type === "outpost") {
      // Survivors who live flee to the hub; the outpost is lost (world.removeBase: vehicles left behind,
      // stations cleared, supply runs paused, and the log says what went with it).
      removeBase(state, base, "has been lost");
    }
  }
  base.alert = false;
}

function steal(stock, frac) {
  for (const k of Object.keys(stock)) stock[k] = Math.floor((stock[k] || 0) * (1 - frac));
}

export function resolveRaidOnFaction(state, party, helpers) {
  const rng = state.rng;
  const target = factionById(state, party.target.factionId);
  const attacker = typeof party.owner === "number" ? factionById(state, party.owner) : null;
  if (!target || !target.alive) return;
  const helpPower = helpers.reduce((s, h) => s + h, 0);
  const def = 8 + strength(target) * 0.8 + helpPower;
  const att = party.strength;
  // Only report fights you could know about: raids on groups you know, anything you can see. Groups you have not
  // met are not named.
  const who = attacker ? knownName(attacker) : "a horde";
  const whom = knownName(target, `the people at ${tileLabel(state, party.target.tile)}`);
  const report = state.live.has(party.target.tile) || (attacker && target.known);
  if (att > def * 1.1) {
    const loss = Math.ceil(target.pop * rng.range(0.2, 0.35));
    target.pop -= loss;
    for (const k of Object.keys(target.stock)) target.stock[k] *= 0.6;
    if (target.bases.length > 1 && rng.chance(0.5)) {
      const lost = party.target.tile;
      target.bases = target.bases.filter((b) => b !== lost);
      if (attacker && attacker.bases.length < 4 && rng.chance(0.5)) attacker.bases.push(lost);
      recomputeOwnership(state); // a base changed hands: the land around it follows at once
    }
    if (report) log(state, `${who[0].toUpperCase() + who.slice(1)} hit ${whom} hard (${loss} dead).`, "danger");
    if (target.pop <= 2) collapseFaction(state, target);
    return false;
  }
  target.pop = Math.max(1, target.pop - rng.int(0, 2));
  if (attacker) attacker.pop = Math.max(0, attacker.pop - rng.int(1, 3));
  if (report) log(state, `${whom[0].toUpperCase() + whom.slice(1)} held off ${who}.`, "info");
  return true;
}

export function collapseFaction(state, f) {
  if (!f.alive) return;
  f.alive = false;
  f.bases = [];
  f.pact = null;
  if (f.known) log(state, `${f.name} has collapsed.`, "danger");
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
  if (state.rng.chance(0.6)) {
    const n = state.rng.int(1, 3);
    const list = Array.from({ length: n }, () => makeCandidate(state, { quality: 0.9, minHealth: 45 }));
    offerRecruits(state, list, {
      source: "refugees", baseId: hub(state).id, title: "Refugees at the gate",
      intro: `Survivors from ${knownName(f, "a group that fell apart out in the dead lands")} have reached ${hub(state).name}. They ask to join you.`,
    });
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
    text: `Lookouts spot about ${force.count} ${f.name} fighter${force.count === 1 ? "" : "s"} on the way (strength about ${Math.round(party.strength)}). Current defense: ${Math.round(def)}.`,
    choices: [
      { label: "Prepare defenses", hint: `Everyone at the base takes a post: non-guards count 1.3× their combat power instead of 0.8× (guards stay at 1.5×). Defense ${Math.round(def)} → ${Math.round(prepared)}`, resolve: (st) => { base.alert = true; return `${base.name} prepares for the attack.`; } },
      {
        label: "Pay tribute (30% of the food, 30 ammo)",
        hint: `About ${tributeNow().food} food right now. They turn back and goodwill rises a little`,
        disabled: (st) => (base.stock.ammo || 0) < 30 || !st.parties.includes(party),
        resolve: (st) => {
          if (!st.parties.includes(party)) return "The raiders are already gone.";
          if ((base.stock.ammo || 0) < 30) return `${base.name} no longer has 30 ammo to offer. The raiders keep coming.`;
          const t = tributeNow();
          base.stock.food = Math.max(0, (base.stock.food || 0) - t.food);
          base.stock.ammo -= t.ammo;
          changeGoodwill(st, f, 6, "tribute");
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
      { label: "Hold as you are", resolve: () => "You wait." },
    ],
  });
}
