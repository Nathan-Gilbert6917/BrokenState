// Food storage, cooking and preserving (every base). Food is by type (foods.js): each item keeps for its own time
// (shelf, days at room temperature) and a base keeps lots of it (base.foodLots: { key: [{ q, left, egg }] }); each
// day a lot's shelf left drops by the storage factor of where it sits, and at 0 it is gone (user pick 2026-10-10:
// spoiled food just disappears, with a line in the log; nothing eats, composts or distils it).
//
// Where food sits:
//   - food that keeps (canned, dry, snacks, rations, preserved: shelf ≥ foods.js STABLE_DAYS) needs no room: it ages
//     at FACTOR.stable (1, a little faster in the heat, slower in the cold) wherever it is;
//   - the rest (fresh, produce, crops, forage, raw meat and fish, meals) fills the base's food rooms, the item that
//     spoils fastest (shortest shelf) in the coldest room first; what does not fit is "stored outside" (tarps, crates,
//     the back of a truck) at FACTOR.outside, worse in heat and rain, much slower once it freezes.
// Rooms (STORE, in days of food: 2000 kcal): the hub's own cellar (200) and root cellars (+200 each, up to 2) at
// FACTOR.cellar; an outpost's pantry (40), a storehouse (+150) and storage crates (+30) at room temperature (1×); a cold
// store (+150: an ice house) at 0.15–0.9 by the temperature (the best place in winter, little better than a pantry in
// summer once the ice is gone; machines-2: never powered); a walk-in freezer (+300, the freezer-parts
// branch's building "freezer") at FACTOR.freezer while base.freezerOn is true (powered and working), as a pantry when
// it is off. Root Cellar Lore (skills.js spoilMult) × 0.75 everywhere.
// A base with a hunting cabin hangs its raw meat and fish in the smokehouse: × CABIN.spoil (hunting.js).
//
// Eating (eatFromStore): the lot nearest to spoiling first, whatever it is (the Kitchen's meals, bread, cheese, the
// cans last); food with the worm's eggs is left to the end (crops and forage, then meat: worm.js, eaten raw).
// Cooking (cookDaily, before the eating): a base whose Kitchen serves hot meals (kitchen.js: a lit stove and its
// cooks, `cover` the share of the people they feed) turns up to that share of the day's eating of raw ingredients (raw
// meat and fish, eggs and milk, produce, crops, forage: FOODS ingredient) into simple meals, safe to eat (the worm's
// eggs die), spoiling in 4 days; the ones with eggs go in the pot first. The kitchen's own saving (kitchen.js
// KITCHEN.save, upkeep.js kitchenEatMult) is the stretch: the meals hold the calories of their makings (MEAL.gain 1).
// Wave 2 replaces this with recipes and bills. A base that cooks without a kitchen (worm.js baseCooks: a shelter's lit
// fire, an old cook fire, the Preserving room) still kills the eggs in what it eats (the egg lots count as cooked).
// Preserving:
//   - the Preserving room (buildings.js "kitchen", RECIPES.preserve, an operator): 9 days of fresh food + 3 water + 1
//     scrap + 4 empty jars → 8 portions of jarred food a day (9 with Farming 8+; the pressure canner fitting +1);
//   - Drying racks (no operator): each dries RACK.food days of surplus fresh food into RACK.out a day (half on wet days),
//     raw meat first (into jerky; fish into smoked fish; the rest into dried fruit and veg), food stored outside next,
//     else only fresh food above RACK.keepDays of eating;
//   - the hunting cabin's smokehouse (hunting.js baseGameDaily): up to 6 days of raw meat and fish into 5 of jerky.
// Jars (supply "jars") are found in kitchens, shops and farms. A jar holds JAR_RATIONS portions of jarred food; when it
// is eaten at a base, JAR_RETURN of the jars come back. Jars that leave with the food do not.
import { log, residents, atBase } from "./world.js";
import { count, countAll } from "./buildings.js";
import { rackLimit } from "./production.js";
import * as Weather from "./weather.js";
import { spoilMult } from "./skills.js";
import { baseGameDaily, CABIN } from "./hunting.js";
import { baseCooks, cookEggs } from "./worm.js";
import { hasKitchen, kitchenService } from "./kitchen.js"; // the Kitchen's cooks: the share of the day's eating they make into meals
import { FOODS, DAY_KCAL, foodIn, foodSplit, syncLots, lotsOf, takeFood, addFood, ageLots, unitsOf, qtyOf, foodText, eggFood } from "./foods.js";

