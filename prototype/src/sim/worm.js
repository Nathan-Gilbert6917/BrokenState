// The worm (lore: Help → The dead and the worm; the design doc's "What the dead are"). Nobody turns from a bite: the
// dead carry a tapeworm and shed its eggs into the soil and the water, and a tile's infection is how thick they lie.
// People catch it by swallowing the eggs, carry it unseen for a week or so, then in the gut for weeks (they eat like
// two and grow thin), and when its larvae reach the brain they turn. Heat kills the eggs: boiled water and meat
// cooked through are safe.
//
// Catching it (chances per person; eggs = (infection − CLEAN) / (1 − CLEAN), nothing on cleaner land):
//   - water (purified and un-purified, water.js): only un-purified water carries eggs. At a base: WATER × the eggs of
//     its un-purified water (the ground's × the share drawn from the ground: its well or spring, wells, a stream, the
//     claims' wells, prisoners hauling it; rain catchers give clean water) × the share of the day's drinking that was
//     un-purified (economy.js baseDaily drinks purified water first). Each day before drinking (purifyDaily) a lit water
//     boiler purifies the day's drinking for everyone fed there, each water filter PURIFY_FILTER a day, a shelter's
//     lit fire like the boiler. Bases do not use purification tablets: they are kept for the road.
//   - water on the road: WATER × the eggs of the un-purified water the team drinks (p.wormEggs: the eggs of the
//     un-purified water it carries, from where it was filled), × the share of the hour's drinking it was. A team
//     drinks purified water first; un-purified water is safe through a water filter carried, at a lit camp fire (which
//     also boils BOIL un-purified water an hour into purified water, × STOVE with a smokeless stove), or with
//     purification tablets (data.js puritabs: one per TABS_WATER water, dropped in only on the road, never at a lit
//     fire); otherwise it is drunk as it is.
//   - raw meat: RAW per ration of meat with eggs eaten uncooked. Game, fish and snares taken on land at MEAT_AT+
//     infection carry eggs, and infested animals always do (base.wormMeat, cargo.wormMeat: the share of the fresh
//     game that has them). A base with a cook fire or a preserving kitchen (a shelter with its fire lit) cooks it;
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
//     land at CROP_MIN+ infection carries eggs: CROP per ration of crops eaten, FORAGE per ration of forage (base.wormCrop,
//     base.wormForage, cargo.wormForage: like the meat, eaten last; dry crops threshed into the preserved stock are
//     safe). A cook fire or a kitchen cooks them (boiling greens counts); a team's camp fire too.
// The water boiler burns like heating (upkeep.js): BOILER_WOOD_HEAD firewood a head at the base a day (everyone fed
// there), firewood first and fuel for what the wood does not cover (HEAT.wood fuel a firewood), only on days the base's
// un-purified water has eggs and would be drunk (the purified water in store and the filters' share do not cover the
// day). A base that cannot pay leaves it unlit that day and drinks un-purified water.
// The other groups (GROUPS, groupsDaily): a group base on infected ground loses people to the worm at the rate a
// player base of its size would catch it (water WATER + crops CROP at CROP_MIN+, × eggs, × UNCURED: the half they
// never cure), × its type (TYPE: military and fortress hubs boil their water, traders mostly, communes farm infected
// land), and after a base's first loss it boils its water too (BOILER). Never below MIN people: the worm thins a
// group, it never ends one. Their parties on the move (and hardcore bands) lose one now and then on herd land or
// badly infected ground (ROAD × eggs a day). Losses are radio news (diplomacy.js) and chronicle notes.
// The stages (s.worm: { stage, day, len, since, why, how, from (the cause as given), seen, treatedDay, carded, locked }):
//   eggs   EGGS days: nothing shows.
//   gut    GUT days: they eat GUT_EAT more a day, lose GUT_HP health a day and work at GUT_WORK.
//   brain  BRAIN days: BRAIN_HP health a day, work at BRAIN_WORK; then they turn.
// Spotting it: at a base, each day of the gut stage SPOT + SPOT_MED × the best Medicine there (× SPOT_MEDIC with
// someone on the Medic role); on a team, from day TEAM_FROM of the gut stage, TEAM_SPOT + TEAM_SPOT_MED × the best
// Medicine. The brain stage gives itself away (fits, staggering) BRAIN_SPOT a day. A team that spots it gets the card
// "The worm"; at a base the gut stage goes to the Medical tab, the brain stage is a card.
// Treating it (at a base: the Medical tab's buttons, and the night's automatic care, a dewormer first):
//   - a dewormer (loot: pharmacies, clinics, hospitals, farms and ranches; made at a med station): a sure cure in the
//     gut stage, DEWORM_HP health, no medic needed (a team carrying one can use it on the road);
//   - a purge (gut stage): PURGE_MEDS meds and a medic's treatment, PURGE + PURGE_MED × Medicine + PURGE_TIER a
//     hospital tier (at most PURGE_MAX): passed at PURGE_HP health, or it holds on (PURGE_FAIL_HP; again tomorrow);
//   - surgery (brain stage, a Clinic or better): SURGERY_MEDS meds and SURGERY_LOAD of one medic's treatments,
//     SURGERY + SURGERY_MED × Medicine (at most SURGERY_MAX): cured at SURGERY_HP health, or they die on the table.
// Turning: at a base, unseen or kept among the others, they die and go for the nearest people first: one hurt by
// TURN_HURT (a second one TURN_SECOND of the time), each killed TURN_KILL of the time (half that with a guard on
// duty), and everyone there loses TURN_MOOD mood. Locked away (the brain-stage card) nobody is hurt. On a team: like
// the old card's "turned in the night", a teammate is hurt.
//
// Infested animals (state.herds, HERD): game living on land at BORN_AT+ infection catches it too: thin deer and hogs
// that do not attack, carrying the eggs to cleaner ground. While there are fewer than PER_1000 herds per 1,000 tiles,
// one is born SPAWN a day on such land. A herd moves on MOVE of the days (to a land tile next to it, the cleanest one
// DOWNHILL of the time: they wander out of the dead land to graze, toward farms and bases) and seeds the land it
// stands on: the tile's own infection level +SEED × its size / 6 a day, up to SEED_CAP. It lives LIFE days.
// Infested share of a tile's game: (infection − SHARE_AT) / SHARE_SPAN (at most SHARE_MAX), + HERD_SHARE with a herd
// there. Each kill there is infested at that share: YIELD of its food, all of it with eggs, and on a herd's tile one
// animal fewer in the herd (a herd hunted out is gone: a reason to hunt them).
import { log, addCard, alive, residents, atBase, skill, hurt, day, baseById, survivorById, hub, factionById } from "./world.js";
import { GEAR } from "./data.js";
import { Rng } from "./rng.js";
import { count, isShelter } from "./buildings.js";
import { partyMembers, partyTile, bestSkill, carried, takeSupply, wipeIfEmpty, cardStale, tileLabel, teamName } from "./parties.js";
import { activeHospital, careCtx, pickTreater, spendMedicTime, autoCareOn, noTimeReason, nextDayText } from "./medical.js";
import { waterProduction, waterNeed } from "./economy.js";
import { RAW, teamRawIn, waterIn } from "./water.js"; // purified and un-purified water
import { eatFromStore } from "./storage.js";
import { teamFire, teamKit, fireLit } from "./fieldheat.js";
import { packOf } from "./inventory.js";
import { gainXp, USE } from "./skills.js";
import { mouthsAt, HEAT, perHeadText } from "./upkeep.js";
import { news } from "./diplomacy.js";
import { chronicleNote } from "./chronicle.js";
import { bandsOf } from "./hardcore-groups.js";

