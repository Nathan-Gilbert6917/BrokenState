// The AI groups build storage (2026-10-19, the user's "have AI groups build storage units etc so the player can raid
// their supplies"; docs/adr/0001-ai-parity.md: your rules). groupworks.js storageWork: when goods lie outside a base of
// theirs tonight they put up your governor's choice (autopilot.js storageWish's ladder: a storage box at a camp, crates
// or a shed at an outpost, crates, a shed, the storehouse or a warehouse at the main base), the smallest that takes it,
// else the biggest they can build, by your buildings' rules (max, the warehouse's size and Mechanics 2) at your costs.
//   - which building by size and need, at the main base, an outpost camp and an outpost;
//   - the job pays your cost from their stock; once built the base has the building and its room;
//   - nothing outside, nothing built; the old "stores are full" storehouse; storeFactor;
//   - a group camp has no core room, a base of yours they took keeps its tier; the built-up base has room;
//   - a 60-day world where groups build storage and nothing throws.
// Usage: node tools/groupstoragetest.js [seed]
import { createWorld, tickHour, day, skill } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { storageOf, coreStoreKg } from "../src/sim/basestorage.js";
import { homesOf, syncBuildings, worksBuildings, BUILT_UP, stockTonight } from "../src/sim/groupbases.js";
import { placeMembers } from "../src/sim/members.js";
import { GROUP_WORKS, nextWork, groupWorksDaily, groupStorage, storeLock, storeDef, storeFactor, worksText, wallGoal, STORE_BUILDING } from "../src/sim/groupworks.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`  FAIL: ${what}`); } return !!ok; };
const section = (t) => console.log(t);
const W = GROUP_WORKS;
const STORE_KEYS = Object.keys(STORE_BUILDING);

// A world and one group with everything ahead of storage built at its main base (water, fields, quarters, the jail, an
// sick bay, its walls, a workshop, a kitchen, a pen, the works your locks ask for), its stores plain (scrap and parts to pay with, food), its people Mechanics `mech`.
function setup({ mech = 3 } = {}) {
  const st = createWorld({ seed: SEED, factionCount: 6 });
  st.visitorsOff = true;
  const f = st.factions.find((x) => x.alive && x.bases.length === 1 && !x.hcMilitary);
  const main = f.bases[0];
  f.works = { [main]: { water: 9, farms: 9, beds: 9, sickbay: W.SICKBAY.length, bench: 1, kitchen: 1, pens: 1, walls: wallGoal(f, main),
    shop: 1, radio: 1, garage: 1, reload: 1, gate: 1, mill: 1, grinder: 1 } };
  f.jails = { [main]: 3 };
  f.job = null;
  for (const k of Object.keys(f.stock)) if (typeof f.stock[k] === "number") f.stock[k] = 0;
  Object.assign(f.stock, { scrap: 120, parts: 6, buildmat: 6, food: f.pop * 10 }); // not short, short of the machines' surplus (MACH.foodDays)
  setMech(f, mech);
  homesOf(st, f);
  syncBuildings(st, f);
  return { st, f, main };
}
// Everyone's Mechanics at `mech`, their traits counted (world.js skill).
function setMech(f, mech) {
  for (const s of f.people || []) if (s.skills) { s.skills.mechanics = mech; s.skills.mechanics = mech - (skill(s, "mechanics") - mech); }
}
// Firewood (the cheapest a kg: it lies outside first) so that about `kg` lies outside the base tonight.
function pileOutside(st, f, tile, kg) {
  const s = groupStorage(st, f, tile);
  const wood = Math.ceil((kg + s.free) / 0.1);
  f.stock.wood = (f.stock.wood || 0) + wood;
  return groupStorage(st, f, tile);
}
const isStore = (w) => !!w && STORE_KEYS.includes(w.type);

