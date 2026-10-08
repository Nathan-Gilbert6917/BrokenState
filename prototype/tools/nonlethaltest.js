// Non-lethal weapons, taking people alive and surrender (src/sim/nonlethal.js, data-nonlethal.js, ui/nonlethal.js): the
// taser's stun and knock-out thresholds, cartridges and reload; the stun baton; pepper spray's cone and blindness; the
// dead unaffected; the beanbag / rubber-round hook; your people knocked out (waking in 2–4 turns, tied, taken captive or
// finished when the enemy holds the field); every group type's choice winning and losing, raiders after skilled targets,
// the police AI going non-lethal and your AI with "Take them alive"; surrender (when losing, never zealots, the weapon
// dropped, tie → prisoner, an untied one walking off, execute and its mood cost, your own surrender); loot through
// itemcond; by the numbers (AI raids: prisoners instead of dead; a decisive win of yours); a battle saved mid-fight.
// Usage: node tools/nonlethaltest.js [seed]
import { createWorld, hub, atBase, survivorById, factionById } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { AMMO_TYPES } from "../src/sim/data-ammo.js";
import {
  createBattle, combatAct, closeCombat, autoPlayerTurn, runEnemyPhase, endPlayerTurn, registerCombatHandler, active, unitAt,
  shotOdds, damage, WEAPONS, KITS, endBattleNow, autoResolveCombat,
} from "../src/sim/combat.js";
import {
  NL, NL_STYLE, SURRENDER, taserOdds, coneCells, coneUnits, wantsAlive, aliveMult, isPrize, nlAI, surrenderCheck,
  raidPrisoners, aiCaptivesDaily, nlEnemyPhase, numbersSurrenders, nlStatus, surrenderRefusal, NL_HELP, NL_TAKE, surrender,
} from "../src/sim/nonlethal.js";
import { battleCaptives } from "../src/sim/stealth.js";
import { newItem, stow, enemyBody } from "../src/sim/inventory.js";
import { condRolled } from "../src/sim/itemcond.js";
import { rollFind, rollAreaFind, SITE_FINDS, AREA_FINDS, ITEM_TAGS } from "../src/sim/loot.js";
import { capturePrisoners, prisonersAt, prisonersWith } from "../src/sim/prisoners.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { Rng } from "../src/sim/rng.js";
import { nlButtons, nlTags, nlPreview, nlConeMask } from "../src/ui/nonlethal.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();
registerCombatHandler("nl", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; return st; };
const pct = (v) => `${Math.round(v * 100)}%`;

function baseBattle(st, { count = 3, kind = "raiders", power = 3, ambush = null, factionId = null, fighters = 3 } = {}) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, fighters).map((s) => s.id);
  const setup = { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind, count, power, factionId, name: "Test" }, ambush, canRetreat: false, handler: "nl", context: {} };
  st.combat = createBattle(st, setup);
  const b = st.combat;
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0); b.reach.fill(1);
  return b;
}
const mine = (b) => b.units.filter((u) => u.side === "player");
const theirs = (b) => b.units.filter((u) => u.side === "enemy");
// Line everyone up on an empty field: yours on row 6 from x 4, theirs on row 6 from x 10 (or where given).
function place(b, list, x0, y = 6) { list.forEach((u, i) => { u.x = x0 + i; u.y = y; u.aware = true; }); }
const giveTaser = (st, s, shots = 2, carts = 1) => { const it = newItem("taser"); it.shots = shots; stow(s, it); for (let i = 0; i < carts; i++) stow(s, newItem("tasercart")); };

// 1. The data.
{
  console.log("Data");
  check(["taser", "tasercart", "pepper", "stunbaton"].every((k) => GEAR[k] && GEAR[k].desc && GEAR[k].value > 0 && ITEM_TAGS[k]), "taser, cartridges, pepper spray and the stun baton are items with tags");
  check(WEAPONS.stunbaton && WEAPONS.stunbaton.melee && WEAPONS.stunbaton.nonlethal && WEAPONS.stunbaton.stun === 1, "the stun baton is a non-lethal melee weapon that stuns (1)");
  check(KITS.guards.weapons.includes("stunbaton") && ["taser", "tasercart", "pepper"].every((k) => KITS.guards.loot.includes(k)), "guards fight with stun batons and carry tasers, cartridges and spray");
  check(/Non-lethal|Knocked out/.test(NL_HELP) && /Surrender/.test(NL_HELP), "the Help topic covers the kit and surrender");
}

