// Crews: a work role of kind "crew" (work.js) whose members form a team that runs trips from the hub by itself.
// While home they work the base by the role's priorities like anyone else; once a day (CREW_HOUR) a crew that is
// home, rested and fit picks the best field job by the role's field priorities (1 first, then the best score) within
// its limits, packs, and leaves. On the road it answers its own small cards the way the dev autopilot would
// (autopilot.js crewAI, in the role's style), searches sites hour by hour, chains one more site nearby when fit,
// fed and with room to carry, and comes home by the plan's "if … then come home" rules (plans.js). It stops and
// leaves you the big decisions (fights with people, hives, recruits, raids, jobs, anything it has no answer for)
// unless the role says "handle everything".
//
// role.crew = {
//   field: { type: 1..5 }        field priorities (FIELD_TYPES: scavenge, recover, vehicle, trade, supply …)
//   range (tiles), maxHours (one way), size, stance, vehicle ("auto" | "foot" | a vehicle id), ammo (a head),
//   meds, spare (rations × for the trip), rules: { hurt, food, cargo } (come home when …), rest (days at home
//   between trips), paused, handleAll, style (the governor's style for its judgement), retreat (its fights by the
//   numbers: breakoff.js RETREAT_POLICIES key; empty = by its style, STYLE_POLICY),
//   out: the trip under way { partyId, kind: "team" | "convoy", jobId, mission, tile, why, left, cargo }, log: the
//   last trips, lastTrip (day it came home) }
// Trips leave from the hub (launchExpedition); crew members at an outpost only work it.
// Adding a field job (hunting, fishing …) is one FIELD_TYPES entry: name, desc, and cands(ctx) → candidate trips
// { tile, mission, score, why, supplies? } (or launch(ctx, cand) for one that is not a team trip, as supply runs).
import { SUPPLIES } from "./data.js";
import { log, day, hub, hourOfDay, atBase, skill, combatPower, survivorById, archerCount, ARROWS } from "./world.js";
import {
  launchExpedition, estimateTrip, partyMembers, partyTile, tileLabel, startReturn, carried, partyCapacity, cargoLoad,
  carryCapacity, supplyLoad, unitsThatFit, addGearToCargo, pruneCards, STANCES, planPath,
} from "./parties.js";
import { startOrder } from "./orders.js";
import { nearbySites } from "./plans.js";
import { searchHour, extract } from "./scavenge.js";
import { vehiclesAtBase, vehicleById, refuel, wreckSupplies } from "./vehicles.js";
import { saveSupplyRun, dispatchSupplyRun, deleteSupplyRun, supplyRunById } from "./supply.js";
import { attitude, isAggressiveType } from "./factions.js";
import { weather, severeSoon, thirstAhead } from "./weather.js";
import { crewAI } from "./autopilot.js";
import { siteKnown } from "./discovery.js";
import { roleMembers, isManaged, threatInfo, healthRest } from "./work.js";
import { huntTargets, fishTargets, hunterMult, bestHuntWeapon, fisherMult, fishKit, packFishingGear, snareLine, HUNT, huntArrowsFor, huntMixOf } from "./hunting.js";
import { crewSurveyCands, surveySent } from "./survey.js";
import { woodNeed, woodAbundance, woodLevel, expectWood, chopCrew, chopPower, isChopTool, bestChop, woodcutterMult, WOOD } from "./woodcutting.js";
import { packTripKit } from "./kit.js";
import { stockHas, waterIn, RAW, keyWord } from "./water.js"; // water counts both kinds
import { totalRounds } from "./rounds.js"; // rounds by calibre ("ammo": every round there)

export const CREW_HOUR = 7;        // crews plan their trip at 07:00 (like the governor)
export const CREW_LOG = 8;         // trips kept in a crew's log
export const CHAIN_MAX = 1;        // more sites a team may search nearby on one trip
const first = (s) => s.name.split(" ")[0];
const names = (list) => list.map(first).join(", ");