export const STORE = { hubCellar: 200, pantry: 40, rootCellar: 200, storehouse: 150, coldStore: 150, crates: 30, freezer: 300 };
// Shelf used a day by where the food sits (× the day's weather, storeFactor).
export const FACTOR = { outside: 1.5, dry: 1, cellar: 0.35, freezer: 0.05, stable: 1 };
export const RACK = { food: 4, out: 3, keepDays: 15 };   // drying rack: days of food in, out, days of eating kept fresh
export const JAR_RATIONS = 2, JAR_RETURN = 0.85;
export const MEAL = { key: "f_simplemeal", gain: 1 };  // the Kitchen's meals: kcal out per kcal of raw makings (its saving is kitchen.js KITCHEN.save)
// The items the racks dry into, by what went on them.
const RACK_OUT = { rawmeat: "f_jerky", rawfish: "f_smokedfish" };
const rackable = (k, f) => !f.stable && f.group !== "meal" && k !== "f_milk" && k !== "f_eggs" && k !== "f_bread" && k !== "f_cheese";

const wx = (state) => (Weather.weather ? Weather.weather(state) : { hi: 20, lo: 10, key: "clear", rain: 0 });
const meanTemp = (w) => ((w.hi ?? 20) + (w.lo ?? 10)) / 2;
const isWet = (w) => w.key === "rain" || w.key === "storm" || (w.rain || 0) > 0;
const mouths = (state, base) => residents(state, base.id).length;
const eatRate = (state, base) => mouths(state, base) * (Weather.foodNeedFactor ? Weather.foodNeedFactor(state) : 1);
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const n1 = (v) => Math.round((v || 0) * 10) / 10;

// ---------- factors ----------
// Shelf days used a day in each kind of storage at a mean temperature (°C), wet: rain or a storm, heat: a heat wave.
export function storeFactor(kind, temp, { wet = false, heat = false } = {}) {
  const cold = temp < 5, hot = temp > 24 || heat;
  if (kind === "freezer") return FACTOR.freezer;
  if (kind === "cold") return temp < 0 ? 0.15 : temp < 5 ? 0.3 : temp < 15 ? 0.6 : 0.9; // an ice house: its ice lasts into spring
  if (kind === "cellar") return FACTOR.cellar * (cold ? 0.8 : hot ? 1.2 : 1);
  if (kind === "dry") return FACTOR.dry * (cold ? 0.7 : hot ? 1.25 : 1);
  if (kind === "stable") return FACTOR.stable * (temp < 0 ? 0.8 : hot ? 1.2 : 1);
  // Outside: frozen food keeps; heat and rain rot it fast.
  return FACTOR.outside * (temp < 0 ? 0.15 : cold ? 0.5 : hot ? 1.5 : 1) * (wet ? 1.3 : 1);
}

// The food rooms a base has: [{ key, name, kind, cap }] (cap in days of food). The hub's own cellar and the root
// cellars share one row. A walk-in freezer (the freezer-parts branch: building "freezer") freezes while
// base.freezerOn, else it is a cool pantry.
export function storeSpaces(base) {
  const out = [];
  const cellar = (base.type === "hub" ? STORE.hubCellar : 0) + count(base, "cellar") * STORE.rootCellar;
  if (cellar > 0) out.push({ key: "cellar", name: count(base, "cellar") ? (base.type === "hub" ? "Cellars" : "Root cellar") : "Cellar", kind: "cellar", cap: cellar });
  if (base.type !== "hub") out.push({ key: "pantry", name: "Pantry", kind: "dry", cap: STORE.pantry });
  if (count(base, "storehouse")) out.push({ key: "storehouse", name: "Storehouse", kind: "dry", cap: count(base, "storehouse") * STORE.storehouse });
  if (count(base, "crates")) out.push({ key: "crates", name: "Storage crates", kind: "dry", cap: count(base, "crates") * STORE.crates });
  // The cold store is an ice house (machines-2: never powered): good in winter, poor in summer.
  if (count(base, "coldstore")) out.push({ key: "coldstore", name: "Cold store", kind: "cold", cap: count(base, "coldstore") * STORE.coldStore });
  // The walk-in freezers (freezer-parts: buildings.js freezer, power.js base.freezerOn / base.freezersOn): every one
  // adds its room (a broken one too: countAll); the ones running freeze (×0.05), the rest are a cool pantry.
  const fz = countAll(base, "freezer");
  if (fz) {
    const on = Math.min(fz, base.freezersOn ?? (base.freezerOn ? fz : 0));
    if (on) out.push({ key: "freezer", name: "Walk-in freezer", kind: "freezer", cap: on * STORE.freezer });
    if (fz - on) out.push({ key: "freezeroff", name: "Walk-in freezer (off)", kind: "dry", cap: (fz - on) * STORE.freezer });
  }
  return out;
}
export const storeCapacity = (base) => storeSpaces(base).reduce((a, s) => a + s.cap, 0);

