// Woodcutting and firewood: deadfall, felled trees, old fence rails and furniture split into firewood, the winter's
// heating (upkeep.js heatUse: a base burns firewood first, 30 firewood heating as much as 0.2 fuel: HEAT.wood =
// 0.2 / 30 a firewood, then fuel for the rest). Fuel is scarce and wanted for the vehicles and the generator; wood grows back.
// Two ways to cut it:
//   - the base job "Cut wood" (work.js, economy.js ROLES "wood"): people cut within 2 tiles of the base 6 hours a day;
//   - the team order "Cut wood" on a land tile (N hours, like Forage; orders.js), and a plan step.
//
// The land (per tile; state.wood[tile] = [level, hour], created on the first cutting):
//   abundance = terrain (forest 1, hills 0.6, mountains 0.35 (scrub and stunted pine), farmland 0.25 (hedgerows,
//               windbreaks, old orchards, fence rails), suburbs 0.2 (fallen trees, fences, furniture), city 0.05,
//               water 0) × 1.1 by a river or lake (driftwood, riverside trees) × a site (cabins, lodges, campgrounds,
//               ranger stations 1.3: woodpiles and woodlots; farms, ranches and barns 1.2: woodlots and fences)
//               × (1 − 0.4 × infection) × hive land 0.5 (its red ring 0.25)
//   level     = 1 untouched; each firewood taken lowers it by 1 / (DEPLETE × the tile's abundance, at least 0.1): a
//               forest tile gives about 7,500 firewood (750 kg) from full before it is cut bare; it grows back
//               toward 1 with a half-life of HALF_LIFE (60) days (trees are slow: about a quarter of what was cut
//               comes back within a season, three quarters within a year).
// Season and hour: winter × 0.85 (short days, frozen hands; × 0.75 more under deep snow), otherwise 1; daylight
//   (07–18) 1, dawn and dusk (05–06, 19) 0.5, night nothing (nobody fells trees in the dark). A storm × 0.4.
// People: a woodcutter = 0.7 + 0.05 × (0.7 Farming + 0.3 Mechanics) (Farming: land work, felling and hauling;
//   Mechanics: keeping the tools sharp) × their tool (a fire axe ×1.6, a sledgehammer and wedges ×1.3, a machete ×1.25,
//   a saw-blade machete ×1.2; bare hands ×1: deadfall and branches; GEAR `chop` overrides) × their work factor
//   (illness), × 0.5 when badly hurt (under 40 health). On one tile the best counts 1, the next 0.9, 0.8, … (at least
//   0.4). A team's spare tools in the cargo go to those without one; at a base the armory's tools do.
// Firewood an hour = RATE (18) × abundance × level × season × time × weather × the woodcutters.
//   Expect (an average woodcutter, skill ~3: × 0.85): a forest tile with a fire axe ~23 an hour (about 140 a day on
//   the base job), bare-handed ~14; hills about 60% of that, farmland a quarter, suburbs a fifth, a city next to
//   nothing.
// Risks: chopping is loud: a team order builds field Heat ×1.3 (fieldheat.js), and at a base each woodcutter adds to
//   its Heat (base.woodNoise: 0.8 with an axe, 0.3 gathering by hand; hordes.js baseHeat). Axes slip: a team order
//   rolls 0.15% a person-hour for a deep cut or a sprain (half without a tool); the base job is a work accident risk
//   like the others (health.js WORK_RISK.wood).
// Fires: a camp fire burns deadfall picked up around it for free wherever there is any (wood abundance 0.15+ on the
//   tile or next to it). On bare ground (a city centre) a lit fire needs firewood: a shelter's WOOD.fire.shelter a
//   day from its store, a team's camp WOOD.fire.camp a day from what it carries; without any the fire cannot be kept
//   going (a shelter's fire then does not warm it; a team's goes out).
// Firewood is a supply (data.js SUPPLIES.wood: 0.1 kg a unit, cheap, dear in winter; every firewood figure here was a
// 30th of this when a unit was a 3 kg bundle): stored at bases with no limit, carried by teams, traded.
import { log, skill, atBase } from "./world.js";
import { partyMembers, partyTile, tileLabel, teamName, cargoRoom, carried, takeSupply } from "./parties.js";
import { gainXp, USE } from "./skills.js";
import { zombieToughness } from "./hives.js";
import * as Weather from "./weather.js";
import { workFactor, addCondition } from "./health.js";
import { SUPPLIES, GEAR } from "./data.js";
import { econStats } from "./farming.js";
import { carriedItems } from "./hunting.js";
import { mouthsAt, HEAT, woodFor } from "./upkeep.js";
import { boilerUse, WORM } from "./worm.js"; // the water boiler burns firewood a head every day its water needs boiling
import { noteOutput } from "./output.js"; // the base's Work now panel: what each job brought in a day (activity.js)

