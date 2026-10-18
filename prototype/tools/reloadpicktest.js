// Physical rounds and the Reload picker (2026-10-18 user rules, docs/reload-rules.md; src/sim/mags.js, roundstack.js,
// ammo.js takeBattleRounds, combat.js reload / invAct, gunload.js returnStacks, stealth.js emptymag, kitcheck.js). Checks:
//   - a Reload draws only on the shooter's own pockets, rig and pack: a teammate's box and the team's bags (a base's
//     stock) are never a source, and the rounds leave the item as they go in (6 in, 6 fewer in the pocket; 3 in a
//     half-empty tube, 3 fewer);
//   - loose rounds: up to 6 a Reload whatever the gun (an 8-shell tube from empty: 6 then 2; a box magazine topped up
//     by hand the same), a pocket or the rig 1 action, the pack both;
//   - the picker (reloadOptions): every spare magazine and every round stack on them; a pick of rounds in an order
//     loads them in that order (the first picked is in the chamber: u.load follows it shot by shot);
//   - a magazine holds an assortment (loaded by hand in the Inventory window, 6 a time); a swap is physical (the fresh
//     one is the gun's fitted magazine, the other goes where it lay with what it had); unloading one by hand puts
//     every round in it back loose, each kind its own stack;
//   - the fight's start fills the gun and the spares out of the person's own rounds, then the team's bags; the fight's
//     end puts what is left back onto the person; the side's total is the same throughout; a save in the middle keeps
//     the stacks; the AI reloads from its own rounds only;
//   - an empty spare magazine is a throwable lure (emptymag), picked up again after a win;
//   - the kit check before the first move: an empty gun (with the rounds for it on them or not), no healing, the hurt.
// Usage: node tools/reloadpicktest.js [seed]
import { setRounds, giveRounds, sideRounds, totalRounds } from "../src/sim/ammo.js";
import { ammoKey } from "../src/sim/data-ammo.js";
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, loadMag, reloadRefusal, reloadCost, magIn, magEmpty, autoPlayerTurn, ammoLeft, refitKit, shotOdds } from "../src/sim/combat.js";
import { newItem, packOf, rigPouches, carriedSpots } from "../src/sim/inventory.js";
import { roundItem } from "../src/sim/itemstack.js";
import { reloadPlan, reloadOptions, roundSources, unloadMagPlan, isStacked, MAGS, magEntryAt, fittedMag, migrateUnitStacks } from "../src/sim/mags.js";
import { stackN, stackText } from "../src/sim/roundstack.js";
import { returnStacks } from "../src/sim/gunload.js";
import { gunRounds } from "../src/sim/gunrounds.js";
import { throwablesOf } from "../src/sim/stealth.js";
import { kitWarnings, kitWarnDue } from "../src/sim/kitcheck.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { starterMags } from "../src/sim/carrykit.js";
import { launchExpedition } from "../src/sim/parties.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { raidMove } from "../src/sim/raidloot.js";
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };

const seed = Number(process.argv[2] || 11);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("rltest", () => {});
const K357 = ammoKey("357", "fmj"), KBUCK = ammoKey("12ga", "buck"), KSLUG = ammoKey("12ga", "slug"), K556 = ammoKey("556", "fmj"), K556AP = ammoKey("556", "ap");