// Where every lot sits today: the rooms by today's factor, coldest first, filled with the fresh food that spoils
// fastest (shortest shelf, then the least left); the rest outside; food that keeps in the dry. Returns { spaces:
// [{ ...room, factor, held, items: { key: q } }], outside, outFactor, outItems, stable, stableFactor, fresh, cap,
// place: Map(lot → factor) }. extra: × every factor (Root Cellar Lore).
export function placeFood(state, base, temp = null, wet = null, heat = null) {
  const w = wx(state);
  const t = temp == null ? meanTemp(w) : temp;
  const wt = wet == null ? isWet(w) : wet, ht = heat == null ? w.key === "heat" : heat;
  const sm = spoilMult(state, base);
  const spaces = storeSpaces(base).map((s) => ({ ...s, factor: storeFactor(s.kind, t, { wet: wt, heat: ht }) * sm, held: 0, items: {} })).sort((a, b) => a.factor - b.factor);
  const outFactor = storeFactor("outside", t, { wet: wt, heat: ht }) * sm;
  const stableFactor = storeFactor("stable", t, { heat: ht }) * sm;
  const L = syncLots(base, state) || {};
  const fresh = [];
  let stable = 0;
  const place = new Map();
  for (const k in L) {
    const f = FOODS[k];
    for (const l of L[k]) {
      if (f.stable) { stable += unitsOf(k, l.q); place.set(l, stableFactor); }
      else fresh.push({ k, f, l, u: unitsOf(k, l.q) });
    }
  }
  fresh.sort((a, b) => a.f.shelf - b.f.shelf || a.l.left - b.l.left);
  let si = 0, room = spaces.length ? spaces[0].cap : 0, outside = 0;
  const outItems = {};
  for (const x of fresh) {
    let u = x.u, wsum = 0;
    while (u > 1e-9 && si < spaces.length) {
      const take = Math.min(u, room);
      if (take > 1e-9) { spaces[si].held += take; spaces[si].items[x.k] = (spaces[si].items[x.k] || 0) + qtyOf(x.k, take); wsum += take * spaces[si].factor; u -= take; room -= take; }
      if (room <= 1e-9) { si++; room = si < spaces.length ? spaces[si].cap : 0; }
    }
    if (u > 1e-9) { outside += u; outItems[x.k] = (outItems[x.k] || 0) + qtyOf(x.k, u); wsum += u * outFactor; }
    place.set(x.l, x.u > 0 ? wsum / x.u : outFactor);
  }
  const cap = spaces.reduce((a, s) => a + s.cap, 0);
  const fu = fresh.reduce((a, x) => a + x.u, 0);
  return { spaces, outside, outFactor, outItems, stable, stableFactor, fresh: fu, cap, inside: fu - outside, place, temp: t };
}
// Raw meat and fish hang in a hunting cabin's smokehouse: they keep longer there.
const lotFactor = (base, P) => (k, f, l) => (P.place.get(l) ?? P.outFactor) * ((f.group === "rawmeat" || f.group === "rawfish") && count(base, "huntcabin") ? CABIN.spoil : 1);

