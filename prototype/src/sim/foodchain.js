// The food chain of a base (user request 2026-10-12: "Show the food chain on the base window: food on hand, how fast it
// spoils, cooking bills and fuel for the fire, so a player can see why food runs out"). Everything the base window's
// Food tab (ui/foodchain.js) shows, as numbers, read from the systems that make them (nothing here changes the world):
//   sources  the last FOODLOG.window days of food in by where it came from (foodlog.js: farms and harvests, hunting
//            and snares, fishing, foraging, scavenging and teams home, trade and gifts, your other bases) and what is
//            coming: the crops ripening and when (farming.js nextHarvests);
//   stores   days of food on hand for everyone fed here (foods.js foodIn ÷ the heads), fresh and what keeps, kg and
//            kcal, by food room (storage.js placeFood, the same fill: the fastest to spoil in the coldest room first)
//            with the days until its next lot spoils, outside and the dry store; what runs out of shelf in the next
//            7 days (every lot's shelf left ÷ where it sits today) and how much of it will not be eaten in time
//            (storage.js spoilForecast);
//   kitchen  the cooking stations (cooking.js), their bills and whether each can go now (the cook, ingredients,
//            purified water, wood: cooking.js batchWhy), what went into the pots and came out over the window;
//   fires    the woodpile and what burns it a day (a camp's or shelter's fire, a cook fire, the Kitchen's stove, the
//            water boiler, the heating), so the hours of wood left;
//   eating   the heads, eaten a day, the ration level, the quality mix of what was eaten, the days since hot food;
//   losses   spoiled, eaten raw, sent out with teams, into the packs everyone carries (and what came back), shipped,
//            used or taken;
//   verdict  "Food lasts about N days at this rate; biggest drain: X" and one or two things to do about it.
import { FOODS, foodIn, foodSplit, unitsOf, foodKg } from "./foods.js";
import { placeFood, spoilForecast, STORE, jarsInUse } from "./storage.js";
import { foodWindow, FOODLOG } from "./foodlog.js";
import { residents, day } from "./world.js";
import { foodUse, heatUse } from "./upkeep.js";
import { nextHarvests, farmFoodPerDay } from "./farming.js";
import { stationsAt, stationState, stationName, stationWhy, kitchenCrew, fireCrew, batchWhy, billDone, billWants, modeText, COOK, COOK_RECIPES } from "./cooking.js";
import { hasKitchen, kitchenCold, kitchenWood } from "./kitchen.js";
import { boilerUse } from "./worm.js";
import { fireDayBurn } from "./woodcutting.js";
import { fireLit } from "./fieldheat.js";
import { count, isShelter, canBuild } from "./buildings.js";
import { rationKey, RATION_LEVELS } from "./meals.js";
import { EAT } from "./eating.js";
import { CABIN } from "./hunting.js";

export const SOURCES = [
  ["farm", "🌾", "Farms and harvests", "The plots' harvests, and a pen's eggs and milk"],
  ["hunt", "🦌", "Hunting and snares", "The base's hunters (traps, bows, guns) and the game teams bring home"],
  ["fish", "🐟", "Fishing", "The base's fishers and the fish teams bring home"],
  ["forage", "🫐", "Foraging", "Berries, nuts, mushrooms, greens, roots and honey"],
  ["scav", "🎒", "Scavenging and teams home", "Base scavenging and the food teams bring home from their runs"],
  ["trade", "🤝", "Trade and gifts", "Bought, given, paid in food, unloaded by hand"],
  ["ship", "🚚", "From your other bases", "The outposts' surplus run and supply lines"],
  ["other", "📦", "Other", "Anything else that came in"],
];
export const DRAINS = { eaten: "eating", spoiled: "spoilage", sent: "food sent out with teams", ship: "food shipped to your other bases", other: "food used up or taken", kitchen: "cooking and preserving" };
export const TIER_MIX = [
  ["meal", "Cooked meals", ["simple", "fine", "lavish"]],
  ["survival", "Rations", ["survival"]],
  ["preserved", "Preserved", ["preserved"]],
  ["plain", "Cans, dry goods, produce", ["plain"]],
  ["raw", "Raw meat and fish", ["raw"]],
];
const SPOIL_DAYS = 7;
const EPS = 1e-6;
const r1 = (v) => Math.round((v || 0) * 10) / 10;

// The lot's shelf used a day where it sits today (storage.js lotFactor: the room's factor, a hunting cabin's smokehouse
// for raw meat and fish).
const lotFactor = (base, P) => (k, f, l) => (P.place.get(l) ?? P.outFactor) * ((f.group === "rawmeat" || f.group === "rawfish") && count(base, "huntcabin") ? CABIN.spoil : 1);

