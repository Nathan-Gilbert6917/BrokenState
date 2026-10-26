// Knowing the threat level (src/sim/threatknow.js, issue #67; the heat epic #64 §11–12): what the player believes of the
// dead and the raiders on a tile and in its places.
// Usage: node tools/threatknowtest.js [seed]
// - unknown without a look: no estimate, "threat unknown", the panel says so, the tile is not on the overlay
// - a full Survey stamps an approximate tile level (the survey's error, less with optics) and an estimate per POI known
// - a POI's own look (a Quick look, a visit) is rougher than the Survey's (a wider error, a bigger mean miss)
// - live on the tile: a team (or a base) there reads the counts as they are now, never stale; the hour writes the stamp
// - after leaving: the last estimate stays, kills since are not seen, and it goes stale after THREAT.STALE_DAYS
// - the overlay shows known tiles only; the raid strip's earshot; the forecast reads the pools; the codex key
// - the groups' own stamps (AI parity); save / load, an older save's tile-heat stamps, determinism
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { poisOf, poiAt, isSitePoi, poiPool, poiKnowledge, knownPois, notePoiThreat, THREAT } from "../src/sim/pois.js";
import { tileDead, openDead, popCap, poiDead, killDead, putBack, earshot, bandOfCount } from "../src/sim/deadpop.js";
import { fullSurveyDone, quickLook } from "../src/sim/survey.js";
import { surveyErr } from "../src/sim/intelnotes.js";
import { groupSurveyTile, raidPoiAsGroup } from "../src/sim/grouppois.js";
import { threatForecastFresh } from "../src/sim/forecast.js";
import {
  THREATKNOW, noteTileThreat, tileThreatEstimate, tileThreatText, tileThreatStamp, poiDeadEstimate, threatLive, liveTiles,
  threatKnowHour, threatOverlay, earshotEstimate, groupThreatEstimate, ensureThreatKnow, stampedTiles,
} from "../src/sim/threatknow.js";
import { poiPanelRows } from "../src/ui/poiview.js";
import { threatLine } from "../src/ui/poipick.js";
import { earshotChip } from "../src/ui/threatui.js";
import { codexEntry, codexScan, codexSeen } from "../src/ui/codex.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const based = (st, id) => st.bases.some((x) => x.tile === id);
// Tiles with a known POI, away from your bases.
function poiTiles(st, n = 1, kinds = ["house", "garage", "corner", "school", "gas"]) {
  const out = [];
  for (const t of st.tiles) {
    if (based(st, t.id) || t.terrain === "water") continue;
    const L = poisOf(t);
    for (let i = 0; i < L.length; i++) if (kinds.includes(L[i].kind) && !isSitePoi(t, i) && !L[i].hidden && poiPool(t, i) > 0.1 && poiDead(st, t, i) > 0) { out.push([t, i]); break; }
    if (out.length >= n) break;
  }
  return out;
}
function team(st, tile) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 30 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.dest = tile; p.phase = "arrived";
  st.cards.length = 0;
  return p;
}
const leave = (st, p) => { st.parties = st.parties.filter((x) => x !== p); };

section("Unknown without a look");
{
  const st = W();
  const [[t, i]] = poiTiles(st);
  check(!threatLive(st, t.id) && tileThreatEstimate(st, t) === null && tileThreatText(st, t) === "threat unknown", "a tile never looked at and nobody on it: threat unknown");
  check(poiDeadEstimate(st, t, i) === null, "and its places: no estimate of their dead");
  check(/threat unknown/.test(poiPanelRows(st, t.id, true)) && threatLine(st, t.id) === "", "the tile panel says threat unknown; the dialogue's line is empty");
  check(!threatOverlay(st).some((x) => x.tile === t.id), "it is not on the overlay");
  const live = liveTiles(st);
  check(threatOverlay(st).every((x) => live.has(x.tile)), `a new world: only the tiles your people stand on are on the overlay (${threatOverlay(st).length})`);
}