// Food that will spoil before it is eaten (eating the soonest-to-spoil first at today's rate, at today's factors):
// { waste (days of food lost), perDay (over the next 30 days), soon: [{ key, q, days }] }.
export function spoilForecast(state, base, P = placeFood(state, base)) {
  const L = base.foodLots || {};
  const rows = [];
  const fac = lotFactor(base, P);
  for (const k in L) for (const l of L[k]) { const d = l.left / Math.max(1e-6, fac(k, FOODS[k], l)); rows.push({ k, q: l.q, u: unitsOf(k, l.q), d }); }
  rows.sort((a, b) => a.d - b.d);
  const rate = Math.max(0, eatRate(state, base));
  let eaten = 0, waste = 0, waste30 = 0;
  const soon = [];
  for (const r of rows) {
    const can = Math.max(0, rate * r.d - eaten);
    const lost = Math.max(0, r.u - can);
    eaten += r.u - lost;
    waste += lost;
    if (r.d <= 30) waste30 += lost;
    if (lost > 1e-6 && r.d <= 7) soon.push({ key: r.k, q: qtyOf(r.k, lost), days: r.d });
  }
  return { waste, perDay: waste30 / 30, soon };
}

// Today's storage for the screens and the planners: { fresh (days of food that needs a room), stable (keeps), cap,
// inside, outside, spaces, outFactor, stableFactor, spoil (days of food a day that will spoil before it is eaten),
// rate (the spoil per day as a share of the food), outRate (the share of the food stored outside whose shelf goes in a
// day: × the outside factor over each item's shelf; health.js reads it for the sickness from spoiled food), forecast }.
export function foodStore(state, base) {
  const P = placeFood(state, base);
  const fc = spoilForecast(state, base, P);
  const all = P.fresh + P.stable;
  let ou = 0, ow = 0;
  for (const [k, q] of Object.entries(P.outItems || {})) { const u = unitsOf(k, q); ou += u; ow += (u * P.outFactor) / Math.max(0.5, FOODS[k].shelf || 1); }
  return { ...P, preserved: P.stable, spoil: fc.perDay, freshLoss: fc.perDay, rate: all > 0 ? fc.perDay / all : 0, outRate: ou > 0 ? ow / ou : 0, forecast: fc };
}

// Days of food lost a day (the winter outlook) at a mean temperature, for `fresh` days of fresh food of the base's
// usual mix: its rooms and the rest outside, × the factor over the mix's average shelf left.
export function spoilFresh(base, fresh, temp) {
  const L = base.foodLots || {};
  let u = 0, us = 0;
  for (const k in L) if (!FOODS[k].stable) for (const l of L[k]) { const x = unitsOf(k, l.q); u += x; us += x * Math.max(1, FOODS[k].shelf); }
  const shelf = u > 0 ? us / u : 30;
  let left = Math.max(0, fresh), loss = 0;
  for (const s of storeSpaces(base).map((x) => ({ ...x, factor: storeFactor(x.kind, temp) })).sort((a, b) => a.factor - b.factor)) {
    const held = Math.min(left, s.cap);
    loss += (held * s.factor) / shelf;
    left -= held;
  }
  return loss + (left * storeFactor("outside", temp)) / shelf;
}
// A day's loss of the food that keeps (planning), a share of it.
export const stableLoss = (temp) => storeFactor("stable", temp) / 900;

// Food a base can eat (days of food).
export const edibleFood = (base) => foodIn(base.stock);

// ---------- cooking ----------
// Before a base eats (economy.js): a base that cooks turns up to `units` days of raw ingredients into simple meals
// (MEAL.gain more filling), the ones with the worm's eggs first, less the meals already standing. Returns the days of
// raw makings cooked.
export function cookDaily(state, base, units) {
  base.cooked = 0;
  if (!(units > 0) || !baseCooks(base)) return 0;
  // The Kitchen's hot meals (kitchen.js): its cooks feed `cover` of the people; their share of the day's eating is
  // cooked from the raw ingredients (the ones with eggs first), less the meals already standing.
  const ks = hasKitchen(base) ? kitchenService(state, base) : null;
  const cover = ks && !ks.cold ? Math.max(0, Math.min(1, ks.cover || 0)) : 0;
  let cooked = 0;
  if (cover > 0) {
    const ready = unitsOf(MEAL.key, base.stock[MEAL.key] || 0);
    let want = Math.max(0, units * cover - ready);
    if (want > 1e-6) {
      const only = (k, f) => !!f.ingredient;
      const a = takeFood(base, want, { only, clean: false, state });
      want -= a.units;
      const b = want > 1e-6 ? takeFood(base, want, { only, eggs: false, state }) : { units: 0 };
      cooked = a.units + b.units;
      if (cooked > 0) addFood(base, MEAL.key, qtyOf(MEAL.key, cooked * MEAL.gain), { state });
    }
  }
  // Whatever else cooks here (the stove for the rest, a shelter's fire, the Preserving room's stove): the food with the
  // worm's eggs in the rest of the day's eating is cooked through (worm.js cookEggs: the eggs die).
  const left = Math.max(0, units - cooked);
  if (left > 1e-6) cookEggs(base, left);
  base.cooked = Math.round(cooked * 10) / 10;
  return cooked;
}

