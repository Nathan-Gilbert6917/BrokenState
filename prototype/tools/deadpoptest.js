// The dead and the raiders on the land (src/sim/deadpop.js, issue #65, the heat epic #64): real counts per tile and
// per POI.
// Usage: node tools/deadpoptest.js [seed]
// - caps by land class (a city centre ≫ a city ≫ the suburbs > a town > farmland > the wild; rural always under city)
// - seeding: the tile's count is its open ground + its POIs'; deterministic; nothing stored for a tile nobody touched;
//   never over the cap
// - kills come off the POI and the tile (raidEnemies shows fewer next time; 0: none of its own), loud vs quiet noise
// - draws and putting back; reinforcements (b.reinfMax, a raid's spawnCap) limited by the open ground within earshot
// - a battle's end (deadPopBattleEnd): a played raid's kills scaled to its roster, the reinforcements off the open
//   ground; a fight by the numbers through combat.js finishCombat
// - a low tile with a low POI: a small roster and almost no reinforcements
// - the daily rules: low stays low (a POI at 0 stays clear), medium rises more after loud nights, high drifts toward
//   the cap, refills only from the open ground, nothing over the cap
// - raiders: seeded, in the POI's roster, killed; fieldheat.js's trouble reads the open ground; the AI's raids kill
//   from the same pools; poiThreat reads the pools
// - an older save's tile heat folded in on load (deterministically), and a save / load keeps the pools
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { createBattle, autoResolveCombat, finishCombat, registerCombatHandler } from "../src/sim/combat.js";
import { raidEnemies, rosterOf, startScavenge, searchHour } from "../src/sim/scavenge.js";
import { poisOf, poiAt, isSitePoi, poiThreat, tileHeat, addTileHeat } from "../src/sim/pois.js";
import { noteTileThreat, tileThreatEstimate } from "../src/sim/threatknow.js"; // what the player sees of the band (issue #67)
import { tileClass } from "../src/sim/placement.js";
import { tileDanger } from "../src/sim/fieldheat.js";
import { raidPoiAsGroup } from "../src/sim/grouppois.js";
import {
  DEADPOP, popCap, raiderCap, tileDead, openDead, poiDead, tileRaiders, openRaiders, poiRaiders, poiCap, poiDefault,
  killDead, killRaiders, drawFromTile, putBack, noteNoise, noiseOf, recentKills, deadBand, raiderBand, earshot,
  deadPopDaily, deadPopBattleEnd, ensureDeadPop, deadPopSpread,
} from "../src/sim/deadpop.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
registerCombatHandler("deadpoptest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = /** @type {any} */ ({}); try { return fn(); } finally { if (!had) delete globalThis.window; } };
const homeIds = (st) => new Set(st.bases.map((b) => b.tile));
// A land tile of a class with a POI (not a base's).
function tileWith(st, pred) {
  const homes = homeIds(st);
  for (const t of st.tiles) if (!homes.has(t.id) && t.terrain !== "water" && pred(t)) return t;
  return null;
}
const withPoi = (st, cls) => tileWith(st, (t) => tileClass(st, t) === cls && !t.hive && poisOf(t).some((p, i) => !isSitePoi(t, i) && !p.hidden));
const poiIn = (t) => poisOf(t).findIndex((p, i) => !isSitePoi(t, i) && !p.hidden);

section("Caps by land class (a rural cap is always below a city cap)");
{
  const st = W();
  const capOf = {};
  for (const cls of Object.keys(DEADPOP.CAP)) { const t = tileWith(st, (x) => tileClass(st, x) === cls && !x.hive); if (t) capOf[cls] = popCap(st, t); }
  console.log(`  caps: ${Object.entries(capOf).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  check(DEADPOP.CAP.centre > DEADPOP.CAP.city && DEADPOP.CAP.city > DEADPOP.CAP.suburb && DEADPOP.CAP.suburb > DEADPOP.CAP.town && DEADPOP.CAP.town > DEADPOP.CAP.rural && DEADPOP.CAP.rural > DEADPOP.CAP.scenic, "centre ≫ city ≫ suburbs > town > farmland > the wild");
  check(Math.max(DEADPOP.CAP.rural, DEADPOP.CAP.coast, DEADPOP.CAP.scenic, DEADPOP.CAP.highway) * DEADPOP.HIVE_CAP < DEADPOP.CAP.city, "a rural cap (even on a hive's land) is below a city cap");
  if (capOf.rural != null && capOf.city != null) check(capOf.rural < capOf.city, `on the map too: rural ${capOf.rural} < city ${capOf.city}`);
  check(popCap(st, st.tiles.find((t) => t.terrain === "water")) === 0, "water holds none");
  check(raiderCap(st, tileWith(st, (x) => tileClass(st, x) === "rural")) < raiderCap(st, tileWith(st, (x) => tileClass(st, x) === "city") || tileWith(st, (x) => tileClass(st, x) === "suburb")), "fewer raiders in the country");
}

section("Seeding: the tile's count is its open ground and its POIs'; deterministic; nothing stored untouched");
{
  const a = W(), b = W();
  let ok = true, over = 0, n = 0;
  const byClass = {};
  for (const t of a.tiles) {
    if (t.terrain === "water") continue;
    const sum = poisOf(t).reduce((s, _, i) => s + poiDead(a, t, i), 0);
    if (tileDead(a, t) !== openDead(a, t) + sum) ok = false;
    if (openDead(a, t) > popCap(a, t)) over++;
    if (tileDead(a, t) !== tileDead(b, b.tiles[t.id]) || tileRaiders(a, t) !== tileRaiders(b, b.tiles[t.id])) ok = false;
    const c = tileClass(a, t);
    (byClass[c] = byClass[c] || []).push(tileDead(a, t));
    n++;
  }
  console.log(`  mean dead by class: ${Object.entries(byClass).map(([k, v]) => `${k} ${(v.reduce((x, y) => x + y, 0) / v.length).toFixed(1)}`).join(", ")}`);
  check(ok, `tileDead = openDead + Σ poiDead on all ${n} land tiles, the same in two worlds of seed ${seed}`);
  check(over === 0, "no open ground over its cap");
  check(!a.deadPop || !Object.keys(a.deadPop).length, "nothing is stored for tiles nobody touched");
  const mean = (k) => (byClass[k] ? byClass[k].reduce((x, y) => x + y, 0) / byClass[k].length : 0);
  if (byClass.rural && byClass.city) check(mean("rural") < mean("city"), "the country holds fewer than the city");
}

section("Kills come off the POI and the tile; the next raid shows fewer; 0 means none of its own");
{
  const st = W();
  const t = withPoi(st, "suburb") || withPoi(st, "town") || withPoi(st, "rural");
  const i = poiIn(t);
  for (const j of poisOf(t).keys()) if (j !== i) killDead(st, t, j, 0); // nothing
  const p0 = poiDead(st, t, i), t0 = tileDead(st, t), o0 = openDead(st, t);
  const z0 = raidEnemies(st, t.id, i).filter((g) => g.kind === "zombies").reduce((a, g) => a + g.count, 0);
  check(z0 === Math.min(DEADPOP.ROSTER_MAX, p0), `a raid on the POI spawns what it holds (${z0} of ${p0})`);
  const k = killDead(st, t, i, 2);
  check(k === Math.min(2, p0) && poiDead(st, t, i) === p0 - k && tileDead(st, t) === t0 - k && openDead(st, t) === o0, `2 killed: POI ${p0} → ${poiDead(st, t, i)}, tile ${t0} → ${tileDead(st, t)}, the open ground as it was`);
  check(st.deadPop && st.deadPop[t.id], "the touched tile is stored");
  const z1 = raidEnemies(st, t.id, i).filter((g) => g.kind === "zombies").reduce((a, g) => a + g.count, 0);
  check(z1 === Math.min(DEADPOP.ROSTER_MAX, poiDead(st, t, i)) && z1 <= z0, `raiding again shows fewer (${z0} → ${z1})`);
  killDead(st, t, i, poiDead(st, t, i));
  check(poiDead(st, t, i) === 0 && !raidEnemies(st, t.id, i).some((g) => g.kind === "zombies" && g.dpool === "dead" && !g.surge), "0 in the POI: no dead of its own in the raid");
  const o1 = openDead(st, t), t1 = tileDead(st, t);
  check(killDead(st, t, i, 2) === Math.min(2, o1) && openDead(st, t) === o1 - Math.min(2, o1) && poiDead(st, t, i) === 0, "kills past the POI's count come off the open ground");
  check(tileDead(st, t) >= 0 && openDead(st, t) >= 0, "never below 0");
  check(recentKills(st, t) >= k, `the tile remembers its kills (${recentKills(st, t).toFixed(1)})`);
  const n0 = noiseOf(st, t);
  killDead(st, t, null, 3, { loud: false });
  const quiet = noiseOf(st, t) - n0;
  killDead(st, t, null, 3, { loud: true });
  const loud = noiseOf(st, t) - n0 - quiet;
  check(loud > quiet * 5 && t1 - tileDead(st, t) <= 8, `loud kills make more noise than quiet ones (3 kills: loud +${loud.toFixed(1)}, quiet +${quiet.toFixed(1)})`);
}

section("Draws and putting back; reinforcements limited by the open ground within earshot");
{
  const st = W();
  const t = withPoi(st, "suburb") || withPoi(st, "rural");
  const o0 = openDead(st, t);
  const got = drawFromTile(st, t, 5);
  check(got === Math.min(5, o0) && openDead(st, t) === o0 - got, `drawFromTile takes up to n out of the open ground (${got})`);
  check(putBack(st, t, null, got) === got && openDead(st, t) === o0, "the ones that walked away go back");
  check(drawFromTile(st, t, 1e6) === o0 && openDead(st, t) === 0 && drawFromTile(st, t, 3) === 0, "an empty open ground gives nothing more");
  check(earshot(st, t) === 0, "nothing within earshot");
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: t.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 30 } });
  const p = res.party;
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
  const fb = createBattle(st, { tile: t.id, partyId: p.id, enemy: { kind: "zombies", count: 3, power: 2 }, ambush: null, canRetreat: true, handler: "deadpoptest", context: {} });
  check(fb.reinfMax === 0, `a fight on an empty tile draws none in (b.reinfMax ${fb.reinfMax})`);
  st.combat = null;
  putBack(st, t, null, o0);
  const fb2 = createBattle(st, { tile: t.id, partyId: p.id, enemy: { kind: "zombies", count: 3, power: 2 }, ambush: null, canRetreat: true, handler: "deadpoptest", context: {} });
  check(fb2.reinfMax === Math.min(DEADPOP.REINF_MAX, earshot(st, t)) && fb2.reinfMax <= openDead(st, t), `with the open ground back: b.reinfMax ${fb2.reinfMax} (earshot ${earshot(st, t)} of ${openDead(st, t)})`);
  st.combat = null;
  const rb = inBrowser(() => createBattle(st, { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "deadpoptest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, t.id, poiIn(t)) }, raid: { heat0: 5, poi: poiIn(t) }, context: {} }));
  check(rb.raid.spawnCap <= earshot(st, t), `a raid's waves are capped by the open ground within earshot (spawnCap ${rb.raid.spawnCap} ≤ ${earshot(st, t)})`);
  st.combat = null;
}

section("A battle's end: a played raid's kills scaled to its roster, the reinforcements off the open ground");
{
  const st = W();
  const t = withPoi(st, "suburb") || withPoi(st, "town");
  const i = poiIn(t);
  const p0 = poiDead(st, t, i), o0 = openDead(st, t);
  const groups = raidEnemies(st, t.id, i);
  const ro = rosterOf(groups);
  // A map that placed twice the roster (a big map's scale), killed half of them, and 3 reinforcements of which 2 died.
  const placed = ro.roster * 2;
  const units = [];
  for (let k = 0; k < placed; k++) units.push({ side: "enemy", kind: "zombie", dead: k < ro.roster });
  for (let k = 0; k < 3; k++) units.push({ side: "enemy", kind: "zombie", reinforcement: true, drawn: true, dead: k < 2 });
  units.push({ side: "enemy", kind: "zombie", reinforcement: true, dead: true }); // a risen one (carriers.js): not the tile's
  deadPopBattleEnd(st, { deadPop: { tile: t.id, poi: i, ...ro } }, null, { tileId: t.id, units, gunshots: 0 });
  check(poiDead(st, t, i) === p0 - Math.round(ro.roster / 2), `half the map's dead killed: half the roster off the POI (${p0} → ${poiDead(st, t, i)}, roster ${ro.roster})`);
  check(openDead(st, t) === o0 - 2, `the 2 reinforcements killed off the open ground (${o0} → ${openDead(st, t)}); the one alive stays there`);
  const n0 = noiseOf(st, t, i);
  deadPopBattleEnd(st, { deadPop: { tile: t.id, poi: i, roster: 0 } }, null, { tileId: t.id, units: [], gunshots: 40 });
  check(noiseOf(st, t, i) - n0 === DEADPOP.SHOT_CAP && noiseOf(st, t) > 0, `the shots heard feed the noise (+${noiseOf(st, t, i) - n0}, at most SHOT_CAP)`);
  // By the numbers through combat.js finishCombat.
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 3).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: t.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 60 } });
  const p = res.party;
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
  const t1 = tileDead(st, t);
  const setup = { tile: t.id, partyId: p.id, enemy: { kind: "zombies", count: 4, power: 1 }, ambush: null, canRetreat: true, handler: "deadpoptest", context: {}, deadPop: { tile: t.id, poi: null, roster: 4 } };
  const r = autoResolveCombat(st, setup);
  finishCombat(st, setup, r);
  check(tileDead(st, t) === t1 - Math.min(openDead(st, t) + (t1 - tileDead(st, t)), Math.round(4 * Math.min(1, (r.enemiesKilled || 0) / 4))), `a fight by the numbers: ${r.enemiesKilled} killed come off the tile (${t1} → ${tileDead(st, t)})`);
}

