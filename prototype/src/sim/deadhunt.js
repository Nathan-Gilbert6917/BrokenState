// @ts-check
// Hunt the dead (the heat epic #64 §6, issue #68; the user's request 2026-10-26: "Killing zombies in the tile (add an
// order to hunt down zombies in a tile to reduce the overall threat level, when you encounter Them open a small raid
// map to attack or retreat in)" and "No hunt raiders just hunt zombies").
//
// THE ORDER (orders.js "deadhunt": the team panel's Land row, the map's right-click team menu on the team's own tile,
// the planner's step, the order queue): the team sweeps its tile's open ground for DEAD_HUNT.HOURS (2–24 h, asked in
// the land order box, ui/landorder.js) in a stance: Stealthy, Normal or Lure (STANCES: loud on purpose, more and
// bigger groups found, noise on the tile through deadpop.js noteNoise every hour). Zombies only: there is no Hunt
// raiders order.
// ENCOUNTERS (deadHuntHour, every hour of the task): a hash die (the seed, the team, the hour) against
// encounterChance: 1 − e^(−RATE × density × stance × (1 + SCOUT × the team's best Scouting)), at most P_MAX, where the
// density is the tile's open-ground dead (deadpop.js openDead) over AREA. A group's size (groupMean: BASE + PER ×
// density, × the stance's size, ± JITTER by a hash die, at most MAX) comes out of the open ground (drawFromTile) when
// it is fought.
// THE CARD (encounterCard): Attack or Retreat; the hunt's clock waits while it is up (a tray card left takes Retreat).
// The group stays on the open ground until it is fought (a hunt stopped while the card is up loses nobody from the pool).
//   - Attack: a small raid map (MAP: the Small 24 × 18 of battlesize.js), the tile's own land round a spot on its base
//     map (basemap.js siteLand, laid as siteclear.js's layout), the group about the spot, the team in from the west;
//     reinforcements from the open ground within earshot as every fight on the land (combat.js b.reinfMax, deadpop.js
//     earshot). Stealthy, the team has the drop on them (ambush "player").
//   - Retreat: an escape check off the map, by combat.js RETREAT's numbers (escapeOdds' terms: the ground to cover, the
//     dead close behind, Scouting, night, wounds; the stance). Failed, the fight starts anyway with the team caught out
//     (ambush "enemy"). Made, the group goes back to the open ground (putBack).
//   - After the fight (handler "deadHunt"): the group goes back (putBack) and its killed come off the tile (killDead:
//     the kill memory, the noise; loud with DEADPOP.LOUD_SHOTS rounds fired). The hunt goes on until its hours are up,
//     or stops when the team was beaten or anyone is hurt below HURT (it says why).
// HEADLESS AND THE AUTOPILOT: the same card; Attack plays the same map out with the battle AI (defences.js fightNow, as
// the defences do). The governor (governHunts, autopilotDaily) sends a team on a hunt on its own base's tile when the
// tile is medium or above (deadpop.js deadBand) and the base has the people (GOV).
// AI PARITY (docs/adr/0001; #64 §10): each group hunts the dead on its own bases' land now and then (aiHuntsDaily, at
// midnight after the day's recalculation): the same encounter chance and group sizes, each fight by the shared
// resolver of the fights nobody watches (groupfight.js fightSides), its kills off the same pool. It keeps their home
// tiles low.
// Hash dice from the world seed (skills.js hash01) outside the battles, keyed on ids counted from the world's own start
// (world.js localId: two worlds of a seed in one process roll the same); inside the battles the battle's own.
/** @import { State } from "./types" */
import { hash01 } from "./skills.js";
import { log, addCard, isNight, combatPower, day, localId } from "./world.js";
import { partyMembers, partyTile, tileLabel, teamName, awaitOrders, wipeIfEmpty, bestSkill } from "./parties.js";
import { registerCombatHandler, registerBattleLayout, registerBattleSize, byNumbersOdds, RETREAT } from "./combat.js";
import { fightNow } from "./defences.js";
import { siteLand, SITE_RANGE } from "./basemap.js";
import { layLand } from "./basescatter.js";
import { cragWays } from "./relief.js";
import { siteDeadMix, maxMix } from "./deadsoldiers.js";
import { beastMix } from "./deadbeasts.js";
import { siteSpecials } from "./hivetech.js";
import { widenMix } from "./deadpool.js";
import { openDead, drawFromTile, putBack, killDead, noteNoise, deadBand, DEADPOP } from "./deadpop.js";
import { fightersOf, fightSides, applySide } from "./groupfight.js";
import { Rng } from "./rng.js";

