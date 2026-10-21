// Melee, footsteps and the small sounds (ui/sfx-melee.js, ui/sfx-steps.js, ui/sfx-gear.js, ui/sfx-out.js): headless
// checks with no speakers (tools/audiotest.js covers the rest of the sound).
// - Importing every sound module in node does nothing and throws nothing.
// - Melee: the class of every melee weapon (punch, wood, metal, heavy, blade, chop, stab; a gun swung is a butt), the cue
//   of a hit, a miss, a kill, a blow on armour (a person's pieces: the sim's own strikes carry it) or on the armoured
//   dead, a door battered and broken; the enemy's blows too; the dead still bite.
// - Footsteps: the ground (grass, road, wooden floors, gravel, mud and snow by the weather), the gait (walk, run, sneak),
//   the load, the dead's kinds; paced along the move; yours, the enemy's (AI parity) and the unseen nearby (muffled);
//   capped per frame; a battle first seen is quiet.
// - The rest: searches and locks, bandages, a door opened by a move, your vehicle driven; windows, the inventory's held
//   item, a team's engine (and its doors) on the map; the click. (tools/vehdoortest.js covers the doors and vehicles.)
// - Every voice builds on a stub AudioContext with every variant, no NaN; the output stage; the Footsteps option.
// Usage: node tools/sfxtest.js
import * as C from "../src/sim/combat.js";
import { WEAPONS } from "../src/sim/combat.js";
import { battles } from "./isobattles.js";
import { planOf } from "../src/ui/moveanim.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

console.log("Imports");
let M, S, G, O, AU, SC;
{
  let err = "";
  try {
    M = await import("../src/ui/sfx-melee.js");
    S = await import("../src/ui/sfx-steps.js");
    G = await import("../src/ui/sfx-gear.js");
    O = await import("../src/ui/sfx-out.js");
    SC = await import("../src/ui/soundcues.js");
    AU = await import("../src/ui/audio.js");
  } catch (e) { err = e.stack; }
  check(!err, `the sound modules load in node with nothing run${err ? `: ${err}` : ""}`);
}
const { meleeClass, meleeCue, CLASS, MELEE_CLASSES } = M;
const { surfaceAt, groundOf, gaitOf, deadKind, stepCues, MAX_STEPS, MAX_MOVERS, HEAR_TILES } = S;
const { lootSound, gearCues, uiCues, clickSound, itemKind } = G;

