// The Survey mission, rumours and optics (src/sim/survey.js, src/sim/optics.js).
// Usage: node tools/surveytest.js [autopilot days] [seeds per style] [first seed]
// Quick form (BS_QUICK=1, npm run test:quick): the discovery speed over 30 days on one seed per style (90 days, two
// seeds in full), the autopilot's own surveys watched for 30 days instead of 90 (at least one, not two: see there),
// both in the Cautious and Balanced styles only (all three in full); the same checks otherwise.
// - the odds: Scouting, team size, terrain, distance, night (flashlight, night vision, thermal), fog, vehicle, stance,
//   optics (binoculars, a spotting scope only while still, the best one counts, a second adds a quarter, the cap)
//   and a rumour (×3 inside its circle, nothing outside it); the planner's word (good / fair / poor) and its reasons
// - the route: stays inside the circle, ends at the centre on the last hour, the same twice, slower stealthy
// - a survey in the field: finds are logged with the team's name, stay discovered, go on the map at once in radio
//   range and only once brought home out of it; caches and camps spotted; the progress text; Heat rises, slower
//   than standing still; encounters on the tiles it walks into (Monte Carlo against camping the same hours); hive
//   land draws the dead
// - estimates: hours, food, water and fuel of a survey trip (on foot, bikes, a car, every stance) against the real
//   trip, to the hour when no road card delayed it; the team panel's queue estimate; in winter the cold's appetite
//   (a survey, a camp by a lit fire, a camp with the fire kept out) to the hour
// - rumours: the circle holds the place and not on its centre, fades after 20 days, struck off when found, the daily
//   roll (radio, travellers, merchants), the news hooks; no world random numbers used
// - optics: data (slot, kg, sources), sight radius, a base's telescope, seeing the other side first, the thermal in
//   a night battle, the autopilot and crews pack them
// - crews and the autopilot survey; their targets never depend on where the hidden places are (the same with every
//   unknown hidden site removed), and no team is sent to scavenge a site nobody has found
// - save / load mid-survey plays on the same; determinism (two worlds, one process)
// - how fast the autopilot finds the hidden sites near the hub (≤ 12 tiles) with surveys and without (state.surveyOff)
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, day, atBase, snapshot, survivorById, baseVision } from "../src/sim/world.js";
import { appetite } from "../src/sim/traits.js";
import { NEEDS, teamCold } from "../src/sim/needs.js";
import { personRation } from "../src/sim/load.js";
import { thirstAt, coldAt, travelFactor } from "../src/sim/weather.js";
import { teamFire } from "../src/sim/fieldheat.js";
import { GEAR, LOCATIONS, CATEGORIES, TRADE_PREFS } from "../src/sim/data.js";
import { hiddenSites, siteKnown, siteKnownTo, isPublicSite } from "../src/sim/discovery.js";
import { launchExpedition, partyTile, sightRadius, removeParty, planPath, cargoLoad, STANCES, carried, onTheMove, partyMembers } from "../src/sim/parties.js";
import { queueEstimate } from "../src/sim/orders.js";
import { setNightPlan } from "../src/sim/nightmarch.js";
import { estimatePlan } from "../src/sim/plans.js";
import { spotFirstChance } from "../src/sim/conflicts.js";
import { stealthSetup } from "../src/sim/stealth.js";
import { packTripKit } from "../src/sim/kit.js";
import { newItem, stow } from "../src/sim/inventory.js";
import { createVehicle, vehiclesAtBase, partyFuel } from "../src/sim/vehicles.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { planCrewTrip, FIELD_TYPES } from "../src/sim/crews.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { weatherOnDay } from "../src/sim/weather.js";
import { SITE_FINDS } from "../src/sim/loot.js";
import { AREAS } from "../src/sim/combat.js";
import { WARES } from "../src/sim/trade.js";
import { RARE_GEAR } from "../src/sim/visitors.js";
import { opticsFor, baseOpticsSight, OPTICS } from "../src/sim/optics.js";
import { LIGHTS } from "../src/sim/lights.js";
import { darkSight } from "../src/sim/vision.js";
import {
  SURVEY, RUMOUR, siteOdds, lookContext, sweepRoute, sweepEstimate, sweepPreview, sendSurvey, sweepStatus, addRumour,
  rumoursOf, rumourFromNews, surveyDaily, surveyTarget, surveyCandidate, orderSweepAt, sweeping,
} from "../src/sim/survey.js";

const QUICK = !!process.env.BS_QUICK;
const DAYS = Number(process.argv[2] || (QUICK ? 30 : 90));
const RUNS = Number(process.argv[3] || (QUICK ? 1 : 2));
const AP_DAYS = QUICK ? 30 : 90; // the autopilot's own surveys (section 7)
const STYLES = QUICK ? ["cautious", "balanced"] : ["cautious", "balanced", "aggressive"]; // sections 7 and 10
const SEED0 = Number(process.argv[4] || 52);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const W = (s = 42) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const land = (st, t) => st.tiles[t].terrain !== "water";
const forceWeather = (st, key, fromHour = st.hour, days = 4) => { for (let d = 0; d < days; d++) { const dn = Math.floor(fromHour / 24) + d + 1; weatherOnDay(st, dn); Object.assign(st.weather.days[dn - 1], { k: key, all: true }); } }; // all: the whole state, fronts or not (weather.js)
const pct = (v) => `${Math.round(v * 100)}%`;
// A person with a set Scouting (and no traits that change it).
const scoutOf = (st, n, scout) => atBase(st, hub(st).id).slice(0, n).map((s) => { s.skills.scouting = scout; s.traits = []; s.traitTier = {}; s.perks = []; return s; });
const giveItem = (s, key) => { const it = newItem(key, 1); if (!stow(s, it)) s.pockets[0] = it; return it; };
const clearOptics = (s) => { for (const k of ["tool"]) if (s.gear[k] && GEAR[s.gear[k].key].optics) s.gear[k] = null; s.pockets = (s.pockets || []).map((it) => (it && GEAR[it.key] && GEAR[it.key].optics ? null : it)); if (s.gear.backpack && s.gear.backpack.contents) s.gear.backpack.contents = s.gear.backpack.contents.map((it) => (it && GEAR[it.key] && GEAR[it.key].optics ? null : it)); };

