// Defences against hordes: when a horde reaches one of your bases, what holds it out and what happens when it
// breaks in.
//
// Hold limit: walls hold back a horde up to 15 + 18 × wall strength (buildings.js baseWalls: hub 69 / 123 / 177 /
// 231 for 0–3 walls, outposts 33 / 87 / 141 / 195), plus 2 for every point of combat power on guard duty (everyone
// counts at 0.8 while the defences are manned after a warning), times the defence buildings' bonuses (barricades
// +12% each, trench +25%, reinforced gate +20%, floodlights +10% with 2 fuel to burn; from the armory, barbed wire
// +5% a roll and sandbags +4% a bundle, armoryDefence). Spike pits thin the horde first (7% + 4 per pit, used up),
// then bear traps from the armory (3 each); a tripwire alarm there has everyone count half on the walls unwarned. A Wallbreaker (hives.js) cuts the limit to 60% (two: 35%) and smashes a
// defence every time it attacks (a barricade, the reinforced gate, else a wall section 40% of the time).
// A horde at or under the limit is beaten off at the walls. Above it, the dead break in: the part the walls
// still held back stays outside (the limit × 0.5) and the rest is fought on the base's battle map, with the
// barricades as cover, spike pits and a trench in front, and the Wallbreaker among them. In the browser that is
// the tactical battle; headless and on autopilot the same battle is played out by the AI on both sides, so the
// odds match. Losing it overruns the base: people hurt (and killed), stores spoiled, an outpost lost. A hub with
// nobody left alive ends the game.
import { log, addCard, atBase, hurt, combatPower, removeBase, isNight } from "./world.js";
import { GEAR } from "./data.js";
import { count, baseWalls } from "./buildings.js";
import { poweredType } from "./power.js";
import {
  createBattle, startCombat, autoPlayerTurn, runEnemyPhase, closeCombat, combatants, registerCombatHandler, registerBattleLayout, endBattleNow,
} from "./combat.js";
import { hordeScore, reduceHorde } from "./hordes.js";
import { ensureHives, zombieToughness } from "./hives.js";
import { BOSS_NAMES } from "./hiveconst.js";
import { deployMap, deployUnits, endDeploy } from "./deploy.js";
import { raidDamage } from "./breakdowns.js";
import { defensibleCount } from "./interior.js";

export const DEFENCE = {
  WALL_BASE: 15, WALL_PER: 18, GUARD_PER_POWER: 2, ALERT_WEIGHT: 0.8,
  BARRICADE: 0.12, TRENCH: 0.25, GATE: 0.2, FLOOD: 0.1, FLOOD_FUEL: 2,
  SPIKE_FRAC: 0.07, SPIKE_FLAT: 4, BOSS: [1, 0.6, 0.35], HELD_BACK: 0.5,
  BREAK_BASE: 1.5, BREAK_DIV: 5, // the dead that break in: power 1.5 + (how many) / (5 × units on the map), at most 6
  RETREAT_TILES: 4, RETREAT_HOURS: 48, SHUN_DAYS: 10, // a horde beaten off falls back this far, this long, and leaves the base alone this many days
};

// ---------- the hold limit ----------
export const wallTier = (base) => count(base, "walls");
export const wallHold = (base) => DEFENCE.WALL_BASE + DEFENCE.WALL_PER * baseWalls(base);
export const manned = (state, base) => !!base.hordeAlert && state.hour < base.hordeAlert;

// Defence kit kept in the base's armory (data.js GEAR defence): barbed wire +5% hold a roll (up to 3, one torn up
// by every horde attack), sandbags +4% a bundle (up to 4), bear traps catch 3 of the dead each before the walls (up
// to 4, a quarter break each time), a tripwire alarm (one is enough) has everyone count half on the walls without a
// warning. On the break-in map: wire that stops the dead for the turn, traps that hurt and hold, sandbag cover.
export function armoryDefence(base) {
  const n = (k) => (base && base.armory ? base.armory.filter((it) => it && it.key === k).length : 0);
  const cap = (k) => Math.min(GEAR[k].defence.max || 99, n(k));
  const wire = cap("barbedwire"), bags = cap("sandbags"), traps = cap("beartrap");
  const alarm = n("tripwire") > 0 ? GEAR.tripwire.defence.alarm : 0;
  return { wire, bags, traps, alarm, hold: wire * GEAR.barbedwire.defence.hold + bags * GEAR.sandbags.defence.hold };
}

