// Woodcutting and firewood (src/sim/woodcutting.js, upkeep.js heatUse, needs.js heatDaily, orders.js, plans.js,
// work.js, economy.js, health.js, autopilot.js planWood / woodTripCands / heatFuelWant, crews.js, trade.js, save.js,
// ui/farming.js, ui/alerts.js, ui/expedition.js, ui/ui.js, main.js).
// Usage: node tools/woodtest.js [seed] (default 42).
// - The land: firewood by terrain (forest > hills > mountains > farmland > suburbs > city, water none), sites, hive
//   land; season and time of day; the yields per woodcutter-hour by terrain (a table).
// - Woodcutters: tools (fire axe > sledgehammer > machete > bare hands; a team's and a base's spare tools are lent),
//   skill, the hurt; diminishing hands on one tile.
// - Depletion and regrowth (slow: a season or more).
// - The Cut wood order (and its plan step, the queue, the Heat it makes, the injuries), the base job (work type,
//   role, the daily cutting, the armory's axes, the noise at the base).
// - Heating: firewood first (the fuel figure / HEAT.wood), then fuel; the outpost's share from the hub; a shelter's fire on
//   bare ground burns firewood; a team's camp fire on bare ground goes out without any.
// - The autopilot: woodcutters from late summer until the winter's firewood is in, none with gov.noWood; the
//   heating fuel plan counts the wood; wood trips and the crews' field job.
// - Trade: priced by season and group; the panels and alerts; save / load (old saves start with none) and
//   determinism.
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, atBase, survivorById, makeSurvivor, setNextId, day, residents } from "../src/sim/world.js";
import { launchExpedition, planPath, partyMembers, carried, cargoRoom, travelHours } from "../src/sim/parties.js";
import { startOrder, queueOrder, queueEstimate, taskHour } from "../src/sim/orders.js";
import { estimatePlan, stepsToOrders, STEP_KINDS } from "../src/sim/plans.js";
import * as Wd from "../src/sim/woodcutting.js";
import * as Weather from "../src/sim/weather.js";
import { WORK_TYPES, WORK_KEYS, workState, DEFAULT_ROLES } from "../src/sim/work.js";
import { ROLES } from "../src/sim/economy.js";
import { setAutopilot, heatFuelWant, autopilotStats } from "../src/sim/autopilot.js";
import { FIELD_TYPES } from "../src/sim/crews.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { heatUse, HEAT } from "../src/sim/upkeep.js";
import { boilerUse } from "../src/sim/worm.js";
import { heatDaily } from "../src/sim/needs.js";
import { stationaryActivity, heatGain } from "../src/sim/fieldheat.js";
import { baseHeat } from "../src/sim/hordes.js";
import { newItem } from "../src/sim/inventory.js";
import { SUPPLIES, CATEGORIES } from "../src/sim/data.js";
import { sellPrice, buyPrice, marketLists } from "../src/sim/trade.js";
import { renderRight, tileActions } from "../src/ui/ui.js";
import { computeAlerts } from "../src/ui/alerts.js";
import { upkeepLine, woodLine } from "../src/ui/farming.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const note = (s) => console.log(`  ${s}`);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const BAD = /\b(undefined|NaN)\b|\[object [A-Za-z]+\]/;

