// Trip plans (the planner's PLAN section) and the radio rule for field teams.
//
// A plan is the team's order queue built before it leaves: the trip to the target with its mission, then steps
// such as "look around", "scavenge here", "scavenge the best sites nearby", "rest N days", "gather", "wait",
// "move to …" and "return home" (orders.js runs them one after the other). The planner shows the ETA and the
// rations for the whole plan (estimatePlan, the same hour-by-hour stepping as the real trip, winter's appetite
// included: ×1.1 / ×1.2 below 0 / −8°C, except by a lit camp fire).
//
// Radio rule: a team in radio coverage (stations and linked relays, radio.js) takes new orders at any time. Out of
// contact it keeps following its plan, and you can only give it orders through the cards it raises (arrival,
// "Done", interruptions, finds): answering one of its cards opens contact for that hour (commandable).
// A waiting team out of contact checks in again every 12 hours, and an open-ended camp every 24.
//
// To keep the player involved while a team is out of contact, the plan watches for things worth a decision and
// raises a card (once each per trip): a horde in sight, a rich site in sight that is not on the plan, supplies
// running short of the way home. The plan's "If … then come home" conditions turn the team home by themselves
// (anyone hurt below N health, food below N days, cargo full) and say so on a card that can undo it.
import { log, addCard, baseById, hub, snapshot, survivorById } from "./world.js";
import { LOCATIONS, siteDanger, SUPPLIES } from "./data.js";
import { siteKnownTo } from "./discovery.js";
import {
  partyMembers, partyTile, tileLabel, teamName, planPath, travelHours, partySpeed, startReturn, awaitOrders,
  ordersCard, partyCapacity, cargoRoom, carried, carriedAny, sightRadius, fuelForPath, STANCES, MISSIONS,
  plannedPace, partyPace, plannedVehicle, rationsPerHour, paceOpts, modeSpeed, waterForHours, foodForHours,
} from "./parties.js";
import { travelMode } from "./vehicles.js";
import { startOrder, FETCH_WATER_HOURS } from "./orders.js";
import { fieldHeatHour, fireLit } from "./fieldheat.js";
import { foodNeedFactor } from "./weather.js";
import { sweepEstimate, sweepOpts, SURVEY } from "./survey.js";
import { huntHours } from "./orders.js";
import {
  HUNT, MEAT_KG, huntTeam, expectHunt, fishKit, expectFish, snareLine, snareHours, expectSnare, packFishingGear, meatIn,
  huntMixOf, huntArrowsFor, packHuntArrows,
} from "./hunting.js";
import { teamLoad, burdenRecord, wornLoad } from "./load.js";
import { expectForage } from "./foraging.js";
import { expectWood, chopCrew, chopPower, fireLandOk, WOOD } from "./woodcutting.js";
import { partyFleet } from "./vehicles.js";
import { supplyLoad, poolLoad } from "./parties.js";
import { sumRecs } from "./rounds.js"; // rounds by calibre

export const SEARCH_HOURS = 6;      // time on site the estimates assume for a search (as estimateTrip does)
export const SURVEY_STEP_HOURS = 2; // Look around
export const GATHER_STEP_HOURS = 3;
export const CHECKIN_HOURS = 12;    // a waiting team out of contact reports in again after this
export const CAMP_CHECKIN = 24;     // an open-ended camp out of contact reports in once a day
export const RICH_LOOT = 0.55;      // a site this rich in sight and not on the plan raises a card
export const SEARCH_AREA_HOURS = 22; // the estimate for "Search the area": about 3 looks with short moves, then a search

// Step kinds the planner offers (kind → label, default fields).
export const STEP_KINDS = {
  sweep:    { label: "Survey the area", desc: "Sweep the land around where the team stands for hidden places and finds: it moves from spot to spot within the radius for the hours set and ends back where it started (survey.js). Food and water at the moving rate; Heat builds at half the rate of standing still." },
  survey:   { label: "Look around (2h)", desc: "Two hours surveying nearby tiles: better odds of spotting caches, wrecks and camps." },
  scavenge: { label: "Scavenge here", desc: "Search the site the team stands on (a raid on its own map)." },
  nearby:   { label: "Scavenge nearby sites", desc: "Search the best known sites within a few tiles, richest first (what the team sees on the way counts). Sites are picked when the step starts, so the plan adapts." },
  camp:     { label: "Rest", desc: "Rest on the spot (no camp is set up): the hurt heal slowly. Staying put builds Heat (a camp fire most), and Heat brings trouble." },
  gather:   { label: "Gather boat materials (3h)", desc: "Search the shore for scrap (only on a shore with a crossing)." },
  water:    { label: "Fetch water (2h)", desc: "Fill every free container from the river or lake (only on a tile next to water) and carry it home: un-purified water for a dry base in summer (the base's boiler or filters purify it; on the way a filter, a lit camp fire or purification tablets make it safe to drink)." },
  wait:     { label: "Wait", desc: "Hold on the spot for some hours (no fire: less Heat than a camp)." },
  move:     { label: "Move to a site", desc: "Travel on to another known site." },
  hunt:     { label: "Hunt", desc: "Hunt the land around the target for some hours (a rifle or a bow; firearms need ammo and their shots raise Heat and can draw the dead; bows need arrows, and the hub's go along). The hours follow the home base's hunting mix (traps, bows, guns: its Farming tab). Forest and hills are best, autumn the best season. Fresh game weighs twice what packed food does and spoils fast: the estimate counts the expected haul on the way home." },
  forage:   { label: "Forage", desc: "Gather wild food around the target for some hours (foraging.js): berries, nuts, mushrooms, greens, roots and apples. Anyone can; Farming and Scouting help. Forest is best, farmland good, towns little; summer and autumn plentiful, spring some, winter almost nothing. Quiet, but time on one spot builds Heat." },
  wood:     { label: "Cut wood", desc: "Cut firewood around the target for some hours (woodcutting.js): the winter's heating. Forest is best, hills fair, farmland and suburbs little, a city next to nothing. An axe (or a machete or sledgehammer) cuts much faster; daylight only. Firewood is heavy in bulk (0.1 kg a piece: three in a forest for 8 hours cut about 40 kg): a vehicle carries far more home. Loud: time on one spot builds Heat faster than most work." },
  fish:     { label: "Fish", desc: "Fish a river or lake shore for some hours with a fishing rod or net (the hub's goes along if nobody carries one). Quiet. Ice fishing in a freeze needs a crowbar, machete or axe and catches half." },
  snare:    { label: "Snares (2h)", desc: "Set a line of 8 snares (snare wire, or 2 scrap of fence wire), or check a line of yours already there (1h): collect the catch and leave it set. Quiet; a rabbit a day or so in good country; come back within 2–3 days." },
  searcharea: { label: "Search the area", desc: "Find a downed aircraft or supply drop in its search circle: look around at the spots that clear the most unsearched ground (2h each, up to 8), then search the wreck when it turns up (crashes.js)." },
  home:     { label: "Return home", desc: "Head back with everything carried. The plan ends there." },
};

