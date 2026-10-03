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
//
// Captured survivors get location { kind: "captive", factionId, tile, since }. They can be
// rescued (Rescue mission), ransomed (during a trade visit or at the gates), or released when
// goodwill is high. Over time they may escape, be recruited by their captors, or die.
import { TERRAIN, GEAR, SUPPLIES, FACTION_TYPES } from "./data.js";
import { stripAll } from "./inventory.js";
import {
  log, addCard, day, hub, skill, hurt, isNight, factionById, snapshot, makeSurvivor, combatPower, alive, survivorById,
} from "./world.js";
import {
  partyMembers, bestSkill, partyTile, tileLabel, partyCapacity, cargoLoad, unitsThatFit, wipeParty, awaitOrders,
  removeParty, startReturn, STANCES,
} from "./parties.js";
import { partyFuel, useFuel, partyVehicle } from "./vehicles.js";
import { attitude, changeGoodwill, isAggressiveType, collapseFaction } from "./factions.js";
import { perceptionChance } from "./markers.js";
import { registerCombatHandler, startCombat } from "./combat.js";

// ---------- small helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (c) => `${Math.round(c * 100)}%`;
const first = (s) => s.name.split(" ")[0];
const names = (list) => list.map(first).join(", ");
const skillChance = (s, dc) => clamp((s + 10 - dc + 1) / 10, 0.05, 0.95);

export const COOLDOWN_HOURS = 20; // a team sees at most one conflict per this many hours

const KIND_OF = { raider: "raiders", expansionist: "mixed", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "mixed", commune: "mixed" };
const NOUN_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "guards", traders: "guards", commune: "militia" };

export const CONFLICT_TYPES = {
  // forced: they found you first
  ambush:       { mode: "forced",   name: "Ambush" },
  roadblock:    { mode: "forced",   name: "Roadblock" },
  zealotpatrol: { mode: "forced",   name: "Zealot patrol" },
  checkpoint:   { mode: "forced",   name: "Checkpoint" },
  challenge:    { mode: "forced",   name: "Challenged" },
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

// Lazily register combat handlers (combat.js may still be initialising when this module loads).
let handlersReady = false;
function ensureHandlers() {
  if (handlersReady) return;
  handlersReady = true;
  registerCombatHandler("conflict", onConflictCombat);
  registerCombatHandler("rescue", onRescueCombat);
  registerCombatHandler("raidDefense", onRaidDefenseCombat);
}

function check(state, p, key, dc, bonus = 0) {
  const chance = skillChance(bestSkill(state, p, key) + bonus, dc);
  return state.rng.chance(chance);
}

function addCargo(state, p, key, qty) {
  const room = Math.max(0, partyCapacity(state, p) - cargoLoad(p.cargo));
  const take = Math.min(unitsThatFit(room, key), Math.max(0, Math.floor(qty)));
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + take;
  return take;
}

function teamPower(state, p) {
  return partyMembers(state, p).reduce((a, m) => a + combatPower(m), 0);
}

// Same maths as the quick resolver in combat.js, shown to the player as rough odds.
export function fightOdds(state, p, enemy, ambush) {
  const people = partyMembers(state, p);
  if (!people.length) return 0;
  let mine = teamPower(state, p) * ((p.supplies.ammo || 0) >= people.length * 3 ? 1 : 0.6);
  let theirs = enemy.count * enemy.power;
  if (ambush === "player") mine *= 1.4;
  if (ambush === "enemy") theirs *= 1.4;
  return clamp(0.5 + (mine / Math.max(0.1, theirs) - 1) * 0.6, 0.05, 0.95);
}

function enemyGroup(state, p, f, scale = 1) {
  const rng = state.rng;
  const n = partyMembers(state, p).length;
  if (!f) {
    const t = state.tiles[partyTile(p)];
    const count = Math.round((5 + t.infection * 14 + (isNight(state) ? 3 : 0)) * scale * rng.range(0.8, 1.25));
    return { kind: "zombies", count: Math.max(4, count), power: 1, name: "the dead" };
  }
  const def = FACTION_TYPES[f.type];
  let count = Math.round((n * rng.range(0.8, 1.5) + 1) * scale);
  count = clamp(count, 2, Math.max(2, Math.min(10, Math.floor(f.pop / 3))));
  return { kind: KIND_OF[f.type], count, power: Math.round((2.2 + def.arms * 1.6) * 10) / 10, factionId: f.id, name: `${f.name} ${NOUN_OF[f.type]}` };
}

function minBaseDist(state, f, tileId) {
  return Math.min(...f.bases.map((b) => state.grid.distance(b, tileId)));
}

// Pay a value from what the team carries (found cargo first). Returns the plan, or null if short.
export function payPlan(p, value) {
  const order = ["scrap", "parts", "ammo", "meds", "fuel", "food", "water"];
  const plan = {};
  let left = value;
  for (const pool of [p.cargo.supplies, p.supplies]) {
    for (const k of order) {
      if (left <= 0) break;
      const have = Math.floor(pool[k] || 0);
      if (have <= 0) continue;
      const q = Math.min(have, Math.ceil(left / SUPPLIES[k].value));
      if (q <= 0) continue;
      plan[k] = (plan[k] || 0) + q;
      left -= q * SUPPLIES[k].value;
    }
  }
  return left > 0 ? null : plan;
}
const planText = (plan) => Object.entries(plan).map(([k, q]) => `${q} ${k}`).join(", ");
function payFrom(p, plan, f) {
  for (const [k, q] of Object.entries(plan)) {
    const fromCargo = Math.min(q, Math.floor(p.cargo.supplies[k] || 0));
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) - fromCargo;
    p.supplies[k] = (p.supplies[k] || 0) - (q - fromCargo);
    if (f) f.stock[k] = (f.stock[k] || 0) + q;
  }
}
const carriedValue = (p) => Object.keys(SUPPLIES).reduce((a, k) => a + (Math.floor(p.supplies[k] || 0) + Math.floor(p.cargo.supplies[k] || 0)) * SUPPLIES[k].value, 0);