function mk(seed = SEED, extra = {}) {
  const state = createWorld({ seed, factionCount: 6, ...extra });
  state.started = true;
  state.autoCombat = true;
  state.visitorsOff = true;
  if (hub(state)) Object.assign(hub(state).stock, { food: 400, water: 400, fuel: 100, meds: 20, ammo: 400, parts: 10, scrap: 100, wood: 0 });
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
const plain = (s, skills = { farming: 4, mechanics: 4 }) => { s.traits = []; s.perks = []; s.health = 100; s.conditions = []; s.mood = 60; s.gear.weapon = null; s.gear.tool = null; Object.assign(s.skills, skills); return s; };
// A team placed on a tile, bare-handed unless given tools.
function placeTeam(state, tile, { n = 3, skills = { farming: 4, mechanics: 4 }, food = 8, tools = [] } = {}) {
  const h = hub(state);
  const ids = [];
  for (let i = 0; i < n; i++) { const s = plain(makeSurvivor(state), skills); s.location = { kind: "base", baseId: h.id }; state.survivors.push(s); ids.push(s.id); }
  ids.forEach((id, i) => { if (tools[i]) survivorById(state, id).gear.weapon = newItem(tools[i]); });
  const near2 = state.tiles.find((t) => t.terrain !== "water" && state.grid.distance(t.id, h.tile) === 2 && planPath(state, h.tile, t.id, false));
  const res = launchExpedition(state, { memberIds: ids, dest: near2.id, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  Object.assign(p.supplies, { food, water: 20 });
  p.cargo = { supplies: {}, gear: [] };
  p.path = [tile]; p.idx = 0; p.dest = tile; p.progress = 0; p.orders = []; p.phase = "waiting"; p.task = null;
  return p;
}
function dayIn(state, key, at = 14, test = () => true) {
  for (let d = 0; d < 400; d++) {
    const s = Weather.season(state, d * 24 + 12);
    if (s.key === key && s.dayOfSeason === at && test(Weather.weather(state, d * 24 + 12))) return d;
  }
  return null;
}
// One Cut wood order of `hours` rolled hour by hour from startHour (no clock ticks: the rules on the spot).
function simWood(state, p, hours, startHour, { reset = true } = {}) {
  if (reset) state.wood = {};
  for (const s of partyMembers(state, p)) { s.conditions = []; if (!s.__sk) s.__sk = JSON.stringify([s.skills, s.xp]); else [s.skills, s.xp] = JSON.parse(s.__sk); }
  state.hour = startHour;
  p.cargo.supplies = {};
  p.phase = "task";
  p.task = { type: "wood", hours, done: 0 };
  for (let i = 0; i < hours; i++) { state.hour += 1; p.task.done += 1; Wd.woodHour(state, p); }
  return p.task.got || { wood: 0 };
}
const avgCutter = () => ({ skills: { farming: 3, mechanics: 3 }, perks: [], health: 100, conditions: [], mood: 60, traits: [], gear: {}, id: 1 });

// ======================================================================
section("The land: firewood by terrain, sites, hive land, season and time of day");
const yieldTable = [];
{
  const state = mk();
  const ab = {};
  for (const k of ["forest", "hills", "mountain", "plains", "suburb", "city"]) {
    const t = cleanTile(state, k) || state.tiles.filter((x) => x.terrain === k && !x.loc && state.hives.every((hv) => state.grid.distance(hv.tile, x.id) > 6)).sort((a, b) => (a.infection || 0) - (b.infection || 0) || a.id - b.id)[0];
    if (t) ab[k] = { id: t.id, a: Wd.woodAbundance(state, t.id) };
  }
  note(`abundance: ${Object.entries(ab).map(([k, v]) => `${k} ${r2(v.a)}`).join(", ")}`);
  const order = ["forest", "hills", "mountain", "plains", "suburb", "city"].filter((k) => ab[k]);
  check(order.every((k, i) => i === 0 || ab[order[i - 1]].a > ab[k].a), `forest > hills > mountains > farmland > suburbs > city (${order.join(" > ")})`);
  check(Wd.woodAbundance(state, state.tiles.find((t) => t.terrain === "water" && !t.bridge).id) === 0, "open water: none");
  const cabin = state.tiles.find((t) => t.loc && /cabin|lodge|camp|ranger/.test(t.loc.type) && (t.infection || 0) < 0.15);
  if (cabin) check(Wd.woodAbundance(state, cabin.id) > Wd.WOOD_TERRAIN[cabin.terrain], "a cabin or lodge: woodpiles and woodlots give more");
  const hiveTile = state.hives && state.hives[0] ? state.grid.within(state.hives[0].tile, 1).find((id) => state.tiles[id].terrain === "forest") : null;
  if (hiveTile != null) check(Wd.woodAbundance(state, hiveTile) <= 0.5 * 1.1, `next to a hive: half or less (${r2(Wd.woodAbundance(state, hiveTile))})`);
  check(Wd.woodTime(12) === 1 && Wd.woodTime(6) < 1 && Wd.woodTime(23) === 0, "daylight 1, dawn and dusk less, nobody fells trees at night");
  const wd = dayIn(state, "winter", 10), sd = dayIn(state, "summer", 10);
  check(Wd.seasonWood(state, wd * 24 + 12) < 1 && Wd.seasonWood(state, sd * 24 + 12) === 1, `winter slower (×${r2(Wd.seasonWood(state, wd * 24 + 12))}), summer ×1`);
  // The yields: one average woodcutter (Farming 3, Mechanics 3) per daylight hour, untouched land, bare-handed and with a fire axe.
  const s = avgCutter();
  const bare = Wd.woodcutterMult(s), axe = bare * Wd.CHOP.fireaxe;
  for (const k of order) {
    const h = sd * 24 + 12;
    yieldTable.push({ terrain: k, bare: Wd.woodRate(state, ab[k].id, h, bare), axe: Wd.woodRate(state, ab[k].id, h, axe) });
  }
  note("firewood per woodcutter-hour (Farming 3, Mechanics 3; untouched; summer daylight) · a base-job day (6h):");
  for (const y of yieldTable) note(`  ${y.terrain.padEnd(9)} bare hands ${r2(y.bare)}/h (${r1(y.bare * 6)}/day) · fire axe ${r2(y.axe)}/h (${r1(y.axe * 6)}/day)`);
  const fy = yieldTable.find((y) => y.terrain === "forest"), py = yieldTable.find((y) => y.terrain === "plains");
  check(fy.axe * 6 >= 120 && fy.axe * 6 <= 195, `a woodcutter with an axe in forest: about 140 a day, 14 kg (${r1(fy.axe * 6)})`); // firewood is 0.1 kg (it was 4–6.5 of 3 kg)
  check(py && py.axe < fy.axe * 0.35, `farmland gives far less than forest (${r2(py.axe)} vs ${r2(fy.axe)} an hour)`);
}

// ======================================================================
section("Woodcutters: tools, skill, the hurt, spare tools lent, diminishing hands");
{
  const state = mk();
  const s = plain(makeSurvivor(state), { farming: 3, mechanics: 3 });
  const m0 = Wd.woodcutterMult(s);
  const withTool = (key) => { s.gear.weapon = key ? newItem(key) : null; return Wd.chopCrew([s])[0].mult; };
  const none = withTool(null), fa = withTool("fireaxe"), sl = withTool("sledge"), ma = withTool("machete");
  note(`bare ${r2(none)}, machete ${r2(ma)}, sledgehammer ${r2(sl)}, fire axe ${r2(fa)}`);
  check(fa > sl && sl > ma && ma > none && near(none, m0), "fire axe > sledgehammer > machete > bare hands");
  s.gear.weapon = null;
  const good = plain(makeSurvivor(state), { farming: 10, mechanics: 8 });
  check(Wd.woodcutterMult(good) > m0 * 1.2, `skill helps (Farming 10, Mechanics 8: ×${r2(Wd.woodcutterMult(good))} vs ×${r2(m0)})`);
  s.health = 30;
  check(near(Wd.woodcutterMult(s), m0 * Wd.WOOD.hurtMult, 1e-9), "badly hurt: half");
  s.health = 100;
  // Spare tools (a team's cargo, a base's armory) go to those without one, the best tool to the best woodcutter.
  const crew = Wd.chopCrew([s, good], [newItem("machete"), newItem("fireaxe")]);
  check(crew.every((c) => c.tool) && crew.find((c) => c.s === good).tool.key === "fireaxe", "spare tools lent: the fire axe to the best woodcutter");
  const three = Wd.chopPower(Wd.chopCrew([s, good, plain(makeSurvivor(state))]));
  const sum3 = Wd.chopCrew([s, good, plain(makeSurvivor(state))]).reduce((a, c) => a + c.mult, 0);
  check(three < sum3 && three > sum3 * 0.8, `three on one tile get in each other's way a little (${r2(three)} of ${r2(sum3)})`);
}

// ======================================================================
section("Depletion and regrowth: trees are slow");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  state.wood = {};
  state.hour = 1000;
  Wd.takeWood(state, forest.id, Wd.WOOD.deplete * Wd.woodAbundance(state, forest.id) / 2);
  const l0 = Wd.woodLevel(state, forest.id);
  const l28 = Wd.woodLevel(state, forest.id, state.hour + 28 * 24), l112 = Wd.woodLevel(state, forest.id, state.hour + 112 * 24);
  note(`a forest tile cut to half (${Math.round(Wd.WOOD.deplete * Wd.woodAbundance(state, forest.id) / 2)} firewood): ${Math.round(l0 * 100)}% → ${Math.round(l28 * 100)}% after a season → ${Math.round(l112 * 100)}% after a year`);
  check(near(l0, 0.5, 0.01), "about half the tile's firewood takes it to half");
  check(l28 < 0.7 && l28 > 0.55, "a season brings back about a quarter of what was cut");
  check(l112 > 0.8 && l112 < 0.95, "a year brings back most of it");
  // Expected haul against the rolls: 200 eight-hour days in summer forest, three woodcutters, one fire axe.
  const p = placeTeam(state, forest.id, { tools: ["fireaxe"] });
  p.cargo.gear = [];
  const start = dayIn(state, "summer", 10) * 24 + 6;
  state.wood = {};
  const est = Wd.expectWood(state, partyMembers(state, p), forest.id, 8, start);
  let tot = 0;
  for (let i = 0; i < 200; i++) tot += simWood(state, p, 8, start).wood;
  note(`three woodcutters (one fire axe) 8h in summer forest: expected ${est.all}, rolled ${r1(tot / 200)} on average (kept, as far as the team can carry)`);
  check(Math.abs(tot / 200 - Math.min(est.all, est.wood)) / Math.max(1, est.wood) < 0.15, "the rolls follow the estimate");
}

// ======================================================================
section("The Cut wood order: start, hours, the haul, the card, Heat, injuries, the queue and the plan step");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id, { tools: ["fireaxe", "machete"] });
  state.hour = dayIn(state, "autumn", 5) * 24 + 7;
  const msg = startOrder(state, p, { type: "wood", hours: 8 });
  check(p.phase === "task" && p.task.type === "wood" && p.task.hours === 8, `an 8h Cut wood starts (${msg})`);
  check(stationaryActivity(p) === "wood" && heatGain(state, p).gain > 0 && /cutting wood/.test(heatGain(state, p).parts.join(" ")), `chopping builds Heat (${r1(heatGain(state, p).gain)} an hour: ${heatGain(state, p).parts[0]})`);
  for (let i = 0; i < 8; i++) { state.hour++; taskHour(state, p); }
  const got = carried(p, "wood");
  check(p.phase === "waiting" && got > 150, `done: the team carries ${r1(got)} firewood`);
  check(p.lastHaul && p.lastHaul.kind === "wood", "the trip report knows it cut wood");
  const card = state.cards.find((c) => c.partyId === p.id);
  check(!!card && /Cut wood 8h/.test(card.text || "") && /firewood/.test(card.text || ""), "the orders card says what was cut");
  state.cards.length = 0;
  // A full cargo: the rest is left.
  const q = placeTeam(state, cleanTile(state, "forest", (t) => t.id !== forest.id).id, { tools: ["fireaxe", "fireaxe", "fireaxe"] });
  q.supplies.food = 40; q.supplies.water = 40;
  const room = cargoRoom(state, q);
  const g = simWood(state, q, 24, dayIn(state, "summer", 3) * 24 + 6, { reset: false });
  check(g.wood * SUPPLIES.wood.weight <= room + 0.01 && g.left > 0,`the haul stops at what the team can carry (${r1(g.wood)} firewood, ${r1(room)} kg of room, ${r1(g.left)} left)`);
  // Where not: open water, bare city ground.
  const water = state.tiles.find((t) => t.terrain === "water" && !t.bridge);
  check(/water/.test(Wd.woodProblem(state, p, water.id)), "no woodcutting on open water");
  // Injuries: a long run of axe work turns up cuts and sprains now and then.
  const r = placeTeam(state, forest.id, { tools: ["fireaxe", "fireaxe", "fireaxe"] });
  let hurt = 0;
  for (let i = 0; i < 60; i++) { const x = simWood(state, r, 8, dayIn(state, "summer", 3) * 24 + 6); hurt += (x.hurt || []).length; }
  note(`three with axes, 60 eight-hour days: ${hurt} hurt (expected about ${r1(60 * 8 * 3 * Wd.WOOD.injury)})`);
  check(hurt >= 1 && hurt <= 10, "axes slip now and then");
  // The queue: hours kept within 2–24, the estimate; the plan step.
  startOrder(state, p, { type: "camp", hours: 4 });
  queueOrder(state, p, { type: "wood", hours: 40 });
  const qe = queueEstimate(state, p);
  check(qe.length === 1 && qe[0].hours === 24 && /Cut wood 24h/.test(qe[0].label), "a queued Cut wood: within 2–24 hours, with its label");
  check(!!STEP_KINDS.wood, "a Cut wood plan step");
  check(stepsToOrders(state, [{ kind: "wood", hours: 8 }], forest.id)[0].type === "wood", "the plan step becomes a Cut wood order on the target");
  const crew = atBase(state, hub(state).id).slice(0, 2);
  const est = estimatePlan(state, { memberIds: crew.map((s) => s.id), dest: forest.id, mission: "move", steps: [{ kind: "wood", hours: 8 }, { kind: "home" }], supplies: { food: 6, water: 6 }, startHour: dayIn(state, "summer", 10) * 24 + 5 });
  check(est && est.wood > 0 && est.legs.some((l) => l.wood > 0), `the planner counts the expected firewood (${est && est.wood})`);
}

