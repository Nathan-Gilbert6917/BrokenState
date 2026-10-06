// Prisoners: enemies knocked out in a won fight (stealth.js takedowns and Subdue) taken home.
//   On the road they walk with the team: on foot each slows it 10% (at least 60% of its pace; in a vehicle they
//   ride), they eat 1 food and 1 water a day from the team, and each tries to slip away (5% a day, 2% in a
//   vehicle). When the team gets home they go to that base's cells.
//   At a base: Holding cells (buildings.js "cells") hold 3 each; more prisoners than that sit in a shed. A day costs
//   1 water each and their rations of food (below) from that base's stores (the food times the cold and the water
//   times the day's thirst, weather.js: 1.3 in summer, 1.6 on a hot day, 0.9 in winter, as for anyone; upkeep.js
//   counts them in the base's food and water lines). Escapes a day: in a cell with someone on the Guard role 0.4%,
//   unguarded 3%, in the shed 8%, unfed +4%; six unfed days in a row and they die.
//   Rations (each prisoner, or all at a base; RATIONS): Full 1 food, Short 0.6 (the default, and old saves), Starvation
//     0.3, None. Full heals them (+2 health a day), keeps them calmer (escapes ×0.8) and wins them over faster (×1.2);
//     Short heals slowly toward 60; Starvation costs 1.5 health a day, escapes ×1.5, winning over ×0.4 (just held,
//     they sour by 0.5 a day instead of warming) and below 20 health a 3% chance a day of dying; None is unfed (health
//     −6 a day, dead in six days; empty stores do the same whatever the rations). Hunger loosens tongues: questioning +10% on Starvation, +15% on None, but asking them to join is harder
//     (−15% / −25%). Your people see it: while anyone here is on Starvation or None, everyone at the base loses 1
//     mood a day (a Former Medic 2; the Brave and Tough shrug it off).
//   Labour (TASKS; LABOUR): Idle in the cell, or out under guard 07–19: Farm (farm labour: the crops' care, farming.js
//     careToday), Build (construction hours, buildings.js buildRate), Fetch water (+4 a day, economy.js
//     waterProduction), Kitchen (dries and salts surplus fresh food by hand, 4 → 3 preserved, in this file), Clean
//     and mend (wear off the buildings, breakdowns.js). Each works at 50–70% of a survivor by the task's skill (2% a
//     point), times their rations (Full 1, Short 0.9, Starvation 0.6, None 0.3) and health (under 60 less; under 25
//     they cannot). It tires them: mood −0.5 a day on Full, −1 Short, −2 Starvation, and health −0.5 on Short, −1.5
//     Starvation. A guard (someone on the Guard role) watches up to 4 at work; a watched labourer escapes 1% a day, an
//     unwatched one 7%. Weeks of good work (Full or Short) win them over: +1% a day worked to the winning-over rate
//     (up to +40%) and +0.4% to asking them to join (up to +10%). Nobody goes out while the base is under attack.
//   What you can do with them (at a base):
//     question (every 3 days): Speech decides (45% + 3% a point of the best talker + 1% a point of the leader's
//       Leadership, zealots −25%, soldiers −15%, hunger by rations or unfed +10–15%, one who likes you +15%; 10–95%).
//       Rough questioning: +20%, but it costs them 10 health and 15 mood, sours them −15 instead of −6, costs
//       everyone at the base 2 mood (a Former Medic 4, the Brave and Tough nothing) and 3 goodwill with their group.
//       The first answer gives their group's bases (and puts the group on your map), its people and stock, every
//       party it has out (raids included) and the hives near it, as knowledge snapshots; later answers the parties
//       and hives again. Each questioning sours them (−6).
//     ask to join (every 7 days; ASK): (opinion − 25) / 75 × who they were (zealots 0.5, soldiers 0.8, a loner 1.2)
//       + 1% a point of the leader's Leadership and of the best talker's Speech + rations + labour + (their mood − 30)
//       / 200, 2–95%. Yes: they join (the recruit card); no: opinion −8.
//     hold for ransom: their group (alive) is asked for goods worth 15 + 4 × their power; it answers in 2–4 days:
//       pays (40% + goodwill / 200, −15% for aggressive groups, 10–90%; only what it can spare), goodwill −4 and the
//       prisoner walks home; or refuses: goodwill −3 and a rescue raid is twice as likely for 10 days.
//     trade back: free, goodwill +10 with their group. Release: goodwill +4 (they go home).
//     recruit (slow): a prisoner treated well grows to like you, 1 a day × (1 + 4% a point of the best talker's
//       Speech + 3% a point of the leader's Leadership) × mood (the base's average mood / 55, 0.6–1.3) × their kind
//       (zealots 0.35, soldiers 0.6, a loner 1.2); hungry −2 a day. At 100 they ask to join (recruits.js card):
//       2–4 months. Held, opinion drifts up 0.2 a day (to 25).
//     execute: everyone at the base −6 mood (Brave or Tough −2, a Former Medic −8), goodwill −20 with their group
//       and −4 with every other group you know, infamy +3 (conquest.js); the other prisoners there are cowed for 14
//       days (escapes halved, mood −10).
//   Their group may come for them: a rescue raid each day with 1.2% per prisoner it has in a base (×1.5 for an
//   aggressive group, ×2 after a refused ransom, ×0.3 while friendly; it needs 6+ people and a base within 25
//   tiles). It arrives 10 hours after the warning: defend in person (the deploy battle), man the walls (by the
//   numbers: the base's defence ×1.3 against their strength), or hand them over (goodwill +3). Lost, they free
//   every prisoner of theirs there and carry off a tenth of the stores.
// Your own people taken captive by other groups are conflicts.js captives, not these.
import { SUPPLIES } from "./data.js";
import {
  log, addCard, day, baseById, atBase, factionById, makeSurvivor, skill, snapshot, mergeKnowledge, hurt, newId,
} from "./world.js";
import { partyMembers, carried, takeSupply, tileLabel } from "./parties.js";
import { count } from "./buildings.js";
import { changeGoodwill, attitude, strength, isAggressiveType, baseDefense } from "./factions.js";
import { raidTier } from "./defences.js";
import { available } from "./trade.js";
import { offerRecruits } from "./recruits.js";
import { addMood } from "./relations.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { raidForce } from "./conflicts.js";
import { thirstAt } from "./weather.js";
import { coldFactor, foodUse } from "./upkeep.js";
import { eatFromStore, foodStore } from "./storage.js";
import { underAttack } from "./buildings.js";
import { ensureConquest, CONQUEST } from "./conquest.js";