// ======================================================================
section("Your costs and hours, your rules");
{
  const want = { storebox: [1, 1], crates: [3, 1], shed: [4, 2], store: [10, 3], warehouse: [40, 6] }; // scrap (wood besides: 2026-10-20; woodwork's costs)
  for (const [k, [scrap, work]] of Object.entries(want)) {
    const d = storeDef(k), B = BUILDINGS[STORE_BUILDING[k]];
    check(JSON.stringify(d.cost) === JSON.stringify(B.cost) && d.cost.scrap === scrap, `${d.name}: your cost (${JSON.stringify(d.cost)})`);
    check(d.work === work && d.work === Math.max(1, Math.round(B.hours / W.CREW_HOURS)), `${d.name}: ${B.hours} work-hours are ${d.work} crew-days`);
    check(W.WORKS[k].name === d.name && W.WORKS[k].work === d.work, `${d.name}: in WORKS`);
  }
  const { st, f, main } = setup({ mech: 1 });
  check(storeLock(st, f, main, "warehouse") === "Mechanics 2", `a warehouse wants a Mechanics 2 hand (${storeLock(st, f, main, "warehouse")})`);
  setMech(f, 2);
  check(storeLock(st, f, main, "warehouse") === "", "with one: the main base may have a warehouse");
  f.works[main].store = 1;
  check(storeLock(st, f, main, "store") !== "", "one storehouse a base");
  f.works[main].crates = 4;
  check(storeLock(st, f, main, "crates") !== "", "four lots of crates a base at most");
}

// ======================================================================
section("A group's base is measured by your rule (basestorage.js)");
{
  const { st, f, main } = setup();
  const h = homesOf(st, f)[main];
  check(coreStoreKg(h) === 1200 && storageOf(st, h).cap === 1200, `their main base: the hub's 1200 kg (${storageOf(st, h).cap})`);
  // An outpost of theirs, and an outpost camp not yet established.
  const free = st.tiles.filter((t) => !t.water && t.id !== main && !st.factions.some((o) => o.bases.includes(t.id)) && !st.bases.some((b) => b.tile === t.id));
  const [t1, t2] = [free[0].id, free[1].id];
  f.bases.push(t1, t2);
  f.works[t2] = { camp: 1 };
  const H = homesOf(st, f);
  check(H[t1].type === "outpost" && coreStoreKg(H[t1]) === 500, `an outpost of theirs: 500 kg (${coreStoreKg(H[t1])})`);
  check(H[t2].camp && coreStoreKg(H[t2]) === 0, `an outpost camp of theirs: no room, as yours (${coreStoreKg(H[t2])})`);
  // A camp of yours they took keeps its camp flag and tier (groupbases.js real).
  const yours = { id: 999999, tile: t1, type: "outpost", tier: 0, camp: true, name: "Your camp", stock: {}, armory: [], buildings: [], construction: [], real: true, group: true };
  H[t1] = yours;
  homesOf(st, f);
  check(yours.camp === true && coreStoreKg(yours) === 0, "a camp of yours they took is still a camp (no room)");
  // The stores tonight: the outposts' people's share (groupbases.js spreadStores), the rest at the main base.
  const tn = stockTonight(st, f);
  check(Object.keys(tn).length === 3 && (tn[main].food || 0) <= f.stock.food, "stockTonight: every base, the main base's share no more than the whole");
}

