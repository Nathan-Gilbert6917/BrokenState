// Foraging (src/sim/foraging.js, orders.js, plans.js, work.js, hunting.js huntingDaily, autopilot.js planForage /
// landFoodAct, ui/alerts.js, ui/hardcore.js, ui/expedition.js, ui/ui.js, main.js).
// Usage: node tools/foragetest.js [seed] [autopilot games] [days] (defaults 42, 6 hardcore games, 40 days).
// - The land: wild food by terrain (forest > farmland > hills > suburbs > city) and season (autumn and summer
//   plentiful, spring some, winter almost nothing), time of day; the yields per forager-hour (a table).
// - Foragers: Farming and Scouting, the Forager perk, the hurt; diminishing hands on one tile.
// - Depletion and regrowth (a season), the expected haul against hour-by-hour rolls.
// - The Forage order (and its plan step), the camp foraging around a camp, the base job Forage (work type, role,
//   the daily gathering, the land around the base); herbs, honey and the bad mushroom.
// - The autopilot: a hungry base puts foragers out; a team short of food forages, hunts or fishes instead of starving;
//   hardcore's lean start with foraging on and off (the test switch governor.noForaging).
// - The alerts (base and team food with a "forage nearby" hint, the hardcore road team), the team panel's Forage
//   buttons and food-nearby list, the tile panel, the right-click menu; save / load mid-forage and determinism.
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, atBase, survivorById, makeSurvivor, setNextId, day, alive } from "../src/sim/world.js";
import { launchExpedition, partyTile, planPath, partyMembers, carried, cargoRoom } from "../src/sim/parties.js";
import { startOrder, queueOrder, queueEstimate, taskHour } from "../src/sim/orders.js";
import { estimatePlan, stepsToOrders, STEP_KINDS } from "../src/sim/plans.js";
import * as F from "../src/sim/foraging.js";
import * as H from "../src/sim/hunting.js";
import * as Weather from "../src/sim/weather.js";
import { WORK_TYPES, WORK_KEYS, workState } from "../src/sim/work.js";
import { ROLES } from "../src/sim/economy.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { renderRight, tileActions } from "../src/ui/ui.js";
import { computeAlerts } from "../src/ui/alerts.js";
import { firstHubCard } from "../src/ui/hardcore.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { conditionsOf } from "../src/sim/health.js";

const SEED = Number(process.argv[2] || 42);
const AP_GAMES = Number(process.argv[3] || 6);
const AP_DAYS = Number(process.argv[4] || 40);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const note = (s) => console.log(`  ${s}`);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const BAD = /\b(undefined|NaN)\b|\[object [A-Za-z]+\]/;

