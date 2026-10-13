// Needs: every survivor has a Hunger, a Thirst and a Mood gauge (0-100; mood is morale.js / relations.js's). Hunger and
// thirst fall by the hour and are filled by eating and drinking from the group's inventory: on a team, its packed
// supplies and what it found (food by type, foods.js: the lot nearest to spoiling first, packed or found, whatever it
// is; food with the worm's eggs last; water packed then found: foraging, hunting and looting fill these); at a base,
// the base's stores; on a personal errand, the food and water they took along.
// A ration is DAY_KCAL (2000 kcal): an item fills hunger by its kcal (a can of beans a fifth of a day, an MRE 0.6).
//
// The numbers (NEEDS):
//   hunger  falls NEEDS.food (40) a day at one ration a day: their load band's ration multiplier on the move (load.js
//           personRation), ×the cold (weather.foodNeedFactor: 1.1 below 0°C, 1.2 below −8°C) for a team without a lit
//           camp fire (fieldheat.js teamFire). Below NEEDS.lean (50) the body gets by on less (×0.6): what short rations
//           live on (economy.RATION). A ration fills NEEDS.food points.
//   thirst  falls NEEDS.water (60) a day at one water a day × the day's thirst (weather.thirstFactor: summer, a heat
//           wave), the load band's multiplier on the move. A water fills NEEDS.water points. Thirst runs out faster
//           than hunger: a full gauge lasts under two days.
// So one ration and one water a day keep a person level, the same daily totals as before (parties.js packing, the
// planners' estimates, upkeep.js at a base).
//
// When they eat (a team's ration setting, p.ration): full: below 70 they eat up to 100; short: below 40 up to 48 (the
// body's slow-down makes that about 60% of a ration a day: food lasts longer, people are Hungry: work −10%); none:
// nobody eats (water is never rationed: thirst kills too fast). Who eats first when there is not enough (p.share):
// "hurt" (default: the hurt first, then the hungriest) or "even" (everyone gets the same share of what there is).
// At a base everyone eats by the hour, each to their own target (80–100% full) at the mealtimes (eating.js
// baseEatHour: meal breaks, what they eat, the base's ration level; economy.js counts the day at midnight). Water is
// still drunk from the store once a day (economy.js baseDaily): the thirst gauge follows the base's share: watered in
// full, it holds and climbs NEEDS.recover an hour; with no water it falls. Under rationing the base's share
// (base.share) decides who gets watered first (the hurt, then the workers, then those resting).
// Everyone also carries a pack (eating.js PACK: about a day and a half of food that keeps and of purified water):
// away from the stores (a job trip, a field work, an errand) they eat from it; on a team, after the team's shared
// supplies are gone.
//
// Effects (needsWork, needsAim): Hunger below 50 cuts work (×0.8 at 25, ×0.6 empty) and aim (up to −10); thirst
// below 50 more (×0.75 at 25, ×0.5 empty; aim up to −15). Away from a base an empty gauge costs health (hunger 0.6 an
// hour, thirst 1.0, as running out did before) and below 25 mood (hunger −0.08, thirst −0.12 an hour). At a base the
// economy's hunger and thirst days do the damage (economy.js starve, thirst). The team counts as out of food (p.noFood:
// no camp healing, illness risk) when someone's hunger is empty, or someone wants to eat and nothing is left.
//
// Starving and parched (STARVE, starvingDaily): every morning someone is starving (living at a base that is out of food
// today, economy.js hungerDays; away from a base, on a team or an errand, hunger below NEEDS.starving, 15) counts a day
// starving (s.starveDays) and loses STARVE.food.step mood × those days (−2, −4, −6 … up to −20 a day); parched the same
// for thirst (a base out of water, or thirst below 15 away from one: s.parchDays, −3, −6, −9 … up to −24). At a base the
// stores decide, not the gauge: short rations feed some in full and others not at all for the day (splitShare), and
// that costs the base's −3 a day, not this. A morning fed and watered again resets it. This is a base's mood for being out
// of food or water (it replaced the flat −10 and −8 a day); left alone it ends at rock bottom: a mental break
// (mentalbreaks.js), walking out (morale.js), or death from hunger or thirst. On top of the hourly mood below 25.
//
// Mood items: at NEEDS.treatHour each team member below COMFORT.lowMood (35) uses a treat from the team's inventory
// (their own pockets and pack first, then a teammate's, then the cargo): chocolate, candy, coffee, cigarettes, tobacco;
// drink (wine, vodka, whiskey) only while the team rests (a hangover follows); valuables (candy, tobacco, wine, whiskey)
// only below NEEDS.valuableMood (20). Kept comforts (cards, a harmonica, a guitar, photos) are never used up
// (comforts.js comfortLines). The player can hand one out by hand (useTreat: the survivor screen and the team panel).
import { appetite } from "./traits.js"; // Glutton
import { log, hurt, hourOfDay, residents, baseById, hub } from "./world.js";
import { partyMembers, partyTile, teamName, onTheMove } from "./parties.js";
import { sweeping } from "./survey.js";
import { personRation } from "./load.js";
import * as Weather from "./weather.js";
import { foodIn, takeFood as takeFoodFrom, packPick, moveFood, eggFood, MEAL_FV, MEALS_A_DAY } from "./foods.js"; // food by type: days of food, the soonest to spoil first
import { GEAR } from "./data.js";
import { COMFORT, applyUse } from "./comforts.js";
import { addMood } from "./relations.js"; // the starving days show in the mood breakdown
import { packOf, removeAt, useOneAt, personPlace, placeOfLoc } from "./inventory.js";
import { teamFire } from "./fieldheat.js";
import { heatUse, HEAT } from "./upkeep.js";
import { shelterFire } from "./woodcutting.js";
import { econStats } from "./farming.js";
import { conditionsOf } from "./health.js";
import { eatRawCargo, eatRawForageCargo, drinkHour } from "./worm.js";
import { teamPoisonHour } from "./cooking.js"; // wave 2 cooking: food poisoning from what the team ate this hour
import { teamWaterIn, takeTeamWater, drawWater, waterIn, RAW } from "./water.js"; // purified and un-purified water
import { baseEatHour, eatingDaily, eatTarget, noteEat, eatPack, drinkPack, packFood, packWater, rationOf, emptyPack, PACK, teamMeal } from "./eating.js";
import { mealOf } from "./meals.js"; // a team eats at breakfast, lunch and dinner too (eating.js teamMeal: a shared pot) // meal breaks and the carried rations (wave 2)