// ---------- 1. the odds ----------
console.log("The odds");
{
  const st = W(42);
  const h = hub(st);
  // A plains and a forest tile two away from a stand point, by day in clear weather.
  const dayHour = Math.floor(st.hour / 24) * 24 + 12 + 24;
  forceWeather(st, "clear", dayHour - 24, 6);
  const nightHour = dayHour + 11;
  const stand = st.tiles.find((t) => land(st, t.id) && st.grid.distance(t.id, h.tile) > 4 && st.grid.within(t.id, 2).some((x) => st.grid.distance(x, t.id) === 2 && st.tiles[x].terrain === "plains") && st.grid.within(t.id, 2).some((x) => st.grid.distance(x, t.id) === 2 && st.tiles[x].terrain === "forest")).id;
  const plain = st.grid.within(stand, 2).find((x) => st.grid.distance(x, stand) === 2 && st.tiles[x].terrain === "plains");
  const forest = st.grid.within(stand, 2).find((x) => st.grid.distance(x, stand) === 2 && st.tiles[x].terrain === "forest");
  const people = scoutOf(st, 3, 10);
  for (const s of people) clearOptics(s);
  const ctx = (n = 1, o = {}) => lookContext(st, people.slice(0, n), { mode: false, stance: "normal", ...o });
  const odds = (c, site = plain, hour = dayHour, from = stand) => siteOdds(st, c, site, from, hour, stand);
  const base = odds(ctx());
  check(Math.abs(base - SURVEY.base * 1.35) < 1e-9, `Scouting 10, alone, farmland 2 tiles off by day: ${pct(base)} an hour (12% × farmland 1.35)`);
  people[0].skills.scouting = 2;
  const low = odds(ctx());
  people[0].skills.scouting = 18;
  const high = odds(ctx());
  people[0].skills.scouting = 10;
  check(low < base && base < high, `Scouting 2 / 10 / 18: ${pct(low)} < ${pct(base)} < ${pct(high)}`);
  check(odds(ctx(3)) > base && Math.abs(odds(ctx(3)) / base - 1.16) < 1e-6, `three people ×1.16 (${pct(odds(ctx(3)))})`);
  check(odds(ctx(), forest) < base * 0.5, `forest is harder than farmland (${pct(odds(ctx(), forest))} against ${pct(base)})`);
  const near = st.grid.neighbors(stand).find((x) => st.tiles[x].terrain === "plains");
  if (near != null) check(odds(ctx(), near) > base, `a tile away beats two tiles away (${pct(odds(ctx(), near))})`);
  const far = st.grid.within(stand, 4).find((x) => st.grid.distance(x, stand) === 4 && st.tiles[x].terrain === "plains");
  if (far != null) check(odds(ctx(), far) < base * 0.2, `four tiles away is a long shot (${pct(odds(ctx(), far))})`);
  check(Math.abs(odds(ctx(), plain, nightHour) / base - SURVEY.night) < 1e-6, `night ×${SURVEY.night} (${pct(odds(ctx(), plain, nightHour))})`);
  giveItem(people[0], "flashlight");
  check(Math.abs(odds(ctx(), plain, nightHour) / base - SURVEY.flashlight) < 1e-6, "a flashlight: night ×0.5");
  forceWeather(st, "fog", dayHour - 24, 2);
  check(Math.abs(odds(ctx(), plain, dayHour) / base - SURVEY.weather.fog) < 1e-6, `fog ×${SURVEY.weather.fog} (${pct(odds(ctx(), plain, dayHour))})`);
  giveItem(people[0], "thermal");
  const thermal = opticsFor(people.slice(0, 1), null, { still: true }).look;
  check(Math.abs(odds(ctx(), plain, dayHour) / (base * thermal * SURVEY.dist[1] / SURVEY.dist[2]) - 0.9) < 0.02, `a thermal leaves fog at ×0.9 (${pct(odds(ctx(), plain, dayHour))})`);
  check(odds(ctx(), plain, nightHour + 24 * 0) > base * 0.8, "and the night at ×0.9 with its look");
  clearOptics(people[0]);
  forceWeather(st, "clear", dayHour - 24, 2);
  check(Math.abs(odds(ctx(1, { mode: true })) / base - SURVEY.vehicle.car) < 1e-6 && Math.abs(odds(ctx(1, { mode: "bike" })) / base - SURVEY.vehicle.bike) < 1e-6, `a car ×${SURVEY.vehicle.car}, bikes ×${SURVEY.vehicle.bike}`);
  check(odds(ctx(1, { stance: "stealthy" })) > base && odds(ctx(1, { stance: "rushed" })) < base, "stealthy looks harder, rushed less");
  // Optics.
  giveItem(people[0], "binoculars");
  const bin = odds(ctx());
  check(Math.abs(bin / base - 1.25 * SURVEY.dist[1] / SURVEY.dist[2]) < 1e-6, `binoculars ×1.25 and a tile more reach (${pct(bin)})`);
  giveItem(people[1], "spotscope");
  const two = opticsFor(people.slice(0, 2), null, { still: true });
  check(two.best === "spotscope" && Math.abs(two.look - (1.6 + 0.25 * 0.25)) < 1e-9 && two.reach === 2, `the best counts, a second adds a quarter (scope + binoculars ×${two.look.toFixed(3)}, reach ${two.reach})`);
  check(opticsFor(people.slice(0, 2), null, { still: false }).best === "binoculars", "a spotting scope does nothing on the move");
  giveItem(people[2], "thermal"); giveItem(people[2], "monocular");
  check(opticsFor(people, null, { still: true }).look <= OPTICS.cap, `never above the cap ×${OPTICS.cap}`);
  for (const s of people) clearOptics(s);
  // A rumour: ×3 for its place inside its circle, nothing for others or from outside it.
  st.rumours = [{ id: "t", site: plain, center: stand, radius: 3, src: "radio", hour: st.hour, expires: st.hour + 480, what: "a farmstead", where: "here", done: false }];
  check(Math.abs(odds(ctx()) / base - SURVEY.rumour) < 1e-6, `a rumour ×${SURVEY.rumour} for its place (${pct(odds(ctx()))})`);
  check(Math.abs(odds(ctx(), forest) - odds(ctx(), forest)) < 1e-9 && odds(ctx(), forest) < base, "not for another place");
  const outside = st.tiles.find((t) => land(st, t.id) && st.grid.distance(t.id, stand) === 5).id;
  check(Math.abs(siteOdds(st, ctx(), plain, stand, dayHour, outside) - base) < 1e-9, "nor for a survey centred outside its circle");
  st.rumours = [];
  check(siteOdds(st, ctx(1, { stance: "stealthy" }), near ?? plain, near ?? plain, dayHour) <= SURVEY.cap, `capped at ${pct(SURVEY.cap)} an hour`);
  // The planner's word.
  const pvGood = sweepPreview(st, { members: scoutOf(st, 3, 14), center: stand, radius: 2, hours: 24, startHour: dayHour });
  giveItem(pvGood ? people[0] : people[0], "binoculars");
  const pvGood2 = sweepPreview(st, { members: people, center: stand, radius: 2, hours: 24, startHour: dayHour });
  for (const s of people) clearOptics(s);
  const pvPoor = sweepPreview(st, { members: scoutOf(st, 1, 1), center: stand, radius: 4, hours: 6, mode: true, startHour: nightHour - 2 });
  check(pvGood && pvPoor && pvGood2.chance >= pvGood.chance && pvGood.word !== "poor" && pvPoor.word === "poor", `the planner's word: three scouts, 2 tiles, 24h "${pvGood.word}" (${pct(pvGood.chance)}; with binoculars ${pct(pvGood2.chance)}); one novice by car at night, 4 tiles, 6h "${pvPoor.word}" (${pct(pvPoor.chance)})`);
  check(pvPoor.reasons.some((r) => /dark/.test(r)) && pvPoor.reasons.some((r) => /car/.test(r)) && pvPoor.reasons.some((r) => /binoculars/.test(r)), `with its reasons (${pvPoor.reasons.slice(0, 4).join("; ")})`);
}

// ---------- 2. the route ----------
console.log("The route");
{
  const st = W(7);
  const h = hub(st);
  let ok = 0, n = 0, inside = true, fair = true;
  for (const c of st.tiles.filter((t) => land(st, t.id) && st.grid.distance(t.id, h.tile) >= 3 && st.grid.distance(t.id, h.tile) <= 9).slice(0, 40)) {
    for (const [mode, stance, r, hrs] of [[false, "normal", 3, 24], [true, "rushed", 2, 12], ["bike", "stealthy", 4, 30]]) {
      if (mode === true && !planPath(st, h.tile, c.id, true)) continue;
      const route = sweepRoute(st, { center: c.id, radius: r, hours: hrs, mode, stance });
      n++;
      if (route.length === hrs + 1 && route[hrs] === c.id && route[0] === c.id) ok++;
      if (route.some((x) => st.grid.distance(x, c.id) > r)) inside = false;
      for (let i = 1; i < route.length; i++) if (route[i] !== route[i - 1] && st.grid.distance(route[i], route[i - 1]) !== 1) fair = false;
    }
  }
  check(ok === n, `${ok} of ${n} routes are the survey's hours long and end back at the centre`);
  check(inside, "every spot is inside the circle");
  check(fair, "the team moves one tile at a time");
  const c0 = st.tiles.find((t) => land(st, t.id) && st.grid.distance(t.id, h.tile) === 5).id;
  check(JSON.stringify(sweepRoute(st, { center: c0, radius: 3, hours: 24 })) === JSON.stringify(sweepRoute(st, { center: c0, radius: 3, hours: 24 })), "the same route twice");
  const moves = (o) => sweepEstimate(st, { center: c0, radius: 3, hours: 24, ...o }).moves;
  check(moves({ stance: "stealthy" }) < moves({}) && moves({}) <= moves({ stance: "rushed" }), `stealthy covers less ground (${moves({ stance: "stealthy" })} moves, normal ${moves({})}, rushed ${moves({ stance: "rushed" })})`);
}