// ---------- numbers ----------
export const WOOD = {
  rate: 18,                  // firewood a woodcutter-hour: average skill, bare hands, untouched forest, daylight (0.6 when a unit was 3 kg)
  deplete: 7500,             // firewood a full tile of abundance 1 gives before it is cut bare (750 kg)
  halfLife: 60,              // days for the cut land to grow half back
  minHours: 2, maxHours: 24, defHours: 8,
  weights: [1, 0.9, 0.8, 0.7, 0.6, 0.5], floorWeight: 0.4,
  dusk: 0.5, night: 0, storm: 0.4, winter: 0.85, snow: 0.75,
  hurt: 40, hurtMult: 0.5,
  injury: 0.0015,            // a team order: a cut or a sprain, per person-hour of chopping (half without a tool)
  noise: { axe: 0.8, hands: 0.3 }, // base Heat a woodcutter adds (hordes.js baseHeat)
  // The Cut wood job: hours a day; no head-count cap (tune-jobcaps: it was 2, 3 at 10+ people). Each woodcutter past
  // the first brings in `crowd` less (the k-th × max(crowdFloor, 1 − crowd × k): the near deadfall and the easy trees
  // go first, the rest is a longer haul), on top of the land thinning (a forest tile holds ~7,500, so a day's cutting
  // barely dents it). How many go is sized to the need (woodHandsWanted): the shortfall over `stockDays` (or the days
  // to the cold, if sooner; at least minDays), plus the boiler's.
  base: { radius: 2, hours: 6, crowd: 0.05, crowdFloor: 0.5, stockDays: 21, minDays: 5 },
  worth: 12,                 // a woodcutter must be expected to bring in this much a day for the job to be open
  fire: { land: 0.15, shelter: 18, camp: 9 }, // deadfall enough for a fire (abundance), firewood a lit fire burns a day without it
  bitter: 1.05, spare: 1.2,  // the winter's need: bitter days a little more, and a fifth to spare
};
export const WOOD_TERRAIN = { forest: 1, hills: 0.6, mountain: 0.35, plains: 0.25, suburb: 0.2, city: 0.05, water: 0 };
// Cutting tools (a GEAR entry's own `chop` overrides): what each does for a woodcutter's output.
export const CHOP = { fireaxe: 1.6, sledge: 1.3, machete: 1.25, sawmachete: 1.2, springmachete: 1.25 };
const SITE_BONUS = (type) => (/cabin|lodge|camp|ranger/.test(type || "") ? 1.3 : /farm|ranch|barn|orchard/.test(type || "") ? 1.2 : 1);
const r1 = (x) => Math.round(x * 10) / 10;
const first = (s) => s.name.split(" ")[0];

