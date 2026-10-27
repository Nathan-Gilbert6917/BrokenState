// AI groups survey and raid points of interest (src/sim/grouppois.js; aiscav.js, visitors.js, hardcore-groups.js,
// hardcore-loot.js; poicont.js lootPoiAbstract underneath).
// - Knowledge: a group knows the known zone's POIs within range of its bases and nothing hidden; a hidden POI only
//   after a survey of its own (the player's Survey odds with the group's Scouting), the stamp keeps it from
//   surveying the tile again; deterministic dice; a dead group's record is dropped; saved and loaded.
// - The targets: POIs by need × what is left, survey stops on tiles it may find more on (by expectation only).
// - Raids: the pool falls, the container ledger marks containers looted by the group, the tile heats up a little,
//   the haul is the POI's kind's; what the player left in an opened container is taken (and the log says so when
//   it is seen); a stripped POI is logged.
// - A party out: bestSite → the POI, a survey stop of 8 hours on the map, the raid, home with the haul; q.poi marks
//   the POI it is in (pois.js raidingNow).
// - Same tile as your team: the same POI → the contest (they wait while your team searches it, the conflict card
//   after); different POIs → no card, both get on with it; a group at war with you contests either way.
// - Outsider raiders survey and raid POIs; explorers pick through a site's POI; hardcore bands raid their camp's
//   POIs after a survey; the hardcore start doubles every POI pool and the surplus wears off to exactly the start.
// Usage: node tools/poiaitest.js [seed]
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { launchExpedition, removeParty } from "../src/sim/parties.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { poisOf, poiAt, poiPool, poiFull, isSitePoi, inKnownZone, tileHeat, raidingNow, poiLedger } from "../src/sim/pois.js";
import { contKey } from "../src/sim/poicont.js";
import { AISCAV, bestSite, sendParty, scavArrived, scavSearchHour, aiScav, teamPoi } from "../src/sim/aiscav.js";
import {
  GPOI, groupKnowsPoi, groupKnownPois, groupSees, groupSurveyTile, groupSurveyOdds, groupWouldSurvey, groupTargets, groupHiddenGuess, raidPoiAsGroup,
  groupPoiRecord, groupPois, pruneGroupPois, bestGroupPoi, groupScouting,
} from "../src/sim/grouppois.js";
import * as V from "../src/sim/visitors.js";
import { setupHardcoreLoot, hardcoreLootDaily, HC_LOOT } from "../src/sim/hardcore-loot.js";
import { newItem } from "../src/sim/inventory.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const r2 = (v) => Math.round(v * 100) / 100;
const group = (st) => st.factions.find((f) => f.alive && f.bases.length);
const free = (st, t) => !t.hive && t.owner == null && !st.bases.some((b) => b.tile === t.id) && !st.factions.some((f) => f.bases.includes(t.id)) && !st.hordes.some((h) => h.tile === t.id);
// A POI (not a site) near a group's base: hidden or not.
function poiNear(st, f, { hidden, maxD = GPOI.RANGE, minD = 1 }) {
  for (const id of st.grid.within(f.bases[0], maxD)) {
    const t = st.tiles[id];
    if (st.grid.distance(f.bases[0], id) < minD || !free(st, t) || (t.loc && !isSitePoi(t, 0))) continue;
    const L = poisOf(t);
    for (let i = 0; i < L.length; i++) if (!isSitePoi(t, i) && !!L[i].hidden === hidden && poiPool(t, i) > 0.1) return [t, i];
  }
  return null;
}
function team(st, tile) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: ids, dest: tile, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  if (res.error) throw new Error(`team: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.dest = tile; p.orders = [];
  return p;
}
const atSite = (st, q) => { q.idx = q.path.length - 1; q.progress = 0; scavArrived(st, q); };

section("Knowledge: in range without a survey, hidden ones only by a survey");
{
  const st = W();
  const f = group(st);
  const vis = poiNear(st, f, { hidden: false });
  const hid = poiNear(st, f, { hidden: true });
  check(!!vis && !!hid, "a known-zone POI and a hidden POI near a group's base");
  if (vis) check(groupKnowsPoi(st, f, vis[0], vis[1]) && groupSees(st, f, vis[0]), `a POI that is not hidden, within ${GPOI.RANGE} tiles of its base: known without a survey`);
  // The same kind of POI far from every base of the group: not known.
  const far = st.tiles.find((t) => f.bases.every((b) => st.grid.distance(b, t.id) > GPOI.RANGE + 2) && poisOf(t).some((p, i) => !p.hidden && !isSitePoi(t, i)));
  if (far) check(!groupKnowsPoi(st, f, far, poisOf(far).findIndex((p, i) => !p.hidden && !isSitePoi(far, i))), "the same out of range: not known");
  if (hid) {
    const [t, i] = hid;
    check(!groupKnowsPoi(st, f, t, i), "a hidden POI in range: not known before a survey");
    check(groupWouldSurvey(st, f, t), "the group would survey the tile");
    const odds = groupSurveyOdds(st, f, t, { n: 4 });
    check(odds > 0 && odds < 1, `the survey odds: the player's Survey model with the group's Scouting ${groupScouting(f)} (${r2(odds)})`);
    const keen = { id: f.id, bases: f.bases, scouting: 20 };
    check(groupSurveyOdds(st, keen, t, { n: 4 }) > odds, "better scouts, better odds");
    // Two worlds, the same dice.
    const st2 = W(), f2 = group(st2);
    const a = groupSurveyTile(st, f, t, { n: 4 }), b = groupSurveyTile(st2, f2, st2.tiles[t.id], { n: 4 });
    check(JSON.stringify(a) === JSON.stringify(b), `the same seed, the same survey (${a.sure ? "found everything" : `found ${a.found.length}`})`);
    // Survey until it is found (hours later: other dice).
    let h = 0;
    while (!groupKnowsPoi(st, f, t, i) && h++ < 40) { st.hour += 24 * GPOI.AGAIN; groupSurveyTile(st, f, t, { n: 6 }); }
    check(groupKnowsPoi(st, f, t, i), `found by its own survey (${h + 1} surveys)`);
    const rec = groupPoiRecord(st, f);
    check(rec && rec.f[t.id] && rec.f[t.id].includes(i) && rec.s[t.id] === day(st), "kept in its record with the day surveyed");
    check(!groupWouldSurvey(st, f, t), `not surveyed again for ${GPOI.AGAIN} days`);
    // Another group does not know it.
    const g = st.factions.find((x) => x.alive && x !== f && x.bases.length);
    check(!groupKnowsPoi(st, { id: g.id, bases: [t.id] }, t, i), "another group (even next to it) does not know what this one found");
    // Saved and loaded.
    const st3 = deserializeState(serializeState(st));
    check(groupKnowsPoi(st3, st3.factions.find((x) => x.id === f.id), st3.tiles[t.id], i), "a save keeps what a group found");
    // A dead group's record is dropped.
    f.alive = false;
    pruneGroupPois(st);
    check(!groupPoiRecord(st, f), "a dead group's record is dropped");
    f.alive = true;
  }
  // The guess never peeks: two tiles of the same terrain and zone, the same guess.
  const ts = st.tiles.filter((t) => t.terrain === "forest" && !t.loc && !inKnownZone(st, t));
  check(ts.length > 1 && groupHiddenGuess(st, ts[0]) === groupHiddenGuess(st, ts[1]) && groupHiddenGuess(st, ts[0]) > 0, `what a survey may turn up is guessed from the terrain and zone only (forest, unknown zone: ${r2(groupHiddenGuess(st, ts[0]))})`);
}

section("Targets and the raid: pool, ledger, heat, haul, your left items");
{
  const st = W();
  const f = group(st);
  for (const k of Object.keys(f.stock)) f.stock[k] = 0;
  const cands = groupTargets(st, f, f.bases, { need: { food: 1, water: 1, scrap: 1, ammo: 1, meds: 1, fuel: 1 } });
  check(cands.some((c) => c.poi >= 0 && !isSitePoi(st.tiles[c.tile], c.poi)), "its targets hold POIs that are not sites");
  check(cands.some((c) => c.survey && c.poi === -1), "and survey stops");
  check(cands.every((c) => c.poi == null || c.poi < 0 || groupKnowsPoi(st, f, c.tile, c.poi)), "only POIs it knows");
  const vis = poiNear(st, f, { hidden: false });
  const [t, i] = vis;
  const c = poiLedger(t, i);
  c.maps = { street: [1, 2, 3, 4, 5, 6, 7, 8] }; c.n = 8; // a map your team raided: its containers in their order
  const key = contKey("street", 3);
  const gun = newItem("pistol", 1);
  c.mine[key] = { contents: { sup: { f_beans: 3 }, gear: [gun] }, hidden: null, quick: false, lock: null, searched: true, partial: false };
  const pool0 = poiPool(t, i), heat0 = tileHeat(st, t);
  st.live = new Set([t.id]);
  const r = raidPoiAsGroup(st, f, t, i, pool0); // more than is left: everything down to the floor
  check(r && r.took > 0 && poiPool(t, i) < pool0 && poiPool(t, i) >= AISCAV.floor - 1e-9, `the pool falls, never below the floor (${r2(pool0)} → ${r2(poiPool(t, i))})`);
  check(Object.values(c.looted).filter((by) => by === f.id).length >= 6 && c.last && c.last.by === f.id, `containers marked looted by the group (${Object.keys(c.looted).length} of 8)`);
  check(r.left.f_beans === 3 && r.gear.length === 1 && r.gear[0].key === "pistol" && c.looted[key] === f.id && !Object.keys(c.mine[key].contents.sup).length, "what your people left in an opened container is taken");
  check(st.log.slice(0, 3).some((l) => /emptied what your people had left/.test(l.text)), "and the log says so (seen from your land)");
  check(tileHeat(st, t) > heat0, `the tile heats up (${r2(heat0)} → ${r2(tileHeat(st, t))})`);
  check(Object.keys(r.goods).some((k) => k !== "f_beans"), `a haul by the POI's kind (${Object.keys(r.goods).join(", ")})`);
  check(poiAt(t, i).stripped && r.strippedNow, "stripped");
  st.live = new Set();
}

