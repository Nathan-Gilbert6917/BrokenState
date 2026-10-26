// Tile heat (src/sim/pois.js TILE_HEAT, tileHeat / addTileHeat / tileHeatDaily;
// scavenge.js raidEnemies, heatSurge, startScavenge, afterRaid, searchHour, extract; poicont.js lootPoiAbstract), retired
// by issue #65 to thin wrappers over deadpop.js: tileHeat is the tile's noise memory; the estimate is threatknow.js's (#67).
// Usage: node tools/poiheattest.js [seed] [days]
// - a tile starts cold; heat adds up and stops at TILE_HEAT.MAX; it is kept apart from Field Heat and Scavenge Heat
// - going into a POI adds ENTER; coming out of the hour-by-hour search adds the approach's heat (sneak < normal <
//   loud) and the shots fired; a raid on a map adds by how hot it ran and its shots; another group's raid adds AI
// - it falls about 30% a day (the daily tick: deadpop.js NOISE_DECAY) and is gone below FLOOR
// - effect: not on the threat or the roster's count any more (the pools: tools/deadpoptest.js); a loud tile now and then
//   a horde (a chunk of its open ground) or a wandering band (hash dice, never state.rng)
// - what the player sees (issue #67's threatknow.js since the heat words went): a stamp of the dead's level when a team
//   is there, stale with the days like the threat; "threat unknown" before; the tile panel's rows and the dialogue's line
// - determinism, save / load, and [days] days of the autopilot: heat appears where teams searched and stays in range
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { registerCombatHandler } from "../src/sim/combat.js";
import {
  poisOf, isSitePoi, poiPool, poiThreat, TILE_HEAT, tileHeat, addTileHeat, tileHeatDaily, exitHeat, THREAT, poiThreatEstimate,
} from "../src/sim/pois.js";
import { raidEnemies, heatSurge, startScavenge, searchHour, extract, afterRaid, APPROACHES, raidApproach } from "../src/sim/scavenge.js";
import { popCap, tileDead, openDead, putBack, killDead, bandOfCount } from "../src/sim/deadpop.js";
import { lootPoiAbstract } from "../src/sim/poicont.js";
import { poiPanelRows } from "../src/ui/poiview.js";
import { threatLine } from "../src/ui/poipick.js";
import { noteTileThreat, tileThreatEstimate, tileThreatText, tileThreatStamp as tileThreatStampOf } from "../src/sim/threatknow.js";

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
  check(tileHeat(st, t) === 0 && tileHeat(st, t.id) === 0 && !st.tileHeat && !(st.deadPop && st.deadPop[t.id]), "a tile starts cold (no record at all)");
  addTileHeat(st, t, 12);
  addTileHeat(st, t.id, 5);
  check(near(tileHeat(st, t), 17) && near(st.deadPop[t.id].n, 17), `heat adds up (17: ${tileHeat(st, t)}), the tile's noise memory (deadpop.js)`);
  addTileHeat(st, t, 500);
  check(tileHeat(st, t) === TILE_HEAT.MAX, `and stops at ${TILE_HEAT.MAX}`);
  check(addTileHeat(st, t, -5) === TILE_HEAT.MAX && addTileHeat(st, t, 0) === TILE_HEAT.MAX, "nothing negative is added");
  check(Object.keys(st).filter((k) => /heat/i.test(k)).every((k) => k === "fieldHeat" || k === "heat") && !st.engagement && st.deadPop, "its own record (state.deadPop's noise), not Field Heat or a search's Scavenge Heat");
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
    check(tileThreatEstimate(st, t) && tileThreatEstimate(st, t).age < 1, "the team saw how many of the dead are about the tile (a fresh stamp)");
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
  check(near(tileHeat(st, t), 50 * TILE_HEAT.DECAY), `a day takes ${Math.round((1 - TILE_HEAT.DECAY) * 100)}% (50 → ${tileHeat(st, t).toFixed(1)})`);
  check(!(u.id in st.deadPop), `below ${TILE_HEAT.FLOOR} it is gone from the record (the tile back at its default)`);
  const h0 = tileHeat(st, t);
  const hour0 = st.hour;
  while (st.hour < hour0 + 24 * 7) tickHour(st);
  check(tileHeat(st, t) < h0 * 0.15 && tileHeat(st, t) > h0 * 0.04, `a week of the world's own clock: ${h0.toFixed(1)} → ${tileHeat(st, t).toFixed(1)} (0.7^7 = 8%), unless a team went in`);
}

