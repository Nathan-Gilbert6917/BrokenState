// Skill growth, teaching, books and perks (suggestions-2 #1 and #2).
//
// Growth: a survivor gains XP in the skill they use (s.xp[key] = progress inside the current level). Going from level
// L to L+1 takes xpNeed(L) = 40 + 0.32 × L³ XP: 40 at 0-1, 49 at 3, 80 at 5, 150 at 7, 360 at 10, 1,120 at 15,
// 2,235 at 19. A full day of one job is worth 11 XP (USE below), so a 3 becomes a 7 in a season of daily use
// (298 XP, 28 days), a 10 in about 84 days, and 15 → 16 takes about a year (1,120 XP, 102 days; a year is 112). Use
// XP is capped at 20 a day per skill (CAP_USE), fighting XP at 30 (CAP_FIGHT: a battle's shots, hits and kills, or a
// fight by the numbers, on top of the day's use) and study XP (teaching and books) at 25 (CAP_STUDY), so no amount of
// busywork snowballs. Skills above 10 that have not been used for 14 days slip by 2 XP a day, never below 10 nor
// below the level the survivor had when they joined (s.skillFloor).
// Where XP comes from (USE; measured by tools/skillcurve.js, balance pass 2026-10-07):
//   skill       regular way to grow (a day)                              events
//   Farming     Farm role 11; Forage 7 (+ Scouting 3), Cut wood 6         foraging or cutting on a trip, by the hour
//               (+ Mechanics 2)
//   Mechanics   Build 11 (2 with nothing queued), Operate 11, Craft 11   repairs 6 (×2 at a base), cars 1-4
//   Crafting    Craft role: each finished craft by kind, inputs and quality (crafting.js craftXp, about 0.5-3 a
//               craft; CRAFT_XP.base 2 → 0.55 in this pass: a crafter kept in materials made 40+ a day)
//   Medicine    Medic role 8; ward rounds by the patients (training.js,   wound 5, surgery 10, illness 4, field 6, battle heal 4
//               own cap 4-10 by hospital tier); Trainee role 4 + lessons
//   Shooting    Guard role 6 + 0.25 an hour on guard (the night watch)  battle: shot 1, hit 2, kill 2, melee 1;
//                                                                         fight by the numbers 8 (+4 won); game shot 2/6
//   Scavenging  Scavenge role 9; 4 an hour searching                     a container in a raid 3
//   Stealth     Scavenge role 4; 1 an hour searching (3 sneaking);       hiding 5, lockpicks, sneaking in battle 2
//               0.15 an hour on the move on foot (0.6 stealthy)
//   Scouting    0.5 an hour on the move, 4 a look around (2 an hour)     hunting and fishing 3-4
//   Speech      the camp's talker 5 (best Speech at a base of 3+)       talking someone round 5 (+5 if it works),
//                Teach role 4                                             trade 10, radio 6, road talk 5 (+5)
//   Leadership  the leader 8, an outpost's head 4 (its best, 3+ there),  -
//                a team's lead on a trip 6, Teach role 6
// Before the pass the posts were worth a third of a day (Medic 4, Guard 3, the leader 3), battles shared the use cap,
// Speech and Leadership had no daily way to grow, and over two autopilot years only Farming and Scouting moved.
// Teaching: a survivor on the Teach role spends the day teaching one skill to up to 2 learners at the same base
// whose skill (as shown) is at least 4 below theirs. Each learner gains 4 + 0.4 × the teacher's skill + 0.15 ×
// (the teacher's Leadership + Speech) study XP a day (× 1.5 with Mentor, × the teacher's work factor when ill);
// the teacher gains Leadership 6 and Speech 4. Learners keep their own jobs (lessons in the evening).
// Books (data.js GEAR entries with a `book` field): a survivor on the Read role reads 6 hours a day (less when ill)
// from a copy in their base's armory, one reader per copy at a time. Skill books give 4 XP an hour read, only while
// the skill (as shown) is below the book's max; a book is finished after its hours and is not read again by the
// same person (progress is kept per survivor, s.books). Comics and novels give mood instead (re-reading gives a
// third of it).
// Perks: reaching 5, 10 and 15 in a skill (as shown) gives a perk point for that milestone; each milestone offers two
// perks (PERKS below), Fallout: New Vegas style. A card lets the player pick (or decide later from the survivor
// screen); the autopilot picks by its style. Every perk's effect is coded where it applies (see `hook` in PERKS).
import { SKILLS, SKILL_NAMES, GEAR } from "./data.js";
import { day, log, addCard, atBase, alive, skill, survivorById, fillCrafting } from "./world.js";
import { workFactor } from "./health.js";
import { newItem } from "./inventory.js";
import { BUILDINGS, RECIPES } from "./buildings.js";
import { CRAFTS, craftQueue } from "./crafting.js";
import { studyBlueprint, blueprintWares, bookUnlocksPending, learnBook } from "./blueprints.js";

export const MILESTONES = [5, 10, 15];
export const SKILL_MAX = 20;
export const CAP_USE = 20;        // use XP per skill per day
export const CAP_STUDY = 25;      // teaching + reading XP per skill per day
export const CAP_FIGHT = 30;      // fighting XP (battles on the map, fights by the numbers) per skill per day
export const CAP_WARD = 10;       // ward rounds (training.js: Medicine for medics on duty, by the patients) per day; the
                                  // hospital tier sets each day's own cap (BUILDINGS med.ward 4-10) below this one
export const DECAY_AFTER = 14;    // days without use before a skill above DECAY_FLOOR slips
export const DECAY_PER_DAY = 2;   // XP lost a day after that
export const DECAY_FLOOR = 10;    // never slips below this (nor below the starting level)
export const TEACH_GAP = 4;       // teacher's skill must be at least learner's + 4
export const MAX_LEARNERS = 2;
export const READ_HOURS = 6;      // hours a reader reads a day (× work factor, at least half)
export const BOOK_XP = 4;         // XP per hour of a skill book

// XP to go from level L to L+1.
export const xpNeed = (L) => Math.round(40 + 0.32 * Math.max(0, L) ** 3);

// Use XP per event (11 for a full day of one job; less for side jobs, more where treatments, fights or searches add up).
export const USE = {
  farm: 11, medicRole: 8, operate: 11, craft: 11, build: 11, idle: 2, guard: 6, watchHour: 0.25, scavRole: 9, scavStealth: 4,
  leader: 8, teamLead: 6, baseLead: 4, campTalk: 5, forage: 7, forageScout: 3, wood: 6, woodMech: 2,
  travelHour: 0.5, stealthyHour: 0.6, footHour: 0.15, survey: 4, shot: 1, hit: 2, melee: 1, kill: 2, heal: 4, sneak: 2, box: 3,
  autoFight: 8, autoWin: 4, searchHour: 4, sneakSearch: 3, searchStealth: 1, wound: 5, surgery: 10, illness: 4, field: 6,
  talk: 5, talkWon: 5, hide: 5, bribe: 2, trade: 10, radio: 6, repair: 6, teachLead: 6, teachSpeech: 4,
};

const first = (s) => String(s.name).split(" ")[0];
const isSkill = (k) => SKILLS.includes(k);

