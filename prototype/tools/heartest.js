// Helmets, face shields, helmet mounts, ear protection and hearing (docs/weapons-overhaul-plan.md section 18;
// src/sim/helmets.js, hearing.js, data-helmets.js; hooks in combat.js, armour.js, stealth.js, middead.js,
// throwables.js, lights.js, inventory.js, arsenal.js, loot.js, repair.js):
//   1. the bang and exposure table (a rifle outdoors deafens its shooter, a 9mm only indoors, a suppressed rifle never,
//      muffs prevent it, the .50 dazes, a grenade 2 tiles off deafens, full auto louder), wired through fire();
//   2. deafness and the daze tick down at the side's turn; the dazed lose aim;
//   3. a guard's behind arc: deaf, electronic, plugged (stealth.js detectRange);
//   4. heard markers: only within HEAR, never while deaf, a full shell hears less, a headset more;
//   5. the Nightmare's scream: hold bonuses;
//   6. the face zone: a bite to the face with and without a visor, the visor up, a ballistic visor cracks at 0;
//      a hard hat stops no bullet;
//   7. mounts: full shells reject ear mounts, the hard hat's NVG mount opens the nvg slot, thermal refused; the
//      inventory calls (fitHelmetAt / stripHelmetAt) move items and keep weight and value;
//   8. night vision on a helmet frees the off hand; a helmet light is a light;
//   9. the visor: free toggle, fog aim, ballistic sight; the team headset's aim and escape;
//  10. flashbangs: ear protection alone takes at most 0.4, a near one still costs an action;
//  11. enemies wear headgear by kit, their bodies drop it; group arsenals hold and issue it;
//  12. loot: tags and sources, lootItem everywhere; repair: a cracked visor refused, a battery swap loses nothing;
//      earplugs wear a pair a fight; the makeshift rag earplugs (data.js ragplugs, crafting.js CRAFTS.ragplugs: a scrap,
//      in the field): weaker than foam, worn from a pocket, a pair a fight, foam used first, never mended;
//  13. a save round trip with helmet mods.
// Usage: node tools/heartest.js [seed]
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { createBattle, registerCombatHandler, combatAct, endPlayerTurn, runEnemyPhase, shotOdds, enemyUnit, fire, escapeOdds, enemyGhosts, sightRange, KITS, WEAPONS } from "../src/sim/combat.js";
import { HEAR, HEARING, bangOf, deafen, exposure, tickEars, hearRange, hearMult, heardGhosts, earHold, dazedAim, linkAim, linkEscape, fitHeadgear, settleEars } from "../src/sim/hearing.js";
import { kitHeadgear as kitHeadgearT } from "../src/sim/helmets.js";
import { HELMETS, HELMET_ATTACH, FACE, HEAD_KIT, HEAD_FINDS, AREA_HEAD, WARE_HEAD, helmetFitReason, fitHelmetMod, removeHelmetMod, helmetSlots, faceOf, visorAim, toggleVisor, helmetNvg, helmetLight, earGearOf, fitHelmetAt, stripHelmetAt, helmetChoices, rollHeadKit, rollHeadFind, rollAreaHead, headWares } from "../src/sim/helmets.js";
import { HELMET_GEAR } from "../src/sim/data-helmets.js";
import { CRAFTS, craftOutputText, makeItem } from "../src/sim/crafting.js"; // rag earplugs: the makeshift recipe
import { craftLock } from "../src/sim/blueprints.js";
import * as IA from "../src/ui/itemart.js";
import { armourHit, battleDice } from "../src/sim/armour.js";
import { detectRange, stealthSetup } from "../src/sim/stealth.js";
import { landEffect, FLASH, flashCut } from "../src/sim/throwables.js";
import { THROWABLES } from "../src/sim/stealth.js";
import { lightOf } from "../src/sim/lights.js";
import { newItem, enemyBody, itemLoad, allItems } from "../src/sim/inventory.js";
import { itemValue } from "../src/sim/valuation.js";
import { ITEM_TAGS, fitsTags, SITE_TAGS, AREA_TAGS } from "../src/sim/loot.js";
import { repairKind, repairMath } from "../src/sim/repair.js";
import { ensureArsenal, armFromArsenal, starterKit, isArmourKey } from "../src/sim/arsenal.js";
import { condRolled } from "../src/sim/itemcond.js";
import { Rng } from "../src/sim/rng.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { MIDDEAD } from "../src/sim/hiveconst.js";
import { MILDEAD } from "../src/sim/deadsoldiers.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const t0 = Date.now();
registerCombatHandler("ht", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };

// An open field at the hub (open grass everywhere, units placed by hand), as tools/flashtest.js does. gear: each
// fighter's head / tool / pockets before the battle is made.
function openBattle(st, enemy = { kind: "raiders", count: 4, power: 3 }, n = 3, gear = null) {
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, n);
  for (const s of people) { s.gear.head = null; s.gear.tool = null; s.pockets = s.pockets.map(() => null); if (s.gear.backpack) s.gear.backpack.contents = s.gear.backpack.contents.map(() => null); }
  if (gear) people.forEach((s, i) => gear(s, i));
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy, ambush: null, canRetreat: false, handler: "ht", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; }
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  b.fires = []; b.smoke = []; b.lures = [];
  let i = 0;
  for (const u of b.units) {
    u.x = u.side === "player" ? 1 : 30 - (i % 4); u.y = u.side === "player" ? 1 + 2 * (u.id % 6) : 2 + 2 * (i++ >> 2);
    u.aware = true; u.face = [0, 0]; u.ow = false; delete u.stun; u.deaf = 0; u.dazed = 0;
    if (u.side !== "player") { u.ears = null; u.earCut = 0; u.link = false; } // kit ear protection off unless a check gives it
  }
  return b;
}
const P = (b) => b.units.filter((u) => u.side === "player");
const E = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y, face = [0, 0]) => { u.x = x; u.y = y; u.face = face; };
const muffs = { key: "earmuffs", cut: 4, hear: -3, elec: false, link: false };
const plugs = { key: "earplugs", cut: 3, hear: -3, elec: false, link: false };
const edef = { key: "eardef", cut: 4, hear: 2, elec: true, link: false };

