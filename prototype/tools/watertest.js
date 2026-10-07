// Purified and un-purified water (src/sim/water.js; worm.js purifyDaily / drinkHour; economy.js baseDaily):
// - two supplies: water ("Purified water") and rawwater ("Un-purified water", 1 kg, half the value);
// - what a base draws from the land (its well, wells, a stream, rain catchers, claimed wells) comes in un-purified;
// - each day before drinking the boiler purifies the day's drinking, each water filter WORM.PURIFY_FILTER (10), a
//   shelter's lit fire like the boiler; people drink purified water first, then un-purified water (the worm's chance on
//   that share), crops get un-purified water first; thirst counts both; bases never spend purification tablets;
// - a team drinks purified water first; its un-purified water is safe through a filter carried, at a lit camp fire,
//   with tablets (one per 10), else drunk as it is; Fetch water brings un-purified water; packing takes purified water
//   first, and a tube of tablets when asked (the autopilot: water hauls and trips of more than two days);
// - trade: un-purified water at about half; groups keep one water pool and never sell un-purified water;
// - save/load, an old save without rawwater.
// Usage: node tools/watertest.js [seed]
import { createWorld, hub, atBase, residents, day } from "../src/sim/world.js";
import { SUPPLIES, SUPPLY_KEYS, GEAR } from "../src/sim/data.js";
import { newItem } from "../src/sim/inventory.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition, carriedAny, takeAny } from "../src/sim/parties.js";
import { basesDaily, waterNeed, waterOutlook, waterProduction, waterCapacity } from "../src/sim/economy.js";
import { WORM, baseWater, purifyCap, purifyDaily, drinkHour, addWormWater, teamWaterHow, wormTeamHour, wormDaily, baseTabCount, teamTabCount, packTablets, TABS_TRIP_DAYS, boilerUse } from "../src/sim/worm.js";
import { RAW, waterIn, drawWater, takeTeamWater, moveWater, teamWaterIn, stockHas, useStock } from "../src/sim/water.js";
import { teamNeedsHour, teamWater } from "../src/sim/needs.js";
import { fetchWater, besideWater } from "../src/sim/orders.js";
import { sellPrice, buyPrice, available, marketLists, poolKey } from "../src/sim/trade.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { LOCATIONS } from "../src/sim/data.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { tickHour } from "../src/sim/world.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(t);
const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;
const t0 = Date.now();
function withNums(obj, patch, fn) {
  const keep = {};
  for (const k of Object.keys(patch)) { keep[k] = obj[k]; obj[k] = patch[k]; }
  try { return fn(); } finally { Object.assign(obj, keep); }
}
// A hub on ground at infection `inf` (its tile and the ring around it), no filter, no boiler, everyone resting.
function world(inf = 0, s = seed) {
  const st = createWorld({ seed: s, factionCount: 5 });
  st.started = true; st.visitorsOff = true; st.noWanderers = true;
  const h = hub(st);
  for (const id of [h.tile, ...st.grid.neighbors(h.tile)]) { st.tiles[id].infection = inf; st.tiles[id].infBase = inf; }
  h.armory = h.armory.filter((it) => !(it && GEAR[it.key] && (GEAR[it.key].water || GEAR[it.key].tabs)));
  for (const p of atBase(st, h.id)) { p.role = "rest"; p.station = null; p.traits = []; if (p.gear.tool && GEAR[p.gear.tool.key].water) p.gear.tool = null; p.worm = null; p.health = 100; }
  Object.assign(h.stock, { food: 300, water: 0, [RAW]: 0, meds: 40, scrap: 100, wood: 0, fuel: 0, preserved: 0 });
  st.herds = []; st.hordes.length = 0;
  return { st, h };
}
function team(st, h, tile, n = 2) {
  const members = atBase(st, h.id).slice(0, n);
  const p = { id: 90000 + st.parties.length, owner: "player", kind: "expedition", mission: "scavenge", members: members.map((s) => s.id), supplies: { food: 20, water: 0, [RAW]: 0, meds: 0 }, cargo: { supplies: {}, gear: [] }, path: [tile], idx: 0, progress: 0, phase: "waiting", stance: "normal", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false, dest: tile, departed: st.hour };
  for (const s of members) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return { p, members };
}
const caught = (people) => people.filter((s) => s.worm).length;
const clearAll = (people) => { for (const s of people) s.worm = null; };

