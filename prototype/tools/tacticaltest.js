// The tactical map's bodies and ground (sim/ground.js, the ux-tactical asks): a body searched where it fell, things put
// on the ground and picked up again, and what is left reaching the loot after the battle, with nothing rolled twice or
// lost:
//   1. a dead enemy searched (1 action, then free): its gun and rounds onto a survivor, the gun fought with at once;
//      what is left on it is that body after the battle (not rolled again), nothing taken is still on it;
//   2. the dead of the other kinds: one of yours (their own things), a third side's, the dead with gear (a soldier in
//      their kit) and the plain dead (nothing to search);
//   3. the ground: an item and part of a stack put down (free), picked up again from the next cell (hauling time),
//      blasts wear it, an enemy with no gun snatches a rifle lying there;
//   4. the end: ground items and leftovers in the loot after a win (taken home), left at a death site after a retreat;
//      what your people carry loose comes home, a fallen one's lies where they fell; no item in two places;
//   5. a raid: a pile on the ground there, the raid's count of places to search leaves it out; a save mid-battle.
// Prints "passed" / "failed" lines; exits 1 on a failure. Usage: node tools/tacticaltest.js [seed]
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { createBattle, combatAct, registerCombatHandler, endBattleNow, closeCombat, enemyUnit, WEAPONS, unitById } from "../src/sim/combat.js";
import { newItem, allItems, allCarried, takeAllBodies, battleBodies, lootItem } from "../src/sim/inventory.js";
import * as G from "../src/sim/ground.js";
import * as RL from "../src/sim/raidloot.js";
import { groundBlast } from "../src/sim/launchers.js";
import { launchExpedition } from "../src/sim/parties.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`${ok ? "passed" : "failed"}: ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
registerCombatHandler("tactest", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.cards.length = 0; return st; };
const P = (b) => b.units.filter((u) => u.side === "player");
const E = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.face = [0, 0]; };

// An open field at the hub (a base battle: the armory is the storage), 3 of yours, raiders with rifles.
function openBattle(st, enemy = { kind: "raiders", count: 3, power: 3 }) {
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 3);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "tactest", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; delete c.bar; }
  b.losCache.fill(0);
  b.phase = "player";
  b.fires = []; b.smoke = [];
  let i = 0;
  for (const u of b.units) {
    if (u.side === "player") place(u, 2, 2 + 2 * P(b).indexOf(u));
    else place(u, 20 + (i % 3), 3 + 2 * (i++ >> 0));
    u.aware = true; u.ow = false;
  }
  return { b, h, people };
}
const kill = (b, u) => { u.dead = true; u.hp = 0; u.down = false; };
// Every item object reachable: survivors (worn, held, pockets, rig, pack), the base armory, parties' cargo, the battle's
// bodies, the layer's containers, hauls, death sites.
function everyItem(st) {
  const out = [];
  const deep = (it) => { if (!it) return; out.push(it); if (Array.isArray(it.contents)) it.contents.forEach(deep); };
  for (const s of st.survivors) if (s.gear) allItems(s).forEach(deep);
  for (const b of st.bases) (b.armory || []).forEach(deep);
  for (const p of st.parties) if (p.cargo) (p.cargo.gear || []).forEach(deep);
  const b = st.combat;
  if (b) {
    for (const body of b.bodies || []) if (body.sid == null) allItems(body).forEach(deep);
    const L = RL.lootLayer(b);
    if (L) for (const c of L.containers) if (c.contents) c.contents.gear.forEach(deep);
    for (const u of b.units) if (u.haul) u.haul.gear.forEach(deep);
  }
  for (const d of st.deathSites || []) for (const e of d.items) if (e.item) deep(e.item);
  return out;
}
const dupes = (st) => { const seen = new Set(), d = []; for (const it of everyItem(st)) { if (seen.has(it)) d.push(it); seen.add(it); } return d; };
// Death sites list a fallen survivor's things while they still wear them (world.js killSurvivor): those are one item in
// two places on purpose; leave the dead out of the count.
const dupesLive = (st) => dupes(st).filter((it) => !st.survivors.some((s) => !s.alive && s.gear && allItems(s).includes(it)));

