// Eating, person by person (wave 2, user request 2026-10-11: "Survivors will take breaks in their day to eat food until
// they hit 80 to 100% full satiation. When in base and out of base survivors need food so they must carry some on them
// with water to survive."; picks 2 the meal mood ladder, 3 food preferences, 4 ration levels per base).
//
// Meal breaks (baseEatHour, hourly from needs.js for every base of yours with people):
//   - Hunger falls NEEDS.food (40) a day × the cold (upkeep.js coldFactor) × appetite (Glutton) × the base's ration
//     level (meals.js RATION_LEVELS use: lean 0.8, a feast day 1.5), ×NEEDS.leanRate below 50 as before.
//   - Everyone has a fullness target of their own in EAT.band (80–100: eatTarget, fixed by their name; a Glutton 100):
//     lean 75, a feast 100, the automatic short rations (economy.js base.rationing under a week of food) 48.
//   - They eat at their mealtime (meals.js: 06:00 breakfast, 10:00 for hunters and fishers back from the dawn trip,
//     lunch at the lunch hour, 12:00 unless the Work tab moves it, 20:00 dinner) when they are EAT.meal (5) under their
//     target, and between meals when they drop below EAT.snack (55;
//     at night, 22–05, below EAT.night 30; on short rations below 40): up to the target. That is three meals a day,
//     a ration a day in all (hunger falls as before, so the daily totals are the old once-a-day eating's:
//     tools/eatingtest.js measures it). Lunch gives everyone who eats it EAT.lunchMood (an hour of free time's mood,
//     work.js OFF_MOOD); out on a job trip they eat it from the pack where they are (jobtrips.js).
//   - A meal is a break: EAT.min.base + EAT.min.per × the days of food eaten minutes (a 23-point dinner about 28 min, a
//     mealtime meal at least EAT.min.meal), shown "Eating breakfast (25 min)" (activity.js) and kept on s.meal. Its
//     work time is the meal hour the round-the-clock jobs stop for (meals.js MEAL_WORK_SHARE: construction, crafting
//     and the bench lose the 06:00 and 20:00 hours; the jobs with set hours have no meal in them): one cost, not two. A
//     snack between meals is about 10–15 minutes nobody's work counts (abstract).
//   - What they eat (baseMenu, built once a base an hour, only when someone eats): cooked meals first, the best tier
//     first (lavish, fine, stew, simple: unless the base is lean or short, then everything soonest to spoil first), then
//     the rest soonest to spoil first (the lot with the least shelf left), raw meat and fish last at a base that does
//     not cook (worm.js baseCooks: a cook fire, the Kitchen, a shelter's fire); never the food with the worm's eggs
//     unless nothing else is left (then raw, as storage.js eatFromStore: the worm's dice in worm.js wormDaily). For
//     each person: a Vegetarian takes plant food (diet "veg") first; anyone skips the food they ate most of on each of
//     the last EAT.variety days while it is not about to spoil (EAT.urgent days) and there is something else: variety.
//   - A day of food fills NEEDS.food points ÷ the base's stretch (a Quartermaster ×0.9, the Kitchen's hot meals ×0.9:
//     upkeep.js foodUse's numbers), so the stores and every forecast agree.
//   - The base's day (economy.js baseDaily at midnight, eatAcc): what its people ate from the stores (the old `eaten`)
//     and what they wanted and could not get (`missed`: base.foodShort, so the hub starves and an outpost asks the hub as
//     before: economy.js hungerDays, starve; needs.js STARVE). The automatic short rations, the Kitchen's day, the
//     "nothing fresh" streak and the stats read the same numbers.
//
// Carried rations (the pack: s.ration = { supplies: { food items, water }, foodLots }, a holder like a team's: foods.js):
//   - Everyone carries PACK.food (1.5) days of food that keeps (foods.js packPick: light, long-keeping) and PACK.water
//     (1.5) purified water; load.js wornLoad counts its kg.
//   - At a base they eat from the stores; the pack is for leaving. It is topped up from the stores at PACK.hour (05:00)
//     for everyone home and whenever someone eats at home with it under half full, while the base is not rationing and
//     holds PACK.keepDays (3) days of food (and of drinking water) beyond it (the governor and the stewards keep it so;
//     so does everyone else: it is the base's own routine).
//   - Away from the stores (out on a job trip: jobtrips.js s.trip, a field work's builders s.away, a lookout's shift at a
//     field work: fieldworks.js "post") they eat from the pack by the same rule; with the stores empty, at home too.
//   - An errand (hubevents.js) tops the pack up for its days (needs.js packErrand: ERRAND_PACK) and eats and drinks
//     from it; back home, what is over the pack goes to the stores.
//   - A team (parties.js launchExpedition): the members' packs count toward its food and water (the base packs that
//     much less), so a team weighs what it did. On the road the team eats its shared supplies first, then each member
//     their own pack (needs.js teamNeedsHour). Run out away from the stores: hunger and thirst bite as before.
//   - A death at a base: the pack goes to its stores; elsewhere it stays with the body. Packs age as a team's food does
//     (hunting.js carriedFactor, daily).
//
// Mood (timed thoughts, THOUGHTS: a one-off mood change when it starts, and the same thought cannot come again until it
// has run out; s.thoughts, listed in the survivor screen and the mood notes):
//   Ate raw food −7 (2 days) · a cooked meal: the catalog's moodLift × 3 for 3 days (stew +3, fine +6, lavish +12;
//   a simple meal 0: the old daily "Good meals" averaged the same) · Same food again −3 (2 days) once the same food was
//   most (EAT.sameShare, 60%+) of what they ate EAT.sameDays (4) days running · A feast +6 (3 days) · Lean rations −1 a day and the short
//   rations' −3 a day (economy.js). No dining tables exist, so there is no "ate without a table".
// Traits (traits.js TRAIT_TIERS, by tier): Picky eater (simple meals and raw food worse, fine and lavish meals better),
// Vegetarian (meat, animal products and mixed food −6 and plant food first), Cannibal (human meat +10; anyone else −20).
// Human meat: the game has no source of it and this wave adds none. The dead carry the worm (worm.js, carriers.js:
// a body left unburied gets up again), so meat from them would be infested by the game's own rules, and butchering
// people is darker than the game's tone. FOODS has no "human" diet item; the thoughts are here for one if it ever comes.
//
// AI groups (factions.js, coarse): the same ration levels (groupRation: lean under GROUP_EAT.leanBelow days a head, a
// feast on the festival day), × their day's food; lean, a feast and a monotonous store move their desertion pressure
// (groupcare.js desertPressure: groupDietPressure). Their parties carry PACK.food a head out of the group's stock and
// eat it on the road (parties.js spawnAiParty / removeParty: what is left comes home). Their people's traits stay
// abstract (they are numbers until they join you).
//
// Balance (2026-10-11, the governor, Balanced, 112 days, against dev a447855 with cooking): normal seeds 1–9 ate 1.017
// days of food a head a day (dev 1.078: the lean days, 61 base-days over nine games), no hunger days in either, deaths
// 40 vs 35 (hive assaults and fights, none from food), mean mood 85.6 vs 84.5, buildings 199 vs 155, harvest 6534 vs
// 6518, alive at the end 100 vs 95; hardcore seeds 11–12: both alive (12 and 6, no hunger days) where dev's seed 11
// starved out on day 106.
import { FOODS, foodIn, takeItem, takeFood, lotsOf, syncLots, packPick, moveFood, unitsOf, ageLots, foodKg } from "./foods.js";
import { NEEDS, ensureNeeds } from "./needs.js";
import { hourOfDay, outOnTrip, residents, log } from "./world.js";
import { foodForecast } from "./economy.js";
import { RATION_LEVELS, rationKey, mealOf } from "./meals.js";
import { appetite, hasTrait, traitFx, traitHash } from "./traits.js";
import { coldFactor, foodUse } from "./upkeep.js";
import { eatMult } from "./skills.js";
import { kitchenEatMult, kitchenService, hasKitchen } from "./kitchen.js";
import { baseCooks } from "./worm.js";
import { ateFromStore, edibleFood, notePoisoned } from "./storage.js";
import { addMood } from "./relations.js";
import { drawWater, waterIn, RAW } from "./water.js";
import { carriedFactor } from "./hunting.js";
import * as Weather from "./weather.js";
import { poisonRoll } from "./cooking.js"; // wave 2 cooking: food poisoning from the lots each person ate (the eating contract)

