// The pt-int merge (2026-10-20): baseview's tents on the base map, tentkit's tent bags, the beds agent's furniture and
// softcover's tent wear, reconciled into one model. Each section is one of the reconciliation's rules:
// - One tent table: data-tents.js TENT_TYPES; buildings.js TENTS is the same object (footprint, sleepers, storage
//   0 / S / 2S / 4S, mood, bag). Only the Makeshift tent is built.
// - A pitched bag is a base map piece (basemap.js pitchTent: base.buildings { type: "tent" }): drawn on the map, beds
//   counted once (tentBeds in baseBeds), struck back into its bag; pitched from the base map's Build list (Tents) too.
// - A new camp has 0 beds; a camp is never crowded.
// - Sleeping rough applies once (beds.js bedLine; not the crowding, not the camp's day).
// - Bed moods: tents in the beds' best-first list (makeshift −1, tents 0) with the furniture (cot −1, bunk −0.5, bed 0,
//   large bed +1); each sleeper one bed line.
// - Storage counted once (a "tent" container keyed b:<id>, the Tents dry room), never twice.
// - The governor: spare bags first, then Makeshift tents, then the furniture.
// - The hardcore start's bags get pitched at the first home.
// - softcover: a b:<id> tent's wear persists on its record; the old plan.tentHp is dropped on load.
// - Old saves: tentkit's base.tents list becomes map pieces.
// - AI: a group's camp battle map stands with its real tents, else four makeshift ones.
// Usage: node tools/ptinttest.js [seed]   ("passed" / "failed" lines; exits 1 on a failure)
import { createWorld, hub, atBase, residents, makeSurvivor, newId } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem } from "../src/sim/inventory.js";
import { launchExpedition, giveOrder, partyMembers } from "../src/sim/parties.js";
import { BUILDINGS, TENTS, TENT_STORE_KG, baseBeds, tentBeds, isCamp, queueBuild } from "../src/sim/buildings.js";
import { TENT_TYPES, TENT_S, TENT_BAGS } from "../src/sim/data-tents.js";
import { BED_MOOD, BED_SPEC, ROUGH_WEATHER } from "../src/sim/data-beds.js";
import * as T from "../src/sim/tents.js";
import * as BD from "../src/sim/beds.js";
import * as BM from "../src/sim/basemap.js";
import * as SOFT from "../src/sim/softcover.js";
import { pitchArrive } from "../src/sim/staging.js";
import { storageOf } from "../src/sim/basestorage.js";
import { containersOf, putSupply, putItem, normalizeBins } from "../src/sim/containers.js";
import { storeSpaces } from "../src/sim/storage.js";
import { crowdInfo } from "../src/sim/morale.js";
import { moodFactors } from "../src/sim/relations.js";
import { createBattle, finishCombat } from "../src/sim/combat.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { craftQueue } from "../src/sim/crafting.js";
import { constructionHour, canBuild, addBuilding, gatherRows, tierUpJobFor } from "../src/sim/buildings.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { woodNeed } from "../src/sim/woodcutting.js";
import { woodpileOf, storageSummary } from "../src/sim/basestorage.js";
import * as TE from "../src/sim/tripevents.js";
import { packLights, hasLight } from "../src/sim/lights.js";
import { allItems, rigPouches } from "../src/sim/inventory.js";
import { roadTeam } from "../src/sim/hardcore-start.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const t0 = Date.now();
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "passed" : "failed"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);

function world(s = seed, extra = {}) {
  const st = createWorld({ seed: s, factionCount: 4, ...extra });
  st.started = true; st.visitorsOff = true; st.noWanderers = true; st.nomadsOff = true;
  st.hordes.length = 0;
  return st;
}
function campTile(st, d = 3) {
  const h = hub(st);
  return st.tiles.find((t) => t.terrain !== "water" && !t.hive && !t.bridge && st.grid.distance(t.id, h.tile) === d && !st.bases.some((b) => b.tile === t.id) && (t.owner == null || t.owner === "player") && !st.factions.some((f) => f.bases.includes(t.id))).id;
}
// A team of n set up as a camp at once (no hour of pitching); bags: tent bag keys in its cargo.
function campWith(st, n, bags = []) {
  const h = hub(st);
  Object.assign(h.stock, { water: 300, ammo: 300, meds: 20 });
  const crew = atBase(st, h.id).slice(0, n);
  for (const s of crew) { s.health = 100; s.mood = 60; if (s.gear) s.gear.carry = null; }
  const dest = campTile(st);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  const p = res.party;
  if (!p) throw new Error(`no team: ${res.error || JSON.stringify(res)}`);
  p.path = [dest]; p.idx = 0; p.phase = "waiting"; p.dest = dest;
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  for (const k of bags) p.cargo.gear.push(newItem(k));
  p.mission = "camp"; p.pitched = true;
  pitchArrive(st, p, "camp");
  return st.bases.find((x) => x.tile === dest);
}
const lines = (st, s) => moodFactors(st, s).list;
const bedLines = (st, s) => lines(st, s).filter((l) => /^Sleeps /.test(l.label));

