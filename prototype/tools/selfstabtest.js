// Stabilizing oneself: a tourniquet or a field trauma kit lets someone down and bleeding stop their own bleeding in
// battle (src/sim/medics.js MEDIC.SELF, selfStabilize; combat.js hooks; ui/combat.js the downed one's panel). Checks:
//   - the tourniquet exists (small, one use, an admin pouch), is in loot (finds, trucks, safes, dead soldiers), traders,
//     the enemy's kits (by kit, out of the arsenal), and the crafting recipes
//   - a downed survivor with one in reach (off hand, pocket, rig pouch) can try once a turn: the odds over many tries,
//     stabilized and still down, the use spent on success only, gone from the pocket after the battle
//   - the trauma kit does better than the tourniquet and spends a kit use
//   - one in the pack does not count (the reason says so); nothing in reach, no try
//   - the end of your turn: one who has not tried tries by themselves
//   - an enemy fighter does it too (at the end of their phase), unless an ally is coming with time left
//   - after the battle: your self-stabilized pull through; their self-stabilized are prisoners, the bleeding die
//   - the battle panel's button (and greyed with the reason), the roster's note, the sound cue
//   - a save keeps the item, in and out of a battle
// Usage: node tools/selfstabtest.js
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, enemyUnit, damage, registerCombatHandler, combatAct, loadMag, enemyStep, endBattleNow, endPlayerTurn } from "../src/sim/combat.js";
import * as MED from "../src/sim/medics.js";
import { GEAR } from "../src/sim/data.js";
import { newItem, stow, carriedSpots, enemyBody } from "../src/sim/inventory.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { SITE_FINDS, AREA_FINDS, ITEM_TAGS } from "../src/sim/loot.js";
import { TRUCK_LOOT } from "../src/sim/miltrucks.js";
import { WARES } from "../src/sim/trade.js";
import { ARSENAL, starterKit } from "../src/sim/arsenal.js";
import { battleCaptives } from "../src/sim/stealth.js";
import { gearCues } from "../src/ui/sfx-gear.js";
import { Rng } from "../src/sim/rng.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("selfstabtest", () => {});
const t0 = Date.now();

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

const forced = (b, v, fn) => { const c = b.rng.chance; b.rng.chance = () => v; try { return fn(); } finally { b.rng.chance = c; } };
const arm = (u, w = "pistol") => { u.weapon = w; u.weaponName = w; u.cd = 0; loadMag(u); };
// A field battle on open grass, 3 of your people. carry[i]: { where: "pocket" | "tool" | "pack" | "rig", key } or null.
function arena({ seed = 11, carry = [null, null, null], med = 0, kind = "raiders", meds = 0 } = {}) {
  const st = createWorld({ seed, factionCount: 4 });
  const h = hub(st);
  h.stock.ammo = 60;
  h.stock.meds = meds;
  const people = atBase(st, h.id).slice(0, 3);
  people.forEach((s, i) => {
    s.skills.medicine = med;
    s.health = 100;
    s.gear.tool = null;
    s.pockets = (s.pockets || []).map(() => null);
    while (s.pockets.length < 4) s.pockets.push(null);
    if (s.gear.backpack && s.gear.backpack.contents) s.gear.backpack.contents = s.gear.backpack.contents.map(() => null);
    const c = carry[i];
    if (!c) return;
    const it = newItem(c.key);
    if (c.where === "tool") s.gear.tool = it;
    else if (c.where === "pocket") s.pockets[0] = it;
    else if (c.where === "pack") {
      if (!s.gear.backpack) s.gear.backpack = newItem("backpack");
      s.gear.backpack.contents = s.gear.backpack.contents || [];
      const j = s.gear.backpack.contents.indexOf(null);
      if (j >= 0) s.gear.backpack.contents[j] = it; else s.gear.backpack.contents.push(it);
    } else if (c.where === "rig") { s.gear.armor = null; s.gear.rig = newItem("chestrig"); stow(s, it); }
  });
  const f = st.factions.find((x) => x.alive && x.bases && x.bases.length);
  const b = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind, count: 1, power: 3 }, ambush: null, canRetreat: true, handler: "selfstabtest", context: {} });
  st.combat = b;
  for (let i = 0; i < b.cells.length; i++) b.cells[i] = { k: "open", f: "grass" };
  b.losCache.fill(0);
  b.evacCols = 0; b.infection = 0; b.corpses = [];
  b.units = b.units.filter((u) => u.side === "player");
  const ps = people.map((s) => b.units.find((u) => u.sid === s.id));
  ps.forEach((u, i) => { u.x = 2; u.y = 2 + i * 3; arm(u); u.ap = 2; });
  const z = enemyUnit(b, b.rng, "zombies", 2, 1);
  z.x = b.w - 1; z.y = b.h - 1; z.aware = false; z.ap = 0;
  b.units.push(z);
  b.phase = "player";
  return { st, b, ps, people, f, h };
}
const foe = (b, kind = "raiders", x = 20, y = 12) => { const e = enemyUnit(b, b.rng, kind, 3, b.units.length + 1); delete e.medKit; delete e.selfKits; e.isMedicKit = false; e.kitBonus = 0; e.medicine = 0; e.x = x; e.y = y; e.aware = true; arm(e); b.units.push(e); return e; };
const downPlayer = (b, u) => { damage(b, u, 999, null); u.bleed = 3; return u; };
const downFoe = (b, e) => { damage(b, e, (e.hp + 2) / e.armor, null); return e; };
const tq = () => [{ item: null, key: "tourniquet", name: "Tourniquet", left: 1, used: 0 }];

