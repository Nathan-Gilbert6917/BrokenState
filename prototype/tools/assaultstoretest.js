// Raiding a group's stores in an assault (2026-10-19, the user's request: "have AI groups build storage units etc so the
// player can raid their supplies"; src/sim/assaultstores.js). Checks:
//   - the map: storming a group's base (conquest.js "baseAssault", the fort map) lays their storage (their main house,
//     a storehouse block, crates for their storage crates and box, an armory's gun cage and ammo lockers) with walkable
//     ground next to every container, and piles in the yard for what their room does not hold;
//   - the goods: the containers hold exactly that base's stock (whole units, no water) and their spare kit, the piles
//     exactly what basestorage.js storageOf says lies outside (basemap.js outsideOf), the rest by room inside; the same
//     battle laid twice is the same;
//   - taking: one of yours next to a container takes into their carried finds (raidloot.js raidMove), not from further
//     off, not before the fight starts; HAUL's time (the first 8 kg a turn free, then 12 kg an action), a pile twice as
//     quick (STEAL.PILE); their max load (personalRoom); the hands (two different things carried: nothing more); a
//     locked container refused until its lock is forced open (combatAct "forceStore");
//   - the end: a win brings what your people carry into the team's cargo and takes exactly that out of the base's stock
//     and the group's kit, and the conquest half is of what is left; a retreat with your people out keeps it; one left
//     behind leaves theirs with the group; a defeat leaves it all with them;
//   - a save mid-battle keeps the stores (one object in the stores and the loot layer, their items the group's own) and
//     the fight goes on from it;
//   - by the numbers (no map) nothing of this happens.
// Usage: node tools/assaultstoretest.js [seed]
import { createWorld, hub, makeSurvivor } from "../src/sim/world.js";
import { createBattle, combatAct, CELL, unitAt, endBattleNow, closeCombat, startCombat } from "../src/sim/combat.js";
import { addBuilding } from "../src/sim/buildings.js";
import { homeAt } from "../src/sim/groupbases.js";
import { assaultForce, CONQUEST } from "../src/sim/conquest.js";
import { launchExpedition } from "../src/sim/parties.js";
import { spareKit } from "../src/sim/loadouts.js";
import { storageOf } from "../src/sim/basestorage.js";
import { outsideOf, PILE, STEAL, ARMORY_LOCK } from "../src/sim/basemap.js";
import { raidMove, haulBudget, personalRoom, HAUL } from "../src/sim/raidloot.js";
import { assaultGoods } from "../src/sim/assaultstores.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { GEAR } from "../src/sim/data.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();

// A world with a group whose main base has walls and storage, and a team of yours at its gates.
function setup(opts = {}) {
  const st = createWorld({ seed: SEED, factionCount: 6 });
  st.started = true; st.noNewGangs = true;
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const tile = f.bases[0];
  const h = homeAt(st, f, tile);
  for (const t of ["walls", "storehouse", "crates", "storebox", ...(opts.armory ? ["armory"] : [])]) addBuilding(h, t);
  h.stock.scrap = opts.scrap ?? 2000; // more than their room: piles outside
  h.stock.meds = 40;
  h.stock.fuel = 30;
  const team = [];
  for (let i = 0; i < 3; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.health = 100; s.skills.shooting = 10;
    s.gear.weapon = { key: "shotgun", name: GEAR.shotgun.name, quality: 1 };
    s.location = { kind: "base", baseId: hub(st).id };
    st.survivors.push(s); team.push(s);
  }
  const p = launchExpedition(st, { memberIds: team.map((s) => s.id), dest: tile, mission: "assault", stance: "normal", supplies: { food: 6, water: 6 } }).party;
  p.path = [tile]; p.idx = 0;
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  const force = assaultForce(st, f, tile, p);
  force.walls = opts.walls ?? Math.max(3, force.walls); // the fort map (0: the old wall-line map with no wall)
  const su = { tile, partyId: p.id, enemy: { ...force }, ambush: null, canRetreat: true, handler: "baseAssault", layout: "baseAssault", context: { partyId: p.id, factionId: f.id, tile, people: force.people } };
  return { st, f, h, tile, p, su };
}
function battle(w) {
  const b = (w.st.combat = createBattle(w.st, w.su));
  return b;
}
const start = (st) => combatAct(st, { type: "start" });
const mine = (b) => b.units.filter((u) => u.side === "player");
const inRect = (c, x, y) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
function besideOf(b, c) {
  for (let y = c.y - 1; y <= c.y + c.h; y++) for (let x = c.x - 1; x <= c.x + c.w; x++) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h || inRect(c, x, y)) continue;
    if (CELL[b.cells[y * b.w + x].k].walk && !unitAt(b, x, y)) return [x, y];
  }
  return null;
}
const putNext = (b, u, c) => { const at = besideOf(b, c); u.x = at[0]; u.y = at[1]; u.ap = 2; delete u.hands; u.haul.sup = {}; u.haul.gear = []; u.haulTurn = b.turn; u.hauledKg = 0; return at; };
const sumSup = (list) => { const o = {}; for (const c of list) for (const [k, n] of Object.entries(c.contents.sup)) if (n > 0) o[k] = (o[k] || 0) + n; return o; };
const same = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => (a[k] || 0) === (b[k] || 0));
const box = (b, label) => b.stores.containers.find((c) => c.label === label);