// ---------- 1. the supplies ----------
section("The two supplies (data.js)");
{
  const w = SUPPLIES.water, r = SUPPLIES[RAW];
  check(w && w.name === "Purified water" && r && r.name === "Un-purified water", `names: "${w.name}" and "${r.name}"`);
  check(r.weight === 1 && w.weight === 1 && near(r.value, w.value / 2) && r.cat === "water", `same weight (1 kg), un-purified at half the value (${r.value} vs ${w.value}), both in the water category`);
  check(SUPPLY_KEYS.includes("water") && SUPPLY_KEYS.includes(RAW), "both are SUPPLY_KEYS (listed, carried, traded, stored)");
  const o = { water: 5, [RAW]: 7 };
  check(waterIn(o) === 12 && stockHas(o, "water") === 12 && stockHas(o, "food") === 0, "waterIn / stockHas count both kinds");
  let d = drawWater(o, 8);
  check(d.pure === 5 && d.raw === 3 && o.water === 0 && o[RAW] === 4, "drawWater: purified first (5 purified + 3 un-purified)");
  const o2 = { water: 5, [RAW]: 7 };
  d = drawWater(o2, 8, { rawFirst: true });
  check(d.raw === 7 && d.pure === 1, "drawWater rawFirst: un-purified first (crops, recipes, a fire)");
  const o3 = { water: 2, [RAW]: 3 };
  useStock(o3, "water", 4);
  check(o3[RAW] === 0 && o3.water === 1, "a recipe's water uses un-purified water first");
  const to = {};
  moveWater({ water: 3, [RAW]: 10 }, to, 6);
  check(to.water === 3 && to[RAW] === 3, "moveWater keeps the kinds apart, purified first");
  const loot = Object.entries(LOCATIONS).filter(([, l]) => l.loot[RAW] > 0).map(([k]) => k);
  check(loot.includes("farm") && loot.includes("campground") && loot.length <= 3 && ["supermarket", "diner", "pharmacy"].every((k) => LOCATIONS[k].loot.water > 0 && !LOCATIONS[k].loot[RAW]), `rain barrels only at ${loot.join(", ")}; bottled water in shops stays purified`);
}

