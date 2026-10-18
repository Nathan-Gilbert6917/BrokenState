// @ts-check
// Supplies onto a person's pockets, rig or pack, and the rig's pocket pouches (2026-10-18 user requests: "move x loose
// ammo or any other item in the stores into the pockets, rig, pack"; "add pocket for rigs that can be any item that
// pocket can hold and larger rigs can have more than one slot"; sim/supitems.js suppliesOnto / supRoom / placeSupplies /
// suppliesHeld, sim/teaminv.js loadFromBase / dropSupplies, sim/teammeet.js giveGoods, sim/teamform.js formPreview
// opts.onto, sim/data-kit.js "pocket" pouches, sim/inventory.js pouchReason / stow / quickMove, ui/inventory.js
// INV_STACK_DESTS):
//   - every rig has pocket pouches (two on the bigger ones) that take anything a pocket takes: fit reasons, moveItem,
//     stow and a double-click once the pockets are full, the starting-gear editor's order, an old save's rig growing them;
//   - any supply with an item form goes onto a member in the place picked (Load, Form a team, Give goods): water in
//     the pack (too big for a pocket, and it says so), meds in the rig's admin pouches by weight and then its pockets,
//     rounds loose or boxed, a food with its shelf; counts conserved against the stores, the team's pool untouched;
//   - back again: dropSupplies into the stores, unpackPerson when home;
//   - the inventory window's stores: a destination for each place with its fit, boxed or loose, a drop on a slot.
// Usage: node tools/supplyplacestest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, planPath, partyMembers } from "../src/sim/parties.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import { AMMO_STACK } from "../src/sim/data-stacks.js";
import { ADMIN_KG, POUCH_NAMES, SUPPLY_POUCHES } from "../src/sim/data-kit.js";
import { FOODS, addFood } from "../src/sim/foods.js";
import { newItem, stripAll, packOf, rigPouches, ensureInv, ensureRig, pouchReason, fitReason, moveItem, stow, quickMove, itemLoad, parseLoc } from "../src/sim/inventory.js";
import { wornLoad, maxLoad } from "../src/sim/load.js";
import { isRoundItem, amountOf, roundItem } from "../src/sim/itemstack.js";
import { supRoom, suppliesOnto, suppliesHeld, placeReason, roomOn, unpackPerson, itemKeyOf, SUP_PLACES, roundRoom, roundsHeld, ROUND_PLACES } from "../src/sim/supitems.js";
import { loadFromBase, dropSupplies, dropRounds } from "../src/sim/teaminv.js";
import { giveGoods } from "../src/sim/teammeet.js";
import { formTeam, formPreview } from "../src/sim/teamform.js";
import { carrySpec, firstFit } from "../src/sim/startgear.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { isRoundKey } from "../src/sim/rounds.js";
import { INV_STACK_DESTS, invDrop, INV_ACTIONS } from "../src/ui/inventory.js";
import { stackPanel } from "../src/ui/stackmove.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const K = "a_9mm_fmj";
const FOOD = "f_beans"; // 0.45 kg a can: small, six a slot
const LOOSE_POUCH = Math.floor((ADMIN_KG + 1e-9) / itemLoad(roundItem(K, 1, true))); // loose rounds an admin pouch takes
const MEDS_POUCH = Math.floor((ADMIN_KG + 1e-9) / SUPPLIES.meds.weight); // meds an admin pouch takes (5)
const MEDS_STACK = GEAR.s_meds.stack; // 20 a slot
const pocketIdx = (rigKey) => GEAR[rigKey].pouches.map((k, i) => (k === "pocket" ? i : -1)).filter((i) => i >= 0);