export function guardHold(state, base) {
  let p = 0;
  const all = manned(state, base);
  const alarm = all ? 0 : armoryDefence(base).alarm; // a tripwire alarm: everyone half, warned or not
  for (const s of atBase(state, base.id)) {
    if (s.inBed) continue;
    if (s.role === "guard") p += combatPower(s);
    else if (all) p += combatPower(s) * DEFENCE.ALERT_WEIGHT;
    else if (alarm) p += combatPower(s) * alarm;
  }
  return p * DEFENCE.GUARD_PER_POWER;
}

export function defenceMult(state, base) {
  const flood = count(base, "floodlights") && (poweredType(base, "floodlights") || (base.stock.fuel || 0) >= DEFENCE.FLOOD_FUEL); // on generator power they burn no fuel (power.js)
  return 1 + DEFENCE.BARRICADE * count(base, "barricades") + DEFENCE.TRENCH * count(base, "trench") + DEFENCE.GATE * count(base, "gate") + (flood ? DEFENCE.FLOOD : 0) + armoryDefence(base).hold;
}
// Bear traps: the dead caught before they reach the walls.
export const trapKill = (base, n) => Math.min(n, armoryDefence(base).traps * GEAR.beartrap.defence.kill);
// After a horde attack: a roll of wire torn up, each bear trap a quarter chance to break. Returns the note.
function wearDefenceKit(state, base) {
  const out = [];
  const take = (k) => { const i = base.armory.findIndex((it) => it && it.key === k); if (i >= 0) base.armory.splice(i, 1); return i >= 0; };
  if (armoryDefence(base).wire && take("barbedwire")) out.push("a roll of barbed wire was torn up");
  let broke = 0;
  for (let i = armoryDefence(base).traps; i > 0; i--) if (state.rng.chance(GEAR.beartrap.defence.breaks) && take("beartrap")) broke++;
  if (broke) out.push(`${broke} bear trap${broke > 1 ? "s" : ""} broke`);
  return out.length ? `${out.join(" and ")[0].toUpperCase()}${out.join(" and ").slice(1)}.` : "";
}

export function holdLimit(state, base, bosses = 0) {
  const boss = DEFENCE.BOSS[Math.min(2, bosses)];
  return Math.round((wallHold(base) + guardHold(state, base)) * defenceMult(state, base) * boss);
}

export const spikeKill = (base, n) => {
  const k = count(base, "spike_pits");
  return k ? Math.min(n, Math.round(n * DEFENCE.SPIKE_FRAC * k + DEFENCE.SPIKE_FLAT * k)) : 0;
};