export const EAT = {
  band: [80, 100], spread: [82, 96], meal: 5, snack: 55, night: 30, nightFrom: 22, nightTo: 6, short: [40, 48],
  min: { base: 12, per: 28, meal: 20, max: 45 },
  variety: 2, urgent: 2, sameDays: 4, log: 5, sameShare: 0.6,
  rawMin: 0.1, dietMin: 0.1, // days of food that count for a thought (a bite of jerky is not "ate meat")
  lunchMood: 0.25, // the lunch break's lift (work.js OFF_MOOD: an hour of free time)
  // No hot food (2026-10-12, user request "Eatting non-cooked food for days is a mood negative so it pushes for getting
  // cooking"): days since someone last ate hot food (a cooked meal, the Kitchen's hot service, or raw meat cooked where
  // they ate it) before the thought "No hot food" starts (cold[0] days: coldV[0]; cold[1] days or more: coldV[1]).
  cold: [3, 6], coldV: [-3, -6],
};
// trip: the food someone sets out on a job trip with, at least (jobtrips.js: their lunch out there), topped up as they leave.
export const PACK = { food: 1.5, water: 1.5, hour: 5, keepDays: 3, keepShelf: 7, half: 0.5, trip: 1 };
// Timed thoughts: v (mood when it starts), hours it lasts. Meal tiers: the catalog's moodLift × MEAL_MOOD.
export const MEAL_MOOD = 3;
export const THOUGHTS = {
  raw:      { label: "Ate raw food", v: -7, hours: 48 },
  meal:     { label: "Ate a good meal", v: 0, hours: 72 }, // v from the meal (stew +3, fine +6, lavish +12)
  same:     { label: "Same food again", v: -3, hours: 48 },
  feast:    { label: "A feast", v: 6, hours: 72 },
  picky:    { label: "Picky eater", v: 0, hours: 48 }, // v by tier: traits.js picky
  veg:      { label: "Ate meat (vegetarian)", v: 0, hours: 48 }, // v by tier: traits.js vegetarian
  cannibal: { label: "Ate human meat (cannibal)", v: 0, hours: 72 },
  human:    { label: "Ate human meat", v: -20, hours: 120 },
  cold:     { label: "No hot food in days", v: -3, hours: 24 }, // v and label by the days without (EAT.cold)
};
export const MEAL_NAMES = { simple: "a simple meal", fine: "a fine meal", lavish: "a lavish meal" };