// ---------- 1. one tent table ----------
section("One tent table");
{
  check(TENTS === TENT_TYPES, "buildings.js TENTS is data-tents.js TENT_TYPES (one object, not a copy)");
  check(TENT_STORE_KG === TENT_S && TENT_S === 15, `S = ${TENT_S} kg`);
  const want = { makeshift: [1, 2, 1, 0, -1, false], tent1: [1, 2, 1, 1, 0, true], tent2: [2, 2, 2, 2, 0, true], tent4: [3, 3, 4, 4, 0, true] };
  check(Object.entries(want).every(([k, [w, h, n, s, m, bag]]) => TENTS[k].w === w && TENTS[k].h === h && TENTS[k].sleepers === n && TENTS[k].storeKg === s * TENT_S && TENTS[k].mood === m && TENTS[k].bag === bag), "makeshift 1×2 1 bed 0 kg −1 no bag; tent1 1×2 1 15 kg; tent2 2×2 2 30 kg; tent4 3×3 4 60 kg; tents mood 0");
  check(Object.keys(TENTS).filter((k) => TENTS[k].buildable).join() === "makeshift" && BUILDINGS.tent.name === "Makeshift tent" && !Object.keys(BUILDINGS).some((k) => TENT_BAGS.includes(k)), "only the Makeshift tent is built (BUILDINGS.tent); the bags' tents are never builds");
  check(TENT_BAGS.every((k) => GEAR[k] && GEAR[k].tent === k), "each bag pitches the tent of its own key");
}

// ---------- 2. a new camp has 0 beds ----------
section("A new camp: no beds until a tent is up; never crowded");
{
  const st = world();
  const camp = campWith(st, 3);
  check(isCamp(camp) && baseBeds(camp) === 0 && tentBeds(camp) === 0 && !T.tentsOf(camp).length, `a new camp of 3 without bags: ${baseBeds(camp)} beds`);
  const ci = crowdInfo(st, camp);
  check(ci.penalty === 0 && !ci.roomy && ci.level.key === "rough", `never crowded (penalty ${ci.penalty}, ${ci.level.name})`);
  const s = atBase(st, camp.id)[0];
  check(!lines(st, s).some((l) => /^Crowded|A bed for everyone/.test(l.label)), "no crowding line and no bed-for-everyone line at the camp");
}