// ---------- field jobs ----------
export const FIELD_TYPES = {
  scavenge: {
    name: "Scavenge sites", desc: "The best known sites within range for what the hub needs (the governor's site score: loot, danger, infection, hostile land).",
    cands(ctx) {
      const { state, base, crew, need, style } = ctx;
      const out = [];
      for (const id of state.grid.within(base.tile, crew.range)) {
        const t = state.tiles[id];
        if (!t.loc || id === base.tile || targeted(state, id) || !siteKnown(state, id)) continue;
        const s = crewAI.siteScore(state, id, need, style);
        if (!s || s.value <= 0.05) continue;
        out.push({ tile: id, mission: "scavenge", score: (s.value * 4) / (1 + state.grid.distance(id, base.tile) / 6), why: crewAI.needText(need, t), onSite: 8 });
      }
      return out.sort((a, b) => b.score - a.score).slice(0, 8);
    },
  },
  recover: {
    name: "Recover our dead", desc: "Death sites of your people with gear still there.",
    cands: (ctx) => markers(ctx, (m) => m.type === "death" && m.info && m.info.items > 0).map((m) => ({ tile: m.tile, mission: "recover", score: Math.min(2.5, 0.8 + m.info.items * 0.3), why: "recover our dead's gear" })),
  },
  vehicle: {
    name: "Vehicles and wrecks", desc: "A vehicle of yours left out there (bring fuel and a part), and wrecked cars to restore or strip.",
    cands: (ctx) => markers(ctx, (m) => (m.type === "vehicle" && !(m.info && m.info.emptied)) || (m.type === "car" && !(m.info && m.info.emptied))).map((m) => m.type === "vehicle"
      ? { tile: m.tile, mission: "getvehicle", score: 2.4, why: "bring our vehicle home", supplies: { fuel: 12, parts: m.info && m.info.condition < 15 ? 1 : 0 }, min: { fuel: Math.max(0, 2 - ((m.info && m.info.fuel) || 0)) } }
      : wreckSupplies(ctx.base.stock) // vehicles.js: the car parts (or machine parts) and fuel, when the base can pay them
        ? { tile: m.tile, mission: "investigate", score: 1.6, why: "a wrecked car to restore", supplies: wreckSupplies(ctx.base.stock) }
        : { tile: m.tile, mission: "investigate", score: 0.8, why: "a wrecked car to strip for parts" }),
  },
  trade: {
    name: "Trade visits", desc: "A friendly or neutral group within range, when the hub has goods to spare and a real need (at most one a week).",
    cands(ctx) {
      const { state, base, crew, need, style } = ctx;
      if (day(state) - (crew.lastTrade ?? -99) < 7) return [];
      const goods = crewAI.tradeGoods(state, need, style);
      if (!goods || !Object.values(need).some((v) => v >= 1.5)) return [];
      const f = state.factions.filter((x) => x.alive && x.known && x.bases.length && (attitude(x) === "Friendly" || attitude(x) === "Allied" || (attitude(x) === "Neutral" && !isAggressiveType(x))))
        .map((x) => ({ f: x, b: [...x.bases].sort((a, c) => state.grid.distance(a, base.tile) - state.grid.distance(c, base.tile))[0] }))
        .filter((x) => state.grid.distance(x.b, base.tile) <= crew.range).sort((a, b) => state.grid.distance(a.b, base.tile) - state.grid.distance(b.b, base.tile))[0];
      return f ? [{ tile: f.b, mission: "trade", score: 1.6, why: `trade with ${f.f.name}`, supplies: goods, onSite: 4 }] : [];
    },
  },
  supply: {
    name: "Supply runs to outposts", desc: "Water to an outpost running dry, food to a hungry one, scrap to one that has none (a one-off convoy, back the same way).",
    cands(ctx) {
      const { state, base, crew } = ctx;
      const out = [];
      for (const o of state.bases.filter((b) => b.type === "outpost" && state.grid.distance(b.tile, base.tile) <= crew.range)) {
        const staff = atBase(state, o.id).length;
        const deliver = [];
        if (staff && crewAI.outpostThirsty(state, o) && waterIn(base.stock) >= 30) deliver.push({ key: (base.stock.water || 0) >= 20 ? "water" : RAW, qty: 20 }); // purified when the hub has it
        if (staff && (o.stock.food || 0) < staff * 4 && (base.stock.food || 0) >= 40) deliver.push({ key: "food", qty: 12 });
        if ((o.stock.scrap || 0) < 10 && (base.stock.scrap || 0) >= 60) deliver.push({ key: "scrap", qty: 20 });
        if (deliver.length) out.push({ tile: o.tile, mission: "supply", outpost: o.id, deliver, score: 1 + deliver.length, why: `${deliver.map((l) => `${l.qty} ${l.key}`).join(", ")} for ${o.name}` });
      }
      return out;
    },
    launch(ctx, c) {
      const { state, base, team } = ctx;
      const res = saveSupplyRun(state, { jobId: null, originId: base.id, destId: c.outpost, vehicleId: null, pickup: [], schedule: "once", every: 5, stance: ctx.crew.stance, allowPartial: true, crew: team.map((s) => s.id), deliver: c.deliver, atDest: "return" });
      if (res.error) return null;
      res.job.crewMade = true;
      dispatchSupplyRun(state, res.job, false);
      if (!res.job.partyId) { deleteSupplyRun(state, res.job); return null; }
      const p = state.parties.find((x) => x.id === res.job.partyId);
      if (p) { p.crewRole = ctx.role.id; p.crewName = ctx.role.name; }
      return { partyId: res.job.partyId, kind: "convoy", jobId: res.job.id };
    },
  },
};
// Survey (survey.js): sweep the ground nobody has looked at near home, or a rumour's circle, for hidden places. The
// crew takes the hub's binoculars and scopes along (kit.js) and comes home after the hours set.
FIELD_TYPES.survey = {
  name: "Survey for hidden places", desc: "Sweep the land nobody has looked at within range (or a rumour's circle) for farms, cabins, lodges and camps off the roads, then come home. Takes binoculars along.",
  cands: (ctx) => crewSurveyCands(ctx.state, ctx.base, ctx.crew).filter((c) => !targeted(ctx.state, c.tile)),
  launch(ctx, c) {
    const kit = packTripKit(ctx.state, ctx.base, ctx.team, "sweep");
    const res = launchTeam(ctx, c);
    if (!res || res.error) return res;
    const p = ctx.state.parties.find((x) => x.id === res.partyId);
    if (p) p.sweepPlan = { ...c.sweep };
    surveySent(ctx.state);
    if (kit.length) log(ctx.state, `🚚 ${ctx.role.name} crew takes ${kit.join(", ")}.`, "info");
    return res;
  },
};
// Food from the land (hunting.js): a trip to hunt or fish N hours and come home. The crew picks its best hunters
// (fishers); the hub's rod or net goes along for fishing. Fresh game is heavy and spoils: a car brings it home sooner.
const huntFit = (s) => hunterMult(s) * (bestHuntWeapon(s) ? 3 : 0.3);
const fishFit = (s) => fisherMult(s);
const wantsFood = (need) => (need.food || 0) >= 0.6;
FIELD_TYPES.hunt = {
  name: "Hunt", desc: "Hunting trips (8 hours, snares checked or set when the crew has wire or scrap) to the best game land within range while the hub wants food. Needs a hunter with a rifle, shotgun or pistol (and ammo), or a bow or crossbow (the hub's arrows go along). The hours follow the hub's hunting mix (traps, bows, guns).",
  cands(ctx) {
    const { state, base, crew, need, role } = ctx;
    if (!wantsFood(need)) return [];
    const team = [...crewReady(state, role)].sort((a, b) => huntFit(b) - huntFit(a) || a.id - b.id).slice(0, Math.max(1, crew.size || 1));
    return huntTargets(state, base.tile, crew.range, team, { ammo: Math.max(0, totalRounds(base.stock) - 20), arrows: huntArrowsFor(state, base, team), mix: huntMixOf(base), hours: HUNT.defHours, limit: 4 })
      .filter((x) => !targeted(state, x.tile) && x.est.rations >= 6)
      .map((x) => ({ tile: x.tile, mission: "move", fit: huntFit, onSite: HUNT.defHours + 2, why: `hunt for food (~${Math.round(x.est.rations)} expected)`,
        steps: [...(x.snares || (base.stock.scrap || 0) >= 10 ? [{ kind: "snare" }] : []), { kind: "hunt", hours: HUNT.defHours }, { kind: "home" }],
        supplies: (base.stock.scrap || 0) >= 10 && !snareLine(state, x.tile) ? { scrap: 2 } : {},
        score: (need.food || 0) * Math.min(3, x.est.rations / 12) / (1 + x.dist / 6) }));
  },
};
FIELD_TYPES.fish = {
  name: "Fish", desc: "Fishing trips (8 hours) to the best river or lake shore within range while the hub wants food. Takes the hub's fishing rod or net.",
  cands(ctx) {
    const { state, base, crew, need, role } = ctx;
    if (!wantsFood(need)) return [];
    const team = [...crewReady(state, role)].sort((a, b) => fishFit(b) - fishFit(a) || a.id - b.id).slice(0, Math.max(1, crew.size || 1));
    return fishTargets(state, base.tile, crew.range, team, base.armory || [], { hours: HUNT.defHours, limit: 3 })
      .filter((x) => !targeted(state, x.tile))
      .map((x) => ({ tile: x.tile, mission: "move", fit: fishFit, onSite: HUNT.defHours, fishGear: true, why: `fish for food (~${Math.round(x.est.rations)} expected)`,
        steps: [{ kind: "fish", hours: HUNT.defHours }, { kind: "home" }],
        score: (need.food || 0) * Math.min(2.5, x.est.rations / 10) / (1 + x.dist / 6) }));
  },
};
// Firewood (woodcutting.js): a trip to cut wood 8 hours on the best wood land within range and come home, from late
// summer while the hub's woodpile is short of what the coming cold needs. The hub's axes go along.
const woodFit = (s) => woodcutterMult(s) * bestChop(s).mult;
FIELD_TYPES.wood = {
  name: "Cut wood", desc: "Woodcutting trips (8 hours) to the best wood land within range from late summer, while the hub's woodpile is short of what the coming cold needs. Takes the hub's axes along; a vehicle carries far more home.",
  cands(ctx) {
    const { state, base, crew, role } = ctx;
    const w = woodNeed(state, base);
    if (!w.short || !w.soon || w.need <= 0) return [];
    const team = [...crewReady(state, role)].sort((a, b) => woodFit(b) - woodFit(a) || a.id - b.id).slice(0, Math.max(1, crew.size || 1));
    if (!team.length) return [];
    const power = chopPower(chopCrew(team, (base.armory || []).filter(isChopTool)));
    const out = [];
    for (const id of state.grid.within(base.tile, crew.range)) {
      if (id === base.tile || targeted(state, id) || woodAbundance(state, id) * woodLevel(state, id) < 0.45) continue;
      const e = expectWood(state, team, id, WOOD.defHours, state.hour + 24, Infinity, power);
      if (e.all < 180) continue;
      const dist = state.grid.distance(base.tile, id);
      out.push({ tile: id, mission: "move", fit: woodFit, onSite: WOOD.defHours, chopGear: true, why: `cut firewood (~${Math.round(e.all)}; ${Math.floor(w.have)} of ${w.need} for the winter)`,
        steps: [{ kind: "wood", hours: WOOD.defHours }, { kind: "home" }],
        score: Math.min(2.5, e.all / 240) * (w.cold ? 1.4 : 1) / (1 + dist / 6) });
    }
    return out.sort((a, b) => b.score - a.score || a.tile - b.tile).slice(0, 3);
  },
};
export const FIELD_KEYS = Object.keys(FIELD_TYPES);

