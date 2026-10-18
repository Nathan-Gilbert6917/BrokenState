// Loose rounds on people at team setup and transfers, and moving kit in a fight for an action (2026-10-17 user
// requests; sim/supitems.js roundsOnto / roundRoom / parseTarget, sim/teaminv.js loadFromBase / dropRounds,
// sim/teammeet.js giveGoods, sim/teamform.js formTeam opts.rounds, sim/combat.js combatAct "inv" / refitKit):
//   - a pick of a round key with a person target { sid, where: pocket | pack | rig, loose } at Load, at team form and
//     at Give goods becomes boxed or loose items on that member (counts conserved against the stores, the stacks' room,
//     an admin pouch's weight, the rig's pocket pouches, the person's max load, refusals that say why; another supply
//     goes onto them the same way where it fits: tools/supplyplacestest.js has the rest of that);
//   - the person's rounds go back: Drop off and the stores (settleBase), dropRounds; settleParty and unpackPerson never
//     strip them off a person;
//   - in a fight the acting unit's own kit moves for 1 action (pocket, pack, rig pouch, hands): the caches refit
//     (u.boxes, u.handBoxes, each magazine's place with the rounds on the item, a gun swapped into the hands); refused
//     at 0 AP, on the enemy's turn, for armour and the pack, for someone else's kit; split / open / box cost the same; a
//     save and load in the middle keeps it all;
//   - the rounds are PHYSICAL in a fight (2026-10-18 user rules, sim/mags.js header, roundstack.js): the fight's start
//     fills the gun and the spares out of the person's own rounds (a pocket handful of 80: 15 into the gun, 15 into each
//     spare, 35 left), each spare magazine item carries its stack (item.stack: the entries are rebuilt after every move
//     or load, so an entry captured before is stale: re-find it with magEntryAt); a gun taken up out of the pack is
//     loaded out of what they carry; one put down keeps its rounds on it (gunload.js);
//   - rounds dropped onto a spare magazine of the gun load it (sim/mags.js loadMagPlan / loadMagFrom, magEntryAt): up
//     to 6 a time, boxed or loose, 1 action with the rounds in a pocket or a rig pouch, both from the pack, the rounds
//     leaving the stack as they go in (an emptied stack is thrown away); another type goes on top of what is there (an
//     assortment, the top is the magazine's load); refused with one action left from the pack, for another gun's
//     magazine, for a full one; the badge on the magazine (gunrounds.js) reads its stack; a Reload's swap is physical
//     (the fresh magazine is the gun's fitted one, the one out of the gun lies where the fresh one came from).
// Usage: node tools/invfighttest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { launchExpedition, planPath, partyMembers } from "../src/sim/parties.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import { AMMO_STACK } from "../src/sim/data-stacks.js";
import { ADMIN_KG } from "../src/sim/data-kit.js";
import { newItem, stripAll, packOf, rigPouches, ensureInv, itemAt, fitReason, itemLoad } from "../src/sim/inventory.js";
import { wornLoad, maxLoad } from "../src/sim/load.js";
import { isRoundItem, amountOf, boxSize, roundItem } from "../src/sim/itemstack.js";
import { roundRoom, roundsOnto, roundsHeld, parseTarget, placeReason, unpackPerson } from "../src/sim/supitems.js";
import { loadFromBase, dropOff, dropRounds, teamHoldings } from "../src/sim/teaminv.js";
import { giveGoods } from "../src/sim/teammeet.js";
import { formTeam, formPreview } from "../src/sim/teamform.js";
import { settleBase, settleParty, setRounds, giveRounds } from "../src/sim/ammo.js";
import { createBattle, combatAct, registerCombatHandler, INV_AP, refitKit, loadMag } from "../src/sim/combat.js";
import { MAGS, LOAD_AP, magEntryAt, loadedIn, loadMagPlan, fittedMag } from "../src/sim/mags.js";
import { gunRounds } from "../src/sim/gunrounds.js";
import { carriedSpots } from "../src/sim/inventory.js";
import { starterMags } from "../src/sim/carrykit.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { stackN, stackText } from "../src/sim/roundstack.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const K = "a_9mm_fmj";
const BOX = boxSize(K); // 50
const LOOSE_POUCH = Math.floor((ADMIN_KG + 1e-9) / itemLoad(roundItem(K, 1, true))); // loose rounds an admin pouch takes
registerCombatHandler("invfighttest", () => {});