export const PRISON = {
  CELL_CAP: 3, FOOD: 1, WATER: 1,
  ESCAPE: { guarded: 0.004, unguarded: 0.03, shed: 0.08, unfed: 0.04, road: 0.05, vehicle: 0.02, lowMood: 20, lowMoodMult: 1.25 },
  ROAD_SLOW: 0.1, ROAD_MIN: 0.6, STARVE_DAYS: 6,
  QUESTION: {
    every: 3, base: 0.45, speech: 0.03, lead: 0.01, zealot: -0.25, soldiers: -0.15, hungry: 0.1, liked: 0.15, sour: -6,
    // Rough questioning: better odds, paid in their health and mood, your people's mood and their group's goodwill.
    rough: { odds: 0.2, health: -10, mood: -15, sour: -15, baseMood: -2, soft: -4, hard: 0, goodwill: -3 },
  },
  RANSOM: { value: 15, perPower: 4, days: [2, 4], pay: 0.4, goodwillPaid: -4, goodwillRefused: -3, angryDays: 10 },
  TRADE_BACK: 10, RELEASE: 4, HAND_OVER: 3,
  RECRUIT: { base: 1, speech: 0.04, lead: 0.03, hungry: -2, holdDrift: 0.2, holdCap: 25, kind: { zealots: 0.35, soldiers: 0.6, none: 1.2 } },
  // Asking a prisoner to join now: by their opinion of you, who they were, Leadership and Speech, rations, labour, mood.
  ASK: { from: 25, span: 75, kind: { zealots: 0.5, soldiers: 0.8, none: 1.2 }, lead: 0.01, speech: 0.01, mood: 1 / 200, min: 0.02, max: 0.95, fail: -8, gap: 7 },
  EXECUTE: { mood: -6, hardened: -2, soft: -8, goodwill: -20, others: -4, infamy: 3, fearDays: 14, fear: 0.5, fearMood: -10 },
  RESCUE: { chance: 0.012, aggressive: 1.5, angry: 2, friendly: 0.3, minPop: 6, range: 25, hours: 10, manned: 1.3, steal: 0.1 },
  // Rations at a base (food a day = FOOD × share × the cold). heal: health a day (toward healTo when positive; above
  // it they lose 0.5 a day back to it); mood: theirs a day; escape: × the day's escape chance; recruit: × the
  // winning-over rate (Starvation and None: opinion sours by sour a day instead of the held drift); ask: + the odds of
  // asking them to join; question: + the odds of questioning; labour: × their work.
  RATIONS: {
    full:   { name: "Full",       share: 1,   heal: 2,    healTo: 100, mood: 0.5, escape: 0.8, recruit: 1.2, sour: 0,  ask: 0.05,  question: 0,    labour: 1 },
    short:  { name: "Short",      share: 0.6, heal: 1,    healTo: 60,  mood: 0,   escape: 1,   recruit: 1,   sour: 0,  ask: 0,     question: 0,    labour: 0.9 },
    starve: { name: "Starvation", share: 0.3, heal: -1.5, healTo: 0,   mood: -1,  escape: 1.5, recruit: 0.4, sour: -0.5, ask: -0.15, question: 0.1,  labour: 0.6 },
    none:   { name: "None",       share: 0,   heal: -6,   healTo: 0,   mood: -3,  escape: 1,   recruit: 0,   sour: 0,  ask: -0.25, question: 0.15, labour: 0.3 },
  },
  RATION_DEFAULT: "short",
  WEAK: { health: 20, death: 0.03 }, // on Starvation or None below this health: a chance a day of dying
  // Your people seeing prisoners starve (Starvation or None at their base): mood a day; soft: Former Medic; hard: Brave, Tough.
  SEEN: { mood: -1, soft: -2, hard: 0, softTraits: ["medic"], hardTraits: ["brave", "tough"] },
  // Prisoner labour. skill: the task's skill (output min + perSkill a point, up to max of a survivor; null: the middle);
  // hours: out of the cell 07–19 (construction counts hours/24 of an hour's work each hour); minHealth: too weak below;
  // water: water a day at full output; kitchen: fresh food dried a day at full output → out preserved, from food
  // outside the stores or above keepDays of eating; guardWatch: labourers one guard watches; escape*: a day at work;
  // tire: health and mood a day at work by rations; recruit*: winning-over and asking bonuses a day of good work.
  LABOUR: {
    min: 0.5, max: 0.7, perSkill: 0.02, hours: 12, minHealth: 25, healthFull: 60,
    water: 4, kitchen: { food: 4, out: 3, keepDays: 15 },
    guardWatch: 4, escapeGuarded: 0.01, escapeUnguarded: 0.07,
    tire: { full: { health: 0, mood: -0.5 }, short: { health: -0.5, mood: -1 }, starve: { health: -1.5, mood: -2 }, none: { health: -3, mood: -3 } },
    goodDay: 0.4, recruitPerDay: 0.01, recruitMax: 0.4, askPerDay: 0.004, askMax: 0.1,
  },
};
// What a prisoner can be set to do (LABOUR above). out: what a full-output worker adds, for the UI.
export const TASKS = {
  idle:    { name: "Idle (in the cell)", skill: null, out: "" },
  farm:    { name: "Farm", skill: "farming", out: "farm labour: the crops' care, as a farmer at that share" },
  build:   { name: "Build", skill: "mechanics", out: "construction: builder-hours on the queued build (12 hours a day)" },
  water:   { name: "Fetch water", skill: null, out: `water: ${PRISON.LABOUR.water} a day at full output (up to the tanks' room)` },
  kitchen: { name: "Kitchen", skill: "farming", out: `dries and salts surplus fresh food by hand: ${PRISON.LABOUR.kitchen.food} → ${PRISON.LABOUR.kitchen.out} preserved a day at full output` },
  upkeep:  { name: "Clean and mend", skill: "mechanics", out: "keeps worn buildings in shape (wear off, as a builder's upkeep)" },
};
const KIND_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (name) => String(name).split(" ")[0];
const listNames = (list) => list.map((p) => p.name).join(", ");

export const prisonersOf = (state) => state.prisoners || (state.prisoners = []);
export const prisonersAt = (state, baseId) => (state.prisoners || []).filter((p) => p.at.kind === "base" && p.at.baseId === baseId);
export const prisonersWith = (state, partyId) => (state.prisoners || []).filter((p) => p.at.kind === "party" && p.at.partyId === partyId);
export const cellCap = (base) => (base ? count(base, "cells") * PRISON.CELL_CAP : 0);
export const freeCells = (state, base) => (base ? Math.max(0, cellCap(base) - prisonersAt(state, base.id).length) : 0);
export const guardsAt = (state, base) => atBase(state, base.id).filter((s) => s.role === "guard" && !s.inBed);
export const guarded = (state, base) => guardsAt(state, base).length > 0;

// ---------- rations and labour ----------
// A prisoner's rations and task (old saves and records without them: Short, Idle).
export const rationOf = (p) => (p && PRISON.RATIONS[p.ration] ? p.ration : PRISON.RATION_DEFAULT);
export const taskOf = (p) => (p && TASKS[p.task] ? p.task : "idle");
const rationDef = (p) => PRISON.RATIONS[rationOf(p)];
// Food a prisoner eats a day at a base, before the cold.
export const prisonerFood = (p) => PRISON.FOOD * rationDef(p).share;
// Food the prisoners held at a base eat a day, before the cold (upkeep.js foodUse: their line).
export const prisonFoodAt = (state, base) => prisonersAt(state, base.id).reduce((a, p) => a + prisonerFood(p), 0);
const health = (p) => (p.s && Number.isFinite(p.s.health) ? p.s.health : 50);
const mood = (p) => (p.s && Number.isFinite(p.s.mood) ? p.s.mood : 30);
const hasTrait = (s, list) => (s.traits || []).some((t) => list.includes(t));

