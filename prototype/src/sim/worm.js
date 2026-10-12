// The worm (lore: Help → The dead and the worm; the design doc's "What the dead are"). Nobody turns from a bite: the
// dead carry a tapeworm and shed its eggs into the soil and the water, and a tile's infection is how thick they lie.
// People catch it by swallowing the eggs; within a day it shows (cramps, fever, the carrier eating like two and getting
// weaker by the day), and in about a week it has eaten them from the inside: its larvae reach the brain and they die
// and get up again as one of the dead. Heat kills the eggs: boiled water and meat cooked through are safe.
//
// Catching it (chances per person; eggs = (infection − CLEAN) / (1 − CLEAN), nothing on cleaner land):
//   - water (purified and un-purified, water.js): any un-purified water can carry it. A full day's drinking of
//     un-purified water is RAW_BASE (from any source, clean ground and rain included) + WATER × its eggs (the ground's
//     × the share drawn from the ground: its well or spring, wells, a stream, the claims' wells, prisoners hauling it;
//     rain catchers bring no eggs), × the share of the day's drinking that was un-purified. At a base (baseWormDaily):
//     the residents (economy.js baseDaily drinks purified water first), and the prisoners, the guests and a holding
//     convoy's crew by the share of their drinking the purified water left over does not cover. Each day before
//     drinking (purifyDaily) a lit water boiler purifies the day's drinking for everyone fed there, each water filter
//     PURIFY_FILTER a day, a shelter's lit and fed fire like the boiler; only in an emergency (the boiler cold for want
//     of firewood, or a shelter's fire with nothing to burn, and no water filter) are the armory's
//     purification tablets used, one per TABS_WATER water. Your people held by a group drink its water: RISE.CAPTIVE of
//     a base's chance there (× GROUPS.BOILER on the eggs once the group boils); a group's own people are GROUPS.
//   - water on the road (drinkHour): RAW_BASE + WATER × the eggs of the un-purified water the team drinks (p.wormEggs:
//     from where it was filled), × the share of the hour's drinking it was. A team drinks purified water first; the
//     un-purified water is made safe by, in this order: a water filter carried; boiling at a camp fire that is lit and
//     fed (firewood carried, or deadfall on the land: woodcutting.js campFireHour), which also boils BOIL un-purified
//     water an hour into purified water (× STOVE with a smokeless stove); purification tablets (data.js puritabs: one
//     per TABS_WATER water) on the move (travelling, exploring, searching) and at a camp whose fire is out or has
//     nothing left to burn; otherwise it is drunk as it is.
//   - an upset stomach (health.js stomach), not the worm: un-purified water also turns the stomach, SICK_X times the
//     worm's chance for the same drink (at most SICK_MAX a roll): mood only, no health, it passes in a few days
//     (sickRoll). Uncooked food with the eggs gives food poisoning (health.js poisoning: wave 2 cooking) at that chance
//     instead: vomiting for a day or two. Only the worm hurts.
//   - raw meat: RAW per ration of meat with eggs eaten uncooked. Game, fish and snares taken on land at MEAT_AT+
//     infection carry eggs, and infested animals always do (foods.js: an egg lot of the raw meat or fish, kept apart
//     from the clean). A base with a cook fire or a preserving room (a shelter with its fire lit) cooks it into meals;
//     drying racks and a hunting cabin's smoke house take it first (smoked is safe). Otherwise it waits in the stores
//     and is eaten last, raw, when the other food runs out. A team cooks it at a camp fire (COOK an hour) and eats it
//     raw only when nothing else is left.
//   - camping on land at CAMP_AT+ infection: CAMP × infection a day (dirty hands, dust, the ground water), half that
//     with the fire lit.
//   - hands that handled the dead: each hour searching a site (a site search, a raid, a city crawl) SEARCH × the
//     tile's eggs per searcher. The day's exposure is kept on the team (p.wormHands) and rolled when the day turns or
//     the team gets home: a team that washes (camped with its fire lit that night, or home the same day to a base
//     whose water is safe) skips the roll SEARCH_WASH of the time. (No gloves in GEAR yet: nothing halves it.)
//   - crops and forage: food grown (farming.js harvest) or gathered (foraging.js, the base job and the team order) on
//     land at CROP_MIN+ infection carries eggs: CROP per ration of crops eaten, FORAGE per ration of forage (egg lots of
//     the crop or forage item: like the meat, eaten last; threshed grain and dry beans are safe). A cook fire or a
//     kitchen cooks them (boiling greens counts); a team's camp fire too.
//   - Iron Stomach (traits.js): whoever has it shrugs off the eggs caught from water, raw food, camping and searching
//     a third of the time (catchWorm: own dice, nothing drawn from the worm's), and an upset stomach is half as likely.
// The water boiler burns BOILER_WOOD_HEAD firewood's worth a head at the base a day (everyone fed there), on every day
// un-purified water would be drunk (the purified water in store and the filters' share do not cover the day): any
// burnable, firewood first, then the armory's burnable gear the base allows (woodcutting.js boilerBurnables: items
// marked to burn, and cheap junk while "Boiler may burn spare wooden items and paper" is on), then fuel (HEAT.wood a
// firewood). A base that cannot cover the day leaves it cold: the water filters and a shelter's fire purify what they
// can, then (only with no filter) the emergency tablets, else the water is drunk un-purified.
// The other groups (GROUPS, groupsDaily): a group base on infected ground loses people to the worm at the rate a
// player base of its size would catch it (water WATER + crops CROP at CROP_MIN+, × eggs, × UNCURED: the half they
// never cure), × its type (TYPE: military and fortress hubs boil their water, traders mostly, communes farm infected
// land), and after a base's first loss it boils its water too (BOILER). Never below MIN people: the worm thins a
// group, it never ends one. Their parties on the move (and hardcore bands) lose one now and then on herd land or
// badly infected ground (ROAD × eggs a day). Losses are radio news (diplomacy.js) and chronicle notes.
// The course (s.worm: { v: 2, stage, day, len, since, why, how, from (the cause as given), seen, treatedDay, carded,
// locked, paid }): no silent days. From the day it is caught (day 0) each day costs DAY_HP[day − 1] health (3, 6, 10,
// 15, 20, 24, 30: about 108 in seven days, then LATE_HP a day) and DAY_MOOD[day − 1] mood (2 … 8, through
// relations.js addMood: the mood floor, the breaks and the notes follow). While it is in them every healing heals
// HEAL (half) of the usual (wormHealMult: medical.js rest, treatments and field treatment, orders.js camp rest, a
// holding convoy, a prisoner's rations, a battle's patch-up), and a hospital bed adds nothing (medical.js
// healRatePerHour: they heal there as on a cot): the ramp outpaces it.
// Untreated at full health they die on day 7 with no rest (on the move), day 8 resting at a base or in a Clinic's bed
// alike, later treated with meds every night (medicatedDay; wormtest prints the day); hurt, sooner.
// The daily dose (wormDose): each day the course moves, someone whose worm is known takes DOSE_MEDS meds from where
// they are (the base's stores, or the team's packs and cargo; a prisoner with the base's "Treat prisoners and guests
// too" on) while there are any: a medicated day.
// Meds slow it (medicatedDay): on a day their care used meds (a wound treated, an illness dosed, a purge that failed,
// field treatment on the road: s.medsHour since the last day of the course), the day's damage is MEDS_HP of the usual
// and the course moves on only MEDS_SLOW of a day (every second such day it holds where it is). It never clears it:
// only a dewormer (or a purge, or surgery once it is in the brain) takes the worm out.
//   gut    days 1 to BRAIN_FROM − 1: they eat GUT_EAT more a day and work at GUT_WORK. A dewormer cures it surely,
//          a purge by the odds.
//   brain  from day BRAIN_FROM: fits and staggering (it gives itself away: BRAIN_SPOT), work at BRAIN_WORK; only
//          surgery at a Clinic or better can save them.
//   An old save's course (v 1: eggs, gut for weeks, brain for days) keeps its stage and moves onto the new day count
//   in proportion (migrateWorm): eggs → day 0 of the gut stage, gut → days 1–4, brain → days 5–6.
// Spotting it: the damage shows from day 1. At a base each day SPOT + SPOT_MED × the best Medicine there (× SPOT_MEDIC
// with someone on the Medic role); on a team from day TEAM_FROM, TEAM_SPOT + TEAM_SPOT_MED × the best Medicine. A team
// that spots it gets the card "The worm"; at a base the gut stage goes to the Medical tab, the brain stage is a card.
// In a battle (carriers.js wormBattleRound) each battle hour (6 turns) costs an infected unit a 24th of the coming
// day's damage (w.paid, taken off that day's damage at midnight).
// Prisoners (your cells) and guests sheltering at a base are spotted the same way (spotOther) and take the same three
// cures (otherTreatInfo, applyOtherTreat: the Medical tab, the Prisoners tab, the guests' card): a guest cured is
// goodwill with their group (OTHERS.GUEST, a failed but honest attempt GUEST_TRIED), a prisoner's opinion of you rises
// (OTHERS.OPINION / OPINION_TRIED) and their group's goodwill +RETURN_GOODWILL when released or traded back. The
// night's care treats them only with the base's "Treat prisoners and guests too" on (base.wormCareOthers, default off;
// the autopilot turns it on while guests shelter there).
// Treating it (at a base: the Medical tab's buttons, and the night's automatic care, a dewormer first):
//   - a dewormer (loot: pharmacies, clinics, hospitals, farms and ranches; made at a med station): a sure cure in the
//     gut stage, DEWORM_HP health, no medic needed (a team carrying one can use it on the road);
//   - a purge (gut stage): PURGE_MEDS meds and a medic's treatment, PURGE + PURGE_MED × Medicine + PURGE_TIER a
//     hospital tier (at most PURGE_MAX): passed at PURGE_HP health, or it holds on (PURGE_FAIL_HP; again tomorrow);
//   - surgery (brain stage, a Clinic or better): SURGERY_MEDS meds and SURGERY_LOAD of one medic's treatments,
//     SURGERY + SURGERY_MED × Medicine (at most SURGERY_MAX): cured at SURGERY_HP health, or they die on the table.
// Death and rising (wormRise, from carriers.js riseOnMap: anyone who dies with the worm in them, of it or of anything
// else, outside a battle), by where they are:
//   - at your base (a resident, a convoy crew holding there; prisoners and guests: riseAtBase): they get up and go for
//     the nearest people: one hurt by TURN_HURT (a second one TURN_SECOND of the time), each killed TURN_KILL of the
//     time (half that with a guard on duty), and everyone there loses TURN_MOOD mood; locked away (the brain-stage
//     card, a prisoner idle in a cell) nobody is hurt. The body is put down; its things go to the armory.
//   - on the road (a team on the move, resting or working, a convoy on its way): the card
//     "<name> rose": put them down (the team's fighters against one of the dead by the numbers: someone may be hurt;
//     their things are kept), leave them (a death site with their things), or, when someone noticed the last breath
//     (RISE.NOTICE + RISE.NOTICE_SKILL × the best of Medicine and Scouting), crush the skull before they rise. Alone,
//     they walk off with their things (carriers.js walking loot).
//   - in a city crawl, on a block card: the encounter "One of you turned" (citycrawl.js crawlTurned), fought like the
//     street encounters; the Alert rises. Inside a building (a battle): the unit dies and a zombie takes its place on
//     the same cell and floor (carriers.js riseInBattle), up at once in the enemy phase.
//   - at another group's base (held prisoner there, or a team visiting it): the group puts the body down; it may lose
//     one of its own (RISE.HOST_LOSS); a visit costs RISE.ENVOY_GOODWILL goodwill (you brought it among them), a
//     prisoner none. A log line when you would hear of it (radio reach, or the team there).
//   - on a personal errand (hubevents.js): alone, far from help: a death site where they fell.
//
// Infested animals (state.herds, HERD): game living on land at BORN_AT+ infection catches it too: thin deer and hogs
// that do not attack, carrying the eggs to cleaner ground. While there are fewer than PER_1000 herds per 1,000 tiles,
// one is born SPAWN a day on such land. A herd moves on MOVE of the days (to a land tile next to it, the cleanest one
// DOWNHILL of the time: they wander out of the dead land to graze, toward farms and bases) and seeds the land it
// stands on: the tile's own infection level +SEED × its size / 6 a day, up to SEED_CAP. It lives LIFE days.
// Infested share of a tile's game: (infection − SHARE_AT) / SHARE_SPAN (at most SHARE_MAX), + HERD_SHARE with a herd
// there. Each kill there is infested at that share: YIELD of its food, all of it with eggs, and on a herd's tile one
// animal fewer in the herd (a herd hunted out is gone: a reason to hunt them).
import { log, addCard, alive, residents, atBase, skill, hurt, day, baseById, survivorById, hub, factionById, combatPower, localId } from "./world.js";
import { GEAR } from "./data.js";
import { stomachShrugs, stomachMult } from "./traits.js"; // Iron Stomach, Weak Stomach
import { Rng } from "./rng.js";
import { count, isShelter } from "./buildings.js";
import { partyMembers, partyTile, bestSkill, carried, takeSupply, wipeIfEmpty, cardStale, tileLabel, teamName } from "./parties.js";
import { activeHospital, careCtx, pickTreater, spendMedicTime, autoCareOn, noTimeReason, nextDayText, medsToday, partyMeds, takeMeds } from "./medical.js";
import { waterProduction, waterNeed } from "./economy.js";
import { RAW, teamRawIn, waterIn } from "./water.js"; // purified and un-purified water
import { eatFromStore } from "./storage.js";
import { FOODS, eggFood, eggKind, takeFood, unitsOf, qtyOf } from "./foods.js"; // egg lots (food with the worm's eggs)
import { teamFire, teamKit, fireLit } from "./fieldheat.js";
import { packOf } from "./inventory.js";
import { takeOneAt, countKey } from "./itemstack.js"; // a stack of dewormers: one at a time
import { gainXp, USE } from "./skills.js";
import { mouthsAt, HEAT, perHeadText } from "./upkeep.js";
import { news } from "./diplomacy.js";
import { chronicleNote } from "./chronicle.js";
import { bandsOf } from "./hardcore-groups.js";
import { addMood } from "./relations.js"; // the worm's mood a day (the floor, the breaks, the notes)
import { addCondition } from "./health.js"; // an upset stomach from un-purified water and uncooked food
import { changeGoodwill } from "./factions.js";
import { canRadioGroup } from "./radio.js";
import { crawlTurned } from "./citycrawl.js"; // one of you turned on a city block
import { hiveCrawlTurned } from "./hivecrawl.js"; // one of you turned inside a hive
import { prisonersAt, inCell, taskOf, dropPrisoner } from "./prisoners.js";
import { leaveMap } from "./visitors.js";
import { teamCookHour } from "./cooking.js"; // wave 2 cooking: a team's camp fire cooks its raw meat into meals
import { kitchenService, kitchenCold } from "./kitchen.js"; // the Kitchen boils the meals' water (purifyCap) and cooks like a cook fire (baseCooks)
import { fireLandOk, WOOD, boilerBurnables, burnOf, burnablesWood, itemsText } from "./woodcutting.js"; // what keeps a camp fire burning; what the boiler may burn

