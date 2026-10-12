// The food chain (src/sim/foodlog.js, src/sim/foodchain.js, the base window's Food tab: src/ui/foodchain.js): the
// numbers it shows against the systems that make them.
// Usage: node tools/foodchaintest.js [seed] [days]      (default seed 5, 10 in-game days of the governor)
// - the ledger books by phase and kind: a team's venison is hunting, its fish fishing, its cans scavenging; a trade is
//   trade; a pen's eggs the farm's; cooking and the racks are made / used; eating and spoiling are booked once (no
//   double count at the next mark); a mark with nothing changed books nothing;
// - a governor's game: every day's row closes (in − out + made − used = the change in the hub's days of food), the
//   7-day window sums its rows and matches the stock change since the window began, the rows are kept to
//   FOODLOG.keep, eaten matches the base's own record of the day's eating (base.eatDay), spoiled the day's spoiled
//   food (base.spoiledToday);
// - the stores: days on hand = foodIn ÷ the heads; the rooms hold what storage.js placeFood puts in them; spoils
//   within 7 days = every lot whose shelf left ÷ where it sits today is 7 days or less; won't be eaten in time =
//   storage.js spoilForecast;
// - the fires: hours left = firewood ÷ (each fire's burn a day ÷ 24): a shelter's fire goes out at that hour
//   (woodcutting.js shelterFire, hour by hour); the hub's parts are the cook fire's, the stove's, the boiler's and the
//   heating's own numbers;
// - the kitchen: each station's bills and why they can or cannot go (cooking.js batchWhy), "nothing cooks" without one;
// - the verdict: food outside → build a root cellar; raw meat about to spoil → cook it before day N; no fire → a cook
//   fire; how long it lasts at the measured rate;
// - save and load: the log is saved with the game; a save without it starts it on its first hour;
// - the Food tab renders for a hub, an outpost and a camp (no undefined / NaN), and the Help and Codex entries.
import { createWorld, hub, tickHour, day, atBase, residents } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { FOODS, foodIn, unitsOf, qtyOf, addFood, takeFood } from "../src/sim/foods.js";
import { placeFood, spoilForecast, eatFromStore, storageDaily, STORE } from "../src/sim/storage.js";
import { FOODLOG, foodLogOf, foodMark, foodWindow, rowNet, foodSpoiled } from "../src/sim/foodlog.js";
import { foodChain, chainStores, chainFires, lotPlaces } from "../src/sim/foodchain.js";
import { foodUse, heatUse } from "../src/sim/upkeep.js";
import { addBuilding, count } from "../src/sim/buildings.js";
import { addBill, stationState, ensureStations, fireCrew, COOK } from "../src/sim/cooking.js";
import { kitchenWood } from "../src/sim/kitchen.js";
import { boilerUse } from "../src/sim/worm.js";
import { shelterFire, fireBurn, WOOD } from "../src/sim/woodcutting.js";
import { CABIN } from "../src/sim/hunting.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { foodChainTab } from "../src/ui/foodchain.js";
import { helpTopics } from "../src/ui/help.js";
import { codexEntries } from "../src/ui/codex.js";
import { clearFood, addDays } from "./foodkit.js";

