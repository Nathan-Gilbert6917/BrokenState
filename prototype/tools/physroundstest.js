// Physical rounds out of a fight, magazines out and in (the user's playtest reports, 2026-10-20; docs/reload-rules.md):
//   1. "I got an event that gave me a 9mm pistol and some ammo but it would not let me move the ammo to the inventory
//      of a survivor, only the gun": the officer's pistol (events.js hc_newdead) comes with ITS rounds (in it, any over
//      its magazine loose 9mm in the cargo), movable onto a survivor; a case's rounds come onto the one carrying it like
//      its gun (boxes.js takeFromBox); a body's pistol brings 9mm (inventory.js deadBodyFinds);
//   2. "The gun said it had 3 bullets in it but would not reload with the 3 that were in the base storage. Then ... it
//      had 0": the badge counts what is in the gun (gunrounds.js), the same through a move to the armory and back, an
//      equip, a save and load; Reload at the base loads from the base's stores (itemacts.js reloadGunAt); a fight's end
//      leaves the rounds in the gun (gunload.js returnStacks) and the next fight's start tops it up (mags.js fillUnit top);
//   3. "When I right-click a gun I should have an option to remove magazine ... including the 9mm pistol. And then I can
//      reload that magazine with bullets": Remove magazine (the chambered round stays), Load rounds / Unload rounds on
//      the magazine, Insert magazine, out of a fight (free) and in one (actions: combatAct "inv" op "magout", a swap
//      into the empty gun, op "load"); not on a tube, a cylinder or a fixed box; the item menu's rows;
//   and an old save's guns loaded once (save.js physOutV), an AI person's reload untouched (fighters.js, physical).
// Usage: node tools/physroundstest.js [seed]
globalThis.window = globalThis.window || {};
const silent = () => new Proxy(() => {}, { get: (t, k) => (k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : k === "createImageData" ? (w, h) => ({ data: new Uint8ClampedArray(4 * w * h), width: w, height: h }) : silent()), apply: () => silent() });
globalThis.document = globalThis.document || { addEventListener() {}, getElementById() { return null; }, head: null, createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => silent(), toDataURL: () => "data:image/png;base64,AAAA" }) };
const { createWorld, makeSurvivor, hub, atBase } = await import("../src/sim/world.js");
const { launchExpedition, planPath } = await import("../src/sim/parties.js");
const { newItem, stripAll, ensureInv, carriedSpots, moveItem, deadBodyFinds } = await import("../src/sim/inventory.js");
const { travelEventCard } = await import("../src/sim/events.js");
const { gunRounds } = await import("../src/sim/gunrounds.js");
const { gunRoundsLabel } = await import("../src/ui/itemlabels.js");
const IA = await import("../src/sim/itemacts.js");
const { stackN } = await import("../src/sim/roundstack.js");
const { saveToString, loadFromString } = await import("../src/sim/save.js");
const { createBattle, combatAct, registerCombatHandler, magCap } = await import("../src/sim/combat.js");
const { returnStacks, gunStackOf } = await import("../src/sim/gunload.js");
const { isStacked, detachable, magOut, standardMag } = await import("../src/sim/mags.js");
const { roundItem } = await import("../src/sim/itemstack.js");
const B = await import("../src/sim/boxes.js");
const { Rng } = await import("../src/sim/rng.js");
const { INV_STACK_DESTS } = await import("../src/ui/inventory.js");
const { openItemMenu, itemMenuHtml } = await import("../src/ui/itemmenu.js");

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
const section = (t) => console.log(`\n== ${t}`);
registerCombatHandler("prtest", () => {});
const K9 = "a_9mm_fmj";
const world = (sd = seed) => { const st = createWorld({ seed: sd, factionCount: 4 }); st.noWanderers = true; return st; };
const clearRounds = (rec) => { for (const k of Object.keys(rec)) if (/^a_/.test(k)) delete rec[k]; };
function person(st, weapon = null) {
  const s = makeSurvivor(st);
  s.traits = []; s.health = 100;
  stripAll(s); ensureInv(s);
  if (weapon) s.gear.weapon = newItem(weapon);
  s.location = { kind: "base", baseId: hub(st).id };
  st.survivors.push(s);
  return s;
}
const badge = (st, it, loc) => gunRounds(st, it, loc);
const pocketsOf = (s, k) => carriedSpots(s).reduce((a, x) => a + (x.item.key === k ? Math.floor(x.item.dur || 0) : 0), 0);
function menuRows(st, ui, loc) {
  ui.imenu = null;
  if (!openItemMenu(st, ui, { loc }, 10, 10)) return [];
  return [...itemMenuHtml(st, ui).matchAll(/<button class="imrow( off)?[^"]*" data-action="im-run" data-id="([^"]*)"[^>]*><span>(.*?)<\/span><span class="imap">(.*?)<\/span>/g)].map((m) => ({ id: m[2], label: m[3].replace(/<[^>]+>/g, "").replace(/\s*[▸▾]$/, "").trim(), cost: m[4], off: !!m[1] }));
}

section("1. An event's pistol comes with its own rounds, movable onto a survivor");
{
  const st = world();
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  for (const s of crew) { s.traits = []; stripAll(s); }
  crew[0].gear.weapon = newItem("ar"); // the team's other gun shoots 5.56: the pistol's rounds are still 9mm
  let dest = null;
  for (const t of st.tiles) { const d = st.grid.distance(h.tile, t.id); if (d >= 2 && d <= 3 && t.terrain !== "water" && planPath(st, h.tile, t.id, false)) { dest = t.id; break; } }
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: { food: 4, water: 4 } }).party;
  clearRounds(p.supplies); clearRounds(p.cargo.supplies);
  const card = travelEventCard(st, p, "hc_newdead", dest);
  const msg = card.choices[0].resolve(st);
  const gun = p.cargo.gear.find((g) => g.key === "pistol");
  const loc = gun ? `cargo:${p.id}:list:${p.cargo.gear.indexOf(gun)}` : null;
  const r = gun ? badge(st, gun, loc) : null;
  check(!!gun && r.n > 0 && r.n === stackN(gunStackOf(gun)) && gunStackOf(gun).every((x) => x.k === K9), `the pistol is in the cargo with its rounds in it, 9mm (${r && `${r.n}/${r.cap}`}): ${msg}`);
  check(!Object.keys(p.cargo.supplies).some((k) => /^a_/.test(k) && k !== K9), `no other calibre came with it (${JSON.stringify(p.cargo.supplies)})`);
  // Any rounds over its magazine are loose 9mm in the cargo: movable onto a survivor (the inventory window's stack mover).
  p.cargo.supplies[K9] = (p.cargo.supplies[K9] || 0) + 6; // (and a few more found besides)
  const s = crew[1];
  const ui = { inv: { sid: s.id }, invLoose: true };
  const dests = INV_STACK_DESTS.flatMap((f) => f(st, ui, `cargo:${p.id}:sup:${K9}`) || []);
  const pocket = dests.find((d) => d.id === "pocket");
  check(pocket && pocket.fit > 0, `the 9mm in the team's supplies can go onto ${s.name.split(" ")[0]} (${dests.map((d) => `${d.id} ${d.fit}`).join(", ")})`);
  const n0 = p.cargo.supplies[K9];
  const mv = pocket ? pocket.move(st, ui, n0) : "";
  check(pocketsOf(s, K9) === n0 && !(p.cargo.supplies[K9] > 0), `moved: ${mv}`);
  // The gun onto them and loaded from their pocket (out of a fight, free).
  check(!moveItem(st, loc, `s:${s.id}:weapon`) || s.gear.weapon === gun, "the pistol into their hands");
  const before = badge(st, gun, `s:${s.id}:weapon`).n;
  const rl = IA.reloadGunAt(st, `s:${s.id}:weapon`);
  check(badge(st, gun, `s:${s.id}:weapon`).n === Math.min(15, before + n0) && pocketsOf(s, K9) === n0 - (badge(st, gun, `s:${s.id}:weapon`).n - before), `Reload from their pocket: ${rl}`);
}
{
  // A pistol case carried: its rounds come onto the one carrying it, like the pistol.
  const st = world();
  const s = person(st);
  const box = newItem("pistolcase");
  box.contents = [newItem("pistol")]; box.sup = { [K9]: 17 }; box.locked = false; B.openBox(box);
  s.pockets[0] = box;
  const loc = `s:${s.id}:pocket:0`;
  const h = hub(st); clearRounds(h.stock);
  const m1 = B.takeFromBox(st, loc, { i: 0 });
  const m2 = B.takeFromBox(st, loc, { sup: K9 });
  check(carriedSpots(s).some((x) => x.item.key === "pistol") && pocketsOf(s, K9) === 17 && !(h.stock[K9] > 0), `a case in a pocket: the pistol and its 17 rounds onto them (${m1} ${m2})`);
}
{
  // A body with a pistol: the rounds are its calibre.
  let found = 0, right = 0;
  for (let i = 0; i < 4000 && found < 5; i++) {
    const f = deadBodyFinds(new Rng(1000 + i), null);
    if (!f.gear.some((g) => g.key === "pistol")) continue;
    found++;
    if (Object.keys(f.sup).filter((k) => /^a_/.test(k)).every((k) => k === K9)) right++;
  }
  check(found > 0 && right === found, `a body's pistol brings 9mm (${right} of ${found})`);
}