// ---------- the land ----------
export function woodAbundance(state, tile) {
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge)) return 0;
  let a = WOOD_TERRAIN[t.terrain] ?? 0.2;
  if (!a) return 0;
  if (t.river || state.grid.neighbors(tile).some((n) => state.tiles[n] && state.tiles[n].terrain === "water")) a *= 1.1;
  if (t.loc) a *= SITE_BONUS(t.loc.type);
  a *= 1 - 0.4 * Math.max(0, Math.min(1, t.infection || 0));
  const tough = state.hives ? zombieToughness(state, tile) : 0;
  if (tough) a *= tough >= 3 ? 0.25 : 0.5;
  return a;
}
export function woodLevel(state, tile, hour = state.hour) {
  const r = state.wood && state.wood[tile];
  if (!r) return 1;
  const days = Math.max(0, hour - r[1]) / 24;
  return 1 - (1 - r[0]) * Math.pow(0.5, days / WOOD.halfLife);
}
const depletePer = (state, tile) => 1 / (WOOD.deplete * Math.max(0.1, woodAbundance(state, tile)));
// Takes `amount` firewood off a tile's level.
export function takeWood(state, tile, amount) {
  if (!(amount > 0)) return;
  const store = state.wood || (state.wood = {});
  store[tile] = [Math.max(0, Math.round((woodLevel(state, tile) - amount * depletePer(state, tile)) * 1e4) / 1e4), state.hour];
}
export const woodWord = (v) => (v >= 0.6 ? "plenty" : v >= 0.3 ? "some" : v >= 0.1 ? "little" : v >= 0.02 ? "scraps" : "none");

// ---------- season, hour, weather ----------
export function seasonWood(state, hour = state.hour) {
  if (Weather.season(state, hour).key !== "winter") return 1;
  return WOOD.winter * ((Weather.weather(state, hour).snowCover || 0) >= 0.5 ? WOOD.snow : 1);
}
export function woodTime(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h <= 18) return 1;
  if (h === 5 || h === 6 || h === 19) return WOOD.dusk;
  return WOOD.night;
}
const weatherMult = (state, hour, tile) => (Weather.weather(state, hour, tile).severe ? WOOD.storm : 1); // a storm over that tile (weather.js)

// ---------- people and tools ----------
export const woodSkill = (s) => 0.7 * skill(s, "farming") + 0.3 * skill(s, "mechanics");
// What a tool does for cutting wood (1: not a cutting tool).
export function chopMult(item) {
  if (!item || !GEAR[item.key]) return 1;
  return GEAR[item.key].chop ?? CHOP[item.key] ?? 1;
}
export const isChopTool = (item) => chopMult(item) > 1;
// A person's own best cutting tool: { item, mult } (item null: bare hands).
export function bestChop(s) {
  let best = { item: null, mult: 1 };
  for (const it of carriedItems(s)) { const m = chopMult(it); if (m > best.mult) best = { item: it, mult: m }; }
  return best;
}
// Someone's output before the tool: skill, illness, wounds.
export function woodcutterMult(s) {
  let m = 0.7 + 0.05 * woodSkill(s);
  m *= Math.max(0, Math.min(1.1, workFactor(s)));
  if ((s.health ?? 100) < WOOD.hurt) m *= WOOD.hurtMult;
  return m;
}
// Who cuts with what: each person's own best tool, then the spare tools (a team's cargo, a base's armory) go to those
// without one, best tool to the best woodcutter. [{ s, tool (item or null), toolMult, mult }] best first.
export function chopCrew(members, spare = []) {
  const crew = members.map((s) => { const b = bestChop(s); return { s, tool: b.item, toolMult: b.mult, mult: woodcutterMult(s) * b.mult }; });
  const free = spare.filter(isChopTool).sort((a, b) => chopMult(b) - chopMult(a));
  for (const c of [...crew].filter((x) => !x.tool).sort((a, b) => woodcutterMult(b.s) - woodcutterMult(a.s) || a.s.id - b.s.id)) {
    const it = free.shift();
    if (!it) break;
    c.tool = it; c.toolMult = chopMult(it); c.mult = woodcutterMult(c.s) * c.toolMult;
  }
  return crew.sort((a, b) => b.mult - a.mult || a.s.id - b.s.id);
}
// The crew's power on one tile: the best counts 1, then 0.9, 0.8 … (at least 0.4 each).
export const chopPower = (crew) => crew.reduce((a, c, i) => a + c.mult * (WOOD.weights[i] ?? WOOD.floorWeight), 0);
const teamSpare = (p) => ((p && p.cargo && p.cargo.gear) || []);