export const DEAD_HUNT = {
  HOURS: { min: 2, max: 24, def: 8, step: 1, presets: [2, 4, 8, 12, 24] },
  AREA: 40,                 // a tile's open ground, in patches: the density is openDead / AREA
  RATE: 0.8,                // the hourly encounter hazard a unit of density (a quiet rural tile ~15%, a town ~40%, a city at the most)
  P_MAX: 0.9,
  SCOUT: 0.03,              // +3% encounters a point of the team's best Scouting (they find the dead)
  STANCES: {
    stealthy: { name: "Stealthy", enc: 0.6, size: 0.7, noise: 0, desc: "Slow and quiet: fewer, smaller groups, picked off before they know the team is there (the team has the drop on them)." },
    normal: { name: "Normal", enc: 1, size: 1, noise: 0, desc: "A steady sweep of the open ground." },
    lure: { name: "Lure", enc: 1.8, size: 1.5, noise: 3, desc: "Loud on purpose: banging, shouting, a car horn. More and bigger groups come to the team, and the noise on the tile draws more in." },
  },
  SIZE: { base: 2, per: 5, max: 12, jitter: 0.3 }, // a group: base + per × density, × the stance's size, ± jitter
  HURT: 35,                 // anyone below this health: the hunt stops
  MAP: [24, 18],            // the fight's map: battlesize.js's Small
  SPOT_X: 0.66, SPREAD: 6,  // the group round a spot this far across the map, within SPREAD cells
  FLEE: { stealthy: 10, normal: 0, lure: -10 }, // the escape check's stance (combat.js RETREAT for the rest)
  FLEE_TILES: 8,            // the ground to cover getting clear (RETREAT.PER_TILE a tile)
  // The governor (autopilot): a hunt on its own base's tile at this band or above, with a team of TEAM from a base
  // keeping HOME at home, a hunt a base every EVERY days at most, when the odds against a mean group are at least ODDS.
  GOV: { band: 2, team: 3, home: 3, hours: 8, every: 3, odds: 0.7 },
  // AI groups: a hunt on one of their bases' tiles at this band or above, about once in EVERY days a base, with up to
  // TEAM of their fit people (at least MIN).
  AI: { band: 2, every: 3, team: 4, min: 2, hours: 8 },
};
const STANCE_KEYS = Object.keys(DEAD_HUNT.STANCES);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const first = (s) => String(s.name).split(" ")[0];

/** The hours of a hunt order, whole, 2–24. @param {any} o */
export const deadHuntHours = (o) => clamp(Math.round(Number(o && o.hours) || DEAD_HUNT.HOURS.def), DEAD_HUNT.HOURS.min, DEAD_HUNT.HOURS.max);
/** The stance of a hunt order: "stealthy" | "normal" | "lure". @param {any} o */
export const huntStance = (o) => (o && STANCE_KEYS.includes(o.stance) ? o.stance : "normal");
export const stanceName = (st) => DEAD_HUNT.STANCES[huntStance({ stance: st })].name;

// ---------- the odds ----------
/** The open ground's density of the dead on a tile (openDead / AREA). @param {State} state @param {number} tile @param {number} [open] */
export const deadDensity = (state, tile, open = openDead(state, tile)) => Math.max(0, open) / DEAD_HUNT.AREA;
/**
 * The chance an hour's sweep meets a group: by the density, the stance and the best Scouting.
 * @param {State} state @param {number} tile @param {string} stance @param {number} scouting @param {number} [open]
 */