const targeted = (state, id) => state.parties.some((p) => p.owner === "player" && (p.dest === id || (p.ap && p.ap.tile === id)));
function markers(ctx, test) {
  const { state, base, crew } = ctx;
  return (state.markers || []).filter((m) => test(m) && state.grid.distance(m.tile, base.tile) <= crew.range && !targeted(state, m.tile));
}

// ---------- who goes ----------
// Fit for a trip: on priorities (not pinned), home at the hub, healthy enough for the role's hurt rule, not in bed,
// not on days off, in reasonable spirits.
export function crewReady(state, role) {
  const h = hub(state);
  if (!h) return [];
  const c = role.crew;
  const minHp = Math.max(60, ((c.rules && c.rules.hurt) || 0) + 15);
  return roleMembers(state, role).filter((s) => isManaged(state, s) && s.location.kind === "base" && s.location.baseId === h.id &&
    s.health >= minHp && !healthRest(s) && s.restUntil == null && s.mood >= 25);
}
const fitScore = (s, mission) => combatPower(s) + skill(s, "scavenging") * 0.25 + skill(s, "stealth") * 0.15 + skill(s, "scouting") * 0.15 + (mission === "trade" ? skill(s, "speech") * 0.5 : 0);

// Why the crew is not leaving today ("" = it may).
export function crewHold(state, role) {
  const c = role.crew;
  if (!c) return "not a crew";
  if (c.paused) return "paused";
  if (c.out) return "on a trip";
  const h = hub(state);
  if (!h) return "no hub";
  if (day(state) - (c.lastTrip ?? -99) < (c.rest ?? 1)) return `resting at home (${c.rest} day${c.rest === 1 ? "" : "s"} between trips)`;
  if (threatInfo(state, h).urgent) return `${threatInfo(state, h).urgent}: everyone stays`;
  if (weather(state).severe) return "a storm: no trips today";
  if (!crewReady(state, role).length) return roleMembers(state, role).length ? "nobody fit to go (health, mood, or away)" : "no members";
  return "";
}