// ---------- melee ----------
console.log("Melee");
{
  const cls = (k) => meleeClass(k);
  check(cls("fists") === "punch" && cls("bat") === "wood" && cls("nailbat") === "wood" && cls("prybar") === "metal" && cls("baton") === "metal" && cls("hammer") === "metal",
    "fists punch; bats are wood; a crowbar, a baton, a hammer metal");
  check(cls("sledge") === "heavy" && cls("pickaxe") === "heavy" && cls("machete") === "blade" && cls("katana") === "blade" && cls("knife") === "blade" &&
    cls("fireaxe") === "chop" && cls("hatchet") === "chop" && cls("spear") === "stab" && cls("combatknife") === "stab", "sledge and pickaxe heavy; knives, machetes, katana blades; axes chop; spears and the combat knife stab");
  check(cls("pistol") === "butt" && cls("ar") === "butt" && meleeClass("bat", "bash") === "butt", "a gun swung as a club: the butt");
  const melee = Object.keys(WEAPONS).filter((k) => WEAPONS[k].melee);
  check(melee.every((k) => CLASS[cls(k)] && MELEE_CLASSES.includes(cls(k))), `every melee weapon has a sound class (${melee.map((k) => `${k}=${cls(k)}`).join(", ")})`);

  const [town] = battles(31, ["field-town"]);
  const { st, b } = town;
  const me = b.units.find((u) => u.side === "player" && !u.dead), foe = b.units.find((u) => u.side === "enemy" && !u.dead && u.kind === "human");
  const fx = (e) => { C.fx(b, e); return b.fx[b.fx.length - 1]; };
  me.weapon = "bat";
  let c = meleeCue(b, fx({ type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, crit: false, dmg: 14, side: "player" }), me);
  check(c.name === "melee" && c.cls === "wood" && !c.kill && !c.mat && Number.isFinite(c.pan), `a bat blow: ${JSON.stringify(c)}`);
  c = meleeCue(b, fx({ type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: false, side: "player" }), me);
  check(c.name === "whoosh" && c.cls === "wood" && c.w === CLASS.wood.w, "a miss: the swing alone, as heavy as the weapon");
  me.weapon = "sledge";
  c = meleeCue(b, fx({ type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: false, side: "player" }), me);
  check(c.w > CLASS.blade.w && c.cls === "heavy", "a sledgehammer's swing is heavier than a blade's");
  me.weapon = "machete";
  c = meleeCue(b, fx({ type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, crit: false, dmg: 18, side: "player", loc: "head", mat: "hard", through: false }), me);
  check(c.mat === "hard" && c.head && c.through === false && c.cls === "blade", "a blade stopped by a helmet: heard on the helmet");
  c = meleeCue(b, fx({ type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, crit: false, dmg: 18, side: "player", loc: "torso", mat: "steel", through: true }), me);
  check(c.mat === "steel" && c.through === true, "through a steel plate: heard on both");
  foe.dead = true;
  c = meleeCue(b, fx({ type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, crit: false, dmg: 20, side: "player" }), me);
  check(c.name === "meleeCrit" && c.kill, "a killing blow: the heavier sound, with the body falling");
  foe.dead = false;
  c = meleeCue(b, fx({ type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, crit: true, dmg: 30, side: "player" }), me);
  check(c.name === "meleeCrit" && c.crit && !c.kill, "a critical: heavier too");
  // The enemy's blows (AI parity): their weapon's class.
  foe.weapon = "fireaxe";
  c = meleeCue(b, fx({ type: "melee", from: [foe.x, foe.y], to: [me.x, me.y], hit: true, crit: false, dmg: 15, side: "enemy" }), foe);
  check(c.cls === "chop", "an enemy's axe sounds like an axe");
  // A door battered and broken (combat.js bash): no one where it lands.
  const free = (() => { for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (!b.units.some((u) => u.x === x && u.y === y)) return [x, y]; })();
  c = meleeCue(b, fx({ type: "melee", from: [me.x, me.y], to: free, hit: true, crit: false, dmg: 12, side: "player", text: "-12" }), me);
  check(c.struct && !c.broke && c.name === "melee", "a door battered: the wooden boom");
  c = meleeCue(b, fx({ type: "melee", from: [me.x, me.y], to: free, hit: true, crit: false, dmg: 12, side: "player", text: "BROKEN" }), me);
  check(c.struct && c.broke && c.name === "meleeCrit", "a door broken: splinters");
  c = meleeCue(b, fx({ type: "melee", from: [foe.x, foe.y], to: [foe.x, foe.y], hit: true, crit: false, dmg: 0, side: "player", text: "KO" }), me);
  check(c.name === "melee" && !c.cls, "a knock-out, a stun (an effect's text): the plain thud as before");
  // Through battleCues: the class reaches the cue; the dead still bite (zombie-sfx's).
  const mem = {};
  SC.battleCues(b, mem, 0);
  me.weapon = "bat";
  C.fx(b, { type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, crit: false, dmg: 14, side: "player" });
  const cues = SC.battleCues(b, mem, 1);
  check(cues.length === 1 && cues[0].name === "melee" && cues[0].cls === "wood", `battleCues hands the blow on with its class (${JSON.stringify(cues[0])})`);

  // The sim's own strikes: blows on armour carry where they landed and what took them (combat.js strike → blowFx).
  const [city] = battles(33, ["field-city"]);
  const bc = city.b, stc = city.st;
  const p = bc.units.find((u) => u.side === "player" && !u.dead);
  p.weapon = "prybar";
  const humans = bc.units.filter((u) => u.side === "enemy" && u.kind === "human" && !u.dead);
  let blows = 0, onArmour = 0, located = 0, err = "";
  for (let i = 0; i < 120 && humans.length; i++) {
    const t = humans[i % humans.length];
    t.hp = 999; t.dead = false; t.down = false;
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [t.x + dx, t.y + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < bc.w && y < bc.h && C.CELL[bc.cells[y * bc.w + x].k].walk && !bc.units.some((u) => u !== p && u.x === x && u.y === y && !u.dead));
    if (!spot) continue;
    p.x = spot[0]; p.y = spot[1]; p.ap = 2; p.struck = null; bc.phase = "player";
    const seq = bc.fxSeq;
    try { C.combatAct(stc, { type: "melee", unit: p.id, target: t.id }); } catch (e) { err = e.message; break; }
    const f = bc.fx.find((x) => x.seq > seq && x.type === "melee" && x.hit);
    if (!f) continue;
    blows++;
    if (f.loc) located++;
    if (f.mat) onArmour++;
  }
  check(!err && blows > 20, `the sim's blows play out (${blows} hits${err ? `: ${err}` : ""})`);
  check(located > 0, `a blow on a person says where it landed (${located} of ${blows})`);
  check(onArmour > 0 || !humans.some((u) => u.pieces && Object.keys(u.pieces).length), `a blow on armour says what took it (${onArmour} of ${blows})`);
  // The armoured dead (deadsoldiers.js): a crowbar on a dead soldier's plates.
  const zs = { ...humans[0], id: 99901, kind: "zombie", ztype: "soldier", x: free[0], y: free[1], dead: false, down: false, pieces: undefined };
  bc.units.push(zs);
  c = meleeCue(bc, { type: "melee", from: [p.x, p.y], to: [zs.x, zs.y], hit: true, crit: false, dmg: 10, side: "player" }, { ...p, weapon: "knife" });
  check(c.mat === "ceramic", `a knife on a dead soldier's plates: heard on them (${c.mat})`);
  bc.units.pop();
}