export const NEEDS = {
  max: 100, food: 40, water: 60, lean: 50, leanRate: 0.6, ration: 0.6,
  eat: { full: [70, 100], short: [40, 48], none: null }, drink: [70, 100],
  recover: 3,
  hurtFood: 0.6, hurtWater: 1.0,
  moodLow: 25, moodHunger: 0.08, moodThirst: 0.12, coldMood: 0.04,
  low: 25, starving: 15, warnBack: 40,
  treatHour: 20, valuableMood: 20,
};
// Mood a day for each morning starving (hunger) or parched (thirst) in a row: step × days, up to max (starvingDaily).
// warn: the day the log says it is getting serious.
export const STARVE = { food: { step: 2, max: 20 }, water: { step: 3, max: 24 }, warn: 3 };
export const starveMood = (days, kind = "food") => (days > 0 ? Math.min(STARVE[kind].max, STARVE[kind].step * days) : 0);
export const RATIONS = {
  full: { name: "Full", desc: "Eat below 70 hunger, up to full: a ration a person a day." },
  short: { name: "Short", desc: "Eat only below 40 hunger: about 60% of a ration a day once they are lean. Food lasts longer; people are Hungry (work −10%, a little aim)." },
  none: { name: "None", desc: "Nobody eats: the food is kept (to carry home, or for later). Hunger runs out in about three days, then it costs health. Water is still drunk." },
};
export const SHARES = {
  hurt: { name: "The hurt first", desc: "When there is not enough, the hurt eat and drink first (worst first), then the hungriest." },
  even: { name: "Evenly", desc: "When there is not enough, everyone gets the same share of what there is." },
};
// Work and aim by a gauge (straight lines between the points).
export const NEED_WORK = { hunger: [[0, 0.6], [25, 0.8], [50, 1]], thirst: [[0, 0.5], [25, 0.75], [50, 1]] };
export const NEED_AIM = { hunger: 10, thirst: 15, from: 50 };
// Without heating fuel (a base below 0°C, upkeep.js heatUse): mood and health a day × how short it was; illness risk as
// outdoors (health.js baseOnsets reads base.cold).
export const COLD = { mood: 4, hp: 2 };
// Treats a team uses by itself, gentlest first.
export const TREAT_ORDER = ["chocolate", "candy", "instcoffee", "smokes", "tobacco", "wine", "vodka", "whiskey"];
const DRINKS = new Set(["wine", "vodka", "whiskey"]);
const SMOKES = new Set(["smokes", "tobacco"]);

const clamp = (v) => Math.max(0, Math.min(NEEDS.max, v));
const first = (s) => s.name.split(" ")[0];
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- the gauges ----------
export const hungerOf = (s) => (s && Number.isFinite(s.hunger) ? s.hunger : NEEDS.max);
export const thirstOf = (s) => (s && Number.isFinite(s.thirst) ? s.thirst : NEEDS.max);
// Survivors made before the gauges (old saves, new recruits) start full.
export function ensureNeeds(s) {
  if (!s) return s;
  if (!Number.isFinite(s.hunger)) s.hunger = NEEDS.max;
  if (!Number.isFinite(s.thirst)) s.thirst = NEEDS.max;
  return s;
}
const curve = (pts, v) => {
  if (v <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (v <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0); }
  return pts[pts.length - 1][1];
};
// Work from hunger and thirst together (1 when both are at 50 or more). morale.js moodWork multiplies it in.
export const needsWork = (s) => Math.round(curve(NEED_WORK.hunger, hungerOf(s)) * curve(NEED_WORK.thirst, thirstOf(s)) * 1000) / 1000;
// Aim lost in battle (combat.js), 0 down to −25.
export const needsAim = (s) => -Math.round(Math.max(0, NEED_AIM.from - hungerOf(s)) / NEED_AIM.from * NEED_AIM.hunger + Math.max(0, NEED_AIM.from - thirstOf(s)) / NEED_AIM.from * NEED_AIM.thirst);
// A word for a gauge.
export function hungerWord(v) { return v <= 0 ? "Starving" : v < NEEDS.starving ? "Starving" : v < NEEDS.low ? "Very hungry" : v < NEEDS.lean ? "Hungry" : v < 75 ? "Peckish" : "Fed"; }
export function thirstWord(v) { return v <= 0 ? "Dehydrated" : v < NEEDS.starving ? "Parched" : v < NEEDS.low ? "Very thirsty" : v < NEEDS.lean ? "Thirsty" : v < 75 ? "Dry" : "Watered"; }