// Every lot with where it sits and its days to spoil: [{ k, q, u, days, room (a space key, "outside" or "keeps") }].
// The rooms are filled as storage.js placeFood fills them (the same order), so the rows add up to its rooms.
export function lotPlaces(state, base, P = placeFood(state, base)) {
  const L = base.foodLots || {};
  const fac = lotFactor(base, P);
  const out = [];
  const fresh = [];
  for (const k in L) {
    const f = FOODS[k];
    if (!f) continue;
    for (const l of L[k]) {
      if (!(l.q > EPS)) continue;
      const days = l.left / Math.max(1e-6, fac(k, f, l));
      if (f.stable) out.push({ k, q: l.q, u: unitsOf(k, l.q), days, room: "keeps", egg: !!l.egg });
      else fresh.push({ k, f, l, u: unitsOf(k, l.q), days });
    }
  }
  fresh.sort((a, b) => a.f.shelf - b.f.shelf || a.l.left - b.l.left);
  let si = 0, room = P.spaces.length ? P.spaces[0].cap : 0;
  for (const x of fresh) {
    let u = x.u;
    while (u > 1e-9 && si < P.spaces.length) {
      const take = Math.min(u, room);
      if (take > 1e-9) { out.push({ k: x.k, q: (x.l.q * take) / x.u, u: take, days: x.days, room: P.spaces[si].key, egg: !!x.l.egg }); u -= take; room -= take; }
      if (room <= 1e-9) { si++; room = si < P.spaces.length ? P.spaces[si].cap : 0; }
    }
    if (u > 1e-9) out.push({ k: x.k, q: (x.l.q * u) / x.u, u, days: x.days, room: "outside", egg: !!x.l.egg });
  }
  return out;
}

// The stores: { all, fresh, stable, heads, perDay, daysOnHand (all ÷ heads: a ration a head), daysAtUse (all ÷ the
// day's eating), kg, kcal, rooms: [{ key, name, kind, cap, held, factor, kg, kcal, next, soon }], spoil7: { units,
// items: { key: q } } (lots whose shelf runs out within 7 days), waste7 (of them, days of food that will not be eaten in
// time), waste (all that will), spoilPerDay (the forecast, a day over the next 30), outside, jars }.
export function chainStores(state, base) {
  const P = placeFood(state, base);
  const fc = spoilForecast(state, base, P);
  const split = foodSplit(base.stock);
  const use = foodUse(state, base);
  const lots = lotPlaces(state, base, P);
  const rooms = [
    ...P.spaces.map((s) => ({ key: s.key, name: s.name, kind: s.kind, cap: s.cap, factor: s.factor })),
    { key: "outside", name: "Outside", kind: "outside", cap: 0, factor: P.outFactor },
    { key: "keeps", name: "Keeps (dry)", kind: "stable", cap: 0, factor: P.stableFactor },
  ].map((r) => ({ ...r, held: 0, kg: 0, kcal: 0, next: Infinity, soon: 0, items: {} }));
  const byKey = Object.fromEntries(rooms.map((r) => [r.key, r]));
  const spoil7 = { units: 0, items: {} };
  for (const x of lots) {
    const r = byKey[x.room];
    if (!r) continue;
    const f = FOODS[x.k];
    r.held += x.u; r.kg += x.q * f.kg; r.kcal += x.q * f.kcal; r.items[x.k] = (r.items[x.k] || 0) + x.q;
    r.next = Math.min(r.next, x.days);
    if (x.days <= SPOIL_DAYS) { r.soon += x.u; spoil7.units += x.u; spoil7.items[x.k] = (spoil7.items[x.k] || 0) + x.q; }
  }
  const waste7 = fc.soon.reduce((a, s) => a + unitsOf(s.key, s.q), 0);
  const heads = use.heads;
  return {
    all: split.all, fresh: split.fresh, stable: split.stable, heads, perDay: use.total,
    daysOnHand: heads > 0 ? split.all / heads : Infinity, daysAtUse: use.total > 0 ? split.all / use.total : Infinity,
    kg: foodKg(base.stock), kcal: split.all * 2000, rooms: rooms.filter((r) => r.cap > 0 || r.held > EPS || r.key === "outside"),
    spoil7, waste7, waste: fc.waste, spoilPerDay: fc.perDay, soon: fc.soon, outside: P.outside, cap: P.cap, temp: P.temp,
    jars: { empty: base.stock.jars || 0, filled: jarsInUse(base) }, lots,
  };
}

