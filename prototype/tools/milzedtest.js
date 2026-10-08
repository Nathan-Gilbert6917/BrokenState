// The armoured dead (sim/deadsoldiers.js; ZTYPES.soldier and ZTYPES.riot in hiveconst.js) and the bodies of the fallen
// (ui/downsprites.js; zombie bodies to search in raids). Checks:
//   - the types exist, stronger than the ordinary dead (health, armour) and no faster; never bred by a hive
//   - armour by weapon: pistol rounds and blades do much less, rifles mostly get through (×0.7–0.75), the sledge fully; a critical hit,
//     a blade from behind or on the unaware, fire and pipe bombs get through (on the battle map, through damage())
//   - where they are: military sites, army wrecks, the cordon round a base, a fallen base (hardcore), police stations;
//     rare elsewhere; deterministic; hordes crossing a military site pick some up; makeHorde({ mix: { soldier } })
//     works into a base defence battle
//   - their bodies: worn armour, a helmet, rounds (battle loot screen, raid containers, the hour-by-hour search)
//   - zombie bodies are searchable in raids, every human body too; modest contents
//   - the sprites: a standing soldier and riot cop, and a downed picture for every kind of dead and person (painted
//     headlessly: pixel grids, all different), searched bodies look searched; the battle views draw them
//   - balance: a dead soldier against a walker for a knife, a pistol, a shotgun, a hunting rifle and a sledge (and a
//     few more): damage per hit, hits to kill, a one-on-one fight on the map and a team of three against six; raids at
//     a National Guard base with and without them.
// Usage: node tools/milzedtest.js [fights per matchup = 60] [seed = 7] [quick]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { GEAR, LOCATIONS } from "../src/sim/data.js";
import { ZTYPES, GROWTHS } from "../src/sim/hiveconst.js";
import { applyZType, ZKINDS, battleTypes, mixList, typeStrength, mixWeight } from "../src/sim/zombietypes.js";
import { MILDEAD, ARMORED, armorVs, siteDeadMix, hordeMilitaryPickup, bodyLoot } from "../src/sim/deadsoldiers.js";
import { createBattle, enemyUnit, damage, WEAPONS, registerCombatHandler, autoPlayerTurn, runEnemyPhase, closeCombat, active, ZOMBIE_MOVE, combatAct, CRIT_MULT, CRIT, meleeOdds, shotOdds } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { enemyBody, newItem, deadBodyFinds, allItems } from "../src/sim/inventory.js";
import { launchExpedition } from "../src/sim/parties.js";
import { makeHorde } from "../src/sim/hordes.js";
import { landEffect } from "../src/sim/throwables.js";
import { Rng } from "../src/sim/rng.js";
import { readFileSync } from "node:fs";

const N = Number(process.argv[2] || 60);
const SEED = Number(process.argv[3] || 7);
const QUICK = process.argv.includes("quick");
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
const r2 = (v) => Math.round(v * 100) / 100;
let last = null;
registerCombatHandler("milz", (st, res) => { last = res; });
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };

// ---------- the types ----------
section("The armoured dead (hiveconst.js ZTYPES, deadsoldiers.js)");
{
  const S = ZTYPES.soldier, R = ZTYPES.riot;
  check(S && S.name === "Dead soldier" && R && R.name === "Dead riot cop" && ZKINDS.includes("soldier") && ZKINDS.includes("riot"), "ZTYPES.soldier (Dead soldier) and ZTYPES.riot (Dead riot cop) exist and are among the kinds of dead");
  check(S.hp > 1 && R.hp > 1 && S.dmg === 1 && S.weight > 1.3, `more health than the ordinary dead (×${S.hp}, riot ×${R.hp}), a normal bite, worth more in a fight by the numbers (×${S.weight})`);
  check(!Object.values(GROWTHS).some((G) => G.unlocks === "soldier" || G.unlocks === "riot") && S.share === 0, "no hive breeds them (no growth unlocks them)");
  const b = { nextId: 1, rng: new Rng(1) };
  for (const p of [2, 3, 5, 7]) {
    const u = enemyUnit(b, b.rng, "zombies", p, 1), z = enemyUnit(b, b.rng, "zombies", p, 2);
    applyZType(u, "soldier", false, p);
    if (!(u.maxHp > z.maxHp && u.mob <= ZOMBIE_MOVE && u.dmgMult === z.dmgMult && u.armor < 1 && u.name.startsWith("Dead soldier"))) { check(false, `power ${p}: stronger, no faster`); break; }
    if (p === 7) check(true, `at every strength (2–7): health ${z.maxHp} → ${u.maxHp} at power 7, moves ${u.mob} (the ordinary dead ${z.mob}: never faster than a walker), the same bite`);
  }
}

