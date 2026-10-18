// Medics, the downed and dragging them in battle (src/sim/medics.js; combat.js hooks; breakoff.js by the numbers;
// ui/combat.js buttons). Checks:
//   - a med kit (off hand, pocket, pack) makes a medic: the badge on the roster, Medicine with the kit
//   - Heal: more than plain meds (25 + 2 a point of Medicine + 4 a point of the kit), 1 action, 1 meds, a kit use
//   - Revive: the odds (40 + 3 Medicine + 5 kit, +15 stabilized, at most 85), up at 25-40%, no actions until the
//     next turn, shaken (−10 aim); a failed one stabilizes; no revive without a kit and meds (the button disabled,
//     with the reason)
//   - stabilizing needs no items: sure with meds, by hand without (50 + 4 Medicine, at most 90), tried again
//   - Drag ally: half speed, no shooting, the ally follows behind; put down, or laid in the vehicle (stabilized on
//     the way in with an action left, else a warning on the button)
//   - drag first, then revive: the AI drags to a quiet cell and names a medic, who revives there (both sides)
//   - the AI (your side): a medic revives a downed teammate where it is safe enough, drags them to cover where not
//   - the enemy: their people go down; a rescuer drags a downed ally to more cover and farther from your people; their
//     medic revives there; one without a kit only stabilizes; no rescuer runs into open ground under fire from afar
//   - finishing: a downed enemy dies for good by Finish (a shot or a blow), never by a plain click (shoot, the
//     target list); the body is there to loot
//   - raiders finish an exposed downed survivor (soldiers do not; out of sight is safe); now and then drag one off:
//     a captive of their group after the battle; freed when the dragger goes down
//   - by the numbers: a medic with a kit saves some of the fallen (fewer deaths)
//   - a save in the middle of a battle keeps all of it
// Usage: node tools/medictest.js
import { createWorld, hub, atBase, survivorById, skill } from "../src/sim/world.js";
import {
  createBattle, enemyUnit, damage, registerCombatHandler, combatAct, active, loadMag, medsLeft, ammoLeft, canFire, enemyStep,
  endBattleNow, autoPlayerTurn, shotPriority, runEnemyPhase, placeCar, placeRaidHumvee, manEnemyTurret, CELL,
} from "../src/sim/combat.js";
import * as MED from "../src/sim/medics.js";
import { newItem } from "../src/sim/inventory.js";
import { fightModel, rollFight, fightForecast } from "../src/sim/breakoff.js";
import { Rng } from "../src/sim/rng.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("medictest", () => {});
const t0 = Date.now();

// The battle screen on stub canvases (as tools/battleuitest.js).
const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
  get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; },
});
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });

// Dice that always (or never) come up: the battle's chance() for one call.
const forced = (b, v, fn) => { const c = b.rng.chance; b.rng.chance = () => v; try { return fn(); } finally { b.rng.chance = c; } };
const arm = (u, w = "pistol") => { u.weapon = w; u.weaponName = w; u.cd = 0; loadMag(u); };
const W = (b) => b.w;
const wall = (b, cells) => { for (const [x, y] of cells) b.cells[y * W(b) + x] = { k: "wall", f: "grass" }; b.losCache.fill(0); };

// A field battle on open grass: 3 of your people (Medicine set), no enemy until a check adds them. kits: per person
// "tool" (off hand), "pocket", or null.
function arena({ seed = 11, kits = ["tool", "pocket", null], kind = "raiders", meds = 5, faction = true } = {}) {
  const st = createWorld({ seed, factionCount: 4 });
  const h = hub(st);
  h.stock.ammo = 60;
  h.stock.meds = meds;
  const people = atBase(st, h.id).slice(0, 3);
  people.forEach((s, i) => {
    s.skills.medicine = 5;
    s.health = 100;
    s.gear.tool = null;
    s.pockets = (s.pockets || []).map(() => null);
    if (kits[i] === "tool") s.gear.tool = newItem("bandagekit");
    if (kits[i] === "pocket") { while (s.pockets.length < 4) s.pockets.push(null); s.pockets[0] = newItem("bandagekit"); }
  });
  const f = st.factions.find((x) => x.alive && x.bases && x.bases.length);
  const b = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind, count: 1, power: 3, factionId: faction ? f.id : undefined, name: faction ? f.name : undefined }, ambush: null, canRetreat: true, handler: "medictest", context: {} });
  st.combat = b;
  for (let i = 0; i < b.cells.length; i++) b.cells[i] = { k: "open", f: "grass" };
  b.losCache.fill(0);
  b.evacCols = 0;
  b.infection = 0;
  b.corpses = [];
  b.units = b.units.filter((u) => u.side === "player");
  const ps = people.map((s) => b.units.find((u) => u.sid === s.id)); // in the order of the kits
  ps.forEach((u, i) => { u.x = 2; u.y = 2 + i * 2; arm(u); u.ap = 2; });
  // One of the dead asleep in the far corner: the battle goes on while the checks place the rest.
  const z = enemyUnit(b, b.rng, "zombies", 2, 1);
  z.x = b.w - 1; z.y = b.h - 1; z.aware = false; z.ap = 0;
  b.units.push(z);
  b.phase = "player";
  return { st, b, ps, people, f, h };
}
const foe = (b, kind = "raiders", x = 20, y = 12) => { const e = enemyUnit(b, b.rng, kind, 3, b.units.length + 1); delete e.medKit; e.isMedicKit = false; e.kitBonus = 0; e.medicine = 0; e.x = x; e.y = y; e.aware = true; arm(e); b.units.push(e); return e; };
const downPlayer = (b, u) => { damage(b, u, 999, null); u.bleed = 3; return u; };
const downFoe = (b, e, by = null) => { damage(b, e, (e.hp + 2) / e.armor, by); return e; }; // to 0 (through their armor), not an overkill
const enemyTurn = (st, b, u) => { b.phase = "enemy"; u.ap = 2; b.queue = [u.id]; enemyStep(st); };

section("A med kit makes a medic (off hand, pocket or pack); the badge");
{
  const { st, b, ps, people } = arena();
  const [a, c, n] = ps;
  check(MED.isMedic(a) && !a.kitPack && a.kitBonus === 2, `${a.name}: a bandage kit in the off hand: a medic (+${a.kitBonus} Medicine, Medicine ${a.medicine})`);
  const sk = skill(people[1], "medicine");
  check(MED.isMedic(c) && c.kitPack && c.medicine === sk + c.kitBonus, `${c.name}: one in a pocket counts too (Medicine ${c.medicine} = ${sk} + ${c.kitBonus})`);
  check(!MED.isMedic(n), `${n.name}: no kit, no medic`);
  UI.renderCombatScreen(st); UI.cui.sel = a.id; // a new battle resets the selection (sync)
  const html = UI.renderCombatScreen(st);
  check((html.match(/class="good cbmedic"/g) || []).length === 2, "the roster shows the medic badge (✚) on the two with a kit");
  check(/data-v="heal"/.test(html) && /Shift\+H/.test(html), "a medic has the Heal button (Shift+H)");
  check(people[0].gear.tool && people[0].gear.tool.key === "bandagekit", "the kit stays on them");
}

section("Heal: a medic's treatment beats plain meds");
{
  const { st, b, ps } = arena();
  const [a, , n] = ps;
  n.x = 3; n.y = 2; n.hp = 30; a.hp = 100;
  const meds0 = medsLeft(b), amt = MED.healAmount(a, n);
  const want = Math.round(25 + 2 * (a.medicine - a.kitBonus) + 4 * a.kitBonus);
  const err = combatAct(st, { type: "heal", unit: a.id, target: n.id });
  check(!err && n.hp === Math.min(100, 30 + amt) && amt === want, `+${amt} health (25 + 2×${a.medicine - a.kitBonus} + 4×${a.kitBonus}); ${err || "no error"}`);
  check(amt > Math.round(15 + a.medicine * 1.5), `more than plain meds would give (${Math.round(15 + a.medicine * 1.5)})`);
  check(medsLeft(b) === meds0 - 1 && a.kitUses === 1 && a.ap === 1, `1 meds (${meds0} → ${medsLeft(b)}), a kit use (${a.kitUses}), 1 action (${a.ap} left)`);
  check(/med kit/.test(MED.healRefusal(b, n, a)), `no kit: “${MED.healRefusal(b, n, a)}”`);
}

