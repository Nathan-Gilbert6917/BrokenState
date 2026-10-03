// Headless inventory test (sim/inventory.js): migration of old gear, equip / unequip rules, pockets and packs,
// armor sums, carry limits, looting bodies after a battle (by hand and headless), death sites, captives,
// combat with the new model, and a render smoke test of the inventory and loot screens.
// Usage: node tools/invtest.js [battles per matchup] [seed]
import { createWorld, makeSurvivor, combatPower, hub, hurt, killSurvivor, newId, survivorById } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { makeItem, wearAfterFight } from "../src/sim/crafting.js";
import { partyCapacity, cargoLoad, carryCapacity } from "../src/sim/parties.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler, unitById } from "../src/sim/combat.js";
import { takeCaptive } from "../src/sim/conflicts.js";
import {
  ensureInv, armorPower, armorMult, ARMOR_CAP, fitReason, moveItem, quickMove, toStorage, itemAt, packOf, carryBonus, itemLoad,
  allItems, battleBodies, takeSupply, takeAllBody, takeAllBodies, bodyEmpty, stow, spriteArmorKey,
} from "../src/sim/inventory.js";

const N = Number(process.argv[2] || 60);
const seed = Number(process.argv[3] || 11);
let pass = 0, fail = 0;
function check(ok, label) {
  if (ok) pass++;
  else { fail++; console.log(`  FAIL: ${label}`); }
}
const section = (t) => console.log(t);

const state = createWorld({ seed, factionCount: 5 });
const h = hub(state);
let last = null;
registerCombatHandler("test", (st, result) => { last = result; });
const item = (k, q = 1) => makeItem(k, q);
function person(at = { kind: "base", baseId: h.id }) {
  const s = makeSurvivor(state);
  s.location = at;
  state.survivors.push(s);
  return s;
}

// ---------- migration ----------
section("Migration");
{
  // A survivor as older code made them: three slots, the backpack as a tool, arm guards as body armor.
  const s = { id: newId(), name: "Old Timer", alive: true, traits: [], skills: { shooting: 5 }, health: 100, location: { kind: "base", baseId: h.id },
    gear: { weapon: { key: "pistol", name: GEAR.pistol.name, quality: 1 }, armor: { key: "padding", name: "Magazine arm guards", quality: 1, dur: 4 }, tool: { key: "backpack", name: "Improvised backpack", quality: 0.9 } } };
  state.survivors.push(s);
  check(armorPower(s) === 0.6, "armor works before migration (arm guards counted where they are)");
  ensureInv(s);
  check(s.gear.arms && s.gear.arms.key === "padding" && !s.gear.armor, "arm guards moved from body to arms");
  check(s.gear.backpack && s.gear.backpack.key === "backpack" && !s.gear.tool, "backpack moved from the tool slot to the backpack slot");
  check(packOf(s) && packOf(s).length === GEAR.backpack.slots, `pack slots added (${packOf(s) && packOf(s).length})`);
  check(s.pockets.length === 4 && s.pockets.every((x) => x === null), "4 empty pockets added");
  check(s.gear.head === null && s.gear.legs === null, "head and legs slots added");
  check(armorPower(s) === 0.6, "armor unchanged by migration");
  // The old combined football pads and helmet: split into pads (body) + helmet (head).
  const f = { id: newId(), name: "Linebacker", alive: true, traits: [], skills: {}, gear: { weapon: null, armor: { key: "sportspads", name: "Football pads and helmet", quality: 1, dur: 7 }, tool: null } };
  ensureInv(f);
  check(f.gear.armor.name === "Football pads" && f.gear.head && f.gear.head.key === "footballhelmet", "old football pads + helmet split into two pieces");
  check(f.gear.head.dur === 7 && Math.abs(armorPower(f) - 1.2) < 1e-9, `the split keeps the old armor 1.2 (got ${armorPower(f)}) and wear (${f.gear.head.dur})`);
  const g = { id: newId(), name: "Helmeted", alive: true, traits: [], skills: {}, gear: { armor: { key: "sportspads", name: "Football pads and helmet", quality: 1 }, head: item("riothelmet") } };
  ensureInv(g);
  check(g.gear.head.key === "riothelmet", "a split does not replace a helmet already worn");
  ensureInv(s); ensureInv(s);
  check(s.gear.arms.key === "padding" && packOf(s).length === 6, "ensureInv is safe to repeat");
  const fresh = makeSurvivor(state);
  check(fresh.pockets.length === 4 && "backpack" in fresh.gear && "legs" in fresh.gear, "new survivors come with every slot");
}

