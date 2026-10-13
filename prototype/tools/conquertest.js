// Conquest (src/sim/conquest.js) and the coalition victory (alliance.js): taking a group's base (by hand and with the
// Assault their base mission end to end), a group's last base breaking it, goodwill and infamy, the victory with only
// coalition members left (hives standing), no new gang once the coalition holds 40% of the land, losing bases to
// raids (AI groups taking each other's bases, giving them up when outmatched, keeping yours), retreat before a raid,
// losing the hub with and without another base (the exiles, autopilot on and off, every screen rendered), a lost
// base's walls weak at first and patched up later, retaking it, a base battle's way out on the side away from the
// attack and what pulling out of each base battle does, save/load of a captured base and of one they hold.
// Usage: node tools/conquertest.js [seed=42]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, day, alive, makeSurvivor, checkGameOver, newId, snapshot } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { addBuilding, baseWalls } from "../src/sim/buildings.js";
import { launchExpedition, partyMembers, partyTile, outpostName, orderOptions, planPath, giveOrder as giveOrderP } from "../src/sim/parties.js";
import { attitude, recomputeOwnership, resolveRaidOnFaction, resolveRaidOnPlayer, factionsDaily, keepChance, RAIDS, strength } from "../src/sim/factions.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { createBattle, finishCombat, inEvac, autoPlayerTurn, runEnemyPhase } from "../src/sim/combat.js";
import { battles as isoBattles } from "./isobattles.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { breakFixture, fixtures } from "../src/sim/breakdowns.js";
import * as A from "../src/sim/alliance.js";
import * as C from "../src/sim/conquest.js";
import * as D from "../src/sim/diplomacy.js";

// Setting up a camp takes an hour (staging.js STAGING.PITCH): skipped here, the camp (a base) stands at once.
const establishNow = (st, p) => { p.pitched = true; return giveOrderP(st, p, "establish"); };

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
// erasOff: the eras' clocks (eras.js: no victory before year 6, the Accord held a year, a season clear of hives) are
// tools/eratest.js's; here the victory rules themselves are checked, at the moment their conditions are met.
// noWanderers: people met on the road (wanderers.js) would stop the teams under test with cards nobody answers here.
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; return st; };
const pick = (card, re) => card.choices.find((c) => re.test(c.label));
const free = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain" && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t);
function nearFree(st, from, lo, hi, avoid = []) {
  const g = st.grid;
  return g.within(from, hi).find((t) => g.distance(t, from) >= lo && free(st, t) && avoid.every((a) => g.distance(a, t) >= 3) && planPath(st, from, t, false));
}
function outpost(st, tile, people = 2) {
  const b = { id: newId(), tile, type: "outpost", name: outpostName(st, tile), stock: { food: 60, water: 40, fuel: 4, meds: 2, ammo: 40, parts: 1, scrap: 30, preserved: 0, jars: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(b);
  for (let i = 0; i < people; i++) { const s = makeSurvivor(st, 0.9); s.location = { kind: "base", baseId: b.id }; s.role = "guard"; st.survivors.push(s); }
  recomputeOwnership(st);
  return b;
}
function fighters(st, n, at) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = 10; s.health = 100;
    s.gear.weapon = { key: "assault", name: GEAR.assault ? GEAR.assault.name : "Rifle", quality: 1 };
    if (!GEAR.assault) s.gear.weapon = { key: "shotgun", name: GEAR.shotgun.name, quality: 1 };
    s.gear.armor = { key: "vest", name: GEAR.vest.name, quality: 1 };
    s.location = { kind: "base", baseId: at.id };
    st.survivors.push(s);
    out.push(s);
  }
  return out;
}
// A group with a second base (near the hub) to take.
function groupWithTwoBases(st) {
  const h = hub(st);
  const f = st.factions.find((x) => x.alive && x.type === "raider") || st.factions.find((x) => x.alive);
  f.known = true;
  f.goodwill = -60;
  const t = nearFree(st, h.tile, 4, 8);
  f.bases.push(t);
  f.pop = Math.max(f.pop, 20);
  recomputeOwnership(st);
  return { f, tile: t };
}
const tick = (st, hours) => { for (let i = 0; i < hours && !st.gameOver; i++) tickHour(st); };

// ======================================================================================
section("Taking a base by hand (captureBase)");
{
  const st = world();
  const { f, tile } = groupWithTwoBases(st);
  const land0 = A.controlledLand(st).pct;
  const pop0 = f.pop, stock0 = food(f), n0 = st.bases.length;
  const force = C.assaultForce(st, f, tile);
  check(force.count >= 3 && force.power > 0 && force.fortified >= 1, `defenders: ${force.count} × ${force.power}, walls ×${force.fortified}`);
  check(C.assaultForce(st, f, f.bases[0]).count >= force.count, "the main base holds at least as many defenders");
  const text = C.captureBase(st, f, tile, null, {});
  const b = st.bases.find((x) => x.tile === tile);
  check(!!b && b.type === "outpost" && b.captured && b.captured.from === f.id, `the base is your outpost (${text.slice(0, 80)}…)`);
  check(st.bases.length === n0 + 1 && !f.bases.includes(tile), "it left their bases list and joined yours");
  check(f.pop < pop0 && food(f) < stock0 && (food(b) || 0) > 0, `their people and stores fell (${pop0}→${f.pop}), part of the stores is yours (${food(b)} food)`);
  check(A.controlledLand(st).pct > land0, `your land grew (${(land0 * 100).toFixed(1)}% → ${(A.controlledLand(st).pct * 100).toFixed(1)}%)`);
  check(A.baseRadius(st, b) === A.controlRadius(st, "stronghold"), `a captured group base reaches ${A.baseRadius(st, b)} tiles (an outpost ${A.controlRadius(st, "outpost")})`);
  check(f.alive && st.conquest.stats.taken === 1 && C.infamy(st) > 0, `the group lives on with ${f.bases.length} base(s); infamy ${C.infamy(st)}`);
  check(st.tiles[tile].owner === "player", "the land around it is yours on the map");
}

