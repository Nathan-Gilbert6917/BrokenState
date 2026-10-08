// Prisoners: enemies knocked out in a won fight (stealth.js takedowns and Subdue) taken home.
//   On the road they walk with the team: on foot each slows it 10% (at least 60% of its pace; in a vehicle they
//   ride), they eat 1 food and 1 water a day from the team, and each tries to slip away (5% a day, 2% in a
//   vehicle). When the team gets home they go to that base's jail.
//   Jails (JAIL; buildings.js family "jail", each tier upgrading the one below in place): Makeshift cells hold 2,
//   Holding cells 3, a Jailhouse 8. No jail, no prisoners: a base keeps only as many as its jail holds (cellCap, less
//   those already on their way to it). A fight that takes more than your bases have room for, a team that comes home
//   with more than its base holds, or surrendered defenders with nowhere to go: each extra one gets a card (settle):
//   Release (goodwill +4), Execute (its costs), Ask to join on the spot (SPOT: one try at a penalty; no means they
//   go), or Hold at another base with room (they walk there with an escort, or with the team while it is still out).
//   The autopilot decides by itself (settleAI): hold where there is room, ask the skilled, release the rest. A team
//   in the field still leads its prisoners home as before (only the base needs room). Older saves: prisoners kept in
//   a shed (more than the cells held) stay there at the shed's rates until a cell frees up or they are let go.
//   A day costs 1 water each and their rations of food (below) from that base's stores (the food times the cold and
//   the water times the day's thirst, weather.js: 1.3 in summer, 1.6 on a hot day, 0.9 in winter, as for anyone;
//   upkeep.js counts them in the base's food and water lines). Escapes a day by the jail's tier, guarded (someone on
//   the Guard role) / unguarded: makeshift 2% / 6%, holding cells 0.4% / 3%, a jailhouse 0.2% / 1.5%; the old shed
//   8%; unfed +4%; six unfed days in a row and they die. What a prisoner has going for them (a pick, key or blade
//   smuggled in, a loner's ways, Stealth 6+: escapeKit) counts × the tier's bonus each (makeshift 1.5, cells 1.25, a
//   jailhouse 1.1). A makeshift cage (and the shed) sours them: mood −1 a day, won over at 0.6×.
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
//     and mend (wear off the buildings, breakdowns.js), Cut wood (firewood by hand from the best land within 2 tiles,
//     woodcutting.js rates, no axe), Haul and sort scrap (1.5 scrap a day). Each works at 50–70% of a survivor by the
//     task's skill (2% a point), times their rations (Full 1, Short 0.9, Starvation 0.6, None 0.3), health (under 60
//     less; under 25 they cannot) and mood (0.6 + 0.6 × mood / 100, 0.6–1.15: a broken prisoner works at 60%, a
//     content one a little above the rest). It tires them: mood −0.5 a day on Full, −1 Short, −2 Starvation, and
//     health −0.5 on Short, −1.5 Starvation. A guard (someone on the Guard role) watches up to 4 at work (3 from a
//     makeshift cage, all of them from a jailhouse's guard post); a watched labourer escapes 1% a day, an unwatched
//     one 4% (× the jail's labour: makeshift 1.5, a jailhouse 0.5); under mood 25 ×1.3 more, and now and then
//     (LABOUR.sabotage: 4% a day) they spoil a little of what they worked on. Weeks of good work (Full or Short) win them over: +1% a day worked to the winning-over rate
//     (up to +40%) and +0.4% to asking them to join (up to +10%). Nobody goes out while the base is under attack.
//   What you can do with them (at a base):
//     question (every 3 days): Speech decides (45% + 3% a point of the best talker + 1% a point of the leader's
//       Leadership, zealots −25%, soldiers −15%, hunger by rations or unfed +10–15%, one who likes you +15%; 10–95%).
//       Rough questioning: +20%, but it costs them 10 health and 15 mood, sours them −15 instead of −6, costs
//       everyone at the base 2 mood (a Former Medic 4, the Brave and Tough nothing) and 3 goodwill with their group.
//       The first answer gives their group's bases (and puts the group on your map), its people and stock, every
//       party it has out (raids included) and the hives near it, as knowledge snapshots; later answers the parties
//       and hives again. Each questioning sours them (−6).
//     ask to join (every 7 days; ASK): (opinion − 30) / 140 × who they were (zealots 0.5, soldiers 0.8, a loner 1.2)
//       + 0.5% a point of the leader's Leadership and of the best talker's Speech + rations + labour + (their mood −
//       30) / 200, 2–95% (the bonuses only once their opinion is above 30): at opinion 80 on Short with a good leader
//       and talker about 45% (Full ~50%, Starvation ~30%; with no Leadership or Speech 36%). Yes: they join (the recruit card); no: opinion −8.
//     hold for ransom: their group (alive) is asked for goods worth 15 + 4 × their power; it answers in 2–4 days:
//       pays (40% + goodwill / 200, −15% for aggressive groups, 10–90%; only what it can spare), goodwill −4 and the
//       prisoner walks home; or refuses: goodwill −3 and a rescue raid is twice as likely for 10 days.
//     trade back: free, goodwill +10 with their group. Release: goodwill +4 (they go home). Treated for the worm while
//       held (worm.js applyOtherTreat: the Prisoners and Medical tabs' buttons): goodwill +3 more either way.
//     the worm (worm.js): spotted and treated like a resident (a dewormer, a purge, surgery); their opinion of you
//       rises (+12 cured, +5 for a failed purge). Prisoners heal at half the rate while it is in them.
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
// Your own people taken captive by other groups are conflicts.js captives, not these; the groups' jails, labour and
// prisoner trades are groupjails.js (the same JAIL tiers).
import { SUPPLIES } from "./data.js";
import {
  log, addCard, day, baseById, atBase, factionById, makeSurvivor, skill, snapshot, mergeKnowledge, hurt, newId,
} from "./world.js";
import { partyMembers, carried, takeSupply, carriedAny, takeAny, tileLabel } from "./parties.js";
import { waterIn, drawWater } from "./water.js"; // purified and un-purified water (purified drunk first)
import { changeGoodwill, attitude, strength, isAggressiveType, baseDefense } from "./factions.js";
import { raidTier } from "./defences.js";
import { surpriseAt } from "./watch.js"; // a rescue that comes on an unwatched night
import { available } from "./trade.js";
import { offerRecruits } from "./recruits.js";
import { addMood } from "./relations.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { raidForce } from "./conflicts.js";
import { thirstAt } from "./weather.js";
import { coldFactor, foodUse } from "./upkeep.js";
import { eatFromStore, foodStore } from "./storage.js";
import { underAttack, isShelter } from "./buildings.js";
import { ensureConquest, CONQUEST } from "./conquest.js";
import { baseWoodTiles, seasonWood, takeWood, WOOD } from "./woodcutting.js"; // prisoners on Cut wood (by hand)
import { wormHealMult, WORM } from "./worm.js"; // the worm: half the healing while it is in them; treated prisoners (WORM.OTHERS)
import { jailText } from "./groupjails.js"; // what a prisoner tells of their group's jail
import { numbersSurrenders } from "./nonlethal.js"; // a decisive win by the numbers: a few of them give up

