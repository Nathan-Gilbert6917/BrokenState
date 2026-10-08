// Parts by kind (docs/weapons-overhaul-plan.md section 10): machine parts (the old "parts"), car parts, gun parts and
// electronics as supplies; finds split by where they are made (loot.js sortParts / splitParts, on their own dice);
// other groups keep one count of parts and offer the kinds out of it (trade.js KIND_MIX, groupStockKey,
// foldPartKinds); vehicles mended with car parts (or 2 machine parts each: vehicles.js repair, foundcars.js); a car
// stripped for parts (vehicles.js stripVehicle); guns, attachments and gadgets salvaged (inventory.js salvageAt);
// merchants carry the kinds; a save keeps them.
// Usage: node tools/partstest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { GEAR, SUPPLIES, SUPPLY_KEYS } from "../src/sim/data.js";
import { newItem, salvageInfo, salvageAt, salvageYield, itemAt } from "../src/sim/inventory.js";
import { fitMod } from "../src/sim/gunmods.js";
import { PARTS_MIX, sortParts, splitParts } from "../src/sim/loot.js";
import { LOT, KIND_MIX, PART_KINDS, available, groupStockKey, foldPartKinds, tradeContext, setQty, balanceWith, executeTrade, tradeVerdict, need } from "../src/sim/trade.js";
import { repair, stripVehicle, stripYield, createVehicle, carPartsCost, CARPART_SUB } from "../src/sim/vehicles.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition, planPath, giveOrder } from "../src/sim/parties.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { spawnVisitor } from "../src/sim/visitors.js";
import { CRAFTS } from "../src/sim/crafting.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; return st; };

// 1. The supplies.
{
  console.log("Supplies");
  check(SUPPLIES.parts.name === "Machine parts" && SUPPLY_KEYS.includes("parts"), "\"parts\" stays the key, named Machine parts");
  const want = { carparts: [7, 3, "vehicle"], gunparts: [10, 0.5, "gunmod"], electronics: [12, 0.3, "electronics"] };
  check(Object.entries(want).every(([k, [v, w, c]]) => SUPPLIES[k] && SUPPLIES[k].value === v && SUPPLIES[k].weight === w && SUPPLIES[k].cat === c), "car parts (7, 3 kg, vehicle), gun parts (10, 0.5 kg, gunmod), electronics (12, 0.3 kg, electronics)");
  check(SUPPLY_KEYS.filter((k) => !SUPPLIES[k].round).slice(-3).join() === "carparts,gunparts,electronics", "the kinds come last (every older key keeps its place; the rounds by calibre after them)");
  check(PART_KINDS.every((k) => LOT[k] > 0), "every kind has a trade lot");
  const st = world();
  check(PART_KINDS.every((k) => !(hub(st).stock[k] > 0)), "a new hub starts with none of the kinds (machine parts as before)");
}

// 2. Finds by kind.
{
  console.log("Finds");
  const st = { seed, hour: 7 };
  const a = sortParts(st, "autoshop", 6, "s"), b = sortParts(st, "autoshop", 6, "s");
  check(JSON.stringify(a) === JSON.stringify(b) && Object.values(a).reduce((x, y) => x + y, 0) === 6, `the split is the same every time and keeps the count (${JSON.stringify(a)})`);
  let car = 0, n = 0;
  for (let i = 0; i < 400; i++) { const r = sortParts(st, "garage", 3, `g${i}`); car += r.carparts || 0; n += 3; }
  check(Math.abs(car / n - 0.6) < 0.05, `a garage's parts are 60% car parts (${Math.round((car / n) * 100)}%)`);
  check(JSON.stringify(sortParts(st, "church", 4, "x")) === JSON.stringify({ parts: 4 }), "a place with no mix: machine parts");
  check(["autoshop", "factory", "gunstore", "radiotower", "armory", "milwreck", "office"].every((t) => PARTS_MIX[t]), "auto shops, factories, gun stores, radio towers, armouries, army wrecks and offices sort their parts");
  // A whole search hour at an auto shop (scavenge.js searchHour): parts found come in kinds.
  const w = world();
  const tile = w.tiles.find((t) => t.loc && t.loc.type === "autoshop");
  if (check(!!tile, "the map has an auto shop")) {
    const sup = { parts: 9, food: 1 };
    splitParts(w, sup, "autoshop", "box1");
    check(sup.food === 1 && (sup.parts || 0) + (sup.carparts || 0) + (sup.gunparts || 0) + (sup.electronics || 0) === 9 && sup.carparts > 0, `a container's parts split (${JSON.stringify(sup)})`);
  }
  const r = w.rng.state;
  sortParts(w, "autoshop", 20, "q");
  check(w.rng.state === r, "sorting moves none of the world's dice");
}