section("Revive: the odds, up at 25-40%, acting next turn, shaken");
{
  const { st, b, ps } = arena();
  const [a, , n] = ps;
  n.x = 3; n.y = 2;
  downPlayer(b, n);
  const skill = a.medicine - a.kitBonus;
  const p = MED.reviveOdds(a, n);
  const RV = MED.MEDIC.REVIVE;
  check(p === Math.min(RV.MAX, Math.round(RV.BASE + RV.MED * skill + RV.KIT * a.kitBonus)), `${p}% = ${RV.BASE} + ${RV.MED}×${skill} + ${RV.KIT}×${a.kitBonus} (at most ${RV.MAX})`);
  n.stab = true;
  check(MED.reviveOdds(a, n) === Math.min(RV.MAX, p + RV.STAB), `stabilized: +${RV.STAB} (${MED.reviveOdds(a, n)}%)`);
  { const m = { medicine: 6 + 3, kitBonus: 3 }; const fresh = MED.reviveOdds(m, null), stab = MED.reviveOdds(m, { stab: true });
    check(RV.MED === 3 && fresh === 73 && fresh < RV.MAX && stab === RV.MAX, `Medicine 6 with a trauma kit: ${fresh}% (under the ${RV.MAX}% cap), ${stab}% stabilized`); }
  n.stab = false;
  const aim0 = n.aim, meds0 = medsLeft(b);
  const err = forced(b, true, () => combatAct(st, { type: "revive", unit: a.id, target: n.id }));
  check(!err && !n.down && n.hp >= 25 && n.hp <= 40, `up again at ${n.hp} health (25-40); ${err || "no error"}`);
  check(n.shaken && n.aim === aim0 - 10 && n.ap === 0, `shaken: aim ${aim0} → ${n.aim}; no actions this turn (${n.ap})`);
  check(a.ap === 0 && medsLeft(b) === meds0 - 1 && a.kitUses === 1, "both actions, 1 meds and a kit use");
  check(b.log.some((l) => /back on their feet/.test(l.text)), `the log: “${(b.log.find((l) => /back on their feet/.test(l.text)) || {}).text}”`);
  // Their next turn: two actions, still shaken.
  b.units.forEach((u) => { if (u.side === "player") u.ap = 0; });
  combatAct(st, { type: "end" });
  for (let i = 0; i < 20 && b.phase === "enemy"; i++) enemyStep(st);
  check(b.phase === "player" && n.ap === 2 && n.aim === aim0 - 10, `the next turn: ${n.ap} actions, aim still ${n.aim}`);
}

section("A failed revive still stabilizes; no revive without a kit and meds");
{
  const { st, b, ps } = arena();
  const [a, c, n] = ps;
  n.x = 3; n.y = 2;
  downPlayer(b, n);
  const meds0 = medsLeft(b);
  const err = forced(b, false, () => combatAct(st, { type: "revive", unit: a.id, target: n.id }));
  check(!err && n.down && n.stab && medsLeft(b) === meds0 - 1 && a.kitUses === 1, `failed: still down but stabilized; the meds and a kit use spent (${err || "no error"})`);
  // Someone with no kit: Revive refused and shown disabled with the reason.
  const m = downPlayer(b, a); // the medic is down now
  c.x = 3; c.y = 3; // c has a kit in a pocket: give it to nobody
  c.medKit = null; c.kitBonus = 0;
  n.down = false; n.hp = 50; n.ap = 2; n.stab = false; n.x = 2; n.y = 3;
  const why = MED.reviveRefusal(b, n, m);
  check(/med kit/.test(why), `no kit: “${why}”`);
  UI.renderCombatScreen(st); UI.cui.sel = n.id;
  const html = UI.renderCombatScreen(st);
  const btn = (html.match(/<button[^>]*data-v="revive"[^>]*>/) || [""])[0];
  check(/disabled/.test(btn) && /Revive needs a med kit/.test(btn), "the Revive button is there, disabled, with the reason");
  // A kit but no meds.
  b.units.find((u) => u === c).medKit = newItem("bandagekit"); c.kitBonus = 2; c.kitLeft = 5; c.kitUses = 0;
  const h = hub(st); const keep = h.stock.meds; h.stock.meds = 0;
  check(/meds/.test(MED.reviveRefusal(b, c, m)) && medsLeft(b) === 0, `a kit but no meds: “${MED.reviveRefusal(b, c, m)}”`);
  h.stock.meds = keep;
}

section("Stabilizing needs no items: sure with meds, by hand without");
{
  const { st, b, ps, h } = arena({ kits: [null, null, null], meds: 0 });
  const [a, , n] = ps;
  n.x = 3; n.y = 2;
  downPlayer(b, n);
  check(medsLeft(b) === 0 && MED.handsOdds(a) === Math.min(90, 50 + 4 * a.medicine), `no meds: by hand at ${MED.handsOdds(a)}% (50 + 4×${a.medicine})`);
  const e1 = forced(b, false, () => combatAct(st, { type: "meds", unit: a.id, target: n.id }));
  check(!e1 && n.down && !n.stab && a.ap === 1 && b.log.some((l) => /tried again/.test(l.text)), `a failed try (1 action), it can be tried again (${e1 || "no error"})`);
  const e2 = forced(b, true, () => combatAct(st, { type: "meds", unit: a.id, target: n.id }));
  check(!e2 && n.stab && n.down, `the second try: stabilized (${e2 || "no error"})`);
  check(combatAct(st, { type: "meds", unit: ps[1].id, target: ps[1].id }) === "No meds left.", "healing health still needs meds");
  // With meds: sure (combat.js heal).
  h.stock.meds = 2;
  const m = downPlayer(b, ps[1]); a.ap = 2; m.x = 1; m.y = 2;
  const e3 = forced(b, false, () => combatAct(st, { type: "meds", unit: a.id, target: m.id }));
  check(!e3 && m.stab && medsLeft(b) === 1, "with meds in the pool: stabilized for sure, 1 meds");
}

section("Drag ally: half speed, no shooting, the ally comes along; put down, into the vehicle");
{
  const { st, b, ps } = arena();
  const [a, c, n] = ps;
  n.x = 3; n.y = 2; c.x = 4; c.y = 2;
  downPlayer(b, n);
  const mob = c.mob;
  const err = combatAct(st, { type: "dragAlly", unit: c.id, target: n.id });
  check(!err && c.dragging === n.id && n.draggedBy === c.id && c.mob === mob * 0.5 && !canFire(b, c), `${c.name} takes hold: move ${mob} → ${c.mob}, cannot shoot (${err || "no error"})`);
  check(c.ap === 2, "picking them up is free");
  const e2 = combatAct(st, { type: "move", unit: c.id, x: 6, y: 2 });
  check(!e2 && c.x === 6 && n.x === 5 && n.y === 2, `moved: ${c.name} at (${c.x},${c.y}), ${n.name} behind at (${n.x},${n.y}) (${e2 || "no error"})`);
  check(combatAct(st, { type: "move", unit: c.id, x: 12, y: 2 }) !== "", "half speed: 6 tiles is out of reach for both actions");
  const e3 = combatAct(st, { type: "dropAlly", unit: c.id });
  check(!e3 && c.dragging == null && n.draggedBy == null && c.mob === mob && canFire(b, c), "put down: full move and the gun back");
  // Into the vehicle.
  b.vehicle = { x: 7, y: 3, w: 2, h: 3, kind: "car", seats: 4 };
  combatAct(st, { type: "dragAlly", unit: c.id, target: n.id });
  const e4 = combatAct(st, { type: "dropAlly", unit: c.id, into: "vehicle" });
  check(!e4 && n.aboard && n.off && n.carried, `laid in the vehicle: aboard, counts as carried out (${e4 || "no error"})`);
  b.vehicle = null; n.aboard = false; n.off = false;
  void a;
}

// Cover for the AI checks: shooters to the west (x 4), the downed in the open at (12,12), a wall cell at (13,10)
// gives (14,10) full cover against them.
function field(kind = "raiders") {
  const A = arena({ kind });
  const { b, ps } = A;
  ps.forEach((u, i) => { u.x = 4; u.y = 10 + i * 2; });
  wall(A.b, [[13, 10]]);
  return A;
}

