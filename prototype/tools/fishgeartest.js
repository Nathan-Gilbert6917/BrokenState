// Fishing tools and gear durability (src/sim/hunting.js fishKit / fishRate / fishHour / huntingDaily, data.js GEAR_DUR,
// crafting.js craftedDur / itemDur / wearHeld / craftingDaily, inventory.js newItem worn, valuation.js itemValue).
// Usage: node tools/fishgeartest.js [seed] (default 42).
// - The new tools: a makeshift rod (crafted, also in the field), a steel spear (looted, a weapon), the pipe spear as
//   a makeshift spear; what each catches, a tool's quality in its catch, spears by daylight and never through ice.
// - Fishing wears the tools: a team's every FISH.wearHours, a base's Fish job each day; a worn-out rod is gone.
// - Durability on real gear: weapons and armor wear a use a fight, found gear is part-worn (FOUND_DUR) without moving
//   the world's dice, starting gear START_DUR, crafted gear by its quality; camp kit wears a day in the field; worn
//   gear is worth less; the governor makes a rod for a base by the water with nothing to fish with.
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, atBase, makeSurvivor, survivorById } from "../src/sim/world.js";
import { GEAR, GEAR_DUR } from "../src/sim/data.js";
import { CRAFTS, canCraft, makeItem, itemDur, itemDurMax, wearAfterFight, craftingDaily, craftedDur, fieldCraftOptions } from "../src/sim/crafting.js";
import { WEAPONS } from "../src/sim/combat.js";
import { launchExpedition, planPath, partyMembers } from "../src/sim/parties.js";
import * as H from "../src/sim/hunting.js";
import { newItem, FOUND_DUR, START_DUR, enemyBody } from "../src/sim/inventory.js";
import { itemValue } from "../src/sim/valuation.js";
import { planCrafts } from "../src/sim/autopilot.js";
import { HUNT_FINDS, ITEM_TAGS } from "../src/sim/loot.js";
import * as Weather from "../src/sim/weather.js";
import { AR } from "../src/sim/armour.js"; // per-hit armour wear by material

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const note = (s) => console.log(`  ${s}`);
const r2 = (x) => Math.round(x * 100) / 100;

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 6 });
  state.started = true;
  state.autoCombat = true;
  Object.assign(hub(state).stock, { water: 400, fuel: 100, meds: 20, ammo: 400, parts: 10, scrap: 100 }); setFood(hub(state), 400);
  return state;
}
// A team of n fresh people on a tile, empty-handed (hunttest.js placeTeam, kept short).
function placeTeam(state, tile, n = 2) {
  const h = hub(state);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(state);
    s.location = { kind: "base", baseId: h.id };
    s.gear.weapon = null; s.gear.tool = null;
    s.pockets = (s.pockets || []).map(() => null);
    if (s.gear.backpack && s.gear.backpack.contents) s.gear.backpack.contents = s.gear.backpack.contents.map(() => null);
    state.survivors.push(s); ids.push(s.id);
  }
  const near = state.tiles.find((t) => t.terrain !== "water" && state.grid.distance(t.id, h.tile) === 2 && planPath(state, h.tile, t.id, false));
  const res = launchExpedition(state, { memberIds: ids, dest: near.id, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.dest = tile; p.progress = 0; p.orders = []; p.phase = "waiting"; p.task = null;
  p.cargo = { supplies: {}, gear: [] };
  return p;
}
function fishFor(state, p, hours, startHour) {
  state.fish = {};
  state.hour = startHour;
  p.phase = "task";
  p.task = { type: "fish", hours, done: 0 };
  for (let i = 0; i < hours; i++) { state.hour += 1; p.task.done += 1; if (!H.fishHour(state, p)) break; }
  return p.task.got || { rations: 0 };
}
const dayIn = (state, key, test = () => true) => {
  for (let d = 0; d < 400; d++) if (Weather.season(state, d * 24 + 12).key === key && test(Weather.weather(state, d * 24 + 12))) return d;
  return null;
};

// ======================================================================
section("The new fishing tools");
{
  const state = mk();
  const h = hub(state);
  check(GEAR.makeshiftrod && GEAR.makeshiftrod.fish === "rod" && GEAR.makeshiftrod.makeshift, "a makeshift rod is a fishing rod, makeshift");
  check(GEAR.spear && GEAR.spear.slot === "weapon" && GEAR.spear.fish === "spear" && WEAPONS.spear && WEAPONS.spear.melee, "a steel spear is a melee weapon and a fishing spear");
  check(GEAR.pipespear.fish === "spear", "the pipe spear (makeshift) spears fish too");
  check(CRAFTS.makeshiftrod && CRAFTS.makeshiftrod.field && canCraft(state, h, "makeshiftrod").ok, "a makeshift rod can be crafted at a base");
  const p = placeTeam(state, h.tile, 1);
  p.supplies.scrap = 2; p.supplies.wood = 5; // a sapling's 5 wood too since woodwork 2026-10-20 (crafting.js makeshiftrod: 1 scrap, 5 wood)
  const opt = fieldCraftOptions(state, p).find((o) => o.key === "makeshiftrod");
  check(opt && opt.ok, "and in the field from a team's scrap and wood");
  check(Object.values(HUNT_FINDS).some((f) => f.items.spear) && ITEM_TAGS.spear && GEAR_DUR.spear, "the spear turns up at lodges, cabins and campgrounds, and wears");
  const angler = makeSurvivor(state);
  const one = (it) => H.fishKit([angler], [it]); // the same fisher for every tool: the tools are compared
  const rod = one(newItem("fishrod")), mrod = one(newItem("makeshiftrod")), spear = one(newItem("spear")), pipe = one(newItem("pipespear"));
  note(`one fisher's power: rod ${r2(rod.power)}, steel spear ${r2(spear.power)}, makeshift rod ${r2(mrod.power)}, pipe spear ${r2(pipe.power)}`);
  check(rod.power > spear.power && spear.power > mrod.power && mrod.power > pipe.power, "a rod > a steel spear > a makeshift rod > a pipe spear");
  check(spear.spears === 1 && spear.spear === spear.power && rod.spear === 0, "a spear's part of the kit is kept apart (by sight)");
  const good = one(makeItem("makeshiftrod", 1)), poor = one(makeItem("makeshiftrod", 0.6));
  check(good.power > poor.power * 1.15, `a well-made rod catches more (${r2(good.power)} vs ${r2(poor.power)})`);
  // Who takes what: one fisher, the best tool; two fishers, both tools.
  const s1 = makeSurvivor(state), s2 = makeSurvivor(state);
  const k1 = H.fishKit([s1], [newItem("pipespear"), newItem("fishrod")]);
  check(k1.tools.length === 1 && k1.tools[0].key === "fishrod", "one fisher takes the best tool");
  const k2 = H.fishKit([s1, s2], [newItem("pipespear"), newItem("fishrod")]);
  check(k2.tools.length === 2 && k2.used === 2, "two fishers use both");
  const kf = H.fishKit([s1], [newItem("spear"), newItem("makeshiftrod")], { frozen: true });
  check(kf.tools.length === 1 && kf.tools[0].key === "makeshiftrod", "on ice the rod goes first (a spear is no use there)");
}

// ======================================================================
section("Spears: daylight, never through ice");
{
  const state = mk();
  const river = state.tiles.find((t) => t.terrain !== "water" && !t.loc && !state.bases.some((b) => b.tile === t.id) && H.fishSpot(state, t.id));
  check(!!river, "the map has a river bank");
  const sum = dayIn(state, "summer", (w) => !w.severe);
  const kit = H.fishKit([makeSurvivor(state)], [newItem("spear")]);
  const noon = H.fishRate(state, kit, river.id, sum * 24 + 12), night = H.fishRate(state, kit, river.id, sum * 24 + 23);
  check(noon > night * 4, `a spear fishes by day, hardly at night (${r2(noon)} vs ${r2(night)} an hour)`);
  const rodKit = H.fishKit([makeSurvivor(state)], [newItem("fishrod")]);
  check(H.fishRate(state, rodKit, river.id, sum * 24 + 6) > H.fishRate(state, rodKit, river.id, sum * 24 + 12), "a rod still does best at dawn");
  const frozen = dayIn(state, "winter", (w) => w.frozen);
  if (frozen != null) {
    check(H.fishRate(state, kit, river.id, frozen * 24 + 12) === 0, "a spear catches nothing through ice");
    const p = placeTeam(state, river.id, 1);
    p.cargo.gear.push(newItem("spear"));
    state.hour = frozen * 24 + 12;
    check(/spear is no use through the ice/.test(H.fishProblem(state, p)), "and the order says so");
  } else note("no frozen day on this seed: ice not checked");
  const p = placeTeam(state, river.id, 1);
  state.hour = sum * 24 + 8;
  check(/rod, a net or a spear/.test(H.fishProblem(state, p)), "nothing to fish with: the order says what would do");
  p.cargo.gear.push(newItem("pipespear"));
  check(H.fishProblem(state, p) === "", "a pipe spear in the cargo: the team can fish");
  const got = fishFor(state, p, 8, sum * 24 + 8);
  check(got.rations > 0, `8 daylight hours with a pipe spear bring in fish (${r2(got.rations)})`);
}

// ======================================================================
section("Fishing wears the tools");
{
  const state = mk();
  const river = state.tiles.find((t) => t.terrain !== "water" && !t.loc && !state.bases.some((b) => b.tile === t.id) && H.fishSpot(state, t.id));
  const sum = dayIn(state, "summer", (w) => !w.severe);
  const p = placeTeam(state, river.id, 1);
  const rod = newItem("fishrod");
  p.cargo.gear.push(rod);
  fishFor(state, p, 12, sum * 24 + 4);
  check(rod.dur === GEAR.fishrod.dur - 12 / H.FISH.wearHours, `12 hours' fishing wears a rod by ${12 / H.FISH.wearHours} (${rod.dur} left)`);
  rod.dur = 1;
  fishFor(state, p, H.FISH.wearHours, sum * 24 + 4);
  check(!p.cargo.gear.includes(rod), "a worn-out rod breaks and is gone from the cargo");
  check(state.log.some((l) => /Fishing rod broke/.test(l.text || l.msg || String(l))), "and the log says so");
  // A base's Fish job: a day of fishing is a use on each tool in use.
  const h = hub(state);
  h.tile = river.id; // put the hub by the water for the job
  const fisher = atBase(state, h.id)[0];
  for (const s of atBase(state, h.id)) s.role = "rest";
  fisher.role = "fish"; fisher.inBed = false; fisher.health = 100;
  const mrod = makeItem("makeshiftrod", 0.75);
  h.armory.push(mrod);
  check(H.fishWorkWhy(state, h) === "", "a rod in the armory: the Fish job can be worked");
  state.hour = sum * 24 + 23;
  const d0 = mrod.dur;
  H.huntingDaily(state, h);
  check(mrod.dur === d0 - 1, `a day of the Fish job wears the rod by 1 (${d0} → ${mrod.dur})`);
  h.armory.splice(h.armory.indexOf(mrod), 1);
  for (const s of atBase(state, h.id)) for (const k of ["weapon", "tool"]) if (s.gear[k] && GEAR[s.gear[k].key].fish) s.gear[k] = null;
  for (let i = h.armory.length - 1; i >= 0; i--) if (GEAR[h.armory[i].key].fish) h.armory.splice(i, 1);
  check(H.fishWorkWhy(state, h) === "no fishing rod, net or spear here", "no tools left: the job cannot be worked");
  // The governor makes a rod for it.
  Object.assign(h.stock, { scrap: 300, parts: 20, meds: 40, water: 400 }); setFood(h, 400);
  // Its other wants met first (filters, a weapon and armor for everyone), so the rod is what is left to make.
  for (let i = 0; i < 4; i++) h.armory.push(newItem("waterfilter"));
  for (const s of atBase(state, h.id)) { if (!s.gear.weapon) s.gear.weapon = newItem("machete"); if (!s.gear.armor) s.gear.armor = newItem("vest"); }
  const seen = [];
  for (let i = 0; i < 8 && !seen.includes("makeshiftrod"); i++) { h.crafting = []; planCrafts(state, h); seen.push(...h.crafting.map((j) => j.recipe)); }
  h.crafting = seen.includes("makeshiftrod") ? [{ recipe: "makeshiftrod" }] : seen.map((r) => ({ recipe: r }));
  check(h.crafting.some((j) => j.recipe === "makeshiftrod"), `the governor queues a makeshift rod (queue: ${h.crafting.map((j) => j.recipe).join(", ") || "empty"})`);
}

// ======================================================================
section("Durability on real gear");
{
  const state = mk();
  for (const k of ["pistol", "huntrifle", "machete", "vest", "milhelmet", "riotarms", "kneeguards", "fishrod", "fishnet", "ghillie", "surgkit"])
    check(GEAR[k].dur > 0, `${GEAR[k].name} wears (${GEAR[k].dur} ${k === "surgkit" ? "treatments" : ""})`);
  check(!GEAR.binoculars.dur && !GEAR.novel.dur, "things that do not wear stay that way (optics, books)");
  // Armour's dur is its durability points (armour.js, section 17): a tire vest loses its share of them over twice as fast a hit as a kevlar vest.
  check(GEAR.pistol.dur > GEAR.pipegun.dur * 4 && AR.WEAR.padding / GEAR.tirevest.dur > 2 * AR.WEAR.soft / GEAR.vest.dur, "makeshift gear wears much faster than the real thing");
  const s = makeSurvivor(state);
  s.gear.weapon = newItem("pistol"); s.gear.armor = newItem("vest"); s.gear.head = newItem("riothelmet");
  wearAfterFight(state, [s]);
  check(s.gear.weapon.dur === GEAR.pistol.dur - 1 && s.gear.armor.dur === GEAR.vest.dur - 1 && s.gear.head.dur === GEAR.riothelmet.dur - 1, "a fight wears a pistol, a vest and a helmet by 1");
  s.gear.weapon.dur = 1;
  wearAfterFight(state, [s]);
  check(!s.gear.weapon, "a worn-out pistol breaks and is gone");
  // Found gear: part-worn, and the roll moves none of the world's dice.
  const rng = state.rng;
  const at = rng.state;
  const found = Array.from({ length: 200 }, (_, i) => newItem("huntrifle", 1, i / 200));
  check(rng.state === at, "the worn roll draws nothing from the rng");
  const lo = Math.round(GEAR.huntrifle.dur * FOUND_DUR.lo), hi = GEAR.huntrifle.dur;
  check(found.every((it) => it.dur >= lo && it.dur <= hi) && Math.min(...found.map((x) => x.dur)) <= lo + 1 && Math.max(...found.map((x) => x.dur)) >= hi - 1, `found rifles have ${lo}–${hi} uses left`);
  check(itemDurMax(found[0]) === GEAR.huntrifle.dur, "a found item's full uses are the listed ones");
  const bodies = Array.from({ length: 300 }, () => enemyBody(rng, { kind: "human", name: "x", id: 1, weapon: "pistol", armorKey: "vest" }, null));
  const durs = bodies.map((b) => b.gear.weapon.dur);
  check(new Set(durs).size > 10 && durs.every((d) => d >= 1 && d <= GEAR.pistol.dur), `a raider's pistol is worn by a random amount (${Math.min(...durs)}–${Math.max(...durs)} of ${GEAR.pistol.dur})`);
  const pq = newItem("pipespear", 1, rng);
  check(pq.dur >= 1 && pq.dur <= GEAR.pipespear.dur, "found makeshift gear is part-worn too");
  check(newItem("soap", 1, rng).dur === GEAR.soap.dur && newItem("puritabs", 1, rng).dur === GEAR.puritabs.dur, "counts (toiletries, tablets) are found full");
  // Starting gear.
  const starts = state.survivors.filter((x) => x.gear.weapon && GEAR[x.gear.weapon.key].dur);
  check(starts.length > 0 && starts.every((x) => x.gear.weapon.dur >= Math.round(GEAR[x.gear.weapon.key].dur * START_DUR.lo) - 1 && x.gear.weapon.dur <= GEAR[x.gear.weapon.key].dur), "the starting weapons are looked after but worn");
  const sd = starts.map((x) => x.gear.weapon.dur / GEAR[x.gear.weapon.key].dur);
  note(`starting weapons: ${sd.map((x) => Math.round(x * 100) + "%").join(" ")}`);
  check(new Set(sd).size > 1, "and not all the same");
  // Crafted: by quality.
  check(craftedDur(10, 0.75) === 10 && craftedDur(10, 1) === 12 && craftedDur(10, 0.6) < 10, "a crafted item's uses by its quality (75% = the listed, 100% = +20%)");
  const best = makeItem("sawmachete", 1), worst = makeItem("sawmachete", 0.6);
  check(itemDurMax(best) > itemDurMax(worst) && best.durMax === itemDurMax(best), "a well-made machete lasts longer, and keeps its own full uses");
  // Worn gear is worth less.
  const fresh = newItem("huntrifle"), worn = newItem("huntrifle", 1, 0);
  delete fresh.mods; delete worn.mods; // factoryfit.js: its factory scope sells unworn with it; the gun's own wear is the check
  check(itemValue(worn) < itemValue(fresh) * 0.7, `a worn rifle is worth less (${r2(itemValue(worn))} vs ${r2(itemValue(fresh))})`);
  // Camp kit wears a day in the field.
  const h = hub(state);
  const p = placeTeam(state, h.tile, 1);
  const ghillie = newItem("ghillie");
  p.cargo.gear.push(ghillie);
  craftingDaily(state);
  check(ghillie.dur === GEAR.ghillie.dur - 1, "a ghillie wrap wears a day out in the field");
  const atHome = newItem("ghillie");
  h.armory.push(atHome);
  craftingDaily(state);
  check(atHome.dur === GEAR.ghillie.dur, "one kept in the armory does not");
  // Old saves: items made before durability start full.
  check(itemDur({ key: "pistol", name: "9mm", quality: 1 }) === GEAR.pistol.dur, "an item from an old save starts full");
}

console.log(`${fails ? `${fails} FAILED, ` : ""}${passed} passed`);
if (fails) process.exit(1);
