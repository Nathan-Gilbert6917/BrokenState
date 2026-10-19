// Hand over in a fight (2026-10-17 user request: "trade items with adjacent survivors when facing them with in your
// cone"; sim/combat.js handoverTargets / handoverUnfaced / handoverRefusal / combatAct "handover" / HANDOVER_AP;
// sim/inventory.js moveItem's `across`; ui/combat.js the Hand over order (Alt+H) and its chooser; ui/inventory.js
// handModal, the two-doll window):
//   - the targets: the player units right next to the acting unit (Chebyshev 1, the same floor) in its view cone, up;
//     facing away refuses with "Face <name> first", and the free Face act toward them then works;
//   - a pocket → the mate's pocket move costs the giver HANDOVER_AP (1) and the mate nothing; taking from the mate the
//     same; a gun handed into the mate's hands swaps the guns and refits both units (magazines, boxes of rounds);
//   - refusals: no action left, not adjacent, not a player unit, a downed mate, the mate's own kit, armour, the enemy's
//     turn; a save and load in the middle keeps it all;
//   - the bar: a Hand over button (greyed with why; "Face <name>", free, when only the cone is in the way), the chooser
//     with two mates in reach, the two-doll window with both kits clickable and a click-then-click move through it.
// Usage: node tools/handovertest.js [seed]
import { createWorld, hub, makeSurvivor } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem, packOf, itemAt, moveItem, fitReason } from "../src/sim/inventory.js";
import { isRoundItem, amountOf, roundItem } from "../src/sim/itemstack.js";
import { pushTop } from "../src/sim/roundstack.js";
import { setRounds } from "../src/sim/ammo.js";
import { createBattle, combatAct, registerCombatHandler, HANDOVER_AP, handoverTargets, handoverUnfaced, handoverRefusal, loadMag, active } from "../src/sim/combat.js";
import { faceToward, inArc } from "../src/sim/vision.js";
import { starterMags } from "../src/sim/carrykit.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const K = "a_9mm_fmj";
registerCombatHandler("handovertest", () => {});

// ---------- a fight (as tools/invfighttest.js): a field map at the hub, the enemy parked off the map ----------
function fighter(state, weapon = "pistol") {
  const s = makeSurvivor(state);
  s.skills.shooting = 9;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool", "rig", "backpack", "carry"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  if (s.gear.weapon) starterMags(s); // carrykit.js: two spare magazines in the pockets
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew) {
  const h = hub(state);
  // No rounds in the base's stock: a fight at a base's walls hands its defenders their rounds at hand out of it
  // (carrykit.js packShells), which would put a loose handful in the mate's pocket. The giver's own handful
  // (setup: 80 in a pocket) loads their pistol and spares; the mate starts with nothing loose.
  setRounds(h.stock, 0);
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "handovertest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  // The enemy alive but inert in the far corner (dead, the first act would end the fight: checkEnd), your people in a row near the origin.
  for (const u of b.units) if (u.side === "enemy") { u.aware = false; u.x = b.w - 1; u.y = b.h - 1; u.dead = false; }
  b.units.filter((u) => u.side === "player").forEach((u, i) => { u.x = 1 + i; u.y = 1; u.ap = 2; });
  return b;
}
const unitOf = (b, s) => b.units.find((u) => u.sid === s.id);
const L = (s, slot, i = null) => `s:${s.id}:${slot}${i == null ? "" : `:${i}`}`;
const names = (list) => list.map((t) => t.name.split(" ")[0]).join(", ");
// A world with three of yours: a (acting), m (the mate next to them, east), c (two tiles off); a faces m.
function setup(seed) {
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "pistol"), m = fighter(st, "pistol"), c = fighter(st, "pistol");
  a.gear.backpack = newItem("backpack");
  m.gear.backpack = newItem("backpack");
  a.pockets[2] = roundItem(K, 80, true); // a loose handful at hand (the fight's start loads the pistol and its two spares out of it: 45, 35 left; mags.js physical rounds)
  const b = openBattle(st, [a, m, c]);
  const u = unitOf(b, a), t = unitOf(b, m), w = unitOf(b, c);
  faceToward(u, t.x, t.y);
  faceToward(t, u.x, u.y);
  return { st, b, a, m, c, u, t, w };
}