// ---------- 1. a dead enemy searched ----------
section("1. A dead enemy searched where it fell");
{
  const st = world();
  const { b, h } = openBattle(st);
  const me = P(b)[0], s = survivorById(st, me.sid);
  const foe = E(b)[0];
  foe.kit = "raiders"; foe.weapon = "huntrifle"; foe.weaponName = WEAPONS.huntrifle.name;
  kill(b, foe);
  place(foe, 3, 2);
  check(G.bodiesNear(b, me).includes(foe), "the dead enemy next to the survivor is listed to search");
  const ap0 = me.ap;
  check(combatAct(st, { type: "searchBody", unit: me.id, target: foe.id }) === "", "Search the body: allowed");
  check(me.ap === ap0 - 1, `the first search costs 1 action (${ap0} → ${me.ap})`);
  const box = G.bodyBoxOf(b, foe);
  check(!!box && box.kind === "body" && box.uid === foe.id, "the body is a container of the battle's loot layer (b.fieldLoot)");
  const gun = box.contents.gear.find((it) => it.key === "huntrifle");
  check(!!gun, `its gun is on it (${box.contents.gear.map((g) => g.name).join(", ")})`);
  const roundKeys = Object.keys(box.contents.sup).filter((k) => box.contents.sup[k] >= 1);
  check(roundKeys.length > 0, `and its rounds (${roundKeys.map((k) => `${box.contents.sup[k]} ${k}`).join(", ")})`);
  check(combatAct(st, { type: "searchBody", unit: me.id, target: foe.id }) === "" && G.bodyBoxOf(b, foe) === box, "searching it again opens the same body (no second roll)");
  // Take the gun into the hands and the rounds loose.
  s.gear.weapon = null;
  const gi = box.contents.gear.indexOf(gun);
  const msg = RL.raidMove(st, me.id, `rbox:${box.id}:gear:${gi}`, `s:${s.id}:weapon`);
  check(s.gear.weapon === gun && !box.contents.gear.includes(gun), `the hunting rifle into the survivor's hands (${msg})`);
  check(me.weapon === "huntrifle", `and fought with at once (unit weapon ${me.weapon})`);
  const k0 = roundKeys[0], n0 = box.contents.sup[k0];
  RL.raidMove(st, me.id, `rbox:${box.id}:sup:${k0}`, `haul:${me.id}:list`);
  check((me.haul.sup[k0] || 0) === n0 && !(box.contents.sup[k0] >= 1), `${n0} ${k0} carried loose`);
  check(b.pools.includes(me.haul.sup), "found rounds count at once (the haul is one of the battle's pools)");
  const left = box.contents.gear.slice();
  // A second body not searched: rolled at the end as before.
  for (const e of E(b)) if (!e.dead) kill(b, e);
  check(dupesLive(st).length === 0, "no item in two places before the end");
  endBattleNow(st, "victory");
  const bodies = b.bodies;
  const foeBodies = bodies.filter((x) => x.uid === foe.id);
  check(foeBodies.length === 1 && foeBodies[0].pile, `the searched enemy is one body after the battle, its leftovers (${foeBodies.length})`);
  check(!bodies.some((x) => allItems(x).includes(gun)), "the gun taken is on no body after the battle");
  check(left.every((it) => bodies.some((x) => allItems(x).includes(it)) || h.armory.includes(it)), "what was left on it reaches the loot (on a body, or taken headless into the armory)");
  check((h.stock[k0] || 0) >= n0, `the rounds carried loose came home to the base stock (${h.stock[k0] || 0} ${k0})`);
  check(b.result.loot.gear.includes(gun), "the result's loot line counts what was found in the battle");
  check(dupesLive(st).length === 0, `no item in two places after the end (${dupesLive(st).map((i) => i.name).join(", ")})`);
  closeCombat(st);
  check(dupesLive(st).length === 0, "nor after the battle is closed");
}

// ---------- 2. the other dead ----------
section("2. One of yours, a third side, the dead with gear and without");
{
  const st = world(seed + 1);
  const { b } = openBattle(st);
  const [me, mate] = P(b);
  const ms = survivorById(st, mate.sid);
  ms.gear.weapon = newItem("pistol", 1);
  const theirGun = ms.gear.weapon;
  kill(b, mate);
  place(mate, 3, 2); place(me, 2, 2);
  check(combatAct(st, { type: "searchBody", unit: me.id, target: mate.id }) === "", "one of your fallen can be searched");
  const box = G.bodyBoxOf(b, mate);
  check(box.contents.gear.includes(theirGun) && !allItems(ms).includes(theirGun), "their own things are on the body (off the survivor)");
  const z = enemyUnit(b, st.rng, "zombies", 2, 9);
  b.units.push(z); kill(b, z); place(z, 1, 2);
  check(!!G.bodyRefusal(b, z), `one of the plain dead has nothing to search (${G.bodyRefusal(b, z)})`);
  z.ztype = "soldier";
  check(!G.bodyRefusal(b, z), "a dead soldier in their kit can be searched");
  me.ap = 2;
  combatAct(st, { type: "searchBody", unit: me.id, target: z.id });
  const zb = G.bodyBoxOf(b, z);
  check(!!zb, `searched (${zb ? zb.contents.gear.map((g) => g.name).join(", ") || "nothing" : "no box"})`);
  const third = enemyUnit(b, st.rng, "raiders", 2, 10);
  third.side = "third"; third.kit = "survivors"; b.units.push(third); kill(b, third); place(third, 2, 3);
  me.ap = 2;
  check(combatAct(st, { type: "searchBody", unit: me.id, target: third.id }) === "" && !!G.bodyBoxOf(b, third), "a third side's dead can be searched");
  const far = E(b)[0]; kill(b, far); place(far, 15, 15);
  check(!!combatAct(st, { type: "searchBody", unit: me.id, target: far.id }), "a body out of reach cannot");
  const live = E(b)[1];
  check(!!combatAct(st, { type: "searchBody", unit: me.id, target: live.id }), "nor someone alive");
  // The fallen one of yours: their stripped things are a pile after the win, once.
  for (const e of E(b)) kill(b, e);
  endBattleNow(st, "victory");
  const withGun = b.bodies.filter((x) => allItems(x).includes(theirGun)).length + (hub(st).armory.includes(theirGun) ? 1 : 0);
  check(withGun === 1, `your fallen's gun is in one place after the battle (${withGun})`);
  check(dupesLive(st).length === 0, "no item in two places");
  closeCombat(st);
}