function fighter(state, weapon, mags = false) {
  const s = makeSurvivor(state);
  s.skills.shooting = 8;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  if (mags && s.gear.weapon) starterMags(s);
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew, stock = {}) {
  const h = hub(state);
  setRounds(h.stock, 0);
  for (const [k, v] of Object.entries(stock)) h.stock[k] = v;
  h.stock.meds = stock.meds || 0; h.stock.arrows = 0;
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "rltest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
const foe = (b) => b.units.find((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; };
const toughen = (u) => { u.hp = u.maxHp = 100000; };
const keepFoe = (b) => { const e = foe(b); place(e, 18, 12); toughen(e); e.aware = false; return e; }; // someone left on the map: the fight goes on
const lastLog = (b) => (b.log.length ? b.log[b.log.length - 1].text : "");
const loose = (s, key) => carriedSpots(s).filter((x) => x.item.key === key && x.item.loose).reduce((a, x) => a + Math.floor(x.item.dur), 0);
const turn = (b, u) => { b.phase = "player"; u.ap = 2; };

// 1. Only the shooter's own rounds; the rounds leave the item.
{
  console.log("Only what the shooter carries");
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "revolver"), c = fighter(st, "revolver");
  c.pockets[0] = roundItem(K357, 40, true); // the teammate's pocket
  const b = openBattle(st, [a, c], { [K357]: 200 });
  const u = by(b, a), v = by(b, c);
  keepFoe(b);
  check(isStacked(u) && u.mag === 6 && stackN(u.stack) === 6 && u.load === "fmj", `the revolver takes the field loaded (6/6) out of the base's stock: ${u.mag}, stack ${stackText("357", u.stack)}`);
  check(v.mag === 6 && c.pockets[0].dur === 34, `the teammate's cylinder filled out of their own pocket first (${c.pockets[0].dur} left of 40)`);
  const total0 = sideRounds(b);
  turn(b, u); loadMag(u, 0);
  check(u.mag === 0 && stackN(u.stack) === 0 && magEmpty(b, u), "emptied: 0/6");
  check(/No ammo to load.*on them/.test(reloadRefusal(b, u)) && combatAct(st, { type: "reload", unit: u.id }) !== "" && u.ap === 2, `nothing on them: refused, nothing spent ("${reloadRefusal(b, u)}")`);
  check(/stock/.test(reloadRefusal(b, u)) && /teammates/.test(reloadRefusal(b, u)), "the refusal says where the rounds are (the stock, a teammate)");
  check(c.pockets[0].dur === 34 && hub(st).stock[K357] === 200 - 6, "the teammate's box and the stock are untouched (the stock gave the first 6 at the start)");
  a.pockets[0] = roundItem(K357, 10, true);
  refitKit(b, u, a); turn(b, u); // (a refit: the rounds count)
  const p = reloadPlan(b, u);
  check(p.mode === "rounds" && p.n === 6 && p.cost === 1 && p.from === "hand" && p.runs.length === 1 && p.runs[0].where === "pocket", `10 loose in a pocket: the plan loads 6 from the pocket for 1 action (${p.mode} ${p.n} from ${p.from}, ${p.cost})`);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 1 && u.mag === 6 && loose(a, K357) === 4, `Reload: 6 in, 4 left in the pocket (${u.mag}/6, ${loose(a, K357)} left)`);
  check(/reloads the \.357 revolver: 6 \.357 Magnum FMJ from a pocket \(6\/6\)/.test(lastLog(b)), `the log: "${lastLog(b)}"`);
  const e = foe(b); place(u, 5, 5); place(e, 9, 5);
  for (let i = 0; i < 3; i++) { turn(b, u); combatAct(st, { type: "shoot", unit: u.id, target: e.id }); }
  check(u.mag === 3 && loose(a, K357) === 4, `three shots: 3/6, the pocket still 4 (the shots came out of the cylinder)`);
  turn(b, u);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.mag === 6 && loose(a, K357) === 1, `a half-empty cylinder takes 3 and 3 leave the pocket (${u.mag}/6, ${loose(a, K357)} left)`);
  check(sideRounds(b) === total0 - 6 + 10 - 3, `the side's rounds: ${total0} at the start, 6 thrown away by the test, 10 added, 3 shot: ${sideRounds(b)} (nothing counted twice)`);
  turn(b, u); loadMag(u, 0);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.mag === 1 && loose(a, K357) === 0 && !a.pockets.some((x) => x && x.key === K357), "the last round goes in and the emptied stack is thrown away");
  check(/No ammo to load/.test(reloadRefusal(b, u)), "then nothing to load again");
}