export const WORM = {
  // Catching it
  CLEAN: 0.1, WATER: 0.02, RAW: 0.04, MEAT_AT: 0.25, CAMP_AT: 0.5, CAMP: 0.03, CAMP_FIRE: 0.5,
  // Any un-purified water, from any source: a full day's drinking of it (on top of WATER × its eggs). About one case
  // per 10 people per 30 days of nothing but un-purified water on clean ground.
  RAW_BASE: 0.0035,
  // An upset stomach (health.js stomach) from the same un-purified water or uncooked food: SICK_X × the worm's chance,
  // at most SICK_MAX a roll
  SICK_X: 3, SICK_MAX: 0.25,
  // Hands that handled the dead: an hour's searching, × eggs; the wash (a fire that night or safe water at home)
  SEARCH: 0.004, SEARCH_WASH: 0.75, SEARCH_WARN: 0.3,
  // Crops and forage from land at CROP_MIN+ infection, per ration eaten
  CROP_MIN: 0.4, CROP: 0.015, FORAGE: 0.02,
  // The course: health and mood lost on day 1, 2, 3 … of it (LATE_HP and the last mood after); the brain from day
  // BRAIN_FROM; about COURSE days in all
  DAY_HP: [3, 6, 10, 15, 20, 24, 30], LATE_HP: 40, DAY_MOOD: [2, 3, 4, 5, 6, 7, 8], BRAIN_FROM: 5, COURSE: 7,
  GUT_EAT: 1, GUT_WORK: 0.85, BRAIN_WORK: 0.3,
  // Spotting it (the damage shows from day 1)
  SPOT: 0.5, SPOT_MED: 0.05, SPOT_MEDIC: 1.5, TEAM_FROM: 1, TEAM_SPOT: 0.35, TEAM_SPOT_MED: 0.05, BRAIN_SPOT: 1,
  // Treating it
  // Healing while it is in them: HEAL of the usual rate from every source (wormHealMult)
  HEAL: 0.5,
  // Actively healed with meds that day (medicatedDay): MEDS_HP of the day's damage, the course moves MEDS_SLOW of a day
  MEDS_HP: 0.5, MEDS_SLOW: 0.5,
  // The daily dose (wormDose): meds a day for each known carrier, from the base or the team, while there are any
  DOSE_MEDS: 1,
  DEWORM_HP: 10, PURGE_MEDS: 2, PURGE: 0.5, PURGE_MED: 0.04, PURGE_TIER: 0.08, PURGE_MAX: 0.95, PURGE_HP: 25, PURGE_FAIL_HP: 10,
  SURGERY_MEDS: 4, SURGERY_LOAD: 3, SURGERY: 0.35, SURGERY_MED: 0.04, SURGERY_MAX: 0.9, SURGERY_HP: 40,
  ROAD_PURGE_HP: 50, ROAD_FAIL_HP: 15, HOPE: 0.25, HOPE_BRAIN: 0.08,
  // Treating prisoners and guests (applyOtherTreat): a guest cured, their group's goodwill +GUEST (+GUEST_TRIED for a
  // failed but honest attempt); a prisoner, their opinion of you +OPINION (+OPINION_TRIED), and their group's goodwill
  // +RETURN_GOODWILL more when they are later released or traded back (prisoners.js)
  OTHERS: { GUEST: 8, GUEST_TRIED: 3, OPINION: 12, OPINION_TRIED: 5, RETURN_GOODWILL: 3 },
  // Turning
  TURN_HURT: [10, 35], TURN_SECOND: 0.5, TURN_KILL: 0.12, TURN_MOOD: 8, LOCKED_MOOD: 4,
  // Rising away from your bases (wormRise): someone notices the last breath (the best of Medicine and Scouting); the
  // team puts the risen down (hurt: the chance someone is hurt, by the numbers, PUT_HURT the damage); at a group's
  // base it may lose one of its own, and a visit costs goodwill; your people held by a group catch it at CAPTIVE of a
  // base's chance (they drink what they are given)
  RISE: { NOTICE: 0.2, NOTICE_SKILL: 0.06, NOTICE_MAX: 0.9, PUT_HURT: [8, 25], HURT_MIN: 0.06, HURT_MAX: 0.6, HOST_LOSS: 0.15, ENVOY_GOODWILL: -5, CAPTIVE: 0.5 },
  // Clean water and cooked meat: a camp fire an hour; the base's water boiler a day (firewood a head, like heating;
  // BOILER_DAYS: the days of its firewood a base keeps in store)
  BOIL: 6, STOVE: 2, COOK: 12, BOILER_WOOD_HEAD: 6, BOILER_DAYS: 14, // BOILER_WOOD_HEAD: firewood of 0.1 kg (0.6 kg a head a day)
  // Purification tablets (data.js puritabs): water one tablet makes safe (teams; a base only in the no-firewood
  // emergency); a base's water filter purifies PURIFY_FILTER water a day
  TABS_WATER: 10, PURIFY_FILTER: 10,
  // The other groups (groupsDaily)
  GROUPS: {
    UNCURED: 0.5, BOILER: 0.3, MIN: 4, ROAD: 0.03, HERD_EGGS: 0.5,
    TYPE: { military: 0.3, fortress: 0.3, traders: 0.6, commune: 1.2, raider: 1, zealot: 1, expansionist: 1 },
  },
};
export const HERD = {
  BORN_AT: 0.6, PER_1000: 2, SPAWN: 0.08, SIZE: [3, 8], LIFE: [60, 120], MOVE: 0.7, DOWNHILL: 0.6,
  SEED: 0.006, SEED_CAP: 0.35, SHARE_AT: 0.35, SHARE_SPAN: 0.5, SHARE_MAX: 0.8, HERD_SHARE: 0.5, YIELD: 0.25,
};
export const STAGE_NAMES = { gut: "gut stage", brain: "in the brain" };
const HERD_LAND = { forest: 1, hills: 1, plains: 1, mountain: 1, suburb: 0.5 };

const first = (s) => s.name.split(" ")[0];
const r2 = (v) => Math.round(v * 100) / 100;
const stats = (state) => state.wormStats || (state.wormStats = { caught: 0, water: 0, meat: 0, camp: 0, search: 0, crop: 0, forage: 0, spotted: 0, cured: 0, turned: 0, killed: 0, herds: 0, herdKills: 0, groups: 0, road: 0 });
export const wormStatsOf = stats;
// The worm's own dice (state.wormRng, keyed by the seed): the world's rng sequence is untouched by it, so a world where
// nobody catches it plays out as it would without the worm.
export const wormRng = (state) => state.wormRng || (state.wormRng = new Rng((((state.seed || 1) * 2654435761) ^ 0x5eed) >>> 0));

// ---------- the course ----------
// Health and mood lost on day d of the course (1, 2, …).
export const dayHp = (d) => (d < 1 ? 0 : d <= WORM.DAY_HP.length ? WORM.DAY_HP[d - 1] : WORM.LATE_HP);
export const dayMood = (d) => (d < 1 ? 0 : WORM.DAY_MOOD[Math.min(d, WORM.DAY_MOOD.length) - 1]);
export const stageFor = (d) => (d >= WORM.BRAIN_FROM ? "brain" : "gut");
// An old save's course (v 1: eggs for a week or so, the gut for weeks, the brain for days) onto the new day count, in
// proportion: eggs → day 0, the gut → days 1 to BRAIN_FROM − 1, the brain → days BRAIN_FROM to COURSE − 1. Returns w.
export function migrateWorm(w) {
  if (!w || w.v === 2) return w;
  const f = w.len > 0 ? Math.max(0, Math.min(0.999, (w.day || 0) / w.len)) : 0;
  const gutDays = WORM.BRAIN_FROM - 1, brainDays = Math.max(1, WORM.COURSE - WORM.BRAIN_FROM);
  if (w.stage === "brain") w.day = WORM.BRAIN_FROM + Math.floor(f * brainDays);
  else if (w.stage === "gut") w.day = 1 + Math.floor(f * gutDays);
  else w.day = 0;
  w.stage = stageFor(w.day);
  w.len = WORM.COURSE;
  w.paid = 0;
  w.v = 2;
  return w;
}

// ---------- people ----------
export const wormOf = (s) => (s && s.alive && s.worm ? migrateWorm(s.worm) : null);
// Carries it, at any stage, alive or just dead (the Carrier's worm swarm, carriers.js: a carrier who dies rises).
export const hasWorm = (s) => !!(s && s.worm);
// Gone without a cure (put down, died of it, a test): no stats.
export function clearWorm(s) {
  if (s) s.worm = null;
}
// Healing while the worm is in them (rest at a base and in its hospital, a treatment's heal, camp rest, field
// treatment, a holding convoy's rest, a prisoner's rations, a battle's patch-up): HEAL of the usual, except in a
// hospital bed's own healing does nothing for them (medical.js healRatePerHour). The ramp outpaces it: untreated it
// still kills.
export const wormHealMult = (s) => (s && s.worm ? WORM.HEAL : 1);
// Meds used on them (s.medsHour: a wound treated, an illness dosed, a failed purge, field
// treatment) in the last day, each treatment counted once (w.medsHour: the one counted). Returns true on such a day.
function medicatedDay(state, s, w) {
  if (!medsToday(state, s) || s.medsHour === w.medsHour) return false;
  w.medsHour = s.medsHour;
  return true;
}
// The daily dose: a known carrier takes DOSE_MEDS meds from the base's stores (base) or the team's packs (party) when
// there are enough; marks the meds used (s.medsHour) so today is a medicated day. Returns true when dosed.
function wormDose(state, s, w, { base = null, party = null } = {}) {
  if (w.seen == null) return false; // nobody knows yet
  if (base) {
    if (!((base.stock.meds || 0) >= WORM.DOSE_MEDS)) return false;
    base.stock.meds -= WORM.DOSE_MEDS;
  } else if (party) {
    if (!(partyMeds(party) >= WORM.DOSE_MEDS)) return false;
    takeMeds(party, WORM.DOSE_MEDS);
  } else return false;
  s.medsHour = state.hour;
  return true;
}
// A day of the course: the day it moves to (held there every second medicated day) and the day's damage before w.paid.
function advanceCourse(state, s, w) {
  const meds = medicatedDay(state, s, w);
  let step = 1;
  if (meds) {
    w.lag = (w.lag || 0) + (1 - WORM.MEDS_SLOW);
    if (w.lag >= 1) { w.lag -= 1; step = 0; }
  }
  w.day = Math.max(1, w.day + step);
  w.stage = stageFor(w.day);
  return { meds, held: step === 0, hp: dayHp(w.day) * (meds ? WORM.MEDS_HP : 1) };
}
// Known to you: spotted at a base or by the team.
export const wormSeen = (s) => { const w = wormOf(s); return !!w && w.seen != null; };
// How much they can work (health.js workFactor): 1 unless the worm has hatched.
export function wormWork(s) {
  const w = wormOf(s);
  if (!w || !(w.day >= 1)) return 1; // caught today: nothing yet
  return w.stage === "brain" ? WORM.BRAIN_WORK : WORM.GUT_WORK;
}

// Swallowed the eggs: the worm starts (day 0; it shows from tomorrow). why: the cause, in words or a key ("swarm": a
// Carrier's worm swarm in battle, carriers.js); how: water, meat or camp (for the stats). Returns true if new.
export function catchWorm(state, s, why = "", how = "") {
  if (!s || !s.alive || s.worm) return false;
  if (stomachShrugs(state, s, how)) return false; // Iron Stomach (traits.js): swallowed eggs shrugged off now and then, own dice
  const from = why;
  if (why === "swarm") { why = "from a worm swarm in a fight"; how = how || "swarm"; }
  s.worm = { v: 2, stage: "gut", day: 0, len: WORM.COURSE, since: day(state), why, how, from, seen: null, treatedDay: -99, carded: "", paid: 0 };
  const st = stats(state);
  st.caught++;
  if (how) st[how] = (st[how] || 0) + 1;
  return true;
}
export function cureWorm(state, s) {
  if (!s || !s.worm) return;
  s.worm = null;
  stats(state).cured++;
}

// Eggs in a tile's ground and water: 0 below CLEAN infection, 1 at full.
export function eggsAt(state, tile) {
  const t = state.tiles[tile];
  if (!t) return 0;
  return Math.max(0, Math.min(1, ((t.infection || 0) - WORM.CLEAN) / (1 - WORM.CLEAN)));
}

// Water drawn on a tile (its ground water, or the river or lake beside it): the worst of them.
export function sourceEggs(state, tile) {
  const wet = state.grid.neighbors(tile).filter((id) => state.tiles[id] && state.tiles[id].terrain === "water");
  return Math.max(eggsAt(state, tile), ...wet.map((id) => eggsAt(state, id)));
}