// ---------- 1. the bang ----------
section("1. The bang and the exposure (section 18.4's table), and fire() deafening the shooter");
{
  const st = world();
  const b = openBattle(st);
  const [me, mate] = P(b);
  const gun = (u, w) => { u.weapon = w; u.gm = null; u.gmWeapon = null; u.modesW = null; u.mode = "single"; };
  place(me, 5, 5); place(mate, 20, 20);
  gun(me, "ar");
  const rifle = bangOf(b, me);
  check(near(rifle, 3), `a rifle shot outdoors is bang 3 (${rifle})`);
  check(near(exposure(me, me.x, me.y, rifle, me), 4), "its shooter: e = 4");
  deafen(b, me.x, me.y, rifle, me);
  check(me.deaf === 1 && !me.dazed, `an unprotected rifle shooter outdoors is deaf for a turn (deaf ${me.deaf})`);
  me.deaf = 0;
  gun(me, "pistol");
  deafen(b, me.x, me.y, bangOf(b, me), me);
  check(!me.deaf, "a 9mm outdoors: e = 3, nothing");
  b.cells[me.y * b.w + me.x].f = "floor";
  check(near(bangOf(b, me), 3), `indoors × 1.5 (9mm: ${bangOf(b, me)})`);
  deafen(b, me.x, me.y, bangOf(b, me), me);
  check(me.deaf === 1, "a 9mm indoors: e = 4, deaf");
  b.cells[me.y * b.w + me.x].f = "grass";
  me.deaf = 0;
  gun(me, "ar");
  check(near(bangOf(b, me, WEAPONS.ar, 3 * 0.4), 1.2), "a suppressed rifle: bang 1.2 (the suppressor's share)");
  deafen(b, me.x, me.y, 1.2, me);
  check(!me.deaf, "a suppressed rifle: e = 2.2, nothing");
  me.ears = muffs;
  deafen(b, me.x, me.y, rifle, me);
  check(!me.deaf, "muffs: the rifle shooter is not deafened (e = 0)");
  me.ears = null;
  gun(me, "amr");
  deafen(b, me.x, me.y, bangOf(b, me), me);
  check(me.dazed > 0 && me.deaf >= 2, `the .50 shooter: e = 7, dazed and deaf ${me.deaf}`);
  me.ears = muffs; me.deaf = 0; me.dazed = 0;
  deafen(b, me.x, me.y, bangOf(b, me), me);
  check(!me.deaf && !me.dazed, "the .50 with muffs: e = 3, nothing");
  me.ears = null; me.deaf = 0; me.dazed = 0;
  place(mate, 7, 5);
  deafen(b, 5, 5, HEAR.BLAST.frag);
  check(mate.deaf === 1, `a grenade 2 tiles off: e = 4, deaf (${mate.deaf})`);
  check(me.deaf === 2, `a grenade at your feet: e = 5, deaf 2 (${me.deaf})`);
  me.deaf = 0; mate.deaf = 0;
  place(mate, 10, 5);
  deafen(b, 5, 5, HEAR.BLAST.frag);
  check(!mate.deaf, "5 tiles off a grenade: out of range");
  gun(me, "lmg");
  me.mode = "auto";
  check(near(bangOf(b, me, WEAPONS.lmg, null, "auto"), WEAPONS.lmg.noise + HEAR.AUTO), "full auto counts as a bigger bang (+1)");
  check(near(bangOf(b, me, WEAPONS.lmg, null, "burst"), WEAPONS.lmg.noise), "a burst is one bang an action");
  // The turret: its own bang (4).
  check(bangOf(b, { weapon: "turret_m2", x: 1, y: 1 }, WEAPONS.turret_m2) === HEAR.TURRET, "the vehicle turret's burst is bang 4");
  // Through fire(): the shooter is deafened, the enemies near it too, the dead never.
  gun(me, "ar");
  me.deaf = 0;
  const [e0, e1] = E(b);
  place(e0, 12, 5); place(e1, 6, 6);
  e1.deaf = 0;
  for (const [x, y] of [[5, 5], [6, 6]]) b.cells[y * b.w + x].f = "floor"; // inside: a rifle × 1.5
  me.ap = 2;
  fire(b, me, e0);
  check(me.deaf >= 1 && me.shotT === b.turn, `fire(): the rifleman is deaf and marked as having fired (deaf ${me.deaf})`);
  check(e1.deaf >= 1, "fire(): indoors, an enemy right next to the rifle is deafened too (4.5 − 0.7)");
  for (const [x, y] of [[5, 5], [6, 6]]) b.cells[y * b.w + x].f = "grass";
  const z = { kind: "zombie", side: "enemy", x: 5, y: 6, f: 0 };
  b.units.push(z);
  deafen(b, 5, 5, 6);
  check(!z.deaf, "the dead are never deafened");
  b.units.pop();
}

// ---------- 2. ticking ----------
section("2. Deafness and the daze wear off at the side's turn; the dazed aim worse");
{
  const st = world();
  const b = openBattle(st);
  const [me] = P(b);
  const [e0] = E(b);
  place(me, 5, 5); place(e0, 12, 5);
  me.weapon = "ar";
  me.deaf = 2; me.dazed = 1; e0.deaf = 1;
  tickEars(b, ["player"]);
  check(me.deaf === 1 && me.dazed === 0 && e0.deaf === 1, "tickEars: only the side named loses a turn");
  me.dazed = 2;
  const a1 = shotOdds(b, me, e0).chance;
  me.dazed = 0;
  const a0 = shotOdds(b, me, e0).chance;
  check(a0 - a1 === HEAR.DAZE_AIM || (a0 === 95 && a1 >= 85), `dazed: −${HEAR.DAZE_AIM} aim (${a0} → ${a1})`);
  check(dazedAim({ dazed: 1 }) === 10 && dazedAim({}) === 0, "dazedAim");
  // Through the turns: an enemy deafened in your turn is still deaf there, and clears at its own turn's start.
  me.deaf = 1; e0.deaf = 2;
  endPlayerTurn(st);
  check(e0.deaf === 1, `the enemy phase starts: their deafness ticks (${e0.deaf})`);
  runEnemyPhase(st);
  check(me.deaf === 0, "your turn starts: yours ticks");
  // Dazed in your own turn: this turn and the next; dazed in theirs: until your next turn ends.
  me.deaf = 0; me.dazed = 0;
  b.phase = "player";
  deafen(b, me.x, me.y, 7, me);
  check(me.dazed === 2, "dazed in its own turn: 2 (this turn and the next)");
  b.phase = "enemy";
  const [, mate] = P(b);
  if (mate) { mate.dazed = 0; place(mate, 5, 6); deafen(b, 5, 5, 6.5); check(mate.dazed === 1, "dazed in the enemy's turn: 1 (your next turn)"); }
  b.phase = "player";
}

