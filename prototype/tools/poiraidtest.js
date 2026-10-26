// The raid flow per point of interest and the POI surveys (src/sim/poiraid.js, src/sim/scavenge.js, src/sim/survey.js
// Survey and Quick look, src/sim/pois.js threat and visits).
// Usage: node tools/poiraidtest.js [seed] [autopilot days]
// - the dialogue: a scavenge on a tile with places asks which one (a card with a choice per known place only, the
//   crawl on a bare city block, "Not now"); with no place known the order is refused ("survey first"); the card and
//   the panels never say how many are hidden
// - the headless path: one place at a time (the best known by value × what is left / the perceived threat), its own
//   pool falls and the others' do not, the site POI's pool is tile.loot; a visit is recorded with a threat stamp;
//   a place picked clean sends the search on to the next known one, and the last one says so
// - threat: true threat (danger + infection + hive land), the estimate as a word with skulls that goes stale, "threat
//   unknown" before any look, a survey's stamp sharper than a visit's
// - the Survey (8h, the own tile; the ring with binoculars; one roll, failure rolls each place; stamps "surveyed" and
//   the threat of every place known) and the Quick look (2h, half the odds, the kind only, stamps "looked"): the odds
//   by day and night, farmland and forest; the orders' hours; Field Heat while surveying; determinism; a recon's look
// - another group's base tile: raiding a place there drops their goodwill and their guards hold it
// - a save keeps the stamps, the visits and a team's pick
// - the autopilot: [days] days without exceptions, POI surveys sent and places visited
// - on screen: the right-click actions, the dialogue's screen
import { createWorld, tickHour, hub, day, atBase, mergeKnowledge } from "../src/sim/world.js";
import { LOCATIONS } from "../src/sim/data.js";
import { launchExpedition, partyTile, orderOptions, planPath, partyMembers, giveOrder, PICKED_OVER } from "../src/sim/parties.js";
import { startOrder, tasksDue } from "../src/sim/orders.js";
import { stationaryActivity } from "../src/sim/fieldheat.js";
import { searchHour, extract, engagementParty } from "../src/sim/scavenge.js";
import { newItem, stow } from "../src/sim/inventory.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { isPublicSite } from "../src/sim/discovery.js";
import {
  poisOf, poiAt, knownPois, morePoisHidden, poiPool, poiKnowledge, poiThreat, poiThreatEstimate, poiThreatText, notePoiThreat, threatBand, THREAT,
  poiBand, poiBandName, POI_BANDS, poiFull, visitPoi, poiVisitText, bestKnownPoi, poiScore, isSitePoi, poiName, inKnownZone, raidingNow, poiEligible,
} from "../src/sim/pois.js";
import { buildingOptions } from "../src/sim/buildingmaps.js";
import { createRaid } from "../src/sim/combat.js";
import { poiTileRaid, scavengeProblem, pickedOverAt, poiPickWanted, poiPickFor, poiRows, poiPickCard, poiRaidSetup, poiPlace, poiRaidSummary, poiContainerNote } from "../src/sim/poiraid.js";
import { walkPace } from "../src/sim/poiwalk.js";
import { LOOK, lookOdds, lookContext, lookPreview, fullSurveyDone, quickLook, surveying, lookStatus, poiSurveyTarget, poiSurveyCandidate } from "../src/sim/survey.js";