// ---------- planning a trip ----------
// Returns a line for the log / UI (empty when nothing went).
export function planCrewTrip(state, role) {
  const c = role.crew;
  const hold = crewHold(state, role);
  if (hold) { c.status = hold; return ""; }
  const base = hub(state);
  const ready = crewReady(state, role);
  const style = c.style || "balanced";
  const need = crewAI.needs(state, style);
  const ctx = { state, base, role, crew: c, need, style };
  const cands = [];
  for (const key of FIELD_KEYS) {
    const p = (c.field && c.field[key]) || 0;
    if (!p) continue;
    for (const x of FIELD_TYPES[key].cands(ctx)) cands.push({ ...x, key, prio: p });
  }
  cands.sort((a, b) => a.prio - b.prio || b.score - a.score || a.tile - b.tile);
  if (!cands.length) { c.status = "nothing worth a trip within range"; return ""; }
  let why = "";
  for (const cand of cands.slice(0, 10)) {
    const fit = cand.fit || ((s) => fitScore(s, cand.mission));
    const team = [...ready].sort((a, b) => fit(b) - fit(a) || a.id - b.id).slice(0, Math.max(1, c.size || 1));
    const res = FIELD_TYPES[cand.key].launch ? FIELD_TYPES[cand.key].launch({ ...ctx, team }, cand) : launchTeam({ ...ctx, team }, cand);
    if (!res || res.error) { why = (res && res.error) || why; continue; }
    c.out = { ...res, mission: cand.mission, key: cand.key, tile: cand.tile, why: cand.why, left: state.hour, members: team.map((s) => s.id), cargo: {}, gear: 0, searched: 0 };
    if (cand.key === "trade") c.lastTrade = day(state);
    c.status = "";
    const line = `🚚 ${role.name} crew (${names(team)}) set out for ${tileLabel(state, cand.tile)}: ${cand.why}.`;
    log(state, line, "info");
    return line;
  }
  c.status = why ? `could not leave: ${why}` : "nothing within its limits";
  return "";
}