// ---------- water at a base ----------
// Purified and un-purified water (water.js): what the base draws from the land is un-purified (stock.rawwater). Each day
// before drinking (purifyDaily) it is purified: a lit water boiler purifies the day's drinking for everyone fed here,
// each water filter (in the armory or held by someone here) PURIFY_FILTER a day, a shelter's lit and fed fire like the
// boiler. People drink purified water first, then un-purified water (economy.js baseDaily: base.drank), and the share
// drunk un-purified is rolled (baseWormDaily): RAW_BASE + WATER × the eggs of the un-purified water here. Purification
// tablets are kept for the teams on the road: a base uses the armory's only in an emergency, when its boiler is cold
// with nothing to burn (no firewood, allowed junk or fuel; or a shelter's fire has nothing to burn) and it has no water filter.
export const hasBoiler = (base) => count(base, "boiler") > 0;
const isFilter = (it) => !!(it && GEAR[it.key] && GEAR[it.key].water);
// Water filters here: in the armory, or held by someone at the base.
export const filterCount = (state, base) => base.armory.filter(isFilter).length + atBase(state, base.id).filter((s) => isFilter(s.gear.tool)).length;
export const baseFilter = (state, base) => filterCount(state, base) > 0;
// The eggs in this base's un-purified water: { raw (the ground's and the river's, 0..1), ground (the share of what it
// makes drawn from the ground: rain catchers give clean water), eggs (raw × ground) }.
export function rawWaterEggs(state, base) {
  const raw = sourceEggs(state, base.tile);
  if (!(raw > 0)) return { raw: 0, ground: 0, eggs: 0 };
  const prod = waterProduction(state, base);
  // Field wells (fieldworks.js) draw deep ground water: half the eggs of the ground's (still un-purified: boil it).
  // With the job trips (FIELD.PASSIVE_WELLS off) the field wells' water comes in by the water carriers: the day's
  // carried well water (jobtrips.js base.tripTally.water.well) counts the same way.
  const T = base.tripTally && base.tripTally.day === Math.floor((state.hour - 1) / 24) ? base.tripTally.water : null;
  const field = (prod.field || 0) + ((T && T.well) || 0);
  const ground = prod.own + prod.stream + prod.wells + prod.hauled + field * 0.5;
  const all = prod.own + prod.stream + prod.wells + prod.hauled + field + prod.rain;
  const share = all > 0 ? ground / all : 0;
  return { raw, ground: share, eggs: raw * share };
}
// What the base can purify a day: { drink (the day's drinking for everyone fed here), boiler, fire, filters, nFilters,
// total }. The boiler counts while it is built and not cold (on the day itself: only if it burned, burned = true/false).
export function purifyCap(state, base, burned = null) {
  const need = waterNeed(state, base);
  const drink = r2(need.people + need.prisoners + need.guests);
  const nFilters = filterCount(state, base);
  const boiler = hasBoiler(base) && (burned == null ? base.boiling !== false : burned) ? drink : 0;
  const fire = isShelter(base) && fireLit(base) && base.fireFed !== false ? drink : 0; // a fire with nothing to burn boils nothing (woodcutting.js shelterFire)
  const filters = nFilters * WORM.PURIFY_FILTER;
  // The Kitchen (kitchen.js KITCHEN.boil): the meals' water (soup, tea, porridge) is boiled, a share of the day's
  // drinking by the cooks' cover; nothing to add where a boiler or a shelter's fire boils it all already.
  const kitchen = boiler > 0 || fire > 0 ? 0 : r2(drink * kitchenService(state, base).boil);
  return { drink, boiler, fire, filters, nFilters, kitchen, total: r2(boiler + fire + filters + kitchen) };
}
// The share of a day's drinking that will be un-purified: what the purified water in store and what can be purified
// today leave.
function rawShareOf(base, cap) {
  const st = base.stock;
  const pure = Math.max(0, st.water || 0) + Math.min(Math.max(0, st[RAW] || 0), cap.total);
  return cap.drink > 0 ? Math.max(0, Math.min(1, (cap.drink - pure) / cap.drink)) : 0;
}
// A day's chance of the worm for someone drinking at this share un-purified water with these eggs.
export const waterRisk = (eggs, share) => Math.max(0, (WORM.RAW_BASE + WORM.WATER * Math.max(0, eggs || 0)) * Math.max(0, Math.min(1, share || 0)));
// What the base drinks: { eggs (0..1: the eggs in the day's drinking, after the purified water), risk (the worm's
// chance a person today: waterRisk), raw (the ground's eggs), ground (share from the ground), rawShare (the share of
// the day's drinking that will be un-purified), drawn (un-purified water comes in here or is in store: it has to be
// purified), safe (nothing un-purified will be drunk), why, cap (purifyCap) }.
export function baseWater(state, base) {
  const e = rawWaterEggs(state, base);
  const cap = purifyCap(state, base);
  const share = rawShareOf(base, cap);
  const drawn = (base.stock[RAW] || 0) > 0 || waterProduction(state, base).total > 0;
  const boil = hasBoiler(base) ? boilerUse(state, base) : null;
  const how = [];
  if (cap.boiler > 0) how.push(`boiled in the water boiler (${boil.text})`);
  if (cap.fire > 0) how.push("boiled on the fire");
  if (cap.kitchen > 0) how.push(`boiled for the meals in the kitchen (${Math.round(cap.kitchen)} a day)`);
  if (cap.filters > 0) how.push(`through ${cap.nFilters === 1 ? "a water filter" : `${cap.nFilters} water filters`} (${cap.filters} a day)`);
  if (!(share > 0)) return { eggs: 0, risk: 0, raw: e.raw, ground: e.ground, rawShare: 0, drawn, safe: true, cap, why: how.length ? how.join(" and ") : drawn ? "purified water in store" : "no un-purified water here" };
  const cold = boil && base.boiling === false ? `the water boiler is cold (nothing to burn: it needs ${boil.text}); ` : "";
  const part = share < 1 ? `${Math.round(share * 100)}% of the day's drinking is un-purified (${how.length ? how.join(" and ") : "the purified water in store"} cover${how.length > 1 ? "" : "s"} the rest)` : "drunk un-purified";
  const from = e.eggs > 0 ? `drawn from infected ground${e.ground < 1 ? ` (${Math.round(e.ground * 100)}% of it from the ground)` : ""}: it carries the worm's eggs` : "clean ground, but any un-purified water can carry the worm";
  const risk = waterRisk(e.eggs, share);
  return { eggs: e.eggs * share, risk, raw: e.raw, ground: e.ground, rawShare: share, drawn, safe: false, cap, why: `${cold}${from}, not boiled or filtered: ${part} (the worm ${Math.round(risk * 1000) / 10}% a person a day)` };
}

// The base's water boiler: what it burns a day: BOILER_WOOD_HEAD firewood a head (everyone fed here). It burns
// anything burnable, in this order: firewood; then the armory's burnable gear the base allows (woodcutting.js
// boilerBurnables: items marked to burn, and cheap junk with "Boiler may burn spare wooden items and paper" on), each
// worth its firewood by weight (woodcutting.js burnOf); then fuel for the rest (HEAT.wood fuel a firewood, as heating).
// { active (it has work here: the water filters do not purify the day's drinking: any un-purified water can carry the worm),
// heads, wood (firewood on a day it burns), fuel (the same in fuel), share (the share of days it burns), lit (base.boiling),
// text ("25 people × 6 = 150 firewood a day (or burnable junk, or 1.0 fuel)") }. On a given day it burns only when
// un-purified water would be drunk (boilerDaily).
export function boilerUse(state, base) {
  const heads = mouthsAt(state, base).heads;
  const wood = r2(heads * WORM.BOILER_WOOD_HEAD);
  const fuel = r2(wood * HEAT.wood);
  const cap = purifyCap(state, base);
  const active = hasBoiler(base) && heads > 0 && cap.filters < cap.drink;
  // share: the days it burns, about (the share of the drinking the filters leave un-purified): each day it burns
  // purifies a whole day's drinking, so with filters covering part of it the purified water carries over.
  const share = active && cap.drink > 0 ? r2(Math.max(0, Math.min(1, 1 - cap.filters / cap.drink))) : 0;
  const text = heads ? `${perHeadText(heads, heads === 1 ? "person" : "people", WORM.BOILER_WOOD_HEAD)} firewood a day (or burnable junk, or ${fuel.toFixed(1)} fuel)` : "nobody here";
  return { active, heads, wood, fuel, share, lit: base.boiling !== false, text };
}
// Daily, before drinking (purifyDaily): on a day the purified water in store and the filters' share do not cover the
// day's drinking, the boiler burns the day's firewood from the stores; short of it, the armory's burnable items the
// base allows (the cheapest firewood first, whole items: what they make beyond the day stays as firewood), then fuel
// for the rest. An outpost short of firewood and fuel is covered from the hub over its supply line like its heating
// (needs.js heatDaily). A base that cannot cover the whole day burns nothing and leaves it cold: the filters and a
// shelter's fire purify what they can, then (no filter) the emergency tablets, else un-purified water. A log line says
// what it burned when it was not firewood. Returns true when it burned.
function boilerDaily(state, base, people) {
  base.boilerBurn = { wood: 0, fuel: 0 };
  if (!hasBoiler(base) || !people.length) return false;
  const use = boilerUse(state, base);
  if (!use.active) { base.boiling = true; return false; } // the filters do it: it stands ready
  const st = base.stock;
  const cap = purifyCap(state, base, false);
  const wanted = (st[RAW] || 0) > 0 && Math.max(0, st.water || 0) + Math.min(Math.max(0, st[RAW] || 0), cap.filters) + 1e-9 < cap.drink;
  if (!wanted) { base.boiling = true; return false; } // enough purified water today (or nothing to boil): it stands ready
  const woodIn = () => Math.max(0, st.wood || 0);
  const heatIn = () => woodIn() * HEAT.wood + Math.max(0, st.fuel || 0);
  const h = base.type === "outpost" ? hub(state) : null;
  const strength = base.supplyLine ? base.supplyLine.strength : 0.5;
  if (h && h !== base && heatIn() < use.fuel && strength > 0) {
    const hb = boilerUse(state, h);
    const keepWood = (hb.active ? hb.wood : 0) * 2;
    const spareWood = Math.max(0, (h.stock.wood || 0) - keepWood);
    const sendWood = Math.min(spareWood, (use.fuel - heatIn()) / HEAT.wood / strength);
    if (sendWood > 0) { h.stock.wood -= sendWood; st.wood = woodIn() + sendWood * strength; }
    const spareFuel = Math.max(0, (h.stock.fuel || 0) - Math.max(0, 2 * (hb.active ? hb.fuel : 0) - Math.max(0, h.stock.wood || 0) * HEAT.wood));
    const send = Math.min(spareFuel, Math.max(0, use.fuel - heatIn()) / strength);
    if (send > 0) { h.stock.fuel -= send; st.fuel = Math.max(0, st.fuel || 0) + send * strength; }
  }
  // The plan: firewood, then whole items (the cheapest firewood first) while short, then fuel.
  const wood = Math.min(woodIn(), use.wood);
  const items = [];
  let short = use.wood - wood;
  for (const it of short > 1e-9 ? boilerBurnables(base) : []) { if (short <= 1e-9) break; items.push(it); short -= burnOf(it); }
  const fromItems = burnablesWood(items);
  const fuelNeed = Math.max(0, (use.wood - wood - fromItems) * HEAT.wood);
  const lit = (st.fuel || 0) + 1e-9 >= fuelNeed;
  if (lit) {
    st.wood = Math.max(0, woodIn() - wood + Math.max(0, fromItems - (use.wood - wood))); // what the items make beyond the day stays as firewood
    for (const it of items) base.armory.splice(base.armory.indexOf(it), 1);
    st.fuel = Math.max(0, (st.fuel || 0) - fuelNeed);
    base.boilerBurn = { wood: r2(wood), fuel: r2(fuelNeed), items: items.length, itemWood: fromItems };
    if (base.boiling === false) log(state, `The water boiler at ${base.name} is burning again.`, "good");
    if (items.length) log(state, `The water boiler at ${base.name} burned ${itemsText(items)} (${fromItems} firewood's worth)${fuelNeed > 0 ? ` and ${r2(fuelNeed)} fuel` : ""}: ${wood > 0 ? "the firewood ran short" : "no firewood left"}.`, "info");
  } else if (base.boiling !== false) {
    const then = filterCount(state, base) > 0 ? "The water filters purify what they can; the rest is drunk un-purified"
      : isShelter(base) && fireLit(base) && base.fireFed !== false ? "The fire boils the water today"
      : tabStacks([], [base.armory]).length ? "The armory's purification tablets treat the water while they last" : "The water is drunk un-purified";
    log(state, `The water boiler at ${base.name} is cold: nothing left to burn (it needs ${use.text}). ${then}.`, "danger");
  }
  base.boiling = lit;
  return lit;
}
// Daily (economy.js baseDaily, before drinking): the boiler burns if it has to, then the boiler, the water filters and
// a shelter's lit fire turn un-purified water into purified water; then, only in the no-firewood emergency
// (emergencyTabs), the armory's purification tablets. base.purified = { day, q, boiler, fire, filters, tabs, total,
// drink }. Returns the water purified.
export function purifyDaily(state, base) {
  const people = residents(state, base.id);
  const burned = boilerDaily(state, base, people);
  const cap = purifyCap(state, base, burned);
  const st = base.stock;
  const raw = Math.max(0, st[RAW] || 0);
  const q = r2(Math.min(raw, cap.total));
  if (q > 0) { st[RAW] = r2(raw - q); st.water = r2(Math.max(0, st.water || 0) + q); }
  const tabs = people.length ? emergencyTabs(state, base, cap) : 0;
  base.purified = { day: day(state), q: r2(q + tabs), boiler: cap.boiler, fire: cap.fire, filters: cap.filters, tabs, total: cap.total, drink: cap.drink };
  return q + tabs;
}
// The no-firewood emergency: a boiler cold with nothing to burn (or a shelter whose lit fire has nothing to burn) and
// no water filter here.
export function tabsEmergency(state, base, cap = purifyCap(state, base)) {
  const noFire = (hasBoiler(base) && base.boiling === false) || (isShelter(base) && fireLit(base) && base.fireFed === false);
  return noFire && cap.nFilters === 0;
}
// In the emergency (purifyDaily), with the day's drinking not covered by purified water: the armory's purification
// tablets treat what is still to be drunk, one per TABS_WATER. A log line when it starts and when the last tablet is
// gone. Returns the water treated.
function emergencyTabs(state, base, cap) {
  const st = base.stock;
  const short = Math.max(0, cap.drink - Math.max(0, st.water || 0));
  const raw = Math.max(0, st[RAW] || 0);
  if (!tabsEmergency(state, base, cap) || !(short > 0) || !(raw > 0)) { base.tabsEmergency = false; return 0; }
  const stacks = tabStacks([], [base.armory]);
  if (!stacks.length) { base.tabsEmergency = false; return 0; }
  const used = useTabs(stacks, Math.ceil(Math.min(short, raw) / WORM.TABS_WATER - 1e-9));
  const q = r2(Math.min(raw, used * WORM.TABS_WATER));
  st[RAW] = r2(raw - q);
  st.water = r2(Math.max(0, st.water || 0) + q);
  const left = tabCount(tabStacks([], [base.armory]));
  if (!base.tabsEmergency || !left) log(state, `Out of firewood at ${base.name}: purification tablets used for the water (${left ? `${left} left` : "the last of them"}).`, "danger");
  base.tabsEmergency = left > 0;
  return q;
}
// Water purified a day at this base and where it comes from, for the base card: { total, text ("boiler 22, 2 filters
// 20"), cap }.
export function purifyText(state, base) {
  const cap = purifyCap(state, base);
  const tabs = base.purified && base.purified.day === day(state) && base.purified.tabs > 0 ? base.purified.tabs : 0;
  const bits = [cap.boiler > 0 ? `boiler ${Math.round(cap.boiler)}` : "", cap.fire > 0 ? `fire ${Math.round(cap.fire)}` : "", cap.kitchen > 0 ? `kitchen ${Math.round(cap.kitchen)}` : "", cap.filters > 0 ? `${cap.nFilters === 1 ? "filter" : `${cap.nFilters} filters`} ${cap.filters}` : "", tabs > 0 ? `tablets ${Math.round(tabs)} (out of firewood)` : ""].filter(Boolean);
  return { total: cap.total, text: bits.join(", "), cap };
}