// 2. Six a Reload; the pack for both actions.
{
  console.log("Six a Reload");
  const st = createWorld({ seed: seed + 1, factionCount: 4 });
  const a = fighter(st, "shotgun");
  a.gear.weapon.mods = { mag: newItem("tubeext") }; // +2 shells: an 8-shell tube
  const b = openBattle(st, [a], { [KBUCK]: 100 });
  const u = by(b, a);
  keepFoe(b);
  const box = a.pockets.find((x) => x && x.key === KBUCK);
  check(u.magMax === 8 && u.mag === 8 && box && box.dur === 30 - 8, `the base's shotgunner: 30 shells out of the stock in a pocket, the 8-shell tube filled from them (${box && box.dur} left)`);
  turn(b, u); loadMag(u, 0);
  check(reloadPlan(b, u).n === 6 && combatAct(st, { type: "reload", unit: u.id }) === "" && u.mag === 6 && box.dur === 16 && u.ap === 1, `from empty: 6 in for 1 action (${u.mag}/8, ${box.dur} in the pocket)`);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.mag === 8 && box.dur === 14 && u.ap === 0, `the second Reload fills the last 2 (${u.mag}/8, ${box.dur} in the pocket)`);
  check(/full/.test(reloadRefusal(b, u)), "full: refused");
  // The pack: both actions.
  turn(b, u); loadMag(u, 0);
  a.pockets[a.pockets.indexOf(box)] = null;
  a.gear.backpack = newItem("assaultpack");
  packOf(a)[0] = roundItem(KBUCK, 20);
  refitKit(b, u, a); turn(b, u); // (a refit)
  const p = reloadPlan(b, u);
  check(p.cost === 2 && p.from === "pack" && p.n === 6, `shells in the pack only: 6 for both actions (${p.n} from ${p.from}, ${p.cost})`);
  u.ap = 1;
  check(/both actions/.test(reloadRefusal(b, u)) && combatAct(st, { type: "reload", unit: u.id }) !== "" && u.mag === 0, "with one action left: refused");
  turn(b, u);
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.ap === 0 && u.mag === 6 && packOf(a)[0].dur === 14, `with both: 6 in, 14 left in the pack (${lastLog(b)})`);
  turn(b, u);
  check(/nothing to get/.test(combatAct(st, { type: "getshells", unit: u.id })) && u.ap === 2, "Get shells is gone for your people: shells load straight in");
}

// 3. The picker: an order of rounds, the chamber first.
{
  console.log("The picker");
  const st = createWorld({ seed: seed + 2, factionCount: 4 });
  const a = fighter(st, "shotgun");
  a.gear.rig = newItem("chestrig");
  a.gear.backpack = newItem("assaultpack");
  const b = openBattle(st, [a], { [KBUCK]: 100 });
  const u = by(b, a);
  keepFoe(b);
  a.pockets[1] = roundItem(KSLUG, 10, true);
  packOf(a)[0] = roundItem(KSLUG, 5, true);
  refitKit(b, u, a); turn(b, u); loadMag(u, 0);
  const o = reloadOptions(b, u);
  const slugP = o.rounds.find((r) => r.k === KSLUG && r.where === "pocket"), buckP = o.rounds.find((r) => r.k === KBUCK && r.where === "pocket"), slugK = o.rounds.find((r) => r.k === KSLUG && r.where === "pack");
  check(!o.box && o.per === 6 && o.room === 6 && o.rounds.length === 3 && slugP && buckP && slugK && slugP.cost === 1 && slugK.cost === 2, `the picker lists every stack on them with its place and cost: ${o.rounds.map((r) => `${r.short} ×${r.n} ${r.where} ${r.cost}`).join("; ")}`);
  const bad = reloadPlan(b, u, { rounds: [{ i: slugP.i, n: 4 }, { i: buckP.i, n: 4 }] });
  check(/Up to 6/.test(bad.why), `8 picked: refused ("${bad.why}")`);
  const plan = reloadPlan(b, u, { rounds: [{ i: slugP.i, n: 2 }, { i: buckP.i, n: 4 }] });
  check(!plan.why && plan.n === 6 && plan.cost === 1 && plan.load === "slug", `2 slugs then 4 buckshot: 6 for 1 action, the chamber a slug (${plan.load})`);
  check(combatAct(st, { type: "reload", unit: u.id, rounds: [{ i: slugP.i, n: 2 }, { i: buckP.i, n: 4 }] }) === "" && u.mag === 6 && u.load === "slug" && stackText("12ga", u.stack) === "12 gauge slug ×2, 12 gauge 00 buckshot ×4", `loaded in that order: ${stackText("12ga", u.stack)}; chamber ${u.load}`);
  check(loose(a, KSLUG) === 10 - 2 + 5 && a.pockets.find((x) => x && x.key === KBUCK).dur === 30 - 6 - 4, "2 slugs left the pocket's slugs, 4 shells the box");
  const e = foe(b); place(u, 5, 5); place(e, 8, 5);
  turn(b, u); combatAct(st, { type: "shoot", unit: u.id, target: e.id });
  check(u.mag === 5 && u.load === "slug", "one shot: a slug fired, a slug in the chamber still");
  turn(b, u); combatAct(st, { type: "shoot", unit: u.id, target: e.id });
  check(u.mag === 4 && u.load === "buck" && stackText("12ga", u.stack) === "12 gauge 00 buckshot ×4", `the second slug fired: buckshot in the chamber now (${u.load})`);
  const mixed = reloadPlan(b, u, { rounds: [{ i: slugK.i, n: 1 }, { i: slugP.i, n: 1 }] });
  check(mixed.cost === 2 && mixed.from === "pack", "a pick with any of the pack's in it: both actions");
  turn(b, u);
  check(combatAct(st, { type: "reload", unit: u.id, rounds: [{ i: slugP.i, n: 2 }] }) === "" && u.mag === 6 && u.load === "slug" && stackText("12ga", u.stack) === "12 gauge slug ×2, 12 gauge 00 buckshot ×4", "2 more slugs on top of the buckshot: the chamber a slug again");
}

