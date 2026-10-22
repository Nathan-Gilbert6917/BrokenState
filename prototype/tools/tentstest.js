// Tents (src/sim/tents.js, src/sim/data-tents.js): tent bags as items, a quicker camp, beds and storage under cover,
// struck back into bags, the hardcore start's bags, and the AI bands using them.
// - The bags: tent1, tent2, tent4 with 1 / 2 / 4 sleepers and S / 2S / 4S kg of storage (the makeshift tent 0), weights
//   and values rising with size, art for each, theme tags.
// - Carrying: into the In arms slot (the four-person duffle in both arms), never a pack; a cart's bed; a vehicle's trunk
//   (the team's cargo with a car).
// - Loot: the hour-by-hour search at a campground, a raid's campsite crates, an AI raid on a POI; the four-person tent
//   the rarest.
// - Set up camp: an hour without bags, half an hour when they sleep everyone, between for some; the camp's tents
//   pitched from what the team brought, their sleepers beds under cover, their storage room out of the weather (kg and
//   days of food), whoever has no tent bed sleeps rough (a mild mood cost), bags in the armory go up when needed.
// - Strike camp packs the tents back into bags with the team; a camp gone with its tents pitched leaves the bags in its
//   cache.
// - The seam: pitchTentAtBase / strikeTentAtBase on any base.
// - Night on the road: the bags go up (the card's line), rough sleepers lose a little mood.
// - Hardcore: one one-person tent bag a starting survivor.
// - Nomads: a band sets out with its tier's bags, pitches them at camp (nobody rough), its fresh food keeps better, it
//   walks the time it saves; drifters build makeshift shelters; raiders carry bags too; a group counts its bags as
//   quarters at its camps.
// Usage: node tools/tentstest.js [seed]   ("passed" / "failed" lines; exits 1 on a failure)
import { createWorld, hub, atBase, tickHour } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem, moveItem, isCarryable, isTwoHands, fitReason } from "../src/sim/inventory.js";
import { launchExpedition, partyTile, partyMembers } from "../src/sim/parties.js";
import { CAMP, baseBeds } from "../src/sim/buildings.js";
import { pitchArrive, strikeCamp, removeCamp, campsHour, campPitchHours, siteSetup } from "../src/sim/staging.js";
import { storageOf } from "../src/sim/basestorage.js";
import { storeSpaces } from "../src/sim/storage.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { makeCamp as nightCamp } from "../src/sim/nightmarch.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import * as N from "../src/sim/nomads.js";
import * as T from "../src/sim/tents.js";
import { bedLine, roughNight } from "../src/sim/beds.js"; // sleeping rough: the one rule (the pt-int merge)
import { TENT_TYPES, TENT_S, TENTS, TENT_FINDS, AREA_TENTS, TENT_TAGS, BAND_TENTS } from "../src/sim/data-tents.js";
import { ITEM_TAGS, SITE_TAGS, AREA_TAGS, fitsTags } from "../src/sim/loot.js";
import { hasItemArt } from "../src/ui/itemart.js";
import { giveFood } from "../src/sim/foods.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "passed" : "failed"} ${what}`); return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function world(s = seed, extra = {}) {
  const st = createWorld({ seed: s, factionCount: 4, ...extra });
  st.started = true; st.visitorsOff = true; st.noWanderers = true; st.nomadsOff = true;
  st.hordes.length = 0;
  return st;
}
// A land tile `d` from the hub where a camp can go (no base, no site of a group, not water).
function campTile(st, d = 3) {
  const h = hub(st);
  return st.tiles.find((t) => t.terrain !== "water" && !t.hive && st.grid.distance(t.id, h.tile) === d && !st.bases.some((b) => b.tile === t.id) && (t.owner == null || t.owner === "player") && !st.factions.some((f) => f.bases.includes(t.id))).id;
}
// A team of n waiting on a camp tile, its bags in the cargo (vehicle: a car with it).
function teamOut(st, n = 3, { vehicle = false } = {}) {
  const h = hub(st);
  Object.assign(h.stock, { water: 300, ammo: 300, meds: 20 });
  const crew = atBase(st, h.id).slice(0, n);
  for (const s of crew) { s.health = 100; s.mood = 60; if (s.gear) s.gear.carry = null; }
  let vehicleId = null;
  if (vehicle) { const v = createVehicle(st, "truck", { kind: "base", baseId: h.id }); st.vehicles.push(v); v.fuel = 30; vehicleId = v.id; }
  const dest = campTile(st);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId, supplies: { food: 4, water: 4 } });
  const p = res.party;
  if (!p) throw new Error(`no team: ${res.error || JSON.stringify(res)}`);
  p.path = [dest]; p.idx = 0; p.phase = "waiting"; p.dest = dest;
  return { p, crew, dest };
}

