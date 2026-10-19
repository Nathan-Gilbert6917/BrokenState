// Group arsenals and AI parity (sim/arsenal.js, sim/groupcare.js, sim/groupworld.js): every group fights with what it
// has gathered, and looks after itself with the systems you use.
// Usage: node tools/arsenaltest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, day, hub, atBase, killSurvivor, makeSurvivor } from "../src/sim/world.js";
import { FACTION_TYPES, GEAR } from "../src/sim/data.js";
import { strength, factionsDaily, resolveRaidOnPlayer, collapseFaction, resolveRaidOnFaction } from "../src/sim/factions.js";
import { spawnAiParty } from "../src/sim/parties.js";
import { createBattle, endBattleNow, closeCombat } from "../src/sim/combat.js";
import { newItem, lootItem } from "../src/sim/inventory.js";
import { fitMod } from "../src/sim/gunmods.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { createVehicle, factionVehicles, upgradesOf, vehicleValue } from "../src/sim/vehicles.js";
import { addBuilding } from "../src/sim/buildings.js";
import { worksAt } from "../src/sim/groupworks.js";
import { itemDurMax } from "../src/sim/crafting.js";
import { newNeutralGroup, wanderersDaily, WANDER } from "../src/sim/wanderers.js";
import { Rng } from "../src/sim/rng.js";
import * as A from "../src/sim/arsenal.js";
import * as C from "../src/sim/groupcare.js";
import * as G from "../src/sim/groupworld.js";
import * as V from "../src/sim/vehicletrade.js";
import * as D from "../src/sim/diplomacy.js";
import { groupCapacity } from "../src/sim/escorts.js";
import { gangAmbush } from "../src/sim/caravanraids.js";
import { NL_TAKE } from "../src/sim/nonlethal.js";
import { wallGoal } from "../src/sim/groupworks.js";
import { sendCaravan } from "../src/sim/caravans.js";
import { openCaravanTrade, tradeContext, endTrade } from "../src/sim/trade.js";
import { openRadioTrade } from "../src/sim/radiotrade.js";
import { carRecord, claimCar } from "../src/sim/foundcars.js";
import { planPath } from "../src/sim/parties.js";

const seed = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; return st; };
const groupOf = (st, type) => st.factions.find((f) => f.alive && f.type === type) || null;
// A group of this type (one of the world's, retyped and reseeded if the world has none). Its vehicles go too: the
// new type's are dealt when next read (vehicles.js factionVehicles: a military group's motor pool, its M2 Humvee).
function typed(st, type, not = []) {
  let f = groupOf(st, type);
  if (!f || not.includes(f)) { f = st.factions.find((x) => x.alive && !not.includes(x)); f.type = type; delete f.vehicles; A.seedArsenal(st, f); }
  return f;
}
const nextDay = (st) => { st.hour += 24; };
const daily = (st, n = 1) => { for (let i = 0; i < n; i++) { nextDay(st); factionsDaily(st); st.cards.length = 0; } };

// ======================================================================================
section("Seeding by type, and the world's dice");
{
  const st = world();
  for (const f of st.factions) {
    const s = A.arsenalSummary(f);
    check(s.weapons >= f.pop && s.weapons <= Math.ceil(f.pop * 1.2) + 1, `${f.type} (${f.pop} people): a weapon a head and some spare (${s.weapons})`);
    check(f.arsenal.items.every((it) => it.aid && GEAR[it.key] && Number.isFinite(it.quality)), `${f.type}: real items, each with an id and a condition`);
  }
  const mil = typed(st, "military"), com = typed(st, "commune", [mil]), rai = typed(st, "raider", [mil, com]);
  const keys = (f) => f.arsenal.items.map((it) => it.key);
  check(keys(mil).includes("ar") && keys(mil).filter((k) => k === "vest" || k === "plate").length >= mil.pop * 0.9, "the military: assault rifles, and body armour for everyone");
  check(!A.arsenalSummary(com).body, "a commune: no body armour");
  check(keys(rai).includes("pipebomb") || keys(rai).includes("molotov"), "raiders: pipe bombs and Molotovs");
  check(mil.arsenal.items.some((it) => it.mods && Object.keys(it.mods).length), "some of the military's guns come with parts fitted");
  // Without arsenals the world comes out the same (they are hashed, never the world's dice).
  A.ARSENAL_SWITCH.off = true;
  const off = world();
  A.ARSENAL_SWITCH.off = false;
  const on = world();
  const strip = (s) => JSON.stringify(s.factions.map((f) => [f.name, f.type, f.pop, f.bases, f.goodwill, f.stock, f.raidCooldown, f.color]));
  check(off.rng.state === on.rng.state && strip(off) === strip(on) && JSON.stringify(off.tiles.map((t) => t.loot)) === JSON.stringify(on.tiles.map((t) => t.loot)), "no world-dice drift at day 0: the same world with and without arsenals");
  check(on.factions.every((f) => f.arsenal) && off.factions.every((f) => !f.arsenal), "arsenals seeded at creation (and none with the switch off)");
}

// ======================================================================================
section("By the numbers: strength follows the arsenal, close to the old numbers on day 0");
{
  let worst = 0;
  for (const s of [1, 2, 3, 4, 5, 6]) {
    const st = world(s);
    for (const f of st.factions) worst = Math.max(worst, Math.abs(strength(f) / (f.pop * FACTION_TYPES[f.type].arms) - 1));
  }
  check(worst < 0.12, `day 0: every group within 12% of its old strength (worst ${Math.round(worst * 100)}%)`);
  const st = world();
  const f = typed(st, "raider");
  // 20 of them with their starting kit dealt for 20: ten rifles arm half of them on every seed (the world's raiders
  // run 20-27, and among 27 the same ten rifles make them only 18% stronger).
  f.pop = 20; f.wounded = 0; A.seedArsenal(st, f);
  const s0 = strength(f);
  for (let i = 0; i < 10; i++) A.addToArsenal(st, f, lootItem("ar", "military", [i, "t"]), "test");
  const s1 = strength(f);
  check(s1 > s0 * 1.2, `ten assault rifles make the raiders stronger (${s0.toFixed(1)} → ${s1.toFixed(1)})`);
  const guns = f.arsenal.items.filter((it) => A.isWeaponKey(it.key));
  for (const it of guns) A.removeFromArsenal(f, it, "test");
  const s2 = strength(f);
  check(s2 < s0 * 0.75, `with no weapons left they are much weaker (${s2.toFixed(1)})`);
  for (let i = 0; i < f.pop; i++) A.addToArsenal(st, f, lootItem("pistol", "raider", [i, "p"]), "test");
  const ammo = f.stock.ammo;
  const s3 = strength(f);
  f.stock.ammo = 0;
  const s4 = strength(f);
  f.stock.ammo = ammo;
  check(s4 < s3 * 0.8 && s4 >= s3 * 0.65, `out of rounds, their guns count about 70% (${s3.toFixed(1)} → ${s4.toFixed(1)})`);
  f.wounded = Math.round(f.pop / 2);
  check(strength(f) < s3 * 0.6, `half of them wounded: the wounded do not fight (${strength(f).toFixed(1)})`);
  f.wounded = 0;
  const mil = typed(st, "military");
  check(A.arsenalText(st, mil).includes("M2 Humvee") || A.arsenalKnown(st, mil), `a rough read of the military: "${A.arsenalText(st, mil)}"`);
}