// ---------- rates and estimates ----------
// Firewood an hour on this tile at this level for a crew of power `power` (no randomness).
export function woodRate(state, tile, hour, power, level = woodLevel(state, tile, hour)) {
  return WOOD.rate * woodAbundance(state, tile) * level * seasonWood(state, hour) * woodTime(hour) * weatherMult(state, hour, tile) * power;
}
// Expected haul of `hours` of cutting from startHour, the land thinning as it goes; room = kg the team can still carry
// (the haul is capped by it; all = what was cut).
export function expectWood(state, members, tile, hours, startHour = state.hour, room = Infinity, power = chopPower(chopCrew(members))) {
  let level = woodLevel(state, tile, startHour), wood = 0;
  const per = depletePer(state, tile);
  for (let h = 1; h <= hours; h++) {
    const r = woodRate(state, tile, startHour + h, power, level);
    wood += r;
    level = Math.max(0, level - r * per);
  }
  const kept = Math.min(wood, Math.max(0, room) / SUPPLIES.wood.weight);
  return { wood: r1(kept), all: r1(wood), levelAfter: level, perHour: hours ? kept / hours : 0 };
}
// The tile panel's and team panel's line: what the land holds and what cutting would bring.
export function woodInfo(state, tile, { members = null, spare = [], hours = WOOD.defHours, startHour = state.hour, room = Infinity } = {}) {
  const abundance = woodAbundance(state, tile);
  const level = woodLevel(state, tile);
  const out = { abundance, level, word: woodWord(abundance * level) };
  if (members && members.length) {
    const crew = chopCrew(members, spare);
    out.tools = crew.filter((c) => c.tool).length;
    out.est = expectWood(state, members, tile, hours, startHour, room, chopPower(crew));
  }
  return out;
}
// Why a team cannot cut wood here ("" = it can).
export function woodProblem(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge)) return "not on open water.";
  if (!partyMembers(state, p).length) return "nobody to cut wood.";
  if (woodAbundance(state, tile) < 0.02) return "nothing to burn here (bare ground).";
  return "";
}

// ---------- one hour of cutting (orders.js taskHour) ----------
export function woodHour(state, p) {
  const t = p.task;
  const got = t.got || (t.got = { wood: 0, left: 0 });
  const members = partyMembers(state, p);
  if (!members.length) { got.stopped = "nobody left to cut wood."; return false; }
  const tile = partyTile(p);
  const crew = chopCrew(members, teamSpare(p));
  const rate = woodRate(state, tile, state.hour, chopPower(crew));
  if (rate > 0) {
    // A good hour or a poor one: 50% to 150% of the expected.
    const amount = Math.round(rate * (0.5 + state.rng.next()) * 100) / 100;
    const fit = Math.max(0, cargoRoom(state, p) / SUPPLIES.wood.weight);
    const kept = Math.max(0, Math.min(amount, fit));
    p.cargo = p.cargo || { supplies: {}, gear: [] };
    if (kept > 0) p.cargo.supplies.wood = (p.cargo.supplies.wood || 0) + kept;
    got.wood += kept;
    got.left += amount - kept;
    takeWood(state, tile, amount);
    const es = econStats(state);
    es.woodField = (es.woodField || 0) + kept; // the teams' cutting (the base job counts in es.woodCut)
    // Axes slip: a cut or a sprain now and then (half the chance gathering by hand).
    for (const c of crew) {
      if (state.rng.chance(WOOD.injury * (c.tool ? 1 : 0.5))) {
        addCondition(state, c.s, state.rng.chance(0.6) ? "cut" : "sprain", `cutting wood near ${tileLabel(state, tile)}`);
        (got.hurt || (got.hurt = [])).push(c.s.id);
      }
    }
    for (const s of members) { gainXp(state, s, "farming", 0.4); gainXp(state, s, "mechanics", 0.1); }
  }
  return true;
}
export function woodSummary(state, p, t) {
  const got = t.got || { wood: 0, left: 0 };
  const tile = partyTile(p);
  const left = got.left >= 30 ? ` No room to carry ${Math.floor(got.left)} more.` : "";
  const word = woodWord(woodAbundance(state, tile) * woodLevel(state, tile));
  const hurt = got.hurt && got.hurt.length ? ` ${got.hurt.map((id) => state.survivors.find((s) => s.id === id)).filter(Boolean).map(first).join(" and ")} got hurt at it.` : "";
  const stop = got.stopped ? ` Stopped: ${got.stopped}` : "";
  p.lastHaul = { kind: "wood", wood: got.wood, hour: state.hour };
  if (got.wood >= 30) log(state, `${teamName(state, p)} cut wood near ${tileLabel(state, tile)}: ${Math.floor(got.wood)} firewood.`, "good");
  return got.wood >= 15
    ? `Cut wood ${t.done}h: ${Math.round(got.wood)} firewood to carry home.${left}${hurt} Wood left here: ${word}.${stop}`
    : `Cut wood ${t.done}h and got next to nothing${woodAbundance(state, tile) < 0.1 ? " (bare ground)" : ""}.${hurt} Wood left here: ${word}.${stop}`;
}