// ---------- 1. the bags ----------
console.log("The bags: sleepers, storage, weights, art");
{
  check(["tent1", "tent2", "tent4"].every((k) => GEAR[k] && GEAR[k].tent === k && TENT_TYPES[k].bag), "three tent bags exist, each pitching the tent type of its own key");
  check(TENT_TYPES.tent1.sleepers === 1 && TENT_TYPES.tent2.sleepers === 2 && TENT_TYPES.tent4.sleepers === 4 && TENT_TYPES.makeshift.sleepers === 1, "sleepers: one-person 1, two-person 2, four-person 4, makeshift 1");
  check(TENT_TYPES.makeshift.storeKg === 0 && TENT_TYPES.tent1.storeKg === TENT_S && TENT_TYPES.tent2.storeKg === 2 * TENT_S && TENT_TYPES.tent4.storeKg === 4 * TENT_S, `storage 0 / S / 2S / 4S (S = ${TENT_S} kg)`);
  check(TENT_TYPES.tent1.w * TENT_TYPES.tent1.h === 2 && TENT_TYPES.tent2.w === 2 && TENT_TYPES.tent2.h === 2 && TENT_TYPES.tent4.w === 3 && TENT_TYPES.tent4.h === 3 && TENT_TYPES.makeshift.w * TENT_TYPES.makeshift.h === 2, "footprints 1x2, 2x2, 3x3 (makeshift 1x2)");
  check(!TENT_TYPES.makeshift.bag && TENT_TYPES.makeshift.buildable && !GEAR.makeshift, "the makeshift tent has no bag (built, never found)");
  check(GEAR.tent1.weight < GEAR.tent2.weight && GEAR.tent2.weight < GEAR.tent4.weight && GEAR.tent1.value < GEAR.tent2.value && GEAR.tent2.value < GEAR.tent4.value, `weights and values rise with size (${GEAR.tent1.weight} / ${GEAR.tent2.weight} / ${GEAR.tent4.weight} kg)`);
  check(["tent1", "tent2", "tent4"].every((k) => hasItemArt(k)), "each bag has its inventory drawing");
  check(["tent1", "tent2", "tent4"].every((k) => ITEM_TAGS[k] && ITEM_TAGS[k] === TENT_TAGS[k]), "each bag has theme tags (loot.js ITEM_TAGS)");
  const misfit = [...Object.entries(TENT_FINDS).flatMap(([t, f]) => Object.keys(f.items).filter((k) => !fitsTags(k, SITE_TAGS[t] || [])).map((k) => `${k}@${t}`)), ...Object.entries(AREA_TENTS).flatMap(([a, f]) => Object.keys(f.items).filter((k) => !fitsTags(k, AREA_TAGS[a] || [])).map((k) => `${k}@${a}`))];
  check(!misfit.length, `every place a bag turns up fits its theme${misfit.length ? ` (${misfit.join(", ")})` : ""}`);
  const rarest = (f) => f.items.tent4 == null || (f.items.tent4 < f.items.tent1 && f.items.tent4 < f.items.tent2); // a place with no four-person tent at all (a garden centre's two-person ones: the shops, 2026-10-21) keeps it rarest too
  check(Object.values(TENT_FINDS).every(rarest) && Object.values(AREA_TENTS).every(rarest), "the four-person tent is the rarest everywhere");
}