// ---------- the three tiers (interior.js): wall, yard, buildings ----------
// What each tier of a base's defence multiplies its defenders' strength by, in fights resolved by the numbers
// (combat.js autoResolveCombat: a raid fought in person and auto-resolved, the autopilot's) and in the hold estimate
// below. The wall: +5% a wall section (up to 3), a watchtower +5%, a reinforced gate +5%, the trench +3%, lit
// floodlights at night +3%. The yard: +3% a barricade, +1.5% a sandbag bundle and a roll of wire in the armory, +2% a
// spike pit. The buildings: +2% a building that can be held (interior.js defensibleCount, up to 5). A fight is held at
// the wall when the defenders are worth HELD_AT_WALL × the attackers there, else in the yard when they match them
// with the yard counted, else in the buildings (the last stand), else lost.
export const TIERS = {
  WALL: { per: 0.05, max: 3, tower: 0.05, gate: 0.05, trench: 0.03, flood: 0.03 },
  YARD: { barricade: 0.03, bags: 0.015, wire: 0.015, pits: 0.02 },
  BUILDINGS: { per: 0.02, max: 5 },
  HELD_AT_WALL: 1.15,
};
export function tierMults(state, base, night = false) {
  if (!base) return { wall: 1, yard: 1, buildings: 1, walled: false, held: 0 };
  const T = TIERS, walls = count(base, "walls"), kit = armoryDefence(base);
  const flood = count(base, "floodlights") && (poweredType(base, "floodlights") || (base.stock.fuel || 0) >= DEFENCE.FLOOD_FUEL);
  const wall = walls ? 1 + T.WALL.per * Math.min(T.WALL.max, walls) + (count(base, "watchtower") ? T.WALL.tower : 0) + (count(base, "gate") ? T.WALL.gate : 0)
    + (count(base, "trench") ? T.WALL.trench : 0) + (flood && night ? T.WALL.flood : 0) : 1;
  const yard = 1 + T.YARD.barricade * count(base, "barricades") + T.YARD.bags * kit.bags + T.YARD.wire * kit.wire + T.YARD.pits * count(base, "spike_pits");
  const held = defensibleCount(base);
  const buildings = 1 + T.BUILDINGS.per * Math.min(T.BUILDINGS.max, held);
  return { wall, yard, buildings, walled: walls > 0, held };
}
// The strength of the best 8 at a base (who would fight a break-in), with too little ammo counting 60%.
export function defendersPower(state, base) {
  const people = atBase(state, base.id).filter((s) => !s.inBed).sort((a, c) => combatPower(c) - combatPower(a)).slice(0, 8);
  const p = people.reduce((a, s) => a + combatPower(s), 0);
  return (base.stock.ammo || 0) >= people.length * 3 ? p : p * 0.6;
}
// The dead that broke in, as a strength on the same scale (breakInForce's count × power, a Wallbreaker 12).
const BOSS_STRENGTH = 12;
export const breakInStrength = (state, base, through, bosses = 0) => { const f = breakInForce(state, base, through, bosses); return f.count * f.power + bosses * BOSS_STRENGTH; };
// How many of the dead that broke in each inner tier is expected to stop: the most `through` for which the defenders
// still match them with the yard counted (yard), and with the buildings too (buildings). 0 when nobody is there.
export function tierLimits(state, base, bosses = 0, night = false) {
  const mine = defendersPower(state, base);
  const m = tierMults(state, base, night);
  const most = (mult) => {
    if (mine * mult < breakInStrength(state, base, 1, bosses)) return 0;
    let lo = 1, hi = 5000;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (mine * mult >= breakInStrength(state, base, mid, bosses)) lo = mid; else hi = mid; }
    return lo;
  };
  return { yard: most(m.wall * m.yard), buildings: most(m.wall * m.yard * m.buildings), mine, mults: m };
}

// Raids by the numbers (factions.js resolveRaidOnPlayer, visitors.js resolveRaidOnYou, prisoners.js): the defence
// against the attackers' strength through the tiers. hold / brk: the thresholds (factions.js RAIDS.HOLD, BREAK).
// Held at the wall at hold × or better with the wall tier counted; else they break in and are pushed out of the yard
// (brk × with the yard counted) or held off from the buildings (with the buildings too); else overrun. ratio: what
// the old single thresholds read (held ≥ hold > broken ≥ brk > overrun).
export function raidTier(state, base, def, att, hold, brk) {
  const m = tierMults(state, base, isNight(state));
  const wall = (def * m.wall) / Math.max(1, att), yard = wall * m.yard, last = yard * m.buildings;
  const tier = wall >= hold ? "wall" : yard >= brk ? "yard" : last >= brk ? "buildings" : "overrun";
  const ratio = tier === "wall" ? wall : tier === "overrun" ? last : Math.max(brk, Math.min(yard, hold - 0.001));
  return { tier, ratio, wall, yard, last, mults: m };
}