// ---------- 3. detection ----------
section("3. A guard's behind arc: deaf, electronic, plugged (stealth.js detectRange)");
{
  const st = world();
  const b = openBattle(st, { kind: "guards", count: 2, power: 3 });
  const [me] = P(b);
  const [g] = E(b);
  me.stealth = 0; me.sneak = 0; me.ghost = false;
  place(g, 10, 5, [1, 0]); // facing east
  place(me, 6, 5); // behind them
  g.ears = null; g.deaf = 0;
  const full = detectRange(b, g, me);
  g.deaf = 1;
  const deaf = detectRange(b, g, me);
  g.deaf = 0; g.ears = edef;
  const elec = detectRange(b, g, me);
  g.ears = plugs;
  const plug = detectRange(b, g, me);
  g.ears = null;
  check(deaf === 1, `deaf: noticed from a tile only (${deaf})`);
  check(elec === Math.max(1, Math.ceil(8 * 0.5 * 0.75)) && elec <= full, `electronic: × 0.75 (${full} → ${elec})`);
  check(plug === Math.max(1, Math.ceil(8 * 0.5 * 0.3)), `plugs or muffs: × 0.3 (${plug})`);
  place(me, 14, 5); // in front
  g.deaf = 1;
  check(detectRange(b, g, me) === 8, "in front of them deafness changes nothing (they see you)");
  check(hearMult({ deaf: 1 }) === 0 && hearMult({ ears: edef }) === 0.75 && hearMult({ ears: muffs }) === 0.3 && hearMult({}) === 1, "hearMult");
}

// ---------- 4. heard markers ----------
section("4. Heard markers: within HEAR, never while deaf");
{
  const st = world();
  const b = openBattle(st);
  const [me, m2, m3] = P(b);
  const [e0, e1, e2, e3] = E(b);
  place(m2, 1, 20); place(m3, 2, 20);
  m2.dead = true; m3.dead = true; // one listener
  // A wall between: they cannot be seen.
  for (let y = 0; y < b.h; y++) { b.cells[y * b.w + 8].k = "wall"; }
  b.losCache.fill(0);
  place(me, 5, 5);
  place(e0, 10, 5); place(e1, 14, 5); place(e2, 10, 7); place(e3, 25, 20);
  e0.movedT = b.turn; e1.movedT = b.turn; e2.movedT = b.turn - 1; e3.movedT = b.turn;
  me.ears = null; me.muffle = 0; me.deaf = 0;
  b.ghosts = {};
  const heard = heardGhosts(b);
  check(heard.includes(e0) && !heard.includes(e1), `within HEAR ${hearRange(me)} tiles (5) heard, 9 tiles off not`);
  check(!heard.includes(e2), "one that did not move or fire this turn is not heard");
  const gh = enemyGhosts(b);
  check(gh.some((g) => g.id === e0.id && g.heard), "the marker is a ghost with the heard flag (the UI's \"?\")");
  me.deaf = 1; b.ghosts = {};
  check(!heardGhosts(b).length, "deaf: nothing heard");
  me.deaf = 0; me.ears = edef; b.ghosts = {};
  check(hearRange(me) === 8 && heardGhosts(b).includes(e0) && !heardGhosts(b).includes(e1), "electronic: +2 (8 tiles: still not the one 9 off)");
  me.ears = muffs; b.ghosts = {};
  check(hearRange(me) === 3 && !heardGhosts(b).includes(e0), "muffs: −3 (3 tiles)");
  me.ears = null; me.muffle = HELMETS.riothelmet.muffle;
  check(hearRange(me) === 4, "a full-shell riot helmet: −2");
  e0.shotT = b.turn; e0.movedT = null; me.muffle = 0; b.ghosts = {};
  check(heardGhosts(b).includes(e0), "one that fired this turn is heard too");
  // Seen: a ghost, not a heard one (trackGhosts' own job).
  for (let y = 0; y < b.h; y++) b.cells[y * b.w + 8].k = "open";
  b.losCache.fill(0); b.ghosts = {};
  check(!heardGhosts(b).includes(e0), "one your people see is not a heard marker");
  // Through the enemy phase.
  for (let y = 0; y < b.h; y++) b.cells[y * b.w + 8].k = "wall";
  b.losCache.fill(0);
  check(!HEARING.PERMANENT, "permanent hearing loss is off by default");
}

// ---------- 5. scream ----------
section("5. The Nightmare's scream: ear protection and deafness help hold");
{
  check(near(earHold({ ears: muffs }), 0.15) && near(earHold({ ears: plugs }), 0.15), "plugs or muffs +0.15");
  check(near(earHold({ ears: edef }), 0.2), "electronic +0.2");
  check(near(earHold({ deaf: 2 }), 0.25) && near(earHold({ deaf: 1, ears: edef }), 0.25), "deafened +0.25 (not on top)");
  check(earHold({}) === 0, "nothing: +0");
  check(HEAR.SCREAM === MIDDEAD.NIGHTMARE.NOISE, "the scream is a bang of NM.NOISE");
}