// ---------- the team's inventory ----------
// Food a team can eat (days of food: packed and found, every kind) and water. Their own packs are not in it
// (eating.js: eaten after the team's supplies; teamPackFood).
export const teamFood = (p) => foodIn(p.supplies) + foodIn(p.cargo && p.cargo.supplies);
// Water: purified and un-purified together (water.js; the thirst gauge counts both).
export const teamWater = (p) => teamWaterIn(p);
// Takes up to `want` days of food: the lot nearest to spoiling first, packed or found (bread before cans, raw meat
// before jerky). Food with the worm's eggs (worm.js) is left: it is eaten last, raw (teamNeedsHour), unless a camp fire
// cooks it. Returns the days of food eaten.
export function takeFood(p, want) {
  if (!(want > 0)) return 0;
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  const got = takeFoodFrom([p, p.cargo], want, { eggs: false });
  if (got.lots.length) (p.ateLots || (p.ateLots = [])).push(...got.lots); // cooking.js teamPoisonHour: the hour's lots (food poisoning: the eating contract)
  return got.units;
}
// Takes up to `want` water: purified first (packed, then found), then un-purified (packed, then found). p.rawDrunk adds
// up the un-purified share for worm.js drinkHour.
export function takeWater(p, want) {
  if (!(want > 0)) return 0;
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  const d = takeTeamWater(p, want);
  if (d.raw > 0) p.rawDrunk = (p.rawDrunk || 0) + d.raw;
  return d.got;
}

// Who eats first when there is not enough: the hurt (worst first), then the lowest gauge.
const hurtNow = (s) => s.health < 70 || !!s.woundInfected || conditionsOf(s).length > 0;
function order(list, key, share) {
  if (share === "even") return list;
  return [...list].sort((a, b) => (hurtNow(b.s) - hurtNow(a.s)) || (hurtNow(a.s) ? a.s.health - b.s.health : 0) || (a.s[key] - b.s[key]) || (a.s.id - b.s.id));
}
// Everyone under `at` eats or drinks up to `to` from the team's stock (take). Returns true when someone wanted more
// than there was.
// rule: [at, to] (to may be a function of the person: their own target, eating.js eatTarget); take(q, s).
function feed(members, key, rule, pts, have, take, share) {
  if (!rule) return false;
  const [at, to0] = rule;
  const toOf = typeof to0 === "function" ? to0 : () => to0;
  const want = members.filter((s) => s[key] < at).map((s) => ({ s, w: Math.max(0, toOf(s) - s[key]) / pts })).filter((x) => x.w > 1e-9);
  if (!want.length) return false;
  const total = want.reduce((a, x) => a + x.w, 0);
  let left = have;
  if (left >= total - 1e-9) {
    for (const x of want) { const q = take(x.w, x.s); x.s[key] = clamp(x.s[key] + q * pts); }
    return false;
  }
  if (share === "even") { // the same amount each (no more than they want: the rest goes round the others)
    const list = [...want].sort((a, b) => a.w - b.w);
    for (let i = 0; i < list.length; i++) { const x = list[i]; const q = take(Math.min(x.w, left / (list.length - i)), x.s); left -= q; x.s[key] = clamp(x.s[key] + q * pts); }
    return true;
  }
  for (const x of order(want, key, share)) {
    if (left <= 1e-9) break;
    const q = take(Math.min(x.w, left), x.s);
    left -= q;
    x.s[key] = clamp(x.s[key] + q * pts);
  }
  return true;
}

// The cold for a team: the day's appetite (×1.1 / ×1.2 below 0 / −8°C) unless it sits at a lit camp fire.
export function teamCold(state, p) {
  const f = Weather.foodNeedFactor ? Weather.foodNeedFactor(state) : 1;
  if (f <= 1) return 1;
  return teamFire(state, p) === true ? 1 : f;
}

