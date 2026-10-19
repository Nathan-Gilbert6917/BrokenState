// Headless regression checks for fights and the living world: who takes the field against you, waking
// sleepers, loot after a fight, wear and med kits, the battle and trade queues, teams that must never be left
// halted, raids carried out of, base defence in person, hordes, pacts, collapsed groups and trade-route terms; raids on
// you (size, escalation, siege pace, damage and repairs, tribute fading, provoked groups) and groups that grow.
// Usage: node tools/fighttest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { setRounds, totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld, tickHour, hub, atBase, makeSurvivor, skill, survivorById, killSurvivor, usesArrows, armedFactor, spendShots, ARROWS } from "../src/sim/world.js";
import { FACTION_TYPES, GEAR } from "../src/sim/data.js";
import {
  createBattle, startCombat, finishCombat, closeCombat, autoResolveCombat, combatAct, autoPlayerTurn, runEnemyPhase,
  registerCombatHandler, canSee, active, zoneAt,
} from "../src/sim/combat.js";
import {
  launchExpedition, partyMembers, partyTile, partyCapacity, cargoLoad, poolLoad, planPath, giveOrder, spawnAiParty, takeShots,
} from "../src/sim/parties.js";
import { triggerConflict, guardsFor, fightOdds, raidForce, engagedWith, defendInPerson } from "../src/sim/conflicts.js";
import {
  attitude, changeGoodwill, collapseFaction, recomputeOwnership, factionsDaily, raidWarning, deliverHelpCall,
  resolveRaidOnFaction, baseDefense, raidSize, siegePace, raidRepelled, resolveRaidOnPlayer, maxBases, strength, RAIDS,
} from "../src/sim/factions.js";
import { raidDamage, repairPlan } from "../src/sim/breakdowns.js";
import { addBuilding, baseWalls, baseBeds, queueBuild, constructionHour } from "../src/sim/buildings.js";
import { hordesHour, reduceHorde, HORDE_MAX_SIZE, HORDE_MIN_SIZE } from "../src/sim/hordes.js";
import { endTrade, tradePending, routeProblem, routeWorth, routeExchange, createRoute } from "../src/sim/trade.js";
import { routesDaily } from "../src/sim/economy.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { startWar } from "../src/sim/diplomacy.js";
import { newItem } from "../src/sim/inventory.js";
import { makeItem, itemDurMax } from "../src/sim/crafting.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const world = (s = seed, n = 8) => createWorld({ seed: s, factionCount: n });
const pick = (card, re) => card.choices.find((c) => re.test(c.label));
const isOff = (state, ch) => (typeof ch.disabled === "function" ? ch.disabled(state) : !!ch.disabled);
registerCombatHandler("ft", () => {});

// The sim opens tactical battles only "in a browser" (it checks typeof window). Tests that need one stub it.
function inBrowser(fn) {
  globalThis.window = {};
  try { return fn(); } finally { delete globalThis.window; }
}
function fighter(state, { weapon = "huntrifle", shooting = 9 } = {}) {
  const s = makeSurvivor(state);
  s.skills.shooting = shooting;
  s.traits = [];
  s.gear.weapon = weapon ? newItem(weapon) : null;
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function team(state, n, dist = 5, supplies = { food: 3 * n, water: 3 * n, ammo: 40 * n, meds: 2, scrap: 2 * n }) {
  const h = hub(state);
  const crew = [];
  for (let i = 0; i < n; i++) crew.push(fighter(state));
  for (const [k, v] of Object.entries(supplies)) h.stock[k] = (h.stock[k] || 0) + v;
  const dest = state.tiles.find((t) => t.terrain !== "water" && state.grid.distance(t.id, h.tile) === dist && planPath(state, h.tile, t.id, false)).id;
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies });
  if (res.error) throw new Error(res.error);
  res.party.idx = Math.min(2, res.party.path.length - 1);
  return res.party;
}
function playOut(state, max = 80) {
  const b = state.combat;
  let g = 0;
  while (state.combat === b && !b.over && g++ < max) { autoPlayerTurn(state); runEnemyPhase(state); }
  return b;
}
const groupOf = (state, type) => {
  const f = state.factions.find((x) => x.alive && x.type === type) || state.factions.find((x) => x.alive);
  f.type = type;
  return f;
};

// 1. Other groups field humans only (C-1).
{
  console.log("Who takes the field");
  const st = world();
  const h = hub(st);
  const p = team(st, 2);
  for (const type of Object.keys(FACTION_TYPES)) {
    const f = groupOf(st, type);
    f.pop = 30;
    const enemy = guardsFor(st, p, f);
    const b = createBattle(st, { tile: h.tile, baseId: h.id, enemy, ambush: null, canRetreat: false, handler: "ft", context: {} });
    const foes = b.units.filter((u) => u.side === "enemy");
    check(foes.length >= 3 && foes.every((u) => u.kind === "human"), `${type}: ${foes.length} guards, all human (${[...new Set(foes.map((u) => u.name.split(" ")[0]))].join("/")})`);
  }
  const mixed = createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "mixed", count: 6, power: 3 }, ambush: null, canRetreat: false, handler: "ft", context: {} });
  const kinds = new Set(mixed.units.filter((u) => u.side === "enemy").map((u) => u.kind));
  check(kinds.has("human") && kinds.has("zombie"), "\"mixed\" still means humans plus the dead");
}

// 2. Any hit that leaves a sleeper alive wakes its group (C-8).
{
  console.log("Sleepers");
  let hits = 0, woke = 0, misses = 0, asleepAfterMiss = 0;
  for (let i = 0; i < 80 && hits < 25; i++) {
    const st = world(seed + i, 4);
    const h = hub(st);
    const crew = [fighter(st, { weapon: null, shooting: 14 }), fighter(st, { weapon: null, shooting: 14 }), fighter(st, { weapon: null, shooting: 14 })];
    for (const s of crew) s.gear.weapon = makeItem("crossbow", 1);
    h.stock.arrows = 30; // the crossbows' bolts (world.js usesArrows)
    const setup = { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 4, power: 7 }, ambush: "player", canRetreat: false, handler: "ft", context: {} };
    const b = (st.combat = createBattle(st, setup));
    for (const u of b.units.filter((x) => x.side === "player")) {
      if (b.phase !== "player") break;
      const t = b.units.find((x) => x.side === "enemy" && active(x) && !x.aware && canSee(b, u, x));
      if (!t) continue;
      const hp = t.hp;
      if (combatAct(st, { type: "shoot", unit: u.id, target: t.id })) continue;
      if (t.hp < hp && !t.dead) { hits++; if (t.aware && b.units.filter((x) => x.side === "enemy" && x.pod === t.pod && active(x)).every((x) => x.aware)) woke++; }
      else if (t.hp === hp) { misses++; if (!t.aware) asleepAfterMiss++; }
    }
    st.combat = null;
  }
  check(hits >= 10 && woke === hits, `a crossbow hit that does not kill wakes the target's group (${woke}/${hits})`);
  check(misses === 0 || asleepAfterMiss === misses, `a silent miss wakes nobody (${asleepAfterMiss}/${misses})`);
}