// ======================================================================
section("The Cut wood job at a base: work type, role, the daily cutting, the armory's axes, noise");
{
  const state = mk();
  const base = hub(state);
  check(WORK_KEYS.includes("wood") && !!ROLES.wood, "Cut wood is a work type and a role");
  workState(state);
  check(state.work.roles.some((r) => r.name === "Generalist" && r.pri.wood) && state.work.roles.some((r) => r.name === "Hunter" && r.pri.wood === 2), "the default roles cut wood");
  const ctx = () => ({ state, base, people: atBase(state, base.id), foodDays: 60 });
  state.hour = dayIn(state, "autumn", 10) * 24 + 1;
  const why = Wd.woodWorkWhy(state, base);
  note(`the hub: ${why || `a woodcutter brings in ${r1(Wd.baseWoodDay(state, base))} a day`} (${Wd.baseWoodHint(state, base)})`);
  if (!why) {
    base.stock.wood = 0;
    const o = WORK_TYPES.wood.open(ctx());
    check(o.cap >= 2 && o.urg >= 3, `autumn, no firewood: Cut wood open for ${o.cap} (urgency ${o.urg})`);
    base.stock.wood = 9999;
    check(WORK_TYPES.wood.open(ctx()).cap === 0, "a full woodpile: no Cut wood work");
    base.stock.wood = 0;
  }
  // The daily cutting: three on the job, one with an axe from the armory.
  const people = atBase(state, base.id).slice(0, 3);
  for (const s of people) { plain(s, { farming: 3, mechanics: 3 }); s.role = "wood"; s.inBed = false; }
  base.armory = base.armory.filter((it) => !Wd.isChopTool(it));
  state.wood = {};
  const d0 = dayIn(state, "summer", 20);
  state.hour = (d0 + 1) * 24;
  const bare = Wd.woodDaily(state, base);
  base.armory.push(newItem("fireaxe"));
  state.wood = {};
  const w0 = base.stock.wood;
  const axe = Wd.woodDaily(state, base);
  note(`three on Cut wood at the hub, one summer day: ${r1(bare.wood)} bare-handed, ${r1(axe.wood)} with the armory's fire axe; base Heat from the axes ${base.woodNoise}`);
  check(axe.wood > bare.wood && axe.tools === 1, "the armory's axe is used and cuts more");
  check(near(base.stock.wood - w0, axe.wood, 0.01) && state.econStats.woodCut > 0, "the firewood goes into the base's store and the stats");
  check(base.woodNoise > 0 && baseHeat(state, base) >= base.woodNoise, `chopping adds to the base's Heat (+${base.woodNoise})`);
  // A month of it thins the land around.
  state.wood = {};
  let month = 0;
  for (let d = 0; d < 28; d++) { state.hour = (d0 + d + 1) * 24; month += Wd.woodDaily(state, base).wood; }
  const lvl = Wd.baseWoodTiles(state, base)[0];
  note(`a month of three woodcutters: ${Math.round(month)} firewood; the best land left ${Math.round(Wd.woodLevel(state, lvl.id) * 100)}%`);
  check(Object.values(state.wood).some((r) => r[0] < 0.9), "the land around the base is cut down");
}