// ======================================================================
section("Their stores on the assault map");
{
  const w = setup({ armory: true });
  const b = battle(w);
  const S = b.stores && b.stores.containers;
  check(S && S.length > 0 && b.assaultStores, `the assault map has their stores (${S ? S.map((c) => `${c.label} ${Math.round(c.kg)} kg`).join("; ") : "none"})`);
  const G = assaultGoods(w.st, w.su);
  const st = storageOf(w.st, G.view);
  check(G.view.stock.scrap === Math.floor(w.h.stock.scrap) && G.view.stock.scrap > 1900 && !("water" in G.view.stock), "the goods are that base's own stock, in whole units, without the water in its tanks");
  check(G.view.armory.length === spareKit(w.f).length && G.view.armory.every((it) => w.f.arsenal.items.includes(it)), `with the group's spare kit at the main base (${G.view.armory.length} items, their own objects)`);
  const core = S.find((c) => c.room === st.containers.find((x) => x.kind === "core").cap && !c.pile && c.bid == null);
  check(!!core && b.deployPlan.fort.buildings.some((s) => s.x0 === core.x && s.y0 === core.y && !s.roof), `their core (${st.containers[0].name}, ${st.containers[0].cap} kg) is their main house on the map (${core && core.label})`);
  const sh = box(b, "Storehouse"), cr = box(b, "Storage crates"), sb = box(b, "Storage box");
  check(sh && sh.room === 2000 && b.deployPlan.fort.buildings.some((s) => s.key === "storehouse" && s.x0 === sh.x && s.y0 === sh.y), "the storehouse is their Storehouse block, 2000 kg");
  check(cr && cr.room === 150 && cr.w * cr.h === 2 && sb && sb.room === 60 && sb.w * sb.h === 1, "the crates and the box are crates in the yard (2 × 1, 1 × 1) with their room");
  const cage = S.find((c) => c.holds === "gear"), lockers = S.find((c) => c.holds === "ammo");
  check(cage && lockers && cage.lock && !cage.lock.open && cage.lock.hp === ARMORY_LOCK.HP && lockers.lock, "an armory: the gun cage and the ammo lockers, locked");
  const crates = S.filter((c) => c.pile || (c.bid != null && c.w * c.h <= 2 && c !== sh));
  check(crates.every((c) => { for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) if (b.cells[y * b.w + x].k !== "crate") return false; return true; }), "the crates are crate cells");
  check(S.every((c) => !!besideOf(b, c)), "every container has walkable ground next to it");
  // Exactly their goods.
  const all = sumSup(S);
  check(same(all, G.view.stock), `the containers hold exactly the base's stock (${Object.keys(all).length} kinds, ${all.scrap} scrap)`);
  const items = S.flatMap((c) => c.contents.gear);
  check(items.length === G.view.armory.length && G.view.armory.every((it) => items.includes(it)), `and exactly their spare kit (${items.length} items: ${items.map((it) => it.name).join(", ")})`);
  check(items.every((it) => cage.contents.gear.includes(it)), "every item kept inside is in the armory's gun cage");
  const out = outsideOf(w.st, G.view);
  const piles = S.filter((c) => c.pile);
  check(out && piles.length === Math.max(1, Math.min(PILE.MAX, Math.ceil(out.kg / PILE.KG))), `what their room does not hold lies on ${piles.length} piles (${Math.round(out ? out.kg : 0)} kg outside)`);
  check(out && same(sumSup(piles), out.sup), `the piles hold exactly what lies outside (${JSON.stringify(out && out.sup)})`);
  const inside = S.filter((c) => !c.pile && !c.holds);
  const roomTot = inside.reduce((a, c) => a + c.room, 0);
  check(inside.every((c) => c.kg <= c.room * 1.5 + 1) && Math.abs(inside.reduce((a, c) => a + c.kg, 0) - (st.used - st.outsideKg)) < 120, `the rest is spread inside by room (${inside.map((c) => `${c.label} ${Math.round(c.kg)}/${c.room}`).join(", ")}; ${roomTot} kg of room)`);
  check(S.every((c) => b.fieldLoot.containers.includes(c) && c.kind === "store" && c.contents.sup === c.sup), "each one is a container of the battle's loot layer too (the same object)");
  check(piles.every((c) => c.haulRate === STEAL.PILE) && inside.every((c) => !c.haulRate), `a pile hauls ${STEAL.PILE} times as quick`);
  // The same battle twice: the same.
  const w2 = setup({ armory: true });
  const b2 = battle(w2);
  check(JSON.stringify(b2.stores.containers.map((c) => [c.label, c.x, c.y, c.w, c.h, c.sup, c.gear.map((g) => g.key)])) === JSON.stringify(S.map((c) => [c.label, c.x, c.y, c.w, c.h, c.sup, c.gear.map((g) => g.key)])), "laid twice from the same world: the same containers holding the same");
  // Nothing on the map of a group with no base there (a stranger's base: isobattles), nor by the numbers.
  const w3 = setup();
  w3.su.enemy.factionId = null; w3.su.context.factionId = null;
  const b3 = battle(w3);
  check(!b3.stores && !b3.assaultStores, "no group base: no stores");
}

