// Orders to allies in a raid (src/sim/allyorders.js, the user's request 2026-10-21):
//   - refusals: an ally within RANGE (5) on the same floor, an action left, not one who is not allied; an attack's
//     target one your side sees (not a third side); a move's cell anywhere, the fog too;
//   - the odds rise with the giver's Leadership and the group's fought-together credit, fall with the order's danger;
//   - an ignored order changes nothing (the action spent, a log line);
//   - each kind carried out: attack (the given target first, down), move (to a cell in the fog; an unwalkable one
//     resolved to the nearest it can reach), overwatch (faces the cone, keeps the watch through the enemy's turn and
//     fires on a mover in it), hold, follow, cover (what threatens the giver first), retreat (off the map, alive),
//     free (the order cleared);
//   - Tell me what you see: marks only on cells your side does not see, only in the ally's cone and sight, the fog not
//     revealed, a marked one of the dead that moves stays marked where it was, a mark dropped once your side sees its
//     cell, a second ask replacing the marks in that view, a save round-trip, none after the battle;
//   - a group order (a roll each, a cell each);
//   - Evac: the allies told to retreat; the raid ended by your extraction: the same;
//   - a save round-trip keeps the orders; nothing left on the units or in the cards after the battle; a death under
//     your orders costs a little goodwill; a raid with no allies takes the old paths; the raid bot's raids still end.
// Usage: node tools/allyorderstest.js
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, combatAct, registerCombatHandler, damage, endPlayerTurn, runEnemyPhase, autoPlayerTurn, finishCombat, canSee, canSeeAt, active, activeAny, playerVision, zoneAt, CELL } from "../src/sim/combat.js";
import { faceToward, inArc } from "../src/sim/vision.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { PARLEY, parleyGoodwill } from "../src/sim/parley.js";
import { thirdResult } from "../src/sim/thirdside.js";
import { LOCATIONS } from "../src/sim/data.js";
import { ALLY_ORDER, ALLY_ORDERS, allyOrderTargets, allyOrderRefusal, allyOdds, allyOrderOf, allyOrdersShown, allyOrdersGoodwill, allyIntel } from "../src/sim/allyorders.js";

let passes = 0, fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (ok) passes++; else fails++; return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
registerCombatHandler("aotest", () => {});
const pc = (v) => `${Math.round(v * 100)}%`;

// ---------- helpers (as tools/parleytest.js) ----------
function world(seed = 701) {
  const state = createWorld({ seed, factionCount: 7 });
  state.cards.length = 0;
  state.noWanderers = true;
  state.hour = Math.floor(state.hour / 24) * 24 + 36; // midday: no night cones
  return state;
}
const siteTile = (state) => state.tiles.find((t) => t.loc && LOCATIONS[t.loc.type] && !t.hive && t.terrain !== "water" && !state.bases.some((b) => b.tile === t.id) && !state.factions.some((f) => f.bases.includes(t.id)));
function raid(state, groups, { dead = false } = {}) {
  const h = hub(state);
  for (const k of ["food", "water", "meds"]) h.stock[k] = Math.max(h.stock[k] || 0, 60);
  const crew = atBase(state, h.id).slice(0, 3);
  const tile = siteTile(state);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 8, water: 8, ammo: 60, meds: 2 } });
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "aotest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 0, building: "street" }, context: {} };
  const b = createBattle(state, setup);
  state.combat = b;
  if (!dead) b.units = b.units.filter((u) => u.kind !== "zombie");
  b.raid.spawnCap = 0;
  return { b, p, setup, mine: b.units.filter((u) => u.side === "player") };
}
const open = (b, x, y) => x > 0 && y > 0 && x < b.w - 1 && y < b.h - 1 && b.reach[y * b.w + x] && CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => !o.dead && !o.left && o.x === x && o.y === y);
// Puts unit t on an open cell d0..d1 tiles from (x, y) (the nearest first), seen by `seer` when given.
function place(b, t, x, y, d0, d1, seer = null, test = null) {
  const cells = [];
  for (let cy = 1; cy < b.h - 1; cy++) for (let cx = 1; cx < b.w - 1; cx++) { const d = Math.hypot(cx - x, cy - y); if (d >= d0 && d <= d1) cells.push([cx, cy, d]); }
  cells.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
  const ox = t.x, oy = t.y;
  for (const [cx, cy] of cells) {
    if (!open(b, cx, cy)) continue;
    t.x = cx; t.y = cy; t.f = 0;
    if (seer) { faceToward(seer, cx, cy); if (!canSee(b, seer, t)) continue; }
    if (test && !test(cx, cy)) continue;
    return true;
  }
  t.x = ox; t.y = oy;
  return false;
}
const card = (state, key) => state.cards.find((c) => c && c.battle && c.parley === key);
const choose = (state, c, label) => { const i = state.cards.indexOf(c); if (i >= 0) state.cards.splice(i, 1); const ch = c.choices.find((x) => x.label === label || x.label.startsWith(label)); return ch.resolve(state); };
function sure(v, fn) { const O = PARLEY.ODDS, m = O.min, M = O.max; O.min = O.max = v; try { return fn(); } finally { O.min = m; O.max = M; } }
// Forced odds for the orders (ALLY_ORDER.ODDS min = max).
function heed(v, fn) { const O = ALLY_ORDER.ODDS, m = O.min, M = O.max; O.min = O.max = v; try { return fn(); } finally { O.min = m; O.max = M; } }
const recOf = (b, u) => b.parley.groups.find((g) => g.key === u.pk);
const nextTurn = (state) => { const b = state.combat; for (const u of b.units) if (u.side === "player") u.ap = 0; endPlayerTurn(state); runEnemyPhase(state); };
const partyOf = (f, n = 3) => ({ kind: "raiders", count: n, power: 4, name: `${f.name} scavengers`, factionId: f.id, side: "neutral", parley: { stance: "friendly", hostility: 15, treacherous: false } });
const deadOf = (n) => ({ kind: "zombies", count: n, power: 2, name: "the dead" });
const said = (b, from, re) => b.log.slice(from).some((l) => re.test(l.text));
const attacks = (b, a, t, from = 0) => b.log.slice(from).filter((l) => l.text.startsWith(`${a.name} `) && /^\S+( \S+)? (shoots|fires|strikes|stabs|hits|swings|lunges)/.test(l.text) && (l.text.includes(` ${t.name}:`) || l.text.includes(` ${t.name} `) || l.text.includes(` ${t.name}.`) || l.text.includes(` ${t.name},`))).length;
const order = (state, u, a, o) => combatAct(state, { type: "allyorder", unit: u.id, ally: a.id, order: o });