// Packs and sends a team (parties.js launchExpedition) within the role's limits.
function launchTeam(ctx, c) {
  const { state, base, team, crew } = ctx;
  const ids = team.map((s) => s.id);
  const n = ids.length;
  const stance = STANCES[crew.stance] ? crew.stance : "normal";
  const dist = state.grid.distance(base.tile, c.tile);
  if (dist > crew.range) return { error: "out of range" };
  // A vehicle: the one picked, or (auto) the hub's best for trips of 3+ tiles that it can make there and back.
  let v = null;
  if (crew.vehicle !== "foot") {
    const list = vehiclesAtBase(state, base.id).filter((x) => x.condition >= 30);
    const pick = crew.vehicle && crew.vehicle !== "auto" ? list.find((x) => String(x.id) === String(crew.vehicle)) : dist >= 3 ? [...list].sort((a, b) => b.condition - a.condition)[0] : null;
    if (pick) {
      const e = estimateTrip(state, { memberIds: ids, dest: c.tile, vehicle: true, stance });
      if (e && e.fuel <= pick.fuel + Math.max(0, (base.stock.fuel || 0) - 4)) v = pick;
    }
  }
  const est = estimateTrip(state, { memberIds: ids, dest: c.tile, vehicle: !!v, stance, fuel: v ? v.fuel + (base.stock.fuel || 0) : 0 });
  if (!est) return { error: "no route" };
  if (est.hoursOut > crew.maxHours) return { error: `more than ${crew.maxHours}h out` };
  if (est.hours > 24 && severeSoon(state, 2)) return { error: "a storm is coming" };
  const days = (est.hours + (c.onSite || 4)) / 24;
  const stock = (k) => Math.floor(stockHas(base.stock, k)); // water: both kinds (water.js)
  const homeLeft = Math.max(0, atBase(state, base.id).length - n);
  const sup = {
    food: Math.ceil(n * days * (crew.spare || 1.3)) + 1,
    water: Math.ceil(n * days * (crew.spare || 1.3) * thirstAhead(state, days)) + 1, // more in summer and a heat wave
    ammo: Math.min(Math.max(0, stock("ammo") - 20), (crew.ammo ?? 10) * n),
    meds: stock("meds") >= 4 ? Math.min(crew.meds ?? 2, stock("meds") - 2) : 0,
    fuel: 0,
  };
  const archers = archerCount(team); // the bows and crossbows shoot arrows: a dozen each (world.js ARROWS.PACK)
  if (archers) sup.arrows = archers * ARROWS.PACK;
  for (const [k, q] of Object.entries(c.supplies || {})) if (q > 0 && SUPPLIES[k]) sup[k] = (sup[k] || 0) + q;
  if (sup.food > stock("food") - homeLeft * 2 || sup.water > stock("water") - homeLeft * 2) return { error: "the hub cannot spare the rations" };
  if (v) {
    refuel(state, base, v);
    sup.fuel = Math.max(sup.fuel || 0, Math.max(0, Math.min(stock("fuel"), Math.ceil(est.fuel * 1.25 - v.fuel))));
  }
  for (const k of Object.keys(sup)) sup[k] = Math.max(0, Math.min(sup[k], stock(k)));
  const cap = carryCapacity(state, team, v);
  if (supplyLoad(sup) > cap) sup.ammo = Math.min(sup.ammo, 5 * n);
  for (const [k] of Object.entries(c.supplies || {})) {
    const over = supplyLoad(sup) - cap;
    if (over > 0 && sup[k]) sup[k] = Math.max((c.min && c.min[k]) || 0, sup[k] - Math.ceil(over / SUPPLIES[k].weight));
  }
  if (supplyLoad(sup) > cap) return { error: "too much to carry" };
  for (const [k, q] of Object.entries(c.min || {})) if ((sup[k] || 0) < q) return { error: `needs ${q} ${keyWord(k)}` };
  const r = crew.rules || {};
  const res = launchExpedition(state, {
    memberIds: ids, dest: c.tile, mission: c.mission, stance, vehicleId: v ? v.id : null, supplies: sup,
    plan: { preset: "custom", steps: c.steps || [], conditions: { hurt: r.hurt || null, food: r.food || null, cargo: !!r.cargo } },
  });
  if (res.error) return { error: res.error };
  const p = res.party;
  // Fishing: the hub's rod or net goes along when nobody carries one.
  if (c.fishGear && !fishKit(team, p.cargo.gear).power) packFishingGear(state, base, p);
  // Woodcutting: the hub's axes go along for those without one (woodcutting.js).
  if (c.chopGear) for (let i = team.filter((x) => !bestChop(x).item).length; i > 0; i--) { const j = (base.armory || []).findIndex(isChopTool); if (j < 0) break; p.cargo.gear.push(base.armory.splice(j, 1)[0]); }
  p.crewRole = ctx.role.id;
  p.crewName = ctx.role.name;
  p.crewChain = 0;
  return { partyId: p.id, kind: "team" };
}