function mk(seed = SEED, extra = {}) {
  const state = createWorld({ seed, factionCount: 6, ...extra });
  state.started = true;
  state.autoCombat = true;
  if (hub(state)) Object.assign(hub(state).stock, { food: 400, water: 400, fuel: 100, meds: 20, ammo: 400, parts: 10, scrap: 100 });
  return state;
}
// A clean land tile of a terrain: low infection, no site, no water beside, away from hives and bases.
function cleanTile(state, terrain, extra = () => true) {
  const h = hub(state) ? hub(state).tile : 0;
  return state.tiles.filter((t) => t.terrain === terrain && !t.loc && (t.infection || 0) < 0.15 && !t.river &&
    !state.grid.neighbors(t.id).some((n) => state.tiles[n].terrain === "water") && !state.bases.some((b) => state.grid.distance(b.tile, t.id) <= 2) &&
    (!state.hives || state.hives.every((hv) => state.grid.distance(hv.tile, t.id) > 6)) && extra(t))
    .sort((a, b) => state.grid.distance(a.id, h) - state.grid.distance(b.id, h) || a.id - b.id)[0] || null;
}
// A team placed on a tile, its skills set (the rules on the spot are what is tested).
function placeTeam(state, tile, { n = 3, skills = { farming: 4, scouting: 4 }, food = 8 } = {}) {
  const h = hub(state);
  const ids = [];
  for (let i = 0; i < n; i++) { const s = makeSurvivor(state); s.location = { kind: "base", baseId: h.id }; s.perks = []; s.health = 100; s.conditions = []; s.mood = 60; state.survivors.push(s); ids.push(s.id); }
  for (const id of ids) Object.assign(survivorById(state, id).skills, skills);
  const near = state.tiles.find((t) => t.terrain !== "water" && state.grid.distance(t.id, h.tile) === 2 && planPath(state, h.tile, t.id, false));
  const res = launchExpedition(state, { memberIds: ids, dest: near.id, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  Object.assign(p.supplies, { food, water: 20 });
  p.cargo = { supplies: {}, gear: [] };
  p.path = [tile]; p.idx = 0; p.dest = tile; p.progress = 0; p.orders = []; p.phase = "waiting"; p.task = null;
  return p;
}
// The first day index in a season, optionally at a day of it (weather.js: 28 days a season).
function dayIn(state, key, at = 14, test = () => true) {
  for (let d = 0; d < 400; d++) {
    const s = Weather.season(state, d * 24 + 12);
    if (s.key === key && s.dayOfSeason === at && test(Weather.weather(state, d * 24 + 12))) return d;
  }
  return null;
}
// One forage order of `hours` rolled hour by hour from startHour (no clock ticks: the rules on the spot).
// The team as it was (skills, XP, health): XP and a bad mushroom must not carry over from one roll to the next.
function simForage(state, p, hours, startHour, { reset = true, keep = false } = {}) {
  if (reset) state.forage = {};
  const ms = partyMembers(state, p);
  if (!keep) for (const s of ms) { s.conditions = []; if (!s.__sk) s.__sk = JSON.stringify([s.skills, s.xp]); else [s.skills, s.xp] = JSON.parse(s.__sk); }
  state.hour = startHour;
  p.cargo = { supplies: {}, gear: [] };
  p.phase = "task";
  p.task = { type: "forage", hours, done: 0 };
  for (let i = 0; i < hours; i++) { state.hour += 1; p.task.done += 1; F.forageHour(state, p); }
  return p.task.got || { rations: 0 };
}

// ======================================================================
section("The land: wild food by terrain, sites, hive land, season and time of day");
const yieldTable = [];
{
  const state = mk();
  const ab = {};
  for (const k of ["forest", "plains", "hills", "mountain", "suburb", "city"]) {
    const t = cleanTile(state, k) || state.tiles.filter((x) => x.terrain === k && !x.loc && state.hives.every((hv) => state.grid.distance(hv.tile, x.id) > 6)).sort((a, b) => (a.infection || 0) - (b.infection || 0) || a.id - b.id)[0];
    if (t) ab[k] = { id: t.id, a: F.forageAbundance(state, t.id) };
  }
  note(`abundance: ${Object.entries(ab).map(([k, v]) => `${k} ${r2(v.a)}`).join(", ")}`);
  check(ab.forest.a > ab.plains.a && ab.plains.a > ab.hills.a && ab.hills.a > (ab.suburb ? ab.suburb.a : 0) && (ab.suburb ? ab.suburb.a : 1) > (ab.city ? ab.city.a : 0), "forest > farmland > hills > suburbs > city");
  check(F.forageAbundance(state, state.tiles.find((t) => t.terrain === "water" && !t.bridge).id) === 0, "open water: nothing");
  const farm = state.tiles.find((t) => t.loc && /farm|ranch|barn/.test(t.loc.type) && t.terrain === "plains" && (t.infection || 0) < 0.15);
  if (farm) check(F.forageAbundance(state, farm.id) > F.FORAGE_TERRAIN.plains, "an abandoned farm or ranch: its orchards and gardens give more");
  const hiveTile = state.hives && state.hives[0] ? state.grid.within(state.hives[0].tile, 1).find((id) => state.tiles[id].terrain === "forest" || state.tiles[id].terrain === "plains") : null;
  if (hiveTile != null) check(F.forageAbundance(state, hiveTile) < 0.4, `next to a hive: little (${r2(F.forageAbundance(state, hiveTile))})`);
  const days = { spring: dayIn(state, "spring", 14), summer: dayIn(state, "summer", 14), autumn: dayIn(state, "autumn", 14), winter: dayIn(state, "winter", 14) };
  const sf = Object.fromEntries(Object.entries(days).map(([k, d]) => [k, F.seasonForage(state, d * 24 + 12)]));
  note(`season × (mid-season): ${Object.entries(sf).map(([k, v]) => `${k} ${r2(v)}`).join(", ")}; early spring ${r2(F.seasonForage(state, dayIn(state, "spring", 1) * 24 + 12))}, late autumn ${r2(F.seasonForage(state, dayIn(state, "autumn", 28) * 24 + 12))}`);
  check(sf.autumn > sf.summer && sf.summer > sf.spring && sf.spring > sf.winter && sf.winter <= 0.12, "autumn > summer > spring > winter (almost nothing)");
  check(F.seasonForage(state, dayIn(state, "spring", 28) * 24 + 12) > F.seasonForage(state, dayIn(state, "spring", 1) * 24 + 12), "spring grows: greens first, berries by its end");
  check(F.forageTime(12) === 1 && F.forageTime(6) < 1 && F.forageTime(23) <= 0.1, "daylight 1, dawn and dusk less, night next to nothing");
  // The yields: one average forager (Farming 4, Scouting 4) per daylight hour, untouched land, by terrain and season.
  const avg = { skills: { farming: 4, scouting: 4 }, perks: [], health: 100, conditions: [], mood: 60, traits: [] };
  const m = F.foragerMult(avg);
  check(Math.abs(m - 0.8) < 0.01, `an average forager (Farming 4, Scouting 4) counts 0.8 (${r2(m)})`);
  for (const [k, v] of Object.entries(ab)) {
    const row = { terrain: k };
    for (const [sk, d] of Object.entries(days)) row[sk] = F.FORAGE.rate * v.a * F.seasonForage(state, d * 24 + 12) * m;
    yieldTable.push(row);
  }
  note("food per forager-hour (average forager, daylight, untouched land; × 8 for a day's order):");
  note(`  ${"terrain".padEnd(9)} spring summer autumn winter`);
  for (const r of yieldTable) note(`  ${r.terrain.padEnd(9)} ${[r.spring, r.summer, r.autumn, r.winter].map((x) => r2(x).toFixed(2).padStart(6)).join(" ")}`);
  const fo = yieldTable.find((r) => r.terrain === "forest");
  check(fo.summer * 8 >= 1.5 && fo.summer * 8 <= 3, `a day's foraging in a summer forest: about 2 food a forager (${r1(fo.summer * 8)})`);
  check(fo.winter * 8 < 0.3, `winter: next to nothing (${r1(fo.winter * 8)} a day)`);
}

// ======================================================================
section("Foragers: skill, the Forager perk, the hurt and the ill, several hands on one tile");
{
  const base = { skills: { farming: 0, scouting: 0 }, perks: [], health: 100, conditions: [], mood: 60, traits: [] };
  const good = { ...base, skills: { farming: 12, scouting: 8 } };
  const perk = { ...good, perks: ["forager"] };
  const hurt = { ...good, health: 30 };
  check(F.foragerMult(good) > F.foragerMult(base), "Farming and Scouting help");
  check(Math.abs(F.foragerMult(perk) / F.foragerMult(good) - 1.25) < 0.01, "the Forager perk: × 1.25");
  check(F.foragerMult(hurt) < F.foragerMult(good) * 0.6, "badly hurt: half");
  const one = F.foragePower([good]), three = F.foragePower([good, good, good]), eight = F.foragePower(Array(8).fill(good));
  note(`team power: one ${r2(one)}, three ${r2(three)}, eight ${r2(eight)}`);
  check(three < one * 3 && three > one * 2.5 && eight < one * 6, "more hands on one tile: each a little less");
}

// ======================================================================
section("Depletion and regrowth, the expected haul against hour-by-hour rolls");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id);
  const summer = dayIn(state, "summer", 10);
  const start = summer * 24 + 7;
  const members = partyMembers(state, p);
  state.forage = {};
  const e = F.expectForage(state, members, forest.id, 8, start);
  const rolls = [];
  for (let i = 0; i < 300; i++) rolls.push(simForage(state, p, 8, start).rations);
  note(`three average foragers, 8h from 07:00 in a summer forest: expected ${e.rations}, rolled ${r1(mean(rolls))} (min ${r1(Math.min(...rolls))}, max ${r1(Math.max(...rolls))})`);
  check(Math.abs(mean(rolls) - e.rations) <= e.rations * 0.08, "the expected haul matches the rolls on average");
  check(e.rations >= 4 && e.rations <= 8, `three foragers bring 4–8 food in a summer day (${e.rations}): it stretches the food`);
  // Depletion: the same tile day after day.
  state.forage = {};
  const days = [];
  for (let d = 0; d < 8; d++) days.push(simForage(state, p, 8, start + d * 24, { reset: false }).rations);
  const lvl = F.forageLevel(state, forest.id, start + 8 * 24);
  const after = F.expectForage(state, members, forest.id, 8, start + 8 * 24);
  note(`the same forest tile 8 days running: ${days.map(r1).join(", ")} food; picked down to ${Math.round(lvl * 100)}%, a ninth day expected ${after.rations} (fresh land ${e.rations})`);
  check(after.rations < e.rations * 0.8 && lvl < 0.7, "picked day after day, a tile gives less");
  const back = [7, 14, 28].map((dd) => F.forageLevel(state, forest.id, start + (8 + dd) * 24));
  note(`it grows back: ${back.map((x) => `${Math.round(x * 100)}%`).join(", ")} after 7, 14 and 28 days`);
  check(back[0] > lvl && back[2] > 0.85, "most of it back within a season (unlike a site's loot)");
  // Room: what does not fit stays.
  p.supplies.food = 0;
  state.forage = {};
  state.hour = start; p.cargo = { supplies: {}, gear: [] }; p.phase = "task"; p.task = { type: "forage", hours: 8, done: 0 };
  const room = cargoRoom(state, p);
  check(room > 0, "the team has room");
  // Night: next to nothing.
  const night = F.expectForage(state, members, forest.id, 6, summer * 24 + 21);
  check(night.rations < e.rations * 0.15, `a night's foraging: next to nothing (${night.rations})`);
  // Winter.
  const win = F.expectForage(state, members, forest.id, 8, dayIn(state, "winter", 10) * 24 + 7);
  check(win.rations < 1, `winter: under a ration in a day for three (${win.rations})`);
  const aut = F.expectForage(state, members, forest.id, 8, dayIn(state, "autumn", 5) * 24 + 7);
  check(aut.rations > e.rations, `early autumn beats summer (${aut.rations} vs ${e.rations})`);
}