// The jail tiers (buildings.js family "jail"; the AI groups' jails too, groupjails.js), lower ones easier to get out
// of. cap: prisoners held; guarded / unguarded: escapes a day in the cell; bonus: × the escape for each thing a
// prisoner has going for them (escapeKit); labour: × the work detail's escapes; watch: labourers one guard watches;
// mood: theirs a day; opinion: × winning them over and the held drift; defence: × the base's defence against a rescue
// raid by their group; block: what a rescue raid's map would show (the rescue branch, groupjails.js groupJailTier).
// The holding cells' escapes are PRISON.ESCAPE's guarded and unguarded (0.4% / 3%, as they always were), a jailhouse's
// half of those (0.2% / 1.5%), the shed's PRISON.ESCAPE.shed (8%): read at the time, so a tool that changes the rules
// changes them all.
export const JAIL = {
  lockup:    { tier: 1, name: "Makeshift cells", cap: 2, guarded: 0.02, unguarded: 0.06, bonus: 1.5,  labour: 1.5, watch: 3,  mood: -1, opinion: 0.6, defence: 0.85, block: "a chain-link cage" },
  cells:     { tier: 2, name: "Holding cells",   cap: 3, get guarded() { return PRISON.ESCAPE.guarded; }, get unguarded() { return PRISON.ESCAPE.unguarded; }, bonus: 1.25, labour: 1, watch: 4, mood: 0, opinion: 1, defence: 1, block: "barred cells" },
  jailhouse: { tier: 3, name: "Jailhouse",       cap: 8, get guarded() { return PRISON.ESCAPE.guarded / 2; }, get unguarded() { return PRISON.ESCAPE.unguarded / 2; }, bonus: 1.1, labour: 0.5, watch: 99, mood: 0, opinion: 1.1, defence: 1.25, block: "a jailhouse block" },
};
// By tier number (0: none).
export const JAIL_TIERS = [null, JAIL.lockup, JAIL.cells, JAIL.jailhouse];
// Older saves: prisoners beyond the cells sit in a shed (nobody new is put there).
export const SHED = { tier: 0, name: "Shed", cap: 0, get guarded() { return PRISON.ESCAPE.shed; }, get unguarded() { return PRISON.ESCAPE.shed; }, bonus: 1.5, labour: 1.5, watch: 3, mood: -1, opinion: 0.6, defence: 0.85 };
export const PRISON = {
  CELL_CAP: 3, FOOD: 1, WATER: 1,
  ESCAPE: { guarded: 0.004, unguarded: 0.03, shed: 0.08, unfed: 0.04, road: 0.05, vehicle: 0.02, lowMood: 20, lowMoodMult: 1.25 },
  // Something to slip out with (escapeKit): smuggled: the chance a new prisoner has one of items hidden on them;
  // stealth: a Stealth this high counts too; and a loner (no group) knows the tricks. Each × the jail's bonus.
  KIT: { smuggled: 0.12, stealth: 6, items: ["a lockpick sewn into a seam", "a key pressed in soap", "a blade in a boot"] },
  // Asking one to join on the spot (settle): one try, without months of trust: base + the best talker's Speech and the
  // leader's Leadership a point, × who they were (ASK.kind), min–max. No: they are let go (goodwill +goodwill).
  // skilled: the autopilot asks those with a skill this high.
  SPOT: { base: 0.12, speech: 0.012, lead: 0.008, skilled: 5, min: 0.03, max: 0.45, goodwill: 2 },
  // An escort walking prisoners to another base (settle "hold"): hours a tile (at least 6), and their chance a day to slip away.
  WALK: { perTile: 3, min: 6, escape: 0.03 },
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
  // span 140 (was 90): opinion 80 on Short with a good leader and talker is about 45% (Full ~50%, Starvation ~30%).
  ASK: { from: 30, span: 140, kind: { zealots: 0.5, soldiers: 0.8, none: 1.2 }, lead: 0.005, speech: 0.005, mood: 1 / 200, min: 0.02, max: 0.95, fail: -8, gap: 7 },
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
    water: 4, kitchen: { food: 4, out: 3, keepDays: 15 }, scrap: 1.5,
    guardWatch: 4, escapeGuarded: 0.01, escapeUnguarded: 0.04, // unwatched was 7%: a guard is strongly advised, not a must; × the jail's labour (JAIL)
    // Mood and work: output × (moodBase + moodPer × mood / 100), moodMin–moodMax; under lowMood a worker's escapes ×lowMoodMult.
    moodBase: 0.6, moodPer: 0.6, moodMin: 0.6, moodMax: 1.15, lowMood: 25, lowMoodMult: 1.3,
    // Sabotage: under lowMood, a chance a day of spoiling a little of what they worked on (how much, by task).
    sabotage: { chance: 0.04, build: 3, farm: 3, water: 3, kitchen: 2, wood: 10, scrap: 2, upkeep: 0 },
    tire: { full: { health: 0, mood: -0.5 }, short: { health: -0.5, mood: -1 }, starve: { health: -1.5, mood: -2 }, none: { health: -3, mood: -3 } },
    goodDay: 0.3, // was 0.4 before mood counted in the work (×0.6–1.15): a sullen, unskilled prisoner on Short (0.27) does not count
    recruitPerDay: 0.01, recruitMax: 0.4, askPerDay: 0.004, askMax: 0.1,
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
  wood:    { name: "Cut wood", skill: "farming", out: "firewood by hand from the best land within 2 tiles (the Cut wood job's rates, no axe)" },
  scrap:   { name: "Haul and sort scrap", skill: "mechanics", out: `scrap: ${PRISON.LABOUR.scrap} a day at full output, picked out of the junk around the base` },
};
const KIND_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (name) => String(name).split(" ")[0];
const listNames = (list) => list.map((p) => p.name).join(", ");