// ---------- hourly ----------
// A team's hour (parties.js playerPartyHour, in place of the old pooled rations): gauges fall, people eat and drink
// from the team's inventory, empty gauges hurt. Sets p.noFood / p.noWater.
export function teamNeedsHour(state, p, members) {
  const moving = onTheMove(p) || sweeping(p); // a survey walks about (survey.js)
  const tf = Weather.thirstAt ? Weather.thirstAt(state) : 1;
  const cold = teamCold(state, p);
  for (const s of members) {
    ensureNeeds(s);
    const r = personRation(p.burden, s, p.vehicle, moving);
    s.hunger = clamp(s.hunger - (NEEDS.food / 24) * r * cold * (s.hunger < NEEDS.lean ? NEEDS.leanRate : 1) * appetite(s)); // a Glutton (traits.js)
    s.thirst = clamp(s.thirst - (NEEDS.water / 24) * r * tf);
    // health.js frailty: hours marched today and their load (the ration multiplier), not riding in a car; reset nightly.
    if (moving && !(p.vehicle && p.vehicle.type !== "bike")) { s.marchHours = (s.marchHours || 0) + 1; s.marchLoad = (s.marchLoad || 0) + r; }
  }
  const share = SHARES[p.share] ? p.share : "hurt";
  const rule0 = Object.prototype.hasOwnProperty.call(NEEDS.eat, p.ration) ? NEEDS.eat[p.ration] : NEEDS.eat.full;
  // Full rations: up to each one's own target (eating.js eatTarget: 80–100), not 100 for all.
  const rule = rule0 && p.ration !== "short" ? [rule0[0], (s) => Math.min(rule0[1], eatTarget(s))] : rule0;
  const e1 = eggFood(p), e2 = eggFood(p.cargo); // worm.js: game, crops and forage with eggs, eaten last (the forage before the meat)
  const raw = e1.meat + e2.meat, rawVeg = e1.crop + e1.forage + e2.crop + e2.forage;
  // What each one ate (eating.js noteEat: the thoughts, the same-food log): the team's shared food, by the person.
  const ate = new Map();
  const note = (s2, t, rawU = 0) => {
    if (!s2 || !(t.units > 0)) return;
    const a = ate.get(s2) || { units: 0, items: {}, lots: [], raw: 0, from: t.from || "team" };
    a.units += t.units; a.raw += rawU;
    for (const [k, q] of Object.entries(t.items || {})) a.items[k] = (a.items[k] || 0) + q;
    for (const l of t.lots || []) a.lots.push(l); // cooking.js poisonRoll: the lots this person ate (their cook's pz)
    ate.set(s2, a);
  };
  // Raw game is cooked at a lit camp fire and at a stop (the team at rest: a cooking fire for the meal); on the move they
  // eat what needs no cooking first and the raw meat only when nothing else is left ("Ate raw food", eating.js).
  const fire = teamFire(state, p) === true || !moving;
  const cargo = p.cargo || (p.cargo = { supplies: {}, gear: [] });
  const takeShared = (q, s2) => {
    let t = takeFoodFrom([p, cargo], q, { eggs: false, only: fire ? null : (k, f) => !f.raw });
    if (!fire && t.units < q - 1e-9) { const t2 = takeFoodFrom([p, cargo], q - t.units, { eggs: false }); t = { ...t2, units: t.units + t2.units, raw: t2.raw, items: { ...t.items, ...Object.fromEntries(Object.entries(t2.items).map(([k, v]) => [k, v + (t.items[k] || 0)])) } }; }
    note(s2, t, fire ? 0 : t.raw);
    return t.units;
  };
  // Breakfast, lunch and dinner: one pot for the team, at least a meal's food value each (eating.js teamMeal: the
  // closest fit, cans shared); what the shared food did not cover comes out of each one's own pack. Between meals,
  // the rule below as before (they eat when hungry).
  if (rule && mealOf(null, state.hour, state)) {
    const toOf = typeof rule[1] === "function" ? rule[1] : () => rule[1];
    const first = share === "even" ? null : (xs) => order(xs, "hunger", share); // short of food: the hurt first
    for (const [s2, g] of teamMeal(state, p, members, { fire, short: p.ration === "short", toOf, first })) {
      note(s2, { ...g, from: "team" }, g.raw);
      if (g.short > 1e-6 && packFood(s2) > 1e-6) {
        const t = eatPack(state, s2, g.short, true);
        s2.hunger = clamp(s2.hunger + t.units * NEEDS.food);
        note(s2, { ...t, from: "pack" }, t.raw);
      }
    }
  }
  let shortFood = feed(members, "hunger", rule, NEEDS.food, teamFood(p) - raw - rawVeg, takeShared, share);
  if (shortFood && rawVeg > 0) shortFood = feed(members, "hunger", rule, NEEDS.food, rawVeg, (q, s2) => { const u = eatRawForageCargo(state, p, members, q); note(s2, { units: u, items: {} }, fire ? 0 : u); return u; }, share);
  if (shortFood && raw > 0) shortFood = feed(members, "hunger", rule, NEEDS.food, raw, (q, s2) => { const u = eatRawCargo(state, p, members, q); note(s2, { units: u, items: {} }, fire ? 0 : u); return u; }, share);
  // The team's food gone: each eats from their own pack (eating.js).
  if (shortFood && rule) {
    const [at, to] = rule;
    for (const s2 of members) {
      if (!(s2.hunger < at) || !(packFood(s2) > 1e-6)) continue;
      const t = eatPack(state, s2, Math.max(0, (typeof to === "function" ? to(s2) : to) - s2.hunger) / NEEDS.food);
      s2.hunger = clamp(s2.hunger + t.units * NEEDS.food);
      note(s2, { ...t, from: "pack" }, t.raw);
    }
  }
  for (const [s2, a] of ate) if (a.units > 1e-6) noteEat(state, s2, a, { team: true, cooked: fire });
  teamPoisonHour(state, p, members); // cooking.js: lots another module took through takeFood this hour (p.ateLots; the meals above roll per person in eating.js noteEat)
  const water0 = teamWater(p);
  p.rawDrunk = 0;
  const shortWater = feed(members, "thirst", NEEDS.drink, NEEDS.water, water0, (q) => takeWater(p, q), share);
  drinkHour(state, p, members, water0 - teamWater(p), p.rawDrunk); // worm.js: un-purified water (filter, fire, tablets, or as it is)
  delete p.rawDrunk;
  // The team's water gone: their own pack's.
  if (shortWater) for (const s2 of members) if (s2.thirst < NEEDS.drink[0] && packWater(s2) > 1e-6) s2.thirst = clamp(s2.thirst + drinkPack(s2, (NEEDS.drink[1] - s2.thirst) / NEEDS.water) * NEEDS.water);
  // Empty gauges: health (raw: armor and toughness do not help); low ones: mood. The cold without a fire: mood.
  const tile = partyTile(p);
  for (const s of members) {
    if (s.hunger <= 0) hurt(state, s, NEEDS.hurtFood, tile, "of starvation on the road", { raw: true });
    if (s.alive && s.thirst <= 0) hurt(state, s, NEEDS.hurtWater, tile, "of thirst on the road", { raw: true });
    if (!s.alive) continue;
    let m = 0;
    if (s.hunger < NEEDS.moodLow) m += NEEDS.moodHunger;
    if (s.thirst < NEEDS.moodLow) m += NEEDS.moodThirst;
    if (cold > 1) m += NEEDS.coldMood;
    if (m) s.mood = Math.max(0, s.mood - m);
    warnPerson(state, s);
  }
  const live = members.filter((s) => s.alive);
  p.noFood = live.some((s) => s.hunger <= 0) || (shortFood && teamFood(p) < 1e-6 && live.every((s) => packFood(s) < 1e-6));
  p.noWater = live.some((s) => s.thirst <= 0) || (shortWater && teamWater(p) < 1e-6 && live.every((s) => packWater(s) < 1e-6));
  if (state.hour % 24 === 0) {
    const name = teamName(state, p);
    if (p.noFood) log(state, `${name} is out of food.`, "danger");
    if (p.noWater) log(state, `${name} is out of water.`, "danger");
  }
}