section("The AI (your side): a medic revives where it is safe, drags to cover where it is not");
{
  // Safe: the only enemy is behind a wall, out of sight.
  const { st, b, ps } = arena();
  const [a, c, n] = ps;
  a.x = 10; a.y = 10; n.x = 11; n.y = 10; c.x = 2; c.y = 20;
  const e = foe(b, "raiders", 25, 10);
  wall(b, [[20, 8], [20, 9], [20, 10], [20, 11], [20, 12]]);
  downPlayer(b, n);
  st.autoRetreat = false;
  forced(b, true, () => MED.rescueTurn(b, a));
  check(!n.down && n.shaken && a.ap === 0, `${a.name} revives ${n.name} with nobody in sight (${n.down ? "still down" : `up at ${n.hp}`})`);
  void e;
}
{
  // Exposed: three raiders see the downed one in the open.
  const A = arena();
  const { b, ps } = A;
  const [a, c, n] = ps;
  a.x = 13; a.y = 12; n.x = 12; n.y = 12; c.x = 2; c.y = 22;
  wall(b, [[13, 10]]);
  const es = [foe(b, "raiders", 4, 10), foe(b, "raiders", 4, 12), foe(b, "raiders", 4, 14)];
  downPlayer(b, n); n.stab = true;
  const foes = es;
  const before = MED.exposure(b, n.x, n.y, foes);
  MED.rescueTurn(b, a);
  const after = MED.exposure(b, n.x, n.y, foes);
  check(after.threat < before.threat && (n.x !== 12 || n.y !== 12), `${a.name} drags ${n.name} out of the line of fire: (12,12) → (${n.x},${n.y}), threat ${before.threat} → ${after.threat}`);
  check(n.down, "dragged, not revived under fire");
}

section("The enemy: their people go down; a rescuer drags a downed ally to cover; their medic revives; no kit: stabilize only");
{
  const { st, b, ps } = field("soldiers");
  const A = foe(b, "soldiers", 12, 12), B = foe(b, "soldiers", 13, 12);
  downFoe(b, A, ps[0]);
  check(A.down && A.wounded && !A.dead && !active(A), `${A.name} hit to 0: down and bleeding, not dead`);
  const before = MED.exposure(b, A.x, A.y, ps), near0 = Math.min(...ps.map((p) => Math.hypot(p.x - A.x, p.y - A.y)));
  enemyTurn(st, b, B);
  const after = MED.exposure(b, A.x, A.y, ps), near1 = Math.min(...ps.map((p) => Math.hypot(p.x - A.x, p.y - A.y)));
  check(after.threat < before.threat && near1 > near0, `${B.name} drags ${A.name} to (${A.x},${A.y}): more cover (threat ${before.threat} → ${after.threat}), farther from your people (${near0.toFixed(1)} → ${near1.toFixed(1)})`);
  check(!canFire(b, B) || B.dragging == null, "the rescuer does not shoot while dragging");
  // Their medic revives there.
  wall(b, [[A.x - 1, A.y + 1]]); // the medic kneels in cover too
  const M = MED.makeEnemyMedic(foe(b, "soldiers", A.x, A.y + 1), "traumakit", 5);
  if (B.dragging != null) MED.dropAlly(b, B, null, true);
  B.x = 30; B.y = 23;
  const safe = MED.exposure(b, A.x, A.y, ps);
  forced(b, true, () => enemyTurn(st, b, M));
  check(!A.down && A.shaken && A.hp > 0, `${M.name} (a medic, ${M.medKit.name}) revives ${A.name} there (threat ${safe.threat}): ${Math.round(A.hp)} health, shaken`);
}
{
  const { st, b, ps } = field("soldiers");
  const A = foe(b, "soldiers", 26, 12), B = foe(b, "soldiers", 27, 12);
  wall(b, [[22, 8], [22, 9], [22, 10], [22, 11], [22, 12], [22, 13], [22, 14], [22, 15]]); // out of sight of your people
  downFoe(b, A, ps[0]);
  forced(b, true, () => enemyTurn(st, b, B));
  check(A.down && A.stab, `${B.name} (no kit) only stabilizes ${A.name}: still down, stabilized`);
}
{
  // Open ground under heavy fire, the downed far off: nobody runs out to them; close by, someone does.
  const { b, ps } = field("soldiers");
  const A = foe(b, "soldiers", 12, 12), B = foe(b, "soldiers", 24, 12);
  downFoe(b, A, ps[0]);
  const went = MED.rescueStep(b, B);
  check(!went && Math.hypot(B.x - A.x, B.y - A.y) > 10, `${B.name}, 12 tiles off: does not run into the open under 3 guns (${went ? "went" : "stays"})`);
  B.x = 14; B.y = 12; B.ap = 2;
  const close = MED.rescueStep(b, B);
  check(close, `${B.name} right by them goes (one move): ${close}`);
}

section("Finishing a downed enemy: only by Finish, dead for good; a plain click never does it");
{
  const { st, b, ps } = arena();
  const [a, c] = ps;
  a.x = 8; a.y = 12; c.x = 2; c.y = 2;
  const E = foe(b, "raiders", 12, 12), F = foe(b, "raiders", 9, 13), G = foe(b, "raiders", 25, 20);
  downFoe(b, E, a); downFoe(b, F, a);
  const errShoot = combatAct(st, { type: "shoot", unit: a.id, target: E.id });
  check(/Finish/.test(errShoot) && !E.dead, `Shoot at a downed enemy: “${errShoot}”`);
  UI.renderCombatScreen(st); UI.cui.sel = a.id; UI.cui.mode = "move";
  UI.combatAction(st, "cb-target", { id: String(E.id) });
  check(!E.dead && /Finish/.test(UI.cui.msg), `a plain click on them (the target list): “${UI.cui.msg}”`);
  const html = UI.renderCombatScreen(st);
  check(/Finish \(downed\)/.test(html), "the hit-chance tooltip says Finish (downed)");
  const ammo0 = ammoLeft(b);
  const err = forced(b, true, () => combatAct(st, { type: "finish", unit: a.id, target: E.id }));
  check(!err && E.dead && ammoLeft(b) === ammo0 - 1, `Finish from range: dead, 1 round (${err || "no error"}; ${MED.finishOdds(a, E)}%)`);
  check(/Revive someone/.test(MED.reviveRefusal(b, MED.makeEnemyMedic(foe(b, "soldiers", 13, 12)), E)), "no revive for the finished");
  const e2 = combatAct(st, { type: "finish", unit: a.id, target: F.id });
  check(!e2 && F.dead, `Finish from next to them: a blow, dead (${e2 || "no error"})`);
  // The battle won: their bodies are there to loot.
  G.dead = true;
  b.units.filter((u) => u.side === "enemy" && !u.dead).forEach((u) => { u.dead = true; });
  endBattleNow(st, "victory");
  check(b.bodies.some((x) => x.name === E.name || x.name.startsWith(E.name)), `${E.name}'s body is there to loot`);
}

section("Raiders finish an exposed downed survivor; soldiers do not; out of sight is safe");
{
  const { st, b, ps } = arena();
  const [a, c, n] = ps;
  a.x = 2; a.y = 22; c.x = 3; c.y = 22; // far off, behind a wall
  wall(b, [[6, 18], [6, 19], [6, 20], [6, 21], [6, 22], [6, 23]]);
  n.x = 12; n.y = 12;
  downPlayer(b, n);
  const R = foe(b, "raiders", 17, 12);
  forced(b, true, () => enemyTurn(st, b, R));
  check(n.dead, `${R.name} finishes off ${n.name} lying in the open (${n.dead ? "dead" : "alive"})`);
}
{
  const { st, b, ps } = arena({ kind: "soldiers" });
  const [a, c, n] = ps;
  a.x = 2; a.y = 22; c.x = 3; c.y = 22;
  wall(b, [[6, 18], [6, 19], [6, 20], [6, 21], [6, 22], [6, 23]]);
  n.x = 12; n.y = 12;
  downPlayer(b, n);
  const S = foe(b, "soldiers", 17, 12);
  forced(b, true, () => enemyTurn(st, b, S));
  check(!n.dead, `${S.name} (soldiers) leaves ${n.name} be`);
}
{
  const { st, b, ps } = arena();
  const [a, c, n] = ps;
  a.x = 2; a.y = 22; c.x = 3; c.y = 22;
  wall(b, [[6, 18], [6, 19], [6, 20], [6, 21], [6, 22], [6, 23], [14, 9], [14, 10], [14, 11], [14, 12], [14, 13], [14, 14], [14, 15]]);
  n.x = 12; n.y = 12; // dragged behind the wall: out of the raider's sight
  downPlayer(b, n);
  const R = foe(b, "raiders", 17, 12);
  forced(b, true, () => MED.finishTurn(b, R));
  check(!n.dead, `out of ${R.name}'s line of sight, ${n.name} is safe`);
}