// ---------- footsteps ----------
console.log("Footsteps");
{
  const b = { w: 4, h: 1, cells: [{ k: "open", f: "grass" }, { k: "open", f: "road" }, { k: "open", f: "floor", fl: "wood" }, { k: "rubble", f: "dirt" }], units: [] };
  check(surfaceAt(b, 0, 0) === "grass" && surfaceAt(b, 1, 0) === "hard" && surfaceAt(b, 2, 0) === "wood" && surfaceAt(b, 3, 0) === "gravel", "grass, road, a wooden floor indoors, rubble");
  const mud = groundOf({ key: "rain", mud: 0.6 }), snow = groundOf({ key: "snow", snowCover: 0.5, mud: 0 }), frozen = groundOf({ key: "clear", mud: 0.6, frozen: true });
  check(surfaceAt(b, 0, 0, mud) === "mud" && surfaceAt(b, 1, 0, mud) === "wet" && surfaceAt(b, 2, 0, mud) === "wood", "in the rain: mud on the grass, a wet road, dry indoors");
  check(surfaceAt(b, 0, 0, snow) === "snow" && surfaceAt(b, 1, 0, snow) === "snow" && surfaceAt(b, 2, 0, snow) === "wood" && surfaceAt(b, 0, 0, frozen) === "grass", "snow lying outdoors, not indoors; frozen ground carries no mud");
  check(deadKind({ kind: "zombie", ztype: "brute" }) === "brute" && deadKind({ kind: "zombie", ztype: "runner" }) === "runner" && deadKind({ kind: "zombie", ztype: "crawler", low: true }) === "crawler" &&
    deadKind({ kind: "zombie", ztype: "soldier" }) === "armoured" && deadKind({ kind: "zombie", ztype: "riot" }) === "armoured" && deadKind({ kind: "zombie" }) === "shuffle" && deadKind({ kind: "zombie", boss: "x" }) === "brute" && deadKind({ kind: "human" }) === null,
  "the dead: brutes stomp, runners slap, crawlers drag, armoured dead clank, walkers shuffle");

  const [town] = battles(35, ["field-town"]);
  const { st, b: bt } = town;
  const mem = { rng: () => 0.5 };
  check(stepCues(st, mem, 0).length === 0, "a battle first seen: no steps for what was already logged");
  const me = bt.units.find((u) => u.side === "player" && !u.dead);
  for (const e of bt.units) if (e.side === "enemy") e.aware = true;
  const path = (u, n) => Array.from({ length: n }, (_, i) => [Math.min(bt.w - 1, u.x + i + 1), u.y]);
  C.fx(bt, { type: "move", unit: me.id, from: [me.x, me.y], path: path(me, 4) });
  let s = stepCues(st, mem, 1);
  check(s.length >= 2 && s.length <= 4 && s.every((c) => c.name === "step" && c.gait === "walk" && c.seen && c.surf), `a 4-cell walk: ${s.length} steps (${s.map((c) => c.surf).join(", ")})`);
  check(s.every((c, i) => i === 0 || c.delay > s[i - 1].delay) && s[s.length - 1].delay < planOf(bt, me, bt.fx[bt.fx.length - 1]).total / 1000, "paced along the move as it is walked there");
  check(new Set(s.map((c) => c.foot)).size === 2, "left, right");
  me.loadBand = 3;
  C.fx(bt, { type: "move", unit: me.id, from: [me.x, me.y], path: path(me, (me.mob || 5) + 3) });
  s = stepCues(st, mem, 2);
  check(s.length && s.every((c) => c.gait === "run" && c.load === 3) && s.length <= MAX_STEPS, `a dash in heavy kit: running, laden (${s.length} steps)`);
  me.loadBand = 0;
  const foe = bt.units.find((u) => u.side === "enemy" && !u.dead);
  foe.aware = false;
  C.fx(bt, { type: "move", unit: me.id, from: [me.x, me.y], path: path(me, 4) });
  s = stepCues(st, mem, 3);
  check(s.length && s.every((c) => c.gait === "sneak" && c.gain < S.STEP_GAIN), "while the enemy is unaware: sneaking, quieter");
  foe.aware = true;
  // The enemy's steps (AI parity): seen, heard; unseen and far, not; unseen and near, muffled.
  const sees = C.playerSees(bt, foe);
  C.fx(bt, { type: "move", unit: foe.id, from: [foe.x, foe.y], path: [[foe.x, foe.y]] });
  s = stepCues(st, mem, 4);
  const near = bt.units.some((p) => p.side === "player" && C.active(p) && Math.max(Math.abs(p.x - foe.x), Math.abs(p.y - foe.y)) <= HEAR_TILES);
  check(sees ? s.length === 1 && s[0].seen : near ? s.length === 1 && !s[0].seen : s.length === 0, `an enemy moving (${sees ? "seen" : near ? "unseen, near" : "unseen, far"}): ${s.length ? (s[0].seen ? "heard" : "muffled") : "not heard"}`);
  const keep = [foe.x, foe.y];
  const mine = bt.units.filter((u) => u.side === "player");
  const far = mine.reduce((m, p) => Math.max(m, p.x), 0) + HEAR_TILES + 1;
  if (far < bt.w) {
    foe.x = far; foe.y = 0;
    const seen = C.playerSees(bt, foe);
    C.fx(bt, { type: "move", unit: foe.id, from: [foe.x, foe.y], path: [[foe.x, foe.y]] });
    s = stepCues(st, mem, 5);
    check(seen ? s.length === 1 : s.length === 0, `an enemy far off and out of sight: ${s.length ? "heard (it is in sight)" : "not heard"}`);
  }
  foe.x = keep[0]; foe.y = keep[1];
  // Unseen but close (here: on the floor above, out of sight): heard, muffled and quieter.
  const hadFloors = bt.floors;
  bt.floors = bt.floors || [{}, {}];
  foe.f = (bt.floor || 0) + 1;
  const up = [foe.x, foe.y];
  foe.x = me.x; foe.y = Math.max(0, me.y - 2);
  C.fx(bt, { type: "move", unit: foe.id, from: [foe.x, foe.y], path: [[foe.x, foe.y]] });
  s = stepCues(st, mem, 5.5);
  check(!C.playerSees(bt, foe) && s.length === 1 && s[0].seen === false && s[0].dist === 2 && s[0].gain < S.STEP_GAIN, "an enemy out of sight but close (upstairs): heard, muffled, its distance known");
  foe.f = 0; bt.floors = hadFloors; foe.x = up[0]; foe.y = up[1];
  // The dead.
  const z = { ...foe, id: 99902, kind: "zombie", ztype: "brute", side: "enemy", x: me.x, y: me.y + 1 };
  bt.units.push(z);
  C.fx(bt, { type: "move", unit: z.id, from: [z.x, z.y], path: [[z.x, z.y]] });
  s = stepCues(st, mem, 6);
  check(s.length === 1 && s[0].dk === "brute" && !s[0].gait, "a brute next to you: a stomp");
  bt.units.pop();
  // A crowd moving in one frame: capped.
  for (const u of bt.units) C.fx(bt, { type: "move", unit: u.id, from: [u.x, u.y], path: path(u, 5) });
  s = stepCues(st, mem, 7);
  check(s.length <= MAX_MOVERS * MAX_STEPS, `everyone moving in one frame: ${s.length} steps (at most ${MAX_MOVERS} movers)`);
  bt.over = true;
  C.fx(bt, { type: "move", unit: me.id, from: [me.x, me.y], path: path(me, 3) });
  check(stepCues(st, mem, 8).length === 0, "the battle over: no steps");
  bt.over = false;
  check(gaitOf(bt, { side: "enemy", mob: 5 }, 7) === "run" && gaitOf(bt, { side: "enemy", mob: 5 }, 4) === "walk", "an enemy's dash runs, a short move walks");
}