// ---------- eating ----------
// Takes `amount` days of food: the lot nearest to spoiling first (clean food), then the crops and forage with the
// worm's eggs (eaten uncooked: base.rawCropEaten / rawForageEaten), then the meat with eggs (base.rawEaten; worm.js
// rolls them). Jarred food frees its jars (most come back). Records what was eaten today (base.ate: the mood from the
// meals, relations.js). Returns the days of food that could not be covered.
export function eatFromStore(base, amount, state = null) {
  let need = Math.max(0, amount);
  if (!(need > 0)) return 0;
  const ate = takeFood(base, need, { eggs: false, state });
  need -= ate.units;
  const items = { ...ate.items };
  if (need > 1e-9) {
    const veg = takeFood(base, need, { clean: false, only: (k, f) => f.group !== "rawmeat" && f.group !== "rawfish", state });
    need -= veg.units;
    base.rawCropEaten = (base.rawCropEaten || 0) + veg.eggs.crop;
    base.rawForageEaten = (base.rawForageEaten || 0) + veg.eggs.forage;
    for (const [k, q] of Object.entries(veg.items)) items[k] = (items[k] || 0) + q;
  }
  if (need > 1e-9) {
    const raw = takeFood(base, need, { clean: false, state });
    need -= raw.units;
    base.rawEaten = (base.rawEaten || 0) + raw.eggs.all;
    for (const [k, q] of Object.entries(raw.items)) items[k] = (items[k] || 0) + q;
  }
  if (items.f_jarred > 0) jarsBack(base, items.f_jarred);
  noteAte(state, base, items);
  return Math.max(0, need);
}
// What a base ate today (relations.js noteMeals: the mood of the meals, weeks of nothing fresh). The day: the midnight
// tick closes the day before (eating.js eats by the hour; economy.js reads the day that ended at midnight).
function noteAte(state, base, items) {
  const d = state ? Math.floor((state.hour - 1) / 24) : null;
  if (!base.ate || base.ate.day !== d) base.ate = { day: d, units: 0, fresh: 0, meals: 0, lift: 0 };
  for (const [k, q] of Object.entries(items)) {
    const f = FOODS[k], u = unitsOf(k, q);
    base.ate.units += u;
    if (!f.stable || f.group === "meal") base.ate.fresh += u;
    if (f.group === "meal") { base.ate.meals += u; base.ate.lift += u * (f.moodLift || 0); }
  }
}
// The mood the day's meals give (relations.js): the eaten meals' moodLift, by their share of the day's food.
export const mealLift = (base, d) => (base.ate && base.ate.day === d && base.ate.units > 0 ? base.ate.lift / base.ate.units : 0);

// Food eaten from the stores by someone at the table (eating.js, hourly): jarred food frees its jars, and the day's
// record (noteAte).
export function ateFromStore(state, base, items) {
  if (items.f_jarred > 0) jarsBack(base, items.f_jarred);
  noteAte(state, base, items);
}
// The day a base's meals count for now (see noteAte).
export const ateDay = (state) => Math.floor((state.hour - 1) / 24);

// Jars in use follow the jarred food: eating it frees its jars, most come back.
function jarsBack(base, eaten) {
  const pres = Math.max(0, base.stock.f_jarred || 0) + eaten;
  const inUse = Math.min(base.jarsInUse || 0, pres / JAR_RATIONS);
  if (!(inUse > 0) || !(pres > 0)) return;
  const freed = Math.min(inUse, (eaten * inUse) / pres);
  base.jarsInUse = inUse - freed;
  base.stock.jars = (base.stock.jars || 0) + freed * JAR_RETURN;
}
export const jarsInUse = (base) => Math.min(base.jarsInUse || 0, Math.max(0, base.stock.f_jarred || 0) / JAR_RATIONS);