export const prisonersOf = (state) => state.prisoners || (state.prisoners = []);
export const prisonersAt = (state, baseId) => (state.prisoners || []).filter((p) => p.at.kind === "base" && p.at.baseId === baseId);
export const prisonersWith = (state, partyId) => (state.prisoners || []).filter((p) => p.at.kind === "party" && p.at.partyId === partyId);
export const prisonersInTransit = (state) => (state.prisoners || []).filter((p) => p.at.kind === "transit");

// ---------- jails and room ----------
// The jail at a base: its tier (0: none; the best one standing) and what it does (JAIL); cellCap: the prisoners it
// holds (older saves' two holding cells: 6).
const jailBuildings = (base) => (base && base.buildings ? base.buildings.filter((b) => JAIL[b.type]) : []);
export const jailTier = (base) => Math.max(0, ...jailBuildings(base).map((b) => JAIL[b.type].tier));
export const jailOf = (base) => JAIL_TIERS[jailTier(base)] || null;
export const jailName = (base) => (jailOf(base) ? jailOf(base).name : "No jail");
export const cellCap = (base) => jailBuildings(base).reduce((a, b) => a + JAIL[b.type].cap, 0);
// Prisoners on their way to a base: walked there by an escort (transit), or with a team that hands them over there (dest).
export const incomingTo = (state, base) => (state.prisoners || []).filter((p) => (p.at.kind === "transit" && p.at.baseId === base.id) || (p.at.kind === "party" && p.dest === base.id)).length;
// Room for more: the jail's room less those held and those on their way.
export const freeCells = (state, base) => (base ? Math.max(0, cellCap(base) - prisonersAt(state, base.id).filter((p) => !p.awaiting).length - incomingTo(state, base)) : 0);
// Your bases with room, the most room first: [{ base, room }].
export const basesWithRoom = (state, except = null) => state.bases.filter((b) => b !== except).map((base) => ({ base, room: freeCells(state, base) })).filter((x) => x.room > 0).sort((a, b) => b.room - a.room || a.base.id - b.base.id);
export const totalRoom = (state) => state.bases.reduce((a, b) => a + freeCells(state, b), 0);
// "Room for 2 more prisoners at Millbrook Holdout (holding cells)": the battle screen, the Tie button, the cards.
export function roomText(state, prefer = null) {
  const list = basesWithRoom(state);
  if (!list.length) return "No room for prisoners at your bases (build makeshift cells: 6 scrap). Take them anyway and decide at the end: release, execute, ask them to join.";
  const top = (prefer && list.find((x) => x.base === prefer)) || list[0];
  const more = list.filter((x) => x !== top);
  return `Room for ${top.room} more prisoner${top.room === 1 ? "" : "s"} at ${top.base.name} (${jailName(top.base).toLowerCase()})${more.length ? `; ${more.map((x) => `${x.room} at ${x.base.name}`).join(", ")}` : ""}.`;
}
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
// The tasks a base has work for. A Shelter (tier 0, buildings.js SHELTER) has a smaller set: no buildings to clean and
// mend, and water only from a river or lake beside it (no well yet).
// Cut wood needs trees or timber within 2 tiles (woodcutting.js baseWoodTiles).
export function tasksAt(state, base) {
  const all = Object.keys(TASKS).filter((k) => k !== "wood" || baseWoodTiles(state, base).length > 0);
  if (!isShelter(base)) return all;
  const byWater = state.grid.neighbors(base.tile).some((id) => state.tiles[id] && state.tiles[id].terrain === "water");
  return all.filter((k) => k !== "upkeep" && (k !== "water" || byWater));
}
// Their mood × their work (LABOUR mood*): 0.6 at mood 0, 0.9 at 50, 1.15 from about 92.
export const moodWork = (p) => { const L = PRISON.LABOUR; return clamp(L.moodBase + (L.moodPer * mood(p)) / 100, L.moodMin, L.moodMax); };
// What holds a prisoner at a base: the jail (JAIL), or the shed for the ones beyond it (older saves, and those
// waiting on a card: settle).
export function holdOf(state, p) {
  const base = heldAt(state, p);
  if (!base) return null;
  return inCell(state, p) ? jailOf(base) || SHED : SHED;
}
// What a prisoner has going for them in a break-out: a smuggled pick, key or blade, a loner's ways, Stealth.
export function escapeKit(p) {
  const out = [];
  if (p.smuggled) out.push(p.smuggled);
  if (p.factionId == null) out.push("a loner's tricks");
  if (p.s && skill(p.s, "stealth") >= PRISON.KIT.stealth) out.push(`Stealth ${skill(p.s, "stealth")}`);
  return out;
}
export function labourOutput(state, p, base = null) {
  const task = taskOf(p);
  if (task === "idle" || !p.at || p.at.kind !== "base" || p.awaiting) return 0; // awaiting: tied up in the yard (settle)
  const b = base || baseById(state, p.at.baseId);
  if (!b || health(p) < PRISON.LABOUR.minHealth || underAttack(state, b)) return 0;
  if (isShelter(b) && !tasksAt(state, b).includes(task)) return 0; // nothing of that kind to do at a shelter
  const L = PRISON.LABOUR, T = TASKS[task];
  const eff = T.skill && p.s ? clamp(L.min + skill(p.s, T.skill) * L.perSkill, L.min, L.max) : (L.min + L.max) / 2;
  return Math.round(eff * rationDef(p).labour * clamp(health(p) / L.healthFull, 0.3, 1) * moodWork(p) * 1000) / 1000;
}
// What holds their work back most, for the Prisoners tab ("works at 72%: mood low"): "" when nothing much.
export function workWhy(state, p) {
  const L = PRISON.LABOUR;
  const bits = [];
  if (moodWork(p) < 0.85) bits.push("mood low");
  if (health(p) < L.healthFull) bits.push("weak");
  if (rationDef(p).labour < 0.9) bits.push("hungry");
  return bits.join(", ");
}
// The labour of every prisoner on `task` at a base (shares of a survivor).
export const prisonLabour = (state, base, task) => prisonersAt(state, base.id).reduce((a, p) => a + (taskOf(p) === task ? labourOutput(state, p, base) : 0), 0);
// Construction an hour from prisoners on Build (buildings.js buildRate): out 12 hours of the 24.
export const prisonBuildRate = (state, base) => prisonLabour(state, base, "build") * (PRISON.LABOUR.hours / 24);
// Water a day hauled by prisoners on Fetch water (economy.js waterProduction).
export const prisonWater = (state, base) => Math.round(prisonLabour(state, base, "water") * PRISON.LABOUR.water * 10) / 10;
// The prisoners out at work at a base (output > 0), the first ones (by id) watched by the guards: { guards, workers,
// watched: Set of ids, cap }.
// A guard watches the jail's `watch` (makeshift 3, holding cells 4, a jailhouse's guard post all of them).
export const guardWatchAt = (base) => (jailOf(base) || SHED).watch;
export function labourWatch(state, base) {
  const guards = guardsAt(state, base).length;
  const workers = prisonersAt(state, base.id).filter((p) => labourOutput(state, p, base) > 0).sort((a, b) => a.id - b.id);
  const cap = guards * guardWatchAt(base);
  return { guards, workers, cap, each: guardWatchAt(base), watched: new Set(workers.slice(0, cap).map((p) => p.id)) };
}
// Guards a base wants on duty for its prisoners (work.js, the Guard work type): one for the cells, one for each 4 at
// work (3 from makeshift cells; a jailhouse's one guard on the post watches them all).
export function prisonGuardsWanted(state, base) {
  const list = prisonersAt(state, base.id);
  if (!list.length) return 0;
  const workers = list.filter((p) => taskOf(p) !== "idle").length;
  return Math.max(1, Math.ceil(workers / guardWatchAt(base)));
}