section("A full Survey: an approximate tile level and an estimate for each place");
{
  const st = W();
  const [[t, i]] = poiTiles(st);
  const p = team(st, t.id);
  fullSurveyDone(st, p);
  const s = tileThreatStamp(st, t);
  check(!!s && s.src === "survey" && s.d === tileDead(st, t) && s.cap === popCap(st, t), `the survey stamps the tile: ${s && s.d} of the dead against a cap of ${s && s.cap}`);
  check(s && Math.abs(s.err - surveyErr(st)) < 1e-3, `at the survey's error (${s && s.err})`);
  check(surveyErr(st, { look: 2 }) < surveyErr(st), "less error with optics (intelnotes.js surveyErr)");
  leave(st, p); // read it as stamped, not live
  const e = tileThreatEstimate(st, t);
  const d = tileDead(st, t);
  check(!!e && !e.live && Math.abs(e.dead.n - d) <= Math.ceil(d * e.err / 2) + 1, `the estimate is within the error: ${e && e.dead.n} for ${d} (± ${e && Math.round(e.err * 50)}%)`);
  check(e && e.dead.word === bandOfCount(e.dead.n, popCap(st, t)).word && e.dead.skulls === THREATKNOW.SKULL.repeat(e.dead.band), `a band with a skull a band: "${e && e.text}"`);
  check(e && e.raiders && ["none", "low", "medium", "high", "overrun"].includes(e.raiders.word), `and the raiders: ${e && e.raiders && e.raiders.word}`);
  const known = knownPois(st, t);
  check(known.length > 0 && known.every((k) => { const x = poiDeadEstimate(st, t, k); return x && x.src === "survey"; }), `every place known there has an estimate (${known.length})`);
  const pe = poiDeadEstimate(st, t, i);
  check(pe && Math.abs(pe.err - surveyErr(st)) < 1e-3, `a place's estimate at the survey's error (${pe && pe.err})`);
}

section("A place's own look is rougher than the Survey's");
{
  const st = W();
  const list = poiTiles(st, 120);
  let svy = 0, look = 0, n = 0;
  for (const [t, i] of list) {
    const d = poiDead(st, t, i);
    if (d < 4) continue;
    notePoiThreat(st, t, i, "survey", surveyErr(st));
    const a = poiDeadEstimate(st, t, i);
    st.hour += 1;
    notePoiThreat(st, t, i, "look");
    const b = poiDeadEstimate(st, t, i);
    st.hour -= 1;
    // A look never makes you know less than you knew: the stamp keeps the survey's error. A first look alone is rougher.
    const st2 = W();
    notePoiThreat(st2, t.id, i, "look");
    const c = poiDeadEstimate(st2, t.id, i);
    if (!a || !b || !c) continue;
    svy += Math.abs(a.dead.n - d) / d;
    look += Math.abs(c.dead.n - d) / d;
    if (n === 0) {
      check(c.err === THREATKNOW.ERR.look && c.err > a.err, `a Quick look's error ${c.err} is wider than the survey's ${a.err}`);
      check(b.err <= a.err + 0.01, `a look after a survey keeps the sharper error (${b.err})`);
    }
    n++;
    if (n >= 40) break;
  }
  check(n >= 10 && look / n > svy / n, `over ${n} places the look misses by ${Math.round((look / n) * 100)}% on average, the survey by ${Math.round((svy / n) * 100)}%`);
  check(THREATKNOW.ERR.visit > THREATKNOW.ERR.survey, "a visit's estimate is rougher than the survey's too");
  const st3 = W();
  const [[t3]] = poiTiles(st3);
  const p3 = team(st3, t3.id);
  quickLook(st3, p3);
  check(knownPois(st3, t3).every((k) => { const x = poiDeadEstimate(st3, t3, k); return x && x.err >= THREATKNOW.ERR.live; }), "a Quick look gives every place known there a general estimate");
}

