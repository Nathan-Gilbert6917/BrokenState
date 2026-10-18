// Firewood as a 0.1 kg unit (data.js SUPPLIES.wood; it was a 3 kg bundle): the unit and its weight; every firewood
// figure 30 times what it was, so the balance is unchanged (woodcutting, the woodpile and its plans, heating and its
// fuel equivalence, the boiler, camp and shelter fires, the groups, trade and the radio, the loot); breaking things
// down by their weight and burnable share; firewood as a stack in the raid window, the cargo and the stores (split,
// weighed); the top bar; an older save scaled ×30 once on load.
// Usage: node tools/firewoodtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { SUPPLIES, GEAR, WOOD_UNITS, supplyFew } from "../src/sim/data.js";
import * as Wd from "../src/sim/woodcutting.js";
import { heatUse, HEAT, woodFor } from "../src/sim/upkeep.js";
import { heatDaily } from "../src/sim/needs.js";
import { WORM, boilerUse } from "../src/sim/worm.js";
import { GROUP_WOOD } from "../src/sim/factions.js";
import { LOT, sellPrice, refreshMarket } from "../src/sim/trade.js";
import { SITE_WOOD, AREA_WOOD, rollSiteWood } from "../src/sim/loot.js";
import { newItem, breakDownAt, breakDownInfo } from "../src/sim/inventory.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition, partyMembers, poolLoad } from "../src/sim/parties.js";
import { createBattle, CELL, registerCombatHandler, unitAt } from "../src/sim/combat.js";
import * as RL from "../src/sim/raidloot.js";
import { saveToString, loadFromString, serializeState, deserializeState } from "../src/sim/save.js";
import * as Weather from "../src/sim/weather.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const section = (t) => console.log(t);
const mk = (seed = SEED) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.visitorsOff = true; return st; };

// The browser bits the UI modules touch.
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, toDataURL: () => "data:image/png;base64," }) };

// ======================================================================
section("The unit: 0.1 kg");
{
  check(SUPPLIES.wood.weight === 0.1 && WOOD_UNITS === 30, `a firewood weighs ${SUPPLIES.wood.weight} kg (a 3 kg bundle is ${WOOD_UNITS})`);
  check(near(SUPPLIES.wood.value / SUPPLIES.wood.weight, 0.6 / 3, 1e-9), `worth the same a kg as before (${SUPPLIES.wood.value} a unit, ${SUPPLIES.wood.value / SUPPLIES.wood.weight} a kg)`);
  check(supplyFew("wood", 5) === 150 && supplyFew("food", 5) === 5, "\"a few\" firewood in a rule is 30 times a few of anything else (5 to spare: 150)");
}