// ---------- a world with a team of `n` stood on the hub's tile (as tools/teaminvtest.js) ----------
function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { water: 300, meds: 20, [K]: 400 });
  return state;
}
function tileNear(state, from, d, d2) {
  for (const t of state.tiles) {
    const dist = state.grid.distance(from, t.id);
    if (dist < d || dist > d2 || t.terrain === "water" || state.bases.some((b) => b.tile === t.id)) continue;
    if (planPath(state, from, t.id, false)) return t.id;
  }
  return null;
}
function team(state, n, skip = 0) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(skip, skip + n);
  for (const s of crew) { s.traits = []; stripAll(s); ensureInv(s); }
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: tileNear(state, h.tile, 2, 3), mission: "move", stance: "normal", supplies: { food: 2, water: 2 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [h.tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = [];
  return p;
}
const held = (s, where, loose) => roundsHeld(s, K, where, loose);
const onPerson = (s) => ["pocket", "pack", "rig"].reduce((a, w) => a + held(s, w, true) + held(s, w, false), 0);
// The heaviest thing that goes in a pack (to load someone to their limit).
const heavy = () => Object.entries(GEAR).filter(([, d]) => Number.isFinite(d.weight) && !d.bulky && !d.slots && !d.pouches && d.slot !== "backpack" && !d.count).sort((a, b) => b[1].weight - a[1].weight)[0][0];

// ---------------------------------------------------------------------------------------------------------
section("Load from a base: rounds onto a member, boxed or loose, in pockets, pack or rig");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2);
  const [s0, s1] = partyMembers(state, p);
  s0.gear.backpack = newItem("backpack");
  s0.gear.rig = newItem("chestrig");
  const stock0 = h.stock[K];
  check(parseTarget({ sid: s0.id, where: "pack", loose: true }).where === "pack" && parseTarget(s0.id).where === null && parseTarget("cargo") === null, "parseTarget: a person target with a place, a bare id (the usual way), the cargo");
  let r = loadFromBase(state, p, { supplies: { [K]: 120 } }, { sid: s0.id, where: "pocket", loose: true });
  check(r.moved.length === 1 && /120 /.test(r.moved[0]) && /pockets, loose/.test(r.moved[0]), `120 loose rounds onto the pockets (${r.text})`);
  check(held(s0, "pocket", true) === 120 && h.stock[K] === stock0 - 120 && !(p.supplies[K] > 0), "they are items in the pockets, out of the stores, not in the team's pool");
  check(s0.pockets.filter((it) => it && isRoundItem(it)).map((it) => amountOf(it)).sort((a, b) => b - a).join(",") === `${AMMO_STACK.LOOSE},40`, `two loose stacks: ${AMMO_STACK.LOOSE} and 40 (a slot holds ${AMMO_STACK.LOOSE} loose)`);
  r = loadFromBase(state, p, { supplies: { [K]: 100 } }, { sid: s0.id, where: "pack", loose: false });
  const boxed = packOf(s0).find((it) => it && isRoundItem(it));
  check(r.moved.length === 1 && boxed && !boxed.loose && amountOf(boxed) === 100 && h.stock[K] === stock0 - 220, `100 boxed rounds into the pack as one stack of ${100 / BOX} boxes (${r.text})`);
  r = loadFromBase(state, p, { supplies: { [K]: 100 } }, { sid: s0.id, where: "rig", loose: true });
  const kinds = GEAR.chestrig.pouches;
  const pouches = (rigPouches(s0) || []).map((it, i) => ({ it, kind: kinds[i] })).filter((x) => x.it && isRoundItem(x.it));
  check(pouches.length === 3 && pouches.filter((x) => x.kind === "admin").every((x) => x.it.loose && amountOf(x.it) === LOOSE_POUCH) && held(s0, "rig", true) === 100, `the rig's two admin pouches take ${LOOSE_POUCH} loose rounds each (${ADMIN_KG} kg a pouch), the rest goes in one of its pockets`);
  check(pouches.filter((x) => x.kind === "pocket").length === 1 && amountOf(pouches.find((x) => x.kind === "pocket").it) === 100 - 2 * LOOSE_POUCH && !r.refused.length, `the pocket pouch: ${100 - 2 * LOOSE_POUCH}, nothing refused (${r.text})`);
  check(h.stock[K] + onPerson(s0) === stock0, "counts conserved: the stores and the person add up");
  r = loadFromBase(state, p, { supplies: { [K]: 300 } }, { sid: s0.id, where: "pocket", loose: true });
  const left = stock0 - 320;
  check(!(h.stock[K] > 0) && held(s0, "pocket", true) === 120 + left, `onto the stacks first, then free pockets, up to what the stores have (${left})`);
  // Refusals: no such place, no room, over the max load; other supplies still go to the pool.
  h.stock[K] = 200;
  r = loadFromBase(state, p, { supplies: { [K]: 10 } }, { sid: s1.id, where: "pack", loose: false });
  check(!r.moved.length && /wears no pack/.test(r.text), `no pack: refused (${r.text})`);
  r = loadFromBase(state, p, { supplies: { [K]: 10 } }, { sid: s1.id, where: "rig", loose: false });
  check(!r.moved.length && /wears no rig/.test(r.text), `no rig: refused (${r.text})`);
  check(/pockets, the pack or a rig/.test(placeReason(s1, "hands")), "an unknown place is refused");
  for (let i = 0; i < 4; i++) s1.pockets[i] = newItem("knife");
  r = loadFromBase(state, p, { supplies: { [K]: 10 } }, { sid: s1.id, where: "pocket", loose: true });
  check(!r.moved.length && /No room in .*pockets/.test(r.text), `pockets full of other things: refused (${r.text})`);
  s1.pockets = s1.pockets.map(() => null);
  s1.gear.backpack = newItem("backpack");
  const hk = heavy();
  for (let i = 0; i < packOf(s1).length && wornLoad(s1) < maxLoad(s1); i++) packOf(s1)[i] = newItem(hk);
  if (wornLoad(s1) < maxLoad(s1)) s1.gear.carry = Object.assign(newItem("backpack"), { contents: Array.from({ length: 8 }, () => newItem(hk)) });
  check(wornLoad(s1) >= maxLoad(s1), `${s1.name.split(" ")[0]} is loaded to the limit (${Math.round(wornLoad(s1))} of ${maxLoad(s1)} kg)`);
  r = loadFromBase(state, p, { supplies: { [K]: 10 } }, { sid: s1.id, where: "pocket", loose: true });
  check(!r.moved.length && /Too heavy/.test(r.text) && h.stock[K] === 200, `over their max load: refused, nothing taken (${r.text})`);
  const water0 = p.supplies.water || 0;
  r = loadFromBase(state, p, { supplies: { water: 3 } }, { sid: s0.id, where: "pack", loose: true });
  check(r.moved.length === 1 && roundsHeld(s0, "water", "pack") === 3 && (p.supplies.water || 0) === water0, `a supply that is not rounds goes onto them the same way, as items in the place picked (${r.text})`);
  r = loadFromBase(state, p, { supplies: { water: 1 } }, { sid: s0.id, where: "pocket", loose: true });
  check(!r.moved.length && /too big for a pocket/.test(r.text) && roundsHeld(s0, "water", "pack") === 3, `where it does not fit it is refused with why (${r.text})`);
  r = loadFromBase(state, p, { supplies: { food: 1 } }, { sid: s0.id, where: "pack", loose: true });
  check(r.moved.length === 1 && !r.refused.length, `"food" (days of it) has no item form: it still goes into the team's pool (${r.text})`);
  // The team's carry limit: what they wear comes off what the team can carry.
  const H = teamHoldings(state, p);
  check(H.load <= H.cap + 1e-6, `the team still carries its load (${Math.round(H.load)} of ${Math.round(H.cap)} kg)`);
}