section("Armour by weapon (deadsoldiers.js armorVs; combat.js damage)");
{
  const t = { ztype: "soldier", armor: 0.6, aware: true, face: [1, 0], x: 5, y: 5 };
  const r = { ...t, ztype: "riot" };
  const vs = (u, w, how = WEAPONS[w].melee ? "melee" : "shot", extra = {}) => armorVs(u, { weapon: w, x: 4, y: 5 }, { how, ...extra });
  check(vs(t, "pistol") <= 0.5 && vs(t, "knife") <= 0.4 && vs(t, "machete") <= 0.5, `a soldier: pistol ×${vs(t, "pistol")}, knife ×${vs(t, "knife")}, machete ×${vs(t, "machete")} (a real reduction)`);
  // Rifles: most of it, but not all (×0.7–0.8: the hunting rifle was ×0.9, all but a full counter).
  check(vs(t, "huntrifle") >= 0.7 && vs(t, "huntrifle") <= 0.8 && vs(t, "ar") >= 0.7 && vs(t, "ar") <= 0.8 && vs(t, "sledge") >= 0.95 && vs(t, "bat") >= 0.8, `rifles mostly get through, heavy blunt weapons all but fully: hunting rifle ×${vs(t, "huntrifle")}, assault rifle ×${vs(t, "ar")}, sledge ×${vs(t, "sledge")}, bat ×${vs(t, "bat")}`);
  check(vs(t, "pistol", "shot", { crit: true }) === 1 && vs(t, "knife", "melee", { crit: true }) === 1, "a critical hit (a round under the helmet, a blade in a gap) ignores the armour");
  check(vs(t, "knife", "melee", { sneak: true }) === 1 && armorVs(t, null, { how: "fire" }) === 1 && armorVs(t, null, { how: "blast" }) >= 0.85, `a blade from behind / unseen, fire (×1) and a pipe bomb (×${armorVs(t, null, { how: "blast" })}) get through`);
  check(vs(r, "bat") <= 0.65 && vs(r, "knife") <= 0.5 && vs(r, "huntrifle") === 1 && vs(r, "carbine") === 1 && vs(r, "pistol") < 0.8, `a riot cop: bat ×${vs(r, "bat")}, knife ×${vs(r, "knife")}, pistol ×${vs(r, "pistol")}, but rifles ×1`);
  check(armorVs({ armor: 1 }, { weapon: "pistol" }, { how: "shot" }) === 1 && armorVs({ ztype: "brute", armor: 0.75 }, { weapon: "pistol" }, { how: "shot" }) === 0.75, "everyone else keeps their own armour (the ordinary dead ×1, a brute ×0.75)");
  // On the battle map: damage() with the attacker and the kind of hit; stabsGap from behind / unaware.
  const st = createWorld({ seed: SEED, factionCount: 4 });
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 2);
  const b = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count: 3, power: 3, types: { soldier: 3 } }, ambush: null, canRetreat: true, handler: "milz", context: {} }));
  st.combat = b;
  const sol = b.units.filter((u) => u.ztype === "soldier");
  const me = b.units.find((u) => u.side === "player");
  check(sol.length === 3, `a battle with enemy.types { soldier: 3 } has 3 dead soldiers (${sol.map((u) => u.name).join(", ")})`);
  const z = sol[0];
  z.hp = z.maxHp = 200;
  const hp0 = z.hp;
  me.weapon = "pistol";
  const e1 = damage(b, z, 20, me, false, { how: "shot", crit: false });
  me.weapon = "huntrifle";
  const e2 = damage(b, z, 20, me, false, { how: "shot", crit: false });
  const e3 = damage(b, z, 20, me, false, { how: "shot", crit: true });
  check(r2(e1) === 20 * MILDEAD.ARMOR.soldier.w.pistol && r2(e2) === r2(20 * MILDEAD.ARMOR.soldier.w.huntrifle) && r2(e3) === 20 && r2(hp0 - z.hp) === r2(e1 + e2 + e3), `20 raw: a pistol round does ${r2(e1)}, a hunting rifle ${r2(e2)}, a critical ${r2(e3)}`);
  const z2 = sol[1];
  z2.hp = z2.maxHp = 200;
  z2.x = me.x + 1; z2.y = me.y; z2.face = [1, 0]; z2.aware = true; // facing away from me: I am behind it
  me.weapon = "knife";
  const before = z2.hp;
  for (let i = 0; i < 40 && z2.hp === before; i++) combatAct(st, { type: "melee", unit: me.id, target: z2.id }), me.ap = 2;
  const dealt = before - z2.hp;
  check(dealt >= 14, `a knife from behind goes in under the helmet: ${r2(dealt)} (14–22 raw, nothing taken off)`);
  // Fire: a Molotov on a soldier: full damage (vs a brute, its own armour).
  const z3 = sol[2];
  z3.hp = z3.maxHp = 200;
  const f0 = z3.hp;
  landEffect(b, me, { fx: "fire" }, z3.x, z3.y);
  check(f0 - z3.hp >= 12, `a Molotov burns a dead soldier for the full 12–18 (${r2(f0 - z3.hp)})`);
  st.combat = null;
}