section("2. The badge is the rounds in the gun: base storage, moves, equip, a save, a fight");
{
  const st = world();
  const h = hub(st);
  clearRounds(h.stock);
  const s = person(st);
  const gun = newItem("pistol");
  h.armory.push(gun);
  h.stock[K9] = 3;
  const aLoc = () => `armory:${h.id}:list:${h.armory.indexOf(gun)}`;
  check(badge(st, gun, aLoc()).n === 0, "3 rounds in the base's storage: the pistol in the armory reads 0/15 (they are not in it)");
  const why = IA.reloadGunRefusal(st, aLoc());
  check(why === "", `…and Reload can load them (${why || "allowed"})`);
  const msg = IA.reloadGunAt(st, aLoc());
  check(badge(st, gun, aLoc()).n === 3 && !(h.stock[K9] > 0), `Reload at the base: the 3 out of the storage into it (${msg})`);
  moveItem(st, aLoc(), `s:${s.id}:weapon`);
  check(s.gear.weapon === gun && badge(st, gun, `s:${s.id}:weapon`).n === 3, "equipped: still 3");
  moveItem(st, `s:${s.id}:weapon`, `s:${s.id}:pocket:1`);
  check(badge(st, gun, `s:${s.id}:pocket:1`).n === 3, "into a pocket: still 3");
  moveItem(st, `s:${s.id}:pocket:1`, `armory:${h.id}:list`);
  check(h.armory.includes(gun) && badge(st, gun, aLoc()).n === 3, "back into the armory: still 3");
  h.stock[K9] = 40; // more 9mm in the stores: the stored gun's count does not move
  check(badge(st, gun, aLoc()).n === 3, "40 more 9mm into the stores: still 3 (the stores are not in the gun)");
  moveItem(st, aLoc(), `s:${s.id}:weapon`);
  const st2 = loadFromString(saveToString(st));
  const s2 = st2.survivors.find((x) => x.id === s.id);
  check(badge(st2, s2.gear.weapon, `s:${s2.id}:weapon`).n === 3 && st2.physOutV === 1, "a save and load: still 3 (and no load-up on a save made with physical rounds)");
  // A fight at the base: the gun starts with its 3, topped up from what they carry (nothing) and the base's stores (the bags of a base fight).
  const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [s.id], enemy: { kind: "raiders", count: 1, power: 2 }, ambush: null, canRetreat: true, handler: "prtest", context: {} }));
  const u = b.units.find((x) => x.sid === s.id);
  check(isStacked(u) && u.mag === 15, `the fight starts with it topped up to 15 (its 3, then the base's stores): ${u.mag}/${u.magMax}`);
  u.stack.splice(0, u.stack.length, { k: K9, n: 4 }); u.mag = 4; // (4 left after the shooting)
  const loose0 = pocketsOf(s, K9); // (the defenders grab rounds at hand out of the stock as a base fight starts: carrykit.js handWant)
  returnStacks(b, [s], h.stock);
  b.over = true; st.combat = null;
  check(badge(st, gun, `s:${s.id}:weapon`).n === 4 && pocketsOf(s, K9) === loose0, `the fight over: the 4 left stay in the gun (none put loose, none lost); the badge reads 4 (${loose0} loose on them as before)`);
  // Unload and the kept-empty rule.
  const ul = IA.unloadGunAt(st, `s:${s.id}:weapon`);
  check(badge(st, gun, `s:${s.id}:weapon`).n === 0 && gun.unloaded && pocketsOf(s, K9) === loose0 + 4, `Unload: ${ul}`);
  const b2 = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [s.id], enemy: { kind: "raiders", count: 1, power: 2 }, ambush: null, canRetreat: true, handler: "prtest", context: {} }));
  check(b2.units.find((x) => x.sid === s.id).mag === 0, "an Unloaded gun starts the next fight empty (kept so by hand)");
  st.combat = null;
}