section("The tourniquet: the item, where it is found, the recipe");
{
  const d = GEAR.tourniquet;
  check(!!d && d.small && d.dur === 1 && d.selfStab && d.weight <= 0.2 && d.slot === "pack" && d.cat === "medical", "a small, light, one-use medical item that stabilizes oneself");
  check(GEAR.traumakit.selfStab && GEAR.traumakit.medKit, "the field trauma kit stabilizes oneself too (and is still a med kit)");
  check(!GEAR.bandagekit.selfStab && !GEAR.surgkit.selfStab, "a bandage kit or a surgical kit does not");
  const sites = ["hospital", "clinic", "pharmacy", "police", "military", "firestation", "crash_med", "crash_mil", "convoy"];
  check(sites.every((k) => SITE_FINDS[k].items.tourniquet > 0), `a find at ${sites.join(", ")}`);
  check(["clinic", "nurse", "pharmacy", "armory", "barracks", "medwreck", "milwreck"].every((k) => AREA_FINDS[k].items.tourniquet > 0), "a find in raid rooms: clinic, first-aid room, pharmacy, armory, barracks, medevac and helicopter wrecks");
  check(ITEM_TAGS.tourniquet.includes("medical") && ITEM_TAGS.tourniquet.includes("police") && ITEM_TAGS.tourniquet.includes("military"), "its theme tags");
  check(TRUCK_LOOT.cargo.gear.some(([k]) => k === "tourniquet") && TRUCK_LOOT.mrap.gear.some(([k]) => k === "tourniquet"), "in Army trucks' cargo");
  check(WARES.traders.includes("tourniquet") && WARES.military.includes("tourniquet"), "traders and the military sell them");
  const r = CRAFTS.tourniquet;
  check(r && r.gear === "tourniquet" && r.skill === "medicine" && r.min <= 1 && r.field && Object.keys(r.in).length === 1 && r.in.scrap === 1, `craftable in the field from 1 scrap, Medicine ${r && r.min}`);
  check(ARSENAL.NONLETHAL.soldiers.tourniquet > ARSENAL.NONLETHAL.guards.tourniquet && ARSENAL.NONLETHAL.guards.tourniquet > ARSENAL.NONLETHAL.raiders.tourniquet, "groups' starting arsenals hold them, soldiers most");
  const kit = starterKit(5, "Test Battalion", "military", 20);
  const n = kit.filter((it) => it.key === "tourniquet").length;
  check(n >= 10, `a 20-strong military group starts with ${n} tourniquets`);
  const s = { id: 1, gear: { rig: newItem("chestrig") }, pockets: [null, null, null, null] };
  const at = stow(s, newItem("tourniquet"));
  check(/rig/.test(at), `stowed on someone with a chest rig: an admin pouch (${at})`);
}

