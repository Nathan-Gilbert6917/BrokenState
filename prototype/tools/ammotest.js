// Rounds by calibre and type (src/sim/ammo.js, rounds.js, data-ammo.js; docs/weapons-overhaul-plan.md sections 1, 6
// and 20: every calibre and type is its own supply, so a 9mm gun cannot fire 5.56). Checks:
// - the tables: every type of every calibre is a supply and a box; values and weights by the share left;
// - a common load gives exactly today's numbers (shot odds, damage, a worm swarm, noise);
// - a gun fires only its own calibre and loaded type; boxes carried deplete first, then the team's, then the pools;
//   empty boxes are thrown away after the fight; Reload with another type (act.ammo) costs 1 action and switches it;
//   roundsOf follows every round taken; the AI switches type when its own runs out;
// - typed effects: hollow points on the unarmoured, slugs at range, birdshot up close, subsonic quieter, hit.ammo/cal;
// - enemy loads by kit (own dice), never shown; their bodies drop rounds of their calibre and load;
// - starting colonists: a typed load now and then, never AP, API or match;
// - the economy: generic ammo settled by the guns there, spent from what they need least; finds by site; the bench;
//   packing by the crew's guns; by-the-numbers shots by calibre (armed factor, R8 edge); trade with a group's one
//   ammo count (kind mix, fold); hunting with the gun's calibre and load (R9).
// Usage: node tools/ammotest.js [seed]
import { createWorld, makeSurvivor, hub, armedFactor, spendShots, tickHour } from "../src/sim/world.js";
import { GEAR, SUPPLIES, SUPPLY_KEYS, STOCK_KEYS } from "../src/sim/data.js";
import { CALIBERS, AMMO_TYPES, KIT_AMMO, ammoKey, HAND_SUPPLIES } from "../src/sim/data-ammo.js";
import {
  WEAPONS, createBattle, combatAct, registerCombatHandler, canFire, fireRefusal, magShown, reloadRefusal, shotOdds, shotHit, damage,
  autoResolveCombat, enemyUnit, autoPlayerTurn, closeCombat, endBattleNow, byNumbersOdds, refitKit, loadMag,
} from "../src/sim/combat.js";
import {
  ROUND_KEYS, isRoundKey, calOf, totalRounds, roundsIn, roundsOf, settleRec, spendAmmo, addAmmo, giveRounds, setRounds, newBox, boxesOf,
  starterLoad, enemyLoad, findRounds, themeOf, mixForCals, gunCals, packRounds, drawShots, ammoEdge, benchRounds, baseAmmo, settleAll,
  kindShare, softMult, typeFor, loadOf, pickLoad, huntLoad, foldRounds, migrateAmmo, carriedRec, sweepBoxes,
} from "../src/sim/ammo.js";
import { newItem, enemyBody, itemKg } from "../src/sim/inventory.js";
import { roundItem, amountOf } from "../src/sim/itemstack.js";
import { itemValue } from "../src/sim/valuation.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { swarmArmor } from "../src/sim/carriers.js";
import { shotNoise } from "../src/sim/stealth.js";
import { available, sellPrice, buyPrice } from "../src/sim/trade.js";
import { bestHuntWeapon } from "../src/sim/hunting.js";
import { Rng } from "../src/sim/rng.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL ${msg}`); } return ok; };
registerCombatHandler("ammotest", () => {});