// The day's escape chance of a prisoner at a base (watch: labourWatch for the base; fed: predicted when not given).
export function escapeOdds(state, p, { watch = null, fed = null } = {}) {
  const base = heldAt(state, p);
  if (!base) return 0;
  const E = PRISON.ESCAPE, L = PRISON.LABOUR;
  const J = holdOf(state, p); // the jail's tier (or the shed)
  let e = guarded(state, base) ? J.guarded : J.unguarded;
  if (labourOutput(state, p, base) > 0) {
    const w = watch || labourWatch(state, base);
    e = Math.max(e, (w.watched.has(p.id) ? L.escapeGuarded : L.escapeUnguarded) * J.labour);
    if (mood(p) < L.lowMood) e *= L.lowMoodMult; // miserable at work: they look for the gap in the fence
  }
  e *= J.bonus ** escapeKit(p).length; // a pick, a key, a blade, a loner's tricks: best against a makeshift cage
  const R = rationDef(p);
  e *= R.escape;
  if (mood(p) < E.lowMood) e *= E.lowMoodMult;
  if (base.prisonFear && day(state) <= base.prisonFear) e *= PRISON.EXECUTE.fear;
  const willEat = fed ?? (R.share > 0 && (base.stock.food || 0) + (base.stock.preserved || 0) >= PRISON.FOOD * R.share * coldFactor(state) && waterIn(base.stock) >= PRISON.WATER * thirstAt(state));
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
  const base = heldAt(state, p);
  if (base && !tasksAt(state, base).includes(task)) return `Nothing of that kind to do at ${base.name}: ${isShelter(base) ? "a shelter has no buildings to mend and no well (water only beside a river or lake)" : "no work"}.`;
  p.task = task;
  if (task === "idle") return `${first(p.name)} stays in the cell.`;
  const out = base ? labourOutput(state, p, base) : 0;
  return `${first(p.name)} goes out to work: ${TASKS[task].name} (${Math.round(out * 100)}% of a survivor)${base && !guarded(state, base) ? ". Nobody is on guard: they may run" : ""}.`;
}
export function setAllTasks(state, baseId, task) {
  const base = baseById(state, Number(baseId));
  if (!TASKS[task] || !base || !tasksAt(state, base).includes(task)) return "";
  const list = prisonersAt(state, base.id);
  for (const p of list) p.task = task;
  return list.length ? (task === "idle" ? "Every prisoner here stays in the cells." : `Every prisoner here goes out to work: ${TASKS[task].name}.`) : "";
}
// Who is in a cell (the first ones caught) and who sits in the shed (older saves' overflow, and those waiting on a
// card: settle). One waiting on a card is never in a cell, so a settled prisoner does not lose their place.
export function inCell(state, p) {
  if (p.at.kind !== "base" || p.awaiting) return false;
  const base = baseById(state, p.at.baseId);
  return prisonersAt(state, p.at.baseId).filter((x) => !x.awaiting).indexOf(p) < cellCap(base);
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
  // A pick, a key or a blade hidden on them (escapeKit): searched or not, some get through.
  const smuggled = state.rng.chance(PRISON.KIT.smuggled) ? state.rng.pick(PRISON.KIT.items) : null;
  return { id: newId(), name: s.name, s, factionId: o.factionId, group: o.group, kit: o.kit, power: o.power, unitName: o.unitName || "", tile: o.tile, at: null, caught: null, mode: "hold", opinion: 0, questioned: null, intelDone: false, ransom: null, unfed: 0, report: "", ration: PRISON.RATION_DEFAULT, task: "idle", labourDays: 0, asked: null, ...(smuggled ? { smuggled } : {}) };
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
// The same, by the jail rules (conquest.js): those the base you took has room for stay there, the rest wait on a card
// (settle: walked to a base with room, released, executed or asked to join).
export function surrenderPrisoners(state, f, base, n) {
  const room = freeCells(state, base);
  const list = takePrisonersAt(state, f, base, n);
  overflow(state, list.slice(room));
  return list;
}

// The base a battle's prisoners would end up in.
function destination(state, setup) {
  if (setup.baseId != null) return baseById(state, setup.baseId);
  const p = setup.partyId != null ? state.parties.find((x) => x.id === setup.partyId) : null;
  return p ? baseById(state, p.homeBaseId) || state.bases.find((x) => x.type === "hub") : null;
}

// After every battle (combat.js finishCombat, before its handler): the knocked out go with the team, or straight
// into the jail when the fight was at a base. A battle by the numbers takes none, except the Aggressive autopilot
// that wants intel on a group (half the time, one, if a cell is free at home).
// Room (cellCap): a team's prisoners are booked into a base with room (p.dest: its home first, then the base with the
// most room); a fight at a base fills its jail. Those beyond the room of all your bases wait on a card (overflow).
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
  const all = prisonersOf(state);
  const home = destination(state, setup);
  const extra = [];
  let roomHere = at.kind === "base" ? freeCells(state, base) : 0;
  for (const p of list) {
    p.at = at;
    p.caught = day(state);
    all.push(p);
    const f = factionById(state, p.factionId);
    if (f) f.pop = Math.max(0, f.pop - 1);
    if (at.kind === "party") {
      // Booked into a jail with room (home first): they walk with the team and are handed over there.
      const to = home && freeCells(state, home) > 0 ? home : (basesWithRoom(state)[0] || {}).base;
      if (to) p.dest = to.id; else extra.push(p);
    } else if (roomHere-- <= 0) extra.push(p);
  }
  state.stats.prisonersTaken = (state.stats.prisonersTaken || 0) + list.length;
  if (party) teamPace(state, party);
  const where = at.kind === "party" ? "They walk with the team, tied." : `They are locked up at ${base.name}.`;
  log(state, `Taken prisoner: ${listNames(list)} (${list[0].group}). ${where}`, "good");
  overflow(state, extra);
  return list;
}