// 3. Hordes: none below the minimum stays on the map; wandering hordes that meet merge up to the cap and the rest
// stays a horde of its own (C-9, R-2; hordes.js mergeHordes).
{
  console.log("Hordes");
  const st = world();
  const land = st.tiles.filter((t) => t.terrain !== "water" && !t.loc);
  st.hordes = [
    { id: 9001, tile: land[0].id, size: 0, target: null, move: 0 },
    { id: 9002, tile: land[1].id, size: 4, target: null, move: 0 },
    { id: 9003, tile: land[2].id, size: 350, target: null, move: 0 },
    { id: 9004, tile: land[2].id, size: 350, target: null, move: 0 },
    { id: 9005, tile: land[3].id, size: 30, target: null, move: 0 },
  ];
  hordesHour(st);
  check(st.hordes.every((x) => x.size >= HORDE_MIN_SIZE), "hordes of 0 and 4 are removed within the hour");
  const merged = st.hordes.filter((x) => x.tile === land[2].id);
  check(merged.length === 2 && merged.some((x) => x.size === HORDE_MAX_SIZE) && merged.some((x) => x.size === 700 - HORDE_MAX_SIZE), `two hordes of 350 merge into one of ${HORDE_MAX_SIZE} and the other ${700 - HORDE_MAX_SIZE} stay apart (got ${merged.map((x) => x.size)})`);
  const small = st.hordes.find((x) => x.id === 9005);
  check(reduceHorde(st, small, 27) === true && !st.hordes.includes(small), "a horde cut down to 3 is removed at once");
  const big = merged.find((x) => x.size === HORDE_MAX_SIZE) || merged[0];
  check(reduceHorde(st, big, 10) === false && st.hordes.includes(big) && big.size === HORDE_MAX_SIZE - 10, "a horde that stays above the minimum only shrinks");
}

// 4. Surrender takes what the text says (C-14).
{
  console.log("Surrender");
  for (const [type, keepsGear] of [["traders", true], ["commune", true], ["raider", false], ["military", false]]) {
    const st = world();
    const f = groupOf(st, type);
    f.goodwill = 0;
    const p = team(st, 2);
    p.supplies = { water: 10, ammo: 50, meds: 0, scrap: 0, fuel: 0, parts: 0 }; p.foodLots = {};
    setFood(p, 10); // days of ration bars (tools/foodkit.js)
    p.cargo.gear.push(newItem("ar"), newItem("plate"));
    const card = triggerConflict(st, p, "challenge", f.id);
    st.cards.length = 0;
    const ch = pick(card, /^Surrender|^Submit/);
    ch.resolve(st);
    const says = /gear/.test(ch.hint) && !/left alone/.test(ch.hint);
    check((p.cargo.gear.length === 2) === keepsGear, `${type}: cargo gear ${keepsGear ? "kept" : "taken"} (${p.cargo.gear.length} left)`);
    check(says === !keepsGear, `${type}: the terms ${keepsGear ? "do not claim" : "name"} the gear`);
    if (type === "traders") check(food(p) >= 8 - 1e-6 && food(p) <= 9 && p.supplies.ammo === 40, `traders take a fifth of the supplies, food by whole items (food ${food(p).toFixed(1)} of 10, ammo ${p.supplies.ammo})`);
  }
}

// 5. Wear: only the fielded units, only the items they fielded; bandage kit per heal; surgical kit needs skill (C-15, B-9).
{
  console.log("Wear and kits");
  const st = world();
  const h = hub(st);
  while (atBase(st, h.id).length < 11) fighter(st);
  const everyone = atBase(st, h.id);
  for (const s of everyone) { s.health = 100; s.skills.shooting = 6; s.gear.weapon = makeItem("pipespear", 1); s.gear.armor = makeItem("tirevest", 1); s.gear.tool = null; }
  const medic = everyone[0];
  medic.skills.shooting = 20; // makes sure the medic is one of the eight who take the field
  medic.gear.tool = makeItem("bandagekit", 1);
  h.stock.meds = 6; h.stock.ammo = 50;
  const setup = { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 2, power: 1 }, ambush: null, canRetreat: false, handler: "ft", context: {} };
  const b = (st.combat = createBattle(st, setup));
  const fielded = b.units.filter((u) => u.side === "player").map((u) => u.sid);
  check(fielded.length === 8, `eight of ${everyone.length} take the field`);
  const mu = b.units.find((u) => u.sid === medic.id);
  mu.hp = 55;
  check(combatAct(st, { type: "meds", unit: mu.id, target: mu.id }) === "" && combatAct(st, { type: "meds", unit: mu.id, target: mu.id }) === "", "the medic treats twice");
  playOut(st);
  check(b.over && b.result.outcome === "victory", "the defence wins");
  const spearMax = itemDurMax(makeItem("pipespear", 1)), vestMax = itemDurMax(makeItem("tirevest", 1)); // crafted at 100%: their own full uses
  const tookField = everyone.filter((s) => fielded.includes(s.id) && s.alive);
  const stayed = everyone.filter((s) => !fielded.includes(s.id));
  // Armour wears by its hits instead (armour.js per-hit durability): never more than it had, and only those hit.
  check(tookField.every((s) => s.gear.weapon.dur === spearMax - 1 && (!s.gear.armor || s.gear.armor.dur <= vestMax)), "the weapons of those who fought lose one use when the battle ends; their armour only what its hits took");
  check(stayed.length === 3 && stayed.every((s) => (s.gear.weapon.dur ?? spearMax) === spearMax && (s.gear.armor.dur ?? vestMax) === vestMax), "people who stayed off the map wear nothing");
  check(medic.gear.tool && medic.gear.tool.dur === itemDurMax(medic.gear.tool) - mu.kitUses && mu.kitUses >= 2, `the bandage kit lost one use per treatment (${mu.kitUses} uses, ${medic.gear.tool ? medic.gear.tool.dur : "gone"} left)`);
  // Swapped on the result screen: the weapon that fought is already worn, the fresh one is not.
  const swapper = tookField.find((s) => s !== medic);
  const fought = swapper.gear.weapon;
  const fresh = makeItem("spikedbat", 1);
  h.armory.push(fought);
  swapper.gear.weapon = fresh;
  closeCombat(st);
  check(fresh.dur === itemDurMax(fresh) && fought.dur === spearMax - 1, "an item equipped after the battle is not worn; the one that fought is, once");
  check(tookField.filter((s) => s !== swapper).every((s) => s.gear.weapon.dur === spearMax - 1), "closing the battle does not wear anything a second time");

  // Surgical kit.
  const low = fighter(st), high = fighter(st);
  low.skills.medicine = 0; high.skills.medicine = 12;
  low.gear.tool = newItem("surgkit"); high.gear.tool = newItem("surgkit");
  const b2 = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [low.id, high.id], enemy: { kind: "zombies", count: 1, power: 1 }, ambush: null, canRetreat: false, handler: "ft", context: {} });
  const ul = b2.units.find((u) => u.sid === low.id), uh = b2.units.find((u) => u.sid === high.id);
  check(ul.medicine === skill(low, "medicine"), `a surgical kit gives nothing to someone who cannot use it (Medicine ${ul.medicine})`);
  check(uh.medicine > skill(high, "medicine"), `and helps a trained medic (${skill(high, "medicine")} → ${uh.medicine})`);
}

// 6. Auto-resolve and the card odds count ammo found on the way (C-16).
{
  console.log("Ammo in the cargo");
  const st = world();
  const f = groupOf(st, "raider");
  const p = team(st, 2);
  const guns = partyMembers(st, p).map((s) => s.gear.weapon && s.gear.weapon.key).filter(Boolean); // ammo.js: rounds that fit the team's guns
  setRounds(p.supplies, 3, guns); setRounds(p.cargo.supplies, 40, guns);
  const enemy = { kind: "raiders", count: 3, power: 4, factionId: f.id, name: "test raiders" };
  const mixedPools = fightOdds(st, p, enemy, null);
  setRounds(p.supplies, 43, guns); setRounds(p.cargo.supplies, 0, guns);
  check(Math.abs(mixedPools - fightOdds(st, p, enemy, null)) < 1e-9, "the odds on the card are the same wherever the ammo is carried");
  setRounds(p.supplies, 3, guns); setRounds(p.cargo.supplies, 40, guns);
  const r = autoResolveCombat(st, { tile: partyTile(p), partyId: p.id, enemy: { kind: "zombies", count: 1, power: 1 }, handler: "ft", context: {} });
  check(r.ammoUsed === 12 && totalRounds(p.supplies) === 0 && totalRounds(p.cargo.supplies) === 31, `a fight by the numbers shoots from both pools (used ${r.ammoUsed}, packed ${totalRounds(p.supplies)}, found ${totalRounds(p.cargo.supplies)})`);
}