// ---------- equip rules ----------
section("Equip rules");
{
  const s = person();
  const t = person();
  h.armory.push(item("machete"), item("knife"), item("riothelmet"), item("backpack"), item("kneeguards"), item("vest"), item("pistol"));
  const at = (k) => `armory:${h.id}:list:${h.armory.findIndex((g) => g.key === k)}`;
  check(fitReason(item("pistol"), "head") !== "", "a pistol does not go on the head");
  check(fitReason(item("knife"), "pocket") === "" && fitReason(item("machete"), "pocket") !== "", "a knife fits a pocket, a machete does not");
  check(fitReason(item("backpack"), "pack") !== "", "a pack does not go inside a pack");
  check(/goes in Hands/.test(moveItem(state, at("machete"), `s:${s.id}:head`)), "moving a machete onto the head is refused");
  moveItem(state, at("machete"), `s:${s.id}:weapon`);
  check(s.gear.weapon && s.gear.weapon.key === "machete", "machete from the armory into the hands");
  moveItem(state, at("riothelmet"), `s:${s.id}:head`);
  moveItem(state, at("kneeguards"), `s:${s.id}:legs`);
  check(s.gear.head.key === "riothelmet" && s.gear.legs.key === "kneeguards", "helmet on the head, guards on the legs");
  moveItem(state, at("knife"), `s:${s.id}:pocket:0`);
  check(s.pockets[0] && s.pockets[0].key === "knife", "knife in a pocket");
  // Swap: the knife from the pocket into the hands sends the machete... back to the pocket? It does not fit, so to the armory.
  const before = h.armory.length;
  const msg = moveItem(state, `s:${s.id}:pocket:0`, `s:${s.id}:weapon`);
  check(s.gear.weapon.key === "knife" && h.armory.length === before + 1 && h.armory.some((g) => g.key === "machete"), `a swap that does not fit back goes to storage (${msg})`);
  // Swap that fits: pistol in pocket, knife in hand → swap.
  moveItem(state, at("pistol"), `s:${s.id}:pocket:1`);
  moveItem(state, `s:${s.id}:pocket:1`, `s:${s.id}:weapon`);
  check(s.gear.weapon.key === "pistol" && s.pockets[1] && s.pockets[1].key === "knife", "pistol and knife swap between hand and pocket");
  // Pack: put on a backpack, fill it, pass the whole pack to someone else.
  moveItem(state, at("backpack"), `s:${s.id}:backpack`);
  check(packOf(s) && packOf(s).length === 6, "a backpack gives 6 pack slots");
  moveItem(state, at("vest"), `s:${s.id}:pack:0`);
  check(packOf(s)[0] && packOf(s)[0].key === "vest", "vest stowed in the pack");
  check(/inside/.test(moveItem(state, `s:${s.id}:backpack`, `s:${s.id}:pack:1`)), "a pack cannot go inside itself");
  moveItem(state, `s:${s.id}:backpack`, `s:${t.id}:backpack`);
  check(!s.gear.backpack && t.gear.backpack && packOf(t)[0].key === "vest", "handing over a pack hands over what is in it");
  check(!itemAt(state, `s:${s.id}:pack:0`), "no pack, no pack slots");
  // Unequip to the armory, quick moves.
  const n0 = h.armory.length;
  toStorage(state, `s:${s.id}:head`);
  check(!s.gear.head && h.armory.length === n0 + 1, "unequip the helmet to the armory");
  quickMove(state, `armory:${h.id}:list:${h.armory.findIndex((g) => g.key === "riothelmet")}`, s.id);
  check(s.gear.head && s.gear.head.key === "riothelmet", "quick move from the armory puts it in its slot");
  // People in different places cannot swap.
  const away = person({ kind: "base", baseId: -1 });
  check(/same base/.test(moveItem(state, `s:${s.id}:legs`, `s:${away.id}:legs`)), "no moves between people at different places");
  // Combat power and sprite read the new model.
  check(spriteArmorKey(s) === null && spriteArmorKey({ gear: { arms: item("padding") } }) === "padding", "sprite draws body armor, else arm guards");
}