// ======================================================================================
section("Allocation: a home guard keeps a share");
{
  const st = world();
  const f = typed(st, "military");
  const all = A.issueKit(st, f, f.pop, "home"), field = A.issueKit(st, f, f.pop, "field");
  const best = all.map((lo) => lo.weapon);
  check(field[0].weapon === best[0], "the best gun goes out with a war party");
  check(!field.some((lo) => lo.weapon === best[1]), "the second best stays home with the guard");
  check(field.filter((lo) => lo.weapon).length <= Math.ceil(f.pop * 0.8) && field.filter((lo) => lo.weapon).length >= Math.floor(f.pop * 0.55), `a field party draws about two thirds of the kit (${field.filter((lo) => lo.weapon).length} of ${f.pop})`);
}

// ======================================================================================
section("Inflows: scavenging finds gear by the site");
{
  const st = world();
  const f = typed(st, "raider");
  const site = st.tiles.find((t) => t.loc && t.loc.type === "police") || st.tiles.find((t) => t.loc && t.loc.type === "military");
  const n0 = f.arsenal.items.length;
  let got = [];
  for (let i = 0; i < 6 && !got.length; i++) { st.hour += 5; got = A.scavFinds(st, f, { scav: { site: site.id, taken: 0.6 } }); }
  check(got.length > 0 && f.arsenal.items.length === n0 + got.length, `a party home from ${site.loc.name} adds ${got.map((x) => x.name).join(", ")}`);
  check(got.every((it) => (A.isWeaponKey(it.key) || A.isArmourKey(it.key) || A.isThrowKey(it.key)) && it.quality <= 1), "only fighting gear, with its condition by the site");
}

// ======================================================================================
section("A raid that gets in takes your gear, and you meet it again");
{
  const st = world();
  const h = hub(st);
  const f = typed(st, "raider");
  f.goodwill = -80;
  // A fine rifle with a scope in your armory.
  const rifle = newItem("ar", 1);
  rifle.name = "Assault rifle";
  fitMod(rifle, newItem("holo", 1));
  h.armory.push(rifle);
  const party = spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength: 400, target: { kind: "player", baseId: h.id, tile: h.tile } });
  const res = resolveRaidOnPlayer(st, party);
  check(res && (res.outcome === "overrun" || res.outcome === "taken" || res.outcome === "razed"), `the raid overran the hub (${res && res.outcome})`);
  check(f.arsenal.items.includes(rifle), "the rifle from your armory is in their arsenal now");
  // Your dead's gear: a defender killed during a raid that got in.
  const st2 = world(seed + 1), h2 = hub(st2), f2 = typed(st2, "raider");
  const s = atBase(st2, h2.id)[0];
  const gun = newItem("huntrifle", 0.9);
  s.gear.weapon = gun;
  const a0 = h2.armory.length;
  killSurvivor(st2, s, h2.tile, "in the raid");
  const moved = A.raidOnBase(st2, f2, h2, { strength: 30, id: 1 }, { outcome: "broken", theirDead: 1, armory0: a0 });
  check(moved.stole.includes(gun) && f2.arsenal.items.includes(gun), `your dead's ${gun.name} goes with them`);
  check(moved.dropped.length > 0 && moved.dropped.every((it) => h2.armory.includes(it)), "and their own dead's kit stays in your yard (the armory)");
  // A later fight with them: one of them carries that very rifle, parts and all.
  const b = createBattle(st, { tile: f.bases[0], baseId: hub(st) ? hub(st).id : null, partyId: null, fighterIds: null,
    enemy: { kind: "raiders", count: 4, power: 4, factionId: f.id, name: "test raiders" }, ambush: null, canRetreat: false, handler: "arsenaltest" });
  if (!hub(st) || !atBase(st, hub(st).id).length) { check(true, "(the hub was lost: battle part skipped)"); }
  else {
    const u = b.units.find((x) => x.arsItem === rifle);
    check(!!u, `a ${f.name} fighter carries the rifle they took (${u ? u.weaponName : "none"})`);
    check(u && u.weaponName.includes("(") && u.gm && u.gm !== A, "with its parts, as the battle line shows");
    st.combat = b;
    for (const x of b.units) if (x.side === "enemy") { x.dead = true; x.hp = 0; }
    endBattleNow(st, "victory");
    closeCombat(st);
    check(!f.arsenal.items.includes(rifle), "killed: the rifle leaves their arsenal");
    check(b.bodies.some((body) => body.gear && body.gear.weapon === rifle) || hub(st).armory.includes(rifle) || (b.result.loot.gear || []).includes(rifle), "and lies on the body for you to take back");
  }
}

// ======================================================================================
section("Losses, wear and the field");
{
  const st = world();
  const a = typed(st, "raider"), b = typed(st, "commune", [a]);
  const nb0 = b.arsenal.items.length, na0 = a.arsenal.items.length;
  A.clashKit(st, a, 6, 2, b, 4, "a", 0);
  check(b.arsenal.items.length < nb0, `the commune's dead lose their kit (${nb0} → ${b.arsenal.items.length})`);
  check(a.arsenal.items.length >= na0, `the raiders hold the field and pick some of it up (${na0} → ${a.arsenal.items.length})`);
  check(a.wounded > 0 && b.wounded > 0, "both sides have wounded");
  const issued = new Set(A.issueKit(st, a, 30, "raid").flatMap((lo) => [lo.weapon, ...Object.values(lo.armour), lo.launcher].filter(Boolean))); // (what the 30 carry: their guard keeps every third best piece at home)
  const it = a.arsenal.items.find((x) => GEAR[x.key].dur && issued.has(x));
  const d0 = it.dur;
  A.clashKit(st, a, 30, 0, null, 0, "a");
  check(it.dur < d0 || !a.arsenal.items.includes(it), "a fight wears the kit");
}

// ======================================================================================
section("Healing: meds and medics");
{
  const st = world();
  // The wounded who got well in n days (the dead do not count: without meds more of them die, which also empties the
  // ward). The group's day count moves on each day as factions.js moves it (tickGroup): the day's rolls hash it.
  const run = (type, meds, n = 5) => {
    const s2 = world(seed + 5);
    const f = typed(s2, type);
    f.pop = 30; setFood(f, 1000); f.stock.meds = meds; f.wounded = 12;
    const dead0 = f.diedOfWounds || 0;
    for (let i = 0; i < n; i++) { s2.hour += 24; C.tickGroup(f); C.groupCareDaily(s2, f); f.stock.meds = meds ? Math.max(f.stock.meds, meds) : 0; }
    return 12 - f.wounded - ((f.diedOfWounds || 0) - dead0);
  };
  const withMeds = run("commune", 100), noMeds = run("commune", 0);
  check(withMeds > noMeds, `the wounded heal faster with meds (${withMeds} of 12 well) than without (${noMeds}) in 5 days`);
  const f1 = typed(st, "commune"), f2 = typed(st, "raider", [f1]);
  for (const f of [f1, f2]) { f.pop = 30; f.wounded = 10; f.stock.meds = 0; }
  check(C.medicsOf(f1) > C.medicsOf(f2) && C.healRate(f1).rate > C.healRate(f2).rate, `a commune has more medics (${C.medicsOf(f1)} to ${C.medicsOf(f2)}) and heals faster`);
  check(C.healRate(f1).die > 0 && (f1.stock.meds = 100) && C.healRate(f1).die < 0.005, "without meds the wounded die more");
}