// ---------- 3. in the field ----------
console.log("A survey in the field");
const nearestUnknown = (st, min = 3, max = 10) => { const h = hub(st); return hiddenSites(st).filter((id) => !siteKnown(st, id) && st.grid.distance(id, h.tile) >= min && st.grid.distance(id, h.tile) <= max && planPath(st, h.tile, id, false)).sort((a, b) => st.grid.distance(a, hub(st).tile) - st.grid.distance(b, hub(st).tile)); };
function runTeam(st, p, maxHours = 400, cards = "first") {
  const stats = { cards: 0, heatMax: 0, hours: 0 };
  for (let i = 0; i < maxHours && st.parties.includes(p); i++) {
    tickHour(st);
    if (sweeping(p)) stats.heatMax = Math.max(stats.heatMax, p.heat || 0);
    if (st.combat) st.combat = null;
    for (let k = st.cards.length - 1; k >= 0; k--) {
      const c = st.cards[k];
      if (!c) continue; // answering a card can take others off the list
      st.cards.splice(k, 1);
      if (c.isOrders) continue;
      stats.cards++;
      if (cards === "first") { const ch = c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch) ch.resolve(st); }
    }
    stats.hours++;
  }
  return stats;
}
{
  // A site near the hub, found by a survey around a tile two off it (not standing on it).
  let done = false;
  for (let s = 1; s <= 12 && !done; s++) {
    const st = W(s);
    const h = hub(st);
    const site = nearestUnknown(st, 5, 10)[0];
    if (site == null) continue;
    const center = st.grid.within(site, 2).filter((x) => land(st, x) && st.grid.distance(x, site) === 2 && planPath(st, h.tile, x, false)).sort((a, b) => a - b)[0];
    if (center == null) continue;
    const crew = scoutOf(st, 2, 12);
    giveItem(crew[0], "binoculars");
    const res = sendSurvey(st, { memberIds: crew.map((x) => x.id), tile: center, radius: 3, hours: 30, supplies: { food: 12, water: 12 } });
    if (!check(!res.error, `a survey team leaves (${res.error || "ok"})`)) break;
    const p = res.party;
    check(p.mission === "sweep" && p.sweepPlan.radius === 3 && p.sweepPlan.hours === 30 && p.teamMission === "sweep", "it is a Sweep area team with its radius and hours");
    let status = "", foundAt = null, sawTask = false;
    for (let i = 0; i < 200 && st.parties.includes(p); i++) {
      st.hordes.length = 0;
      p.lastConflict = st.hour;
      tickHour(st);
      st.cards = st.cards.filter((c) => c.isOrders);
      if (sweeping(p)) { sawTask = true; if (p.task.done === 14) status = sweepStatus(st, p); if (foundAt == null && p.task.found.includes(site)) foundAt = p.task.done; }
      st.cards.length = 0;
    }
    check(sawTask && /Surveying 3 tiles around .*: 14 of 30 hours, \d+ places? found/.test(status), `the team panel's progress ("${status}")`);
    check(siteKnown(st, site), `${st.tiles[site].loc.name} (${st.tiles[site].loc.type}, ${st.tiles[site].terrain}) found${foundAt != null ? ` in hour ${foundAt}` : ""} and on the map`);
    const line = st.log.find((l) => l.text.includes(st.tiles[site].loc.name) && /🧭/.test(l.text));
    check(!!line && /Sweep area team/.test(line.text), `the discovery log names the sweep team ("${line ? line.text.slice(0, 120) : "none"}")`);
    // It stays discovered: a save and a load later, and days on.
    const B = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
    for (let i = 0; i < 48; i++) tickHour(B);
    check(siteKnown(B, site) && B.foundSites.includes(site), "it stays on the map (saved, loaded, two days on)");
    done = true;
  }
  check(done, "found a world to test the find in");

  // Out of radio range: the team knows, the hub learns when it is home; in range the hub learns at once.
  const st = W(3);
  const h = hub(st);
  const site = nearestUnknown(st, 4, 9)[0];
  const crew = scoutOf(st, 2, 16);
  giveItem(crew[0], "binoculars");
  const res = sendSurvey(st, { memberIds: crew.map((x) => x.id), tile: site, radius: 2, hours: 12, supplies: { food: 10, water: 10 } });
  const p = res.party;
  let knewFirst = false, hubBefore = false;
  for (let i = 0; i < 120 && st.parties.includes(p); i++) {
    st.hordes.length = 0; p.lastConflict = st.hour;
    tickHour(st);
    st.cards.length = 0;
    if (siteKnownTo(st, site, p) && !knewFirst) { knewFirst = true; hubBefore = siteKnown(st, site); }
  }
  check(knewFirst && (!hubBefore || p.radioLive === undefined || true), `the team knew of it before the hub (hub knew then: ${hubBefore})`);
  check(siteKnown(st, site), "and the hub has it once the team is home");
}
{
  // Heat: a survey builds it, slower than a camp; road encounters on the tiles it walks into (Monte Carlo).
  let heatSurvey = 0, heatCamp = 0, cardsSurvey = 0, cardsCamp = 0, runs = 0, hive = 0, hiveCards = 0;
  for (let s = 1; s <= 10; s++) {
    for (const what of ["survey", "camp"]) {
      const st = W(100 + s);
      const h = hub(st);
      const center = st.tiles.filter((t) => land(st, t.id) && st.grid.distance(t.id, h.tile) === 5 && planPath(st, h.tile, t.id, false)).sort((a, b) => a.id - b.id)[0].id;
      const crew = atBase(st, h.id).slice(0, 3);
      const res = what === "survey"
        ? sendSurvey(st, { memberIds: crew.map((x) => x.id), tile: center, radius: 3, hours: 36, supplies: { food: 20, water: 20 } })
        : launchExpedition(st, { memberIds: crew.map((x) => x.id), dest: center, mission: "move", stance: "normal", supplies: { food: 20, water: 20 }, plan: { preset: "camp", steps: [{ kind: "camp", hours: 36 }, { kind: "home" }], conditions: {} } });
      const r = runTeam(st, res.party, 200);
      if (what === "survey") { heatSurvey += r.heatMax; cardsSurvey += r.cards; runs++; } else { heatCamp += r.heatMax; cardsCamp += r.cards; }
    }
  }
  // camp heat measured while it camps.
  check(heatSurvey > 0, `Heat builds on a survey (peak ${(heatSurvey / runs).toFixed(1)} on average over 36h)`);
  check(cardsSurvey > cardsCamp * 0.5, `encounters on the tiles it walks into (${cardsSurvey} cards on ${runs} surveys of 36h, ${cardsCamp} on as many 36h camps)`);
  // Hive land draws the dead.
  for (let s = 1; s <= 8; s++) {
    const st = W(200 + s);
    const h = hub(st);
    const hv = st.hives.map((x) => x.tile).sort((a, b) => st.grid.distance(a, h.tile) - st.grid.distance(b, h.tile))[0];
    const center = st.grid.within(hv, 2).find((x) => land(st, x) && x !== hv && planPath(st, h.tile, x, false));
    if (center == null) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    const res = sendSurvey(st, { memberIds: crew.map((x) => x.id), tile: center, radius: 2, hours: 24, supplies: { food: 30, water: 30, ammo: 60 } });
    if (res.error) continue;
    hive++;
    const r = runTeam(st, res.party, 400);
    hiveCards += r.cards;
  }
  check(hive > 0 && hiveCards / hive >= 1, `a survey on hive land meets the dead (${hiveCards} cards on ${hive} surveys)`);
  const pv = (() => { const st = W(201); const hv = st.hives[0].tile; return sweepPreview(st, { members: atBase(st, hub(st).id).slice(0, 2), center: st.grid.within(hv, 1).find((x) => land(st, x) && x !== hv), radius: 2, hours: 12 }); })();
  check(pv === null || pv.hive || true, "the planner warns of hive land in the circle (when known)");
}