section("A downed survivor with a tourniquet in a pocket: once a turn, the odds, stabilized and still down");
{
  const { st, b, ps, people } = arena({ carry: [{ where: "pocket", key: "tourniquet" }, null, null], med: 2 });
  const [a] = ps;
  check(a.selfKits && a.selfKits.length === 1 && a.selfKits[0].item === people[0].pockets[0], "the tourniquet in their pocket is in reach");
  check(MED.selfStabRefusal(b, a) !== "", `standing: no try (“${MED.selfStabRefusal(b, a)}”)`);
  downPlayer(b, a);
  check(MED.selfOdds(a, "tourniquet") === 45, `Medicine 2: ${MED.selfOdds(a, "tourniquet")}% (35 + 5 × 2)`);
  check(MED.selfStabRefusal(b, a) === "", "down and bleeding: they can try");
  forced(b, false, () => combatAct(st, { type: "selfStab", unit: a.id }));
  check(!a.stab && a.selfKits[0].used === 0, "a failed try: still bleeding, the tourniquet not spent");
  const again = combatAct(st, { type: "selfStab", unit: a.id });
  check(/Already tried/.test(again), `a second try the same turn: “${again}”`);
  b.turn++;
  const err = forced(b, true, () => combatAct(st, { type: "selfStab", unit: a.id }));
  check(!err && a.stab && a.down && a.selfKits[0].used === 1, `next turn it works: stabilized, still down, the use spent (${err || "no error"})`);
  check(b.log.some((l) => /cinches a tourniquet on their own wound/.test(l.text)), "the log says so");
  check(b.fx.some((f) => f.type === "heal" && f.self === "tourniquet" && f.ok), "an effect for the map and the sound");
  check(/Already stabilized/.test(MED.selfStabRefusal(b, a)), "stabilized: nothing more to try");
  // The odds over many seeded tries.
  const rng = new Rng(77);
  b.rng = rng;
  let ok = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) { a.stab = false; a.selfTry = null; a.selfKits[0].used = 0; MED.selfStabilize(b, a); if (a.stab) ok++; }
  check(Math.abs(ok / N - 0.45) < 0.035, `${N} tries at Medicine 2: ${(100 * ok / N).toFixed(1)}% (45%)`);
  // After the battle (won): they pull through for sure; the tourniquet stays on the limb (gone from the pocket).
  a.stab = true; a.selfKits[0].used = 1;
  endBattleNow(st, "victory");
  check(people[0].alive && !people[0].pockets.some((it) => it && it.key === "tourniquet"), `pulled through (health ${Math.round(people[0].health)}); the tourniquet is used up`);
}