// ======================================================================
section("Finds and risks: herbs, honey, the bad mushroom");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id, { skills: { farming: 0, scouting: 0 } });
  const aut = dayIn(state, "autumn", 5) * 24 + 7;
  let herbs = 0, honey = 0, sick = 0, runs = 400;
  for (let i = 0; i < runs; i++) {
    for (const s of partyMembers(state, p)) s.conditions = [];
    const got = simForage(state, p, 8, aut);
    herbs += got.herbs || 0; honey += got.honey || 0; sick += (got.sick || []).length;
  }
  note(`${runs} autumn forest forages of 8h by three unskilled foragers: ${herbs} herbs, ${honey} honey, ${sick} bad mushrooms (${r1((sick / runs) * 100)}% a forage)`);
  check(herbs > 0 && honey > 0, "now and then herbs (meds) and a wild hive's honey (preserved food)");
  check(sick > 0 && sick / runs < 0.12, "a bad mushroom is rare");
  const s = partyMembers(state, p)[0];
  s.conditions = [];
  const got = simForage(state, p, 8, aut);
  check(p.cargo.supplies.meds == null || p.cargo.supplies.meds === (got.herbs || 0), "herbs go in the cargo as meds");
  // The mushroom makes them ill (health.js).
  let ill = false;
  for (let i = 0; i < 2000 && !ill; i++) { for (const x of partyMembers(state, p)) x.conditions = []; const g = simForage(state, p, 8, aut); if (g.sick && g.sick.length) ill = conditionsOf(survivorById(state, g.sick[0])).some((c) => c.key === "dysentery"); }
  check(ill, "a bad mushroom: dysentery (health.js)");
  // Skilled foragers pick fewer bad ones.
  const skilled = placeTeam(state, forest.id, { skills: { farming: 16, scouting: 10 } });
  let sick2 = 0;
  for (let i = 0; i < runs; i++) { for (const x of partyMembers(state, skilled)) x.conditions = []; sick2 += (simForage(state, skilled, 8, aut).sick || []).length; }
  check(sick2 < sick, `skilled foragers make fewer mistakes (${sick2} vs ${sick})`);
}

