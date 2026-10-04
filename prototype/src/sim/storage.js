// Food storage and preserving (every base). Replaces the old flat spoilage rate.
//
// Every base has room to store fresh food: the hub starts with a small underground cellar (200), an outpost with a
// pantry (40). Buildings add room: Root cellar +200 each (up to 2), Storehouse +150 (dry goods), Cold store +150
// (an ice house: the best place for food in winter, poor in summer). Food fills the best storage of the day first.
// Food in storage spoils slowly (the rate depends on the kind of storage and the temperature); food above the
// room is "stored outside" (tarps, crates, the back of a truck) and spoils much faster, faster still in heat and
// rain, slower when it freezes.
//
// Preserved food (supply key "preserved": jarred, dried or smoked food, threshed grain and dry beans) barely spoils
// and needs no cellar room. Eating draws fresh food first (it is the food that rots) and preserved food only once
// the fresh is gone. It comes from:
//   - the Preserving kitchen (a workshop station, buildings.js RECIPES.preserve): an operator jars 9 fresh food a
//     day into 8 preserved (9 with Farming 8+), using 3 water, 1 scrap (stove fuel and lids) and 4 empty jars;
//   - Drying racks (no operator): each dries 4 surplus fresh food into 3 preserved a day (half on wet days), taking
//     food stored outside first, else only food above 15 days of eating;
//   - dry crops (farming.js: wheat, winter wheat, dry beans), loot (canned goods) and trade.
// Jars (supply key "jars") are found in kitchens, shops and farms. A jar holds 2 rations; when jarred food is eaten
// at a base, 85% of the jars come back (the rest break or lose their lids). Jars that leave with the food (trade,
// trips, raiders) do not come back.
import { log, residents, atBase } from "./world.js";
import { count } from "./buildings.js";
import * as Weather from "./weather.js";

export const STORE = { hubCellar: 200, pantry: 40, rootCellar: 200, storehouse: 150, coldStore: 150 };
// Spoilage per day at a mild temperature (5–24 °C mean): cellar, dry store, outside, preserved.
export const RATE = { cellar: 0.005, dry: 0.008, outside: 0.03, preserved: 0.001 };
export const RACK = { food: 4, out: 3, keepDays: 15 };   // drying rack: food in, preserved out, days of eating kept fresh
export const JAR_RATIONS = 2, JAR_RETURN = 0.85;

const wx = (state) => (Weather.weather ? Weather.weather(state) : { hi: 20, lo: 10, key: "clear", rain: 0 });
const meanTemp = (w) => ((w.hi ?? 20) + (w.lo ?? 10)) / 2;
const isWet = (w) => w.key === "rain" || w.key === "storm" || (w.rain || 0) > 0;
const mouths = (state, base) => residents(state, base.id).length;
const eatRate = (state, base) => mouths(state, base) * (Weather.foodNeedFactor ? Weather.foodNeedFactor(state) : 1);

// ---------- rates ----------
// Daily spoilage of each kind of storage in today's weather (temp: mean °C; wet: rain or a storm).
export function storeRate(kind, temp, { wet = false, heat = false } = {}) {
  const cold = temp < 5, hot = temp > 24 || heat;
  if (kind === "cellar") return RATE.cellar * (cold ? 0.6 : hot ? 1.3 : 1);
  if (kind === "dry") return RATE.dry * (cold ? 0.6 : hot ? 1.4 : 1) * (wet ? 1.15 : 1);
  if (kind === "cold") return temp < 0 ? 0.001 : temp < 5 ? 0.002 : temp < 15 ? 0.005 : 0.012;
  if (kind === "preserved") return RATE.preserved * (hot ? 1.5 : 1);
  // Outside: frozen food keeps fairly well; heat and rain rot it fast.
  return RATE.outside * (temp < 0 ? 0.3 : cold ? 0.5 : hot ? 1.6 : 1) * (wet ? 1.4 : 1);
}