// ======================================================================
section("Heating burns firewood first, then fuel; the outposts; the shelter's and the camp's fire");
{
  const st = mk();
  const h = hub(st);
  let cold = null;
  for (let d = 0; d < 112 * 2 && cold == null; d++) { const t = Weather.dayMeanTemp(st, d); if (t < 0 && t >= -8) cold = d; }
  st.hour = cold * 24 + 1;
  const n = residents(st, h.id).length;
  const u = heatUse(st, h);
  check(near(u.total, n * HEAT.fuel) && near(u.wood, n * HEAT.fuel / HEAT.wood), `below 0°C: ${u.text}`);
  check(/firewood a day/.test(upkeepLine(st, h).heating) && upkeepLine(st, h).heating === `Heating: ${n} people × 0.1 = ${r1(n * 0.1).toFixed(1)} → ${Math.round(n * 0.1 / HEAT.wood)} firewood a day (or ${r1(n * 0.1).toFixed(1)} fuel)`, `the Upkeep line: "${upkeepLine(st, h).heating}"`);
  // Enough firewood: no fuel burned.
  h.stock.wood = 1500; h.stock.fuel = 10;
  heatDaily(st, h);
  check(near(h.stock.wood, 1500 - n * 0.1 / HEAT.wood, 1e-6) && h.stock.fuel === 10 && !h.cold, `firewood first: ${r1(n * 0.1 / HEAT.wood)} firewood, no fuel (${h.heat.wood} wood, ${h.heat.burned} fuel)`);
  // Half the wood it needs: the fuel covers the rest.
  h.stock.wood = n * 0.05 / HEAT.wood; h.stock.fuel = 10;
  heatDaily(st, h);
  check(h.stock.wood === 0 && near(h.stock.fuel, 10 - n * 0.05, 0.051) && !h.cold, `half the firewood: fuel for the rest (${r1(10 - h.stock.fuel)} fuel)`);
  // Neither: cold.
  h.stock.wood = 0; h.stock.fuel = 0;
  heatDaily(st, h);
  check(h.cold === 1, "no firewood or fuel: cold");
  // The heating fuel plan counts the wood in store (the governor's fuel runs).
  setAutopilot(st, true, "balanced");
  h.stock.fuel = 0; h.stock.wood = 0;
  const need0 = heatFuelWant(st, h).need;
  h.stock.wood = 15000;
  check(need0 > 0 && heatFuelWant(st, h).need === 0, `the governor's heating fuel plan: ${need0} fuel without wood, none with the winter's wood in store`);
  setAutopilot(st, false);
  // An outpost short of heating gets the hub's spare firewood over its supply line.
  // A shelter (tier 0): its lit fire burns deadfall where there is wood, firewood on bare ground, else it does not warm.
  h.tier = 0; h.fire = true; h.stock.wood = 0;
  const forestish = Wd.fireLandOk(st, h.tile);
  heatDaily(st, h);
  if (forestish) check(heatUse(st, h).fire && h.fireFed == null, "a shelter in wooded land: its fire burns deadfall (no firewood)");
  const bare = st.tiles.find((t) => t.terrain === "city" && !Wd.fireLandOk(st, t.id));
  if (bare) {
    const keep = h.tile;
    h.tile = bare.id;
    h.stock.wood = 150;
    heatDaily(st, h);
    check(h.fireFed === true && near(h.stock.wood, 150 - Wd.WOOD.fire.shelter) && heatUse(st, h).fire, `a shelter on bare ground: its fire burns ${Wd.WOOD.fire.shelter} firewood a day`);
    h.stock.wood = 0;
    heatDaily(st, h);
    check(h.fireFed === false && !heatUse(st, h).fire && heatUse(st, h).total > 0, "no firewood there: the fire does not warm it");
    h.tile = keep;
  } else note("(no bare city ground on this map: skipped)");
  delete h.tier; delete h.fire; delete h.fireFed;
  // A team's camp fire on bare ground burns carried firewood, or goes out.
  if (bare) {
    const p = placeTeam(st, bare.id);
    p.cargo.supplies.wood = 30;
    startOrder(st, p, { type: "camp", hours: 30 });
    for (let i = 0; i < 24; i++) { st.hour++; taskHour(st, p); }
    check(p.campFire !== false && carried(p, "wood") < 30 && carried(p, "wood") > 15, `a camp on bare ground burns its firewood (${r2(30 - carried(p, "wood"))} a day)`);
    p.cargo.supplies.wood = 0;
    for (let i = 0; i < 2; i++) { st.hour++; taskHour(st, p); }
    check(p.campFire === false, "out of firewood there: the fire goes out");
  }
  const fp = placeTeam(st, cleanTile(st, "forest").id);
  startOrder(st, fp, { type: "camp", hours: 30 });
  for (let i = 0; i < 24; i++) { st.hour++; taskHour(st, fp); }
  check(fp.campFire !== false && carried(fp, "wood") === 0, "a camp in the woods burns deadfall: free");
}