// 4. Magazines: an assortment, a physical swap, unloading by hand.
{
  console.log("Magazines");
  const st = createWorld({ seed: seed + 3, factionCount: 4 });
  const a = fighter(st, "ar");
  a.pockets[0] = Object.assign(newItem("mag_stanag_30"), { unloaded: true }); // kept empty (itemacts.js)
  a.pockets[1] = roundItem(K556, 40, true);
  a.pockets[2] = roundItem(K556AP, 12, true);
  const b = openBattle(st, [a], { [K556]: 100 });
  const u = by(b, a);
  keepFoe(b);
  const sp = u.mags.find((m) => m.where !== "gun");
  check(u.magMode === "box" && u.mag === 30 && sp && sp.item === a.pockets[0] && sp.n === 0 && a.pockets[1].dur === 10, `the rifle fills 30 out of the pocket's loose 40 (10 left); the Unloaded spare stays empty (${sp && sp.n})`);
  turn(b, u);
  const loc = `s:${a.id}:pocket:0`;
  check(combatAct(st, { type: "inv", unit: u.id, from: `s:${a.id}:pocket:1`, to: loc }) === "" && u.ap === 1 && sp.n === 6 && a.pockets[1].dur === 4, `loose FMJ dropped onto the spare: 6 go in for 1 action (${sp.n}/30, ${a.pockets[1].dur} left)`);
  check(combatAct(st, { type: "inv", unit: u.id, from: `s:${a.id}:pocket:2`, to: loc }) === "" && u.ap === 0 && u.mags.find((m) => m.item === a.pockets[0]).n === 12 && stackText("556", a.pockets[0].stack) === "5.56 NATO armour-piercing ×6, 5.56 NATO FMJ ×6", `then AP on top: an assortment (${stackText("556", a.pockets[0].stack)})`);
  const g = gunRounds(st, a.pockets[0], loc);
  check(g && g.n === 12 && g.src === "fight" && g.load === "ap", `the badge reads the magazine's stack (${g && g.n}/${g && g.cap}, ${g && g.load})`);
  turn(b, u); loadMag(u, 3);
  const j = u.mags.findIndex((m) => m.item === a.pockets[0]); // (the entries are rebuilt after each load: the old entry object is stale)
  const plan = reloadPlan(b, u, { mag: j });
  check(plan.mode === "swap" && plan.cost === 1 && plan.n === 12 && !plan.why, "the picker's swap: 1 action from a pocket, 12 rounds");
  const gun = a.gear.weapon;
  const fresh = a.pockets[0];
  check(combatAct(st, { type: "reload", unit: u.id, mag: j }) === "" && u.ap === 1 && u.mag === 12 && u.load === "ap" && fittedMag(gun) === fresh, `swapped in: 12/30 with AP in the chamber (${u.mag}, ${u.load}); the fresh magazine is the gun's fitted one now`);
  const left = a.pockets[0];
  check(left !== fittedMag(gun) && left && left.key === "mag_stanag_30" && stackN(left.stack) === 3, `the gun's own standard magazine came out into the pocket with its 3 rounds (${left && stackN(left.stack)})`);
  check(u.mags.find((m) => m.where === "gun").key === "mag_stanag_30" && u.mags.some((m) => m.where === "pocket" && m.item === left && m.n === 3), "the entries follow: the gun's and the pocket's");
  const e = foe(b); place(u, 5, 5); place(e, 9, 5);
  turn(b, u); combatAct(st, { type: "shoot", unit: u.id, target: e.id });
  check(u.mag === 10 && u.load === "ap", "a burst: 2 AP gone, AP still in the chamber");
  // Unload the pocket's magazine by hand.
  turn(b, u);
  const m2 = magEntryAt(u, carriedSpots(a), loc);
  check(m2 && unloadMagPlan(b, u, m2).n === 3, "unloading the pocket's magazine: 3 rounds");
  const before = loose(a, K556);
  check(combatAct(st, { type: "inv", unit: u.id, from: loc, op: "unload" }) === "" && u.ap === 1 && loose(a, K556) === before + 3 && stackN(left.stack) === 0 && left.unloaded, `unloaded: 3 loose FMJ onto them (${loose(a, K556)}), the magazine empty (and kept so)`);
  check(/unloads the .* magazine .* in a pocket: 5\.56 NATO FMJ ×3 into their pockets and pack/.test(lastLog(b)), `the log: "${lastLog(b)}"`);
  // An empty spare is a throwable lure.
  const have = throwablesOf(st, b, u);
  check(have.emptymag === 1, `an empty spare magazine can be thrown (${JSON.stringify(have)})`);
  turn(b, u);
  const magsBefore = u.mags.length;
  check(combatAct(st, { type: "throw", unit: u.id, item: "emptymag", x: 5, y: 10 }) === "" && u.ap === 1 && !a.pockets.includes(left) && b.lures.some((l) => l.key === "emptymag") && b.thrown.length === 1 && u.mags.length === magsBefore - 1, `thrown: a lure where it lands, the magazine gone from the pocket, the unit's magazines refit (${lastLog(b)})`);
  check(!throwablesOf(st, b, u).emptymag, "nothing more to throw");
  // The swap when the gun has rounds: the other keeps them.
  turn(b, u);
  const spare2 = Object.assign(newItem("mag_stanag_30"), { stack: [{ k: K556, n: 20 }] });
  a.pockets[3] = spare2;
  refitKit(b, u, a); turn(b, u);
  const j2 = u.mags.findIndex((m) => m.item === spare2);
  check(j2 > 0 && combatAct(st, { type: "reload", unit: u.id, mag: j2 }) === "" && u.mag === 20 && u.load === "fmj" && a.pockets[3] && a.pockets[3] !== spare2 && stackN(a.pockets[3].stack) === 10 && fittedMag(gun) === spare2, `a swap with 10 AP still in the gun: 20 FMJ in, the AP magazine in the pocket with its 10`);
}

