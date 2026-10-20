// The item right-click menu (src/ui/itemmenu.js; its rules src/sim/itemacts.js). Out of a fight (physical rounds,
// 2026-10-20): Load rounds / Load rounds with / Unload rounds on a magazine and Reload / Reload with / Unload on a gun
// move real rounds out of the stores and onto the person (an Unloaded one stays empty, also as a fight starts), eating and drinking from a base's stores and from the pack (raw food and un-purified
// water refused), the menu's rows for a gun, a magazine, a treat, a food stack and the pack. In a fight: a treat used
// (1 action from a pocket, 2 from the pack; refused in the enemy turn, with no actions left and on someone else's
// fighter), a bite from the pack lifting the aim that hunger cost (refitUnit), a gun part fitted and taken off in the
// gun builder over the battle (an action each; the unit's aim counts the sight at once), the menu's rows with their
// costs in actions and greyed out ones with a reason.
// Usage: node tools/itemmenutest.js [seed]
globalThis.window = globalThis.window || {};
const silent = () => new Proxy(() => {}, { get: (t, k) => (k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : k === "createImageData" ? (w, h) => ({ data: new Uint8ClampedArray(4 * w * h), width: w, height: h }) : silent()), apply: () => silent() }); // a canvas that draws nothing (the gun builder's picture)
globalThis.document = globalThis.document || { addEventListener() {}, getElementById() { return null; }, head: null, createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => silent(), toDataURL: () => "data:image/png;base64,AAAA" }) };
const { createWorld, makeSurvivor, hub } = await import("../src/sim/world.js");
const { createBattle, combatAct, registerCombatHandler } = await import("../src/sim/combat.js");
const { newItem, itemAt } = await import("../src/sim/inventory.js");
const { setRounds, giveRounds } = await import("../src/sim/ammo.js");
const { gunRounds } = await import("../src/sim/gunrounds.js");
const { stackN } = await import("../src/sim/roundstack.js");
const { keyFor } = await import("../src/sim/rounds.js");
const { addFood } = await import("../src/sim/foods.js");
const { rationOf } = await import("../src/sim/eating.js");
const IA = await import("../src/sim/itemacts.js");
const { openItemMenu, itemMenuHtml, ITEMMENU_ACTIONS } = await import("../src/ui/itemmenu.js");
const { GB_ACTIONS, gunBuilderModal } = await import("../src/ui/gunbuilder.js");

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("imtest", () => {});