// What a prisoner does at work, as a share of a survivor: 0.5–0.7 by the task's skill, × rations × health. 0: idle,
// too weak, not at a base, or the base is under attack (everyone is locked in).
export function labourOutput(state, p, base = null) {
  const task = taskOf(p);
  if (task === "idle" || !p.at || p.at.kind !== "base") return 0;
  const b = base || baseById(state, p.at.baseId);
  if (!b || health(p) < PRISON.LABOUR.minHealth || underAttack(state, b)) return 0;
  const L = PRISON.LABOUR, T = TASKS[task];
  const eff = T.skill && p.s ? clamp(L.min + skill(p.s, T.skill) * L.perSkill, L.min, L.max) : (L.min + L.max) / 2;
  return Math.round(eff * rationDef(p).labour * clamp(health(p) / L.healthFull, 0.3, 1) * 1000) / 1000;
}
// The labour of every prisoner on `task` at a base (shares of a survivor).
export const prisonLabour = (state, base, task) => prisonersAt(state, base.id).reduce((a, p) => a + (taskOf(p) === task ? labourOutput(state, p, base) : 0), 0);
// Construction an hour from prisoners on Build (buildings.js buildRate): out 12 hours of the 24.
export const prisonBuildRate = (state, base) => prisonLabour(state, base, "build") * (PRISON.LABOUR.hours / 24);
// Water a day hauled by prisoners on Fetch water (economy.js waterProduction).
export const prisonWater = (state, base) => Math.round(prisonLabour(state, base, "water") * PRISON.LABOUR.water * 10) / 10;
// The prisoners out at work at a base (output > 0), the first ones (by id) watched by the guards: { guards, workers,
// watched: Set of ids, cap }.
export function labourWatch(state, base) {
  const guards = guardsAt(state, base).length;
  const workers = prisonersAt(state, base.id).filter((p) => labourOutput(state, p, base) > 0).sort((a, b) => a.id - b.id);
  const cap = guards * PRISON.LABOUR.guardWatch;
  return { guards, workers, cap, watched: new Set(workers.slice(0, cap).map((p) => p.id)) };
}
// Guards a base wants on duty for its prisoners (work.js, the Guard work type): one for the cells, one for each 4 at work.
export function prisonGuardsWanted(state, base) {
  const list = prisonersAt(state, base.id);
  if (!list.length) return 0;
  const workers = list.filter((p) => taskOf(p) !== "idle").length;
  return Math.max(1, Math.ceil(workers / PRISON.LABOUR.guardWatch));
}

// The day's escape chance of a prisoner at a base (watch: labourWatch for the base; fed: predicted when not given).
export function escapeOdds(state, p, { watch = null, fed = null } = {}) {
  const base = heldAt(state, p);
  if (!base) return 0;
  const E = PRISON.ESCAPE;
  let e = inCell(state, p) ? (guarded(state, base) ? E.guarded : E.unguarded) : E.shed;
  if (labourOutput(state, p, base) > 0) {
    const w = watch || labourWatch(state, base);
    e = Math.max(e, w.watched.has(p.id) ? PRISON.LABOUR.escapeGuarded : PRISON.LABOUR.escapeUnguarded);
  }
  const R = rationDef(p);
  e *= R.escape;
  if (mood(p) < E.lowMood) e *= E.lowMoodMult;
  if (base.prisonFear && day(state) <= base.prisonFear) e *= PRISON.EXECUTE.fear;
  const willEat = fed ?? (R.share > 0 && (base.stock.food || 0) + (base.stock.preserved || 0) >= PRISON.FOOD * R.share * coldFactor(state) && (base.stock.water || 0) >= PRISON.WATER * thirstAt(state));
  if (!willEat) e += E.unfed;
  return clamp(e, 0, 1);
}

export function setRation(state, id, ration) {
  const p = byId(state, id);
  if (!p || !PRISON.RATIONS[ration]) return "";
  p.ration = ration;
  const R = PRISON.RATIONS[ration];
  return `${first(p.name)} is on ${R.name} rations (${Math.round(R.share * PRISON.FOOD * 100) / 100} food a day).`;
}
export function setAllRations(state, baseId, ration) {
  if (!PRISON.RATIONS[ration]) return "";
  const list = prisonersAt(state, Number(baseId));
  for (const p of list) p.ration = ration;
  return list.length ? `Every prisoner here is on ${PRISON.RATIONS[ration].name} rations.` : "";
}
export function setTask(state, id, task) {
  const p = byId(state, id);
  if (!p || !TASKS[task]) return "";
  p.task = task;
  if (task === "idle") return `${first(p.name)} stays in the cell.`;
  const base = heldAt(state, p);
  const out = base ? labourOutput(state, p, base) : 0;
  return `${first(p.name)} goes out to work: ${TASKS[task].name} (${Math.round(out * 100)}% of a survivor)${base && !guarded(state, base) ? ". Nobody is on guard: they may run" : ""}.`;
}
export function setAllTasks(state, baseId, task) {
  if (!TASKS[task]) return "";
  const list = prisonersAt(state, Number(baseId));
  for (const p of list) p.task = task;
  return list.length ? (task === "idle" ? "Every prisoner here stays in the cells." : `Every prisoner here goes out to work: ${TASKS[task].name}.`) : "";
}
// Who is in a cell (the first ones caught) and who sits in the shed.
export function inCell(state, p) {
  if (p.at.kind !== "base") return false;
  const base = baseById(state, p.at.baseId);
  return prisonersAt(state, p.at.baseId).indexOf(p) < cellCap(base);
}

// ---------- taking prisoners ----------
// Records for the knocked out of a finished battle (combat.js endBattle / endRaid): a person each, with a name,
// skills and traits (a candidate if they are ever recruited).
export function captiveRecords(state, b, captives) {
  if (!captives || !captives.length) return [];
  const e = b.setup.enemy || {};
  return captives.map((u) => {
    const fid = u.factionId ?? e.factionId ?? null;
    const f = fid != null ? factionById(state, fid) : null;
    return makeRecord(state, { factionId: fid, group: f ? f.name : e.name || "strangers", kit: u.kit || "raiders", power: e.power || 3, unitName: u.name, tile: b.tileId });
  });
}
function makeRecord(state, o) {
  const s = makeSurvivor(state, 0.8);
  s.pending = true;
  s.health = state.rng.int(35, 75);
  s.mood = 30;
  return { id: newId(), name: s.name, s, factionId: o.factionId, group: o.group, kit: o.kit, power: o.power, unitName: o.unitName || "", tile: o.tile, at: null, caught: null, mode: "hold", opinion: 0, questioned: null, intelDone: false, ransom: null, unfed: 0, report: "", ration: PRISON.RATION_DEFAULT, task: "idle", labourDays: 0, asked: null };
}

// Defenders who surrendered when you took their base (conquest.js): n prisoners of group f, held at that base.
// Their group's head count is the caller's (the base's people are counted out there).
export function takePrisonersAt(state, f, base, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = makeRecord(state, { factionId: f.id, group: f.name, kit: KIND_OF[f.type], power: 3, tile: base.tile });
    p.at = { kind: "base", baseId: base.id };
    p.caught = day(state);
    prisonersOf(state).push(p);
    out.push(p);
  }
  if (out.length) state.stats.prisonersTaken = (state.stats.prisonersTaken || 0) + out.length;
  return out;
}

// The base a battle's prisoners would end up in.
function destination(state, setup) {
  if (setup.baseId != null) return baseById(state, setup.baseId);
  const p = setup.partyId != null ? state.parties.find((x) => x.id === setup.partyId) : null;
  return p ? baseById(state, p.homeBaseId) || state.bases.find((x) => x.type === "hub") : null;
}

// After every battle (combat.js finishCombat, before its handler): the knocked out go with the team, or straight
// into the cells when the fight was at a base. A battle by the numbers takes none, except the Aggressive autopilot
// that wants intel on a group (half the time, one, if a cell is free at home).
export function capturePrisoners(state, setup, result, battle) {
  let list = (result && result.prisoners) || [];
  if (!list.length && result && !result.tactical) list = numbersCapture(state, setup, result);
  if (!list.length) return [];
  // Left behind (never held, so their group's head count was never touched): goodwill for the mercy.
  const leave = (ps) => { for (const p of ps) { const f = factionById(state, p.factionId); if (f && f.alive) changeGoodwill(state, f, 2, "you let their people go after the fight"); } };
  if (battle && battle.leavePrisoners) {
    leave(list);
    log(state, `You left ${listNames(list)} tied up behind. Someone will find them.`, "info");
    return [];
  }
  const party = setup.partyId != null ? state.parties.find((x) => x.id === setup.partyId) : null;
  const base = setup.baseId != null ? baseById(state, setup.baseId) : null;
  let at = null;
  if (party && partyMembers(state, party).length) at = { kind: "party", partyId: party.id };
  else if (base && state.bases.includes(base)) at = { kind: "base", baseId: base.id };
  if (!at) return [];
  // The autopilot holds prisoners only where it has a free cell (its home base for a team).
  if (state.autopilot) {
    const room = freeCells(state, destination(state, setup));
    leave(list.slice(room));
    list = list.slice(0, room);
    if (!list.length) return [];
  }
  const all = prisonersOf(state);
  for (const p of list) {
    p.at = at;
    p.caught = day(state);
    all.push(p);
    const f = factionById(state, p.factionId);
    if (f) f.pop = Math.max(0, f.pop - 1);
  }
  state.stats.prisonersTaken = (state.stats.prisonersTaken || 0) + list.length;
  if (party) teamPace(state, party);
  const where = at.kind === "party" ? "They walk with the team, tied." : `They are locked up at ${base.name}.`;
  log(state, `Taken prisoner: ${listNames(list)} (${list[0].group}). ${where}`, "good");
  return list;
}