section("A base with no wall: the field map behind where the wall would be");
{
  const w = setup({ walls: 0 });
  const b = battle(w);
  const S = b.stores && b.stores.containers;
  check(S && S.length && !b.deployPlan, `their stores on the wall-line map (${S ? S.map((c) => c.label).join(", ") : "none"})`);
  const G = assaultGoods(w.st, w.su);
  check(S && same(sumSup(S), G.view.stock) && S.every((c) => !!besideOf(b, c)), "holding exactly their stock, walkable ground next to each");
  start(w.st);
  const [u] = mine(b);
  const c = S.find((x) => !x.pile && x.contents.sup.meds >= 2) || S.find((x) => x.contents.sup.meds >= 2);
  putNext(b, u, c);
  raidMove(w.st, u.id, `rbox:${c.id}:sup:meds`, `haul:${u.id}:list`, 2);
  const m0 = w.h.stock.meds;
  endBattleNow(w.st, "victory");
  check(u.haul.sup.meds === 0 && w.h.stock.meds === m0 - 2 && (w.p.cargo.supplies.meds || 0) >= 2, `taken and carried off (meds ${m0} → ${w.h.stock.meds})`);
  closeCombat(w.st);
}

section("Taking from their stores");
{
  const w = setup({ armory: true });
  const b = battle(w);
  const [u, v] = mine(b);
  const sh = box(b, "Storehouse");
  putNext(b, u, sh);
  check(/before the assault/i.test(raidMove(w.st, u.id, `rbox:${sh.id}:sup:meds`, `haul:${u.id}:list`, 2)), "not before the assault starts");
  start(w.st);
  putNext(b, u, sh);
  const far = [sh.x + sh.w + 4, sh.y];
  // From further off: refused.
  const keep = [u.x, u.y];
  u.x = Math.min(b.w - 1, far[0]); u.y = far[1];
  check(/next to/.test(raidMove(w.st, u.id, `rbox:${sh.id}:sup:meds`, `haul:${u.id}:list`, 2)), "from further off: refused");
  u.x = keep[0]; u.y = keep[1];
  const meds0 = sh.contents.sup.meds, scrapIn = sh.contents.sup.scrap, kg0 = sh.kg;
  // HAUL: 4 scrap (8 kg) free, then 6 more (12 kg) an action.
  const r1 = raidMove(w.st, u.id, `rbox:${sh.id}:sup:scrap`, `haul:${u.id}:list`, 4);
  check(u.haul.sup.scrap === 4 && u.ap === 2, `4 scrap (8 kg) out of the storehouse: free (${r1}; ${u.ap} actions left)`);
  raidMove(w.st, u.id, `rbox:${sh.id}:sup:scrap`, `haul:${u.id}:list`, 6);
  check(u.haul.sup.scrap === 10 && u.ap === 1, `6 more (12 kg): one action (${u.ap} left)`);
  check(sh.contents.sup.scrap === scrapIn - 10 && Math.abs(kg0 - sh.kg - 20) < 0.01, `the storehouse keeps the rest (${sh.contents.sup.scrap} scrap, ${Math.round(sh.kg)} kg on its card)`);
  // The hands: two different things carried, nothing more of a third.
  raidMove(w.st, u.id, `rbox:${sh.id}:sup:meds`, `haul:${u.id}:list`, 2);
  check(u.haul.sup.meds === 2 && sh.contents.sup.meds === meds0 - 2, "2 meds as well (a second thing in hand)");
  const third = Object.keys(sh.contents.sup).find((k) => k !== "scrap" && k !== "meds" && sh.contents.sup[k] >= 1);
  const why = raidMove(w.st, u.id, `rbox:${sh.id}:sup:${third}`, `haul:${u.id}:list`, 1);
  check(/hands full/i.test(why) && !(u.haul.sup[third] > 0), `a third thing: ${why.slice(0, 60)}…`);
  check(!/hands full/i.test(raidMove(w.st, u.id, `rbox:${sh.id}:sup:scrap`, `haul:${u.id}:list`, 1)), "more of what is in hand still goes");
  // Their max load: no more than personalRoom.
  putNext(b, u, sh);
  u.ap = 9;
  u.share = 0;
  const room = personalRoom(w.st, u);
  raidMove(w.st, u.id, `rbox:${sh.id}:sup:scrap`, `haul:${u.id}:list`, 500);
  check(u.haul.sup.scrap === Math.floor(room / 2) && personalRoom(w.st, u) >= -1e-6, `their max load: ${u.haul.sup.scrap} scrap of 500 asked (${Math.round(room)} kg of room)`);
  // A pile: twice as quick. 8 scrap (16 kg): one action from the storehouse, none from a pile.
  putNext(b, u, sh);
  raidMove(w.st, u.id, `rbox:${sh.id}:sup:scrap`, `haul:${u.id}:list`, 8);
  check(u.haul.sup.scrap === 8 && u.ap === 1, `8 scrap (16 kg) from the storehouse: 1 action (${u.ap} left)`);
  const pile = b.stores.containers.find((c) => c.pile && c.contents.sup.scrap >= 20);
  putNext(b, u, pile);
  raidMove(w.st, u.id, `rbox:${pile.id}:sup:scrap`, `haul:${u.id}:list`, 8);
  check(u.haul.sup.scrap === 8 && u.ap === 2, `8 scrap from a pile: free (${u.ap} left; counted ${16 / STEAL.PILE} kg against HAUL's ${HAUL.free} free)`);
  raidMove(w.st, u.id, `rbox:${pile.id}:sup:scrap`, `haul:${u.id}:list`, 6);
  check(u.haul.sup.scrap === 14 && u.ap === 1, `6 more (12 kg, counted 6): one action (${u.ap} left; ${Math.round(haulBudget(b, u))} kg to haul this turn)`);
  // A locked one: refused until forced.
  const cage = b.stores.containers.find((c) => c.holds === "gear");
  putNext(b, u, cage);
  const it = cage.contents.gear[0];
  check(/locked/.test(raidMove(w.st, u.id, `rbox:${cage.id}:gear:0`, `haul:${u.id}:list`)) && cage.contents.gear[0] === it, "the gun cage is locked: refused");
  let blows = 0, whole = true;
  while (cage.lock.hp > 0 && blows < 30) { u.ap = 2; const e = combatAct(w.st, { type: "forceStore", unit: u.id, store: cage.id }); if (e) { check(false, `force: ${e}`); break; } blows++; if (u.ap !== 0) whole = false; }
  check(cage.lock.open && cage.lock.hp === 0 && blows >= 2 && whole, `forced open in ${blows} blows, each the rest of the turn`);
  u.ap = 2;
  const msg = raidMove(w.st, u.id, `rbox:${cage.id}:gear:0`, `haul:${u.id}:list`);
  check(u.haul.gear.includes(it) && !cage.contents.gear.includes(it), `then taken: ${msg}`);
  check(/next to one of their locked/.test(combatAct(w.st, { type: "forceStore", unit: v.id })), "forcing with nobody next to a locked one: refused");
}