// The storage a base has: [{ key, name, kind, cap }]. The hub's own cellar and the root cellars share one row.
export function storeSpaces(base) {
  const out = [];
  const cellar = (base.type === "hub" ? STORE.hubCellar : 0) + count(base, "cellar") * STORE.rootCellar;
  if (cellar > 0) out.push({ key: "cellar", name: count(base, "cellar") ? (base.type === "hub" ? "Cellars" : "Root cellar") : "Cellar", kind: "cellar", cap: cellar });
  if (base.type !== "hub") out.push({ key: "pantry", name: "Pantry", kind: "dry", cap: STORE.pantry });
  if (count(base, "storehouse")) out.push({ key: "storehouse", name: "Storehouse", kind: "dry", cap: count(base, "storehouse") * STORE.storehouse });
  if (count(base, "coldstore")) out.push({ key: "coldstore", name: "Cold store", kind: "cold", cap: count(base, "coldstore") * STORE.coldStore });
  return out;
}
export const storeCapacity = (base) => storeSpaces(base).reduce((a, s) => a + s.cap, 0);

// Where the fresh food sits today and what it loses: the best storage of the day fills first, the rest is outside.
// Returns { fresh, preserved, cap, inside, outside, spaces: [{ name, cap, held, rate, loss }], outRate, outLoss,
// presRate, presLoss, spoil (fresh + preserved lost a day), rate (average daily rate of the fresh food) }.
export function foodStore(state, base, fresh = base.stock.food || 0) {
  const w = wx(state);
  const t = meanTemp(w), wet = isWet(w), heat = w.key === "heat";
  const spaces = storeSpaces(base).map((s) => ({ ...s, rate: storeRate(s.kind, t, { wet, heat }) })).sort((a, b) => a.rate - b.rate);
  let left = Math.max(0, fresh), loss = 0;
  for (const s of spaces) {
    s.held = Math.min(left, s.cap);
    s.loss = s.held * s.rate;
    left -= s.held;
    loss += s.loss;
  }
  const outRate = storeRate("outside", t, { wet, heat });
  const outLoss = left * outRate;
  const preserved = Math.max(0, base.stock.preserved || 0);
  const presRate = storeRate("preserved", t, { heat });
  const presLoss = preserved * presRate;
  const cap = spaces.reduce((a, s) => a + s.cap, 0);
  const f = Math.max(0, fresh);
  return {
    fresh: f, preserved, cap, inside: f - left, outside: left, spaces, outRate, outLoss, presRate, presLoss,
    freshLoss: loss + outLoss, spoil: loss + outLoss + presLoss, rate: f > 0 ? (loss + outLoss) / f : spaces.length ? spaces[0].rate : outRate,
  };
}

// Fresh food lost a day at a given mean temperature (planning: the winter outlook), dry weather assumed.
export function spoilFresh(base, fresh, temp) {
  let left = Math.max(0, fresh), loss = 0;
  for (const s of storeSpaces(base).map((x) => ({ ...x, rate: storeRate(x.kind, temp) })).sort((a, b) => a.rate - b.rate)) {
    const held = Math.min(left, s.cap);
    loss += held * s.rate;
    left -= held;
  }
  return loss + left * storeRate("outside", temp);
}

// Food a base can eat: fresh plus preserved.
export const edibleFood = (base) => Math.max(0, base.stock.food || 0) + Math.max(0, base.stock.preserved || 0);

// ---------- eating ----------
// Takes `amount` from fresh food first, then preserved (jars come back). Returns what could not be covered.
export function eatFromStore(base, amount) {
  const st = base.stock;
  let need = Math.max(0, amount);
  const fresh = Math.min(need, Math.max(0, st.food || 0));
  st.food = (st.food || 0) - fresh;
  need -= fresh;
  if (need > 0 && (st.preserved || 0) > 0) {
    const take = Math.min(need, st.preserved);
    jarsBack(base, take);
    st.preserved -= take;
    need -= take;
  }
  return need;
}

// Jars in use follow the jarred share of the preserved stock: eating jarred food frees its jars, most come back.
function jarsBack(base, eaten) {
  const pres = Math.max(0, base.stock.preserved || 0);
  const inUse = Math.min(base.jarsInUse || 0, pres / JAR_RATIONS);
  if (!(inUse > 0) || !(pres > 0)) return;
  const freed = Math.min(inUse, (eaten * inUse) / pres);
  base.jarsInUse = inUse - freed;
  base.stock.jars = (base.stock.jars || 0) + freed * JAR_RETURN;
}
export const jarsInUse = (base) => Math.min(base.jarsInUse || 0, Math.max(0, base.stock.preserved || 0) / JAR_RATIONS);