// ---------------------------------------------------------------------------------------------------------
section("Targets: right next to them, in the view cone, up; Face first when the cone is in the way");
{
  const { st, b, u, t, w } = setup(SEED);
  check(HANDOVER_AP === 1, `HANDOVER_AP is ${HANDOVER_AP}`);
  let T = handoverTargets(b, u);
  check(T.length === 1 && T[0] === t && !T.includes(w), `facing the mate next to them: one target (${names(T)}); the one two tiles off is not`);
  check(handoverRefusal(b, u, t) === "" && /not right next/.test(handoverRefusal(b, u, w)), `the refusals say so (${handoverRefusal(b, u, w)})`);
  faceToward(u, u.x - 1, u.y); // west: the mate (east) is behind them
  T = handoverTargets(b, u);
  const un = handoverUnfaced(b, u);
  check(!T.length && un.length === 1 && un[0] === t && /^Face /.test(handoverRefusal(b, u, t)), `facing away: no target, the mate is the one to face (${handoverRefusal(b, u, t)})`);
  let err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(st.survivors.find((s) => s.id === u.sid), "pocket", 2), toLoc: L(st.survivors.find((s) => s.id === t.sid), "pocket", 2) });
  check(/^Face /.test(err) && u.ap === 2, `a hand-over facing away is refused, nothing spent (${err})`);
  err = combatAct(st, { type: "face", unit: u.id, faceX: t.x, faceY: t.y });
  check(err === "" && u.ap === 2 && inArc(u, t.x, t.y) && handoverTargets(b, u)[0] === t, "the free Face toward them: in the cone again, a target");
  // The enemy, a downed mate, someone of the other side: never a target.
  const foe = b.units.find((x) => x.side === "enemy");
  check(/Only one of your own/.test(handoverRefusal(b, u, foe)), `an enemy: ${handoverRefusal(b, u, foe)}`);
  t.down = true;
  check(!handoverTargets(b, u).length && /is down/.test(handoverRefusal(b, u, t)), `a downed mate: ${handoverRefusal(b, u, t)}`);
  t.down = false;
  t.f = 1;
  check(!handoverTargets(b, u).length, "a mate on another floor is not next to them");
  t.f = 0;
  check(handoverTargets(b, u).length === 1, "(back on the floor: a target again)");
}

section("A pocket → the mate's pocket costs the giver 1 action and the mate nothing; both refit");
{
  const { st, b, a, m, c, u, t } = setup(SEED + 1);
  const handful = a.pockets[2];
  check(u.handBoxes === 1 && u.boxes.includes(handful) && t.handBoxes === 0 && t.ap === 2, `before: the handful is at ${a.name.split(" ")[0]}'s hand (handBoxes ${u.handBoxes}), none at ${m.name.split(" ")[0]}'s`);
  let err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pocket", 2), toLoc: L(m, "pocket", 2) });
  check(err === "" && u.ap === 1 && t.ap === 2 && m.pockets[2] === handful && !a.pockets[2], `given: done for ${HANDOVER_AP} action of the giver's (${err || "ok"}; ${u.ap} left, the mate still ${t.ap})`);
  check(u.handBoxes === 0 && !u.boxes.includes(handful) && t.handBoxes === 1 && t.boxes.includes(handful), `both refit: the handful is at ${m.name.split(" ")[0]}'s hand now (${t.handBoxes}), not the giver's (${u.handBoxes})`);
  check(/hands/.test(b.log[b.log.length - 1].text), `the log says so: "${b.log[b.log.length - 1].text}"`);
  // Taken from the mate: the same action, the giver's.
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(m, "pocket", 2), toLoc: L(a, "pack", 0) });
  check(err === "" && u.ap === 0 && t.ap === 2 && packOf(a)[0] === handful && !m.pockets[2] && u.boxes.includes(handful) && !t.boxes.includes(handful), `taken back into the pack: the giver's action again (${err || "ok"}; ${u.ap} left), the boxes refit`);
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pack", 0), toLoc: L(m, "pocket", 2) });
  check(/No action left/.test(err) && packOf(a)[0] === handful, `at 0 AP: refused, nothing moves (${err})`);
  // Onto the same rounds: the stacks merge.
  u.ap = 2;
  m.pockets[3] = roundItem(K, 10, true);
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pack", 0), toLoc: L(m, "pocket", 3) });
  check(err === "" && u.ap === 1 && amountOf(m.pockets[3]) === 45 && !packOf(a)[0], `onto the mate's loose rounds: merged (${amountOf(m.pockets[3])}: the 35 left after the fight's start loaded 45 out of the 80)`);
  // A full target swaps when the thing there fits back where the moved one came from.
  const magI = a.pockets.findIndex((it) => it && GEAR[it.key] && GEAR[it.key].mag);
  const mag = a.pockets[magI], theirs = m.pockets[3];
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pocket", magI), toLoc: L(m, "pocket", 3) });
  check(err === "" && u.ap === 0 && m.pockets[3] === mag && a.pockets[magI] === theirs, `a full pocket: swapped, the magazine for the rounds (${err || "ok"})`);
  check(t.mags.filter((x) => x.where === "pocket").length === 3 && u.mags.filter((x) => x.where === "pocket").length === 1, `the magazines refit: ${m.name.split(" ")[0]} has ${t.mags.filter((x) => x.where !== "gun").length} spares now, ${a.name.split(" ")[0]} ${u.mags.filter((x) => x.where !== "gun").length}`);
  check(c && unitOf(b, c).ap === 2, "(the third one, two tiles off, untouched)");
}