// ======================================================================================
section("Repairs at a workshop, with parts");
{
  const st = world();
  const f = typed(st, "fortress");
  st.groupWorks = st.groupWorks || {};
  worksAt(f, f.bases[0]).bench = 1;
  f.stock.parts = 10; f.stock.scrap = 50;
  const gun = f.arsenal.items.find((x) => x.key === "ar" || x.key === "huntrifle" || x.key === "carbine");
  // Everything else mended first: they mend the most valuable pieces first, and 10 parts on a fortress's other worn
  // guns would leave none for this one.
  for (const it of f.arsenal.items) if (itemDurMax(it) != null) it.dur = itemDurMax(it);
  gun.dur = Math.round(GEAR[gun.key].dur * 0.3);
  const max0 = gun.durMax || GEAR[gun.key].dur;
  // Four days in a row (a group mends every CARE.REPAIR.every days, on a day of its own: day(st) + i stepped by two and,
  // on a group whose turn is the odd days, never came round).
  for (let i = 0; i < 4; i++) { st.hour += 24; C.repairGear(st, f); }
  check(gun.dur > GEAR[gun.key].dur * 0.5, `their ${gun.name} is mended (${gun.dur} of ${gun.durMax})`);
  check(gun.durMax < max0 && f.stock.parts < 10, `and loses some of its maximum, as yours do (${max0} → ${gun.durMax}); parts spent (${10 - f.stock.parts})`);
  const plan = C.groupRepairPlan({ key: "plate", name: "Plate carrier", dur: 5, durMax: 50, quality: 1 }, 5);
  check(plan === null, "a ceramic plate carrier is not mended");
}

// ======================================================================================
section("Desertion and recruiting");
{
  const st = world();
  const hungry = typed(st, "raider"), fed = typed(st, "fortress", [hungry]);
  hungry.pop = 30; setFood(hungry, 0); hungry.lossRecent = 6;
  fed.pop = 30; setFood(fed, 1000);
  // The odds a day (desertDaily's CARE.DESERT.base × desertPressure, at most max) give the 60 days' deserters; 600 days
  // of the dice must follow them (60 days alone: about 4.4 and 0.7 expected, so one seed in five fell either side).
  const odds = (f) => Math.min(C.CARE.DESERT.max, C.CARE.DESERT.base * C.desertPressure(st, f));
  const DAYS = 600;
  let lostH = 0, lostF = 0, expH = 0, expF = 0;
  for (let i = 0; i < DAYS; i++) {
    setFood(hungry, 0); setFood(fed, 1000);
    expH += odds(hungry); expF += odds(fed);
    if (C.desertDaily(st, hungry, i)) lostH++;
    if (C.desertDaily(st, fed, i)) lostF++;
    C.tickGroup(hungry); C.tickGroup(fed);
    hungry.pop = Math.max(hungry.pop, 20);
    st.cards.length = 0;
  }
  const per60 = (x) => (x * 60) / DAYS;
  check(per60(expH) >= 2 && per60(expF) <= 1, `a starving group bleeds deserters (${per60(expH).toFixed(1)} in 60 days by the odds), a well-fed one rarely (${per60(expF).toFixed(1)})`);
  check(lostH >= expH / 2 && lostF <= expF * 2 + 3 && lostH > lostF * 2, `and the dice follow the odds: ${lostH} and ${lostF} deserters in ${DAYS} days (${expH.toFixed(1)} and ${expF.toFixed(1)} expected)`);
  // Everyone armed first: the deserter is one of their loadouts (issueKit) at random, and a raider gang may have fewer
  // guns than people (an unarmed one walks out with nothing).
  for (let i = hungry.arsenal.items.filter((it) => A.isWeaponKey(it.key)).length; i < hungry.pop; i++) A.addToArsenal(st, hungry, lootItem("pistol", "raider", [i, "dp"]), "test");
  const n0 = hungry.arsenal.items.length;
  const w = C.desertOne(st, hungry, 1, "wanderer");
  check(w.to === "wanderer" && w.kit.length > 0 && w.wanderer.people[0].gear.weapon === w.kit[0] && hungry.arsenal.items.length === n0 - w.kit.length, `a deserter on the road carries their own ${w.kit[0] && w.kit[0].name}`);
  const g = C.desertOne(st, hungry, 2, "group");
  check(g.to === "group" && g.kit.every((it) => g.group.arsenal.items.includes(it)), `one goes over to ${g.group && g.group.name}, kit and all`);
  const p = C.desertOne(st, hungry, 3, "player");
  check(p.to === "player" || !st.bases.some((b) => st.grid.distance(b.tile, hungry.bases[0]) <= C.CARE.DESERT.playerRange), "one comes to your gates (a recruit card) when a base of yours is near");
  // Wanderers near a commune's base join it.
  const s2 = world(seed + 2);
  const com = typed(s2, "commune");
  setFood(com, com.pop * 10);
  const wg = newNeutralGroup(s2, com.bases[0], new Rng(99));
  wg.mood = "desperate";
  const pistol = newItem("pistol", 0.8);
  wg.people[0].gear.weapon = pistol;
  const pop0 = com.pop, n = wg.people.length;
  // Nobody dies or settles elsewhere while they wait (WANDER.SIM's die and settle rolls: a lone wanderer at a 5% a day
  // join could lose the race to the tile's 1–2% a day death, and on some seeds did).
  const SIM0 = { ...WANDER.SIM };
  Object.assign(WANDER.SIM, { DIE: 0, DIE_INF: 0, DIE_HORDE: 0, SETTLE: 0 });
  for (let i = 0; i < 120 && s2.wanderers.groups.includes(wg); i++) { s2.hour += 24; wg.tile = com.bases[0]; wanderersDaily(s2); }
  Object.assign(WANDER.SIM, SIM0);
  check(com.pop === pop0 + n && com.arsenal.items.includes(pistol), `wanderers at the commune's gate join it (people ${pop0} → ${com.pop}, the pistol in its arsenal)`);
  const rai = typed(s2, "raider", [com]);
  setFood(rai, rai.pop * 10);
  check(C.wandererJoinChance(s2, rai, { mood: "wary" }) === C.wandererJoinChance(s2, rai, { mood: "desperate" }) && C.wandererJoinChance(s2, rai, { mood: "wary" }) > C.wandererJoinChance(s2, com, { mood: "wary" }), "raiders press-gang: the wary go along as well");
  // Your deserter joins a group near the base they left.
  const s3 = world(seed + 3), h3 = hub(s3);
  s3.factions[0].bases.push(s3.grid.within(h3.tile, 4).find((t) => s3.grid.distance(t, h3.tile) === 4));
  const d = atBase(s3, h3.id)[0];
  d.gear.weapon = newItem("shotgun", 0.9);
  const sg = d.gear.weapon;
  d.alive = false; d.left = true;
  s3.deserters = [{ id: d.id, baseId: h3.id, day: 0, took: {} }];
  const joined = C.playerDeserters(s3, 30, true);
  check(joined.length === 1 && joined[0].f.arsenal.items.includes(sg), `your deserter ${d.name} joined ${joined[0] && joined[0].f.name}, with the shotgun`);
}