// ---------- armor sums ----------
section("Armor");
{
  const s = person();
  const base = combatPower(s);
  s.gear.armor = item("vest");
  s.gear.head = item("riothelmet");
  s.gear.arms = item("padding");
  s.gear.legs = item("kneeguards");
  check(Math.abs(armorPower(s) - 4.3) < 1e-9, `vest + riot helmet + arm guards + knee guards = 4.3 (got ${armorPower(s)})`);
  check(Math.abs(combatPower(s) - base - 4.3 * 0.5 * (0.5 + s.health / 200)) < 1e-9, "combat power counts every worn piece");
  s.gear.armor = item("plate");
  check(armorPower(s) === ARMOR_CAP, `plate + helmet + guards is capped at ${ARMOR_CAP} (sum 6.3)`);
  s.health = 100;
  hurt(state, s, 50, null, "test");
  check(Math.abs(s.health - (100 - 50 * armorMult(s))) < 1e-9, `hurt() uses the summed armor (health ${s.health.toFixed(1)})`);
  // Makeshift pieces on every slot wear after a fight.
  const m = person();
  m.gear.head = item("footballhelmet"); m.gear.arms = item("padding"); m.gear.legs = item("shinguards"); m.gear.armor = item("tirevest");
  wearAfterFight(state, [m]);
  check(m.gear.head.dur === GEAR.footballhelmet.dur - 1 && m.gear.arms.dur === GEAR.padding.dur - 1 && m.gear.legs.dur === GEAR.shinguards.dur - 1 && m.gear.armor.dur === GEAR.tirevest.dur - 1, "a fight wears head, body, arms and legs");
}

// ---------- carry limits ----------
section("Carry");
function makeParty(members, tile = h.tile) {
  const p = { id: newId(), owner: "player", kind: "expedition", mission: "recon", dest: tile, homeBaseId: h.id, members: members.map((s) => s.id), stance: "normal",
    vehicle: false, vehicleId: null, supplies: { food: 5, water: 5, ammo: 60, meds: 2 }, cargo: { supplies: {}, gear: [] }, path: [tile], idx: 0, progress: 0, phase: "waiting",
    seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false, departed: state.hour, plannedHours: 10, orders: [] };
  for (const s of members) s.location = { kind: "party", partyId: p.id };
  state.parties.push(p);
  return p;
}
{
  const a = person(), b = person();
  a.traits = []; b.traits = [];
  const p = makeParty([a, b]);
  check(partyCapacity(state, p) === 30, `two people carry 30 (got ${partyCapacity(state, p)})`);
  a.gear.backpack = item("backpack");
  check(carryBonus(a) === 6 && partyCapacity(state, p) === 36, "a worn backpack adds 6 carry space for the team");
  a.gear.backpack = item("assaultpack");
  check(partyCapacity(state, p) === 40, "an assault pack adds 10");
  packOf(a)[0] = item("vest");
  packOf(a)[1] = item("machete");
  check(itemLoad(a.gear.backpack) === 9, "a pack in the cargo counts what is inside (3 + 2×3)");
  // Fill the cargo, then try to put a pocket item in.
  p.cargo.supplies.scrap = partyCapacity(state, p) - 1;
  a.pockets[0] = item("knife");
  check(/No room/.test(moveItem(state, `s:${a.id}:pocket:0`, `cargo:${p.id}:list`)) && a.pockets[0], "a full cargo refuses another item");
  check(/No room/.test(toStorage(state, `s:${a.id}:backpack`)), "taking off a pack into a full cargo is refused (its carry space goes too)");
  p.cargo.supplies.scrap = 0;
  moveItem(state, `s:${a.id}:pocket:0`, `cargo:${p.id}:list`);
  check(p.cargo.gear.some((g) => g.key === "knife") && cargoLoad(p.cargo) === 3, "with room the knife goes to the cargo (load 3)");
  moveItem(state, `cargo:${p.id}:list:0`, `s:${b.id}:pocket:2`);
  check(b.pockets[2] && b.pockets[2].key === "knife" && cargoLoad(p.cargo) === 0, "cargo item into a teammate's pocket frees the space");
  check(/same base/.test(moveItem(state, `s:${b.id}:pocket:2`, `armory:${h.id}:list`)), "a team in the field cannot reach the hub armory");
  state.parties.splice(state.parties.indexOf(p), 1);
}

