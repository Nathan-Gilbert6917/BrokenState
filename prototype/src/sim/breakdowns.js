// Things break (suggestions-2 #20, hub tasks): buildings and equipment at your bases wear out and break, and a
// broken one stops (or weakens) until a named survivor repairs it. Fixtures: the hub's own well pump, wells, the
// generator, the still, the machine shop, the ammo bench, the med station, the preserving room, the radio
// station, walls and the reinforced gate (damaged by attacks), and the storehouse roof (storms). Parked vehicles
// lose condition on frost days, but not the cars in a garage (vehicles.js frostWear; repaired as before, from the Vehicles tab or the Repairs list).
//
// Wear (0–100) builds up every day: use (a station that ran, a well that pumped) × age (+1/240 a day since it was
// built) + weather (frost for pumps, storms for pumps, masts and roofs) + attacks (a horde at the walls; raids: raidDamage below),
// × the operator's Mechanics (−2.5% a point, from ×1.15, at least ×0.65), × a Grease Monkey (×0.8) or Handy (×0.85)
// survivor living there, × 1.6 while jury-rigged. Builders with no construction job do upkeep: 1.5 wear off the most
// worn fixture per builder a day; a builder kept on upkeep (s.upkeep: the governor's at a big hub, autopilot.js
// UPKEEP_CREW) does it every day, build queue or not, and adds nothing to the construction (buildings.js buildRate). A fixture breaks at 100, and from 60 up with a daily chance ((wear − 60) / 40)² × 30%.
//
// Raid damage (raidDamage, called when a raid on your base is settled: factions.js, conflicts.js, visitors.js).
// Raiders smash what they reach: the damage is a budget of wear points = the raid's strength × 3 × (hours the
// siege lasted / 8, between 0.15 and 1.5) × the outcome (driven off 1, beaten in a stand-up fight 0.5, a break-in
// 2.5, overrun 4.5). The budget is spent in hits of 30–70 wear: the outer line first (walls, the reinforced gate,
// barricades, floodlights, the watchtower: 85% of the hits when they are driven off, 50% in a break-in, 35% when
// they overrun the base), the rest on the buildings inside (bunkhouses, stores, workshops, the radio, wells…); 40%
// of the hits after the first fall on the building hit last, if it still stands (they hammer at a weak spot).
// A building pushed to 100 wear breaks (it does nothing until repaired, as above); one at 60+ is damaged and may
// break any day (a damaged wall gives two thirds of its tier's wall strength, buildings.js baseWalls). An overrun base also
// loses one broken building outright (60%: torn down or burned, never the walls). Raiders that are driven off
// quickly leave scratches; a long siege, a break-in or an overrun leaves a repair bill (the result card and the
// log list it; the Repairs tab keeps the last raid's damage). Nobody repairs or builds at a base while it is on
// alert or under siege (the builders and mechanics are on the walls): that is what "Prepare defenses" costs.
//
// A broken fixture: a station does nothing, a well gives no water (the hub's pump: 6 less a day), the radio station
// is off the air, a wall loses its wall strength, the gate its horde bonus, the storehouse its room. It shows in
// the alerts and the base's Repairs tab, with a card offering:
//   Repair properly  the best free mechanic (Mechanics at least the job's minimum) for the job's hours (× 1.2 − 3% a
//                    Mechanics point, at least 40%, faster with Handy / Master Builder), and its scrap and parts;
//                    wear back to 8.
//   Jury-rig         a third of the hours (at least 1), cheap, any skill (at least the rig minimum); wear left at 65 and
//                    it wears 60% faster until it is repaired properly.
//   Leave it         stays broken, on the Repairs list.
// The repairer works the job between 08:00 and 20:00 while at the base and well enough (work factor 0.35+), keeping
// their role. The autopilot, and a steward with Building on, start the repairs themselves (repair if they can pay,
// else jury-rig) and replace a repairer who left. The old storm "broken well pump" hub event is this system now.
// Machines and machine parts (freezer-parts 2026-10-10, user request "add mechanical parts as something to use in
// buildings that use machines"): every building with a motor, pump, compressor or press is a machine fixture. It costs
// machine parts to build (buildings.js), its proper repair takes parts, and it wears with use: a station by the days it
// ran, the generator by the days it ran (machines-2: no operator, power.js b.lastRan), a powered building (power: true:
// the walk-in freezer, the vacuum sealer) by the days it had power, the radio every day it is on the air, floodlights
// in every horde attack (attack), the garage with age. A preserving room fitted with a pressure canner (machines-2,
// buildings.js b.canner) is a machine too: FIXTURES.canner instead of the kitchen's (fxDef). A generator upgraded a tier
// (gen-tiers, power.js GEN_TIERS: b.tier) is FIXTURES.generator2 / generator3 (fxDef): a bigger engine wears faster, eats
// spares sooner and its proper repair takes more parts and a better mechanic (Mechanics 3 / 4 / 5).
// Spares (spares: days of running a part lasts): a running machine uses up a spare part every that many days of work
// (fx.spares builds up 1/spares a running day): from this base's stock, else the hub's, as the relay does (radio.js).
// With no part anywhere the machine runs on worn bits: +WEAR.noSpares wear a day until one comes in (one log line).
// Generator 20 days, walk-in freezer 12, radio 20, machine shop 30, still 40, vacuum sealer 30, a kitchen's pressure
// canner 30. Buildings with no machine (walls, cellar, bunkhouse, cold store, drying rack, boiler, cook fire) take no
// parts. Broken, a machine stops (a station does nothing, a generator gives no power, a powered building draws none:
// power.js; the freezer is then off and warms up).
// Rolls use hash01 (skills.js), never the world's random numbers.
import { BUILDINGS, count, assignStations, underAttack, onUpkeep } from "./buildings.js";
import { log, addCard, day, hourOfDay, atBase, survivorById, skill } from "./world.js";
import { hash01, gainXp, buildMult, hasPerk, USE } from "./skills.js";
import { workFactor } from "./health.js";
import { stationStatus } from "./buildings.js";
import { isPowered, generatorRanToday, POWER, REFUEL, GEN_TIERS, genTier, genName } from "./power.js"; // powered machines wear by the days they had power (freezer-parts); generators by the days they ran (machines-2)
import { weatherOnDay } from "./weather.js";
import { stewardOn } from "./steward.js";
import { vehiclesAtBase, shelteredAt, frostWear } from "./vehicles.js";
import { isManaged, prio } from "./work.js";
import { prisonLabour } from "./prisoners.js"; // prisoners-tab: prisoners set to Clean and mend (breakdownsDaily upkeep)
import { cfgOf } from "./worldcfg.js"; // the run's dials: Failures