// 7. A battle whose team is gone is dropped without a result (C-17).
{
  console.log("Stale battles");
  const st = world();
  const f = groupOf(st, "raider");
  const pop = f.pop, logs = st.log.length;
  const ghost = { tile: hub(st).tile, partyId: 987654, enemy: { kind: "raiders", count: 3, power: 4, factionId: f.id, name: "x" }, handler: "conflict", context: { partyId: 987654, factionId: f.id, enemy: { name: "x" }, type: "camp" } };
  startCombat(st, ghost);
  check(f.pop === pop && st.log.length === logs && !st.combat, "headless: no fight, no losses, no log line");
  inBrowser(() => {
    const st2 = world();
    const g = groupOf(st2, "raider");
    g.goodwill = -80;
    const p1 = team(st2, 2, 5), p2 = team(st2, 2, 6);
    const c1 = triggerConflict(st2, p1, "roadblock", g.id), c2 = triggerConflict(st2, p2, "roadblock", g.id);
    st2.cards.length = 0;
    pick(c1, /^Open fire/).resolve(st2);
    pick(c2, /^Open fire/).resolve(st2);
    check(st2.combat && st2.combat.setup.partyId === p1.id && (st2.combatQueue || []).length === 1, "the second fight waits in the queue");
    check(engagedWith(st2, p2) === "battle", "the waiting team counts as busy with a battle");
    for (const s of partyMembers(st2, p2)) killSurvivor(st2, s, partyTile(p2), "of thirst on the road");
    playOut(st2);
    const popBefore = g.pop, logBefore = st2.log.length;
    const killed = st2.combat.result.enemiesKilled;
    closeCombat(st2);
    check(!st2.combat && !(st2.combatQueue || []).length, "after the first battle the stale one is dropped, not opened");
    const fresh = st2.log.slice(0, st2.log.length - logBefore).map((l) => l.text);
    check(g.pop === popBefore - Math.ceil(killed * 0.6) && !fresh.some((t) => /lost fighting/.test(t)) && fresh.filter((t) => /^Fight near/.test(t)).length <= 1,
      "the dropped battle costs the group nothing and logs no fight");
    check(!st2.parties.includes(p2), "the dead team is closed");
  });
}

// 8. No double loot after a fight on the map; bonus gear respects carry space (C-4).
{
  console.log("Loot after a fight");
  let wins = 0;
  inBrowser(() => {
    for (let i = 0; i < 40 && wins < 4; i++) {
      const st = world(seed + 100 + i);
      const f = groupOf(st, "raider");
      f.goodwill = -80;
      const p = team(st, 3);
      const card = triggerConflict(st, p, "camp", f.id);
      st.cards.length = 0;
      card.conflict.enemy.count = 3; card.conflict.enemy.power = 2;
      pick(card, /^Ambush the camp/).resolve(st);
      const b = st.combat;
      if (!check(!!b, "a battle opens")) break;
      playOut(st);
      if (!b.over || b.result.outcome !== "victory") { st.combat = null; continue; }
      wins++;
      const ammo0 = p.cargo.supplies.ammo || 0, food0 = food(p.cargo) || 0, gear0 = p.cargo.gear.length;
      closeCombat(st, { take: true });
      const loot = b.result.loot;
      const after = st.cards.find((c) => c.title === "After the fight");
      check((p.cargo.supplies.ammo || 0) - ammo0 === (loot.supplies.ammo || 0) && Math.abs((food(p.cargo) || 0) - food0 - (food(loot) || 0)) < 1e-6,
        `the team gains exactly what was on the bodies (ammo +${(p.cargo.supplies.ammo || 0) - ammo0}, on bodies ${loot.supplies.ammo || 0})`);
      check(p.cargo.gear.length - gear0 === loot.gear.length, "no bonus gun on top of the looted ones");
      check(poolLoad(p) <= partyCapacity(st, p) + 1e-6, "the team is not over what it can carry");
      check(!!after && /Taken from the bodies/.test(after.text) === (Object.values(loot.supplies).some((q) => q > 0) || loot.gear.length > 0), "the card lists what was taken, once");
    }
  });
  check(wins >= 2, `tactical wins checked: ${wins}`);
  // By the numbers there are no bodies: the card pays, and a gun only goes in if it fits.
  let paid = 0, over = 0, left = 0;
  for (let i = 0; i < 60; i++) {
    const st = world(seed + 200 + i, 6);
    const f = groupOf(st, "raider");
    f.goodwill = -80;
    const p = team(st, 3);
    for (const s of partyMembers(st, p)) s.skills.shooting = 20;
    const card = triggerConflict(st, p, "camp", f.id);
    st.cards.length = 0;
    card.conflict.enemy.count = 2; card.conflict.enemy.power = 1;
    p.cargo.supplies.scrap = Math.floor((partyCapacity(st, p) - poolLoad(p) - 1) / 2); // about a kg of room left (scrap is 2 kg, sim/load.js)
    pick(card, /^Ambush the camp/).resolve(st);
    const after = st.cards.find((c) => c.title === "After the fight");
    if (!after || !st.parties.includes(p)) continue;
    if (/Taken from the bodies/.test(after.text)) paid++;
    if (/No room to carry/.test(after.text)) left++;
    if (poolLoad(p) > partyCapacity(st, p) + 1e-6 && partyMembers(st, p).length === 3) over++;
  }
  check(paid >= 20 && over === 0, `by the numbers the card pays (${paid} times) and never overfills the cargo (${over} over, ${left} guns left behind)`);
}

// 9. A team is never left halted: failed payments, the trade queue, the hourly check (C-7).
{
  console.log("Halted teams");
  const st = world();
  const f = groupOf(st, "raider");
  f.goodwill = -30;
  const p = team(st, 2);
  const card = triggerConflict(st, p, "roadblock", f.id);
  st.cards.length = 0;
  const pay = pick(card, /^Pay the toll/);
  check(!isOff(st, pay), "the toll is affordable when the card appears");
  p.supplies = { food: 1, water: 1, ammo: 0, meds: 0, scrap: 0 }; p.cargo.supplies = {};
  check(isOff(st, pay), "the choice greys out once the goods are gone");
  const text = pay.resolve(st);
  check(/no longer/.test(text) && engagedWith(st, p) === "card" && st.cards.some((c) => c.partyId === p.id && c.kind === "conflict"), "a failed payment brings the card back instead of stranding the team");

  // Two trade teams arriving in the same hour.
  const st2 = world(seed + 1);
  const g = groupOf(st2, "traders");
  g.goodwill = 40;
  const a = team(st2, 1, 5), b = team(st2, 1, 6);
  for (const q of [a, b]) { q.path = [g.bases[0]]; q.idx = 0; q.dest = g.bases[0]; giveOrder(st2, q, "trade"); }
  check(st2.trade && st2.trade.partyId === a.id && tradePending(st2, b.id) && b.phase === "engaged", "the second visit waits behind the first");
  endTrade(st2);
  check(a.phase === "waiting" && st2.trade && st2.trade.partyId === b.id, "leaving opens the trade screen for the team that waited");
  endTrade(st2);
  check(!st2.trade && b.phase === "waiting" && !(st2.tradeQueue || []).length, "and then the queue is empty");

  // Halted with nothing to resolve it (also out of radio range): the team checks in.
  const st3 = world(seed + 2);
  const lost = team(st3, 2, 6);
  st3.cards.length = 0;
  lost.phase = "engaged"; lost.conflictResume = "out"; lost.radioLive = false;
  for (let i = 0; i < 3; i++) { tickHour(st3); st3.cards = st3.cards.filter((c) => c.partyId === lost.id); }
  check(lost.phase === "waiting" && st3.cards.some((c) => c.partyId === lost.id && c.isOrders), "a halted team with no card, battle, search or trade gets an orders card within two hours");
  const busy = team(st3, 2, 5);
  const hold = triggerConflict(st3, busy, "roadblock", groupOf(st3, "raider").id);
  for (let i = 0; i < 4; i++) tickHour(st3);
  check(busy.phase === "engaged" && st3.cards.includes(hold), "a team with its card still open is left alone");
}

