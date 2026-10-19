// AI groups by your rules (ai-locks 2026-10-11, the user's rule: "AI groups need to have the same restrictions and
// gameplay features"): every lock the groups now share with you, each checked both ways (a group without the manual,
// the skill or the building cannot; with it, it can), and nothing they make that you cannot:
//   the machine shop (groupworks.js "shop": the Machinist's Handbook, Mechanics 4, a workshop) and its parts (your
//   station's Mechanics 4 rule: half below it, no more above it); the radio station (Mechanics 4) and their network
//   (radio.js groupNetwork: stations only, the military's army sets, linked relay masts; old saves as before); the
//   reinforced gate (the Army Engineering Manual; on the map of an assault, fort.js assaultBase); the trauma hospital's
//   Mechanics 4; the garage (vehicle repairs: full with one, 12 of 25 with a Mechanics 4 hand, none without); the
//   reloading bench (Mechanics 3; their brass loaded only with one); their crafting (arsenal.js groupCraftable: your
//   recipes, skill, bench and manuals; no gun of their kit from scrap and a part; a nail bat takes a bat; pipe bombs at
//   Mechanics 5 and a workshop, Molotovs otherwise); the battering ram (a workshop and Mechanics 3; made once, carried again); vehicle fitting
//   (your Mechanics for each upgrade, the turret's 6; parts above the machines' earmark); field works (the relay mast's
//   Mechanics 3; firewood paid); gear repairs (guns Mechanics 3, armour of AC 4+ Mechanics 5); and every work of theirs
//   standing for a building of yours. Usage: node tools/ailockstest.js (about 2 s).
import { createWorld, RADIO_RANGE } from "../src/sim/world.js";
import { GROUP_WORKS, nextWork, worksAt, workLock, groupHas, groupGarageMult, GARAGE_LESS, partsRate, groupSkill } from "../src/sim/groupworks.js";
import { groupNetwork, MIL_RADIO_RANGE, GROUP_NET_RANGE, RELAY_RANGE } from "../src/sim/radio.js";
import { assaultForce } from "../src/sim/conquest.js";
import { assaultBase } from "../src/sim/fort.js";
import { ARSENAL, arsenalDaily, ensureArsenal, groupCraftable, packRaidKit, removeFromArsenal } from "../src/sim/arsenal.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { GEN_TIERS } from "../src/sim/power.js"; // gen-tiers: the generator's upgrades (LOCKS power2 / power3)
import { VEHICLE_TYPES, VEH_UPGRADES, TURRET_FIT, upgradesOf } from "../src/sim/vehicles.js";
import { fitUpgrade } from "../src/sim/groupworld.js";
import { repairMin, repairGear, CARE } from "../src/sim/groupcare.js";
import { groupFieldLock, groupFieldCost, FIELD, buildGroupWork } from "../src/sim/fieldworks.js";
import { groupReloadDaily } from "../src/sim/reloading.js";
import { lootItem, newItem } from "../src/sim/inventory.js";
import { itemDurMax } from "../src/sim/crafting.js";
import { ensureMembers, syncMembers } from "../src/sim/members.js";
import { weightOf } from "../src/sim/groupcare.js";
import { totalRounds } from "../src/sim/ammo.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = Date.now();
const W = (seed = 42) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; return st; };
// A group of the type at the first living group's base, its works cleared (bare), its manuals as listed.
function G(st, type, { pop = 16, knows = [], works = {} } = {}) {
  const f = st.factions.find((x) => x.alive && !x.hcMilitary && x.bases.length);
  f.type = type; f.pop = pop; f.job = null; f.vehicles = []; delete f.med;
  f.works = {}; Object.assign(worksAt(f, f.bases[0]), works);
  f.tech = { known: [...knows], held: [], study: {} };
  Object.assign(f.stock, { scrap: 300, parts: 30, food: pop * 10, fuel: 60, ammo: 400, wood: 2000, brass: 0, powder: 0, primers: 0 }); // food under the machines' 12 days
  f.partsMach = 0;
  f.jails = { [f.bases[0]]: 3 }; // a jailhouse (groupjails.js): not the next job
  // members.js: a group's skills are its people's (groupworks.js groupSkill: the best at home); its people at the
  // level its type's profile names (groupcare.js GROUP_PRIORITIES mechanic), so the gates read as they did.
  ensureMembers(st, f); syncMembers(st, f);
  const m = weightOf(f, "mechanic", 3);
  for (const p of f.people) { p.skills.mechanics = m; p.skills.crafting = m; p.health = 100; p.alive = true; p.location = { kind: "member", fid: f.id, tile: f.bases[0] }; }
  return f;
}
// A group's type changed in a test: its people's skills follow (G above).
function retype(st, f, type) { f.type = type; const m = weightOf(f, "mechanic", 3); for (const p of f.people || []) { p.skills.mechanics = m; p.skills.crafting = m; } }
const BUILT = { water: 9, farms: 9, beds: 9, walls: 7, bench: 1, store: 1, pens: 1, kitchen: 1, sickbay: 2 };