// ======================================================================================
section("Type profiles: different mixes of what they do");
{
  const tally = {};
  for (const s of [seed, seed + 11]) {
    const st = world(s);
    const seen = new Set();
    for (let hr = 0; hr < 24 * 120; hr++) {
      tickHour(st);
      st.cards.length = 0;
      if (hr % 24) continue;
      for (const q of st.parties) {
        if (q.owner === "player" || seen.has(q.id)) continue;
        seen.add(q.id);
        const f = st.factions.find((x) => x.id === q.owner);
        if (!f) continue;
        const t = (tally[f.type] = tally[f.type] || { groups: 0, raid: 0, war: 0, scav: 0, trade: 0 });
        // A war's raids (diplomacy.js warRaid: q.warId) come from both sides whatever their type: counted apart.
        if (q.kind === "raid") { if (q.warId != null) t.war++; else t.raid++; }
        if (q.kind === "scav") t.scav++;
      }
    }
    for (const f of st.factions) { const t = (tally[f.type] = tally[f.type] || { groups: 0, raid: 0, war: 0, scav: 0, trade: 0 }); t.groups++; t.trade += f.foodDeal != null ? 1 : 0; t.food = (t.food || 0) + (f.foodBought || 0); }
  }
  const per = (type, k) => (tally[type] ? tally[type][k] / Math.max(1, tally[type].groups) : 0);
  console.log(`  120 days, 2 worlds: ${Object.entries(tally).map(([k, t]) => `${k} ${t.groups}g raid ${(t.raid / t.groups).toFixed(1)} (war ${(t.war / t.groups).toFixed(1)}) scav ${(t.scav / t.groups).toFixed(1)} bought food ${((t.food || 0) / t.groups).toFixed(0)}`).join("; ")}`);
  // Against the peaceful types with two or more groups in the two worlds (one group's 120 days is no measure of a type).
  const peaceful = ["commune", "traders", "military", "fortress"].filter((k) => tally[k] && tally[k].groups >= 2);
  check(per("raider", "raid") > Math.max(0, ...peaceful.map((k) => per(k, "raid"))), `raiders raid more than any peaceful type outside a war (${peaceful.map((k) => `${k} ${per(k, "raid").toFixed(1)}`).join(", ")})`);
  const W = C.GROUP_PRIORITIES;
  check(W.commune.trade > W.raider.trade && W.commune.heal > W.raider.heal && W.raider.raid > W.commune.raid && W.fortress.fortify > W.raider.fortify, "one profile table: communes trade and heal, raiders raid, a fortress fortifies");
  // Short of food: a commune buys it, raiders mostly do not (they raid for it).
  let bought = { commune: 0, raider: 0 };
  for (const type of ["commune", "raider"]) {
    for (let i = 0; i < 40; i++) {
      const st = world(seed + 20 + i);
      const f = typed(st, type);
      setFood(f, 0); f.stock.scrap = 200; f.foodDeal = null;
      for (const o of st.factions) if (o !== f) setFood(o, o.pop * 20);
      C.tickGroup(f);
      if (C.hungerTrade(st, f)) bought[type]++;
    }
  }
  check(bought.commune > bought.raider, `hungry, communes buy food (${bought.commune}/40) far more often than raiders (${bought.raider}/40)`);
}

// ======================================================================================
section("Vehicles: found, taken, repaired, fitted out, stolen, traded");
{
  const st = world();
  const h = hub(st);
  const rai = typed(st, "raider"), mil = typed(st, "military", [rai]);
  st.groupWorks = st.groupWorks || {};
  for (const f of [rai, mil]) worksAt(f, f.bases[0]).bench = 1;
  worksAt(rai, rai.bases[0]).garage = 1; // ai-locks: raiders (Mechanics 3) repair vehicles only with a garage, as you do
  // A car left on the map by their base.
  const car = createVehicle(st, "truck", { kind: "abandoned", tile: rai.bases[0], since: 0 }, { condition: 30 });
  const v0 = factionVehicles(rai).length;
  for (let i = 0; i < 80 && st.vehicles.includes(car); i++) { C.tickGroup(rai); G.groupWorldDaily(st, rai); }
  check(!st.vehicles.includes(car) && factionVehicles(rai).length === v0 + 1, "a group claims a car left by its base");
  const rec = factionVehicles(rai)[factionVehicles(rai).length - 1];
  rai.stock.parts = 20; rai.stock.scrap = 200;
  const c0 = rec.condition;
  for (let i = 0; i < 4; i++) C.groupCareDaily(st, rai);
  check(rec.condition > c0 && rai.stock.parts < 20, `and repairs it at its workshop with parts (${c0} → ${rec.condition})`);
  rai.stock.parts = 20; rai.stock.scrap = 200;
  let fit = null;
  for (let i = 0; i < 60 && !fit; i++) { C.tickGroup(rai); fit = G.fitUpgrade(st, rai); }
  check(fit && fit.key === "scrapPlate" && upgradesOf(rec).scrapPlate === 1, `raiders weld scrap plating on (${fit && fit.key})`);
  mil.stock.parts = 30; mil.stock.scrap = 200; mil.stock.carparts = 30;
  factionVehicles(mil).push({ id: "t-mil", type: "truck", name: "Pickup", fuel: 5, condition: 80, owner: mil.id });
  let mfit = null;
  for (let i = 0; i < 60 && !mfit; i++) { C.tickGroup(mil); mfit = G.fitUpgrade(st, mil); }
  check(mfit && (mfit.key === "plating" || mfit.key === "glass"), `the military fits proper plate or glass (${mfit && mfit.key})`);
  // An outpost of yours with nobody there: they drive off with its car (rarely).
  const out = { ...JSON.parse(JSON.stringify(h)), id: 987654, type: "outpost", name: "Test outpost", tile: rai.bases[0], buildings: [], stock: {}, armory: [] };
  st.bases.push(out);
  const yours = createVehicle(st, "sedan", { kind: "base", baseId: out.id }, { condition: 70 });
  G.stealYours(st, rai, yours);
  check(!st.vehicles.includes(yours) && st.cards.some((c) => /is gone/.test(c.title)), "an unguarded car of yours is stolen, and a card says so");
  check(G.VEH.STEAL <= 0.02, `the chance a day is small (${G.VEH.STEAL} × the type's steal weight)`);
  // Between groups.
  const nm0 = factionVehicles(mil).length, nr0 = factionVehicles(rai).length;
  const stolen = G.stealFromGroup(st, rai, mil);
  check(stolen && factionVehicles(rai).length === nr0 + 1 && factionVehicles(mil).length === nm0 - 1, `raiders steal the ${stolen && stolen.name} from the military`);
  const tr = typed(st, "traders", [rai, mil]);
  for (let i = 0; i < 3; i++) factionVehicles(tr).push({ id: `tr${i}`, type: "van", name: "Van", fuel: 5, condition: 70, owner: tr.id });
  const buyer = typed(st, "expansionist", [rai, mil, tr]);
  factionVehicles(buyer).length = 0;
  buyer.pop = 40; buyer.stock.scrap = 2000;
  const sale = G.sellBetween(st, tr, buyer);
  check(sale && factionVehicles(buyer).includes(sale.v), `the traders sell a ${sale && sale.v.name} to ${buyer.name} for goods worth ${sale && sale.price}`);
  // With you: sell one, buy one, at vehicleValue × their want.
  h.stock.scrap = 2000;
  const mine = createVehicle(st, "truck", { kind: "base", baseId: h.id }, { condition: 90 });
  const worth = vehicleValue(mine);
  const sold = G.sellVehicleTo(st, buyer, mine, h);
  check(sold && !st.vehicles.includes(mine) && Math.abs(sold.price - G.vehiclePrice(buyer, mine)) < 1 && sold.price >= worth * 0.6, `you sell your truck (worth ${worth}) for ${sold && sold.price}`);
  const theirs = factionVehicles(tr)[0];
  const got = G.buyVehicleFrom(st, tr, theirs, h, createVehicle);
  check(got && got.v && got.v.loc.baseId === h.id && !factionVehicles(tr).includes(theirs), `you buy their ${theirs.name} for ${got && got.price}`);
}