// A raid with an allied friendly party next to mine[0] (the rest of yours out of the way), the dead on the map
// put aside (off) for the tests to use. Returns { state, b, mine, me, allies, rec, dead }.
function allied(seed, { dead = 0, n = 3 } = {}) {
  const state = world(seed);
  const f = state.factions.find((x) => x.alive && !x.outsider);
  f.goodwill = 50;
  const R = raid(state, dead ? [partyOf(f, n), deadOf(dead)] : [partyOf(f, n)], { dead: !!dead });
  const { b, mine } = R;
  const me = mine[0];
  for (const x of mine.slice(1)) { x.x = me.x; x.y = me.y; x.off = true; }
  const allies = b.units.filter((x) => x.side === "third");
  const zs = b.units.filter((x) => x.kind === "zombie");
  for (const z of zs) { z.off = true; z.aware = false; }
  // The allies 2–3 tiles from me, seen.
  for (const a of allies) place(b, a, me.x, me.y, 2, 3.2, me);
  combatAct(state, { type: "callout", unit: me.id, target: allies[0].id });
  const c = card(state, allies[0].pk);
  if (c) sure(1, () => choose(state, c, "Fight with us"));
  state.cards.length = 0;
  me.ap = 2;
  return { state, b, mine, me, allies, rec: recOf(b, allies[0]), dead: zs, f };
}
// One of the dead put back on the map at a spot, aware.
const wake = (z) => { z.off = false; z.aware = true; z.hp = Math.max(z.hp, 1); };

// ---------- the old paths ----------
section("A raid with no allies: nothing to order, nothing shown");
{
  const state = world(700);
  const { b, mine } = raid(state, [deadOf(3)], { dead: true });
  check(!allyOrderTargets(state, b, mine[0]).length && !allyOrdersShown(b).length, "no ally to order, no order shown");
  const z = b.units.find((x) => x.kind === "zombie");
  const why = combatAct(state, { type: "allyorder", unit: mine[0].id, ally: z.id, order: { kind: "hold" } });
  check(/not fighting with you/.test(why), `an order to one of the dead refused ("${why}")`);
  check(ALLY_ORDERS.map((o) => o.kind).join() === "attack,move,push,overwatch,hold,follow,cover,info,retreat,free" && ALLY_ORDERS.every((o) => "need" in o && o.label && o.tip), "the orders in menu order, with what each needs");
}