// ---------- looting bodies ----------
section("Looting");
function fight(setup, { manual }) {
  if (manual) globalThis.window = {}; // pretend a browser is there: bodies wait for the loot screen
  state.combat = createBattle(state, setup);
  let guard = 0;
  while (!state.combat.over && guard++ < 60) { autoPlayerTurn(state); runEnemyPhase(state); }
  if (manual) delete globalThis.window;
  return state.combat;
}
function strongTeam(n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const s = person();
    s.skills.shooting = 14; s.health = 100; s.traits = [];
    s.gear.weapon = item("ar"); s.gear.armor = item("plate");
    list.push(s);
  }
  return list;
}
{
  let b = null, p = null, team = null, tries = 0;
  // A fight the team wins, with a fallen teammate (marked dead before the end so they leave a body).
  while (tries++ < 20) {
    team = strongTeam(4);
    team[3].pockets[0] = item("bandagekit");
    p = makeParty(team);
    p.supplies.ammo = 200;
    const setup = { tile: h.tile + 1, partyId: p.id, enemy: { kind: "raiders", count: 3, power: 2 }, ambush: "player", canRetreat: false, handler: "test", context: {} };
    // Mark one teammate as dead before the battle ends.
    globalThis.window = {};
    state.combat = createBattle(state, setup);
    const u = state.combat.units.find((x) => x.sid === team[3].id);
    u.dead = true; u.hp = 0;
    let guard = 0;
    while (!state.combat.over && guard++ < 60) { autoPlayerTurn(state); runEnemyPhase(state); }
    delete globalThis.window;
    b = state.combat;
    if (b.over && b.result.outcome === "victory") break;
    state.combat = null;
    state.parties.splice(state.parties.indexOf(p), 1);
  }
  check(b && b.result.outcome === "victory", `won a battle to loot (after ${tries} tries)`);
  const bodies = battleBodies(state);
  const enemyB = bodies.filter((x) => x.sid == null && x.kind === "human");
  const ally = bodies.find((x) => x.sid === team[3].id);
  check(enemyB.length >= 1 && enemyB.every((x) => x.gear.weapon), `each dead raider has their weapon (${enemyB.length} bodies)`);
  check(enemyB.every((x) => (x.supplies.ammo || 0) >= 3), "each dead raider carries ammo");
  check(!!ally && !team[3].alive, "the fallen teammate is a body to loot");
  check(b.result.loot.gear.length === 0 && !Object.keys(b.result.loot.supplies).length, "nothing is taken before the loot screen (browser)");
  const site = state.deathSites.find((d) => d.tile === b.tileId);
  check(site && site.items.some((e) => e.item === team[3].gear.weapon), "the fallen teammate's gear is listed at their death site");
  // Take the dead raider's gun into a pocket? A rifle does not fit; into the hands of someone with a pistol...
  const bi = bodies.indexOf(enemyB[0]);
  const gun = enemyB[0].gear.weapon;
  const taker = team[0];
  const cargoBefore = p.cargo.gear.length;
  quickMove(state, `body:${bi}:weapon`, taker.id);
  if (GEAR[gun.key].small) check(taker.pockets.includes(gun) && p.cargo.gear.length === cargoBefore, "quick-taking a pistol puts it in a free pocket");
  else check(taker.gear.weapon === gun && p.cargo.gear.length === cargoBefore + 1, "quick-taking a long gun equips it; the old one goes to the cargo");
  check(b.result.loot.gear.includes(gun), "taken items count as battle loot");
  check(/only for taking/.test(moveItem(state, `s:${taker.id}:pocket:0`, `body:${bi}:pocket:0`)) || !taker.pockets[0], "nothing goes back onto a body");
  const ammo0 = p.cargo.supplies.ammo || 0;
  takeSupply(state, bi, "ammo");
  check((p.cargo.supplies.ammo || 0) > ammo0 && !enemyB[0].supplies.ammo, "taking the ammo stack puts it in the cargo");
  // The fallen teammate's kit: take it into a pocket; it leaves the death site.
  const ai = bodies.indexOf(ally);
  const kit = team[3].pockets[0];
  moveItem(state, `body:${ai}:pocket:0`, `s:${team[1].id}:pocket:3`);
  check(team[1].pockets[3] === kit && !state.deathSites.some((d) => d.items.some((e) => e.item === kit)), "a fallen friend's kit taken from the body leaves the death site");
  // Carry limit: fill the cargo, Take all leaves the rest.
  p.cargo.supplies.scrap = partyCapacity(state, p) - cargoLoad(p.cargo) - 2;
  const r = takeAllBody(state, bodies.indexOf(enemyB[enemyB.length - 1]));
  check(cargoLoad(p.cargo) <= partyCapacity(state, p) + 1e-9, `Take all respects the carry limit (load ${cargoLoad(p.cargo).toFixed(1)}/${partyCapacity(state, p)}, ${r.left} left)`);
  p.cargo.supplies.scrap = 0;
  // Leave the rest: what is left on enemy bodies goes to a death site on that tile.
  const leftItems = bodies.filter((x) => x.sid == null).reduce((a, x) => a + allItems(x).length, 0);
  const siteItems0 = (state.deathSites.find((d) => d.tile === b.tileId) || { items: [] }).items.length;
  closeCombat(state, { take: false });
  const site2 = state.deathSites.find((d) => d.tile === b.tileId);
  check(!state.combat && site2 && site2.items.length >= siteItems0 + leftItems && site2.names.some((n) => /dead/.test(n)), `leaving the bodies puts ${leftItems} items at the death site`);
  check(last && last.outcome === "victory", "the handler still gets the result");
  state.parties.splice(state.parties.indexOf(p), 1);
}
{
  // Headless: bodies are emptied into the cargo as soon as the battle ends (limited by carry space).
  let b = null, p = null, tries = 0;
  while (tries++ < 20) {
    const team = strongTeam(3);
    p = makeParty(team);
    p.supplies.ammo = 200;
    b = fight({ tile: h.tile + 2, partyId: p.id, enemy: { kind: "raiders", count: 3, power: 2 }, ambush: "player", canRetreat: false, handler: "test", context: {} }, { manual: false });
    if (b.over && b.result.outcome === "victory") break;
    state.combat = null;
  }
  const got = b.result.loot.gear.length + Object.keys(b.result.loot.supplies).length;
  check(got > 0 && p.cargo.gear.length === b.result.loot.gear.length, `headless battle auto-takes loot (${b.result.loot.gear.map((g) => g.name).join(", ")})`);
  check(cargoLoad(p.cargo) <= partyCapacity(state, p) + 1e-9, `auto-loot respects the carry limit (${cargoLoad(p.cargo).toFixed(1)}/${partyCapacity(state, p)})`);
  closeCombat(state);
  check(!state.combat, "closes cleanly");
  // Base defense: everything goes to the armory, no carry limit.
  const fighters = strongTeam(3);
  const arm0 = h.armory.length;
  let bb = null; tries = 0;
  while (tries++ < 20) {
    bb = fight({ tile: h.tile, baseId: h.id, fighterIds: fighters.map((s) => s.id), enemy: { kind: "soldiers", count: 3, power: 2 }, ambush: "player", canRetreat: false, handler: "test", context: {} }, { manual: false });
    if (bb.over && bb.result.outcome === "victory") break;
    state.combat = null;
  }
  check(bb.result.outcome === "victory" && h.armory.length - arm0 >= 3 && bb.bodies.every((x) => bodyEmpty(state, x)), `a base defense takes every body's gear into the armory (+${h.armory.length - arm0})`);
  closeCombat(state);
}
{
  // Zombie bodies: now and then a pocket item, ammo or meds; empty ones are not listed.
  let found = 0, bodies = 0;
  const team = strongTeam(4);
  for (let i = 0; i < 6; i++) {
    const b = fight({ tile: h.tile, baseId: h.id, fighterIds: team.filter((s) => s.alive).map((s) => s.id), enemy: { kind: "zombies", count: 12, power: 2 }, ambush: "player", canRetreat: false, handler: "test", context: {} }, { manual: true });
    if (b.over) { bodies += b.bodies.length; found += b.bodies.filter((x) => allItems(x).length).length; }
    if (b.over) closeCombat(state);
    state.combat = null;
    team.forEach((s) => { if (s.alive) s.health = 100; });
  }
  check(bodies < 6 * 12, `zombie bodies with nothing on them are skipped (${bodies} listed of up to 72, ${found} with an item)`);
}