// ---------- the rest ----------
console.log("Searches, doors, vehicles, the interface");
{
  check(lootSound("+3 items").name === "rummage" && lootSound("+3 items").found && lootSound("empty").name === "rummage" && !lootSound("empty").found &&
    lootSound("locked").name === "lockRattle" && lootSound("2/5").name === "lockRattle" && lootSound("unlocked").name === "unlock" && lootSound("keys!").name === "jingle" &&
    lootSound("+12 fuel").name === "glug" && lootSound("DEAF") === null && lootSound("RISES") === null, "searches: found, empty, a lock holding, opening, keys, fuel; the dead's effects are not searches");
  const [raid] = battles(36, ["raid-building"]);
  const { st, b } = raid;
  const mem = {};
  check(gearCues(st, mem).length === 0, "a battle first seen: quiet");
  const me = b.units.find((u) => u.side === "player" && !u.dead);
  C.fx(b, { type: "loot", to: [me.x, me.y], text: "+2 items" });
  C.fx(b, { type: "heal", to: [me.x, me.y] });
  let g = gearCues(st, mem).map((c) => c.name);
  check(g.join() === "rummage,bandage", `a search and a bandage: ${g.join(", ")}`);
  const di = b.cells.findIndex((c) => c.k === "idoor");
  if (di >= 0) {
    const x = di % b.w, y = Math.floor(di / b.w);
    b.cells[di].k = "odoor";
    C.fx(b, { type: "move", unit: me.id, from: [me.x, me.y], path: [[x, y]] });
    g = gearCues(st, mem).map((c) => c.name);
    C.fx(b, { type: "move", unit: me.id, from: [me.x, me.y], path: [[x, y]] });
    const again = gearCues(st, mem).map((c) => c.name);
    check(g.join() === "door" && again.length === 0, "a closed door walked through: it creaks open, once");
  } else check(true, "(no closed door on this map)");
  b.vehicle = { x: 3, y: 3 };
  gearCues(st, mem);
  b.vehicle.x = 6;
  check(gearCues(st, mem).map((c) => c.name).join() === "drive", "your vehicle driven: the engine");

  const ui = { started: true };
  const um = {};
  check(uiCues(st, ui, um).length === 0, "the interface first seen: quiet");
  ui.settings = { tab: "options" };
  check(uiCues(st, ui, um).map((c) => c.name).join() === "uiOpen", "a window opens: the swish up");
  ui.settings = null;
  check(uiCues(st, ui, um).map((c) => c.name).join() === "uiClose", "and closes: down");
  ui.inv = { sid: 1 };
  uiCues(st, ui, um);
  ui.invSel = "s:1:weapon";
  const pk = uiCues(st, ui, um);
  check(pk.length === 1 && pk[0].name === "pickup", `an item picked up in the inventory (${pk[0] && pk[0].kind})`);
  ui.invSel = null;
  check(uiCues(st, ui, um).map((c) => c.name).join() === "putdown", "and put down");
  ui.inv = null; uiCues(st, ui, um);
  check(itemKind({ key: "pistol" }) === "gun" && itemKind({ key: "machete" }) === "blade" && itemKind({ key: "vest" }) === "cloth" && itemKind(null) === "item", "items by kind: a gun, a blade, something worn, anything");
  check(clickSound({ dataset: { action: "inv-click" } }) === null && clickSound({ dataset: { action: "speed" } }) === "click", "an inventory cell is not clicked twice over");
  // A team's car setting off on the map.
  const W = await import("../src/sim/world.js");
  const ws = W.createWorld({ seed: 9, factionCount: 3 });
  const V = await import("../src/sim/vehicles.js");
  const party = { id: 777, owner: "player", vehicleId: 4242, path: [1, 2, 3], idx: 0 };
  ws.vehicles = [...(ws.vehicles || []), { id: 4242, type: Object.keys(V.VEHICLE_TYPES).find((k) => k !== "bike"), loc: { kind: "party" } }];
  ws.parties = [...(ws.parties || []), { ...party, path: [] }];
  const wm = {}, wui = { started: true };
  uiCues(ws, wui, wm);
  ws.parties[ws.parties.length - 1].path = party.path;
  const eng = uiCues(ws, wui, wm).map((c) => c.name);
  ws.parties[ws.parties.length - 1].idx = 2;
  const off = uiCues(ws, wui, wm).map((c) => c.name);
  const engine = (l) => l.filter((n) => n.startsWith("engine")).join(); // the doors are their own cues (ui/sfx-vehicles.js mapCues)
  check(engine(eng) === "engineStart" && engine(off) === "engineStop" && eng.includes("carDoor") && off.includes("carDoor"), `a team's car sets off and arrives: ${eng.join()}, ${off.join()}`);
}