section("Effect on threat and the roster (the pools since issue #65)");
{
  const st = W();
  const [t, i] = findPoi(st);
  const th0 = poiThreat(st, t, i);
  addTileHeat(st, t, 60);
  check(near(poiThreat(st, t, i), th0), `the noise alone does not raise the true threat (${th0.toFixed(2)}): its dead do (tools/deadpoptest.js)`);
  // The roster: the same dice, the same dead; the noise draws nothing from state.rng.
  const cold = W(), hot = W();
  addTileHeat(hot, t.id, 40);
  const dead = (st2) => { const g = raidEnemies(st2, t.id).find((x) => x.kind === "zombies"); return g ? g.count : 0; };
  const zc = dead(cold), zh = dead(hot);
  check(zh === zc, `a stirred tile (40) has no more dead in its roster by the noise alone (${zc} → ${zh})`);
  check(cold.rng.state === hot.rng.state, "the noise draws nothing more from state.rng");
  // A horde or a wandering band: never below SURGE; at full noise on a crowded tile about SURGE_P of the hours.
  const st3 = W();
  const t3 = st3.tiles[t.id];
  putBack(st3, t3, null, Math.max(0, Math.round(popCap(st3, t3) * 0.5) - tileDead(st3, t3)));
  addTileHeat(st3, t.id, TILE_HEAT.SURGE - 1);
  let below = 0;
  for (let h = 0; h < 200; h++) { st3.hour++; if (heatSurge(st3, t.id)) below++; }
  check(below === 0, "no surge below SURGE");
  addTileHeat(st3, t.id, 100);
  let n = 0, hordes = 0;
  const open0 = openDead(st3, t3);
  for (let h = 0; h < 2000; h++) { st3.hour++; const g = heatSurge(st3, t.id); if (g) { n++; if (g.kind === "zombies") hordes++; } }
  check(n > 2000 * TILE_HEAT.SURGE_P * 0.7 && n < 2000 * TILE_HEAT.SURGE_P * 1.3, `at full noise a surge about ${TILE_HEAT.SURGE_P * 100}% of the time (${n} of 2000 hours, ${hordes} hordes, ${n - hordes} wandering bands)`);
  check(openDead(st3, t3) === open0, "a horde off the POIs is drawn out of the open ground and stays on it (no dead out of nowhere)");
  check(raidEnemies(st3, t.id).length >= 1, "the roster still builds at full noise");
}

section("What the player sees");
{
  const st = W();
  const [t, i] = findPoi(st);
  check(tileThreatEstimate(st, t) === null && tileThreatText(st, t) === "threat unknown", "no look yet: threat unknown");
  check(/threat unknown/.test(poiPanelRows(st, t.id, true)) && threatLine(st, t.id) === "", "the panel says threat unknown and the dialogue nothing");
  addTileHeat(st, t, 45);
  noteTileThreat(st, t, "visit");
  const e = tileThreatEstimate(st, t);
  check(e && e.dead.word === bandOfCount(e.dead.n, popCap(st, t)).word && ["none", "low", "medium", "high", "overrun"].includes(e.dead.word) && !e.stale && /today/.test(e.text), `a team there sees the dead's level: "${e.text}"`);
  check(/The dead here/.test(poiPanelRows(st, t.id, true)) && /The dead here/.test(threatLine(st, t.id)) && !/Tile heat/.test(poiPanelRows(st, t.id, true)), "the panel's row and the dialogue's line show it (no Tile heat)");
  killDead(st, t, i, 3);
  check(tileThreatEstimate(st, t).dead.n === e.dead.n, "kills since the look are not seen");
  st.hour += 24 * (THREAT.STALE_DAYS + 1);
  const old = tileThreatEstimate(st, t);
  check(old.stale && /stale/.test(old.text), `two weeks on the look is stale: "${old.text}"`);
  const st2 = W();
  const [t2, i2] = findPoi(st2);
  addTileHeat(st2, t2, 80);
  const quiet = poiThreatEstimate(st2, t2, i2);
  check(quiet === null, "no threat stamp before a look");
  const p = team(st2, t2.id);
  p.poi = i2;
  startScavenge(st2, p);
  check(tileThreatStampOf(st2, t2) && poiThreatEstimate(st2, t2, i2), "going in stamps both the place's threat and the tile's dead");
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
  check(JSON.stringify(a.deadPop) === JSON.stringify(b.deadPop), `the same actions leave the same pools and noise (${JSON.stringify(a.deadPop).slice(0, 80)})`);
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(a, { dropCards: true }))));
  check(JSON.stringify(back.deadPop) === JSON.stringify(a.deadPop) && JSON.stringify(back.poiKnow) === JSON.stringify(a.poiKnow), "save / load keeps the pools, the noise and the looks");
}

section(`The autopilot for ${DAYS} days`);
{
  const st = W();
  setAutopilot(st, true, "balanced");
  let err = null, maxH = 0, tiles = new Set(), over = 0;
  try {
    while (day(st) <= DAYS && !st.gameOver) {
      tickHour(st);
      for (const [k, r] of Object.entries(st.deadPop || {})) { const v = r.n || 0; if (v > 0) tiles.add(k); maxH = Math.max(maxH, v); if (!(v >= 0 && v <= TILE_HEAT.MAX)) over++; }
    }
  } catch (e) { err = e; }
  check(!err, `no exception${err ? `: ${err.stack}` : ""}`);
  check(over === 0, "heat stays within 0–MAX");
  const warm = Object.values(st.deadPop || {}).filter((r) => r.n > 0).length;
  check(tiles.size > 0, `heat appeared on ${tiles.size} tiles (the hottest ${maxH.toFixed(1)}; now on ${warm})`);
  console.log(`  ${DAYS} days: heat on ${tiles.size} tiles over the run, the hottest ${maxH.toFixed(1)}, ${warm} still warm at the end, ${Object.keys(st.deadPop || {}).length} tiles' pools stored`);
}
void registerCombatHandler;

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