section("A gun handed into the mate's hands swaps the guns and refits both units");
{
  const { st, a, m, u, t } = setup(SEED + 2);
  const shotgun = newItem("shotgun");
  if (fitReason(shotgun, "pack")) check(false, "a shotgun does not go in a pack: the swap could not be tried");
  else {
    packOf(a)[0] = shotgun;
    const theirPistol = m.gear.weapon, myPistol = a.gear.weapon;
    t.stack = t.stack || []; pushTop(t.stack, K, 9); // the mate's gun starts empty (no rounds at hand): 9 of its own rounds in it
    loadMag(t, 9);
    let err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pack", 0), toLoc: L(m, "weapon") });
    check(err === "" && u.ap === 1 && t.ap === 2 && m.gear.weapon === shotgun && packOf(a)[0] === theirPistol, `the shotgun into ${m.name.split(" ")[0]}'s hands, their pistol back into the giver's pack (${err || "ok"})`);
    check(t.weapon === "shotgun" && t.item === shotgun && t.magsW === "shotgun" && t.magMode === "internal" && t.magMax === 6, `the mate is refit: a shotgun (${t.weapon} ${t.mag}/${t.magMax}, ${t.magMode})`);
    check(theirPistol.loaded && theirPistol.loaded.n === 9, "their pistol keeps its 9 rounds (gunload.js) in the giver's pack");
    check(u.weapon === "pistol" && u.item === myPistol && u.mags && u.mags.length === 3, `the giver keeps their own gun and magazines (${u.weapon}, ${u.mags ? u.mags.length : 0})`);
    // The giver's own gun out of the hands to the mate's pack, and taken back: the hands empty between.
    loadMag(u, 7);
    err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "weapon"), toLoc: L(m, "pack", 1) });
    check(err === "" && u.ap === 0 && !a.gear.weapon && packOf(m)[1] === myPistol && u.weapon === "fists" && myPistol.loaded && myPistol.loaded.n === 7, `the gun in hand given to the mate's pack: fists now (${u.weapon}), the 7 rounds kept in it`);
    u.ap = 2;
    err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(m, "pack", 1), toLoc: L(a, "weapon") });
    check(err === "" && u.ap === 1 && a.gear.weapon === myPistol && u.weapon === "pistol" && u.mag === 7 && u.mags && u.mags.length === 3, `and taken back: the pistol with its 7 rounds and its magazines (${u.weapon} ${u.mag}/${u.magMax}, ${u.mags ? u.mags.length : 0})`);
  }
}