// ---------- death sites, recovery, captives ----------
section("Death sites and captives");
{
  const s = person();
  s.gear.weapon = item("pistol");
  s.gear.backpack = item("backpack");
  packOf(s)[2] = item("machete");
  s.pockets[1] = item("knife");
  const tile = h.tile + 3;
  killSurvivor(state, s, tile, "in a test");
  const site = state.deathSites.find((d) => d.tile === tile);
  check(site && site.items.length === 3 && site.items.some((e) => e.item && e.item.key === "backpack" && e.item.contents[2]), "pockets and the pack (with its contents) stay at the death site");
  const c = person();
  c.gear.weapon = item("shotgun"); c.pockets[0] = item("knife"); c.gear.head = item("bikehelmet");
  const f = state.factions[0];
  const n0 = f.lootedGear.length;
  takeCaptive(state, c, f, null);
  check(!allItems(c).length && f.lootedGear.length === n0 + 3, "captives lose everything they carry (3 items)");
}

// ---------- stow ----------
{
  const s = person();
  s.gear.weapon = item("pistol");
  const l1 = stow(s, item("knife"));
  const l2 = stow(s, item("machete"));
  check(/pocket/.test(l1) && l2 === "", "stow: a knife goes to a pocket; a machete with full hands and no pack has nowhere to go");
}