// ---------- 1. the machine shop and its parts ----------
{
  console.log("The machine shop");
  const st = W();
  let f = G(st, "traders", { knows: [], works: { ...BUILT } }); // traders: Mechanics 4
  f.tech.known = []; // nothing known
  check(workLock(st, f, "shop") === "the Machinist's Handbook" && (nextWork(st, f) || {}).type !== "shop", `no manual: no machine shop (${workLock(st, f, "shop")})`);
  f.tech.known.push("machinist");
  check(!workLock(st, f, "shop") && (nextWork(st, f) || {}).type === "shop", `the manual and Mechanics 4: the machine shop next (${JSON.stringify(nextWork(st, f))})`);
  f = G(st, "raider", { knows: ["machinist"], works: { ...BUILT } }); // raiders: Mechanics 3
  check(workLock(st, f, "shop") === "Mechanics 4" && (nextWork(st, f) || {}).type !== "shop", "raiders (Mechanics 3) with the manual: no machine shop (your Mechanics 4)");
  f = G(st, "traders", { knows: ["machinist"], works: { water: 9 } });
  check(workLock(st, f, "shop") === "a workshop", "no workshop yet: not before it");
  f = G(st, "traders", { knows: ["machinist"], works: { ...BUILT } });
  check(partsRate(st, f) === 0, "a workshop and the manual but no machine shop: no parts");
  worksAt(f, f.bases[0]).shop = 1;
  const full = partsRate(st, f);
  check(Math.abs(full - GROUP_WORKS.PARTS.rate) < 1e-9, `a machine shop, 16 people, Mechanics 4: ${full} a day`);
  retype(st, f, "military");
  check(Math.abs(partsRate(st, f) - full) < 1e-9, "the military's Mechanics 6 makes no more than a 4 (your station: a part a day whoever runs it)");
  retype(st, f, "commune");
  check(Math.abs(partsRate(st, f) - full * GROUP_WORKS.PARTS.below) < 1e-9, `a commune (Mechanics 3) in a shop taken over: half (${partsRate(st, f)})`);
}