// ---------- 6. the face ----------
section("6. The face zone: bites with and without a visor, the ballistic visor cracks; a hard hat and a bullet");
{
  const st = world();
  const b = openBattle(st);
  const [me] = P(b);
  const zed = { kind: "zombie", weapon: "claws", side: "enemy", x: 0, y: 0 };
  const helm = newItem("highcut");
  const visor = newItem("riotvisor");
  fitHelmetMod(helm, visor);
  me.pieces = { torso: null, head: helm, arms: null, legs: null };
  me.tough = 1; me.visorUp = false;
  // Many bites to the head: 35% on the face.
  let face = 0, n = 0, faceMult = [], crown = 0;
  for (let i = 0; i < 4000; i++) {
    const r = armourHit(b, me, 10, zed, { how: "melee", crit: true }); // a crit: always the head
    n++;
    if (r.face) { face++; faceMult.push(r.mult); } else crown++;
    helm.dur = 45; visor.dur = 20; helm.chip = 0; visor.chip = 0;
  }
  const share = face / n;
  check(Math.abs(share - FACE.SHARE) < 0.03, `${(share * 100).toFixed(1)}% of head hits land on the face (35%)`);
  check(faceMult.every((m) => near(m, 0.4)), "a bite on a riot visor: × 0.4");
  // A bite wears the visor 0.2.
  let bites = 0;
  while (bites < 2000) { const r = armourHit(b, me, 10, zed, { how: "melee", crit: true }); bites++; if (r.face) break; }
  check(visor.dur === 20 && near(visor.chip || 0, 0.2), `a bite takes 0.2 off the visor (dur ${visor.dur}, chip ${visor.chip})`);
  // Visor up: the whole bite.
  me.visorUp = true;
  let upMult = null;
  for (let i = 0; i < 200 && upMult == null; i++) { const r = armourHit(b, me, 10, zed, { how: "melee", crit: true }); if (r.face) upMult = r.mult; }
  check(upMult === 1, `visor up: a bite to the face does it all (× ${upMult})`);
  me.visorUp = false;
  // No visor at all on a combat helmet: the face is bare.
  me.pieces.head = newItem("milhelmet");
  let bare = null;
  for (let i = 0; i < 200 && bare == null; i++) { const r = armourHit(b, me, 10, zed, { how: "melee", crit: true }); if (r.face) bare = r.mult; }
  check(bare === 1, "a combat helmet has no face cover: a face bite is all of it");
  // A motorcycle helmet's built-in visor: bites × 0.4; a bullet straight through it.
  me.pieces.head = newItem("bikehelmet");
  let bk = null;
  for (let i = 0; i < 200 && bk == null; i++) { const r = armourHit(b, me, 10, zed, { how: "melee", crit: true }); if (r.face) bk = r.mult; }
  check(near(bk, 0.4), `a motorcycle helmet's visor: bites × 0.4 (${bk})`);
  const shooter = { kind: "human", weapon: "pistol", side: "enemy", load: null };
  let bs = null;
  for (let i = 0; i < 400 && bs == null; i++) { const r = armourHit(b, me, 10, shooter, { how: "shot", crit: true, weapon: "pistol", cal: "9mm" }); if (r.face) bs = r; }
  check(bs && bs.through && bs.mult >= 1 - 1e-9, "a bullet through a motorcycle visor: not stopped");
  // The ballistic visor: AC 3 to a shot, cracks at 0, then covers nothing and costs 4 aim.
  const hc = newItem("highcut");
  const bv = newItem("ballvisor");
  check(fitHelmetMod(hc, bv).ok, "a ballistic visor fits a high-cut helmet");
  me.pieces.head = hc;
  const rifle = { kind: "human", weapon: "ar", side: "enemy", load: null };
  let shots = 0, stopped = 0;
  for (let i = 0; i < 4000 && !(bv.dur <= 0); i++) {
    const r = armourHit(b, me, 30, rifle, { how: "shot", crit: true, weapon: "ar", cal: "556" });
    if (r.face) { shots++; if (!r.through) stopped++; }
  }
  check(bv.dur <= 0 && shots > 0, `the ballistic visor wears to 0 and cracks (${shots} face hits, ${stopped} stopped)`);
  const f = faceOf(me);
  check(f && f.cracked, "faceOf: cracked");
  check(visorAim(me, b) === -FACE.CRACKED, `a cracked visor down: −${FACE.CRACKED} aim`);
  let cr = null;
  for (let i = 0; i < 400 && cr == null; i++) { const r = armourHit(b, me, 10, zed, { how: "melee", crit: true }); if (r.face) cr = r.mult; }
  check(cr === 1, "a cracked visor covers nothing");
  me.visorUp = true;
  check(visorAim(me, b) === 0, "raised: no aim lost");
  me.visorUp = false;
  // A hard hat: blows and bites, never a bullet.
  const hh = newItem("hardhat");
  me.pieces.head = hh;
  let hb = 0, hs = 0, nb = 0, ns = 0;
  for (let i = 0; i < 600; i++) {
    const r1 = armourHit(b, me, 10, zed, { how: "melee", crit: true });
    if (!r1.face) { nb++; if (r1.mult < 1) hb++; }
    const r2 = armourHit(b, me, 10, shooter, { how: "shot", crit: true, weapon: "pistol", cal: "9mm" });
    if (!r2.face) { ns++; if (r2.mult < 1) hs++; }
    hh.dur = 15; hh.chip = 0;
  }
  check(hb > nb * 0.5 && hs === 0, `a hard hat: the crown stops bites (${hb}/${nb}), never a bullet (${hs}/${ns})`);
  me.pieces = { torso: null, head: null, arms: null, legs: null };
}

// ---------- 7. mounts ----------
section("7. Mounts: what fits where; the inventory calls");
{
  const bike = newItem("bikehelmet"), riot = newItem("riothelmet"), foot = newItem("footballhelmet");
  for (const h of [bike, riot, foot]) check(/full shell/.test(helmetFitReason(h, newItem("earmuffs"))), `a ${h.name.toLowerCase()} rejects ear muffs (full shell)`);
  check(!helmetFitReason(newItem("milhelmet"), newItem("commset")), "a combat helmet takes a headset");
  check(!helmetFitReason(riot, newItem("helmetlight")), "a riot helmet takes a light");
  const hh = newItem("hardhat");
  check(/mount/.test(helmetFitReason(hh, newItem("nvg"))), "a hard hat has no nvg mount without the bracket");
  check(fitHelmetMod(hh, newItem("nvgmount")).ok && helmetSlots(hh).includes("nvg"), "the hard hat's NVG mount opens the nvg slot");
  check(fitHelmetMod(hh, newItem("nvg")).ok, "then the goggles go on it");
  const off = removeHelmetMod(hh, "rail");
  check(off.length === 2 && off[0].key === "nvg" && !hh.mods, "taking the bracket off takes the goggles with it (goggles first)");
  check(/hand/.test(helmetFitReason(newItem("highcut"), newItem("thermal"))), "a thermal monocular never goes on a helmet");
  check(/fit/.test(helmetFitReason(newItem("milhelmet"), newItem("ballvisor"))), "a ballistic visor only fits the high-cut helmet");
  const hc = newItem("highcut");
  fitHelmetMod(hc, newItem("riotvisor"));
  const res = fitHelmetMod(hc, newItem("ballvisor"));
  check(res.ok && res.off.length === 1 && res.off[0].key === "riotvisor", "a new visor swaps the old one off");
  // The inventory calls (no time, not mid-fight): a helmet worn, the part from a pocket.
  const st = world();
  st.combat = null;
  const h = hub(st);
  const s = atBase(st, h.id)[0];
  const helm = newItem("highcut");
  s.gear.head = helm;
  const light = newItem("helmetlight");
  const pi = s.pockets.indexOf(null);
  s.pockets[pi] = light;
  const kg0 = itemLoad(helm), v0 = itemValue(helm);
  const ch = helmetChoices(st, `s:${s.id}:head`);
  check(ch.some((c) => c.item === light), "helmetChoices lists the light in a pocket");
  const msg = fitHelmetAt(st, `s:${s.id}:head`, `s:${s.id}:pocket:${pi}`);
  check(helm.mods && helm.mods.light === light && s.pockets[pi] == null, `fitHelmetAt: on the helmet, out of the pocket ("${msg}")`);
  check(near(itemLoad(helm), kg0 + GEAR.helmetlight.weight, 1e-6) && itemValue(helm) > v0, "the helmet weighs and is worth its parts");
  check(lightOf(s) === "flashlight" && helmetLight(s), "a helmet light is a hands-free flashlight (lights.js)");
  const m2 = stripHelmetAt(st, `s:${s.id}:head`, "light");
  check(!helm.mods && h.armory.includes(light), `stripHelmetAt: into the armory ("${m2}")`);
}