// One log line when someone's hunger or thirst gets dangerous (again after it was back over NEEDS.warnBack).
function warnPerson(state, s) {
  const w = s.needWarn || (s.needWarn = {});
  if (s.hunger < NEEDS.starving && !w.h) { w.h = true; log(state, `${first(s)} is starving (hunger ${Math.floor(s.hunger)}).`, "danger"); }
  else if (s.hunger >= NEEDS.warnBack) w.h = false;
  if (s.thirst < NEEDS.starving && !w.t) { w.t = true; log(state, `${first(s)} is parched (thirst ${Math.floor(s.thirst)}).`, "danger"); }
  else if (s.thirst >= NEEDS.warnBack) w.t = false;
}

// A base's shares today: what part of a day's food and water each person gets (economy.js baseDaily sets the state).
export const baseFoodShare = (base) => (base.hungerDays > 0 ? 0 : base.rationing ? NEEDS.ration : 1);
export const baseWaterShare = (base) => (base.thirstDays > 0 ? Math.max(0, Math.min(1, base.waterFed ?? 0)) : 1);
// Under rationing, who gets fed first: the hurt, then the workers, then those resting (base.share "even": everyone the
// same). Returns Map(survivor → share 0..1) that averages to `share`.
function splitShare(people, share, mode) {
  const out = new Map();
  if (share >= 1 || share <= 0 || mode === "even") { for (const s of people) out.set(s, share); return out; }
  const rank = (s) => (hurtNow(s) ? 0 : s.role !== "rest" && !s.inBed ? 1 : 2);
  const list = [...people].sort((a, b) => rank(a) - rank(b) || hungerOf(a) - hungerOf(b) || a.id - b.id);
  let left = share * people.length;
  for (const s of list) { const q = Math.min(1, left); out.set(s, q); left -= q; }
  return out;
}

function baseHour(state, base, people) {
  const fW = baseWaterShare(base);
  const ws = splitShare(people, fW, base.share);
  const tf = Weather.thirstAt ? Weather.thirstAt(state) : 1;
  const wr = (NEEDS.water / 24) * tf;
  baseEatHour(state, base, people); // eating.js: hunger falls and people eat, each to their own target (meal breaks)
  for (const s of people) {
    ensureNeeds(s);
    const w = ws.get(s);
    s.thirst = clamp(s.thirst - wr + w * wr + (fW >= 1 ? NEEDS.recover : 0));
    warnPerson(state, s);
  }
}