// ---------- 3. rough sleeping applies once ----------
section("Sleeping rough: one rule, applied once");
{
  const st = world(seed + 1);
  const camp = campWith(st, 3);
  st.hour = Math.ceil(st.hour / 24) * 24;
  const people = atBase(st, camp.id);
  const before = people.map((s) => s.mood);
  T.campTentsDaily(st, camp); // the camp's tents' day (staging.js campsHour; its fire's mood is campDaily's own)
  check(people.every((s, i) => s.mood === before[i]), "the camp's day takes no mood for it (tentkit's daily cost is gone)");
  const n = BD.roughNight(st, camp);
  const ls = people.map((s) => lines(st, s).filter((l) => /rough/i.test(l.label)));
  check(ls.every((l) => l.length === 1 && l[0].v === n.v && l[0].own), `each of the three has exactly one rough line, applied by relations.js (${ls[0][0] && ls[0][0].label}: ${n.v})`);
  check(n.v === BED_MOOD.rough * (n.cold ? 3 : n.wet ? 2 : 1) && BED_MOOD.rough === -1 && ROUGH_WEATHER.wet === 2 && ROUGH_WEATHER.freezing === 3, `−1 a day, ×2 wet, ×3 freezing (tonight: wet ${n.wet}, freezing ${n.cold}: ${n.v})`);
  // A base past its beds: the rough line for each without a bed, and the base's old crowding (a different rule).
  const h = hub(st);
  const res = residents(st, h.id).length;
  for (let i = 0; i < baseBeds(h) - res + 2; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  const rough = residents(st, h.id).filter((s) => lines(st, s).some((l) => /rough/i.test(l.label)));
  check(rough.length === residents(st, h.id).length - baseBeds(h), `at the hub, ${residents(st, h.id).length} people for ${baseBeds(h)} beds: ${rough.length} rough lines, one each`);
}

// ---------- 3b. worse in winter or rain (the user's pick) ----------
section("Sleeping rough: worse wet (×2), worse freezing (×3), a chest cold now and then on a freezing night");
{
  const st = world(seed + 8);
  const camp = campWith(st, 3);
  const h0 = st.hour;
  let wet = null, cold = null, mild = null;
  for (let d = 0; d < 112 * 2 && !(wet && cold && mild); d++) {
    st.hour = h0 + d * 24;
    const n = BD.roughNight(st, camp);
    if (n.cold && !cold) cold = { d, v: n.v };
    else if (n.wet && !n.cold && !wet) wet = { d, v: n.v };
    else if (!n.wet && !n.cold && !mild) mild = { d, v: n.v };
  }
  check(mild && mild.v === -1 && wet && wet.v === -2 && cold && cold.v === -3, `a dry night −1 (day ${mild && mild.d}), a wet one −2 (day ${wet && wet.d}), a freezing one −3 (day ${cold && cold.d})`);
  // A freezing night: a chest cold now and then (ROUGH_WEATHER.coldIll), never on a mild one, never in a bed.
  let nights = 0, colds = 0, mildColds = 0;
  for (let d = 0; d < 112 * 3; d++) {
    st.hour = h0 + d * 24;
    const n = BD.roughNight(st, camp);
    for (const s of atBase(st, camp.id)) s.conditions = [];
    const got = BD.roughColdDaily(st, camp);
    if (n.cold) { nights += atBase(st, camp.id).length; colds += got.length; } else mildColds += got.length;
  }
  check(nights > 0 && colds > 0 && colds / nights < 0.1 && !mildColds, `${colds} chest colds in ${nights} freezing nights sleeping rough (${Math.round((100 * colds) / Math.max(1, nights))}%, the rule ${ROUGH_WEATHER.coldIll * 100}%), none on mild nights`);
  camp.armory.push(newItem("tent4"));
  T.pitchArmoryBags(st, camp);
  let inBed = 0;
  for (let d = 0; d < 112 * 3; d++) { st.hour = h0 + d * 24; inBed += BD.roughColdDaily(st, camp).length; }
  check(!inBed && baseBeds(camp) >= atBase(st, camp.id).length, "with a tent for everyone: no cold caught sleeping rough");
  st.hour = h0;
}

// ---------- 4. a pitched bag on the map, beds once ----------
section("A tent bag pitched: a map piece, beds once, struck back into its bag");
{
  const st = world(seed + 2);
  const camp = campWith(st, 2, ["tent2"]);
  const ts = T.tentsOf(camp);
  check(ts.length === 1 && ts[0].type === "tent2" && ts[0].item && ts[0].item.key === "tent2" && camp.tents === undefined, "set up with a bag: one two-person tent, a building record carrying its bag (no base.tents list)");
  check(baseBeds(camp) === 2 && tentBeds(camp) === 2 && BD.bedSlots(camp).length === 2, `its beds counted once: baseBeds ${baseBeds(camp)}, bed slots ${BD.bedSlots(camp).length}`);
  const e = BM.layoutOf(st, camp).find((q) => q.it.key === `b:${ts[0].id}`);
  check(e && e.at && e.it.w === 2 && e.it.h === 2, `on the base map, placed by the game (${e && e.at})`);
  BM.openBaseMap(st, camp.id);
  let b = st.combat;
  check(b.cells.filter((c) => c.k === "tent").length === 4, "drawn: four tent cells on the base map view");
  // Pitch one from the Build list where it is clicked.
  camp.armory.push(newItem("tent1"));
  const menu = BM.buildMenu(st, camp).filter((m) => m.group === "Tents");
  check(menu.some((m) => m.type === "tent") && menu.some((m) => m.type === "bag:tent1" && m.ok && m.have === 1) && menu.some((m) => m.type === "bag:tent4" && !m.ok), `the Build list's Tents: ${menu.map((m) => `${m.name}${m.ok ? "" : " (none)"}`).join(", ")}`);
  check(!BM.layoutAct(st, b, { type: "pickType", bt: "bag:tent1" }), "a bag picked: its outline follows the mouse");
  const F = b.deployPlan.fort, C = BM.yardHalf(camp);
  let spot = null;
  for (let y = -C + 1; y < C - 2 && !spot; y++) for (let x = -C + 1; x < C - 1 && !spot; x++) { const g = BM.ghostAt(st, b, x + F.ox, y + F.oy); if (g && g.ok) spot = [x + F.ox, y + F.oy, g.at]; }
  check(!!spot && !BM.layoutAct(st, b, { type: "build", x: spot[0], y: spot[1] }), `clicked where it fits: pitched (${spot && spot[2]})`);
  const t1 = T.tentsOf(camp).find((t) => t.type === "tent1");
  check(t1 && String(t1.rec.at) === String(spot && spot[2]) && !camp.armory.some(T.isTentBag) && baseBeds(camp) === 3, `there, by hand: the bag out of the stores, ${baseBeds(camp)} beds`);
  // Strike: the base map's Strike (demolish on the record) gives the bag back.
  b = st.combat;
  check(!BM.layoutAct(st, b, { type: "demolish", key: `b:${t1.id}` }) && camp.armory.filter((it) => it.key === "tent1").length === 1 && baseBeds(camp) === 2, "struck from the map: the same bag back in the stores, its bed gone");
  st.combat = null;
}

// ---------- 5. bed moods ----------
section("Bed moods: tents and furniture in one best-first list, one line a sleeper");
{
  const st = world(seed + 3);
  const h = hub(st);
  const add = (type, extra = {}) => { const r = { id: newId(), type, ...extra }; h.buildings.push(r); return r; };
  // Clear the hub's other beds out of the way: its own 4 are plain beds (mood 0).
  add("tent", { tent: "makeshift" }); add("tent", { tent: "tent2" }); add("cot"); add("bigbed"); add("bunkbed");
  const slots = BD.bedSlots(h);
  const moods = slots.map((s) => s.mood);
  check(moods.every((m, i) => !i || moods[i - 1] >= m), `best first: ${slots.map((s) => `${s.kind} ${s.mood}`).join(", ")}`);
  const kindMood = (k) => slots.find((s) => s.kind === k).mood;
  check(kindMood("tent:makeshift") === -1 && kindMood("tent:tent2") === 0 && kindMood("cot") === BED_SPEC.cot.mood && kindMood("bunkbed") === -0.5 && kindMood("bigbed") === 1 && kindMood("plain") === 0 && BED_SPEC.cot.mood === -1, "makeshift −1, tent 0, cot −1, bunk −0.5, large bed +1, plain 0");
  check(slots.length === baseBeds(h), `every bed once: ${slots.length} slots = ${baseBeds(h)} beds`);
  // Fill every bed: each sleeper one bed line at most (none for a mood-0 bed), the worst beds last.
  const want = baseBeds(h);
  while (residents(st, h.id).length < want) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  const per = residents(st, h.id).map((s) => bedLines(st, s));
  check(per.every((l) => l.length <= 1) && per.filter((l) => l.length && l[0].v === 1).length === 2 && per.filter((l) => l.length && /makeshift/.test(l[0].label)).length === 1, `one line a sleeper: ${per.filter((l) => l.length).map((l) => `${l[0].label} ${l[0].v}`).join("; ")}`);
  check(crowdInfo(st, h).makeshift === undefined, "the crowding rule no longer spreads the makeshift tent over the base");
}

// ---------- 6. storage counted once ----------
section("Storage: counted once");
{
  const st = world(seed + 4);
  const camp = campWith(st, 2, ["tent4"]);
  const cs = storageOf(st, camp).containers;
  const tent = T.tentsOf(camp)[0];
  const tc = cs.filter((c) => c.kind === "tent" || c.key === `b:${tent.id}` || /^t:/.test(c.key));
  check(tc.length === 1 && tc[0].key === `b:${tent.id}` && tc[0].kind === "tent" && tc[0].cap === 4 * TENT_S, `one container for the tent: ${tc.map((c) => `${c.key} ${c.kind} ${c.cap} kg`).join(", ")}`);
  const rooms = storeSpaces(camp).filter((r) => r.key === "tents");
  check(rooms.length === 1 && rooms[0].cap === 4 * TENT_S && rooms[0].kind === "dry", `one dry food room: ${rooms.map((r) => `${r.name} ${r.cap}`).join(", ")}`);
  // The Storage tab (the user's pick): a tent is a container of its own, food or gear kept in it by hand.
  const row = containersOf(st, camp).find((c) => c.key === `b:${tent.id}`);
  check(row && row.assignable && row.foodOk && row.kind === "tent" && row.bid === tent.id, `listed in the Storage tab: ${row && row.label}, assignable, food allowed`);
  camp.stock.scrap = 40;
  const msg = putSupply(st, camp, "scrap", 20, `b:${tent.id}`);
  const held = storageOf(st, camp).containers.find((c) => c.key === `b:${tent.id}`);
  check(held && held.sup.scrap === 20, `20 scrap kept in it (${msg || "ok"}; it holds ${held && JSON.stringify(held.sup)})`);
  const it = newItem("pistol"); camp.armory.push(it);
  putItem(st, camp, it, `b:${tent.id}`);
  check(it.store === `b:${tent.id}` && storageOf(st, camp).containers.find((c) => c.key === `b:${tent.id}`).gear.length === 1, "and a pistol kept in it");
  const cap0 = storageOf(st, camp).cap;
  T.strikeTentAtBase(st, camp, tent.id);
  normalizeBins(st, camp);
  check(!(camp.bins && camp.bins[`b:${tent.id}`]) && it.store == null, "struck: what was kept in it is put away nowhere again");
  check(cap0 - storageOf(st, camp).cap === 4 * TENT_S && !storeSpaces(camp).some((r) => r.key === "tents"), "struck: exactly its room gone");
}

// ---------- 7. the governor ----------
section("The governor: spare bags, then Makeshift tents, then furniture");
{
  const st = world(seed + 5);
  const camp = campWith(st, 3);
  camp.armory.push(newItem("tent1"));
  camp.stock.wood = 1000; camp.stock.scrap = 100;
  const out = BD.governBeds(st, camp);
  check(T.tentsOf(camp).length === 1 && baseBeds(camp) === 1 && out.some((l) => /pitched from the stores/.test(l)), `a spare bag pitched first (${out.join(" ")})`);
  check(!craftQueue(camp).some((j) => BED_SPEC[j.recipe]), "no furniture crafted while the camp can still put up Makeshift tents");
  // A tier-1 base short of beds with no bag: the furniture (bunk bed or cot) when there is a building with room.
  const h = hub(st);
  const n0 = h.armory.filter(T.isTentBag).length;
  h.armory.push(newItem("tent2"));
  while (residents(st, h.id).length <= baseBeds(h)) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  const short = residents(st, h.id).length - baseBeds(h);
  BD.governBeds(st, h);
  check(h.armory.filter(T.isTentBag).length === n0 && T.tentsOf(h).length === 1, `the hub ${short} short: its bag pitched before anything is crafted`);
}

// ---------- 8. hardcore: the bags go up at the first home ----------
section("Hardcore: the start's bags pitched at the first home");
{
  const st = createWorld({ seed: 202, factionCount: 7, mode: "hardcore" });
  st.noWanderers = true;
  const p = roadTeam(st);
  const n = partyMembers(st, p).length;
  const bags = T.teamTentBags(st, p).length;
  p.pitched = true; giveOrder(st, p, "establish");
  const camp = st.bases.find((x) => x.camp);
  check(!!camp && bags === n && T.tentsOf(camp).length === n && baseBeds(camp) === n && !camp.armory.some(T.isTentBag), `${n} survivors, ${bags} bags: ${T.tentsOf(camp).length} one-person tents up, ${camp && baseBeds(camp)} beds`);
  check(BM.layoutOf(st, camp).filter((e) => e.it.type === "tent").every((e) => e.at), "each placed on the camp's map by the auto layout");
  check(atBase(st, camp.id).every((s) => !lines(st, s).some((l) => /rough/i.test(l.label))), "nobody sleeps rough: the start does not stall");
}

// ---------- 9. softcover: wear on a b:<id> tent ----------
section("Soft cover: a pitched tent's wear persists on its record");
{
  const st = world(seed + 6);
  const camp = campWith(st, 3, ["tent2", "tent1"]);
  for (const s of atBase(st, camp.id)) { s.health = 100; s.gear.weapon = newItem("pistol"); }
  const raid = () => {
    globalThis.window = {};
    try { st.combat = createBattle(st, { tile: camp.tile, baseId: camp.id, enemy: { kind: "raiders", count: 3, power: 3, name: "raiders" }, ambush: null, canRetreat: true, handler: "soft", layout: "baseDefence", deploy: true, context: { night: false, ready: { manned: true } } }); }
    finally { delete globalThis.window; }
    return st.combat;
  };
  let b = raid();
  const tagged = b.cells.filter((c) => c.tent);
  const keys = [...new Set(tagged.map((c) => c.tent))];
  check(keys.length === 2 && keys.every((k) => /^b:\d+$/.test(k)) && tagged.length === 6, `the raid's tents tagged by their records (${keys.join(", ")}, ${tagged.length} cells)`);
  const two = T.tentsOf(camp).find((t) => t.type === "tent2");
  for (const c of b.cells.filter((c) => c.tent === `b:${two.id}`).slice(0, 2)) SOFT.tearTent(b, c);
  b.phase = "player";
  finishCombat(st, b.setup, { outcome: "win", enemiesKilled: 0, worn: true });
  check(two.rec.tentHp === 50 && !(camp.plan && camp.plan.tentHp), `kept on the record: ${two.rec.tentHp}% (no plan.tentHp)`);
  // An old save's plan.tentHp (softcover's t:<i> tents) is dropped; the record's wear survives a save.
  camp.plan = camp.plan || { plots: [] };
  camp.plan.tentHp = { 0: 20 };
  const st2 = loadFromString(saveToString(st));
  const c2 = st2.bases.find((x) => x.id === camp.id);
  check(c2.buildings.find((x) => x.id === two.id).tentHp === 50 && !c2.plan.tentHp, "save and load: the record's wear kept, the old plan.tentHp dropped");
  st.combat = null;
  b = raid();
  const half = b.cells.filter((c) => c.tent === `b:${two.id}`);
  check(half.every((c) => c.hp === Math.round(SOFT.TENT_FIGHT.HP * 0.5)), `the next fight starts from it (${half.map((c) => c.hp).join(", ")})`);
  st.combat = null;
  SOFT.mendTents(st);
  check(two.rec.tentHp === 50 + SOFT.TENT_FIGHT.MEND, `mended a day: ${two.rec.tentHp}%`);
}

// ---------- 10. an old save's base.tents ----------
section("Old saves: tentkit's base.tents list becomes map pieces");
{
  const st = world(seed + 7);
  const camp = campWith(st, 2);
  camp.tents = [{ id: 1, type: "tent2", item: newItem("tent2"), day: 1 }, { id: 2, type: "makeshift", item: null, day: 1 }];
  camp.tentSeq = 2;
  const st2 = loadFromString(saveToString(st));
  const c2 = st2.bases.find((x) => x.id === camp.id);
  const ts = T.tentsOf(c2);
  check(c2.tents === undefined && c2.tentSeq === undefined && ts.length === 2 && ts.some((t) => t.type === "tent2" && t.item && t.item.key === "tent2") && ts.some((t) => t.type === "makeshift") && baseBeds(c2) === 3, `migrated: ${ts.map((t) => t.type).join(", ")}, ${baseBeds(c2)} beds`);
}

// ---------- 11. AI camps ----------
section("AI camps: their real tents on the battle map, else four makeshift");
{
  const f = { wares: [newItem("tent4"), newItem("tent1"), newItem("tent2")] };
  check(T.groupCampTents(f, 5).join() === "tent4,tent2", `bags biggest first for 5 people: ${T.groupCampTents(f, 5).join(", ")}`);
  check(T.groupCampTents({ wares: [] }, 5).join() === Array(BM.AI_CAMP_TENTS).fill("makeshift").join(), `no bags: ${BM.AI_CAMP_TENTS} makeshift tents`);
}


// ---------- round 2 (woodwork + gunmags2 merged): the bugs ----------
// (2: the Kitchen and the pen queued in time is kitchentest's "a hub of 8+ queues a kitchen" and progpickstest's pen.)
section("Round 2: the ring wall is built once");
{
  const st = world(seed + 20);
  const h = hub(st);
  for (const k of ["scrap", "wood", "buildmat", "parts"]) h.stock[k] = 50000;
  const msg = queueBuild(st, h, "walls");
  const job = h.construction.find((c) => c.type === "walls");
  const R0 = BM.ringHalf(h);
  for (let i = 0; i < 6; i++) h.construction.push({ id: 990000 + i, type: "gen_hut", progress: 0, hours: 14, cost: {}, paid: {} }); // the yard would grow meanwhile
  check(!!job && job.kind === "ring" && BM.ringHalf(h) === R0 && BM.yardHalf(h) === R0 && BM.yardHalf(h, true) > R0, `the ring pegged when queued (${msg.slice(0, 40)}…): the yard held at it (${BM.yardHalf(h)}; wanted ${BM.yardHalf(h, true)})`);
  job.paid = { ...job.cost }; job.progress = job.hours - 0.01;
  for (let i = 0; i < 3 && h.construction.includes(job); i++) constructionHour(st);
  const wi = BM.wallInfo(st, h);
  check(!h.construction.includes(job) && wi.enclosed && BM.ringPlan(st, h).pieces.length === 0 && canBuild(st, h, "walls").kind === "upgrade", `laid: the ring closes (${h.buildings.filter((b) => /^(wall|gate)/.test(b.type)).length} pieces), nothing left to ring again`);
}

section("Round 2: a crowded forest camp's huts stay where they went up");
{
  let moved = 0, overlap = 0;
  for (const sd of [43, 47]) {
    const st = createWorld({ seed: sd, factionCount: 6 }); st.started = true;
    const tile = Object.keys(st.tiles).map(Number).filter((t) => st.tiles[t].terrain === "forest" && !st.tiles[t].bridge && !st.bases.some((b) => b.tile === t)).sort((a, b) => a - b)[sd % 5];
    const c = { id: 9000 + st.bases.length, tile, type: "outpost", name: "Test Camp", stock: { water: 50, wood: 0, scrap: 0 }, buildings: [], construction: [], armory: [], tier: 0, camp: true, fire: false };
    st.bases.push(c);
    for (let i = 0; i < 2; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: c.id }; s.role = "build"; st.survivors.push(s); }
    BM.landFor(st, c);
    for (let i = 0; i < 6; i++) c.construction.push({ id: 81000 + i, type: "tent", progress: 0, hours: 3 });
    for (let i = 0; i < 4; i++) c.construction.push({ id: 81020 + i, type: "gen_hut", progress: 0, hours: 14 });
    const where = new Map();
    for (let hr = 0; hr < 900 && c.construction.length; hr++) {
      const before = c.buildings.length;
      constructionHour(st);
      const lay = BM.layoutOf(st, c);
      for (const b of c.buildings.slice(before)) { const e = lay.find((q) => q.it.key === `b:${b.id}`); if (e && e.at) where.set(b.id, String(e.at)); }
      for (const [id, at] of where) { const e = lay.find((q) => q.it.key === `b:${id}`); if (e && String(e.at) !== at) { moved++; where.set(id, String(e.at)); } }
      const huts = lay.filter((e) => e.at && e.it.type === "gen_hut");
      for (let i = 0; i < huts.length; i++) for (let j = i + 1; j < huts.length; j++) { const a = BM.rectOf(huts[i].it, huts[i].at), b = BM.rectOf(huts[j].it, huts[j].at); if (a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h) overlap++; }
    }
  }
  check(!moved && !overlap, `two forest camps, four huts each: no built hut moved (${moved}), none on another's site (${overlap})`);
}

