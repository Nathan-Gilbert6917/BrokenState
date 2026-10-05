// Field Heat: a team that stays put draws attention (review T-25). Every hour a team spends on one tile (waiting,
// holding, camping, gathering, building a boat, looking around, crafting, treating, repairing) builds up local
// Heat from noise, smoke and smell; Heat falls again once the team moves on. Each hour on the spot the chance of
// trouble (the dead wander in, a horde close by is drawn in, scavengers or raiders find the camp) rises with the
// Heat and with how dangerous the tile is. Trouble uses the road's conflict cards (conflicts.js).
//
// Numbers (all per hour on the spot):
//   gain  = activity × place × hive land × team size × night × stance
//     activity: fishing 0.7, setting or checking snares 0.8, waiting / holding / look around / treating 1.0,
//               hunting 1.2 (and +6 a gunshot, hunting.js), gathering / crafting / repairs 1.5,
//               building a boat 1.8 (hammering), camp 2.0 (fire, cooking smells)
//     place:    countryside 1.0, suburbs 1.4, city 1.8, then × (1 + 0.6 × infection)
//     hive land ×1.4, the red ring around a hive ×2
//     team size 0.7 + 0.1 a person (3 people 1.0, 6 people 1.3)
//     night:    a camp fire carries further (×1.3); otherwise darkness hides the team (×0.8)
//     stance:   stealthy ×0.8
//   decay = 8 an hour on the move (and gone at your own bases); Heat is capped at 100.
//   trouble = 12% × (Heat / 100)^1.5 × danger, danger = 0.15 + 3 × the road's conflict chance here
//             (groups near, AI parties, infected ground, hordes, traffic) + 0.3 city / 0.15 suburbs
//             + 0.3 hive land / 0.8 hive ring + 0.2 a horde within 3 tiles (capped at 2).
//   After trouble the Heat halves (they found you; the rest lost interest), and nothing more for 6 hours (20 after a
//   conflict card, the road's rule).
// A quiet countryside camp for a night (10 hours) reaches Heat ~25 and has about a 1–2% chance of trouble;
// three days camped in a city near a group or a hive reaches 100 within a day and sees trouble every day or so.
import { partyMembers, partyTile, tileLabel } from "./parties.js";
import { conflictChance, stationaryEncounter, COOLDOWN_HOURS } from "./conflicts.js";
import { zombieToughness } from "./hives.js";
import { heatMult } from "./skills.js";

export const HEAT_MAX = 100;
export const HEAT_DECAY = 8;          // per hour on the move
export const HEAT_TROUBLE = 0.12;     // hourly chance at Heat 100 and danger 1
export const HEAT_COOLDOWN = 6;       // hours after trouble before the next roll
const ACTIVITY = { fish: 0.7, snare: 0.8, hunt: 1.2, waiting: 1, holding: 1, survey: 1, treat: 1, wait: 1, gather: 1.5, craft: 1.5, repair: 1.5, cross: 1.8, camp: 2 };
const ACT_NAME = { fish: "fishing", snare: "snares", hunt: "hunting (gunshots add more)", waiting: "waiting", holding: "holding", survey: "looking around", treat: "treating someone", wait: "waiting", gather: "gathering on the shore", craft: "crafting", repair: "repairing the vehicle", cross: "building a boat", camp: "camp fire and cooking" };

// What the team is doing on the spot (null: moving, in a fight or search, on the water, or not a field team).
export function stationaryActivity(p) {
  if (!p || p.owner !== "player" || p.kind === "convoy") return null;
  if (p.phase === "waiting" || p.phase === "holding") return p.phase;
  if (p.phase === "task" && p.task) {
    if (p.task.type === "cross" && p.task.afloat) return null;
    return ACTIVITY[p.task.type] ? p.task.type : "waiting";
  }
  return null;
}

// Within a tile of one of your bases the team is home: no Heat there (the base has its own, hordes.js baseHeat).
const atHome = (state, tile) => state.bases.some((b) => state.grid.distance(b.tile, tile) <= 1);

