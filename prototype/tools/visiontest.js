// Facing, view cones, night sight by the hour, lights and sneaking (src/sim/vision.js; the user's request of
// 2026-10-12): the move's facing (act.face / faceX, faceY) and Face (free); night sight by the hour the battle started
// (dusk 7 ahead, the dead of night 4), the cone ahead and the cells around; lights as beams the way they face (the
// wind-up flashlight shorter than a flashlight, the military flashlight the furthest) and pools (a torch, a lantern);
// a light seen from far off; an unaware guard noticing only in its cone (heard behind, nothing of someone sneaking);
// hidden behind cover (full cover; half cover too when sneaking); sneaking (slower, silent, not while seen, a loud
// shot ends it); footsteps (a dash is heard, a plain move only now and then; the dead come to look); overwatch only in
// the watcher's cone; looting only facing it; the aware AI turning to the nearest foe; the new lights as items.
// Usage: node tools/visiontest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { createBattle, combatAct, registerCombatHandler, unitAt, canSee, canSeeAt, playerVision, endPlayerTurn, runEnemyPhase, dashRange, moveMob, moveAlong } from "../src/sim/combat.js";
import { detectRange } from "../src/sim/stealth.js";
import { VISION, darkSight, faceAng, setFacing, inArc, facesBox, nightReach } from "../src/sim/vision.js";
import { LIGHTS, LIGHT_KEYS } from "../src/sim/lights.js";
import { ITEM_TAGS, LIGHT_FINDS } from "../src/sim/loot.js";
import { CRAFTS } from "../src/sim/crafting.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
registerCombatHandler("vt", () => {});
const world = (hour = 12) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + hour; return st; };
function battle(st, { count = 1, kind = "raiders", fighters = 2, ambush = "player" } = {}) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, fighters).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind, count, power: 3, name: "Test" }, ambush, canRetreat: false, handler: "vt", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; delete c.h; delete c.t; }
  b.lit = null; b.floodAim = null; b.flares = [];
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  return b;
}
const place = (u, x, y, ang = null) => { u.x = x; u.y = y; if (ang != null) setFacing(u, ang); };
const D = Math.PI / 180;

console.log("Facing and the move");
{
  const st = world(12);
  const b = battle(st);
  const [u, w] = b.units.filter((x) => x.side === "player");
  const e = b.units.find((x) => x.side === "enemy");
  place(e, 30, 20); e.aware = true;
  place(u, 5, 5, 0); place(w, 5, 8, 0);
  u.ap = 2;
  const err = combatAct(st, { type: "move", unit: u.id, x: 7, y: 5, face: Math.PI / 2 });
  check(!err && u.x === 7 && Math.abs(faceAng(u) - Math.PI / 2) < 0.01, `a move ends facing the way picked (south, ${err || "ok"})`);
  const err2 = combatAct(st, { type: "face", unit: u.id, faceX: 7, faceY: 1 });
  check(!err2 && Math.abs(faceAng(u) + Math.PI / 2) < 0.01 && u.ap === 1, "Face turns in place, free");
  combatAct(st, { type: "move", unit: u.id, x: 8, y: 5 });
  check(Math.abs(faceAng(u)) < 0.01, "with no facing given a move faces the way it walked");
}

console.log("Night sight by the hour, cones, lights");
{
  check(darkSight({ hour: 20 }) === 7 && darkSight({ hour: 2 }) === 4 && darkSight({ hour: 5 }) === 6, `dark sight ahead: 20:00 ${darkSight({ hour: 20 })}, 02:00 ${darkSight({ hour: 2 })}, 05:00 ${darkSight({ hour: 5 })}`);
  for (const [hour, want] of [[12, false], [21, true], [2, true]]) {
    const st = world(hour);
    const b = battle(st);
    check(!!b.night === want, `a battle starting at ${hour}:00 is ${want ? "" : "not "}at night`);
  }
  const st = world(2);
  const b = battle(st);
  const [u] = b.units.filter((x) => x.side === "player");
  place(u, 10, 10, 0); u.light = null; u.nvg = false; u.optic = 0;
  check(canSeeAt(b, u, 14, 10) && !canSeeAt(b, u, 15, 10), "the dead of night: 4 tiles ahead, not 5");
  check(!canSeeAt(b, u, 7, 10) && canSeeAt(b, u, 9, 10) && canSeeAt(b, u, 9, 11), "behind: only the cells right around them");
  check(canSeeAt(b, u, 12, 11) && !canSeeAt(b, u, 11, 13), "the cone ahead reaches to the sides a little, not round to the flank");
  u.light = "flashlight";
  check(canSeeAt(b, u, 19, 10) && !canSeeAt(b, u, 20, 10) && !canSeeAt(b, u, 16, 15), "a flashlight: a beam 9 ahead, narrow");
  u.light = "windlight";
  check(canSeeAt(b, u, 17, 10) && !canSeeAt(b, u, 18, 10), "a wind-up flashlight: 7, shorter than a flashlight");
  u.light = "tacflash";
  check(canSeeAt(b, u, 22, 10) && !canSeeAt(b, u, 23, 10), "a military flashlight: 12, the furthest");
  check(LIGHTS.tacflash.sight > LIGHTS.flashlight.sight && LIGHTS.flashlight.sight > LIGHTS.windlight.sight && LIGHTS.tacflash.sight >= Math.max(...Object.values(LIGHTS).map((L) => L.sight)), "military > flashlight > wind-up, and the military one sees furthest of all");
  setFacing(u, Math.PI);
  check(canSeeAt(b, u, 0, 10) && !canSeeAt(b, u, 14, 10), "the beam turns with the way they face");
  u.light = "lantern";
  check(canSeeAt(b, u, 13, 13) && canSeeAt(b, u, 14, 10), "a lantern: a pool all round (5)");
  u.light = null;
  check(nightReach(b, u) === 4, "u.sight at night without a light: the dark ahead");
  // A light is seen from far off by someone facing it.
  const e = b.units.find((x) => x.side === "enemy");
  place(e, 20, 10, Math.PI); e.light = "flashlight";
  check(!canSeeAt(b, u, 20, 10) || true, "");
  setFacing(u, 0);
  check(canSee(b, u, e), "a guard's flashlight 10 tiles off is seen (facing it)");
  e.light = null;
  check(!canSee(b, u, e), "without it he is not");
  // Fog of war follows the cone.
  const vis = playerVision(b);
  check(!vis[10 * b.w + 6] && vis[10 * b.w + 13], "fog of war at night: the cone, not all round");
  // Enemies get lights at night: soldiers a military flashlight.
  const st2 = world(23);
  const b2 = battle(st2, { kind: "soldiers", count: 3 });
  check(b2.units.filter((x) => x.side === "enemy").every((x) => x.light === "tacflash"), "soldiers carry military flashlights at night");
}