// ======================================================================
section("Every firewood figure × 30: the balance unchanged");
{
  const st = mk();
  const st0 = createWorld({ seed: SEED, factionCount: 6 });
  // [what, now, before (in 3 kg units), × (30, or 1/30 for a figure per firewood)]
  const rows = [
    ["woodcutting rate a woodcutter-hour", Wd.WOOD.rate, 0.6, 30], ["a forest tile's firewood (deplete)", Wd.WOOD.deplete, 250, 30],
    ["a woodcutter's worth (the job opens)", Wd.WOOD.worth, 0.4, 30], ["a shelter's fire a day", Wd.WOOD.fire.shelter, 0.6, 30],
    ["a camp fire a day", Wd.WOOD.fire.camp, 0.3, 30], ["the boiler a head a day", WORM.BOILER_WOOD_HEAD, 0.2, 30],
    ["heat (fuel) of one firewood", HEAT.wood, 0.2, 1 / 30], ["firewood for a head's freezing day", woodFor(HEAT.fuel), 0.5, 30],
    ["a group's start a head", GROUP_WOOD.start, 4, 30], ["a group's cap a head", GROUP_WOOD.cap, 8, 30],
    ["a group's cutting a head a day", GROUP_WOOD.cut, 0.12, 30], ["a group's burn a freezing day", GROUP_WOOD.burn, 0.3, 30],
    ["a trade lot", LOT.wood, 20, 30], ["a cabin's woodpile (min)", SITE_WOOD.cabin[1], 2, 30], ["a cabin's woodpile (max)", SITE_WOOD.cabin[2], 6, 30],
    ["a barn's woodpile in a raid (max)", AREA_WOOD.barn[2], 5, 30], ["the hub's start", hub(st0).stock.wood, 10, 30],
  ];
  for (const [what, now, was, x] of rows) check(near(now, was * x, 1e-9), `${what}: ${was} → ${Math.round(now * 1e6) / 1e6}`);
  check(SITE_WOOD.cabin[0] === 0.4 && AREA_WOOD.barn[0] === 0.3, "the loot's chances unchanged (only the amounts)");
  // A base's heating day: 30 times the units for the same warmth (the same kilos).
  const h = hub(st);
  let cold = null;
  for (let d = 0; d < 224 && cold == null; d++) { const t = Weather.dayMeanTemp(st, d); if (t < 0 && t >= -8) cold = d; }
  st.hour = cold * 24 + 1;
  const n = heatUse(st, h).n;
  h.stock.wood = 10000; h.stock.fuel = 5;
  heatDaily(st, h);
  const burned = 10000 - h.stock.wood;
  check(near(burned, n * 0.5 * 30, 1e-6) && near(burned * SUPPLIES.wood.weight, n * 0.5 * 3, 1e-6) && h.stock.fuel === 5 && !h.cold,
    `a freezing day for ${n}: ${burned} firewood (${(burned * SUPPLIES.wood.weight).toFixed(1)} kg, what ${n * 0.5} of the old 3 kg units weighed), no fuel`);
  check(near(burned * HEAT.wood, n * HEAT.fuel, 1e-9), `the same warmth: ${burned} × ${HEAT.wood.toFixed(5)} = ${(burned * HEAT.wood).toFixed(2)} fuel's worth`);
  // Half the firewood: the fuel covers the rest, as before.
  h.stock.wood = burned / 2; h.stock.fuel = 5;
  heatDaily(st, h);
  check(h.stock.wood === 0 && near(5 - h.stock.fuel, n * HEAT.fuel / 2, 0.06), `half the firewood: ${(5 - h.stock.fuel).toFixed(2)} fuel for the rest`);
  // The woodpile's plan: 15 a head a freezing day, × the bitter days, a fifth to spare.
  h.stock.wood = 0;
  const w = Wd.woodNeed(st, h);
  check(w.need > 0 && Math.abs(w.need - (w.heads * 15 * Wd.WOOD.bitter * w.days * Wd.WOOD.spare + w.boiler * WORM.BOILER_DAYS)) <= w.need * 0.01, `the cold ahead: ${w.need} firewood for ${w.heads} (${(w.need * 0.1).toFixed(0)} kg)`);
  // The boiler: 6 a head, 0.04 fuel a head instead.
  addBuilding(h, "boiler");
  const bu = boilerUse(st, h);
  check(near(bu.wood, bu.heads * 6, 1e-9) && near(bu.fuel, Math.round(bu.heads * 6 * HEAT.wood * 100) / 100, 1e-9), `the boiler: ${bu.wood} firewood or ${bu.fuel} fuel a day for ${bu.heads}`);
  // Trade: a firewood costs a 30th of a bundle (summer, a lot).
  const f = st.factions.find((x) => x.alive);
  st.hour = 24 * 40;
  const per = sellPrice(st, f, "wood", 0, LOT.wood);
  check(per > 0 && per < 0.1, `a group pays ${per.toFixed(4)} a firewood (${(per * 30).toFixed(2)} a 3 kg bundle)`);
}

// ======================================================================
section("Breaking things down: by weight × the burnable share");
{
  const rows = Object.entries(GEAR).filter(([, d]) => d.burnShare > 0).map(([k, d]) => ({ k, name: d.name, kg: d.weight, share: d.burnShare, wood: Wd.burnOf(newItem(k)) }));
  for (const r of rows) console.log(`    ${r.name.padEnd(30)} ${String(r.kg).padStart(4)} kg × ${String(r.share).padEnd(3)} → ${r.wood} firewood`);
  check(rows.length >= 20 && rows.every((r) => r.wood === Math.floor(r.kg * r.share / 0.1 + 1e-9)), `${rows.length} burnable items: floor(weight × share / 0.1 kg)`);
  const by = (k) => Wd.burnOf(newItem(k));
  check(by("novel") === 3 && by("guitar") === 27 && by("nailbat") === 9 && by("backpack") === 5 && by("ladder") === 90 && by("surgerybook") === 15,
    `a paperback 3, a guitar 27 (3 kg × 0.9), a nail bat 9 (1.2 kg × 0.8), a school backpack 5 (1 kg × 0.5), a siege ladder 90, a surgery book 15`);
  check(by("pistol") === 0 && by("knife") === 0 && !GEAR.pistol.burnShare && Object.values(GEAR).every((d) => d.burn == null), "metal things none; no hand-set firewood left (burn → burnShare)");
  const st = mk();
  const h = hub(st);
  h.stock.wood = 0;
  h.armory.push(newItem("guitar"), newItem("pistol"));
  const loc = (key) => `armory:${h.id}:list:${h.armory.findIndex((it) => it.key === key)}`;
  const msg = breakDownAt(st, loc("guitar"));
  check(h.stock.wood === 27 && /\+27 to/.test(msg), `"${msg}"`);
  check(!breakDownInfo(st, loc("pistol")).ok && /will not burn/.test(breakDownInfo(st, loc("pistol")).reason), "a pistol will not burn");
  // A thing whose burnable part is under a firewood says so (a light item, share set for the check).
  const keep = GEAR.knife.burnShare;
  GEAR.knife.burnShare = 0.1;
  h.armory.push(newItem("knife"));
  check(!breakDownInfo(st, loc("knife")).ok && /Too little/.test(breakDownInfo(st, loc("knife")).reason), `too little of it burns: "${breakDownInfo(st, loc("knife")).reason}"`);
  if (keep == null) delete GEAR.knife.burnShare; else GEAR.knife.burnShare = keep;
  // The boiler burns things worth their firewood by weight.
  const list = [newItem("novel"), newItem("magazines")];
  check(Wd.burnablesWood(list) === 7, "a novel and a stack of magazines: 7 firewood's worth for the boiler");
}