section("Raiders mostly finish, rarely drag one off: a captive of their group; freed if the dragger goes down");
{
  const { b, ps } = arena({ seed: 23 });
  const [a, c, n] = ps;
  a.x = 2; a.y = 22; c.x = 3; c.y = 22;
  wall(b, [[6, 18], [6, 19], [6, 20], [6, 21], [6, 22], [6, 23]]);
  const R = foe(b, "raiders", 13, 12);
  let finish = 0, grab = 0;
  for (let i = 0; i < 300; i++) {
    n.x = 12; n.y = 12; n.dead = false; n.down = true; n.draggedBy = null; n.off = false; delete n.taken;
    R.x = 13; R.y = 12; R.ap = 2; R.dragging = null; R.fled = false; R.captor = false; R.mob = 5; R.dragMob = null;
    MED.finishTurn(b, R);
    if (n.dead) finish++; else if (n.draggedBy === R.id || n.taken !== undefined) grab++;
  }
  check(grab > 0 && grab < finish && grab / (grab + finish) > 0.1 && grab / (grab + finish) < 0.45, `next to a downed survivor: finished ${finish} times, dragged off ${grab} of 300 (takes alive ${Math.round(MED.takeShare("raiders") * 100)}% of the times they act: nonlethal.js NL_TAKE)`);
  check(Math.abs((grab + finish) / 300 - MED.MEDIC.FINISH.WILL) < 0.08, `they act ${grab + finish} times in 300 (${Math.round(((grab + finish) / 300) * 100)}%: FINISH.WILL ${MED.MEDIC.FINISH.WILL}, half the old 0.5)`);
}
{
  const { st, b, ps, f } = arena();
  const [a, c, n] = ps;
  a.x = 2; a.y = 22; c.x = 3; c.y = 22;
  n.x = b.w - 3; n.y = 12;
  downPlayer(b, n);
  const R = foe(b, "raiders", b.w - 2, 12);
  forced(b, true, () => MED.finishTurn(b, R));
  check(n.taken === f.id && n.off && R.fled && b.log.some((l) => /drags .* away as a prisoner!/.test(l.text)), `${R.name} drags ${n.name} off the map (“${(b.log.find((l) => /as a prisoner!/.test(l.text)) || {}).text}”)`);
  endBattleNow(st, "victory");
  const s = survivorById(st, n.sid);
  check(s.alive && s.location.kind === "captive" && s.location.factionId === f.id && !b.result.survivorsDead.includes(s.id), `after the battle ${s.name} is a captive of ${f.name} (conflicts.js takeCaptive)`);
}
{
  const { b, ps } = arena();
  const [a, c, n] = ps;
  a.x = 8; a.y = 12; c.x = 3; c.y = 22;
  n.x = 12; n.y = 12;
  downPlayer(b, n);
  const R = foe(b, "raiders", 13, 12);
  MED.lift(b, R, n, true);
  check(n.draggedBy === R.id && R.captor, `${R.name} has hold of ${n.name}`);
  downFoe(b, R, a);
  check(R.down && n.draggedBy == null && n.down && !n.dead && n.taken === undefined, `${R.name} goes down: ${n.name} is dropped, still down, still yours`);
  // Hurt badly instead: lets go.
  const Q = foe(b, "raiders", 13, 13);
  MED.lift(b, Q, n, true);
  Q.hp = Q.maxHp * 0.3; Q.ap = 2;
  MED.rescueStep(b, Q);
  check(n.draggedBy == null && !n.taken, `${Q.name}, badly hurt, lets go`);
}

section("The meds reserve: the AI keeps meds back for a revive (MEDIC.RESERVE)");
{
  const { st, b, ps, h } = arena({ meds: 1 });
  const [a, c, n] = ps;
  const RS = MED.MEDIC.RESERVE;
  check(MED.medsReserve(b, "player") === Math.max(RS.MIN, Math.ceil(3 / RS.PER)), `3 people, medics among them: ${MED.medsReserve(b, "player")} meds kept back (1 for every ${RS.PER}, at least ${RS.MIN})`);
  check(MED.medsReserve(arena({ kits: [null, null, null] }).b, "player") === 0, "no medic on the side: nothing kept back (nobody could revive)");
  // A hurt medic: no Heal out of the reserve; with one more meds, healed.
  a.hp = 30; a.ap = 2;
  check(!MED.rescueStep(b, a) && medsLeft(b) === 1 && a.hp === 30, `${a.name} at 30 health, the last meds (the reserve): no Heal`);
  h.stock.meds = 2;
  check(MED.rescueStep(b, a) && medsLeft(b) === 1 && a.hp > 30, `2 meds: ${a.name} heals (${Math.round(a.hp)} health), 1 left for a revive`);
  // Plain meds on oneself (AI plays my side, combat.js aiMeds): none out of the reserve either.
  a.hp = a.maxHp; c.hp = c.maxHp; n.hp = 30; h.stock.meds = 1;
  wall(b, Array.from({ length: b.h }, (_, y) => [8, y]));
  foe(b, "raiders", 30, 12);
  st.autoRetreat = false;
  autoPlayerTurn(st, { retreat: false });
  check(medsLeft(b) === 1 && !b.log.some((l) => /patches up their own wounds/.test(l.text)), `${n.name} (no kit) at 30 health leaves the reserve meds be (${medsLeft(b)} left)`);
  b.phase = "player"; ps.forEach((u) => { u.ap = 2; }); h.stock.meds = 2;
  autoPlayerTurn(st, { retreat: false });
  check(medsLeft(b) === 1 && b.log.some((l) => /patches up their own wounds/.test(l.text)), `with 2 meds ${n.name} patches themselves up, 1 kept`);
}
{
  // The enemy's medic: their kit's uses are their meds. 7 of them: 3 kept back.
  const { b } = arena({ kind: "soldiers" });
  const es = [];
  for (let i = 0; i < 7; i++) es.push(foe(b, "soldiers", 24 + (i % 3), 4 + i * 2));
  const M = MED.makeEnemyMedic(es[0], "traumakit", 5);
  const low = Math.round(M.maxHp * 0.3);
  M.hp = low; M.kitUses = 1; M.ap = 2; // badly hurt, 3 uses left: the old rule (keep 1) would heal
  check(MED.medsReserve(b, "enemy") === 3 && MED.spareMeds(b, M) === 0, `7 of them: ${MED.medsReserve(b, "enemy")} kit uses kept back, ${MED.spareMeds(b, M)} to spare`);
  check(!MED.rescueStep(b, M) && M.hp === low && M.kitUses === 1, `${M.name} (3 uses left) does not heal their own wounds`);
  M.kitUses = 0; M.ap = 2;
  check(MED.rescueStep(b, M) && M.hp > low && M.kitUses === 1, `4 uses left: heals (${Math.round(M.hp)} health)`);
}

section("Raiders leave a downed survivor be while one of yours stands near (FINISH.GUARD)");
{
  const { b, ps } = arena();
  const [a, c, n] = ps;
  c.x = 2; c.y = 22;
  n.x = 12; n.y = 12;
  downPlayer(b, n);
  a.x = 9; a.y = 12; // 3 tiles off, behind a wall the raider cannot see through
  wall(b, [[10, 8], [10, 9], [10, 10], [10, 11], [10, 12], [10, 13], [10, 14], [10, 15], [10, 16]]);
  const R = foe(b, "raiders", 17, 12);
  check(MED.guarded(b, n), `${a.name} stands ${Math.hypot(a.x - n.x, a.y - n.y)} tiles from ${n.name}: guarded (${MED.MEDIC.FINISH.GUARD} tiles)`);
  forced(b, true, () => MED.finishTurn(b, R));
  check(!n.dead && R.ap === 2, `${R.name} sees ${n.name} in the open but leaves them be`);
  a.x = 2; a.y = 20;
  forced(b, true, () => MED.finishTurn(b, R));
  check(n.dead, `${a.name} gone off: ${R.name} finishes ${n.name}`);
}
{
  // Next to them too: one of yours close by, no blow and no dragging off.
  const { b, ps } = arena({ kind: "zealots" });
  const [a, c, n] = ps;
  c.x = 2; c.y = 22;
  n.x = 12; n.y = 12;
  downPlayer(b, n);
  a.x = 12; a.y = 9;
  wall(b, [[11, 10], [12, 10], [13, 10], [14, 10]]);
  const Z = foe(b, "zealots", 13, 12);
  forced(b, true, () => MED.finishTurn(b, Z));
  check(!n.dead && n.draggedBy == null, `a zealot next to ${n.name}, ${a.name} 3 tiles off behind a wall: left be`);
}