section("Round 2: a large bed and a cabin's floor agree");
{
  const st = world(seed + 21);
  const h = hub(st);
  BM.clearAllLand(st, h);
  const cab = addBuilding(h, "gen_cabin");
  let placed = false;
  for (const [x, y] of [[-20, 8], [-20, -12], [14, 14], [0, -20]]) if (BM.placeItem(st, h, `b:${cab.id}`, x, y, 0) === "") { placed = true; break; }
  check(placed && BM.fittingRoom(st, h, "bed") === `b:${cab.id}` && !BM.fittingRoom(st, h, "bigbed"), "a cabin takes a bed but not a large bed (its 3 × 2 floor keeps the middle clear between its doors)");
  check(!/cabin, lodge/.test(GEAR.bigbed.desc) && /cabin's floor has no room/.test(GEAR.bigbed.desc) && /lodge, hall or barn/.test(BD.furnitureProblem(h, "bigbed")), `the text says so: "${BD.furnitureProblem(h, "bigbed")}"`);
}

section("Round 2: trip dice for one who joined from an AI group are the same in every world");
{
  const a = world(42), b = world(42);
  const s = { id: 1e9 + 979 };
  const t = { leave: 24 * 30 + 8, n: 2, job: "hunt" };
  check(a.idBase !== b.idBase && TE.diceFor(a, s, t).next() === TE.diceFor(b, s, t).next(), `worlds from ids ${a.idBase} and ${b.idBase}: the same roll`);
  const y = { id: a.idBase + 5 }, z = { id: b.idBase + 5 };
  check(TE.diceFor(a, y, t).next() === TE.diceFor(b, z, t).next(), "one of yours (a world-local id) the same too");
}

section("Round 2: a light handed out is in one place");
{
  const st = world(seed + 22);
  const h = hub(st);
  const s = atBase(st, h.id)[0];
  s.gear.tool = newItem("crowbar"); // the off hand full: a flashlight cannot go there
  s.gear.rig = newItem("chestrig");
  for (let i = 0; i < (s.pockets || []).length; i++) s.pockets[i] = newItem("tourniquet");
  const lamp = newItem("headlamp");
  h.armory.push(lamp);
  packLights(h, [s]);
  const onHer = [...allItems(s), ...(rigPouches(s) || [])].includes(lamp), inArmory = h.armory.includes(lamp); // a rig's pouches hold their own (inventory.js)
  check(onHer !== inArmory, `the headlamp is on ${s.name.split(" ")[0]} (${onHer}) or in the armory (${inArmory}), never both`);
  check(!onHer || hasLight(s), "on them, it is their light (a headlamp works from a rig's pouch)");
}



// ---------- the user's picks of 2026-10-20, after round 2 ----------
section("Picks: wood in the tents, beds and furniture; wood in the step ups; the woodpile apart");
{
  const want = { tent: { wood: 80, scrap: 1 }, bunks: { scrap: 2, wood: 200 }, shelves: { scrap: 2, wood: 150 }, lockers: { scrap: 5, wood: 40 }, crates: { scrap: 1, wood: 120 }, storebox: { scrap: 1, wood: 80 } };
  check(Object.entries(want).every(([k, c]) => JSON.stringify(BUILDINGS[k].cost) === JSON.stringify(c)), `fittings and the Makeshift tent: ${Object.keys(want).map((k) => `${k} ${JSON.stringify(BUILDINGS[k].cost)}`).join(", ")}`);
  const beds = { cot: { wood: 60, scrap: 2 }, bed: { wood: 150, scrap: 2 }, bunkbed: { wood: 250, scrap: 3 }, bigbed: { wood: 300, scrap: 3, parts: 1 } };
  check(Object.entries(beds).every(([k, c]) => JSON.stringify(CRAFTS[k].in) === JSON.stringify(c)), "the beds' recipes: cot 60 wood + 2 scrap, bed 150 + 2, bunk bed 250 + 3, large bed 300 + 3 + a part");
  check(BUILDINGS.camp_up.cost.wood === 200 && BUILDINGS.outpost_up.cost.wood === 200 && BUILDINGS.hub_up.cost.wood === 800, "the step ups: camp to shelter 200 wood, the outpost 200, shelter to base 800 (with their scrap and building materials)");
  // The step up keeps the fire's days back while it gathers.
  const st = world(seed + 30);
  const camp = campWith(st, 2);
  camp.fire = true;
  let job = camp.construction.find((c) => BUILDINGS[c.type] && BUILDINGS[c.type].tierUp);
  if (!job) { job = tierUpJobFor(camp); camp.construction.push(job); }
  const keep = woodNeed(st, camp).dailyKeep;
  camp.stock.wood = keep + 50;
  constructionHour(st);
  const r = job ? gatherRows(job).find((x) => x.key === "wood") : null;
  check(!!r && Math.floor(camp.stock.wood) >= keep && r.have <= 50, `the step up takes the wood above the fire's days (${keep} kept, ${r && r.have} taken)`);
  // The woodpile.
  const h = hub(st);
  h.stock.wood = 5000;
  const s = storageOf(st, h);
  check(!s.containers.some((c) => c.sup.wood) && !s.outside.sup.wood && woodpileOf(h) === 5000, "5,000 wood: in no container, not lying outside, the woodpile");
  check(storageSummary(st, h).includes("Woodpile: 5000 wood"), "the Storage tab's line: Woodpile: 5000 wood");
  const out = BM.outsideOf(st, h);
  check(out && out.sup.wood === 5000, "a raid's map lays it with the piles: stealable");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