// ---------- the Cut wood job at a base ----------
// The best tiles around a base, by what they would give now.
export function baseWoodTiles(state, base, hour = state.hour) {
  return state.grid.within(base.tile, WOOD.base.radius).filter((id) => woodAbundance(state, id) >= 0.04)
    .map((id) => ({ id, v: woodAbundance(state, id) * woodLevel(state, id, hour) }))
    .sort((a, b) => b.v - a.v || a.id - b.id);
}
// Expected firewood a woodcutter brings in a day at this base (for the job's "worth it", the panels, the autopilot):
// on a fair day of this season (no storm), from the best land around as it is now. s: that person (with their own
// tool or the armory's best), else an average one (skill ~3) with the armory's best tool.
export function baseWoodDay(state, base, s = null, hour = state.hour) {
  const tiles = baseWoodTiles(state, base, hour);
  if (!tiles.length) return 0;
  const armory = (base.armory || []).filter(isChopTool);
  const m = s ? chopCrew([s], armory)[0].mult : 0.85 * (armory.length ? Math.max(...armory.map(chopMult)) : 1);
  return WOOD.rate * tiles[0].v * seasonWood(state, hour) * m * WOOD.base.hours;
}
export function woodWorkWhy(state, base) {
  const tiles = baseWoodTiles(state, base);
  if (!tiles.length) return "no trees or timber within 2 tiles";
  if (baseWoodDay(state, base) < WOOD.worth) return "the land around is cut bare";
  return "";
}
// The k-th woodcutter's share at a base (0 = the first): WOOD.base.crowd less for each one before them.
export const woodCrowd = (k) => Math.max(WOOD.base.crowdFloor, 1 - WOOD.base.crowd * k);
// Hands it takes to bring in `perDay` firewood a day here (each extra one at woodCrowd; 0 when nothing is wanted or
// the land gives nothing). `each`: one woodcutter's day (baseWoodDay).
export function handsForDay(perDay, each, crowd = woodCrowd, max = 40) {
  if (!(perDay > 0) || !(each > 0)) return 0;
  let k = 0, got = 0;
  while (got + 1e-9 < perDay && k < max) got += each * crowd(k++);
  return k;
}
// The woodcutters a base wants (no fixed cap: sized to the need): enough to cut what the coming cold still needs
// (woodNeed) within `days` (default: WOOD.base.stockDays, or the days to the cold if sooner; at least minDays) and to
// keep up with the water boiler's daily firewood. 0 when the pile holds it.
export function woodHandsWanted(state, base, { w = woodNeed(state, base), days = null } = {}) {
  if (!w.short || w.need <= 0) return 0;
  const each = baseWoodDay(state, base);
  const d = days ?? Math.max(WOOD.base.minDays, Math.min(WOOD.base.stockDays, w.toCold));
  return handsForDay(Math.max(0, w.need - w.have) / d + (w.boiler > 0 ? w.boiler : 0), each);
}
// Daily (economy.js baseDaily): the people on the Cut wood role bring in their day's firewood from the best tiles
// around (each the best tile left, the land thinning as they go), with their own tools or the armory's; each one past
// the first a little less (woodCrowd).
export function woodDaily(state, base) {
  const people = atBase(state, base.id).filter((s) => s.role === "wood" && !s.inBed && workFactor(s) >= 0.35);
  base.woodNoise = 0;
  if (!people.length) return null;
  const dayStart = state.hour - 24;
  const crew = chopCrew(people, (base.armory || []).filter(isChopTool));
  const got = { wood: 0, tools: 0 };
  for (const [k, c] of crew.entries()) {
    const tile = (baseWoodTiles(state, base, dayStart + 12)[0] || {}).id;
    if (tile == null) break;
    const m = c.mult * Math.min(1, workFactor(c.s)) * woodCrowd(k);
    let r = 0;
    for (let i = 0; i < WOOD.base.hours; i++) r += woodRate(state, tile, dayStart + 8 + i * 2, m);
    const amount = Math.round(r * (0.7 + 0.6 * state.rng.next()) * 100) / 100;
    got.wood += amount;
    takeWood(state, tile, amount);
    if (c.tool) got.tools++;
    base.woodNoise += c.tool ? WOOD.noise.axe : WOOD.noise.hands;
    gainXp(state, c.s, "farming", USE.wood); // skills.js
    gainXp(state, c.s, "mechanics", USE.woodMech);
  }
  base.woodNoise = r1(base.woodNoise);
  base.stock.wood = (base.stock.wood || 0) + got.wood;
  const es = econStats(state);
  es.woodCut = (es.woodCut || 0) + got.wood;
  base.woodToday = r1(got.wood);
  noteOutput(state, base, "wood", got.wood, "wood");
  if (got.wood >= 30) log(state, `${crew.map((c) => first(c.s)).join(" and ")} cut ${Math.round(got.wood)} firewood around ${base.name}${got.tools < crew.length ? ` (${crew.length - got.tools === crew.length ? "no axe: deadfall by hand" : `${crew.length - got.tools} without an axe`})` : ""}.`, "good");
  return got;
}