// ======================================================================================
section("Abandoned bases");
{
  const st = world();
  const dead = typed(st, "fortress");
  st.groupWorks = st.groupWorks || {};
  worksAt(dead, dead.bases[0]).walls = 3;
  worksAt(dead, dead.bases[0]).farms = 1;
  const tile = dead.bases[0];
  for (const o of st.factions) if (o !== dead) o.type = o.type === "raider" || o.type === "expansionist" || o.type === "zealot" ? "commune" : o.type; // nobody aggressive to take it over
  collapseFaction(st, dead);
  const rec = G.abandonedAt(st, tile);
  check(rec && rec.works.walls === 3, "a group dies out: its base stands empty with its walls");
  const heir = typed(st, "raider", [dead]);
  const w0 = (heir.works && heir.works[tile] && heir.works[tile].walls) || 0;
  heir.bases.push(tile);
  G.occupyAbandoned(st, heir, tile);
  check(heir.works[tile].walls === 3 && w0 === 0 && !G.abandonedAt(st, tile), "another group moves in and has the walls");
  check(G.abandonedPull(heir, { works: { walls: 2 } }) > G.abandonedPull(heir, { works: { farms: 2 } }), "raiders like an abandoned fort better than a farm");
  // Your outpost lost: a group moves in and you get a card.
  const st2 = world(seed + 4), h2 = hub(st2);
  // A free tile of land 3 from the hub, a site's first (some maps have no site in that ring; the outpost needs none).
  const tileO = st2.tiles.filter((t) => t.terrain !== "water" && !t.hive && st2.grid.distance(t.id, h2.tile) === 3 && !st2.factions.some((f) => f.bases.includes(t.id)))
    .sort((a, b) => (b.loc ? 1 : 0) - (a.loc ? 1 : 0))[0].id;
  const base = { ...JSON.parse(JSON.stringify(h2)), id: 765432, type: "outpost", name: "Old outpost", tile: tileO, buildings: [], stock: {}, armory: [] };
  addBuilding(base, "walls");
  st2.bases.push(base);
  const { removeBase } = await import("../src/sim/world.js");
  removeBase(st2, base, "was abandoned");
  const r2 = G.abandonedAt(st2, tileO);
  check(r2 && r2.from === "player" && r2.works.walls === 1, "your abandoned outpost stays with its wall");
  const g2 = st2.factions.find((f) => f.alive);
  g2.bases.push(tileO);
  st2.cards.length = 0;
  G.occupyAbandoned(st2, g2, tileO);
  check(st2.cards.some((c) => /moved into Old outpost/.test(c.title)), "a group moves into it: a card tells you");
}

// ======================================================================================
section("What they know: scouting, spies, stale intel");
{
  const st = world();
  const h = hub(st);
  const f = typed(st, "raider");
  f.knows = { bases: {} };
  check(G.intelDef(st, f, h) === null, "a base they have not found is not a target");
  f.goodwill = -90;
  for (const o of st.factions) o.raidCooldown = 999;
  f.raidCooldown = 0;
  const saveScout = G.KNOW.SCOUT;
  G.KNOW.SCOUT = 0;
  let raids = 0;
  for (let i = 0; i < 40; i++) { f.raidCooldown = 0; f.knows.bases = {}; daily(st); raids += st.parties.filter((q) => q.kind === "raid" && q.owner === f.id && q.target.kind === "player").length; st.parties = st.parties.filter((q) => q.owner === "player"); }
  check(raids === 0, `a group that does not know your bases never raids you (${raids})`);
  G.KNOW.SCOUT = 1;
  f.knows.bases = {};
  let found = false;
  for (let i = 0; i < 30 && !found; i++) { C.tickGroup(f); G.scoutDaily(st, f, day(st)); st.cards.length = 0; found = Object.values(f.knows.bases).some((k) => k.kind === "player"); }
  G.KNOW.SCOUT = saveScout;
  check(found, "scouting finds your base");
  f.scoutedYou = null; // not just now: what they saw stays what it was
  const k = G.learnBase(st, f, h.tile, day(st));
  const def0 = k.def;
  for (let i = 0; i < 4; i++) addBuilding(h, "walls");
  check(G.intelDef(st, f, h) === def0 && def0 < (await import("../src/sim/factions.js")).preparedDefense(st, h), `stale intel: they still think your defence is ${def0}, it has grown with the walls`);
  // A scout at the walls, spotted: the card, and you catch them.
  st.cards.length = 0;
  const pop0 = f.pop, arm0 = h.armory.length;
  G.scoutYou(st, f, h, day(st), true);
  const card = st.cards.find((c) => /stranger watching/.test(c.title));
  check(!!card, "your lookouts spot a stranger watching the walls (a card)");
  if (card) { card.choices.find((c) => /Capture/.test(c.label)).resolve(st); check(f.pop === pop0 - 1 && h.armory.length === arm0 + 1, "captured: one of theirs gone, their gun in your armory"); }
  const before = f.scoutedYou;
  G.scoutYou(st, f, h, day(st), false);
  check(f.scoutedYou != null && f.scoutedYou >= (before ?? -1) && G.intelDef(st, f, h) > def0, "unseen, a scout gets home with your real defences");
}

