// The groups pack for the job (sim/loadouts.js packForJob, JOB_KIT; docs/adr/0001-ai-parity.md): when a group sends
// people out it packs them as your team is packed for its trip, out of what the group holds, and keeps home what home
// needs. Every piece is the group's own, in one place before and after, and every round is where it was or on the
// people who went (nothing made, nothing dropped).
//   1. The job kit (decoys, flares, packs, a scavenger's tools) is on the books and stays at home: the daily kit-out
//      does not hand it out.
//   2. Scavengers: a pack each, the crowbar to their best Scavenging, the picks and the drill.
//   3. Through the dead: a decoy and a Molotov each, flares, a melee weapon beside the gun; the home keeps its share.
//   4. A raid: grenades and bombs, a second helping of loose rounds out of the stores, a med kit to its best Medicine.
//   5. Hunting: a hunting rifle in the hands of the best shot, loaded out of the stores; a caravan: a med kit.
//   6. Home defence: the decoys kept at home set out against a horde the walls will not hold, by your warning card's
//      odds (defences.js decoyChance), used up; against one the walls hold, kept.
//   7. Seeking what the jobs need: decoys crafted by your recipes while short, paid for; a group short of decoys pays
//      more for one (trade.js).
// Usage: node tools/jobkittest.js [seed]
import { createWorld, hub, skill } from "../src/sim/world.js";
import { spawnAiParty, planPath } from "../src/sim/parties.js";
import { newItem, allCarried, carriedSpots, stow } from "../src/sim/inventory.js";
import { GEAR } from "../src/sim/data.js";
import * as A from "../src/sim/arsenal.js";
import { kitOut, spareKit, packForJob, jobsOf, JOB, LOADOUT, HUNT_GUNS } from "../src/sim/loadouts.js";
import { ensureMembers, syncMembers, homeMembers, membersOf } from "../src/sim/members.js";
import { DECOY_KEYS } from "../src/sim/stealth.js";
import { makeHorde } from "../src/sim/hordes.js";
import { hordeAtGroup, groupHoldCheck } from "../src/sim/groupfight.js";
import { decoyChance, holdLimit, DECOY_ITEMS } from "../src/sim/defences.js";
import { homeAt } from "../src/sim/groupbases.js";
import { gearSellPrice } from "../src/sim/trade.js";
import { setMech } from "./groupkit.js";

const seed = Number(process.argv[2] || 7);
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
const section = (t) => console.log(`\n${t}`);

// A group of the world with its people and its books, everything dealt (kitOut), and a supply of job kit on its books.
function setup(s = seed, extra = {}) {
  const st = createWorld({ seed: s, factionCount: 4 });
  st.started = true;
  const f = st.factions.find((x) => x.alive && x.bases.length && x.pop >= 10);
  A.ensureArsenal(st, f); ensureMembers(st, f); syncMembers(st, f);
  for (const [k, n] of Object.entries(extra)) for (let i = 0; i < n; i++) A.keepItem(st, f, newItem(k), "test");
  for (const t of st.tiles) t.infection = 0; // no dead on any way out unless a check puts them there
  st.hordes.length = 0;
  kitOut(st, f);
  return { st, f };
}
// A land tile 2–4 out from the group's base that its people can walk to.
function nearTile(st, f) {
  const g = st.grid, from = f.bases[0];
  return g.within(from, 4).find((t) => g.distance(t, from) >= 2 && st.tiles[t].terrain !== "water" && !st.factions.some((o) => o.bases.includes(t)) && !st.bases.some((b) => b.tile === t) && planPath(st, from, t, false, f.id));
}
// Where every book item is: [person, null for spare]. Items twice, items gone, items new: none allowed.
function placesOf(f) {
  const at = new Map(), twice = [];
  for (const s of membersOf(f)) for (const it of allCarried(s)) { if (at.has(it)) twice.push(it); at.set(it, s); }
  return { at, twice };
}
function sameBooks(f, before) {
  const now = new Set(f.arsenal.items);
  return now.size === before.size && [...before].every((it) => now.has(it)) && !placesOf(f).twice.length;
}
const goingOf = (f, p) => membersOf(f).filter((s) => s.location && s.location.partyId === p.id);
const count = (list, pred) => list.reduce((a, s) => a + allCarried(s).filter((it) => it && pred(it.key)).length, 0);