// The user's rules: "Military zombies with armor should take less damage from melee and bullets and deal the same
// amount of damage as a normal walker"; "a critical chance that doubles damage" (combat.js CRIT_MULT).
section("Their bite, their armour, critical hits (combat.js meleeOdds, damage, CRIT_MULT)");
{
  const st = createWorld({ seed: SEED + 1, factionCount: 4 });
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 1);
  const b = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count: 5, power: 3, types: { soldier: 2, riot: 1 } }, ambush: null, canRetreat: true, handler: "milz", context: {} }));
  st.combat = b;
  const me = b.units.find((u) => u.side === "player");
  me.meleeMult = 1; me.critBonus = 0; me.assassin = false; me.dmgMult = 1;
  const walker = b.units.find((u) => u.kind === "zombie" && !u.ztype), sol = b.units.find((u) => u.ztype === "soldier"), riot = b.units.find((u) => u.ztype === "riot");
  // The bite: the same weapon, the same odds and damage from the same spot (no power, elite or military bonus).
  const bite = (z) => { const x = z.x, y = z.y; z.x = walker.x; z.y = walker.y; const o = meleeOdds(b, z, me); z.x = x; z.y = y; return o; };
  const ow = bite(walker), os = bite(sol), orr = bite(riot);
  check(sol.weapon === walker.weapon && riot.weapon === walker.weapon && sol.dmgMult === walker.dmgMult && riot.dmgMult === walker.dmgMult && sol.meleeAim === walker.meleeAim && sol.ap === walker.ap
    && JSON.stringify(os) === JSON.stringify(ow) && JSON.stringify(orr) === JSON.stringify(ow),
    `a dead soldier and a riot cop bite like a walker: ${ow.chance}% to hit, ${ow.dmg[0]}–${ow.dmg[1]} damage, ${ow.crit}% crit (all three)`);
  // The armour: less from bullets and blades (and gun butts), never from a walker's own hide.
  const hit = (z, w, how, crit = false) => { z.hp = z.maxHp = 500; me.weapon = w; return r2(damage(b, z, 20, me, false, { how, crit })); };
  const rows = [["pistol", "shot"], ["shotgun", "shot"], ["huntrifle", "shot"], ["ar", "shot"], ["knife", "melee"], ["machete", "melee"], ["bat", "melee"], ["pistol", "bash"]];
  const cut = rows.map(([w, how]) => ({ w, how, walker: hit(walker, w, how), sol: hit(sol, w, how), riot: hit(riot, w, how) }));
  check(cut.every((r) => r.walker === 20 && r.sol < 20 && r.riot < 20 || (r.walker === 20 && r.sol < 20 && r.riot === 20 && ["huntrifle", "ar"].includes(r.w))),
    `20 raw, walker / soldier / riot cop: ${cut.map((r) => `${r.w}${r.how === "bash" ? " butt" : ""} ${r.walker}/${r.sol}/${r.riot}`).join(", ")} (a riot vest does not stop rifle rounds)`);
  // Critical hits: × CRIT_MULT, through the armour. The battle's dice forced (hit, crit or not, the lowest damage).
  const forced = (critOn, fn) => { const real = b.rng; b.rng = Object.assign(Object.create(real), { chance: (p) => (p >= 1 || critOn.length ? critOn.shift() ?? true : true), int: (lo) => lo }); try { return fn(); } finally { b.rng = real; } };
  const strikeAt = (z, w, crit) => { z.hp = z.maxHp = 500; z.x = me.x + 1; z.y = me.y; z.aware = true; z.face = [-1, 0]; me.weapon = w; me.ap = 2; b.phase = "player"; b.queue = []; const hp0 = z.hp; forced([true, crit], () => combatAct(st, { type: "melee", unit: me.id, target: z.id })); return r2(hp0 - z.hp); };
  const lo = WEAPONS.knife.dmg[0];
  const wN = strikeAt(walker, "knife", false), wC = strikeAt(walker, "knife", true), sN = strikeAt(sol, "knife", false), sC = strikeAt(sol, "knife", true);
  check(CRIT_MULT === 2 && wN === lo && wC === lo * CRIT_MULT && sC === lo * CRIT_MULT && sN === r2(lo * MILDEAD.ARMOR.soldier.w.knife),
    `a critical hit doubles the damage (CRIT_MULT ${CRIT_MULT}): a knife's lowest ${lo} on a walker ${wN} → ${wC} critical; on a dead soldier's front ${sN} → ${sC} critical (through the armour)`);
  const shootAt = (z, crit) => { z.hp = z.maxHp = 500; z.x = me.x + 1; z.y = me.y; me.weapon = "pistol"; me.gearRisk = 0; me.ap = 2; b.phase = "player"; b.queue = []; const hp0 = z.hp; forced([true, crit], () => combatAct(st, { type: "shoot", unit: me.id, target: z.id })); return r2(hp0 - z.hp); };
  const plo = Math.round(WEAPONS.pistol.dmg[0] * me.dmgMult);
  const pN = shootAt(walker, false), pC = shootAt(walker, true), psN = shootAt(sol, false), psC = shootAt(sol, true);
  check(pN === plo && pC === plo * CRIT_MULT && psN === r2(plo * MILDEAD.ARMOR.soldier.w.pistol) && psC === plo * CRIT_MULT, `and a shot: a pistol's lowest ${plo} on a walker ${pN} → ${pC} critical; on a dead soldier ${psN} → ${psC} critical`);
  const so = shotOdds(b, me, walker), mo = meleeOdds(b, me, walker);
  check(so.crit > 0 && mo.crit > 0 && shotOdds(b, me, walker, me.x, me.y, { reaction: true }).crit === 0, `crit chances: a shot at one of the dead in the open ${so.crit}%, a blow ${mo.crit}%, an overwatch reaction shot none`);
  st.combat = null;
}