section("Live on the tile, stale after leaving");
{
  const st = W();
  const [[t, i]] = poiTiles(st);
  const p = team(st, t.id);
  check(threatLive(st, t.id), "a team on the tile: live");
  const e0 = tileThreatEstimate(st, t);
  check(e0 && e0.live && e0.age === 0 && /\(live\)/.test(e0.text) && e0.err <= THREATKNOW.ERR.live, `an estimate with no survey at all, live: "${e0 && e0.text}"`);
  check(/\(live\)/.test(poiPanelRows(st, t.id, true)) && /The dead here/.test(threatLine(st, t.id)), "the tile panel and the dialogue say (live)");
  const before = e0.dead.n;
  killDead(st, t, i, Math.max(1, Math.floor(poiDead(st, t, i))));
  killDead(st, t, null, Math.floor(openDead(st, t) * 0.8));
  const e1 = tileThreatEstimate(st, t);
  check(e1.live && e1.dead.n < before, `the kills show at once while there (${before} → ${e1.dead.n})`);
  st.hour += 24 * (THREAT.STALE_DAYS + 5);
  threatKnowHour(st);
  const e2 = tileThreatEstimate(st, t);
  check(e2.live && !e2.stale && e2.age === 0, "weeks on the tile: never stale");
  check(tileThreatStamp(st, t).h === st.hour, "the hour writes the live look into the stamp");
  const pd = poiDeadEstimate(st, t, i);
  check(pd && pd.live, "its known places are live too");
  for (let h = 0; h < 24 * 60; h++) { st.hour++; threatKnowHour(st); }
  const ts = poiAt(t, i).threatStamp;
  check(ts.err <= THREAT.ERR.visit + 1e-9 && ts.de <= THREATKNOW.ERR.live + 1e-9, `two months live: the place's errors do not creep up (${ts.err}, ${ts.de})`);
  const seen = tileThreatEstimate(st, t).dead.n;
  leave(st, p);
  const e3 = tileThreatEstimate(st, t);
  check(e3 && !e3.live && e3.dead.n === seen && /today/.test(e3.text), `after leaving: the last look, "${e3 && e3.text}"`);
  putBack(st, t, null, 30);
  check(tileThreatEstimate(st, t).dead.n === seen, "the dead come back unseen once you have left");
  st.hour += 24 * 2;
  const e4 = tileThreatEstimate(st, t);
  check(/2 days ago/.test(e4.text) && e4.err > e3.err && !e4.stale, `two days on: "${e4.text}", rougher (${e3.err} → ${e4.err})`);
  st.hour += 24 * THREAT.STALE_DAYS;
  const e5 = tileThreatEstimate(st, t);
  check(e5.stale && /stale/.test(e5.text), `past two weeks: "${e5.text}"`);
  // A base counts as being there.
  const h = hub(st);
  check(threatLive(st, h.tile) && tileThreatEstimate(st, h.tile).live, "a base of yours keeps its own tile live");
}

section("The overlay: known tiles only");
{
  const st = W();
  const tiles = poiTiles(st, 6).map(([t]) => t.id);
  const p = team(st, tiles[0]);
  fullSurveyDone(st, p);
  noteTileThreat(st, tiles[1], "visit");
  const on = new Set(threatOverlay(st).map((x) => x.tile));
  check(on.has(tiles[0]) && on.has(tiles[1]), "a surveyed tile and a looked-at one are on it");
  check(!tiles.slice(2).some((id) => on.has(id)), "tiles nobody looked at are not");
  const known = new Set([...stampedTiles(st), ...liveTiles(st)]);
  check([...on].every((id) => known.has(id)), `every tile on it is stamped or live (${on.size})`);
  check(threatOverlay(st).every((x) => x.level >= 0 && x.level <= 4), "each with a level 0–4");
}

section("The raid strip's earshot");
{
  const st = W();
  const [[t]] = poiTiles(st);
  check(earshotEstimate(st, t) === null, "nobody there and no look: no earshot");
  team(st, t.id);
  const e = earshotEstimate(st, t);
  const truth = earshot(st, t);
  check(e && e.n >= 0 && Math.abs(e.n - truth) <= Math.max(5, truth * 0.5), `about the true earshot (${e && e.text} for ${truth})`);
  const all = earshotEstimate(st, t, 0).n, less = earshotEstimate(st, t, 3).n;
  check(less <= all, "less the ones already drawn in");
  const chip = earshotChip(st, t.id, 0, true);
  check(/Earshot: <b>/.test(chip) && /more on this tile/.test(chip), "the chip reads Earshot: ~N more on this tile");
  check(truth === 0 || /a shot draws them/.test(chip), "with a warning when the selected weapon is loud");
  check(!/a shot draws them/.test(earshotChip(st, t.id, 0, false)), "no warning with a quiet one");
}