// 10. A collapsed group leaves nothing behind (C-18).
{
  console.log("Collapse");
  const st = world();
  const f = st.factions.find((x) => x.alive), other = st.factions.find((x) => x.alive && x !== f);
  recomputeOwnership(st);
  const owned = st.tiles.filter((t) => t.owner === f.id).length;
  spawnAiParty(st, f, "convoy", f.bases[0], other.bases[0], { strength: 3, targetFaction: other.id });
  spawnAiParty(st, f, "raid", f.bases[0], hub(st).tile, { strength: 9, target: { kind: "player", baseId: hub(st).id, tile: hub(st).tile } });
  hub(st).alert = true;
  f.pact = "nonaggression";
  collapseFaction(st, f);
  check(owned > 0 && st.tiles.every((t) => t.owner !== f.id), `its ${owned} tiles are free at once`);
  check(!st.parties.some((q) => q.owner === f.id), "its convoys and raids are gone");
  check(hub(st).alert === false && f.pact === null, "the base stands down and the pact is void");
}

// 11. Pacts and the raid threshold (C-22).
{
  console.log("Pacts");
  const st = world();
  const f = groupOf(st, "raider");
  f.known = true; f.goodwill = -10; f.pact = "nonaggression";
  changeGoodwill(st, f, -25, "test");
  check(attitude(f) === "Neutral" && f.pact === "nonaggression", "a neutral group keeps its pact");
  changeGoodwill(st, f, -20, "test");
  check(attitude(f) === "Hostile" && f.pact === null && st.log.some((l) => /torn up your non-aggression pact/.test(l.text)), "a hostile group tears it up, with a log line");
  // Groups just short of hostile (-35) do not raid you.
  const st2 = world(seed + 3);
  let raidsOnYou = 0;
  for (let d = 0; d < 150; d++) {
    for (const g of st2.factions) { if (!g.alive) continue; g.goodwill = -35; g.raidCooldown = 0; g.pop = Math.max(g.pop, 20); g.lastDiplomacy = 1e9; }
    factionsDaily(st2);
    raidsOnYou += st2.parties.filter((q) => q.kind === "raid" && q.target && q.target.kind === "player").length;
    st2.parties = st2.parties.filter((q) => q.owner === "player");
    st2.cards.length = 0;
  }
  check(raidsOnYou === 0, `neutral groups at goodwill -35 never raid you (${raidsOnYou} raids in 150 days)`);
}

// 12. Card amounts are worked out when the choice is made; unknown groups are not named (C-23), alerts end (C-5).
{
  console.log("Raid warning and help call");
  const st = world();
  const h = hub(st);
  const f = groupOf(st, "raider");
  f.goodwill = -80; f.known = false;
  Object.assign(h.stock, { ammo: 100 }); setFood(h, 100);
  const raid = spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength: 12, target: { kind: "player", baseId: h.id, tile: h.tile } });
  if (check(!!raid, "a raid can be sent at the hub")) {
    raidWarning(st, raid);
    const card = st.cards.pop();
    const force = raidForce(f, raid.strength);
    check(card.text.includes(`about ${force.count} ${f.name} fighter`), `the warning gives the number of attackers (${force.count})`);
    const prep = pick(card, /^Prepare defenses/);
    const def = baseDefense(st, h);
    h.alert = true; const ready = baseDefense(st, h); h.alert = false;
    check(prep.hint.includes(`Defense ${Math.round(def)} → ${Math.round(ready)}`) && /1\.3×/.test(prep.hint) && !/\+30%/.test(prep.hint), "\"Prepare defenses\" shows its real effect");
    const pay = pick(card, /^Pay tribute/);
    setFood(h, 5); setRounds(h.stock, 10); // ammo.js: rounds by calibre
    check(isOff(st, pay), "tribute is refused when the ammo is gone");
    pay.resolve(st);
    check(Math.abs(food(h) - 5) < 1e-6 && totalRounds(h.stock) === 10 && !raid.returning, "choosing it anyway takes nothing");
    setFood(h, 5); setRounds(h.stock, 35);
    h.alert = true;
    const said = pay.resolve(st);
    check(Math.abs(food(h) - 3) < 1e-6 && totalRounds(h.stock) === 5 && raid.returning === true && /\(\d+(\.\d+)? [a-z ]+, \d+ [^)]*(FMJ|buckshot)[^)]*\)/.test(said) && !/30 ammo/.test(said), `tribute is 30% of the food on hand when paid (food ${food(h)}, ammo ${totalRounds(h.stock)}: ${said})`);
    check(h.alert === false, "the base stands down when the raid is bought off");
  }
  h.alert = true;
  st.parties = st.parties.filter((q) => q.owner === "player");
  factionsDaily(st);
  check(h.alert === false, "\"Prepare defenses\" ends when no raid is coming any more");

  // Seen only when it reached the walls (the warning comes on arrival): tribute paid then still ends the raid.
  {
    const s3 = world(seed + 77);
    const h3 = hub(s3);
    const f3 = groupOf(s3, "raider");
    f3.goodwill = -80; f3.raidCooldown = 99;
    Object.assign(h3.stock, { ammo: 100, scrap: 100 }); setFood(h3, 100);
    // Nobody out scavenging: base scavenging turns up scrap most days now (WORLD-01, 1.5 supplies a day), and the
    // scrap is what shows the raid took nothing.
    for (const s of atBase(s3, h3.id)) if (s.role === "scavenge") s.role = "guard";
    const r3 = spawnAiParty(s3, f3, "raid", f3.bases[0], h3.tile, { strength: 300, target: { kind: "player", baseId: h3.id, tile: h3.tile } });
    if (check(!!r3, "a raid can be sent at the hub (tribute at the walls)")) {
      r3.path = [h3.tile]; r3.idx = 0; r3.phase = "siege"; r3.siegeLeft = 8; r3.warned = true;
      raidWarning(s3, r3);
      pick(s3.cards.pop(), /^Pay tribute/).resolve(s3);
      const seen = new Set(s3.log);
      for (let k = 0; k < 12; k++) { s3.cards.length = 0; tickHour(s3); }
      const hit = s3.log.some((l) => l.text.startsWith(`${f3.name} overran`) || l.text.startsWith(`${f3.name} broke into`) || l.text.includes(`drove off the ${f3.name} raid`));
      // The hub's own scavengers still bring scrap home meanwhile (economy.js scavCredit: "Kenji turned up 4 scrap
      // around ..."): counted out, the store is untouched (a break-in would have carried some off).
      const found = s3.log.filter((l) => !seen.has(l) && l.text.includes(`around ${h3.name}.`)).reduce((a, l) => a + Number((/turned up (?:[^.]*?, )?(\d+) scrap/.exec(l.text) || [0, 0])[1]), 0);
      check(!s3.parties.includes(r3) && !hit && h3.stock.scrap - found === 100, `tribute paid at the walls ends the raid: no break-in afterwards (scrap ${h3.stock.scrap}, ${found} of it found by the hub's scavengers)`);
    }
  }
  // A war raid beaten off in person counts for your side of the war, like one held by the numbers.
  {
    const s4 = world(seed + 78);
    const h4 = hub(s4);
    const a = groupOf(s4, "raider"), b = s4.factions.find((x) => x.alive && x !== a);
    a.goodwill = -80;
    const w = startWar(s4, a, b, "land");
    w.playerSide = b.id;
    const r4 = spawnAiParty(s4, a, "raid", a.bases[0], h4.tile, { strength: 1, target: { kind: "player", baseId: h4.id, tile: h4.tile } });
    if (check(!!r4, "a war raid can be sent at the hub")) {
      r4.warId = w.id;
      h4.alert = true;
      s4.cards.length = 0;
      defendInPerson(s4, r4);
      const won = s4.cards.some((c) => c.title === "Raid defense" && /beat off/.test(c.text));
      check(!won || (w.score[b.id] || 0) === 2, `a war raid beaten in person scores 2 for your side (score ${w.score[b.id] || 0}, won ${won})`);
      check(won, "a strength-1 war raid is beaten in person");
    }
  }

  const target = groupOf(st, "commune"), attacker = st.factions.find((x) => x.alive && x !== target);
  target.known = false; attacker.known = false; target.goodwill = 30; target.pop = 20;
  const siege = { id: 777001, owner: attacker.id, kind: "raid", path: [target.bases[0]], idx: 0, strength: 5, target: { kind: "faction", factionId: target.id, tile: target.bases[0] }, phase: "siege", siegeLeft: 10, helpCall: { radio: true, arrivesAt: 0 } };
  st.parties.push(siege);
  st.cards.length = 0;
  deliverHelpCall(st, siege);
  const help = st.cards.pop();
  check(!help.text.includes(attacker.name), "a call for help does not name an attacker you have not met");
  const send = pick(help, /^Send 40 rounds/); // named by calibre (ammo.js payWord)
  setRounds(h.stock, 10); // ammo.js: rounds by calibre
  check(isOff(st, send), "\"Send 40 ammo\" is off without the ammo");
  send.resolve(st);
  check(totalRounds(h.stock) === 10, "and choosing it anyway never drives the stock negative");
  // Fights between groups you have not met, seen from afar: nobody is named.
  target.known = false;
  st.live.add(target.bases[0]);
  const before = st.log.length;
  resolveRaidOnFaction(st, { strength: 500, owner: attacker.id, target: { factionId: target.id, tile: target.bases[0] } }, []);
  const lines = st.log.slice(0, st.log.length - before).map((l) => l.text);
  check(lines.length > 0 && lines.every((t) => !t.includes(attacker.name) && !t.includes(target.name)), `unknown groups are not named in the log ("${lines[0] || ""}")`);
}