// ---------- 2. the radio station and their network ----------
{
  console.log("Radio stations and networks");
  const st = W();
  const f = G(st, "traders", { works: { ...BUILT, shop: 1 }, knows: ["machinist"] });
  check(groupNetwork(st, f) === null, "no station: no network (nothing to hear, nothing heard)");
  check((nextWork(st, f) || {}).type === "radio", `traders (Mechanics 4), ${f.pop} people: a radio station next (${JSON.stringify(nextWork(st, f))})`);
  worksAt(f, f.bases[0]).radio = 1;
  let net = groupNetwork(st, f);
  check(net && net.nodes.length === 1 && net.nodes[0].tile === f.bases[0] && net.nodes[0].range === RADIO_RANGE, `a station: one node at your station's ${RADIO_RANGE} tiles`);
  // A relay mast within reach of the station links; one beyond it does not.
  const g = st.grid;
  const near = g.within(f.bases[0], RADIO_RANGE).find((id) => g.distance(id, f.bases[0]) === RADIO_RANGE && st.tiles[id].terrain !== "water");
  const far = g.within(f.bases[0], RADIO_RANGE + RELAY_RANGE + 6).find((id) => g.distance(id, f.bases[0]) === RADIO_RANGE + RELAY_RANGE + 4 && st.tiles[id].terrain !== "water");
  if (near != null && far != null) {
    buildGroupWork(st, f, "relay", near, true);
    buildGroupWork(st, f, "relay", far, true);
    net = groupNetwork(st, f);
    check(net.nodes.some((n) => n.tile === near && n.range === RELAY_RANGE) && !net.nodes.some((n) => n.tile === far), "a relay mast in the station's reach is on their network; one out of reach is not (your relays' link)");
  } else check(true, "(no tiles for the relay check on this map)");
  const r = G(st, "raider", { works: { ...BUILT } });
  check(workLock(st, r, "radio") === "Mechanics 4" && groupNetwork(st, r) === null, "raiders (Mechanics 3): no station, no network");
  const m = G(st, "military", { works: {} });
  net = groupNetwork(st, m);
  check(net && m.bases.every((t) => net.nodes.some((n) => n.tile === t && n.range === MIL_RADIO_RANGE)), `the military: every base a station at ${MIL_RADIO_RANGE} (army sets, as a Military encrypted radio in your armory)`);
  Object.assign(worksAt(m, m.bases[0]), BUILT, { shop: 1 });
  check((nextWork(st, m) || {}).type !== "radio", `the military builds no station (${JSON.stringify(nextWork(st, m))})`);
  const old = G(st, "raider", { works: {} });
  st.groupWorks = null; // an old save: the groups do not build
  net = groupNetwork(st, old);
  check(net && net.nodes.every((n) => n.range === GROUP_NET_RANGE.raider) && net.nodes.length >= old.bases.length, "an old save's groups broadcast by type, as before");
}

// ---------- 3. the reinforced gate ----------
{
  console.log("The reinforced gate");
  const st = W();
  const f = G(st, "fortress", { works: { ...BUILT, shop: 1, radio: 1, walls: 7 } });
  const tile = f.bases[0];
  check(!assaultForce(st, f, tile).gate, "walls 7, no gate built: no reinforced gate on the assault map (was free at walls 6+)");
  check(assaultBase(st, { enemy: { walls: 7, gate: false, count: 6 }, tile }).buildings.every((b) => b.type !== "gate"), "the fort map: no gate");
  check(workLock(st, f, "gate") === "the Army Engineering Manual" && (nextWork(st, f) || {}).type !== "gate", "no Army Engineering Manual: no gate");
  f.tech.known.push("armyeng");
  check((nextWork(st, f) || {}).type === "gate", `the manual, walls at their goal: the gate next (${JSON.stringify(nextWork(st, f))})`);
  worksAt(f, tile).gate = 1;
  check(assaultForce(st, f, tile).gate === true && assaultBase(st, { enemy: { walls: 7, gate: true, count: 6 }, tile }).buildings.some((b) => b.type === "gate"), "built: the gate on the map of an assault");
  st.groupWorks = null;
  check(assaultForce(st, f, tile).gate === true, "an old save's group with walls 6+: the gate as before");
}

// ---------- 4. the trauma hospital ----------
{
  console.log("The trauma hospital");
  const st = W();
  const S = GROUP_WORKS.SICKBAY;
  check(S[3].mech === 4 && S[3].doc === 10, "your Trauma hospital: Medicine 10 and Mechanics 4");
  const f = G(st, "raider", { pop: 40, knows: ["hospitalops", "fieldsurgery"], works: { ...BUILT, sickbay: 3 } });
  f.med = { doc: 12, docXp: 0, staff: 8, staffXp: 0 };
  f.jails = { [f.bases[0]]: 3 };
  const pick = () => { for (let i = 0; i < 6; i++) { const n = nextWork(st, f); if (!n || n.type === "sickbay") return n; worksAt(f, n.tile)[n.type] = 9; } return nextWork(st, f); };
  const a = pick();
  check(!a || a.type !== "sickbay", "raiders (Mechanics 3), a doctor of 12, the manual: no trauma hospital");
  retype(st, f, "traders");
  f.med = { doc: 12, docXp: 0, staff: 8, staffXp: 0 };
  const b = pick();
  check(b && b.type === "sickbay", "traders (Mechanics 4): the trauma hospital");
}