// ---------- refusals ----------
section("Who may give which order: range, floor, action, the target seen, the fog");
{
  const { state, b, mine, me, allies, rec, dead } = allied(711, { dead: 3 });
  check(rec && rec.allied && allies.every((a) => a.ally), "(test setup: the party allied)");
  const a = allies[0];
  check(allyOrderTargets(state, b, me).includes(a), "an ally 2–3 tiles off is one to order");
  check(allyOrderRefusal(state, b, me, a, { kind: "hold" }) === "", "Hold: allowed");
  const ox = a.x, oy = a.y;
  check(place(b, a, me.x, me.y, 6, 7.5), "(test setup: the ally 6–7 tiles off)");
  const far = allyOrderRefusal(state, b, me, a, { kind: "hold" });
  check(/too far/.test(far) && !allyOrderTargets(state, b, me).includes(a), `out of range refused ("${far}")`);
  check(place(b, a, me.x, me.y, 4.5, 5), "(test setup: 5 tiles off)");
  check(allyOrderRefusal(state, b, me, a, { kind: "hold" }) === "", `within ${ALLY_ORDER.RANGE} tiles: allowed`);
  a.x = ox; a.y = oy;
  a.f = 1; check(/another floor/.test(allyOrderRefusal(state, b, me, a, { kind: "hold" })), "another floor refused"); a.f = 0;
  me.ap = 0; check(/No action/.test(allyOrderRefusal(state, b, me, a, { kind: "hold" })), "no action left refused"); me.ap = 2;
  check(/not fighting with you|whom/.test(allyOrderRefusal(state, b, me, mine[1], { kind: "hold" })), "one of yours is not an ally");
  // An attack: the target seen by your side; not a third side.
  const z = dead[0];
  wake(z);
  const fogged = place(b, z, me.x, me.y, 9, 30, null, () => !canSee(b, me, z));
  check(fogged, "(test setup: one of the dead out of your sight)");
  const notSeen = allyOrderRefusal(state, b, me, a, { kind: "attack", target: z.id });
  check(/cannot see/.test(notSeen), `a target your people cannot see refused ("${notSeen}")`);
  check(place(b, z, me.x, me.y, 5, 8, me), "(test setup: the dead one in sight)");
  check(allyOrderRefusal(state, b, me, a, { kind: "attack", target: z.id }) === "", "a target in sight: allowed");
  check(allyOrderRefusal(state, b, me, a, { kind: "attack", target: allies[1].id }) !== "", "an ally is no target");
  z.off = true;
  // A move into the fog: allowed (you do not see what they see).
  const vis = playerVision(b);
  let fog = null;
  for (let i = 0; i < b.w * b.h && !fog; i++) { const x = i % b.w, y = (i / b.w) | 0; if (!vis[i] && open(b, x, y)) fog = [x, y]; }
  check(!!fog, "(test setup: a cell in the fog)");
  check(allyOrderRefusal(state, b, me, a, { kind: "move", x: fog[0], y: fog[1] }) === "", `a move into the fog (${fog}) is allowed`);
  check(/Pick a spot/.test(allyOrderRefusal(state, b, me, a, { kind: "move", x: -1, y: 3 })), "off the map refused");
  check(/watch/.test(allyOrderRefusal(state, b, me, a, { kind: "overwatch" })), "overwatch needs a way to face");
  check(/Which order/.test(allyOrderRefusal(state, b, me, a, { kind: "dance" })), "an unknown order refused");
}

// ---------- the odds ----------
section("The odds: Leadership and fighting together up, danger down; an ignored order changes nothing");
{
  const { state, b, me, allies, rec, dead } = allied(721, { dead: 6 });
  const a = allies[0];
  const s = survivorById(state, me.sid);
  const z = dead[0]; wake(z);
  check(place(b, z, me.x, me.y, 5, 8, me), "(test setup: a target in sight)");
  const atk = { kind: "attack", target: z.id };
  s.skills.leadership = 2; const low = allyOdds(state, b, me, a, atk);
  s.skills.leadership = 12; const high = allyOdds(state, b, me, a, atk);
  check(high > low, `Leadership 2 → 12: ${pc(low)} → ${pc(high)}`);
  s.skills.leadership = 6;
  const before = allyOdds(state, b, me, a, atk);
  rec.fought.kills += 6;
  const after = allyOdds(state, b, me, a, atk);
  check(after > before, `fought together: ${pc(before)} → ${pc(after)}`);
  rec.fought.kills -= 6;
  // Danger: the target in among the dead.
  const crowd = dead.slice(1, 6);
  for (const x of crowd) { wake(x); place(b, x, z.x, z.y, 1, 2.5); }
  const danger = allyOdds(state, b, me, a, atk);
  check(danger < before, `the target in among the dead: ${pc(before)} → ${pc(danger)}`);
  const safeCell = [a.x, a.y];
  const quiet = allyOdds(state, b, me, a, { kind: "move", x: safeCell[0], y: safeCell[1] });
  const hot = allyOdds(state, b, me, a, { kind: "move", x: z.x, y: z.y });
  check(hot < quiet, `a move next to the dead: ${pc(quiet)} → ${pc(hot)}`);
  a.hp = Math.round(a.maxHp * 0.3);
  check(allyOdds(state, b, me, a, atk) < danger && allyOdds(state, b, me, a, { kind: "retreat" }) > allyOdds(state, b, me, allies[1], { kind: "retreat" }), "badly hurt: less willing to attack, more to retreat");
  check(allyOdds(state, b, me, a, { kind: "free" }) === 1, "Own call is always heeded");
  for (const x of [z, ...crowd]) x.off = true;
  // Ignored: nothing changes.
  a.aorder = undefined; delete a.aorder;
  const ap = me.ap, log = b.log.length, ow = !!a.ow, at = [a.x, a.y];
  const err = heed(0, () => order(state, me, a, { kind: "hold" }));
  check(err === "" && me.ap === ap - 1, "the order given: 1 action");
  check(!a.aorder && !!a.ow === ow && a.x === at[0] && a.y === at[1] && !allyOrderOf(b, a), "ignored: no order on them, nothing changed");
  check(said(b, log, /Not a chance|No way|ignores it/), `a log line (${b.log[b.log.length - 1].text})`);
  // Heeded: the order on them, its line; Leadership XP.
  const xp0 = (s.xpDay && s.xpDay.use && s.xpDay.use.leadership) || 0;
  const log2 = b.log.length;
  heed(1, () => order(state, me, a, { kind: "hold" }));
  const shown = allyOrderOf(b, a);
  check(!!a.aorder && a.aorder.kind === "hold" && shown && shown.kind === "hold" && shown.icon === ALLY_ORDER.ICON.hold && shown.heeded && shown.by === me.id, `heeded: u.aorder, shown as ${JSON.stringify(shown)}`);
  check(said(b, log2, /nods and holds/), "and its line");
  check(((s.xpDay && s.xpDay.use && s.xpDay.use.leadership) || 0) > xp0, "Leadership XP for it");
  // A treacherous group agrees to anything and goes its own way.
  rec.treacherous = true; rec.unmasked = false; rec.lie = rec.hostility;
  if (b.phase === "enemy") runEnemyPhase(state);
  me.ap = 2;
  const terr = heed(0, () => order(state, me, allies[1], { kind: "hold" })); if (terr) console.log(`  ${terr}`);
  check(!!allies[1].aorder && allies[1].aorder.fake && !!allyOrderOf(b, allies[1]), "a treacherous ally always agrees (a fake order, shown as heeded)");
  rec.treacherous = false;
}