// ======================================================================
section("The autopilot: the winter's firewood from late summer, none with the switch off");
{
  const run = (seed, off) => {
    const st = createWorld({ seed, factionCount: 6 });
    st.started = true;
    setAutopilot(st, true, "balanced");
    st.governor.noWood = off;
    const winter = dayIn(st, "winter", 1);
    let woodDays = 0, earliest = null, boiled = false;
    while (day(st) <= winter && !st.gameOver) {
      tickHour(st);
      if (st.hour % 24 === 12) {
        const n = atBase(st, hub(st).id).filter((s) => s.role === "wood").length;
        woodDays += n;
        if (n && earliest == null) earliest = Weather.season(st);
        if (boilerUse(st, hub(st)).active) boiled = true; // the water boiler (worm.js) burns firewood in every season
      }
    }
    const h = hub(st);
    return { wood: Math.round(h.stock.wood || 0), need: Wd.woodNeed(st, h).need, woodDays, earliest, boiled, fuel: Math.round(h.stock.fuel || 0), trips: st.governor.stats.woodTrips || 0, cut: Math.round((st.econStats.woodCut || 0) + (st.econStats.woodField || 0)) };
  };
  for (const seed of [SEED, SEED + 1]) {
    const on = run(seed, false), off = run(seed, true);
    note(`seed ${seed}: at the start of winter the hub has ${on.wood} firewood (the cold ahead needs ${on.need}); ${on.woodDays} woodcutter-days from ${on.earliest ? `${on.earliest.name} day ${on.earliest.dayOfSeason}` : "never"}, ${on.trips} wood trips; fuel ${on.fuel} · switch off: ${off.wood} firewood, fuel ${off.fuel}`);
    check(on.woodDays > 0 && on.earliest && (on.earliest.key === "summer" || on.earliest.key === "autumn" || on.boiled), `woodcutters go out from late summer or autumn${on.boiled ? " (earlier here: the water boiler burns firewood all year, worm.js)" : ""}`);
    // At HEAT.wood 0.2 (tune-winter) a winter takes 0.5 firewood a head a freezing day: about half the plan (the
    // whole cold with WOOD.bitter and a fifth to spare) is in by its first day, and the fuel and the woodcutters
    // must carry the rest (a hub that falls short goes cold for a day or two late in the winter: winter bites).
    check(on.wood >= on.need * 0.5, `the woodpile is half in by the winter or more (${on.wood} of ${on.need})`);
    check(off.woodDays === 0 && off.cut === 0, "gov.noWood: nobody cuts wood");
  }
  // The crews' field job and the governor's wood trips plan a Cut wood step.
  check(!!FIELD_TYPES.wood && typeof FIELD_TYPES.wood.cands === "function", "crews: a Cut wood field job");
}

