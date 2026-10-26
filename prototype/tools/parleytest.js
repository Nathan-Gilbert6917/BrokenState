// Calling out to other groups on a raid's map (src/sim/parley.js, the user's request 2026-10-20):
//   - a raid with no other human group has no b.parley at all (the old paths);
//   - an AI group's party on a site (siteParty): friendly, neutral and hostile ones all turn up, one a raid at most;
//     placed on the map as a third side (friendly, neutral) or an enemy pod (hostile), their own people;
//   - Call out: refused without sight of them, allowed with it; 1 action; the shout wakes the dead near it;
//   - the odds rise with the speaker's Speech and fall with the group's hostility;
//   - a truce stops both sides shooting; your people hitting one of theirs after it flips the group (a broken truce
//     recorded, goodwill lost after the raid);
//   - a treacherous group takes the truce and turns on you ("It was a trap!", aware, full actions);
//   - a hostile pod that calls out goes into a standoff: no shots while the card waits, hostile on "Never mind";
//   - walking away: on their ground you have LEAVE_TURNS turns to be out of sight; a party packs up and runs off;
//   - Join us (they leave the map; the recruit card after the raid, their group's people taken off its list), What do
//     you know (ghosts and containers), Trade (the trade window queued; a swap with a group that has none), the haul
//     handed over;
//   - parleyStatus's labels and active flag; parleyGroupsSeen;
//   - no card outlives the battle; a save round-trip keeps b.parley; the raid bot answers the cards;
//   - a shout's stakes by how crowded the place is (shoutCost: reach, Heat, the risk of a wave), their loud call too;
//   - Split what we found with an allied group that fought beside you (on its card; its own card when one of yours
//     gets out), You kept it all; a Hostile group's people trade by a swap, never its trade window;
//   - the raid bot calls out on its own (botCallOut: the best talker, once a group), and its raids still end.
// The party mix samples the sites within a group's PARLEY.PARTY.range (the 250 × 150 Normal map since 1370d1c); the
// sections on a plain hostile pod set its record plain (plainHostile), as the treachery sections set it treacherous
// (issue #44, 2026-10-26).
// Usage: node tools/parleytest.js
import { createWorld, hub, atBase, factionById, survivorById } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, combatAct, registerCombatHandler, damage, notice, endPlayerTurn, runEnemyPhase, autoPlayerTurn, finishCombat, endCalledOff, canSee, activeAny, CELL } from "../src/sim/combat.js";
import { faceToward } from "../src/sim/vision.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { memberById } from "../src/sim/members.js";
import { resolveBattleCards } from "../src/sim/floorfolk.js";
import { hostilePair } from "../src/sim/thirdside.js";
import { foesOf, setFloor } from "../src/sim/combat.js";
import * as CC from "../src/sim/citycrawl.js";
import { BUILDINGS } from "../src/sim/buildingmaps.js";
import { day } from "../src/sim/world.js";
import { PARLEY, crawlParties, foughtBonus, parleySpeak, parleyStatus, parleyGroupsSeen, callOutRefusal, callOutTargets, parleyOdds, siteParty, parleyGoodwill, parleyAfterRaid, parleyTrade, parleyTick, shoutCost, botCallOut } from "../src/sim/parley.js";
import { makeItem } from "../src/sim/crafting.js";
import { itemValue } from "../src/sim/valuation.js";
import { skill } from "../src/sim/world.js";
import { LOCATIONS } from "../src/sim/data.js";

let passes = 0, fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (ok) passes++; else fails++; return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
registerCombatHandler("ptest", () => {});
const pc = (v) => `${Math.round(v * 100)}%`;

// ---------- helpers ----------
function world(seed = 501) {
  const state = createWorld({ seed, factionCount: 7 });
  state.cards.length = 0;
  state.noWanderers = true; // nobody but the groups a test places
  state.hour = Math.floor(state.hour / 24) * 24 + 36; // the next midday: no night cones
  return state;
}
const siteTile = (state) => state.tiles.find((t) => t.loc && LOCATIONS[t.loc.type] && !t.hive && t.terrain !== "water" && !state.bases.some((b) => b.tile === t.id) && !state.factions.some((f) => f.bases.includes(t.id)));
// A street raid with these enemy groups, nothing else on the map (the dead the map brings removed, no Heat waves).
function raid(state, groups, { dead = false, skills = {} } = {}) {
  const h = hub(state);
  for (const k of ["food", "water", "meds"]) h.stock[k] = Math.max(h.stock[k] || 0, 60);
  const crew = atBase(state, h.id).slice(0, 3);
  for (const s of crew) Object.assign(s.skills, skills);
  const tile = siteTile(state);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 8, water: 8, ammo: 30, meds: 2 } });
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "ptest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 0, building: "street" }, context: {} };
  const b = createBattle(state, setup);
  state.combat = b;
  if (!dead) b.units = b.units.filter((u) => u.kind !== "zombie");
  b.raid.spawnCap = 0;
  return { b, p, setup, mine: b.units.filter((u) => u.side === "player") };
}
const theirs = (b, key) => b.units.filter((u) => u.pk === key);
const open = (b, x, y) => x > 0 && y > 0 && x < b.w - 1 && y < b.h - 1 && b.reach[y * b.w + x] && CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => !o.dead && o.x === x && o.y === y);
// Moves the group's units next to one another at a spot in plain sight of unit u, d0..d1 tiles off (both ways).
function inSight(b, u, list, d0 = 3, d1 = 6) {
  const cells = [];
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) { const d = Math.hypot(x - u.x, y - u.y); if (d >= d0 && d <= d1) cells.push([x, y, d]); }
  cells.sort((p, q) => p[2] - q[2]);
  for (const [x, y] of cells) {
    if (!open(b, x, y)) continue;
    const t = list[0];
    t.x = x; t.y = y; t.f = 0;
    faceToward(t, u.x, u.y); faceToward(u, x, y);
    if (!canSee(b, u, t) || !canSee(b, t, u)) continue;
    let k = 1;
    for (const [nx, ny] of cells.filter(([a, c]) => Math.hypot(a - x, c - y) <= 2.5)) {
      if (k >= list.length) break;
      if (!open(b, nx, ny)) continue;
      list[k].x = nx; list[k].y = ny; list[k].f = 0; faceToward(list[k], u.x, u.y); k++;
    }
    return true;
  }
  return false;
}
// The far corner from u where it cannot see the unit.
function outOfSight(b, u, t) {
  for (let r = Math.max(b.w, b.h); r > 12; r--) for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    if (Math.round(Math.hypot(x - u.x, y - u.y)) !== r || !open(b, x, y)) continue;
    t.x = x; t.y = y;
    if (!canSee(b, u, t)) return true;
  }
  return false;
}
const card = (state, key) => state.cards.find((c) => c && c.battle && c.parley === key);
const choose = (state, c, label) => { const i = state.cards.indexOf(c); if (i >= 0) state.cards.splice(i, 1); const ch = c.choices.find((x) => x.label === label || x.label.startsWith(label)); if (!ch) throw new Error(`no choice ${label} on ${c.title}: ${c.choices.map((x) => x.label).join(", ")}`); return ch.resolve(state); };
// Forced odds (PARLEY.ODDS min = max) for the tests that need a sure outcome.
function sure(v, fn) { const O = PARLEY.ODDS, m = O.min, M = O.max; O.min = O.max = v; try { return fn(); } finally { O.min = m; O.max = M; } }
const dis = (st, ch) => (typeof ch.disabled === "function" ? ch.disabled(st) : !!ch.disabled);
const recOf = (b, u) => b.parley.groups.find((g) => g.key === u.pk);
const shotsBy = (b, names, from = 0) => b.log.slice(from).filter((l) => names.some((n) => l.text.startsWith(`${n} shoots`) || l.text.startsWith(`${n} fires`) || l.text.startsWith(`${n} strikes`))).length;
const nextTurn = (state) => { const b = state.combat; for (const u of b.units) if (u.side === "player") u.ap = 0; endPlayerTurn(state); runEnemyPhase(state); };
const raiders = (n = 3) => ({ kind: "raiders", count: n, power: 3.5, name: "rival scavengers", guard: true });
// A raider pod's record made plain hostile. Its group's record is rolled at the battle's start, and a loose group's
// dice may make it treacherous (PARLEY.TREACHERY.loose, 30%): shown as friendly ("we're friendly", Answer them, no Hand
// over what you found). Seeds 71 and 91 roll it so (red since the repo's first commit 222200d). Treachery has its own
// sections (a treacherous group fakes friendliness, treachery tells), which set the record treacherous as this sets it plain.
const plainHostile = (rec) => Object.assign(rec, { treacherous: false, lie: rec.hostility, shown: rec.stance });
const partyOf = (f, stance = "neutral", n = 3) => ({ kind: "raiders", count: n, power: 4, name: `${f.name} scavengers`, factionId: f.id, ...(stance === "hostile" ? {} : { side: "neutral" }), parley: { stance, hostility: stance === "friendly" ? 15 : stance === "neutral" ? 40 : 80, treacherous: false } });
// Ends the raid with everyone of yours out (extracted), and the handler run.
function endRaidNow(state) {
  const b = state.combat;
  for (const u of b.units) if (u.side === "player" && !u.dead) u.left = true;
  endCalledOff(state);
  const setup = b.setup;
  finishCombat(state, setup, b.result);
  return b;
}

// ---------- the old paths ----------
section("A raid with no other human group: no b.parley");
{
  const state = world();
  const { b } = raid(state, [{ kind: "zombies", count: 5, power: 2, name: "the dead" }], { dead: true });
  check(!b.parley, "no parley records on a map of only the dead");
  for (let i = 0; i < 4 && !b.over; i++) { autoPlayerTurn(state); if (!b.over) runEnemyPhase(state); }
  check(!b.parley && !state.cards.some((c) => c && c.battle), "still none after the bot's turns, and no card");
  check(b.units.filter((u) => u.kind === "zombie").every((u) => parleyStatus(b, u) === null), "the dead have no group status");
}