const args = process.argv.slice(2);
const seed = Number(args[0] || 42);
const DAYS = Number(args[1] || 120);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const land = (st, id) => st.tiles[id].terrain !== "water";
// A team of n scouts standing on `tile` (sent from the hub, then put there: the trip itself is not the test).
function teamAt(st, tile, n = 2, scout = 14) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, n);
  for (const s of crew) { s.skills.scouting = scout; s.skills.scavenging = 6; s.traits = []; s.traitTier = {}; s.perks = []; }
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 10, water: 10 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.dest = tile; p.phase = "waiting"; p.plan = null; p.orders = [];
  st.cards.length = 0;
  return p;
}
const giveItem = (s, key) => { const it = newItem(key, 1); if (!stow(s, it)) s.pockets[0] = it; return it; };
// A tile's POI record: the team's own finds, or the hub's once the team reported (in radio range they go at once).
const recOf = (st, p, id) => (p.poiFinds && p.poiFinds.get(id)) || poiKnowledge(st, id);
const daylight = (st) => { st.hour = Math.floor(st.hour / 24) * 24 + 32; }; // 08:00 the next day
// Tiles by what they hold (reachable from the hub).
const reachable = (st, id) => land(st, id) && !!planPath(st, hub(st).tile, id, false) && !st.bases.some((b) => b.tile === id) && !st.factions.some((f) => f.bases.includes(id));
const bareAllKnown = (st, min = 2) => st.tiles.filter((t) => !t.loc && poisOf(t).length >= min && knownPois(st, t).length === poisOf(t).length && reachable(st, t.id)).sort((a, b) => st.grid.distance(a.id, hub(st).tile) - st.grid.distance(b.id, hub(st).tile));
const bareNoneKnown = (st) => st.tiles.filter((t) => !t.loc && poisOf(t).length >= 1 && knownPois(st, t).length === 0 && reachable(st, t.id)).sort((a, b) => st.grid.distance(a.id, hub(st).tile) - st.grid.distance(b.id, hub(st).tile));
const hiddenSome = (st, terrain = null) => st.tiles.filter((t) => !t.loc && (!terrain || t.terrain === terrain) && poisOf(t).length >= 2 && morePoisHidden(st, t) && knownPois(st, t).length >= 1 && reachable(st, t.id)).sort((a, b) => st.grid.distance(a.id, hub(st).tile) - st.grid.distance(b.id, hub(st).tile));
// Places rich enough for the pool's checks (0.4 or more full): a fifth of one is still above the picked-clean floor
// (pois.js poiLootBand: POI.STRIPPED + 0.02), and three hours' search (0.05 an hour) leave something in it. Since the hub
// starts on open land 5 tiles from the towns (startpick.js START_CLEAR, 7302413) the nearest tiles are forest sheds
// and hunting blinds (0.2 and 0.15 full).
const bareRich = (st) => bareAllKnown(st).filter((t) => poisOf(t).every((_, i) => poiFull(t, i) >= 0.4));
const siteWithExtras = (st) => st.tiles.filter((t) => t.loc && isPublicSite(st, t.id) && poisOf(t).length >= 2 && poisOf(t)[0].site && reachable(st, t.id) && !["city", "town"].includes(t.loc.type)).sort((a, b) => st.grid.distance(a.id, hub(st).tile) - st.grid.distance(b.id, hub(st).tile));
const multiSite = (st) => st.tiles.filter((t) => t.loc && isPublicSite(st, t.id) && poisOf(t).length && isSitePoi(t, 0) && buildingOptions(t) && reachable(st, t.id)).sort((a, b) => st.grid.distance(a.id, hub(st).tile) - st.grid.distance(b.id, hub(st).tile))[0];