// ---------- daily ----------
// Drying racks (no operator, someone must live here): surplus fresh food dried.
export function rackPlan(state, base, P = null) {
  const racks = count(base, "smoker");
  if (!racks || !atBase(state, base.id).length) return { racks, take: 0, out: 0, wet: false };
  const w = wx(state);
  const wet = isWet(w) || w.key === "fog" || w.key === "snow" || w.key === "blizzard";
  const p = P || placeFood(state, base);
  let fresh = 0, meat = 0;
  for (const k in base.stock) { const f = FOODS[k]; if (f && base.stock[k] > 0 && rackable(k, f)) { const u = unitsOf(k, base.stock[k]); fresh += u; if (f.raw) meat += u; } }
  const spare = Math.max(Math.min(fresh, p.outside), fresh - eatRate(state, base) * RACK.keepDays, meat); // raw meat goes on the racks first
  const take = Math.max(0, Math.min(racks * RACK.food * (wet ? 0.5 : 1), spare, rackLimit(state, base, fresh))); // production.js: the racks' order
  return { racks, take, out: take * (RACK.out / RACK.food), wet };
}
function rackDaily(state, base, P) {
  const rack = rackPlan(state, base, P);
  if (!(rack.take > 0)) return { out: 0 };
  return { out: dryFood(state, base, rack.take, RACK.out / RACK.food) };
}
// Dries up to `units` days of a base's fresh food (the racks; a prisoner in the kitchen salting it by hand): raw meat
// and fish first (those with eggs first: dried, they are safe), then whatever spoils soonest; ratio: days out a day in
// (into jerky, smoked fish, dried fruit and veg). Returns the days of food made.
export function dryFood(state, base, units, ratio) {
  const got = {};
  let left = units;
  for (const pass of [(k, f) => !!f.raw && rackable(k, f), (k, f) => rackable(k, f)]) {
    if (left <= 1e-9) break;
    const a = takeFood(base, left, { only: pass, clean: false, state });
    const b = left - a.units > 1e-9 ? takeFood(base, left - a.units, { only: pass, eggs: false, state }) : { units: 0, items: {} };
    for (const r of [a, b]) for (const [k, q] of Object.entries(r.items)) { const out = RACK_OUT[FOODS[k].group] || (k === "f_frozenmeat" ? "f_jerky" : "f_driedfruit"); got[out] = (got[out] || 0) + unitsOf(k, q); }
    left -= a.units + b.units;
  }
  let out = 0;
  for (const [k, u] of Object.entries(got)) { const q = qtyOf(k, u * ratio); addFood(base, k, q, { state }); out += unitsOf(k, q); }
  return out;
}
// Days of fresh food the racks (and the hand driers) can take.
export function rackableFood(base) {
  let u = 0;
  for (const k in base.stock) { const f = FOODS[k]; if (f && base.stock[k] > 0 && rackable(k, f)) u += unitsOf(k, base.stock[k]); }
  return u;
}

// Once a day per base (economy.js, after eating): the racks and the smokehouse dry their share, then every lot ages by
// where it sits and what reaches 0 is gone. Returns { spoiled (days of food), dried, store, items (spoiled { key: q }) };
// logs what spoiled, and when food starts (and stops) spoiling outside.
export function storageDaily(state, base) {
  syncLots(base, state);
  const rack = rackDaily(state, base, placeFood(state, base));
  const game = baseGameDaily(state, base); // hunting.js: the cabin's smokehouse
  const P = placeFood(state, base);
  const items = ageLots(base, 1, lotFactor(base, P), state);
  const spoiled = Object.entries(items).reduce((a, [k, q]) => a + unitsOf(k, q), 0);
  base.jarsInUse = jarsInUse(base); // jarred food that spoiled, was traded or taken leaves with its jars
  base.spoiledToday = { day: Math.floor(state.hour / 24), units: Math.round(spoiled * 10) / 10, items };
  if (spoiled >= 0.05 && Object.values(items).some((q) => q >= 0.5)) log(state, `${base.name}: food spoiled and was thrown out: ${foodText(items)} (${n1(spoiled)} days of food).`, spoiled >= 5 ? "danger" : "info");
  // Outposts ship their surplus to the hub every day: only food left outside for three days there is worth a word.
  const outside = P.outside >= 1;
  base.outsideDays = outside ? (base.outsideDays || 0) + 1 : 0;
  if (outside && !base.spoilingOutside && base.outsideDays >= (base.type === "hub" ? 1 : 3)) {
    log(state, `${base.name}: the food rooms are full (${Math.floor(P.cap)} days of fresh food). ${Math.floor(P.outside)} days of fresh food are stored outside and spoil fast. Build a root cellar, storehouse or cold store, eat it, or preserve it.`, "danger");
  } else if (!outside && base.spoilingOutside && P.fresh > 0) {
    log(state, `${base.name}: all the fresh food fits in the food rooms again.`, "info");
  }
  base.spoilingOutside = outside && (base.spoilingOutside || base.outsideDays >= (base.type === "hub" ? 1 : 3));
  return { spoiled, dried: rack.out + game.dried, store: P, items };
}