// ---------- where ----------
section("Where they are (deadsoldiers.js siteDeadMix, scavenge.js raidEnemies)");
const st = createWorld({ seed: SEED, factionCount: 6 });
{
  const g = st.grid;
  const mil = st.tiles.filter((t) => t.loc && t.loc.type === "military");
  const pol = st.tiles.filter((t) => t.loc && t.loc.type === "police");
  check(mil.length > 0 && mil.every((t) => (siteDeadMix(st, t.id) || {}).soldier >= 0.4), `every National Guard base (${mil.length}): ${Math.round(MILDEAD.SITE.military.soldier * 100)}% of its dead are soldiers`);
  check(!pol.length || pol.every((t) => (siteDeadMix(st, t.id) || {}).riot >= 0.25), `police stations (${pol.length}): riot police among the dead`);
  const groups = raidEnemies(st, mil[0].id);
  const zg = groups.find((x) => x.kind === "zombies");
  check(zg && zg.mix && zg.mix.soldier >= 0.4, `a raid at ${mil[0].loc.name}: the dead come with a mix ${JSON.stringify(zg && zg.mix)} (${zg && zg.count} of the dead, ${zg && battleTypes(zg.mix, zg.count) ? battleTypes(zg.mix, zg.count).soldier : 0} soldiers)`);
  // Away from military places: rare.
  const far = st.tiles.filter((t) => t.terrain !== "water" && !mil.some((m) => g.distance(m.id, t.id) <= 3) && !(t.loc && MILDEAD.SITE[t.loc.type]));
  let withSoldiers = 0, units = 0, dead = 0;
  for (const t of far) {
    const m = siteDeadMix(st, t.id);
    if (m && m.soldier) withSoldiers++;
    const n = 6;
    dead += n;
    units += mixList(m, n).filter((k) => k === "soldier").length;
  }
  check(withSoldiers / far.length < 0.06 && units / dead < 0.02, `away from military places (${far.length} tiles): ${(withSoldiers / far.length * 100).toFixed(1)}% have a lone soldier among the dead, ${(units / dead * 100).toFixed(2)}% of the dead overall`);
  const near = st.tiles.filter((t) => mil.some((m) => g.distance(m.id, t.id) === 1));
  check(near.length && near.every((t) => (siteDeadMix(st, t.id) || {}).soldier >= MILDEAD.NEAR - 1e-9), `next to a base (the cordon, ${near.length} tiles): ${MILDEAD.NEAR * 100}%`);
  check(JSON.stringify(st.tiles.map((t) => siteDeadMix(st, t.id))) === JSON.stringify(st.tiles.map((t) => siteDeadMix(st, t.id))), "deterministic: the same tile has the same dead (no world dice)");
  // An army wreck, a fallen military base (hardcore).
  const t0 = far.find((t) => !t.loc);
  const loc0 = t0.loc;
  t0.loc = { type: "crash_mil", name: "Army helicopter wreck" };
  check((siteDeadMix(st, t0.id) || {}).soldier >= 0.5, "an army helicopter wreck: half its dead are the crew");
  t0.loc = loc0;
  st.hardcore = { groups: { military: { fell: true, tile: t0.id } } };
  const nb = g.within(t0.id, 1).find((id) => id !== t0.id);
  check(siteDeadMix(st, t0.id).soldier === MILDEAD.FALLEN[0] && siteDeadMix(st, nb).soldier >= MILDEAD.FALLEN[1], `a fallen military base (hardcore): ${MILDEAD.FALLEN[0] * 100}% there, ${MILDEAD.FALLEN[1] * 100}% around it`);
  delete st.hardcore;
  // Hordes crossing a base pick some up (no base of anyone standing there).
  const h = makeHorde(st, { tile: mil[0].id, size: 80, role: "roam" });
  const owned = st.bases.some((x) => x.tile === mil[0].id) || st.factions.some((f) => f.alive && f.bases.includes(mil[0].id));
  const got = hordeMilitaryPickup(st, h);
  for (let i = 0; i < 5; i++) hordeMilitaryPickup(st, h);
  check(owned ? !got : got && h.mix.soldier > 0.05 && h.mix.soldier <= MILDEAD.HORDE_MAX + 1e-9 && h.size === 80, owned ? "a horde at a base someone holds picks up nobody" : `a horde crossing ${mil[0].loc.name} picks up dead soldiers: ${Math.round(h.mix.soldier * 100)}% (at most ${MILDEAD.HORDE_MAX * 100}%, however often it passes)`);
  st.hordes.splice(st.hordes.indexOf(h), 1);
  // The horde of the fallen (hardcore-groups.js): makeHorde with mix { soldier: 0.6 } into a base defence.
  const hf = makeHorde(st, { tile: hub(st).tile, size: 40, role: "attack", mix: { soldier: 0.6 } });
  const types = battleTypes(hf.mix, 12);
  // The hardcore military arc's strike (hardcore-groups.js): soldiers lost merge into a hive's guard by mergeMix.
  const { mergeMix } = await import("../src/sim/zombietypes.js");
  const gm = mergeMix({ runner: 0.1 }, 90, { soldier: 1 }, 10);
  check(gm && gm.soldier === 0.1 && gm.runner === 0.09, `mergeMix keeps the soldiers merged into a guard (${JSON.stringify(gm)})`);
  check(types && types.soldier === 7 && typeStrength({ count: 12, types }) > 1.4 && mixWeight(hf.mix) > 1.4, `makeHorde({ mix: { soldier: 0.6 } }): 12 of them in a battle are ${types.soldier} dead soldiers; worth ×${r2(mixWeight(hf.mix))} by the numbers`);
  st.hordes.splice(st.hordes.indexOf(hf), 1);
}