// The woodpile and what burns it: { wood, parts: [{ key, name, lit, perDay, note }], perDay, perHour, hours, days }.
// hours: the wood left at today's burn (Infinity with nothing burning).
export function chainFires(state, base) {
  const wood = Math.max(0, base.stock.wood || 0);
  const parts = [];
  const keys = stationsAt(base, state);
  if (isShelter(base)) {
    const lit = fireLit(base);
    parts.push({ key: "fire", name: base.type === "outpost" ? "Camp fire" : "Shelter fire", lit, perDay: lit ? fireDayBurn(state, base).total : 0, note: "warmth, boiled water and the cooking: it burns by the hour, more for every person here, on a cold night and in the frost, and goes out with the woodpile" });
  }
  if (keys.includes("cookhouse") && !(isShelter(base) && !count(base, "cookhouse"))) {
    const S = stationState(base, "cookhouse");
    const live = S.bills.some((b) => !b.paused && !billDone(b));
    const crew = live ? fireCrew(state, base) : [];
    const hrs = crew.reduce((a, c) => a + c.hours, 0);
    parts.push({ key: "cookfire", name: stationName(base, "cookhouse"), lit: live && hrs > 0, perDay: hrs * COOK.fireWood, note: `${COOK.fireWood} wood an hour it cooks (${COOK.fireHours} hours a day)` });
  }
  if (hasKitchen(base)) {
    const lit = !kitchenCold(base) && !base.stoveSave && residents(state, base.id).length > 0;
    parts.push({ key: "stove", name: "Kitchen stove", lit, perDay: lit ? kitchenWood(state, base).need : 0, note: "lit every day, more for every meal served" });
  }
  if (!isShelter(base)) {
    const b = boilerUse(state, base);
    if (b.active) parts.push({ key: "boiler", name: "Water boiler", lit: b.lit, perDay: b.wood * (b.share ?? 1), note: "boils the drinking water the filters do not cover" });
    const h = heatUse(state, base);
    if (h.total > 0) parts.push({ key: "heat", name: "Heating", lit: true, perDay: h.wood, note: "below 0°C (fuel when the wood runs out)" });
  }
  const perDay = parts.reduce((a, p) => a + p.perDay, 0);
  const perHour = perDay / 24;
  return { wood, parts, perDay, perHour, hours: perHour > EPS ? wood / perHour : Infinity, days: perDay > EPS ? wood / perDay : Infinity };
}

// The kitchen: { stations: [{ key, name, why, crew: [{ name, lvl, hours }], bills: [{ name, out, mode, can, why }],
// runs (a bill can go now) }], water: { pure, raw }, made, used (the window's), warn: [text] }.
export function chainKitchen(state, base, win = foodWindow(state, base)) {
  const stations = stationsAt(base, state).map((key) => {
    const S = stationState(base, key);
    const why = stationWhy(state, base, key);
    const crew = why ? [] : key === "canteen" ? kitchenCrew(state, base) : fireCrew(state, base);
    const noWood = key === "cookhouse" && !(isShelter(base) && !count(base, "cookhouse")) && !((base.stock.wood || 0) > 1e-6); // a cook fire burns wood by the hour (cooking.js runStation); a shelter's own fire is paid by the hour
    const bills = S.bills.map((b) => {
      const R = COOK_RECIPES[b.recipe];
      if (!R) return null;
      const block = b.paused ? "paused" : billDone(b) ? "done" : !billWants(state, base, b) ? "enough in store" : why || (!crew.length ? (key === "canteen" ? "no cook on duty" : "nobody home to tend it") : noWood ? "no wood for the cook fire" : batchWhy(state, base, key, b));
      return { id: b.id, recipe: b.recipe, name: R.name, out: R.out, mode: modeText(state, base, b), can: !block, idle: block === "enough in store" || block === "done" || block === "paused", why: block, last: b.why || "" };
    }).filter(Boolean);
    return { key, name: stationName(base, key), why, crew: crew.map((c) => ({ id: c.s.id, name: c.s.name, lvl: c.lvl, hours: c.hours })), bills, runs: bills.some((b) => b.can) };
  });
  const warn = [];
  if (!stations.length) warn.push("No cook fire, no Kitchen: nothing cooks here. Raw meat and fish are eaten raw, and nobody gets hot food.");
  for (const s of stations) if (s.why) warn.push(`${s.name}: ${s.why}. Nothing cooks on it.`);
  return { stations, water: { pure: Math.max(0, base.stock.water || 0), raw: Math.max(0, base.stock.rawwater || 0) }, made: win.made, used: win.used, warn };
}