// ======================================================================
// Supply tiles: the name, then the count on the right ("×150", gun-mags: ui/inventory.js supTile, sim/itemnames.js).
section("A stack like any supply: the raid window, the cargo, the stores, the loot, the top bar");
{
  registerCombatHandler("fwtest", () => {});
  let R = null;
  for (let i = 0; i < 60 && !R; i++) {
    const st = createWorld({ seed: SEED * 100 + i, factionCount: 6 });
    st.cards.length = 0; st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["pharmacy", "store", "house", "warehouse", "gas", "police"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    st.combat = createBattle(st, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "fwtest", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 0 }, context: {} });
    const b = st.combat;
    if (b.raid.choose) b.raid.choose = null;
    if (!b.raid.containers.some((c) => c.kind !== "body" && !c.lock)) continue;
    R = { st, b, p };
  }
  const { st, b, p } = R;
  RL.HAUL.free = 1e9;
  const u = b.units.find((x) => x.side === "player");
  let box = null;
  for (const c of b.raid.containers.filter((x) => x.kind !== "body" && !x.lock)) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !CELL[b.cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
      u.x = nx; u.y = ny; box = c; break;
    }
    if (box) break;
  }
  box.contents = { sup: { wood: 150 }, gear: [] };
  box.searched = true;
  const msg = RL.raidMove(st, u.id, `rbox:${box.id}:sup:wood`, `haul:${u.id}:list`, 40);
  check(u.haul.sup.wood === 40 && box.contents.sup.wood === 110, `split the stack: 40 of 150 taken, 110 left ("${msg}")`);
  check(near(RL.haulLoad(u), 4, 1e-6), `40 firewood carried weigh ${RL.haulLoad(u)} kg`);
  const { inventoryModal } = await import("../src/ui/inventory.js");
  const ui = { inv: { raid: true, uid: u.id, box: box.id }, invSel: null, invMsg: "" };
  const html = inventoryModal(st, ui) || "";
  // The firewood icon is its own drawing (ui/itemart.js, the wood supply's picture) as an <img>, not an emoji.
  const { supplyIcon } = await import("../src/ui/stackmove.js");
  const { SUPPLY_ART } = await import("../src/ui/itemart.js");
  const woodIcon = supplyIcon("wood");
  check(typeof SUPPLY_ART.wood === "function" && /^<img class="iart/.test(woodIcon), "firewood has its own drawing for an icon");
  const woodTile = (n, kg) => `<span class="iico">${woodIcon}</span><span class="iname">Firewood</span><span class="icount">×${n}</span>${kg != null ? `<span class="ikg">${kg}</span>` : ""}`;
  check(html.includes(woodTile(110)) && html.includes(woodTile(40)) && html.includes(`rbox:${box.id}:sup:wood`), "the search window shows both stacks with the firewood icon (110 in the box, 40 carried)");
  check(/11 kg/.test(html) || /11<\/span>/.test(html), "a stack shows its weight (110 × 0.1 kg = 11 kg)");
  // Back on the map: the team's cargo and the base's stores list it with its weight.
  st.combat = null;
  p.phase = "waiting";
  p.cargo.supplies.wood = 150;
  const s = partyMembers(st, p)[0];
  const ui2 = { inv: { sid: s.id }, invSel: null, invMsg: "" };
  const cargoHtml = inventoryModal(st, ui2) || "";
  check(/Found supplies \(15 kg\)/.test(cargoHtml) && cargoHtml.includes(woodTile(150, 15)), "the team's cargo lists the firewood stack (150, 15 kg)");
  check(near(poolLoad(p) - poolLoad({ ...p, cargo: { ...p.cargo, supplies: { ...p.cargo.supplies, wood: 0 } } }), 15, 1e-6), "and it weighs 15 kg in the team's load");
  const h = hub(st);
  h.stock.wood = 300;
  const keeper = atBase(st, h.id)[0];
  const baseHtml = inventoryModal(st, { inv: { sid: keeper.id }, invSel: null, invMsg: "" }) || "";
  check(/In the stores \(/.test(baseHtml) && baseHtml.includes(woodTile(300, 30)), "the armory screen lists the base's firewood (300, 30 kg)");
  const { topbarParts } = await import("../src/ui/ui.js");
  const top = topbarParts(st, { speed: 1 }).stock;
  check(/Firewood<\/span><span class="nb-amt">300</.test(top) && /Weight 0\.1 each/.test(top), "the top bar counts it (Firewood 300, 0.1 kg each)");
  // The loot: a cabin's woodpile is a stack of 60–180 (6–18 kg).
  const fake = { seed: SEED, hour: 0, tiles: [{ loc: { type: "cabin" }, loot: 1 }] };
  const finds = [];
  for (let hr = 0; hr < 300; hr++) { fake.hour = hr; const q = rollSiteWood(fake, 0); if (q) finds.push(q); }
  check(finds.length > 60 && finds.every((q) => q >= 60 && q <= 180) && Math.max(...finds) > 150, `a cabin's search hour finds 60–180 firewood (${Math.min(...finds)}–${Math.max(...finds)} in ${finds.length} finds)`);
}

// ======================================================================
section("An older save: its firewood × 30, once");
{
  const st = mk();
  const h = hub(st);
  h.stock.wood = 10; h.woodToday = 1.5;
  h.boilerBurn = { wood: 0.8, fuel: 0, items: 1, itemWood: 0.3 };
  const role = st.work && st.work.roles && st.work.roles.find((r) => r.pri && r.pri.wood);
  const pri = role ? role.pri.wood : null;
  if (role) role.min = { wood: 2 };
  const f = st.factions.find((x) => x.alive);
  f.stock.wood = 40;
  refreshMarket(st, f);
  const crew = atBase(st, h.id).slice(0, 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: st.grid.neighbors(h.tile).find((t) => st.tiles[t].terrain !== "water"), mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  const p = res.party;
  p.supplies.wood = 1; p.cargo.supplies.wood = 2;
  p.task = { type: "wood", hours: 8, done: 2, got: { wood: 1.2, left: 0.5 } };
  (st.econStats = st.econStats || {}).heatWood = 100; st.econStats.woodCut = 50;
  st.woodcutting = 1; // a save from before firewood was 0.1 kg
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const hb = hub(back), pb = back.parties.find((x) => x.id === p.id), fb = back.factions.find((x) => x.id === f.id);
  const rb = role && back.work.roles.find((r) => r.name === role.name);
  check(back.woodcutting === 2, "the mark moves on to 2");
  check(hb.stock.wood === 300 && near(hb.woodToday, 45) && near(hb.boilerBurn.wood, 24) && near(hb.boilerBurn.itemWood, 9), `the base: 10 → ${hb.stock.wood} firewood; the day's cut and the boiler's figures too`);
  check(pb.supplies.wood === 30 && pb.cargo.supplies.wood === 60 && near(pb.task.got.wood, 36) && near(pb.task.got.left, 15), "a team's supplies, cargo and Cut wood haul × 30");
  check(fb.stock.wood === 1200 && !fb.market, "a group's woodpile × 30; its market made afresh (prices per firewood)");
  check(back.econStats.heatWood === 3000 && back.econStats.woodCut === 1500, "the economy's tallies × 30");
  check(!rb || (rb.pri.wood === pri && rb.min.wood === 2), "the work roles' Cut wood priority and minimum are not amounts: unchanged");
  check(JSON.stringify(back.wood || {}) === JSON.stringify(st.wood || {}), "the land's wood levels unchanged");
  const again = loadFromString(saveToString(back));
  check(hub(again).stock.wood === 300 && again.factions.find((x) => x.id === f.id).stock.wood === 1200, "loaded again: no second scaling");
  const fresh = loadFromString(saveToString(mk()));
  check(fresh.woodcutting === 2 && hub(fresh).stock.wood === hub(mk()).stock.wood, "a world made since loads unchanged");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