// ---------- 8. night vision ----------
section("8. Night vision on a helmet frees the off hand");
{
  const st = world();
  const b = openBattle(st, { kind: "raiders", count: 2, power: 3 }, 2, (s, i) => {
    if (i === 0) { const h = newItem("milhelmet"); fitHelmetMod(h, newItem("nvg")); s.gear.head = h; s.gear.tool = newItem("flashlight"); }
  });
  const s0 = survivorById(st, P(b)[0].sid);
  check(helmetNvg(s0), "helmetNvg: goggles on the combat helmet's shroud");
  b.night = true;
  b.raid = b.raid || null;
  stealthSetup(st, b);
  const u0 = P(b)[0];
  check(u0.nvg, "stealthSetup: night vision from the helmet");
  check(s0.gear.tool && s0.gear.tool.key === "flashlight", "with a flashlight still in the off hand");
  const u1 = P(b)[1];
  check(!u1.nvg, "no goggles, no night vision");
}

// ---------- 9. visor, fog, link ----------
section("9. The visor toggle, fog, the ballistic visor's sight; the team headset");
{
  const st = world();
  const b = openBattle(st, { kind: "raiders", count: 2, power: 3 }, 3, (s, i) => {
    if (i === 0) { const h = newItem("highcut"); fitHelmetMod(h, newItem("ballvisor")); fitHelmetMod(h, newItem("commset")); s.gear.head = h; }
    if (i === 1) s.gear.head = newItem("commset");
  });
  const [a, c, d] = P(b);
  const [e0] = E(b);
  place(a, 5, 5); place(c, 5, 8); place(d, 5, 11); place(e0, 12, 5);
  a.weapon = "ar"; a.ap = 2;
  check(a.ears && a.ears.key === "commset" && a.link && c.link && !d.link, "the headsets: on the helmet's ear mount and on a bare head");
  check(a.vsight === -1 && sightRange(b, a) === a.sight - 1, "a ballistic visor down: a tile of sight");
  b.visorFog = false;
  check(visorAim(a, b) === -2, "a ballistic visor down: −2 aim");
  b.visorFog = true;
  check(visorAim(a, b) === -5, "fogged: −3 more");
  const err = combatAct(st, { type: "visor", unit: a.id });
  check(!err && a.visorUp && a.ap === 2 && a.vsight === 0, "the Visor toggle is free and raises it (no aim, no sight lost)");
  check(visorAim(a, b) === 0, "raised: no fog either");
  check(/No visor/.test(combatAct(st, { type: "visor", unit: d.id })), "no visor: refused");
  combatAct(st, { type: "visor", unit: a.id });
  check(!a.visorUp, "and lowers it again");
  // The link: +5 at a target the other linked unit sees.
  b.visorFog = false;
  check(linkAim(b, a, e0) === HEAR.LINK_AIM, "linked: +5 at a target the other headset sees");
  c.link = false;
  check(linkAim(b, a, e0) === 0 && linkEscape(b, a) === 0, "alone on the net: nothing");
  c.link = true;
  check(linkEscape(b, a) === HEAR.LINK_ESCAPE, "escape odds +5 with a linked teammate up");
  const withLink = escapeOdds(b, a).parts.some(([l, v]) => /headset/.test(l) && v === 5);
  check(withLink, "escapeOdds lists the team headset");
  // A riot visor fogs too; a motorcycle visor does not.
  const r = { pieces: { head: newItem("riothelmet") } };
  const m = { pieces: { head: newItem("bikehelmet") } };
  b.visorFog = true;
  check(visorAim(r, b) === -3 && visorAim(m, b) === 0, "fog: a riot visor −3, a motorcycle visor nothing");
  b.visorFog = false;
}

// ---------- 10. flashbangs ----------
section("10. Flashbangs: ear protection alone takes at most 0.4; a near one still costs an action");
{
  const st = world();
  const b = openBattle(st, { kind: "raiders", count: 2, power: 3 }, 2, (s, i) => { if (i === 0) s.gear.head = newItem("commset"); });
  const [me, mate] = P(b);
  check(near(me.earCut, 0.4), `a headset: u.earCut 0.4 (${me.earCut})`);
  check(near(flashCut(me), 0.4), "flashCut reads it");
  place(me, 10, 5, [-1, 0]); place(mate, 11, 9);
  const [e0] = E(b);
  place(e0, 2, 2);
  landEffect(b, mate, THROWABLES.flashbang, 9, 5);
  check(me.stun && me.stun.ap === FLASH.apNear - 1 && me.stun.ap >= 1, `a near flashbang with ear protection: still −${me.stun ? me.stun.ap : "?"} action`);
  check(me.deaf >= 1 || me.ears, "the bang rings in the ears (deaf unless protected)");
  check(near(flashCut({ visor: true }), FLASH.visor) && flashCut({ visor: true, visorUp: true }) === 0, "a raised visor takes nothing off a flashbang");
  const g = { kind: "human", id: 1 };
  let vis = false;
  for (let i = 0; i < 200 && !vis; i++) { g.id = i; kitHeadgearT(g, "guards", 3); if (g.helmKey === "riothelmet") vis = g.visor === true; }
  check(vis, "a guard in a riot helmet has its visor against a flashbang (AI parity)");
}