// ======================================================================
section("What they build, by size and need");
{
  const cases = [[40, "crates"], [400, "shed"], [1500, "store"], [4000, "warehouse"]];
  for (const [kg, type] of cases) {
    const { st, f, main } = setup();
    Object.assign(f.stock, { scrap: 200, buildmat: 10, parts: 10 });
    const s = pileOutside(st, f, main, kg);
    const w = nextWork(st, f);
    check(w && w.type === type && w.tile === main, `${Math.round(s.outsideKg)} kg outside the main base: ${type} (${w && w.type}: ${w && w.why})`);
  }
  // No Mechanics 2 hand: the biggest they can build (the storehouse).
  {
    const { st, f, main } = setup({ mech: 1 });
    Object.assign(f.stock, { scrap: 200, buildmat: 10, parts: 10 });
    pileOutside(st, f, main, 4000);
    const w = nextWork(st, f);
    check(w && w.type === "store", `4000 kg outside, nobody at Mechanics 2: the storehouse (${w && w.type})`);
    f.works[main].store = 1;
    const w2 = nextWork(st, f);
    check(w2 && w2.type === "shed", `and with the storehouse up, a shed (${w2 && w2.type})`);
  }
  // Short of the materials: nothing they cannot pay for (as your canBuild), the cheaper ones still.
  {
    const { st, f, main } = setup();
    Object.assign(f.stock, { scrap: 3, buildmat: 0, parts: 0 }); // woodwork: a storehouse is 10 scrap and 400 wood now, the wood piled outside pays for it
    pileOutside(st, f, main, 1500);
    const w = nextWork(st, f);
    check(w && w.type === "crates", `1500 kg outside, 3 scrap: crates, what they can pay for (${w && w.type})`);
    f.stock.scrap = 0;
    const w2 = nextWork(st, f);
    check(!isStore(w2), `no scrap: no storage (${w2 && w2.type})`);
  }
  // Everything inside: none.
  {
    const { st, f, main } = setup();
    f.stock.scrap = 40; // under the old "stores are full" mark
    const s = groupStorage(st, f, main);
    const w = nextWork(st, f);
    check(s.outsideKg === 0 && !isStore(w), `everything inside (${s.inside} of ${s.cap} kg): no storage (${w && w.type})`);
  }
  // Storage comes after water and quarters.
  {
    const { st, f, main } = setup();
    pileOutside(st, f, main, 400);
    f.works[main].water = 0;
    check(nextWork(st, f).type === "water", "water before storage");
    f.works[main].water = 9; f.works[main].beds = 0;
    check(nextWork(st, f).type === "beds", "quarters before storage");
  }
  // An outpost: crates or a shed (your governor's outpost ladder), never the storehouse.
  {
    const { st, f, main } = setup();
    const t1 = st.tiles.find((t) => !t.water && t.id !== main && !st.factions.some((o) => o.bases.includes(t.id)) && !st.bases.some((b) => b.tile === t.id)).id;
    f.bases.push(t1);
    f.works[t1] = { water: 9, farms: 9, beds: 9, walls: wallGoal(f, t1), pens: 1, kitchen: 1 };
    Object.assign(f.works[main], { store: 1, warehouse: 2 }); // room enough at the main base for its share
    homesOf(st, f);
    placeMembers(st, f);
    // Their people at the outpost: its share of the stores (as the supply run leaves them).
    const tn = stockTonight(st, f);
    const share = (tn[t1].scrap || 0) / Math.max(1, f.stock.scrap);
    if (check(share > 0, `the outpost has people and its share of the stores (${Math.round(share * 100)}%)`)) {
      f.stock.wood = Math.ceil(3000 / 0.1 / share);
      const s = groupStorage(st, f, t1);
      const w = nextWork(st, f);
      check(s.outsideKg > 600 && w && w.tile === t1 && w.type === "shed", `${Math.round(s.outsideKg)} kg outside the outpost: a shed (${w && w.tile === t1 ? w.type : JSON.stringify(w)})`);
    }
  }
  // An outpost camp: a storage box first, from the scrap the step up does not need; never a warehouse there.
  {
    const { st, f, main } = setup();
    const t1 = st.tiles.find((t) => !t.water && t.id !== main && !st.factions.some((o) => o.bases.includes(t.id)) && !st.bases.some((b) => b.tile === t.id)).id;
    f.bases.push(t1);
    f.works[t1] = { camp: 1 };
    Object.assign(f.works[main], { store: 1, warehouse: 2 }); // room enough at the main base for its share
    homesOf(st, f);
    placeMembers(st, f);
    f.stock.wood = 20000;
    const s = groupStorage(st, f, t1);
    const w = nextWork(st, f);
    check(s.cap === 0 && s.outsideKg > 5 && w && w.tile === t1 && w.type === "storebox", `${Math.round(s.outsideKg)} kg on the ground at a camp: a storage box (${w && w.type})`);
    check(storeLock(st, f, t1, "warehouse") === "an outpost or the main base", "a warehouse: an outpost or the main base only");
    check(storeLock(st, f, t1, "shed") !== "", "no shed at a camp (your camp builds none)");
    f.stock.scrap = W.CAMP.cost.scrap;
    const w2 = nextWork(st, f);
    check(w2 && w2.type === "camp", `scrap for the step up only: the camp first (${w2 && w2.type})`);
    f.stock.scrap = 200; f.works[t1].storebox = 4;
    const w3 = nextWork(st, f);
    check(w3 && w3.type === "camp", `four boxes (your camp's most): the camp's step up (${w3 && w3.type})`);
  }
}