// ---------- the orders carried out ----------
section("Attack: the given target first, until it is down");
{
  const { state, b, me, allies, dead } = allied(731, { dead: 2 });
  const a = allies[0];
  for (const x of allies.slice(1)) x.off = true;
  const [z1, z2] = dead;
  // The nearer one lies still where it is put (u.dormant: a Sleeper, combat.js aiUnit). Since 1370d1c (the map sizes of
  // 2026-10-24: another raid map for seed 731) it walked up to the ally in the first enemy phase while the target,
  // slowed by the ground, did not, and the ally rightly fought the one next to them first (allyFoes: the target and
  // whatever is next to them); on the old map both reached them and the target came first in the list. Lying still,
  // it is a nearer one of the dead in sight that the order narrows away, as the check means.
  wake(z1); wake(z2); z2.dormant = true;
  check(place(b, z2, a.x, a.y, 4, 5.5, me) && place(b, z1, a.x, a.y, 7, 9, me, (x, y) => Math.hypot(x - z2.x, y - z2.y) >= 4), "(test setup: two of the dead in sight, the given one farther)");
  z1.hp = z2.hp = 12; z1.ztype = z2.ztype = null;
  heed(1, () => order(state, me, a, { kind: "attack", target: z1.id }));
  check(a.aorder && a.aorder.kind === "attack" && allyOrderOf(b, a).targetId === z1.id, "the attack order, the target marked");
  me.ow = false;
  const from = b.log.length;
  let first = null;
  for (let i = 0; i < 8 && !z1.dead && active(a); i++) {
    nextTurn(state);
    if (!first) { const k1 = attacks(b, a, z1, from), k2 = attacks(b, a, z2, from); if (k1 || k2) first = k1 ? "given" : "other"; }
  }
  console.log(`  first attack on: ${first}; the target ${z1.dead ? "down" : `at ${z1.hp}`}`);
  check(first === "given", "the ally's first attack is on the given target");
  check(z1.dead || z1.down, "the target goes down");
  nextTurn(state);
  check(!a.aorder && said(b, from, /is down|lost/), "the order ends with it (back to their own call)");
}