// 13. Raids: the downed are carried out when someone extracts (P-1); raid handler registered at load.
{
  console.log("Raids");
  const raid = (i, prep, handler = "ft") => {
    const st = world(seed * 100 + i, 7);
    const h = hub(st);
    const crew = atBase(st, h.id).slice(0, 3).map((x) => x.id);
    // The nearest site a team can walk to.
    const sites = st.tiles.filter((t) => t.loc && t.id !== h.tile && !st.factions.some((g) => g.bases.includes(t.id)) && planPath(st, h.tile, t.id, false))
      .sort((a, c) => st.grid.distance(a.id, h.tile) - st.grid.distance(c.id, h.tile));
    const tile = sites[0];
    const res = launchExpedition(st, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 40, meds: 3 } });
    if (res.error) throw new Error(res.error);
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler, enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile.id) }, raid: { heat0: 5 }, context: {} };
    const b = (st.combat = createBattle(st, setup));
    const units = b.units.filter((u) => u.side === "player");
    const z = b.raid.zones[0];
    // Everyone stands in the entry zone; the first one goes down.
    const cells = [];
    for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) if (b.cells[y * b.w + x].k === "open") cells.push([x, y]);
    units.forEach((u, k) => { u.x = cells[k][0]; u.y = cells[k][1]; });
    const down = units[0];
    down.hp = 0; down.down = true; down.bleed = 3;
    prep(st, b, units, down);
    return { st, b, p, units, down, s: survivorById(st, down.sid) };
  };
  const extractAll = (st, b, units) => { for (const u of units) if (active(u)) check(combatAct(st, { type: "extract", unit: u.id }) === "", "a unit in the zone extracts"); };

  // Stabilized, then the others leave.
  const A = raid(1, (st, b, units, down) => {
    check(combatAct(st, { type: "meds", unit: units[1].id, target: down.id }) === "", "a teammate stabilizes the downed");
    check(/carried out if a teammate extracts/.test(b.log[b.log.length - 1].text) && !/hold the field/.test(b.log[b.log.length - 1].text), "the raid log says what stabilizing does in a raid");
    extractAll(st, b, units);
  });
  check(A.b.over && A.b.result.outcome === "extracted" && A.s.alive && A.s.health >= 4 && A.s.health <= 16, `stabilized and carried out alive at 5–15 health (${A.s.alive ? Math.round(A.s.health) : "dead"})`);
  check((A.b.result.raid.carriedIds || []).includes(A.s.id) && A.b.summary.some((l) => /carried out/.test(l)), "the result says who was carried");
  // Nobody gets out: the stabilized one is lost too.
  const B = raid(2, (st, b, units, down) => {
    down.stab = true;
    for (const u of units.slice(1)) { u.hp = 0; u.down = true; u.bleed = 3; }
    combatAct(st, { type: "end" });
    runEnemyPhase(st);
  });
  check(B.b.over && B.b.result.outcome === "defeat" && !B.s.alive, "with nobody out, nobody is carried");
  // Not stabilized: a roll, like the downed of a lost battle (35% against the living).
  let lived = 0, n = 0;
  for (let i = 0; i < 120; i++) {
    const C = raid(10 + i, (st, b, units) => extractAll(st, b, units));
    if (!C.b.over) continue;
    n++;
    if (C.s.alive) lived++;
  }
  check(n >= 100 && lived / n > 0.2 && lived / n < 0.5, `an unstabilized teammate is carried out alive about 35% of the time (${lived}/${n})`);
  // Through the real handler: the team gets its orders card once, after the hours the raid took.
  const D = raid(3, (st, b, units, down) => { down.stab = true; st.cards.length = 0; extractAll(st, b, units); }, "scavenge");
  closeCombat(D.st);
  check(D.p.phase === "waiting" && D.st.cards.filter((c) => c.partyId === D.p.id).length === 1, "the raid handler (registered at load) hands the team back with one orders card");
}

// 14. Defend in person: the raid's stated strength, and no second fight after a loss (P-4).
{
  console.log("Defend in person");
  const st = world();
  for (const type of ["raider", "expansionist", "zealot"]) {
    const f = groupOf(st, type);
    for (const strength of [4, 6, 9, 13, 26, 32]) {
      const fo = raidForce(f, strength);
      check(fo.count >= 1 && Math.abs(fo.count * fo.power - strength) <= 0.06 * fo.count, `${type} raid of ${strength}: ${fo.count} × ${fo.power}`);
    }
  }
  check(raidForce(groupOf(st, "raider"), 6).count === 1, "a strength-6 raid is one attacker, not three");
  let losses = 0;
  for (let i = 0; i < 12 && losses < 3; i++) {
    const s2 = world(seed + 300 + i);
    const h = hub(s2);
    const f = groupOf(s2, "raider");
    f.goodwill = -80; f.pop = 40;
    Object.assign(h.stock, { scrap: 100, ammo: 100 }); setFood(h, 100);
    const raid = spawnAiParty(s2, f, "raid", f.bases[0], h.tile, { strength: 300, target: { kind: "player", baseId: h.id, tile: h.tile } });
    if (!raid) continue;
    raid.phase = "siege"; raid.siegeLeft = 8;
    h.alert = true;
    defendInPerson(s2, raid); // headless: resolved by the numbers through the same handler
    const card = s2.cards.find((c) => c.title === "Raid defense");
    if (!card || /beat off/.test(card.text)) continue;
    if (!s2.bases.includes(h)) continue; // they kept or burned the hub (conquest.js, tools/conquertest.js): not this check's case
    losses++;
    check(!s2.parties.includes(raid), "after a lost defence the raid is over (no second attack at full strength)");
    check(h.stock.scrap < 100 && h.alert === false, `the raiders took their share once (scrap ${h.stock.scrap})`);
    for (let k = 0; k < 10; k++) { s2.cards.length = 0; tickHour(s2); }
    const breakIns = s2.log.filter((l) => l.text.startsWith(`${f.name} overran`) || l.text.startsWith(`${f.name} broke into`)).length;
    check(breakIns === 1 && !s2.log.some((l) => /defending|was overrun/.test(l.text)), `one break-in, and nobody hurt by a second raid by the numbers (${breakIns})`);
  }
  check(losses >= 1, `lost defences checked: ${losses}`);
}