// ---------- meat ----------
// Food with the worm's eggs is a lot of its own (foods.js: egg lots of raw meat and fish, crops, forage), kept apart
// from the clean food of the same item: eaten last and raw; cooking (the Kitchen's meals, storage.js cookDaily; a
// team's camp fire), smoking and drying kill the eggs.
// A base cooks what it eats: a cook fire, a preserving room, the Kitchen while its stove is lit (kitchen.js: cook or no
// cook; a cold stove, out of firewood, cooks nothing), or a shelter with its fire lit.
export const baseCooks = (base) => count(base, "cookhouse") > 0 || count(base, "kitchen") > 0 || (count(base, "canteen") > 0 && !kitchenCold(base)) || (isShelter(base) && fireLit(base));
export const wormMeatAt = (base) => eggFood(base).meat;
export const wormMeatIn = (cargo) => (cargo ? eggFood(cargo).meat : 0);
// Crops and forage with eggs in the base's food (grown or gathered on land at CROP_MIN+ infection): { crop, forage, all }.
export function wormVegAt(base) {
  const e = eggFood(base);
  return { crop: e.crop, forage: e.forage, all: e.crop + e.forage };
}
export const wormForageIn = (cargo) => (cargo ? eggFood(cargo).forage : 0);
// Makes up to `units` days of egg lots in a holder safe (a camp fire cooks them; `only` which items). Returns days.
export function cookEggs(h, units, only = null) {
  const L = h && h.foodLots;
  let left = units;
  if (!L) return 0;
  for (const k of Object.keys(L)) {
    if (only && !only(k, FOODS[k])) continue;
    for (const l of L[k]) {
      if (!l.egg || left <= 1e-9) continue;
      const u = unitsOf(k, l.q);
      if (u <= left) { delete l.egg; left -= u; }
      else { const q = qtyOf(k, left); l.q -= q; L[k].push({ q, left: l.left }); left = 0; }
    }
  }
  return units - left;
}
// Land infected enough for what grows or is gathered on it to carry the eggs (farming.js, foraging.js).
export const cropLandBad = (state, tile) => !!state.tiles[tile] && (state.tiles[tile].infection || 0) >= WORM.CROP_MIN;
// Does food grown or gathered on `tile` carry the eggs (farming.js, foraging.js: add it as an egg lot)?
export const cropEggs = (state, tile) => cropLandBad(state, tile);
// A kill on a tile (hunting.js): { rations, worm (rations with eggs), infested }. Rolls only where there are infested
// animals, so clean land hunts exactly as before.
export function wormKill(state, tile, rations, { fish = false } = {}) {
  const t = state.tiles[tile];
  if (!fish) {
    const share = infestedShare(state, tile);
    if (share > 0 && wormRng(state).chance(share)) {
      const herd = herdAt(state, tile);
      if (herd) {
        herd.size -= 1;
        stats(state).herdKills++;
        if (herd.size <= 0) {
          state.herds.splice(state.herds.indexOf(herd), 1);
          log(state, `The infested herd near ${tileLabel(state, tile)} is gone: the last of them was killed.`, "good");
        }
      }
      const r = rations * HERD.YIELD;
      return { rations: r, worm: r, infested: true };
    }
  }
  return { rations, worm: t && (t.infection || 0) >= WORM.MEAT_AT ? rations : 0, infested: false };
}
// Eaten raw: `rate` (RAW for meat, CROP for crops, FORAGE for forage) per ration with eggs, spread over the people
// who ate. how/why for the record.
export function eatRaw(state, people, rations, why, rate = WORM.RAW, how = "meat") {
  if (!(rations > 0) || !people.length) return 0;
  const per = 1 - Math.pow(1 - rate, rations / people.length);
  const sick = 1 - Math.pow(1 - Math.min(WORM.SICK_MAX, rate * WORM.SICK_X), rations / people.length);
  let n = 0;
  for (const s of people) {
    if (wormRng(state).chance(per) && catchWorm(state, s, why, how)) n++;
    sickRoll(state, s, sick, why, "poisoning"); // wave 2 cooking: uncooked food is food poisoning now (health.js), not an upset stomach
  }
  return n;
}
// An upset stomach (health.js stomach: mood only, it passes) from un-purified water, or food poisoning (key "poisoning":
// wave 2 cooking, uncooked food), `chance` this roll (at most SICK_MAX). Someone who already has it is not rolled again.
// Returns true when it started.
export function sickRoll(state, s, chance, why = "", key = "stomach") {
  if (!s || !s.alive) return false;
  if ((s.conditions || []).some((c) => c.key === key)) return false;
  chance *= stomachMult(s); // Iron Stomach, Weak Stomach by tier (traits.js): the same one roll
  if (!(chance > 0) || !wormRng(state).chance(Math.min(WORM.SICK_MAX, chance))) return false;
  return !!addCondition(state, s, key, why, { cause: key === "poisoning" || !/water/.test(why) ? "food" : "water" });
}

// ---------- teams ----------
// A team carries purified and un-purified water (water.js) in its supplies and cargo; p.wormEggs is the eggs of the
// un-purified water it carries (mixed from where it was filled). It drinks purified water first (needs.js takeWater);
// the un-purified water it drinks is safe through a water filter carried, at a lit camp fire (boiled), or with
// purification tablets (one per TABS_WATER, dropped in on the road); otherwise it is drunk as it is (drinkHour).
const hasFilter = (state, p) => teamKit(state, p).some(isFilter);
const hasStove = (state, p) => teamKit(state, p).some((it) => it && it.key === "stove");
// Un-purified water coming into the team's stores: `units` (already added) at `eggs` (0..1), mixed with what it
// carried before.
export function addWormWater(state, p, units, eggs) {
  if (!(units > 0)) return;
  const have = Math.max(0, teamRawIn(p) - units);
  const total = have + units;
  p.wormEggs = total > 0 ? r2(((p.wormEggs || 0) * have + Math.max(0, eggs || 0) * units) / total) : 0;
}
// Packing at a base (parties.js launchExpedition): the un-purified water packed carries the eggs of the base's.
export function packWater(state, p, base) {
  delete p.wormWater; // the old single-water model (save.js)
  p.wormEggs = teamRawIn(p) > 0 ? r2(rawWaterEggs(state, base).eggs) : 0;
}
// A camp fire that boils the water: lit, and with something to keep it going this hour (deadfall on the land, or
// firewood carried: woodcutting.js campFireHour; a camp's or shelter's fire burns what lies about it). A camp whose fire
// is out or has nothing left to burn does not boil: the team uses its tablets.
export function campFireFed(state, p) {
  if (teamFire(state, p) !== true) return false;
  const camp = p.owner === "player" ? state.bases.find((b) => b.tier === 0 && b.tile === partyTile(p)) : null;
  if (camp) return true; // a camp's or shelter's fire burns what lies about it
  return fireLandOk(state, partyTile(p)) || carried(p, "wood") >= WOOD.fire.camp / 24 - 1e-9;
}
// How a team drinks its un-purified water now: "filter" (a water filter carried), "fire" (a lit, fed camp fire boils
// it), "tabs" (purification tablets carried: on the move, or at a camp whose fire is out or unfed), "unsafe" (drunk as
// it is), or "" (none carried). For the team panel.
export function teamWaterHow(state, p) {
  if (!(teamRawIn(p) > 0)) return "";
  if (hasFilter(state, p)) return "filter";
  if (campFireFed(state, p)) return "fire";
  if ((p.tabWater || 0) > 0 || teamTabCount(state, p) > 0) return "tabs";
  return "unsafe";
}
// An hour's drinking (needs.js teamNeedsHour): `drank` in all, `raw` of it un-purified. In order: a water filter
// carried makes the un-purified water safe; else a lit camp fire that is fed boils it; else purification tablets
// carried are dropped in (one per TABS_WATER water: on the move, or at a camp whose fire is out or has nothing to
// burn); else it is drunk as it is: (RAW_BASE + WATER × its eggs) × the share of the hour's drinking, a day (and an
// upset stomach, SICK_X of that).
export function drinkHour(state, p, members, drank, raw = 0) {
  const e = p.wormEggs || 0;
  if (!(teamRawIn(p) > 0)) p.wormEggs = 0; // the last of it was drunk
  if (!(raw > 0) || !(drank > 0)) return; // none drunk
  if (hasFilter(state, p)) return;
  if (campFireFed(state, p)) return; // boiled at the camp fire: no tablet spent while the fire is lit and fed
  // Purification tablets carried: one per TABS_WATER of the un-purified water drunk makes it safe; only what they do
  // not cover is rolled.
  const { raw: left, used } = treatWater(p, teamTabs(state, p), raw);
  if (used > 0) { const n = teamTabCount(state, p); log(state, `${teamName(state, p)} dropped ${used === 1 ? "a purification tablet" : `${used} purification tablets`} into the un-purified water (${n ? `${n} left` : "the last of them"}).`, "info"); }
  const chance = waterRisk(e, left / drank) / 24;
  if (!(chance > 0)) return;
  for (const s of members) {
    if (wormRng(state).chance(chance)) catchWorm(state, s, `drinking un-purified water on the road`, "water");
    sickRoll(state, s, chance * WORM.SICK_X, "from un-purified water on the road");
  }
}
// Boils up to `q` of the team's un-purified water into purified water (a camp fire): the packed supplies first, then
// the cargo, each kind staying where it was. Returns the water boiled.
function boilTeamWater(p, q) {
  let left = q;
  for (const o of [p.supplies, p.cargo && p.cargo.supplies]) {
    if (!o || !(left > 0)) continue;
    const b = Math.min(left, Math.max(0, o[RAW] || 0));
    if (!(b > 0)) continue;
    o[RAW] -= b;
    o.water = Math.max(0, o.water || 0) + b;
    left -= b;
  }
  return q - left;
}
// An hour's eating raw (needs.js teamNeedsHour): meat with eggs from the team's food, when nothing else is left.
// Returns days of food eaten.
const isMeat = (k, f) => eggKind(f) === "meat";
export function eatRawCargo(state, p, members, need) {
  const got = takeFood([p, p.cargo].filter(Boolean), need, { clean: false, only: isMeat, state });
  if (!(got.units > 0)) return 0;
  eatRaw(state, members, got.units, "eating half-raw game on the road");
  return got.units;
}
// Crops and forage with eggs from the team's food, eaten uncooked when the clean food is gone (before the raw meat).
export function eatRawForageCargo(state, p, members, need) {
  const got = takeFood([p, p.cargo].filter(Boolean), need, { clean: false, only: (k, f) => !isMeat(k, f), state });
  if (!(got.units > 0)) return 0;
  eatRaw(state, members, got.units, "eating greens and roots gathered on infected ground", WORM.FORAGE, "forage");
  return got.units;
}
// Hourly for a team (parties.js playerPartyHour): a camp fire boils un-purified water and cooks meat and forage; camping on badly
// infected land is a risk in itself; and when the day turns, the hands that searched yesterday are rolled.
export function wormTeamHour(state, p, members) {
  const fire = teamFire(state, p);
  if (p.wormHands && p.wormHands.day !== day(state)) rollHands(state, p, members, fire === true, `searching ${p.wormHands.where}`);
  if (fire == null) return;
  if (fire) {
    if (teamRawIn(p) > 0 && campFireFed(state, p)) { boilTeamWater(p, WORM.BOIL * (hasStove(state, p) ? WORM.STOVE : 1)); if (!(teamRawIn(p) > 0)) p.wormEggs = 0; } // un-purified water boiled into purified water
    const m = cookEggs(p.cargo, WORM.COOK, isMeat) + cookEggs(p, WORM.COOK, isMeat); // the camp fire cooks the meat with eggs through
    cookEggs(p.cargo, WORM.COOK, (k, f) => !isMeat(k, f)); cookEggs(p, WORM.COOK, (k, f) => !isMeat(k, f)); // and boils the greens
    void m;
    if (fire === true && campFireFed(state, p)) teamCookHour(state, p, members); // cooking.js: the camp fire's pot (raw meat into simple meals)
  }
  const inf = (state.tiles[partyTile(p)] || {}).infection || 0;
  if (inf < WORM.CAMP_AT) return;
  const chance = (WORM.CAMP * inf * (fire ? WORM.CAMP_FIRE : 1)) / 24;
  for (const s of members) if (wormRng(state).chance(chance)) catchWorm(state, s, `camping on infested ground near ${tileLabel(state, partyTile(p))}`, "camp");
}

// ---------- hands that handled the dead ----------
// An hour's chance for one searcher on this tile.
export const searchChance = (state, tile) => WORM.SEARCH * eggsAt(state, tile);
// `hours` of searching a site (scavenge.js searchHour and the raid, citycrawl.js): the exposure goes on the team's
// hands for the day, rolled when the day turns (wormTeamHour) or the team gets home (wormHome).
export function wormSearch(state, p, tile, hours = 1) {
  const c = searchChance(state, tile);
  if (!p || !(c > 0) || !(hours > 0)) return;
  const h = p.wormHands && p.wormHands.day === day(state) ? p.wormHands : (p.wormHands = { day: day(state), chance: 0, where: tileLabel(state, tile) });
  h.chance = 1 - (1 - h.chance) * Math.pow(1 - c, hours);
  h.where = tileLabel(state, tile);
}
// The roll: washed (a fire that night, safe water at home) SEARCH_WASH of the time, otherwise each searcher rolls.
function rollHands(state, p, members, washed, why) {
  const h = p.wormHands;
  p.wormHands = null;
  if (!h || !(h.chance > 0)) return 0;
  if (washed && wormRng(state).chance(WORM.SEARCH_WASH)) return 0;
  let n = 0;
  for (const s of members) if (wormRng(state).chance(h.chance) && catchWorm(state, s, why, "search")) n++;
  return n;
}
// The team is home (parties.js returnHome): the day's hands are rolled now, washed if the base's water is safe.
export function wormHome(state, p, members, base) {
  if (!p.wormHands) return 0;
  return rollHands(state, p, members, !!base && baseWater(state, base).safe, `searching ${p.wormHands.where}`);
}
// The planner's and the tile panel's warning for badly infected sites: "" below SEARCH_WARN eggs.
export function searchRiskText(state, tile, hours = 6) {
  const eggs = eggsAt(state, tile);
  if (eggs < WORM.SEARCH_WARN) return "";
  const pct = Math.round((1 - Math.pow(1 - searchChance(state, tile), hours)) * 1000) / 10;
  return `infected ground: the worm, ${pct}% a day a person searching (hands that handled the dead; washing helps: camp with the fire lit, or come home to safe water)`;
}

// ---------- items ----------
// Takes one item of `key` from a list of holders' pockets, packs, the given lists. Returns it or null.
function takeFrom(people, lists, key) {
  for (const s of people) {
    for (const where of [s.pockets || [], packOf(s) || []]) { // packOf: the pack's slots (not an item with .contents)
      const i = where.findIndex((it) => it && it.key === key);
      if (i >= 0) return takeOneAt(where, i, true); // one off a stack, else the slot emptied
    }
  }
  for (const list of lists) {
    const i = list.findIndex((it) => it && it.key === key);
    if (i >= 0) return takeOneAt(list, i);
  }
  return null;
}
const findIn = (people, lists, key) => people.some((s) => [...(s.pockets || []), ...(packOf(s) || [])].some((it) => it && it.key === key)) || lists.some((l) => l.some((it) => it && it.key === key));