// ---------- 1. the dialogue ----------
section("The dialogue: which place to raid");
{
  const st = W();
  const t = bareAllKnown(st)[0];
  check(!!t, "a bare tile with two or more known places exists near the hub");
  const p = teamAt(st, t.id);
  check(poiTileRaid(t) && scavengeProblem(st, p, t.id) === null, "a raid there goes into one of its places, and may start");
  const opt = orderOptions(st, p).find((o) => o.mission === "scavenge");
  check(!!opt && !opt.disabled, "Scavenge / raid is among the team's options");
  check(orderOptions(st, p).some((o) => o.mission === "fullsurvey") && orderOptions(st, p).some((o) => o.mission === "survey"), "Survey and Quick look are among them");
  // Nothing picks for the player in the browser: the card. Here the tools' switch stands in for the browser.
  check(!poiPickWanted(st, p, t.id), "headless, the pick is made for the team (no card)");
  st.poiPickAlways = true;
  check(poiPickWanted(st, p, t.id), "the browser (state.poiPickAlways here) asks which place");
  startOrder(st, p, { type: "mission", mission: "scavenge" });
  const card = st.cards.find((c) => c.poiPick && c.partyId === p.id);
  check(!!card && p.phase === "waiting", "the scavenge order raises the dialogue card and the team waits");
  if (card) {
    const known = knownPois(st, t, p);
    const picks = card.choices.filter((c) => c.poi != null);
    check(new Set(picks.map((c) => c.poi)).size === known.length && picks.every((c) => known.includes(c.poi)), `a choice for every known place (${picks.length})`);
    check(card.choices.some((c) => c.cancel), "and Not now");
    check(!/\d+ hidden|\d+ unknown/.test(card.text + picks.map((c) => c.hint).join(" ")), "no count of what is hidden");
    const rows = poiRows(st, p, t.id);
    check(rows.every((r) => r.visits === "never visited" && r.threatText === "threat unknown" && POI_BANDS.includes(r.bandName)), "never visited, threat unknown, a band each");
    // The pick: the second place; the team walks there (poiwalk.js), then the search opens on it.
    const choice = picks[1] || picks[0];
    choice.resolve(st);
    const w = p.task;
    check(p.phase === "task" && w && w.type === "poiwalk" && w.poi === choice.poi && w.mins >= walkPace(p).MIN && w.mins <= walkPace(p).MAX && !st.engagement, `picking a place starts the walk there first (${w && w.mins} min)`); // on foot 10-60 min since the walk went by pace (poiwalk.js walkPace, 95ab983)
    tasksDue(st, 1);
    const e = st.engagement;
    check(!!e && e.partyId === p.id && e.poi === choice.poi, `picking a place starts the search in it (place ${choice.poi})`);
    check(p.poi === undefined, "the pick is cleared once used");
    if (e) { e.approach = "normal"; st.engagement = null; }
  }
  st.cards.length = 0;
  // Not now: the team waits.
  if (st.parties.includes(p)) {
    p.phase = "waiting"; p.task = null;
    startOrder(st, p, { type: "mission", mission: "scavenge" });
    const c2 = st.cards.find((c) => c.poiPick && c.partyId === p.id);
    if (c2) { c2.choices.find((c) => c.cancel).resolve(st); check(p.phase === "waiting" && !st.engagement, "Not now leaves the team waiting"); }
  }
  // Nothing known: refused.
  const u = bareNoneKnown(st)[0];
  check(!!u, "a tile with places but none known exists");
  if (u) {
    const q = teamAt(st, u.id);
    const why = scavengeProblem(st, q, u.id);
    check(/survey first/i.test(why || ""), `nothing known there: "${why}"`);
    const o = orderOptions(st, q).find((x) => x.mission === "scavenge");
    check(!!o && /survey first/i.test(o.disabled || ""), "the option is there but disabled with the reason");
    startOrder(st, q, { type: "mission", mission: "scavenge" });
    check(!st.engagement && !st.cards.some((c) => c.poiPick), "the order is refused: no search, no dialogue");
    check(/no place known/.test(poiRaidSummary(st, u.id, q)) && /possibly more unknown/.test(poiRaidSummary(st, u.id, q)) && !/\d/.test(poiRaidSummary(st, u.id, q)), `the summary says no place known, possibly more unknown, never a count ("${poiRaidSummary(st, u.id, q)}")`);
  }
}