// ======================================================================
section("The Forage order, its plan step, the queue");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id);
  state.hour = dayIn(state, "summer", 10) * 24 + 7;
  const msg = startOrder(state, p, { type: "forage", hours: 6 });
  check(p.phase === "task" && p.task.type === "forage" && p.task.hours === 6, `a 6h forage starts (${msg})`);
  const food0 = carried(p, "food");
  for (let i = 0; i < 6; i++) { state.hour++; taskHour(state, p); }
  check(p.phase === "waiting" && carried(p, "food") > food0, `done: the team carries more food (${r1(food0)} → ${r1(carried(p, "food"))})`);
  check(p.lastHaul && p.lastHaul.kind === "forage", "the trip report knows it foraged");
  const card = state.cards.find((c) => c.partyId === p.id);
  check(!!card && /Foraged 6h/.test(card.text || ""), "the orders card says what was gathered");
  state.cards.length = 0;
  // On the water: no.
  const water = state.tiles.find((t) => t.terrain === "water" && !t.bridge);
  check(/water/.test(F.forageProblem(state, p, water.id)), "no foraging on open water");
  // The queue: hours kept within 2–24, the estimate.
  startOrder(state, p, { type: "camp", hours: 4 });
  queueOrder(state, p, { type: "forage", hours: 40 });
  const q = queueEstimate(state, p);
  check(q.length === 1 && q[0].hours === 24 && /Forage 24h/.test(q[0].label), "a queued forage: within 2–24 hours, with its label");
  // The plan step.
  check(!!STEP_KINDS.forage, "a Forage plan step");
  check(stepsToOrders(state, [{ kind: "forage", hours: 8 }], forest.id)[0].type === "forage", "the plan step becomes a Forage order on the target");
  const crew = atBase(state, hub(state).id).slice(0, 2);
  const est = estimatePlan(state, { memberIds: crew.map((s) => s.id), dest: forest.id, mission: "move", steps: [{ kind: "forage", hours: 8 }, { kind: "home" }], supplies: { food: 6, water: 6 }, startHour: dayIn(state, "summer", 10) * 24 + 5 });
  check(est && est.haul > 0, `the planner counts the expected forage haul (${est && est.haul})`);
}