// Robbery: a share of everything carried goes to the faction (or is lost).
function rob(state, p, frac, f, takeGear = true, cargoOnly = false) {
  const taken = {};
  for (const pool of cargoOnly ? [p.cargo.supplies] : [p.supplies, p.cargo.supplies]) {
    for (const k of Object.keys(pool)) {
      const q = Math.floor((pool[k] || 0) * frac);
      if (q <= 0) continue;
      pool[k] -= q;
      taken[k] = (taken[k] || 0) + q;
      if (f) f.stock[k] = (f.stock[k] || 0) + q;
    }
  }
  const gear = takeGear ? p.cargo.gear.splice(0) : [];
  if (f) for (const g of gear) f.lootedGear.push(g.name);
  const parts = Object.entries(taken).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${k}`);
  if (gear.length) parts.push(...gear.map((g) => g.name));
  return parts.length ? parts.join(", ") : "nothing much";
}

function injure(state, p, min, max, cause) {
  const m = partyMembers(state, p);
  if (!m.length) return "";
  const v = state.rng.pick(m);
  hurt(state, v, state.rng.int(min, max), partyTile(p), cause);
  if (!partyMembers(state, p).length) wipeParty(state, p);
  return v.alive ? `${first(v)} was hurt.` : `${v.name} was killed.`;
}

function newRecruit(state, p) {
  const s = makeSurvivor(state, 0.85);
  s.location = { kind: "party", partyId: p.id };
  state.survivors.push(s);
  p.members.push(s.id);
  state.stats.peopleSaved += 1;
  stats(state).joined += 1;
  return s;
}

// ---------- captives ----------
export const isCaptive = (s) => s.alive && s.location && s.location.kind === "captive";
export const captivesOf = (state, factionId) => state.survivors.filter((s) => isCaptive(s) && s.location.factionId === factionId);
export const allCaptives = (state) => state.survivors.filter(isCaptive);

export function takeCaptive(state, s, f, p) {
  if (p) p.members = p.members.filter((id) => id !== s.id);
  // Everything on them is taken: worn, held, pockets and pack (inventory.js).
  for (const g of stripAll(s)) f.lootedGear.push(`${first(s)}'s ${g.name}`);
  s.station = null;
  s.location = { kind: "captive", factionId: f.id, tile: f.bases[0], since: state.hour };
  stats(state).captured += 1;
  log(state, `${s.name} was taken prisoner by ${f.name}.`, "danger");
}