// ---------- 2. the headless path: one place at a time, its own pool ----------
section("The headless path: one place at a time");
{
  const st = W();
  const t = bareRich(st)[0];
  const p = teamAt(st, t.id, 3);
  const pools0 = poisOf(t).map((_, i) => poiPool(t, i));
  const best = bestKnownPoi(st, t, p);
  check(best >= 0 && poiScore(st, t, best) >= Math.max(...poisOf(t).map((_, i) => poiScore(st, t, i))), `the pick is the best known place by value × what is left / the threat (${best}: ${poiName(t, best)})`);
  startOrder(st, p, { type: "mission", mission: "scavenge" });
  const e = st.engagement;
  check(!!e && e.poi === best, "the search opens on it");
  if (e) {
    const poi = poiAt(t, best);
    check(poi.visits === 1 && poi.lastDay === day(st) && poi.threatStamp && poi.threatStamp.src === "visit", `a visit is recorded (${poiVisitText(st, t, best)}) with a threat stamp`);
    check(poiThreatText(st, t, best) !== "threat unknown" && /today/.test(poiThreatText(st, t, best)), `the threat is estimated now ("${poiThreatText(st, t, best)}")`);
    e.approach = "normal";
    for (let i = 0; i < 3; i++) { searchHour(st); tickHour(st); }
    const pools1 = poisOf(t).map((_, i) => poiPool(t, i));
    check(pools1[best] < pools0[best], `its pool falls (${pools0[best].toFixed(2)} → ${pools1[best].toFixed(2)})`);
    check(pools1.every((v, i) => i === best || v === pools0[i]), "the other places' pools do not");
    check(e.hours === 3 && e.log.length >= 4, "three hours searched");
    // Picked clean: on to the next place known with something left.
    poiAt(t, best).pool = PICKED_OVER;
    searchHour(st); tickHour(st);
    const others = knownPois(st, t, p).filter((i) => i !== best && poiPool(t, i) > PICKED_OVER);
    if (others.length) {
      check(e.poi !== best && others.includes(e.poi) && /moves on to the/.test(e.log[e.log.length - 1]), `picked clean, the search moves on to the next place (${poiName(t, e.poi)})`);
      check(poiAt(t, e.poi).visits === 1, "which counts as a visit too");
      for (const i of others) poiAt(t, i).pool = PICKED_OVER;
      searchHour(st); tickHour(st);
      check(/nothing else known here has anything left/.test(e.log[e.log.length - 1]), "the last place picked clean says so");
    }
    extract(st);
    check(!st.engagement && p.phase === "waiting", "the team extracts and waits");
    check(pickedOverAt(st, p, t.id), "the tile reads picked over now");
  }
  // The site POI's pool is tile.loot: a search in it lowers tile.loot and no extra.
  const s = siteWithExtras(st)[0];
  check(!!s, "a public site with extras exists");
  if (s) {
    const q = teamAt(st, s.id, 2);
    q.poi = 0;
    const loot0 = s.loot, extras0 = poisOf(s).slice(1).map((x) => x.pool);
    startOrder(st, q, { type: "mission", mission: "scavenge" });
    const e2 = st.engagement;
    check(!!e2 && e2.poi === 0, "the site itself can be picked (place 0)");
    if (e2) {
      e2.approach = "normal";
      searchHour(st); tickHour(st);
      check(s.loot < loot0 && poisOf(s).slice(1).every((x, i) => x.pool === extras0[i]), `searching the site lowers tile.loot (${loot0.toFixed(2)} → ${s.loot.toFixed(2)}) and no extra's pool`);
      extract(st);
    }
    const rs = poiRaidSetup(st, s, 0), rx = poiRaidSetup(st, s, 1);
    check(rs.choose === true && !rs.place && rx.choose === false && (rx.place === null || /^poi1:/.test(rx.place.id)), "the raid map: the site picked for you keeps its buildings' choice, an extra opens its own building (its id carries the index)");
  }
  // A site with several buildings: the card offers each and the street under the site, and the pick goes straight in.
  const m = multiSite(st);
  check(!!m, "a site with several buildings exists");
  if (m) {
    const opts = buildingOptions(m);
    const q = teamAt(st, m.id, 2);
    const card = poiPickCard(st, q);
    const site = card.choices.filter((c) => c.poi === 0);
    check(site.length === opts.length && opts.every((o) => site.some((c) => c.building === o.id)) && site.some((c) => c.building === "street"), `the card: one choice per building of the site and the street (${site.map((c) => c.building).join(", ")})`);
    const b0 = opts.find((o) => o.id !== "street");
    const rb = poiRaidSetup(st, m, 0, b0.id), rst = poiRaidSetup(st, m, 0, "street"), rbad = poiRaidSetup(st, m, 0, "nosuch");
    check(rb.choose === false && rb.building === b0.id && rst.choose === false && rst.building === "street" && rbad.choose === true, "the raid setup: the picked building (or the street) with no second choice; an unknown id falls back to the choice");
    const raid = createRaid(st, { mode: "raid", tile: m.id, partyId: q.id, canRetreat: true, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "nobody", groups: [] }, raid: { heat0: 0, choose: false, poi: 0, kind: rb.kind, place: null, building: b0.id } });
    check(!!raid && raid.raid.interior && raid.raid.interior.id === b0.id && !raid.raid.choose, `the battle map opens inside ${b0.name}, no building question`);
    site[0].resolve(st);
    if (q.phase === "task" && q.task && q.task.type === "poiwalk") { check(q.task.building === site[0].building, "the walk carries the building picked"); tasksDue(st, 1); }
    check(q.poi === undefined && q.poiBuilding === undefined, "the pick (place and building) is cleared once used");
    if (st.engagement) { st.engagement.approach = "normal"; st.engagement = null; }
    st.cards.length = 0;
  }
  // Every kind's building (or none: the street map with the kind's areas).
  const kinds = [...new Set(st.tiles.flatMap((x) => poisOf(x).map((y) => y.kind)))];
  check(kinds.every((k) => { const tt = st.tiles.find((x) => poisOf(x).some((y) => y.kind === k)); const i = poisOf(tt).findIndex((y) => y.kind === k); const pl = poiPlace(tt, i); return pl === null || (pl.key && pl.name && pl.id === `poi${i}:${pl.key}`); }), `every kind opens a building or the street map (${kinds.length} kinds)`);
}