// 15. Trade routes: terms follow barter prices, at set-up and at every exchange; no escort pauses the route (P-8, P-26).
{
  console.log("Trade routes");
  const st = world();
  const h = hub(st);
  const f = groupOf(st, "traders");
  f.goodwill = 40; f.known = true; f.pact = "trade";
  Object.assign(f.stock, { ammo: 300, meds: 500, scrap: 60 }); setFood(f, 100);
  const bad = { factionId: f.id, sendKey: "scrap", sendQty: 1, recvKey: "meds", recvQty: 400, interval: 2, escort: "light", escortIds: [] };
  check(routeProblem(st, bad) !== "" && !!createRoute(st, bad).error && st.routes.length === 0, `1 scrap for 400 meds is refused: "${routeProblem(st, bad)}"`);
  const fair = routeWorth(st, f, "food", 20, "ammo").maxRecv;
  check(fair >= 1 && routeProblem(st, { ...bad, sendKey: "food", sendQty: 20, recvKey: "ammo", recvQty: fair }) === "", `20 food buys up to ${fair} ammo`);
  check(routeProblem(st, { ...bad, sendKey: "food", sendQty: 20, recvKey: "ammo", recvQty: fair + 1 }) !== "", "one more than that is refused");
  check(routeProblem(st, { ...bad, sendKey: "food", sendQty: 20, recvKey: "food", recvQty: 5 }) !== "" && routeProblem(st, { ...bad, sendQty: 0, recvQty: 1 }) !== "", "same goods both ways, or nothing sent, is refused");
  f.pact = null;
  check(/trade pact/.test(routeProblem(st, { ...bad, sendKey: "food", sendQty: 20, recvKey: "ammo", recvQty: 1 })), "no route without a trade pact");
  f.pact = "trade";
  // An old or hand-made route with absurd terms pays only what the load is worth.
  const meds0 = f.stock.meds;
  const cheat = { id: 1, factionId: f.id, sendKey: "scrap", sendQty: 1, recvKey: "meds", recvQty: 400 };
  const convoy = { cargo: { supplies: { scrap: 1 }, gear: [] }, supplies: {} };
  const ex = routeExchange(st, convoy, cheat, f);
  const worth = routeWorth(st, { ...f, stock: { ...f.stock, scrap: f.stock.scrap - 1 } }, "scrap", 1, "meds").maxRecv;
  check(ex.give <= Math.max(worth, 1) && ex.give < 5 && meds0 - f.stock.meds === ex.give && (convoy.cargo.supplies.meds || 0) === ex.give, `the exchange is scaled to the load's worth (1 scrap → ${ex.give} meds, not 400)`);
  check(st.log.some((l) => /not the agreed 400/.test(l.text)), "and the log says why less came back");
  // A fair route delivers what was agreed.
  const okConvoy = { cargo: { supplies: { food: 20 }, gear: [] }, supplies: {} };
  const ex2 = routeExchange(st, okConvoy, { id: 2, factionId: f.id, sendKey: "food", sendQty: 20, recvKey: "ammo", recvQty: fair }, f);
  check(ex2.give === fair && okConvoy.cargo.supplies.ammo === fair && food(okConvoy.cargo) === 0, `a fair route pays in full (${ex2.give} ammo)`);

  // No escort left: the route pauses itself, once.
  const escort = atBase(st, h.id)[1];
  const made = createRoute(st, { factionId: f.id, sendKey: "food", sendQty: 10, recvKey: "ammo", recvQty: 1, interval: 2, escort: "light", escortIds: [escort.id] });
  if (check(!!made.route && escort.location.kind === "route", "a route with fair terms is set up")) {
    killSurvivor(st, escort, h.tile, "in a test");
    setFood(h, 200);
    for (let d = 0; d < 6; d++) { st.hour += 24; routesDaily(st); }
    const said = st.log.filter((l) => /no escort left/.test(l.text)).length;
    check(made.route.active === false && said === 1, `a route with no escort pauses itself with one log line (${said})`);
  }
}

// 16. Handlers are there from the start: a conflict battle opened directly still gets its aftermath.
{
  console.log("Handlers at load");
  const st = world();
  const f = groupOf(st, "raider");
  f.goodwill = -80;
  const p = team(st, 3);
  const card = triggerConflict(st, p, "roadblock", f.id);
  st.cards.length = 0;
  const c = card.conflict;
  startCombat(st, { tile: partyTile(p), partyId: p.id, enemy: { ...c.enemy }, ambush: null, canRetreat: true, handler: "conflict", context: { ...c, lead: "", goodwillHit: 0, resumePhase: "out" } });
  const out = st.stats.conflicts.outcomes;
  check(Object.keys(out).some((k) => k.startsWith("combat-")), "the conflict handler ran without any card having started a fight first");
  check(!st.parties.includes(p) || engagedWith(st, p) === "card" || p.phase !== "engaged", "and the team is not left halted");
}