// "Can this base hold against a horde of N?" The walls first (holds: at or under the limit); above it, how many break
// in (through) and whether the yard or a last stand in the buildings is expected to stop them (tier: "wall" | "yard" |
// "buildings" | "overrun").
export function holdCheck(state, base, size, bosses = 0) {
  const after = Math.max(0, size - spikeKill(base, size) - trapKill(base, size));
  const limit = holdLimit(state, base, bosses);
  const holds = after <= limit;
  const through = holds ? 0 : Math.min(after, Math.max(Math.round(after * 0.3), Math.round(after - limit * DEFENCE.HELD_BACK)));
  const lim = holds ? null : tierLimits(state, base, bosses);
  const tier = holds ? "wall" : through <= lim.yard ? "yard" : through <= lim.buildings ? "buildings" : "overrun";
  return { size, after, limit, holds, margin: limit - after, through, tier, yardLimit: lim ? lim.yard : null, buildingsLimit: lim ? lim.buildings : null };
}
export function holdText(state, base, size, bosses = 0) {
  const c = holdCheck(state, base, size, bosses);
  const boss = bosses ? ` with a ${BOSS_NAMES.horde}` : "";
  if (c.holds) return `${base.name} holds against ${size}${boss}: its defences stop up to about ${c.limit}.`;
  const then = c.tier === "yard" ? `the yard should hold them (up to about ${c.yardLimit})` : c.tier === "buildings" ? `the yard would fall, a last stand in the buildings might hold (up to about ${c.buildingsLimit})` : "the yard and the buildings would likely fall";
  return `${base.name} cannot hold ${size}${boss}: its defences stop about ${c.limit}, so about ${Math.max(1, c.through)} would break in; ${then}.`;
}
// One line for the base panel.
export function holdSummary(state, base) {
  return { limit: holdLimit(state, base), boss: holdLimit(state, base, 1), tier: wallTier(base) };
}

// ---------- a horde at the gates ----------
export function hordeAttackBase(state, h, base) {
  ensureHives(state);
  const rng = state.rng;
  const stats = state.hiveInfo.stats;
  const people = atBase(state, base.id);
  const notes = [];
  base.hordeHits = (base.hordeHits || 0) + 1;
  // Spike pits: one use.
  const pits = count(base, "spike_pits");
  if (pits) {
    const k = spikeKill(base, h.size);
    base.buildings = base.buildings.filter((b) => b.type !== "spike_pits");
    notes.push(`The spike pits took about ${k}.`);
    if (reduceHorde(state, h, k)) { log(state, `A horde ran onto the spike pits at ${base.name} and was torn apart. ${notes.join(" ")}`, "good"); return; }
  }
  // The defence kit in the armory: bear traps catch a few; the wire and traps count for this attack (and the map),
  // then wear (a roll of wire torn up, some traps broken).
  const kit = armoryDefence(base);
  const caught = trapKill(base, h.size);
  if (caught) notes.push(`The bear traps caught ${caught}.`);
  const floodlit = count(base, "floodlights") && (poweredType(base, "floodlights") || (base.stock.fuel || 0) >= DEFENCE.FLOOD_FUEL);
  const bosses = Math.min(2, h.bosses || 0);
  const limit = holdLimit(state, base, bosses);
  const worn = kit.wire || kit.traps ? wearDefenceKit(state, base) : "";
  if (worn) notes.push(worn);
  if (caught && reduceHorde(state, h, caught)) { log(state, `The last of a horde was caught in the bear traps at ${base.name}. ${notes.join(" ")}`, "good"); return; }
  if (floodlit && !poweredType(base, "floodlights")) base.stock.fuel -= DEFENCE.FLOOD_FUEL;
  const smashed = bosses ? smash(state, base, bosses) : [];
  if (smashed.length) notes.push(`${bosses > 1 ? `The ${BOSS_NAMES.horde}s` : `The ${BOSS_NAMES.horde}`} smashed ${smashed.length > 1 && smashed[0] === smashed[1] ? `two ${smashed[0].replace(/^a /, "")}s` : smashed.join(" and ")}.`);
  base.stock.ammo = Math.max(0, (base.stock.ammo || 0) - people.length * 3);
  if (h.size <= limit) {
    stats.held++;
    const killed = Math.min(h.size, Math.round(8 + guardHold(state, base) * 0.8 + h.size * 0.12));
    log(state, `A horde of ${h.size} hit ${base.name}. The defences held (they stop about ${limit}) and about ${killed} of the dead were cut down.${notes.length ? ` ${notes.join(" ")}` : ""}`, "good");
    if (people.length && h.size > limit * 0.7 && rng.chance(0.4)) hurt(state, rng.pick(people), rng.int(10, 30), base.tile, `fighting the horde at ${base.name}`);
    if (!reduceHorde(state, h, killed)) retreat(state, h, base);
    return;
  }
  // Break-in.
  stats.breakIns++;
  const through = Math.min(h.size, Math.max(Math.round(h.size * 0.3), Math.round(h.size - limit * DEFENCE.HELD_BACK)));
  log(state, `A horde of ${h.size}${bosses ? ` led by a ${BOSS_NAMES.horde}` : ""} broke through the defences of ${base.name} (they stop about ${limit}). About ${through} of the dead are inside.${notes.length ? ` ${notes.join(" ")}` : ""}`, "death");
  if (!people.length && base.type === "outpost") return wreckEmpty(state, base, h, through);
  if (!people.length) return overrun(state, base, h, through, "Nobody was there to stop them.");
  const force = breakInForce(state, base, through, bosses);
  h.busy = true; // held in place until the fight is over
  h.target = base.tile;
  fightNow(state, {
    tile: base.tile, baseId: base.id,
    enemy: { kind: "zombies", count: force.count, power: force.power, name: bosses ? `the horde and its ${BOSS_NAMES.horde}` : "the horde", bosses },
    ambush: null, canRetreat: true, handler: "hordeBreakIn", layout: "baseDefence", downedLive: 0.4, deploy: true, // canRetreat: a way out away from the breach (deploy.js)
    context: { hordeId: h.id, baseId: base.id, through, size: h.size, bosses, pits, floodlit: !!floodlit, night: isNight(state), fromTile: h.from ?? null, kit },
  });
}