// ---------- 11. enemies and arsenals ----------
section("11. Enemies wear headgear by kit; their bodies drop it; group arsenals hold and issue it");
{
  let mil = 0, hc = 0, cs = 0, n = 0;
  for (let i = 0; i < 4000; i++) { const k = rollHeadKit("soldiers", 7, i); n++; if (k.helm === "milhelmet") mil++; if (k.helm === "highcut") hc++; if (k.ears === "commset") cs++; }
  check(Math.abs(mil / n - 0.6) < 0.03 && Math.abs(hc / n - 0.15) < 0.02 && Math.abs(cs / n - 0.3) < 0.03, `soldiers: combat helmet ${(mil / n * 100).toFixed(0)}% (60), high-cut ${(hc / n * 100).toFixed(0)}% (15), headset ${(cs / n * 100).toFixed(0)}% (30)`);
  let riot = 0, ed = 0, bad = 0;
  for (let i = 0; i < 4000; i++) { const k = rollHeadKit("guards", 7, i); if (k.helm === "riothelmet") riot++; if (k.ears === "eardef") ed++; if (k.helm === "riothelmet" && k.ears && GEAR[k.ears].slot !== "pack") bad++; }
  check(riot > 0 && ed > 0 && bad === 0, `guards: riot helmets (${riot}), electronic defenders (${ed}), never both (a full shell)`);
  let rb = 0, rh = 0, rm = 0;
  for (let i = 0; i < 4000; i++) { const k = rollHeadKit("raiders", 7, i); if (k.helm === "bikehelmet") rb++; if (k.helm === "hardhat") rh++; if (k.ears === "earmuffs") rm++; }
  check(rb > 400 && rh > 250 && rm > 100, `raiders: motorcycle helmets ${rb}, hard hats ${rh}, muffs ${rm}`);
  const st = world();
  const b = openBattle(st, { kind: "soldiers", count: 6, power: 5 });
  const rng = new Rng(seed);
  let worn = 0, units = 0, bodies = 0, dropped = 0, earsOk = 0, ears = 0;
  for (let i = 0; i < 300; i++) {
    const u = enemyUnit(b, rng, "soldiers", 5, i + 1);
    units++;
    if (u.helmKey) { worn++; if (u.pieces && u.pieces.head && u.pieces.head.key === u.helmKey) bodies++; }
    if (u.earKey) { ears++; if (u.ears && u.ears.key === u.earKey && u.link === (u.earKey === "commset")) earsOk++; }
    if (i < 60 && u.helmKey) {
      const body = enemyBody(new Rng(i), u, KITS.soldiers);
      const its = allItems(body);
      const h = its.find((it) => it.key === u.helmKey);
      if (h && h.dur <= u.pieces.head.dur && condRolled(h)) dropped++;
    }
  }
  check(worn > units * 0.6 && bodies === worn, `enemyUnit: ${worn} of ${units} soldiers wear a helmet, a piece that wears (armour.js)`);
  check(ears > 0 && earsOk === ears, `${ears} wear a headset (u.ears, the team link)`);
  check(dropped > 20, `their bodies drop the helmet at no more than its wear, through itemcond.js (${dropped})`);
  // Arsenals: a soldiers' group seeds helmets and headsets; its people are issued them.
  const st2 = world();
  const f = st2.factions.find((x) => x.type === "military" && x.alive) || st2.factions.find((x) => x.alive && (x.type === "fortress"));
  if (f) {
    const A = ensureArsenal(st2, f);
    const helms = A.items.filter((it) => it.key === "milhelmet" || it.key === "highcut").length;
    const sets = A.items.filter((it) => it.key === "commset").length;
    check(helms > 0 && sets > 0 && A.headgear, `${f.name}'s arsenal holds ${helms} helmets and ${sets} headsets`);
    check(isArmourKey("highcut") && isArmourKey("hardhat") && !isArmourKey("commset"), "helmets are armour pieces in an arsenal; headsets are not");
    const st3 = st2;
    const h = hub(st3);
    st3.combat = createBattle(st3, { tile: h.tile, baseId: h.id, fighterIds: atBase(st3, h.id).slice(0, 2).map((s) => s.id), enemy: { kind: "soldiers", count: 4, power: 4, factionId: f.id }, ambush: null, canRetreat: false, handler: "ht", context: {} });
    const eu = st3.combat.units.filter((u) => u.side === "enemy");
    const issuedHelm = eu.filter((u) => u.pieces && u.pieces.head && f.arsenal.items.includes(u.pieces.head)).length;
    const earItem = (u) => (u.who ? (earGearOf(u.who) || {}).item : (u.arsArmour || []).find((it) => it.key === u.earKey)); // a person (fighters.js): the ear gear they carry
    const issuedEar = eu.filter((u) => u.earKey && earItem(u) && earItem(u).key === u.earKey && f.arsenal.items.includes(earItem(u))).length;
    check(eu.every((u) => u.arsFid === f.id), "the battle's soldiers are armed from the arsenal");
    check(issuedHelm > 0, `they wear the arsenal's own helmets (${issuedHelm} of ${eu.length})`);
    check(issuedEar > 0, `and its headsets (${issuedEar})`);
    const one = eu.find((u) => u.earKey);
    if (one) {
      const worn = earItem(one); // before the body takes it off them
      const body = enemyBody(new Rng(1), one, KITS.soldiers);
      const onBody = allItems(body).flatMap((it) => [it, ...Object.values(it.mods || {})]); // a headset may sit on the helmet's ear mount
      check(onBody.some((it) => it === worn && it.key === one.earKey), "a group fighter's body holds its very headset");
    }
    // An old save's arsenal (no headgear yet): dealt once, never twice.
    const n0 = f.arsenal.items.length;
    delete f.arsenal.headgear;
    ensureArsenal(st2, f);
    const n1 = f.arsenal.items.length;
    ensureArsenal(st2, f);
    check(n1 > n0 && f.arsenal.items.length === n1, `an older arsenal gets its headgear once (${n0} → ${n1})`);
    st3.combat = null;
  } else check(false, "a military group to test");
}

