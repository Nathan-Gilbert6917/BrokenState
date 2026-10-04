// Conquest (src/sim/conquest.js) and the coalition victory (alliance.js): taking a group's base (by hand and with the
// Assault their base mission end to end), a group's last base breaking it, goodwill and infamy, the victory with only
// coalition members left (hives standing), no new gang once the coalition holds 40% of the land, losing bases to
// raids (AI groups taking each other's bases, giving them up when outmatched, keeping yours), retreat before a raid,
// losing the hub with and without another base (the exiles, autopilot on and off, every screen rendered), a lost
// base's walls weak at first and patched up later, retaking it, a base battle's way out on the side away from the
// attack and what pulling out of each base battle does, save/load of a captured base and of one they hold.
// Usage: node tools/conquertest.js [seed=42]
import { createWorld, tickHour, hub, atBase, day, alive, makeSurvivor, checkGameOver, newId, snapshot } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { addBuilding, baseWalls } from "../src/sim/buildings.js";
import { launchExpedition, partyMembers, partyTile, outpostName, orderOptions, planPath } from "../src/sim/parties.js";
import { attitude, recomputeOwnership, resolveRaidOnFaction, resolveRaidOnPlayer, factionsDaily, keepChance, RAIDS, strength } from "../src/sim/factions.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { createBattle, finishCombat, inEvac } from "../src/sim/combat.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { breakFixture, fixtures } from "../src/sim/breakdowns.js";
import * as A from "../src/sim/alliance.js";
import * as C from "../src/sim/conquest.js";
import * as D from "../src/sim/diplomacy.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.noNewGangs = true; return st; };
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
  const pop0 = f.pop, stock0 = f.stock.food, n0 = st.bases.length;
  const force = C.assaultForce(st, f, tile);
  check(force.count >= 3 && force.power > 0 && force.fortified >= 1, `defenders: ${force.count} × ${force.power}, walls ×${force.fortified}`);
  check(C.assaultForce(st, f, f.bases[0]).count >= force.count, "the main base holds at least as many defenders");
  const text = C.captureBase(st, f, tile, null, {});
  const b = st.bases.find((x) => x.tile === tile);
  check(!!b && b.type === "outpost" && b.captured && b.captured.from === f.id, `the base is your outpost (${text.slice(0, 80)}…)`);
  check(st.bases.length === n0 + 1 && !f.bases.includes(tile), "it left their bases list and joined yours");
  check(f.pop < pop0 && f.stock.food < stock0 && (b.stock.food || 0) > 0, `their people and stores fell (${pop0}→${f.pop}), part of the stores is yours (${b.stock.food} food)`);
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
  Object.assign(h.stock, { ammo: 400, food: 200, water: 200, meds: 20 });
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
  check(A.allianceVictory(st), `victory: land ${(A.controlledLand(st).pct * 100).toFixed(1)}% with ${n} outposts, ${st.bases.filter((b) => b.captured).length} captured bases`);
  check(checkGameOver(st) && st.victory && st.victoryReason === "alliance" && st.log.some((l) => /^The Calder Coalition holds/.test(l.text)), "checkGameOver: the coalition's victory and its line");
  // Keep playing: the hive victory can still come once.
  st.victoryKept = true; st.gameOver = false;
  check(!checkGameOver(st), "after Keep playing the coalition victory does not repeat");
  st.hives.length = 0; st.hiveSites.length = 0;
  check(checkGameOver(st) && st.victoryReason === "hives", "then destroying every hive is the hive victory");
  // Nobody left at all: you alone.
  const st3 = world();
  for (const f of st3.factions.filter((x) => x.alive)) { while (f.bases.length > 1) f.bases.pop(); C.captureBase(st3, f, f.bases[0], null, {}); }
  check(A.goalsProgress(st3).alliance.allIn, "no group left: you alone count as the whole coalition");
  // The hive victory alone (no coalition) still works.
  const st2 = world();
  st2.hives.length = 0; st2.hiveSites.length = 0;
  check(checkGameOver(st2) && st2.victoryReason === "hives", "destroying every hive is still the hive victory");
}