// ---------- 2. a base's day: production, purification, drinking ----------
section("A base: production comes in un-purified; purification; drinking order; thirst counts both");
{
  const { st, h } = world(0);
  const prod = waterProduction(st, h);
  basesDaily(st);
  const drank = h.drank;
  check(prod.total > 0 && !(h.stock.water > 0) && h.stock[RAW] > 0, `the well and the rest (${prod.total} a day) come in un-purified: ${h.stock.water || 0} purified, ${h.stock[RAW]} un-purified after a day`);
  check(drank && drank.pure === 0 && drank.raw > 0, `with nothing to purify it, everyone drank un-purified water (${drank && drank.raw}) rather than go thirsty`);
  check(!(h.thirstDays > 0), "nobody went thirsty: un-purified water counts for thirst");
  const wo = waterOutlook(st, h);
  check(wo.stock === waterIn(h.stock) && wo.raw === h.stock[RAW] && wo.pure === (h.stock.water || 0), `the outlook counts both (stock ${wo.stock} = ${wo.pure} + ${wo.raw})`);
  // Drinking order: purified first.
  const need = waterNeed(st, h).people;
  Object.assign(h.stock, { water: 3, [RAW]: 0 });
  const cap = waterCapacity(h);
  h.stock[RAW] = 0;
  basesDaily(st);
  check(h.drank.pure === 3 && near(h.drank.raw, need - 3, 0.2), `3 purified in store: drunk first, the rest (${h.drank.raw}) un-purified (need ${need})`);
  // The tanks hold both together: production fills only up to the capacity of both.
  Object.assign(h.stock, { water: cap, [RAW]: 0 });
  const before = waterIn(h.stock);
  const p0 = waterProduction(st, h).total;
  basesDaily(st);
  check(waterIn(h.stock) <= before + 0.01 && p0 > 0, `full tanks of purified water: no room for the well's water (${before} → ${waterIn(h.stock).toFixed(1)})`);
  // Thirst: nothing of either kind.
  const { st: s2, h: h2 } = world(0);
  for (const id of s2.grid.neighbors(h2.tile)) if (s2.tiles[id].terrain === "water") s2.tiles[id].terrain = "plains";
  h2.buildings = h2.buildings.filter((b) => !["well", "rain_catcher"].includes(b.type));
  h2.tier = 0; h2.fire = false; // a shelter: no well of its own (economy.js ownWell), away from any river
  basesDaily(s2);
  check(h2.thirstDays > 0, `no water of either kind: thirst (day ${h2.thirstDays})`);
  // Crops drink un-purified water first.
  const { st: s3, h: h3 } = world(0);
  let tried = 0;
  while (waterNeed(s3, h3).crops <= 0 && tried++ < 40) { Object.assign(h3.stock, { water: 500, [RAW]: 0 }); basesDaily(s3); }
  if (waterNeed(s3, h3).crops > 0) {
    const crops = waterNeed(s3, h3).crops, n3 = waterNeed(s3, h3).people, made = waterProduction(s3, h3).total;
    Object.assign(h3.stock, { water: n3 + 50, [RAW]: 0 });
    basesDaily(s3);
    // People drank purified water only; the crops took the day's un-purified water first.
    check(h3.drank.raw === 0 && (h3.stock[RAW] || 0) <= Math.max(0, made - crops) + 0.2, `crops (${crops}) are watered with the un-purified water first (${(h3.stock[RAW] || 0).toFixed(1)} un-purified left of ${made} made)`);
  } else check(true, "no crops needed water in 40 days here (crop check skipped)");
}

// ---------- 3. purification at a base ----------
section("Purification at a base: boiler, filters, a shelter's fire");
{
  const { st, h } = world(0.8);
  const people = residents(st, h.id);
  let cap = purifyCap(st, h);
  check(cap.total === 0 && cap.drink > 0, `no boiler, no filter: nothing purified (the day's drinking ${cap.drink})`);
  h.armory.push(newItem("waterfilter"));
  cap = purifyCap(st, h);
  check(cap.filters === WORM.PURIFY_FILTER && cap.nFilters === 1, `one water filter purifies ${WORM.PURIFY_FILTER} a day`);
  people[0].gear.tool = newItem("waterfilter");
  cap = purifyCap(st, h);
  check(cap.filters === 2 * WORM.PURIFY_FILTER && cap.nFilters === 2, "a second one held by someone at the base: 20 a day");
  h.stock[RAW] = 100; h.stock.water = 0;
  const q = purifyDaily(st, h);
  check(q === 20 && h.stock.water === 20 && h.stock[RAW] === 80, `purifyDaily: 20 of 100 un-purified become purified (${h.stock.water} / ${h.stock[RAW]})`);
  h.armory = h.armory.filter((it) => it.key !== "waterfilter"); people[0].gear.tool = null;
  addBuilding(h, "boiler");
  h.stock.wood = 900; h.stock.water = 0; // firewood of 0.1 kg
  const q2 = purifyDaily(st, h);
  const c2 = purifyCap(st, h, true);
  check(q2 === c2.drink && h.boilerBurn.wood > 0 && h.purified.boiler === c2.drink, `a lit boiler purifies the day's drinking for everyone here (${q2}, burning ${h.boilerBurn.wood} firewood)`);
  h.stock.wood = 30; h.stock.water = 500;
  purifyDaily(st, h);
  check(h.boilerBurn.wood === 0 && h.boiling !== false, "with the day's drinking purified in store it burns nothing (stands ready)");
  // The boiler's firewood plan: the share of days it burns falls with filters.
  h.stock.water = 0;
  const u0 = boilerUse(st, h);
  h.armory.push(newItem("waterfilter"));
  const u1 = boilerUse(st, h);
  check(u0.active && u0.share === 1 && (u1.active ? u1.share < 1 : true), `the firewood plan counts the share of days it burns (no filter ${u0.share}, a filter ${u1.active ? u1.share : "covers it"})`);
  h.armory = h.armory.filter((it) => it.key !== "waterfilter");
  // A shelter's fire purifies like the boiler.
  const { st: s2, h: sh } = world(0.8);
  sh.tier = 0; sh.fire = true; sh.buildings = sh.buildings.filter((b) => b.type !== "boiler");
  const c3 = purifyCap(s2, sh);
  check(c3.fire === c3.drink && c3.drink > 0, `a shelter's lit fire purifies the day's drinking (${c3.fire})`);
  sh.fire = false;
  check(purifyCap(s2, sh).fire === 0, "out: nothing");
}