// Heat gained this hour on the spot, with the reasons (team panel tooltip).
export function heatGain(state, p, activity = stationaryActivity(p), hour = state.hour) {
  if (!activity) return { gain: 0, parts: [] };
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const parts = [];
  let g = ACTIVITY[activity] || 1;
  parts.push(`${ACT_NAME[activity] || activity} ×${g}`);
  const place = t.terrain === "city" ? 1.8 : t.terrain === "suburb" ? 1.4 : 1;
  if (place > 1) parts.push(`${t.terrain === "city" ? "city" : "suburbs"} ×${place}`);
  g *= place;
  if (t.infection > 0.05) { const inf = 1 + 0.6 * t.infection; g *= inf; parts.push(`infection ×${inf.toFixed(1)}`); }
  const tough = zombieToughness(state, tile);
  if (tough) { const h = tough >= 3 ? 2 : 1.4; g *= h; parts.push(`${tough >= 3 ? "next to a hive" : "hive land"} ×${h}`); }
  const n = partyMembers(state, p).length;
  const size = Math.round((0.7 + 0.1 * n) * 10) / 10;
  g *= size;
  if (size !== 1) parts.push(`${n} people ×${size}`);
  if (hour % 24 < 6 || hour % 24 >= 20) { // night, as world.js isNight
    const nf = activity === "camp" ? 1.3 : 0.8;
    g *= nf;
    parts.push(activity === "camp" ? "fire at night ×1.3" : "dark ×0.8");
  }
  if (p.stance === "stealthy") { g *= 0.8; parts.push("stealthy ×0.8"); }
  if (heatMult(state, p) !== 1) { g *= heatMult(state, p); parts.push(`Ranger ×${heatMult(state, p)}`); } // skills.js perk
  return { gain: g, parts };
}

// How dangerous the tile is for a team that stays (0.15 quiet … 2 worst).
export function tileDanger(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  const parts = [];
  const road = conflictChance(state, p, tile).chance;
  let d = 0.15 + road * 3;
  if (road > 0.02) parts.push(`people and the dead about (${Math.round(road * 100)}% a tile on the road)`);
  if (t.terrain === "city") { d += 0.3; parts.push("city"); } else if (t.terrain === "suburb") { d += 0.15; parts.push("suburbs"); }
  const tough = zombieToughness(state, tile);
  if (tough) { d += tough >= 3 ? 0.8 : 0.3; parts.push(tough >= 3 ? "next to a hive" : "hive land"); }
  const horde = state.hordes.find((h) => state.grid.distance(h.tile, tile) <= 3);
  if (horde) { d += 0.2; parts.push("a horde within 3 tiles"); }
  return { danger: Math.min(2, d), parts, horde };
}

export const troubleChance = (heat, danger) => HEAT_TROUBLE * Math.pow(Math.max(0, Math.min(HEAT_MAX, heat)) / 100, 1.5) * danger;
export const dangerWord = (d) => (d < 0.35 ? "quiet" : d < 0.7 ? "some risk" : d < 1.2 ? "dangerous" : "very dangerous");

// Everything the panel and the map tooltip show.
export function heatInfo(state, p) {
  const heat = p.heat || 0;
  const activity = stationaryActivity(p);
  const home = atHome(state, partyTile(p));
  const g = home ? { gain: 0, parts: [] } : heatGain(state, p, activity);
  const dz = tileDanger(state, p);
  const chance = activity && !home ? troubleChance(heat, dz.danger) : 0;
  const moving = p.phase === "out" || p.phase === "back";
  let text = `Heat ${Math.round(heat)}/100: noise, smoke and smell from staying in one place. `;
  if (home) text += "At one of your bases: no Heat here.";
  else if (activity) text += `Rising ${g.gain.toFixed(1)} an hour here (${g.parts.join(", ")}). Danger here: ${dangerWord(dz.danger)}${dz.parts.length ? ` (${dz.parts.join(", ")})` : ""}. Chance of trouble (the dead, a horde, scavengers or raiders finding the team): ${(chance * 100).toFixed(1)}% this hour, growing with the Heat. Moving on lets it fall ${HEAT_DECAY} an hour.`;
  else if (moving) text += `Falling ${HEAT_DECAY} an hour while the team moves.`;
  else text += "Not rising now.";
  return { heat, gain: g.gain, danger: dz.danger, chance, text, activity, level: heat < 25 ? "low" : heat < 50 ? "rising" : heat < 75 ? "high" : "extreme" };
}