// ---------- the team on the road ----------
const BIG = [/^The hive/, /^A hive/, /^Raiders heading/, /^A survivor alone/, /asks for help$/, /^Stranded traders/];
// A decision the crew leaves to you (unless the role handles everything).
export function bigDecision(card) {
  return !!(card.recruit || card.kind === "conflict" || card.jobId != null || card.moraleFor != null || BIG.some((re) => re.test(card.title || "")));
}

// The plan's own cards (plans.js): carry on home, search a rich site seen nearby if fit, come home when short.
function planCardChoice(state, role, p, card) {
  const find = (re) => card.choices.find((c) => re.test(c.label));
  if (card.title === "Coming home") return find(/^Continue home/);
  if (/^Supplies running low/.test(card.title)) return find(/^Come home/);
  if (/^Rich site/.test(card.title)) return (teamFit(state, role, p) ? find(/^Search it next/) : null) || find(/^Continue/);
  return find(/^Continue/) || find(/^Come home/);
}
// Healthy, fed and with room: fit to search one more place.
function teamFit(state, role, p) {
  const members = partyMembers(state, p);
  const r = role.crew.rules || {};
  if (!members.length || members.some((s) => s.health < Math.max(55, (r.hurt || 0) + 10) || s.woundInfected)) return false;
  if (partyCapacity(state, p) - cargoLoad(p.cargo) < partyCapacity(state, p) * 0.4) return false;
  const food = (carried(p, "food") + carried(p, "preserved")) / members.length;
  return food >= Math.max(2, (r.food || 0) + 1.5);
}