// ---------- 3. the ground ----------
section("3. Put down, picked up, blasts, an enemy takes a gun");
{
  const st = world(seed + 2);
  const { b } = openBattle(st);
  const [a, c] = P(b);
  const sa = survivorById(st, a.sid), sc = survivorById(st, c.sid);
  place(a, 5, 5); place(c, 6, 5);
  const knife = newItem("knife", 1);
  sa.pockets[0] = knife;
  const ap0 = a.ap;
  check(combatAct(st, { type: "drop", unit: a.id, loc: `s:${sa.id}:pocket:0` }) === "", "put an item down (from a pocket)");
  const pile = G.groundAt(b, 5, 5, 0);
  check(!!pile && pile.contents.gear.includes(knife) && sa.pockets[0] === null, "it lies on the survivor's cell");
  check(a.ap === ap0, "putting down is free");
  G.fieldReady(b, st);
  a.haul.sup.food = 6;
  const msg = G.dropAt(st, a.id, `haul:${a.id}:sup:food`, 2);
  check(pile.contents.sup.food === 2 && a.haul.sup.food === 4, `part of a stack put down: 2 of 6 food (${msg})`);
  const api = G.dropToGround(b, a, newItem("crowbar", 1));
  check(api === pile && pile.contents.gear.some((g) => g.key === "crowbar"), "dropToGround (the API) adds to the same pile");
  // Picked up from the next cell.
  const r = G.pickUpFromGround(st, b, c, { x: 5, y: 5 }, knife);
  check(r.got.includes(knife.name) && allCarried(sc).includes(knife) && !pile.contents.gear.includes(knife), `picked up one item from the next cell (${r.msg})`);
  place(c, 9, 9);
  const far = G.pickUpFromGround(st, b, c, pile);
  check(!far.got.length, `not from further off (${far.msg})`);
  place(c, 5, 6);
  check(combatAct(st, { type: "pickUp", unit: c.id, x: 5, y: 5 }) === "" && !G.pileCount(pile), "Pick up: all that fits from the pile");
  // Blasts wear what lies there.
  const bat = newItem("bat", 1);
  G.dropToGround(b, a, bat);
  const q0 = bat.quality ?? 1, d0 = bat.dur;
  groundBlast(b, 5, 5, 2);
  check((bat.quality ?? 1) < q0 || (bat.dur != null && d0 != null && bat.dur < d0), `a blast on the cell wears it (quality ${q0} → ${bat.quality}, dur ${d0} → ${bat.dur})`);
  // An enemy with no gun takes up a rifle.
  const foe = E(b)[0];
  foe.weapon = "fists"; foe.weaponName = "Fists"; foe.arsItem = null; foe.ap = 2;
  place(foe, 12, 12);
  const rifle = lootItem("huntrifle", "raider", st.rng);
  const gp = G.groundPile(b, 12, 13, 0);
  gp.contents.gear.push(rifle);
  check(G.aiGrabGun(b, foe) && foe.weapon === "huntrifle" && foe.arsItem === rifle && !gp.contents.gear.includes(rifle), "an enemy with no gun snatches up the rifle lying next to it (1 action)");
  check(foe.ap === 1, "it took an action");
  kill(b, foe);
  place(a, 12, 11);
  a.ap = 2;
  combatAct(st, { type: "searchBody", unit: a.id, target: foe.id });
  check(G.bodyBoxOf(b, foe).contents.gear.includes(rifle), "shot down, the very rifle is on its body again");
  // A save mid-battle keeps the ground.
  const st2 = deserializeState(serializeState(st));
  const p2 = G.groundAt(st2.combat, 5, 5, 0);
  check(!!p2 && p2.contents.gear.some((g) => g.key === "bat"), "a save mid-battle keeps the things on the ground");
  check(dupesLive(st).length === 0, "no item in two places");
}