// ---------- purification tablets (data.js puritabs: tabs, dur = tablets left) ----------
// One tablet makes WORM.TABS_WATER water safe. They are for the road: a team drops them into the un-purified water it
// drinks when it carries no water filter and sits at no lit camp fire that can be kept going (drinkHour: a tablet is
// opened when the last one's water is used up, the rest kept as p.tabWater for the next drink). A base uses them only
// in the no-firewood emergency (emergencyTabs: its boiler cold with nothing to burn, no water filter); else
// tubes in the armory wait for a team to pack them (autopilot.js launchTrip, the planner). Tubes are found in people's pockets and packs, the team's cargo and the
// base armory; an emptied tube is gone.
const isTabs = (it) => !!(it && GEAR[it.key] && GEAR[it.key].tabs);
const tabsIn = (it) => (it.dur != null ? it.dur : GEAR[it.key].dur);
// Every tube with tablets left among these people's pockets and packs and in these lists: { list, i, item, slot }.
function tabStacks(people, lists) {
  const out = [];
  for (const s of people) for (const where of [s.pockets || [], packOf(s) || []]) where.forEach((it, i) => { if (isTabs(it) && tabsIn(it) > 0) out.push({ list: where, i, item: it, slot: true }); }); // packOf: the pack's slots
  for (const list of lists) list.forEach((it, i) => { if (isTabs(it) && tabsIn(it) > 0) out.push({ list, i, item: it, slot: false }); });
  return out;
}
const tabCount = (stacks) => stacks.reduce((a, x) => a + tabsIn(x.item), 0);
// Takes n tablets from these tubes (emptied tubes are removed: a pocket or pack slot goes empty, a list shrinks).
// Returns how many there were to take.
function useTabs(stacks, n) {
  let used = 0;
  for (const x of stacks) while (n > 0 && tabsIn(x.item) > 0) { x.item.dur = tabsIn(x.item) - 1; n--; used++; }
  const empty = stacks.filter((x) => tabsIn(x.item) <= 0);
  for (const x of empty) if (x.slot) x.list[x.i] = null;
  for (const x of empty.filter((x) => !x.slot).sort((a, b) => b.i - a.i)) x.list.splice(x.i, 1);
  return used;
}
export const teamTabs = (state, p) => tabStacks(partyMembers(state, p), [(p.cargo && p.cargo.gear) || []]);
export const teamTabCount = (state, p) => tabCount(teamTabs(state, p));
export const baseTabs = (state, base) => tabStacks(atBase(state, base.id), [base.armory]);
export const baseTabCount = (state, base) => tabCount(baseTabs(state, base));
// Tubes in a base's armory (what a team can pack).
export const armoryTabs = (base) => base.armory.filter((it) => isTabs(it) && tabsIn(it) > 0);
// A team leaving a base packs a tube of tablets from the armory into its cargo when it carries none (parties.js
// launchExpedition opts.tabs: the autopilot's water hauls and trips of more than TABS_TRIP_DAYS, the planner's
// checkbox). Returns the tube or null.
export const TABS_TRIP_DAYS = 2;
export function packTablets(state, base, p) {
  if (!base || !p || teamTabCount(state, p) > 0) return null;
  const tube = armoryTabs(base).sort((a, b) => tabsIn(a) - tabsIn(b))[0]; // the opened one first
  if (!tube) return null;
  base.armory.splice(base.armory.indexOf(tube), 1);
  (p.cargo = p.cargo || { supplies: {}, gear: [] }).gear.push(tube);
  return tube;
}
// Treats `units` of unsafe water a team (holder.tabWater) drinks: the rest of the last tablet
// first, then new tablets from `stacks`. Returns { raw (units nobody treated), used (tablets opened) }.
function treatWater(holder, stacks, units) {
  if (!(units > 0)) return { raw: 0, used: 0 };
  let cover = holder.tabWater || 0, used = 0;
  if (units > cover + 1e-9 && stacks.length) {
    used = useTabs(stacks, Math.ceil((units - cover) / WORM.TABS_WATER));
    cover += used * WORM.TABS_WATER;
  }
  if (!(cover > 0)) return { raw: units, used: 0 }; // no tablets: nothing changes
  const treated = Math.min(units, cover);
  holder.tabWater = r2(Math.max(0, cover - treated));
  holder.tabsUsed = (holder.tabsUsed || 0) + used;
  return { raw: Math.max(0, units - treated), used };
}
export const baseDewormers = (state, base) => countKey(base.armory, "dewormer") + atBase(state, base.id).reduce((a, s) => a + countKey([...(s.pockets || []), ...(packOf(s) || [])], "dewormer"), 0); // a stack counts what is in it
const teamHasDewormer = (state, p) => findIn(partyMembers(state, p), [(p.cargo && p.cargo.gear) || []], "dewormer");

// ---------- treatment at a base ----------
// What can be done for someone at this base now: { ok, reason, kind, cost, chance, treater, load }.
// kind: "dewormer" (gut stage, one in the armory or on someone here), "purge" (gut stage, meds and a medic) or
// "surgery" (brain stage, a Clinic or better).
export function wormTreatInfo(state, base, s, kind, ctx = null) {
  const away = !base || !residents(state, base.id).includes(s) ? `${s ? first(s) : "They"} ${s ? "is" : "are"} not at ${base ? base.name : "a base"}.` : "";
  return courseTreatInfo(state, base, wormOf(s), s ? first(s) : "they", away, kind, ctx);
}
// The checks on a course w (a resident's, a prisoner's, a guest's): name for the text, away: why they cannot be
// treated here ("" when they can).
function courseTreatInfo(state, base, w, name, away, kind, ctx = null) {
  const out = { ok: false, reason: "", kind, cost: 0, chance: 0, treater: null, load: 1 };
  if (!w || w.seen == null) { out.reason = `Nobody knows ${name} has the worm.`; return out; }
  if (away) { out.reason = away; return out; }
  if (w.treatedDay === day(state)) { out.reason = `Already treated today. Next ${nextDayText(state)}.`; return out; }
  if (kind === "dewormer") {
    if (w.stage !== "gut") { out.reason = "Too late for a dewormer: the worm is in the brain."; return out; }
    if (!baseDewormers(state, base)) { out.reason = `No dewormer at ${base.name}.`; return out; }
    out.ok = true;
    out.chance = 1;
    return out;
  }
  ctx = ctx || careCtx(state, base);
  const hosp = activeHospital(state, base);
  if (kind === "purge") {
    if (w.stage !== "gut") { out.reason = "Too late for a purge: the worm is in the brain. Only surgery in a Clinic can save them."; return out; }
    out.cost = WORM.PURGE_MEDS;
    out.treater = pickTreater(ctx, 1);
    const med = out.treater ? skill(out.treater.s, "medicine") : 0;
    out.chance = Math.min(WORM.PURGE_MAX, WORM.PURGE + WORM.PURGE_MED * med + WORM.PURGE_TIER * (hosp.tier || 0));
  } else {
    if (w.stage !== "brain") { out.reason = "Surgery is for the brain stage. A purge or a dewormer clears it now."; return out; }
    if (!hosp.surgery) { out.reason = "Only surgery can save them now, and that needs a staffed Clinic or better."; return out; }
    out.cost = WORM.SURGERY_MEDS;
    out.load = WORM.SURGERY_LOAD;
    out.treater = pickTreater(ctx, WORM.SURGERY_LOAD);
    const med = out.treater ? skill(out.treater.s, "medicine") : 0;
    out.chance = Math.min(WORM.SURGERY_MAX, WORM.SURGERY + WORM.SURGERY_MED * med);
  }
  if (!out.treater) out.reason = noTimeReason(state, ctx);
  else if (ctx.meds < out.cost) out.reason = `Needs ${out.cost} meds (have ${Math.floor(ctx.meds)}).`;
  else if (ctx.auto && ctx.meds - out.cost < ctx.reserve) out.reason = `Would take the meds below the reserve of ${ctx.reserve}.`;
  out.ok = !out.reason;
  return out;
}
// Pays for a checked treatment (a dewormer from the armory or someone here; or the meds, the medic's time and the
// practice) and rolls it. Returns true when it worked (a dewormer always does).
function payTreat(state, base, info) {
  if (info.kind === "dewormer") { takeFrom(atBase(state, base.id), [base.armory], "dewormer"); return true; }
  base.stock.meds = Math.max(0, (base.stock.meds || 0) - info.cost);
  state.medsUsed = (state.medsUsed || 0) + info.cost;
  spendMedicTime(state, base, info.treater, info.load);
  gainXp(state, info.treater.s, "medicine", USE.illness);
  return wormRng(state).chance(info.chance);
}
// Applies a checked treatment. Returns the message.
export function applyWormTreat(state, base, s, info) {
  const w = s.worm;
  w.treatedDay = day(state);
  const ok = payTreat(state, base, info);
  if (info.kind !== "dewormer" && info.cost > 0) s.medsHour = state.hour; // medical.js medsToday: a day healed with meds slows it (medicatedDay)
  if (info.kind === "dewormer") {
    cureWorm(state, s);
    hurt(state, s, WORM.DEWORM_HP, base.tile, "of the worm", { raw: true });
    return `${s.name} took a dewormer at ${base.name} and passed the worm. Weak for a few days, but clean.`;
  }
  if (info.kind === "purge") {
    if (ok) {
      cureWorm(state, s);
      hurt(state, s, WORM.PURGE_HP, base.tile, "of the worm", { raw: true });
      return `${first(info.treater.s)} purged ${s.name}'s worm at ${base.name} (${info.cost} meds). It is out, and ${first(s)} is badly weakened.`;
    }
    hurt(state, s, WORM.PURGE_FAIL_HP, base.tile, "of the worm", { raw: true });
    return `The purge did not work: ${s.name}'s worm holds on (${info.cost} meds). Try again ${nextDayText(state)}.`;
  }
  if (ok) {
    cureWorm(state, s);
    s.health = Math.max(5, s.health - WORM.SURGERY_HP);
    return `${first(info.treater.s)} cut the worm's larvae out of ${s.name} at ${base.name} (${info.cost} meds). ${first(s)} lives, barely.`;
  }
  stats(state).killed++;
  s.worm = null;
  hurt(state, s, 999, base.tile, "on the operating table (the worm)");
  return `${s.name} died on the operating table at ${base.name}: the worm had gone too deep.`;
}
export function treatWorm(state, base, survivorId, kind) {
  const s = survivorById(state, Number(survivorId));
  const info = wormTreatInfo(state, base, s, kind);
  if (!info.ok) return info.reason;
  const msg = applyWormTreat(state, base, s, info);
  log(state, msg, /died/.test(msg) ? "death" : /did not work/.test(msg) ? "danger" : "good");
  return msg;
}
// ---------- prisoners and guests (the same cures; WORM.OTHERS) ----------
// Prisoners (your cells) and guests sheltering at a base with the worm, seen or not: [{ kind: "prisoner" | "guest",
// key (for the buttons: "p<id>", "g<visitor id>:<n>"), w (the course), name, short, p | v, g }].
// A guest's course is one entry of v.worm: { day, since, stage, seen, treatedDay }.
export function wormOthersAt(state, base) {
  const out = [];
  if (!base) return out;
  for (const p of prisonersAt(state, base.id)) if (p.s && p.s.worm) out.push({ kind: "prisoner", key: `p${p.id}`, w: migrateWorm(p.s.worm), name: `${p.name}, a prisoner`, short: first(p), p });
  for (const v of state.visitors || []) {
    if (v.phase !== "sheltered" || v.shelterBase !== base.id || !(v.worm && v.worm.length)) continue;
    v.worm.forEach((g, i) => {
      g.stage = stageFor(g.day || 0);
      out.push({ kind: "guest", key: `g${v.id}:${i}`, w: g, name: `one of the guests (${v.name})`, short: "the guest", v, g });
    });
  }
  return out;
}
// Known to you (spotted): the Medical tab, the Prisoners tab and the guests' card list these.
export const wormOthersSeen = (state, base) => wormOthersAt(state, base).filter((o) => o.w.seen != null);
const stillHere = (state, base, o) => (o.kind === "prisoner" ? prisonersAt(state, base.id).includes(o.p) && !!o.p.s.worm
  : (state.visitors || []).includes(o.v) && o.v.phase === "sheltered" && o.v.shelterBase === base.id && (o.v.worm || []).includes(o.g));
// What can be done for a prisoner or a guest (wormOthersAt): as for a resident (wormTreatInfo).
export function otherTreatInfo(state, base, o, kind, ctx = null) {
  const away = !o || !base || !stillHere(state, base, o) ? "They are no longer here." : "";
  return courseTreatInfo(state, base, o ? o.w : null, o ? o.short : "they", away, kind, ctx);
}
// Applies a checked treatment to a prisoner or a guest. A prisoner's opinion of you rises (OTHERS.OPINION, or
// OPINION_TRIED for a purge that failed) and their group remembers it when they go home (p.wormTreated: prisoners.js
// releasePrisoner, tradeBack); a guest's group's goodwill (OTHERS.GUEST, GUEST_TRIED for a failed but honest
// attempt). Returns the message.
export function applyOtherTreat(state, base, o, info) {
  const O = WORM.OTHERS;
  const w = o.w;
  w.treatedDay = day(state);
  const ok = payTreat(state, base, info);
  const by = info.treater ? first(info.treater.s) : "";
  const what = info.kind === "dewormer" ? "a dewormer" : info.kind === "purge" ? `a purge (${info.cost} meds)` : `surgery (${info.cost} meds)`;
  if (o.kind === "prisoner") {
    const p = o.p, s = p.s;
    if (info.kind === "surgery" && !ok) {
      stats(state).killed++;
      s.worm = null;
      dropPrisoner(state, p);
      return `${p.name}, a prisoner, died on the operating table at ${base.name}: the worm had gone too deep.`;
    }
    p.wormTreated = true;
    if (!ok) {
      s.health = Math.max(1, (s.health ?? 60) - WORM.PURGE_FAIL_HP);
      p.opinion = (p.opinion || 0) + O.OPINION_TRIED;
      return `The purge did not work: the worm holds on in ${p.name}, a prisoner at ${base.name} (${info.cost} meds). Try again ${nextDayText(state)}. They saw you try (opinion +${O.OPINION_TRIED}).`;
    }
    cureWorm(state, s);
    s.health = Math.max(info.kind === "surgery" ? 5 : 1, (s.health ?? 60) - (info.kind === "dewormer" ? WORM.DEWORM_HP : info.kind === "purge" ? WORM.PURGE_HP : WORM.SURGERY_HP));
    p.opinion = (p.opinion || 0) + O.OPINION;
    return `${by ? `${by} treated` : "You treated"} ${p.name}, a prisoner at ${base.name}, for the worm with ${what}: it is out. ${first(p)} will not forget it (opinion +${O.OPINION}${p.factionId != null ? `; their group, goodwill +${O.RETURN_GOODWILL} when they go home` : ""}).`;
  }
  const v = o.v;
  const group = v.name;
  if (info.kind === "surgery" && !ok) {
    stats(state).killed++;
    v.worm.splice(v.worm.indexOf(o.g), 1);
    v.size = Math.max(0, (v.size || 0) - 1);
    changeGoodwill(state, v, O.GUEST_TRIED, "you tried to save one of theirs from the worm");
    const msg = `One of the guests at ${base.name} (${group}) died on the operating table: the worm had gone too deep. The others saw you try (goodwill +${O.GUEST_TRIED}).`;
    if (v.size <= 0) leaveMap(state, v, "wiped");
    return msg;
  }
  if (!ok) {
    changeGoodwill(state, v, O.GUEST_TRIED, "you tried to rid one of theirs of the worm");
    return `The purge did not work: the worm holds on in one of the guests at ${base.name} (${group}; ${info.cost} meds). Try again ${nextDayText(state)}. They saw you try (goodwill +${O.GUEST_TRIED}).`;
  }
  v.worm.splice(v.worm.indexOf(o.g), 1);
  stats(state).cured++;
  changeGoodwill(state, v, O.GUEST, "you cured one of theirs of the worm");
  return `${by ? `${by} treated` : "You treated"} one of the guests at ${base.name} (${group}) for the worm with ${what}: it is out. Their group is grateful (goodwill +${O.GUEST}).`;
}
// By hand (the Medical tab, the Prisoners tab, the guests' card): key from wormOthersAt. Logs and returns the message.
export function treatOtherWorm(state, base, key, kind) {
  const o = wormOthersAt(state, base).find((x) => x.key === key) || null;
  const info = otherTreatInfo(state, base, o, kind);
  if (!info.ok) return info.reason;
  const msg = applyOtherTreat(state, base, o, info);
  log(state, msg, /died/.test(msg) ? "death" : /did not work/.test(msg) ? "danger" : "good");
  return msg;
}
// The base's setting "Treat prisoners and guests too" (base.wormCareOthers, off by default): the night's care treats
// their worm as well, after the residents'.
export const othersCareOn = (base) => !!(base && base.wormCareOthers);

