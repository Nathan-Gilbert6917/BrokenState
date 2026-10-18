// Deep loot and the full team's swap (src/sim/deeploot.js, docs/crawl-balance.md): deeper blocks find fewer tins and
// more of what is dear by the kilo; a full team puts down the least wanted cargo for a find worth more a kilo, by
// what its home base needs.
// Usage: node tools/deeploottest.js
import { createWorld, hub } from "../src/sim/world.js";
import { DEEP, deepShift, cacheChance, valuePerKg, wantOf } from "../src/sim/deeploot.js";
import { launchExpedition } from "../src/sim/parties.js";
import { atBase } from "../src/sim/world.js";
import * as CC from "../src/sim/citycrawl.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };

console.log("The shift by block");
{
  const base = () => ({ f_beans: 40, water: 20, scrap: 10, meds: 4, ammo: 30, parts: 5 });
  const b2 = deepShift(base(), 2), b5 = deepShift(base(), 5);
  check(JSON.stringify(b2) === JSON.stringify(base()), "before block 3 nothing changes");
  check(b5.f_beans < 40 && b5.water < 20 && b5.scrap < 10, `block 5: fewer tins, water, scrap (${b5.f_beans} beans, ${b5.water} water, ${b5.scrap} scrap)`);
  check(b5.meds > 4 && b5.ammo > 30, `block 5: more meds and rounds (${b5.meds} meds, ${b5.ammo} rounds)`);
  check(b5.parts === 5, "parts (middling by the kilo) unchanged");
  check(valuePerKg("meds") > valuePerKg("f_beans") * 10, "meds are worth far more a kilo than beans");
  check(cacheChance(2) === 0 && cacheChance(3) > 0 && cacheChance(5) > cacheChance(3) && cacheChance(9) <= DEEP.cacheMax, "a cache: none before block 3, likelier deeper, capped");
}

console.log("What the base wants");
{
  const hungry = { stock: { f_beans: 4 } }, fed = { stock: { f_beans: 4000 } };
  check(wantOf(hungry, 10, "f_beans") > 1 && wantOf(fed, 10, "f_beans") < 1, "food: wanted when the base is short, less when it has plenty");
  check(wantOf({ stock: { meds: 0 } }, 10, "meds") > wantOf({ stock: { meds: 200 } }, 10, "meds"), "meds: wanted when short");
}

console.log("A full team swaps");
{
  const st = createWorld({ seed: 11, factionCount: 3 });
  const h = hub(st);
  const city = st.tiles.find((t) => t.loc && t.loc.type === "city");
  for (const k of ["food", "water", "ammo", "meds"]) h.stock[k] = Math.max(h.stock[k] || 0, 200);
  const crew = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: city.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 10 } });
  const p = res.party;
  p.path = [city.id]; p.idx = 0; p.dest = city.id; p.phase = "engaged";
  CC.startCrawl(st, p);
  // Fill the packs with scrap (0.5 a kilo), then find meds (80 a kilo).
  CC.takeFinds(st, p, p.crawl, { scrap: 500 }, []);
  const scrap0 = p.cargo.supplies.scrap || 0;
  const line = CC.takeFinds(st, p, p.crawl, { meds: 20 }, []);
  check(scrap0 > 0 && (p.cargo.supplies.meds || 0) === 20, `full of scrap (${scrap0}), it still takes the 20 meds`);
  check((p.cargo.supplies.scrap || 0) < scrap0 && /put down to make room: \d+ scrap/.test(line), `by putting scrap down: ${line}`);
  const before = JSON.stringify(p.cargo.supplies);
  CC.takeFinds(st, p, p.crawl, { scrap: 50 }, []);
  check(JSON.stringify(p.cargo.supplies) === before, "more scrap does not push the meds out");
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