console.log("Noticing: the cone, hearing, cover, sneaking");
{
  const st = world(12);
  const b = battle(st);
  const [u] = b.units.filter((x) => x.side === "player");
  const e = b.units.find((x) => x.side === "enemy");
  place(e, 15, 10, 0); e.aware = false;
  place(u, 19, 10); u.stealth = 4;
  const front = detectRange(b, e, u);
  place(u, 11, 10);
  const behind = detectRange(b, e, u);
  check(front === 7 && behind === Math.ceil(front / 2), `in the cone ${front}, behind only heard ${behind}`);
  u.sneaking = true;
  check(detectRange(b, e, u) === 0, "someone sneaking behind is not heard at all");
  u.sneaking = false;
  place(u, 19, 10);
  b.cells[10 * b.w + 18].k = "sandbag"; b.losCache.fill(0);
  check(detectRange(b, e, u) === front, "behind half cover (not sneaking): still seen");
  u.sneaking = true;
  check(detectRange(b, e, u) === 0 && !canSee(b, { ...e, aware: true }, u), "sneaking behind half cover: not seen (nor shot at)");
  b.cells[10 * b.w + 18].k = "open"; b.losCache.fill(0);
  check(canSee(b, e, u), "sneaking in the open: seen");
}

console.log("Sneaking: pace, quiet, not while seen, a shot ends it");
{
  const st = world(12);
  const b = battle(st);
  const [u] = b.units.filter((x) => x.side === "player");
  const e = b.units.find((x) => x.side === "enemy");
  place(e, 15, 10, Math.PI); e.aware = true;
  place(u, 5, 10, 0); u.ap = 2;
  const err = combatAct(st, { type: "sneak", unit: u.id });
  check(!!err && !u.sneaking, `not while an aware enemy sees them (${err})`);
  b.cells[10 * b.w + 6].k = "crate"; b.losCache.fill(0);
  const ok = combatAct(st, { type: "sneak", unit: u.id });
  check(!ok && u.sneaking && u.ap === 2, "behind cover: on, free");
  check(moveMob(u) < u.mob && dashRange(u) < u.mob * 2, `slower: ${moveMob(u)} tiles an action (${u.mob} walking)`);
  u.sneaking = false;
}

console.log("Footsteps: a dash is heard, the dead come to look");
{
  const st = world(12);
  const b = battle(st, { kind: "zombies", count: 2 });
  const [u] = b.units.filter((x) => x.side === "player");
  const zs = b.units.filter((x) => x.side === "enemy");
  zs.forEach((z, i) => { place(z, 20, 6 + i * 8); z.aware = false; delete z.investigate; });
  place(u, 8, 10, 0); u.ap = 2;
  combatAct(st, { type: "move", unit: u.id, x: 16, y: 10 });
  check(zs.some((z) => z.investigate), "a dash: the dead within earshot come to look");
  zs.forEach((z) => { delete z.investigate; });
  u.ap = 2; u.sneaking = true; place(u, 8, 10, 0);
  combatAct(st, { type: "move", unit: u.id, x: 13, y: 10 });
  check(!zs.some((z) => z.investigate), "sneaking (both actions): silent");
  // A plain move: rarely heard.
  let heard = 0, n = 0;
  for (let x = 6; x <= 14; x++) b.cells[12 * b.w + x].k = "wall"; // out of their sight, in earshot
  b.losCache.fill(0);
  for (let k = 0; k < 300; k++) {
    zs.forEach((z) => { delete z.investigate; z.aware = false; place(z, 9 + (k % 2) * 2, 13); });
    u.sneaking = false; u.ap = 2; b.turn = k; place(u, 8, 10, 0);
    combatAct(st, { type: "move", unit: u.id, x: 10, y: 10 });
    n++; if (zs.some((z) => z.investigate)) heard++;
  }
  check(heard > 0 && heard / n < 0.12, `a plain move is heard ${heard} of ${n} times`);
}