export function encounterChance(state, tile, stance, scouting, open = openDead(state, tile)) {
  if (!(open > 0)) return 0;
  const S = DEAD_HUNT.STANCES[huntStance({ stance })];
  const z = DEAD_HUNT.RATE * deadDensity(state, tile, open) * S.enc * (1 + DEAD_HUNT.SCOUT * Math.max(0, scouting || 0));
  return Math.min(DEAD_HUNT.P_MAX, 1 - Math.exp(-z));
}
/** A group's mean size (before the jitter), never more than the open ground holds. @param {State} state @param {number} tile @param {string} stance @param {number} [open] */
export function groupMean(state, tile, stance, open = openDead(state, tile)) {
  const S = DEAD_HUNT.STANCES[huntStance({ stance })];
  return Math.min(open, DEAD_HUNT.SIZE.max, (DEAD_HUNT.SIZE.base + DEAD_HUNT.SIZE.per * deadDensity(state, tile, open)) * S.size);
}
/** A group's size by a hash die (key: what makes the roll its own). @param {State} state @param {number} tile @param {string} stance @param {any[]} key */
export function rollGroup(state, tile, stance, key) {
  const m = groupMean(state, tile, stance);
  if (!(m > 0)) return 0;
  const j = 1 + DEAD_HUNT.SIZE.jitter * (2 * hash01(state.seed, "dhsize", ...key) - 1);
  return clamp(Math.round(m * j), 1, Math.min(DEAD_HUNT.SIZE.max, openDead(state, tile)));
}
/** The dead of a tile as an enemy on the map: { power, mix } (siteclear.js's: the soldiers, the bred dead, the beasts, the years' dead). @param {State} state @param {number} tile */
export function deadKind(state, tile) {
  const inf = clamp((state.tiles[tile] || {}).infection || 0, 0, 1);
  const mix = maxMix(maxMix(maxMix(siteDeadMix(state, tile), siteSpecials(state, tile)), beastMix(state, tile)), widenMix(state, tile));
  return { power: Math.round((2 + inf * 3) * 10) / 10, mix };
}
/** The enemy of a hunt's fight. @param {State} state @param {number} tile @param {number} n */
export const huntEnemy = (state, tile, n) => ({ kind: "zombies", count: n, ...deadKind(state, tile), name: n === 1 ? "one of the dead" : `${n} of the dead` });
/** The team's odds against a group of n by the numbers (combat.js byNumbersOdds). @param {State} state @param {any} p @param {number} n @param {string | null} [ambush] */
export function huntOdds(state, p, n, ambush = null) {
  if (!(n > 0)) return 1;
  const tile = partyTile(p);
  return byNumbersOdds(state, { partyId: p.id, tile, enemy: huntEnemy(state, tile, n), ambush }).win;
}
/**
 * The escape check off the map (combat.js escapeOdds' terms with RETREAT's numbers): the ground to cover, the group
 * close behind, the team's best Scouting, night, the worst wounds, the stance. 5–95%.
 * @param {State} state @param {any} p @param {number} n @param {string} stance
 */
export function retreatOdds(state, p, n, stance) {
  const ms = partyMembers(state, p);
  if (!ms.length) return 0;
  let c = 100 - DEAD_HUNT.FLEE_TILES * RETREAT.PER_TILE;
  c -= Math.min(RETREAT.THREAT_MAX, Math.max(0, n) * RETREAT.CHASER);
  c += RETREAT.SCOUTING * bestSkill(state, p, "scouting");
  if (isNight(state)) c -= RETREAT.NIGHT;
  const worst = Math.min(...ms.map((s) => s.health));
  c -= RETREAT.WOUNDS * Math.max(0, 1 - worst / 100);
  c += DEAD_HUNT.FLEE[huntStance({ stance })] || 0;
  return Math.round(clamp(c, RETREAT.MIN, RETREAT.MAX));
}

// ---------- the order ----------
/** Why the team cannot hunt the dead here, or "". @param {State} state @param {any} p @param {number} [tile] */
export function deadHuntProblem(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!t) return "not on the map.";
  if (t.terrain === "water" && !t.bridge) return "not from the water.";
  const ms = partyMembers(state, p);
  if (!ms.length) return "nobody in the team.";
  const hurt = ms.filter((s) => s.health < DEAD_HUNT.HURT);
  if (hurt.length) return `${hurt.map(first).join(", ")} ${hurt.length === 1 ? "is" : "are"} too hurt to go after the dead.`;
  return "";
}
/**
 * What a hunt would meet, for the box (an average, the open ground thinned as the kills come off it):
 * { hours, stance, encounters, size, kills, win, density, open, perHour, notes: [..], why }.
 * Every group is counted as attacked; a retreat kills none.
 * @param {State} state @param {any} p @param {{ tile?: number, hours?: number, stance?: string }} [o]
 */