section("Pull out: someone down inside a vehicle, either side (MEDIC.PULL, Shift+U)");
const ourCar = (b, x = 8, y = 8) => {
  const r = placeCar(b.cells, b.w, b.h, x, y, "y", 3, "vehicle", () => true, 0, { ring: false });
  b.vehicle = { x: r.x0, y: r.y0, w: r.w, h: r.h, ax: "y", kind: "car", seats: 4, up: { turret: { gun: "lmg" } }, belt: 200 };
  b.losCache.fill(0);
  return b.vehicle;
};
const ringOk = (b, v, u) => !(u.x >= v.x && u.y >= v.y && u.x < v.x + v.w && u.y < v.y + v.h) && Math.max(v.x - u.x, u.x - (v.x + v.w - 1), v.y - u.y, u.y - (v.y + v.h - 1), 0) <= 1 && CELL[b.cells[u.y * b.w + u.x].k].walk;
{
  const { st, b, ps } = arena();
  const [a, c, n] = ps;
  const v = ourCar(b);
  // The turret's gunner goes down: back inside, out of reach.
  n.x = v.x - 1; n.y = v.y; n.ap = 2;
  check(!combatAct(st, { type: "board", unit: n.id }) && n.aboard, `${n.name} gets in`);
  n.ap = 2;
  check(!combatAct(st, { type: "gunner", unit: n.id }) && n.gunner, `${n.name} mans the turret`);
  damage(b, n, 999, null);
  check(n.down && n.aboard && n.off && !n.gunner, `${n.name} goes down on the turret: dropped back inside (aboard, off the map)`);
  a.ap = 2;
  check(/down/.test(MED.reviveRefusal(b, a, n)) && /next to the vehicle/.test(MED.pullRefusal(b, a, n)), `inside nobody can treat them; from afar: “${MED.pullRefusal(b, a, n)}”`);
  a.x = v.x - 1; a.y = v.y + 1;
  UI.renderCombatScreen(st); UI.cui.sel = a.id;
  const html = UI.renderCombatScreen(st);
  const btnHtml = (html.match(/<button[^>]*data-v="pullOut"[^>]*>[^<]*/) || [""])[0];
  check(btnHtml && !/disabled/.test(btnHtml) && /Pull out/.test(btnHtml), "next to the vehicle: the Pull out button, enabled");
  const err = combatAct(st, { type: "pullOut", unit: a.id });
  check(!err && !n.aboard && !n.off && n.down && Math.max(Math.abs(n.x - a.x), Math.abs(n.y - a.y)) === 1 && ringOk(b, v, n), `${a.name} pulls ${n.name} out onto (${n.x},${n.y}), next to both (${err || "no error"})`);
  check(a.ap === 2 - MED.MEDIC.PULL.AP, `${MED.MEDIC.PULL.AP} actions`);
  a.ap = 2;
  const e2 = forced(b, true, () => combatAct(st, { type: "revive", unit: a.id, target: n.id }));
  check(!e2 && !n.down, `then revived as anyone on the ground (${e2 || "no error"})`);
  // Laid in on purpose: pulled out it no longer counts as carried out.
  downPlayer(b, n);
  c.x = n.x; c.y = n.y + 1; c.ap = 2;
  const e3 = combatAct(st, { type: "dragAlly", unit: c.id, target: n.id });
  const e4 = combatAct(st, { type: "dropAlly", unit: c.id, into: "vehicle" });
  check(n.aboard && n.carried, `${n.name} laid in the vehicle (carried out) (${e3 || e4 || "no error"})`);
  a.ap = 2;
  combatAct(st, { type: "pullOut", unit: a.id, target: n.id });
  check(!n.aboard && !n.carried && n.down, "pulled out again: on the ground, no longer carried out");
}
{
  // The AI (your side): goes over to the vehicle, then pulls the downed rider out where nobody is shooting.
  const { b, ps } = arena();
  const [a, c, n] = ps;
  const v = ourCar(b, 14, 10);
  c.x = 2; c.y = 22;
  downPlayer(b, n);
  n.aboard = true; n.off = true; n.x = v.x; n.y = v.y;
  a.x = 8; a.y = 11; a.ap = 2;
  MED.rescueTurn(b, a);
  check(ringOk(b, v, a) && n.aboard, `${a.name} goes over to the vehicle (${a.x},${a.y})`);
  a.ap = 2;
  MED.rescueTurn(b, a);
  check(!n.aboard && !n.off && ringOk(b, v, n), `and pulls ${n.name} out onto (${n.x},${n.y})`);
}
{
  // The enemy's Humvee: their gunner goes down on its roof; one of theirs next to it pulls them out (nobody of yours
  // sees the spot); you can pull one out too, and finish them.
  for (const who of ["theirs", "yours"]) {
    const { st, b, ps } = arena({ kind: "soldiers" });
    const [a] = ps;
    wall(b, Array.from({ length: b.h }, (_, y) => [6, y]));
    foe(b, "soldiers", 24, 12); foe(b, "soldiers", 26, 18);
    const hv = placeRaidHumvee(b, "m2hb");
    const G = manEnemyTurret(b, "m2hb");
    downFoe(b, G, a);
    const R = b.units.find((u) => u.side === "enemy" && u.kind === "human" && active(u));
    const v = { x: hv.x0, y: hv.y0, w: hv.w, h: hv.h };
    const spot = [];
    for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h && ringOk(b, v, { x, y }) && !b.units.some((o) => !o.dead && !o.off && o.x === x && o.y === y)) spot.push([x, y]);
    if (who === "theirs") {
      check(G.down && !G.gunner && !!MED.vehicleOf(b, G), `${G.name} goes down behind the M2: on the Humvee's roof`);
      [R.x, R.y] = spot[0]; R.ap = 2;
      MED.rescueTurn(b, R);
      check(!MED.vehicleOf(b, G) && ringOk(b, v, G) && G.down, `${R.name} pulls ${G.name} off the roof onto (${G.x},${G.y})`);
    } else {
      R.x = 30; R.y = 2;
      [a.x, a.y] = spot[0]; a.ap = 2;
      const err = combatAct(st, { type: "pullOut", unit: a.id });
      check(!err && ringOk(b, v, G) && G.down, `${a.name} pulls the enemy gunner ${G.name} out (${err || "no error"})`);
      a.ap = 2;
      const e2 = combatAct(st, { type: "finish", unit: a.id, target: G.id });
      check(!e2 && G.dead, `and finishes them (${e2 || "no error"})`);
    }
  }
}
{
  // The enemy's Humvee carries a driver and riders now (combat.js crewRaidCar, carOf): one of them down inside is in
  // their Humvee (vehicleOf, not your vehicle, which this map lacks), and you pull them out the same way.
  const { st, b, ps } = arena({ kind: "soldiers" });
  const [a] = ps;
  wall(b, Array.from({ length: b.h }, (_, y) => [6, y]));
  foe(b, "soldiers", 24, 12); foe(b, "soldiers", 26, 18);
  const hv = placeRaidHumvee(b, "m2hb");
  manEnemyTurret(b, "m2hb");
  const v = { x: hv.x0, y: hv.y0, w: hv.w, h: hv.h };
  const D = b.units.find((u) => u.side === "enemy" && u.kind === "human" && active(u) && !u.gunner);
  D.aboard = true; D.off = true; D.x = v.x; D.y = v.y; b.raidHumvee.driver = D.id;
  downFoe(b, D, a);
  const r = MED.vehicleOf(b, D);
  check(!b.vehicle && D.aboard && r && r.x === v.x && r.y === v.y && r.w === v.w && r.h === v.h, `${D.name}, at their wheel, goes down inside their Humvee: in its rect`);
  const spot = [];
  for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h && ringOk(b, v, { x, y }) && !b.units.some((o) => !o.dead && !o.off && o.x === x && o.y === y)) spot.push([x, y]);
  for (const o of b.units) if (o.side === "enemy" && active(o) && !o.aboard && !o.gunner) { o.x = 30; o.y = 2; }
  [a.x, a.y] = spot[0]; a.ap = 2;
  const err = combatAct(st, { type: "pullOut", unit: a.id, target: D.id });
  check(!err && !D.aboard && !D.off && D.down && ringOk(b, v, D), `${a.name} pulls the driver ${D.name} out of their Humvee onto (${D.x},${D.y}) (${err || "no error"})`);
}
{
  // The key: Shift+U, no clash in a battle.
  const KEYS = await import("../src/ui/keymap.js");
  KEYS.initKeymap({});
  const k = KEYS.KEY_BY_ID.get("battle.pullOut");
  check(k && k.keys.includes("Shift+KeyU") && k.v === "pullOut" && KEYS.keyAction({ code: "KeyU", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }, "battle") === "battle.pullOut", "Pull out is Shift+U in a battle");
  check(!KEYS.conflicts().length, `no two actions share a key (${KEYS.conflicts().map((c) => c.chord).join(", ") || "none"})`);
}