export const WELL_WATER = 6; // the hub pump's share (hubevents.js WELL_DOWN.water)
export const SCRAP_PER_PART = 4; // a repair short of scrap can use a part instead of this much
// use: wear a day of use; age: a day standing; frost / storm / rain: extra on such a day; attack: wear per attack.
// repair / rig: { hours, cost, min (Mechanics) }; what: what breaking does.
export const FIXTURES = {
  pump:        { name: "Well pump", use: 0.9, frost: 2.5, storm: 4, repair: { hours: 6, cost: { scrap: 3, parts: 1 }, min: 1 }, rig: { hours: 2, cost: { scrap: 1 }, min: 0 }, what: `the hub's well gives ${WELL_WATER} less water a day` },
  well:        { use: 0.9, frost: 2.5, storm: 4, repair: { hours: 6, cost: { scrap: 3, parts: 1 }, min: 1 }, rig: { hours: 2, cost: { scrap: 1 }, min: 0 }, what: "no water from this well" },
  generator:   { use: 1.6, idle: 0.15, spares: 20, repair: { hours: 10, cost: { scrap: 4, parts: 2 }, min: 3 }, rig: { hours: 3, cost: { scrap: 2 }, min: 1 }, what: "no power from it" },
  // A generator's upper tiers (gen-tiers, power.js GEN_TIERS; not building types: fxDef by b.tier).
  generator2:  { use: 1.9, idle: 0.18, spares: 16, repair: { hours: 12, cost: { scrap: 6, parts: 3 }, min: 4 }, rig: { hours: 4, cost: { scrap: 3 }, min: 2 }, what: "no power from it" },
  generator3:  { use: 2.2, idle: 0.2, spares: 12, repair: { hours: 16, cost: { scrap: 8, parts: 4 }, min: 5 }, rig: { hours: 5, cost: { scrap: 4 }, min: 3 }, what: "no power from it" },
  still:       { use: 1.2, idle: 0.1, spares: 40, repair: { hours: 6, cost: { scrap: 3, parts: 1 }, min: 2 }, rig: { hours: 2, cost: { scrap: 2 }, min: 0 }, what: "no fuel from it" },
  machine_shop:{ use: 1.2, idle: 0.1, spares: 30, repair: { hours: 8, cost: { scrap: 3, parts: 1 }, min: 3 }, rig: { hours: 3, cost: { scrap: 2 }, min: 1 }, what: "no parts from it" },
  ammo_bench:  { use: 0.8, idle: 0.05, repair: { hours: 4, cost: { scrap: 2, parts: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no ammo from it" },
  reload_bench: { use: 0.8, idle: 0.05, repair: { hours: 4, cost: { scrap: 2, parts: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no rounds from it" }, // reloading.js: an ammo bench upgraded
  med_station: { use: 0.6, idle: 0.05, repair: { hours: 4, cost: { scrap: 2 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no meds from it" },
  kitchen:     { use: 0.8, idle: 0.05, repair: { hours: 4, cost: { scrap: 2 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no preserving" },
  // A preserving room with a pressure canner fitted (machines-2; not a building type: fxDef): wears a little faster
  // with the canner's seals and gauge, its repair takes a machine part, a spare part every 30 days it runs (the sealer's).
  canner:      { use: 1.0, idle: 0.05, spares: 30, repair: { hours: 5, cost: { scrap: 2, parts: 1 }, min: 2 }, rig: { hours: 2, cost: { scrap: 1 }, min: 1 }, what: "no preserving (the kitchen and its pressure canner)" },
  radio:       { use: 0.7, storm: 6, spares: 20, repair: { hours: 10, cost: { scrap: 4, parts: 2 }, min: 4 }, rig: { hours: 3, cost: { scrap: 2 }, min: 2 }, what: "the radio station is off the air" },
  walls:       { age: 0.05, attack: 18, repair: { hours: 12, cost: { scrap: 10 }, min: 0 }, rig: { hours: 4, cost: { scrap: 4 }, min: 0 }, what: "no wall strength" },
  gate:        { age: 0.05, attack: 22, repair: { hours: 8, cost: { scrap: 6, parts: 1 }, min: 1 }, rig: { hours: 3, cost: { scrap: 3 }, min: 0 }, what: "the gate no longer holds hordes back" },
  storehouse:  { age: 0.1, storm: 8, rain: 1, repair: { hours: 6, cost: { scrap: 4 }, min: 0 }, rig: { hours: 2, cost: { scrap: 2 }, min: 0 }, what: "a leaking roof: no food room and no protection from raiders" },
  // Raid damage only (raidOnly: no wear from use, age or weather; outer: the defensive line raiders hit first).
  barricades:  { raidOnly: true, outer: true, repair: { hours: 4, cost: { scrap: 4 }, min: 0 }, rig: { hours: 2, cost: { scrap: 2 }, min: 0 }, what: "a gap in the barricades: 12% less of a horde held back, no cover there on the battle map" },
  floodlights: { raidOnly: true, outer: true, attack: 4, repair: { hours: 5, cost: { scrap: 3, parts: 1 }, min: 1 }, rig: { hours: 2, cost: { scrap: 2 }, min: 0 }, what: "dark walls: no floodlight bonus" },
  watchtower:  { raidOnly: true, outer: true, repair: { hours: 6, cost: { scrap: 6 }, min: 0 }, rig: { hours: 2, cost: { scrap: 3 }, min: 0 }, what: "no lookout post: 2 tiles less vision and later warnings" },
  bunkhouse:   { raidOnly: true, repair: { hours: 8, cost: { scrap: 8 }, min: 0 }, rig: { hours: 3, cost: { scrap: 4 }, min: 0 }, what: "6 fewer beds" },
  barracks:    { raidOnly: true, repair: { hours: 12, cost: { scrap: 14 }, min: 0 }, rig: { hours: 4, cost: { scrap: 6 }, min: 0 }, what: "12 fewer beds" },
  cistern:     { raidOnly: true, repair: { hours: 8, cost: { scrap: 8 }, min: 0 }, rig: { hours: 3, cost: { scrap: 4 }, min: 0 }, what: "a holed tank: 150 less water room" },
  cellar:      { raidOnly: true, repair: { hours: 6, cost: { scrap: 5 }, min: 0 }, rig: { hours: 2, cost: { scrap: 2 }, min: 0 }, what: "a caved-in cellar: 200 less food room" },
  coldstore:   { raidOnly: true, repair: { hours: 6, cost: { scrap: 6 }, min: 0 }, rig: { hours: 2, cost: { scrap: 3 }, min: 0 }, what: "a smashed ice house: 150 less food room" }, // an ice house again (machines-2: no power)
  garage:      { age: 0.12, repair: { hours: 8, cost: { scrap: 6, parts: 1 }, min: 1 }, rig: { hours: 3, cost: { scrap: 3 }, min: 0 }, what: "vehicle repairs at the field rate" },
  cells:       { raidOnly: true, repair: { hours: 6, cost: { scrap: 5, parts: 1 }, min: 0 }, rig: { hours: 2, cost: { scrap: 3 }, min: 0 }, what: "broken bars: 3 fewer places for prisoners" },
  common_room: { raidOnly: true, repair: { hours: 6, cost: { scrap: 6 }, min: 0 }, rig: { hours: 2, cost: { scrap: 3 }, min: 0 }, what: "no mood from the common room" },
  chapel:      { raidOnly: true, repair: { hours: 5, cost: { scrap: 5 }, min: 0 }, rig: { hours: 2, cost: { scrap: 2 }, min: 0 }, what: "no mood from the chapel" },
  huntcabin:   { raidOnly: true, repair: { hours: 4, cost: { scrap: 3 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no hunting from it, no smoking" },
  smoker:      { raidOnly: true, repair: { hours: 2, cost: { scrap: 2 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no drying" },
  rain_catcher:{ raidOnly: true, repair: { hours: 2, cost: { scrap: 2 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no rain water from it" },
  relay:       { raidOnly: true, repair: { hours: 6, cost: { scrap: 4, parts: 1 }, min: 2 }, rig: { hours: 2, cost: { scrap: 2 }, min: 1 }, what: "the relay is off the air" },
  // Powered machines (power: wear only on days they have power; idle otherwise). freezer-parts.
  freezer:     { power: true, use: 0.9, idle: 0.05, spares: 12, repair: { hours: 8, cost: { scrap: 3, parts: 2 }, min: 3 }, rig: { hours: 3, cost: { scrap: 2 }, min: 1 }, what: "the walk-in freezer is off: the food in it warms up and keeps only as in a pantry" },
  sealer:      { power: true, use: 0.5, idle: 0.02, spares: 30, repair: { hours: 4, cost: { scrap: 2, parts: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "no vacuum sealing (no packaged meals)" },
  // Wave 2 cooking (cooking.js): hand-cranked, worn on the days the cooks turned them (ranDay: b.ran is the day).
  grainmill:   { ranDay: true, use: 0.5, idle: 0.01, spares: 40, repair: { hours: 3, cost: { scrap: 2, parts: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no flour (the grain mill)" },
  meatgrinder: { ranDay: true, use: 0.6, idle: 0.01, spares: 40, repair: { hours: 3, cost: { scrap: 2, parts: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no ground meat or sausage (the meat grinder)" },
  canteen:     { raidOnly: true, repair: { hours: 5, cost: { scrap: 4 }, min: 0 }, rig: { hours: 2, cost: { scrap: 2 }, min: 0 }, what: "no hot meals: the food is eaten as before" }, // kitchen.js
  animal_pen:  { raidOnly: true, repair: { hours: 4, cost: { scrap: 3 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "a broken fence: the animals scattered, no food from the pen" },
};
FIXTURES.walls.outer = true;
FIXTURES.gate.outer = true;
// Raid damage (see the header): budget = strength × perStrength × clamp(hours / 8, minHours, maxHours) × outcome.
export const RAID_DAMAGE = {
  perStrength: 3, focus: 0.4, minHours: 0.15, maxHours: 1.5, hit: [30, 70], damaged: 60,
  outcome: { held: 1, won: 0.5, broken: 2.5, overrun: 4.5 },
  outerShare: { held: 0.85, won: 0.85, broken: 0.5, overrun: 0.35 },
  destroy: 0.6,
};
export const WEAR = { noSpares: 3, ageDays: 240, breakAt: 100, riskFrom: 60, riskMax: 0.3, rigWear: 65, repairWear: 8, rigMult: 1.6, upkeep: 1.5, greaseMonkey: 0.8, handy: 0.85, workFrom: 8, workTo: 20, vehicleFrost: 1, vehicleBlizzard: 2 };

// A fixture's entry: a kitchen with a pressure canner fitted counts as the canner (machines-2), the rest by type.
export const fxDef = (fx) => (fx && fx.type === "kitchen" && fx.canner ? FIXTURES.canner : fx && fx.type === "generator" && genTier(fx) > 1 ? FIXTURES[`generator${genTier(fx)}`] : FIXTURES[fx.type]);
// The fixture entry of a generator of tier t (the build menu, the Power card).
export const genFixture = (t) => (t > 1 ? FIXTURES[`generator${t}`] : FIXTURES.generator);
// ---------- fixtures at a base ----------
// The hub's pump is a fixture of its own (base.pump); everything else is a building with an entry in FIXTURES.
export function fixtures(base) {
  const out = base.buildings.filter((b) => FIXTURES[b.type]);
  if (base.type === "hub" && base.tier !== 0) { // a shelter (tier 0) has no well pump yet
    if (!base.pump) base.pump = { id: "pump", type: "pump", wear: 0, built: 1 };
    out.unshift(base.pump);
  }
  return out;
}
// A key for the dice that does not depend on object ids (they differ between two worlds made in one process).
const fxKey = (base, fx) => `${base.tile}:${fx.type}:${base.buildings.indexOf(fx)}`;
export const fixtureName = (fx) => (fx.type === "pump" ? "Well pump" : fx.type === "generator" && genTier(fx) > 1 ? genName(fx) : (BUILDINGS[fx.type] && BUILDINGS[fx.type].name) || fx.type); // gen-tiers: a standby generator, an industrial diesel set
export const fixtureById = (base, id) => fixtures(base).find((f) => String(f.id) === String(id)) || null;
export const isBroken = (fx) => !!(fx && fx.broken);
export const isWaterFixture = (fx) => !!fx && (fx.type === "well" || fx.type === "pump");
export const brokenAt = (base) => fixtures(base).filter(isBroken);
const jobs = (base) => base.repairs || (base.repairs = []);
export const jobFor = (base, fx) => jobs(base).find((j) => String(j.fx) === String(fx.id)) || null;

// ---------- breaking and fixing ----------
export function breakFixture(state, base, fx, cause = "worn out", { card = true, quiet = false } = {}) {
  if (!fx || fx.broken) return false;
  fx.broken = { day: day(state), cause };
  fx.lastBroke = day(state); // the buildings view's "last breakdown"
  fx.wear = Math.max(fx.wear || 0, WEAR.breakAt);
  applyEffect(state, base, fx);
  const def = fxDef(fx);
  if (!quiet) log(state, `⚠ The ${fixtureName(fx).toLowerCase()} at ${base.name} broke (${cause}): ${def.what} until it is repaired.`, "danger");
  state.stats.breakdowns = (state.stats.breakdowns || 0) + 1;
  if (autoHands(state, base)) autoRepair(state, base, fx);
  else if (card) addCard(state, breakCard(state, base, fx));
  return true;
}
// What a broken fixture does to the base (a station, a well, walls and the storehouse are left out by buildings.js
// count / stationOperator; the pump and the radio need a flag).
function applyEffect(state, base, fx) {
  if (fx.type === "pump") base.wellDown = { until: 1e9, water: WELL_WATER, broken: true };
  if (fx.type === "radio") base.radio = false;
  if (fx.type === "watchtower") base.watchtower = count(base, "watchtower") > 0;
}
function fixed(state, base, fx, method) {
  fx.broken = null;
  fx.wear = method === "rig" ? WEAR.rigWear : WEAR.repairWear;
  fx.rigged = method === "rig";
  if (fx.type === "pump") delete base.wellDown;
  if (fx.type === "radio") base.radio = true;
  if (fx.type === "watchtower") base.watchtower = true;
}

// What a repair takes: { ok, why, who, hours, cost, method }.
export function repairPlan(state, base, fx, method = "repair", whoId = null) {
  const def = fxDef(fx);
  const r = def[method];
  const busy = new Set(jobs(base).filter((j) => String(j.fx) !== String(fx.id)).map((j) => j.who));
  const able = atBase(state, base.id).filter((s) => !s.inBed && workFactor(s) >= 0.35 && !busy.has(s.id) && skill(s, "mechanics") >= r.min)
    .sort((a, b) => skill(b, "mechanics") - skill(a, "mechanics") || (a.role === "build") - (b.role === "build") || a.id - b.id);
  const who = whoId != null ? able.find((s) => s.id === whoId) || null : able[0] || null;
  const mech = who ? skill(who, "mechanics") : 0;
  const hours = Math.max(1, Math.ceil(r.hours * Math.max(0.4, 1.2 - 0.03 * mech) / (who ? buildMult(who) : 1)));
  // Scrap that is short can be made up with parts (1 part for SCRAP_PER_PART scrap).
  const cost = { ...r.cost };
  const lack = Math.max(0, (cost.scrap || 0) - Math.floor(base.stock.scrap || 0));
  if (lack > 0) { cost.scrap -= lack; cost.parts = (cost.parts || 0) + Math.ceil(lack / SCRAP_PER_PART); if (!cost.scrap) delete cost.scrap; }
  const short = Object.entries(cost).filter(([k, v]) => (base.stock[k] || 0) < v);
  // A damaged fixture (wear 60+, not broken yet) can be patched up with a proper repair before it gives way.
  const why = !fx.broken && !(method === "repair" && (fx.wear || 0) >= RAID_DAMAGE.damaged) ? "Not broken." : jobFor(base, fx) ? "Already being worked on." : !who ? (r.min ? `Needs a free survivor with Mechanics ${r.min}+ here.` : "Nobody here is free and well enough.") :
    short.length ? `Needs ${costText(r.cost)} (short scrap can be made up with parts, 1 for ${SCRAP_PER_PART}).` : "";
  return { ok: !why, why, who, hours, cost, method, min: r.min };
}
export const costText = (cost) => Object.entries(cost).map(([k, v]) => `${v} ${k === "parts" && v === 1 ? "part" : k}`).join(", ");

export function startRepair(state, base, fx, method = "repair", whoId = null) {
  const plan = repairPlan(state, base, fx, method, whoId);
  if (!plan.ok) return plan.why;
  for (const [k, v] of Object.entries(plan.cost)) base.stock[k] -= v;
  jobs(base).push({ id: `${fx.id}`, fx: fx.id, method, who: plan.who.id, hours: plan.hours, done: 0, paid: { ...plan.cost }, started: state.hour });
  return `${plan.who.name.split(" ")[0]} starts ${method === "rig" ? "jury-rigging" : "repairing"} the ${fixtureName(fx).toLowerCase()} at ${base.name} (${plan.hours} work-hours, ${costText(plan.cost)}).`;
}
export function cancelRepair(state, base, fxId) {
  const list = jobs(base);
  const i = list.findIndex((j) => String(j.fx) === String(fxId));
  if (i < 0) return "No such job.";
  const [j] = list.splice(i, 1);
  for (const [k, v] of Object.entries(j.paid || {})) base.stock[k] = (base.stock[k] || 0) + v;
  return "Repair cancelled; the materials are back in stock.";
}
// Someone else takes over a job (the UI, or the autopilot when the repairer left).
export function reassignRepair(state, base, fxId, whoId) {
  const j = jobs(base).find((x) => String(x.fx) === String(fxId));
  const fx = fixtureById(base, fxId);
  if (!j || !fx) return "No such job.";
  const s = survivorById(state, whoId);
  const r = fxDef(fx)[j.method];
  if (!s || !atBase(state, base.id).includes(s) || skill(s, "mechanics") < r.min) return "They cannot do it.";
  j.who = s.id;
  return `${s.name.split(" ")[0]} takes over the ${fixtureName(fx).toLowerCase()}.`;
}

// The card when something breaks (and the merged storm "well pump" hub event, hubevents.js).
export function breakCard(state, base, fx, { pumpStorm = null } = {}) {
  const def = fxDef(fx);
  const rep = repairPlan(state, base, { ...fx, broken: fx.broken || { day: day(state) } }, "repair");
  const rig = repairPlan(state, base, { ...fx, broken: fx.broken || { day: day(state) } }, "rig");
  const first = (s) => (s ? s.name.split(" ")[0] : "");
  // pumpStorm: the hub event's card: the pump is not broken yet; each choice breaks it (so every choice does something).
  const ensure = (st) => { if (!fx.broken) { fx.broken = { day: day(st), cause: pumpStorm ? "storm damage" : "worn out" }; fx.wear = Math.max(fx.wear || 0, WEAR.breakAt); applyEffect(st, base, fx); } };
  const name = fixtureName(fx).toLowerCase();
  return {
    title: pumpStorm != null ? `The well pump at ${base.name} is broken` : `The ${name} at ${base.name} broke down`,
    text: `${pumpStorm != null ? `${pumpStorm ? "The storm" : "The weather"} wrecked the pump housing on the well.` : `The ${name} at ${base.name} gave out (${fx.broken ? fx.broken.cause : "worn out"}).`} Until it is fixed: ${def.what}. It needs someone with the skill and some hours.`,
    breakdown: { baseId: base.id, fx: fx.id },
    choices: [
      {
        label: rep.who ? `Repair it: ${first(rep.who)} (Mechanics ${skill(rep.who, "mechanics")}), ${rep.hours}h, ${costText(rep.cost)}` : `Repair it (${costText(rep.cost)})`,
        hint: rep.ok ? `Fixed properly after ${rep.hours} work-hours (worked 08:00–20:00); wear back to ${WEAR.repairWear}.` : rep.why,
        disabled: () => !repairPlan(state, base, { ...fx, broken: fx.broken || { day: 0 } }, "repair").ok,
        ai: () => (rep.ok ? 8 : 0),
        resolve: (st) => { ensure(st); return startRepair(st, base, fx, "repair"); },
      },
      {
        label: rig.who ? `Jury-rig it: ${first(rig.who)}, ${rig.hours}h, ${costText(rig.cost)}` : `Jury-rig it (${costText(rig.cost)})`,
        hint: rig.ok ? `Running again after ${rig.hours} work-hours, but it wears ${Math.round((WEAR.rigMult - 1) * 100)}% faster and breaks again sooner (wear left at ${WEAR.rigWear}).` : rig.why,
        disabled: () => !repairPlan(state, base, { ...fx, broken: fx.broken || { day: 0 } }, "rig").ok,
        ai: () => (rig.ok ? (rep.ok ? 3 : 6) : 0),
        resolve: (st) => { ensure(st); return startRepair(st, base, fx, "rig"); },
      },
      {
        label: "Leave it for now",
        hint: `${def.what[0].toUpperCase()}${def.what.slice(1)} until someone fixes it (the base's Repairs tab).`,
        ai: () => 0.5,
        resolve: (st) => { ensure(st); return `The ${name} stays broken for now: it is on ${base.name}'s Repairs list.`; },
      },
    ],
  };
}

// The autopilot (all bases) and a steward with Building on fix things themselves.
// So does a base where someone on work priorities has Repair set (work.js).
export const autoHands = (state, base) => !!state.autopilot || (stewardOn(base) && base.steward.areas.building !== false) ||
  (!!state.work && atBase(state, base.id).some((s) => isManaged(state, s) && prio(state, s, "repair") > 0));
const handIcon = (state, base) => (state.autopilot ? "🤖" : stewardOn(base) && base.steward.areas.building !== false ? "🧭" : "🔧");
function autoRepair(state, base, fx) {
  if (!fx.broken || jobFor(base, fx)) return "";
  const rep = repairPlan(state, base, fx, "repair");
  const msg = rep.ok ? startRepair(state, base, fx, "repair") : repairPlan(state, base, fx, "rig").ok ? startRepair(state, base, fx, "rig") : "";
  if (msg) log(state, `${handIcon(state, base)} ${msg}`, "info");
  return msg;
}

// ---------- hourly: repair work (parties.js movePartiesHour hook) and attack damage ----------
export function breakdownsHour(state) {
  const h = hourOfDay(state);
  for (const base of state.bases) {
    attackWear(state, base);
    const list = jobs(base);
    const onWalls = underAttack(state, base); // on alert or under siege: nobody is free to repair
    for (const j of [...list]) {
      const fx = fixtureById(base, j.fx);
      if (!fx || (!fx.broken && (fx.wear || 0) < RAID_DAMAGE.damaged)) { // gone, or patched by upkeep first: the materials go back
        if (fx) for (const [k, v] of Object.entries(j.paid || {})) base.stock[k] = (base.stock[k] || 0) + v;
        list.splice(list.indexOf(j), 1);
        continue;
      }
      const s = j.who != null ? survivorById(state, j.who) : null;
      const here = s && s.alive && s.location.kind === "base" && s.location.baseId === base.id;
      if (!here) { j.who = null; }
      if (j.who == null && autoHands(state, base)) {
        const r = fxDef(fx)[j.method];
        const busy = new Set(list.map((x) => x.who));
        const pick = atBase(state, base.id).filter((o) => !o.inBed && workFactor(o) >= 0.35 && !busy.has(o.id) && skill(o, "mechanics") >= r.min).sort((a, b) => skill(b, "mechanics") - skill(a, "mechanics") || a.id - b.id)[0];
        if (pick) j.who = pick.id;
      }
      if (j.who == null || onWalls || h < WEAR.workFrom || h >= WEAR.workTo) continue;
      const w = survivorById(state, j.who);
      if (!w || w.inBed || workFactor(w) < 0.35) continue;
      j.done += Math.max(0.5, workFactor(w)) * buildMult(w);
      if (j.done >= j.hours - 1e-9) {
        list.splice(list.indexOf(j), 1);
        fixed(state, base, fx, j.method);
        gainXp(state, w, "mechanics", USE.repair * (j.method === "rig" ? 1 : 2));
        log(state, `🔧 ${w.name.split(" ")[0]} ${j.method === "rig" ? "jury-rigged" : "repaired"} the ${fixtureName(fx).toLowerCase()} at ${base.name}.${j.method === "rig" ? " It will not last." : ""}`, "good");
      }
    }
    // The autopilot and stewards start the repairs nobody has started.
    // Water first (thirst kills fastest): a broken well or pump is started before anything else, and while one is
    // still waiting for scrap or parts, nothing else takes them.
    if (autoHands(state, base) && h === WEAR.workFrom && !onWalls) {
      const broken = brokenAt(base).sort((a, b) => isWaterFixture(b) - isWaterFixture(a));
      let waterWaits = false;
      for (const fx of broken) {
        if (waterWaits && !isWaterFixture(fx)) break;
        autoRepair(state, base, fx);
        if (isWaterFixture(fx) && fx.broken && !jobFor(base, fx)) waterWaits = true;
      }
      if (waterWaits) continue;
      // Damaged defences (wear 60+) are patched before they give way, while the scrap lasts (20 kept back).
      for (const fx of fixtures(base).filter((x) => !x.broken && fxDef(x).outer && (x.wear || 0) >= RAID_DAMAGE.damaged && !jobFor(base, x))) {
        const plan = repairPlan(state, base, fx, "repair");
        if (plan.ok && (base.stock.scrap || 0) - (plan.cost.scrap || 0) >= 20) log(state, `${handIcon(state, base)} ${startRepair(state, base, fx, "repair")}`, "info");
      }
    }
  }
}
// Horde attacks (base.hordeHits, defences.js) wear the walls and gate. Raids do their own damage (raidDamage).
function attackWear(state, base) {
  const hits = base.hordeHits || 0;
  if (base.wearHits == null) base.wearHits = hits;
  const attacks = hits - base.wearHits;
  base.wearHits = hits;
  if (attacks <= 0) return;
  for (const fx of fixtures(base)) {
    const def = fxDef(fx);
    if (!def.attack || fx.broken) continue;
    const add = def.attack * attacks * (0.7 + 0.6 * hash01(state.seed, "atk", fxKey(base, fx), state.hour));
    fx.wear = Math.min(WEAR.breakAt, (fx.wear || 0) + add);
    if (fx.wear >= WEAR.breakAt) breakFixture(state, base, fx, "damaged in the attack");
  }
}

// ---------- daily wear (hubevents.js hubEventsDaily, at midnight: the day that ended) ----------
export function wearMult(state, base, fx) {
  const people = atBase(state, base.id);
  let m = 1;
  if (people.some((s) => hasPerk(s, "greasemonkey"))) m *= WEAR.greaseMonkey;
  else if (people.some((s) => hasPerk(s, "handy"))) m *= WEAR.handy;
  if (fx.rigged) m *= WEAR.rigMult;
  return m;
}
// Did this machine work today (its spares)? A station that ran, a powered building with power, the radio on the air,
// a well or the pump; anything else (walls, the storehouse roof: age and weather only) counts as not.
export function machineRan(state, base, fx) {
  const def = fxDef(fx);
  if (!def || fx.broken) return false;
  if (fx.type === "generator") return generatorRanToday(state, fx); // machines-2: no operator, it ran when it burned fuel
  if (BUILDINGS[fx.type] && BUILDINGS[fx.type].station) return !!stationStatus(state, base, fx).running;
  if (def.ranDay) return ranLately(state, fx); // wave 2 cooking: the grain mill, the meat grinder
  if (def.power) return isPowered(base, fx);
  return !!def.use;
}
// A hand-cranked machine (FIXTURES ranDay) turned today or yesterday (cooking.js sets b.ran at a batch; the wear runs at
// its own point of the day).
const ranLately = (state, fx) => fx.ran != null && day(state) - fx.ran <= 1;
export function dailyWear(state, base, fx, wx) {
  const def = fxDef(fx);
  const age = Math.max(0, day(state) - (fx.built || day(state)));
  let use = 0;
  if (fx.type === "generator") use = generatorRanToday(state, fx) ? def.use : def.idle || 0; // machines-2: by the days it ran
  else if (BUILDINGS[fx.type] && BUILDINGS[fx.type].station) {
    const st = stationStatus(state, base, fx);
    use = st.running ? def.use : def.idle || 0;
    if (st.running && st.op) use *= Math.max(0.65, 1.15 - 0.025 * skill(st.op, "mechanics"));
  } else if (def.ranDay) use = ranLately(state, fx) ? def.use : def.idle || 0; // wave 2 cooking: by the days the cooks turned it
  else if (def.power) use = isPowered(base, fx) ? def.use : def.idle || 0; // a freezer, a sealer: by the days it had power
  else use = def.use || 0;
  let w = (use + (def.age || 0)) * (1 + age / WEAR.ageDays);
  if (wx) {
    if (def.frost && wx.lo <= -3) w += def.frost;
    if (def.storm && ["storm", "blizzard"].includes(wx.key)) w += def.storm;
    if (def.rain && ["rain", "snow"].includes(wx.key)) w += def.rain;
  }
  if (fx.noSpares) w += WEAR.noSpares; // running on worn bits (useSpares)
  return w * wearMult(state, base, fx);
}
// Spares (see the header): a running machine uses a spare part every def.spares days it runs. Returns the base the
// part came from when one was used today, null otherwise.
export function useSpares(state, base, fx) {
  const def = fxDef(fx);
  if (!def || !def.spares || fx.broken) return null;
  if (machineRan(state, base, fx)) fx.spares = (fx.spares || 0) + 1 / def.spares;
  if ((fx.spares || 0) < 1 - 1e-9) { fx.noSpares = false; return null; }
  const h = state.bases.find((b) => b.type === "hub");
  const from = (base.stock.parts || 0) >= 1 ? base : h && (h.stock.parts || 0) >= 1 ? h : null;
  if (!from) {
    if (!fx.noSpares) log(state, `⚙ The ${fixtureName(fx).toLowerCase()} at ${base.name} needs a spare machine part: it wears faster until one is in stock.`, "danger");
    fx.noSpares = true;
    return null;
  }
  from.stock.parts -= 1;
  fx.spares -= 1;
  fx.noSpares = false;
  state.stats.partsUpkeep = (state.stats.partsUpkeep || 0) + 1;
  return from;
}
export function breakdownsDaily(state) {
  const d = day(state);
  const wx = d > 1 ? weatherOnDay(state, d - 1) : null;
  for (const base of state.bases) {
    const list = fixtures(base);
    // What the holdout started with is not new: the hub's pump 30–50 wear, the rest 5–25.
    for (const fx of list) if (fx.built == null) { fx.built = d; if (d <= 2 && !fxDef(fx).raidOnly) fx.wear = (fx.type === "pump" ? 30 : 5) + 20 * hash01(state.seed, "wear0", fxKey(base, fx)); }
    for (const fx of list) {
      if (fx.broken) continue;
      useSpares(state, base, fx); // machine parts for a machine that ran (freezer-parts)
      fx.wear = Math.min(WEAR.breakAt, (fx.wear || 0) + dailyWear(state, base, fx, wx));
    }
    for (const fx of list) {
      if (fx.broken) continue;
      const w = fx.wear || 0;
      const p = (w >= WEAR.breakAt ? 1 : w >= WEAR.riskFrom ? ((w - WEAR.riskFrom) / (WEAR.breakAt - WEAR.riskFrom)) ** 2 * WEAR.riskMax : 0) * cfgOf(state, "failures"); // worldcfg.js: the run's Failures dial (0: nothing fails, worn out or not)
      if (p > 0 && hash01(state.seed, "brk", fxKey(base, fx), d) < p) breakFixture(state, base, fx, w >= WEAR.breakAt ? "worn out" : "worn");
    }
    // Upkeep by builders with nothing to build, and by prisoners set to Clean and mend (prisoners-tab: prisoners.js
    // labour, at their share of a builder's upkeep, build queue or not).
    const cleaners = WEAR.upkeep * prisonLabour(state, base, "upkeep");
    // Builders kept on upkeep (s.upkeep) mend whether or not a building is queued; the rest only with nothing to build.
    const menders = atBase(state, base.id).filter((s) => s.role === "build" && !s.inBed && (onUpkeep(state, base, s) || !base.construction.length));
    if (menders.length || cleaners > 0) {
      const share = (s) => WEAR.upkeep * workFactor(s);
      // The hands kept on upkeep see to the wells and the pump first (thirst kills fastest), the rest goes to the most worn.
      const keep = menders.filter((s) => onUpkeep(state, base, s)).reduce((a, s) => a + share(s), 0);
      let pts = menders.filter((s) => !onUpkeep(state, base, s)).reduce((a, s) => a + share(s), 0) + cleaners;
      const mend = (fxs, budget) => {
        for (const fx of fxs.filter((f) => !f.broken).sort((a, b) => (b.wear || 0) - (a.wear || 0))) {
          if (budget <= 0) break;
          const cut = Math.min(budget, fx.wear || 0);
          fx.wear -= cut;
          budget -= cut;
        }
        return budget;
      };
      pts += mend(list.filter(isWaterFixture), keep);
      mend(list, pts);
    }
    // Parked vehicles in the frost; the garage keeps its cars out of it (vehicles.js frostWear).
    if (wx && wx.lo <= -3) { const inside = shelteredAt(state, base); for (const v of vehiclesAtBase(state, base.id)) v.condition = Math.max(1, v.condition - frostWear(state, base, v, wx.key === "blizzard" ? WEAR.vehicleBlizzard : WEAR.vehicleFrost, inside)); }
  }
}

// A machine (see the header): one that needs machine parts to repair or keeps spares.
export const isMachine = (type) => !!FIXTURES[type] && (!!FIXTURES[type].spares || !!FIXTURES[type].repair.cost.parts || !!FIXTURES[type].power);
// "repair: 3 scrap, 2 parts (Mechanics 3+) · a spare part every 12 days it runs" for cards and tooltips (no building: the type's).
export function machineText(type) {
  const d = FIXTURES[type]; // also "generator2" / "generator3" (genFixture)
  if (!d) return "";
  const bits = [`repair: ${costText(d.repair.cost)}${d.repair.min ? ` (Mechanics ${d.repair.min}+)` : ""}`];
  if (d.spares) bits.push(`a spare part every ${d.spares} days it runs`);
  if (d.raidOnly && !d.attack) bits.push("wears only from raid damage");
  else if (d.attack && d.raidOnly) bits.push("wears in every horde attack");
  else if (d.power) bits.push("wears on the days it has power");
  return bits.join(" · ");
}
// One building's wear, spares and last breakdown: "wear 34% · last breakdown day 81 · needs a spare part".
export function machineState(fx) {
  if (!fx || !fxDef(fx)) return "";
  const bits = [fx.broken ? `broken since day ${fx.broken.day}` : `wear ${Math.round(fx.wear || 0)}%${fx.rigged ? " (jury-rigged)" : ""}`];
  if (fx.lastBroke != null && !fx.broken) bits.push(`last breakdown day ${fx.lastBroke}`);
  if (fx.noSpares) bits.push("needs a spare part");
  return bits.join(" · ");
}
export const machinesHelp = () => `Machines are the buildings with a motor, a pump, a compressor or a press: the generator, the wells and the hub's pump, the ethanol still, the machine shop, the ammo and reloading benches, the radio station and relays, the floodlights, the garage, the walk-in freezer, the vacuum sealer, and a preserving room fitted with a pressure canner. They cost machine parts to build, a proper repair takes machine parts and a Mechanics hand, and they wear: a workshop station on the days it runs, the generator on the days it runs, a powered building on the days it has power, the radio every day on the air, floodlights in every horde attack, the garage with age. A running machine also uses up a spare part now and then (the generator and the radio every ${FIXTURES.generator.spares} days they run, the freezer every ${FIXTURES.freezer.spares}, the machine shop, the sealer and a kitchen's canner every ${FIXTURES.machine_shop.spares}, the still every ${FIXTURES.still.spares}), from its base's stock or else the hub's; with none, it runs on worn bits and wears ${WEAR.noSpares} more a day until a part comes in. Broken, a machine stops: a station does nothing, a generator gives no power, a powered building draws none. Walls, cellars, bunkhouses, the cold store (an ice house) and drying racks have no machine and never need parts.<br><br><b>The generator</b> needs no operator: it runs by itself while something draws power, burned by the hour from its own tank (a day and a half's running at full load); as built (a portable set, tier 1) ${POWER.genOut} power for ${POWER.genFuel} fuel a day of running from a tank of ${POWER.tank}. Every morning from ${String(REFUEL.from).padStart(2, "0")}:00 someone able at the base (not in a bed, not resting sick) refuels it: half an hour of the least busy hand's day, from the fuel above the reserve you set on the Power card (Workshops tab; at the reserve the tanks are not filled and the power goes off when they run dry). With nobody able at the base (everyone away, ill or in beds) it runs its tank dry: power for a day and a half at most. Breakdowns need a Mechanics 3+ hand and machine parts. It is loud: +${POWER.genHeat} Heat while it runs.<br><br><b>Generator tiers.</b> A generator is upgraded where it stands (Construction, On the utility plots: Upgrade; no new plot, one tier at a time, its power stays on until the work is done). ${GEN_TIERS.slice(1).map((t, i) => `<b>${i + 1}. ${t.name}</b>: ${t.out} power, ${t.idle === t.full ? `${t.full} fuel a day running (flat out, whatever it powers)` : `${t.idle} fuel a day idling up to ${t.full} at full load (it burns by the power drawn)`}, a tank of ${t.tank}, +${t.heat} Heat${t.cost ? `; the upgrade ${Object.entries(t.cost).map(([k, v]) => `${v} ${k === "parts" ? "machine parts" : k}`).join(", ")}, ${t.hours} work-hours, a Mechanics ${t.req.mechanics}+ survivor here${t.bp ? ", and the Industrial Power Manual studied" : ""}` : `; built for 20 scrap and 4 machine parts with the Generator Schematics studied`}; repairs ${genFixture(i + 1).repair.cost.scrap} scrap, ${genFixture(i + 1).repair.cost.parts} parts and Mechanics ${genFixture(i + 1).repair.min}+, a spare part every ${genFixture(i + 1).spares} days it runs.`).join(" ")} Each tier burns more fuel than the one below at any load, so upgrade only when the power is wanted: at full load the bigger sets give a little more power for their fuel. Two generators at most at a base, of any tiers: they add up, and the cheapest that covers the demand runs first. Demolishing one gives half of everything put into it back. The governor and a steward with Building on upgrade one when the base wants more power than its generators give and its fuel income can carry the bigger burn (never into a fuel deficit, the winter's heating counted). The other groups upgrade theirs by the same tiers, costs, Mechanics and manual.<br><br><b>The walk-in freezer</b> (a building plot: 30 scrap, 5 machine parts, 2 electronics, Mechanics 3; needs the Refrigeration Schematics studied) adds 300 food room and draws 2 power every day from a running generator. While it is on, the food in it keeps about twenty times longer than in a cellar. With no power (no generator, its tank dry, too little power, switched off on the Power card) or a breakdown it is off and warms up: the food in it keeps only as in a pantry, and the log and the Buildings tab say why. <b>The vacuum sealer</b> (a utility plot: 12 scrap, 2 parts, 2 electronics, Mechanics 3) draws 1 power while switched on; it will pack cooked food into light, long-keeping survival meals once the cooking recipes come. <b>The pressure canner</b> is fitted to a preserving room where it stands (Construction: 6 scrap, 2 machine parts, 12 work-hours, Mechanics 3): that kitchen jars 1 more preserved food a day, and wears like a machine. <b>Parts in crafting:</b> recipes with a mechanism take machine parts: the scrap crossbow, pipe gun, lights, suppressor, bicycle, ram, repair kit and pulley bow, a real fishing rod with a reel and a bear trap. The other groups build stills, generators, freezers and sealers too, make machine parts at their workshops, wear their machines out and buy parts from merchants to keep them going.`;

// For the UI and the alerts.
export function repairRows(state, base) {
  return fixtures(base).map((fx) => ({ fx, name: fixtureName(fx), def: fxDef(fx), job: jobFor(base, fx), wear: Math.round(fx.wear || 0) }));
}

// ---------- raid damage (see the header) ----------
const addCost = (into, cost) => { for (const [k, v] of Object.entries(cost)) into[k] = (into[k] || 0) + v; return into; };
// "2 wall sections and the ammo bench", and whether it takes a plural verb.
const NOUNS = { walls: ["a wall section", "wall sections"], barricades: ["a barricade", "barricades"], floodlights: ["the floodlights", "floodlights"], rain_catcher: ["a rain catcher", "rain catchers"], smoker: ["a drying rack", "drying racks"] };
function namesText(list, base = null) {
  const n = new Map();
  for (const fx of list) n.set(fx.type, (n.get(fx.type) || 0) + 1);
  const parts = [...n.entries()].map(([type, k]) => {
    const name = fixtureName({ type }).toLowerCase();
    const several = base && base.buildings.filter((b) => b.type === type).length + (list.some((fx) => fx.type === type && !base.buildings.includes(fx)) ? 1 : 0) > 1;
    const [one, many] = NOUNS[type] || [several ? `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}` : `the ${name}`, /(ch|sh|s)$/.test(name) ? `${name}es` : `${name}s`];
    return k > 1 ? `${k} ${many}` : one;
  });
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
  return { text, plural: list.length > 1 || (list[0] && list[0].type === "floodlights") };
}
// What the proper repair of these broken fixtures takes (the bill on the raid card): { cost, hours }.
export function repairBill(list) {
  const cost = {};
  let hours = 0;
  for (const fx of list) { addCost(cost, fxDef(fx).repair.cost); hours += fxDef(fx).repair.hours; }
  return { cost, hours };
}
// A raid on your base has been settled: smash what they reached. opts: strength (the raid's), hours (how long the
// siege lasted before it ended), outcome ("held" | "won" | "broken" | "overrun"), by (who, for the log).
// Returns the report (also kept as base.lastRaid for the Repairs tab): broken / damaged / scratched names, the one
// destroyed building, the repair bill and a sentence for the log and the result card.
export function raidDamage(state, base, { strength = 0, hours = 8, outcome = "held", by = "the raiders" } = {}) {
  const R = RAID_DAMAGE;
  const scale = Math.max(R.minHours, Math.min(R.maxHours, hours / 8));
  let budget = Math.round(Math.max(0, strength) * R.perStrength * scale * (R.outcome[outcome] ?? 1));
  const total = budget;
  const key = `${base.tile}:${state.hour}:${outcome}`;
  const hit = new Set();
  let last = null;
  for (let i = 0; budget > 0 && i < 40; i++) {
    const all = fixtures(base).filter((fx) => !fx.broken && (fx.wear || 0) < WEAR.breakAt);
    if (!all.length) break;
    const outer = all.filter((fx) => fxDef(fx).outer), inner = all.filter((fx) => !fxDef(fx).outer);
    const pool = outer.length && (!inner.length || hash01(state.seed, "rdo", key, i) < (R.outerShare[outcome] ?? 0.85)) ? outer : inner;
    const again = last && all.includes(last) && hash01(state.seed, "rdf", key, i) < R.focus;
    const fx = again ? last : pool[Math.min(pool.length - 1, Math.floor(hash01(state.seed, "rdp", key, i) * pool.length))];
    last = fx;
    const dmg = Math.min(budget, Math.round(R.hit[0] + (R.hit[1] - R.hit[0]) * hash01(state.seed, "rdh", key, i)));
    budget -= dmg;
    fx.wear = Math.min(WEAR.breakAt, (fx.wear || 0) + dmg);
    hit.add(fx);
  }
  const toBreak = [...hit].filter((fx) => fx.wear >= WEAR.breakAt);
  // Overrun: one building they wrecked is gone for good (never the walls or the hub's pump).
  let destroyed = null;
  const doomed = toBreak.filter((fx) => fx.type !== "walls" && fx.type !== "pump");
  if (outcome === "overrun" && doomed.length && hash01(state.seed, "rdx", key) < R.destroy) {
    destroyed = doomed[Math.floor(hash01(state.seed, "rdy", key) * doomed.length) % doomed.length];
    base.buildings.splice(base.buildings.indexOf(destroyed), 1);
    toBreak.splice(toBreak.indexOf(destroyed), 1);
    hit.delete(destroyed);
    if (destroyed.type === "watchtower") base.watchtower = count(base, "watchtower") > 0;
    if (destroyed.type === "radio") base.radio = false;
    assignStations(state, base);
  }
  const damaged = [...hit].filter((fx) => fx.wear >= R.damaged && fx.wear < WEAR.breakAt);
  const scratched = [...hit].filter((fx) => fx.wear < R.damaged);
  const bill = repairBill(toBreak);
  for (const fx of toBreak) breakFixture(state, base, fx, "damaged in a raid", { card: false, quiet: true });
  const bits = [];
  const wreckedN = namesText(toBreak, base), damagedN = namesText(damaged, base);
  if (toBreak.length) bits.push(`${wreckedN.text} ${wreckedN.plural ? "were" : "was"} wrecked (repair: ${costText(bill.cost)}, about ${bill.hours} work-hours)`);
  if (destroyed) { const d = namesText([destroyed], base); bits.push(`${d.text} ${d.plural ? "were" : "was"} torn down for good`); }
  if (damaged.length) bits.push(`${damagedN.text} ${damagedN.plural ? "are" : "is"} damaged and may give way`);
  const text = bits.length ? `Damage: ${bits.join("; ")}.` : scratched.length ? `Only scratches on ${namesText(scratched, base).text}.` : "No damage to the buildings.";
  const rep = {
    day: day(state), by, outcome, hours: Math.round(hours * 10) / 10, budget: total,
    broken: toBreak.map((fx) => fixtureName(fx)), damaged: damaged.map((fx) => fixtureName(fx)), scratched: scratched.map((fx) => fixtureName(fx)),
    destroyed: destroyed ? fixtureName(destroyed) : null, cost: bill.cost, workHours: bill.hours, text,
  };
  base.lastRaid = rep;
  const st = state.stats;
  st.raidBroken = (st.raidBroken || 0) + toBreak.length;
  st.raidDestroyed = (st.raidDestroyed || 0) + (destroyed ? 1 : 0);
  return rep;
}
// The card after a raid on your base (factions.js, visitors.js): what happened, what it cost, and the repairs. Where
// the autopilot or a steward keeps the base, the repairs are already under way and the card only reports.
export function raidReportCard(state, base, { title, text, dmg }) {
  const open = brokenAt(base).filter((fx) => !jobFor(base, fx));
  const bill = repairBill(open);
  const choices = open.length && !autoHands(state, base) ? [
    { label: `Start the repairs (${costText(bill.cost)})`, hint: `Every broken building at ${base.name} gets a repairer (a proper repair where it can be paid, else a jury-rig). About ${bill.hours} work-hours in all.`,
      resolve: (st) => (st.bases.includes(base) ? startAllRepairs(st, base) : "") },
    { label: "Later (the Repairs tab)", hint: "They stay broken until someone fixes them.", resolve: () => `The damage at ${base.name} waits in its Repairs tab.` },
  ] : [{ label: "OK", resolve: () => "" }];
  addCard(state, { title, text, raidReport: { baseId: base.id }, choices });
}

// Start every repair nobody has started at a base (the raid card's "Start the repairs", the Repairs tab): a proper
// repair where it can be paid and someone fit is free, else a jury-rig. Returns what was started, as one line.
export function startAllRepairs(state, base) {
  const out = [];
  for (const fx of brokenAt(base)) {
    if (jobFor(base, fx)) continue;
    const msg = repairPlan(state, base, fx, "repair").ok ? startRepair(state, base, fx, "repair") : repairPlan(state, base, fx, "rig").ok ? startRepair(state, base, fx, "rig") : "";
    if (msg) out.push(msg);
  }
  return out.length ? out.join(" ") : "Nothing could be started: no materials or nobody free with the skill (Repairs tab).";
}