// ======================================================================
section("Trade: firewood priced by the season and the group");
{
  const state = mk();
  const f = state.factions.find((x) => x.alive && x.type === "commune") || state.factions.find((x) => x.alive);
  check(SUPPLIES.wood && SUPPLIES.wood.name === "Firewood" && CATEGORIES.firewood, "Firewood is a supply with its own trade category");
  state.hour = dayIn(state, "summer", 10) * 24;
  const summer = sellPrice(state, f, "wood", 0, 10);
  state.hour = dayIn(state, "winter", 10) * 24;
  const winter = sellPrice(state, f, "wood", 0, 10);
  note(`${f.type} pays ${r2(summer)} a firewood in summer, ${r2(winter)} in winter (fuel: ${r2(sellPrice(state, f, "fuel", 0, 10))})`);
  check(winter > summer * 1.5, "dear in winter, cheap in summer");
  check(buyPrice(state, f, "wood", 0, 10) > winter, "buying costs more than selling (the spread)");
  const m = marketLists(state, f);
  check(!BAD.test(JSON.stringify(m)) && m.prices.wood && m.prices.wood.pay > 0, "the market board prices firewood");
}

// ======================================================================
section("Panels and alerts: the Upkeep line, the top bar, the tile panel, the team panel, right-click, the alert");
{
  const state = mk();
  const base = hub(state);
  const forest = cleanTile(state, "forest");
  state.hour = dayIn(state, "autumn", 20) * 24 + 10;
  base.stock.wood = 0; base.stock.fuel = 0;
  const al = computeAlerts(state).find((a) => a.kind === "wood");
  note(`alert: ${al ? `${al.text} — ${al.tip.slice(0, 140)}…` : "none"}`);
  check(!!al && /firewood 0 of \d+/.test(al.text), "late autumn with no firewood: an alert");
  check(!BAD.test(JSON.stringify(computeAlerts(state))), "alerts: no undefined / NaN");
  base.stock.wood = 9999;
  check(!computeAlerts(state).some((a) => a.kind === "wood"), "a full woodpile: no alert");
  base.stock.wood = 3;
  const wl = woodLine(state, base);
  check(!!wl.short && !BAD.test(wl.tip) && /firewood/.test(wl.tip), `the top bar's Firewood line: "${wl.short}"`);
  const p = placeTeam(state, forest.id, { tools: ["fireaxe"] });
  p.radioLive = true; p.contactHour = state.hour;
  const xp = renderRight(state, { selected: forest.id, expedition: p.id });
  check(/data-type="wood"/.test(xp) && /Cut wood 8h/.test(xp) && /firewood expected/.test(xp), "team panel: Cut wood 4h / 8h with the expected yield");
  check(!BAD.test(xp), "team panel: no undefined / NaN");
  const tp = renderRight(state, { selected: forest.id, expedition: null });
  check(/>Wood</.test(tp) && /firewood \(\d+ kg\) in 8h/.test(tp.replace(/<[^>]*>/g, " ")), "tile panel: the wood rating and a cutting estimate");
  check(!BAD.test(tp), "tile panel: no undefined / NaN");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/data-type="wood"/.test(main) && /d\.type === "wood"/.test(main), "right-click: Go and cut wood here");
  check(!!tileActions(state, forest.id), "right-click menu builds");
}