// ---------- a world with a team of `n` stood on the hub's tile (as tools/invfighttest.js) ----------
function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { water: 300, meds: 60, [K]: 400 });
  addFood(hub(state), FOOD, 40, { state, left: 500 });
  return state;
}
function tileNear(state, from, d, d2) {
  for (const t of state.tiles) {
    const dist = state.grid.distance(from, t.id);
    if (dist < d || dist > d2 || t.terrain === "water" || state.bases.some((b) => b.tile === t.id)) continue;
    if (planPath(state, from, t.id, false)) return t.id;
  }
  return null;
}
function team(state, n, skip = 0) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(skip, skip + n);
  for (const s of crew) { s.traits = []; stripAll(s); ensureInv(s); }
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: tileNear(state, h.tile, 2, 3), mission: "move", stance: "normal", supplies: { food: 2, water: 2 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [h.tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = [];
  return p;
}
const kitted = (s) => { s.gear.backpack = newItem("backpack"); s.gear.rig = newItem("chestrig"); return s; };
const onPerson = (s, k) => SUP_PLACES.reduce((a, w) => a + suppliesHeld(s, k, w, false) + (isRoundKey(k) ? suppliesHeld(s, k, w, true) : 0), 0); // (rounds in either form)
const L = (s, slot, i = null) => `s:${s.id}:${slot}${i == null ? "" : `:${i}`}`;

// ---------------------------------------------------------------------------------------------------------
section("The rig's pocket pouches: the data, the fit, moves, stow, a double-click, the editor, an old save");
{
  const n = (k) => GEAR[k].pouches.filter((x) => x === "pocket").length;
  check(n("chestrig") === 2 && n("tacvest") === 2 && n("makeshiftrig") === 1 && n("plate") === 1, `pocket pouches: chest rig ${n("chestrig")}, tactical vest ${n("tacvest")}, makeshift rig ${n("makeshiftrig")}, plate carrier ${n("plate")}`);
  check(POUCH_NAMES.pocket === "Pocket" && SUPPLY_POUCHES.includes("pocket") && SUPPLY_POUCHES.includes("admin") && ["chestrig", "tacvest", "makeshiftrig", "plate"].every((k) => { const P = GEAR[k].pouches; return P.lastIndexOf("admin") < P.indexOf("pocket"); }), "named, counted among the pouches that take supplies, and after the kinds a rig had (an old save's contents keep their places)");
  check(pouchReason(newItem("knife"), "pocket") === "" && pouchReason(newItem("pistol"), "pocket") === "" && pouchReason(roundItem(K, 150), "pocket") === "" && pouchReason(newItem("mag_stanag_30"), "pocket") === "", "a knife, a pistol, three boxes of rounds, a magazine: anything a pocket takes");
  check(/too big/.test(pouchReason(newItem("bat"), "pocket")) && /too big/.test(pouchReason(newItem("backpack"), "pocket")) && /too big/.test(fitReason(newItem("bat"), "pouch", null, "pocket")), `not a bat or a pack (${pouchReason(newItem("bat"), "pocket")})`);
  check(/admin pouch takes small things/.test(pouchReason(roundItem(K, 150), "admin")), "an admin pouch still keeps its weight (three boxes of rounds are too heavy for it)");
  const state = mk();
  const h = hub(state);
  const s = atBase(state, h.id)[0];
  s.traits = []; stripAll(s); ensureInv(s);
  kitted(s);
  const [p0, p1] = pocketIdx("chestrig");
  const knife = newItem("knife"), bat = newItem("bat");
  h.armory.push(knife, bat);
  let m = moveItem(state, `armory:${h.id}:list:${h.armory.indexOf(knife)}`, L(s, "rig", p0));
  check(rigPouches(s)[p0] === knife && /Rig pouch/.test(m), `a knife from the armory into the rig's pocket pouch (${m})`);
  m = moveItem(state, `armory:${h.id}:list:${h.armory.indexOf(bat)}`, L(s, "rig", p1));
  check(/too big/.test(m) && !rigPouches(s)[p1] && h.armory.includes(bat), `a bat is refused with why (${m})`);
  const phone = newItem("phone");
  let at = stow(s, phone);
  check(/pocket:0$/.test(at), `stow: the pockets first (${at})`);
  for (let i = 0; i < 4; i++) if (!s.pockets[i]) s.pockets[i] = newItem("knife");
  const candy = newItem("candy");
  at = stow(s, candy);
  check(at === L(s, "rig", p1) && rigPouches(s)[p1] === candy, `the pockets full: the rig's free pocket pouch (${at})`);
  const smokes = newItem("smokes");
  at = stow(s, smokes);
  const admins = GEAR.chestrig.pouches.map((k, i) => (k === "admin" ? i : -1)).filter((i) => i >= 0);
  check(at === L(s, "rig", admins[0]) && rigPouches(s)[admins[0]] === smokes, `both pocket pouches full: an admin pouch that takes it (${at})`);
  for (const i of admins) if (!rigPouches(s)[i]) rigPouches(s)[i] = newItem("bandagekit");
  at = stow(s, newItem("smokes"));
  check(at === L(s, "rig", admins[0]) && amountOf(rigPouches(s)[admins[0]]) === 2, `more smokes: onto the stack of them there (${at})`);
  at = stow(s, newItem("watch"));
  check(/pack:0$/.test(at), `those full too: the pack (${at})`);
  rigPouches(s)[p1] = null;
  const lighter = newItem("lighters");
  h.armory.push(lighter);
  m = quickMove(state, `armory:${h.id}:list:${h.armory.indexOf(lighter)}`, s.id);
  check(rigPouches(s)[p1] === lighter, `a double-click on an armory item with the pockets full: into the rig's pocket pouch (${m})`);
  // The starting-gear editor (sim/startgear.js carrySpec / firstFit): a pocket before the rig's pocket pouch.
  const spec = carrySpec({ slots: { rig: "chestrig", backpack: "backpack", armor: "" } });
  check(spec.pouch.n === GEAR.chestrig.pouches.length && spec.pouch.kinds.filter((k) => k === "pocket").length === 2, `the editor's containers: the chest rig's ${spec.pouch.n} pouches, two of them pockets`);
  let f = firstFit({ carry: {} }, "pistol", spec);
  check(f && f.where === "pocket" && f.i === 0, `a pistol (too heavy for an admin pouch): the first pocket (${f && f.where} ${f && f.i})`);
  f = firstFit({ carry: { pocket: ["pistol", "pistol", "pistol", "pistol"] } }, "pistol", spec);
  check(f && f.where === "pouch" && f.i === p0, `the pockets full: the rig's first pocket pouch (${f && f.where} ${f && f.i})`);
  f = firstFit({ carry: {} }, "knife", spec);
  check(f && f.where === "pouch" && GEAR.chestrig.pouches[f.i] === "admin", "a knife still goes to an admin pouch first, as the editor did before");
  f = firstFit({ carry: { pocket: ["knife", "knife", "knife", "knife"] } }, "mag_stanag_30", spec);
  check(f && f.where === "pouch" && GEAR.chestrig.pouches[f.i] === "rifle", "a magazine: its own pouch first, as before");
  // An old save's rig: its contents as long as its pouches were; the new pockets grow at the end.
  const old = newItem("chestrig");
  ensureRig(old);
  old.contents = old.contents.slice(0, old.contents.length - 2);
  const kit = newItem("bandagekit");
  const lastOld = old.contents.length - 1;
  old.contents[lastOld] = kit; // its last admin pouch
  s.gear.rig = old;
  const rp = rigPouches(s);
  check(rp.length === GEAR.chestrig.pouches.length && rp[lastOld] === kit && rp[p0] === null && rp[p1] === null, "ensureRig: the two pocket pouches added after the kit's own places, empty");
  const str = saveToString(state);
  const st2 = loadFromString(str);
  const s2 = st2.survivors.find((x) => x.id === s.id);
  check(s2 && rigPouches(s2).length === GEAR.chestrig.pouches.length && rigPouches(s2)[p0] === null && s2.gear.rig.contents.some((it) => it && it.key === "bandagekit"), "and a save round trip keeps them");
}

section("supRoom: what each place takes, and how much");
{
  const state = mk();
  const h = hub(state);
  const s = atBase(state, h.id)[0];
  s.traits = []; stripAll(s); ensureInv(s);
  check(roundRoom === supRoom && roundsHeld === suppliesHeld && ROUND_PLACES === SUP_PLACES && dropRounds === dropSupplies, "the first day's names are the same functions");
  check(supRoom(s, "meds", "pocket").n === 4 * MEDS_STACK, `four empty pockets take ${4 * MEDS_STACK} meds (${MEDS_STACK} a slot)`);
  let r = supRoom(s, "water", "pocket");
  check(r.n === 0 && /too big for a pocket/.test(r.why), `water (a litre) does not go in a pocket: 0, with why (${r.why})`);
  r = supRoom(s, "water", "pack");
  check(r.n === 0 && /wears no pack/.test(r.why), "no pack: 0, with why");
  r = supRoom(s, "meds", "rig");
  check(r.n === 0 && /wears no rig/.test(r.why), "no rig: 0, with why");
  kitted(s);
  const slots = packOf(s).length;
  const byLoad = Math.floor(maxLoad(s) - wornLoad(s) + 1e-9);
  check(supRoom(s, "water", "pack").n === Math.min(slots * GEAR.s_water.stack, byLoad), `water in the pack: ${slots} slots of ${GEAR.s_water.stack}, within their max load (${byLoad} kg free): ${supRoom(s, "water", "pack").n}`);
  check(supRoom(s, "meds", "rig").n === 2 * MEDS_POUCH + 2 * MEDS_STACK, `meds in the rig: two admin pouches (${MEDS_POUCH} each, ${ADMIN_KG} kg) and two pockets (${MEDS_STACK} each): ${supRoom(s, "meds", "rig").n}`);
  check(supRoom(s, K, "rig", true).n === 2 * LOOSE_POUCH + 2 * AMMO_STACK.LOOSE && supRoom(s, K, "rig", false).n === 2 * AMMO_STACK.BOXES * 50 + 2 * Math.floor((ADMIN_KG + 1e-9) / itemLoad(roundItem(K, 1))), `rounds in the rig loose ${supRoom(s, K, "rig", true).n}, boxed ${supRoom(s, K, "rig", false).n}`);
  r = supRoom(s, "carparts", "pack");
  check(r.n === 0 && /too big for a pack/.test(r.why), `car parts are bulky: not in a pack (${r.why})`);
  r = supRoom(s, "ammo", "pack");
  check(r.n === 0 && /not something to hold/.test(r.why) && !itemKeyOf("ammo"), `"ammo" (any calibre) has no item form (${r.why})`);
  check(/pockets, the pack or a rig/.test(placeReason(s, "hands")), "an unknown place is refused");
  check(roomOn(s, "meds") === (4 + 2 + packOf(s).length) * MEDS_STACK, `roomOn counts the pockets, the rig's pockets and the pack for a small supply (${roomOn(s, "meds")})`);
  s.gear.rig = newItem("makeshiftrig");
  check(supRoom(s, "meds", "rig").n === MEDS_POUCH + MEDS_STACK, `a makeshift rig: one admin pouch and one pocket (${supRoom(s, "meds", "rig").n})`);
  s.gear.rig = null; s.gear.armor = newItem("tacvest");
  check(supRoom(s, "meds", "rig").n === MEDS_POUCH + 2 * MEDS_STACK, `a tactical vest's own pouches: one admin pouch and two pockets (${supRoom(s, "meds", "rig").n})`);
}

section("Load from a base: water, meds, a food and rounds onto a member, in the place picked");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2);
  const [s0, s1] = partyMembers(state, p);
  kitted(s0);
  const water0 = h.stock.water, meds0 = h.stock.meds, food0 = h.stock[FOOD], packed = { ...p.supplies };
  let r = loadFromBase(state, p, { supplies: { water: 7 } }, { sid: s0.id, where: "pack" });
  const waters = packOf(s0).filter((it) => it && it.key === "s_water");
  check(r.moved.length === 1 && suppliesHeld(s0, "water", "pack") === 7 && h.stock.water === water0 - 7, `7 water into the pack (${r.text})`);
  check(waters.length === 2 && waters.map((it) => amountOf(it)).sort((a, b) => b - a).join(",") === "4,3" && (p.supplies.water || 0) === (packed.water || 0), "as two stacks (four a slot), none of it in the team's pool");
  r = loadFromBase(state, p, { supplies: { water: 2 } }, { sid: s0.id, where: "pocket" });
  check(!r.moved.length && /too big for a pocket/.test(r.text) && h.stock.water === water0 - 7, `water into the pockets: refused with why, nothing taken (${r.text})`);
  r = loadFromBase(state, p, { supplies: { meds: 12 } }, { sid: s0.id, where: "rig" });
  const kinds = GEAR.chestrig.pouches;
  const medsIn = (rigPouches(s0) || []).map((it, i) => ({ it, kind: kinds[i] })).filter((x) => x.it && x.it.key === "s_meds");
  check(r.moved.length === 1 && suppliesHeld(s0, "meds", "rig") === 12 && h.stock.meds === meds0 - 12, `12 meds into the rig (${r.text})`);
  check(medsIn.filter((x) => x.kind === "admin").map((x) => amountOf(x.it)).join(",") === `${MEDS_POUCH},${MEDS_POUCH}` && medsIn.filter((x) => x.kind === "pocket").map((x) => amountOf(x.it)).join(",") === `${12 - 2 * MEDS_POUCH}`, `the admin pouches first, ${MEDS_POUCH} each by weight, the rest in a pocket pouch`);
  r = loadFromBase(state, p, { supplies: { meds: 10 } }, { sid: s0.id, where: "rig" });
  check(suppliesHeld(s0, "meds", "rig") === 22 && medsIn.find((x) => x.kind === "pocket") && amountOf(medsIn.find((x) => x.kind === "pocket").it) === 12 - 2 * MEDS_POUCH + 10, "more meds: onto the pocket pouch's stack first");
  r = loadFromBase(state, p, { supplies: { [FOOD]: 9 } }, { sid: s0.id, where: "pocket" });
  const cans = s0.pockets.filter((it) => it && it.key === `s_${FOOD}`);
  check(r.moved.length === 1 && suppliesHeld(s0, FOOD, "pocket") === 9 && Math.round(h.stock[FOOD]) === food0 - 9, `9 cans of beans into the pockets (${r.text})`);
  check(cans.length === 2 && cans.every((it) => it.until != null && it.until > state.hour / 24 + 100), "two stacks (six a slot), each with the shelf its lot had");
  r = loadFromBase(state, p, { supplies: { [K]: 60 } }, { sid: s0.id, where: "pocket", loose: true });
  check(r.moved.length === 1 && suppliesHeld(s0, K, "pocket", true) === 60 && /loose/.test(r.text), `60 loose rounds into the pockets as before (${r.text})`);
  r = loadFromBase(state, p, { supplies: { water: 2, [FOOD]: 2 } }, s0.id);
  check(r.moved.length === 2 && (p.supplies.water || 0) === (packed.water || 0) + 2, "a bare member target: supplies into the team's pool, as before");
  r = loadFromBase(state, p, { supplies: { water: 2 } }, { sid: s1.id, where: "pack" });
  check(!r.moved.length && /wears no pack/.test(r.text), `someone with no pack: refused (${r.text})`);
  check(h.stock.water + onPerson(s0, "water") + (p.supplies.water || 0) - (packed.water || 0) === water0 && h.stock.meds + onPerson(s0, "meds") === meds0, "counts conserved: the stores, the person and the pool add up");
  // Back: dropSupplies into the stores (whole stacks or a part), and unpackPerson when home.
  r = dropSupplies(state, p, { sid: s0.id, key: "water", n: 5, where: "pack" });
  check(r.moved.length === 1 && suppliesHeld(s0, "water", "pack") === 2 && h.stock.water === water0 - 7 - 2 + 5, `dropSupplies: 5 water back into the stores, 2 stay (${r.text})`);
  r = dropSupplies(state, p, { sid: s0.id, key: "meds", n: 100, where: "rig" });
  check(suppliesHeld(s0, "meds", "rig") === 0 && h.stock.meds === meds0, "all the meds back when asked for more than there is");
  r = dropSupplies(state, p, { sid: s0.id, key: FOOD, n: 4, where: "pocket" });
  check(suppliesHeld(s0, FOOD, "pocket") === 5 && Math.round(h.stock[FOOD]) === food0 - 9 - 2 + 4, `4 cans back into the stores with their shelf (${r.text})`);
  const n = unpackPerson(state, s0, h);
  check(n === 7 && suppliesHeld(s0, "water", "pack") === 0 && suppliesHeld(s0, FOOD, "pocket") === 0 && suppliesHeld(s0, K, "pocket", true) === 60, `home: the supply items unpack into the stores (${n}), the rounds stay theirs`);
}