section("Drag first, then revive: the AI drags a downed ally to a quiet cell and names a medic to revive them (MEDIC.PLAN)");
// Three raiders to the west (x 4) see the open ground; a wall at x 13 (y 10-14) gives cover east of it.
const shelter = (kind = "raiders", kits = ["tool", null, null]) => {
  const A = arena({ kind, kits });
  wall(A.b, [[13, 10], [13, 11], [13, 12], [13, 13], [13, 14]]);
  const es = [10, 12, 14].map((y) => foe(A.b, kind, 4, y));
  return { ...A, es };
};
// Whole rounds of rescue moves (each unit's rescueTurn, then the downed bleed as at a turn's start) until fn() or n rounds.
const rounds = (b, units, n, fn) => {
  for (let k = 0; k < n && !fn(); k++) {
    b.turn++;
    for (const u of units) if (active(u)) { u.ap = 2; forced(b, true, () => MED.rescueTurn(b, u)); }
  }
  return fn();
};
{
  // Your side: a teammate without a kit drags, the medic (two moves off) is named, comes over, revives.
  const { b, ps, es } = shelter();
  const [a, c, n] = ps;
  n.x = 12; n.y = 12; downPlayer(b, n);
  c.x = 12; c.y = 11; a.x = 18; a.y = 13;
  const t0 = MED.exposure(b, n.x, n.y, es).threat;
  rounds(b, [c], 3, () => n.plan);
  check(!!n.plan && n.plan.medic === a.id && MED.exposure(b, n.x, n.y, es).threat < MED.MEDIC.RISK.REVIVE, `${c.name} drags ${n.name} from the open (threat ${t0}) to a quiet cell (${n.x},${n.y}, threat ${MED.exposure(b, n.x, n.y, es).threat}) and names ${a.name} to revive them`);
  check(b.log.some((l) => /into cover for .* to see to/.test(l.text)), `the log: “${(b.log.find((l) => /into cover for/.test(l.text)) || {}).text}”`);
  // The others stabilize the named one while the medic is on the way, but leave them where they lie, for the medic.
  check(n.stab, `${c.name} stabilized ${n.name} right after putting them down (actions left)`);
  b.turn++; c.ap = 2; n.bleed = 3; n.stab = false;
  const before = [n.x, n.y];
  check(MED.rescueStep(b, c) && n.stab && n.x === before[0] && n.y === before[1] && n.draggedBy == null && n.plan.medic === a.id && n.rescueTurn !== b.turn, `${c.name}, next to them, stabilizes ${n.name} (no drag, no claim): still ${a.name}'s to revive`);
  check(!MED.rescueStep(b, c) && n.draggedBy == null, `then leaves them to ${a.name}`);
  rounds(b, [c, a], 3, () => !n.down);
  check(!n.down && b.log.some((l) => /back on their feet/.test(l.text)), `${a.name} comes over and revives ${n.name} there (${n.down ? "still down" : "up"})`);
}
{
  // A medic who drags: down at the quiet cell, revived by them the next turn.
  const { b, ps, es } = shelter();
  const [a, c, n] = ps;
  c.x = 2; c.y = 22;
  n.x = 12; n.y = 12; downPlayer(b, n);
  a.x = 12; a.y = 11;
  rounds(b, [a], 3, () => n.plan);
  check(!!n.plan && n.plan.medic === a.id && MED.exposure(b, n.x, n.y, es).threat < MED.MEDIC.RISK.REVIVE, `${a.name} (the medic) drags ${n.name} to a quiet cell (${n.x},${n.y}): planned for themselves`);
  const turn = b.turn;
  rounds(b, [a], 2, () => !n.down);
  check(!n.down && b.turn - turn <= 1, `revived there ${b.turn === turn ? "the same turn (actions left)" : "the next turn"}`);
  void es;
}
{
  // The enemy too: one of theirs drags a downed comrade to cover; their medic revives them.
  const { b, ps } = arena({ kind: "soldiers" });
  ps.forEach((u, i) => { u.x = 4; u.y = 10 + i * 2; });
  wall(b, [[13, 10], [13, 11], [13, 12], [13, 13], [13, 14]].map(([x, y]) => [x + 4, y]));
  const A = foe(b, "soldiers", 16, 12), B = foe(b, "soldiers", 16, 11);
  const M = MED.makeEnemyMedic(foe(b, "soldiers", 22, 13), "traumakit", 5);
  downFoe(b, A, ps[0]);
  rounds(b, [B], 3, () => A.plan);
  check(!!A.plan && A.plan.medic === M.id, `${B.name} drags ${A.name} to (${A.x},${A.y}) for their medic ${M.name}`);
  B.ap = 2; b.turn++; A.stab = false;
  const stabB = forced(b, true, () => MED.rescueStep(b, B)) && A.stab && !!A.plan;
  check(stabB, `${B.name} (no kit) stabilizes ${A.name} by hand while ${M.name} comes`);
  rounds(b, [B, M], 3, () => !A.down);
  check(!A.down && A.shaken, `${M.name} revives ${A.name} there`);
}
{
  // The plan is kept in a save.
  const { st, b, ps } = arena();
  const n = ps[2];
  downPlayer(b, n); n.plan = { medic: ps[0].id, turn: b.turn };
  const L = loadFromString(saveToString(st));
  const m = L.combat.units.find((x) => x.id === n.id);
  check(m.plan && m.plan.medic === ps[0].id && m.plan.turn === b.turn, "the plan survives a save");
}

section("Laying a bleeding ally in the vehicle stabilizes them first (1 action), or warns");
{
  const { st, b, ps, h } = arena();
  const [a, c, n] = ps;
  b.vehicle = { x: 7, y: 3, w: 2, h: 3, kind: "car", seats: 4 };
  const lay = (ap, meds, roll) => {
    downPlayer(b, n); n.aboard = false; n.off = false; n.stab = false; n.carried = false;
    n.x = 6; n.y = 6; c.x = 6; c.y = 5; c.ap = 2; h.stock.meds = meds;
    combatAct(st, { type: "dragAlly", unit: c.id, target: n.id });
    c.ap = ap;
    UI.renderCombatScreen(st); UI.cui.sel = c.id;
    const html = UI.renderCombatScreen(st);
    const btn = (html.match(/<button[^>]*data-v="dropVehicle"[^>]*>[^<]*/) || [""])[0];
    const err = forced(b, roll, () => combatAct(st, { type: "dropAlly", unit: c.id, into: "vehicle" }));
    return { btn, err };
  };
  const r1 = lay(2, 3, true);
  check(!r1.err && n.aboard && n.stab && medsLeft(b) === 2 && c.ap === 1 && /stabilized on the way in/.test(r1.btn), `with meds: stabilized on the way in, 1 action and 1 meds (the button says so) (${r1.err || "no error"})`);
  const r2 = lay(2, 0, false);
  check(n.aboard && !n.stab && c.ap === 1 && /by hand/.test(r2.btn) && /⚠/.test(r2.btn) && /bleed on inside/.test(r2.btn), `no meds: the button warns (⚠); tried by hand on the way in (${MED.handsOdds(c)}%), failed: in, still bleeding`);
  lay(2, 0, true);
  check(n.aboard && n.stab, "no meds, the roll comes up: stabilized");
  check(MED.layInStab(b, { side: "player", ap: 0 }, { down: true }) === "", "with no action left nothing is tried (the button would warn; orders need an action anyway)");
  b.vehicle = null; void a;
}

section("A medic draws fire while treating");
{
  const { b, ps } = arena();
  const [a, , n] = ps;
  n.x = 3; n.y = 2; n.hp = 40;
  const p0 = shotPriority(b, a);
  MED.medicHeal(b, a, n);
  check(shotPriority(b, a) > p0, `shotPriority ${p0} → ${shotPriority(b, a)} after treating`);
}