// ---------- 2. carrying ----------
console.log("Carrying: the In arms slot, a cart, a vehicle's trunk");
{
  const st = world();
  const { p, crew } = teamOut(st, 2);
  const [a, b] = crew;
  const t1 = newItem("tent1"), t4 = newItem("tent4");
  check(isCarryable(t1) && isCarryable(t4) && fitReason(t1, "carry") === "" && /too big for a pack/.test(fitReason(t1, "pack")) && /too big for a pocket/.test(fitReason(t1, "pocket")), "a bag goes in the arms, never a pack or a pocket");
  check(!isTwoHands(t1) && isTwoHands(t4), "the four-person duffle takes both arms, the others one");
  p.cargo.gear.push(t1);
  const m = moveItem(st, `cargo:${p.id}:list:${p.cargo.gear.indexOf(t1)}`, `s:${a.id}:carry`);
  check(a.gear.carry === t1 && !p.cargo.gear.includes(t1), `from the team's cargo into ${a.name.split(" ")[0]}'s arms (${m || "ok"})`);
  b.gear.carry = newItem("handcart");
  check(fitReason(t4, "bag", b) === "", "the four-person bag fits a hand cart's bed");
  const st2 = world();
  const { p: q, crew: c2 } = teamOut(st2, 2, { vehicle: true });
  const t2 = newItem("tent2");
  c2[0].gear.carry = t2;
  const m2 = moveItem(st2, `s:${c2[0].id}:carry`, `cargo:${q.id}:list`);
  check(q.vehicleId != null && q.cargo.gear.includes(t2) && !c2[0].gear.carry, `from the arms into the vehicle's trunk (the team's cargo with a ${st2.vehicles.find((v) => v.id === q.vehicleId).name}) (${m2 || "ok"})`);
  check(T.teamTentSleepers(st2, q) === 2 && T.teamTentSleepers(st, p) === 1, "the team's bags are counted wherever they are (trunk, arms)");
}

// ---------- 3. loot ----------
console.log("Loot: searches, raid containers, AI raids");
{
  const st = world();
  const tile = st.tiles.find((t) => t.terrain !== "water");
  const got = { tent1: 0, tent2: 0, tent4: 0 };
  for (let h = 0; h < 6000; h++) { st.hour = h; const it = T.rollTentFind(st, tile.id, "campground", 1, 1, "t"); if (it) got[it.key]++; }
  const n = got.tent1 + got.tent2 + got.tent4;
  check(n > 0 && near(n / 6000, TENT_FINDS.campground.p, 0.02), `a campground's search hours turn up bags (${n} in 6000 hours: ${got.tent1} / ${got.tent2} / ${got.tent4})`);
  check(got.tent4 > 0 && got.tent4 < got.tent1 && got.tent4 < got.tent2, "the four-person tent the rarest find");
  check(!T.rollTentFind(st, tile.id, "pharmacy", 1, 1, "t") && T.rollTentFind(st, tile.id, "hospital", 1, 1, "x") === null, "nothing at a pharmacy or a hospital");
  let area = 0;
  for (let i = 0; i < 2000; i++) if (T.rollAreaTent(st, tile.id, "campsite", "campsite", `box${i}`)) area++;
  check(area > 0, `a raid's campsite crates hold bags (${area} of 2000)`);
  let ai = 0;
  for (let h = 0; h < 2000; h++) { st.hour = h; if (T.rollGroupTent(st, { id: 99 }, tile.id, 0, "campsite", 0.1, 1)) ai++; }
  check(ai > 0, `an AI raid on a campsite finds bags by the same table (${ai} of 2000)`);
  check(GEAR[T.rollTentFind(Object.assign(st, { hour: 0 }), tile.id, "hikercamp", 1, 50, "z").key].tent, "a find is a real bag item");
}

