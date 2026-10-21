// The side arm and melee slots, the sling, Ear pro, and the former survivors among the dead (the user's requests
// 2026-10-21; src/sim/holsters.js, inventory.js, combat.js drawAct / drawChoice, equip.js, helmets.js earGearOf,
// inventory.js survivorDead). Checks:
//   - the slots take what they should: a handgun in the side arm slot (no long gun), a small melee weapon in the melee
//     slot (no fire axe), ear protection in Ear pro (no muffs under a full-shell helmet, plugs under any);
//   - a handgun or a knife picked up with the hands full goes onto the belt;
//   - in a fight: Draw side arm (1 action) slings the rifle and the pistol comes loaded from the rounds they carry,
//     Draw melee puts the pistol back on the belt and the knife in the hands (its blow is the knife's), Main weapon
//     takes the rifle back; refusals (no action left, nothing there);
//   - the fight's end: the slung weapon back in the hands;
//   - the AI (one rule for every side): dry with no Reload, the side arm; a foe next to them, the melee weapon; your
//     bots through combatAct; another side's person in their own turn;
//   - the governor's and the groups' deal (equip.js equipPeople) fills the belt and Ear pro;
//   - ear protection only works in Ear pro (earplugs in a pocket do nothing); an old save's muffs on the head, on a
//     helmet's ear mount, plugs in a pocket, move into the slot;
//   - the dead: some were survivors (inventory.js survivorDead), carrying a side arm and its rounds, a melee weapon, a
//     pack of survival things, on dice of their own (the world's dice end where they did).
// Usage: node tools/holstertest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, drawRefusal, drawChoice, magIn, loadMag, meleeOdds, endBattleNow, runEnemyPhase, refitKit, WEAPONS } from "../src/sim/combat.js";
import { newItem, fitReason, stow, ensureInv, EQUIP_SLOTS } from "../src/sim/inventory.js";
import { roundItem } from "../src/sim/itemstack.js";
import { ammoKey } from "../src/sim/data-ammo.js";
import { setRounds } from "../src/sim/ammo.js";
import { stackN } from "../src/sim/roundstack.js";
import { drawPlan, drawWeapon, holsterAll, isSidearmKey, isBeltMeleeKey } from "../src/sim/holsters.js";
import { equipPeople } from "../src/sim/equip.js";
import { earGearOf } from "../src/sim/helmets.js";
import { fitHeadgear } from "../src/sim/hearing.js";
import { GEAR } from "../src/sim/data.js";
import { survivorDead, ZSURV, enemyBody, deadBodyFinds } from "../src/sim/inventory.js";
import { calOf } from "../src/sim/ammo.js";
import { Rng } from "../src/sim/rng.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("holstertest", () => {});
const K9 = ammoKey("9mm", "fmj");