// ---------- no room: the card for each one (settle) ----------
// Prisoners beyond the room of your bases: each waits (p.awaiting: in the yard or walking with the team, not in a
// cell) on a card: Release, Execute, Ask to join on the spot, or Hold at a base with room. The autopilot decides
// at once (settleAI).
function overflow(state, list) {
  if (!list.length) return;
  state.stats.prisonOverflow = (state.stats.prisonOverflow || 0) + list.length;
  state.prisonOverflowDay = day(state); // the governor wants a jail (autopilot.js buildWishes)
  for (const p of list) {
    p.awaiting = true;
    if (state.autopilot) { const how = settleAI(state, p); settle(state, p.id, how.how, how.baseId); continue; }
    addCard(state, settleCard(state, p));
  }
  log(state, `No room in your jails for ${listNames(list)}: ${list.length === 1 ? "decide what to do with them" : "decide what to do with each"}.`, "warn");
}
// Where a waiting prisoner is: the base (in the yard) or the team; the people who see what is done to them.
function settlePlace(state, p) {
  if (p.at.kind === "party") {
    const party = state.parties.find((x) => x.id === p.at.partyId);
    return { party, base: null, people: party ? partyMembers(state, party) : [], home: party ? baseById(state, party.homeBaseId) : null };
  }
  const base = p.at.kind === "base" ? baseById(state, p.at.baseId) : null;
  return { party: null, base, people: base ? atBase(state, base.id) : [], home: base };
}
// One try at asking them to join on the spot (SPOT): the best talker's Speech and the leader's Leadership among the
// people there, × who they were.
export function spotOdds(state, p) {
  const S = PRISON.SPOT, A = PRISON.ASK;
  const { people } = settlePlace(state, p);
  const speech = Math.max(0, ...people.map((s) => skill(s, "speech")));
  const lead = Math.max(0, ...people.filter((s) => s.leader).map((s) => skill(s, "leadership")));
  const kind = p.factionId == null ? A.kind.none : A.kind[p.kit] || 1;
  return clamp((S.base + speech * S.speech + lead * S.lead) * kind, S.min, S.max);
}
const bestSkill = (p) => (p.s ? Math.max(0, ...Object.values(p.s.skills || {})) : 0);
// The autopilot's pick (and the card's ai): hold where there is room, ask the skilled to join, release the rest.
export function settleAI(state, p) {
  const room = basesWithRoom(state);
  if (room.length) return { how: "hold", baseId: room[0].base.id };
  if (bestSkill(p) >= PRISON.SPOT.skilled) return { how: "ask" };
  return { how: "release" };
}
function settleCard(state, p) {
  const { party, base } = settlePlace(state, p);
  const f = factionById(state, p.factionId);
  const ai = settleAI(state, p);
  const odds = spotOdds(state, p);
  const E = PRISON.EXECUTE;
  const kind = { raiders: "a raider", soldiers: "a soldier", zealots: "a zealot", fighters: "a fighter", guards: "a guard", militia: "militia" }[p.kit] || "a fighter";
  const top = p.s ? Object.entries(p.s.skills).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} ${n}`).join(", ") : "";
  const holds = basesWithRoom(state).slice(0, 3);
  const still = (st) => (st.prisoners || []).some((x) => x.id === p.id && x.awaiting);
  return {
    title: `No cell for ${p.name}`, kind: "prisonerSettle", prisonerId: p.id,
    text: `${p.name}, ${kind} of ${p.group}${top ? ` (${top})` : ""}, is tied up ${party ? `with ${party.name || "the team"}` : base ? `in the yard at ${base.name}` : "here"}: there is no free cell for them${party ? " at your bases" : ` at ${base ? base.name : "the base"}`}. ${roomText(state)}`,
    choices: [
      ...holds.map(({ base: b, room }) => ({
        label: `Hold at ${b.name}`, hint: `${party ? "They walk on with the team and go" : "An escort walks them"} to ${b.name}'s ${jailName(b).toLowerCase()} (${room} free).`,
        ai: () => (ai.how === "hold" && ai.baseId === b.id ? 4 : 2),
        resolve: (st) => (still(st) ? settle(st, p.id, "hold", b.id) : "Already settled."),
      })),
      { label: `Ask to join (${Math.round(odds * 100)}%)`, hint: `One try, on the spot: the best talker's Speech and the leader's Leadership, × who they were. No: they are let go (goodwill +${PRISON.SPOT.goodwill}).`,
        ai: () => (ai.how === "ask" ? 3 : 0), resolve: (st) => (still(st) ? settle(st, p.id, "ask") : "Already settled.") },
      { label: "Release", hint: `Untie them and let them go${f && f.alive ? ` back to ${f.name} (goodwill +${PRISON.RELEASE})` : ""}.`,
        ai: () => 1, resolve: (st) => (still(st) ? settle(st, p.id, "release") : "Already settled.") },
      { label: "Execute", hint: `Everyone there takes it hard (mood ${E.mood}); goodwill ${E.goodwill}${f && f.alive ? ` with ${f.name}` : ""} and ${E.others} with every group you know; infamy +${E.infamy}.`,
        ai: () => -1, resolve: (st) => (still(st) ? settle(st, p.id, "execute") : "Already settled.") },
    ],
  };
}
// Settle a waiting prisoner: "hold" (at baseId), "ask", "release" or "execute". Returns the line to show.
export function settle(state, id, how, baseId = null) {
  const p = byId(state, id);
  if (!p) return "They are gone.";
  const { party, base, people, home } = settlePlace(state, p);
  if (how === "hold") {
    const to = baseById(state, Number(baseId));
    if (!to || freeCells(state, to) <= 0) return `No free cell at ${to ? to.name : "that base"} any more. ${settle(state, id, "release")}`;
    delete p.awaiting;
    if (party) { p.dest = to.id; return `${p.name} walks on with the team, bound for ${to.name}'s ${jailName(to).toLowerCase()}.`; }
    if (base === to) return `${p.name} goes into a cell at ${to.name}.`;
    walkTo(state, p, base, to);
    return `An escort sets off with ${p.name} for ${to.name}.`;
  }
  if (how === "ask") {
    const odds = spotOdds(state, p);
    if (state.rng.chance(odds)) {
      drop(state, p);
      const f = factionById(state, p.factionId);
      if (f && f.alive) changeGoodwill(state, f, -2, "one of their people changed sides");
      p.s.health = Math.max(p.s.health, 50);
      p.s.mood = 40;
      offerRecruits(state, [p.s], {
        source: "prisoner", ...(party ? { partyId: party.id } : { baseId: (home || {}).id }), title: `${first(p.name)} will join`,
        intro: `Untied and asked straight out, ${p.name}, once of ${p.group}, says yes.`,
      });
      state.stats.prisonersRecruited = (state.stats.prisonersRecruited || 0) + 1;
      return `${p.name} says yes (${Math.round(odds * 100)}%).`;
    }
    goHome(state, p, PRISON.SPOT.goodwill, "you let their people go");
    return `${p.name} will not join (${Math.round(odds * 100)}%). They are let go.`;
  }
  if (how === "execute") return executeHere(state, p, people, base);
  return releasePrisoner(state, p.id);
}
// An escort walks a prisoner from one base to another (WALK): in transit, they arrive by the hour (prisonersHour).
function walkTo(state, p, from, to) {
  const tiles = from ? state.grid.distance(from.tile, to.tile) : 6;
  p.at = { kind: "transit", baseId: to.id, from: from ? from.id : null, arrive: state.hour + Math.max(PRISON.WALK.min, tiles * PRISON.WALK.perTile) };
}
// Move a prisoner held at one base to another with room (the Prisoners tab's Move).
export function movePrisoner(state, id, baseId) {
  const p = byId(state, id);
  const from = heldAt(state, p);
  const to = baseById(state, Number(baseId));
  if (!p || !from || !to || from === to) return "";
  if (freeCells(state, to) <= 0) return `No free cell at ${to.name}.`;
  delete p.awaiting;
  p.task = "idle";
  walkTo(state, p, from, to);
  return `An escort sets off with ${p.name} for ${to.name} (about ${Math.round(p.at.arrive - state.hour)} hours).`;
}