section("1. The job kit is on the books and stays at home");
{
  check(DECOY_KEYS.concat("flare").every((k) => A.DECOY_KIT.includes(k)) && A.DECOY_KIT.length === DECOY_KEYS.length + 1, `the books' decoys are stealth.js DECOY_KEYS and the flare (${A.DECOY_KIT.join(", ")})`);
  const { st, f } = setup(seed, { noisemaker: 6, alarmclock: 2, flare: 3, crowbar: 1, hikingpack: 3, makeshiftpick: 1 });
  const kit = f.arsenal.items.filter((it) => A.isJobKitKey(it.key));
  check(kit.length >= 16 && kit.every((it) => A.arsenalWorthy(it)), `${kit.length} pieces of job kit on ${f.name}'s books`);
  const held = placesOf(f).at;
  check(kit.every((it) => !held.has(it)), "the daily kit-out hands none of it out: it is all spare at home");
  check(homeMembers(f).some((s) => allCarried(s).some((it) => A.isThrowKey(it.key) || A.isWeaponKey(it.key))) || !f.arsenal.items.some((it) => A.isWeaponKey(it.key)), "(the rest of the kit is dealt as before)");
}

section("2. Scavengers pack bags and tools");
{
  const { st, f } = setup(seed, { hikingpack: 2, slingbag: 2, crowbar: 1, makeshiftpick: 1, powerdrill: 1, noisemaker: 4 });
  for (const s of membersOf(f)) s.gear.backpack = null; // nobody has a bag of their own
  const before = new Set(f.arsenal.items), r0 = A.groupRounds(f);
  const to = nearTile(st, f);
  const p = spawnAiParty(st, f, "scav", f.bases[0], to, { strength: 4 });
  const go = goingOf(f, p);
  check(!!p && JSON.stringify(p.jobs) === JSON.stringify(["scav"]), `a scavenging party packs for scavenging (jobs ${p && JSON.stringify(p.jobs)})`);
  const bags = go.filter((s) => s.gear.backpack && A.isPackKey(s.gear.backpack.key)).length;
  check(bags === Math.min(go.length, 4), `${bags} of the ${go.length} going wear a pack from the stores (4 on the books)`);
  const bar = go.find((s) => allCarried(s).some((it) => it.key === "crowbar"));
  const bestScav = go.slice().sort((a, b) => skill(b, "scavenging") - skill(a, "scavenging"))[0];
  check(!!bar && skill(bar, "scavenging") === skill(bestScav, "scavenging"), `the crowbar and lockpicks go to their best Scavenging (${bar ? bar.name : "nobody"})`);
  check(count(go, (k) => k === "makeshiftpick") === 1 && count(go, (k) => k === "powerdrill") === 1, "the picks and the drill go along");
  check(count(go, A.isDecoyKey) === 0 && f.arsenal.items.filter((it) => A.isDecoyKey(it.key)).every((it) => !placesOf(f).at.has(it)), "no dead on the way: the decoys stay at home");
  check(sameBooks(f, before) && A.groupRounds(f) === r0, "nothing made, nothing lost: the same books, each piece in one place, the same rounds");
}