// 2. The taser.
{
  console.log("Taser");
  const st = world();
  const b = baseBattle(st, { count: 2, kind: "guards" });
  const [u] = mine(b), [t, t2] = theirs(b);
  const s = survivorById(st, u.sid);
  giveTaser(st, s, 2, 1);
  u.nlTaser = null; // looked up again (nlEnsure)
  place(b, mine(b), 2, 3); u.x = 4; u.y = 6; t.x = 7; t.y = 6; t2.x = 8; t2.y = 9;
  u.aim = 60; t.hp = t.maxHp;
  const near = taserOdds(b, u, t);
  t.x = 8; const far = taserOdds(b, u, t); t.x = 7;
  t.x = 9; const out = taserOdds(b, u, t); t.x = 7;
  check(near.ok && far.ok && far.chance < near.chance && !out.ok, `odds fall off with distance (${near.chance}% at 3, ${far.chance}% at 4) and stop beyond ${NL.TASER.range} tiles`);
  check(!near.ko && /stuns/.test(near.label), `a healthy target is stunned, not dropped: "${near.label}"`);
  t.hp = Math.floor(t.maxHp * NL.TASER.ko) - 1;
  check(taserOdds(b, u, t).ko, `under ${pct(NL.TASER.ko)} health it knocks out`);
  t.hp = t.maxHp;
  // A sure hit: stunned (loses both actions on its turn), then −20 aim the turn after.
  u.aim = 200;
  const err = combatAct(st, { type: "taser", unit: u.id, target: t.id });
  check(!err && u.nlTaser === 1 && u.ap === 0 && t.nl && t.nl.stun === NL.TASER.stun, `tased: 1 cartridge left, the turn used, ${t.name} stunned (${err || "ok"})`);
  for (const o of mine(b)) o.ap = 0;
  endPlayerTurn(st);
  check(t.ap === 0 || b.phase !== "enemy", `${t.name} lost its next ${NL.TASER.stun} actions (ap ${t.ap})`);
  runEnemyPhase(st);
  // Its next turn: dazed (−20 aim).
  for (const o of mine(b)) o.ap = 0;
  const p0 = mine(b).find((o) => active(o));
  endPlayerTurn(st);
  const dz = t.nl && t.nl.dazeOn;
  const before = shotOdds(b, t, p0).chance + 0; // with the daze
  const save = t.nl.dazeOn; t.nl.dazeOn = false; const plain = shotOdds(b, t, p0).chance; t.nl.dazeOn = save;
  check(dz && (plain - before === NL.TASER.daze || before === 5 || plain === 95), `the turn after it is dazed: aim −${NL.TASER.daze} (${plain}% → ${before}%)`);
  runEnemyPhase(st);
  // Knock-out threshold, cartridges, reload.
  if (b.phase === "player" && !b.over) {
    u.ap = 2;
    t2.hp = Math.floor(t2.maxHp * 0.3); t2.x = 6; t2.y = 6; t2.down = false;
    const e2 = combatAct(st, { type: "taser", unit: u.id, target: t2.id });
    check(!e2 && t2.ko && t2.down && !t2.dead, `a target under ${pct(NL.TASER.ko)} drops, knocked out, alive (${e2 || "ok"})`);
    u.ap = 2;
    const e3 = combatAct(st, { type: "taser", unit: u.id, target: t.id });
    check(/spent/.test(e3), `two cartridges, then spent: "${e3}"`);
    const e4 = combatAct(st, { type: "reloadTaser", unit: u.id });
    check(!e4 && u.nlTaser === 2 && u.ap === 1 && u.nlCarts === 0, "a cartridge pack reloads it (1 action)");
    endBattleNow(st, "victory");
    closeCombat(st);
    const tz = s.gear && [s.gear.tool, ...(s.pockets || [])].find((it) => it && it.key === "taser");
    const left = [...(s.pockets || []), ...Object.values(s.gear || {})].filter((it) => it && it.key === "tasercart").length;
    check(tz && tz.shots === 2 && left === 0, `after the battle the taser keeps its cartridges (${tz && tz.shots}) and the pack used is gone (${left} left)`);
  } else check(false, "the battle went on to the player turn");
}