// 5. The fight's end, the side's total, a save in the middle, the AI.
{
  console.log("The end, a save, the AI");
  const st = createWorld({ seed: seed + 4, factionCount: 4 });
  const a = fighter(st, "pistol", true), c = fighter(st, "leverrifle");
  a.pockets[3] = roundItem(ammoKey("9mm", "fmj"), 20, true);
  const b = openBattle(st, [a, c], { [ammoKey("9mm", "fmj")]: 100, [ammoKey("3030", "fmj")]: 50 });
  const u = by(b, a), v = by(b, c);
  keepFoe(b);
  const total0 = sideRounds(b);
  check(u.mag === 15 && u.mags.filter((m) => m.where !== "gun").every((m) => m.n === m.cap), "the pistol and its starter magazines take the field full");
  check(total0 === 100 + 50 + 20 - 0 || total0 === ammoLeft(b), `the side's rounds: ${total0} (bags, pockets, guns and magazines, counted once)`);
  // A save in the middle keeps the stacks.
  turn(b, u); loadMag(u, 9);
  const st2 = loadFromString(saveToString(st));
  const b2 = st2.combat, u2 = b2.units.find((x) => x.sid === a.id);
  check(isStacked(u2) && u2.mag === 9 && stackN(u2.stack) === 9 && u2.mags.filter((m) => m.where !== "gun").every((m) => m.item && Array.isArray(m.item.stack) && m.n === m.cap), "a save and load: the gun's 9 and the magazines' stacks are there");
  check(combatAct(st2, { type: "reload", unit: u2.id }) === "" && u2.mag === 15, "and Reload works on the loaded battle (a fresh magazine)");
  // The AI reloads only from its own rounds.
  const e = foe(b); place(u, 5, 5); place(v, 5, 7); place(e, 10, 5); e.aware = true;
  turn(b, v); loadMag(v, 0);
  check(/No ammo to load/.test(reloadRefusal(b, v)), "the lever-action with nothing on them: no reload for the AI either");
  c.pockets[0] = roundItem(ammoKey("3030", "fmj"), 12, true);
  refitKit(b, v, c);
  b.phase = "player"; for (const x of b.units) if (x.side === "player") x.ap = 2;
  st.autoRetreat = false; // (the AI would sound the retreat against an unkillable foe: retreattest.js)
  autoPlayerTurn(st);
  check(b.log.some((l) => new RegExp(`${c.name} reloads the lever-action rifle: 6 `).test(l.text)) && magIn(v) >= 4 && loose(c, ammoKey("3030", "fmj")) === 6, `the AI: 6 in from the pocket (${magIn(v)}/6, ${loose(c, ammoKey("3030", "fmj"))} left)`);
  // The end: what is left goes back onto the person.
  const boxes0 = loose(a, ammoKey("9mm", "fmj"));
  const inGuns = stackN(u.stack) + u.mags.filter((m) => m.where !== "gun").reduce((s, m) => s + m.n, 0);
  const n = returnStacks(b, [a], hub(st).stock);
  check(n === inGuns && loose(a, ammoKey("9mm", "fmj")) === boxes0 + inGuns && u.mags.filter((m) => m.where !== "gun").every((m) => !Array.isArray(m.item.stack)), `the fight over: the ${inGuns} rounds in the gun and the magazines are loose on them again (${loose(a, ammoKey("9mm", "fmj"))}), the magazines' stacks gone`);
  b.over = true; // (as groundEnd leaves it)
  const g = gunRounds(st, a.gear.weapon, `s:${a.id}:weapon`);
  check(g && g.n === 15 && g.src === "ready", `out of the fight the badge fills the gun from the rounds to hand as before (${g && g.n}/${g && g.cap})`);
}