section("Refusals: the mate's own kit, armour, someone else's, the enemy's turn; moveItem across places");
{
  const { st, b, a, m, c, u, t } = setup(SEED + 3);
  m.pockets[0] = roundItem(K, 20, true);
  let err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(m, "pocket", 0), toLoc: L(m, "pack", 0) });
  check(/own kit stays/.test(err) && u.ap === 2 && m.pockets[0], `the mate's own kit: refused, nothing spent (${err})`);
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pocket", 2), toLoc: L(a, "pack", 0) });
  check(/Inventory window/.test(err) && u.ap === 2, `the giver's own kit: the inventory act, not this (${err})`);
  a.gear.armor = newItem("plate");
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "armor"), toLoc: L(m, "pack", 0) });
  check(/stay as they are/.test(err) && a.gear.armor && u.ap === 2, `armour stays as worn (${err})`);
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pocket", 2), toLoc: L(c, "pocket", 0) });
  check(/two of them/.test(err) && u.ap === 2, `a third person's slot: refused (${err})`);
  err = combatAct(st, { type: "handover", unit: u.id, to: unitOf(b, c).id, from: L(a, "pocket", 2), toLoc: L(c, "pocket", 0) });
  check(/not right next/.test(err) && u.ap === 2, `to the one two tiles off: refused (${err})`);
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pocket", 3), toLoc: L(m, "pocket", 1) });
  check(/Nothing there/.test(err) && u.ap === 2, "an empty slot: nothing moves, nothing spent");
  b.phase = "enemy";
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pocket", 2), toLoc: L(m, "pocket", 1) });
  check(/enemy turn/.test(err) && a.pockets[2], `on the enemy's turn: refused (${err})`);
  b.phase = "player";
  t.ap = 0;
  err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pocket", 2), toLoc: L(m, "pocket", 2) });
  check(err === "" && u.ap === 1 && t.ap === 0 && isRoundItem(m.pockets[2]) && !a.pockets[2], "a mate with no action left still takes things: only the giver's actions count");
  // moveItem across places (sim/inventory.js): two people whose location records differ still trade in a fight.
  const loc0 = m.location;
  m.location = { kind: "party", partyId: 999999 };
  const r1 = moveItem(st, L(m, "pocket", 2), L(a, "pocket", 3));
  const r2 = moveItem(st, L(m, "pocket", 2), L(a, "pocket", 3), { across: true });
  check(/same base or on the same team/.test(r1) && !/same base/.test(r2) && isRoundItem(a.pockets[3]) && !m.pockets[2], `moveItem refuses across places unless told (across: "${r2}")`);
  m.location = loc0;
  check(active(u) && active(t), "(both still up)");
}

section("A save and load in the middle keeps it all");
{
  const { st, a, m, u, t } = setup(SEED + 4);
  let err = combatAct(st, { type: "handover", unit: u.id, to: t.id, from: L(a, "pocket", 2), toLoc: L(m, "pack", 2) });
  check(err === "" && u.ap === 1, "a hand-over before the save");
  const str = saveToString(st);
  const st2 = loadFromString(str);
  const b2 = st2.combat, a2 = st2.survivors.find((x) => x.id === a.id), m2 = st2.survivors.find((x) => x.id === m.id);
  const u2 = unitOf(b2, a2), t2 = unitOf(b2, m2);
  check(b2 && u2 && t2 && u2.ap === 1 && t2.ap === 2 && isRoundItem(packOf(m2)[2]) && !a2.pockets[2], "the loaded battle has the rounds in the mate's pack and the action spent");
  check(handoverTargets(b2, u2).length === 1 && handoverTargets(b2, u2)[0] === t2, "the facing is kept: the mate is a target on the loaded battle");
  err = combatAct(st2, { type: "handover", unit: u2.id, to: t2.id, from: L(m2, "pack", 2), toLoc: L(a2, "pocket", 0) });
  check(err === "" && u2.ap === 0 && isRoundItem(a2.pockets[0]) && u2.boxes.includes(a2.pockets[0]) && t2.handBoxes === 0, `a hand-over on the loaded battle works and refits (${err || "ok"})`);
  check(itemAt(st2, L(a2, "pocket", 0)) === a2.pockets[0], "(the location strings resolve)");
}