// 3. The dead are unaffected; the stun baton; pepper spray.
{
  console.log("The dead, the stun baton, pepper spray");
  const st = world(seed + 1);
  const b = baseBattle(st, { count: 2, kind: "zombies" });
  const [u] = mine(b), [z] = theirs(b);
  giveTaser(st, survivorById(st, u.sid));
  u.nlTaser = null;
  place(b, mine(b), 2, 3); u.x = 4; u.y = 6; z.x = 6; z.y = 6; u.aim = 200;
  const hp0 = z.hp;
  combatAct(st, { type: "taser", unit: u.id, target: z.id });
  check(z.hp === hp0 && !(z.nl && z.nl.stun) && !z.ko, "a taser does nothing to the dead");
  // A non-lethal blow on one of the dead is a plain blow: it can kill.
  z.hp = 1;
  damage(b, z, 50, u, true, { how: "melee" });
  check(z.dead && !z.ko, "a non-lethal blow kills one of the dead (no consciousness to knock out)");
  // Stun baton on a person: stuns 1, never kills.
  const st2 = world(seed + 2);
  const b2 = baseBattle(st2, { count: 2, kind: "raiders" });
  const [a] = mine(b2), [r, r2] = theirs(b2);
  place(b2, mine(b2), 2, 3); a.x = 4; a.y = 6; r.x = 5; r.y = 6; r2.x = 12; r2.y = 12;
  a.weapon = "stunbaton"; a.meleeAim = 500;
  r.hp = r.maxHp;
  combatAct(st2, { type: "melee", unit: a.id, target: r.id });
  check(r.hp < r.maxHp && r.nl && r.nl.stun === NL.BATON.stun, `a stun baton hit stuns (−${NL.BATON.stun} action) and hurts`);
  r.hp = 2; a.ap = 2;
  combatAct(st2, { type: "melee", unit: a.id, target: r.id });
  check(r.ko && !r.dead, "a stun baton never kills the living: at 0 they are knocked out");
  // Pepper spray: the cone, the blinded, the dead in it.
  const st3 = world(seed + 3);
  const b3 = baseBattle(st3, { count: 3, kind: "raiders" });
  const [p, p2] = mine(b3), [e1, e2, e3] = theirs(b3);
  stow(survivorById(st3, p.sid), newItem("pepper"));
  p.nlPepper = null;
  place(b3, mine(b3), 1, 1); p.x = 5; p.y = 6; p2.x = 3; p2.y = 6;
  e1.x = 7; e1.y = 6; e2.x = 8; e2.y = 7; e3.x = 5; e3.y = 9; // e3 off to the side
  const cells = coneCells(b3, p, 8, 6);
  const has = (x, y) => cells.some(([cx, cy]) => cx === x && cy === y);
  check(has(6, 6) && has(8, 6) && has(7, 7) && !has(4, 6) && !has(9, 6) && !has(5, 9), `the cone: ${cells.length} cells, 3 tiles out the way it is aimed, nothing behind or to the side`);
  const cu = coneUnits(b3, p, 8, 6);
  check(cu.foes.includes(e1) && cu.foes.includes(e2) && !cu.foes.includes(e3) && !cu.friends.length, "it would catch the two in front, not the one to the side, none of yours");
  const ow0 = shotOdds(b3, e1, p).chance;
  e1.ow = true;
  const err = combatAct(st3, { type: "pepper", unit: p.id, x: 8, y: 6 });
  const ow1 = shotOdds(b3, e1, p).chance;
  check(!err && e1.nl.blind === NL.PEPPER.turns && e2.nl.blind === NL.PEPPER.turns && !e3.nl && !e1.ow && p.nlPepper === GEAR.pepper.dur - 1, `sprayed: both blinded ${NL.PEPPER.turns} turns, overwatch dropped, a spray used (${p.nlPepper} left)`);
  check(ow0 - ow1 === NL.PEPPER.blind || ow1 === 5, `blinded: aim −${NL.PEPPER.blind} (${ow0}% → ${ow1}%)`);
  e1.ap = 2;
  check(nlStatus(b3, e1).includes("Blinded") && nlTags(e1).some(([x]) => x === "BLIND"), `status "${nlStatus(b3, e1)}" and a BLIND tag`);
  // The preview (ui/nonlethal.js).
  const cui = { mode: "pepper", hover: { x: 8, y: 6 } };
  const mask = nlConeMask(b3, p, cui);
  check(mask && mask.size === cells.length && /blinds/.test(nlPreview(b3, null, cui.hover, p, cui)), "the cone preview: the cells, and who it would blind");
  // Zombies in a cone: nothing.
  const st4 = world(seed + 4);
  const b4 = baseBattle(st4, { count: 1, kind: "zombies" });
  const [q] = mine(b4), [zz] = theirs(b4);
  stow(survivorById(st4, q.sid), newItem("pepper")); q.nlPepper = null;
  place(b4, mine(b4), 1, 1); q.x = 5; q.y = 6; zz.x = 7; zz.y = 6;
  combatAct(st4, { type: "pepper", unit: q.id, x: 7, y: 6 });
  check(!zz.nl, "pepper spray does nothing to the dead");
}

// 4. Beanbag and rubber rounds (the ammo agent's types: AMMO_TYPES[type].nonlethal).
{
  console.log("Beanbag and rubber rounds");
  const st = world(seed + 5);
  const b = baseBattle(st, { count: 2, kind: "raiders" });
  const [u] = mine(b), [t, t2] = theirs(b);
  const had = AMMO_TYPES.beanbag;
  AMMO_TYPES.beanbag = AMMO_TYPES.beanbag || { name: "beanbag", dmg: 0.5, nonlethal: true };
  t.hp = 5;
  damage(b, t, 50, u, false, { how: "shot", ammo: "beanbag" });
  check(t.ko && !t.dead, "a round of a non-lethal type (hit.ammo) knocks out instead of killing");
  u.ammoType = "beanbag"; t2.hp = 5;
  damage(b, t2, 50, u, false, { how: "shot" });
  check(t2.ko && !t2.dead, "so does the shooter's loaded type (u.ammoType)");
  if (!had) delete AMMO_TYPES.beanbag;
}