function fighter(state, weapon = "pistol", shooting = 9) {
  const s = makeSurvivor(state);
  s.skills.shooting = shooting;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool", "backpack"]) s.gear[slot] = null;
  s.pockets = [null, null, null, null];
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
// A field battle on an open map at the hub; its stock set to `rounds` (a record) first; the enemy parked off the map.
function openBattle(state, crew, rounds = {}, enemy = { kind: "raiders", count: 2, power: 3 }) {
  const h = hub(state);
  setRounds(h.stock, 0);
  Object.assign(h.stock, rounds);
  h.stock.meds = 0;
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "ammotest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
// An act on your turn (one unit on the field ends the turn with every shot: the turn is given back first).
const act = (st, b, u, a) => { b.phase = "player"; u.ap = 2; return combatAct(st, { unit: u.id, ...a }); };
const foes = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; };

// 1. The tables.
{
  console.log("Tables");
  const want = Object.values(CALIBERS).reduce((a, c) => a + c.types.length, 0) + Object.keys(HAND_SUPPLIES).length; // and the reloading bench's handload keys (reloading.js)
  check(ROUND_KEYS.length === want && ROUND_KEYS.every((k) => SUPPLIES[k] && GEAR[k] && SUPPLY_KEYS.includes(k)), `every calibre and type is a supply and a box (${ROUND_KEYS.length})`);
  check(ROUND_KEYS.every((k) => !STOCK_KEYS.includes(k)) && STOCK_KEYS.includes("ammo"), "the screens list rounds together as Ammo (STOCK_KEYS)");
  check(SUPPLIES.a_9mm_fmj.value === 0.5 && SUPPLIES.a_9mm_fmj.weight === 0.012 && SUPPLIES.a_12ga_slug.value > SUPPLIES.a_12ga_buck.value && SUPPLIES.a_556_ap.value > SUPPLIES.a_556_fmj.value * 2, "per round: 9mm FMJ 0.5 (the old ammo), slugs and AP dearer");
  check(ROUND_KEYS.every((k) => CALIBERS[SUPPLIES[k].round.cal].types.includes(SUPPLIES[k].round.type)), "every round key is a type its calibre has");
  const full = newItem("a_9mm_fmj"), half = { ...newItem("a_9mm_fmj"), dur: 25 };
  check(full.dur === 50 && Math.abs(itemValue(half) - itemValue(full) / 2) < 0.6 && Math.abs(itemKg(half) - itemKg(full) / 2) < 1e-9, `a box's value and weight are linear in what is left (${itemValue(full)} / ${itemValue(half)}, ${itemKg(full)} / ${itemKg(half)} kg)`);
  const guns = Object.entries(WEAPONS).filter(([, w]) => w.ammo > 0 && !w.melee && !w.launcher).map(([k]) => k); // (the roster's launchers: data only until wave 2, no 40 mm or rockets yet)
  check(guns.every((k) => calOf(k) && CALIBERS[calOf(k)]), `every gun has a calibre (${guns.map((k) => `${k} ${calOf(k)}`).join(", ")})`);
  check(!calOf("compbow") && !calOf("machete") && !calOf("acid"), "bows, blades and acid take no rounds");
}

// 2. A common load is today's numbers.
{
  console.log("Common rounds: as before");
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "shotgun"), c = fighter(st, "pistol");
  const b = openBattle(st, [a, c], { a_12ga_buck: 50, a_9mm_fmj: 50 }, { kind: "zombies", count: 2, power: 3 });
  const sh = by(b, a), pi = by(b, c);
  check(sh.load === "buck" && pi.load === "fmj", "your guns take the field on their common round");
  const z = foes(b)[0];
  place(sh, 2, 2); place(pi, 2, 4); place(z, 8, 3); z.aware = true;
  const o1 = shotOdds(b, sh, z);
  const legacy = { ...sh, load: undefined };
  const o0 = shotOdds(b, legacy, z);
  check(JSON.stringify(o1) === JSON.stringify(o0), `a shotgun on buckshot: the same odds as a unit from before (${o1.chance}%, ${o1.dmg.join("–")})`);
  check(softMult(z, shotHit(pi)) === 1 && softMult(z, { how: "shot", weapon: "pistol" }) === 1, "FMJ: no soft-target change");
  check(swarmArmor(shotHit(sh)) === swarmArmor({ how: "shot", weapon: "shotgun" }) && swarmArmor(shotHit(pi)) === swarmArmor({ how: "shot", weapon: "pistol" }), "a worm swarm takes buckshot and FMJ as before");
  const n1 = shotNoise(b, pi, WEAPONS.pistol);
  check(n1 === WEAPONS.pistol.noise * (pi.gm ? pi.gm.noise : 1) || n1 === WEAPONS.pistol.noise, `the noise of a common round as before (${n1})`);
  const hp0 = z.hp;
  const eff = damage(b, z, 20, sh, false, shotHit(sh));
  check(eff === 20 && z.hp === hp0 - 20, "damage of a common round as before");
  const h = shotHit(pi);
  check(h.cal === "9mm" && h.ammo === "fmj" && h.how === "shot" && h.weapon === "pistol", "a shot's hit carries its calibre and type (hit.cal, hit.ammo)");
}