const clamp = (v) => Math.max(0, Math.min(NEEDS.max, v));
const EPS = 1e-6;
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const dayOf = (h) => Math.floor(h / 24);
// The day a meal at this tick counts for (the midnight tick closes the day before: economy.js reads it at midnight).
const workDay = (h) => Math.floor((h - 1) / 24);
const nameHash = (s) => { let h = 0; const n = String((s && s.name) || ""); for (let i = 0; i < n.length; i++) h = (Math.imul(h, 31) + n.charCodeAt(i)) | 0; return h; };
const isMeat = (f) => f.diet === "meat" || f.diet === "animal" || f.diet === "mixed" || f.diet === "human";
const isMeal = (f) => f.group === "meal" && !f.stable; // a cooked meal (pemmican keeps: it is travelling food)

// ---------- targets ----------
// Someone's own fullness target (80–100: EAT.spread by a hash of their name, the same all game; a Glutton 100).
export function eatTarget(s) {
  if (hasTrait(s, "glutton")) return EAT.band[1];
  const u = ((nameHash(s) >>> 0) % 1000) / 1000;
  return Math.round(EAT.spread[0] + u * (EAT.spread[1] - EAT.spread[0]));
}
// Their target at a ration level ("short", "lean", "feast", "normal").
export function targetAt(s, key) {
  if (key === "short") return EAT.short[1];
  const lv = RATION_LEVELS[key];
  return lv && lv.target != null ? lv.target : eatTarget(s);
}
// Do they eat now (hour of day h, on `job`)? Returns the hunger they eat below (0: they do not).
function eatBelow(state, s, h, key, tgt, job) {
  if (mealOf(job, h, state)) return tgt - EAT.meal;
  if (key === "short") return EAT.short[0];
  const night = h >= EAT.nightFrom || h < EAT.nightTo;
  return Math.min(night ? EAT.night : EAT.snack, tgt - EAT.meal);
}

// ---------- the pack ----------
// s.ration: a holder (foods.js: its supplies keep lots), made when first needed.
export function rationOf(s) {
  if (!s.ration || typeof s.ration !== "object") s.ration = { supplies: {}, foodLots: {} };
  if (!s.ration.supplies) s.ration.supplies = {};
  return s.ration;
}
export const packFood = (s) => (s && s.ration ? foodIn(s.ration.supplies) : 0);
export const packWater = (s) => (s && s.ration ? waterIn(s.ration.supplies) : 0);
// Kg of the pack (load.js wornLoad): its food and its water (1 kg a water).
export const packKg = (s) => (s && s.ration ? foodKg(s.ration.supplies) + waterIn(s.ration.supplies) : 0);
// Away from the stores now: out on a job trip or a field work's building (world.js outOnTrip), or posted at a field work.
export const awayFromStores = (state, s) => !!s && (outOnTrip(state, s) || (s.location && s.location.kind === "post"));

// Tops someone's pack up from a base's stores (food that keeps, purified water), if the base can spare it. Returns
// { food, water } added.
// memo: { use, heads } for a base (one foodUse an hour, not one a person).
export function topUpPack(state, base, s, { food = PACK.food, water = PACK.water } = {}, memo = null) {
  const out = { food: 0, water: 0 };
  if (!base || !s || !s.alive || base.rationing || base.hungerDays > 0) return out;
  const pk = rationOf(s);
  const m = memo || {};
  const wantF = food - packFood(s);
  if (wantF > 0.25) {
    if (m.use == null) m.use = foodUse(state, base).total;
    const spare = edibleFood(base) - m.use * PACK.keepDays;
    const n = Math.min(wantF, spare);
    if (n > 0.1) {
      const items = packPick(state, base, n, { days: PACK.keepShelf });
      out.food = Object.entries(moveFood(base, pk, items, { state })).reduce((a, [k, q]) => a + unitsOf(k, q), 0);
    }
  }
  const wantW = Math.floor((water - packWater(s)) * 10) / 10;
  if (wantW > 0.2) {
    if (m.heads == null) m.heads = Math.max(1, residents(state, base.id).length);
    const heads = m.heads;
    const spare = Math.max(0, (base.stock.water || 0) - heads * PACK.keepDays);
    const n = Math.min(wantW, spare);
    if (n > 0.1) { const d = drawWater(base.stock, n); pk.supplies.water = Math.round(((pk.supplies.water || 0) + d.pure) * 100) / 100; out.water = d.pure; }
  }
  return out;
}
// Empties a pack into a base's stores (a death there; what an errand brought back over the pack). keep: days of food
// and water to leave in it. Returns { food, water } moved.
export function emptyPack(state, s, base, { keepFood = 0, keepWater = 0 } = {}) {
  const out = { food: 0, water: 0 };
  if (!s || !s.ration || !base) return out;
  const pk = s.ration;
  const over = packFood(s) - keepFood;
  if (over > EPS) {
    const items = keepFood > 0 ? packPick(state, pk, over, { days: 0 }) : null;
    out.food = Object.entries(moveFood(pk, base, items, { state })).reduce((a, [k, q]) => a + unitsOf(k, q), 0);
  }
  for (const k of ["water", RAW]) {
    const q = Math.max(0, (pk.supplies[k] || 0) - (k === "water" ? keepWater : 0));
    if (q > EPS) { base.stock[k] = Math.round(((base.stock[k] || 0) + q) * 100) / 100; pk.supplies[k] = Math.round(((pk.supplies[k] || 0) - q) * 100) / 100; out.water += q; }
  }
  return out;
}
// A death (world.js killSurvivor): at one of your bases the pack goes into its stores; elsewhere it is lost with them.
export function packOnDeath(state, s, home) {
  if (!s || !s.ration) return;
  if (home) emptyPack(state, s, home);
  delete s.ration;
}