section("Forming a team: supplies onto a member from the window's picks");
{
  const state = mk();
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, 2);
  for (const s of crew) { s.traits = []; stripAll(s); ensureInv(s); }
  kitted(crew[0]);
  const base = { baseId: h.id, memberIds: crew.map((s) => s.id), supplies: { water: 2 } };
  let pre = formPreview(state, { ...base, onto: [{ key: "water", n: 3, sid: crew[0].id, where: "pocket" }] });
  check(/too big for a pocket/.test(pre.problem), `the preview refuses a place the thing does not go (${pre.problem})`);
  pre = formPreview(state, { ...base, onto: [{ key: "water", n: 3, sid: crew[1].id, where: "pack" }] });
  check(/wears no pack/.test(pre.problem), `and a place they do not have (${pre.problem})`);
  pre = formPreview(state, { ...base, onto: [{ key: "water", n: 299, sid: crew[0].id, where: "pack" }] });
  check(/Not enough/.test(pre.problem), `and more than the stores hold with the supplies (${pre.problem})`);
  pre = formPreview(state, { ...base, onto: [{ key: "water", n: 3, sid: crew[0].id, where: "pack" }, { key: "meds", n: 6, sid: crew[0].id, where: "rig" }, { key: K, n: 20, sid: crew[1].id, where: "pocket", loose: true }, { key: "ammo", n: 5, sid: crew[1].id, where: "pocket" }] });
  check(pre.problem === "" && pre.onto.length === 3 && pre.rounds === pre.onto, `three picks kept ("ammo" has no item form and is dropped), no problem (${pre.problem})`);
  pre = formPreview(state, { ...base, rounds: [{ key: K, n: 20, sid: crew[1].id, where: "pocket", loose: true }] });
  check(pre.problem === "" && pre.onto.length === 1, "the first day's opts.rounds still works");
  const water0 = h.stock.water, meds0 = h.stock.meds;
  const r = formTeam(state, { ...base, onto: [{ key: "water", n: 3, sid: crew[0].id, where: "pack" }, { key: "meds", n: 6, sid: crew[0].id, where: "rig" }, { key: K, n: 20, sid: crew[1].id, where: "pocket", loose: true }] });
  check(!r.error && r.party, `the team forms (${r.error || "ok"})`);
  check(suppliesHeld(crew[0], "water", "pack") === 3 && suppliesHeld(crew[0], "meds", "rig") === 6 && suppliesHeld(crew[1], K, "pocket", true) === 20, "3 water in the one's pack, 6 meds in their rig, 20 loose rounds in the other's pockets");
  check(h.stock.water === water0 - 2 - 3 && h.stock.meds === meds0 - 6 && !(r.party.supplies.meds > 0) && (r.party.supplies.water || 0) >= 2, "out of the stores on top of the team's supplies; none of it in the pool");
}