// Presets: [mission at the target, steps after it].
export const PRESETS = {
  recon:    { name: "Recon and return", mission: "recon", steps: () => [{ kind: "home" }], desc: "Travel there, survey the area, come home." },
  scavenge: { name: "Scavenge and return", mission: "scavenge", steps: () => [{ kind: "home" }], desc: "Travel there, search the site, come home." },
  survey:   { name: "Survey trip", mission: "sweep", steps: () => [{ kind: "home" }], desc: "Go there, survey the area around it for the hours set (hidden farms, cabins, lodges, camps, caches), come home." },
  explore:  { name: "Explore", mission: "recon", steps: () => [{ kind: "nearby", radius: 3, count: 2 }, { kind: "home" }], desc: "Recon the target, then search the best sites within 3 tiles by loot (up to 2), then come home." },
  hunt:     { name: "Hunting trip", mission: "move", steps: (days, plan) => [{ kind: "hunt", hours: (plan && plan.add && plan.add.hunt) || HUNT.defHours }, { kind: "home" }], desc: "Go there, hunt for the hours set, come home with the game. Fresh game is heavy (a vehicle helps) and spoils fast: eat it, dry it or smoke it." },
  fish:     { name: "Fishing trip", mission: "move", steps: (days, plan) => [{ kind: "fish", hours: (plan && plan.add && plan.add.hunt) || HUNT.defHours }, { kind: "home" }], desc: "Go to a river or lake shore, fish for the hours set, come home. Needs a fishing rod or net (the hub's goes along)." },
  camp:     { name: "Rest N days, then return", mission: "move", steps: (days = 1) => [{ kind: "camp", hours: 24 * days }, { kind: "home" }], desc: "Go there, rest in the open for the days set (by a fire; no camp is set up), come home. Resting in one place builds Heat: fine in a quiet spot, asking for trouble near a city or a hive." }, // the id stays "camp" (saves, plans)
  custom:   { name: "Custom", mission: null, steps: () => [], desc: "Build the steps yourself." },
};

export const CONDITIONS = {
  hurt:   { label: "anyone is hurt below", unit: "health", def: 40, min: 10, max: 90, step: 5 },
  food:   { label: "food falls below", unit: "days", def: 1, min: 0.5, max: 10, step: 0.5 },
  cargo:  { label: "the cargo is full", unit: "", def: true },
};

// ---------- sites near a tile, best first ----------
// What the team (or the hub) knows of a site's loot: the team's own look, else the hub's map, else a guess from
// the site type. Danger and distance count against it.
export function knownLoot(state, id, p = null) {
  const t = state.tiles[id];
  const k = (p && p.seen && p.seen.get(id)) || state.knowledge[id];
  return k ? k.loot : t.loc ? (LOCATIONS[t.loc.type].richness || 0.5) * 0.9 : 0;
}