// ---------- the menu ----------
// The food a holder can eat, best first: [{ k, f, q (clean, no eggs), left (days of shelf on its oldest clean lot) }].
// order "best": cooked meals (best tier first), then the rest soonest to spoil; "spoil": everything soonest to spoil.
// rawLast: raw meat and fish after everything else (a base that does not cook).
function menuOf(state, h, order, rawLast) {
  const st = h.stock || h.supplies;
  if (!st) return [];
  const L = lotsOf(h) ? syncLots(h, state) : null;
  const out = [];
  for (const k in st) {
    const f = FOODS[k];
    if (!f || !(st[k] > EPS)) continue;
    let q = st[k], left = f.shelf;
    if (L && L[k]) {
      q = 0; left = Infinity;
      for (const l of L[k]) if (!l.egg && l.q > EPS) { q += l.q; left = Math.min(left, l.left); }
      q = Math.min(q, st[k]);
    }
    if (q > EPS) out.push({ k, f, q, left });
  }
  const meal = (e) => (order === "best" && isMeal(e.f) ? 1 : 0);
  const raw = (e) => (rawLast && e.f.raw ? 1 : 0);
  out.sort((a, b) => raw(a) - raw(b) || meal(b) - meal(a) || (meal(a) ? (b.f.moodLift || 0) - (a.f.moodLift || 0) : 0) || a.left - b.left || (a.k < b.k ? -1 : 1));
  return out;
}
// The menu for one person: a Vegetarian's plant food first; food they ate most of on each of the last EAT.variety days
// after the rest unless it is about to spoil.
function personal(menu, s) {
  const veg = hasTrait(s, "vegetarian");
  const lg = s.food && Array.isArray(s.food.log) ? s.food.log : [];
  const tail = lg.slice(-EAT.variety);
  const tired = tail.length >= EAT.variety && tail.every((k) => k && k === tail[0]) ? tail[0] : null;
  if (!veg && !tired) return menu;
  const rank = (e) => (veg && isMeat(e.f) ? 2 : 0) + (tired === e.k && e.left > EAT.urgent ? 1 : 0);
  return menu.map((e, i) => ({ e, i, r: rank(e) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.e);
}
// Eats up to `units` days of food from holder h down a menu (its q kept current). Returns { units, items, lots }.
function eatMenu(state, h, menu, units) {
  const res = { units: 0, items: {}, lots: [] };
  let need = units;
  for (const e of menu) {
    if (need <= EPS) break;
    if (!(e.q > EPS)) continue;
    const q = Math.min(e.q, (need * 2000) / e.f.kcal);
    const t = takeItem(h, e.k, q, { state, eggs: false });
    if (!(t.q > EPS)) { e.q = 0; continue; }
    e.q -= t.q;
    const u = unitsOf(e.k, t.q);
    need -= u;
    res.units += u;
    res.items[e.k] = (res.items[e.k] || 0) + t.q;
    for (const l of t.lots) res.lots.push({ k: e.k, ...l });
  }
  return res;
}

// ---------- a base's hour ----------
// What everyone at a base eats from this hour (built when the first person eats).
function baseCtx(state, base, key) {
  const ks = hasKitchen(base) ? kitchenService(state, base) : null;
  const stretch = eatMult(state, base) * kitchenEatMult(state, base);
  const cooks = baseCooks(base);
  return { key, stretch, cooks, kitchen: !!(ks && ks.served > 0), menu: menuOf(state, base, key === "lean" || key === "short" ? "spoil" : "best", !cooks) };
}
const acc = (base) => base.eatAcc || (base.eatAcc = { units: 0, missed: 0, meals: 0, min: 0 });
// The base's day so far, taken (economy.js baseDaily at midnight): { units eaten from the stores, missed, meals, min }.
export function takeEatAcc(base) {
  const a = base.eatAcc || { units: 0, missed: 0, meals: 0, min: 0 };
  base.eatAcc = { units: 0, missed: 0, meals: 0, min: 0 };
  return a;
}
// Hourly (needs.js baseHour) for a base of yours: hunger falls, people eat (see the header). Thirst is needs.js's.
export function baseEatHour(state, base, people) {
  const h = hourOfDay(state);
  const key = rationKey(state, base);
  const use = key === "short" ? 1 : RATION_LEVELS[key].use;
  const cold = coldFactor(state);
  const hr = NEEDS.food / 24;
  let ctx = null;
  const memo = {};
  if (h === RATION_PLAN.hour && runsFood(state, base)) {
    const now = planRations(state, base, foodForecast(state, base));
    if (now) log(state, `${base.name} ${now === "lean" ? "goes on lean rations: smaller portions while food is short (it lasts a quarter longer; mood −1 a day)" : "eats normally again: the stores are good"}.`, now === "lean" ? "warn" : "info");
  }
  for (const s of people) {
    ensureNeeds(s);
    s.hunger = clamp(s.hunger - hr * cold * appetite(s) * use * (s.hunger < NEEDS.lean ? NEEDS.leanRate : 1));
    if (h === PACK.hour && s.location.kind === "base" && !awayFromStores(state, s) && (packFood(s) < PACK.food - 0.25 || packWater(s) < PACK.water - 0.2)) topUpPack(state, base, s, undefined, memo);
    const tgt = targetAt(s, key);
    const below = eatBelow(state, s, h, key, tgt, s.role);
    if (s.hunger >= below) continue;
    const wantPts = Math.max(0, tgt - s.hunger);
    const meal = mealOf(s.role, h, state);
    let got = { units: 0, items: {}, lots: [], raw: 0, from: "" };
    if (!awayFromStores(state, s)) {
      ctx = ctx || baseCtx(state, base, key);
      const r = eatAtBase(state, base, s, (wantPts / NEEDS.food) * ctx.stretch, ctx);
      const pts = (r.units / ctx.stretch) * NEEDS.food;
      s.hunger = clamp(s.hunger + pts);
      got = { ...r, from: r.units > EPS ? (ctx.kitchen ? "kitchen" : "store") : "" };
      acc(base).units += r.units;
      if (r.units > EPS) ateFromStore(state, base, r.items);
      if (packFood(s) < PACK.food * PACK.half && r.units > EPS) topUpPack(state, base, s, undefined, memo);
    }
    // Away from the stores (or the stores empty): the pack.
    const left = Math.max(0, tgt - s.hunger);
    if (left > 0.5 && packFood(s) > EPS) {
      const r = eatPack(state, s, left / NEEDS.food);
      s.hunger = clamp(s.hunger + r.units * NEEDS.food);
      for (const [k, q] of Object.entries(r.items)) got.items[k] = (got.items[k] || 0) + q;
      got.lots.push(...r.lots);
      got.units += r.units;
      got.raw += r.raw;
      got.from = got.from || "pack";
    }
    const miss = Math.max(0, tgt - s.hunger);
    if (miss > 0.5 && !awayFromStores(state, s)) acc(base).missed += (miss / NEEDS.food) * (ctx ? ctx.stretch : 1);
    if (got.units > EPS) {
      const min = breakMin(got.units, !!meal);
      acc(base).meals++;
      acc(base).min += min;
      noteEat(state, s, got, { meal, min, key, base, cooked: !!(ctx && ctx.cooks) && got.from !== "pack" });
      if (meal === "lunch") s.mood = Math.min(100, (s.mood || 0) + EAT.lunchMood); // the lunch break's lift
    }
  }
}
// At the stores: the menu, then (nothing clean left) the crops and forage with the worm's eggs, then the meat with
// eggs (eaten uncooked: base.rawCropEaten / rawForageEaten / rawEaten for worm.js, as storage.js eatFromStore).
function eatAtBase(state, base, s, units, ctx) {
  const r = eatMenu(state, base, personal(ctx.menu, s), units);
  r.raw = ctx.cooks ? 0 : Object.entries(r.items).reduce((a, [k, q]) => a + (FOODS[k].raw ? unitsOf(k, q) : 0), 0);
  let need = units - r.units;
  if (need > EPS) {
    const veg = takeFood(base, need, { clean: false, only: (k, f) => f.group !== "rawmeat" && f.group !== "rawfish", state });
    if (veg.units > EPS) {
      base.rawCropEaten = (base.rawCropEaten || 0) + veg.eggs.crop;
      base.rawForageEaten = (base.rawForageEaten || 0) + veg.eggs.forage;
      add(r, veg); r.raw += veg.eggs.all; need -= veg.units;
    }
  }
  if (need > EPS) {
    const meat = takeFood(base, need, { clean: false, state });
    if (meat.units > EPS) { base.rawEaten = (base.rawEaten || 0) + meat.eggs.all; add(r, meat); r.raw += meat.eggs.all + (ctx.cooks ? 0 : meat.raw); }
  }
  return r;
}
const add = (r, t) => { r.units += t.units; for (const [k, q] of Object.entries(t.items)) r.items[k] = (r.items[k] || 0) + q; for (const l of t.lots || []) r.lots.push(l); };
// From the pack (soonest to spoil first; packs hold no food with eggs). Returns { units, items, lots, raw }.
export function eatPack(state, s, units) {
  if (!s.ration || !(units > EPS)) return { units: 0, items: {}, lots: [], raw: 0 };
  const r = eatMenu(state, s.ration, personal(menuOf(state, s.ration, "spoil", false), s), units);
  r.raw = Object.entries(r.items).reduce((a, [k, q]) => a + (FOODS[k].raw ? unitsOf(k, q) : 0), 0);
  return r;
}
// Drinks up to `units` water from the pack (purified first). Returns the water drunk.
export function drinkPack(s, units) {
  if (!s.ration || !(units > EPS)) return 0;
  return drawWater(s.ration.supplies, units).got;
}
// Minutes a meal takes: EAT.min.base + EAT.min.per × days of food eaten (a mealtime meal at least EAT.min.meal).
export const breakMin = (units, meal) => Math.round(Math.max(meal ? EAT.min.meal : 0, Math.min(EAT.min.max, EAT.min.base + EAT.min.per * units)));

// ---------- what they ate: the record and the thoughts ----------
// s.food = { d (the day of `u`), u: { key: days today }, log: [the key they ate most of, a day, the last EAT.log days] };
// s.meal = { h (the hour), min, k (most of it), from ("kitchen" | "store" | "pack" | "team"), meal ("breakfast" …) }.
// ctx: { meal, min, key (the ration level), base, team, fire (a team at a lit camp fire) }.
export function noteEat(state, s, got, ctx = {}) {
  const fd = s.food || (s.food = { d: workDay(state.hour), u: {}, log: [] });
  const d = workDay(state.hour);
  if (fd.d !== d) rollDay(state, s, d);
  let main = null, mu = 0, best = null;
  let meat = 0, human = 0, hot = got.from === "kitchen"; // the Kitchen's hot service
  for (const [k, q] of Object.entries(got.items)) {
    const f = FOODS[k], u = unitsOf(k, q);
    fd.u[k] = r3((fd.u[k] || 0) + u);
    if (u > mu) { mu = u; main = k; }
    if (u >= EAT.rawMin && (isMeal(f) || (f.raw && ctx.cooked))) hot = true; // a cooked meal, or raw meat cooked here
    if (isMeal(f) && (!best || (f.moodLift || 0) > (best.moodLift || 0))) best = f;
    if (f.diet === "human") human += u;
    else if (isMeat(f)) meat += u;
  }
  if (hot || fd.hot == null) fd.hot = d; // the day they last ate hot food (no record yet: counted from today)
  s.meal = { h: state.hour, min: ctx.min || breakMin(got.units, !!ctx.meal), k: main, from: got.from || (ctx.team ? "team" : "store"), ...(ctx.meal ? { meal: ctx.meal } : {}) };
  // Thoughts.
  const raw = got.raw || 0;
  if (raw >= EAT.rawMin) {
    thought(state, s, "raw");
    const p = traitFx(s, "picky", "raw");
    if (p) thought(state, s, "picky", { v: -p, label: "Picky eater: raw food" });
  }
  if (best) {
    const lift = (best.moodLift || 0) * MEAL_MOOD;
    if (lift > 0) thought(state, s, "meal", { v: lift, label: `Ate ${MEAL_NAMES[best.tier] || "a good meal"}${best.key === "f_stew" ? " (stew)" : ""}` });
    const pk = best.tier === "simple" ? -traitFx(s, "picky", "simple") : best.tier === "fine" || best.tier === "lavish" ? traitFx(s, "picky", "fine") * (best.tier === "lavish" ? 1.5 : 1) : 0;
    if (pk) thought(state, s, "picky", { v: Math.round(pk), label: pk > 0 ? `Picky eater: ${MEAL_NAMES[best.tier]}` : "Picky eater: a simple meal" });
  }
  if (meat >= EAT.dietMin && hasTrait(s, "vegetarian")) thought(state, s, "veg", { v: -traitFx(s, "vegetarian", "meat") });
  if (human >= EAT.dietMin) {
    if (hasTrait(s, "cannibal")) thought(state, s, "cannibal", { v: traitFx(s, "cannibal", "lift") });
    else thought(state, s, "human");
  }
  if (ctx.key === "feast") thought(state, s, "feast");
  // Food poisoning (cooking.js, the eating contract): the lots this person ate, rolled for them alone (a cooked lot's pz:
  // its cook's Cooking, the kitchen's dirt; raw meat or fish eaten uncooked 5%; egg lots are worm.js's). The illness
  // ("poisoning", health.js) carries its own mood and sends them to bed (sickrest.js).
  if (got.lots && got.lots.length) { const hit = poisonRoll(state, [s], got.lots, { cooked: !!ctx.cooked, where: ctx.base ? ` at ${ctx.base.name}` : "" }); if (ctx.base) notePoisoned(state, ctx.base, hit); }
}
const r3 = (v) => Math.round(v * 1000) / 1000;
// The day closes: the food they ate most of goes on the log; the same food EAT.sameDays days running: "Same food again".
function rollDay(state, s, nd) {
  const fd = s.food;
  const keys = Object.entries(fd.u || {});
  if (keys.length) {
    keys.sort((a, b) => b[1] - a[1]);
    const all = keys.reduce((a, x) => a + x[1], 0);
    fd.log = [...(fd.log || []), keys[0][1] >= EAT.sameShare * all ? keys[0][0] : ""].slice(-EAT.log); // "" a mixed day
    const tail = fd.log.slice(-EAT.sameDays);
    if (tail.length >= EAT.sameDays && tail[0] && tail.every((k) => k === tail[0])) thought(state, s, "same", { label: `Same food again (${FOODS[tail[0]] ? FOODS[tail[0]].name.toLowerCase() : tail[0]})` });
    // No hot food: EAT.cold days since the last cooked meal (fd.hot), a thought a day while it lasts.
    const cold = fd.hot != null ? nd - 1 - fd.hot : 0; // whole days since the last day with hot food
    if (cold >= EAT.cold[0]) thought(state, s, "cold", { v: cold >= EAT.cold[1] ? EAT.coldV[1] : EAT.coldV[0], label: `No hot food in ${cold} days` });
  }
  fd.u = {};
  fd.d = nd;
}
// s.thoughts = [{ id, label, v, until (the hour it runs out) }]. A thought gives its mood once, when it starts; the same
// id cannot start again until it has run out (not stacking). opts: v, label, hours.
export function thought(state, s, id, opts = {}) {
  const T = THOUGHTS[id];
  if (!T || !s || !s.alive) return false;
  const v = opts.v != null ? opts.v : T.v;
  if (!v) return false;
  const list = (s.thoughts || []).filter((t) => t.until > state.hour);
  if (list.some((t) => t.id === id)) { s.thoughts = list; return false; }
  const label = opts.label || T.label;
  list.push({ id, label, v, until: state.hour + (opts.hours || T.hours) });
  s.thoughts = list;
  addMood(state, s, v, label);
  return true;
}
// Someone's thoughts still running: [{ id, label, v, hoursLeft }].
export const thoughtsOf = (state, s) => ((s && s.thoughts) || []).filter((t) => t.until > state.hour).map((t) => ({ ...t, hoursLeft: t.until - state.hour }));

// ---------- daily ----------
// Midnight (needs.js needsHour): every living person's day closes (the same-food log), old thoughts go, packs age (as
// a team's carried food: hunting.js carriedFactor by the day's mean), the dead lose their pack.
export function eatingDaily(state) {
  const temp = Weather.dayMeanTemp ? Weather.dayMeanTemp(state) : 12;
  const fac = carriedFactor(temp);
  for (const s of state.survivors) {
    if (!s.alive) { if (s.ration) delete s.ration; continue; }
    if (s.food && s.food.d !== workDay(state.hour + 1)) rollDay(state, s, workDay(state.hour + 1));
    if (s.thoughts) { s.thoughts = s.thoughts.filter((t) => t.until > state.hour); if (!s.thoughts.length) delete s.thoughts; }
    if (s.ration && foodIn(s.ration.supplies) > EPS) ageLots(s.ration, 1, () => fac, state);
  }
}

// ---------- the governor and the stewards: the ration level ----------
// Lean when food runs short (under RATION_PLAN.lean days of food at the normal rate and the plots will not cover it),
// back to normal over RATION_PLAN.normal days or with the plots ahead; a feast for the festival (festival.js). Daily
// (autopilot.js / steward.js, the Farming & food area). Returns the level set ("" when unchanged).
export const RATION_PLAN = { lean: 15, normal: 25, hour: 4 };
// The governor (state.autopilot) or a steward with Farming & food on runs this base's food.
export const runsFood = (state, base) => !!state.autopilot || !!(base.steward && base.steward.on && (!base.steward.areas || base.steward.areas.food !== false));
export function planRations(state, base, forecast = 0) {
  if (!base || (base.owner != null && base.owner !== "player") || rationKey(state, base) === "feast") return "";
  const cur = RATION_LEVELS[base.rationLevel] ? base.rationLevel : "normal";
  const now = foodUse(state, base).total;
  const use = now / Math.max(0.01, RATION_LEVELS[cur].use); // at the normal rate
  if (!(use > 0)) return "";
  const days = edibleFood(base) / use;
  const fNorm = forecast - (use - now); // the plots against eating normally (no flip-flop: lean itself makes it look fine)
  let want = cur;
  if (cur !== "lean" && days < RATION_PLAN.lean && fNorm < 0) want = "lean";
  else if (cur === "lean" && (days > RATION_PLAN.normal || fNorm > 0)) want = "normal";
  if (want === cur) return "";
  base.rationLevel = want;
  return want;
}
// The player's (or the governor's) setting: "normal" / "lean", or "feast" for today (feastDay). Returns a line.
export function setRationLevel(state, base, key) {
  if (!base || !RATION_LEVELS[key]) return "";
  if (key === "feast") { base.feastDay = dayOf(state.hour); return `${base.name} holds a feast today: everyone eats their fill and half as much again.`; }
  base.rationLevel = key;
  if (base.feastDay === dayOf(state.hour)) delete base.feastDay;
  return `${base.name} eats ${key === "lean" ? "lean (smaller portions: food lasts a quarter longer, mood −1 a day)" : "normally again"}.`;
}

// ---------- the AI groups (coarse) ----------
// A group's level today: lean under GROUP_EAT.leanBelow days of food a head (back over GROUP_EAT.normalOver), a feast
// on the festival day (feast: the caller's festival test) when it has GROUP_EAT.feastOver days a head.
export const GROUP_EAT = { leanBelow: 8, normalOver: 14, feastOver: 20, lean: 0.25, feastGlow: 3, feast: -0.5, monotony: 0.2, kinds: 3, cold: 0.15 }; // cold: no hot food (no cooked meals in store: their kitchens are out or missing)
export function groupRation(state, f, feast = false) {
  const pop = Math.max(1, f.pop || 1);
  const days = foodIn(f.stock) / pop;
  if (feast && days >= GROUP_EAT.feastOver) return "feast";
  if (f.rationLevel === "lean") return days > GROUP_EAT.normalOver ? "normal" : "lean";
  return days < GROUP_EAT.leanBelow ? "lean" : "normal";
}
// Desertion pressure from their food (groupcare.js desertPressure): lean +, a recent feast −, a store of fewer than
// GROUP_EAT.kinds kinds of food (a day a head of each) +.
export function groupDietPressure(state, f) {
  let p = 0;
  if (f.rationLevel === "lean") p += GROUP_EAT.lean;
  if (f.feastUntil != null && f.feastUntil >= dayOf(state.hour)) p += GROUP_EAT.feast;
  const pop = Math.max(1, f.pop || 1);
  let kinds = 0;
  for (const k in f.stock || {}) if (FOODS[k] && unitsOf(k, f.stock[k]) >= pop * 0.5) kinds++;
  if (kinds < GROUP_EAT.kinds && foodIn(f.stock) > 0) p += GROUP_EAT.monotony;
  // No hot food (EAT.cold, yours): a group with no cooked meals in store (cooking.js groupCookDaily makes them while its
  // kitchens are lit) eats cold, and its people mind it.
  if (foodIn(f.stock) > 0 && !Object.keys(f.stock).some((k) => FOODS[k] && isMeal(FOODS[k]) && f.stock[k] > 0)) p += GROUP_EAT.cold;
  return p;
}
// A group's party heads (coarse: its strength by the group's arms), for the rations it carries.
export const aiPartyHeads = (f, strength, arms = 1) => Math.max(1, Math.min(Math.max(1, f.pop || 1), Math.round((strength || 1) / Math.max(0.5, arms))));

// ---------- text ----------
export const EATING_HELP = `Everyone eats by themselves now: at breakfast (06:00; 10:00 for hunters and fishers, after the dawn trip), lunch (12:00, or the hour set in the Work tab) and dinner (20:00) when they are a little under their own target, and between meals when they get hungry (below ${EAT.snack}; at night below ${EAT.night}), until they are ${EAT.band[0]}–${EAT.band[1]}% full (each person has their own target; a Glutton eats to 100). A meal is a break of ${EAT.min.meal}–${EAT.min.max} minutes ("Eating breakfast (25 min)" in the activity): the jobs that run round the clock stop for the meal hours. Lunch is an hour's break from all work (the guards stay on the walls), with a small lift to mood. They eat the best cooked meals first (lavish, fine, stew, simple), then whatever would spoil soonest; raw meat last where nothing cooks; a Vegetarian plant food first; and anyone tired of the same food two days running picks something else while it keeps. A day of food is ${"2000"} kcal; the hunger gauge shows the target band.<br><br><b>Carried rations.</b> Everyone carries a pack of about ${PACK.food} days of food that keeps and ${PACK.water} purified water (it weighs 2–3 kg). At a base they eat from the stores and the pack is topped up every morning (and when they eat with it under half), as long as the base is not rationing and keeps ${PACK.keepDays} days of food and water beyond it. Away from the stores (a job trip, a field work, a lookout's shift, an errand) they eat and drink from it (a job trip sets out with at least ${PACK.trip} day of food in it: lunch is eaten out there); a team's packs count toward its supplies (the base packs that much less) and are eaten after the team's shared food. Out of food away from the stores, hunger bites as before.<br><br><b>Ration levels</b> (a base's Overview, Needs): <i>Normal</i>; <i>Lean</i>: everyone eats to about 75% and the body gets by on 80% of a ration: food lasts a quarter longer, mood −1 a day, nobody hungry enough to work worse; <i>Feast</i>: today only, everyone eats their fill and half as much again (×1.5 the day's food), "A feast" mood +6. Under a week of food a base goes on short rations by itself (60%: eats to 48, mood −3 a day). The governor and a steward (Farming & food) go lean under ${RATION_PLAN.lean} days of food when the plots will not cover it, back over ${RATION_PLAN.normal}; the harvest festival is a feast. The groups do the same.<br><br><b>Food and mood</b> (each a thought that lasts, not a daily factor; the same one cannot come again until it has run out): Ate raw food ${THOUGHTS.raw.v} (2 days; raw meat or fish where nothing cooks it, or food with the worm's eggs) · a stew +${MEAL_MOOD}, a fine meal +${2 * MEAL_MOOD}, a lavish meal +${4 * MEAL_MOOD} (3 days) · Same food again ${THOUGHTS.same.v} (2 days) when the same food was most of what they ate ${EAT.sameDays} days running · No hot food in days ${EAT.coldV[0]} a day after ${EAT.cold[0]} days without a cooked meal (the Kitchen's hot service, or raw meat cooked where it is eaten, counts), ${EAT.coldV[1]} a day after ${EAT.cold[1]}: a camp fire with firewood and a camp cook pot, a cook fire or a Kitchen fixes it · A feast +${THOUGHTS.feast.v}. Picky Eaters mind simple meals and raw food more and like fine and lavish meals more; Vegetarians lose ${"6"} mood for meat, fish, eggs, milk, honey or a mixed meal; a Cannibal would enjoy human meat, but the game has none: the dead carry the worm.`;
export function packText(s) {
  const f = packFood(s), w = packWater(s);
  return `${r1(f)} day${r1(f) === 1 ? "" : "s"} of food and ${r1(w)} water (${r1(packKg(s))} kg)`;
}