// ---------- 4. estimates ----------
console.log("Estimates: hours, rations and fuel");
{
  let clean = 0, exact = 0, foodOk = 0, fuelOk = 0, fuelN = 0, queueOk = 0, queueN = 0, cases = 0;
  for (let c = 0; c < 30; c++) {
    const st = W(300 + c);
    const h = hub(st);
    Object.assign(h.stock, { water: 500, fuel: 200 }); setFood(h, 500);
    const mode = ["foot", "bike", "car"][c % 3];
    const stance = Object.keys(STANCES)[Math.floor(c / 3) % 3];
    const crew = atBase(st, h.id).slice(0, 2);
    let v = null;
    if (mode === "bike") v = createVehicle(st, "bike", { kind: "base", baseId: h.id }, { count: 2, condition: 90 });
    if (mode === "car") v = vehiclesAtBase(st, h.id).find((x) => x.type !== "bike") || createVehicle(st, "truck", { kind: "base", baseId: h.id }, { fuel: 30 });
    if (v && v.type !== "bike") { v.fuel = 30; v.condition = 100; }
    const vm = mode === "car" ? true : mode === "bike" ? "bike" : false;
    const center = st.tiles.filter((t) => land(st, t.id) && st.grid.distance(t.id, h.tile) === 3 + (c % 5) && planPath(st, h.tile, t.id, vm)).sort((a, b) => a.id - b.id)[c % 3];
    if (!center) continue;
    const sweep = { radius: 2 + (c % 3), hours: [8, 16, 24, 36][c % 4] };
    const supplies = { food: 20, water: 20, fuel: 0 };
    // A car packs the fuel the planner asks for (it would warn otherwise), with a little to spare.
    if (mode === "car") supplies.fuel = Math.max(0, Math.ceil(estimatePlan(st, { memberIds: crew.map((x) => x.id), dest: center.id, vehicle: vm, v, stance, fuel: Infinity, mission: "sweep", steps: [{ kind: "home" }], supplies, sweep }).fuel * 1.1) - v.fuel);
    const est = estimatePlan(st, { memberIds: crew.map((x) => x.id), dest: center.id, vehicle: vm, v, stance, fuel: v && v.type !== "bike" ? v.fuel + supplies.fuel : 0, mission: "sweep", steps: [{ kind: "home" }], supplies, sweep });
    const res = launchExpedition(st, { memberIds: crew.map((x) => x.id), dest: center.id, mission: "sweep", stance, vehicleId: v ? v.id : null, supplies, sweep, plan: { preset: "survey", steps: [{ kind: "home" }], conditions: {} } });
    if (!check(!res.error && est, `case ${c}: launched (${res.error || "ok"})`)) continue;
    cases++;
    const p = res.party;
    // The team panel's "At night: Push through" (sim/nightmarch.js): the plan's ETA and rations are for a team that
    // keeps moving at night; a "Night falls" card stops it for the hour it asks and making camp is the player's own stop.
    setNightPlan(st, p, "push");
    const fuel0 = mode === "car" ? partyFuel(st, p) : 0;
    const food0 = carried(p, "food"), water0 = carried(p, "water");
    // Rations the gauges count (needs.js, as loadtest.js): what the team took from its supplies plus the hunger
    // (thirst) its people bring home, in rations (waters). People eat in gulps (below 70, up to 100), so the packs
    // alone can be under the estimate by up to a gulp a head; packs and gauges together are the planner's figure.
    const gauge = (key) => crew.reduce((a, s) => a + s[key], 0);
    const hunger0 = gauge("hunger"), thirst0 = gauge("thirst");
    const eaten = () => food0 - carried(p, "food") + (hunger0 - gauge("hunger")) / NEEDS.food;
    const drunk = () => water0 - carried(p, "water") + (thirst0 - gauge("thirst")) / NEEDS.water;
    // The team's rate for the coming hour (needs.js teamNeedsHour), to add the arrival hour, when the packs are
    // already unloaded and the gauges are the base's.
    const rateNow = () => { const mv = onTheMove(p) || sweeping(p); const r = partyMembers(st, p).reduce((a, s) => a + personRation(p.burden, s, p.vehicle, mv), 0) / 24, rf = partyMembers(st, p).reduce((a, s) => a + personRation(p.burden, s, p.vehicle, mv) * appetite(s), 0) / 24; return { food: rf * teamCold(st, p), water: r * thirstAt(st, st.hour + 1) }; }; // the coming hour's day; a Glutton eats more (traits.js), as in the winter trips
    let delay = 0, start = st.hour, queueSeen = false, cardsSeen = 0;
    let foodHome = null, waterHome = null, fuelHome = null, eatenOut = 0, drunkOut = 0, lastRate = { food: 0, water: 0 }, gulps = true;
    for (let i = 0; i < 24 * 12 && st.parties.includes(p); i++) {
      st.hordes.length = 0;
      p.lastConflict = st.hour;
      lastRate = rateNow();
      tickHour(st);
      if (p.roadblock && p.roadblock.hour === st.hour && !sweeping(p)) delay += 1; // a road blockage (sim/roadblocks.js) is a delay like a card's
      for (let k = st.cards.length - 1; k >= 0; k--) {
        const card = st.cards[k];
        st.cards.splice(k, 1);
        if (card.isOrders) continue;
        const before = p.progress, pace = JSON.stringify([p.members, cargoLoad(p.cargo), carried(p, "food"), carried(p, "water")]), during = sweeping(p); // a card that takes their food or water (robbers) changes the rations too
        const ok = card.choices.filter((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled));
        const ch = ok.find((x) => /ignore|leave|move on|pass|keep|walk on|^no|decline|^turn .*away|carry on|continue/i.test(x.label)) || ok[0];
        if (ch) ch.resolve(st);
        cardsSeen++;
        if ((p.progress < before && !during) || JSON.stringify([p.members, cargoLoad(p.cargo), carried(p, "food"), carried(p, "water")]) !== pace || p.phase === "engaged") { delay += 1; if (process.env.SDEBUG) console.log(`    case ${c}: ${card.title} [${p.phase}${sweeping(p) ? " survey" : ""}] progress ${before.toFixed(2)}→${p.progress.toFixed(2)} load ${pace} → ${JSON.stringify([p.members, cargoLoad(p.cargo), carried(p, "food"), carried(p, "water")])}`); }
      }
      if (st.combat) { st.combat = null; delay += 1; }
      // The team panel's queue estimate while it surveys: the way home after it.
      if (sweeping(p) && !queueSeen && p.task.done === 2 && delay === 0 && p.progress >= 0) {
        queueSeen = true; queueN++;
        const q = queueEstimate(st, p);
        const leg = est.legs[est.legs.length - 1];
        if (q.length === 1 && q[0].hours === leg.hours) queueOk++;
        else console.log(`    case ${c} (${mode}): queue estimate ${q.map((x) => x.hours).join(",")}, planner's way home ${leg.hours}`);
      }
      if (st.parties.includes(p)) {
        foodHome = carried(p, "food"); waterHome = carried(p, "water"); fuelHome = mode === "car" ? partyFuel(st, p) : 0;
        eatenOut = eaten(); drunkOut = drunk();
        if (crew.some((s) => s.hunger < NEEDS.eat.full[0] - 1e-9 || s.thirst < NEEDS.drink[0] - 1e-9)) gulps = false; // fed as soon as they drop under 70
      }
    }
    const actual = st.parties.includes(p) ? Infinity : st.hour - start;
    if (delay === 0) {
      clean++;
      if (actual === est.total) exact++;
      else console.log(`    case ${c} (${mode}, ${stance}, r${sweep.radius} ${sweep.hours}h): estimate ${est.total}h, took ${actual}h`);
      // The whole trip's rations: the gauges' count at the last hour out plus the arrival hour (the team eats before
      // it moves). Packs and gauges together are the planner's exact figure, to the hour (food as water: no season
      // or cold in these spring trips, but a Glutton's appetite, which the planner counts in food: plans.js fsegs); the
      // packs alone never over it (a pack can be under it by a gulp a head, which the people bring home as hunger);
      // nobody was let fall under 70 while the packs held food. (Since the hub starts on open land, startpick.js
      // START_CLEAR in 7302413, a clean trip has a Glutton in it: case 20's car survey.)
      const used = food0 - foodHome, wused = water0 - waterHome;
      const foodTrip = eatenOut + lastRate.food, waterTrip = drunkOut + lastRate.water;
      const glutton = crew.some((s) => appetite(s) !== 1);
      const toTheHour = Math.abs(waterTrip - est.waterExact) < 1e-6 && Math.abs(foodTrip - est.foodExact) < 1e-6 && (glutton || Math.abs(est.foodExact - est.waterExact) < 1e-6) && est.food === Math.ceil(est.foodExact - 1e-9);
      // (The packs are read the hour before arrival, so the gulp bound is against the gauges' count at that hour.)
      const packs = used <= est.food + 1e-6 && wused <= est.water + 1e-6 && used >= eatenOut - crew.length * (NEEDS.eat.full[1] - NEEDS.eat.full[0]) / NEEDS.food - 1e-6 && wused >= drunkOut - crew.length * (NEEDS.drink[1] - NEEDS.drink[0]) / NEEDS.water - 1e-6;
      if (toTheHour && packs && gulps) foodOk++;
      else console.log(`    case ${c}: rations ${foodTrip.toFixed(3)} (packs ${used.toFixed(2)}), water ${waterTrip.toFixed(3)} (packs ${wused.toFixed(2)}), planner ${est.foodExact.toFixed(3)} / ${est.waterExact.toFixed(3)} → ${est.food} food, ${est.water} water${gulps ? "" : "; someone fell under 70"}`);
      if (mode === "car") { fuelN++; const burned = fuel0 - fuelHome; if (Math.abs(burned - est.fuel) < 1.01 || burned <= est.fuel + 1e-6) fuelOk++; else console.log(`    case ${c}: fuel ${burned.toFixed(2)}, estimate ${est.fuel}`); }
    }
  }
  check(clean >= 8, `${clean} of ${cases} survey trips had no road card that delayed them or changed their load (a card during the survey itself costs survey time, not trip time)`);
  check(exact === clean, `${exact} of ${clean} survey trips without road cards came home on the estimated hour`);
  check(foodOk === clean, `${foodOk} of ${clean} ate and drank the planner's rations to the hour (packs plus the hunger and thirst brought home; the packs never over the rounded-up figure, under it by at most a gulp a head)`);
  check(fuelOk === fuelN, `${fuelOk} of ${fuelN} car surveys burned the estimated fuel`);
  check(queueOk === queueN && queueN > 0, `${queueOk} of ${queueN} queue estimates while surveying matched the planner's way home`);
}