function numbersCapture(state, setup, result) {
  if (!state.autopilot || result.outcome !== "victory" || !setup.enemy || setup.enemy.kind === "zombies") return [];
  if (!state.governor || state.governor.personality !== "aggressive") return [];
  if (!wantsIntel(state, setup.enemy.factionId) || !freeCells(state, destination(state, setup))) return [];
  if (!state.rng.chance(0.5)) return [];
  const f = factionById(state, setup.enemy.factionId);
  return [makeRecord(state, { factionId: f.id, group: f.name, kind: KIND_OF[f.type], kit: KIND_OF[f.type], power: setup.enemy.power || 3, tile: setup.tile })];
}
// A group worth asking about: alive, and some of its bases not yet on your map.
export function wantsIntel(state, fid) {
  const f = fid != null ? factionById(state, fid) : null;
  if (!f || !f.alive) return false;
  return !f.known || f.bases.some((t) => !(state.knowledge[t] && state.knowledge[t].factionBase === f.id));
}

// Walking prisoners slow a team on foot (parties.js partySpeed reads p.prisonSpeed).
export function teamPace(state, party) {
  const n = prisonersWith(state, party.id).length;
  party.prisonSpeed = !n || party.vehicle === true ? 1 : Math.max(PRISON.ROAD_MIN, 1 - PRISON.ROAD_SLOW * n);
  if (party.prisonSpeed === 1) delete party.prisonSpeed;
}

// A team home (parties.js returnHome): its prisoners go to that base's cells.
export function prisonersHome(state, party, home) {
  const list = prisonersWith(state, party.id);
  if (!list.length || !home) return;
  for (const p of list) p.at = { kind: "base", baseId: home.id };
  delete party.prisonSpeed;
  const shed = prisonersAt(state, home.id).length - cellCap(home);
  log(state, `${listNames(list)} ${list.length === 1 ? "is" : "are"} locked up at ${home.name}${shed > 0 ? `; ${shed} sit${shed === 1 ? "s" : ""} in a shed (no free cell: build Holding cells)` : ""}.`, "info");
}

// A prisoner leaves your hands: back to their group (pop +1), with goodwill if given.
function goHome(state, p, goodwill = 0, why = "") {
  const i = (state.prisoners || []).indexOf(p);
  if (i >= 0) state.prisoners.splice(i, 1);
  const f = factionById(state, p.factionId);
  if (f && f.alive) {
    f.pop += 1;
    if (goodwill) changeGoodwill(state, f, goodwill, why);
  }
  refreshTeam(state, p);
}
function drop(state, p) {
  const i = (state.prisoners || []).indexOf(p);
  if (i >= 0) state.prisoners.splice(i, 1);
  refreshTeam(state, p);
}
function refreshTeam(state, p) {
  if (p.at && p.at.kind === "party") { const party = state.parties.find((x) => x.id === p.at.partyId); if (party) teamPace(state, party); }
}

// ---------- at a base: what you can do ----------
const byId = (state, id) => (state.prisoners || []).find((p) => p.id === Number(id));
const heldAt = (state, p) => (p && p.at.kind === "base" ? baseById(state, p.at.baseId) : null);
export const bestSpeaker = (state, base) => atBase(state, base.id).reduce((m, s) => (!m || skill(s, "speech") > skill(m, "speech") ? s : m), null);

const leaderAt = (state, base) => atBase(state, base.id).find((s) => s.leader) || null;
// Odds of questioning getting answers (method "rough": harsher, better odds, costs; see the header).
export function questionOdds(state, p, method = "talk") {
  const base = heldAt(state, p);
  const sp = base ? bestSpeaker(state, base) : null;
  const lead = base ? leaderAt(state, base) : null;
  const Q = PRISON.QUESTION;
  const hunger = Math.max(rationDef(p).question, p.unfed ? Q.hungry : 0); // hunger loosens tongues (rations or empty stores)
  return clamp(Q.base + (sp ? skill(sp, "speech") : 0) * Q.speech + (lead ? skill(lead, "leadership") : 0) * Q.lead + (p.kit === "zealots" ? Q.zealot : 0) + (p.kit === "soldiers" ? Q.soldiers : 0) + hunger + (p.opinion > 40 ? Q.liked : 0) + (method === "rough" ? Q.rough.odds : 0), 0.1, 0.95);
}
export const canQuestion = (state, p) => !!heldAt(state, p) && (p.questioned == null || day(state) - p.questioned >= PRISON.QUESTION.every);

export function questionPrisoner(state, id, method = "talk") {
  const p = byId(state, id);
  const base = heldAt(state, p);
  if (!p || !base) return "They are not held at a base.";
  if (!canQuestion(state, p)) return `${first(p.name)} was questioned on day ${p.questioned}. Try again in a few days.`;
  const rough = method === "rough";
  const chance = questionOdds(state, p, method);
  p.questioned = day(state);
  p.opinion += rough ? PRISON.QUESTION.rough.sour : PRISON.QUESTION.sour;
  if (rough) {
    const R = PRISON.QUESTION.rough, S = PRISON.SEEN;
    if (p.s) { p.s.health = Math.max(1, health(p) + R.health); p.s.mood = clamp(mood(p) + R.mood, 0, 100); }
    for (const s of atBase(state, base.id)) addMood(state, s, hasTrait(s, S.hardTraits) ? R.hard : hasTrait(s, S.softTraits) ? R.soft : R.baseMood, `${first(p.name)} was questioned roughly`);
    const f = factionById(state, p.factionId);
    if (f && f.alive) changeGoodwill(state, f, R.goodwill, "you mistreated their people");
    state.stats.roughQuestioning = (state.stats.roughQuestioning || 0) + 1;
  }
  if (!state.rng.chance(chance)) return `${p.name} says nothing useful (${Math.round(chance * 100)}%)${rough ? ", even roughed up" : ""}.`;
  const intel = gatherIntel(state, p, !p.intelDone);
  p.intelDone = true;
  p.report = intel.text;
  log(state, `${p.name} talked: ${intel.text}`, "good");
  return `${p.name} talks. ${intel.text}`;
}