function freeCaptive(state, s, p) {
  s.location = { kind: "party", partyId: p.id };
  if (!p.members.includes(s.id)) p.members.push(s.id);
  s.mood = Math.min(100, s.mood + 15);
  stats(state).rescued += 1;
}

function releaseHome(state, s) {
  s.location = { kind: "base", baseId: hub(state).id };
  s.role = "rest";
}

// If the whole team is gone (captured), the party ends: the vehicle is seized.
function endIfEmpty(state, p, f) {
  if (!state.parties.includes(p) || partyMembers(state, p).length) return false;
  const v = partyVehicle(state, p);
  if (v) {
    state.vehicles.splice(state.vehicles.indexOf(v), 1);
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
      return { rob: 0.7, capturePer: att === "Hostile" ? 0.5 : 0.3, text: `Zealots are harsh: they take most of what you carry, and each of you has a ${pct(att === "Hostile" ? 0.5 : 0.3)} chance of being dragged off to ${f.name}'s base.` };
    case "raider":
    case "expansionist": {
      const c = f.goodwill < -50 ? 0.35 : 0.15;
      return { rob: 0.5, captureOne: c, text: `They take about half of your supplies and cargo, and all carried gear. ${pct(c)} chance they keep one of you as a prisoner.` };
    }
    case "military":
    case "fortress": {
      const c = att === "Hostile" ? 0.25 : 0.05;
      return { rob: 0.3, captureOne: c, text: `They confiscate about a third of what you carry and any spare gear. ${pct(c)} chance they detain one of you.` };
    }
    default:
      return { rob: 0.2, captureOne: 0, text: "They take a fifth of your supplies as a toll and let you go." };
  }
}

function applySurrender(state, p, c, f) {
  const terms = surrenderTerms(state, f);
  const rng = state.rng;
  const lost = rob(state, p, terms.rob, f);
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
    if (d > 5) continue;
    const att = attitude(f);
    let w = att === "Hostile" ? 1 : isAggressiveType(f) ? 0.5 : (f.type === "military" || f.type === "fortress") ? 0.3 : 0.12;
    if (f.pact) w *= 0.5;
    w *= 1 - d / 6.5;
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
  if (isNight(state)) chance *= 1.25;
  chance *= { stealthy: 0.75, normal: 1, rushed: 1.2 }[p.stance] || 1;
  return { chance: Math.min(0.35, chance), sources };
}

// Chance that the team spots the other side first.
export function spotFirstChance(state, p) {
  const members = partyMembers(state, p);
  let c = perceptionChance(state, members) + 0.1;
  if (p.stance === "stealthy") c += 0.25;
  if (p.stance === "rushed") c -= 0.1;
  if (p.vehicle) c -= 0.1;
  if (isNight(state) && members.some((m) => m.traits.includes("nightowl") || (m.gear.tool && m.gear.tool.key === "nvg"))) c += 0.15;
  return clamp(c, 0.05, 0.9);
}

export function rollConflict(state, p, tileId) {
  if (p.owner !== "player" || p.kind === "convoy") return null;
  if (state.bases.some((b) => state.grid.distance(b.tile, tileId) <= 1)) return null;
  if (p.lastConflict != null && state.hour - p.lastConflict < COOLDOWN_HOURS) return null;
  const { chance, sources } = conflictChance(state, p, tileId);
  if (!sources.length || !state.rng.chance(chance)) return null;
  const src = state.rng.weighted(sources, (s) => s.w);
  const spotted = state.rng.chance(spotFirstChance(state, p));
  const card = src.zombies ? zombieEncounter(state, p, spotted) : factionEncounter(state, p, src.f, spotted, src.aiParty);
  if (!card) return null;
  p.lastConflict = state.hour;
  p.conflictCount = (p.conflictCount || 0) + 1;
  return card;
}