// ---------- 12. loot, repair, earplugs ----------
section("12. Loot tags and sources; repair; earplugs wear a pair a fight");
{
  const keys = Object.keys(HELMET_GEAR);
  check(keys.every((k) => GEAR[k] && ITEM_TAGS[k] && ITEM_TAGS[k].length), "every new item is in GEAR and has theme tags (loot.js ITEM_TAGS)");
  const sources = new Set([...Object.values(HEAD_FINDS), ...Object.values(AREA_HEAD), ...Object.values(WARE_HEAD)].flatMap((t) => Object.keys(t.items)));
  check(keys.every((k) => sources.has(k)), "every new item has a loot source");
  const misfit = [];
  for (const [t, f] of Object.entries(HEAD_FINDS)) for (const k of Object.keys(f.items)) if (!fitsTags(k, SITE_TAGS[t] || [])) misfit.push(`${k}@${t}`);
  for (const [a, f] of Object.entries(AREA_HEAD)) for (const k of Object.keys(f.items)) if (!fitsTags(k, AREA_TAGS[a] || [])) misfit.push(`${k}@${a}`);
  check(!misfit.length, `every find fits its place's tags${misfit.length ? `: ${misfit.join(", ")}` : ""}`);
  const st = world();
  const tile = st.tiles.findIndex((t) => t && t.loc && t.loc.type === "hardware");
  let found = 0, cond = 0;
  for (let h = 0; h < 2000 && tile >= 0; h++) { st.hour = h; const it = rollHeadFind(st, tile, 1, "t"); if (it) { found++; if (condRolled(it)) cond++; } }
  check(tile < 0 || (found > 0 && cond === found), `a hardware store's search hours find hard hats and muffs (${found}), all through itemcond.js`);
  let af = 0;
  for (let i = 0; i < 2000; i++) if (rollAreaHead(st, 3, "gunshop", `b${i}`)) af++;
  check(af > 0, `a raid's gun shop containers (${af} of 2000)`);
  let wf = 0;
  for (let i = 0; i < 400; i++) wf += headWares(st, "military", `g${i}`, i).length;
  check(wf > 0, `military traders sell them (${wf} of 400 tables)`);
  // Repair.
  const bv = newItem("ballvisor");
  bv.dur = 0;
  check(repairKind(bv) && repairKind(bv).refuse, "a ballistic visor cannot be repaired");
  const ed = newItem("eardef");
  ed.dur = 5;
  const rk = repairKind(ed);
  check(rk && rk.kind === "recharge" && rk.def.gearIn.batteries === 1, "electronic defenders: a battery swap (1 pack of batteries)");
  const math = repairMath(ed, 0);
  check(math.dur === ed.durMax || math.dur === GEAR.eardef.dur, `the swap restores them in full (${math.dur})`);
  check(math.loss === 0, "and loses no maximum");
  // Earplugs: a pair a fight.
  const s = atBase(st, hub(st).id)[0];
  s.pockets = s.pockets.map(() => null);
  s.gear.head = null;
  const pl = newItem("earplugs");
  s.pockets[0] = pl;
  const u = {};
  fitHeadgear(u, s);
  check(u.ears && u.ears.key === "earplugs" && near(u.earCut, 0.3), "earplugs in a pocket work (cut 3; a flashbang's 0.3)");
  settleEars(u, s, true);
  check(pl.dur === GEAR.earplugs.dur - 1, `a pair used in a fight (${pl.dur} left)`);
  pl.dur = 1;
  settleEars(u, s, true);
  check(s.pockets[0] == null, "the last pair: the strip is gone");
  const muffsOnly = newItem("earmuffs");
  s.pockets[1] = muffsOnly;
  check(!earGearOf(s), "muffs in a pocket do nothing (worn only)");
  // Rag earplugs (data.js ragplugs, crafting.js CRAFTS.ragplugs): makeshift plugs, weaker than foam, worn a pair a fight.
  s.pockets[1] = null;
  const rd = GEAR.ragplugs, rr = CRAFTS.ragplugs;
  check(rd && rd.makeshift && rd.small && rd.slot === "pack" && rd.ears && rd.ears.cut < GEAR.earplugs.ears.cut && rd.ears.hear === GEAR.earplugs.ears.hear && rd.dur < GEAR.earplugs.dur, "rag earplugs: a small makeshift pocket item, a weaker cut than foam, the same hearing, fewer fights");
  check(rr && rr.gear === "ragplugs" && rr.in.scrap === 1 && Object.keys(rr.in).length === 1 && rr.hours === 1 && rr.min === 0 && rr.field === true && !rr.needs, "the recipe: 1 scrap, 1 hour, no skill, in the field");
  check(craftLock({ known: [] }, "ragplugs") === "", "no book or blueprint locks them");
  check(/ear protection/.test(craftOutputText("ragplugs")) && /2 off/.test(craftOutputText("ragplugs")) && /fights/.test(craftOutputText("ragplugs")), `the recipe's output text says what they do (${craftOutputText("ragplugs")})`);
  const rp = makeItem("ragplugs", 0.75);
  check(rp.dur === rd.dur, `made at 75% they last the listed ${rd.dur} fights (${rp.dur})`);
  check(makeItem("ragplugs", 1).dur > rd.dur, "well made, more");
  s.pockets[0] = rp;
  fitHeadgear(u, s);
  check(u.ears && u.ears.key === "ragplugs" && u.ears.cut === 2 && u.ears.hear === -3 && !u.ears.elec && near(u.earCut, 0.2), "rag plugs in a pocket work (cut 2; a flashbang's 0.2)");
  u.x = 0; u.y = 0;
  const rifleOut = bangOf({ cells: [], w: 0 }, { x: 0, y: 0, weapon: "ar" }); // a rifle outdoors: bang 3 (section 1)
  const shooterIn = (ears) => { const keep = u.ears; u.ears = ears; const e = exposure(u, 0, 0, rifleOut, u); u.ears = keep; return e; }; // the same unit as its own shooter (+1)
  const inFoam = shooterIn(plugs), inRag = shooterIn(u.ears), bare = shooterIn(null);
  check(inRag < HEAR.DEAF && inFoam < inRag, `a rifle outdoors rings its shooter's ears more in rag plugs (e = ${inRag}) than in foam (${inFoam}), neither deafened`);
  check(inRag < bare && bare >= HEAR.DEAF, `bare ears are deafened by it (${bare})`);
  check(hearMult(u) === HEAR.MULT.plugs, "a guard in rag plugs hears you behind them like one in foam");
  settleEars(u, s, true);
  check(rp.dur === rd.dur - 1, `a pair used in a fight (${rp.dur} left)`);
  settleEars(u, s, false);
  check(rp.dur === rd.dur - 1, "none used when nobody fought");
  rp.dur = 1;
  settleEars(u, s, true);
  check(s.pockets[0] == null, "the last pair: the tin is gone");
  s.pockets[0] = newItem("ragplugs"); s.pockets[1] = newItem("earplugs");
  fitHeadgear(u, s);
  check(u.ears && u.ears.key === "earplugs", "foam plugs are used over rag plugs when both are carried");
  settleEars(u, s, true);
  check(s.pockets[1].dur === GEAR.earplugs.dur - 1 && s.pockets[0].dur === rd.dur, "and only the foam strip wears");
  check(repairKind(newItem("ragplugs")) === null && repairKind(newItem("earplugs")) === null, "earplugs are used up, never mended (repair.js)");
  check(IA.hasItemArt("ragplugs", "gear"), "rag earplugs have their drawing (ui/itemart)");
}