// ---------- 4. setting up camp ----------
console.log("Set up camp: the fire and the clearing whatever the bags; beds and storage from the tents");
{
  const st = world();
  const { p, crew } = teamOut(st, 3);
  const h0 = campPitchHours(st, p, partyTile(p));
  p.cargo.gear.push(newItem("tent2"));
  crew[2].gear.carry = newItem("tent1");
  check(campPitchHours(st, p, partyTile(p)) === h0, `bags for everyone: the same ${h0} hours (the camp fire and clearing its 5 × 5 are the work)`);
  check(T.pitchHours(3, 3) === TENTS.PITCH_FULL && T.pitchHours(3, 2) < CAMP.tarpHours && T.pitchHours(3, 0) === CAMP.tarpHours, "on the road the bags still pitch quicker (a band's tarps: an hour down to half an hour)");
  p.mission = "camp";
  const txt = pitchArrive(st, p, "camp");
  check(p.phase === "task" && p.task.type === "pitch" && p.task.hours === h0, `the pitching task takes ${p.task && p.task.hours} hours (${txt})`);
  p.pitched = true;
  pitchArrive(st, p, "camp");
  const base = st.bases.find((x) => x.tile === p.dest);
  check(!!base && base.camp && T.tentsOf(base).length === 2 && !base.armory.some(T.isTentBag), `the camp stands, its two tents pitched (${base && T.tentsText(T.tentsOf(base).map((t) => t.type))})`);
  check(base && baseBeds(base) === CAMP.beds + 3 && T.tentBeds(base) === 3, `the tents' sleepers are its beds under cover (${T.tentBeds(base)}, ${baseBeds(base)} with the bedrolls)`);
  const S = T.campSleep(st, base);
  check(S.covered === 3 && !S.rough.length, "all three sleep under cover");
  const tc = storageOf(st, base).containers.filter((c) => c.kind === "tent");
  check(tc.length === 2 && near(tc.reduce((a, c) => a + c.cap, 0), 3 * TENT_S), `storage out of the weather: ${tc.map((c) => `${c.name} ${c.cap} kg`).join(", ")}`);
  const room = storeSpaces(base).find((r) => r.key === "tents");
  check(room && room.kind === "dry" && near(room.cap, 3 * TENT_S), "the food in them keeps as in a pantry (a dry room)");
  // Someone without a tent bed sleeps rough: a mild mood cost; a bag in the armory goes up for them.
  const s4 = atBase(st, hub(st).id)[0];
  s4.location = { kind: "base", baseId: base.id }; s4.mood = 60;
  st.hour = Math.ceil(st.hour / 24) * 24;
  const others = atBase(st, base.id).filter((s) => s !== s4).map((s) => [s, s.mood]);
  T.campTentsDaily(st, base);
  const rough = T.campSleep(st, base).rough;
  // The mood of it is beds.js's one rule (bedLine, applied by relations.js each morning; the pt-int merge), not the camp's day.
  const bl = bedLine(st, s4, base), rn = roughNight(st, base);
  check(rough.length === 1 && rough[0] === s4 && s4.mood === 60 && others.every(([s, m]) => s.mood === m) && bl && bl.v === rn.v && rn.v <= -1 && rn.v >= -3, `four people, beds for three: one sleeps rough, the one rough line (${bl && bl.label}: ${bl && bl.v}), nothing taken twice`);
  base.armory.push(newItem("tent1"));
  T.campTentsDaily(st, base);
  check(T.tentsOf(base).length === 3 && !T.campSleep(st, base).rough.length, "a bag in the camp's armory goes up for whoever sleeps rough");
  base.armory.push(newItem("tent2"));
  T.campTentsDaily(st, base);
  check(base.armory.some(T.isTentBag), "a spare bag stays packed while everyone has a bed");
  // Strike camp: the tents come down into bags and go with the team.
  const before = T.tentsOf(base).length;
  const res = strikeCamp(st, base);
  const q = res.party;
  check(!!q && !st.bases.includes(base) && T.teamTentBags(st, q).length === before + 1, `struck: the team packs every bag (${q && T.tentsText(T.teamTentBags(st, q).map((it) => it.key))})`);
}
{
  // A camp gone with its tents pitched leaves them in its cache, as bags.
  const st = world();
  const { p } = teamOut(st, 2);
  p.cargo.gear.push(newItem("tent2"));
  p.mission = "camp"; p.pitched = true;
  pitchArrive(st, p, "camp");
  const base = st.bases.find((x) => x.tile === p.dest);
  for (const s of atBase(st, base.id)) s.location = { kind: "base", baseId: hub(st).id };
  removeCamp(st, base, "gone");
  const site = st.deathSites.find((d) => d.tile === base.tile);
  check(site && site.items.some((x) => x.kind === "gear" && x.key === "tent2"), "a tent left pitched stays at the camp site: in its cache as a bag");
}