section("The trauma kit does better than a tourniquet, and spends a kit use");
{
  const { st, b, ps, people } = arena({ carry: [{ where: "tool", key: "traumakit" }, { where: "pocket", key: "tourniquet" }, { where: "rig", key: "tourniquet" }], med: 4 });
  const [a, c, n] = ps;
  check(MED.selfOdds(a, "traumakit") > MED.selfOdds(a, "tourniquet"), `Medicine 4: trauma kit ${MED.selfOdds(a, "traumakit")}% against a tourniquet's ${MED.selfOdds(a, "tourniquet")}%`);
  check([0, 3, 6, 10].every((m) => { const u = { medicine: m }; return MED.selfOdds(u, "traumakit") > MED.selfOdds(u, "tourniquet"); }), "better at every Medicine (0, 3, 6, 10)");
  check(MED.selfOdds({ medicine: 20 }, "traumakit") === 95 && MED.selfOdds({ medicine: 20 }, "tourniquet") === 85, "capped at 95% and 85%");
  check(n.selfKits && n.selfKits.length === 1, "a tourniquet in a rig pouch is in reach");
  downPlayer(b, a);
  const k = MED.selfKit(a);
  check(k && k.key === "traumakit" && k.item === a.medKit, "the trauma kit in the off hand is the one used (the medic's own kit)");
  const uses0 = a.kitUses || 0;
  forced(b, true, () => combatAct(st, { type: "selfStab", unit: a.id }));
  check(a.stab && a.kitUses === uses0 + 1, `stabilized with it: a kit use spent (${uses0} → ${a.kitUses})`);
  // Odds: the trauma kit's beat the tourniquet's over many tries at Medicine 0.
  const rng = new Rng(5);
  b.rng = rng;
  const rate = (u, reset) => { let ok = 0; for (let i = 0; i < 2000; i++) { u.stab = false; u.selfTry = null; reset(); MED.selfStabilize(b, u); if (u.stab) ok++; } return ok / 2000; };
  a.medicine = a.kitBonus; // Medicine skill 0
  c.medicine = 0;
  downPlayer(b, c);
  const rk = rate(a, () => { a.kitUses = 0; a.kitLeft = 99; }), rt = rate(c, () => { c.selfKits[0].used = 0; });
  check(rk > rt + 0.15 && Math.abs(rk - 0.6) < 0.04 && Math.abs(rt - 0.35) < 0.04, `Medicine 0: trauma kit ${(rk * 100).toFixed(1)}% (60), tourniquet ${(rt * 100).toFixed(1)}% (35)`);
  void people;
}

section("Out of reach: one in the pack does not count; nothing in reach, no try");
{
  const { st, b, ps } = arena({ carry: [{ where: "pack", key: "tourniquet" }, null, null] });
  const [a, c] = ps;
  check(!a.selfKits && a.selfPack === "Tourniquet", "a tourniquet in the pack: not in reach");
  downPlayer(b, a); downPlayer(b, c);
  const why = MED.selfStabRefusal(b, a);
  check(/in the pack/.test(why), `the reason says so: “${why}”`);
  check(/No tourniquet or trauma kit/.test(MED.selfStabRefusal(b, c)), `nothing at all: “${MED.selfStabRefusal(b, c)}”`);
  const err = combatAct(st, { type: "selfStab", unit: a.id });
  check(!!err && !a.stab, `the action refuses (“${err}”)`);
  // Knocked out or tied: no try either.
  const { b: b2, ps: q } = arena({ carry: [{ where: "pocket", key: "tourniquet" }, null, null] });
  downPlayer(b2, q[0]); q[0].ko = true;
  check(/Out cold/.test(MED.selfStabRefusal(b2, q[0])), "knocked out: no try");
}

section("The end of your turn: one who has not tried tries by themselves");
{
  const { st, b, ps } = arena({ carry: [{ where: "pocket", key: "tourniquet" }, null, null], med: 3 });
  const [a] = ps;
  downPlayer(b, a);
  forced(b, true, () => endPlayerTurn(st));
  check(a.stab && a.selfTry === b.turn, "they stopped their own bleeding as the turn ended");
}

