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
import * as C from "../src/sim/combat.js";
import { calOf } from "../src/sim/ammo.js";
import { keyFor } from "../src/sim/rounds.js";
import { surrender } from "../src/sim/nonlethal.js";
import { stirBodies } from "../src/sim/carriers.js";
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
  C.loadMag(foe, 3);
  const foeMag = C.magIn(foe);
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
  const gl = gun.loaded ? gun.loaded.n : -1;
  check(gl === foeMag, `the rounds left in its gun are kept on the gun (${gl} of the ${foeMag} it had)`);
  s.gear.weapon = null;
  const gi = box.contents.gear.indexOf(gun);
  const msg = RL.raidMove(st, me.id, `rbox:${box.id}:gear:${gi}`, `s:${s.id}:weapon`);
  check(s.gear.weapon === gun && !box.contents.gear.includes(gun), `the hunting rifle into the survivor's hands (${msg})`);
  check(me.weapon === "huntrifle", `and fought with at once (unit weapon ${me.weapon})`);
  check(C.magIn(me) === foeMag && !gun.loaded, `with exactly the rounds that were in it (${C.magIn(me)}), no free full magazine`);
  const k0 = roundKeys[0], n0 = box.contents.sup[k0];
  RL.raidMove(st, me.id, `rbox:${box.id}:sup:${k0}`, `haul:${me.id}:list`);
  // Physical rounds (mags.js, 2026-10-18): the rounds that were in the gun stay in it (the gun's stack), not the haul.
  check((me.haul.sup[k0] || 0) === n0 && !(box.contents.sup[k0] >= 1) && C.magIn(me) === gl, `${n0} ${k0} carried loose (and the ${gl} that were in the gun still in it)`);
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
  a.haul.sup.f_beans = 6; // food by type (sim/foods.js): six cans of beans
  const msg = G.dropAt(st, a.id, `haul:${a.id}:sup:f_beans`, 2);
  check(pile.contents.sup.f_beans === 2 && a.haul.sup.f_beans === 4, `part of a stack put down: 2 of 6 cans of beans (${msg})`);
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
    check(p.cargo.gear.includes(lamp) && p.cargo.supplies.meds >= meds0 + 2, "a team's survivor brings what they carry loose into the team's cargo");
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
    const boxes0 = b.raid.containers.filter((c) => c.kind !== "body" && c.kind !== "ground").length; // the loads set down coming in are ground piles too (carry.js stageLoads)
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