// 17. Raids on you (factions.js RAIDS) and the damage they do (breakdowns.js raidDamage); groups that grow.
{
  console.log("Raids: size, escalation, siege, damage, tribute, growth");
  const st = world(seed + 400);
  const h = hub(st);
  const f = groupOf(st, "raider");
  f.goodwill = -80; f.pop = 40; f.known = true;
  h.alert = true; const prep = baseDefense(st, h); h.alert = false;
  const sizes = Array.from({ length: 40 }, () => raidSize(st, f, h));
  const cap = strength(f) * RAIDS.CAP;
  check(sizes.every((s) => s <= cap + 1e-9 && (s >= Math.min(cap, prep * RAIDS.SIZE[0]) - 1e-9) && s <= prep * RAIDS.SIZE[1] + 1e-9),
    `a raid is sized to the prepared defence ${prep.toFixed(0)} (0.6–1.0×) and never above the whole group (${Math.min(...sizes).toFixed(1)}–${Math.max(...sizes).toFixed(1)}, cap ${cap.toFixed(0)})`);
  const small = { ...f, pop: 4 };
  check(raidSize(st, small, h) <= Math.max(RAIDS.MIN, strength(small) * RAIDS.CAP) + 1e-9, "a small group's raid is capped by its own strength");
  // Escalation: each raid beaten makes the next 25% bigger, up to 2×; a raid that gets in resets it.
  raidRepelled(st, f);
  check(Math.abs(f.raidEsc - 1.25) < 1e-9 && f.grudge >= 1, `one raid beaten: next raid ×${f.raidEsc}, grudge ${f.grudge}`);
  for (let i = 0; i < 6; i++) raidRepelled(st, f);
  check(f.raidEsc === RAIDS.ESC_MAX, `escalation stops at ×${RAIDS.ESC_MAX} (${f.raidEsc})`);
  // Siege pace: a strong defence ends a siege up to 4× sooner, a weak one takes the full 8 hours.
  check(siegePace(st, h, 1) === RAIDS.PACE_MAX && siegePace(st, h, baseDefense(st, h) * 5) === 1, "siege pace: 4 hours an hour against a tiny raid, 1 against a strong one");
  // A raid that broke in: stock taken, buildings wrecked, a card with the bill; escalation reset, recruits won.
  for (const t of ["walls", "walls", "gate", "barricades", "bunkhouse", "ammo_bench", "cistern"]) addBuilding(h, t);
  Object.assign(h.stock, { ammo: 200, scrap: 100, parts: 10 }); setFood(h, 200);
  const pop0 = f.pop;
  const r1 = spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength: baseDefense(st, h) / 0.9, target: { kind: "player", baseId: h.id, tile: h.tile } });
  if (check(!!r1, "a raid can be sent at the hub (break-in)")) {
    r1.siegeHours = 8;
    st.cards.length = 0;
    const res = resolveRaidOnPlayer(st, r1);
    const card = st.cards.find((c) => /^Raid on /.test(c.title));
    check(res.outcome === "broken" && f.raidEsc === 1 && f.pop > pop0 - 1, `a break-in resets the escalation and wins them recruits (esc ${f.raidEsc}, people ${pop0} → ${f.pop})`);
    check(res.dmg.broken.length >= 1 && card && /wrecked \(repair: /.test(card.text) && /They took/.test(card.text), `the result card says what was taken and wrecked: "${card ? card.text.slice(0, 220) : "no card"}"`);
    check(card && /^Start the repairs/.test(card.choices[0].label), "and offers to start the repairs");
    const brokenNow = h.buildings.filter((b) => b.broken).length;
    card.choices[0].resolve(st);
    check((h.repairs || []).length >= Math.min(1, brokenNow), `"Start the repairs" starts them (${(h.repairs || []).length} jobs for ${brokenNow} broken)`);
    check(h.lastRaid === res.dmg && /Damage:/.test(st.log.find((l) => l.text.startsWith(`${h.name}: Damage`))?.text || ""), "the log and the Repairs tab (base.lastRaid) keep the damage");
  }
  // Damage scales with strength, hours and outcome; the walls and defences take it first.
  {
    const total = (s2, outcome, str, hours) => {
      const b = hub(s2);
      for (const t of ["walls", "walls", "gate", "barricades", "bunkhouse", "ammo_bench", "cistern", "common_room"]) addBuilding(b, t);
      return raidDamage(s2, b, { strength: str, hours, outcome });
    };
    const quick = total(world(seed + 401), "held", 30, 2), long = total(world(seed + 401), "held", 30, 8);
    const brk = total(world(seed + 401), "broken", 40, 8), over = total(world(seed + 401), "overrun", 40, 8);
    check(quick.budget < long.budget && long.budget < brk.budget && brk.budget < over.budget, `budget: quick ${quick.budget} < long ${long.budget} < break-in ${brk.budget} < overrun ${over.budget}`);
    check(quick.broken.length === 0, `driven off in 2 hours: ${quick.text}`);
    check(over.broken.length + (over.destroyed ? 1 : 0) >= 2, `overrun: ${over.text}`);
    const s5 = world(seed + 402), b5 = hub(s5);
    for (const t of ["walls", "walls", "gate", "barricades", "bunkhouse", "ammo_bench", "cistern", "common_room"]) addBuilding(b5, t);
    const inner0 = b5.buildings.filter((b) => !["walls", "gate", "barricades"].includes(b.type)).reduce((a, b) => a + (b.wear || 0), 0);
    raidDamage(s5, b5, { strength: 40, hours: 8, outcome: "held" });
    const outerW = b5.buildings.filter((b) => ["walls", "gate", "barricades"].includes(b.type)).reduce((a, b) => a + (b.wear || 0), 0);
    const innerW = b5.buildings.filter((b) => !["walls", "gate", "barricades"].includes(b.type)).reduce((a, b) => a + (b.wear || 0), 0) - inner0;
    check(outerW > innerW, `a raid driven off hits the defences first (outer ${outerW.toFixed(0)}, inner ${innerW.toFixed(0)})`);
    // Damaged and broken buildings work worse or not at all.
    const wall = b5.buildings.find((b) => b.type === "walls");
    wall.broken = null; wall.wear = 10;
    const w0 = baseWalls(b5);
    wall.wear = 70;
    check(Math.abs(baseWalls(b5) - w0 * 2 / 3) < 0.1, `a damaged wall gives two thirds of its wall strength (buildings.js WALL_DAMAGED: ${w0} → ${baseWalls(b5)})`);
    const bunk = b5.buildings.find((b) => b.type === "bunkhouse");
    bunk.broken = null;
    const beds0 = baseBeds(b5);
    bunk.broken = { day: 1, cause: "test" };
    check(baseBeds(b5) === beds0 - 6, `a wrecked bunkhouse gives no beds (${beds0} → ${baseBeds(b5)})`);
    check(repairPlan(s5, b5, wall, "repair").ok || /Needs/.test(repairPlan(s5, b5, wall, "repair").why), "a damaged (unbroken) wall can be patched with a proper repair");
    // Nobody builds or repairs while the base is on alert.
    b5.stock.scrap = 200;
    queueBuild(s5, b5, "smoker");
    const job = b5.construction[0];
    b5.alert = true;
    constructionHour(s5);
    const p0 = job.progress;
    b5.alert = false;
    constructionHour(s5);
    check(p0 === 0 && job.progress > 0, `construction stops on alert (${p0}) and goes on after (${job.progress.toFixed(1)})`);
  }
  // Tribute: +6 goodwill, which fades again at 0.5 a day for an aggressive group.
  {
    const s6 = world(seed + 403), h6 = hub(s6), g = groupOf(s6, "raider");
    g.goodwill = -60; g.raidCooldown = 999; g.pop = 30;
    Object.assign(h6.stock, { ammo: 100 }); setFood(h6, 100);
    const r6 = spawnAiParty(s6, g, "raid", g.bases[0], h6.tile, { strength: 20, target: { kind: "player", baseId: h6.id, tile: h6.tile } });
    if (check(!!r6, "a raid can be sent (tribute)")) {
      raidWarning(s6, r6);
      pick(s6.cards.pop(), /^Pay tribute/).resolve(s6);
      check(g.goodwill === -54 && g.boughtGw === 6, `tribute: goodwill ${g.goodwill}, bought ${g.boughtGw}`);
      s6.parties = s6.parties.filter((q) => q.owner === "player");
      for (let d = 0; d < 14; d++) { factionsDaily(s6); s6.parties = s6.parties.filter((q) => q.owner === "player"); s6.cards.length = 0; }
      check(Math.abs(g.goodwill + 60) < 1e-6 && g.boughtGw === 0, `after 12 days it is gone again (goodwill ${g.goodwill.toFixed(2)})`);
    }
  }
  // A peaceful group you provoked into hostility raids you now and then, and only you.
  {
    const s7 = world(seed + 404);
    const m = groupOf(s7, "military");
    let onYou = 0, onGroups = 0;
    for (let d = 0; d < 200; d++) {
      m.goodwill = -80; m.pop = Math.max(m.pop, 20);
      for (const o of s7.factions) if (o !== m) o.raidCooldown = 999;
      factionsDaily(s7);
      onYou += s7.parties.filter((q) => q.kind === "raid" && q.owner === m.id && q.target.kind === "player").length;
      onGroups += s7.parties.filter((q) => q.kind === "raid" && q.owner === m.id && q.target.kind === "faction").length;
      s7.parties = s7.parties.filter((q) => q.owner === "player");
      s7.cards.length = 0;
    }
    check(onYou >= 1 && onGroups === 0, `a hostile military remnant raided you ${onYou} times in 200 days, other groups ${onGroups}`);
  }
  // Winners take the land: a collapse hands bases and people to the group that broke them.
  {
    const s8 = world(seed + 405);
    const a = groupOf(s8, "raider");
    const b = s8.factions.find((x) => x.alive && x !== a);
    a.pop = 40; a.bases = a.bases.slice(0, 1); b.bases = b.bases.slice(0, 1);
    const extra = s8.tiles.find((t) => t.loc && t.owner == null && s8.factions.every((o) => !o.bases.includes(t.id)) && !s8.bases.some((pb) => pb.tile === t.id));
    b.bases.push(extra.id);
    const pop0 = a.pop, n0 = a.bases.length;
    collapseFaction(s8, b, a);
    check(a.bases.length === n0 + 2 && a.pop >= pop0 + 2 && maxBases(a) === 6, `${a.name} took ${a.bases.length - n0} bases and ${a.pop - pop0} people from the group it broke (cap ${maxBases(a)})`);
  }
  // With fewer than two aggressive groups left, a new gang moves in.
  {
    const s9 = world(seed + 406);
    for (const g of s9.factions) if (FACTION_TYPES[g.type].attitude === "Aggressive") { g.alive = false; g.bases = []; }
    const n0 = s9.factions.length;
    s9.hour = 24 * 70;
    for (let d = 0; d < 400 && s9.factions.length === n0; d++) { s9.hour += 24; factionsDaily(s9); s9.parties = s9.parties.filter((q) => q.owner === "player"); s9.cards.length = 0; }
    const g = s9.factions[s9.factions.length - 1];
    const dist = g.bases.length ? s9.grid.distance(g.bases[0], hub(s9).tile) : -1;
    check(s9.factions.length === n0 + 1 && g.alive && attitude(g) === "Hostile" && dist >= 12 && dist <= 30, `a new gang settled (${g.name}, ${g.type}, ${g.pop} people, ${dist} tiles from the hub)`);
  }
}