section("A win: the team's cargo, gone from their base, the conquest half of the rest");
{
  const w = setup();
  const b = battle(w);
  start(w.st);
  const [u, v] = mine(b);
  const sh = box(b, "Storehouse");
  const holder = b.stores.containers.find((c) => c.contents.gear.length);
  putNext(b, u, sh);
  raidMove(w.st, u.id, `rbox:${sh.id}:sup:meds`, `haul:${u.id}:list`, 5);
  raidMove(w.st, u.id, `rbox:${sh.id}:sup:scrap`, `haul:${u.id}:list`, 3);
  putNext(b, v, holder);
  const item = holder.contents.gear.find((g) => !GEAR[g.key] || !GEAR[g.key].twoHands) || holder.contents.gear[0];
  raidMove(w.st, v.id, `rbox:${holder.id}:gear:${holder.contents.gear.indexOf(item)}`, `haul:${v.id}:list`);
  check(u.haul.sup.meds === 5 && u.haul.sup.scrap === 3 && v.haul.gear.includes(item), `taken: 5 meds, 3 scrap, the ${item.name}`);
  const meds0 = w.h.stock.meds, scrap0 = w.h.stock.scrap, cargoMeds = w.p.cargo.supplies.meds || 0, cargoScrap = w.p.cargo.supplies.scrap || 0;
  endBattleNow(w.st, "victory");
  check(w.h.stock.meds === meds0 - 5 && w.h.stock.scrap === scrap0 - 3, `gone from their base's stock: meds ${meds0} → ${w.h.stock.meds}, scrap ${scrap0} → ${w.h.stock.scrap}`);
  check(!w.f.arsenal.items.includes(item), `the ${item.name} is off their books`);
  check((w.p.cargo.supplies.meds || 0) === cargoMeds + 5 && (w.p.cargo.supplies.scrap || 0) === cargoScrap + 3 && w.p.cargo.gear.includes(item), "in the team's cargo");
  check(b.summary.some((l) => /^Taken from .*stores: 5 meds, 3 scrap and/.test(l)), `the summary says so (${b.summary.find((l) => /stores/.test(l))})`);
  check(!(b.bodies || []).some((x) => x.name && /Storehouse|Main house|Pile/.test(x.name)), "what is left in their stores is no loot of the field");
  const medsLeft = w.h.stock.meds, scrapLeft = w.h.stock.scrap;
  closeCombat(w.st);
  const nb = w.st.bases.find((x) => x.tile === w.tile);
  check(nb && nb.stock.meds === Math.floor(medsLeft * CONQUEST.STOCK_SHARE) && nb.stock.scrap === Math.floor(scrapLeft * CONQUEST.STOCK_SHARE), `the base is yours with half of what was left: meds ${nb && nb.stock.meds} of ${medsLeft}, scrap ${nb && nb.stock.scrap} of ${scrapLeft}`);
}