// ---------- 3. threat ----------
section("Threat: the true value and the estimate");
{
  const st = W();
  const t = bareRich(st)[0];
  const i = 0, poi = poiAt(t, i);
  check(Math.abs(poiThreat(st, t, i) - ((LOCATIONS[poi.kind].danger || 0) + (t.infection || 0))) < 1e-9 || poiThreat(st, t, i) > (LOCATIONS[poi.kind].danger || 0) + (t.infection || 0), "true threat = the kind's danger + the infection (+ hive land)");
  check(threatBand(0).word === "quiet" && threatBand(1).word === "some risk" && threatBand(2).word === "dangerous" && threatBand(3).word === "very dangerous" && threatBand(3).skulls === "☠☠☠", "the bands: quiet, some risk, dangerous, very dangerous with skulls");
  check(poiThreatEstimate(st, t, i) === null && poiThreatText(st, t, i) === "threat unknown", "no look yet: threat unknown");
  const st0 = notePoiThreat(st, t, i, "visit");
  const e0 = poiThreatEstimate(st, t, i);
  check(!!e0 && e0.err === THREAT.ERR.visit && e0.lo <= e0.v && e0.v <= e0.hi + 1e-9 && !e0.stale && /seen today/.test(e0.text), `a visit's estimate (${e0 ? e0.text : "none"})`);
  check(notePoiThreat(st, t, i, "survey") === st0, "a rougher survey look the same hour does not replace it (a visit is the closer look)");
  const sv = notePoiThreat(st, t, i, "survey", 0.05);
  check(sv !== st0 && sv.err === 0.05 && sv.src === "survey", "a sharper one (good optics) does");
  check(notePoiThreat(st, t, i, "visit") === sv, "and a plain visit after it the same hour does not");
  st.hour += 24 * 20;
  const e1 = poiThreatEstimate(st, t, i);
  check(!!e1 && e1.err > sv.err && e1.stale && /20d ago, stale/.test(e1.text), `the error grows with the days and it goes stale (${e1 ? e1.text : "none"})`);
  check(st.hour - st0.hour >= 0, "stamps keep their hour");
  // The band, the full value.
  check(POI_BANDS.length === 4 && poiBand(t, i) === 0 && poiBandName(t, i) === "Rich" && Math.abs(poiFull(t, i) - LOCATIONS[poi.kind].richness * (t.terrain === "city" ? 1.15 : 1)) < 1e-9, "a fresh place is Rich (its full value is its kind's richness, × the city's bonus)");
  poiAt(t, i).pool = poiFull(t, i) * 0.2;
  check(poiBand(t, i) === 2, "a fifth left: Little");
  poiAt(t, i).pool = 0.02;
  check(poiBand(t, i) === 3, "at the floor: Picked clean");
  check(!raidingNow(st, t, i), "nobody is raiding it now");
}