// 18. Guns use ammo, bows use arrows by the numbers (world.js usesArrows / armedFactor / spendShots, combat.js
// autoResolveCombat, breakoff.js): up to 6 shots a head, the bows' in arrows; about half picked up after a win.
{
  console.log("Bows and arrows by the numbers");
  const st = world();
  const p = team(st, 3); // three hunting rifles
  const ms = partyMembers(st, p);
  ms[0].gear.weapon = newItem("compbow"); ms[1].gear.weapon = newItem("xbow");
  check(usesArrows(ms[0]) && usesArrows(ms[1]) && !usesArrows(ms[2]), "a compound bow and a hunting crossbow shoot arrows, a rifle does not");
  const weak = { kind: "zombies", count: 1, power: 1 };
  let r = null;
  for (let i = 0; i < 12 && (!r || r.outcome !== "victory"); i++) {
    setRounds(p.supplies, 30, ["huntrifle"]); p.supplies.arrows = 30; setRounds(p.cargo.supplies, 0); p.cargo.supplies.arrows = 0; // ammo.js: the rifle's rounds
    for (const m of ms) m.health = 100;
    r = autoResolveCombat(st, { tile: partyTile(p), partyId: p.id, enemy: weak, handler: "ft", context: {} });
  }
  check(r.outcome === "victory" && r.ammoUsed === 6 && r.arrowsUsed === 12, `two bows and a rifle shoot 12 arrows and 6 rounds (${r.outcome}: ammo ${r.ammoUsed}, arrows ${r.arrowsUsed})`);
  check(r.arrowsBack === Math.round(12 * ARROWS.BACK) && p.supplies.arrows === 30 - 12 + r.arrowsBack && totalRounds(p.supplies) === 24, `after the win ${r.arrowsBack} arrows are picked up again (packed ${p.supplies.arrows}, ammo ${totalRounds(p.supplies)})`);
  // Lost or broken off: none picked up (rounds not fired come back, arrows too).
  let lost = 0;
  for (let i = 0; i < 12 && lost < 3; i++) {
    for (const m of ms) m.health = 100;
    p.supplies.ammo = 30; p.supplies.arrows = 30;
    const q = autoResolveCombat(st, { tile: partyTile(p), partyId: p.id, enemy: { kind: "raiders", count: 10, power: 9 }, handler: "ft", context: {} });
    if (q.outcome === "victory") continue;
    lost++;
    check(!q.arrowsBack && p.supplies.arrows === 30 - q.arrowsUsed && q.arrowsUsed <= 12, `after a ${q.outcome} no arrows are picked up (${q.arrowsUsed} shot, ${p.supplies.arrows} left)`);
    if (ms.some((m) => !m.alive)) break;
  }
  check(lost >= 1, `lost fights checked: ${lost}`);
  // Short of arrows the bows fight at 60% (under 3 a head), as the guns short of ammo; a team with no bow ignores arrows.
  const st2 = world(seed + 1);
  const p2 = team(st2, 3);
  const m2 = partyMembers(st2, p2);
  const enemy = { kind: "raiders", count: 3, power: 5, name: "test raiders" };
  p2.supplies.ammo = 60; p2.supplies.arrows = 0;
  const guns = fightOdds(st2, p2, enemy, null);
  p2.supplies.arrows = 60;
  check(Math.abs(guns - fightOdds(st2, p2, enemy, null)) < 1e-12, "a team with no bow: arrows change nothing");
  m2[0].gear.weapon = newItem("compbow"); m2[1].gear.weapon = newItem("compbow");
  p2.supplies.ammo = 60; p2.supplies.arrows = 60;
  const stocked = fightOdds(st2, p2, enemy, null);
  p2.supplies.arrows = 0;
  const empty = fightOdds(st2, p2, enemy, null);
  p2.supplies.arrows = 60; p2.supplies.ammo = 0;
  const noAmmo = fightOdds(st2, p2, enemy, null);
  check(empty < stocked && noAmmo < stocked && noAmmo > empty, `bows without arrows fight worse (odds ${Math.round(stocked * 100)}% → ${Math.round(empty * 100)}% with no arrows, ${Math.round(noAmmo * 100)}% with no ammo for the one rifle)`);
  check(armedFactor(m2, 0, 60) > 0.6 && armedFactor(m2, 0, 60) < 1 && armedFactor(m2, 60, 60) === 1 && Math.abs(armedFactor(m2, 0, 0) - 0.6) < 1e-12, "armedFactor weighs the bows and the guns by their power");
  // Shots from a stock: 3 a head, the bows' in arrows (a raid or a horde at your walls).
  const stock = { ammo: 10, arrows: 10 };
  const shot = spendShots(stock, m2, 3);
  check(shot.ammo === 3 && shot.arrows === 6 && stock.ammo === 7 && stock.arrows === 4, `three a head from a stock: ${shot.ammo} rounds, ${shot.arrows} arrows`);
  p2.supplies.ammo = 20; p2.supplies.arrows = 20; p2.cargo.supplies.arrows = 5;
  const ts = takeShots(p2, m2, 9);
  check(ts.ammo === 3 && ts.arrows === 6 && p2.cargo.supplies.arrows === 0 && p2.supplies.arrows === 19, `a team's 9 shots: ${ts.ammo} rounds, ${ts.arrows} arrows (found ones first)`);
  // Defending a base: the bows count by the base's arrows.
  const h = hub(st2);
  const home = atBase(st2, h.id);
  h.stock.ammo = 500; h.stock.arrows = 0;
  const d0 = baseDefense(st2, h);
  h.stock.arrows = 500;
  check(baseDefense(st2, h) === d0, "a base without bows: its arrows change nothing");
  home[0].gear.weapon = newItem("compbow"); home[0].skills.shooting = 9;
  const withArrows = baseDefense(st2, h);
  h.stock.arrows = 0;
  check(baseDefense(st2, h) < withArrows, `a base's bows defend worse without arrows (${baseDefense(st2, h).toFixed(1)} < ${withArrows.toFixed(1)})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
