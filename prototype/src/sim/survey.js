// The Survey mission ("sweep" in the code: MISSIONS.survey is the old two-hour Look around) and rumours of hidden
// places (discovery.js).
//
// Survey: a team sweeps the land around a centre tile (radius 2–4, default 3) for N hours (6–48, default 24). It walks
// (rides, drives) from spot to spot inside the circle, looks hard at each, and ends back at the centre when the hours
// are up, so a plan can go on from there (home, a search, another survey). The route is worked out when the survey
// starts (sweepRoute: no random numbers, so the planner's estimate and the real survey are the same hours, rations and
// fuel). Each hour the team rolls for every hidden site (discovery.js) and hidden find (tile.hidden caches, wrecks,
// camps) in reach that it does not know yet:
//   chance an hour = 12% × Scouting × team × terrain × distance × light × weather × vehicle × stance × optics × rumour
//     Scouting   0.5 + 0.05 a point of the best scout (Scouting 10 = ×1; Keen Eye / Spotter +0.15 each)
//     team       +8% a person past the first (at most ×1.3)
//     terrain    of the site's tile: farmland ×1.35, suburbs ×1, city ×0.85, hills ×0.7, forest ×0.6, mountains ×0.55
//     distance   from the team's tile, less the optics' reach: 0–1 tiles ×1.6, 2 ×1, 3 ×0.45, 4 ×0.18, 5 ×0.06
//     light      night (20:00–06:00) ×0.35; the best light carried (lights.js: a headlamp ×0.42, a torch ×0.45,
//                a flashlight ×0.5, a lantern ×0.55, a spotlight ×0.7), night vision ×0.75, a thermal ×0.9
//     weather    fog ×0.5, blizzard ×0.4, storm ×0.55, rain ×0.85, snow ×0.8 (a thermal leaves fog at ×0.9)
//     vehicle    a car ×0.6 (it covers ground fast but sees little off the road), bikes ×0.8, on foot ×1
//     stance     stealthy ×1.2 (slow and careful: fewer spots, fewer encounters), rushed ×0.75
//     optics     the team's best (optics.js): binoculars ×1.25 and a tile more reach, a spotting scope ×1.6 and
//                two tiles (a survey counts as staying put), a thermal ×1.2 and no night or fog penalty
//     rumour     ×3 for a site a rumour points at, when the survey's centre lies inside the rumour's circle
//   capped at 80% an hour. Whatever it walks past within its sight radius it sees anyway, as on any trip.
// Moving: a step to a neighbouring tile takes 2 hours on foot (×1.4 hills and forest, ×2 mountains, ×0.7 by road),
// 1.5 on bikes, 1 by car (which cannot leave the roads' reach into mountains), ×1.35 stealthy and ×0.8 rushed.
// Costs and risks: food and water by the hour at the moving rate (load bands apply, load.js), a car's fuel by the tile
// (as travel) and wear on the vehicle; Heat builds at half the rate of standing still (fieldheat.js ACTIVITY.sweep);
// every tile entered rolls the road's events and encounters (hordes, raiders, other groups' scouts: events.js), and an
// hour on hive land rolls 3% (8% on the red-skull ring) for the dead finding the team (tougher there, hives.js).
// A find is put in the team's report (p.seen): radioed in at once in radio range, otherwise brought home, and the
// discovery log names the team (discovery.js noteFinds).
//
// Rumours: radio news, travellers and merchants sometimes speak of a place nobody has found ("a hunting lodge somewhere
// north of Dunmore"). A rumour is a circle of 3 tiles that holds the place (never the exact tile), on the map for
// RUMOUR.days days; a survey whose centre lies in it gets ×3 odds for that place. Found, it is struck off; nothing
// here uses the world's random numbers (hash01), so rumours shift no other result.
import { LIGHTS, surveyLight } from "./lights.js"; // the best light carried: a survey's night hours
const bestLamp = (keys) => keys.filter((k) => LIGHTS[k]).sort((a, b) => LIGHTS[b].survey - LIGHTS[a].survey)[0] || null;
import { TERRAIN, LOCATIONS } from "./data.js";
import { log, snapshot, hub, day, skill, atBase } from "./world.js";
import {
  partyMembers, partyTile, tileLabel, teamName, planPath, moveCost, leaveVehicle, fuelMultOf, sightRadius,
  awaitOrders, launchExpedition, orderMove,
} from "./parties.js";
import { partyVehicle, partyVehicles, wear, useFuel, tileFuel } from "./vehicles.js";
import { perceive, MARKER_TYPES } from "./markers.js";
import { hiddenSites, siteKnown, siteKnownTo, noteLooked } from "./discovery.js";
import { weather } from "./weather.js";
import { hash01, gainXpAll, USE, anyPerk } from "./skills.js";
import { rollTravelEvent } from "./events.js";
import { stationaryEncounter, COOLDOWN_HOURS } from "./conflicts.js";
import { zombieToughness } from "./hives.js";
import { crashSurvey } from "./crashes.js";
import { opticsFor, OPTICS } from "./optics.js";
import { carriedAll } from "./comforts.js";
import { listeners } from "./radio.js";

