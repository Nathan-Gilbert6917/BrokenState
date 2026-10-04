// Defences against hordes: when a horde reaches one of your bases, what holds it out and what happens when it
// breaks in.
//
// Hold limit: walls hold back a horde up to 15 + 18 × wall strength (buildings.js baseWalls: hub 69 / 123 / 177 /
// 231 for 0–3 walls, outposts 33 / 87 / 141 / 195), plus 2 for every point of combat power on guard duty (everyone
// counts at 0.8 while the defences are manned after a warning), times the defence buildings' bonuses (barricades
// +12% each, trench +25%, reinforced gate +20%, floodlights +10% with 2 fuel to burn). Spike pits thin the horde
// first (7% + 4 per pit, used up). A Wallbreaker (hives.js) cuts the limit to 60% (two: 35%) and smashes a
// defence every time it attacks (a barricade, the reinforced gate, else a wall section 40% of the time).
// A horde at or under the limit is beaten off at the walls. Above it, the dead break in: the part the walls
// still held back stays outside (the limit × 0.5) and the rest is fought on the base's battle map, with the
// barricades as cover, spike pits and a trench in front, and the Wallbreaker among them. In the browser that is
// the tactical battle; headless and on autopilot the same battle is played out by the AI on both sides, so the
// odds match. Losing it overruns the base: people hurt (and killed), stores spoiled, an outpost lost. A hub with
// nobody left alive ends the game.
import { log, addCard, atBase, hurt, combatPower, removeBase, isNight } from "./world.js";
import { count, baseWalls } from "./buildings.js";
import { poweredType } from "./power.js";
import {
  createBattle, startCombat, autoPlayerTurn, runEnemyPhase, closeCombat, combatants, registerCombatHandler, registerBattleLayout, endBattleNow,
} from "./combat.js";
import { hordeScore, reduceHorde } from "./hordes.js";
import { ensureHives, zombieToughness } from "./hives.js";
import { BOSS_NAMES } from "./hiveconst.js";
import { deployMap, deployUnits, endDeploy } from "./deploy.js";

export const DEFENCE = {
  WALL_BASE: 15, WALL_PER: 18, GUARD_PER_POWER: 2, ALERT_WEIGHT: 0.8,
  BARRICADE: 0.12, TRENCH: 0.25, GATE: 0.2, FLOOD: 0.1, FLOOD_FUEL: 2,
  SPIKE_FRAC: 0.07, SPIKE_FLAT: 4, BOSS: [1, 0.6, 0.35], HELD_BACK: 0.5,
  BREAK_BASE: 1.5, BREAK_DIV: 5, // the dead that break in: power 1.5 + (how many) / (5 × units on the map), at most 6
};

// ---------- the hold limit ----------
export const wallTier = (base) => count(base, "walls");
export const wallHold = (base) => DEFENCE.WALL_BASE + DEFENCE.WALL_PER * baseWalls(base);
export const manned = (state, base) => !!base.hordeAlert && state.hour < base.hordeAlert;

export function guardHold(state, base) {
  let p = 0;
  const all = manned(state, base);
  for (const s of atBase(state, base.id)) {
    if (s.inBed) continue;
    if (s.role === "guard") p += combatPower(s);
    else if (all) p += combatPower(s) * DEFENCE.ALERT_WEIGHT;
  }
  return p * DEFENCE.GUARD_PER_POWER;
}

export function defenceMult(state, base) {
  const flood = count(base, "floodlights") && (poweredType(base, "floodlights") || (base.stock.fuel || 0) >= DEFENCE.FLOOD_FUEL); // on generator power they burn no fuel (power.js)
  return 1 + DEFENCE.BARRICADE * count(base, "barricades") + DEFENCE.TRENCH * count(base, "trench") + DEFENCE.GATE * count(base, "gate") + (flood ? DEFENCE.FLOOD : 0);
}

export function holdLimit(state, base, bosses = 0) {
  const boss = DEFENCE.BOSS[Math.min(2, bosses)];
  return Math.round((wallHold(base) + guardHold(state, base)) * defenceMult(state, base) * boss);
}

export const spikeKill = (base, n) => {
  const k = count(base, "spike_pits");
  return k ? Math.min(n, Math.round(n * DEFENCE.SPIKE_FRAC * k + DEFENCE.SPIKE_FLAT * k)) : 0;
};