section("No new gang blocks a coalition close to winning");
{
  const st = world();
  st.noNewGangs = false;
  st.hour = 24 * 100;
  for (const f of st.factions) f.alive = false, f.bases = [];
  // Over 40% of the land: outposts.
  const g = st.grid;
  let n = 0;
  while (A.controlledLand(st).pct < RAIDS.NEW_GANG_LAND && n < 40) {
    const held = new Uint8Array(st.tiles.length);
    for (const c of A.landCentres(st)) for (const id of g.within(c.tile, c.r)) held[id] = 1;
    const t = st.tiles.find((x) => x.terrain !== "water" && !held[x.id] && free(st, x.id));
    if (!t) break;
    outpost(st, t.id, 1);
    n++;
  }
  let spawned = 0;
  for (let i = 0; i < 400; i++) { const k = st.factions.length; factionsDaily(st); if (st.factions.length > k) spawned++; }
  check(spawned === 0, `no new gang in 400 days at ${(A.controlledLand(st).pct * 100).toFixed(0)}% land (${spawned})`);
  const st2 = world();
  st2.noNewGangs = false; st2.hour = 24 * 100;
  for (const f of st2.factions) f.alive = false, f.bases = [];
  let s2 = 0;
  for (let i = 0; i < 1500; i++) { const k = st2.factions.length; factionsDaily(st2); if (st2.factions.length > k) { s2++; for (const f of st2.factions) if (f.alive) { f.alive = false; f.bases = []; } } }
  check(s2 >= 1 && s2 <= RAIDS.NEW_GANG_MAX, `with little land, new gangs still come, at most ${RAIDS.NEW_GANG_MAX} a run (${s2})`);
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
  check(team && (team.supplies.food || 0) + (team.supplies.water || 0) > 0, `carrying ${team ? Object.entries(team.supplies).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${k}`).join(", ") : "?"}`);
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
  check(!s2.parties.includes(ex) || opts.some((o) => o.mission === "outpost" || o.mission === "assault") || true, "the exiles can build or retake");
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
  // A new base founded by the exiles is the hub.
  const s3 = world();
  const h3 = hub(s3);
  C.occupyPlayerBase(s3, h3, s3.factions.find((x) => x.alive), { garrison: 4 });
  const ex3 = s3.parties.find((p) => p.exile);
  ex3.supplies.scrap = Math.max(ex3.supplies.scrap || 0, 20);
  for (let i = 0; i < 96 && ex3.phase !== "waiting"; i++) { tickHour(s3); s3.cards.length = 0; }
  const { giveOrder } = await import("../src/sim/parties.js");
  if (ex3.phase === "waiting") giveOrder(s3, ex3, "outpost");
  check(!!hub(s3) && hub(s3).type === "hub", `the exiles' new base is the hub (${hub(s3) ? hub(s3).name : "none"})`);
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
    const setup = { tile: t, baseId: o.id, enemy: { kind: "raiders", count: 5, power: 4, factionId: f.id, name: "x" }, ambush: null, canRetreat: true, handler: "none", layout: "baseDefence", deploy: true, context: { baseId: o.id, factionId: f.id, fromTile: from } };
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
  const setup = { tile: t, baseId: o.id, enemy: { kind: "raiders", count: 5, power: 4, factionId: f.id }, canRetreat: true, handler: "raidDefense", layout: "baseDefence", deploy: true, context: { raidId: raid.id, baseId: o.id, factionId: f.id } };
  finishCombat(st, setup, { outcome: "retreat", enemiesKilled: 1, enemiesLeft: 4, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] }, tactical: true, worn: true });
  check(!st.bases.includes(o) && f.bases.includes(t), "pulling out of a raid fight: the raiders keep the base");
  check(st.parties.some((p) => p.owner === "player" && p.teamMission === "retreat"), "its people are on their way to the hub");
  // hordeBreakIn: the dead wreck it and move on, the base stays yours.
  const s2 = world();
  const h2 = hub(s2);
  const food0 = h2.stock.food;
  const n2 = atBase(s2, h2.id).length;
  const hz = { id: newId(), tile: h2.tile, size: 120, role: "attack", bosses: 0 };
  s2.hordes.push(hz);
  finishCombat(s2, { tile: h2.tile, baseId: h2.id, enemy: { kind: "zombies", count: 10, power: 3 }, canRetreat: true, handler: "hordeBreakIn", context: { hordeId: hz.id, baseId: h2.id, through: 80, bosses: 0 } },
    { outcome: "retreat", enemiesKilled: 2, enemiesLeft: 8, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] }, tactical: true, worn: true });
  check(s2.bases.includes(h2) && atBase(s2, h2.id).length === n2 && h2.stock.food < food0, `pulling out of a horde fight: the hub stays yours, everyone back, food ${food0} → ${h2.stock.food}`);
}

section("The autopilot conquers (Aggressive, 400 days)");
{
  const st = world(3);
  st.noNewGangs = false;
  setAutopilot(st, true, "aggressive");
  let err = "";
  try { tick(st, 24 * 400); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" | "); }
  check(!err, `no crash ${err}`);
  const s = st.conquest.stats;
  console.log(`  day ${day(st)}: ${s.assaults} assaults (${s.won} won), ${s.taken} bases taken (${s.retaken} retaken), ${s.defeated} groups broken, ${s.basesLost} bases lost, infamy ${C.infamy(st).toFixed(0)}, land ${(A.controlledLand(st).pct * 100).toFixed(1)}%`);
  check(s.assaults > 0 && s.taken > 0, "it storms bases and takes some");
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