section("Assault their base: the mission end to end (headless, by the numbers)");
{
  const st = world();
  const h = hub(st);
  const { f, tile } = groupWithTwoBases(st);
  const squad = fighters(st, 6, h);
  Object.assign(h.stock, { ammo: 400, water: 200, meds: 20 }); setFood(h, 200);
  check(orderOptions(st, { path: [tile], idx: 0, supplies: {}, cargo: { supplies: {}, gear: [] } }).some((o) => o.mission === "assault"), "the orders offer Assault their base on a group's base");
  const res = launchExpedition(st, { memberIds: squad.map((s) => s.id), dest: tile, mission: "assault", stance: "normal", supplies: { food: 20, water: 20, ammo: 120, meds: 4 } });
  check(!res.error, `the team leaves (${res.error || "ok"})`);
  // The road there is other tools' business: the team is put at the gates and given the order there.
  const { giveOrder } = await import("../src/sim/parties.js");
  if (res.party) { res.party.path = [tile]; res.party.idx = 0; giveOrder(st, res.party, "assault"); }
  const card = st.cards.find((c) => c.assault);
  check(!!card, "at their gates: the assault card");
  if (card) {
    const storm = pick(card, /^Storm/);
    check(/\d+%/.test(storm.hint), `it shows the odds (${storm.hint.slice(0, 60)}…)`);
    f.pop = 8; // a small garrison: the win is near certain
    const tries = [];
    st.cards.splice(st.cards.indexOf(card), 1);
    storm.resolve(st);
    tries.push(st.bases.some((b) => b.tile === tile));
    check(tries[0], "the storm won: the base is yours");
    check(attitude(f) === "Hostile" && !f.pact, "they are hostile, no pact");
    const p = res.party;
    check(!st.parties.includes(p) || partyMembers(st, p).length < 6, "some of the team stayed to hold it");
    const garrison = atBase(st, st.bases.find((b) => b.tile === tile)?.id).length;
    check(garrison >= 1 && garrison <= 2, `${garrison} of the team hold it`);
  }
  // A failed one: a lone fighter against a fortress base.
  const st2 = world();
  const h2 = hub(st2);
  const { f: f2, tile: t2 } = groupWithTwoBases(st2);
  f2.pop = 40;
  const lone = makeSurvivor(st2, 0.5); lone.location = { kind: "base", baseId: h2.id }; st2.survivors.push(lone);
  const r2 = launchExpedition(st2, { memberIds: [lone.id], dest: t2, mission: "assault", stance: "normal", supplies: { food: 10, water: 10, ammo: 20 } });
  if (r2.party) { r2.party.path = [t2]; r2.party.idx = 0; giveOrder(st2, r2.party, "assault"); }
  const c2 = st2.cards.find((c) => c.assault);
  if (c2) { st2.cards.splice(st2.cards.indexOf(c2), 1); pick(c2, /^Storm/).resolve(st2); }
  check(f2.bases.includes(t2), "a hopeless assault leaves the base theirs");
}

section("The last base: the group is broken (factions.js collapseFaction)");
{
  const st = world();
  const f = st.factions.find((x) => x.alive);
  f.known = true;
  while (f.bases.length > 1) f.bases.pop();
  const raid = { id: newId(), owner: f.id, kind: "raid", path: [f.bases[0]], idx: 0, strength: 5, target: { kind: "faction", factionId: 0, tile: 0 } };
  st.parties.push(raid);
  const tile = f.bases[0];
  C.captureBase(st, f, tile, null, {});
  check(!f.alive && !f.bases.length, `${f.name} is gone`);
  check(!st.parties.includes(raid), "its parties went with it");
  check(st.bases.some((b) => b.tile === tile), "its last base is yours");
  check(st.conquest.stats.defeated === 1, "counted as defeated");
  check(!A.goalsProgress(st).alliance.outside.includes(f.id), "it no longer counts for the coalition victory");
}

section("Goodwill and infamy");
{
  const st = world();
  D.ensureDiplo(st);
  const live = st.factions.filter((x) => x.alive);
  const [victim, partner, friend, enemy, peaceful] = live;
  for (const x of live) { x.known = true; }
  victim.goodwill = -60;
  D.ensureDiplo(st).pacts.push({ a: victim.id, b: partner.id, since: 1 });
  D.changeRelation(st, victim, friend, 100);
  D.changeRelation(st, victim, enemy, -200);
  const gw = (x) => x.goodwill;
  const before = { partner: gw(partner), friend: gw(friend), enemy: gw(enemy) };
  while (victim.bases.length > 1) victim.bases.pop();
  C.captureBase(st, victim, victim.bases[0], null, {});
  check(gw(partner) < before.partner, `pact partner: ${before.partner.toFixed(0)} → ${gw(partner).toFixed(0)}`);
  check(gw(friend) < before.friend, `friend: ${before.friend.toFixed(0)} → ${gw(friend).toFixed(0)}`);
  check(gw(enemy) > before.enemy, `enemy: ${before.enemy.toFixed(0)} → ${gw(enemy).toFixed(0)}`);
  // Infamy: peaceful groups want more goodwill to join, and drift away above 20.
  const peace = st.factions.find((x) => x.alive && ["traders", "commune", "military", "fortress"].includes(x.type)) || peaceful;
  st.conquest.infamy = 40;
  peace.goodwill = 55; peace.pact = "trade"; peace.known = true;
  check(C.inviteGoodwill(st, peace, A.ALLIANCE.GOODWILL) === 70, `a peaceful group wants goodwill 50 + 40/2 = ${C.inviteGoodwill(st, peace, A.ALLIANCE.GOODWILL)} to join`);
  const bandit = st.factions.find((x) => x.alive && ["raider", "zealot", "expansionist"].includes(x.type));
  check(!bandit || C.inviteGoodwill(st, bandit, A.ALLIANCE.GOODWILL) === 50, "a raider-type group does not care");
  const g0 = peace.goodwill;
  C.conquestDaily(st);
  check(peace.goodwill < g0 && C.infamy(st) < 40, `above 20 they grow wary (${g0} → ${peace.goodwill.toFixed(2)}) and infamy fades (${C.infamy(st).toFixed(1)})`);
  // Attacking a coalition member: they leave.
  const st2 = world();
  const m = st2.factions.find((x) => x.alive);
  const A2 = A.ensureAlliance(st2);
  A2.members.push(m.id); m.pact = "trade"; m.goodwill = 80; m.known = true;
  const team = fighters(st2, 2, hub(st2));
  const p = launchExpedition(st2, { memberIds: team.map((s) => s.id), dest: m.bases[0], mission: "assault", stance: "normal", supplies: { food: 6, water: 6 } }).party;
  check(/coalition/.test(C.assaultWarning(st2, m)) && /pact/.test(C.assaultWarning(st2, m)), "the warning names the coalition and the pact");
  p.path = [m.bases[0]]; p.idx = 0;
  C.startAssault(st2, p, m);
  check(!A.isMember(st2, m) && !m.pact && m.goodwill <= 50, `attacking a member: out of the coalition, no pact, goodwill ${m.goodwill}`);
}