// ======================================================================================
// Perks
// ======================================================================================
// ai: how much the autopilot styles like it [cautious, balanced, aggressive]. hook: where the effect is coded.
const P = (id, name, desc, ai, hook) => ({ id, name, desc, ai, hook });
export const PERK_TREE = {
  medicine: {
    5: [P("steadyhands", "Steady Hands", "Wound treatments they give heal 25% more: at a base, in the field and when patching someone up in battle.", [2, 2, 2], "medical.js woundInfo, fieldTreatInfo; combat.js heal"),
        P("triage", "Triage", "+1 treatment a day of their medic time (on the Medic role, or as the base's best treater when nobody is on it).", [3, 2, 1], "medical.js medicCapacity, treaters")],
    10: [P("fieldsurgeon", "Field Surgeon", "Field treatments they give heal as much as a base treatment (12 + Medicine × 0.5 instead of 8 + Medicine × 0.6), 1.5× on a severe wound (below 30 health), and clean an infected wound 90% of the time.", [1, 2, 3], "medical.js fieldTreatInfo"),
         P("plaguedoctor", "Plague Doctor", "Illness treatments they give lower its severity 50% more, and on Medic duty they catch contagious illness no more easily than anyone else (instead of 1.5×).", [3, 2, 1], "health.js conditionInfoCtx, contagion")],
    15: [P("chiefmedic", "Chief of Medicine", "While they are on Medic duty, patients in hospital beds at their base heal +6 health a day more.", [3, 2, 1], "medical.js healRatePerHour"),
         P("miracle", "Miracle Worker", "Surgery they perform heals 2× instead of 1.5×, and a downed teammate they stabilize in battle always pulls through (unless the team retreats without them).", [1, 2, 3], "medical.js woundInfo; combat.js heal, endBattle")],
  },
  shooting: {
    5: [P("steadyaim", "Steady Aim", "+5% to hit with guns in battle.", [2, 2, 2], "skills.js battlePerks"),
        P("brawler", "Brawler", "+10% to hit and +25% damage in melee.", [1, 1, 3], "skills.js battlePerks; combat.js strike")],
    10: [P("deadeye", "Deadeye", "+15% critical-hit chance on every gun shot except overwatch reactions (a critical hit does 2× damage).", [1, 2, 3], "combat.js shotOdds"),
         P("suppressor", "Suppressor", "Overwatch reaction shots at full aim (no −15% penalty).", [3, 2, 1], "combat.js shotOdds")],
    15: [P("gunslinger", "Gunslinger", "+1.5 fighting strength: counts in fights resolved by the numbers, search encounters and base defence.", [2, 2, 2], "world.js combatPower"),
         P("sniper", "Sniper", "No aim loss for shooting beyond the weapon's best range (a 5.56, 7.62×39 or .22 round still drops past its reach).", [2, 2, 2], "combat.js shotOdds")],
  },
  stealth: {
    5: [P("lightstep", "Light Step", "In battle, unaware enemies notice them 2 tiles later (detection range −2, never below 1).", [2, 2, 2], "combat.js detect"),
        P("shadow", "Shadow", "+3 Stealth in their team's Stealth checks: hiding from passers-by, Heat on sneaking searches, hard extractions.", [3, 2, 1], "parties.js bestSkill")],
    10: [P("ghost", "Ghost", "In battle, unaware enemies only notice them from 2 tiles or closer.", [3, 2, 2], "combat.js detect"),
         P("quiethands", "Quiet Hands", "While they are on the team, an hour-by-hour search builds half the Heat (at least 1 an hour), and in a raid on the map the containers they search never set off an alarm.", [2, 2, 3], "scavenge.js searchHour; combat.js searchBox")],
    15: [P("phantom", "Phantom", "Their team's hard extractions (from a Swarming or Overrun search) never cost anyone health.", [3, 2, 2], "scavenge.js extract"),
         P("assassin", "Assassin", "Melee attacks on enemies who have not noticed anyone yet always hit and are always critical (2× damage).", [1, 2, 3], "combat.js strike")],
  },
  scavenging: {
    5: [P("scrounger", "Scrounger", "+30% chance a day of a find when scavenging around a base.", [2, 2, 1], "economy.js scavChance"),
        P("tinkerseye", "Tinker's Eye", "Hour-by-hour searches with them on the team find 50% more parts and fuel.", [2, 2, 2], "scavenge.js searchHour")],
    10: [P("packrat", "Packrat", "+8 kg max load: they carry more of their team's load before it slows them down.", [2, 2, 3], "load.js maxLoad"),
         P("treasure", "Treasure Hunter", "Hour-by-hour searches with them on the team find 20% more supplies, gear twice as often and books twice as often; containers they search in a raid on the map count Scavenging +5.", [2, 3, 2], "scavenge.js searchHour; combat.js searchBox")],
    15: [P("salvager", "Salvager", "Searches with them on the team pick a site over 40% slower (it keeps its loot for more trips).", [2, 2, 2], "scavenge.js searchHour"),
         P("sixthsense", "Sixth Sense", "Hour-by-hour searches with them on the team run into trouble 30% less often.", [3, 2, 1], "scavenge.js searchHour")],
  },
  scouting: {
    5: [P("spotter", "Spotter", "+15% for their team to notice hidden finds (caches, wrecks, camps) and to spot other groups first.", [2, 2, 2], "markers.js perceptionChance"),
        P("forager", "Forager", "+1 food a day for their team while it is out on a trip.", [2, 2, 1], "skills.js skillsDaily")],
    10: [P("pathfinder", "Pathfinder", "Their team travels 10% faster on foot.", [1, 2, 3], "parties.js partySpeed"),
         P("lookout", "Lookout", "+1 sight radius for their team.", [3, 2, 1], "parties.js sightRadius")],
    15: [P("ranger", "Ranger", "Their team's field Heat rises 30% slower while it stands still (camping, searching, treating, waiting).", [3, 2, 2], "fieldheat.js heatGain"),
         P("hunter", "Hunter", "+3 food a day for their team while it is out on a trip (adds to Forager).", [2, 2, 2], "skills.js skillsDaily")],
  },
  mechanics: {
    5: [P("handy", "Handy", "Their construction work counts 20% more (Build role), and so do their repairs; buildings at their base wear 15% slower.", [2, 2, 2], "buildings.js buildRate; breakdowns.js"),
        P("greasemonkey", "Grease Monkey", "A vehicle repair at their base restores 25% a part without a garage (instead of 12%) and 35% with one (instead of 25%); buildings at their base wear 20% slower.", [1, 2, 3], "vehicles.js canRepair; breakdowns.js")],
    10: [P("tinkerer", "Tinkerer", "Makeshift gear crafted at their base while they are on the Craft role lasts 50% longer (more uses before it breaks).", [2, 2, 2], "crafting.js craftingHour"),
         P("fieldrepair", "Field Repair", "Once a day every worn-down makeshift item on them and on the people with them (their team, or everyone at their base) gets 1 use back.", [2, 2, 3], "skills.js skillsDaily")],
    15: [P("masterbuilder", "Master Builder", "Their construction work counts 40% more (instead of Handy's 20%).", [2, 3, 2], "buildings.js buildRate"),
         P("machinist", "Machinist", "Their crafting work counts 30% more (Craft role).", [2, 2, 2], "crafting.js craftRate")],
  },
  // Crafting (crafting.js): everything made by hand. Quality is a roll around the expected condition (craftQuality).
  crafting: {
    5: [P("quickhands", "Quick Hands", "Their crafting work counts 15% more (Craft role).", [2, 2, 2], "crafting.js craftRate"),
        P("goodeye", "Good Eye", "While they are on the Craft role, things made at their base come out 4% better on average (condition).", [2, 2, 2], "crafting.js craftMean")],
    10: [P("steadybench", "Steady Bench", "While they are on the Craft role, a craft at their base rolls its condition twice and keeps the better roll.", [3, 2, 2], "crafting.js rollQuality"),
         P("scrapsaver", "Scrap Saver", "While they are on the Craft role, a finished craft at their base that used 4 or more scrap gives 1 scrap back.", [2, 2, 2], "crafting.js craftingHour")],
    15: [P("mastercrafter", "Master Crafter", "While they are on the Craft role, things made at their base come out 6% better on average (adds to Good Eye).", [2, 2, 2], "crafting.js craftMean"),
         P("foreman", "Foreman", "Everyone else on the Craft role at their base works 15% faster.", [2, 3, 2], "crafting.js craftRate")],
  },
  farming: {
    5: [P("earlyriser", "Early Riser", "Counts as Farming +3 when tending crops (a plot's care uses the tenders' average Farming).", [2, 2, 2], "farming.js careToday"),
        P("harvester", "Harvester", "+2 ripe plots harvested a day at their base while they farm.", [2, 2, 2], "farming.js farmingDaily")],
    10: [P("greenthumb", "Green Thumb", "Crops at their base give 15% more while they are one of the farmers tending them.", [2, 3, 2], "farming.js careToday"),
         P("rootcellar", "Root Cellar Lore", "Food at the base where they live spoils 25% slower (in the stores, outside and preserved).", [3, 2, 1], "storage.js foodStore")],
    15: [P("seedsaver", "Seed Saver", "Sowing a plot at their base costs half the seed food (rounded up).", [2, 2, 2], "farming.js sowing"),
         P("herbalist", "Herbalist", "+1 meds every 3 days while they are on the Farm role (medicinal herbs from the plots).", [3, 2, 1], "skills.js skillsDaily")],
  },
  leadership: {
    5: [P("inspiring", "Inspiring", "Everyone else living at their base gains +0.5 mood a day (two inspiring people: +1); it shows in their mood breakdown.", [3, 2, 2], "relations.js moodFactors"),
        P("mentor", "Mentor", "People they teach learn 50% faster, and teammates on a trip with them gain 25% more skill XP from use.", [2, 2, 2], "skills.js teaching, gainXp")],
    10: [P("rally", "Rally", "In a battle they fight in, every ally gets +5% to hit (guns and melee).", [1, 2, 3], "skills.js battlePerks"),
         P("peacemaker", "Peacemaker", "On the road their team's talk checks count their Leadership in full (not −2), and a failed talk costs no goodwill.", [3, 2, 1], "conflicts.js talkSkill, talkChoice")],
    15: [P("commander", "Commander", "In a battle they fight in, every ally takes 10% less damage.", [2, 2, 3], "skills.js battlePerks"),
         P("quartermaster", "Quartermaster", "Everyone at the base where they live eats 10% less food.", [3, 2, 1], "economy.js eatPerDay")],
  },
  speech: {
    5: [P("smooth", "Smooth Talker", "+2 to their team's talk checks (road stand-offs: Talk them down, Talk your way through; and talks during a rescue).", [2, 2, 1], "conflicts.js talkSkill"),
        P("charming", "Charming", "A road talk their team wins raises goodwill by 6 instead of 3.", [2, 2, 1], "conflicts.js talkChoice")],
    10: [P("haggler", "Haggler", "+5 Speech when trading (their team's trade visits, caravans at their base, radio deals from their base); the price edge from Speech tops out at Speech 15.", [2, 3, 2], "trade.js tradeContext; radio.js radioSpeech"),
         P("silvertongue", "Silver Tongue", "+15% chance on their team's road talk checks (up to 95%).", [3, 2, 1], "conflicts.js talkChoice")],
    15: [P("diplomat", "Diplomat", "When a road talk fails, their team may try talking once more.", [3, 2, 1], "conflicts.js talkChoice"),
         P("negotiator", "Negotiator", "Tolls, bribes and supplies offered to pass cost their team 25% less.", [2, 2, 1], "conflicts.js bribeChoice")],
  },
};
// Flat index: id -> { ...perk, skill, ms }.
export const PERKS = {};
for (const [k, tiers] of Object.entries(PERK_TREE)) for (const [ms, list] of Object.entries(tiers)) for (const p of list) PERKS[p.id] = { ...p, skill: k, ms: Number(ms) };
const STYLE_IDX = { cautious: 0, balanced: 1, aggressive: 2 };
// Earned perks: not milestone choices (no perk point, not in PERK_TREE or PERKS), given by a career (training.js:
// Professor of Medicine, for a doctor who has taught long enough). Kept in s.perks like the others (hasPerk).
export const EARNED_PERKS = {
  professor: { id: "professor", name: "Professor of Medicine", skill: "medicine", earned: true,
    desc: "Earned by teaching: a doctor (Medicine 10+) who has taught trainees on 60 days. Their lessons teach 25% faster (on top of Mentor).", hook: "training.js lessonRate, doctorCareer" },
};