// What a prisoner knows, put on your map as knowledge snapshots. full: their group's bases and stock too.
export function gatherIntel(state, p, full = true) {
  const g = state.grid;
  const f = factionById(state, p.factionId);
  const tiles = new Set();
  const lines = [];
  const near = f && f.alive && f.bases.length ? f.bases[0] : p.tile;
  if (f && f.alive) {
    if (full) {
      for (const t of f.bases) tiles.add(t);
      f.known = true;
      f.intel = { day: day(state), pop: f.pop, food: Math.round(f.stock.food || 0), ammo: Math.round(f.stock.ammo || 0), scrap: Math.round(f.stock.scrap || 0), fuel: Math.round(f.stock.fuel || 0), meds: Math.round(f.stock.meds || 0) };
      lines.push(`${f.name} hold ${f.bases.map((t) => tileLabel(state, t)).join(", ")}: about ${f.pop} people, ${f.intel.food} food, ${f.intel.ammo} ammo, ${f.intel.meds} meds, ${f.intel.fuel} fuel.`);
    }
    const out = state.parties.filter((q) => q.owner === f.id && q.path);
    for (const q of out) tiles.add(q.path[Math.min(q.idx || 0, q.path.length - 1)]);
    lines.push(out.length ? `They have ${out.length} part${out.length === 1 ? "y" : "ies"} out (${out.map((q) => `${q.kind === "raid" ? "a raid" : q.kind === "caravan" ? "a caravan" : q.kind === "scav" ? "a scavenging party" : `a ${q.kind}`} near ${tileLabel(state, q.path[Math.min(q.idx || 0, q.path.length - 1)])}`).join("; ")}).` : "No patrols out right now.");
  } else if (full) lines.push(`${p.group} were on their own: no base to tell of.`);
  let hives = 0, hordes = 0;
  if (near != null) {
    for (const t of state.tiles) if (t.hive && g.distance(t.id, near) <= 10) { tiles.add(t.id); hives++; }
    for (const h of state.hordes) if (g.distance(h.tile, near) <= 8) { tiles.add(h.tile); hordes++; }
    lines.push(hives || hordes ? `They have seen ${hives ? `${hives} hive${hives === 1 ? "" : "s"}` : ""}${hives && hordes ? " and " : ""}${hordes ? `${hordes} horde${hordes === 1 ? "" : "s"}` : ""} near ${tileLabel(state, near)}.` : `No hives near ${tileLabel(state, near)}, they say.`);
  }
  mergeKnowledge(state, new Map([...tiles].map((t) => [t, snapshot(state, t)])));
  return { text: lines.join(" "), tiles: tiles.size };
}

// Ransom: what their group would pay (the good it can best spare).
export function ransomTerms(state, p) {
  const f = factionById(state, p.factionId);
  if (!f || !f.alive) return null;
  const value = PRISON.RANSOM.value + PRISON.RANSOM.perPower * (p.power || 3);
  let best = null;
  for (const key of ["ammo", "food", "meds", "scrap", "fuel", "parts"]) {
    const qty = Math.ceil(value / SUPPLIES[key].value);
    const spare = available(f, key);
    const score = Math.min(1, spare / qty);
    if (!best || score > best.score) best = { key, qty, score };
  }
  return best ? { key: best.key, qty: best.qty, value } : null;
}
export function askRansom(state, id) {
  const p = byId(state, id);
  const base = heldAt(state, p);
  if (!p || !base) return "They are not held at a base.";
  if (p.ransom) return `Already waiting for ${p.group}'s answer.`;
  const terms = ransomTerms(state, p);
  if (!terms) return `${p.group} are gone: nobody to pay for ${first(p.name)}.`;
  const [lo, hi] = PRISON.RANSOM.days;
  p.ransom = { asked: day(state), due: day(state) + state.rng.int(lo, hi), key: terms.key, qty: terms.qty };
  return `Word goes to ${p.group}: ${terms.qty} ${terms.key} for ${p.name}. An answer in a few days.`;
}
function ransomAnswer(state, p) {
  const f = factionById(state, p.factionId);
  const base = heldAt(state, p);
  const r = p.ransom;
  p.ransom = null;
  if (!f || !f.alive || !base) return;
  const R = PRISON.RANSOM;
  const chance = clamp(R.pay + f.goodwill / 200 - (isAggressiveType(f) ? 0.15 : 0), 0.1, 0.9);
  const can = Math.floor(Math.min(r.qty, available(f, r.key)));
  if (can >= Math.ceil(r.qty * 0.5) && state.rng.chance(chance)) {
    f.stock[r.key] = Math.max(0, (f.stock[r.key] || 0) - can);
    base.stock[r.key] = (base.stock[r.key] || 0) + can;
    goHome(state, p, R.goodwillPaid, "you ransomed their people");
    const text = `${f.name} paid ${can} ${r.key} for ${p.name}, who walks home.`;
    log(state, text, "good");
    addCard(state, { title: "Ransom paid", text, choices: [{ label: "OK", resolve: () => "" }] });
  } else {
    changeGoodwill(state, f, R.goodwillRefused, "you held their people for ransom");
    f.angryUntil = day(state) + R.angryDays;
    const text = `${f.name} will not pay for ${p.name}. They may come for their people instead.`;
    log(state, text, "danger");
    addCard(state, { title: "Ransom refused", text, choices: [{ label: "OK", resolve: () => "" }] });
  }
}

export function tradeBack(state, id) {
  const p = byId(state, id);
  if (!p || !heldAt(state, p)) return "They are not held at a base.";
  const f = factionById(state, p.factionId);
  if (!f || !f.alive) return releasePrisoner(state, id);
  goHome(state, p, PRISON.TRADE_BACK, "you returned their people");
  return `${p.name} goes back to ${f.name}, unharmed. They will remember it (goodwill +${PRISON.TRADE_BACK}).`;
}
export function releasePrisoner(state, id) {
  const p = byId(state, id);
  if (!p) return "Nobody to release.";
  const f = factionById(state, p.factionId);
  goHome(state, p, f && f.alive ? PRISON.RELEASE : 0, "you let their people go");
  return `${p.name} is let go${f && f.alive ? ` and heads back to ${f.name}` : ""}.`;
}
export function setMode(state, id, mode) {
  const p = byId(state, id);
  if (!p || !["hold", "recruit"].includes(mode)) return "";
  p.mode = mode;
  return mode === "recruit" ? `${first(p.name)} gets decent food, talk and a little trust. It will take months.` : `${first(p.name)} is just held.`;
}
export function executePrisoner(state, id) {
  const p = byId(state, id);
  const base = heldAt(state, p);
  if (!p || !base) return "They are not held at a base.";
  drop(state, p);
  const E = PRISON.EXECUTE, S = PRISON.SEEN;
  for (const s of atBase(state, base.id)) addMood(state, s, hasTrait(s, S.hardTraits) ? E.hardened : hasTrait(s, S.softTraits) ? E.soft : E.mood, `${first(p.name)} was executed`);
  const f = factionById(state, p.factionId);
  if (f && f.alive) changeGoodwill(state, f, E.goodwill, "you executed one of their people");
  for (const o of state.factions) if (o !== f && o.alive && o.known) changeGoodwill(state, o, E.others, "word of an execution");
  const C = ensureConquest(state); // word gets round: infamy (conquest.js; it fades by itself)
  C.infamy = Math.min(CONQUEST.INFAMY.max, C.infamy + E.infamy);
  // The others held here saw it: cowed for a while.
  base.prisonFear = day(state) + E.fearDays;
  for (const o of prisonersAt(state, base.id)) if (o.s) o.s.mood = clamp(mood(o) + E.fearMood, 0, 100);
  state.stats.executions = (state.stats.executions || 0) + 1;
  log(state, `${p.name} of ${p.group} was executed at ${base.name}.`, "death");
  return `${p.name} is dead. Nobody at ${base.name} looks at each other for a while.`;
}
// What an execution would cost, for the UI: { mood, hardened, soft, goodwill, others, infamy, known (other groups) }.
export function executeCost(state, p) {
  const E = PRISON.EXECUTE;
  const f = factionById(state, p.factionId);
  return { ...E, group: f && f.alive ? f.name : null, known: state.factions.filter((o) => o !== f && o.alive && o.known).length, infamyNow: ensureConquest(state).infamy };
}