section("A party out: a POI, a survey stop, home with the haul; raiding now");
{
  const st = W();
  tickHour(st);
  const f = group(st);
  for (const k of Object.keys(f.stock)) f.stock[k] = 0;
  const vis = poiNear(st, f, { hidden: false, minD: 2 });
  const [t, i] = vis;
  const q = sendParty(st, f, f.bases[0], t.id, { poi: i, survey: false });
  check(!!q && q.scav.poi === i, "sent for one POI");
  atSite(st, q);
  check(q.phase === "search" && q.poi === i && raidingNow(st, t, i), "at the tile, in that POI: the dialogue says it is being raided now");
  const pool0 = poiPool(t, i);
  for (let h = 0; h < AISCAV.searchHours && q.phase === "search"; h++) scavSearchHour(st, q);
  check(poiPool(t, i) < pool0, `the POI's pool fell (${r2(pool0)} → ${r2(poiPool(t, i))})`);
  check(q.phase === "home" && !raidingNow(st, t, i) && Object.keys(q.scav.got).length > 0, "home with a haul, no longer in it");
  // A survey stop: 8 hours on the tile, then the roll.
  const hid = poiNear(st, f, { hidden: true, minD: 2 });
  const [t2] = hid;
  const s0 = (st.groupPoiStats || {}).surveys || 0;
  const q2 = sendParty(st, f, f.bases[0], t2.id, { poi: -1, survey: true });
  atSite(st, q2);
  check(q2.scav.surveyLeft === GPOI.HOURS && q2.poi == null, `a survey stop: ${GPOI.HOURS} hours on the tile, in no POI`);
  for (let h = 0; h < GPOI.HOURS - 1; h++) scavSearchHour(st, q2);
  check(((st.groupPoiStats || {}).surveys || 0) === s0, "not rolled before the hours are up");
  scavSearchHour(st, q2);
  check(((st.groupPoiStats || {}).surveys || 0) === s0 + 1 && groupPoiRecord(st, f).s[t2.id] === day(st), "rolled at the end, the tile stamped");
  check(q2.phase === "home" || (q2.scav.poi >= 0 && groupKnowsPoi(st, f, t2, q2.scav.poi)), "then into a POI it knows there, or home");
  removeParty(st, q2);
  // bestSite picks POIs by need.
  const s = bestSite(st, f);
  check(s && (s.poi == null || s.poi === -1 || groupKnowsPoi(st, f, s.tile, s.poi)), `bestSite: ${s ? (s.survey ? "a survey stop" : s.poi == null ? "a site" : "a POI") : "nothing"}`);
}