// ---------- bodies ----------
section("Their bodies (deadsoldiers.js bodyLoot; inventory.js enemyBody, deadBodyFinds; combat.js searchBox)");
{
  const rng = new Rng(SEED);
  const n = 2000, tally = {}, sup = {};
  let armorQ = 0, armorN = 0;
  const b = { nextId: 1 };
  for (let i = 0; i < n; i++) {
    const u = applyZType(enemyUnit(b, rng, "zombies", 3, 1), "soldier", false, 3);
    const body = enemyBody(rng, u, null);
    for (const it of allItems(body)) { tally[it.key] = (tally[it.key] || 0) + 1; if (it.key === "vest" || it.key === "plate" || it.key === "milhelmet") { armorQ += it.quality; armorN++; } }
    for (const [k, v] of Object.entries(body.supplies)) sup[k] = (sup[k] || 0) + v;
  }
  const pct = (k) => Math.round(((tally[k] || 0) / n) * 100);
  check(pct("vest") + pct("plate") >= 30 && pct("milhelmet") >= 25 && sup.ammo / n >= 3, `a dead soldier's body (${n}): a vest ${pct("vest")}%, a plate carrier ${pct("plate")}%, a combat helmet ${pct("milhelmet")}%, an assault rifle ${pct("ar")}%, a carbine ${pct("carbine")}%, a radio ${pct("milradio")}%, a smoke grenade ${pct("smokegren")}%; ${r2(sup.ammo / n)} rounds a body`);
  check(armorQ / armorN < 0.7, `the armour on them is worn: ${Math.round((armorQ / armorN) * 100)}% condition on average`);
  const zf = { items: 0, ammo: 0, pistol: 0 };
  for (let i = 0; i < n; i++) { const f = deadBodyFinds(rng, null); zf.items += f.gear.length; zf.ammo += f.sup.ammo || 0; zf.pistol += f.gear.some((g) => g.key === "pistol") ? 1 : 0; }
  check(zf.items / n < 0.45 && zf.ammo / n < 1.5 && zf.pistol / n < 0.04, `one of the ordinary dead (raid body): ${r2(zf.items / n)} items, ${r2(zf.ammo / n)} rounds a body, a pistol ${Math.round((zf.pistol / n) * 1000) / 10}% (a bonus, not the loot)`);
  check(GEAR.milhelmet && GEAR.milhelmet.slot === "head", "the combat helmet is an item (head slot)");
  const rl = { riothelmet: 0 };
  for (let i = 0; i < 500; i++) for (const g of bodyLoot(rng, "riot", newItem).gear) rl[g.key] = (rl[g.key] || 0) + 1;
  check(rl.riothelmet > 100 && rl.baton > 20, `a dead riot cop: a riot helmet ${Math.round(rl.riothelmet / 5)}%, a baton ${Math.round(rl.baton / 5)}%, cuffs ${Math.round((rl.cuffs || 0) / 5)}%`);
}