section("The forecast, the codex");
{
  const st = W();
  const h = hub(st);
  putBack(st, h.tile, null, popCap(st, h.tile));
  const f = threatForecastFresh(st);
  check(f.week.some((x) => x.kind === "deadland" && x.level >= 1), `an overrun base tile is on the 7-day forecast (${tileThreatEstimate(st, h.tile).text})`);
  check(!codexEntry("k:tileheat") && !!codexEntry("k:deadland"), "the codex's Tile heat is now The dead on the land");
  const [[t]] = poiTiles(st);
  noteTileThreat(st, t.id, "visit");
  codexScan(st, { started: true }, true);
  check(codexSeen(st, "k:deadland"), "a stamp opens The dead on the land");
}

section("The groups (AI parity)");
{
  const st = W();
  const f = st.factions.find((x) => x.alive);
  const [[t, i]] = poiTiles(st);
  check(groupThreatEstimate(st, f, t) === null, "a group with no look knows nothing");
  groupSurveyTile(st, f, t);
  const g = groupThreatEstimate(st, f, t);
  check(g && ["none", "low", "medium", "high", "overrun"].includes(g.dead.word) && Math.abs(g.dead.n - tileDead(st, t)) <= Math.ceil(tileDead(st, t) * THREATKNOW.ERR.group / 2) + 1, `its survey: the dead ${g && g.dead.word} (${g && g.dead.n} for ${tileDead(st, t)})`);
  st.hour += 24 * (THREAT.STALE_DAYS + 1);
  check(groupThreatEstimate(st, f, t).stale, "stale with the days like yours");
  const [, [t2, i2]] = poiTiles(st, 2);
  raidPoiAsGroup(st, f, t2, i2, 0.1, { news: false });
  check(!!groupThreatEstimate(st, f, t2), "a raid there is a look too");
  check(tileThreatEstimate(st, t2) === null || threatLive(st, t2.id), "their looks are theirs: the player learns nothing");
}

section("Saves");
{
  const st = W();
  const tiles = poiTiles(st, 3);
  const p = team(st, tiles[0][0].id);
  fullSurveyDone(st, p);
  leave(st, p);
  const e = tileThreatEstimate(st, tiles[0][0]);
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const e2 = tileThreatEstimate(back, tiles[0][0].id);
  check(e2 && e2.text === e.text && e2.dead.n === e.dead.n, `a stamp survives save / load ("${e2 && e2.text}")`);
  const pe = poiDeadEstimate(st, tiles[0][0], tiles[0][1]), pe2 = poiDeadEstimate(back, tiles[0][0].id, tiles[0][1]);
  check(pe && pe2 && pe.text === pe2.text, "and a place's");
  // An older save: issue #65's tile-heat stamps.
  const old = W();
  const a = tiles[1][0].id, b = tiles[2][0].id;
  poiKnowledge(old, a, true).heat = { hour: 5, v: 12, d: tileDead(old, a), cap: popCap(old, a) };
  poiKnowledge(old, b, true).heat = { hour: 5, v: 30 }; // from before the pools: heat alone
  const save = JSON.stringify(serializeState(old));
  const l1 = deserializeState(JSON.parse(save)), l2 = deserializeState(JSON.parse(save));
  check(!poiKnowledge(l1, a).heat && tileThreatStamp(l1, a) && tileThreatStamp(l1, a).d === tileDead(old, a), "a tile-heat stamp that counted the dead becomes a threat stamp");
  check(!poiKnowledge(l1, b).heat && !tileThreatStamp(l1, b), "a heat-only stamp is dropped (it said nothing of the dead)");
  check(JSON.stringify(l1.poiKnow) === JSON.stringify(l2.poiKnow) && tileThreatEstimate(l1, a).text === tileThreatEstimate(l2, a).text, "two loads of the same save read the same");
  const again = JSON.stringify(l1.poiKnow);
  ensureThreatKnow(l1);
  check(JSON.stringify(l1.poiKnow) === again, "the fold runs once");
}

section("Determinism");
{
  const run = () => {
    const st = W();
    const [[t]] = poiTiles(st);
    const p = team(st, t.id);
    fullSurveyDone(st, p);
    leave(st, p);
    st.hour += 50;
    return JSON.stringify([tileThreatEstimate(st, t), threatOverlay(st)]);
  };
  check(run() === run(), "the same seed, the same estimates (hash dice, never state.rng)");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