// On a personal errand (hubevents.js): they eat and drink from what they took (s.location.pack).
// The errand's food and water are their own pack (eating.js s.ration; an old save's s.location.pack first).
function errandHour(state, s) {
  ensureNeeds(s);
  const old = s.location.pack || null;
  if (old && old.food != null) delete old.food; // an errand packed before food was by type (save.js): it went hungry on it
  const tf = Weather.thirstAt ? Weather.thirstAt(state) : 1;
  s.hunger = clamp(s.hunger - (NEEDS.food / 24) * (s.hunger < NEEDS.lean ? NEEDS.leanRate : 1) * appetite(s));
  s.thirst = clamp(s.thirst - (NEEDS.water / 24) * tf);
  const at = NEEDS.eat.full[0], to = eatTarget(s);
  // Breakfast, lunch and dinner from the pack: at least a meal's food value, the closest fit (eating.js).
  if (mealOf(null, state.hour, state) && packFood(s) > 1e-6) {
    const t = eatPack(state, s, Math.max(MEAL_FV / MEALS_A_DAY, Math.max(0, to - s.hunger) / NEEDS.food), true);
    s.hunger = clamp(s.hunger + t.units * NEEDS.food);
    if (t.units > 1e-6) noteEat(state, s, { ...t, from: "pack" }, {});
  }
  if (s.hunger < at) {
    const got = { units: 0, items: {}, lots: [], raw: 0, from: "pack" };
    const add = (t) => { got.units += t.units; got.raw += t.raw || 0; for (const [k, q] of Object.entries(t.items || {})) got.items[k] = (got.items[k] || 0) + q; };
    if (old) { const t = takeFoodFrom(old, Math.min(foodIn(old), (to - s.hunger) / NEEDS.food)); s.hunger = clamp(s.hunger + t.units * NEEDS.food); add(t); }
    if (s.hunger < to - 0.5 && packFood(s) > 1e-6) { const t = eatPack(state, s, (to - s.hunger) / NEEDS.food); s.hunger = clamp(s.hunger + t.units * NEEDS.food); add(t); }
    if (got.units > 1e-6) noteEat(state, s, got, {});
  }
  if (s.thirst < NEEDS.drink[0]) {
    let q = old ? drawWater(old, (NEEDS.drink[1] - s.thirst) / NEEDS.water).got : 0; // purified first (water.js)
    s.thirst = clamp(s.thirst + q * NEEDS.water);
    if (s.thirst < NEEDS.drink[1] - 0.5) { q = drinkPack(s, (NEEDS.drink[1] - s.thirst) / NEEDS.water); s.thirst = clamp(s.thirst + q * NEEDS.water); }
  }
  if (s.hunger <= 0) hurt(state, s, NEEDS.hurtFood, null, "of hunger far from home on a personal errand", { raw: true });
  if (s.alive && s.thirst <= 0) hurt(state, s, NEEDS.hurtWater, null, "of thirst far from home on a personal errand", { raw: true });
}

// Hourly (world.js tickHour): people at bases and on errands (teams eat in parties.js), then the teams' treats.
export function needsHour(state) {
  for (const base of state.bases) {
    if (base.owner != null && base.owner !== "player") continue;
    shelterFire(state, base); // woodcutting.js: a lit camp or shelter fire burns its firewood, or goes out
    const people = residents(state, base.id);
    if (people.length) baseHour(state, base, people);
  }
  for (const s of state.survivors) if (s.alive && s.location && s.location.kind === "errand") errandHour(state, s);
  if (state.hour % 24 === 0) eatingDaily(state); // eating.js: the day's food log (the same food again), thoughts, packs age
  if (hourOfDay(state) === NEEDS.treatHour) for (const p of state.parties) if (p.owner === "player" && Array.isArray(p.members)) for (const line of teamTreats(state, p)) log(state, line, "info");
}

// ---------- starving, day after day ----------
// Daily (economy.js basesDaily, before relationsDaily and the breaks): see STARVE. Everyone of yours who is not held
// captive. Draws no dice.
// The base someone lives at today (a trade-route escort lives at the hub), or null.
function homeBase(state, s) {
  const L = s.location || {};
  if (L.kind === "base" || L.kind === "post") return baseById(state, L.baseId); // post: a lookout at a field work (fieldworks.js)
  if (L.kind === "route") return hub(state);
  return null;
}
// Starving / parched now: at a base, the base is out of food / water today; away from one, the gauge below
// NEEDS.starving.
export function starvingNow(state, s) {
  const b = homeBase(state, s);
  if (b) return { food: b.hungerDays > 0, water: b.thirstDays > 0 };
  return { food: hungerOf(s) < NEEDS.starving, water: thirstOf(s) < NEEDS.starving };
}
export function starvingDaily(state) {
  for (const s of state.survivors) {
    if (!s.alive || !s.location || s.location.kind === "captive") continue;
    const now = starvingNow(state, s);
    for (const [kind, key, word] of [["food", "starveDays", "starving"], ["water", "parchDays", "parched"]]) {
      if (!now[kind]) { if (s[key]) delete s[key]; continue; }
      s[key] = (s[key] || 0) + 1;
      const hit = starveMood(s[key], kind);
      addMood(state, s, -hit, `${word === "starving" ? "Starving" : "Parched"} (day ${s[key]})`);
      if (s[key] === STARVE.warn) log(state, `${s.name} has been ${word} for ${s[key]} days: mood −${hit} a day and getting worse until they ${kind === "food" ? "eat" : "drink"}.`, "danger");
    }
  }
}