section("Back home: the person's rounds into the stores; nothing strips them off a person");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 1);
  const [s0] = partyMembers(state, p);
  s0.gear.backpack = newItem("backpack");
  loadFromBase(state, p, { supplies: { [K]: 90 } }, { sid: s0.id, where: "pocket", loose: true });
  loadFromBase(state, p, { supplies: { [K]: 100 } }, { sid: s0.id, where: "pack", loose: false });
  check(h.stock[K] === 210 && onPerson(s0) === 190, "90 loose in the pockets, 100 boxed in the pack");
  settleParty(state, p);
  unpackPerson(state, s0, h);
  check(onPerson(s0) === 190 && h.stock[K] === 210, "settleParty and unpackPerson leave the rounds on them");
  const loc = `s:${s0.id}:pocket:${s0.pockets.findIndex((it) => it && isRoundItem(it) && amountOf(it) === AMMO_STACK.LOOSE)}`;
  let r = dropOff(state, p, { items: [loc] });
  check(r.moved.length === 1 && h.armory.some((it) => isRoundItem(it) && it.loose && amountOf(it) === AMMO_STACK.LOOSE), `Drop off: the loose stack into the armory (${r.text})`);
  settleBase(state, h);
  check(h.stock[K] === 210 + AMMO_STACK.LOOSE && !h.armory.some((it) => isRoundItem(it)), "the stores take loose rounds as they take boxes (settleBase)");
  r = dropRounds(state, p, { sid: s0.id, key: K, n: 30, where: "pack", loose: false });
  check(r.moved.length === 1 && held(s0, "pack", false) === 70 && h.stock[K] === 210 + AMMO_STACK.LOOSE + 30, `dropRounds: 30 of the boxed rounds back into the stores, 70 stay (${r.text})`);
  r = dropRounds(state, p, { sid: s0.id, key: K, n: 100, where: "pack", loose: false });
  check(held(s0, "pack", false) === 0 && h.stock[K] === 210 + AMMO_STACK.LOOSE + 100, "the whole stack when asked for more than there is");
  r = dropRounds(state, p, { sid: s0.id, key: K, n: 5, where: "rig", loose: true });
  check(!r.moved.length && r.refused.length === 1, `nothing of that there: refused (${r.text})`);
  check(h.stock[K] + onPerson(s0) === 400, "counts conserved all the way back");
}