section("A low tile with a low POI: few or no dead, almost no reinforcements");
{
  const st = W();
  let t = null;
  for (const x of st.tiles) if (!homeIds(st).has(x.id) && ["rural", "scenic"].includes(tileClass(st, x)) && poiIn(x) >= 0 && deadBand(st, x).band <= 1 && deadBand(st, x, poiIn(x)).band <= 2) { t = x; break; }
  if (check(!!t, "a low rural tile with a POI")) {
    const i = poiIn(t);
    const z = raidEnemies(st, t.id, i).filter((g) => g.kind === "zombies").reduce((a, g) => a + g.count, 0);
    console.log(`  ${tileClass(st, t)} tile ${t.id}: ${tileDead(st, t)} dead (cap ${popCap(st, t)}, ${deadBand(st, t).word}), ${poiAt(t, i).kind} holds ${poiDead(st, t, i)}, earshot ${earshot(st, t)}`);
    check(z <= 5, `a small roster (${z})`);
    check(earshot(st, t) <= 4, `almost no reinforcements (earshot ${earshot(st, t)})`);
  }
}

section("The daily rules");
{
  const st = W();
  // Low tile, every POI low: very small rises at most; a POI at 0 stays clear.
  let lowT = null;
  for (const x of st.tiles) if (!homeIds(st).has(x.id) && tileClass(st, x) === "rural" && poiIn(x) >= 0 && deadBand(st, x).band === 1) { lowT = x; break; }
  if (check(!!lowT, "a low rural tile")) {
    const i = poiIn(lowT);
    killDead(st, lowT, i, poiDead(st, lowT, i));
    st.deadPop[lowT.id].k = 0; st.deadPop[lowT.id].n = 0; st.deadPop[lowT.id].pn = {};
    const d0 = tileDead(st, lowT);
    for (let d = 0; d < 60; d++) { st.hour += 24; deadPopDaily(st); }
    check(poiDead(st, lowT, i) === 0, `a cleared POI on a low tile stays clear for 60 days`);
    check(tileDead(st, lowT) - d0 <= 6 && tileDead(st, lowT) <= popCap(st, lowT), `the low tile rises very little in 60 days (${d0} → ${tileDead(st, lowT)})`);
  }
  // Medium: loud nights rise more than quiet ones (the same tile, two worlds).
  const pick = (s) => s.tiles.find((x) => !homeIds(s).has(x.id) && ["suburb", "town", "city"].includes(tileClass(s, x)) && poiIn(x) >= 0);
  const run = (loud) => {
    const s = W();
    const x = pick(s);
    const cap = popCap(s, x);
    // set it to the middle of medium
    const want = Math.round(cap * 0.4);
    drawFromTile(s, x, 1e6);
    putBack(s, x, null, Math.max(0, want - tileDead(s, x)));
    const d0 = tileDead(s, x);
    for (let d = 0; d < 40; d++) { if (loud) noteNoise(s, x, null, DEADPOP.LOUD * 2); s.hour += 24; deadPopDaily(s); if (deadBand(s, x).band !== 2) break; }
    return { gain: tileDead(s, x) - d0, cap, x: x.id };
  };
  const q = run(false), l = run(true);
  check(l.gain > q.gain, `medium: loud nights rise more (+${l.gain}) than quiet ones (+${q.gain}) on tile ${q.x} (cap ${q.cap})`);
  // High: drifts toward the cap and never above it.
  const s = W();
  const x = pick(s);
  const cap = popCap(s, x);
  drawFromTile(s, x, 1e6);
  putBack(s, x, null, Math.max(0, Math.round(cap * 0.75) - tileDead(s, x)));
  const h0 = tileDead(s, x);
  let over = false;
  for (let d = 0; d < 30; d++) { noteNoise(s, x, null, 30); s.hour += 24; deadPopDaily(s); if (tileDead(s, x) > cap) over = true; }
  check(tileDead(s, x) > h0 && !over, `high: drifts toward the cap (${h0} → ${tileDead(s, x)} of ${cap}), never above`);
  // Refill only out of the open ground.
  const i = poiIn(x);
  drawFromTile(s, x, 1e6);
  killDead(s, x, i, poiDead(s, x, i));
  for (let d = 0; d < 5; d++) { s.hour += 24; const r = s.deadPop[x.id]; r.o = 0; deadPopDaily(s); }
  check(poiDead(s, x, i) === 0, "a POI does not refill when its tile's open ground is empty");
  putBack(s, x, null, Math.max(0, Math.round(cap * 0.9) - tileDead(s, x)));
  const o1 = openDead(s, x), p1 = poiDead(s, x, i);
  s.hour += 24; deadPopDaily(s);
  check(poiDead(s, x, i) > p1 && poiDead(s, x, i) <= poiCap(s, x, i), `on a high tile the POI refills out of the open ground (${p1} → ${poiDead(s, x, i)}, open ${o1} → ${openDead(s, x)})`);
  check(typeof deadPopSpread === "function", "the spread's hook is there (#66)");
  // Memories fade.
  const s2 = W();
  const y = pick(s2);
  noteNoise(s2, y, null, 40);
  for (let d = 0; d < 3; d++) { s2.hour += 24; deadPopDaily(s2); }
  check(noiseOf(s2, y) < 40 * 0.4 && noiseOf(s2, y) > 0, `the noise fades over about 3 days (40 → ${noiseOf(s2, y).toFixed(1)})`);
}