// ======================================================================
section("Foraging around a camp");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id);
  state.hour = dayIn(state, "summer", 10) * 24;
  state.forage = {};
  startOrder(state, p, { type: "camp", hours: 24 });
  const food0 = carried(p, "food");
  for (let i = 0; i < 24; i++) { state.hour++; taskHour(state, p); }
  const card = state.cards.find((c) => c.partyId === p.id);
  const gathered = carried(p, "food") - food0;
  note(`three people camping a summer day in a forest: ${r1(gathered)} food gathered around the camp (daylight, ${Math.round(F.FORAGE.camp.share * 100)}% of each hour)`);
  check(gathered > 0.8, `the fit forage around the camp in daylight (${r1(gathered)} food)`);
  check(!!card && /Foraged around the camp/.test(card.text || ""), "breaking camp says what was gathered");
  // The badly hurt rest instead.
  const q = placeTeam(state, cleanTile(state, "forest", (t) => t.id !== forest.id).id);
  for (const s of partyMembers(state, q)) s.health = 30;
  state.cards.length = 0;
  startOrder(state, q, { type: "camp", hours: 12 });
  const f1 = carried(q, "food");
  for (let i = 0; i < 12; i++) { state.hour++; taskHour(state, q); }
  check(carried(q, "food") === f1, "the badly hurt rest in camp (no foraging)");
}