// ---------- the party on a site ----------
section("An AI group's party on a site (siteParty): the mix, one a raid, placed by its stance");
{
  const tally = { friendly: 0, neutral: 0, hostile: 0, treacherous: 0, none: 0 };
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const s = createWorld({ seed, factionCount: 7 });
    for (const f of s.factions) f.goodwill = Math.round((f.goodwill || 0) + (seed % 3 - 1) * 30); // how the run has gone with them
    const tiles = s.tiles.filter((t) => t.loc && !t.hive);
    // The sites a group's party can reach (siteParty: a group with a base within PARLEY.PARTY.range). The first 60 sites
    // were the sample on the old 64 × 42 map; on the 250 × 150 Normal map since 1370d1c (map sizes, 2026-10-24) the same
    // 7 groups are spread thin and the first 60 sites, in the map's top rows, are out of their range (seed 11: 1 of 60).
    const inRange = tiles.filter((t) => s.factions.some((f) => f.alive && !f.outsider && f.bases.some((id) => s.grid.distance(id, t.id) <= PARLEY.PARTY.range)));
    for (const t of inRange.slice(0, 60)) for (let w = 0; w < 4; w++) {
      s.hour = w * PARLEY.PARTY.window + 12;
      const g = siteParty(s, t.id);
      if (!g) { tally.none++; continue; }
      tally[g.parley.stance]++;
      if (g.parley.treacherous) tally.treacherous++;
    }
    const groups = raidEnemies(s, tiles[0].id);
    if (groups.filter((g) => g.parley).length > 1) tally.many = (tally.many || 0) + 1;
  }
  console.log(`  parties: ${JSON.stringify(tally)}`);
  check(tally.friendly > 0 && tally.neutral > 0 && tally.hostile > 0, "friendly, neutral and hostile parties all turn up");
  check(tally.treacherous > 0 && tally.treacherous < tally.hostile, "some of the hostile ones are treacherous");
  check(!tally.many, "one party a raid at most");
  const state = world(21);
  const f = state.factions.find((x) => x.alive && !x.outsider);
  const { b } = raid(state, [partyOf(f, "neutral"), { ...partyOf(f, "hostile"), name: "the other lot" }]);
  const third = b.units.filter((u) => u.side === "third"), foes = b.units.filter((u) => u.side === "enemy" && u.kind === "human");
  check(third.length === 3 && third.every((u) => u.pk && recOf(b, u).party && recOf(b, u).factionId === f.id), "a neutral party: three of a third side, its record a party of its group");
  check(foes.length === 3 && foes.every((u) => u.pk && !u.aware), "a hostile party: an enemy pod, unaware");
  check(third.some((u) => u.who && memberById(state, u.who.id)), "their own people (members.js)");
  check(parleyStatus(b, third[0]).label === "Peaceful" && parleyStatus(b, foes[0]).label === "Unaware" && !parleyStatus(b, foes[0]).active, "the badge: Peaceful, Unaware");
}

// ---------- calling out ----------
section("Call out: sight, the action, the shout, the card");
{
  const state = world(31);
  const { b, mine } = raid(state, [raiders(3), { kind: "zombies", count: 3, power: 2, name: "the dead" }], { dead: true });
  const u = mine[0];
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const dead = b.units.filter((x) => x.kind === "zombie");
  b.units = b.units.filter((x) => x.kind !== "zombie" || dead.indexOf(x) < 2);
  check(outOfSight(b, u, pod[0]), "(test setup: one of them out of sight)");
  for (const x of pod.slice(1)) { x.x = pod[0].x; x.y = pod[0].y; x.off = true; }
  const why = callOutRefusal(state, b, u, pod[0]);
  check(/see/.test(why), `refused without sight ("${why}")`);
  check(!callOutTargets(state, b, u).length, "and nobody to call out to");
  for (const x of pod.slice(1)) x.off = false;
  check(inSight(b, u, pod), "(test setup: the group in plain sight)");
  check(callOutRefusal(state, b, u, pod[0]) === "", "allowed with sight");
  const ts = callOutTargets(state, b, u);
  check(ts.length === 1 && ts[0].pk === pod[0].pk, "one target for the group (the nearest of it)");
  // The dead: one within the shout, one far off.
  const [z1, z2] = b.units.filter((x) => x.kind === "zombie");
  z1.x = u.x + 1; z1.y = u.y; z1.aware = false;
  if (!open(b, z1.x, z1.y)) { z1.x = u.x; z1.y = u.y + 1; }
  outOfSight(b, u, z2); z2.aware = false;
  const ap = u.ap;
  const err = combatAct(state, { type: "callout", unit: u.id, target: ts[0].id });
  check(err === "", `combatAct callout${err ? `: ${err}` : ""}`);
  check(u.ap === ap - 1, "1 action");
  check(z1.aware && !z2.aware, "the shout wakes the dead near it, not those far off");
  const c = card(state, pod[0].pk);
  check(!!c && c.battle && state.cards[0] === c, "a battle card, in front");
  check(c && ["Hold your fire", "Let's both walk away", "Trade", "Join us", "What do you know?", "Attack them", "Never mind"].every((l) => c.choices.some((x) => x.label === l)) && c.choices.every((x) => /\d+%|They|Your|Leave|Say|Speech/.test(x.hint)), "the options, each with its odds or what it does");
  check(c && c.choices.some((x) => x.label === "Hand over what you found"), "a hostile group: hand over what you found");
  check(pod.every((x) => x.side === "third") && parleyStatus(b, pod[0]).label === "Standoff", "an enemy pod called to: a standoff (third side)");
  check(/already/.test(callOutRefusal(state, b, u, pod[0])), `a second call while the card waits is refused ("${callOutRefusal(state, b, u, pod[0])}")`);
}

// ---------- the odds ----------
section("The odds: Speech up, hostility down");
{
  const state = world(41);
  const { b, mine } = raid(state, [raiders(2)]);
  const u = mine[0], s = survivorById(state, u.sid);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const rec = recOf(b, pod[0]);
  const at = (speech, h, opt = "truce") => { s.skills.speech = speech; rec.hostility = h; return parleyOdds(state, b, rec, opt, u); };
  const rows = [[2, 20], [8, 20], [16, 20], [8, 50], [8, 80], [16, 80]].map(([sp, h]) => [sp, h, at(sp, h)]);
  console.log(`  truce: ${rows.map(([sp, h, c]) => `Speech ${sp}/hostility ${h} ${pc(c)}`).join(", ")}`);
  check(rows[0][2] < rows[1][2] && rows[1][2] < rows[2][2], "more Speech, better odds");
  check(rows[1][2] > rows[3][2] && rows[3][2] > rows[4][2], "more hostile, worse odds");
  check(["walk", "trade", "join", "info"].every((o) => at(14, 20, o) > at(6, 80, o)), "every option: a good talker and a calm group beat a poor one and a hostile one");
  check(at(20, 0) <= PARLEY.ODDS.max && at(0, 100) >= PARLEY.ODDS.min, "5–95%");
}