// ---------- 4. the surveys ----------
section("The Survey (8h) and the Quick look (2h)");
{
  // The odds.
  const st = W();
  daylight(st);
  const plains = st.tiles.find((x) => x.terrain === "plains" && poisOf(x).length) || st.tiles.find((x) => x.terrain === "plains");
  const forest = st.tiles.find((x) => x.terrain === "forest" && poisOf(x).length) || st.tiles.find((x) => x.terrain === "forest");
  const p = teamAt(st, plains.id, 2, 12);
  const ctx = lookContext(st, partyMembers(st, p), { mode: false, stance: "normal", cargo: p.cargo });
  const cDay = lookOdds(st, ctx, plains.id, plains.id, st.hour), cNight = lookOdds(st, ctx, plains.id, plains.id, st.hour + 14), cForest = lookOdds(st, ctx, forest.id, forest.id, st.hour);
  check(cDay > 0.5 && cDay <= 1 && cNight < cDay && cForest < cDay, `the odds: farmland by day ${Math.round(cDay * 100)}%, at night ${Math.round(cNight * 100)}%, forest ${Math.round(cForest * 100)}%`);
  const pv = lookPreview(st, p);
  check(!!pv && pv.chance === cDay && ["good", "fair", "poor"].includes(pv.word) && !pv.ring, `the preview: ${pv ? pv.text : "none"}`);
  giveItem(partyMembers(st, p)[0], "binoculars");
  check(lookPreview(st, p).ring && lookPreview(st, p).chance >= cDay, "binoculars: the ring of tiles too, and better odds");
  // The Survey in the field, on a tile with hidden places.
  const st2 = W();
  daylight(st2);
  const t = hiddenSome(st2, "plains")[0] || hiddenSome(st2)[0];
  check(!!t, "a tile with a hidden place and a known one exists");
  if (t) {
    const q = teamAt(st2, t.id, 3, 18);
    giveItem(partyMembers(st2, q)[0], "binoculars");
    const known0 = knownPois(st2, t, q).length, hidden0 = poisOf(t).length - known0;
    const o = orderOptions(st2, q).find((x) => x.mission === "fullsurvey");
    check(!!o && !o.disabled, "the Survey is offered on the spot");
    const msg = startOrder(st2, q, { type: "mission", mission: "fullsurvey" });
    check(surveying(q) && q.task.hours === LOOK.hours && /starts surveying/.test(msg), `the task runs ${LOOK.hours} hours ("${msg}")`);
    check(stationaryActivity(q) === "fullsurvey", "Field Heat counts it (fieldheat.js ACTIVITY.fullsurvey)");
    let status = "";
    for (let i = 0; i < LOOK.hours && surveying(q); i++) { tickHour(st2); if (q.task && q.task.done === 3) status = lookStatus(st2, q); }
    check(/Surveying .*: 3 of 8 hours/.test(status), `the progress text ("${status}")`);
    check(!surveying(q) && q.phase === "waiting", "done after 8 hours, the team waits");
    const f = recOf(st2, q, t.id);
    const text = (st2.cards.find((c) => c.partyId === q.id) || {}).text || "";
    check(!!f && f.surveyed === day(st2), `the tile is stamped surveyed (day ${f ? f.surveyed : "-"})`);
    const known1 = knownPois(st2, t, q).length;
    const sure = !/Not sure you found everything/.test(text);
    check((sure && known1 === poisOf(t).length) || (!sure && known1 < poisOf(t).length) || known1 === poisOf(t).length, `${hidden0} hidden: ${known1 - known0} found${sure ? "" : ", not sure it found everything"} ("${text.slice(0, 140)}")`);
    check(knownPois(st2, t, q).every((i) => poiAt(t, i).threatStamp && poiAt(t, i).threatStamp.src === "survey"), "every place known there has a survey threat stamp");
    check(!/\d+ hidden|\d+ unknown/.test(text), "the report never counts what is hidden");
    // The hub learns the finds and the stamp with the report.
    mergeKnowledge(st2, q.seen || new Map(), q.spotted || null, q);
    const k = poiKnowledge(st2, t.id);
    check(!!k && k.surveyed === day(st2) && knownPois(st2, t).length === known1, "the hub's record carries the stamp and the finds");
    // Twice the same: the same finds (hash dice).
    const st3 = W();
    daylight(st3);
    const q3 = teamAt(st3, t.id, 3, 18);
    giveItem(partyMembers(st3, q3)[0], "binoculars");
    startOrder(st3, q3, { type: "mission", mission: "fullsurvey" });
    for (let i = 0; i < LOOK.hours && surveying(q3); i++) tickHour(st3);
    check(JSON.stringify(knownPois(st3, st3.tiles[t.id], q3)) === JSON.stringify(knownPois(st2, t, q)), "the same survey on the same seed finds the same");
  }
  // The Quick look: the kind only, half the odds, stamped looked.
  const st4 = W();
  daylight(st4);
  const t4 = hiddenSome(st4)[0];
  if (t4) {
    const q = teamAt(st4, t4.id, 2, 18);
    const ctx4 = lookContext(st4, partyMembers(st4, q), { mode: false, stance: "normal", cargo: q.cargo });
    const full = lookOdds(st4, ctx4, t4.id, t4.id);
    const msg = startOrder(st4, q, { type: "mission", mission: "survey" });
    check(q.phase === "task" && q.task.type === "survey" && q.task.hours === LOOK.quickHours && /two hours/.test(msg), "the Quick look is a 2-hour task");
    for (let i = 0; i < 3 && q.phase === "task"; i++) tickHour(st4);
    const f = recOf(st4, q, t4.id);
    check(!!f && f.looked === day(st4) && f.surveyed == null, "stamped looked, never surveyed");
    // Issue #67: a Quick look gives each place known there a general estimate of its dead, rougher than a Survey's
    // (sim/threatknow.js), and the team on the tile keeps it live.
    check(knownPois(st4, t4).every((k) => { const x = poiAt(t4, k).threatStamp; return x && x.d != null && x.de > THREAT.ERR.survey; }), "a quick look: a rough estimate of the dead in each place known (rougher than a Survey's)");
    check(full * LOOK.quick < full, `each hidden place at ${Math.round(LOOK.quick * 100)}% of the Survey's ${Math.round(full * 100)}%`);
    // A recon's look on arrival is a quick look too.
    const st5 = W();
    daylight(st5);
    const r = teamAt(st5, t4.id, 2, 18);
    r.phase = "out"; r.mission = "recon";
    giveOrder(st5, r, "recon");
    const f5 = recOf(st5, r, t4.id);
    check(!!f5 && f5.looked === day(st5), "a recon's look on arrival stamps the tile looked");
  }
  // The autopilot's target: by what the hub knows only.
  const st6 = W();
  const tg = poiSurveyTarget(st6, hub(st6), { range: 10 });
  check(!tg || (morePoisHidden(st6, tg.tile) && poiEligible(st6, tg.tile)), `the autopilot's survey target may hide more (${tg ? `tile ${tg.tile}: ${tg.why}` : "none in range"})`);
  const c = poiSurveyCandidate(st6, 4);
  check(!c || (c.mission === "fullsurvey" && c.onSite === LOOK.hours && c.poiSurvey), "its candidate is a Survey trip with 8 hours on site");
}