// ---------- 5. the seam ----------
console.log("The seam for the base map: pitchTentAtBase / strikeTentAtBase");
{
  const st = world();
  const h = hub(st);
  const beds0 = baseBeds(h), cap0 = storageOf(st, h).cap;
  const rec = T.pitchTentAtBase(st, h, "tent4");
  const mk = T.pitchTentAtBase(st, h, "makeshift");
  check(rec && mk && baseBeds(h) === beds0 + 5 && near(storageOf(st, h).cap, cap0 + 4 * TENT_S), `a four-person and a makeshift tent at the hub: +5 beds, +${4 * TENT_S} kg (the makeshift none)`);
  const bag = T.strikeTentAtBase(st, h, rec.id), none = T.strikeTentAtBase(st, h, mk.id);
  check(bag && bag.key === "tent4" && none === null && baseBeds(h) === beds0 && T.tentsOf(h).length === 0, "struck: the four-person tent is a bag again, the makeshift one nothing");
  check(T.pitchTentAtBase(st, h, "nosuch") === null, "an unknown type is refused");
  T.pitchTentAtBase(st, h, "tent2", newItem("tent2"));
  const back = loadFromString(saveToString(st));
  const h2 = hub(back);
  check(T.tentsOf(h2).length === 1 && T.tentsOf(h2)[0].item.key === "tent2" && baseBeds(h2) === beds0 + 2, "a save and load keeps the pitched tents and their beds");
}

// ---------- 6. night on the road ----------
console.log("Night on the road: the bags go up");
{
  const st = world();
  const { p, crew } = teamOut(st, 2);
  p.cargo.gear.push(newItem("tent1"));
  const far = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, partyTile(p)) === 4);
  p.phase = "out"; p.dest = far.id; p.mission = "move"; p.path = [partyTile(p), far.id]; p.idx = 0;
  st.hour = Math.floor(st.hour / 24) * 24 + 23;
  const line = nightCamp(st, p);
  check(/A one-person tent goes up: 1 of 2 sleep under cover/.test(line), `the card's line: "${line}"`);
  for (const s of crew) s.mood = 50;
  const roughOne = crew.slice().sort((a, b) => (a.health || 0) - (b.health || 0) || a.id - b.id)[1];
  const n = T.roadTentsHour(st, p);
  check(n === 1 && roughOne.mood < 50 && crew.filter((s) => s !== roughOne).every((s) => s.mood === 50), "an hour of the night's rest: the one without a tent loses a little mood");
}

// ---------- 7. hardcore ----------
console.log("Hardcore: a one-person tent bag a starting survivor");
for (const n of [1, 3, 4]) {
  const st = createWorld({ seed: seed + n, factionCount: 4, mode: "hardcore", startPeople: n });
  const p = roadTeam(st);
  const bags = T.teamTentBags(st, p);
  check(p && bags.length === TENTS.HARDCORE * partyMembers(st, p).length && bags.every((it) => it.key === "tent1") && (!p.vehicle || bags.every((it) => p.cargo.gear.includes(it))), `${n} on the road: ${bags.length} one-person tent bag${bags.length === 1 ? "" : "s"} (X = ${TENTS.HARDCORE} each)${p && p.vehicle ? ", in the car" : ""}`);
  check(campPitchHours(st, p, partyTile(p)) === siteSetup(st, p, partyTile(p)).hours, "their first camp takes its fire and clearing, bags or none");
}