// ---------- 13. save ----------
section("13. A save round trip keeps helmet mods (and a battle's deaf units)");
{
  const st = world();
  const h = hub(st);
  const s = atBase(st, h.id)[0];
  const helm = newItem("highcut");
  fitHelmetMod(helm, newItem("ballvisor"));
  fitHelmetMod(helm, newItem("nvg"));
  fitHelmetMod(helm, newItem("commset"));
  s.gear.head = helm;
  const hh = newItem("hardhat");
  fitHelmetMod(hh, newItem("nvgmount"));
  fitHelmetMod(hh, newItem("helmetlight"));
  h.armory.push(hh);
  const st2 = loadFromString(saveToString(st));
  const s2 = survivorById(st2, s.id);
  const h2 = s2.gear.head;
  check(h2 && h2.key === "highcut" && h2.mods && h2.mods.face.key === "ballvisor" && h2.mods.nvg.key === "nvg" && h2.mods.ears.key === "commset", "the worn helmet keeps its visor, goggles and headset");
  const hh2 = hub(st2).armory.find((it) => it.key === "hardhat");
  check(hh2 && hh2.mods && hh2.mods.rail.key === "nvgmount" && hh2.mods.light.key === "helmetlight", "a hard hat in the armory keeps its mount and light");
  check(helmetNvg(s2) && earGearOf(s2).key === "commset", "and they still work after loading");
  // Mid-battle: deafness survives a save.
  const b = openBattle(st2);
  const [me] = P(b);
  me.deaf = 2; me.dazed = 1; me.visorUp = true;
  b.ghosts = { 99: [1, 1, b.turn, 0, 1] };
  const st3 = loadFromString(saveToString(st2));
  const me3 = st3.combat && st3.combat.units.find((u) => u.id === me.id);
  check(me3 && me3.deaf === 2 && me3.dazed === 1 && me3.visorUp, "a battle saved mid-fight keeps deafness, the daze and the visor");
  check(st3.combat && st3.combat.ghosts && st3.combat.ghosts[99] && st3.combat.ghosts[99][4] === 1, "and the heard markers");
}

// ---------- 14. the UI ----------
section("14. The UI: the Visor button and its key, the Deaf chip, heard markers drawn, the muffled sound, the inventory's helmet mounts");
{
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  const { battleCues, LISTEN } = await import("../src/ui/soundcues.js");
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  const st = world();
  const b = openBattle(st, { kind: "raiders", count: 2, power: 3 }, 2, (s, i) => { if (i === 0) s.gear.head = newItem("riothelmet"); });
  const [u, v] = P(b);
  const [e0] = E(b);
  place(u, 5, 5); place(v, 5, 8); place(e0, 20, 5);
  UI.cui.sel = u.id; u.ap = 2;
  let html = UI.renderCombatScreen(st);
  check(/data-v="visor"[^>]*>Visor up/.test(html), "a riot helmet: a Visor up button");
  UI.combatKey(st, { code: "KeyY", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} });
  check(u.visorUp && /data-v="visor"[^>]*>Visor down/.test(UI.renderCombatScreen(st)), "Shift+Y raises it; the button says Visor down");
  UI.cui.sel = v.id;
  check(!/data-v="visor"/.test(UI.renderCombatScreen(st)), "no helmet: no Visor button");
  UI.cui.sel = u.id;
  u.deaf = 2; u.dazed = 1;
  html = UI.renderCombatScreen(st);
  check(/Deaf 2/.test(html) && /Dazed/.test(html), "the unit line shows Deaf 2 and Dazed");
  b.ghosts = { [e0.id]: [12, 12, b.turn, 0, 1] };
  e0.x = 25; e0.y = 20;
  let err = "";
  for (const view of ["iso"]) { try { void view; UI.drawCombat(st, 1e9); } catch (e) { err = e.stack.split("\n").slice(0, 2).join(" "); } }
  check(!err, `a heard marker draws in both views${err ? `: ${err}` : ""}`);
  // The sound: muffled while the selected unit is deaf, a ring as it starts.
  const mem = {};
  battleCues(b, mem, 0);
  LISTEN.sel = () => u.id;
  u.deaf = 0;
  b.fx.push({ type: "shot", from: [e0.x, e0.y], to: [u.x, u.y], hit: false, side: "enemy", seq: (b.fxSeq = (b.fxSeq || 0) + 1) });
  const loud = battleCues(b, mem, 1).find((c) => c.name !== "whiz" && c.name !== "ricochet");
  u.deaf = 1;
  b.fx.push({ type: "shot", from: [e0.x, e0.y], to: [u.x, u.y], hit: false, side: "enemy", seq: (b.fxSeq = b.fxSeq + 1) });
  const quiet = battleCues(b, mem, 2);
  const shot = quiet.find((c) => c.name !== "whiz" && c.name !== "ricochet" && c.name !== "ring");
  check(loud && shot && near(shot.gain, (loud.gain ?? 1) * 0.3, 1e-6) && quiet.some((c) => c.name === "ring"), `deaf: the battle at 30% (${loud && loud.gain} → ${shot && shot.gain}) and a ring`);
  LISTEN.sel = () => UI.cui.sel;
  st.combat = null;
  // The inventory: a helmet's mounts, a loose part's Fit button.
  const { inventoryModal, INV_ACTIONS, itemTip } = await import("../src/ui/inventory.js");
  const s = atBase(st, hub(st).id)[0];
  s.gear.head = newItem("milhelmet");
  s.pockets = s.pockets.map(() => null);
  s.pockets[0] = newItem("helmetlight");
  const ui = { inv: null, invSel: null, invMsg: "" };
  INV_ACTIONS["inv-open"](st, ui, { id: String(s.id) });
  INV_ACTIONS["inv-click"](st, ui, { loc: `s:${s.id}:head` });
  html = inventoryModal(st, ui) || "";
  check(/Helmet mounts:/.test(html) && /data-action="inv-helmfit"[^>]*>Helmet light/.test(html), "a selected helmet: its mounts, the helmet light offered for the light mount");
  INV_ACTIONS["inv-helmfit"](st, ui, { part: `s:${s.id}:pocket:0` });
  check(s.gear.head.mods && s.gear.head.mods.light && /data-action="inv-helmstrip"/.test(inventoryModal(st, ui) || ""), `fitted (${ui.invMsg}); a × to take it off`);
  check(/fitted: helmet light/.test(itemTip(s.gear.head, s)), "the helmet's tooltip lists what is fitted");
  INV_ACTIONS["inv-helmstrip"](st, ui, { mount: "light" });
  check(!s.gear.head.mods, `taken off again (${ui.invMsg})`);
  ui.invSel = null;
  s.gear.head = newItem("bikehelmet");
  INV_ACTIONS["inv-click"](st, ui, { loc: `s:${s.id}:head` });
  check(/a full shell/.test(inventoryModal(st, ui) || ""), "a motorcycle helmet: no mounts (a full shell)");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