section("Teams together: supplies onto a member of the other team");
{
  const state = mk();
  const A = team(state, 1, 0), B = team(state, 1, 1);
  const [b0] = partyMembers(state, B);
  kitted(b0);
  A.supplies.water = 5;
  A.cargo.supplies.water = 3;
  A.supplies.meds = 4;
  const bWater = B.supplies.water || 0;
  let r = giveGoods(state, A, B, { supplies: { water: 6, meds: 4 } }, { sid: b0.id, where: "pack" });
  check(r.moved.length === 2 && suppliesHeld(b0, "water", "pack") === 6 && suppliesHeld(b0, "meds", "pack") === 4 && (B.supplies.water || 0) === bWater && !(B.cargo.supplies.water > 0) && !(B.supplies.meds > 0), `6 water and 4 meds into their pack, not the other team's pool (${r.text})`);
  check(A.cargo.supplies.water === undefined && A.supplies.water === 2 && !(A.supplies.meds > 0), "the found cargo's first, then the packed supplies (3 + 3)");
  r = giveGoods(state, A, B, { supplies: { water: 2 } }, { sid: b0.id, where: "pocket" });
  check(!r.moved.length && /too big for a pocket/.test(r.text) && A.supplies.water === 2, `water into the pockets: refused, nothing moves (${r.text})`);
  r = giveGoods(state, A, B, { supplies: { water: 2 } }, b0.id);
  check(r.moved.length === 1 && B.supplies.water === bWater + 2 && A.supplies.water === 0, "a bare member target: supplies go as they were (the pool), as before");
}