// Recruit progress a day (a prisoner on "recruit", fed): × rations, + weeks of good labour.
export function recruitRate(state, p) {
  const base = heldAt(state, p);
  if (!base) return 0;
  const R = PRISON.RECRUIT, L = PRISON.LABOUR;
  const people = atBase(state, base.id);
  const sp = bestSpeaker(state, base);
  const lead = people.find((s) => s.leader);
  const mood = people.length ? people.reduce((a, s) => a + s.mood, 0) / people.length : 50;
  const kind = p.factionId == null ? R.kind.none : R.kind[p.kit] || 1;
  const work = 1 + Math.min(L.recruitMax, (p.labourDays || 0) * L.recruitPerDay);
  return R.base * kind * rationDef(p).recruit * work * (1 + (sp ? skill(sp, "speech") : 0) * R.speech + (lead ? skill(lead, "leadership") : 0) * R.lead) * clamp(mood / 55, 0.6, 1.3);
}

// Asking a prisoner to join now: the odds, and whether it can be asked today.
export function askOdds(state, p) {
  const base = heldAt(state, p);
  if (!base) return 0;
  const A = PRISON.ASK, L = PRISON.LABOUR;
  const sp = bestSpeaker(state, base), lead = leaderAt(state, base);
  const kind = p.factionId == null ? A.kind.none : A.kind[p.kit] || 1;
  const base0 = clamp((p.opinion - A.from) / A.span, 0, 1) * kind;
  const bonus = (lead ? skill(lead, "leadership") : 0) * A.lead + (sp ? skill(sp, "speech") : 0) * A.speech + rationDef(p).ask
    + Math.min(L.askMax, (p.labourDays || 0) * L.askPerDay) + (mood(p) - 30) * A.mood;
  return clamp(base0 + (base0 > 0 ? bonus : Math.min(0, bonus)), A.min, A.max);
}
export const canAsk = (state, p) => !!heldAt(state, p) && (p.asked == null || day(state) - p.asked >= PRISON.ASK.gap);
export function askToJoin(state, id) {
  const p = byId(state, id);
  const base = heldAt(state, p);
  if (!p || !base) return "They are not held at a base.";
  if (!canAsk(state, p)) return `${first(p.name)} was asked on day ${p.asked}. Give it until day ${p.asked + PRISON.ASK.gap}.`;
  const chance = askOdds(state, p);
  p.asked = day(state);
  if (state.rng.chance(chance)) { joinUs(state, p, base, "asked"); return `${p.name} says yes (${Math.round(chance * 100)}%).`; }
  p.opinion += PRISON.ASK.fail;
  return `${p.name} will not join you, not yet (${Math.round(chance * 100)}%). Opinion ${PRISON.ASK.fail}.`;
}
// A prisoner comes over: out of the cells, onto a recruit card (recruits.js).
function joinUs(state, p, base, how = "won") {
  drop(state, p);
  const f = factionById(state, p.factionId);
  if (f && f.alive) changeGoodwill(state, f, -2, "one of their people changed sides");
  p.s.health = Math.max(p.s.health, 60);
  p.s.mood = 50;
  offerRecruits(state, [p.s], {
    source: "prisoner", baseId: base.id, title: `${first(p.name)} asks to join`,
    intro: how === "asked" ? `Asked after ${day(state) - p.caught} days at ${base.name}, ${p.name}, once of ${p.group}, says yes: they will be one of you.` : `After ${day(state) - p.caught} days at ${base.name}, ${p.name}, once of ${p.group}, asks to be one of you.`,
  });
  state.stats.prisonersRecruited = (state.stats.prisonersRecruited || 0) + 1;
}

// ---------- every day ----------
export function prisonersDaily(state) {
  if (!(state.prisoners && state.prisoners.length)) return;
  const rng = state.rng;
  const today = day(state);
  const drink = Math.round(PRISON.WATER * thirstAt(state) * 100) / 100; // the day's thirst, as for anyone (weather.js)
  // Who is out at work and watched, a base at a time (before anyone eats or runs today).
  const watches = new Map();
  const watchAt = (base) => { if (!watches.has(base.id)) watches.set(base.id, labourWatch(state, base)); return watches.get(base.id); };
  const starvedAt = new Set(); // bases where your people saw prisoners go hungry today
  for (const p of [...state.prisoners]) {
    if (!state.prisoners.includes(p)) continue;
    let fed = false, escape = 0;
    if (p.at.kind === "party") {
      const party = state.parties.find((x) => x.id === p.at.partyId);
      if (!party) continue; // the hourly check frees them
      if (carried(party, "food") >= PRISON.FOOD && carried(party, "water") >= drink) { takeSupply(party, "food", PRISON.FOOD); takeSupply(party, "water", drink); fed = true; }
      escape = party.vehicle ? PRISON.ESCAPE.vehicle : PRISON.ESCAPE.road;
      teamPace(state, party);
    } else {
      const base = baseById(state, p.at.baseId);
      if (!base) continue;
      const watch = watchAt(base);
      const RD = rationDef(p);
      const work = labourOutput(state, p, base); // before today's meal and tiredness
      const food = (base.stock.food || 0) + (base.stock.preserved || 0);
      const eat = PRISON.FOOD * RD.share * coldFactor(state); // their rations, more in the cold, as for anyone at a base (upkeep.js)
      if (RD.share > 0 && food >= eat && (base.stock.water || 0) >= drink) {
        eatFromStore(base, eat); // fresh first, then preserved (its jars come back: storage.js)
        base.stock.water -= drink;
        fed = true;
      } else if (RD.share === 0 && (base.stock.water || 0) >= drink) base.stock.water -= drink; // no food, but they drink
      escape = escapeOdds(state, p, { watch, fed });
      // Health and mood by rations (unfed: as None), then the day's work.
      if (p.s) {
        const H = fed ? RD : PRISON.RATIONS.none;
        const h0 = health(p);
        p.s.health = H.heal > 0 ? (h0 < H.healTo ? Math.min(H.healTo, h0 + H.heal) : Math.max(H.healTo, h0 - 0.5)) : h0 + H.heal;
        p.s.mood = clamp(mood(p) + H.mood, 0, 100);
        if (work > 0) {
          const T = PRISON.LABOUR.tire[fed ? rationOf(p) : "none"];
          p.s.health += T.health;
          p.s.mood = clamp(mood(p) + T.mood, 0, 100);
          if (fed && work >= PRISON.LABOUR.goodDay && RD.share >= PRISON.RATIONS.short.share) p.labourDays = (p.labourDays || 0) + 1;
          if (taskOf(p) === "kitchen") handDry(state, base, work);
        }
        p.s.health = Math.min(100, Math.round(p.s.health * 10) / 10);
      }
      if (!fed || RD.share < PRISON.RATIONS.short.share) starvedAt.add(base.id);
      const R = PRISON.RECRUIT;
      if (fed && p.mode === "recruit") p.opinion += recruitRate(state, p);
      else if (fed && RD.sour) p.opinion += RD.sour;
      else if (fed && p.opinion < R.holdCap) p.opinion = Math.min(R.holdCap, p.opinion + R.holdDrift);
      if (p.ransom && today >= p.ransom.due) { ransomAnswer(state, p); if (!state.prisoners.includes(p)) continue; }
    }
    p.unfed = fed ? 0 : p.unfed + 1;
    if (!fed) { p.opinion += PRISON.RECRUIT.hungry; if (p.at.kind === "party") escape += PRISON.ESCAPE.unfed; } // at a base escapeOdds counted it
    if (p.unfed >= PRISON.STARVE_DAYS || (p.s && p.at.kind === "base" && p.s.health <= 0)) {
      const where = p.at.kind === "base" ? baseById(state, p.at.baseId) : null;
      drop(state, p);
      log(state, `${p.name}, a prisoner, starved to death${where ? ` at ${where.name}` : ""}.`, "death");
      state.stats.prisonersStarved = (state.stats.prisonersStarved || 0) + 1;
      continue;
    }
    // Weak and hungry: a chance of dying each day.
    if (p.s && p.at.kind === "base" && p.s.health < PRISON.WEAK.health && (!fed || rationDef(p).share < PRISON.RATIONS.short.share) && rng.chance(PRISON.WEAK.death)) {
      const where = baseById(state, p.at.baseId);
      drop(state, p);
      log(state, `${p.name}, a prisoner, wasted away in the cells at ${where.name}.`, "death");
      state.stats.prisonersStarved = (state.stats.prisonersStarved || 0) + 1;
      continue;
    }
    if (rng.chance(escape)) {
      const out = p.at.kind === "base" && labourOutput(state, p) > 0;
      goHome(state, p);
      log(state, `${p.name} (${p.group}) ${out ? "ran off from the work detail" : "slipped their bonds and escaped"}${p.at.kind === "base" ? ` at ${baseById(state, p.at.baseId).name}` : " from the team"}.`, "danger");
      state.stats.prisonersEscaped = (state.stats.prisonersEscaped || 0) + 1;
      continue;
    }
    if (p.at.kind === "base" && p.opinion >= 100) joinUs(state, p, baseById(state, p.at.baseId));
  }
  // Your people saw prisoners go hungry (Starvation, None or empty stores): a little mood, by who they are.
  const S = PRISON.SEEN;
  for (const id of starvedAt) {
    const base = baseById(state, id);
    if (!base) continue;
    for (const s of atBase(state, id)) addMood(state, s, hasTrait(s, S.hardTraits) ? S.hard : hasTrait(s, S.softTraits) ? S.soft : S.mood, "Prisoners going hungry");
  }
  rescueRolls(state);
}