// ======================================================================
section("Save / load: old saves start with none; mid-order, and determinism");
{
  const st = mk();
  const h = hub(st);
  workState(st);
  delete h.stock.wood;
  for (const r of st.work.roles) delete r.pri.wood;
  delete st.woodcutting; // a world from before firewood
  const fresh = loadFromString(saveToString(mk()));
  check(fresh.woodcutting === 2 && hub(fresh).stock.wood === 0, "a world made since loads unchanged");
  const back = loadFromString(saveToString(st));
  check(hub(back).stock.wood === 0, "an old save: the bases start with 0 firewood");
  check(back.work.roles.find((r) => r.name === "Generalist").pri.wood === back.work.roles.find((r) => r.name === "Generalist").pri.forage, "an old save: the roles get Cut wood at their Forage priority");
  const strip = (t) => t.replace(/"ms":[-\d.e]+/g, "\"ms\":0");
  const run = (save) => {
    setNextId(1_000_000);
    const s2 = mk(SEED + 7);
    const forest = cleanTile(s2, "forest", (t) => planPath(s2, hub(s2).tile, t.id, false));
    // Off so as to reach the forest by about 8 in the morning: the cutting is by daylight.
    const walk = planPath(s2, hub(s2).tile, forest.id, false).path;
    s2.hour = dayIn(s2, "autumn", 8) * 24 + 8 - travelHours(s2, walk, { weather: false }).hours;
    const crew = atBase(s2, hub(s2).id).slice(0, 2);
    launchExpedition(s2, { memberIds: crew.map((s) => s.id), dest: forest.id, mission: "move", stance: "normal", supplies: { food: 10, water: 10 }, plan: { preset: "custom", steps: [{ kind: "wood", hours: 8 }, { kind: "home" }], conditions: {} } });
    let text = null, world = s2;
    for (let k = 0; k < 24 * 4; k++) {
      tickHour(world);
      while (world.cards.length) { const c = world.cards.shift(); (c.choices.find((x) => !x.uiAction) || c.choices[0]).resolve(world); }
      const q = world.parties.find((x) => x.owner === "player" && (x.members || []).includes(crew[0].id));
      if (save && !text && q && q.phase === "task" && q.task.type === "wood" && q.task.done === 4) { text = saveToString(world); world = loadFromString(text); }
    }
    return { st: world, text };
  };
  const a = run(false), b = run(false), c = run(true);
  check(strip(saveToString(a.st)) === strip(saveToString(b.st)), "the same woodcutting trip twice: identical worlds");
  check(!!c.text && strip(saveToString(a.st)) === strip(saveToString(c.st)), "saved and loaded in the middle of cutting: plays on identical");
  check(Object.keys(a.st.wood || {}).length > 0 && JSON.stringify(a.st.wood) === JSON.stringify(c.st.wood), "the land's wood levels are part of the save");
  check((a.st.econStats.woodField || 0) > 30, `the team cut firewood (${Math.round(a.st.econStats.woodField || 0)})`);
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