// The night's automatic care (with the base's other care, medical.js autoCare): a dewormer first, else a purge in
// the gut stage, surgery in the brain stage. It may dip into the meds reserve: the worm kills for sure. The residents
// first; prisoners and guests only with the base's "Treat prisoners and guests too" on (othersCareOn).
function wormCare(state, base) {
  if (!autoCareOn(base)) return;
  const kinds = (w) => (w.stage === "gut" ? ["dewormer", "purge"] : ["surgery"]);
  for (const s of residents(state, base.id)) {
    const w = wormOf(s);
    if (!w || w.seen == null || w.locked) continue;
    for (const kind of kinds(w)) {
      const info = wormTreatInfo(state, base, s, kind, kind === "dewormer" ? null : careCtx(state, base));
      if (!info.ok) continue;
      const msg = applyWormTreat(state, base, s, info);
      log(state, `Night care at ${base.name}: ${msg}`, /died/.test(msg) ? "death" : /did not work/.test(msg) ? "danger" : "good");
      break;
    }
  }
  if (!othersCareOn(base)) return;
  for (const o of wormOthersAt(state, base)) {
    if (o.w.seen == null) continue;
    for (const kind of kinds(o.w)) {
      const info = otherTreatInfo(state, base, o, kind, kind === "dewormer" ? null : careCtx(state, base));
      if (!info.ok) continue;
      const msg = applyOtherTreat(state, base, o, info);
      log(state, `Night care at ${base.name}: ${msg}`, /died/.test(msg) ? "death" : /did not work/.test(msg) ? "danger" : "good");
      break;
    }
  }
}

// ---------- the daily tick (economy.js basesDaily, after the day's illness) ----------
// Catching (the bases' water and food, your people held by groups), then a day of everyone's course (yours, the
// prisoners', the guests'), then the night's care.
export function wormDaily(state) {
  for (const base of state.bases) baseWormDaily(state, base);
  captivesWormDaily(state);
  for (const s of alive(state)) if (s.worm) stageDaily(state, s);
  for (const base of [...state.bases]) { prisonersWormDaily(state, base); guestsWormDaily(state, base); }
  for (const base of state.bases) wormCare(state, base);
  herdsDaily(state);
  groupsDaily(state);
}

// The share of their drinking the prisoners, the guests and a holding convoy's crew drink un-purified today: they drink
// after the residents (prisoners.js, visitors.js, supply.js), so from the purified water left now.
function othersRawShare(state, base) {
  const need = waterNeed(state, base);
  const want = need.prisoners + need.guests;
  if (!(want > 0)) return 0;
  const pure = Math.max(0, base.stock.water || 0), raw = Math.max(0, base.stock[RAW] || 0);
  const rawDrunk = Math.min(raw, Math.max(0, want - pure));
  return Math.max(0, Math.min(1, rawDrunk / want));
}
// Holding convoys' crews at a base (supply.js holdUpkeep: they eat and drink from its stores).
const crewsAt = (state, base) => state.parties.filter((p) => p.routeKind === "supply" && p.phase === "holding" && p.destBaseId === base.id).flatMap((p) => partyMembers(state, p));

function baseWormDaily(state, base) {
  const people = residents(state, base.id); // the boiler burned before drinking (purifyDaily)
  if (!people.length) { base.rawEaten = 0; base.rawCropEaten = 0; base.rawForageEaten = 0; return; }
  // Raw meat eaten today (storage.js eatFromStore: the meat with eggs, eaten last when nothing else was left).
  if (base.rawEaten > 0) {
    eatRaw(state, people, base.rawEaten, `eating game that was not cooked through at ${base.name}`);
    if (!base.rawWarned) log(state, `${base.name} ate game from infected land that was not cooked through. Build a cook fire: the worm's eggs die in the heat.`, "danger");
    base.rawWarned = true;
    base.rawEaten = 0;
  }
  // Crops and forage from infected ground eaten uncooked today (storage.js eatFromStore: after the clean food).
  if (base.rawCropEaten > 0 || base.rawForageEaten > 0) {
    eatRaw(state, people, base.rawCropEaten || 0, `eating crops grown on infected ground at ${base.name}`, WORM.CROP, "crop");
    eatRaw(state, people, base.rawForageEaten || 0, `eating greens and roots gathered on infected ground at ${base.name}`, WORM.FORAGE, "forage");
    if (!base.rawVegWarned) log(state, `${base.name} ate ${base.rawCropEaten > 0 ? "crops grown" : "food gathered"} on infected ground raw. Build a cook fire (or a kitchen): boiled, the worm's eggs die.`, "danger");
    base.rawVegWarned = true;
    base.rawCropEaten = 0;
    base.rawForageEaten = 0;
  }
  // Water: today's drinking (economy.js baseDaily: base.drank, purified first) and the share of it drunk un-purified:
  // RAW_BASE for any un-purified water, + WATER × the eggs of the un-purified water here.
  const d = base.drank && base.drank.day === day(state) ? base.drank : null;
  const share = d && d.pure + d.raw > 0 ? d.raw / (d.pure + d.raw) : 0;
  const eggs = rawWaterEggs(state, base).eggs;
  const risk = waterRisk(eggs, share);
  // Once per base: the first day its people drink un-purified water.
  if (risk > 0 && !base.wormWaterWarned) {
    base.wormWaterWarned = true;
    log(state, `${base.name} is drinking un-purified water${eggs > 0 ? " drawn from infected ground: it carries the worm's eggs" : ": even from clean ground it can carry the worm"}. Build a water boiler or keep water filters here (each purifies ${WORM.PURIFY_FILTER} a day); until then every day is a chance of catching it.`, "danger");
  }
  const why = `drinking un-purified water at ${base.name}`;
  if (risk > 0) for (const s of people) { if (wormRng(state).chance(risk)) catchWorm(state, s, why, "water"); sickRoll(state, s, risk * WORM.SICK_X, `from un-purified water at ${base.name}`); }
  // The prisoners, the guests and a holding convoy's crew: by the share of their drinking the purified water left
  // over does not cover.
  const other = waterRisk(eggs, othersRawShare(state, base));
  if (!(other > 0)) return;
  for (const p of prisonersAt(state, base.id)) if (p.s && !p.s.worm && wormRng(state).chance(other)) catchWorm(state, p.s, why, "water");
  for (const s of crewsAt(state, base)) { if (wormRng(state).chance(other)) catchWorm(state, s, why, "water"); sickRoll(state, s, other * WORM.SICK_X, `from un-purified water at ${base.name}`); }
  for (const v of state.visitors || []) {
    if (v.phase !== "sheltered" || v.shelterBase !== base.id) continue;
    const list = v.worm || (v.worm = []);
    for (let i = list.length; i < (v.size || 0); i++) if (wormRng(state).chance(other)) { list.push({ day: 0, since: day(state), stage: "gut", seen: null, treatedDay: -99 }); stats(state).caught++; stats(state).water++; }
  }
}

// Your people held by a group drink its water (conflicts.js captives): RISE.CAPTIVE of a base's chance there.
function captivesWormDaily(state) {
  for (const s of alive(state)) {
    if (!s.location || s.location.kind !== "captive" || s.worm) continue;
    const f = factionById(state, s.location.factionId);
    if (!f) continue;
    const tile = s.location.tile;
    const eggs = sourceEggs(state, tile) * (f.wormBoilers && f.wormBoilers[tile] ? WORM.GROUPS.BOILER : 1);
    const c = waterRisk(eggs, 1) * WORM.RISE.CAPTIVE;
    if (wormRng(state).chance(c)) catchWorm(state, s, `drinking ${f.name}'s water as their prisoner`, "water");
    sickRoll(state, s, c * WORM.SICK_X, `from ${f.name}'s water`);
  }
}

// Where someone is, for the course: { base } (at a base, an escort at the hub, a convoy crew holding at one: its
// stores feed them), { party }, { captive: faction, tile }, { errand: base, tile }.
function where(state, s) {
  const L = s.location || {};
  if (L.kind === "base" || L.kind === "post") return { base: baseById(state, L.baseId) }; // post: a lookout at a field work, fed from the base (fieldworks.js)
  if (L.kind === "route") return { base: state.bases.find((b) => b.type === "hub") || null };
  if (L.kind === "party") {
    const p = state.parties.find((x) => x.id === L.partyId) || null;
    if (p && p.routeKind === "supply" && p.phase === "holding" && baseById(state, p.destBaseId)) return { base: baseById(state, p.destBaseId), party: p, holding: true };
    return { party: p };
  }
  if (L.kind === "captive") return { captive: factionById(state, L.factionId), tile: L.tile };
  if (L.kind === "errand") { const b = baseById(state, L.baseId) || hub(state); return { errand: b, tile: b ? errandTile(state, b, s) : null }; }
  return {};
}
// Somewhere out on a personal errand: a land tile two or three from the base (by the person, so it stays put).
function errandTile(state, base, s) {
  const near = state.grid.within(base.tile, 3).filter((id) => { const t = state.tiles[id]; const d = state.grid.distance(id, base.tile); return d >= 2 && t && t.terrain !== "water" && !state.bases.some((b) => b.tile === id); });
  return near.length ? near[(localId(state, s.id) * 7919) % near.length] : null; // localId: ids are process-wide
}
function tileOf(state, s, at = where(state, s)) {
  if (at.base) return at.base.tile;
  if (at.party) return at.party.path ? partyTile(at.party) : null;
  return at.tile ?? null;
}

// A day of the course: the day's damage (less what a battle took of it already, w.paid) and mood, the extra food in
// the gut stage, spotting, and the brain stage's card. The damage that kills them gets them up again (world.js
// killSurvivor → carriers.js riseOnMap → wormRise).
function stageDaily(state, s) {
  const w = migrateWorm(s.worm);
  if (w.day === 0 && w.since === day(state)) return; // caught today: it shows tomorrow
  const at = where(state, s);
  const was = w.stage;
  wormDose(state, s, w, { base: at.base, party: at.base ? null : at.party }); // the day's meds, where they are
  const c = advanceCourse(state, s, w); // meds slow it and soften the day (medicatedDay)
  const dmg = Math.max(0, c.hp - (w.paid || 0));
  w.paid = 0;
  // Eats like two in the gut stage: the extra food comes out of the base's stores or the team's packs.
  if (w.stage === "gut") {
    if (at.base) eatFromStore(at.base, WORM.GUT_EAT, state);
    else if (at.party) takeFood([at.party, at.party.cargo].filter(Boolean), WORM.GUT_EAT, { eggs: false, state });
  }
  if (was === "gut" && w.stage === "brain" && w.seen != null) log(state, `${s.name}'s worm has reached the brain: fits and staggering. Only surgery in a Clinic can save them now.`, "danger");
  hurt(state, s, dmg, tileOf(state, s, at), "of the worm", { raw: true });
  if (!s.alive) return;
  addMood(state, s, -dayMood(w.day), "Infected: the worm");
  if (w.stage === "gut") {
    if (w.seen == null) spot(state, s, at);
    return;
  }
  // The brain stage gives itself away.
  if (w.carded !== "brain" && (w.seen != null || wormRng(state).chance(WORM.BRAIN_SPOT))) {
    if (w.seen == null) { w.seen = day(state); stats(state).spotted++; }
    w.carded = "brain";
    if (at.base && !at.holding) baseBrainCard(state, s, at.base);
    else if (at.party) teamCard(state, at.party, s);
  }
}

// A day's chance a base spots it in someone there (a resident, a prisoner, a guest): SPOT + SPOT_MED × the best
// Medicine there, × SPOT_MEDIC with someone on the Medic role.
function baseSpotChance(state, base) {
  const here = atBase(state, base.id);
  const med = Math.max(0, ...here.map((x) => skill(x, "medicine")));
  return (WORM.SPOT + WORM.SPOT_MED * med) * (here.some((x) => x.role === "medic") ? WORM.SPOT_MEDIC : 1);
}
// Spotting it: a base's medic, or a team on the road (from TEAM_FROM). The damage shows from day 1.
function spot(state, s, at) {
  const w = s.worm;
  let chance = 0;
  if (at.base && !at.holding) {
    chance = baseSpotChance(state, at.base);
  } else if (at.party && w.day >= WORM.TEAM_FROM) {
    chance = WORM.TEAM_SPOT + WORM.TEAM_SPOT_MED * bestSkill(state, at.party, "medicine");
  }
  if (!(chance > 0) || !wormRng(state).chance(chance)) return;
  w.seen = day(state);
  stats(state).spotted++;
  if (at.base && !at.holding) {
    const medic = atBase(state, at.base.id).filter((x) => x !== s).sort((a, b) => skill(b, "medicine") - skill(a, "medicine"))[0];
    log(state, `${medic ? `${first(medic)} found` : "Someone found"} pale segments in ${s.name}'s stool at ${at.base.name}: it is the worm (${w.why}), day ${w.day} of about ${WORM.COURSE}. A purge or a dewormer clears it now; once it reaches the brain only surgery will. See the Medical tab.`, "danger");
  } else if (at.party) {
    w.carded = "gut";
    teamCard(state, at.party, s);
  }
}