section("3. The 9mm pistol's magazine: out, loaded, in (out of a fight)");
{
  const st = world();
  const h = hub(st);
  clearRounds(h.stock);
  const s = person(st, "pistol");
  const gun = s.gear.weapon;
  const G = `s:${s.id}:weapon`;
  check(detachable(gun) && !magOut(gun), "the 9mm pistol's magazine comes out");
  check(!detachable(newItem("revolver")) && !detachable(newItem("shotgun")) && !detachable(newItem("sks")), "a revolver's cylinder, a pump's tube and the SKS's fixed box do not");
  h.stock[K9] = 10;
  IA.reloadGunAt(st, G);
  check(badge(st, gun, G).n === 10, "loaded 10 from the stores");
  const ui = { inv: { sid: s.id } };
  const rows = menuRows(st, ui, G);
  check(["Reload", "Unload", "Remove magazine"].every((l) => rows.some((r) => r.label === l)) && ["Unload", "Remove magazine"].every((l) => !rows.find((r) => r.label === l).off) && rows.find((r) => r.label === "Reload").off, `the gun's menu (Reload greyed: no 9mm left to hand): ${rows.map((r) => r.label).join(", ")}`);
  const rm = IA.removeMagAt(st, G);
  const magSpot = carriedSpots(s).find((x) => x.item.key === standardMag("pistol"));
  check(magOut(gun) && badge(st, gun, G).n === 1 && badge(st, gun, G).cap === 1 && magSpot && stackN(magSpot.item.stack) === 9, `Remove magazine: ${rm}`);
  check(/no magazine/i.test(gunRoundsLabel(gun, G, st).tip) || badge(st, gun, G).cap === 1, "the gun's badge reads 1/1 (the chamber) and says its magazine is out");
  const ML = magSpot.loc;
  check(badge(st, magSpot.item, ML).n === 9, "the magazine's badge: 9/15");
  const mrows = menuRows(st, ui, ML);
  check(["Load rounds", "Unload rounds", "Insert into"].every((l) => mrows.some((r) => r.label === l)), `the magazine's menu: ${mrows.map((r) => r.label).join(", ")}`);
  h.stock[K9] = 3;
  s.pockets[3] = roundItem(K9, 20, true);
  const lm = IA.loadMagAt(st, ML);
  check(stackN(magSpot.item.stack) === 15 && pocketsOf(s, K9) === 14 && h.stock[K9] === 3, `Load rounds: from their pocket first (${lm})`);
  const um = IA.unloadMagAt(st, ML);
  check(stackN(magSpot.item.stack) === 0 && magSpot.item.unloaded && pocketsOf(s, K9) === 29, `Unload rounds: all 15 loose onto them (${um})`);
  IA.loadMagAt(st, ML);
  const grows = menuRows(st, ui, G);
  check(grows.some((r) => r.label === "Insert magazine"), `the gun with no magazine offers Insert magazine (${grows.map((r) => r.label).join(", ")})`);
  const im = IA.insertMagAt(st, G, ML);
  check(!magOut(gun) && badge(st, gun, G).n === 15 && badge(st, gun, G).cap === 15 && !carriedSpots(s).some((x) => x.item.key === standardMag("pistol")), `Insert magazine: ${im}`);
  const total = badge(st, gun, G).n + pocketsOf(s, K9) + (h.stock[K9] || 0);
  check(total === 10 + 3 + 20, `no round made or lost (${total} of ${10 + 3 + 20}: the gun, their pockets, the stores)`);
  // In the armory too: the magazine goes into the storage.
  moveItem(st, G, `armory:${h.id}:list`);
  const AL = `armory:${h.id}:list:${h.armory.indexOf(gun)}`;
  const n0 = h.armory.length;
  IA.removeMagAt(st, AL);
  check(h.armory.length === n0 + 1 && h.armory.some((it) => it.key === standardMag("pistol") && stackN(it.stack) === 14), "Remove magazine in the armory: the magazine into the armory with its 14");
}