section("Raiders");
{
  const st = W();
  let n = 0, inPoi = 0, ok = true;
  for (const t of st.tiles) {
    if (t.terrain === "water") continue;
    const sum = poisOf(t).reduce((a, _, i) => a + poiRaiders(st, t, i), 0);
    if (tileRaiders(st, t) !== openRaiders(st, t) + sum || tileRaiders(st, t) > raiderCap(st, t)) ok = false;
    n++; if (sum) inPoi++;
  }
  check(ok, `tileRaiders = openRaiders + Σ poiRaiders, under the cap, on ${n} tiles`);
  check(inPoi > 0, `some POIs have raiders holed up (${inPoi} tiles)`);
  const t = st.tiles.find((x) => !homeIds(st).has(x.id) && poisOf(x).some((_, i) => poiRaiders(st, x, i) > 0) && !st.factions.some((f) => f.alive && f.bases.includes(x.id)) && typeof x.owner !== "number");
  if (check(!!t, "a POI with raiders off any group's land")) {
    const i = poisOf(t).findIndex((_, j) => poiRaiders(st, t, j) > 0);
    const g = raidEnemies(st, t.id, i).find((x) => x.dpool === "raiders");
    check(!!g && g.count === poiRaiders(st, t, i) && g.name === DEADPOP.RAIDER_NAME, "the POI's raiders are in its raid's roster");
    const r0 = tileRaiders(st, t);
    check(killRaiders(st, t, i, 1) === 1 && poiRaiders(st, t, i) === g.count - 1 && tileRaiders(st, t) === r0 - 1, "a raider killed comes off the POI and the tile");
    check(raiderBand(st, t).word.length > 0, `the raiders' level: ${raiderBand(st, t).word}`);
  }
}