export const hasPerk = (s, id) => !!(s && s.perks && s.perks.includes(id));
export const anyPerk = (list, id) => !!(list && list.some((s) => s && s.alive !== false && hasPerk(s, id)));
// Team members with a perk (a party's living members).
const teamOf = (state, p) => (p && p.members ? p.members.map((id) => survivorById(state, id)).filter((s) => s && s.alive) : []);
export const teamHas = (state, p, id) => anyPerk(teamOf(state, p), id);
export const baseHas = (state, base, id, role = null) => !!base && atBase(state, base.id).some((s) => hasPerk(s, id) && (!role || s.role === role) && !s.inBed);

// ---------- small helpers for the hooks in other files ----------
// Best Speech for trading among some people, Haggler +5 (trade.js, radio.js).
export const tradeSpeech = (people) => Math.max(0, ...people.map((s) => skill(s, "speech") + (hasPerk(s, "haggler") ? 5 : 0)));
// A team member's Stealth for the team's checks (Shadow +3; parties.js bestSkill).
export const checkBonus = (s, key) => (key === "stealth" && hasPerk(s, "shadow") ? 3 : 0);
// Food eaten at a base (Quartermaster; economy.js eatPerDay).
export const eatMult = (state, base) => (atBase(state, base.id).some((s) => hasPerk(s, "quartermaster")) ? 0.9 : 1);
// Spoilage at a base (Root Cellar Lore; storage.js foodStore).
export const spoilMult = (state, base) => (state && base && atBase(state, base.id).some((s) => hasPerk(s, "rootcellar")) ? 0.75 : 1);
// Seed food for sowing at a base (Seed Saver; farming.js).
export const seedCost = (state, base, seed) => (state && base && atBase(state, base.id).some((s) => hasPerk(s, "seedsaver")) ? Math.ceil(seed / 2) : seed);
// Construction work of one builder (Handy / Master Builder; buildings.js buildRate).
export const buildMult = (s) => (hasPerk(s, "masterbuilder") ? 1.4 : hasPerk(s, "handy") ? 1.2 : 1);
// Field-heat multiplier for a team (Ranger; fieldheat.js).
export const heatMult = (state, p) => (teamHas(state, p, "ranger") ? 0.7 : 1);