section("Forming a team: rounds onto a member from the window's picks");
{
  const state = mk();
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, 2);
  for (const s of crew) { s.traits = []; stripAll(s); ensureInv(s); }
  crew[0].gear.backpack = newItem("backpack");
  const base = { baseId: h.id, memberIds: crew.map((s) => s.id), supplies: { water: 2 } };
  let pre = formPreview(state, { ...base, rounds: [{ key: K, n: 60, sid: crew[1].id, where: "pack", loose: false }] });
  check(/wears no pack/.test(pre.problem), `the preview refuses a place they do not have (${pre.problem})`);
  pre = formPreview(state, { ...base, rounds: [{ key: K, n: 500, sid: crew[0].id, where: "pack", loose: false }] });
  check(/Not enough/.test(pre.problem), `and more than the stores hold (${pre.problem})`);
  pre = formPreview(state, { ...base, rounds: [{ key: K, n: 60, sid: crew[0].id, where: "pack", loose: false }, { key: K, n: 30, sid: crew[1].id, where: "pocket", loose: true }] });
  check(pre.problem === "" && pre.rounds.length === 2, `two picks, no problem (${pre.problem})`);
  const stock0 = h.stock[K];
  const r = formTeam(state, { ...base, rounds: pre.rounds });
  check(!r.error && r.party, `the team forms (${r.error || "ok"})`);
  check(held(crew[0], "pack", false) === 60 && held(crew[1], "pocket", true) === 30 && h.stock[K] === stock0 - 90, "60 boxed in the one's pack, 30 loose in the other's pockets, out of the stores");
  check(!(r.party.supplies[K] > 0), "none of them in the team's pool");
}

section("Teams together: rounds onto a member of the other team");
{
  const state = mk();
  const A = team(state, 1, 0), B = team(state, 1, 1);
  const [b0] = partyMembers(state, B);
  b0.gear.backpack = newItem("backpack");
  A.supplies[K] = 110;
  A.cargo.supplies[K] = 30;
  let r = giveGoods(state, A, B, { supplies: { [K]: 90 } }, { sid: b0.id, where: "pack", loose: true });
  check(r.moved.length === 1 && held(b0, "pack", true) === 90 && !(B.supplies[K] > 0) && !(B.cargo.supplies[K] > 0), `90 loose rounds into their pack, not the other team's pool (${r.text})`);
  check(A.cargo.supplies[K] === undefined && A.supplies[K] === 50, "the found cargo's first, then the packed supplies (30 + 60)");
  r = giveGoods(state, A, B, { supplies: { [K]: 50 } }, { sid: b0.id, where: "rig", loose: false });
  check(!r.moved.length && /wears no rig/.test(r.text) && A.supplies[K] === 50, `no rig: refused, nothing moves (${r.text})`);
  r = giveGoods(state, A, B, { supplies: { [K]: 50 } }, b0.id);
  check(r.moved.length === 1 && B.supplies[K] === 50 && A.supplies[K] === 0, "a bare member target: supplies go as they were (the pool), as before");
}

// ---------------------------------------------------------------------------------------------------------
// A fight (as tools/magtest.js): a field map at the hub, the enemy parked off the map.
function fighter(state, weapon = "pistol") {
  const s = makeSurvivor(state);
  s.skills.shooting = 9;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool", "rig", "backpack", "carry"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  if (s.gear.weapon) starterMags(s); // carrykit.js: two spare magazines in the pockets
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew) {
  const h = hub(state);
  setRounds(h.stock, 0);
  for (const s of crew) giveRounds(h.stock, 200, [s.gear.weapon && s.gear.weapon.key].filter(Boolean));
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "invfighttest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  // The enemy alive but inert in the far corner (dead, the first act would end the fight: checkEnd), your people near the origin.
  for (const u of b.units) if (u.side === "enemy") { u.aware = false; u.x = b.w - 1; u.y = b.h - 1; u.dead = false; }
  b.units.filter((u) => u.side === "player").forEach((u, i) => { u.x = 1 + i; u.y = 1; });
  return b;
}
const unitOf = (b, s) => b.units.find((u) => u.sid === s.id);
const L = (s, slot, i = null) => `s:${s.id}:${slot}${i == null ? "" : `:${i}`}`;