// A waiting team (its "Done" / orders card): one more site nearby when fit, else home.
function nextStep(state, role, p) {
  const c = role.crew;
  if (c.out && c.out.mission === "scavenge" && (p.crewChain || 0) < CHAIN_MAX && teamFit(state, role, p)) {
    const h = hub(state);
    const site = nearbySites(state, { center: partyTile(p), from: partyTile(p), radius: 3, p, exclude: p.plan ? p.plan.searched : [] })
      .find((s) => h && state.grid.distance(s.tile, h.tile) <= c.range && !targeted(state, s.tile) && (s.tile === partyTile(p) || planPath(state, partyTile(p), s.tile, p.vehicle)));
    if (site) {
      p.crewChain = (p.crewChain || 0) + 1;
      startOrder(state, p, { type: "nearby", radius: 3, count: 1, center: partyTile(p) });
      if (state.parties.includes(p) && p.phase !== "waiting") return `moves on to search ${site.name}`;
    }
  }
  const err = startReturn(state, p);
  return err || "heads home";
}

// One hour of a crew's own search (scavenge.js searchHour / extract on the team's own slot).
function searchStep(state, role, p) {
  const e = p.crewSearch;
  if (!e) return;
  if (p.phase !== "task" || !p.task || p.task.type !== "crewsearch") {
    // Turned home by a rule or a card mid-search: what was found and fits goes into the cargo.
    let room = partyCapacity(state, p) - cargoLoad(p.cargo);
    for (const g of e.found.gear) if (addGearToCargo(state, p, g)) room = partyCapacity(state, p) - cargoLoad(p.cargo);
    for (const [k, q] of Object.entries(e.found.supplies)) {
      const take = Math.min(unitsThatFit(room, k), q);
      p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take;
      room -= take * SUPPLIES[k].weight;
    }
    delete p.crewSearch;
    return;
  }
  const style = role.crew.style || "balanced";
  const saved = state.engagement;
  state.engagement = e;
  try {
    if (!e.approach) e.approach = crewAI.approach(state, p, e, style);
    searchHour(state);
    if (e.done || !state.parties.includes(p)) { delete p.crewSearch; return; }
    const hurt = (role.crew.rules && role.crew.rules.hurt) || 0;
    if (crewAI.extractNow(state, p, e, style) || partyMembers(state, p).some((s) => s.health < hurt)) {
      const tile = e.tile, hours = e.hours;
      extract(state); // loads the finds, logs, awaitOrders: the orders card is answered below
      delete p.crewSearch;
      if (role.crew.out) role.crew.out.searched = (role.crew.out.searched || 0) + 1;
      if (state.parties.includes(p)) log(state, `🚚 ${role.name} crew searched ${tileLabel(state, tile)} for ${hours}h.`, "info");
    }
  } finally {
    state.engagement = saved; // the shared slot is untouched (another team's search, or none)
  }
}

// Cards about the crew's team: answered here, or held for you (the game waits on them as on any card).
function answerCards(state, role, p) {
  const c = role.crew;
  for (let guard = 0; guard < 12; guard++) {
    const card = state.cards.find((x) => x.partyId === p.id && !x.crewHeld);
    if (!card) return;
    if (card.isOrders) {
      state.cards.splice(state.cards.indexOf(card), 1);
      const what = nextStep(state, role, p);
      if (what && state.parties.includes(p)) log(state, `🚚 ${role.name} crew ${what}.`, "info");
      continue;
    }
    if (bigDecision(card) && !c.handleAll) {
      card.crewHeld = true;
      log(state, `🚚 ${role.name} crew needs your call: ${card.title}.`, "danger");
      continue;
    }
    const choice = card.planCard ? planCardChoice(state, role, p, card) : crewAI.answer(state, card, c.style || "balanced");
    if (!choice) {
      card.crewHeld = true;
      log(state, `🚚 ${role.name} crew needs your call: ${card.title}.`, "danger");
      continue;
    }
    state.cards.splice(state.cards.indexOf(card), 1);
    const text = choice.resolve(state);
    pruneCards(state);
    if (choice.label !== "OK") log(state, `🚚 ${role.name} crew: ${card.title} → ${choice.label}.${text ? ` ${String(text).slice(0, 140)}` : ""}`, "info");
    if (!state.parties.includes(p)) return;
  }
}