// ---------- treats ----------
// Treats someone can reach: [{ loc, key, item, whose }] — their own pockets and pack, then a teammate's (on a team) and
// the cargo, or the base's armory (at a base).
export function treatsFor(state, s) {
  const out = [];
  const add = (loc, it, whose) => { if (it && GEAR[it.key] && GEAR[it.key].use) out.push({ loc, key: it.key, item: it, whose }); };
  const person = (o, whose) => {
    (o.pockets || []).forEach((it, i) => add(`s:${o.id}:pocket:${i}`, it, whose));
    const pk = packOf(o);
    if (pk) pk.forEach((it, i) => add(`s:${o.id}:pack:${i}`, it, whose));
  };
  if (!s || !s.alive) return out;
  person(s, "own");
  const L = s.location;
  if (L.kind === "party") {
    const p = state.parties.find((x) => x.id === L.partyId);
    if (p) {
      for (const o of partyMembers(state, p)) if (o !== s) person(o, first(o));
      ((p.cargo && p.cargo.gear) || []).forEach((it, i) => add(`cargo:${p.id}:list:${i}`, it, "cargo"));
    }
  } else if (L.kind === "base") {
    const b = baseById(state, L.baseId);
    if (b) (b.armory || []).forEach((it, i) => add(`armory:${b.id}:list:${i}`, it, "armory"));
  }
  return out;
}
// The treat the simple rule picks for someone (or null): gentlest first; drink only at rest; smokes not when weak;
// valuables only when really low.
export function pickTreat(state, s, resting) {
  const list = treatsFor(state, s);
  for (const key of TREAT_ORDER) {
    if (DRINKS.has(key) && !resting) continue;
    if (SMOKES.has(key) && s.health <= 40) continue;
    if (GEAR[key] && GEAR[key].valuable && s.mood >= NEEDS.valuableMood) continue;
    const t = list.find((x) => x.key === key);
    if (t) return t;
  }
  return null;
}
// Uses a treat at loc on s (the rule, or the player's button): reach checked, used up. Returns the line ("" if not).
export function useTreat(state, s, loc) {
  const t = treatsFor(state, s).find((x) => x.loc === loc);
  if (!t || !s.alive) return "";
  if (placeOfLoc(state, loc) !== personPlace(s)) return "";
  useOneAt(state, loc); // one of a stack (itemstack.js), else the item
  return applyUse(state, s, t.key);
}
// A team's evening: everyone below COMFORT.lowMood (glummest first) uses one treat. Returns the lines.
export function teamTreats(state, p) {
  const out = [];
  const resting = !onTheMove(p);
  const people = partyMembers(state, p).filter((s) => s.alive && s.mood < COMFORT.lowMood && !s.buzz).sort((a, b) => a.mood - b.mood || a.id - b.id);
  for (const s of people) {
    const t = pickTreat(state, s, resting);
    if (!t) continue;
    const line = useTreat(state, s, t.loc);
    if (line) out.push(line);
  }
  return out;
}

// ---------- heating (daily, economy.js baseDaily) ----------
// Burns the day's heating (upkeep.js heatUse) from the stock: firewood first (1 firewood = HEAT.wood fuel of heat),
// then fuel for the rest. Short of both, everyone there is cold: base.cold = the share missing (0..1, false when
// warm): mood −COLD.mood and health −COLD.hp × that a day, and the cold reaches indoors (health.js baseOnsets: illness
// risk as outdoors). A camp's or shelter's fire burns its firewood by the hour (woodcutting.js shelterFire, needsHour).
export function heatDaily(state, base) {
  const use = heatUse(state, base);
  const st = base.stock;
  base.heat = { need: r1(use.total), each: use.each, n: use.n, fire: use.fire, burned: 0, wood: 0 };
  if (!(use.total > 0)) { base.cold = false; return; }
  const heatIn = () => Math.max(0, st.wood || 0) * HEAT.wood + Math.max(0, st.fuel || 0);
  // An outpost short of heating gets it from the hub over its supply line, as its food (economy.js shipFromOutposts):
  // firewood, then fuel, from what the hub can spare beyond its own two days of heating, less what the line loses.
  const h = base.type === "outpost" ? hub(state) : null;
  const strength = base.supplyLine ? base.supplyLine.strength : 0.5;
  if (h && h !== base && heatIn() < use.total && strength > 0) {
    const hu = heatUse(state, h);
    const spareWood = Math.max(0, (h.stock.wood || 0) - 2 * hu.wood);
    const sendWood = Math.min(spareWood, (use.total - heatIn()) / HEAT.wood / strength);
    if (sendWood > 0) { h.stock.wood -= sendWood; st.wood = Math.max(0, st.wood || 0) + sendWood * strength; }
    const spare = Math.max(0, (h.stock.fuel || 0) - Math.max(0, 2 * hu.total - Math.max(0, h.stock.wood || 0) * HEAT.wood));
    const send = Math.min(spare, Math.max(0, use.total - heatIn()) / strength);
    if (send > 0) { h.stock.fuel -= send; st.fuel = Math.max(0, st.fuel || 0) + send * strength; }
  }
  const wood = Math.min(Math.max(0, st.wood || 0), use.wood);
  st.wood = Math.max(0, (st.wood || 0) - wood);
  const burn = Math.min(Math.max(0, st.fuel || 0), Math.max(0, use.total - wood * HEAT.wood));
  st.fuel = Math.max(0, (st.fuel || 0) - burn);
  base.heat.burned = r1(burn);
  base.heat.wood = r1(wood);
  const es = econStats(state);
  es.heatWood = (es.heatWood || 0) + wood;
  es.heatFuel = (es.heatFuel || 0) + burn;
  const short = Math.max(0, 1 - (burn + wood * HEAT.wood) / use.total);
  if (short < 0.02) { base.cold = false; return; }
  base.cold = Math.round(short * 100) / 100;
  const people = residents(state, base.id);
  for (const s of people) {
    s.mood = Math.max(0, s.mood - COLD.mood * short);
    hurt(state, s, Math.round(COLD.hp * short * 10) / 10, base.tile, `of cold at ${base.name}`, { raw: true });
  }
  es.coldDays = (es.coldDays || 0) + 1; // base-days with someone cold (the balance runs)
  log(state, `${base.name} has ${burn > 0 || wood > 0 ? "too little" : "no"} firewood or fuel to keep warm (needs ${use.text}): everyone there is cold (mood −${r1(COLD.mood * short)}, health −${r1(COLD.hp * short)}, and illness as outdoors).`, "danger");
}