// ---------- 5. the garage: vehicle repairs ----------
{
  console.log("Garages and vehicle repairs");
  const st = W();
  const f = G(st, "raider", { works: { ...BUILT } });
  check(groupGarageMult(st, f) === 0, "raiders (Mechanics 3), no garage: no vehicle repairs (yours: a garage or a Mechanics 4 hand)");
  const car = Object.keys(VEHICLE_TYPES).find((k) => k !== "bike");
  f.vehicles = [{ id: "t1", type: car, name: "Test car", fuel: 5, condition: 20, owner: f.id }];
  check((nextWork(st, f) || {}).type === "garage", `a car: a garage next (${JSON.stringify(nextWork(st, f))})`);
  worksAt(f, f.bases[0]).garage = 1;
  check(groupGarageMult(st, f) === 1, "a garage: the full repair step");
  retype(st, f, "traders"); worksAt(f, f.bases[0]).garage = 0;
  check(Math.abs(groupGarageMult(st, f) - GARAGE_LESS) < 1e-9, "traders (Mechanics 4), no garage: 12 of 25");
}

// ---------- 6. the reloading bench ----------
{
  console.log("The reloading bench");
  const st = W();
  const f = G(st, "zealot", { works: { ...BUILT } });
  Object.assign(f.stock, { brass: 200, powder: 400, primers: 200 });
  check(workLock(st, f, "reload") === "Mechanics 3" && (nextWork(st, f) || {}).type !== "reload", "zealots (Mechanics 2): no reloading bench");
  retype(st, f, "raider");
  check((nextWork(st, f) || {}).type === "reload", `raiders (Mechanics 3) with brass: a reloading bench (${JSON.stringify(nextWork(st, f))})`);
  const a0 = totalRounds(f.stock); // rounds by calibre (docs/adr/0001-ai-parity.md)
  arsenalDaily(st, f);
  check(f.stock.brass === 200 && !(f.reloaded > 0), "no reloading bench: none of their brass loaded");
  worksAt(f, f.bases[0]).reload = 1;
  const n = groupReloadDaily(st, f, groupHas(st, f, "reload"));
  check(n > 0 && totalRounds(f.stock) > a0, `a reloading bench: ${n} rounds loaded`);
}