section("3. A way through the dead: decoys, Molotovs, flares, a blade beside the gun");
{
  const { st, f } = setup(seed, { noisemaker: 5, pocketradio: 3, flare: 4, molotov: 4, machete: 3, hikingpack: 8 }); // packs: room for it (a pack on every empty back first)
  const to = nearTile(st, f);
  st.tiles[to].infection = 0.9; // thick with the dead where they are going
  check(JSON.stringify(jobsOf(st, "scav", [f.bases[0], to])) === JSON.stringify(["scav", "dead"]), `a way to land at infection 0.9 adds the dead's kit (${JSON.stringify(jobsOf(st, "scav", [f.bases[0], to]))})`);
  const decoys0 = f.arsenal.items.filter((it) => A.isDecoyKey(it.key) && it.key !== "flare").length;
  const before = new Set(f.arsenal.items), r0 = A.groupRounds(f);
  const p = spawnAiParty(st, f, "scav", f.bases[0], to, { strength: 6 });
  const go = goingOf(f, p);
  const dec = count(go, (k) => A.isDecoyKey(k) && k !== "flare");
  const keep = Math.ceil(decoys0 * JOB.KEEP);
  check(p.jobs.includes("dead") && dec === Math.min(go.length, decoys0 - keep), `${dec} decoys out with ${go.length} people (one each), ${decoys0 - dec} kept at home (the home's share: ${keep} of ${decoys0})`);
  check(count(go, (k) => k === "flare") === Math.min(JOB.FLARES, 4), `${count(go, (k) => k === "flare")} road flares for the passages`);
  check(go.every((s) => allCarried(s).some((it) => it.key === "molotov")) || count(go, (k) => k === "molotov") >= 1, `Molotovs: ${count(go, (k) => k === "molotov")} on ${go.length} people`);
  const gunners = go.filter((s) => s.gear.weapon && GEAR[s.gear.weapon.key].cat !== "melee");
  check(gunners.some((s) => s.gear.tool && GEAR[s.gear.tool.key].cat === "melee"), `a blade in the off hand of those holding a gun (${gunners.filter((s) => s.gear.tool && GEAR[s.gear.tool.key].cat === "melee").length} of ${gunners.length})`);
  check(sameBooks(f, before) && A.groupRounds(f) === r0, "the same books, each piece in one place, the same rounds");
}

section("4. A raid: grenades, a second helping of rounds, a med kit");
{
  const { st, f } = setup(seed + 1, { frag: 6, pipebomb: 4, traumakit: 1, tourniquet: 6 });
  const other = st.factions.find((x) => x !== f && x.alive && x.bases.length);
  const to = nearTile(st, f);
  const before = new Set(f.arsenal.items), r0 = A.groupRounds(f), s0 = A.arsenalRounds(f);
  const homeGrenades0 = count(homeMembers(f), A.isThrowKey) + spareKit(f).filter((it) => A.isThrowKey(it.key)).length;
  const p = spawnAiParty(st, f, "raid", f.bases[0], to, { strength: 10, target: { kind: "faction", factionId: other.id, tile: to } });
  const go = goingOf(f, p);
  const gren = count(go, A.isThrowKey);
  check(p.jobs[0] === "raid" && gren >= Math.min(homeGrenades0, go.length), `${gren} grenades, bombs and Molotovs on the ${go.length} raiders (up to ${LOADOUT.THROWS} each)`);
  const medic = go.find((s) => allCarried(s).some((it) => A.isMedKitKey(it.key)));
  check(!!medic, `a med kit with ${medic ? medic.name : "nobody"}`);
  const out = A.arsenalRounds(f);
  check(out < s0 && A.groupRounds(f) === r0, `a second helping of loose rounds out of the stores (${s0} → ${out}), every round still the group's (${r0})`);
  check(sameBooks(f, before), "the same books, each piece in one place");
}

section("5. Hunting and a caravan");
{
  const { st, f } = setup(seed + 2);
  A.keepItem(st, f, newItem("huntrifle"), "test"); // spare in the stores (after the day's kit-out)
  const go = homeMembers(f).filter((s) => !(s.gear.weapon && HUNT_GUNS.includes(s.gear.weapon.key))).slice(0, 3);
  for (const s of go) { s.location = { ...s.location, partyId: "test" }; if (!s.gear.backpack) s.gear.backpack = newItem("hikingpack"); } // room for their own gun

  const best = go.slice().sort((a, b) => skill(b, "shooting") - skill(a, "shooting"))[0]; // (their Shooting as it counts: traits and gear)
  const was = best.gear.weapon;
  const before = new Set(f.arsenal.items), r0 = A.groupRounds(f);
  packForJob(st, f, go, "hunt");
  const rifle = best.gear.weapon;
  check(!!rifle && HUNT_GUNS.includes(rifle.key), `the best shot holds the hunting rifle (${best.name}: ${rifle && rifle.name})`);
  check(!!rifle.loaded && rifle.loaded.n > 0 && A.groupRounds(f) === r0, `loaded out of the stores (${rifle.loaded ? rifle.loaded.n : 0} rounds), every round still the group's`);
  check(!was || allCarried(best).includes(was), `their own weapon goes with them (${was ? was.name : "none"}: in the off hand or stowed)`);
  check(sameBooks(f, before), "the same books, each piece in one place");
  const g2 = setup(seed + 3, { traumakit: 1 });
  const p = spawnAiParty(g2.st, g2.f, "caravan", g2.f.bases[0], nearTile(g2.st, g2.f), { strength: 4 });
  const cgo = goingOf(g2.f, p);
  check(p.jobs[0] === "caravan" && cgo.some((s) => allCarried(s).some((it) => A.isMedKitKey(it.key))), `a caravan takes a med kit (${cgo.length} going)`);
}