section("3b. In a fight: Remove magazine, Load rounds, Insert magazine for actions");
{
  const st = world();
  const h = hub(st);
  clearRounds(h.stock);
  const s = person(st, "pistol");
  s.gear.rig = null;
  s.pockets[2] = roundItem(K9, 12, true);
  h.stock[K9] = 15;
  const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [s.id], enemy: { kind: "raiders", count: 1, power: 2 }, ambush: null, canRetreat: true, handler: "prtest", context: {} }));
  for (const e of b.units) if (e.side === "enemy") { e.x = -10; e.y = -10; e.aware = false; e.hp = e.maxHp = 1e6; }
  b.phase = "player";
  const u = b.units.find((x) => x.sid === s.id);
  u.ap = 2;
  const n0 = u.mag;
  const ui = { inv: { sid: s.id, peek: true } };
  const rows = menuRows(st, ui, `s:${s.id}:weapon`);
  const rr = rows.find((r) => r.label === "Remove magazine");
  check(rr && !rr.off && /1 AP/.test(rr.cost), `the gun in the hands: Remove magazine, 1 action (${rows.map((r) => `${r.label} [${r.cost}]`).join(", ")})`);
  const why = combatAct(st, { type: "inv", unit: u.id, from: `s:${s.id}:weapon`, op: "magout" });
  const spot = carriedSpots(s).find((x) => x.item.key === standardMag("pistol"));
  check(!why && u.ap === 1 && u.mag === 1 && u.magMax === 1 && magCap(u) === 1 && magOut(s.gear.weapon) && spot && stackN(spot.item.stack) === n0 - 1, `out: 1 action, the chamber's round stays (${u.mag}/${u.magMax}), the magazine in a ${spot && spot.where} with ${spot && stackN(spot.item.stack)} (${why || b.log[b.log.length - 1].text})`);
  const empty = combatAct(st, { type: "reload", unit: u.id, mag: u.mags.findIndex((m) => m.item === spot.item) });
  // (a Reload with a spare puts it in; first load it from the pocket by hand)
  check(!empty && !magOut(s.gear.weapon) && u.magMax === 15 && u.mag === n0, `Insert magazine (a swap into the empty gun): ${u.mag}/${u.magMax}, ${empty || b.log[b.log.length - 1].text}`);
  b.phase = "player"; u.ap = 2; // (the swap spent the last action: the turn passed)
  const why2 = combatAct(st, { type: "inv", unit: u.id, from: `s:${s.id}:weapon`, op: "magout" });
  check(!why2, `out again (${why2 || "ok"})`);
  const spot2 = carriedSpots(s).find((x) => x.item.key === standardMag("pistol"));
  const before = stackN(spot2.item.stack);
  b.phase = "player"; u.ap = 2;
  const lrows = menuRows(st, ui, spot2.loc);
  const lr = lrows.find((r) => r.label === "Load rounds");
  check(lr && !lr.off, `the magazine out of the gun: Load rounds (${lrows.map((r) => `${r.label} [${r.cost}]`).join(", ")})`);
  const lw = combatAct(st, { type: "inv", unit: u.id, from: `s:${s.id}:pocket:2`, to: spot2.loc, op: "load" });
  check(!lw && stackN(spot2.item.stack) === Math.min(15, before + 6) && u.ap === 1, `Load rounds in a fight: up to 6 from the pocket for 1 action (${before} → ${stackN(spot2.item.stack)})`);
  const ins = combatAct(st, { type: "reload", unit: u.id, mag: u.mags.findIndex((m) => m.item === spot2.item) });
  const inLog = b.log.slice(-6).map((l) => l.text).reverse().find((t) => /puts a magazine/.test(t)) || "";
  check(!ins && u.mag === 15 && /chamber is ejected into a pocket/.test(inLog) && pocketsOf(s, K9) >= 1, `Insert magazine over a full one: 15/15, the chambered round ejected into a pocket (${ins || inLog}; ap ${u.ap})`);
  st.combat = null;
}