// ---------- 7. their crafting: your recipes only ----------
{
  console.log("Crafting");
  const st = W();
  const mi = G(st, "military", { works: { ...BUILT } });
  check(!groupCraftable(st, mi, "pipegun"), "the military without the Improvised Weapons Plans: no pipe shotgun");
  mi.tech.known.push("weaponplans");
  check(groupCraftable(st, mi, "pipegun") && groupCraftable(st, mi, "crossbow"), "with them (Mechanics 6, a workshop): the pipe shotgun and the scrap crossbow");
  worksAt(mi, mi.bases[0]).bench = 0;
  check(!groupCraftable(st, mi, "pipegun") && groupCraftable(st, mi, "pipespear"), "no workshop: no pipe shotgun; a pipe spear (a field recipe) still");
  worksAt(mi, mi.bases[0]).bench = 1;
  const fo = G(st, "fortress", { knows: ["weaponplans"], works: { ...BUILT } });
  check(!groupCraftable(st, fo, "pipegun") && groupCraftable(st, fo, "crossbow"), "the fortress (Mechanics 5): the crossbow, not the pipe shotgun (Mechanics 6)");
  check(!groupCraftable(st, fo, "pulleybow"), "the pulley-limb bow wants the Bowyer's Drawings (and Crafting 6)");
  check(!groupCraftable(st, fo, "springmachete") && !groupCraftable(st, fo, "rivethelmet"), "a craft book's recipes: never (they read none)");
  const ra = G(st, "raider", { works: { ...BUILT } });
  check(!groupCraftable(st, ra, "nailbat"), "a nail bat wants a bat");
  ensureArsenal(st, ra);
  ra.arsenal.items.push(lootItem("bat", "militia", [1, "bat"]));
  check(groupCraftable(st, ra, "nailbat"), "with a bat in the arsenal: a nail bat");
  check(!groupCraftable(st, ra, "pipebomb"), "raiders (Mechanics 3): no pipe bomb (your Mechanics 5)");
  ra.stock.parts = 0; ra.partsMach = 0;
  // Months of a group's crafting with no guns, no buying and no newcomers: only things you can make come out.
  const makeable = new Set(Object.values(CRAFTS).map((r) => r.gear).filter(Boolean));
  const buy = ARSENAL.BUY.every;
  ARSENAL.BUY.every = 1e9;
  for (const [type, knows] of [["military", ["weaponplans", "bowyer"]], ["raider", []], ["expansionist", []], ["fortress", ["weaponplans"]]]) {
    const f = G(st, type, { knows, works: { ...BUILT } });
    ensureArsenal(st, f);
    f.arsenal.items = []; f.arsenal.pop0 = f.pop; f.arsenal.rev = (f.arsenal.rev || 0) + 1; // arsenal.js: its cached sorting by revision
    if (type === "raider" || type === "expansionist") f.wares = Array.from({ length: 20 }, () => newItem("bottle")); // empty bottles on their shelf: your Molotov recipe wants one
    for (let d = 0; d < 120; d++) { st.hour += 24; f.careTick = (f.careTick || 0) + 1; f.stock.scrap = 300; f.stock.fuel = 60; f.stock.ammo = 400; arsenalDaily(st, f); }
    const made = f.arsenal.items.filter((it) => it && it.key !== "smokegren");
    const bad = made.filter((it) => !makeable.has(it.key));
    check(made.length > 0 && !bad.length, `${type}: ${made.length} things made in 120 days, all your recipes (${[...new Set(made.map((it) => it.key))].join(", ")})${bad.length ? `; not yours: ${bad.map((it) => it.key).join(", ")}` : ""}`);
    if (type === "raider") check(!made.some((it) => it.key === "pipebomb") && made.some((it) => it.key === "molotov"), "raiders: Molotovs, no pipe bombs");
    if (type === "military") check(made.some((it) => it.key === "pipegun" || it.key === "crossbow") && !made.some((it) => ["ar", "carbine", "huntrifle", "shotgun"].includes(it.key)), "the military: pipe shotguns or crossbows, never a rifle of their kit");
  }
  ARSENAL.BUY.every = buy;
}