section("Field Heat's trouble, poiThreat and the AI read the same pools");
{
  const st = W();
  const t = withPoi(st, "suburb") || withPoi(st, "town");
  const i = poiIn(t);
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const p = launchExpedition(st, { memberIds: crew, dest: t.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6 } }).party;
  p.path = [t.id]; p.idx = 0;
  const d0 = tileDanger(st, p, t.id).danger;
  const th0 = poiThreat(st, t, i);
  drawFromTile(st, t, 1e6);
  const d1 = tileDanger(st, p, t.id).danger;
  check(d1 < d0, `the trouble roll's danger falls with the open ground emptied (${d0.toFixed(2)} → ${d1.toFixed(2)})`);
  killDead(st, t, i, poiDead(st, t, i));
  check(poiThreat(st, t, i) < th0, `a cleared POI is less of a threat (${th0.toFixed(2)} → ${poiThreat(st, t, i).toFixed(2)})`);
  const s2 = W();
  const t2 = s2.tiles[t.id];
  const pd = poiDead(s2, t2, i), td = tileDead(s2, t2);
  const f = s2.factions.find((x) => x.alive);
  raidPoiAsGroup(s2, f.id, t2, i, 0.1, { news: false });
  check(poiDead(s2, t2, i) === Math.max(0, pd - DEADPOP.AI_KILLS) && tileDead(s2, t2) === td - (pd - poiDead(s2, t2, i)), `another group's raid kills from the POI and the tile (${pd} → ${poiDead(s2, t2, i)})`);
  check(noiseOf(s2, t2, i) > 0, "and its noise counts");
  // tile heat's wrappers
  const n0 = tileHeat(s2, t2);
  check(addTileHeat(s2, t2, 5) === n0 + 5 && tileHeat(s2, t2) === noiseOf(s2, t2), "tileHeat / addTileHeat: the tile's noise memory");
  noteTileThreat(s2, t2, "visit");
  const e = tileThreatEstimate(s2, t2);
  check(!!e && ["none", "low", "medium", "high", "overrun"].includes(e.dead.word) && e.dead.band >= 0 && e.dead.band <= 4, `tileThreatEstimate (threatknow.js): the dead's band as seen (${e && e.text})`);
}

