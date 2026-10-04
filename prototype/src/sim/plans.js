// Trip plans (the planner's PLAN section) and the radio rule for field teams.
//
// A plan is the team's order queue built before it leaves: the trip to the target with its mission, then steps
// such as "look around", "scavenge here", "scavenge the best sites nearby", "camp N days", "gather", "wait",
// "move to …" and "return home" (orders.js runs them one after the other). The planner shows the ETA and the
// rations for the whole plan (estimatePlan, the same hour-by-hour stepping as the real trip).
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
import { LOCATIONS, siteDanger } from "./data.js";
import {
  partyMembers, partyTile, tileLabel, teamName, planPath, travelHours, partySpeed, startReturn, awaitOrders,
  ordersCard, partyCapacity, cargoRoom, carried, sightRadius, fuelForPath, STANCES, MISSIONS,
  plannedPace, partyPace, plannedVehicle, rationsPerHour, paceOpts, modeSpeed,
} from "./parties.js";
import { travelMode } from "./vehicles.js";
import { startOrder } from "./orders.js";
import { fieldHeatHour } from "./fieldheat.js";

export const SEARCH_HOURS = 6;      // time on site the estimates assume for a search (as estimateTrip does)
export const SURVEY_STEP_HOURS = 2; // Look around
export const GATHER_STEP_HOURS = 3;
export const CHECKIN_HOURS = 12;    // a waiting team out of contact reports in again after this
export const CAMP_CHECKIN = 24;     // an open-ended camp out of contact reports in once a day
export const RICH_LOOT = 0.55;      // a site this rich in sight and not on the plan raises a card
export const SEARCH_AREA_HOURS = 22; // the estimate for "Search the area": about 3 looks with short moves, then a search

// Step kinds the planner offers (kind → label, default fields).
export const STEP_KINDS = {
  survey:   { label: "Look around (2h)", desc: "Two hours surveying nearby tiles: better odds of spotting caches, wrecks and camps." },
  scavenge: { label: "Scavenge here", desc: "Search the site the team stands on (a raid on its own map)." },
  nearby:   { label: "Scavenge nearby sites", desc: "Search the best known sites within a few tiles, richest first (what the team sees on the way counts). Sites are picked when the step starts, so the plan adapts." },
  camp:     { label: "Camp", desc: "Rest on the spot: the hurt heal slowly. Staying put builds Heat (a camp fire most), and Heat brings trouble." },
  gather:   { label: "Gather boat materials (3h)", desc: "Search the shore for scrap (only on a shore with a crossing)." },
  wait:     { label: "Wait", desc: "Hold on the spot for some hours (no fire: less Heat than a camp)." },
  move:     { label: "Move to a site", desc: "Travel on to another known site." },
  searcharea: { label: "Search the area", desc: "Find a downed aircraft or supply drop in its search circle: look around at the spots that clear the most unsearched ground (2h each, up to 8), then search the wreck when it turns up (crashes.js)." },
  home:     { label: "Return home", desc: "Head back with everything carried. The plan ends there." },
};

