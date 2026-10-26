// Stone (the user's request 2026-10-23: "Add rocks as a material to gather like wood can be gathered from demolition
// of rocks in build mode and add a gathering job. This is used to create campfires and update other buildings that make
// sense to use rocks in the cost/recipe"). Field stone, 1 kg a unit (data.js SUPPLIES.stone): a fire ring, a hearth, a
// well's or a cistern's lining, a root cellar's walls (buildings.js costs), and a camp's fire (CAMP.fireCost, staging.js).
// Three ways to get it:
//   - clearing the rocks and boulders on the base map (build mode: basescatter.js CLEAR rock, boulder: the builders
//     roll a rock away or break a boulder up, the stone into the stores; the camp's 5 × 5 too, when it is set up);
//   - the base job "Gather stone" (work.js, economy.js ROLES "stone"): people pick stone off the land round the base
//     STONE.hours a day (stoneDaily, at midnight from economy.js): one of them while the stores are short of STONE.keep,
//     up to three while queued buildings wait for more;
//   - the team order "Gather stone" on a land tile (N hours, like Cut wood; orders.js task "stone").
// The land: abundance by terrain (STONE.terrain: a mountain's scree best, hills good, a city's and a town's rubble
//   fair, farmland, plains and forest some, water none) × STONE.river by a river or lake (river stones). Stone does not
//   run out (there is always more under the next field), but the hours are daylight only (woodcutting.js woodTime).
// People: a gatherer = 0.7 + 0.05 × (0.7 Farming + 0.3 Mechanics) (woodcutterMult: the same land work) × their tool
//   (STONE.tools: a pickaxe ×2, a sledgehammer ×1.8, a crowbar or a Halligan bar ×1.4, a shovel or an entrenching tool
//   ×1.2; bare hands STONE.hands); a team's spare tools in the cargo and a base's armory go to those without one.
// Stone an hour = STONE.RATE × abundance × time × the gatherers (each one past the first 10% less, at least half).
// Risks: a strained back now and then (STONE.injury a person-hour on a team order).
import { log, atBase } from "./world.js";
import { partyMembers, partyTile, tileLabel, teamName, cargoRoom } from "./parties.js";
import { gainXp } from "./skills.js";
import { addCondition, workFactor } from "./health.js";
import { SUPPLIES, GEAR } from "./data.js";
import { carriedItems } from "./hunting.js";
import { woodTime, woodcutterMult } from "./woodcutting.js";
import { BUILDINGS, isShelter, countAll } from "./buildings.js"; // a camp's first stone builds (call-time only)

export const STONE = {
  RATE: 10,         // stone an hour for one average gatherer with bare hands on the best ground (a mountain's scree; 5 until the user's request 2026-10-26: "Increase yield of stones when gathering")
  hours: 6,         // the base job's hours a day (daylight)
  keep: 30,         // the base job opens while the stores hold less than this (a cook fire's and a boiler's) or less than the queued buildings wait for
  keepPeople: 5,    // the keep only at a base of this many people or more (stoneWant)
  defHours: 8,      // a team order's default length
  hands: 0.7,       // bare hands (a tool's multiplier below)
  tools: { pickaxe: 2, sledge: 1.8, prybar: 1.4, crowbar: 1.4, halligan: 1.4, shovel: 1.2, etool: 1.2, scrapshovel: 1.1 },
  terrain: { mountain: 1, hills: 0.8, city: 0.5, suburb: 0.35, plains: 0.35, forest: 0.3, water: 0 },
  river: 1.3,       // by a river or lake: river stones
  weights: [1, 0.9, 0.8, 0.7, 0.6, 0.5], // the gatherers on one tile: the best counts 1, the next 0.9 … (at least 0.5)
  injury: 0.001,    // a team order: a strained back, a person-hour (half without a tool)
};

// ---------- the land ----------
export function stoneAbundance(state, tile) {
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge)) return 0;
  let a = STONE.terrain[t.terrain] ?? 0.35;
  if (!a) return 0;
  if (t.river || state.grid.neighbors(tile).some((n) => state.tiles[n] && state.tiles[n].terrain === "water")) a *= STONE.river;
  return a;
}
export const stoneWord = (a) => (a >= 0.8 ? "plenty" : a >= 0.4 ? "some" : a >= 0.2 ? "little" : "scraps");