// ======================================================================================
// State per survivor (lazy: survivors made anywhere get it on first use)
// ======================================================================================
// s.xp: progress in the current level per skill; s.skillFloor: the level when tracking started (decay floor);
// s.xpLast: last day each skill was used; s.xpDay: today's use / study XP per skill (the caps);
// s.perks: chosen perk ids; s.perkMs: highest milestone granted per skill; s.perkPending: [{ skill, ms }];
// s.books: hours read per book key; s.reading: the book key they read on the Read role;
// s.teach: { skill, learners: [ids] } on the Teach role.
export function ensureSkills(state, s) {
  if (!s) return s;
  fillCrafting(s); // world.js: people from before the Crafting skill
  if (s.xp && s.perkMs) return s;
  const d = state ? day(state) : 1;
  s.xp = s.xp || {};
  s.skillFloor = s.skillFloor || { ...s.skills };
  s.xpLast = s.xpLast || Object.fromEntries(SKILLS.map((k) => [k, d]));
  s.xpDay = s.xpDay || { d, use: {}, study: {} };
  s.perks = s.perks || [];
  s.books = s.books || {};
  if (!s.perkMs) {
    // Milestones already passed when they join: perk points for those of their two best skills (their trade, learnt
    // before the outbreak); in the other skills the next milestone is the first that gives one. No card for these.
    s.perkMs = {};
    s.perkPending = s.perkPending || [];
    const top = topSkills(s, START_PERK_SKILLS);
    for (const k of SKILLS) {
      const lv = skill(s, k);
      for (const ms of MILESTONES) if (lv >= ms) { s.perkMs[k] = ms; if (top.includes(k)) s.perkPending.push({ skill: k, ms }); }
    }
  }
  s.perkPending = s.perkPending || [];
  return s;
}

// A survivor's best skills (as shown), ties by the SKILLS order.
export const START_PERK_SKILLS = 2;
export const topSkills = (s, n) => [...SKILLS].sort((a, b) => skill(s, b) - skill(s, a) || SKILLS.indexOf(a) - SKILLS.indexOf(b)).slice(0, n);

// Read-only view for the UI (does not start tracking: the new-run screen can still change skills).
export function skillProgress(s, key) {
  const raw = Math.max(0, Math.min(SKILL_MAX, (s && s.skills && s.skills[key]) || 0));
  const level = s ? skill(s, key) : 0;
  const need = xpNeed(raw);
  const xp = Math.max(0, (s && s.xp && s.xp[key]) || 0);
  const t = s && s.xpDay ? s.xpDay : null;
  const today = t ? (t.use[key] || 0) + (t.study[key] || 0) + ((t.fight && t.fight[key]) || 0) + ((t.ward && t.ward[key]) || 0) : 0;
  const maxed = raw >= SKILL_MAX;
  const nextMs = MILESTONES.find((m) => m > level) || null;
  return {
    key, level, raw, xp: maxed ? 0 : Math.round(xp * 10) / 10, need, pct: maxed ? 100 : Math.min(100, Math.round((xp / need) * 100)), frac: maxed ? 1 : Math.min(1, xp / need),
    today: Math.round(today * 10) / 10, capped: !!t && (t.use[key] || 0) >= CAP_USE - 1e-9, maxed, nextMs,
    floor: s && s.skillFloor ? s.skillFloor[key] : raw,
  };
}

// Perk points waiting to be spent (derived when tracking has not started yet).
export function pendingPerks(s) {
  if (!s) return [];
  if (s.perkMs) return (s.perkPending || []).slice();
  const out = [];
  for (const k of topSkills(s, START_PERK_SKILLS)) for (const ms of MILESTONES) if (skill(s, k) >= ms) out.push({ skill: k, ms });
  return out;
}

// ======================================================================================
// XP
// ======================================================================================
// Measurement hook for tools (tools/skillcurve.js): null in the game. onGain(state, s, key, asked, added, src) after
// every gainXp; onDecay(state, s, key, lost) when an unused skill slips.
export const xpHooks = { onGain: null, onDecay: null };

// Adds XP to one skill (src "use", "study", "fight" or "ward"; each has its own daily cap). Returns the XP actually added.
export function gainXp(state, s, key, amount, src = "use") {
  const added = gainXpRaw(state, s, key, amount, src);
  if (xpHooks.onGain && s && amount > 0) xpHooks.onGain(state, s, key, amount, added, src);
  return added;
}
function gainXpRaw(state, s, key, amount, src) {
  if (!state || !s || !s.alive || !isSkill(key) || !(amount > 0)) return 0;
  ensureSkills(state, s);
  const d = day(state);
  if (s.xpDay.d !== d) s.xpDay = { d, use: {}, study: {} };
  if (src === "fight" && !s.xpDay.fight) s.xpDay.fight = {}; // saves from before the fight bucket
  if (src === "ward" && !s.xpDay.ward) s.xpDay.ward = {}; // made on first use (training.js ward rounds)
  let amt = amount;
  // Mentor: teammates on a trip with them learn more from what they do.
  if (src !== "study" && src !== "ward" && s.location && s.location.kind === "party") {
    const p = state.parties.find((x) => x.id === s.location.partyId);
    if (p && teamOf(state, p).some((o) => o !== s && hasPerk(o, "mentor"))) amt *= 1.25;
  }
  const bucket = src === "study" ? s.xpDay.study : src === "fight" ? s.xpDay.fight : src === "ward" ? s.xpDay.ward : s.xpDay.use;
  const cap = src === "study" ? CAP_STUDY : src === "fight" ? CAP_FIGHT : src === "ward" ? CAP_WARD : CAP_USE;
  amt = Math.min(amt, cap - (bucket[key] || 0));
  if (amt <= 1e-9) return 0;
  bucket[key] = (bucket[key] || 0) + amt;
  s.xpLast[key] = d;
  addXp(state, s, key, amt);
  return amt;
}

// Raw XP into the level track (no caps): level-ups and milestones.
export function addXp(state, s, key, amt) {
  ensureSkills(state, s);
  if ((s.skills[key] || 0) >= SKILL_MAX) { s.xp[key] = 0; return; }
  s.xp[key] = (s.xp[key] || 0) + amt;
  let up = false;
  while ((s.skills[key] || 0) < SKILL_MAX && s.xp[key] >= xpNeed(s.skills[key] || 0)) {
    s.xp[key] -= xpNeed(s.skills[key] || 0);
    s.skills[key] = (s.skills[key] || 0) + 1;
    up = true;
  }
  if ((s.skills[key] || 0) >= SKILL_MAX) s.xp[key] = 0;
  if (up) {
    log(state, `${first(s)}'s ${SKILL_NAMES[key]} rose to ${skill(s, key)}.`, "good");
    checkMilestones(state, s, key);
  }
}

// Several people at once (a team, everyone in a fight).
export const gainXpAll = (state, people, key, amount, src = "use") => { for (const s of people || []) gainXp(state, s, key, amount, src); };
// Talking someone round (a person about to leave, one who broke down, two rivals): Speech for the talker.
export const talkXp = (state, who, ok) => (who ? gainXp(state, who, "speech", USE.talk + (ok ? USE.talkWon : 0)) : 0);

// A milestone reached: a perk point and a card to spend it (the autopilot answers by its style).
function checkMilestones(state, s, key) {
  const lv = skill(s, key);
  for (const ms of MILESTONES) {
    if (lv < ms || (s.perkMs[key] || 0) >= ms) continue;
    s.perkMs[key] = ms;
    s.perkPending.push({ skill: key, ms });
    perkCard(state, s, key, ms);
  }
}