// Build a conflict of a given type for a party (also used by the test tools and the console).
export function triggerConflict(state, p, type, factionId) {
  const f = factionId != null ? factionById(state, factionId) : null;
  const def = CONFLICT_TYPES[type];
  if (!def) return null;
  let card;
  if (type === "surge") card = zombieEncounter(state, p, false);
  else if (type === "hordeattack") card = zombieEncounter(state, p, true, true);
  else {
    const g = f || state.factions.find((x) => x.alive);
    if (!g) return null;
    card = def.mode === "forced" ? forcedCard(state, p, makeConflict(state, p, type, g, enemyGroup(state, p, g))) : observedCard(state, p, observedConflict(state, p, g, type));
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

function halt(p) {
  if (p.phase !== "engaged") {
    p.conflictResume = p.phase === "back" ? "back" : "out";
    p.phase = "engaged";
  }
}
function resume(state, p) {
  if (!state.parties.includes(p)) return;
  if (p.phase === "engaged") p.phase = p.conflictResume || "out";
  delete p.conflictResume;
}

function forcedTypeFor(state, p, f) {
  const att = attitude(f);
  const t = state.tiles[partyTile(p)];
  if (f.type === "military" || f.type === "fortress") return att === "Allied" ? null : "checkpoint";
  if (f.type === "zealot") return "zealotpatrol";
  if (f.type === "raider" || f.type === "expansionist") {
    if (att !== "Hostile") return "roadblock";
    return t.road && state.rng.chance(0.5) ? "roadblock" : "ambush";
  }
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
  return forcedCard(state, p, makeConflict(state, p, type, f, enemyGroup(state, p, f, scale)));
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
  return makeConflict(state, p, type, f, enemyGroup(state, p, f, scale), extra);
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
    surge: `The dead pour out of the buildings around you: about ${n}, and more behind them. They have your scent.`,
  };
  const text = followUp ? c.followText : texts[c.type];
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
  return { ambush: 12, roadblock: 9, zealotpatrol: 11, checkpoint: 11, challenge: 9, surge: 10 }[c.type] ?? 11;
}
function runBonus(state, p) {
  let b = 0;
  if (p.vehicle && partyFuel(state, p) >= 2) b += state.tiles[partyTile(p)].road ? 4 : 3;
  if (isNight(state)) b += 1;
  if (partyMembers(state, p).length >= 4) b -= 1;
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
  return ({ Hostile: 14, Neutral: 10, Friendly: 7, Allied: 4 }[att]) + (f.type === "zealot" ? 2 : 0) + (c.type === "ambush" ? 1 : 0);
}
function talkSkill(state, p) {
  return Math.max(bestSkill(state, p, "speech"), bestSkill(state, p, "leadership") - 2);
}

function talkChoice(state, p, c, f) {
  const chance = skillChance(talkSkill(state, p), talkDc(f, c));
  const deal = (f.type === "traders" || f.type === "military" || f.type === "fortress" || f.type === "commune");
  return {
    label: c.type === "checkpoint" ? "Talk your way through" : "Talk them down",
    hint: `Speech check, ${pct(chance)} (they are ${attitude(f).toLowerCase()}). Success: you pass and goodwill rises a little${deal ? "; they may share news of the area" : ""}. Failure: goodwill drops and they get angrier (no second chance to talk)`,
    resolve: (st) => {
      if (st.rng.chance(chance)) {
        bump(st, "outcomes", "talk-ok");
        changeGoodwill(st, f, 3, "you talked it out");
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
      changeGoodwill(st, f, -3, "a bad conversation");
      const c2 = { ...c, noTalk: true, followText: `They are not buying it. ${f.name}'s ${NOUN_OF[f.type]} close in, angrier now. The price just went up.`, bribeMult: 1.5 };
      addCard(st, forcedCard(st, p, c2, true));
      return "";
    },
  };
}

function bribeValue(c, f) {
  return Math.round((15 + c.enemy.count * 6) * (f.type === "zealot" ? 1.5 : 1) * (c.bribeMult || 1));
}
function bribeChance(f) {
  return { zealot: 0.55, raider: 0.85, expansionist: 0.85 }[f.type] ?? 0.95;
}

function bribeChoice(state, p, c, f) {
  const value = bribeValue(c, f);
  const plan = payPlan(p, value);
  const chance = bribeChance(f);
  const toll = c.type === "roadblock";
  return {
    label: toll ? "Pay the toll" : c.type === "checkpoint" ? "Grease some palms" : "Offer them supplies",
    hint: plan ? `Costs ${planText(plan)} (goes to ${f.name}). ${chance >= 0.95 ? "They take it and let you pass" : `${pct(chance)} they take it and let you pass; otherwise they take it and attack anyway`}` : `You do not carry enough (needs about ${value} worth of goods)`,
    disabled: !plan,
    resolve: (st) => {
      const pl = payPlan(p, value);
      if (!pl) return "You do not have enough.";
      payFrom(p, pl, f);
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
  const chance = f.type === "zealot" ? 0.8 : 0.97;
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
    resolve: (st) => startFight(st, p, c, ambush, goodwillHit, ""),
  };
}

// Start a battle for a conflict. The handler applies the aftermath.
function startFight(state, p, c, ambush, goodwillHit, lead, extra = {}) {
  ensureHandlers();
  halt(p);
  bump(state, "outcomes", `fight-${c.type}`);
  const f = factionById(state, c.factionId);
  const enemy = extra.enemy || c.enemy;
  startCombat(state, {
    tile: partyTile(p), partyId: p.id,
    enemy: { kind: enemy.kind, count: enemy.count, power: enemy.power, factionId: enemy.factionId ?? (f ? f.id : undefined), name: enemy.name },
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
    resolve: (st) => startFight(st, p, c, "player", goodwillHit, "", { enemy }),
  };
}

function helpSideChoice(state, p, c, helped, hit, enemy) {
  const half = { ...enemy, count: Math.max(2, Math.round(enemy.count * 0.6)) };
  const odds = fightOdds(state, p, half, "player");
  return {
    label: `Help ${helped.name}`,
    hint: `Hit ${hit.name} from the flank while they are busy: about ${pct(odds)} to win. Goodwill +15 with ${helped.name}, -15 with ${hit.name}`,
    resolve: (st) => startFight(st, p, { ...c, factionId: hit.id, helpedId: helped.id }, "player", 15, "", { enemy: half, factionId: hit.id, helpedId: helped.id }),
  };
}

function distractChoice(state, p, c) {
  const fuel = partyFuel(state, p) >= 2;
  const ammo = (p.supplies.ammo || 0) >= 10;
  const chance = skillChance(bestSkill(state, p, "stealth") + (fuel ? 2 : 0), 10);
  return {
    label: fuel ? "Draw the dead off with a fire (2 fuel)" : "Draw the dead off with gunfire (10 ammo)",
    hint: `Stealth check, ${pct(chance)}. Success: the survivors escape (some may join you). Failure: the dead come for you instead`,
    disabled: !fuel && !ammo,
    resolve: (st) => {
      if (fuel) useFuel(st, p, 2);
      else p.supplies.ammo -= 10;
      if (st.rng.chance(chance)) {
        bump(st, "outcomes", "distract-ok");
        const victim = c.victimId ? factionById(st, c.victimId) : null;
        let text = "The dead turn toward the flames and the survivors break out.";
        if (victim) {
          changeGoodwill(st, victim, 10, "you saved their people");
          text += ` They are ${victim.name} people, and will remember this.`;
        } else if (st.rng.chance(0.5)) {
          const s = newRecruit(st, p);
          text += ` ${s.name} decides to come with you.`;
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
        const ammo = addCargo(st, p, "ammo", st.rng.int(15, 40));
        const food = addCargo(st, p, "food", st.rng.int(4, 10));
        if (f) { f.stock.ammo = Math.max(0, f.stock.ammo - ammo); f.stock.food = Math.max(0, f.stock.food - food); }
        resume(st, p);
        return `You crawl out with ${ammo} ammo and ${food} food. Nobody saw a thing.`;
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
      disabled: !plan,
      resolve: (st) => {
        const pl = payPlan(p, value);
        if (!pl) return "Not enough.";
        payFrom(p, pl, f);
        for (const s of held) freeCaptive(st, s, p);
        const fresh = [];
        for (let i = 0; i < (c.strangers || 0); i++) fresh.push(newRecruit(st, p));
        bump(st, "outcomes", "bought-prisoners");
        resume(st, p);
        return `Paid ${planText(pl)}. ${names([...held, ...fresh])} join the team.`;
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
      return `You take ${food} food and ${scrap} scrap. Nobody on the team meets anyone's eyes.`;
    },
  };
}

// ---------- combat aftermath ----------
function afterFight(state, p, c, text) {
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
  p.conflictResume = "out";
  addCard(state, {
    title: "After the fight", text, partyId: p.id, where: tileLabel(state, partyTile(p)),
    choices: [
      { label: `Continue to ${tileLabel(state, p.dest)}`, hint: "Carry on with the original trip", resolve: (st) => { resume(st, p); return ""; } },
      { label: "Return home", hint: "Head back to base with the wounded and whatever was won", resolve: (st) => { delete p.conflictResume; startReturn(st, p); return "The team heads home."; } },
      { label: "Stop and wait for orders", hint: "Choose what the team does next", resolve: (st) => { delete p.conflictResume; awaitOrders(st, p, ""); return ""; } },
    ],
  });
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
    if (f && f.pop <= 2) collapseFaction(state, f);
    return;
  }
  if (!p || !state.parties.includes(p)) return;
  if (result.outcome === "victory") {
    lines.push(`You won. ${result.enemiesKilled || "Several"} of ${c.enemy.name} are down.`);
    lines.push(...victoryRewards(state, p, c));
  } else if (result.outcome === "retreat") {
    const lost = cargoLoad(p.cargo) > 0 ? rob(state, p, 0.25, f, false, true) : "";
    lines.push(`You pulled back.${lost ? ` Some of the load was dropped: ${lost}.` : ""}`);
  } else {
    lines.push(`You lost the fight and scattered.`);
    if (f && c.enemy.kind !== "zombies") {
      const lost = rob(state, p, 0.4, f);
      lines.push(`They took ${lost}.`);
      const members = partyMembers(state, p);
      if (members.length && rng.chance(0.35)) {
        const s = rng.pick(members);
        takeCaptive(state, s, f, p);
        lines.push(`${s.name} was dragged off as a prisoner.`);
      }
    }
  }
  if (dead.length) lines.push(`Dead: ${dead.map((s) => s.name).join(", ")}.`);
  if (f && f.pop <= 2) collapseFaction(state, f);
  if (endIfEmpty(state, p, f)) {
    log(state, `${lines.join(" ")} Nobody from the team is free.`, "death");
    return;
  }
  const text = lines.join(" ");
  log(state, `Fight near ${tileLabel(state, partyTile(p))}: ${result.outcome}.`, result.outcome === "victory" ? "good" : "danger");
  afterFight(state, p, c, text);
}

function victoryRewards(state, p, c) {
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
    if (fresh.length) out.push(`${names(fresh)} ${fresh.length === 1 ? "asks" : "ask"} to come with you, and join the team.`);
    out.push(`The robbers' haul: ${addCargo(state, p, "food", rng.int(6, 14))} food, ${addCargo(state, p, "scrap", rng.int(4, 10))} scrap.`);
  } else if (c.type === "prisoners") {
    const held = (c.held || []).map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s));
    for (const s of held) freeCaptive(state, s, p);
    const fresh = [];
    for (let i = 0; i < (c.strangers || 0); i++) fresh.push(newRecruit(state, p));
    const all = [...held, ...fresh];
    if (all.length) out.push(`Freed: ${names(all)}. They join the team.`);
  } else if (c.type === "camp" || c.type === "ambush" || c.type === "roadblock" || c.type === "checkpoint" || c.type === "zealotpatrol" || c.type === "challenge") {
    out.push(`Taken from the bodies: ${addCargo(state, p, "ammo", rng.int(15, 45))} ammo, ${addCargo(state, p, "food", rng.int(2, 8))} food.`);
    if (rng.chance(0.3)) {
      const key = rng.pick(["pistol", "shotgun", "huntrifle", "vest"]);
      p.cargo.gear.push({ key, name: GEAR[key].name, quality: rng.pick([0.7, 0.85, 1]) });
      out.push(`Also a ${GEAR[key].name}.`);
    }
  } else if (c.type === "hordeattack") {
    const victim = c.victimId ? factionById(state, c.victimId) : null;
    if (victim) {
      changeGoodwill(state, victim, 12, "you saved their people");
      out.push(`The survivors are ${victim.name} people. They will remember this.`);
      if (rng.chance(0.3)) out.push(`${newRecruit(state, p).name} stays with you anyway.`);
    } else {
      const fresh = [];
      for (let i = 0; i < (c.strangers || 1); i++) fresh.push(newRecruit(state, p));
      out.push(`The survivors, ${names(fresh)}, join the team.`);
    }
  } else if (c.type === "skirmish") {
    const helped = factionById(state, c.helpedId);
    if (helped) {
      changeGoodwill(state, helped, 15, "you fought beside them");
      helped.lastDiplomacy = day(state);
      const key = rng.pick(["ammo", "meds"]);
      out.push(`${helped.name} thank you with ${addCargo(state, p, key, key === "ammo" ? 40 : 4)} ${key}.`);
    }
  }
  if (c.aiPartyId) {
    const q = state.parties.find((x) => x.id === c.aiPartyId);
    if (q) {
      q.strength *= 0.4;
      if (q.strength < 2) removeParty(state, q);
      out.push("Their war party is broken.");
    }
  }
  return out;
}

// ---------- rescue missions ----------
export function guardsFor(state, p, f) {
  const def = FACTION_TYPES[f.type];
  return {
    kind: KIND_OF[f.type], count: clamp(Math.round(f.pop * 0.3), 3, 12), power: Math.round((2.6 + def.arms * 1.6) * 10) / 10,
    factionId: f.id, name: `${f.name} guards`,
  };
}

export function ransomValue(f, n) {
  const att = attitude(f);
  return Math.round(n * (40 + (f.type === "zealot" ? 30 : 0)) * ({ Hostile: 1.5, Neutral: 1, Friendly: 0.7, Allied: 0.5 }[att]));
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
  const talkDcV = ({ Hostile: 16, Neutral: 11, Friendly: 7, Allied: 4 }[attitude(f)]) + (f.type === "zealot" ? 3 : 0);
  const talk = skillChance(talkSkill(state, p), talkDcV);
  const value = ransomValue(f, held.length);
  const plan = payPlan(p, value);
  const c = { type: "rescue", mode: "rescue", partyId: p.id, tile: partyTile(p), factionId: f.id, enemy: guards, exact: false, identified: true, held: held.map((s) => s.id) };
  p.phase = "engaged";
  p.conflictResume = "out";
  return {
    kind: "conflict", conflict: c, partyId: p.id, where: tileLabel(state, partyTile(p)),
    title: `Rescue at ${tileLabel(state, p.dest)}`,
    text: `${f.name} hold ${names(held)} here. About ${guards.count} guards are on the walls${night ? ", fewer awake at this hour" : ""}.`,
    choices: [
      {
        label: "Sneak in and get them out",
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
          return startRescueFight(st, p, f, guards, "enemy", "alarm");
        },
      },
      {
        label: "Storm the base",
        hint: `About ${pct(assault)} to win against ${guards.count} guards. Victory frees everyone held here. Goodwill with ${f.name} collapses`,
        resolve: (st) => startRescueFight(st, p, f, guards, null, "assault"),
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
        disabled: !plan,
        resolve: (st) => {
          const pl = payPlan(p, value);
          if (!pl) return "Not enough.";
          payFrom(p, pl, f);
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

function startRescueFight(state, p, f, guards, ambush, mode) {
  ensureHandlers();
  p.phase = "engaged";
  startCombat(state, {
    tile: partyTile(p), partyId: p.id, enemy: { ...guards }, ambush, canRetreat: true, handler: "rescue",
    context: { partyId: p.id, factionId: f.id, mode },
  });
  return "";
}

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
    text = result.outcome === "retreat" ? "You pulled back from the walls." : "The attack failed.";
    const members = partyMembers(state, p);
    if (f && result.outcome === "defeat" && members.length && state.rng.chance(0.3)) {
      const s = state.rng.pick(members);
      takeCaptive(state, s, f, p);
      text += ` ${s.name} was caught.`;
    }
  }
  if (f && f.pop <= 2) collapseFaction(state, f);
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
  const talk = skillChance(talkSkill(state, p), ({ Hostile: 16, Neutral: 11, Friendly: 7, Allied: 4 }[attitude(f)]) + (f.type === "zealot" ? 3 : 0));
  return {
    kind: "conflict", partyId: p.id,
    conflict: { type: "ransom", mode: "rescue", partyId: p.id, factionId: f.id, enemy: guardsFor(state, p, f), exact: false, identified: true, held: held.map((s) => s.id) },
    title: `Your people at ${f.name}`,
    text: `${f.name} hold ${names(held)}. Before you trade, you can try to get them back.`,
    choices: [
      {
        label: "Pay the ransom",
        hint: plan ? `Costs ${planText(plan)} from what the team carries. They join the team` : `You do not carry enough (about ${value} worth of goods)`,
        disabled: !plan,
        resolve: (st) => {
          const pl = payPlan(p, value);
          if (!pl) return "Not enough.";
          payFrom(p, pl, f);
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
export function captivesDaily(state) {
  const rng = state.rng;
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
    const att = attitude(f);
    if ((att === "Friendly" || att === "Allied") && rng.chance(0.35)) {
      releaseHome(state, s);
      captiveEvent(state, "released", `${f.name} release ${first(s)}`, `Relations with ${f.name} are good enough that they let ${s.name} go. ${first(s)} is back at ${hub(state).name}.`, "good");
    } else if (f.type === "zealot" && days > 2 && rng.chance(0.05)) {
      hurt(state, s, 999, null, `at the hands of ${f.name}`);
      captiveEvent(state, "killed", `${s.name} is dead`, `Word comes that ${f.name} "purified" ${s.name}.`, "death");
    } else if (days > 10 && !s.leader && rng.chance(f.type === "zealot" ? 0.01 : 0.015)) {
      s.alive = false;
      s.left = true;
      s.recruitedBy = f.id;
      f.pop += 1;
      captiveEvent(state, "recruited", `${first(s)} has joined ${f.name}`, `After ${Math.floor(days)} days as a prisoner, ${s.name} has taken ${f.name}'s side. They are one of them now.`, "death");
    } else if (rng.chance(0.005 + skill(s, "stealth") * 0.001)) {
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
export function defendInPerson(state, raid) {
  const f = factionById(state, raid.owner);
  const base = state.bases.find((b) => b.id === raid.target.baseId);
  if (!f || !base) return "";
  ensureHandlers();
  const def = FACTION_TYPES[f.type];
  const power = Math.round((2.2 + def.arms * 1.6) * 10) / 10;
  startCombat(state, {
    tile: base.tile, baseId: base.id,
    enemy: { kind: KIND_OF[f.type], count: clamp(Math.round(raid.strength / power), 3, 14), power, factionId: f.id, name: `${f.name} raiders` },
    ambush: base.alert ? "player" : null, canRetreat: false, handler: "raidDefense", context: { raidId: raid.id, baseId: base.id, factionId: f.id },
  });
  return "";
}

function onRaidDefenseCombat(state, result, setup) {
  const c = setup.context;
  const raid = state.parties.find((x) => x.id === c.raidId);
  const f = factionById(state, c.factionId);
  const base = state.bases.find((b) => b.id === c.baseId);
  if (f) f.pop = Math.max(0, f.pop - Math.ceil((result.enemiesKilled || 0) * 0.7));
  let text;
  if (result.outcome === "victory") {
    if (raid) removeParty(state, raid);
    state.stats.raidsRepelled += 1;
    text = `${base ? base.name : "The base"} beat off the ${f ? f.name : ""} raid in a stand-up fight.`;
    log(state, text, "good");
  } else {
    if (raid) {
      raid.strength *= Math.max(0.3, (result.enemiesLeft || 1) / Math.max(1, setup.enemy.count));
      if (base) base.alert = true;
    }
    text = `The defenders were pushed back. The raiders will press their attack.`;
    log(state, text, "danger");
  }
  if (f && f.pop <= 2) collapseFaction(state, f);
  addCard(state, { title: "Raid defense", text, choices: [{ label: "OK", resolve: () => "" }] });
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
    ammo: p ? Math.floor(p.supplies.ammo || 0) : 0,
    vehicle: v ? `${v.name}, fuel ${Math.floor(partyFuel(state, p))}` : "On foot",
    skills: p ? { stealth: bestSkill(state, p, "stealth"), speech: bestSkill(state, p, "speech"), scouting: bestSkill(state, p, "scouting") } : {},
    held: (c.held || []).map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s)),
    victim: c.victimId ? factionById(state, c.victimId) : null,
    other: c.otherId ? factionById(state, c.otherId) : null,
    modeText: c.mode === "forced" ? "They found you first" : c.mode === "observed" ? "You spotted them first. They have not seen you" : "At their gates",
  };
}