export function deadHuntEstimate(state, p, { tile = partyTile(p), hours = DEAD_HUNT.HOURS.def, stance = "normal" } = {}) {
  hours = deadHuntHours({ hours });
  stance = huntStance({ stance });
  const scouting = partyMembers(state, p).length ? bestSkill(state, p, "scouting") : 0;
  const open0 = openDead(state, tile);
  let open = open0, enc = 0, kills = 0, size = 0;
  const amb = stance === "stealthy" ? "player" : null;
  const win = huntOdds(state, p, Math.max(1, Math.round(groupMean(state, tile, stance, open0))), amb);
  for (let h = 0; h < hours && open > 0; h++) {
    const pe = encounterChance(state, tile, stance, scouting, open), m = groupMean(state, tile, stance, open);
    enc += pe;
    size += pe * m;
    const k = pe * m * win;
    kills += k;
    open = Math.max(0, open - k);
  }
  const band = deadBand(state, tile);
  const S = DEAD_HUNT.STANCES[stance];
  const notes = [
    `The dead on this tile: ${band.word}${band.skulls ? ` ${band.skulls}` : ""}. ${S.name}: ${S.desc}`,
    "Each group met gives Attack (a small fight on the tile's own land) or Retreat (an escape check). Every one killed comes off the tile's count; the ones left alive go back out on it.",
  ];
  if (stance === "lure") notes.push("Lure is loud: the tile's noise rises every hour, and loud tiles draw the dead in.");
  return { hours, stance, encounters: Math.round(enc * 10) / 10, size: enc > 0 ? Math.round((size / enc) * 10) / 10 : 0, kills: Math.round(kills * 10) / 10, win, density: deadDensity(state, tile, open0), open: open0, perHour: hours ? kills / hours : 0, notes, why: deadHuntProblem(state, p, tile) };
}

/** The task (orders.js startOrder "deadhunt"). @param {any} o */
export const deadHuntTask = (o) => ({ type: "deadhunt", hours: deadHuntHours(o), stance: huntStance(o), met: 0, kills: 0, fled: 0, enc: null });
/** "Hunt the dead 8h (Lure)". @param {any} o */
export const deadHuntLabel = (o) => `Hunt the dead ${deadHuntHours(o)}h${huntStance(o) !== "normal" ? ` (${stanceName(o.stance)})` : ""}`;

/**
 * An hour of the hunt (orders.js taskHour, after t.done counted it). A card waiting: the hunt's clock waits too.
 * Lure: noise on the tile. Then the encounter roll; met, the group comes out of the open ground and the card goes up.
 * @param {State} state @param {any} p
 */
export function deadHuntHour(state, p) {
  const t = p.task;
  if (!t || t.type !== "deadhunt") return;
  if (t.enc && (state.cards || []).some((c) => c.deadHunt && c.partyId === p.id)) { t.done -= 1; return; } // the card is still up: the hours wait for it
  if (t.enc) t.enc = null; // its card was dropped (a world written without its cards): the group never left the open ground
  if (t.done - (t.owed || 0) > t.hours + 1e-9) return; // its hours were up while a card waited: it ends this hour
  const tile = partyTile(p);
  const S = DEAD_HUNT.STANCES[huntStance(t)];
  if (S.noise > 0) noteNoise(state, tile, null, S.noise);
  const pe = encounterChance(state, tile, t.stance, bestSkill(state, p, "scouting"));
  if (!(pe > 0) || hash01(state.seed, "dhunt", localId(state, p.id), state.hour, t.done) >= pe) return;
  const n = rollGroup(state, tile, t.stance, [localId(state, p.id), state.hour, t.done]); // drawn out of the open ground when it is fought (huntFight)
  if (n <= 0) return;
  t.enc = { n, at: state.hour };
  t.met = (t.met || 0) + 1;
  addCard(state, encounterCard(state, p, n));
}
// The team's hunt, still waiting on this encounter's card.
const liveEnc = (state, p) => !!p && state.parties.includes(p) && p.phase === "task" && !!p.task && p.task.type === "deadhunt" && !!p.task.enc;