section("6. Home defence: the decoys kept at home");
{
  const { st, f } = setup(seed, { noisemaker: 4, alarmclock: 1 });
  const tile = f.bases[0];
  const big = Math.round(holdLimit(st, homeAt(st, f, tile), 0) * 3);
  const h = makeHorde(st, { tile, size: big, role: "roam", split: true });
  const c = groupHoldCheck(st, f, tile, big);
  const d0 = f.arsenal.items.filter((it) => DECOY_KEYS.includes(it.key)).length;
  const odds = [];
  const roll = st.rng.chance.bind(st.rng);
  st.rng.chance = (p) => { if (!odds.length) { odds.push(p); return true; } return roll(p); };
  const r = hordeAtGroup(st, h, f, tile);
  st.rng.chance = roll;
  const used = d0 - f.arsenal.items.filter((it) => DECOY_KEYS.includes(it.key)).length;
  check(!c.holds && used === Math.min(DECOY_ITEMS, d0), `a horde of ${big} the walls cannot hold: ${used} decoys set out from the stores and used up`);
  check(Math.abs(odds[0] - decoyChance(h, used)) < 1e-12, `by your warning card's odds (${Math.round(odds[0] * 100)}%)`);
  check(r && r.held && r.lured === used && h.lureUntil > st.hour, "drawn off: the horde falls back from the walls for a few days, the base held");
  const g = setup(seed, { noisemaker: 4 });
  const t2 = g.f.bases[0];
  const small = Math.max(5, Math.floor(holdLimit(g.st, homeAt(g.st, g.f, t2), 0) * 0.5));
  const h2 = makeHorde(g.st, { tile: t2, size: small, role: "roam", split: true });
  const n0 = g.f.arsenal.items.filter((it) => DECOY_KEYS.includes(it.key)).length;
  hordeAtGroup(g.st, h2, g.f, t2);
  check(g.f.arsenal.items.filter((it) => DECOY_KEYS.includes(it.key)).length === n0, `a horde of ${small} the walls hold: the decoys are kept (${n0})`);
}

section("7. Seeking what the jobs need");
{
  const { st, f } = setup(seed);
  setMech(st, f, 4);
  f.stock.scrap = 60;
  const dec = () => f.arsenal.items.filter((it) => A.isDecoyKey(it.key)).length;
  const d0 = dec(), sc0 = f.stock.scrap;
  for (let i = 0; i < 30 && dec() === d0; i++) { st.hour += 24; f.careTick = (f.careTick || 0) + 1; A.arsenalDaily(st, f); }
  check(dec() > d0 && f.stock.scrap < sc0, `short of decoys, they make them by your recipes (${d0} → ${dec()}; scrap ${sc0} → ${f.stock.scrap})`);
  // A group with plenty makes none.
  for (let i = 0; i < Math.ceil(f.pop * A.ARSENAL.KIT_WANT.decoy) + 1; i++) A.keepItem(st, f, newItem("noisemaker"), "test");
  const full = dec();
  for (let i = 0; i < 12; i++) { st.hour += 24; f.careTick++; A.arsenalDaily(st, f); }
  check(dec() === full && A.jobKitShort(f, "noisemaker") === 0, `with ${full} on the books (${A.ARSENAL.KIT_WANT.decoy} a head kept) they make no more`);
  // They pay more for a decoy while they are short of them.
  const g = setup(seed + 4);
  const it = newItem("noisemaker");
  const short = gearSellPrice(g.st, g.f, it, 0);
  for (let i = 0; i < 20; i++) A.keepItem(g.st, g.f, newItem("noisemaker"), "test");
  const plenty = gearSellPrice(g.st, g.f, it, 0);
  check(plenty < short, `a noise maker is worth more to them while they are short (${short.toFixed(2)} → ${plenty.toFixed(2)} with 20 on the books)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