// ======================================================================
section("The Forage job at a base: work type, role, the daily gathering, the land around");
{
  const state = mk();
  const base = hub(state);
  check(WORK_KEYS.includes("forage") && !!ROLES.forage, "Forage is a work type and a role");
  workState(state);
  check(state.work.roles.some((r) => r.name === "Generalist" && r.pri.forage) && state.work.roles.some((r) => r.name === "Hunter" && r.pri.forage === 2), "the default roles forage");
  state.hour = dayIn(state, "summer", 10) * 24 + 1;
  const ctx = (days) => ({ state, base, people: atBase(state, base.id), foodDays: days });
  const open = WORK_TYPES.forage.open(ctx(5));
  check(open.cap >= 3 && open.urg > 5, `food down to 5 days: Forage open for ${open.cap} (urgency ${open.urg})`);
  check(WORK_TYPES.forage.open(ctx(60)).cap === 0, "plenty of food: no Forage work");
  const winterHour = dayIn(state, "winter", 10) * 24 + 1;
  state.hour = winterHour;
  check(WORK_TYPES.forage.open(ctx(5)).cap === 0 && /winter/.test(F.forageWorkWhy(state, base)), "winter: nothing worth gathering");
  // The daily gathering, through huntingDaily (economy.js baseDaily).
  const people = atBase(state, base.id).slice(0, 3);
  for (const s of people) { s.role = "forage"; s.conditions = []; s.inBed = false; }
  state.forage = {};
  const run = (key, days) => {
    const d0 = dayIn(state, key, 1);
    let food = 0;
    const daily = [];
    for (let d = 0; d < days; d++) {
      state.hour = (d0 + d) * 24 + 24;
      const before = base.stock.food;
      H.huntingDaily(state, base);
      food += base.stock.food - before;
      daily.push(base.stock.food - before);
    }
    return { food, daily };
  };
  const sum = run("summer", 28);
  const lvl = mean(F.baseForageTiles(state, base).slice(0, 5).map((t) => F.forageLevel(state, t.id)));
  note(`three foragers at the hub through a summer: ${r1(sum.food)} food (${r1(sum.food / 28 / 3)} a forager a day; first week ${r1(sum.daily.slice(0, 7).reduce((a, b) => a + b, 0))}, last ${r1(sum.daily.slice(21).reduce((a, b) => a + b, 0))}); the best land around picked to ${Math.round(lvl * 100)}%`);
  check(sum.food / 28 / 3 > 0.6 && sum.food / 28 / 3 < 2.5, "about a ration or so a forager a day in summer: a help, not a farm");
  check(lvl < 0.95, "the land around the base is picked down");
  state.forage = {};
  const win = run("winter", 7);
  check(win.food / 7 / 3 < 0.25, `winter: next to nothing (${r2(win.food / 21)} a forager a day)`);
  check(state.econStats && state.econStats.foraged > 0, "the economy stats count foraged food");
}

// ======================================================================
section("The autopilot: a hungry base forages, a team short of food gathers food");
{
  // A base down to a few days of food in summer.
  const state = mk(SEED + 3);
  setAutopilot(state, true, "balanced");
  const base = hub(state);
  state.hour = dayIn(state, "summer", 6) * 24 + 5;
  base.stock.food = atBase(state, base.id).length * 2;
  base.stock.preserved = 0;
  for (let i = 0; i < 3; i++) tickHour(state);
  const foragers = atBase(state, base.id).filter((s) => s.role === "forage").length;
  check(foragers >= 1, `food down to 2 days: the governor puts ${foragers} on Forage`);
  const st2 = mk(SEED + 3);
  setAutopilot(st2, true, "balanced");
  st2.hour = state.hour - 3;
  for (let i = 0; i < 3; i++) tickHour(st2);
  check(atBase(st2, hub(st2).id).every((s) => s.role !== "forage"), "plenty of food: nobody forages");
  // A team in the field short of food for the way home: food from the land first.
  const st3 = mk(SEED + 5);
  setAutopilot(st3, true, "balanced");
  st3.hour = dayIn(st3, "summer", 6) * 24 + 7;
  const forest = cleanTile(st3, "forest", (t) => st3.grid.distance(t.id, hub(st3).tile) >= 4 && planPath(st3, hub(st3).tile, t.id, false));
  const p = placeTeam(st3, forest.id, { food: 0.2 });
  p.supplies.food = 0.2;
  let did = null;
  for (let i = 0; i < 6 && !did; i++) {
    tickHour(st3);
    st3.cards = st3.cards.filter((c) => c.isOrders);
    if (st3.parties.includes(p) && (p.task && ["forage", "hunt", "fish"].includes(p.task.type) || (p.orders || []).some((o) => ["forage", "hunt", "fish"].includes(o.type)))) did = p.task && ["forage", "hunt", "fish"].includes(p.task.type) ? p.task.type : p.orders[0].type;
  }
  check(!!did, `a team without food for the way home ${did ? `goes to ${did}` : "does nothing about it"}`);
  // Hardcore before the first hub: the road team, short of food, gathers it.
  const hc = createWorld({ seed: SEED + 9, factionCount: 7, mode: "hardcore" });
  hc.started = true;
  setAutopilot(hc, true, "balanced");
  hc.hour = Math.max(hc.hour, dayIn(hc, "summer", 3) * 24 + 7);
  const rt = roadTeam(hc);
  rt.supplies.food = 0.3; rt.supplies.preserved = 0; rt.cargo.supplies.food = 0; rt.cargo.supplies.preserved = 0;
  const at = partyTile(rt);
  rt.path = [at]; rt.idx = 0; rt.dest = at; rt.progress = 0; rt.orders = []; rt.phase = "waiting"; rt.task = null; // waiting for orders, no camp yet
  hc.staging = null;
  let road = null;
  for (let i = 0; i < 24 && !road; i++) {
    tickHour(hc);
    hc.cards = hc.cards.filter((c) => c.isOrders);
    const q = hc.parties.find((x) => x.id === rt.id);
    if (q && ((q.task && ["forage", "hunt", "fish"].includes(q.task.type)) || (q.orders || []).some((o) => ["forage", "hunt", "fish"].includes(o.type)))) road = q.task && ["forage", "hunt", "fish"].includes(q.task.type) ? q.task.type : q.orders.find((o) => ["forage", "hunt", "fish"].includes(o.type)).type;
  }
  check(!!road, `hardcore's road team out of food ${road ? `goes to ${road}` : "never looks to the land"}`);
}