section("The inventory window: a stack in the stores onto a place of theirs");
{
  const state = mk();
  const h = hub(state);
  const s = atBase(state, h.id)[0];
  s.traits = []; stripAll(s); ensureInv(s);
  const ui = /** @type {any} */ ({ inv: { sid: s.id, loot: false }, invSel: null, invMsg: "", invLoose: false, stack: null });
  const dests = (k) => INV_STACK_DESTS.flatMap((f) => f(state, ui, `armory:${h.id}:sup:${k}`) || []);
  let d = dests(K);
  check(d.map((x) => x.id).join(",") === "pocket,hand" && d[0].fit === 4 * AMMO_STACK.BOXES * 50, `no rig, no pack: the pockets and the off hand (${d.map((x) => `${x.id} ${x.fit}`).join(", ")})`);
  kitted(s);
  d = dests(K);
  check(d.map((x) => x.id).join(",") === "pocket,pack,rig,hand" && d.every((x) => x.fit > 0), `with a rig and a pack: a destination for each place (${d.map((x) => `${x.id} ${x.fit}`).join(", ")})`);
  const stock0 = h.stock[K];
  let msg = d.find((x) => x.id === "pocket").move(state, ui, 30);
  check(suppliesHeld(s, K, "pocket", false) === 30 && h.stock[K] === stock0 - 30 && /boxed/.test(msg), `30 rounds into the pockets, boxed (${msg})`);
  ui.invLoose = true;
  d = dests(K);
  msg = d.find((x) => x.id === "rig").move(state, ui, 100);
  check(suppliesHeld(s, K, "rig", true) === 100 && h.stock[K] === stock0 - 130 && /loose/.test(msg), `100 loose rounds into the rig (admin pouches, then a pocket pouch) (${msg})`);
  d = dests("water");
  const pk = d.find((x) => x.id === "pocket");
  check(pk && pk.fit === 0 && /too big for a pocket/.test(pk.err) && d.find((x) => x.id === "pack").fit > 0 && d.find((x) => x.id === "hand").fit === GEAR.s_water.stack, `water: no room in the pockets with why, the pack and the off hand take it (${d.map((x) => `${x.id} ${x.fit}`).join(", ")})`);
  msg = d.find((x) => x.id === "pack").move(state, ui, 5);
  check(suppliesHeld(s, "water", "pack") === 5 && h.stock.water === 295, `5 water into the pack (${msg})`);
  // A drop on one of their slots opens the mover on that place; a click elsewhere on the first place with room.
  const loc = `armory:${h.id}:sup:meds`;
  invDrop(state, ui, loc, L(s, "pack", 2), false, false, { x: 10, y: 10 });
  check(ui.invSel === loc && ui.stack && ui.stack.ns === "inv" && ui.stack.to === "pack" && ui.stack.pop, "dropped on a pack slot: the mover opens on the pack");
  invDrop(state, ui, loc, L(s, "rig", 1), false, false, { x: 10, y: 10 });
  check(ui.stack && ui.stack.to === "rig", "on a rig pouch: the rig");
  invDrop(state, ui, loc, L(s, "tool"), false, false, { x: 10, y: 10 });
  check(ui.stack && ui.stack.to === "hand", "on the off hand: the off hand");
  INV_ACTIONS["inv-loose"](state, ui, { v: "0" });
  check(ui.invLoose === false && ui.stack && ui.stack.qty === null, "the boxed / loose chips: the form, and the amount picked again");
  ui.invSel = `armory:${h.id}:sup:${K}`; ui.stack = { ns: "inv", to: null, pop: null, qty: null };
  let html = stackPanel(state, ui, "inv");
  check(/data-action="inv-loose"/.test(html) && /class="mini active" data-action="inv-loose" data-v="0"/.test(html) && /smdest/.test(html) && /: rig/.test(html) && /: pack/.test(html) && /off hand/.test(html), "the mover on a stack of rounds: the destinations and the boxed / loose chips (boxed lit)");
  ui.invSel = `armory:${h.id}:sup:meds`; ui.stack = { ns: "inv", to: null, pop: null, qty: null };
  html = stackPanel(state, ui, "inv");
  check(!/inv-loose/.test(html) && /Move \d+ meds → /.test(html), "on meds: no form chips");
  INV_ACTIONS["inv-cancel"](state, ui, {});
  check(!ui.stack && !ui.invSel, "Cancel closes the mover");
  check(parseLoc(L(s, "rig", 1)).slot === "rig", "(the location strings resolve)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