section("The coalition victory: only members left, more than half the land, hives standing");
{
  const st = world();
  const live = st.factions.filter((x) => x.alive);
  const AL = A.ensureAlliance(st);
  const [keep, ...rest] = live;
  keep.known = true; keep.pact = "trade"; keep.goodwill = 80; AL.members.push(keep.id);
  check(!A.allianceVictory(st), "not with groups outside");
  for (const f of rest) { while (f.bases.length > 1) f.bases.pop(); C.captureBase(st, f, f.bases[0], null, {}); }
  check(rest.every((f) => !f.alive), `${rest.length} groups broken`);
  const gp = A.goalsProgress(st);
  check(gp.alliance.allIn && gp.alliance.outsiders.length === 0, "every group still standing is a member");
  // Outposts until over half (the land rule).
  let n = 0;
  const g = st.grid;
  while (!A.goalsProgress(st).alliance.landOk && n < 40) {
    const held = new Uint8Array(st.tiles.length);
    for (const c of A.landCentres(st)) for (const id of g.within(c.tile, c.r)) held[id] = 1;
    const t = st.tiles.find((x) => x.terrain !== "water" && !held[x.id] && free(st, x.id));
    if (!t) break;
    outpost(st, t.id, 1);
    n++;
  }
  check(st.hives.length > 0, `hives still stand (${st.hives.length})`);
  check(A.controlledLand(st).pct > A.ALLIANCE.LAND_NEEDED && !A.allianceVictory(st), "with hives standing there is no victory yet (2026-10-13: no hive may stand), whatever the land");
  const hives0 = st.hives.slice(), sites0 = st.hiveSites.slice();
  st.hives.length = 0; st.hiveSites.length = 0;
  check(A.allianceVictory(st), `victory: land ${(A.controlledLand(st).pct * 100).toFixed(1)}% with ${n} outposts, ${st.bases.filter((b) => b.captured).length} captured bases, no hive, no group outside`);
  check(checkGameOver(st) && st.victory && st.victoryReason === "alliance" && st.log.some((l) => /^The Calder Coalition holds/.test(l.text)), "checkGameOver: the coalition's victory and its line");
  check(st.hivesWon === true, "with no hive standing it is both victories at once");
  st.hives.push(...hives0); st.hiveSites.push(...sites0);
  // Nobody left at all: you alone.
  const st3 = world();
  for (const f of st3.factions.filter((x) => x.alive)) { while (f.bases.length > 1) f.bases.pop(); C.captureBase(st3, f, f.bases[0], null, {}); }
  check(A.goalsProgress(st3).alliance.allIn, "no group left: you alone count as the whole coalition");
  // The hive victory alone (no coalition) still works.
  const st2 = world();
  st2.hives.length = 0; st2.hiveSites.length = 0;
  check(checkGameOver(st2) && st2.victoryReason === "hives", "destroying every hive is still the hive victory");
}

section("Late gangs: raider bands that settle, at any time; the coalition's conditions are met at once (the Accord's year is eratest.js's)");
{
  const V = await import("../src/sim/visitors.js");
  const st = world();
  tick(st, 24 * 30);
  st.cards.length = 0;
  // A band with people and loot in the middle of the map.
  const n0 = st.factions.length;
  const v = V.spawnVisitor(st, "raiders", { size: 9, power: 3 });
  check(!!v, "a raider band crosses the border");
  if (v) {
    const g = st.grid;
    const spot = st.tiles.find((t) => t.loc && t.loc.type !== "city" && t.loc.zone !== "urban" && t.terrain !== "water" && !t.hive && t.owner == null && st.bases.every((b) => g.distance(b.tile, t.id) >= 8) && st.factions.every((f) => !f.alive || f.bases.every((x) => g.distance(x, t.id) >= 10)));
    v.tile = spot.id; v.path = [spot.id]; v.idx = 0; v.phase = "travel";
    for (const k of Object.keys(v.stock)) v.stock[k] = 0;
    setFood(v, 30); v.stock.ammo = 120; // too poor to settle (value below SETTLE.goods)
    for (let d = 0; d < 30; d++) V.visitorsDaily(st);
    check(st.factions.length === n0, `a band without the goods to start a base does not settle`);
    if (!st.visitors.includes(v)) st.visitors.push(v);
    setFood(v, 200); v.stock.scrap = 60; v.tile = spot.id; v.path = [spot.id]; v.idx = 0; v.phase = "travel";
    for (let d = 0; d < 120 && st.factions.length === n0; d++) V.visitorsDaily(st);
    const gang = st.factions[st.factions.length - 1];
    check(st.factions.length === n0 + 1 && gang.alive && gang.pop === 9 && attitude(gang) === "Hostile", `with people and loot it digs in: ${gang.name}, ${gang.pop} people, hostile`);
    check(!st.visitors.includes(v) && (food(gang) || 0) >= 200, "the band is gone from the outsiders, its loot is the gang's stores");
    check(st.log.some((l) => /dug in at|digging in/.test(l.text)), "the log says so");
    check((st.stats.bandsSettled || 0) === 1, "counted");
  }
  // Late: even with the coalition at 50% land, gangs from the border still come (no cap).
  const st2 = world();
  st2.noNewGangs = false; st2.hour = 24 * 400;
  for (const f of st2.factions) f.alive = false, f.bases = [];
  let s2 = 0;
  for (let i = 0; i < 1500; i++) { const k = st2.factions.length; factionsDaily(st2); if (st2.factions.length > k) { s2++; for (const f of st2.factions) if (f.alive) { f.alive = false; f.bases = []; } } }
  check(s2 >= 4, `new gangs keep coming at any time, with no cap (${s2} in 1500 days)`);
  // The victory is instant: a member and over half the land at one moment wins, a gang arriving later does not matter
  // (alliance.js: groups outside the coalition no longer block it; one group is kept and joins, the rest are broken).
  const st3 = world();
  const kept = st3.factions.find((x) => x.alive);
  for (const f of st3.factions.filter((x) => x.alive && x !== kept)) { while (f.bases.length > 1) f.bases.pop(); C.captureBase(st3, f, f.bases[0], null, {}); }
  kept.known = true; kept.pact = "trade"; kept.goodwill = 80; A.ensureAlliance(st3).members.push(kept.id);
  const g3 = st3.grid;
  for (let k = 0; k < 40 && !A.goalsProgress(st3).alliance.landOk; k++) {
    const held = new Uint8Array(st3.tiles.length);
    for (const c of A.landCentres(st3)) for (const id of g3.within(c.tile, c.r)) held[id] = 1;
    const t = st3.tiles.find((x) => x.terrain !== "water" && !held[x.id] && free(st3, x.id));
    if (!t) break;
    outpost(st3, t.id, 1);
  }
  const { makeGang } = await import("../src/sim/factions.js");
  const far = st3.tiles.find((t) => t.loc && free(st3, t.id) && st3.bases.every((b) => g3.distance(b.tile, t.id) >= 8));
  const hv3 = st3.hives.slice(), sites3 = st3.hiveSites.slice();
  st3.hives.length = 0; st3.hiveSites.length = 0; // the rule (2026-10-13): no hive stands
  check(A.allianceVictory(st3), "with no hive and every group in or broken the coalition wins");
  const late = makeGang(st3, far.id, { pop: 10 });
  check(late.alive && !A.allianceVictory(st3), "a gang that settles outside the coalition blocks the win again (2026-10-13: no enemy group may be left)");
  while (late.bases.length) C.captureBase(st3, late, late.bases[0], null, {});
  check(!late.alive && A.allianceVictory(st3) && checkGameOver(st3) && st3.victoryReason === "alliance", "beaten: the coalition wins at that moment");
  st3.hives.push(...hv3); st3.hiveSites.push(...sites3);
}