// ---------- 8. the battering ram ----------
{
  console.log("Siege kit");
  const st = W();
  const z = G(st, "zealot", { works: { ...BUILT } });
  // arsenal.js packRaidKit: a raid's ladders and ram are the group's own, made by your recipe (crafting.js CRAFTS
  // .ladder / .ram) when it holds none, their scrap and parts paid once; kept and carried again after.
  const raid = (f, n = 4) => { const p = { id: 900000 + f.id * 10 + (f.raidN = (f.raidN || 0) + 1), owner: f.id }; f.people.filter((s) => s.location.partyId == null).slice(0, n).forEach((s) => { s.location = { ...s.location, partyId: p.id }; }); return p; };
  const scrap0 = z.stock.scrap;
  let kit = packRaidKit(st, z, raid(z), { ladders: 1, ram: 1, grenades: 0, kind: "pipebomb" });
  check(kit && kit.ladders === 1 && !kit.ram && z.stock.scrap === scrap0 - CRAFTS.ladder.in.scrap && z.arsenal.items.some((it) => it.key === "ladder"), `zealots (Mechanics 2): a ladder made (${scrap0} → ${z.stock.scrap} scrap) and on their books, no ram (your ram: Mechanics 3 and a workshop)`);
  const r = G(st, "raider", { works: { ...BUILT } });
  const rs0 = r.stock.scrap;
  kit = packRaidKit(st, r, raid(r), { ladders: 1, ram: 1, grenades: 0, kind: "pipebomb" });
  const ram = r.arsenal.items.find((it) => it.key === "ram");
  check(kit && kit.ram === 1 && ram && r.stock.scrap === rs0 - CRAFTS.ram.in.scrap - CRAFTS.ladder.in.scrap, `raiders with a workshop: the ram made by your recipe (${rs0} → ${r.stock.scrap} scrap)`);
  kit = packRaidKit(st, r, raid(r), { ladders: 0, ram: 1, grenades: 0, kind: "pipebomb" });
  const rams = r.arsenal.items.filter((it) => it.key === "ram");
  check(kit && kit.ram === 1 && rams.length === 2, "a second raid while the first is out: the first's ram is with it, so another is made");
  for (const it of r.arsenal.items) delete it.withParty; // both raids home
  const rs1 = r.stock.scrap;
  kit = packRaidKit(st, r, raid(r), { ladders: 1, ram: 1, grenades: 0, kind: "pipebomb" });
  check(kit && kit.ram === 1 && kit.ladders === 1 && r.stock.scrap === rs1 && r.arsenal.items.filter((it) => it.key === "ram").length === 2, "home again: the next raid carries the same ram and ladder, nothing paid again");
  worksAt(r, r.bases[0]).bench = 0;
  for (const it of r.arsenal.items.filter((x) => x.key === "ram" || x.key === "ladder")) removeFromArsenal(r, it, "test");
  kit = packRaidKit(st, r, raid(r), { ladders: 0, ram: 1, grenades: 0, kind: "pipebomb" });
  check(!kit, "no workshop and no ram of their own: no ram (and nothing else: no kit)");
}

// ---------- 9. vehicle fitting ----------
{
  console.log("Vehicle fitting");
  const st = W();
  const car = Object.keys(VEHICLE_TYPES).find((k) => k !== "bike");
  const fit = (f, tries = 400) => { for (let i = 0; i < tries; i++) { f.careTick = (f.careTick || 0) + 1; const r = fitUpgrade(st, f); if (r) return r; } return null; };
  const fo = G(st, "fortress", { works: { ...BUILT } });
  fo.vehicles = [{ id: "c1", type: car, name: "Car", fuel: 5, condition: 80, owner: fo.id }];
  Object.assign(fo.stock, { carparts: 40, parts: 40, scrap: 400 });
  const a = fit(fo);
  check(!a || a.key !== "plating", `the fortress (Mechanics 5): no armour plate (your Mechanics ${VEH_UPGRADES.plating.mech}); ${a ? a.key : "nothing"} instead`);
  const mi = G(st, "military", { works: { ...BUILT } });
  mi.vehicles = [{ id: "c2", type: car, name: "Car", fuel: 5, condition: 80, owner: mi.id }];
  Object.assign(mi.stock, { carparts: 40, parts: 40, scrap: 400 });
  const b = fit(mi);
  check(b && (b.key === "plating" || b.key === "glass"), `the military (Mechanics 6): ${b ? b.key : "nothing"}`);
  const ra = G(st, "raider", { works: { ...BUILT } });
  ra.vehicles = [{ id: "c3", type: car, name: "Car", fuel: 5, condition: 80, owner: ra.id }];
  Object.assign(ra.stock, { carparts: 40, parts: 40, scrap: 400 });
  ensureArsenal(st, ra); ra.arsenal.items.push(newItem(TURRET_FIT.item, 1));
  const c = fit(ra);
  check(!upgradesOf(ra.vehicles[0]).turret && (!c || c.key !== "turret"), `raiders (Mechanics 3) with an LMG: no turret (your Mechanics ${TURRET_FIT.mech}); ${c ? c.key : "nothing"}`);
  // The earmark: parts kept for their machines are not spent on a fitting.
  const m2 = G(st, "military", { works: { ...BUILT } });
  m2.vehicles = [{ id: "c4", type: car, name: "Car", fuel: 5, condition: 80, owner: m2.id }];
  Object.assign(m2.stock, { carparts: 0, parts: 10, scrap: 400 }); m2.partsMach = 10; // all kept for the machines
  check(!fit(m2), "every part kept for their machines: no fitting");
}