// ---------- errands ----------
// Food and water someone takes on a personal errand of `days` (hubevents.js): about one of each a day.
export const ERRAND_PACK = { food: 1, water: 1 };
// The food is items that keep (foods.js packPick), in their own pack (eating.js s.ration: the one they always carry),
// topped up to the errand's days (what it already holds counts). Returns what was added ({ key: q, water, rawwater })
// for the card's line.
export function packErrand(state, base, s, days) {
  const tf = Weather.thirstAhead ? Weather.thirstAhead(state, days) : 1;
  const pk = rationOf(s);
  const wantW = Math.max(0, Math.min(Math.floor(waterIn(base.stock)), Math.ceil(days * ERRAND_PACK.water * tf - waterIn(pk.supplies))));
  const wantF = Math.max(0, Math.min(foodIn(base.stock), Math.ceil(days * ERRAND_PACK.food - packFood(s))));
  const moved = wantF > 0 ? moveFood(base, pk, packPick(state, base, wantF, { days }), { state }) : {};
  const w = drawWater(base.stock, wantW); // purified first, then un-purified (water.js)
  pk.supplies.water = Math.round(((pk.supplies.water || 0) + w.pure) * 100) / 100;
  if (w.raw > 0) pk.supplies[RAW] = Math.round(((pk.supplies[RAW] || 0) + w.raw) * 100) / 100;
  return { ...moved, water: w.pure, [RAW]: w.raw };
}
// Back from the errand: what is left over their usual pack (eating.js PACK) comes home; an old save's errand pack
// (s.location.pack) all of it. `who`: the survivor (or an old pack). Returns { food (days), water } brought back.
export function unpackErrand(base, who, state = null) {
  if (!who || !base) return { food: 0, water: 0 };
  if (!who.name) { // an old save's errand pack
    const pack = who;
    const food = foodIn(pack), pure = Math.floor((pack.water || 0) + 1e-9), raw = Math.floor((pack[RAW] || 0) + 1e-9);
    moveFood(pack, base);
    base.stock.water = (base.stock.water || 0) + pure;
    if (raw > 0) base.stock[RAW] = (base.stock[RAW] || 0) + raw;
    return { food, water: pure + raw };
  }
  let food = 0, water = 0;
  if (who.location && who.location.pack) { const b = unpackErrand(base, who.location.pack); food += b.food; water += b.water; delete who.location.pack; }
  const e = emptyPack(state, who, base, { keepFood: PACK.food, keepWater: PACK.water });
  return { food: food + e.food, water: water + Math.floor(e.water * 10) / 10 };
}

// ---------- text for the UI and alerts ----------
// People whose hunger or thirst is low ([{ s, text, tone }]), worst first. teamOnly: only those on teams.
export function needAlerts(state, people) {
  const out = [];
  for (const s of people) {
    if (!s.alive) continue;
    const h = hungerOf(s), t = thirstOf(s);
    if (t < NEEDS.low) out.push({ s, v: t, text: `${first(s)}: ${thirstWord(t).toLowerCase()} (thirst ${Math.floor(t)})`, tone: t < NEEDS.starving ? "danger" : "warn" });
    else if (h < NEEDS.low) out.push({ s, v: h, text: `${first(s)} is ${hungerWord(h).toLowerCase()} (hunger ${Math.floor(h)})`, tone: h < NEEDS.starving ? "danger" : "warn" });
  }
  return out.sort((a, b) => a.v - b.v);
}