function numbersCapture(state, setup, result) {
  // Played by hand (no autopilot): a decisive win now and then takes one or two of the beaten side prisoner (nonlethal.js).
  if (!state.autopilot) {
    const f = setup.enemy && setup.enemy.factionId != null ? factionById(state, setup.enemy.factionId) : null;
    const n = numbersSurrenders(state, setup, result);
    return Array.from({ length: n }, (_, i) => makeRecord(state, { factionId: f ? f.id : null, group: f ? f.name : setup.enemy.name || "strangers", kit: setup.enemy.kind === "mixed" ? "raiders" : setup.enemy.kind, power: setup.enemy.power || 3, unitName: `${setup.enemy.name || "Enemy"} ${i + 1}`, tile: setup.tile }));
  }
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

// A team home (parties.js returnHome): its prisoners go into that base's jail; those booked for another base (p.dest)
// are walked there by an escort; any left over (no room here or anywhere: older saves' teams, a jail lost meanwhile)
// wait on a card (overflow). Those already waiting on one stay in the yard until it is answered.
export function prisonersHome(state, party, home) {
  const list = prisonersWith(state, party.id);
  if (!list.length || !home) return;
  delete party.prisonSpeed;
  const locked = [], sent = [], extra = [];
  for (const p of list) {
    const dest = p.dest != null ? baseById(state, p.dest) : null;
    delete p.dest;
    p.at = { kind: "base", baseId: home.id };
    if (p.awaiting) continue;
    if (dest && dest !== home) { walkTo(state, p, home, dest); sent.push(p); continue; }
    // p counts as held here now; those still to be handed over here (dest) are booked room.
    if (prisonersAt(state, home.id).filter((x) => !x.awaiting).length + incomingTo(state, home) <= cellCap(home)) locked.push(p);
    else extra.push(p);
  }
  if (locked.length) log(state, `${listNames(locked)} ${locked.length === 1 ? "is" : "are"} locked up at ${home.name} (${jailName(home).toLowerCase()}).`, "info");
  if (sent.length) log(state, `An escort walks ${listNames(sent)} on to ${listNames(sent.map((p) => baseById(state, p.at.baseId)).filter((b, i, a) => a.indexOf(b) === i))}.`, "info");
  overflow(state, extra);
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
// Handed over to their group in a ransom or an exchange (ransom.js): they go home, no goodwill either way here.
export function handOver(state, id) {
  const p = (state.prisoners || []).find((x) => x.id === Number(id));
  if (p) goHome(state, p, 0);
  return !!p;
}
// A prisoner gone for good (worm.js: died of the worm in the cells).
export function dropPrisoner(state, p) { drop(state, p); }
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
      const jt = jailText(state, f); // groupjails.js: their jail and who is in it (now known)
      if (jt) lines.push(`Their jail: ${jt}.`);
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
  const cured = wormCured(p);
  goHome(state, p, PRISON.TRADE_BACK + cured, cured ? "you returned their people, treated for the worm" : "you returned their people");
  return `${p.name} goes back to ${f.name}, unharmed. They will remember it (goodwill +${PRISON.TRADE_BACK + cured}${cured ? `, ${cured} of it for treating their worm` : ""}).`;
}
export function releasePrisoner(state, id) {
  const p = byId(state, id);
  if (!p) return "Nobody to release.";
  const f = factionById(state, p.factionId);
  const cured = f && f.alive ? wormCured(p) : 0;
  goHome(state, p, f && f.alive ? PRISON.RELEASE + cured : 0, cured ? "you let their people go, treated for the worm" : "you let their people go");
  return `${p.name} is let go${f && f.alive ? ` and heads back to ${f.name}${cured ? ` (they were treated for the worm here: goodwill +${cured} more)` : ""}` : ""}.`;
}
// Treated for the worm while held (worm.js applyOtherTreat: p.wormTreated): their group's goodwill +RETURN_GOODWILL
// more when they are released or traded back.
const wormCured = (p) => (p.wormTreated && p.factionId != null ? WORM.OTHERS.RETURN_GOODWILL : 0);
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
  return executeHere(state, p, atBase(state, base.id), base);
}
// The execution itself: where they are held, or on the spot (settle: a team in the field or the yard of a base).
// people: who sees it; base: the base (the others held there are cowed), or null.
function executeHere(state, p, people, base) {
  drop(state, p);
  const E = PRISON.EXECUTE, S = PRISON.SEEN;
  for (const s of people) addMood(state, s, hasTrait(s, S.hardTraits) ? E.hardened : hasTrait(s, S.softTraits) ? E.soft : E.mood, `${first(p.name)} was executed`);
  const f = factionById(state, p.factionId);
  if (f && f.alive) changeGoodwill(state, f, E.goodwill, "you executed one of their people");
  for (const o of state.factions) if (o !== f && o.alive && o.known) changeGoodwill(state, o, E.others, "word of an execution");
  const C = ensureConquest(state); // word gets round: infamy (conquest.js; it fades by itself)
  C.infamy = Math.min(CONQUEST.INFAMY.max, C.infamy + E.infamy);
  // The others held here saw it: cowed for a while.
  if (base) {
    base.prisonFear = day(state) + E.fearDays;
    for (const o of prisonersAt(state, base.id)) if (o.s) o.s.mood = clamp(mood(o) + E.fearMood, 0, 100);
  }
  state.stats.executions = (state.stats.executions || 0) + 1;
  const where = base ? base.name : "the roadside";
  log(state, `${p.name} of ${p.group} was executed at ${where}.`, "death");
  return `${p.name} is dead. Nobody ${base ? `at ${base.name}` : "on the team"} looks at each other for a while.`;
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
  const J = holdOf(state, p) || SHED; // a makeshift cage or the shed: slower (JAIL opinion)
  return R.base * kind * rationDef(p).recruit * work * J.opinion * (1 + (sp ? skill(sp, "speech") : 0) * R.speech + (lead ? skill(lead, "leadership") : 0) * R.lead) * clamp(mood / 55, 0.6, 1.3);
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
      if (carried(party, "food") >= PRISON.FOOD && carriedAny(party, "water") >= drink) { takeSupply(party, "food", PRISON.FOOD); takeAny(party, "water", drink); fed = true; }
      escape = party.vehicle ? PRISON.ESCAPE.vehicle : PRISON.ESCAPE.road;
      teamPace(state, party);
    } else if (p.at.kind === "transit") {
      // Walked to another base by an escort (settle, movePrisoner): fed from the base they left, a chance to slip away.
      fed = true;
      escape = PRISON.WALK.escape;
    } else {
      const base = baseById(state, p.at.baseId);
      if (!base) continue;
      const watch = watchAt(base);
      const RD = rationDef(p);
      const work = labourOutput(state, p, base); // before today's meal and tiredness
      const food = (base.stock.food || 0) + (base.stock.preserved || 0);
      const eat = PRISON.FOOD * RD.share * coldFactor(state); // their rations, more in the cold, as for anyone at a base (upkeep.js)
      if (RD.share > 0 && food >= eat && waterIn(base.stock) >= drink) {
        eatFromStore(base, eat); // fresh first, then preserved (its jars come back: storage.js)
        drawWater(base.stock, drink);
        fed = true;
      } else if (RD.share === 0 && waterIn(base.stock) >= drink) drawWater(base.stock, drink); // no food, but they drink
      escape = escapeOdds(state, p, { watch, fed });
      // Health and mood by rations (unfed: as None), then the day's work.
      if (p.s) {
        const H = fed ? RD : PRISON.RATIONS.none;
        const h0 = health(p);
        p.s.health = H.heal > 0 ? (h0 < H.healTo ? Math.min(H.healTo, h0 + H.heal * wormHealMult(p.s)) : Math.max(H.healTo, h0 - 0.5)) : h0 + H.heal; // worm.js: half the healing while it is in them
        p.s.mood = clamp(mood(p) + H.mood + (holdOf(state, p) || SHED).mood, 0, 100); // a makeshift cage or the shed sours them
        if (work > 0) {
          const T = PRISON.LABOUR.tire[fed ? rationOf(p) : "none"];
          p.s.health += T.health;
          p.s.mood = clamp(mood(p) + T.mood, 0, 100);
          if (fed && work >= PRISON.LABOUR.goodDay && RD.share >= PRISON.RATIONS.short.share) p.labourDays = (p.labourDays || 0) + 1;
          if (taskOf(p) === "kitchen") handDry(state, base, work);
          if (taskOf(p) === "wood") handWood(state, base, work);
          if (taskOf(p) === "scrap") base.stock.scrap = (base.stock.scrap || 0) + Math.round(PRISON.LABOUR.scrap * work * 100) / 100;
          if (mood(p) < PRISON.LABOUR.lowMood && rng.chance(PRISON.LABOUR.sabotage.chance)) sabotage(state, p, base);
        }
        p.s.health = Math.min(100, Math.round(p.s.health * 10) / 10);
      }
      if (!fed || RD.share < PRISON.RATIONS.short.share) starvedAt.add(base.id);
      const R = PRISON.RECRUIT;
      if (fed && p.mode === "recruit") p.opinion += recruitRate(state, p);
      else if (fed && RD.sour) p.opinion += RD.sour;
      else if (fed && p.opinion < R.holdCap) p.opinion = Math.min(R.holdCap, p.opinion + R.holdDrift * (holdOf(state, p) || SHED).opinion);
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
      log(state, `${p.name} (${p.group}) ${out ? "ran off from the work detail" : "slipped their bonds and escaped"}${p.at.kind === "base" ? ` at ${baseById(state, p.at.baseId).name}` : p.at.kind === "transit" ? " from the escort" : " from the team"}.`, "danger");
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

// A prisoner on Cut wood: firewood by hand (no axe for a prisoner) from the best land within 2 tiles, at the Cut wood
// job's rates (woodcutting.js: RATE × the land × the season × its hours) × their work. Returns what they brought in.
export function prisonWoodDay(state, base, work = 1) {
  const tiles = baseWoodTiles(state, base);
  if (!tiles.length) return 0;
  return WOOD.rate * tiles[0].v * seasonWood(state) * WOOD.base.hours * work;
}
function handWood(state, base, work) {
  const tile = (baseWoodTiles(state, base)[0] || {}).id;
  if (tile == null) return 0;
  const got = Math.round(prisonWoodDay(state, base, work) * (0.7 + 0.6 * state.rng.next()) * 100) / 100;
  base.stock.wood = (base.stock.wood || 0) + got;
  takeWood(state, tile, got);
  return got;
}
// Sullen hands (mood under LABOUR.lowMood): a little of what they worked on is spoiled (LABOUR.sabotage, by task).
function sabotage(state, p, base) {
  const S = PRISON.LABOUR.sabotage, task = taskOf(p);
  const n = S[task] || 0;
  let what = "";
  if (task === "build" && base.construction[0]) { base.construction[0].progress = Math.max(0, base.construction[0].progress - n); what = `${n} hours of work on the build undone`; }
  else if (task === "farm" && (base.stock.food || 0) > n) { base.stock.food -= n; what = `${n} food trampled`; }
  else if (task === "water" && (base.stock.rawwater || 0) > n) { base.stock.rawwater -= n; what = `${n} water spilled`; }
  else if (task === "kitchen" && (base.stock.preserved || 0) > n) { base.stock.preserved -= n; what = `${n} preserved food spoiled`; }
  else if (task === "wood" && (base.stock.wood || 0) > n) { base.stock.wood -= n; what = `${n} firewood left to rot`; }
  else if (task === "scrap" && (base.stock.scrap || 0) > n) { base.stock.scrap -= n; what = `${n} scrap gone missing`; }
  if (!what) return;
  state.stats.prisonSabotage = (state.stats.prisonSabotage || 0) + 1;
  log(state, `${base.name}: ${first(p.name)}, sullen on the work detail, spoiled what they could: ${what}.`, "warn");
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
// The base's defence × this against a rescue by their group (JAIL defence; no jail or the shed: as a makeshift cage).
export const jailDefence = (base) => (jailOf(base) || SHED).defence;
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
  const def = () => baseDefense(state, base) * jailDefence(base); // JAIL defence: a makeshift cage is easier to break into than a jailhouse
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
      } else if (p.at.kind === "transit") {
        // The escort arrives (settle "hold", movePrisoner); the base lost meanwhile: they are let go.
        const to = baseById(state, p.at.baseId);
        if (!to) { goHome(state, p); continue; }
        if (state.hour < p.at.arrive) continue;
        p.at = { kind: "base", baseId: to.id };
        const over = prisonersAt(state, to.id).filter((x) => !x.awaiting).length + incomingTo(state, to) > cellCap(to);
        if (over) overflow(state, [p]); // the jail there filled (or came down) on the way
        else log(state, `${p.name} is locked up at ${to.name} (${jailName(to).toLowerCase()}).`, "info");
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
    // Walls not manned and nobody awake on watch at night (watch.js surpriseAt): over the wall before anyone woke.
    const sp = r.manned ? null : surpriseAt(state, base);
    const def = baseDefense(state, base, !!sp) * (r.manned ? PRISON.RESCUE.manned : 1) * jailDefence(base); // JAIL defence
    const att = r.strength * state.rng.range(0.8, 1.2);
    const rt = raidTier(state, base, def, att, 1, 1, null, !!sp); // defences.js: the walls, then the yard
    let text = sp ? `${sp.why}: ${f.name} were over the wall before anyone woke. ` : "";
    if (rt.yard >= 1) {
      f.pop = Math.max(0, f.pop - state.rng.int(1, 2));
      changeGoodwill(state, f, -5, "you beat off their rescue");
      text += `${base.name} drove off ${f.name}'s rescue ${rt.wall >= 1 ? "at the walls" : "in the yard"}.`;
    } else {
      const freed = rescueWon(state, f, base);
      const people = atBase(state, base.id);
      if (people.length) hurt(state, state.rng.pick(people), state.rng.int(15, 40), base.tile, `when ${f.name} came for their people`);
      text += `${f.name} got into ${base.name} and freed ${listNames(freed)}. They carried off a tenth of the stores.`;
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
    if (!state.prisoners.includes(p) || p.awaiting) continue;
    // In the old shed (an older save's overflow): walked to a base with a free cell.
    if (!inCell(state, p)) { const to = basesWithRoom(state, heldAt(state, p))[0]; if (to) { done.push(movePrisoner(state, p.id, to.base.id)); continue; } }
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
    cell: inCell(state, p), guarded: base ? guarded(state, base) : false, hold: base ? holdOf(state, p) : null,
    kit: escapeKit(p), moodWork: moodWork(p), why: workWhy(state, p), awaiting: !!p.awaiting,
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
    jail: jailOf(base), tier: jailTier(base), cap: cellCap(base), free: freeCells(state, base), incoming: incomingTo(state, base),
    shed: list.filter((p) => !inCell(state, p)).length, wood: prisonWoodDay(state, base, labour.wood || 0), scrap: (labour.scrap || 0) * PRISON.LABOUR.scrap,
    n: list.length, food: prisonFoodAt(state, base) * coldFactor(state), fullFood: list.length * PRISON.FOOD * coldFactor(state),
    water: list.length * PRISON.WATER * thirstAt(state), labour, watch, water_hauled: prisonWater(state, base),
    build: prisonBuildRate(state, base) * 24, kitchen: kitchenPlan(state, base),
    escapeExpected: escapes.reduce((a, e) => a + e, 0), escapeAny: 1 - escapes.reduce((a, e) => a * (1 - e), 1),
    hungry: list.filter((p) => rationDef(p).share < PRISON.RATIONS.short.share).length,
  };
}