// ---------- the winter's firewood ----------
// The share of days below freezing by part of the year (weather.js: about 30 days a year; late autumn 13%, winter
// 92%, early spring 16%). The governor's heating fuel plan (autopilot.js heatFuelWant) uses the same table.
export const FREEZE_SHARE = { "autumn-late": 0.13, "winter-early": 0.92, "winter-late": 0.92, "spring-early": 0.16 };
export const freezeShare = (dayIdx) => { const s = Weather.seasonOfDay(dayIdx); return FREEZE_SHARE[`${s.key}-${s.dayOfSeason > 14 ? "late" : "early"}`] || 0; };
// Freezing days expected from today to the end of the coming (or current) cold spell.
export function coldDaysAhead(state, hour = state.hour, horizon = 130) {
  const today = Math.floor(hour / 24);
  let days = 0, started = false;
  for (let d = today; d < today + horizon; d++) {
    const f = freezeShare(d);
    if (!f && started) break;
    if (f) started = true;
    days += f;
  }
  return days;
}
// Days until the hard cold (winter: most days freezing) begins; 0 while it lasts.
export const COLD_SHARE = 0.5;
export function daysToCold(state, hour = state.hour) {
  const today = Math.floor(hour / 24);
  for (let d = today; d < today + 130; d++) if (freezeShare(d) >= COLD_SHARE) return d - today;
  return 130;
}
// The stocking season: from late summer through the cold (a winter's firewood is cut in late summer and autumn).
export function woodSeason(state, hour = state.hour) {
  const s = Weather.season(state, hour);
  return s.key === "autumn" || s.key === "winter" || (s.key === "summer" && s.dayOfSeason > 14) || (s.key === "spring" && s.dayOfSeason <= 14);
}
// The firewood a base wants for the rest of the coming cold: everyone fed there (+ extra heads, e.g. teams coming
// home) × 0.5 a day (woodFor(HEAT.fuel)) × the freezing days ahead × WOOD.bitter, with a fifth to spare. Shelters keep warm by their fire.
// The water boiler (worm.js boilerUse) burns the same a head every day its water needs boiling, in every season:
// WORM.BOILER_DAYS days of it are wanted in store on top, and the stocking season is always on while it burns.
// { need, have, days (freezing days ahead), soon (the stocking season), short (have < need), cold (winter: the hard
// cold is here), toCold (days until it is), boiler (the boiler's firewood a day, 0 when it does not burn) }.
export function woodNeed(state, base, extraHeads = 0) {
  const days = coldDaysAhead(state);
  const heads = mouthsAt(state, base).heads + extraHeads;
  const boil = base.tier === 0 ? null : boilerUse(state, base);
  const boiler = boil && boil.active ? r1((boil.wood + extraHeads * WORM.BOILER_WOOD_HEAD) * (boil.share ?? 1)) : 0; // the days it burns: the filters' share of the drinking needs no boiling
  const need = base.tier === 0 ? 0 : Math.ceil(heads * woodFor(HEAT.fuel) * WOOD.bitter * days * WOOD.spare + boiler * WORM.BOILER_DAYS);
  const have = Math.max(0, base.stock.wood || 0);
  return { need, have, days: r1(days), soon: woodSeason(state) || boiler > 0, short: have < need, cold: daysToCold(state) === 0, toCold: daysToCold(state), heads, boiler };
}
// A base the winter will catch short of firewood (the alert, the Upkeep line): in the stocking season, with less than
// the coming cold needs and less heat in store (firewood and fuel) than that. null when it is fine.
export function woodShortfall(state, base) {
  if (base.tier === 0 || !atBase(state, base.id).length) return null;
  const w = woodNeed(state, base);
  if (!w.soon || !w.short || w.need <= 0) return null;
  const heat = w.have * HEAT.wood + Math.max(0, base.stock.fuel || 0) * 0.5; // half the fuel is kept for the vehicles
  if (heat >= w.need * HEAT.wood) return null;
  const day = baseWoodDay(state, base);
  const why = woodWorkWhy(state, base);
  return { ...w, perDay: Math.round(day), why, missing: Math.ceil(w.need - w.have) };
}