/** The card of an encounter: Attack or Retreat. @param {State} state @param {any} p @param {number} n */
export function encounterCard(state, p, n) {
  const tile = partyTile(p), t = p.task, stance = huntStance(t);
  const amb = stance === "stealthy" ? "player" : null;
  const win = Math.round(huntOdds(state, p, n, amb) * 100), flee = retreatOdds(state, p, n, stance);
  const what = n === 1 ? "one of the dead" : `${n} of the dead`;
  return {
    title: `Hunting the dead: ${what}`, where: tileLabel(state, tile), partyId: p.id, deadHunt: true,
    text: `${teamName(state, p)} came on ${what} out on the open ground of ${tileLabel(state, tile)}${stance === "stealthy" ? ", and they have not seen the team yet" : stance === "lure" ? ", drawn by the noise" : ""}. Attack: a small fight on the tile's own land (about ${win}% by the numbers; more of the dead nearby can come to the shots). Retreat: about ${flee}% to slip away; failing, they fight anyway, caught out.`,
    choices: [
      { label: "Attack", fight: true, hint: `A small map of ${tileLabel(state, tile)}'s land with ${what}${amb ? ": the team has the drop on them" : ""}. Every one killed comes off the tile.`, ai: (st) => (huntOdds(st, p, n, amb) >= DEAD_HUNT.GOV.odds ? 3 : 0.5), resolve: (st) => { if (liveEnc(st, p)) huntFight(st, p, false); return ""; } },
      { label: "Retreat", default: true, hint: `Slip away from them (about ${flee}%): failing, the fight starts with the team caught out. The hunt goes on.`, ai: () => 1, resolve: (st) => (liveEnc(st, p) ? huntRetreat(st, p) : "") },
    ],
  };
}

/** Retreat: the escape check; made, the group goes back to the open ground; failed, the fight, caught out. @param {State} state @param {any} p */
export function huntRetreat(state, p) {
  const t = p.task, e = t.enc, tile = partyTile(p);
  const odds = retreatOdds(state, p, e.n, t.stance);
  if (hash01(state.seed, "dhflee", localId(state, p.id), e.at, t.met) * 100 < odds) {
    t.enc = null; // they stay out on the open ground
    t.fled = (t.fled || 0) + 1;
    const text = `${teamName(state, p)} slipped away from ${e.n === 1 ? "one of the dead" : `${e.n} of the dead`} and hunts on.`;
    log(state, text, "info");
    return text;
  }
  log(state, `${teamName(state, p)} tried to slip away from ${e.n} of the dead and was caught out.`, "danger");
  huntFight(state, p, true);
  return "";
}

/**
 * The fight on the small map (in the browser the battle screen; headless the battle AI plays it out, defences.js
 * fightNow). caught: a failed retreat (they strike first). @param {State} state @param {any} p @param {boolean} caught
 */
export function huntFight(state, p, caught) {
  const t = p.task, e = t.enc, tile = partyTile(p);
  const n = drawFromTile(state, tile, e.n); // out of the open ground for the fight (the handler puts back the ones left)
  if (n <= 0) { t.enc = null; log(state, `${teamName(state, p)}: the dead it saw have wandered off.`, "info"); return; }
  const ambush = caught ? "enemy" : huntStance(t) === "stealthy" ? "player" : null;
  p.phase = "engaged";
  fightNow(state, {
    tile, partyId: p.id, enemy: huntEnemy(state, tile, n), ambush, canRetreat: true, handler: "deadHunt", layout: "deadHunt",
    context: { partyId: p.id, tile, n, at: e.at, caught: !!caught },
  });
}

registerCombatHandler("deadHunt", (state, result, setup) => {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId);
  // The group drawn for the fight goes back; its killed come off the tile (killDead: the kill memory and the noise).
  putBack(state, c.tile, null, c.n);
  const killed = Math.min(c.n, Math.max(0, (result && result.enemiesKilled) || 0));
  if (killed) killDead(state, c.tile, null, killed, { loud: ((result && result.ammoUsed) || 0) >= DEADPOP.LOUD_SHOTS });
  const t = p && p.task && p.task.type === "deadhunt" ? p.task : null;
  if (t) { t.kills = (t.kills || 0) + killed; t.enc = null; }
  if (!p || !partyMembers(state, p).length) {
    if (p) wipeIfEmpty(state, p);
    log(state, `The team hunting the dead at ${tileLabel(state, c.tile)} was lost to them.`, "death");
    return;
  }
  if (!t) return;
  p.phase = "task";
  const ms = partyMembers(state, p);
  const hurt = ms.filter((s) => s.health < DEAD_HUNT.HURT);
  const lost = ((result && result.survivorsDead) || []).length;
  const fought = `${killed} of the ${c.n} dead put down${result && result.outcome === "retreat" ? ", then the team pulled back" : ""}`;
  if (result && result.outcome === "defeat") return stopHunt(state, p, `${fought}: the team was driven off. The hunt is over.`);
  if (lost) return stopHunt(state, p, `${fought}, but ${lost === 1 ? "one of the team" : `${lost} of the team`} fell. The hunt is over.`);
  if (hurt.length) return stopHunt(state, p, `${fought}. ${hurt.map(first).join(", ")} ${hurt.length === 1 ? "is" : "are"} hurt too badly to go on: the hunt stops.`);
  log(state, `${teamName(state, p)}: ${fought}. The hunt goes on.`, killed ? "good" : "info");
});
// Ends the hunt early, saying why (the card reports in with the summary).
function stopHunt(state, p, why) {
  const text = `${why} ${deadHuntSummary(state, p, p.task)}`;
  log(state, `${teamName(state, p)}: ${why}`, "danger");
  awaitOrders(state, p, text, { failed: true });
}