export const SURVEY = {
  radius: { min: 2, max: 4, def: 3 },
  hours: { min: 6, max: 48, def: 24 },
  base: 0.12, cap: 0.8,
  dist: [1.6, 1.6, 1, 0.45, 0.18, 0.06],
  terrain: { plains: 1.35, suburb: 1, city: 0.85, forest: 0.6, hills: 0.7, mountain: 0.55 },
  vehicle: { car: 0.6, bike: 0.8, foot: 1 },
  stance: { stealthy: 1.2, normal: 1, rushed: 0.75 },
  stanceStep: { stealthy: 1.35, normal: 1, rushed: 0.8 },
  step: { foot: 2, bike: 1.5, car: 1 },
  night: 0.35, flashlight: 0.5, nvg: 0.75,
  weather: { fog: 0.5, blizzard: 0.4, storm: 0.55, rain: 0.85, snow: 0.8 },
  rumour: 3,
  hive: 0.03, hiveRing: 0.08,
  auto: { spare: 2, home: 0, keep: 3, keepFrac: 0.5, every: 6, everyRumour: 3, range: 10, rangeStep: 3, rangeEvery: 60, rangeMax: 40 }, // the autopilot's surveys (surveyCandidate): range grows with the months
  finds: 0.1, // + the look-around bonus for tile.hidden finds (markers.js perceive)
};
export const RUMOUR = { days: 20, radius: 3, max: 3, reach: 30, radio: 0.05, visitors: 0.15, news: 0.5, groupNews: 0.35 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const isNightAt = (hour) => hour % 24 < 6 || hour % 24 >= 20;
const land = (state, id) => { const t = state.tiles[id]; return t && (t.terrain !== "water" || t.bridge); };
export const clampRadius = (r) => clamp(Math.round(Number(r) || SURVEY.radius.def), SURVEY.radius.min, SURVEY.radius.max);
export const clampHours = (h) => clamp(Math.round(Number(h) || SURVEY.hours.def), SURVEY.hours.min, SURVEY.hours.max);
export const sweepOpts = (o = {}) => ({ radius: clampRadius(o.radius), hours: clampHours(o.hours) });
const modeKey = (mode) => (mode === true ? "car" : mode === "bike" ? "bike" : "foot");
export const sweeping = (p) => !!(p && p.phase === "task" && p.task && p.task.type === "sweep");

// ---------- the route ----------
// Hours a step from `from` to `to` takes during a survey.
export function stepHours(state, from, to, mode, stance) {
  const c = moveCost(state, from, to, mode);
  if (!isFinite(c)) return Infinity;
  const onRoad = state.tiles[from].roadLinks.includes(to);
  const t = state.tiles[to].terrain;
  const ground = onRoad ? 0.7 : t === "mountain" ? 2 : t === "forest" || t === "hills" || t === "city" ? 1.4 : 1;
  return Math.max(1, Math.round(SURVEY.step[modeKey(mode)] * ground * (SURVEY.stanceStep[stance] || 1)));
}
// Hours to walk back to the centre from a tile (the shortest way, step by step), Infinity without one.
function hoursBack(state, from, center, mode, stance, memo) {
  if (from === center) return 0;
  if (memo.has(from)) return memo.get(from);
  const res = planPath(state, from, center, mode);
  let h = Infinity;
  if (res) { h = 0; for (let i = 1; i < res.path.length; i++) h += stepHours(state, res.path[i - 1], res.path[i], mode, stance); }
  memo.set(from, h);
  return h;
}
// The tile the team stands on at the end of each hour of the survey: route[0] = where it starts, route[hours] = the
// centre. Greedy: the next spot clears the most ground it has not looked at yet, never so far that it could not walk
// back in the hours left. No random numbers (a hash breaks ties), so it can be worked out ahead (estimates, the map).
export function sweepRoute(state, { center, radius, hours, mode = false, stance = "normal", start = center }) {
  const g = state.grid;
  const route = [start];
  const looked = new Set(g.within(start, 1));
  const visits = new Map([[start, 1]]);
  const memo = new Map();
  let cur = start, h = 0;
  while (h < hours) {
    const left = hours - h;
    let best = null;
    for (const n of g.neighbors(cur)) {
      if (!land(state, n) || g.distance(center, n) > radius) continue;
      const need = stepHours(state, cur, n, mode, stance);
      if (!isFinite(need) || need > left) continue;
      const back = hoursBack(state, n, center, mode, stance, memo);
      if (h + need + back > hours) continue;
      let fresh = 0;
      for (const x of g.within(n, 1)) if (!looked.has(x) && g.distance(center, x) <= radius + 1) fresh++;
      const v = fresh * 1.0 - (visits.get(n) || 0) * 1.5 - need * 0.25 + hash01(state.seed, "sweep", center, n, h) * 0.4;
      if (!best || v > best.v) best = { n, need, v };
    }
    // Nowhere new worth the walk (or no time): back toward the centre, or wait out the hours there.
    if (!best || (best.v < 0 && cur === center)) {
      if (cur === center) { route.push(cur); h++; continue; }
      const res = planPath(state, cur, center, mode);
      const n = res && res.path[1];
      const need = n != null ? stepHours(state, cur, n, mode, stance) : Infinity;
      if (n == null || !isFinite(need) || need > left) { while (h < hours) { route.push(cur); h++; } break; }
      best = { n, need };
    }
    for (let i = 1; i < best.need; i++) route.push(cur);
    route.push(best.n);
    h += best.need;
    cur = best.n;
    visits.set(cur, (visits.get(cur) || 0) + 1);
    for (const x of g.within(cur, 1)) looked.add(x);
  }
  return route.slice(0, hours + 1);
}
// Fuel a car burns on a route (by the tiles it enters, as travel does) at its load multiplier.
export function routeFuel(state, route, mode, mult = 1) {
  if (mode !== true) return 0;
  let f = 0;
  for (let i = 1; i < route.length; i++) if (route[i] !== route[i - 1]) f += tileFuel(true, state.tiles[route[i - 1]].roadLinks.includes(route[i]), mult);
  return f;
}
export const routeMoves = (route) => route.reduce((a, t, i) => a + (i && t !== route[i - 1] ? 1 : 0), 0);

// The estimate for a survey (plans.js estimatePlan, orders.js queueEstimate): hours, fuel and the route.
export function sweepEstimate(state, { center, radius, hours, mode = false, stance = "normal", fuelMult = 1 }) {
  const o = sweepOpts({ radius, hours });
  const route = sweepRoute(state, { center, radius: o.radius, hours: o.hours, mode, stance });
  return { hours: o.hours, radius: o.radius, route, fuel: routeFuel(state, route, mode, fuelMult), moves: routeMoves(route) };
}

// ---------- the odds ----------
// What the team brings to the look (members: survivors; cargo: its found gear). The parts the odds use.
export function lookContext(state, members, { mode = false, stance = "normal", cargo = null } = {}) {
  const scout = Math.max(0, ...members.map((s) => skill(s, "scouting")));
  const keen = members.some((s) => s.traits.includes("keeneye"));
  const spotter = anyPerk(members, "spotter");
  const kit = members.flatMap(carriedAll).map((it) => it && it.key);
  return {
    scout, keen, spotter, n: members.length, mode: modeKey(mode), stance,
    lamp: surveyLight(kit), lampKey: bestLamp(kit), nvg: kit.includes("nvg"), // lights.js: the best light carried
    members, cargo,
  };
}
// Multipliers that do not depend on the site (everything but terrain, distance and rumour), with the reasons.
function teamFactors(ctx) {
  const skill = 0.5 + 0.05 * ctx.scout + (ctx.keen ? 0.15 : 0) + (ctx.spotter ? 0.15 : 0);
  const team = Math.min(1.3, 1 + 0.08 * Math.max(0, ctx.n - 1));
  return { skill, team, vehicle: SURVEY.vehicle[ctx.mode] || 1, stance: SURVEY.stance[ctx.stance] || 1 };
}
// Light and weather at an hour (with the optics' night and fog relief).
function seeing(state, ctx, hour, opt, tile) {
  let light = 1, wx = 1;
  if (isNightAt(hour)) light = Math.max(SURVEY.night, ctx.lamp || 0, ctx.nvg ? SURVEY.nvg : 0, opt.night || 0);
  const k = weather(state, hour, tile).key; // the weather where the team is (weather.js; home if not given)
  if (SURVEY.weather[k]) wx = k === "fog" && opt.fog ? Math.max(SURVEY.weather[k], opt.fog) : SURVEY.weather[k];
  return { light, wx };
}
// Rumours that point at this site from a circle that holds the survey's centre.
export const rumourFor = (state, site, center) => rumoursOf(state).find((r) => r.site === site && state.grid.distance(r.center, center) <= r.radius) || null;

// The chance an hour to spot a hidden place on `site` from `from` (the team's tile), for a survey centred on `center`.
export function siteOdds(state, ctx, site, from, hour, center = from) {
  const opt = opticsFor(ctx.members, ctx.cargo, { still: true, night: isNightAt(hour), fog: weather(state, hour, from).key === "fog" });
  const f = teamFactors(ctx);
  const d = Math.max(0, state.grid.distance(from, site) - opt.reach);
  const dist = SURVEY.dist[d] ?? 0;
  if (!dist) return 0;
  const terr = SURVEY.terrain[state.tiles[site].terrain] ?? 1;
  const { light, wx } = seeing(state, ctx, hour, opt, from);
  const rum = rumourFor(state, site, center) ? SURVEY.rumour : 1;
  return Math.min(SURVEY.cap, SURVEY.base * f.skill * f.team * f.vehicle * f.stance * terr * dist * light * wx * opt.look * rum);
}

// ---------- the survey in the field ----------
// Starts a survey where the team stands (orders.js startOrder "sweep", parties.js arrive for the Survey mission).
export function startSweep(state, p, o = {}) {
  const tile = partyTile(p);
  const { radius, hours } = sweepOpts(o.radius != null || o.hours != null ? o : p.sweepPlan || {});
  if (!land(state, tile)) return failSweep(state, p, "A survey cannot start on open water.");
  const route = sweepRoute(state, { center: tile, radius, hours, mode: p.vehicle || false, stance: p.stance });
  p.phase = "task";
  p.path = [tile];
  p.idx = 0;
  p.progress = Math.min(0, p.progress);
  p.dest = tile;
  // The hidden places in reach the team already knew of: anything else it comes to know on the survey is its find.
  const known0 = candidates(state, tile, radius + 2 + OPTICS.maxReach).filter((id) => siteKnownTo(state, id, p));
  p.task = { type: "sweep", center: tile, radius, hours, route, done: 0, found: [], finds: [], tiles: 1, known0 };
  p.orderStart = state.hour;
  return `${teamName(state, p)} starts a survey of ${radius} tiles around ${tileLabel(state, tile)} (${hours}h).`;
}
function failSweep(state, p, msg) {
  if (p.phase === "waiting" || p.phase === "out") awaitOrders(state, p, msg, { failed: true });
  return msg;
}

// One hour of the survey (orders.js taskHour, after the hour is counted).
export function sweepHour(state, p) {
  const t = p.task;
  if (!t || t.type !== "sweep") return;
  const members = partyMembers(state, p);
  if (!members.length) return;
  // A road card's delay is taken out of the survey's own hours (it covers a little less), not added to the trip.
  if (p.progress < 0) p.progress = 0;
  const h = Math.min(t.done, t.route.length - 1);
  const next = t.route[h];
  if (next != null && next !== partyTile(p)) {
    const from = partyTile(p);
    p.path = [next];
    p.idx = 0;
    p.dest = next;
    t.tiles = (t.tiles || 1) + 1;
    if (enterTile(state, p, from, next) === false || !state.parties.includes(p) || p.phase !== "task") return;
  }
  const here = partyTile(p);
  gainXpAll(state, members, "scouting", USE.survey / 2); // skills.js: half a look around's XP an hour
  // Hidden places in reach that the team does not know of.
  const ctx = lookContext(state, members, { mode: p.vehicle || false, stance: p.stance, cargo: p.cargo });
  const reach = t.radius + 2 + opticsFor(members, p.cargo, { still: true }).reach;
  for (const id of candidates(state, t.center, reach)) {
    if (siteKnownTo(state, id, p)) continue;
    const c = siteOdds(state, ctx, id, here, state.hour, t.center);
    if (c > 0 && state.rng.chance(c)) p.seen.set(id, snapshot(state, id));
  }
  // What it knows now that it did not when it started (rolled, or seen walking past): its finds.
  for (const id of candidates(state, t.center, t.radius + 2 + OPTICS.maxReach)) {
    if (t.found.includes(id) || (t.known0 || []).includes(id) || !siteKnownTo(state, id, p)) continue;
    t.found.push(id);
    if (!p.radioLive) log(state, `${teamName(state, p)} spotted ${placeText(state, id)} while surveying (out of radio range: it goes on the map once they report).`, "info");
  }
  // Caches, wrecks and camps (tile.hidden): the look-around roll, a little better with optics, near the team.
  const opt = opticsFor(members, p.cargo, { still: true, night: isNightAt(state.hour) });
  const bonus = SURVEY.finds + (opt.look - 1) * 0.3;
  const looked = state.grid.within(here, 1 + opt.reach);
  const found = perceive(state, p, members, looked, bonus);
  for (const f of found) t.finds.push({ type: f.type, tile: f.tile });
  noteLooked(state, p, looked); // discovery.js: the spot is searched (the map's Known area layer)
  // Hive land: the dead there notice a team that walks about (tougher dead, hives.js).
  hiveTrouble(state, p);
}
// Sites the survey can spot: hidden ones (discovery.js) within reach of its centre.
function candidates(state, center, reach) {
  return hiddenSites(state).filter((id) => state.grid.distance(center, id) <= reach);
}
// Entering a tile on the survey: the vehicle's fuel and wear, sight, a wreck's smoke, the road's events.
function enterTile(state, p, from, to) {
  if (p.vehicle) {
    const v = partyVehicle(state, p);
    const onRoad = state.tiles[from].roadLinks.includes(to);
    for (const x of partyVehicles(state, p)) wear(x, onRoad, p.burden ? p.burden.fill : 0); // every vehicle (vehicles.js fleets)
    if (!useFuel(state, p, tileFuel(p.vehicle, onRoad, fuelMultOf(p)))) {
      log(state, `The ${v ? v.name : "vehicle"} ran out of fuel during the survey near ${tileLabel(state, to)}. The team left it there and goes on on foot.`, "danger");
      leaveVehicle(state, p, to, "out of fuel");
      // The rest of the survey on foot, from here.
      const t = p.task;
      const left = sweepRoute(state, { center: t.center, radius: t.radius, hours: Math.max(0, t.hours - t.done), mode: false, stance: p.stance, start: to });
      t.route = [...t.route.slice(0, t.done), ...left];
    }
  }
  const members = partyMembers(state, p);
  const around = state.grid.within(to, sightRadius(state, p));
  for (const id of around) p.seen.set(id, snapshot(state, id));
  perceive(state, p, members, around);
  crashSurvey(state, p); // crashes.js: a wreck in reach, or its circle narrowed
  // One card at a time; none on the last step back to the centre (a delay then would fall on the next leg instead of
  // the survey's own hours).
  if (p.eventHour === state.hour || state.cards.some((c) => c.partyId === p.id) || p.task.done >= p.task.hours) return true;
  const card = rollTravelEvent(state, p, to);
  if (card) {
    p.eventsSeen = (p.eventsSeen || 0) + 1;
    p.eventHour = state.hour;
    state.cards.push(card);
  }
  return true;
}
function hiveTrouble(state, p) {
  const tough = zombieToughness(state, partyTile(p));
  if (!tough || p.eventHour === state.hour || state.combat || state.cards.some((c) => c.partyId === p.id)) return;
  if (p.lastConflict != null && state.hour - p.lastConflict < COOLDOWN_HOURS) return;
  if (!state.rng.chance(tough >= 3 ? SURVEY.hiveRing : SURVEY.hive)) return;
  const card = stationaryEncounter(state, p, {});
  if (!card) return;
  card.text = `Surveying hive land draws the dead. ${card.text || ""}`.trim();
  p.eventHour = state.hour;
  state.cards.push(card);
}
const article = (s) => (/^[aeiou]/i.test(s) ? "an " : "a ") + s;
const placeText = (state, id) => article(LOCATIONS[state.tiles[id].loc.type].name.toLowerCase());

// The survey is over (orders.js finishTask): the report text.
export function sweepDone(state, p) {
  const t = p.task;
  const names = t.found.map((id) => `${state.tiles[id].loc.name} (${LOCATIONS[state.tiles[id].loc.type].name.toLowerCase()})`);
  const finds = t.finds.map((f) => MARKER_TYPES[f.type].name.toLowerCase());
  for (const id of t.found) strikeRumour(state, id, p);
  const stats = state.surveyStats || (state.surveyStats = { done: 0, hours: 0, found: 0, finds: 0 });
  stats.done++; stats.hours += t.done; stats.found += t.found.length; stats.finds += t.finds.length;
  const crash = crashSurvey(state, p);
  const what = names.length || finds.length ? `found ${[...(names.length ? [`${names.length === 1 ? "a place off the map" : `${names.length} places off the map`}: ${names.join(", ")}`] : []), ...(finds.length ? [finds.join(", ")] : [])].join("; and ")}` : "found nothing new";
  return `Surveyed ${t.radius} tiles around ${tileLabel(state, t.center)} for ${t.done}h (${t.tiles || 1} spots): ${what}.${!p.radioLive && names.length ? " They go on the hub's map once the team reports." : ""}${crash ? ` ${crash}` : ""}`;
}
// For the panels: "Surveying: 14 of 24 hours, 1 place found".
export function sweepStatus(state, p) {
  const t = p && p.task;
  if (!t || t.type !== "sweep") return "";
  const n = t.found.length;
  return `Surveying ${t.radius} tiles around ${tileLabel(state, t.center)}: ${t.done} of ${t.hours} hours, ${n} place${n === 1 ? "" : "s"} found${t.finds.length ? `, ${t.finds.length} find${t.finds.length === 1 ? "" : "s"}` : ""}`;
}

// ---------- the planner's look ahead ----------
// The odds as a word with the reasons: the chance that a hidden place somewhere in the circle (an average land tile)
// is found by the end, from the route the survey would take. members: survivors; mode: false / "bike" / true.
export function sweepPreview(state, { members, center, radius, hours, mode = false, stance = "normal", startHour = state.hour, cargo = null }) {
  const o = sweepOpts({ radius, hours });
  const g = state.grid;
  if (!members.length || center == null || !land(state, center)) return null;
  const route = sweepRoute(state, { center, radius: o.radius, hours: o.hours, mode, stance });
  const ctx = lookContext(state, members, { mode, stance, cargo });
  const sight = 1 + (opticsFor(members, cargo, { still: true }).sight || 0);
  const tiles = g.within(center, o.radius).filter((id) => land(state, id) && !state.bases.some((b) => b.tile === id));
  let sum = 0;
  for (const x of tiles) {
    if (route.some((r) => g.distance(r, x) <= sight)) { sum += 1; continue; }
    let miss = 1;
    for (let h = 1; h < route.length; h++) miss *= 1 - siteOdds(state, ctx, x, route[h], startHour + h, center);
    sum += 1 - miss;
  }
  const chance = tiles.length ? sum / tiles.length : 0;
  const word = chance >= 0.75 ? "good" : chance >= 0.45 ? "fair" : "poor";
  // The reasons, strongest first.
  const f = teamFactors(ctx);
  const reasons = [];
  const add = (mult, text) => { if (Math.abs(mult - 1) >= 0.04) reasons.push({ mult, text: `${text} ×${r2(mult)}` }); };
  add(f.skill, `best Scouting ${ctx.scout}${ctx.keen ? ", Keen Eye" : ""}${ctx.spotter ? ", Spotter" : ""}`);
  add(f.team, `${ctx.n} people`);
  const terr = tiles.reduce((a, x) => a + (SURVEY.terrain[state.tiles[x].terrain] ?? 1), 0) / Math.max(1, tiles.length);
  const ground = Object.entries(tiles.reduce((m, x) => ((m[state.tiles[x].terrain] = (m[state.tiles[x].terrain] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => TERRAIN[k].name.toLowerCase());
  add(terr, `mostly ${ground.join(" and ")}`);
  const nights = route.slice(1).filter((_, i) => isNightAt(startHour + i + 1)).length;
  if (nights) {
    const opt = opticsFor(members, cargo, { still: true, night: true });
    const light = Math.max(SURVEY.night, ctx.lamp || 0, ctx.nvg ? SURVEY.nvg : 0, opt.night || 0);
    reasons.push({ mult: 1 - (1 - light) * (nights / o.hours), text: `${nights} of ${o.hours} hours in the dark ×${light}${light > SURVEY.night ? ` (${opt.night ? "thermal" : ctx.nvg && SURVEY.nvg >= (ctx.lamp || 0) ? "night vision" : LIGHTS[ctx.lampKey]?.name || "a light"})` : ""}` });
  }
  const wxs = new Map();
  for (let h = 1; h <= o.hours; h++) { const k = weather(state, startHour + h).key; if (SURVEY.weather[k]) wxs.set(k, (wxs.get(k) || 0) + 1); }
  for (const [k, n] of wxs) reasons.push({ mult: 1 - (1 - SURVEY.weather[k]) * (n / o.hours), text: `${k === "fog" ? "fog" : k} for ${n}h ×${SURVEY.weather[k]}` });
  add(f.vehicle, ctx.mode === "car" ? "by car (sees little off the road)" : "on bikes");
  add(f.stance, stance === "stealthy" ? "stealthy: careful, but covers less" : "rushed: covers more, sees less");
  const opt = opticsFor(members, cargo, { still: true });
  if (opt.best) reasons.push({ mult: opt.look, text: `${opt.text} ×${r2(opt.look)}${opt.reach ? `, looks ${opt.reach} tile${opt.reach === 1 ? "" : "s"} further` : ""}` });
  else reasons.push({ mult: 1, text: "no binoculars or scope (they help a lot)" });
  const rum = rumoursOf(state).filter((r) => g.distance(r.center, center) <= r.radius);
  for (const r of rum) reasons.push({ mult: SURVEY.rumour, text: `the rumour of ${r.what} (×${SURVEY.rumour} for it inside its circle)` });
  const cover = new Set();
  for (const r of route) for (const x of g.within(r, sight)) if (g.distance(center, x) <= o.radius) cover.add(x);
  const hive = tiles.some((x) => { const k = state.live.has(x) ? { infection: state.tiles[x].infection } : state.knowledge[x]; return k && k.infection > 0.6; });
  reasons.sort((a, b) => Math.abs(Math.log(b.mult || 1)) - Math.abs(Math.log(a.mult || 1)));
  return {
    word, chance, route, hours: o.hours, radius: o.radius, moves: routeMoves(route), seenTiles: cover.size, tiles: tiles.length,
    reasons: reasons.map((r) => r.text), rumours: rum, hive,
    text: `${word} odds (${Math.round(chance * 100)}% for a place hidden somewhere in the circle): ${reasons.slice(0, 5).map((r) => r.text).join("; ")}.`,
  };
}

// ---------- rumours ----------
export const rumoursOf = (state) => (state.rumours || []).filter((r) => state.hour < r.expires && !r.done);
// Where a rumour says the place is: "somewhere north of Dunmore" (the nearest known town or site to the circle).
function whereFrom(state, center) {
  const g = state.grid;
  let best = null;
  for (const t of state.tiles) {
    if (!t.loc || (t.loc.settlement != null && t.loc.settlement !== t.id) || !siteKnown(state, t.id) || t.id === center) continue;
    const town = t.loc.type === "town" || t.loc.type === "city";
    const s = g.distance(center, t.id) - (town ? 2 : 0);
    if (!best || s < best.s) best = { t, s };
  }
  if (!best) return "somewhere nearby";
  const [ax, ay] = g.toPixel(best.t.id, 1), [bx, by] = g.toPixel(center, 1);
  const dirs = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
  const dir = dirs[((Math.round((Math.atan2(by - ay, bx - ax) * 180) / Math.PI / 45) % 8) + 8) % 8];
  return `somewhere ${dir} of ${best.t.loc.name}`;
}
// A new rumour of an unfound hidden place (null when none fits). src: "radio" | "travellers" | "merchants" | a group's
// name; salt: makes the roll its own. Never the world's random numbers.
export function addRumour(state, src, salt = "") {
  const h = hub(state);
  if (!h) return null;
  state.rumours = (state.rumours || []).filter((r) => state.hour < r.expires + 24 * 10); // old ones are forgotten
  const active = rumoursOf(state);
  if (active.length >= RUMOUR.max) return null;
  const g = state.grid;
  const pool = hiddenSites(state).filter((id) => !siteKnown(state, id) && g.distance(id, h.tile) <= RUMOUR.reach && !active.some((r) => r.site === id) && LOCATIONS[state.tiles[id].loc.type]);
  if (!pool.length) return null;
  const w = pool.map((id) => 1 / (1 + g.distance(id, h.tile) / 8));
  let x = hash01(state.seed, "rumour-site", state.hour, src, salt) * w.reduce((a, b) => a + b, 0);
  let site = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x < 0) { site = pool[i]; break; } }
  // The circle holds the place, a tile or two off its centre.
  const ring = g.within(site, 2).filter((id) => land(state, id) && g.distance(id, site) >= 1);
  const center = ring.length ? ring[Math.floor(hash01(state.seed, "rumour-centre", site, state.hour) * ring.length) % ring.length] : site;
  const type = LOCATIONS[state.tiles[site].loc.type].name.toLowerCase();
  const r = {
    id: `${site}:${state.hour}`, site, center, radius: RUMOUR.radius, src, hour: state.hour, expires: state.hour + RUMOUR.days * 24,
    what: article(type), where: whereFrom(state, center), done: false,
  };
  (state.rumours = state.rumours || []).push(r);
  log(state, `👂 ${rumourLine(r)} A survey inside the circle on the map has much better odds of finding it (fades in ${RUMOUR.days} days).`, "info");
  return r;
}
export const rumourLine = (r) => `${r.src === "radio" ? "On the radio, someone" : r.src === "travellers" ? "Travellers" : r.src === "merchants" ? "Merchants" : r.src} spoke of ${r.what} ${r.where}.`;
// A found place: its rumour is struck off.
export function strikeRumour(state, site, p = null) {
  for (const r of state.rumours || []) {
    if (r.site !== site || r.done) continue;
    r.done = true;
    r.foundHour = state.hour;
    if (p) log(state, `👂 The rumour was true: ${teamName(state, p)} found ${r.what} ${r.where}.`, "good");
  }
}
// Daily (world.js tickHour): radio chatter at a base with a station, travellers and merchants at the gates. Rumours
// whose place was found by other means are struck off.
export function surveyDaily(state) {
  if (!state.bases || !state.bases.length) return;
  for (const r of state.rumours || []) if (!r.done && siteKnown(state, r.site)) { r.done = true; r.foundHour = state.hour; }
  let chance = state.bases.some((b) => b.radio) || listeners(state).length ? RUMOUR.radio : 0; // a station, or a hand-crank radio listening (radio.js)
  const near = (v) => state.bases.some((b) => state.grid.distance(b.tile, v.tile) <= 3);
  let src = chance ? "radio" : null;
  for (const v of state.visitors || []) {
    if (v.kind !== "explorers" && v.kind !== "merchants") continue;
    if (!near(v)) continue;
    chance += RUMOUR.visitors;
    src = v.kind === "explorers" ? "travellers" : "merchants";
  }
  if (!chance || hash01(state.seed, "rumour-day", day(state)) >= Math.min(0.4, chance)) return;
  addRumour(state, src, "day");
}
// Hooks for news heard in person (visitors.js "Hear their news", radio.js radioNews): a rumour now and then. Returns
// a sentence for the card ("" when none).
export function rumourFromNews(state, src, salt = "", chance = RUMOUR.news) {
  if (hash01(state.seed, "rumour-news", state.hour, src, salt) >= chance) return "";
  const r = addRumour(state, src, salt);
  return r ? ` They also speak of ${r.what} ${r.where} (a rumour circle on your map).` : "";
}

// ---------- where to survey (the autopilot, crews) ----------
// The best centre to survey within `range` tiles of a base: rumours first, else the most ground nobody has looked at
// (by what the hub knows: no peeking at the hidden sites), not in known hive land, not where a team already surveys.
export function surveyTarget(state, base, { range = 10, minUnknown = 8, radius = 3 } = {}) {
  const g = state.grid;
  const known = (id) => state.live.has(id) || !!state.knowledge[id];
  const busy = state.parties.filter((p) => p.owner === "player" && (sweeping(p) || p.mission === "sweep")).map((p) => (sweeping(p) ? p.task.center : p.dest));
  const hiveLand = (id) => { const k = state.live.has(id) ? { infection: state.tiles[id].infection, hive: state.tiles[id].hive } : state.knowledge[id]; return !!k && (k.hive || k.infection > 0.55); };
  for (const r of rumoursOf(state)) {
    if (g.distance(base.tile, r.center) > range * 1.5 || busy.some((b) => g.distance(b, r.center) <= 2) || hiveLand(r.center) || !land(state, r.center)) continue;
    if (!planPath(state, base.tile, r.center, false)) continue;
    return { tile: r.center, radius: Math.max(radius, r.radius), rumour: r, unknown: null, why: `a rumour of ${r.what} ${r.where}` };
  }
  let best = null;
  for (const id of g.within(base.tile, range)) {
    const d = g.distance(base.tile, id);
    if (d < 3 || !land(state, id) || state.tiles[id].terrain === "mountain" || hiveLand(id)) continue;
    if (busy.some((b) => g.distance(b, id) <= radius + 1)) continue;
    let unknown = 0;
    for (const x of g.within(id, radius)) if (land(state, x) && !known(x)) unknown++;
    if (unknown < minUnknown) continue;
    const score = unknown - d * 0.6;
    if (!best || score > best.score || (score === best.score && id < best.tile)) best = { tile: id, radius, unknown, score };
  }
  if (!best || !planPath(state, base.tile, best.tile, false)) return null;
  return { ...best, why: `${best.unknown} tiles nobody has looked at` };
}
// The autopilot's survey candidate (autopilot.js planTrip): spare hands, few places known near home or a rumour, and
// not too often. Returns a planTrip candidate or null.
export function surveyCandidate(state, spareHands) {
  if (state.surveyOff) return null; // test switch (tools/surveytest.js: the autopilot without surveys)
  const h = hub(state);
  // Two scouts go and at least one spare pair of hands stays (the hub's building and farming come first).
  if (!h || spareHands < SURVEY.auto.spare || atBase(state, h.id).length < SURVEY.auto.home) return null;  const info = state.surveyInfo || (state.surveyInfo = { lastAuto: -99 });
  const rumour = rumoursOf(state).length > 0;
  if (day(state) - info.lastAuto < (rumour ? SURVEY.auto.everyRumour : SURVEY.auto.every)) return null;
  if (state.parties.some((p) => p.owner === "player" && (p.teamMission || p.mission) === "sweep")) return null; // one survey team at a time
  // The scouts range farther as the months pass (10 tiles at first, +3 every two months, up to 40): on a big map
  // the hives keep 30-40 tiles from the hub, and the governor storms only hives it knows of (autopilot.js hiveCandidate).
  const range = Math.min(SURVEY.auto.rangeMax, SURVEY.auto.range + Math.floor(day(state) / SURVEY.auto.rangeEvery) * SURVEY.auto.rangeStep);
  const t = surveyTarget(state, h, { range });
  if (!t) return null;
  const hours = t.rumour ? 18 : 24;
  return { mission: "sweep", tile: t.tile, score: t.rumour ? 3.2 : 1.4 + Math.min(1.4, t.unknown / 25), crew: 2, why: `survey: ${t.why}`, sweep: { radius: t.radius, hours }, onSite: hours, survey: true };
}
// Called when the autopilot or a crew sent a survey (so it waits before the next one).
export const surveySent = (state) => { (state.surveyInfo || (state.surveyInfo = { lastAuto: -99 })).lastAuto = day(state); };

// A crew's survey field job (crews.js FIELD_TYPES.survey): the target within the crew's range.
export function crewSurveyCands(state, base, crew) {
  if (state.surveyOff) return [];
  const t = surveyTarget(state, base, { range: Math.max(3, Math.min(crew.range || 8, 14)) });
  if (!t) return [];
  const hours = clampHours(Math.min(24, crew.maxHours || 12)); // its hours out limit, at most a day
  return [{ tile: t.tile, mission: "sweep", score: t.rumour ? 2.6 : 0.8 + Math.min(1.2, t.unknown / 25), why: `survey: ${t.why}`, sweep: { radius: t.radius, hours }, onSite: hours }];
}

// ---------- a Survey order for a team in the field (the right-click menu, the team panel) ----------
// Go to `tile` (if it is elsewhere) and survey around it. Returns a line for the log.
export function orderSweepAt(state, p, tile, opts = {}, queue = false) {
  const o = { type: "sweep", ...sweepOpts(opts) };
  p.orders = p.orders || [];
  if (queue) {
    if (tile !== partyTile(p)) p.orders.push({ type: "move", tile });
    p.orders.push(o);
    return `Queued: survey ${o.radius} tiles around ${tileLabel(state, tile)} for ${o.hours}h.`;
  }
  if (tile === partyTile(p)) return startSweep(state, p, o);
  p.orders.unshift(o);
  const msg = orderMove(state, p, tile);
  if (p.dest !== tile) { p.orders.shift(); return msg; }
  return `${teamName(state, p)} sets off to survey ${o.radius} tiles around ${tileLabel(state, tile)} for ${o.hours}h.`;
}

// Sends a survey team from the hub (tools and the console; the planner launches through parties.js).
export function sendSurvey(state, { memberIds, tile, radius, hours, stance = "normal", vehicleId = null, supplies, home = true }) {
  return launchExpedition(state, { memberIds, dest: tile, mission: "sweep", stance, vehicleId, supplies, sweep: { radius, hours }, plan: home ? { preset: "survey", steps: [{ kind: "home" }], conditions: {} } : null });
}
// For the map's tooltip: rumours and surveys over a tile.
export function surveyTip(state, tile) {
  const out = [];
  for (const r of rumoursOf(state)) {
    if (state.grid.distance(r.center, tile) > r.radius) continue;
    out.push(`👂 Rumour (day ${Math.floor(r.hour / 24) + 1}): ${rumourLine(r)} Somewhere in this circle; fades in ${Math.max(1, Math.ceil((r.expires - state.hour) / 24))} days. A survey centred inside it: ×${SURVEY.rumour} odds for it.`);
  }
  for (const p of state.parties) {
    if (p.owner !== "player" || !sweeping(p) || state.grid.distance(p.task.center, tile) > p.task.radius) continue;
    out.push(`🔭 ${teamName(state, p)}: ${sweepStatus(state, p)}.`);
  }
  return out;
}
export const _internal = { isNightAt, teamFactors, candidates };