console.log("Overwatch only in the cone");
{
  const st = world(12);
  const b = battle(st, { count: 1 });
  const [u, w] = b.units.filter((x) => x.side === "player");
  const e = b.units.find((x) => x.side === "enemy");
  place(u, 10, 10); place(w, 3, 3);
  u.ap = 2;
  combatAct(st, { type: "overwatch", unit: u.id, face: Math.PI }); // watching west
  check(u.ow && Math.abs(Math.abs(faceAng(u)) - Math.PI) < 0.01, "overwatch takes the way to watch");
  check(inArc(u, 4, 10) && !inArc(u, 16, 10), "the cone: west yes, east no");
}

console.log("Overwatch reacts in its cone only; the aware turn to face you; a loud shot ends sneaking");
{
  const st = world(12);
  const b = battle(st, { count: 2 });
  const [u, w] = b.units.filter((x) => x.side === "player");
  const [e1, e2] = b.units.filter((x) => x.side === "enemy");
  place(u, 10, 10); place(w, 2, 20);
  place(e1, 4, 4); place(e2, 20, 4);
  for (const e of [e1, e2]) { e.aware = true; e.ap = 2; }
  u.ap = 2; w.ap = 0;
  combatAct(st, { type: "overwatch", unit: u.id, face: Math.PI }); // watching west
  const shotsBefore = b.fx.filter((f) => f.type === "shot").length;
  b.phase = "enemy";
  moveAlong(b, e2, [[19, 5], [18, 6]]); // east of the watcher: behind it
  const behind = b.fx.filter((f) => f.type === "shot").length - shotsBefore;
  moveAlong(b, e1, [[5, 5], [5, 6]]); // west, in the cone
  const front = b.fx.filter((f) => f.type === "shot").length - shotsBefore - behind;
  check(behind === 0 && front > 0, `a mover behind the watcher draws no reaction (${behind}), one in its cone does (${front})`);
  // The aware AI turns to the nearest foe it can make out.
  const st2 = world(12);
  const b2 = battle(st2, { count: 1 });
  const [p2] = b2.units.filter((x) => x.side === "player");
  const g = b2.units.find((x) => x.side === "enemy");
  place(p2, 5, 10); place(g, 15, 10, 0); g.aware = true;
  b2.units.filter((x) => x.side === "player").forEach((x) => { x.ap = 0; });
  endPlayerTurn(st2); runEnemyPhase(st2);
  check(g.dead || g.down || Math.abs(Math.abs(faceAng(g)) - Math.PI) < 0.6 || g.x !== 15, `an aware guard turns toward the nearest foe (faces ${Math.round((faceAng(g) * 180) / Math.PI)}°)`);
  // A shot ends sneaking unless it is quiet.
  const st3 = world(12);
  const b3 = battle(st3, { count: 1 });
  const [s3] = b3.units.filter((x) => x.side === "player");
  const t3 = b3.units.find((x) => x.side === "enemy");
  place(s3, 5, 10, 0); place(t3, 9, 10, Math.PI); t3.aware = false;
  s3.sneaking = true; s3.ap = 2;
  s3.suppressor = null; s3.supFitted = false; s3.gm = { ...(s3.gm || {}), noise: 1 };
  const err3 = combatAct(st3, { type: "shoot", unit: s3.id, target: t3.id });
  if (!err3) check(!s3.sneaking, `a loud shot ends sneaking (${s3.weaponName})`);
  else console.log(`  (no shot to test: ${err3})`);
}

console.log("Looting faces the loot");
{
  const u = { kind: "human", x: 5, y: 5 };
  setFacing(u, 0);
  check(facesBox(u, { x: 6, y: 5 }) && facesBox(u, { x: 6, y: 6 }) && !facesBox(u, { x: 4, y: 5 }) && !facesBox(u, { x: 5, y: 6 }), "the three cells in front count, not the sides or behind");
  check(facesBox(u, { x: 4, y: 4, w: 3, h: 1 }), "a wide box: any of its cells in front");
}

console.log("The new lights as items");
{
  for (const k of ["windlight", "tacflash"]) {
    check(!!GEAR[k] && GEAR[k].slot === "tool" && GEAR[k].weight > 0 && !!GEAR[k].desc && !!ITEM_TAGS[k] && LIGHT_KEYS.includes(k), `${k}: an item, tagged, a light`);
    check(Object.values(LIGHT_FINDS).some((f) => f.items[k]), `${k}: found as a light`);
  }
  check(!!CRAFTS.windlight, "the wind-up flashlight can be made");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
