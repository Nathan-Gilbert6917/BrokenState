// Tile heat (src/sim/pois.js TILE_HEAT, tileHeat / addTileHeat / tileHeatDaily / noteTileHeat / tileHeatEstimate;
// scavenge.js raidEnemies, heatSurge, startScavenge, afterRaid, searchHour, extract; poicont.js lootPoiAbstract).
// Usage: node tools/poiheattest.js [seed] [days]
// - a tile starts cold; heat adds up and stops at TILE_HEAT.MAX; it is kept apart from Field Heat and Scavenge Heat
// - going into a POI adds ENTER; coming out of the hour-by-hour search adds the approach's heat (sneak < normal <
//   loud) and the shots fired; a raid on a map adds by how hot it ran and its shots; another group's raid adds AI
// - it falls about 10% a day (the daily tick) and is gone below FLOOR
// - effect: every POI's true threat on the tile rises with it (up to TILE_HEAT.THREAT); the raid roster gets more of
//   the dead (one every ROSTER), and a hot tile now and then a horde or a wandering band (hash dice, never state.rng)
// - what the player sees: a stamp when a team is there, faded and stale with the days like the threat; "unknown"
//   before; the tile panel's row and the dialogue's line
// - determinism, save / load, and [days] days of the autopilot: heat appears where teams searched and stays in range
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { registerCombatHandler } from "../src/sim/combat.js";
import {
  poisOf, isSitePoi, poiPool, poiThreat, TILE_HEAT, tileHeat, addTileHeat, tileHeatDaily, exitHeat, noteTileHeat, tileHeatEstimate, tileHeatText, heatBand, THREAT, poiThreatEstimate,
} from "../src/sim/pois.js";
import { raidEnemies, heatSurge, startScavenge, searchHour, extract, afterRaid, APPROACHES, raidApproach } from "../src/sim/scavenge.js";
import { lootPoiAbstract } from "../src/sim/poicont.js";
import { poiPanelRows } from "../src/ui/poiview.js";
import { heatLine } from "../src/ui/poipick.js";