section("A retreat with your people out keeps it; one left behind leaves theirs; a defeat leaves it all");
{
  const w = setup();
  const b = battle(w);
  start(w.st);
  const [u, v, x] = mine(b);
  const sh = box(b, "Storehouse");
  putNext(b, u, sh);
  raidMove(w.st, u.id, `rbox:${sh.id}:sup:meds`, `haul:${u.id}:list`, 4);
  putNext(b, v, sh);
  raidMove(w.st, v.id, `rbox:${sh.id}:sup:fuel`, `haul:${v.id}:list`, 3);
  u.left = true; x.left = true;          // out by the evac strip
  v.down = true; v.hp = 0; v.bleed = 3;  // down by their stores, not carried out: left behind
  const meds0 = w.h.stock.meds, fuel0 = w.h.stock.fuel, cm = w.p.cargo.supplies.meds || 0, cf = w.p.cargo.supplies.fuel || 0;
  endBattleNow(w.st, "retreat");
  check(b.result.outcome === "retreat" && v.lostBehind, "a retreat, one of yours left behind");
  check(w.h.stock.meds === meds0 - 4 && (w.p.cargo.supplies.meds || 0) === cm + 4, `what the ones who got out carry comes home: 4 meds in the cargo, gone from them (${meds0} → ${w.h.stock.meds})`);
  check(w.h.stock.fuel === fuel0 && (w.p.cargo.supplies.fuel || 0) === cf, `the 3 fuel the one left behind had stays with them (${fuel0} → ${w.h.stock.fuel})`);
  check(b.summary.some((l) => /^Left with .*3 fuel/.test(l)), `the summary says so (${b.summary.find((l) => /^Left with/.test(l))})`);
  closeCombat(w.st);

  const d = setup();
  const bd = battle(d);
  start(d.st);
  const [a] = mine(bd);
  const sh2 = box(bd, "Storehouse");
  putNext(bd, a, sh2);
  raidMove(d.st, a.id, `rbox:${sh2.id}:sup:meds`, `haul:${a.id}:list`, 6);
  const m0 = d.h.stock.meds, c0 = d.p.cargo.supplies.meds || 0;
  endBattleNow(d.st, "defeat");
  check(d.h.stock.meds === m0 && (d.p.cargo.supplies.meds || 0) === c0 && !(a.haul.sup.meds > 0), `a defeat: the 6 meds stay with them (stock ${m0} → ${d.h.stock.meds}, cargo unchanged)`);
  closeCombat(d.st);
}