// ---------- voices ----------
console.log("Voices");
{
  let bad = [];
  const param = (name, v = 0) => {
    const p = { value: v };
    const fin = (x, what) => { if (!Number.isFinite(x)) bad.push(`${name}.${what}(${x})`); };
    p.setValueAtTime = (x, t) => { fin(x, "set"); fin(t, "setT"); return p; };
    p.linearRampToValueAtTime = (x, t) => { fin(x, "lin"); fin(t, "linT"); return p; };
    p.exponentialRampToValueAtTime = (x, t) => { fin(x, "exp"); if (!(x > 0)) bad.push(`${name}.exp(${x})`); fin(t, "expT"); return p; };
    p.setTargetAtTime = (x) => { fin(x, "tgt"); return p; };
    return p;
  };
  let nodes = 0;
  const node = (extra = {}) => { nodes++; return { connect(d) { if (!d) bad.push("connect(null)"); return d; }, disconnect() {}, ...extra }; };
  const ctx = {
    sampleRate: 8000, currentTime: 0,
    createGain: () => node({ gain: param("gain", 1) }),
    createBiquadFilter: () => node({ type: "", frequency: param("freq", 350), Q: param("Q", 1) }),
    createOscillator: () => node({ type: "", frequency: param("osc", 440), start() {}, stop(t) { if (!Number.isFinite(t)) bad.push("stop"); } }),
    createBufferSource: () => node({ buffer: null, loop: false, playbackRate: param("rate", 1), start(t, off) { if (!Number.isFinite(off) || !Number.isFinite(t)) bad.push("start"); }, stop() {} }),
    createBuffer: (ch, len, rate) => ({ duration: len / rate, getChannelData: () => new Float32Array(len) }),
    createStereoPanner: () => node({ pan: param("pan") }),
  };
  const { VOICES } = AU;
  const errs = [];
  const play = (name, o) => { try { VOICES[name].play(ctx, node(), 0.5, { gain: 1, pitch: 1, ...o }); } catch (e) { errs.push(`${name} ${JSON.stringify(o)}: ${e.message}`); } };
  let n = 0;
  for (const cls of [...MELEE_CLASSES, undefined]) for (const mat of [undefined, "soft", "padding", "hard", "steel", "ceramic", "bone"]) for (const kill of [false, true]) {
    for (const name of ["melee", "meleeCrit"]) { play(name, { cls, w: cls && CLASS[cls].w, mat, through: kill, kill, head: kill }); n++; }
  }
  for (const cls of MELEE_CLASSES) { play("whoosh", { cls, w: CLASS[cls].w }); play("melee", { cls, struct: true, broke: true }); n += 2; }
  for (const surf of ["grass", "dirt", "gravel", "hard", "wet", "wood", "carpet", "mud", "snow", undefined]) for (const gait of ["walk", "run", "sneak"]) for (const load of [0, 3]) { play("step", { surf, gait, load, foot: load ? 1 : 0 }); n++; }
  for (const dk of ["shuffle", "runner", "brute", "crawler", "armoured"]) { play("step", { surf: "hard", dk }); n++; }
  for (const name of ["rummage", "lockRattle", "unlock", "jingle", "glug", "bandage", "door", "drive", "engineStart", "engineStop", "uiOpen", "uiClose", "pickup", "putdown"]) for (const o of [{}, { found: true, kind: "gun", big: true }, { kind: "cloth" }]) { play(name, o); n++; }
  check(!errs.length, `${n} variants of the melee, step and small voices build${errs.length ? `: ${errs.slice(0, 3).join("; ")}` : ""}`);
  check(!bad.length, `no NaN, no ramp to zero, nothing connected to nothing${bad.length ? `: ${bad.slice(0, 5).join(", ")}` : ""}`);
  const own = Object.keys(VOICES).filter((k) => VOICES[k].own);
  check(["melee", "meleeCrit", "whoosh", "step", "door", "bandage", "hearStepBrute", "hearBlade"].every((k) => own.includes(k)) && !VOICES.pistol.own && !VOICES.bite.own, `the new voices play through the output stage (${own.length}); the guns and the dead's are left as they are`);
  const SG = await import("../src/ui/soundgroups.js");
  check(SG.groupOf("step") === "people.steps" && SG.groupOf("hearStepGrass") === "people.steps" && SG.groupOf("melee") === "weapons.melee" && SG.groupOf("rummage") === "people.gear" && SG.groupOf("door") === "people.doors" && SG.groupOf("engineStart") === "people.vehicles", "footsteps answer to the mixer's Footsteps group, blows to Melee, the small sounds to Gear, doors and engines to their own");
  const per = nodes / n;
  check(per < 40, `cheap: ${per.toFixed(1)} nodes a sound on average`);
  // The output stage: panned and muffled, or straight to the bus.
  nodes = 0;
  const bus = node();
  check(O.voiceOut(ctx, O.placeOf({}), bus) === bus && O.voiceOut(ctx, O.placeOf({ pan: 0.5, seen: false, dist: 8 }), bus) !== bus && nodes === 3, "outside battle the output stage is straight through, or a panner and a low-pass");
  nodes = 0;
  const sp = O.voiceOut({ ...ctx, destination: node() }, O.placeOf({ pan: 0.5, seen: false, dist: 8 }), bus, true);
  check(sp !== bus && nodes >= 3, `in battle it is ui/gunsfx.js spatialOut (${nodes} nodes: level, highs cut, pan)`);
  check(O.panOfX({ w: 20 }, 0) < -0.5 && O.panOfX({ w: 20 }, 19) > 0.5 && O.panOfX({ w: 20 }, 9.5) === 0 && O.panOfX(null, 3) === 0, "panned left to right across the field");
}