function person(state, weapon) {
  const s = makeSurvivor(state);
  s.skills.shooting = 8; s.skills.melee = 5;
  s.traits = [];
  s.health = 100;
  ensureInv(s);
  for (const k of EQUIP_SLOTS) s.gear[k] = null;
  s.pockets = s.pockets.map(() => null);
  s.gear.weapon = weapon ? newItem(weapon) : null;
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew, count = 1) {
  const h = hub(state);
  setRounds(h.stock, 0);
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count, power: 3 }, ambush: null, canRetreat: true, handler: "holstertest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = 30; u.y = 2; u.hp = u.maxHp = 100000; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
const foe = (b) => b.units.find((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; };

// 1. What goes where.
{
  console.log("The slots");
  const st = createWorld({ seed, factionCount: 2 });
  const s = person(st, "ar");
  const it = (k) => newItem(k);
  check(!fitReason(it("pistol"), "sidearm", s) && !fitReason(it("revolver"), "sidearm", s) && !fitReason(it("compact9"), "sidearm", s), "a 9mm, a revolver, a compact go in the side arm slot");
  check(/long gun/.test(fitReason(it("ar"), "sidearm", s)) && !!fitReason(it("shotgun"), "sidearm", s) && !!fitReason(it("smg"), "sidearm", s) && !!fitReason(it("knife"), "sidearm", s), `no rifle, shotgun, SMG or knife there ("${fitReason(it("ar"), "sidearm", s)}")`);
  check(!fitReason(it("knife"), "melee", s) && !fitReason(it("hatchet"), "melee", s) && !fitReason(it("machete"), "melee", s) && !fitReason(it("bat"), "melee", s), "a knife, a hatchet, a machete, a bat go in the melee slot");
  check(/too big/.test(fitReason(it("fireaxe"), "melee", s)) && !!fitReason(it("katana"), "melee", s) && !!fitReason(it("spear"), "melee", s) && !!fitReason(it("pistol"), "melee", s), `no fire axe, katana, spear or pistol there ("${fitReason(it("fireaxe"), "melee", s)}")`);
  check(!fitReason(it("earplugs"), "ears", s) && !fitReason(it("earmuffs"), "ears", s) && !!fitReason(it("pistol"), "ears", s), "ear protection goes in Ear pro (and nothing else)");
  s.gear.head = it("bikehelmet");
  check(/full shell/.test(fitReason(it("earmuffs"), "ears", s)) && !fitReason(it("earplugs"), "ears", s), "a full-shell helmet: no muffs, earplugs still fit");
  s.gear.head = null;
  check(!!fitReason(it("pistol"), "slung", s) === false && !!fitReason(it("bandagekit"), "slung", s), "only a weapon is slung");
  check(stow(s, it("pistol")) === `s:${s.id}:sidearm` && stow(s, it("knife")) === `s:${s.id}:melee` && stow(s, it("earplugs")) === `s:${s.id}:ears`, "the hands full: a pistol picked up goes on the belt, a knife too, earplugs in Ear pro");
  check(isSidearmKey("usp45") && !isSidearmKey("ar") && isBeltMeleeKey("kukri") && !isBeltMeleeKey("sledge"), "the classes (holsters.js)");
}

// 2. Drawing in a fight.
{
  console.log("Drawing in a fight");
  const st = createWorld({ seed, factionCount: 2 });
  const s = person(st, "ar");
  s.gear.sidearm = newItem("pistol");
  s.gear.melee = newItem("knife");
  s.pockets[0] = roundItem(K9, 30, true);
  const b = openBattle(st, [s]);
  const u = by(b, s), e = foe(b);
  place(u, 5, 5); place(e, 15, 5);
  check(u.weapon === "ar", `the rifle in the hands (${u.weapon})`);
  loadMag(u, 0); u.stack = [];
  u.ap = 0;
  check(/No action/.test(drawRefusal(b, u, s, "sidearm")), "no action left: refused");
  u.ap = 2;
  check(combatAct(st, { type: "draw", unit: u.id, slot: "main" }) !== "" && u.ap === 2, "nothing slung: Main weapon refused, nothing spent");
  const err = combatAct(st, { type: "draw", unit: u.id, slot: "sidearm" });
  check(err === "" && u.ap === 1, `Draw side arm: 1 action (${err || "ok"}, ${u.ap} left)`);
  check(u.weapon === "pistol" && s.gear.weapon && s.gear.weapon.key === "pistol" && s.gear.slung && s.gear.slung.key === "ar" && !s.gear.sidearm, "the pistol in the hands, the rifle slung, the side arm slot empty");
  check(magIn(u) > 0 && stackN(u.stack) === magIn(u), `the pistol comes loaded out of the rounds they carry (${magIn(u)} in it)`);
  check(/slings the .*draws the 9mm pistol/.test(b.log[b.log.length - 1].text), `the log: "${b.log[b.log.length - 1].text}"`);
  check(combatAct(st, { type: "shoot", unit: u.id, target: e.id }) === "", "it shoots");
  b.phase = "player"; u.ap = 2;
  place(e, 6, 5); e.dead = false; e.down = false;
  check(combatAct(st, { type: "draw", unit: u.id, slot: "melee" }) === "" && u.weapon === "knife" && s.gear.sidearm && s.gear.sidearm.key === "pistol" && !s.gear.melee && s.gear.slung.key === "ar", "Draw melee: the knife in the hands, the pistol back on the belt, the rifle still slung");
  const o = meleeOdds(b, u, e);
  check(o.dmg[1] >= Math.round(WEAPONS.knife.dmg[1] * 0.6) && o.dmg[1] > 12, `the blow is the knife's (${o.dmg[0]}–${o.dmg[1]}; a gun butt is far less)`);
  check(combatAct(st, { type: "melee", unit: u.id, target: e.id }) === "", "it strikes the foe next to them");
  b.phase = "player"; u.ap = 2;
  check(combatAct(st, { type: "draw", unit: u.id, slot: "main" }) === "" && u.weapon === "ar" && s.gear.melee && s.gear.melee.key === "knife" && !s.gear.slung, "Main weapon: the rifle back, the knife on the belt");
  // The fight's end: whatever is drawn, the main weapon back in the hands.
  b.phase = "player"; u.ap = 2;
  combatAct(st, { type: "draw", unit: u.id, slot: "sidearm" });
  endBattleNow(st, "victory");
  check(s.gear.weapon && s.gear.weapon.key === "ar" && s.gear.sidearm && s.gear.sidearm.key === "pistol" && !s.gear.slung, "the fight over: the rifle in the hands, the pistol on the belt");
}

// 3. The AI.
{
  console.log("The AI draws");
  const st = createWorld({ seed, factionCount: 2 });
  const s = person(st, "ar");
  s.gear.sidearm = newItem("pistol");
  s.gear.melee = newItem("hatchet");
  s.pockets[0] = roundItem(K9, 30, true);
  const b = openBattle(st, [s]);
  const u = by(b, s), e = foe(b);
  place(u, 5, 5); place(e, 12, 5);
  s.pockets[1] = roundItem(ammoKey("556", "fmj"), 30, true);
  refitKit(b, u, s);
  check(drawChoice(b, u, s) === null, `rounds for the rifle on them: no draw, a Reload (${drawChoice(b, u, s)})`);
  s.pockets[1] = null;
  refitKit(b, u, s);
  loadMag(u, 0); u.stack = [];
  check(drawChoice(b, u, s) === "sidearm", `the rifle dry, nothing to reload it with: the side arm (${drawChoice(b, u, s)})`);
  place(e, 6, 5);
  check(drawChoice(b, u, s) === "melee", `a foe right next to them: the hatchet (${drawChoice(b, u, s)})`);
  const s2 = person(st, "ar");
  s2.gear.melee = newItem("knife");
  check(drawPlan(s2, "melee").put === "slung" && drawWeapon(s2, "melee") && holsterAll(s2) && s2.gear.weapon.key === "ar" && s2.gear.melee.key === "knife", "out of a fight: draw and put back (holsterAll)");
  // Another side's person (fighters.js): in their own turn, dry, the side arm.
  const s3 = person(st, "ar");
  const b2 = openBattle(st, [s3], 1);
  const r = foe(b2);
  if (check(!!r.who, "the raider is a person (fighters.js)")) {
    const p = r.who;
    p.gear.sidearm = newItem("pistol");
    p.pockets = p.pockets.map(() => null);
    p.pockets[0] = roundItem(K9, 20, true);
    if (p.gear.backpack) p.gear.backpack.contents = p.gear.backpack.contents.map(() => null);
    p.gear.rig = null;
    const was = r.weapon;
    loadMag(r, 0); r.stack = []; r.mags = []; r.boxes = [];
    const v = by(b2, s3); place(v, 5, 5); place(r, 13, 5); v.hp = v.maxHp = 100000;
    r.aware = true; r.hp = r.maxHp = 100000;
    const why = drawChoice(b2, r, p);
    b2.phase = "enemy"; b2.queue = [r.id]; r.ap = 2;
    runEnemyPhase(st);
    const away = p.gear.slung || p.gear.sidearm; // a long gun slung, a handgun back in the side arm slot
    check(why === "sidearm" && r.weapon === "pistol" && away && away.key === was, `out of rounds, their ${was} put away and the pistol drawn (${why}, ${r.weapon})`);
  }
}

// 4. The deal fills the belt and the ears.
{
  console.log("The deal");
  const st = createWorld({ seed, factionCount: 2 });
  const a = person(st, "ar"), c = person(st, "shotgun");
  const armory = ["pistol", "revolver", "knife", "hatchet", "earmuffs", "earplugs"].map((k) => newItem(k));
  equipPeople(armory, [a, c]);
  check(a.gear.sidearm && c.gear.sidearm && a.gear.melee && c.gear.melee, `a side arm and a melee weapon each (${a.gear.sidearm && a.gear.sidearm.key}, ${c.gear.sidearm && c.gear.sidearm.key}, ${a.gear.melee && a.gear.melee.key}, ${c.gear.melee && c.gear.melee.key})`);
  check(a.gear.ears && c.gear.ears && a.gear.weapon.key === "ar" && c.gear.weapon.key === "shotgun", "ear protection each, the long guns still in the hands");
}

// 5. Ear pro.
{
  console.log("Ear pro");
  const st = createWorld({ seed, factionCount: 2 });
  const s = person(st, "pistol");
  s.pockets[0] = newItem("earplugs");
  check(earGearOf(s) === null, "earplugs in a pocket: nothing");
  s.gear.ears = s.pockets[0]; s.pockets[0] = null;
  check(earGearOf(s) && earGearOf(s).key === "earplugs", "in Ear pro: they work");
  s.gear.ears = newItem("earmuffs");
  s.gear.head = newItem("riothelmet");
  check(earGearOf(s) === null, "muffs under a full-shell helmet: nothing");
  s.gear.head = null;
  const u = {}; fitHeadgear(u, s);
  check(u.ears && u.ears.key === "earmuffs" && u.earCut > 0, "the battle unit's ears from the slot (hearing.js fitHeadgear)");
  // An old save (inventory version 2): muffs worn on the head, plugs in a pocket.
  const o = makeSurvivor(st);
  o.gear = { weapon: null, tool: null, head: { key: "earmuffs", name: GEAR.earmuffs.name, quality: 1 }, armor: null, arms: null, legs: null, rig: null, backpack: null, carry: null };
  o.pockets = [newItem("earplugs"), null, null, null];
  o.invV = 2;
  ensureInv(o);
  check(o.gear.ears && o.gear.ears.key === "earmuffs" && !o.gear.head && o.pockets[0] && o.pockets[0].key === "earplugs", "an old save: the muffs off the head into Ear pro (the plugs stay in the pocket)");
  const o2 = makeSurvivor(st);
  o2.gear = { weapon: null, tool: null, head: { key: "milhelmet", name: GEAR.milhelmet.name, quality: 1, mods: { ears: { key: "commset", name: GEAR.commset.name, quality: 1, dur: 30 } } }, armor: null, arms: null, legs: null, rig: null, backpack: null, carry: null };
  o2.pockets = [null, null, newItem("earplugs"), null];
  o2.invV = 2;
  ensureInv(o2);
  check(o2.gear.ears && o2.gear.ears.key === "commset" && !o2.gear.head.mods.ears, "an old save: the headset off the helmet's ear mount into Ear pro");
  const o3 = makeSurvivor(st);
  o3.gear = { weapon: null, tool: null, head: null, armor: null, arms: null, legs: null, rig: null, backpack: null, carry: null };
  o3.pockets = [null, newItem("ragplugs"), null, null];
  o3.invV = 2;
  ensureInv(o3);
  check(o3.gear.ears && o3.gear.ears.key === "ragplugs" && !o3.pockets[1], "an old save: plugs in a pocket into Ear pro");
}

// 6. The dead who were survivors.
{
  console.log("The dead who were survivors");
  const N = 3000;
  let was = 0, side = 0, rounds = 0, blade = 0, pack = 0, stuff = 0, bad = 0;
  for (let i = 0; i < N; i++) {
    const k = survivorDead(new Rng(1000 + i * 7919), i, null);
    if (!k) continue;
    was++;
    if (k.sidearm) { side++; if (!isSidearmKey(k.sidearm.key)) bad++; const cal = calOf(k.sidearm.key); if (cal && Object.keys(k.sup).some((x) => x.startsWith(`a_${cal}_`))) rounds++; }
    if (k.melee) { blade++; if (!isBeltMeleeKey(k.melee.key)) bad++; }
    if (k.pack) { pack++; stuff += k.pack.contents.filter(Boolean).length; }
  }
  const share = was / N;
  check(share > ZSURV.chance - 0.03 && share < ZSURV.chance + 0.03, `about ${Math.round(ZSURV.chance * 100)}% of the plain dead were survivors (${Math.round(share * 1000) / 10}%)`);
  check(side > 0 && rounds === side && blade > 0 && pack > 0 && stuff >= pack * 2 && bad === 0, `side arms with their own rounds (${side}, ${rounds}), belt blades (${blade}), packs with survival things in them (${pack}, ${stuff} things)`);
  check(survivorDead(new Rng(5), 1, "soldier") === null && survivorDead(new Rng(5), 1, "deadhound") === null, "a dead soldier or a dead beast: no survivor's kit");
  const r = new Rng(42), s0 = r.state;
  survivorDead(r, 3, null);
  check(r.state === s0, "rolled on dice of its own: the world's dice did not move");
  // A field battle's body: the kit worn.
  let worn = null;
  for (let i = 0; i < 400 && !worn; i++) { const body = enemyBody(new Rng(77 + i * 31), { kind: "zombie", name: "Walker", id: i }, null); if (body.gear.sidearm || body.gear.melee) worn = body; }
  check(!!worn && (!worn.gear.sidearm || isSidearmKey(worn.gear.sidearm.key)) && (!worn.gear.melee || isBeltMeleeKey(worn.gear.melee.key)), `a body on the battle map wears it (${worn ? [worn.gear.sidearm, worn.gear.melee, worn.gear.backpack].filter(Boolean).map((x) => x.key).join(", ") : "none"})`);
  // A raid's body searched: the kit among the finds, more than the old finds alone.
  let finds = 0, kit = 0;
  for (let i = 0; i < 1000; i++) { const f = deadBodyFinds(new Rng(500 + i * 13), null, null, i); finds += f.gear.length; kit += f.gear.filter((x) => isSidearmKey(x.key) || isBeltMeleeKey(x.key)).length; }
  check(kit > 100 && finds > 400, `a raid's bodies give side arms and blades (${kit} in ${finds} finds over 1000 bodies)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