// ======================================================================================
section("One model: caravan escorts, rescue raids, non-lethal, the profiles");
{
  const st = world();
  const f = typed(st, "traders");
  const cap0 = groupCapacity(st, f);
  check(cap0.guards > 0 && Math.abs(cap0.power - Math.round(A.unitPower(f, 2.2) * 10) / 10) < 0.11, `a caravan's guards come from the arsenal at the group's power by its kit (${cap0.guards} guards at ${cap0.power})`);
  for (const it of f.arsenal.items.filter((x) => A.isWeaponKey(x.key))) A.removeFromArsenal(f, it, "test");
  check(groupCapacity(st, f).guards === 0, "no guns past the home guard: no guards to send");
  // A raided caravan's guards lose their kit (caravanraids.js).
  const st2 = world(seed + 6);
  const owner = typed(st2, "commune"), gang = typed(st2, "raider", [owner]);
  const n0 = owner.arsenal.items.length, p0 = owner.pop;
  const q = { id: 9e9 + 7, owner: owner.id, kind: "caravan", path: [owner.bases[0]], idx: 0, phase: "out", strength: 6, escort: { guards: 4 }, goods: { supplies: { food: 10 }, gear: [newItem("pistol", 0.8)] } };
  st2.parties.push(q);
  gang.pop = 60;
  let took = false;
  for (let i = 0; i < 8 && !took; i++) { took = gangAmbush(st2, gang, q); st2.hour++; }
  check(took && owner.arsenal.items.length < n0 && owner.pop < p0, `a gang takes a commune caravan: its guards' kit and people are gone (${n0} -> ${owner.arsenal.items.length} items, ${p0} -> ${owner.pop} people)`);
  check(gang.arsenal.items.some((it) => it.key === "pistol" && it.quality === 0.8), "and the pistol it carried goes to the gang's fighters");
  // Rescue raids are fought with everything the group has at home.
  const g = typed(st, "military", [f]);
  const b = { setup: { handler: "rescueRaid", enemy: { count: 3 } }, units: [], nextId: 1, motorPool: [], rescue: { armory: { items: [...g.arsenal.items] } } };
  const u = { id: 1, side: "enemy", kind: "human", factionId: g.id, dmgMult: 1, armor: 1 };
  A.armFromArsenal(st, b, u, 1);
  const best = A.issueKit(st, g, 1, "home")[0].weapon;
  check(u.arsItem === best && !b.rescue.armory.items.includes(best), "a rescue raid: the base's guards take the best kit, and what they carry is off the rack");
  check(NL_TAKE.raider === C.GROUP_PRIORITIES.raider.takeAlive && NL_TAKE.zealot === 0, "nonlethal.js NL_TAKE reads the profile table");
  // Medics and flashbangs (medics.js, throwables.js): out of the arsenal, or none.
  const gd = typed(st, "traders", [f, g]);
  A.seedArsenal(st, gd);
  const kits0 = gd.arsenal.items.filter((it) => A.isMedKitKey(it.key));
  const bm = { setup: { handler: "x", enemy: { count: 2 } }, units: [], nextId: 1 };
  const um = { id: 2, side: "enemy", kind: "human", factionId: gd.id, dmgMult: 1, armor: 1, isMedicKit: true, medKit: { key: "bandagekit", name: "Bandage kit" }, kitBonus: 1, medicine: 5, kitLeft: 4, throwables: { flashbang: 5 } };
  A.armFromArsenal(st, bm, um, 1);
  const flashes = gd.arsenal.items.filter((it) => it.key === "flashbang").length;
  check(kits0.length > 0 && kits0.includes(um.medKit) && um.arsMedKit === um.medKit, `a guards' medic carries the group's own ${um.medKit && um.medKit.name}`);
  check((um.throwables.flashbang || 0) === Math.min(5, flashes) && um.arsThrows.every((it) => gd.arsenal.items.includes(it)), `and only the flashbangs the group holds (${um.throwables.flashbang || 0} of 5 asked, ${flashes} held)`);
  for (const k of kits0) A.removeFromArsenal(gd, k, "test");
  const um2 = { id: 3, side: "enemy", kind: "human", factionId: gd.id, dmgMult: 1, armor: 1, isMedicKit: true, medKit: { key: "bandagekit", name: "Bandage kit" }, kitBonus: 1, medicine: 5, kitLeft: 4 };
  A.armFromArsenal(st, { setup: { handler: "x", enemy: { count: 2 } }, units: [], nextId: 1 }, um2, 1);
  check(!um2.medKit && !um2.isMedicKit && um2.medicine === 4, "with no kit left in the arsenal, no medic");
  check(wallGoal({ type: "fortress", bases: [1] }, 2) > wallGoal({ type: "raider", bases: [1] }, 2), "a fortress walls every base (the profile's walled)");
  const ng = typed(st, "traders", [f, g]);
  A.seedArsenal(st, ng);
  check(ng.arsenal.items.some((it) => it.key === "taser" || it.key === "pepper"), "traders' guards carry tasers and pepper spray in the arsenal (nonlethal.js)");
}

// ======================================================================================
section("Vehicles in the trade window, the governor, their motor pool");
{
  const st = world(seed + 8);
  const h = hub(st);
  const f = st.factions.find((x) => x.alive && planPath(st, x.bases[0], h.tile, false));
  f.type = "traders";
  f.goodwill = 40;
  factionVehicles(f).length = 0;
  factionVehicles(f).push({ id: "t-sell", type: "truck", name: "Pickup", fuel: 8, condition: 75, owner: f.id });
  const c = sendCaravan(st, f, h);
  c.phase = "trading";
  openCaravanTrade(st, c);
  h.stock.scrap = 3000;
  const offers = V.vehicleOffers(st, tradeContext(st));
  check(offers.theirs.length === 1 && offers.theirs[0].price > 0, `their pickup is for sale at the gates (${offers.theirs[0] && offers.theirs[0].price})`);
  const s0 = h.stock.scrap, v0 = st.vehicles.length;
  const msg = V.buyVehicle(st, 0);
  check(st.vehicles.length === v0 + 1 && h.stock.scrap < s0 && !factionVehicles(f).length, `bought: ${msg}`);
  const mine = st.vehicles[st.vehicles.length - 1];
  mine.cargo = { supplies: {}, gear: [] }; setFood(mine.cargo, 7); // 7 days of ration bars (tools/foodkit.js)
  const f0 = food(h) || 0;
  const sell = V.vehicleOffers(st, tradeContext(st)).mine;
  const worth = vehicleValue(mine);
  const i = sell.findIndex((o) => o.v === mine);
  f.stock.scrap = 3000;
  const m2 = V.sellVehicle(st, i);
  check(!st.vehicles.includes(mine) && factionVehicles(f).length === 1 && Math.abs((food(h) || 0) - f0 - 7) < 1e-6 && sell[i].price < worth * 1.5 && sell[i].price > worth * 0.4, `sold back at about its worth (${worth} -> ${sell[i].price}), its cargo unloaded: ${m2}`);
  // The governor: no car at all, rich: buys one.
  for (const v of [...st.vehicles]) if (v.type !== "bike") st.vehicles.splice(st.vehicles.indexOf(v), 1);
  const g1 = V.governorVehicles(st);
  check(/^Bought/.test(g1) && st.vehicles.some((v) => v.type !== "bike"), `the governor buys a car when there is none: ${g1}`);
  // ... and sells a long-idle spare when the base has plenty.
  for (let k = 0; k < 3; k++) createVehicle(st, "sedan", { kind: "base", baseId: h.id }, { condition: 60 });
  for (const v of st.vehicles) v.idleDays = 40;
  f.stock.scrap = 3000;
  const g2 = V.governorVehicles(st);
  check(/^Sold/.test(g2), `and sells a long-idle spare: ${g2}`);
  // Over the radio: driven over a day later.
  endTrade(st);
  factionVehicles(f).push({ id: "t-radio", type: "van", name: "Van", fuel: 8, condition: 70, owner: f.id });
  f.goodwill = 60;
  const why = openRadioTrade(st, f, h.id);
  if (!why) {
    const nv = st.vehicles.length;
    const r = V.buyVehicle(st, V.vehicleOffers(st, tradeContext(st)).theirs.findIndex((o) => o.rec.id === "t-radio"));
    check(/drive it over/.test(r) && st.vehicles.length === nv, `bought over the radio: ${r}`);
    endTrade(st);
    st.hour += 48;
    V.vehicleDeliveriesDaily(st);
    check(st.vehicles.length === nv + 1, "and it arrives at the base");
  } else check(true, `(radio skipped: ${why})`);
  // Their motor pool on their base's map: hotwire one and drive off; they notice.
  const mil = typed(st, "military");
  const pool0 = factionVehicles(mil).length, gw0 = mil.goodwill;
  const b = createBattle(st, { tile: mil.bases[0], baseId: h.id, enemy: { kind: "soldiers", count: 3, power: 5, factionId: mil.id, name: "test", arsTask: "home" }, ambush: null, canRetreat: true, handler: "arsenaltest" });
  check(b.motorPool && b.motorPool.length > 0, `their motor pool is on the map (${b.motorPool && b.motorPool.length} vehicles)`);
  if (b.motorPool && b.motorPool.length) {
    const rec = carRecord(st, b, b.motorPool[0]);
    check(rec && rec.owned && rec.cond.engine === "ok", `one of their own: the ${rec && rec.name}, it runs`);
    rec.open = true; rec.hot = true; rec.inspected = true;
    const v = claimCar(st, b, rec);
    check(v && factionVehicles(mil).length === pool0 - 1 && mil.goodwill <= gw0 - 20, `driven off: off their books, and goodwill falls (${Math.round(gw0)} -> ${Math.round(mil.goodwill)})`);
  }
  st.combat = null;
}