function person(state, weapon = "ar") {
  const s = makeSurvivor(state);
  s.traits = [];
  s.health = 100; s.hunger = 90; s.thirst = 90;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
const fresh = () => { const st = createWorld({ seed, factionCount: 4 }); st.survivors = []; st.parties = []; return st; };
// The menu's rows as text (a fresh ui each time): [label, cost, greyed out].
function menu(state, ui, loc, extra = {}) {
  ui.imenu = null;
  if (!openItemMenu(state, ui, { loc, ...extra }, 10, 10)) return [];
  const html = itemMenuHtml(state, ui);
  return [...html.matchAll(/<button class="imrow( off)?[^"]*" data-action="im-run" data-id="([^"]*)"[^>]*><span>(.*?)<\/span><span class="imap">(.*?)<\/span>/g)].map((m) => ({ id: m[2], label: m[3].replace(/<[^>]+>/g, "").replace(/\s*[▸▾]$/, "").trim(), cost: m[4], off: !!m[1] }));
}
const rowOf = (rows, re) => rows.find((r) => re.test(r.label));
const run = (state, ui, id) => ITEMMENU_ACTIONS["im-run"](state, ui, { id });

// 1. Magazines and guns out of a fight: physical rounds (2026-10-20: the badge counts what is in it; Load rounds,
// Unload rounds, Reload, Reload with and Unload move real rounds, free, out of what the holder carries and the stores).
{
  console.log("Magazines and guns out of a fight");
  const state = fresh();
  const h = hub(state);
  setRounds(h.stock, 0); giveRounds(h.stock, 200, ["ar"]);
  const s = person(state);
  s.pockets[0] = newItem("mag_stanag_30");
  const ml = `s:${s.id}:pocket:0`;
  const K = "a_556_fmj";
  const loose = () => s.pockets.reduce((a, it) => a + (it && it.key === K ? Math.floor(it.dur || 0) : 0), 0);
  check(gunRounds(state, s.pockets[0], ml).n === 0, "a new spare magazine shows what is in it: nothing (0/30), whatever the stores hold");
  const k0 = h.stock[K];
  check(IA.loadMagAt(state, ml).startsWith("Loaded") && gunRounds(state, s.pockets[0], ml).n === 30 && h.stock[K] === k0 - 30, `Load rounds: 30 out of the base's stores into it (${k0} → ${h.stock[K]})`);
  check(/full/.test(IA.loadMagRefusal(state, ml)), "…a full one takes no more");
  check(/^30 rounds out/.test(IA.unloadMagAt(state, ml)) && s.pockets[0].unloaded === true && stackN(s.pockets[0].stack) === 0 && loose() === 30, `Unload rounds: all 30 out onto them as loose rounds (${loose()}), the magazine kept empty`);
  check(gunRounds(state, s.pockets[0], ml).n === 0 && gunRounds(state, s.pockets[0], ml).src === "unloaded", "…its rounds badge reads 0, 'unloaded'");
  check(/empty/.test(IA.unloadMagRefusal(state, ml)), "…a second Unload is refused");
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: [s.id], enemy: { kind: "raiders", count: 1, power: 2 }, ambush: null, canRetreat: true, handler: "imtest", context: {} }));
  const u = b.units.find((x) => x.sid === s.id);
  const spare = u.mags && u.mags.find((x) => x.where === "pocket");
  check(spare && spare.n === 0, "a fight starts with the unloaded spare empty (mags.js fillUnit), the rounds on them or not");
  check(/Not in the middle of a fight/.test(IA.loadMagRefusal(state, ml)), "…and it cannot be loaded out of a fight's rules in the fight");
  state.combat = null;
  for (const it of s.pockets) if (it && it.key !== "mag_stanag_30") delete it.stack;
  s.gear.weapon.loaded = null; delete s.gear.weapon.loaded;
  const choices = IA.magLoadChoices(s.pockets[0]);
  check(choices.length > 1, `a STANAG magazine takes ${choices.length} kinds of round`);
  const other = choices.find((x) => x.id !== "fmj") || choices[1];
  const OK = keyFor("556", other.id);
  h.stock[OK] = 40;
  const lw = IA.loadMagAt(state, ml, other.id);
  check(lw.startsWith("Loaded") && !s.pockets[0].unloaded && s.pockets[0].load === other.id && s.pockets[0].stack[0].k === OK && h.stock[OK] === 10, `Load rounds with ${other.name}: 30 of them in it, its own round (${lw})`);
  // A gun: Reload with a kind loads it now (and it takes the field with it); Unload takes them out again.
  const gl = `s:${s.id}:weapon`;
  const loads = IA.gunLoadChoices(s.gear.weapon);
  const alt = loads.find((x) => x.id === other.id) || loads[1];
  const rw = IA.setGunLoad(state, gl, alt.id);
  check(alt && /^Loaded 10 /.test(rw) && s.gear.weapon.load === alt.id && gunRounds(state, s.gear.weapon, gl).n === 10, `Reload with ${alt && alt.name}: the 10 left loaded now, item.load set (${rw})`);
  check(/does not take/.test(IA.setGunLoad(state, gl, "zz")), "…a round it does not take is refused");
  const rl = IA.reloadGunAt(state, gl);
  check(gunRounds(state, s.gear.weapon, gl).n === 30 && /^Loaded 20/.test(rl), `Reload: topped up to 30 from the loose rounds on them and the stores (${rl})`);
  check(/full/.test(IA.reloadGunRefusal(state, gl)), "…a full gun is refused");
  const lo0 = loose();
  check(/30 rounds/.test(IA.unloadGunAt(state, gl)) && !s.gear.weapon.loaded && s.gear.weapon.unloaded === true, "Unload: its 30 rounds out, kept empty");
  check(/empty/.test(IA.unloadGunRefusal(state, gl)), "…a second Unload is refused");
  check(s.pockets.reduce((a, it) => a + (it && /^a_556/.test(it.key) ? Math.floor(it.dur || 0) : 0), 0) - lo0 === 30, "…the 30 are loose on them");
  // The rows.
  const ui = { inv: { sid: s.id } };
  const g = menu(state, ui, gl);
  check(["Inspect", "Put in the armory", "Reload", "Reload with", "Unload", "Remove magazine", "Modify", "Repair"].every((l) => g.some((r) => r.label.startsWith(l))), `a gun's menu: ${g.map((r) => r.label).join(", ")}`);
  const mg = menu(state, ui, ml);
  check(rowOf(mg, /^Load rounds$/) && rowOf(mg, /^Load rounds with$/) && rowOf(mg, /^Unload rounds$/) && rowOf(mg, /^Insert into$/) && rowOf(mg, /^Fit to$/), `a magazine's menu: ${mg.map((r) => r.label).join(", ")}`);
  run(state, ui, rowOf(mg, /^Unload rounds$/).id);
  check(s.pockets[0].unloaded === true && /out of the/.test(ui.invMsg) && ui.imenu === null, "…Unload rounds from the menu: done, the message shown, the menu closed");
  check(rowOf(menu(state, ui, ml), /^Load rounds$/) && !rowOf(menu(state, ui, ml), /^Load rounds$/).off, "…then Load rounds can be done");
  ui.imenu = null; openItemMenu(state, ui, { loc: gl }, 10, 10);
  run(state, ui, "reloadwith");
  check(ui.imenu && ui.imenu.open === "reloadwith" && /✓/.test(itemMenuHtml(state, ui)), "Reload with opens its rounds (the gun's own ticked), the menu stays open");
}