// Eating: { heads (living here), fed (everyone fed from these stores), need (a day), eaten (a day, measured), ration,
// rationName, mix: [{ key, name, units, share }], raw (a day eaten raw), hot: { max, avg, cold (people with the
// "No hot food" thought) } }.
export function chainEating(state, base, win = foodWindow(state, base)) {
  const use = foodUse(state, base);
  const ppl = residents(state, base.id);
  const days = Math.max(win.days, EPS);
  const tot = Object.values(win.tier).reduce((a, v) => a + v, 0);
  const mix = TIER_MIX.map(([key, name, tiers]) => { const u = tiers.reduce((a, t) => a + (win.tier[t] || 0), 0); return { key, name, units: u, share: tot > EPS ? u / tot : 0 }; });
  const today = Math.floor((state.hour - 1) / 24); // eating.js's day (s.food.hot)
  const since = ppl.map((s) => (s.food && s.food.hot != null ? Math.max(0, today - s.food.hot) : 0));
  const cold = ppl.filter((s) => (s.thoughts || []).some((t) => t.id === "cold" && t.until > state.hour)).length;
  const rk = rationKey(state, base);
  return {
    heads: ppl.length, fed: use.heads, need: use.total, eaten: win.days > 0 ? (win.out.eaten || 0) / days : 0,
    ration: rk, rationName: rk === "short" ? "Short rations" : RATION_LEVELS[rk].name, mix, raw: win.days > 0 ? win.raw / days : 0,
    hot: { max: since.length ? Math.max(...since) : 0, avg: since.length ? since.reduce((a, v) => a + v, 0) / since.length : 0, cold },
  };
}

// The whole chain for the Food tab and tools/foodchaintest.js.
export function foodChain(state, base) {
  const win = foodWindow(state, base, FOODLOG.window);
  const days = Math.max(win.days, EPS);
  const per = (v) => (win.days > 0 ? (v || 0) / days : 0);
  const stores = chainStores(state, base);
  const fires = chainFires(state, base);
  const kitchen = chainKitchen(state, base, win);
  const eating = chainEating(state, base, win);
  const sources = SOURCES.map(([key, icon, name, about]) => ({ key, icon, name, about, units: win.in[key] || 0, perDay: per(win.in[key]) }));
  const harvests = nextHarvests(state, base).filter((h) => h.inDays <= 30);
  const losses = {
    spoiled: win.out.spoiled || 0, raw: win.raw, sent: win.out.sent || 0, pack: win.out.pack || 0, back: win.in.back || 0, ship: win.out.ship || 0, other: win.out.other || 0,
    kitchen: Math.max(0, win.used - win.made),
  };
  const verdict = chainVerdict(state, base, { win, per, stores, fires, kitchen, eating, losses });
  return { day: day(state), win, days: win.days, sources, harvests, farmPerDay: farmFoodPerDay(state, base), stores, kitchen, fires, eating, losses, verdict };
}

// "Food lasts about N days at this rate; biggest drain: X" and one or two things to do.
function chainVerdict(state, base, { win, per, stores, fires, kitchen, eating, losses }) {
  const measured = win.days >= 1;
  const drains = [
    ["eaten", per(win.out.eaten)], ["spoiled", per(losses.spoiled)], ["sent", per(losses.sent)],
    ["ship", per(losses.ship)], ["other", per(losses.other)], ["kitchen", per(losses.kitchen)],
  ].sort((a, b) => b[1] - a[1]);
  if (!measured) { drains.length = 0; drains.push(["eaten", stores.perDay], ["spoiled", stores.spoilPerDay]); drains.sort((a, b) => b[1] - a[1]); }
  const burn = measured ? per(win.out.eaten) + per(losses.spoiled) : stores.perDay + stores.spoilPerDay; // without new food
  const net = measured ? win.net + per(losses.pack) - per(losses.back) : -burn; // the packs everyone carries are still theirs: filled once, topped up a little (left out of the rate)
  const lasts = net < -0.05 ? stores.all / -net : Infinity;
  const without = burn > EPS ? stores.all / burn : Infinity;
  const drain = drains[0] && drains[0][1] > 0.05 ? { key: drains[0][0], name: DRAINS[drains[0][0]], perDay: drains[0][1] } : null;
  const next = drains[1] && drains[1][1] > 0.05 ? { key: drains[1][0], name: DRAINS[drains[1][0]], perDay: drains[1][1] } : null;
  let text;
  if (stores.all < 0.05 && !(net > 0)) text = "Out of food";
  else if (isFinite(lasts)) text = `Food lasts about ${Math.max(0, Math.floor(lasts))} day${Math.floor(lasts) === 1 ? "" : "s"} at this rate`;
  else text = `Food is holding at this rate (+${r1(net)} a day)${isFinite(without) ? `; with nothing coming in it would last about ${Math.floor(without)} days` : ""}`;
  if (drain) text += `; biggest drain: ${drain.name} (${r1(drain.perDay)} a day)`;
  return { text, lasts, without, net, burn, drain, next, measured, tips: chainTips(state, base, { stores, fires, kitchen, eating, losses, lasts, per }) };
}