section("Same tile as your team: the same POI contests, different POIs coexist");
{
  const st = W();
  tickHour(st);
  const f = group(st);
  f.goodwill = 0; f.pact = null;
  // A tile with two POIs the group knows.
  let tt = null;
  for (const id of st.grid.within(f.bases[0], GPOI.RANGE)) {
    const t = st.tiles[id];
    if (st.grid.distance(f.bases[0], id) < 2 || !free(st, t) || (t.loc && !isSitePoi(t, 0))) continue;
    const k = groupKnownPois(st, f, t).filter((i) => poiPool(t, i) > 0.1);
    if (k.length >= 2) { tt = [t, k[0], k[1]]; break; }
  }
  if (check(!!tt, "a tile with two POIs the group knows")) {
    const [t, a, b] = tt;
    const p = team(st, t.id);
    // Your team searching POI a; their party at POI b: no card, they loot b.
    st.engagement = { partyId: p.id, tile: t.id, poi: a, done: false, heat: 0, hours: 0, log: [], found: { supplies: {}, gear: [] } };
    check(teamPoi(st, p) === a, "your team's POI is the one it searches");
    const q = sendParty(st, f, f.bases[0], t.id, { poi: b });
    st.cards.length = 0;
    atSite(st, q);
    const pb = poiPool(t, b), pa = poiPool(t, a);
    scavSearchHour(st, q);
    check(!st.cards.length && poiPool(t, b) < pb && poiPool(t, a) === pa, `different POIs: no card, they search theirs (${r2(pb)} → ${r2(poiPool(t, b))}), yours untouched`);
    st.engagement.done = true;
    scavSearchHour(st, q);
    check(!st.cards.some((c) => c.partyId === p.id), "and no card when your team is done");
    removeParty(st, q);
    // The same POI: they wait while your team searches it, then the contest card.
    st.engagement = { partyId: p.id, tile: t.id, poi: a, done: false, heat: 0, hours: 0, log: [], found: { supplies: {}, gear: [] } };
    const q2 = sendParty(st, f, f.bases[0], t.id, { poi: a });
    atSite(st, q2);
    const pa2 = poiPool(t, a);
    scavSearchHour(st, q2);
    check(poiPool(t, a) === pa2 && !st.cards.some((c) => c.partyId === p.id), "the same POI: they wait while your team searches it");
    st.engagement.done = true;
    const c0 = aiScav(st).stats.contests;
    scavSearchHour(st, q2);
    const card = st.cards.find((c) => c.partyId === p.id);
    check(card && card.kind === "conflict" && card.conflict.type === "contest" && aiScav(st).stats.contests === c0 + 1, `then the contest card ("${card && card.title}")`);
    removeParty(st, q2);
    st.cards.length = 0;
    p.phase = "waiting"; // the card had stopped the team (conflicts.js halt)
    // At war with you: the card on different POIs too.
    st.diplo = st.diplo || {};
    st.diplo.pwars = [...(st.diplo.pwars || []), { id: 999, fid: f.id, allies: [] }];
    st.engagement = { partyId: p.id, tile: t.id, poi: a, done: false, heat: 0, hours: 0, log: [], found: { supplies: {}, gear: [] } };
    const q3 = sendParty(st, f, f.bases[0], t.id, { poi: b });
    st.engagement.done = true;
    atSite(st, q3);
    check(st.cards.some((c) => c.partyId === p.id && c.conflict && c.conflict.type === "contest"), "a group at war with you contests whatever POI");
    st.diplo.pwars = st.diplo.pwars.filter((w) => w.id !== 999);
  }
}