// The dead that broke in as a battle: up to 20 on the map, each tougher the more there are (and on a hive's land).
export function breakInForce(state, base, through, bosses = 0) {
  const n = Math.max(6, Math.min(20, Math.round(through / 7)));
  const power = Math.max(1.5, Math.min(6, DEFENCE.BREAK_BASE + through / (n * DEFENCE.BREAK_DIV) + zombieToughness(state, base.tile) * 0.5));
  return { count: n, power: Math.round(power * 10) / 10, bosses };
}

// The horde backs off after a fight: it falls back RETREAT_TILES from the base (on its own side) for
// RETREAT_HOURS, and is not drawn back to that base for SHUN_DAYS (hordes.js hordesDaily).
function retreat(state, h, base) {
  h.busy = false;
  if (h.role === "attack") { h.role = "roam"; h.goal = null; }
  h.lureUntil = state.hour + DEFENCE.RETREAT_HOURS;
  if (DEFENCE.SHUN_DAYS) h.shun = { tile: base.tile, until: state.hour + DEFENCE.SHUN_DAYS * 24 };
  h.warned = false; // if it turns back for a base later, the lookouts warn again (as after a decoy fire)
  const g = state.grid;
  const land = (id) => state.tiles[id].terrain !== "water" || state.tiles[id].bridge;
  const ring = DEFENCE.RETREAT_TILES > 1 ? g.within(base.tile, DEFENCE.RETREAT_TILES).filter((id) => g.distance(id, base.tile) === DEFENCE.RETREAT_TILES && land(id)) : [];
  h.target = ring.length ? ring.reduce((a, b) => (g.distance(b, h.tile) < g.distance(a, h.tile) ? b : a))
    : g.neighbors(h.tile).sort((a, b) => g.distance(b, base.tile) - g.distance(a, base.tile))[0] ?? null;
}

// A Wallbreaker's work: one defence per boss.
function smash(state, base, bosses) {
  const out = [];
  for (let i = 0; i < bosses; i++) {
    const gone = (type) => { const j = base.buildings.findIndex((b) => b.type === type); if (j < 0) return false; base.buildings.splice(j, 1); return true; };
    if (gone("barricades")) out.push("a barricade");
    else if (gone("gate")) out.push("the reinforced gate");
    else if (count(base, "walls") && state.rng.chance(0.4) && gone("walls")) out.push("a section of wall");
  }
  return out;
}