section("Move: to a cell in the fog; an unwalkable one resolved to the nearest it can reach; held");
{
  const { state, b, me, allies } = allied(741);
  const a = allies[0];
  const vis = playerVision(b);
  let fog = null;
  for (let r = 6; r <= 10 && !fog; r++) for (let i = 0; i < b.w * b.h && !fog; i++) { const x = i % b.w, y = (i / b.w) | 0; if (!vis[i] && open(b, x, y) && Math.round(Math.hypot(x - a.x, y - a.y)) === r) fog = [x, y]; }
  check(!!fog, `(test setup: a fogged cell ${fog} 6–10 tiles off)`);
  heed(1, () => order(state, me, a, { kind: "move", x: fog[0], y: fog[1] }));
  const o = allyOrderOf(b, a);
  check(o && o.x === fog[0] && o.y === fog[1] && o.icon === ALLY_ORDER.ICON.move, "the marker on the cell picked");
  for (let i = 0; i < 4 && !(a.x === fog[0] && a.y === fog[1]); i++) nextTurn(state);
  check(a.x === fog[0] && a.y === fog[1], `there (${a.x},${a.y})`);
  nextTurn(state); nextTurn(state);
  check(a.x === fog[0] && a.y === fog[1] && a.aorder && a.aorder.there, "and holding it");
  // A wall cell: the nearest cell it can reach.
  const b2 = allied(742);
  const a2 = b2.allies[0];
  let wall = null;
  for (let r = 4; r <= 9 && !wall; r++) for (let i = 0; i < b2.b.w * b2.b.h && !wall; i++) { const x = i % b2.b.w, y = (i / b2.b.w) | 0; const C = CELL[b2.b.cells[i].k]; if (!C.walk && Math.round(Math.hypot(x - a2.x, y - a2.y)) === r && x > 0 && y > 0 && x < b2.b.w - 1 && y < b2.b.h - 1) wall = [x, y]; }
  check(!!wall, `(test setup: an unwalkable cell ${wall} (${wall && b2.b.cells[wall[1] * b2.b.w + wall[0]].k}))`);
  check(allyOrderRefusal(b2.state, b2.b, b2.me, a2, { kind: "move", x: wall[0], y: wall[1] }) === "", "allowed");
  heed(1, () => order(b2.state, b2.me, a2, { kind: "move", x: wall[0], y: wall[1] }));
  const o2 = a2.aorder;
  check(o2 && (o2.x !== wall[0] || o2.y !== wall[1]) && CELL[b2.b.cells[o2.y * b2.b.w + o2.x].k].walk && Math.hypot(o2.x - wall[0], o2.y - wall[1]) < 2.5, `resolved to a walkable cell next to it (${o2 && [o2.x, o2.y]}), asked ${o2 && o2.ask}`);
  for (let i = 0; i < 5 && !(a2.x === o2.x && a2.y === o2.y); i++) nextTurn(b2.state);
  check(a2.x === o2.x && a2.y === o2.y, "and reached");
}

section("Overwatch: faces the cone, watches through the enemy's turn, fires on a mover in it");
{
  const { state, b, me, allies, dead } = allied(751, { dead: 1 });
  const a = allies[0];
  for (const x of allies.slice(1)) x.off = true;
  // Face away from me: the cell 6 tiles beyond the ally, away from me.
  const dx = Math.sign(a.x - me.x) || 1, dy = Math.sign(a.y - me.y);
  const face = [Math.max(1, Math.min(b.w - 2, a.x + dx * 6)), Math.max(1, Math.min(b.h - 2, a.y + dy * 6))];
  heed(1, () => order(state, me, a, { kind: "overwatch", face }));
  check(a.ow && inArc(a, face[0], face[1]), `on watch, facing ${face}`);
  const shown = allyOrdersShown(b).find((x) => x.allyId === a.id);
  check(shown && shown.face && shown.face[0] === face[0] && shown.from[0] === a.x && shown.icon === ALLY_ORDER.ICON.overwatch, "shown with its cone");
  const z = dead[0]; wake(z); z.hp = 60; z.ztype = null;
  check(place(b, z, a.x, a.y, 7, 10, a, (x, y) => inArc(a, x, y)), `(test setup: one of the dead in the cone, ${Math.round(Math.hypot(z.x - a.x, z.y - a.y))} tiles off)`);
  for (const u of b.units) if (u.side === "player") u.ap = 0;
  const from = b.log.length;
  endPlayerTurn(state);
  check(a.ow, "still watching when the enemy's turn starts");
  runEnemyPhase(state);
  check(said(b, from, new RegExp(`${a.name} reacts on overwatch`)), "fires on the dead walking in the cone");
  check(a.aorder && a.aorder.kind === "overwatch" && a.ow, "the order stands, on watch again (any of the dead that got next to them fought off first)");
}

section("Hold: stays put and fires from there");
{
  const { state, b, me, allies, dead } = allied(761, { dead: 1 });
  const a = allies[0];
  for (const x of allies.slice(1)) x.off = true;
  heed(1, () => order(state, me, a, { kind: "hold" }));
  const z = dead[0]; wake(z); z.hp = 200; z.ztype = null;
  check(place(b, z, a.x, a.y, 6, 9, a), "(test setup: one of the dead in their sight)");
  const at = [a.x, a.y], from = b.log.length;
  nextTurn(state); nextTurn(state);
  check(a.x === at[0] && a.y === at[1], "not a step");
  check(attacks(b, a, z, from) > 0, "fires on it from where they stand");
}