// 6. The kit check before the first move.
{
  console.log("The kit check");
  const st = createWorld({ seed: seed + 5, factionCount: 4 });
  const a = fighter(st, "pistol"), c = fighter(st, "shotgun");
  a.pockets[0] = roundItem(ammoKey("9mm", "fmj"), 30, true);
  const b = openBattle(st, [a, c], {}); // no rounds, no meds in the stock
  const u = by(b, a), v = by(b, c);
  const w = kitWarnings(st, b);
  check(kitWarnDue(st, b) && w.any && w.empty.length === 1 && w.empty[0].uid === v.id && /no rounds for it/.test(w.empty[0].text), `the shotgun is empty with nothing for it: ${w.empty.map((e) => e.text).join(" | ")}`);
  check(u.mag === 15 && !w.empty.some((e) => e.uid === u.id), "the pistol filled 15 out of the pocket: not empty");
  check(/No healing on the team/.test(w.heal), `no meds, no kits: "${w.heal}"`);
  loadMag(u, 0);
  const w2 = kitWarnings(st, b);
  check(w2.empty.some((e) => e.uid === u.id && /15 9mm rounds for it in a pocket/.test(e.text) && /Reload it in the Inventory/.test(e.text)), `emptied with rounds on them: "${w2.empty.find((e) => e.uid === u.id).text}"`);
  u.hp = 30;
  check(kitWarnings(st, b).hurt.some((h) => h.uid === u.id && h.hp === 30), "hurt below 50 hp is listed");
  b.kitWarnSeen = true;
  check(!kitWarnDue(st, b), "Proceed puts it aside");
  b.kitWarnSeen = false; hub(st).stock.meds = 3;
  check(!kitWarnings(st, b).heal, "meds in the bags: no healing warning");
}