// ======================================================================
section("Alerts and panels: the forage hint, the team panel, the tile panel, the right-click menu");
{
  const state = mk();
  const base = hub(state);
  state.hour = dayIn(state, "summer", 10) * 24 + 10;
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id, { food: 1 });
  base.stock.food = 2; base.stock.preserved = 0;
  const al = computeAlerts(state);
  const fa = al.find((a) => a.kind === "food" || a.kind === "starve");
  note(`base alert: ${fa ? fa.text : "none"}`);
  check(!!fa && /forage|hunt/.test(fa.text) && / to the (north|south|east|west)|around the base/.test(fa.text), "food for a day or two: the alert says where to hunt or forage");
  // A team in the field with little food.
  p.radioLive = true; p.contactHour = state.hour;
  const ta = computeAlerts(state).find((a) => a.kind === "teamfood");
  note(`team alert: ${ta ? ta.text : "none"}`);
  check(!!ta && /forage|hunt|fish/.test(ta.text), "a team short of food: an alert with food from the land nearby");
  check(!BAD.test(JSON.stringify(computeAlerts(state))), "alerts: no undefined / NaN");
  const xp = renderRight(state, { selected: forest.id, expedition: p.id });
  check(/data-type="forage"/.test(xp) && /Forage 8h/.test(xp), "team panel: Forage 4h / 8h / 12h");
  check(/Food for 0.3 days/.test(xp) && /Forage here/.test(xp.replace(/<[^>]*>/g, " ")), "team panel: short of food, the food from the land nearby with yields");
  check(!BAD.test(xp), "team panel: no undefined / NaN");
  const tp = renderRight(state, { selected: forest.id, expedition: null });
  check(/Forage/.test(tp) && /food in 8h/.test(tp.replace(/<[^>]*>/g, " ")), "tile panel: wild food and a foraging estimate");
  check(!BAD.test(tp), "tile panel: no undefined / NaN");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/data-type="forage"/.test(main) && /d\.type === "forage"/.test(main), "right-click: Go and forage here");
  check(!!tileActions(state, forest.id), "right-click menu builds");
  // Hardcore before the first hub: the road team's alert and the hub card.
  const hc = createWorld({ seed: SEED + 11, factionCount: 7, mode: "hardcore" });
  hc.started = true;
  hc.hour = Math.max(hc.hour, dayIn(hc, "summer", 3) * 24 + 9);
  const rt = roadTeam(hc);
  rt.supplies.food = 1; rt.supplies.preserved = 0; rt.cargo.supplies.food = 0; rt.cargo.supplies.preserved = 0;
  const ra = computeAlerts(hc).find((a) => a.kind === "roadfood");
  note(`road alert: ${ra ? ra.text : "none"}`);
  check(!!ra && /forage|hunt|fish/.test(ra.text + ra.tip), "hardcore: the road team's food alert says where to forage or hunt");
  const card = firstHubCard(hc);
  check(/Food nearby/.test(card) && /Forage/.test(card) && !BAD.test(card), "hardcore: the hub card lists food nearby with yields");
}