// ======================================================================================
section("Gear's weight in strength: it matters, but numbers still win");
{
  // Before (2026-10-08): 0.6 + 0.4 × the kit ratio. Now kitCurve: KIT_DOWN of a shortfall, KIT_UP × ln above it.
  const old = (r) => 0.6 + 0.4 * r;
  const st = world();
  const rows = [];
  // A starting kit is one draw (hashed): its ratio runs a few percent either side of 1, so "their kit" is the mean of
  // DRAWS of them (one draw of 0.94 had 15 raiders lose to the 10 best kitted on seed 5).
  const DRAWS = 8;
  const sample = (label, type, pop, fill, draws = 1) => {
    const f = st.factions[0];
    let now = 0, k = 0;
    for (let d = 0; d < draws; d++) {
      f.type = type; f.pop = pop; f.wounded = 0; f.gear = 1; f.stock.ammo = 999;
      f.arsenal.items.length = 0; f.arsenal.rev++;
      for (const it of fill(f, d)) A.addToArsenal(st, f, it, "test");
      f.arsenal.gear = 1;
      now += strength(f); k += A.kitFactor(f);
    }
    rows.push({ label, now: now / draws, base: pop * FACTION_TYPES[type].arms, k: k / draws });
  };
  const kit = (f, n, d = 0) => A.starterKit(st.seed, `${f.name}${n}${d ? `#${d}` : ""}`, f.type, n);
  const best = (n) => Array.from({ length: n }, (_, i) => [lootItem("lmg", "military", [i, "b"]), lootItem("plate", "military", [i, "bp"]), lootItem("milhelmet", "military", [i, "bh"]), lootItem("riotarms", "military", [i, "ba"]), lootItem("riotlegs", "military", [i, "bl"])]).flat();
  sample("raiders, 20, their kit", "raider", 20, (f, d) => kit(f, 20, d), DRAWS);
  sample("raiders, 20, bare hands", "raider", 20, () => []);
  sample("raiders, 10, the best kit there is", "raider", 10, () => best(10));
  sample("raiders, 15, their kit", "raider", 15, (f, d) => kit(f, 15, d), DRAWS);
  sample("military, 12, their kit", "military", 12, (f, d) => kit(f, 12, d), DRAWS);
  sample("military, 8, the best kit there is", "military", 8, () => best(8));
  sample("commune, 30, their kit", "commune", 30, (f, d) => kit(f, 30, d), DRAWS);
  sample("commune, 30, half of them armed", "commune", 30, (f, d) => kit(f, 15, d), DRAWS);
  sample("commune, 15, the best kit there is", "commune", 15, () => best(15));
  for (const x of rows) {
    const k = x.k, r = k <= 1 ? 1 - (1 - k) / A.ARSENAL.KIT_DOWN : Math.exp((k - 1) / A.ARSENAL.KIT_UP); // the ratio back from the curve
    console.log(`  ${x.label.padEnd(38)} kit ratio ${r.toFixed(2)}: strength ${(x.base * old(Math.max(A.ARSENAL.KIT_MIN, Math.min(A.ARSENAL.KIT_MAX, r)))).toFixed(1)} before → ${x.now.toFixed(1)} now`);
  }
  const s = (label) => rows.find((x) => x.label === label).now;
  check(s("raiders, 20, bare hands") <= 0.6 * s("raiders, 20, their kit"), "a gang that lost its guns is less than 60% of its strength");
  check(s("raiders, 10, the best kit there is") < s("raiders, 15, their kit") && s("military, 8, the best kit there is") < s("military, 12, their kit") && s("commune, 15, the best kit there is") < s("commune, 30, their kit"),
    "the best kit there is does not beat a group half again its size with its usual kit");
  check(s("raiders, 10, the best kit there is") > 1.3 * 10 * FACTION_TYPES.raider.arms && s("commune, 30, half of them armed") < 0.85 * s("commune, 30, their kit"), "but gear matters: the best kit is worth 30%+ more a head, half the guns gone 15%+ less");
  check(Math.abs(A.kitCurve(1) - 1) < 1e-9 && A.kitCurve(A.ARSENAL.KIT_MAX) < 1.5 && A.kitCurve(A.ARSENAL.KIT_MIN) > 0.45, `the curve: 1 at the starting kit, ${A.kitCurve(A.ARSENAL.KIT_MAX).toFixed(2)} at the best, ${A.kitCurve(A.ARSENAL.KIT_MIN).toFixed(2)} with nothing`);
}

// ======================================================================================
section("Newcomers come as they are: some armed, some with nothing");
{
  const st = world();
  const f = typed(st, "raider");
  const tally = { none: 0, makeshift: 0, gun: 0, own: 0, armour: 0 };
  const carried = new Set(f.arsenal.items.filter((it) => A.isWeaponKey(it.key)).map((it) => it.key));
  const N = 400;
  for (let i = 0; i < N; i++) {
    const kit = A.newcomerKit(st, f, [st.seed, "t", i]);
    const w = kit.find((it) => A.isWeaponKey(it.key));
    if (!w) tally.none++;
    else if (A.ARSENAL.CRAFT.weapons.includes(w.key)) tally.makeshift++;
    else { tally.gun++; if (carried.has(w.key)) tally.own++; }
    if (kit.some((it) => A.isArmourKey(it.key))) tally.armour++;
  }
  check(Math.abs(tally.none / N - A.ARSENAL.RECRUIT.NONE) < 0.07 && tally.makeshift > N * 0.12 && tally.gun > N * 0.4, `per head a random draw: ${tally.none} with nothing, ${tally.makeshift} a makeshift weapon, ${tally.gun} a gun or blade of ${N}`);
  check(tally.armour > 0 && tally.armour < N * 0.5, `armour now and then (${tally.armour} of ${N}: the kit's list has empty entries)`);
  check(JSON.stringify(A.newcomerKit(st, f, [st.seed, "t", 7]).map((x) => [x.key, x.quality])) === JSON.stringify(A.newcomerKit(st, f, [st.seed, "t", 7]).map((x) => [x.key, x.quality])), "the same seed and day: the same arms");
  // Through the day's upkeep: a group grows by 20 and its arsenal by what they brought.
  const g = typed(st, "commune", [f]);
  const n0 = g.arsenal.items.length;
  const w0 = g.arsenal.items.filter((it) => A.isWeaponKey(it.key)).length;
  g.pop += 20;
  A.arsenalDaily(st, g);
  const w1 = g.arsenal.items.filter((it) => A.isWeaponKey(it.key)).length;
  check(g.arsenal.items.length > n0 && w1 - w0 < 20 && w1 - w0 >= 8, `20 newcomers bring ${w1 - w0} weapons between them (not one each)`);
}

// ======================================================================================
section("They know your bases as far as they have scouted");
{
  const st = world();
  const h = hub(st);
  const g = st.grid;
  // A gang 18 tiles from your hub (outside its home ground) knows nothing of you on day one.
  const f = typed(st, "raider");
  const far = g.within(h.tile, 18).find((t) => g.distance(t, h.tile) === 18 && st.tiles[t].terrain !== "water" && !st.factions.some((o) => o.bases.includes(t)));
  f.bases = [far]; f.knows = null;
  check(!G.knownBase(st, f, h.tile) && G.reachOf(st, f) === G.KNOW.REACH0, `a group ${g.distance(far, h.tile)} tiles off does not know your hub at first (reach ${G.reachOf(st, f)})`);
  const near = typed(st, "commune", [f]);
  const close = g.within(h.tile, 6).find((t) => g.distance(t, h.tile) === 6 && st.tiles[t].terrain !== "water" && !st.factions.some((o) => o.bases.includes(t)));
  near.bases = [close]; near.knows = null;
  check(!!G.knownBase(st, near, h.tile), "one on its home ground next to you does");
  // Scouting pushes the frontier out, ring by ring, until your hub is in it.
  const S0 = G.KNOW.SCOUT;
  G.KNOW.SCOUT = 99;
  let trips = 0;
  while (!G.knownBase(st, f, h.tile) && trips < 30) { C.tickGroup(f); G.scoutDaily(st, f, day(st)); st.cards.length = 0; trips++; }
  G.KNOW.SCOUT = S0;
  check(G.knownBase(st, f, h.tile) && G.reachOf(st, f) >= 18 && G.reachOf(st, f) <= G.KNOW.RANGE, `found after ${trips} scouting trips, the frontier at ${G.reachOf(st, f)} tiles`);
  // A raid only goes for a base they know: a new outpost further out is unknown until a party passes it.
  const t2 = g.within(h.tile, 3).find((t) => g.distance(t, h.tile) === 3 && st.tiles[t].terrain !== "water" && !st.factions.some((o) => o.bases.includes(t)));
  const raider2 = typed(st, "raider", [f, near]);
  raider2.knows = { bases: {}, reach: 0 };
  check(G.partySaw(st, raider2, t2) === st.bases.filter((b) => g.distance(b.tile, t2) <= G.KNOW.PASS).length && !!G.knownBase(st, raider2, h.tile), "a party of theirs passing within sight learns your base");
  // The radio: a friend tells them.
  const friend = typed(st, "traders", [f, near, raider2]);
  friend.knows = { bases: {}, reach: 0 };
  friend.bases = [g.within(near.bases[0], 5).find((t) => g.distance(t, near.bases[0]) === 5 && st.tiles[t].terrain !== "water" && !st.factions.some((o) => o.bases.includes(t)) && g.distance(t, h.tile) > G.KNOW.PASS)];
  D.ensureDiplo(st);
  D.changeRelation(st, friend, near, 60 - D.relation(st, friend, near));
  if (st.groupWorks) worksAt(near, near.bases[0]).radio = 1; // ai-locks: one of them on the air (a radio station: radio.js groupNetwork)
  let heard = 0;
  // Their turn on the air every KNOW.RADIO.EVERY days, the gossip's own roll forced (as KNOW.SCOUT above): 5–6 turns
  // at 50% each all missed on some seeds.
  const C0 = G.KNOW.RADIO.CHANCE;
  G.KNOW.RADIO.CHANCE = 1;
  for (let d = 0; d < 40 && !heard; d++) { st.hour += 24; heard = G.radioGossip(st, friend, day(st)); }
  G.KNOW.RADIO.CHANCE = C0;
  check(heard > 0 && !!G.knownBase(st, friend, h.tile), `a friend on the radio tells them where you are (${heard})`);
  // Saves keep each group's frontier.
  const B2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));
  check(B2.factions.find((x) => x.id === f.id).knows.reach === f.knows.reach, "the frontier survives a save");
}