// 2. Eating and drinking out of a fight.
{
  console.log("Eating and drinking");
  const state = fresh();
  const h = hub(state);
  const s = person(state, null);
  s.hunger = 30; s.thirst = 40;
  addFood(h, "f_beans", 10, { state });
  h.stock.water = 20;
  addFood(h, "f_venison", 3, { state });
  h.stock.rawwater = 10;
  const beans = h.stock.f_beans;
  const msg = IA.useStack(state, s.id, `armory:${h.id}:sup:f_beans`);
  check(s.hunger > 30 && h.stock.f_beans < beans && /eats/.test(msg), `Eat from the stores: ${msg}`);
  const w = h.stock.water;
  check(/drinks/.test(IA.useStack(state, s.id, `armory:${h.id}:sup:water`)) && s.thirst > 40 && h.stock.water < w, "Drink from the stores");
  check(/Raw/.test(IA.stackUseRefusal(state, s, `armory:${h.id}:sup:f_venison`)), "raw venison is refused (cook it first)");
  check(/worm/.test(IA.stackUseRefusal(state, s, `armory:${h.id}:sup:rawwater`)), "un-purified water is refused");
  s.hunger = 100;
  check(/full/.test(IA.stackUseRefusal(state, s, `armory:${h.id}:sup:f_beans`)), "someone full is refused");
  // The pack.
  s.hunger = 30; s.thirst = 30;
  addFood(rationOf(s), "f_beans", 2, { state });
  rationOf(s).supplies.water = 1.5;
  check(/eats from their pack/.test(IA.usePack(state, s.id, "eat")) && s.hunger > 30, "Eat from the pack");
  check(/drinks/.test(IA.usePack(state, s.id, "drink")) && s.thirst > 30, "Drink from the pack");
  const ui = { inv: { sid: s.id } };
  const r = menu(state, ui, `ration:${s.id}`, { imenu: `ration:${s.id}` });
  check(rowOf(r, /^Eat from the pack/) && rowOf(r, /^Drink/), `the "Food on them" line's menu: ${r.map((x) => x.label).join(", ")}`);
  const st = menu(state, ui, `armory:${h.id}:sup:f_beans`);
  check(rowOf(st, /^Eat/), `a food stack's menu: ${st.map((x) => x.label).join(", ")}`);
  // Food and water carried as items (supitems.js s_<key>): eaten out of the pocket, the can gone when used up.
  s.hunger = 40; s.thirst = 40;
  s.pockets[1] = { ...newItem("s_f_beans"), dur: 3 };
  const can = menu(state, ui, `s:${s.id}:pocket:1`);
  check(rowOf(can, /^Eat$/) && !rowOf(can, /^Eat$/).off, `beans carried in a pocket: ${can.map((x) => x.label).join(", ")}`);
  check(/eats/.test(IA.useStack(state, s.id, `s:${s.id}:pocket:1`)) && s.hunger > 40 && (!s.pockets[1] || s.pockets[1].dur < 3), "…eaten from the pocket (whole cans)");
  s.pockets[2] = { ...newItem("s_f_beans"), dur: 1, egg: true };
  check(/eggs/.test(IA.stackUseRefusal(state, s, `s:${s.id}:pocket:2`)), "…a can with the worm's eggs is refused");
  s.pockets[2] = { ...newItem("s_water"), dur: 2 };
  check(/drinks/.test(IA.useStack(state, s.id, `s:${s.id}:pocket:2`)) && s.thirst > 40, "water carried: drunk");
  const t2 = person(state, null);
  s.pockets[3] = { ...newItem("s_f_beans"), dur: 2 };
  check(/Only the one carrying it/.test(IA.stackUseRefusal(state, t2, `s:${s.id}:pocket:3`)), "…someone else's can is not eaten by another");
  s.pockets[0] = newItem("chocolate");
  const ch = menu(state, ui, `s:${s.id}:pocket:0`);
  check(rowOf(ch, /^Eat it/), `a treat's menu: ${ch.map((x) => x.label).join(", ")}`);
}