section("A group breaks at 3 people");
{
  const st = world();
  const f = st.factions.find((x) => x.alive);
  f.pop = 4;
  factionsDaily(st);
  check(f.alive, "4 people: still a group");
  f.pop = 3; setFood(f, 5); // no food to spare: nobody new joins today
  factionsDaily(st);
  check(!f.alive, "3 people: it collapses (factions.js GROUP_BREAK)");
  // A war grinds a group all the way down (no floor at 8 any more).
  const st2 = world();
  const [a, b] = st2.factions.filter((x) => x.alive);
  D.ensureDiplo(st2);
  const w = { id: 77, a: a.id, b: b.id, start: 1, score: {}, exh: {}, captives: {}, raids: 0, reason: "land" };
  st2.diplo.wars.push(w);
  b.pop = 6;
  let raids = 0;
  while (b.alive && raids < 200) { raids++; resolveRaidOnFaction(st2, { owner: a.id, strength: 400, warId: 77, target: { kind: "faction", factionId: b.id, tile: b.bases[0] } }, []); }
  check(!b.alive, `war raids ground ${b.name} down to 3 and it collapsed (${raids} raids)`);
}

section("Razing: aggressive raiders may burn a base instead of keeping it");
{
  const { razeChance, baseFate, RAIDS: R } = await import("../src/sim/factions.js");
  const st = world();
  const fs = st.factions.filter((x) => x.alive);
  const raider = fs[0], peaceful = fs[1];
  raider.type = "raider"; peaceful.type = "commune";
  const t = nearFree(st, raider.bases[0], 2, 5);
  check(razeChance(st, peaceful, t) === 0, "peaceful types never raze");
  const near = razeChance(st, raider, t);
  raider.grudge = 4;
  const angry = razeChance(st, raider, t);
  const farT = st.tiles.find((x) => free(st, x.id) && st.grid.distance(x.id, raider.bases[0]) >= 25);
  const far = farT ? razeChance(st, raider, farT.id) : angry;
  check(near > 0 && angry > near && far >= angry, `raiders: ${(near * 100).toFixed(0)}% next door, ${(angry * 100).toFixed(0)}% with a grudge, ${(far * 100).toFixed(0)}% far from their bases`);
  raider.grudge = 0;
  let fates = { raze: 0, keep: 0, leave: 0 };
  for (let i = 0; i < 400; i++) fates[baseFate(st, raider, t)]++;
  check(fates.raze > 0 && fates.keep > 0 && fates.leave > 0, `fates over 400 rolls: ${JSON.stringify(fates)}`);
  // Your outpost razed.
  let razed = 0, first = null;
  for (let i = 0; i < 16 && !first; i++) {
    const s = world(seed + 40 + i);
    const f = s.factions.find((x) => x.alive);
    f.type = "raider"; f.pop = 40; f.goodwill = -90; f.grudge = 8;
    const tt = s.tiles.find((x) => free(s, x.id) && s.grid.distance(x.id, f.bases[0]) >= 20 && s.grid.distance(x.id, hub(s).tile) <= 12 && planPath(s, hub(s).tile, x.id, false));
    if (!tt) continue;
    const o = outpost(s, tt.id, 2);
    for (let k = 0; k < 3; k++) addBuilding(o, k ? "bunkhouse" : "walls");
    const raid = { id: newId(), owner: f.id, kind: "raid", path: [tt.id], idx: 0, strength: 300, siegeHours: 8, target: { kind: "player", baseId: o.id, tile: tt.id } };
    s.parties.push(raid);
    const r = resolveRaidOnPlayer(s, raid);
    if (r && r.outcome === "razed") { razed++; first = { s, o, tt, f }; }
  }
  check(!!first, `an outpost overrun by angry raiders far from home is razed (${razed} in the tries)`);
  if (first) {
    const { s, o, tt } = first;
    check(!s.bases.includes(o) && !C.occupiedAt(s, tt.id) && !s.factions.some((x) => x.bases.includes(tt.id)), "the base is gone: not yours, not theirs");
    check(!!s.tiles[tt.id].ruin && s.tiles[tt.id].loot > 0.1, "the tile is a ruin with a little to scavenge");
    check(s.parties.some((p) => p.owner === "player" && p.teamMission === "retreat"), "its people walk to the hub");
    check(s.cards.some((c) => / burned$/.test(c.title)), "a card says it burned");
    const { outpostScrap } = await import("../src/sim/parties.js");
    const { CAMP } = await import("../src/sim/buildings.js");
    check(outpostScrap(s, tt.id) === 0 && CAMP.ruinScrap === 10, "a camp set up on the ruins needs nothing carried and builds up for 10 scrap less (buildings.js tierUpJobFor)");
    const UI = await import("../src/ui/ui.js");
    check(/Ruins of /.test(UI.renderRight(s, { started: true, selected: tt.id, tab: "bases" })), "the tile panel shows the ruins");
    const l = deserializeState(JSON.parse(JSON.stringify(serializeState(s, { dropCards: true }))));
    check(!!l.tiles[tt.id].ruin, "save/load keeps the ruin");
  }
  // The hub razed: the nearest base becomes the hub.
  const s2 = world();
  const h2 = hub(s2);
  const o2 = outpost(s2, nearFree(s2, h2.tile, 4, 8), 2);
  C.razePlayerBase(s2, h2, s2.factions.find((x) => x.alive));
  check(hub(s2) === o2 && !!s2.tiles[h2.tile].ruin, `the hub burned: ${o2.name} is the hub, the old one a ruin`);
  // Between groups: a raid that razes leaves a ruin nobody holds.
  const s3 = world();
  const [a3, b3] = s3.factions.filter((x) => x.alive);
  a3.type = "raider"; a3.pop = 60; a3.grudge = 8;
  const extra = nearFree(s3, b3.bases[0], 2, 5);
  b3.bases.push(extra);
  for (let i = 0; i < 60 && b3.bases.includes(extra); i++) { b3.pop = 20; resolveRaidOnFaction(s3, { owner: a3.id, strength: 300, target: { kind: "faction", factionId: b3.id, tile: extra } }, []); }
  check(!b3.bases.includes(extra), "a crushing raid takes the base from them");
  check((s3.stats.razedGroups || 0) + (a3.bases.includes(extra) ? 1 : 0) + (s3.stats.abandonedBases || 0) + (s3.stats.leftBases || 0) >= 1, `kept, razed, abandoned or left standing (razed ${s3.stats.razedGroups || 0}, left ${s3.stats.leftBases || 0})`);
  // The warning card names the risk.
  const s4 = world();
  const f4 = s4.factions.find((x) => x.alive);
  f4.type = "raider"; f4.grudge = 8; f4.goodwill = -90;
  const t4 = nearFree(s4, hub(s4).tile, 4, 8);
  const o4 = outpost(s4, t4, 2);
  const r4 = { id: newId(), owner: f4.id, kind: "raid", path: [t4], idx: 0, strength: 40, target: { kind: "player", baseId: o4.id, tile: t4 } };
  s4.parties.push(r4);
  const { raidWarning } = await import("../src/sim/factions.js");
  raidWarning(s4, r4);
  const wc = s4.cards.find((c) => /^Raiders heading for/.test(c.title));
  check(wc && /burn what they cannot hold/.test(wc.text), "the raid warning says this gang burns what it cannot hold");
}