// ---------- a truce, and breaking it ----------
section("A truce stops both sides shooting; your attack after it flips them (a broken truce)");
{
  const state = world(51);
  const f = state.factions.find((x) => x.alive && !x.outsider);
  f.goodwill = 0;
  const { b, mine, p } = raid(state, [{ ...partyOf(f, "hostile"), name: "their scavengers" }]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  for (const x of pod) x.aware = true; // up and fighting
  check(inSight(b, mine[0], pod, 4, 7), "(test setup: in sight)");
  check(parleyStatus(b, pod[0]).label === "Hostile" && parleyStatus(b, pod[0]).active, "aware and hostile: Hostile, active");
  combatAct(state, { type: "callout", unit: mine[0].id, target: pod[0].id });
  sure(1, () => choose(state, card(state, pod[0].pk), "Hold your fire"));
  const rec = recOf(b, pod[0]);
  check(rec.truce && pod.every((x) => x.side === "third") && parleyStatus(b, pod[0]).label === "Truce" && !parleyStatus(b, pod[0]).active, "a truce: Truce, not hostile");
  const names = pod.map((x) => x.name), ours = mine.map((x) => x.name);
  const from = b.log.length;
  const hp = mine.map((x) => x.hp);
  for (let i = 0; i < 3 && !b.over; i++) { autoPlayerTurn(state); if (!b.over) runEnemyPhase(state); }
  check(!b.over && shotsBy(b, names, from) === 0 && mine.every((x, i) => x.hp >= hp[i]), "three turns: they never fire on you");
  check(shotsBy(b, ours, from) === 0, "and your people (the bot) never fire on them");
  check(rec.truce && pod.every((x) => x.side === "third"), "the truce holds");
  // Your people hit one of theirs.
  const t = pod.find((x) => activeAny(x));
  damage(b, t, 3, mine[0]);
  check(pod.every((x) => x.side === "enemy" && x.aware) && rec.brokeTruce === "player" && !rec.truce, "your people hit one of theirs: the whole group fights, the truce broken by you");
  check(parleyStatus(b, t).label === "Hostile" && parleyStatus(b, t).active, "Hostile again");
  const gw = f.goodwill;
  const bb = endRaidNow(state);
  const r = bb.result.parley.find((x) => x.key === rec.key);
  check(r && r.brokeTruce === "player", "result.parley records it");
  parleyGoodwill(state, bb.result);
  check(f.goodwill < gw + PARLEY.GOODWILL.attack, `their group remembers: goodwill ${gw} → ${Math.round(f.goodwill)} (worse than an attack)`);
  check(!state.cards.some((c) => c && c.battle), "no battle card outlives the battle");
  void p;
}

// ---------- treachery ----------
section("A treacherous group fakes friendliness and betrays");
{
  const state = world(61);
  const { b, mine } = raid(state, [raiders(3)]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const rec = recOf(b, pod[0]);
  rec.treacherous = true; rec.lie = PARLEY.LIE; rec.stance = "hostile"; rec.hostility = 85;
  check(parleyStatus(b, pod[0]).shown === "friendly" && parleyStatus(b, pod[0]).stance === "hostile", "it shows as friendly");
  check(inSight(b, mine[0], pod, 7, 9), "(test setup: in sight, not close)");
  for (const x of mine.slice(1)) { x.x = mine[0].x; x.y = mine[0].y; x.off = true; } // one of yours on the map
  const callBy = parleyOdds(state, b, rec, "truce", mine[0]);
  check(callBy > 0.8, `a ploy: the truce is easy (${pc(callBy)})`);
  combatAct(state, { type: "callout", unit: mine[0].id, target: pod[0].id });
  const c = card(state, pod[0].pk);
  check(/We hear you/.test(c.text), "the card: a friendly answer");
  choose(state, c, "Hold your fire");
  check(rec.truce && rec.betrayAt != null && parleyStatus(b, pod[0]).label === "Truce", `a truce (they turn on turn ${rec.betrayAt})`);
  let turned = -1, ap = 0, aware = false;
  for (let i = 0; i < 6 && !b.over; i++) {
    for (const x of b.units) if (x.side === "player") x.ap = 0;
    endPlayerTurn(state);
    if (turned < 0 && pod.some((x) => x.side === "enemy")) { turned = b.turn; ap = Math.min(...pod.filter(activeAny).map((x) => x.ap)); aware = pod.filter(activeAny).every((x) => x.aware); }
    runEnemyPhase(state);
  }
  check(turned === rec.betrayAt, `they turn on you on turn ${turned}`);
  check(aware && ap === 2, "aware, with full actions");
  check(b.log.some((l) => /It was a trap!/.test(l.text)) && rec.brokeTruce === "them" && rec.betrayed, "\"It was a trap!\", the truce broken by them");
  check(parleyStatus(b, pod[0]).label === "Hostile" && parleyStatus(b, pod[0]).shown === "hostile", "now shown hostile");
  // Close in on them instead: they spring it as soon as two of yours are near.
  const st2 = world(62);
  const R2 = raid(st2, [raiders(3)]);
  const pod2 = R2.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const rec2 = recOf(R2.b, pod2[0]);
  rec2.treacherous = true; rec2.lie = PARLEY.LIE; rec2.stance = "hostile"; rec2.hostility = 85;
  inSight(R2.b, R2.mine[0], pod2, 2, 3);
  R2.mine[1].x = R2.mine[0].x; R2.mine[1].y = R2.mine[0].y + 1;
  if (!open(R2.b, R2.mine[1].x, R2.mine[1].y)) R2.mine[1].y = R2.mine[0].y - 1;
  combatAct(st2, { type: "callout", unit: R2.mine[0].id, target: pod2[0].id });
  sure(1, () => choose(st2, card(st2, pod2[0].pk), "Hold your fire"));
  for (const x of R2.b.units) if (x.side === "player") x.ap = 0;
  endPlayerTurn(st2);
  check(pod2.every((x) => x.side === "enemy") && rec2.betrayed && R2.b.turn < rec2.betrayAt, "two of yours close: they spring the trap early");
}

// ---------- their call: a hostile pod's standoff ----------
section("A hostile pod that calls out holds its fire until answered");
{
  const state = world(71);
  const { b, mine } = raid(state, [raiders(3)]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  check(inSight(b, mine[0], pod, 2, 3), "(test setup: close, in sight)");
  plainHostile(recOf(b, pod[0])); // a hostile pod, not a treacherous one (plainHostile)
  const call = PARLEY.CALL.hostile;
  PARLEY.CALL.hostile = 1;
  try { notice(b, pod[0]); } finally { PARLEY.CALL.hostile = call; }
  const rec = recOf(b, pod[0]);
  check(rec.standoff && pod.every((x) => x.side === "third") && !pod.some((x) => x.side === "enemy" && x.aware), "they see you and call out: a standoff, nobody alerted");
  parleyTick(state, b); // after an action (combat.js): the tick shows the card
  const c = card(state, pod[0].pk);
  check(!!c && /Drop what you're carrying/.test(c.text), "the card: what they said (a hostile demand)");
  check(c && c.choices.some((x) => x.label === "Talk them down") && c.choices.some((x) => x.label === "Hand over what you found"), "talk them down, or hand over what you found");
  const names = pod.map((x) => x.name), from = b.log.length;
  nextTurn(state); // the card left waiting
  check(shotsBy(b, names, from) === 0 && rec.standoff && parleyStatus(b, pod[0]).label === "Standoff", "a turn with the card unanswered: no shots, still a standoff");
  choose(state, card(state, pod[0].pk), "Never mind");
  check(pod.every((x) => x.side === "enemy" && x.aware) && parleyStatus(b, pod[0]).active, "Never mind: they raise their guns (hostile)");
  // A standoff left too long.
  const st2 = world(72);
  const R2 = raid(st2, [raiders(2)]);
  const pod2 = R2.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  inSight(R2.b, R2.mine[0], pod2, 3, 6);
  combatAct(st2, { type: "callout", unit: R2.mine[0].id, target: pod2[0].id });
  st2.cards.length = 0; // nobody answers
  for (let i = 0; i <= PARLEY.STANDOFF_TURNS; i++) nextTurn(st2);
  check(pod2.every((x) => x.side === "enemy" && x.aware), `unanswered for ${PARLEY.STANDOFF_TURNS} turns: they stop waiting`);
  // A failed ask with a very hostile group: they open fire.
  const st3 = world(73);
  const R3 = raid(st3, [raiders(2)]);
  const pod3 = R3.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  inSight(R3.b, R3.mine[0], pod3, 3, 6);
  recOf(R3.b, pod3[0]).hostility = 100;
  combatAct(st3, { type: "callout", unit: R3.mine[0].id, target: pod3[0].id });
  const fm = PARLEY.FIRE.max; PARLEY.FIRE.max = 1;
  try { sure(0, () => choose(st3, card(st3, pod3[0].pk), "Hold your fire")); } finally { PARLEY.FIRE.max = fm; }
  check(pod3.every((x) => x.side === "enemy" && x.aware), "a failed ask with a hostile group: they open fire");
  const st4 = world(74);
  const R4 = raid(st4, [raiders(2)]);
  const pod4 = R4.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  inSight(R4.b, R4.mine[0], pod4, 3, 6);
  combatAct(st4, { type: "callout", unit: R4.mine[0].id, target: pod4[0].id });
  recOf(R4.b, pod4[0]).hostility = 60;
  const fm4 = PARLEY.FIRE.max; PARLEY.FIRE.max = 0;
  try { sure(0, () => choose(st4, card(st4, pod4[0].pk), "Hold your fire")); } finally { PARLEY.FIRE.max = fm4; }
  const again = card(st4, pod4[0].pk);
  check(pod4.every((x) => x.side === "third") && again && dis(st4, again.choices.find((x) => x.label === "Hold your fire")) && !dis(st4, again.choices.find((x) => x.label === "Let's both walk away")), "a plain refusal: the standoff's card comes back, the same ask refused this turn");
}

// ---------- walking away ----------
section("Let's both walk away: their ground (you leave by leaveBy), a party (they go)");
{
  const state = world(81);
  const { b, mine } = raid(state, [raiders(2)]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  inSight(b, mine[0], pod, 6, 8);
  for (const x of mine.slice(1)) { x.x = mine[0].x; x.y = mine[0].y; x.off = true; }
  combatAct(state, { type: "callout", unit: mine[0].id, target: pod[0].id });
  sure(1, () => choose(state, card(state, pod[0].pk), "Let's both walk away"));
  const rec = recOf(b, pod[0]);
  const st0 = parleyStatus(b, pod[0]), by = rec.leaveBy;
  check(rec.leaving && rec.goes === "you" && st0.label === "Leaving" && st0.leaveBy === PARLEY.LEAVE_TURNS, `their ground: you have ${st0.leaveBy} turns (Leaving)`);
  let hostileAt = -1;
  for (let i = 0; i < PARLEY.LEAVE_TURNS + 2 && hostileAt < 0; i++) {
    for (const x of b.units) if (x.side === "player") x.ap = 0;
    endPlayerTurn(state);
    if (pod.some((x) => x.side === "enemy")) hostileAt = b.turn;
    runEnemyPhase(state);
  }
  check(hostileAt === by, `still in their sight when time is up: they open fire on turn ${hostileAt} (leaveBy ${by})`);
  // A party on the move packs up and goes.
  const st2 = world(82);
  const f = st2.factions.find((x) => x.alive && !x.outsider);
  const R2 = raid(st2, [partyOf(f, "neutral", 2)]);
  const party = R2.b.units.filter((x) => x.side === "third");
  inSight(R2.b, R2.mine[0], party, 4, 7);
  combatAct(st2, { type: "callout", unit: R2.mine[0].id, target: party[0].id });
  sure(1, () => choose(st2, card(st2, party[0].pk), "Let's both walk away"));
  check(recOf(R2.b, party[0]).goes === "them" && parleyStatus(R2.b, party[0]).label === "Leaving", "a party: they leave (Leaving)");
  for (let i = 0; i < 14 && party.some(activeAny); i++) nextTurn(st2);
  check(party.every((x) => x.fled || !activeAny(x)), "they run off the map");
}

// ---------- join, info, trade, the haul ----------
section("Join us, What do you know, Trade, the haul handed over; after the raid");
{
  const state = world(91);
  const f = state.factions.find((x) => x.alive && !x.outsider);
  f.goodwill = 40;
  const { b, mine, p } = raid(state, [partyOf(f, "friendly", 2), raiders(2), { kind: "zombies", count: 3, power: 2, name: "the dead" }], { dead: true });
  const party = b.units.filter((x) => x.side === "third");
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  plainHostile(recOf(b, pod[0])); // the raiders hostile, not treacherous: the haul handed over is offered (plainHostile)
  inSight(b, mine[0], party, 3, 6);
  combatAct(state, { type: "callout", unit: mine[0].id, target: party[0].id });
  const boxes = b.raid.containers.filter((c) => !c.searched && c.kind !== "body");
  sure(1, () => choose(state, card(state, party[0].pk), "What do you know?"));
  const rec = recOf(b, party[0]);
  check(rec.told && boxes.some((c) => c.known) && Object.keys(b.ghosts || {}).length > 0, "What do you know: places to search known, the dead and the others marked (ghosts)");
  const people = party.map((x) => x.who).filter(Boolean);
  mine[0].ap = 2;
  combatAct(state, { type: "callout", unit: mine[0].id, target: party[0].id });
  sure(1, () => choose(state, card(state, party[0].pk), "Join us"));
  check(party.every((x) => x.left) && rec.joining, "Join us: they leave the map");
  // The raiders: a trade (a swap after), then the haul.
  inSight(b, mine[1], pod, 3, 6);
  combatAct(state, { type: "callout", unit: mine[1].id, target: pod[0].id });
  sure(1, () => choose(state, card(state, pod[0].pk), "Trade"));
  const rp = recOf(b, pod[0]);
  check(rp.trade && rp.truce, "Trade: agreed (a truce meanwhile)");
  const h = mine[1].haul;
  h.sup.scrap = 4; b.raid.found.scrap = (b.raid.found.scrap || 0) + 4;
  rp.truce = false; // (to be offered the hand-over)
  mine[1].ap = 2;
  combatAct(state, { type: "callout", unit: mine[1].id, target: pod[0].id });
  choose(state, card(state, pod[0].pk), "Hand over what you found");
  check(!(h.sup.scrap > 0) && !(b.raid.found.scrap > 0) && rp.truce && rp.gave, "the haul handed over: gone from your hands and the raid's finds, a truce");
  const gw = f.goodwill;
  const bb = endRaidNow(state);
  const res = bb.result;
  const r = res.parley.find((x) => x.key === rec.key);
  check(r && r.joining && r.joiners.length === party.length, "result.parley: the joiners");
  check(!res.third || !res.third.some((x) => x.name === rp.name), "the raiders who held their fire are not counted a third side");
  parleyGoodwill(state, res);
  check(f.goodwill < gw, `their group loses people to you: goodwill ${gw} → ${Math.round(f.goodwill)}`);
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  p.supplies.food = 20; p.supplies.water = 2;
  state.cards.length = 0;
  parleyAfterRaid(state, p, res);
  const rc = state.cards.find((c) => c.recruit);
  check(!!rc && rc.recruit.candidates.length === party.length, "the recruit card for them");
  check(people.length && people.every((s) => !memberById(state, s.id) && s.pending), "their group's people, off its list, waiting on the card");
  check(state.cards.some((c) => /^Trading with/.test(c.title)), "a swap card for the raiders (no trade window)");
  // A faction's people agreeing to trade: the trade window once out.
  const st2 = world(92);
  const f2 = st2.factions.find((x) => x.alive && !x.outsider);
  f2.goodwill = 40;
  const R2 = raid(st2, [partyOf(f2, "friendly", 2)]);
  const party2 = R2.b.units.filter((x) => x.side === "third");
  inSight(R2.b, R2.mine[0], party2, 3, 6);
  combatAct(st2, { type: "callout", unit: R2.mine[0].id, target: party2[0].id });
  sure(1, () => choose(st2, card(st2, party2[0].pk), "Trade"));
  const bb2 = endRaidNow(st2);
  R2.p.phase = "idle";
  check(parleyTrade(st2, R2.p, bb2.result) && st2.trade && st2.trade.factionId === f2.id, "Trade with a group's people: its trade window, once out");
}

// ---------- the badge ----------
section("parleyStatus and parleyGroupsSeen");
{
  const state = world(101);
  const f = state.factions.find((x) => x.alive && !x.outsider);
  const { b, mine } = raid(state, [partyOf(f, "neutral", 2), raiders(2)]);
  const party = b.units.filter((x) => x.side === "third");
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  check(parleyStatus(b, mine[0]) === null, "your own: null");
  const keys = ["key", "name", "stance", "shown", "hostility", "active", "truce", "leaving", "standoff", "label", "color"];
  const s0 = parleyStatus(b, pod[0]);
  check(keys.every((k) => k in s0), "the contract's fields");
  check(s0.label === "Unaware" && !s0.active && parleyStatus(b, party[0]).label === "Peaceful", "Unaware, Peaceful");
  check(!parleyGroupsSeen(b).length, "nobody seen yet");
  inSight(b, mine[0], party, 3, 6);
  inSight(b, mine[1], pod, 3, 6);
  parleyTick(state, b);
  const seen = parleyGroupsSeen(b);
  check(seen.length >= 1 && seen.every((g) => g.seen && g.count > 0 && keys.every((k) => k in g)), `the groups seen: ${seen.map((g) => `${g.name} (${g.label}, ${g.count})`).join(", ")}`);
  for (const x of pod) x.aware = true;
  check(parleyStatus(b, pod[0]).label === "Hostile" && parleyStatus(b, pod[0]).active && parleyStatus(b, pod[0]).color === "#ff8f85", "Hostile: active, red");
  combatAct(state, { type: "callout", unit: mine[1].id, target: pod[0].id });
  check(parleyStatus(b, pod[0]).label === "Standoff" && !parleyStatus(b, pod[0]).active, "Standoff: not active");
  sure(1, () => choose(state, card(state, pod[0].pk), "Hold your fire"));
  check(parleyStatus(b, pod[0]).label === "Truce" && parleyStatus(b, pod[0]).truce, "Truce");
  // Save and load with the truce on.
  state.cards.length = 0;
  let s2 = null;
  try { s2 = deserializeState(JSON.parse(JSON.stringify(serializeState(state)))); } catch (e) { console.log(`  ${e.message}`); }
  const b2 = s2 && s2.combat;
  check(!!b2 && JSON.stringify(b2.parley) === JSON.stringify(b.parley), "a save round-trip keeps b.parley as it was");
  const u2 = b2 && b2.units.find((x) => x.id === pod[0].id);
  check(!!u2 && parleyStatus(b2, u2).label === "Truce" && u2.side === "third" && u2.pfrom != null, "and the truce on the loaded map");
}

// ---------- teaming up ----------
// Did any of `from` attack any of `to` in the log since index i (shots, bursts, misses, blows)?
const attacked = (b, from, to, i = 0) => b.log.slice(i).filter((l) => from.some((a) => l.text.startsWith(`${a} `) && /^\S+( \S+)? (shoots|fires|strikes|stabs|hits|swings|spits)/.test(l.text) && to.some((t) => l.text.includes(` ${t}:`) || l.text.includes(` ${t} and`) || l.text.includes(` ${t}.`) || l.text.includes(` ${t} (`)))).length;
section("Fight with us: an allied group fights the dead and the hostile, never you; a hostile group fights them");
{
  const state = world(121);
  const f = state.factions.find((x) => x.alive && !x.outsider);
  f.goodwill = 50;
  const { b, mine, p } = raid(state, [partyOf(f, "friendly", 3), raiders(3), { kind: "zombies", count: 4, power: 2, name: "the dead" }], { dead: true });
  const party = b.units.filter((x) => x.side === "third");
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const dead = b.units.filter((x) => x.kind === "zombie");
  inSight(b, mine[0], party, 3, 5);
  for (const x of mine.slice(1)) { x.x = mine[0].x; x.y = mine[0].y; x.off = true; } // one of yours, out of the way
  const rec = recOf(b, party[0]);
  const join0 = parleyOdds(state, b, rec, "join", mine[0]);
  combatAct(state, { type: "callout", unit: mine[0].id, target: party[0].id });
  const c = card(state, party[0].pk);
  check(c && c.choices.some((x) => x.label === "Fight with us" && /\d+%/.test(x.hint)), "the card offers Fight with us, with its odds");
  sure(1, () => choose(state, c, "Fight with us"));
  const st = parleyStatus(b, party[0]);
  check(rec.allied && party.every((x) => x.ally && x.side === "third") && st.label === "Allied" && st.allied && !st.active && st.color === "#4fe08a", `allied: Allied (${st.color}), not hostile, still a third side`);
  check(party.every((x) => !hostilePair(b, mine[0], x) && !hostilePair(b, x, mine[0]) && !foesOf(b, mine[0]).includes(x)), "nobody of yours shoots them (overwatch included), they never target yours");
  // The dead and the raiders, up and fighting, close to the allies (out of reach of yours).
  for (const x of pod) x.aware = true;
  inSight(b, party[0], [...dead.slice(0, 2), ...pod], 3, 5);
  const allyNames = party.map((x) => x.name), mineNames = mine.map((x) => x.name), deadNames = dead.map((x) => x.name), podNames = pod.map((x) => x.name);
  check(party.every((x) => foesOf(b, x).some((o) => o.kind === "zombie") && foesOf(b, x).some((o) => o.side === "enemy" && o.kind === "human")), "their foes: the dead and the hostile up and fighting");
  check(pod.every((x) => foesOf(b, x).some((o) => o.ally)), "the hostile go after them too");
  mine[0].ow = true; // on overwatch while they move about
  const from = b.log.length;
  for (let i = 0; i < 5 && !b.over; i++) { for (const x of b.units) if (x.side === "player") x.ap = 0; mine[0].ow = true; endPlayerTurn(state); runEnemyPhase(state); }
  const vsDead = attacked(b, allyNames, deadNames, from), vsPod = attacked(b, allyNames, podNames, from), vsYou = attacked(b, allyNames, mineNames, from);
  let podVsAlly = attacked(b, podNames, allyNames, from); const youVsAlly = attacked(b, mineNames, allyNames, from);
  console.log(`  5 turns: the allies attacked the dead ${vsDead}×, the raiders ${vsPod}×, yours ${vsYou}×; the raiders attacked the allies ${podVsAlly}×; yours attacked the allies ${youVsAlly}×`);
  check(vsDead + vsPod > 0 && vsYou === 0, "the allies fight the dead and the hostile, never you");
  if (!podVsAlly) { // the dead in their reach come first: the hostile and the allies alone, so the raiders' choice is theirs
    const st2 = world(122);
    const f2 = st2.factions.find((x) => x.alive && !x.outsider);
    f2.goodwill = 50;
    const r2 = raid(st2, [partyOf(f2, "friendly", 3), raiders(3)], { dead: true });
    const party2 = r2.b.units.filter((x) => x.side === "third"), pod2 = r2.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
    inSight(r2.b, r2.mine[0], party2, 3, 5);
    for (const x of r2.mine.slice(1)) { x.x = r2.mine[0].x; x.y = r2.mine[0].y; x.off = true; }
    combatAct(st2, { type: "callout", unit: r2.mine[0].id, target: party2[0].id });
    sure(1, () => choose(st2, card(st2, party2[0].pk), "Fight with us"));
    for (const x of pod2) x.aware = true;
    inSight(r2.b, party2[0], pod2, 3, 5);
    const from2 = r2.b.log.length;
    for (let i = 0; i < 5 && !r2.b.over; i++) { for (const x of r2.b.units) if (x.side === "player") x.ap = 0; endPlayerTurn(st2); runEnemyPhase(st2); }
    podVsAlly = attacked(r2.b, pod2.map((x) => x.name), party2.map((x) => x.name), from2);
    console.log(`  with none of the dead about: the raiders attacked the allies ${podVsAlly}×`);
  }
  check(podVsAlly > 0, "a hostile group fights your allies");
  check(youVsAlly === 0, "your people (overwatch too) never fire on them");
  check(foughtBonus(state, rec) > 0 && parleyOdds(state, b, rec, "join", mine[0]) > join0, `fighting side by side: the join chance up (${pc(join0)} → ${pc(parleyOdds(state, b, rec, "join", mine[0]))})`);
  mine[0].ap = 2; mine[0].ow = false;
  {
    const left = party.filter(activeAny);
    state.cards.length = 0;
    check(left.length > 0 && inSight(b, mine[0], left, 2, 6), "(test setup: an ally still standing, in sight)");
    const why = combatAct(state, { type: "callout", unit: mine[0].id, target: left[0].id });
    const jc = card(state, party[0].pk);
    const jh = jc && jc.choices.find((x) => x.label === "Join us");
    check(!!jh && /fought beside you: \+\d+%/.test(jh.hint), `the Join hint says so ("${jh ? jh.hint.match(/fought beside you: \+\d+%/)?.[0] : why}")`);
    state.cards.length = 0;
  }
  const gw = f.goodwill;
  const bb = endRaidNow(state);
  const r = bb.result.parley.find((x) => x.key === rec.key);
  check(r && r.allied && r.fought > 0, `result.parley: fought ${r && r.fought} (${JSON.stringify(r && r.foughtBy)})`);
  parleyGoodwill(state, bb.result);
  check(f.goodwill > gw && f.foughtWith > 0, `their group remembers: goodwill ${gw} → ${Math.round(f.goodwill)}, fought with ${f.foughtWith}`);
  // Next time: their people start with the bonus.
  const st2 = world(122);
  const f2 = st2.factions.find((x) => x.alive && !x.outsider);
  const R2 = raid(st2, [partyOf(f2, "friendly", 2)]);
  const rec2 = recOf(R2.b, R2.b.units.find((x) => x.side === "third"));
  const before = parleyOdds(st2, R2.b, rec2, "join", R2.mine[0]);
  f2.foughtWith = 10;
  check(parleyOdds(st2, R2.b, rec2, "join", R2.mine[0]) > before, "a group you fought beside before: better odds when you ask its people to join");
  // An attack of yours breaks the alliance like any truce.
  const st3 = world(123);
  const f3 = st3.factions.find((x) => x.alive && !x.outsider);
  const R3 = raid(st3, [partyOf(f3, "friendly", 2)]);
  const p3 = R3.b.units.filter((x) => x.side === "third");
  inSight(R3.b, R3.mine[0], p3, 3, 5);
  combatAct(st3, { type: "callout", unit: R3.mine[0].id, target: p3[0].id });
  sure(1, () => choose(st3, card(st3, p3[0].pk), "Fight with us"));
  damage(R3.b, p3[0], 2, R3.mine[0]);
  const rec3 = recOf(R3.b, p3[0]);
  check(!rec3.allied && rec3.brokeTruce === "player" && p3.every((x) => x.side === "enemy" && !x.ally), "your attack on them breaks it (a broken truce)");
  void p;
}

section("A city crawl's place: several groups on its map at once");
{
  const tally = { n: 0, places: 0, many: 0, friendly: 0, neutral: 0, hostile: 0 };
  const s0 = createWorld({ seed: 131, factionCount: 7 });
  const city = s0.tiles.find((t) => t.loc && t.loc.type === "city");
  for (let i = 0; i < 200; i++) {
    const gs = crawlParties(s0, city.id, `place-${i}`, 1 + (i % 6), 1 + (i % 4));
    tally.places++; tally.n += gs.length; if (gs.length > 1) tally.many++;
    for (const g of gs) tally[g.parley.stance]++;
    if (gs.length > PARLEY.CRAWL.max) tally.over = true;
  }
  console.log(`  ${tally.places} places: ${tally.n} groups, ${tally.many} places with more than one (${tally.friendly} friendly, ${tally.neutral} neutral, ${tally.hostile} hostile)`);
  check(tally.many > 0 && !tally.over && tally.friendly + tally.neutral > 0 && tally.hostile > 0, "several groups in some places, a mix of stances, never more than CRAWL.max");
  // On the map: a team crawling, a tall building deep in, every slot taken.
  const state = createWorld({ seed: 132, factionCount: 7 });
  state.cards.length = 0;
  const h = hub(state);
  const city2 = state.tiles.find((t) => t.loc && t.loc.type === "city");
  for (const k of ["food", "water", "ammo", "meds"]) h.stock[k] = 200;
  const crew = atBase(state, h.id).slice(0, 3);
  const res = launchExpedition(state, { memberIds: crew.map((x) => x.id), dest: city2.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60, meds: 3 } });
  const p = res.party;
  p.path = [city2.id]; p.idx = 0; p.dest = city2.id; p.phase = "engaged";
  CC.startCrawl(state, p);
  const c = p.crawl;
  CC.jumpToLevel(state, c, 4);
  let pl = null;
  for (let slot = 10; slot < 80 && !pl; slot++) {
    const x = { id: `t-offices-${slot}`, slot, key: "offices", name: "Offices on Test Street", kind: BUILDINGS.offices.name, dead: 1, rich: 1, raiders: false, looted: 0, blocked: null, quick: false, known: false, folk: { survivors: false, raidersUp: false, nest: false } };
    if (CC.placeStoreys(state, c, x) >= 3) pl = x;
  }
  const ch = PARLEY.CRAWL.chance;
  PARLEY.CRAWL.chance = 1;
  let b = null;
  try { CC.blockOf(c).places = [pl]; const err = CC.enterPlace(state, p, pl.id, { map: true }); if (err) console.log(`  ${err}`); b = state.combat; } finally { PARLEY.CRAWL.chance = ch; }
  const parties = b && b.parley ? b.parley.groups.filter((g) => g.party) : [];
  console.log(`  ${pl && pl.name}: ${parties.map((g) => `${g.name} (${g.stance}, ${b.units.filter((u) => u.pk === g.key).length})`).join(", ")}`);
  check(parties.length >= 2, `several groups on the place's map (${parties.length})`);
  check(parties.every((g) => b.units.filter((u) => u.pk === g.key).every((u) => (g.stance === "hostile" ? u.side === "enemy" : u.side === "third"))), "each on its side by its stance");
  for (let i = 0; i < 30 && b && !b.over; i++) { autoPlayerTurn(state); if (!b.over) runEnemyPhase(state); }
  if (b && !b.over) { for (const u of b.units) if (u.side === "player" && !u.dead) u.left = true; endCalledOff(state); }
  if (b) finishCombat(state, b.setup, b.result);
  check(!!b && b.over && !state.cards.some((x) => x && x.battle), "the bot plays it out; no card left over");
  void setFloor;
}

// ---------- who speaks ----------
section("Who speaks: the card says, the odds are theirs, another of yours can take over");
{
  const state = world(141);
  const { b, mine } = raid(state, [raiders(2)]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const [a, c2] = mine;
  survivorById(state, a.sid).skills.speech = 2; survivorById(state, c2.sid).skills.speech = 16;
  mine[2].x = a.x; mine[2].y = a.y; mine[2].off = true;
  inSight(b, a, pod, 3, 5);
  c2.x = a.x; c2.y = a.y + 1;
  if (!open(b, c2.x, c2.y) && !(c2.x === a.x && c2.y === a.y + 1)) c2.y = a.y - 1;
  faceToward(c2, pod[0].x, pod[0].y);
  check(canSee(b, c2, pod[0]), "(test setup: both of yours see them)");
  combatAct(state, { type: "callout", unit: a.id, target: pod[0].id });
  let cd = card(state, pod[0].pk);
  const pctOf = (cc) => Number((cc.choices.find((x) => x.label === "Hold your fire").hint.match(/^(?:Risky[^.]*\. )?(\d+)%/) || [])[1]);
  check(cd.speaker && cd.speaker.id === a.id && new RegExp(`Speaking: ${a.name} \\(Speech \\d+\\)`).test(cd.text), `the caller speaks, and the card says so ("${(cd.text.match(/Speaking:[^.]*\./) || [""])[0]}")`);
  check(cd.speakers.length === 2 && cd.speakers.every((x) => x.id && x.name && Number.isFinite(x.speech)), "card.speakers: who else could (plain data)");
  const low = pctOf(cd);
  choose(state, cd, `Let ${c2.name.split(" ")[0]} speak`);
  cd = card(state, pod[0].pk);
  check(cd && cd.speaker.id === c2.id && pctOf(cd) > low, `Let them speak: the odds are the better talker's (${low}% → ${pctOf(cd)}%), free`);
  check(a.ap === 1 && !Object.keys(recOf(b, pod[0]).tried).length, "(no action, nothing asked)");
  check(parleySpeak(state, pod[0].pk, a.id) === "" && card(state, pod[0].pk).speaker.id === a.id, "parleySpeak: the UI's switch");
  // Their call: the best talker who sees them answers.
  const st2 = world(142);
  const R2 = raid(st2, [raiders(2)]);
  const pod2 = R2.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const [a2, c22] = R2.mine;
  survivorById(st2, a2.sid).skills.speech = 2; survivorById(st2, c22.sid).skills.speech = 16;
  R2.mine[2].x = a2.x; R2.mine[2].y = a2.y; R2.mine[2].off = true;
  inSight(R2.b, a2, pod2, 2, 3);
  c22.x = a2.x; c22.y = a2.y + 1; faceToward(c22, pod2[0].x, pod2[0].y);
  const call = PARLEY.CALL.hostile; PARLEY.CALL.hostile = 1;
  try { notice(R2.b, pod2[0]); } finally { PARLEY.CALL.hostile = call; }
  parleyTick(st2, R2.b);
  const cd2 = card(st2, pod2[0].pk);
  check(cd2 && (canSee(R2.b, c22, pod2[0]) ? cd2.speaker.id === c22.id : cd2.speaker.id === a2.id), `their call: answered by the best talker who sees them (${cd2 && cd2.speaker.name})`);
}

// ---------- treachery tells ----------
section("Treachery tells: seen through, a warning; in a truce they edge closer, and nothing else changes");
function treacherous(seed, suspect) {
  const state = world(seed);
  const { b, mine } = raid(state, [raiders(3)]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const rec = recOf(b, pod[0]);
  Object.assign(rec, { treacherous: true, lie: PARLEY.LIE, stance: "hostile", hostility: 85 });
  for (const x of mine.slice(1)) { x.x = mine[0].x; x.y = mine[0].y; x.off = true; }
  inSight(b, mine[0], pod, 9, 11);
  const S = PARLEY.SUSPECT, m = S.min, M = S.max;
  S.min = S.max = suspect;
  try {
    combatAct(state, { type: "callout", unit: mine[0].id, target: pod[0].id });
    const cd = card(state, pod[0].pk);
    const text = cd.text, hint = cd.choices.find((x) => x.label === "Hold your fire").hint, trade = cd.choices.find((x) => x.label === "Trade").hint;
    sure(1, () => choose(state, cd, "Hold your fire"));
    const betrayAt = rec.betrayAt, d0 = Math.min(...pod.map((x) => Math.hypot(x.x - mine[0].x, x.y - mine[0].y)));
    let dMin = d0, tell = false, shots = 0, turned = -1;
    const names = pod.map((x) => x.name), from = b.log.length;
    for (let i = 0; i < 6 && turned < 0 && !b.over; i++) {
      for (const x of b.units) if (x.side === "player") x.ap = 0;
      endPlayerTurn(state);
      if (pod.some((x) => x.side === "enemy")) { turned = b.turn; break; }
      runEnemyPhase(state);
      tell = tell || parleyStatus(b, pod[0]).tell;
      dMin = Math.min(dMin, ...pod.filter(activeAny).map((x) => Math.hypot(x.x - mine[0].x, x.y - mine[0].y)));
      if (pod.every((x) => x.side === "third")) shots += shotsBy(b, names, from);
    }
    return { text, hint, trade, betrayAt, turned, d0, dMin, tell, shots };
  } finally { S.min = m; S.max = M; }
}
{
  const seen = treacherous(151, 1), unseen = treacherous(151, 0);
  check(/Something is off about them: they look at each other too much/.test(seen.text) && /^Risky/.test(seen.hint) && /^Risky/.test(seen.trade), "seen through: the warning, Hold your fire and Trade marked risky");
  check(!/Something is off/.test(unseen.text) && !/^Risky/.test(unseen.hint), "not seen through: nothing to read");
  console.log(`  in the truce: nearest of theirs ${seen.d0.toFixed(1)} → ${seen.dMin.toFixed(1)} tiles; they turned on turn ${seen.turned} (betrayAt ${seen.betrayAt})`);
  check(seen.dMin < seen.d0 && seen.dMin >= PARLEY.BETRAY.near + PARLEY.TELL.keep - 0.01 && seen.shots === 0, "they edge closer during the truce, never into the trap's range, never firing");
  check(seen.tell && !unseen.tell, "parleyStatus.tell: only for a group your people have seen through");
  check(seen.turned === seen.betrayAt && unseen.turned === unseen.betrayAt && seen.betrayAt === unseen.betrayAt, "the tell changes nothing true: they turn when they would have");
}

// ---------- the grudge ----------
section("A broken truce: no more talk this battle, and their group remembers (GRUDGE_DAYS)");
{
  const state = world(161);
  const f = state.factions.find((x) => x.alive && !x.outsider);
  f.goodwill = 60;
  const { b, mine } = raid(state, [partyOf(f, "neutral", 3)]);
  const party = b.units.filter((x) => x.side === "third");
  inSight(b, mine[0], party, 3, 5);
  combatAct(state, { type: "callout", unit: mine[0].id, target: party[0].id });
  sure(1, () => choose(state, card(state, party[0].pk), "Hold your fire"));
  state.cards.length = 0;
  combatAct(state, { type: "callout", unit: mine[0].id, target: party[0].id });
  const cd = card(state, party[0].pk);
  damage(b, party[0], 2, mine[0]); // your people break it while they talk
  const rec = recOf(b, party[0]);
  check(rec.brokeTruce === "player", "your hit after the truce: broken by you");
  check(cd.choices.filter((x) => x.label !== "Attack them" && x.label !== "Never mind").every((x) => dis(state, x)) && /will not talk/.test(cd.choices.find((x) => x.label === "Trade").resolve(state)), "the card still open: every answer refused, with the reason");
  mine[0].ap = 2;
  const st = party.find(activeAny);
  check(/will not talk to you again/.test(callOutRefusal(state, b, mine[0], st)), `Call out refused: "${callOutRefusal(state, b, mine[0], st)}"`);
  state.cards.length = 0;
  const bb = endRaidNow(state);
  parleyGoodwill(state, bb.result);
  check(f.grudge && f.grudge.day === day(state), `their group keeps a grudge (day ${f.grudge && f.grudge.day})`);
  // Their people next time (the same world fresh, its group with that grudge or none; later by days).
  const look = (grudge, later = 0) => {
    const s2 = world(161);
    s2.hour += later;
    const f2 = s2.factions.find((x) => x.alive && !x.outsider);
    f2.goodwill = 60;
    if (grudge) f2.grudge = { ...grudge };
    const R = raid(s2, [{ kind: "raiders", count: 2, power: 4, name: `${f2.name} patrol`, factionId: f2.id, guard: true }]);
    const u = R.b.units.find((x) => x.side === "enemy" && x.kind === "human");
    const r = recOf(R.b, u);
    return { r, o: { truce: parleyOdds(s2, R.b, r, "truce", R.mine[0]), join: parleyOdds(s2, R.b, r, "join", R.mine[0]) } };
  };
  const g = { day: day(state) };
  const withG = look(g), without = look(null);
  check(withG.r.grudge && withG.r.hostility > without.r.hostility && withG.o.truce < without.o.truce && withG.o.join <= without.o.join, `their people next time: hostility ${without.r.hostility} → ${withG.r.hostility}, truce ${pc(without.o.truce)} → ${pc(withG.o.truce)}`);
  check(!look(g, 24 * (PARLEY.GRUDGE_DAYS + 1)).r.grudge, `${PARLEY.GRUDGE_DAYS} days on: forgotten`);
  // A group that broke it on you: no grudge for them.
  const st2 = world(162);
  const f2 = st2.factions.find((x) => x.alive && !x.outsider);
  const R2 = raid(st2, [{ kind: "raiders", count: 2, power: 4, name: `${f2.name} patrol`, factionId: f2.id, guard: true }]);
  const pod2 = R2.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const rec2 = recOf(R2.b, pod2[0]);
  Object.assign(rec2, { treacherous: true, lie: PARLEY.LIE });
  for (const x of R2.mine.slice(1)) { x.x = R2.mine[0].x; x.y = R2.mine[0].y; x.off = true; }
  inSight(R2.b, R2.mine[0], pod2, 8, 10);
  combatAct(st2, { type: "callout", unit: R2.mine[0].id, target: pod2[0].id });
  sure(1, () => choose(st2, card(st2, pod2[0].pk), "Hold your fire"));
  for (let i = 0; i < 6 && !rec2.betrayed; i++) nextTurn(st2);
  const bb2 = endRaidNow(st2);
  parleyGoodwill(st2, bb2.result);
  check(rec2.brokeTruce === "them" && !f2.grudge, "they broke it on you: no grudge held against you");
}

// ---------- a shout's stakes ----------
section("A shout's stakes: by how crowded the place is (shoutCost); their loud call");
{
  const ground = (state, b, terrain, inf, block) => {
    state.tiles[b.tileId].terrain = terrain;
    if (b.parley) b.parley.ground = PARLEY.DENSE.terrain[terrain] ?? PARLEY.DENSE.other;
    b.infection = inf;
    b.setup.context = block ? { crawl: { kind: "place", block } } : {};
  };
  // A cell d0..d1 tiles from u, free (the dead placed there).
  const band = (b, u, z, d0, d1) => {
    for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) { const d = Math.hypot(x - u.x, y - u.y); if (d >= d0 && d <= d1 && open(b, x, y)) { z.x = x; z.y = y; z.f = 0; return true; } }
    return false;
  };
  const shoutAt = (seed, terrain, inf, block) => {
    const state = world(seed);
    const R = raid(state, [raiders(2), { kind: "zombies", count: 2, power: 2, name: "the dead" }], { dead: true });
    ground(state, R.b, terrain, inf, block);
    return { state, ...R };
  };
  const Q = shoutAt(131, "plains", 0, 0), D = shoutAt(131, "city", 0.8, 4);
  const quiet = shoutCost(Q.state, Q.b), dense = shoutCost(D.state, D.b);
  console.log(`  farmland, no dead: heard ${quiet.radius} tiles, Heat +${quiet.heat} (${quiet.risk}); a city's block 4, infection 0.8: heard ${dense.radius} tiles, Heat +${dense.heat} (${dense.risk}), density ${dense.density}`);
  check(dense.radius > quiet.radius && dense.heat > quiet.heat && dense.density > quiet.density, "a crowded place: the shout carries further and costs more Heat");
  check(quiet.risk === "low" && quiet.heat <= 2 && quiet.radius <= PARLEY.SHOUT + 1, "on quiet ground, at Heat 0: low risk, little Heat");
  check(typeof dense.text === "string" && dense.text.includes(`Heat +${dense.heat}`), `the tip's words ("${dense.text}")`);
  // Near a stage: the dense shout tips it (a wave), the quiet one comes close.
  for (const X of [Q, D]) { X.b.raid.heat = 20; X.b.raid.stage = 0; X.b.raid.spawnCap = 12; X.b.raid.spawned = 0; }
  const q2 = shoutCost(Q.state, Q.b), d2 = shoutCost(D.state, D.b);
  check(d2.risk === "high" && d2.wave && q2.risk === "some" && !q2.wave, `at Heat 20: the city's shout would bring a wave (${d2.risk}), the farmland's comes close (${q2.risk})`);
  D.b.raid.spawnCap = 0;
  check(shoutCost(D.state, D.b).risk === "low", "no more of the dead to come (the spawn cap reached): low");
  D.b.raid.spawnCap = 12;
  // The call itself: the dead between the two reaches hear the city's shout, not the farmland's; the Heat; the wave.
  for (const X of [Q, D]) {
    const u = X.mine[0], pod = X.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
    const [z1, z2] = X.b.units.filter((x) => x.kind === "zombie");
    outOfSight(X.b, u, z2); z2.aware = false;
    X.inSight = inSight(X.b, u, pod, 3, 5);
    X.placed = band(X.b, u, z1, quiet.radius + 1, dense.radius - 0.5);
    for (const x of pod) x.aware = false;
    z1.aware = false;
    X.noise0 = X.b.noise || 0;
    X.err = combatAct(X.state, { type: "callout", unit: u.id, target: pod[0].id });
    X.z1 = z1;
    X.card = card(X.state, pod[0].pk);
  }
  check(Q.inSight && D.inSight && Q.placed && D.placed && !Q.err && !D.err, "(test setup: both groups in sight, the dead placed between the reaches, the calls made)");
  check(D.z1.aware && !Q.z1.aware, "the dead between the reaches: the city's shout wakes them, the farmland's does not");
  check(D.b.noise - D.noise0 === dense.heat && Q.b.noise - Q.noise0 === quiet.heat, `the Heat: +${D.b.noise - D.noise0} in the city, +${Q.b.noise - Q.noise0} on farmland (b.noise, the turn's end)`);
  check(D.card && D.card.shout && D.card.shout.heat === dense.heat && D.card.text.includes(`Heat +${dense.heat}`), "the card says what the shout cost (card.shout, its text)");
  D.state.cards.length = 0;
  nextTurn(D.state);
  check(D.b.raid.stage >= 1 && D.b.raid.spawned > 0, `the turn's end: Heat ${Math.round(D.b.raid.heat)}, stage ${D.b.raid.stage}, ${D.b.raid.spawned} more of the dead (the raid's own wave)`);
  // Their call: a hostile pod's carries as yours does; nobody shouts on quiet terms.
  const st3 = world(132);
  const R3 = raid(st3, [raiders(3)]);
  ground(st3, R3.b, "city", 0.5, 0);
  const pod3 = R3.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  inSight(R3.b, R3.mine[0], pod3, 2, 3);
  const n0 = R3.b.noise || 0, want = shoutCost(st3, R3.b).heat;
  const call = PARLEY.CALL.hostile;
  PARLEY.CALL.hostile = 1;
  try { notice(R3.b, pod3[0]); } finally { PARLEY.CALL.hostile = call; }
  check(recOf(R3.b, pod3[0]).standoff && (R3.b.noise || 0) - n0 === Math.round(want * PARLEY.LOUD.hostile), `a hostile pod calling out shouts too: Heat +${(R3.b.noise || 0) - n0}`);
  check(PARLEY.LOUD.friendly === 0, "a friendly group calls quietly");
}

// ---------- sharing the haul ----------
section("Split what we found with allies who fought beside you; its own card when one of yours gets out; You kept it all");
{
  // An allied friendly party, a haul found (supplies loose, two pieces of gear).
  const allied = (seed, kills) => {
    const state = world(seed);
    const f = state.factions.find((x) => x.alive && !x.outsider);
    f.goodwill = 20;
    const R = raid(state, [partyOf(f, "friendly", 3)]);
    const party = R.b.units.filter((x) => x.side === "third");
    inSight(R.b, R.mine[0], party, 3, 5);
    combatAct(state, { type: "callout", unit: R.mine[0].id, target: party[0].id });
    sure(1, () => choose(state, card(state, party[0].pk), "Fight with us"));
    state.cards.length = 0;
    const rec = recOf(R.b, party[0]);
    R.b.raid.found.scrap = (R.b.raid.found.scrap || 0) + 30; R.mine[0].haul.sup.scrap = 30;
    const bar = makeItem("crowbar"), knife = makeItem("knife");
    R.mine[1].haul.gear.push(bar, knife); R.b.raid.foundGear.push(bar, knife);
    rec.fought.kills = kills;
    R.mine[0].ap = 2;
    return { state, f, party, rec, gear: [bar, knife], ...R };
  };
  const A = allied(141, 0);
  combatAct(A.state, { type: "callout", unit: A.mine[0].id, target: A.party[0].id });
  check(!card(A.state, A.party[0].pk).choices.some((x) => x.label === "Split what we found"), "allied, but they have not fought beside you yet: nothing to split");
  A.state.cards.length = 0;
  A.rec.fought.kills = 2; // they fought beside you
  A.mine[0].ap = 2;
  combatAct(A.state, { type: "callout", unit: A.mine[0].id, target: A.party[0].id });
  const c = card(A.state, A.party[0].pk);
  const sc = c && c.choices.find((x) => x.label === "Split what we found");
  check(!!sc && /third/.test(sc.hint) && /Join \+\d+%/.test(sc.hint) && sc.ai(A.state) > 0, `their card offers Split what we found ("${sc && sc.hint}")`);
  const join0 = parleyOdds(A.state, A.b, A.rec, "join", A.mine[0]), stock0 = A.f.stock.scrap || 0;
  const gearWorth = A.gear.reduce((a, it) => a + itemValue(it), 0);
  choose(A.state, c, "Split what we found");
  const gone = A.gear.filter((it) => !A.b.raid.foundGear.includes(it));
  check(A.mine[0].haul.sup.scrap === 20 && A.b.raid.found.scrap === 20 && (A.f.stock.scrap || 0) === stock0 + 10, "a third of each supply found: off your people and the raid's finds, into their group's stores");
  check(gone.reduce((a, it) => a + itemValue(it), 0) <= gearWorth / 3 + 1e-9 && gone.every((it) => !A.mine[1].haul.gear.includes(it)), `the found gear up to a third of its worth (${gone.map((it) => it.key).join(", ") || "none"} of ${A.gear.map((it) => it.key).join(", ")})`);
  check(A.rec.split && A.rec.split.kinds >= 1 && A.rec.fought.split === PARLEY.SPLIT.fought && parleyOdds(A.state, A.b, A.rec, "join", A.mine[0]) > join0, `it counts as fighting together: join ${pc(join0)} → ${pc(parleyOdds(A.state, A.b, A.rec, "join", A.mine[0]))}`);
  A.mine[0].ap = 2;
  A.state.cards.length = 0;
  combatAct(A.state, { type: "callout", unit: A.mine[0].id, target: A.party[0].id });
  check(!card(A.state, A.party[0].pk).choices.some((x) => x.label === "Split what we found"), "once: not offered again");
  A.state.cards.length = 0;
  const gwA = A.f.goodwill;
  const bbA = endRaidNow(A.state);
  const rA = bbA.result.parley.find((x) => x.key === A.rec.key);
  check(rA && rA.split && rA.split.kinds && !rA.keptAll, "result.parley: shared, not kept");
  parleyGoodwill(A.state, bbA.result);
  check(A.f.goodwill > gwA, `their group remembers: goodwill ${gwA} → ${Math.round(A.f.goodwill)}`);
  // One of yours gets out: they ask for a share (a card of their own); Keep it all.
  const B = allied(142, 2);
  B.mine[2].left = true; // extracted
  parleyTick(B.state, B.b);
  const bc = card(B.state, B.party[0].pk);
  check(!!bc && /ask for a share/.test(bc.title) && bc.split && ["Split what we found", "Keep it all"].every((l) => bc.choices.some((x) => x.label === l)), `one of yours out: "${bc && bc.title}" (Split what we found, Keep it all)`);
  choose(B.state, bc, "Keep it all");
  parleyTick(B.state, B.b);
  check(B.rec.kept && !card(B.state, B.party[0].pk), "kept: they ask once");
  const bbB = endRaidNow(B.state);
  const rB = bbB.result.parley.find((x) => x.key === B.rec.key);
  check(rB && rB.keptAll && rB.kept, "result.parley: You kept it all (out with the haul after they fought)");
  const gw0 = B.f.goodwill, fw0 = B.f.foughtWith;
  parleyGoodwill(B.state, { parley: bbB.result.parley.map((r) => ({ ...r, keptAll: false })) });
  const shared = B.f.goodwill;
  B.f.goodwill = gw0; B.f.foughtWith = fw0;
  parleyGoodwill(B.state, bbB.result);
  check(B.f.goodwill < shared, `keeping it all costs a little goodwill (${Math.round(shared)} had you not → ${Math.round(B.f.goodwill)})`);
  // Everyone out at once, nothing offered: kept all the same.
  const C = allied(143, 2);
  const rC = endRaidNow(C.state).result.parley.find((x) => x.key === C.rec.key);
  check(rC && rC.keptAll && !rC.kept, "everyone out at once after they fought, nothing shared: kept it all");
  // Nothing found: nothing to keep from them.
  const E = allied(144, 2);
  E.b.raid.found = {}; E.b.raid.foundGear = []; E.mine[0].haul.sup = {}; E.mine[1].haul.gear = [];
  const rE = endRaidNow(E.state).result.parley.find((x) => x.key === E.rec.key);
  check(rE && !rE.keptAll, "out with nothing found: nothing kept from them");
  // The bot: their card answered by its weights (fought hard beside you: it shares).
  const F = allied(145, 4);
  F.mine[2].left = true;
  parleyTick(F.state, F.b);
  resolveBattleCards(F.state);
  check(F.rec.split && F.rec.split.kinds > 0 && !card(F.state, F.party[0].pk), "the bot answers their card: it shares with those who fought hard beside it");
}

// ---------- trading with a Hostile group ----------
section("A trade agreed with a group that is Hostile toward you: a swap, never its trade window");
{
  const state = world(151);
  const f = state.factions.find((x) => x.alive && !x.outsider);
  f.goodwill = 40;
  const R = raid(state, [partyOf(f, "friendly", 2)]);
  const party = R.b.units.filter((x) => x.side === "third");
  inSight(R.b, R.mine[0], party, 3, 6);
  combatAct(state, { type: "callout", unit: R.mine[0].id, target: party[0].id });
  sure(1, () => choose(state, card(state, party[0].pk), "Trade"));
  const bb = endRaidNow(state);
  R.p.phase = "idle";
  f.goodwill = -60; // Hostile toward you by the time you are out (factions.js attitude)
  state.trade = null;
  check(!parleyTrade(state, R.p, bb.result) && !state.trade, "no trade window with a Hostile group");
  state.cards.length = 0;
  R.p.cargo = R.p.cargo || { supplies: {}, gear: [] };
  R.p.supplies.food = 20; R.p.supplies.water = 2;
  parleyAfterRaid(state, R.p, bb.result);
  const sw = state.cards.find((c) => /^Trading with/.test(c.title));
  check(!!sw && /will not open its stores/.test(sw.text), `the swap card instead ("${sw && sw.text}")`);
  f.goodwill = 10;
  state.cards.length = 0;
  parleyAfterRaid(state, R.p, bb.result);
  check(!state.cards.some((c) => /^Trading with/.test(c.title)) && parleyTrade(state, R.p, bb.result) && state.trade && state.trade.factionId === f.id, "not Hostile: its trade window, no swap card");
}

// ---------- the bot calls out ----------
section("The raid bot calls out on its own: the best talker, once a group; a pod only when it outnumbers yours");
{
  const calls = (b, name) => b.log.filter((l) => /calls out to/.test(l.text) && l.text.includes(name)).length;
  const keep = { ...PARLEY.CALL };
  try {
    for (const k of Object.keys(PARLEY.CALL)) PARLEY.CALL[k] = 0; // they never call first here
    // A third side in sight: the best talker of yours who sees them calls.
    const state = world(161);
    const f = state.factions.find((x) => x.alive && !x.outsider);
    f.goodwill = 40;
    const { b, mine } = raid(state, [partyOf(f, "neutral", 2)], { skills: { speech: 6 } });
    const party = b.units.filter((x) => x.side === "third");
    inSight(b, mine[0], party, 3, 5);
    for (const x of mine.slice(1)) { x.x = mine[0].x; x.y = mine[0].y; } // the others next to mine[0] (as close as it gets)
    for (const [i, x] of mine.slice(1).entries()) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (open(b, mine[0].x + dx, mine[0].y + dy)) { x.x = mine[0].x + dx; x.y = mine[0].y + dy; break; } faceToward(x, party[0].x, party[0].y); void i; }
    survivorById(state, mine[1].sid).skills.speech = 12;
    const rec = recOf(b, party[0]);
    const seers = mine.filter((p) => party.some((t) => canSee(b, p, t)));
    const best = [...seers].sort((p, q) => skill(survivorById(state, q.sid), "speech") - skill(survivorById(state, p.sid), "speech"))[0];
    const plan = botCallOut(state, b);
    rec.botCalled = false; // (the plan only: the turn calls again)
    check(!!plan && plan.unit === best && plan.target.pk === rec.key, `the plan: ${plan && plan.unit.name} calls (the best talker who sees them: ${best && best.name})`);
    autoPlayerTurn(state);
    check(rec.botCalled && rec.talks > 0 && rec.speaker === best.id && calls(b, rec.name) === 1, `the bot's turn: ${best.name} calls out to ${rec.name}, the card answered (${rec.allied ? "allied" : rec.truce ? "a truce" : rec.told ? "told" : `talks ${rec.talks}`})`);
    check(!state.cards.some((c) => c && c.battle), "no card left waiting");
    for (let i = 0; i < 4 && !b.over; i++) { runEnemyPhase(state); if (!b.over) autoPlayerTurn(state); }
    check(calls(b, rec.name) === 1, "once a group a battle");
    // An unaware hostile pod: called to only when it outnumbers yours.
    const pods = (seed, n) => {
      const st = world(seed);
      const R = raid(st, [raiders(n)], { skills: { speech: 12 } });
      const pod = R.b.units.filter((x) => x.side === "enemy" && x.kind === "human");
      inSight(R.b, R.mine[0], pod, 4, 6);
      for (const x of pod) x.aware = false;
      return { st, pod, rec: recOf(R.b, pod[0]), ...R };
    };
    const big = pods(162, 4), small = pods(163, 2);
    check(big.pod.length > big.mine.length && small.pod.length < small.mine.length, `(test setup: ${big.pod.length} of them against ${big.mine.length}; ${small.pod.length} against ${small.mine.length})`);
    const pb = botCallOut(big.st, big.b), ps = botCallOut(small.st, small.b);
    big.rec.botCalled = false; // (the plan only)
    check(!!pb && pb.target.pk === big.rec.key && !ps, "an unaware pod that outnumbers yours: call out; one yours can take: no");
    for (const x of small.pod) x.aware = true;
    check(!botCallOut(small.st, small.b), "a hostile pod that knows you are there: no talk");
    autoPlayerTurn(big.st);
    check(big.rec.talks > 0 && !big.st.cards.some((c) => c && c.battle), `the bot's turn with the pod: they talk (${big.rec.truce ? "a truce" : big.rec.turned ? "it went wrong" : big.rec.standoff ? "still standing off" : "talked"}), no card left`);
    // Risky ground lowers the bar: a high-risk shout at middling odds is not made.
    big.rec.botCalled = false;
    const mid = PARLEY.BOT.min;
    PARLEY.BOT.min = 0.9;
    try { check(!botCallOut(big.st, big.b), "below the weighed bar (BOT.min): no call"); } finally { PARLEY.BOT.min = mid; }
  } finally { Object.assign(PARLEY.CALL, keep); }
  // Headless raids with groups the bot calls to still end, and never leave a card.
  let ended = 0, talked = 0, n = 0;
  for (const seed of [171, 172, 173, 174]) {
    const state = world(seed);
    const f = state.factions.find((x) => x.alive && !x.outsider);
    const { b } = raid(state, [raiders(4), partyOf(f, seed % 2 ? "friendly" : "neutral", 2), { kind: "zombies", count: 3, power: 2, name: "the dead" }], { dead: true, skills: { speech: 10 } });
    n++;
    let waiting = 0;
    for (let i = 0; i < 120 && !b.over; i++) {
      autoPlayerTurn(state);
      if (state.cards.some((c) => c && c.battle)) waiting++;
      if (!b.over) runEnemyPhase(state);
    }
    if (b.over) ended++;
    if (b.parley && b.parley.groups.some((g) => g.botCalled)) talked++;
    check(waiting === 0, `seed ${seed}: no card waiting after a bot's turn (${b.over ? `${b.result.outcome}, ${b.turn} turns` : "still going"})`);
    if (!b.over) { for (const u of b.units) if (u.side === "player" && !u.dead) u.left = true; endCalledOff(state); }
    finishCombat(state, b.setup, b.result);
  }
  console.log(`  ${n} headless raids: ${ended} ended on their own, the bot called out in ${talked}`);
  check(ended === n, "every headless raid ends on its own");
  check(talked > 0, "the bot calls out in them");
}

// ---------- names ----------
section("The groups' own names; two with one name told apart");
{
  const state = world(181);
  const { b } = raid(state, [raiders(2), raiders(2), { kind: "survivors", count: 2, power: 3, name: "armed survivors", guard: true }]);
  const recs = b.parley.groups;
  const names = recs.map((r) => r.name);
  console.log(`  ${names.join("; ")}`);
  check(recs.length === 3 && recs.filter((r) => r.base === "rival scavengers").length === 2 && recs.some((r) => r.name === "armed survivors"), "each record has its group's own name (setup.enemy.groups[i].name), not the kit's");
  check(new Set(names).size === names.length && recs.filter((r) => r.base === "rival scavengers").every((r) => r.name.startsWith("rival scavengers") && (/ at the /.test(r.name) || / \(\d\)$/.test(r.name) || r.name === "rival scavengers")), "the two rival scavengers told apart (where they hold, or a number)");
  const pods = [...new Set(b.units.filter((u) => u.side === "enemy" && u.kind === "human").map((u) => u.pk))];
  check(pods.length === 3 && pods.map((k) => parleyStatus(b, b.units.find((u) => u.pk === k)).name).every((n, i, a) => a.indexOf(n) === i), "their badges differ");
}

// ---------- the bot ----------
section("The raid bot answers the cards; no card outlives the battle");
{
  let raids = 0, cardsSeen = 0, left = 0, truces = 0;
  const call = PARLEY.CALL.hostile;
  PARLEY.CALL.hostile = 1;
  try {
    for (const seed of [111, 112, 113, 114]) {
      const state = world(seed);
      const f = state.factions.find((x) => x.alive && !x.outsider);
      const { b } = raid(state, [raiders(3), partyOf(f, seed % 2 ? "friendly" : "neutral", 2), { kind: "zombies", count: 3, power: 2, name: "the dead" }], { dead: true });
      raids++;
      const res0 = resolveBattleCards;
      void res0;
      for (let i = 0; i < 40 && !b.over; i++) {
        autoPlayerTurn(state);
        if (b.parley && b.parley.groups.some((g) => g.talks > 0)) cardsSeen++;
        if (state.cards.some((c) => c && c.battle)) left++; // the bot's turn over: every card it met answered
        if (!b.over) runEnemyPhase(state);
      }
      if (!b.over) { for (const u of b.units) if (u.side === "player" && !u.dead) u.left = true; endCalledOff(state); }
      if (b.parley && b.parley.groups.some((g) => g.truce)) truces++;
      finishCombat(state, b.setup, b.result);
      check(!state.cards.some((c) => c && c.battle), `seed ${seed}: no battle card after the raid (${b.result.outcome}, ${b.turn} turns)`);
    }
  } finally { PARLEY.CALL.hostile = call; }
  console.log(`  ${raids} raids: talks in ${cardsSeen} bot turns, ${truces} with a truce; a card left after the bot's turn ${left} times`);
  check(cardsSeen > 0, "the bot talked to them");
  check(left === 0, "the bot never leaves a card waiting");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