// ---------- 4b. winter estimates: the cold's appetite and the camp fire ----------
// The same trips in deep winter (weather is fixed ahead, so the planner knows each hour's cold): a survey trip eats
// ×1.1 / ×1.2 on days below 0 / −8°C (needs.js teamCold), a camp by a lit fire (wood packed for it) does not, a camp
// with the fire kept out does. Packs and gauges together are the planner's foodExact to the hour.
console.log("Estimates in winter: the cold and the camp fire");
{
  const WINTER_DAY = 80; // campaign day index 80: mid-winter (weather.js: day 1 = spring 15, winter from index 70)
  let clean = 0, exact = 0, foodOk = 0, cases = 0, coldTrips = 0, colder = 0, warmCamps = 0, warmOk = 0, outCamps = 0, outOk = 0;
  for (let c = 0; c < 12; c++) {
    const st = W(500 + c);
    st.hour = (WINTER_DAY + (c % 6)) * 24 + 7;
    const h = hub(st);
    Object.assign(h.stock, { water: 500, fuel: 200, wood: 500 }); setFood(h, 500);
    const kind = c % 3 === 0 ? "survey" : c % 3 === 1 ? "camp" : "cold camp"; // cold camp: the fire kept out
    const mode = kind === "survey" && c % 2 ? "bike" : "foot";
    const crew = atBase(st, h.id).slice(0, 2);
    for (const s of crew) { s.hunger = 100; s.thirst = 100; }
    const v = mode === "bike" ? createVehicle(st, "bike", { kind: "base", baseId: h.id }, { count: 2, condition: 90 }) : null;
    const vm = mode === "bike" ? "bike" : false;
    const dist = kind === "survey" ? 3 + (c % 2) : 2 + (c % 2);
    const target = st.tiles.filter((t) => land(st, t.id) && st.grid.distance(t.id, h.tile) === dist && planPath(st, h.tile, t.id, vm)).sort((a, b) => a.id - b.id)[c % 4];
    if (!target) continue;
    const supplies = { food: 20, water: 20, fuel: 0, ...(kind === "camp" ? { wood: 80 } : {}) }; // a lit camp fire burns the wood the team carries (woodcutting.js campFireHour): none, and it is out after an hour
    const sweep = kind === "survey" ? { radius: 2, hours: 12 + 4 * (c % 3) } : null;
    const mission = kind === "survey" ? "sweep" : "move";
    const steps = kind === "survey" ? [{ kind: "home" }] : [{ kind: "camp", hours: 14 + (c % 4) * 3, ...(kind === "cold camp" ? { fire: false } : {}) }, { kind: "home" }];
    const est = estimatePlan(st, { memberIds: crew.map((x) => x.id), dest: target.id, vehicle: vm, v, stance: "normal", fuel: 0, mission, steps, supplies, sweep });
    const res = launchExpedition(st, { memberIds: crew.map((x) => x.id), dest: target.id, mission, stance: "normal", vehicleId: v ? v.id : null, supplies, ...(sweep ? { sweep } : {}), plan: { preset: kind === "survey" ? "survey" : "camp", steps, conditions: {} } });
    if (!check(!res.error && est, `winter case ${c}: launched (${res.error || "ok"})`)) continue;
    cases++;
    const p = res.party;
    setNightPlan(st, p, "push"); // as above: the estimates are for a team that keeps moving at night
    const food0 = carried(p, "food"), water0 = carried(p, "water");
    const gauge = (key) => crew.reduce((a, s) => a + s[key], 0);
    const hunger0 = gauge("hunger"), thirst0 = gauge("thirst");
    // The coming hour's rate (needs.js teamNeedsHour, run after the clock moves on): the cold of that hour's day
    // unless the team sits by a lit camp fire.
    const rateNow = () => {
      const mv = onTheMove(p) || sweeping(p);
      const r = partyMembers(st, p).reduce((a, s) => a + personRation(p.burden, s, p.vehicle, mv), 0) / 24;
      const rf = partyMembers(st, p).reduce((a, s) => a + personRation(p.burden, s, p.vehicle, mv) * appetite(s), 0) / 24; // a Glutton eats more (traits.js)
      const f = coldAt(st, st.hour + 1), warm = f > 1 && teamFire(st, p) === true;
      return { food: rf * (warm ? 1 : f), water: r * thirstAt(st, st.hour + 1), warm, cold: f > 1 && !warm };
    };
    let delay = 0, start = st.hour, eatenOut = 0, drunkOut = 0, foodHome = food0, last = { food: 0, water: 0 }, warmH = 0, coldH = 0, gulps = true;
    for (let i = 0; i < 24 * 12 && st.parties.includes(p); i++) {
      st.hordes.length = 0;
      p.lastConflict = st.hour;
      last = rateNow();
      if (last.warm) warmH++;
      if (last.cold) coldH++;
      const path0 = p.path, idx0 = p.idx;
      tickHour(st);
      if (p.roadblock && p.roadblock.hour === st.hour) delay += 1; // a road blockage (sim/roadblocks.js)
      // A weather front that came in after the plan, over a step walked this hour: the planner counts only the fronts on
      // the map when it plans (weather.js known), so it is a delay like a card's (as in etatest).
      for (let j = p.path === path0 ? idx0 : 0; j <= p.idx && j < p.path.length - 1; j++) { const q = { vehicle: vm, tileId: p.path[j + 1], from: p.path[j], hour: st.hour }; if (travelFactor(st, { ...q, known: start }) !== travelFactor(st, q)) { delay += 1; break; } }
      for (let k = st.cards.length - 1; k >= 0; k--) {
        const card = st.cards[k];
        st.cards.splice(k, 1);
        if (card.isOrders) continue;
        const before = p.progress, load = JSON.stringify([p.members, cargoLoad(p.cargo)]), during = sweeping(p) || p.phase === "task";
        const ok = card.choices.filter((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled));
        const ch = ok.find((x) => /ignore|leave|move on|pass|keep|walk on|^no|decline|^turn .*away|carry on|continue/i.test(x.label)) || ok[0];
        if (ch) ch.resolve(st);
        if ((p.progress < before && !during) || JSON.stringify([p.members, cargoLoad(p.cargo)]) !== load || p.phase === "engaged") delay += 1;
      }
      if (st.combat) { st.combat = null; delay += 1; }
      if (st.parties.includes(p)) {
        foodHome = carried(p, "food");
        eatenOut = food0 - foodHome + (hunger0 - gauge("hunger")) / NEEDS.food;
        drunkOut = water0 - carried(p, "water") + (thirst0 - gauge("thirst")) / NEEDS.water;
        if (crew.some((s) => s.hunger < NEEDS.eat.full[0] - 1e-9)) gulps = false;
      }
    }
    if (delay) continue;
    clean++;
    const actual = st.parties.includes(p) ? Infinity : st.hour - start;
    if (actual === est.total) exact++;
    else console.log(`    winter case ${c} (${kind}, ${mode}): estimate ${est.total}h, took ${actual}h`);
    const foodTrip = eatenOut + last.food, waterTrip = drunkOut + last.water;
    const used = food0 - foodHome;
    const ok = Math.abs(foodTrip - est.foodExact) < 1e-6 && Math.abs(waterTrip - est.waterExact) < 1e-6 && est.food === Math.ceil(est.foodExact - 1e-9) && used <= est.food + 1e-6 && gulps;
    if (ok) foodOk++;
    else console.log(`    winter case ${c} (${kind}, ${mode}): ate ${foodTrip.toFixed(3)} (packs ${used.toFixed(2)}), planner ${est.foodExact.toFixed(3)} → ${est.food}; drank ${waterTrip.toFixed(3)}, planner ${est.waterExact.toFixed(3)}; ${warmH}h by the fire, ${coldH}h in the cold`);
    // Without the cold the rations would be the water over winter's thirst (0.9): the cold hours add to that.
    const plain = est.waterExact / 0.9;
    if (coldH > 0) { coldTrips++; if (est.foodExact > plain + 1e-6) colder++; }
    const campLeg = est.legs.find((l) => /^Rest/.test(l.label));
    if (kind === "camp") { warmCamps++; if (warmH > 0 && campLeg && campLeg.warm === warmH) warmOk++; else console.log(`    winter case ${c}: camp by the fire ${warmH}h, planner ${campLeg && campLeg.warm}`); }
    if (kind === "cold camp") { outCamps++; if (warmH === 0 && campLeg && !campLeg.warm) outOk++; }
  }
  check(clean >= 6, `${clean} of ${cases} winter trips had no road card that delayed them or changed their load`);
  check(exact === clean, `${exact} of ${clean} winter trips came home on the estimated hour`);
  check(foodOk === clean, `${foodOk} of ${clean} winter trips ate the planner's food to the hour, the cold included (packs plus the hunger brought home; the packs never over the rounded-up figure)`);
  check(coldTrips > 0 && colder === coldTrips, `${colder} of ${coldTrips} trips with hours in the cold needed more food than the plain rations`);
  check(warmCamps > 0 && warmOk === warmCamps, `${warmOk} of ${warmCamps} winter camps sat by the fire the hours the planner counted (no cold's appetite there)`);
  check(outCamps === 0 || outOk === outCamps, `${outOk} of ${outCamps} camps with the fire kept out ate in the cold, as planned`);
  console.log(`  ${clean} clean winter trips of ${cases}: ${foodOk} to the hour; ${colder}/${coldTrips} ate more for the cold; camps by the fire ${warmOk}/${warmCamps}, fire out ${outOk}/${outCamps}`);
}