// 3. In a fight.
{
  console.log("In a fight");
  const state = fresh();
  const h = hub(state);
  setRounds(h.stock, 0); giveRounds(h.stock, 300, ["ar"]); h.stock.meds = 3;
  const s = person(state);
  const t = person(state);
  s.pockets[0] = newItem("chocolate");
  s.pockets[1] = newItem("reddot");
  s.hunger = 5; // starving: the aim pays for it (needs.js needsAim)
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: [s.id, t.id], enemy: { kind: "raiders", count: 1, power: 2 }, ambush: null, canRetreat: true, handler: "imtest", context: {} }));
  b.phase = "player";
  const u = b.units.find((x) => x.sid === s.id);
  const v = b.units.find((x) => x.sid === t.id);
  for (const x of b.units) if (x.side === "player") x.ap = 2;
  const ui = { inv: { sid: s.id, peek: true } };
  const rows = menu(state, ui, `s:${s.id}:weapon`);
  const rl = rowOf(rows, /^Reload$/), md = rowOf(rows, /^Modify$/), rp = rowOf(rows, /^Repair$/);
  check(rl && /AP/.test(rl.cost) && md && /1 AP a part/.test(md.cost) && rp && rp.off, `the gun in the hands in a fight: ${rows.map((r) => `${r.label} [${r.cost}${r.off ? ", greyed" : ""}]`).join(", ")}`);
  const ch = rowOf(menu(state, ui, `s:${s.id}:pocket:0`), /^Eat it/);
  check(ch && ch.cost === "1 AP" && !ch.off, "a chocolate bar in a pocket: Eat it, 1 AP");
  const mood0 = s.mood;
  const err = combatAct(state, { type: "useItem", unit: u.id, what: "treat", loc: `s:${s.id}:pocket:0` });
  check(!err && u.ap === 1 && !s.pockets[0] && s.mood !== mood0, `eaten in the fight: 1 action, gone, mood ${Math.round(mood0)} → ${Math.round(s.mood)}`);
  // Kit moves from the menu (combatAct "inv", 1 action): a pistol in a pocket drawn into empty hands (a rifle in the
  // hands would have nowhere to go: refused, as the kit view refuses it); a can carried, eaten.
  const { refitUnit } = await import("../src/sim/combat.js");
  const rifle = s.gear.weapon;
  s.pockets[2] = newItem("pistol");
  u.ap = 2;
  menu(state, ui, `s:${s.id}:pocket:2`);
  ITEMMENU_ACTIONS["im-run"](state, ui, { id: "equip" });
  check(s.gear.weapon === rifle && /No room/.test(ui.invMsg) && u.ap === 2, `with the rifle in the hands: refused, no action spent (${ui.invMsg})`);
  s.gear.weapon = null; refitUnit(b, u, s);
  const dr = rowOf(menu(state, ui, `s:${s.id}:pocket:2`), /^Draw/);
  check(dr && dr.cost === "1 AP" && !dr.off, "a pistol in a pocket, the hands empty: Draw (to the hands), 1 AP");
  ITEMMENU_ACTIONS["im-run"](state, ui, { id: "equip" });
  check(s.gear.weapon && s.gear.weapon.key === "pistol" && !s.pockets[2] && u.ap === 1 && u.weapon === "pistol", "…drawn: in the hands and in use at once, 1 action");
  s.gear.weapon = rifle; refitUnit(b, u, s); // the rifle back (by hand, for the checks below)
  s.pockets[2] = { ...newItem("s_f_beans"), dur: 2 };
  u.ap = 2;
  check(!combatAct(state, { type: "useItem", unit: u.id, what: "stack", loc: `s:${s.id}:pocket:2` }) && u.ap === 1, "a can of beans carried, eaten in the fight: 1 action");
  // A bite from the pack: 2 actions; the aim hunger cost comes back.
  addFood(rationOf(s), "f_beans", 3, { state });
  u.ap = 2;
  const aim0 = u.aim;
  check(!combatAct(state, { type: "useItem", unit: u.id, what: "eat" }) && u.ap === 0 && s.hunger > 5 && u.aim > aim0, `a bite from the pack: 2 actions, hunger 5 → ${Math.round(s.hunger)}, aim ${Math.round(aim0)} → ${Math.round(u.aim)}`);
  // Someone else's turn is over, theirs is not: refusals.
  check(/actions|cannot act/.test(combatAct(state, { type: "useItem", unit: u.id, what: "drink" }) || ""), "no actions left: refused");
  const rv = rowOf(menu(state, ui, `ration:${s.id}`, { imenu: `ration:${s.id}` }), /^Eat from the pack/);
  check(rv && rv.off && rv.cost === "2 AP", "…and the menu greys the row out (2 AP)");
  check(/Only what they carry/.test(combatAct(state, { type: "useItem", unit: v.id, what: "treat", loc: `s:${s.id}:pocket:1` }) || ""), "a teammate cannot use what another carries");
  // The gun builder over the battle: the red dot from the pocket onto the rifle, then off again.
  u.ap = 2;
  const ui2 = { inv: { sid: v.sid, peek: true } };
  GB_ACTIONS["gb-open"](state, ui2, { loc: `s:${s.id}:weapon`, sid: s.id });
  check(ui2.gunb && ui2.gunb.battle === u.id && gunBuilderModal(state, ui2), "Modify in a fight opens the gun builder over the battle (the fighter's own gun)");
  const gm0 = JSON.stringify(u.gm || {});
  ui2.gunb.slot = "optic";
  const html = gunBuilderModal(state, ui2);
  check(/Red dot|red dot/i.test(html) && /1 AP/.test(html), "…its sight list has the red dot from the pocket, 1 AP");
  GB_ACTIONS["gb-fit"](state, ui2, { slot: "optic", part: `s:${s.id}:pocket:1` });
  check(s.gear.weapon.mods && s.gear.weapon.mods.optic && !s.pockets[1] && u.ap === 1, `fitted: on the rifle, out of the pocket, 1 action (${ui2.gunb.msg})`);
  check(JSON.stringify(u.gm || {}) !== gm0, "…the fighter's gun numbers change at once (refitUnit)");
  GB_ACTIONS["gb-strip"](state, ui2, { slot: "optic" });
  check(!(s.gear.weapon.mods && s.gear.weapon.mods.optic) && s.pockets.some((x) => x && x.key === "reddot") && u.ap === 0, "taken off again: back in a pocket, the last action");
  check(/action|cannot act/.test(combatAct(state, { type: "modPart", unit: u.id, gun: `s:${s.id}:weapon`, slot: "optic", part: `s:${s.id}:pocket:${s.pockets.findIndex((x) => x && x.key === "reddot")}` }) || ""), "no actions left: a part cannot be fitted");
  b.phase = "enemy";
  const er = rowOf(menu(state, ui, `s:${s.id}:weapon`), /^Reload$/);
  check(er && er.off, "the enemy turn: the rows are greyed out");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