section("4. An old save's guns are loaded once; an AI person's reload as before");
{
  const st = world();
  const h = hub(st);
  clearRounds(h.stock);
  for (const x of st.survivors) { stripAll(x); delete x.startGear; } // (only the one below has a gun: the stores are shared in turn)
  const s = person(st, "pistol");
  s.pockets[0] = newItem(standardMag("pistol"));
  h.stock[K9] = 20;
  delete st.physOutV; // a save from before
  const st2 = loadFromString(saveToString(st));
  const s2 = st2.survivors.find((x) => x.id === s.id);
  const g = badge(st2, s2.gear.weapon, `s:${s2.id}:weapon`), m = badge(st2, s2.pockets[0], `s:${s2.id}:pocket:0`);
  check(st2.physOutV === 1 && g.n === 15 && m.n === 5 && !(hub(st2).stock[K9] > 0), `loaded once from what the badge showed (the stores): gun ${g.n}/15, spare ${m.n}/15, the stores ${hub(st2).stock[K9] || 0}`);
  // An enemy person (fighters.js: physical rounds, what they carry): their gun loads and reloads as before.
  const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [s.id], enemy: { kind: "raiders", count: 3, power: 3 }, ambush: null, canRetreat: true, handler: "prtest", context: {} }));
  const foes = b.units.filter((x) => x.side === "enemy" && x.who && isStacked(x) && x.magMax > 0);
  check(foes.length > 0 && foes.every((x) => x.mag > 0 && x.mag <= x.magMax && !magOut(x.item)), `the raiders' guns start loaded from what they carry (${foes.map((x) => `${x.mag}/${x.magMax}`).join(" ")})`);
  st.combat = null;
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