export function nearbySites(state, { center, from = center, radius = 3, p = null, exclude = [] }) {
  const out = [];
  for (const id of state.grid.within(center, radius)) {
    const t = state.tiles[id];
    if (!t.loc || t.terrain === "water" || t.hive || exclude.includes(id)) continue;
    if (!siteKnownTo(state, id, p)) continue; // a hidden site nobody has found yet (discovery.js)
    if (state.bases.some((b) => b.tile === id) || state.factions.some((f) => f.alive && f.bases.includes(id))) continue;
    const loot = knownLoot(state, id, p);
    if (loot < 0.2) continue;
    const dist = state.grid.distance(from, id);
    const score = (loot * (1 - 0.15 * siteDanger(t.loc))) / (1 + 0.25 * dist);
    out.push({ tile: id, loot, dist, score, name: t.loc.name });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- planner steps → orders ----------
// tile: where the plan leaves the team before these steps (the target). Jobs on the spot remember that tile
// (orders.js "at") until a "nearby" step makes the end tile unknown.
export function stepsToOrders(state, steps, tile) {
  const out = [];
  let at = tile, known = true;
  for (const s of steps || []) {
    const place = known ? { at } : {};
    switch (s.kind) {
      case "survey": out.push({ type: "mission", mission: "survey", ...place }); break;
      case "sweep": out.push({ type: "sweep", ...sweepOpts(s) }); break;
      case "scavenge": out.push({ type: "mission", mission: "scavenge", ...place }); break;
      case "nearby": out.push({ type: "nearby", radius: s.radius || 3, count: s.count || 1, center: at }); known = false; break;
      case "camp": out.push({ type: "camp", hours: Math.max(1, Math.round(s.hours || 24)), ...(s.fire != null ? { fire: !!s.fire } : {}) }); break; // fire: lit / kept out (orders.js)
      case "gather": out.push({ type: "gather", ...place }); break;
      case "water": out.push({ type: "water", ...place }); break;
      case "hunt": out.push({ type: "hunt", hours: huntHours(s), ...place }); break;
      case "fish": out.push({ type: "fish", hours: huntHours(s), ...place }); break;
      case "forage": out.push({ type: "forage", hours: huntHours(s), ...place }); break;
      case "wood": out.push({ type: "wood", hours: huntHours(s), ...place }); break;
      case "snare": out.push({ type: "snare", ...(s.mode ? { mode: s.mode } : {}), ...place }); break;
      case "wait": out.push({ type: "wait", hours: Math.max(1, Math.round(s.hours || 6)) }); break;
      case "move": if (s.tile != null) { out.push({ type: "move", tile: s.tile }); at = s.tile; known = true; } break;
      case "searcharea": out.push({ type: "searcharea", crash: s.crash ?? null, explore: s.explore !== false }); known = false; break;
      case "home": out.push({ type: "home" }); return out; // nothing runs after going home
    }
  }
  return out;
}

export const stepLabel = (state, s) => {
  switch (s.kind) {
    case "nearby": return `Scavenge up to ${s.count || 1} site${(s.count || 1) === 1 ? "" : "s"} within ${s.radius || 3} tiles, richest first`;
    case "camp": return `Rest ${s.hours % 24 === 0 ? `${s.hours / 24} day${s.hours === 24 ? "" : "s"}` : `${s.hours}h`}`;
    case "wait": return `Wait ${s.hours || 6}h`;
    case "sweep": { const o = sweepOpts(s); return `Survey ${o.radius} tiles around for ${o.hours}h`; }
    case "hunt": return `Hunt ${huntHours(s)}h`;
    case "fish": return `Fish ${huntHours(s)}h`;
    case "forage": return `Forage ${huntHours(s)}h`;
    case "wood": return `Cut wood ${huntHours(s)}h`;
    case "snare": return s.mode === "check" ? "Check the snares" : s.mode === "set" ? "Set snares" : "Snares: set (or check)";
    case "move": return `Move to ${tileLabel(state, s.tile)}`;
    default: return STEP_KINDS[s.kind]?.label || s.kind;
  }
};

// ---------- the estimate for a whole plan ----------
// Same stepping as the trip: the way out, the mission at the target (recon 0h with 2h debit like the real recon,
// a search 6h, a recovery or other mission 1h), each step in turn, and the way home if the plan has one.
// Returns null without a route to the target.
// from / startHour / p: estimate from where a team stands now (orders.js queueEstimate), with what it knows (its
// pace and rations from its last weighing, load.js); otherwise the pace comes from the crew and what it packs
// (supplies) with vehicle v (an object or id; `vehicle` true = a truck, "bike" = bikes).
// Food is counted hour by hour with the cold (the weather ahead is fixed, weather.js) and the camp fire (campWarm):
// food / water rounded up, foodExact / waterExact the figures before rounding.
export function estimatePlan(state, { memberIds, dest, vehicle, stance, fuel, mission, steps, homeBaseId, from = null, startHour = state.hour, p = null, supplies = {}, v = null, sweep = null }) {
  const home = baseById(state, homeBaseId || (hub(state) || {}).id);
  if (!home) return null; // no base left (conquest.js exiles)
  const members = (memberIds || []).map((id) => survivorById(state, id)).filter(Boolean);
  const pv = p ? null : plannedVehicle(state, vehicle, v, members.length || (memberIds || []).length);
  let pace = p ? partyPace(state, p) : plannedPace(state, { members, supplies, v: pv, stance });
  // Hunting and fishing (hunting.js): the expected haul of fresh game makes the team heavier for the rest of the plan,
  // as the real team is weighed again when it bags something (parties.js reweigh). It is heavier only if the game
  // outweighs what was eaten since it set off (eating does not lighten a team on the move).
  const home0 = baseById(state, homeBaseId || hub(state).id);
  const kitItems = p ? (p.cargo && p.cargo.gear) || [] : (home0 && home0.armory) || [];
  const ammo = p ? sumRecs(p.supplies, p.cargo && p.cargo.supplies) : supplies || {}; // rounds by key (a plan's generic "ammo" fits any gun): ammo.js
  // Arrows for the bows (hunting.js): what the team carries, or what it packs and takes from home for a hunt (applyPlan).
  const arrows0 = p ? Math.max(0, (p.supplies.arrows || 0) + ((p.cargo && p.cargo.supplies.arrows) || 0)) : supplies.arrows || 0;
  const arrows = p ? arrows0 : arrows0 + ((steps || []).some((s) => s.kind === "hunt") ? huntArrowsFor(state, home0, members, arrows0) : 0);
  const huntMix = huntMixOf(home0); // the home base's hunting mix
  const pv0 = p ? partyFleet(state, p) : pv; // every vehicle of the team's (vehicles.js fleets)
  const pool0 = p ? poolLoad(p) : supplyLoad(supplies);
  const worn = members.reduce((a, s) => a + wornLoad(s), 0);
  let haul = 0, haulKg = 0, woodHaul = 0; // woodHaul: firewood (woodcutting.js), not food
  const reweigh = (eaten) => {
    if (!members.length || haulKg <= 0) return;
    const cap = teamLoad(members, 0, pv0).capacity;
    const pool = Math.min(cap, Math.max(0, pool0 - eaten * (0.5 + 1)) + haulKg);
    if (pool <= pool0 + 0.5) return; // not heavier than when it set off: the pace holds
    if (p) {
      const b = burdenRecord(teamLoad(members, pool, pv0), members, pv0);
      pace = partyPace(state, { ...p, burden: b });
    } else pace = plannedPace(state, { members, supplies: {}, v: pv, stance, extraKg: pool });
  };
  const startMode = p ? (vehicle === true || vehicle === "bike" ? vehicle : vehicle ? p.vehicle || true : false) : travelMode(pv);
  const sp = pace.footSpeed; // on foot (a recon's two hours are paid at this pace)
  let veh = startMode, f = veh === true ? fuel ?? Infinity : 0, at = startHour, tile = from ?? home.tile, fuelUse = 0;
  let owed = 0; // hours of a recon still owed: paid by the next move, as in the real trip (parties.js survey)
  const n = Math.max(1, (memberIds || []).length);
  // Food and water hour by hour, as the team will eat and drink them: water at each day's thirst (weather.js: summer,
  // a heat wave), food at each day's cold (×1.1 below 0°C, ×1.2 below −8°C, needs.js teamCold) except by a lit camp
  // fire (campWarm). Rations: more on the move under a load (load.js), at rest one a day.
  let drink = 0, eat = 0;
  // fsegs: the same hours at the food rates (each one's appetite, a Glutton: traits.js); water at the plain rations.
  const eatDrink = (from, segs, fsegs = segs) => { drink += waterForHours(state, from, segs); eat += foodForHours(state, from, fsegs); };
  const drinkMove = (from, t) => eatDrink(from, members.length ? [[t.rideHours, pace.eatMove], [t.hours - t.rideHours, pace.eatFoot]] : [[t.hours, n]], members.length ? [[t.rideHours, pace.foodMove], [t.hours - t.rideHours, pace.foodFoot]] : [[t.hours, n]]);
  // Hours of a stay spent by a lit fire (needs.js teamCold, fieldheat.js teamFire): at a camp or shelter of yours any job
  // on the spot sits by its fire; a rest step by the team's own, lit unless the team keeps it out (p.campFire, or the step's
  // fire), and on bare ground only while the firewood it carries lasts (woodcutting.js campFireHour: it pays an hour's
  // after each hour, so the fire is there for one hour more than it can pay; out, it stays out).
  const campOn = (t) => state.bases.find((b) => b.tier === 0 && b.tile === t) || null; // a camp or shelter of yours: its fire (fieldheat.js teamFire)
  let woodBurnt = 0; // firewood the camp fires burn on bare ground
  let lit = p ? fireLit(p) : true; // the team's fire habit; a camp step's own fire setting carries on (orders.js)
  const campWarm = (kind, s, hours) => {
    const camp0 = campOn(tile);
    if (camp0 && kind !== "scavenge") return fireLit(camp0) ? hours : 0;
    if (kind !== "camp") return 0;
    if (s && s.fire != null) lit = !!s.fire;
    if (!lit) return 0;
    if (fireLandOk(state, tile)) return hours;
    const per = WOOD.fire.camp / 24;
    const wood = Math.max(0, (p ? carried(p, "wood") : supplies.wood || 0) + woodHaul - woodBurnt);
    const paid = Math.min(hours, Math.floor(wood / per + 1e-9));
    woodBurnt += paid * per;
    if (paid < hours) lit = false;
    return Math.min(hours, paid + 1);
  };
  const legs = [];
  const travel = (to, label) => {
    if (to === tile) return true;
    let res = planPath(state, tile, to, veh);
    if (!res && veh) { res = planPath(state, tile, to, false); if (res) { veh = false; f = 0; } }
    if (!res) return false;
    if (veh === true) fuelUse += fuelForPath(state, res.path, pace.fuelMult);
    const t = travelHours(state, res.path, { vehicle: veh, speed: veh ? pace.rideSpeed ?? pace.speed : pace.footSpeed, footSpeed: pace.footSpeed, fuelMult: pace.fuelMult, fuel: f, startHour: at, progress: owed });
    veh = t.vehicle; f = t.fuelLeft; owed = 0;
    drinkMove(at, t);
    legs.push({ label, hours: t.hours, from: tile, to, path: res.path, start: at, left: t.progress });
    at += t.hours; tile = to;
    return true;
  };
  const stay = (label, hours, kind = null, s = null) => {
    const warm = campWarm(kind, s, hours);
    legs.push({ label, hours, from: tile, to: tile, start: at, ...(warm ? { warm } : {}) });
    const rest = members.length ? pace.foodRest : n;
    eatDrink(at, [[warm, n, true], [hours - warm, n]], [[warm, rest, true], [hours - warm, rest]]);
    at += hours;
  };
  // A survey (survey.js): its route is fixed when it starts, so its hours and fuel are known; it eats at the moving rate.
  const surveyLeg = (o) => {
    const sw = sweepEstimate(state, { ...sweepOpts(o || {}), center: tile, mode: veh, stance: p ? p.stance : stance, fuelMult: pace.fuelMult });
    legs.push({ label: `Survey ${sw.radius} tiles around ${tileLabel(state, tile)} (${sw.hours}h)`, hours: sw.hours, from: tile, to: tile, start: at, sweep: true, route: sw.route });
    eatDrink(at, [[sw.hours, members.length ? (veh ? pace.eatMove : pace.eatFoot) : n]], [[sw.hours, members.length ? (veh ? pace.foodMove : pace.foodFoot) : n]]);
    at += sw.hours;
    if (veh === true) { fuelUse += sw.fuel; f = Math.max(0, f - sw.fuel); }
  };
  if (!travel(dest, `To ${tileLabel(state, dest)}`)) return null;
  const outPath = legs[0] ? legs[0].path : [tile], hoursOut = legs[0] ? legs[0].hours : 0;
  // On site: a search 6h, a recovery or other mission 1h; a recon's 2 hours are paid by the next move.
  const onSite = mission === "scavenge" ? SEARCH_HOURS : mission === "recon" || mission === "move" || mission === "outpost" || mission === "sweep" ? 0 : mission === "occupy" ? 2 : 1;
  if (onSite) stay(`${MISSIONS[mission]?.name || mission} at ${tileLabel(state, dest)}`, onSite, mission === "scavenge" ? "scavenge" : null);
  if (mission === "sweep") surveyLeg(sweep || (p && p.sweepPlan) || {});
  if (mission === "recon") { owed = Math.min(0, (legs[0] ? legs[0].left : 0) - 2 * (veh ? pace.rideSpeed ?? pace.speed : sp)); legs.push({ label: `Recon at ${tileLabel(state, dest)} (2h, on the next move)`, hours: 0, from: tile, to: tile, start: at }); }
  let returns = false, open = false;
  const chosen = [];
  for (const s of steps || []) {
    if (s.kind === "survey") stay("Look around", SURVEY_STEP_HOURS);
    else if (s.kind === "sweep") surveyLeg(s);
    else if (s.kind === "scavenge") stay(`Scavenge ${tileLabel(state, tile)}`, SEARCH_HOURS, "scavenge");
    else if (s.kind === "gather") stay("Gather materials", GATHER_STEP_HOURS);
    else if (s.kind === "water") stay("Fetch water", FETCH_WATER_HOURS);
    else if (s.kind === "camp") stay(stepLabel(state, s), s.hours || 24, "camp", s);
    else if (s.kind === "wait") stay(stepLabel(state, s), s.hours || 6);
    else if (s.kind === "searcharea") stay("Search the area (estimate: about 3 looks, then the wreck)", SEARCH_AREA_HOURS);
    else if (s.kind === "wood") {
      // Firewood (woodcutting.js): what fits on top of the load so far; it weighs the team down on the way home.
      const start = at;
      const hours = huntHours(s);
      stay(stepLabel(state, s), hours);
      const eatenNow = members.length ? eat : 0;
      const room = members.length ? Math.max(0, teamLoad(members, 0, pv0).capacity - Math.max(0, pool0 - eatenNow * 1.5) - haulKg) : Infinity;
      const got = members.length ? expectWood(state, members, tile, hours, start, room, chopPower(chopCrew(members, kitItems))).wood : 0;
      if (got > 0) {
        woodHaul += got;
        haulKg += got * SUPPLIES.wood.weight;
        legs[legs.length - 1].wood = Math.round(got * 10) / 10;
        reweigh(eatenNow);
      }
    }
    else if (s.kind === "hunt" || s.kind === "fish" || s.kind === "snare" || s.kind === "forage") {
      const start = at;
      const hours = s.kind === "snare" ? snareHours(state, tile, s.mode) : huntHours(s);
      stay(stepLabel(state, s), hours);
      let got = 0;
      // What still fits: the team's capacity less what it set off with, less what it has eaten, less the game so far.
      const eatenNow = members.length ? eat : 0;
      const room = members.length ? Math.max(0, teamLoad(members, 0, pv0).capacity - Math.max(0, pool0 - eatenNow * 1.5) - haulKg) : Infinity;
      if (s.kind === "hunt") {
        const t = huntTeam(state, members, ammo, { arrows, mix: huntMix });
        if (!t.why) got = expectHunt(state, t.team, tile, hours, start, t.loud, room).rations;
      } else if (s.kind === "fish") got = expectFish(state, fishKit(members, kitItems), tile, hours, start, room).rations;
      else if (s.kind === "forage") got = members.length ? expectForage(state, members, tile, hours, start, room).rations : 0;
      else if (snareLine(state, tile) && s.mode !== "set") { const l = snareLine(state, tile); got = expectSnare(state, tile, l.check ?? l.set, start + hours).rations * 0.8; }
      if (got > 0) {
        haul += got;
        haulKg += got * (s.kind === "forage" ? 0.5 : MEAT_KG); // foraged food weighs as packed food (foraging.js)
        legs[legs.length - 1].haul = Math.round(got * 10) / 10;
        reweigh(eatenNow);
      }
    }
    else if (s.kind === "move" && s.tile != null) { if (!travel(s.tile, `To ${tileLabel(state, s.tile)}`)) { open = true; break; } }
    else if (s.kind === "nearby") {
      const center = s.center ?? tile;
      for (let i = 0; i < (s.count || 1); i++) {
        const site = nearbySites(state, { center, from: tile, radius: s.radius || 3, p, exclude: [...chosen, ...(mission === "scavenge" ? [dest] : []), ...(p && p.plan ? p.plan.searched : [])] })
          .find((x) => x.tile === tile || planPath(state, tile, x.tile, veh));
        if (!site) break;
        chosen.push(site.tile);
        if (site.tile !== tile && !travel(site.tile, `To ${site.name}`)) break;
        stay(`Scavenge ${site.name}`, SEARCH_HOURS, "scavenge");
      }
    } else if (s.kind === "home") { returns = travel(home.tile, `Home to ${home.name}`); if (!returns) open = true; break; }
  }
  const hours = at - startHour;
  // Without a way home in the plan the rations cover the plan and the way back from where it ends (so the team
  // is not stranded when you order it home), shown separately.
  let backHours = 0;
  if (!returns && tile !== home.tile) {
    const res = planPath(state, tile, home.tile, veh) || planPath(state, tile, home.tile, false);
    const bm = veh && planPath(state, tile, home.tile, veh) ? veh : false;
    const t = res ? travelHours(state, res.path, { vehicle: bm, speed: bm ? pace.rideSpeed ?? pace.speed : pace.footSpeed, footSpeed: pace.footSpeed, fuelMult: pace.fuelMult, fuel: f, startHour: at }) : null;
    backHours = t ? t.hours : 0;
    if (t) drinkMove(at, t);
  }
  const total = hours + backHours;
  return {
    legs, hours, hoursOut, backHours, total, returns, open, sites: chosen, endTile: tile, path: outPath, vehicle: veh, fuelLeft: f,
    haul: Math.round(haul * 10) / 10, haulKg: Math.round(haulKg * 10) / 10, wood: Math.round(woodHaul * 10) / 10,
    food: Math.ceil(eat - 1e-9), foodExact: eat, water: Math.ceil(drink - 1e-9), waterExact: drink, pace,
    fuel: startMode === true ? Math.ceil(fuelUse * (returns ? 1 : 2) - 1e-9) : 0, days: total / 24,
  };
}

// ---------- launching with a plan (parties.js launchExpedition) ----------
export function applyPlan(state, p, plan) {
  if (!plan) return;
  const steps = (plan.steps || []).filter((s) => STEP_KINDS[s.kind]);
  p.orders = stepsToOrders(state, steps, p.dest);
  // A hunting or fishing trip is named for it (teamName).
  if (p.mission === "move" && steps.some((s) => s.kind === "hunt")) p.teamMission = "hunt";
  else if (p.mission === "move" && steps.some((s) => s.kind === "fish")) p.teamMission = "fish";
  else if (p.mission === "move" && steps.some((s) => s.kind === "wood")) p.teamMission = "wood"; // woodcutting.js
  // Fishing and snares: the hub's rod or net and its snare wire go along when nobody carries one (hunting.js).
  const home = baseById(state, p.homeBaseId) || hub(state);
  const members = partyMembers(state, p);
  if (home && steps.some((s) => s.kind === "fish") && !fishKit(members, p.cargo.gear).power) packFishingGear(state, home, p);
  if (home && steps.some((s) => s.kind === "hunt")) packHuntArrows(state, home, p); // the bows' arrows (hunting.js)
  if (home && steps.some((s) => s.kind === "snare")) {
    const has = members.some((m) => [...(m.pockets || []), ...(((m.gear || {}).backpack || {}).contents || [])].some((it) => it && it.key === "snarewire")) || p.cargo.gear.some((it) => it.key === "snarewire");
    const i = (home.armory || []).findIndex((it) => it && it.key === "snarewire");
    if (!has && i >= 0) p.cargo.gear.push(home.armory.splice(i, 1)[0]);
  }
  const cond = plan.conditions || {};
  p.plan = {
    preset: plan.preset || "custom", name: PRESETS[plan.preset]?.name || "Custom plan", steps: steps.map((s) => ({ ...s })),
    conditions: { hurt: cond.hurt ?? null, food: cond.food ?? null, cargo: !!cond.cargo },
    active: true, fired: {}, hordes: [], sites: [], searched: p.mission === "scavenge" ? [p.dest] : [], started: state.hour,
  };
  const est = estimatePlan(state, { memberIds: p.members, dest: p.dest, vehicle: p.vehicle, stance: p.stance, fuel: p.planFuel, mission: p.mission, steps, homeBaseId: p.homeBaseId, p, sweep: p.sweepPlan });
  if (est) {
    p.plannedHours = est.total;
    // The hub's estimated position ("?" sprite, parties.js plannedTile): out, the plan's time away from the
    // road home, then the way back (drawn along the way out).
    const homeLeg = est.returns ? est.legs[est.legs.length - 1] : null;
    p.etaBack = homeLeg ? homeLeg.hours : null;
    p.planStay = homeLeg ? Math.max(0, est.hours - est.hoursOut - homeLeg.hours) : null;
  }
}

// ---------- the "nearby" and "wait" orders (orders.js startOrder) ----------
// Picks the best site now (what the team saw on the way counts), queues the search and the rest of the step, and
// sets off. Nothing worth it left: the step is skipped and the plan goes on.
export function startNearby(state, p, o) {
  const here = partyTile(p);
  const exclude = [...(p.plan?.searched || []), ...(p.orders || []).filter((x) => x.at != null).map((x) => x.at)];
  const site = nearbySites(state, { center: o.center ?? here, from: here, radius: o.radius || 3, p, exclude })
    .find((s) => s.tile === here || planPath(state, here, s.tile, p.vehicle));
  if (!site) {
    const msg = `No site worth searching within ${o.radius || 3} tiles: step skipped.`;
    if (p.phase === "waiting" || p.phase === "task") awaitOrders(state, p, msg);
    return msg;
  }
  if (p.plan) p.plan.searched.push(site.tile);
  p.orders = p.orders || [];
  const rest = (o.count || 1) > 1 ? [{ ...o, count: o.count - 1 }] : [];
  p.orders.unshift({ type: "mission", mission: "scavenge", at: site.tile }, ...rest);
  log(state, `${teamName(state, p)}: next, ${site.name} (${site.dist} tile${site.dist === 1 ? "" : "s"}, loot ~${Math.round(site.loot * 100)}%).`, "info");
  if (site.tile === here) return startOrder(state, p, p.orders.shift());
  return startOrder(state, p, { type: "move", tile: site.tile });
}

// ---------- the radio rule ----------
export function commandable(state, p) {
  if (!p || p.owner !== "player" || p.kind === "convoy") return false;
  if (p.radioLive) return true;
  if (p.contactHour === state.hour) return true; // you just answered one of its cards
  if (state.cards.some((c) => c.partyId === p.id && (c.isOrders || c.planCard))) return true; // it is waiting for your answer
  return state.bases.some((b) => b.tile === partyTile(p));
}
export const NO_RADIO = "No radio contact: the team follows its plan. New orders only through the cards it raises, or once it is in radio range (a station or a linked relay).";
// A team carrying a receiver out of two-way reach, inside some radio network (parties.js updateRadio p.radioHear):
// it listens, that is all (radiolisten.js: Listen in tunes it to one channel).
export const HAND_RADIO = "Hand-crank radio: hears the networks around it, cannot call in";
export const HAND_RADIO_TIP = "The team carries a receiver (a hand-crank radio, or a military radio): inside a radio network's coverage (yours, or a group's own around its bases) it hears that network, and nothing beyond every network. It cannot answer, so it is not in contact: no orders, nothing reported, until it is in radio range or raises a card. Listen in (1h, from the team panel while in contact) tunes it to one channel; then it picks up that channel's traffic each day while in range.";

// ---------- hourly (parties.js playerPartyHour) ----------
export function fieldHour(state, p) {
  if (p.owner !== "player" || p.kind === "convoy") return;
  fieldHeatHour(state, p, addCard);
  if (!state.parties.includes(p)) return;
  checkIn(state, p);
  if (p.plan && p.plan.active) planWatch(state, p);
}

// Out of contact a team cannot hear you: one that is waiting with no card (held) checks in again every 12 hours,
// an open-ended camp once a day.
function checkIn(state, p) {
  if (p.radioLive || state.cards.some((c) => c.partyId === p.id)) { delete p.checkInAt; return; }
  const camp = p.phase === "task" && p.task && p.task.type === "camp" && p.task.hours == null;
  if (p.phase !== "waiting" && !camp) { delete p.checkInAt; return; }
  if (p.checkInAt == null) { p.checkInAt = state.hour + (camp ? CAMP_CHECKIN : CHECKIN_HOURS); return; }
  if (state.hour < p.checkInAt) return;
  delete p.checkInAt;
  const card = ordersCard(state, p, camp ? `Still resting after ${p.task.done} hours (Heat ${Math.round(p.heat || 0)}). "Hold here" keeps the team resting.` : "The team checks in again.", null, camp ? "Resting: checking in" : null);
  addCard(state, card);
}

// Days of food left at the rate the team eats on the move (more under a load, load.js), as the plan's "food falls
// below N days" rule counts it; in the cold, ×today's appetite (weather.js foodNeedFactor: no camp fire on the move).
const foodDays = (state, p) => {
  const m = partyMembers(state, p);
  const perDay = Math.max(1, partyPace(state, p).eatMove, m.length) * foodNeedFactor(state);
  return (carried(p, "food") + carried(p, "preserved")) / perDay;
};
function hoursHome(state, p) {
  const home = baseById(state, p.homeBaseId) || hub(state);
  if (!home) return null; // no base left (conquest.js exiles)
  const res = planPath(state, partyTile(p), home.tile, p.vehicle) || planPath(state, partyTile(p), home.tile, false);
  const mode = res && p.vehicle && planPath(state, partyTile(p), home.tile, p.vehicle) ? p.vehicle : false;
  return res ? travelHours(state, res.path, { vehicle: mode, ...paceOpts(p), speed: modeSpeed(p, mode) }).hours : null;
}

// The plan's conditions and the finds worth a card.
function planWatch(state, p) {
  const pl = p.plan;
  if (p.phase === "back") return;
  if (p.phase === "waiting" && !(p.orders || []).length) { pl.active = false; return; } // the plan has run out
  if (p.phase === "engaged" || state.cards.some((c) => c.partyId === p.id)) return;
  const members = partyMembers(state, p);
  const c = pl.conditions;
  // If … then come home.
  const why =
    c.hurt != null && !pl.fired.hurt && members.some((m) => m.health < c.hurt) ? ["hurt", `${members.filter((m) => m.health < c.hurt).map((m) => `${m.name.split(" ")[0]} (${Math.floor(m.health)})`).join(", ")} hurt below ${c.hurt}`] :
    c.food != null && !pl.fired.food && foodDays(state, p) < c.food ? ["food", `food down to ${foodDays(state, p).toFixed(1)} days`] :
    c.cargo && !pl.fired.cargo && cargoRoom(state, p) <= partyCapacity(state, p) * 0.05 ? ["cargo", "the cargo is full"] : null;
  if (why) return comeHome(state, p, why[0], why[1]);
  const tile = partyTile(p);
  const sight = sightRadius(state, p) + 1;
  // A horde in sight.
  const horde = state.hordes.find((h) => h.size >= 15 && !pl.hordes.includes(h.id) && state.grid.distance(h.tile, tile) <= sight);
  if (horde) {
    pl.hordes.push(horde.id);
    p.seen.set(horde.tile, snapshot(state, horde.tile)); // reported with the card
    return findCard(state, p, `Horde spotted`, `A horde of about ${horde.size} at ${tileLabel(state, horde.tile)}, ${state.grid.distance(horde.tile, tile)} tile${state.grid.distance(horde.tile, tile) === 1 ? "" : "s"} from the team.`);
  }
  // A rich site in sight that the plan does not cover and the hub does not know is rich (not news near home).
  const news = (id) => !(state.knowledge[id] && state.knowledge[id].loot >= RICH_LOOT) && !state.bases.some((b) => state.grid.distance(b.tile, id) <= 3);
  const planned = new Set([...(p.orders || []).map((o) => o.at ?? o.tile), ...pl.searched, ...pl.sites, p.dest]);
  const rich = state.grid.within(tile, sight).map((id) => state.tiles[id])
    .find((t) => t.loc && !planned.has(t.id) && t.loot >= RICH_LOOT && news(t.id) && t.terrain !== "water" && !t.hive &&
      !state.bases.some((b) => b.tile === t.id) && !state.factions.some((f) => f.alive && f.bases.includes(t.id)));
  if (rich) {
    pl.sites.push(rich.id);
    return findCard(state, p, `Rich site: ${rich.loc.name}`, `${rich.loc.name} (${state.grid.distance(rich.id, tile)} tiles away) looks barely touched (loot ~${Math.round(rich.loot * 100)}%, danger ${siteDanger(rich.loc)}).`, rich.id);
  }
  // Supplies short of the way home.
  if (!pl.fired.low && foodDays(state, p) < 4) {
    const h = hoursHome(state, p);
    const left = (p.orders || []).length;
    if (h != null && left && foodDays(state, p) * 24 < h + 12) {
      pl.fired.low = true;
      return findCard(state, p, "Supplies running low", `Food for about ${foodDays(state, p).toFixed(1)} days, water ${(carriedAny(p, "water") / Math.max(1, members.length)).toFixed(1)}; home is about ${h}h away and the plan still has ${left} step${left === 1 ? "" : "s"}.`);
    }
  }
}

// The current order as orders, so "Resume the plan" can put it back (a trip on the way, or the rest of a job).
function currentAsOrders(state, p) {
  if (p.phase === "out" && p.dest != null && p.dest !== partyTile(p)) {
    const m = p.mission === "recon" ? "survey" : p.mission;
    return [{ type: "move", tile: p.dest }, ...(m !== "move" && MISSIONS[m] && (!MISSIONS[m].hidden || m === "survey") ? [{ type: "mission", mission: m, at: p.dest }] : [])];
  }
  if (p.phase === "task" && p.task && p.task.type === "sweep") return [{ type: "sweep", radius: p.task.radius, hours: Math.max(SURVEY.hours.min, p.task.hours - p.task.done) }];
  if (p.phase === "task" && p.task && ["camp", "wait"].includes(p.task.type)) {
    const left = p.task.hours == null ? null : Math.max(1, p.task.hours - p.task.done);
    return [{ type: p.task.type, hours: left }];
  }
  return [];
}

function comeHome(state, p, kind, reason) {
  const pl = p.plan;
  if (p.phase === "task" && p.task?.afloat) return; // on the water: checked again once it lands
  pl.fired[kind] = true;
  const saved = [...currentAsOrders(state, p), ...(p.orders || [])];
  const err = startReturn(state, p);
  if (err) return; // cut off by water: startReturn raised its own card
  log(state, `${teamName(state, p)}: ${reason}. Following the plan's rule, the team turns for home.`, "danger");
  addCard(state, {
    title: "Coming home", planCard: true, partyId: p.id, where: tileLabel(state, partyTile(p)),
    text: `${reason[0].toUpperCase()}${reason.slice(1)}: as the plan says, the team turns for home.${saved.length ? ` Left undone: ${saved.length} step${saved.length === 1 ? "" : "s"}.` : ""}`,
    choices: [
      { label: "Continue home", hint: "The team keeps heading back.", resolve: () => "" },
      ...(saved.length ? [{ label: "Resume the plan", hint: "Ignore this rule for the rest of the trip and carry on with the steps left.", order: true, resolve: (st) => { p.orders = saved; return startOrder(st, p, p.orders.shift()); } }] : []),
      { label: "Stop and wait for orders", hint: "The team stops where it is and reports in.", resolve: (st) => { awaitOrders(st, p, ""); return ""; } },
    ],
  });
}

// A find worth a decision: continue, change the plan (team panel, contact for this hour) or come home.
function findCard(state, p, title, text, siteTile = null) {
  const choices = [{ label: "Continue the plan", hint: p.orders && p.orders.length ? `Next: ${p.orders.length} step${p.orders.length === 1 ? "" : "s"} left.` : "Carry on.", resolve: () => "" }];
  if (siteTile != null) {
    choices.push({ label: "Search it next", hint: "Adds a move there and a search to the front of the plan (after the current order).", resolve: (st) => {
      p.orders = p.orders || [];
      p.orders.unshift({ type: "move", tile: siteTile }, { type: "mission", mission: "scavenge", at: siteTile });
      return `Added: search ${tileLabel(st, siteTile)} next.`;
    } });
  }
  choices.push(
    { label: "Change the plan…", hint: "Open the team panel: you have contact while you answer this report.", uiAction: { type: "expedition", partyId: p.id }, resolve: () => "" },
    { label: "Come home", hint: "Drop the rest of the plan and head back with everything carried.", order: true, resolve: (st) => startReturn(st, p) || "The team heads home." },
  );
  addCard(state, { title, text: `${text} ${teamName(state, p)} reports in.`, planCard: true, partyId: p.id, where: tileLabel(state, partyTile(p)), choices });
}

export const planStatus = (state, p) => {
  if (!p.plan) return "";
  const left = (p.orders || []).length;
  return `${p.plan.name}${p.plan.active ? ` · ${left} step${left === 1 ? "" : "s"} left` : " · done"}`;
};
export const conditionText = (c) => [
  c.hurt != null ? `anyone below ${c.hurt} health` : "", c.food != null ? `food below ${c.food} days` : "", c.cargo ? "cargo full" : "",
].filter(Boolean).join(", ");