section("By the numbers: a medic with a kit means fewer deaths");
{
  const { st, people } = arena({ kits: [null, null, null] });
  const enemy = { kind: "raiders", count: 4 };
  const plain = fightForecast(st, null, people, { odds: 0.6, enemy }, "never");
  people[0].gear.tool = newItem("bandagekit");
  const medic = fightForecast(st, null, people, { odds: 0.6, enemy }, "never");
  check(medic.deaths < plain.deaths && Math.abs(medic.win - plain.win) < 0.05, `about ${plain.deaths.toFixed(2)} deaths a fight → ${medic.deaths.toFixed(2)} with a medic (win ${Math.round(plain.win * 100)}% either way)`);
  // The same fights rolled: the saved come home barely alive.
  const model = fightModel(st, people, { win: 0.9, enemy });
  let saved = 0, fell = 0;
  const rng = new Rng(5);
  for (let i = 0; i < 400; i++) { const r = rollFight(rng, model, "never"); fell += r.members.filter((m) => m.down).length; saved += r.members.filter((m) => m.saved).length; }
  check(saved > 0 && saved < fell, `won fights: ${saved} of ${fell} who fell saved by the medic`);
  check(MED.medicLevel([{ medicine: 7, medKit: { name: "x" }, kitBonus: 2, kitLeft: 5, kitUses: 0 }]) === 7 + MED.MEDIC.END_KIT, "on the map, a medic with a kit counts more for the downed's odds when the battle ends");
}

section("A save in the middle of a battle keeps it all");
{
  const { st, b, ps } = arena();
  const [a, c, n] = ps;
  n.x = 3; n.y = 2; c.x = 4; c.y = 2;
  downPlayer(b, n);
  combatAct(st, { type: "dragAlly", unit: c.id, target: n.id });
  const E = foe(b, "soldiers", 20, 12); MED.makeEnemyMedic(E, "traumakit", 4);
  const D = foe(b, "raiders", 21, 13); downFoe(b, D, a);
  a.shaken = true; a.aim -= 10;
  const L = loadFromString(saveToString(st));
  const lb = L.combat;
  const u = (id) => lb.units.find((x) => x.id === id);
  check(!!lb && u(c.id).dragging === n.id && u(n.id).draggedBy === c.id && u(n.id).down, "dragging and the downed kept");
  check(MED.isMedic(u(a.id)) && MED.isMedic(u(E.id)) && u(E.id).medKit.key === "traumakit", "the medics (yours and theirs) kept");
  check(u(D.id).down && u(D.id).wounded && u(a.id).shaken, "the enemy's downed and the shaken kept");
  const err = combatAct(L, { type: "move", unit: c.id, x: 6, y: 2 });
  check(!err && u(c.id).x === 6 && u(n.id).x === 5, `the loaded battle goes on: the drag continues (${err || "no error"})`);
}

section("One model of the downed with the non-lethal kit (nonlethal.js): states, finish or execute, prisoners, the raiders' choice");
{
  const { st, b, ps } = arena({ kind: "raiders" });
  const [a, c] = ps;
  a.x = 10; a.y = 10; c.x = 2; c.y = 22;
  const Stab = foe(b, "raiders", 11, 10), Tied = foe(b, "raiders", 11, 11), Bleed = foe(b, "raiders", 9, 10), SurrT = foe(b, "raiders", 9, 11), SurrU = foe(b, "raiders", 25, 20), KO = foe(b, "raiders", 10, 11);
  for (const e of [Stab, Tied, Bleed]) downFoe(b, e, a);
  Stab.stab = true;
  const { surrender } = await import("../src/sim/nonlethal.js");
  const { knockOut, heldDown, prisonerOf } = await import("../src/sim/stealth.js");
  surrender(b, SurrT); surrender(b, SurrU); knockOut(b, KO, a);
  check([Stab, Tied, Bleed, SurrT, SurrU, KO].every(heldDown), "down, stabilized, surrendered and knocked out are all held down (stealth.js heldDown): Tie, Drag, Execute or Finish apply");
  a.ap = 2;
  const eT = combatAct(st, { type: "tie", unit: a.id, target: Tied.id }); a.ap = 2;
  const eS = combatAct(st, { type: "tie", unit: a.id, target: SurrT.id }); a.ap = 2;
  check(!eT && !eS && Tied.tied && SurrT.tied, `Tie works on one who went down and on one who gave up (${eT || eS || "no error"})`);
  // Finish only the bleeding and stabilized who are not tied; the rest is Execute.
  const fK = MED.finishRefusal(b, a, KO), fS = MED.finishRefusal(b, a, SurrT), fT = MED.finishRefusal(b, a, Tied);
  check(/Execute/.test(fK) && /Execute/.test(fS) && /Execute/.test(fT) && !MED.finishRefusal(b, a, Bleed), `Finish refuses the knocked out, the surrendered and the tied: “${fT}”`);
  check(MED.finishRefusal(b, a, Stab) === "", "a stabilized one can be finished");
  check(prisonerOf(Stab) && prisonerOf(Tied) && prisonerOf(KO) && prisonerOf(SurrT) && !prisonerOf(SurrU) && !prisonerOf(Bleed), "prisoners after a win (stealth.js prisonerOf, one rule): stabilized, tied, knocked out, surrendered and tied; not the untied who gave up, not the bleeding");
  b.units.filter((u) => u.side === "enemy" && active(u)).forEach((u) => { u.dead = true; });
  endBattleNow(st, "victory");
  const names = (b.result.prisoners || []).map((x) => x.name || x);
  check(b.result.knockedOut === 4 && Bleed.dead && !Stab.dead, `the battle won: ${b.result.knockedOut} prisoners (stabilized, tied, out cold, tied after giving up); the bleeding one died`);
  void names;
}
{
  // The raiders' choice, from nonlethal.js NL_TAKE (raiders 25%, zealots 0): one of yours out cold next to them is tied up
  // (taken after the battle), never dragged; zealots never take anyone.
  check(MED.takeShare("raiders") === 0.25 && MED.takeShare("zealots") === 0 && MED.takeShare("soldiers") > 0, `takes alive: raiders ${MED.takeShare("raiders")}, zealots ${MED.takeShare("zealots")} (nonlethal.js NL_TAKE)`);
  const { b, ps } = arena();
  const [a, c, n] = ps;
  a.x = 2; a.y = 22; c.x = 3; c.y = 22;
  n.x = 12; n.y = 12;
  const { koSurvivor } = await import("../src/sim/nonlethal.js");
  koSurvivor(b, n, null);
  const R = foe(b, "raiders", 13, 12);
  let tied = 0, killed = 0;
  for (let i = 0; i < 200; i++) {
    n.dead = false; n.tied = false; n.down = true; n.ko = true; R.ap = 2;
    MED.finishTurn(b, R);
    if (n.tied) tied++; else if (n.dead) killed++;
    if (n.draggedBy != null) tied = -999; // never dragged
  }
  check(tied > 0 && killed > tied, `one of yours out cold next to a raider: finished ${killed}, tied up to be taken ${tied} of 200 (never dragged off)`);
  const Z = foe(b, "zealots", 11, 12);
  let zt = 0;
  for (let i = 0; i < 100; i++) { n.dead = false; n.tied = false; n.down = true; n.ko = true; Z.ap = 2; R.ap = 0; MED.finishTurn(b, Z); if (n.tied) zt++; }
  check(zt === 0, "zealots never take anyone alive");
}
{
  // Execute (nonlethal.js) covers a tied prisoner who went down.
  const { st, b, ps } = arena();
  const [a] = ps;
  a.x = 10; a.y = 10;
  const T = foe(b, "raiders", 11, 10);
  downFoe(b, T, a);
  a.ap = 2; combatAct(st, { type: "tie", unit: a.id, target: T.id }); a.ap = 2;
  const err = combatAct(st, { type: "execute", unit: a.id, target: T.id });
  check(!err && T.dead, `Execute kills a tied prisoner who went down (${err || "no error"})`);
}
{
  // An enemy medic's kit is on their body.
  const { st, b, ps } = arena({ kind: "soldiers" });
  const M = MED.makeEnemyMedic(foe(b, "soldiers", 12, 12), "traumakit", 4);
  M.dead = true;
  b.units.filter((u) => u.side === "enemy").forEach((u) => { u.dead = true; });
  endBattleNow(st, "victory");
  const { allItems } = await import("../src/sim/inventory.js");
  const body = (b.bodies || []).find((x) => x.uid === M.id) || null;
  const kit = body ? allItems(body).find((it) => it.key === "traumakit") : null;
  check(!!kit, `${M.name}'s Field trauma kit is on the body to loot${kit && kit.dur != null ? ` (${kit.dur} uses)` : ""}`);
  void ps;
}
{
  // The keys: Shift+H heal, Shift+V revive, Shift+K finish, Shift+D drags a downed teammate; nothing on the wave1-int
  // branch's Shift+F, J, O, G, I, T; no two battle actions on one chord.
  const K = await import("../src/ui/keymap.js");
  const ev = (code) => ({ code, shiftKey: true, ctrlKey: false, altKey: false, metaKey: false });
  check(K.keyAction(ev("KeyH"), "battle") === "battle.heal" && K.keyAction(ev("KeyV"), "battle") === "battle.revive" && K.keyAction(ev("KeyK"), "battle") === "battle.finish" && K.keyAction(ev("KeyD"), "battle") === "battle.drag", "Shift+H heal, Shift+V revive, Shift+K finish, Shift+D drag");
  // (merged with the weapons overhaul: those Shift keys are its orders now, none of them the medics')
  const W1 = { KeyF: "battle.firemode", KeyJ: "battle.unjam", KeyO: "battle.suppress", KeyG: "battle.throwspear", KeyI: "battle.ammocycle", KeyT: "battle.gunner" };
  check(Object.entries(W1).every(([c, id]) => K.keyAction(ev(c), "battle") === id), "Shift+F, J, O, G, I, T are the weapons overhaul's (fire mode, unjam, suppress, throw spear, the ammo pick, the turret)");
  const seenChords = new Map(); let clash = "";
  for (const k of K.KEYMAP.filter((x) => x.ctx === "battle")) for (const c of k.keys) { if (seenChords.has(c)) clash += ` ${c}: ${seenChords.get(c)} / ${k.id}`; seenChords.set(c, k.id); }
  check(!clash, `no two battle actions on one key${clash ? `:${clash}` : ""}`);
  // Shift+D next to a downed teammate takes hold of them.
  const { st, b, ps } = arena();
  const [a, c, n] = ps;
  n.x = 3; n.y = 2; c.x = 4; c.y = 2; a.x = 2; a.y = 20;
  downPlayer(b, n);
  UI.renderCombatScreen(st); UI.cui.sel = c.id;
  UI.combatAction(st, "cb-act", { v: "drag" });
  check(c.dragging === n.id, `Shift+D (Drag) next to a downed teammate: ${c.name} takes hold of ${n.name}`);
  UI.combatAction(st, "cb-act", { v: "drag" });
  check(c.dragging == null && n.draggedBy == null, "Shift+D again puts them down");
}