// 5. Your people knocked out: waking, tied, taken.
{
  console.log("Your people knocked out");
  const st = world(seed + 6);
  const f = st.factions.find((x) => x.alive && x.type === "traders") || st.factions.find((x) => x.alive);
  const b = baseBattle(st, { count: 3, kind: "guards", factionId: f.id });
  const [u, u2] = mine(b), [g] = theirs(b);
  place(b, mine(b), 2, 3); place(b, theirs(b), 10, 3);
  u.hp = 3;
  damage(b, u, 20, g, true, { how: "melee" });
  check(u.ko && u.down && !u.dead && u.bleed == null && u.wake - b.turn >= NL.WAKE[0] && u.wake - b.turn <= NL.WAKE[1], `knocked out, not bleeding; wakes in ${u.wake - b.turn} turns (${NL.WAKE[0]}–${NL.WAKE[1]})`);
  check(/Knocked out/.test(nlStatus(b, u)), `status "${nlStatus(b, u)}"`);
  let turns = 0;
  while (u.ko && turns < 8 && !b.over) { for (const o of mine(b)) o.ap = 0; endPlayerTurn(st); runEnemyPhase(st); turns++; for (const e of theirs(b)) { e.x = Math.max(e.x, 10); } }
  check(!u.ko && !u.down && u.hp >= Math.round(u.maxHp * NL.WAKE_HP) && u.ap === 1, `comes to after ${turns} turns at ${Math.round(u.hp)} hp with one action`);
  // Tied up by them: never wakes; the enemy holds the field: taken captive.
  u2.hp = 2;
  damage(b, u2, 20, g, true, { how: "melee" });
  u2.tied = true;
  for (let i = 0; i < 5 && !b.over; i++) { for (const o of mine(b)) o.ap = 0; endPlayerTurn(st); runEnemyPhase(st); }
  check(u2.ko && u2.tied, "tied up, they do not come to");
  endBattleNow(st, "defeat");
  const s2 = survivorById(st, u2.sid);
  check(s2.location && s2.location.kind === "captive" && s2.location.factionId === f.id, `the enemy holds the field: ${s2.name} is their captive ({ kind: "captive", factionId })`);
  check((st.combat.summary || []).some((l) => /taken prisoner/.test(l)), "the summary says so");
  closeCombat(st);
  // With no group behind them: they come to after the enemy has moved on (alive).
  const st2 = world(seed + 7);
  const b2 = baseBattle(st2, { count: 2, kind: "guards", factionId: null });
  const [v] = mine(b2);
  v.hp = 2; damage(b2, v, 20, theirs(b2)[0], true, { how: "melee" });
  endBattleNow(st2, "defeat");
  check(survivorById(st2, v.sid).alive && !(survivorById(st2, v.sid).location || {}).kind?.startsWith("captive"), "no group behind them: they come to after the enemy has gone");
  closeCombat(st2);
  // Raiders sometimes finish the knocked out.
  let finished = 0, taken = 0;
  for (let i = 0; i < 30; i++) {
    const s3 = world(seed + 100 + i);
    const fr = s3.factions.find((x) => x.alive && x.type === "raider") || s3.factions.find((x) => x.alive);
    const b3 = baseBattle(s3, { count: 2, kind: "raiders", factionId: fr.id, fighters: 1 });
    const [w] = mine(b3);
    w.hp = 2; damage(b3, w, 20, theirs(b3)[0], true, { how: "melee" });
    endBattleNow(s3, "defeat");
    const sw = survivorById(s3, w.sid);
    if (!sw.alive) finished++; else if (sw.location && sw.location.kind === "captive") taken++;
  }
  check(finished > 0 && taken > finished, `raiders holding the field: ${taken} taken, ${finished} finished of 30 (finish ${pct(SURRENDER.finish.raiders)})`);
}