// A prisoner in the kitchen dries and salts surplus fresh food by hand (no jars): food outside the stores, or above
// keepDays of everyone's eating, → preserved.
function handDry(state, base, work) {
  const K = PRISON.LABOUR.kitchen;
  const fresh = Math.max(0, base.stock.food || 0);
  if (fresh <= 0) return 0;
  const spare = Math.max(foodStore(state, base).outside, fresh - foodUse(state, base).total * K.keepDays);
  const take = Math.max(0, Math.min(K.food * work, spare));
  if (take <= 0) return 0;
  base.stock.food = fresh - take;
  if (base.meat) base.meat = Math.min(base.meat, base.stock.food); // fresh game (hunting.js) is part of the fresh food
  base.stock.preserved = (base.stock.preserved || 0) + take * (K.out / K.food);
  return take;
}
// What the kitchen hands at a base could dry today (the UI): { take, out }.
export function kitchenPlan(state, base) {
  const K = PRISON.LABOUR.kitchen;
  const work = prisonLabour(state, base, "kitchen");
  const fresh = Math.max(0, base.stock.food || 0);
  const spare = Math.max(foodStore(state, base).outside, fresh - foodUse(state, base).total * K.keepDays);
  const take = Math.max(0, Math.min(K.food * work, spare, fresh));
  return { work, take, out: take * (K.out / K.food), cap: K.food * work };
}

// ---------- rescue raids ----------
export function rescueChance(state, f, base) {
  const R = PRISON.RESCUE;
  if (!f || !f.alive || f.pop < R.minPop || !f.bases.length || !base) return 0;
  if (Math.min(...f.bases.map((t) => state.grid.distance(t, base.tile))) > R.range) return 0;
  const n = prisonersAt(state, base.id).filter((p) => p.factionId === f.id).length;
  if (!n) return 0;
  const att = attitude(f);
  return R.chance * n * (isAggressiveType(f) ? R.aggressive : 1) * (f.angryUntil && day(state) <= f.angryUntil ? R.angry : 1) * (att === "Friendly" || att === "Allied" ? R.friendly : 1);
}
function rescueRolls(state) {
  const rescues = state.rescues || (state.rescues = []);
  const pairs = new Map();
  for (const p of state.prisoners) if (p.at.kind === "base" && p.factionId != null) pairs.set(`${p.at.baseId}:${p.factionId}`, [p.at.baseId, p.factionId]);
  for (const [, [baseId, fid]] of pairs) {
    if (rescues.some((r) => r.baseId === baseId && r.factionId === fid)) continue;
    const base = baseById(state, baseId), f = factionById(state, fid);
    const c = rescueChance(state, f, base);
    if (c > 0 && state.rng.chance(c)) startRescue(state, f, base);
  }
}
export function startRescue(state, f, base) {
  const rescues = state.rescues || (state.rescues = []);
  const r = { id: newId(), factionId: f.id, baseId: base.id, strength: Math.round(Math.max(4, strength(f) * state.rng.range(0.25, 0.35)) * 10) / 10, arrive: state.hour + PRISON.RESCUE.hours, manned: false };
  rescues.push(r);
  log(state, `Lookouts at ${base.name} see ${f.name} fighters coming for their people.`, "danger");
  addCard(state, rescueCard(state, r));
  return r;
}
function rescueCard(state, r) {
  const f = factionById(state, r.factionId), base = baseById(state, r.baseId);
  const held = prisonersAt(state, base.id).filter((p) => p.factionId === f.id);
  const def = () => baseDefense(state, base);
  const pending = (st) => (st.rescues || []).includes(r) && st.bases.includes(base);
  return {
    title: `${f.name} come for their people`, kind: "rescue", rescueId: r.id,
    text: `About ${raidForce(f, r.strength).count} of ${f.name} (strength ${Math.round(r.strength)}) are heading for ${base.name} to free ${listNames(held)}. They arrive in about ${PRISON.RESCUE.hours} hours. Your defence there: about ${Math.round(def())}.`,
    choices: [
      {
        label: "Defend in person", hint: "Fight them on the base map now: place your defenders, then hold the walls. Lose and they take their people back.",
        ai: () => 0.5,
        resolve: (st) => {
          if (!pending(st)) return "They are gone.";
          st.rescues.splice(st.rescues.indexOf(r), 1);
          const force = raidForce(f, r.strength);
          startCombat(st, {
            tile: base.tile, baseId: base.id, enemy: { kind: KIND_OF[f.type] || "raiders", count: force.count, power: force.power, factionId: f.id, name: `${f.name} rescuers` },
            ambush: null, canRetreat: true, handler: "prisonRescue", layout: "baseDefence", deploy: true, // pulling out: they free their people and go
            context: { baseId: base.id, factionId: f.id, rescue: true },
          });
          return "";
        },
      },
      {
        label: "Man the walls", hint: `Everyone takes a post: the defence counts ${PRISON.RESCUE.manned}× (about ${Math.round(def() * PRISON.RESCUE.manned)} against ${Math.round(r.strength)}). Settled when they arrive.`,
        ai: (st) => (def() * PRISON.RESCUE.manned >= r.strength ? 2 : 1),
        resolve: (st) => { if (!pending(st)) return "They are gone."; r.manned = true; return `${base.name} mans the walls.`; },
      },
      {
        label: "Hand them over", hint: `Let ${listNames(held)} go to ${f.name} (goodwill +${PRISON.HAND_OVER}). No fight.`,
        ai: (st) => (def() * PRISON.RESCUE.manned < r.strength * 0.8 ? 3 : 0),
        resolve: (st) => {
          if (!pending(st)) return "They are gone.";
          st.rescues.splice(st.rescues.indexOf(r), 1);
          const list = prisonersAt(st, base.id).filter((p) => p.factionId === f.id);
          for (const p of list) goHome(st, p, 0);
          changeGoodwill(st, f, PRISON.HAND_OVER, "you handed their people back");
          return `${listNames(list) || "Nobody"} walk${list.length === 1 ? "s" : ""} out to ${f.name}. They turn for home.`;
        },
      },
    ],
  };
}
// They got in: every prisoner of theirs at the base goes free, and they take a share of the stores.
function rescueWon(state, f, base) {
  const list = prisonersAt(state, base.id).filter((p) => p.factionId === f.id);
  for (const p of list) goHome(state, p, 0);
  for (const k of Object.keys(base.stock)) base.stock[k] = Math.floor((base.stock[k] || 0) * (1 - PRISON.RESCUE.steal));
  return list;
}