// ======================================================================
section("Save / load mid-forage, and determinism");
{
  const strip = (t) => t.replace(/"ms":[-\d.e]+/g, "\"ms\":0");
  const run = (save) => {
    setNextId(1_000_000);
    const st = mk(SEED + 7);
    const forest = cleanTile(st, "forest", (t) => planPath(st, hub(st).tile, t.id, false));
    st.hour = dayIn(st, "summer", 8) * 24 + 4;
    const crew = atBase(st, hub(st).id).slice(0, 2);
    launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: forest.id, mission: "move", stance: "normal", supplies: { food: 10, water: 10 }, plan: { preset: "custom", steps: [{ kind: "forage", hours: 8 }, { kind: "camp", hours: 12 }, { kind: "home" }], conditions: {} } });
    let text = null, world = st;
    for (let k = 0; k < 24 * 4; k++) {
      tickHour(world);
      while (world.cards.length) { const c = world.cards.shift(); (c.choices.find((x) => !x.uiAction) || c.choices[0]).resolve(world); }
      const q = world.parties.find((x) => x.members.includes(crew[0].id));
      if (save && !text && q && q.phase === "task" && q.task.type === "forage" && q.task.done === 4) { text = saveToString(world); world = loadFromString(text); }
    }
    return { st: world, text };
  };
  const a = run(false), b = run(false), c = run(true);
  check(strip(saveToString(a.st)) === strip(saveToString(b.st)), "the same forage twice: identical worlds");
  check(!!c.text && strip(saveToString(a.st)) === strip(saveToString(c.st)), "saved and loaded in the middle of the forage: plays on identical");
  check(Object.keys(a.st.forage || {}).length > 0 && JSON.stringify(a.st.forage) === JSON.stringify(c.st.forage), "the land's forage levels are part of the save");
}

// ======================================================================
section(`Hardcore's lean start: the autopilot with foraging on and off (${AP_GAMES} games, ${AP_DAYS} days)`);
{
  const rows = [];
  for (let i = 0; i < AP_GAMES; i++) {
    for (const off of [true, false]) {
      const st = createWorld({ seed: 9000 + i * 13, factionCount: 7, mode: "hardcore" });
      st.started = true;
      setAutopilot(st, true, "balanced");
      st.governor.noForaging = off;
      while (day(st) <= AP_DAYS && !st.gameOver) tickHour(st);
      const deaths = (st.memorial || []).filter((m) => /hunger|starv/.test(m.cause || "")).length;
      rows.push({ off, alive: alive(st).length, fell: !!st.gameOver, deaths, hungerDays: (st.econStats && st.econStats.hungerDays) || 0, foraged: Math.round(((st.econStats && st.econStats.foraged) || 0) + ((st.econStats && st.econStats.foragedField) || 0)), orders: st.governor.stats.forageOrders || 0, founded: st.hardcore.start.foundedDay });
    }
  }
  const sum = (off, k) => rows.filter((r) => r.off === off).reduce((a, r) => a + (r[k] === true ? 1 : r[k] === false ? 0 : r[k] || 0), 0);
  note(`without foraging: hunger days ${sum(true, "hungerDays")}, deaths of hunger ${sum(true, "deaths")}, fell ${sum(true, "fell")}, alive ${sum(true, "alive")}`);
  note(`with:             hunger days ${sum(false, "hungerDays")}, deaths of hunger ${sum(false, "deaths")}, fell ${sum(false, "fell")}, alive ${sum(false, "alive")}; ${sum(false, "foraged")} food foraged, ${sum(false, "orders")} forage orders`);
  check(sum(false, "foraged") > 0, "the autopilot forages when food runs short");
  check(sum(false, "hungerDays") <= sum(true, "hungerDays") + 2, `no more hunger with foraging than without (${sum(false, "hungerDays")} vs ${sum(true, "hungerDays")} days)`);
  check(sum(false, "deaths") <= sum(true, "deaths") + 1, `no more deaths of hunger with foraging (${sum(false, "deaths")} vs ${sum(true, "deaths")})`);
}

console.log(fails ? `\n${fails} FAILED, ${passed} passed` : `\nAll ${passed} checks passed.`);
process.exit(fails ? 1 : 0);