section("Rescue (rescueraid.js): no reaching across a wall's corner; tied is one flag, and a tied one of yours is no prisoner");
{
  const { st, b, ps } = arena();
  const [a, c, n] = ps;
  // a at (10,10), the target diagonally at (11,11), walls on both orthogonal cells (11,10) and (10,11).
  a.x = 10; a.y = 10; c.x = 2; c.y = 22; n.x = 11; n.y = 11;
  wall(b, [[11, 10], [10, 11]]);
  downPlayer(b, n);
  a.ap = 2;
  const { prisonerOf, heldDown } = await import("../src/sim/stealth.js");
  check(/corner/.test(MED.reviveRefusal(b, a, n)) && /corner/.test(MED.liftRefusal(b, a, n)) && /corner/.test(MED.stabilizeRefusal(b, a, n)), `Revive, Drag and Stabilize refuse across a wall's corner (“${MED.reviveRefusal(b, a, n)}”)`);
  n.x = 2; n.y = 20;
  const E = foe(b, "raiders", 11, 11);
  downFoe(b, E, a);
  E.x = 11; E.y = 11;
  const wasMelee = (a.weapon = "machete", a.weaponName = "machete");
  void wasMelee;
  check(/corner/.test(MED.finishRefusal(b, a, E)), `Finish with a blow refuses across the corner (“${MED.finishRefusal(b, a, E)}”)`);
  const eTie = combatAct(st, { type: "tie", unit: a.id, target: E.id });
  check(/corner/.test(eTie) && !E.tied, `Tie refuses across the corner (“${eTie}”)`);
  E.tied = true;
  const eEx = combatAct(st, { type: "execute", unit: a.id, target: E.id });
  check(/corner/.test(eEx) && !E.dead, `Execute refuses across the corner (“${eEx}”)`);
  // One of yours tied up (a captive in a rescue raid): not held down, not a prisoner, not dragged or revived.
  const cap = c; cap.tied = true; cap.captive = true; cap.down = true; cap.x = 3; cap.y = 22;
  const d = ps[2]; d.down = false; d.hp = 50; d.x = 4; d.y = 22; d.ap = 2; arm(d);
  check(!heldDown(cap) && !prisonerOf(cap) && /Drag a downed ally/.test(MED.liftRefusal(b, d, cap)) && /Revive someone/.test(MED.reviveRefusal(b, a, cap)), "a tied one of yours (a rescue captive) is no prisoner of yours, and is cut free before anyone drags or revives them");
  check(!active(cap), "tied is out of the fight (combat.js active / isTied)");
}

section("Whole battles played by the AI on both sides (AI plays my side), and the raid bot");
{
  const tally = { down: 0, revived: 0, failed: 0, stab: 0, hands: 0, dragged: 0, finished: 0, grabbed: 0, healed: 0, foeDown: 0, foeDied: 0, battles: 0, errors: 0, prisoners: 0 };
  const count = (b) => {
    for (const l of b.log) {
      const t = l.text;
      if (/is down and bleeding/.test(t)) tally.down++;
      if (/back on their feet/.test(t)) tally.revived++;
      if (/cannot bring .* round/.test(t)) tally.failed++;
      if (/stabilizes|: stabilized\./.test(t)) tally.stab++;
      if (/bare hands/.test(t)) tally.hands++;
      if (/grabs .* to drag/.test(t)) tally.dragged++;
      if (/finishes .* off|puts a round into/.test(t)) tally.finished++;
      if (/away as a prisoner/.test(t)) tally.grabbed++;
      if (/treats .* with the/.test(t)) tally.healed++;
      if (/goes down, bleeding/.test(t)) tally.foeDown++;
      if (/bleeds out/.test(t)) tally.foeDied++;
    }
    tally.prisoners += (b.result && b.result.knockedOut) || 0;
  };
  for (const kind of ["soldiers", "raiders"]) for (let seed = 1; seed <= 8; seed++) {
    try {
      const st = createWorld({ seed: 100 + seed, factionCount: 4 });
      const h = hub(st);
      h.stock.ammo = 80; h.stock.meds = 6;
      const people = atBase(st, h.id).slice(0, 4);
      people.forEach((x, i) => { if (i < 2) x.gear.tool = newItem(i ? "bandagekit" : "traumakit"); });
      const f = st.factions.find((x) => x.alive && x.bases && x.bases.length);
      const b = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((x) => x.id), enemy: { kind, count: 5, power: 4, factionId: f.id, name: f.name }, ambush: null, canRetreat: true, handler: "medictest", context: {} });
      st.combat = b;
      const es = b.units.filter((u) => u.side === "enemy" && u.kind === "human");
      if (kind === "soldiers" && es[0] && !MED.isMedic(es[0])) MED.makeEnemyMedic(es[0], "traumakit", 5);
      for (let turn = 0; turn < 40 && !b.over; turn++) { autoPlayerTurn(st, { retreat: false }); runEnemyPhase(st); }
      if (!b.over) endBattleNow(st, "defeat");
      count(b);
      tally.battles++;
    } catch (e) { tally.errors++; console.log(e.stack.split("\n").slice(0, 4).join(" ")); }
  }
  check(tally.errors === 0 && tally.battles === 16, `16 battles (raiders; soldiers with a medic) played out with no errors`);
  check(tally.foeDown > 0 && tally.stab + tally.revived + tally.dragged > 0, `enemies went down ${tally.foeDown} times (${tally.foeDied} bled out, ${tally.prisoners} taken prisoner); rescues on both sides: ${tally.revived} revived (${tally.failed} failed tries), ${tally.stab} stabilized (${tally.hands} by hand), ${tally.dragged} drags, ${tally.healed} medic heals`);
  console.log(`    your people went down ${tally.down} times; finished by raiders ${tally.finished}, dragged off ${tally.grabbed}`);
  // The raid bot, with medics.
  const { battles } = await import("./isobattles.js");
  let raidErr = "";
  try {
    const { st, b } = battles(5, ["raid"])[0];
    for (const u of b.units.filter((x) => x.side === "player" && !x.medKit)) { u.medKit = newItem("bandagekit"); u.kitBonus = 2; u.kitLeft = 5; u.kitUses = 0; u.medicine += 2; }
    for (let turn = 0; turn < 60 && !b.over; turn++) { autoPlayerTurn(st); runEnemyPhase(st); }
  } catch (e) { raidErr = e.stack.split("\n").slice(0, 4).join(" "); }
  check(!raidErr, `the raid bot plays a raid with medics through (${raidErr || "no errors"})`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