// ======================================================================
section("The job pays your cost, the building stands, the room grows");
{
  for (const [kg, type] of [[400, "shed"], [4000, "warehouse"]]) {
    const { st, f, main } = setup();
    Object.assign(f.stock, { scrap: 200, buildmat: 10, parts: 10 });
    f.works[main].shop = 0; // no machine shop turning their scrap into parts today (locked: Mechanics 4)
    const before = pileOutside(st, f, main, kg);
    const s0 = { ...f.stock };
    check(nextWork(st, f).type === type, `${type} is next`);
    groupWorksDaily(st, f);
    const cost = storeDef(type).cost;
    check((f.job && f.job.type === type && f.job.paid) || (!f.job && f.works[main][type] === 1), `the ${type} job starts paid (${JSON.stringify(f.job)})`);
    check(Object.entries(cost).every(([k, v]) => Math.abs((s0[k] || 0) - v - (f.stock[k] || 0)) < 1e-6), `it took your cost from their stock (${JSON.stringify(cost)}: ${JSON.stringify(Object.fromEntries(Object.keys(cost).map((k) => [k, (s0[k] || 0) - (f.stock[k] || 0)])))})`);
    let days = 1;
    while (f.job && days < 30) { groupWorksDaily(st, f); days++; }
    check(!f.job && f.works[main][type] === 1, `built in ${days} days (${storeDef(type).work} crew-days for ${f.pop} people)`);
    syncBuildings(st, f);
    const h = homesOf(st, f)[main];
    check(h.buildings.some((b) => b.type === STORE_BUILDING[type]), `the main base has the ${BUILDINGS[STORE_BUILDING[type]].name}`);
    const after = storageOf(st, h);
    check(after.cap === before.cap + BUILDINGS[STORE_BUILDING[type]].storeKg && after.outsideKg < before.outsideKg, `room ${before.cap} → ${after.cap} kg, outside ${Math.round(before.outsideKg)} → ${Math.round(after.outsideKg)} kg`);
    check(worksText(st, f).includes(STORE_BUILDING[type] === "storehouse" ? "a storehouse" : W.WORKS[type].name), `the Groups card names it (${worksText(st, f)})`);
    check(storeFactor(st, f) === 1, "with storage they keep their full caps (storeFactor 1)");
  }
  const { st, f } = setup();
  check(storeFactor(st, f) === W.STORE_CAP, "without any, STORE_CAP");
}

// ======================================================================
section("The old storehouse once the stores are full");
{
  const { st, f } = setup();
  f.stock.scrap = Math.ceil(f.pop * 10 * W.STORE_CAP * W.STORE_FULL) + 1;
  const w = nextWork(st, f);
  check(groupStorage(st, f, f.bases[0]).outsideKg === 0 && w && w.type === "store" && w.why === "the stores are full", `scrap at its cap: the storehouse (${w && w.type}: ${w && w.why})`);
}

// ======================================================================
section("The base not built by hand (the hardcore military)");
{
  const { st, f, main } = setup();
  f.hcMilitary = true;
  syncBuildings(st, f);
  const h = homesOf(st, f)[main];
  const s = storageOf(st, h);
  check(BUILT_UP.store === 1 && worksBuildings(st, f, main).storehouse === 1 && h.buildings.some((b) => b.type === "storehouse"), "a built-up base has its storehouse");
  check(s.cap >= 3200 && s.outsideKg === 0, `its room ${s.cap} kg, ${s.used} kg of goods, none outside`);
  check(nextWork(st, f) === null, "and builds nothing");
}

// ======================================================================
section("60 days of a world (no player: the groups only)");
{
  const st = createWorld({ seed: SEED, factionCount: 4 });
  st.visitorsOff = true;
  st.survivors = []; // nobody of yours: the run never ends (world.js checkGameOver) and the groups live on their own
  let err = null;
  const seen = new Set();
  try {
    while (day(st) <= 60 && !st.gameOver) {
      tickHour(st);
      st.cards.length = 0;
      for (const f of st.factions) if (f.job && STORE_KEYS.includes(f.job.type)) seen.add(`${f.name}: ${f.job.type}`);
    }
  } catch (e) { err = e; }
  check(!err, `nothing throws${err ? `: ${err.stack}` : ""}`);
  check(day(st) > 60, `the run reaches day 60 (day ${day(st)})`);
  const built = st.factions.filter((f) => f.works && Object.values(f.works).some((w) => STORE_KEYS.some((k) => (w[k] || 0) > 0)));
  check(built.length >= 1, `a group builds storage (${built.map((f) => f.name).join(", ")}; jobs seen: ${[...seen].join("; ")})`);
  for (const f of built.filter((x) => x.alive)) {
    const H = homesOf(st, f);
    const ok = f.bases.every((t) => { const w = f.works[t] || {}; const h = H[t]; if (h.real) return true; return STORE_KEYS.every((k) => h.buildings.filter((b) => b.type === STORE_BUILDING[k]).length === (w[k] || 0)); });
    check(ok, `${f.name}: its bases have the storage buildings its works say (${worksText(st, f)})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