// 3. A gun fires only its own calibre and loaded type; the rounds are physical (mags.js, 2026-10-18): the gun fills
// from the person's own box then the team's bags, a shot comes out of the gun, a Reload only out of what they carry.
{
  console.log("In the fight");
  const st = createWorld({ seed: seed + 1, factionCount: 4 });
  const a = fighter(st, "pistol");
  a.pockets[0] = newBox("a_9mm_fmj", 3);
  a.pockets[1] = Object.assign(newItem("mag_glock_15"), { load: "hp" }); // a spare magazine for hollow points (nothing to fill it with: empty)
  const b = openBattle(st, [a], { a_556_fmj: 60 });
  const u = by(b, a);
  check(u.boxes.length === 0 && u.mag === 3 && a.pockets[0] === null && roundsOf(b, u) === 3, "the box in their pocket counts: its 3 rounds of 9mm FMJ are in the gun, the emptied box thrown away");
  const t = foes(b)[0];
  place(u, 2, 2); place(t, 6, 2); t.hp = t.maxHp = 100000;
  for (let i = 0; i < 3; i++) act(st, b, u, { type: "shoot", target: t.id });
  check(u.mag === 0 && roundsOf(b, u) === 0, "three shots empty the gun");
  check(!canFire(b, u) && /Out of ammo/.test(fireRefusal(b, u)) && /no rounds for the 9mm pistol on them/.test(fireRefusal(b, u)), `with only 5.56 left a 9mm pistol cannot fire ("${fireRefusal(b, u)}")`);
  check(b.pools[0].a_556_fmj === 60, "and no 5.56 was spent");
  b.pools[0].a_9mm_fmj = 10; b.pools[0].a_9mm_hp = 8;
  check(roundsOf(b, u) === 0 && /The base's 10 are in its stock/.test(reloadRefusal(b, u)), `rounds in the team's bags are not the shooter's (roundsOf 0; "${reloadRefusal(b, u)}")`);
  a.pockets[2] = roundItem("a_9mm_fmj", 10, true); a.pockets[3] = roundItem("a_9mm_hp", 8, true);
  refitKit(b, u, a);
  check(roundsOf(b, u) === 10 && roundsOf(b, u, "hp") === 8 && roundsOf(b, u, "*") === 18, "roundsOf follows what they carry, by type");
  b.phase = "player"; u.ap = 2;
  const ap0 = u.ap;
  const why = combatAct(st, { type: "reload", unit: u.id, ammo: "hp" });
  check(!why && u.load === "hp" && u.ap === ap0 - 1 && magShown(b, u) === 6 && amountOf(a.pockets[3]) === 2, `Reload with hollow points: 1 action, 6 by hand from the pocket, the load switched (${u.load}, ${magShown(b, u)}/${u.magMax}; ${amountOf(a.pockets[3])} left)`);
  check(!!reloadRefusal(b, u, "slug"), "no slugs in a pistol");
  act(st, b, u, { type: "shoot", target: t.id });
  check(u.mag === 5 && u.load === "hp" && amountOf(a.pockets[3]) === 2 && b.pools[0].a_9mm_hp === 8, "a shot with hollow points takes a hollow point out of the gun (the pocket and the bags untouched)");
  // Each gun fills from its own box, then the bags; a shot never touches a teammate's box.
  const st2 = createWorld({ seed: seed + 2, factionCount: 4 });
  const p1 = fighter(st2, "pistol"), p2 = fighter(st2, "pistol");
  p2.pockets[1] = newBox("a_9mm_fmj", 2);
  const b2 = openBattle(st2, [p1, p2], { a_9mm_fmj: 20 });
  const u1 = by(b2, p1), u2 = by(b2, p2), t2 = foes(b2)[0];
  check(u1.mag === 15 && u2.mag === 7 && p2.pockets[1] === null && b2.pools[0].a_9mm_fmj === 0, `the first pistol fills 15 out of the bags, the second its own 2 then the bags' last 5 (${u1.mag}, ${u2.mag}); the emptied box thrown away`);
  place(u1, 2, 2); place(u2, 2, 5); place(t2, 7, 2); t2.hp = t2.maxHp = 100000;
  act(st2, b2, u1, { type: "shoot", target: t2.id });
  check(u1.mag === 14 && u2.mag === 7, "a shot comes out of the shooter's gun, nothing else");
  endBattleNow(st2, "victory");
  closeCombat(st2, { take: false });
  check(p2.pockets.some((x) => x && x.key === "a_9mm_fmj" && x.loose && x.dur === 7) && !p2.pockets.some((x) => x && x.key === "a_9mm_fmj" && !x.loose), "after the fight the 7 in the gun are loose in a pocket again; the emptied box is thrown away");
  const st3 = createWorld({ seed: seed + 3, factionCount: 4 });
  const q = fighter(st3, "pistol");
  q.pockets[2] = newBox("a_9mm_fmj", 1);
  const b3 = openBattle(st3, [q], {});
  const uq = by(b3, q), t3 = foes(b3)[0];
  place(uq, 2, 2); place(t3, 6, 2); t3.hp = t3.maxHp = 100000;
  act(st3, b3, uq, { type: "shoot", target: t3.id });
  endBattleNow(st3, "victory");
  closeCombat(st3, { take: false });
  check(q.pockets[2] === null, "an empty box is thrown away when the fight ends");
  // The AI switches type when its own runs out.
  const st4 = createWorld({ seed: seed + 4, factionCount: 4 });
  const r = fighter(st4, "pistol");
  const b4 = openBattle(st4, [r], { a_9mm_hp: 30 });
  const ur = by(b4, r);
  check(ur.load === "hp", `no FMJ at all: the pistol takes the field on what there is (${ur.load})`);
  loadMag(ur, 0);
  r.pockets[0] = roundItem("a_9mm_fmj", 20, true);
  refitKit(b4, ur, r);
  const t4 = foes(b4)[0];
  place(ur, 2, 2); place(t4, 6, 2); t4.hp = t4.maxHp = 100000;
  b4.phase = "player"; ur.ap = 2;
  st4.autoRetreat = false;
  autoPlayerTurn(st4, { retreat: false }); // (a target that soaks every shot would make it run)
  check(ur.load === "fmj" && ur.mag >= 5 && amountOf(r.pockets[0]) === 14, `your side's AI reloads with the type it has on them (${ur.load}; ${b4.log.slice(-3).map((l) => l.text).join(" / ")})`);
}

// 4. Typed effects.
{
  console.log("Typed rounds");
  const st = createWorld({ seed: seed + 5, factionCount: 4 });
  const a = fighter(st, "pistol"), sg = fighter(st, "shotgun");
  const b = openBattle(st, [a, sg], { a_9mm_hp: 40, a_12ga_slug: 20, a_12ga_bird: 20, a_12ga_buck: 20, a_9mm_subsonic: 20 }, { kind: "raiders", count: 2, power: 3 });
  const u = by(b, a), s = by(b, sg);
  const [z, h] = foes(b);
  place(u, 2, 2); place(s, 2, 4); place(z, 6, 2); z.kind = "zombie"; z.ztype = null; z.armor = 1;
  u.load = "hp";
  check(Math.abs(softMult(z, shotHit(u)) - 1.2) < 1e-9, "hollow points: ×1.2 on the unarmoured");
  place(h, 6, 4); h.armorKey = "vest";
  check(softMult(h, shotHit(u)) === 1, "and nothing extra on someone in body armour");
  place(z, 12, 4);
  s.load = "buck"; const buck = shotOdds(b, s, z).chance;
  s.load = "slug"; const slug = shotOdds(b, s, z).chance;
  check(slug > buck, `slugs reach further (${buck}% → ${slug}% at 8 tiles)`);
  check(swarmArmor(shotHit(s)) < swarmArmor({ how: "shot", weapon: "shotgun" }), "a slug loses the spread against a worm swarm");
  place(z, 3, 4);
  s.load = "buck"; const close0 = shotOdds(b, s, z).chance;
  s.load = "bird"; const close1 = shotOdds(b, s, z).chance;
  check(close1 >= close0 && shotOdds(b, s, z).dmg[1] < WEAPONS.shotgun.dmg[1] * s.dmgMult, `birdshot: easier up close, less damage (${close0}% → ${close1}%)`);
  u.load = "fmj"; const loud = shotNoise(b, u, WEAPONS.pistol);
  u.load = "subsonic"; const quiet = shotNoise(b, u, WEAPONS.pistol);
  check(Math.abs(quiet / loud - 0.75) < 1e-9, `subsonic rounds are quieter (${loud} → ${quiet})`);
  const st2 = createWorld({ seed: seed + 6, factionCount: 4 });
  const m = fighter(st2, "huntrifle");
  const b2 = openBattle(st2, [m], { a_308_fmj: 20, a_308_match: 20 });
  const um = by(b2, m), t = foes(b2)[0];
  place(um, 2, 2); place(t, 18, 2);
  um.load = "fmj"; const f0 = shotOdds(b2, um, t).chance;
  um.load = "match"; const f1 = shotOdds(b2, um, t).chance;
  check(f1 > f0, `match rounds aim better at range (${f0}% → ${f1}%)`);
}

// 4b. Less-lethal rounds (the non-lethal branch: hit.nonLethal).
{
  console.log("Beanbags and rubber");
  check(CALIBERS["12ga"].types.includes("beanbag") && CALIBERS["9mm"].types.includes("rubber") && AMMO_TYPES.beanbag.nonlethal && AMMO_TYPES.rubber.nonlethal, "12 gauge beanbags and 9mm (5.56, .308) rubber rounds");
  const u = { weapon: "shotgun", load: "beanbag", side: "player" };
  const h = shotHit(u);
  check(h.nonLethal === true && h.ammo === "beanbag" && !shotHit({ weapon: "shotgun", load: "buck" }).nonLethal, "a beanbag's hit says nonLethal; buckshot's does not");
  let pol = 0, other = 0;
  for (let i = 0; i < 300; i++) {
    for (const k of Object.keys(findRounds("police", 20, i))) if (/beanbag|rubber/.test(k)) pol++;
    for (const th of ["military", "guns", "hunt", "farm", "raider", "home"]) for (const k of Object.keys(findRounds(th, 20, i))) if (/beanbag|rubber/.test(k)) other++;
  }
  check(pol > 0 && other === 0, `only police and prison places hold them (${pol} police finds, ${other} elsewhere)`);
  let bb = 0, n = 0;
  for (let i = 0; i < 400; i++) { const t = enemyLoad("guards", "shotgun", 9, i); n++; if (t === "beanbag") bb++; }
  check(Math.abs(bb / n - 0.3) < 0.08 && enemyLoad("soldiers", "shotgun", 1, 1) !== "beanbag", `police shotguns load beanbags now and then (${Math.round((bb / n) * 100)}%)`);
}

// 5. Enemy loads, bodies.
{
  console.log("The enemy's rounds");
  const st = createWorld({ seed: seed + 7, factionCount: 4 });
  const b = { nextId: 1, turn: 1, floor: 0 };
  const rng = new Rng(seed);
  let ap = 0, rifles = 0, ok = true;
  for (let i = 0; i < 600; i++) {
    const u = enemyUnit(b, rng, "soldiers", 4, i);
    if (calOf(u.weapon)) { if (!CALIBERS[calOf(u.weapon)].types.includes(u.load)) ok = false; }
    if (calOf(u.weapon) === "556") { rifles++; if (u.load === "ap") ap++; }
  }
  check(ok, "every enemy's load is a type of its gun's calibre");
  check(rifles > 50 && Math.abs(ap / rifles - KIT_AMMO.soldiers.rifle.ap) < 0.1, `soldiers' rifles: about ${Math.round(KIT_AMMO.soldiers.rifle.ap * 100)}% armour-piercing (${ap} of ${rifles})`);
  check(enemyLoad("raiders", "pistol", 1, 2) === enemyLoad("raiders", "pistol", 1, 2), "an enemy's load comes from dice of its own (the same every time)");
  // fighters.js: a person's body is what they carried, the rounds for their own gun among it (their kit's load).
  let u = enemyUnit(b, rng, "guards", 4, 1);
  for (let i = 2; i < 40 && !(calOf(u.weapon) && u.load); i++) u = enemyUnit(b, rng, "guards", 4, i);
  const body = enemyBody(new Rng(3), u, null);
  const want = `a_${calOf(u.weapon)}_${u.load}`;
  check(Object.keys(body.supplies).some((k) => k.startsWith(`a_${calOf(u.weapon)}_`) && body.supplies[k] > 0) && !body.supplies.ammo, `their body: rounds of their calibre and load (${want}: ${JSON.stringify(body.supplies)})`);
  const z = { kind: "zombie", weapon: "claws", id: 5, name: "Zombie 5" };
  let zb = null;
  for (let i = 0; i < 80 && !zb; i++) { const bb = enemyBody(new Rng(i), z, null); if (Object.keys(bb.supplies).some(isRoundKey)) zb = bb; }
  check(!!zb && !zb.supplies.ammo, "one of the dead now and then has a box of something (never generic ammo)");
}

// 6. Starting colonists.
{
  console.log("Starting colonists");
  const types = {};
  let bad = 0, boxes = 0;
  for (let i = 0; i < 3000; i++) {
    for (const k of ["pistol", "shotgun", "huntrifle", "revolver", "leverrifle", "ar"]) {
      const it = newItem(k);
      const box = starterLoad({ state: i * 7919 + 13 }, it, i);
      const t = it.load || "common";
      types[`${k}:${t}`] = (types[`${k}:${t}`] || 0) + 1;
      if (["ap", "api", "match"].includes(it.load)) bad++;
      if (box) { boxes++; if (box.key !== ammoKey(calOf(k), it.load)) bad++; }
    }
  }
  check(!bad, "never AP, API or match; the box is of the load");
  const share = (k, t) => (types[`${k}:${t}`] || 0) / 3000;
  check(Math.abs(share("pistol", "hp") - 0.2) < 0.04 && Math.abs(share("shotgun", "slug") - 0.15) < 0.04 && Math.abs(share("huntrifle", "sp") - 0.4) < 0.05 && !share("ar", "ap"), `pistols 20% HP (${share("pistol", "hp").toFixed(2)}), shotguns 15% slugs, hunting rifles 40% SP; 5.56 common only`);
  const st = createWorld({ seed: seed + 8, factionCount: 4 });
  const h = hub(st);
  check(!h.stock.ammo && totalRounds(h.stock) >= 80 && roundsIn(h.stock, "9mm") > 0 && roundsIn(h.stock, "308") > 0, `a new hub's 80 rounds go by its guns' calibres (${JSON.stringify(Object.fromEntries(ROUND_KEYS.filter((k) => h.stock[k] > 0).map((k) => [k, h.stock[k]])))})`);
}

// 7. The economy.
{
  console.log("The economy");
  const rec = { ammo: 100 };
  settleRec(rec, mixForCals({ "9mm": 2, "308": 1 }), { "9mm": 2, "308": 1 });
  check(!rec.ammo && rec.a_9mm_fmj === 67 && rec.a_308_fmj === 33 && totalRounds(rec) === 100, `generic ammo settled by the guns there (${rec.a_9mm_fmj} 9mm, ${rec.a_308_fmj} .308)`);
  rec.a_22lr_fmj = 30; rec.ammo = -40;
  settleRec(rec, mixForCals({ "9mm": 2, "308": 1 }), { "9mm": 2, "308": 1 });
  check(rec.a_22lr_fmj === 0 && totalRounds(rec) === 90 && rec.a_9mm_fmj + rec.a_308_fmj === 90, "generic ammo taken out comes from the calibres nobody shoots first");
  const f1 = findRounds("police", 30, "x", 1), f2 = findRounds("police", 30, "x", 1);
  check(JSON.stringify(f1) === JSON.stringify(f2) && Object.values(f1).reduce((a, q) => a + q, 0) === 30, `a find: its rounds on dice of its own (${JSON.stringify(f1)})`);
  check(themeOf("gunstore") === "guns" && themeOf("police") === "police" && themeOf("military") === "military" && themeOf("farm") === "farm" && themeOf("armory", true) === "military", "finds by site type (gun store, police, military, farm)");
  let mil = 0, milN = 0;
  for (let i = 0; i < 400; i++) for (const [k, q] of Object.entries(findRounds("military", 20, i))) { milN += q; if (/556|308|50bmg/.test(k)) mil += q; }
  check(mil / milN > 0.6, `a military site's rounds are mostly 5.56 and .308 (${Math.round((mil / milN) * 100)}%)`);
  // Shots by the numbers, by calibre.
  const st = createWorld({ seed: seed + 9, factionCount: 4 });
  const a = fighter(st, "pistol"), c = fighter(st, "huntrifle");
  const stock = { a_9mm_fmj: 10, a_556_fmj: 200 };
  const d = drawShots(stock, [a, c], 6);
  check(d.n === 6 && stock.a_9mm_fmj === 4 && stock.a_556_fmj === 200, "by the numbers a team shoots only the rounds that fit its guns (the rifle has none)");
  check(armedFactor([a, c], { a_9mm_fmj: 100 }, 0) < 1 && armedFactor([a, c], { a_9mm_fmj: 100, a_308_fmj: 100 }, 0) === 1 && armedFactor([a, c], 200, 0) === 1, "the armed factor judges each gun by its own calibre (numbers: the old rule)");
  const sp = spendShots({ a_9mm_fmj: 20, a_308_fmj: 20 }, [a, c], 3);
  check(sp.ammo === 6 && sp.used.a_9mm_fmj === 3 && sp.used.a_308_fmj === 3, "spendShots: each gun its own calibre");
  check(ammoEdge({ a_556_ap: 30 }, { kind: "soldiers" }) > 1 && ammoEdge({ a_9mm_hp: 30 }, { kind: "zombies" }) > 1 && ammoEdge({ a_9mm_fmj: 30 }, { kind: "soldiers" }) === 1, "R8: AP against soldiers, hollow points against the dead; common rounds 1");
  // Packing by the crew's guns.
  const h = hub(st);
  setRounds(h.stock, 0);
  Object.assign(h.stock, { a_9mm_fmj: 100, a_308_fmj: 100, a_12ga_buck: 100, food: 100, water: 100 });
  // (loadout false: the plan's line alone; a launch also takes its guns' and spares' loads, checked below)
  const res = launchExpedition(st, { memberIds: [a.id, c.id], dest: h.tile, mission: "move", stance: "normal", supplies: { food: 4, water: 4, ammo: 40 }, loadout: false });
  // Some of each gun's share rides at hand (carrykit.js looseWant), out of the same 40.
  const packed = res.error ? {} : { ...carriedRec([a, c]) };
  if (!res.error) for (const k of ROUND_KEYS) if (res.party.supplies[k] > 0) packed[k] = (packed[k] || 0) + res.party.supplies[k];
  check(!res.error && packed.a_9mm_fmj === 20 && packed.a_308_fmj === 20 && !packed.a_12ga_buck && h.stock.a_12ga_buck === 100, `a plan's 40 ammo packed as the rounds that fit, in the pack and at hand (${res.error || JSON.stringify(packed)})`);
  // Physical rounds (mags.js, 2026-10-18): a launch also takes the rounds its guns leave loaded with (gunrounds.js
  // loadoutRounds) out of the stores, on top of the plan's line, which stays a reserve.
  for (const m of res.party.members) { const s0 = st.survivors.find((x) => x.id === m); if (s0) s0.location = { kind: "base", baseId: h.id }; }
  st.parties = st.parties.filter((x) => x !== res.party);
  for (const s of [a, c]) { for (const it of boxesOf(s)) it.dur = 0; sweepBoxes(s); } // (the first launch's rounds at hand put away)
  setRounds(h.stock, 0);
  Object.assign(h.stock, { a_9mm_fmj: 100, a_308_fmj: 100, a_12ga_buck: 100 });
  const caps = [a, c].reduce((n, x) => n + ((WEAPONS[x.gear.weapon.key] || {}).cap || 0), 0);
  const res2 = launchExpedition(st, { memberIds: [a.id, c.id], dest: h.tile, mission: "move", stance: "normal", supplies: { food: 4, water: 4, ammo: 40 } });
  const onThem = carriedRec([a, c]);
  const took = res2.error ? 0 : ROUND_KEYS.reduce((n, k) => n + (res2.party.supplies[k] || 0) + (onThem[k] || 0), 0);
  check(!res2.error && took >= 40 + caps && h.stock.a_12ga_buck === 100, `...and the guns' loads on top (${took} rounds: the 40 and ${took - 40} for their guns and spares, at least the guns' ${caps})`);
  // The bench makes the calibres of the guns there, the shortest first.
  const st2 = createWorld({ seed: seed + 10, factionCount: 4 });
  const h2 = hub(st2);
  setRounds(h2.stock, 0);
  h2.stock.a_9mm_fmj = 200;
  const made = benchRounds(st2, h2, 10);
  check(Object.keys(made).every((k) => ["9mm", "308"].includes(SUPPLIES[k].round.cal)) && (made.a_308_fmj || 0) > (made.a_9mm_fmj || 0), `the ammo bench makes the guns' calibres, the one short of rounds first (${JSON.stringify(made)})`);
  check(baseAmmo(st2, h2) === roundsIn(h2.stock, "9mm") + roundsIn(h2.stock, "308"), "a base's usable ammo: the rounds that fit its guns");
  // A group's one ammo count.
  const f = st2.factions.find((x) => x.type === "military") || st2.factions[0];
  f.stock.ammo = 600; f.pop = 10;
  const share = available(f, "a_556_fmj"), all = available(f, "ammo");
  check(share > 0 && share < all && ROUND_KEYS.reduce((a2, k) => a2 + available(f, k), 0) <= all, `a group offers its ammo by its kind's mix (${f.type}: ${share} of ${all} as 5.56 FMJ)`);
  check(Math.abs(sellPrice(st2, f, "a_9mm_fmj", 0, 10) / SUPPLIES.a_9mm_fmj.value - sellPrice(st2, f, "ammo", 0, 10) / SUPPLIES.ammo.value) < 1e-9, "a round is priced at the group's whole ammo count");
  const g = { ammo: 10, a_9mm_fmj: 5, a_556_fmj: -2 };
  foldRounds(g);
  check(g.ammo === 13 && !("a_9mm_fmj" in g), "rounds given to a group fold into its one count");
  // Hunting with the gun's calibre and load (R9).
  const hs = fighter(st2, "huntrifle");
  check(!bestHuntWeapon(hs, { a_9mm_fmj: 50 }) && !!bestHuntWeapon(hs, { a_308_fmj: 5 }) && !!bestHuntWeapon(hs, 5), "a hunter's rifle needs its own calibre (a number: the old rule)");
  hs.gear.weapon.load = "sp";
  const big0 = bestHuntWeapon(hs, { a_308_fmj: 5 }).w.big, big1 = bestHuntWeapon(hs, { a_308_sp: 5 }).w.big;
  check(big1 > big0 && huntLoad(hs.gear.weapon, { a_308_sp: 5 }).type === "sp", `soft points drop big game cleaner (${big0.toFixed(2)} → ${big1.toFixed(2)})`);
}

// 8. Old saves.
{
  console.log("Old saves");
  const st = createWorld({ seed: seed + 11, factionCount: 4 });
  const h = hub(st);
  setRounds(h.stock, 0);
  h.stock.ammo = 150;
  const before = totalRounds(h.stock);
  migrateAmmo(st);
  check(!h.stock.ammo && totalRounds(h.stock) === before, `migrated: ${before} generic rounds are ${totalRounds(h.stock)} by calibre`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