// ---------- text ----------
const KIND_WORD = { cellar: "cellar", dry: "room temperature", cold: "ice house", freezer: "frozen", outside: "outside" };
// "in cellar 180/200, outside 40 (spoiling 2.3/day)" plus the food that keeps, for the base panel, Farming tab and top bar.
export function storeLine(state, base) {
  const s = foodStore(state, base);
  const where = s.spaces.length ? s.spaces.map((x) => `${x.name.toLowerCase()} ${n0(x.held)}/${x.cap}`).join(", ") : "no food rooms";
  const short = `fresh food in ${where}${s.outside >= 1 ? `, outside ${n0(s.outside)}` : ""}${s.spoil >= 0.05 ? ` (${n1(s.spoil)}/day will spoil)` : ""}`;
  const pres = `food that keeps ${n0(s.stable)} days${(base.stock.jars || 0) >= 1 || jarsInUse(base) >= 1 ? ` · jars ${n0(base.stock.jars)} empty, ${n0(jarsInUse(base))} filled` : ""}`;
  const rates = s.spaces.map((x) => `${x.name} ${n1(x.factor)}×`).concat([`outside ${n1(s.outFactor)}×`, `food that keeps ${n1(s.stableFactor)}×`]).join(", ");
  const tip = `Food storage, in days of food (2000 kcal): ${s.cap} room for fresh food (${s.spaces.map((x) => `${x.name} ${x.cap}`).join(", ") || "none"}). Every food keeps its own time (bread days, raw meat two or three, potatoes a month, cans years); where it sits sets how fast that time runs today: ${rates}. Fresh food fills the coldest room first, the food that spoils fastest first; what does not fit is stored outside. Canned, dry and preserved food needs no room. Spoiled food is thrown out. More room: Root cellar (+${STORE.rootCellar}), Storehouse (+${STORE.storehouse}), Cold store (+${STORE.coldStore}, best in winter)${count(base, "freezer") ? "" : `, a walk-in freezer (+${STORE.freezer}, powered)`}. Preserve surplus in a Preserving kitchen (needs jars) or on Drying racks.`;
  return { short, pres, tip, cls: s.outside >= 1 ? "danger" : "", store: s };
}
export const kindWord = (kind) => KIND_WORD[kind] || kind;
// The base's food for the stores panel: [{ key, name, icon, q, units, kcal, days (shelf left on the soonest lot at
// today's factor), where (the room it sits in), egg }], most first.
export function foodRows(state, base) {
  const P = placeFood(state, base);
  const fac = lotFactor(base, P);
  const L = base.foodLots || {};
  const rows = [];
  for (const k in L) {
    const f = FOODS[k];
    const q = base.stock[k] || 0;
    if (!(q > 1e-6)) continue;
    let days = Infinity, egg = 0;
    for (const l of L[k]) { days = Math.min(days, l.left / Math.max(1e-6, fac(k, f, l))); if (l.egg) egg += l.q; }
    let where = f.stable ? "dry store" : "";
    if (!f.stable) {
      const rooms = P.spaces.filter((s) => (s.items[k] || 0) > 1e-6).map((s) => s.name);
      if ((P.outItems[k] || 0) > 1e-6) rooms.push("outside");
      where = rooms.join(", ") || "outside";
    }
    rows.push({ key: k, name: f.name, icon: f.icon, q, units: unitsOf(k, q), kcal: q * f.kcal, days, where, egg, group: f.group });
  }
  return rows.sort((a, b) => b.units - a.units);
}
export { DAY_KCAL, foodSplit, eggFood, lotsOf };