// ---------- 4. the worm at a base: the un-purified share; tablets never used ----------
section("The worm at a base: the share drunk un-purified; bases never spend tablets");
{
  const { st, h } = world(0.9);
  const people = residents(st, h.id);
  const N = people.length;
  h.armory.push(newItem("puritabs"), newItem("puritabs"));
  h.drank = { day: day(st), pure: N, raw: 0 };
  let n = withNums(WORM, { WATER: 1 }, () => { wormDaily(st); return caught(people); });
  check(n === 0, "all of the day's drinking purified: nobody catches it (WATER pinned to 100%)");
  h.drank = { day: day(st), pure: 0, raw: N };
  n = withNums(WORM, { WATER: 1 }, () => { wormDaily(st); return caught(people); });
  check(n > 0 && baseTabCount(st, h) === 20, `all of it un-purified: ${n} of ${N} caught it; the tablets in the armory were not touched (${baseTabCount(st, h)})`);
  clearAll(people);
  // Three whole days on infected ground with no boiler or filter and tablets in the armory: never spent.
  Object.assign(h.stock, { water: 0, [RAW]: 200 });
  for (let i = 0; i < 3; i++) basesDaily(st);
  check(baseTabCount(st, h) === 20 && !st.log.some((l) => /Purification tablets kept the water safe/.test(l.text)), "three days of base life: the tablets stay in the armory (they are for the road)");
  const w = baseWater(st, h);
  check(!w.safe && w.rawShare > 0 && !/tablet/.test(w.why), `the water row: ${w.why}`);
}