registerCombatHandler("prisonRescue", (state, result, setup) => {
  const c = setup.context || {};
  const f = factionById(state, c.factionId), base = baseById(state, c.baseId);
  if (!f || !base) return;
  let text;
  if (result.outcome === "victory") {
    f.pop = Math.max(0, f.pop - Math.ceil((result.enemiesKilled || 0) * 0.7));
    changeGoodwill(state, f, -5, "you beat off their rescue");
    text = `${base.name} beat off ${f.name}'s rescue. Their people stay in the cells.`;
  } else {
    const freed = rescueWon(state, f, base);
    text = `${result.outcome === "retreat" ? "Your people pulled out. " : ""}${f.name} broke into ${base.name} and freed ${listNames(freed) || "nobody"}. They carried off a tenth of the stores.`;
  }
  log(state, text, result.outcome === "victory" ? "good" : "death");
  addCard(state, { title: "The rescue", text, choices: [{ label: "OK", resolve: () => "" }] });
});

// ---------- every hour ----------
export function prisonersHour(state) {
  if (state.prisoners && state.prisoners.length) {
    for (const p of [...state.prisoners]) {
      if (p.at.kind === "party" && !state.parties.some((x) => x.id === p.at.partyId)) {
        goHome(state, p);
        log(state, `${p.name}, a prisoner, got away in the confusion.`, "danger");
      } else if (p.at.kind === "base" && !baseById(state, p.at.baseId)) {
        goHome(state, p);
      }
    }
  }
  if (!(state.rescues && state.rescues.length)) return;
  for (const r of [...state.rescues]) {
    if (state.hour < r.arrive) continue;
    state.rescues.splice(state.rescues.indexOf(r), 1);
    const f = factionById(state, r.factionId), base = baseById(state, r.baseId);
    if (!f || !f.alive || !base) continue;
    if (!prisonersAt(state, base.id).some((p) => p.factionId === f.id)) { log(state, `${f.name} turn back: their people are no longer at ${base.name}.`, "info"); continue; }
    const def = baseDefense(state, base) * (r.manned ? PRISON.RESCUE.manned : 1);
    const att = r.strength * state.rng.range(0.8, 1.2);
    const rt = raidTier(state, base, def, att, 1, 1); // defences.js: the walls, then the yard
    let text;
    if (rt.yard >= 1) {
      f.pop = Math.max(0, f.pop - state.rng.int(1, 2));
      changeGoodwill(state, f, -5, "you beat off their rescue");
      text = `${base.name} drove off ${f.name}'s rescue ${rt.wall >= 1 ? "at the walls" : "in the yard"}.`;
    } else {
      const freed = rescueWon(state, f, base);
      const people = atBase(state, base.id);
      if (people.length) hurt(state, state.rng.pick(people), state.rng.int(15, 40), base.tile, `when ${f.name} came for their people`);
      text = `${f.name} got into ${base.name} and freed ${listNames(freed)}. They carried off a tenth of the stores.`;
    }
    log(state, text, rt.yard >= 1 ? "good" : "death");
    addCard(state, { title: "The rescue", text, choices: [{ label: "OK", resolve: () => "" }] });
  }
}

// ---------- the autopilot (autopilot.js autopilotDaily) ----------
// Questions each prisoner once (again every 10 days if their group is still a mystery), then by style: Cautious
// trades them back, Balanced asks a ransom (trades back when the group is gone or friendly), Aggressive keeps them
// on "recruit" while the base eats well, else ransoms. Starving prisoners are let go. Returns a log line or "".
export function autopilotPrisoners(state) {
  const list = (state.prisoners || []).filter((p) => p.at.kind === "base");
  if (!list.length) return "";
  const style = (state.governor && state.governor.personality) || "balanced";
  const done = [];
  for (const p of list) {
    if (!state.prisoners.includes(p)) continue;
    if (canQuestion(state, p) && (!p.intelDone || (wantsIntel(state, p.factionId) && day(state) - p.questioned >= 10))) done.push(questionPrisoner(state, p.id));
    if (p.unfed >= 2) { done.push(releasePrisoner(state, p.id)); continue; }
    const f = factionById(state, p.factionId);
    const att = f && f.alive ? attitude(f) : null;
    if (style === "cautious" || (att && (att === "Friendly" || att === "Allied"))) { if (p.intelDone || !f) done.push(tradeBack(state, p.id)); continue; }
    if (style === "aggressive") {
      const base = heldAt(state, p);
      const fat = base && (base.stock.food || 0) + (base.stock.preserved || 0) >= atBase(state, base.id).length * 10;
      if (fat || !f || !f.alive) { if (p.mode !== "recruit") done.push(setMode(state, p.id, "recruit")); continue; }
    }
    if (!f || !f.alive) { if (p.mode !== "recruit") done.push(setMode(state, p.id, "recruit")); continue; }
    if (p.intelDone && !p.ransom) done.push(askRansom(state, p.id));
  }
  return done.filter(Boolean).join(" ");
}

// ---------- for the UI ----------
export function prisonerView(state, p, watch = null) {
  const base = heldAt(state, p);
  const f = factionById(state, p.factionId);
  const w = base ? watch || labourWatch(state, base) : null;
  const work = base ? labourOutput(state, p, base) : 0;
  return {
    p, base, faction: f && f.alive ? f : null, days: day(state) - (p.caught || day(state)),
    cell: inCell(state, p), guarded: base ? guarded(state, base) : false,
    ration: rationOf(p), task: taskOf(p), food: prisonerFood(p) * coldFactor(state), work,
    watched: !!(w && w.watched.has(p.id)), escape: base ? escapeOdds(state, p, { watch: w }) : 0,
    question: { ok: canQuestion(state, p), odds: base ? questionOdds(state, p) : 0, rough: base ? questionOdds(state, p, "rough") : 0 },
    ask: { ok: canAsk(state, p), odds: base ? askOdds(state, p) : 0 },
    ransom: ransomTerms(state, p), rate: p.mode === "recruit" ? recruitRate(state, p) : 0,
    rescue: base && f ? rescueChance(state, f, base) : 0,
    execute: executeCost(state, p),
  };
}
// The Prisoners tab's summary for a base: food a day at their rations, labour by task, the day's escape risk.
export function prisonSummary(state, base) {
  const list = prisonersAt(state, base.id);
  const watch = labourWatch(state, base);
  const labour = {};
  for (const k of Object.keys(TASKS)) if (k !== "idle") labour[k] = prisonLabour(state, base, k);
  const escapes = list.map((p) => escapeOdds(state, p, { watch }));
  return {
    n: list.length, food: prisonFoodAt(state, base) * coldFactor(state), fullFood: list.length * PRISON.FOOD * coldFactor(state),
    water: list.length * PRISON.WATER * thirstAt(state), labour, watch, water_hauled: prisonWater(state, base),
    build: prisonBuildRate(state, base) * 24, kitchen: kitchenPlan(state, base),
    escapeExpected: escapes.reduce((a, e) => a + e, 0), escapeAny: 1 - escapes.reduce((a, e) => a * (1 - e), 1),
    hungry: list.filter((p) => rationDef(p).share < PRISON.RATIONS.short.share).length,
  };
}