// ---------- fires ----------
// Deadfall within reach of a fire (the tile or one next to it).
export const fireWood = (state, tile) => Math.max(woodAbundance(state, tile), ...state.grid.neighbors(tile).map((n) => woodAbundance(state, n)));
export const fireLandOk = (state, tile) => fireWood(state, tile) >= WOOD.fire.land;
// Daily (needs.js heatDaily): a shelter's lit fire on bare ground burns firewood from its store; base.fireFed false =
// nothing to burn, so it does not warm the shelter (upkeep.js fireWarmed).
export function shelterFire(state, base) {
  if (!base || base.tier !== 0 || (base.campFire ?? base.fire) === false) { if (base) delete base.fireFed; return; }
  if (fireLandOk(state, base.tile)) { delete base.fireFed; return; }
  const need = WOOD.fire.shelter;
  const was = base.fireFed;
  if ((base.stock.wood || 0) >= need) { base.stock.wood -= need; base.fireFed = true; return; }
  base.fireFed = false;
  if (was !== false) log(state, `${base.name}'s fire is burning low: nothing to burn on this bare ground and no firewood in store. It does not keep anyone warm until firewood comes in.`, "danger");
}
// Hourly in camp (orders.js campHour): a team's lit fire on bare ground burns a little of the firewood it carries;
// with none it goes out. Returns true when the fire went out this hour.
export function campFireHour(state, p) {
  if (!p || (p.campFire ?? p.fire) === false) return false;
  const tile = partyTile(p);
  if (fireLandOk(state, tile)) return false;
  const per = WOOD.fire.camp / 24;
  if (carried(p, "wood") >= per) { takeSupply(p, "wood", per); return false; }
  p.campFire = false;
  log(state, `${teamName(state, p)}: the camp fire went out at ${tileLabel(state, tile)}: nothing to burn on this bare ground and no firewood carried.`, "info");
  return true;
}

// ---------- hints for the panels and the alerts ----------
const TERRAIN_WORD = { forest: "forest", plains: "farmland", hills: "hills", mountain: "mountains", suburb: "suburbs", city: "city" };
export function baseWoodHint(state, base) {
  const tiles = baseWoodTiles(state, base);
  if (!tiles.length) return "no trees within 2 tiles: send a team to cut wood, or trade for it";
  const best = tiles[0].id;
  const t = state.tiles[best];
  return `a woodcutter brings in about ${Math.round(baseWoodDay(state, base))} a day here (best: ${TERRAIN_WORD[t.terrain] || t.terrain}${best === base.tile ? " around the base" : ""})`;
}