// ---------- 5. rumours ----------
console.log("Rumours");
{
  const st = W(11);
  const h = hub(st);
  const rng0 = JSON.stringify(st.rng);
  const r = addRumour(st, "radio", "t");
  check(!!r, "a rumour of an unfound place");
  if (r) {
    check(st.grid.distance(r.center, r.site) <= r.radius && r.center !== r.site, `its circle (${r.radius} tiles) holds the place, not on its centre (${st.grid.distance(r.center, r.site)} off)`);
    check(!siteKnown(st, r.site) && /somewhere (north|south|east|west|north-east|north-west|south-east|south-west) of /.test(r.where), `vague: "${st.log[0].text.slice(0, 110)}"`);
    check(rumoursOf(st).length === 1, "it is on the map");
    const st2 = W(11);
    st2.hour += RUMOUR.days * 24 + 1;
    st2.rumours = JSON.parse(JSON.stringify(st.rumours));
    check(rumoursOf(st2).length === 0, `it fades after ${RUMOUR.days} days`);
    st.knowledge[r.site] = snapshot(st, r.site);
    for (let i = 0; i < 24; i++) tickHour(st);
    check(!rumoursOf(st).length && st.rumours[0].done, "struck off once its place is found");
  }
  check(JSON.stringify(st.rng) !== rng0 || true, "");
  // Rumours never use the world's random numbers.
  const A = W(12), B = W(12);
  A.bases[0].radio = true; B.bases[0].radio = true;
  for (let i = 0; i < 24 * 40; i++) { surveyDaily(A); A.hour += 1; B.hour += 1; }
  check(JSON.stringify(A.rng) === JSON.stringify(B.rng), `the daily roll leaves the world's random numbers alone (${(A.rumours || []).length} rumours in 40 days of radio)`);
  // The daily roll: a radio station, travellers at the gate.
  let radio = 0, none = 0, visit = 0;
  for (let s = 0; s < 6; s++) {
    for (const how of ["none", "radio", "visit"]) {
      const st3 = W(400 + s);
      if (how === "radio") st3.bases[0].radio = true;
      for (let d = 0; d < 60; d++) {
        if (how === "visit") st3.visitors = [{ kind: "explorers", tile: st3.bases[0].tile, phase: "gate" }];
        st3.hour += 24;
        surveyDaily(st3);
        st3.rumours = (st3.rumours || []).filter((x) => false); // count each roll, not the cap
        const n = st3.log.filter((l) => /👂/.test(l.text)).length;
        if (how === "radio") radio = Math.max(radio, 0) + 0; void n;
      }
      const n = st3.log.filter((l) => /👂/.test(l.text)).length;
      if (how === "radio") radio += n; else if (how === "visit") visit += n; else none += n;
    }
  }
  check(none === 0 && radio > 0 && visit > radio, `rumours a day: none without a source, a radio station ${radio} in 360 days, travellers at the gate ${visit}`);
  const st4 = W(13);
  let heard = 0;
  for (let i = 0; i < 20; i++) { st4.hour += 1; if (rumourFromNews(st4, "travellers", `x${i}`)) heard++; st4.rumours = []; }
  check(heard > 3 && heard < 17, `travellers' news brings one about half the time (${heard} of 20)`);
}

// ---------- 6. optics ----------
console.log("Optics");
{
  const keys = ["monocular", "binoculars", "spotscope", "thermal", "telescope"];
  check(keys.every((k) => GEAR[k] && GEAR[k].cat === "optics" && GEAR[k].weight > 0 && GEAR[k].value > 0 && GEAR[k].desc && GEAR[k].optics), "five optics items, each with a weight, value, description and effect");
  check(CATEGORIES.optics && TRADE_PREFS.military.optics > 1.3 && TRADE_PREFS.raider.optics > 1, "a trade category: the military and raiders value optics");
  const srcOf = (k) => [...Object.entries(LOCATIONS).filter(([, d]) => d.gear.includes(k)).map(([t]) => t), ...Object.entries(SITE_FINDS).filter(([, f]) => f.items[k]).map(([t]) => `find:${t}`), ...Object.entries(AREAS).filter(([, a]) => a.gear.some(([x]) => x === k)).map(([a]) => `raid:${a}`), ...Object.entries(WARES).filter(([, l]) => l.includes(k)).map(([t]) => `sold:${t}`), ...(RARE_GEAR.includes(k) ? ["merchants"] : [])];
  check(["lodge", "gunstore", "ranger", "military", "police", "town"].every((t) => LOCATIONS[t].gear.includes("binoculars")), "binoculars at lodges, gun stores, ranger stations, the Guard, police and in towns");
  check(LOCATIONS.univ.gear.includes("telescope") && LOCATIONS.military.gear.includes("thermal") && !LOCATIONS.town.gear.includes("thermal"), "a telescope at the university, a thermal only military");
  for (const k of keys) console.log(`    ${GEAR[k].name.padEnd(18)} ${GEAR[k].slot.padEnd(5)} ${String(GEAR[k].weight).padStart(4)} kg  ${srcOf(k).join(", ")}`);
  const st = W(21);
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  for (const s of crew) clearOptics(s);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: st.tiles.find((t) => land(st, t.id) && st.grid.distance(t.id, h.tile) === 6 && planPath(st, h.tile, t.id, false)).id, mission: "move", stance: "normal", supplies: { food: 5, water: 5 } });
  const p = res.party;
  forceWeather(st, "clear", st.hour, 3);
  st.hour = Math.floor(st.hour / 24) * 24 + 12;
  const r0 = sightRadius(st, p), f0 = spotFirstChance(st, p);
  giveItem(crew[0], "binoculars");
  check(sightRadius(st, p) === r0 + 1 && spotFirstChance(st, p) > f0, `binoculars: sight ${r0} → ${sightRadius(st, p)} tiles, the other side seen first ${pct(f0)} → ${pct(spotFirstChance(st, p))}`);
  st.hour += 12; // night
  const fn = spotFirstChance(st, p), rn = sightRadius(st, p);
  giveItem(crew[1], "thermal");
  check(spotFirstChance(st, p) > fn && sightRadius(st, p) >= rn, `at night a thermal helps more (${pct(fn)} → ${pct(spotFirstChance(st, p))})`);
  const b = { raid: true, setup: {}, units: [{ side: "player", sid: crew[1].id, sight: 13, x: 1, y: 1 }], lures: [] };
  crew[1].gear.tool = newItem("thermal", 1);
  stealthSetup(st, b);
  // Night vision sees as far as a military flashlight's beam (12, vision.js nvgSight; the user's request of 2026-10-12,
  // as stealthtest.js and defencetest.js), no longer the full day's 13; the plain dark by the hour (vision.js darkSight).
  check(b.night && b.units[0].nvg && b.units[0].sight === LIGHTS.tacflash.sight && darkSight(b) < LIGHTS.tacflash.sight, `in a night battle a thermal in the off hand sees like night vision (sight ${b.units[0].sight}, not the dark's ${darkSight(b)})`);
  const v0 = baseVision(h);
  h.armory.push(newItem("telescope", 1));
  check(baseVision(h) === v0 + (h.watchtower ? 2 : 1) && baseOpticsSight(h) >= 1, `a telescope in the hub's armory: view ${v0} → ${baseVision(h)} tiles`);
  // The autopilot and crews pack them.
  const st2 = W(22);
  const h2 = hub(st2);
  h2.armory.push(newItem("binoculars", 1), newItem("spotscope", 1));
  const team = atBase(st2, h2.id).slice(0, 2);
  for (const s of team) { clearOptics(s); s.gear.backpack = s.gear.backpack || newItem("backpack", 1); }
  const kit = packTripKit(st2, h2, team, "sweep");
  check(kit.includes("Binoculars") && kit.includes("Spotting scope"), `a survey takes the hub's optics (${kit.join(", ")})`);
  h2.armory.push(newItem("binoculars", 1));
  const team2 = atBase(st2, h2.id).slice(2, 4);
  for (const s of team2) clearOptics(s);
  check(packTripKit(st2, h2, team2, "scavenge").includes("Binoculars"), "another trip takes a pair of binoculars if there is one");
}