section("Raids that keep bases: between groups, and yours");
{
  const st = world();
  const [a, b] = st.factions.filter((x) => x.alive);
  a.type = "expansionist"; a.pop = 40; a.known = b.known = true;
  const extra = nearFree(st, b.bases[0], 2, 5);
  b.bases.push(extra);
  check(keepChance(st, a, extra) > 0, `keepChance for an expansionist next door: ${(keepChance(st, a, extra) * 100).toFixed(0)}%`);
  a.bases = a.bases.slice(0, 1);
  const before = a.bases.length;
  let took = 0, abandoned0 = st.stats.abandonedBases || 0;
  for (let i = 0; i < 30 && b.bases.includes(extra); i++) {
    b.pop = 20;
    resolveRaidOnFaction(st, { owner: a.id, strength: 200, target: { kind: "faction", factionId: b.id, tile: extra } }, []);
  }
  took = a.bases.includes(extra) ? 1 : 0;
  check(!b.bases.includes(extra), "a crushing raid takes the base from them");
  check(took || (st.stats.abandonedBases || 0) > abandoned0 || a.bases.length === before, `kept by the raiders (${took}) or left empty`);
  // Your outpost overrun: kept by the raiders sometimes.
  let kept = 0;
  for (let i = 0; i < 12; i++) {
    const s = world(seed + i);
    const f = s.factions.find((x) => x.alive);
    f.type = "expansionist"; f.pop = 40; f.goodwill = -80;
    const t = nearFree(s, f.bases[0], 2, 6);
    if (t == null) continue;
    const o = outpost(s, t, 2);
    const raid = { id: newId(), owner: f.id, kind: "raid", path: [t], idx: 0, strength: 300, siegeHours: 8, target: { kind: "player", baseId: o.id, tile: t } };
    s.parties.push(raid);
    resolveRaidOnPlayer(s, raid);
    if (C.occupiedAt(s, t)) {
      kept++;
      if (kept === 1) {
        check(!s.bases.includes(o) && f.bases.includes(t), "the outpost is theirs: off your list, on theirs");
        const team = s.parties.find((p) => p.owner === "player" && p.teamMission === "retreat");
        check(!!team || !alive(s).some((x) => x.location.kind === "base" && x.location.baseId === o.id), "its people left it as a team");
        const occ = C.occupiedAt(s, t);
        check(occ.garrison >= C.CONQUEST.GARRISON_MIN, `a garrison of ${occ.garrison}`);
        check(s.cards.some((c) => c.lostBase === t), "a card says it fell and how to take it back");
        check(A.goalsProgress(s).alliance.lost.some((x) => x.tile === t), "the Goals panel lists it to retake");
      }
    }
  }
  check(kept >= 3, `an overrun outpost is kept by the raiders in ${kept} of 12 tries`);
}