// ---------- raids: bodies to search, harder and richer at a base ----------
function raidAt(state, tile, opts = {}) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, 3);
  for (const s of crew) { s.health = 100; if (opts.weapon) s.gear.weapon = newItem(opts.weapon); s.skills.shooting = Math.max(s.skills.shooting || 0, 6); }
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60, meds: 2 } });
  if (res.error) return null;
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  const groups = raidEnemies(state, tile);
  if (opts.noMix) for (const g of groups) delete g.mix;
  const setup = { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "milz", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5 }, context: {} };
  state.combat = createBattle(state, setup);
  const b = state.combat;
  const start = { soldiers: b.units.filter((u) => u.ztype === "soldier").length, dead: b.units.filter((u) => u.kind === "zombie").length };
  let guard = 0;
  while (!b.over && guard++ < 200) { autoPlayerTurn(state); runEnemyPhase(state); }
  const zb = b.raid.containers.filter((c) => c.kind === "body" && c.zombie);
  const out = { ...start, over: b.over, result: b.result, zbodies: zb.length, zsearched: zb.filter((c) => c.searched).length, solBodies: zb.filter((c) => c.ztype === "soldier").length, solSearched: zb.filter((c) => c.ztype === "soldier" && c.searched).length, b };
  state.combat = null;
  return out;
}
section("Raids: the dead soldiers at a National Guard base, bodies to search");
{
  let s1 = null;
  for (let i = 0; i < 6 && !(s1 && s1.zbodies); i++) {
    const w = createWorld({ seed: SEED * 100 + i, factionCount: 6 });
    const t = w.tiles.find((x) => x.loc && x.loc.type === "military" && !w.factions.some((f) => f.bases.includes(x.id)));
    if (t) s1 = raidAt(w, t.id, { weapon: "huntrifle" });
  }
  check(s1 && s1.soldiers > 0, `a raid at a base has dead soldiers among the dead (${s1 && s1.soldiers} of ${s1 && s1.dead})`);
  check(s1 && s1.zbodies > 0 && s1.b.raid.containers.filter((c) => c.kind === "body" && c.zombie).every((c) => c.uid != null && c.label.endsWith("'s body")), `the dead killed in it left bodies to search (${s1 && s1.zbodies}, ${s1 && s1.zsearched} searched by the bot; dead soldiers ${s1 && s1.solBodies}, ${s1 && s1.solSearched} searched)`);
  // Any side: raiders and the third side (combat.js damage), your own who bleed out or are torn into lying down
  // (raidloot.js dropHaul: their body, with what they carried loose on it). Every body is tied to its unit (uid).
  const humanBodies = s1 ? s1.b.raid.containers.filter((c) => c.kind === "body" && !c.zombie) : [];
  const deadHumans = s1 ? s1.b.units.filter((u) => u.kind === "human" && u.dead) : [];
  const unbodied = deadHumans.filter((u) => !humanBodies.some((c) => c.uid === u.id));
  check(humanBodies.every((c) => c.uid != null) && !unbodied.length, `every human killed in a raid is a body to search too (any side: ${deadHumans.map((u) => u.side).join(", ") || "none"} killed${unbodied.length ? `; no body: ${unbodied.map((u) => u.name).join(", ")}` : ""})`);
  // A raid search: contents of a dead soldier's body through searchBox (combat.js), searched shows.
  const searchedSol = s1 && s1.b.raid.containers.find((c) => c.zombie && c.ztype === "soldier" && c.contents);
  // search.js: the bot may only rummage through it in a hurry (quick: its own marker, "…"; a full search turns up the rest).
  check(!searchedSol || (searchedSol.contents && (searchedSol.searched || searchedSol.partial || searchedSol.quick)), `a searched body is marked searched, part-taken or rummaged (${searchedSol ? (searchedSol.searched ? "searched: its picture shows the pockets turned out" : searchedSol.quick ? "rummaged" : "something left inside") : "none searched"})`);
}
if (!QUICK) {
  section(`Raids at a National Guard base, ${N} each: with the dead soldiers, and the same raids with ordinary dead (hunting rifles, Shooting 6+)`);
  const tally = (noMix) => {
    const o = { raids: 0, out: 0, deaths: 0, gear: 0, armor: 0, soldiers: 0, sup: 0, turns: 0, per: [] };
    for (let i = 0; i < N; i++) {
      const w = createWorld({ seed: SEED * 1000 + i, factionCount: 6 });
      const t = w.tiles.find((x) => x.loc && x.loc.type === "military" && !w.factions.some((f) => f.bases.includes(x.id)));
      if (!t) continue;
      const r = raidAt(w, t.id, { weapon: "huntrifle", noMix });
      if (!r || !r.over) continue;
      o.raids++;
      if (r.result.outcome === "extracted") o.out++;
      o.deaths += r.result.survivorsDead.length;
      o.gear += r.result.loot.gear.length;
      o.armor += r.result.loot.gear.filter((g) => ["vest", "plate", "milhelmet", "riothelmet"].includes(g.key)).length;
      o.sup += Object.values(r.result.loot.supplies).reduce((a, v) => a + v, 0);
      o.soldiers += r.soldiers;
      o.turns += r.result.turns;
      o.per[i] = { deaths: r.result.survivorsDead.length, turns: r.result.turns };
    }
    return o;
  };
  const a = tally(false), z = tally(true);
  const line = (n, o) => console.log(`    ${n.padEnd(22)} raids ${o.raids}  got out ${Math.round((o.out / o.raids) * 100)}%  deaths/raid ${r2(o.deaths / o.raids)}  dead soldiers/raid ${r2(o.soldiers / o.raids)}  items/raid ${r2(o.gear / o.raids)} (armour ${r2(o.armor / o.raids)})  supplies/raid ${Math.round(o.sup / o.raids)}  turns ${r2(o.turns / o.raids)}`);
  line("with dead soldiers", a);
  line("ordinary dead only", z);
  check(a.raids >= N * 0.8 && a.out / a.raids >= 0.6, `still doable for a prepared team: ${Math.round((a.out / a.raids) * 100)}% get out (ordinary dead: ${Math.round((z.out / z.raids) * 100)}%)`);
  // Harder? The same raids (same worlds, seeds) one with and one without the soldiers, compared pair by pair. With the
  // hunting rifle (armour ×0.75 against it; it was ×0.9, all but a full counter: +0.04 ± 0.03 deaths a raid then) they
  // add about +0.09 ± 0.03 deaths a raid (about 870 pairs over seeds 7–9, 300 raids each), while one raid to the next
  // swings by ±0.8: 60 raids cannot tell that apart from nothing, and
  // a sample can come out the other way (seed 7: -0.12 ± 0.10, and -0.03 ± 0.09 once the meds tables changed the dice). Part of it is the bot: it walks over to search
  // their bodies (botSkip false for the armoured, combat.js damage) and a plate carrier or vest fills a survivor's
  // hands (raidloot.js personalRoom), so it heads out sooner (about 0.5 turns a raid less, fewer drawn in by the
  // Heat). So the check is that they are not safer beyond chance: the paired difference no lower than 2 standard
  // errors under zero. (Against pistols and knives they cost clearly more: the duels and the team fights below.)
  const pairs = [];
  for (let i = 0; i < N; i++) if (a.per[i] && z.per[i]) pairs.push({ d: a.per[i].deaths - z.per[i].deaths, t: a.per[i].turns - z.per[i].turns });
  const meanSe = (xs) => { const m = xs.reduce((s, v) => s + v, 0) / xs.length; const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length - 1)); return { m, se: sd / Math.sqrt(xs.length) }; };
  const dd = meanSe(pairs.map((p) => p.d)), dt = meanSe(pairs.map((p) => p.t));
  check(pairs.length >= N * 0.8 && dd.m >= -2 * dd.se, `not safer than the ordinary dead beyond chance: deaths/raid ${r2(a.deaths / a.raids)} vs ${r2(z.deaths / z.raids)}, paired over ${pairs.length} raids ${dd.m >= 0 ? "+" : ""}${r2(dd.m)} ± ${r2(dd.se)} (turns ${dt.m >= 0 ? "+" : ""}${r2(dt.m)} ± ${r2(dt.se)}: they leave sooner with the armour)`);
  // Not poorer (>=): since the flashbang branch an armoury's crate of flashbangs (loot.js AREA_GRENADES) fills the same
  // hands in both arms, and at 60 raids the gap (dev e6b583b: 0.25 vs 0.24 at seed 7) is within one vest; at 120 raids
  // seeds 8 and 9 still show it clearly (0.14 vs 0.10, 0.26 vs 0.22).
  check(a.armor / a.raids >= z.armor / z.raids, `and not poorer: armour off the bodies ${r2(a.armor / a.raids)} vs ${r2(z.armor / z.raids)} a raid`);
}