// ---------- 5. another group's base tile ----------
section("A place on another group's base tile");
{
  const st = W();
  const f = st.factions.find((x) => x.alive && x.bases.some((b) => poiTileRaid(st.tiles[b]) && planPath(st, hub(st).tile, b, false)));
  const b = f ? f.bases.find((x) => poiTileRaid(st.tiles[x]) && planPath(st, hub(st).tile, x, false)) : null;
  check(!!f, "a group's base stands on a tile with places");
  if (f) {
    const t = st.tiles[b];
    const p = teamAt(st, b, 3);
    const k = poiKnowledge(st, b, true);
    for (let i = 0; i < poisOf(t).length; i++) if (poisOf(t)[i].hidden && !k.idx.includes(i)) k.idx.push(i); // the hub knows them (a survey's finds)
    const g0 = f.goodwill;
    startOrder(st, p, { type: "mission", mission: "scavenge" });
    const e = st.engagement;
    check(!!e && e.guarded === f.id, `their guards hold the place (guarded by ${f.name})`);
    check(f.goodwill < g0, `their goodwill drops (${g0} → ${f.goodwill})`);
    if (e) { e.approach = "sneak"; extract(st); }
  }
}

// ---------- 6. a save keeps it ----------
section("A save keeps the stamps, the visits and a team's pick");
{
  const st = W();
  const t = bareAllKnown(st)[0];
  const p = teamAt(st, t.id);
  visitPoi(st, t, 1);
  notePoiThreat(st, t, 0, "survey", 0.12);
  p.poi = 1;
  const st2 = deserializeState(serializeState(st));
  const t2 = st2.tiles[t.id], p2 = st2.parties.find((x) => x.id === p.id);
  check(poiAt(t2, 1).visits === 1 && poiAt(t2, 1).lastDay === day(st) && poiAt(t2, 0).threatStamp && poiAt(t2, 0).threatStamp.err === 0.12, "the visit and the stamps load");
  check(!!p2 && p2.poi === 1, "the team's pick loads");
  check(poiThreatText(st2, t2, 0) === poiThreatText(st, t, 0) && poiVisitText(st2, t2, 1) === poiVisitText(st, t, 1), "the texts read the same");
  check(poiContainerNote(st, t, 0) === "", "no container note before any container is recorded");
}