section("Retreat before a raid");
{
  const st = world();
  const h = hub(st);
  const f = st.factions.find((x) => x.alive);
  f.goodwill = -80; f.known = true;
  const t = nearFree(st, h.tile, 4, 7);
  const o = outpost(st, t, 3);
  const raid = { id: newId(), owner: f.id, kind: "raid", path: [f.bases[0], t], idx: 0, strength: 60, target: { kind: "player", baseId: o.id, tile: t } };
  st.parties.push(raid);
  const { raidWarning } = await import("../src/sim/factions.js");
  raidWarning(st, raid);
  const card = st.cards.find((c) => /^Raiders heading for/.test(c.title));
  const away = card && card.choices.find((c) => c.retreat);
  check(!!away && away.label === `Retreat to ${h.name}`, `the warning offers "${away ? away.label : "?"}"`);
  const people = atBase(st, o.id).map((s) => s.id);
  st.cards.length = 0;
  away.resolve(st);
  check(!atBase(st, o.id).length, "everyone left the outpost");
  const team = st.parties.find((p) => p.owner === "player" && p.members.some((id) => people.includes(id)));
  check(!!team && team.phase === "back", "they walk to the hub as a team");
  check(team && (food(team) || 0) + (team.supplies.water || 0) > 0, `carrying ${team ? Object.entries(team.supplies).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${k}`).join(", ") : "?"}`);
  tick(st, 48);
  check(people.every((id) => { const s = st.survivors.find((x) => x.id === id); return !s.alive || (s.location.kind === "base" && s.location.baseId === h.id); }), "they arrive at the hub");
  resolveRaidOnPlayer(st, raid);
  check(f.bases.includes(t) && !st.bases.includes(o) && !!C.occupiedAt(st, t), "the raiders walked in and keep it");
  check(st.conquest.stats.retreats === 1, "counted as a retreat");
}

section("Losing the hub: with another base, and with none (the exiles)");
{
  const st = world();
  const h = hub(st);
  const f = st.factions.find((x) => x.alive);
  f.goodwill = -80;
  const t = nearFree(st, h.tile, 5, 9);
  const o = outpost(st, t, 2);
  const n = atBase(st, h.id).length;
  C.occupyPlayerBase(st, h, f, { garrison: 6, outcome: "overrun" });
  check(hub(st) === o && o.type === "hub", `${o.name} is the hub now`);
  const team = st.parties.find((p) => p.owner === "player" && p.teamMission === "retreat");
  check(!!team && partyMembers(st, team).length === n && team.homeBaseId === o.id, `the ${n} at the old hub walk to it`);
  tick(st, 24 * 5);
  check(!st.gameOver && atBase(st, o.id).length >= 2, `day ${day(st)}: they are at the new hub (${atBase(st, o.id).length} there)`);
  // No other base.
  const s2 = world();
  const h2 = hub(s2);
  const f2 = s2.factions.find((x) => x.alive);
  const people = atBase(s2, h2.id).length;
  C.occupyPlayerBase(s2, h2, f2, { garrison: 6, outcome: "overrun" });
  check(!hub(s2) && !s2.bases.length, "no base left");
  const ex = s2.parties.find((p) => p.exile);
  check(!!ex && partyMembers(s2, ex).length === people, `the ${people} survivors are a team on the road`);
  const UI = await import("../src/ui/ui.js");
  const ui = { started: true, speed: 0, tab: "bases", selected: h2.tile, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false };
  let crash = "";
  try {
    for (let d = 0; d < 20 && !s2.gameOver; d++) {
      tick(s2, 24);
      for (const tab of ["bases", "people", "groups", "teams"]) { ui.tab = tab; UI.renderLeft(s2, ui); }
      UI.renderRight(s2, ui); UI.renderTopbar(s2, ui); UI.renderModal(s2, ui);
      s2.cards.length = 0;
    }
  } catch (e) { crash = e.stack.split("\n").slice(0, 3).join(" | "); }
  check(!crash, `20 days with no base (player's hands), every screen drawn: no crash ${crash}`);
  check(!s2.gameOver || !alive(s2).length, "the run goes on while anyone lives");
  const opts = ex && s2.parties.includes(ex) ? orderOptions(s2, ex) : [];
  check(!s2.parties.includes(ex) || s2.bases.length || opts.some((o) => o.mission === "establish" || o.mission === "assault") || s2.tiles[partyTile(ex)].terrain === "water", "the exiles can establish a base or retake one");
  check(!opts.some((o) => o.mission === "outpost"), "no Build outpost with no base (Establish base: a camp built up into the hub)");
  // No base for 60 days on several worlds, every card answered at random: nothing may assume a hub.
  let crash2 = "";
  for (const sd of [3, 5, 8, 13]) {
    const w = world(sd);
    tick(w, 24 * 40);
    w.cards.length = 0;
    while (w.bases.length) C.occupyPlayerBase(w, w.bases[w.bases.length - 1], w.factions.find((x) => x.alive), { garrison: 4 });
    let k = 0;
    try {
      for (let hr = 0; hr < 24 * 60 && !w.gameOver; hr++) {
        tickHour(w);
        for (let n = 0; n < 30 && w.cards.length; n++) {
          const c = w.cards.shift();
          const opts = c.choices.filter((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(w) : x.disabled));
          if (opts.length) opts[k++ % opts.length].resolve(w);
        }
      }
    } catch (e) { crash2 += ` seed ${sd} day ${day(w)}: ${e.stack.split("\n").slice(0, 2).join(" | ")}`; }
  }
  check(!crash2, `60 days with no base on 4 worlds, cards answered at random: no crash${crash2}`);
  // A new base founded by the exiles: Establish base, a camp (the barest base) built up into the hub (staging.js).
  const S = await import("../src/sim/staging.js");
  const s3 = world();
  const h3 = hub(s3);
  C.occupyPlayerBase(s3, h3, s3.factions.find((x) => x.alive), { garrison: 4 });
  const ex3 = s3.parties.find((p) => p.exile);
  s3.noWanderers = true;
  for (let i = 0; i < 96 && ex3.phase !== "waiting"; i++) { tickHour(s3); s3.cards.length = 0; }
  Object.assign(ex3.cargo.supplies, { scrap: 25, parts: 3, water: 40, buildmat: 3 }); setFood(ex3.cargo, 40);
  const { giveOrder } = await import("../src/sim/parties.js");
  const est = orderOptions(s3, ex3).find((o) => o.mission === "establish");
  check(!!est && est.label === S.ESTABLISH_LABEL && !est.disabled, `the exiles get the order ${S.ESTABLISH_LABEL} (${est && est.disabled})`);
  if (ex3.phase === "waiting") establishNow(s3, ex3);
  const B0 = await import("../src/sim/buildings.js");
  const camp3 = s3.bases.find((b) => B0.isCamp(b));
  check(!!camp3 && hub(s3) === camp3 && camp3.tile === partyTile(ex3) && !camp3.first && !s3.parties.includes(ex3), "it sets up a camp (a base, the hub while it is the only one); the team moves in");
  const job3 = camp3 && B0.tierUpJob(camp3);
  check(job3 && job3.type === "camp_up" && B0.gatherRows(job3).find((r) => r.key === "buildmat").need === S.STAGING.EXILE.needs.buildmat && job3.hours === S.STAGING.EXILE.work, `the exiles' camp builds up into a shelter: ${S.needText(S.STAGING.EXILE.needs)}, ${S.STAGING.EXILE.work} work-hours`);
  const d3 = day(s3);
  for (let i = 0; i < 24 * 10 && camp3 && B0.isCamp(camp3); i++) { tickHour(s3); s3.cards.length = 0; }
  check(!!hub(s3) && hub(s3) === camp3 && !B0.isCamp(camp3), `the camp becomes the shelter after the work (${hub(s3) ? `${hub(s3).name}, day ${day(s3)}, started day ${d3}` : "none"})`);
  check(!hub(s3) || food(hub(s3)) >= 20, `the camp's stores are its stock (${hub(s3) && food(hub(s3)).toFixed(1)} days of food)`);
  // Camp → shelter → base: the exiles' new home is a shelter (tier 0) first, then their builders build it up.
  const B = await import("../src/sim/buildings.js");
  const sh3 = hub(s3);
  if (sh3) {
    check(B.isShelter(sh3) && B.tierName(sh3) === "Shelter" && B.baseWalls(sh3) === B.SHELTER.walls, "the exiles' camp becomes a shelter (tier 0): no wall strength");
    check(!B.canBuild(s3, sh3, "walls").ok && !B.canBuild(s3, sh3, "well").ok, "a shelter builds no walls or well");
    Object.assign(sh3.stock, { scrap: 120, parts: 6, buildmat: 6 }); // hub_up: 100 scrap, 5 building materials (2026-10-09)
    check(/queued/.test(B.queueBuild(s3, sh3, "hub_up")), "Build up into a base is queued at the shelter");
    for (const s of atBase(s3, sh3.id)) s.role = "build";
    for (let i = 0; i < 24 * 8 && B.isShelter(sh3); i++) { tickHour(s3); s3.cards.length = 0; for (const s of atBase(s3, sh3.id)) s.role = "build"; }
    check(!B.isShelter(sh3) && B.tierName(sh3) === "Main hub" && B.baseWalls(sh3) === 3, `the builders build it up into a base (day ${day(s3)})`);
  }
  // The autopilot with no base.
  const s4 = world(seed + 1);
  setAutopilot(s4, true, "balanced");
  tick(s4, 24 * 20);
  C.occupyPlayerBase(s4, hub(s4), s4.factions.find((x) => x.alive), { garrison: 4 });
  let err = "";
  try { tick(s4, 24 * 30); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" | "); }
  check(!err, `the autopilot with no base for 30 days: no crash ${err}`);
  check(!!hub(s4) || !alive(s4).length, `the autopilot built or took a new base (${hub(s4) ? hub(s4).name : "none"})`);
}