// One or two concrete things to do, the most pressing first.
function chainTips(state, base, { stores, fires, kitchen, eating, losses, lasts, per }) {
  const tips = [];
  const d = day(state);
  const say = (pri, text) => tips.push({ pri, text });
  const cooks = kitchen.stations.length > 0;
  // Raw meat or fish about to spoil.
  const raw = stores.lots.filter((x) => FOODS[x.k].raw && x.days <= 3).sort((a, b) => a.days - b.days);
  if (raw.length) {
    const k = raw[0].k, u = raw.filter((x) => x.k === k).reduce((a, x) => a + x.u, 0);
    const by = d + Math.max(0, Math.floor(raw[0].days));
    if (u >= 0.5) {
      const st = kitchen.stations.find((s) => !s.why) || null;
      say(1, cooks
        ? `Cook the ${FOODS[k].name.toLowerCase()} before day ${by}: ${r1(u)} days of food of it spoil in ${r1(raw[0].days)} days${st ? ` (a Simple meal or Stew bill at the ${st.name} takes it)` : `, and ${kitchen.stations[0].name}: ${kitchen.stations[0].why}`}.`
        : `Eat or dry the ${FOODS[k].name.toLowerCase()} before day ${by} (${r1(u)} days of food spoil in ${r1(raw[0].days)} days): build a cook fire or drying racks, or craft a camp cook pot.`);
    }
  }
  if (!cooks && !tips.length) say(2, "Build a cook fire (or craft a camp cook pot: 3 scrap): nothing cooks here, so raw meat is eaten raw (food poisoning, −7 mood) and nobody gets hot food.");
  // The fire.
  if (fires.parts.length && fires.perDay > EPS && fires.hours < 48) say(fires.hours < 12 ? 0 : 2, `Bring in wood: ${Math.floor(fires.wood)} left burns ${r1(fires.perDay)} a day, about ${Math.floor(fires.hours)} hours. No fire, nothing cooks.`);
  const out = fires.parts.find((p) => (p.key === "fire" || p.key === "stove") && !p.lit);
  if (out) say(1, `The ${out.name.toLowerCase()} is out: light it (it needs wood) so the food can be cooked.`);
  // Spoilage.
  const spoil = per(losses.spoiled), eat = eating.eaten;
  if (stores.outside >= 1) {
    const cellar = canBuild(state, base, "cellar"), crates = canBuild(state, base, "crates"), house = canBuild(state, base, "storehouse");
    const what = cellar.ok ? `a root cellar (+${STORE.rootCellar} days of room, food keeps about three times as long)` : house.ok ? `a storehouse (+${STORE.storehouse} days of room)` : crates.ok ? `storage crates (+${STORE.crates} days of room)` : "more food rooms";
    say(1, `Build ${what}: ${Math.floor(stores.outside)} days of fresh food sit outside, where it spoils fastest.`);
  } else if (spoil > 0.25 && spoil > 0.1 * eat) {
    say(2, `${r1(spoil)} days of food spoil a day: eat the fresh food first, dry the surplus (drying racks) or cook it (meals keep a few days more in a cold room).`);
  }
  // Running out.
  if (isFinite(lasts) && lasts < 21) {
    const lean = eating.ration === "normal" ? " or set rations to Lean (food lasts a quarter longer)" : "";
    say(lasts < 7 ? 0 : 2, lasts < 1 ? "The food is about gone: put people on Farm, Hunt, Fish or Forage, send a team to scavenge, or trade for food." : `Put more people on Farm, Hunt, Fish or Forage${lean}: food runs out in about ${Math.floor(lasts)} day${Math.floor(lasts) === 1 ? "" : "s"}.`);
  }
  // Hot food.
  if (eating.hot.max >= EAT.cold[0]) say(3, `${eating.hot.cold || "Some"} ${eating.hot.cold === 1 ? "person has" : "people have"} had no hot food in ${eating.hot.max} days (mood ${EAT.coldV[0]}, ${EAT.coldV[1]} after ${EAT.cold[1]}): get a meal cooked.`);
  return tips.sort((a, b) => a.pri - b.pri).slice(0, 2).map((t) => t.text);
}