/** The summary when the hunt ends (orders.js finishTask). @param {State} state @param {any} p @param {any} t */
export function deadHuntSummary(state, p, t) {
  const tile = partyTile(p), band = deadBand(state, tile);
  const met = t.met || 0;
  return `Hunting the dead: ${met ? `${met} group${met === 1 ? "" : "s"} met, ${t.kills || 0} put down${t.fled ? `, ${t.fled} slipped away from` : ""}` : "no dead found on the open ground"}. The dead here now: ${band.word}${band.skulls ? ` ${band.skulls}` : ""}.`;
}

// ---------- the map ----------
registerBattleSize("deadHunt", () => DEAD_HUNT.MAP);
// The tile's own land round a spot on its base map (hash dice: off the water and the crags), the group about it.
registerBattleLayout("deadHunt", (b, ctx) => {
  const c = b.setup && b.setup.context;
  if (!c) return;
  const cx = Math.round(ctx.W * DEAD_HUNT.SPOT_X), cy = Math.floor(ctx.H / 2);
  if (ctx.phase === "map") {
    for (let i = 0; i < b.cells.length; i++) b.cells[i] = { k: "open" };
    const land = siteLand(ctx.state, c.tile);
    const R = Math.max(10, Math.floor(SITE_RANGE * 0.8));
    let at = [0, 0];
    for (let k = 0; k < 8; k++) {
      const x = Math.round((2 * hash01(ctx.state.seed, "dhspot", c.tile, c.at, k, 0) - 1) * R), y = Math.round((2 * hash01(ctx.state.seed, "dhspot", c.tile, c.at, k, 1) - 1) * R);
      let dry = true;
      for (let dy = -3; dy <= 3 && dry; dy++) for (let dx = -3; dx <= 3; dx++) { const pc = land.pieces.get(`${x + dx},${y + dy}`); if (pc && (pc.k === "water" || pc.k === "crag" || pc.spring)) { dry = false; break; } }
      at = [x, y];
      if (dry) break;
    }
    layLand({ cells: b.cells, W: ctx.W, H: ctx.H, ox: cx - at[0], oy: cy - at[1], land, ok: (x, y) => b.cells[y * ctx.W + x].k === "open", floor: (x, y) => b.cells[y * ctx.W + x].k === "open" });
    cragWays(b.cells, ctx.W, ctx.H); // relief.js: the crag never shuts the spot off from the west edge
    return;
  }
  const taken = new Set(b.units.filter((u) => u.side !== "enemy").map((u) => u.y * ctx.W + u.x));
  const spots = [];
  for (let y = 1; y < ctx.H - 1; y++) for (let x = 1; x < ctx.W - 1; x++) {
    const i = y * ctx.W + x;
    if (Math.hypot(x - cx, y - cy) > DEAD_HUNT.SPREAD || x < 8 || !b.reach[i] || taken.has(i)) continue;
    const k = b.cells[i].k;
    if (k === "open" || k === "doorway" || k === "rise" || k === "slope" || k === "bush") spots.push(i);
  }
  for (const u of b.units) {
    if (u.side !== "enemy" || u.reinforcement || !spots.length) continue;
    const j = ctx.rng.int(0, spots.length - 1), i = spots[j];
    spots.splice(j, 1);
    u.x = i % ctx.W; u.y = Math.floor(i / ctx.W);
  }
});