// ---------- the prisoners' and the guests' course ----------
// Spotting it in a prisoner or a guest (w: their course): as for a resident (baseSpotChance; the brain stage gives
// itself away, BRAIN_SPOT). who: "Tom Reyes, a prisoner" / "one of the guests (…)". Logs it once.
function spotOther(state, base, w, who) {
  if (w.seen != null) return;
  const chance = w.stage === "brain" ? WORM.BRAIN_SPOT : baseSpotChance(state, base);
  if (!(chance > 0) || !wormRng(state).chance(chance)) return;
  w.seen = day(state);
  stats(state).spotted++;
  log(state, `${who[0].toUpperCase()}${who.slice(1)} at ${base.name} has the worm: cramps, fever, eating like two; day ${w.day} of about ${WORM.COURSE}. ${w.stage === "gut" ? "A dewormer or a purge clears it now" : "Only surgery in a Clinic can save them now"}; left alone it kills them and they get up again. You can treat them (the Medical tab${/prisoner/.test(who) ? ", the Prisoners tab" : ", the guests' card in the Groups tab"}).`, "danger");
}
// A prisoner with the worm (caught from the base's water): the same days, health and mood (on the prisoner's record);
// spotted like a resident, treated by hand (the Medical and Prisoners tabs) or by the night's care with the base's
// "Treat prisoners and guests too" on. Dead, they get up in the cells: locked away (idle in a cell) nobody is hurt.
function prisonersWormDaily(state, base) {
  for (const p of [...prisonersAt(state, base.id)]) {
    const s = p.s;
    if (!s || !s.worm) continue;
    const w = migrateWorm(s.worm);
    if (w.day === 0 && w.since === day(state)) continue;
    if (othersCareOn(base)) wormDose(state, s, w, { base }); // the day's meds, with the base's care for prisoners on
    const c = advanceCourse(state, s, w); // meds slow it
    s.health = Math.max(0, (s.health ?? 60) - c.hp);
    s.mood = Math.max(0, (s.mood ?? 30) - dayMood(w.day));
    if (s.health > 0) { spotOther(state, base, w, `${p.name}, a prisoner`); continue; }
    const locked = inCell(state, p) && taskOf(p) === "idle";
    dropPrisoner(state, p);
    stats(state).turned++;
    riseAtBase(state, base, `${p.name}, a prisoner`, { locked, short: first(p), lockedText: "in the cells", of: true });
  }
}
// Guests sheltering at a base (visitors.js): v.worm, one entry a sick guest ({ day, since, stage, seen, treatedDay }).
// Spotted like a resident and treated by hand (the Medical tab, the guests' card) or by the night's care with the
// base's "Treat prisoners and guests too" on; untreated they die on day COURSE and get up among your people; the
// group is one fewer.
function guestsWormDaily(state, base) {
  for (const v of [...(state.visitors || [])]) {
    if (v.phase !== "sheltered" || v.shelterBase !== base.id || !(v.worm && v.worm.length)) continue;
    for (const g of [...v.worm]) {
      if (g.day === 0 && g.since === day(state)) continue;
      g.day += 1;
      g.stage = stageFor(g.day);
      if (g.day < WORM.COURSE) { spotOther(state, base, g, `one of the guests (${v.name})`); continue; }
      v.worm.splice(v.worm.indexOf(g), 1);
      v.size = Math.max(0, (v.size || 0) - 1);
      stats(state).turned++;
      riseAtBase(state, base, `One of the guests (${v.name})`, { short: "the guest", of: true });
      if (v.size <= 0) { leaveMap(state, v, "wiped"); break; }
    }
  }
}

// ---------- death and rising (carriers.js riseOnMap, for anyone who dies with the worm outside a battle) ----------
// Returns true when handled here (the worm is cleared: they rise once); false to let carriers.js handle it (alone on
// the road they walk off with their things).
export function wormRise(state, s, tileId) {
  if (!hasWorm(s)) return false;
  const L = s.location || {};
  const locked = !!(s.worm && s.worm.locked);
  const done = () => { clearWorm(s); stats(state).turned++; return true; };
  if (L.kind === "base" || L.kind === "route" || L.kind === "post") {
    const base = L.kind === "route" ? hub(state) : baseById(state, L.baseId);
    if (!base) return false;
    done();
    riseAtBase(state, base, s.name, { locked, short: first(s) });
    return true;
  }
  if (L.kind === "party") {
    const p = state.parties.find((x) => x.id === L.partyId);
    if (!p) return false;
    if (p.routeKind === "supply" && p.phase === "holding" && baseById(state, p.destBaseId)) {
      done();
      riseAtBase(state, baseById(state, p.destBaseId), s.name, { short: first(s) });
      return true;
    }
    const mates = partyMembers(state, p).filter((x) => x !== s && x.alive);
    if (!mates.length) return false; // alone: they walk off with their things (carriers.js)
    done();
    if (p.crawl && crawlTurned(state, p, s)) return true;
    if (p.hiveCrawl && hiveCrawlTurned(state, p, s)) return true;
    const tile = tileId ?? partyTile(p);
    const f = groupAt(state, tile);
    if (f) { groupBaseRise(state, f, s, { visit: true, party: p, tile }); return true; }
    roadRise(state, p, s, tile, mates);
    return true;
  }
  if (L.kind === "captive") {
    done();
    groupBaseRise(state, factionById(state, L.factionId), s, { visit: false });
    return true;
  }
  if (L.kind === "errand") {
    done();
    log(state, `${s.name} died alone, far from home on a personal errand, with the worm in them, and got up again with nobody there to put them down. What they carried lies where they fell${tileId != null ? ` near ${tileLabel(state, tileId)}` : ""}.`, "death");
    return true;
  }
  return false;
}
const groupAt = (state, tile) => (tile == null ? null : state.factions.find((f) => f.alive && f.bases.includes(tile)) || null);

// At one of your bases: they get up and go for the nearest people (one hurt, a second TURN_SECOND of the time, each
// killed TURN_KILL of the time, half with a guard on duty), everyone there loses TURN_MOOD mood; locked away nobody is
// hurt (LOCKED_MOOD). The body is put down (its things went to the armory: world.js killSurvivor). name: who rose;
// short: what to call them after. Returns the people hurt.
export function riseAtBase(state, base, name, { locked = false, short = "", lockedText = "behind a locked door", of = false } = {}) {
  short = short || name.split(" ")[0];
  const died = of ? "died of the worm" : "died with the worm in them"; // of: a prisoner or a guest (no log of the death before this)
  const others = residents(state, base.id);
  for (const x of others) addMood(state, x, -(locked ? WORM.LOCKED_MOOD : WORM.TURN_MOOD), `${short} turned (the worm)`);
  if (locked) { log(state, `${name} ${died} ${lockedText} at ${base.name} and got up again. They were put down without anyone else hurt.`, "death"); return []; }
  const guard = atBase(state, base.id).some((x) => x.role === "guard");
  const pool = atBase(state, base.id);
  const victims = [];
  const n = Math.min(pool.length, 1 + (wormRng(state).chance(WORM.TURN_SECOND) ? 1 : 0));
  for (let i = 0; i < n; i++) victims.push(pool.splice(wormRng(state).int(0, pool.length - 1), 1)[0]);
  const hurtNames = [];
  for (const v of victims) {
    const kill = wormRng(state).chance(WORM.TURN_KILL * (guard ? 0.5 : 1));
    hurt(state, v, kill ? 999 : wormRng(state).int(WORM.TURN_HURT[0], WORM.TURN_HURT[1]), base.tile, `when ${short} turned (the worm)`);
    hurtNames.push(v.alive ? `${first(v)} was hurt` : `${v.name} was killed`);
  }
  log(state, `${name} ${died} at ${base.name} and got up again, the worm in their eyes. ${hurtNames.length ? `${hurtNames.join(" and ")} before ${guard ? "the guards" : "they"} put ${short} down.` : `They put ${short} down.`}`, "death");
  return victims;
}