// ---------- 6. the downed searched alive ----------
section("6. The enemy's downed searched alive");
{
  const st = world(seed + 6);
  const { b, h } = openBattle(st);
  const me = P(b)[0];
  const [ko, other] = E(b);
  ko.kit = "raiders"; ko.weapon = "huntrifle"; ko.weaponName = WEAPONS.huntrifle.name; C.loadMag(ko, 2);
  ko.down = true; ko.ko = true; ko.hp = 1;
  place(ko, 3, 2); place(me, 2, 2);
  check(G.bodiesNear(b, me).includes(ko) && !G.bodyRefusal(b, ko), "someone knocked out can be searched");
  const ap0 = me.ap;
  check(combatAct(st, { type: "searchBody", unit: me.id, target: ko.id }) === "" && me.ap === ap0 - 1, "the first search costs 1 action, as a body's");
  const box = G.bodyBoxOf(b, ko);
  const kgun = box && box.contents.gear.find((it) => it.key === "huntrifle");
  check(!!kgun && kgun.loaded && kgun.loaded.n === 2, `their gun is in it, with the 2 rounds that were in it (${kgun && kgun.loaded ? kgun.loaded.n : "none"})`);
  check(ko.weapon === "fists" && !ko.armorKey, "they are left with nothing in their hands (if they get up they fight bare-handed)");
  const mate = P(b)[1];
  mate.down = true;
  check(!!G.bodyRefusal(b, mate), "one of yours who is down is not searched this way");
  mate.down = false;
  // Take the gun, leave the rest; tie them up; win: one entry for them, their leftovers, no second roll.
  const left = box.contents.gear.filter((it) => it !== kgun);
  RL.raidMove(st, me.id, `rbox:${box.id}:gear:${box.contents.gear.indexOf(kgun)}`, `haul:${me.id}:list`);
  ko.tied = true;
  for (const e of E(b)) if (e !== ko) kill(b, e);
  void other;
  endBattleNow(st, "victory");
  const theirs = b.bodies.filter((x) => x.uid === ko.id || String(x.name).startsWith(ko.name));
  const leftOk = left.every((it) => h.armory.includes(it) || theirs.some((x) => allItems(x).includes(it)));
  check(theirs.length <= 1 && (!theirs.length || (/prisoner/.test(theirs[0].name) && theirs[0].pile)) && leftOk, `a prisoner keeps what you left on them: one entry, not rolled again (${theirs.map((x) => x.name).join(", ") || "taken home headless"})`);
  check(!b.bodies.some((x) => allItems(x).includes(kgun)), "the gun taken is on no body");
  check(b.result.prisoners.length >= 1, `they are taken prisoner as before (${b.result.prisoners.length})`);
  check(dupesLive(st).length === 0, "no item in two places");
  // A raid: the downed searched there; killed after, no second body.
  let done = false;
  for (let i = 0; i < 40 && !done; i++) {
    const rs = createWorld({ seed: seed * 100 + 50 + i, factionCount: 6 });
    rs.cards.length = 0; rs.crashNext = 1e9;
    const rh = hub(rs);
    const tile = rs.tiles.find((t) => t.loc && t.id !== rh.tile && ["pharmacy", "store", "house", "gas"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(rs, rh.id).slice(0, 2);
    const res = launchExpedition(rs, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 4, water: 4 } });
    if (res.error) continue;
    res.party.phase = "engaged";
    rs.combat = createBattle(rs, { mode: "raid", tile: tile.id, partyId: res.party.id, canRetreat: true, ambush: null, handler: "tactest", enemy: { kind: "raiders", count: 2, power: 2 }, raid: { heat0: 0 }, context: {} });
    const rb = rs.combat;
    if (rb.raid.choose) rb.raid.choose = null;
    rb.phase = "player";
    const ru = P(rb)[0], guard = enemyUnit(rb, rs.rng, "raiders", 2, 1);
    rb.units.push(guard);
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [ru.x + dx, ru.y + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < rb.w && y < rb.h && C.CELL[rb.cells[y * rb.w + x].k].walk && !C.unitAt(rb, x, y));
    if (!spot) continue;
    const [nx, ny] = spot;
    guard.down = true; guard.ko = true; guard.x = nx; guard.y = ny; guard.f = ru.f || 0;
    check(combatAct(rs, { type: "searchBody", unit: ru.id, target: guard.id }) === "" && !!G.bodyBoxOf(rb, guard), "in a raid the downed are searched the same way");
    const n0 = rb.raid.containers.length;
    guard.ko = false;
    C.damage(rb, guard, 999, ru);
    check(guard.dead && rb.raid.containers.filter((c) => c.kind === "body" && c.uid === guard.id).length === 1 && rb.raid.containers.length === n0, `killed after, they are one body: the one searched (no second roll) (${rb.raid.containers.length - n0} new)`);
    done = true;
  }
  check(done, "a raid with a guard was made");
}