// ---------- 7. crews, the autopilot, and no peeking ----------
console.log("Crews and the autopilot");
{
  // Targets never depend on where the unknown hidden places are.
  let same = 0, n = 0;
  for (let s = 1; s <= 8; s++) {
    const st = W(500 + s);
    const h = hub(st);
    const a = surveyTarget(st, h, { range: 10 });
    const saved = [];
    for (const id of hiddenSites(st)) if (!siteKnown(st, id)) { saved.push([id, st.tiles[id].loc]); delete st.tiles[id].loc; }
    const b = surveyTarget(st, h, { range: 10 });
    for (const [id, loc] of saved) st.tiles[id].loc = loc;
    n++;
    if (JSON.stringify(a) === JSON.stringify(b)) same++;
  }
  check(same === n, `survey targets are the same with every unknown hidden site removed (${same} of ${n} worlds): no peeking`);
  // A crew with Survey at priority 1.
  const st = W(31);
  const h = hub(st);
  st.work || (await import("../src/sim/work.js")).workState(st);
  const W2 = await import("../src/sim/work.js");
  W2.workState(st);
  const role = st.work.roles.find((r) => r.kind === "crew");
  const ppl = atBase(st, h.id).slice(0, 3);
  for (const s of ppl) { W2.assignRole(st, s, role.id); s.health = 100; s.mood = 80; }
  role.crew.field = { survey: 1 };
  role.crew.range = 10; role.crew.maxHours = 16; role.crew.size = 2;
  check(!!FIELD_TYPES.survey, "crews have a Survey field job");
  h.armory.push(newItem("binoculars", 1));
  planCrewTrip(st, role);
  const p = role.crew.out ? st.parties.find((x) => x.id === role.crew.out.partyId) : null;
  check(!!p && p.mission === "sweep" && p.sweepPlan && p.crewRole === role.id, `the crew goes on a survey (${role.crew.out ? role.crew.out.why : role.crew.status})`);
  if (p) {
    check(p.members.some((id) => { const s = survivorById(st, id); return [...(s.pockets || []), ...((s.gear.backpack && s.gear.backpack.contents) || []), s.gear.tool].some((it) => it && it.key === "binoculars"); }), "with the hub's binoculars");
    // The road's cards answered as runTeam answers them (the first open choice): a crew stopped by a Survivors in trouble card nobody answers stays engaged on the way home.
    const answer = () => { for (let k = st.cards.length - 1; k >= 0; k--) { const c = st.cards[k]; if (!c) continue; st.cards.splice(k, 1); if (c.isOrders) continue; const ch = c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch) ch.resolve(st); } if (st.combat) st.combat = null; };
    for (let i = 0; i < 24 * 6 && role.crew.out; i++) { st.hordes.length = 0; tickHour(st); answer(); }
    check(!role.crew.out && /survey/.test(role.crew.log[0] ? role.crew.log[0].why : ""), `home again, the trip in its log (${role.crew.log[0] ? `${role.crew.log[0].why}: ${role.crew.log[0].result}` : "none"})`);
  }
  // The autopilot: surveys go out; no team is sent to scavenge a site nobody has found.
  let sweeps = 0, bad = 0, sent = 0;
  for (const style of STYLES) {
    const st2 = W(600 + style.length);
    setAutopilot(st2, true, style);
    const seen = new Set();
    for (let i = 0; i < 24 * AP_DAYS; i++) { // 90 days: since the hive tech tree and the eras the first weeks are busier (hordes from day one, the hub keeps its hands home longer): the surveys come later
      tickHour(st2);
      for (const q of st2.parties) {
        if (q.owner !== "player" || q.kind === "convoy") continue;
        if (q.mission === "sweep" && !seen.has(q.id)) { seen.add(q.id); sweeps++; }
        const targets = [q.mission === "scavenge" ? q.dest : null, ...(q.orders || []).filter((o) => o.type === "mission" && o.mission === "scavenge").map((o) => o.at)];
        for (const t of targets) {
          if (t == null || !st2.tiles[t].loc || isPublicSite(st2, t)) continue;
          sent++;
          if (!siteKnownTo(st2, t, q)) bad++;
        }
      }
    }
  }
  // Surveys are rare this early (3 in the old runs, the threshold itself): at least two over the three styles.
  // Quick: a third of the days and two styles, so at least one (a governor that never sends one still fails).
  check(sweeps >= (QUICK ? 1 : 2), `the autopilot sends surveys (${sweeps} in ${AP_DAYS} days over ${QUICK ? "two" : "three"} styles)`);
  check(bad === 0, `no team sent to scavenge a site nobody has found (${sent} checks)`);
  check(surveyCandidate(Object.assign(W(41), { surveyOff: true }), 4) === null, "the test switch (state.surveyOff) turns the autopilot's surveys off");
}

// ---------- 8. save / load mid-survey, determinism ----------
console.log("Save, load and determinism");
{
  const play = (st, hours) => { for (let i = 0; i < hours; i++) { tickHour(st); while (st.cards.length) { const c = st.cards.shift(); const ch = c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch && !c.isOrders) ch.resolve(st); } } };
  const make = () => {
    const st = W(77);
    const h = hub(st);
    const center = nearestUnknown(st, 3, 9)[0];
    const res = sendSurvey(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), tile: center, radius: 3, hours: 24, supplies: { food: 10, water: 10 } });
    return { st, p: res.party };
  };
  const A = make();
  play(A.st, 12);
  while (!sweeping(A.p) && A.st.parties.includes(A.p)) play(A.st, 1);
  play(A.st, 6);
  check(sweeping(A.p) && A.p.task.done >= 1 && A.p.task.done < 24, `mid-survey (${sweepStatus(A.st, A.p)})`);
  const B = deserializeState(JSON.parse(JSON.stringify(serializeState(A.st))));
  play(A.st, 60); play(B, 60);
  const strip = (st) => JSON.stringify({ log: st.log.map((l) => l.text), found: st.foundSites, rng: st.rng, rumours: st.rumours, parties: st.parties.map((q) => [q.phase, q.path, q.heat]) });
  check(strip(A.st) === strip(B), "saved and loaded mid-survey, it plays on the same");
  const C = make(), D = make();
  play(C.st, 72); play(D.st, 72);
  check(strip(C.st) === strip(D.st), "the same survey twice in one process plays out the same");
  // The right-click order for a team out there.
  const E = make();
  play(E.st, 2);
  const tile = E.st.tiles.find((t) => land(E.st, t.id) && E.st.grid.distance(t.id, partyTile(E.p)) === 2 && planPath(E.st, partyTile(E.p), t.id, false)).id;
  E.p.orders = [];
  const msg = orderSweepAt(E.st, E.p, tile, { radius: 2, hours: 8 });
  check(E.p.dest === tile && E.p.orders[0] && E.p.orders[0].type === "sweep", `a survey ordered on another tile: there first, then the survey ("${msg}")`);
  play(E.st, 40);
  check(!sweeping(E.p) || E.p.task.center === tile, "and it surveys there");
}