// ======================================================================================
section("Saves");
{
  const st = world();
  daily(st, 3);
  const f = st.factions[0];
  const it = f.arsenal.items[0];
  const B = deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));
  const g = B.factions[0];
  check(g.arsenal && g.arsenal.items.length === f.arsenal.items.length && g.arsenal.items[0].aid === it.aid && g.arsenal.items[0].quality === it.quality, "an arsenal survives a save and load, item by item");
  check(JSON.stringify(g.knows) === JSON.stringify(f.knows) && JSON.stringify(factionVehicles(g)) === JSON.stringify(factionVehicles(f)), "what they know and their vehicles too");
  // An old save: no arsenal yet. Built on first read by the same rule as a new world's.
  const ref = A.starterKit(B.seed, g.name, g.type, g.pop, g.gear || 1).map((x) => [x.key, x.quality, x.dur]);
  delete g.arsenal;
  const strOld = strength(g);
  A.ensureArsenal(B, g);
  check(JSON.stringify(g.arsenal.items.map((x) => [x.key, x.quality, x.dur])) === JSON.stringify(ref), "an old save's group gets its arsenal by the same rule");
  check(Math.abs(strength(g) / strOld - 1) < 0.3, `and about the strength it had (${strOld.toFixed(1)} → ${strength(g).toFixed(1)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