// Presets: [mission at the target, steps after it].
export const PRESETS = {
  recon:    { name: "Recon and return", mission: "recon", steps: () => [{ kind: "home" }], desc: "Travel there, survey the area, come home." },
  scavenge: { name: "Scavenge and return", mission: "scavenge", steps: () => [{ kind: "home" }], desc: "Travel there, search the site, come home." },
  explore:  { name: "Explore", mission: "recon", steps: () => [{ kind: "nearby", radius: 3, count: 2 }, { kind: "home" }], desc: "Recon the target, then search the best sites within 3 tiles by loot (up to 2), then come home." },
  camp:     { name: "Camp N days, then return", mission: "move", steps: (days = 1) => [{ kind: "camp", hours: 24 * days }, { kind: "home" }], desc: "Go there, camp for the days set, come home. Camping builds Heat: fine in a quiet spot, asking for trouble near a city or a hive." },
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
      case "scavenge": out.push({ type: "mission", mission: "scavenge", ...place }); break;
      case "nearby": out.push({ type: "nearby", radius: s.radius || 3, count: s.count || 1, center: at }); known = false; break;
      case "camp": out.push({ type: "camp", hours: Math.max(1, Math.round(s.hours || 24)) }); break;
      case "gather": out.push({ type: "gather", ...place }); break;
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
    case "camp": return `Camp ${s.hours % 24 === 0 ? `${s.hours / 24} day${s.hours === 24 ? "" : "s"}` : `${s.hours}h`}`;
    case "wait": return `Wait ${s.hours || 6}h`;
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
export function estimatePlan(state, { memberIds, dest, vehicle, stance, fuel, mission, steps, homeBaseId, from = null, startHour = state.hour, p = null, supplies = {}, v = null }) {
  const home = baseById(state, homeBaseId || (hub(state) || {}).id);
  if (!home) return null; // no base left (conquest.js exiles)
  const members = (memberIds || []).map((id) => survivorById(state, id)).filter(Boolean);
  const pv = p ? null : plannedVehicle(state, vehicle, v, members.length || (memberIds || []).length);
  const pace = p ? partyPace(state, p) : plannedPace(state, { members, supplies, v: pv, stance });
  const startMode = p ? (vehicle === true || vehicle === "bike" ? vehicle : vehicle ? p.vehicle || true : false) : travelMode(pv);
  const sp = pace.footSpeed; // on foot (a recon's two hours are paid at this pace)
  let veh = startMode, f = veh === true ? fuel ?? Infinity : 0, at = startHour, tile = from ?? home.tile, fuelUse = 0;
  let owed = 0; // hours of a recon still owed: paid by the next move, as in the real trip (parties.js survey)
  let moveH = 0, rideH = 0, restH = 0; // for the rations: hours on the move (riding) and resting
  const legs = [];
  const travel = (to, label) => {
    if (to === tile) return true;
    let res = planPath(state, tile, to, veh);
    if (!res && veh) { res = planPath(state, tile, to, false); if (res) { veh = false; f = 0; } }
    if (!res) return false;
    if (veh === true) fuelUse += fuelForPath(state, res.path, pace.fuelMult);
    const t = travelHours(state, res.path, { vehicle: veh, speed: veh ? pace.rideSpeed ?? pace.speed : pace.footSpeed, footSpeed: pace.footSpeed, fuelMult: pace.fuelMult, fuel: f, startHour: at, progress: owed });
    veh = t.vehicle; f = t.fuelLeft; owed = 0;
    moveH += t.hours; rideH += t.rideHours;
    legs.push({ label, hours: t.hours, from: tile, to, path: res.path, start: at, left: t.progress });
    at += t.hours; tile = to;
    return true;
  };
  const stay = (label, hours) => { legs.push({ label, hours, from: tile, to: tile, start: at }); at += hours; restH += hours; };
  if (!travel(dest, `To ${tileLabel(state, dest)}`)) return null;
  const outPath = legs[0] ? legs[0].path : [tile], hoursOut = legs[0] ? legs[0].hours : 0;
  // On site: a search 6h, a recovery or other mission 1h; a recon's 2 hours are paid by the next move.
  const onSite = mission === "scavenge" ? SEARCH_HOURS : mission === "recon" || mission === "move" || mission === "outpost" ? 0 : 1;
  if (onSite) stay(`${MISSIONS[mission]?.name || mission} at ${tileLabel(state, dest)}`, onSite);
  if (mission === "recon") { owed = Math.min(0, (legs[0] ? legs[0].left : 0) - 2 * (veh ? pace.rideSpeed ?? pace.speed : sp)); legs.push({ label: `Recon at ${tileLabel(state, dest)} (2h, on the next move)`, hours: 0, from: tile, to: tile, start: at }); }
  let returns = false, open = false;
  const chosen = [];
  for (const s of steps || []) {
    if (s.kind === "survey") stay("Look around", SURVEY_STEP_HOURS);
    else if (s.kind === "scavenge") stay(`Scavenge ${tileLabel(state, tile)}`, SEARCH_HOURS);
    else if (s.kind === "gather") stay("Gather materials", GATHER_STEP_HOURS);
    else if (s.kind === "camp") stay(stepLabel(state, s), s.hours || 24);
    else if (s.kind === "wait") stay(stepLabel(state, s), s.hours || 6);
    else if (s.kind === "searcharea") stay("Search the area (estimate: about 3 looks, then the wreck)", SEARCH_AREA_HOURS);
    else if (s.kind === "move" && s.tile != null) { if (!travel(s.tile, `To ${tileLabel(state, s.tile)}`)) { open = true; break; } }
    else if (s.kind === "nearby") {
      const center = s.center ?? tile;
      for (let i = 0; i < (s.count || 1); i++) {
        const site = nearbySites(state, { center, from: tile, radius: s.radius || 3, p, exclude: [...chosen, ...(mission === "scavenge" ? [dest] : []), ...(p && p.plan ? p.plan.searched : [])] })
          .find((x) => x.tile === tile || planPath(state, tile, x.tile, veh));
        if (!site) break;
        chosen.push(site.tile);
        if (site.tile !== tile && !travel(site.tile, `To ${site.name}`)) break;
        stay(`Scavenge ${site.name}`, SEARCH_HOURS);
      }
    } else if (s.kind === "home") { returns = travel(home.tile, `Home to ${home.name}`); if (!returns) open = true; break; }
  }
  const hours = at - startHour;
  const n = Math.max(1, (memberIds || []).length);
  // Without a way home in the plan the rations cover the plan and the way back from where it ends (so the team
  // is not stranded when you order it home), shown separately.
  let backHours = 0;
  if (!returns && tile !== home.tile) {
    const res = planPath(state, tile, home.tile, veh) || planPath(state, tile, home.tile, false);
    const bm = veh && planPath(state, tile, home.tile, veh) ? veh : false;
    const t = res ? travelHours(state, res.path, { vehicle: bm, speed: bm ? pace.rideSpeed ?? pace.speed : pace.footSpeed, footSpeed: pace.footSpeed, fuelMult: pace.fuelMult, fuel: f, startHour: at }) : null;
    backHours = t ? t.hours : 0;
    if (t) { moveH += t.hours; rideH += t.rideHours; }
  }
  const total = hours + backHours;
  // Rations: on the move each person eats more under a load (load.js), at rest one a day.
  const eat = members.length ? (pace.eatMove * rideH + pace.eatFoot * (moveH - rideH) + n * restH) / 24 : (n * total) / 24;
  return {
    legs, hours, hoursOut, backHours, total, returns, open, sites: chosen, endTile: tile, path: outPath, vehicle: veh, fuelLeft: f,
    food: Math.ceil(eat - 1e-9), water: Math.ceil(eat - 1e-9), pace,
    fuel: startMode === true ? Math.ceil(fuelUse * (returns ? 1 : 2) - 1e-9) : 0, days: total / 24,
  };
}

// ---------- launching with a plan (parties.js launchExpedition) ----------
export function applyPlan(state, p, plan) {
  if (!plan) return;
  const steps = (plan.steps || []).filter((s) => STEP_KINDS[s.kind]);
  p.orders = stepsToOrders(state, steps, p.dest);
  const cond = plan.conditions || {};
  p.plan = {
    preset: plan.preset || "custom", name: PRESETS[plan.preset]?.name || "Custom plan", steps: steps.map((s) => ({ ...s })),
    conditions: { hurt: cond.hurt ?? null, food: cond.food ?? null, cargo: !!cond.cargo },
    active: true, fired: {}, hordes: [], sites: [], searched: p.mission === "scavenge" ? [p.dest] : [], started: state.hour,
  };
  const est = estimatePlan(state, { memberIds: p.members, dest: p.dest, vehicle: p.vehicle, stance: p.stance, fuel: p.planFuel, mission: p.mission, steps, homeBaseId: p.homeBaseId, p });
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
  const card = ordersCard(state, p, camp ? `Still in camp after ${p.task.done} hours (Heat ${Math.round(p.heat || 0)}). "Hold here" keeps the camp going.` : "The team checks in again.", null, camp ? "Camp: checking in" : null);
  addCard(state, card);
}

// Days of food left at the rate the team eats on the move (more under a load, load.js), as the plan's "food falls
// below N days" rule counts it.
const foodDays = (state, p) => {
  const m = partyMembers(state, p);
  const perDay = Math.max(1, partyPace(state, p).eatMove, m.length);
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
      return findCard(state, p, "Supplies running low", `Food for about ${foodDays(state, p).toFixed(1)} days, water ${(carried(p, "water") / Math.max(1, members.length)).toFixed(1)}; home is about ${h}h away and the plan still has ${left} step${left === 1 ? "" : "s"}.`);
    }
  }
}

// The current order as orders, so "Resume the plan" can put it back (a trip on the way, or the rest of a job).
function currentAsOrders(state, p) {
  if (p.phase === "out" && p.dest != null && p.dest !== partyTile(p)) {
    const m = p.mission === "recon" ? "survey" : p.mission;
    return [{ type: "move", tile: p.dest }, ...(m !== "move" && MISSIONS[m] && (!MISSIONS[m].hidden || m === "survey") ? [{ type: "mission", mission: m, at: p.dest }] : [])];
  }
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