// ---------- 10. field works ----------
{
  console.log("Field works");
  const st = W();
  const z = G(st, "zealot");
  const zr = groupFieldLock(st, z, "relay"), zt = groupFieldLock(st, z, "tower");
  const r = G(st, "raider");
  check(!!zr && !groupFieldLock(st, r, "relay") && !zt, `a relay mast: Mechanics 3 (zealots: "${zr}"; raiders may), a tower nothing`);
  const c = groupFieldCost("tower");
  check(c.wood === Math.ceil(FIELD.KINDS.tower.cost.wood * FIELD.AI.costShare) && c.wood > 0 && c.scrap > 0, `a tower costs them firewood too (${JSON.stringify(c)})`);
}

// ---------- 11. gear repairs ----------
{
  console.log("Gear repairs");
  const gun = lootItem("pistol", "militia", [3, "g"]), plate = newItem("steelplate", 1), vest = newItem("vest", 1);
  check(repairMin(gun) === 3 && repairMin(plate) === 5 && repairMin(vest) === 3, `your gates: a gun ${repairMin(gun)}, a steel plate ${repairMin(plate)}, a vest ${repairMin(vest)}`);
  const st = W();
  for (const [type, ok] of [["zealot", false], ["raider", true]]) {
    const f = G(st, type, { works: { ...BUILT } });
    ensureArsenal(st, f);
    const g = lootItem("pistol", "militia", [5, type]);
    g.durMax = itemDurMax(g); g.dur = Math.max(1, Math.round(g.durMax * 0.3));
    f.arsenal.items = [g];
    let n = 0;
    for (let d = 0; d < CARE.REPAIR.every; d++) n += repairGear(st, f, d);
    check(ok ? n > 0 : n === 0, `${type} (Mechanics ${groupSkill(f, "mechanics")}): ${n ? "mends" : "does not mend"} a worn pistol`);
  }
}

// ---------- 12. nothing they build that you cannot ----------
{
  console.log("Their works are your buildings");
  const YOURS = { water: "well", farms: "farm_plot", beds: "bunkhouse", walls: "walls", bench: "workbench", store: "storehouse", pens: "animal_pen", still: "still", power: "generator", freezer: "freezer", sealer: "sealer", kitchen: "canteen", mill: "grainmill", grinder: "meatgrinder", shop: "machine_shop", radio: "radio", garage: "garage", reload: "reload_bench", gate: "gate" };
  const missing = Object.keys(GROUP_WORKS.WORKS).filter((k) => !BUILDINGS[YOURS[k]]);
  check(!missing.length, `every work of theirs is a building of yours${missing.length ? ` (not: ${missing.join(", ")})` : ""}`);
  // gen-tiers: LOCKS power2 / power3 are your generator's upgrades (power.js GEN_TIERS req), not building types.
  const reqOf = (k) => (/^power\d$/.test(k) ? GEN_TIERS[Number(k.slice(5))].req : BUILDINGS[YOURS[k]].req) || {};
  const req = Object.entries(GROUP_WORKS.LOCKS).filter(([k, L]) => reqOf(k).mechanics !== L.mech && !(L.mech == null && !reqOf(k).mechanics));
  check(!req.length, `their Mechanics minimums are yours${req.length ? ` (differ: ${req.map(([k]) => k).join(", ")})` : ""}`);
  const crafts = [...ARSENAL.CRAFT.weapons, ...ARSENAL.CRAFT.ranged, "pipebomb", "molotov"].filter((k) => !CRAFTS[k]);
  check(!crafts.length, `everything their crafting makes is a recipe of yours${crafts.length ? ` (not: ${crafts.join(", ")})` : ""}`);
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (fails) { console.log("ailockstest FAILED"); process.exit(1); }
console.log("ailockstest passed");