export function perkCard(state, s, key, ms) {
  const opts = (PERK_TREE[key] && PERK_TREE[key][ms]) || [];
  if (!opts.length) return;
  addCard(state, {
    title: `${first(s)} reached ${SKILL_NAMES[key]} ${ms}`,
    text: `${s.name} has a perk point to spend for ${SKILL_NAMES[key]} ${ms}. Pick one perk (it is for good), or decide later from the skill tree on their survivor screen.`,
    perkFor: `${s.id}:${key}:${ms}`,
    choices: [
      ...opts.map((p) => ({
        label: p.name, hint: p.desc,
        disabled: (st) => !s.alive || !(s.perkPending || []).some((x) => x.skill === key && x.ms === ms),
        ai: (st) => perkScore(st, s, p.id),
        resolve: (st) => choosePerk(st, s, p.id),
      })),
      { label: "Decide later", hint: "Keep the point: pick from the skill tree on their survivor screen.", ai: () => -50, resolve: () => `${first(s)} keeps the perk point for later.` },
    ],
  });
}

// Why a perk cannot be taken now ("" when it can).
export function perkReason(s, id) {
  const p = PERKS[id];
  if (!p) return "Unknown perk.";
  if (!s || !s.alive) return "They are gone.";
  if (hasPerk(s, id)) return "Already taken.";
  const tier = PERK_TREE[p.skill][p.ms];
  if (tier.some((o) => hasPerk(s, o.id))) return `Already took ${tier.find((o) => hasPerk(s, o.id)).name} at ${SKILL_NAMES[p.skill]} ${p.ms}.`;
  if (!pendingPerks(s).some((x) => x.skill === p.skill && x.ms === p.ms)) return `Needs ${SKILL_NAMES[p.skill]} ${p.ms} (now ${skill(s, p.skill)}).`;
  return "";
}

// Spends a perk point. Returns the text for the card result / log.
export function choosePerk(state, s, id) {
  if (state) ensureSkills(state, s);
  const why = perkReason(s, id);
  if (why) return why;
  const p = PERKS[id];
  s.perks.push(id);
  s.perkPending = s.perkPending.filter((x) => !(x.skill === p.skill && x.ms === p.ms));
  if (state) {
    // The card for that milestone is answered now.
    const tag = `${s.id}:${p.skill}:${p.ms}`;
    for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].perkFor === tag) state.cards.splice(i, 1); // in place
    log(state, `${first(s)} took the perk ${p.name} (${SKILL_NAMES[p.skill]} ${p.ms}).`, "good");
  }
  return `${s.name} took ${p.name}: ${p.desc}`;
}

// The autopilot's taste: its style, plus what fits the person's job.
export function perkScore(state, s, id) {
  const p = PERKS[id];
  if (!p) return -99;
  const style = (state && state.governor && state.governor.personality) || "balanced";
  let v = p.ai[STYLE_IDX[style] ?? 1];
  const role = s.role;
  if (role === "medic" && ["triage", "plaguedoctor", "chiefmedic"].includes(id)) v += 1.5;
  if (role === "farm" && ["earlyriser", "harvester", "greenthumb", "herbalist", "seedsaver", "rootcellar"].includes(id)) v += 1;
  if (role === "build" && ["handy", "masterbuilder"].includes(id)) v += 1.5;
  if (role === "craft" && ["tinkerer", "machinist", "quickhands", "goodeye", "steadybench", "scrapsaver", "mastercrafter", "foreman"].includes(id)) v += 1.5;
  if (role === "scavenge" && id === "scrounger") v += 1.5;
  return v - (Number(id.length) % 3) * 0.01; // stable tie-break
}

// Autopilot: spends every waiting perk point by its style (cards it answers itself; this is for the points
// survivors joined with, and any left for later).
export function autoPerks(state) {
  for (const s of alive(state)) {
    ensureSkills(state, s);
    for (const pend of [...s.perkPending]) {
      const opts = (PERK_TREE[pend.skill] && PERK_TREE[pend.skill][pend.ms]) || [];
      const best = [...opts].sort((a, b) => perkScore(state, s, b.id) - perkScore(state, s, a.id))[0];
      if (best && !perkReason(s, best.id)) choosePerk(state, s, best.id);
      else s.perkPending = s.perkPending.filter((x) => x !== pend);
    }
  }
}

// ======================================================================================
// Books
// ======================================================================================
export const BOOK_KEYS = () => Object.keys(GEAR).filter((k) => GEAR[k].book);
export const bookDef = (key) => (GEAR[key] && GEAR[key].book) || null;
export const bookHours = (s, key) => Math.max(0, (s && s.books && s.books[key]) || 0);
export const bookDone = (s, key) => !!bookDef(key) && bookHours(s, key) >= bookDef(key).hours - 1e-9;

// Why a survivor cannot read a book ("" when they can). state: a craft book whose recipes nobody has unlocked yet
// (blueprints.js CRAFT_BOOKS) is worth reading to the end even by someone past its skill cap (no XP above it).
export function readReason(s, key, state = null) {
  const b = bookDef(key);
  if (!b) return "Not a book.";
  if (b.skill) {
    if (bookDone(s, key)) return `Already read it (${b.hours}h).`;
    if (skill(s, b.skill) >= b.max && !(state && bookUnlocksPending(state, key))) return `Already knows all it teaches (${SKILL_NAMES[b.skill]} ${skill(s, b.skill)}, the book goes to ${b.max}).`;
  }
  return "";
}

// Copies of each book in a base's armory, and who reads which there.
const armoryBooks = (base) => {
  const n = {};
  for (const it of base.armory) if (it && bookDef(it.key)) n[it.key] = (n[it.key] || 0) + 1;
  return n;
};

// The best book for someone from a set of free copies (skill books they can learn from first; comics when glum).
export function bestBook(s, free, state = null) {
  let best = null, bestV = -1;
  for (const [k, n] of Object.entries(free)) {
    if (n <= 0 || readReason(s, k, state)) continue;
    const b = bookDef(k);
    const unlocks = state && bookUnlocksPending(state, k) ? 3 : 0; // a craft book's recipes: blueprints.js
    const v = b.skill ? 10 + Math.max(-2, (b.max - skill(s, b.skill)) * 0.5) + unlocks : s.mood < 55 ? 5 + (bookDone(s, k) ? 0 : 2) : 0.5;
    if (v > bestV) { best = k; bestV = v; }
  }
  return best;
}

// Daily reading at a base: each reader gets a copy (their pick if free, else the best free one).
function readingDaily(state, base) {
  // A blueprint in the armory comes first for anyone who can study it (blueprints.js); the others read books.
  const readers = atBase(state, base.id).filter((s) => s.role === "read").sort((a, b) => a.id - b.id).filter((s) => !studyBlueprint(state, base, s));
  if (!readers.length) return;
  const free = armoryBooks(base);
  // Readers whose book is still here and still useful keep it first.
  const plan = new Map();
  for (const s of readers) {
    if (s.reading && free[s.reading] > 0 && !readReason(s, s.reading, state)) { plan.set(s.id, s.reading); free[s.reading]--; }
  }
  for (const s of readers) {
    if (plan.has(s.id)) continue;
    const k = bestBook(s, free, state);
    if (k) { plan.set(s.id, k); free[k]--; }
  }
  for (const s of readers) {
    const k = plan.get(s.id);
    if (!k) {
      if (!s.readIdle) log(state, `${first(s)} is on the Read role at ${base.name} but there is no book there they can learn from.`, "info");
      s.readIdle = true;
      continue;
    }
    s.readIdle = false;
    s.reading = k;
    readHours(state, s, k, READ_HOURS * Math.max(0.5, workFactor(s)));
  }
}