// ---------- combat with the new model ----------
section("Combat with the new model");
function matchup(armored, n) {
  const tally = { victory: 0, dead: 0 };
  for (let i = 0; i < n; i++) {
    const team = [];
    for (let k = 0; k < 3; k++) {
      const s = person();
      s.skills.shooting = state.rng.int(5, 11);
      s.gear.weapon = item(state.rng.pick(["pistol", "pistol", "huntrifle", "shotgun"]));
      if (armored) { s.gear.head = item("bikehelmet"); s.gear.arms = item("padding"); s.gear.legs = item("kneeguards"); }
      team.push(s);
    }
    h.stock.ammo = 200; h.stock.meds = 3;
    const power = team.reduce((a, s) => a + combatPower(s), 0) / 4;
    const b = fight({ tile: h.tile, baseId: h.id, fighterIds: team.map((s) => s.id), enemy: { kind: "raiders", count: 4, power: 5 }, ambush: null, canRetreat: false, handler: "test", context: {} }, { manual: false });
    if (b.over) { if (b.result.outcome === "victory") tally.victory++; tally.dead += b.result.survivorsDead.length; closeCombat(state); }
    state.combat = null;
    void power;
    state.survivors = state.survivors.filter((s) => !team.includes(s));
    state.deathSites = [];
    state.cards = [];
    state.gameOver = false;
  }
  return tally;
}
{
  // At least 300 battles a side: with 60 the difference between the two samples is mostly noise.
  const M = Math.max(N, 300);
  const plain = matchup(false, M), armored = matchup(true, M);
  console.log(`  3 vs 4 raiders (power 5), no extra armor:              win ${Math.round(plain.victory / M * 100)}%  deaths/battle ${(plain.dead / M).toFixed(2)}`);
  console.log(`  3 vs 4 raiders (power 5), helmet + arm + knee guards:  win ${Math.round(armored.victory / M * 100)}%  deaths/battle ${(armored.dead / M).toFixed(2)}`);
  check(armored.dead <= plain.dead * 1.15 + 1, "extra armor does not make fights deadlier");
}