// ---------- 8. AI bands ----------
console.log("Nomads and raiders: bags carried, pitched at camp");
{
  const st = world();
  delete st.nomadsOff;
  const camp = st.tiles.find((t) => t.terrain === "plains" && !t.loc && st.grid.distance(t.id, hub(st).tile) > 8);
  const sv = N.spawnNomads(st, { tier: 2, tile: camp.id, pop: 5 });
  const pr = N.spawnNomads(st, { tier: 3, tile: camp.id, pop: 7 });
  const dr = N.spawnNomads(st, { tier: 0, tile: camp.id, pop: 3 });
  const bagsOf = (b) => T.bandTentBags(b);
  check(T.sleepersOf(bagsOf(sv)) >= 5 && T.sleepersOf(bagsOf(pr)) >= 7 && !bagsOf(dr).length, `survivalists and preppers set out with bags for everyone (${T.tentsText(bagsOf(sv).map((i) => i.key))}; ${T.tentsText(bagsOf(pr).map((i) => i.key))}), drifters with none`);
  check(N.bandRoom(st, sv) < N.bandRoom(st, Object.assign({}, sv, { wares: sv.wares.filter((it) => !T.isTentBag(it)) })), "the bags weigh on what the band can carry");
  check(sv.phase === "camp", "the band pitches camp");
  N.bandDay(st, sv);
  N.bandDay(st, dr);
  check(sv.tentCamp && sv.tentCamp.camping && sv.tentCamp.rough === 0 && sv.tentCamp.sleepers >= sv.pop, `at camp its tents sleep everyone (${sv.tentCamp && sv.tentCamp.sleepers} for ${sv.pop})`);
  check(dr.tentCamp && dr.tentCamp.rough === 0 && dr.tentCamp.bags === 0, "drifters sleep in makeshift shelters (no bag, nobody rough)");
  const lo = { kit: "looters", wares: [newItem("tent1")], stock: {} };
  T.bandTentCamp(lo, 4, true);
  check(T.bandRoughShare(lo) === 0.75, "a band with a bag for one of four: three quarters sleep rough (its recruiting slowed by that share)");
  const fresh = { kit: "survivalists", wares: [newItem("tent2")], stock: {} };
  giveFood(st, fresh.stock, 20, { f_berries: 1, f_smallgame: 1 }, { rng: st.rng });
  check(T.bandSpoilMult(fresh, true) < 1 && T.bandSpoilMult(fresh, false) === 1 && T.bandSpoilMult({ wares: [], stock: fresh.stock }, true) === 1, `its fresh food keeps better in its pitched tents (×${Math.round(T.bandSpoilMult(fresh, true) * 100) / 100} of the spoiling), not on the road`);
  check(T.bandPitchSaved(sv, sv.pop) === CAMP.tarpHours - TENTS.PITCH_FULL && T.bandPitchSaved(dr, dr.pop) === 0, "a band with bags for everyone walks the half hour its camp saves");
  check(T.bandTentKit(st, "raiders", "r1", 6).length > 0 && T.sleepersOf(T.bandTentKit(st, "raiders", "r1", 6)) >= Math.round(6 * BAND_TENTS.raiders.share), "raiders from beyond the border carry bags for some of them");
  const same = T.bandTentKit(st, "preppers", "n9", 7).map((i) => i.key).join(), again = T.bandTentKit(st, "preppers", "n9", 7).map((i) => i.key).join();
  check(same === again, "a band's bags come from its own dice (the same band, the same bags)");
  const f = { wares: [newItem("tent4"), newItem("tent1"), Object.assign(newItem("tent2"), { withParty: 3 })] };
  check(T.groupTentSleepers(f) === 5, "a group's bags on its shelf count as quarters at its camps (one out with a party does not)");
  // A few days of the world: nothing breaks with bands camping and moving.
  let err = null;
  try { for (let i = 0; i < 24 * 6; i++) tickHour(st); } catch (e) { err = e; }
  check(!err, `six days with the bands camping and moving${err ? `: ${err.stack}` : ""}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