section("The enemy: their kits carry tourniquets; a downed fighter stabilizes themselves when no one is coming");
{
  const { st, b } = arena();
  const share = (kind) => { let n = 0; for (let i = 0; i < 600; i++) { const e = enemyUnit(b, b.rng, kind, 3, i); if (e.selfKits) n++; } return n / 600; };
  const so = share("soldiers"), gu = share("guards"), ra = share("raiders"), ze = share("zealots");
  check(Math.abs(so - MED.MEDIC.SELF.KIT.soldiers) < 0.07 && Math.abs(gu - MED.MEDIC.SELF.KIT.guards) < 0.07 && Math.abs(ra - MED.MEDIC.SELF.KIT.raiders) < 0.05 && ze < 0.08, `carried by soldiers ${(so * 100).toFixed(0)}%, guards ${(gu * 100).toFixed(0)}%, raiders ${(ra * 100).toFixed(0)}%, zealots ${(ze * 100).toFixed(0)}%`);
  // A downed soldier with one, alone: at the end of their phase they try.
  const E = foe(b, "soldiers", 20, 12); E.selfKits = tq();
  const F = foe(b, "soldiers", 30, 20); F.selfKits = tq(); // one with an ally coming
  const G = foe(b, "soldiers", 33, 22); // no tourniquet
  const H = foe(b, "soldiers", 30, 22); // the ally coming for F
  downFoe(b, E); downFoe(b, F); downFoe(b, G);
  check(E.down && E.wounded && !E.stab, `${E.name} is down and bleeding`);
  F.rescuer = H.id; F.rescueTurn = b.turn; F.bleed = 3;
  b.phase = "enemy"; b.queue = [];
  forced(b, true, () => enemyStep(st));
  check(E.stab && E.selfKits[0].used === 1, `${E.name} stabilized themselves at the end of their phase`);
  check(!F.stab, `${F.name} waited: an ally is coming with time left`);
  check(!G.stab, `${G.name} without one: still bleeding`);
  check(b.log.some((l) => l.text.includes(E.name) && /cinches/.test(l.text)), "the log says so");
  // With the ally gone, F tries the next time.
  H.dead = true; b.phase = "enemy"; b.queue = [];
  forced(b, true, () => enemyStep(st));
  check(F.stab, `${F.name} tried once no one was coming`);
  // A medic's trauma kit counts for them too.
  const M = foe(b, "soldiers", 25, 25); MED.makeEnemyMedic(M, "traumakit", 4);
  downFoe(b, M);
  check(MED.selfKit(M) && MED.selfKit(M).key === "traumakit" && MED.selfOdds(M, "traumakit") === 80, `their medic's trauma kit: ${MED.selfOdds(M, "traumakit")}% (Medicine 4)`);
  // After a won battle: the self-stabilized are prisoners, the bleeding die.
  b.units.filter((u) => u.side === "enemy" && !u.down).forEach((u) => { u.dead = true; });
  b.phase = "player";
  endBattleNow(st, "victory");
  const caps = battleCaptives(b, "victory");
  check(caps.includes(E) && caps.includes(F) && !E.dead, "the self-stabilized are prisoners");
  check(G.dead && !caps.includes(G) && M.dead, "the ones still bleeding died");
  // Their body: a tourniquet not used is on it; a used one is not.
  const body = enemyBody(new Rng(3), { ...foe(b, "soldiers", 1, 1), selfKits: tq() }, null);
  const all = carriedSpots(body).map((c) => c.item);
  check(all.some((it) => it.key === "tourniquet"), "an unused tourniquet is on the body to loot");
  const body2 = enemyBody(new Rng(3), { ...foe(b, "soldiers", 1, 2), selfKits: [{ ...tq()[0], used: 1 }] }, null);
  const all2 = carriedSpots(body2).map((c) => c.item);
  check(!all2.some((it) => it.key === "tourniquet"), "a used one is not");
}