const seed = Number(process.argv[2] || 42);
const DAYS = Number(process.argv[3] || 40);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
function findPoi(st, kinds = ["house", "garage", "corner", "school", "gas"]) {
  for (const t of st.tiles) {
    if (t.id === hub(st).tile || st.bases.some((x) => x.tile === t.id)) continue;
    const L = poisOf(t);
    for (let i = 0; i < L.length; i++) if (kinds.includes(L[i].kind) && !isSitePoi(t, i) && !L[i].hidden && poiPool(t, i) > 0.1) return [t, i];
  }
  return null;
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

section("Adding up, the cap, apart from the other heats");
{
  const st = W();
  const [t] = findPoi(st);
  check(tileHeat(st, t) === 0 && tileHeat(st, t.id) === 0 && !st.tileHeat, "a tile starts cold (no record at all)");
  addTileHeat(st, t, 12);
  addTileHeat(st, t.id, 5);
  check(near(tileHeat(st, t), 17) && near(st.tileHeat[t.id], 17), `heat adds up (17: ${tileHeat(st, t)})`);
  addTileHeat(st, t, 500);
  check(tileHeat(st, t) === TILE_HEAT.MAX, `and stops at ${TILE_HEAT.MAX}`);
  check(addTileHeat(st, t, -5) === TILE_HEAT.MAX && addTileHeat(st, t, 0) === TILE_HEAT.MAX, "nothing negative is added");
  check(Object.keys(st).filter((k) => /heat/i.test(k)).every((k) => k === "tileHeat" || k === "fieldHeat" || k === "heat") && !st.engagement, "its own record (state.tileHeat), not Field Heat or a search's Scavenge Heat");
  check(exitHeat(APPROACHES.sneak.heat) < exitHeat(APPROACHES.normal.heat) && exitHeat(APPROACHES.normal.heat) < exitHeat(APPROACHES.loud.heat), `coming out: sneak ${exitHeat(7)} < normal ${exitHeat(13)} < loud ${exitHeat(22)}`);
  check(exitHeat(13, 10) === 13 + 10 * TILE_HEAT.SHOT && exitHeat(13, 1000) === 13 + TILE_HEAT.SHOT_CAP, `shots add ${TILE_HEAT.SHOT} each, at most ${TILE_HEAT.SHOT_CAP}`);
  check(raidApproach(10) === "sneak" && raidApproach(30) === "normal" && raidApproach(80) === "loud", "a raid on a map counts as sneak / normal / loud by how hot it ran");
}

section("Going in and coming out (the hour-by-hour search)");
{
  for (const approach of ["sneak", "normal", "loud"]) {
    const st = W();
    const [t, i] = findPoi(st);
    const p = team(st, t.id);
    p.poi = i;
    startScavenge(st, p);
    check(near(tileHeat(st, t), TILE_HEAT.ENTER), `${approach}: going in adds ${TILE_HEAT.ENTER} (${tileHeat(st, t)})`);
    const e = st.engagement;
    e.approach = approach;
    for (let h = 0; h < 3 && !e.done; h++) { searchHour(st); }
    const shots = e.shots || 0;
    const before = tileHeat(st, t);
    extract(st);
    check(near(tileHeat(st, t) - before, exitHeat(APPROACHES[approach].heat, shots)), `${approach}: coming out adds the approach's heat and the shots (${(tileHeat(st, t) - before).toFixed(1)}: ${APPROACHES[approach].heat} + ${shots} shots)`);
    check(tileHeatEstimate(st, t) && tileHeatEstimate(st, t).age < 1, "the team saw how stirred up the tile is (a fresh stamp)");
  }
}

section("A raid on a map (scavenge.js afterRaid) and another group's raid");
{
  const st = W();
  const [t, i] = findPoi(st);
  const p = team(st, t.id);
  const setup = { mode: "raid", tile: t.id, partyId: p.id, handler: "scavenge", enemy: { kind: "zombies", count: 1, groups: [] }, raid: { heat0: 0, poi: i, kind: poisOf(t)[i].kind }, context: {} };
  st.gunfire = [{ tile: t.id, hour: st.hour, n: 8 }]; // finishCombat notes a raid's shots first (fieldheat.js noteGunfire)
  afterRaid(st, { outcome: "extracted", loot: { supplies: {}, gear: [] }, raid: { hours: 0, searched: 2, total: 9, heat: 60 } }, setup, null);
  check(near(tileHeat(st, t), exitHeat(APPROACHES.loud.heat, 8)), `a raid that ran hot (Heat 60) with 8 shots adds ${exitHeat(22, 8)} (${tileHeat(st, t)})`);
  const before = tileHeat(st, t);
  lootPoiAbstract(st, 5, t, i, 0.05);
  check(near(tileHeat(st, t) - before, TILE_HEAT.AI), `another group's raid adds ${TILE_HEAT.AI}`);
  const b2 = tileHeat(st, t);
  lootPoiAbstract(st, "player", t, i, 0.05);
  check(tileHeat(st, t) === b2, "your own crews' searches add their heat going in and out, not here");
}

section("The daily fall");
{
  const st = W();
  const [t] = findPoi(st);
  const u = st.tiles.find((x) => x.id !== t.id && x.terrain !== "water");
  addTileHeat(st, t, 50);
  addTileHeat(st, u, 0.54);
  tileHeatDaily(st);
  check(near(tileHeat(st, t), 50 * TILE_HEAT.DECAY), `a day takes 10% (50 → ${tileHeat(st, t).toFixed(1)})`);
  check(!(u.id in st.tileHeat), `below ${TILE_HEAT.FLOOR} it is gone from the record`);
  const h0 = tileHeat(st, t);
  const hour0 = st.hour;
  while (st.hour < hour0 + 24 * 7) tickHour(st);
  check(tileHeat(st, t) < h0 * 0.6 && tileHeat(st, t) > h0 * 0.35, `a week of the world's own clock: ${h0.toFixed(1)} → ${tileHeat(st, t).toFixed(1)} (0.9^7 = 48%), unless a team went in`);
}

section("Effect on threat and the roster");
{
  const st = W();
  const [t, i] = findPoi(st);
  const th0 = poiThreat(st, t, i);
  addTileHeat(st, t, 60);
  check(near(poiThreat(st, t, i) - th0, 0.6 * TILE_HEAT.THREAT), `true threat rises with heat (60 → +${(poiThreat(st, t, i) - th0).toFixed(2)})`);
  addTileHeat(st, t, 100);
  check(near(poiThreat(st, t, i) - th0, TILE_HEAT.THREAT), `at most +${TILE_HEAT.THREAT}`);
  // The roster: the same dice, more of the dead.
  const cold = W(), hot = W();
  const ct = cold.tiles[t.id];
  addTileHeat(hot, t.id, 60);
  const dead = (st2) => { const g = raidEnemies(st2, t.id).find((x) => x.kind === "zombies"); return g ? g.count : 0; };
  const zc = dead(cold), zh = dead(hot);
  check(zh === Math.min(14, Math.max(1, zc + Math.floor(60 / TILE_HEAT.ROSTER))) || zh === 14, `a hot tile (60) draws more of the dead to a raid (${zc} → ${zh})`);
  check(cold.rng.state === hot.rng.state, "the heat draws nothing more from state.rng");
  void ct;
  // A horde or a wandering band: never below SURGE; at full heat about SURGE_P of the hours.
  const st3 = W();
  addTileHeat(st3, t.id, TILE_HEAT.SURGE - 1);
  let below = 0;
  for (let h = 0; h < 200; h++) { st3.hour++; if (heatSurge(st3, t.id)) below++; }
  check(below === 0, "no surge below SURGE");
  addTileHeat(st3, t.id, 100);
  let n = 0, hordes = 0;
  for (let h = 0; h < 2000; h++) { st3.hour++; const g = heatSurge(st3, t.id); if (g) { n++; if (g.kind === "zombies") hordes++; } }
  check(n > 2000 * TILE_HEAT.SURGE_P * 0.7 && n < 2000 * TILE_HEAT.SURGE_P * 1.3, `at full heat a surge about ${TILE_HEAT.SURGE_P * 100}% of the time (${n} of 2000 hours, ${hordes} hordes, ${n - hordes} wandering bands)`);
  check(raidEnemies(st3, t.id).length >= 1, "the roster still builds at full heat");
}

section("What the player sees");
{
  const st = W();
  const [t, i] = findPoi(st);
  check(tileHeatEstimate(st, t) === null && tileHeatText(st, t) === "unknown", "no look yet: unknown");
  check(!/Tile heat/.test(poiPanelRows(st, t.id, true)) && heatLine(st, t.id) === "", "the panel and the dialogue say nothing of it");
  addTileHeat(st, t, 45);
  noteTileHeat(st, t);
  const e = tileHeatEstimate(st, t);
  check(e && e.word === heatBand(e.v).word && !e.stale && /seen today/.test(e.text), `a team there sees it: "${e.text}"`);
  check(/Tile heat/.test(poiPanelRows(st, t.id, true)) && /Tile heat/.test(heatLine(st, t.id)), "the panel's row and the dialogue's line show it");
  addTileHeat(st, t, 40);
  check(Math.abs(tileHeatEstimate(st, t).v - e.v) < 1e-9, "heat added since the look is not seen");
  st.hour += 24 * (THREAT.STALE_DAYS + 1);
  const old = tileHeatEstimate(st, t);
  check(old.stale && /stale/.test(old.text) && old.v < e.v, `two weeks on the look is stale and faded: "${old.text}"`);
  const st2 = W();
  const [t2, i2] = findPoi(st2);
  addTileHeat(st2, t2, 80);
  const quiet = poiThreatEstimate(st2, t2, i2);
  check(quiet === null, "no threat stamp before a look");
  const p = team(st2, t2.id);
  p.poi = i2;
  startScavenge(st2, p);
  check(tileHeatEstimate(st2, t2) && poiThreatEstimate(st2, t2, i2), "going in stamps both the place's threat and the tile's heat");
}

section("Determinism and save / load");
{
  const run = () => {
    const st = W();
    const [t, i] = findPoi(st);
    const p = team(st, t.id);
    p.poi = i;
    startScavenge(st, p);
    st.engagement.approach = "loud";
    for (let h = 0; h < 4 && !st.engagement.done; h++) searchHour(st);
    extract(st);
    lootPoiAbstract(st, 2, t, i, 0.1);
    for (let h = 0; h < 48; h++) tickHour(st);
    return st;
  };
  const a = run(), b = run();
  check(JSON.stringify(a.tileHeat) === JSON.stringify(b.tileHeat), `the same actions leave the same heat (${JSON.stringify(a.tileHeat).slice(0, 80)})`);
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(a, { dropCards: true }))));
  check(JSON.stringify(back.tileHeat) === JSON.stringify(a.tileHeat) && JSON.stringify(back.poiKnow) === JSON.stringify(a.poiKnow), "save / load keeps the heat and the looks");
}

section(`The autopilot for ${DAYS} days`);
{
  const st = W();
  setAutopilot(st, true, "balanced");
  let err = null, maxH = 0, tiles = new Set(), over = 0;
  try {
    while (day(st) <= DAYS && !st.gameOver) {
      tickHour(st);
      for (const [k, v] of Object.entries(st.tileHeat || {})) { tiles.add(k); maxH = Math.max(maxH, v); if (!(v >= 0 && v <= TILE_HEAT.MAX)) over++; }
    }
  } catch (e) { err = e; }
  check(!err, `no exception${err ? `: ${err.stack}` : ""}`);
  check(over === 0, "heat stays within 0–MAX");
  check(tiles.size > 0, `heat appeared on ${tiles.size} tiles (the hottest ${maxH.toFixed(1)}; now on ${Object.keys(st.tileHeat || {}).length})`);
  console.log(`  ${DAYS} days: heat on ${tiles.size} tiles over the run, the hottest ${maxH.toFixed(1)}, ${Object.keys(st.tileHeat || {}).length} still warm at the end`);
}
void registerCombatHandler;

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