// Reads `hours` of a book: skill XP (study cap) or mood; progress saved per survivor. Returns hours read.
export function readHours(state, s, key, hours) {
  ensureSkills(state, s);
  const b = bookDef(key);
  if (!b || hours <= 0) return 0;
  if (!b.skill && bookDone(s, key)) s.books[key] = 0; // a comic read again: from the start, for less
  const reread = !b.skill && (s.reread || {})[key];
  const h = Math.min(hours, b.hours - bookHours(s, key));
  if (h <= 0) return 0;
  s.books[key] = bookHours(s, key) + h;
  if (b.skill && skill(s, b.skill) < b.max) gainXp(state, s, b.skill, h * BOOK_XP, "study"); // read past its cap for a craft book's recipes: no XP
  else s.mood = Math.min(100, s.mood + h * (b.mood || 2) / (reread ? 3 : 1));
  if (bookDone(s, key)) {
    if (!b.skill) (s.reread = s.reread || {})[key] = true;
    log(state, `${first(s)} finished reading ${GEAR[key].name}${b.skill ? ` (${SKILL_NAMES[b.skill]} ${skill(s, b.skill)})` : ""}.`, "good");
    learnBook(state, key, s); // blueprints.js: a craft book's recipes and crafting edge, for good
  }
  return h;
}

// ---------- where books are found ----------
// Per site type: the books it may hold and the chance per search hour (hour-by-hour search) or per container
// (a raid on the map) at full loot. Schools, universities, police, the military and homes, as in the request.
export const BOOK_SITES = {
  school: { p: 0.15, books: ["gardenbook", "talkbook", "medbook", "comic", "novel", "survivalbook", "diybook"] },
  univ: { p: 0.18, books: ["surgerybook", "enginebook", "medbook", "leadbook", "talkbook", "gardenbook", "forgebook"] },
  police: { p: 0.12, books: ["gunbook", "lockbook", "leadbook", "medbook"] },
  military: { p: 0.15, books: ["armymanual", "gunbook", "survivalbook", "leadbook", "medbook", "bushcraftbook"] },
  apartments: { p: 0.08, books: ["comic", "novel", "gardenbook", "talkbook", "enginebook", "magazines", "puzzlebook", "diybook"] },
  town: { p: 0.06, books: ["comic", "novel", "gardenbook", "talkbook", "lockbook", "diybook"] },
  motel: { p: 0.06, books: ["novel", "comic", "magazines", "puzzlebook"] },
  cabin: { p: 0.06, books: ["survivalbook", "novel", "bushcraftbook"] },
  lodge: { p: 0.06, books: ["survivalbook", "gunbook", "bushcraftbook"] },
  ranger: { p: 0.08, books: ["survivalbook", "medbook", "bushcraftbook"] },
  farm: { p: 0.05, books: ["gardenbook", "diybook", "forgebook"] },
  ranch: { p: 0.05, books: ["gardenbook", "survivalbook", "forgebook"] },
  feedstore: { p: 0.06, books: ["gardenbook", "diybook"] },
  hospital: { p: 0.09, books: ["medbook", "surgerybook", "magazines"] },
  clinic: { p: 0.07, books: ["medbook", "magazines"] },
  firestation: { p: 0.06, books: ["medbook", "leadbook"] },
  autoshop: { p: 0.07, books: ["enginebook", "forgebook"] },
  hardware: { p: 0.05, books: ["enginebook", "scavbook", "diybook", "forgebook"] },
  factory: { p: 0.05, books: ["enginebook", "scavbook", "forgebook"] },
  gunstore: { p: 0.07, books: ["gunbook"] },
  office: { p: 0.06, books: ["talkbook", "leadbook", "novel"] },
  mall: { p: 0.06, books: ["comic", "novel", "talkbook", "gardenbook", "diybook"] },
  church: { p: 0.04, books: ["novel"] },
  warehouse: { p: 0.05, books: ["scavbook", "enginebook", "diybook"] },
  supermarket: { p: 0.06, books: ["comic", "novel", "gardenbook", "magazines", "puzzlebook"] },
  pharmacy: { p: 0.06, books: ["medbook", "novel"] },
  grocery: { p: 0.04, books: ["comic", "novel", "gardenbook"] },
  truckstop: { p: 0.06, books: ["comic", "novel", "enginebook", "magazines", "puzzlebook"] },
  gas: { p: 0.05, books: ["comic", "enginebook", "magazines"] },
  prison: { p: 0.06, books: ["novel", "lockbook", "leadbook"] },
  city: { p: 0.06, books: ["comic", "novel", "talkbook", "leadbook"] },
  barn: { p: 0.03, books: ["gardenbook", "forgebook"] },
  campground: { p: 0.04, books: ["survivalbook", "comic", "bushcraftbook"] },
  radiotower: { p: 0.04, books: ["enginebook"] },
  airport: { p: 0.06, books: ["novel", "comic", "talkbook", "magazines", "puzzlebook"] },
  dam: { p: 0.05, books: ["enginebook"] },
};