// ---------- 4. the end ----------
section("4. The end: a win loots the ground, a retreat leaves it");
{
  const st = world(seed + 3);
  const { b, h } = openBattle(st);
  const [a, c] = P(b);
  const sa = survivorById(st, a.sid);
  const axe = newItem("crowbar", 1);
  G.dropToGround(b, a, axe);
  G.dropToGround(b, a, "scrap", 3);
  // A fallen teammate who carried something loose: it lies where they fell.
  G.fieldReady(b, st);
  const watch = newItem("watch", 1);
  c.haul.gear.push(watch);
  kill(b, c);
  for (const e of E(b)) kill(b, e);
  endBattleNow(st, "victory");
  const ground = b.bodies.filter((x) => x.pile);
  check(ground.some((x) => (x.loose || []).includes(axe) && x.supplies.scrap === 3) || h.armory.includes(axe), "the ground's things are a body of the loot screen after a win (or taken home headless)");
  check(b.bodies.some((x) => allItems(x).includes(watch)) || h.armory.includes(watch), "a fallen teammate's loose finds are there too");
  check(dupesLive(st).length === 0, "no item in two places");
  closeCombat(st);
  check(h.armory.includes(axe), "taken home after the loot screen (headless: take all)");
  // A retreat: left lying (a death site on the tile).
  const st3 = world(seed + 4);
  const r3 = openBattle(st3);
  const b3 = r3.b;
  const [x3] = P(b3);
  const pan = newItem("bat", 1);
  G.dropToGround(b3, x3, pan);
  endBattleNow(st3, "retreat");
  const site = (st3.deathSites || []).find((d) => d.tile === b3.tileId && d.items.some((e) => e.item === pan));
  check(!!site, "after a retreat what lay on the ground stays at a death site there");
  check(!b3.bodies.length, "and is no loot");
  check(dupesLive(st3).length === 0, "no item in two places");
  // A party battle: what is carried loose goes to the team's cargo.
  const st4 = world(seed + 5);
  const h4 = hub(st4);
  const crew = atBase(st4, h4.id).slice(0, 2);
  const tile = st4.tiles.find((t) => t.id !== h4.tile && !t.loc && t.terrain !== "water");
  const res = launchExpedition(st4, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 4, water: 4 } });
  if (check(!res.error, `a team sent out (${res.error || "ok"})`)) {
    const p = res.party;
    st4.combat = createBattle(st4, { tile: tile.id, partyId: p.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 2 }, ambush: null, canRetreat: true, handler: "tactest", context: {} });
    const b4 = st4.combat;
    b4.phase = "player";
    const u4 = P(b4)[0];
    G.fieldReady(b4, st4);
    const lamp = newItem("flashlight", 1);
    u4.haul.gear.push(lamp);
    u4.haul.sup.meds = 2;
    for (const e of E(b4)) kill(b4, e);
    const meds0 = (p.cargo && p.cargo.supplies.meds) || 0;
    endBattleNow(st4, "victory");
    check(p.cargo.gear.includes(lamp) && p.cargo.supplies.meds === meds0 + 2, "a team's survivor brings what they carry loose into the team's cargo");
    check(dupesLive(st4).length === 0, "no item in two places");
  }
}

// ---------- 5. a raid ----------
section("5. A raid: a pile on the ground");
{
  let done = false;
  for (let i = 0; i < 40 && !done; i++) {
    const st = createWorld({ seed: seed * 100 + i, factionCount: 6 });
    st.cards.length = 0; st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["pharmacy", "store", "house", "gas"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 2);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 4, water: 4, meds: 1 } });
    if (res.error) continue;
    res.party.phase = "engaged";
    st.combat = createBattle(st, { mode: "raid", tile: tile.id, partyId: res.party.id, canRetreat: true, ambush: null, handler: "tactest", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 0 }, context: {} });
    const b = st.combat;
    if (b.raid.choose) b.raid.choose = null;
    b.phase = "player";
    const u = P(b)[0], s = survivorById(st, u.sid);
    const boxes0 = b.raid.containers.filter((c) => c.kind !== "body").length;
    s.pockets[1] = newItem("knife", 1);
    check(combatAct(st, { type: "drop", unit: u.id, loc: `s:${s.id}:pocket:1` }) === "", "put down in a raid");
    const pile = G.groundAt(b, u.x, u.y, u.f || 0);
    check(!!pile && b.raid.containers.includes(pile), "the pile is one of the raid's containers");
    check(b.raid.containers.filter((c) => c.kind !== "body" && c.kind !== "ground").length === boxes0, "not a place to search");
    check(G.pickUpFromGround(st, b, u, pile).got.length === 1, "and picked up again");
    done = true;
  }
  check(done, "a raid map was made");
}

console.log(`\n${fail ? "failed" : "passed"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