// ---------- screens (render smoke test with a stub canvas) ----------
section("Screens");
{
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => "data:image/png;base64," }) };
  const { inventoryModal, INV_ACTIONS } = await import("../src/ui/inventory.js");
  const s = person();
  s.gear.weapon = item("pistol"); s.gear.backpack = item("backpack"); s.pockets[0] = item("knife");
  const ui = { inv: null, invSel: null, invMsg: "" };
  INV_ACTIONS["inv-open"](state, ui, { id: String(s.id) });
  let html = inventoryModal(state, ui) || "";
  check(/Pockets/.test(html) && html.includes(`s:${s.id}:pocket:0`) && html.includes(`armory:${h.id}:list`), "survivor inventory renders slots, pockets and the armory");
  INV_ACTIONS["inv-click"](state, ui, { loc: `s:${s.id}:pocket:0` });
  check(ui.invSel === `s:${s.id}:pocket:0`, "clicking an item selects it");
  INV_ACTIONS["inv-click"](state, ui, { loc: `armory:${h.id}:list` });
  check(!s.pockets[0] && h.armory.some((g) => g.key === "knife"), "clicking the armory puts the selected item there");
  const team = strongTeam(2);
  const p = makeParty(team);
  INV_ACTIONS["inv-open"](state, ui, { id: String(team[0].id) });
  html = inventoryModal(state, ui) || "";
  check(html.includes(`cargo:${p.id}:list`) && html.includes(`data-action="inv-who"`), "a team member's inventory shows the cargo and teammates");
  // Loot screen over a finished battle.
  let b = null, tries = 0;
  while (tries++ < 20) {
    b = fight({ tile: h.tile + 4, partyId: p.id, enemy: { kind: "raiders", count: 2, power: 2 }, ambush: "player", canRetreat: false, handler: "test", context: {} }, { manual: true });
    if (b.over && b.result.outcome === "victory" && b.bodies.length) break;
    state.combat = null;
  }
  INV_ACTIONS["loot-open"](state, ui, {});
  html = inventoryModal(state, ui) || "";
  check(/Loot the bodies/.test(html) && html.includes("body:0:weapon"), "the loot screen lists bodies and shows a body's paper doll");
  INV_ACTIONS["loot-takeall"](state, ui, {});
  check(/Took/.test(ui.invMsg), `Take everything: ${ui.invMsg.slice(0, 80)}…`);
  INV_ACTIONS["loot-done"](state, ui, {});
  closeCombat(state);
  check(!ui.inv && !state.combat, "done and closed");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