section("The hour-by-hour search: an empty place has no fights with the dead");
{
  const st = W();
  const t = withPoi(st, "suburb") || withPoi(st, "town") || withPoi(st, "rural");
  const i = poiIn(t);
  killDead(st, t, i, poiDead(st, t, i));
  drawFromTile(st, t, 1e6);
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const p = launchExpedition(st, { memberIds: crew, dest: t.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 30 } }).party;
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "arrived"; p.poi = i;
  st.cards.length = 0;
  startScavenge(st, p);
  const e = st.engagement;
  if (check(!!e && e.poi === i, "the search is in the place")) {
    e.approach = "loud";
    let met = 0;
    for (let k = 0; k < 12 && !e.done && e.poi === i; k++) { const line = searchHour(st) || ""; if (/The dead found you/.test(line)) met++; }
    check(met === 0 && poiDead(st, t, i) === 0, `no dead met in a place that holds none (${met} fights)`);
  }
}

section("An older save's tile heat folded in; a save and load keeps the pools");
{
  const st = W();
  const t = withPoi(st, "suburb") || withPoi(st, "town");
  const i = poiIn(t);
  const p0 = poisOf(t).map((_, j) => poiDead(st, t, j));
  st.tileHeat = { [t.id]: 45 };
  delete st.deadPop;
  const back = deserializeState(serializeState(st));
  const bt = back.tiles[t.id];
  check(!back.tileHeat, "state.tileHeat is gone after the load");
  check(Math.abs(noiseOf(back, bt) - 45) < 1e-9, `its heat is the tile's noise memory now (${noiseOf(back, bt)})`);
  check(poisOf(bt).every((_, j) => poiDead(back, bt, j) === Math.min(popCap(back, bt), p0[j] + Math.floor(45 / DEADPOP.HEAT_ROSTER)) || tileDead(back, bt) >= popCap(back, bt)), `each POI got floor(45 / ${DEADPOP.HEAT_ROSTER}) more of the dead (${p0[i]} → ${poiDead(back, bt, i)})`);
  const again = deserializeState(serializeState(st));
  check(JSON.stringify(again.deadPop) === JSON.stringify(back.deadPop), "the fold is deterministic");
  killDead(back, bt, i, 1);
  const kept = deserializeState(serializeState(back));
  check(JSON.stringify(kept.deadPop) === JSON.stringify(back.deadPop) && poiDead(kept, kept.tiles[t.id], i) === poiDead(back, bt, i), "a save and load keeps the pools as they were");
  const plain = W();
  ensureDeadPop(plain);
  check(!plain.deadPop || !Object.keys(plain.deadPop).length, "a save with no tile heat needs nothing stored");
  check(poiDefault(st, t, i) >= 0 && deadBand(st, t, i).word.length > 0, `POI ${poiAt(t, i).kind}: default ${poiDefault(st, t, i)}, cap ${poiCap(st, t, i)}, ${deadBand(st, t, i).word}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