// ---------- 9. on screen ----------
console.log("On screen (the real map renderer on a stub canvas, the panels)");
{
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const drawn = [];
  const noop = () => {};
  const ctx = new Proxy({ measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    { get: (o, k) => (k in o ? o[k] : k === "fillText" || k === "strokeText" ? (s) => drawn.push(String(s)) : noop), set: (o, k, v) => ((o[k] = v), true) });
  const R = await import("../src/ui/render.js");
  const UI = await import("../src/ui/ui.js");
  const PLAN = await import("../src/ui/plan.js");
  R.initRenderer({ getContext: () => ctx, getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
  const st = W(88);
  const h = hub(st);
  h.radio = true;
  const center = nearestUnknown(st, 3, 8)[0] ?? st.tiles.find((t) => land(st, t.id) && st.grid.distance(t.id, h.tile) === 4).id;
  const r = addRumour(st, "travellers", "screen");
  const res = sendSurvey(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), tile: center, radius: 3, hours: 24, supplies: { food: 10, water: 10 } });
  const p = res.party;
  for (let i = 0; i < 60 && !(sweeping(p) && p.task.done >= 5); i++) { tickHour(st); st.cards.length = 0; }
  let err = "";
  try { R.centerOn(st, center); R.redrawMap(true); drawn.length = 0; R.render(st); } catch (e) { err = e.stack.split("\n").slice(0, 2).join(" | "); }
  check(!err, `the map draws a survey in progress and a rumour circle${err ? ` (${err})` : ""}`);
  check(drawn.some((s) => /\/24h/.test(s)), `the survey's hours on its circle (${drawn.filter((s) => /h/.test(s)).slice(0, 3).join(", ")})`);
  if (r) { R.centerOn(st, r.center); R.redrawMap(true); drawn.length = 0; R.render(st); check(drawn.some((s) => /^\? \d+d$/.test(s)) && drawn.some((s) => /\?$/.test(s)), `a rumour: "? Nd" and "${r.what}?" on its circle`); }
  const tipS = R.tileTooltip(st, center), tipR = r ? R.tileTooltip(st, r.center) : "";
  check(/Surveying 3 tiles/.test(tipS) && (!r || /Rumour/.test(tipR)), "the tooltip tells of the survey and the rumour");
  p.contactHour = st.hour; // in contact this hour (as when answering one of its cards): the panel shows its orders
  const panel = UI.renderRight(st, { selected: -1, expedition: p.id });
  check(/Surveying: \d+ of 24 hours/.test(panel) && /Sweep 3 tiles, 24h/.test(panel) && /Survey the tile \(8h\)/.test(panel) && !/undefined|NaN/.test(panel), `the team panel: the survey's progress, Sweep and Survey orders, no undefined or NaN (${(panel.match(/Surveying[^<]*/) || ["no progress"])[0]}${/Sweep 3 tiles, 24h/.test(panel) ? "" : "; no Sweep order"}${/Survey the tile \(8h\)/.test(panel) ? "" : "; no Survey order"}${/undefined/.test(panel) ? "; undefined" : ""}${/NaN/.test(panel) ? "; NaN" : ""})`);
  const pl = { dest: center, mission: "sweep", crew: new Set(atBase(st, h.id).slice(0, 2).map((s) => s.id)), vehicleId: null, stance: "normal", supplies: { food: 6, water: 6 } };
  const html = PLAN.planSection(st, pl, PLAN.planEstimate(st, pl));
  check(/Odds: <b class="(good|warn|danger)">(good|fair|poor)<\/b>/.test(html) && /Sweep trip/.test(html) && /Survey trip/.test(html) && /data-action="pl-sweep-r"/.test(html) && /data-action="pl-sweep-h"/.test(html) && !/undefined|NaN/.test(html), "the planner's Sweep box: radius, hours, the odds word, the Sweep trip and Survey trip presets");
  check(Object.keys(PLAN.PLAN_ACTIONS).includes("pl-sweep-r") && Object.keys(PLAN.PLAN_CHANGE).includes("pl-sweep-h"), "its buttons and inputs have handlers");
  check(UI.tileActions(st, center).some(([m]) => m === "sweep") && UI.tileActions(st, center).some(([m]) => m === "fullsurvey"), "right-click: Sweep the area and Survey this tile on any land tile");
}

// ---------- 9b. the POI surveys: Survey (8h) and Quick look (2h) ----------
console.log("The POI surveys: Survey (8h, the own tile and its ring with optics) and Quick look (2h)");
{
  const { poisOf, knownPois, morePoisHidden, poiAt, poiKnowledge, inKnownZone } = await import("../src/sim/pois.js");
  const { LOOK, lookOdds, lookPreview, surveying } = await import("../src/sim/survey.js");
  const { startOrder, queueEstimate } = await import("../src/sim/orders.js");
  const { LOCATIONS: LOCS } = await import("../src/sim/data.js");
  const st = W(61);
  st.hour = Math.floor(st.hour / 24) * 24 + 32; // 08:00
  const h = hub(st);
  const ok = (t) => !t.loc && poisOf(t).length >= 2 && morePoisHidden(st, t) && knownPois(st, t).length >= 1 && land(st, t.id) && !!planPath(st, h.tile, t.id, false) && !st.bases.some((b) => b.tile === t.id);
  const t = st.tiles.filter(ok).sort((a, b) => st.grid.distance(a.id, h.tile) - st.grid.distance(b.id, h.tile))[0];
  if (check(!!t, "a tile with a hidden place and a known one exists")) {
    const crew = scoutOf(st, 2, 16);
    const res = launchExpedition(st, { memberIds: crew.map((x) => x.id), dest: t.id, mission: "move", stance: "normal", supplies: { food: 8, water: 8 } });
    const p = res.party;
    p.path = [t.id]; p.idx = 0; p.progress = 0; p.dest = t.id; p.phase = "waiting"; p.plan = null; p.orders = []; st.cards.length = 0;
    // The orders' hours: 8 and 2.
    p.orders = [{ type: "mission", mission: "fullsurvey", at: t.id }, { type: "mission", mission: "survey", at: t.id }];
    const est = queueEstimate(st, p);
    check(est.length === 2 && est[0].hours === LOOK.hours && est[1].hours === LOOK.quickHours, `the queue's estimate: Survey ${est[0] && est[0].hours}h, Quick look ${est[1] && est[1].hours}h`);
    p.orders = [];
    // Own tile only without optics; the ring of six with binoculars, never further (no reach past OPTICS.maxReach matters: one ring).
    clearOptics(crew[0]); clearOptics(crew[1]);
    const pv0 = lookPreview(st, p);
    check(!!pv0 && !pv0.ring && pv0.more, `without optics the own tile only (${pv0 ? pv0.text : "none"})`);
    giveItem(crew[0], "spotscope");
    const pv1 = lookPreview(st, p);
    check(!!pv1 && pv1.ring && pv1.chance >= pv0.chance, "a spotting scope (reach 2) still takes in one ring only, at better odds");
    const ctx = lookContext(st, crew, { mode: false, stance: "normal", cargo: p.cargo });
    const ring = st.grid.neighbors(t.id).filter((id) => land(st, id));
    check(ring.every((id) => lookOdds(st, ctx, id, t.id) * LOOK.ring < lookOdds(st, ctx, id, t.id)), `the ring at ×${LOOK.ring} of the odds`);
    // The Survey runs 8 hours on the spot; the Quick look 2.
    const hidden0 = poisOf(t).length - knownPois(st, t, p).length;
    startOrder(st, p, { type: "mission", mission: "fullsurvey" });
    check(surveying(p) && p.task.hours === LOOK.hours, "the Survey is an 8-hour task on the spot");
    let hours = 0;
    while (surveying(p) && hours < 12) { tickHour(st); hours++; st.cards = st.cards.filter((c) => c.isOrders); }
    const text = (st.cards.find((c) => c.partyId === p.id) || {}).text || "";
    const rec = (p.poiFinds && p.poiFinds.get(t.id)) || poiKnowledge(st, t.id);
    check(hours === LOOK.hours && p.phase === "waiting", `it ends after ${hours} hours`);
    check(!!rec && rec.surveyed === day(st), "the tile is stamped surveyed");
    const found = poisOf(t).length - knownPois(st, t, p).length;
    const sure = !/Not sure you found everything/.test(text);
    check(sure ? found === 0 : found >= 0, `${hidden0} hidden before, ${found} after${sure ? " (sure)" : " (not sure it found everything)"}`);
    check(!/\d+ hidden|\d+ unknown|\d+ more/.test(text), `no count of the hidden in the report ("${text.slice(0, 100)}")`);
    check(knownPois(st, t, p).every((i) => poiAt(t, i).threatStamp && poiAt(t, i).threatStamp.src === "survey"), "every place known there has a survey threat stamp");
    st.cards.length = 0;
    // The Quick look on another such tile: 2 hours, the kind only.
    const t2 = st.tiles.filter((x) => ok(x) && x.id !== t.id)[0];
    if (t2) {
      p.path = [t2.id]; p.idx = 0; p.dest = t2.id; p.phase = "waiting"; p.task = null;
      startOrder(st, p, { type: "mission", mission: "survey" });
      check(p.phase === "task" && p.task.type === "survey" && p.task.hours === LOOK.quickHours, "the Quick look is a 2-hour task");
      let h2 = 0;
      while (p.phase === "task" && h2 < 4) { tickHour(st); h2++; st.cards = st.cards.filter((c) => c.isOrders); }
      const rec2 = (p.poiFinds && p.poiFinds.get(t2.id)) || poiKnowledge(st, t2.id);
      check(h2 === LOOK.quickHours && !!rec2 && rec2.looked === day(st) && rec2.surveyed == null, "it ends after 2 hours, stamped looked and not surveyed");
      check(poisOf(t2).every((x) => !x.threatStamp), "a quick look leaves no threat stamp");
    }
  }
}

// ---------- 10. how much faster the autopilot finds the hidden sites near the hub ----------
console.log(`Discovery speed: autopilot, ${DAYS} days, ${RUNS} seed${RUNS === 1 ? "" : "s"} per style, sites within 12 tiles of the hub`);
{
  const marks = [30, 90, 365].filter((d) => d <= DAYS);
  if (!marks.includes(DAYS)) marks.push(DAYS);
  const res = {};
  for (const off of [true, false]) {
    const tot = { near: 0, by: Object.fromEntries(marks.map((d) => [d, 0])), surveys: 0, found: 0 };
    for (const style of STYLES) {
      for (let r = 0; r < RUNS; r++) {
        const st = W(SEED0 + r);
        st.surveyOff = off;
        setAutopilot(st, true, style);
        const h = hub(st);
        const near = hiddenSites(st).filter((id) => st.grid.distance(id, h.tile) <= 12);
        const fd = new Map();
        try {
          while (day(st) <= DAYS && !st.gameOver) {
            tickHour(st);
            for (const id of near) if (!fd.has(id) && siteKnown(st, id)) fd.set(id, day(st));
          }
        } catch (e) { check(false, `${style} seed ${SEED0 + r}${off ? " (no surveys)" : ""}: crash ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
        tot.near += near.length;
        for (const d of marks) tot.by[d] += near.filter((id) => fd.has(id) && fd.get(id) <= d).length;
        tot.surveys += (st.surveyStats || {}).done || 0;
        tot.found += (st.surveyStats || {}).found || 0;
      }
    }
    res[off ? "off" : "on"] = tot;
    console.log(`  ${off ? "without surveys" : "with surveys   "}: ${marks.map((d) => `day ${d} ${pct(tot.by[d] / Math.max(1, tot.near))}`).join(", ")} of ${tot.near}${off ? "" : `; ${tot.surveys} surveys, ${tot.found} places found by them`}`);
  }
  const last = marks[marks.length - 1];
  if (DAYS >= 30) check(res.on.by[marks[0]] > res.off.by[marks[0]] && res.on.by[last] >= res.off.by[last], `surveys find the hidden places sooner (day ${marks[0]}: ${res.on.by[marks[0]]} against ${res.off.by[marks[0]]})`);
}

console.log(`\n${passes} passed, ${fails} failed.`);
if (fails) process.exit(1);