section("Outsiders: raiders survey and raid POIs, explorers pick through a site's");
{
  const st = W();
  tickHour(st);
  // A suburb tile away from the groups' grounds with POIs.
  const t = st.tiles.find((x) => x.terrain === "suburb" && !x.loc && poisOf(x).length >= 2 && free(st, x) && !V.nearGroups(st, x.id) && st.grid.distance(hub(st).tile, x.id) > 4);
  if (check(!!t, "a suburb tile with POIs away from the groups")) {
    const v = V.spawnVisitor(st, "raiders", { size: 5, power: 3 });
    v.tile = t.id; v.path = [t.id]; v.idx = 0; v.progress = 0; v.trail = [t.id];
    check(groupKnownPois(st, v, t).length > 0, "a band knows the known zone's POIs where it stands");
    const total0 = poisOf(t).reduce((a, _, i) => a + poiPool(t, i), 0);
    v.goal = { kind: "site", tile: t.id, poi: bestGroupPoi(st, v, t) };
    v.phase = "travel";
    const s0 = (st.groupPoiStats || {}).surveys || 0;
    for (let h = 0; h < 24 && V.visitorsOf(st).includes(v) && !(v.phase === "travel" && v.goal && v.goal.tile !== t.id); h++) tickHour(st);
    const total1 = poisOf(t).reduce((a, _, i) => a + poiPool(t, i), 0);
    check(((st.groupPoiStats || {}).surveys || 0) > s0, "raiders on a tile they may not know all of survey it first");
    check(total1 < total0, `then raid a POI there (${r2(total0)} → ${r2(total1)} on the tile)`);
    check(poisOf(t).some((p) => p.cont && p.cont.last && p.cont.last.by === v.id), "through the container ledger");
  }
}