section("In a fight: a move between pockets, pack and rig costs 1 action and refits the unit");
{
  const st = createWorld({ seed: SEED + 7, factionCount: 4 });
  const a = fighter(st, "pistol");
  const mate = fighter(st, "pistol");
  a.gear.backpack = newItem("backpack");
  a.gear.rig = newItem("chestrig");
  a.gear.armor = newItem("plate");
  a.pockets[2] = roundItem(K, 80, true); // a loose handful: a box at hand (mags.js fitHandBoxes counts it); the fight's start fills the gun and the spares out of it
  packOf(a)[5] = roundItem(K, 100, false);
  const b = openBattle(st, [a, mate]);
  const u = unitOf(b, a), m = unitOf(b, mate);
  u.ap = 2; m.ap = 2;
  const mags0 = u.mags.length;
  check(INV_AP === 1 && u.boxes.includes(a.pockets[2]) && u.handBoxes === 1 && mags0 === 3, `the unit takes the field with the pocket's rounds at hand (handBoxes ${u.handBoxes}) and ${mags0} magazines (the gun's and two spares)`);
  check(u.mag === 15 && stackN(u.stack) === 15 && u.mags.filter((x) => x.where !== "gun").every((x) => x.n === 15 && stackN(x.item.stack) === 15) && amountOf(a.pockets[2]) === 35 && amountOf(packOf(a)[5]) === 100, `the fight's start filled the gun (15) and both spares (15 each) out of the pocket's 80, physically: 35 left in the pocket, the pack's box untouched (${amountOf(a.pockets[2])}, ${amountOf(packOf(a)[5])})`);
  let err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pocket", 2), to: L(a, "pack", 0) });
  check(err === "" && u.ap === 1 && isRoundItem(packOf(a)[0]) && amountOf(packOf(a)[0]) === 35 && !a.pockets[2], `pocket → pack: the 35 done for 1 action (${err || "ok"}; ${u.ap} left)`);
  check(u.handBoxes === 0 && u.boxes.includes(packOf(a)[0]), "the boxes refit: the handful is in the pack now, not at hand");
  for (const x of u.mags) if (x.where !== "gun") x.item.stack = [{ k: K, n: 7 }]; // part-used spares: the rounds are on the item (physical), so a move keeps them wherever the magazine goes
  refitKit(b, u, a); // (set by hand here: the entries read the items)
  check(u.mags.filter((x) => x.where !== "gun").every((x) => x.n === 7), "the entries read the items' stacks (7 each)");
  const magLoc = L(a, "pocket", a.pockets.findIndex((it) => it && GEAR[it.key] && GEAR[it.key].mag));
  const moved = a.pockets.find((it) => it && GEAR[it.key] && GEAR[it.key].mag);
  err = combatAct(st, { type: "inv", unit: u.id, from: magLoc, to: L(a, "rig", 0) });
  check(err === "" && u.ap === 0 && rigPouches(a)[0] === moved && GEAR[rigPouches(a)[0].key].mag, `a magazine pocket → rig pouch: done (${err || "ok"})`);
  check(u.mags.length === mags0 && u.mags.some((x) => x.where === "rig" && x.item === moved && x.n === 7 && stackN(moved.stack) === 7) && u.mags.filter((x) => x.where === "pocket").length === 1 && u.mags.filter((x) => x.where !== "gun").reduce((s, x) => s + x.n, 0) === 14, `the magazine is placed in the rig now, with its 7 rounds on it (${u.mags.map((x) => `${x.where}:${x.n}`).join(" ")}); a reload from there costs ${MAGS.AP.rig}`);
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 0), to: L(a, "pocket", 2) });
  check(/No action left/.test(err) && isRoundItem(packOf(a)[0]), `at 0 AP: refused, nothing moves (${err})`);
  u.ap = 2;
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "armor"), to: L(a, "pack", 1) });
  check(/stay as they are/.test(err) && a.gear.armor && u.ap === 2, `armour stays as worn: refused (${err})`);
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 5), to: L(a, "backpack") });
  check(/stay as they are/.test(err) && u.ap === 2, "and the pack itself");
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 5), to: L(mate, "pocket", 2) });
  check(/own kit/.test(err) && u.ap === 2, `someone else's slot: refused (${err})`);
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 5), to: `cargo:1:list` });
  check(/own kit/.test(err) && u.ap === 2, "the cargo: refused");
  b.phase = "enemy";
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 5), to: L(a, "pocket", 2) });
  check(/enemy turn/.test(err) && isRoundItem(packOf(a)[5]), `on the enemy's turn: refused (${err})`);
  b.phase = "player";
  // Split, open, box: 1 action each.
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 5), op: "open" });
  const loose = packOf(a).filter((it) => it && isRoundItem(it) && it.loose);
  check(err === "" && u.ap === 1 && loose.length === 2 && amountOf(packOf(a)[5]) === 100 - AMMO_STACK.LOOSE && packOf(a)[1] && packOf(a)[1].loose && amountOf(packOf(a)[1]) === AMMO_STACK.LOOSE, `Open box: a loose handful of ${AMMO_STACK.LOOSE} beside the boxes for 1 action, ${100 - AMMO_STACK.LOOSE} left boxed (${err || "ok"})`);
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 1), op: "box" });
  check(err === "" && u.ap === 0 && !packOf(a)[1].loose && amountOf(packOf(a)[1]) === AMMO_STACK.LOOSE, `Box on the handful of ${AMMO_STACK.LOOSE}: boxed for 1 action (${err || "ok"})`);
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 1), op: "split" });
  check(/No action left/.test(err), "Split at 0 AP: refused");
  u.ap = 2;
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 1), op: "split" });
  check(err === "" && u.ap === 1 && packOf(a).filter((it) => it && isRoundItem(it)).length === 4 && amountOf(packOf(a)[1]) === AMMO_STACK.LOOSE / 2, `Split: half the stack beside it for 1 action (${err || "ok"}: ${packOf(a).filter((it) => it && isRoundItem(it)).map((it) => amountOf(it)).join(", ")})`);
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pocket", 3), to: L(a, "pack", 2) });
  check(/Nothing there/.test(err) && u.ap === 1, "an empty slot: nothing moves, nothing spent");
}