section("Follow and cover: close to the one who gave it; cover fires first at what threatens them");
{
  const { state, b, me, allies, dead } = allied(771, { dead: 2 });
  const a = allies[0];
  for (const x of allies.slice(1)) x.off = true;
  heed(1, () => order(state, me, a, { kind: "follow" }));
  check(a.aorder.kind === "follow" && allyOrderOf(b, a).icon === ALLY_ORDER.ICON.follow, "following");
  check(place(b, me, a.x, a.y, 8, 10), "(test setup: the one they follow 8–10 tiles off)");
  for (let i = 0; i < 3 && Math.max(Math.abs(a.x - me.x), Math.abs(a.y - me.y)) > ALLY_ORDER.FOLLOW.far; i++) nextTurn(state);
  check(Math.max(Math.abs(a.x - me.x), Math.abs(a.y - me.y)) <= ALLY_ORDER.FOLLOW.far, `back within ${ALLY_ORDER.FOLLOW.far} tiles (${a.x},${a.y} → ${me.x},${me.y})`);
  // Cover: one of the dead near you, one near them (farther from you): yours first.
  me.ap = 2;
  place(b, me, a.x, a.y, 3, 3.2, null, (x, y) => Math.max(Math.abs(x - a.x), Math.abs(y - a.y)) <= ALLY_ORDER.FOLLOW.far);
  heed(1, () => order(state, me, a, { kind: "cover" }));
  const [z1, z2] = dead;
  wake(z1); wake(z2); z1.hp = z2.hp = 200; z1.ztype = z2.ztype = null;
  const ok1 = place(b, z1, me.x, me.y, 2, 3.5, a, (x, y) => Math.hypot(x - a.x, y - a.y) >= 2);
  const ok2 = ok1 && place(b, z2, a.x, a.y, 2, 5, a, (x, y) => Math.hypot(x - me.x, y - me.y) > ALLY_ORDER.COVER.r && Math.hypot(x - a.x, y - a.y) <= Math.hypot(z1.x - a.x, z1.y - a.y) + 1);
  check(ok1 && ok2, "(test setup: one of the dead by you, one nearer them but away from you)");
  const from = b.log.length;
  for (const u of b.units) if (u.side === "player") u.ap = 0;
  endPlayerTurn(state);
  // Only the ally acts: the dead hold still this turn.
  for (const z of [z1, z2]) z.ap = 0;
  runEnemyPhase(state);
  const k1 = attacks(b, a, z1, from), k2 = attacks(b, a, z2, from);
  console.log(`  cover: on the one by you ${k1}×, on the one by them ${k2}×`);
  check(k1 > 0 && k2 === 0, "covering: fires at the one threatening you");
}

section("Retreat: to the way out and off the map, alive (not fled)");
{
  const { state, b, me, allies, rec } = allied(781);
  const a = allies[0];
  heed(1, () => order(state, me, a, { kind: "retreat" }));
  const o = allyOrderOf(b, a);
  check(o && o.kind === "retreat" && o.x != null && o.icon === ALLY_ORDER.ICON.retreat, `heading for the way out (${o && [o.x, o.y]})`);
  for (let i = 0; i < 20 && !a.left && !b.over; i++) nextTurn(state);
  check(a.left && a.aleft && !a.dead && !a.fled, "off the map: left, not fled, not dead");
  check(!allyOrderOf(b, a) && !allyOrdersShown(b).some((x) => x.allyId === a.id), "nothing shown for them now");
  const tr = thirdResult(b).find((x) => x.alive != null);
  check(tr && tr.fled === 0 && tr.alive === tr.start, `the group's result: ${tr && tr.alive}/${tr && tr.start} alive, ${tr && tr.fled} fled`);
  // The raid ends; the count kept.
  for (const u of b.units) if (u.side === "player") { u.left = true; }
  combatAct(state, { type: "end" });
  if (!b.over) { endPlayerTurn(state); runEnemyPhase(state); }
  if (!b.over) { const { endCalledOff } = await import("../src/sim/combat.js"); endCalledOff(state); }
  const r = b.result && b.result.parley ? b.result.parley.find((x) => x.key === rec.key) : null;
  check(r && r.orders && r.orders.out === 1 && r.orders.dead === 0, `result.parley orders: ${JSON.stringify(r && r.orders)}`);
  check(b.units.every((u) => !u.aorder), "no order left on any unit after the battle");
}

section("Push: on to the cell, fighting what is there");
{
  const { state, b, me, allies, dead } = allied(785, { dead: 1 });
  const a = allies[0];
  for (const x of allies.slice(1)) x.off = true;
  const z = dead[0]; wake(z); z.hp = 25; z.ztype = null;
  check(place(b, z, a.x, a.y, 7, 9, me), "(test setup: one of the dead out there, in sight)");
  heed(1, () => order(state, me, a, { kind: "push", x: z.x, y: z.y }));
  const o = a.aorder;
  check(o && o.kind === "push" && (o.x !== z.x || o.y !== z.y), `pushing to a cell next to it (${o && [o.x, o.y]})`);
  const from = b.log.length;
  for (let i = 0; i < 6 && !z.dead; i++) nextTurn(state);
  check(attacks(b, a, z, from) > 0, "fights what is at the cell");
}

section("Own call: the order cleared");
{
  const { state, b, me, allies } = allied(791);
  const a = allies[0];
  heed(1, () => order(state, me, a, { kind: "hold" }));
  me.ap = 2;
  heed(0, () => order(state, me, a, { kind: "free" }));
  check(!a.aorder && !allyOrderOf(b, a), "Own call (even at 0% odds): no order");
}