// Deterministic roll that never touches the world's random numbers (so adding books shifts no other result).
export function hash01(...parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const str = String(part);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ 0x9e3779b9, 16777619) >>> 0;
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// A book found at a site (or null). mult: Treasure Hunter ×2, loot left, the search pace. salt: makes each roll unique.
export function rollBook(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? BOOK_SITES[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "book", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const list = site.books.filter((k) => GEAR[k]);
  if (!list.length) return null;
  const key = list[Math.floor(hash01(state.seed, "pick", tileId, state.hour, salt) * list.length) % list.length];
  return newItem(key, 1);
}

// Books a group has for sale this week (trade.js ensureWares): traders often, communes and the military sometimes.
export const WARE_BOOKS = {
  traders: { p: 0.6, books: ["medbook", "enginebook", "gardenbook", "talkbook", "survivalbook", "comic", "novel", "lockbook", "scavbook", "puzzlebook", "diybook", "forgebook", "bushcraftbook"] },
  commune: { p: 0.35, books: ["gardenbook", "medbook", "novel", "diybook", "bushcraftbook"] },
  military: { p: 0.3, books: ["armymanual", "gunbook", "leadbook"] },
  fortress: { p: 0.2, books: ["gunbook", "enginebook", "leadbook", "forgebook"] },
};
export function bookWares(state, f) {
  const bp = blueprintWares(state, f, day(state)); // blueprints.js: a manual or blueprint now and then (its own dice)
  const w = WARE_BOOKS[f.type];
  if (!w || hash01(state.seed, "wares", f.name, day(state)) >= w.p) return bp;
  const list = w.books.filter((k) => GEAR[k]);
  return list.length ? [newItem(list[Math.floor(hash01(state.seed, "ware", f.name, day(state)) * list.length) % list.length], 1), ...bp] : bp;
}

// ======================================================================================
// Teaching
// ======================================================================================
// Learning a day from a teacher (before the study cap).
export function teachRate(T, key) {
  return (4 + skill(T, key) * 0.4 + (skill(T, "leadership") + skill(T, "speech")) * 0.15) * (hasPerk(T, "mentor") ? 1.5 : 1) * workFactor(T);
}
// Can T teach `key` to L ("" when yes)?
export function learnReason(state, T, L, key) {
  if (!T || !L || T === L) return "Pick someone else.";
  if (!L.alive || !L.location || L.location.kind !== "base" || !T.location || L.location.baseId !== T.location.baseId) return `${first(L)} is not at the same base.`;
  if (skill(T, key) < skill(L, key) + TEACH_GAP) return `${first(T)}'s ${SKILL_NAMES[key]} (${skill(T, key)}) must be at least ${TEACH_GAP} above ${first(L)}'s (${skill(L, key)}).`;
  if ((L.skills[key] || 0) >= SKILL_MAX) return `${first(L)} is already at ${SKILL_MAX}.`;
  return "";
}
// Candidates T could teach in a skill at their base, those with the most to learn first.
export function learnersFor(state, T, key) {
  if (!T || T.location.kind !== "base") return [];
  return atBase(state, T.location.baseId).filter((L) => L !== T && !learnReason(state, T, L, key)).sort((a, b) => skill(a, key) - skill(b, key) || a.id - b.id);
}
// The best lesson T can give: the skill with the most to pass on to up to two learners.
export function bestLesson(state, T) {
  let best = null, bestV = 0;
  for (const k of SKILLS) {
    const ls = learnersFor(state, T, k).slice(0, MAX_LEARNERS);
    if (!ls.length) continue;
    const v = ls.reduce((a, L) => a + Math.min(8, skill(T, k) - TEACH_GAP - skill(L, k) + 1), 0) + skill(T, k) * 0.1;
    if (v > bestV) { best = { skill: k, learners: ls.map((L) => L.id) }; bestV = v; }
  }
  return best;
}
// The lesson T gives today: their own setting where it still works (invalid learners dropped), else the best one.
export function lessonOf(state, T) {
  const t = T.teach;
  if (t && isSkill(t.skill)) {
    const ls = (t.learners || []).map((id) => survivorById(state, id)).filter((L) => L && !learnReason(state, T, L, t.skill)).slice(0, MAX_LEARNERS);
    if (ls.length) return { skill: t.skill, learners: ls.map((L) => L.id), set: true };
  }
  const b = bestLesson(state, T);
  return b ? { ...b, set: false } : null;
}

function teachingDaily(state, base) {
  for (const T of atBase(state, base.id).filter((s) => s.role === "teach" && !s.inBed && workFactor(s) > 0).sort((a, b) => a.id - b.id)) {
    const lesson = lessonOf(state, T);
    if (!lesson || !lesson.learners.length) {
      if (!T.teachIdle) log(state, `${first(T)} is on the Teach role at ${base.name} but has nobody to teach (a learner's skill must be ${TEACH_GAP} or more below theirs).`, "info");
      T.teachIdle = true;
      continue;
    }
    T.teachIdle = false;
    if (!T.teach || !lesson.set) T.teach = { skill: lesson.skill, learners: lesson.learners.slice() };
    const rate = teachRate(T, lesson.skill);
    for (const id of lesson.learners) gainXp(state, survivorById(state, id), lesson.skill, rate, "study");
    gainXp(state, T, "leadership", USE.teachLead);
    gainXp(state, T, "speech", USE.teachSpeech);
  }
}

// ======================================================================================
// Daily and hourly
// ======================================================================================
const RECIPE_SKILL = { ammo: "mechanics", meds: "medicine", parts: "mechanics", preserve: "farming" };

// Use XP from a day's work at a base, by role (× work factor: the ill do less and learn less).
function roleXp(state, base, s) {
  if (s.inBed) return;
  const wf = workFactor(s);
  if (wf <= 0) return;
  switch (s.role) {
    case "farm": gainXp(state, s, "farming", USE.farm * wf); break;
    case "medic": gainXp(state, s, "medicine", USE.medicRole * wf); break;
    case "guard": gainXp(state, s, "shooting", USE.guard * wf); break; // + the hours on guard (skillsHour)
    case "scavenge": gainXp(state, s, "scavenging", USE.scavRole * wf); gainXp(state, s, "stealth", USE.scavStealth * wf); break;
    case "build": gainXp(state, s, "mechanics", (base.construction && base.construction.length ? USE.build : USE.idle) * wf); break;
    case "craft": {
      const job = craftQueue(base)[0];
      const k = job && CRAFTS[job.recipe] ? CRAFTS[job.recipe].skill : "mechanics";
      gainXp(state, s, isSkill(k) ? k : "mechanics", (job ? USE.craft : USE.idle) * wf);
      break;
    }
    case "operate": {
      const b = (base.buildings || []).find((x) => x.id === s.station);
      const def = b ? BUILDINGS[b.type] : null;
      const recipe = def && def.station;
      const k = (recipe && RECIPES[recipe] && RECIPES[recipe].skill) || RECIPE_SKILL[recipe] || "mechanics";
      gainXp(state, s, isSkill(k) ? k : "mechanics", (b ? USE.operate : USE.idle) * wf);
      break;
    }
    default: break;
  }
}

// Unused skills above 10 slip slowly (never below 10 nor the level they joined with).
function decay(state, s) {
  const d = day(state);
  for (const k of SKILLS) {
    const raw = s.skills[k] || 0;
    const floor = Math.max(DECAY_FLOOR, (s.skillFloor && s.skillFloor[k]) || 0);
    if (raw <= floor) continue;
    if (d - (s.xpLast[k] ?? d) <= DECAY_AFTER) continue;
    s.xp[k] = (s.xp[k] || 0) - DECAY_PER_DAY;
    if (xpHooks.onDecay) xpHooks.onDecay(state, s, k, DECAY_PER_DAY);
    if (s.xp[k] < 0) {
      s.skills[k] = raw - 1;
      s.xp[k] = Math.max(0, xpNeed(raw - 1) + s.xp[k]);
      log(state, `${first(s)}'s ${SKILL_NAMES[k]} slipped to ${skill(s, k)} (unused for ${d - s.xpLast[k]} days).`, "info");
    }
  }
}

// Once a day (world.js tickHour, after the bases' day).
export function skillsDaily(state) {
  const d = day(state);
  for (const s of alive(state)) ensureSkills(state, s);
  for (const base of state.bases) {
    const people = atBase(state, base.id);
    for (const s of people) roleXp(state, base, s);
    // The camp's talker (the best Speech awake here) keeps people talking; an outpost's head (its best Leadership,
    // not the leader) runs its day. Only at bases of 3 or more.
    const up = people.filter((s) => !s.inBed && workFactor(s) > 0);
    if (up.length >= 3) {
      const best = (k, pool) => [...pool].sort((a, b) => skill(b, k) - skill(a, k) || a.id - b.id)[0];
      gainXp(state, best("speech", up), "speech", USE.campTalk);
      const heads = up.filter((s) => !s.leader);
      if (base.type !== "hub" && heads.length && !up.some((s) => s.leader)) gainXp(state, best("leadership", heads), "leadership", USE.baseLead);
    }
    teachingDaily(state, base);
    readingDaily(state, base);
    // Inspiring: a daily mood factor of its own (relations.js moodFactors), so it shows in the breakdown.
    // Herbalist: herbs from the plots every 3 days.
    if (d % 3 === 0) for (const s of people) if (s.role === "farm" && !s.inBed && hasPerk(s, "herbalist")) base.stock.meds = (base.stock.meds || 0) + 1;
    // Field Repair at a base.
    if (people.some((s) => hasPerk(s, "fieldrepair"))) fieldRepair(people);
  }
  const lead = alive(state).find((s) => s.leader && s.location && s.location.kind === "base");
  if (lead) gainXp(state, lead, "leadership", USE.leader);
  for (const p of state.parties) {
    if (p.owner !== "player" || p.phase === "holding") continue;
    const team = teamOf(state, p);
    if (!team.length) continue;
    if (team.length >= 2) gainXp(state, [...team].sort((a, b) => skill(b, "leadership") - skill(a, "leadership") || a.id - b.id)[0], "leadership", USE.teamLead);
    const food = team.filter((s) => hasPerk(s, "forager")).length + 3 * team.filter((s) => hasPerk(s, "hunter")).length;
    if (food && p.supplies) p.supplies.food = (p.supplies.food || 0) + food;
    if (team.some((s) => hasPerk(s, "fieldrepair"))) fieldRepair(team);
  }
  for (const s of alive(state)) decay(state, s);
  if (state.autopilot) autoPerks(state);
}

// One use back on every worn-down makeshift item these people wear or carry.
function fieldRepair(people) {
  for (const s of people) {
    const items = [...Object.values(s.gear || {}), ...(s.pockets || []), ...((s.gear && s.gear.backpack && s.gear.backpack.contents) || [])];
    for (const it of items) {
      const d = it && GEAR[it.key];
      const max = (it && it.durMax) || (d && d.dur); // its own maximum when it has one (crafted by quality, crafting.js)
      if (d && d.dur && d.makeshift && !d.tabs && !d.groom && !d.count && Number.isFinite(it.dur) && it.dur < max) it.dur = Math.min(max, it.dur + 1); // makeshift only (real gear wears too now, GEAR_DUR); not a tube of tablets or toiletries: dur counts what is left, not wear
    }
  }
}

// Every hour (world.js tickHour, before teams move): travel XP, the hours on guard, and Pathfinder's pace.
export function skillsHour(state) {
  // On guard at a base (a Guard post or a turn on the watch): Shooting by the hour.
  for (const s of alive(state)) {
    if (s.role === "guard" && !s.inBed && s.location && s.location.kind === "base") gainXp(state, s, "shooting", USE.watchHour);
  }
  for (const p of state.parties) {
    if (p.owner !== "player" || !Array.isArray(p.members)) continue;
    const team = teamOf(state, p);
    // Pathfinder: +10% on foot (parties.js partySpeed reads p.perkSpeed, so estimates and real movement agree).
    const fast = !p.vehicle && team.some((s) => hasPerk(s, "pathfinder")) ? 1.1 : 1;
    if (fast !== 1) p.perkSpeed = fast;
    else if (p.perkSpeed) delete p.perkSpeed;
    const moving = (p.phase === "out" || p.phase === "back") && Array.isArray(p.path) && p.idx < p.path.length - 1;
    if (!moving || p.kind === "convoy") continue;
    for (const s of team) {
      gainXp(state, s, "scouting", USE.travelHour);
      if (p.stance === "stealthy") gainXp(state, s, "stealth", USE.stealthyHour);
      else if (!p.vehicle) gainXp(state, s, "stealth", USE.footHour); // on foot, keeping out of sight
    }
  }
}

// ======================================================================================
// Battles (combat.js)
// ======================================================================================
// Called once the player's units are on the battle map: per-unit perks and the team-wide ones, and XP tallies.
export function battlePerks(state, b) {
  const mine = b.units.filter((u) => u.side === "player");
  let rally = false, commander = false;
  for (const u of mine) {
    const s = survivorById(state, u.sid);
    u.xpT = { shots: 0, hits: 0, melee: 0, kills: 0, heals: 0, sneak: 0, boxes: 0 };
    if (!s) continue;
    if (hasPerk(s, "steadyaim")) u.aim += 5;
    if (hasPerk(s, "brawler")) { u.meleeAim += 10; u.meleeMult = 1.25; }
    if (hasPerk(s, "deadeye")) u.critBonus = 15;
    if (hasPerk(s, "suppressor")) u.owSure = true;
    if (hasPerk(s, "sniper")) u.noFall = true;
    if (hasPerk(s, "lightstep")) u.sneak = 2;
    if (hasPerk(s, "ghost")) u.ghost = true;
    if (hasPerk(s, "assassin")) u.assassin = true;
    if (hasPerk(s, "steadyhands")) u.healMult = 1.25;
    if (hasPerk(s, "miracle")) u.miracle = true;
    if (hasPerk(s, "treasure")) u.scavBonus = 5;
    if (hasPerk(s, "quiethands")) u.quiet = true;
    if (hasPerk(s, "rally")) rally = true;
    if (hasPerk(s, "commander")) commander = true;
  }
  for (const u of mine) {
    if (rally) { u.aim += 5; u.meleeAim += 5; }
    if (commander) u.armor *= 0.9;
  }
}

// When a battle on the map ends: XP from what each unit did (combat.js wearFielded).
export function battleXp(state, b) {
  for (const u of b.units) {
    if (u.side !== "player" || !u.xpT) continue;
    const s = survivorById(state, u.sid);
    if (!s || !s.alive) continue;
    const t = u.xpT;
    gainXp(state, s, "shooting", t.shots * USE.shot + t.hits * USE.hit + t.melee * USE.melee + t.kills * USE.kill, "fight");
    if (t.heals) gainXp(state, s, "medicine", t.heals * USE.heal, "fight");
    if (t.sneak) gainXp(state, s, "stealth", t.sneak * USE.sneak, "fight");
    if (t.boxes) gainXp(state, s, "scavenging", t.boxes * USE.box, "fight");
    u.xpT = null; // counted once
  }
}

// A fight resolved by the numbers (combat.js autoResolveCombat).
export function fightXp(state, people, win) {
  gainXpAll(state, (people || []).filter((s) => s.alive), "shooting", USE.autoFight + (win ? USE.autoWin : 0), "fight");
}

// ======================================================================================
// Autopilot (autopilot.js planRoles): teachers and readers among the people it would otherwise send scavenging
// ======================================================================================
// free: Set of people still without a role this hour; give(s, role). Only when food is comfortable and nothing is
// attacking. One teacher (two at 12+ people), readers up to a sixth of the base.
// plenty (tune-jobcaps): food is past the point where the governor puts more hands on the plots (autopilot.js planRoles
// step 10): then the learners and the copies are the only limit on teachers and readers (no head-count cap); before
// that one teacher (two at 12+) and a reader per 6 people, so the spare hands go to the plots first.
export function planStudy(state, base, free, give, { foodDays = 0, urgent = false, plenty = false } = {}) {
  const people = atBase(state, base.id);
  if (urgent || people.length < 4 || foodDays < 12) return;
  const pool = [...free].filter((s) => !s.inBed && s.mood >= 35).sort((a, b) => (b.role === "teach") - (a.role === "teach") || (b.role === "read") - (a.role === "read") || a.id - b.id);
  const teachers = plenty ? people.length : people.length >= 12 ? 2 : 1;
  let n = 0;
  const taken = new Set(people.filter((s) => s.role === "teach" && !free.has(s)).flatMap((s) => (s.teach ? s.teach.learners : [])));
  for (const T of pool) {
    if (n >= teachers) break;
    const lesson = bestLesson(state, T);
    if (!lesson || skill(T, lesson.skill) < 8) continue;
    const ls = lesson.learners.filter((id) => !taken.has(id));
    if (!ls.length) continue;
    T.teach = { skill: lesson.skill, learners: ls };
    ls.forEach((id) => taken.add(id));
    give(T, "teach");
    n++;
  }
  const free2 = armoryBooks(base);
  for (const s of people) if (s.role === "read" && !free.has(s) && s.reading && free2[s.reading] > 0) free2[s.reading]--;
  let readers = 0;
  const cap = plenty ? people.length : Math.max(1, Math.floor(people.length / 6));
  for (const s of pool) {
    if (readers >= cap || !free.has(s)) continue;
    const k = bestBook(s, free2, state);
    if (!k || (!bookDef(k).skill && s.mood >= 55)) continue;
    free2[k]--;
    s.reading = k;
    give(s, "read");
    readers++;
  }
}

// For tools and the UI: who learns from whom at a base.
export function lessonsAt(state, base) {
  return atBase(state, base.id).filter((s) => s.role === "teach").map((T) => ({ T, lesson: lessonOf(state, T) }));
}