section("The road start (Normal since issue #79; Hardcore's start is below: tools/modesplittest.js): every POI pool doubled at the start, the surplus wears off to exactly the start");
{
  const st = createWorld({ seed, factionCount: 7, mode: "normal", roadStart: true });
  const pairs = [];
  for (const t of st.tiles) poisOf(t).forEach((p, i) => { if (!isSitePoi(t, i) && p.poolNormal != null) pairs.push([t, i, p.poolNormal]); });
  check(pairs.length > 100 && pairs.every(([t, i, n]) => Math.abs(poiPool(t, i) - n * HC_LOOT.START) < 1e-9), `${pairs.length} POI pools at ${HC_LOOT.START} × a normal start`);
  for (let d = 0; d < 400; d++) hardcoreLootDaily(st);
  const back = pairs.filter(([t, i, n]) => poiAt(t, i).poolNormal == null && poiPool(t, i) === n);
  check(back.length === pairs.length, `after the months, back to exactly a normal start (${back.length} of ${pairs.length})`);
  // A hardcore band camping on a POI tile surveys it and raids one POI a day.
  const s1 = createWorld({ seed, factionCount: 7, mode: "hardcore" });
  let ok = false;
  for (let h = 0; h < 24 * 12 && !ok; h++) { tickHour(s1); ok = ((s1.groupPoiStats || {}).raids || 0) > 0; }
  check(ok, `the bands and groups raid POIs in a hardcore world (${JSON.stringify(s1.groupPoiStats || {})})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