// 6. The AI: every group type, winning and losing; raiders and skilled targets; the police going non-lethal.
{
  console.log("The AI");
  const st = world(seed + 8);
  const b = baseBattle(st, { count: 4, kind: "guards", fighters: 2 });
  place(b, mine(b), 2, 3); place(b, theirs(b), 10, 3);
  const rate = (kit, edge, prize = false) => {
    b.nlEdge = { key: `${b.turn}:${b.phase}`, r: edge };
    const u = theirs(b)[0];
    const t = mine(b)[0];
    const keep = { aim: t.aim, medicine: t.medicine, hp: t.hp, maxHp: t.maxHp, meleeAim: t.meleeAim };
    if (prize) { t.aim = 70; } else { t.aim = 40; t.medicine = 0; t.hp = 60; t.meleeAim = 60; }
    u.kit = kit;
    let n = 0;
    const N = 400;
    for (let i = 0; i < N; i++) { b.turn = i; b.nlEdge = { key: `${b.turn}:${b.phase}`, r: edge }; if (wantsAlive(b, u, t)) n++; }
    Object.assign(t, keep);
    b.turn = 1;
    return n / N;
  };
  const kits = ["guards", "soldiers", "militia", "raiders", "fighters", "survivors", "zealots"];
  const win = {}, lose = {}, even = {};
  for (const k of kits) { win[k] = rate(k, 2); even[k] = rate(k, 1); lose[k] = rate(k, 0.5); }
  console.log(`    taking people alive (winning / even / losing): ${kits.map((k) => `${k} ${pct(win[k])}/${pct(even[k])}/${pct(lose[k])}`).join(", ")}`);
  check(win.guards >= 0.7 && win.militia >= 0.55 && win.soldiers >= 0.45, "winning, police and guards arrest, communes and the military take people alive");
  check(kits.every((k) => lose[k] === 0), "losing (desperate), every group fights to kill");
  check(win.zealots === 0 && even.zealots === 0, "zealots never");
  check(win.raiders > 0.05 && win.raiders < win.guards && even.guards < win.guards, "raiders now and then; an even fight halves it");
  const prize = rate("raiders", 2, true), plain = rate("raiders", 2, false);
  check(prize > plain * 2 && isPrize({ side: "player", aim: 70 }), `raiders go for strong or skilled-looking targets: ${pct(prize)} against ${pct(plain)}`);
  // The police AI with a taser, winning: it tases rather than shoots.
  const st2 = world(seed + 9);
  const b2 = baseBattle(st2, { count: 4, kind: "guards", fighters: 1 });
  place(b2, mine(b2), 4); place(b2, theirs(b2), 7, 5);
  const g = theirs(b2)[0];
  g.nlTaser = 2; g.nlCarts = 99; g.aim = 80; g.kit = "guards";
  b2.nlEdge = { key: `${b2.turn}:enemy`, r: 3 };
  b2.phase = "enemy"; g.ap = 2; b2.turn = 3;
  let used = 0;
  for (let i = 0; i < 20; i++) { b2.turn = 3 + i; b2.nlEdge = { key: `${b2.turn}:enemy`, r: 3 }; g.ap = 2; g.nlTaser = 2; const p = mine(b2)[0]; p.nl = null; p.down = false; p.ko = false; p.hp = p.maxHp; nlAI(b2, g); if (g.nlTaser < 2) used++; }
  check(used >= 12, `guards winning with a taser use it (${used} of 20 turns)`);
  // Losing: lethal.
  let usedLosing = 0;
  for (let i = 0; i < 20; i++) { b2.turn = 30 + i; b2.nlEdge = { key: `${b2.turn}:enemy`, r: 0.4 }; g.ap = 2; g.nlTaser = 2; if (nlAI(b2, g) || g.nlTaser < 2) usedLosing++; }
  check(usedLosing === 0 && !g.pull, "losing, they go lethal (no taser, no pulled blows)");
  // A whole fight against police: some of yours knocked out rather than all killed, guards end up using the kit.
  let ko = 0, dead = 0, nlUsed = 0;
  for (let i = 0; i < 12; i++) {
    const s = world(seed + 200 + i);
    const bb = baseBattle(s, { count: 6, kind: "guards", power: 5, fighters: 3 });
    for (const e of theirs(bb)) { e.nlTaser = 2; e.nlCarts = 99; }
    for (let k = 0; k < 40 && s.combat && !s.combat.over; k++) { autoPlayerTurn(s, { retreat: false }); if (s.combat && !s.combat.over) runEnemyPhase(s); }
    nlUsed += theirs(bb).filter((e) => e.nlTaser < 2).length;
    ko += mine(bb).filter((p) => p.ko && !p.dead).length + (bb.downedIds || []).length * 0;
    dead += mine(bb).filter((p) => p.dead).length;
    if (s.combat) { if (!s.combat.over) endBattleNow(s, "victory"); closeCombat(s); }
  }
  console.log(`    12 fights against police (6, power 5): ${nlUsed} tasers fired, ${ko} of yours knocked out at the end, ${dead} dead`);
  check(nlUsed > 0, "the police use their tasers in a real fight");
  // Your AI with Take them alive.
  const st3 = world(seed + 10);
  const b3 = baseBattle(st3, { count: 3, kind: "raiders", fighters: 3 });
  place(b3, mine(b3), 4); place(b3, theirs(b3), 8, 6);
  for (const p of mine(b3)) { giveTaser(st3, survivorById(st3, p.sid)); p.nlTaser = null; p.aim = 90; }
  combatAct(st3, { type: "takeAlive" });
  check(b3.takeAlive, "the Take them alive toggle");
  const before = mine(b3).reduce((a, p) => a + (p.nlTaser == null ? 2 : p.nlTaser), 0);
  for (const p of mine(b3)) if (p.nlTaser == null) p.nlTaser = 2;
  autoPlayerTurn(st3, { retreat: false });
  const after = mine(b3).reduce((a, p) => a + (p.nlTaser ?? 0), 0);
  check(after < before && mine(b3).some((p) => p.pull), `your AI with Take them alive tases (${before - after} cartridges) and pulls its blows`);
}