// ---------- balance: one weapon at a time ----------
section("Balance: a dead soldier against a walker (power 3), one weapon at a time");
{
  const WPN = ["knife", "machete", "bat", "sledge", "pistol", "revolver", "shotgun", "huntrifle", "ar"];
  const wst = createWorld({ seed: SEED, factionCount: 4 });
  const base = hub(wst);
  const rows = [];
  const walkerHp = 15 + 7 * 3, soldierHp = Math.round(walkerHp * ZTYPES.soldier.hp);
  for (const w of WPN) {
    const W = WEAPONS[w], avg = (W.dmg[0] + W.dmg[1]) / 2, melee = !!W.melee;
    const crit = (melee ? CRIT.MELEE : CRIT.DEAD) / 100; // crit chances against the dead in the open
    // A critical hit: × CRIT_MULT (2) and the armour ignored.
    const per = (m) => avg * ((1 - crit) * m + crit * CRIT_MULT);
    const solHit = per(armorVs({ ztype: "soldier" }, { weapon: w }, { how: melee ? "melee" : "shot" }));
    rows.push({ w, walkerHit: per(1), solHit, hk: [walkerHp / per(1), soldierHp / solHit] });
  }
  console.log(`    damage a hit (crits counted) and hits to kill: walker ${walkerHp} hp, dead soldier ${soldierHp} hp`);
  for (const r of rows) console.log(`    ${r.w.padEnd(10)} walker ${r2(r.walkerHit).toString().padStart(5)} / hit, ${r2(r.hk[0]).toString().padStart(4)} hits   soldier ${r2(r.solHit).toString().padStart(5)} / hit, ${r2(r.hk[1]).toString().padStart(4)} hits  (×${r2(r.hk[1] / r.hk[0])})`);
  const by = Object.fromEntries(rows.map((r) => [r.w, r.hk[1] / r.hk[0]]));
  check(by.pistol >= 1.8 && by.knife >= 2 && by.huntrifle <= 1.7 && by.sledge <= 1.5, `pistols and knives take about twice the hits or more (×${r2(by.pistol)}, ×${r2(by.knife)}), the hunting rifle and the sledge barely more than the extra health (×${r2(by.huntrifle)}, ×${r2(by.sledge)})`);
  // One survivor (Shooting 8) against one of them, on the map.
  const fight = (w, kind, count = 1, players = 1) => {
    const out = { win: 0, turns: 0, dmg: 0, died: 0, n: 0 };
    for (let i = 0; i < N; i++) {
      const team = [];
      for (let k = 0; k < players; k++) {
        const s = makeSurvivor(wst);
        s.skills.shooting = 8; s.health = 100; s.traits = [];
        s.gear.weapon = newItem(w);
        s.location = { kind: "base", baseId: base.id };
        wst.survivors.push(s);
        team.push(s);
      }
      base.stock.ammo = 200; base.stock.meds = 0;
      const setup = { tile: base.tile, baseId: base.id, fighterIds: team.map((s) => s.id), enemy: { kind: "zombies", count, power: 3, ...(kind ? { types: { [kind]: count } } : {}) }, ambush: null, canRetreat: false, handler: "milz", context: {} };
      wst.combat = inBrowser(() => createBattle(wst, setup));
      const b = wst.combat;
      let g = 0;
      while (!b.over && g++ < 40) { autoPlayerTurn(wst); runEnemyPhase(wst); }
      const mine = b.units.filter((u) => u.side === "player");
      out.n++;
      if (b.over) {
        out.turns += b.turn;
        if (b.result.outcome === "victory") out.win++;
        out.dmg += mine.reduce((a, u) => a + (100 - u.hp), 0) / mine.length;
        out.died += b.result.survivorsDead.length;
        closeCombat(wst);
      } else wst.combat = null;
      wst.survivors = wst.survivors.filter((s) => !team.includes(s));
      wst.deathSites = []; wst.cards = []; wst.gameOver = false;
    }
    return out;
  };
  const fmt = (o) => `win ${String(Math.round((o.win / o.n) * 100)).padStart(3)}%  turns ${r2(o.turns / o.n).toString().padStart(5)}  health lost ${Math.round(o.dmg / o.n).toString().padStart(3)}`;
  console.log(`    on the map, one survivor (Shooting 8) against one of the dead, ${N} fights each:`);
  const duel = {};
  for (const w of ["knife", "pistol", "shotgun", "huntrifle", "sledge"]) {
    const a = fight(w, null), s = fight(w, "soldier");
    duel[w] = { a, s };
    console.log(`    ${w.padEnd(10)} walker: ${fmt(a)}   dead soldier: ${fmt(s)}`);
  }
  check(duel.pistol.s.dmg / duel.pistol.s.n > duel.pistol.a.dmg / duel.pistol.a.n && duel.knife.s.dmg / duel.knife.s.n > duel.knife.a.dmg / duel.knife.a.n, "with a pistol or a knife a dead soldier costs more blood than a walker");
  if (!QUICK) {
    console.log(`    three survivors against six of the dead, ${N} fights each:`);
    for (const w of ["knife", "pistol", "shotgun", "huntrifle", "sledge"]) {
      const a = fight(w, null, 6, 3), s = fight(w, "soldier", 6, 3);
      console.log(`    ${w.padEnd(10)} 6 walkers: ${fmt(a)} deaths ${r2(a.died / a.n)}   6 dead soldiers: ${fmt(s)} deaths ${r2(s.died / s.n)}`);
    }
  }
}