section("Tell me what you see: marks in your fog, not updated, gone once you see the cell");
{
  const { state, b, me, allies, dead } = allied(841, { dead: 2 });
  const a = allies[0];
  for (const x of allies.slice(1)) x.off = true;
  heed(1, () => order(state, me, a, { kind: "hold" }));
  if (b.phase === "enemy") runEnemyPhase(state);
  me.ap = 2;
  const sight = me.sight;
  me.sight = 2; // (test setup: your one's eyes poor: most of the map is fog)
  const dir = [a.x < b.w / 2 ? 1 : -1, 0];
  faceToward(a, a.x + dir[0] * 6, a.y);
  const [z1, z2] = dead;
  wake(z1); wake(z2); z1.ap = z2.ap = 0;
  const vis0 = playerVision(b);
  const fogged = (x, y) => !vis0[y * b.w + x];
  check(place(b, z1, a.x, a.y, 5, 9, a, (x, y) => fogged(x, y) && inArc(a, x, y)), `(test setup: one of the dead in the ally's cone, in your fog: ${z1.x},${z1.y})`);
  check(place(b, z2, a.x, a.y, 4, 8, null, (x, y) => fogged(x, y) && !inArc(a, x, y) && Math.max(Math.abs(x - a.x), Math.abs(y - a.y)) > 1), `(test setup: one behind the ally, out of its cone: ${z2.x},${z2.y})`);
  const before = Array.from(playerVision(b)).join("");
  const from = b.log.length;
  heed(1, () => order(state, me, a, { kind: "info" }));
  const marks = allyIntel(b);
  console.log(`  ${marks.length} marks: ${[...new Set(marks.map((m) => m.kind))].join(", ")}; ${b.log.slice(from).map((l) => l.text).join(" / ")}`);
  check(marks.some((m) => m.kind === "zombie" && m.x === z1.x && m.y === z1.y && m.by === a.id && m.label && m.turn === b.turn), "the one of the dead in their cone is marked (kind, label, by, turn)");
  check(!marks.some((m) => m.x === z2.x && m.y === z2.y), "nothing behind them, out of their cone");
  const vis1 = playerVision(b);
  check(marks.every((m) => !vis1[m.y * b.w + m.x]), "every mark on a cell your side does not see");
  check(marks.every((m) => (Math.max(Math.abs(m.x - a.x), Math.abs(m.y - a.y)) <= 1 || inArc(a, m.x, m.y)) && canSeeAt(b, a, m.x, m.y)), "every mark in their cone and their sight");
  check(Array.from(vis1).join("") === before, "the fog is not revealed");
  check(said(b, from, /of the dead/), "their words count it");
  check(a.aorder && a.aorder.kind === "hold" && !allyOrdersShown(b).some((x) => x.kind === "info"), "the order they hold stands (info is no standing order)");
  // It does not update.
  const old = [z1.x, z1.y];
  check(place(b, z1, old[0], old[1], 1, 2.5, null, (x, y) => fogged(x, y) && inArc(a, x, y)), "(test setup: the dead one moves on)");
  check(allyIntel(b).some((m) => m.kind === "zombie" && m.x === old[0] && m.y === old[1]) && !allyIntel(b).some((m) => m.x === z1.x && m.y === z1.y && m.kind === "zombie"), "still marked where it was told");
  // A save round-trip.
  let s2 = null;
  try { s2 = deserializeState(JSON.parse(JSON.stringify(serializeState(state)))); } catch (e) { console.log(`  ${e.message}`); }
  check(!!s2 && JSON.stringify(allyIntel(s2.combat)) === JSON.stringify(allyIntel(b)), "the marks survive a save");
  // Asked again: the marks in that view replaced.
  me.ap = 2;
  heed(1, () => order(state, me, a, { kind: "info" }));
  const m2 = allyIntel(b);
  check(m2.some((m) => m.kind === "zombie" && m.x === z1.x && m.y === z1.y) && !m2.some((m) => m.kind === "zombie" && m.x === old[0] && m.y === old[1]), "asked again: marked where it is now, the old mark gone");
  // Your side sees the cell: the mark goes.
  if (b.phase === "enemy") runEnemyPhase(state);
  me.sight = sight; me.ap = 2;
  combatAct(state, { type: "face", unit: me.id, faceX: z1.x, faceY: z1.y });
  const vis2 = playerVision(b);
  const m3 = allyIntel(b);
  check(vis2[z1.y * b.w + z1.x] ? !m3.some((m) => m.x === z1.x && m.y === z1.y) : true, `seen now: its mark dropped (${vis2[z1.y * b.w + z1.x] ? "in sight" : "still fogged"})`);
  check(m3.every((m) => !vis2[m.y * b.w + m.x]) && m3.length < m2.length, `every mark left is still in your fog (${m2.length} → ${m3.length})`);
  for (const u of b.units) if (u.side === "player") u.left = true;
  const { endCalledOff } = await import("../src/sim/combat.js");
  endCalledOff(state);
  check(!b.intel && !allyIntel(b).length, "no marks after the battle");
}