export const WORM = {
  // Catching it
  CLEAN: 0.1, WATER: 0.02, RAW: 0.04, MEAT_AT: 0.25, CAMP_AT: 0.5, CAMP: 0.03, CAMP_FIRE: 0.5,
  // Hands that handled the dead: an hour's searching, × eggs; the wash (a fire that night or safe water at home)
  SEARCH: 0.004, SEARCH_WASH: 0.75, SEARCH_WARN: 0.3,
  // Crops and forage from land at CROP_MIN+ infection, per ration eaten
  CROP_MIN: 0.4, CROP: 0.015, FORAGE: 0.02,
  // The stages (days) and what they cost
  EGGS: [6, 10], GUT: [18, 26], BRAIN: [4, 6], GUT_EAT: 1, GUT_HP: 0.4, GUT_WORK: 0.85, BRAIN_HP: 4, BRAIN_WORK: 0.3,
  // Spotting it
  SPOT: 0.04, SPOT_MED: 0.012, SPOT_MEDIC: 1.5, TEAM_FROM: 7, TEAM_SPOT: 0.02, TEAM_SPOT_MED: 0.005, BRAIN_SPOT: 0.6,
  // Treating it
  DEWORM_HP: 10, PURGE_MEDS: 2, PURGE: 0.5, PURGE_MED: 0.04, PURGE_TIER: 0.08, PURGE_MAX: 0.95, PURGE_HP: 25, PURGE_FAIL_HP: 10,
  SURGERY_MEDS: 4, SURGERY_LOAD: 3, SURGERY: 0.35, SURGERY_MED: 0.04, SURGERY_MAX: 0.9, SURGERY_HP: 40,
  ROAD_PURGE_HP: 50, ROAD_FAIL_HP: 15, HOPE: 0.25, HOPE_BRAIN: 0.08,
  // Turning
  TURN_HURT: [10, 35], TURN_SECOND: 0.5, TURN_KILL: 0.12, TURN_MOOD: 8, LOCKED_MOOD: 4,
  // Clean water and cooked meat: a camp fire an hour; the base's water boiler a day (firewood a head, like heating;
  // BOILER_DAYS: the days of its firewood a base keeps in store)
  BOIL: 6, STOVE: 2, COOK: 12, BOILER_WOOD_HEAD: 0.2, BOILER_DAYS: 14,
  // Purification tablets (data.js puritabs): water one tablet makes safe (teams only); a base's water filter
  // purifies PURIFY_FILTER water a day
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
export const STAGE_NAMES = { eggs: "swallowed the eggs", gut: "gut stage", brain: "in the brain" };
const HERD_LAND = { forest: 1, hills: 1, plains: 1, mountain: 1, suburb: 0.5 };

const first = (s) => s.name.split(" ")[0];
const r2 = (v) => Math.round(v * 100) / 100;
const stats = (state) => state.wormStats || (state.wormStats = { caught: 0, water: 0, meat: 0, camp: 0, search: 0, crop: 0, forage: 0, spotted: 0, cured: 0, turned: 0, killed: 0, herds: 0, herdKills: 0, groups: 0, road: 0 });
// The worm's own dice (state.wormRng, keyed by the seed): the world's rng sequence is untouched by it, so a world where
// nobody catches it plays out as it would without the worm.
export const wormRng = (state) => state.wormRng || (state.wormRng = new Rng((((state.seed || 1) * 2654435761) ^ 0x5eed) >>> 0));
const len = (state, range) => wormRng(state).int(range[0], range[1]);

// ---------- people ----------
export const wormOf = (s) => (s && s.alive && s.worm) || null;
// Carries it, at any stage, alive or just dead (the Carrier's worm swarm, carriers.js: a carrier who dies rises).
export const hasWorm = (s) => !!(s && s.worm);
// Gone without a cure (put down, died of it, a test): no stats.
export function clearWorm(s) {
  if (s) s.worm = null;
}
// Known to you: spotted at a base or by the team.
export const wormSeen = (s) => { const w = wormOf(s); return !!w && w.seen != null; };
// How much they can work (health.js workFactor): 1 unless the worm has hatched.
export function wormWork(s) {
  const w = wormOf(s);
  if (!w || w.stage === "eggs") return 1;
  return w.stage === "brain" ? WORM.BRAIN_WORK : WORM.GUT_WORK;
}

// Swallowed the eggs: the worm starts, unseen. why: the cause, in words or a key ("swarm": a Carrier's worm swarm in
// battle, carriers.js); how: water, meat or camp (for the stats). Returns true if new.
export function catchWorm(state, s, why = "", how = "") {
  if (!s || !s.alive || s.worm) return false;
  const from = why;
  if (why === "swarm") { why = "from a worm swarm in a fight"; how = how || "swarm"; }
  s.worm = { stage: "eggs", day: 0, len: len(state, WORM.EGGS), since: day(state), why, how, from, seen: null, treatedDay: -99, carded: "" };
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
// each water filter (in the armory or held by someone here) PURIFY_FILTER a day, a shelter's lit fire like the boiler.
// People drink purified water first, then un-purified water (economy.js baseDaily: base.drank), and the share drunk
// un-purified is rolled with the eggs of the un-purified water here (baseWormDaily). Purification tablets are not used
// at a base: they are kept for the teams on the road.
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
  const ground = prod.own + prod.stream + prod.wells + prod.hauled;
  const all = ground + prod.rain;
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
  const fire = isShelter(base) && fireLit(base) ? drink : 0;
  const filters = nFilters * WORM.PURIFY_FILTER;
  return { drink, boiler, fire, filters, nFilters, total: r2(boiler + fire + filters) };
}
// The share of a day's drinking that will be un-purified: what the purified water in store and what can be purified
// today leave.
function rawShareOf(base, cap) {
  const st = base.stock;
  const pure = Math.max(0, st.water || 0) + Math.min(Math.max(0, st[RAW] || 0), cap.total);
  return cap.drink > 0 ? Math.max(0, Math.min(1, (cap.drink - pure) / cap.drink)) : 0;
}
// What the base drinks: { eggs (0..1: the worm's chance factor for a day, after the purified water), raw (the
// ground's eggs), ground (share from the ground), rawShare (the share of the day's drinking that will be
// un-purified), safe, why, cap (purifyCap) }.
export function baseWater(state, base) {
  const e = rawWaterEggs(state, base);
  const cap = purifyCap(state, base);
  const share = rawShareOf(base, cap);
  if (!(e.raw > 0)) return { eggs: 0, raw: 0, ground: 0, rawShare: share, safe: true, cap, why: "the ground here is clean enough" };
  if (!(e.eggs > 0)) return { eggs: 0, raw: e.raw, ground: 0, rawShare: share, safe: true, cap, why: "no ground water drawn here (rain only)" };
  const boil = hasBoiler(base) ? boilerUse(state, base) : null;
  const how = [];
  if (cap.boiler > 0) how.push(`boiled in the water boiler (${boil.text})`);
  if (cap.fire > 0) how.push("boiled on the fire");
  if (cap.filters > 0) how.push(`through ${cap.nFilters === 1 ? "a water filter" : `${cap.nFilters} water filters`} (${cap.filters} a day)`);
  if (!(share > 0)) return { eggs: 0, raw: e.raw, ground: e.ground, rawShare: 0, safe: true, cap, why: how.length ? how.join(" and ") : "purified water in store" };
  const cold = boil && base.boiling === false ? `the water boiler is cold (nothing to burn: it needs ${boil.text}); ` : "";
  const part = share < 1 ? `${Math.round(share * 100)}% of the day's drinking is un-purified (${how.length ? how.join(" and ") : "the purified water in store"} cover${how.length > 1 ? "" : "s"} the rest)` : "drunk un-purified";
  const from = e.ground < 1 ? ` (${Math.round(e.ground * 100)}% of it from the ground; the rain water is clean)` : "";
  return { eggs: e.eggs * share, raw: e.raw, ground: e.ground, rawShare: share, safe: false, cap, why: `${cold}drawn from infected ground${from}, not boiled or filtered: ${part}` };
}

// The base's water boiler: what it burns a day, like heating (upkeep.js heatUse): BOILER_WOOD_HEAD firewood a head
// (everyone fed here), firewood first, then fuel for what the wood does not cover (HEAT.wood fuel a firewood).
// { active (it has work here: the un-purified water has eggs and the water filters do not purify the day's drinking),
// heads, wood (firewood on a day it burns), fuel (the same in fuel), share (the share of days it burns), lit (base.boiling), text ("25 people × 0.2 = 5.0 firewood a
// day (or 2.5 fuel)") }. On a given day it burns only when un-purified water would be drunk (boilerDaily).
export function boilerUse(state, base) {
  const heads = mouthsAt(state, base).heads;
  const wood = r2(heads * WORM.BOILER_WOOD_HEAD);
  const fuel = r2(wood * HEAT.wood);
  const cap = purifyCap(state, base);
  const active = hasBoiler(base) && heads > 0 && rawWaterEggs(state, base).eggs > 0 && cap.filters < cap.drink;
  // share: the days it burns, about (the share of the drinking the filters leave un-purified): each day it burns
  // purifies a whole day's drinking, so with filters covering part of it the purified water carries over.
  const share = active && cap.drink > 0 ? r2(Math.max(0, Math.min(1, 1 - cap.filters / cap.drink))) : 0;
  const text = heads ? `${perHeadText(heads, heads === 1 ? "person" : "people", WORM.BOILER_WOOD_HEAD)} firewood a day (or ${fuel.toFixed(1)} fuel)` : "nobody here";
  return { active, heads, wood, fuel, share, lit: base.boiling !== false, text };
}
// Daily, before drinking (purifyDaily): burns the boiler's firewood (then fuel) from the stores on a day its
// un-purified water has eggs and the purified water in store and the filters' share do not cover the day's drinking;
// an outpost short of it is covered from the hub over its supply line like its heating (needs.js heatDaily). A base
// that cannot pay the whole day leaves it unlit and drinks un-purified water. Returns true when it burned.
function boilerDaily(state, base, people) {
  base.boilerBurn = { wood: 0, fuel: 0 };
  if (!hasBoiler(base) || !people.length) return false;
  const use = boilerUse(state, base);
  if (!use.active) { base.boiling = true; return false; } // nothing to kill, or the filters do it: it stands ready
  const st = base.stock;
  const cap = purifyCap(state, base, false);
  const wanted = (st[RAW] || 0) > 0 && Math.max(0, st.water || 0) + Math.min(Math.max(0, st[RAW] || 0), cap.filters) + 1e-9 < cap.drink;
  if (!wanted) { base.boiling = true; return false; } // enough purified water today (or nothing to boil): it stands ready
  const heatIn = () => Math.max(0, st.wood || 0) * HEAT.wood + Math.max(0, st.fuel || 0);
  const h = base.type === "outpost" ? hub(state) : null;
  const strength = base.supplyLine ? base.supplyLine.strength : 0.5;
  if (h && h !== base && heatIn() < use.fuel && strength > 0) {
    const hb = boilerUse(state, h);
    const keepWood = (hb.active ? hb.wood : 0) * 2;
    const spareWood = Math.max(0, (h.stock.wood || 0) - keepWood);
    const sendWood = Math.min(spareWood, (use.fuel - heatIn()) / HEAT.wood / strength);
    if (sendWood > 0) { h.stock.wood -= sendWood; st.wood = Math.max(0, st.wood || 0) + sendWood * strength; }
    const spareFuel = Math.max(0, (h.stock.fuel || 0) - Math.max(0, 2 * (hb.active ? hb.fuel : 0) - Math.max(0, h.stock.wood || 0) * HEAT.wood));
    const send = Math.min(spareFuel, Math.max(0, use.fuel - heatIn()) / strength);
    if (send > 0) { h.stock.fuel -= send; st.fuel = Math.max(0, st.fuel || 0) + send * strength; }
  }
  const wood = Math.min(Math.max(0, st.wood || 0), use.wood);
  const fuelNeed = Math.max(0, (use.wood - wood) * HEAT.wood);
  const lit = (st.fuel || 0) + 1e-9 >= fuelNeed;
  if (lit) {
    st.wood = Math.max(0, (st.wood || 0) - wood);
    st.fuel = Math.max(0, (st.fuel || 0) - fuelNeed);
    base.boilerBurn = { wood: r2(wood), fuel: r2(fuelNeed) };
    if (base.boiling === false) log(state, `The water boiler at ${base.name} is burning again.`, "good");
  } else if (base.boiling !== false) log(state, `The water boiler at ${base.name} is cold: not enough firewood or fuel to burn (it needs ${use.text}). The water is drunk un-purified.`, "danger");
  base.boiling = lit;
  return lit;
}
// Daily (economy.js baseDaily, before drinking): the boiler burns if it has to, then the boiler, the water filters and
// a shelter's lit fire turn un-purified water into purified water. base.purified = { day, q, boiler, fire, filters,
// total, drink }. Returns the water purified.
export function purifyDaily(state, base) {
  const people = residents(state, base.id);
  const burned = boilerDaily(state, base, people);
  const cap = purifyCap(state, base, burned);
  const st = base.stock;
  const raw = Math.max(0, st[RAW] || 0);
  const q = r2(Math.min(raw, cap.total));
  if (q > 0) { st[RAW] = r2(raw - q); st.water = r2(Math.max(0, st.water || 0) + q); }
  base.purified = { day: day(state), q, boiler: cap.boiler, fire: cap.fire, filters: cap.filters, total: cap.total, drink: cap.drink };
  return q;
}
// Water purified a day at this base and where it comes from, for the base card: { total, text ("boiler 22, 2 filters
// 20"), cap }.
export function purifyText(state, base) {
  const cap = purifyCap(state, base);
  const bits = [cap.boiler > 0 ? `boiler ${Math.round(cap.boiler)}` : "", cap.fire > 0 ? `fire ${Math.round(cap.fire)}` : "", cap.filters > 0 ? `${cap.nFilters === 1 ? "filter" : `${cap.nFilters} filters`} ${cap.filters}` : ""].filter(Boolean);
  return { total: cap.total, text: bits.join(", "), cap };
}

// ---------- meat ----------
// A base cooks what it eats: a cook fire, a preserving kitchen, or a shelter with its fire lit.
export const baseCooks = (base) => count(base, "cookhouse") > 0 || count(base, "kitchen") > 0 || (isShelter(base) && fireLit(base));
export const wormMeatAt = (base) => Math.max(0, Math.min(base.wormMeat || 0, base.meat || 0, base.stock.food || 0));
export const wormMeatIn = (cargo) => (cargo ? Math.max(0, Math.min(cargo.wormMeat || 0, cargo.meat || 0, (cargo.supplies && cargo.supplies.food) || 0)) : 0);
// Crops and forage with eggs in the base's fresh food (grown or gathered on land at CROP_MIN+ infection): what is
// really there, capped by the fresh food that is not meat with eggs. { crop, forage, all }.
export function wormVegAt(base) {
  const room = Math.max(0, (base.stock.food || 0) - wormMeatAt(base));
  const crop = Math.max(0, base.wormCrop || 0), forage = Math.max(0, base.wormForage || 0);
  const all = crop + forage;
  if (!(all > 0)) return { crop: 0, forage: 0, all: 0 };
  const k = Math.min(1, room / all);
  return { crop: crop * k, forage: forage * k, all: all * k };
}
export const wormForageIn = (cargo) => (cargo ? Math.max(0, Math.min(cargo.wormForage || 0, Math.max(0, ((cargo.supplies && cargo.supplies.food) || 0) - wormMeatIn(cargo)))) : 0);
// Land infected enough for what grows or is gathered on it to carry the eggs (farming.js, foraging.js).
export const cropLandBad = (state, tile) => !!state.tiles[tile] && (state.tiles[tile].infection || 0) >= WORM.CROP_MIN;
// A harvest of fresh crops (farming.js takeHarvest) or forage (foraging.js) into a base's stores from `tile`.
export function addWormCrop(state, base, tile, rations, kind = "crop") {
  if (!(rations > 0) || !cropLandBad(state, tile)) return;
  const k = kind === "forage" ? "wormForage" : "wormCrop";
  base[k] = (base[k] || 0) + rations;
}
// Forage gathered into a team's cargo (foraging.js gatherHour).
export function addWormForage(state, p, tile, rations) {
  if (!(rations > 0) || !cropLandBad(state, tile)) return;
  p.cargo.wormForage = wormForageIn(p.cargo) + rations;
}
// A team unloading at a base (parties.js returnHome, after hunting.js unloadGame).
export function unloadWormForage(base, cargo) {
  const w = wormForageIn(cargo);
  if (cargo) cargo.wormForage = 0;
  if (w > 0) base.wormForage = (base.wormForage || 0) + w;
}
// Before a base eats (economy.js): its cook fire cooks the meat with eggs, and the crops and forage (boiled greens);
// it is ordinary fresh food after that. Returns the rations cooked.
export function cookAtBase(state, base) {
  const m = wormMeatAt(base), v = wormVegAt(base);
  if (!baseCooks(base)) { base.wormMeat = m; base.wormCrop = v.crop; base.wormForage = v.forage; return 0; }
  base.wormMeat = 0; base.wormCrop = 0; base.wormForage = 0;
  return m + v.all;
}
// Smoked or dried food (the racks, the hunting cabin): the eggs die first, the meat with eggs goes first, then the
// crops and forage with eggs.
export function smokeWormMeat(base, qty) {
  let q = Math.max(0, qty);
  if (base.wormMeat > 0) { const m = wormMeatAt(base); base.wormMeat = Math.max(0, m - q); q = Math.max(0, q - m); }
  if (q > 0 && (base.wormCrop > 0 || base.wormForage > 0)) {
    const v = wormVegAt(base);
    const c = Math.min(v.crop, q);
    base.wormCrop = v.crop - c;
    base.wormForage = Math.max(0, v.forage - (q - c));
  }
}
// Fresh game lost (spoiled): the meat with eggs goes in proportion.
export function shrinkWormMeat(holder, before, after) {
  if (!(holder.wormMeat > 0)) return;
  holder.wormMeat = before > 0 ? Math.max(0, holder.wormMeat * Math.max(0, after) / before) : 0;
}
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
  let n = 0;
  for (const s of people) if (wormRng(state).chance(per) && catchWorm(state, s, why, how)) n++;
  return n;
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
// How a team drinks its un-purified water now: "filter" (a water filter carried), "fire" (a lit camp fire boils it),
// "tabs" (purification tablets carried), "unsafe" (drunk as it is), "clean" (from clean ground: no eggs), or "" (none
// carried). For the team panel.
export function teamWaterHow(state, p) {
  if (!(teamRawIn(p) > 0)) return "";
  if (!((p.wormEggs || 0) > 0)) return "clean";
  if (hasFilter(state, p)) return "filter";
  if (teamFire(state, p) === true) return "fire";
  if ((p.tabWater || 0) > 0 || teamTabCount(state, p) > 0) return "tabs";
  return "unsafe";
}
// An hour's drinking (needs.js teamNeedsHour): `drank` in all, `raw` of it un-purified. A water filter carried makes the
// un-purified water safe; else a lit camp fire boils it; else purification tablets carried are dropped in (one per
// TABS_WATER water); else it is drunk as it is: WORM.WATER × its eggs × the share of the hour's drinking, a day.
export function drinkHour(state, p, members, drank, raw = 0) {
  const e = p.wormEggs || 0;
  if (!(teamRawIn(p) > 0)) p.wormEggs = 0; // the last of it was drunk
  if (!(raw > 0) || !(drank > 0) || !(e > 0)) return; // none drunk, or from clean ground: nothing to kill
  if (hasFilter(state, p)) return;
  if (teamFire(state, p) === true) return; // boiled at the camp fire: no tablet spent while camping by a lit fire
  // Purification tablets carried: one per TABS_WATER of the un-purified water drunk makes it safe; only what they do
  // not cover is rolled.
  const { raw: left, used } = treatWater(p, teamTabs(state, p), raw);
  if (used > 0) { const n = teamTabCount(state, p); log(state, `${teamName(state, p)} dropped ${used === 1 ? "a purification tablet" : `${used} purification tablets`} into the river water (${n ? `${n} left` : "the last of them"}).`, "info"); }
  const chance = (WORM.WATER * e * (left / drank)) / 24;
  if (chance > 0) for (const s of members) if (wormRng(state).chance(chance)) catchWorm(state, s, `drinking un-purified water on the road`, "water");
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
// An hour's eating raw (parties.js consume): meat with eggs from the cargo, when nothing else is left. Returns rations.
export function eatRawCargo(state, p, members, need) {
  const m = wormMeatIn(p.cargo);
  const q = Math.max(0, Math.min(m, need));
  if (!(q > 0)) return 0;
  p.cargo.supplies.food -= q;
  p.cargo.meat = Math.max(0, (p.cargo.meat || 0) - q);
  p.cargo.wormMeat = m - q;
  eatRaw(state, members, q, "eating half-raw game on the road");
  return q;
}
// Forage with eggs from the cargo, eaten uncooked when the clean food is gone (before the raw meat). Returns rations.
export function eatRawForageCargo(state, p, members, need) {
  const w = wormForageIn(p.cargo);
  const q = Math.max(0, Math.min(w, need));
  if (!(q > 0)) return 0;
  p.cargo.supplies.food -= q;
  p.cargo.wormForage = w - q;
  eatRaw(state, members, q, "eating greens and roots gathered on infected ground", WORM.FORAGE, "forage");
  return q;
}
// Hourly for a team (parties.js playerPartyHour): a camp fire boils un-purified water and cooks meat and forage; camping on badly
// infected land is a risk in itself; and when the day turns, the hands that searched yesterday are rolled.
export function wormTeamHour(state, p, members) {
  const fire = teamFire(state, p);
  if (p.wormHands && p.wormHands.day !== day(state)) rollHands(state, p, members, fire === true, `searching ${p.wormHands.where}`);
  if (fire == null) return;
  if (fire) {
    if (teamRawIn(p) > 0) { boilTeamWater(p, WORM.BOIL * (hasStove(state, p) ? WORM.STOVE : 1)); if (!(teamRawIn(p) > 0)) p.wormEggs = 0; } // un-purified water boiled into purified water
    if (p.cargo && p.cargo.wormMeat > 0) p.cargo.wormMeat = Math.max(0, wormMeatIn(p.cargo) - WORM.COOK);
    if (p.cargo && p.cargo.wormForage > 0) p.cargo.wormForage = Math.max(0, wormForageIn(p.cargo) - WORM.COOK);
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
      if (i >= 0) { const it = where[i]; where[i] = null; return it; }
    }
  }
  for (const list of lists) {
    const i = list.findIndex((it) => it && it.key === key);
    if (i >= 0) return list.splice(i, 1)[0];
  }
  return null;
}
const findIn = (people, lists, key) => people.some((s) => [...(s.pockets || []), ...(packOf(s) || [])].some((it) => it && it.key === key)) || lists.some((l) => l.some((it) => it && it.key === key));

// ---------- purification tablets (data.js puritabs: tabs, dur = tablets left) ----------
// One tablet makes WORM.TABS_WATER water safe. They are for the road: a team drops them into the un-purified water it
// drinks from infected sources when it carries no water filter and sits at no lit camp fire (drinkHour: a tablet is
// opened when the last one's water is used up, the rest kept as p.tabWater for the next drink). A base never uses
// them (its boiler, filters or a shelter's fire purify its water): tubes in the armory wait for a team to pack them
// (autopilot.js launchTrip, the planner). Tubes are found in people's pockets and packs, the team's cargo and the
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
export const baseDewormers = (state, base) => base.armory.filter((it) => it && it.key === "dewormer").length + atBase(state, base.id).reduce((a, s) => a + [...(s.pockets || []), ...(packOf(s) || [])].filter((it) => it && it.key === "dewormer").length, 0);
const teamHasDewormer = (state, p) => findIn(partyMembers(state, p), [(p.cargo && p.cargo.gear) || []], "dewormer");

// ---------- treatment at a base ----------
// What can be done for someone at this base now: { ok, reason, kind, cost, chance, treater, load }.
// kind: "dewormer" (gut stage, one in the armory or on someone here), "purge" (gut stage, meds and a medic) or
// "surgery" (brain stage, a Clinic or better).
export function wormTreatInfo(state, base, s, kind, ctx = null) {
  const w = wormOf(s);
  const out = { ok: false, reason: "", kind, cost: 0, chance: 0, treater: null, load: 1 };
  if (!w || w.seen == null) { out.reason = `Nobody knows ${s ? first(s) : "they"} has the worm.`; return out; }
  if (!base || !residents(state, base.id).includes(s)) { out.reason = `${first(s)} is not at ${base ? base.name : "a base"}.`; return out; }
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
// Applies a checked treatment. Returns the message.
export function applyWormTreat(state, base, s, info) {
  const w = s.worm;
  w.treatedDay = day(state);
  if (info.kind === "dewormer") {
    takeFrom(atBase(state, base.id), [base.armory], "dewormer");
    cureWorm(state, s);
    hurt(state, s, WORM.DEWORM_HP, base.tile, "of the worm", { raw: true });
    return `${s.name} took a dewormer at ${base.name} and passed the worm. Weak for a few days, but clean.`;
  }
  base.stock.meds = Math.max(0, (base.stock.meds || 0) - info.cost);
  state.medsUsed = (state.medsUsed || 0) + info.cost;
  spendMedicTime(state, base, info.treater, info.load);
  gainXp(state, info.treater.s, "medicine", USE.illness);
  const ok = wormRng(state).chance(info.chance);
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
// The night's automatic care (with the base's other care, medical.js autoCare): a dewormer first, else a purge in
// the gut stage, surgery in the brain stage. It may dip into the meds reserve: the worm kills for sure.
function wormCare(state, base) {
  if (!autoCareOn(base)) return;
  for (const s of residents(state, base.id)) {
    const w = wormOf(s);
    if (!w || w.seen == null || w.locked) continue;
    for (const kind of w.stage === "gut" ? ["dewormer", "purge"] : ["surgery"]) {
      const info = wormTreatInfo(state, base, s, kind, kind === "dewormer" ? null : careCtx(state, base));
      if (!info.ok) continue;
      const msg = applyWormTreat(state, base, s, info);
      log(state, `Night care at ${base.name}: ${msg}`, /died/.test(msg) ? "death" : /did not work/.test(msg) ? "danger" : "good");
      break;
    }
  }
}

// ---------- the daily tick (economy.js basesDaily, after the day's illness) ----------
export function wormDaily(state) {
  for (const base of state.bases) baseWormDaily(state, base);
  for (const s of alive(state)) if (s.worm) stageDaily(state, s);
  for (const base of state.bases) wormCare(state, base);
  herdsDaily(state);
  groupsDaily(state);
}

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
  // Water: today's drinking (economy.js baseDaily: base.drank, purified first) and the share of it drunk un-purified,
  // with the eggs of the un-purified water here.
  const d = base.drank && base.drank.day === day(state) ? base.drank : null;
  const share = d && d.pure + d.raw > 0 ? d.raw / (d.pure + d.raw) : 0;
  const eggs = share > 0 ? rawWaterEggs(state, base).eggs * share : 0;
  // Once per base: the first day its people drink water with the worm's eggs.
  if (eggs > 0 && !base.wormWaterWarned) {
    base.wormWaterWarned = true;
    log(state, `The un-purified water at ${base.name} is drawn from infected ground and carries the worm's eggs. Build a water boiler or keep water filters here (each purifies ${WORM.PURIFY_FILTER} a day); until then every day is a chance of catching it.`, "danger");
  }
  if (eggs > 0) for (const s of people) if (wormRng(state).chance(WORM.WATER * eggs)) catchWorm(state, s, `drinking un-purified water at ${base.name}`, "water");
}

function where(state, s) {
  if (s.location.kind === "base") return { base: baseById(state, s.location.baseId) };
  if (s.location.kind === "route") return { base: state.bases.find((b) => b.type === "hub") || null };
  if (s.location.kind === "party") return { party: state.parties.find((p) => p.id === s.location.partyId) || null };
  return {};
}
function tileOf(state, s) {
  const at = where(state, s);
  return at.base ? at.base.tile : at.party && at.party.path ? partyTile(at.party) : null;
}

function stageDaily(state, s) {
  const w = s.worm;
  const at = where(state, s);
  w.day += 1;
  if (w.stage === "eggs") {
    if (w.day >= w.len) { w.stage = "gut"; w.day = 0; w.len = len(state, WORM.GUT); }
    return;
  }
  const tile = tileOf(state, s);
  if (w.stage === "gut") {
    // Eats like two: the extra food comes out of the base's stores or the team's packs.
    if (at.base) eatFromStore(at.base, WORM.GUT_EAT);
    else if (at.party) takeSupply(at.party, "food", WORM.GUT_EAT);
    hurt(state, s, WORM.GUT_HP, tile, "of the worm", { raw: true });
    if (!s.alive) return;
    if (w.seen == null) spot(state, s, at);
    if (w.day >= w.len) {
      w.stage = "brain"; w.day = 0; w.len = len(state, WORM.BRAIN);
      if (w.seen != null) log(state, `${s.name}'s worm has reached the brain: fits and staggering. Only surgery in a Clinic can save them now.`, "danger");
    }
    return;
  }
  // The brain stage.
  hurt(state, s, WORM.BRAIN_HP, tile, "of the worm", { raw: true });
  if (!s.alive) return;
  if (w.carded !== "brain" && (w.seen != null || wormRng(state).chance(WORM.BRAIN_SPOT))) {
    if (w.seen == null) { w.seen = day(state); stats(state).spotted++; }
    w.carded = "brain";
    if (at.base) baseBrainCard(state, s, at.base);
    else if (at.party) teamCard(state, at.party, s);
  }
  if (w.day >= w.len) turn(state, s, at);
}

// Spotting the gut stage: a base's medic, or a team on the road (later).
function spot(state, s, at) {
  const w = s.worm;
  let chance = 0;
  if (at.base) {
    const here = atBase(state, at.base.id);
    const med = Math.max(0, ...here.map((x) => skill(x, "medicine")));
    chance = (WORM.SPOT + WORM.SPOT_MED * med) * (here.some((x) => x.role === "medic") ? WORM.SPOT_MEDIC : 1);
  } else if (at.party && w.day >= WORM.TEAM_FROM) {
    chance = WORM.TEAM_SPOT + WORM.TEAM_SPOT_MED * bestSkill(state, at.party, "medicine");
  }
  if (!(chance > 0) || !wormRng(state).chance(chance)) return;
  w.seen = day(state);
  stats(state).spotted++;
  if (at.base) {
    const medic = atBase(state, at.base.id).filter((x) => x !== s).sort((a, b) => skill(b, "medicine") - skill(a, "medicine"))[0];
    log(state, `${medic ? `${first(medic)} found` : "Someone found"} pale segments in ${s.name}'s stool at ${at.base.name}: it is the worm (${w.why}). A purge or a dewormer clears it now; once it reaches the brain only surgery will. See the Medical tab.`, "danger");
  } else if (at.party) {
    w.carded = "gut";
    teamCard(state, at.party, s);
  }
}

// ---------- turning ----------
function turn(state, s, at) {
  const w = s.worm;
  const tile = tileOf(state, s);
  stats(state).turned++;
  const locked = !!w.locked;
  s.worm = null;
  hurt(state, s, 999, tile, "of the worm (turned)");
  if (at.base) {
    const base = at.base;
    const others = residents(state, base.id);
    for (const x of others) x.mood = Math.max(0, x.mood - (locked ? WORM.LOCKED_MOOD : WORM.TURN_MOOD));
    if (locked) { log(state, `${s.name} turned behind a locked door at ${base.name}. They were put down without anyone else hurt.`, "death"); return; }
    const guard = atBase(state, base.id).some((x) => x.role === "guard");
    const victims = [];
    const pool = [...others];
    const n = Math.min(pool.length, 1 + (wormRng(state).chance(WORM.TURN_SECOND) ? 1 : 0));
    for (let i = 0; i < n; i++) victims.push(pool.splice(wormRng(state).int(0, pool.length - 1), 1)[0]);
    const hurtNames = [];
    for (const v of victims) {
      const kill = wormRng(state).chance(WORM.TURN_KILL * (guard ? 0.5 : 1));
      hurt(state, v, kill ? 999 : wormRng(state).int(WORM.TURN_HURT[0], WORM.TURN_HURT[1]), base.tile, `when ${first(s)} turned (the worm)`);
      hurtNames.push(v.alive ? `${first(v)} was hurt` : `${v.name} was killed`);
    }
    log(state, `${s.name} turned at ${base.name}: the worm reached the brain and nobody saw it coming. ${hurtNames.length ? `${hurtNames.join(" and ")} before ${guard ? "the guards" : "they"} put ${first(s)} down.` : "They put the body down."}`, "death");
    return;
  }
  if (at.party) {
    const p = at.party;
    const mates = partyMembers(state, p);
    for (const x of mates) x.mood = Math.max(0, x.mood - WORM.TURN_MOOD);
    if (mates.length) {
      const v = wormRng(state).pick(mates);
      hurt(state, v, wormRng(state).int(WORM.TURN_HURT[0], WORM.TURN_HURT[1]), partyTile(p), `when ${first(s)} turned (the worm)`);
      log(state, `${s.name} turned in the night near ${tileLabel(state, partyTile(p))}. ${v.alive ? `${first(v)} was hurt` : `${v.name} was killed`} before the team put them down.`, "death");
    } else log(state, `${s.name} turned in the night near ${tileLabel(state, partyTile(p))}.`, "death");
    wipeIfEmpty(state, p);
  }
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
      ? `${s.name} had a fit this morning and cannot walk straight. It is the worm, and it has reached the brain (${w.why}). A purge cannot help now; only surgery in a Clinic, and that is far away. When it is done with them, they will turn.`
      : `${s.name} has been eating like two people and getting thinner, and this morning they found pale segments in their stool. It is the worm: they swallowed its eggs ${w.why}. If it reaches the brain they will turn. A dewormer clears it for sure; at a base, meds and a medic can purge it.`,
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
    text: `${s.name} had a fit at ${base.name} and cannot walk straight. It is the worm, and it has reached the brain (${s.worm.why}). In a few days they will turn. Only surgery in a Clinic can save them.`,
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
export function wormLabel(s) {
  const w = wormOf(s);
  if (!w) return "";
  return w.stage === "brain" ? "The worm (brain)" : "The worm (gut)";
}
export function wormTip(state, s) {
  const w = wormOf(s);
  if (!w) return "";
  const bits = [`Caught ${w.why || "somewhere on infected land"}; found on day ${w.seen}.`];
  if (w.stage === "gut") bits.push(`In the gut: eats ${WORM.GUT_EAT} more food a day, loses ${WORM.GUT_HP} health a day, works at ${Math.round(WORM.GUT_WORK * 100)}%. Left alone it reaches the brain within weeks. Cure: a dewormer (sure), or a purge (${WORM.PURGE_MEDS} meds and a medic: better Medicine and a hospital help).`);
  else bits.push(`In the brain: loses ${WORM.BRAIN_HP} health a day, works at ${Math.round(WORM.BRAIN_WORK * 100)}%, and turns within days. Only surgery in a staffed Clinic or better can save them (${WORM.SURGERY_MEDS} meds).${w.locked ? " Locked away: nobody will be hurt when they turn." : ""}`);
  return bits.join(" ");
}
// A team's water and meat, for the team panel: "" when clean.
export function teamWormText(state, p) {
  const bits = [];
  const ww = teamRawIn(p);
  const tabs = teamTabCount(state, p);
  const how = teamWaterHow(state, p);
  if (ww >= 1 && how !== "clean") bits.push(`${Math.floor(ww)} un-purified water carries the worm's eggs (${
    how === "filter" ? "drunk through the water filter carried: safe" : how === "fire" ? "the camp fire boils it" :
    how === "tabs" ? `dropping a tablet in the river water: ${tabs} purification tablet${tabs === 1 ? "" : "s"} carried, one per ${WORM.TABS_WATER} water drunk` :
    "drunk as it is: a camp fire boils it, a water filter or purification tablets make it safe"})`);
  const wm = wormMeatIn(p.cargo);
  if (wm >= 1) bits.push(`${Math.floor(wm)} of the game carries the worm's eggs (cook it at a camp fire or a base's cook fire)`);
  const wf = wormForageIn(p.cargo);
  if (wf >= 1) bits.push(`${Math.floor(wf)} of the forage was gathered on infected ground (boil it at a camp fire or a base's cook fire)`);
  if (p.wormHands && p.wormHands.chance >= 0.005) bits.push(`hands that handled the dead at ${p.wormHands.where} (${Math.round(p.wormHands.chance * 1000) / 10}% each tonight; a lit fire or safe water at home washes it off, mostly)`);
  return bits.join("; ");
}