// The trip is over (home, or the team is gone): the log entry and the rest before the next one.
function tripOver(state, role) {
  const c = role.crew;
  const o = c.out;
  const back = o.members.map((id) => survivorById(state, id)).filter((s) => s && s.alive && s.location.kind === "base");
  const lost = o.members.length - back.length - o.members.map((id) => survivorById(state, id)).filter((s) => s && s.alive && s.location.kind !== "base").length;
  const goods = Object.entries(o.cargo || {}).filter(([, q]) => q >= 1).map(([k, q]) => `${Math.floor(q)} ${keyWord(k)}`);
  if (o.gear) goods.push(`${o.gear} item${o.gear === 1 ? "" : "s"}`);
  const result = back.length ? `home from ${tileLabel(state, o.tile)}${goods.length ? ` with ${goods.join(", ")}` : " with nothing"}` : `lost at ${tileLabel(state, o.tile)}`;
  const entry = { day: day(state), mission: o.mission, tile: o.tile, why: o.why, hours: state.hour - o.left, result: `${result}${lost > 0 ? ` (${lost} did not come back)` : ""}` };
  c.log = [entry, ...(c.log || [])].slice(0, CREW_LOG);
  c.lastTrip = day(state);
  c.out = null;
  if (o.jobId != null) { const job = supplyRunById(state, o.jobId); if (job) deleteSupplyRun(state, job); }
  log(state, `🚚 ${role.name} crew is ${entry.result}.`, back.length ? "good" : "death");
}

function follow(state, role) {
  const c = role.crew;
  if (!c || !c.out) return;
  const p = state.parties.find((x) => x.id === c.out.partyId);
  if (!p) { tripOver(state, role); return; }
  if (p.kind === "convoy") { // supply.js runs the convoy; its road cards are answered like a team's
    answerCards(state, role, p);
    if (state.parties.includes(p)) c.out.cargo = { ...p.cargo.supplies };
    return;
  }
  searchStep(state, role, p);
  if (!state.parties.includes(p)) { tripOver(state, role); return; }
  if (state.trade && state.trade.partyId === p.id && !state.combat) {
    crewAI.trade(state, c.style || "balanced");
    log(state, `🚚 ${role.name} crew traded at ${tileLabel(state, partyTile(p))}.`, "info");
  }
  answerCards(state, role, p);
  if (!state.parties.includes(p)) { tripOver(state, role); return; }
  // A waiting team with no card (held, or its card answered elsewhere): its next step.
  if (p.phase === "waiting" && !state.cards.some((x) => x.partyId === p.id) && !p.crewSearch) {
    const what = nextStep(state, role, p);
    if (what) log(state, `🚚 ${role.name} crew ${what}.`, "info");
  }
  if (state.parties.includes(p)) { c.out.cargo = { ...p.cargo.supplies }; c.out.gear = p.cargo.gear.length; c.out.phase = p.phase; }
}

// ---------- hourly (world.js tickHour, after work.js) ----------
let busy = false;
export function crewHour(state, { plan = null } = {}) {
  if (!state.work || state.gameOver || busy) return;
  const roles = state.work.roles.filter((r) => r.kind === "crew" && r.crew);
  if (!roles.length) return;
  busy = true;
  try {
    // The dev autopilot runs every team (cards, trips); a crew's own search under way is finished here all the same,
    // and the trip is logged when it is over.
    if (state.autopilot) {
      for (const role of roles) {
        if (!role.crew.out) continue;
        const p = state.parties.find((x) => x.id === role.crew.out.partyId);
        if (!p) tripOver(state, role);
        else if (p.crewSearch) searchStep(state, role, p);
      }
      return;
    }
    for (const role of roles) if (state.work.roles.includes(role)) follow(state, role);
    if (plan === false) return;
    if (plan || hourOfDay(state) === CREW_HOUR) for (const role of roles) if (state.work.roles.includes(role)) planCrewTrip(state, role);
  } finally {
    busy = false;
  }
}

// For the UI: one line on where the crew is and what it does.
export function crewStatus(state, role) {
  const c = role.crew;
  if (!c) return "";
  if (c.out) {
    const p = state.parties.find((x) => x.id === c.out.partyId);
    if (!p) return "coming home";
    const where = tileLabel(state, partyTile(p));
    const what = p.crewSearch ? `searching ${where} (${p.crewSearch.hours}h, Heat ${Math.round(p.crewSearch.heat)})` : p.phase === "back" ? `on the way home (at ${where})` : p.phase === "out" ? `on the way to ${tileLabel(state, c.out.tile)}` : `${p.phase} at ${where}`;
    const held = state.cards.some((x) => x.partyId === p.id && x.crewHeld);
    return `${what}: ${c.out.why}${held ? " · waiting for your call" : ""}`;
  }
  const hold = crewHold(state, role);
  return hold ? `home: ${hold}` : c.status ? `home: ${c.status}` : `home: ready (plans at ${String(CREW_HOUR).padStart(2, "0")}:00)`;
}