// 7. Surrender.
{
  console.log("Surrender");
  // A beaten guard, hurt and alone: gives up (over a few tries), drops the weapon.
  let gave = 0, zealot = 0, tries = 0;
  let one = null;
  for (let i = 0; i < 40; i++) {
    const st = world(seed + 300 + i);
    const b = baseBattle(st, { count: 4, kind: i % 2 ? "zealots" : "guards", fighters: 4 });
    place(b, mine(b), 4);
    const [g, ...rest] = theirs(b);
    for (const r of rest) { r.dead = true; }
    g.x = 9; g.y = 6; g.hp = Math.floor(g.maxHp * 0.3);
    mine(b)[0].x = 7; mine(b)[0].y = 6;
    surrenderCheck(b);
    if (i % 2) { if (g.surr) zealot++; } else { tries++; if (g.surr) { gave++; if (!one) one = { st, b, g }; } }
  }
  check(gave >= 6, `a beaten, hurt guard alone near your people gives up (${gave} of ${tries})`);
  check(zealot === 0, "zealots never do");
  if (one) {
    const { st, b, g } = one;
    check(g.down && !active(g) && g.weapon === "fists" && (b.nlDrops || []).length === 1 && b.nlDrops[0].key === g.nlWeapon, `${g.name} drops the ${g.nlWeapon}: down, not a target`);
    check(/Surrendered/.test(nlStatus(b, g)) && nlTags(g).some(([x]) => x === "HANDS"), `status "${nlStatus(b, g)}" and a HANDS tag`);
    const u = mine(b)[0];
    u.x = g.x - 1; u.y = g.y; u.ap = 2;
    const e = combatAct(st, { type: "tie", unit: u.id, target: g.id });
    check(!e && g.tied, `Tie (take prisoner): ${e || "tied"}`);
    check(battleCaptives(b, "victory").includes(g), "tied, they are a prisoner after a win");
    if (!b.over) endBattleNow(st, "victory");
    check(st.combat.result.prisoners.length === 1 && (st.combat.bodies || []).some((body) => /dropped/.test(body.name)), "the result: one prisoner, and the dropped weapon is there to loot");
    closeCombat(st);
    check(prisonersAt(st, hub(st).id).length === 1, "the prisoner goes into the cells");
  } else check(false, "someone surrendered");
  // Untied and left alone: walks off. Their side rallies: takes the weapon up again.
  {
    const st = world(seed + 400);
    const b = baseBattle(st, { count: 4, kind: "guards", fighters: 4 });
    place(b, mine(b), 2, 2);
    const [g, ...rest] = theirs(b);
    for (const r of rest) r.dead = true;
    g.x = 12; g.y = 10;
    surrender(b, g);
    let walked = 0;
    for (let i = 0; i < 5 && !g.fled; i++) { nlEnemyPhase(b); walked++; } // the start of each enemy turn

    check(g.fled && walked === SURRENDER.walk, `untied and left alone, they walk off after ${walked} turns`);
  }
  // Execute: mood cost.
  {
    const st = world(seed + 401);
    const b = baseBattle(st, { count: 2, kind: "guards", fighters: 2 });
    place(b, mine(b), 4);
    const [g] = theirs(b);
    g.x = 5; g.y = 7;
    surrender(b, g);
    const u = mine(b)[0];
    const moods = mine(b).map((p) => survivorById(st, p.sid).mood);
    const e = combatAct(st, { type: "execute", unit: u.id, target: g.id });
    const after = mine(b).map((p) => survivorById(st, p.sid).mood);
    check(!e && g.dead && after.every((m, i) => m < moods[i]), `Execute kills the one who gave up, and everyone of yours there feels it (mood ${moods.map(Math.round).join("/")} → ${after.map(Math.round).join("/")})`);
  }
  // Your own surrender.
  {
    const st = world(seed + 402);
    const f = st.factions.find((x) => x.alive && x.type === "military") || st.factions.find((x) => x.alive);
    const b = baseBattle(st, { count: 3, kind: "soldiers", fighters: 2, factionId: f.id });
    const [u] = mine(b);
    const e = combatAct(st, { type: "surrender", unit: u.id });
    check(!e && u.surr && !active(u), "one of yours surrenders: out of the fight");
    endBattleNow(st, "defeat");
    check(survivorById(st, u.sid).location.kind === "captive", "the soldiers hold the field: taken captive");
    closeCombat(st);
    const stz = world(seed + 403);
    const bz = baseBattle(stz, { count: 3, kind: "zealots", fighters: 2 });
    check(/no prisoners/.test(surrenderRefusal(bz, mine(bz)[0])), `zealots: "${surrenderRefusal(bz, mine(bz)[0])}"`);
    const st0 = world(seed + 404);
    const b0 = baseBattle(st0, { count: 3, kind: "zombies", fighters: 2 });
    check(/dead do not/.test(surrenderRefusal(b0, mine(b0)[0])), "the dead take no prisoners");
  }
  // Surrender in real fights against guards: some give up and get tied by your AI with Take them alive.
  {
    let surr = 0, prisoners = 0, fights = 0;
    for (let i = 0; i < 12; i++) {
      const st = world(seed + 500 + i);
      const b = baseBattle(st, { count: 5, kind: "guards", power: 2, fighters: 4 });
      for (const p of mine(b)) { p.aim += 25; p.hp = 100; }
      b.takeAlive = true;
      for (let k = 0; k < 40 && st.combat && !st.combat.over; k++) { autoPlayerTurn(st, { retreat: false }); if (st.combat && !st.combat.over) runEnemyPhase(st); }
      surr += theirs(b).filter((e) => e.surrTurn != null).length;
      if (st.combat) { if (!st.combat.over) endBattleNow(st, "victory"); prisoners += st.combat.result.prisoners.length; fights++; closeCombat(st); }
    }
    console.log(`    12 fights against weak guards, Take them alive: ${surr} surrendered, ${prisoners} prisoners`);
    check(surr > 0 && prisoners > 0, "in real fights some give up and are taken");
  }
}