// ---------- 5. a team on the road ----------
section("A team: purified first; filter, tablets, camp fire or nothing for the un-purified water");
{
  const { st, h } = world(0.9);
  const tile = st.grid.neighbors(h.tile).find((id) => st.tiles[id].terrain !== "water") ?? h.tile;
  const { p, members } = team(st, h, tile, 2);
  // The real hour: thirsty people drink purified water first.
  for (const s of members) s.thirst = 20;
  Object.assign(p.supplies, { water: 1, [RAW]: 10 }); p.wormEggs = 1;
  check(teamWater(p) === 11 && carriedAny(p, "water") === 11 && teamWaterIn(p) === 11, "the team's water counts both kinds (gauges, checks)");
  withNums(WORM, { WATER: 0 }, () => teamNeedsHour(st, p, members));
  check(p.supplies.water === 0 && p.supplies[RAW] < 10, `teamNeedsHour drank the purified water first, then un-purified (${p.supplies.water} / ${p.supplies[RAW].toFixed(2)} left)`);
  // The order for un-purified water: filter → camp fire → tablets → as it is.
  const tube = newItem("puritabs");
  p.cargo.gear.push(tube);
  p.cargo.gear.push(newItem("waterfilter"));
  Object.assign(p.supplies, { water: 0, [RAW]: 20 }); p.wormEggs = 1;
  check(teamWaterHow(st, p) === "filter", "a filter carried: \"filter\"");
  let n = withNums(WORM, { WATER: 24 }, () => { drinkHour(st, p, members, 5, 5); return caught(members); });
  check(n === 0 && tube.dur === 10, "drunk through the filter: safe, no tablet spent");
  p.cargo.gear = p.cargo.gear.filter((it) => it.key !== "waterfilter");
  p.phase = "task"; p.task = { type: "camp" }; p.campFire = true;
  check(teamWaterHow(st, p) === "fire", "camping with the fire lit: \"fire\"");
  n = withNums(WORM, { WATER: 24 }, () => { drinkHour(st, p, members, 5, 5); return caught(members); });
  check(n === 0 && tube.dur === 10, "boiled at the camp fire: safe, no tablet spent while camping");
  const raw0 = p.supplies[RAW], pure0 = p.supplies.water;
  st.tiles[tile].infection = 0.2; // under the camping threshold: only the boiling is under test
  wormTeamHour(st, p, members);
  check(near(raw0 - p.supplies[RAW], WORM.BOIL) && near(p.supplies.water - pure0, WORM.BOIL), `and the fire boils ${WORM.BOIL} an hour into purified water`);
  p.phase = "waiting"; p.task = null;
  check(teamWaterHow(st, p) === "tabs", "on the road with tablets: \"tabs\"");
  n = withNums(WORM, { WATER: 24 }, () => { drinkHour(st, p, members, 10, 10); return caught(members); });
  check(n === 0 && tube.dur === 9, `tablets: one per ${WORM.TABS_WATER} un-purified water drunk (${10 - tube.dur} used), safe`);
  check(/dropped a purification tablet into the un-purified water/.test(st.log[0].text), `logged: "${st.log[0].text}"`);
  p.cargo.gear = [];
  p.tabWater = 0;
  check(teamWaterHow(st, p) === "unsafe", "nothing to purify it with: \"unsafe\"");
  n = withNums(WORM, { WATER: 24 }, () => { drinkHour(st, p, members, 5, 5); return caught(members); });
  check(n === members.length, "drunk as it is: the worm's dice (pinned)");
  clearAll(members);
  p.wormEggs = 0;
  check(teamWaterHow(st, p) === "unsafe", "un-purified water from clean ground is still \"unsafe\": any of it can carry the worm");
  n = withNums(WORM, { WATER: 24, RAW_BASE: 0 }, () => { drinkHour(st, p, members, 5, 5); return caught(members); });
  check(n === 0, "no eggs in it: the eggs' part does nothing (RAW_BASE 0)");
  n = withNums(WORM, { WATER: 0, RAW_BASE: 24 }, () => { drinkHour(st, p, members, 5, 5); return caught(members); });
  check(n === members.length, "but RAW_BASE (any un-purified water) does (pinned)");
  clearAll(members);
  const t = takeTeamWater({ supplies: { water: 2, [RAW]: 1 }, cargo: { supplies: { water: 3, [RAW]: 4 } } }, 6);
  check(t.pure === 5 && t.raw === 1, "takeTeamWater: purified first (packed, then found), then un-purified");
  const pp = { supplies: { water: 1, [RAW]: 5 }, cargo: { supplies: {} } };
  takeAny(pp, "water", 3);
  check(pp.supplies.water === 0 && pp.supplies[RAW] === 3, "a cost paid in water (sharing, prisoners): purified first");
}