section("In a fight: a gun from the pack into the hands refits the unit; a save and load in the middle keeps it");
{
  const st = createWorld({ seed: SEED + 8, factionCount: 4 });
  const a = fighter(st, "pistol");
  a.gear.backpack = newItem("backpack");
  const second = newItem("shotgun");
  const gunSlot = fitReason(second, "pack") ? null : 0;
  if (gunSlot != null) packOf(a)[gunSlot] = second;
  const mate = fighter(st, "pistol"); // (keeps an action, so the turn never ends in the middle of the checks)
  const b = openBattle(st, [a, mate]);
  const u = unitOf(b, a);
  u.ap = 2; unitOf(b, mate).ap = 2;
  const first = a.gear.weapon;
  loadMag(u, 9);
  if (gunSlot != null) {
    const err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 0), to: L(a, "weapon") });
    check(err === "" && u.ap === 1 && a.gear.weapon === second && packOf(a)[0] === first, `pack → hands: the shotgun in hand, the pistol in the pack (${err || "ok"})`);
    check(u.weapon === "shotgun" && u.item === second && u.magsW === "shotgun" && u.magMode === "internal" && u.mag === u.magMax && u.magMax === 6, `the unit is refit: a shotgun (${u.weapon} ${u.mag}/${u.magMax}, ${u.magMode}), loaded as a gun carried into the fight is (gunload.js)`);
    check(first.loaded && first.loaded.n === 9, "the pistol keeps its 9 rounds in the pack (gunload.js)");
    const err2 = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 0), to: L(a, "weapon") });
    check(err2 === "" && u.ap === 0 && a.gear.weapon === first && u.weapon === "pistol" && u.mag === 9 && u.mags && u.mags.length === 3, `and back: the pistol with its 9 rounds and its magazines (${u.weapon} ${u.mag}/${u.magMax}, ${u.mags ? u.mags.length : 0} magazines)`);
  } else check(false, "a shotgun does not go in a pack: the swap could not be tried");
  // Mid-fight save and load: the kit as moved, the unit's AP, another move on the loaded battle.
  u.ap = 1;
  const str = saveToString(st);
  const st2 = loadFromString(str);
  const b2 = st2.combat, a2 = st2.survivors.find((x) => x.id === a.id), u2 = unitOf(b2, a2);
  check(b2 && u2 && u2.ap === 1 && a2.gear.weapon && a2.gear.weapon.key === "pistol" && packOf(a2)[0] && packOf(a2)[0].key === "shotgun", "the loaded battle has the kit as it was moved and the action left");
  const magLoc = L(a2, "pocket", a2.pockets.findIndex((it) => it && GEAR[it.key] && GEAR[it.key].mag));
  const err3 = combatAct(st2, { type: "inv", unit: u2.id, from: magLoc, to: L(a2, "pack", 3) });
  check(err3 === "" && u2.ap === 0 && packOf(a2)[3] && GEAR[packOf(a2)[3].key].mag && u2.mags.some((x) => x.where === "pack"), `a move on the loaded battle works and places the magazine in the pack (${err3 || "ok"})`);
  // refitKit on its own (sessions D and E): a magazine moved by hand is placed again, the rounds in it kept.
  const u3 = unitOf(b2, a2);
  const sp = u3.mags.find((x) => x.where === "pack");
  sp.n = 4;
  const i = packOf(a2).indexOf(packOf(a2)[3]);
  a2.pockets[a2.pockets.indexOf(null)] = packOf(a2)[i]; packOf(a2)[i] = null;
  refitKit(b2, u3, a2);
  check(!u3.mags.some((x) => x.where === "pack") && u3.mags.some((x) => x.where === "pocket" && x.n === 4), `refitKit: the magazine is in a pocket again with its 4 rounds (${u3.mags.map((x) => `${x.where}:${x.n}`).join(" ")})`);
}