section("A save mid-battle");
{
  const w = setup();
  const b = battle(w);
  start(w.st);
  const [u] = mine(b);
  const sh = box(b, "Storehouse");
  putNext(b, u, sh);
  raidMove(w.st, u.id, `rbox:${sh.id}:sup:meds`, `haul:${u.id}:list`, 3);
  const l = loadFromString(saveToString(w.st));
  const st2 = l.state || l;
  const b2 = st2.combat, f2 = st2.factions.find((x) => x.id === w.f.id);
  check(b2 && b2.stores && b2.stores.containers.length === b.stores.containers.length, "the stores come back");
  check(b2.stores.containers.every((c) => b2.fieldLoot.containers.includes(c) && c.contents.sup === c.sup && c.contents.gear === c.gear), "one object each in the stores and the loot layer");
  check(b2.stores.containers.flatMap((c) => c.contents.gear).every((it) => f2.arsenal.items.includes(it)), "their items are still the group's own objects");
  check(JSON.stringify(b2.stores.containers.map((c) => c.contents.sup)) === JSON.stringify(b.stores.containers.map((c) => c.contents.sup)), "the same contents");
  const u2 = b2.units.find((x) => x.id === u.id);
  check(u2.haul.sup.meds === 3, "and what was taken is still carried");
  const sh2 = b2.stores.containers.find((c) => c.id === sh.id);
  raidMove(st2, u2.id, `rbox:${sh2.id}:sup:meds`, `haul:${u2.id}:list`, 2);
  const h2 = homeAt(st2, f2, w.tile);
  const m0 = h2.stock.meds;
  endBattleNow(st2, "victory");
  check(h2.stock.meds === m0 - 5, `the fight goes on from it: 5 meds gone from them in all (${m0} → ${h2.stock.meds})`);
  closeCombat(st2);
}

section("By the numbers: no map, nothing of this");
{
  const w = setup();
  const meds0 = w.h.stock.meds;
  const before = JSON.stringify(w.p.cargo.supplies);
  const r = startCombat(w.st, w.su); // headless: autoResolveCombat
  check(r === null && !w.st.combat, "headless, the assault is resolved by the numbers");
  check(typeof w.h.stock.meds === "number" && (w.h.stock.meds === meds0 || !w.f.bases.includes(w.tile)), `no store taking without a map (meds ${meds0} → ${w.h.stock.meds}; cargo ${before === JSON.stringify(w.p.cargo.supplies) ? "unchanged" : "changed by the handler"})`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