// ---------- the AI groups (ADR 0001) ----------
/**
 * A hunt nobody watches: people of group f on tile for hours, by the same encounter chance and group sizes, each fight
 * by groupfight.js fightSides (their rules as yours by the numbers), the kills off the pool. Stops when they lose a
 * fight, lose anyone or anyone is hurt below HURT. Returns { met, kills, lost }.
 * @param {State} state @param {any} f @param {number} tile @param {any[]} people @param {{ hours?: number, stance?: string }} [o]
 */
export function huntAbstract(state, f, tile, people, { hours = DEAD_HUNT.AI.hours, stance = "normal" } = {}) {
  const out = { met: 0, kills: 0, lost: 0 };
  let team = people.filter((s) => s.alive !== false);
  for (let h = 0; h < hours && team.length; h++) {
    const scouting = Math.max(0, ...team.map((s) => (s.skills && s.skills.scouting) || 0));
    const pe = encounterChance(state, tile, stance, scouting);
    if (!(pe > 0) || hash01(state.seed, "aihunt", localId(state, f.id), tile, state.hour, h) >= pe) continue;
    const n = drawFromTile(state, tile, rollGroup(state, tile, stance, [localId(state, f.id), tile, state.hour, h]));
    if (n <= 0) continue;
    out.met++;
    const { power } = deadKind(state, tile);
    // The fight's own dice (the world's stream untouched: a hunt nobody watches changes nothing else's rolls).
    const keep = state.rng;
    state.rng = new Rng(Math.floor(hash01(state.seed, "aihuntfight", localId(state, f.id), tile, state.hour, h) * 2147483645) + 1);
    let fight, fell;
    try {
      fight = fightSides(state, { f, people: team, kind: "militia" }, { f: null, people: [], kind: "zombies", count: n, power: n * power });
      fell = applySide(state, f, fight.rA, team, { holder: fight.attWon ? f : null });
    } finally { state.rng = keep; }
    const killed = fight.rA ? Math.min(n, Math.floor(n * fight.rA.killShare + 1e-9)) : fight.attWon ? n : 0;
    putBack(state, tile, null, n);
    if (killed) killDead(state, tile, null, killed, { loud: true });
    out.kills += killed;
    out.lost += fell.dead.length;
    team = team.filter((s) => s.alive !== false && !fell.dead.includes(s));
    if (!fight.attWon || fell.dead.length || team.some((s) => s.health < DEAD_HUNT.HURT)) break;
  }
  return out;
}
/** At midnight (world.js, after the day's recalculation): each group now and then hunts the dead on its own bases' land. @param {State} state */
export function aiHuntsDaily(state) {
  const A = DEAD_HUNT.AI, d = day(state);
  for (const f of state.factions || []) {
    if (!f.alive || f.outsider || !Array.isArray(f.people) || !Array.isArray(f.bases)) continue;
    for (const tile of f.bases) {
      if (hash01(state.seed, "aihuntday", localId(state, f.id), tile, d) >= 1 / A.every) continue;
      if (deadBand(state, tile).band < A.band || openDead(state, tile) <= 0) continue;
      const people = fightersOf(state, f, { tile, n: A.team }).filter((s) => s.health >= DEAD_HUNT.HURT + 20);
      if (people.length < A.min) continue;
      const r = huntAbstract(state, f, tile, people);
      if (r.met) f.deadHunts = { day: d, tile, kills: r.kills, lost: r.lost }; // the last one (the tools read it)
    }
  }
}

// ---------- the governor (autopilot) ----------
/**
 * The governor's hunt for a base's tile: whether to send one, and whom ({ ids, why }); ids empty with a why when not.
 * @param {State} state @param {any} base @param {any[]} home the base's people at home, fit to go
 */
export function govHuntPick(state, base, home) {
  const G = DEAD_HUNT.GOV;
  const band = deadBand(state, base.tile);
  if (band.band < G.band) return { ids: [], why: `the dead here are ${band.word}` };
  if ((state.parties || []).some((p) => p.owner === "player" && p.task && p.task.type === "deadhunt" && partyTile(p) === base.tile)) return { ids: [], why: "a team is already hunting here" };
  if (base.lastHunt != null && day(state) - base.lastHunt < G.every) return { ids: [], why: "hunted lately" };
  const fit = home.filter((s) => s.health >= 80).sort((a, b) => combatPower(b) - combatPower(a) || a.id - b.id);
  if (fit.length < G.team + G.home) return { ids: [], why: "not enough people at home" };
  return { ids: fit.slice(0, G.team).map((s) => s.id), why: "" };
}