// 7. A battle saved before physical rounds: brought over on load.
{
  console.log("An old save");
  const st = createWorld({ seed: seed + 6, factionCount: 4 });
  const a = fighter(st, "pistol", true);
  a.pockets[3] = roundItem(ammoKey("9mm", "fmj"), 50, true);
  const b = openBattle(st, [a], { [ammoKey("9mm", "fmj")]: 100 });
  const u = by(b, a);
  // Undo the physical model by hand: the old counters, no stacks (as a save from before would come back).
  returnStacks(b, [a], hub(st).stock);
  u.stack = undefined; u.mag = 9; for (const m of u.mags) if (m.where !== "gun") { m.n = 7; delete m.item; delete m.list; }
  const st2 = loadFromString(saveToString(st));
  const u2 = st2.combat.units.find((x) => x.sid === a.id);
  check(isStacked(u2) && u2.mag === 9 && stackN(u2.stack) === 9 && u2.mags.filter((m) => m.where !== "gun").every((m) => m.n === 7), `migrated on load: 9 in the gun, 7 in each spare, out of what they carry (${u2.mag}; ${u2.mags.filter((m) => m.where !== "gun").map((m) => m.n).join(",")})`);
  void migrateUnitStacks;
}

// 8. In a raid: the search window loads a spare magazine from rounds dropped onto it, unloads one, and the Reload picker
// works (2026-10-18 user request: "you can load and reload magazines during raids").
{
  console.log("In a raid");
  const st = createWorld({ seed: seed + 7, factionCount: 4 });
  const h = hub(st);
  const a = fighter(st, "ar");
  a.pockets[0] = Object.assign(newItem("mag_stanag_30"), { unloaded: true });
  a.pockets[1] = roundItem(K556, 50, true); // (the raid's start fills the rifle out of these first: 30, 20 left)
  const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && st.grid.distance(t.id, h.tile) > 1);
  setRounds(h.stock, 0); giveRounds(h.stock, 100, ["ar"]); h.stock.food = 50; h.stock.water = 50;
  const res = launchExpedition(st, { memberIds: [a.id], dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 1 } });
  if (res.error) check(false, `raid team launched (${res.error})`);
  else {
    const pt = res.party;
    pt.path = [tile.id]; pt.idx = 0; pt.phase = "engaged";
    const b = inBrowser(() => (st.combat = createBattle(st, { mode: "raid", tile: tile.id, partyId: pt.id, canRetreat: true, ambush: null, handler: "rltest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile.id) }, raid: { heat0: 5 }, context: {} })));
    if (b.raid && b.raid.choose) b.raid.choose = null;
    const u = b.units.find((x) => x.side === "player");
    for (const x of b.units) if (x.side !== "player") x.aware = false;
    b.phase = "player"; u.ap = 2;
    const magLoc = `s:${a.id}:pocket:0`;
    const loose = carriedSpots(a).find((x) => x.item && x.item.key === K556 && x.item.loose);
    check(isStacked(u) && u.mag === 30 && !!loose && loose.item.dur === 20, `the raid's unit has physical rounds: 30 in the rifle out of the pocket's 50 (${u.mag}/30; loose 5.56 on them: ${loose ? loose.item.dur : 0})`);
    const n0 = loose.item.dur;
    const err = raidMove(st, u.id, loose.loc, magLoc);
    const sp = u.mags.find((m) => m.item === a.pockets[0]);
    check(err === "" && u.ap === 1 && sp && sp.n === Math.min(6, n0) && loose.item.dur === n0 - Math.min(6, n0), `the search window: rounds dropped onto the spare load it (${sp && sp.n}/30 for 1 action; ${loose.item.dur} left)`);
    check(combatAct(st, { type: "inv", unit: u.id, from: magLoc, op: "unload" }) === "" && u.ap === 0 && u.mags.find((m) => m.item === a.pockets[0]).n === 0, "and Unload empties it again by hand");
    b.phase = "player"; u.ap = 2; loadMag(u, 10);
    const o = reloadOptions(b, u);
    const r = o.rounds.find((x) => x.k === K556 && x.where === "pocket");
    check(o.box && r && combatAct(st, { type: "reload", unit: u.id, rounds: [{ i: r.i, n: 6 }] }) === "" && u.mag === 16, `the Reload picker in a raid: 6 by hand into the magazine in the gun (${u.mag}/30)`);
  }
}

// 9. An over/under with two kinds in its barrels (the user's example: one slug, one birdshot): each shot is its own
// round's (damage, range, accuracy: combat.js shotOdds reads the chamber's load).
{
  console.log("An over/under: a slug and a birdshot");
  const st = createWorld({ seed: seed + 8, factionCount: 4 });
  const a = fighter(st, "ou12");
  a.pockets[1] = roundItem(KSLUG, 10, true);
  a.pockets[2] = roundItem(ammoKey("12ga", "bird"), 10, true);
  const b = openBattle(st, [a], { [KBUCK]: 40 });
  const u = by(b, a);
  const e = keepFoe(b);
  check(u.magMax === 2 && u.mag === 2 && u.load === "buck", `the barrels take the field with 2 buckshot out of the stock (${u.mag}/${u.magMax}, ${u.load})`);
  turn(b, u); loadMag(u, 0);
  const o = reloadOptions(b, u);
  const slug = o.rounds.find((r) => r.k === KSLUG), bird = o.rounds.find((r) => r.k === ammoKey("12ga", "bird"));
  check(slug && bird && combatAct(st, { type: "reload", unit: u.id, rounds: [{ i: slug.i, n: 1 }, { i: bird.i, n: 1 }] }) === "" && u.mag === 2 && u.load === "slug" && stackText("12ga", u.stack) === "12 gauge slug ×1, 12 gauge birdshot ×1", `one slug then one birdshot in the barrels: ${stackText("12ga", u.stack)}; the slug fires first`);
  place(u, 5, 5); place(e, 10, 5);
  const mid = (d) => (d[0] + d[1]) / 2;
  const osl = shotOdds(b, u, e);
  turn(b, u); combatAct(st, { type: "shoot", unit: u.id, target: e.id });
  check(u.mag === 1 && u.load === "bird", `the slug fired: birdshot in the chamber now (${u.load})`);
  const obi = shotOdds(b, u, e);
  check(mid(osl.dmg) > mid(obi.dmg) * 1.3 && (osl.chance !== obi.chance || mid(osl.dmg) !== mid(obi.dmg)), `the two shots differ: the slug ${osl.chance}% for ${osl.dmg.join("–")}, the birdshot ${obi.chance}% for ${obi.dmg.join("–")} at 5 tiles`);
  place(e, 16, 5);
  const far = shotOdds(b, u, e);
  u.stack = [{ k: KSLUG, n: 1 }]; u.load = "slug"; loadMag(u, 1);
  const farSlug = shotOdds(b, u, e);
  check(mid(farSlug.dmg) > mid(far.dmg) * 1.5, `at 11 tiles the birdshot has spread thin (${far.dmg.join("–")}) where a slug still hits hard (${farSlug.dmg.join("–")})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