// ---------- 7. fire on the ground ----------
section("7. Fire on what lies on the ground");
{
  const st = world(seed + 7);
  const { b } = openBattle(st);
  const a = P(b)[0];
  place(a, 6, 6);
  const book = newItem("survivalbook", 1), knife = newItem("knife", 1), pack = newItem("backpack", 1);
  for (const it of [book, knife, pack]) G.dropToGround(b, a, it);
  G.dropToGround(b, a, "food", 4); G.dropToGround(b, a, "scrap", 2); G.dropToGround(b, a, "a_9mm_fmj", 30);
  const pile = G.groundAt(b, 6, 6, 0);
  place(a, 9, 9);
  const d0 = knife.dur;
  b.fires = [{ x: 6, y: 6, turns: 3 }];
  stirBodies(st, b); // the start of a turn: bodies and piles in the flames burn (carriers.js)
  check(!pile.contents.gear.includes(book) && !pile.contents.gear.includes(pack), "a book and a pack burn");
  check(pile.contents.gear.includes(knife) && (d0 == null || knife.dur < d0), `a knife is left, worn by the heat (${d0} → ${knife.dur})`);
  check(!(pile.contents.sup.food > 0) && pile.contents.sup.scrap === 2, "the food burns, the scrap does not");
  check((pile.contents.sup.a_9mm_fmj || 0) <= 30, `loose rounds may cook off (${pile.contents.sup.a_9mm_fmj || 0} of 30 left)`);
  const d1 = knife.dur;
  G.groundFire(b);
  check(knife.dur === d1, "once a turn, not twice");
  // A raid's pile burns too.
  const rp = { ...b, raid: { containers: [{ id: 1, kind: "ground", drop: true, x: 2, y: 2, f: 0, contents: { sup: {}, gear: [newItem("survivalbook", 1)] } }], found: {}, foundGear: [] }, fires: [{ x: 2, y: 2 }], turn: 5, floor: 0 };
  G.groundFire(rp);
  check(!rp.raid.containers[0].contents.gear.length, "in a raid as well");
}

// ---------- 7b. explosives in a fire go off ----------
section("7b. Grenades in a fire go off (the user's call)");
{
  const st = world(seed + 17);
  const { b } = openBattle(st);
  const [a, c] = P(b);
  place(a, 6, 6);
  const frag = newItem("frag", 1);
  G.dropToGround(b, a, frag);
  const pile = G.groundAt(b, 6, 6, 0);
  place(a, 12, 12); place(c, 7, 6); c.hp = 100; c.down = false; // right next to the pile
  const hp0 = c.hp, log0 = b.log.length;
  b.fires = [{ x: 6, y: 6, turns: 3 }];
  stirBodies(st, b); // the start of a turn: the piles in the flames burn, what is in them goes off
  check(!pile.contents.gear.includes(frag), "the frag grenade is gone from the burning pile");
  check(c.hp < hp0 || c.down || c.dead, `it goes off and hurts the one next to it (${hp0} → ${c.hp}${c.down ? ", down" : ""})`);
  check(b.log.slice(log0).some((l) => /sets off the frag grenade in the burning pile/.test(l.text)), "with a log line");
  check(b.fx.some((f) => f.type === "cookoff" && f.item === "frag"), "and an effect on the map (heard as the blast)");
  // Several: a bag of them set down in the fire, a box of 40 mm, a rocket; an enemy's body with grenades on it.
  place(c, 15, 15);
  const bag = newItem("backpack", 1);
  const inBag = ["frag", "pipebomb", "molotov", "smokegren", "flashbang", "flare"].map((k) => newItem(k, 1));
  bag.contents = inBag.slice();
  place(a, 8, 9);
  G.dropToGround(b, a, bag); G.dropToGround(b, a, "a_40mm_he", 3); G.dropToGround(b, a, "a_rocket_heat", 1); G.dropToGround(b, a, newItem("frag", 1));
  const pile2 = G.groundAt(b, 8, 9, 0);
  const foe = E(b)[0];
  foe.dead = true; foe.hp = 0; foe.down = false; place(foe, 4, 12); foe.throwables = { frag: 2, smokegren: 1 };
  place(a, 18, 2);
  b.fires.push({ x: 8, y: 9, turns: 3 }, { x: 4, y: 12, turns: 3 });
  b.turn = (b.turn || 0) + 1;
  let crash = "";
  try { for (let i = 0; i < 12; i++) { stirBodies(st, b); b.turn++; } } catch (e) { crash = e.stack || String(e); }
  check(!crash, `no crash with several going off in turn${crash ? `: ${crash}` : ""}`);
  const lines = b.log.map((l) => l.text).filter((t) => /The fire sets off/.test(t));
  check(!(b.fireCook && b.fireCook.length), `they all went off over the turns (${lines.length} cook-offs)`);
  check(!pile2.contents.gear.some((it) => it.key === "frag") && !inBag.some((it) => bag.contents.includes(it)) && !(pile2.contents.sup.a_40mm_he > 0) && !(pile2.contents.sup.a_rocket_heat > 0), "nothing explosive is left in the pile or the bag");
  check(lines.some((t) => /40 mm grenade/.test(t)) && lines.some((t) => /rocket/.test(t)), "the 40 mm grenades and the rocket blast too");
  check((b.smoke || []).length > 0 && (b.flares || []).length > 0, "the smoke grenade smokes, the flare lights up");
  check(lines.some((t) => /molotov/i.test(t)) && b.fires.length > 2, "the Molotov goes up (a fire of its own)");
  check(lines.some((t) => new RegExp(`on ${foe.name}'s burning body`).test(t)) && !foe.throwables.frag, "the grenades on a burning enemy body go off as well (AI parity)");
  check(b.log.map((l) => l.text).filter((t) => /The fire sets off/.test(t)).length >= 10, "one log line each");
}