// The team takes back what the risen carried from the death site on this tile (world.js killSurvivor put it there).
function reclaim(state, p, tile, s) {
  const site = state.deathSites.find((d) => d.tile === tile);
  if (!site) return [];
  const mine = site.items.filter((it) => it.kind === "gear" && it.item && it.name.startsWith(`${first(s)}'s `));
  if (!mine.length) return [];
  site.items = site.items.filter((it) => !mine.includes(it));
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  for (const it of mine) p.cargo.gear.push(it.item);
  return mine.map((it) => it.item.name);
}
// The chance someone is hurt putting one of the dead down, by the numbers: its power (the land's infection) against
// the team's (world.js combatPower).
export function putDownOdds(state, p, tile, mates = partyMembers(state, p)) {
  const R = WORM.RISE;
  const zp = 2 + 3 * ((state.tiles[tile] || {}).infection || 0);
  const team = mates.reduce((a, m) => a + combatPower(m), 0);
  return Math.max(R.HURT_MIN, Math.min(R.HURT_MAX, (0.6 * zp) / (zp + team)));
}
// On the road: the card "<name> rose" (put them down, leave them, or crush the skull if someone saw the last breath).
function roadRise(state, p, s, tile, mates) {
  const R = WORM.RISE;
  const name = first(s);
  for (const x of mates) addMood(state, x, -WORM.TURN_MOOD, `${name} turned (the worm)`);
  const sharp = (m) => Math.max(skill(m, "medicine"), skill(m, "scouting"));
  const watcher = mates.reduce((a, m) => (!a || sharp(m) > sharp(a) ? m : a), null);
  const noticed = !!watcher && wormRng(state).chance(Math.min(R.NOTICE_MAX, R.NOTICE + R.NOTICE_SKILL * sharp(watcher)));
  const hurtP = putDownOdds(state, p, tile, mates);
  const where = tileLabel(state, tile);
  const card = {
    title: `${s.name} rose`, where, partyId: p.id, survivorIds: [], wormRise: s.id,
    text: noticed
      ? `${s.name} died near ${where} with the worm in them. ${first(watcher)} saw the last breath go out of them and knows what comes next: there is a moment before they get up.`
      : `${s.name} died near ${where} with the worm in them, and before anyone could do anything they got up again, the worm in their eyes.`,
    choices: [],
  };
  const live = (fn) => (st) => (cardStale(st, card) ? "Too late: nothing to decide any more." : fn(st));
  if (noticed) card.choices.push({ label: "Crush the skull now", hint: "Before they get up: nobody is hurt, and their things are kept", ai: () => 10, resolve: live((st) => {
    const got = reclaim(st, p, tile, s);
    return `${first(watcher)} crushes ${name}'s skull before the worm can get them up.${got.length ? ` The team takes their things (${got.join(", ")}).` : ""}`;
  }) });
  card.choices.push({ label: "Put them down", hint: `The team against one of the dead: about ${Math.round(hurtP * 100)}% someone is hurt; their things are kept`, ai: () => 5 * (1 - hurtP) + 0.5, resolve: live((st) => {
    const team = partyMembers(st, p).filter((x) => x.alive);
    let line = "";
    if (team.length && wormRng(st).chance(hurtP)) {
      const v = wormRng(st).pick(team);
      hurt(st, v, wormRng(st).int(R.PUT_HURT[0], R.PUT_HURT[1]), tile, `putting ${name} down (the worm)`);
      line = v.alive ? ` ${first(v)} was hurt doing it.` : ` ${v.name} was killed doing it.`;
    }
    const got = reclaim(st, p, tile, s);
    wipeIfEmpty(st, p);
    return `The team puts ${name} down.${line}${got.length ? ` They take ${name}'s things (${got.join(", ")}).` : ""}`;
  }) });
  card.choices.push({ label: "Leave them", hint: "Nobody is hurt; the body and what they carried stay behind (a death site)", ai: () => (hurtP > 0.45 ? 6 : 0.5), resolve: live(() => `The team backs away and leaves ${name} to the road. What they carried lies at ${where}.`) });
  addCard(state, card);
  log(state, `${s.name} died near ${where} with the worm in them and ${noticed ? "is about to get up" : "got up again"}.`, "death");
}
// At another group's base (your person held prisoner there, or a team visiting): the group puts the body down. It may
// lose one of its own; a visit costs goodwill (you brought the sickness among them), a prisoner none. A log line when
// you would hear of it (the team there, or the group in radio reach).
function groupBaseRise(state, f, s, { visit = false, party = null, tile = null } = {}) {
  const R = WORM.RISE;
  if (!f || !f.alive) { log(state, `${s.name} died with the worm in them and got up again, far from home.`, "death"); return; }
  let lost = false;
  if (f.pop > WORM.GROUPS.MIN && wormRng(state).chance(R.HOST_LOSS)) { f.pop -= 1; f.wormLost = (f.wormLost || 0) + 1; lost = true; }
  if (visit) changeGoodwill(state, f, R.ENVOY_GOODWILL, `${first(s)} brought the worm among them`);
  const got = visit && party && tile != null ? reclaim(state, party, tile, s) : [];
  if (visit) log(state, `${s.name} died at ${f.name}'s base with the worm in them and got up again among them. ${f.name} put the body down${lost ? ", but one of theirs was killed doing it" : ""}. They blame you for bringing the sickness to their gates (goodwill ${R.ENVOY_GOODWILL}).${got.length ? ` The team takes back ${first(s)}'s things.` : ""}`, "death");
  else if (canRadioGroup(state, f)) log(state, `Word comes over the radio: ${s.name}, held by ${f.name}, died with the worm in them and got up again. They put the body down${lost ? "; one of their own was killed" : ""}.`, "death");
}

// ---------- cards ----------
// A team finds out (the gut stage after a week or so, or the brain stage giving itself away): the card "The worm".
function teamCard(state, p, s) {
  const w = s.worm;
  const brain = w.stage === "brain";
  const name = first(s);
  const purgeChance = () => Math.max(0.05, Math.min(0.95, (bestSkill(state, p, "medicine") + 1) / 10)); // events.js: a Medicine 10 check
  const card = {
    title: "The worm",
    where: tileLabel(state, partyTile(p)),
    partyId: p.id,
    survivorIds: [s.id],
    text: brain
      ? `${s.name} had a fit this morning and cannot walk straight. It is the worm, and it has reached the brain (${w.why}): day ${w.day} of about ${WORM.COURSE}. A purge cannot help now; only surgery in a Clinic, and that is far away. In a day or two it will kill them, and they will get up again.`
      : `${s.name} is doubled up with cramps and burning with fever, eating like two and weaker by the hour, and this morning they found pale segments in their stool. It is the worm: they swallowed its eggs ${w.why}. It is day ${w.day} of about ${WORM.COURSE}: it hurts more every day, from day ${WORM.BRAIN_FROM} it is in the brain, and then it kills them and they get up again. A dewormer clears it for sure; at a base, meds and a medic can purge it.`,
    choices: [],
  };
  const live = (fn) => (st) => (cardStale(st, card) || !s.worm ? "Too late: nothing to decide any more." : fn(st));
  if (!brain && teamHasDewormer(state, p)) card.choices.push({ label: "Give them the dewormer", hint: "A sure cure", resolve: live((st) => {
    if (!takeFrom(partyMembers(st, p), [(p.cargo && p.cargo.gear) || []], "dewormer")) return "The dewormer is gone. Nothing was done.";
    cureWorm(st, s);
    hurt(st, s, WORM.DEWORM_HP, partyTile(p), "of the worm", { raw: true });
    return `${name} takes the dewormer and passes the worm by evening. Weak, but clean.`;
  }) });
  card.choices.push({
    label: `Purge it (${WORM.PURGE_MEDS} meds)`,
    get hint() { return brain ? "Too late: the worm is in the brain" : `Medicine check, ${Math.round(purgeChance() * 100)}%`; },
    get disabled() { return brain || carried(p, "meds") < WORM.PURGE_MEDS; },
    resolve: live((st) => {
      if (carried(p, "meds") < WORM.PURGE_MEDS) return `The team no longer has ${WORM.PURGE_MEDS} meds to spare. Nothing was done.`;
      takeSupply(p, "meds", WORM.PURGE_MEDS);
      if (wormRng(st).chance(purgeChance())) {
        cureWorm(st, s);
        s.health = Math.max(10, s.health - WORM.ROAD_PURGE_HP);
        return `The purge works: ${name} passes the worm, badly weakened.`;
      }
      hurt(st, s, WORM.ROAD_FAIL_HP, partyTile(p), "of the worm", { raw: true });
      return `The purge does not work: the worm holds on, and ${name} is weaker for it. A base with a medic can try again.`;
    }),
  });
  card.choices.push({ label: "End it quickly", resolve: live((st) => {
    s.worm = null;
    hurt(st, s, 999, partyTile(p), "of the worm, by their own team");
    st.survivors.filter((x) => x.alive).forEach((x) => (x.mood = Math.max(0, x.mood - 8)));
    wipeIfEmpty(st, p);
    return `The team buries ${s.name} and burns the grave.`;
  }) });
  card.choices.push({
    label: "Hope it passes on its own",
    hint: brain ? `${Math.round(WORM.HOPE_BRAIN * 100)}%; otherwise they turn within days` : `${Math.round(WORM.HOPE * 100)}%; otherwise get them to a base with meds before it reaches the brain`,
    resolve: live((st) => {
      if (wormRng(st).chance(brain ? WORM.HOPE_BRAIN : WORM.HOPE)) { cureWorm(st, s); return `Against all odds, ${name} passes the worm whole.`; }
      return brain ? `They keep ${name} close and wait. It will not be long.` : `The worm stays. ${name} keeps going; a purge at a base can still clear it.`;
    }),
  });
  addCard(state, card);
}
// At a base, the brain stage shows: surgery if there is a Clinic, or lock them away until it is over.
function baseBrainCard(state, s, base) {
  const name = first(s);
  const info = () => wormTreatInfo(state, base, s, "surgery");
  const live = (fn) => (st) => (!s.alive || !s.worm || !residents(st, base.id).includes(s) ? "Too late: nothing to decide any more." : fn(st));
  addCard(state, {
    title: `The worm: ${s.name}`,
    survivorIds: [s.id],
    wormBase: base.id,
    text: `${s.name} had a fit at ${base.name} and cannot walk straight. It is the worm, and it has reached the brain (${s.worm.why}). In a day or two it will kill them, and they will get up again. Only surgery in a Clinic can save them.`,
    choices: [
      {
        label: `Try surgery (${WORM.SURGERY_MEDS} meds)`,
        get hint() { const i = info(); return i.ok ? `${Math.round(i.chance * 100)}% they live; otherwise they die on the table` : i.reason; },
        get disabled() { return !info().ok; },
        resolve: live((st) => { const i = info(); if (!i.ok) return i.reason; const msg = applyWormTreat(st, base, s, i); log(st, msg, /died/.test(msg) ? "death" : "good"); return msg; }),
      },
      { label: "Lock them away", hint: `Nobody is hurt when they turn; everyone loses ${WORM.LOCKED_MOOD} mood. ${Math.round(WORM.HOPE_BRAIN * 100)}% they pass it`, resolve: live((st) => {
        if (wormRng(st).chance(WORM.HOPE_BRAIN)) { cureWorm(st, s); return `Locked away, ${name} sweats through the fits and passes the worm. Nobody can quite believe it.`; }
        s.worm.locked = true;
        s.role = "rest";
        return `${name} is locked in a room at ${base.name}. The others take turns at the door.`;
      }) },
      { label: "End it quickly", hint: `Everyone loses ${WORM.TURN_MOOD} mood`, resolve: live((st) => {
        s.worm = null;
        hurt(st, s, 999, base.tile, "of the worm, by their own people");
        residents(st, base.id).forEach((x) => (x.mood = Math.max(0, x.mood - WORM.TURN_MOOD)));
        return `${s.name} is put to rest at ${base.name} before the worm can take them. The grave is burned.`;
      }) },
    ],
  });
}

// ---------- infested animals ----------
export const herdAt = (state, tile) => (state.herds || []).find((h) => h.tile === tile) || null;
// The share of a tile's game that carries the worm (herd: count a herd there; the map panel leaves out one you
// cannot see).
export function infestedShare(state, tile, { herd = true } = {}) {
  const t = state.tiles[tile];
  if (!t) return 0;
  let share = Math.max(0, Math.min(HERD.SHARE_MAX, ((t.infection || 0) - HERD.SHARE_AT) / HERD.SHARE_SPAN));
  if (herd && herdAt(state, tile)) share += HERD.HERD_SHARE;
  return Math.min(0.95, share);
}
// What a hunt here brings on average, as a share of clean land's (hunting.js estimates).
export const huntYieldMult = (state, tile) => 1 - infestedShare(state, tile) * (1 - HERD.YIELD);
const herdLand = (state, id) => { const t = state.tiles[id]; return !!t && (t.terrain !== "water" || t.bridge) && HERD_LAND[t.terrain] != null && !state.bases.some((b) => b.tile === id); };
export const herdCap = (state) => Math.max(1, Math.round((state.tiles.length / 1000) * HERD.PER_1000));

export function herdsDaily(state) {
  const list = state.herds || (state.herds = []);
  const rng = wormRng(state);
  const d = day(state);
  for (const h of [...list]) {
    if (d >= h.until) { list.splice(list.indexOf(h), 1); continue; }
    // Seed the land: the tile's own infection level creeps up (hives.js radiate moves the tile toward it).
    const t = state.tiles[h.tile];
    const base = t.infBase ?? t.infection;
    if (base < HERD.SEED_CAP) t.infBase = Math.min(HERD.SEED_CAP, base + HERD.SEED * h.size / 6);
    if (!rng.chance(HERD.MOVE)) continue;
    const next = state.grid.neighbors(h.tile).filter((id) => herdLand(state, id) && !herdAt(state, id));
    if (!next.length) continue;
    h.tile = rng.chance(HERD.DOWNHILL) ? next.reduce((a, b) => ((state.tiles[b].infection || 0) < (state.tiles[a].infection || 0) ? b : a)) : rng.pick(next);
  }
  if (list.length >= herdCap(state) || !rng.chance(HERD.SPAWN)) return;
  const land = state.tiles.filter((t) => (t.infection || 0) >= HERD.BORN_AT && !t.hive && herdLand(state, t.id) && (HERD_LAND[t.terrain] || 0) >= 1 && !herdAt(state, t.id));
  if (!land.length) return;
  const t = rng.pick(land);
  list.push({ tile: t.id, size: rng.int(HERD.SIZE[0], HERD.SIZE[1]), kind: rng.chance(t.terrain === "hills" || t.terrain === "mountain" ? 1 : 0.6) ? "deer" : "hog", born: d, until: d + rng.int(HERD.LIFE[0], HERD.LIFE[1]) });
  stats(state).herds++;
}

// ---------- the other groups ----------
// A group's chance a day of a loss at one of its bases, as a player base of that size would catch it: heads × eggs ×
// (WATER + CROP on land at CROP_MIN+) × UNCURED × the type's care of its water (× BOILER once it boils). { expect,
// eggs, mult, boils }.
export function groupWormRisk(state, f, tile) {
  const G = WORM.GROUPS;
  const eggs = sourceEggs(state, tile);
  const heads = Math.max(0, f.pop) / Math.max(1, f.bases.length);
  const rate = WORM.WATER + (cropLandBad(state, tile) ? WORM.CROP : 0);
  const boils = !!(f.wormBoilers && f.wormBoilers[tile]);
  const type = G.TYPE[f.type] ?? 1;
  const mult = boils ? Math.min(type, G.BOILER) : type;
  return { expect: heads * eggs * rate * G.UNCURED * mult, eggs, mult, boils };
}
// How many die today for an expected `e`: the whole part, and the rest as a chance.
const lossFor = (state, e) => Math.floor(e) + (wormRng(state).chance(e - Math.floor(e)) ? 1 : 0);
function groupLoses(state, f, n, where, how = "groups") {
  const G = WORM.GROUPS;
  n = Math.max(0, Math.min(n, f.pop - G.MIN));
  if (n <= 0) return 0;
  f.pop -= n;
  f.wormLost = (f.wormLost || 0) + n;
  const st = stats(state);
  st[how] = (st[how] || 0) + n;
  return n;
}
export function groupsDaily(state) {
  const G = WORM.GROUPS;
  for (const f of state.factions) {
    if (!f.alive || f.pop <= G.MIN) continue;
    for (const tile of f.bases) {
      const r = groupWormRisk(state, f, tile);
      if (!(r.expect > 0)) continue;
      const n = groupLoses(state, f, lossFor(state, r.expect), tile);
      if (!n) continue;
      // After its first loss the base boils its water (the news says so once).
      const first = !r.boils;
      if (first) (f.wormBoilers || (f.wormBoilers = {}))[tile] = true;
      const text = `${f.name} lost ${n === 1 ? "one of their people" : `${n} people`} to the worm at ${tileLabel(state, tile)}${first ? ": they boil their water now" : ""}.`;
      news(state, text, "info", [f]);
      chronicleNote(state, text, "world", tile);
    }
  }
  // Their parties on the move, and hardcore's bands: a herd's land or badly infected ground costs one now and then.
  const roadRisk = (tile) => {
    const t = state.tiles[tile];
    if (!t) return 0;
    const herd = herdAt(state, tile) ? G.HERD_EGGS : 0;
    const camp = (t.infection || 0) >= WORM.CAMP_AT ? eggsAt(state, tile) : 0;
    return G.ROAD * Math.max(herd, camp);
  };
  for (const p of state.parties) {
    if (typeof p.owner !== "number" || p.phase !== "out" || !p.path) continue;
    const f = factionById(state, p.owner);
    if (!f || !f.alive || f.pop <= G.MIN) continue;
    const r = roadRisk(partyTile(p));
    if (!(r > 0) || !wormRng(state).chance(r)) continue;
    if (groupLoses(state, f, 1, partyTile(p), "road")) p.strength = Math.max(1, (p.strength || 1) - 1);
  }
  for (const b of bandsOf(state)) {
    if (b.pop <= G.MIN + 3) continue; // never so few that the band breaks or cannot found its hub
    const r = roadRisk(b.tile);
    if (!(r > 0) || !wormRng(state).chance(r)) continue;
    b.pop -= 1;
    b.wormLost = (b.wormLost || 0) + 1;
    stats(state).road++;
    if (b.known && state.live.has(b.tile)) log(state, `${b.name} lost one of their people to the worm near ${tileLabel(state, b.tile)}.`, "danger");
  }
}

// ---------- text for the UI ----------
// "Infected (day 3 of about 7): −10 health today, −4 mood" (the Medical tab, the survivor screen, the chips).
export function wormLabel(s) {
  const w = wormOf(s);
  if (!w) return "";
  const d = Math.max(1, w.day);
  return `Infected (day ${w.day} of about ${WORM.COURSE}): −${dayHp(d)} health today, −${dayMood(d)} mood`;
}
// The cure open at this stage, in words.
export function wormCureText(s) {
  const w = wormOf(s);
  if (!w) return "";
  return w.stage === "gut"
    ? `Cure now: a dewormer (sure), or a purge (${WORM.PURGE_MEDS} meds and a medic). From day ${WORM.BRAIN_FROM} only surgery.`
    : `Cure now: only surgery in a staffed Clinic or better (${WORM.SURGERY_MEDS} meds).`;
}
export function wormTip(state, s) {
  const w = wormOf(s);
  if (!w) return "";
  const next = w.day + 1;
  const bits = [`The worm: caught ${w.why || "somewhere on infected land"}${w.seen != null ? `; found on day ${w.seen}` : ""}. Day ${w.day} of about ${WORM.COURSE}: tomorrow −${dayHp(next)} health and −${dayMood(next)} mood, and they heal at half the rate while it is in them, and a hospital bed does nothing for them. Each day a known carrier takes ${WORM.DOSE_MEDS} meds from the base or the team while there are any; a day with meds it does ${Math.round(WORM.MEDS_HP * 100)}% of the damage and moves on half as fast, but only a dewormer${w.stage === "brain" ? " (in the gut) or surgery" : " or a purge"} clears it. Left alone it kills them in about a week (sooner if hurt), and they get up again.`];
  if (w.stage === "gut") bits.push(`In the gut: eats ${WORM.GUT_EAT} more food a day, works at ${Math.round(WORM.GUT_WORK * 100)}%.`);
  else bits.push(`In the brain: fits and staggering, works at ${Math.round(WORM.BRAIN_WORK * 100)}%.${w.locked ? " Locked away: nobody will be hurt when they turn." : ""}`);
  bits.push(wormCureText(s));
  return bits.join(" ");
}
// A team's water and meat, for the team panel: "" when clean.
export function teamWormText(state, p) {
  const bits = [];
  const ww = teamRawIn(p);
  const tabs = teamTabCount(state, p);
  const how = teamWaterHow(state, p);
  if (ww >= 1 && how !== "filter" && how !== "fire") bits.push(`${Math.floor(ww)} un-purified water${(p.wormEggs || 0) > 0 ? " carries the worm's eggs" : " can carry the worm"} (${
    how === "tabs" ? `dropping a tablet in it: ${tabs} purification tablet${tabs === 1 ? "" : "s"} carried, one per ${WORM.TABS_WATER} water drunk` :
    "drunk as it is: a lit camp fire with firewood boils it, a water filter or purification tablets make it safe"})`);
  const e = eggFood(p.cargo), e2 = eggFood(p);
  const wm = e.meat + e2.meat, wf = e.forage + e.crop + e2.forage + e2.crop;
  if (wm >= 0.5) bits.push(`${Math.round(wm * 10) / 10} days of the raw meat carry the worm's eggs (cook it at a camp fire or a base's cook fire)`);
  if (wf >= 0.5) bits.push(`${Math.round(wf * 10) / 10} days of the forage was gathered on infected ground (boil it at a camp fire or a base's cook fire)`);
  if (p.wormHands && p.wormHands.chance >= 0.005) bits.push(`hands that handled the dead at ${p.wormHands.where} (${Math.round(p.wormHands.chance * 1000) / 10}% each tonight; a lit fire or safe water at home washes it off, mostly)`);
  return bits.join("; ");
}