// ---------- people and tools ----------
// What a tool does for gathering stone (STONE.hands: not a stone tool, bare hands).
export function quarryMult(item) {
  if (!item || !GEAR[item.key]) return STONE.hands;
  return GEAR[item.key].quarry ?? STONE.tools[item.key] ?? STONE.hands;
}
export const isQuarryTool = (item) => quarryMult(item) > STONE.hands;
// Who gathers with what: each person's own best stone tool, then the spare ones to those without, best first.
export function quarryCrew(members, spare = []) {
  const crew = members.map((s) => {
    let tool = null, tm = STONE.hands;
    for (const it of carriedItems(s)) { const m = quarryMult(it); if (m > tm) { tool = it; tm = m; } }
    return { s, tool, mult: woodcutterMult(s) * tm };
  });
  const free = spare.filter(isQuarryTool).sort((a, b) => quarryMult(b) - quarryMult(a));
  for (const c of crew.filter((x) => !x.tool).sort((a, b) => woodcutterMult(b.s) - woodcutterMult(a.s) || a.s.id - b.s.id)) {
    const it = free.shift();
    if (!it) break;
    c.tool = it; c.mult = woodcutterMult(c.s) * quarryMult(it);
  }
  return crew.sort((a, b) => b.mult - a.mult || a.s.id - b.s.id);
}
export const quarryPower = (crew) => crew.reduce((a, c, i) => a + c.mult * (STONE.weights[i] ?? STONE.weights[STONE.weights.length - 1]), 0);
// Stone an hour on a tile for a crew of this power (no randomness).
export const stoneRate = (state, tile, hour, power) => STONE.RATE * stoneAbundance(state, tile) * woodTime(hour) * power;
// Expected haul of `hours` of gathering from startHour (stone never runs out); room = kg the team can still carry (the
// haul is capped by it; all = what was gathered). ui/landorder.js: the order's hours box.
export function expectStone(state, tile, hours, startHour = state.hour, room = Infinity, power = 1) {
  let all = 0;
  for (let h = 1; h <= hours; h++) all += stoneRate(state, tile, startHour + h, power);
  const kept = Math.min(all, Math.max(0, Math.floor(room / SUPPLIES.stone.weight + 1e-9)));
  return { stone: Math.round(kept * 10) / 10, all: Math.round(all * 10) / 10, perHour: hours ? kept / hours : 0 };
}

// ---------- the team order (orders.js task "stone") ----------
// Why a team cannot gather stone here ("" = it can).
export function stoneProblem(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge)) return "not on open water.";
  if (!partyMembers(state, p).length) return "nobody to gather stone.";
  if (stoneAbundance(state, tile) < 0.1) return "no stone to speak of here.";
  return "";
}
// One hour of it (orders.js taskHour): the stone goes into the cargo as far as there is room.
export function stoneHour(state, p) {
  const t = p.task;
  const got = t.got || (t.got = { stone: 0, left: 0 });
  const members = partyMembers(state, p);
  if (!members.length) { got.stopped = "nobody left to gather stone."; return false; }
  const tile = partyTile(p);
  const crew = quarryCrew(members, (p.cargo && p.cargo.gear) || []);
  const rate = stoneRate(state, tile, state.hour, quarryPower(crew));
  if (rate > 0) {
    const amount = Math.round(rate * (0.5 + state.rng.next()));
    const fit = Math.max(0, Math.floor(cargoRoom(state, p) / SUPPLIES.stone.weight));
    const kept = Math.max(0, Math.min(amount, fit));
    p.cargo = p.cargo || { supplies: {}, gear: [] };
    if (kept > 0) p.cargo.supplies.stone = (p.cargo.supplies.stone || 0) + kept;
    got.stone += kept;
    got.left += amount - kept;
    for (const c of crew) {
      if (state.rng.chance(STONE.injury * (c.tool ? 1 : 0.5))) {
        addCondition(state, c.s, "sprain", `gathering stone near ${tileLabel(state, tile)}`);
        (got.hurt || (got.hurt = [])).push(c.s.id);
      }
    }
    for (const s of members) gainXp(state, s, "farming", 0.3);
  }
  return true;
}
export function stoneSummary(state, p, t) {
  const got = t.got || { stone: 0, left: 0 };
  const tile = partyTile(p);
  const left = got.left >= 5 ? ` No room to carry ${Math.floor(got.left)} more.` : "";
  const hurt = got.hurt && got.hurt.length ? ` ${got.hurt.map((id) => state.survivors.find((s) => s.id === id)).filter(Boolean).map((s) => s.name.split(" ")[0]).join(" and ")} strained a back at it.` : "";
  const stop = got.stopped ? ` Stopped: ${got.stopped}` : "";
  p.lastHaul = { kind: "stone", stone: got.stone, hour: state.hour };
  if (got.stone >= 10) log(state, `${teamName(state, p)} gathered stone near ${tileLabel(state, tile)}: ${got.stone} stone.`, "good");
  return got.stone >= 1
    ? `Gathered stone ${t.done}h: ${got.stone} stone to carry home.${left}${hurt}${stop}`
    : `Gathered stone ${t.done}h and found next to nothing${stoneAbundance(state, tile) < 0.2 ? " (little stone here)" : ""}.${hurt}${stop}`;
}