// 8. Loot through itemcond.
{
  console.log("Loot");
  const st = world(seed + 11);
  const police = Object.keys(st.tiles).map(Number).find((i) => st.tiles[i].loc && st.tiles[i].loc.type === "police");
  const found = {};
  let rolled = true;
  if (police != null) {
    for (let h = 0; h < 4000; h++) { st.hour = h; const it = rollFind(st, police, 1, `t${h}`); if (it && GEAR[it.key].nonlethal !== undefined || (it && ["taser", "tasercart", "pepper", "stunbaton"].includes(it.key))) { found[it.key] = (found[it.key] || 0) + 1; rolled = rolled && condRolled(it); } }
  }
  check(police == null || (found.taser && found.pepper && found.tasercart && rolled), `a police station's searches turn up tasers, cartridges and spray, condition rolled (${JSON.stringify(found)})`);
  const rng = new Rng(seed);
  const areaFound = {};
  for (let i = 0; i < 6000; i++) { const it = rollAreaFind(rng, "armory", 1, 0, "police"); if (it && ["taser", "tasercart", "pepper", "stunbaton"].includes(it.key)) { areaFound[it.key] = (areaFound[it.key] || 0) + 1; rolled = rolled && condRolled(it); } }
  check(areaFound.taser && areaFound.stunbaton && rolled, `a raid's armoury lockers too (${JSON.stringify(areaFound)})`);
  check(SITE_FINDS.prison.items.taser && SITE_FINDS.gunstore.items.pepper && AREA_FINDS.gunshop.items.taser && AREA_FINDS.cellblock.items.stunbaton, "prisons, gun stores, gun shops and cell blocks hold them");
  let onBodies = 0, bodyRolled = true;
  for (let i = 0; i < 600; i++) {
    const body = enemyBody(rng, { kind: "human", name: "G", id: i, kit: "guards", weapon: "stunbaton" }, KITS.guards);
    const all = [...Object.values(body.gear), ...(body.pockets || [])].filter(Boolean);
    for (const it of all) if (["taser", "tasercart", "pepper", "stunbaton"].includes(it.key)) { onBodies++; bodyRolled = bodyRolled && condRolled(it); }
  }
  check(onBodies > 0 && bodyRolled, `guards' bodies carry them (${onBodies} in 600 bodies), condition rolled`);
}