// Hourly, from parties.js playerPartyHour (after food and water). Builds or sheds Heat and may bring trouble:
// returns the card it raised (already added by the caller's addCard) or null.
export function fieldHeatHour(state, p, addCard) {
  if (p.owner !== "player" || p.kind === "convoy") return null;
  const tile = partyTile(p);
  const activity = stationaryActivity(p);
  if (atHome(state, tile)) { p.heat = 0; return null; }
  if (!activity) {
    if (p.phase === "out" || p.phase === "back") p.heat = Math.max(0, (p.heat || 0) - HEAT_DECAY);
    return null;
  }
  p.heat = Math.min(HEAT_MAX, (p.heat || 0) + heatGain(state, p, activity).gain);
  p.heatTile = tile;
  // One thing at a time: no trouble while the team has a card open, or right after the last trouble.
  if (state.cards.some((c) => c.partyId === p.id) || state.combat || (p.heatTrouble != null && state.hour - p.heatTrouble < HEAT_COOLDOWN)) return null;
  // The road's rule too: at most one conflict per team every 20 hours (conflicts.js COOLDOWN_HOURS).
  if (p.lastConflict != null && state.hour - p.lastConflict < COOLDOWN_HOURS) return null;
  if (p.eventHour === state.hour) return null;
  const dz = tileDanger(state, p, tile);
  if (!state.rng.chance(troubleChance(p.heat, dz.danger))) return null;
  const card = stationaryEncounter(state, p, { horde: dz.horde && dz.horde.size >= 10 ? dz.horde : null, heat: p.heat });
  p.heatTrouble = state.hour;
  p.heat *= 0.5;
  if (!card) return null;
  card.text = `${heatLead(state, p, activity)} ${card.text || ""}`.trim();
  p.eventHour = state.hour;
  p.heatEncounters = (p.heatEncounters || 0) + 1;
  addCard(state, card);
  return card;
}

function heatLead(state, p, activity) {
  const what = { camp: "The camp's fire and cooking smells", cross: "The hammering on the shore", gather: "The noise on the shore", craft: "The noise of the work", hunt: "The hunt (and its gunshots)" }[activity] || "Too long in one place";
  return `${what} drew attention at ${tileLabel(state, partyTile(p))}.`;
}

// For the autopilot and the planner: hours a team can stay on a tile before the hourly chance of trouble passes
// `limit` (null: never within `max` hours).
export function safeHours(state, p, activity = "camp", limit = 0.03, max = 96) {
  const dz = tileDanger(state, p);
  let heat = p.heat || 0;
  for (let h = 1; h <= max; h++) {
    heat = Math.min(HEAT_MAX, heat + heatGain(state, { ...p, phase: "task", task: { type: activity } }, activity).gain);
    if (troubleChance(heat, dz.danger) > limit) return h - 1;
  }
  return null;
}

// The planner's look ahead: Heat after staying `hours` on the team's tile doing `activity`, and the chance of at
// least one trouble in that time (without the halving and cooldowns after trouble, so a little pessimistic).
export function heatPreview(state, p, activity, hours, startHour = state.hour) {
  const dz = tileDanger(state, p);
  let heat = p.heat || 0, safe = 1;
  for (let h = 0; h < hours; h++) {
    heat = Math.min(HEAT_MAX, heat + heatGain(state, p, activity, startHour + h).gain);
    safe *= 1 - troubleChance(heat, dz.danger);
  }
  return { heat, risk: 1 - safe, danger: dz.danger, word: dangerWord(dz.danger) };
}