section("A group order: a roll each, a cell each");
{
  const { state, b, me, allies } = allied(801);
  check(allies.length >= 2 && allies.every((a) => allyOrderTargets(state, b, me).includes(a)), `(test setup: ${allies.length} allies in range)`);
  let cell = null;
  for (let r = 6; r <= 9 && !cell; r++) for (let i = 0; i < b.w * b.h && !cell; i++) { const x = i % b.w, y = (i / b.w) | 0; if (open(b, x, y) && Math.round(Math.hypot(x - me.x, y - me.y)) === r) cell = [x, y]; }
  const ap = me.ap, n0 = b.aorders || 0;
  heed(1, () => order(state, me, allies[0], { kind: "move", x: cell[0], y: cell[1], group: true }));
  const cells = allies.map((a) => a.aorder && `${a.aorder.x},${a.aorder.y}`);
  check(me.ap === ap - 1 && (b.aorders || 0) - n0 === allies.length, `one action, ${allies.length} rolls`);
  check(cells.every(Boolean) && new Set(cells).size === allies.length, `each its own cell (${cells.join(" ")})`);
  for (let i = 0; i < 4; i++) nextTurn(state);
  check(allies.every((a) => a.x === a.aorder.x && a.y === a.aorder.y), "all of them there");
}

section("Evac: the allies told to retreat; your extraction ends the raid with them pulling out too");
{
  const { state, b, me, allies, rec } = allied(811);
  const from = b.log.length;
  heed(1, () => combatAct(state, { type: "evac" }));
  check(b.over ? rec.aorders.heeded === allies.length : allies.every((a) => a.aorder && a.aorder.kind === "retreat"), `every ally on a retreat order (${JSON.stringify(rec.aorders)})`);
  check(said(b, from, /allies pull out with you/), "a log line");
  const R2 = allied(812);
  const me2 = R2.me;
  const z = R2.b.raid.zones[0];
  me2.x = z.x0; me2.y = z.y0;
  for (const a of R2.allies) delete a.aorder;
  const from2 = R2.b.log.length;
  heed(1, () => combatAct(R2.state, { type: "extract", unit: me2.id }));
  check(R2.b.over && said(R2.b, from2, /allies pull out with you/), "the last of yours out: the allies told to pull out, the raid over");
  check(R2.b.units.every((u) => !u.aorder), "no order left on the units");
  check(!R2.state.cards.some((c) => c && c.battle), "no battle card left");
  const r = R2.b.result.parley.find((x) => x.key === R2.rec.key);
  check(r && r.orders && r.orders.heeded >= R2.allies.length && r.dead === 0, `result: ${JSON.stringify(r && r.orders)}`);
}

section("Save round-trip, a death under your orders");
{
  const { state, b, me, allies, rec, f } = allied(821);
  const a = allies[0];
  heed(1, () => order(state, me, a, { kind: "hold" }));
  let s2 = null;
  try { s2 = deserializeState(JSON.parse(JSON.stringify(serializeState(state)))); } catch (e) { console.log(`  ${e.message}`); }
  const a2 = s2 && s2.combat && s2.combat.units.find((x) => x.id === a.id);
  check(!!a2 && JSON.stringify(a2.aorder) === JSON.stringify(a.aorder) && JSON.stringify(allyOrderOf(s2.combat, a2)) === JSON.stringify(allyOrderOf(b, a)), "the order survives a save");
  damage(b, a, 999, null);
  check(a.dead, "(test setup: the ally killed while holding)");
  for (const u of b.units) if (u.side === "player") u.left = true;
  const { endCalledOff } = await import("../src/sim/combat.js");
  endCalledOff(state);
  const r = b.result.parley.find((x) => x.key === rec.key);
  check(r && r.orders && r.orders.dead === 1, `result: died under your orders ${r && r.orders && r.orders.dead}`);
  const gw = f.goodwill;
  allyOrdersGoodwill(state, { parley: [r] });
  check(f.goodwill < gw && f.goodwill >= gw + ALLY_ORDER.GOODWILL.max, `goodwill ${gw} → ${f.goodwill}`);
  const gw2 = f.goodwill;
  parleyGoodwill(state, b.result);
  check(Number.isFinite(f.goodwill), `parleyGoodwill applies it with the rest (${gw2} → ${Math.round(f.goodwill)})`);
  finishCombat(state, b.setup, b.result);
}

section("The raid bot: raids with allies still end");
{
  let ended = 0;
  for (const seed of [831, 832, 833]) {
    const { state, b } = allied(seed, { dead: 4 });
    for (const z of b.units.filter((x) => x.kind === "zombie")) { z.off = false; z.aware = false; }
    for (const u of b.units) if (u.side === "player") u.off = false;
    let i = 0;
    for (; i < 80 && !b.over; i++) { autoPlayerTurn(state); if (!b.over && b.phase === "enemy") runEnemyPhase(state); }
    if (b.over) ended++;
    console.log(`  seed ${seed}: ${b.over ? "ended" : "still on"} after ${i} turns; allies out ${b.units.filter((u) => u.aleft).length}`);
  }
  check(ended === 3, "every one ended");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
void active; void activeAny; void zoneAt;