// 9. By the numbers.
{
  console.log("By the numbers");
  const st = world(seed + 12);
  const types = ["traders", "commune", "military", "raider", "expansionist", "zealot"];
  const row = {};
  for (const ty of types) {
    let taken = 0, lost = 0;
    for (let i = 0; i < 300; i++) {
      st.hour = i;
      const a = { id: 900 + i, type: ty }, t = { id: 1900 + i };
      const loss = 3 + (i % 4);
      taken += raidPrisoners(st, a, t, loss);
      lost += loss;
    }
    row[ty] = taken / lost;
  }
  console.log(`    AI raids, share of the beaten taken alive: ${types.map((t) => `${t} ${pct(row[t])}`).join(", ")}`);
  check(row.traders > row.raider && row.commune > row.raider && row.raider > row.zealot && row.zealot === 0, "groups that take people alive take more prisoners and kill fewer; zealots none");
  check(Math.abs(row.traders - NL_TAKE.traders) < 0.08, `the shift is small and as set (traders ${pct(row.traders)} of ${pct(NL_TAKE.traders)})`);
  // Held prisoners: recruited, ransomed back or escaping over the days.
  const st2 = world(seed + 13);
  const [A, B] = st2.factions.filter((f) => f.alive);
  A.held = { [B.id]: 10 };
  B.stock.food = 1000;
  const popA = A.pop, popB = B.pop;
  for (let d = 0; d < 60; d++) { st2.hour += 24; aiCaptivesDaily(st2); }
  const left = A.held ? A.held[B.id] || 0 : 0;
  check(left < 10 && A.pop + B.pop - popA - popB === 10 - left, `in 60 days ${10 - left} of 10 held went home or joined their captors (${A.pop - popA} joined, ${B.pop - popB} back)`);
  // A decisive win of yours by the numbers: a couple taken.
  const n = numbersSurrenders(st2, { enemy: { kind: "guards", count: 6, factionId: B.id } }, { outcome: "victory", survivorsDead: [] });
  const nz = numbersSurrenders(st2, { enemy: { kind: "zealots", count: 6 } }, { outcome: "victory", survivorsDead: [] });
  const nl = numbersSurrenders(st2, { enemy: { kind: "guards", count: 6 } }, { outcome: "defeat", survivorsDead: [] });
  check(n >= 1 && n <= SURRENDER.NUMBERS_MAX && nz === 0 && nl === 0, `a decisive win over 6 guards: ${n} give up; zealots ${nz}; a loss ${nl}`);
  const st3 = world(seed + 14);
  const h = hub(st3);
  const f3 = st3.factions.find((x) => x.alive);
  let got = 0;
  for (let i = 0; i < 10; i++) { st3.hour += 1; got += capturePrisoners(st3, { baseId: h.id, tile: h.tile, enemy: { kind: "guards", count: 6, power: 3, factionId: f3.id, name: f3.name } }, { outcome: "victory", tactical: false, survivorsDead: [] }, null).length; }
  check(got >= 5, `played by hand, decisive wins by the numbers bring prisoners home (${got} in 10 wins)`);
}

// 10. A battle saved mid-fight.
{
  console.log("Save mid-battle");
  const st = world(seed + 15);
  const b = baseBattle(st, { count: 3, kind: "guards", fighters: 3 });
  place(b, mine(b), 4); place(b, theirs(b), 8, 6);
  const [u] = mine(b), [g, g2] = theirs(b);
  giveTaser(st, survivorById(st, u.sid)); u.nlTaser = null; u.aim = 300;
  combatAct(st, { type: "taser", unit: u.id, target: g.id });
  if (!(g.nl && g.nl.stun)) g.nl = { stun: NL.TASER.stun, dazeAfter: true }; // a miss (95% cap): the stun by hand, the save is the point
  surrender(b, g2);
  b.takeAlive = true;
  const text = saveToString(st);
  const B = loadFromString(text);
  const bb = B.combat;
  const gg = bb.units.find((x) => x.id === g.id), g2b = bb.units.find((x) => x.id === g2.id), ub = bb.units.find((x) => x.id === u.id);
  check(gg.nl && gg.nl.stun === NL.TASER.stun && g2b.surr && bb.nlDrops.length === 1 && ub.nlTaser === 1 && bb.takeAlive, "a saved battle keeps the stun, the surrender and its dropped weapon, the taser's cartridges and Take them alive");
  const go = (w) => { for (let k = 0; k < 30 && w.combat && !w.combat.over; k++) { autoPlayerTurn(w, { retreat: false }); if (w.combat && !w.combat.over) runEnemyPhase(w); } return w.combat ? JSON.stringify([w.combat.result && w.combat.result.outcome, w.combat.log.length, w.combat.units.map((x) => [x.hp, !!x.surr, !!x.ko, !!x.dead])]) : "none"; };
  const C = loadFromString(text);
  check(go(B) === go(C), "two loads of it play out the same");
  // The UI's buttons.
  const html = nlButtons(B, B.combat, B.combat.units.find((x) => x.id === u.id), (v, label) => `<button data-v="${v}">${label}</button>`, { mode: "move" });
  check(/Taser/.test(html) && /Pull blows/.test(html) && /Take them alive/.test(html), "the panel's buttons: Taser, Pull blows, Take them alive");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