// ---------- 7. the autopilot ----------
section(`The autopilot: ${DAYS} days`);
{
  const st = W(seed + 1);
  setAutopilot(st, true, "balanced");
  let err = "", surveys = 0, raids = 0;
  const seen = new Set();
  try {
    while (day(st) <= DAYS && !st.gameOver) {
      tickHour(st);
      for (const p of st.parties) if (p.owner === "player" && (p.teamMission || p.mission) === "fullsurvey" && !seen.has(p.id)) { seen.add(p.id); surveys++; }
      if (st.engagement && st.engagement.poi != null && !seen.has(`e${st.engagement.partyId}:${st.engagement.tile}`)) { seen.add(`e${st.engagement.partyId}:${st.engagement.tile}`); raids++; }
    }
  } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" | "); }
  check(!err, `no exception (${err || "ok"})`);
  const visited = st.tiles.reduce((a, t) => a + poisOf(t).filter((x) => x.visits > 0).length, 0);
  const stamped = Object.values(st.poiKnow || {}).filter((k) => k.surveyed != null).length;
  console.log(`  day ${day(st)}: ${surveys} survey teams, ${raids} searches in places, ${visited} places visited, ${stamped} tiles surveyed${st.gameOver ? " (game over)" : ""}`);
  check(raids > 0 && visited > 0, "the autopilot searches places");
  check(surveys > 0 || day(st) < 30, "and sends POI surveys");
}

// ---------- 8. on screen ----------
section("On screen: the right-click actions and the dialogue");
{
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const UI = await import("../src/ui/ui.js");
  const PICK = await import("../src/ui/poipick.js");
  const st = W();
  const t = bareAllKnown(st)[0], u = bareNoneKnown(st)[0];
  check(UI.tileActions(st, t.id).some(([m]) => m === "fullsurvey") && UI.tileActions(st, t.id).some(([m]) => m === "sweep"), "right-click: Survey this tile and Sweep the area");
  check(UI.tileActions(st, t.id).some(([m]) => m === "scavenge"), "Scavenge / raid where a place is known");
  check(!!u && !UI.tileActions(st, u.id).some(([m]) => m === "scavenge") && UI.tileActions(st, u.id).some(([m]) => m === "fullsurvey"), "none where no place is known, only the survey");
  const p = teamAt(st, t.id);
  const card = poiPickCard(st, p);
  let html = "", err = "";
  try { html = PICK.poiPickModal(st, card); } catch (e) { err = e.stack.split("\n").slice(0, 2).join(" | "); }
  check(!err && knownPois(st, t, p).every((i) => html.includes(poiName(t, i))) && /threat unknown/.test(html) && /never visited/.test(html) && /data-action="choice"/.test(html) && !/undefined|NaN/.test(html), `the dialogue draws every known place with its band, visits and threat${err ? ` (${err})` : ""}`);
  check(!/\d+ hidden|\d+ unknown/.test(html.replace(/data-tip="[^"]*"/g, "")), "and never a count of the hidden");
  const m = multiSite(st);
  if (m) {
    const q = teamAt(st, m.id, 2);
    const mc = poiPickCard(st, q);
    mc.poiPick.sel = 0; // the site picked on the tile map (ui/poipick.js): its buildings' buttons show
    let mh = "", merr = "";
    try { mh = PICK.poiPickModal(st, mc); } catch (e) { merr = e.stack.split("\n").slice(0, 2).join(" | "); }
    const sub = mc.choices.map((c, i) => [c, i]).filter(([c]) => c.poi === 0 && c.building);
    check(!merr && sub.every(([, i]) => mh.includes(`data-i="${i}"`)) && /The street/.test(mh) && !/undefined|NaN/.test(mh), `the dialogue draws a button per building of the site and the street${merr ? ` (${merr})` : ""}`);
  }
}

console.log(`\n${passes} passed, ${fails} failed.`);
if (fails) process.exit(1);