section("In a fight: loose rounds dropped onto a spare magazine load it (1 action from a pocket or the rig, both from the pack)");
{
  const st = createWorld({ seed: SEED + 9, factionCount: 4 });
  const a = fighter(st, "pistol");
  const mate = fighter(st, "pistol"); // (keeps an action, so the turn never ends in the middle of the checks)
  a.gear.backpack = newItem("backpack");
  a.gear.rig = newItem("chestrig");
  const magKey = a.pockets.find((it) => it && GEAR[it.key] && GEAR[it.key].mag).key;
  for (let i = 0; i < a.pockets.length; i++) if (a.pockets[i] && GEAR[a.pockets[i].key].mag) a.pockets[i] = null; // the starter spares out: two of our own
  const m1 = newItem(magKey), m2 = newItem(magKey);
  a.pockets[0] = m1; a.pockets[1] = m2;
  a.pockets[2] = roundItem(K, 20, true); // a loose handful in a pocket
  packOf(a)[0] = roundItem(K, 40, true); // and one in the pack
  packOf(a)[1] = roundItem(K, 50, false); // a box
  const b = openBattle(st, [a, mate]);
  const u = unitOf(b, a), mu = unitOf(b, mate);
  u.ap = 2; mu.ap = 2;
  const cap = GEAR[magKey].mag.cap;
  const spots = () => carriedSpots(a);
  const e1 = magEntryAt(u, spots(), L(a, "pocket", 0)), e2 = magEntryAt(u, spots(), L(a, "pocket", 1));
  check(e1 && e2 && e1 !== e2 && e1.where === "pocket" && e2.where === "pocket" && u.mags.indexOf(e1) < u.mags.indexOf(e2), `magEntryAt: the two magazines in the pockets are two entries, in order (${u.mags.map((x) => `${x.where}:${x.n}`).join(" ")})`);
  check(magEntryAt(u, spots(), L(a, "pocket", 2)) === null && magEntryAt(u, spots(), L(a, "weapon")) === null, "a handful of rounds or the gun itself: no entry");
  // Empty both spares (as a swap would), then load one from the pocket's handful.
  e1.n = 0; e2.n = 0;
  check(loadedIn(b, u, e1) === 0 && gunRounds(st, m1, L(a, "pocket", 0)).n === 0 && gunRounds(st, m1, L(a, "pocket", 0)).src === "fight", "both empty: the badge on the magazine in a fight reads the unit's entry (0, fight)");
  let p = loadMagPlan(b, u, e1, a.pockets[2], "pocket");
  check(p.why === "" && p.cost === 1 && p.n === Math.min(cap, 20) && LOAD_AP.hand === 1 && LOAD_AP.pack === 2, `the plan from a pocket: 1 action, ${p.n} rounds (${p.why || "ok"})`);
  let err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pocket", 2), to: L(a, "pocket", 0) });
  const line = b.log.length ? b.log[b.log.length - 1].text : "";
  check(err === "" && u.ap === 1 && loadedIn(b, u, e1) === Math.min(cap, 20) && e1.load === "fmj" && a.pockets[2] && amountOf(a.pockets[2]) === 20 && a.pockets[0] === m1, `pocket → magazine: loaded for 1 action, the rounds stay where they lie ("${line}")`);
  check(new RegExp(`loads ${Math.min(cap, 20)} 9mm FMJ into a magazine in a pocket from a pocket \\(${Math.min(cap, 20)}/${cap}\\)`).test(line), "the log line names the rounds, the places and the count");
  check(gunRounds(st, m1, L(a, "pocket", 0)).n === Math.min(cap, 20), `the badge on it: ${gunRounds(st, m1, L(a, "pocket", 0)).n}/${cap}`);
  // From the pack with one action left: refused; with both: both spent.
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 0), to: L(a, "pocket", 1) });
  check(/both actions to load a magazine from the pack/.test(err) && u.ap === 1 && loadedIn(b, u, e2) === 0, `pack → magazine with one action left: refused (${err})`);
  u.ap = 2;
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 0), to: L(a, "pocket", 1) });
  check(err === "" && u.ap === 0 && loadedIn(b, u, e2) === Math.min(cap, 40) && /from the pack \(\d+\/\d+, both actions\)/.test(b.log[b.log.length - 1].text) && packOf(a)[0] && amountOf(packOf(a)[0]) === 40, `with both: loaded for both actions ("${b.log[b.log.length - 1].text}")`);
  u.ap = 2;
  // A box: open it first. A full magazine: refused. Another type into one with rounds in it: refused. Nothing spent.
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pack", 1), to: L(a, "pocket", 0) });
  check(/Open the box first/.test(err) && u.ap === 2 && packOf(a)[1] && !packOf(a)[1].loose && a.pockets[0] === m1, `a box onto a magazine: "${err}", nothing swapped`);
  e1.n = cap;
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pocket", 2), to: L(a, "pocket", 0) });
  check(/is full/.test(err) && u.ap === 2, `a full magazine: "${err}"`);
  e1.n = 3;
  const other = Object.keys(SUPPLIES).find((k) => /^a_9mm_/.test(k) && k !== K && !/_hand$/.test(k));
  if (other) {
    rigPouches(a)[0] = roundItem(other, 10, true);
    err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "rig", 0), to: L(a, "pocket", 0) });
    check(/holds 9mm FMJ: no other rounds/.test(err) && u.ap === 2, `another type onto one with rounds in it: "${err}"`);
    e1.n = 0;
    refitKit(b, u, a); // (placed by hand here; a move in the window refits as it goes)
    err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "rig", 0), to: L(a, "pocket", 0) });
    const e1b = magEntryAt(u, spots(), L(a, "pocket", 0)); // (refitKit made the entries anew)
    check(err === "" && u.ap === 1 && e1b.load !== "fmj" && loadedIn(b, u, e1b) === 10, `an empty one takes the other type from the rig for 1 action (${err || "ok"}: ${e1b.load}, ${loadedIn(b, u, e1b)} in)`);
    rigPouches(a)[0] = null;
  }
  // Every round claimed already: nothing goes in, nothing is spent.
  u.ap = 2;
  const stock = hub(st).stock;
  setRounds(stock, 0);
  a.pockets[2] = roundItem(K, 15, true); packOf(a)[0] = null; packOf(a)[1] = null;
  refitKit(b, u, a);
  for (const x of u.mags) if (x.where !== "gun") { x.n = 0; x.load = "fmj"; }
  const g = u.mags.find((x) => x.where === "gun");
  loadMag(u, 15);
  err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pocket", 2), to: L(a, "pocket", 0) });
  check(/every round left is already loaded/.test(err) && u.ap === 2, `the gun holds the only 15 rounds: "${err}"`);
  // A magazine of another gun: not loaded.
  const rifleMag = Object.keys(GEAR).find((k) => GEAR[k].mag && k !== magKey && GEAR[k].small && /stanag/.test(k)) || Object.keys(GEAR).find((k) => GEAR[k].mag && k !== magKey && GEAR[k].small);
  if (rifleMag) {
    a.pockets[3] = newItem(rifleMag);
    refitKit(b, u, a);
    err = combatAct(st, { type: "inv", unit: u.id, from: L(a, "pocket", 2), to: L(a, "pocket", 3) });
    check(/not one of the .*pistol's|does not take/.test(err) && u.ap === 2 && a.pockets[3].key === rifleMag, `another gun's magazine: "${err}"`);
    a.pockets[3] = null;
  }
  // A swap keeps every entry in its place: the emptied one sits where the fresh one came from.
  a.pockets[2] = null;
  setRounds(stock, 0); giveRounds(stock, 200, ["pistol"]);
  refitKit(b, u, a);
  const f1 = magEntryAt(u, spots(), L(a, "pocket", 0)), f2 = magEntryAt(u, spots(), L(a, "pocket", 1));
  f1.n = 0; f2.n = cap;
  loadMag(u, 0);
  u.ap = 2;
  err = combatAct(st, { type: "reload", unit: u.id });
  const n1 = magEntryAt(u, spots(), L(a, "pocket", 0)), n2 = magEntryAt(u, spots(), L(a, "pocket", 1));
  check(err === "" && u.mag === cap && n2 !== f2 && n2.where === "pocket" && n2.n === 0 && n1 === f1, `Reload swaps in the second pocket's magazine; the emptied one is the second pocket's entry now (${u.mags.map((x) => `${x.where}:${x.n}`).join(" ")})`);
  check(g && g.where === "pocket" && u.mags.find((x) => x.where === "gun") === f2, "the old gun entry is a pocket's; the fresh one is the gun's");
}

section("roundRoom: the numbers");
{
  const state = mk();
  const s = atBase(state, hub(state).id)[0];
  s.traits = []; stripAll(s); ensureInv(s);
  check(roundRoom(s, K, "pocket", true).n === 4 * AMMO_STACK.LOOSE, `four empty pockets take ${4 * AMMO_STACK.LOOSE} loose rounds`);
  check(roundRoom(s, K, "pocket", false).n === 4 * AMMO_STACK.BOXES * BOX, `or ${4 * AMMO_STACK.BOXES * BOX} boxed (${AMMO_STACK.BOXES} boxes of ${BOX} a slot)`);
  check(roundRoom(s, K, "pack", true).n === 0 && /no pack/.test(roundRoom(s, K, "pack", true).why), "no pack: 0, with why");
  s.gear.rig = newItem("chestrig");
  check(roundRoom(s, K, "rig", true).n === 2 * LOOSE_POUCH + 2 * AMMO_STACK.LOOSE, `two admin pouches and two pocket pouches: ${2 * LOOSE_POUCH + 2 * AMMO_STACK.LOOSE} loose`);
  s.pockets[0] = roundItem(K, 30, true);
  check(roundRoom(s, K, "pocket", true).n === 3 * AMMO_STACK.LOOSE + (AMMO_STACK.LOOSE - 30), "a part stack counts its room");
  const r = roundsOnto([{ [K]: 20 }], K, 50, s, { where: "pocket", loose: true });
  check(r.moved === 20 && amountOf(s.pockets[0]) === 50 && r.why === "" , "roundsOnto draws what the pools hold onto the stack first");
  check(SUPPLIES[K] && itemAt(state, L(s, "pocket", 0)) === s.pockets[0], "(the location strings resolve)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