// ---------- played through audio.js ----------
// A real battle against the dead, both sides played by the AI, heard through audioFrame into a stub offline context
// (audio.js audioDebug.offline): which sounds play, and that the nodes made stay in proportion (none kept alive).
console.log("Played");
{
  const made = { nodes: 0 };
  const P = (v = 0) => ({ value: v, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; }, exponentialRampToValueAtTime() { return this; }, setTargetAtTime() { return this; } });
  const N = (x = {}) => { made.nodes++; return { connect: (d) => d, disconnect() {}, ...x }; };
  class OAC {
    constructor(ch, len, rate) { this.sampleRate = rate; this.currentTime = 0; this.state = "running"; this.destination = N(); this.len = len; }
    createGain() { return N({ gain: P(1) }); }
    createBiquadFilter() { return N({ type: "", frequency: P(350), Q: P(1) }); }
    createOscillator() { return N({ type: "", frequency: P(440), start() {}, stop() {} }); }
    createBufferSource() { return N({ buffer: null, loop: false, playbackRate: P(1), start() {}, stop() {} }); }
    createBuffer(ch, len, rate) { return { duration: len / rate, getChannelData: () => new Float32Array(len) }; }
    createStereoPanner() { return N({ pan: P() }); }
    createDynamicsCompressor() { return N({ threshold: P(), knee: P(), ratio: P(), attack: P(), release: P() }); }
    createConvolver() { return N({ buffer: null, normalize: true }); }
    async startRendering() { return { getChannelData: () => new Float32Array(16) }; }
  }
  const hadW = globalThis.window, hadD = globalThis.document;
  globalThis.window = { OfflineAudioContext: OAC, addEventListener() {} };
  globalThis.document = { hidden: false, hasFocus: () => true, addEventListener() {}, getElementById: () => null };
  let err = "";
  const played = [];
  let perSound = 0;
  const fight = [];
  try {
    AU.initAudio({ sound: { master: 0.7, sfx: 0.8, amb: 0.5, steps: 0.7, mute: false, muteBlur: false } }, () => {});
    const [forest] = battles(37, ["field-forest"]);
    const { st, b } = forest;
    for (const u of b.units) if (u.side === "player") { u.weapon = ["bat", "machete", "fireaxe", "fists"][u.id % 4]; u.loadBand = u.id % 4; }
    const off = AU.audioDebug.offline(60);
    const ui = { started: true };
    let ms = 1000;
    AU.audioFrame(st, ui, ms);
    for (let turn = 0; turn < 8 && !b.over; turn++) {
      C.autoPlayerTurn(st);
      for (let k = 0; k < 3; k++) { off.ctx.currentTime += 0.2; AU.audioFrame(st, ui, (ms += 200)); played.push(...AU.audioDebug.played.splice(0)); }
      if (b.phase === "player") C.combatAct(st, { type: "end" });
      if (b.phase === "enemy") C.runEnemyPhase(st);
      for (let k = 0; k < 3; k++) { off.ctx.currentTime += 0.2; AU.audioFrame(st, ui, (ms += 200)); played.push(...AU.audioDebug.played.splice(0)); }
    }
    perSound = made.nodes / Math.max(1, played.length);
    await off.finish();
    // A firefight with raiders: the shots are still heard with everyone moving (footsteps have their own budget).
    const [town] = battles(38, ["field-town"]);
    const off2 = AU.audioDebug.offline(60);
    off2.ctx.currentTime = 100; // the throttle remembers the first context's clock
    AU.audioFrame(town.st, ui, (ms += 200));
    for (let turn = 0; turn < 6 && !town.b.over; turn++) {
      C.autoPlayerTurn(town.st);
      for (let k = 0; k < 3; k++) { off2.ctx.currentTime += 0.2; AU.audioFrame(town.st, ui, (ms += 200)); fight.push(...AU.audioDebug.played.splice(0)); }
      if (town.b.phase === "player") C.combatAct(town.st, { type: "end" });
      if (town.b.phase === "enemy") C.runEnemyPhase(town.st);
      for (let k = 0; k < 3; k++) { off2.ctx.currentTime += 0.2; AU.audioFrame(town.st, ui, (ms += 200)); fight.push(...AU.audioDebug.played.splice(0)); }
    }
    await off2.finish();
  } catch (e) { err = e.stack; }
  globalThis.window = hadW; globalThis.document = hadD;
  if (hadW === undefined) delete globalThis.window;
  if (hadD === undefined) delete globalThis.document;
  const kinds = [...new Set(played.map((n) => n.split(":")[0]))];
  check(!err, `eight turns heard through audioFrame${err ? `: ${err}` : ""}`);
  check(played.some((n) => n.startsWith("step:")), `footsteps play (${played.filter((n) => n.startsWith("step:")).length}: ${[...new Set(played.filter((n) => n.startsWith("step:")))].slice(0, 6).join(", ")})`);
  check(played.some((n) => /^step:.*(shuffle|runner|brute|crawler)/.test(n)), "the dead's steps too (AI parity)");
  check(played.some((n) => /^(melee|meleeCrit|whoosh):(wood|blade|chop|punch)/.test(n)), `your blows by weapon class (${[...new Set(played.filter((n) => /^(melee|whoosh)/.test(n)))].slice(0, 6).join(", ")})`);
  const guns = fight.filter((n) => /^(pistol|revolver|rifle|shotgun|auto|suppressed|bow|launcher|rocket)/.test(n));
  check(guns.length > 0 && fight.some((n) => n.startsWith("step:")), `a firefight: ${guns.length} shots heard with ${fight.filter((n) => n.startsWith("step:")).length} footsteps (${[...new Set(fight.map((n) => n.split(":")[0]))].join(", ")})`);
  check(perSound < 40, `about ${perSound.toFixed(1)} nodes a sound (${played.length} sounds: ${kinds.join(", ")})`);
}

// ---------- options ----------
console.log("Options");
{
  const s = AU.soundOptions({});
  const o4 = AU.soundOptions({ sound: { steps: 4 } }), o0 = AU.soundOptions({ sound: { steps: 0 } }), o35 = AU.soundOptions({ sound: { steps: 0.35 } });
  check(!s.groups["people.steps"] && Math.abs(o4.groups["people.steps"] - 1 / 0.7) < 1e-3 && o0.groups["people.steps"] === 0 && Math.abs(o35.groups["people.steps"] - 0.5) < 1e-9, "an old Footsteps volume becomes the Footsteps group (70% → 100%, clamped, 0 kept: off)");
  AU.soundMixer.open = true;
  const html = AU.soundOptionsHtml({ sound: { ...s, groups: { "people.steps": 0.4 } } });
  AU.soundMixer.open = false;
  check(/value="40" data-action="snd-grp" data-g="people.steps"/.test(html) && /Footsteps/.test(html), "the Footsteps group in the Advanced mixer");
  check(/Footsteps: a brute/.test(html) && /Melee: blade/.test(html) && /Searching a container/.test(html), "Hear lists the new sounds");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