// An outpost with nobody in it (a base taken from a group and left as land, conquest.js): the dead tear through,
// spoil half the food, water and meds, batter what was built and move on. Nobody is there to lose it: it stays yours.
function wreckEmpty(state, base, h, through) {
  state.hiveInfo.stats.overrun++;
  for (const k of ["food", "water", "meds"]) base.stock[k] = Math.floor((base.stock[k] || 0) * 0.5);
  const dmg = raidDamage(state, base, { strength: Math.min(60, through * 0.4), hours: 8, outcome: "broken", by: "the dead" });
  log(state, `The dead tore through ${base.name}: nobody was there. Half the food, water and meds were spoiled. ${dmg.text}`, "danger");
  if (h && state.hordes.includes(h)) {
    reduceHorde(state, h, Math.round(through * 0.05));
    if (state.hordes.includes(h)) retreat(state, h, base);
  }
}

function overrun(state, base, h, through, why = "") {
  const rng = state.rng;
  state.hiveInfo.stats.overrun++;
  const people = atBase(state, base.id);
  const dead = [];
  for (const s of people) {
    if (!rng.chance(0.4)) continue;
    hurt(state, s, rng.int(20, 60), base.tile, `when the dead overran ${base.name}`);
    if (!s.alive) dead.push(s.name);
  }
  for (const k of ["food", "water", "meds"]) base.stock[k] = Math.floor((base.stock[k] || 0) * 0.65);
  log(state, `The dead overran ${base.name}.${why ? ` ${why}` : ""}${dead.length ? ` Killed: ${dead.join(", ")}.` : ""} A third of the food, water and meds were spoiled.`, "death");
  if (base.type === "outpost" && state.bases.includes(base)) removeBase(state, base, "was overrun by the dead");
  if (h && state.hordes.includes(h)) {
    reduceHorde(state, h, Math.round(through * 0.15));
    if (state.hordes.includes(h)) retreat(state, h, base);
  }
}

// Where a won base battle was decided (combat.js result.tier), for the cards.
export const TIER_WORDS = { wall: " at the walls", yard: " in the yard", buildings: " in a last stand in the buildings" };

registerCombatHandler("hordeBreakIn", (state, result, setup) => {
  const c = setup.context;
  const h = state.hordes.find((x) => x.id === c.hordeId) || null;
  const base = state.bases.find((b) => b.id === c.baseId) || null;
  const share = (result.enemiesKilled || 0) / Math.max(1, setup.enemy.count + (c.bosses || 0));
  if (result.outcome === "victory") {
    state.hiveInfo.stats.repelled++;
    if (h) { h.bosses = 0; if (!reduceHorde(state, h, c.through)) retreat(state, h, base || { tile: h.tile }); }
    const wrecked = base && count(base, "barricades") ? (base.buildings.splice(base.buildings.findIndex((b) => b.type === "barricades"), 1), " One barricade was wrecked in the fight.") : "";
    const where = TIER_WORDS[result.tier] || "";
    const text = `${base ? base.name : "The base"} held${where}: the ${c.through} dead that broke in were cut down${c.bosses ? `, the ${BOSS_NAMES.horde} with them` : ""}.${wrecked}`;
    log(state, text, "good");
    addCard(state, { title: "The horde is beaten", text, choices: [{ label: "OK", resolve: () => "" }] });
    return;
  }
  if (h) reduceHorde(state, h, Math.round(c.through * share));
  if (result.outcome === "retreat" && base && state.bases.includes(base)) {
    // Pulled out of the fight: the people who got out hide outside the walls while the dead tear through the base
    // (half the food, water and meds spoiled, the walls and defences battered), then come back once the horde has
    // moved on. Nobody else is hurt and the base (an outpost too) stays yours.
    state.hiveInfo.stats.overrun++;
    for (const k of ["food", "water", "meds"]) base.stock[k] = Math.floor((base.stock[k] || 0) * 0.5);
    const dmg = raidDamage(state, base, { strength: Math.min(60, c.through * 0.4), hours: 8, outcome: "broken", by: "the dead" });
    if (h && state.hordes.includes(h)) retreat(state, h, base);
    const text = `Your people pulled out of ${base.name} and waited outside while the dead tore through it. Half the food, water and meds were spoiled. ${dmg.text} The horde has moved on and everyone who got out is back inside.`;
    log(state, text, "danger");
    addCard(state, { title: "Pulled out", text, choices: [{ label: "OK", resolve: () => "" }] });
    return;
  }
  if (base && state.bases.includes(base)) overrun(state, base, h, c.through, "The defenders were beaten.");
  const text = `The defenders of ${base ? base.name : "the base"} were beaten and the dead overran it.`;
  addCard(state, { title: "Overrun", text, choices: [{ label: "OK", resolve: () => "" }] });
});