section("A lost base: weak walls at first, patched up later, then taken back");
{
  const st = world();
  const h = hub(st);
  const f = st.factions.find((x) => x.alive);
  f.goodwill = -80;
  const t = nearFree(st, h.tile, 4, 8);
  const o = outpost(st, t, 2);
  for (let i = 0; i < 3; i++) addBuilding(o, "walls");
  addBuilding(o, "bunkhouse");
  const walls0 = baseWalls(o);
  for (const fx of fixtures(o)) if (fx.type === "walls") breakFixture(st, o, fx, "test", { card: false, quiet: true });
  const id = o.id;
  C.occupyPlayerBase(st, o, f, { garrison: 6, outcome: "overrun" });
  const occ = C.occupiedAt(st, t);
  const early = C.assaultForce(st, f, t);
  check(occ && early.occupied && early.walls < walls0, `right after: walls ${early.walls} (were ${walls0}), garrison ${early.count}, defence ×${early.fortified}`);
  check(/Taken from you on day/.test(C.occupiedText(st, occ)) && /broken/i.test(C.occupiedText(st, occ)), `the tile panel line: ${C.occupiedText(st, occ)}`);
  const UI = await import("../src/ui/ui.js");
  const panel = UI.renderRight(st, { started: true, selected: t, tab: "bases" });
  check(/held by others/.test(panel) && /Retake the base/.test(panel), "the tile panel shows who holds it and offers Retake the base");
  for (let d = 0; d < 60; d++) C.conquestDaily(st);
  const late = C.assaultForce(st, f, t);
  check(late.fortified > early.fortified, `60 days later: walls ${late.walls}, defence ×${late.fortified} (they repaired it)`);
  const save = deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));
  const occL = C.occupiedAt(save, t);
  check(occL && occL.base.id === id && save.factions.find((x) => x.id === f.id).bases.includes(t), "save/load: the base they hold, its buildings and holder");
  C.captureBase(st, f, t, null, {});
  const back = st.bases.find((b) => b.tile === t);
  check(back && back.id === id && back.retaken && back.buildings.some((b) => b.type === "bunkhouse"), "taken back: the same base, its buildings as they stand");
  check(!C.occupiedAt(st, t) && st.conquest.stats.retaken === 1, "no longer on the lost list; counted as retaken");
  const save2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));
  const cap = save2.bases.find((b) => b.tile === t);
  check(cap && cap.retaken && A.controlledLand(save2).pct === A.controlledLand(st).pct, "save/load: a retaken base and the land it holds");
  // A captured group base survives a save too.
  const st5 = world();
  const g5 = groupWithTwoBases(st5);
  C.captureBase(st5, g5.f, g5.tile, null, {});
  const l5 = deserializeState(JSON.parse(JSON.stringify(serializeState(st5, { dropCards: true }))));
  const c5 = l5.bases.find((b) => b.tile === g5.tile);
  check(c5 && c5.captured && c5.captured.from === g5.f.id && A.baseRadius(l5, c5) === A.controlRadius(l5, "stronghold"), "save/load: a captured group base keeps its origin and reach");
  // Ruins: the holders broken, nobody takes it: it comes back to you empty.
  const st6 = world();
  const f6 = st6.factions.find((x) => x.alive);
  const t6 = nearFree(st6, hub(st6).tile, 4, 8);
  const o6 = outpost(st6, t6, 1);
  C.occupyPlayerBase(st6, o6, f6, { garrison: 3 });
  f6.alive = false; f6.bases = [];
  C.conquestDaily(st6);
  check(st6.bases.includes(o6) && !C.occupiedAt(st6, t6), "its holders gone: the base is yours again, empty");
}