// ---------- burnables: gear made of wood, paper or cloth (data.js GEAR `burnShare`) ----------
// The firewood an item makes goes by its weight: floor(weight × burnShare / the firewood's 0.1 kg) (burnOf): a 0.3 kg
// paperback 3, a 0.6 kg handbook 6, a 3 kg guitar (0.9 of it wood) 27, a 1.2 kg nail bat (0.8) 9, a 1 kg school
// backpack (0.5) 5, a 9 kg siege ladder 90.
// Break down for firewood (inventory.js breakDownAt, the inventory screen; breakDownJunk, the armory's bulk button):
// the item is gone and its burnOf firewood goes into the base's stores (from the armory, or someone's pack at a base)
// or the team's cargo supplies (from the cargo or a member's pack: the camp fire burns it like any firewood carried).
// It takes no time: it is kindling.
// The water boiler (worm.js boilerDaily) burns, after the firewood, what the base allows from its armory: items marked
// to burn (it.fire = "burn", any value) and, with the base's "Boiler may burn spare wooden items and paper" on
// (base.boilerJunk, on by default), cheap junk (isJunk: burnable, a pack item (never a weapon, a tool, armour or a
// bag) worth at most BURN.junkValue). An item marked to keep (it.fire = "keep") is never burned, nor anything worn or
// held (only the armory's items are).
export const BURN = { junkValue: 5 };
export const burnShare = (key) => Math.max(0, Math.min(1, (GEAR[key] && GEAR[key].burnShare) || 0));
export const burnOfKey = (key) => (burnShare(key) > 0 ? Math.floor(((GEAR[key].weight || 0) * burnShare(key)) / SUPPLIES.wood.weight + 1e-9) : 0);
export const burnOf = (it) => (it && GEAR[it.key] ? burnOfKey(it.key) : 0);
export const isJunk = (it) => burnOf(it) > 0 && GEAR[it.key].slot === "pack" && (GEAR[it.key].value || 0) <= BURN.junkValue;
export const boilerJunkOn = (base) => !!base && base.boilerJunk !== false;
export const boilerMayBurn = (base, it) => burnOf(it) > 0 && it.fire !== "keep" && (it.fire === "burn" || (boilerJunkOn(base) && isJunk(it)));
// What the boiler may burn from this base's armory, the cheapest firewood first (value per firewood).
export function boilerBurnables(base) {
  const per = (it) => (GEAR[it.key].value || 0) / burnOf(it);
  return (base.armory || []).filter((it) => boilerMayBurn(base, it)).sort((a, b) => per(a) - per(b));
}
export const burnablesWood = (list) => Math.round(list.reduce((a, it) => a + burnOf(it), 0) * 100) / 100;
// The armory's junk the bulk button breaks down: burnable junk not marked to keep.
export const armoryJunk = (base) => (base.armory || []).filter((it) => isJunk(it) && it.fire !== "keep");
// "a broken chair and two paperback novels": what was burned or broken down.
export function itemsText(list) {
  const n = {};
  for (const it of list) { const nm = ((GEAR[it.key] && GEAR[it.key].name) || it.name || it.key).toLowerCase(); n[nm] = (n[nm] || 0) + 1; }
  const NUM = ["", "a", "two", "three", "four", "five", "six"];
  const parts = Object.entries(n).map(([nm, k]) => (k === 1 ? `${/^[aeiou]/.test(nm) ? "an" : "a"} ${nm}` : `${NUM[k] || k} ${nm}${/s$/.test(nm) ? "" : "s"}`));
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
// The bulk button: every piece of unmarked junk in the armory into firewood. Returns the message.
export function breakDownJunk(state, base) {
  const list = armoryJunk(base);
  if (!list.length) return "No junk to break down in the armory.";
  const wood = burnablesWood(list);
  for (const it of list) base.armory.splice(base.armory.indexOf(it), 1);
  base.stock.wood = Math.max(0, base.stock.wood || 0) + wood;
  return `Broke down ${itemsText(list)} for firewood at ${base.name}: +${wood} firewood.`;
}