// ---------- the Gather stone job at a base (economy.js daily) ----------
// Why the job cannot be worked here ("" = it can).
export function stoneWorkWhy(state, base) {
  return stoneAbundance(state, base.tile) < 0.1 ? "no stone to speak of round here" : "";
}
// The stone the base wants: what the queued buildings still wait for, else STONE.keep in the stores.
// A base of fewer than STONE.keepPeople keeps none in hand (a camp of three has better to do): only what is queued,
// and at a camp or a shelter the stone of its first stone builds not yet standing nor queued (FIRST: a water boiler and
// a cook fire, what its yard goes up with: the governor's campYard waits for them before the step up).
const FIRST = ["boiler", "cookhouse"];
export function stoneWant(state, base) {
  const queued = (base.construction || []).reduce((a, c) => a + Math.max(0, ((c.cost && c.cost.stone) || 0) - ((c.paid && c.paid.stone) || 0)), 0);
  const first = isShelter(base) ? FIRST.filter((k) => !countAll(base, k) && !base.construction.some((c) => c.type === k)).reduce((a, k) => a + (BUILDINGS[k].cost.stone || 0), 0) : 0;
  return Math.max(atBase(state, base.id).length >= STONE.keepPeople ? STONE.keep : 0, queued + first);
}
export const stoneShort = (state, base) => Math.max(0, stoneWant(state, base) - Math.floor((base.stock && base.stock.stone) || 0));
// A day's stone for one gatherer here (the work panel's estimate): STONE.hours of daylight.
export const stoneDayEach = (state, base, s) => STONE.RATE * stoneAbundance(state, base.tile) * STONE.hours * quarryCrew([s], (base.armory || []).filter(isQuarryTool))[0].mult;
// At midnight: the day's gathering by everyone on the job (in bed, or too sick to work, they do nothing).
export function stoneDaily(state, base) {
  const people = atBase(state, base.id).filter((s) => s.role === "stone" && !s.inBed && workFactor(s) >= 0.35);
  if (!people.length || stoneWorkWhy(state, base)) return null;
  const crew = quarryCrew(people, (base.armory || []).filter(isQuarryTool));
  const got = Math.round(STONE.RATE * stoneAbundance(state, base.tile) * STONE.hours * quarryPower(crew) * (0.8 + 0.4 * state.rng.next()));
  base.stock.stone = (base.stock.stone || 0) + got;
  base.stoneToday = got;
  for (const c of crew) gainXp(state, c.s, "farming", 0.3);
  if (got >= 10) log(state, `${crew.map((c) => c.s.name.split(" ")[0]).join(" and ")} gathered ${got} stone round ${base.name}${crew.some((c) => !c.tool) ? " (no pickaxe or sledgehammer for some: by hand)" : ""}.`, "good");
  return { stone: got };
}