// ---------------------------------------------------------------------------------------------------------
// The bar's order, the chooser and the two-doll window (ui/combat.js, ui/inventory.js) on stub canvases, as
// tools/battlebartest.js does.
section("The bar: Hand over (Alt+H), Face <name>, the chooser, the two-doll window");
{
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  try { globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} }; } catch { /* node's own */ }
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  const INV = await import("../src/ui/inventory.js");
  const KM = await import("../src/ui/keymap.js");
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  const cui = UI.cui;
  const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  const buttons = (html) => {
    const out = [];
    for (const x of html.matchAll(/<button class="([^"]*)" data-action="([^"]+)"((?: data-[a-z]+="[^"]*")*) (disabled)? ?data-tip="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)) {
      const attrs = Object.fromEntries([...x[3].matchAll(/data-([a-z]+)="([^"]*)"/g)].map((a) => [a[1], unesc(a[2])]));
      const cost = /<i class="bb-ap[^"]*">([^<]*)<\/i>/.exec(x[6]), key = /<span class="key">([^<]*)<\/span>/.exec(x[6]);
      out.push({ cls: x[1], action: x[2], ...attrs, disabled: !!x[4], tip: unesc(x[5]), cost: cost ? cost[1] : "", key: key ? unesc(key[1]) : "", text: x[6] });
    }
    return out;
  };
  const order = (st) => buttons(UI.renderCombatBar(st, { flat: true })).filter((x) => /\bbb-btn\b/.test(x.cls)).find((x) => x.action === "cb-act" && x.v === "handover"); // flat: every order on the bar, greyed ones too, none in a tray (ui/battlebar.js)
  const draw = (st) => { try { UI.drawCombat(st, 1e9); return ""; } catch (e) { return e.stack.split("\n").slice(0, 2).join(" "); } };

  const { st, b, a, m, c, u, t, w } = setup(SEED + 5);
  check(KM.keysOf("battle.handover")[0] === "Alt+KeyH" && KM.KEY_BY_ID.get("battle.handover").v === "handover" && !KM.conflicts().length, "the key table: Hand over on Alt+H, no clash");
  check(draw(st) === "", "the battle draws");
  cui.sel = u.id; cui.mode = "move"; cui.msg = ""; cui.handAsk = null; cui.handReq = null;
  let o = order(st);
  check(o && !o.disabled && /Hand over/.test(o.text) && o.cost === "1" && o.key === "Alt+H" && new RegExp(m.name.split(" ")[0]).test(o.tip), `the bar: Hand over, 1 action, Alt+H, the mate named in the tip (${o ? o.tip.split("\n")[0] : "no button"})`);
  // Facing away: the button turns to Face <name>, free; pressing it turns them (the free Face act).
  faceToward(u, u.x - 1, u.y);
  o = order(st);
  check(o && !o.disabled && new RegExp(`Face ${m.name.split(" ")[0]}`).test(o.text) && o.cost === "free", `facing away: "Face ${m.name.split(" ")[0]}", free`);
  UI.combatAction(st, "cb-act", { v: "handover" });
  check(inArc(u, t.x, t.y) && u.ap === 2 && /turns to face/.test(cui.msg) && !cui.handReq, `pressed: ${a.name.split(" ")[0]} faces the mate for free (${cui.msg})`);
  // Nobody in reach: greyed with why.
  t.x = 6; t.y = 6;
  o = order(st);
  check(o && o.disabled && /Not now: Nobody of yours right next to them/.test(o.tip), "nobody in reach: greyed, why");
  t.x = u.x + 1; t.y = u.y;
  // No action left: greyed with why (everyone out of actions, or the screen picks someone who has some).
  for (const p of b.units) if (p.side === "player") p.ap = 0;
  o = order(st);
  check(o && o.disabled && /No actions left/.test(o.tip), "no action left: greyed, why");
  for (const p of b.units) if (p.side === "player") p.ap = 2;
  cui.sel = u.id;
  // One mate in reach: the order opens the two-doll window at once.
  UI.combatAction(st, "cb-act", { v: "handover" });
  check(cui.handReq && cui.handReq.sid === a.id && cui.handReq.mate === m.id, "one mate in reach: the window is asked for at once");
  const ui = { started: true, inv: null };
  INV.takeLootReq(st, ui);
  check(ui.inv && ui.inv.peek && ui.inv.sid === a.id && ui.inv.mate === m.id && !cui.handReq, "takeLootReq opens it: ui.inv { sid, peek, mate }");
  let html = INV.inventoryModal(st, ui) || "";
  check(/Hand over: /.test(html) && html.includes(`data-loc="${L(a, "pocket", 2)}"`) && html.includes(`data-loc="${L(m, "pocket", 0)}"`) && new RegExp(`each thing handed to ${m.name.split(" ")[0]}`).test(html), "the window: both kits, clickable, the head says what a move costs");
  // Click-then-click: the handful into the mate's pocket, through combatAct "handover".
  INV.INV_ACTIONS["inv-click"](st, ui, { loc: L(a, "pocket", 2) });
  check(ui.invSel === L(a, "pocket", 2) && /Selected:/.test(INV.inventoryModal(st, ui) || ""), "a click picks the thing");
  INV.INV_ACTIONS["inv-click"](st, ui, { loc: L(m, "pocket", 2) });
  check(isRoundItem(m.pockets[2]) && !a.pockets[2] && u.ap === 1 && t.ap === 2 && /1 action; 1 left/.test(ui.invMsg) && !ui.invSel, `a second click on the mate's empty pocket moves it for the giver's action (${ui.invMsg})`);
  // The mate's own kit does not move here; the giver's own does (the inventory act).
  INV.INV_ACTIONS["inv-click"](st, ui, { loc: L(m, "pocket", 2) });
  INV.INV_ACTIONS["inv-click"](st, ui, { loc: L(m, "pack", 0) });
  check(isRoundItem(m.pockets[2]) && u.ap === 1 && /own kit stays/.test(ui.invMsg), `the mate's own kit stays (${ui.invMsg})`);
  const magI = a.pockets.findIndex((it) => it && GEAR[it.key] && GEAR[it.key].mag);
  INV.INV_ACTIONS["inv-click"](st, ui, { loc: L(a, "pocket", magI) });
  INV.INV_ACTIONS["inv-click"](st, ui, { loc: L(a, "pack", 3) });
  check(packOf(a)[3] && GEAR[packOf(a)[3].key].mag && u.ap === 0 && /1 action; 0 left/.test(ui.invMsg), `the giver's own kit moves here too, the inventory act (${ui.invMsg})`);
  html = INV.inventoryModal(st, ui) || "";
  check(/No action left/.test(html) && !/data-action="inv-click"/.test(html), "with no action left the window is look only, and says why");
  // Drag: a drop goes the same way.
  u.ap = 2;
  INV.invDrop(st, ui, L(m, "pocket", 2), L(a, "pocket", 2));
  check(isRoundItem(a.pockets[2]) && !m.pockets[2] && u.ap === 1, `a drag from the mate's pocket back: the same act (${ui.invMsg})`);
  // Own kit: back to the one-doll window.
  INV.INV_ACTIONS["inv-mate"](st, ui, { id: "" });
  html = INV.inventoryModal(st, ui) || "";
  check(ui.inv.mate == null && /Inventory: /.test(html) && !/Hand over: /.test(html), "Own kit: the one-doll window again");
  ui.inv = null;
  // Two mates in reach: the chooser over the orders; a pick (or the mate clicked on the map) opens the window.
  w.x = u.x + 1; w.y = u.y + 1; // south-east: 45° off the way they face (east), in the cone
  const T = handoverTargets(b, u);
  check(T.length === 2 && T.includes(t) && T.includes(w), `two mates in reach (${names(T)})`);
  cui.handAsk = null; cui.handReq = null; cui.mode = "move";
  UI.combatAction(st, "cb-act", { v: "handover" });
  const bar = UI.renderCombatBar(st);
  check(cui.handAsk === u.id && cui.mode === "handover" && !cui.handReq && /Hand over with: /.test(bar) && bar.includes(`data-v="handover" data-k="${w.id}"`), "two in reach: the chooser over the orders, nothing opened yet");
  UI.combatAction(st, "cb-act", { v: "handover", k: String(w.id) });
  check(cui.handReq && cui.handReq.mate === c.id && !cui.handAsk && cui.mode === "move", `the chooser's pick opens the window with ${c.name.split(" ")[0]}`);
  INV.takeLootReq(st, ui);
  html = INV.inventoryModal(st, ui) || "";
  check(ui.inv && ui.inv.mate === c.id && html.includes(`data-action="inv-mate" data-id="${m.id}"`), "the window has a tab for the other mate in reach");
  INV.INV_ACTIONS["inv-mate"](st, ui, { id: String(m.id) });
  check(ui.inv.mate === m.id, "the tab swaps the mate");
  ui.inv = null;
  // Esc closes the chooser; the key runs the same code as the button.
  UI.combatAction(st, "cb-act", { v: "handover" });
  UI.combatKey(st, { code: "Escape", preventDefault() {} });
  check(!cui.handAsk && cui.mode === "move", "Esc closes the chooser");
  UI.combatKey(st, { code: "KeyH", altKey: true, preventDefault() {} });
  check(cui.handAsk === u.id && cui.mode === "handover", "Alt+H opens it as the button does");
  cui.handAsk = null; cui.mode = "move"; cui.handReq = null;
  st.combat = null;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