// "Can this base hold against a horde of N?"
export function holdCheck(state, base, size, bosses = 0) {
  const after = size - spikeKill(base, size);
  const limit = holdLimit(state, base, bosses);
  return { size, after, limit, holds: after <= limit, margin: limit - after };
}
export function holdText(state, base, size, bosses = 0) {
  const c = holdCheck(state, base, size, bosses);
  const boss = bosses ? ` with a ${BOSS_NAMES.horde}` : "";
  return c.holds ? `${base.name} holds against ${size}${boss}: its defences stop up to about ${c.limit}.`
    : `${base.name} cannot hold ${size}${boss}: its defences stop about ${c.limit}, so about ${Math.max(1, Math.round(c.after - c.limit * DEFENCE.HELD_BACK))} would break in.`;
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
  const floodlit = count(base, "floodlights") && (poweredType(base, "floodlights") || (base.stock.fuel || 0) >= DEFENCE.FLOOD_FUEL);
  const bosses = Math.min(2, h.bosses || 0);
  const limit = holdLimit(state, base, bosses);
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
  if (!people.length) return overrun(state, base, h, through, "Nobody was there to stop them.");
  const force = breakInForce(state, base, through, bosses);
  h.busy = true; // held in place until the fight is over
  h.target = base.tile;
  fightNow(state, {
    tile: base.tile, baseId: base.id,
    enemy: { kind: "zombies", count: force.count, power: force.power, name: bosses ? `the horde and its ${BOSS_NAMES.horde}` : "the horde", bosses },
    ambush: null, canRetreat: false, handler: "hordeBreakIn", layout: "baseDefence", downedLive: 0.4, deploy: true,
    context: { hordeId: h.id, baseId: base.id, through, size: h.size, bosses, pits, floodlit: !!floodlit, night: isNight(state), fromTile: h.from ?? null },
  });
}

// The dead that broke in as a battle: up to 20 on the map, each tougher the more there are (and on a hive's land).
export function breakInForce(state, base, through, bosses = 0) {
  const n = Math.max(6, Math.min(20, Math.round(through / 7)));
  const power = Math.max(1.5, Math.min(6, DEFENCE.BREAK_BASE + through / (n * DEFENCE.BREAK_DIV) + zombieToughness(state, base.tile) * 0.5));
  return { count: n, power: Math.round(power * 10) / 10, bosses };
}

// The horde backs off after a fight and stays away from that base for two days.
function retreat(state, h, base) {
  h.busy = false;
  if (h.role === "attack") { h.role = "roam"; h.goal = null; }
  h.lureUntil = state.hour + 48;
  h.warned = false; // if it turns back for a base later, the lookouts warn again (as after a decoy fire)
  const g = state.grid;
  h.target = g.neighbors(h.tile).sort((a, b) => g.distance(b, base.tile) - g.distance(a, base.tile))[0] ?? null;
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

registerCombatHandler("hordeBreakIn", (state, result, setup) => {
  const c = setup.context;
  const h = state.hordes.find((x) => x.id === c.hordeId) || null;
  const base = state.bases.find((b) => b.id === c.baseId) || null;
  const share = (result.enemiesKilled || 0) / Math.max(1, setup.enemy.count + (c.bosses || 0));
  if (result.outcome === "victory") {
    state.hiveInfo.stats.repelled++;
    if (h) { h.bosses = 0; if (!reduceHorde(state, h, c.through)) retreat(state, h, base || { tile: h.tile }); }
    const wrecked = base && count(base, "barricades") ? (base.buildings.splice(base.buildings.findIndex((b) => b.type === "barricades"), 1), " One barricade was wrecked in the fight.") : "";
    const text = `${base ? base.name : "The base"} held: the ${c.through} dead that broke in were cut down${c.bosses ? `, the ${BOSS_NAMES.horde} with them` : ""}.${wrecked}`;
    log(state, text, "good");
    addCard(state, { title: "The horde is beaten", text, choices: [{ label: "OK", resolve: () => "" }] });
    return;
  }
  if (h) reduceHorde(state, h, Math.round(c.through * share));
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
  for (let i = 0; i < 160 && !b.over; i++) {
    if (b.phase === "player") autoPlayerTurn(state);
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