// ---------- daily ----------
// Drying racks (no operator, someone must live here): surplus fresh food → preserved.
export function rackPlan(state, base, fresh = base.stock.food || 0) {
  const racks = count(base, "smoker");
  if (!racks || !atBase(state, base.id).length) return { racks, take: 0, out: 0, wet: false };
  const w = wx(state);
  const wet = isWet(w) || w.key === "fog" || w.key === "snow" || w.key === "blizzard";
  const st = foodStore(state, base, fresh);
  const spare = Math.max(st.outside, fresh - eatRate(state, base) * RACK.keepDays);
  const take = Math.max(0, Math.min(racks * RACK.food * (wet ? 0.5 : 1), spare));
  return { racks, take, out: take * (RACK.out / RACK.food), wet };
}

// Once a day per base (economy.js, after eating): racks dry their share, then fresh and preserved food spoil.
// Returns { spoiled, dried, store } for the stats; logs when food starts (and stops) spoiling outside.
export function storageDaily(state, base) {
  const st = base.stock;
  const rack = rackPlan(state, base);
  if (rack.take > 0) {
    st.food -= rack.take;
    st.preserved = (st.preserved || 0) + rack.out;
  }
  const store = foodStore(state, base);
  if (store.freshLoss > 0) st.food = Math.max(0, st.food - store.freshLoss);
  if (store.presLoss > 0) st.preserved = Math.max(0, st.preserved - store.presLoss);
  base.jarsInUse = jarsInUse(base); // jarred food that spoiled, was traded or taken leaves with its jars
  // Outposts ship their surplus to the hub every day: only food left outside for three days there is worth a word.
  const outside = store.outside >= 1;
  base.outsideDays = outside ? (base.outsideDays || 0) + 1 : 0;
  if (outside && !base.spoilingOutside && base.outsideDays >= (base.type === "hub" ? 1 : 3)) {
    log(state, `${base.name}: the food stores are full (${Math.floor(store.cap)}). ${Math.floor(store.outside)} food is stored outside and spoiling fast (${(Math.round(store.outLoss * 10) / 10)} a day). Build a root cellar, storehouse or cold store, eat it, or preserve it.`, "danger");
  } else if (!outside && base.spoilingOutside && store.fresh > 0) {
    log(state, `${base.name}: all the fresh food fits in the stores again.`, "info");
  }
  base.spoilingOutside = outside && (base.spoilingOutside || base.outsideDays >= (base.type === "hub" ? 1 : 3));
  return { spoiled: store.spoil, dried: rack.out, store };
}

// ---------- text ----------
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const n1 = (v) => Math.round((v || 0) * 10) / 10;
const pct = (r) => `${Math.round(r * 1000) / 10}%`;
// "in cellar 180/200, outside 40 (spoiling 2.3/day)" plus preserved and jars, for the base panel, Farming tab and top bar.
export function storeLine(state, base) {
  const s = foodStore(state, base);
  const where = s.spaces.length ? s.spaces.map((x) => `${x.name.toLowerCase()} ${n0(x.held)}/${x.cap}`).join(", ") : "no storage";
  const short = `in ${where}${s.outside >= 1 ? `, outside ${n0(s.outside)}` : ""} (spoiling ${n1(s.spoil)}/day)`;
  const pres = `preserved ${n0(s.preserved)}${(base.stock.jars || 0) >= 1 || jarsInUse(base) >= 1 ? ` · jars ${n0(base.stock.jars)} empty, ${n0(jarsInUse(base))} filled` : ""}`;
  const rates = s.spaces.map((x) => `${x.name} ${pct(x.rate)}`).concat([`outside ${pct(s.outRate)}`, `preserved ${pct(s.presRate)}`]).join(", ");
  const tip = `Food storage: ${s.cap} room for fresh food (${s.spaces.map((x) => `${x.name} ${x.cap}`).join(", ") || "none"}). Fresh food fills the best storage of the day first; anything above the room is stored outside and spoils much faster (more in heat and rain, less when it freezes). Spoiling a day today: ${rates}. Preserved food (jarred, dried, grain and dry beans) needs no room and barely spoils; it is eaten once the fresh food is gone. More room: Root cellar (+${STORE.rootCellar}), Storehouse (+${STORE.storehouse}), Cold store (+${STORE.coldStore}, best in winter). Preserve surplus in a Preserving kitchen (needs jars) or on Drying racks.`;
  return { short, pres, tip, cls: s.outside >= 1 ? "danger" : "", store: s };
}