// ---------- warnings ----------
// Hourly: a horde you can see that is heading for one of your bases, within 6 tiles, gets a warning card once.
export function hordeWarnings(state) {
  const g = state.grid;
  for (const h of state.hordes) {
    if (h.warned || !state.live.has(h.tile)) continue;
    const base = state.bases.find((b) => (h.goal && h.goal.baseId === b.id) || h.target === b.tile);
    if (!base || g.distance(h.tile, base.tile) > 6 || h.tile === base.tile) continue;
    h.warned = true;
    ensureHives(state);
    state.hiveInfo.stats.warnings++;
    addCard(state, warningCard(state, h, base));
  }
}

export const DECOY_FUEL = 6;
export function decoyChance(h) {
  if (h.bosses) return 0.15;
  return Math.max(0.25, Math.min(0.8, 0.85 - hordeScore(h.size) / 60));
}

function warningCard(state, h, base) {
  const dist = state.grid.distance(h.tile, base.tile);
  const bosses = Math.min(2, h.bosses || 0);
  const still = (st) => st.hordes.includes(h) && st.bases.includes(base);
  const mannedLimit = () => {
    const was = base.hordeAlert;
    base.hordeAlert = state.hour + 1;
    const v = holdLimit(state, base, bosses);
    base.hordeAlert = was;
    return v;
  };
  return {
    title: `Horde heading for ${base.name}`,
    kind: "horde",
    text: `Lookouts see a horde of about ${h.size} (score ${hordeScore(h.size)})${bosses ? `, a ${BOSS_NAMES.horde} at its head,` : ""} ${dist} tile${dist === 1 ? "" : "s"} out and coming this way. ${holdText(state, base, h.size, bosses)}`,
    choices: [
      {
        label: "Man the defences",
        hint: `Everyone at ${base.name} takes a post for two days: the defences stop about ${holdLimit(state, base, bosses)} → ${mannedLimit()}. If the dead still break in, the best 8 fight them on the base map`,
        resolve: (st) => { base.hordeAlert = st.hour + 48; return `${base.name} mans the defences.`; },
      },
      {
        label: `Burn a decoy fire (${DECOY_FUEL} fuel)`,
        hint: `${Math.round(decoyChance(h) * 100)}% to draw it off for a few days${bosses ? ` (a ${BOSS_NAMES.horde} rarely falls for it)` : ""}`,
        get disabled() { return (base.stock.fuel || 0) < DECOY_FUEL; },
        resolve: (st) => {
          if (!still(st)) return "The horde is gone.";
          if ((base.stock.fuel || 0) < DECOY_FUEL) return `${base.name} no longer has ${DECOY_FUEL} fuel.`;
          base.stock.fuel -= DECOY_FUEL;
          if (!st.rng.chance(decoyChance(h))) return "The fire burns, but the horde keeps coming.";
          retreat(st, h, base);
          h.lureUntil = st.hour + 96;
          h.warned = false;
          return "The horde turns toward the fire and away from the walls.";
        },
      },
      { label: "Hold as you are", resolve: () => "You wait." },
    ],
  };
}

// ---------- battles that play out on their own when nobody is watching ----------
// In the browser (and without auto-combat) this opens the tactical battle. Headless, or with auto-combat on
// (autopilot), the same battle is played turn by turn by the AI on both sides and closed at once.
export function fightNow(state, setup) {
  const auto = typeof window === "undefined" || state.autoCombat;
  if (!auto || state.combat) return startCombat(state, setup);
  if (!combatants(state, setup).length) return startCombat(state, setup); // dropped there
  const b = createBattle(state, setup);
  state.combat = b;
  endDeploy(b); // deploy.js: nobody to place them by hand, so the default positions
  // Two maps (the wall, then the yard and the buildings: interior.js) can take a while; the redeploy after falling
  // back is a "deploy" phase the AI ends with the default posts.
  for (let i = 0; i < 240 && !b.over; i++) {
    if (b.phase === "player" || b.phase === "deploy") autoPlayerTurn(state);
    else runEnemyPhase(state);
  }
  if (!b.over) endBattleNow(state, setup.canRetreat ? "retreat" : "defeat");
  closeCombat(state);
  return null;
}