section("Base battles: a way out on the side away from the attack, and what pulling out does");
{
  const st = world();
  const h = hub(st);
  const f = st.factions.find((x) => x.alive);
  f.goodwill = -80;
  const t = nearFree(st, h.tile, 4, 8);
  const o = outpost(st, t, 3);
  for (const fromSide of [1, -1]) {
    const from = st.grid.within(t, 6).find((x) => st.grid.distance(x, t) === 5 && (st.grid.toPixel(x, 1)[0] - st.grid.toPixel(t, 1)[0]) * fromSide > 3);
    const setup = { tile: t, baseId: o.id, enemy: { kind: "raiders", count: 5, power: 4, factionId: f.id, name: "x" }, ambush: null, canRetreat: true, handler: "none", layout: "baseDefence", deploy: true, context: { strip: true, baseId: o.id, factionId: f.id, fromTile: from } };
    const b = createBattle(st, setup);
    const evac = [];
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (inEvac(b, x, y)) evac.push([x, y]);
    const foes = b.units.filter((u) => u.side === "enemy");
    const ax = b.side === "north" || b.side === "south" ? 1 : 0, span = ax ? b.h : b.w;
    const ex = evac.reduce((a, c) => a + c[ax], 0) / Math.max(1, evac.length), fx = foes.reduce((a, u) => a + (ax ? u.y : u.x), 0) / Math.max(1, foes.length);
    check(evac.length > 0 && b.evacSide && Math.abs(ex - fx) > span / 3, `attack from the ${b.side}: the way out is the ${b.evacSide} edge (${evac.length} cells, mean ${ax ? "y" : "x"} ${ex.toFixed(1)} vs the attackers' ${fx.toFixed(1)})`);
    st.combat = null;
  }
  // raidDefense: pulling out abandons the base to the raiders.
  const raid = { id: newId(), owner: f.id, kind: "raid", path: [t], idx: 0, strength: 50, target: { kind: "player", baseId: o.id, tile: t } };
  st.parties.push(raid);
  const setup = { tile: t, baseId: o.id, enemy: { kind: "raiders", count: 5, power: 4, factionId: f.id }, canRetreat: true, handler: "raidDefense", layout: "baseDefence", deploy: true, context: { strip: true, raidId: raid.id, baseId: o.id, factionId: f.id } };
  const { GROUP_PRIORITIES: GP } = await import("../src/sim/groupcare.js");
  const raze = Object.fromEntries(Object.entries(GP).map(([k, v]) => [k, v.raze]));
  for (const v of Object.values(GP)) v.raze = 0; // what is checked is that they take it (burning it down instead is its own roll)
  finishCombat(st, setup, { outcome: "retreat", enemiesKilled: 1, enemiesLeft: 4, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] }, tactical: true, worn: true });
  for (const [k, v] of Object.entries(raze)) GP[k].raze = v;
  check(!st.bases.includes(o) && f.bases.includes(t), "pulling out of a raid fight: the raiders keep the base");
  check(st.parties.some((p) => p.owner === "player" && p.teamMission === "retreat"), "its people are on their way to the hub");
  // hordeBreakIn: the dead wreck it and move on, the base stays yours.
  const s2 = world();
  const h2 = hub(s2);
  const food0 = food(h2);
  const n2 = atBase(s2, h2.id).length;
  const hz = { id: newId(), tile: h2.tile, size: 120, role: "attack", bosses: 0 };
  s2.hordes.push(hz);
  finishCombat(s2, { tile: h2.tile, baseId: h2.id, enemy: { kind: "zombies", count: 10, power: 3 }, canRetreat: true, handler: "hordeBreakIn", context: { hordeId: hz.id, baseId: h2.id, through: 80, bosses: 0 } },
    { outcome: "retreat", enemiesKilled: 2, enemiesLeft: 8, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] }, tactical: true, worn: true });
  check(s2.bases.includes(h2) && atBase(s2, h2.id).length === n2 && food(h2) < food0, `pulling out of a horde fight: the hub stays yours, everyone back, food ${food0} → ${food(h2)}`);
}

section("The autopilot conquers (Aggressive, up to 400 days, seeds 3-6)");
{
  // Four worlds, each played until its first base is taken (or day 400): one world's course turns on chance (a
  // starving first winter ended seed 3 on day 99 once the AI groups' pens changed their food rolls, 2026-10-09), so
  // the check is that most of them storm and take bases, and that none crashes.
  let took = 0, errs = 0;
  const lines = [];
  for (const sd of [3, 4, 5, 6]) {
    const st = world(sd);
    st.noNewGangs = false;
    setAutopilot(st, true, "aggressive");
    let err = "";
    try { for (let i = 0; i < 24 * 400 && !st.gameOver && !(st.conquest && st.conquest.stats.taken > 0); i++) tickHour(st); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" | "); }
    if (err) { errs++; console.log(`  seed ${sd}: ${err}`); }
    const s = st.conquest ? st.conquest.stats : { assaults: 0, won: 0, taken: 0, retaken: 0, defeated: 0, basesLost: 0 };
    if (s.assaults > 0 && s.taken > 0) took++;
    lines.push(`seed ${sd} day ${day(st)}: ${s.assaults} assaults (${s.won} won), ${s.taken} taken${st.gameOver ? (st.victory ? " (won)" : " (fell)") : ""}`);
  }
  console.log(`  ${lines.join("; ")}`);
  check(!errs, `no crash (${errs})`);
  check(took >= 3, `it storms bases and takes some in most worlds (${took} of 4)`);
}

// Storming a group's base on its map with the AI playing your side (the battle's Auto, or a turn handed over): your
// people start outside its wall and get in (combat.js outsideBase holds only your own base's defenders inside), and
// every shot or blow is logged before the "is dead" it causes.
section("A base assault played by the AI on both sides");
{
  let stalled = 0, late = 0;
  const N = 12;
  for (let sd = 1; sd <= N; sd++) {
    const { st, b } = isoBattles(sd, ["base-assault"])[0];
    for (let g = 0; !b.over && g < 100; g++) { autoPlayerTurn(st); if (!b.over) runEnemyPhase(st); }
    if (!b.over) stalled++;
    const L = b.log.map((l) => l.text);
    for (let i = 1; i < L.length; i++) {
      const m = /^(.+) is dead\.$/.exec(L[i - 1]);
      if (m && (L[i].includes(`shoots ${m[1]}:`) || L[i].includes(`strikes ${m[1]} for`) || L[i].includes(`tears into ${m[1]} for`))) late++;
    }
  }
  // The autopilot switched on while the assault is still at its deploy step (autopilot.js finishLiveBattle) plays it
  // out to an outcome, not drops it.
  {
    const { st, b } = isoBattles(3, ["base-assault"])[0];
    const phase = b.phase;
    setAutopilot(st, true);
    check(phase === "deploy" && b.over && ["victory", "defeat", "retreat"].includes(b.result && b.result.outcome) && !st.combat, `the autopilot taking over at the deploy step plays the assault out (${phase} → ${(b.result && b.result.outcome) || "dropped"} on turn ${b.turn})`);
  }
  check(!stalled, `${N} base assaults on the AI's Auto all end within 100 turns (${stalled} stalled: your people stuck outside the wall)`);
  check(!late, `no shot or blow logged after the death it caused (${late})`);
  console.log(`  ${N} base assaults: ${stalled} stalled, ${late} kill lines out of order`);
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