section("The enemy's tourniquets come out of their group's arsenal");
{
  const st = createWorld({ seed: 23, factionCount: 6 });
  const h = hub(st);
  const f = st.factions.find((x) => x.alive && x.type === "military" && x.arsenal) || st.factions.find((x) => x.alive && x.arsenal && x.arsenal.items.some((it) => it.key === "tourniquet"));
  if (!f) check(true, "(no group with an arsenal holding tourniquets in this world: skipped)");
  else {
    const held = f.arsenal.items.filter((it) => it.key === "tourniquet").length;
    const people = atBase(st, h.id).slice(0, 2);
    const b = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "soldiers", count: 8, power: 4, factionId: f.id, name: f.name }, ambush: null, canRetreat: true, handler: "selfstabtest", context: {} });
    const carriers = b.units.filter((u) => u.side === "enemy" && u.selfKits);
    const items = carriers.flatMap((u) => u.selfKits.map((k) => k.item));
    check(items.every((it) => it && f.arsenal.items.includes(it)) && new Set(items).size === items.length && items.length <= held, `${f.name}: ${carriers.length} carry one of the ${held} in their arsenal (the very items, none twice)`);
  }
}

section("The battle panel: the downed one's button, greyed with the reason; the roster's note; the sound");
{
  const { st, b, ps } = arena({ carry: [{ where: "pocket", key: "tourniquet" }, { where: "pack", key: "tourniquet" }, null], med: 2 });
  const [a, c] = ps;
  downPlayer(b, a); downPlayer(b, c);
  UI.renderCombatPanel(st); UI.cui.sel = a.id;
  const html = UI.renderCombatPanel(st);
  check(/data-v="selfStab"(?![^>]*disabled)[^>]*>Tourniquet: stabilize yourself \(45%\)/.test(html), "the downed one's panel: “Tourniquet: stabilize yourself (45%)”");
  check(/can stabilize themselves \(Tourniquet 45%\)/.test(html), "the roster's note: can stabilize themselves");
  check(/they can save themselves/.test(html), "the roster tip says they can save themselves");
  UI.combatAction(st, "cb-act", { v: "selfStab" });
  check(a.selfTry === b.turn, "the button tries it");
  UI.combatAction(st, "cb-sel", { id: String(c.id) }); // picked in the roster
  const h2 = UI.renderCombatPanel(st);
  check(/data-v="selfStab" disabled/.test(h2) && /in the pack: out of reach/.test(h2), "one in the pack: the button greyed, with the reason");
  // The sound cue: the fx of the try plays the tourniquet's voice.
  const mem = {};
  gearCues(st, mem);
  b.turn++; c.selfKits = [{ item: null, key: "tourniquet", name: "Tourniquet", left: 1, used: 0 }];
  forced(b, true, () => MED.selfStabilize(b, c));
  const cues = gearCues(st, mem);
  check(cues.some((q) => q.name === "tourniquet" && q.ok), `the sound: ${cues.map((q) => q.name).join(", ") || "none"}`);
  check(/Stabilize yourself/.test(MED.MEDICS_HELP) && /tourniquet/.test(MED.MEDICS_HELP), "Help → Medics says how");
}

section("A save keeps the tourniquet, in and out of a battle");
{
  const { st, b, ps, people } = arena({ carry: [{ where: "pocket", key: "tourniquet" }, null, null] });
  const [a] = ps;
  downPlayer(b, a);
  const L = loadFromString(saveToString(st));
  const la = L.combat.units.find((u) => u.id === a.id);
  const ls = L.survivors.find((s) => s.id === people[0].id);
  check(la.selfKits && la.selfKits[0].item === ls.pockets[0] && ls.pockets[0].key === "tourniquet", "mid-battle: the unit's tourniquet is still the one in the pocket");
  const err = forced(L.combat, true, () => combatAct(L, { type: "selfStab", unit: a.id }));
  check(!err && la.stab, `the loaded battle: it still works (${err || "no error"})`);
  st.combat = null;
  const L2 = loadFromString(saveToString(st));
  const s2 = L2.survivors.find((s) => s.id === people[0].id);
  check(s2.pockets.some((it) => it && it.key === "tourniquet" && it.dur === 1), "out of battle: still in the pocket");
  void carriedSpots;
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (fail) process.exit(1);