// ---------- bosses on the battle map ----------
const BOSSES = {
  wallbreaker: { who: "horde", short: "WB", hp: 190, armor: 0.7, meleeAim: 78, dmgMult: 1.7, mob: 2 },
  broodmother: { who: "hive", short: "BM", hp: 300, armor: 0.65, meleeAim: 82, dmgMult: 1.9, mob: 2 },
};
export function bossUnit(b, kind) {
  const d = BOSSES[kind];
  return {
    id: b.nextId++, side: "enemy", kind: "zombie", boss: kind, name: BOSS_NAMES[d.who], short: d.short, weapon: "claws", weaponName: "Crushing blows",
    aim: 0, meleeAim: d.meleeAim, dmgMult: d.dmgMult, armor: d.armor, hp: d.hp, maxHp: d.hp, mob: d.mob, sight: 9, ap: 2, aware: true, x: 0, y: 0,
  };
}
// Puts a unit on a free cell the player side can reach, as far right as possible (from column minX).
export function placeUnitRight(b, ctx, u, minX) {
  let best = null;
  for (let y = 0; y < ctx.H; y++) for (let x = minX; x < ctx.W; x++) {
    if (!ctx.standable(x, y)) continue;
    const score = x - Math.abs(y - ctx.H / 2) * 0.3;
    if (!best || score > best.score) best = { x, y, score };
  }
  if (!best) return false;
  u.x = best.x; u.y = best.y;
  return true;
}

// The base's battle map (deploy.js): the wall line with its gate and breaches, barricades, the trench and spike
// pits, watchtowers; floodlights light the approach; the attack comes from the side the attackers came from, and
// with setup.deploy the player places the defenders first.
registerBattleLayout("baseDefence", (b, ctx) => {
  const setup = b.setup, c = setup.context || {};
  const base = ctx.state.bases.find((x) => x.id === setup.baseId) || null;
  if (ctx.phase === "map") return deployMap(b, ctx, base, c);
  // Units: the Wallbreakers come in with the dead; then the defenders' posts and the turn of the map.
  for (let i = 0; i < (setup.enemy.bosses || 0); i++) {
    const boss = bossUnit(b, "wallbreaker");
    if (placeUnitRight(b, ctx, boss, ctx.W - 6)) b.units.push(boss);
  }
  deployUnits(b, ctx, base, c);
});

// ---------- autopilot help ----------
// What the player can know of the hordes threatening a base: the biggest horde in sight within 8 tiles (and its
// Wallbreakers), and whether hordes are a known danger here at all (one in sight, a hive known within 20 tiles,
// or this base was attacked before).
export function hordeThreat(state, base) {
  const g = state.grid;
  let size = 0, bosses = 0;
  for (const h of state.hordes) {
    if (!state.live.has(h.tile) || g.distance(h.tile, base.tile) > 8) continue;
    if (h.size > size) { size = h.size; bosses = h.bosses || 0; }
  }
  let hiveNear = false;
  for (const id of g.within(base.tile, 20)) {
    const k = state.knowledge[id];
    if (k && k.hive) { hiveNear = true; break; }
  }
  return { size, bosses, any: size > 0 || hiveNear || (base.hordeHits || 0) > 0 };
}
// Defence buildings worth queuing at a base, most useful first (autopilot.js buildWishes).
export function defenceWishes(state, base, threat) {
  const out = [];
  const add = (type, why) => out.push({ type, why, save: !out.length });
  if (!threat) return out;
  if (count(base, "barricades") < 3) add("barricades", "barricades against the hordes");
  if (!count(base, "spike_pits")) add("spike_pits", "spike pits to thin a horde");
  if (!count(base, "trench") && base.type === "hub") add("trench", "a trench before the walls");
  if (!count(base, "gate") && count(base, "walls")) add("gate", "a reinforced gate");
  if (!count(base, "floodlights") && base.type === "hub") add("floodlights", "floodlights for night attacks");
  return out;
}