// ---------- 6. Fetch water, wells ----------
section("Fetch water and wells give un-purified water");
{
  const { st, h } = world(0.6);
  const shore = st.tiles.find((t) => besideWater(st, t.id) && st.grid.distance(t.id, h.tile) <= 8 && t.id !== h.tile);
  if (shore) {
    const { p } = team(st, h, shore.id, 2);
    p.path = [shore.id];
    const text = fetchWater(st, p);
    check((p.cargo.supplies[RAW] || 0) > 0 && !(p.cargo.supplies.water > 0) && /un-purified water/.test(text), `Fetch water: ${p.cargo.supplies[RAW]} un-purified water in the cargo ("${text}")`);
    check(p.wormEggs >= 0, `its eggs are the shore's (${p.wormEggs})`);
  } else check(true, "no shore near this hub (skipped)");
  // A well on a claim next to the base: hauled into the un-purified stock.
  const nb = st.grid.neighbors(h.tile).find((id) => st.tiles[id].terrain !== "water");
  st.claims = { [nb]: { owner: "player", since: 0, well: { yield: 6, left: 1000, dug: 0 } } };
  const prod = waterProduction(st, h);
  Object.assign(h.stock, { water: 0, [RAW]: 0 });
  const was = h.stock[RAW];
  basesDaily(st);
  check(prod.hauled >= 6 && h.stock[RAW] > was && !(h.stock.water > 0), `a claimed well (+${prod.hauled} hauled) fills the un-purified stock`);
}

// ---------- 7. packing ----------
section("Packing at a base: purified water first, a tube of tablets when asked");
{
  const { st, h } = world(0);
  Object.assign(h.stock, { water: 5, [RAW]: 20 });
  h.armory.push(newItem("puritabs"));
  const dest = st.grid.within(h.tile, 4).find((id) => st.grid.distance(id, h.tile) === 3 && st.tiles[id].terrain !== "water");
  const crew = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 10 }, tabs: true });
  const p = res.party;
  check(p && p.supplies.water === 5 && p.supplies[RAW] === 5 && h.stock.water === 0 && h.stock[RAW] === 15, `10 water packed: the 5 purified first, then 5 un-purified (base left ${h.stock.water} / ${h.stock[RAW]})`);
  check(p && teamTabCount(st, p) === 10 && baseTabCount(st, h) === 0, "tabs: true packs the armory's tube into the cargo");
  const r2 = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 1).map((s) => s.id), dest, mission: "scavenge", stance: "normal", supplies: { water: 30 } });
  check(!!r2.error && /water/.test(r2.error), `more water than both kinds hold: refused ("${r2.error}")`);
  check(TABS_TRIP_DAYS === 2, "trips of more than two days take a tube (worm.js TABS_TRIP_DAYS)");
  // The autopilot packs a tube for its trips of more than two days or a water haul (when the armory has one).
  const { st: s2, h: h2 } = world(0, seed + 1);
  for (let i = 0; i < 4; i++) h2.armory.push(newItem("puritabs"));
  Object.assign(h2.stock, { water: 200 });
  setAutopilot(s2, true, "balanced");
  let packed = false, long = false;
  for (let hr = 0; hr < 24 * 20 && !packed; hr++) {
    tickHour(s2);
    s2.cards.length = 0;
    for (const q of s2.parties) {
      if (q.owner !== "player" || !q.ap) continue;
      const days = (q.plannedHours || 0) / 24;
      if (days > TABS_TRIP_DAYS || (q.plan && q.plan.steps || []).some((x) => x.kind === "water")) { long = true; if (teamTabCount(s2, q) > 0) packed = true; }
    }
  }
  check(!long || packed, long ? `the governor's long trip or water haul took a tube (${packed})` : "no trip of more than two days in 20 days (skipped)");
}