// ---------- 8. the rounds in the guns ----------
section("8. The rounds in a gun go with it");
{
  const st = world(seed + 8);
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 3);
  const [s0, s1] = people;
  s0.gear.weapon = newItem("pistol", 1); s0.pockets[0] = newItem("revolver", 1);
  s1.gear.weapon = newItem("pistol", 1);
  h.stock.a_9mm_fmj = 200; h.stock.a_357_fmj = 50;
  const { b } = openBattle(st);
  const u0 = P(b).find((u) => u.sid === s0.id), u1 = P(b).find((u) => u.sid === s1.id);
  check(P(b).every((u) => !C.hasMag(u) || C.magIn(u) === C.magCap(u)) && E(b).every((e) => !C.hasMag(e) || C.magIn(e) === C.magCap(e)), "every gun in hand starts the fight loaded (both sides)");
  check(u0.startGuns.includes(s0.pockets[0]), "a gun carried in a pocket is one of the guns that start loaded");
  G.fieldReady(b, st);
  place(u0, 5, 5); place(u1, 6, 5);
  const key = keyFor(calOf("pistol"), u0.load);
  const pool = () => b.pools.reduce((a, p) => a + Math.max(0, Math.floor(p[key] || 0)), 0);
  C.loadMag(u0, 5);
  const p0 = pool(), pistol = s0.gear.weapon;
  combatAct(st, { type: "drop", unit: u0.id, loc: `s:${s0.id}:weapon` });
  // Physical rounds (mags.js, 2026-10-18): the rounds in a gun left the team's bags when it was filled at the fight's
  // start, so a gun put down or taken up keeps its own and the bags stay as they are.
  check(pistol.loaded && pistol.loaded.n === 5 && pool() === p0, `a gun put down keeps the 5 rounds that were in it, the team's bags untouched (${pistol.loaded ? pistol.loaded.n : "none"}; ${p0} → ${pool()})`);
  // u1 puts its own pistol in a pocket, then takes this one up.
  RL.raidMove(st, u1.id, `s:${s1.id}:weapon`, `s:${s1.id}:pocket:${s1.pockets.indexOf(null)}`);
  const pile = G.groundAt(b, 5, 5, 0);
  const p1 = pool();
  RL.raidMove(st, u1.id, `rbox:${pile.id}:gear:${pile.contents.gear.indexOf(pistol)}`, `s:${s1.id}:weapon`);
  check(s1.gear.weapon === pistol && C.magIn(u1) === 5 && !pistol.loaded && pool() === p1, `taken up by a teammate: exactly those 5 rounds (${C.magIn(u1)}), the team's bags untouched (${p1} → ${pool()})`);
  // A pocket gun carried into the fight, dropped unfired: it goes out loaded.
  const rev = s0.pockets[0];
  const rkey = keyFor(calOf("revolver"), null);
  const rp0 = b.pools.reduce((a, p) => a + Math.floor(p[rkey] || 0), 0);
  G.dropAt(st, u0.id, `s:${s0.id}:pocket:0`);
  const cap = C.magCap({ weapon: "revolver", item: rev });
  check(rev.loaded && rev.loaded.n === Math.min(cap, rp0), `a revolver carried into the fight and put down unfired is loaded (${rev.loaded ? rev.loaded.n : "none"} of ${cap})`);
  // A gun from nowhere (found) is empty when taken up; an enemy takes up a loaded one with what is in it.
  const found = newItem("pistol", 1);
  G.dropToGround(b, u0, found);
  const gp = G.groundAt(b, 5, 5, 0);
  RL.raidMove(st, u0.id, `rbox:${gp.id}:gear:${gp.contents.gear.indexOf(found)}`, `s:${s0.id}:weapon`);
  check(s0.gear.weapon === found && C.magIn(u0) === 0, `a gun found lying about is taken up empty (Reload) (${C.magIn(u0)})`);
  const foe = E(b)[0];
  foe.weapon = "fists"; foe.weaponName = "Fists"; foe.arsItem = null; foe.ap = 2; place(foe, 12, 12);
  const g2 = newItem("pistol", 1); g2.loaded = { n: 2, key };
  G.groundPile(b, 12, 13, 0).contents.gear.push(g2);
  G.aiGrabGun(b, foe);
  check(foe.weapon === "pistol" && C.magIn(foe) === 2 && !g2.loaded, `an enemy taking up a gun has what was in it (${C.magIn(foe)})`);
  // Surrender: the gun thrown down keeps its rounds.
  const foe2 = E(b)[1];
  foe2.weapon = "huntrifle"; foe2.weaponName = WEAPONS.huntrifle.name; foe2.arsItem = null; C.loadMag(foe2, 1);
  surrender(b, foe2);
  check((b.nlDrops || []).some((d) => d.uid === foe2.id && d.loaded && d.loaded.n === 1), "one who gives up throws down a gun with what was in it");
  // The end: the guns that came home with rounds in them are unloaded into the stores.
  const kept = newItem("pistol", 1); kept.loaded = { n: 4, key };
  s1.pockets[s1.pockets.indexOf(null)] = kept;
  for (const e of E(b)) if (!e.dead) { if (e.surr) e.tied = true; else kill(b, e); }
  const stock0 = h.stock[key] || 0;
  endBattleNow(st, "victory");
  check(!kept.loaded && (h.stock[key] || 0) >= stock0 + 4, `a gun with rounds in it coming home is unloaded into the stores (${stock0} → ${h.stock[key] || 0})`);
  const onBody = b.bodies.flatMap((x) => allItems(x)).find((it) => it.key === "huntrifle" && it.loaded && it.loaded.n === 1);
  const home = h.armory.find((it) => it.key === "huntrifle" && !it.loaded);
  check(!!onBody || !!home, `the gun thrown down is loot after the win with its round in it (headless: taken home, the round into the stores)`);
  check(dupesLive(st).length === 0, "no item in two places");
  closeCombat(st); // headless: everything taken (the loot screen's taken: its rounds into the stores)
  const anyLoaded = h.armory.filter((it) => it.loaded).length;
  check(anyLoaded === 0, `nothing taken home still holds rounds of its own (${anyLoaded})`);
}

console.log(`\n${fail ? "failed" : "passed"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