// ---------- sprites ----------
section("Sprites (ui/sprites.js paintArmoredDead, ui/downsprites.js): headless pixel grids");
{
  globalThis.localStorage = undefined;
  const S = await import("../src/ui/sprites.js");
  const D = await import("../src/ui/downsprites.js");
  const A = await import("../src/sim/appearance.js");
  const look = S.zombieLook();
  const sig = (p) => p.px.map((c) => c || ".").join(",");
  const filled = (p) => p.px.filter(Boolean).length;
  const sold = S.paintArmoredDead("soldier", 3, look), riot = S.paintArmoredDead("riot", 3, look), walk = S.paintZombie("walker", 3, look);
  check(filled(sold) > 150 && filled(riot) > 150 && sig(sold) !== sig(walk) && sig(riot) !== sig(sold), `a standing dead soldier and riot cop (${filled(sold)}, ${filled(riot)} pixels), unlike a walker`);
  check(sold.px.slice(0, 22 * 4).some((c) => c && ["#4f5a36", "#55603b", "#5b5a40"].includes(c)) && riot.px.some((c) => c === "#9fb4c4"), "the soldier wears an olive helmet; the riot cop a visor");
  const downs = {
    walker: D.paintDownedZombie("walker", 3, look), runner: D.paintDownedZombie("runner", 3, look), bloated: D.paintDownedZombie("bloated", 3, look), brute: D.paintDownedZombie("brute", 3, look),
    spitter: D.paintDownedZType("spitter", 0, look), screamer: D.paintDownedZType("screamer", 0, look), crawler: D.paintDownedZType("crawler", 0, look), shepherd: D.paintDownedZType("shepherd", 0, look),
    soldier: D.paintDownedZType("soldier", 3, look), riot: D.paintDownedZType("riot", 3, look),
    wallbreaker: D.paintDownedBoss("wallbreaker"), broodmother: D.paintDownedBoss("broodmother"),
  };
  const app = A.ensureAppearance({ id: 5 }, 2);
  const people = {
    "survivor dead": D.paintDownedSurvivor(app, "pistol", "vest", "dead"), "survivor down": D.paintDownedSurvivor(app, "pistol", "vest", "down"), "survivor ko": D.paintDownedSurvivor(app, "pistol", "vest", "down", { ko: true }),
  };
  for (const kit of ["raiders", "soldiers", "zealots"]) { people[`${kit} dead`] = D.paintDownedEnemy(kit, "#3a7ad6", "shotgun", null, 4, "dead"); people[`${kit} ko`] = D.paintDownedEnemy(kit, "#3a7ad6", "shotgun", null, 4, "down", { ko: true }); }
  const all = { ...downs, ...people };
  const sigs = Object.values(all).map(sig);
  check(Object.values(all).every((p) => filled(p) > 50 && p.w === D.DW && p.h === D.DH) && new Set(sigs).size === sigs.length, `a downed picture for every kind (${Object.keys(all).length}: ${Object.keys(all).join(", ")}), all different, on the ${D.DW}×${D.DH} grid`);
  check(Object.values(downs).every((p) => p.px.some((c) => c && c.length > 7)) && !p0(people["survivor down"]) && p0(people["survivor dead"]), "the dead lie in a pool (see-through pixels); the wounded and knocked-out curl up with none");
  function p0(p) { return p.px.some((c) => c && c.length > 7); }
  const sOpen = D.paintDownedZType("soldier", 3, look, false), sDone = D.paintDownedZType("soldier", 3, look, true);
  const rOpen = D.paintDownedEnemy("raiders", null, "shotgun", null, 4, "dead"), rDone = D.paintDownedEnemy("raiders", null, "shotgun", null, 4, "dead", { searched: true });
  check(sig(sOpen) !== sig(sDone) && sDone.px.includes("#e6e2d8") && sig(rOpen) !== sig(rDone) && rOpen.px.includes("#2b2e33") && !rDone.px.slice(D.DW * 12).includes("#2b2e33"), "a searched body has its pockets turned out (and a person's dropped weapon is gone)");
  // The battle views: a raid with every kind of body drawn top-down and isometric with stub canvases.
  let made = 0;
  const stub = () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {} }) });
  D.setDownCanvasMaker((w, h) => { made++; const c = stub(); c.width = w; c.height = h; return c; });
  const wst = createWorld({ seed: SEED, factionCount: 4 });
  const hb = hub(wst);
  const crew = atBase(wst, hb.id).slice(0, 3);
  const b = inBrowser(() => createBattle(wst, { tile: hb.tile, baseId: hb.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "zombies", count: 10, power: 3, types: { soldier: 2, riot: 1, spitter: 1, screamer: 1, crawler: 1, runner: 1, brute: 1 } }, ambush: null, canRetreat: true, handler: "milz", context: {} }));
  for (const u of b.units) if (u.side === "enemy") u.dead = true;
  b.units[0].down = true; b.units[1].down = true; b.units[1].ko = true;
  b.units.push({ ...b.units.find((u) => u.kind === "zombie"), id: 9999, boss: "broodmother", ztype: null });
  const canv = b.units.filter((u) => u.dead || u.down).map((u) => D.unitDownCanvas(wst, b, u, 0));
  check(canv.length >= 13 && canv.every(Boolean) && made >= 8, `every fallen unit in a battle gets its own downed canvas (${canv.length} units, ${made} pictures painted)`);
  const src = readFileSync(new URL("../src/ui/combat.js", import.meta.url), "utf8") + readFileSync(new URL("../src/ui/isoview.js", import.meta.url), "utf8");
  check((src.match(/unitDownCanvas\(/g) || []).length >= 3 && (src.match(/drawDowned\(/g) || []).length >= 3, "the top-down and isometric views draw the fallen with their downed pictures (drawDowned)");
  wst.combat = null;
}

// ---------- docs ----------
section("Help and README");
{
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  check(/Dead soldier/.test(readme) && /deadsoldiers\.js/.test(readme) && /downsprites\.js/.test(readme), "the README describes the dead soldiers (deadsoldiers.js) and the downed sprites (downsprites.js)");
  const ui = readFileSync(new URL("../src/ui/ui.js", import.meta.url), "utf8");
  check(/armoured dead/.test(ui), "Help lists the armoured dead with the special dead");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