// ---------- 8. trade ----------
section("Trade: un-purified water at about half; groups keep one pool and sell only purified water");
{
  const { st } = world(0);
  const f = st.factions.find((x) => x.alive);
  f.stock.water = f.pop * 3;
  const pw = sellPrice(st, f, "water", 0, 10), pr = sellPrice(st, f, RAW, 0, 10);
  check(near(pr / pw, 0.5, 0.02), `they pay about half for un-purified water (${pr.toFixed(2)} vs ${pw.toFixed(2)} a unit)`);
  check(buyPrice(st, f, RAW, 0, 1) > 0 && available(f, RAW) === 0 && available(f, "water") >= 0, "they never sell un-purified water (available 0)");
  check(poolKey(RAW) === "water" && poolKey("food") === "food", "one water pool for groups (poolKey)");
  const m = marketLists(st, f);
  check(!m.wants.some((x) => x.key === RAW) && !m.surplus.some((x) => x.key === RAW) && m.prices[RAW], "their market lists ask for and offer purified water only (un-purified is priced)");
  const before = f.stock.water;
  f.stock.water = 0;
  const thirsty = sellPrice(st, f, RAW, 0, 1);
  f.stock.water = before;
  check(thirsty > pr, "a thirsty group pays more for it too (its pool is what it needs)");
}

// ---------- 9. save and load ----------
section("Save and load");
{
  const { st, h } = world(0.9);
  Object.assign(h.stock, { water: 12, [RAW]: 34 });
  const tile = st.grid.neighbors(h.tile)[0];
  const { p } = team(st, h, tile, 1);
  Object.assign(p.supplies, { water: 3, [RAW]: 7 }); p.cargo.supplies[RAW] = 5; p.wormEggs = 0.4;
  const save = JSON.parse(JSON.stringify(serializeState(st)));
  const ld = deserializeState(JSON.parse(JSON.stringify(save)));
  const h2 = hub(ld), p2 = ld.parties.find((x) => x.id === p.id);
  check(h2.stock.water === 12 && h2.stock[RAW] === 34 && p2.supplies[RAW] === 7 && p2.cargo.supplies[RAW] === 5 && p2.wormEggs === 0.4 && ld.rawWater === 1, "both kinds come back (base, team supplies and cargo, the eggs)");
  // An old save: no rawwater anywhere, no mark, a team's water marked unboiled.
  const old = JSON.parse(JSON.stringify(save));
  const text = JSON.stringify(old);
  const stripped = JSON.parse(text.replace(/"rawwater":[0-9.]+,?/g, "").replace(/,}/g, "}").replace(/"rawWater":1,?/g, ""));
  const ld2 = deserializeState(stripped);
  const h3 = hub(ld2), p3 = ld2.parties.find((x) => x.id === p.id);
  check(ld2.rawWater === 1 && h3.stock.water === 12 && h3.stock[RAW] === 0, `an old save: the base's water stays purified (${h3.stock.water}), un-purified 0`);
  check(p3 && p3.supplies[RAW] === 0 && p3.cargo.supplies[RAW] === 0 && p3.supplies.water === 3, "the team's supplies and cargo get rawwater 0, its water stays purified");
  // The old model's unboiled water on a team becomes un-purified water (cargo first).
  const o2 = JSON.parse(JSON.stringify(stripped));
  const ld3pre = JSON.stringify(o2).replace(`"wormEggs":0.4`, `"wormEggs":0.4,"wormWater":4`);
  const ld3 = deserializeState(JSON.parse(ld3pre));
  const p4 = ld3.parties.find((x) => x.id === p.id);
  check(p4 && p4.supplies[RAW] + p4.cargo.supplies[RAW] === 3 && p4.supplies.water === 0 && p4.wormWater === undefined, `the old unboiled water (4 marked, 3 carried) became un-purified water (${p4 && p4.supplies[RAW]} packed, ${p4 && p4.cargo.supplies[RAW]} found; purified left ${p4 && p4.supplies.water})`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