const SEED = Number(process.argv[2] || 5);
const DAYS = Number(process.argv[3] || 10);
let fails = 0, passed = 0;
const VERBOSE = !!process.env.VERBOSE;
const check = (ok, msg) => { if (ok) { passed++; if (VERBOSE) console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const BAD = /\b(undefined|NaN)\b|\[object [A-Za-z]+\]/;
const t0 = performance.now();

// A hub with n plain people at rest, water and wood, and no food (the log's baseline taken now).
function mk(n = 6, seed = SEED) {
  const st = createWorld({ seed, factionCount: 4 });
  st.started = true; st.autoCombat = true; st.visitorsOff = true;
  const h = hub(st);
  for (const s of atBase(st, h.id)) { s.role = "rest"; s.pinned = true; s.traits = []; s.conditions = []; s.health = 100; }
  Object.assign(h.stock, { water: 200, rawwater: 0, wood: 500 });
  clearFood(h);
  st.hour = 24 * 5 + 6;
  foodLogOf(st, h);
  return { st, h, ppl: atBase(st, h.id) };
}
const lastRow = (h) => h.foodLog.rows[h.foodLog.rows.length - 1];

// ======================================================================
section("The ledger books by phase and kind");
{
  const { st, h } = mk();
  check(h.foodLog && h.foodLog.v === 1 && h.foodLog.rows.length === 0, "a new log: the baseline, no rows");
  foodMark(st, h, "team");
  check(h.foodLog.rows.length === 0, "a mark with nothing changed books nothing");
  addFood(h, "f_venison", qtyOf("f_venison", 3), { state: st });
  addFood(h, "f_fish", qtyOf("f_fish", 2), { state: st });
  addFood(h, "f_beans", qtyOf("f_beans", 4), { state: st });
  addFood(h, "f_berries", qtyOf("f_berries", 1), { state: st });
  foodMark(st, h, "team");
  let r = lastRow(h);
  check(near(r.in.hunt, 3, 1e-6) && near(r.in.fish, 2, 1e-6) && near(r.in.scav, 4, 1e-6) && near(r.in.forage, 1, 1e-6), `a team home: venison hunting, fish fishing, cans scavenging, berries foraging (${JSON.stringify(r.in)})`);
  addFood(h, "f_rice", qtyOf("f_rice", 2), { state: st });
  foodMark(st, h, "player");
  check(near(lastRow(h).in.trade, 2, 1e-6), "between the hours (the trade window): trade");
  addFood(h, "f_eggs", qtyOf("f_eggs", 1), { state: st });
  addFood(h, "f_jarred", qtyOf("f_jarred", 1.5), { state: st });
  foodMark(st, h, "station");
  r = lastRow(h);
  check(near(r.in.farm, 1, 1e-6) && near(r.made, 1.5, 1e-6), "the stations: a pen's eggs are the farm's, the preserving room's jars are made");
  takeFood(h, 2, { only: (k) => k === "f_venison", state: st });
  addFood(h, "f_simplemeal", qtyOf("f_simplemeal", 2.5), { state: st });
  foodMark(st, h, "cook");
  r = lastRow(h);
  check(near(r.used, 2, 1e-6) && near(r.made, 4, 1e-6), "the cooking bills: ingredients used, meals made");
  const before = foodIn(h.stock);
  const miss = eatFromStore(h, 3, st);
  const ate = lastRow(h).out.eaten || 0;
  foodMark(st, h, "pack");
  r = lastRow(h);
  check(miss < 1e-9 && near(ate, 3, 1e-6) && near(r.out.eaten, 3, 1e-6) && !(r.out.pack > 0), `eating is booked as it happens and not again at the next mark (eaten ${ate}, packs ${r.out.pack || 0})`);
  check(near(before - foodIn(h.stock), 3, 1e-6), "and it came out of the stores");
  check(near(Object.values(r.tier).reduce((a, v) => a + v, 0), 3, 1e-6), `what was eaten by its quality tier (${JSON.stringify(r.tier)})`);
  takeFood(h, 1, { only: (k) => k === "f_beans", state: st });
  foodMark(st, h, "pack");
  check(near(lastRow(h).out.pack, 1, 1e-6), "a pack topped up from the stores");
  takeFood(h, 0.5, { only: (k) => k === "f_rice", state: st });
  foodMark(st, h, "team");
  check(near(lastRow(h).out.sent, 0.5, 1e-6), "a team packed and set out: sent");
  // spoiling: the lots thrown out, booked once
  addFood(h, "f_greens", qtyOf("f_greens", 2), { state: st, left: 0.01 });
  foodMark(st, h, "farm");
  const out = storageDaily(st, h);
  foodSpoiled(st, h, out.items);
  foodMark(st, h, "storage");
  r = lastRow(h);
  check(out.spoiled >= 2 - 1e-6 && near(r.out.spoiled, out.spoiled, 1e-6) && !(r.out.other > 0), `spoiled food booked once (${out.spoiled.toFixed(2)} days)`);
  const sum = h.foodLog.rows.reduce((a, x) => a + rowNet(x), 0);
  check(near(sum, foodIn(h.stock), 1e-6), `the rows close: in − out + made − used = the stock's change (${sum.toFixed(4)} vs ${foodIn(h.stock).toFixed(4)})`);
}

// ======================================================================
section(`A governor's game, ${DAYS} days (seed ${SEED})`);
const G = (() => {
  const st = createWorld({ seed: SEED, factionCount: 4 });
  st.started = true;
  setAutopilot(st, true);
  const h = hub(st);
  foodLogOf(st, h);
  const at = new Map([[st.hour, foodIn(h.stock)]]); // hour → the hub's days of food at its end
  const eatDays = new Map(), spoilDays = new Map();
  for (let i = 0; i < 24 * DAYS; i++) {
    tickHour(st);
    at.set(st.hour, foodIn(h.stock));
    if (st.hour % 24 === 0) {
      if (h.eatDay) eatDays.set(h.eatDay.day, h.eatDay.eaten);
      if (h.spoiledToday) spoilDays.set(Math.floor(st.hour / 24), h.spoiledToday.units);
    }
  }
  return { st, h, at, eatDays, spoilDays };
})();
{
  const { st, h, at } = G;
  const L = h.foodLog;
  check(L.rows.length <= FOODLOG.keep && L.rows.length >= Math.min(FOODLOG.keep, DAYS), `the rows are kept to ${FOODLOG.keep} (${L.rows.length})`);
  const w = foodWindow(st, h);
  const today = Math.floor((st.hour - 1) / 24) + 1;
  const inWin = L.rows.filter((r) => r.d > today - FOODLOG.window);
  const tot = (pick) => inWin.reduce((a, r) => a + pick(r), 0);
  check(near(w.totalIn, tot((r) => Object.values(r.in).reduce((a, v) => a + v, 0)), 1e-6) && near(w.totalOut, tot((r) => Object.values(r.out).reduce((a, v) => a + v, 0)), 1e-6) && near(w.made, tot((r) => r.made), 1e-6), "the window sums its rows");
  const startHour = Math.max(L.from, (today - FOODLOG.window) * 24);
  const f0 = at.get(startHour);
  const change = foodIn(h.stock) - f0;
  const net = w.totalIn - w.totalOut + w.made - w.used;
  check(f0 != null && near(net, change, 0.05), `the window's in − out + made − used = the hub's food now − at the window's start (${net.toFixed(3)} vs ${change.toFixed(3)})`);
  check(near(w.days, (st.hour - startHour) / 24, 1e-9) && w.days <= FOODLOG.window + 1e-9, `the window covers ${w.days.toFixed(2)} days`);
  // each closed day against the hour marks at its ends
  let worst = 0;
  for (const r of inWin) {
    const a = at.get((r.d - 1) * 24), b = at.get(r.d * 24);
    if (a == null || b == null) continue;
    worst = Math.max(worst, Math.abs(rowNet(r) - (b - a)));
  }
  check(worst < 0.02, `every whole day closes: its row's balance = the day's change (worst ${worst.toFixed(4)})`);
  let eatGap = 0, eatN = 0;
  for (const r of inWin) if (G.eatDays.has(r.d) && residents(st, h.id).length) { eatGap = Math.max(eatGap, Math.abs((r.out.eaten || 0) - G.eatDays.get(r.d))); eatN++; }
  check(eatN > 0 && eatGap < 0.6, `eaten a day matches the base's own count of the residents' eating (${eatN} days, worst ${eatGap.toFixed(3)}: prisoners, children and guests eat on top)`);
  let spGap = 0;
  for (const r of inWin) if (G.spoilDays.has(r.d)) spGap = Math.max(spGap, Math.abs((r.out.spoiled || 0) - G.spoilDays.get(r.d)));
  check(spGap < 0.06, `spoiled a day matches the day's thrown-out food (worst ${spGap.toFixed(3)})`);
  const c = foodChain(st, h);
  const srcSum = c.sources.reduce((a, s) => a + s.units, 0);
  check(near(srcSum + (w.in.back || 0), w.totalIn, 1e-6), "the Sources column lists every way food came in (packs back apart)");
  check(c.sources.some((s) => s.units > 0), `food came in: ${c.sources.filter((s) => s.units > 0.05).map((s) => `${s.name} ${s.units.toFixed(1)}`).join(", ")}`);
  check(c.verdict && /^(Food lasts about \d+ days? at this rate|Food is holding at this rate|Out of food)/.test(c.verdict.text), `the verdict: "${c.verdict.text}"`);
  const net2 = w.net + ((w.out.pack || 0) - (w.in.back || 0)) / w.days;
  check(!isFinite(c.verdict.lasts) || near(c.verdict.lasts, c.stores.all / -net2, 1e-6), "how long it lasts: the food ÷ the measured net a day (the packs left out)");
  if (c.verdict.drain) check(c.verdict.drain.perDay >= Math.max(0, ...["spoiled", "sent", "ship", "other"].map((k) => (w.out[k] || 0) / w.days)) - 1e-9, `the biggest drain is the biggest (${c.verdict.drain.name})`);
  const html = foodChainTab(st, h);
  check(!BAD.test(html) && (html.match(/class="fc-col"/g) || []).length === 5, "the hub's Food tab: five columns, no undefined / NaN");
}

// ======================================================================
section("The stores");
{
  const { st, h } = mk(5);
  addDays(h, 30, "f_beans");
  addDays(h, 6, "f_potatoes");
  addDays(h, 4, "f_venison", { left: 0.6 }); // a hunt from two days ago: it spoils in a day or two even in the cellar
  addDays(h, 2, "f_bread", { left: 1.5 });
  addDays(h, 300, "f_squash"); // more fresh food than the hub's cellar holds: some sits outside
  const s = chainStores(st, h);
  const use = foodUse(st, h);
  check(s.heads === use.heads && s.heads > 0 && near(s.daysOnHand, foodIn(h.stock) / use.heads, 1e-9), `days on hand = foodIn ÷ heads (${s.daysOnHand.toFixed(2)} = ${foodIn(h.stock).toFixed(1)} ÷ ${use.heads})`);
  check(near(s.all, foodIn(h.stock), 1e-9) && near(s.fresh + s.stable, s.all, 1e-9), "fresh + keeps = all");
  const P = placeFood(st, h);
  for (const sp of P.spaces) { const r = s.rooms.find((x) => x.key === sp.key); check(r && near(r.held, sp.held, 1e-6) && r.cap === sp.cap, `${sp.name}: holds what placeFood puts in it (${r && r.held.toFixed(2)} / ${sp.cap})`); }
  const out = s.rooms.find((x) => x.key === "outside"), keeps = s.rooms.find((x) => x.key === "keeps");
  check(out && near(out.held, P.outside, 1e-6) && P.outside > 1, `outside: ${out && out.held.toFixed(1)} days (placeFood ${P.outside.toFixed(1)})`);
  check(keeps && near(keeps.held, P.stable, 1e-6), "the dry store: the food that keeps");
  // every lot by hand: shelf left ÷ where it sits today (a hunting cabin's smokehouse for raw meat)
  let soon = 0;
  for (const k in h.foodLots) for (const l of h.foodLots[k]) {
    const f = FOODS[k];
    const fac = (P.place.get(l) ?? P.outFactor) * ((f.group === "rawmeat" || f.group === "rawfish") && count(h, "huntcabin") ? CABIN.spoil : 1);
    if (l.left / fac <= 7) soon += unitsOf(k, l.q);
  }
  check(soon > 0 && near(s.spoil7.units, soon, 1e-6), `spoils within 7 days = the lots whose shelf runs out within 7 days (${s.spoil7.units.toFixed(2)} vs ${soon.toFixed(2)})`);
  const fc = spoilForecast(st, h, P);
  check(near(s.waste7, fc.soon.reduce((a, x) => a + unitsOf(x.key, x.q), 0), 1e-6), `won't be eaten in time = storage.js spoilForecast's week (${s.waste7.toFixed(2)})`);
  check(near(lotPlaces(st, h).reduce((a, x) => a + x.u, 0), foodIn(h.stock), 1e-6), "every lot has a place");
  const bread = s.rooms.find((r) => r.items.f_bread);
  check(bread && bread.next <= 1.5 / bread.factor + 1e-6, `the bread's room spoils next in ${bread && bread.next.toFixed(2)} days`);
  const c = foodChain(st, h);
  check(c.verdict.tips.some((t) => /root cellar/.test(t)), `food outside: build a root cellar (${c.verdict.tips.join(" | ")})`);
  check(c.verdict.tips.some((t) => /(Eat or dry|Cook) the (raw )?venison before day \d+/.test(t)), `raw meat about to spoil: before day N (${c.verdict.tips.join(" | ")})`);
  check(!c.kitchen.stations.length && c.kitchen.warn.some((t) => /nothing cooks/.test(t)) && c.verdict.tips.length <= 2, "no cook fire, no Kitchen: nothing cooks");
  h.foodLots.f_squash = []; delete h.stock.f_squash;
  addBuilding(h, "cookhouse");
  ensureStations(st, h);
  addBill(st, h, "cookhouse", "simple");
  const c2 = foodChain(st, h);
  const first = Math.floor(c2.stores.lots.filter((x) => x.k === "f_venison").reduce((a, x) => Math.min(a, x.days), Infinity));
  check(c2.verdict.tips.some((t) => /Cook the (raw )?venison before day (\d+)/.test(t) && Number(/day (\d+)/.exec(t)[1]) === day(st) + first && /Cook fire/.test(t)), `with a cook fire: cook the venison before the day its first lot spoils, at the Cook fire (${c2.verdict.tips.join(" | ")})`);
}

// ======================================================================
section("The fires");
{
  // a shelter: its fire burns by the hour and goes out when the woodpile runs dry
  const { st, h } = mk(3);
  h.tier = 0; h.fire = true;
  h.stock.wood = 7;
  const f = chainFires(st, h);
  const burn = fireBurn(st, h.tile, WOOD.fire.shelter);
  check(f.parts.length === 1 && f.parts[0].key === "fire" && near(f.parts[0].perDay, burn, 1e-9), `a shelter's fire: ${burn} firewood a day`);
  check(near(f.hours, 7 / (burn / 24), 1e-9) && near(f.perHour, burn / 24, 1e-9), `hours left = firewood ÷ the burn an hour (${f.hours.toFixed(2)} h)`);
  let hrs = 0;
  while (h.fire !== false && hrs < 500) { shelterFire(st, h); if (h.fire !== false) hrs++; }
  check(Math.abs(hrs - Math.floor(f.hours)) <= 1, `and it went out after ${hrs} hours (shown ${Math.floor(f.hours)})`);
  const out = chainFires(st, h);
  check(out.parts[0].lit === false && out.perDay === 0 && !isFinite(out.hours), "out: it burns nothing");
  const c = foodChain(st, h);
  check(c.verdict.tips.some((t) => /out: light it/.test(t)) || c.verdict.tips.length === 2, `the fire out: light it (${c.verdict.tips.join(" | ")})`);
  // the hub: a cook fire with a bill, the Kitchen's stove, the boiler, the heating: each by its own numbers
  const w = mk(8);
  addBuilding(w.h, "cookhouse");
  addBuilding(w.h, "canteen");
  w.ppl[0].role = "cook"; w.ppl[0].skills.cooking = 4;
  ensureStations(w.st, w.h);
  addBill(w.st, w.h, "cookhouse", "simple");
  addDays(w.h, 10, "f_venison");
  const hf = chainFires(w.st, w.h);
  const want = { cookfire: fireCrew(w.st, w.h).reduce((a, c) => a + c.hours, 0) * COOK.fireWood, stove: kitchenWood(w.st, w.h).need };
  const b = boilerUse(w.st, w.h); if (b.active) want.boiler = b.wood * (b.share ?? 1);
  const ht = heatUse(w.st, w.h); if (ht.total > 0) want.heat = ht.wood;
  const got = Object.fromEntries(hf.parts.map((p) => [p.key, p.perDay]));
  check(Object.keys(want).every((k) => near(got[k], want[k], 1e-9)) && Object.keys(got).every((k) => k in want), `the hub's fires: ${hf.parts.map((p) => `${p.name} ${p.perDay.toFixed(1)}`).join(", ")}`);
  check(near(hf.perDay, Object.values(want).reduce((a, v) => a + v, 0), 1e-9) && near(hf.hours, w.h.stock.wood / (hf.perDay / 24), 1e-9), `firewood ${w.h.stock.wood} lasts ${hf.hours.toFixed(1)} hours at ${hf.perDay.toFixed(1)} a day`);
  const k = foodChain(w.st, w.h).kitchen;
  const cf = k.stations.find((s) => s.key === "cookhouse"), kc = k.stations.find((s) => s.key === "canteen");
  check(cf && cf.bills.length === 1 && cf.bills[0].can && cf.runs, `the cook fire's Simple meal bill can go (${cf && cf.bills[0].why})`);
  check(kc && kc.bills.length >= 1 && kc.crew.length === 1, "the Kitchen: its default bill and its cook");
  w.h.stock.wood = 0;
  const k2 = foodChain(w.st, w.h).kitchen.stations.find((s) => s.key === "cookhouse");
  check(k2 && !k2.bills[0].can && /firewood/.test(k2.bills[0].why), `no firewood: the cook fire's bill cannot go (${k2 && k2.bills[0].why})`);
}

// ======================================================================
section("Save and load");
{
  const { st, h } = G;
  const s2 = loadFromString(saveToString(st));
  const h2 = hub(s2);
  check(JSON.stringify(h2.foodLog) === JSON.stringify(h.foodLog), "the log is saved with the game");
  delete h2.foodLog;
  const s3 = loadFromString(saveToString(s2));
  const h3 = hub(s3);
  check(!h3.foodLog, "an older save has no log");
  for (let i = 0; i < 30; i++) tickHour(s3);
  check(h3.foodLog && h3.foodLog.v === 1 && h3.foodLog.rows.length >= 1, "it starts on the first hour after loading");
  const c = foodChain(s3, h3);
  check(c.days > 0 && c.days < 1.5 && !BAD.test(foodChainTab(s3, h3)), `its window covers the hours since (${c.days.toFixed(2)} days)`);
}

// ======================================================================
section("The Food tab on every kind of base; Help and Codex");
{
  const { st, h } = mk(4);
  const fresh = foodChainTab(st, h);
  check(!BAD.test(fresh) && /today so far|recording/.test(fresh), "a base with no record yet");
  const camp = mk(3);
  camp.h.tier = 0; camp.h.fire = true; camp.h.stock.wood = 3;
  addDays(camp.h, 5, "f_fish");
  check(!BAD.test(foodChainTab(camp.st, camp.h)), "a camp");
  const G2 = G.st.bases.find((b) => b.type === "outpost");
  if (G2) check(!BAD.test(foodChainTab(G.st, G2)), "an outpost");
  const help = helpTopics();
  const t = help.find((x) => x.id === "the-food-chain");
  check(t && /spoil/i.test(t.html) && /lunch/i.test(t.html) && /No hot food/.test(t.html) && /firewood/.test(t.html), "Help: The food chain (spoilage, the lunch break, No hot food, fires)");
  const cx = codexEntries();
  check(cx.some((e) => /food chain/i.test(e.title || e.name || "")), "Codex: the food chain");
}

console.log(`\n${passed} passed, ${fails} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