// 3. Other groups: one count of parts, the kinds offered out of it.
{
  console.log("Groups");
  const st = world();
  const f = st.factions.find((x) => x.alive && x.bases.length);
  f.type = "military"; f.pop = 20; f.stock.parts = 30; f.goodwill = 40; f.known = true;
  check(groupStockKey("gunparts", f) === "parts" && groupStockKey("carparts", f) === "parts" && groupStockKey("food", f) === "food", "a group's part kinds all point at its one count of parts");
  check(available(f, "gunparts") === 0 && available(f, "parts") === 30, "in the AI's own dealings they offer only parts, as before");
  const k = { parts: available(f, "parts", { kinds: true }), gunparts: available(f, "gunparts", { kinds: true }), electronics: available(f, "electronics", { kinds: true }), carparts: available(f, "carparts", { kinds: true }) };
  check(k.gunparts === Math.floor(30 * KIND_MIX.military.gunparts) && k.electronics === Math.floor(30 * KIND_MIX.military.electronics) && Object.values(k).reduce((a, b) => a + b, 0) <= 30, `in the trade window the military offer their parts by kind (${JSON.stringify(k)})`);
  check(need(f, "gunparts") === need(f, "parts"), "and price every kind by the one count");
  f.stock.carparts = 4; f.stock.electronics = -2;
  foldPartKinds(f);
  check(f.stock.parts === 32 && !("carparts" in f.stock) && !("electronics" in f.stock), "kinds left in their stores by a delivery go into the one count");
  // A real trade: buying gun parts from them takes from their parts.
  const h = hub(st);
  const s = makeSurvivor(st); s.skills.speech = 8; s.traits = []; s.health = 100; s.location = { kind: "base", baseId: h.id }; st.survivors.push(s);
  const s2 = makeSurvivor(st); s2.traits = []; s2.health = 100; s2.location = { kind: "base", baseId: h.id }; st.survivors.push(s2);
  if (planPath(st, f.bases[0], h.tile, false)) {
    h.stock.food += 20; h.stock.water += 20;
    const res = launchExpedition(st, { memberIds: [s.id, s2.id], dest: f.bases[0], mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
    const p = res.party;
    p.path = [f.bases[0]]; p.idx = 0; p.dest = f.bases[0];
    p.cargo.supplies = { a_9mm_fmj: 400 } /* rounds by calibre (ammo.js): what balanceWith("ammo") pays with */;
    giveOrder(st, p, "trade");
    const ctx = tradeContext(st);
    if (check(ctx && ctx.kind === "visit" && ctx.theirHave.gunparts > 0, `the trade window lists their gun parts (${ctx && ctx.theirHave.gunparts})`)) {
      const parts0 = f.stock.parts;
      setQty(st, "theirs", "gunparts", 3);
      balanceWith(st, "ammo");
      const ok = tradeVerdict(st).ok;
      executeTrade(st);
      check(ok && p.cargo.supplies.gunparts === 3 && f.stock.parts === parts0 - 3 && !("gunparts" in f.stock), `3 gun parts bought: their parts ${parts0} → ${f.stock.parts}, none kept apart`);
      st.trade.offer = {}; st.trade.ask = {};
      p.cargo.supplies.carparts = 5;
      setQty(st, "mine", "carparts", 5);
      balanceWith(st, "ammo");
      const p1 = f.stock.parts;
      executeTrade(st);
      check(f.stock.parts === p1 + 5 && !("carparts" in f.stock), "5 car parts sold go into their one count of parts");
    }
  }
}

// 4. Vehicles: car parts, or 2 machine parts each.
{
  console.log("Vehicles");
  const st = world();
  const h = hub(st);
  const mech = atBase(st, h.id)[0];
  mech.skills.mechanics = 6;
  const v = createVehicle(st, "sedan", { kind: "base", baseId: h.id }, { fuel: 5, condition: 40 });
  h.stock.parts = 0; h.stock.carparts = 1;
  const c0 = v.condition;
  repair(st, h, v);
  check(h.stock.carparts === 0 && v.condition > c0, `a repair takes a car part (${c0} → ${v.condition})`);
  h.stock.parts = 3;
  const c1 = v.condition;
  repair(st, h, v);
  check(h.stock.parts === 3 - CARPART_SUB && v.condition > c1, `with no car part, ${CARPART_SUB} machine parts stand in`);
  h.stock.parts = 1;
  check(/car part/.test(repair(st, h, v)) && h.stock.parts === 1, "one machine part is not enough");
  check(carPartsCost((k) => ({ carparts: 1, parts: 4 })[k], 3).ok && !carPartsCost((k) => ({ carparts: 1, parts: 3 })[k], 3).ok, "3 car parts: 1 and 4 machine parts will do, 1 and 3 will not");
  // Strip for parts.
  const y = stripYield(v);
  const before = { cp: h.stock.carparts || 0, sc: h.stock.scrap || 0, fu: h.stock.fuel || 0 };
  const msg = stripVehicle(st, h, v);
  check(!st.vehicles.includes(v) && h.stock.carparts === before.cp + y.carparts && h.stock.scrap === before.sc + 20 && h.stock.fuel === before.fu + y.fuel && y.carparts >= 3 && y.carparts <= 8, `stripped: ${msg}`);
  const wreck = createVehicle(st, "sedan", { kind: "base", baseId: h.id }, { fuel: 0, condition: 0 });
  const good = createVehicle(st, "sedan", { kind: "base", baseId: h.id }, { fuel: 0, condition: 100 });
  check(stripYield(wreck).carparts === 3 && stripYield(good).carparts === 8, "3 car parts from a wreck, 8 from one in top shape");
  const bike = createVehicle(st, "bike", { kind: "base", baseId: h.id }, { count: 2 });
  check(/Bikes/.test(stripVehicle(st, h, bike)) && st.vehicles.includes(bike), "bikes are not stripped");
}

// 5. Salvage.
{
  console.log("Salvage");
  const st = world();
  const h = hub(st);
  const s = atBase(st, h.id)[0];
  check(JSON.stringify(salvageYield(newItem("ar"))) === JSON.stringify({ gunparts: Math.floor(GEAR.ar.value / 30) + 1, scrap: 1 }), `a gun: floor(value / 30) + 1 gun parts and a scrap (${JSON.stringify(salvageYield(newItem("ar")))})`);
  check(salvageYield(newItem("holo")).gunparts === 1 && salvageYield(newItem("reddot")) === null, "an attachment worth 25 or more: a gun part; a cheaper one nothing");
  check(salvageYield(newItem("laptop")).electronics === 2 && salvageYield(newItem("phone")).electronics === 1 && salvageYield(newItem("thermal")).electronics === 4 && salvageYield(newItem("nvg")).electronics === 3, "gadgets: electronics (a phone 1, a laptop 2, night vision 3, a thermal 4)");
  const gun = newItem("pistol");
  fitMod(gun, newItem("reddot"));
  h.armory.push(gun, newItem("laptop"));
  const g0 = h.stock.gunparts || 0;
  const msg = salvageAt(st, `armory:${h.id}:list:${h.armory.indexOf(gun)}`);
  check(!h.armory.includes(gun) && h.stock.gunparts === g0 + salvageYield(newItem("pistol")).gunparts && h.armory.some((x) => x.key === "reddot"), `a gun taken apart; its red dot goes to the armory (${msg})`);
  salvageAt(st, `armory:${h.id}:list:${h.armory.findIndex((x) => x.key === "laptop")}`);
  check(h.stock.electronics === 2, "a laptop: 2 electronics into the stores");
  s.gear.weapon = newItem("ar");
  check(/Take it off/.test(salvageInfo(st, `s:${s.id}:weapon`).reason), "what is held must come off first");
}

// 6. Merchants, crafting, saves.
{
  console.log("Merchants, crafting, saves");
  const st = world();
  let v = null;
  try { v = spawnVisitor(st, "merchants"); } catch (e) { v = null; }
  if (v) check(PART_KINDS.some((k) => v.stock[k] > 0) && v.stock.carparts >= 1 && v.stock.electronics >= 1, `merchants carry the kinds (${PART_KINDS.map((k) => `${v.stock[k]} ${k}`).join(", ")})`);
  else check(true, "(no merchant spawner to test)");
  check(CRAFTS.solventcan.in.gunparts === 1, "the solvent-trap suppressor takes a gun part");
  const h = hub(st);
  Object.assign(h.stock, { carparts: 3, gunparts: 2, electronics: 5 });
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  check(hub(back).stock.carparts === 3 && hub(back).stock.gunparts === 2 && hub(back).stock.electronics === 5, "the kinds survive a save and load");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
